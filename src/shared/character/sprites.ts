import { PixelGrid } from '../pixel/grid.js';
import { PALETTE } from './palette.js';

/**
 * Claw'd — Claude Code의 마스코트.
 *
 * 몸은 원본 아트워크에서 픽셀 단위로 그대로 옮겼다. 16×10, 코랄 단색,
 * 외곽선 없음. 캔버스가 20×14인 것은 몸이 커서가 아니라 **액세서리 자리**
 * 때문이다 — 머리 위 느낌표, 옆으로 흐르는 땀, 기절했을 때 도는 표시.
 *
 * 원본 몸통 격자:
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

/**
 * 캔버스. 몸통(16×10)보다 넉넉한 것은 액세서리 자리 때문이다.
 *
 * 좌우 여백이 네 칸씩인 이유: 몸이 떨릴 때 한 칸 움직이고, 땀방울이 두 칸을
 * 쓴다. 여백이 모자라면 물방울이 팔 픽셀을 덮어 실루엣이 파인다 — 단색
 * 캐릭터라 한 칸만 지워져도 곧바로 눈에 띈다.
 */
export const SPRITE_W = 24;
export const SPRITE_H = 16;

/**
 * 몸통이 놓이는 자리.
 *
 * 위로 다섯 줄을 비워 둔 것은 느낌표 때문이다 — 막대 두 칸, 빈 칸, 점 한 칸,
 * 그리고 머리와의 간격 한 칸. 마지막 한 줄이 없으면 점이 머리에 붙어서
 * 느낌표가 아니라 머리에 난 혹처럼 보인다.
 */
const BODY_X = 4;
const BODY_Y = 5;

/** 이하 좌표는 모두 몸통 기준(body-local)이다. */
const HEAD_X = 2;
const HEAD_W = 12;
const HEAD_H = 8;

const ARM_W = 2;
const ARM_H = 2;
const ARM_REST_Y = 4;

const LEG_COLS = [3, 5, 10, 12] as const;
const LEG_TOP = 8;
const LEG_H = 2;

/** 눈의 중심 열. 원본에서 뽑은 값. */
const EYE_COLS = [4, 11] as const;

export type Expression =
  | 'idle' // 평온
  | 'blink' // 눈 감음
  | 'happy' // 여유 — 눈이 ^^ 로 휜다
  | 'talk' // 말하는 중
  | 'wave' // 등장 인사 — 한쪽 팔을 흔든다
  | 'worry' // 주의 — 눈이 처지고 식은땀 한 방울
  | 'alert' // 경고 — 머리 위 느낌표, 눈이 커진다
  | 'panic' // 위험 — 두 팔 번쩍, 땀 두 방울, 몸이 떨린다
  | 'faint'; // 한도 소진 — 눈이 ×, 주저앉는다

export interface FrameOptions {
  expression: Expression;
  /** 0부터 증가하는 프레임 번호. */
  tick?: number;
}

/* ------------------------------------------------------------------ */
/* 눈                                                                  */
/* ------------------------------------------------------------------ */

type EyeShape =
  /** 원본의 세로 슬릿. 높이로 감정을 나타낸다. */
  | { kind: 'slit'; top: number; height: number }
  /** ^^ — 위로 휜 눈. 웃는 인상. */
  | { kind: 'caret'; top: number }
  /** 흰자 + 눈동자. 놀랐을 때만 쓴다. */
  | { kind: 'wide'; top: number; height: number }
  /** ×× — 기절. */
  | { kind: 'cross'; top: number };

function eyeShapeFor(expression: Expression): EyeShape {
  switch (expression) {
    case 'blink':
      return { kind: 'slit', top: 3, height: 1 };
    case 'happy':
      return { kind: 'caret', top: 2 };
    case 'worry':
      // 한 줄 아래로 처진다.
      return { kind: 'slit', top: 3, height: 2 };
    case 'alert':
      return { kind: 'wide', top: 2, height: 3 };
    case 'panic':
      return { kind: 'wide', top: 1, height: 4 };
    case 'faint':
      return { kind: 'cross', top: 2 };
    default:
      return { kind: 'slit', top: 2, height: 2 };
  }
}

