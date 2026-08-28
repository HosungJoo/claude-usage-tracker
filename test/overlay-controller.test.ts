import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Line } from '../src/shared/character/script.js';

/**
 * 컨트롤러의 책임은 '언제 무엇을 렌더러에 보낼지'다.
 * BrowserWindow와 ipcMain을 흉내 내면 그 판단만 떼어 검증할 수 있다.
 */

const ipcHandlers = new Map<string, (e: unknown, ...args: never[]) => void>();

const sent: Array<{ channel: string; payload?: unknown }> = [];
const calls = {
  show: 0,
  hide: 0,
  ignoreMouse: [] as boolean[],
  /** 어느 요청이 몇 개의 화면에 나갔는지. */
  screens: [] as number[],
};
let ready = true;
let screenCount = 1;
let readyCb: (() => void) | null = null;

/** 컨트롤러가 기대하는 최소 인터페이스만 흉내 낸다. */
const fakeHost = {
  isReady: () => ready,
  onReady: (cb: () => void) => {
    if (ready) cb();
    else readyCb = cb;
  },
  show: (req: unknown) => {
    calls.show++;
    calls.screens.push(screenCount);
    sent.push({ channel: 'overlay:show', payload: req });
  },
  // sent 에는 표시 요청만 쌓는다. 감추기는 calls.hide 로 센다.
  hide: () => {
    calls.hide++;
  },
  setInteractive: (v: boolean) => calls.ignoreMouse.push(!v),
  destroy: () => {},
};

/** 렌더러가 준비됐다고 알린다. */
function becomeReady(): void {
  ready = true;
  readyCb?.();
  readyCb = null;
}

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, fn: (e: unknown, ...a: never[]) => void) => ipcHandlers.set(channel, fn),
    off: (channel: string) => ipcHandlers.delete(channel),
  },
  powerMonitor: { getSystemIdleTime: () => 0, getSystemIdleState: () => 'active' },
}));

const { OverlayController } = await import('../src/main/overlay-controller.js');
const { IPC } = await import('../src/shared/ipc.js');

function line(title: string, holdMs = 5000): Line {
  return { expression: 'talk', title, detail: '', holdMs };
}

/** 재실 판정을 테스트가 조종한다. */
let present = true;

function make(waitWhenAway = false, presentMs = 3000): InstanceType<typeof OverlayController> {
  return new OverlayController(fakeHost, {
    presentMs,
    waitWhenAway,
    isPresent: () => Promise.resolve(present),
  });
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
  sent.length = 0;
  calls.show = 0;
  calls.hide = 0;
  calls.ignoreMouse.length = 0;
  calls.screens.length = 0;
  ready = true;
  readyCb = null;
  screenCount = 1;
  present = true;
});

