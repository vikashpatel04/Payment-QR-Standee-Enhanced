import jsQR from 'jsqr';

/**
 * Reads a QR code from a photo or screenshot. Phone photos are large and often
 * slightly blurred, so a few sizes are tried, largest-first after a fast pass.
 */
export async function decodeQrImage(image: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(image);
  try {
    for (const longest of [1200, 2000, 800, 2800]) {
      const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      const code = jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' });
      if (code?.data) return code.data;
      if (scale === 1) break;
    }
    return null;
  } finally {
    bitmap.close();
  }
}
