import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import type { Line } from '../shared/character/script.js';
import { IPC, type GaugeInfo, type ShowRequest } from '../shared/ipc.js';
import type { Severity } from '../core/types.js';

/**
 * 오버레이 표시 큐.
 *
 * 알림이 몰릴 때 캐릭터가 겹쳐 나오면 안 된다. 하나씩, 순서대로 보여준다.
 * 주간 한도처럼 더 아픈 소식이 먼저 나가도록 우선순위도 본다.
 */

interface QueueItem {
  id: number;
  line: Line;
  severity: Severity;
  gauges: GaugeInfo[];
  priority: number;
}

const SEVERITY_PRIORITY: Record<Severity, number> = { normal: 0, warning: 1, critical: 2 };

/** 연출이 끝나고 다음 알림이 나가기까지의 간격. */
const GAP_MS = 700;

export class OverlayController {
  private queue: QueueItem[] = [];
  private showing: QueueItem | null = null;
  private nextId = 1;
  private gapTimer: NodeJS.Timeout | null = null;
  private disposed = false;
  /**
   * 렌더러가 뜨기 전에 보낸 IPC는 조용히 사라진다. 시작 직후 임계값을
   * 넘긴 경우가 정확히 그 상황이라, 준비될 때까지 큐에 쌓아 둔다.
   */
  private rendererReady = false;

  constructor(private readonly win: BrowserWindow) {
    ipcMain.on(IPC.setInteractive, this.handleSetInteractive);
    ipcMain.on(IPC.dismissed, this.handleDismissed);

    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => this.markReady());
    } else {
      this.markReady();
    }
    // 새로고침되면 렌더러 상태가 초기화되므로 표시 중인 것도 버린다.
    win.webContents.on('did-start-loading', () => {
      this.rendererReady = false;
    });
    win.webContents.on('did-finish-load', () => this.markReady());
  }

  private markReady(): void {
    if (this.rendererReady) return;
    this.rendererReady = true;
    this.pump();
  }

  private handleSetInteractive = (_e: unknown, interactive: boolean): void => {
    if (this.win.isDestroyed()) return;
    // forward:true 를 유지해야 통과시키는 동안에도 hover 이벤트가 렌더러에 간다.
    this.win.setIgnoreMouseEvents(!interactive, { forward: true });
  };

  private handleDismissed = (_e: unknown, id: number): void => {
    if (this.showing?.id !== id) return;
    this.showing = null;
    this.win.hide();
    this.scheduleNext();
  };

  /**
   * 캐릭터를 띄운다. 이미 무언가 보여주는 중이면 큐에 넣는다.
   * @returns 이 요청의 id.
   */
  enqueue(line: Line, severity: Severity, gauges: GaugeInfo[]): number {
    const item: QueueItem = {
      id: this.nextId++,
      line,
      severity,
      gauges,
      priority: SEVERITY_PRIORITY[severity],
    };

    // 같은 우선순위끼리는 먼저 온 순서를 지킨다.
    const at = this.queue.findIndex((q) => q.priority < item.priority);
    if (at === -1) this.queue.push(item);
    else this.queue.splice(at, 0, item);

    if (!this.showing) this.pump();
    return item.id;
  }

  /** 지금 보여주는 것을 즉시 치우고 큐를 비운다. */
  clear(): void {
    this.queue = [];
    this.showing = null;
    if (this.gapTimer) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(IPC.hide);
      this.win.hide();
    }
  }

  private scheduleNext(): void {
    if (this.gapTimer) clearTimeout(this.gapTimer);
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null;
      this.pump();
    }, GAP_MS);
  }

  private pump(): void {
    if (this.disposed || this.showing || !this.rendererReady || this.win.isDestroyed()) return;
    const next = this.queue.shift();
    if (!next) return;

    this.showing = next;
    const req: ShowRequest = {
      id: next.id,
      line: next.line,
      severity: next.severity,
      gauges: next.gauges,
    };

    // showInactive: 포커스를 훔치지 않고 띄운다. 사용자가 타이핑 중일 수 있다.
    this.win.showInactive();
    this.win.webContents.send(IPC.show, req);

    // 렌더러가 죽거나 dismissed를 못 보내도 큐가 막히지 않도록 안전망을 둔다.
    setTimeout(() => {
      if (this.showing?.id === next.id) this.handleDismissed(null, next.id);
    }, next.line.holdMs + 2000);
  }

  dispose(): void {
    this.disposed = true;
    if (this.gapTimer) clearTimeout(this.gapTimer);
    ipcMain.off(IPC.setInteractive, this.handleSetInteractive);
    ipcMain.off(IPC.dismissed, this.handleDismissed);
  }
}
