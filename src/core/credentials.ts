import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Claude Code가 저장해 둔 OAuth 자격증명을 읽는다.
 *
 * 토큰은 절대 로그·에러 메시지에 포함하지 않는다. 이 모듈 바깥으로
 * 토큰이 문자열로 나가는 지점은 `loadCredentials`의 반환값 하나뿐이다.
 */

export const DEFAULT_CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json');

export interface Credentials {
  accessToken: string;
  /** epoch ms. */
  expiresAt: number;
  /** 'max' | 'pro' 등. 표시용. */
  subscriptionType: string | null;
}

export type CredentialErrorCode =
  | 'not_found'
  | 'permission_denied'
  | 'malformed'
  | 'missing_token'
  | 'expired';

export class CredentialError extends Error {
  constructor(
    readonly code: CredentialErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CredentialError';
  }
}

/** 사용자에게 그대로 보여줘도 되는 안내 문구. */
export function describeCredentialError(err: CredentialError): string {
  switch (err.code) {
    case 'not_found':
      return 'Claude Code 자격증명을 찾을 수 없습니다. 터미널에서 `claude` 로 한 번 로그인해 주세요.';
    case 'permission_denied':
      return '자격증명 파일을 읽을 권한이 없습니다. 파일 소유자와 권한(600)을 확인해 주세요.';
    case 'malformed':
      return '자격증명 파일이 손상되었습니다. `claude` 로 다시 로그인하면 복구됩니다.';
    case 'missing_token':
      return '자격증명에 OAuth 토큰이 없습니다. API 키 방식으로 로그인했다면 이 앱은 사용량을 조회할 수 없습니다.';
    case 'expired':
      return '토큰이 만료되었습니다. `claude` 를 한 번 실행하면 자동으로 갱신됩니다.';
  }
}

interface RawCredentials {
  claudeAiOauth?: {
    accessToken?: unknown;
    expiresAt?: unknown;
    subscriptionType?: unknown;
  };
}

/**
 * 자격증명을 읽어 반환한다.
 *
 * @param now 만료 판정 기준 시각(epoch ms). 테스트에서 주입한다.
 * @throws {CredentialError}
 */
export async function loadCredentials(
  path: string = DEFAULT_CREDENTIALS_PATH,
  now: number = Date.now(),
): Promise<Credentials> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new CredentialError('not_found', `자격증명 파일이 없습니다: ${path}`);
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new CredentialError('permission_denied', `자격증명 파일을 읽을 수 없습니다: ${path}`);
    }
    throw new CredentialError('malformed', `자격증명 파일 읽기 실패: ${path}`);
  }

  let raw: RawCredentials;
  try {
    raw = JSON.parse(text) as RawCredentials;
  } catch {
    throw new CredentialError('malformed', '자격증명 파일이 올바른 JSON이 아닙니다.');
  }

  const oauth = raw.claudeAiOauth;
  const token = oauth?.accessToken;
  if (typeof token !== 'string' || token.length === 0) {
    throw new CredentialError('missing_token', 'claudeAiOauth.accessToken 이 없습니다.');
  }

  const expiresAt = typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : 0;
  if (expiresAt > 0 && expiresAt <= now) {
    // 토큰 갱신은 Claude Code가 담당한다. 우리는 만료를 알리고 물러난다.
    throw new CredentialError('expired', '토큰이 만료되었습니다.');
  }

  return {
    accessToken: token,
    expiresAt,
    subscriptionType:
      typeof oauth?.subscriptionType === 'string' ? oauth.subscriptionType : null,
  };
}
