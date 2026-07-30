/**
 * Abilities, ranks, growth, special abilities and opponents.
 *
 * This is the whole progression, and almost none of it is visible while playing:
 * a wrong number here shows up as "the game feels off", weeks later, with no way
 * to tell which of five multipliers did it. So the properties are pinned rather
 * than the appearance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ABILITY_MAX, ABILITY_MIN, BASE_LAUNCH_ANGLE, EFFECTIVE_POWER_MAX, RANKS,
  RANK_FLOOR, catchRadiusFor, maxExitKmhFor, rankIndex, rankOf,
} from '../src/core/ranks.js';
import {
  CAP, POWER_LINE, SPECIAL_IDS, SPECIAL_LEVEL, START, abilityAt, specialExit,
  specialLift, specialPower, specialXp, specialsAt, specialsUnlockedAt, trajectoryAt,
} from '../src/core/ability.js';
import { PITCHERS, PITCHER_IDS, SPEED_CAP, speedFactor, unlockedPitchers } from '../src/core/pitchers.js';
import { PITCHES } from '../src/core/pitch.js';
import { EXIT_VELOCITY_MAX } from '../src/core/constants.js';
import { BATS, effectiveMaxExit } from '../src/core/bats.js';
import { resolveContact } from '../src/core/bat.js';
import { simulateBattedBall } from '../src/core/physics.js';

const PLAYERS = ['yuki', 'takaya', 'atsushi'] as const;

// ---------------------------------------------------------------------------
// the パワプロ scale
// ---------------------------------------------------------------------------

test('the rank table matches the one it was taken from', () => {
  // 【確定】 パワプロアプリ, via GameWith, read 令和8年7月30日:
  // S 90-100 / A 80-89 / B 70-79 / C 60-69 / D 50-59 / E 40-49 / F 20-39 / G 1-19
  const expected: readonly (readonly [number, string])[] = [
    [1, 'G'], [19, 'G'], [20, 'F'], [39, 'F'], [40, 'E'], [49, 'E'],
    [50, 'D'], [59, 'D'], [60, 'C'], [69, 'C'], [70, 'B'], [79, 'B'],
    [80, 'A'], [89, 'A'], [90, 'S'], [100, 'S'],
  ];
  for (const [value, rank] of expected) {
    assert.equal(rankOf(value), rank, `${value} should be ${rank}`);
  }
});

test('rankOf never leaves the table, whatever it is handed', () => {
  for (const v of [-99, 0, 0.4, 100.6, 1e9, Number.NaN]) {
    assert.ok(RANKS.includes(rankOf(v)), `rankOf(${v}) fell off the scale`);
  }
});

test('the rank floors are in order and cover the range', () => {
  let previous = 0;
  for (const r of RANKS) {
    assert.ok(RANK_FLOOR[r] > previous, `${r} does not sit above the rank below`);
    previous = RANK_FLOOR[r];
  }
  assert.equal(RANK_FLOOR.G, ABILITY_MIN);
  assert.ok(RANK_FLOOR.S < ABILITY_MAX);
});

test('more of an ability is never worth less', () => {
  for (let v = ABILITY_MIN; v < ABILITY_MAX; v++) {
    assert.ok(catchRadiusFor(v + 1) > catchRadiusFor(v), `catch radius fell at ${v}`);
    assert.ok(maxExitKmhFor(v + 1) > maxExitKmhFor(v), `exit ceiling fell at ${v}`);
    assert.ok(rankIndex(rankOf(v + 1)) >= rankIndex(rankOf(v)), `rank fell at ${v}`);
  }
});

test('the exit ceiling leaves room for the strongest bat AND the crown', () => {
  /*
   * Measured at EFFECTIVE_POWER_MAX, not at 100. The scale a player reads tops
   * out at 100; the arithmetic tops out fifteen higher, because 世界のワン adds
   * to the value rather than multiplying the result. Checking 100 would leave
   * the actual worst case — a maxed slugger holding the endgame bat with the
   * crown — untested, and that is precisely the combination that would clamp.
   */
  const strongest = Math.max(...Object.values(BATS).map((b) => b.exit));
  const worst = (maxExitKmhFor(EFFECTIVE_POWER_MAX) / 3.6) * strongest;
  assert.ok(worst <= EXIT_VELOCITY_MAX + 1e-9,
    `the strongest possible swing reaches ${(worst * 3.6).toFixed(1)} km/h`);
  // and it should be close, or the top of the ladder is wasted
  assert.ok(worst > EXIT_VELOCITY_MAX * 0.97,
    `the strongest possible swing only reaches ${(worst * 3.6).toFixed(1)} km/h`);
});

