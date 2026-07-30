/**
 * How a player grows: the サクセス half of the game.
 *
 * The owner's brief on 令和8年7月30日: each player starts with DIFFERENT
 * abilities — 「例えばミートがG、パワーがF」 — nobody starts above E, everybody
 * starts at 弾道1, and levelling both raises the numbers and unlocks special
 * abilities. 「パワプロのサクセスのような感じ」.
 *
 * The shape that follows from that:
 *
 *   - abilities are a FUNCTION of level, not stored. A save holds experience;
 *     everything else is derived. There is then no way for a save to describe a
 *     player who could not have been grown, and no migration to write when the
 *     curve is tuned.
 *   - each player keeps his own experience. Choosing 敦司 is starting his
 *     save, not reskinning 貴也's, which is what サクセス means and what makes
 *     three characters worth having now that they are otherwise identical.
 *   - the three grow toward DIFFERENT ceilings. Growing everyone to 100/100
 *     would make the starting differences a temporary annoyance rather than a
 *     character.
 *
 * Pure (PROMPT.md 2): no clock, no storage, no randomness.
 */

import type { PlayerId } from './constants.js';
import type { Trajectory } from './ranks.js';
import { clampAbility, clampPower, rankOf } from './ranks.js';
import { levelOf, xpToReach } from './level.js';

export type SpecialId = 'powerHitter' | 'artist' | 'kingOfOne' | 'wideAngle';

/**
 * The three power abilities are ONE SLOT: only the best owned is active.
 *
 * The owner's rule — 「それぞれが同時につくのではなく、いずれか1つずつだけが
 * つく形に」 — and it matches the source, where アーチスト（金特）replaces
 * パワーヒッター（青特）rather than adding to it. 広角打法 is a different kind
 * of ability and sits in its own slot, so a finished player carries two: the
 * best of the power line, and 広角打法.
 */
export const POWER_LINE: readonly SpecialId[] = ['powerHitter', 'artist', 'kingOfOne'];

export type Ability = {
  readonly meet: number;
  readonly power: number;
  readonly trajectory: Trajectory;
  readonly specials: readonly SpecialId[];
  /**
   * 限界突破 progress, 0 (not started) to 1 (complete).
   *
   * Carried on the Ability rather than passed alongside it because the exit
   * ceiling depends on it (src/core/ranks.ts exitCeiling) and src/core/bat.ts
   * already has the Ability in hand. A second parameter threaded through the
   * same call chain is a second thing to forget.
   */
  readonly breakthrough: number;
};

/**
 * Where each player begins. 【調整可】
 *
 * Inside G(1-19), F(20-39) and E(40-49) only — E is the owner's stated ceiling
 * for a starting player — and no two the same, so the choice on the select
 * screen means something on the very first pitch.
 *
 *   勇樹   ミートG(14)  パワーE(44)   power, cannot make contact
 *   貴也   ミートF(33)  パワーF(31)   the balanced one
 *   敦司   ミートE(45)  パワーG(17)   contact, cannot clear a fence
 */
export const START: Readonly<Record<PlayerId, { readonly meet: number; readonly power: number }>> = {
  yuki: { meet: 14, power: 44 },
  takaya: { meet: 33, power: 31 },
  atsushi: { meet: 45, power: 17 },
};

/**
 * Where each player ends at level 99. 【調整可】
 *
 * Nobody reaches 100 in both. 勇樹 finishes a slugger who still swings through
 * pitches; 敦司 finishes able to hit anything and still short of the fence
 * without a bat behind him; 貴也 finishes second-best at everything, which is
 * its own thing to be.
 */
export const CAP: Readonly<Record<PlayerId, { readonly meet: number; readonly power: number }>> = {
  yuki: { meet: 72, power: 100 },
  takaya: { meet: 88, power: 86 },
  atsushi: { meet: 100, power: 70 },
};

export const MAX_LEVEL_ABILITY = 99;

/**
 * Growth curve, 0 at level 1 and 1 at level 99. 【調整可】
 *
 * Square root rather than linear: the first levels arrive quickly and have to
 * FEEL like something, and at level 1 a player cannot clear the fence at all, so
 * the early gain is the one that decides whether anybody reaches level 10. A
 * linear curve puts most of the growth in the levels nobody has reached yet.
 */
export const growth = (level: number): number => {
  const l = Math.max(1, Math.min(MAX_LEVEL_ABILITY, Math.floor(level)));
  return Math.sqrt((l - 1) / (MAX_LEVEL_ABILITY - 1));
};

/**
 * Level at which 弾道 reaches each step. 【調整可】
 *
 * Everyone starts at 1, per the owner's correction 「やっぱり1に統一で」. 弾道 is
 * the single biggest lever on whether a ball leaves the park — 17 degrees to 30
 * — so these are spaced out and 4 is genuinely late.
 */
