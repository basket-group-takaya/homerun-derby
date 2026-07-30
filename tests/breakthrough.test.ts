/**
 * 限界突破: the post-99 mode, and the ways it can silently do nothing.
 *
 * The owner asked for a power maximum of 200 above level 99 (令和8年7月31日).
 * Three rewards in this project have already shipped worth less than advertised
 * or worth nothing at all, and every one of them looked correct on screen: the
 * number went up and the ball did not. The number going up is therefore not
 * what these tests check. They check METRES.
 *
 * The specific trap here is that TWO separate clamps sit between power and the
 * ball — effectiveMaxExit in bats.ts and a second Math.min in bat.ts — and both
 * were pinned to the 197.8 km/h human record. Raising power alone moves neither,
 * so a fully broken-through batter would have hit the ball at exactly the speed
 * a level-99 one does.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { PlayerId } from '../src/core/constants.js';
import { PLAYER_IDS, EXIT_VELOCITY_MAX } from '../src/core/constants.js';
import {
  abilityAt, breakthroughForXp, starsForXp, starProgress,
  BREAK_STARS, BREAK_XP_PER_STAR,
} from '../src/core/ability.js';
import { resolveContact } from '../src/core/bat.js';
import { BATS } from '../src/core/bats.js';
import { simulateBattedBall } from '../src/core/physics.js';
import { xpToReach, MAX_LEVEL } from '../src/core/level.js';
import {
  BREAKTHROUGH_ABILITY_MAX, EFFECTIVE_POWER_MAX, exitCeiling, maxExitKmhFor,
} from '../src/core/ranks.js';

const BAT = Object.values(BATS).reduce((a, b) => (b.exit > a.exit ? b : a));
const BASE_XP = xpToReach(MAX_LEVEL);
const xpForStars = (stars: number): number => BASE_XP + stars * BREAK_XP_PER_STAR;

/** Carry of a perfectly timed, perfectly centred swing [m]. */
const perfectCarry = (player: PlayerId, breakthrough: number): number => {
  const ball = { x: 0, y: 0.95 };
  const c = resolveContact({
    ability: abilityAt(player, MAX_LEVEL, breakthrough),
    cursor: ball, ball, timingError: 0, bat: BAT,
  });
  assert.notEqual(c.kind, 'whiff', 'a perfect swing must not miss');
  return simulateBattedBall({
    exitVelocity: c.exitVelocity,
    launchAngle: c.launchAngle,
    sprayAngle: c.sprayAngle,
    backspinRpm: c.spin.backspinRpm,
    sidespinRpm: c.spin.sidespinRpm,
    contactHeight: c.contactHeight,
  }).distance;
};

test('the limit break is worth real distance, for every player', () => {
  for (const player of PLAYER_IDS) {
    const before = perfectCarry(player, 0);
    const after = perfectCarry(player, 1);
    assert.ok(after - before > 20,
      `${player}: 限界突破 must be worth more than 20 m, got ${(after - before).toFixed(1)}`);
  }
});

test('every star is worth distance — none of them is a step backwards', () => {
  // The failure this exists for: a reward that makes the batter WORSE. It has
  // happened three times, always by moving something that interacted with a
  // ceiling, and it is invisible on screen because the number still went up.
  for (const player of PLAYER_IDS) {
    let last = perfectCarry(player, 0);
    for (let star = 1; star <= BREAK_STARS; star++) {
      const carry = perfectCarry(player, breakthroughForXp(xpForStars(star)));
      assert.ok(carry > last,
        `${player} ☆${star}: ${carry.toFixed(1)} m is not more than ☆${star - 1}'s ${last.toFixed(1)} m`);
      last = carry;
    }
  }
});

test('the exit-velocity ceiling actually moves', () => {
  // Both clamps used to be nailed to the record. If this ever goes back to
  // returning a constant, the test above still passes for a while on launch
  // angle alone and then stops meaning anything.
  assert.equal(exitCeiling(0), EXIT_VELOCITY_MAX, 'no break: the human record');
  assert.ok(exitCeiling(1) > EXIT_VELOCITY_MAX * 1.15,
    'full break must lift the ceiling well clear of the record');
  assert.ok(exitCeiling(0.5) > exitCeiling(0) && exitCeiling(0.5) < exitCeiling(1),
    'and move continuously in between');
});

