import { describe, expect, it, vi } from 'vitest';

/**
 * 캡처는 살아 있는 오버레이를 건드리지 않아야 한다. 창을 실제로 띄우지
 * 않고도 '어떤 순서로 무엇을 보내는지'는 검증할 수 있다.
 */

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: {
    getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
    getAllDisplays: () => [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
  },
}));

const { captureScene } = await import('../src/main/capture-window.js');
const { IPC } = await import('../src/shared/ipc.js');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function fakeWindow(opts: { destroyed?: boolean } = {}) {
  const sent: string[] = [];
  return {
    sent,
    isDestroyed: () => opts.destroyed ?? false,
    webContents: {
      send: (channel: string) => sent.push(channel),
      capturePage: () => Promise.resolve({ toPNG: () => PNG }),
    },
  };
}

const req = {
  id: 0,
  line: { expression: 'idle' as const, title: '테스트', detail: '', holdMs: 3000 },
  severity: 'normal' as const,
  corner: 'top-left' as const,
  size: 'large' as const,
  centered: true,
  gauges: [],
};

describe('captureScene', () => {
  it('이전 장면을 지우고 새 장면을 보낸 뒤 찍는다', async () => {
    const win = fakeWindow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const png = await captureScene(win as any, req, 0);

    // 지우지 않고 보내면 앞 장면의 퇴장 연출이 그대로 찍힌다.
    expect(win.sent).toEqual([IPC.hide, IPC.show]);
    expect(png).toEqual(PNG);
  });

  it('창이 이미 닫혔으면 null을 돌려준다', async () => {
    const win = fakeWindow({ destroyed: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const png = await captureScene(win as any, req, 0);

    expect(png).toBeNull();
    expect(win.sent).toEqual([]);
  });
});
