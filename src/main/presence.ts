import { execFile } from 'node:child_process';
import { powerMonitor } from 'electron';

/**
 * 사용자가 자리에 있는지 본다.
 *
 * 이 앱은 '못 보면 소용없는' 알림이다. 자리를 비웠거나 화면이 꺼져 있는
 * 동안 캐릭터가 떴다 사라지면 아무 일도 하지 않은 것과 같다. 그래서
 * 마지막 입력 이후 시간을 보고, 사람이 없으면 기다린다.
 *
 * Electron의 powerMonitor는 둘 다 freedesktop 표준 인터페이스에 기대는데
 * GNOME Wayland에서는 둘 다 쓸 수 없다.
 * - getSystemIdleTime()은 X11의 XScreenSaver 확장을 보므로 언제나 0이다.
 *   실제로 이 환경에서 1분 넘게 손을 대지 않아도 0이었다.
 * - getSystemIdleState()는 org.freedesktop.ScreenSaver.GetActive 를 부르는데,
 *   Mutter는 그 이름을 가지고 있으면서 메서드는 구현하지 않는다. 호출은
 *   NotSupported로 실패하고, Electron이 그 실패를 stderr에 직접 찍는다.
 *
 * 그래서 두 값 모두 GNOME이 스스로 쓰는 인터페이스를 먼저 물어보고,
 * 없을 때만 powerMonitor로 물러난다.
 */

const IDLE_ARGS = [
  'call',
  '--session',
  '--dest',
  'org.gnome.Mutter.IdleMonitor',
  '--object-path',
  '/org/gnome/Mutter/IdleMonitor/Core',
  '--method',
  'org.gnome.Mutter.IdleMonitor.GetIdletime',
];

const LOCK_ARGS = [
  'call',
  '--session',
  '--dest',
  'org.gnome.ScreenSaver',
  '--object-path',
  '/org/gnome/ScreenSaver',
  '--method',
  'org.gnome.ScreenSaver.GetActive',
];

const DBUS_TIMEOUT_MS = 1_500;

/** 어느 방법이 되는지 한 번만 정한다. 매번 실패하는 경로를 다시 밟지 않는다. */
type Source = 'unknown' | 'gnome' | 'power-monitor';
let idleSrc: Source = 'unknown';
let lockSrc: Source = 'unknown';

function gdbus(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('gdbus', args, { timeout: DBUS_TIMEOUT_MS }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

/** 마지막 입력 이후 지난 시간(ms). 알 수 없으면 null. */
export async function idleMs(): Promise<number | null> {
  if (idleSrc !== 'power-monitor') {
    const out = await gdbus(IDLE_ARGS);
    // 응답 형식: `(uint64 59415,)` — 밀리초다.
    // 타입 이름 뒤의 숫자를 잡아야 한다. 그냥 첫 숫자를 찾으면
    // 'uint64'의 64를 물어 와서, 언제나 '방금 입력이 있었다'가 된다.
    const m = out === null ? null : /uint64\s+(\d+)/.exec(out);
    if (m) {
      idleSrc = 'gnome';
      return Number(m[1]);
    }
    if (idleSrc === 'unknown') idleSrc = 'power-monitor';
  }

  const sec = powerMonitor.getSystemIdleTime();
  return sec * 1000;
}

/** 화면이 잠겨 있는지. 잠겨 있으면 무슨 수를 써도 보이지 않는다. */
export async function isLocked(): Promise<boolean> {
  if (lockSrc !== 'power-monitor') {
    // 응답 형식: `(true,)`.
    const out = await gdbus(LOCK_ARGS);
    const m = out === null ? null : /\((true|false),/.exec(out);
    if (m) {
      lockSrc = 'gnome';
      return m[1] === 'true';
    }
    if (lockSrc === 'unknown') lockSrc = 'power-monitor';
  }

  try {
    return powerMonitor.getSystemIdleState(60) === 'locked';
  } catch {
    return false;
  }
}

/** 진단용 — 어떤 방법으로 읽고 있는지. */
export function idleSource(): Source {
  return idleSrc;
}

export function lockSource(): Source {
  return lockSrc;
}

/** 테스트에서 판정을 초기화한다. */
export function resetPresenceSources(): void {
  idleSrc = 'unknown';
  lockSrc = 'unknown';
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
  if (await isLocked()) return false;
  const idle = await idleMs();
  if (idle === null) return true;
  return idle < AWAY_MS;
}
