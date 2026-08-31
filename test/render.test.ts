import { describe, expect, it } from 'vitest';
import {
  animationCuts,
  expressionForSeverity,
  renderCharacter,
  renderCharacterAnimation,
} from '../src/shared/character/render.js';
import { ANIMATIONS, type Expression } from '../src/shared/character/sprites.js';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** PNG 스트림에서 주어진 타입의 청크를 모두 찾아 데이터 부분만 돌려준다. */
function chunks(png: Uint8Array, type: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let off = 8; // 서명 다음부터
  while (off + 8 <= png.length) {
    const length = view.getUint32(off);
    const name = String.fromCharCode(...png.subarray(off + 4, off + 8));
    if (name === type) out.push(png.subarray(off + 8, off + 8 + length));
    off += 12 + length;
  }
  return out;
}

/** 청크 앞 4바이트를 부호 없는 32비트로 읽는다. 일련번호와 크기가 전부 여기 있다. */
function u32(chunk: Uint8Array, offset: number): number {
  return new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(offset);
}

describe('expressionForSeverity', () => {
  it('다 쓴 순간에는 기절한다', () => {
    expect(expressionForSeverity('critical', 100)).toBe('faint');
  });

  it('심각도를 그대로 표정으로 옮긴다', () => {
    expect(expressionForSeverity('critical', 92)).toBe('alert');
    expect(expressionForSeverity('warning', 72)).toBe('worry');
    expect(expressionForSeverity('normal', 12)).toBe('idle');
  });
});

describe('animationCuts', () => {
  it('여러 틱을 가진 표정은 그 틱을 그대로 돈다', () => {
    expect(animationCuts('alert').map((c) => c.tick)).toEqual(ANIMATIONS.alert.ticks);
  });

  it('컷이 하나뿐인 표정에는 깜박임을 끼워 넣는다', () => {
    // 그러지 않으면 말풍선 속 캐릭터가 멈춘 그림이 된다.
    const cuts = animationCuts('idle');
    expect(cuts).toHaveLength(2);
    expect(cuts[1]?.expression).toBe('blink');
  });
});

describe('renderCharacter', () => {
  it('PNG를 낸다', () => {
    expect([...renderCharacter('idle', 32, 32).subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  it('요청한 크기를 지킨다', () => {
    const ihdr = chunks(renderCharacter('idle', 48, 24), 'IHDR')[0] as Uint8Array;
    expect(u32(ihdr, 0)).toBe(48);
    expect(u32(ihdr, 4)).toBe(24);
  });
});

describe('renderCharacterAnimation', () => {
  const expressions: Expression[] = ['idle', 'worry', 'alert', 'faint'];

  it.each(expressions)('%s — 컷 수만큼 fcTL을 적는다', (expression) => {
    const png = renderCharacterAnimation(expression, 96, 64);
    const cuts = animationCuts(expression);

    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(chunks(png, 'fcTL')).toHaveLength(cuts.length);
    // 첫 컷은 IDAT로 나가고 나머지만 fdAT다 — APNG를 모르는 뷰어에게도
    // 정지 그림 한 장으로 보여야 하기 때문이다.
    expect(chunks(png, 'IDAT')).toHaveLength(1);
    expect(chunks(png, 'fdAT')).toHaveLength(cuts.length - 1);
  });

  it('무한 반복으로 적는다', () => {
    const actl = chunks(renderCharacterAnimation('alert', 96, 64), 'acTL')[0] as Uint8Array;
    expect(u32(actl, 0)).toBe(animationCuts('alert').length);
    expect(u32(actl, 4)).toBe(0);
  });

  it('일련번호는 fcTL·fdAT를 통틀어 끊기지 않는다', () => {
    // 하나라도 건너뛰면 브라우저는 APNG 전체를 버리고 첫 컷만 보여준다.
    const png = renderCharacterAnimation('worry', 96, 64);
    const seqs = [...chunks(png, 'fcTL'), ...chunks(png, 'fdAT')]
      .map((c) => u32(c, 0))
      .sort((a, b) => a - b);
    expect(seqs).toEqual(seqs.map((_, i) => i));
  });

  it('모든 컷이 같은 상자를 쓴다 — 프레임이 바뀌어도 몸이 튀지 않는다', () => {
    // 컷마다 따로 잘라내면 느낌표가 뜨는 순간 몸이 아래로 밀린다.
    for (const fctl of chunks(renderCharacterAnimation('alert', 96, 64), 'fcTL')) {
      expect(u32(fctl, 4)).toBe(96); // width
      expect(u32(fctl, 8)).toBe(64); // height
      expect(u32(fctl, 12)).toBe(0); // x_offset
      expect(u32(fctl, 16)).toBe(0); // y_offset
    }
  });
});
