import { BrowserWindow, screen, type Display } from 'electron';
import { join } from 'node:path';

/**
 * 투명 오버레이 창.
 *
 * 이 앱의 핵심 제약: 사용자의 작업을 절대 방해하지 않는다.
 * 그래서 창은 기본적으로 클릭을 통과시키고, 포커스를 훔치지 않으며,
 * 작업표시줄에도 뜨지 않는다.
 */

export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

export interface OverlayPlacement {
  corner: Corner;
  /** 화면 가장자리로부터의 여백(px). */
  margin: number;
  /**
   * 어느 디스플레이에 띄울지.
   * 'cursor' — 마우스가 있는 화면 (기본).
   * 'primary' — 주 디스플레이.
   * number — Electron display id.
   */
  display: 'cursor' | 'primary' | number;
}

export const DEFAULT_PLACEMENT: OverlayPlacement = {
  corner: 'bottom-right',
  margin: 24,
  display: 'cursor',
};

/** 캐릭터 + 말풍선이 들어가는 창 크기. */
export const OVERLAY_WIDTH = 380;
export const OVERLAY_HEIGHT = 264;

function resolveDisplay(placement: OverlayPlacement): Display {
  if (placement.display === 'primary') return screen.getPrimaryDisplay();
  if (typeof placement.display === 'number') {
    const hit = screen.getAllDisplays().find((d) => d.id === placement.display);
    if (hit) return hit;
    // 지정한 모니터가 사라졌으면 조용히 주 디스플레이로 떨어진다.
    return screen.getPrimaryDisplay();
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/** 배치 규칙에 따른 창 좌표. workArea를 쓰므로 패널·독을 피한다. */
export function computeBounds(placement: OverlayPlacement): Electron.Rectangle {
  const { workArea } = resolveDisplay(placement);
  const m = placement.margin;

  const left = placement.corner.endsWith('left');
  const top = placement.corner.startsWith('top');

  return {
    x: left ? workArea.x + m : workArea.x + workArea.width - OVERLAY_WIDTH - m,
    y: top ? workArea.y + m : workArea.y + workArea.height - OVERLAY_HEIGHT - m,
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
  };
}

export interface CreateOverlayOptions {
  preloadPath: string;
  /** dev 서버 URL이 있으면 그쪽을, 없으면 빌드된 파일을 연다. */
  rendererUrl?: string;
  rendererFile?: string;
  placement?: OverlayPlacement;
}

export function createOverlayWindow(options: CreateOverlayOptions): BrowserWindow {
  const placement = options.placement ?? DEFAULT_PLACEMENT;

  const win = new BrowserWindow({
    ...computeBounds(placement),
    show: false,
    frame: false,
    transparent: true,
    // Linux에서 배경색을 지정하면 투명이 깨진다. 완전 투명으로 둔다.
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // 포커스를 받으면 사용자가 치던 글자를 가로챈다. 절대 받지 않는다.
    focusable: false,
    acceptFirstMouse: false,
    alwaysOnTop: true,
    // 리눅스에서 'notification' 타입이면 합성기가 항상 위로 올려준다.
    ...(process.platform === 'linux' ? { type: 'notification' } : {}),
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  // 'screen-saver' 레벨이면 전체화면 앱 위에도 뜬다.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 기본은 클릭 통과. 말풍선 위에 마우스가 올라올 때만 렌더러가 풀어준다.
  win.setIgnoreMouseEvents(true, { forward: true });

  if (options.rendererUrl) {
    void win.loadURL(options.rendererUrl);
  } else if (options.rendererFile) {
    void win.loadFile(options.rendererFile);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

/** 디스플레이 구성이 바뀌었을 때 창을 다시 자리잡는다. */
export function repositionOverlay(win: BrowserWindow, placement: OverlayPlacement): void {
  if (win.isDestroyed()) return;
  win.setBounds(computeBounds(placement));
}
