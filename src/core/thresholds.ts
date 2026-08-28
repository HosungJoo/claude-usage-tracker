import type { Severity, UsageSnapshot, WindowSnapshot } from './types.js';

/**
 * 임계값 엔진.
 *
 * 규칙:
 *  1. 각 윈도우(5시간/주간)마다 임계값을 넘는 순간 1회만 발화한다.
 *  2. `resets_at` 이 지나면 그 윈도우의 발화 이력을 지운다(재무장).
 *  3. 퍼센트가 내려갔다 다시 올라와도 재무장 전에는 다시 울리지 않는다.
 *  4. 한 번에 여러 임계값을 건너뛰었으면 가장 높은 것 하나만 발화한다.
 *     (2% → 95% 로 점프했을 때 50/70/90 을 연달아 띄우지 않기 위해.)
 */

export const DEFAULT_THRESHOLDS = [50, 70, 90, 100] as const;

export type WindowKey = 'fiveHour' | 'weekly';

/** 디스크에 저장되는 윈도우별 발화 이력. */
export interface WindowFireState {
  /** 이미 발화한 임계값들. */
  fired: number[];
  /** 이 이력이 속한 윈도우의 리셋 시각(epoch ms). 이 시각이 지나면 이력을 버린다. */
  resetsAt: number | null;
}

export interface ThresholdState {
  fiveHour: WindowFireState;
  weekly: WindowFireState;
}

export function emptyThresholdState(): ThresholdState {
  return {
    fiveHour: { fired: [], resetsAt: null },
    weekly: { fired: [], resetsAt: null },
  };
}

export interface ThresholdEvent {
  window: WindowKey;
  /** 발화한 임계값 (50/70/90/100). */
  threshold: number;
  /** 발화 시점의 실제 퍼센트. */
  percent: number;
  resetsAt: number | null;
  severity: Severity;
}

export interface EvaluateResult {
  events: ThresholdEvent[];
  /** 갱신된 상태. 호출자가 저장한다. */
  state: ThresholdState;
}

export interface EvaluateOptions {
  thresholds?: readonly number[];
  /** 재무장 판정 기준 시각. 기본은 스냅샷의 조회 시각. */
  now?: number;
}

/**
 * 이전 발화 이력이 아직 유효한지 판단한다.
 *
 * 리셋 시각이 지났거나, 서버가 알려준 리셋 시각 자체가 달라졌으면(= 새 윈도우가 시작됐으면)
 * 이력을 버리고 처음부터 다시 센다.
 */
function rearmIfNeeded(
  prev: WindowFireState,
  snap: WindowSnapshot,
  now: number,
): WindowFireState {
  if (prev.resetsAt !== null && now >= prev.resetsAt) {
    return { fired: [], resetsAt: snap.resetsAt };
  }
  if (prev.resetsAt !== null && snap.resetsAt !== null && snap.resetsAt !== prev.resetsAt) {
    return { fired: [], resetsAt: snap.resetsAt };
  }
  return { fired: [...prev.fired], resetsAt: snap.resetsAt ?? prev.resetsAt };
}

function evaluateWindow(
  key: WindowKey,
  snap: WindowSnapshot,
  prev: WindowFireState,
  thresholds: readonly number[],
  now: number,
): { event: ThresholdEvent | null; state: WindowFireState } {
  const state = rearmIfNeeded(prev, snap, now);

  // 서버가 이 윈도우를 안 내려주면 판단할 근거가 없다. 이력만 유지한다.
  if (!snap.available) return { event: null, state };

  const crossed = thresholds
    .filter((t) => snap.percent >= t && !state.fired.includes(t))
    .sort((a, b) => a - b);

  if (crossed.length === 0) return { event: null, state };

  // 건너뛴 임계값도 모두 발화 처리하되, 알림은 가장 높은 것 하나만 낸다.
  const highest = crossed[crossed.length - 1] as number;
  const nextState: WindowFireState = {
    fired: [...state.fired, ...crossed].sort((a, b) => a - b),
    resetsAt: state.resetsAt,
  };

  return {
    event: {
      window: key,
      threshold: highest,
      percent: snap.percent,
      resetsAt: snap.resetsAt,
      severity: snap.severity,
    },
    state: nextState,
  };
}

/** 스냅샷과 이전 상태를 받아 발화할 이벤트와 새 상태를 돌려준다. 순수 함수. */
export function evaluateThresholds(
  snapshot: UsageSnapshot,
  prev: ThresholdState,
  options: EvaluateOptions = {},
): EvaluateResult {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const now = options.now ?? snapshot.fetchedAt;

  const five = evaluateWindow('fiveHour', snapshot.fiveHour, prev.fiveHour, thresholds, now);
  const week = evaluateWindow('weekly', snapshot.weekly, prev.weekly, thresholds, now);

  const events: ThresholdEvent[] = [];
  // 주간 한도가 더 아프다. 둘 다 터지면 주간을 먼저 보여준다.
  if (week.event) events.push(week.event);
  if (five.event) events.push(five.event);

  return { events, state: { fiveHour: five.state, weekly: week.state } };
}
