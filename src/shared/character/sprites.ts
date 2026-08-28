import { PixelGrid } from '../pixel/grid.js';
import { PALETTE } from './palette.js';

/**
 * Claw'd — Claude Code의 마스코트.
 *
 * 형태는 원본 아트워크에서 픽셀 단위로 그대로 옮겼다. 16×10 격자,
 * 코랄 단색, 외곽선 없음. 이 캐릭터의 인상은 단순함에서 나오므로
 * 음영이나 테두리를 더하지 않는다.
 *
 * 표정은 원본이 가진 부품만으로 만든다 — 눈 슬릿의 높이와 위치, 팔의
 * 각도. 입을 새로 그리지 않는 이유도 같다. 원본에 없는 것을 더하면
 * 그 순간 다른 캐릭터가 된다.
 *
 * 원본 격자:
 * ```
 *   ..############..   머리
 *   ..############..
 *   ..##o######o##..   눈
 *   ..##o######o##..
 *   ################   팔이 좌우로 뻗은 밴드
 *   ################
 *   ..############..
 *   ..############..
 *   ...#.#....#.#...   다리 넷
 *   ...#.#....#.#...
 * ```
 */

export const SPRITE_W = 16;
export const SPRITE_H = 10;

/** 몸통. 좌우 두 칸씩 비운 12칸 폭이 머리이자 몸이다. */
const BODY_X = 2;
const BODY_W = 12;
const BODY_TOP = 0;
const BODY_H = 8;

/** 팔. 몸통 밖으로 두 칸씩 뻗는다. 기본 위치는 몸통 위에서 네 번째 줄. */
const ARM_W = 2;
const ARM_H = 2;
const ARM_REST_Y = 4;

/** 다리. 몸통 아래 두 줄. */
const LEG_COLS = [3, 5, 10, 12] as const;
const LEG_TOP = 8;
const LEG_H = 2;

/** 눈. 한 칸 폭의 세로 슬릿 둘. */
const EYE_COLS = [4, 11] as const;

export type Expression =
  | 'idle' // 평온
  | 'blink' // 눈 감음
  | 'happy' // 여유 — 눈웃음
  | 'talk' // 말하는 중
  | 'wave' // 등장 인사 — 한쪽 팔을 흔든다
  | 'worry' // 주의 — 눈이 처지고 팔이 내려간다
  | 'panic'; // 위험 — 눈이 커지고 두 팔이 올라간다

export interface FrameOptions {
  expression: Expression;
  /** 0부터 증가하는 프레임 번호. */
  tick?: number;
}

interface EyeShape {
  /** 눈이 시작하는 줄. */
  top: number;
  /** 눈의 높이(칸). */
  height: number;
}

/**
 * 표정마다 눈의 높이와 위치만 바뀐다.
 *
 * 16×10에서 쓸 수 있는 것은 이 두 값뿐이다. 그래서 각 표정이 서로
 * 확실히 구별되도록 값을 겹치지 않게 골랐다.
 */
function eyeShapeFor(expression: Expression): EyeShape {
  switch (expression) {
    case 'blink':
      // 아래쪽 한 줄만 남긴다 — 눈을 감은 순간.
      return { top: 3, height: 1 };
    case 'happy':
      // 위쪽 한 줄만. 감은 눈이되 위치가 높아 웃는 인상이 된다.
      return { top: 2, height: 1 };
    case 'worry':
      // 한 줄 아래로 처진다.
      return { top: 3, height: 2 };
    case 'panic':
      // 위아래로 벌어져 놀란 눈.
      return { top: 1, height: 3 };
    default:
      return { top: 2, height: 2 };
  }
}

