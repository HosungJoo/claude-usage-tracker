import { PixelGrid } from '../pixel/grid.js';
import { encodeAPNG, encodePNG, type AnimationFrame } from '../pixel/png.js';
import { ANIMATIONS, buildFrame, SPRITE_H, SPRITE_W, type Expression } from './sprites.js';
import type { Severity } from '../../core/types.js';

/**
 * 캐릭터를 PNG 바이트로 굽는다.
 *
 * 캔버스가 없는 곳 — 트레이 아이콘, VS Code 상태 표시줄 말풍선 — 에서도
 * 같은 캐릭터를 보여주기 위한 것이다. 그림 파일을 따로 두지 않는 이유는
 * 하나다: 캐릭터가 바뀌면 그 파일들의 동기화를 사람이 기억해야 한다.
 *
 * 정수 배율만 쓴다. 소수 배율로 늘리면 픽셀 경계가 뭉개져서, 픽셀 아트가
 * 아니라 그냥 흐린 그림이 된다.
 */

/**
 * 사용량이 얼마나 급한지를 표정 하나로 옮긴다.
 *
 * 오버레이는 임계값마다 정해진 대사와 표정을 쓰지만, 트레이 아이콘과
 * 상태 표시줄 말풍선에는 대사가 없다 — 지금 숫자만 있다. 그 숫자를
 * 표정으로 바꾸는 규칙은 한 곳에만 둔다.
 */
export function expressionForSeverity(severity: Severity, percent: number): Expression {
  if (percent >= 100) return 'faint';
  if (severity === 'critical') return 'alert';
  if (severity === 'warning') return 'worry';
  return 'idle';
}

interface Cut {
  expression: Expression;
  tick: number;
  delayMs: number;
}

/** 눈 깜박임 한 번. 오래 서 있는 표정에 이것만 끼워도 살아 있어 보인다. */
const BLINK_MS = 140;
/** 깜박임 사이 간격. 애니메이터가 대기 중에 쓰는 값과 같다. */
const BLINK_EVERY_MS = 4200;

/**
 * 표정 하나를 움직이는 컷 목록으로 편다.
 *
 * 표정 대부분은 여러 틱을 도는 자체 애니메이션을 갖고 있다. 문제는 컷이
 * 하나뿐인 표정 — `idle`, `happy` — 인데, 그대로 두면 멈춘 그림이 된다.
 * 그래서 오버레이가 대기 중에 하는 것과 같은 일을 여기서도 한다: 가만히
 * 있다가 한 번 깜박인다.
 */
export function animationCuts(expression: Expression): Cut[] {
  const spec = ANIMATIONS[expression];
  if (spec.ticks.length > 1) {
    return spec.ticks.map((tick) => ({ expression, tick, delayMs: spec.frameMs }));
  }
  const tick = spec.ticks[0] ?? 0;
  return [
    { expression, tick, delayMs: BLINK_EVERY_MS },
    { expression: 'blink', tick: 0, delayMs: BLINK_MS },
  ];
}

/** 그려진 픽셀만 감싸는 상자. 여러 컷에 걸쳐 하나로 잡는다. */
interface Box {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

/**
 * 모든 컷을 한꺼번에 감싸는 상자를 구한다.
 *
 * 컷마다 따로 잘라내면 프레임이 바뀔 때마다 캐릭터가 자기 상자 안에서
 * 위아래로 튄다 — 느낌표가 뜨는 순간 몸이 아래로 밀려나는 식이다.
 * 상자를 하나로 두면 움직이는 것은 그리려던 것뿐이다.
 */
function unionBox(cuts: Cut[]): Box {
  let minX = SPRITE_W;
  let minY = SPRITE_H;
  let maxX = -1;
  let maxY = -1;
  for (const cut of cuts) {
    const frame = buildFrame({ expression: cut.expression, tick: cut.tick });
    for (let y = 0; y < SPRITE_H; y++) {
      for (let x = 0; x < SPRITE_W; x++) {
        if (frame.get(x, y) === null) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { minX, minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** 상자 하나를 기준으로 컷 하나를 주어진 크기의 RGBA로 옮긴다. */
function paint(cut: Cut, box: Box, width: number, height: number, margin: number): Uint8ClampedArray {
  // 여백을 뺀 안쪽 상자에 맞춘다. 여백이 커서 상자가 사라지면 무시한다 —
  // 아무것도 안 그리는 그림보다 여백 없는 그림이 낫다.
  const boxW = Math.max(1, width - margin * 2);
  const boxH = Math.max(1, height - margin * 2);
  const scale = Math.max(1, Math.floor(Math.min(boxW / box.w, boxH / box.h)));
  const offX = Math.floor((width - box.w * scale) / 2);
  const offY = Math.floor((height - box.h * scale) / 2);

  const frame = buildFrame({ expression: cut.expression, tick: cut.tick });
  const out = new PixelGrid(width, height);
  for (let y = 0; y < box.h; y++) {
    for (let x = 0; x < box.w; x++) {
      const p = frame.get(box.minX + x, box.minY + y);
      if (p === null) continue;
      out.rect(offX + x * scale, offY + y * scale, scale, scale, p);
    }
  }
  return out.toRGBA();
}

/**
 * 멈춘 캐릭터 한 컷.
 *
 * @param margin 가장자리에 남길 여백(px). 아이콘끼리 붙어 보이면 안 되는
 *   자리에서만 쓴다.
 */
export function renderCharacter(
  expression: Expression,
  width: number,
  height: number,
  margin = 0,
): Uint8Array {
  const cut: Cut = { expression, tick: 0, delayMs: 0 };
  return encodePNG(width, height, paint(cut, unionBox([cut]), width, height, margin));
}

/**
 * 움직이는 캐릭터. APNG 한 장으로 나온다.
 *
 * 캔버스도, 웹뷰도, 자바스크립트도 없는 자리 — 마크다운 이미지 한 줄 —
 * 에서 캐릭터를 살아 있게 하는 방법은 이것뿐이다.
 */
export function renderCharacterAnimation(
  expression: Expression,
  width: number,
  height: number,
  margin = 0,
): Uint8Array {
  const cuts = animationCuts(expression);
  const box = unionBox(cuts);
  const frames: AnimationFrame[] = cuts.map((cut) => ({
    rgba: paint(cut, box, width, height, margin),
    delayMs: cut.delayMs,
  }));
  return encodeAPNG(width, height, frames);
}
