/**
 * Perspective camera and projection.
 *
 * The handedness of the screen-right basis vector was got wrong three times by
 * hand during design, so it is nailed down by tests/projection.test.ts:
 * from behind the catcher looking at the pitcher, first base MUST be on the
 * right of frame. Do not "simplify" the cross product below.
 */

import type { Vec3 } from '../core/vec.js';
import { vec, sub, cross, dot, normalize, scale } from '../core/vec.js';

export type Camera = {
  readonly eye: Vec3;
  readonly target: Vec3;
  /** Vertical field of view [deg]. Ignored when `hfov` is set. */
  readonly vfov: number;
  /**
   * Horizontal field of view [deg]. When present the focal length is derived
   * from the viewport WIDTH instead of its height.
   *
   * This exists because the game is portrait and phones are not all the same
   * shape: 19.5:9, 20:9 and 16:9 all ship. Pinning the vertical angle would make
   * the strike zone a different width on every handset, and the zone's apparent
   * width IS the aiming precision — so it is the horizontal angle that must be
   * constant and the vertical one that gives way. Taller phones simply see more
   * sky and more grass.
   */
  readonly hfov?: number;
};

export type Projected = {
  readonly x: number;
  readonly y: number;
  /** Distance along the view axis [m]. Negative means behind the camera. */
  readonly depth: number;
};

export type Viewport = { readonly width: number; readonly height: number };

export type Point2 = { readonly x: number; readonly y: number };

export type Projector = {
  /**
   * Everything this projector depends on, as a string.
   *
   * Exists so a caller can tell whether the view has changed since it last drew
   * something, without comparing floats itself and without guessing which parts
   * of the camera matter. It is built from the whole Camera and the whole
   * Viewport, so a new field on Camera cannot silently fall out of the key and
   * leave a cache serving a stale frame.
   */
  readonly key: string;
  readonly project: (p: Vec3) => Projected | null;
  /** Screen pixels per metre at a given depth — used to size the ball. */
  readonly scaleAt: (depth: number) => number;
  readonly forward: Vec3;
  readonly eye: Vec3;
  /**
   * Project a polygon, clipping it against the near plane first.
   *
   * Necessary, not decorative. The follow camera ends up downfield of home
   * plate, and the grass polygon has a vertex AT home plate — so that vertex
   * goes behind the eye. Dropping behind-camera vertices (the obvious thing)
   * silently changes the shape of the polygon, and the symptom is the sky
   * showing through the outfield in stripes. Clipping produces the correct
   * silhouette instead.
   */
  readonly projectPolygon: (pts: readonly Vec3[]) => Point2[] | null;
};

/** Distance in front of the eye that geometry is clipped at [m]. */
const NEAR = 0.05;

const WORLD_UP = vec(0, 1, 0);

export const makeProjector = (camera: Camera, view: Viewport): Projector => {
  const forward = normalize(sub(camera.target, camera.eye));
  // right = up x forward. NOT forward x up: that mirrors the whole scene.
  const right = normalize(cross(WORLD_UP, forward));
  const up = cross(forward, right);
  const focal = camera.hfov !== undefined
    ? (view.width / 2) / Math.tan((camera.hfov * Math.PI) / 360)
    : (view.height / 2) / Math.tan((camera.vfov * Math.PI) / 360);

  const project = (p: Vec3): Projected | null => {
    const d = sub(p, camera.eye);
    const depth = dot(d, forward);
    if (depth <= 0.01) return null;
    return {
      x: view.width / 2 + (focal * dot(d, right)) / depth,
      y: view.height / 2 - (focal * dot(d, up)) / depth,
      depth,
    };
  };

  /** Signed distance in front of the near plane. */
  const ahead = (p: Vec3): number => dot(sub(p, camera.eye), forward) - NEAR;

  /** Sutherland-Hodgman against the single near plane. */
  const projectPolygon = (pts: readonly Vec3[]): Point2[] | null => {
    if (pts.length < 3) return null;
    const kept: Vec3[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (!a || !b) continue;
      const da = ahead(a);
      const db = ahead(b);
      if (da >= 0) kept.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        kept.push(vec(
          a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t));
      }
    }
    if (kept.length < 3) return null;
    const out: Point2[] = [];
    for (const v of kept) {
      const s = project(v);
      if (s) out.push({ x: s.x, y: s.y });
    }
    return out.length >= 3 ? out : null;
  };

  return {
    project,
    scaleAt: (depth: number): number => focal / Math.max(depth, 0.01),
    key: [
      camera.eye.x, camera.eye.y, camera.eye.z,
      camera.target.x, camera.target.y, camera.target.z,
      camera.vfov, camera.hfov ?? -1, view.width, view.height,
    ].map((n) => n.toFixed(4)).join(','),
    forward,
    eye: camera.eye,
    projectPolygon,
  };
};

