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

/**
 * 임계값별 표정.
 *
 * 단계마다 새로운 신호가 하나씩 더해지도록 짰다 — 표정만 바뀌면 무엇이
 * 달라졌는지 알아채기 어렵다.
 *
 *   50%  talk   평소처럼 말한다
 *   70%  worry  눈이 처지고 식은땀이 흐른다
 *   90%  alert  머리 위에 느낌표가 뜨고 눈이 커진다
 *   100% faint  눈이 ×가 되고 주저앉는다
 */
function expressionForThreshold(threshold: number, severity: Severity): Expression {
  if (threshold >= 100) return 'faint';
  if (threshold >= 90) return 'alert';
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

  // 이미 위험한 상태에서 세션을 열면 인사보다 경고가 먼저다.
  const expression: Expression =
    snapshot.severity === 'critical' ? 'panic' : snapshot.severity === 'warning' ? 'worry' : 'wave';

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
