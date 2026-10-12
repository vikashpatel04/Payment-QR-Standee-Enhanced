import QRCode from 'qrcode';
import { useMemo } from 'react';

/** Quiet zone around the code, in modules. Scanners need at least four. */
const QUIET = 4;

/**
 * A QR code as SVG: error correction M, byte mode, a 4-module quiet zone, dark on
 * white, never inverted. Drawn on whole modules with crisp edges so it stays sharp
 * at any scale.
 */
export function Qr({ text, size, label }: { text: string; size: number; label?: string }) {
  const { path, modules } = useMemo(() => {
    if (!text) return { path: '', modules: 0 };
    const code = QRCode.create([{ data: new TextEncoder().encode(text), mode: 'byte' }], { errorCorrectionLevel: 'M' });
    const n = code.modules.size;
    const data = code.modules.data;
    let d = '';
    for (let y = 0; y < n; y++) {
      let x = 0;
      while (x < n) {
        if (!data[y * n + x]) {
          x++;
          continue;
        }
        const start = x;
        while (x < n && data[y * n + x]) x++;
        d += `M${start + QUIET} ${y + QUIET}h${x - start}v1h-${x - start}z`;
      }
    }
    return { path: d, modules: n + QUIET * 2 };
  }, [text]);

  if (!modules) return null;
  return (
    <svg
      viewBox={`0 0 ${modules} ${modules}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      style={{ display: 'block' }}
    >
      <rect width={modules} height={modules} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
