import { mkdir, readdir, readFile, rm, unlink } from 'node:fs/promises';
import { rmSync, watch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import { eventSpoolDir } from '../shared/runtime-paths.js';
import type { HookEvent } from '../hooks/hook-script.js';

/**
 * 훅이 떨어뜨린 이벤트 파일을 읽어들이는 수신부.
 *
 * 소켓이 아니라 파일을 쓰는 이유: 훅은 세션 시작 경로에서 실행된다.
 * 셸 리다이렉션 한 줄이면 되는 일에 node나 socat을 요구하면, 그게 없는
 * 환경에서 사용자의 세션 시작이 깨진다. 파일 드롭은 어디서나 되고,
 * 앱이 꺼져 있으면 디렉터리가 없어서 훅이 알아서 물러난다.
 *
 * 디렉터리의 존재 자체가 "앱이 살아 있다"는 신호다.
 */

/** 이보다 오래된 이벤트는 버린다. 앱을 껐다 켠 뒤 옛날 인사를 하면 안 된다. */
const STALE_MS = 60_000;

/** fs.watch를 놓치는 환경(일부 네트워크 FS, 컨테이너)을 위한 안전망. */
const SWEEP_INTERVAL_MS = 3_000;

export type EventHandler = (event: HookEvent) => void;

export class EventSpool {
  private watcher: FSWatcher | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private draining = false;
  private started = false;

  constructor(
    private readonly handler: EventHandler,
    private readonly dir: string = eventSpoolDir(),
    private readonly now: () => number = Date.now,
  ) {}

  get directory(): string {
    return this.dir;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    // 앱이 꺼져 있는 동안 쌓인 것이 있으면 지금 치운다.
    await this.drain();

    try {
      this.watcher = watch(this.dir, () => void this.drain());
    } catch {
      // watch를 못 걸어도 아래 주기 스윕으로 동작한다.
    }
    this.sweepTimer = setInterval(() => void this.drain(), SWEEP_INTERVAL_MS);
  }

  private teardown(): void {
    this.started = false;
    this.watcher?.close();
    this.watcher = null;
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /**
   * 디렉터리를 지운다 — 훅에게 "앱이 내려갔다"고 알리는 방법이다.
   * 이게 없으면 앱이 꺼진 뒤에도 훅이 파일을 계속 쌓는다.
   */
  async stop(): Promise<void> {
    this.teardown();
    await rm(this.dir, { recursive: true, force: true }).catch(() => {});
  }

  /**
   * 종료 직전에 부르는 동기 정리.
   *
   * Electron의 before-quit은 프로미스를 기다려 주지 않는다. 비동기로
   * 지우면 앱이 먼저 죽고 디렉터리가 남아, 이후의 모든 세션에서 훅이
   * 읽는 이 없는 파일을 계속 쌓는다.
   */
  stopSync(): void {
    this.teardown();
    try {
      rmSync(this.dir, { recursive: true, force: true });
    } catch {
      // 지우지 못해도 종료는 계속되어야 한다.
    }
  }

  /** 쌓인 이벤트 파일을 모두 읽어 처리하고 지운다. */
  async drain(): Promise<void> {
    // watch 이벤트가 연달아 오면 중복 실행된다. 한 번에 하나만 돈다.
    if (this.draining) return;
    this.draining = true;
    try {
      let names: string[];
      try {
        names = await readdir(this.dir);
      } catch {
        return;
      }

      // 파일명 앞에 PID, 뒤에 나노초 타임스탬프가 붙는다. 이름 순서가
      // 곧 시간 순서는 아니므로, 들어온 순서를 보장하려면 정렬이 필요하다.
      const events = names.filter((n) => n.endsWith('.json')).sort();

      for (const name of events) {
        const path = join(this.dir, name);
        let raw: string;
        try {
          raw = await readFile(path, 'utf8');
        } catch {
          continue;
        }
        await unlink(path).catch(() => {});

        const stamp = parseStamp(name);
        if (stamp !== null && this.now() - stamp > STALE_MS) continue;

        let parsed: HookEvent;
        try {
          parsed = JSON.parse(raw) as HookEvent;
        } catch {
          // 훅이 이상한 걸 썼다. 파일은 이미 지웠으니 넘어간다.
          continue;
        }
        try {
          this.handler(parsed);
        } catch {
          // 핸들러가 던져도 나머지 이벤트는 처리해야 한다.
        }
      }
    } finally {
      this.draining = false;
    }
  }
}

/** `<pid>-<epoch나노초>.json` 에서 시각(ms)을 뽑는다. */
export function parseStamp(name: string): number | null {
  const m = /^\d+-(\d+)\.json$/.exec(name);
  if (!m) return null;
  const digits = m[1] as string;
  // date +%s%N 은 19자리(나노초), 폴백인 date +%s 는 10자리(초).
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  if (digits.length >= 16) return Math.floor(value / 1e6);
  if (digits.length >= 13) return value;
  return value * 1000;
}
