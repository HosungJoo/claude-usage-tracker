import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { Logger, redact } from '../src/main/logger.js';

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'cut-log-'));
  file = join(dir, 'app.log');
});

const log = (): Logger => new Logger({ file, echo: false });

describe('redact', () => {
  it('Bearer 토큰을 지운다', () => {
    const out = redact('Authorization: Bearer sk-ant-oat01-VERYLONGSECRETVALUE123456');
    expect(out).not.toContain('VERYLONGSECRETVALUE');
    expect(out).toContain('<redacted>');
  });

  it('긴 토큰처럼 보이는 문자열을 지운다', () => {
    const token = 'a'.repeat(64);
    expect(redact(`token=${token}`)).not.toContain(token);
  });

  it('평범한 문장은 건드리지 않는다', () => {
    const msg = '임계값 70% 돌파 (fiveHour 73%)';
    expect(redact(msg)).toBe(msg);
  });

  it('짧은 식별자는 남긴다', () => {
    // 세션 id 같은 짧은 값까지 지우면 로그가 쓸모없어진다.
    expect(redact('session=abc123')).toContain('abc123');
  });
});

describe('Logger', () => {
  it('파일에 기록한다', async () => {
    log().info('시작했습니다');
    expect(await readFile(file, 'utf8')).toContain('시작했습니다');
  });

  it('수준과 시각을 남긴다', async () => {
    log().warn('조심');
    const line = await readFile(file, 'utf8');
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+WARN\s+조심$/m);
  });

  it('여러 줄이 쌓인다', async () => {
    const l = log();
    l.info('하나');
    l.error('둘');
    const text = await readFile(file, 'utf8');
    expect(text.trim().split('\n')).toHaveLength(2);
  });

  it('토큰은 파일에도 남지 않는다', async () => {
    const token = 'x'.repeat(50);
    log().error(`요청 실패: Bearer ${token}`);
    expect(await readFile(file, 'utf8')).not.toContain(token);
  });

  it('디렉터리가 없어도 만든다', async () => {
    const nested = join(dir, 'a', 'b', 'app.log');
    new Logger({ file: nested, echo: false }).info('x');
    // logDir()은 실제 설정 경로를 보므로, 여기서는 파일이 생겼는지만 본다.
    expect(existsSync(nested) || existsSync(file)).toBe(true);
  });

  it('커지면 한 번 굴리고 이전 것 하나만 남긴다', async () => {
    await writeFile(file, 'x'.repeat(600 * 1024));
    log().info('굴린 뒤 첫 줄');

    expect(existsSync(`${file}.1`)).toBe(true);
    const fresh = await readFile(file, 'utf8');
    expect(fresh).toContain('굴린 뒤 첫 줄');
    expect(fresh.length).toBeLessThan(1000);
  });

  it('쓸 수 없어도 예외를 던지지 않는다', async () => {
    await writeFile(join(dir, 'blocked'), '파일');
    const l = new Logger({ file: join(dir, 'blocked', 'app.log'), echo: false });
    expect(() => l.info('아무거나')).not.toThrow();
  });
});
