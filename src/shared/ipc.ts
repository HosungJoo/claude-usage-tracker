import type { Line } from './character/script.js';
import type { Corner } from '../main/overlay-window.js';
import type { Severity, UsageSnapshot } from '../core/types.js';

/** 메인 → 렌더러로 보내는 '이 내용으로 등장해라' 지시. */
export interface ShowRequest {
  id: number;
  line: Line;
  severity: Severity;
  /**
   * 창이 화면 어느 모서리에 붙어 있는지.
   *
   * 렌더러는 이 값으로 캐릭터와 말풍선의 앞뒤·좌우를 정한다. 창 밖으로
   * 말풍선 꼬리가 향하면 안 되기 때문이다. 등장할 때마다 함께 보내는
   * 이유는, 창이 뜬 뒤에 DOM 속성으로 알려주면 렌더러가 그것을 읽는
   * 시점보다 늦게 도착하기 때문이다.
   */
  corner: Corner;
  /** 게이지 표시용. 없으면 게이지를 그리지 않는다. */
  gauges: GaugeInfo[];
}

export interface GaugeInfo {
  label: string;
  percent: number;
  severity: Severity;
}

export const IPC = {
  /** 메인 → 렌더러: 캐릭터 등장. */
  show: 'overlay:show',
  /** 메인 → 렌더러: 즉시 퇴장. */
  hide: 'overlay:hide',
  /** 렌더러 → 메인: 마우스가 상호작용 영역에 들어왔는지. 클릭 통과 토글에 쓴다. */
  setInteractive: 'overlay:set-interactive',
  /** 렌더러 → 메인: 사용자가 말풍선을 닫았다. */
  dismissed: 'overlay:dismissed',
} as const;

export function gaugesFromSnapshot(snapshot: UsageSnapshot): GaugeInfo[] {
  const out: GaugeInfo[] = [];
  if (snapshot.fiveHour.available) {
    out.push({ label: '5시간', percent: snapshot.fiveHour.percent, severity: snapshot.fiveHour.severity });
  }
  if (snapshot.weekly.available) {
    out.push({ label: '주간', percent: snapshot.weekly.percent, severity: snapshot.weekly.severity });
  }
  return out;
}
