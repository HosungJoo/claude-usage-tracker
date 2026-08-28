import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { StateStore } from '../src/core/state-store.js';
import { emptyThresholdState, type ThresholdState } from '../src/core/thresholds.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cut-state-'));
});

const SAMPLE: ThresholdState = {
  fiveHour: { fired: [50, 70], resetsAt: 1234 },
  weekly: { fired: [50], resetsAt: 5678 },
};

describe('StateStore', () => {
  it('파일이 없으면 기본값을 돌려준다', async () => {
    const s = new StateStore(join(dir, 'nope.json'));
    await expect(s.load()).resolves.toEqual(emptyThresholdState());
  });

  it('저장한 뒤 다시 읽으면 같은 값이 나온다', async () => {
    const p = join(dir, 'state.json');
    expect(await new StateStore(p).save(SAMPLE, 999)).toBe(true);

    const reloaded = new StateStore(p);
    expect(await reloaded.load()).toEqual(SAMPLE);
    expect(reloaded.lastFetchedAt).toBe(999);
  });

  it('중간 디렉터리를 만든다', async () => {
    const p = join(dir, 'a', 'b', 'state.json');
    expect(await new StateStore(p).save(SAMPLE, null)).toBe(true);
    expect(await new StateStore(p).load()).toEqual(SAMPLE);
  });

  it('손상된 파일이면 기본값으로 뜬다', async () => {
    const p = join(dir, 'broken.json');
    await writeFile(p, '{{{ not json');
    await expect(new StateStore(p).load()).resolves.toEqual(emptyThresholdState());
  });

  it('버전이 다르면 기본값으로 뜬다', async () => {
    const p = join(dir, 'oldver.json');
    await writeFile(p, JSON.stringify({ version: 99, thresholds: SAMPLE, lastFetchedAt: null }));
    await expect(new StateStore(p).load()).resolves.toEqual(emptyThresholdState());
  });

  it('스키마가 안 맞으면 기본값으로 뜬다', async () => {
    const p = join(dir, 'wrong.json');
    await writeFile(
      p,
      JSON.stringify({ version: 1, thresholds: { fiveHour: { fired: 'nope' } }, lastFetchedAt: 1 }),
    );
    await expect(new StateStore(p).load()).resolves.toEqual(emptyThresholdState());
  });

  it('저장할 수 없어도 예외를 던지지 않고 false를 돌려준다', async () => {
    // 부모 디렉터리 자리에 파일이 있어 mkdir이 실패하는 상황.
    const blocker = join(dir, 'blocked');
    await writeFile(blocker, 'i am a file, not a directory');
    const s = new StateStore(join(blocker, 'state.json'));
    await expect(s.save(SAMPLE, null)).resolves.toBe(false);
  });
});
