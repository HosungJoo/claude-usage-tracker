import { t } from '../shared/i18n/index.js';
import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron';
import { trayIconFor, trayTooltip } from './tray-icon.js';
import { formatPercent, formatRemaining } from '../core/format.js';
import type { UsageSnapshot } from '../core/types.js';

/**
 * 트레이 상주.
 *
 * 이 앱은 창이 없는 것이 정상 상태다. 트레이 아이콘이 유일한 상시 접점이라,
 * 여기서 세 가지가 보여야 한다: 지금 사용량이 얼마인지(아이콘 + 툴팁),
 * 지금 확인할 수 있는지(메뉴), 문제가 생겼을 때 어디를 볼지(로그).
 */

export interface TrayActions {
  checkNow: () => void;
  openSettings: () => void;
  openLogs: () => void;
  quit: () => void;
}

export class UsageTray {
  private tray: Tray | null = null;
  private snapshot: UsageSnapshot | null = null;
  private lastError: string | null = null;

  constructor(private readonly actions: TrayActions) {}

  create(): void {
    if (this.tray) return;
    this.tray = new Tray(this.icon());
    this.tray.setToolTip(trayTooltip(null));
    this.rebuildMenu();
    // 아이콘을 클릭하면 바로 지금 사용량을 띄운다 — 메뉴를 한 번 더
    // 여는 것은 '알아서 알려준다'는 이 앱의 취지에 어긋난다.
    this.tray.on('click', () => this.actions.checkNow());
  }

  private icon(): Electron.NativeImage {
    return nativeImage.createFromBuffer(Buffer.from(trayIconFor(this.snapshot)));
  }

  /** 사용량이 갱신될 때마다 아이콘·툴팁·메뉴를 함께 바꾼다. */
  update(snapshot: UsageSnapshot): void {
    this.snapshot = snapshot;
    this.lastError = null;
    if (!this.tray) return;
    this.tray.setImage(this.icon());
    this.tray.setToolTip(trayTooltip(snapshot));
    this.rebuildMenu();
  }

  /** 조회에 실패했을 때. 마지막으로 읽은 값은 그대로 두고 사유만 덧붙인다. */
  setError(message: string): void {
    this.lastError = message;
    this.rebuildMenu();
  }

  private summaryItems(): Electron.MenuItemConstructorOptions[] {
    if (!this.snapshot) {
      return [{ label: t().tray.notReadYet, enabled: false }];
    }
    const s = this.snapshot;
    const now = Date.now();
    const tray = t().tray;
    const items: Electron.MenuItemConstructorOptions[] = [
      {
        label: tray.fiveHourItem(
          formatPercent(s.fiveHour.percent),
          formatRemaining(s.fiveHour.resetsAt, now),
        ),
        enabled: false,
      },
      {
        label: tray.weeklyItem(
          formatPercent(s.weekly.percent),
          formatRemaining(s.weekly.resetsAt, now),
        ),
        enabled: false,
      },
    ];
    for (const scoped of s.scoped) {
      items.push({ label: `  ${scoped.label}  ${formatPercent(scoped.percent)}`, enabled: false });
    }
    return items;
  }

  private rebuildMenu(): void {
    if (!this.tray) return;

    const menu = t().tray;
    const items: Electron.MenuItemConstructorOptions[] = [
      ...this.summaryItems(),
      ...(this.lastError ? [{ label: `⚠ ${this.lastError}`, enabled: false }] : []),
      { type: 'separator' },
      { label: menu.checkNow, click: () => this.actions.checkNow() },
      { label: menu.settings, click: () => this.actions.openSettings() },
      { label: menu.openLogs, click: () => this.actions.openLogs() },
      { type: 'separator' },
      { label: menu.quit, click: () => this.actions.quit() },
    ];

    this.tray.setContextMenu(Menu.buildFromTemplate(items));
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}

/** 설정 창. 하나만 뜨고, 닫아도 앱은 살아 있다. */
export function focusOrCreate(
  existing: BrowserWindow | null,
  create: () => BrowserWindow,
): BrowserWindow {
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }
  return create();
}
