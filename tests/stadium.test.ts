import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bleacherOf, fenceDistance, hitTarget, isFair, judgeBattedBall, POLE_POSITIONS,
  sprayAngleOf,
} from '../src/core/stadium.js';
import { simulateBattedBall } from '../src/core/physics.js';
import {
  FENCE_ALLEY, FENCE_CENTRE, FENCE_LINE, FENCE_HEIGHT, FOUL_ANGLE, SCORE_DISTANCE_REF,
  POLE_TOP, SCOREBOARD_BOTTOM, SCOREBOARD_HALF_WIDTH, SCOREBOARD_TOP, SCOREBOARD_Z,
} from '../src/core/constants.js';
import type { Vec3 } from '../src/core/vec.js';
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

// ---------------------------------------------------------------------------
// targets — docs/REFERENCE-HB2.md 5-2, added with src/core/round.ts
// ---------------------------------------------------------------------------

test('a ball threaded through a foul pole is detected despite coarse sampling', () => {
  // The trail is sampled every 1/60 s; at 40 m/s that is 0.67 m between points,
  // wider than the 0.36 m pole. Testing the sample POINTS would miss most hits,
  // so hitTarget solves for the closest approach along each segment. This
  // fixture deliberately straddles the pole with both endpoints outside it.
  const pole = POLE_POSITIONS.rightPole;
  const before = vec(pole.x - 0.6, 6, pole.z - 0.6);
  const after = vec(pole.x + 0.6, 6, pole.z + 0.6);
  assert.equal(hitTarget([before, after]), 'rightPole');
  assert.equal(
    hitTarget([vec(pole.x - 0.6, 6, pole.z - 0.6), vec(pole.x - 0.4, 6, pole.z - 0.4)]),
    null, 'a segment that stops short must not register');
});

test('a foul pole is only live between the fence top and the top of the pole', () => {
  const pole = POLE_POSITIONS.leftPole;
  const across = (y: number): readonly Vec3[] =>
    [vec(pole.x - 0.6, y, pole.z - 0.6), vec(pole.x + 0.6, y, pole.z + 0.6)];
  assert.equal(hitTarget(across(FENCE_HEIGHT + 2)), 'leftPole');
  assert.equal(hitTarget(across(FENCE_HEIGHT - 1.5)), null, 'below the fence top is the wall');
  assert.equal(hitTarget(across(POLE_TOP + 2)), null, 'above the pole is open sky');
});

test('a ball off the foul pole is a home run even though it lands foul', () => {
  // 公認野球規則 5.05(a)(5): the pole is fair territory all the way up.
  const pole = POLE_POSITIONS.rightPole;
  const trail = [
    vec(0, 1, 0),
    vec(pole.x - 0.5, 6, pole.z - 0.5),
    vec(pole.x + 0.5, 6, pole.z + 0.5),
    vec(pole.x + 12, 0, pole.z - 8),
  ];
  const landing = vec(pole.x + 12, 0, pole.z - 8);
  assert.ok(!isFair(sprayAngleOf(landing)), 'the fixture must land in foul ground');
  const result = judgeBattedBall(trail, landing, 105);
  assert.equal(result.outcome, 'homeRun');
  assert.equal(result.target, 'rightPole');
});

test('the scoreboard is only struck inside its actual panel', () => {
  const through = (x: number, y: number): readonly Vec3[] =>
    [vec(x, y, SCOREBOARD_Z - 3), vec(x, y, SCOREBOARD_Z + 3)];
  assert.equal(hitTarget(through(0, (SCOREBOARD_BOTTOM + SCOREBOARD_TOP) / 2)), 'scoreboard');
  assert.equal(hitTarget(through(0, SCOREBOARD_BOTTOM - 2)), null, 'under the board');
  assert.equal(hitTarget(through(0, SCOREBOARD_TOP + 2)), null, 'over the board');
  assert.equal(
    hitTarget(through(SCOREBOARD_HALF_WIDTH + 3, (SCOREBOARD_BOTTOM + SCOREBOARD_TOP) / 2)),
    null, 'wide of the board');
});

test('a ball that never reaches the scoreboard plane does not count', () => {
  assert.equal(hitTarget([
    vec(0, 12, 100), vec(0, 12, 120), vec(0, 8, SCOREBOARD_Z - 1),
  ]), null);
});

test('bleachers are split left / centre / right', () => {
  assert.equal(bleacherOf(-40), 'left');
  assert.equal(bleacherOf(-16), 'left');
  assert.equal(bleacherOf(0), 'centre');
  assert.equal(bleacherOf(14), 'centre');
  assert.equal(bleacherOf(30), 'right');
});

test('a home run records which block of seats it reached', () => {
  const ball = simulateBattedBall({
    exitVelocity: 47, launchAngle: 28, sprayAngle: -30,
    backspinRpm: 2200, sidespinRpm: 900, contactHeight: 0.8,
  });
  const result = judgeBattedBall(ball.trail, ball.landing, ball.distance);
  if (result.outcome === 'homeRun') {
    assert.equal(result.bleacher, 'left');
  }
  // balls that stay in the park have no bleacher
  const weak = simulateBattedBall({
    exitVelocity: 25, launchAngle: 20, sprayAngle: 0,
    backspinRpm: 1500, sidespinRpm: 0, contactHeight: 0.8,
  });
  assert.equal(
    judgeBattedBall(weak.trail, weak.landing, weak.distance).bleacher, null);
});
