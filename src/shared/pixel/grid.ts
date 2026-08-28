/**
 * 아주 작은 픽셀 그리기 도구.
 *
 * 캐릭터를 이미지 파일이 아니라 코드로 그린다. 픽셀 단위 도형을
 * 코드로 합성하면 표정·포즈를 매개변수로 만들 수 있어서, 프레임을 하나
 * 추가할 때마다 이미지를 다시 그릴 필요가 없다.
 */

/** 투명은 null. 그 외에는 '#rrggbb'. */
export type Pixel = string | null;

export class PixelGrid {
  readonly data: Pixel[];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Array<Pixel>(width * height).fill(null);
  }

  private idx(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Pixel {
    return this.inBounds(x, y) ? (this.data[this.idx(x, y)] ?? null) : null;
  }

  set(x: number, y: number, color: Pixel): void {
    if (!this.inBounds(x, y)) return;
    this.data[this.idx(x, y)] = color;
  }

  /** 이미 무언가 칠해진 자리에만 덧칠한다. 실루엣 밖으로 삐져나가지 않게. */
  setIfPainted(x: number, y: number, color: Pixel): void {
    if (this.get(x, y) !== null) this.set(x, y, color);
  }

  rect(x: number, y: number, w: number, h: number, color: Pixel): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, color);
    }
  }

  /**
   * 채워진 원. 픽셀 아트에서는 수학적 원보다 반 픽셀 밀어 그린 쪽이
   * 훨씬 동그랗게 보인다 — 그래서 중심을 셀 경계가 아니라 셀 중앙에 둔다.
   */
  circle(cx: number, cy: number, r: number, color: Pixel): void {
    const r2 = (r + 0.5) * (r + 0.5);
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.set(x, y, color);
      }
    }
  }

  /** 타원. 눈·입처럼 가로세로 비율이 다른 요소에 쓴다. */
  ellipse(cx: number, cy: number, rx: number, ry: number, color: Pixel): void {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = (x - cx) / (rx + 0.5);
        const dy = (y - cy) / (ry + 0.5);
        if (dx * dx + dy * dy <= 1) this.set(x, y, color);
      }
    }
  }

  /** 두께가 있는 선. 브레젠험 대신 단순 보간 — 짧은 선만 그리므로 충분하다. */
  line(x0: number, y0: number, x1: number, y1: number, color: Pixel, thickness = 1): void {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
    const half = (thickness - 1) / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round(x0 + (x1 - x0) * t);
      const y = Math.round(y0 + (y1 - y0) * t);
      if (thickness <= 1) {
        this.set(x, y, color);
      } else {
        for (let dy = -half; dy <= half; dy++) {
          for (let dx = -half; dx <= half; dx++) {
            this.set(Math.round(x + dx), Math.round(y + dy), color);
          }
        }
      }
    }
  }

  /** 삼각형 채우기. 무게중심 좌표로 판정해 가장자리가 깔끔하게 떨어진다. */
  triangle(
    ax: number, ay: number,
    bx: number, by: number,
    cx: number, cy: number,
    color: Pixel,
  ): void {
    const minX = Math.floor(Math.min(ax, bx, cx));
    const maxX = Math.ceil(Math.max(ax, bx, cx));
    const minY = Math.floor(Math.min(ay, by, cy));
    const maxY = Math.ceil(Math.max(ay, by, cy));

    const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denom) < 1e-9) return;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        // 픽셀 중심으로 판정한다. 모서리에서 한 줄이 통째로 빠지는 걸 막는다.
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
        const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
        const w2 = 1 - w0 - w1;
        if (w0 >= -0.02 && w1 >= -0.02 && w2 >= -0.02) this.set(x, y, color);
      }
    }
  }

  /**
   * 뿌리는 넓고 끝은 뾰족한 광선. 클로드 심볼의 방사형 획을 픽셀로 옮긴 것.
   * 삼각형 두 장을 겹쳐 살짝 볼록한 꽃잎 모양을 만든다.
   *
   * @param angle 라디안. 0이 오른쪽, 시계 방향.
   */
  ray(
    cx: number,
    cy: number,
    angle: number,
    inner: number,
    outer: number,
    baseWidth: number,
    color: Pixel,
  ): void {
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    const px = -ny;
    const py = nx;
    const half = baseWidth / 2;

    const bx = cx + nx * inner;
    const by = cy + ny * inner;
    const tx = cx + nx * outer;
    const ty = cy + ny * outer;

    // 밑변 삼각형(넓은 뿌리) + 중간 지점을 지나는 좁은 삼각형을 겹쳐
    // 직선 테이퍼보다 도톰한 실루엣을 만든다.
    this.triangle(bx + px * half, by + py * half, bx - px * half, by - py * half, tx, ty, color);

    const mx = cx + nx * (inner + (outer - inner) * 0.45);
    const my = cy + ny * (inner + (outer - inner) * 0.45);
    const midHalf = half * 0.62;
    this.triangle(mx + px * midHalf, my + py * midHalf, mx - px * midHalf, my - py * midHalf, tx, ty, color);
  }

  /** 칠해진 영역의 바깥 테두리를 그린다. 픽셀 캐릭터의 윤곽선. */
  outline(color: string): void {
    const painted = this.data.map((p) => p !== null);
    const isPainted = (x: number, y: number): boolean =>
      this.inBounds(x, y) && painted[this.idx(x, y)] === true;

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (isPainted(x, y)) continue;
        const touches =
          isPainted(x - 1, y) || isPainted(x + 1, y) || isPainted(x, y - 1) || isPainted(x, y + 1);
        if (touches) this.set(x, y, color);
      }
    }
  }

  clone(): PixelGrid {
    const g = new PixelGrid(this.width, this.height);
    for (let i = 0; i < this.data.length; i++) g.data[i] = this.data[i] ?? null;
    return g;
  }

  /** 세로로 dy만큼 민다. 통통 튀는 연출에 쓴다. */
  translated(dx: number, dy: number): PixelGrid {
    const g = new PixelGrid(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const p = this.get(x - dx, y - dy);
        if (p !== null) g.set(x, y, p);
      }
    }
    return g;
  }

  /** RGBA 바이트 배열. PNG 인코더와 캔버스 ImageData가 함께 쓴다. */
  toRGBA(): Uint8ClampedArray {
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    for (let i = 0; i < this.data.length; i++) {
      const p = this.data[i];
      if (!p) continue;
      out[i * 4] = Number.parseInt(p.slice(1, 3), 16);
      out[i * 4 + 1] = Number.parseInt(p.slice(3, 5), 16);
      out[i * 4 + 2] = Number.parseInt(p.slice(5, 7), 16);
      out[i * 4 + 3] = 255;
    }
    return out;
  }
}
