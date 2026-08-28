import { contextBridge, ipcRenderer } from 'electron';
import type { Settings } from '../shared/settings.js';
import { SETTINGS_IPC, type AppStatus } from '../shared/settings-ipc.js';

/**
 * 설정 창 preload.
 *
 * 채널 이름과 AppStatus는 shared에 있다 — 메인도 같은 정의를 봐야 하는데,
 * 메인이 이 파일을 import하면 아래 contextBridge 호출까지 딸려 간다.
 */

const api = {
  read: (): Promise<Settings> => ipcRenderer.invoke(SETTINGS_IPC.read) as Promise<Settings>,
  write: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(SETTINGS_IPC.write, patch) as Promise<Settings>,
  reset: (): Promise<Settings> => ipcRenderer.invoke(SETTINGS_IPC.reset) as Promise<Settings>,
  status: (): Promise<AppStatus> => ipcRenderer.invoke(SETTINGS_IPC.status) as Promise<AppStatus>,
  installHooks: (): Promise<boolean> => ipcRenderer.invoke(SETTINGS_IPC.installHooks) as Promise<boolean>,
  uninstallHooks: (): Promise<boolean> =>
    ipcRenderer.invoke(SETTINGS_IPC.uninstallHooks) as Promise<boolean>,
  openLogs: (): void => ipcRenderer.send(SETTINGS_IPC.openLogs),
  /** 설정을 바꿔 보고 바로 캐릭터를 띄워 확인한다. */
  preview: (): void => ipcRenderer.send(SETTINGS_IPC.preview),
};

contextBridge.exposeInMainWorld('settings', api);

export type SettingsApi = typeof api;
export type { AppStatus };
