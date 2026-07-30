/**
 * Ability values and their letter ranks, on the パワプロ scale.
 *
 * The owner asked for abilities expressed 「パワプロの数値を基準として」, with
 * G the floor, F the middle and E the best a player starts at. So abilities are
 * NUMBERS from here on, 1 to 100, and the letter is a display of the number
 * rather than the thing itself — which is what パワプロ does and why the same
 * letter can hide a nineteen-point spread.
 *
 * 【確定】 The table below is パワプロアプリ's, from GameWith's 選手能力 page
 * (https://パワプロ.gamewith.jp/article/show/343271, read 令和8年7月30日):
 *
 *     S 90-100 / A 80-89 / B 70-79 / C 60-69 / D 50-59 / E 40-49 / F 20-39 / G 1-19
 *
 * Note F and G are twenty points wide while D through A are ten. That is not a
 * transcription error, it is the real table: the low ranks are coarse because
 * nobody cares about the difference between a 22 and a 38.
 *
 * 弾道 is 1 to 4, also 【確定】 from the same page.
 *
 * Pure (PROMPT.md 2).
 */
// constants.ts imports nothing, so taking the two velocity ceilings from it
// cannot make a cycle.
import { BREAKTHROUGH_EXIT_VELOCITY_MAX, EXIT_VELOCITY_MAX } from './constants.js';
export const RANKS = ['G', 'F', 'E', 'D', 'C', 'B', 'A', 'S'];
/** The lowest ability value that earns each rank. */
export const RANK_FLOOR = {
    G: 1, F: 20, E: 40, D: 50, C: 60, B: 70, A: 80, S: 90,
};
export const ABILITY_MIN = 1;
export const ABILITY_MAX = 100;
/**
 * The ceiling once 限界突破 is complete. 【調整可・要判断】
 *
 * The パワプロ scale stops at 100 and so does every rank letter; this is the
 * owner's post-99 mode (令和8年7月31日), where the number keeps going and the
 * letter has nothing left to say. Anything above 100 displays as S.
 */
export const BREAKTHROUGH_ABILITY_MAX = 200;
/**
 * The highest EFFECTIVE power, once a special ability has added to it.
 *
 * 100 is the top of the displayed scale; this is the top of the arithmetic. The
 * two have to differ, because 世界のワン adds 15 and a level-99 slugger is
 * already at 100 — clamping at 100 would have made the strongest ability in the
 * game do exactly nothing for the player most likely to own it. パワプロ has the
 * same problem and the same answer: S1 and above are real values past 100.
 */
/** What 世界のワン adds to the power VALUE. See SPECIAL_POWER in ability.ts. */
export const CROWN_BONUS = 15;
/** The arithmetic power ceiling before 限界突破: the scale, plus the crown. */
export const EFFECTIVE_POWER_MAX_BASE = ABILITY_MAX + CROWN_BONUS;
export const EFFECTIVE_POWER_MAX = BREAKTHROUGH_ABILITY_MAX + CROWN_BONUS;
/** The best rank a player may start at, per the owner: 最低G・中間F・良いE. */
export const START_RANK_CAP = 'E';
export const clampAbility = (v) => Math.max(ABILITY_MIN, Math.min(ABILITY_MAX, Math.round(v)));
/**
 * Power only, and only power, may exceed 100.
 *
 * Meet stays on the 1-100 scale deliberately. Meet is the contact radius — the
 * size of the target the swing has to find — so raising it does not make the
 * ball go further, it makes the game stop asking anything. The limit break has
 * to be felt in the distance and not in the difficulty, or there is no game
 * left to play with the reward.
 */
export const clampPower = (v) => Math.max(ABILITY_MIN, Math.min(BREAKTHROUGH_ABILITY_MAX, Math.round(v)));
/** The letter for an ability value. */
export const rankOf = (value) => {
    const v = clampAbility(value);
    let out = 'G';
    for (const r of RANKS)
        if (v >= RANK_FLOOR[r])
            out = r;
    return out;
};
/** Where a rank sits in the order, G = 0. Useful for comparisons in tests. */
export const rankIndex = (r) => RANKS.indexOf(r);
/**
 * Meet value to catch radius [m] 【調整可】.
 *
 * Kept even though the swing is one button and the bat always meets the ball,
 * because the radius is what the timing window is scaled against and because a
 * later mode might reintroduce aiming. Linear from a G that could not hit a
 * beach ball to an S that barely misses.
 */
export const catchRadiusFor = (meet) => 0.045 + (clampAbility(meet) / 100) * 0.080;
/**
 * Power value to maximum exit velocity [km/h] 【調整可】.
 *
 * The top is 172 rather than the record 197.8 on purpose: the strongest bat
 * multiplies the CEILING by 1.14, and 172 x 1.14 = 196.1 still sits under
 * EXIT_VELOCITY_MAX. If the cap ever binds, a slightly mistimed swing produces
 * exactly the same exit velocity as a perfect one and the monotonicity property
 * in PROMPT.md 3-4 quietly stops holding.
 *
 * The SPREAD matters as much as the top. At 0.34 per point the whole range was
 * worth 34 km/h, and measured end to end a career added about 30 m of carry —
 * most of which came from 弾道, so power barely read as growth at all.
 *
 * 0.41 rather than the 0.46 it was briefly: the specials now add up to 15 power
 * on top of 100, and the arithmetic has to still fit. 126 + 115 x 0.41 = 173.2,
 * and 173.2 x 1.14 for the strongest bat is 197.4 — just under the record.
 */
export const maxExitKmhFor = (power) => 126 + Math.max(ABILITY_MIN, Math.min(EFFECTIVE_POWER_MAX, power)) * 0.41;
/**
 * Trajectory to base launch angle [deg] 【調整可】.
 *
 * 4 is 28 rather than the 30 it started at. The optimum for a strong hitter is
 * about 28 (see idealLaunchAngle), and the distance curve is not symmetric about
 * it — going a degree over costs more than a degree under — so a 弾道4 above the
 * optimum made the last step of the ladder a step down.
 */
export const BASE_LAUNCH_ANGLE = {
    1: 17, 2: 22, 3: 26, 4: 28,
};
/**
 * The exit-velocity ceiling for a given limit-break progress, 0..1 [m/s].
 *
 * THIS IS THE PART THAT MAKES THE REWARD REAL. Raising power alone does
 * nothing: src/core/bat.ts clamps every batted ball at the ceiling, so a
 * batter with 200 power and the old cap hits the ball at exactly the same
 * speed as one with 115. Rewards that quietly change nothing have shipped
 * three times in this project already (docs/PROGRESS.md) and none of them were
 * visible on screen — the number went up and the ball did not.
 */
export const exitCeiling = (breakthrough) => {
    const b = Math.max(0, Math.min(1, breakthrough));
    return EXIT_VELOCITY_MAX + (BREAKTHROUGH_EXIT_VELOCITY_MAX - EXIT_VELOCITY_MAX) * b;
};
//# sourceMappingURL=ranks.js.map