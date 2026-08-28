import { DEFAULT_THRESHOLDS } from '../core/thresholds.js';
import type { Corner } from '../main/overlay-window.js';

/**
 * 사용자 설정.
 *
 * 메인과 설정 화면이 같은 정의를 봐야 하므로 shared에 둔다. 검증도 여기서
 * 한다 — 설정 파일은 사람이 직접 열어 고칠 수 있고, 그때 앱이 뜨지 않으면
 * 되돌릴 방법이 없어진다.
 */

export interface Settings {
  /** 발화 임계값(%). 오름차순, 중복 없음. */
  thresholds: number[];
  /** 폴링 주기(초). */
  pollIntervalSec: number;
  /** 오버레이가 붙을 화면 모서리. */
  corner: Corner;
  /** 화면 가장자리로부터의 여백(px). */
  margin: number;
  /** 말풍선이 머무는 시간 배율. 1이 기본. */
  holdScale: number;
  /** 캐릭터를 띄울지. 끄면 트레이 아이콘만 동작한다. */
  characterEnabled: boolean;
  /** 세션 시작 시 인사할지. */
  greetOnSessionStart: boolean;
  /** 로그인 시 자동 실행. */
  autostart: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  thresholds: [...DEFAULT_THRESHOLDS],
  pollIntervalSec: 60,
  corner: 'bottom-right',
  margin: 24,
  holdScale: 1,
  characterEnabled: true,
  greetOnSessionStart: true,
  autostart: false,
};

export const CORNERS: Corner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];

export const CORNER_LABEL: Record<Corner, string> = {
  'bottom-right': '오른쪽 아래',
  'bottom-left': '왼쪽 아래',
  'top-right': '오른쪽 위',
  'top-left': '왼쪽 위',
};

/** 폴링을 이보다 자주 하면 서버에 실례고, 이보다 드물면 알림이 늦다. */
export const MIN_POLL_SEC = 15;
export const MAX_POLL_SEC = 600;
export const MIN_MARGIN = 0;
export const MAX_MARGIN = 200;
export const MIN_HOLD_SCALE = 0.5;
export const MAX_HOLD_SCALE = 3;

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

/** 무엇이 들어오든 쓸 수 있는 설정으로 만든다. 절대 던지지 않는다. */
export function normalizeSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ...DEFAULT_SETTINGS };
  }
  const o = raw as Record<string, unknown>;

  return {
    thresholds: normalizeThresholds(o['thresholds']),
    pollIntervalSec: num(o['pollIntervalSec'], DEFAULT_SETTINGS.pollIntervalSec, MIN_POLL_SEC, MAX_POLL_SEC),
    corner: isCorner(o['corner']) ? o['corner'] : DEFAULT_SETTINGS.corner,
    margin: num(o['margin'], DEFAULT_SETTINGS.margin, MIN_MARGIN, MAX_MARGIN),
    holdScale: num(o['holdScale'], DEFAULT_SETTINGS.holdScale, MIN_HOLD_SCALE, MAX_HOLD_SCALE),
    characterEnabled: bool(o['characterEnabled'], DEFAULT_SETTINGS.characterEnabled),
    greetOnSessionStart: bool(o['greetOnSessionStart'], DEFAULT_SETTINGS.greetOnSessionStart),
    autostart: bool(o['autostart'], DEFAULT_SETTINGS.autostart),
  };
}
