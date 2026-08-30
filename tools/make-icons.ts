import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderTrayIcon } from '../src/main/tray-icon.js';

/**
 * 앱 아이콘을 캐릭터에서 뽑아 build/ 아래에 떨어뜨린다.
 *
 * 트레이 아이콘과 같은 이유로 파일을 리포에 두지 않는다 — 캐릭터가
 * 바뀌면 아이콘도 같이 바뀌어야 하는데, 커밋된 PNG는 그 동기화를
 * 사람이 기억해야 한다. 패키징 직전에 매번 새로 그린다.
 *
 * electron-builder는 build/icon.png 하나만 있어도 되지만, 여러 크기를
 * 주면 각 자리(런처·독·창 목록)에 맞는 것을 골라 쓴다. 캐릭터는 24×16
 * 픽셀 아트라 작은 크기에서 정수 배율이 달라지므로, 크기마다 다시
 * 그리는 편이 축소본보다 선명하다.
 */

const SIZES = [16, 32, 48, 64, 128, 256, 512];

/**
 * 런처에서 아이콘끼리 붙어 보이지 않도록 8%를 비운다. 트레이와 달리
 * 여기서는 꽉 채우는 것보다 하나로 보이는 게 중요하다.
 */
const MARGIN_RATIO = 0.08;

function iconFor(size: number): Uint8Array {
  return renderTrayIcon('idle', size, Math.round(size * MARGIN_RATIO));
}

async function main(): Promise<void> {
  const dir = process.argv[2] ?? 'build';
  const iconsDir = join(dir, 'icons');
  await mkdir(iconsDir, { recursive: true });

  for (const size of SIZES) {
    await writeFile(join(iconsDir, `${size}x${size}.png`), iconFor(size));
  }

  // electron-builder가 기본으로 찾는 자리.
  await writeFile(join(dir, 'icon.png'), iconFor(512));

  console.log(`아이콘 ${SIZES.length + 1}개 생성 — ${dir}/icon.png, ${iconsDir}/`);
}

void main();