export const TRAJECTORY_LEVELS: readonly number[] = [1, 12, 34, 62];

export const trajectoryAt = (level: number): Trajectory => {
  let out = 1;
  for (const [i, need] of TRAJECTORY_LEVELS.entries()) if (level >= need) out = i + 1;
  return Math.max(1, Math.min(4, out)) as Trajectory;
};

/** Level at which each special ability unlocks. 【調整可】 */
export const SPECIAL_LEVEL: Readonly<Record<SpecialId, number>> = {
  powerHitter: 20,
  wideAngle: 32,
  artist: 45,
  kingOfOne: 80,
};

/**
 * Power added by the power line. 【owner-specified】
 *
 * +5 / +10 / +15, set by the owner on 令和8年7月30日. They do not stack — see
 * POWER_LINE — so this is the value of the best one owned, not a sum.
 */
export const SPECIAL_POWER: Readonly<Record<SpecialId, number>> = {
  powerHitter: 5,
  artist: 10,
  kingOfOne: 15,
  wideAngle: 0,
};

/**
 * Names and effect text.
 *
 * The first two are パワプロ's own, with the effect wording taken from the
 * game's ability list (game8, read 令和8年7月30日): パワーヒッター is a 青特,
 * 「強振して打つとホームラン性の打球が出やすくなる」, and アーチスト is the 金特
 * version, 「かなり出やすくなる」. Ours are the same idea expressed in the only
 * terms this game has — launch angle and exit velocity — because there is no
 * 強振/ミート打ち distinction here to hang them off.
 *
 * 世界の王 is the owner's, asked for by name as the strongest ability. NOTE: it
 * refers to a real player, and PROMPT.md 0/5 forbids real player names. The
 * owner overrode that; the real name is kept out of the shipped strings and
 * only the epithet is used. Recorded in docs/PROGRESS.md as 要判断.
 */
export const SPECIAL_NAME: Readonly<Record<SpecialId, string>> = {
  powerHitter: 'パワーヒッター',
  artist: 'アーチスト',
  kingOfOne: '世界のワン',
  wideAngle: '広角打法',
};

export const SPECIAL_NOTE: Readonly<Record<SpecialId, string>> = {
  powerHitter: 'パワー +5。打ち出し角が一番飛ぶ角度に40%寄る',
  artist: 'パワー +10。一番飛ぶ角度に65%寄る',
  kingOfOne: 'パワー +15。一番飛ぶ角度に90%／獲得経験値 1.35倍',
  wideAngle: '振り遅れても詰まらない。流し打ちの打球が伸びる',
};

/** 青特 or 金特, for the colour the UI paints them. */
export const SPECIAL_TIER: Readonly<Record<SpecialId, 'blue' | 'gold' | 'crown'>> = {
  powerHitter: 'blue',
  wideAngle: 'blue',
  artist: 'gold',
  kingOfOne: 'crown',
};

export const SPECIAL_IDS: readonly SpecialId[] =
  ['powerHitter', 'wideAngle', 'artist', 'kingOfOne'];

/**
 * The abilities ACTIVE at a level — not the ones unlocked.
 *
 * The power line collapses to its best member here rather than in each of the
 * four places that read it. Returning all three and expecting every caller to
 * remember they supersede is how a UI ends up showing three badges for one
 * effect, and how a bonus ends up applied three times.
 */
export const specialsAt = (level: number): readonly SpecialId[] => {
  const out: SpecialId[] = [];
  const best = [...POWER_LINE].reverse().find((id) => level >= SPECIAL_LEVEL[id]);
  if (best) out.push(best);
  if (level >= SPECIAL_LEVEL.wideAngle) out.push('wideAngle');
  return out;
};

/** Everything unlocked so far, superseded or not. For the collection screen. */
export const specialsUnlockedAt = (level: number): readonly SpecialId[] =>
  SPECIAL_IDS.filter((id) => level >= SPECIAL_LEVEL[id]);

/** Power added by whichever of the power line is active. Never a sum. */
export const specialPower = (specials: readonly SpecialId[]): number => {
  const active = POWER_LINE.filter((id) => specials.includes(id));
  return active.reduce((best, id) => Math.max(best, SPECIAL_POWER[id]), 0);
};