// ---------------------------------------------------------------------------
// where the three start
// ---------------------------------------------------------------------------

test('nobody starts above E, and 弾道 starts at 1 for everyone', () => {
  for (const id of PLAYERS) {
    const a = abilityAt(id, 1);
    assert.ok(rankIndex(rankOf(a.meet)) <= rankIndex('E'), `${id} meet ${rankOf(a.meet)}`);
    assert.ok(rankIndex(rankOf(a.power)) <= rankIndex('E'), `${id} power ${rankOf(a.power)}`);
    assert.equal(a.trajectory, 1, `${id} 弾道`);
  }
});

test('the three start from different numbers', () => {
  const seen = new Set(PLAYERS.map((id) => `${START[id].meet}/${START[id].power}`));
  assert.equal(seen.size, 3, 'two players start identical');
  // and the owner's example — 「ミートがG、パワーがF」 — must be representable,
  // which means the spread has to cross rank boundaries rather than sit inside one
  const ranks = new Set(PLAYERS.flatMap((id) =>
    [rankOf(START[id].meet), rankOf(START[id].power)]));
  assert.ok(ranks.size >= 3, `only ${[...ranks].join('/')} appear at the start`);
});

test('growth is monotone, bounded by the caps, and reaches them', () => {
  for (const id of PLAYERS) {
    let previous = abilityAt(id, 1);
    for (let level = 2; level <= 99; level++) {
      const a = abilityAt(id, level);
      assert.ok(a.meet >= previous.meet, `${id} meet fell at ${level}`);
      assert.ok(a.power >= previous.power, `${id} power fell at ${level}`);
      assert.ok(a.meet <= CAP[id].meet, `${id} meet passed its cap at ${level}`);
      assert.ok(a.power <= CAP[id].power, `${id} power passed its cap at ${level}`);
      previous = a;
    }
    assert.equal(previous.meet, CAP[id].meet, `${id} never reaches his meet cap`);
    assert.equal(previous.power, CAP[id].power, `${id} never reaches his power cap`);
  }
});

test('the three stay different people all the way to 99', () => {
  // If everyone converged on the same numbers, the starting differences would be
  // an annoyance to grow out of rather than a character to play.
  const end = PLAYERS.map((id) => abilityAt(id, 99));
  const meets = end.map((a) => a.meet);
  const powers = end.map((a) => a.power);
  assert.equal(new Set(meets).size, 3);
  assert.equal(new Set(powers).size, 3);
  assert.ok(Math.max(...meets) - Math.min(...meets) > 15, 'the meet spread collapsed');
  assert.ok(Math.max(...powers) - Math.min(...powers) > 15, 'the power spread collapsed');
});

test('弾道 climbs 1 to 4 and never falls', () => {
  let previous = 1;
  for (let level = 1; level <= 99; level++) {
    const t = trajectoryAt(level);
    assert.ok(t >= previous, `弾道 fell at level ${level}`);
    assert.ok(t >= 1 && t <= 4, `弾道 ${t} is off the 1-4 scale`);
    previous = t;
  }
  assert.equal(trajectoryAt(1), 1);
  assert.equal(trajectoryAt(99), 4);
});

// ---------------------------------------------------------------------------
// the special abilities
// ---------------------------------------------------------------------------

