/**
 * PROMPT.md 3-4: the three monotonicity properties. If any of these break, the
 * batted-ball formula has a bug and the game will feel arbitrary — a player
 * would sometimes be rewarded for meeting the ball worse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveContact } from '../src/core/bat.js';
import type { ContactInput } from '../src/core/bat.js';
import { simulateBattedBall } from '../src/core/physics.js';
import {
  PLAYERS, MAX_EXIT_KMH, T_MISS, T_JUST, ZONE_BOTTOM, ZONE_TOP,
} from '../src/core/constants.js';

const MID_Y = (ZONE_BOTTOM + ZONE_TOP) / 2;
import type { Ability } from '../src/core/ability.js';
import { abilityAt } from '../src/core/ability.js';
import { rankIndex, rankOf } from '../src/core/ranks.js';

const BALL = { x: 0, y: 0.75 } as const;

/**
 * A batter with the numbers spelled out.
 *
 * Abilities are values now, not letters, and they are a function of who and how
 * far along he is. The monotonicity properties are about the NUMBERS, so these
 * tests build ability sets directly rather than going through a player, and the
 * few that care about a real player call abilityAt.
 */
const able = (over: Partial<Ability> = {}): Ability => ({
  meet: 60, power: 60, trajectory: 3, specials: [], ...over,
});

const swing = (over: Partial<ContactInput> = {}): ContactInput => ({
  ability: able(),
  cursor: { x: 0, y: 0.75 },
  ball: BALL,
  timingError: 0,
  ...over,
});

/** Carry distance of whatever the contact produced. */
const carry = (input: ContactInput): number => {
  const c = resolveContact(input);
  if (c.kind === 'whiff') return 0;
  return simulateBattedBall({
    exitVelocity: c.exitVelocity,
    launchAngle: c.launchAngle,
    sprayAngle: c.sprayAngle,
    backspinRpm: c.spin.backspinRpm,
    sidespinRpm: c.spin.sidespinRpm,
    contactHeight: c.contactHeight,
  }).distance;
};

// ---------------------------------------------------------------------------
// PROMPT.md 3-4, property 1
// ---------------------------------------------------------------------------
test('more power never travels less, all else equal', () => {
  // Every value, not every rank: a rank spans up to twenty points, so stepping
  // by rank would have skipped the nineteen places inside F where a regression
  // could hide.
  for (const t of [-0.04, -0.01, 0, 0.02, 0.05]) {
    for (const dy of [-0.02, 0, 0.02]) {
      let previous = -1;
      for (let power = 1; power <= 100; power += 1) {
        const d = carry(swing({
          ability: able({ power }), timingError: t, cursor: { x: 0, y: 0.75 - dy },
        }));
        assert.ok(d >= previous - 1e-9,
          `power ${power} travelled ${d.toFixed(2)} m, less than ${power - 1} `
          + `(${previous.toFixed(2)} m) at t=${t}, dy=${dy}`);
        previous = d;
      }
    }
  }
});