/**
 * How 広角打法 reshapes the penalty for being LATE. 【調整可】
 *
 * The owner's brief: 「振り遅れたときなどの流し打ちっぽくなった際にも、打球に
 * 伸びが出るように」「振り遅れても詰まったりせず、通常の軌道で伸びる」. In the
 * source it reads 「流し方向に強い打球が打てるようになる」.
 *
 * An EXPONENT on the normalised timing error, not a multiplier on it. A
 * multiplier would widen the window — a swing 99% too late would suddenly
 * produce two thirds of a perfect one, a cliff at the edge with nothing behind
 * it. Raising a 0-to-1 error to the power 1.9 leaves both ends exactly where
 * they were (0 stays 0, 1 stays 1) and lifts everything in between: half a
 * window late costs 27% instead of 50%. The swing still fails when it is truly
 * late, and it carries when it is merely behind.
 *
 * Late only, and the spray angle is untouched, so the ball still goes the other
 * way — it just gets there with something on it.
 */
export const WIDE_ANGLE_LATE_SHAPE = 1.9;

export const lateShapeFor = (specials: readonly SpecialId[]): number =>
  (specials.includes('wideAngle') ? WIDE_ANGLE_LATE_SHAPE : 1);

// ---------------------------------------------------------------------------
// what the specials actually do
// ---------------------------------------------------------------------------

/**
 * The launch angle a special PULLS TOWARD, and how hard, rather than adds.
 *
 * THIS IS THE SECOND TIME A REWARD TURNED OUT TO BE A PUNISHMENT, and it is the
 * same shape as the first. Adding degrees looks right until you measure it: 弾道4
 * is 30 degrees, the crown added 10, and 40 degrees is well past the angle that
 * carries furthest — so a level-80 batter hit the ball 8 m SHORTER than he had
 * at level 60. The strongest ability in the game made you worse, and nothing on
 * screen said so.
 *
 * Pulling toward a target cannot do that. It is also what the source says the
 * abilities do: 「ホームラン性の打球が出やすくなる」 is about producing the kind
 * of ball that leaves the park, not about hitting it vertically. A batter who is
 * already lofting gains little, which is correct — he is already there.
 */
const SPECIAL_PULL: Readonly<Record<SpecialId, number>> = {
  powerHitter: 0.40,
  artist: 0.65,
  kingOfOne: 0.90,
  wideAngle: 0,
};

/**
 * The launch angle that carries furthest, for a given power. 【要確認：実測】
 *
 * Keyed on the exit velocity the swing ACTUALLY produced, not on the power rank.
 * The bat raises exit velocity too — the strongest one by 14% — so keying on
 * power alone left a level-62 batter holding the endgame bat aiming a degree and
 * a half above his own optimum, and the last 弾道 step cost him 0.34 m.
 *
 * NOT a constant either, which was the first thing this got wrong. Measured
 * against src/core/physics.js on 令和8年7月30日:
 *
 *     144 km/h -> 31 deg     158 km/h -> 29.5 deg
 *     173 km/h -> 28 deg     187 km/h -> 27 deg
 *
 * The optimum FALLS as the ball is hit harder, because drag scales with the
 * square of speed and a faster ball spends its extra energy fighting the air
 * rather than climbing. A fixed 「ideal angle」 is therefore wrong for somebody,
 * and it was wrong for exactly the players the specials are meant to reward.
 */
export const idealLaunchAngle = (exitKmh: number): number => {
  // Straight off the measurements: 0.093 degrees lower per km/h, anchored at
  // 31 degrees for 144 km/h. Clamped either side of the measured range.
  const raw = 31 - (exitKmh - 144) * 0.093;
  return Math.max(25, Math.min(33, raw));
};

/**
 * The launch angle after the specials, aimed at what is optimal FOR THIS BATTER.
 *
 * 世界の王 supersedes the two below it rather than stacking, which is how 金特
 * replaces 青特 in the source.
 */
export const liftedLaunchAngle = (
  base: number, specials: readonly SpecialId[], exitKmh = 155,
): number => {
  const id = [...POWER_LINE].reverse().find((s) => specials.includes(s));
  if (!id) return base;
  return base + (idealLaunchAngle(exitKmh) - base) * SPECIAL_PULL[id];
};

/** How many degrees the specials are worth on top of a given base. */
export const specialLift = (
  specials: readonly SpecialId[], base = 17, exitKmh = 155,
): number => liftedLaunchAngle(base, specials, exitKmh) - base;

/**
 * The specials do NOT touch exit velocity. Deliberately.
 *
 * The first version gave them +3/5/9%, and at level 99 that quietly ate the
 * bats: effectiveMaxExit divides the 197.8 km/h ceiling by the special's
 * multiplier to keep a mistimed swing from clamping to the same number as a
 * perfect one, so the crown's 9% left the strongest bat delivering 5.5% of its
 * advertised 14%. Two rewards competing for one headroom, and the newer one
 * silently winning — the same trap as star-judgement 12, in a different place.
 *
 * Angle-only is also closer to the source. パワーヒッター and アーチスト read
 * 「ホームラン性の打球が出やすくなる」 and 「かなり出やすくなる」: they change
 * what KIND of ball comes off the bat, not how hard it is hit.
 */
