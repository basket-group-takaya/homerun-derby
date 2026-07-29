/**
 * Batted-ball flight: RK4 integration of gravity + drag + Magnus lift.
 *
 * Pure. No DOM, no clock, no randomness — the same arguments always give the
 * same trajectory, byte for byte.
 *
 * Constants and their sources are in constants.ts; the model is validated
 * against Alan Nathan's published distance table in tests/physics.test.ts and
 * reported numerically by scripts/physics-check.ts.
 */

import type { Vec3 } from './vec.js';
import { vec, add, scale, dot, cross, length, normalize, addScaled, clamp, radians }
  from './vec.js';
import {
  AIR_DENSITY, BALL_AREA, BALL_MASS, BALL_RADIUS, CD_BASE, CD_PER_KRPM,
  CL_A, CL_B, CL_NUM, DT, GRAVITY, MAX_FLIGHT_TIME,
  SIDESPIN_BASE, SIDESPIN_MAX, SIDESPIN_PER_DEG_SPRAY,
  SPIN_BASE, SPIN_MAX, SPIN_MIN, SPIN_PER_DEG_LAUNCH,
} from './constants.js';

const RPM_TO_RAD = (2 * Math.PI) / 60;

/** Cd = 0.3008 + 0.0292 * (rpm / 1000). Drag rises with spin. */
export const dragCoefficient = (totalRpm: number): number =>
  CD_BASE + CD_PER_KRPM * (Math.abs(totalRpm) / 1000);

/** Cl = 1.120 S / (0.583 + 2.333 S), where S = r |omega_perp| / |v|. */
export const liftCoefficient = (spinParameter: number): number => {
  const s = Math.abs(spinParameter);
  return s <= 0 ? 0 : (CL_NUM * s) / (CL_A + CL_B * s);
};

export type Spin = { readonly backspinRpm: number; readonly sidespinRpm: number };

/**
 * Backspin and sidespin of a batted ball, from the Statcast regression.
 *
 * Right-handed batter throughout (all three players are).
 *
 * Two deliberate departures from the raw published fit, both required to keep
 * the game honest:
 *
 * 1. Backspin depends on launch angle ONLY. The published fit also has a spray
 *    term (+21 per degree), but PROMPT.md 0-3 specifies omega = f(cursor Y,
 *    theta) with no phi in it, and including phi breaks a required property: a
 *    slightly early swing gives phi < 0, which lowers backspin, and since the
 *    working range sits ABOVE the distance-optimal spin (see docs/SPEC.md 6-5)
 *    less spin means MORE carry. Mistiming would be rewarded. Caught by
 *    tests/bat.test.ts.
 * 2. Sidespin grows with |phi| rather than with phi. The raw fit flips sign near
 *    phi = -9 degrees, which again makes a mistimed ball travel further.
 *
 * The cost is a little realism in the spray-angle tails; the gain is that
 * "worse contact never travels further" holds structurally.
 */
export const spinForContact = (launchAngleDeg: number, sprayAngleDeg: number): Spin => ({
  backspinRpm: clamp(
    SPIN_BASE + SPIN_PER_DEG_LAUNCH * launchAngleDeg, SPIN_MIN, SPIN_MAX),
  sidespinRpm: -Math.min(
    SIDESPIN_BASE + SIDESPIN_PER_DEG_SPRAY * Math.abs(sprayAngleDeg), SIDESPIN_MAX),
});

export type BattedBallInput = {
  /** Exit velocity [m/s]. */
  readonly exitVelocity: number;
  /** Launch angle above horizontal [deg]. */
  readonly launchAngle: number;
  /** Spray angle from centre field toward first base [deg]; negative pulls. */
  readonly sprayAngle: number;
  readonly backspinRpm: number;
  readonly sidespinRpm: number;
  /** Height the bat met the ball [m]. */
  readonly contactHeight: number;
  /**
   * Air density [kg/m^3]. Defaults to the game's standard conditions. Override
   * only to compare against a table computed at some other atmosphere.
   */
  readonly airDensity?: number;
};

export type BattedBallResult = {
  /** Horizontal carry to the point the ball returns to y = 0 [m]. */
  readonly distance: number;
  readonly hangTime: number;
  /** Highest point reached [m]. */
  readonly apex: number;
  readonly landing: Vec3;
  /** Sampled flight path for rendering; the last point is the landing point. */
  readonly trail: readonly Vec3[];
};

