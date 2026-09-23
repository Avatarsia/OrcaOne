"""OrcaOne's own app icon: an "O" of printed layers around a "1" on a teal tile, drawn for OrcaOne
alone, nothing from OrcaSlicer or Snapmaker Orca. Writes it as SVG (favicon, Linux launcher) and
in pixels: PNG 192 and 512 for the web app manifest, an ICO with 16 to 256 px for Windows
shortcuts and the built program. Standard library only: the few shapes are sampled per pixel.
The shapes and colours are the numbers below; change them and run again:

    .lenv/bin/python tools/make_icons.py
"""

import struct
import zlib
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "orcaone" / "static" / "assets"

SIZE = 512                                           # the drawing's own units
CORNER = 112                                         # radius of the tile's corners
TOP, BOTTOM = (0x26, 0xA6, 0x9A), (0x00, 0x69, 0x5C)  # tile gradient, top left to bottom right
WHITE = (0xFF, 0xFF, 0xFF)
CENTRE, OUTER, INNER = 256, 176, 120                 # the "O"
LAYERS, GAP = 8, 8                                   # its printed layers and the gaps between them
LAYER = (2 * OUTER - (LAYERS - 1) * GAP) / LAYERS
ONE = [(262, 168), (306, 168), (306, 344), (262, 344), (262, 216), (209.6, 252.7), (209.6, 204.7)]


def _hex(colour) -> str:
    return "#%02X%02X%02X" % colour


def _num(value: float) -> str:
    return f"{value:.2f}".rstrip("0").rstrip(".")


def _circle(radius: float) -> str:
    return f"M{CENTRE} {CENTRE - radius}a{radius} {radius} 0 1 1 0 {2 * radius}a{radius} {radius} 0 1 1 0 -{2 * radius}z"


def _svg() -> str:
    # The whole ring in white, over it the gaps between the layers in the tile's own gradient
    # (userSpaceOnUse, so both match), then the "1". Plain shapes only: Qt SVG, which draws the
    # icons in KDE, has no clipPath (doc.qt.io/qt-6/svgextensions.html) and showed the layers of
    # a clipped ring as full-width bars.
    gaps = "".join(f"M{CENTRE - OUTER} {_num(CENTRE - OUTER + i * (LAYER + GAP) + LAYER)}h{2 * OUTER}v{GAP}h-{2 * OUTER}z"
                   for i in range(LAYERS - 1))
    one = "M" + "L".join(f"{_num(x)} {_num(y)}" for x, y in ONE) + "z"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">
  <!-- OrcaOne's own app icon, made by tools/make_icons.py together with the PNG and ICO files. -->
  <defs>
    <linearGradient id="tile" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="{SIZE}" y2="{SIZE}">
      <stop offset="0" stop-color="{_hex(TOP)}"/>
      <stop offset="1" stop-color="{_hex(BOTTOM)}"/>
    </linearGradient>
  </defs>
  <rect width="{SIZE}" height="{SIZE}" rx="{CORNER}" fill="url(#tile)"/>
  <path fill="{_hex(WHITE)}" fill-rule="evenodd" d="{_circle(OUTER)}{_circle(INNER)}"/>
  <path fill="url(#tile)" d="{gaps}"/>
  <path fill="{_hex(WHITE)}" d="{one}"/>
</svg>
"""


def _in_one(x: float, y: float) -> bool:
    """Even-odd rule, as for any polygon."""
    inside = False
    for (x1, y1), (x2, y2) in zip(ONE, ONE[-1:] + ONE[:-1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def _sample(x: float, y: float):
    """The colour at one point of the drawing, None outside the tile."""
    nearest_x = min(max(x, CORNER), SIZE - CORNER)
    nearest_y = min(max(y, CORNER), SIZE - CORNER)
    if not (0 <= x <= SIZE and 0 <= y <= SIZE) or (x - nearest_x) ** 2 + (y - nearest_y) ** 2 > CORNER ** 2:
        return None
    distance = (x - CENTRE) ** 2 + (y - CENTRE) ** 2
    if INNER ** 2 <= distance <= OUTER ** 2 and (y - (CENTRE - OUTER)) % (LAYER + GAP) < LAYER:
        return WHITE
    if _in_one(x, y):
        return WHITE
    t = (x + y) / (2 * SIZE)
    return tuple(a + (b - a) * t for a, b in zip(TOP, BOTTOM))


def _pixels(px: int) -> bytes:
    """RGBA rows as PNG wants them; each pixel is the mean of n × n points spread over it."""
    n = 8 if px <= 48 else 4
    steps = [(i + 0.5) / n for i in range(n)]
    scale = SIZE / px
    rows = bytearray()
    for row in range(px):
        rows.append(0)   # PNG filter "none"
        for col in range(px):
            r = g = b = hits = 0
            for dy in steps:
                for dx in steps:
                    colour = _sample((col + dx) * scale, (row + dy) * scale)
                    if colour:
                        r, g, b, hits = r + colour[0], g + colour[1], b + colour[2], hits + 1
            rows += bytes((round(r / hits), round(g / hits), round(b / hits), round(255 * hits / n ** 2))) if hits else bytes(4)
    return bytes(rows)


def _png(px: int) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", px, px, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(_pixels(px), 9)) + chunk(b"IEND", b""))


def _ico(pngs: dict[int, bytes]) -> bytes:
    """PNG pictures in one ICO file, as Windows reads them since Vista; a size of 0 means 256."""
    entries, data = b"", b""
    for px, png in pngs.items():
        entries += struct.pack("<BBBBHHII", px % 256, px % 256, 0, 0, 1, 32, len(png), 6 + 16 * len(pngs) + len(data))
        data += png
    return struct.pack("<HHH", 0, 1, len(pngs)) + entries + data


def main() -> None:
    (ASSETS / "app-icon.svg").write_bytes(_svg().encode("utf-8"))
    pngs = {px: _png(px) for px in (16, 32, 48, 192, 256, 512)}
    (ASSETS / "app-icon-192.png").write_bytes(pngs[192])
    (ASSETS / "app-icon-512.png").write_bytes(pngs[512])
    (ASSETS / "app-icon.ico").write_bytes(_ico({px: pngs[px] for px in (16, 32, 48, 256)}))
    print(f"Fertig: app-icon.svg, app-icon-192.png, app-icon-512.png, app-icon.ico in {ASSETS}")


if __name__ == "__main__":
    main()
