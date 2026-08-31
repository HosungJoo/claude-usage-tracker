import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import type { UsageSnapshot } from '../src/core/types.js';

/**
 * 폴러에서 검증하고 싶은 건 HTTP가 아니라 '겹쳐 부를 때의 약속'이다.
 * 조회 자체는 흉내 내고, 부르는 쪽이 무엇을 돌려받는지만 본다.
 */

let fetchCount = 0;
let resolveFetch: ((snapshot: UsageSnapshot) => void) | null = null;
let rejectFetch: ((e: Error) => void) | null = null;

vi.mock('../src/core/usage-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/usage-api.js')>();
  return {
    ...actual,
    getUsageSnapshot: () => {
      fetchCount += 1;
      return new Promise<UsageSnapshot>((resolve, reject) => {
        resolveFetch = resolve;
        rejectFetch = reject;
      });
    },
  };
});

const { UsagePoller } = await import('../src/core/poller.js');
const { UsageError } = await import('../src/core/usage-api.js');
const { StateStore } = await import('../src/core/state-store.js');

function snap(five: number): UsageSnapshot {
  return {
    fetchedAt: 0,
    fiveHour: { percent: five, resetsAt: null, severity: 'normal', available: true },
    weekly: { percent: 0, resetsAt: null, severity: 'normal', available: true },
    scoped: [],
    severity: 'normal',
  };
}

let dir: string;
let poller: InstanceType<typeof UsagePoller>;

beforeEach(async () => {
  fetchCount = 0;
  resolveFetch = null;
  rejectFetch = null;
  dir = await mkdtemp(join(tmpdir(), 'poller-test-'));
  poller = new UsagePoller({ store: new StateStore(join(dir, 'state.json')) });
});

afterEach(async () => {
  vi.useRealTimers();
  poller.stop();
  // 마지막 조회가 상태 파일을 쓰는 중일 수 있다. 한 틱 양보하고 지운다.
  await new Promise((r) => setTimeout(r, 10));
  await rm(dir, { recursive: true, force: true, maxRetries: 3 });
});

describe('refreshNow', () => {
  it('첫 조회가 끝나기 전에 불러도 그 결과를 받는다', async () => {
    // 앱이 뜨자마자 세션 훅이 들어오는 상황. 예전에는 여기서 null이 돌아와
    // 인사가 통째로 사라졌다.
    await poller.start();
    const pending = poller.refreshNow();

    expect(resolveFetch).not.toBeNull();
    resolveFetch?.(snap(42));

    await expect(pending).resolves.toMatchObject({ fiveHour: { percent: 42 } });
  });

  it('조회 중에 불러도 요청을 새로 만들지 않는다', async () => {
    await poller.start();
    expect(fetchCount).toBe(1);

    const a = poller.refreshNow();
    const b = poller.refreshNow();
    expect(fetchCount).toBe(1);

    resolveFetch?.(snap(10));
    // 둘 다 같은 조회를 기다렸으므로 같은 값이 나온다.
    await expect(a).resolves.toMatchObject({ fiveHour: { percent: 10 } });
    await expect(b).resolves.toMatchObject({ fiveHour: { percent: 10 } });
  });

  it('조회가 끝난 뒤에 부르면 새로 조회한다', async () => {
    await poller.start();
    // start()가 띄운 첫 조회와 같은 것을 잡아 끝날 때까지 기다린다.
    const first = poller.refreshNow();
    resolveFetch?.(snap(10));
    await first;

    const second = poller.refreshNow();
    expect(fetchCount).toBe(2);
    resolveFetch?.(snap(20));
    await expect(second).resolves.toMatchObject({ fiveHour: { percent: 20 } });
  });

  it('진행 중이던 조회가 실패해도 다음 호출이 묶이지 않는다', async () => {
    await poller.start();
    const failing = poller.refreshNow();
    rejectFetch?.(new Error('네트워크 끊김'));
    await expect(failing).resolves.toBeNull();

    const retry = poller.refreshNow();
    expect(fetchCount).toBe(2);
    resolveFetch?.(snap(7));
    await expect(retry).resolves.toMatchObject({ fiveHour: { percent: 7 } });
  });
});

/**
 * 이 묶음은 '언제 다시 부르는가'만 본다. 상태 저장이 실제 디스크를 만지면
 * 가짜 시계와 실제 I/O가 엇갈려 일정이 흐려지므로, 저장은 메모리로 둔다.
 */
function memoryStore(): InstanceType<typeof StateStore> {
  const empty = { fiveHour: { fired: [], resetsAt: null }, weekly: { fired: [], resetsAt: null } };
  return { load: async () => empty, save: async () => true } as unknown as InstanceType<
    typeof StateStore
  >;
}

describe('429 백오프', () => {
  beforeEach(() => {
    poller.stop();
    poller = new UsagePoller({ store: memoryStore() });
  });

  /**
   * 실제로 겪은 일: 이 엔드포인트의 429에는 Retry-After가 없다. 그래서
   * 5초 뒤 재시도 → 또 429 → … 를 반복하다가, 한 번 성공하면 곧바로
   * 1분 주기로 돌아가 같은 폭주를 다시 시작했다. 그 사이 세션 훅이
   * 들어오면 사용자는 아무 인사도 받지 못했다.
   */
  it('Retry-After가 없으면 1분 안에는 다시 두드리지 않는다', async () => {
    vi.useFakeTimers();
    await poller.start();
    expect(fetchCount).toBe(1);

    rejectFetch?.(new UsageError('rate_limited', 'rate limited (HTTP 429)'));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchCount).toBe(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchCount).toBe(2);
  });

  it('Retry-After가 오면 그 말을 따른다 — 저쪽이 우리보다 잘 안다', async () => {
    vi.useFakeTimers();
    await poller.start();

    rejectFetch?.(new UsageError('rate_limited', 'rate limited (HTTP 429)', 5));
    await vi.advanceTimersByTimeAsync(5_100);
    expect(fetchCount).toBe(2);
  });

  it('429 직후에 성공해도 곧장 1분 주기로 돌아가지 않는다', async () => {
    vi.useFakeTimers();
    await poller.start();

    rejectFetch?.(new UsageError('rate_limited', 'rate limited (HTTP 429)'));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(fetchCount).toBe(2);

    resolveFetch?.(snap(10));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(fetchCount).toBe(2); // 평소라면 여기서 벌써 다시 불렀다

    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchCount).toBe(3);
  });

  it('429가 없었다면 평소 주기를 지킨다', async () => {
    vi.useFakeTimers();
    await poller.start();

    resolveFetch?.(snap(10));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(fetchCount).toBe(2);
  });
});
