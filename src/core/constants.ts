/**
 * Every tunable number in one place. Values and their provenance are documented
 * in docs/SPEC.md; the labels below say which are sourced facts and which are
 * game-design dials, because only the dials may be touched during balancing.
 *
 * 【確定】 = taken from a primary source. Do not "tune" these.
 * 【調整可】 = a game-design dial. docs/SPEC.md 8-3 and 9-2 say which ones
 *              balancing (M7) is allowed to move.
 */

// ---------------------------------------------------------------------------
// ball and air 【確定】 — MLB Rule 3.01, Alan Nathan's trajectory calculator
//   https://baseball.physics.illinois.edu/TrajectoryCalculator-new-3D-June2026.xlsx
//   https://baseball.physics.illinois.edu/TrajectoryAnalysis.pdf
// ---------------------------------------------------------------------------

/** Ball mass [kg]. 5.125 oz, the midpoint of the 5–5.25 oz rule range. */
export const BALL_MASS = 0.145291;

/** Ball radius [m]. Circumference 9.125 in / 2π. */
export const BALL_RADIUS = 0.036888;

/** Cross-sectional area [m^2]. */
export const BALL_AREA = Math.PI * BALL_RADIUS * BALL_RADIUS;

/** Air density at sea level, 20 degC [kg/m^3]. The game's standard conditions. */
export const AIR_DENSITY = 1.2046;

/**
 * Air density the published distance table was computed at: 75 degF, sea level,
 * RH 50%, 29.92 inHg. Only used when checking against that table — comparing at
 * a different density would be apples to oranges.
 */
export const REFERENCE_AIR_DENSITY = 1.1822;

/**
 * Hard cap on exit velocity [m/s]. The fastest batted ball ever measured is
 * 197.8 km/h (122.9 mph, 2025). Skills multiply exit velocity, so without a cap
 * yuki's "passion" would push 185 -> 203.5 km/h, past anything a human has done.
 */
export const EXIT_VELOCITY_MAX = 197.8 / 3.6;

export const GRAVITY = 9.807;

/**
 * Drag coefficient. Note it RISES with spin, which is why more backspin does
 * not simply mean more distance — see docs/SPEC.md 6-5.
 */
export const CD_BASE = 0.3008;
export const CD_PER_KRPM = 0.0292;

/**
 * Lift coefficient fit: Cl = CL_NUM * S / (CL_A + CL_B * S), saturating at 0.48.
 *
 * The widely quoted `Cl = 1.5 S / (0.25 + S)` is NOT in any primary source and
 * is wrong — it gives Cl = 0.667 at S = 0.2 where the measured value is 0.21.
 * Integrating with it produces 8-second hang times and a 15-degree optimal
 * launch angle, i.e. a game where hitting the ball LOWER makes it travel
 * further, which inverts the meaning of the trajectory rank. Do not "restore" it.
 */
export const CL_NUM = 1.120;
export const CL_A = 0.583;
export const CL_B = 2.333;

/** Fixed integration step [s]. PROMPT.md 2 pins this. */
export const DT = 1 / 240;

/** Give up on a trajectory after this long [s]; a real fly ball hangs ~6 s. */
export const MAX_FLIGHT_TIME = 15;

// ---------------------------------------------------------------------------
// batted-ball spin 【確定】 — Statcast regression, Nathan calculator cells G4/G5
// ---------------------------------------------------------------------------

export const SPIN_BASE = -763;
export const SPIN_PER_DEG_LAUNCH = 120;
export const SPIN_MIN = 600;
export const SPIN_MAX = 3600;

/**
 * The published fit also has a +21 rpm per degree of spray angle term. It is
 * DELIBERATELY NOT USED: including it lets a slightly early swing shed backspin
 * and therefore travel further, which violates PROMPT.md 3-4. Kept here only so
 * the omission is visible rather than looking like an oversight.
 */
export const SPIN_PER_DEG_SPRAY_UNUSED = 21;

export const SIDESPIN_BASE = 849;
export const SIDESPIN_PER_DEG_SPRAY = 94;

/**
 * Cap on sidespin magnitude [rpm]. Without it a ball sprayed 43 degrees would
 * carry 4891 rpm of sidespin, well past anything measured, and the resulting
 * drag would make the short corners harder to clear than centre field.
 */
export const SIDESPIN_MAX = 2200;

// ---------------------------------------------------------------------------
// field 【確定】 — NPB stadium distribution, 公認野球規則
// ---------------------------------------------------------------------------

/** Fence distance [m] at 0 / 22.5 / 45 degrees from centre. */
export const FENCE_CENTRE = 120.0;
export const FENCE_ALLEY = 112.0;
export const FENCE_LINE = 98.0;
export const FENCE_HEIGHT = 3.6;

/** Fair territory is |phi| <= this [deg]. */
export const FOUL_ANGLE = 45;

export const PLATE_HALF_WIDTH = 0.216;
export const ZONE_BOTTOM = 0.473;
export const ZONE_TOP = 0.936;

/** Home plate to the pitcher's rubber [m], and mound height [m]. */
export const MOUND_DISTANCE = 18.44;
export const MOUND_HEIGHT = 0.254;

/** Release point to the front of the plate [m], drag included in flight times. */
export const RELEASE_DISTANCE = 16.70;

/** Height the bat meets the ball at when no pitch is involved [m]. */
export const DEFAULT_CONTACT_HEIGHT = 0.9144;

// ---------------------------------------------------------------------------
// contact model 【調整可】 — docs/SPEC.md 4-3, 4-4. These are the dials.
// ---------------------------------------------------------------------------

/** Exit velocity of the weakest possible contact [m/s]. */
export const V_MIN = 22.0;

