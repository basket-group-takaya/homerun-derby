/**
 * Bat-ball contact: turns where the cursor was and when the swing happened into
 * an exit velocity, a launch angle, a spray angle and a spin.
 *
 * PROMPT.md 5 forbids faking the result with random numbers. Nothing here is
 * random: every output is a deterministic function of the inputs, and
 * tests/bat.test.ts pins the three monotonicity properties that make the
 * cause-and-effect legible to a player.
 */

import type { PlayerSpec } from './constants.js';
import {
  AIM_HIGH_FACTOR, BALL_RADIUS, CURSOR_RADIUS, BASE_LAUNCH_ANGLE, EXIT_VELOCITY_MAX,
  FOUL_ANGLE, HEIGHT_REF, K_HEIGHT, K_PHI, K_THETA, MAX_EXIT_KMH,
  PASSION_CURSOR_BONUS, PASSION_EXIT_BONUS, PASSION_WHIFF_STREAK,
  Q_FOUL, Q_GOOD, Q_MEET_EXP, Q_TIME_EXP, R_JUST_RATIO,
  THETA_MAX, THETA_MIN, T_JUST, T_MISS, V_MIN,
} from './constants.js';
import { spinForContact } from './physics.js';
import type { Spin } from './physics.js';
import { clamp } from './vec.js';

export type ContactKind =
  | 'just' | 'good' | 'poor' | 'jammed' | 'reachedOut' | 'foul' | 'whiff';

/** A point on the strike-zone plane, in metres, origin at the middle of the zone. */
export type ZonePoint = { readonly x: number; readonly y: number };

export type ContactInput = {
  readonly player: PlayerSpec;
  /** Where the meet cursor was when the swing landed. */
  readonly cursor: ZonePoint;
  /** Where the ball crossed the zone plane. */
  readonly ball: ZonePoint;
  /** Swing timing error [s]. Negative is early. */
  readonly timingError: number;
  /** Consecutive whiffs so far this round, for yuki's skill. */
  readonly whiffStreak: number;
};

export type Contact = {
  readonly kind: ContactKind;
  /** Meet error: cursor-to-ball distance on the zone plane [m]. */
  readonly e: number;
  /** Timing error [s]. */
  readonly t: number;
  /** Undercut: how far below the ball centre the cursor was [m]. */
  readonly u: number;
  /** Combined contact quality, 0..1. */
  readonly quality: number;
  readonly exitVelocity: number;
  readonly launchAngle: number;
  readonly sprayAngle: number;
  readonly spin: Spin;
  readonly contactHeight: number;
};

/**
 * Effective catch radius [m]: the cursor's own radius plus the ball's, since
 * contact happens when the two circles overlap at all.
 *
 * yuki's "passion" widens the cursor for one swing after consecutive whiffs, so
 * a cold streak has a way out.
 */
export const catchRadius = (player: PlayerSpec, whiffStreak: number): number => {
  const base = CURSOR_RADIUS[player.meet];
  const boosted = player.skill === 'passion' && whiffStreak >= PASSION_WHIFF_STREAK
    ? base * PASSION_CURSOR_BONUS
    : base;
  return boosted + BALL_RADIUS;
};

const classify = (e: number, t: number, q: number, radius: number, phi: number): ContactKind => {
  if (e <= radius * R_JUST_RATIO && Math.abs(t) <= T_JUST) return 'just';
  if (q < Q_FOUL || Math.abs(phi) > FOUL_ANGLE) return 'foul';
  if (q >= Q_GOOD) return 'good';
  if (t < -T_JUST) return 'jammed';
  if (t > T_JUST) return 'reachedOut';
  return 'poor';
};

/**
 * Resolve one swing.
 *
 * The shape of the formulas is fixed by PROMPT.md 0-3:
 *   v0 = f(power, e, t) / theta = f(trajectory, ball height, cursor Y)
 *   phi = f(t)          / omega = f(cursor Y, theta)
 *
 * Note what theta and phi do NOT depend on: the meet error e and, for theta,
 * the timing error t. That is what makes the monotonicity properties in
 * docs/SPEC.md 4-5 hold structurally rather than by luck.
 */
export const resolveContact = (input: ContactInput): Contact => {
  const { player, cursor, ball, timingError: t, whiffStreak } = input;

  const dx = ball.x - cursor.x;
  const u = ball.y - cursor.y;
  const e = Math.hypot(dx, u);
  const radius = catchRadius(player, whiffStreak);

  const miss = (): Contact => ({
    kind: 'whiff', e, t, u, quality: 0,
    exitVelocity: 0, launchAngle: 0, sprayAngle: 0,
    spin: { backspinRpm: 0, sidespinRpm: 0 },
    contactHeight: ball.y,
  });
  if (e > radius || Math.abs(t) > T_MISS) return miss();

  // Quadratic falloff, not linear. Linear made the sweet spot a cliff: 33 ms of
  // timing error (2 frames at 60fps) cost a right-handed A-power hitter 30 m of
  // carry, so anything short of frame-perfect was a ground out. Squaring the
  // normalised error keeps the centre forgiving and still collapses at the edge.
  // Both terms remain monotonically decreasing, so PROMPT.md 3-4 still holds.
  const meetError = clamp(e / radius, 0, 1);
  const timeError = clamp(Math.abs(t) / T_MISS, 0, 1);
  const qMeet = 1 - meetError * meetError;
  const qTime = 1 - timeError * timeError;
  const quality = Math.pow(qMeet, Q_MEET_EXP) * Math.pow(qTime, Q_TIME_EXP);

  const maxExit = MAX_EXIT_KMH[player.power] / 3.6;
  let exitVelocity = V_MIN + (maxExit - V_MIN) * quality;

  // launch angle: base from the trajectory rank, plus undercut, plus a small
  // correction for a high or low pitch
  const skillFactor = player.skill === 'aimHigh' ? AIM_HIGH_FACTOR : 1;
  const launchAngle = clamp(
    BASE_LAUNCH_ANGLE[player.trajectory] + K_THETA * skillFactor * u
      + K_HEIGHT * (ball.y - HEIGHT_REF),
    THETA_MIN, THETA_MAX);

  // spray: early pulls toward left field (negative), late goes the other way
  const sprayAngle = K_PHI * t;

  const kind = classify(e, t, quality, radius, sprayAngle);
  if (player.skill === 'passion' && kind === 'just') exitVelocity *= PASSION_EXIT_BONUS;
  exitVelocity = Math.min(exitVelocity, EXIT_VELOCITY_MAX);

  return {
    kind, e, t, u, quality, exitVelocity, launchAngle, sprayAngle,
    spin: spinForContact(launchAngle, sprayAngle),
    contactHeight: ball.y,
  };
};