function drawEye(g: PixelGrid, ox: number, oy: number, col: number, shape: EyeShape): void {
  const x = ox + col;
  switch (shape.kind) {
    case 'slit':
      g.rect(x, oy + shape.top, 1, shape.height, PALETTE.eye);
      return;

    case 'caret':
      // 가운데가 솟은 세 칸. 저해상도에서 웃음을 나타내는 가장 짧은 형태다.
      g.set(x - 1, oy + shape.top + 1, PALETTE.eye);
      g.set(x, oy + shape.top, PALETTE.eye);
      g.set(x + 1, oy + shape.top + 1, PALETTE.eye);
      return;

    case 'wide': {
      // 흰자를 깔고 눈동자를 맨 아래에 붙인다. 가운데에 두면 흰자가 위아래로
      // 갈려서 '눈을 감았는데 흰자가 보이는' 이상한 얼굴이 된다.
      g.rect(x - 1, oy + shape.top, 2, shape.height, PALETTE.eyeWhite);
      g.rect(x - 1, oy + shape.top + shape.height - 1, 2, 1, PALETTE.eye);
      return;
    }

    case 'cross': {
      const t = oy + shape.top;
      g.set(x - 1, t, PALETTE.eye);
      g.set(x + 1, t, PALETTE.eye);
      g.set(x, t + 1, PALETTE.eye);
      g.set(x - 1, t + 2, PALETTE.eye);
      g.set(x + 1, t + 2, PALETTE.eye);
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* 자세                                                                */
/* ------------------------------------------------------------------ */

/** 왼팔·오른팔이 기본 위치에서 몇 칸 벗어나는지. 음수가 위쪽이다. */
function armOffsets(expression: Expression, tick: number): [number, number] {
  switch (expression) {
    case 'wave':
      // 오른팔만 흔든다. 두 프레임을 오가는 게 이 해상도에서 가장 또렷하다.
      return [0, tick % 2 === 0 ? -3 : -1];
    case 'panic':
      return tick % 2 === 0 ? [-3, -3] : [-2, -2];
    case 'alert':
      return [-1, -1];
    case 'worry':
      return [2, 2];
    case 'faint':
      // 힘이 빠져 축 늘어진다.
      return [3, 3];
    case 'happy':
      // 눈만으로는 blink와 구별되지 않는다 — 이 해상도에서 표정 하나에
      // 신호 하나로는 부족하다.
      return [-2, -2];
    case 'talk':
      // 두 팔을 번갈아 든다. 어느 프레임도 idle과 같지 않아야 한다.
      return tick % 2 === 0 ? [-1, 0] : [0, -1];
    default:
      return [0, 0];
  }
}

/** 기절하면 몸이 한 칸 주저앉는다. */
function bodyDrop(expression: Expression): number {
  return expression === 'faint' ? 1 : 0;
}

/** 좌우로 떠는 폭. 위험할 때만. */
function shake(expression: Expression, tick: number): number {
  if (expression !== 'panic') return 0;
  return tick % 2 === 0 ? -1 : 1;
}

/* ------------------------------------------------------------------ */
/* 몸통                                                                */
/* ------------------------------------------------------------------ */

function drawBody(g: PixelGrid, ox: number, oy: number): void {
  g.rect(ox + HEAD_X, oy, HEAD_W, HEAD_H, PALETTE.body);
}

function drawArms(g: PixelGrid, ox: number, oy: number, expression: Expression, tick: number): void {
  const [left, right] = armOffsets(expression, tick);
  g.rect(ox, oy + ARM_REST_Y + left, ARM_W, ARM_H, PALETTE.body);
  g.rect(ox + HEAD_X + HEAD_W, oy + ARM_REST_Y + right, ARM_W, ARM_H, PALETTE.body);
}

function drawLegs(g: PixelGrid, ox: number, oy: number, expression: Expression): void {
  if (expression === 'faint') {
    // 다리가 접혀 옆으로 삐져나온다. 주저앉은 실루엣.
    g.rect(ox + HEAD_X, oy + LEG_TOP, 2, 1, PALETTE.body);
    g.rect(ox + HEAD_X + HEAD_W - 2, oy + LEG_TOP, 2, 1, PALETTE.body);
    return;
  }
  for (const col of LEG_COLS) {
    g.rect(ox + col, oy + LEG_TOP, 1, LEG_H, PALETTE.body);
  }
}

/* ------------------------------------------------------------------ */
/* 액세서리                                                            */
/* ------------------------------------------------------------------ */

/** 몇 방울 흘릴지. */
function sweatCount(expression: Expression): number {
  if (expression === 'worry' || expression === 'alert') return 1;
  if (expression === 'panic') return 2;
  return 0;
}

/**
 * 식은땀. 몸 양옆을 타고 흘러내린다.
 *
 * 자리는 캔버스 맨 바깥 두 열로 고정한다. 머리나 팔 옆에 붙이면, 팔이
 * 올라가는 표정에서 몸통 픽셀을 덮어 실루엣이 파인다 — 단색 캐릭터라
 * 한 칸만 지워져도 곧바로 눈에 띈다.
 */
function drawSweat(g: PixelGrid, oy: number, count: number, tick: number): void {
  // 몸이 떨려도(±1) 닿지 않는 바깥 열.
  const drops = [
    { x: SPRITE_W - 2, wide: 1 },
    { x: 1, wide: -1 },
  ];
  for (let i = 0; i < count; i++) {
    const d = drops[i];
    if (!d) continue;
    const y = oy + ((tick + i) % 3);
    // 위가 뾰족하고 아래가 퍼지는 물방울.
    g.set(d.x, y, PALETTE.sweat);
    g.set(d.x, y + 1, PALETTE.sweat);
    g.set(d.x + d.wide, y + 1, PALETTE.sweat);
  }
}

/**
 * 머리 위 느낌표. 시선을 끄는 유일한 노란색이다.
 *
 * 위치는 고정하고 깜박임으로 주의를 끈다. 위아래로 움직이면 점이 머리에
 * 닿거나 캔버스를 벗어난다 — 네 줄뿐인 공간에서는 자리를 옮길 여유가 없다.
 */
function drawAlertMark(g: PixelGrid, ox: number, oy: number, tick: number): void {
  // 네 프레임에 한 번만 꺼진다. 절반씩 깜박이면 놓치기 쉽고 산만하다.
  if (tick % 4 === 3) return;
  const x = ox + HEAD_X + Math.floor(HEAD_W / 2) - 1;
  // 막대 두 칸, 빈 칸 하나, 점 하나. 사이를 비우지 않으면 그냥 막대가 된다.
  g.rect(x, oy - 5, 1, 2, PALETTE.alert);
  g.set(x, oy - 2, PALETTE.alert);
}

/**
 * 기절했을 때 머리 위를 도는 별.
 *
 * 두 개가 좌우로 자리를 바꾸며 도는 것처럼 보이게 한다. 한 칸짜리 점은
 * 먼지처럼 보여서, 십자 모양으로 세 칸씩 찍는다.
 */
function drawDizzy(g: PixelGrid, ox: number, oy: number, tick: number): void {
  const cx = ox + HEAD_X + Math.floor(HEAD_W / 2);
  // 좌우로 옮기면 두 별이 가까워져 부스러기처럼 뭉친다. 자리는 고정하고
  // 높이만 엇갈리게 해서 도는 느낌을 낸다.
  const up = tick % 2 === 0;
  const stars = [
    { x: cx - 5, y: up ? oy - 4 : oy - 3 },
    { x: cx + 4, y: up ? oy - 3 : oy - 4 },
  ];
  // 세 칸짜리 뾰족한 모양은 부스러기로 보인다. 십자로 찍어야 별이 된다.
  for (const s of stars) {
    g.set(s.x, s.y - 1, PALETTE.dizzy);
    g.set(s.x - 1, s.y, PALETTE.dizzy);
    g.set(s.x, s.y, PALETTE.dizzy);
    g.set(s.x + 1, s.y, PALETTE.dizzy);
    g.set(s.x, s.y + 1, PALETTE.dizzy);
  }
}

/* ------------------------------------------------------------------ */

/** 한 프레임을 그린다. */
export function buildFrame(options: FrameOptions): PixelGrid {
  const { expression, tick = 0 } = options;
  const g = new PixelGrid(SPRITE_W, SPRITE_H);

  const ox = BODY_X + shake(expression, tick);
  const oy = BODY_Y + bodyDrop(expression);

  drawBody(g, ox, oy);
  drawArms(g, ox, oy, expression, tick);
  drawLegs(g, ox, oy, expression);
  // 눈은 몸통 위에 뚫는다. 순서가 바뀌면 몸통이 눈을 덮는다.
  for (const col of EYE_COLS) drawEye(g, ox, oy, col, eyeShapeFor(expression));

  const sweat = sweatCount(expression);
  if (sweat > 0) drawSweat(g, oy, sweat, tick);
  if (expression === 'alert') drawAlertMark(g, ox, oy, tick);
  if (expression === 'faint') drawDizzy(g, ox, oy, tick);

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
  worry: { ticks: [0, 1, 2], frameMs: 320, loop: true },
  alert: { ticks: [0, 1, 2, 3], frameMs: 260, loop: true },
  panic: { ticks: [0, 1, 2], frameMs: 150, loop: true },
  faint: { ticks: [0, 1], frameMs: 380, loop: true },
};

export const ALL_EXPRESSIONS: Expression[] = [
  'idle',
  'blink',
  'happy',
  'talk',
  'wave',
  'worry',
  'alert',
  'panic',
  'faint',
];
