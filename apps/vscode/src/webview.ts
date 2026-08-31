import { CharacterAnimator } from '../../../src/shared/character/animator.js';
import { SPRITE_H, SPRITE_W, type Expression } from '../../../src/shared/character/sprites.js';
import type { GaugeInfo } from '../../../src/shared/ipc.js';

/**
 * 알림이 떠 있는 동안 드롭다운을 차지하는 카드.
 *
 * 데스크톱 오버레이와 같은 캐릭터를 같은 애니메이터로 그린다. 사용량 막대를
 * 함께 두는 이유는 하나다 — 캐릭터가 나온 자리에서 숫자까지 읽히지 않으면,
 * 사용자는 알림을 보고 나서 다시 어딘가를 찾아봐야 한다.
 */

interface Payload {
  expression: Expression;
  title: string;
  detail: string;
  gauges: GaugeInfo[];
}

const canvas = document.getElementById('claw') as HTMLCanvasElement;
const titleEl = document.getElementById('title') as HTMLParagraphElement;
const detailEl = document.getElementById('detail') as HTMLParagraphElement;
const gaugesEl = document.getElementById('gauges') as HTMLDivElement;

const ctx = canvas.getContext('2d');
if (ctx === null) throw new Error('Could not create a 2D context.');
const paint = ctx;
paint.imageSmoothingEnabled = false;

const animator = new CharacterAnimator();
const imageData = paint.createImageData(SPRITE_W, SPRITE_H);
let lastFrameTime = performance.now();

function draw(): void {
  imageData.data.set(animator.currentFrame().toRGBA());
  paint.putImageData(imageData, 0, 0);
}

function loop(now: number): void {
  const dt = Math.min(100, now - lastFrameTime);
  lastFrameTime = now;
  animator.advance(dt);
  draw();
  requestAnimationFrame(loop);
}

function renderGauges(gauges: GaugeInfo[]): void {
  gaugesEl.replaceChildren();
  for (const g of gauges) {
    const row = document.createElement('div');
    row.className = 'gauge';

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = g.label;

    const track = document.createElement('div');
    track.className = 'track';
    const fill = document.createElement('div');
    fill.className = `fill ${g.severity}`;
    // 0%도 한 칸은 보이게 — 완전히 빈 막대는 고장처럼 보인다.
    fill.style.width = `${Math.max(3, Math.min(100, g.percent))}%`;
    track.append(fill);

    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = `${Math.round(g.percent)}%`;

    row.append(label, track, value);
    gaugesEl.append(row);
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  const line = event.data as Payload | undefined;
  if (!line || typeof line.title !== 'string') return;
  animator.setExpression(line.expression);
  titleEl.textContent = line.title;
  detailEl.textContent = line.detail;
  renderGauges(line.gauges ?? []);
});

draw();
requestAnimationFrame(loop);
