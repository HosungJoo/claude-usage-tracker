import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Line } from '../src/shared/character/script.js';

/**
 * 컨트롤러의 책임은 '언제 무엇을 렌더러에 보낼지'다.
 * BrowserWindow와 ipcMain을 흉내 내면 그 판단만 떼어 검증할 수 있다.
 */

const ipcHandlers = new Map<string, (e: unknown, ...args: never[]) => void>();
const wcHandlers = new Map<string, Array<(...args: never[]) => void>>();

const sent: Array<{ channel: string; payload?: unknown }> = [];
const calls = { show: 0, hide: 0, ignoreMouse: [] as boolean[] };
let loading = false;

function fireWc(event: string): void {
  for (const h of wcHandlers.get(event) ?? []) h();
}

const fakeWin = {
  isDestroyed: () => false,
  showInactive: () => {
    calls.show++;
  },
  hide: () => {
    calls.hide++;
  },
  setIgnoreMouseEvents: (ignore: boolean) => {
    calls.ignoreMouse.push(ignore);
  },
  webContents: {
    isLoading: () => loading,
    send: (channel: string, payload?: unknown) => sent.push({ channel, payload }),
    on: (event: string, fn: () => void) => {
      const list = wcHandlers.get(event) ?? [];
      list.push(fn);
      wcHandlers.set(event, list);
    },
    once: (event: string, fn: () => void) => {
      const list = wcHandlers.get(event) ?? [];
      list.push(fn);
      wcHandlers.set(event, list);
    },
  },
};

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, fn: (e: unknown, ...a: never[]) => void) => ipcHandlers.set(channel, fn),
    off: (channel: string) => ipcHandlers.delete(channel),
  },
}));

const { OverlayController } = await import('../src/main/overlay-controller.js');
const { IPC } = await import('../src/shared/ipc.js');

function line(title: string, holdMs = 5000): Line {
  return { expression: 'talk', title, detail: '', holdMs };
}

function make(): InstanceType<typeof OverlayController> {
  return new OverlayController(fakeWin as never);
}

/** 렌더러가 dismissed를 보낸 것처럼 흉내 낸다. */
function dismiss(id: number): void {
  ipcHandlers.get(IPC.dismissed)?.(null, id as never);
}

afterEach(() => {
  // 남은 타이머가 다음 테스트로 새면 다른 컨트롤러의 큐가 돌아간다.
  vi.clearAllTimers();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.useFakeTimers();
  ipcHandlers.clear();
  wcHandlers.clear();
  sent.length = 0;
  calls.show = 0;
  calls.hide = 0;
  calls.ignoreMouse.length = 0;
  loading = false;
});

describe('OverlayController', () => {
  it('요청을 렌더러로 보내고 창을 띄운다', () => {
    const c = make();
    c.enqueue(line('안녕'), 'normal', []);
    expect(calls.show).toBe(1);
    expect(sent[0]?.channel).toBe(IPC.show);
  });

  it('포커스를 훔치지 않는 방식으로 띄운다', () => {
    // showInactive만 쓰고 show는 쓰지 않는다 — fakeWin에 show가 없으므로
    // 잘못 부르면 여기서 터진다.
    const c = make();
    expect(() => c.enqueue(line('x'), 'normal', [])).not.toThrow();
  });

  it('렌더러가 아직 로딩 중이면 보내지 않고 기다린다', () => {
    loading = true;
    const c = make();
    c.enqueue(line('먼저 온 알림'), 'normal', []);
    expect(sent).toHaveLength(0);

    fireWc('did-finish-load');
    expect(sent).toHaveLength(1);
    expect((sent[0]?.payload as { line: Line }).line.title).toBe('먼저 온 알림');
  });

  it('표시 중이면 큐에 쌓고 하나씩 보여준다', () => {
    const c = make();
    const first = c.enqueue(line('첫번째'), 'normal', []);
    c.enqueue(line('두번째'), 'normal', []);
    expect(sent).toHaveLength(1);

    dismiss(first);
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(2);
    expect((sent[1]?.payload as { line: Line }).line.title).toBe('두번째');
  });

  it('더 심각한 알림이 큐에서 앞으로 온다', () => {
    const c = make();
    const first = c.enqueue(line('보여주는 중'), 'normal', []);
    c.enqueue(line('가벼움'), 'normal', []);
    c.enqueue(line('위험'), 'critical', []);

    dismiss(first);
    vi.advanceTimersByTime(1000);
    expect((sent[1]?.payload as { line: Line }).line.title).toBe('위험');
  });

  it('같은 심각도끼리는 들어온 순서를 지킨다', () => {
    const c = make();
    const first = c.enqueue(line('보여주는 중'), 'normal', []);
    c.enqueue(line('A'), 'warning', []);
    c.enqueue(line('B'), 'warning', []);

    dismiss(first);
    vi.advanceTimersByTime(1000);
    expect((sent[1]?.payload as { line: Line }).line.title).toBe('A');
  });

  it('닫히면 창을 숨긴다', () => {
    const c = make();
    const id = c.enqueue(line('x'), 'normal', []);
    dismiss(id);
    expect(calls.hide).toBe(1);
  });

  it('렌더러가 응답하지 않아도 큐가 막히지 않는다', () => {
    const c = make();
    c.enqueue(line('응답 없음', 3000), 'normal', []);
    c.enqueue(line('다음'), 'normal', []);

    // holdMs + 안전망 2초 + 간격
    vi.advanceTimersByTime(3000 + 2000 + 1000);
    expect(sent).toHaveLength(2);
  });

  it('모르는 id의 dismiss는 무시한다', () => {
    const c = make();
    c.enqueue(line('x'), 'normal', []);
    dismiss(9999);
    expect(calls.hide).toBe(0);
  });

  it('clear는 큐를 비우고 창을 감춘다', () => {
    const c = make();
    c.enqueue(line('a'), 'normal', []);
    c.enqueue(line('b'), 'normal', []);
    c.clear();

    expect(sent.some((s) => s.channel === IPC.hide)).toBe(true);
    vi.advanceTimersByTime(10_000);
    expect(sent.filter((s) => s.channel === IPC.show)).toHaveLength(1);
  });

  it('말풍선 위에서만 클릭을 받는다', () => {
    make();
    const handler = ipcHandlers.get(IPC.setInteractive);
    handler?.(null, true as never);
    handler?.(null, false as never);
    // setIgnoreMouseEvents는 interactive의 반대값을 받아야 한다.
    expect(calls.ignoreMouse).toEqual([false, true]);
  });

  it('id는 요청마다 새로 발급된다', () => {
    const c = make();
    expect(c.enqueue(line('a'), 'normal', [])).not.toBe(c.enqueue(line('b'), 'normal', []));
  });
});
