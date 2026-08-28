import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 어느 화면에 띄울지 고르는 규칙만 검증한다. 창을 실제로 만드는 부분은
 * Electron 없이는 확인할 수 없다.
 */

const primary = { id: 0, bounds: { x: 2160, y: 1268, width: 3840, height: 2160 } };
const secondary = { id: 1, bounds: { x: 0, y: 0, width: 2160, height: 3840 } };

let displays = [primary, secondary];
let cursorDisplay = secondary;

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: () => displays,
    getPrimaryDisplay: () => primary,
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => cursorDisplay,
  },
  BrowserWindow: class {},
}));

const { resolveTargets } = await import('../src/main/overlay-host.js');

beforeEach(() => {
  displays = [primary, secondary];
  cursorDisplay = secondary;
});

describe('resolveTargets', () => {
  it("'all'은 모든 화면을 고른다", () => {
    expect(resolveTargets('all').map((d) => d.id)).toEqual([0, 1]);
  });

  it("'primary'는 주 모니터만", () => {
    expect(resolveTargets('primary').map((d) => d.id)).toEqual([0]);
  });

  it("'cursor'는 커서가 있는 화면만", () => {
    expect(resolveTargets('cursor').map((d) => d.id)).toEqual([1]);
  });

  it('id로 특정 모니터를 고른다', () => {
    expect(resolveTargets(1).map((d) => d.id)).toEqual([1]);
  });

  it('지정한 모니터가 사라지면 주 모니터로 떨어진다', () => {
    expect(resolveTargets(99).map((d) => d.id)).toEqual([0]);
  });

  it('화면이 하나뿐이면 어느 선택지든 결과가 같다', () => {
    displays = [primary];
    cursorDisplay = primary;
    for (const choice of ['all', 'primary', 'cursor', 99] as const) {
      expect(resolveTargets(choice).map((d) => d.id), String(choice)).toEqual([0]);
    }
  });

  it('화면이 없으면 빈 목록', () => {
    displays = [];
    expect(resolveTargets('all')).toEqual([]);
  });
});
