import { app, screen, shell, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { UsagePoller } from '../core/poller.js';
import { normalizeUsage } from '../core/usage-api.js';
import { loadCredentials } from '../core/credentials.js';
import { gaugesFromSnapshot } from '../shared/ipc.js';
import {
  lineForGreeting,
  lineForManualCheck,
  lineForThreshold,
  type Line,
} from '../shared/character/script.js';
import { EventSpool } from './event-spool.js';
import { Logger, logDir } from './logger.js';
import { OverlayController } from './overlay-controller.js';
import { SessionGreeter } from './session-greeter.js';
import { SettingsStore } from './settings-store.js';
import { openSettings, settingsRendererTarget } from './settings-window.js';
import { UsageTray } from './tray.js';
import { applyAutostart } from './autostart.js';
import { findWorkingWindow } from './window-anchor.js';
import {
  createOverlayWindow,
  repositionOverlay,
  type OverlayPlacement,
} from './overlay-window.js';
import type { Severity, UsageResponse, UsageSnapshot } from '../core/types.js';
import type { Settings } from '../shared/settings.js';

/**
 * 메인 프로세스.
 *
 * 배선만 한다. 판단은 각 모듈이 하고, 여기서는 그것들을 연결하고
 * 설정 변경을 흘려보내는 일만 맡는다.
 */

let overlayWin: BrowserWindow | null = null;
let controller: OverlayController | null = null;
let poller: UsagePoller | null = null;
let spool: EventSpool | null = null;
let greeter: SessionGreeter | null = null;
let tray: UsageTray | null = null;

const store = new SettingsStore();
const logger = new Logger({ echo: !app.isPackaged });

let lastSnapshot: UsageSnapshot | null = null;
let lastError: string | null = null;
let subscription: string | null = null;

/** 실제 API 없이 연출만 확인하는 개발 모드. */
const DEMO = process.argv.includes('--demo');
const CAPTURE = process.argv.find((a) => a.startsWith('--capture='))?.slice('--capture='.length);

function placement(anchorRect?: OverlayPlacement['anchorRect']): OverlayPlacement {
  const s = store.value;
  return {
    corner: s.corner,
    margin: s.margin,
    display: 'cursor',
    ...(anchorRect ? { anchorRect } : {}),
  };
}

/**
 * 띄우기 직전에 배치를 정한다.
 *
 * '작업 중인 창' 모드에서는 매번 창 위치를 다시 본다 — 사용자가 창을
 * 옮기거나 다른 창으로 넘어가면 캐릭터도 따라가야 의미가 있다.
 * 창을 찾지 못하면 화면 모서리로 물러난다.
 */
async function applyPlacement(cwd: string | null = null): Promise<void> {
  if (!overlayWin || overlayWin.isDestroyed()) return;

  let anchorRect: OverlayPlacement['anchorRect'];
  if (store.value.anchor === 'window') {
    const found = await findWorkingWindow(cwd);
    if (found) {
      anchorRect = { x: found.x, y: found.y, width: found.width, height: found.height };
    } else {
      logger.info('작업 중인 창을 찾지 못해 화면 모서리에 띄웁니다.');
    }
  }
  repositionOverlay(overlayWin, placement(anchorRect));

  const b = overlayWin.getBounds();
  const where = anchorRect ? `창 기준 ${store.value.corner}` : `화면 기준 ${store.value.corner}`;
  logger.info(`배치 — ${where} → (${b.x}, ${b.y}) ${b.width}×${b.height}`);
}

/** 설정의 표시 시간 배율을 대사에 적용한다. */
function scaled(line: Line): Line {
  const scale = store.value.holdScale;
  return scale === 1 ? line : { ...line, holdMs: Math.round(line.holdMs * scale) };
}

/** 캐릭터를 띄운다. 설정에서 껐으면 아무 일도 하지 않는다. */
function present(
  line: Line,
  severity: Severity,
  snapshot: UsageSnapshot | null,
  cwd: string | null = null,
): void {
  if (!store.value.characterEnabled) return;
  // 자리를 먼저 잡고 띄운다. 순서가 바뀌면 캐릭터가 옛 자리에서 한 번
  // 깜박였다가 옮겨 간다.
  void applyPlacement(cwd).then(() => {
    controller?.enqueue(
      scaled(line),
      severity,
      snapshot ? gaugesFromSnapshot(snapshot) : [],
      store.value.corner,
    );
  });
}

function rendererTarget(): { rendererUrl?: string; rendererFile?: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) return { rendererUrl: devUrl };
  return { rendererFile: join(__dirname, '../renderer/index.html') };
}

