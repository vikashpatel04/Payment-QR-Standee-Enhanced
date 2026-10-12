"""Draws the Counter Pay icons (a QR-style mark on the accent green) with no image libraries.

Run from apps/agent:  python scripts/make-icons.py
Writes resources/icons/{icon.png, icon.ico, tray.png, tray@2x.png, tray-dot.png, tray-dot@2x.png}.
"""

import os
import struct
import zlib

ACCENT = (0x14, 0xB3, 0x7D)
WHITE = (0xFF, 0xFF, 0xFF)
DOT = (0xF5, 0x9E, 0x0B)
SS = 4  # supersampling for smooth edges


def rounded_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def shape(u, v, tray, dot):
    """Colour at (u, v) in a 0..1 square, or None for transparent."""
    if dot and (u - 0.8) ** 2 + (v - 0.2) ** 2 <= 0.17 ** 2:
        return DOT
    pad = 0.0 if tray else 0.04
    if not rounded_rect(u, v, pad, pad, 1 - pad, 1 - pad, 0.22):
        return None
    # Three finder patterns and a few data modules, like a tiny QR code.
    s = 0.27
    for fx, fy in ((0.17, 0.17), (1 - 0.17 - s, 0.17), (0.17, 1 - 0.17 - s)):
        if fx <= u <= fx + s and fy <= v <= fy + s:
            inner = 0.055
            ring = not (fx + inner <= u <= fx + s - inner and fy + inner <= v <= fy + s - inner)
            core = fx + 2 * inner <= u <= fx + s - 2 * inner and fy + 2 * inner <= v <= fy + s - 2 * inner
            return WHITE if ring or core else ACCENT
    m = 0.09
    for mx, my in ((0.6, 0.6), (0.72, 0.72), (0.6, 0.78), (0.78, 0.56), (0.5, 0.5)):
        if mx <= u <= mx + m and my <= v <= my + m:
            return WHITE
    return ACCENT


def render(size, tray=False, dot=False):
    rows = []
    n = size * SS
    for y in range(size):
        row = bytearray()
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    c = shape((x * SS + sx + 0.5) / n, (y * SS + sy + 0.5) / n, tray, dot)
                    if c:
                        acc[0] += c[0]
                        acc[1] += c[1]
                        acc[2] += c[2]
                        acc[3] += 255
            hits = acc[3] // 255
            if hits:
                row += bytes((acc[0] // hits, acc[1] // hits, acc[2] // hits, acc[3] // (SS * SS)))
            else:
                row += b"\0\0\0\0"
        rows.append(bytes(row))
    return rows


def png(rows, size):
    raw = b"".join(b"\0" + r for r in rows)

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def ico(images):
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries, blobs = b"", b""
    for size, data in images:
        dim = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    return header + entries + blobs


def main():
    out = os.path.join(os.path.dirname(__file__), "..", "resources", "icons")
    os.makedirs(out, exist_ok=True)
    big = {s: png(render(s), s) for s in (16, 32, 48, 256)}
    with open(os.path.join(out, "icon.png"), "wb") as f:
        f.write(big[256])
    with open(os.path.join(out, "icon.ico"), "wb") as f:
        f.write(ico(sorted(big.items())))
    for name, dot in (("tray", False), ("tray-dot", True)):
        with open(os.path.join(out, f"{name}.png"), "wb") as f:
            f.write(png(render(16, tray=True, dot=dot), 16))
        with open(os.path.join(out, f"{name}@2x.png"), "wb") as f:
            f.write(png(render(32, tray=True, dot=dot), 32))
    print("icons written to", os.path.abspath(out))


if __name__ == "__main__":
    main()
