import { describe, expect, it } from 'vitest';
import {
  ALL_EXPRESSIONS,
  ANIMATIONS,
  buildFrame,
  SPRITE_H,
  SPRITE_W,
  type Expression,
} from '../src/shared/character/sprites.js';
import { CharacterAnimator } from '../src/shared/character/animator.js';
import { PALETTE } from '../src/shared/character/palette.js';

/**
 * 원본 아트워크에서 픽셀 단위로 추출한 기본 자세.
 * `#` 몸통, `o` 눈, `.` 투명.
 *
 * 이 표가 곧 캐릭터의 정의다. 렌더링이 여기서 벗어나면 더 이상
 * Claw'd가 아니므로, 다른 어떤 테스트보다 이것이 먼저다.
 */
const SOURCE_IDLE = [
  '..############..',
  '..############..',
  '..##o######o##..',
  '..##o######o##..',
  '################',
  '################',
  '..############..',
  '..############..',
  '...#.#....#.#...',
  '...#.#....#.#...',
];

const GLYPH: Record<string, string> = {
  [PALETTE.body]: '#',
  [PALETTE.eye]: 'o',
  [PALETTE.eyeWhite]: 'W',
  [PALETTE.sweat]: '~',
  [PALETTE.alert]: '!',
  [PALETTE.dizzy]: '*',
};

const ACCESSORY = new Set([PALETTE.sweat, PALETTE.alert, PALETTE.dizzy]);
const CHARACTER = new Set([PALETTE.body, PALETTE.eye, PALETTE.eyeWhite]);

function render(expression: Expression, tick = 0): string[] {
  const g = buildFrame({ expression, tick });
  const rows: string[] = [];
  for (let y = 0; y < SPRITE_H; y++) {
    let row = '';
    for (let x = 0; x < SPRITE_W; x++) {
      const p = g.get(x, y);
      row += p === null ? '.' : (GLYPH[p] ?? '?');
    }
    rows.push(row);
  }
  return rows;
}

/** 몸통이 놓인 영역만 잘라낸다 — 원본 격자와 대조하기 위해. */
function renderBody(expression: Expression, tick = 0): string[] {
  return render(expression, tick)
    .slice(BODY_TOP, BODY_TOP + 10)
    .map((r) => r.slice(BODY_LEFT, BODY_LEFT + 16));
}

const BODY_LEFT = 4;
const BODY_TOP = 5;

function painted(expression: Expression, tick = 0): number {
  return buildFrame({ expression, tick }).data.filter((p) => p !== null).length;
}

describe('원본 재현', () => {
  it('idle이 원본 아트워크와 픽셀 단위로 같다', () => {
    expect(renderBody('idle')).toEqual(SOURCE_IDLE);
  });

  it('캔버스는 몸통보다 넓다 — 액세서리 자리', () => {
    expect(SPRITE_W).toBeGreaterThan(16);
    expect(SPRITE_H).toBeGreaterThan(10);
  });

  it('기본 표정에는 액세서리가 없다', () => {
    for (const expr of ['idle', 'blink', 'happy', 'talk', 'wave'] as Expression[]) {
      const colors = new Set(buildFrame({ expression: expr }).data.filter((p) => p !== null));
      for (const c of colors) expect(ACCESSORY.has(c as never)).toBe(false);
    }
  });

  it('몸통은 코랄 단색이다 — 음영도 외곽선도 없다', () => {
    const colors = new Set(buildFrame({ expression: 'idle' }).data.filter((p) => p !== null));
    expect(colors).toEqual(new Set([PALETTE.body, PALETTE.eye]));
  });

  it('눈은 한 칸 폭 슬릿 둘이다', () => {
    const eyeCols = new Set<number>();
    renderBody('idle').forEach((r) => [...r].forEach((c, x) => c === 'o' && eyeCols.add(x)));
    expect([...eyeCols].sort((a, b) => a - b)).toEqual([4, 11]);
  });

  it('다리는 넷이다', () => {
    const legRow = renderBody('idle')[9] as string;
    expect([...legRow].filter((c) => c === '#')).toHaveLength(4);
  });
});

