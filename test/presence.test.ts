import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 재실 판정은 외부 프로세스(gdbus)와 electron에 기댄다. 둘 다 흉내 내어
 * '어떤 값이 나올 때 사람이 있다고 볼지'만 검증한다.
 */

let idleOutput: string | null = '(uint64 1200,)';
let lockOutput: string | null = '(false,)';
let powerIdleSec = 0;
let idleState = 'active';

vi.mock('node:child_process', () => ({
  execFile: (
    _cmd: string,
    args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string) => void,
  ) => {
    // 두 인터페이스를 같은 gdbus로 부르므로, 어느 쪽을 물었는지 인자로 가른다.
    const out = args.some((a) => a.includes('ScreenSaver')) ? lockOutput : idleOutput;
    if (out === null) cb(new Error('gdbus 없음'), '');
    else cb(null, out);
  },
}));

vi.mock('electron', () => ({
  powerMonitor: {
    getSystemIdleTime: () => powerIdleSec,
    getSystemIdleState: () => {
      // 실제로 던지는 경우가 있다 — 그때도 알림을 막으면 안 된다.
      if (idleState === 'throw') throw new Error('DBus 없음');
      return idleState;
    },
  },
}));

const {
  AWAY_MS,
  idleMs,
  idleSource,
  isLocked,
  isUserPresent,
  lockSource,
  resetPresenceSources,
} = await import('../src/main/presence.js');

beforeEach(() => {
  idleOutput = '(uint64 1200,)';
  lockOutput = '(false,)';
  powerIdleSec = 0;
  idleState = 'active';
  resetPresenceSources();
});

describe('idleMs', () => {
  it('Mutter IdleMonitor 응답을 밀리초로 읽는다', async () => {
    idleOutput = '(uint64 59415,)';
    await expect(idleMs()).resolves.toBe(59415);
    expect(idleSource()).toBe('gnome');
  });

  it('gdbus가 없으면 powerMonitor로 물러난다', async () => {
    idleOutput = null;
    powerIdleSec = 42;
    await expect(idleMs()).resolves.toBe(42_000);
    expect(idleSource()).toBe('power-monitor');
  });

  it('한 번 물러나면 다시 gdbus를 시도하지 않는다', async () => {
    idleOutput = null;
    await idleMs();
    // 이제 gdbus가 살아나도 계속 powerMonitor를 쓴다 — 매번 실패하는
    // 경로를 다시 밟을 이유가 없다.
    idleOutput = '(uint64 5000,)';
    powerIdleSec = 7;
    await expect(idleMs()).resolves.toBe(7000);
  });
});

describe('isUserPresent', () => {
  it('방금 입력이 있었으면 자리에 있다', async () => {
    idleOutput = '(uint64 500,)';
    await expect(isUserPresent()).resolves.toBe(true);
  });

  it('오래 입력이 없으면 자리에 없다', async () => {
    idleOutput = `(uint64 ${AWAY_MS + 1000},)`;
    await expect(isUserPresent()).resolves.toBe(false);
  });

  it('화면이 잠겨 있으면 무조건 자리에 없다', async () => {
    lockOutput = '(true,)';
    idleOutput = '(uint64 0,)';
    await expect(isUserPresent()).resolves.toBe(false);
  });

  it('경계값에서는 자리에 있는 것으로 본다', async () => {
    idleOutput = `(uint64 ${AWAY_MS - 1},)`;
    await expect(isUserPresent()).resolves.toBe(true);
  });
});

describe('isLocked', () => {
  it('GNOME ScreenSaver 응답을 읽는다', async () => {
    lockOutput = '(true,)';
    await expect(isLocked()).resolves.toBe(true);
    expect(lockSource()).toBe('gnome');

    resetPresenceSources();
    lockOutput = '(false,)';
    await expect(isLocked()).resolves.toBe(false);
  });

  it('GNOME이 없으면 powerMonitor로 물러난다', async () => {
    lockOutput = null;
    idleState = 'locked';
    await expect(isLocked()).resolves.toBe(true);
    expect(lockSource()).toBe('power-monitor');

    idleState = 'active';
    await expect(isLocked()).resolves.toBe(false);
  });

  it('한 번 물러나면 다시 gdbus를 시도하지 않는다', async () => {
    lockOutput = null;
    await isLocked();
    // GNOME이 살아나도 계속 powerMonitor를 쓴다.
    lockOutput = '(true,)';
    idleState = 'active';
    await expect(isLocked()).resolves.toBe(false);
  });

  it('powerMonitor가 던지면 잠기지 않은 것으로 본다', async () => {
    lockOutput = null;
    idleState = 'active';
    await isLocked();
    // 이 시점부터 powerMonitor 경로. 예외가 나도 알림을 막지 않는다.
    idleState = 'throw';
    await expect(isLocked()).resolves.toBe(false);
  });
});
