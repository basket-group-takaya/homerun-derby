/**
 * Pitching: turn a pitch type into a spin vector, then fly the ball to the plate
 * with the same integrator the batted ball uses.
 *
 * Speeds and movement targets are in docs/SPEC.md 5 (Baseball Savant 2025,
 * scaled to NPB starter velocity). Right-handed pitcher throwing toward -z.
 *
 * Sign conventions, derived once so the table below can be read at a glance:
 *   velocity is mostly (0, 0, -V), so omega x v gives
 *     omega.x > 0  ->  force +y   (backspin, the ball "rises")
 *     omega.y > 0  ->  force -x   (arm side: in on a right-handed batter)
 *     omega.y < 0  ->  force +x   (glove side: away from a right-handed batter)
 */

import type { Vec3 } from './vec.js';
import { vec, add, addScaled, scale, dot, cross, length, normalize } from './vec.js';
import type { Rng } from './rng.js';
import { nextRange, nextBool, pick } from './rng.js';
import { dragCoefficient, liftCoefficient } from './physics.js';
import {
  AIR_DENSITY, BALL_AREA, BALL_MASS, BALL_RADIUS, DT, GRAVITY,
  PLATE_HALF_WIDTH, RELEASE_DISTANCE, ZONE_BOTTOM, ZONE_TOP,
} from './constants.js';

export type PitchType = 'straight' | 'shoot' | 'slider' | 'fork' | 'change' | 'curve';

export const PITCH_TYPES: readonly PitchType[] =
  ['straight', 'shoot', 'slider', 'fork', 'change', 'curve'];

export const PITCH_LABEL: Readonly<Record<PitchType, string>> = {
  straight: 'ストレート', shoot: 'シュート', slider: 'スライダー',
  fork: 'フォーク', change: 'チェンジアップ', curve: 'カーブ',
};

type PitchSpec = {
  /** Release speed [km/h]. */
  readonly kmh: number;
  /** Spin rate [rpm]. */
  readonly rpm: number;
  /**
   * Spin axis, unnormalised, in world axes. See the sign notes at the top.
   * x = backspin (positive rises), y = horizontal run (positive is arm side).
   */
  readonly axis: Vec3;
};

export const PITCHES: Readonly<Record<PitchType, PitchSpec>> = {
  straight: { kmh: 146.5, rpm: 2324, axis: vec(1.0, 0.35, 0) },
  shoot: { kmh: 145.4, rpm: 2184, axis: vec(0.45, 0.90, 0) },
  slider: { kmh: 133.8, rpm: 2431, axis: vec(0.12, -0.65, 0) },
  fork: { kmh: 134.1, rpm: 1355, axis: vec(0.20, 0.60, 0) },
  change: { kmh: 132.9, rpm: 1794, axis: vec(0.28, 0.85, 0) },
  curve: { kmh: 124.4, rpm: 2582, axis: vec(-0.62, -0.55, 0) },
};

/**
 * Where the pitcher lets go, for a right-hander.
 *
 * x is NEGATIVE. Facing the plate the pitcher looks along -z, and for someone
 * facing that way the right hand is on the -x side — the third-base side, the
 * same side the right-handed batter stands on. It was +0.35 through M2, which is
 * a left-hander's release point, and nobody could see the mistake until the
 * pitcher silhouette became detailed enough to show which arm the ball leaves.
 * The spin table above is right-handed (arm side = -x), so this now agrees.
 */
export const RELEASE_POINT: Vec3 = vec(-0.35, 1.85, RELEASE_DISTANCE);

export type Pitch = {
  readonly type: PitchType;
  readonly release: Vec3;
  readonly velocity: Vec3;
  readonly spin: Vec3;
  /** Where it was aimed on the zone plane [m]. */
  readonly target: { readonly x: number; readonly y: number };
  readonly intendedStrike: boolean;
  /**
   * Score multiplier carried by this pitch: 1, 2 or 3.
   *
   * docs/REFERENCE-HB2.md 5-2. It changes nothing about the flight — a x3 ball
   * is aerodynamically an ordinary ball — so PROMPT.md 5's ban on fudging
   * outcomes with randomness is untouched. All it does is give the player a
   * reason to care which pitch they take a cut at.
   */
  readonly multiplier: 1 | 2 | 3;
};

export type PitchSample = { readonly pos: Vec3; readonly t: number };

export type PitchFlight = {
  /** Sampled path from release until it passes the plate. */
  readonly samples: readonly PitchSample[];
  /** Time the ball centre crosses z = 0 [s]. */
  readonly crossTime: number;
  /** Where it crossed the zone plane [m]. */
  readonly crossPoint: { readonly x: number; readonly y: number };
};

const RPM_TO_RAD = (2 * Math.PI) / 60;

