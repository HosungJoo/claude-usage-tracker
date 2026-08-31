import { CredentialError, describeCredentialError } from './credentials.js';
import { StateStore } from './state-store.js';
import {
  evaluateThresholds,
  type ThresholdEvent,
  type ThresholdState,
} from './thresholds.js';
import {
  describeUsageError,
  getUsageSnapshot,
  isRetryable,
  UsageError,
  type FetchUsageOptions,
} from './usage-api.js';
import { t } from '../shared/i18n/index.js';
import type { UsageSnapshot } from './types.js';

/**
 * 주기 폴링 + 임계값 판정 + 상태 저장을 묶은 상주 컴포넌트.
 *
 * 설계 원칙: 이 앱은 배경에서 조용히 돌아야 한다. 실패해도 죽지 않고,
 * 복구되면 알아서 정상 주기로 돌아온다.
 */

export const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 10_000;
const MAX_BACKOFF_MS = 300_000; // 5분
const BASE_BACKOFF_MS = 5_000;

export interface PollerOptions extends FetchUsageOptions {
  intervalMs?: number;
  thresholds?: readonly number[];
  store?: StateStore;
  /** 테스트 주입용. */
  now?: () => number;
}

export type PollerEvents = {
  /** 조회에 성공할 때마다. UI 갱신용. */
  snapshot: (snapshot: UsageSnapshot) => void;
  /** 임계값을 넘었을 때. 캐릭터를 띄우는 신호. */
  threshold: (event: ThresholdEvent, snapshot: UsageSnapshot) => void;
  /** 조회 실패. 사용자에게 보여줄 수 있는 문구가 함께 온다. */
  error: (error: Error, message: string, willRetry: boolean) => void;
};

type Listeners = { [K in keyof PollerEvents]: Set<PollerEvents[K]> };

export class UsagePoller {
  private readonly intervalMs: number;
  private readonly store: StateStore;
  private readonly now: () => number;
  private readonly listeners: Listeners = {
    snapshot: new Set(),
    threshold: new Set(),
    error: new Set(),
  };

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** 진행 중인 조회. 겹쳐 부르면 이것을 같이 기다린다. */
  private inFlight: Promise<UsageSnapshot | null> | null = null;
  private consecutiveFailures = 0;
  private thresholdState: ThresholdState | null = null;
  private lastSnapshot: UsageSnapshot | null = null;

  constructor(private readonly options: PollerOptions = {}) {
    this.intervalMs = Math.max(MIN_INTERVAL_MS, options.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.store = options.store ?? new StateStore();
    this.now = options.now ?? (() => Date.now());
  }

  on<K extends keyof PollerEvents>(event: K, fn: PollerEvents[K]): () => void {
    this.listeners[event].add(fn as never);
    return () => this.off(event, fn);
  }

  off<K extends keyof PollerEvents>(event: K, fn: PollerEvents[K]): void {
    this.listeners[event].delete(fn as never);
  }

  private emit<K extends keyof PollerEvents>(event: K, ...args: Parameters<PollerEvents[K]>): void {
    for (const fn of this.listeners[event]) {
      try {
        (fn as (...a: unknown[]) => void)(...args);
      } catch {
        // 리스너 하나가 던져도 폴링은 계속되어야 한다.
      }
    }
  }

  get snapshot(): UsageSnapshot | null {
    return this.lastSnapshot;
  }

  /** 폴링을 시작한다. 첫 조회는 즉시 수행한다. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.thresholdState = await this.store.load();
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * 지금 즉시 한 번 조회한다. 트레이의 "지금 확인"과 세션 시작 훅이 부른다.
   *
   * 이미 조회 중이면 **그 조회를 같이 기다린다.** 중복 요청을 하지 않는 건
   * 같지만, 기다리지 않고 마지막 스냅샷을 돌려주면 시작 직후에 null이 된다 —
   * 첫 조회가 끝나기 전에 세션 훅이 들어오는 상황이 정확히 그렇고, 부르는
   * 쪽은 그 null을 '조회 실패'로 보고 인사를 통째로 건너뛴다.
   */
  async refreshNow(): Promise<UsageSnapshot | null> {
    return this.inFlight ?? this.tick();
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  /** 실패 횟수에 따른 지수 백오프. 5분에서 멈춘다. */
  private backoffMs(retryAfterSec?: number): number {
    if (retryAfterSec !== undefined && retryAfterSec > 0) {
      return Math.min(MAX_BACKOFF_MS, retryAfterSec * 1000);
    }
    const exp = BASE_BACKOFF_MS * 2 ** Math.min(this.consecutiveFailures - 1, 6);
    // 여러 인스턴스가 동시에 재시도해 몰리지 않도록 약간 흩뿌린다.
    const jitter = Math.floor(Math.random() * 1000);
    return Math.min(MAX_BACKOFF_MS, exp + jitter);
  }

  private tick(): Promise<UsageSnapshot | null> {
    if (!this.running && this.timer !== null) return Promise.resolve(this.lastSnapshot);

    const run = this.runTick();
    this.inFlight = run;
    // 성공이든 실패든 자리를 비운다. 다음 조회가 이 결과에 묶이면 안 된다.
    const clear = (): void => {
      if (this.inFlight === run) this.inFlight = null;
    };
    void run.then(clear, clear);
    return run;
  }

  private async runTick(): Promise<UsageSnapshot | null> {
    try {
      const snapshot = await getUsageSnapshot(this.options);
      this.consecutiveFailures = 0;
      this.lastSnapshot = snapshot;
      this.emit('snapshot', snapshot);

      const prev = this.thresholdState ?? (await this.store.load());
      const { events, state } = evaluateThresholds(snapshot, prev, {
        ...(this.options.thresholds ? { thresholds: this.options.thresholds } : {}),
        now: this.now(),
      });
      this.thresholdState = state;
      await this.store.save(state, snapshot.fetchedAt);

      for (const ev of events) this.emit('threshold', ev, snapshot);

      this.schedule(this.intervalMs);
      return snapshot;
    } catch (e) {
      this.consecutiveFailures += 1;
      const { message, willRetry } = this.classify(e);
      this.emit('error', e instanceof Error ? e : new Error(String(e)), message, willRetry);

      if (willRetry) {
        const retryAfter = e instanceof UsageError ? e.retryAfterSec : undefined;
        this.schedule(this.backoffMs(retryAfter));
      } else {
        // 토큰 만료처럼 스스로 못 고치는 상황. 사용자가 `claude` 를 실행하면
        // 파일이 바뀌므로, 느린 주기로는 계속 확인해 본다.
        this.schedule(MAX_BACKOFF_MS);
      }
      return null;
    }
  }

  private classify(e: unknown): { message: string; willRetry: boolean } {
    if (e instanceof UsageError) {
      return { message: describeUsageError(e), willRetry: isRetryable(e) };
    }
    if (e instanceof CredentialError) {
      return { message: describeCredentialError(e), willRetry: false };
    }
    return { message: t().error.unknown, willRetry: true };
  }
}