describe('OverlayController', () => {
  it('붙은 모서리를 함께 보낸다 — 렌더러가 말풍선 방향을 정한다', () => {
    const c = make();
    c.enqueue(line('x'), 'normal', [], 'top-left');
    expect((sent[0]?.payload as { corner: string }).corner).toBe('top-left');
  });

  it('요청을 렌더러로 보내고 창을 띄운다', () => {
    const c = make();
    c.enqueue(line('안녕'), 'normal', [], 'bottom-right');
    expect(calls.show).toBe(1);
    expect(sent[0]?.channel).toBe(IPC.show);
  });

  it('포커스를 훔치지 않는 방식으로 띄운다', () => {
    // showInactive만 쓰고 show는 쓰지 않는다 — fakeWin에 show가 없으므로
    // 잘못 부르면 여기서 터진다.
    const c = make();
    expect(() => c.enqueue(line('x'), 'normal', [], 'bottom-right')).not.toThrow();
    expect(calls.show).toBe(1);
  });

  it('렌더러가 아직 준비되지 않았으면 보내지 않고 기다린다', () => {
    ready = false;
    const c = make();
    c.enqueue(line('먼저 온 알림'), 'normal', [], 'bottom-right');
    expect(sent).toHaveLength(0);

    becomeReady();
    expect(sent).toHaveLength(1);
    expect((sent[0]?.payload as { line: Line }).line.title).toBe('먼저 온 알림');
  });

  it('화면이 여럿이면 전부에 보낸다', () => {
    screenCount = 3;
    const c = make();
    c.enqueue(line('x'), 'normal', [], 'bottom-right');
    expect(calls.screens).toEqual([3]);
  });

  it('표시 중이면 큐에 쌓고 하나씩 보여준다', () => {
    const c = make();
    const first = c.enqueue(line('첫번째'), 'normal', [], 'bottom-right');
    c.enqueue(line('두번째'), 'normal', [], 'bottom-right');
    expect(sent).toHaveLength(1);

    dismiss(first);
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(2);
    expect((sent[1]?.payload as { line: Line }).line.title).toBe('두번째');
  });

  it('더 심각한 알림이 큐에서 앞으로 온다', () => {
    const c = make();
    const first = c.enqueue(line('보여주는 중'), 'normal', [], 'bottom-right');
    c.enqueue(line('가벼움'), 'normal', [], 'bottom-right');
    c.enqueue(line('위험'), 'critical', [], 'bottom-right');

    dismiss(first);
    vi.advanceTimersByTime(1000);
    expect((sent[1]?.payload as { line: Line }).line.title).toBe('위험');
  });

  it('같은 심각도끼리는 들어온 순서를 지킨다', () => {
    const c = make();
    const first = c.enqueue(line('보여주는 중'), 'normal', [], 'bottom-right');
    c.enqueue(line('A'), 'warning', [], 'bottom-right');
    c.enqueue(line('B'), 'warning', [], 'bottom-right');

    dismiss(first);
    vi.advanceTimersByTime(1000);
    expect((sent[1]?.payload as { line: Line }).line.title).toBe('A');
  });

  it('닫히면 창을 숨긴다', () => {
    const c = make();
    const id = c.enqueue(line('x'), 'normal', [], 'bottom-right');
    dismiss(id);
    expect(calls.hide).toBe(1);
  });

  it('렌더러가 응답하지 않아도 큐가 막히지 않는다', () => {
    // 메인이 스스로 시간을 재므로 렌더러의 응답을 기다리지 않는다.
    const c = make();
    c.enqueue(line('응답 없음'), 'normal', [], 'bottom-right');
    c.enqueue(line('다음'), 'normal', [], 'bottom-right');

    vi.advanceTimersByTime(3000 + 1000);
    expect(sent).toHaveLength(2);
  });

  it('모르는 id의 dismiss는 무시한다', () => {
    const c = make();
    c.enqueue(line('x'), 'normal', [], 'bottom-right');
    dismiss(9999);
    expect(calls.hide).toBe(0);
  });

  it('clear는 큐를 비우고 창을 감춘다', () => {
    const c = make();
    c.enqueue(line('a'), 'normal', [], 'bottom-right');
    c.enqueue(line('b'), 'normal', [], 'bottom-right');
    c.clear();

    expect(calls.hide).toBeGreaterThan(0);
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(1);
  });

  it('말풍선 위에서만 클릭을 받는다', () => {
    make();
    const handler = ipcHandlers.get(IPC.setInteractive);
    handler?.(null, true as never);
    handler?.(null, false as never);
    // 클릭 통과는 interactive의 반대값이다.
    expect(calls.ignoreMouse).toEqual([false, true]);
  });

  it('id는 요청마다 새로 발급된다', () => {
    const c = make();
    expect(c.enqueue(line('a'), 'normal', [], 'bottom-right')).not.toBe(c.enqueue(line('b'), 'normal', [], 'bottom-right'));
  });
});

describe('사람이 볼 때까지 기다린다', () => {
  /** 재실 판정이 프로미스라 타이머를 밀 때마다 마이크로태스크를 흘려줘야 한다. */
  async function advance(ms: number, step = 200): Promise<void> {
    for (let t = 0; t < ms; t += step) {
      vi.advanceTimersByTime(step);
      await Promise.resolve();
      await Promise.resolve();
    }
  }

  it('자리에 있으면 정해진 시간 뒤 사라진다', async () => {
    present = true;
    const c = make(true, 3000);
    c.enqueue(line('x'), 'normal', [], 'bottom-right');

    await advance(2000);
    expect(calls.hide).toBe(0);

    await advance(1500);
    expect(calls.hide).toBe(1);
  });

  it('자리에 없으면 사라지지 않는다', async () => {
    present = false;
    const c = make(true, 3000);
    c.enqueue(line('x'), 'normal', [], 'bottom-right');

    // 못 보는 알림은 없는 알림이다. 30초가 지나도 그대로 떠 있어야 한다.
    await advance(30_000);
    expect(calls.hide).toBe(0);
  });

  it('돌아오면 그때부터 시간을 잰다', async () => {
    present = false;
    const c = make(true, 3000);
    c.enqueue(line('x'), 'normal', [], 'bottom-right');

    await advance(10_000);
    expect(calls.hide).toBe(0);

    present = true;
    await advance(1500);
    expect(calls.hide).toBe(0);

    await advance(2500);
    expect(calls.hide).toBe(1);
  });

  it('기다리기를 끄면 재실과 무관하게 사라진다', async () => {
    present = false;
    const c = make(false, 3000);
    c.enqueue(line('x'), 'normal', [], 'bottom-right');

    await advance(3500);
    expect(calls.hide).toBe(1);
  });

  it('아무리 기다려도 30분을 넘기지 않는다', async () => {
    // 재실 감지가 계속 '없음'을 돌려주면 캐릭터가 영원히 남는다.
    present = false;
    const c = make(true, 3000);
    c.enqueue(line('x'), 'normal', [], 'bottom-right');

    await advance(31 * 60_000, 5_000);
    expect(calls.hide).toBe(1);
  });

  it('설정을 바꾸면 다음 표시부터 적용된다', async () => {
    present = true;
    const c = make(true, 3000);
    c.setPolicy({ presentMs: 10_000, waitWhenAway: true, isPresent: () => Promise.resolve(true) });
    c.enqueue(line('x'), 'normal', [], 'bottom-right');

    await advance(5000);
    expect(calls.hide).toBe(0);
    await advance(6000);
    expect(calls.hide).toBe(1);
  });
});