/** Move a camera toward another, for the pull-back when the ball is struck. */
export const lerpCamera = (a: Camera, b: Camera, f: number): Camera => {
  const base = {
    eye: {
      x: a.eye.x + (b.eye.x - a.eye.x) * f,
      y: a.eye.y + (b.eye.y - a.eye.y) * f,
      z: a.eye.z + (b.eye.z - a.eye.z) * f,
    },
    target: {
      x: a.target.x + (b.target.x - a.target.x) * f,
      y: a.target.y + (b.target.y - a.target.y) * f,
      z: a.target.z + (b.target.z - a.target.z) * f,
    },
    vfov: a.vfov + (b.vfov - a.vfov) * f,
  };
  const ah = a.hfov;
  const bh = b.hfov;
  // interpolate whichever angle both ends agree on; mixing the two mid-cut would
  // make the field of view jump at the seam
  if (ah !== undefined && bh !== undefined) return { ...base, hfov: ah + (bh - ah) * f };
  return base;
};

/** Smoothstep, so camera moves ease in and out instead of snapping. */
export const ease = (t: number): number => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

/**
 * Pitch camera: over the batter's shoulder, down the plate-to-mound axis.
 *
 * docs/REFERENCE-HB2.md 3 and 10. The genre puts the meet cursor in the middle
 * of frame, which only works if the strike zone is seen face-on — that means
 * standing behind the plate. Tuned against tests/projection.test.ts, which pins
 * the composition (zone near centre, pitcher above it, first base to the right).
 * The numbers came out of scripts/camera-check.ts, not out of arithmetic by hand.
 */
export const PITCH_CAMERA: Camera = {
  // Measured against real Homerun Battle 2 footage rather than guessed
  // (docs/REFERENCE-HB2.md 3-1). Three numbers matter and all three were wrong:
  //
  //   height  — the reference camera is LOW, roughly chest height, so the
  //             outfield wall sits near the middle of frame. Ours looked down
  //             from above with the wall at 17% and a large empty green middle,
  //             which is most of what made the composition feel unrelated.
  //   hfov    — the reference is very wide (both foul poles are in frame at
  //             once, so about 90 degrees in landscape). Ours was 15.2, a
  //             telephoto crop of the same geometry.
  //   pitch   — level, not tilted down. A level camera puts the wall at the
  //             horizon and the plate at the bottom edge, which is the framing.
  //
  // 34 degrees is the portrait compromise: a 90-degree horizontal angle would
  // need a 120-degree vertical one on a 9:20 screen. At 34 the strike zone is
  // about 27% of the width, which is close to what the reference gives.
  // z is far enough back that the batter — now a real 3D figure standing at
  // x=-0.72 — comes out at 51% of frame height, which is what the reference
  // footage measures (docs/REFERENCE-HB2.md 3-1). At -2.60 he was 87% and
  // covered the strike zone.
  eye: vec(-0.10, 1.32, -5.05),
  target: vec(-0.10, 1.30, 9.00),
  vfov: 26,
  hfov: 34,
};

