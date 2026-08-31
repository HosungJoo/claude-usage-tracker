import { t } from '../shared/i18n/index.js';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * 로그인 시 자동 실행.
 *
 * Electron의 setLoginItemSettings는 리눅스에서 동작이 들쭉날쭉하다.
 * XDG autostart 규격은 GNOME·KDE·XFCE가 모두 따르므로, .desktop 파일을
 * 직접 놓는 쪽이 예측 가능하다.
 */

const FILE_NAME = 'claude-usage-tracker.desktop';

export function autostartDir(): string {
  const base = process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config');
  return join(base, 'autostart');
}

export function autostartPath(): string {
  return join(autostartDir(), FILE_NAME);
}

export interface AutostartTarget {
  /** 실행할 명령. 보통 AppImage 경로 또는 `electron .`. */
  exec: string;
}

/**
 * .desktop 내용을 만든다. 순수 함수.
 *
 * `X-GNOME-Autostart-Delay`를 두는 이유: 로그인 직후에는 네트워크가 아직
 * 붙지 않아 첫 조회가 실패한다. 몇 초 늦게 뜨면 그 실패를 아예 겪지 않는다.
 */
export function desktopEntry(target: AutostartTarget): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Claude Usage Tracker',
    `Comment=${t().appComment}`,
    `Exec=${target.exec}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    'X-GNOME-Autostart-Delay=8',
    '',
  ].join('\n');
}

/** 자동 시작을 켠다. */
export async function enableAutostart(target: AutostartTarget, path = autostartPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, desktopEntry(target));
}

/** 자동 시작을 끈다. 이미 꺼져 있어도 오류가 아니다. */
export async function disableAutostart(path = autostartPath()): Promise<void> {
  await rm(path, { force: true });
}

/** 현재 켜져 있는지. */
export async function isAutostartEnabled(path = autostartPath()): Promise<boolean> {
  try {
    const text = await readFile(path, 'utf8');
    // 파일은 있는데 비활성으로 표시된 경우도 꺼진 것으로 본다.
    return !/X-GNOME-Autostart-enabled\s*=\s*false/i.test(text);
  } catch {
    return false;
  }
}

/**
 * 설정 값에 맞춰 자동 시작을 맞춘다.
 *
 * @returns 실제로 적용됐는지. 실패해도 던지지 않는다 — 자동 시작 하나
 *   때문에 설정 저장 전체가 실패하면 안 된다.
 */
export async function applyAutostart(
  enabled: boolean,
  target: AutostartTarget,
  path = autostartPath(),
): Promise<boolean> {
  try {
    if (enabled) await enableAutostart(target, path);
    else await disableAutostart(path);
    return true;
  } catch {
    return false;
  }
}
