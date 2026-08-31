import { t } from '../shared/i18n/index.js';
import { expressionForSeverity, renderCharacter } from '../shared/character/render.js';
import type { Expression } from '../shared/character/sprites.js';
import type { UsageSnapshot } from '../core/types.js';

/**
 * 트레이 아이콘을 캐릭터에서 직접 만든다.
 *
 * 별도의 아이콘 파일을 두지 않는 이유: 캐릭터가 바뀌면 아이콘도 같이
 * 바뀌어야 하는데, 파일로 두면 그 동기화를 사람이 기억해야 한다.
 *
 * 트레이에서는 캐릭터가 아주 작게 보이므로, 오버레이에서 쓰는 표정 중
 * 실루엣 차이가 큰 것만 고른다 — 눈 슬릿 한 칸 차이는 트레이 크기에서
 * 보이지 않는다.
 */

/** 트레이가 기대하는 크기. 대부분의 데스크톱 환경이 22~24px를 쓴다. */
const TRAY_SIZE = 22;

/**
 * 캐릭터를 트레이가 기대하는 정사각형에 맞춰 그린다.
 *
 * 그리는 일 자체는 `renderCharacter`가 한다 — 상태 표시줄 말풍선도 같은
 * 그림을 쓰기 때문에, 한 곳에서만 굽는다.
 *
 * @param margin 가장자리에 남길 여백(px). 트레이는 이미 좁아서 0이지만,
 *   런처 아이콘은 아이콘끼리 붙어 보이지 않도록 조금 띄운다.
 */
export function renderTrayIcon(expression: Expression, size = TRAY_SIZE, margin = 0): Uint8Array {
  return renderCharacter(expression, size, size, margin);
}

/** 현재 사용량에 맞는 트레이 아이콘. */
export function trayIconFor(snapshot: UsageSnapshot | null, size = TRAY_SIZE): Uint8Array {
  if (!snapshot) return renderTrayIcon('idle', size);
  const worst = Math.max(snapshot.fiveHour.percent, snapshot.weekly.percent);
  return renderTrayIcon(expressionForSeverity(snapshot.severity, worst), size);
}

/** 트레이 툴팁 문구. 마우스를 올렸을 때만 보이는 보조 정보다. */
export function trayTooltip(snapshot: UsageSnapshot | null): string {
  if (!snapshot) return t().tray.tooltipIdle;
  const f = Math.round(snapshot.fiveHour.percent);
  const w = Math.round(snapshot.weekly.percent);
  return t().tray.tooltip(`${f}%`, `${w}%`);
}
