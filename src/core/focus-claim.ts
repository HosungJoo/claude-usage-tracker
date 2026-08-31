import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { focusClaimPath } from '../shared/runtime-paths.js';

/**
 * "이 알림은 내가 맡는다"는 표식.
 *
 * 같은 임계값을 VS Code 패널 카드와 전 화면 오버레이가 동시에 알리면,
 * 사용자는 같은 말을 두 번 듣는다. 두 번째는 알림이 아니라 소음이다.
 *
 * 그래서 패널이 보이는 동안에는 패널이 맡는다. 확장이 짧은 유효기간의
 * 표식을 갱신하고, 트레이 앱은 오버레이를 띄우기 직전에 이것을 본다.
 * 유효기간을 짧게 두는 이유: VS Code가 강제 종료돼 표식이 남더라도
 * 몇 초 뒤면 저절로 힘을 잃어야 하기 때문이다. 남은 파일 하나 때문에
 * 알림이 영영 안 뜨는 쪽이 훨씬 나쁘다.
 */

/** 이보다 오래된 표식은 없는 것으로 본다. 갱신 주기의 두 배 남짓. */
export const CLAIM_TTL_MS = 25_000;

interface Claim {
  version: number;
  id: number;
  at: number;
}

const CLAIM_VERSION = 1;

/** 지금부터 내가 알림을 맡는다고 적는다. 유효기간 안에 다시 불러 갱신한다. */
export async function writeFocusClaim(
  id: number,
  now: number = Date.now(),
  path: string = focusClaimPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${id}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: CLAIM_VERSION, id, at: now }));
  await rename(tmp, path);
}

/** 표식을 거둔다. 창이 포커스를 잃거나 확장이 내려갈 때. */
export async function clearFocusClaim(path: string = focusClaimPath()): Promise<void> {
  await rm(path, { force: true });
}

/**
 * 다른 누군가가 이 알림을 맡고 있는가.
 *
 * @param selfId 내 식별자. 내가 적은 표식은 나를 막지 않는다.
 */
export async function isClaimedByOther(
  selfId: number,
  now: number = Date.now(),
  path: string = focusClaimPath(),
  ttlMs: number = CLAIM_TTL_MS,
): Promise<boolean> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    // 없거나 깨졌으면 아무도 맡지 않은 것이다.
    return false;
  }

  if (typeof raw !== 'object' || raw === null) return false;
  const o = raw as Record<string, unknown>;
  if (o['version'] !== CLAIM_VERSION) return false;
  if (typeof o['id'] !== 'number' || typeof o['at'] !== 'number') return false;

  const claim: Claim = { version: CLAIM_VERSION, id: o['id'], at: o['at'] };
  if (claim.id === selfId) return false;
  return now - claim.at < ttlMs;
}
