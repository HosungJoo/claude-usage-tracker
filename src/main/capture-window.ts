import { BrowserWindow } from 'electron';
import { OVERLAY_DIMENSIONS, type OverlaySize } from './overlay-window.js';
import { IPC, type ShowRequest } from '../shared/ipc.js';

/**
 * 문서용 스크린샷을 찍는 전용 창.
 *
 * 원래는 살아 있는 오버레이 창 하나를 빌려 찍었다. 두 가지가 어긋났다.
 *
 * 1. 캡처하려면 배경이 필요하다. capturePage는 투명 창의 알파를 그대로
 *    돌려주므로, 투명한 채로 찍으면 아무것도 안 보이는 PNG가 나온다.
 *    그런데 그 배경을 살아 있는 창에 주입하면 사용자 화면에 검은 판이
 *    실제로 뜬다.
 * 2. 오버레이는 화면마다 창이 하나씩이다. 주입은 그중 하나에만 걸려서,
 *    한쪽 모니터는 검은 배경, 다른 쪽은 투명 캐릭터로 갈렸다.
 *
 * 그래서 캡처는 오버레이를 건드리지 않고 자기 창을 따로 연다. 오프스크린
 * 렌더링이라 화면에는 아무것도 뜨지 않는다.
 */

export interface CaptureWindowOptions {
  preloadPath: string;
  /** dev 서버 URL이 있으면 그쪽을, 없으면 빌드된 파일을 연다. */
  rendererUrl?: string;
  rendererFile?: string;
  size: OverlaySize;
  /** 캡처 배경색. 투명하게 찍으면 캐릭터가 보이지 않는다. */
  background?: string;
}

const DEFAULT_BACKGROUND = '#1e1e1e';

/** 창을 열고 렌더러가 준비될 때까지 기다린다. */
export async function openCaptureWindow(
  options: CaptureWindowOptions,
): Promise<BrowserWindow> {
  const { width, height } = OVERLAY_DIMENSIONS[options.size];

  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    // 오버레이와 달리 투명하지 않다. 캡처 결과에 배경이 남아야 한다.
    transparent: false,
    backgroundColor: options.background ?? DEFAULT_BACKGROUND,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 화면에 띄우지 않고 그리게 한다. show:false 인 창은 합성기가
      // 그리지 않아서 capturePage가 빈 이미지를 돌려줄 수 있다.
      offscreen: true,
      backgroundThrottling: false,
    },
  });

  const loaded = new Promise<void>((resolve) => {
    win.webContents.once('did-finish-load', () => resolve());
  });

  if (options.rendererUrl) await win.loadURL(options.rendererUrl);
  else if (options.rendererFile) await win.loadFile(options.rendererFile);
  await loaded;

  // 렌더러의 body는 투명이다. 캡처에서는 그 위에 배경을 깔아야 한다.
  await win.webContents.insertCSS(
    `body { background: ${options.background ?? DEFAULT_BACKGROUND} !important; }`,
  );

  return win;
}

/** 한 장면을 그리고 PNG 바이트를 돌려준다. */
export async function captureScene(
  win: BrowserWindow,
  req: ShowRequest,
  settleMs = 1400,
): Promise<Buffer | null> {
  if (win.isDestroyed()) return null;

  win.webContents.send(IPC.hide);
  await delay(120);
  win.webContents.send(IPC.show, req);
  // 등장 연출이 끝나야 완성된 모습이 찍힌다.
  await delay(settleMs);

  if (win.isDestroyed()) return null;
  const image = await win.webContents.capturePage();
  return image.toPNG();
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
