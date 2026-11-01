"""Project-owned geometric g; deterministic PNGs using the Python standard library."""
from pathlib import Path
import math
import struct
import zlib

def png(size, maskable=False):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            coverage = 0
            for dy in (0.25, 0.75):
                for dx in (0.25, 0.75):
                    u, v = (x + dx) / size, (y + dy) / size
                    ring = abs(math.hypot(u - .48, v - .43) - .145) < .038
                    stem = .588 < u < .664 and .29 < v < .66
                    tail = v > .65 and abs(math.hypot(u - .49, v - .65) - .135) < .038
                    coverage += ring or stem or tail
            t = coverage / 4
            alpha = 255
            if not maskable:
                u, v = (x + .5) / size, (y + .5) / size
                if math.hypot(max(.2-u, 0, u-.8), max(.2-v, 0, v-.8)) > .2:
                    alpha = 0
            rows.extend((round(6+(255-6)*t), round(95+(255-95)*t), round(70+(255-70)*t), alpha))
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')

for name, size, mask in [('icon-192.png', 192, False), ('icon-512.png', 512, False), ('maskable-512.png', 512, True), ('apple-touch-icon.png', 180, True)]:
    Path('public/icons', name).write_bytes(png(size, mask))
