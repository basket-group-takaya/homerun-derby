/**
 * The pitcher, as a solid figure standing on the mound.
 *
 * He was a jointed silhouette drawn straight into screen space: black lines
 * whose joints were fractions of his on-screen height. That worked from exactly
 * one camera and, being a flat cut-out, could never show which way he was
 * facing — the same defect that kept breaking the batter, and the reason the
 * owner asked for both of them in 3D rather than one.
 *
 * Everything here is built in world metres and projected, so the delivery is
 * correct from any camera the game chooses, and the ball leaves his hand at the
 * point the physics says it does rather than near it.
 *
 * WHICH WAY HE FACES. He stands on the rubber at z = MOUND_DISTANCE looking at
 * home, so his forward is world -z. His right hand is therefore on the world -x
 * side (cross(up, forward) = cross((0,1,0), (0,0,-1)) = (-1,0,0)) — which is the
 * third-base side, and which is why RELEASE_POINT.x is negative for the
 * right-hander in src/core/pitch.ts. Rather than restate that in every offset,
 * everything below is written in HIS frame — right, up, forward — and pt()
 * converts. Getting a sign wrong there is then a visible mistake rather than an
 * arithmetic one.
 *
 * Read-only with respect to game state (PROMPT.md 2).
 */

import type { Vec3 } from '../core/vec.js';
import { vec, add, sub, scale, normalize, length } from '../core/vec.js';
import { MOUND_DISTANCE } from '../core/constants.js';
import { RELEASE_POINT } from '../core/pitch.js';
import type { Projector } from './camera.js';
import type { Quad, RGB } from './figure.js';
import {
  ROUND_SIDES, drawOutline, drawQuads, jointQuads, limbQuads, roundLimb, taperQuads,
} from './figure.js';

/**
 * How long the delivery takes, from first movement to release [s]. 【調整可】
 *
 * Lives here rather than in main.ts because it is a property of the ANIMATION,
 * and because the only way to say whether the hand moves plausibly is metres per
 * second — which needs both the path and the time. It was 0.55 s in the loop and
 * nowhere in this file, so the arm was whipping round two and a half times
 * faster than a person can throw and there was no test that could have noticed.
 */
export const DELIVERY_SECONDS = 1.25;

/** Top of the mound, on the rubber. */
const RUBBER: Vec3 = vec(0, 0.254, MOUND_DISTANCE);

const GREY: RGB = [214, 216, 224];
const TRIM: RGB = [34, 48, 78];
const SKIN: RGB = [222, 180, 154];
const CAP: RGB = [30, 42, 70];
const SHOE: RGB = [28, 32, 44];
const GLOVE: RGB = [86, 58, 40];

/** A point in the pitcher's own frame: his right, up, and toward home. */
const pt = (right: number, up: number, forward: number): Vec3 =>
  vec(RUBBER.x - right, RUBBER.y + up, RUBBER.z - forward);

/** How far in front of the rubber the ball leaves his hand [m]. */
const RELEASE_FORWARD = RUBBER.z - RELEASE_POINT.z;
const RELEASE_RIGHT = RUBBER.x - RELEASE_POINT.x;
const RELEASE_UP = RELEASE_POINT.y - RUBBER.y;

type Key = { readonly at: number; readonly v: Vec3 };

/**
 * Sample a keyed path. `v` is (right, up, forward) in his frame, not world.
 *
 * Linear between keys: at 60 fps a delivery is about 50 frames and the keys are
 * 6 to 15 frames apart, so the corners are not visible, and a spline here would
 * overshoot the release point — which is the one sample that has to be exact.
 */
const sample = (keys: readonly Key[], t: number): Vec3 => {
  const first = keys[0] as Key;
  if (t <= first.at) return first.v;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1] as Key;
    const b = keys[i] as Key;
    if (t <= b.at) {
      const f = (t - a.at) / (b.at - a.at || 1);
      return vec(
        a.v.x + (b.v.x - a.v.x) * f,
        a.v.y + (b.v.y - a.v.y) * f,
        a.v.z + (b.v.z - a.v.z) * f,
      );
    }
  }
  return (keys[keys.length - 1] as Key).v;
};

