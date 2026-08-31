import { DEFAULT_THRESHOLDS } from '../core/thresholds.js';
import type { Corner } from '../main/overlay-window.js';

import type { LanguagePreference } from './i18n/index.js';

/**
 * 사용자 설정.
 *
 * 메인과 설정 화면이 같은 정의를 봐야 하므로 shared에 둔다. 검증도 여기서
 * 한다 — 설정 파일은 사람이 직접 열어 고칠 수 있고, 그때 앱이 뜨지 않으면
 * 되돌릴 방법이 없어진다.
 */

/**
 * 캐릭터를 어디에 띄울지.
 *
 * 'center'  커서가 있는 화면 한가운데에 크게 — 놓치기 어렵다.
 * 'screen'  화면 모서리 — 작게, 방해가 덜하다.
 * 'window'  작업 중인 창의 모서리. 창을 찾지 못하면 화면 모서리로 물러난다.
 */
export type Anchor = 'center' | 'screen' | 'window';

export const ANCHORS: Anchor[] = ['center', 'screen', 'window'];

/**
 * 어느 모니터에 띄울지.
 *
 * 'all'     모든 모니터에 함께 — 기본값.
 * 'primary' 주 모니터.
 * 'cursor'  커서가 있는 화면.
 * 숫자      특정 모니터의 id.
 *
 * 기본이 'all'인 이유: **어느 화면을 보고 있는지 알아낼 방법이 없다.**
 * Wayland에서는 앱이 마우스 위치도, 다른 창의 위치도 물어볼 수 없다.
 * Electron은 XWayland의 포인터를 읽는데, XWayland는 자기 창 위에 있을 때만
 * 포인터를 보므로, 마우스가 네이티브 Wayland 창으로 넘어가면 좌표가
 * 마지막 위치에 멈춘 채로 남는다. 실측으로 확인했다 — 마우스를 다른
 * 모니터에서 크게 움직이는 6초 동안 좌표가 한 픽셀도 변하지 않았고, 그
 * 좌표는 반대편 모니터에 있는 창 안쪽이었다.
 *
 * 그래서 보고 있을 만한 곳을 맞히는 대신 모든 화면에 띄운다. 맞힐 필요가
 * 없으면 틀릴 일도 없다. 3초 뒤 사라지므로 오래 거슬리지 않고, 화면이
 * 하나뿐이면 어느 선택지든 결과가 같다.
 */
export type DisplayChoice = 'all' | 'cursor' | 'primary' | number;

export interface Settings {
  /** 화면 기준으로 띄울지, 작업 중인 창 기준으로 띄울지. */
  anchor: Anchor;
  /** 어느 모니터에 띄울지. */
  display: DisplayChoice;
  /** 발화 임계값(%). 오름차순, 중복 없음. */
  thresholds: number[];
  /** 폴링 주기(초). */
  pollIntervalSec: number;
  /** 오버레이가 붙을 화면 모서리. */
  corner: Corner;
  /** 화면 가장자리로부터의 여백(px). */
  margin: number;
  /**
   * 사용자가 자리에 있을 때 말풍선이 머무는 시간(초).
   *
   * 자리에 없으면 이 값과 상관없이 돌아올 때까지 기다린다 — 못 보는
   * 알림은 없는 알림이다.
   */
  holdSec: number;
  /** 자리를 비웠으면 돌아올 때까지 기다릴지. */
  waitWhenAway: boolean;
  /** 캐릭터를 띄울지. 끄면 트레이 아이콘만 동작한다. */
  characterEnabled: boolean;
  /** 세션 시작 시 인사할지. */
  greetOnSessionStart: boolean;
  /** 로그인 시 자동 실행. */
  autostart: boolean;
  /**
   * 화면에 나갈 언어. 'auto'는 시스템 언어를 따른다.
   *
   * 기본이 'auto'인 이유: 받는 사람 대부분이 한국어 사용자가 아니지만,
   * 한국어 데스크톱을 쓰는 사람에게 영어로 말할 이유도 없다.
   */
  language: LanguagePreference;
}

