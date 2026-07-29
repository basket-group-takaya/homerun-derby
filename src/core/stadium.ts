/**
 * The fictional ballpark: fence shape and home-run adjudication.
 *
 * Dimensions sit in the middle of the real NPB distribution (docs/SPEC.md 7-1).
 * Centre field is 120 m specifically so that it lines up with the 120 m in the
 * scoring formula: clearing the fence is worth the base 100, and every metre
 * beyond it is the bonus.
 */

import type { Vec3 } from './vec.js';
import { vec, degrees, radians, clamp } from './vec.js';
import {
  BALL_RADIUS, FENCE_ALLEY, FENCE_CENTRE, FENCE_HEIGHT, FENCE_LINE, FOUL_ANGLE,
  POLE_RADIUS, POLE_TOP, SCOREBOARD_BOTTOM, SCOREBOARD_HALF_WIDTH, SCOREBOARD_TOP,
  SCOREBOARD_Z,
} from './constants.js';

/** Spray angle of a point, in degrees from centre field toward first base. */
export const sprayAngleOf = (p: Vec3): number => degrees(Math.atan2(p.x, p.z));

/**
 * Fence distance [m] at a spray angle, interpolated through the three measured
 * control points: 120 m at centre, 112 m in the alleys, 98 m down the lines.
 */
export const fenceDistance = (sprayAngleDeg: number): number => {
  const a = Math.min(Math.abs(sprayAngleDeg), FOUL_ANGLE);
  return a <= 22.5
    ? FENCE_CENTRE + ((FENCE_ALLEY - FENCE_CENTRE) * a) / 22.5
    : FENCE_ALLEY + ((FENCE_LINE - FENCE_ALLEY) * (a - 22.5)) / 22.5;
};

export const isFair = (sprayAngleDeg: number): boolean =>
  Math.abs(sprayAngleDeg) <= FOUL_ANGLE;

// ---------------------------------------------------------------------------
// targets — docs/REFERENCE-HB2.md 5-2
// ---------------------------------------------------------------------------

export type TargetId = 'leftPole' | 'rightPole' | 'scoreboard';

/** Foul-pole base positions, on the fence line at +-FOUL_ANGLE. */
export const POLE_POSITIONS: Readonly<Record<'leftPole' | 'rightPole', Vec3>> = {
  leftPole: vec(
    -FENCE_LINE * Math.sin(radians(FOUL_ANGLE)), 0, FENCE_LINE * Math.cos(radians(FOUL_ANGLE))),
  rightPole: vec(
    FENCE_LINE * Math.sin(radians(FOUL_ANGLE)), 0, FENCE_LINE * Math.cos(radians(FOUL_ANGLE))),
};

/**
 * Did a segment of the flight path clip a foul pole?
 *
 * Point sampling is not enough: the trail is one sample per 1/60 s, which at
 * 40 m/s is 0.67 m between points — wider than the pole. So this solves for the
 * closest approach along the segment instead of testing the endpoints.
 */
const segmentHitsPole = (a: Vec3, b: Vec3, pole: Vec3): boolean => {
  const r = POLE_RADIUS + BALL_RADIUS;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const denominator = dx * dx + dz * dz;
  const s = denominator < 1e-12
    ? 0
    : clamp(((pole.x - a.x) * dx + (pole.z - a.z) * dz) / denominator, 0, 1);
  const cx = a.x + dx * s - pole.x;
  const cz = a.z + dz * s - pole.z;
  if (cx * cx + cz * cz > r * r) return false;
  const y = a.y + (b.y - a.y) * s;
  return y >= FENCE_HEIGHT - BALL_RADIUS && y <= POLE_TOP;
};

/** Did a segment cross the scoreboard slab? */
const segmentHitsScoreboard = (a: Vec3, b: Vec3): boolean => {
  if ((a.z - SCOREBOARD_Z) * (b.z - SCOREBOARD_Z) > 0) return false;
  const span = b.z - a.z;
  if (Math.abs(span) < 1e-12) return false;
  const f = clamp((SCOREBOARD_Z - a.z) / span, 0, 1);
  const x = a.x + (b.x - a.x) * f;
  const y = a.y + (b.y - a.y) * f;
  return Math.abs(x) <= SCOREBOARD_HALF_WIDTH && y >= SCOREBOARD_BOTTOM && y <= SCOREBOARD_TOP;
};

