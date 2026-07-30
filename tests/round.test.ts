/**
 * Round rules and scoring.
 *
 * Written after src/core/round.ts rather than before it, which breaks
 * PROMPT.md 3-2. Recorded in docs/PROGRESS.md rather than quietly fixed, because
 * the reason that rule exists is that M1 found two real bugs with it and would
 * not have found them the other way round.
 *
 * What these pin: the scoring formula from PROMPT.md 0-1 exactly as written, and
 * the properties the reference-derived extras must not break.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { Round } from '../src/core/round.js';
import {
  applySwing, applyTake, comboMultiplier, gradeOf, newRound, TARGET_BONUS,
} from '../src/core/round.js';
import type { Contact } from '../src/core/bat.js';
import type { FieldResult } from '../src/core/stadium.js';
import {
  COMBO_MAX, K_DIST, OUTS_PER_ROUND, SCORE_BASE, SCORE_DISTANCE_REF, TENACITY_FREE_FOULS,
} from '../src/core/constants.js';

const contact = (over: Partial<Contact> = {}): Contact => ({
  kind: 'just', e: 0.01, t: 0.001, u: 0, quality: 0.95,
  exitVelocity: 45, launchAngle: 26, sprayAngle: 2,
  spin: { backspinRpm: 2000, sidespinRpm: 200 }, contactHeight: 0.75,
  ...over,
});

const field = (over: Partial<FieldResult> = {}): FieldResult => ({
  outcome: 'homeRun', distance: 130, heightAtFence: 8, sprayAngle: 2,
  target: null, bleacher: 'centre', ...over,
});

const fresh = (over: Partial<Round> = {}): Round =>
  ({ ...newRound('classic', false), ...over });

// ---------------------------------------------------------------------------
// the formula in PROMPT.md 0-1
// ---------------------------------------------------------------------------

test('a home run pays 100 plus K_DIST per metre past 120', () => {
  const { round, event } = applySwing(fresh(), {
    contact: contact(), field: field({ distance: 130 }), multiplier: 1,
  });
  const expected = SCORE_BASE + (130 - SCORE_DISTANCE_REF) * K_DIST;
  assert.equal(event.gained, Math.round(expected));
  assert.equal(round.score, Math.round(expected));
  assert.equal(round.homeRuns, 1);
  assert.equal(round.outs, 0);
});

test('a home run shorter than the reference distance still pays the base', () => {
  const { event } = applySwing(fresh(), {
    contact: contact(), field: field({ distance: 99 }), multiplier: 1,
  });
  assert.equal(event.gained, SCORE_BASE, 'the distance term must not go negative');
});

test('the combo starts at the SECOND consecutive home run', () => {
  assert.equal(comboMultiplier(0), 1);
  assert.equal(comboMultiplier(1), 1.1);
  assert.equal(comboMultiplier(2), 1.2);
});

test('the combo is capped and never exceeds COMBO_MAX', () => {
  for (let s = 0; s < 60; s++) {
    assert.ok(comboMultiplier(s) <= COMBO_MAX + 1e-12, `streak ${s} exceeded the cap`);
  }
  assert.equal(comboMultiplier(50), COMBO_MAX);
});

test('a streak of home runs compounds and any out resets it', () => {
  let round = fresh();
  for (let i = 0; i < 4; i++) {
    round = applySwing(round, { contact: contact(), field: field(), multiplier: 1 }).round;
  }
  assert.equal(round.streak, 4);
  round = applySwing(round, {
    contact: contact({ kind: 'whiff' }), field: null, multiplier: 1,
  }).round;
  assert.equal(round.streak, 0, 'a whiff must reset the combo');
  assert.equal(round.outs, 1);
});

// ---------------------------------------------------------------------------
// outs
// ---------------------------------------------------------------------------

test('everything that is not a home run costs an out in CLASSIC', () => {
  for (const outcome of ['offTheWall', 'inPlay', 'foul'] as const) {
    const { round, event } = applySwing(fresh(), {
      contact: contact({ kind: 'poor' }), field: field({ outcome }), multiplier: 1,
    });
    assert.equal(round.outs, 1, `${outcome} should have cost an out`);
    assert.ok(event.out);
  }
});

test('the round ends at exactly OUTS_PER_ROUND', () => {
  let round = fresh();
  for (let i = 0; i < OUTS_PER_ROUND; i++) {
    assert.equal(round.over, false, `ended early at ${i} outs`);
    round = applySwing(round, {
      contact: contact({ kind: 'whiff' }), field: null, multiplier: 1,
    }).round;
  }
  assert.equal(round.outs, OUTS_PER_ROUND);
  assert.equal(round.over, true);
});

test('a called strike is an out; a ball is not', () => {
  const strike = applyTake(fresh(), true);
  assert.equal(strike.round.outs, 1);
  assert.ok(strike.event.out);
  const ball = applyTake(fresh(), false);
  assert.equal(ball.round.outs, 0);
  assert.equal(ball.event.out, false);
});

// ---------------------------------------------------------------------------
// takaya's 粘り
// ---------------------------------------------------------------------------

test('tenacity absorbs exactly three fouls and then stops', () => {
  let round = newRound('classic', true);
  assert.equal(round.freeFouls, TENACITY_FREE_FOULS);
  for (let i = 0; i < TENACITY_FREE_FOULS; i++) {
    const applied = applySwing(round, {
      contact: contact({ kind: 'foul' }), field: field({ outcome: 'foul' }), multiplier: 1,
    });
    round = applied.round;
    assert.equal(round.outs, 0, `foul ${i + 1} should have been absorbed`);
    assert.ok(applied.event.savedByTenacity);
  }
  const fourth = applySwing(round, {
    contact: contact({ kind: 'foul' }), field: field({ outcome: 'foul' }), multiplier: 1,
  });
  assert.equal(fourth.round.outs, 1, 'the fourth foul must cost an out');
  assert.equal(fourth.event.savedByTenacity, false);
});

test('tenacity does not absorb whiffs or ground outs', () => {
  const round = newRound('classic', true);
  assert.equal(applySwing(round, {
    contact: contact({ kind: 'whiff' }), field: null, multiplier: 1,
  }).round.outs, 1);
  assert.equal(applySwing(round, {
    contact: contact({ kind: 'poor' }), field: field({ outcome: 'inPlay' }), multiplier: 1,
  }).round.outs, 1);
});

// ---------------------------------------------------------------------------
// the reference-derived extras — docs/REFERENCE-HB2.md 5-2
// ---------------------------------------------------------------------------

test('a bonus pitch multiplies the points and nothing else', () => {
  const plain = applySwing(fresh(), { contact: contact(), field: field(), multiplier: 1 });
  const tripled = applySwing(fresh(), { contact: contact(), field: field(), multiplier: 3 });
  assert.equal(tripled.event.gained, plain.event.gained * 3);
  // the ball itself must be untouched: same home run, same distance, same out count
  assert.equal(tripled.round.homeRuns, plain.round.homeRuns);
  assert.equal(tripled.round.outs, plain.round.outs);
  assert.equal(tripled.event.distance, plain.event.distance);
});

test('hitting a foul pole pays its bonus on top of the home run', () => {
  const plain = applySwing(fresh(), { contact: contact(), field: field(), multiplier: 1 });
  const pole = applySwing(fresh(), {
    contact: contact(), field: field({ target: 'leftPole' }), multiplier: 1,
  });
  assert.equal(pole.event.gained, plain.event.gained + TARGET_BONUS.leftPole);
  assert.equal(pole.event.target, 'leftPole');
});

test('a foul that rings the scoreboard pays something but is still an out', () => {
  const { round, event } = applySwing(fresh(), {
    contact: contact({ kind: 'foul' }),
    field: field({ outcome: 'foul', target: 'scoreboard' }),
    multiplier: 1,
  });
  assert.ok(event.gained > 0, 'the target should still have paid');
  assert.ok(event.gained < TARGET_BONUS.scoreboard, 'but not the full bonus');
  assert.equal(round.outs, 1);
  assert.equal(round.homeRuns, 0);
});

test('both modes pay for distance, and ARCADE pays more', () => {
  /*
   * CLASSIC used to pay nothing for a ball that stayed in the park.
   *
   * That stopped working the moment abilities started at G to E with 弾道1: a
   * level-1 batter's best swing carries about 75 m into a 100 m fence, so he
   * would finish ten outs on a score of zero, earn no experience, and never
   * reach level 2. A ladder whose first rung cannot be reached is not a ladder.
   * It is also how the source scores — パワプロ's ホームランアタック pays for
   * 飛距離, not only for home runs.
   */
  const inPlay = {
    contact: contact({ kind: 'good' }),
    field: field({ outcome: 'inPlay', distance: 90 }),
    multiplier: 1,
  };
  const classic = applySwing(fresh(), inPlay);
  const arcade = applySwing(newRound('arcade', false), inPlay);
  assert.ok(classic.event.gained > 0, 'CLASSIC must pay something, or level 1 is a dead end');
  assert.ok(arcade.event.gained > classic.event.gained, 'ARCADE should still pay more');
  assert.ok(classic.event.out, 'it is still an out in CLASSIC');
});

