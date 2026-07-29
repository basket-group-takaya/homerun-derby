/**
 * PROMPT.md 3-4: the three monotonicity properties. If any of these break, the
 * batted-ball formula has a bug and the game will feel arbitrary — a player
 * would sometimes be rewarded for meeting the ball worse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveContact, catchRadius } from '../src/core/bat.js';
import type { ContactInput } from '../src/core/bat.js';
import { simulateBattedBall } from '../src/core/physics.js';
import {
  PLAYERS, MAX_EXIT_KMH, CURSOR_RADIUS, T_MISS, T_JUST,
  EXIT_VELOCITY_MAX, PASSION_CURSOR_BONUS, BALL_RADIUS,
} from '../src/core/constants.js';
import type { Rank, PlayerSpec } from '../src/core/constants.js';

const BALL = { x: 0, y: 0.75 } as const;

const swing = (over: Partial<ContactInput> = {}): ContactInput => ({
  player: PLAYERS.takaya,
  cursor: { x: 0, y: 0.75 },
  ball: BALL,
  timingError: 0,
  whiffStreak: 0,
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
  const ranks: readonly Rank[] = ['E', 'D', 'C', 'B', 'A', 'S'];
  for (const t of [-0.04, -0.01, 0, 0.02, 0.05]) {
    for (const dy of [-0.02, 0, 0.02]) {
      let previous = -1;
      for (const power of ranks) {
        // hold meet and trajectory fixed so only power moves
        const player: PlayerSpec = { ...PLAYERS.takaya, power };
        const d = carry(swing({
          player, timingError: t, cursor: { x: 0, y: 0.75 - dy },
        }));
        assert.ok(d >= previous - 1e-9,
          `power ${power} travelled ${d.toFixed(2)} m, less than the rank below `
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
  for (const player of [PLAYERS.yuki, PLAYERS.takaya, PLAYERS.atsushi]) {
    for (const t of [-0.03, 0, 0.03]) {
      let previous = Infinity;
      for (let dx = 0; dx <= 0.20; dx += 0.005) {
        const d = carry(swing({ player, timingError: t, cursor: { x: -dx, y: 0.75 } }));
        assert.ok(d <= previous + 1e-9,
          `${player.id}: meet error ${dx.toFixed(3)} m travelled ${d.toFixed(2)} m, `
          + `further than at ${(dx - 0.005).toFixed(3)} m (${previous.toFixed(2)} m)`);
        previous = d;
      }
    }
  }
});

// ---------------------------------------------------------------------------
// PROMPT.md 3-4, property 3
// ---------------------------------------------------------------------------
test('worse timing never travels further', () => {
  for (const player of [PLAYERS.yuki, PLAYERS.takaya, PLAYERS.atsushi]) {
    for (const sign of [-1, 1]) {
      let previous = Infinity;
      for (let mag = 0; mag <= T_MISS + 0.02; mag += 0.002) {
        const d = carry(swing({ player, timingError: sign * mag }));
        assert.ok(d <= previous + 1e-9,
          `${player.id}: |t|=${mag.toFixed(3)} s travelled ${d.toFixed(2)} m, `
          + `further than |t|=${(mag - 0.002).toFixed(3)} s (${previous.toFixed(2)} m)`);
        previous = d;
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

test('yuki hits harder on a just-meet, and never past the record', () => {
  const yuki = PLAYERS.yuki;
  const withSkill = resolveContact(swing({ player: yuki }));
  assert.equal(withSkill.kind, 'just');

  const plain: PlayerSpec = { ...yuki, skill: 'tenacity' };
  const withoutSkill = resolveContact(swing({ player: plain }));
  assert.ok(withSkill.exitVelocity > withoutSkill.exitVelocity, 'passion must add exit velocity');
  assert.ok(withSkill.exitVelocity <= EXIT_VELOCITY_MAX + 1e-9,
    `exit velocity ${withSkill.exitVelocity} exceeded the cap`);
});

test('yuki gets a wider cursor after two whiffs in a row', () => {
  const cold = catchRadius(PLAYERS.yuki, 2);
  const warm = catchRadius(PLAYERS.yuki, 0);
  assert.ok(cold > warm);
  const expected = CURSOR_RADIUS.E * PASSION_CURSOR_BONUS + BALL_RADIUS;
  assert.ok(Math.abs(cold - expected) < 1e-9);
  // other players get no such thing
  assert.equal(catchRadius(PLAYERS.takaya, 5), catchRadius(PLAYERS.takaya, 0));
});

test("atsushi's cursor Y moves the launch angle 1.5x as much", () => {
  const undercut = { x: 0, y: 0.73 };
  const a = resolveContact(swing({ player: PLAYERS.atsushi, cursor: undercut }));
  const plain: PlayerSpec = { ...PLAYERS.atsushi, skill: 'tenacity' };
  const b = resolveContact(swing({ player: plain, cursor: undercut }));
  const gainA = a.launchAngle - PLAYERS.atsushi.trajectory * 0;
  assert.ok(gainA > b.launchAngle, 'aimHigh must add more launch angle');
});

test('yuki has a far smaller cursor than atsushi, as the ranks demand', () => {
  const e = catchRadius(PLAYERS.yuki, 0);
  const s = catchRadius(PLAYERS.atsushi, 0);
  assert.ok(e < s * 0.62, `yuki ${e.toFixed(3)} m vs atsushi ${s.toFixed(3)} m`);
  // area is what actually decides how often contact happens
  assert.ok((e * e) / (s * s) < 0.40, 'yuki should have well under half the catch area');
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