test('the specials arrive in order and never arrive early', () => {
  assert.deepEqual(specialsAt(1), []);
  for (const id of SPECIAL_IDS) {
    const need = SPECIAL_LEVEL[id];
    assert.equal(specialsUnlockedAt(need - 1).includes(id), false,
      `${id} arrived before ${need}`);
    assert.equal(specialsUnlockedAt(need).includes(id), true,
      `${id} did not arrive at ${need}`);
  }
  assert.deepEqual([...specialsUnlockedAt(99)], [...SPECIAL_IDS]);
});

test('only one of the power line is ever active', () => {
  // 「それぞれが同時につくのではなく、いずれか1つずつだけがつく形に」. Collapsed
  // in specialsAt rather than in each caller: three badges for one effect, or a
  // bonus applied three times, is what happens when every reader has to remember.
  for (let level = 1; level <= 99; level++) {
    const active = specialsAt(level);
    const fromLine = active.filter((id) => POWER_LINE.includes(id));
    assert.ok(fromLine.length <= 1,
      `level ${level} has ${fromLine.join(' + ')} at once`);
  }
  assert.deepEqual([...specialsAt(99)], ['kingOfOne', 'wideAngle']);
  assert.deepEqual([...specialsAt(46)], ['artist', 'wideAngle']);
  assert.deepEqual([...specialsAt(21)], ['powerHitter']);
});

test('the power line is worth +5, +10 and +15, and never a sum', () => {
  assert.equal(specialPower([]), 0);
  assert.equal(specialPower(['powerHitter']), 5);
  assert.equal(specialPower(['artist']), 10);
  assert.equal(specialPower(['kingOfOne']), 15);
  assert.equal(specialPower(['powerHitter', 'artist', 'kingOfOne']), 15,
    'owning all three must be worth exactly the best, not 30');
  assert.equal(specialPower(['wideAngle']), 0, '広角打法 is not a power ability');
});

test('世界のワン is the strongest of the line', () => {
  assert.ok(specialLift(['kingOfOne']) > specialLift(['artist']));
  assert.ok(specialLift(['artist']) > specialLift(['powerHitter']));
  assert.ok(specialPower(['kingOfOne']) > specialPower(['artist']));
  assert.ok(specialXp(['kingOfOne']) > 1, 'the crown should pay extra experience');
  assert.equal(specialXp(['artist']), 1);
});

test('the +15 is not thrown away by the top of the scale', () => {
  // The trap: abilities display 1 to 100, so clamping the arithmetic there would
  // have made 世界のワン worth nothing to a level-99 slugger — the one player
  // most likely to have it. EFFECTIVE_POWER_MAX is why it still counts.
  assert.ok(maxExitKmhFor(115) > maxExitKmhFor(100),
    'power past 100 must still be worth something');
  const capped = abilityAt('yuki', 99);
  assert.equal(capped.power, 100, 'the displayed value should still cap at 100');
  assert.ok(maxExitKmhFor(capped.power + specialPower(capped.specials))
    > maxExitKmhFor(capped.power),
  '世界のワン does nothing for the player who has it');
});

test('広角打法 rescues a late swing without widening the window', () => {
  const ball = { x: 0, y: 0.95 };
  const carry = (specials: readonly ('wideAngle')[], t: number) => {
    const c = resolveContact({
      ability: { meet: 70, power: 70, trajectory: 3, specials },
      cursor: ball, ball, timingError: t, bat: BATS.wood,
    });
    if (c.kind === 'whiff') return 0;
    return simulateBattedBall({
      exitVelocity: c.exitVelocity, launchAngle: c.launchAngle, sprayAngle: c.sprayAngle,
      backspinRpm: c.spin.backspinRpm, sidespinRpm: c.spin.sidespinRpm, contactHeight: 0.95,
    }).distance;
  };
  const late = 0.055;
  assert.ok(carry(['wideAngle'], late) > carry([], late) + 5,
    'a late swing should carry noticeably further with 広角打法');
  // ...but it is not a wider window: a swing past the window still misses
  assert.equal(carry(['wideAngle'], 0.2), 0, '広角打法 must not turn a miss into a hit');
  // ...and it does nothing at all when the swing is early
  assert.ok(Math.abs(carry(['wideAngle'], -0.055) - carry([], -0.055)) < 1e-9,
    '広角打法 should not help an early swing');
  // ...nor when the timing is perfect
  assert.ok(Math.abs(carry(['wideAngle'], 0) - carry([], 0)) < 1e-9,
    '広角打法 should not be a free bonus on a perfect swing');
});

