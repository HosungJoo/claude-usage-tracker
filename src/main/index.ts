import { app, screen, type BrowserWindow } from 'electron';
import { join } from 'node:path';
import { UsagePoller } from '../core/poller.js';
import { normalizeUsage } from '../core/usage-api.js';
import { gaugesFromSnapshot } from '../shared/ipc.js';
import { lineForGreeting, lineForThreshold } from '../shared/character/script.js';
import { OverlayController } from './overlay-controller.js';
import {
  createOverlayWindow,
  DEFAULT_PLACEMENT,
  repositionOverlay,
  type OverlayPlacement,
} from './overlay-window.js';
import type { Severity, UsageResponse } from '../core/types.js';

/**
 * 메인 프로세스.
 *
 * M2 시점의 역할: 오버레이 창을 띄우고, 폴러의 임계값 이벤트를
 * 캐릭터 등장으로 연결한다. 트레이와 설정은 M4에서 붙는다.
 */

let overlayWin: BrowserWindow | null = null;
let controller: OverlayController | null = null;
let poller: UsagePoller | null = null;
// M4에서 설정 화면이 이 값을 바꾼다. 지금은 기본값 고정.
const placement: OverlayPlacement = DEFAULT_PLACEMENT;

/** 실제 API 없이 연출만 확인하는 개발 모드. */
const DEMO = process.argv.includes('--demo');

/**
 * `--capture=<경로>` — 데모의 각 단계를 PNG로 저장하고 종료한다.
 * 오버레이는 눈으로 봐야 맞는지 알 수 있는데, 매번 띄워 보기는 번거롭다.
 */
const CAPTURE = process.argv.find((a) => a.startsWith('--capture='))?.slice('--capture='.length);

function rendererTarget(): { rendererUrl?: string; rendererFile?: string } {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) return { rendererUrl: devUrl };
  return { rendererFile: join(__dirname, '../renderer/index.html') };
}

function createOverlay(): void {
  overlayWin = createOverlayWindow({
    preloadPath: join(__dirname, '../preload/index.cjs'),
    placement,
    ...rendererTarget(),
  });

  if (CAPTURE) {
    overlayWin.webContents.on('console-message', (_e, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    overlayWin.webContents.on('render-process-gone', (_e, d) => {
      console.log(`[renderer gone] ${d.reason}`);
    });
    overlayWin.webContents.on('preload-error', (_e, path, err) => {
      console.log(`[preload error] ${path}: ${err.message}`);
    });
  }

  overlayWin.webContents.on('did-finish-load', () => {
    // 렌더러가 코너에 맞춰 말풍선 꼬리 방향을 바꿀 수 있게 알려준다.
    void overlayWin?.webContents.executeJavaScript(
      `document.body.dataset.align = ${JSON.stringify(placement.corner)};`,
    );
  });

  controller = new OverlayController(overlayWin);

  overlayWin.on('closed', () => {
    controller?.dispose();
    controller = null;
    overlayWin = null;
  });
}

function watchDisplays(): void {
  const reposition = (): void => {
    if (overlayWin) repositionOverlay(overlayWin, placement);
  };
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
  screen.on('display-metrics-changed', reposition);
}

function startPolling(): void {
  poller = new UsagePoller();

  poller.on('threshold', (event, snapshot) => {
    controller?.enqueue(
      lineForThreshold(event, snapshot.fetchedAt),
      event.severity,
      gaugesFromSnapshot(snapshot),
    );
  });

  poller.on('error', (_err, message) => {
    // M4에서 트레이 아이콘과 로그로 드러낸다. 지금은 콘솔까지만.
    console.error(`[usage] ${message}`);
  });

  void poller.start();
}

/** 데모 장면 하나. 캐릭터가 무슨 표정으로 무슨 말을 하는지의 조합. */
interface DemoScene {
  name: string;
  line: ReturnType<typeof lineForGreeting>;
  severity: Severity;
  gauges: ReturnType<typeof gaugesFromSnapshot>;
}

/** --demo: 실제 API 없이 연출 전체를 눈으로 확인한다. */
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
      controller?.enqueue(scene.line, scene.severity, scene.gauges);
    }, i * 8000);
  });
}

/**
 * 각 데모 장면을 하나씩 띄워 PNG로 남긴다.
 *
 * 큐를 기다리지 않고 매번 비우고 새로 넣는다 — 여기서 보고 싶은 건
 * 큐 동작이 아니라 장면별 그림이다.
 */
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
    controller?.enqueue(scene.line, scene.severity, scene.gauges);
    // 등장 연출(약 700ms)이 끝난 뒤를 찍는다.
    await new Promise((r) => setTimeout(r, 1400));

    if (!overlayWin || overlayWin.isDestroyed()) break;
    const image = await overlayWin.webContents.capturePage();
    const name = `${i}-${scene.name}.png`;
    await writeFile(join(dir, name), image.toPNG());
    console.log(`captured ${name}`);
  }
  app.quit();
}

// 오버레이는 하나만 떠야 한다. 두 번째 인스턴스는 조용히 종료한다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 투명 창이 검게 뜨는 리눅스 합성기 문제를 피한다.
  app.commandLine.appendSwitch('enable-transparent-visuals');

  void app.whenReady().then(() => {
    createOverlay();
    watchDisplays();
    if (DEMO) {
      if (CAPTURE) void captureDemo(CAPTURE);
      else runDemo();
    } else {
      startPolling();
    }
  });

  // 트레이 상주 앱이라 창이 없어도 살아 있어야 한다. 이 핸들러를
  // 등록해 두는 것만으로 기본 종료 동작이 막힌다.
  app.on('window-all-closed', () => {
    // 의도적으로 아무것도 하지 않는다.
  });

  app.on('before-quit', () => {
    poller?.stop();
    controller?.clear();
  });
}
