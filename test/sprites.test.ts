import { describe, expect, it } from 'vitest';
import { ALL_EXPRESSIONS, ANIMATIONS, buildFrame, SPRITE_SIZE } from '../src/shared/character/sprites.js';
import { CharacterAnimator } from '../src/shared/character/animator.js';

function paintedCount(expr: (typeof ALL_EXPRESSIONS)[number], tick = 0): number {
  return buildFrame({ expression: expr, tick }).data.filter((p) => p !== null).length;
}

describe('buildFrame', () => {
  it.each(ALL_EXPRESSIONS)('%s 표정이 그려진다', (expr) => {
    const g = buildFrame({ expression: expr });
    expect(g.width).toBe(SPRITE_SIZE);
    expect(g.height).toBe(SPRITE_SIZE);
    // 캔버스의 10% 이상은 칠해져야 캐릭터로 보인다.
    expect(paintedCount(expr)).toBeGreaterThan(SPRITE_SIZE * SPRITE_SIZE * 0.1);
  });

  it('같은 입력이면 같은 결과가 나온다', () => {
    const a = buildFrame({ expression: 'idle', tick: 3 });
    const b = buildFrame({ expression: 'idle', tick: 3 });
    expect(a.data).toEqual(b.data);
  });

  it('tick이 다르면 프레임이 달라진다', () => {
    const a = buildFrame({ expression: 'panic', tick: 0 });
    const b = buildFrame({ expression: 'panic', tick: 1 });
    expect(a.data).not.toEqual(b.data);
  });

  it('표정이 다르면 그림이 달라진다', () => {
    const idle = buildFrame({ expression: 'idle', tick: 0 });
    const panic = buildFrame({ expression: 'panic', tick: 0 });
    expect(idle.data).not.toEqual(panic.data);
  });

  it('실루엣이 캔버스를 벗어나지 않는다', () => {
    for (const expr of ALL_EXPRESSIONS) {
      const g = buildFrame({ expression: expr, tick: 2 });
      for (let i = 0; i < SPRITE_SIZE; i++) {
        expect(g.get(i, 0)).toBeNull();
        expect(g.get(i, SPRITE_SIZE - 1)).toBeNull();
        expect(g.get(0, i)).toBeNull();
        expect(g.get(SPRITE_SIZE - 1, i)).toBeNull();
      }
    }
  });

  it('모든 표정에 애니메이션 정의가 있다', () => {
    for (const expr of ALL_EXPRESSIONS) {
      const spec = ANIMATIONS[expr];
      expect(spec.ticks.length).toBeGreaterThan(0);
      expect(spec.frameMs).toBeGreaterThan(0);
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
    a.setExpression('talk');
    const first = a.currentFrame().data.slice();
    a.advance(ANIMATIONS.talk.frameMs + 1);
    expect(a.currentFrame().data).not.toEqual(first);
  });

  it('루프 애니메이션은 처음으로 돌아온다', () => {
    const a = new CharacterAnimator(noBlink);
    a.setExpression('talk');
    const first = a.currentFrame().data.slice();
    const spec = ANIMATIONS.talk;
    a.advance(spec.frameMs * spec.ticks.length + 1);
    expect(a.currentFrame().data).toEqual(first);
  });

  it('큰 dt가 들어와도 죽지 않는다', () => {
    const a = new CharacterAnimator(noBlink);
    a.setExpression('idle');
    expect(() => a.advance(60_000)).not.toThrow();
    expect(a.currentFrame().width).toBe(SPRITE_SIZE);
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
    const before = a.currentFrame().data.slice();
    a.advance(1000);
    // panic은 루프 애니메이션이라 프레임은 바뀌지만, blink 프레임이면 안 된다.
    const blink = buildFrame({ expression: 'blink', tick: 0 });
    expect(a.currentFrame().data).not.toEqual(blink.data);
    expect(before.length).toBe(a.currentFrame().data.length);
  });

  it('같은 표정을 다시 지정해도 진행 중인 애니메이션을 유지한다', () => {
    const a = new CharacterAnimator(noBlink);
    a.setExpression('talk');
    a.advance(ANIMATIONS.talk.frameMs + 1);
    const mid = a.currentFrame().data.slice();
    a.setExpression('talk');
    expect(a.currentFrame().data).toEqual(mid);
  });
});