export const DEFAULT_SETTINGS: Settings = {
  // 한가운데 크게가 기본이다. 이 앱의 실패 방식은 '캐릭터가 떴는데 못 봤다'
  // 하나뿐이라, 눈에 띄는 쪽으로 기울인다.
  anchor: 'center',
  // 보고 있는 화면을 맞힐 수 없으므로 전부에 띄운다.
  display: 'all',
  thresholds: [...DEFAULT_THRESHOLDS],
  pollIntervalSec: 60,
  corner: 'top-left',
  margin: 24,
  holdSec: 3,
  waitWhenAway: true,
  characterEnabled: true,
  greetOnSessionStart: true,
  autostart: false,
  language: 'auto',
};

export const CORNERS: Corner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

/** 폴링을 이보다 자주 하면 서버에 실례고, 이보다 드물면 알림이 늦다. */
export const MIN_POLL_SEC = 15;
export const MAX_POLL_SEC = 600;
export const MIN_MARGIN = 0;
export const MAX_MARGIN = 200;
export const MIN_HOLD_SEC = 1;
export const MAX_HOLD_SEC = 30;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function num(value: unknown, fallback: number, lo: number, hi: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * 임계값 목록을 다듬는다.
 *
 * 정수로 맞추고, 1~100 밖은 버리고, 중복을 없애고 정렬한다. 남는 게
 * 없으면 기본값으로 돌아간다 — 임계값이 하나도 없으면 이 앱은 아무것도
 * 하지 않는 앱이 된다.
 */
export function normalizeThresholds(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_SETTINGS.thresholds];
  const cleaned = [
    ...new Set(
      value
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
        .map((v) => Math.round(v))
        .filter((v) => v >= 1 && v <= 100),
    ),
  ].sort((a, b) => a - b);
  return cleaned.length > 0 ? cleaned : [...DEFAULT_SETTINGS.thresholds];
}

function isCorner(value: unknown): value is Corner {
  return typeof value === 'string' && (CORNERS as string[]).includes(value);
}

export const LANGUAGES: LanguagePreference[] = ['auto', 'en', 'ko'];

function isLanguage(value: unknown): value is LanguagePreference {
  return typeof value === 'string' && (LANGUAGES as string[]).includes(value);
}

function isAnchor(value: unknown): value is Anchor {
  return typeof value === 'string' && (ANCHORS as string[]).includes(value);
}

function toDisplayChoice(value: unknown): DisplayChoice {
  if (value === 'all' || value === 'cursor' || value === 'primary') return value;
  // 모니터 id는 숫자다. 설정 파일에 문자열로 들어 있어도 받아 준다.
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_SETTINGS.display;
}

/** 무엇이 들어오든 쓸 수 있는 설정으로 만든다. 절대 던지지 않는다. */
export function normalizeSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS };
  }
  const o = raw as Record<string, unknown>;

  return {
    anchor: isAnchor(o['anchor']) ? o['anchor'] : DEFAULT_SETTINGS.anchor,
    display: toDisplayChoice(o['display']),
    thresholds: normalizeThresholds(o['thresholds']),
    pollIntervalSec: num(o['pollIntervalSec'], DEFAULT_SETTINGS.pollIntervalSec, MIN_POLL_SEC, MAX_POLL_SEC),
    corner: isCorner(o['corner']) ? o['corner'] : DEFAULT_SETTINGS.corner,
    margin: num(o['margin'], DEFAULT_SETTINGS.margin, MIN_MARGIN, MAX_MARGIN),
    holdSec: num(o['holdSec'], DEFAULT_SETTINGS.holdSec, MIN_HOLD_SEC, MAX_HOLD_SEC),
    waitWhenAway: bool(o['waitWhenAway'], DEFAULT_SETTINGS.waitWhenAway),
    characterEnabled: bool(o['characterEnabled'], DEFAULT_SETTINGS.characterEnabled),
    greetOnSessionStart: bool(o['greetOnSessionStart'], DEFAULT_SETTINGS.greetOnSessionStart),
    autostart: bool(o['autostart'], DEFAULT_SETTINGS.autostart),
    language: isLanguage(o['language']) ? o['language'] : DEFAULT_SETTINGS.language,
  };
}
