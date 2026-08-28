import {
  CORNERS,
  CORNER_LABEL,
  normalizeThresholds,
  type Settings,
} from '../shared/settings.js';
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
  if (!el) throw new Error(`요소를 찾을 수 없습니다: ${id}`);
  return el as T;
};

const els = {
  status: $<HTMLParagraphElement>('status-line'),
  thresholds: $<HTMLInputElement>('thresholds'),
  thresholdsError: $<HTMLParagraphElement>('thresholds-error'),
  hold: $<HTMLInputElement>('hold'),
  holdOut: $<HTMLOutputElement>('hold-out'),
  interval: $<HTMLInputElement>('interval'),
  intervalOut: $<HTMLOutputElement>('interval-out'),
  character: $<HTMLInputElement>('character'),
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
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}

function render(settings: Settings): void {
  els.thresholds.value = settings.thresholds.join(', ');
  els.hold.value = String(settings.holdScale);
  els.holdOut.textContent = `${settings.holdScale.toFixed(1)}배`;
  els.interval.value = String(settings.pollIntervalSec);
  els.intervalOut.textContent = formatSeconds(settings.pollIntervalSec);
  els.character.checked = settings.characterEnabled;
  els.corner.value = settings.corner;
  els.margin.value = String(settings.margin);
  els.marginOut.textContent = `${settings.margin}px`;
  els.greet.checked = settings.greetOnSessionStart;
  els.autostart.checked = settings.autostart;

  // 캐릭터를 끄면 위치·여백·미리보기는 의미가 없다.
  for (const el of [els.corner, els.margin, els.preview]) {
    el.disabled = !settings.characterEnabled;
  }
}

async function save(patch: Partial<Settings>): Promise<void> {
  render(await window.settings.write(patch));
  flashSaved();
}

function renderHookState(installed: boolean): void {
  els.hookState.textContent = installed ? '설치됨' : '설치 안 됨';
  els.hookState.className = `pill ${installed ? 'on' : 'off'}`;
  els.hookToggle.textContent = installed ? '훅 제거' : '훅 설치';
  els.hookToggle.classList.toggle('ghost', installed);
}

async function refreshStatus(): Promise<void> {
  const status = await window.settings.status();
  renderHookState(status.hooksInstalled);

  const plan = status.subscription ? `${status.subscription} 플랜` : '플랜 정보 없음';
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
  els.thresholdsError.textContent = dropped ? '1~100 사이의 값만 쓸 수 있습니다.' : '';
  els.thresholds.setAttribute('aria-invalid', String(dropped));

  void save({ thresholds: cleaned });
});

els.hold.addEventListener('input', () => {
  els.holdOut.textContent = `${Number(els.hold.value).toFixed(1)}배`;
});
els.hold.addEventListener('change', () => void save({ holdScale: Number(els.hold.value) }));

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
      els.status.textContent = '훅을 바꾸지 못했습니다. 로그를 확인해 주세요.';
    }
    await refreshStatus();
  } finally {
    els.hookToggle.disabled = false;
  }
});

/* ---------- 초기화 ---------- */

for (const corner of CORNERS) {
  const opt = document.createElement('option');
  opt.value = corner;
  opt.textContent = CORNER_LABEL[corner];
  els.corner.append(opt);
}

void (async () => {
  render(await window.settings.read());
  await refreshStatus();
})();
