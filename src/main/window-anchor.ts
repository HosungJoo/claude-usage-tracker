import { execFile } from 'node:child_process';
import { basename } from 'node:path';

/**
 * 작업 중인 창을 찾아 그 좌표를 돌려준다.
 *
 * 왜 X11 도구를 쓰나: Wayland에는 앱이 다른 창의 위치를 묻는 표준 방법이
 * 없다. 반면 편집기와 터미널 대부분은 XWayland로 뜨므로 `xwininfo`로
 * 조회된다. 네이티브 Wayland 창은 보이지 않는다 — 그래서 이 함수는
 * 실패를 정상 경로로 취급하고 null을 돌려준다. 호출부는 화면 모서리로
 * 물러나면 된다.
 *
 * GNOME Wayland는 `_NET_ACTIVE_WINDOW`를 채우지 않아 '포커스된 창'을
 * 물어볼 수 없다. 대신 세션의 작업 디렉터리 이름을 창 제목과 맞춰 본다 —
 * 편집기는 보통 제목에 폴더 이름을 넣는다.
 */

/** 이 크기보다 작으면 실제 작업 창이 아니라 숨은 보조 창이다. */
const MIN_W = 400;
const MIN_H = 300;

/** 조회가 오래 걸리면 포기한다. 캐릭터를 띄우는 일이 여기서 막히면 안 된다. */
const LOOKUP_TIMEOUT_MS = 700;

/** 결과를 잠깐 재사용한다. 알림이 몰릴 때마다 프로세스를 띄울 이유가 없다. */
const CACHE_MS = 2_000;

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  wmClass: string;
}

let cache: { at: number; windows: WindowRect[] } | null = null;

function runXwininfo(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'xwininfo',
      ['-root', '-tree'],
      { timeout: LOOKUP_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? null : stdout),
    );
  });
}

/**
 * `0xID "제목": ("인스턴스" "클래스")  WxH+X+Y  +X+Y` 형식을 읽는다.
 *
 * 마지막 `+X+Y`가 루트 기준 절대 좌표다. 앞의 것은 부모 기준이라 쓰면 안 된다.
 */
export function parseWindowTree(text: string): WindowRect[] {
  const out: WindowRect[] = [];
  const line =
    /0x[0-9a-f]+\s+"([^"]*)":\s+\("([^"]*)"\s+"([^"]*)"\)\s+(\d+)x(\d+)\+-?\d+\+-?\d+\s+\+(-?\d+)\+(-?\d+)/;

  for (const raw of text.split('\n')) {
    const m = line.exec(raw);
    if (!m) continue;
    const width = Number(m[4]);
    const height = Number(m[5]);
    if (width < MIN_W || height < MIN_H) continue;
    out.push({
      title: m[1] ?? '',
      wmClass: m[3] ?? '',
      width,
      height,
      x: Number(m[6]),
      y: Number(m[7]),
    });
  }
  return out;
}

/**
 * 이 창이 이 세션의 창이라는 **적극적인 증거**가 있는지 본다.
 *
 * 증거 없이 '제일 그럴듯한 창'을 고르면 안 된다. 실제로 그렇게 했다가,
 * 사용자가 Tilix에서 작업 중인데 캐릭터가 옆 모니터의 VS Code에 떴다.
 * Tilix는 네이티브 Wayland 창이라 X11 목록에 아예 없었고, 남은 유일한
 * 후보가 VS Code였기 때문이다.
 *
 * 지금은 세션의 작업 디렉터리 이름이 창 제목에 있을 때만 인정한다.
 * 편집기와 터미널은 대개 제목에 폴더 이름을 넣는다. 증거가 없으면
 * null을 돌려주고, 호출부는 화면 모서리로 물러난다.
 */
function matchesSession(w: WindowRect, cwd: string): boolean {
  const folder = basename(cwd);
  if (folder.length < 2) return false;
  return w.title.includes(folder);
}

/** 캐시를 비운다. 창을 옮긴 직후 등. */
export function clearWindowCache(): void {
  cache = null;
}

/**
 * 이 세션이 작업 중인 창을 찾는다.
 *
 * @param cwd 세션의 작업 디렉터리. 없으면 창을 특정할 수 없으므로 곧바로 null.
 * @returns 확신이 없으면 null — 조회 실패는 오류가 아니라 정상 경로다.
 *
 * 네이티브 Wayland 창(GNOME Terminal, Tilix, Ptyxis 등)은 여기서 절대
 * 찾을 수 없다. Wayland에는 앱이 다른 창의 위치를 묻는 방법이 없기
 * 때문이고, 이건 프로토콜의 의도된 성질이라 우회할 방법이 없다.
 */
export async function findWorkingWindow(
  cwd: string | null = null,
  now: number = Date.now(),
): Promise<WindowRect | null> {
  if (!cwd) return null;

  if (!cache || now - cache.at > CACHE_MS) {
    const text = await runXwininfo();
    if (text === null) {
      // xwininfo가 없거나 X11 디스플레이가 없다. 조용히 물러난다.
      cache = { at: now, windows: [] };
      return null;
    }
    cache = { at: now, windows: parseWindowTree(text) };
  }

  const matches = cache.windows.filter((w) => matchesSession(w, cwd));
  if (matches.length === 0) return null;

  // 같은 폴더를 여러 창이 열어 뒀으면 큰 쪽이 작업 창일 가능성이 높다.
  return matches.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
}