/**
 * Spin vector in world axes.
 *
 * Backspin acts about the horizontal axis perpendicular to the direction of
 * travel, oriented so that omega x v points upward. Sidespin acts about +y.
 */
const spinVector = (sprayAngleDeg: number, spin: Spin): Vec3 => {
  const phi = radians(sprayAngleDeg);
  const back = spin.backspinRpm * RPM_TO_RAD;
  const side = spin.sidespinRpm * RPM_TO_RAD;
  // horizontal travel direction is (sin phi, 0, cos phi); the backspin axis is
  // that crossed with up, i.e. (-cos phi, 0, sin phi)
  return vec(-Math.cos(phi) * back, side, Math.sin(phi) * back);
};

/** Acceleration from gravity, drag and Magnus lift at a given velocity. */
const acceleration = (v: Vec3, omega: Vec3, cd: number, rho: number): Vec3 => {
  const speed = length(v);
  const gravityOnly = vec(0, -GRAVITY, 0);
  if (speed < 1e-9) return gravityOnly;

  const k = (0.5 * rho * BALL_AREA) / BALL_MASS;
  const drag = scale(v, -k * cd * speed);

  // lift uses only the spin component perpendicular to the velocity
  const vHat = scale(v, 1 / speed);
  const omegaPerp = addScaled(omega, vHat, -dot(omega, vHat));
  const s = (BALL_RADIUS * length(omegaPerp)) / speed;
  const magnusDir = normalize(cross(omega, v));
  const magnus = scale(magnusDir, k * liftCoefficient(s) * speed * speed);

  return add(add(gravityOnly, drag), magnus);
};

/**
 * Integrate one batted ball to the ground.
 *
 * The ball is followed all the way back to y = 0 even after it clears a fence,
 * so `distance` is the "would have gone" number broadcasts quote — see
 * docs/SPEC.md 6-1.
 */
export const simulateBattedBall = (input: BattedBallInput): BattedBallResult => {
  const theta = radians(input.launchAngle);
  const phi = radians(input.sprayAngle);
  const spin: Spin = { backspinRpm: input.backspinRpm, sidespinRpm: input.sidespinRpm };
  const omega = spinVector(input.sprayAngle, spin);
  const totalRpm = Math.hypot(spin.backspinRpm, spin.sidespinRpm);
  const cd = dragCoefficient(totalRpm);
  const rho = input.airDensity ?? AIR_DENSITY;

  let p = vec(0, input.contactHeight, 0);
  let v = vec(
    input.exitVelocity * Math.cos(theta) * Math.sin(phi),
    input.exitVelocity * Math.sin(theta),
    input.exitVelocity * Math.cos(theta) * Math.cos(phi),
  );

  const trail: Vec3[] = [p];
  let t = 0;
  let apex = p.y;

  while (t < MAX_FLIGHT_TIME) {
    const a1 = acceleration(v, omega, cd, rho);
    const v2 = addScaled(v, a1, DT / 2);
    const a2 = acceleration(v2, omega, cd, rho);
    const v3 = addScaled(v, a2, DT / 2);
    const a3 = acceleration(v3, omega, cd, rho);
    const v4 = addScaled(v, a3, DT);
    const a4 = acceleration(v4, omega, cd, rho);

    // p' = v, so the position update is Simpson's rule over the stage velocities
    const dp = scale(add(add(v, scale(add(v2, v3), 2)), v4), DT / 6);
    const dv = scale(add(add(a1, scale(add(a2, a3), 2)), a4), DT / 6);
    const nextP = add(p, dp);
    const nextV = add(v, dv);

    if (nextP.y <= 0) {
      // land exactly on the ground by linear interpolation across the last step
      const f = p.y / (p.y - nextP.y);
      const landing = vec(
        p.x + (nextP.x - p.x) * f,
        0,
        p.z + (nextP.z - p.z) * f,
      );
      trail.push(landing);
      return {
        distance: Math.hypot(landing.x, landing.z),
        hangTime: t + DT * f,
        apex,
        landing,
        trail,
      };
    }

    p = nextP;
    v = nextV;
    t += DT;
    apex = Math.max(apex, p.y);
    // one sample every 4 steps keeps the trail render-sized without losing shape
    if (trail.length === 0 || Math.round(t / DT) % 4 === 0) trail.push(p);
  }

  // never reached in practice; a fly ball hangs about 6 s
  return { distance: Math.hypot(p.x, p.z), hangTime: t, apex, landing: p, trail };
};
