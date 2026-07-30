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

import type { Vec3 } from '../core/vec.js';
import { vec, add, sub, scale, cross, dot, normalize, length } from '../core/vec.js';
import type { Projector } from './camera.js';

export type RGB = readonly [number, number, number];

/** One flat convex face. Points must be given in a consistent winding. */
export type Quad = {
  readonly pts: readonly Vec3[];
  readonly colour: RGB;
  readonly normal: Vec3;
  /** Extra brightness, 0..1, for things that should read as emissive. */
  readonly glow?: number;
};

/** Direction the light comes FROM. Above, in front, and off to the side. */
export const LIGHT: Vec3 = normalize(vec(-0.42, 0.80, -0.44));

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
export const setFigureLight = (day: boolean): void => {
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

const shade = (colour: RGB, normal: Vec3, glow: number, toEye?: Vec3): string => {
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

// ---------------------------------------------------------------------------
// building solids
// ---------------------------------------------------------------------------

/** An orthonormal-ish frame: three axis vectors already scaled to half-extents. */
export type Frame = {
  readonly o: Vec3;
  readonly x: Vec3;
  readonly y: Vec3;
  readonly z: Vec3;
};

const corner = (f: Frame, sx: number, sy: number, sz: number): Vec3 => add(
  f.o,
  add(add(scale(f.x, sx), scale(f.y, sy)), scale(f.z, sz)),
);

/**
 * The six faces of a box.
 *
 * Winding is chosen so each face's normal points outward, which is what makes
 * back-face culling work — and culling is what stops the inside of the far side
 * of a limb from being painted over the near side.
 */
export const boxQuads = (f: Frame, colour: RGB, glow = 0): Quad[] => {
  const c = (sx: number, sy: number, sz: number): Vec3 => corner(f, sx, sy, sz);
  const face = (a: Vec3, b: Vec3, d: Vec3, e: Vec3): Quad => ({
    pts: [a, b, d, e],
    colour,
    normal: normalize(cross(sub(b, a), sub(d, b))),
    ...(glow > 0 ? { glow } : {}),
  });
  return [
    face(c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)),      // +x
    face(c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1), c(-1, -1, -1)),  // -x
    face(c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)),      // +y
    face(c(-1, -1, 1), c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1)),  // -y
    face(c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)),      // +z
    face(c(1, -1, -1), c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1)),  // -z
  ];
};

/**
 * A box spanning a to b, with the given half-thickness across.
 *
 * The workhorse: every limb, the torso and the bat are one of these. `across`
 * gives the perpendicular reference so a limb can be flattened in one axis
 * (a forearm is not square in section) without the caller doing basis maths.
 */
export const limbQuads = (
  a: Vec3, b: Vec3, halfWide: number, halfDeep: number, colour: RGB,
  across: Vec3 = vec(0, 1, 0), glow = 0,
): Quad[] => {
  const axis = sub(b, a);
  const len = length(axis);
  if (len < 1e-6) return [];
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
export const taperQuads = (
  a: Vec3, b: Vec3, halfA: number, halfB: number, colour: RGB,
  across: Vec3 = vec(0, 1, 0), sides = 4, squash = 1,
): Quad[] => {
  const axis = sub(b, a);
  const len = length(axis);
  if (len < 1e-6) return [];
  const dir = scale(axis, 1 / len);
  const reference = Math.abs(dot(dir, across)) > 0.94 ? vec(1, 0, 0) : across;
  const s = normalize(cross(reference, dir));
  const t = normalize(cross(dir, s));

  const n = Math.max(3, Math.round(sides));
  // start half a step round so a 4-sided prism still presents flat faces to the
  // world axes, which is what the torso and the bat want
  const offset = Math.PI / n;
  const ring = (at: Vec3, r: number): Vec3[] => {
    const out: Vec3[] = [];
    for (let i = 0; i < n; i++) {
      const th = offset + (i / n) * Math.PI * 2;
      out.push(add(at, add(
        scale(s, Math.cos(th) * r),
        scale(t, Math.sin(th) * r * squash))));
    }
    return out;
  };
  const lo = ring(a, halfA);
  const hi = ring(b, halfB);

  const quads: Quad[] = [];
  const push = (p: readonly Vec3[]): void => {
    quads.push({
      pts: p,
      colour,
      normal: normalize(cross(sub(p[1] as Vec3, p[0] as Vec3), sub(p[2] as Vec3, p[1] as Vec3))),
    });
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    push([lo[i] as Vec3, lo[j] as Vec3, hi[j] as Vec3, hi[i] as Vec3]);
  }
  push([...lo].reverse());
  push([...hi]);
  return quads;
};

/** How many faces a "round" mass gets. Twelve reads as curved; eight as cut. */
export const ROUND_SIDES = 12;

/** A rounded limb: a prism of constant thickness. */
export const roundLimb = (
  a: Vec3, b: Vec3, half: number, colour: RGB, across: Vec3 = vec(0, 1, 0), squash = 1,
): Quad[] => taperQuads(a, b, half, half, colour, across, ROUND_SIDES, squash);

/**
 * A low-poly ball, for a joint.
 *
 * Limbs meeting at a point leave a visible corner where one prism ends and the
 * next begins at a different angle — a knee that folds like a hinge rather than
 * bending like a knee. Dropping a ball in the gap fills it, and costs three
 * bands of quads. This is the single change that stopped the figure reading as
 * a robot, more than the extra sides did.
 */
export const jointQuads = (
  centre: Vec3, radius: number, colour: RGB, squash = 1,
): Quad[] => {
  const out: Quad[] = [];
  // three stacked bands: a sphere is overkill at this size, a cylinder is not
  // enough, and the middle band carries almost all of the silhouette
  const rings: readonly { readonly y: number; readonly r: number }[] = [
    { y: -0.82, r: 0.40 },
    { y: -0.34, r: 0.90 },
    { y: 0.34, r: 0.90 },
    { y: 0.82, r: 0.40 },
  ];
  for (let i = 0; i < rings.length - 1; i++) {
    const lo = rings[i] as { y: number; r: number };
    const hi = rings[i + 1] as { y: number; r: number };
    out.push(...taperQuads(
      add(centre, vec(0, lo.y * radius, 0)),
      add(centre, vec(0, hi.y * radius, 0)),
      lo.r * radius, hi.r * radius, colour, vec(1, 0, 0), ROUND_SIDES, squash));
  }
  return out;
};

// ---------------------------------------------------------------------------
// rotation
// ---------------------------------------------------------------------------

/** Rotate v about the world y axis by `radians`, around the point `about`. */
export const yawAbout = (v: Vec3, about: Vec3, radians: number): Vec3 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const dx = v.x - about.x;
  const dz = v.z - about.z;
  return vec(about.x + dx * c - dz * s, v.y, about.z + dx * s + dz * c);
};

