#!/usr/bin/env node
import { CredentialError, describeCredentialError } from '../core/credentials.js';
import { formatSnapshot } from '../core/format.js';
import { UsagePoller } from '../core/poller.js';
import { StateStore, defaultStatePath } from '../core/state-store.js';
import { describeUsageError, getUsageSnapshot, UsageError } from '../core/usage-api.js';
import type { ThresholdEvent } from '../core/thresholds.js';
import type { UsageSnapshot } from '../core/types.js';

/**
 * UI 없이 코어를 검증하는 CLI. 이 앱의 디버깅 창구이기도 하다.
 *
 *   npm run cli -- --once     현재 사용량을 한 번 출력하고 종료
 *   npm run cli -- --json     같은 내용을 JSON으로
 *   npm run cli -- --watch    폴러를 띄우고 임계값 발화를 지켜본다
 */

const USAGE_TEXT = `
claude-usage-tracker CLI

  --once            현재 사용량을 한 번 조회해 출력한다 (기본값)
  --json            결과를 JSON으로 출력한다
  --watch           폴러를 실행하고 임계값 이벤트를 관찰한다 (Ctrl+C 로 종료)
  --interval <sec>  --watch 의 폴링 주기 (기본 60초, 최소 10초)
  --reset-state     저장된 임계값 발화 이력을 지운다
  --help            이 도움말
`.trim();

interface Args {
  mode: 'once' | 'watch' | 'reset' | 'help';
  json: boolean;
  intervalMs: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: 'once', json: false, intervalMs: 60_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        args.mode = 'help';
        break;
      case '--once':
        args.mode = 'once';
        break;
      case '--watch':
        args.mode = 'watch';
        break;
      case '--reset-state':
        args.mode = 'reset';
        break;
      case '--json':
        args.json = true;
        break;
      case '--interval': {
        const raw = argv[++i];
        const sec = Number.parseInt(raw ?? '', 10);
        if (!Number.isFinite(sec) || sec <= 0) {
          throw new Error('--interval 에는 양의 정수(초)를 주세요.');
        }
        args.intervalMs = sec * 1000;
        break;
      }
      default:
        throw new Error(`알 수 없는 옵션: ${a}`);
    }
  }
  return args;
}

/** 예외를 사람이 읽을 수 있는 문구로. 토큰은 어떤 경로로도 노출하지 않는다. */
function explain(e: unknown): string {
  if (e instanceof UsageError) return describeUsageError(e);
  if (e instanceof CredentialError) return describeCredentialError(e);
  if (e instanceof Error) return e.message;
  return String(e);
}

function printSnapshot(snapshot: UsageSnapshot, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    console.log(formatSnapshot(snapshot));
  }
}

async function runOnce(json: boolean): Promise<number> {
  const snapshot = await getUsageSnapshot();
  printSnapshot(snapshot, json);
  return 0;
}

async function runWatch(intervalMs: number, json: boolean): Promise<number> {
  const poller = new UsagePoller({ intervalMs });

  poller.on('snapshot', (s) => {
    console.log(`\n[${new Date(s.fetchedAt).toLocaleTimeString()}]`);
    printSnapshot(s, json);
  });

  poller.on('threshold', (ev: ThresholdEvent) => {
    const where = ev.window === 'weekly' ? '주간' : '5시간';
    // M2에서는 이 자리에 픽셀 캐릭터가 등장한다.
    console.log(`\n  🔔 ${where} 사용량 ${ev.threshold}% 돌파 (현재 ${ev.percent}%)`);
  });

  poller.on('error', (_e, message, willRetry) => {
    console.error(`  ⚠ ${message}${willRetry ? ' (재시도합니다)' : ''}`);
  });

  await poller.start();
  console.log(`폴링 시작 — ${intervalMs / 1000}초 주기. Ctrl+C 로 종료합니다.`);

  return new Promise<number>((resolve) => {
    const shutdown = (): void => {
      poller.stop();
      console.log('\n종료합니다.');
      resolve(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}

async function runReset(): Promise<number> {
  const store = new StateStore();
  await store.load();
  const ok = await store.save(
    { fiveHour: { fired: [], resetsAt: null }, weekly: { fired: [], resetsAt: null } },
    null,
  );
  console.log(ok ? `발화 이력을 지웠습니다: ${defaultStatePath()}` : '상태 파일 저장에 실패했습니다.');
  return ok ? 0 : 1;
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(explain(e));
    console.error(`\n${USAGE_TEXT}`);
    return 2;
  }

  if (args.mode === 'help') {
    console.log(USAGE_TEXT);
    return 0;
  }

  try {
    if (args.mode === 'reset') return await runReset();
    if (args.mode === 'watch') return await runWatch(args.intervalMs, args.json);
    return await runOnce(args.json);
  } catch (e) {
    console.error(`오류: ${explain(e)}`);
    return 1;
  }
}

process.exitCode = await main();
