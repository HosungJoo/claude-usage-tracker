import { PixelGrid } from '../pixel/grid.js';
import { PALETTE } from './palette.js';

/**
 * 픽셀 클로드 캐릭터.
 *
 * 형태는 Claude의 방사형 심볼에서 가져왔다 — 12개의 광선이 뻗은 몸통
 * 가운데에 얼굴이 있다. 광선은 장식이자 팔 역할을 해서, 손을 흔들거나
 * 놀라서 곤두서는 연출을 같은 부품으로 만들 수 있다.
 */

export const SPRITE_SIZE = 40;

/**
 * 비율은 모두 캔버스 크기 기준으로 잡는다. 한 곳만 고치면 전체가 따라온다.
 *
 * 몸통은 작게, 광선은 길게 — 클로드 심볼의 인상은 '가운데 점'이 아니라
 * '뻗어나가는 획'에서 온다. 몸통을 키우면 성게처럼 보인다.
 */
const CX = SPRITE_SIZE / 2 - 0.5;
const CY = SPRITE_SIZE / 2 - 0.5;
const BODY_R = SPRITE_SIZE * 0.255;
const RAY_INNER = SPRITE_SIZE * 0.13;
const RAY_OUTER = SPRITE_SIZE * 0.42;
/**
 * 광선이 아무리 길어져도 넘지 못하는 한계.
 *
 * 실루엣이 캔버스 끝에 닿으면 윤곽선이 잘려서, 그 방향만 테두리가 없는
 * 채로 렌더된다. 2.5px을 남겨 두면 어떤 표정에서도 그럴 일이 없다.
 */
const RAY_MAX = SPRITE_SIZE / 2 - 2.5;
const RAY_WIDTH = SPRITE_SIZE * 0.175;
const RAY_COUNT = 12;

/** 얼굴 배치. 몸통 반지름에 비례한다. */
const EYE_DX = BODY_R * 0.5;
const EYE_Y = CY - BODY_R * 0.16;
const MOUTH_Y = CY + BODY_R * 0.52;

export type Expression =
  | 'idle' // 평온
  | 'blink' // 눈 감음 (idle의 변주)
  | 'happy' // 여유 있을 때 보고
  | 'talk' // 말하는 중
  | 'wave' // 등장 인사
  | 'worry' // 주의
  | 'panic'; // 위험 / 한도 임박

export interface FrameOptions {
  expression: Expression;
  /** 0부터 증가하는 프레임 번호. 광선 흔들림 등 미세한 변화에 쓴다. */
  tick?: number;
}

/** 광선 12개. 표정에 따라 길이와 각도가 흔들린다. */
function drawRays(g: PixelGrid, expression: Expression, tick: number): void {
  for (let i = 0; i < RAY_COUNT; i++) {
    const base = (i / RAY_COUNT) * Math.PI * 2 - Math.PI / 2;

    let angle = base;
    let outer = RAY_OUTER;

    if (expression === 'panic') {
      // 놀라서 광선이 곤두선다. 방향마다 다른 위상으로 떨려야 자연스럽다.
      outer = RAY_OUTER + 1.4 * Math.sin(tick * 1.6 + i);
      angle = base + 0.09 * Math.sin(tick * 2.1 + i * 1.7);
    } else if (expression === 'worry') {
      outer = RAY_OUTER - 1.6;
    } else if (expression === 'wave') {
      // 오른쪽 위 광선 하나만 팔처럼 크게 흔든다.
      const isArm = i === 1;
      if (isArm) {
        outer = RAY_OUTER + 0.7;
        angle = base + 0.55 * Math.sin(tick * 0.9);
      }
    } else {
      // 평상시에도 아주 미세하게 숨쉬듯 움직인다.
      outer = RAY_OUTER + 0.7 * Math.sin(tick * 0.35 + i * 0.5);
    }

    g.ray(CX, CY, angle, RAY_INNER, Math.min(RAY_MAX, outer), RAY_WIDTH, PALETTE.base);
  }
}

