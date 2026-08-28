import { execFile } from 'node:child_process';
import { powerMonitor } from 'electron';

/**
 * 사용자가 자리에 있는지 본다.
 *
 * 이 앱은 '못 보면 소용없는' 알림이다. 자리를 비웠거나 화면이 꺼져 있는
 * 동안 캐릭터가 떴다 사라지면 아무 일도 하지 않은 것과 같다. 그래서
 * 마지막 입력 이후 시간을 보고, 사람이 없으면 기다린다.
 *
 * Electron의 powerMonitor.getSystemIdleTime()은 X11의 XScreenSaver 확장에
 * 기대는데, GNOME Wayland에서는 입력을 전혀 보지 못해 항상 0을 돌려준다.
 * 실제로 이 환경에서 1분 넘게 손을 대지 않아도 0이었다. 그래서 GNOME이
 * 스스로 쓰는 Mutter IdleMonitor를 먼저 시도하고, 없으면 powerMonitor로
 * 물러난다.
 */

const GDBUS_ARGS = [
  'call',
  '--session',
  '--dest',
  'org.gnome.Mutter.IdleMonitor',
  '--object-path',
  '/org/gnome/Mutter/IdleMonitor/Core',
  '--method',
  'org.gnome.Mutter.IdleMonitor.GetIdletime',
];

const DBUS_TIMEOUT_MS = 1_500;

/** 어느 방법이 되는지 한 번만 정한다. 매번 실패하는 경로를 다시 밟지 않는다. */
type Source = 'unknown' | 'mutter' | 'power-monitor';
let source: Source = 'unknown';

function queryMutter(): Promise<number | null> {
  return new Promise((resolve) => {
    execFile('gdbus', GDBUS_ARGS, { timeout: DBUS_TIMEOUT_MS }, (err, stdout) => {
      if (err) return resolve(null);
      // 응답 형식: `(uint64 59415,)` — 밀리초다.
      // 타입 이름 뒤의 숫자를 잡아야 한다. 그냥 첫 숫자를 찾으면
      // 'uint64'의 64를 물어 와서, 언제나 '방금 입력이 있었다'가 된다.
      const m = /uint64\s+(\d+)/.exec(stdout);
      resolve(m ? Number(m[1]) : null);
    });
  });
}

/** 마지막 입력 이후 지난 시간(ms). 알 수 없으면 null. */
export async function idleMs(): Promise<number | null> {
  if (source !== 'power-monitor') {
    const v = await queryMutter();
    if (v !== null) {
      source = 'mutter';
      return v;
    }
    if (source === 'unknown') source = 'power-monitor';
  }

  const sec = powerMonitor.getSystemIdleTime();
  return sec * 1000;
}

/** 화면이 잠겨 있는지. 잠겨 있으면 무슨 수를 써도 보이지 않는다. */
export function isLocked(): boolean {
  try {
    return powerMonitor.getSystemIdleState(60) === 'locked';
  } catch {
    return false;
  }
}

/** 진단용 — 어떤 방법으로 읽고 있는지. */
export function idleSource(): Source {
  return source;
}

/** 테스트에서 판정을 초기화한다. */
export function resetIdleSource(): void {
  source = 'unknown';
}

/**
 * 이 시간보다 오래 입력이 없으면 자리에 없는 것으로 본다.
 *
 * 너무 짧으면 잠깐 생각하는 동안에도 '없음'이 되고, 너무 길면 정말
 * 자리를 비웠는데도 알림이 그냥 사라진다.
 */
export const AWAY_MS = 20_000;

/** 사람이 자리에 있는지. 판단할 수 없으면 있다고 본다 — 기다리다 놓치는 것보다 낫다. */
export async function isUserPresent(): Promise<boolean> {
  if (isLocked()) return false;
  const idle = await idleMs();
  if (idle === null) return true;
  return idle < AWAY_MS;
}
