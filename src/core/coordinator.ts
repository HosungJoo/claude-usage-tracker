import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { readFileSync, rmSync, watch, type FSWatcher } from 'node:fs';
import { dirname, join } from 'node:path';
import { pollerLockPath, runtimeDir, snapshotPath } from '../shared/runtime-paths.js';
import type { UsageSnapshot } from './types.js';

/**
 * 사용량을 조회하는 프로세스를 하나로 줄인다.
 *
 * 트레이 앱과 VS Code 확장이 각자 폴링하면 사용량은 하나인데 요청은 둘이
 * 된다. 창을 몇 개 열어두면 곧 429가 나고, 그때 두 화면 모두 숫자를 잃는다.
 *
 * 그래서 먼저 자리를 잡은 쪽(리더)만 API를 부르고, 결과를 파일에 놓는다.
 * 나머지(팔로워)는 그 파일을 지켜보다 받아 쓴다. **임계값 판정은 각자 한다** —
 * 알림을 낼지는 화면을 가진 쪽이 정할 일이고, 트레이 오버레이와 패널 카드는
 * 각각 자기 몫의 알림을 내야 하기 때문이다.
 *
 * 잠금 대신 임차(lease)를 쓴다. 프로세스가 죽으면서 잠금을 못 푸는 경우가
 * 실제로 흔한데, 그때 남은 잠금 파일 하나 때문에 아무도 조회하지 못하는
 * 상태가 가장 나쁘다. 심장박동이 끊기면 자리는 비는 것으로 본다.
 */

/** 리더가 살아 있다고 알리는 주기. */
export const HEARTBEAT_MS = 15_000;
/** 이만큼 심장박동이 없으면 자리가 빈 것으로 본다. */
export const LEASE_MS = 45_000;
/** 이보다 오래된 스냅샷은 쓰지 않는다. 리더가 죽어가는 중일 수 있다. */
const SNAPSHOT_STALE_MS = 10 * 60_000;

const LOCK_VERSION = 1;
const SNAPSHOT_VERSION = 1;

/** 코디네이터가 다루는 폴러의 최소 모양. 테스트가 가짜를 끼울 수 있게 좁게 잡는다. */
export interface PollerLike {
  start(): Promise<void>;
  stop(): void;
  ingest(snapshot: UsageSnapshot): Promise<void>;
  refreshNow(): Promise<UsageSnapshot | null>;
  readonly snapshot: UsageSnapshot | null;
  on(event: 'snapshot', fn: (snapshot: UsageSnapshot) => void): () => void;
}

export interface CoordinatorOptions {
  poller: PollerLike;
  /** 표식들이 놓이는 자리. 기본은 XDG 런타임 디렉터리. */
  dir?: string;
  /** 이 프로세스를 가리키는 값. 기본은 pid. */
  id?: number;
  now?: () => number;
  heartbeatMs?: number;
  leaseMs?: number;
  /** 그 pid가 아직 살아 있는지. 기본은 signal 0. 테스트가 갈아끼운다. */
  isAlive?: (pid: number) => boolean;
  /** 역할이 바뀔 때마다. 로그를 남기려는 쪽이 쓴다. */
  onRole?: (leader: boolean) => void;
}

interface Lock {
  version: number;
  id: number;
  heartbeat: number;
}

interface Broadcast {
  version: number;
  writtenAt: number;
  snapshot: UsageSnapshot;
}

function defaultIsAlive(pid: number): boolean {
  try {
    // 신호 0은 아무것도 보내지 않고 존재만 확인한다.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 반쯤 쓰인 파일을 남에게 보이지 않도록 임시 이름으로 쓴 뒤 옮긴다. */
async function writeAtomic(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, path);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    // 없거나, 깨졌거나, 마침 갈아끼우는 중이다. 셋 다 '모른다'로 본다.
    return null;
  }
}

function validLock(raw: unknown): Lock | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o['version'] !== LOCK_VERSION) return null;
  if (typeof o['id'] !== 'number' || typeof o['heartbeat'] !== 'number') return null;
  return { version: LOCK_VERSION, id: o['id'], heartbeat: o['heartbeat'] };
}

function validBroadcast(raw: unknown): Broadcast | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o['version'] !== SNAPSHOT_VERSION) return null;
  if (typeof o['writtenAt'] !== 'number') return null;
  const snap = o['snapshot'];
  if (typeof snap !== 'object' || snap === null) return null;
  const s = snap as Record<string, unknown>;
  if (typeof s['fetchedAt'] !== 'number') return null;
  return { version: SNAPSHOT_VERSION, writtenAt: o['writtenAt'], snapshot: snap as unknown as UsageSnapshot };
}

export class PollCoordinator {
  private readonly poller: PollerLike;
  private readonly lockPath: string;
  private readonly broadcastPath: string;
  private readonly id: number;
  private readonly now: () => number;
  private readonly heartbeatMs: number;
  private readonly leaseMs: number;
  private readonly isAlive: (pid: number) => boolean;

  private leader = false;
  private started = false;
  private timer: NodeJS.Timeout | null = null;
  private watcher: FSWatcher | null = null;
  private unsubscribe: (() => void) | null = null;
  /** -1은 '아직 아무것도 안 받았다'. 0을 쓰면 시각이 0인 첫 결과를 놓친다. */
  private lastIngestedAt = -1;

  constructor(private readonly options: CoordinatorOptions) {
    this.poller = options.poller;
    const dir = options.dir ?? runtimeDir();
    this.lockPath = options.dir ? join(dir, 'poller.lock') : pollerLockPath();
    this.broadcastPath = options.dir ? join(dir, 'snapshot.json') : snapshotPath();
    this.id = options.id ?? process.pid;
    this.now = options.now ?? ((): number => Date.now());
    this.heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
    this.leaseMs = options.leaseMs ?? LEASE_MS;
    this.isAlive = options.isAlive ?? defaultIsAlive;
  }

