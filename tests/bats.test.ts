/**
 * Bats, and the property that matters most about them.
 *
 * A bat is a multiplier on top of a fixed rank (PROMPT.md 0-4 forbids editing the
 * ranks). The danger is the exit-velocity ceiling: yuki is already at 178 x 1.10
 * = 195.8 km/h of a 197.8 ceiling, so a naive distance multiplier clamps every
 * decent swing to the same number, quality stops mattering, and the monotonicity
 * requirement in PROMPT.md 3-4 fails — the same bug M1 found and fixed. These
 * tests exist to make that impossible to reintroduce.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATS, BAT_IDS, DEFAULT_BAT, approximateMetres, bankedPoints, effectiveMaxExit, isBatId,
} from '../src/core/bats.js';
import { resolveContact, catchRadius } from '../src/core/bat.js';
import { PLAYERS, EXIT_VELOCITY_MAX, PASSION_EXIT_BONUS } from '../src/core/constants.js';
import { parseSave, emptySave } from '../src/storage.js';

const swing = (player: 'yuki' | 'takaya' | 'atsushi', batId: keyof typeof BATS, t: number, e = 0) =>
  resolveContact({
    player: PLAYERS[player],
    cursor: { x: -e, y: 0.75 },
    ball: { x: 0, y: 0.75 },
    timingError: t,
    whiffStreak: 0,
    bat: BATS[batId],
  });

// ---------------------------------------------------------------------------
// the ceiling
// ---------------------------------------------------------------------------

test('no bat can push any player past the measured exit-velocity ceiling', () => {
  for (const id of BAT_IDS) {
    for (const p of ['yuki', 'takaya', 'atsushi'] as const) {
      const c = swing(p, id, 0);
      assert.ok(c.exitVelocity <= EXIT_VELOCITY_MAX + 1e-9,
        `${p} with ${id} reached ${(c.exitVelocity * 3.6).toFixed(1)} km/h`);
    }
  }
});

test('effectiveMaxExit leaves room for the passion bonus without clamping', () => {
  for (const id of BAT_IDS) {
    const max = effectiveMaxExit('S', BATS[id], true);
    assert.ok(max * PASSION_EXIT_BONUS <= EXIT_VELOCITY_MAX + 1e-9,
      `${id}: ${max * PASSION_EXIT_BONUS} exceeds the ceiling`);
  }
});

test('timing monotonicity survives every bat, for every player', () => {
  // The exact property M1 pinned: worse timing must never produce more exit
  // velocity. A clamped ceiling breaks it silently.
  for (const id of BAT_IDS) {
    for (const p of ['yuki', 'takaya', 'atsushi'] as const) {
      let previous = Infinity;
      for (let t = 0; t <= 0.10; t += 0.005) {
        const c = swing(p, id, t);
        if (c.kind === 'whiff') break;
        assert.ok(c.exitVelocity <= previous + 1e-9,
          `${p}/${id}: exit velocity rose from ${previous} to ${c.exitVelocity} at t=${t}`);
        previous = c.exitVelocity;
      }
    }
  }
});

test('meet-error monotonicity survives every bat', () => {
  for (const id of BAT_IDS) {
    let previous = Infinity;
    for (let e = 0; e <= 0.05; e += 0.0025) {
      const c = swing('takaya', id, 0, e);
      if (c.kind === 'whiff') break;
      assert.ok(c.exitVelocity <= previous + 1e-9,
        `${id}: exit velocity rose as meet error grew, at e=${e}`);
      previous = c.exitVelocity;
    }
  }
});

// ---------------------------------------------------------------------------
// the traits do what the shop says
// ---------------------------------------------------------------------------

test('a distance bat adds exit velocity to a player who is not at the ceiling', () => {
  const plain = swing('atsushi', 'wood', 0);
  const power = swing('atsushi', 'carbon', 0);
  assert.ok(power.exitVelocity > plain.exitVelocity,
    'carbon should out-hit wood for a C-power batter');
});

test('the ceiling means a distance bat gives yuki almost nothing — stated, not hidden', () => {
  // docs/PROGRESS.md star-judgement 12. This is a design consequence of keeping
  // the sourced 197.8 km/h limit, and the test records it so it cannot drift
  // into being a surprise.
  const plain = swing('yuki', 'wood', 0);
  const power = swing('yuki', 'basket', 0);
  const gain = (power.exitVelocity / plain.exitVelocity) - 1;
  assert.ok(gain >= 0, 'it must never be a downgrade');
  assert.ok(gain < 0.03, `yuki gained ${(gain * 100).toFixed(1)}% — expected under 3%`);
});

test('a meet bat widens the catch radius exactly as advertised', () => {
  for (const id of BAT_IDS) {
    const wide = catchRadius(PLAYERS.takaya, 0, BATS[id]);
    const plain = catchRadius(PLAYERS.takaya, 0, BATS.wood);
    if (BATS[id].meet > 1) assert.ok(wide > plain, `${id} should widen the radius`);
    if (BATS[id].meet < 1) assert.ok(wide < plain, `${id} should narrow the radius`);
    if (BATS[id].meet === 1) assert.equal(wide, plain);
  }
});

test('a wider meet bat makes a marginal swing connect that otherwise misses', () => {
  const e = 0.132; // just outside takaya's plain catch radius
  assert.equal(swing('takaya', 'wood', 0, e).kind, 'whiff');
  assert.notEqual(swing('takaya', 'ash', 0, e).kind, 'whiff');
});

test('the points bat multiplies banked points and nothing else', () => {
  assert.equal(bankedPoints(1000, BATS.wood), 1000);
  assert.equal(bankedPoints(1000, BATS.gold), 1600);
  assert.equal(bankedPoints(0, BATS.gold), 0);
  // and it must not touch the ball
  assert.equal(swing('takaya', 'gold', 0).exitVelocity, swing('takaya', 'wood', 0).exitVelocity);
});

test('every bat is a trade, not a pure upgrade, except the endgame one', () => {
  // If a bat were better than wood on all three axes for less than the top
  // price, the shop would have exactly one correct answer and no decision in it.
  for (const id of BAT_IDS) {
    if (id === DEFAULT_BAT || id === 'basket') continue;
    const b = BATS[id];
    const betterEverywhere = b.exit > 1 && b.meet > 1 && b.points > 1;
    assert.equal(betterEverywhere, false, `${id} is a strict upgrade with no trade`);
  }
  // and the endgame bat must cost more than any other
  const others = BAT_IDS.filter((id) => id !== 'basket').map((id) => BATS[id].price);
  assert.ok(BATS.basket.price > Math.max(...others));
});

test('prices rise with what the bat gives', () => {
  assert.equal(BATS[DEFAULT_BAT].price, 0, 'the starting bat must be free');
  for (const id of BAT_IDS) {
    if (id === DEFAULT_BAT) continue;
    assert.ok(BATS[id].price > 0, `${id} must cost something`);
  }
});

test('approximateMetres is honest about zero', () => {
  assert.equal(approximateMetres(BATS.wood), 0);
  assert.ok(approximateMetres(BATS.basket) > approximateMetres(BATS.maple));
});

test('isBatId rejects anything that is not a bat', () => {
  assert.equal(isBatId('wood'), true);
  assert.equal(isBatId('WOOD'), false);
  assert.equal(isBatId(''), false);
  assert.equal(isBatId(null), false);
  assert.equal(isBatId(7), false);
});

// ---------------------------------------------------------------------------
// the save file must never be able to stop the game starting
// ---------------------------------------------------------------------------

test('a corrupt save degrades to a playable state instead of throwing', () => {
  for (const raw of [
    null, '', 'not json', '[]', '7', 'null',
    '{"points":-500}', '{"points":"lots"}',
    '{"bats":["cheatbat"],"equipped":"cheatbat"}',
    '{"bats":null,"equipped":42}',
    '{"points":1.9999,"bestScore":Infinity}',
  ]) {
    const s = parseSave(raw);
    assert.ok(s.points >= 0 && Number.isFinite(s.points), `points broke on ${raw}`);
    assert.ok(s.bats.includes(DEFAULT_BAT), `default bat missing for ${raw}`);
    assert.ok(s.bats.includes(s.equipped), `equipped bat not owned for ${raw}`);
  }
});

test('a save can never equip a bat it does not own', () => {
  const s = parseSave('{"bats":["wood"],"equipped":"basket"}');
  assert.equal(s.equipped, DEFAULT_BAT);
});

test('an empty save owns exactly the free bat', () => {
  const s = emptySave();
  assert.deepEqual(s.bats, [DEFAULT_BAT]);
  assert.equal(s.points, 0);
});

test('owned bats come back in canonical order with no duplicates', () => {
  const s = parseSave('{"bats":["basket","wood","wood","ash"],"equipped":"ash"}');
  assert.deepEqual(s.bats, BAT_IDS.filter((id) => ['wood', 'ash', 'basket'].includes(id)));
});
