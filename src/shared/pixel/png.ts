import { deflateSync } from 'node:zlib';

/**
 * 최소 PNG 인코더 (RGBA, 8bit).
 *
 * 스프라이트를 눈으로 확인하는 개발 도구와, 트레이 아이콘을 코드에서
 * 만들어 쓰기 위해 필요하다. 런타임 렌더링은 캔버스가 하므로
 * 이 인코더는 빌드/도구 경로에서만 쓴다.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcInput = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

/** RGBA 픽셀 배열을 PNG 바이트로. */
export function encodePNG(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // 스캔라인마다 필터 바이트(0 = None)를 앞에 붙인다.
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const idat = new Uint8Array(deflateSync(raw, { level: 9 }));

  const parts = [
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** APNG 한 컷. `delayMs`는 이 컷을 얼마나 보여줄지다. */
export interface AnimationFrame {
  rgba: Uint8ClampedArray;
  delayMs: number;
}

/**
 * 최소 APNG 인코더.
 *
 * GIF를 쓰지 않는 이유는 알파다. 캐릭터는 어떤 바탕 위에 얹힐지 모르고 —
 * VS Code 말풍선의 배경색은 테마마다 다르다 — GIF의 1비트 투명은 가장자리에
 * 테두리를 남긴다. APNG는 PNG 그대로라 알파가 온전하고, 인코더도 위의
 * `encodePNG`와 청크 두어 개 차이뿐이다.
 *
 * 모든 컷을 전체 크기로 적고 dispose=NONE·blend=SOURCE를 쓴다. 차분 프레임을
 * 쓰면 몇 바이트 줄지만, 한 컷이라도 어긋나면 그 뒤가 전부 무너진다 —
 * 스프라이트 몇 킬로바이트를 아끼자고 질 위험이 아니다.
 */
export function encodeAPNG(
  width: number,
  height: number,
  frames: AnimationFrame[],
  { plays = 0 }: { plays?: number } = {},
): Uint8Array {
  if (frames.length === 0) throw new Error('APNG에는 최소 한 컷이 필요합니다');

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const actl = new Uint8Array(8);
  const av = new DataView(actl.buffer);
  av.setUint32(0, frames.length);
  av.setUint32(4, plays); // 0 = 무한 반복

  let sequence = 0;

  /** 한 컷의 표시 시간과 위치. 위치는 항상 (0,0), 크기는 항상 전체다. */
  const fctl = (delayMs: number): Uint8Array => {
    const out = new Uint8Array(26);
    const v = new DataView(out.buffer);
    v.setUint32(0, sequence++);
    v.setUint32(4, width);
    v.setUint32(8, height);
    v.setUint32(12, 0); // x_offset
    v.setUint32(16, 0); // y_offset
    // 지연은 분수로 적는다. 분모를 1000으로 두면 ms를 그대로 쓸 수 있다.
    v.setUint16(20, Math.max(0, Math.round(delayMs)));
    v.setUint16(22, 1000);
    out[24] = 0; // dispose_op: NONE
    out[25] = 0; // blend_op: SOURCE
    return out;
  };

  const compress = (rgba: Uint8ClampedArray): Uint8Array => {
    const stride = width * 4;
    const raw = new Uint8Array((stride + 1) * height);
    for (let y = 0; y < height; y++) {
      raw[y * (stride + 1)] = 0; // 필터 없음
      raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }
    return new Uint8Array(deflateSync(raw, { level: 9 }));
  };

  const first = frames[0] as AnimationFrame;
  const parts: Uint8Array[] = [
    sig,
    chunk('IHDR', ihdr),
    chunk('acTL', actl),
    chunk('fcTL', fctl(first.delayMs)),
    // 첫 컷은 IDAT다 — APNG를 모르는 뷰어에게는 이것이 그냥 정지 그림이 된다.
    chunk('IDAT', compress(first.rgba)),
  ];

  for (const frame of frames.slice(1)) {
    parts.push(chunk('fcTL', fctl(frame.delayMs)));
    const data = compress(frame.rgba);
    const fdat = new Uint8Array(4 + data.length);
    new DataView(fdat.buffer).setUint32(0, sequence++);
    fdat.set(data, 4);
    parts.push(chunk('fdAT', fdat));
  }
  parts.push(chunk('IEND', new Uint8Array(0)));

  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