/** Rotate every point of every quad about the world y axis. */
export const yawQuads = (quads: readonly Quad[], about: Vec3, radians: number): Quad[] =>
  quads.map((q) => ({
    ...q,
    pts: q.pts.map((p) => yawAbout(p, about, radians)),
    normal: yawAbout(q.normal, vec(0, 0, 0), radians),
  }));

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------

const centroid = (pts: readonly Vec3[]): Vec3 => {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of pts) { x += p.x; y += p.y; z += p.z; }
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
export const drawQuads = (
  ctx: CanvasRenderingContext2D, p: Projector, quads: readonly Quad[],
): void => {
  type Ready = { readonly quad: Quad; readonly depth: number; readonly toEye: Vec3 };
  const ready: Ready[] = [];
  for (const quad of quads) {
    const mid = centroid(quad.pts);
    const toFace = sub(mid, p.eye);
    // back-face cull; a small bias keeps edge-on faces from flickering
    if (dot(quad.normal, toFace) > -1e-4) continue;
    const depth = dot(toFace, p.forward);
    if (depth <= 0.02) continue;
    // unit vector from the face toward the eye, for the rim term
    ready.push({ quad, depth, toEye: normalize(scale(toFace, -1)) });
  }
  ready.sort((a, b) => b.depth - a.depth);

  for (const { quad, toEye } of ready) {
    const poly = p.projectPolygon(quad.pts);
    if (!poly) continue;
    ctx.beginPath();
    poly.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    ctx.closePath();
    ctx.fillStyle = shade(quad.colour, quad.normal, quad.glow ?? 0, toEye);
    ctx.fill();
    // A hairline stroke in the same colour closes the seams between adjacent
    // faces. Without it, antialiasing leaves bright cracks along every edge.
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1;
    ctx.stroke();
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
export const drawOutline = (
  ctx: CanvasRenderingContext2D, p: Projector, quads: readonly Quad[],
  colour: string, expand: number,
): void => {
  type Ready = { readonly quad: Quad; readonly depth: number };
  const ready: Ready[] = [];
  for (const quad of quads) {
    const mid = centroid(quad.pts);
    const toFace = sub(mid, p.eye);
    // the opposite test to drawQuads: keep what it discards
    if (dot(quad.normal, toFace) <= 1e-4) continue;
    const depth = dot(toFace, p.forward);
    if (depth <= 0.02) continue;
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
    if (!poly) continue;
    ctx.beginPath();
    poly.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
};

/** A soft elliptical shadow on the ground under a point. */
export const drawGroundShadow = (
  ctx: CanvasRenderingContext2D, p: Projector, at: Vec3, radius: number, alpha: number,
): void => {
  const centre = p.project(vec(at.x, 0.01, at.z));
  const edge = p.project(vec(at.x + radius, 0.01, at.z));
  if (!centre || !edge) return;
  const r = Math.abs(edge.x - centre.x);
  if (r < 1) return;
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
