import { writeFileSync } from 'node:fs';
import { PixelGrid } from '../src/shared/pixel/grid.js';
import { encodePNG } from '../src/shared/pixel/png.js';
import { ALL_EXPRESSIONS, ANIMATIONS, buildFrame, SPRITE_SIZE } from '../src/shared/character/sprites.js';

/**
 * 표정별 프레임을 한 장의 시트로 뽑아 눈으로 확인하는 개발 도구.
 *   npx tsx tools/preview-sprites.ts out.png [scale]
 */

const outPath = process.argv[2] ?? 'sprite-preview.png';
const scale = Number.parseInt(process.argv[3] ?? '8', 10);
const PAD = 2;
const BG = '#1a1a1a';
const BG_ALT = '#242424';

const maxFrames = Math.max(...ALL_EXPRESSIONS.map((e) => ANIMATIONS[e].ticks.length));
const cellW = SPRITE_SIZE + PAD * 2;
const cellH = SPRITE_SIZE + PAD * 2;
const sheetW = cellW * maxFrames;
const sheetH = cellH * ALL_EXPRESSIONS.length;

const sheet = new PixelGrid(sheetW, sheetH);

// 표정마다 배경 명도를 번갈아 줘서 행 경계가 보이게 한다.
ALL_EXPRESSIONS.forEach((expr, row) => {
  sheet.rect(0, row * cellH, sheetW, cellH, row % 2 === 0 ? BG : BG_ALT);
});

ALL_EXPRESSIONS.forEach((expr, row) => {
  ANIMATIONS[expr].ticks.forEach((tick, col) => {
    const frame = buildFrame({ expression: expr, tick });
    const ox = col * cellW + PAD;
    const oy = row * cellH + PAD;
    for (let y = 0; y < SPRITE_SIZE; y++) {
      for (let x = 0; x < SPRITE_SIZE; x++) {
        const p = frame.get(x, y);
        if (p !== null) sheet.set(ox + x, oy + y, p);
      }
    }
  });
});

// 최근접 확대 — 픽셀 아트는 절대 보간하지 않는다.
const big = new PixelGrid(sheetW * scale, sheetH * scale);
for (let y = 0; y < sheetH; y++) {
  for (let x = 0; x < sheetW; x++) {
    const p = sheet.get(x, y);
    if (p !== null) big.rect(x * scale, y * scale, scale, scale, p);
  }
}

writeFileSync(outPath, encodePNG(big.width, big.height, big.toRGBA()));
console.log(`${outPath}  ${big.width}x${big.height}  (표정 ${ALL_EXPRESSIONS.length}행)`);
console.log(ALL_EXPRESSIONS.map((e, i) => `  행${i + 1}: ${e}`).join('\n'));
