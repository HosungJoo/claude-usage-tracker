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

/** 배치 기준이 되는 사각형. 화면의 작업 영역이거나 창의 테두리다. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayPlacement {
  /** 창 크기 모드. */
  size?: OverlaySize;
  /** 화면(또는 기준 사각형) 한가운데에 놓는다. corner를 무시한다. */
  center?: boolean;
  corner: Corner;
  /**
   * 이 사각형 안에 배치한다. 작업 중인 창의 좌표를 넣으면 그 창을 기준으로
   * 자리잡는다. 없으면 화면의 작업 영역을 쓴다.
   */
  anchorRect?: Rect;
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

/**
 * 창 크기. 모드마다 다르다.
 *
 * 'large'는 화면 한가운데에 크게 띄우는 모드다. 이 앱의 실패 방식은
 * '떴는데 못 봤다' 하나뿐이라, 놓치기 어려운 크기를 기본으로 둔다.
 */
export type OverlaySize = 'compact' | 'large';

export const OVERLAY_DIMENSIONS: Record<OverlaySize, { width: number; height: number }> = {
  compact: { width: 380, height: 250 },
  large: { width: 880, height: 520 },
};

/** 호환용 — 기본(작은) 크기. */
export const OVERLAY_WIDTH = OVERLAY_DIMENSIONS.compact.width;
export const OVERLAY_HEIGHT = OVERLAY_DIMENSIONS.compact.height;

function resolveDisplay(placement: OverlayPlacement): Display {
  // 창을 기준으로 잡을 때는 그 창이 있는 화면을 따라야 한다. 커서가 다른
  // 모니터에 있다고 캐릭터가 딴 화면에 뜨면 안 된다.
  if (placement.anchorRect) {
    const r = placement.anchorRect;
    return screen.getDisplayNearestPoint({
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
    });
  }
  if (placement.display === 'primary') return screen.getPrimaryDisplay();
  if (typeof placement.display === 'number') {
    const hit = screen.getAllDisplays().find((d) => d.id === placement.display);
    if (hit) return hit;
    // 지정한 모니터가 사라졌으면 조용히 주 디스플레이로 떨어진다.
    return screen.getPrimaryDisplay();
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

/**
 * 배치 규칙에 따른 창 좌표.
 *
 * 기준 사각형이 주어지면 그 안에, 없으면 화면의 작업 영역 안에 놓는다.
 * workArea를 쓰므로 패널·독을 침범하지 않는다.
 *
 * 창을 기준으로 잡을 때도 결과는 화면 밖으로 나가지 않게 가둔다 — 창이
 * 화면 가장자리에 걸쳐 있으면 계산 결과가 화면을 벗어날 수 있다.
 */
export function computeBounds(placement: OverlayPlacement): Electron.Rectangle {
  const display = resolveDisplay(placement);
  const base = placement.anchorRect ?? display.workArea;
  const { width, height } = OVERLAY_DIMENSIONS[placement.size ?? 'compact'];
  const m = placement.margin;

  let x: number;
  let y: number;
  if (placement.center) {
    x = base.x + (base.width - width) / 2;
    y = base.y + (base.height - height) / 2;
  } else {
    const left = placement.corner.endsWith('left');
    const top = placement.corner.startsWith('top');
    x = left ? base.x + m : base.x + base.width - width - m;
    y = top ? base.y + m : base.y + base.height - height - m;
  }

  // 기준 사각형이 화면 가장자리에 걸쳐 있으면 결과가 화면 밖으로 나갈 수 있다.
  const wa = display.workArea;
  return {
    x: Math.round(Math.min(Math.max(x, wa.x), wa.x + wa.width - width)),
    y: Math.round(Math.min(Math.max(y, wa.y), wa.y + wa.height - height)),
    width,
    height,
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

/**
 * 항상-위 설정이 해제된 뒤 다시 걸기까지 기다리는 시간.
 *
 * 리눅스에서 창을 띄우면 항상-위 플래그가 **비동기로** 풀린다. 측정해 보면
 * show 직후에는 아직 켜져 있고 약 50ms 뒤에 꺼진다. 그래서 show 이벤트
 * 안에서 다시 걸어도 소용이 없다 — 해제가 그 뒤에 오기 때문이다.
 */
const REASSERT_TOP_MS = 200;

const reassertTimers = new WeakMap<BrowserWindow, NodeJS.Timeout>();

/**
 * 창을 띄우고 '항상 위'를 다시 지정한다.
 *
 * 이게 없으면 캐릭터가 뜨자마자 편집기 뒤로 숨는다. 사용자 입장에서는
 * 알림이 아예 오지 않은 것과 같다.
 *
 * 포커스를 훔치지 않으려면 반드시 showInactive여야 한다 — 사용자가
 * 타이핑하는 중에 뜰 수 있다.
 */
export function showOverlay(win: BrowserWindow): void {
  if (win.isDestroyed()) return;

  win.showInactive();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const prev = reassertTimers.get(win);
  if (prev) clearTimeout(prev);

  const timer = setTimeout(() => {
    reassertTimers.delete(win);
    if (win.isDestroyed() || !win.isVisible()) return;
    win.setAlwaysOnTop(true, 'screen-saver');
  }, REASSERT_TOP_MS);
  reassertTimers.set(win, timer);
}

/** 창을 감출 때 예약된 재지정을 취소한다. */
export function cancelReassert(win: BrowserWindow): void {
  const timer = reassertTimers.get(win);
  if (timer) {
    clearTimeout(timer);
    reassertTimers.delete(win);
  }
}

/** 디스플레이 구성이 바뀌었을 때 창을 다시 자리잡는다. */
export function repositionOverlay(win: BrowserWindow, placement: OverlayPlacement): void {
  if (win.isDestroyed()) return;
  win.setBounds(computeBounds(placement));
}

/** 모드에 맞는 창 크기. */
export function overlaySizeFor(anchor: string): OverlaySize {
  return anchor === 'center' ? 'large' : 'compact';
}