test('power reaches 200 on the scale, and stops there', () => {
  // 勇樹 is the one whose cap IS the scale maximum, so he is the one the
  // owner's "MAX becomes 200" is about.
  const full = abilityAt('yuki', MAX_LEVEL, 1);
  assert.equal(full.power, BREAKTHROUGH_ABILITY_MAX);
  assert.equal(abilityAt('yuki', MAX_LEVEL, 5).power, BREAKTHROUGH_ABILITY_MAX,
    'progress beyond 1 must not keep climbing');
});

test('the three keep their identities through the limit break', () => {
  // The owner asked for different characters (令和8年7月30日). A limit break
  // that flattens everyone to 200 ends the game with three identical batters.
  const power = (p: PlayerId): number => abilityAt(p, MAX_LEVEL, 1).power;
  assert.ok(power('yuki') > power('takaya'), 'yuki stays the power hitter');
  assert.ok(power('takaya') > power('atsushi'));
});

test('meet does not rise with the limit break', () => {
  // Meet is the contact radius — the size of the target. Raising it does not
  // send the ball further, it stops the game asking anything, and the whole
  // difficulty of this game lives in the timing window.
  for (const player of PLAYER_IDS) {
    assert.equal(
      abilityAt(player, MAX_LEVEL, 1).meet,
      abilityAt(player, MAX_LEVEL, 0).meet,
      `${player}: meet must be untouched`);
  }
});

test('nothing breaks through before level 99 is paid for', () => {
  assert.equal(breakthroughForXp(0), 0);
  assert.equal(breakthroughForXp(BASE_XP - 1), 0);
  assert.equal(breakthroughForXp(BASE_XP), 0);
  assert.ok(breakthroughForXp(BASE_XP + 1) > 0);
});

test('stars count up to five and stop', () => {
  assert.equal(starsForXp(BASE_XP), 0);
  for (let star = 1; star <= BREAK_STARS; star++) {
    assert.equal(starsForXp(xpForStars(star)), star, `☆${star}`);
  }
  assert.equal(starsForXp(xpForStars(BREAK_STARS) * 10), BREAK_STARS,
    'grinding past the end must not invent a sixth star');
  assert.equal(breakthroughForXp(xpForStars(BREAK_STARS) * 10), 1);
});

test('the bar within a star runs 0 to 1 and never jumps backwards', () => {
  let previousStar = -1;
  let last = -1;
  for (let xp = BASE_XP; xp <= xpForStars(BREAK_STARS); xp += BREAK_XP_PER_STAR / 20) {
    const star = starsForXp(xp);
    const f = starProgress(xp);
    assert.ok(f >= 0 && f <= 1, `progress out of range at ${xp}: ${f}`);
    if (star === previousStar) {
      assert.ok(f >= last - 1e-9, `progress went backwards inside ☆${star}`);
    }
    previousStar = star;
    last = f;
  }
});

test('the level cap is still 99', () => {
  // The owner said 99 is the maximum and asked for a limit break FROM there,
  // not for level 100. The stars are a second axis, not more levels.
  assert.equal(MAX_LEVEL, 99);
});

test('the broken-through ceiling still bounds the strongest possible swing', () => {
  // The mirror of the ordinary-game assertion in tests/ability.test.ts. Without
  // it the limit break has no upper bound at all: the record no longer applies
  // and nothing else was written down.
  const strongest = Math.max(...Object.values(BATS).map((b) => b.exit));
  const worst = (maxExitKmhFor(EFFECTIVE_POWER_MAX) / 3.6) * strongest;
  assert.ok(worst <= exitCeiling(1) + 1e-9,
    `the strongest broken-through swing reaches ${(worst * 3.6).toFixed(1)} km/h, `
    + `past the ${(exitCeiling(1) * 3.6).toFixed(1)} km/h ceiling`);
  assert.ok(worst > exitCeiling(1) * 0.95,
    'and it should be close, or the top of the limit break is wasted');
});
