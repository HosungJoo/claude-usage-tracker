import { afterEach, describe, expect, it } from 'vitest';
import { ko } from '../src/shared/i18n/ko.js';
import { en } from '../src/shared/i18n/en.js';
import {
  applyLocale,
  locale,
  localeFromEnv,
  resolveLocale,
  setLocale,
  t,
} from '../src/shared/i18n/index.js';
import { formatRemaining } from '../src/core/format.js';
import { lineForThreshold } from '../src/shared/character/script.js';

/**
 * 번역이 빠지는 방식은 조용하다 — 화면에 `undefined`가 뜨거나, 한 언어를
 * 고른 사용자에게 다른 언어가 섞여 나온다. 타입이 잡아 주는 건 '키가
 * 있는지'까지고, '값이 실제로 그 언어인지'는 여기서 잡는다.
 */

afterEach(() => setLocale('en'));

/** 문구표를 평평하게 펴서 (경로, 값) 쌍으로 만든다. 함수는 불러서 결과를 본다. */
function flatten(node: unknown, path = ''): Array<[string, string]> {
  if (typeof node === 'string') return [[path, node]];
  if (typeof node === 'function') {
    // 인자 개수를 보고 자리표시자를 채운다. 어떤 값이 와도 문장이 되어야 한다.
    const args = Array.from({ length: node.length }, (_, i) => (i === 0 ? 'X' : 'Y'));
    return [[path, String((node as (...a: unknown[]) => string)(...args))]];
  }
  if (typeof node === 'object' && node !== null) {
    return Object.entries(node).flatMap(([k, v]) => flatten(v, path ? `${path}.${k}` : k));
  }
  return [];
}

const koEntries = flatten(ko);
const enEntries = flatten(en);

describe('문구표', () => {
  it('두 언어가 같은 키를 가진다', () => {
    expect(enEntries.map(([k]) => k).sort()).toEqual(koEntries.map(([k]) => k).sort());
  });

  it('빈 문구가 없다', () => {
    for (const [key, value] of [...koEntries, ...enEntries]) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('영어 문구에 한글이 섞여 있지 않다', () => {
    // 번역을 빠뜨리면 영어 화면에 한국어가 그대로 남는다.
    for (const [key, value] of enEntries) {
      expect(/[가-힣]/.test(value), `${key}: ${value}`).toBe(false);
    }
  });

  it('두 언어가 실제로 다른 문장을 낸다', () => {
    // 복사만 해 두고 번역하지 않은 항목을 찾는다. 고유명사와 숫자 표기는
    // 같아도 정상이라 제외한다.
    const same = koEntries.filter(([key, value]) => {
      const other = enEntries.find(([k]) => k === key)?.[1];
      return other === value;
    });
    const allowed = new Set(['line.checkTitle', 'format.seconds', 'format.minutes']);
    const unexpected = same.map(([k]) => k).filter((k) => !allowed.has(k));
    expect(unexpected).toEqual([]);
  });
});

describe('언어 결정', () => {
  it('설정에 언어가 박혀 있으면 시스템을 무시한다', () => {
    expect(resolveLocale('ko', 'en-US')).toBe('ko');
    expect(resolveLocale('en', 'ko-KR')).toBe('en');
  });

  it("'auto'는 시스템 언어를 따른다", () => {
    expect(resolveLocale('auto', 'ko-KR')).toBe('ko');
    expect(resolveLocale('auto', 'ko_KR.UTF-8')).toBe('ko');
    expect(resolveLocale('auto', 'KO')).toBe('ko');
    expect(resolveLocale('auto', 'en-GB')).toBe('en');
  });

  it('시스템 언어를 모르면 영어로 간다', () => {
    // 받는 사람 대부분이 한국어 사용자가 아니다. 알아듣지 못하는 말로
    // 인사하는 것보다는 영어가 낫다.
    expect(resolveLocale('auto', undefined)).toBe('en');
    expect(resolveLocale('auto', '')).toBe('en');
  });

  it('셸 환경변수는 LC_ALL → LC_MESSAGES → LANG 순으로 본다', () => {
    expect(localeFromEnv({ LC_ALL: 'ko_KR.UTF-8', LANG: 'en_US.UTF-8' })).toBe('ko_KR.UTF-8');
    expect(localeFromEnv({ LC_MESSAGES: 'ko_KR.UTF-8', LANG: 'en_US.UTF-8' })).toBe('ko_KR.UTF-8');
    expect(localeFromEnv({ LANG: 'en_US.UTF-8' })).toBe('en_US.UTF-8');
    expect(localeFromEnv({})).toBeUndefined();
  });

  it('applyLocale은 정한 언어를 실제로 적용한다', () => {
    expect(applyLocale('auto', 'ko-KR')).toBe('ko');
    expect(locale()).toBe('ko');
    expect(t().tray.quit).toBe('종료');
  });
});

describe('언어가 실제 출력에 반영된다', () => {
  const resetsAt = 2 * 3600_000 + 14 * 60_000;

  it('남은 시간 표기가 언어를 따른다', () => {
    setLocale('ko');
    expect(formatRemaining(resetsAt, 0)).toBe('2시간 14분');
    setLocale('en');
    expect(formatRemaining(resetsAt, 0)).toBe('2h 14m');
  });

  it('캐릭터 대사가 언어를 따른다', () => {
    const event = {
      window: 'fiveHour' as const,
      threshold: 100,
      percent: 100,
      resetsAt,
      severity: 'critical' as const,
    };

    setLocale('ko');
    const korean = lineForThreshold(event, 0);
    setLocale('en');
    const english = lineForThreshold(event, 0);

    expect(korean.title).not.toBe(english.title);
    expect(/[가-힣]/.test(english.title)).toBe(false);
    expect(/[가-힣]/.test(english.detail)).toBe(false);
    // 표정과 유지 시간은 언어와 무관하다.
    expect(english.expression).toBe(korean.expression);
    expect(english.holdMs).toBe(korean.holdMs);
  });
});
