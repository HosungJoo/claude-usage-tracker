import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * computeBounds는 멀티모니터 배치 규칙 그 자체라, electron의 screen만
 * 흉내 내면 창을 띄우지 않고도 전부 검증할 수 있다.
 */

const displays = {
  primary: {
    id: 1,
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  },
  secondary: {
    id: 2,
    workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
    bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
  },
};

const cursorPoint = { x: 100, y: 100 };
let nearestDisplay = displays.primary;

vi.mock('electron', () => ({
  screen: {
    getPrimaryDisplay: () => displays.primary,
    getAllDisplays: () => [displays.primary, displays.secondary],
    getCursorScreenPoint: () => cursorPoint,
    getDisplayNearestPoint: () => nearestDisplay,
  },
  BrowserWindow: class {},
}));

const { computeBounds, DEFAULT_PLACEMENT, OVERLAY_WIDTH, OVERLAY_HEIGHT } = await import(
  '../src/main/overlay-window.js'
);

beforeEach(() => {
  nearestDisplay = displays.primary;
});

describe('computeBounds', () => {
  it('기본값은 커서가 있는 화면의 우하단', () => {
    const b = computeBounds(DEFAULT_PLACEMENT);
    expect(b.x).toBe(1920 - OVERLAY_WIDTH - 24);
    expect(b.y).toBe(1040 - OVERLAY_HEIGHT - 24);
    expect(b.width).toBe(OVERLAY_WIDTH);
    expect(b.height).toBe(OVERLAY_HEIGHT);
  });

  it.each([
    ['top-left', 24, 24],
    ['top-right', 1920 - OVERLAY_WIDTH - 24, 24],
    ['bottom-left', 24, 1040 - OVERLAY_HEIGHT - 24],
    ['bottom-right', 1920 - OVERLAY_WIDTH - 24, 1040 - OVERLAY_HEIGHT - 24],
  ] as const)('%s 코너', (corner, x, y) => {
    const b = computeBounds({ ...DEFAULT_PLACEMENT, corner });
    expect([b.x, b.y]).toEqual([x, y]);
  });

  it('workArea를 쓰므로 패널·독을 침범하지 않는다', () => {
    // workArea 높이(1040)가 bounds 높이(1080)보다 작다 — 패널이 있는 상황.
    const b = computeBounds({ ...DEFAULT_PLACEMENT, corner: 'bottom-left' });
    expect(b.y + OVERLAY_HEIGHT).toBeLessThanOrEqual(1040);
  });

  it('커서가 보조 모니터에 있으면 그쪽에 뜬다', () => {
    nearestDisplay = displays.secondary;
    const b = computeBounds(DEFAULT_PLACEMENT);
    expect(b.x).toBe(1920 + 2560 - OVERLAY_WIDTH - 24);
  });

  it('디스플레이를 id로 지정할 수 있다', () => {
    const b = computeBounds({ ...DEFAULT_PLACEMENT, display: 2 });
    expect(b.x).toBe(1920 + 2560 - OVERLAY_WIDTH - 24);
  });

  it('지정한 디스플레이가 사라지면 주 디스플레이로 떨어진다', () => {
    const b = computeBounds({ ...DEFAULT_PLACEMENT, display: 999 });
    expect(b.x).toBe(1920 - OVERLAY_WIDTH - 24);
  });

  it("display: 'primary'는 커서를 무시한다", () => {
    nearestDisplay = displays.secondary;
    const b = computeBounds({ ...DEFAULT_PLACEMENT, display: 'primary' });
    expect(b.x).toBe(1920 - OVERLAY_WIDTH - 24);
  });

  it('여백을 키우면 안쪽으로 들어온다', () => {
    const a = computeBounds({ ...DEFAULT_PLACEMENT, margin: 0 });
    const b = computeBounds({ ...DEFAULT_PLACEMENT, margin: 100 });
    expect(a.x - b.x).toBe(100);
  });
});
