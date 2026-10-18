/**
 * Frame-mode displays (E-ink and other generic panels) show pixels the PC renders.
 * A frame is 1 bit per pixel, row by row, most significant bit first, each row padded
 * to a whole byte; a set bit is black. Conversion is a hard threshold, never dithering,
 * so QR modules stay sharp.
 */

export type PixelOrder = 'rgba' | 'bgra';

export function frameStride(width: number): number {
  return Math.ceil(width / 8);
}

export function frameLength(width: number, height: number): number {
  return frameStride(width) * height;
}

/** Packs 8-bit RGBA or BGRA pixels into a 1 bpp frame. Transparent pixels count as white. */
export function packFrame(
  pixels: ArrayLike<number>,
  width: number,
  height: number,
  order: PixelOrder = 'rgba',
  threshold = 128,
): Uint8Array {
  if (pixels.length < width * height * 4) throw new RangeError(`Expected ${width * height * 4} bytes of pixels, got ${pixels.length}`);
  const stride = frameStride(width);
  const frame = new Uint8Array(stride * height);
  const [r, b] = order === 'rgba' ? [0, 2] : [2, 0];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if ((pixels[i + 3] ?? 255) < 128) continue;
      const luminance = 0.299 * pixels[i + r]! + 0.587 * pixels[i + 1]! + 0.114 * pixels[i + b]!;
      if (luminance < threshold) frame[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return frame;
}

/** Expands a frame back to opaque black-and-white pixels, for previews. */
export function unpackFrame(frame: Uint8Array, width: number, height: number, order: PixelOrder = 'rgba'): Uint8Array {
  const stride = frameStride(width);
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const black = (frame[y * stride + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;
      const value = black ? 0 : 255;
      const i = (y * width + x) * 4;
      pixels[i] = value;
      pixels[i + 1] = value;
      pixels[i + 2] = value;
      pixels[i + 3] = 255;
    }
  }
  // Black and white are the same in either order; the parameter keeps call sites explicit.
  void order;
  return pixels;
}

/**
 * A strip drawn under the panel area that carries a render's stamp: 16 blocks of 6 × 4
 * pixels, black for a set bit, most significant first. The renderer captures the panel and
 * the strip together and captures again until the strip shows the stamp it just drew, so a
 * stale capture (the previous amount's QR) can never reach a panel.
 */
export const FRAME_STAMP = { bits: 16, block: 6, height: 4 } as const;

/** Stamps run 1…0xFFFE: never all white (a blank page) or all black. */
export function nextStamp(stamp: number): number {
  return stamp >= 0xfffe ? 1 : stamp + 1;
}

export function stampBits(stamp: number): boolean[] {
  return Array.from({ length: FRAME_STAMP.bits }, (_, i) => ((stamp >> (FRAME_STAMP.bits - 1 - i)) & 1) === 1);
}

/** Reads the stamp from a packed frame of `height` panel rows plus the strip. */
export function readStamp(frame: Uint8Array, width: number, height: number): number {
  const stride = frameStride(width);
  const y = height + FRAME_STAMP.height / 2;
  let stamp = 0;
  for (let i = 0; i < FRAME_STAMP.bits; i++) {
    const x = i * FRAME_STAMP.block + FRAME_STAMP.block / 2;
    const black = ((frame[y * stride + (x >> 3)] ?? 0) & (0x80 >> (x & 7))) !== 0;
    stamp = (stamp << 1) | (black ? 1 : 0);
  }
  return stamp;
}
