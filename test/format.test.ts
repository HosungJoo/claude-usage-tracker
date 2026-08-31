import { setLocale } from '../src/shared/i18n/index.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { formatPercent, formatRemaining, gaugeBar, severityLabel } from '../src/core/format.js';

const NOW = 1_700_000_000_000;


// 이 파일은 한국어 문구 자체를 검증한다. 기본 언어(영어)에 기대면
// 문구를 다듬을 때마다 무관한 테스트가 깨진다.
beforeEach(() => setLocale('ko'));

describe('formatRemaining', () => {
  it.each([
    [NOW + 30 * 60_000, '30분'],
    [NOW + 2 * 3600_000, '2시간'],
    [NOW + 2 * 3600_000 + 14 * 60_000, '2시간 14분'],
    [NOW + 3 * 86400_000 + 5 * 3600_000, '3일 5시간'],
    [NOW + 2 * 86400_000, '2일'],
  ])('%i → %s', (at, expected) => {
    expect(formatRemaining(at, NOW)).toBe(expected);
  });

  it('이미 지났으면 곧', () => {
    expect(formatRemaining(NOW - 1000, NOW)).toBe('곧');
  });

  it('null이면 알 수 없음', () => {
    expect(formatRemaining(null, NOW)).toBe('알 수 없음');
  });
});

describe('formatPercent', () => {
  it('정수는 그대로', () => expect(formatPercent(10)).toBe('10%'));
  it('소수는 한 자리', () => expect(formatPercent(12.34)).toBe('12.3%'));
});

describe('gaugeBar', () => {
  it('0%는 전부 비어 있다', () => expect(gaugeBar(0, 10)).toBe('░'.repeat(10)));
  it('100%는 전부 차 있다', () => expect(gaugeBar(100, 10)).toBe('█'.repeat(10)));
  it('50%는 절반', () => expect(gaugeBar(50, 10)).toBe('█████░░░░░'));
  it('범위를 벗어나도 폭이 유지된다', () => {
    expect(gaugeBar(-5, 10)).toHaveLength(10);
    expect(gaugeBar(150, 10)).toHaveLength(10);
  });
});

describe('severityLabel', () => {
  it('세 단계 모두 한국어 라벨이 있다', () => {
    expect([severityLabel('normal'), severityLabel('warning'), severityLabel('critical')]).toEqual([
      '여유', '주의', '위험',
    ]);
  });
});
