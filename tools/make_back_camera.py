"""Build the catcher-camera rear sprites from the existing back art.

    python tools/make_back_camera.py

Why this exists
---------------
assets/player/*/back.png is a rear view whose implied camera sits on the
third-base side: the batter's head is turned toward the frame's LEFT and the bat
is held up to the LEFT. The game's pitch camera stands behind the plate, where
the pitcher is up-CENTRE, so that sprite reads as a batter staring away from the
pitch. Reference footage of the real game shows the opposite: the back of the
helmet, and the bat up to the RIGHT.

Mirroring fixes the pose and breaks the lettering. PROMPT.md 0-2 anticipates
exactly this — "反転すると背番号やロゴの文字が鏡像になるので … 文字部分を描画
しない" — and PROMPT.md 0-4 forbids altering the company logo. So this does
better than dropping the text: it mirrors the figure and then pastes the
name / number / logo block back in its original, unmirrored form.

That paste is only safe because the jersey back is a flat field of navy. The
block is detected rather than hard-coded (every player's art is a different
size), and it is inset well within the torso so the seam falls inside flat
colour rather than across a contour.

Outputs, per player:
    back_cam.png       the mirrored figure with correct lettering
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PLAYERS = ("yuki", "takaya", "atsushi")

# Where to look for the lettering: a band inside the torso, in fractions of the
# image. Chosen to exclude the collar piping above and the belt below, and the
# sleeve piping at either side.
BAND_X = (0.30, 0.72)
BAND_Y = (0.245, 0.495)

# How far outside the detected lettering to extend the pasted patch [px].
PAD = 11

# How many pixels of the patch border fade to nothing. The surrounding jersey is
# a flat field, so a feathered edge makes the seam disappear entirely; a hard
# edge leaves a visible rectangle, which the first build did.
FEATHER = 10


def _is_jersey_navy(rgb: np.ndarray) -> np.ndarray:
    """True where a pixel is the flat navy of the shirt (including its shading).

    Navy here means dark, and bluer than it is red. The logo is orange and
    green, the name is white and the number is orange with a green outline, so
    all of them fail at least one of those two conditions.
    """
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    return (b > r + 10) & (b < 150) & (r < 120)


def letter_box(img: Image.Image) -> tuple[int, int, int, int] | None:
    """Bounding box of the lettering and logo on the jersey back."""
    w, h = img.size
    a = np.array(img)
    rgb = a[:, :, :3]
    alpha = a[:, :, 3]

    x0, x1 = int(w * BAND_X[0]), int(w * BAND_X[1])
    y0, y1 = int(h * BAND_Y[0]), int(h * BAND_Y[1])

    band_rgb = rgb[y0:y1, x0:x1]
    band_alpha = alpha[y0:y1, x0:x1]
    mark = (band_alpha > 200) & ~_is_jersey_navy(band_rgb)
    ys, xs = np.nonzero(mark)
    if len(xs) < 50:
        return None
    return (
        max(0, x0 + int(xs.min()) - PAD),
        max(0, y0 + int(ys.min()) - PAD),
        min(w, x0 + int(xs.max()) + PAD + 1),
        min(h, y0 + int(ys.max()) + PAD + 1),
    )


def build(player: str) -> None:
    src_path = ROOT / "assets" / "player" / player / "back.png"
    img = Image.open(src_path).convert("RGBA")
    w, _ = img.size

    mirrored = img.transpose(Image.FLIP_LEFT_RIGHT)

    box = letter_box(img)
    if box is None:
        print(f"  {player}: no lettering found — left mirrored, text will read backwards")
    else:
        left, top, right, bottom = box
        patch = img.crop(box)

        # Feather the patch: ramp its alpha to zero over FEATHER px at every
        # edge, so the paste dissolves into the surrounding navy instead of
        # leaving a rectangle.
        pw, ph = patch.size
        ramp_x = np.minimum(np.arange(pw), np.arange(pw)[::-1]).astype(np.float32)
        ramp_y = np.minimum(np.arange(ph), np.arange(ph)[::-1]).astype(np.float32)
        fade = np.minimum(
            np.clip(ramp_x / FEATHER, 0, 1)[None, :],
            np.clip(ramp_y / FEATHER, 0, 1)[:, None])
        arr = np.array(patch)
        arr[:, :, 3] = (arr[:, :, 3].astype(np.float32) * fade).astype(np.uint8)
        patch = Image.fromarray(arr, 'RGBA')

        # the same rectangle, reflected onto the mirrored figure
        dest_left = w - right
        mirrored.alpha_composite(patch, (dest_left, top))
        print(f"  {player}: lettering {right - left}x{bottom - top} px "
              f"restored at x={dest_left}")

    out = ROOT / "assets" / "player" / player / "back_cam.png"
    mirrored.save(out)
    print(f"  {player}: wrote {out.relative_to(ROOT)} ({out.stat().st_size:,} bytes)")





def _dilate(mask: np.ndarray, n: int) -> np.ndarray:
    """Grow a mask by n pixels, 4-connected."""
    out = mask.copy()
    for _ in range(n):
        g = out.copy()
        g[1:, :] |= out[:-1, :]
        g[:-1, :] |= out[1:, :]
        g[:, 1:] |= out[:, :-1]
        g[:, :-1] |= out[:, 1:]
        out = g
    return out


def _erode(mask: np.ndarray, n: int) -> np.ndarray:
    """Shrink a mask by n pixels. Dilating the complement, which is the same thing."""
    if n <= 0:
        return mask
    return ~_dilate(~mask, n)


def _elongation(blob: np.ndarray) -> tuple[float, tuple[float, float], tuple[float, float]]:
    """Return (major/minor extent, one end, the other end) of a blob's axis."""
    ys, xs = np.nonzero(blob)
    pts = np.stack([xs.astype(np.float64), ys.astype(np.float64)], axis=1)
    centre = pts.mean(axis=0)
    centred = pts - centre
    # principal axis by eigen-decomposition of the 2x2 covariance
    cov = centred.T @ centred / len(pts)
    vals, vecs = np.linalg.eigh(cov)
    major = vecs[:, int(np.argmax(vals))]
    minor = vecs[:, int(np.argmin(vals))]
    along = centred @ major
    across = centred @ minor
    spread_major = float(along.max() - along.min())
    spread_minor = float(max(1e-6, across.max() - across.min()))
    end_a = centre + major * along.min()
    end_b = centre + major * along.max()
    return spread_major / spread_minor, (float(end_a[0]), float(end_a[1])), \
        (float(end_b[0]), float(end_b[1]))