export const specialExit = (_specials: readonly SpecialId[]): number => 1;

/** Experience multiplier from the specials. Only the crown pays. */
export const specialXp = (specials: readonly SpecialId[]): number =>
  (specials.includes('kingOfOne') ? 1.35 : 1);

// ---------------------------------------------------------------------------
// the whole ability set
// ---------------------------------------------------------------------------

/** Everything a player can do, at a given level. */
export const abilityAt = (
  player: PlayerId, level: number, breakthrough = 0,
): Ability => {
  const l = Math.max(1, Math.min(MAX_LEVEL_ABILITY, Math.floor(level)));
  const f = growth(l);
  const b = Math.max(0, Math.min(1, breakthrough));
  const start = START[player];
  const cap = CAP[player];
  /*
   * The limit break lifts the CAP, and the level curve then climbs to it. It is
   * not added to the finished value.
   *
   * The difference matters at the seam: adding would step the power up the
   * instant a star landed, and a batter whose distance jumps between one pitch
   * and the next reads as a bug rather than as growth. Lifting the cap while
   * breakthrough itself moves continuously (breakthroughForXp) means every
   * round nudges the ball a little further, and the stars are milestones drawn
   * over a ramp rather than the ramp itself.
   *
   * The cap SCALES, so the three characters keep the identities the owner asked
   * for (令和8年7月30日): 勇樹's power cap is the scale maximum and doubles to
   * 200, 貴也's 86 goes to 172, 敦司's 70 to 140. Flattening everyone to 200
   * would end the limit break with three identical batters.
   */
  const powerCap = cap.power * (1 + BREAK_POWER_GAIN * b);
  return {
    meet: clampAbility(start.meet + (cap.meet - start.meet) * f),
    power: clampPower(start.power + (powerCap - start.power) * f),
    trajectory: trajectoryAt(l),
    specials: specialsAt(l),
    breakthrough: b,
  };
};

/** Convenience: the ability set implied by an experience total. */
export const abilityForXp = (player: PlayerId, xp: number): Ability =>
  abilityAt(player, levelOf(xp), breakthroughForXp(xp));

/** The letters, for the select screen. */
export const abilityRanks = (a: Ability): { readonly meet: string; readonly power: string } => ({
  meet: rankOf(a.meet),
  power: rankOf(a.power),
});

// ---------------------------------------------------------------------------
// 限界突破
// ---------------------------------------------------------------------------

/**
 * How much the power CAP is multiplied by at full limit break. 【要判断】
 *
 * 1 means "doubled": the owner asked for a power maximum of 200 where the scale
 * tops out at 100 (令和8年7月31日). Measured carry at the strongest bat and a
 * perfectly timed swing, optimum launch angle, no wind:
 *
 *     power 100 -> 190.4 km/h -> 150.1 m
 *     power 115 -> 197.4 km/h -> 155.9 m   (the old ceiling)
 *     power 200 -> 237.1 km/h -> 186.4 m
 *
 * So the limit break is worth about 30 metres, not a different game: the fence
 * is 115 m and a well-struck ball already cleared it by 41 m before any of
 * this. Difficulty lives in the timing window, which the limit break does not
 * touch (see clampPower).
 */
export const BREAK_POWER_GAIN = 1.0;

/** Stars shown for a completed limit break. Display only; the ramp is smooth. */
export const BREAK_STARS = 5;

/**
 * Experience per star, on top of everything level 99 cost. 【調整可】
 *
 * Level 99 is about 347,000 experience, so five stars at 90,000 is a tail
 * slightly longer than the whole ladder that precedes it. That is the intent:
 * a limit break that arrives in an evening is not one. At the twenty thousand
 * a strong late-game round pays, a star is four or five rounds.
 */
export const BREAK_XP_PER_STAR = 90_000;

/** Limit-break progress for an experience total, 0..1. */
export const breakthroughForXp = (xp: number): number => {
  const base = xpToReach(MAX_LEVEL_ABILITY);
  const span = BREAK_STARS * BREAK_XP_PER_STAR;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(1, (xp - base) / span));
};

/** Whole stars earned, 0..BREAK_STARS. */
export const starsForXp = (xp: number): number =>
  Math.floor(breakthroughForXp(xp) * BREAK_STARS + 1e-9);

/** Progress through the current star, 0..1, for the level bar past 99. */
export const starProgress = (xp: number): number => {
  const b = breakthroughForXp(xp) * BREAK_STARS;
  if (b >= BREAK_STARS) return 1;
  return b - Math.floor(b);
};
