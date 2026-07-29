/**
 * Balance measurement. PROMPT.md 3-6.
 *
 *   npx tsc && node dist/scripts/difficulty.js [roundsPerCell]
 *
 * Three players x three input precisions, playing full ten-out rounds through
 * the real reducer. Reports home-run rate, mean distance and mean score.
 *
 * Targets from PROMPT.md 0-4 and 3-6:
 *   - perfect input:  HR rate around 80%
 *   - +-5 frames:     HR rate 10-20%
 *   - the three players' expected scores within +-15% of each other
 *
 * The AI aims at the ball and mistimes it by a fixed number of frames, which is
 * the only honest model of "a player who is this good": it isolates timing,
 * the thing the difficulty actually rests on, from cursor placement, which a
 * player has a whole pitch to get right.
 *
 * It also declines pitches outside the zone, because a player would.
 */

import type { GameState } from '../src/core/game.js';
import { initialState, step } from '../src/core/game.js';
import type { PlayerId } from '../src/core/constants.js';
import {
  PLATE_HALF_WIDTH, PLAYERS, PLAYER_IDS, T_SWING, ZONE_BOTTOM, ZONE_TOP,
} from '../src/core/constants.js';
import type { RoundMode } from '../src/core/round.js';
import { resolveContact } from '../src/core/bat.js';
import { simulateBattedBall } from '../src/core/physics.js';

const TICK = 1 / 60;

type Cell = {
  rounds: number;
  swings: number;
  homeRuns: number;
  distanceSum: number;
  distanceCount: number;
  scoreSum: number;
  longest: number;
};

const emptyCell = (): Cell => ({
  rounds: 0, swings: 0, homeRuns: 0, distanceSum: 0, distanceCount: 0, scoreSum: 0, longest: 0,
});

/**
 * Hard cap on pitches per round.
 *
 * Not a convenience. In CLASSIC only non-home-runs make outs, so a batter who
 * never misses never makes an out and the round has no end — the first run of
 * this script sat in a 4,000-pitch loop. The cap makes "perfect" measurable and
 * the number of rounds that hit it is itself the finding, so it is reported.
 */
const PITCH_CAP = 40;
let cappedRounds = 0;

const inZone = (p: { x: number; y: number }): boolean =>
  Math.abs(p.x) <= PLATE_HALF_WIDTH && p.y >= ZONE_BOTTOM && p.y <= ZONE_TOP;

/**
 * How far below the ball each player should aim, in metres.
 *
 * Found by search rather than assumed, because it is the whole point of
 * atsushi's skill and the first version of this script missed it entirely.
 * Aiming dead-on makes the undercut zero, which makes "上を狙う" — a x1.5
 * multiplier on exactly that term — do nothing, and the measurement then said
 * atsushi could not clear the fence when in fact nobody had let him try.
 *
 * The trade is real and the search prices it: undercut buys launch angle at
 * K_THETA degrees per metre, and costs meet quality because the cursor is no
 * longer on the ball. For a meet-S hitter the radius is 0.15 m, so two
 * centimetres of undercut costs under 2% of quality and buys eight degrees.
 */
const bestUndercut = (player: PlayerId): number => {
  let best = 0;
  let bestDistance = -1;
  for (let u = 0; u <= 0.075; u += 0.0025) {
    const contact = resolveContact({
      player: PLAYERS[player],
      cursor: { x: 0, y: 0.75 - u },
      ball: { x: 0, y: 0.75 },
      timingError: 0,
      whiffStreak: 0,
    });
    if (contact.kind === 'whiff') break;
    const flight = simulateBattedBall({
      exitVelocity: contact.exitVelocity,
      launchAngle: contact.launchAngle,
      sprayAngle: contact.sprayAngle,
      backspinRpm: contact.spin.backspinRpm,
      sidespinRpm: contact.spin.sidespinRpm,
      contactHeight: contact.contactHeight,
    });
    if (flight.distance > bestDistance) {
      bestDistance = flight.distance;
      best = u;
    }
  }
  return best;
};

/** Play one round to its end and fold the result into `cell`. */
const playRound = (
  player: PlayerId, seed: number, offsetFrames: number, mode: RoundMode, cell: Cell,
  undercut: number, aimError: number,
): void => {
  let state: GameState = initialState(seed, player, mode);
  let guard = 0;

  while (state.phase !== 'roundOver' && guard++ < PITCH_CAP) {
    state = step(state, { kind: 'pitch' });
    const flight = state.flight;
    if (!flight) break;

    const take = !inZone(flight.crossPoint);
    if (!take) {
      // aim error walks around a circle so it is not biased in one direction
      const angle = (guard * 2.399963) % (Math.PI * 2);
      state = step(state, {
        kind: 'moveCursor',
        x: flight.crossPoint.x + Math.cos(angle) * aimError,
        y: flight.crossPoint.y - undercut + Math.sin(angle) * aimError,
      });
    }
    const swingAt = flight.crossTime - T_SWING + offsetFrames * TICK;

    let elapsed = 0;
    let swung = take;
    let steps = 0;
    while (state.phase === 'pitching' && steps++ < 400) {
      if (!swung && elapsed >= swingAt) {
        const before = state.round.swings;
        state = step(state, { kind: 'swing' });
        swung = true;
        if (state.round.swings > before) {
          cell.swings++;
          const e = state.lastEvent;
          if (e) {
            if (e.outcome === 'homeRun') cell.homeRuns++;
            if (e.outcome !== 'whiff' && e.outcome !== 'take') {
              cell.distanceSum += e.distance;
              cell.distanceCount++;
            }
          }
        }
        continue;
      }
      state = step(state, { kind: 'tick', dt: TICK });
      elapsed += TICK;
    }
    while (state.phase === 'flight' && steps++ < 3000) {
      state = step(state, { kind: 'tick', dt: TICK });
    }
  }

  if (state.phase !== 'roundOver') cappedRounds++;
  cell.rounds++;
  cell.scoreSum += state.round.score;
  cell.longest = Math.max(cell.longest, state.round.longest);
};

