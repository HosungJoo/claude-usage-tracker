import { ko } from './ko.js';
import { en } from './en.js';
import type { Catalog } from './catalog.js';

export type { Catalog } from './catalog.js';

/**
 * 화면에 나가는 문구를 한곳에 모은다.
 *
 * 문구를 코드 안에 두면 언어를 늘릴 때마다 로직을 건드리게 된다. 반대로
 * 키-값 표만 두면 어순이 다른 언어에서 문장이 어색해진다 — '5시간 사용량을
 * 다 썼어'와 'You're out of your 5-hour usage'는 조각을 이어 붙여 만들 수
 * 없다. 그래서 값이 문자열이 아니라 **함수**다. 각 언어가 자기 어순으로
 * 문장을 완성한다.
 */

export type Locale = 'ko' | 'en';

/** 설정에 저장되는 값. 'auto'는 시스템 언어를 따른다. */
export type LanguagePreference = 'auto' | Locale;

const CATALOGS: Record<Locale, Catalog> = { ko, en };

/**
 * 기본은 영어다.
 *
 * 이 앱을 받는 사람 대부분이 한국어 사용자가 아니다. 알아듣지 못하는
 * 말로 인사하는 캐릭터는 알림이 아니라 잡음이다.
 */
let current: Locale = 'en';

/** 지금 쓰는 언어. */
export function locale(): Locale {
  return current;
}

/** 지금 쓰는 문구표. 부르는 쪽은 `t().tray.quit` 처럼 쓴다. */
export function t(): Catalog {
  return CATALOGS[current];
}

export function setLocale(next: Locale): void {
  current = next;
}

/**
 * 설정값과 시스템 언어로 실제 쓸 언어를 정한다.
 *
 * @param preference 설정에 저장된 값
 * @param systemLocale `app.getLocale()`, `navigator.language`, `$LANG` 등
 */
export function resolveLocale(
  preference: LanguagePreference,
  systemLocale?: string | undefined,
): Locale {
  if (preference !== 'auto') return preference;
  // ko, ko-KR, ko_KR.UTF-8 전부 한국어다.
  return systemLocale?.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

/** 설정값과 시스템 언어로 언어를 정하고 적용한다. */
export function applyLocale(
  preference: LanguagePreference,
  systemLocale?: string | undefined,
): Locale {
  const next = resolveLocale(preference, systemLocale);
  setLocale(next);
  return next;
}

/** 셸 환경변수에서 언어를 읽는다. CLI와 훅이 쓴다. */
export function localeFromEnv(env: Record<string, string | undefined>): string | undefined {
  return env['LC_ALL'] ?? env['LC_MESSAGES'] ?? env['LANG'];
}
