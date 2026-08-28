import { beforeEach, describe, expect, it } from 'vitest';
import { GREET_COOLDOWN_MS, SessionGreeter } from '../src/main/session-greeter.js';
import type { Line } from '../src/shared/character/script.js';
import type { UsageSnapshot } from '../src/core/types.js';

const T0 = Date.parse('2026-08-28T05:00:00Z');

function snap(five: number, week = 20): UsageSnapshot {
  return {
    fetchedAt: T0,
    fiveHour: { percent: five, resetsAt: T0 + 3600_000, severity: 'normal', available: true },
    weekly: { percent: week, resetsAt: T0 + 86400_000, severity: 'normal', available: true },
    scoped: [],
    severity: 'normal',
  };
}

interface Harness {
  greeter: SessionGreeter;
  shown: Line[];
  setUsage: (s: UsageSnapshot | null) => void;
  setNow: (t: number) => void;
  refreshCount: () => number;
}

function harness(initial: UsageSnapshot | null = snap(10)): Harness {
  let usage = initial;
  let now = T0;
  let refreshes = 0;
  const shown: Line[] = [];

  const greeter = new SessionGreeter({
    refresh: async () => {
      refreshes++;
      return usage;
    },
    present: (line) => shown.push(line),
    now: () => now,
  });

  return {
    greeter,
    shown,
    setUsage: (s) => {
      usage = s;
    },
    setNow: (t) => {
      now = t;
    },
    refreshCount: () => refreshes,
  };
}

let h: Harness;
beforeEach(() => {
  h = harness();
});

describe('SessionStart', () => {
  it('세션을 시작하면 인사한다', async () => {
    await h.greeter.handle({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's1' });
    expect(h.shown).toHaveLength(1);
    expect(h.shown[0]?.expression).toBe('wave');
  });

  it('이어하기(resume)에도 인사한다', async () => {
    await h.greeter.handle({ hook_event_name: 'SessionStart', source: 'resume', session_id: 's1' });
    expect(h.shown).toHaveLength(1);
  });

  it.each(['clear', 'compact'])('%s 에는 인사하지 않는다 — 사용자가 시작이라 느끼지 않는다', async (source) => {
    await h.greeter.handle({ hook_event_name: 'SessionStart', source, session_id: 's1' });
    expect(h.shown).toHaveLength(0);
  });

  it('짧은 시간 안에 다시 시작하면 인사하지 않는다', async () => {
    await h.greeter.handle({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's1' });
    h.setNow(T0 + 5000);
    await h.greeter.handle({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's2' });
    expect(h.shown).toHaveLength(1);
  });

  it('쿨다운이 지나면 다시 인사한다', async () => {
    await h.greeter.handle({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's1' });
    h.setNow(T0 + GREET_COOLDOWN_MS + 1);
    await h.greeter.handle({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's2' });
    expect(h.shown).toHaveLength(2);
  });

  it('인사를 건너뛰어도 세션 시작 시점은 기록한다', async () => {
    await h.greeter.handle({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's1' });
    h.setNow(T0 + 1000);
    await h.greeter.handle({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's2' });
    expect(h.greeter.trackedSessions).toBe(2);
  });

  it('사용량을 못 읽으면 조용히 넘어간다', async () => {
    h.setUsage(null);
    await h.greeter.handle({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's1' });
    expect(h.shown).toHaveLength(0);
  });

  it('폴링 주기를 기다리지 않고 그 자리에서 다시 읽는다', async () => {
    await h.greeter.handle({ hook_event_name: 'SessionStart', source: 'startup', session_id: 's1' });
    expect(h.refreshCount()).toBe(1);
  });

  it('source가 없어도 인사한다 — 옛 버전 호환', async () => {
    await h.greeter.handle({ hook_event_name: 'SessionStart', session_id: 's1' });
    expect(h.shown).toHaveLength(1);
  });
});

describe('SessionEnd', () => {
  async function startSession(id: string, fivePercent: number): Promise<void> {
    h.setUsage(snap(fivePercent));
    await h.greeter.handle({ hook_event_name: 'SessionStart', source: 'startup', session_id: id });
    h.shown.length = 0;
  }

  it('세션 동안 늘어난 사용량을 알려준다', async () => {
    await startSession('s1', 10);
    h.setUsage(snap(25));
    await h.greeter.handle({ hook_event_name: 'SessionEnd', session_id: 's1' });

    expect(h.shown).toHaveLength(1);
    expect(h.shown[0]?.title).toContain('15%');
  });

  it('변화가 미미하면 방해하지 않는다', async () => {
    await startSession('s1', 10);
    h.setUsage(snap(10.4));
    await h.greeter.handle({ hook_event_name: 'SessionEnd', session_id: 's1' });
    expect(h.shown).toHaveLength(0);
  });

  it('한도가 리셋되어 사용량이 줄었으면 알리지 않는다', async () => {
    await startSession('s1', 80);
    h.setUsage(snap(5));
    await h.greeter.handle({ hook_event_name: 'SessionEnd', session_id: 's1' });
    expect(h.shown).toHaveLength(0);
  });

  it('시작을 못 본 세션의 종료는 무시한다', async () => {
    await h.greeter.handle({ hook_event_name: 'SessionEnd', session_id: '모르는세션' });
    expect(h.shown).toHaveLength(0);
  });

  it('종료 후에는 세션 추적을 정리한다', async () => {
    await startSession('s1', 10);
    expect(h.greeter.trackedSessions).toBe(1);
    await h.greeter.handle({ hook_event_name: 'SessionEnd', session_id: 's1' });
    expect(h.greeter.trackedSessions).toBe(0);
  });

  it('세션 id가 없으면 무시한다', async () => {
    await h.greeter.handle({ hook_event_name: 'SessionEnd' });
    expect(h.shown).toHaveLength(0);
  });
});

describe('알 수 없는 이벤트', () => {
  it('무시하고 죽지 않는다', async () => {
    await expect(
      h.greeter.handle({ hook_event_name: 'PreToolUse', session_id: 's1' }),
    ).resolves.toBeUndefined();
    expect(h.shown).toHaveLength(0);
  });

  it('빈 이벤트도 무시한다', async () => {
    await expect(h.greeter.handle({})).resolves.toBeUndefined();
  });
});
