/**
 * Headless fuzz. PROMPT.md 3-5.
 *
 *   npx tsc && node dist/scripts/smoke.js            (100 seeds x 10,000 swings)
 *   npx tsc && node dist/scripts/smoke.js 10 500     (a quick pass)
 *
 * Pass conditions, quoted from the spec: no exceptions, no NaN, no negative
 * distance, the ball never goes below ground, and the state invariants hold at
 * every step.
 *
 * Inputs are random on purpose — cursor anywhere near the zone, swing at any
 * moment, sometimes no swing at all. The point is not to play well, it is to
 * find the input that breaks something.
 */

import type { GameState } from '../src/core/game.js';
import { initialState, step } from '../src/core/game.js';
import type { PlayerId } from '../src/core/constants.js';
import {
  OUTS_PER_ROUND, PLATE_HALF_WIDTH, PLAYER_IDS, ZONE_BOTTOM, ZONE_TOP,
} from '../src/core/constants.js';
import { seedRng, nextRange, pick } from '../src/core/rng.js';
import type { Rng } from '../src/core/rng.js';

const TICK = 1 / 60;

type Failure = { readonly seed: number; readonly swing: number; readonly why: string };

const finite = (n: number): boolean => Number.isFinite(n);

/** Everything that must be true of the state after any command, ever. */
const checkInvariants = (s: GameState): string | null => {
  if (!finite(s.time) || s.time < 0) return `time = ${s.time}`;
  if (!finite(s.cursor.x) || !finite(s.cursor.y)) return 'cursor is not finite';
  if (Math.abs(s.cursor.x) > PLATE_HALF_WIDTH + 0.5) return `cursor x escaped: ${s.cursor.x}`;
  if (s.cursor.y < ZONE_BOTTOM - 0.5 || s.cursor.y > ZONE_TOP + 0.5) {
    return `cursor y escaped: ${s.cursor.y}`;
  }
  if (s.round.outs < 0 || s.round.outs > OUTS_PER_ROUND) return `outs = ${s.round.outs}`;
  if (!finite(s.round.score) || s.round.score < 0) return `score = ${s.round.score}`;
  if (s.round.homeRuns < 0 || s.round.homeRuns > s.round.swings) {
    return `homeRuns ${s.round.homeRuns} > swings ${s.round.swings}`;
  }
  if (!finite(s.round.longest) || s.round.longest < 0) return `longest = ${s.round.longest}`;

  const swing = s.swing;
  if (swing) {
    const c = swing.contact;
    for (const [k, v] of Object.entries({
      exitVelocity: c.exitVelocity, launchAngle: c.launchAngle,
      sprayAngle: c.sprayAngle, quality: c.quality, e: c.e, t: c.t,
    })) {
      if (!finite(v)) return `contact.${k} = ${v}`;
    }
    if (c.exitVelocity < 0) return `negative exit velocity ${c.exitVelocity}`;
    if (swing.field) {
      if (!finite(swing.field.distance)) return 'distance is not finite';
      if (swing.field.distance < 0) return `negative distance ${swing.field.distance}`;
    }
    for (const p of swing.trail) {
      if (!finite(p.x) || !finite(p.y) || !finite(p.z)) return 'trail point is not finite';
      if (p.y < -1e-6) return `ball went below ground: y = ${p.y}`;
    }
    if (!finite(swing.hangTime) || swing.hangTime < 0) return `hangTime = ${swing.hangTime}`;
  }
  if (s.ballPos && (!finite(s.ballPos.x) || !finite(s.ballPos.y) || !finite(s.ballPos.z))) {
    return 'ballPos is not finite';
  }
  return null;
};

const runSeed = (seed: number, swings: number, failures: Failure[]): {
  rounds: number; swingsDone: number;
} => {
  let rng: Rng = seedRng(seed ^ 0x5bf03635);
  const chosen = pick(rng, PLAYER_IDS);
  rng = chosen.rng;
  let state = initialState(seed, chosen.value as PlayerId);
  let rounds = 0;
  let done = 0;

  const guard = (why: string, swingIndex: number): boolean => {
    const bad = checkInvariants(state);
    if (bad) {
      failures.push({ seed, swing: swingIndex, why: `${why}: ${bad}` });
      return true;
    }
    return false;
  };

  for (let i = 0; i < swings; i++) {
    if (state.phase === 'roundOver') {
      state = step(state, { kind: 'newRound' });
      rounds++;
    }
    state = step(state, { kind: 'pitch' });
    if (guard('after pitch', i)) return { rounds, swingsDone: done };

    // random cursor, deliberately allowed outside the zone
    const cx = nextRange(rng, -PLATE_HALF_WIDTH * 2.5, PLATE_HALF_WIDTH * 2.5);
    const cy = nextRange(cx.rng, ZONE_BOTTOM - 0.4, ZONE_TOP + 0.4);
    rng = cy.rng;
    state = step(state, { kind: 'moveCursor', x: cx.value, y: cy.value });

    // swing at a random moment — or, one time in eight, not at all
    const when = nextRange(rng, -0.05, 0.75);
    rng = when.rng;
    const swingAt = when.value;

    let elapsed = 0;
    let swung = swingAt < 0;
    let steps = 0;
    while (state.phase === 'pitching' && steps++ < 400) {
      if (!swung && elapsed >= swingAt) {
        state = step(state, { kind: 'swing' });
        swung = true;
        if (guard('after swing', i)) return { rounds, swingsDone: done };
        continue;
      }
      state = step(state, { kind: 'tick', dt: TICK });
      elapsed += TICK;
      if (guard('mid-pitch tick', i)) return { rounds, swingsDone: done };
    }
    while (state.phase === 'flight' && steps++ < 3000) {
      state = step(state, { kind: 'tick', dt: TICK });
      if (guard('mid-flight tick', i)) return { rounds, swingsDone: done };
    }
    if (steps >= 3000) {
      failures.push({ seed, swing: i, why: 'the ball never came down' });
      return { rounds, swingsDone: done };
    }
    done++;
  }
  return { rounds, swingsDone: done };
};

const seeds = Number.parseInt(process.argv[2] ?? '100', 10);
const swingsPerSeed = Number.parseInt(process.argv[3] ?? '10000', 10);

console.log(`smoke: ${seeds} seeds x ${swingsPerSeed} swings = `
  + `${(seeds * swingsPerSeed).toLocaleString()} swings`);

const started = Date.now();
const failures: Failure[] = [];
let totalSwings = 0;
let totalRounds = 0;

for (let s = 0; s < seeds; s++) {
  const r = runSeed(1000 + s * 7919, swingsPerSeed, failures);
  totalSwings += r.swingsDone;
  totalRounds += r.rounds;
  if ((s + 1) % 10 === 0 || s === seeds - 1) {
    const elapsed = (Date.now() - started) / 1000;
    console.log(`  seed ${s + 1}/${seeds}  swings ${totalSwings.toLocaleString()}  `
      + `rounds ${totalRounds}  ${elapsed.toFixed(1)}s  failures ${failures.length}`);
  }
  if (failures.length >= 10) break;
}

console.log('');
console.log(`swings   ${totalSwings.toLocaleString()}`);
console.log(`rounds   ${totalRounds.toLocaleString()}`);
console.log(`seconds  ${((Date.now() - started) / 1000).toFixed(1)}`);
console.log(`failures ${failures.length}`);
for (const f of failures) console.log(`  seed ${f.seed} swing ${f.swing}: ${f.why}`);
if (failures.length > 0) process.exit(1);
console.log('\nPASS — no exceptions, no NaN, no negative distance, nothing below ground.');
