/**
 * A small software 3D renderer: flat-shaded convex quads, depth-sorted.
 *
 * PROMPT.md 1 forbids 3D libraries and bundlers. It does not forbid doing the
 * maths, and the projection machinery this needs already exists in camera.ts —
 * perspective projection with near-plane clipping. What is added here is volume:
 * boxes built along a segment, face normals, a light, back-face culling and a
 * painter's-algorithm sort.
 *
 * Why bother, when there are hand-drawn sprites. Because a sprite is a picture
 * taken from ONE viewpoint, so any camera that is not that viewpoint contradicts
 * it — which is exactly the bug that kept returning: the batter looked the wrong
 * way, or changed batter's box at contact, or held two bats. A figure that
 * actually exists in the world cannot do any of those things; the geometry
 * decides what you see. The reference game (docs/REFERENCE-HB2.md) is low-poly
 * flat-shaded 3D for the same reason.
 *
 * Read-only with respect to game state (PROMPT.md 2).
 */
import { vec, add, sub, scale, cross, dot, normalize, length } from '../core/vec.js';
/** Direction the light comes FROM. Above, in front, and off to the side. */
export const LIGHT = normalize(vec(-0.42, 0.80, -0.44));
// Lower ambient and higher diffuse than looks "safe". At 0.52/0.48 adjacent
// faces of the same box differed by too little and the figure read as a flat
// silhouette; the whole reason for building a solid is that its faces catch the
// light differently, and that has to be visible.
/*
 * Ambient and diffuse, and why they are not constants any more.
 *
 * Under floodlights a figure is lit from a few hard sources and the shaded side
 * goes dark; in daylight the sky is a giant soft source and the shaded side is
 * still bright. Keeping the night values for a day game gives figures that look
 * like cardboard cut-outs pasted onto a bright photograph — lit for a different
 * scene, which is exactly what they would be.
 */
let AMBIENT = 0.46;
let DIFFUSE = 0.58;
/** Light the figures for the time of day. Called once per frame, before drawing. */
export const setFigureLight = (day) => {
    AMBIENT = day ? 0.62 : 0.46;
    DIFFUSE = day ? 0.46 : 0.58;
};
/**
 * Wrap lighting: how far the light bends round the shaded side, 0 to 1.
 *
 * Plain Lambert cuts to black at 90 degrees, so on a low-poly limb the last lit
 * facet sits hard against the first dark one and the eye reads the crease as an
 * edge — which is most of why the figure looked machined. Wrapping the falloff
 * past the terminator softens every crease at once without adding a polygon,
 * and it is what skin and cloth actually do: light scatters inside them.
 */
const WRAP = 0.45;
/**
 * Rim light: how much brighter a surface gets as it turns edge-on to the eye.
 *
 * The cheapest thing on this list that reads as "lit by a stadium rather than by
 * a flat fill". A real figure under floodlights picks up a bright fringe wherever
 * it curves away from the camera, because at that angle it is catching light from
 * everywhere except in front. One dot product per face buys most of it.
 *
 * It is deliberately strongest at the silhouette and absent face-on, so it adds
 * shape rather than brightness — turning it up washes the figure out instead of
 * making it rounder, which is the failure mode to watch for.
 */
const RIM = 0.34;
const RIM_POWER = 3.0;
/**
 * How nearly parallel two faces must be before the seam between them is smoothed.
 *
 * cos 50 degrees. A twelve-sided limb turns 30 degrees per face and a
 * eight-sided one 45, so both round off; a four-sided torso or bat turns 90 and
 * keeps its corners. That distinction is the whole point — smoothing everything
 * turns boxes into pillows, and smoothing nothing is what made the figure look
 * machined. The rule is per EDGE, not per object, so one solid can have round
 * sides and sharp caps, which is what a real limb looks like.
 */
const SMOOTH_LIMIT = 0.643;
const shade = (colour, normal, glow, toEye) => {
    const raw = dot(normal, LIGHT);
    const lambert = Math.max(0, (raw + WRAP) / (1 + WRAP));
    let rim = 0;
    if (toEye) {
        const facing = Math.abs(dot(normal, toEye));
        rim = RIM * Math.pow(1 - Math.min(1, facing), RIM_POWER);
    }
    const k = Math.min(1.45, AMBIENT + DIFFUSE * lambert + rim + glow);
    const r = Math.min(255, Math.round(colour[0] * k));
    const g = Math.min(255, Math.round(colour[1] * k));
    const b = Math.min(255, Math.round(colour[2] * k));
    return `rgb(${r},${g},${b})`;
};
const corner = (f, sx, sy, sz) => add(f.o, add(add(scale(f.x, sx), scale(f.y, sy)), scale(f.z, sz)));
/**
 * The six faces of a box.
 *
 * Winding is chosen so each face's normal points outward, which is what makes
 * back-face culling work — and culling is what stops the inside of the far side
 * of a limb from being painted over the near side.
 */
