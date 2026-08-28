import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

/**
 * 앱이 쓰는 경로들. 메인 프로세스와 훅 설치기가 같은 값을 봐야 하므로
 * 한곳에 모은다. 셸 훅 스크립트도 이것과 똑같은 규칙으로 경로를 만든다.
 */

/**
 * 세션이 끝나면 사라져야 하는 것들의 자리.
 *
 * XDG_RUNTIME_DIR이 있으면 그쪽을 쓴다 — 로그아웃 시 자동으로 지워지고
 * 권한이 사용자 전용이라 스풀을 두기에 알맞다. 없으면 tmp 아래에
 * uid를 붙여 다른 사용자와 섞이지 않게 한다.
 */
export function runtimeDir(): string {
  const xdg = process.env['XDG_RUNTIME_DIR'];
  if (xdg) return join(xdg, 'claude-usage-tracker');
  return join(tmpdir(), `claude-usage-tracker-${userInfo().uid}`);
}

/** 훅이 이벤트 파일을 떨어뜨리는 곳. */
export function eventSpoolDir(): string {
  return join(runtimeDir(), 'events');
}

/** 설정·상태처럼 재부팅 후에도 남아야 하는 것들. */
export function configDir(): string {
  const base = process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config');
  return join(base, 'claude-usage-tracker');
}

/** 설치된 훅 스크립트의 위치. */
export function hookScriptPath(): string {
  return join(configDir(), 'hooks', 'notify.sh');
}

/** Claude Code 설정 파일. */
export function claudeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}