describe('표정', () => {
  it.each(ALL_EXPRESSIONS)('%s 가 그려진다', (expr) => {
    const g = buildFrame({ expression: expr });
    expect(g.width).toBe(SPRITE_W);
    expect(g.height).toBe(SPRITE_H);
    expect(painted(expr)).toBeGreaterThan(60);
  });

  it('액세서리가 몸통 픽셀을 덮지 않는다', () => {
    // 단색 캐릭터라 한 칸만 지워져도 실루엣이 파여 보인다. 액세서리는
    // 몸에 닿지도 않아야 한다.
    for (const expr of ALL_EXPRESSIONS) {
      for (const tick of ANIMATIONS[expr].ticks) {
        const g = buildFrame({ expression: expr, tick });
        for (let y = 0; y < SPRITE_H; y++) {
          for (let x = 0; x < SPRITE_W; x++) {
            const p = g.get(x, y);
            if (p === null || !ACCESSORY.has(p as never)) continue;
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ] as const) {
              const q = g.get(x + dx, y + dy);
              expect(
                q === null || !CHARACTER.has(q as never),
                `${expr}:${tick} 액세서리(${x},${y})가 몸통에 닿는다`,
              ).toBe(true);
            }
          }
        }
      }
    }
  });

  it('어떤 표정에서도 캐릭터가 캔버스 끝에 닿지 않는다', () => {
    for (const expr of ALL_EXPRESSIONS) {
      for (const tick of ANIMATIONS[expr].ticks) {
        const g = buildFrame({ expression: expr, tick });
        for (let i = 0; i < Math.max(SPRITE_W, SPRITE_H); i++) {
          for (const p of [g.get(i, 0), g.get(i, SPRITE_H - 1), g.get(0, i), g.get(SPRITE_W - 1, i)]) {
            expect(p === null || !CHARACTER.has(p as never), `${expr}:${tick}`).toBe(true);
          }
        }
      }
    }
  });

  it('걱정하면 식은땀이 흐른다', () => {
    expect(render('worry').join('')).toContain('~');
    expect(render('idle').join('')).not.toContain('~');
  });

  it('경고 단계에는 머리 위에 느낌표가 뜬다', () => {
    expect(render('alert', 0).join('')).toContain('!');
  });

  it('한도를 다 쓰면 눈이 ×가 되고 별이 돈다', () => {
    const rows = render('faint');
    expect(rows.join('')).toContain('*');
    // × 는 한 눈에 다섯 칸을 쓴다 — 슬릿(두 칸)보다 많다.
    expect((rows.join('').match(/o/g) ?? []).length).toBeGreaterThan(4);
  });

  it('땀은 위험할수록 늘어난다', () => {
    const drops = (e: Expression): number => (render(e).join('').match(/~/g) ?? []).length;
    expect(drops('panic')).toBeGreaterThan(drops('worry'));
  });

  it('모든 표정에 눈이 있다', () => {
    for (const expr of ALL_EXPRESSIONS) {
      expect(render(expr).join('')).toContain('o');
    }
  });

  it('표정마다 서로 다른 그림이 나온다', () => {
    const seen = new Map<string, Expression>();
    for (const expr of ALL_EXPRESSIONS) {
      const key = render(expr).join('|');
      expect(seen.has(key), `${expr} 가 ${seen.get(key)} 와 구별되지 않는다`).toBe(false);
      seen.set(key, expr);
    }
  });

  /** 눈이 차지하는 넓이. 흰자도 눈이다 — 어두운 픽셀만 세면 안 된다. */
  function eyeArea(expression: Expression): number {
    return (render(expression).join('').match(/[oW]/g) ?? []).length;
  }

  it('놀라면 눈이 커진다', () => {
    expect(eyeArea('panic')).toBeGreaterThan(eyeArea('idle'));
    expect(eyeArea('alert')).toBeGreaterThan(eyeArea('idle'));
  });

  it('놀란 눈에는 흰자가 보인다', () => {
    expect(render('panic').join('')).toContain('W');
    expect(render('idle').join('')).not.toContain('W');
  });

  it('눈을 감으면 눈이 작아진다', () => {
    expect(eyeArea('blink')).toBeLessThan(eyeArea('idle'));
  });

  /**
   * 팔이 놓인 줄. 몸통 기준 좌표로 돌려준다.
   *
   * 열을 고정으로 잡으면 안 된다 — panic은 몸이 좌우로 떨려서 캔버스 안
   * 위치가 프레임마다 달라진다. 그림에서 가장 바깥 몸통 열을 직접 찾는다.
   */
  function armRows(expression: Expression, tick: number, side: 'left' | 'right'): number[] {
    const rows = render(expression, tick);
    const cols = [...Array(SPRITE_W).keys()].filter((x) => rows.some((r) => r[x] === '#'));
    const col = side === 'left' ? Math.min(...cols) : Math.max(...cols);
    const top = Math.min(...rows.flatMap((r, y) => ([...r].some((c) => c === '#') ? [y] : [])));
    return rows.flatMap((r, y) => (r[col] === '#' ? [y - top] : []));
  }

  it('인사할 때 한쪽 팔만 올라간다', () => {
    // 팔은 머리 옆을 따라 오르내린다. 기본 위치는 몸통 기준 4행.
    expect(Math.min(...armRows('wave', 0, 'right'))).toBeLessThan(4);
    expect(armRows('wave', 0, 'left')).toEqual([4, 5]);
  });

  it('놀라면 두 팔이 다 올라간다', () => {
    for (const side of ['left', 'right'] as const) {
      expect(Math.min(...armRows('panic', 0, side)), side).toBeLessThan(4);
    }
  });

  it('걱정하면 팔이 내려간다', () => {
    // 팔이 몸통 아래쪽으로 내려가 실루엣의 맨 아랫부분에 걸린다.
    const rows = armRows('worry', 0, 'left');
    expect(Math.min(...rows)).toBeGreaterThan(4);
  });

  it('팔은 어떤 표정에서도 두 줄이 온전하다', () => {
    for (const expr of ALL_EXPRESSIONS) {
      for (const tick of ANIMATIONS[expr].ticks) {
        for (const side of ['left', 'right'] as const) {
          // faint 는 팔과 다리가 겹치므로 두 줄보다 많을 수 있다.
          expect(armRows(expr, tick, side).length, `${expr}:${tick}:${side}`).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('같은 입력이면 같은 결과가 나온다', () => {
    expect(buildFrame({ expression: 'wave', tick: 1 }).data).toEqual(
      buildFrame({ expression: 'wave', tick: 1 }).data,
    );
  });

  it('모든 표정에 애니메이션 정의가 있다', () => {
    for (const expr of ALL_EXPRESSIONS) {
      expect(ANIMATIONS[expr].ticks.length).toBeGreaterThan(0);
      expect(ANIMATIONS[expr].frameMs).toBeGreaterThan(0);
    }
  });

  it('반복 애니메이션의 프레임은 실제로 달라야 한다', () => {
    for (const expr of ALL_EXPRESSIONS) {
      const spec = ANIMATIONS[expr];
      if (!spec.loop) continue;
      const frames = spec.ticks.map((t) => render(expr, t).join('|'));
      expect(new Set(frames).size, `${expr} 의 프레임이 모두 같다`).toBe(frames.length);
    }
  });
});

describe('CharacterAnimator', () => {
  const noBlink = { blinkEveryMs: 0 };

  it('기본 표정은 idle이다', () => {
    expect(new CharacterAnimator(noBlink).current).toBe('idle');
  });

  it('표정을 바꾸면 반영된다', () => {
    const a = new CharacterAnimator(noBlink);
    a.setExpression('panic');
    expect(a.current).toBe('panic');
  });

  it('시간이 흐르면 프레임이 넘어간다', () => {
    const a = new CharacterAnimator(noBlink);
    a.setExpression('wave');
    const first = a.currentFrame().data.slice();
    a.advance(ANIMATIONS.wave.frameMs + 1);
    expect(a.currentFrame().data).not.toEqual(first);
  });

  it('루프 애니메이션은 처음으로 돌아온다', () => {
    const a = new CharacterAnimator(noBlink);
    a.setExpression('wave');
    const first = a.currentFrame().data.slice();
    a.advance(ANIMATIONS.wave.frameMs * ANIMATIONS.wave.ticks.length + 1);
    expect(a.currentFrame().data).toEqual(first);
  });

  it('큰 dt가 들어와도 죽지 않는다', () => {
    const a = new CharacterAnimator(noBlink);
    expect(() => a.advance(60_000)).not.toThrow();
    expect(a.currentFrame().width).toBe(SPRITE_W);
  });

  it('idle에서는 가끔 눈을 감는다', () => {
    const a = new CharacterAnimator({ blinkEveryMs: 1000, random: () => 0 });
    const open = a.currentFrame().data.slice();
    a.advance(1000);
    expect(a.currentFrame().data).not.toEqual(open);
  });

  it('놀란 표정 중에는 깜박이지 않는다', () => {
    const a = new CharacterAnimator({ blinkEveryMs: 1000, random: () => 0 });
    a.setExpression('panic');
    a.advance(1000);
    expect(a.currentFrame().data).not.toEqual(buildFrame({ expression: 'blink' }).data);
  });

  it('같은 표정을 다시 지정해도 진행 중인 애니메이션을 유지한다', () => {
    const a = new CharacterAnimator(noBlink);
    a.setExpression('wave');
    a.advance(ANIMATIONS.wave.frameMs + 1);
    const mid = a.currentFrame().data.slice();
    a.setExpression('wave');
    expect(a.currentFrame().data).toEqual(mid);
  });
});
