"""
Cut the company logo out of the character art so the 3D batter can wear it.

PROMPT.md 0-4 permits the company logo but forbids altering it, so this does the
least possible: it finds the logo's bounding box and copies those pixels
verbatim. No recolouring, no rescaling, no redrawing, no alpha edits. The navy
jersey behind it is copied too rather than keyed out, because keying out a
background IS an alteration — and the decal is going onto a navy jersey anyway,
so the surrounding pixels are invisible in place.

Finding it: the jersey is navy and the lettering is white, so the logo is the
only thing on the back that is strongly SATURATED — orange and green. Looking
for saturation rather than for a fixed rectangle means the crop survives someone
redrawing the art at a different size.

    python tools/make_logo.py

Reads   assets/player/<id>/back.png
Writes  assets/logo_back.png
"""

import pathlib
import sys

try:
    from PIL import Image
except ImportError:                                    # pragma: no cover
    sys.exit("Pillow is needed: python -m pip install pillow")

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "player" / "yuki" / "back.png"
OUT = ROOT / "assets" / "logo_back.png"

# Only look at the middle of the upper back. Both bounds are load-bearing: the
# first crop keyed on "saturated" and swept in the sleeve trim, the forearm and
# the orange number, because skin is saturated too and the trim is the same green.
BAND_TOP = 0.19
BAND_BOTTOM = 0.34
SIDE_MARGIN = 0.22
PAD = 10
# The detector only sees the basket's green, so the crop has to be grown to take
# in the handle above it and the orange basketball beside it.
TOP_EXTRA = 16
RIGHT_EXTRA = 12
# No bottom padding: the player's name starts a few pixels below the basket.


def logo_green(px):
    """The basket is the only strongly green thing in the middle of the back."""
    r, g, b, a = px
    if a < 200:
        return False
    return g > 90 and g > r + 25 and g > b + 25


def main():
    if not SOURCE.exists():
        sys.exit(f"missing {SOURCE}")
    im = Image.open(SOURCE).convert("RGBA")
    w, h = im.size
    px = im.load()

    x0, y0, x1, y1 = w, h, 0, 0
    found = 0
    for y in range(int(h * BAND_TOP), int(h * BAND_BOTTOM)):
        for x in range(int(w * SIDE_MARGIN), int(w * (1 - SIDE_MARGIN))):
            if logo_green(px[x, y]):
                found += 1
                x0, y0 = min(x0, x), min(y0, y)
                x1, y1 = max(x1, x), max(y1, y)

    if found < 150:
        sys.exit(f"only {found} green pixels found; the crop would be wrong")
    # the basketball sits to the left of the basket and is orange, so widen left
    x0 = max(0, x0 - int((x1 - x0) * 0.45))

    box = (
        max(0, x0 - PAD), max(0, y0 - PAD - TOP_EXTRA),
        min(w, x1 + 1 + PAD + RIGHT_EXTRA), min(h, y1 + 1))
    logo = im.crop(box)
    logo.save(OUT)
    print(f"{found} green pixels, box {box} -> {OUT.name} {logo.size}")


if __name__ == "__main__":
    main()
