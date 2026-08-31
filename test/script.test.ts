import { setLocale } from '../src/shared/i18n/index.js';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  lineForGreeting,
  lineForManualCheck,
  lineForThreshold,
} from '../src/shared/character/script.js';
import { gaugesFromSnapshot } from '../src/shared/ipc.js';
import type { Severity, UsageSnapshot } from '../src/core/types.js';
import type { ThresholdEvent } from '../src/core/thresholds.js';

const NOW = Date.parse('2026-08-28T05:00:00Z');
const IN_2H = NOW + 2 * 3600_000;
const IN_3D = NOW + 3 * 86400_000;

function snap(five: number, week: number, severity: Severity = 'normal'): UsageSnapshot {
  return {
    fetchedAt: NOW,
    fiveHour: { percent: five, resetsAt: IN_2H, severity, available: true },
    weekly: { percent: week, resetsAt: IN_3D, severity, available: true },
    scoped: [],
    severity,
  };
}

function event(threshold: number, severity: Severity = 'normal'): ThresholdEvent {
  return { window: 'fiveHour', threshold, percent: threshold + 1, resetsAt: IN_2H, severity };
}


// 이 파일은 한국어 문구 자체를 검증한다. 기본 언어(영어)에 기대면
// 문구를 다듬을 때마다 무관한 테스트가 깨진다.
beforeEach(() => setLocale('ko'));

describe('lineForThreshold', () => {
  // 단계마다 새로운 신호가 하나씩 더해진다 — 표정만 바뀌면 무엇이
  // 달라졌는지 알아채기 어렵다.
  it.each([
    [50, 'talk'],
    [70, 'worry'],
    [90, 'alert'],
    [100, 'faint'],
  ])('%i%%에서는 %s 표정', (threshold, expression) => {
    expect(lineForThreshold(event(threshold), NOW).expression).toBe(expression);
  });

  it('단계마다 표정이 모두 다르다', () => {
    const seen = [50, 70, 90, 100].map((t) => lineForThreshold(event(t), NOW).expression);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('임계값이 높을수록 오래 띄운다', () => {
    const holds = [50, 70, 90, 100].map((t) => lineForThreshold(event(t), NOW).holdMs);
    for (let i = 1; i < holds.length; i++) {
      expect(holds[i]).toBeGreaterThan(holds[i - 1] as number);
    }
  });

  it('창 종류를 문구에 밝힌다', () => {
    const weekly = lineForThreshold({ ...event(70), window: 'weekly' }, NOW);
    expect(weekly.title).toContain('주간');
    expect(lineForThreshold(event(70), NOW).title).toContain('5시간');
  });

  it('남은 시간을 사람이 읽는 형태로 넣는다', () => {
    expect(lineForThreshold(event(70), NOW).detail).toContain('2시간');
  });

  it('100%에서는 다 썼다고 분명히 말한다', () => {
    expect(lineForThreshold(event(100, 'critical'), NOW).title).toContain('다 썼');
  });

  it('리셋 시각을 모르면 문구가 깨지지 않는다', () => {
    const line = lineForThreshold({ ...event(90), resetsAt: null }, NOW);
    expect(line.detail).toContain('알 수 없음');
  });
});

describe('lineForGreeting', () => {
  it('여유로울 때는 손을 흔든다', () => {
    expect(lineForGreeting(snap(12, 8), NOW).expression).toBe('wave');
  });

  it('위험할 때는 인사보다 경고가 먼저다', () => {
    const line = lineForGreeting(snap(95, 80, 'critical'), NOW);
    expect(line.expression).toBe('panic');
    expect(line.title).toContain('아껴');
  });

  it('주의 단계에서는 손을 흔들지 않는다', () => {
    expect(lineForGreeting(snap(75, 40, 'warning'), NOW).expression).toBe('worry');
  });

  it('남은 비율을 알려준다', () => {
    expect(lineForGreeting(snap(12, 8), NOW).title).toContain('88%');
  });

  it('상세줄에 두 윈도우를 모두 넣는다', () => {
    const detail = lineForGreeting(snap(12, 8), NOW).detail;
    expect(detail).toContain('5시간');
    expect(detail).toContain('주간');
  });
});

describe('lineForManualCheck', () => {
  it('심각도에 따라 표정이 바뀐다', () => {
    expect(lineForManualCheck(snap(10, 10, 'normal'), NOW).expression).toBe('happy');
    expect(lineForManualCheck(snap(75, 40, 'warning'), NOW).expression).toBe('worry');
    expect(lineForManualCheck(snap(95, 90, 'critical'), NOW).expression).toBe('panic');
  });
});

describe('gaugesFromSnapshot', () => {
  it('두 윈도우를 게이지로 만든다', () => {
    expect(gaugesFromSnapshot(snap(30, 60))).toEqual([
      { label: '5시간', percent: 30, severity: 'normal' },
      { label: '주간', percent: 60, severity: 'normal' },
    ]);
  });

  it('제공되지 않는 윈도우는 빼고 만든다', () => {
    const s = snap(30, 60);
    s.fiveHour.available = false;
    expect(gaugesFromSnapshot(s).map((g) => g.label)).toEqual(['주간']);
  });
});
