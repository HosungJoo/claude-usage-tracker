import { gaugesFromSnapshot } from '../shared/ipc.js';
import {
  lineForGreeting,
  lineForSessionEnd,
  type Line,
} from '../shared/character/script.js';
import type { HookEvent } from '../hooks/hook-script.js';
import type { UsageSnapshot } from '../core/types.js';

/**
 * 훅 이벤트를 캐릭터 등장으로 바꾸는 곳.
 *
 * 여기서 가장 중요한 판단은 '언제 나서지 않을지'다. 한 세션이 /clear 나
 * 컴팩션으로 시작을 되풀이해 알려오는 건 흔한 일인데, 그때마다 캐릭터가
 * 튀어나오면 이 앱은 방해물이 된다. 반대로 처음 보는 세션은 사용자가
 * 직접 연 것이므로, 다른 인사 직후라도 인사한다.
 */

/**
 * 이 시간 안에 '같은' 세션이 다시 알려오면 인사하지 않는다.
 *
 * 처음 보는 세션에는 적용하지 않는다. 사용자가 정말로 새 세션을 연 순간은
 * 이 앱이 존재하는 이유이고, 그 순간까지 삼키면 남는 건 침묵뿐이다.
 */
export const GREET_COOLDOWN_MS = 90_000;

/**
 * 조회가 실패했을 때 대신 쓸 수 있는 스냅샷의 최대 나이.
 *
 * 사용량 API는 429를 자주 낸다. 그때마다 입을 다물면, 정작 사용자가
 * 세션을 여는 순간에만 조용해진다 — 이 앱이 존재하는 이유가 그 순간이다.
 * 몇 분 전 숫자라도 "아무 말 없음"보다 낫다. 문구는 조회 시각을 기준으로
 * 만들어지므로 남은 시간도 그때 기준으로 정확히 읽힌다.
 */
export const CACHED_GREET_MAX_AGE_MS = 10 * 60_000;

/**
 * SessionStart는 세션을 새로 켤 때만이 아니라 /clear 나 컴팩션 후에도
 * 발생한다. 사용자가 '시작했다'고 느끼는 순간에만 인사한다.
 */
const GREETABLE_SOURCES = new Set(['startup', 'resume']);

export interface GreeterDeps {
  /** 지금 사용량을 다시 읽어온다. 없으면(오류 등) null. */
  refresh: () => Promise<UsageSnapshot | null>;
  /**
   * 마지막으로 받아둔 사용량. 조회가 실패했을 때만 쓴다.
   * 주지 않으면 실패는 곧 침묵이 된다.
   */
  cached?: () => UsageSnapshot | null;
  /**
   * 캐릭터를 띄운다.
   * @param cwd 세션의 작업 디렉터리. 어느 창 옆에 띄울지 정하는 데 쓴다.
   */
  present: (line: Line, snapshot: UsageSnapshot, cwd: string | null) => void;
  now?: () => number;
}

export class SessionGreeter {
  private lastGreetAt = 0;
  /** 세션이 시작될 때의 5시간 사용량. 종료 요약에서 차이를 낸다. */
  private readonly sessionStart = new Map<string, number>();
  private readonly now: () => number;

  constructor(private readonly deps: GreeterDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  async handle(event: HookEvent): Promise<void> {
    switch (event.hook_event_name) {
      case 'SessionStart':
        await this.onSessionStart(event);
        return;
      case 'SessionEnd':
        await this.onSessionEnd(event);
        return;
      default:
        // 모르는 이벤트는 무시한다. 훅이 늘어나도 여기서 깨지지 않는다.
        return;
    }
  }

  private async onSessionStart(event: HookEvent): Promise<void> {
    if (event.source !== undefined && !GREETABLE_SOURCES.has(event.source)) return;

    // 아래에서 이 맵에 기록하고 나면 처음 보는 세션인지 알 수 없다.
    // 판단은 기록보다 먼저 해 둔다.
    const id = event.session_id;
    const isNewSession = id ? !this.sessionStart.has(id) : false;

    const since = this.now() - this.lastGreetAt;
    const withinCooldown = this.lastGreetAt > 0 && since < GREET_COOLDOWN_MS;

    const snapshot = await this.snapshot();
    if (!snapshot) return;

    // 인사를 건너뛰더라도 세션 시작 시점은 기록해 둔다 —
    // 종료 요약은 여전히 정확해야 한다.
    if (id) this.sessionStart.set(id, snapshot.fiveHour.percent);

    // 세션 id가 없으면 같은 세션인지 가릴 수 없다. 그때는 쿨다운을 지킨다.
    if (withinCooldown && !isNewSession) return;
    this.lastGreetAt = this.now();
    this.deps.present(lineForGreeting(snapshot, snapshot.fetchedAt), snapshot, event.cwd ?? null);
  }

  private async onSessionEnd(event: HookEvent): Promise<void> {
    const id = event.session_id;
    if (!id) return;

    const startPercent = this.sessionStart.get(id);
    this.sessionStart.delete(id);
    if (startPercent === undefined) return;

    const snapshot = await this.snapshot();
    if (!snapshot) return;

    const line = lineForSessionEnd(snapshot, startPercent, snapshot.fetchedAt);
    if (!line) return;
    this.deps.present(line, snapshot, event.cwd ?? null);
  }

  /**
   * 인사에 쓸 사용량. 조회가 안 되면 최근 것으로 대신한다.
   *
   * 너무 낡은 숫자는 오히려 거짓말이 되므로 나이에 상한을 둔다.
   */
  private async snapshot(): Promise<UsageSnapshot | null> {
    const fresh = await this.deps.refresh();
    if (fresh) return fresh;

    const cached = this.deps.cached?.() ?? null;
    if (!cached) return null;
    if (this.now() - cached.fetchedAt > CACHED_GREET_MAX_AGE_MS) return null;
    return cached;
  }

  /** 추적 중인 세션 수. 진단용. */
  get trackedSessions(): number {
    return this.sessionStart.size;
  }
}

/** present 구현체가 흔히 필요로 하는 게이지 변환. */
export { gaugesFromSnapshot };
