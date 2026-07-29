#!/usr/bin/env python3
"""Cut the batting sheets and the character sheet into game sprites.

Reads  assets/src/*.png   (READ ONLY - never modified)
Writes assets/player/{id}/{pose}.png   21 files, transparent background
       assets/face/{id}_{variant}.png  24 files, opaque
       assets/player/anchors.json      ground-contact point per sprite

Dependencies: Pillow only. PROMPT.md 1 fixes the toolchain at "Pillow is
allowed because it is outside the build"; numpy and scipy are deliberately not
used here even though they were used to derive the constants below.

--------------------------------------------------------------------------
Why the obvious approach does not work
--------------------------------------------------------------------------
"Flood fill from the border, removing everything within N of the background
colour" destroys the white uniform trousers. Measured on the real files:

    takaya trousers highlight (232,232,233) vs background (248,248,248)
      -> distance 16, i.e. closer to the background than the infield lines are
         to each other

and the trouser outline is drawn in pale grey in places, so the fill leaks
through it and eats the inside of the leg. This was reproduced, not guessed.

So the fill is run on a LOCAL GRADIENT criterion instead: two neighbouring
pixels are connected only if their colours differ by <= STEP. The background,
the faint infield lines and the soft-edged dirt are all smooth, so the fill
crosses them freely; the character's outline is a hard edge, so it stops. A
closing + hole-fill pass then repairs any leak that did get through.

See docs/SPEC.md 10-2 for the full rationale.
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter

from PIL import Image, ImageChops, ImageFilter

# --------------------------------------------------------------------------
# paths
# --------------------------------------------------------------------------

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "src")
OUT_PLAYER = os.path.join(ROOT, "assets", "player")
OUT_FACE = os.path.join(ROOT, "assets", "face")

POSES = ["stance", "swing_0", "swing_1", "swing_2", "swing_3", "swing_4", "back"]

# --------------------------------------------------------------------------
# per-sheet constants - measured, see docs/SPEC.md 10-2 and 10-3
# --------------------------------------------------------------------------
#   step   local gradient tolerance for the flood fill
#   seed   distance from background colour that may seed the fill
#   erode  seed erosion radius, so a stray near-white pixel inside the
#          trousers can never start a fill
#   close  closing radius that repairs leaks through a weak outline
#   punch  interior pockets within this distance of the background are
#          re-opened (armpit gaps and similar)
#   panels x-ranges of the panel interiors; the light grey panel frames on the
#          yuki and takaya sheets must stay outside every crop
#   boxes  measured bounding box per pose, (x0, y0, x1, y1), right/bottom
#          exclusive. Boxes may overlap: each sprite keeps only the pixels of
#          its own connected component, so neighbours never bleed in.

SHEETS = {
    "yuki": {
        "file": "yuki_sheet.png",
        "step": 10, "seed": 6, "erode": 5, "close": 5, "punch": 26,
        "panels": {"stance": (18, 384), "swing": (405, 1379), "back": (1399, 1755)},
        "boxes": {
            "stance":  (23, 21, 379, 798),
            "swing_0": (410, 157, 624, 692),
            "swing_1": (624, 198, 768, 683),
            "swing_2": (777, 237, 999, 707),
            "swing_3": (1011, 227, 1197, 706),
            "swing_4": (1200, 160, 1374, 698),
            "back":    (1404, 14, 1750, 799),
        },
    },
    "takaya": {
        "file": "takaya_sheet.png",
        "step": 8, "seed": 5, "erode": 5, "close": 5, "punch": 13,
        "panels": {"stance": (15, 418), "swing": (445, 1335), "back": (1360, 1759)},
        "boxes": {
            "stance":  (42, 18, 375, 805),
            "swing_0": (450, 168, 653, 679),
            "swing_1": (607, 199, 781, 683),
            "swing_2": (775, 263, 990, 689),
            "swing_3": (990, 268, 1146, 687),
            "swing_4": (1146, 250, 1330, 687),
            "back":    (1401, 15, 1740, 799),
        },
    },
    "atsushi": {
        "file": "atsushi_sheet.png",
        "step": 10, "seed": 6, "erode": 5, "close": 5, "punch": 22,
        "panels": None,          # this sheet has no panel frames
        "boxes": {
            "stance":  (48, 13, 409, 875),
            "swing_0": (380, 239, 577, 753),
            "swing_1": (554, 246, 725, 750),
            "swing_2": (760, 313, 924, 765),
            "swing_3": (930, 292, 1151, 761),
            "swing_4": (1090, 287, 1333, 759),
            "back":    (1317, 18, 1633, 859),
        },
    },
}

PAD = 14                 # crop margin so the fill has clean background to seed from
MAIN_MIN_SHARE = 0.60    # sanity guard: the figure must dominate its own crop
DIRT_BAND = 0.30         # bottom fraction of the crop where warm ground smudges are removed
DIRT_WARM = 25           # R - B above this means dirt; measured dirt is R-B = +39..+47
DIRT_LUM = 110           # ...and it is mid-bright: measured luminance 128..150
SEVER = 2                # erosion radius that cuts the chalk ground line off the shoes
GROUND_BAND = 0.16       # bottom fraction where the only real content is shoes
GROUND_PALE = 170        # pale...
GROUND_NEUTRAL = 22      # ...and neutral means chalk, not navy shoe or skin
GROUND_DARK = 120        # a shoe pixel
GROUND_REACH = 10        # chalk further than this from a shoe in its row is scenery

# faces.png: the document is a regular grid, so the cells are derived rather
# than hand-measured. Verified against the rendered sheet.
FACE_FILE = "faces.png"
FACE_PANEL_X = (16, 1071)
FACE_PEOPLE = ["yuki", "takaya", "atsushi"]
FACE_BANDS = [
    ("bust", 170, 552, ["bust"]),
    ("direction", 826, 1006, ["front", "angle", "profile"]),
    ("expression", 1068, 1211, ["smile", "serious", "relief", "thinking"]),
]


# --------------------------------------------------------------------------
# small mask helpers - a mask is an 'L' image, 255 = set
# --------------------------------------------------------------------------

def mask_from(size, flags):
    m = Image.new("L", size)
    m.putdata([255 if f else 0 for f in flags])
    return m


def mask_and(a, b):
    return ImageChops.darker(a, b)


def mask_sub(a, b):
    return ImageChops.subtract(a, b)


def dilate(m, radius):
    return m.filter(ImageFilter.MaxFilter(radius * 2 + 1))


def erode(m, radius):
    return m.filter(ImageFilter.MinFilter(radius * 2 + 1))


def closing(m, radius):
    return erode(dilate(m, radius), radius)


def mask_any(m):
    return m.getbbox() is not None


def modal_colour(im):
    """Most common colour, quantised to 4 levels then refined.

    The median of a border ring is not safe here: the bottom margin of
    atsushi_sheet.png is filled with dirt, which drags the median off the real
    background colour.
    """
    px = list(im.getdata())
    key = Counter((r >> 2, g >> 2, b >> 2) for r, g, b in px)
    qr, qg, qb = key.most_common(1)[0][0]
    approx = (qr * 4 + 2, qg * 4 + 2, qb * 4 + 2)
    near = [p for p in px if max(abs(p[i] - approx[i]) for i in range(3)) <= 6]
    n = len(near)
    return tuple(sum(p[i] for p in near) / n for i in range(3))


# --------------------------------------------------------------------------
# the flood fill
# --------------------------------------------------------------------------

def gradient_edges(im, step):
    """Boolean lists: does this pixel connect to the one on its right / below?

    Built with ImageChops so the per-pixel work happens in C.
    """
    w, h = im.size

    def maxdiff(a, b):
        d = ImageChops.difference(a, b).split()
        return ImageChops.lighter(ImageChops.lighter(d[0], d[1]), d[2])

    right = maxdiff(im.crop((1, 0, w, h)), im.crop((0, 0, w - 1, h)))
    down = maxdiff(im.crop((0, 1, w, h)), im.crop((0, 0, w, h - 1)))
    thr = [0] * (step + 1) + [255] * (255 - step)
    return right.point(thr).getdata(), down.point(thr).getdata()


def background_mask(im, cfg):
    """Pixels reachable from a flat background region without crossing a hard edge."""
    w, h = im.size
    n = w * h
    bg = modal_colour(im)

    px = list(im.getdata())
    flat = [max(abs(p[i] - bg[i]) for i in range(3)) <= cfg["seed"] for p in px]
    seeds = erode(mask_from(im.size, flat), cfg["erode"])
    if not mask_any(seeds):
        # No flat region survived erosion; fall back to the crop border.
        seeds = Image.new("L", im.size)
        for x in range(w):
            seeds.putpixel((x, 0), 255)
            seeds.putpixel((x, h - 1), 255)
        for y in range(h):
            seeds.putpixel((0, y), 255)
            seeds.putpixel((w - 1, y), 255)

    right, down = gradient_edges(im, cfg["step"])

    # union-find over the pixel grid; find() is inlined for speed
    parent = list(range(n))

    def union(a, b):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        while parent[b] != b:
            parent[b] = parent[parent[b]]
            b = parent[b]
        if a != b:
            parent[b if b > a else a] = a if b > a else b

    for y in range(h):
        base = y * w
        rbase = y * (w - 1)
        for x in range(w - 1):
            if right[rbase + x]:
                union(base + x, base + x + 1)
    for y in range(h - 1):
        base = y * w
        for x in range(w):
            if down[base + x]:
                union(base + x, base + x + w)

    for i in range(n):
        r = i
        while parent[r] != r:
            parent[r] = parent[parent[r]]
            r = parent[r]
        parent[i] = r

    seed_roots = {parent[i] for i, s in enumerate(seeds.getdata()) if s}
    return mask_from(im.size, [parent[i] in seed_roots for i in range(n)]), bg, px


def fill_holes(fg):
    """Close off any region of the complement that does not touch the border."""
    w, h = fg.size
    inv = ImageChops.invert(fg)
    px = list(inv.getdata())
    n = w * h
    parent = list(range(n))

    def union(a, b):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        while parent[b] != b:
            parent[b] = parent[parent[b]]
            b = parent[b]
        if a != b:
            parent[b if b > a else a] = a if b > a else b

    for y in range(h):
        base = y * w
        for x in range(w - 1):
            if px[base + x] and px[base + x + 1]:
                union(base + x, base + x + 1)
    for y in range(h - 1):
        base = y * w
        for x in range(w):
            if px[base + x] and px[base + x + w]:
                union(base + x, base + x + w)
    for i in range(n):
        r = i
        while parent[r] != r:
            parent[r] = parent[parent[r]]
            r = parent[r]
        parent[i] = r

    outside = set()
    for x in range(w):
        if px[x]:
            outside.add(parent[x])
        if px[(h - 1) * w + x]:
            outside.add(parent[(h - 1) * w + x])
    for y in range(h):
        if px[y * w]:
            outside.add(parent[y * w])
        if px[y * w + w - 1]:
            outside.add(parent[y * w + w - 1])

    return mask_from(fg.size, [not px[i] or parent[i] not in outside for i in range(n)])


def components(mask):
    """Label the set pixels; return a list of (size, [indices])."""
    w, h = mask.size
    px = list(mask.getdata())
    n = w * h
    parent = list(range(n))

    def union(a, b):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        while parent[b] != b:
            parent[b] = parent[parent[b]]
            b = parent[b]
        if a != b:
            parent[b if b > a else a] = a if b > a else b

    for y in range(h):
        base = y * w
        for x in range(w):
            i = base + x
            if not px[i]:
                continue
            if x + 1 < w and px[i + 1]:
                union(i, i + 1)
            if y + 1 < h:
                if px[i + w]:
                    union(i, i + w)
                if x + 1 < w and px[i + w + 1]:
                    union(i, i + w + 1)
                if x > 0 and px[i + w - 1]:
                    union(i, i + w - 1)

    groups = {}
    for i in range(n):
        if not px[i]:
            continue
        r = i
        while parent[r] != r:
            parent[r] = parent[parent[r]]
            r = parent[r]
        groups.setdefault(r, []).append(i)
    return sorted(groups.values(), key=len, reverse=True)


# --------------------------------------------------------------------------
# one sprite
# --------------------------------------------------------------------------

def extract_pose(sheet, cfg, pose, report):
    x0, y0, x1, y1 = cfg["boxes"][pose]
    sw, sh = sheet.size

    limit = (0, sw)
    if cfg["panels"]:
        key = "swing" if pose.startswith("swing") else pose
        limit = cfg["panels"][key]

    cx0 = max(limit[0], x0 - PAD)
    cy0 = max(0, y0 - PAD)
    cx1 = min(limit[1], x1 + PAD)
    cy1 = min(sh, y1 + PAD)
    crop = sheet.crop((cx0, cy0, cx1, cy1))
    w, h = crop.size

    bgmask, bg, px = background_mask(crop, cfg)
    fg = ImageChops.invert(bgmask)
    fg = fill_holes(closing(fg, cfg["close"]))

    bx0, by0, bx1, by1 = x0 - cx0, y0 - cy0, x1 - cx0, y1 - cy0

    def overlap(idx):
        c = 0
        for i in idx:
            yy, xx = divmod(i, w)
            if bx0 <= xx < bx1 and by0 <= yy < by1:
                c += 1
        return c

    # The sheets draw a home plate and a chalk base line on the ground, and those
    # marks touch the shoes - so plain connectivity keeps them. They are thin and
    # the figure is not: eroding by SEVER dissolves the chalk line while the body
    # survives, and dilating the surviving core back cuts the marks loose, so the
    # component pass below discards them.
    #
    # This must run HERE, on the solid silhouette. After the punch pass below the
    # trousers are a lattice of outlines and shading, and eroding that removes the
    # legs entirely.
    core = erode(fg, SEVER)
    if mask_any(core):
        core_comps = components(core)
        if core_comps:
            body = max(core_comps, key=overlap)
            seed_flags = [False] * (w * h)
            for i in body:
                seed_flags[i] = True
            fg = mask_and(fg, dilate(mask_from(crop.size, seed_flags), SEVER + 1))

    # Re-open interior pockets that are simply background colour (armpit gaps),
    # and strip the warm dirt smudge that sits under the shoes inside the shoe
    # outline. Measured dirt is R-B = +39..+47 at luminance 128..150.
    lum = [0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2] for p in px]
    dirt_from = int(h * (1.0 - DIRT_BAND))
    keep = []
    for i, p in enumerate(px):
        if max(abs(p[j] - bg[j]) for j in range(3)) <= cfg["punch"]:
            keep.append(False)
            continue
        if i // w >= dirt_from and p[0] - p[2] > DIRT_WARM and lum[i] > DIRT_LUM:
            keep.append(False)
            continue
        keep.append(True)
    fg = mask_and(fg, mask_from(crop.size, keep))

    # The sheets also draw a home plate outline and a chalk base line on the
    # ground. Those are pale neutral strokes, and colour alone cannot separate
    # them from the white trousers - measured on takaya_sheet the chalk sits
    # 24..40 from the background and the trousers 16..55, so the ranges overlap.
    # Geometry separates them: down at ground level the only real content is the
    # shoes, so a pale neutral pixel that is not close to any dark shoe pixel in
    # its own row is ground marking, not uniform.
    ground_from = int(h * (1.0 - GROUND_BAND))
    fgpx = list(fg.getdata())
    for y in range(ground_from, h):
        row = y * w
        dark = [x for x in range(w) if fgpx[row + x] and lum[row + x] < GROUND_DARK]
        for x in range(w):
            i = row + x
            if not fgpx[i] or lum[i] < GROUND_PALE:
                continue
            p = px[i]
            if max(p) - min(p) > GROUND_NEUTRAL:
                continue
            if not any(abs(x - d) <= GROUND_REACH for d in dark):
                fgpx[i] = 0
    fg = mask_from(crop.size, [v != 0 for v in fgpx])

    comps = components(fg)
    if not comps:
        raise RuntimeError(f"{pose}: nothing survived extraction")

    # Keep ONLY the figure's own component. Every detached piece is either
    # debris from the punch pass or a bat belonging to the neighbouring frame,
    # and the measured boxes overlap, so "is it inside my box" cannot tell them
    # apart - connectivity can.
    main = max(comps, key=overlap)
    total_fg = sum(len(c) for c in comps)
    share = len(main) / total_fg
    if share < MAIN_MIN_SHARE:
        raise RuntimeError(
            f"{pose}: figure is only {share:.0%} of its own crop - the silhouette "
            f"probably fragmented, refusing to emit a broken sprite")
    dropped = len(comps) - 1

    flags = [False] * (w * h)
    for i in main:
        flags[i] = True
    final = mask_from(crop.size, flags)

    bbox = final.getbbox()
    sprite = Image.new("RGBA", (bbox[2] - bbox[0], bbox[3] - bbox[1]))
    sprite.paste(crop.crop(bbox), (0, 0))
    sprite.putalpha(final.crop(bbox))

    # ground contact point: x centroid of the lowest 5% of the silhouette
    am = list(final.crop(bbox).getdata())
    aw, ah = sprite.size
    rows = [y for y in range(ah) if any(am[y * aw + x] for x in range(aw))]
    low = rows[-1]
    band = max(rows[0], low - max(1, int(ah * 0.05)))
    xs = [x for y in range(band, low + 1) for x in range(aw) if am[y * aw + x]]
    anchor = [round(sum(xs) / len(xs)), low + 1]

    opaque = sum(1 for v in am if v)
    report.append({
        "pose": pose,
        "sheet_box": [cx0 + bbox[0], cy0 + bbox[1], cx0 + bbox[2], cy0 + bbox[3]],
        "size": [aw, ah],
        "opaque": opaque,
        "fill": round(opaque / (aw * ah) * 100, 1),
        "components_dropped": dropped,
        "anchor": anchor,
    })
    return sprite, anchor


# --------------------------------------------------------------------------
# faces
# --------------------------------------------------------------------------

def extract_faces():
    im = Image.open(os.path.join(SRC, FACE_FILE)).convert("RGB")
    px = list(im.getdata())
    w = im.width
    lum = [0.299 * r + 0.587 * g + 0.114 * b for r, g, b in px]
    sat = [max(p) - min(p) for p in px]
    ink = [lum[i] < 225 or sat[i] > 30 for i in range(len(px))]

    pw = (FACE_PANEL_X[1] - FACE_PANEL_X[0]) / 3.0
    os.makedirs(OUT_FACE, exist_ok=True)
    out = []
    for band, by0, by1, variants in FACE_BANDS:
        for pi, pid in enumerate(FACE_PEOPLE):
            px0 = FACE_PANEL_X[0] + pw * pi
            for vi, variant in enumerate(variants):
                a = int(round(px0 + pw * vi / len(variants))) + 4
                b = int(round(px0 + pw * (vi + 1) / len(variants))) - 4
                xs = [x for x in range(a, b)
                      if any(ink[y * w + x] for y in range(by0, by1))]
                ys = [y for y in range(by0, by1)
                      if any(ink[y * w + x] for x in range(a, b))]
                box = (xs[0], ys[0], xs[-1] + 1, ys[-1] + 1)
                im.crop(box).convert("RGBA").save(
                    os.path.join(OUT_FACE, f"{pid}_{variant}.png"))
                out.append((band, pid, variant, box))
    return out


# --------------------------------------------------------------------------

def main():
    if not os.path.isdir(SRC):
        sys.exit(f"missing source directory: {SRC}")

    anchors = {}
    total = 0
    for pid, cfg in SHEETS.items():
        path = os.path.join(SRC, cfg["file"])
        sheet = Image.open(path).convert("RGB")
        outdir = os.path.join(OUT_PLAYER, pid)
        os.makedirs(outdir, exist_ok=True)
        report = []
        print(f"\n{cfg['file']}  {sheet.width}x{sheet.height}  "
              f"step={cfg['step']} seed={cfg['seed']} punch={cfg['punch']}")
        for pose in POSES:
            sprite, anchor = extract_pose(sheet, cfg, pose, report)
            sprite.save(os.path.join(outdir, f"{pose}.png"))
            anchors[f"{pid}/{pose}"] = anchor
            total += 1
        for r in report:
            print(f"  {r['pose']:8s} {r['size'][0]:4d}x{r['size'][1]:4d}  "
                  f"opaque={r['opaque']:7d} fill={r['fill']:5.1f}%  "
                  f"anchor=({r['anchor'][0]:4d},{r['anchor'][1]:4d})  "
                  f"dropped={r['components_dropped']}")

    with open(os.path.join(OUT_PLAYER, "anchors.json"), "w", encoding="utf-8") as f:
        json.dump(anchors, f, indent=2, ensure_ascii=False)
        f.write("\n")

    faces = extract_faces()
    print(f"\nfaces.png -> {len(faces)} crops")
    for band, pid, variant, box in faces:
        print(f"  {band:11s} {pid}_{variant:9s} {box}  "
              f"{box[2]-box[0]:4d}x{box[3]-box[1]:4d}")

    print(f"\nwrote {total} player sprites + {len(faces)} faces")


if __name__ == "__main__":
    main()
