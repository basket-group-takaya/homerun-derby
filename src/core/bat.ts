/**
 * Bat-ball contact: turns where the cursor was and when the swing happened into
 * an exit velocity, a launch angle, a spray angle and a spin.
 *
 * PROMPT.md 5 forbids faking the result with random numbers. Nothing here is
 * random: every output is a deterministic function of the inputs, and
 * tests/bat.test.ts pins the three monotonicity properties that make the
 * cause-and-effect legible to a player.
 */

import type { Ability } from './ability.js';
import { lateShapeFor, liftedLaunchAngle, specialExit, specialPower } from './ability.js';
import type { BatSpec } from './bats.js';
import { BATS, DEFAULT_BAT, effectiveMaxExit } from './bats.js';
import { BASE_LAUNCH_ANGLE, catchRadiusFor } from './ranks.js';
import {
  BALL_RADIUS, EXIT_VELOCITY_MAX,
  FOUL_ANGLE, HEIGHT_REF, K_HEIGHT, K_PHI, K_THETA,
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
  /**
   * The batter's numbers, not his identity.
   *
   * It used to be a PlayerSpec carrying fixed letter ranks. Abilities now grow
   * with level (src/core/ability.ts), so a rank is a way of DISPLAYING a number
   * rather than the number itself, and contact has to be resolved against the
   * value the player currently has rather than against who he is.
   */
  readonly ability: Ability;
  /** Where the meet cursor was when the swing landed. */
  readonly cursor: ZonePoint;
  /** Where the ball crossed the zone plane. */
  readonly ball: ZonePoint;
  /** Swing timing error [s]. Negative is early. */
  readonly timingError: number;
  /** Consecutive whiffs so far this round. Kept for the HUD, unused in the maths. */
  readonly whiffStreak?: number;
  /** Equipped bat. Optional so existing call sites keep working. */
  readonly bat?: BatSpec;
  /**
   * Set when the pitch cannot be hit at all, whatever the swing.
   *
   * The fork. It is out of the zone by construction and the owner asked that
   * swinging at one always miss, so the decision is "lay off", not "aim better".
   * Putting it here rather than in game.ts keeps the rule testable in core and
   * keeps the returned Contact well formed, with the real timing error in it.
   */
  readonly unhittable?: boolean;
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
export const catchRadius = (ability: Ability): number =>
  catchRadiusFor(ability.meet) + BALL_RADIUS;

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
  const { ability, cursor, ball, timingError: t } = input;
  const bat = input.bat ?? BATS[DEFAULT_BAT];

  const dx = ball.x - cursor.x;
  const u = ball.y - cursor.y;
  const e = Math.hypot(dx, u);
  const radius = catchRadius(ability);

  const miss = (): Contact => ({
    kind: 'whiff', e, t, u, quality: 0,
    exitVelocity: 0, launchAngle: 0, sprayAngle: 0,
    spin: { backspinRpm: 0, sidespinRpm: 0 },
    contactHeight: ball.y,
  });
  if (input.unhittable) return miss();
  // The bat widens the timing window; that is what it buys now that there is no
  // cursor for it to widen instead.
  const window = T_MISS * bat.timing;
  if (e > radius || Math.abs(t) > window) return miss();

  // Quadratic falloff, not linear. Linear made the sweet spot a cliff: 33 ms of
  // timing error (2 frames at 60fps) cost a right-handed A-power hitter 30 m of
  // carry, so anything short of frame-perfect was a ground out. Squaring the
  // normalised error keeps the centre forgiving and still collapses at the edge.
  // Both terms remain monotonically decreasing, so PROMPT.md 3-4 still holds.
  const meetError = clamp(e / radius, 0, 1);
  // 広角打法 reshapes the LATE half of the curve; see WIDE_ANGLE_LATE_SHAPE.
  const rawTime = clamp(Math.abs(t) / window, 0, 1);
  const timeError = t > 0 ? Math.pow(rawTime, lateShapeFor(ability.specials)) : rawTime;
  const qMeet = 1 - meetError * meetError;
  const qTime = 1 - timeError * timeError;
  const quality = Math.pow(qMeet, Q_MEET_EXP) * Math.pow(qTime, Q_TIME_EXP);

  // The bat scales the CEILING, not the instantaneous value. See the long
  // comment on effectiveMaxExit: scaling the value clamps at the physical limit
  // and destroys the monotonicity PROMPT.md 3-4 requires.
  const lift = specialExit(ability.specials);
  // The power line adds to the VALUE, not to the result: +5, +10 or +15, whichever
  // one is active. Feeding it through effectiveMaxExit rather than multiplying the
  // exit velocity afterwards is what keeps it under the record without clamping.
  const power = ability.power + specialPower(ability.specials);
  const maxExit = effectiveMaxExit(power, bat, lift);
  let exitVelocity = (V_MIN + (maxExit - V_MIN) * quality) * lift;

  /*
   * Launch angle: 弾道, plus what the special abilities add, plus the undercut,
   * plus a small correction for a high or low pitch.
   *
   * specialLift is where パワーヒッター and アーチスト live. In the source
   * material they read 「強振して打つとホームラン性の打球が出やすくなる」 and
   * 「かなり出やすくなる」; there is no 強振/ミート打ち split here to hang that
   * off, so they become degrees of launch angle, which is the same claim
   * expressed in the only vocabulary this game has.
   */
  const launchAngle = clamp(
    liftedLaunchAngle(
      BASE_LAUNCH_ANGLE[ability.trajectory], ability.specials, exitVelocity * 3.6)
      + K_THETA * u + K_HEIGHT * (ball.y - HEIGHT_REF),
    THETA_MIN, THETA_MAX);

  // spray: early pulls toward left field (negative), late goes the other way
  const sprayAngle = K_PHI * t;

  const kind = classify(e, t, quality, radius, sprayAngle);
  exitVelocity = Math.min(exitVelocity, EXIT_VELOCITY_MAX);

  return {
    kind, e, t, u, quality, exitVelocity, launchAngle, sprayAngle,
    spin: spinForContact(launchAngle, sprayAngle),
    contactHeight: ball.y,
  };
};
