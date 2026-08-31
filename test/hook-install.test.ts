import { setLocale } from '../src/shared/i18n/index.js';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  HOOK_MARKER,
  hasHooks,
  installHooks,
  uninstallHooks,
  withHooks,
  withoutHooks,
} from '../src/hooks/install.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cut-hooks-'));
});

const OTHER_HOOK = {
  matcher: 'Bash',
  hooks: [{ type: 'command', command: 'echo 사용자가 직접 만든 훅' }],
};


// 이 파일은 한국어 문구 자체를 검증한다. 기본 언어(영어)에 기대면
// 문구를 다듬을 때마다 무관한 테스트가 깨진다.
beforeEach(() => setLocale('ko'));

describe('withHooks / withoutHooks', () => {
  it('빈 설정에 훅을 넣는다', () => {
    const next = withHooks({}, '/x/notify.sh');
    expect(hasHooks(next)).toBe(true);
    expect(next.hooks?.['SessionStart']).toHaveLength(1);
    expect(next.hooks?.['SessionEnd']).toHaveLength(1);
  });

  it('명령에 스크립트 경로가 들어간다', () => {
    const next = withHooks({}, '/x/notify.sh');
    const cmd = next.hooks?.['SessionStart']?.[0]?.hooks?.[0]?.command;
    expect(cmd).toContain('/x/notify.sh');
  });

  it('공백이 있는 경로도 안전하게 감싼다', () => {
    const next = withHooks({}, '/some path/notify.sh');
    const cmd = next.hooks?.['SessionStart']?.[0]?.hooks?.[0]?.command ?? '';
    expect(cmd).toContain('"/some path/notify.sh"');
  });

  it('사용자의 다른 설정을 보존한다', () => {
    const next = withHooks({ model: 'opus', theme: 'dark' }, '/x/notify.sh');
    expect(next['model']).toBe('opus');
    expect(next['theme']).toBe('dark');
  });

  it('사용자의 다른 훅을 보존한다', () => {
    const next = withHooks({ hooks: { SessionStart: [OTHER_HOOK], PreToolUse: [OTHER_HOOK] } }, '/x/n.sh');
    expect(next.hooks?.['SessionStart']).toHaveLength(2);
    expect(next.hooks?.['SessionStart']?.[0]).toEqual(OTHER_HOOK);
    expect(next.hooks?.['PreToolUse']).toEqual([OTHER_HOOK]);
  });

  it('두 번 넣어도 중복되지 않는다', () => {
    const once = withHooks({}, '/x/n.sh');
    const twice = withHooks(once, '/x/n.sh');
    expect(twice.hooks?.['SessionStart']).toHaveLength(1);
  });

  it('경로가 바뀌면 옛 항목을 대체한다', () => {
    const old = withHooks({}, '/old/n.sh');
    const next = withHooks(old, '/new/n.sh');
    expect(next.hooks?.['SessionStart']).toHaveLength(1);
    expect(next.hooks?.['SessionStart']?.[0]?.hooks?.[0]?.command).toContain('/new/n.sh');
  });

  it('제거하면 우리 것만 빠진다', () => {
    const withOurs = withHooks({ hooks: { SessionStart: [OTHER_HOOK] } }, '/x/n.sh');
    const cleaned = withoutHooks(withOurs);
    expect(cleaned.hooks?.['SessionStart']).toEqual([OTHER_HOOK]);
    expect(hasHooks(cleaned)).toBe(false);
  });

  it('남는 훅이 없으면 빈 껍데기를 남기지 않는다', () => {
    const cleaned = withoutHooks(withHooks({}, '/x/n.sh'));
    expect(cleaned.hooks).toBeUndefined();
  });

  it('훅이 없는 설정을 제거해도 그대로다', () => {
    expect(withoutHooks({ model: 'opus' })).toEqual({ model: 'opus' });
  });

  it('우리 훅은 표식으로 식별한다', () => {
    const cmd = withHooks({}, '/x/n.sh').hooks?.['SessionStart']?.[0]?.hooks?.[0]?.command ?? '';
    expect(cmd).toContain(HOOK_MARKER);
  });

  it('한쪽 이벤트만 있으면 설치된 것으로 보지 않는다', () => {
    const partial = withHooks({}, '/x/n.sh');
    delete partial.hooks?.['SessionEnd'];
    expect(hasHooks(partial)).toBe(false);
  });
});

describe('installHooks / uninstallHooks', () => {
  it('설정 파일이 없으면 새로 만든다', async () => {
    const settings = join(dir, 'settings.json');
    const script = join(dir, 'hooks', 'notify.sh');
    const r = await installHooks(settings, script);

    expect(r.changed).toBe(true);
    const written = JSON.parse(await readFile(settings, 'utf8'));
    expect(hasHooks(written)).toBe(true);
  });

  it('훅 스크립트를 실행 가능하게 만든다', async () => {
    const script = join(dir, 'hooks', 'notify.sh');
    await installHooks(join(dir, 'settings.json'), script);

    const s = await stat(script);
    expect(s.mode & 0o111).toBeGreaterThan(0);
    expect(await readFile(script, 'utf8')).toContain('#!/bin/sh');
  });

  it('두 번째 설치는 아무것도 바꾸지 않는다', async () => {
    const settings = join(dir, 'settings.json');
    const script = join(dir, 'hooks', 'notify.sh');
    await installHooks(settings, script);
    expect((await installHooks(settings, script)).changed).toBe(false);
  });

  it('기존 설정을 보존한 채 병합한다', async () => {
    const settings = join(dir, 'settings.json');
    await writeFile(settings, JSON.stringify({ model: 'opus', hooks: { PreToolUse: [OTHER_HOOK] } }));
    await installHooks(settings, join(dir, 'n.sh'));

    const written = JSON.parse(await readFile(settings, 'utf8'));
    expect(written.model).toBe('opus');
    expect(written.hooks.PreToolUse).toEqual([OTHER_HOOK]);
  });

  it('제거하면 원래 설정으로 돌아온다', async () => {
    const settings = join(dir, 'settings.json');
    const original = { model: 'opus', hooks: { PreToolUse: [OTHER_HOOK] } };
    await writeFile(settings, JSON.stringify(original));

    await installHooks(settings, join(dir, 'n.sh'));
    await uninstallHooks(settings);

    expect(JSON.parse(await readFile(settings, 'utf8'))).toEqual(original);
  });

  it('손상된 설정 파일은 덮어쓰지 않고 멈춘다', async () => {
    const settings = join(dir, 'settings.json');
    await writeFile(settings, '{ 깨진 JSON');
    await expect(installHooks(settings, join(dir, 'n.sh'))).rejects.toThrow(/cannot read/);
    expect(await readFile(settings, 'utf8')).toBe('{ 깨진 JSON');
  });
});