export const boxQuads = (f, colour, glow = 0) => {
    const c = (sx, sy, sz) => corner(f, sx, sy, sz);
    const face = (a, b, d, e) => ({
        pts: [a, b, d, e],
        colour,
        normal: normalize(cross(sub(b, a), sub(d, b))),
        ...(glow > 0 ? { glow } : {}),
    });
    return [
        face(c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)), // +x
        face(c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1), c(-1, -1, -1)), // -x
        face(c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)), // +y
        face(c(-1, -1, 1), c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1)), // -y
        face(c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)), // +z
        face(c(1, -1, -1), c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1)), // -z
    ];
};
/**
 * A box spanning a to b, with the given half-thickness across.
 *
 * The workhorse: every limb, the torso and the bat are one of these. `across`
 * gives the perpendicular reference so a limb can be flattened in one axis
 * (a forearm is not square in section) without the caller doing basis maths.
 */
export const limbQuads = (a, b, halfWide, halfDeep, colour, across = vec(0, 1, 0), glow = 0) => {
    const axis = sub(b, a);
    const len = length(axis);
    if (len < 1e-6)
        return [];
    const dir = scale(axis, 1 / len);
    // pick a reference that is not parallel to the limb
    const reference = Math.abs(dot(dir, across)) > 0.94 ? vec(1, 0, 0) : across;
    const side = normalize(cross(reference, dir));
    const other = normalize(cross(dir, side));
    return boxQuads({
        o: scale(add(a, b), 0.5),
        x: scale(side, halfWide),
        y: scale(dir, len / 2),
        z: scale(other, halfDeep),
    }, colour, glow);
};
/**
 * A tapered prism from a to b, with `sides` faces around its axis.
 *
 * sides = 4 gives a box; sides = 8 gives something that reads as round. That
 * single parameter is most of the difference between a figure that looks like a
 * stack of crates and one that looks like a low-poly person — eight faces around
 * a limb means at any angle two or three of them catch the light differently,
 * and the eye reads the gradient as curvature.
 */
export const taperQuads = (a, b, halfA, halfB, colour, across = vec(0, 1, 0), sides = 4, squash = 1) => {
    const axis = sub(b, a);
    const len = length(axis);
    if (len < 1e-6)
        return [];
    const dir = scale(axis, 1 / len);
    const reference = Math.abs(dot(dir, across)) > 0.94 ? vec(1, 0, 0) : across;
    const s = normalize(cross(reference, dir));
    const t = normalize(cross(dir, s));
    const n = Math.max(3, Math.round(sides));
    // start half a step round so a 4-sided prism still presents flat faces to the
    // world axes, which is what the torso and the bat want
    const offset = Math.PI / n;
    const ring = (at, r) => {
        const out = [];
        for (let i = 0; i < n; i++) {
            const th = offset + (i / n) * Math.PI * 2;
            out.push(add(at, add(scale(s, Math.cos(th) * r), scale(t, Math.sin(th) * r * squash))));
        }
        return out;
    };
    const lo = ring(a, halfA);
    const hi = ring(b, halfB);
    const faceNormal = (p) => normalize(cross(sub(p[1], p[0]), sub(p[2], p[1])));
    // Every side face is built first, because a face cannot know how to shade its
    // own edges until it knows which way its neighbours are pointing.
    const sides_ = [];
    const normals = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const p = [lo[i], lo[j], hi[j], hi[i]];
        sides_.push(p);
        normals.push(faceNormal(p));
    }
    const quads = [];
    for (let i = 0; i < n; i++) {
        const self = normals[i];
        const prev = normals[(i - 1 + n) % n];
        const next = normals[(i + 1) % n];
        // Only average across a seam the eye should not see. A sharp corner that
        // gets smoothed reads as a dent, which is worse than the facet it replaced.
        const left = dot(self, prev) > SMOOTH_LIMIT ? normalize(add(self, prev)) : self;
        const right = dot(self, next) > SMOOTH_LIMIT ? normalize(add(self, next)) : self;
        quads.push({
            pts: sides_[i],
            colour,
            normal: self,
            ...(left === self && right === self ? {} : { edge: [left, right] }),
        });
    }
    // The caps stay flat: they are flat.
    const cap = (p) => {
        quads.push({ pts: p, colour, normal: faceNormal(p) });
    };
    cap([...lo].reverse());
    cap([...hi]);
    return quads;
};
/** How many faces a "round" mass gets. Twelve reads as curved; eight as cut. */
export const ROUND_SIDES = 12;
/** A rounded limb: a prism of constant thickness. */
export const roundLimb = (a, b, half, colour, across = vec(0, 1, 0), squash = 1) => taperQuads(a, b, half, half, colour, across, ROUND_SIDES, squash);
/**
 * A low-poly ball, for a joint.
 *
 * Limbs meeting at a point leave a visible corner where one prism ends and the
 * next begins at a different angle — a knee that folds like a hinge rather than
 * bending like a knee. Dropping a ball in the gap fills it, and costs three
 * bands of quads. This is the single change that stopped the figure reading as
 * a robot, more than the extra sides did.
 */
