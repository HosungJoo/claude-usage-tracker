import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PollCoordinator, type PollerLike } from '../src/core/coordinator.js';
import type { UsageSnapshot } from '../src/core/types.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cut-coord-'));
});

function snapshot(percent: number, fetchedAt = 1000): UsageSnapshot {
  return {
    fetchedAt,
    fiveHour: { percent, resetsAt: null, severity: 'normal', available: true },
    weekly: { percent, resetsAt: null, severity: 'normal', available: true },
    scoped: [],
    severity: 'normal',
  };
}

/** 코디네이터가 시키는 대로만 하는 폴러. 실제 조회는 하지 않는다. */
class FakePoller implements PollerLike {
  started = 0;
  stopped = 0;
  ingested: UsageSnapshot[] = [];
  refreshed = 0;
  snapshot: UsageSnapshot | null = null;
  private listeners = new Set<(s: UsageSnapshot) => void>();

  async start(): Promise<void> {
    this.started += 1;
  }
  stop(): void {
    this.stopped += 1;
  }
  async ingest(s: UsageSnapshot): Promise<void> {
    this.ingested.push(s);
    this.snapshot = s;
  }
  async refreshNow(): Promise<UsageSnapshot | null> {
    this.refreshed += 1;
    return this.snapshot;
  }
  on(_event: 'snapshot', fn: (s: UsageSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  /** 리더가 조회에 성공한 척한다. */
  emit(s: UsageSnapshot): void {
    this.snapshot = s;
    for (const fn of this.listeners) fn(s);
  }
}

function make(poller: FakePoller, id: number, now: () => number, alive: (pid: number) => boolean = () => true) {
  return new PollCoordinator({ poller, dir, id, now, isAlive: alive, heartbeatMs: 10_000 });
}

describe('PollCoordinator', () => {
  it('아무도 없으면 첫 프로세스가 조회를 맡는다', async () => {
    const poller = new FakePoller();
    const c = make(poller, 1, () => 0);
    await c.start();

    expect(c.isLeader).toBe(true);
    expect(poller.started).toBe(1);
    await c.stop();
  });

  it('이미 살아 있는 리더가 있으면 조회하지 않는다', async () => {
    const first = new FakePoller();
    const a = make(first, 1, () => 0);
    await a.start();

    const second = new FakePoller();
    const b = make(second, 2, () => 0);
    await b.start();

    expect(b.isLeader).toBe(false);
    expect(second.started).toBe(0);
    await a.stop();
    await b.stop();
  });

  it('리더의 결과를 팔로워가 그대로 받아 쓴다', async () => {
    const clock = 0;
    const leaderPoller = new FakePoller();
    const leader = make(leaderPoller, 1, () => clock);
    await leader.start();

    const followerPoller = new FakePoller();
    const follower = make(followerPoller, 2, () => clock);
    await follower.start();

    leaderPoller.emit(snapshot(42));
    // 파일 쓰기가 끝나기를 기다린다.
    await new Promise((r) => setTimeout(r, 20));
    await follower['drain']();

    expect(followerPoller.ingested).toHaveLength(1);
    expect(followerPoller.ingested[0]?.fiveHour.percent).toBe(42);
    expect(followerPoller.started).toBe(0);

    await leader.stop();
    await follower.stop();
  });

  it('같은 결과를 두 번 먹지 않는다', async () => {
    const clock = 0;
    const leaderPoller = new FakePoller();
    const leader = make(leaderPoller, 1, () => clock);
    await leader.start();

    const followerPoller = new FakePoller();
    const follower = make(followerPoller, 2, () => clock);
    await follower.start();

    leaderPoller.emit(snapshot(42));
    await new Promise((r) => setTimeout(r, 20));
    await follower['drain']();
    await follower['drain']();

    expect(followerPoller.ingested).toHaveLength(1);
    await leader.stop();
    await follower.stop();
  });

  it('심장박동이 끊긴 자리는 다음 프로세스가 물려받는다', async () => {
    await writeFile(
      join(dir, 'poller.lock'),
      JSON.stringify({ version: 1, id: 999, heartbeat: 0 }),
    );

    const poller = new FakePoller();
    // 임차 기한(45초)을 훌쩍 넘긴 시각.
    const c = make(poller, 2, () => 60_000);
    await c.start();

    expect(c.isLeader).toBe(true);
    expect(poller.started).toBe(1);
    await c.stop();
  });

  it('심장박동이 남아 있어도 그 프로세스가 없으면 물려받는다', async () => {
    await writeFile(
      join(dir, 'poller.lock'),
      JSON.stringify({ version: 1, id: 999, heartbeat: 1000 }),
    );

    const poller = new FakePoller();
    const c = make(poller, 2, () => 1000, (pid) => pid !== 999);
    await c.start();

    expect(c.isLeader).toBe(true);
    await c.stop();
  });

  it('깨진 잠금 파일은 빈 자리로 본다', async () => {
    await writeFile(join(dir, 'poller.lock'), '{ 이건 JSON이 아니다');

    const poller = new FakePoller();
    const c = make(poller, 1, () => 0);
    await c.start();

    expect(c.isLeader).toBe(true);
    await c.stop();
  });

  it('나가면서 자리를 비운다', async () => {
    const poller = new FakePoller();
    const c = make(poller, 1, () => 0);
    await c.start();
    await c.stop();

    await expect(readFile(join(dir, 'poller.lock'), 'utf8')).rejects.toThrow();
  });

  it('팔로워의 "지금 확인"은 받아둔 결과가 새것이면 API를 부르지 않는다', async () => {
    let clock = 0;
    const leaderPoller = new FakePoller();
    const leader = make(leaderPoller, 1, () => clock);
    await leader.start();

    const followerPoller = new FakePoller();
    const follower = make(followerPoller, 2, () => clock);
    await follower.start();

    leaderPoller.emit(snapshot(42, 0));
    await new Promise((r) => setTimeout(r, 20));

    clock = 1000;
    await expect(follower.refresh()).resolves.toMatchObject({ fetchedAt: 0 });
    expect(followerPoller.refreshed).toBe(0);

    await leader.stop();
    await follower.stop();
  });

  it('받아둔 결과가 낡았으면 팔로워도 직접 부른다', async () => {
    let clock = 0;
    const leaderPoller = new FakePoller();
    const leader = make(leaderPoller, 1, () => clock);
    await leader.start();

    const followerPoller = new FakePoller();
    const follower = make(followerPoller, 2, () => clock);
    await follower.start();

    leaderPoller.emit(snapshot(42, 0));
    await new Promise((r) => setTimeout(r, 20));

    // 임차 기한(45초)을 넘긴 뒤에는 받아둔 것을 믿지 않는다.
    clock = 60_000;
    await follower.refresh();
    expect(followerPoller.refreshed).toBe(1);

    await leader.stop();
    await follower.stop();
  });

  it('오래된 스냅샷은 쓰지 않는다', async () => {
    await writeFile(
      join(dir, 'snapshot.json'),
      JSON.stringify({ version: 1, writtenAt: 0, snapshot: snapshot(42) }),
    );
    await writeFile(
      join(dir, 'poller.lock'),
      JSON.stringify({ version: 1, id: 999, heartbeat: 11 * 60_000 }),
    );

    const poller = new FakePoller();
    // 스냅샷은 11분 전 것이다.
    const c = make(poller, 2, () => 11 * 60_000);
    await c.start();

    expect(c.isLeader).toBe(false);
    expect(poller.ingested).toHaveLength(0);
    await c.stop();
  });
});