test('mode does not change how many outs a ball costs', () => {
  const inPlay = {
    contact: contact({ kind: 'good' }), field: field({ outcome: 'inPlay' }), multiplier: 1,
  };
  assert.equal(applySwing(newRound('classic', false), inPlay).round.outs, 1);
  assert.equal(applySwing(newRound('arcade', false), inPlay).round.outs, 1);
});

// ---------------------------------------------------------------------------
// grades are display only
// ---------------------------------------------------------------------------

test('the grade is derived from contact quality, not from distance', () => {
  assert.equal(gradeOf(contact({ kind: 'whiff' })), 'miss');
  assert.equal(gradeOf(contact({ kind: 'just', quality: 0.95 })), 'perfect');
  assert.equal(gradeOf(contact({ kind: 'just', quality: 0.60 })), 'great');
  assert.equal(gradeOf(contact({ kind: 'good' })), 'good');
  assert.equal(gradeOf(contact({ kind: 'foul' })), 'weak');
  assert.equal(gradeOf(contact({ kind: 'jammed', quality: 0.20 })), 'weak');
});

test('a perfectly struck ball that dies short is still graded PERFECT', () => {
  // the causal chain in PROMPT.md 5 runs input -> contact -> flight. Grading on
  // the outcome would tell the player they mis-swung when they did not.
  const { event } = applySwing(fresh(), {
    contact: contact({ kind: 'just', quality: 0.95 }),
    field: field({ outcome: 'inPlay', distance: 80 }),
    multiplier: 1,
  });
  assert.equal(event.grade, 'perfect');
  assert.equal(event.out, true);
});

