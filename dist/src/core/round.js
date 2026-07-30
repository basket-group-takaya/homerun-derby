/**
 * Round rules and scoring. Pure (PROMPT.md 2).
 *
 * The base rules are PROMPT.md 0-1: ten outs, anything that is not a home run
 * is an out, score = (100 + metres past 120 * K_DIST) * combo. Research
 * (docs/REFERENCE-HB2.md 4) found that this is the reference genre's "Classic"
 * mode almost exactly, so it is kept unchanged and the reference's extras are
 * layered on top rather than replacing it:
 *
 *   - bonus pitches worth x2 / x3 (REFERENCE-HB2 5-2)
 *   - flat bonuses for hitting the foul poles or the scoreboard (5-2)
 *   - an ARCADE mode where balls that stay in the park still score (4)
 *
 * None of these touch the batted-ball model. A x3 pitch flies exactly like a x1
 * pitch — the multiplier is applied to the score afterwards, so PROMPT.md 5's
 * "no fudging outcomes with randomness" still holds.
 */
import { COMBO_MAX, COMBO_STEP, K_DIST, OUTS_PER_ROUND, SCORE_BASE, SCORE_DISTANCE_REF, TENACITY_FREE_FOULS, TITANIC_DISTANCE, } from './constants.js';
export const GRADE_LABEL = {
    perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', weak: 'WEAK', miss: 'MISS',
};
/** Points for clipping a target. 【調整可】 */
export const TARGET_BONUS = {
    leftPole: 500, rightPole: 500, scoreboard: 300,
};
export const TARGET_LABEL = {
    leftPole: 'ポール直撃！', rightPole: 'ポール直撃！', scoreboard: '看板直撃！',
};
export const newRound = (mode, tenacity) => ({
    mode,
    outs: 0,
    score: 0,
    homeRuns: 0,
    streak: 0,
    longest: 0,
    freeFouls: tenacity ? TENACITY_FREE_FOULS : 0,
    swings: 0,
    over: false,
});
/**
 * Combo multiplier for the Nth consecutive home run.
 *
 * PROMPT.md 0-1: nothing on the first, x1.1 on the second, +0.1 after, capped.
 * `streak` here is the count BEFORE this home run is added.
 */
export const comboMultiplier = (streak) => streak <= 0 ? 1 : Math.min(COMBO_MAX, 1 + COMBO_STEP * streak);
/**
 * How well the bat met the ball, for display only.
 *
 * Deliberately derived from contact quality rather than from the distance: a
 * perfectly struck ball into a headwind is still a perfect swing, and telling
 * the player otherwise would break the causal chain PROMPT.md 5 insists on.
 */
export const gradeOf = (contact) => {
    switch (contact.kind) {
        case 'whiff': return 'miss';
        case 'just': return contact.quality >= 0.86 ? 'perfect' : 'great';
        case 'good': return 'good';
        case 'foul': return 'weak';
        default: return contact.quality >= 0.45 ? 'good' : 'weak';
    }
};
const homeRunPoints = (distance) => SCORE_BASE + Math.max(0, distance - SCORE_DISTANCE_REF) * K_DIST;
/**
 * A batted ball that stays in the park still pays for its distance.
 *
 * CLASSIC used to pay nothing at all, which was fine while every player started
 * with A-grade power. It stopped being fine the moment abilities started at G to
 * E and 弾道1: a level-1 batter's best swing carries about 75 m into a 100 m
 * fence, so he would finish ten outs with a score of zero, earn no experience,
 * and never reach level 2. A ladder whose first rung cannot be reached is not a
 * ladder.
 *
 * This is also how the source material does it — パワプロ's ホームランアタック
 * scores 「飛距離や連打で得点が高まり」, distance itself, not only home runs
 * (altema, read 令和8年7月30日). CLASSIC pays less than ARCADE because an out is
 * still an out.
 */
const inPlayPoints = (mode, distance) => Math.round(distance * (mode === 'arcade' ? 0.8 : 0.45));
/**
 * Fold one swing into the round.
 *
 * `multiplier` is the bonus-pitch factor (1, 2 or 3) and is applied to the
 * points from this swing only.
 */
export const applySwing = (round, input) => {
    const grade = gradeOf(input.contact);
    const field = input.field;
    const distance = field?.distance ?? 0;
    const target = field?.target ?? null;
    const outcome = input.contact.kind === 'whiff'
        ? 'whiff'
        : field === null ? 'whiff' : field.outcome;
    const isHomeRun = outcome === 'homeRun';
    const combo = comboMultiplier(round.streak);
    let gained = 0;
    if (isHomeRun) {
        gained = Math.round((homeRunPoints(distance) * combo + (target ? TARGET_BONUS[target] : 0)) * input.multiplier);
    }
    else if (outcome === 'offTheWall' || outcome === 'inPlay') {
        gained = Math.round(inPlayPoints(round.mode, distance) * input.multiplier);
    }
    else if (target) {
        // a foul that still rang the scoreboard: pay it, do not credit a home run
        gained = Math.round(TARGET_BONUS[target] * 0.4 * input.multiplier);
    }
    // 粘り absorbs fouls only, and only while charges remain
    const foulSaved = outcome === 'foul' && round.freeFouls > 0;
    const costsOut = !isHomeRun && !foulSaved;
    const outs = round.outs + (costsOut ? 1 : 0);
    return {
        round: {
            ...round,
            outs,
            score: round.score + gained,
            homeRuns: round.homeRuns + (isHomeRun ? 1 : 0),
            streak: isHomeRun ? round.streak + 1 : 0,
            longest: Math.max(round.longest, isHomeRun ? distance : 0),
            freeFouls: round.freeFouls - (foulSaved ? 1 : 0),
            swings: round.swings + 1,
            over: outs >= OUTS_PER_ROUND,
        },
        event: {
            outcome,
            grade,
            gained,
            out: costsOut,
            savedByTenacity: foulSaved,
            distance,
            target,
            multiplier: input.multiplier,
            comboMultiplier: isHomeRun ? combo : 1,
            titanic: isHomeRun && distance >= TITANIC_DISTANCE,
            discipline: false,
        },
    };
};
/**
 * Points for correctly laying off a fork. 【調整可】
 *
 * Small, but not zero, and this is the whole reason the fork is interesting. If
 * taking one merely avoided a punishment, the pitch would be an interruption:
 * a second of waiting with nothing to decide. Paying for it makes recognising a
 * fork a way to score, so the pitch you cannot hit becomes a pitch you want.
 */
export const DISCIPLINE_BONUS = 120;
/** A pitch let go by: a strike is an out, a ball is nothing, a fork pays. */
export const applyTake = (round, strike, fork = false) => {
    const outs = round.outs + (strike ? 1 : 0);
    const gained = !strike && fork ? DISCIPLINE_BONUS : 0;
    return {
        round: strike
            ? { ...round, outs, streak: 0, over: outs >= OUTS_PER_ROUND }
            : gained > 0
                ? { ...round, score: round.score + gained }
                : round,
        event: {
            outcome: 'take',
            grade: gained > 0 ? 'good' : 'miss',
            gained,
            out: strike,
            savedByTenacity: false,
            distance: 0,
            target: null,
            multiplier: 1,
            comboMultiplier: 1,
            titanic: false,
            discipline: gained > 0,
        },
    };
};
//# sourceMappingURL=round.js.map