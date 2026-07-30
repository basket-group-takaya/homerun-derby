/**
 * Levels and the bats they hand over.
 *
 * The whole progression of the game is now this file plus src/core/bats.ts, so
 * an off-by-one here is not a cosmetic bug: it is either a bat that never
 * arrives or one that arrives at level 1 and ends the progression on the first
 * round. Written before the UI that shows it (PROMPT.md 3-2).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BAT_UNLOCK_LEVEL, MAX_LEVEL, XP_BASE, batsGained, levelOf, levelProgress,
  unlockedBats, xpToNext, xpToReach,
} from '../src/core/level.js';
import { BAT_IDS, DEFAULT_BAT } from '../src/core/bats.js';

test('a new player is level 1 and owns exactly the starting bat', () => {
  assert.equal(levelOf(0), 1);
  assert.deepEqual(unlockedBats(1), [DEFAULT_BAT]);
});

test('levelOf and xpToReach are inverses at every boundary', () => {
  for (let level = 1; level < MAX_LEVEL; level++) {
    const at = xpToReach(level);
    assert.equal(levelOf(at), level, `${at} XP should be exactly level ${level}`);
    assert.equal(levelOf(at - 1), level - 1 || 1, `one XP short of level ${level}`);
    assert.equal(levelOf(at + 1), level, `one XP past level ${level}`);
  }
});

test('experience never lowers the level', () => {
  let previous = 1;
  for (let xp = 0; xp < 200_000; xp += 137) {
    const level = levelOf(xp);
    assert.ok(level >= previous, `level fell from ${previous} to ${level} at ${xp} XP`);
    previous = level;
  }
});

test('the level is capped, and the cap does not misreport progress', () => {
  assert.equal(levelOf(1e12), MAX_LEVEL);
  assert.equal(levelProgress(1e12), 1);
  assert.equal(xpToNext(1e12), 0);
});

test('progress runs 0 to 1 inside a level and never leaves it', () => {
  for (let level = 1; level < 8; level++) {
    const from = xpToReach(level);
    const to = xpToReach(level + 1);
    assert.ok(Math.abs(levelProgress(from)) < 1e-9, `level ${level} should start at 0`);
    const mid = levelProgress(Math.floor((from + to) / 2));
    assert.ok(mid > 0.3 && mid < 0.7, `mid-level progress was ${mid.toFixed(2)}`);
    assert.ok(levelProgress(to - 1) < 1, 'progress must not reach 1 before the level does');
  }
});

test('xpToNext agrees with the thresholds', () => {
  for (const xp of [0, 1, 499, 500, 1499, 1500, 12345]) {
    const level = levelOf(xp);
    assert.equal(xpToNext(xp), xpToReach(level + 1) - xp, `wrong at ${xp} XP`);
  }
});

// ---------------------------------------------------------------------------
// the bats
// ---------------------------------------------------------------------------

test('every bat is reachable, and no two arrive at once', () => {
  const levels = BAT_IDS.map((id) => BAT_UNLOCK_LEVEL[id]);
  for (const [i, level] of levels.entries()) {
    assert.ok(level >= 1 && level <= MAX_LEVEL,
      `${BAT_IDS[i]} unlocks at level ${level}, outside 1..${MAX_LEVEL}`);
  }
  assert.equal(new Set(levels).size, levels.length,
    'two bats unlock at the same level, so one of them lands unnoticed');
});

test('unlockedBats grows monotonically and never loses one', () => {
  let previous: readonly string[] = [];
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const now = unlockedBats(level);
    for (const id of previous) {
      assert.ok(now.includes(id as never), `${id} disappeared at level ${level}`);
    }
    previous = now;
  }
  assert.equal(previous.length, BAT_IDS.length, 'the cap should unlock everything');
});

test('batsGained reports exactly what crossing a level handed over', () => {
  // The banner reads this. Reporting a bat twice would congratulate the player
  // for something they already had; missing one hands it over in silence.
  const seen = new Set<string>();
  for (let level = 1; level < MAX_LEVEL; level++) {
    for (const id of batsGained(level, level + 1)) {
      assert.ok(!seen.has(id), `${id} was awarded twice`);
      seen.add(id);
      assert.equal(BAT_UNLOCK_LEVEL[id], level + 1, `${id} announced at the wrong level`);
    }
  }
  assert.equal(seen.size, BAT_IDS.length - 1, 'every bat past the first should be awarded once');
  assert.deepEqual(batsGained(5, 5), [], 'no level change should hand over nothing');
});

test('a multi-level jump hands over every bat it passed', () => {
  // A first round can cross a dozen levels at once, and the player must not have
  // to level again to collect the ones that were skipped on the way.
  const jump = batsGained(1, 21);
  assert.ok(jump.includes('ash') && jump.includes('maple')
    && jump.includes('birch') && jump.includes('gold'),
  `a jump from 1 to 21 gave ${jump.join(', ')}`);
  assert.equal(jump.length, 4, 'exactly the four between 1 and 21');
});

test('the ladder is reachable, and the early rungs are close together', () => {
  /*
   * 【調整可】, but it has to be checked somewhere, and against the RIGHT round.
   *
   * A flat "3000 a round" is the wrong yardstick for a ninety-nine level ladder:
   * a level-1 batter with G power and 弾道1 scores a few hundred, and a level-80
   * one with the crown ability, a points bat and the 守護神 on the mound clears
   * twenty thousand. Measuring the last bat against the first round's score says
   * a hundred rounds; measuring it against the round you would actually be
   * playing by then says about thirty.
   */
  const late = 12_000;
  const last = xpToReach(BAT_UNLOCK_LEVEL.basket);
  assert.ok(last / late < 45, `the last bat needs ${(last / late).toFixed(0)} late rounds`);
  assert.ok(last / late > 8, 'the last bat should not arrive in the first evening');

  // the early ones are what decide whether anybody gets that far
  assert.ok(xpToReach(2) < 400, `level 2 needs ${xpToReach(2)} experience`);
  assert.ok(xpToReach(5) < 2500, `level 5 needs ${xpToReach(5)} experience`);
  assert.equal(XP_BASE > 0, true);
});
