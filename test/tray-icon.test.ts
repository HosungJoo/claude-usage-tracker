import { describe, expect, it } from 'vitest';
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
