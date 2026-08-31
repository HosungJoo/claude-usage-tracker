import * as vscode from 'vscode';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UsagePoller } from '../../../src/core/poller.js';
import { StateStore } from '../../../src/core/state-store.js';
import { formatPercent, formatRemaining } from '../../../src/core/format.js';
import type { ThresholdEvent } from '../../../src/core/thresholds.js';
import type { Severity, UsageSnapshot } from '../../../src/core/types.js';
import { configDir } from '../../../src/shared/runtime-paths.js';
import {
  normalizeSettings,
  normalizeThresholds,
  type Settings,
} from '../../../src/shared/settings.js';
import { lineForThreshold, type Line } from '../../../src/shared/character/script.js';
import { gaugesFromSnapshot, type GaugeInfo } from '../../../src/shared/ipc.js';
import {
  resolveLocale,
  setLocale,
  t,
  type LanguagePreference,
} from '../../../src/shared/i18n/index.js';

/**
 * Claude Code 패널 안에 얹는 사용량 뷰.
 *
 * 이 확장이 지키는 선: **먼저 자리를 차지하지 않는다.** 평소에는 접힌 채로
 * 머리줄 오른쪽에 흐린 숫자 한 줄이 전부다. 캐릭터가 나오는 건 임계값을
 * 넘은 순간뿐이고, 그마저도 정해진 시간이 지나면 숫자 한 줄로 돌아간다.
 */

const VIEW_ID = 'claudeUsage';
const CHARACTER_VIEW_ID = 'claudeUsage.character';
/** 우리 뷰가 얹히는 컨테이너. Claude Code 확장이 선언한 id다. */
const CLAUDE_CONTAINER = 'claude-sidebar-secondary';

/**
 * 임계값 발화 이력은 데스크톱 앱과 따로 적는다.
 *
 * 같은 파일을 두 프로세스가 쓰면 서로의 이력을 덮어써서, 한쪽은 알림을
 * 두 번 띄우고 다른 쪽은 통째로 건너뛴다. 파일을 나누면 두 표면이 각자
 * 한 번씩 알리고 — 그게 맞다. 하나는 화면 전체, 하나는 이 패널이다.
 */
const STATE_FILE = 'vscode-state.json';

type AlertMode = 'character' | 'quiet' | 'off';

interface Row {
  label: string;
  detail: string;
  severity: Severity;
}

/* ------------------------------------------------------------------ */
/* 설정 — 기준은 데스크톱 앱과 같은 것을 본다                          */
/* ------------------------------------------------------------------ */

/**
 * 임계값과 표시 시간은 앱의 설정 파일에서 읽는다.
 *
 * 같은 기준을 두 곳에 적어두면 언젠가 어긋난다. 트레이에서 임계값을
 * 90에서 80으로 바꿨는데 패널만 90에 머무르면, 사용자는 어느 쪽이
 * 진짜인지 알 수 없다.
 */
async function appSettings(): Promise<Settings> {
  let raw: unknown = {};
  try {
    raw = JSON.parse(await readFile(join(configDir(), 'settings.json'), 'utf8'));
  } catch {
    // 앱을 설치하지 않았거나 아직 한 번도 안 켰다. 기본값으로 간다.
  }
  const settings = normalizeSettings(raw);

  // 개발 중 알림 경로를 실제로 밟아보기 위한 것. 지금 사용량이 11%인데
  // 50%를 기다릴 수는 없다.
  const override = process.env['CUT_DEV_THRESHOLDS'];
  if (override) {
    return { ...settings, thresholds: normalizeThresholds(override.split(',').map(Number)) };
  }
  return settings;
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('claudeUsage');
}

function applyLocale(): void {
  const pref = config().get<LanguagePreference>('language', 'auto');
  setLocale(resolveLocale(pref, vscode.env.language));
}

/* ------------------------------------------------------------------ */
/* 모델                                                                */
/* ------------------------------------------------------------------ */

