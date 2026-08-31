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
