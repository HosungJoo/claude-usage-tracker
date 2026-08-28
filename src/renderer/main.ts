import { CharacterAnimator } from '../shared/character/animator.js';
import { SPRITE_SIZE } from '../shared/character/sprites.js';
import type { GaugeInfo, ShowRequest } from '../shared/ipc.js';
import type { OverlayApi } from '../preload/index.js';

declare global {
  interface Window {
    overlay: OverlayApi;
  }
}

/**
 * 오버레이 렌더러.
 *
 * 하는 일은 셋뿐이다: 캐릭터를 캔버스에 그리고, 말풍선을 채우고,
 * 정해진 시간이 지나면 사라진다.
 */

const stage = document.getElementById('stage') as HTMLDivElement;
const bubble = document.getElementById('bubble') as HTMLDivElement;
const titleEl = document.getElementById('title') as HTMLParagraphElement;
const detailEl = document.getElementById('detail') as HTMLParagraphElement;
const gaugesEl = document.getElementById('gauges') as HTMLDivElement;
const canvas = document.getElementById('character') as HTMLCanvasElement;

const ctx = canvas.getContext('2d');
if (ctx === null) throw new Error('2D 컨텍스트를 만들 수 없습니다.');
const paint = ctx;
paint.imageSmoothingEnabled = false;

const animator = new CharacterAnimator();
const imageData = paint.createImageData(SPRITE_SIZE, SPRITE_SIZE);

let lastFrameTime = performance.now();
let hideTimer: number | null = null;
let currentId = -1;

/** 캔버스에 현재 프레임을 찍는다. */
function draw(): void {
  const rgba = animator.currentFrame().toRGBA();
  imageData.data.set(rgba);
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
    label.className = 'gauge-label';
    label.textContent = g.label;

    const track = document.createElement('div');
    track.className = 'gauge-track';
    const fill = document.createElement('div');
    fill.className = `gauge-fill ${g.severity}`;
    // 0%도 한 칸은 보이게 — 완전히 빈 막대는 고장처럼 보인다.
    fill.style.width = `${Math.max(3, Math.min(100, g.percent))}%`;
    track.append(fill);

    const value = document.createElement('span');
    value.className = 'gauge-value';
    value.textContent = `${Math.round(g.percent)}%`;

    row.append(label, track, value);
    gaugesEl.append(row);
  }
}

function clearHideTimer(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function hide(notify: boolean): void {
  clearHideTimer();
  stage.classList.remove('visible', 'entering');
  window.overlay.setInteractive(false);
  if (notify && currentId >= 0) window.overlay.dismissed(currentId);
  currentId = -1;
}

function show(req: ShowRequest): void {
  clearHideTimer();
  currentId = req.id;

  titleEl.textContent = req.line.title;
  detailEl.textContent = req.line.detail;
  renderGauges(req.gauges);

  stage.classList.remove('severity-normal', 'severity-warning', 'severity-critical');
  stage.classList.add(`severity-${req.severity}`);

  animator.setExpression(req.line.expression);

  // 등장 애니메이션을 다시 트리거하려면 클래스를 한 번 떼었다 붙여야 한다.
  stage.classList.remove('entering');
  void stage.offsetWidth;
  stage.classList.add('visible', 'entering');

  hideTimer = window.setTimeout(() => hide(true), req.line.holdMs);
}

// 말풍선 위에서만 클릭을 받는다. 그 외에는 창 전체가 클릭을 통과시킨다.
bubble.addEventListener('mouseenter', () => window.overlay.setInteractive(true));
bubble.addEventListener('mouseleave', () => window.overlay.setInteractive(false));
bubble.addEventListener('click', () => hide(true));

window.overlay.onShow(show);
window.overlay.onHide(() => hide(false));

// 창 크기로 어느 코너에 붙었는지 추론할 수 없으므로, 메인이 body의
// data 속성으로 알려준다.
const align = document.body.dataset['align'];
if (align?.includes('left')) stage.classList.add('align-left');
if (align?.includes('top')) stage.classList.add('align-top');

draw();
requestAnimationFrame(loop);
