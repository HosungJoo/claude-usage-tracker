import { BrowserWindow, screen, type Display } from 'electron';
import {
  cancelReassert,
  computeBounds,
  createOverlayWindow,
  showOverlay,
  type OverlayPlacement,
} from './overlay-window.js';
import type { ShowRequest } from '../shared/ipc.js';
import { IPC } from '../shared/ipc.js';

/**
 * 오버레이 창들을 관리한다.
 *
 * 창이 여럿인 이유: **어느 화면을 보고 있는지 알 수 없기 때문이다.**
 * Wayland에서는 앱이 마우스 위치도, 다른 창의 위치도 물어볼 수 없다.
 * 그래서 '보고 있을 만한 곳을 맞히는' 대신 모든 화면에 같은 것을 띄운다.
 * 맞힐 필요가 없으면 틀릴 일도 없다.
 *
 * 3초 뒤 사라지므로 화면이 여럿이어도 오래 거슬리지 않는다.
 */

/** 컨트롤러가 기대하는 최소 인터페이스. 테스트에서는 가짜를 넣는다. */
export interface OverlayHost {
  isReady(): boolean;
  onReady(cb: () => void): void;
  show(req: ShowRequest): void;
  hide(): void;
  setInteractive(interactive: boolean): void;
  destroy(): void;
}

export interface HostOptions {
  preloadPath: string;
  rendererUrl?: string;
  rendererFile?: string;
  /** 이번에 띄울 화면들과 각 화면에서의 배치. */
  targets: () => Array<{ display: Display; placement: OverlayPlacement }>;
}

export class WindowOverlayHost implements OverlayHost {
  private readonly windows = new Map<number, BrowserWindow>();
  private readonly loading = new Set<number>();
  private readyCallbacks: Array<() => void> = [];
  private destroyed = false;

  constructor(private readonly options: HostOptions) {}

  /**
   * 창이 하나라도 준비돼 있는지.
   *
   * 렌더러가 뜨기 전에 보낸 IPC는 조용히 사라진다. 시작 직후 임계값을
   * 넘긴 경우가 정확히 그 상황이라, 준비될 때까지 기다려야 한다.
   */
  isReady(): boolean {
    if (this.windows.size === 0) return false;
    return this.loading.size === 0;
  }

  onReady(cb: () => void): void {
    if (this.isReady()) cb();
    else this.readyCallbacks.push(cb);
  }

  private notifyReady(): void {
    if (!this.isReady()) return;
    const cbs = this.readyCallbacks;
    this.readyCallbacks = [];
    for (const cb of cbs) cb();
  }

  /** 화면 하나에 대응하는 창을 만들거나 가져온다. */
  private windowFor(displayId: number, placement: OverlayPlacement): BrowserWindow {
    const existing = this.windows.get(displayId);
    if (existing && !existing.isDestroyed()) {
      existing.setBounds(computeBounds(placement));
      return existing;
    }

    const win = createOverlayWindow({
      preloadPath: this.options.preloadPath,
      placement,
      ...(this.options.rendererUrl ? { rendererUrl: this.options.rendererUrl } : {}),
      ...(this.options.rendererFile ? { rendererFile: this.options.rendererFile } : {}),
    });

    this.windows.set(displayId, win);
    this.loading.add(displayId);

    win.webContents.on('did-start-loading', () => this.loading.add(displayId));
    win.webContents.on('did-finish-load', () => {
      this.loading.delete(displayId);
      this.notifyReady();
    });
    win.on('closed', () => {
      this.windows.delete(displayId);
      this.loading.delete(displayId);
    });

    return win;
  }

  /** 더 이상 대상이 아닌 화면의 창을 정리한다. 모니터를 뽑았을 때 등. */
  private pruneExcept(keep: Set<number>): void {
    for (const [id, win] of this.windows) {
      if (keep.has(id)) continue;
      if (!win.isDestroyed()) win.destroy();
      this.windows.delete(id);
      this.loading.delete(id);
    }
  }

  show(req: ShowRequest): void {
    if (this.destroyed) return;
    const targets = this.options.targets();
    const keep = new Set(targets.map((t) => t.display.id));
    this.pruneExcept(keep);

    for (const { display, placement } of targets) {
      const win = this.windowFor(display.id, placement);
      if (win.isDestroyed()) continue;
      showOverlay(win);
      win.webContents.send(IPC.show, req);
    }
  }

  hide(): void {
    for (const win of this.windows.values()) {
      if (win.isDestroyed()) continue;
      cancelReassert(win);
      win.webContents.send(IPC.hide);
      win.hide();
    }
  }

  /** 말풍선 위에서만 클릭을 받는다. 창이 여럿이어도 규칙은 같다. */
  setInteractive(interactive: boolean): void {
    for (const win of this.windows.values()) {
      if (win.isDestroyed()) continue;
      // forward:true 를 유지해야 통과시키는 동안에도 hover 이벤트가 렌더러에 간다.
      win.setIgnoreMouseEvents(!interactive, { forward: true });
    }
  }

  /** 창을 미리 만들어 둔다. 알림이 왔을 때 로딩을 기다리지 않기 위해. */
  warmUp(): void {
    if (this.destroyed) return;
    const targets = this.options.targets();
    this.pruneExcept(new Set(targets.map((t) => t.display.id)));
    for (const { display, placement } of targets) this.windowFor(display.id, placement);
  }

  destroy(): void {
    this.destroyed = true;
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.destroy();
    }
    this.windows.clear();
    this.loading.clear();
  }

  /** 진단용 — 지금 몇 개의 화면에 떠 있는지. */
  get windowCount(): number {
    return this.windows.size;
  }

  /**
   * 창 하나를 돌려준다. 개발용 캡처가 화면 하나만 찍으면 되기 때문이다.
   * 실제 동작에는 쓰지 않는다 — 창이 여럿인 것이 정상이다.
   */
  anyWindow(): BrowserWindow | null {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) return win;
    }
    return null;
  }
}

/**
 * 설정에 따라 어느 화면들에 띄울지 정한다.
 *
 * 'all'이 기본인 이유는 이 앱이 맞힐 수 없는 것을 맞히려 하지 않기
 * 위해서다. 화면이 하나뿐이면 어느 선택지든 결과가 같다.
 */
export function resolveTargets(choice: 'all' | 'primary' | 'cursor' | number): Display[] {
  const all = screen.getAllDisplays();
  if (all.length <= 1) return all;

  if (choice === 'all') return all;
  if (choice === 'primary') return [screen.getPrimaryDisplay()];
  if (choice === 'cursor') {
    return [screen.getDisplayNearestPoint(screen.getCursorScreenPoint())];
  }

  const hit = all.find((d) => d.id === choice);
  // 지정한 모니터가 사라졌으면 주 모니터로 떨어진다.
  return [hit ?? screen.getPrimaryDisplay()];
}
