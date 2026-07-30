/**
 * The four pitches, their speeds, and the rule that the fork cannot be hit.
 *
 * The speeds are the owner's, set on 令和8年7月30日, and they are now the game's
 * main difficulty dial: with one swing button and identical players, what the
 * player is reading is when the ball arrives, and 150 against 110 km/h is the
 * whole spread. A silent change to one of these numbers changes the difficulty
 * of the entire game, so they are pinned rather than trusted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FORK_IS_A_BALL, PITCHES, PITCH_TYPES, choosePitch, flyPitch,
} from '../src/core/pitch.js';
import { seedRng } from '../src/core/rng.js';
import { PLATE_HALF_WIDTH, ZONE_BOTTOM, ZONE_TOP } from '../src/core/constants.js';

test('there are exactly four pitches, at the speeds that were asked for', () => {
  assert.deepEqual([...PITCH_TYPES].sort(), ['change', 'curve', 'fork', 'straight']);
  assert.equal(PITCHES.straight.kmh, 150);
  assert.equal(PITCHES.change.kmh, 110);
  assert.equal(PITCHES.curve.kmh, 130);
  assert.equal(PITCHES.fork.kmh, 140);
});

test('the speed spread is worth reading', () => {
  // The gap in arrival time is the game. If it ever narrowed to nothing, every
  // pitch would want the same swing and the single button would have no timing
  // problem left in it.
  const arrival = (kmh: number): number => 16.7 / (kmh / 3.6);
  const gap = arrival(PITCHES.change.kmh) - arrival(PITCHES.straight.kmh);
  assert.ok(gap > 0.12, `only ${(gap * 1000).toFixed(0)} ms between the fastest and slowest`);
});

test('the fork drops rather than running sideways', () => {
  // Its axis was 95% horizontal, so it moved like a shoot. A fork is a pitch
  // that falls: low spin, and no backspin holding it up.
  assert.ok(PITCHES.fork.rpm < PITCHES.straight.rpm * 0.6,
    'a fork is a low-spin pitch');
  assert.ok(PITCHES.fork.axis.x <= 0,
    'positive x is backspin, which would make the fork rise');
});

test('every fork is out of the zone, and low', () => {
  // The owner's rule, and the reason laying one off is a decision at all. A
  // fork that occasionally caught the zone would make the rule feel arbitrary.
  let forks = 0;
  let rng = seedRng(20260730);
  for (let i = 0; i < 400; i++) {
    const next = choosePitch(rng);
    rng = next.rng;
    if (next.pitch.type !== 'fork') continue;
    forks++;
    assert.equal(next.pitch.intendedStrike, false, 'a fork was thrown as a strike');
    const cross = flyPitch(next.pitch).crossPoint;
    const inZone = Math.abs(cross.x) <= PLATE_HALF_WIDTH
      && cross.y >= ZONE_BOTTOM && cross.y <= ZONE_TOP;
    assert.equal(inZone, false,
      `a fork crossed at (${cross.x.toFixed(3)}, ${cross.y.toFixed(3)}), inside the zone`);
    assert.ok(cross.y < ZONE_BOTTOM, 'a fork should miss downward');
  }
  assert.ok(forks > 40, `only ${forks} forks in 400 pitches — too rare to be a mechanic`);
  assert.equal(FORK_IS_A_BALL, true);
});

test('the fork is frequent enough to matter and rare enough not to stall the game', () => {
  let forks = 0;
  let rng = seedRng(99);
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const next = choosePitch(rng);
    rng = next.rng;
    if (next.pitch.type === 'fork') forks++;
  }
  const rate = forks / n;
  assert.ok(rate > 0.12 && rate < 0.26, `forks are ${(rate * 100).toFixed(1)}% of pitches`);
});

test('every pitch type still gets thrown', () => {
  const seen = new Set<string>();
  let rng = seedRng(7);
  for (let i = 0; i < 400; i++) {
    const next = choosePitch(rng);
    rng = next.rng;
    seen.add(next.pitch.type);
  }
  assert.equal(seen.size, PITCH_TYPES.length, `only saw ${[...seen].join(', ')}`);
});

test('a pitch aimed at the zone arrives at the zone', () => {
  // makePitch iterates the aim so the ball crosses where it was aimed; if that
  // loop ever stopped converging, strikes would quietly stop being strikes.
  let rng = seedRng(31337);
  let strikes = 0;
  for (let i = 0; i < 200; i++) {
    const next = choosePitch(rng);
    rng = next.rng;
    if (!next.pitch.intendedStrike) continue;
    strikes++;
    const cross = flyPitch(next.pitch).crossPoint;
    const dx = Math.abs(cross.x - next.pitch.target.x);
    const dy = Math.abs(cross.y - next.pitch.target.y);
    assert.ok(dx < 0.02 && dy < 0.02,
      `aim missed by (${dx.toFixed(3)}, ${dy.toFixed(3)}) m`);
  }
  assert.ok(strikes > 80, `only ${strikes} strikes in 200 pitches`);
});
