import { t } from '../shared/i18n/index.js';
import type { Severity, UsageSnapshot, WindowSnapshot } from './types.js';

/** 사람이 읽는 문자열로 바꾸는 함수들. CLI와 말풍선(M2)이 함께 쓴다. */

/** "2시간 14분" / "2h 14m" 처럼. 이미 지났으면 '곧'. */
export function formatRemaining(resetsAt: number | null, now: number = Date.now()): string {
  const f = t().format;
  if (resetsAt === null) return f.unknown;
  const ms = resetsAt - now;
  if (ms <= 0) return f.soon;

  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;

  if (days > 0) return f.days(days, hours);
  if (hours > 0) return f.hours(hours, mins);
  return f.minutes(mins);
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

export function severityLabel(severity: Severity): string {
  const s: Record<Severity, string> = t().severity;
  return s[severity];
}

/**
 * 창 이름 칸의 너비.
 *
 * 언어마다 이름 길이가 달라 고정 폭을 쓰면 영어에서 열이 어긋난다.
 * 이번에 출력할 이름들 중 가장 긴 것에 맞춘다.
 */
function labelWidth(labels: string[]): number {
  return Math.max(...labels.map((l) => l.length));
}

function windowLine(label: string, width: number, win: WindowSnapshot, now: number): string {
  const c = t();
  if (!win.available) return `  ${label.padEnd(width)}  ${c.cli.notProvided}`;
  return [
    `  ${label.padEnd(width)}`,
    gaugeBar(win.percent),
    formatPercent(win.percent).padStart(6),
    `· ${severityLabel(win.severity)}`,
    `· ${c.cli.resetsIn} ${formatRemaining(win.resetsAt, now)}`,
  ].join(' ');
}

/** CLI `--once` 출력. */
export function formatSnapshot(snapshot: UsageSnapshot, now: number = Date.now()): string {
  const c = t();
  const width = labelWidth([c.window.fiveHour, c.window.weekly]);

  const lines = [
    c.cli.heading,
    '',
    windowLine(c.window.fiveHour, width, snapshot.fiveHour, now),
    windowLine(c.window.weekly, width, snapshot.weekly, now),
  ];

  if (snapshot.scoped.length > 0) {
    lines.push('', `  ${c.cli.scopedHeading}`);
    const scopedWidth = labelWidth(snapshot.scoped.map((s) => s.label));
    for (const s of snapshot.scoped) {
      lines.push(
        `    ${s.label.padEnd(scopedWidth)} ${gaugeBar(s.percent, 12)} ${formatPercent(s.percent).padStart(6)}` +
          ` · ${c.cli.resetsIn} ${formatRemaining(s.resetsAt, now)}`,
      );
    }
  }

  lines.push('', `  ${c.cli.overall(severityLabel(snapshot.severity))}`);
  return lines.join('\n');
}
