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
import { vec, add, addScaled, scale, dot, cross, length, normalize } from './vec.js';
import { nextRange, nextBool } from './rng.js';
import { dragCoefficient, liftCoefficient } from './physics.js';
import { AIR_DENSITY, BALL_AREA, BALL_MASS, BALL_RADIUS, DT, GRAVITY, PLATE_HALF_WIDTH, RELEASE_DISTANCE, ZONE_BOTTOM, ZONE_TOP, } from './constants.js';
export const PITCH_TYPES = ['straight', 'change', 'curve', 'fork'];
export const PITCH_LABEL = {
    straight: 'ストレート', change: 'チェンジアップ', curve: 'カーブ', fork: 'フォーク',
};
/**
 * How often each pitch is thrown. 【調整可】
 *
 * Not equal, because the fork can never be hit (see FORK_IS_A_BALL): at one in
 * four, a quarter of every round would be pitches the player is required to
 * ignore, and a game that spends a quarter of its time telling you not to press
 * anything is a slow game.
 */
const PITCH_WEIGHT = {
    straight: 34, change: 24, curve: 24, fork: 18,
};
/**
 * The fork is always out of the zone, and swinging at it always misses.
 *
 * The owner asked for this directly. It is the one pitch you are supposed to
 * lay off, which turns "press the button" into "press the button EXCEPT now" —
 * and a game with only one input needs somewhere for judgement to live. Laying
 * one off is rewarded rather than merely not punished; see round.ts.
 */
export const FORK_IS_A_BALL = true;
/**
 * Speeds are the owner's, set on 令和8年7月30日, and they are the game's main
 * difficulty dial now that the swing is a single button: 150 against 110 is a
 * 147 ms difference in flight time, which is what the player is actually
 * reading. The spin axes stay sourced (docs/SPEC.md 5) so the ball still moves
 * the way each pitch really moves.
 *
 * The fork's axis is the one that changed. It was vec(0.20, 0.60, 0) — 95% of
 * the spin horizontal, so it ran sideways rather than dropping, which is not
 * what a fork does. Low rpm and a slight TOPSPIN component let gravity win.
 */
export const PITCHES = {
    straight: { kmh: 150.0, rpm: 2324, axis: vec(1.0, 0.35, 0) },
    change: { kmh: 110.0, rpm: 1794, axis: vec(0.28, 0.85, 0) },
    curve: { kmh: 130.0, rpm: 2582, axis: vec(-0.62, -0.55, 0) },
    fork: { kmh: 140.0, rpm: 1050, axis: vec(-0.30, 0.25, 0) },
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
export const RELEASE_POINT = vec(-0.35, 1.85, RELEASE_DISTANCE);
const RPM_TO_RAD = (2 * Math.PI) / 60;
const accel = (v, omega, cd) => {
    const speed = length(v);
    const g = vec(0, -GRAVITY, 0);
    if (speed < 1e-9)
        return g;
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
export const makePitch = (type, target, intendedStrike, multiplier = 1, 
/**
 * Scales the release speed. The opponent's factor times the level term; see
 * src/core/pitchers.ts. It multiplies SPEED only, never spin rate, so a slow
 * curve still curves as much as a fast one — a pitch that stopped moving when
 * it slowed down would read as a different pitch, not an easier one.
 */
speedScale = 1) => {
    const spec = PITCHES[type];
    const speed = (spec.kmh * speedScale) / 3.6;
    const spin = scale(normalize(spec.axis), spec.rpm * RPM_TO_RAD);
    const cd = dragCoefficient(spec.rpm);
    let aim = { x: target.x, y: target.y };
    let velocity = vec(0, 0, -speed);
    for (let pass = 0; pass < 4; pass++) {
        const dir = normalize(vec(aim.x - RELEASE_POINT.x, aim.y - RELEASE_POINT.y, -RELEASE_POINT.z));
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
/** Pick a pitch type by weight, keeping the PRNG pure. */
const pickWeighted = (rng, types, weight) => {
    let total = 0;
    for (const t of types)
        total += weight[t];
    const roll = nextRange(rng, 0, total);
    let acc = 0;
    for (const t of types) {
        acc += weight[t];
        if (roll.value < acc)
            return { rng: roll.rng, value: t };
    }
    return { rng: roll.rng, value: types[types.length - 1] };
};
/** Integrate a pitch from release until it has passed the plate. */
export const flyPitch = (pitch, cdOverride) => {
    const rpm = length(pitch.spin) / RPM_TO_RAD;
    const cd = cdOverride ?? dragCoefficient(rpm);
    let p = pitch.release;
    let v = pitch.velocity;
    let t = 0;
    const samples = [{ pos: p, t }];
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
export const choosePitch = (rng, speed = 1) => {
    const a = pickWeighted(rng, PITCH_TYPES, PITCH_WEIGHT);
    const b = nextBool(a.rng, 0.8);
    // The fork is never a strike. Everything downstream reads intendedStrike, so
    // forcing it here is enough — there is no second place that has to agree.
    const strike = a.value === 'fork' && FORK_IS_A_BALL ? false : b.value;
    const forkBall = a.value === 'fork' && FORK_IS_A_BALL;
    // strikes land inside the zone; balls miss it by a believable margin, and a
    // fork misses it downward, which is where a fork misses
    const xr = strike
        ? nextRange(b.rng, -PLATE_HALF_WIDTH * 0.85, PLATE_HALF_WIDTH * 0.85)
        : nextRange(b.rng, -PLATE_HALF_WIDTH * 1.1, PLATE_HALF_WIDTH * 1.1);
    const yr = strike
        ? nextRange(xr.rng, ZONE_BOTTOM + 0.05, ZONE_TOP - 0.05)
        : forkBall
            ? nextRange(xr.rng, ZONE_BOTTOM - 0.30, ZONE_BOTTOM - 0.06)
            : nextRange(xr.rng, ZONE_BOTTOM - 0.22, ZONE_TOP + 0.22);
    const roll = nextRange(yr.rng, 0, 1);
    const multiplier = roll.value < BONUS_X3_RATE
        ? 3
        : roll.value < BONUS_X3_RATE + BONUS_X2_RATE ? 2 : 1;
    return {
        rng: roll.rng,
        pitch: makePitch(a.value, { x: xr.value, y: yr.value }, strike, multiplier, speed),
    };
};
//# sourceMappingURL=pitch.js.map