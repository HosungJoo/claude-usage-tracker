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

/**
 * 지금 누가 사용량을 조회하고 있는지 적어두는 자리.
 *
 * 트레이 앱과 VS Code 확장이 각자 60초마다 API를 두드리면 창을 몇 개만
 * 열어도 429가 난다. 먼저 자리를 잡은 쪽만 조회하고 나머지는 그 결과를
 * 받아 쓰기 위해, 임차 기한이 있는 표식을 여기 둔다.
 */
export function pollerLockPath(): string {
  return join(runtimeDir(), 'poller.lock');
}

/** 조회한 쪽이 결과를 놓아두는 자리. 나머지 프로세스가 이것을 읽는다. */
export function snapshotPath(): string {
  return join(runtimeDir(), 'snapshot.json');
}

/**
 * VS Code가 화면을 잡고 있다는 표시.
 *
 * 같은 임계값을 패널 카드와 전 화면 오버레이가 동시에 알리면 알림이 아니라
 * 소음이다. 패널이 보이는 동안에는 패널이 맡는다.
 */
export function focusClaimPath(): string {
  return join(runtimeDir(), 'focus.claim');
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
