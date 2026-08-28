import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { configDir } from '../shared/runtime-paths.js';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../shared/settings.js';

/**
 * 설정 파일.
 *
 * 상태 저장(state-store)과 같은 원칙을 따른다: 원자적으로 쓰고, 손상돼도
 * 기본값으로 뜬다. 다만 여기는 사용자가 직접 열어 고칠 수 있는 파일이라
 * 읽기가 더 관대하다 — 값 하나가 이상해도 그 값만 기본값으로 되돌린다.
 */

export function defaultSettingsPath(): string {
  return join(configDir(), 'settings.json');
}

export type SettingsListener = (settings: Settings) => void;

export class SettingsStore {
  private current: Settings = { ...DEFAULT_SETTINGS };
  private readonly listeners = new Set<SettingsListener>();

  constructor(private readonly path: string = defaultSettingsPath()) {}

  get value(): Settings {
    return this.current;
  }

  /** 변경을 구독한다. 반환값을 부르면 해지된다. */
  subscribe(fn: SettingsListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async load(): Promise<Settings> {
    try {
      const text = await readFile(this.path, 'utf8');
      this.current = normalizeSettings(JSON.parse(text));
    } catch {
      // 파일 없음/손상/권한 — 어느 쪽이든 기본값으로 시작하는 게 맞다.
      this.current = { ...DEFAULT_SETTINGS };
    }
    return this.current;
  }

  /**
   * 일부만 바꿔 저장한다.
   *
   * @returns 저장 성공 여부. 실패해도 메모리의 값은 갱신되고 예외는 던지지 않는다 —
   *   디스크에 못 썼다고 사용자가 방금 만진 설정이 화면에서 되돌아가면 더 혼란스럽다.
   */
  async update(patch: Partial<Settings>): Promise<boolean> {
    const next = normalizeSettings({ ...this.current, ...patch });
    const changed = JSON.stringify(next) !== JSON.stringify(this.current);
    this.current = next;

    if (changed) {
      for (const fn of this.listeners) {
        try {
          fn(next);
        } catch {
          // 구독자 하나가 던져도 나머지는 알아야 한다.
        }
      }
    }

    const tmp = `${this.path}.tmp`;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await rename(tmp, this.path);
      return true;
    } catch {
      return false;
    }
  }

  /** 전부 기본값으로. */
  async reset(): Promise<boolean> {
    return this.update({ ...DEFAULT_SETTINGS });
  }
}
