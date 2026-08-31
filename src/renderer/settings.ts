import {
  ANCHORS,
  CORNERS,
  LANGUAGES,
  normalizeThresholds,
  type Settings,
} from '../shared/settings.js';
import { applyLocale, locale, t, type LanguagePreference } from '../shared/i18n/index.js';
import type { SettingsApi } from '../preload/settings.js';

declare global {
  interface Window {
    settings: SettingsApi;
  }
}

/**
 * 설정 화면.
 *
 * 저장 버튼이 없다. 값을 바꾸면 바로 적용되고 저장된다 — 설정이 열 개도
 * 안 되는 화면에서 저장 버튼은 사용자가 눌렀는지 아닌지만 헷갈리게 한다.
 */

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element not found: ${id}`);
  return el as T;
};

const els = {
  status: $<HTMLParagraphElement>('status-line'),
  thresholds: $<HTMLInputElement>('thresholds'),
  thresholdsError: $<HTMLParagraphElement>('thresholds-error'),
  hold: $<HTMLInputElement>('hold'),
  holdOut: $<HTMLOutputElement>('hold-out'),
  waitAway: $<HTMLInputElement>('wait-away'),
  interval: $<HTMLInputElement>('interval'),
  intervalOut: $<HTMLOutputElement>('interval-out'),
  character: $<HTMLInputElement>('character'),
  display: $<HTMLSelectElement>('display'),
  displayHint: $<HTMLParagraphElement>('display-hint'),
  anchor: $<HTMLSelectElement>('anchor'),
  anchorHint: $<HTMLParagraphElement>('anchor-hint'),
  corner: $<HTMLSelectElement>('corner'),
  margin: $<HTMLInputElement>('margin'),
  marginOut: $<HTMLOutputElement>('margin-out'),
  preview: $<HTMLButtonElement>('preview'),
  greet: $<HTMLInputElement>('greet'),
  hookToggle: $<HTMLButtonElement>('hook-toggle'),
  hookState: $<HTMLSpanElement>('hook-state'),
  autostart: $<HTMLInputElement>('autostart'),
  openLogs: $<HTMLButtonElement>('open-logs'),
  reset: $<HTMLButtonElement>('reset'),
  paths: $<HTMLParagraphElement>('paths'),
  saved: $<HTMLParagraphElement>('saved'),
  language: $<HTMLSelectElement>('language'),
};

let savedTimer: number | null = null;

function flashSaved(): void {
  els.saved.hidden = false;
  if (savedTimer !== null) clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => {
    els.saved.hidden = true;
  }, 1400);
}

function formatSeconds(sec: number): string {
  const f = t().format;
  if (sec < 60) return f.seconds(sec);
  return f.minutesSeconds(Math.floor(sec / 60), sec % 60);
}

function render(settings: Settings): void {
  els.thresholds.value = settings.thresholds.join(', ');
  els.hold.value = String(settings.holdSec);
  els.holdOut.textContent = t().format.seconds(settings.holdSec);
  els.waitAway.checked = settings.waitWhenAway;
  els.interval.value = String(settings.pollIntervalSec);
  els.intervalOut.textContent = formatSeconds(settings.pollIntervalSec);
  els.character.checked = settings.characterEnabled;
  els.display.value = String(settings.display);
  const c = t().settings;
  const displayHints: Record<string, string> = {
    all: c.displayHintAll,
    primary: c.displayHintPrimary,
    cursor: c.displayHintCursor,
  };
  els.displayHint.textContent =
    displayHints[String(settings.display)] ?? c.displayHintSpecific;
  els.anchor.value = settings.anchor;
  els.anchorHint.textContent =
    settings.anchor === 'window' ? c.anchorHintWindow : c.anchorHintScreen;
  els.language.value = settings.language;
  els.corner.value = settings.corner;
  els.margin.value = String(settings.margin);
  els.marginOut.textContent = `${settings.margin}px`;
  els.greet.checked = settings.greetOnSessionStart;
  els.autostart.checked = settings.autostart;

  // 캐릭터를 끄면 위치·여백·미리보기는 의미가 없다.
  for (const el of [els.anchor, els.corner, els.margin, els.preview]) {
    el.disabled = !settings.characterEnabled;
  }
}

async function save(patch: Partial<Settings>): Promise<void> {
  render(await window.settings.write(patch));
  flashSaved();
}

function renderHookState(installed: boolean): void {
  const c = t().settings;
  els.hookState.textContent = installed ? c.hookInstalled : c.hookMissing;
  els.hookState.className = `pill ${installed ? 'on' : 'off'}`;
  els.hookToggle.textContent = installed ? c.hookRemove : c.hookInstall;
  els.hookToggle.classList.toggle('ghost', installed);
}

/** 모니터 목록을 채운다. 앱이 뜬 뒤 모니터가 바뀔 수 있으므로 매번 다시 만든다. */
function renderDisplays(status: Awaited<ReturnType<typeof window.settings.status>>, selected: string): void {
  els.display.replaceChildren();

  const c = t().settings;
  const fixed: Array<[string, string]> = [
    ['all', c.displayAll],
    ['primary', c.displayPrimary],
    ['cursor', c.displayCursor],
  ];
  for (const [value, label] of fixed) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    els.display.append(opt);
  }

  for (const d of status.displays) {
    const opt = document.createElement('option');
    opt.value = String(d.id);
    const tags = [
      d.primary ? c.monitorTagPrimary : '',
      d.hasCursor ? c.monitorTagCursor : '',
    ].filter(Boolean);
    opt.textContent = `${d.label}${tags.length ? ` · ${tags.join(' · ')}` : ''}`;
    els.display.append(opt);
  }

  els.display.value = selected;
}

async function refreshStatus(): Promise<void> {
  const status = await window.settings.status();
  renderDisplays(status, String((await window.settings.read()).display));
  renderHookState(status.hooksInstalled);

  const c = t().settings;
  const plan = status.subscription ? c.planKnown(status.subscription) : c.planUnknown;
  els.status.textContent = status.lastError ? `${plan} · ⚠ ${status.lastError}` : plan;
  els.paths.textContent = `${status.settingsPath}\n${status.logPath}`;
}

/* ---------- 이벤트 ---------- */

els.thresholds.addEventListener('change', () => {
  const parsed = els.thresholds.value
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  const cleaned = normalizeThresholds(parsed);

  // 입력이 통째로 버려졌으면 사용자에게 알린다. 조용히 기본값으로
  // 되돌려 놓으면 왜 안 먹었는지 알 길이 없다.
  const dropped = parsed.length > 0 && cleaned.join() !== [...new Set(parsed)].sort((a, b) => a - b).join();
  els.thresholdsError.hidden = !dropped;
  els.thresholdsError.textContent = dropped ? t().settings.thresholdsError : '';
  els.thresholds.setAttribute('aria-invalid', String(dropped));

  void save({ thresholds: cleaned });
});

els.hold.addEventListener('input', () => {
  els.holdOut.textContent = t().format.seconds(Number(els.hold.value));
});
els.hold.addEventListener('change', () => void save({ holdSec: Number(els.hold.value) }));
els.waitAway.addEventListener('change', () => void save({ waitWhenAway: els.waitAway.checked }));

els.interval.addEventListener('input', () => {
  els.intervalOut.textContent = formatSeconds(Number(els.interval.value));
});
els.interval.addEventListener('change', () =>
  void save({ pollIntervalSec: Number(els.interval.value) }),
);

els.margin.addEventListener('input', () => {
  els.marginOut.textContent = `${els.margin.value}px`;
});
els.margin.addEventListener('change', () => void save({ margin: Number(els.margin.value) }));

els.character.addEventListener('change', () =>
  void save({ characterEnabled: els.character.checked }),
);
els.display.addEventListener('change', () => {
  const v = els.display.value;
  const fixed = v === 'all' || v === 'cursor' || v === 'primary';
  void save({ display: fixed ? v : Number(v) });
});
els.anchor.addEventListener('change', () =>
  void save({ anchor: els.anchor.value as Settings['anchor'] }),
);
els.corner.addEventListener('change', () =>
  void save({ corner: els.corner.value as Settings['corner'] }),
);
els.greet.addEventListener('change', () =>
  void save({ greetOnSessionStart: els.greet.checked }),
);
els.autostart.addEventListener('change', () => void save({ autostart: els.autostart.checked }));

els.preview.addEventListener('click', () => window.settings.preview());
els.openLogs.addEventListener('click', () => window.settings.openLogs());

els.reset.addEventListener('click', async () => {
  render(await window.settings.reset());
  flashSaved();
});

els.hookToggle.addEventListener('click', async () => {
  els.hookToggle.disabled = true;
  try {
    const installed = els.hookState.classList.contains('on');
    const ok = installed
      ? await window.settings.uninstallHooks()
      : await window.settings.installHooks();
    if (!ok) {
      els.status.textContent = t().settings.hookFailed;
    }
    await refreshStatus();
  } finally {
    els.hookToggle.disabled = false;
  }
});

/* ---------- 초기화 ---------- */

/**
 * data-i18n 이 붙은 요소를 문구표로 채운다.
 *
 * HTML에 문구를 두면 언어를 늘릴 때 마크업을 복제하게 된다. 마크업은
 * 한 벌만 두고 글자만 갈아 끼운다.
 */
function applyStaticText(): void {
  const c = t().settings as unknown as Record<string, unknown>;
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset['i18n'];
    if (key === undefined) continue;
    const value = c[key];
    if (typeof value === 'string') el.textContent = value;
  }
  // 자간·줄바꿈 규칙이 언어마다 다르다. 브라우저에 어느 언어인지 알린다.
  document.documentElement.lang = locale();
}

function option(value: string, label: string): HTMLOptionElement {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  return opt;
}

function fillSelects(): void {
  // 언어 이름은 번역하지 않는다 — 알아볼 수 없는 언어로 적힌 언어 이름은
  // 고를 수가 없다.
  const languageLabel: Record<LanguagePreference, string> = {
    auto: t().settings.languageAuto,
    en: 'English',
    ko: '한국어',
  };
  els.language.replaceChildren(...LANGUAGES.map((l) => option(l, languageLabel[l])));
  els.anchor.replaceChildren(...ANCHORS.map((a) => option(a, t().anchorLabel[a])));
  els.corner.replaceChildren(...CORNERS.map((c) => option(c, t().cornerLabel[c])));
}

/** 화면 전체를 지금 언어로 다시 그린다. */
async function paint(settings: Settings): Promise<void> {
  applyStaticText();
  fillSelects();
  render(settings);
  await refreshStatus();
}

els.language.addEventListener('change', () => {
  void (async () => {
    const next = await window.settings.write({
      language: els.language.value as LanguagePreference,
    });
    applyLocale(next.language, navigator.language);
    await paint(next);
    flashSaved();
  })();
});

void (async () => {
  const settings = await window.settings.read();
  // 무엇을 그리기 전에 언어부터 정한다. 한 번 그린 뒤 갈아 끼우면 깜박인다.
  applyLocale(settings.language, navigator.language);
  await paint(settings);
})();