test('広角打法 sends the ball the other way, and that is the point', () => {
  const ball = { x: 0, y: 0.95 };
  const c = resolveContact({
    ability: { meet: 70, power: 70, trajectory: 3, specials: ['wideAngle'] },
    cursor: ball, ball, timingError: 0.05, bat: BATS.wood,
  });
  assert.ok(c.sprayAngle > 0, 'a late swing must still go to the opposite field');
  assert.notEqual(c.kind, 'whiff');
});

test('no special MULTIPLIES exit velocity, so none of them eats the bats', () => {
  /*
   * The bug this exists to prevent. The specials used to add +3/5/9% exit
   * velocity, and effectiveMaxExit divides the record by that multiplier to stop
   * a mistimed swing clamping to the same number as a perfect one — so at level
   * 99 the crown left the strongest bat delivering 5.5% of its advertised 14%.
   * Two rewards, one headroom, and no way to see it happening.
   */
  // They add POWER, which goes through effectiveMaxExit and is bounded by the
  // record. What they must not do is multiply the result afterwards.
  for (const set of [[], ['powerHitter'], ['artist'], ['kingOfOne']] as const) {
    assert.equal(specialExit(set), 1, `${set.join('+')} moved exit velocity`);
  }
  const plain = effectiveMaxExit(100, BATS.wood, specialExit(specialsAt(99)));
  const best = effectiveMaxExit(100, BATS.basket, specialExit(specialsAt(99)));
  assert.ok(best / plain > 1.10,
    `the strongest bat is worth ${((best / plain - 1) * 100).toFixed(1)}% at level 99`);
});

test('a level-1 batter cannot clear the fence, and a level-99 one can', () => {
  // The shape of the whole game. If the first were false there would be nothing
  // to grow toward; if the second were false there would be no point growing.
  const first = abilityAt('takaya', 1);
  const last = abilityAt('takaya', 99);
  assert.ok(BASE_LAUNCH_ANGLE[first.trajectory] + specialLift(first.specials) < 20,
    'a beginner should be hitting line drives');
  assert.ok(BASE_LAUNCH_ANGLE[last.trajectory] + specialLift(last.specials) > 34,
    'a finished player should be hitting the ball into the air');
  assert.ok(maxExitKmhFor(last.power) - maxExitKmhFor(first.power) > 15,
    'power should be worth at least 15 km/h of exit velocity over a career');
});

// ---------------------------------------------------------------------------
// the opponents
// ---------------------------------------------------------------------------

test('a faster opponent always pays more, or nobody would pick him', () => {
  const order = [...PITCHER_IDS].sort((a, b) => PITCHERS[a].speed - PITCHERS[b].speed);
  let xp = 0;
  let level = 0;
  for (const id of order) {
    assert.ok(PITCHERS[id].xp > xp, `${id} is faster than the one below and pays no more`);
    assert.ok(PITCHERS[id].level >= level, `${id} unlocks before a slower opponent`);
    xp = PITCHERS[id].xp;
    level = PITCHERS[id].level;
  }
});

test('the first opponent is available immediately and is genuinely slow', () => {
  assert.deepEqual(unlockedPitchers(1), ['rookie']);
  const kmh = PITCHES.straight.kmh * speedFactor(PITCHERS.rookie, 1);
  assert.ok(kmh < 115, `the opening fastball is ${kmh.toFixed(0)} km/h — too fast to start on`);
  assert.ok(kmh > 85, `the opening fastball is ${kmh.toFixed(0)} km/h — slower than a lob`);
});