  get isLeader(): boolean {
    return this.leader;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await mkdir(dirname(this.lockPath), { recursive: true });
    await this.settleRole();
    this.timer = setInterval(() => void this.settleRole(), this.heartbeatMs);
  }

  async stop(): Promise<void> {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopWatching();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.poller.stop();

    // 자리를 비우고 나간다. 다음 프로세스가 임차 만료를 기다리지 않아도 되게.
    if (this.leader) {
      const lock = validLock(await readJson(this.lockPath));
      if (lock?.id === this.id) await rm(this.lockPath, { force: true });
    }
    this.leader = false;
  }

  /**
   * "지금 확인"처럼 사용자가 직접 부른 조회.
   *
   * 팔로워는 먼저 리더가 놓아둔 결과를 본다. 그것이 충분히 새것이면
   * 그대로 쓴다 — 창을 열 때마다 인사하는 세션 훅이 곧장 API를 부르면,
   * 창을 여러 개 여는 순간 정확히 429가 나기 때문이다. 결과가 낡았을
   * 때만 직접 부른다.
   */
  async refresh(): Promise<UsageSnapshot | null> {
    if (this.leader) return this.poller.refreshNow();

    await this.drain();
    const fresh = this.poller.snapshot;
    if (fresh !== null && this.now() - fresh.fetchedAt < this.leaseMs) return fresh;
    return this.poller.refreshNow();
  }

  /**
   * 종료 직전에 자리를 비운다.
   *
   * Electron의 before-quit은 프로미스를 기다려주지 않는다. 여기서 못 지우면
   * 다음에 켤 때 임차가 만료될 때까지(45초) 아무도 조회하지 않는다.
   */
  releaseSync(): void {
    if (!this.leader) return;
    try {
      const raw = JSON.parse(readFileSync(this.lockPath, 'utf8')) as { id?: unknown };
      if (raw.id !== this.id) return;
      rmSync(this.lockPath, { force: true });
    } catch {
      // 이미 없거나 남의 것이다. 어느 쪽이든 지울 것이 없다.
    }
  }

  /** 자리를 잡을 수 있으면 잡고, 아니면 남의 결과를 기다린다. */
  private async settleRole(): Promise<void> {
    if (!this.started) return;
    const claimed = await this.tryClaim();
    if (claimed) {
      await this.becomeLeader();
      return;
    }
    await this.becomeFollower();
    // 감시를 놓쳤더라도 심장박동마다 한 번은 확인한다.
    await this.drain();
  }

  /**
   * 자리가 비었으면 내 이름을 적는다.
   *
   * 마지막에 쓴 쪽이 이긴다. 두 프로세스가 같은 순간에 적으면 잠깐 둘 다
   * 조회할 수 있지만, 다음 심장박동에서 하나로 정리된다. 그 잠깐의 중복은
   * 아무도 조회하지 못하는 상태보다 훨씬 낫다.
   */
  private async tryClaim(): Promise<boolean> {
    const lock = validLock(await readJson(this.lockPath));
    const now = this.now();

    if (lock !== null && lock.id !== this.id) {
      const fresh = now - lock.heartbeat < this.leaseMs;
      // 심장박동이 아직 유효해도, 그 프로세스가 이미 없으면 기다릴 이유가 없다.
      if (fresh && this.isAlive(lock.id)) return false;
    }

    await writeAtomic(
      this.lockPath,
      JSON.stringify({ version: LOCK_VERSION, id: this.id, heartbeat: now }),
    );

    const after = validLock(await readJson(this.lockPath));
    return after?.id === this.id;
  }

  private async becomeLeader(): Promise<void> {
    if (this.leader) return;
    this.leader = true;
    this.options.onRole?.(true);
    this.stopWatching();

    // 조회에 성공할 때마다 결과를 놓아둔다. 팔로워는 이것만 본다.
    this.unsubscribe?.();
    this.unsubscribe = this.poller.on('snapshot', (snapshot) => {
      void writeAtomic(
        this.broadcastPath,
        JSON.stringify({
          version: SNAPSHOT_VERSION,
          writtenAt: this.now(),
          snapshot,
        }),
      ).catch(() => {
        // 결과를 못 나눠줘도 내 화면은 멀쩡하다. 다음 조회에서 다시 시도된다.
      });
    });

    await this.poller.start();
  }

  private async becomeFollower(): Promise<void> {
    if (!this.leader && this.watcher !== null) return;
    this.leader = false;
    this.options.onRole?.(false);
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.poller.stop();
    this.startWatching();
    await this.drain();
  }

  private startWatching(): void {
    if (this.watcher !== null) return;
    try {
      this.watcher = watch(dirname(this.broadcastPath), () => void this.drain());
    } catch {
      // 감시를 못 걸어도 아래 쓸기 타이머가 있다.
    }
  }

  private stopWatching(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  /** 리더가 놓아둔 결과를 읽어 폴러에 먹인다. */
  private async drain(): Promise<void> {
    if (!this.started || this.leader) return;
    const broadcast = validBroadcast(await readJson(this.broadcastPath));
    if (broadcast === null) return;
    if (broadcast.writtenAt <= this.lastIngestedAt) return;
    if (this.now() - broadcast.writtenAt > SNAPSHOT_STALE_MS) return;

    this.lastIngestedAt = broadcast.writtenAt;
    await this.poller.ingest(broadcast.snapshot);
  }
}
