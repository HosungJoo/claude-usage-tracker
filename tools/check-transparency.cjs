/**
 * 오버레이가 실제로 투명한지 검사한다.
 *
 *   npm run check:transparency
 *
 * 이 속성은 조용히 깨진다. body에 background 한 줄이 들어가거나 창 옵션
 * 하나가 바뀌면, 캐릭터 대신 검은 사각형이 화면에 뜬다. 그런데 테스트로는
 * 잡히지 않는다 — 실제로 창을 띄워 알파 채널을 봐야 알 수 있다.
 *
 * capturePage는 투명 창의 알파를 그대로 돌려주므로, 캐릭터 밖이 투명하고
 * 불투명한 영역에 검은 픽셀이 없으면 통과다.
 */
const { app, BrowserWindow } = require('electron');
const { join } = require('node:path');

const ROOT = join(__dirname, '..');

/** 캐릭터·말풍선이 차지해야 할 최소 비율. 이보다 적으면 아무것도 안 그려진 것이다. */
const MIN_OPAQUE_RATIO = 0.05;
/** 투명해야 할 최소 비율. 이보다 적으면 배경이 칠해진 것이다. */
const MIN_TRANSPARENT_RATIO = 0.5;

app.commandLine.appendSwitch('enable-transparent-visuals');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 380,
    height: 250,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    ...(process.platform === 'linux' ? { type: 'notification' } : {}),
    webPreferences: {
      preload: join(ROOT, 'out/preload/index.cjs'),
      contextIsolation: true,
    },
  });

  await win.loadFile(join(ROOT, 'out/renderer/index.html'));
  win.showInactive();

  // 렌더러를 직접 몰아 캐릭터를 띄운다. 메인 프로세스 없이도 확인 가능해야 한다.
  await win.webContents.executeJavaScript(`
    document.getElementById('title').textContent = '투명도 검사';
    document.getElementById('detail').textContent = '이 창 밖은 투명해야 합니다';
    document.getElementById('stage').classList.add('visible');
  `);
  await new Promise((r) => setTimeout(r, 1500));

  const image = await win.webContents.capturePage();
  const { width, height } = image.getSize();
  const bmp = image.getBitmap(); // BGRA

  let opaque = 0;
  let transparent = 0;
  let opaqueBlack = 0;
  for (let i = 0; i < width * height; i++) {
    const a = bmp[i * 4 + 3];
    if (a > 200) {
      opaque++;
      if (bmp[i * 4] < 20 && bmp[i * 4 + 1] < 20 && bmp[i * 4 + 2] < 20) opaqueBlack++;
    } else if (a < 20) {
      transparent++;
    }
  }

  const total = width * height;
  const opaqueRatio = opaque / total;
  const transparentRatio = transparent / total;

  const problems = [];
  if (opaqueRatio < MIN_OPAQUE_RATIO) {
    problems.push(`그려진 것이 거의 없습니다 (불투명 ${(opaqueRatio * 100).toFixed(1)}%)`);
  }
  if (transparentRatio < MIN_TRANSPARENT_RATIO) {
    problems.push(
      `배경이 칠해졌습니다 (투명 ${(transparentRatio * 100).toFixed(1)}%) — ` +
        'body나 창 옵션에 background가 들어갔는지 확인하세요',
    );
  }
  if (opaqueBlack > total * 0.01) {
    problems.push(`검은 픽셀이 ${opaqueBlack}개 있습니다 — 투명 창이 검게 렌더되고 있습니다`);
  }

  console.log(`${width}x${height}`);
  console.log(`  불투명 ${(opaqueRatio * 100).toFixed(1)}%  투명 ${(transparentRatio * 100).toFixed(1)}%  검정 ${opaqueBlack}`);
  if (problems.length > 0) {
    console.error('\n✗ 투명도 검사 실패');
    for (const p of problems) console.error(`  - ${p}`);
  } else {
    console.log('\n✓ 캐릭터와 말풍선만 그려집니다');
  }

  win.destroy();
  app.exit(problems.length > 0 ? 1 : 0);
});