class UsageModel implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  /** 임계값을 넘었다. 캐릭터를 불러야 한다는 신호. */
  private readonly alerted = new vscode.EventEmitter<Line>();
  readonly onDidAlert = this.alerted.event;

  snapshot: UsageSnapshot | null = null;
  error: string | null = null;
  /** 지금 캐릭터가 하고 있는 말. 시간이 지나면 null로 돌아간다. */
  line: Line | null = null;

  private poller: UsagePoller | null = null;
  private holdTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor(private readonly statePath: string) {}

  async start(): Promise<void> {
    const settings = await appSettings();
    if (this.disposed) return;

    this.poller?.stop();
    this.poller = new UsagePoller({
      intervalMs: config().get<number>('pollIntervalSec', settings.pollIntervalSec) * 1000,
      thresholds: settings.thresholds,
      store: new StateStore(this.statePath),
    });

    this.poller.on('snapshot', (snapshot) => {
      this.snapshot = snapshot;
      this.error = null;
      this.emitter.fire();
    });
    this.poller.on('threshold', (event) => this.speak(event));
    this.poller.on('error', (_err, message) => {
      this.error = message;
      this.emitter.fire();
    });

    await this.poller.start();
  }

  /** 설정이 바뀌면 폴러를 새로 만든다. 주기는 생성 시점에 고정되기 때문이다. */
  async restart(): Promise<void> {
    await this.start();
  }

  async refresh(): Promise<void> {
    await this.poller?.refreshNow();
  }

  private speak(event: ThresholdEvent): void {
    const mode = config().get<AlertMode>('alertInPanel', 'character');
    if (mode === 'off') return;

    const line = lineForThreshold(event);
    this.line = line;
    this.alerted.fire(line);
    this.emitter.fire();

    if (this.holdTimer) clearTimeout(this.holdTimer);
    // 개발 중에는 캐릭터를 오래 세워두고 들여다볼 수 있어야 한다.
    const holdMs = Number(process.env['CUT_DEV_HOLD_MS']) || line.holdMs;
    this.holdTimer = setTimeout(() => {
      // 하던 자리로 돌아간다. 알림이 끝난 뒤에도 남아 있는 것은 알림이 아니라 잔해다.
      this.line = null;
      this.emitter.fire();
    }, holdMs);
  }

  /** 머리줄 오른쪽. 접혀 있을 때 보이는 유일한 정보다. */
  headline(): string {
    if (this.line) return this.line.title;
    const s = this.snapshot;
    if (!s) return this.error ? t().view.descriptionError : '';
    return t().view.description(formatPercent(s.fiveHour.percent), formatPercent(s.weekly.percent));
  }

  rows(): Row[] {
    const out: Row[] = [];
    const s = this.snapshot;
    if (!s) return out;

    if (s.fiveHour.available) {
      out.push({
        label: t().view.fiveHourRow(formatPercent(s.fiveHour.percent)),
        detail: t().view.resetsIn(formatRemaining(s.fiveHour.resetsAt)),
        severity: s.fiveHour.severity,
      });
    }
    if (s.weekly.available) {
      out.push({
        label: t().view.weeklyRow(formatPercent(s.weekly.percent)),
        detail: t().view.resetsIn(formatRemaining(s.weekly.resetsAt)),
        severity: s.weekly.severity,
      });
    }
    for (const scoped of s.scoped) {
      out.push({
        label: `${scoped.label}  ${formatPercent(scoped.percent)}`,
        detail: t().view.resetsIn(formatRemaining(scoped.resetsAt)),
        severity: scoped.severity,
      });
    }
    return out;
  }

  dispose(): void {
    this.disposed = true;
    this.poller?.stop();
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.emitter.dispose();
    this.alerted.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* 뷰                                                                  */
/* ------------------------------------------------------------------ */

/** 심각도는 색으로만 말한다. 색은 테마가 정한 것을 그대로 쓴다. */
function severityIcon(severity: Severity): vscode.ThemeIcon {
  const color =
    severity === 'critical'
      ? 'charts.red'
      : severity === 'warning'
        ? 'charts.yellow'
        : 'charts.green';
  return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(color));
}

class UsageTreeProvider implements vscode.TreeDataProvider<Row> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly model: UsageModel) {
    model.onDidChange(() => this.emitter.fire());
  }

  getTreeItem(row: Row): vscode.TreeItem {
    const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
    item.description = row.detail;
    item.tooltip = `${row.label} · ${row.detail}`;
    item.iconPath = severityIcon(row.severity);
    return item;
  }

  getChildren(): Row[] {
    return this.model.rows();
  }
}

/* ------------------------------------------------------------------ */
/* 캐릭터 — 알림이 떠 있는 동안에만 존재하는 뷰                        */
/* ------------------------------------------------------------------ */

/**
 * 이 뷰는 `claudeUsage.alerting` 컨텍스트가 참일 때만 컨테이너에 나타난다.
 *
 * 접힌 섹션을 다시 접는 API는 VS Code에 없다. 그래서 '접었다 폈다' 대신
 * **있었다 없었다** 하게 만들었다 — 알림이 끝나면 뷰 자체가 사라지므로,
 * 화면은 알림 전과 정확히 같은 모양으로 돌아간다.
 */
const ALERT_CONTEXT = 'claudeUsage.alerting';

class CharacterViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  private pending: { line: Line; gauges: GaugeInfo[] } | null = null;

  constructor(private readonly script: string) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.onDidDispose(() => {
      this.view = null;
    });
    if (this.pending) this.say(this.pending.line, this.pending.gauges);
  }

  say(line: Line, gauges: GaugeInfo[]): void {
    this.pending = { line, gauges };
    // 뷰가 아직 만들어지지 않았으면 resolve 직후에 다시 보낸다.
    void this.view?.webview.postMessage({
      expression: line.expression,
      title: line.title,
      detail: line.detail,
      gauges,
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body {
    margin: 0; padding: 12px 14px;
    display: flex; align-items: center; gap: 12px;
    font-family: var(--vscode-font-family); color: var(--vscode-foreground);
    background: transparent;
  }
  /* 픽셀 아트는 정수 배율에서만 선명하다. 4배로 고정한다. */
  canvas { width: 96px; height: 64px; image-rendering: pixelated; flex: none; }
  .bubble { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
  #title { margin: 0; font-size: 13px; font-weight: 600; }
  #detail { margin: 0; font-size: 11px; opacity: .75; }
  #gauges { display: flex; flex-direction: column; gap: 3px; margin-top: 3px; }
  .gauge { display: grid; grid-template-columns: 42px 1fr 34px; align-items: center; gap: 6px; font-size: 10px; }
  .label { opacity: .7; }
  .value { text-align: right; font-variant-numeric: tabular-nums; opacity: .7; }
  .track { height: 4px; border-radius: 2px; background: var(--vscode-editorWidget-background); overflow: hidden; }
  .fill { height: 100%; background: var(--vscode-charts-green); }
  .fill.warning { background: var(--vscode-charts-yellow); }
  .fill.critical { background: var(--vscode-charts-red); }
</style>
</head>
<body>
  <canvas id="claw" width="24" height="16"></canvas>
  <div class="bubble">
    <p id="title"></p>
    <p id="detail"></p>
    <div id="gauges"></div>
  </div>
  <script nonce="${nonce}">${this.script}</script>
</body>
</html>`;
  }
}

/* ------------------------------------------------------------------ */

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  applyLocale();

  const model = new UsageModel(join(configDir(), STATE_FILE));
  const provider = new UsageTreeProvider(model);
  context.subscriptions.push(model);

  const view = vscode.window.createTreeView<Row>(VIEW_ID, {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  context.subscriptions.push(view);

  const paint = (): void => {
    // 접혀 있어도 머리줄은 갱신된다 — 이 확장이 웹뷰가 아니라 트리 뷰인 이유다.
    view.description = model.headline();
    // 아직 한 번도 못 읽었을 때만 뷰 안쪽에 사유를 적는다. 낡은 숫자가
    // 남아 있다면 그것을 지우면서까지 오류를 알릴 이유가 없다.
    if (model.snapshot === null && model.error !== null) view.message = model.error;
    else delete (view as { message?: string }).message;
  };
  context.subscriptions.push(model.onDidChange(paint));

  // 캐릭터. 알림이 떠 있는 동안에만 컨테이너에 존재한다.
  const script = await readFile(
    vscode.Uri.joinPath(context.extensionUri, 'out', 'webview.js').fsPath,
    'utf8',
  );
  const character = new CharacterViewProvider(script);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CHARACTER_VIEW_ID, character, {
      webviewOptions: { retainContextWhenHidden: false },
    }),
  );

  const setAlerting = (on: boolean): void => {
    void vscode.commands.executeCommand('setContext', ALERT_CONTEXT, on);
  };
  setAlerting(false);

  context.subscriptions.push(
    model.onDidAlert((line) => {
      if (config().get<AlertMode>('alertInPanel', 'character') !== 'character') return;
      character.say(line, model.snapshot ? gaugesFromSnapshot(model.snapshot) : []);
      setAlerting(true);
    }),
    // 대사가 끝나면 카드를 걷는다. 숫자 줄이 그 자리에 다시 나타난다.
    model.onDidChange(() => {
      if (model.line !== null) return;
      setAlerting(false);
      // 돌아온 뷰는 머리줄이 비어 있다. 다음 조회를 기다리지 않고 바로 채운다.
      paint();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('claudeUsage.refresh', () => void model.refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('claudeUsage.language')) {
        applyLocale();
        paint();
      }
      if (e.affectsConfiguration('claudeUsage.pollIntervalSec')) void model.restart();
    }),
  );

  warnIfContainerMissing();

  // 개발 중 확인용. 실제 사용자의 패널을 확장이 마음대로 열지 않는다.
  // 폴링보다 먼저 열어둔다 — 첫 조회에서 바로 알림이 뜰 수 있기 때문이다.
  if (process.env['CUT_DEV_REVEAL'] === '1') {
    await vscode.commands.executeCommand(`workbench.view.extension.${CLAUDE_CONTAINER}`);
  }

  await model.start();
}

/**
 * 우리 뷰는 남의 확장이 선언한 컨테이너에 얹혀 있다. 그쪽이 id를 바꾸면
 * 뷰는 오류 없이 그냥 사라진다 — 조용히 사라지는 것이 가장 나쁘므로,
 * 여기서 한 번 확인하고 알린다.
 */
function warnIfContainerMissing(): void {
  const claude = vscode.extensions.getExtension('anthropic.claude-code');
  if (!claude) return;
  const containers = claude.packageJSON?.contributes?.viewsContainers ?? {};
  const ids = new Set<string>();
  for (const group of Object.values(containers) as { id: string }[][]) {
    for (const entry of group ?? []) ids.add(entry.id);
  }
  if (ids.has(CLAUDE_CONTAINER)) return;
  void vscode.window.showWarningMessage(
    'Claude Code 확장이 패널 구조를 바꾼 것 같습니다. 사용량 뷰가 보이지 않으면 확장을 업데이트해 주세요.',
  );
}

export function deactivate(): void {
  // 구독은 전부 context.subscriptions에 실려 있다.
}
