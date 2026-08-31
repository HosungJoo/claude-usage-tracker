import { t } from '../shared/i18n/index.js';
import { loadCredentials, type Credentials } from './credentials.js';
import type {
  ScopedSnapshot,
  Severity,
  UsageLimit,
  UsageResponse,
  UsageSnapshot,
  UsageWindow,
  WindowSnapshot,
} from './types.js';

/**
 * Claude Code의 `/usage` 가 사용하는 것과 동일한 엔드포인트.
 * 토큰 수만 담긴 JSONL 트랜스크립트와 달리, 여기서만 실제 한도 대비 퍼센트를 얻을 수 있다.
 */
export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';
const USER_AGENT = 'claude-usage-tracker/0.1.0';
const DEFAULT_TIMEOUT_MS = 15_000;

export type UsageErrorCode =
  | 'unauthorized' // 401/403 — 토큰 만료 또는 권한 없음
  | 'rate_limited' // 429 — 폴링이 과했다
  | 'server' // 5xx — 저쪽 문제, 재시도 가치 있음
  | 'network' // 연결 실패/타임아웃
  | 'malformed'; // 200인데 파싱 불가

export class UsageError extends Error {
  constructor(
    readonly code: UsageErrorCode,
    message: string,
    /** 429 응답의 Retry-After(초). 없으면 undefined. */
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'UsageError';
  }
}

/** 재시도해서 나아질 여지가 있는 에러인지. unauthorized는 재시도해도 소용없다. */
export function isRetryable(err: UsageError): boolean {
  return err.code === 'network' || err.code === 'server' || err.code === 'rate_limited';
}

export function describeUsageError(err: UsageError): string {
  switch (err.code) {
    case 'unauthorized':
      return t().error.authRejected;
    case 'rate_limited':
      return t().error.rateLimited;
    case 'server':
      return t().error.serverDown;
    case 'network':
      return t().error.offline;
    case 'malformed':
      return t().error.badResponse;
  }
}

export interface FetchUsageOptions {
  credentials?: Credentials;
  credentialsPath?: string;
  timeoutMs?: number;
  /** 테스트 주입용. */
  fetchImpl?: typeof fetch;
}

/** 사용량 원본 응답을 가져온다. */
export async function fetchUsage(options: FetchUsageOptions = {}): Promise<UsageResponse> {
  const creds = options.credentials ?? (await loadCredentials(options.credentialsPath));
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await doFetch(USAGE_URL, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        'anthropic-beta': OAUTH_BETA,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    // 에러 원문에 헤더가 섞여 나올 여지를 주지 않기 위해 메시지를 직접 만든다.
    throw new UsageError('network', aborted ? `request timed out (${timeoutMs}ms)` : 'connection failed');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new UsageError('unauthorized', `unauthorized (HTTP ${res.status})`);
  }
  if (res.status === 429) {
    const raw = res.headers.get('retry-after');
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
    throw new UsageError(
      'rate_limited',
      'rate limited (HTTP 429)',
      Number.isFinite(parsed) ? parsed : undefined,
    );
  }
  if (res.status >= 500) {
    throw new UsageError('server', `server error (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new UsageError('malformed', `unexpected response (HTTP ${res.status})`);
  }

  try {
    return (await res.json()) as UsageResponse;
  } catch {
    throw new UsageError('malformed', 'response JSON parse failed');
  }
}

const SEVERITY_RANK: Record<Severity, number> = { normal: 0, warning: 1, critical: 2 };

function isSeverity(v: unknown): v is Severity {
  return v === 'normal' || v === 'warning' || v === 'critical';
}

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function parseIso(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/** 퍼센트를 0~100으로 가둔다. 서버가 100을 넘겨 보내도 UI가 깨지지 않게. */
function clampPercent(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.min(100, Math.max(0, n));
}

/** limits[] 에서 해당 kind의 항목을 찾아 severity를 얻는다. 없으면 퍼센트로 추정. */
function severityFor(limits: UsageLimit[], kind: string, percent: number): Severity {
  const hit = limits.find((l) => l.kind === kind);
  if (hit && isSeverity(hit.severity)) return hit.severity;
  if (percent >= 90) return 'critical';
  if (percent >= 70) return 'warning';
  return 'normal';
}

function toWindow(win: UsageWindow | null | undefined, severity: Severity): WindowSnapshot {
  if (!win) {
    return { percent: 0, resetsAt: null, severity: 'normal', available: false };
  }
  return {
    percent: clampPercent(win.utilization),
    resetsAt: parseIso(win.resets_at),
    severity,
    available: true,
  };
}

/** limits[] 중 모델/서피스 스코프가 붙은 것들을 표시용으로 뽑는다. */
function toScoped(limits: UsageLimit[]): ScopedSnapshot[] {
  return limits
    .filter((l) => l.kind === 'weekly_scoped' && l.scope != null)
    .map((l) => {
      const model = l.scope?.model?.display_name;
      const surface = l.scope?.surface;
      const label = model ?? surface ?? t().cli.otherModel;
      return {
        label,
        percent: clampPercent(l.percent),
        resetsAt: parseIso(l.resets_at),
        severity: isSeverity(l.severity) ? l.severity : 'normal',
      };
    })
    .sort((a, b) => b.percent - a.percent);
}

/** 원본 응답을 앱 내부 스냅샷으로 정규화한다. */
export function normalizeUsage(res: UsageResponse, fetchedAt: number = Date.now()): UsageSnapshot {
  const limits = Array.isArray(res.limits) ? res.limits : [];

  const fivePct = clampPercent(res.five_hour?.utilization);
  const weekPct = clampPercent(res.seven_day?.utilization);

  const fiveHour = toWindow(res.five_hour, severityFor(limits, 'session', fivePct));
  const weekly = toWindow(res.seven_day, severityFor(limits, 'weekly_all', weekPct));
  const scoped = toScoped(limits);

  let severity: Severity = maxSeverity(fiveHour.severity, weekly.severity);
  for (const s of scoped) severity = maxSeverity(severity, s.severity);

  return { fetchedAt, fiveHour, weekly, scoped, severity };
}

/** 조회 + 정규화를 한 번에. 앱이 실제로 쓰는 진입점. */
export async function getUsageSnapshot(options: FetchUsageOptions = {}): Promise<UsageSnapshot> {
  const raw = await fetchUsage(options);
  return normalizeUsage(raw);
}
