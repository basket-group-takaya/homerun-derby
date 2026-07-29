/**
 * The fictional ballpark: fence shape and home-run adjudication.
 *
 * Dimensions sit in the middle of the real NPB distribution (docs/SPEC.md 7-1).
 * Centre field is 120 m specifically so that it lines up with the 120 m in the
 * scoring formula: clearing the fence is worth the base 100, and every metre
 * beyond it is the bonus.
 */

import type { Vec3 } from './vec.js';
import { degrees, clamp } from './vec.js';
import {
  FENCE_ALLEY, FENCE_CENTRE, FENCE_HEIGHT, FENCE_LINE, FOUL_ANGLE,
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

export type BallOutcome = 'homeRun' | 'offTheWall' | 'inPlay' | 'foul';

export type FieldResult = {
  readonly outcome: BallOutcome;
  /** Carry to where the ball returns to ground level [m]. */
  readonly distance: number;
  /** Height as it passed the fence line [m], or null if it never got there. */
  readonly heightAtFence: number | null;
  readonly sprayAngle: number;
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

  if (!isFair(finalSpray)) {
    return { outcome: 'foul', distance, heightAtFence: null, sprayAngle: finalSpray };
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
      return {
        outcome: height > FENCE_HEIGHT ? 'homeRun' : 'offTheWall',
        distance,
        heightAtFence: height,
        sprayAngle: finalSpray,
      };
    }
    previous = point;
  }

  return { outcome: 'inPlay', distance, heightAtFence: null, sprayAngle: finalSpray };
};
