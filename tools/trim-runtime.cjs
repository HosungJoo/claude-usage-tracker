const { rm, stat } = require('node:fs/promises');
const { join } = require('node:path');

/**
 * 패키징 직후, 이 앱이 쓰지 않는 Electron 런타임 부품을 지운다.
 *
 * 지울 것을 고르는 기준은 하나다 — **없을 때 무엇이 깨지는지 확인했는가.**
 * 크기가 커 보인다고 지우면, 쓰는 사람의 기계에서만 안 뜨는 앱이 된다.
 * 이 앱의 실패 방식은 '떴는데 못 봤다' 하나뿐이라, 렌더링에 관여하는 것은
 * 실제로 없이 돌려 본 뒤에만 뺀다.
 *
 * LICENSES.chromium.html(8.7MB)은 크지만 남긴다. 배포물에 라이선스 고지를
 * 함께 싣는 것은 Chromium을 쓰는 조건이다.
 *
 * SwiftShader를 뺄 때 확인한 것: 덜어낸 빌드를 `--disable-gpu
 * --disable-gpu-compositing`으로 — 즉 GPU 없는 기계처럼 — 돌려 다섯 장면을
 * 전부 캡처했고, GPU를 쓴 결과와 그림이 같았다. Chromium이 SwiftShader 없이
 * CPU 래스터라이저로 떨어지기 때문이다. 그 경로에서 stderr에 SwANGLE
 * 초기화 실패가 찍히지만 그리기에는 영향이 없다.
 */

/** 지울 파일과, 왜 없어도 되는지. */
const REMOVABLE = [
  {
    path: 'chrome_crashpad_handler',
    why: '크래시 리포터를 켜지 않는다. crashReporter.start()를 부르는 곳이 없다.',
  },
  {
    path: 'libvk_swiftshader.so',
    why: 'WebGL을 쓰지 않는다. 렌더러는 2D 캔버스 하나뿐이라 GPU 에뮬레이션이 필요 없다.',
  },
  {
    path: 'libvulkan.so.1',
    why: 'SwiftShader만 쓰던 Vulkan 로더. 함께 나간다.',
  },
  {
    path: 'vk_swiftshader_icd.json',
    why: '지워진 SwiftShader를 가리키는 등록 파일.',
  },
];

async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

exports.default = async function trimRuntime(context) {
  const dir = context.appOutDir;
  let freed = 0;

  for (const item of REMOVABLE) {
    const target = join(dir, item.path);
    const size = await sizeOf(target);
    if (size === 0) continue;
    await rm(target, { recursive: true, force: true });
    freed += size;
    console.log(`  • 제거 ${item.path} (${(size / 1048576).toFixed(1)}MB) — ${item.why}`);
  }

  if (freed > 0) {
    console.log(`  • 런타임에서 ${(freed / 1048576).toFixed(1)}MB 덜어냈습니다`);
  }
};
