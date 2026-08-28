import { describe, expect, it } from 'vitest';
import { PixelGrid } from '../src/shared/pixel/grid.js';

const RED = '#ff0000';
const BLUE = '#0000ff';

function countPainted(g: PixelGrid): number {
  return g.data.filter((p) => p !== null).length;
}

describe('PixelGrid', () => {
  it('새 그리드는 전부 투명하다', () => {
    expect(countPainted(new PixelGrid(8, 8))).toBe(0);
  });

  it('범위 밖 쓰기는 무시한다', () => {
    const g = new PixelGrid(4, 4);
    g.set(-1, 0, RED);
    g.set(0, 99, RED);
    expect(countPainted(g)).toBe(0);
  });

  it('rect가 정확한 넓이를 칠한다', () => {
    const g = new PixelGrid(10, 10);
    g.rect(2, 3, 4, 5, RED);
    expect(countPainted(g)).toBe(20);
    expect(g.get(2, 3)).toBe(RED);
    expect(g.get(5, 7)).toBe(RED);
    expect(g.get(6, 8)).toBeNull();
  });

  it('circle은 중심 대칭이다', () => {
    const g = new PixelGrid(21, 21);
    g.circle(10, 10, 6, RED);
    for (let y = 0; y < 21; y++) {
      for (let x = 0; x < 21; x++) {
        expect(g.get(x, y)).toBe(g.get(20 - x, y));
        expect(g.get(x, y)).toBe(g.get(x, 20 - y));
      }
    }
  });

  it('setIfPainted는 이미 칠해진 곳만 덧칠한다', () => {
    const g = new PixelGrid(4, 4);
    g.set(1, 1, RED);
    g.setIfPainted(1, 1, BLUE);
    g.setIfPainted(2, 2, BLUE);
    expect(g.get(1, 1)).toBe(BLUE);
    expect(g.get(2, 2)).toBeNull();
  });

  it('triangle은 세 꼭짓점을 모두 포함한다', () => {
    const g = new PixelGrid(20, 20);
    g.triangle(2, 2, 16, 4, 8, 17, RED);
    expect(g.get(2, 2)).toBe(RED);
    expect(g.get(8, 8)).toBe(RED);
    // 삼각형 바깥 모서리는 비어 있어야 한다.
    expect(g.get(19, 19)).toBeNull();
  });

  it('퇴화 삼각형은 아무것도 그리지 않는다', () => {
    const g = new PixelGrid(10, 10);
    g.triangle(1, 1, 5, 5, 9, 9, RED);
    expect(countPainted(g)).toBe(0);
  });

  it('outline은 칠해진 영역 바깥에만 그린다', () => {
    const g = new PixelGrid(9, 9);
    g.rect(3, 3, 3, 3, RED);
    g.outline(BLUE);
    expect(g.get(4, 4)).toBe(RED);
    expect(g.get(2, 4)).toBe(BLUE);
    expect(g.get(4, 2)).toBe(BLUE);
    // 대각선 이웃만으로는 테두리가 생기지 않는다.
    expect(g.get(2, 2)).toBeNull();
  });

  it('translated는 내용을 옮기고 원본을 건드리지 않는다', () => {
    const g = new PixelGrid(8, 8);
    g.set(1, 1, RED);
    const moved = g.translated(2, 3);
    expect(moved.get(3, 4)).toBe(RED);
    expect(moved.get(1, 1)).toBeNull();
    expect(g.get(1, 1)).toBe(RED);
  });

  it('clone은 독립적인 복사본을 만든다', () => {
    const g = new PixelGrid(4, 4);
    g.set(0, 0, RED);
    const c = g.clone();
    c.set(0, 0, BLUE);
    expect(g.get(0, 0)).toBe(RED);
  });

  it('toRGBA는 색을 바이트로 바꾸고 투명은 알파 0으로 둔다', () => {
    const g = new PixelGrid(2, 1);
    g.set(0, 0, '#d97757');
    const rgba = g.toRGBA();
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([0xd9, 0x77, 0x57, 255]);
    expect(rgba[7]).toBe(0);
  });
});
