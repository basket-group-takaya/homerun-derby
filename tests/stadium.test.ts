import test from 'node:test';
import assert from 'node:assert/strict';
import { fenceDistance, isFair, judgeBattedBall, sprayAngleOf } from '../src/core/stadium.js';
import { simulateBattedBall } from '../src/core/physics.js';
import {
  FENCE_ALLEY, FENCE_CENTRE, FENCE_LINE, FENCE_HEIGHT, FOUL_ANGLE, SCORE_DISTANCE_REF,
} from '../src/core/constants.js';
import { vec } from '../src/core/vec.js';

test('the fence hits its three measured control points', () => {
  assert.equal(fenceDistance(0), FENCE_CENTRE);
  assert.equal(fenceDistance(22.5), FENCE_ALLEY);
  assert.equal(fenceDistance(-22.5), FENCE_ALLEY);
  assert.equal(fenceDistance(45), FENCE_LINE);
  assert.equal(fenceDistance(-45), FENCE_LINE);
});

test('the fence is symmetric and shortens toward the lines', () => {
  let previous = Infinity;
  for (let a = 0; a <= FOUL_ANGLE; a += 1) {
    assert.equal(fenceDistance(a), fenceDistance(-a), `asymmetric at ${a} deg`);
    assert.ok(fenceDistance(a) <= previous + 1e-9, `not shortening at ${a} deg`);
    previous = fenceDistance(a);
  }
});

test('centre field matches the 120 m in the scoring formula', () => {
  // docs/SPEC.md 7-1: clearing the fence is worth the base 100 and every metre
  // past it is the distance bonus. That only lines up if they are equal.
  assert.equal(FENCE_CENTRE, SCORE_DISTANCE_REF);
});

test('fair territory is 45 degrees either side', () => {
  assert.ok(isFair(0) && isFair(44.9) && isFair(-44.9) && isFair(45));
  assert.ok(!isFair(45.1) && !isFair(-60));
});

test('spray angle is measured from centre toward first base', () => {
  assert.equal(sprayAngleOf(vec(0, 0, 100)), 0);
  assert.ok(sprayAngleOf(vec(50, 0, 50)) > 0, 'toward first base is positive');
  assert.ok(sprayAngleOf(vec(-50, 0, 50)) < 0, 'toward third base is negative');
  assert.ok(Math.abs(sprayAngleOf(vec(50, 0, 50)) - 45) < 1e-9);
});

const hit = (kmh: number, deg: number, spray: number) => {
  const r = simulateBattedBall({
    exitVelocity: kmh / 3.6, launchAngle: deg, sprayAngle: spray,
    backspinRpm: -763 + 120 * deg, sidespinRpm: -849, contactHeight: 0.95,
  });
  return judgeBattedBall(r.trail, r.landing, r.distance);
};

test('a well struck ball to centre is a home run', () => {
  const j = hit(185, 29, 0);
  assert.equal(j.outcome, 'homeRun');
  assert.ok(j.distance > FENCE_CENTRE, `only carried ${j.distance.toFixed(1)} m`);
  assert.ok(j.heightAtFence !== null && j.heightAtFence > FENCE_HEIGHT);
});

test('a weak ball stays in the park', () => {
  const j = hit(120, 20, 0);
  assert.equal(j.outcome, 'inPlay');
  assert.equal(j.heightAtFence, null);
});

test('a ball that reaches the fence too low is off the wall, not a home run', () => {
  // A line drive hard enough to reach the wall but still descending through it.
  let found: number | null = null;
  outer:
  for (let deg = 10; deg <= 20 && found === null; deg += 1) {
    for (let kmh = 150; kmh <= 198; kmh += 1) {
      const j = hit(kmh, deg, 0);
      if (j.outcome === 'offTheWall') {
        found = j.heightAtFence;
        break outer;
      }
    }
  }
  assert.ok(found !== null, 'expected some line drive to reach the wall below the top');
  assert.ok(found <= FENCE_HEIGHT, `height at fence ${found}`);
});

test('past the foul line is foul however far it went', () => {
  const j = hit(190, 28, 60);
  assert.equal(j.outcome, 'foul');
});

test('the short corners really are easier to clear than centre', () => {
  // Same contact, different direction. Compared at -30 degrees rather than hard
  // down the line: at 43 degrees the ball's own hook carries it foul, which is
  // realistic but makes the comparison meaningless.
  assert.ok(fenceDistance(-30) < fenceDistance(0), 'the corner must be shorter');
  for (let kmh = 145; kmh <= 175; kmh += 1) {
    const corner = hit(kmh, 26, -30).outcome === 'homeRun';
    const centre = hit(kmh, 26, 0).outcome === 'homeRun';
    if (corner && !centre) return;
  }
  assert.fail('the corner was never easier to clear than centre field');
});

test('judging never throws on a degenerate trail', () => {
  const j = judgeBattedBall([vec(0, 1, 0)], vec(0, 0, 0), 0);
  assert.equal(j.outcome, 'inPlay');
  assert.equal(j.distance, 0);
});
