import type { Expression } from './sprites.js';
import type { Severity, UsageSnapshot } from '../../core/types.js';
import { formatPercent, formatRemaining } from '../../core/format.js';
import type { ThresholdEvent, WindowKey } from '../../core/thresholds.js';

/**
 * 캐릭터가 무슨 표정으로 무슨 말을 할지.
 *
 * 대사와 표정을 한곳에 모아 둔다. 문구를 고치는 일이 렌더러 코드를
 * 건드리는 일이 되면 안 된다.
 */

export interface Line {
  expression: Expression;
  /** 말풍선 첫 줄. 짧게. */
  title: string;
  /** 둘째 줄. 숫자와 남은 시간. */
  detail: string;
  /** 이 대사를 몇 ms 띄워 둘지. */
  holdMs: number;
}

const WINDOW_LABEL: Record<WindowKey, string> = {
  fiveHour: '5시간',
  weekly: '주간',
};

/** 임계값별 표정. 50%는 가볍게, 100%는 다급하게. */
function expressionForThreshold(threshold: number, severity: Severity): Expression {
  if (threshold >= 100) return 'panic';
  if (threshold >= 90) return 'panic';
  if (threshold >= 70) return 'worry';
  return severity === 'normal' ? 'talk' : 'worry';
}

/** 임계값을 넘었을 때의 대사. */
export function lineForThreshold(event: ThresholdEvent, now: number = Date.now()): Line {
  const where = WINDOW_LABEL[event.window];
  const left = formatRemaining(event.resetsAt, now);
  const expression = expressionForThreshold(event.threshold, event.severity);

  if (event.threshold >= 100) {
    return {
      expression,
      title: `${where} 사용량을 다 썼어!`,
      detail: `${left} 뒤에 초기화돼`,
      holdMs: 9000,
    };
  }
  if (event.threshold >= 90) {
    return {
      expression,
      title: `${where} ${formatPercent(event.percent)}… 거의 다 왔어`,
      detail: `${left} 뒤 초기화 · 조금만 아껴줘`,
      holdMs: 8000,
    };
  }
  if (event.threshold >= 70) {
    return {
      expression,
      title: `${where} 사용량 ${formatPercent(event.percent)}`,
      detail: `${left} 뒤에 초기화돼`,
      holdMs: 7000,
    };
  }
  return {
    expression,
    title: `${where} 사용량 절반 넘었어`,
    detail: `${formatPercent(event.percent)} · ${left} 뒤 초기화`,
    holdMs: 6000,
  };
}

/** 세션을 시작할 때의 인사. M3에서 훅이 이 대사를 부른다. */
export function lineForGreeting(snapshot: UsageSnapshot, now: number = Date.now()): Line {
  const five = snapshot.fiveHour;
  const week = snapshot.weekly;
  const remainFive = Math.max(0, 100 - five.percent);

  const expression: Expression =
    snapshot.severity === 'critical' ? 'worry' : snapshot.severity === 'warning' ? 'talk' : 'wave';

  const title =
    snapshot.severity === 'critical'
      ? '오늘은 좀 아껴 쓰자'
      : `${formatPercent(remainFive)} 남았어. 시작하자!`;

  const detail = `5시간 ${formatPercent(five.percent)} · 주간 ${formatPercent(week.percent)} · ${formatRemaining(five.resetsAt, now)} 뒤 초기화`;

  return { expression, title, detail, holdMs: 7000 };
}

/** 사용자가 직접 "지금 확인"을 눌렀을 때. */
export function lineForManualCheck(snapshot: UsageSnapshot, now: number = Date.now()): Line {
  const expression: Expression =
    snapshot.severity === 'critical' ? 'panic' : snapshot.severity === 'warning' ? 'worry' : 'happy';

  return {
    expression,
    title: `5시간 ${formatPercent(snapshot.fiveHour.percent)} · 주간 ${formatPercent(snapshot.weekly.percent)}`,
    detail: `${formatRemaining(snapshot.fiveHour.resetsAt, now)} 뒤 5시간 한도 초기화`,
    holdMs: 6000,
  };
}

/**
 * 세션이 끝났을 때의 요약.
 *
 * 이번 세션 동안 사용량이 얼마나 늘었는지 알려준다. 변화가 미미하면
 * 굳이 방해할 이유가 없으므로 null을 돌려주고, 호출부는 아무것도 하지 않는다.
 */
export function lineForSessionEnd(
  snapshot: UsageSnapshot,
  startFivePercent: number,
  now: number = Date.now(),
): Line | null {
  const delta = snapshot.fiveHour.percent - startFivePercent;
  // 1%p 미만은 알릴 가치가 없다.
  if (delta < 1) return null;

  const expression: Expression = snapshot.severity === 'critical' ? 'worry' : 'happy';

  return {
    expression,
    title: `이번 세션에 ${formatPercent(delta)} 썼어`,
    detail: `5시간 ${formatPercent(snapshot.fiveHour.percent)} · ${formatRemaining(snapshot.fiveHour.resetsAt, now)} 뒤 초기화`,
    holdMs: 5000,
  };
}