export const jointQuads = (centre, radius, colour, squash = 1) => {
    const out = [];
    // three stacked bands: a sphere is overkill at this size, a cylinder is not
    // enough, and the middle band carries almost all of the silhouette
    const rings = [
        { y: -0.82, r: 0.40 },
        { y: -0.34, r: 0.90 },
        { y: 0.34, r: 0.90 },
        { y: 0.82, r: 0.40 },
    ];
    for (let i = 0; i < rings.length - 1; i++) {
        const lo = rings[i];
        const hi = rings[i + 1];
        out.push(...taperQuads(add(centre, vec(0, lo.y * radius, 0)), add(centre, vec(0, hi.y * radius, 0)), lo.r * radius, hi.r * radius, colour, vec(1, 0, 0), ROUND_SIDES, squash));
    }
    return out;
};
// ---------------------------------------------------------------------------
// rotation
// ---------------------------------------------------------------------------
/** Rotate v about the world y axis by `radians`, around the point `about`. */
export const yawAbout = (v, about, radians) => {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    const dx = v.x - about.x;
    const dz = v.z - about.z;
    return vec(about.x + dx * c - dz * s, v.y, about.z + dx * s + dz * c);
};
/** Rotate every point of every quad about the world y axis. */
export const yawQuads = (quads, about, radians) => quads.map((q) => ({
    ...q,
    pts: q.pts.map((p) => yawAbout(p, about, radians)),
    normal: yawAbout(q.normal, vec(0, 0, 0), radians),
    // The edge normals are directions too, and forgetting to turn them leaves a
    // figure whose shading stays pointing the way it faced before it moved.
    ...(q.edge
        ? {
            edge: [
                yawAbout(q.edge[0], vec(0, 0, 0), radians),
                yawAbout(q.edge[1], vec(0, 0, 0), radians),
            ],
        }
        : {}),
}));
// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------
const centroid = (pts) => {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const p of pts) {
        x += p.x;
        y += p.y;
        z += p.z;
    }
    const n = pts.length || 1;
    return vec(x / n, y / n, z / n);
};
/**
 * Draw a set of quads: cull the ones facing away, sort far-to-near, fill.
 *
 * Painter's algorithm on face centroids. It is not a depth buffer and it can be
 * fooled by long interpenetrating faces, but the figures here are convex limbs
 * of similar size, which is the case it handles correctly. A per-pixel depth
 * test would mean writing a rasteriser, and Canvas 2D fill is hardware-assisted
 * where a hand-written rasteriser would not be.
 */
/**
 * Half a pixel of overlap between neighbouring faces, to hide the seam.
 *
 * Two polygons that share an edge do NOT meet cleanly when antialiased: each
 * covers about half of the boundary pixel and blends with what is behind it, so
 * a bright crack runs along every edge of the figure. The old fix was to stroke
 * each face in its own fill colour, and it worked — but measurement put it at
 * 60% of the whole frame, because a stroke rasterises a second time round the
 * path. Pushing the corners out instead costs four multiplies per vertex.
 *
 * Outward is "away from the centroid", which is well defined here because every
 * face is convex. The push is a fixed number of pixels rather than a percentage
 * so that distant faces, which is where cracks are worst, get the same cover.
 */
const SEAM_PAD = 0.5;
const inflate = (poly) => {
    let cx = 0;
    let cy = 0;
    for (const q of poly) {
        cx += q.x;
        cy += q.y;
    }
    cx /= poly.length;
    cy /= poly.length;
    return poly.map((q) => {
        const dx = q.x - cx;
        const dy = q.y - cy;
        const d = Math.hypot(dx, dy);
        if (d < 1e-6)
            return q;
        const k = (d + SEAM_PAD) / d;
        return { x: cx + dx * k, y: cy + dy * k };
    });
};
/**
 * A fill that varies across the face: Gouraud shading, drawn with a gradient.
 *
 * This is the single change that separates "a solid built out of flat panels"
 * from "a rounded object". Flat shading gives every face one colour, so a
 * twelve-sided arm is twelve visible strips no matter how many sides it has —
 * adding polygons only makes the strips narrower. Interpolating the shade
 * ACROSS each face instead makes the seams disappear, and twelve sides then
 * read as a cylinder.
 *
 * The endpoints are the midpoints of the two side edges, projected. They are
 * projected separately rather than taken from the clipped polygon because
 * near-plane clipping changes the point list, and a gradient anchored to
 * clipped corners slides as the camera moves.
 *
 * Returns null when the face is edge-on — a zero-length gradient paints nothing
 * at all in Canvas 2D, which would punch a hole in the figure.
 */