// ---------------------------------------------------------------------------
// invariants
// ---------------------------------------------------------------------------

test('score never decreases and outs never decrease', () => {
  let round = fresh();
  const outcomes = ['homeRun', 'offTheWall', 'inPlay', 'foul'] as const;
  for (let i = 0; i < 40; i++) {
    const previous = round;
    const next = applySwing(round, {
      contact: contact({ kind: i % 3 === 0 ? 'just' : 'poor' }),
      field: field({ outcome: outcomes[i % outcomes.length] as 'homeRun', distance: 100 + i }),
      multiplier: ((i % 3) + 1) as 1 | 2 | 3,
    });
    round = next.round;
    assert.ok(round.score >= previous.score, 'score went backwards');
    assert.ok(round.outs >= previous.outs, 'outs went backwards');
    assert.ok(Number.isFinite(round.score), 'score became non-finite');
    if (round.over) round = fresh();
  }
});

test('longest only tracks home runs', () => {
  let round = fresh();
  round = applySwing(round, {
    contact: contact({ kind: 'good' }),
    field: field({ outcome: 'inPlay', distance: 200 }), multiplier: 1,
  }).round;
  assert.equal(round.longest, 0, 'a ball that stayed in the park is not a longest home run');
  round = applySwing(round, {
    contact: contact(), field: field({ distance: 131 }), multiplier: 1,
  }).round;
  assert.equal(round.longest, 131);
});
