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
/**
 * 429에는 이보다 빨리 다시 두드리지 않는다.
 *
 * 이 엔드포인트의 429에는 Retry-After가 없다. 그러면 일반 백오프(5초)로
 * 떨어지는데, 429는 '너무 자주 불렀다'는 뜻이라 5초 뒤 재시도는 원인을
 * 그대로 반복하는 짓이다. 실제로 한 번 막히면 성공할 때까지 몇 초 간격으로
 * 두드리다가, 성공해 카운터가 풀리면 1분 뒤 같은 폭주를 다시 시작했다.
 * 저쪽이 알려주지 않을 때는 폴링 주기만큼은 쉰다.
 */
const RATE_LIMIT_MIN_BACKOFF_MS = 60_000;
/** 429를 만난 뒤 이 시간 동안은 조심스럽게 돈다. */
const RATE_LIMIT_CALM_MS = 10 * 60_000;
/** 그동안 쓰는 폴링 주기. 숫자는 조금 늦어도 되지만 막히면 아무것도 못 본다. */
const RATE_LIMIT_INTERVAL_MS = 180_000;

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
  /** 마지막으로 429를 받은 시각. 0이면 아직 없다. */
  private lastRateLimitedAt = 0;
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

  /**
   * 남이 받아온 스냅샷을 그대로 먹인다.
   *
   * 여러 프로세스가 같은 사용량을 각자 조회하면 API가 429로 막는다.
   * 한 프로세스만 조회하고 나머지는 그 결과를 받아 쓰기 위한 입구다.
   * 임계값 판정은 여기서도 똑같이 돈다 — 알림을 낼지 말지는 화면을
   * 가진 쪽이 각자 정해야 하기 때문이다.
   */
  async ingest(snapshot: UsageSnapshot): Promise<void> {
    this.consecutiveFailures = 0;
    this.lastSnapshot = snapshot;
    this.emit('snapshot', snapshot);
    await this.evaluate(snapshot);
  }

  /** 스냅샷 하나로 임계값을 판정하고 이력을 남긴다. 조회 경로와 공유한다. */
  private async evaluate(snapshot: UsageSnapshot): Promise<void> {
    const prev = this.thresholdState ?? (await this.store.load());
    const { events, state } = evaluateThresholds(snapshot, prev, {
      ...(this.options.thresholds ? { thresholds: this.options.thresholds } : {}),
      now: this.now(),
    });
    this.thresholdState = state;
    await this.store.save(state, snapshot.fetchedAt);

    for (const ev of events) this.emit('threshold', ev, snapshot);
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), delayMs);
  }

  /** 실패 횟수에 따른 지수 백오프. 5분에서 멈춘다. */
  private backoffMs(retryAfterSec?: number, rateLimited = false): number {
    if (retryAfterSec !== undefined && retryAfterSec > 0) {
      // 저쪽이 직접 말해준 시각이다. 우리 추측보다 이것이 맞다.
      return Math.min(MAX_BACKOFF_MS, retryAfterSec * 1000);
    }
    const exp = BASE_BACKOFF_MS * 2 ** Math.min(this.consecutiveFailures - 1, 6);
    // 여러 인스턴스가 동시에 재시도해 몰리지 않도록 약간 흩뿌린다.
    const jitter = Math.floor(Math.random() * 1000);
    const floor = rateLimited ? RATE_LIMIT_MIN_BACKOFF_MS : 0;
    return Math.min(MAX_BACKOFF_MS, Math.max(floor, exp + jitter));
  }

  /**
   * 성공한 뒤 다음 조회까지의 간격.
   *
   * 조금 전에 429를 봤다면 평소 주기로 돌아가지 않는다. 한 번 성공했다고
   * 곧바로 1분 주기로 복귀하면, 방금 막았던 쪽을 다시 같은 속도로 두드린다.
   */
  private nextIntervalMs(): number {
    const sinceLimit = this.now() - this.lastRateLimitedAt;
    if (this.lastRateLimitedAt > 0 && sinceLimit < RATE_LIMIT_CALM_MS) {
      return Math.max(this.intervalMs, RATE_LIMIT_INTERVAL_MS);
    }
    return this.intervalMs;
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

      await this.evaluate(snapshot);

      this.schedule(this.nextIntervalMs());
      return snapshot;
    } catch (e) {
      this.consecutiveFailures += 1;
      const rateLimited = e instanceof UsageError && e.code === 'rate_limited';
      if (rateLimited) this.lastRateLimitedAt = this.now();
      const { message, willRetry } = this.classify(e);
      this.emit('error', e instanceof Error ? e : new Error(String(e)), message, willRetry);

      if (willRetry) {
        const retryAfter = e instanceof UsageError ? e.retryAfterSec : undefined;
        this.schedule(this.backoffMs(retryAfter, rateLimited));
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