const gradientAcross = (ctx, p, quad, edge, glow, toEye) => {
    const pts = quad.pts;
    if (pts.length < 4)
        return null;
    const mid = (a, b) => scale(add(a, b), 0.5);
    const a = p.project(mid(pts[0], pts[3]));
    const b = p.project(mid(pts[1], pts[2]));
    if (!a || !b)
        return null;
    if (Math.abs(a.x - b.x) < 0.4 && Math.abs(a.y - b.y) < 0.4)
        return null;
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    g.addColorStop(0, shade(quad.colour, edge[0], glow, toEye));
    g.addColorStop(0.5, shade(quad.colour, quad.normal, glow, toEye));
    g.addColorStop(1, shade(quad.colour, edge[1], glow, toEye));
    return g;
};
export const drawQuads = (ctx, p, quads) => {
    const ready = [];
    for (const quad of quads) {
        const mid = centroid(quad.pts);
        const toFace = sub(mid, p.eye);
        // back-face cull; a small bias keeps edge-on faces from flickering
        if (dot(quad.normal, toFace) > -1e-4)
            continue;
        const depth = dot(toFace, p.forward);
        if (depth <= 0.02)
            continue;
        // unit vector from the face toward the eye, for the rim term
        ready.push({ quad, depth, toEye: normalize(scale(toFace, -1)) });
    }
    ready.sort((a, b) => b.depth - a.depth);
    for (const { quad, toEye } of ready) {
        const poly = p.projectPolygon(quad.pts);
        if (!poly)
            continue;
        ctx.beginPath();
        const grown = inflate(poly);
        grown.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
        ctx.closePath();
        const glow = quad.glow ?? 0;
        const flat = shade(quad.colour, quad.normal, glow, toEye);
        ctx.fillStyle = quad.edge
            ? gradientAcross(ctx, p, quad, quad.edge, glow, toEye) ?? flat
            : flat;
        ctx.fill();
    }
};
/**
 * A dark rim around a figure's silhouette: the inverted-hull outline.
 *
 * The look the owner asked for — 「輪郭だけパワプロ的に」 — and the reason it is
 * worth having is readability rather than style: a figure the colour of the
 * night sky standing in front of a night sky has no edge, and in daylight the
 * navy uniform sits on green grass with nothing between them.
 *
 * How it works. drawQuads keeps the faces pointing TOWARD the eye and throws
 * away the ones pointing away. This keeps exactly the ones it throws away, pushes
 * each a centimetre along its own outward normal, and fills them dark. The
 * result is a slightly larger copy of the figure drawn behind it, so the only
 * part that survives is the fringe around the silhouette — the interior edges
 * are covered by the figure itself, which is what stops it looking like a
 * wireframe.
 *
 * Must be drawn BEFORE the figure. It is a shell, not a stroke.
 */
export const drawOutline = (ctx, p, quads, colour, expand) => {
    const ready = [];
    for (const quad of quads) {
        const mid = centroid(quad.pts);
        const toFace = sub(mid, p.eye);
        // the opposite test to drawQuads: keep what it discards
        if (dot(quad.normal, toFace) <= 1e-4)
            continue;
        const depth = dot(toFace, p.forward);
        if (depth <= 0.02)
            continue;
        ready.push({ quad, depth });
    }
    ready.sort((a, b) => b.depth - a.depth);
    ctx.save();
    ctx.fillStyle = colour;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    for (const { quad } of ready) {
        const grown = quad.pts.map((v) => add(v, scale(quad.normal, expand)));
        const poly = p.projectPolygon(grown);
        if (!poly)
            continue;
        ctx.beginPath();
        // Same seam padding as the figure itself. The outline is one flat colour, so
        // the only thing showing through its cracks is the background — which is
        // exactly what an outline exists to keep out.
        inflate(poly).forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
};
/** A soft elliptical shadow on the ground under a point. */
export const drawGroundShadow = (ctx, p, at, radius, alpha) => {
    const centre = p.project(vec(at.x, 0.01, at.z));
    const edge = p.project(vec(at.x + radius, 0.01, at.z));
    if (!centre || !edge)
        return;
    const r = Math.abs(edge.x - centre.x);
    if (r < 1)
        return;
    const g = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, r);
    g.addColorStop(0, `rgba(0,0,0,${alpha})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(centre.x, centre.y);
    ctx.scale(1, 0.34);
    ctx.translate(-centre.x, -centre.y);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
};
//# sourceMappingURL=figure.js.map