/**
 * Input precision: timing error in frames, and aim error in metres.
 *
 * The aim error is not padding. Without it the AI puts the cursor exactly on
 * the ball every time, which means the cursor RADIUS never matters — and cursor
 * radius is the entire mechanical meaning of the meet rank. With a perfect aim,
 * yuki (meet E, the player PROMPT.md 0-4 says must whiff a lot) never whiffs at
 * all, never makes an out, and his round never ends. The first measurement had
 * him 50% above the others and no allowed dial could bring him down, because
 * the thing that was supposed to hold him back had been measured away.
 *
 * The magnitudes are a judgement call and are stated as such: a good player is
 * assumed to be within about 3 cm of the ball, a mediocre one within 5.5 cm.
 * For scale, the catch radius runs 5.2 cm (E) to 11.5 cm (S) plus the ball.
 */
const PRECISIONS: readonly (readonly [string, number, number])[] = [
  ['完璧', 0, 0], ['±2フレーム', 2, 0.030], ['±5フレーム', 5, 0.055],
];

const roundsPerCell = Number.parseInt(process.argv[2] ?? '60', 10);
const mode: RoundMode = (process.argv[3] as RoundMode) ?? 'classic';

console.log(`difficulty: ${roundsPerCell} rounds per cell, mode=${mode}, `
  + `${PITCH_CAP} pitches max per round`);
console.log('');

const results = new Map<string, Cell>();

const undercuts = new Map<PlayerId, number>();
for (const player of PLAYER_IDS) undercuts.set(player, bestUndercut(player));
console.log('最適なアンダーカット量（探索で決定）');
for (const player of PLAYER_IDS) {
  console.log(`  ${PLAYERS[player].roman.padEnd(8)} `
    + `${((undercuts.get(player) ?? 0) * 100).toFixed(2)} cm`);
}
console.log('');

for (const player of PLAYER_IDS) {
  const undercut = undercuts.get(player) ?? 0;
  for (const [label, frames, aimError] of PRECISIONS) {
    const cell = emptyCell();
    for (let r = 0; r < roundsPerCell; r++) {
      // a mistimed player is late as often as early, so alternate the sign
      const offset = frames === 0 ? 0 : (r % 2 === 0 ? -frames : frames);
      playRound(player, 700003 + r * 104729, offset, mode, cell, undercut, aimError);
    }
    results.set(`${player}/${label}`, cell);
  }
}

const pct = (n: number, d: number): string => (d === 0 ? '   -  ' : `${((n / d) * 100).toFixed(1)}%`);
const num = (n: number, digits = 1): string => n.toFixed(digits);

console.log('| 選手 | 精度 | HR率 | 平均飛距離 | 平均スコア | 最長 |');
console.log('|---|---|---|---|---|---|');
for (const player of PLAYER_IDS) {
  for (const [label] of PRECISIONS) {
    const c = results.get(`${player}/${label}`);
    if (!c) continue;
    console.log(
      `| ${PLAYERS[player].roman} | ${label} | ${pct(c.homeRuns, c.swings)} `
      + `| ${num(c.distanceCount ? c.distanceSum / c.distanceCount : 0)} m `
      + `| ${num(c.scoreSum / Math.max(1, c.rounds), 0)} `
      + `| ${num(c.longest)} m |`);
  }
}

// PROMPT.md 0-4: the three expected scores must sit within +-15% of each other.
// Measured at the middle precision, which is what an actual player produces.
console.log('');
const mid = PLAYER_IDS.map((p) => {
  const c = results.get(`${p}/±2フレーム`);
  return { player: p, score: c ? c.scoreSum / Math.max(1, c.rounds) : 0 };
});
const mean = mid.reduce((a, b) => a + b.score, 0) / mid.length;
console.log(`±2フレームでのスコア期待値（平均 ${num(mean, 0)}）`);
let worst = 0;
for (const m of mid) {
  const deviation = mean === 0 ? 0 : ((m.score - mean) / mean) * 100;
  worst = Math.max(worst, Math.abs(deviation));
  console.log(`  ${PLAYERS[m.player].roman.padEnd(8)} ${num(m.score, 0).padStart(7)}  `
    + `${deviation >= 0 ? '+' : ''}${num(deviation)}%`);
}
console.log('');
console.log(worst <= 15
  ? `PASS — 最大乖離 ${num(worst)}% ≤ 15%`
  : `FAIL — 最大乖離 ${num(worst)}% > 15%。PROMPT.md 付録2 の判断が要る`);

if (cappedRounds > 0) {
  const total = PLAYER_IDS.length * PRECISIONS.length * roundsPerCell;
  console.log('');
  console.log(`※ ${cappedRounds}/${total} ラウンドが ${PITCH_CAP} 球の上限で打ち切られた。`);
  console.log('   CLASSIC はホームランだとアウトにならないため、完璧な打者のラウンドは');
  console.log('   原理的に終わらない。上限内のスコアで比較している。');
}
