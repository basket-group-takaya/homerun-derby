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
  /** Vertical field of view [deg]. */
  readonly vfov: number;
};

export type Projected = {
  readonly x: number;
  readonly y: number;
  /** Distance along the view axis [m]. Negative means behind the camera. */
  readonly depth: number;
};

export type Viewport = { readonly width: number; readonly height: number };

export type Projector = {
  readonly project: (p: Vec3) => Projected | null;
  /** Screen pixels per metre at a given depth — used to size the ball. */
  readonly scaleAt: (depth: number) => number;
  readonly forward: Vec3;
};

const WORLD_UP = vec(0, 1, 0);

export const makeProjector = (camera: Camera, view: Viewport): Projector => {
  const forward = normalize(sub(camera.target, camera.eye));
  // right = up x forward. NOT forward x up: that mirrors the whole scene.
  const right = normalize(cross(WORLD_UP, forward));
  const up = cross(forward, right);
  const focal = (view.height / 2) / Math.tan((camera.vfov * Math.PI) / 360);

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

  return {
    project,
    scaleAt: (depth: number): number => focal / Math.max(depth, 0.01),
    forward,
  };
};

/** Move a camera toward another, for the pull-back when the ball is struck. */
export const lerpCamera = (a: Camera, b: Camera, f: number): Camera => ({
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
});

/** Smoothstep, so camera moves ease in and out instead of snapping. */
export const ease = (t: number): number => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

/**
 * Batting camera: first-base side and back toward the catcher.
 *
 * Pure side-on does not work — the strike zone collapses to zero width and the
 * meet cursor becomes unusable. See docs/SPEC.md 2-3.
 */
export const BATTING_CAMERA: Camera = {
  eye: vec(6.0, 2.2, -10.0),
  target: vec(0, 1.05, 2.5),
  vfov: 19,
};

/** Pulled back to watch the ball fly. */
export const FLIGHT_CAMERA: Camera = {
  eye: vec(9.0, 6.0, -16.0),
  target: vec(0, 6.0, 40.0),
  vfov: 46,
};

/** Follow a struck ball without letting it leave the frame. */
export const followCamera = (ball: Vec3): Camera => ({
  eye: vec(9.0 + ball.z * 0.05, 6.0 + ball.y * 0.28, -16.0 + ball.z * 0.16),
  target: vec(ball.x * 0.6, Math.max(4, ball.y * 0.7), ball.z * 0.85 + 12),
  vfov: 46,
});

export { scale };
