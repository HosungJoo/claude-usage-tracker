import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { emptyThresholdState, type ThresholdState } from './thresholds.js';

/**
 * 발화 이력의 디스크 영속화.
 *
 * 앱을 재시작하거나 PC를 재부팅해도 같은 알림이 다시 뜨지 않아야 한다.
 * 저장 실패나 손상은 앱을 멈출 이유가 아니다 — 기본값으로 진행한다.
 */

const STATE_VERSION = 1;

export function defaultStatePath(): string {
  const base = process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config');
  return join(base, 'claude-usage-tracker', 'state.json');
}

interface PersistedState {
  version: number;
  thresholds: ThresholdState;
  /** 마지막으로 성공적으로 조회한 시각. 진단용. */
  lastFetchedAt: number | null;
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function parseWindow(v: unknown): { fired: number[]; resetsAt: number | null } | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isNumberArray(o['fired'])) return null;
  const r = o['resetsAt'];
  const resetsAt = typeof r === 'number' && Number.isFinite(r) ? r : null;
  return { fired: o['fired'], resetsAt };
}

/** 손상된 파일에서도 앱이 뜨도록, 검증에 실패하면 조용히 기본값을 돌려준다. */
function validate(raw: unknown): PersistedState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o['version'] !== STATE_VERSION) return null;

  const t = o['thresholds'];
  if (typeof t !== 'object' || t === null) return null;
  const to = t as Record<string, unknown>;

  const fiveHour = parseWindow(to['fiveHour']);
  const weekly = parseWindow(to['weekly']);
  if (!fiveHour || !weekly) return null;

  const last = o['lastFetchedAt'];
  return {
    version: STATE_VERSION,
    thresholds: { fiveHour, weekly },
    lastFetchedAt: typeof last === 'number' && Number.isFinite(last) ? last : null,
  };
}

export class StateStore {
  private cache: PersistedState;

  constructor(private readonly path: string = defaultStatePath()) {
    this.cache = { version: STATE_VERSION, thresholds: emptyThresholdState(), lastFetchedAt: null };
  }

  /** 디스크에서 읽어 캐시를 채운다. 파일이 없거나 손상됐으면 기본값. */
  async load(): Promise<ThresholdState> {
    try {
      const text = await readFile(this.path, 'utf8');
      const parsed = validate(JSON.parse(text));
      if (parsed) this.cache = parsed;
    } catch {
      // 파일 없음/손상/권한 — 어느 쪽이든 기본값으로 시작하는 게 맞다.
    }
    return this.cache.thresholds;
  }

  get thresholds(): ThresholdState {
    return this.cache.thresholds;
  }

  get lastFetchedAt(): number | null {
    return this.cache.lastFetchedAt;
  }

  /**
   * 상태를 저장한다. 쓰기 도중 전원이 끊겨도 파일이 반쪽 나지 않도록
   * 임시 파일에 쓴 뒤 rename 한다.
   *
   * @returns 저장 성공 여부. 실패해도 예외를 던지지 않는다.
   */
  async save(thresholds: ThresholdState, lastFetchedAt: number | null): Promise<boolean> {
    this.cache = { version: STATE_VERSION, thresholds, lastFetchedAt };
    const tmp = `${this.path}.tmp`;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(tmp, JSON.stringify(this.cache, null, 2), { mode: 0o600 });
      await rename(tmp, this.path);
      return true;
    } catch {
      return false;
    }
  }
}
