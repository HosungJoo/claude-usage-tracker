import { t } from '../shared/i18n/index.js';
import { PixelGrid } from '../shared/pixel/grid.js';
import { encodePNG } from '../shared/pixel/png.js';
import { buildFrame, SPRITE_H, SPRITE_W, type Expression } from '../shared/character/sprites.js';
import type { Severity, UsageSnapshot } from '../core/types.js';

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

function expressionForSeverity(severity: Severity, percent: number): Expression {
  if (percent >= 100) return 'faint';
  if (severity === 'critical') return 'alert';
  if (severity === 'warning') return 'worry';
  return 'idle';
}

/**
 * 캐릭터를 주어진 정사각형 크기에 맞춰 그린다.
 *
 * 정수 배율만 쓴다. 소수 배율로 늘리면 픽셀이 뭉개져서 트레이에서
 * 지저분한 얼룩으로 보인다.
 *
 * @param margin 가장자리에 남길 여백(px). 트레이는 이미 좁아서 0이지만,
 *   런처 아이콘은 아이콘끼리 붙어 보이지 않도록 조금 띄운다.
 */
export function renderTrayIcon(
  expression: Expression,
  size = TRAY_SIZE,
  margin = 0,
): Uint8Array {
  const frame = buildFrame({ expression, tick: 0 });

  // 실제로 칠해진 영역만 잘라낸다. 캔버스 여백까지 넣으면 캐릭터가 작아진다.
  let minX = SPRITE_W;
  let minY = SPRITE_H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < SPRITE_H; y++) {
    for (let x = 0; x < SPRITE_W; x++) {
      if (frame.get(x, y) === null) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;

  // 여백을 뺀 안쪽 상자에 맞춘다. 여백이 커서 상자가 사라지면 무시한다 —
  // 아무것도 안 그리는 아이콘보다 여백 없는 아이콘이 낫다.
  const box = Math.max(1, size - margin * 2);
  const scale = Math.max(1, Math.floor(Math.min(box / cropW, box / cropH)));
  const drawW = cropW * scale;
  const drawH = cropH * scale;
  const offX = Math.floor((size - drawW) / 2);
  const offY = Math.floor((size - drawH) / 2);

  const out = new PixelGrid(size, size);
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const p = frame.get(minX + x, minY + y);
      if (p === null) continue;
      out.rect(offX + x * scale, offY + y * scale, scale, scale, p);
    }
  }

  return encodePNG(size, size, out.toRGBA());
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
