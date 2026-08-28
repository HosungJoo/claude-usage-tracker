import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MAX_POLL_SEC,
  MIN_POLL_SEC,
  normalizeSettings,
  normalizeThresholds,
} from '../src/shared/settings.js';
import { SettingsStore } from '../src/main/settings-store.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cut-settings-'));
});

describe('normalizeThresholds', () => {
  it('정렬하고 중복을 없앤다', () => {
    expect(normalizeThresholds([90, 50, 70, 50])).toEqual([50, 70, 90]);
  });

  it('소수는 반올림한다', () => {
    expect(normalizeThresholds([49.6, 70.2])).toEqual([50, 70]);
  });

  it('범위 밖 값은 버린다', () => {
    expect(normalizeThresholds([0, 50, 101, -5, 100])).toEqual([50, 100]);
  });

  it('숫자가 아닌 값은 버린다', () => {
    expect(normalizeThresholds(['50', null, 70, NaN])).toEqual([70]);
  });

  it('남는 게 없으면 기본값으로 돌아간다', () => {
    // 임계값이 하나도 없으면 아무것도 알리지 않는 앱이 된다.
    expect(normalizeThresholds([])).toEqual(DEFAULT_SETTINGS.thresholds);
    expect(normalizeThresholds([0, 200])).toEqual(DEFAULT_SETTINGS.thresholds);
    expect(normalizeThresholds('아무거나')).toEqual(DEFAULT_SETTINGS.thresholds);
  });
});

describe('normalizeSettings', () => {
  it('빈 입력은 전부 기본값', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it('폴링 주기를 범위 안으로 가둔다', () => {
    expect(normalizeSettings({ pollIntervalSec: 1 }).pollIntervalSec).toBe(MIN_POLL_SEC);
    expect(normalizeSettings({ pollIntervalSec: 99_999 }).pollIntervalSec).toBe(MAX_POLL_SEC);
  });

  it('여백과 표시 배율도 가둔다', () => {
    expect(normalizeSettings({ margin: -50 }).margin).toBe(0);
    expect(normalizeSettings({ margin: 9999 }).margin).toBe(200);
    expect(normalizeSettings({ holdScale: 0.1 }).holdScale).toBe(0.5);
    expect(normalizeSettings({ holdScale: 99 }).holdScale).toBe(3);
  });

  it('모르는 모서리 값은 기본값으로', () => {
    expect(normalizeSettings({ corner: 'middle' }).corner).toBe(DEFAULT_SETTINGS.corner);
    expect(normalizeSettings({ corner: 'top-left' }).corner).toBe('top-left');
  });

  it('값 하나가 이상해도 나머지는 살린다', () => {
    const s = normalizeSettings({ pollIntervalSec: 'x', corner: 'top-left', autostart: true });
    expect(s.pollIntervalSec).toBe(DEFAULT_SETTINGS.pollIntervalSec);
    expect(s.corner).toBe('top-left');
    expect(s.autostart).toBe(true);
  });

  it('모르는 키는 버린다', () => {
    expect(Object.keys(normalizeSettings({ 없는키: 1 }))).toEqual(Object.keys(DEFAULT_SETTINGS));
  });
});

describe('SettingsStore', () => {
  it('파일이 없으면 기본값으로 뜬다', async () => {
    const s = new SettingsStore(join(dir, 'none.json'));
    await expect(s.load()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('저장한 뒤 다시 읽으면 같은 값이 나온다', async () => {
    const p = join(dir, 'settings.json');
    const a = new SettingsStore(p);
    await a.load();
    expect(await a.update({ corner: 'top-left', margin: 40 })).toBe(true);

    const b = new SettingsStore(p);
    const loaded = await b.load();
    expect(loaded.corner).toBe('top-left');
    expect(loaded.margin).toBe(40);
  });

  it('손상된 파일이면 기본값으로 뜬다', async () => {
    const p = join(dir, 'broken.json');
    await writeFile(p, '{{{ 깨짐');
    await expect(new SettingsStore(p).load()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('사람이 손으로 넣은 이상한 값을 다듬어 읽는다', async () => {
    const p = join(dir, 'weird.json');
    await writeFile(p, JSON.stringify({ pollIntervalSec: 1, thresholds: [200, 60] }));
    const s = await new SettingsStore(p).load();
    expect(s.pollIntervalSec).toBe(MIN_POLL_SEC);
    expect(s.thresholds).toEqual([60]);
  });

  it('저장할 때도 값을 다듬는다', async () => {
    const p = join(dir, 's.json');
    const store = new SettingsStore(p);
    await store.load();
    await store.update({ pollIntervalSec: 2, thresholds: [90, 50, 50] });

    const written = JSON.parse(await readFile(p, 'utf8'));
    expect(written.pollIntervalSec).toBe(MIN_POLL_SEC);
    expect(written.thresholds).toEqual([50, 90]);
  });

  it('바뀌면 구독자에게 알린다', async () => {
    const store = new SettingsStore(join(dir, 's.json'));
    await store.load();
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.corner));

    await store.update({ corner: 'top-right' });
    expect(seen).toEqual(['top-right']);
  });

  it('값이 그대로면 알리지 않는다', async () => {
    const store = new SettingsStore(join(dir, 's.json'));
    await store.load();
    let calls = 0;
    store.subscribe(() => calls++);

    await store.update({ corner: DEFAULT_SETTINGS.corner });
    expect(calls).toBe(0);
  });

  it('구독자가 던져도 저장은 진행된다', async () => {
    const p = join(dir, 's.json');
    const store = new SettingsStore(p);
    await store.load();
    store.subscribe(() => {
      throw new Error('구독자 폭발');
    });

    await expect(store.update({ margin: 8 })).resolves.toBe(true);
    expect(JSON.parse(await readFile(p, 'utf8')).margin).toBe(8);
  });

  it('구독을 해지할 수 있다', async () => {
    const store = new SettingsStore(join(dir, 's.json'));
    await store.load();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    off();

    await store.update({ margin: 12 });
    expect(calls).toBe(0);
  });

  it('저장에 실패해도 메모리 값은 갱신되고 예외를 던지지 않는다', async () => {
    // 부모 자리에 파일이 있어 디렉터리를 만들 수 없는 상황.
    const blocker = join(dir, 'blocked');
    await writeFile(blocker, '파일');
    const store = new SettingsStore(join(blocker, 's.json'));
    await store.load();

    await expect(store.update({ margin: 60 })).resolves.toBe(false);
    // 사용자가 방금 만진 값이 화면에서 되돌아가면 더 혼란스럽다.
    expect(store.value.margin).toBe(60);
  });

  it('기본값으로 되돌린다', async () => {
    const store = new SettingsStore(join(dir, 's.json'));
    await store.load();
    await store.update({ corner: 'top-left', margin: 99, autostart: true });
    await store.reset();
    expect(store.value).toEqual(DEFAULT_SETTINGS);
  });
});
