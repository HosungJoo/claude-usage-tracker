import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadCredentials, describeCredentialError, CredentialError } from '../src/core/credentials.js';

const NOW = 1_700_000_000_000;
let dir: string;
const paths: string[] = [];

async function fixture(name: string, content: string): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), 'cut-test-'));
  const p = join(dir, name);
  await writeFile(p, content);
  paths.push(p);
  return p;
}

afterAll(async () => {
  for (const p of paths) await chmod(p, 0o600).catch(() => {});
});

describe('loadCredentials', () => {
  it('유효한 자격증명을 읽는다', async () => {
    const p = await fixture(
      'ok.json',
      JSON.stringify({
        claudeAiOauth: { accessToken: 'tok', expiresAt: NOW + 3600_000, subscriptionType: 'max' },
      }),
    );
    await expect(loadCredentials(p, NOW)).resolves.toEqual({
      accessToken: 'tok',
      expiresAt: NOW + 3600_000,
      subscriptionType: 'max',
    });
  });

  it('파일이 없으면 not_found', async () => {
    await expect(loadCredentials('/nonexistent/nope.json', NOW)).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('JSON이 깨졌으면 malformed', async () => {
    const p = await fixture('bad.json', '{ not json');
    await expect(loadCredentials(p, NOW)).rejects.toMatchObject({ code: 'malformed' });
  });

  it('토큰이 없으면 missing_token', async () => {
    const p = await fixture('notoken.json', JSON.stringify({ claudeAiOauth: {} }));
    await expect(loadCredentials(p, NOW)).rejects.toMatchObject({ code: 'missing_token' });
  });

  it('빈 문자열 토큰도 missing_token', async () => {
    const p = await fixture('empty.json', JSON.stringify({ claudeAiOauth: { accessToken: '' } }));
    await expect(loadCredentials(p, NOW)).rejects.toMatchObject({ code: 'missing_token' });
  });

  it('만료된 토큰은 expired', async () => {
    const p = await fixture(
      'exp.json',
      JSON.stringify({ claudeAiOauth: { accessToken: 'tok', expiresAt: NOW - 1 } }),
    );
    await expect(loadCredentials(p, NOW)).rejects.toMatchObject({ code: 'expired' });
  });

  it('expiresAt이 없으면 만료로 보지 않는다', async () => {
    const p = await fixture('noexp.json', JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }));
    await expect(loadCredentials(p, NOW)).resolves.toMatchObject({ accessToken: 'tok' });
  });

  it('에러 메시지에 토큰이 포함되지 않는다', async () => {
    const p = await fixture(
      'leak.json',
      JSON.stringify({ claudeAiOauth: { accessToken: 'SUPERSECRET', expiresAt: NOW - 1 } }),
    );
    await expect(loadCredentials(p, NOW)).rejects.toSatisfy(
      (e: unknown) => !(e as Error).message.includes('SUPERSECRET'),
    );
  });
});

describe('describeCredentialError', () => {
  it('모든 코드에 안내 문구가 있다', () => {
    for (const c of ['not_found', 'permission_denied', 'malformed', 'missing_token', 'expired'] as const) {
      expect(describeCredentialError(new CredentialError(c, 'x'))).toBeTruthy();
    }
  });
});
