import { ANIMATIONS, buildFrame, type Expression } from './sprites.js';
import type { PixelGrid } from '../pixel/grid.js';

/**
 * 표정 애니메이션 재생기.
 *
 * 프레임을 미리 만들어 캐시한다. 표정 하나당 프레임이 몇 개뿐이라
 * 전부 캐시해도 부담이 없고, 매 프레임 도형을 다시 그리는 것보다
 * 훨씬 싸다 — 이 앱은 배경에서 종일 떠 있어야 한다.
 */

export interface AnimatorOptions {
  /** 대기 중 가끔 눈을 깜박인다. 0이면 끈다. */
  blinkEveryMs?: number;
  random?: () => number;
}

const DEFAULT_BLINK_MS = 4200;

export class CharacterAnimator {
  private readonly cache = new Map<string, PixelGrid>();
  private expression: Expression = 'idle';
  private frameIndex = 0;
  private elapsedInFrame = 0;
  private sinceBlink = 0;
  private blinkRemaining = 0;
  private readonly blinkEveryMs: number;
  private readonly random: () => number;

  constructor(options: AnimatorOptions = {}) {
    this.blinkEveryMs = options.blinkEveryMs ?? DEFAULT_BLINK_MS;
    this.random = options.random ?? Math.random;
  }

  private frameFor(expression: Expression, tick: number): PixelGrid {
    const key = `${expression}:${tick}`;
    let g = this.cache.get(key);
    if (!g) {
      g = buildFrame({ expression, tick });
      this.cache.set(key, g);
    }
    return g;
  }

  get current(): Expression {
    return this.expression;
  }

  /** 표정을 바꾼다. 같은 표정이면 진행 중인 애니메이션을 유지한다. */
  setExpression(expression: Expression): void {
    if (this.expression === expression) return;
    this.expression = expression;
    this.frameIndex = 0;
    this.elapsedInFrame = 0;
    this.blinkRemaining = 0;
  }

  /**
   * 시간을 진행시킨다.
   * @param dtMs 지난 프레임으로부터 경과한 밀리초.
   */
  advance(dtMs: number): void {
    // 깜박임은 '평온할 때'만. 놀라거나 말하는 중에 눈을 감으면 어색하다.
    const canBlink = this.blinkEveryMs > 0 && (this.expression === 'idle' || this.expression === 'happy');

    if (this.blinkRemaining > 0) {
      this.blinkRemaining -= dtMs;
      return;
    }

    if (canBlink) {
      this.sinceBlink += dtMs;
      if (this.sinceBlink >= this.blinkEveryMs) {
        this.sinceBlink = 0;
        // 다음 깜박임까지의 간격을 조금씩 흔들어 기계적으로 보이지 않게 한다.
        this.blinkRemaining = 90 + this.random() * 70;
        return;
      }
    }

    const spec = ANIMATIONS[this.expression];
    this.elapsedInFrame += dtMs;
    while (this.elapsedInFrame >= spec.frameMs) {
      this.elapsedInFrame -= spec.frameMs;
      const next = this.frameIndex + 1;
      this.frameIndex = next >= spec.ticks.length ? (spec.loop ? 0 : spec.ticks.length - 1) : next;
    }
  }

  /** 지금 그려야 할 프레임. */
  currentFrame(): PixelGrid {
    if (this.blinkRemaining > 0) return this.frameFor('blink', 0);
    const spec = ANIMATIONS[this.expression];
    const tick = spec.ticks[this.frameIndex] ?? 0;
    return this.frameFor(this.expression, tick);
  }
}