// ---------------------------------------------------------------------------
// PROMPT.md 3-4, property 2
// ---------------------------------------------------------------------------
test('more meet error never travels further, at fixed undercut', () => {
  // e is grown HORIZONTALLY so the undercut u stays fixed. Growing it
  // vertically would change the launch angle too, which is a different
  // experiment - see docs/SPEC.md 4-5.
  for (const id of ['yuki', 'takaya', 'atsushi'] as const) {
    for (const level of [1, 40, 99]) {
      const ability = abilityAt(id, level);
      for (const t of [-0.03, 0, 0.03]) {
        let previous = Infinity;
        for (let dx = 0; dx <= 0.20; dx += 0.005) {
          const d = carry(swing({ ability, timingError: t, cursor: { x: -dx, y: 0.75 } }));
          assert.ok(d <= previous + 1e-9,
            `${id} Lv.${level}: meet error ${dx.toFixed(3)} m travelled ${d.toFixed(2)} m, `
            + `further than at ${(dx - 0.005).toFixed(3)} m (${previous.toFixed(2)} m)`);
          previous = d;
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// PROMPT.md 3-4, property 3
// ---------------------------------------------------------------------------
test('worse timing never travels further', () => {
  for (const id of ['yuki', 'takaya', 'atsushi'] as const) {
    for (const level of [1, 40, 99]) {
      const ability = abilityAt(id, level);
      for (const sign of [-1, 1]) {
        let previous = Infinity;
        for (let mag = 0; mag <= T_MISS + 0.02; mag += 0.002) {
          const d = carry(swing({ ability, timingError: sign * mag }));
          assert.ok(d <= previous + 1e-9,
            `${id} Lv.${level}: |t|=${mag.toFixed(3)} s travelled ${d.toFixed(2)} m, `
            + `further than |t|=${(mag - 0.002).toFixed(3)} s (${previous.toFixed(2)} m)`);
          previous = d;
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// direction — this test IS the specification for the sign of phi
// ---------------------------------------------------------------------------
test('early swings pull to left field, late swings go the other way', () => {
  const early = resolveContact(swing({ timingError: -0.05 }));
  const onTime = resolveContact(swing({ timingError: 0 }));
  const late = resolveContact(swing({ timingError: 0.05 }));

  assert.ok(early.sprayAngle < 0,
    `early swing must pull toward -x (left field), got phi=${early.sprayAngle}`);
  assert.equal(onTime.sprayAngle, 0, 'perfect timing goes to centre');
  assert.ok(late.sprayAngle > 0,
    `late swing must go toward +x (right field), got phi=${late.sprayAngle}`);

  // and the ball actually lands on that side
  const land = (t: number): number => {
    const c = resolveContact(swing({ timingError: t }));
    return simulateBattedBall({
      exitVelocity: c.exitVelocity, launchAngle: c.launchAngle, sprayAngle: c.sprayAngle,
      backspinRpm: c.spin.backspinRpm, sidespinRpm: c.spin.sidespinRpm,
      contactHeight: c.contactHeight,
    }).landing.x;
  };
  assert.ok(land(-0.05) < land(0.05), 'early must land left of late');
});

// ---------------------------------------------------------------------------
// classification and skills
// ---------------------------------------------------------------------------
test('a dead-centre, dead-on swing is a just-meet', () => {
  const c = resolveContact(swing());
  assert.equal(c.kind, 'just');
  assert.equal(c.e, 0);
  assert.equal(c.quality, 1);
});

test('missing the ball entirely is a whiff, with no batted ball', () => {
  const far = resolveContact(swing({ cursor: { x: 0.9, y: 0.75 } }));
  assert.equal(far.kind, 'whiff');
  assert.equal(far.exitVelocity, 0);

  const lateSwing = resolveContact(swing({ timingError: T_MISS + 0.001 }));
  assert.equal(lateSwing.kind, 'whiff');
});

/*
 * The four skill tests that used to sit here are gone, and so are the skills.
 *
 * The owner made all three players identical on 令和8年7月30日 — 「能力は全員
 * 同じにして」 — so 情熱の一振り, 粘り and 上を狙う no longer exist to assert.
 * What replaces them is the opposite assertion: that nothing distinguishes the
 * three, which is easy to break by accident and impossible to notice in play,
 * because you would have to bat as all three and compare distances.
 */

test('all three players have identical ability', () => {
  const ids = ['yuki', 'takaya', 'atsushi'] as const;
  for (const id of ids) {
    assert.equal(PLAYERS[id].meet, PLAYERS.takaya.meet, `${id} meet differs`);
    assert.equal(PLAYERS[id].power, PLAYERS.takaya.power, `${id} power differs`);
    assert.equal(PLAYERS[id].trajectory, PLAYERS.takaya.trajectory, `${id} trajectory differs`);
    assert.equal(PLAYERS[id].skill, 'none', `${id} still has a special skill`);
  }
});

test('the three start different, and none of them starts above E', () => {
  // The owner's scale: 最低G・中間F・良いE, E being the best a player may start
  // at. Identical abilities were the previous instruction and are now reversed,
  // so this test says the opposite of the one it replaced.
  const ball = { x: 0.02, y: MID_Y + 0.03 };
  const speeds = new Set<number>();
  for (const id of ['yuki', 'takaya', 'atsushi'] as const) {
    const a = abilityAt(id, 1);
    assert.ok(rankIndex(rankOf(a.meet)) <= rankIndex('E'),
      `${id} starts at meet ${rankOf(a.meet)}, above the E ceiling`);
    assert.ok(rankIndex(rankOf(a.power)) <= rankIndex('E'),
      `${id} starts at power ${rankOf(a.power)}, above the E ceiling`);
    assert.equal(a.trajectory, 1, `${id} does not start at 弾道1`);
    assert.deepEqual(a.specials, [], `${id} starts with a special ability`);
    speeds.add(resolveContact({
      ability: a, cursor: ball, ball, timingError: 0.01,
    }).exitVelocity);
  }
  assert.equal(speeds.size, 3, 'the three should not hit the same ball the same way');
});

test('everyone grows, and nobody shrinks', () => {
  for (const id of ['yuki', 'takaya', 'atsushi'] as const) {
    let meet = 0;
    let power = 0;
    for (let level = 1; level <= 99; level++) {
      const a = abilityAt(id, level);
      assert.ok(a.meet >= meet, `${id} meet fell at level ${level}`);
      assert.ok(a.power >= power, `${id} power fell at level ${level}`);
      meet = a.meet;
      power = a.power;
    }
    const start = abilityAt(id, 1);
    const end = abilityAt(id, 99);
    assert.ok(end.meet > start.meet + 20 || end.power > start.power + 20,
      `${id} barely grows: ${start.meet}/${start.power} to ${end.meet}/${end.power}`);
  }
});

test('a fork cannot be hit, however perfect the swing', () => {
  // The owner's rule: 「フォークはボールになるように設定して、フォークの時に
  // 振ったら空振りするように」. Dead-centre, dead-on, and still a whiff.
  const ball = { x: 0, y: MID_Y };
  const perfect = resolveContact({
    ability: abilityAt('takaya', 40), cursor: ball, ball, timingError: 0,
  });
  assert.notEqual(perfect.kind, 'whiff', 'the control swing should connect');
  const fork = resolveContact({
    ability: abilityAt('takaya', 40), cursor: ball, ball, timingError: 0,
    unhittable: true,
  });
  assert.equal(fork.kind, 'whiff');
  assert.equal(fork.exitVelocity, 0);
});

test('the three exit-velocity ranks are ordered and inside the real range', () => {
  assert.ok(MAX_EXIT_KMH.S > MAX_EXIT_KMH.A);
  assert.ok(MAX_EXIT_KMH.A > MAX_EXIT_KMH.C);
  // the fastest batted ball ever measured is 197.8 km/h
  assert.ok(MAX_EXIT_KMH.S < 197.8);
});

test('contact is never produced with NaN or a negative exit velocity', () => {
  for (let dx = -0.3; dx <= 0.3; dx += 0.02) {
    for (let dy = -0.3; dy <= 0.3; dy += 0.02) {
      for (const t of [-0.2, -T_JUST, 0, T_JUST, 0.2]) {
        const c = resolveContact(swing({ cursor: { x: dx, y: 0.75 + dy }, timingError: t }));
        assert.ok(Number.isFinite(c.exitVelocity) && c.exitVelocity >= 0);
        assert.ok(Number.isFinite(c.launchAngle) && Number.isFinite(c.sprayAngle));
        assert.ok(Number.isFinite(c.spin.backspinRpm) && Number.isFinite(c.spin.sidespinRpm));
      }
    }
  }
});
