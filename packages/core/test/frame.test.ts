import { describe, expect, it } from 'vitest';
import { FRAME_STAMP, frameLength, frameStride, nextStamp, packFrame, readStamp, stampBits, unpackFrame } from '../src/frame';
import { frameProfiles, getProfile, pixelsPerModule } from '../src/profiles';
import { parsePcMessage } from '../src/protocol';

/** Builds RGBA pixels from rows of '#' (black) and '.' (white). */
function pixels(rows: string[], order: 'rgba' | 'bgra' = 'rgba'): Uint8Array {
  const width = rows[0]!.length;
  const out = new Uint8Array(width * rows.length * 4);
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      const i = (y * width + x) * 4;
      const v = c === '#' ? 0 : c === '+' ? 100 : c === '-' ? 200 : 255;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = c === ' ' ? 0 : 255;
    }),
  );
  void order;
  return out;
}

describe('frame packing', () => {
  it('pads each row to a whole byte', () => {
    expect(frameStride(250)).toBe(32);
    expect(frameLength(250, 122)).toBe(3904);
    expect(frameLength(400, 300)).toBe(15000);
  });

  it('packs MSB first, set bit = black', () => {
    const frame = packFrame(pixels(['#.#.....#', '........#']), 9, 2);
    expect([...frame]).toEqual([0b10100000, 0b10000000, 0b00000000, 0b10000000]);
  });

  it('thresholds grey hard, without dithering', () => {
    expect([...packFrame(pixels(['+-+-+-+-']), 8, 1)]).toEqual([0b10101010]);
  });

  it('treats transparent pixels as white', () => {
    expect([...packFrame(pixels(['#  #    ']), 8, 1)]).toEqual([0b10010000]);
  });

  it('reads BGRA the same as RGBA for grey pixels and round-trips', () => {
    const src = pixels(['#..#.##.', '.##..#.#']);
    const frame = packFrame(src, 8, 2, 'bgra');
    expect(packFrame(unpackFrame(frame, 8, 2), 8, 2)).toEqual(frame);
  });

  it('refuses a short pixel buffer', () => {
    expect(() => packFrame(new Uint8Array(10), 8, 2)).toThrow(RangeError);
  });
});

describe('frame profiles', () => {
  it('lists the E-ink panels, including the 2.13" V4', () => {
    expect(frameProfiles().map((p) => p.id)).toEqual(['waveshare-2in13-v4', 'waveshare-2in13b-v4', 'waveshare-4in2', 'waveshare-7in5']);
    expect(getProfile('waveshare-2in13-v4')).toMatchObject({ w: 250, h: 122, tech: 'eink', mode: 'frame' });
    // The red (B) panel has no quick refresh, so Ambient changes rarely and acks wait longer.
    expect(getProfile('waveshare-2in13b-v4')).toMatchObject({ w: 250, h: 122, refresh: { fullMs: 16000 }, slideSeconds: 120 });
  });

  it('fits a typical UPI QR (version 7, 45 modules) on the 2.13" panel at 2 px per module', () => {
    expect(pixelsPerModule(122, 45, 4)).toBe(2);
  });
});

describe('frame messages', () => {
  it('parses a frame header with its safety fields, and who', () => {
    const header = { v: 1, t: 'frame', seq: 3, w: 250, h: 122, fmt: '1bpp', len: 3904, refresh: 'full', scene: 'pay', ttl: 180, rot: 0 };
    expect(parsePcMessage(header)).toEqual(header);
    expect(parsePcMessage({ v: 1, t: 'who' })).toEqual({ v: 1, t: 'who' });
  });
});

describe('frame stamp', () => {
  /** A white page of `height` rows plus the strip, with `stamp` drawn in it. */
  function page(width: number, height: number, stamp: number): Uint8Array {
    const rows = height + FRAME_STAMP.height;
    const pixels = new Uint8Array(width * rows * 4).fill(255);
    stampBits(stamp).forEach((black, i) => {
      if (!black) return;
      for (let y = height; y < rows; y++) {
        for (let x = i * FRAME_STAMP.block; x < (i + 1) * FRAME_STAMP.block; x++) pixels.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
      }
    });
    return pixels;
  }

  it('reads back the stamp drawn under the panel', () => {
    for (const stamp of [1, 0x1234, 0xabcd, 0xfffe]) {
      const frame = packFrame(page(122, 250, stamp), 122, 250 + FRAME_STAMP.height);
      expect(readStamp(frame, 122, 250)).toBe(stamp);
    }
  });

  it('fits the narrowest panel', () => {
    expect(FRAME_STAMP.bits * FRAME_STAMP.block).toBeLessThanOrEqual(122);
  });

  it('never stamps a blank or all-black strip', () => {
    expect(nextStamp(0)).toBe(1);
    expect(nextStamp(0xfffd)).toBe(0xfffe);
    expect(nextStamp(0xfffe)).toBe(1);
  });
});

