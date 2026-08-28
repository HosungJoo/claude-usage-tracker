/**
 * 설정 창의 IPC 계약.
 *
 * 메인과 preload가 **둘 다** 이 이름들을 알아야 한다. preload 모듈에 두면
 * 메인이 그것을 import하는 순간 contextBridge 호출까지 메인 번들로 딸려
 * 들어와 앱이 뜨자마자 죽는다 — 메인 프로세스에는 contextBridge가 없다.
 */

export const SETTINGS_IPC = {
  read: 'settings:read',
  write: 'settings:write',
  reset: 'settings:reset',
  status: 'settings:status',
  installHooks: 'settings:install-hooks',
  uninstallHooks: 'settings:uninstall-hooks',
  openLogs: 'settings:open-logs',
  preview: 'settings:preview',
} as const;

/** 설정 화면에서 고를 수 있는 모니터. */
export interface DisplayInfo {
  id: number;
  label: string;
  primary: boolean;
  /** 지금 커서가 이 화면에 있는지. */
  hasCursor: boolean;
}

/** 설정 화면에 함께 보여줄 상태. 설정만으로는 알 수 없는 것들이다. */
export interface AppStatus {
  displays: DisplayInfo[];
  hooksInstalled: boolean;
  settingsPath: string;
  logPath: string;
  subscription: string | null;
  lastError: string | null;
}