/**
 * The throwing hand. The 0.82 key is not chosen, it is REQUIRED: it is where
 * src/core/pitch.ts says the ball appears, so if the hand is anywhere else the
 * ball is thrown by nobody.
 *
 * THE COCKED KEY IS THE ONE THAT LOOKED WRONG. It used to put the hand out to
 * the SIDE at (0.46, 1.46, -0.46) — level with a glove hand that was itself
 * stretched 0.62 m out in front — so at the top of the delivery the two arms
 * formed one straight horizontal bar and he read as a scarecrow. A real cocked
 * arm is HIGH and CLOSE: the hand finishes above the shoulder near the head with
 * the forearm nearly vertical, and the glove arm stays bent.
 */
const THROW_HAND: readonly Key[] = [
  { at: 0.00, v: vec(0.10, 1.18, 0.02) },     // gathered at the chest
  { at: 0.28, v: vec(0.28, 0.72, -0.30) },    // the hand breaks down and back
  { at: 0.50, v: vec(0.40, 1.20, -0.42) },    // swinging up behind him
  { at: 0.64, v: vec(0.36, 1.74, -0.22) },    // COCKED: high and CLOSE, forearm up
  { at: 0.76, v: vec(0.30, 1.86, 0.36) },     // over the top
  { at: 0.82, v: vec(RELEASE_RIGHT, RELEASE_UP, RELEASE_FORWARD) },
  { at: 1.00, v: vec(-0.30, 0.72, 1.05) },    // across the body, down past the knee
];

/** The glove hand: points at the target, then tucks into the ribs. */
const GLOVE_HAND: readonly Key[] = [
  { at: 0.00, v: vec(-0.06, 1.18, 0.06) },
  { at: 0.35, v: vec(-0.24, 1.30, 0.28) },
  { at: 0.60, v: vec(-0.30, 1.34, 0.44) },    // pointed at the plate, still bent
  { at: 0.82, v: vec(-0.34, 1.00, 0.06) },    // yanked into the ribs at release
  { at: 1.00, v: vec(-0.30, 0.90, -0.16) },
];

/** The stride foot leaves the ground and lands well down the slope. */
const STRIDE_FOOT: readonly Key[] = [
  { at: 0.00, v: vec(-0.12, 0.00, -0.10) },
  { at: 0.32, v: vec(-0.16, 0.62, 0.16) },    // knee lift
  { at: 0.62, v: vec(-0.22, 0.34, 0.92) },
  { at: 0.80, v: vec(-0.26, -0.14, 1.52) },   // planted, below the rubber
  { at: 1.00, v: vec(-0.26, -0.16, 1.55) },
];

/** Hips ride forward with the stride and finish past the rubber. */
const HIPS: readonly Key[] = [
  { at: 0.00, v: vec(0.02, 0.92, 0.00) },
  { at: 0.32, v: vec(0.04, 0.96, 0.06) },
  { at: 0.62, v: vec(0.02, 0.90, 0.44) },
  { at: 0.82, v: vec(0.00, 0.84, 0.86) },
  { at: 1.00, v: vec(-0.04, 0.80, 1.02) },
];

/**
 * How square his shoulders are to home, 0 closed to 1 open.
 *
 * A delivery is a rotation, and this is the only part of it that reads at this
 * distance: he starts side-on, so the shoulder line runs along the line of
 * sight and he looks narrow, then opens and squares up.
 */
const openness = (t: number): number => (t < 0.5 ? t * 0.5 : 0.25 + ((t - 0.5) / 0.5) ** 0.7 * 0.75);

/** An elbow placed off the shoulder-hand line so the arm reads as jointed. */
const elbowAt = (shoulder: Vec3, hand: Vec3, out: Vec3, bend: number): Vec3 => {
  const mid = scale(add(shoulder, hand), 0.5);
  return add(mid, scale(normalize(out), bend));
};

