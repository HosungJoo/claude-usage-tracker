import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyAutostart,
  desktopEntry,
  disableAutostart,
  enableAutostart,
  isAutostartEnabled,
} from '../src/main/autostart.js';

let dir: string;
let path: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cut-autostart-'));
  path = join(dir, 'autostart', 'claude-usage-tracker.desktop');
});

const TARGET = { exec: '/opt/ClaudeUsageTracker.AppImage' };

describe('desktopEntry', () => {
  it('XDG autostart 규격을 따른다', () => {
    const entry = desktopEntry(TARGET);
    expect(entry.startsWith('[Desktop Entry]')).toBe(true);
    expect(entry).toContain('Type=Application');
    expect(entry).toContain(`Exec=${TARGET.exec}`);
  });

  it('터미널을 띄우지 않는다', () => {
    expect(desktopEntry(TARGET)).toContain('Terminal=false');
  });

  it('로그인 직후를 피해 늦게 뜬다', () => {
    // 로그인 직후에는 네트워크가 아직 붙지 않아 첫 조회가 실패한다.
    expect(desktopEntry(TARGET)).toMatch(/X-GNOME-Autostart-Delay=\d+/);
  });
});

describe('enable / disable', () => {
  it('켜면 파일이 생긴다', async () => {
    await enableAutostart(TARGET, path);
    expect(existsSync(path)).toBe(true);
    expect(await isAutostartEnabled(path)).toBe(true);
  });

  it('중간 디렉터리를 만든다', async () => {
    await enableAutostart(TARGET, join(dir, 'a', 'b', 'x.desktop'));
    expect(existsSync(join(dir, 'a', 'b', 'x.desktop'))).toBe(true);
  });

  it('끄면 파일이 사라진다', async () => {
    await enableAutostart(TARGET, path);
    await disableAutostart(path);
    expect(existsSync(path)).toBe(false);
    expect(await isAutostartEnabled(path)).toBe(false);
  });

  it('이미 꺼져 있어도 끄기는 오류가 아니다', async () => {
    await expect(disableAutostart(path)).resolves.toBeUndefined();
  });

  it('파일이 없으면 꺼진 것으로 본다', async () => {
    expect(await isAutostartEnabled(join(dir, '없음.desktop'))).toBe(false);
  });

  it('파일은 있어도 비활성으로 표시됐으면 꺼진 것으로 본다', async () => {
    await enableAutostart(TARGET, path);
    const text = (await readFile(path, 'utf8')).replace(
      'X-GNOME-Autostart-enabled=true',
      'X-GNOME-Autostart-enabled=false',
    );
    await writeFile(path, text);
    expect(await isAutostartEnabled(path)).toBe(false);
  });

  it('다시 켜면 명령이 갱신된다', async () => {
    await enableAutostart({ exec: '/old' }, path);
    await enableAutostart({ exec: '/new' }, path);
    const text = await readFile(path, 'utf8');
    expect(text).toContain('Exec=/new');
    expect(text).not.toContain('/old');
  });
});

describe('applyAutostart', () => {
  it('설정 값에 맞춰 켜고 끈다', async () => {
    expect(await applyAutostart(true, TARGET, path)).toBe(true);
    expect(await isAutostartEnabled(path)).toBe(true);

    expect(await applyAutostart(false, TARGET, path)).toBe(true);
    expect(await isAutostartEnabled(path)).toBe(false);
  });

  it('쓸 수 없어도 던지지 않고 false를 돌려준다', async () => {
    // 자동 시작 하나 때문에 설정 저장 전체가 실패하면 안 된다.
    const blocker = join(dir, 'blocked');
    await writeFile(blocker, '파일');
    expect(await applyAutostart(true, TARGET, join(blocker, 'x.desktop'))).toBe(false);
  });
});
