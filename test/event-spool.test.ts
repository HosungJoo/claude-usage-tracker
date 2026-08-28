import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { EventSpool, parseStamp } from '../src/main/event-spool.js';
import type { HookEvent } from '../src/hooks/hook-script.js';

const NOW = 1_800_000_000_000;

let base: string;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'cut-spool-'));
});

/** 훅이 파일을 떨어뜨린 상황을 흉내 낸다. */
async function drop(dir: string, name: string, body: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
}

function fresh(suffix = '1'): string {
  return `100-${NOW * 1e6}${suffix}.json`;
}

describe('parseStamp', () => {
  it('나노초 타임스탬프를 ms로 바꾼다', () => {
    expect(parseStamp('123-1800000000000000000.json')).toBe(1_800_000_000_000);
  });

  it('초 단위 폴백도 읽는다', () => {
    expect(parseStamp('123-1800000000.json')).toBe(1_800_000_000_000);
  });

  it('형식이 다르면 null', () => {
    expect(parseStamp('아무거나.json')).toBeNull();
    expect(parseStamp('123.json')).toBeNull();
  });
});

describe('EventSpool', () => {
  it('시작하면 디렉터리를 만든다 — 앱이 살아 있다는 신호다', async () => {
    const dir = join(base, 'events');
    const spool = new EventSpool(() => {}, dir, () => NOW);
    await spool.start();
    expect(existsSync(dir)).toBe(true);
    await spool.stop();
  });

  it('멈추면 디렉터리를 지운다 — 훅이 조용해지게', async () => {
    const dir = join(base, 'events');
    const spool = new EventSpool(() => {}, dir, () => NOW);
    await spool.start();
    await spool.stop();
    expect(existsSync(dir)).toBe(false);
  });

  it('떨어진 이벤트를 읽어 핸들러에 넘긴다', async () => {
    const dir = join(base, 'events');
    const seen: HookEvent[] = [];
    await drop(dir, fresh(), { hook_event_name: 'SessionStart', source: 'startup' });

    const spool = new EventSpool((e) => seen.push(e), dir, () => NOW);
    await spool.start();

    expect(seen).toEqual([{ hook_event_name: 'SessionStart', source: 'startup' }]);
    await spool.stop();
  });

  it('처리한 파일을 지운다', async () => {
    const dir = join(base, 'events');
    await drop(dir, fresh(), { hook_event_name: 'SessionStart' });

    const spool = new EventSpool(() => {}, dir, () => NOW);
    await spool.start();
    expect(await readdir(dir)).toHaveLength(0);
    await spool.stop();
  });

  it('오래된 이벤트는 버린다 — 옛날 세션에 인사하면 안 된다', async () => {
    const dir = join(base, 'events');
    const old = NOW - 120_000;
    await drop(dir, `100-${old * 1e6}.json`, { hook_event_name: 'SessionStart' });

    const seen: HookEvent[] = [];
    const spool = new EventSpool((e) => seen.push(e), dir, () => NOW);
    await spool.start();

    expect(seen).toHaveLength(0);
    expect(await readdir(dir)).toHaveLength(0);
    await spool.stop();
  });

  it('깨진 JSON은 건너뛰고 나머지를 처리한다', async () => {
    const dir = join(base, 'events');
    await drop(dir, `100-${NOW * 1e6}0.json`, '{ 깨짐');
    await drop(dir, `100-${NOW * 1e6}1.json`, { hook_event_name: 'SessionEnd' });

    const seen: HookEvent[] = [];
    const spool = new EventSpool((e) => seen.push(e), dir, () => NOW);
    await spool.start();

    expect(seen).toEqual([{ hook_event_name: 'SessionEnd' }]);
    await spool.stop();
  });

  it('핸들러가 던져도 나머지 이벤트를 처리한다', async () => {
    const dir = join(base, 'events');
    await drop(dir, `100-${NOW * 1e6}0.json`, { hook_event_name: 'A' });
    await drop(dir, `100-${NOW * 1e6}1.json`, { hook_event_name: 'B' });

    const seen: string[] = [];
    const spool = new EventSpool(
      (e) => {
        seen.push(e.hook_event_name ?? '');
        if (e.hook_event_name === 'A') throw new Error('핸들러 폭발');
      },
      dir,
      () => NOW,
    );
    await spool.start();

    expect(seen).toEqual(['A', 'B']);
    await spool.stop();
  });

  it('.json 이 아닌 파일은 건드리지 않는다', async () => {
    const dir = join(base, 'events');
    await drop(dir, '.100-tmp.tmp', 'rename 중인 임시 파일');

    const seen: HookEvent[] = [];
    const spool = new EventSpool((e) => seen.push(e), dir, () => NOW);
    await spool.start();

    expect(seen).toHaveLength(0);
    expect(await readdir(dir)).toEqual(['.100-tmp.tmp']);
    await spool.stop();
  });

  it('여러 이벤트를 시간 순서대로 넘긴다', async () => {
    const dir = join(base, 'events');
    await drop(dir, `100-${NOW * 1e6}2.json`, { hook_event_name: 'C' });
    await drop(dir, `100-${NOW * 1e6}0.json`, { hook_event_name: 'A' });
    await drop(dir, `100-${NOW * 1e6}1.json`, { hook_event_name: 'B' });

    const seen: string[] = [];
    const spool = new EventSpool((e) => seen.push(e.hook_event_name ?? ''), dir, () => NOW);
    await spool.start();

    expect(seen).toEqual(['A', 'B', 'C']);
    await spool.stop();
  });

  it('디렉터리가 사라져도 죽지 않는다', async () => {
    const spool = new EventSpool(() => {}, join(base, '없는곳', 'events'), () => NOW);
    await expect(spool.drain()).resolves.toBeUndefined();
  });
});