test('the same opponent gets faster as the batter levels, but is capped', () => {
  let previous = 0;
  for (let level = 1; level <= 99; level++) {
    const f = speedFactor(PITCHERS.rookie, level);
    assert.ok(f >= previous, `speed fell at level ${level}`);
    previous = f;
  }
  for (const id of PITCHER_IDS) {
    assert.ok(speedFactor(PITCHERS[id], 99) <= SPEED_CAP + 1e-9, `${id} passed the cap`);
  }
  const top = PITCHES.straight.kmh * speedFactor(PITCHERS.closer, 99);
  assert.ok(top < 175, `the hardest fastball is ${top.toFixed(0)} km/h, past what anyone can time`);
});

test('every opponent is reachable', () => {
  assert.equal(unlockedPitchers(99).length, PITCHER_IDS.length);
});

// ---------------------------------------------------------------------------
// the shape of a career
// ---------------------------------------------------------------------------

test('a career never makes anybody worse', () => {
  /*
   * The test that should have existed two mistakes ago.
   *
   * Both times, a reward turned out to be a punishment, and both times only a
   * measurement found it. First a bat gave 5.5% of its advertised 14% because it
   * was competing with a special for the exit-velocity ceiling. Then 世界の王 —
   * the strongest ability in the game — cost eight metres of carry, because it
   * added ten degrees to a 弾道4 that was already at thirty and the ball went up
   * instead of out.
   *
   * Neither is visible while playing. You would have to remember how far you hit
   * it forty levels ago. So the property is asserted directly: for every player,
   * every level, with every bat, the ball goes further than it did the level
   * before.
   */
  for (const id of PLAYERS) {
    for (const batId of ['wood', 'gold', 'basket'] as const) {
      let previous = 0;
      for (let level = 1; level <= 99; level++) {
        const c = resolveContact({
          ability: abilityAt(id, level),
          cursor: { x: 0, y: 0.95 },
          ball: { x: 0, y: 0.95 },
          timingError: 0,
          bat: BATS[batId],
        });
        const d = simulateBattedBall({
          exitVelocity: c.exitVelocity,
          launchAngle: c.launchAngle,
          sprayAngle: 0,
          backspinRpm: c.spin.backspinRpm,
          sidespinRpm: c.spin.sidespinRpm,
          contactHeight: 0.95,
        }).distance;
        /*
         * 5 cm of tolerance, and the number is chosen rather than shrugged at.
         *
         * It was 0.25 m while the ideal launch angle was keyed on power; fixing
         * that to key on the actual exit velocity took the worst case from
         * 0.34 m to 0.02 m, so the tolerance came down with it. What is left is
         * the fixed-step integrator landing on a slightly different sample, not
         * a design fault. 5 cm is 0.04% of a 130 m carry; the bugs this test
         * exists for were EIGHT metres and a bat delivering 5.5% of an
         * advertised 14%.
         */
        assert.ok(d >= previous - 0.05,
          `${id} with ${batId} lost ${(previous - d).toFixed(2)} m going to level ${level}`);
        previous = d;
      }
    }
  }
});

test('the fence is out of reach at level 1 and comfortably in reach later', () => {
  // The whole arc of the game in one assertion. Both halves matter: if a
  // beginner could clear it there would be nothing to grow toward, and if a
  // finished player could not there would be no reason to.
  const carry = (id: typeof PLAYERS[number], level: number, batId: 'wood' | 'basket') => {
    const c = resolveContact({
      ability: abilityAt(id, level),
      cursor: { x: 0, y: 0.95 },
      ball: { x: 0, y: 0.95 },
      timingError: 0,
      bat: BATS[batId],
    });
    return simulateBattedBall({
      exitVelocity: c.exitVelocity,
      launchAngle: c.launchAngle,
      sprayAngle: 0,
      backspinRpm: c.spin.backspinRpm,
      sidespinRpm: c.spin.sidespinRpm,
      contactHeight: 0.95,
    }).distance;
  };
  for (const id of PLAYERS) {
    assert.ok(carry(id, 1, 'wood') < 100,
      `${id} clears a short fence on his first swing (${carry(id, 1, 'wood').toFixed(0)} m)`);
    assert.ok(carry(id, 99, 'basket') > 130,
      `${id} finishes at only ${carry(id, 99, 'basket').toFixed(0)} m`);
  }
});
