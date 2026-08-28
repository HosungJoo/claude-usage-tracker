import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 재실 판정은 외부 프로세스(gdbus)와 electron에 기댄다. 둘 다 흉내 내어
 * '어떤 값이 나올 때 사람이 있다고 볼지'만 검증한다.
 */

let gdbusOutput: string | null = '(uint64 1200,)';
let powerIdleSec = 0;
let idleState = 'active';

vi.mock('node:child_process', () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (err: Error | null, stdout: string) => void,
  ) => {
    if (gdbusOutput === null) cb(new Error('gdbus 없음'), '');
    else cb(null, gdbusOutput);
  },
}));

vi.mock('electron', () => ({
  powerMonitor: {
    getSystemIdleTime: () => powerIdleSec,
    getSystemIdleState: () => idleState,
  },
}));

const { AWAY_MS, idleMs, idleSource, isLocked, isUserPresent, resetIdleSource } = await import(
  '../src/main/presence.js'
);

beforeEach(() => {
  gdbusOutput = '(uint64 1200,)';
  powerIdleSec = 0;
  idleState = 'active';
  resetIdleSource();
});

describe('idleMs', () => {
  it('Mutter IdleMonitor 응답을 밀리초로 읽는다', async () => {
    gdbusOutput = '(uint64 59415,)';
    await expect(idleMs()).resolves.toBe(59415);
    expect(idleSource()).toBe('mutter');
  });

  it('gdbus가 없으면 powerMonitor로 물러난다', async () => {
    gdbusOutput = null;
    powerIdleSec = 42;
    await expect(idleMs()).resolves.toBe(42_000);
    expect(idleSource()).toBe('power-monitor');
  });

  it('한 번 물러나면 다시 gdbus를 시도하지 않는다', async () => {
    gdbusOutput = null;
    await idleMs();
    // 이제 gdbus가 살아나도 계속 powerMonitor를 쓴다 — 매번 실패하는
    // 경로를 다시 밟을 이유가 없다.
    gdbusOutput = '(uint64 5000,)';
    powerIdleSec = 7;
    await expect(idleMs()).resolves.toBe(7000);
  });
});

describe('isUserPresent', () => {
  it('방금 입력이 있었으면 자리에 있다', async () => {
    gdbusOutput = '(uint64 500,)';
    await expect(isUserPresent()).resolves.toBe(true);
  });

  it('오래 입력이 없으면 자리에 없다', async () => {
    gdbusOutput = `(uint64 ${AWAY_MS + 1000},)`;
    await expect(isUserPresent()).resolves.toBe(false);
  });

  it('화면이 잠겨 있으면 무조건 자리에 없다', async () => {
    idleState = 'locked';
    gdbusOutput = '(uint64 0,)';
    await expect(isUserPresent()).resolves.toBe(false);
  });

  it('경계값에서는 자리에 있는 것으로 본다', async () => {
    gdbusOutput = `(uint64 ${AWAY_MS - 1},)`;
    await expect(isUserPresent()).resolves.toBe(true);
  });
});

describe('isLocked', () => {
  it('잠금 상태를 읽는다', () => {
    idleState = 'locked';
    expect(isLocked()).toBe(true);
    idleState = 'active';
    expect(isLocked()).toBe(false);
  });
});
