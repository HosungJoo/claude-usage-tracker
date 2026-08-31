import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CLAIM_TTL_MS,
  clearFocusClaim,
  isClaimedByOther,
  writeFocusClaim,
} from '../src/core/focus-claim.js';

let path: string;
beforeEach(async () => {
  path = join(await mkdtemp(join(tmpdir(), 'cut-claim-')), 'focus.claim');
});

describe('focus claim', () => {
  it('표식이 없으면 아무도 맡지 않은 것이다', async () => {
    await expect(isClaimedByOther(1, 0, path)).resolves.toBe(false);
  });

  it('남이 방금 적은 표식은 나를 막는다', async () => {
    await writeFocusClaim(2, 1000, path);
    await expect(isClaimedByOther(1, 1000, path)).resolves.toBe(true);
  });

  it('내가 적은 표식은 나를 막지 않는다', async () => {
    await writeFocusClaim(1, 1000, path);
    await expect(isClaimedByOther(1, 1000, path)).resolves.toBe(false);
  });

  it('유효기간이 지난 표식은 힘을 잃는다', async () => {
    await writeFocusClaim(2, 0, path);
    await expect(isClaimedByOther(1, CLAIM_TTL_MS - 1, path)).resolves.toBe(true);
    await expect(isClaimedByOther(1, CLAIM_TTL_MS, path)).resolves.toBe(false);
  });

  it('거둔 표식은 남지 않는다', async () => {
    await writeFocusClaim(2, 1000, path);
    await clearFocusClaim(path);
    await expect(isClaimedByOther(1, 1000, path)).resolves.toBe(false);
  });

  it('깨진 표식은 없는 것으로 본다', async () => {
    await writeFile(path, '{ 이건 JSON이 아니다');
    await expect(isClaimedByOther(1, 1000, path)).resolves.toBe(false);
  });

  it('없는 표식을 거둬도 터지지 않는다', async () => {
    await expect(clearFocusClaim(path)).resolves.toBeUndefined();
  });
});