/** 몸통 + 명암. 왼쪽 위에서 빛이 든다고 가정한다. */
function drawBody(g: PixelGrid): void {
  g.circle(CX, CY, BODY_R, PALETTE.base);

  // 아래쪽 그림자를 먼저 깔고, 위쪽 하이라이트를 덮는다.
  g.circle(CX + BODY_R * 0.16, CY + BODY_R * 0.24, BODY_R - 1.2, PALETTE.shadow);
  g.circle(CX, CY, BODY_R - 0.2, PALETTE.base);
  g.circle(CX - BODY_R * 0.2, CY - BODY_R * 0.24, BODY_R * 0.66, PALETTE.light);
  g.circle(CX - BODY_R * 0.32, CY - BODY_R * 0.38, BODY_R * 0.3, PALETTE.highlight);
}

interface EyeShape {
  /** 눈 중심. */
  y: number;
  rx: number;
  ry: number;
  /** 눈동자 오프셋. */
  px: number;
  py: number;
  /** 눈을 감았으면 선으로 그린다. */
  closed: boolean;
}

function eyeShapeFor(expression: Expression, tick: number): EyeShape {
  switch (expression) {
    case 'blink':
      return { y: EYE_Y, rx: 2.9, ry: 0.4, px: 0, py: 0, closed: true };
    case 'happy':
      return { y: EYE_Y, rx: 3.0, ry: 2.1, px: 0, py: -0.5, closed: false };
    case 'worry':
      return { y: EYE_Y + 0.4, rx: 2.8, ry: 2.8, px: 0, py: 0.7, closed: false };
    case 'panic':
      // 눈이 커지고 눈동자가 작아진다 — 놀란 표정의 핵심.
      return { y: EYE_Y - 0.4, rx: 3.6, ry: 3.9, px: 0, py: 0, closed: false };
    case 'talk':
      return { y: EYE_Y, rx: 3.0, ry: 3.0, px: 0.4 * Math.sin(tick * 0.5), py: 0, closed: false };
    default:
      return { y: EYE_Y, rx: 3.0, ry: 3.0, px: 0, py: 0, closed: false };
  }
}

function drawEyes(g: PixelGrid, expression: Expression, tick: number): void {
  const s = eyeShapeFor(expression, tick);
  const eyes = [CX - EYE_DX, CX + EYE_DX];

  for (const ex of eyes) {
    if (s.closed) {
      // 직선보다 아래로 볼록한 호가 '기분 좋게 감은 눈'으로 읽힌다.
      for (let dx = -3; dx <= 3; dx++) {
        g.set(Math.round(ex + dx), Math.round(s.y + Math.abs(dx) * 0.45), PALETTE.pupil);
      }
      continue;
    }
    g.ellipse(ex, s.y, s.rx, s.ry, PALETTE.eyeWhite);

    const pr = expression === 'panic' ? 1.3 : 1.5;
    // 눈동자는 눈 안에서 살짝 아래에 둔다. 위쪽 흰자가 보이면 순한 인상이 된다.
    const pupilY = s.y + s.py + s.ry * 0.18;
    g.ellipse(ex + s.px, pupilY, pr, pr, PALETTE.pupil);
    // 반사광 한 점. 이게 있고 없고로 캐릭터가 살아 보이는지가 갈린다.
    g.rect(Math.round(ex + s.px - 0.9), Math.round(pupilY - 1.1), 1, 1, PALETTE.eyeWhite);
  }

  if (expression === 'worry' || expression === 'panic') {
    // 눈썹을 안쪽으로 내려 걱정스러운 인상을 만든다.
    const dy = expression === 'panic' ? 5.6 : 5.2;
    g.line(CX - EYE_DX - 3, s.y - dy, CX - EYE_DX + 2, s.y - dy + 1.6, PALETTE.outline, 1);
    g.line(CX + EYE_DX + 3, s.y - dy, CX + EYE_DX - 2, s.y - dy + 1.6, PALETTE.outline, 1);
  }
}

