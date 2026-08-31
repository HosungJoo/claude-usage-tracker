import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { HOOK_SCRIPT } from './hook-script.js';
import { claudeSettingsPath, hookScriptPath } from '../shared/runtime-paths.js';

/**
 * Claude Code의 settings.json에 훅을 심고 뺀다.
 *
 * 남의 설정 파일을 고치는 일이라 원칙이 하나 있다: **우리가 넣은 것만
 * 건드린다.** 사용자가 직접 등록한 다른 훅은 읽고 쓰는 과정에서
 * 그대로 보존되어야 한다.
 */

/**
 * 우리 훅을 식별하는 표식.
 *
 * 스크립트 경로에 이름이 들어 있으리라 기대하지 않는다 — 경로는 사용자가
 * 바꿀 수 있고, 그러면 제거·갱신이 남의 훅을 건드리거나 우리 것을 놓친다.
 * 명령 끝에 셸 주석으로 표식을 박아 두면 어디에 설치하든 확실히 찾는다.
 */
export const HOOK_MARKER = '# claude-usage-tracker';

/** 우리가 붙는 이벤트. */
export const HOOK_EVENTS = ['SessionStart', 'SessionEnd'] as const;
export type HookEventName = (typeof HOOK_EVENTS)[number];

interface HookCommand {
  type?: string;
  command?: string;
  [k: string]: unknown;
}

interface HookMatcher {
  matcher?: string;
  hooks?: HookCommand[];
  [k: string]: unknown;
}

interface ClaudeSettings {
  hooks?: Record<string, HookMatcher[]>;
  [k: string]: unknown;
}

function isOurs(entry: HookMatcher): boolean {
  return (entry.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes(HOOK_MARKER));
}

/**
 * 설정 객체에 훅을 병합한다. 순수 함수 — 파일을 건드리지 않는다.
 *
 * @param settings 기존 설정 (없으면 빈 객체).
 * @param scriptPath 실행할 스크립트 경로.
 */
export function withHooks(settings: ClaudeSettings, scriptPath: string): ClaudeSettings {
  const hooks: Record<string, HookMatcher[]> = { ...(settings.hooks ?? {}) };

  for (const event of HOOK_EVENTS) {
    // 우리 것만 걷어내고 남의 훅은 그대로 둔 뒤, 우리 것을 새로 붙인다.
    const others = (hooks[event] ?? []).filter((e) => !isOurs(e));
    hooks[event] = [
      ...others,
      {
        matcher: '',
        hooks: [{ type: 'command', command: `sh ${JSON.stringify(scriptPath)} ${HOOK_MARKER}` }],
      },
    ];
  }

  return { ...settings, hooks };
}

/** 설정 객체에서 우리 훅만 걷어낸다. 순수 함수. */
export function withoutHooks(settings: ClaudeSettings): ClaudeSettings {
  if (!settings.hooks) return settings;
  const hooks: Record<string, HookMatcher[]> = { ...settings.hooks };

  for (const event of HOOK_EVENTS) {
    const remaining = (hooks[event] ?? []).filter((e) => !isOurs(e));
    // 빈 배열을 남기면 설정 파일이 지저분해진다. 통째로 지운다.
    if (remaining.length === 0) delete hooks[event];
    else hooks[event] = remaining;
  }

  const next: ClaudeSettings = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return next;
}

/** 훅이 설치되어 있는지. */
export function hasHooks(settings: ClaudeSettings): boolean {
  return HOOK_EVENTS.every((event) => (settings.hooks?.[event] ?? []).some(isOurs));
}

async function readSettings(path: string): Promise<ClaudeSettings> {
  try {
    const text = await readFile(path, 'utf8');
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as ClaudeSettings;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return {};
    // 손상된 설정 파일을 덮어쓰면 사용자의 다른 설정이 날아간다. 멈춘다.
    throw new Error(`cannot read the Claude Code settings file: ${path}`);
  }
}

/** 원자적으로 저장한다. 쓰다 말고 죽어도 원본이 반쪽 나지 않게. */
async function writeSettings(path: string, settings: ClaudeSettings): Promise<void> {
  const tmp = `${path}.claude-usage-tracker.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`);
  await rename(tmp, path);
}

export interface InstallResult {
  settingsPath: string;
  scriptPath: string;
  /** 이미 설치되어 있어 바뀐 게 없으면 false. */
  changed: boolean;
}

/** 훅 스크립트를 쓰고 settings.json에 등록한다. */
export async function installHooks(
  settingsPath: string = claudeSettingsPath(),
  scriptPath: string = hookScriptPath(),
): Promise<InstallResult> {
  await mkdir(dirname(scriptPath), { recursive: true });
  await writeFile(scriptPath, HOOK_SCRIPT);
  await chmod(scriptPath, 0o755);

  const settings = await readSettings(settingsPath);
  const next = withHooks(settings, scriptPath);
  const changed = JSON.stringify(settings) !== JSON.stringify(next);
  if (changed) await writeSettings(settingsPath, next);

  return { settingsPath, scriptPath, changed };
}

/** settings.json에서 훅을 뺀다. 스크립트 파일은 남겨 둔다(해가 없다). */
export async function uninstallHooks(
  settingsPath: string = claudeSettingsPath(),
): Promise<InstallResult> {
  const settings = await readSettings(settingsPath);
  const next = withoutHooks(settings);
  const changed = JSON.stringify(settings) !== JSON.stringify(next);
  if (changed) await writeSettings(settingsPath, next);

  return { settingsPath, scriptPath: hookScriptPath(), changed };
}

/** 현재 설치 상태를 조회한다. */
export async function hooksInstalled(
  settingsPath: string = claudeSettingsPath(),
): Promise<boolean> {
  return hasHooks(await readSettings(settingsPath));
}
