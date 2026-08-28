import { ipcMain } from 'electron';
import type { OverlaySize } from './overlay-window.js';
import type { OverlayHost } from './overlay-host.js';
import { isUserPresent } from './presence.js';
import type { Line } from '../shared/character/script.js';
import { IPC, type GaugeInfo, type ShowRequest } from '../shared/ipc.js';
import type { Corner } from './overlay-window.js';
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
  corner: Corner;
  size: OverlaySize;
  centered: boolean;
  priority: number;
}

/** 표시를 언제 끝낼지 정하는 규칙. */
export interface HoldPolicy {
  /** 사용자가 자리에 있을 때 머무는 시간(ms). */
  presentMs: number;
  /** 자리에 없으면 돌아올 때까지 기다릴지. */
  waitWhenAway: boolean;
  /** 재실 판정. 테스트에서 주입한다. */
  isPresent?: () => Promise<boolean>;
}

/** 자리에 있는지 확인하는 주기. */
const PRESENCE_POLL_MS = 800;

/**
 * 아무리 기다려도 이 시간을 넘기지 않는다.
 *
 * 재실 감지가 어떤 이유로든 계속 '없음'을 돌려주면 캐릭터가 영원히 화면에
 * 남는다. 알림이 방해물이 되는 것보다는 놓치는 편이 낫다.
 */
const MAX_WAIT_MS = 30 * 60_000;

const SEVERITY_PRIORITY: Record<Severity, number> = { normal: 0, warning: 1, critical: 2 };

/** 연출이 끝나고 다음 알림이 나가기까지의 간격. */
const GAP_MS = 700;

export class OverlayController {
  private queue: QueueItem[] = [];
  private showing: QueueItem | null = null;
  private nextId = 1;
  private gapTimer: NodeJS.Timeout | null = null;
  private holdTimer: NodeJS.Timeout | null = null;
  private presenceTimer: NodeJS.Timeout | null = null;
  private shownAt = 0;
  private disposed = false;
  /**
   * 렌더러가 뜨기 전에 보낸 IPC는 조용히 사라진다. 시작 직후 임계값을
   * 넘긴 경우가 정확히 그 상황이라, 준비될 때까지 큐에 쌓아 둔다.
   */
  private rendererReady = false;

  constructor(
    private readonly host: OverlayHost,
    /** 표시 종료 규칙. 설정이 바뀌면 갱신한다. */
    private policy: HoldPolicy = { presentMs: 3000, waitWhenAway: true },
    /**
     * 진단 기록.
     *
     * '떴는데 못 봤다'가 이 앱의 유일한 실패 방식인데, 그게 일어났는지는
     * 화면을 보지 않으면 알 수 없다. 언제 뜨고 왜 사라졌는지를 남겨 두면
     * 나중에 로그만으로 따져볼 수 있다.
     */
    private readonly log: (message: string) => void = () => {},
  ) {
    ipcMain.on(IPC.setInteractive, this.handleSetInteractive);
    ipcMain.on(IPC.dismissed, this.handleDismissed);

    host.onReady(() => this.markReady());
  }

  private markReady(): void {
    if (this.rendererReady) return;
    this.rendererReady = true;
    this.pump();
  }

  private handleSetInteractive = (_e: unknown, interactive: boolean): void => {
    this.host.setInteractive(interactive);
  };

  private handleDismissed = (_e: unknown, id: number): void => {
    if (this.showing?.id !== id) return;
    this.showing = null;
    this.clearHoldTimers();
    this.host.hide();
    this.scheduleNext();
  };

  /**
   * 캐릭터를 띄운다. 이미 무언가 보여주는 중이면 큐에 넣는다.
   * @returns 이 요청의 id.
   */
  /** 표시 종료 규칙을 바꾼다. 이미 떠 있는 것에는 다음 판정부터 적용된다. */
  setPolicy(policy: HoldPolicy): void {
    this.policy = policy;
  }

  enqueue(
    line: Line,
    severity: Severity,
    gauges: GaugeInfo[],
    corner: Corner,
    size: OverlaySize = 'compact',
    centered = false,
  ): number {
    const item: QueueItem = {
      id: this.nextId++,
      line,
      severity,
      gauges,
      corner,
      size,
      centered,
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
    this.clearHoldTimers();
    if (this.gapTimer) {
      clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
    this.host.hide();
  }

  private scheduleNext(): void {
    if (this.gapTimer) clearTimeout(this.gapTimer);
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null;
      this.pump();
    }, GAP_MS);
  }

  private pump(): void {
    if (this.disposed || this.showing || !this.rendererReady) return;
    const next = this.queue.shift();
    if (!next) return;

    this.showing = next;
    const req: ShowRequest = {
      id: next.id,
      line: next.line,
      severity: next.severity,
      gauges: next.gauges,
      corner: next.corner,
      size: next.size,
      centered: next.centered,
    };

    // 어느 화면을 보고 있는지 알 수 없으므로, 설정에 따라 여러 화면에 함께 띄운다.
    this.host.show(req);

    this.shownAt = Date.now();
    this.log(`표시 #${next.id} — ${next.line.title}`);
    this.startHoldWatch(next.id);
  }

  /**
   * 언제 치울지 지켜본다.
   *
   * 사람이 자리에 있으면 정해진 시간만 보여주고, 없으면 돌아올 때까지
   * 기다린다. 이 앱의 유일한 실패는 '떴는데 못 봤다'이므로, 자리를 비운
   * 사이에 조용히 사라지는 일이 없어야 한다.
   */
  private startHoldWatch(id: number): void {
    this.clearHoldTimers();

    if (!this.policy.waitWhenAway) {
      this.holdTimer = setTimeout(() => this.dismiss(id, '시간 경과'), this.policy.presentMs);
      return;
    }

    let waited = false;

    const tick = (): void => {
      if (this.showing?.id !== id) return;

      if (Date.now() - this.shownAt > MAX_WAIT_MS) {
        this.dismiss(id, '최대 대기 시간 초과');
        return;
      }

      void (this.policy.isPresent ?? isUserPresent)().then((present) => {
        if (this.showing?.id !== id) return;
        if (!present) {
          // 아직 자리에 없다. 계속 띄워 둔 채로 다시 확인한다.
          if (!waited) {
            waited = true;
            this.log(`대기 #${id} — 자리에 없어 그대로 둡니다`);
          }
          this.presenceTimer = setTimeout(tick, PRESENCE_POLL_MS);
          return;
        }
        // 돌아왔다. 볼 시간을 주고 치운다.
        const reason = waited
          ? `돌아옴, ${Math.round((Date.now() - this.shownAt) / 1000)}초 기다림`
          : '시간 경과';
        this.holdTimer = setTimeout(() => this.dismiss(id, reason), this.policy.presentMs);
      });
    };

    tick();
  }

  /** 표시를 끝낸다. 이유를 남긴다. */
  private dismiss(id: number, reason: string): void {
    if (this.showing?.id !== id) return;
    this.log(`해제 #${id} — ${reason}`);
    this.handleDismissed(null, id);
  }

  private clearHoldTimers(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    if (this.presenceTimer) {
      clearTimeout(this.presenceTimer);
      this.presenceTimer = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearHoldTimers();
    if (this.gapTimer) clearTimeout(this.gapTimer);
    ipcMain.off(IPC.setInteractive, this.handleSetInteractive);
    ipcMain.off(IPC.dismissed, this.handleDismissed);
  }
}
