import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configDir } from '../shared/runtime-paths.js';

/**
 * 회전 로그.
 *
 * 이 앱은 배경에서 종일 떠 있으므로 로그가 무한정 자라면 안 된다. 파일이
 * 커지면 한 번 굴리고, 이전 것 하나만 남긴다.
 *
 * 무엇보다: **토큰과 자격증명은 절대 남기지 않는다.** 문자열에 토큰처럼
 * 보이는 것이 섞여 들어와도 걸러 낸다 — 로그는 사용자가 남에게 보내며
 * 도움을 청하는 파일이다.
 */

const MAX_BYTES = 512 * 1024;

export type LogLevel = 'info' | 'warn' | 'error';

export function logDir(): string {
  return join(configDir(), 'logs');
}

export function logPath(): string {
  return join(logDir(), 'app.log');
}

/**
 * 토큰처럼 보이는 조각을 지운다.
 *
 * OAuth 토큰은 길고 구분자가 섞인 문자열이다. 정확히 잡기보다 넉넉히
 * 지우는 쪽이 안전하다 — 로그가 조금 덜 읽히는 것과 토큰이 새는 것은
 * 비교할 문제가 아니다.
 */
export function redact(message: string): string {
  return message
    .replace(/\b(sk-|Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1<redacted>')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '<redacted>');
}

function rotateIfNeeded(file: string): void {
  try {
    if (!existsSync(file)) return;
    if (statSync(file).size < MAX_BYTES) return;
    renameSync(file, `${file}.1`);
  } catch {
    // 굴리지 못해도 로그는 계속 쌓여야 한다.
  }
}

export interface LoggerOptions {
  file?: string;
  /** 콘솔에도 낼지. 개발 중에는 켜 두는 게 편하다. */
  echo?: boolean;
}

export class Logger {
  private readonly file: string;
  private readonly echo: boolean;

  constructor(options: LoggerOptions = {}) {
    this.file = options.file ?? logPath();
    this.echo = options.echo ?? true;
  }

  private write(level: LogLevel, message: string): void {
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${redact(message)}\n`;
    if (this.echo) {
      const out = level === 'error' ? console.error : console.log;
      out(line.trimEnd());
    }
    try {
      // 기본 경로가 아니라 실제 대상 파일의 디렉터리를 만들어야 한다.
      mkdirSync(dirname(this.file), { recursive: true });
      rotateIfNeeded(this.file);
      appendFileSync(this.file, line);
    } catch {
      // 로그를 못 쓰는 것이 앱을 멈출 이유는 아니다.
    }
  }

  info(message: string): void {
    this.write('info', message);
  }

  warn(message: string): void {
    this.write('warn', message);
  }

  error(message: string): void {
    this.write('error', message);
  }
}
