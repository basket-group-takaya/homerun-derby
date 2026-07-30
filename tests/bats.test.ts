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

import { BAT_UNLOCK_LEVEL } from '../src/core/level.js';

import {
  BATS, BAT_IDS, DEFAULT_BAT, approximateMetres, bankedPoints, effectiveMaxExit, isBatId,
} from '../src/core/bats.js';
import { resolveContact, catchRadius } from '../src/core/bat.js';
import { EXIT_VELOCITY_MAX } from '../src/core/constants.js';
import { abilityAt, specialExit, specialsAt } from '../src/core/ability.js';
import { parseSave, emptySave, batsFor } from '../src/storage.js';

/** A swing at level 99, which is where every ceiling question is decided. */
const swing = (
  player: 'yuki' | 'takaya' | 'atsushi', batId: keyof typeof BATS, t: number, e = 0,
  level = 99,
) => resolveContact({
  ability: abilityAt(player, level),
  cursor: { x: -e, y: 0.75 },
  ball: { x: 0, y: 0.75 },
  timingError: t,
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

test('effectiveMaxExit leaves room for 世界の王 without clamping', () => {
  // The crown ability multiplies exit velocity by 1.09 on top of the bat. If the
  // product cleared the ceiling, every well-struck ball would clamp to the same
  // number and a perfect swing would be worth exactly as much as a decent one.
  const crown = specialExit(specialsAt(99));
  for (const id of BAT_IDS) {
    const max = effectiveMaxExit(100, BATS[id], crown);
    assert.ok(max * crown <= EXIT_VELOCITY_MAX + 1e-9,
      `${id}: ${(max * crown * 3.6).toFixed(1)} km/h exceeds the ceiling`);
  }
});

test('the strongest possible batter still cannot beat the record', () => {
  const c = swing('yuki', 'basket', 0, 0, 99);
  assert.ok(c.exitVelocity <= EXIT_VELOCITY_MAX + 1e-9,
    `${(c.exitVelocity * 3.6).toFixed(1)} km/h`);
  // ...but he should be close to it, or the last bat and the last ability are
  // rewards for nothing
  assert.ok(c.exitVelocity * 3.6 > 185,
    `only ${(c.exitVelocity * 3.6).toFixed(1)} km/h at the very top`);
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

test('a distance bat now gives its full advertised gain, and star-judgement 12 is closed', () => {
  // It used to give 勇樹 under 3%, because power S already sat against the
  // sourced 197.8 km/h ceiling and the bat could only scale a ceiling that was
  // already clamped. That was recorded as star-judgement 12 in docs/PROGRESS.md.
  // Equal abilities put everyone at power A, well below the limit, so the bat
  // does what its note says — and the ceiling is still there for anything that
  // would exceed it.
  const plain = swing('yuki', 'wood', 0);
  const power = swing('yuki', 'basket', 0);
  const gain = (power.exitVelocity / plain.exitVelocity) - 1;
  assert.ok(gain > 0.10, `only ${(gain * 100).toFixed(1)}% — the bat claims 14%`);
  assert.ok(power.exitVelocity <= EXIT_VELOCITY_MAX + 1e-9, 'the ceiling still holds');
});

test('a timing bat widens the window exactly as advertised', () => {
  // The bat's second stat used to widen a meet cursor. There is no cursor now —
  // one button, and the bat always meets the ball — so it widens the only thing
  // the player still controls: how far off the beat a swing may be.
  // T_MISS is 0.115 s, so the plain window ends there and the 1.22x bat reaches
  // 0.140 s. 0.125 sits between them; the 0.92x bat ends at 0.106 and misses.
  const late = 0.125;
  assert.equal(swing('takaya', 'wood', late).kind, 'whiff');
  assert.notEqual(swing('takaya', 'ash', late).kind, 'whiff',
    'the timing bat should rescue a swing this late');
  assert.equal(swing('takaya', 'maple', late).kind, 'whiff',
    'the narrow-window bat should not');
});

test('the catch radius follows the meet value and nothing else', () => {
  const low = catchRadius(abilityAt('atsushi', 1));
  const high = catchRadius(abilityAt('atsushi', 99));
  assert.ok(high > low, 'growing the meet value should widen the radius');
});

test('the points bat multiplies banked points and nothing else', () => {
  assert.equal(bankedPoints(1000, BATS.wood), 1000);
  assert.equal(bankedPoints(1000, BATS.gold), 1350);
  assert.equal(bankedPoints(1000, BATS.gold, 2), 2700);
  assert.equal(bankedPoints(0, BATS.gold), 0);
  // and it must not touch the ball
  assert.equal(swing('takaya', 'gold', 0).exitVelocity, swing('takaya', 'wood', 0).exitVelocity);
});

test('no bat dominates the shelf it is standing on', () => {
  /*
   * The invariant that survived going from six bats to twenty.
   *
   * "Never better than wood on all three axes" was the old rule and it cannot
   * hold across ninety-five levels — a level-90 bat SHOULD beat the one you were
   * handed on your first round, or the ladder is not a reward. What has to stay
   * true is that at any moment you own several and none of them is simply the
   * answer: for every bat there is another one you own that beats it somewhere.
   */
  // From level 10, where the shelf first holds three. Below that it is wood and
  // one other, and the other is allowed to be a plain upgrade on the freebie —
  // that is what the first reward is for.
  for (const level of [10, 20, 45, 70, 95]) {
    const shelf = BAT_IDS.filter((id) => BATS[id].level <= level);
    for (const id of shelf) {
      if (id === 'basket' || id === DEFAULT_BAT) continue;   // the ending, and the freebie
      const b = BATS[id];
      const dominatesAll = shelf.every((other) => {
        if (other === id) return true;
        const o = BATS[other];
        return b.exit >= o.exit && b.timing >= o.timing && b.points >= o.points;
      });
      assert.equal(dominatesAll, false,
        `at level ${level}, ${id} beats or matches every other bat on every axis`);
    }
  }
});

test('the bats arrive every five levels, from 1 to 95', () => {
  const levels = BAT_IDS.map((id) => BATS[id].level);
  assert.equal(levels[0], 1, 'the first bat is handed over at level 1, not earned');
  assert.equal(levels[levels.length - 1], 95);
  // The first step is four, because the ladder starts at 1 rather than 0; every
  // step after that is the five the owner asked for.
  assert.equal(levels[1], 5);
  for (let i = 2; i < levels.length; i++) {
    assert.equal((levels[i] as number) - (levels[i - 1] as number), 5,
      `the gap before ${BAT_IDS[i]} is not five levels`);
  }
  assert.equal(BAT_IDS.length, 20);
});

test('the starting bat is free and every other one has to be reached', () => {
  assert.equal(BAT_UNLOCK_LEVEL[DEFAULT_BAT], 1, 'the starting bat must be level 1');
  for (const id of BAT_IDS) {
    if (id === DEFAULT_BAT) continue;
    assert.ok(BAT_UNLOCK_LEVEL[id] > 1, `${id} must need a level`);
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
    '{"players":-500}', '{"players":{"yuki":"lots"}}',
    '{"players":{"takaya":{"xp":-9,"bat":"cheatbat"}}}',
    '{"players":{"takaya":{"xp":1.999,"pitcher":42}}}',
    '{"points":1.9999,"bestScore":Infinity}',
  ]) {
    const s = parseSave(raw);
    for (const id of ['yuki', 'takaya', 'atsushi'] as const) {
      const slot = s.players[id];
      assert.ok(slot.xp >= 0 && Number.isFinite(slot.xp), `xp broke on ${raw}`);
      assert.ok(batsFor(s, id).includes(slot.bat), `equipped bat not owned for ${raw}`);
    }
  }
});

test('a save can never equip a bat the level has not reached', () => {
  const s = parseSave('{"players":{"takaya":{"xp":0,"bat":"basket"}}}');
  assert.equal(s.players.takaya.bat, DEFAULT_BAT);
});

test('a save can never face an opponent the level has not reached', () => {
  const s = parseSave('{"players":{"takaya":{"xp":0,"pitcher":"closer"}}}');
  assert.equal(s.players.takaya.pitcher, 'rookie');
});

test('an old single-career save keeps its progress', () => {
  // The shape before each character had his own slot. Throwing it away would
  // throw away somebody's evening; splitting it three ways would invent
  // progress nobody made. It goes to the batter who was the default.
  const s = parseSave('{"points":9000,"equipped":"maple","bestScore":4000}');
  assert.equal(s.players.takaya.xp, 9000);
  assert.equal(s.players.takaya.bat, 'maple');
  assert.equal(s.players.yuki.xp, 0);
  assert.equal(s.bestScore, 4000);
});

test('an empty save is three fresh careers', () => {
  const s = emptySave();
  for (const id of ['yuki', 'takaya', 'atsushi'] as const) {
    assert.equal(s.players[id].xp, 0);
    assert.equal(s.players[id].bat, DEFAULT_BAT);
  }
});

test('owned bats come back in canonical order, derived from the level', () => {
  // The stored list is no longer read at all: the LEVEL is the truth, so a save
  // claiming to own the endgame bat at zero experience owns nothing but wood.
  const cheat = parseSave('{"players":{"takaya":{"xp":0,"bat":"basket"}}}');
  assert.deepEqual(batsFor(cheat, 'takaya'), [DEFAULT_BAT]);

  const grown = parseSave('{"players":{"takaya":{"xp":300000}}}');
  const owned = batsFor(grown, 'takaya');
  assert.deepEqual([...owned], BAT_IDS.filter((id) => owned.includes(id)),
    'the list must come back in level order');
  assert.ok(owned.length > 10, `only ${owned.length} bats at 300k experience`);
});
