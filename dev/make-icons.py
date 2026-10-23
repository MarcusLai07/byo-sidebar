#!/usr/bin/env python3
"""Draws extension/icons/icon-{16,32,48,128}.png: a coral speech bubble with three dots.
No dependencies: shapes are signed-distance functions, supersampled for antialiasing."""
import math, os, struct, zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "extension", "icons")
CORAL = (217, 119, 87)
WHITE = (255, 255, 255)

def rounded_rect(x, y, cx, cy, hw, hh, r):
    qx, qy = abs(x - cx) - hw + r, abs(y - cy) - hh + r
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r

def triangle(x, y, a, b, c):
    # inside if all edge cross products share a sign; returns -1 inside, 1 outside
    def side(p, q): return (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0])
    s = [side(a, b), side(b, c), side(c, a)]
    return -1 if all(v <= 0 for v in s) or all(v >= 0 for v in s) else 1

def shade(x, y):
    """x, y in 0..1. Returns an RGBA tuple for this sample."""
    bubble = rounded_rect(x, y, 0.5, 0.44, 0.44, 0.33, 0.16) < 0
    tail = triangle(x, y, (0.22, 0.70), (0.42, 0.70), (0.16, 0.92)) < 0
    if not (bubble or tail):
        return (0, 0, 0, 0)
    for dx in (0.30, 0.50, 0.70):
        if math.hypot(x - dx, y - 0.44) < 0.065:
            return (*WHITE, 255)
    return (*CORAL, 255)

def render(size, ss=6):
    rows = []
    for py in range(size):
        row = bytearray([0])  # PNG filter: none
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    r, g, b, a = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
                    acc[0] += r * a; acc[1] += g * a; acc[2] += b * a; acc[3] += a
            n = ss * ss
            a = acc[3] / n
            row += bytes([int(acc[0] / acc[3]) if acc[3] else 0, int(acc[1] / acc[3]) if acc[3] else 0,
                          int(acc[2] / acc[3]) if acc[3] else 0, round(a)])
        rows.append(bytes(row))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")

os.makedirs(OUT, exist_ok=True)
for s in (16, 32, 48, 128):
    with open(os.path.join(OUT, f"icon-{s}.png"), "wb") as f:
        f.write(render(s))
    print(f"icon-{s}.png")
