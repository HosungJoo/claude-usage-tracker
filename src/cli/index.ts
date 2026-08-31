#!/usr/bin/env node
import { applyLocale, localeFromEnv, t } from '../shared/i18n/index.js';
import { CredentialError, describeCredentialError } from '../core/credentials.js';
import { formatSnapshot } from '../core/format.js';
import { UsagePoller } from '../core/poller.js';
import { StateStore, defaultStatePath } from '../core/state-store.js';
import { describeUsageError, getUsageSnapshot, UsageError } from '../core/usage-api.js';
import { hooksInstalled, installHooks, uninstallHooks } from '../hooks/install.js';
import { claudeSettingsPath, eventSpoolDir } from '../shared/runtime-paths.js';
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

  --install-hooks   세션 시작/종료 훅을 Claude Code에 등록한다
  --uninstall-hooks 등록한 훅을 제거한다
  --hook-status     훅 설치 상태를 확인한다

  --help            이 도움말
`.trim();

interface Args {
  mode: 'once' | 'watch' | 'reset' | 'help' | 'install-hooks' | 'uninstall-hooks' | 'hook-status';
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
      case '--install-hooks':
        args.mode = 'install-hooks';
        break;
      case '--uninstall-hooks':
        args.mode = 'uninstall-hooks';
        break;
      case '--hook-status':
        args.mode = 'hook-status';
        break;
      case '--json':
        args.json = true;
        break;
      case '--interval': {
        const raw = argv[++i];
        const sec = Number.parseInt(raw ?? '', 10);
        if (!Number.isFinite(sec) || sec <= 0) {
          throw new Error(t().cli.badInterval);
        }
        args.intervalMs = sec * 1000;
        break;
      }
      default:
        throw new Error(t().cli.unknownOption(String(a)));
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
    const where = ev.window === 'weekly' ? t().window.weekly : t().window.fiveHour;
    // M2에서는 이 자리에 픽셀 캐릭터가 등장한다.
    console.log(`\n${t().cli.crossed(where, ev.threshold, `${ev.percent}%`)}`);
  });

  poller.on('error', (_e, message, willRetry) => {
    console.error(`  ⚠ ${message}${willRetry ? t().log.willRetry : ''}`);
  });

  await poller.start();
  console.log(t().cli.watching(intervalMs / 1000));

  return new Promise<number>((resolve) => {
    const shutdown = (): void => {
      poller.stop();
      console.log(`\n${t().cli.stopping}`);
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
  console.log(ok ? t().cli.historyCleared(defaultStatePath()) : t().cli.historyClearFailed);
  return ok ? 0 : 1;
}

async function runInstallHooks(): Promise<number> {
  const result = await installHooks();
  console.log(result.changed ? t().cli.hooksRegistered : t().cli.hooksAlreadyRegistered);
  console.log(t().cli.settingsPath(result.settingsPath));
  console.log(t().cli.scriptPath(result.scriptPath));
  console.log(`\n${t().cli.hooksNextSession}`);
  console.log(t().cli.hooksNeedApp);
  return 0;
}

async function runUninstallHooks(): Promise<number> {
  const result = await uninstallHooks();
  console.log(result.changed ? t().cli.hooksRemoved : t().cli.hooksNotRegistered);
  console.log(t().cli.settingsPath(result.settingsPath));
  return 0;
}

async function runHookStatus(): Promise<number> {
  const installed = await hooksInstalled();
  const spool = eventSpoolDir();
  const { existsSync } = await import('node:fs');
  const running = existsSync(spool);

  console.log(t().cli.hookStatus(installed ? t().cli.yes : t().cli.no, claudeSettingsPath()));
  console.log(t().cli.appStatus(running ? t().cli.yes : t().cli.no, spool));
  if (installed && !running) {
    console.log(`\n${t().cli.hooksButNoApp}`);
  }
  return installed ? 0 : 1;
}

async function main(): Promise<number> {
  // 셸의 언어를 따른다. CLI에는 설정 파일을 읽을 이유가 없다 —
  // 터미널에서 한 번 보고 마는 출력이다.
  applyLocale('auto', localeFromEnv(process.env));

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
    if (args.mode === 'install-hooks') return await runInstallHooks();
    if (args.mode === 'uninstall-hooks') return await runUninstallHooks();
    if (args.mode === 'hook-status') return await runHookStatus();
    if (args.mode === 'reset') return await runReset();
    if (args.mode === 'watch') return await runWatch(args.intervalMs, args.json);
    return await runOnce(args.json);
  } catch (e) {
    console.error(t().cli.errorPrefix(explain(e)));
    return 1;
  }
}

process.exitCode = await main();
