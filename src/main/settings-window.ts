import { BrowserWindow, ipcMain, screen, shell } from 'electron';
import { t } from '../shared/i18n/index.js';
import { join } from 'node:path';
import { SETTINGS_IPC, type AppStatus, type DisplayInfo } from '../shared/settings-ipc.js';
import { hooksInstalled, installHooks, uninstallHooks } from '../hooks/install.js';
import { claudeSettingsPath } from '../shared/runtime-paths.js';
import { logDir, logPath } from './logger.js';
import type { SettingsStore } from './settings-store.js';
import type { Settings } from '../shared/settings.js';
import type { Logger } from './logger.js';

/**
 * 설정 창과 그 IPC.
 *
 * 창은 하나만 뜬다. 닫아도 앱은 살아 있다 — 이 앱의 정상 상태는 창이
 * 없는 것이다.
 */

export interface SettingsWindowDeps {
  store: SettingsStore;
  logger: Logger;
  /** 설정 화면의 '지금 띄워 보기'. */
  preview: () => void;
  /** 상태 줄에 표시할 플랜. */
  subscription: () => string | null;
  /** 마지막 조회 오류. 없으면 null. */
  lastError: () => string | null;
  preloadPath: string;
  rendererUrl?: string;
  rendererFile: string;
}

let win: BrowserWindow | null = null;
let wired = false;

function createWindow(deps: SettingsWindowDeps): BrowserWindow {
  const w = new BrowserWindow({
    width: 680,
    height: 760,
    minWidth: 460,
    minHeight: 480,
    title: t().settings.windowTitle,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  w.once('ready-to-show', () => w.show());
  w.on('closed', () => {
    win = null;
  });

  if (deps.rendererUrl) void w.loadURL(deps.rendererUrl);
  else void w.loadFile(deps.rendererFile);

  return w;
}

/** IPC 핸들러를 한 번만 등록한다. 창을 여닫아도 중복 등록되면 안 된다. */
function wire(deps: SettingsWindowDeps): void {
  if (wired) return;
  wired = true;

  ipcMain.handle(SETTINGS_IPC.read, (): Settings => deps.store.value);

  ipcMain.handle(SETTINGS_IPC.write, async (_e, patch: Partial<Settings>): Promise<Settings> => {
    const ok = await deps.store.update(patch);
    if (!ok) deps.logger.warn(t().log.settingsSaveFailed);
    return deps.store.value;
  });

  ipcMain.handle(SETTINGS_IPC.reset, async (): Promise<Settings> => {
    await deps.store.reset();
    deps.logger.info(t().log.settingsReset);
    return deps.store.value;
  });

  ipcMain.handle(SETTINGS_IPC.status, async (): Promise<AppStatus> => ({
    displays: listDisplays(),
    hooksInstalled: await hooksInstalled(),
    settingsPath: claudeSettingsPath(),
    logPath: logPath(),
    subscription: deps.subscription(),
    lastError: deps.lastError(),
  }));

  ipcMain.handle(SETTINGS_IPC.installHooks, async (): Promise<boolean> => {
    try {
      const r = await installHooks();
      deps.logger.info(t().log.hookInstalled(r.scriptPath));
      return true;
    } catch (e) {
      deps.logger.error(t().log.hookInstallFailed(e instanceof Error ? e.message : String(e)));
      return false;
    }
  });

  ipcMain.handle(SETTINGS_IPC.uninstallHooks, async (): Promise<boolean> => {
    try {
      await uninstallHooks();
      deps.logger.info(t().log.hookRemoved);
      return true;
    } catch (e) {
      deps.logger.error(t().log.hookRemoveFailed(e instanceof Error ? e.message : String(e)));
      return false;
    }
  });

  ipcMain.on(SETTINGS_IPC.openLogs, () => {
    void shell.openPath(logDir());
  });

  ipcMain.on(SETTINGS_IPC.preview, () => deps.preview());
}

/** 설정 창을 연다. 이미 열려 있으면 앞으로 가져온다. */
export function openSettings(deps: SettingsWindowDeps): void {
  wire(deps);
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  win = createWindow(deps);
}

/**
 * 고를 수 있는 모니터 목록.
 *
 * 사람이 알아볼 수 있는 이름을 붙인다 — id만 보여주면 어느 것이 어느
 * 화면인지 알 수 없다. 방향과 해상도면 대개 충분하다.
 */
function listDisplays(): DisplayInfo[] {
  const primaryId = screen.getPrimaryDisplay().id;
  const cursorId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;

  return screen.getAllDisplays().map((d) => {
    const orientation =
      d.bounds.height > d.bounds.width
        ? t().settings.orientationPortrait
        : t().settings.orientationLandscape;
    return {
      id: d.id,
      label: `${orientation} ${d.bounds.width}×${d.bounds.height}`,
      primary: d.id === primaryId,
      hasCursor: d.id === cursorId,
    };
  });
}

/** 개발 서버가 있으면 그쪽, 없으면 빌드된 파일. */
export function settingsRendererTarget(dir: string): {
  rendererUrl?: string;
  rendererFile: string;
} {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  const file = join(dir, '../renderer/settings.html');
  return devUrl ? { rendererUrl: `${devUrl}/settings.html`, rendererFile: file } : { rendererFile: file };
}