/**
 * The first target the ball struck, if any.
 *
 * Poles are checked before the scoreboard because a ball cannot reach the
 * scoreboard through a pole, and a pole hit is the rarer, louder event.
 */
export const hitTarget = (trail: readonly Vec3[]): TargetId | null => {
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    if (!a || !b) continue;
    if (segmentHitsPole(a, b, POLE_POSITIONS.leftPole)) return 'leftPole';
    if (segmentHitsPole(a, b, POLE_POSITIONS.rightPole)) return 'rightPole';
    if (segmentHitsScoreboard(a, b)) return 'scoreboard';
  }
  return null;
};

/** Which block of seats a ball landed in. docs/REFERENCE-HB2.md 5-2. */
export type Bleacher = 'left' | 'centre' | 'right';

export const bleacherOf = (sprayAngleDeg: number): Bleacher =>
  sprayAngleDeg < -15 ? 'left' : sprayAngleDeg > 15 ? 'right' : 'centre';

export type BallOutcome = 'homeRun' | 'offTheWall' | 'inPlay' | 'foul';

export type FieldResult = {
  readonly outcome: BallOutcome;
  /** Carry to where the ball returns to ground level [m]. */
  readonly distance: number;
  /** Height as it passed the fence line [m], or null if it never got there. */
  readonly heightAtFence: number | null;
  readonly sprayAngle: number;
  /** Foul pole or scoreboard, if the ball struck one. */
  readonly target: TargetId | null;
  /** Which block of seats, for balls that left the park. */
  readonly bleacher: Bleacher | null;
};

/**
 * Decide what a flight path amounts to.
 *
 * The trail is walked to find where the ball first reaches the fence for its own
 * spray angle. Sidespin bends the path, so the angle is recomputed along the
 * way rather than taken from the launch.
 */
export const judgeBattedBall = (
  trail: readonly Vec3[],
  landing: Vec3,
  distance: number,
): FieldResult => {
  const finalSpray = sprayAngleOf(landing);
  const target = hitTarget(trail);

  // 公認野球規則 5.05(a)(5) 原注: a ball that strikes the foul pole above the
  // fence is a home run, however foul the landing spot looks afterwards.
  if (target === 'leftPole' || target === 'rightPole') {
    return {
      outcome: 'homeRun', distance, heightAtFence: FENCE_HEIGHT,
      sprayAngle: finalSpray, target, bleacher: bleacherOf(finalSpray),
    };
  }

  if (!isFair(finalSpray)) {
    return {
      outcome: 'foul', distance, heightAtFence: null,
      sprayAngle: finalSpray, target, bleacher: null,
    };
  }

  let previous: Vec3 | null = null;
  for (const point of trail) {
    const radial = Math.hypot(point.x, point.z);
    const fence = fenceDistance(sprayAngleOf(point));
    if (radial >= fence) {
      // interpolate the height at the exact moment it crossed
      let height = point.y;
      if (previous) {
        const previousRadial = Math.hypot(previous.x, previous.z);
        const span = radial - previousRadial;
        if (span > 1e-9) {
          const f = clamp((fence - previousRadial) / span, 0, 1);
          height = previous.y + (point.y - previous.y) * f;
        }
      }
      const over = height > FENCE_HEIGHT;
      return {
        outcome: over ? 'homeRun' : 'offTheWall',
        distance,
        heightAtFence: height,
        sprayAngle: finalSpray,
        target,
        bleacher: over ? bleacherOf(finalSpray) : null,
      };
    }
    previous = point;
  }

  return {
    outcome: 'inPlay', distance, heightAtFence: null,
    sprayAngle: finalSpray, target, bleacher: null,
  };
};
