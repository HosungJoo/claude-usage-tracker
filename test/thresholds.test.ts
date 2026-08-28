import { describe, expect, it } from 'vitest';
import {
  emptyThresholdState,
  evaluateThresholds,
  type ThresholdState,
} from '../src/core/thresholds.js';
import type { UsageSnapshot } from '../src/core/types.js';

const T0 = Date.parse('2026-08-28T05:00:00Z');
const RESET_5H = T0 + 3 * 3600_000;
const RESET_WEEK = T0 + 5 * 86400_000;

function snap(fivePct: number, weekPct: number, opts: Partial<{
  fetchedAt: number;
  fiveResetsAt: number | null;
  weekResetsAt: number | null;
  fiveAvailable: boolean;
}> = {}): UsageSnapshot {
  return {
    fetchedAt: opts.fetchedAt ?? T0,
    fiveHour: {
      percent: fivePct,
      resetsAt: opts.fiveResetsAt === undefined ? RESET_5H : opts.fiveResetsAt,
      severity: 'normal',
      available: opts.fiveAvailable ?? true,
    },
    weekly: {
      percent: weekPct,
      resetsAt: opts.weekResetsAt === undefined ? RESET_WEEK : opts.weekResetsAt,
      severity: 'normal',
      available: true,
    },
    scoped: [],
    severity: 'normal',
  };
}

describe('evaluateThresholds', () => {
  it('임계값 아래에서는 아무것도 발화하지 않는다', () => {
    const { events } = evaluateThresholds(snap(10, 20), emptyThresholdState());
    expect(events).toHaveLength(0);
  });

  it('임계값을 넘으면 한 번 발화한다', () => {
    const { events, state } = evaluateThresholds(snap(55, 10), emptyThresholdState());
    expect(events).toEqual([
      expect.objectContaining({ window: 'fiveHour', threshold: 50, percent: 55 }),
    ]);
    expect(state.fiveHour.fired).toEqual([50]);
  });

  it('같은 임계값은 다시 발화하지 않는다', () => {
    const first = evaluateThresholds(snap(55, 10), emptyThresholdState());
    const second = evaluateThresholds(snap(60, 10), first.state);
    expect(second.events).toHaveLength(0);
  });

  it('값이 내려갔다 다시 올라와도 재발화하지 않는다', () => {
    const a = evaluateThresholds(snap(55, 10), emptyThresholdState());
    const b = evaluateThresholds(snap(40, 10), a.state);
    const c = evaluateThresholds(snap(58, 10), b.state);
    expect(b.events).toHaveLength(0);
    expect(c.events).toHaveLength(0);
  });

  it('여러 임계값을 건너뛰면 가장 높은 것 하나만 발화한다', () => {
    const { events, state } = evaluateThresholds(snap(95, 10), emptyThresholdState());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ threshold: 90, percent: 95 });
    // 건너뛴 50, 70도 발화 처리되어 나중에 다시 울리지 않는다.
    expect(state.fiveHour.fired).toEqual([50, 70, 90]);
  });

  it('다음 임계값을 넘으면 다시 발화한다', () => {
    const a = evaluateThresholds(snap(55, 10), emptyThresholdState());
    const b = evaluateThresholds(snap(75, 10), a.state);
    expect(b.events[0]).toMatchObject({ threshold: 70 });
  });

  it('100%도 발화한다', () => {
    const a = evaluateThresholds(snap(95, 10), emptyThresholdState());
    const b = evaluateThresholds(snap(100, 10), a.state);
    expect(b.events[0]).toMatchObject({ threshold: 100 });
  });

  it('리셋 시각이 지나면 재무장한다', () => {
    const a = evaluateThresholds(snap(95, 10), emptyThresholdState());
    expect(a.state.fiveHour.fired).toEqual([50, 70, 90]);

    const after = RESET_5H + 1000;
    const b = evaluateThresholds(
      snap(55, 10, { fetchedAt: after, fiveResetsAt: after + 5 * 3600_000 }),
      a.state,
      { now: after },
    );
    expect(b.events[0]).toMatchObject({ window: 'fiveHour', threshold: 50 });
  });

  it('서버가 보낸 리셋 시각이 바뀌면 새 윈도우로 보고 재무장한다', () => {
    const a = evaluateThresholds(snap(55, 10), emptyThresholdState());
    const b = evaluateThresholds(snap(55, 10, { fiveResetsAt: RESET_5H + 7200_000 }), a.state);
    expect(b.events[0]).toMatchObject({ threshold: 50 });
  });

  it('5시간과 주간은 서로 독립적으로 센다', () => {
    const a = evaluateThresholds(snap(55, 10), emptyThresholdState());
    const b = evaluateThresholds(snap(55, 72), a.state);
    expect(b.events).toHaveLength(1);
    expect(b.events[0]).toMatchObject({ window: 'weekly', threshold: 70 });
  });

  it('둘 다 터지면 주간을 먼저 보고한다', () => {
    const { events } = evaluateThresholds(snap(55, 72), emptyThresholdState());
    expect(events.map((e) => e.window)).toEqual(['weekly', 'fiveHour']);
  });

  it('윈도우가 제공되지 않으면 발화하지 않는다', () => {
    const { events } = evaluateThresholds(
      snap(99, 10, { fiveAvailable: false }),
      emptyThresholdState(),
    );
    expect(events).toHaveLength(0);
  });

  it('커스텀 임계값을 따른다', () => {
    const { events } = evaluateThresholds(snap(30, 10), emptyThresholdState(), {
      thresholds: [25, 80],
    });
    expect(events[0]).toMatchObject({ threshold: 25 });
  });

  it('이전 상태를 변경하지 않는다', () => {
    const prev: ThresholdState = emptyThresholdState();
    evaluateThresholds(snap(95, 95), prev);
    expect(prev.fiveHour.fired).toEqual([]);
    expect(prev.weekly.fired).toEqual([]);
  });
});