function drawMouth(g: PixelGrid, expression: Expression, tick: number): void {
  const my = MOUTH_Y;
  switch (expression) {
    case 'happy':
    case 'wave': {
      // 화면 y는 아래로 증가하므로, 끝이 올라가려면 y를 빼야 한다.
      for (let dx = -3; dx <= 3; dx++) {
        g.set(Math.round(CX + dx), Math.round(my + 1 - dx * dx * 0.22), PALETTE.mouth);
      }
      break;
    }
    case 'talk': {
      // 두 프레임을 오가며 입이 열렸다 닫힌다.
      const open = tick % 2 === 0;
      if (open) {
        g.ellipse(CX, my, 2.3, 1.9, PALETTE.mouth);
        g.ellipse(CX, my + 0.8, 1.3, 0.7, PALETTE.tongue);
      } else {
        g.line(CX - 2.6, my, CX + 2.6, my, PALETTE.mouth, 1);
      }
      break;
    }
    case 'worry': {
      // 끝이 처진 입.
      for (let dx = -3; dx <= 3; dx++) {
        g.set(Math.round(CX + dx), Math.round(my - 1 + dx * dx * 0.22), PALETTE.mouth);
      }
      break;
    }
    case 'panic': {
      const wobble = tick % 2 === 0 ? 0 : 0.4;
      g.ellipse(CX, my + 0.3, 2.8 + wobble, 3.0 + wobble, PALETTE.mouth);
      g.ellipse(CX, my + 1.5, 1.5, 1.0, PALETTE.tongue);
      break;
    }
    case 'blink':
    case 'idle':
    default: {
      g.line(CX - 2.0, my, CX + 2.0, my, PALETTE.mouth, 1);
      break;
    }
  }
}

/** 양 볼. 위험할수록 진해진다. */
function drawBlush(g: PixelGrid, expression: Expression): void {
  if (expression !== 'panic' && expression !== 'happy' && expression !== 'wave') return;
  const color = expression === 'panic' ? PALETTE.danger : PALETTE.blush;
  for (const ex of [CX - BODY_R * 0.82, CX + BODY_R * 0.82]) {
    g.ellipse(ex, MOUTH_Y - 1.4, 2.0, 1.2, color);
  }
}

/** 한 프레임을 그린다. */
export function buildFrame(options: FrameOptions): PixelGrid {
  const { expression, tick = 0 } = options;
  const g = new PixelGrid(SPRITE_SIZE, SPRITE_SIZE);

  drawRays(g, expression, tick);
  drawBody(g);
  // 윤곽선은 얼굴을 올리기 전에 — 얼굴 요소까지 테두리가 생기면 지저분해진다.
  g.outline(PALETTE.outline);

  drawBlush(g, expression);
  drawEyes(g, expression, tick);
  drawMouth(g, expression, tick);

  return g;
}

/** 표정별 애니메이션 정의. 렌더러는 이 목록만 보고 프레임을 돌린다. */
export interface AnimationSpec {
  /** 각 프레임에 넘길 tick 값. */
  ticks: number[];
  /** 프레임당 유지 시간(ms). */
  frameMs: number;
  loop: boolean;
}

export const ANIMATIONS: Record<Expression, AnimationSpec> = {
  idle: { ticks: [0, 1, 2, 3, 4, 5, 6, 7], frameMs: 220, loop: true },
  blink: { ticks: [0], frameMs: 120, loop: false },
  happy: { ticks: [0, 1, 2, 3], frameMs: 220, loop: true },
  talk: { ticks: [0, 1], frameMs: 160, loop: true },
  wave: { ticks: [0, 1, 2, 3, 4, 5], frameMs: 120, loop: true },
  worry: { ticks: [0, 1], frameMs: 300, loop: true },
  panic: { ticks: [0, 1, 2, 3], frameMs: 100, loop: true },
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