/** 왼팔·오른팔이 각각 몇 줄에 놓일지. 음수일수록 위로 올라간 것이다. */
function armOffsets(expression: Expression, tick: number): [number, number] {
  switch (expression) {
    case 'wave':
      // 오른팔만 위아래로 흔든다. 두 프레임을 오가는 게 저해상도에서
      // 가장 또렷하게 '흔든다'로 읽힌다.
      return [0, tick % 2 === 0 ? -3 : -1];
    case 'panic':
      // 두 팔을 번쩍. 프레임마다 한 칸씩 떨린다.
      return tick % 2 === 0 ? [-3, -3] : [-2, -2];
    case 'worry':
      // 축 처진다.
      return [2, 2];
    case 'happy':
      // 두 팔을 살짝 든다. 눈만으로는 blink와 구별되지 않는다 —
      // 이 해상도에서 표정 하나에 신호 하나로는 부족하다.
      return [-2, -2];
    case 'talk':
      // 두 팔을 번갈아 든다. 어느 프레임도 idle과 같지 않아야 한다 —
      // 같으면 말하기 시작한 순간에 아무 변화가 없다.
      return tick % 2 === 0 ? [-1, 0] : [0, -1];
    default:
      return [0, 0];
  }
}

function drawBody(g: PixelGrid): void {
  g.rect(BODY_X, BODY_TOP, BODY_W, BODY_H, PALETTE.body);
}

function drawArms(g: PixelGrid, expression: Expression, tick: number): void {
  const [left, right] = armOffsets(expression, tick);
  // 팔이 캔버스를 벗어나면 잘린 채 그려진다. 위아래로 가둔다.
  const clamp = (y: number): number => Math.max(0, Math.min(SPRITE_H - ARM_H, y));

  g.rect(0, clamp(ARM_REST_Y + left), ARM_W, ARM_H, PALETTE.body);
  g.rect(SPRITE_W - ARM_W, clamp(ARM_REST_Y + right), ARM_W, ARM_H, PALETTE.body);
}

function drawLegs(g: PixelGrid, expression: Expression, tick: number): void {
  // 놀랐을 때만 다리가 한 칸 오므라든다. 그 외에는 원본 그대로.
  const tuck = expression === 'panic' && tick % 2 === 1;
  for (const col of LEG_COLS) {
    g.rect(col, LEG_TOP, 1, tuck ? LEG_H - 1 : LEG_H, PALETTE.body);
  }
}

function drawEyes(g: PixelGrid, expression: Expression): void {
  const { top, height } = eyeShapeFor(expression);
  for (const col of EYE_COLS) {
    g.rect(col, top, 1, height, PALETTE.eye);
  }
}

/** 한 프레임을 그린다. */
export function buildFrame(options: FrameOptions): PixelGrid {
  const { expression, tick = 0 } = options;
  const g = new PixelGrid(SPRITE_W, SPRITE_H);

  drawBody(g);
  drawArms(g, expression, tick);
  drawLegs(g, expression, tick);
  // 눈은 몸통 위에 뚫는다. 순서가 바뀌면 몸통이 눈을 덮는다.
  drawEyes(g, expression);

  return g;
}

/** 표정별 애니메이션 정의. 렌더러는 이 목록만 보고 프레임을 돌린다. */
export interface AnimationSpec {
  ticks: number[];
  /** 프레임당 유지 시간(ms). */
  frameMs: number;
  loop: boolean;
}

export const ANIMATIONS: Record<Expression, AnimationSpec> = {
  idle: { ticks: [0], frameMs: 400, loop: false },
  blink: { ticks: [0], frameMs: 120, loop: false },
  happy: { ticks: [0], frameMs: 400, loop: false },
  talk: { ticks: [0, 1], frameMs: 220, loop: true },
  wave: { ticks: [0, 1], frameMs: 260, loop: true },
  worry: { ticks: [0], frameMs: 400, loop: false },
  panic: { ticks: [0, 1], frameMs: 160, loop: true },
};

export const ALL_EXPRESSIONS: Expression[] = [
  'idle',
  'blink',
  'happy',
  'talk',
  'wave',
  'worry',
  'panic',
];
