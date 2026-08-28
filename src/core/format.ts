import type { Severity, UsageSnapshot, WindowSnapshot } from './types.js';

/** 사람이 읽는 문자열로 바꾸는 함수들. CLI와 말풍선(M2)이 함께 쓴다. */

/** "2시간 14분", "3일 5시간" 처럼. 이미 지났으면 '곧'. */
export function formatRemaining(resetsAt: number | null, now: number = Date.now()): string {
  if (resetsAt === null) return '알 수 없음';
  const ms = resetsAt - now;
  if (ms <= 0) return '곧';

  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;

  if (days > 0) return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`;
  if (hours > 0) return mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
  return `${mins}분`;
}

/** 소수점 첫째 자리까지, 정수면 정수로. */
export function formatPercent(percent: number): string {
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(1)}%`;
}

/** 픽셀 게이지 바. CLI 출력과 말풍선의 시각 언어를 맞춘다. */
export function gaugeBar(percent: number, width = 20): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

const SEVERITY_LABEL: Record<Severity, string> = {
  normal: '여유',
  warning: '주의',
  critical: '위험',
};

export function severityLabel(severity: Severity): string {
  return SEVERITY_LABEL[severity];
}

function windowLine(label: string, win: WindowSnapshot, now: number): string {
  if (!win.available) return `  ${label.padEnd(6)}  (제공되지 않음)`;
  return [
    `  ${label.padEnd(6)}`,
    gaugeBar(win.percent),
    formatPercent(win.percent).padStart(6),
    `· ${severityLabel(win.severity)}`,
    `· 리셋까지 ${formatRemaining(win.resetsAt, now)}`,
  ].join(' ');
}

/** CLI `--once` 출력. */
export function formatSnapshot(snapshot: UsageSnapshot, now: number = Date.now()): string {
  const lines = [
    'Claude 사용량',
    '',
    windowLine('5시간', snapshot.fiveHour, now),
    windowLine('주간', snapshot.weekly, now),
  ];

  if (snapshot.scoped.length > 0) {
    lines.push('', '  모델별 주간');
    for (const s of snapshot.scoped) {
      lines.push(
        `    ${s.label.padEnd(10)} ${gaugeBar(s.percent, 12)} ${formatPercent(s.percent).padStart(6)}` +
          ` · 리셋까지 ${formatRemaining(s.resetsAt, now)}`,
      );
    }
  }

  lines.push('', `  종합: ${severityLabel(snapshot.severity)}`);
  return lines.join('\n');
}