def split_bat(player: str) -> dict[str, float] | None:
    """Write back_cam_body.png and back_cam_bat.png, and return the pivot data.

    The bat is found rather than hand-traced: within the upper part of the
    figure, take the dark connected components and keep the most elongated one.
    Hair is dark too, but hair is a blob and a bat is a line, so the elongation
    ratio separates them — and the two are not touching, because the bat crosses
    open sky above the shoulder.
    """
    path = ROOT / "assets" / "player" / player / "back_cam.png"
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    a = np.array(img)
    rgb = a[:, :, :3].astype(np.int16)
    alpha = a[:, :, 3]

    # Near-black AND neutral. The navy shirt is also dark, so darkness alone
    # picked the jersey up and the most-elongated-blob rule then chose a scrap of
    # the logo instead of the bat. A bat is neutral grey (blue channel about
    # equal to red); navy is emphatically not.
    top = int(h * 0.52)
    r = rgb[:, :, 0]
    b = rgb[:, :, 2]
    dark = (alpha > 140) & (rgb.max(axis=2) < 112) & ((b - r) < 14)
    dark[top:, :] = False

    # Erode before labelling, then grow the winner back.
    #
    # One player's bat passes close enough to his black hair that the two touch,
    # and a bat-plus-head blob is not elongated, so the most-elongated rule
    # picked something else entirely. Eroding severs a contact thinner than the
    # bat itself; the escalation loop tries harder only when it has to, because
    # over-eroding eventually breaks the bat in half too.
    blob: np.ndarray | None = None
    ratio = 0.0
    used_erosion = 0
    for erosion in (0, 2, 3, 4):
        probe = _erode(dark, erosion)
        candidates = _components(probe)
        if not candidates:
            continue
        scored = sorted(((_elongation(c)[0], c) for c in candidates), key=lambda t: -t[0])
        best_ratio, best = scored[0]
        if best_ratio >= 3.0:
            blob = _dilate(best, erosion + 2) & dark
            ratio = best_ratio
            used_erosion = erosion
            break
    if blob is None:
        print(f"  {player}: no elongated blob found at any erosion; bat not split")
        return None
    if used_erosion:
        print(f"  {player}: needed {used_erosion}px erosion to free the bat from the hair")
    _, end_a, end_b = _elongation(blob)

    # the pivot is the end nearer the hands, i.e. the LOWER of the two
    pivot, tip = (end_a, end_b) if end_a[1] > end_b[1] else (end_b, end_a)

    # take the antialiased rim with the bat, so no dark fringe is left behind
    grown = _dilate(blob, 2)

    bat = a.copy()
    bat[~grown, 3] = 0
    body = a.copy()
    body[grown, 3] = 0

    Image.fromarray(bat, "RGBA").save(ROOT / "assets" / "player" / player / "back_cam_bat.png")
    Image.fromarray(body, "RGBA").save(ROOT / "assets" / "player" / player / "back_cam_body.png")

    angle = float(np.degrees(np.arctan2(tip[1] - pivot[1], tip[0] - pivot[0])))
    print(f"  {player}: bat split (elongation {ratio:.1f}), "
          f"pivot ({pivot[0]:.0f},{pivot[1]:.0f}) rest angle {angle:.1f} deg")
    return {
        "pivotX": pivot[0] / w, "pivotY": pivot[1] / h,
        "tipX": tip[0] / w, "tipY": tip[1] / h,
        "restAngleDeg": angle,
    }



def main() -> None:
    print("building catcher-camera rear sprites")
    anchors: dict[str, dict[str, float]] = {}
    for player in PLAYERS:
        build(player)
        data = split_bat(player)
        if data is not None:
            anchors[player] = data
    if anchors:
        import json
        out = ROOT / "assets" / "player" / "bat_anchors.json"
        out.write_text(json.dumps(anchors, indent=2), encoding="utf-8")
        print(f"  wrote {out.relative_to(ROOT)}")




# ---------------------------------------------------------------------------
# splitting the bat off the body, so it can swing
# ---------------------------------------------------------------------------

def _components(mask: np.ndarray) -> list[np.ndarray]:
    """Label 4-connected components. No scipy: PROMPT.md 1 caps the dependencies."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    out: list[np.ndarray] = []
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or seen[sy, sx]:
                continue
            stack = [(sy, sx)]
            seen[sy, sx] = True
            pixels = []
            while stack:
                y, x = stack.pop()
                pixels.append((y, x))
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            if len(pixels) >= 400:
                blob = np.zeros_like(mask, dtype=bool)
                ys, xs = zip(*pixels)
                blob[np.array(ys), np.array(xs)] = True
                out.append(blob)
    return out


if __name__ == "__main__":
    main()
