"""Generate the PWA icons.

PROMPT.md 1 forbids fetching images, and Pillow is already the project's
build-time tool for cutting sprites, so the icons are drawn here rather than
downloaded or hand-authored in a binary editor. Re-runnable and diffable.

    python tools/make_icons.py

Everything is rendered at 4x and downsampled: Pillow's draw primitives are not
antialiased, and an icon with stair-stepped edges reads as broken at 48 px on a
home screen.

Three files come out:
  icon-192.png            small, "any" purpose
  icon-512.png            large, "any" purpose
  icon-maskable-512.png   same art shrunk into the circle Android crops to
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "assets" / "icon"

SS = 4  # supersampling factor

NAVY = (26, 42, 74)
NAVY_DEEP = (7, 12, 26)
GOLD = (255, 205, 90)
WHITE = (250, 251, 254)
SHADE = (206, 214, 230)
SEAM = (200, 56, 56)
BAT_DARK = (74, 51, 32)
BAT_MID = (126, 90, 56)
BAT_LIGHT = (176, 133, 88)


def _background(n: int) -> Image.Image:
    """A vignette, built from concentric circles: Pillow has no gradient fill."""
    img = Image.new("RGB", (n, n), NAVY_DEEP)
    draw = ImageDraw.Draw(img)
    steps = 120
    cx, cy = n * 0.42, n * 0.34
    for i in range(steps, 0, -1):
        f = i / steps
        r = n * 1.05 * f
        colour = tuple(
            int(NAVY_DEEP[c] + (NAVY[c] - NAVY_DEEP[c]) * (1 - f) ** 1.5) for c in range(3)
        )
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=colour)
    return img.convert("RGBA")


def _trajectory(img: Image.Image, n: int, scale: float) -> None:
    """The flight path: a fading dotted arc, behind everything else."""
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer, "RGBA")
    steps = 20
    for i in range(steps):
        f = i / (steps - 1)
        # a parabola rising to the right, ENDING at the ball rather than passing
        # it: dots on the far side would read as the ball arriving, not leaving
        x = n * (0.10 + 0.56 * f)
        y = n * (0.86 - 0.90 * f + 0.38 * f * f)
        r = n * (0.010 + 0.015 * f) * scale
        alpha = int(34 + 140 * f)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=GOLD + (alpha,))
    img.alpha_composite(layer)


def _bat(img: Image.Image, n: int, scale: float) -> None:
    """A bat on the diagonal, tapering from knob to barrel."""
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer, "RGBA")

    cx, cy = n * 0.46, n * 0.56
    angle = math.radians(-40)
    length = n * 0.74 * scale
    dx, dy = math.cos(angle), math.sin(angle)
    knob = (cx - dx * length * 0.5, cy - dy * length * 0.5)
    tip = (cx + dx * length * 0.5, cy + dy * length * 0.5)

    # perpendicular, for offsetting the highlight to the upper-left edge
    px, py = -dy, dx

    steps = 220
    for i in range(steps):
        f = i / (steps - 1)
        x = knob[0] + (tip[0] - knob[0]) * f
        y = knob[1] + (tip[1] - knob[1]) * f
        # handle stays thin; the barrel swells over the last 55%
        w = n * (0.020 + 0.042 * max(0.0, (f - 0.45) / 0.55) ** 1.25) * scale
        draw.ellipse([x - w, y - w, x + w, y + w], fill=BAT_MID + (255,))

    # highlight, a thinner pass offset toward the light
    for i in range(steps):
        f = i / (steps - 1)
        w = n * (0.020 + 0.042 * max(0.0, (f - 0.45) / 0.55) ** 1.25) * scale
        x = knob[0] + (tip[0] - knob[0]) * f + px * w * 0.42
        y = knob[1] + (tip[1] - knob[1]) * f + py * w * 0.42
        hw = w * 0.34
        draw.ellipse([x - hw, y - hw, x + hw, y + hw], fill=BAT_LIGHT + (255,))

    # shadow along the lower-right edge
    for i in range(steps):
        f = i / (steps - 1)
        w = n * (0.020 + 0.042 * max(0.0, (f - 0.45) / 0.55) ** 1.25) * scale
        x = knob[0] + (tip[0] - knob[0]) * f - px * w * 0.60
        y = knob[1] + (tip[1] - knob[1]) * f - py * w * 0.60
        hw = w * 0.28
        draw.ellipse([x - hw, y - hw, x + hw, y + hw], fill=BAT_DARK + (255,))

    kr = n * 0.032 * scale
    draw.ellipse([knob[0] - kr, knob[1] - kr, knob[0] + kr, knob[1] + kr],
                 fill=BAT_DARK + (255,))
    img.alpha_composite(layer)


def _ball(img: Image.Image, n: int, scale: float) -> None:
    """A baseball: white disc, soft shading, two seams bowing outward.

    Seam geometry, solved rather than guessed, because the first two attempts
    produced arcs that crossed in the middle and read as a fish. Each seam is an
    arc of a circle whose centre sits on the FAR side of the ball, so the near
    part of that circle bows out toward the edge — the "( )" a baseball reads as.

    Given a desired apex at 0.62r from centre and endpoints at (0.35r, +-0.82r):
      R (1 - cos s) = 0.27 r   and   R sin s = 0.82 r
      => tan(s/2) = 0.27/0.82  => s = 36.5 deg,  R = 1.379 r,  offset = 0.759 r
    """
    layer = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer, "RGBA")

    cx, cy = n * 0.665, n * 0.335
    r = n * 0.178 * scale

    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE + (255,))
    # A soft crescent of shade at the lower right, so the disc reads as a sphere.
    # Built from many low-alpha passes: one hard-edged ellipse looks like a grey
    # sticker rather than shading, which is what the first version did.
    for i in range(14):
        f = i / 13
        k = 0.30 + 0.70 * f
        draw.ellipse([cx - r * k, cy - r * k, cx + r, cy + r], fill=SHADE + (16,))
    draw.ellipse([cx - r * 0.995, cy - r * 0.995, cx + r * 0.58, cy + r * 0.52],
                 fill=WHITE + (150,))

    width = max(1, int(n * 0.020 * scale))
    seam_r = r * 1.379
    offset = r * 0.759
    span = 36.5
    # left seam: circle centred to the RIGHT, drawing its left-hand arc
    draw.arc([cx + offset - seam_r, cy - seam_r, cx + offset + seam_r, cy + seam_r],
             start=180 - span, end=180 + span, fill=SEAM + (255,), width=width)
    # right seam: mirrored
    draw.arc([cx - offset - seam_r, cy - seam_r, cx - offset + seam_r, cy + seam_r],
             start=-span, end=span, fill=SEAM + (255,), width=width)

    img.alpha_composite(layer)


def build(size: int, scale: float) -> Image.Image:
    n = size * SS
    img = _background(n)
    _trajectory(img, n, scale)
    _bat(img, n, scale)
    _ball(img, n, scale)
    return img.resize((size, size), Image.LANCZOS).convert("RGB")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    build(192, 1.0).save(OUT / "icon-192.png")
    build(512, 1.0).save(OUT / "icon-512.png")
    # maskable: Android crops to a circle of 80% width, so shrink the art to fit
    build(512, 0.72).save(OUT / "icon-maskable-512.png")
    for name in ("icon-192.png", "icon-512.png", "icon-maskable-512.png"):
        p = OUT / name
        print(f"{p.relative_to(OUT.parent.parent)}  {p.stat().st_size:,} bytes")


if __name__ == "__main__":
    main()