const accel = (v: Vec3, omega: Vec3, cd: number): Vec3 => {
  const speed = length(v);
  const g = vec(0, -GRAVITY, 0);
  if (speed < 1e-9) return g;
  const k = (0.5 * AIR_DENSITY * BALL_AREA) / BALL_MASS;
  const drag = scale(v, -k * cd * speed);
  const vHat = scale(v, 1 / speed);
  const perp = addScaled(omega, vHat, -dot(omega, vHat));
  const s = (BALL_RADIUS * length(perp)) / speed;
  const magnus = scale(normalize(cross(omega, v)), k * liftCoefficient(s) * speed * speed);
  return add(add(g, drag), magnus);
};

/**
 * Aim the pitch so it arrives near `target`, by shooting at it and correcting.
 *
 * A closed-form launch direction does not exist once drag and Magnus are in
 * play, so this fires a few times and nudges the aim. Deterministic, and it
 * converges in three passes.
 */
export const makePitch = (
  type: PitchType,
  target: { readonly x: number; readonly y: number },
  intendedStrike: boolean,
  multiplier: 1 | 2 | 3 = 1,
): Pitch => {
  const spec = PITCHES[type];
  const speed = spec.kmh / 3.6;
  const spin = scale(normalize(spec.axis), spec.rpm * RPM_TO_RAD);
  const cd = dragCoefficient(spec.rpm);

  let aim = { x: target.x, y: target.y };
  let velocity = vec(0, 0, -speed);

  for (let pass = 0; pass < 4; pass++) {
    const dir = normalize(vec(
      aim.x - RELEASE_POINT.x, aim.y - RELEASE_POINT.y, -RELEASE_POINT.z));
    velocity = scale(dir, speed);
    const flight = flyPitch({
      type, release: RELEASE_POINT, velocity, spin, target, intendedStrike, multiplier,
    }, cd);
    aim = {
      x: aim.x + (target.x - flight.crossPoint.x),
      y: aim.y + (target.y - flight.crossPoint.y),
    };
  }

  return { type, release: RELEASE_POINT, velocity, spin, target, intendedStrike, multiplier };
};

/** Integrate a pitch from release until it has passed the plate. */
export const flyPitch = (pitch: Pitch, cdOverride?: number): PitchFlight => {
  const rpm = length(pitch.spin) / RPM_TO_RAD;
  const cd = cdOverride ?? dragCoefficient(rpm);

  let p = pitch.release;
  let v = pitch.velocity;
  let t = 0;
  const samples: PitchSample[] = [{ pos: p, t }];
  let crossTime = 0;
  let crossPoint = { x: p.x, y: p.y };
  let crossed = false;

  // keep going a little past the plate so the catcher-side frames exist
  while (t < 2 && p.z > -1.2) {
    const a1 = accel(v, pitch.spin, cd);
    const v2 = addScaled(v, a1, DT / 2);
    const a2 = accel(v2, pitch.spin, cd);
    const v3 = addScaled(v, a2, DT / 2);
    const a3 = accel(v3, pitch.spin, cd);
    const v4 = addScaled(v, a3, DT);
    const a4 = accel(v4, pitch.spin, cd);

    const next = add(p, scale(add(add(v, scale(add(v2, v3), 2)), v4), DT / 6));
    const nextV = add(v, scale(add(add(a1, scale(add(a2, a3), 2)), a4), DT / 6));

    if (!crossed && next.z <= 0) {
      const f = p.z / (p.z - next.z);
      crossTime = t + DT * f;
      crossPoint = { x: p.x + (next.x - p.x) * f, y: p.y + (next.y - p.y) * f };
      crossed = true;
    }

    p = next;
    v = nextV;
    t += DT;
    samples.push({ pos: p, t });
  }

  return { samples, crossTime, crossPoint };
};

/** How often the pitcher offers a x2 or a x3 ball. 【調整可】 */
export const BONUS_X2_RATE = 0.14;
export const BONUS_X3_RATE = 0.05;

/** Pick a pitch. Strike 80% of the time, per docs/SPEC.md 5. */
export const choosePitch = (rng: Rng): { rng: Rng; pitch: Pitch } => {
  const a = pick(rng, PITCH_TYPES);
  const b = nextBool(a.rng, 0.8);
  const strike = b.value;

  // strikes land inside the zone; balls miss it by a believable margin
  const xr = strike
    ? nextRange(b.rng, -PLATE_HALF_WIDTH * 0.85, PLATE_HALF_WIDTH * 0.85)
    : nextRange(b.rng, -PLATE_HALF_WIDTH * 2.1, PLATE_HALF_WIDTH * 2.1);
  const yr = strike
    ? nextRange(xr.rng, ZONE_BOTTOM + 0.05, ZONE_TOP - 0.05)
    : nextRange(xr.rng, ZONE_BOTTOM - 0.22, ZONE_TOP + 0.22);

  const roll = nextRange(yr.rng, 0, 1);
  const multiplier: 1 | 2 | 3 = roll.value < BONUS_X3_RATE
    ? 3
    : roll.value < BONUS_X3_RATE + BONUS_X2_RATE ? 2 : 1;

  return {
    rng: roll.rng,
    pitch: makePitch(a.value, { x: xr.value, y: yr.value }, strike, multiplier),
  };
};