/**
 * Impact camera: the old side view, now used only for the 0.28 s cut that shows
 * the swing frames. docs/REFERENCE-HB2.md 10 — the five swing sprites are worth
 * more as a punctuation mark than as a continuous animation nobody looks at.
 */
export const SWING_CAMERA: Camera = {
  eye: vec(5.2, 2.05, -8.2),
  target: vec(-1.50, 1.08, 2.2),
  vfov: 19,
  hfov: 16.0,
};

/** Kept under the old name: several call sites and tests still use it. */
export const BATTING_CAMERA = SWING_CAMERA;

/** Pulled back to watch the ball fly. */
export const FLIGHT_CAMERA: Camera = {
  eye: vec(9.0, 6.0, -16.0),
  target: vec(0, 8.0, 40.0),
  vfov: 46,
  hfov: 32,
};

/**
 * Follow a struck ball without letting it leave the frame.
 *
 * The camera trails the ball rather than tracking it exactly: a rigid lock makes
 * the ball look motionless and the stadium look like it is being dragged past.
 */
export const followCamera = (ball: Vec3): Camera => ({
  eye: vec(9.0 + ball.z * 0.05, 6.0 + ball.y * 0.30, -16.0 + ball.z * 0.16),
  target: vec(ball.x * 0.62, Math.max(5, ball.y * 0.72), ball.z * 0.86 + 14),
  vfov: 46,
  hfov: 32,
});

// ---------------------------------------------------------------------------
// shake
// ---------------------------------------------------------------------------

export type Shake = { readonly x: number; readonly y: number };

/**
 * Displace a camera by a screen-space shake, in metres at the target plane.
 *
 * Shake is applied to eye AND target together, so the camera translates rather
 * than rotates: rotating the view swings distant objects wildly while leaving
 * near ones still, which reads as a camera fault instead of an impact.
 */
export const shakeCamera = (camera: Camera, s: Shake): Camera => {
  if (s.x === 0 && s.y === 0) return camera;
  const forward = normalize(sub(camera.target, camera.eye));
  const right = normalize(cross(WORLD_UP, forward));
  const up = cross(forward, right);
  const dx = {
    x: right.x * s.x + up.x * s.y,
    y: right.y * s.x + up.y * s.y,
    z: right.z * s.x + up.z * s.y,
  };
  const moved = {
    eye: vec(camera.eye.x + dx.x, camera.eye.y + dx.y, camera.eye.z + dx.z),
    target: vec(camera.target.x + dx.x, camera.target.y + dx.y, camera.target.z + dx.z),
    vfov: camera.vfov,
  };
  return camera.hfov === undefined ? moved : { ...moved, hfov: camera.hfov };
};

// ---------------------------------------------------------------------------
// the cut sequence
// ---------------------------------------------------------------------------

/** How long the pitch camera holds after contact [s]. */
export const CUT_HOLD_END = 0.16;
/** How long the pull-back to the flight view takes [s]. */
export const CUT_PULLBACK_END = 0.55;

/**
 * Camera for a struck ball, t seconds after contact.
 *
 * It stays where it was and then pulls back. It used to cut to SWING_CAMERA on
 * the first-base side for 0.3 s so the five side-on swing sprites could play,
 * and that cut is what produced the worst bug in the build: the batter appeared
 * on one side of the plate during the pitch and the other side at contact, so he
 * read as standing in the left-handed box and then teleporting into the
 * right-handed one. The reference game never leaves the pitch camera during a
 * swing (docs/REFERENCE-HB2.md 3-1), and neither does this now.
 */
export const cameraAfterContact = (t: number, ball: Vec3): Camera => {
  if (t <= CUT_HOLD_END) return PITCH_CAMERA;
  if (t >= CUT_PULLBACK_END) return followCamera(ball);
  const f = ease((t - CUT_HOLD_END) / (CUT_PULLBACK_END - CUT_HOLD_END));
  return lerpCamera(PITCH_CAMERA, followCamera(ball), f);
};

export { scale };
