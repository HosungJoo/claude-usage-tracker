import { CharacterAnimator } from '../shared/character/animator.js';
import { SPRITE_H, SPRITE_W } from '../shared/character/sprites.js';
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
if (ctx === null) throw new Error('Could not create a 2D context.');
const paint = ctx;
paint.imageSmoothingEnabled = false;

const animator = new CharacterAnimator();
const imageData = paint.createImageData(SPRITE_W, SPRITE_H);

let lastFrameTime = performance.now();
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

function hide(notify: boolean): void {
  stage.classList.remove('visible', 'entering');
  window.overlay.setInteractive(false);
  if (notify && currentId >= 0) window.overlay.dismissed(currentId);
  currentId = -1;
}

/**
 * 창이 붙은 모서리에 맞춰 캐릭터와 말풍선의 배치를 바꾼다.
 *
 * 화면 위쪽에 붙으면 말풍선이 캐릭터 아래로 가야 하고, 왼쪽에 붙으면
 * 꼬리가 왼쪽을 향해야 한다. 그러지 않으면 말풍선이 화면 밖을 가리킨다.
 */
function applyAlignment(req: ShowRequest): void {
  // 한가운데 모드는 모서리와 무관하다. 캐릭터가 위, 말풍선이 그 아래 가운데.
  stage.classList.toggle('centered', req.centered);
  stage.classList.toggle('large', req.size === 'large');
  stage.classList.toggle('align-left', !req.centered && req.corner.endsWith('left'));
  stage.classList.toggle('align-top', !req.centered && req.corner.startsWith('top'));
}

function show(req: ShowRequest): void {
  currentId = req.id;
  applyAlignment(req);

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

  // 여기서 타이머를 걸지 않는다. 언제 치울지는 메인이 사용자의 재실을
  // 보고 정한다 — 자리를 비운 사이에 조용히 사라지면 알림이 없던 것과 같다.
}

// 말풍선 위에서만 클릭을 받는다. 그 외에는 창 전체가 클릭을 통과시킨다.
bubble.addEventListener('mouseenter', () => window.overlay.setInteractive(true));
bubble.addEventListener('mouseleave', () => window.overlay.setInteractive(false));
bubble.addEventListener('click', () => hide(true));

window.overlay.onShow(show);
window.overlay.onHide(() => hide(false));

draw();
requestAnimationFrame(loop);
