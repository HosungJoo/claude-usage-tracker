import { describe, expect, it } from 'vitest';
import { fetchUsage, isRetryable, normalizeUsage, UsageError } from '../src/core/usage-api.js';
import type { UsageResponse } from '../src/core/types.js';

const CREDS = { accessToken: 'test-token', expiresAt: Date.now() + 3600_000, subscriptionType: 'max' };

/** 실측 응답을 축약한 픽스처. */
const REAL_SHAPE: UsageResponse = {
  five_hour: {
    utilization: 2,
    resets_at: '2026-08-28T09:39:59.778330+00:00',
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null,
  },
  seven_day: {
    utilization: 10,
    resets_at: '2026-09-03T03:59:59.778354+00:00',
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null,
  },
  seven_day_opus: null,
  seven_day_sonnet: null,
  limits: [
    { kind: 'session', group: 'session', percent: 2, severity: 'normal', resets_at: '2026-08-28T09:39:59.778330+00:00', scope: null, is_active: false },
    { kind: 'weekly_all', group: 'weekly', percent: 10, severity: 'normal', resets_at: '2026-09-03T03:59:59.778354+00:00', scope: null, is_active: false },
    { kind: 'weekly_scoped', group: 'weekly', percent: 14, severity: 'warning', resets_at: '2026-09-03T03:59:59.778588+00:00', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: true },
  ],
  extra_usage: null,
};

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

describe('fetchUsage', () => {
  it('정상 응답을 그대로 돌려준다', async () => {
    const res = await fetchUsage({ credentials: CREDS, fetchImpl: mockFetch(200, REAL_SHAPE) as never });
    expect(res.five_hour?.utilization).toBe(2);
  });

  it('Authorization과 beta 헤더를 붙인다', async () => {
    let seen: Headers | undefined;
    const spy = (async (_url: string, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response(JSON.stringify(REAL_SHAPE), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchUsage({ credentials: CREDS, fetchImpl: spy });
    expect(seen?.get('authorization')).toBe('Bearer test-token');
    expect(seen?.get('anthropic-beta')).toBe('oauth-2025-04-20');
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [500, 'server'],
    [503, 'server'],
    [418, 'malformed'],
  ])('HTTP %i → %s', async (status, code) => {
    await expect(
      fetchUsage({ credentials: CREDS, fetchImpl: mockFetch(status, {}) as never }),
    ).rejects.toMatchObject({ code });
  });

  it('429의 Retry-After를 읽는다', async () => {
    await expect(
      fetchUsage({ credentials: CREDS, fetchImpl: mockFetch(429, {}, { 'retry-after': '42' }) as never }),
    ).rejects.toMatchObject({ code: 'rate_limited', retryAfterSec: 42 });
  });

  it('JSON이 아니면 malformed', async () => {
    await expect(
      fetchUsage({ credentials: CREDS, fetchImpl: mockFetch(200, 'not json') as never }),
    ).rejects.toMatchObject({ code: 'malformed' });
  });

  it('연결 실패는 network', async () => {
    const boom = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(fetchUsage({ credentials: CREDS, fetchImpl: boom })).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('에러 메시지에 토큰이 새지 않는다', async () => {
    const boom = (async () => {
      throw new Error(`failed with Bearer ${CREDS.accessToken}`);
    }) as unknown as typeof fetch;
    await expect(fetchUsage({ credentials: CREDS, fetchImpl: boom })).rejects.toSatisfy(
      (e: unknown) => !(e as Error).message.includes(CREDS.accessToken),
    );
  });
});

describe('isRetryable', () => {
  it('unauthorized는 재시도 대상이 아니다', () => {
    expect(isRetryable(new UsageError('unauthorized', 'x'))).toBe(false);
  });
  it('network/server/rate_limited는 재시도한다', () => {
    for (const c of ['network', 'server', 'rate_limited'] as const) {
      expect(isRetryable(new UsageError(c, 'x'))).toBe(true);
    }
  });
});

describe('normalizeUsage', () => {
  it('실측 응답을 스냅샷으로 바꾼다', () => {
    const s = normalizeUsage(REAL_SHAPE, 1000);
    expect(s.fetchedAt).toBe(1000);
    expect(s.fiveHour).toMatchObject({ percent: 2, available: true, severity: 'normal' });
    expect(s.weekly).toMatchObject({ percent: 10, available: true });
    expect(s.fiveHour.resetsAt).toBe(Date.parse('2026-08-28T09:39:59.778330+00:00'));
  });

  it('weekly_scoped를 퍼센트 내림차순으로 뽑는다', () => {
    const s = normalizeUsage(REAL_SHAPE);
    expect(s.scoped).toEqual([
      expect.objectContaining({ label: 'Fable', percent: 14, severity: 'warning' }),
    ]);
  });

  it('종합 severity는 가장 높은 것을 따른다', () => {
    expect(normalizeUsage(REAL_SHAPE).severity).toBe('warning');
  });

  it('윈도우가 null이면 available:false', () => {
    const s = normalizeUsage({ ...REAL_SHAPE, five_hour: null, limits: [] });
    expect(s.fiveHour).toMatchObject({ percent: 0, available: false, resetsAt: null });
  });

  it('limits가 없으면 퍼센트로 severity를 추정한다', () => {
    const s = normalizeUsage({
      ...REAL_SHAPE,
      five_hour: { utilization: 95, resets_at: null, limit_dollars: null, used_dollars: null, remaining_dollars: null },
      limits: [],
    });
    expect(s.fiveHour.severity).toBe('critical');
  });

  it('퍼센트를 0~100으로 가둔다', () => {
    const s = normalizeUsage({
      ...REAL_SHAPE,
      five_hour: { utilization: 140, resets_at: null, limit_dollars: null, used_dollars: null, remaining_dollars: null },
      limits: [],
    });
    expect(s.fiveHour.percent).toBe(100);
  });

  it('limits가 배열이 아니어도 죽지 않는다', () => {
    const s = normalizeUsage({ ...REAL_SHAPE, limits: undefined as never });
    expect(s.scoped).toEqual([]);
  });

  it('잘못된 날짜 문자열은 null이 된다', () => {
    const s = normalizeUsage({
      ...REAL_SHAPE,
      five_hour: { utilization: 5, resets_at: 'nope', limit_dollars: null, used_dollars: null, remaining_dollars: null },
    });
    expect(s.fiveHour.resetsAt).toBeNull();
  });
});
