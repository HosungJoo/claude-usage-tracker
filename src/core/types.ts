/**
 * Anthropic OAuth usage API (`GET /api/oauth/usage`) 응답 타입.
 * 실측 응답을 기준으로 정의했으며, 서버가 필드를 추가해도 깨지지 않도록
 * 모르는 키는 무시하고 아는 키만 좁게 읽는다.
 */

/** 하나의 사용량 윈도우(5시간, 7일 등). 값이 없는 윈도우는 통째로 null로 온다. */
export interface UsageWindow {
  /** 0~100. 소수점이 올 수 있다. */
  utilization: number;
  /** ISO8601. 이 시각이 지나면 윈도우가 초기화된다. null이면 리셋 개념이 없는 윈도우. */
  resets_at: string | null;
  limit_dollars: number | null;
  used_dollars: number | null;
  remaining_dollars: number | null;
}

export type Severity = 'normal' | 'warning' | 'critical';

/** 서버가 직접 내려주는 한도 항목. 캐릭터 표정 분기에 severity를 그대로 쓴다. */
export interface UsageLimit {
  /** 'session' | 'weekly_all' | 'weekly_scoped' 등. 새로운 kind가 추가될 수 있다. */
  kind: string;
  /** 'session' | 'weekly' 등의 묶음. */
  group: string;
  /** 정수 퍼센트. */
  percent: number;
  severity: Severity;
  resets_at: string | null;
  scope: {
    model?: { id: string | null; display_name: string | null } | null;
    surface?: string | null;
  } | null;
  /** 현재 이 한도가 실제로 적용되고 있는지. */
  is_active: boolean;
}

export interface ExtraUsage {
  is_enabled: boolean;
  utilization: number | null;
  monthly_limit: number | null;
  used_credits: number | null;
  spend_limit_reached: boolean;
}

/** 응답 전체 중 우리가 사용하는 부분만. */
export interface UsageResponse {
  five_hour: UsageWindow | null;
  seven_day: UsageWindow | null;
  seven_day_opus: UsageWindow | null;
  seven_day_sonnet: UsageWindow | null;
  limits: UsageLimit[];
  extra_usage: ExtraUsage | null;
}

/** 앱 내부에서 돌려쓰는 정규화된 스냅샷. UI와 임계값 엔진은 이것만 본다. */
export interface UsageSnapshot {
  /** 조회 시각(로컬 기준 epoch ms). */
  fetchedAt: number;
  fiveHour: WindowSnapshot;
  weekly: WindowSnapshot;
  /** 모델별 주간 한도 등, 부가 표시용. 비어 있을 수 있다. */
  scoped: ScopedSnapshot[];
  /** 전체를 대표하는 심각도 — 가장 높은 것. */
  severity: Severity;
}

export interface WindowSnapshot {
  /** 0~100. 데이터가 없으면 0. */
  percent: number;
  /** epoch ms. 리셋 시각을 모르면 null. */
  resetsAt: number | null;
  severity: Severity;
  /** 서버가 이 윈도우 값을 아예 안 내려준 경우 false. */
  available: boolean;
}

export interface ScopedSnapshot {
  label: string;
  percent: number;
  resetsAt: number | null;
  severity: Severity;
}