function createOverlay(): void {
  overlayWin = createOverlayWindow({
    preloadPath: join(__dirname, '../preload/index.cjs'),
    placement: placement(),
    ...rendererTarget(),
  });

  if (CAPTURE) {
    overlayWin.webContents.on('console-message', (_e, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
  }

  controller = new OverlayController(overlayWin);

  overlayWin.on('closed', () => {
    controller?.dispose();
    controller = null;
    overlayWin = null;
  });
}

function watchDisplays(): void {
  const reposition = (): void => {
    void applyPlacement();
  };
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
}

/* ------------------------------------------------------------------ */
/* 폴링                                                                */
/* ------------------------------------------------------------------ */

function startPolling(): void {
  poller?.stop();
  poller = new UsagePoller({
    intervalMs: store.value.pollIntervalSec * 1000,
    thresholds: store.value.thresholds,
  });

  poller.on('snapshot', (snapshot) => {
    lastSnapshot = snapshot;
    lastError = null;
    tray?.update(snapshot);
  });

  poller.on('threshold', (event, snapshot) => {
    logger.info(`임계값 ${event.threshold}% 돌파 (${event.window} ${event.percent}%)`);
    present(lineForThreshold(event, snapshot.fetchedAt), event.severity, snapshot);
  });

  poller.on('error', (_err, message, willRetry) => {
    lastError = message;
    tray?.setError(message);
    logger.warn(`${message}${willRetry ? ' (재시도합니다)' : ''}`);
  });

  void poller.start();
}

/**
 * 폴링과 관련된 설정이 바뀌면 폴러를 다시 만든다.
 *
 * 주기와 임계값은 폴러 생성 시점에 굳는다. 살아 있는 폴러를 고쳐 쓰기보다
 * 새로 만드는 쪽이 상태가 어긋날 여지가 없다.
 */
function onSettingsChanged(next: Settings, prev: Settings): void {
  if (next.pollIntervalSec !== prev.pollIntervalSec || next.thresholds.join() !== prev.thresholds.join()) {
    logger.info(`폴링 설정 변경 — ${next.pollIntervalSec}초, 임계값 ${next.thresholds.join('/')}`);
    startPolling();
  }

  if (next.corner !== prev.corner || next.margin !== prev.margin || next.anchor !== prev.anchor) {
    if (overlayWin) void applyPlacement();
  }

  if (next.autostart !== prev.autostart) {
    void applyAutostart(next.autostart, { exec: autostartCommand() }).then((ok) => {
      logger.info(ok ? `자동 시작 ${next.autostart ? '켜짐' : '꺼짐'}` : '자동 시작 설정 실패');
    });
  }
}

/**
 * 자동 시작에 넣을 명령.
 *
 * 패키징된 AppImage는 그 자체가 실행 파일이므로 경로 하나면 된다.
 * 개발 중에는 electron이 프로젝트를 인자로 받아야 하므로 둘을 나눈다.
 */
function autostartCommand(): string {
  if (app.isPackaged) return process.execPath;
  return `${process.execPath} ${app.getAppPath()}`;
}

/* ------------------------------------------------------------------ */
/* 세션 훅                                                             */
/* ------------------------------------------------------------------ */

function startSessionHooks(): void {
  greeter = new SessionGreeter({
    refresh: async () => (await poller?.refreshNow()) ?? null,
    present: (line, snapshot, cwd) => {
      if (!store.value.greetOnSessionStart) return;
      present(line, snapshot.severity, snapshot, cwd);
    },
  });

  spool = new EventSpool((event) => void greeter?.handle(event));

  void spool.start().catch((e: unknown) => {
    logger.error(`이벤트 수신을 시작하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
  });
}

/* ------------------------------------------------------------------ */
/* 트레이                                                              */
/* ------------------------------------------------------------------ */

/** 트레이의 '지금 확인'. 폴링 주기를 기다리지 않고 그 자리에서 읽는다. */
async function checkNow(): Promise<void> {
  const snapshot = (await poller?.refreshNow()) ?? lastSnapshot;
  if (!snapshot) {
    logger.warn('지금 확인: 사용량을 읽지 못했습니다.');
    return;
  }
  present(lineForManualCheck(snapshot, snapshot.fetchedAt), snapshot.severity, snapshot);
}

function startTray(): void {
  tray = new UsageTray({
    checkNow: () => void checkNow(),
    openSettings: () =>
      openSettings({
        store,
        logger,
        preview: () => void checkNow(),
        subscription: () => subscription,
        lastError: () => lastError,
        preloadPath: join(__dirname, '../preload/settings.cjs'),
        ...settingsRendererTarget(__dirname),
      }),
    openLogs: () => void shell.openPath(logDir()),
    quit: () => app.quit(),
  });
  tray.create();
  if (lastSnapshot) tray.update(lastSnapshot);
}

/* ------------------------------------------------------------------ */
/* 데모                                                                */
/* ------------------------------------------------------------------ */

interface DemoScene {
  name: string;
  line: Line;
  severity: Severity;
  gauges: ReturnType<typeof gaugesFromSnapshot>;
}

function demoScenes(): DemoScene[] {
  const fake = (fivePct: number, weekPct: number): UsageResponse => ({
    five_hour: {
      utilization: fivePct,
      resets_at: new Date(Date.now() + 2.5 * 3600_000).toISOString(),
      limit_dollars: null,
      used_dollars: null,
      remaining_dollars: null,
    },
    seven_day: {
      utilization: weekPct,
      resets_at: new Date(Date.now() + 4.2 * 86400_000).toISOString(),
      limit_dollars: null,
      used_dollars: null,
      remaining_dollars: null,
    },
    seven_day_opus: null,
    seven_day_sonnet: null,
    limits: [],
    extra_usage: null,
  });

  const severityFor = (threshold: number): Severity =>
    threshold >= 90 ? 'critical' : threshold >= 70 ? 'warning' : 'normal';

  const steps = [
    { five: 12, week: 8, threshold: 0 },
    { five: 52, week: 30, threshold: 50 },
    { five: 73, week: 44, threshold: 70 },
    { five: 91, week: 61, threshold: 90 },
    { five: 100, week: 78, threshold: 100 },
  ];

  return steps.map((step) => {
    const snapshot = normalizeUsage(fake(step.five, step.week));
    const gauges = gaugesFromSnapshot(snapshot);

    if (step.threshold === 0) {
      return { name: 'greeting', line: lineForGreeting(snapshot), severity: snapshot.severity, gauges };
    }

    const severity = severityFor(step.threshold);
    const line = lineForThreshold(
      {
        window: 'fiveHour',
        threshold: step.threshold,
        percent: step.five,
        resetsAt: snapshot.fiveHour.resetsAt,
        severity,
      },
      snapshot.fetchedAt,
    );
    return { name: `threshold-${step.threshold}`, line, severity, gauges };
  });
}

function runDemo(): void {
  demoScenes().forEach((scene, i) => {
    setTimeout(() => {
      controller?.enqueue(scene.line, scene.severity, scene.gauges, store.value.corner);
    }, i * 8000);
  });
}

async function captureDemo(dir: string): Promise<void> {
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });

  // capturePage는 투명 창을 통째로 투명하게 캡처한다. 배치와 색을 눈으로
  // 확인하려면 임시 배경이 필요하다 — 캡처 모드에서만 깔고, 실제 실행에는
  // 영향을 주지 않는다.
  await overlayWin?.webContents.insertCSS('body { background: #1e1e1e !important; }');

  for (const [i, scene] of demoScenes().entries()) {
    controller?.clear();
    await new Promise((r) => setTimeout(r, 120));
    controller?.enqueue(scene.line, scene.severity, scene.gauges, store.value.corner);
    await new Promise((r) => setTimeout(r, 1400));

    if (!overlayWin || overlayWin.isDestroyed()) break;
    const image = await overlayWin.webContents.capturePage();
    await writeFile(join(dir, `${i}-${scene.name}.png`), image.toPNG());
    console.log(`captured ${i}-${scene.name}.png`);
  }
  app.quit();
}

/** 훅 왕복을 눈으로 확인하는 캡처 모드. */
async function captureHookFlow(dir: string): Promise<void> {
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  await overlayWin?.webContents.insertCSS('body { background: #1e1e1e !important; }');
  console.log(`hook-capture ready: ${spool?.directory ?? '(스풀 없음)'}`);

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (!overlayWin || overlayWin.isDestroyed()) break;
    if (!overlayWin.isVisible()) continue;

    await new Promise((r) => setTimeout(r, 900));
    const image = await overlayWin.webContents.capturePage();
    await writeFile(join(dir, 'hook-greeting.png'), image.toPNG());
    console.log('captured hook-greeting.png');
    break;
  }
  app.quit();
}

/* ------------------------------------------------------------------ */

// 오버레이는 하나만 떠야 한다. 두 번째 인스턴스는 조용히 종료한다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 투명 창이 검게 뜨는 리눅스 합성기 문제를 피한다.
  app.commandLine.appendSwitch('enable-transparent-visuals');

  void app.whenReady().then(async () => {
    let prev = await store.load();
    store.subscribe((next) => {
      const before = prev;
      prev = next;
      onSettingsChanged(next, before);
    });

    logger.info(`시작 — 임계값 ${prev.thresholds.join('/')}, ${prev.pollIntervalSec}초 주기`);

    createOverlay();
    watchDisplays();

    if (DEMO) {
      if (CAPTURE) void captureDemo(CAPTURE);
      else runDemo();
      return;
    }

    // 플랜 표시는 실패해도 앱 동작에 영향이 없다.
    try {
      subscription = (await loadCredentials()).subscriptionType;
    } catch {
      subscription = null;
    }

    startPolling();
    startSessionHooks();
    startTray();

    // 설정과 실제 상태가 어긋나 있을 수 있다(파일을 손으로 지운 경우 등).
    void applyAutostart(prev.autostart, { exec: autostartCommand() });

    if (CAPTURE) void captureHookFlow(CAPTURE);
  });

  // 트레이 상주 앱이라 창이 없어도 살아 있어야 한다.
  app.on('window-all-closed', () => {
    // 의도적으로 아무것도 하지 않는다.
  });

  app.on('before-quit', () => {
    logger.info('종료합니다.');
    poller?.stop();
    controller?.clear();
    tray?.destroy();
    // 스풀 디렉터리를 지워야 훅이 '앱이 없다'를 알아챈다.
    // before-quit은 프로미스를 기다리지 않으므로 동기로 지운다.
    spool?.stopSync();
  });
}