/** Swing input to bat-meets-ball [s]. */
export const T_SWING = 0.130;

/** |t| within this counts as just-met [s]. */
export const T_JUST = 0.025;

/** |t| beyond this is a swinging strike [s]. */
export const T_MISS = 0.115;

/** Fraction of the catch radius that counts as the sweet spot. */
export const R_JUST_RATIO = 0.35;

/** Contact quality below this is a foul. */
export const Q_FOUL = 0.30;

/** Contact quality below this is mishit rather than solid. */
export const Q_GOOD = 0.55;

/** Exponents weighting meet error vs timing error in the quality product. */
export const Q_MEET_EXP = 0.7;
export const Q_TIME_EXP = 1.3;

/** Undercut of 1 cm adds this much launch angle [deg/m]. */
export const K_THETA = 260;

/** A higher pitch produces a slightly flatter ball [deg/m]. */
export const K_HEIGHT = -6.0;

/** Reference pitch height for K_HEIGHT [m]. */
export const HEIGHT_REF = 0.75;

/** Timing error to spray angle [deg/s]. Early (t<0) pulls, i.e. phi < 0. */
export const K_PHI = 380;

export const THETA_MIN = 2;
export const THETA_MAX = 48;

// ---------------------------------------------------------------------------
// players 【確定：基礎ランクは変更禁止】 PROMPT.md 0-4
// ---------------------------------------------------------------------------

export type Rank = 'S' | 'A' | 'B' | 'C' | 'D' | 'E';
export type Trajectory = 1 | 2 | 3 | 4;
export type PlayerId = 'yuki' | 'takaya' | 'atsushi';
export type SkillId = 'passion' | 'tenacity' | 'aimHigh';

/** Meet rank to cursor radius [m] 【調整可】. */
export const CURSOR_RADIUS: Readonly<Record<Rank, number>> = {
  S: 0.115, A: 0.100, B: 0.088, C: 0.076, D: 0.064, E: 0.052,
};

/**
 * Power rank to maximum exit velocity [km/h] 【調整可】.
 *
 * S is set so that S x PASSION_EXIT_BONUS (178 x 1.10 = 195.8) still sits below
 * EXIT_VELOCITY_MAX. That is not cosmetic: if the cap binds, a slightly mistimed
 * swing produces the SAME exit velocity as a perfect one, only the spin differs,
 * and the monotonicity property in PROMPT.md 3-4 breaks. Caught by
 * tests/bat.test.ts. Keep S * 1.10 < 197.8 when tuning.
 */
export const MAX_EXIT_KMH: Readonly<Record<Rank, number>> = {
  S: 178, A: 172, B: 167, C: 163, D: 159, E: 155,
};

/**
 * Trajectory rank to base launch angle [deg] 【調整可】.
 *
 * Deliberately low. PROMPT.md 0-4 defines atsushi's skill as "makes up for the
 * low trajectory 2 with technique", so trajectory 2 must NOT clear the fence on
 * its own — otherwise the skill has nothing to fix. See docs/SPEC.md 8-2-1.
 */
export const BASE_LAUNCH_ANGLE: Readonly<Record<Trajectory, number>> = {
  1: 17, 2: 22, 3: 26, 4: 29,
};

export type PlayerSpec = {
  readonly id: PlayerId;
  readonly name: string;
  readonly roman: string;
  readonly number: number;
  readonly meet: Rank;
  readonly power: Rank;
  readonly trajectory: Trajectory;
  readonly skill: SkillId;
};

/** PROMPT.md 0-4 fixes meet / power / trajectory. They must never be edited. */
export const PLAYERS: Readonly<Record<PlayerId, PlayerSpec>> = {
  yuki: {
    id: 'yuki', name: '籠田 勇樹', roman: 'YUKI', number: 3,
    meet: 'E', power: 'S', trajectory: 4, skill: 'passion',
  },
  takaya: {
    id: 'takaya', name: '籠田 貴也', roman: 'TAKAYA', number: 1,
    meet: 'B', power: 'A', trajectory: 3, skill: 'tenacity',
  },
  atsushi: {
    id: 'atsushi', name: '安藤 敦司', roman: 'ATSUSHI', number: 7,
    meet: 'S', power: 'C', trajectory: 2, skill: 'aimHigh',
  },
};

export const PLAYER_IDS: readonly PlayerId[] = ['yuki', 'takaya', 'atsushi'];

// ---------------------------------------------------------------------------
// skills 【調整可】 — the primary balancing dials, PROMPT.md 0-4
// ---------------------------------------------------------------------------

/** yuki: exit velocity multiplier on a just-met ball. */
export const PASSION_EXIT_BONUS = 1.10;

/** yuki: cursor radius multiplier after this many consecutive whiffs. */
export const PASSION_WHIFF_STREAK = 2;
export const PASSION_CURSOR_BONUS = 1.5;

/** takaya: fouls per round that do not cost an out. */
export const TENACITY_FREE_FOULS = 3;

/** atsushi: multiplier on how much cursor Y affects launch angle. */
export const AIM_HIGH_FACTOR = 1.5;

// ---------------------------------------------------------------------------
// scoring 【調整可】 — PROMPT.md 0-1 allows K_DIST and the combo cap to move
// ---------------------------------------------------------------------------

export const OUTS_PER_ROUND = 10;
export const SCORE_BASE = 100;
export const SCORE_DISTANCE_REF = 120;
export const K_DIST = 2.0;
export const COMBO_STEP = 0.1;
export const COMBO_MAX = 2.0;

/** A "titanic" home run [m]. Real-world: 140 m is the top 0.51% of MLB homers. */
export const TITANIC_DISTANCE = 140;
