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

function render(expression: Expression, tick = 0): string[] {
  const g = buildFrame({ expression, tick });
  const rows: string[] = [];
  for (let y = 0; y < SPRITE_H; y++) {
    let row = '';
    for (let x = 0; x < SPRITE_W; x++) {
      const p = g.get(x, y);
      row += p === null ? '.' : p === PALETTE.eye ? 'o' : '#';
    }
    rows.push(row);
  }
  return rows;
}

function painted(expression: Expression, tick = 0): number {
  return buildFrame({ expression, tick }).data.filter((p) => p !== null).length;
}

describe('원본 재현', () => {
  it('idle이 원본 아트워크와 픽셀 단위로 같다', () => {
    expect(render('idle')).toEqual(SOURCE_IDLE);
  });

  it('캔버스는 16x10이다', () => {
    expect([SPRITE_W, SPRITE_H]).toEqual([16, 10]);
  });

  it('몸통은 코랄 단색이다 — 음영도 외곽선도 없다', () => {
    const colors = new Set(buildFrame({ expression: 'idle' }).data.filter((p) => p !== null));
    expect(colors).toEqual(new Set([PALETTE.body, PALETTE.eye]));
  });

  it('눈은 한 칸 폭 슬릿 둘이다', () => {
    const rows = render('idle');
    const eyeCols = new Set<number>();
    rows.forEach((r) => [...r].forEach((c, x) => c === 'o' && eyeCols.add(x)));
    expect([...eyeCols].sort((a, b) => a - b)).toEqual([4, 11]);
  });

  it('다리는 넷이다', () => {
    const legRow = render('idle')[9] as string;
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

  it('놀라면 눈이 커진다', () => {
    const eyes = (e: Expression): number => render(e).join('').split('o').length - 1;
    expect(eyes('panic')).toBeGreaterThan(eyes('idle'));
  });

  it('눈을 감으면 눈이 작아진다', () => {
    const eyes = (e: Expression): number => render(e).join('').split('o').length - 1;
    expect(eyes('blink')).toBeLessThan(eyes('idle'));
  });

  it('인사할 때 한쪽 팔만 올라간다', () => {
    const rows = render('wave', 0);
    // 왼쪽 팔은 제자리(4행), 오른쪽 팔은 위로.
    expect(rows[4]?.[0]).toBe('#');
    expect(rows[1]?.[15]).toBe('#');
    expect(rows[1]?.[0]).toBe('.');
  });

  it('놀라면 두 팔이 다 올라간다', () => {
    const rows = render('panic', 0);
    expect(rows[1]?.[0]).toBe('#');
    expect(rows[1]?.[15]).toBe('#');
  });

  it('걱정하면 팔이 내려간다', () => {
    const rows = render('worry');
    expect(rows[6]?.[0]).toBe('#');
    expect(rows[4]?.[0]).toBe('.');
  });

  it('팔이 캔버스를 벗어나지 않는다', () => {
    for (const expr of ALL_EXPRESSIONS) {
      for (const tick of ANIMATIONS[expr].ticks) {
        const g = buildFrame({ expression: expr, tick });
        // 잘린 팔은 한 줄짜리 흔적으로 남는다. 두 줄이 온전히 있어야 한다.
        const leftRows = [...Array(SPRITE_H).keys()].filter((y) => g.get(0, y) !== null);
        expect(leftRows.length, `${expr}:${tick}`).toBe(2);
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