/** The whole pitcher, as world-space quads. */
export const pitcherQuads = (windup: number): Quad[] => {
  const t = Math.min(1, Math.max(0, windup));
  const quads: Quad[] = [];
  const push = (built: readonly Quad[]): void => { quads.push(...built); };

  const h = sample(HIPS, t);
  const hips = pt(h.x, h.y, h.z);
  const open = openness(t);
  // shoulders swing from along the line of sight to across it
  const halfSpan = 0.21;
  const sideways = halfSpan * open;          // toward first / third
  const alongView = halfSpan * (1 - open);   // toward home / second

  /*
   * THE THROWING SHOULDER IS AT -x, AND IT WAS AT +x.
   *
   * He faces home, so forward is -z and his right is cross(up, forward) =
   * (-1, 0, 0): the third-base side. The hands get this right because pt()
   * negates for them. These two lines did not — they were written as raw world
   * offsets with a positive x — so as he opened up, his throwing shoulder swung
   * across to the FIRST-BASE side while his hand stayed on the third-base side,
   * and the arm dragged across his chest. Watching it, he looks left-handed for
   * the whole wind-up and then flips right-handed in the last few frames, which
   * is exactly how the owner described it on 令和8年7月31日.
   *
   * Pinned by tests/pitcher.test.ts: the throwing shoulder must never cross to
   * the glove side, at any point in the delivery.
   */
  const chest = add(hips, vec(0, 0.34, 0));
  const shoulderThrow = add(chest, vec(-sideways, 0.03, alongView));
  const shoulderGlove = add(chest, vec(sideways, 0.03, -alongView));
  const head = add(chest, vec(0, 0.30, 0));

  // ----- legs
  const strideFoot = (() => { const s = sample(STRIDE_FOOT, t); return pt(s.x, s.y, s.z); })();
  const pivotFoot = pt(0.14, -0.02, -0.16);
  const strideKnee = scale(add(hips, strideFoot), 0.5);
  const pivotKnee = scale(add(hips, pivotFoot), 0.5);
  push(taperQuads(strideFoot, strideKnee, 0.058, 0.072, GREY, vec(0, 1, 0), ROUND_SIDES));
  push(taperQuads(pivotFoot, pivotKnee, 0.058, 0.072, GREY, vec(0, 1, 0), ROUND_SIDES));
  push(taperQuads(strideKnee, hips, 0.072, 0.090, GREY, vec(0, 1, 0), ROUND_SIDES));
  push(taperQuads(pivotKnee, hips, 0.072, 0.090, GREY, vec(0, 1, 0), ROUND_SIDES));
  push(jointQuads(strideKnee, 0.076, GREY));
  push(jointQuads(pivotKnee, 0.076, GREY));
  push(taperQuads(
    add(strideFoot, vec(0, -0.03, 0.04)), add(strideFoot, vec(0, -0.03, -0.14)),
    0.052, 0.040, SHOE, vec(0, 1, 0), 6, 0.6));
  push(taperQuads(
    add(pivotFoot, vec(0, -0.03, 0.04)), add(pivotFoot, vec(0, -0.03, -0.13)),
    0.052, 0.040, SHOE, vec(0, 1, 0), 6, 0.6));

  // ----- trunk
  push(taperQuads(hips, chest, 0.104, 0.138, GREY, vec(1, 0, 0), ROUND_SIDES, 0.76));
  push(taperQuads(
    chest, add(chest, vec(0, 0.20, 0)), 0.138, 0.082, GREY, vec(1, 0, 0), ROUND_SIDES, 0.76));
  push(roundLimb(shoulderGlove, shoulderThrow, 0.066, GREY, vec(0, 1, 0)));
  // the jersey placket, so the trunk is not one flat slab
  push(limbQuads(
    add(hips, vec(0, 0.02, -0.096)), add(chest, vec(0, 0.06, -0.104)),
    0.020, 0.014, TRIM, vec(0, 1, 0)));

  // ----- head and cap
  push(roundLimb(
    add(head, vec(0, -0.10, 0)), add(head, vec(0, 0.055, 0)), 0.094, SKIN, vec(1, 0, 0), 0.94));
  push(taperQuads(
    add(head, vec(0, -0.02, 0)), add(head, vec(0, 0.10, 0)),
    0.100, 0.062, CAP, vec(1, 0, 0), ROUND_SIDES, 0.96));
  // peak, pointing at the batter, which is the only thing that shows he is
  // looking this way at all
  push(limbQuads(
    add(head, vec(0, 0.03, -0.07)), add(head, vec(0, 0.015, -0.21)), 0.078, 0.016, CAP));

  // ----- arms
  const throwHand = (() => { const v = sample(THROW_HAND, t); return pt(v.x, v.y, v.z); })();
  const gloveHand = (() => { const v = sample(GLOVE_HAND, t); return pt(v.x, v.y, v.z); })();
  // the throwing elbow leads high and outside; the glove elbow tucks down
  /*
   * The throwing elbow breaks OUT and BEHIND, not toward the plate.
   *
   * He faces -z, so his throwing side is -x; the elbow leads away from the body
   * on that side and BACK (+z) while the arm is cocked. It used to be pushed
   * toward home (-z), which folded the arm the wrong way across his chest.
   */
  const throwElbow = elbowAt(shoulderThrow, throwHand, vec(-0.60, 0.66, 0.45), 0.20);
  push(jointQuads(throwElbow, 0.052, SKIN));
  push(roundLimb(shoulderThrow, throwElbow, 0.056, GREY));
  push(roundLimb(throwElbow, throwHand, 0.044, SKIN));
  const gloveElbow = elbowAt(shoulderGlove, gloveHand, vec(0.42, -0.66, 0.20), 0.17);
  push(jointQuads(gloveElbow, 0.050, SKIN));
  push(roundLimb(shoulderGlove, gloveElbow, 0.056, GREY));
  push(roundLimb(gloveElbow, gloveHand, 0.044, SKIN));
  push(roundLimb(
    add(gloveHand, vec(0, 0, 0.05)), add(gloveHand, vec(0, 0, -0.05)), 0.085, GLOVE));

  return quads;
};

