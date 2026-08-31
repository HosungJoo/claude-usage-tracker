import { setLocale } from '../src/shared/i18n/index.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderTrayIcon, trayTooltip } from '../src/main/tray-icon.js';
import type { Severity, UsageSnapshot } from '../src/core/types.js';

function snap(five: number, week: number, severity: Severity = 'normal'): UsageSnapshot {
  return {
    fetchedAt: 0,
    fiveHour: { percent: five, resetsAt: null, severity, available: true },
    weekly: { percent: week, resetsAt: null, severity, available: true },
    scoped: [],
    severity,
  };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];


// 이 파일은 한국어 문구 자체를 검증한다. 기본 언어(영어)에 기대면
// 문구를 다듬을 때마다 무관한 테스트가 깨진다.
beforeEach(() => setLocale('ko'));

describe('renderTrayIcon', () => {
  it('올바른 PNG를 만든다', () => {
    const png = renderTrayIcon('idle', 22);
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  it('요청한 크기로 나온다', () => {
    // IHDR의 폭·높이는 시그니처(8) + 길이(4) + 타입(4) 다음에 온다.
    const png = renderTrayIcon('idle', 32);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(32);
    expect(view.getUint32(20)).toBe(32);
  });

  it('표정마다 다른 아이콘이 나온다', () => {
    const icons = (['idle', 'worry', 'alert', 'faint'] as const).map((e) =>
      Buffer.from(renderTrayIcon(e, 22)).toString('base64'),
    );
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('작은 크기에서도 죽지 않는다', () => {
    expect(() => renderTrayIcon('idle', 8)).not.toThrow();
  });

  it('여백을 주면 캐릭터가 그만큼 작게 그려진다', () => {
    // 캔버스 크기는 그대로, 칠해진 픽셀만 줄어야 한다.
    const full = renderTrayIcon('idle', 64);
    const inset = renderTrayIcon('idle', 64, 8);
    expect(inset.length).toBeLessThan(full.length);

    const view = new DataView(inset.buffer, inset.byteOffset);
    expect(view.getUint32(16)).toBe(64);
    expect(view.getUint32(20)).toBe(64);
  });

  it('여백이 캔버스를 다 먹으면 여백을 무시한다', () => {
    // 안쪽 상자가 0 이하로 가면 아무것도 안 그린 아이콘이 나온다.
    // 빈 아이콘보다는 여백 없는 아이콘이 낫다.
    expect(renderTrayIcon('idle', 16, 40)).toEqual(renderTrayIcon('idle', 16, 0));
  });
});

describe('trayTooltip', () => {
  it('두 윈도우를 모두 담는다', () => {
    const t = trayTooltip(snap(37, 62));
    expect(t).toContain('37%');
    expect(t).toContain('62%');
  });

  it('소수는 반올림한다', () => {
    expect(trayTooltip(snap(37.4, 62.6))).toContain('37%');
  });

  it('아직 못 읽었으면 그렇다고 말한다', () => {
    expect(trayTooltip(null)).toContain('읽지 못했');
  });
});
