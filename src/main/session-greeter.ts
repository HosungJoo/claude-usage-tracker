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
 * 여기서 가장 중요한 판단은 '언제 나서지 않을지'다. 세션을 여러 개 켜거나
 * 껐다 켜기를 반복하는 건 흔한 일인데, 그때마다 캐릭터가 튀어나오면
 * 이 앱은 방해물이 된다.
 */

/** 이 시간 안에 다시 세션이 시작되면 인사하지 않는다. */
export const GREET_COOLDOWN_MS = 90_000;

/**
 * SessionStart는 세션을 새로 켤 때만이 아니라 /clear 나 컴팩션 후에도
 * 발생한다. 사용자가 '시작했다'고 느끼는 순간에만 인사한다.
 */
const GREETABLE_SOURCES = new Set(['startup', 'resume']);

export interface GreeterDeps {
  /** 지금 사용량을 다시 읽어온다. 없으면(오류 등) null. */
  refresh: () => Promise<UsageSnapshot | null>;
  /** 캐릭터를 띄운다. */
  present: (line: Line, snapshot: UsageSnapshot) => void;
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

    const since = this.now() - this.lastGreetAt;
    const withinCooldown = this.lastGreetAt > 0 && since < GREET_COOLDOWN_MS;

    const snapshot = await this.deps.refresh();
    if (!snapshot) return;

    // 인사를 건너뛰더라도 세션 시작 시점은 기록해 둔다 —
    // 종료 요약은 여전히 정확해야 한다.
    if (event.session_id) this.sessionStart.set(event.session_id, snapshot.fiveHour.percent);

    if (withinCooldown) return;
    this.lastGreetAt = this.now();
    this.deps.present(lineForGreeting(snapshot, snapshot.fetchedAt), snapshot);
  }

  private async onSessionEnd(event: HookEvent): Promise<void> {
    const id = event.session_id;
    if (!id) return;

    const startPercent = this.sessionStart.get(id);
    this.sessionStart.delete(id);
    if (startPercent === undefined) return;

    const snapshot = await this.deps.refresh();
    if (!snapshot) return;

    const line = lineForSessionEnd(snapshot, startPercent, snapshot.fetchedAt);
    if (!line) return;
    this.deps.present(line, snapshot);
  }

  /** 추적 중인 세션 수. 진단용. */
  get trackedSessions(): number {
    return this.sessionStart.size;
  }
}

/** present 구현체가 흔히 필요로 하는 게이지 변환. */
export { gaugesFromSnapshot };