/** Draw him, with a shadow on the mound. */
export const drawPitcher = (
  ctx: CanvasRenderingContext2D, p: Projector, windup: number,
): void => {
  // he is 18 m away, so bail before doing the work if he is off screen or tiny
  const foot = p.project(RUBBER);
  const crown = p.project(add(RUBBER, vec(0, 1.85, 0)));
  if (!foot || !crown || foot.y - crown.y < 8) return;

  // No ground shadow: drawGroundShadow puts it on the field plane, and he is
  // standing 0.254 m up on the mound, so at this distance it would sit visibly
  // adrift below his feet rather than under them.
  const quads = pitcherQuads(windup);
  // Thinner than the batter's: he is 18 m away, and a rim scaled for the
  // foreground would swallow him.
  drawOutline(ctx, p, quads, 'rgb(12,16,28)', 0.020);
  drawQuads(ctx, p, quads);
};

/**
 * Where his two shoulders are, for a given point in the delivery.
 *
 * Exported so the handedness is a test rather than something to notice on
 * screen. It took an owner watching the animation to catch it the first time.
 */
export const pitcherShoulders = (windup: number): {
  readonly throwing: Vec3; readonly glove: Vec3;
} => {
  const t = Math.min(1, Math.max(0, windup));
  const h = sample(HIPS, t);
  const hips = pt(h.x, h.y, h.z);
  const chest = add(hips, vec(0, 0.34, 0));
  const open = openness(t);
  const halfSpan = 0.21;
  return {
    throwing: add(chest, vec(-halfSpan * open, 0.03, halfSpan * (1 - open))),
    glove: add(chest, vec(halfSpan * open, 0.03, -halfSpan * (1 - open))),
  };
};

/** The world point his hand is at, for a given point in the delivery. */
export const pitcherHand = (windup: number): Vec3 => {
  const v = sample(THROW_HAND, Math.min(1, Math.max(0, windup)));
  return pt(v.x, v.y, v.z);
};

/** How far the drawn hand is from where the physics releases the ball [m]. */
export const releaseError = (): number =>
  length(sub(pitcherHand(0.82), RELEASE_POINT));
