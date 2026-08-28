import { describe, expect, it } from 'vitest';
import { parseWindowTree } from '../src/main/window-anchor.js';

/** 실제 `xwininfo -root -tree` 출력에서 가져온 형식. */
const TREE = `
  Root window id: 0x50a (the root window) (has no name)
  Parent window id: 0x0 (none)
     12 children:
     0x80000a "gnome-shell": ("gnome-shell" "Gnome-shell")  1x1+-200+-200  +-200+-200
     0xc00004 "action.cpp - ai-box-middleware - Visual Studio Code": ("code" "code")  2059x1599+44+1616  +44+1616
     0xe00005 "code": ("code" "Code")  200x200+0+0  +0+0
     0x600001 "ibus-x11": ("ibus-x11" "Ibus-x11")  10x10+10+10  +10+10
     0xd00002 "cut — bash": ("tilix" "Tilix")  1200x800+2200+1300  +2200+1300
`;

describe('parseWindowTree', () => {
  it('창 목록을 읽는다', () => {
    const w = parseWindowTree(TREE);
    expect(w.map((x) => x.wmClass)).toEqual(['code', 'Tilix']);
  });

  it('절대 좌표를 쓴다 — 부모 기준 좌표가 아니라', () => {
    const code = parseWindowTree(TREE).find((w) => w.wmClass === 'code');
    expect(code).toMatchObject({ x: 44, y: 1616, width: 2059, height: 1599 });
  });

  it('제목을 그대로 읽는다', () => {
    const code = parseWindowTree(TREE)[0];
    expect(code?.title).toBe('action.cpp - ai-box-middleware - Visual Studio Code');
  });

  it('작은 보조 창은 버린다', () => {
    // 1x1, 200x200, 10x10 은 실제 작업 창이 아니다.
    expect(parseWindowTree(TREE)).toHaveLength(2);
  });

  it('빈 입력에도 죽지 않는다', () => {
    expect(parseWindowTree('')).toEqual([]);
    expect(parseWindowTree('아무 상관 없는 텍스트')).toEqual([]);
  });

  it('음수 좌표를 읽는다 — 왼쪽 모니터의 창', () => {
    const t = '     0x1 "x": ("a" "A")  800x600+-1920+0  +-1920+0';
    expect(parseWindowTree(t)[0]).toMatchObject({ x: -1920, y: 0 });
  });
});
