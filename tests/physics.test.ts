/**
 * Written before src/core/physics.ts, per PROMPT.md 4.
 *
 * The load-bearing test is "reproduces the published benchmark table". If that
 * one passes, the integrator agrees with Alan Nathan's calculator and the rest
 * of the game can be balanced against real distances instead of vibes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateBattedBall, dragCoefficient, liftCoefficient, spinForContact }
  from '../src/core/physics.js';
import {
  BALL_RADIUS, DT, EXIT_VELOCITY_MAX, REFERENCE_AIR_DENSITY, SIDESPIN_MAX, SPIN_MAX, SPIN_MIN,
} from '../src/core/constants.js';

const near = (actual: number, expected: number, tol: number, what: string): void => {
  assert.ok(Math.abs(actual - expected) <= tol,
    `${what}: got ${actual.toFixed(3)}, expected ${expected} +/- ${tol}`);
};

test('drag coefficient rises with spin, per the sourced fit', () => {
  near(dragCoefficient(0), 0.3008, 1e-9, 'Cd(0)');
  near(dragCoefficient(2000), 0.3592, 1e-9, 'Cd(2000rpm)');
  near(dragCoefficient(3000), 0.3884, 1e-9, 'Cd(3000rpm)');
  // strictly increasing
  for (let rpm = 0; rpm < 3600; rpm += 200) {
    assert.ok(dragCoefficient(rpm + 200) > dragCoefficient(rpm), `Cd not increasing at ${rpm}`);
  }
});

test('lift coefficient matches the sourced fit and saturates below 0.48', () => {
  // S = r*omega/v; 100 mph with 2000 rpm gives S = 0.173, Cl = 0.196
  const s = (BALL_RADIUS * ((2000 * 2 * Math.PI) / 60)) / (100 * 0.44704);
  near(s, 0.173, 0.002, 'spin parameter S');
  near(liftCoefficient(s), 0.196, 0.004, 'Cl(S=0.173)');
  assert.ok(liftCoefficient(1e6) < 0.481, 'Cl must saturate at 0.48');
  assert.equal(liftCoefficient(0), 0);
  for (let s2 = 0.01; s2 < 1; s2 += 0.05) {
    assert.ok(liftCoefficient(s2 + 0.05) > liftCoefficient(s2), `Cl not increasing at ${s2}`);
  }
});

test('reproduces the published maximum-distance envelope within 1%', () => {
  // docs/SPEC.md 6-3. Pure backspin, contact at 3 ft. The published table was
  // computed at 75 degF / RH 50%, so it must be compared at THAT air density,
  // not at the game's 20 degC standard — otherwise this is apples to oranges.
  const cases: readonly [number, number, number, number][] = [
    [145.4, 28.6, 2480, 110],
    [155.7, 27.8, 2384, 120],
    [166.2, 27.0, 2288, 130],
    [177.1, 26.3, 2204, 140],
    [188.2, 25.6, 2120, 150],
  ];
  for (const [kmh, deg, rpm, want] of cases) {
    const r = simulateBattedBall({
      exitVelocity: kmh / 3.6, launchAngle: deg, sprayAngle: 0,
      backspinRpm: rpm, sidespinRpm: 0, contactHeight: 0.9144,
      airDensity: REFERENCE_AIR_DENSITY,
    });
    near(r.distance, want, want * 0.01, `${kmh} km/h @ ${deg} deg`);
  }
});

test('the game air is denser than the reference air, so the game plays shorter', () => {
  const args = {
    exitVelocity: 185 / 3.6, launchAngle: 29, sprayAngle: 0,
    backspinRpm: 2717, sidespinRpm: 0, contactHeight: 0.9144,
  } as const;
  const game = simulateBattedBall(args).distance;
  const reference = simulateBattedBall({ ...args, airDensity: REFERENCE_AIR_DENSITY }).distance;
  assert.ok(game < reference, 'denser air must shorten the carry');
  assert.ok(reference - game < 3, `density difference should be ~1-2 m, got ${reference - game}`);
});

test('hang time is realistic — a 400 ft fly ball hangs about 5 seconds', () => {
  const r = simulateBattedBall({
    exitVelocity: 160.9 / 3.6, launchAngle: 30, sprayAngle: 0,
    backspinRpm: 2500, sidespinRpm: 0, contactHeight: 0.9144,
  });
  assert.ok(r.hangTime > 4.5 && r.hangTime < 6.5, `hang time ${r.hangTime.toFixed(2)}s`);
  assert.ok(r.apex > 20 && r.apex < 45, `apex ${r.apex.toFixed(1)}m`);
});

test('the optimal launch angle is 24-31 degrees, not 15', () => {
  // This is the regression test for the bad lift fit. With Cl = 1.5S/(0.25+S)
  // the optimum collapses to about 15 degrees and the trajectory rank inverts.
  for (const kmh of [150, 166, 178, 185]) {
    let best = { angle: 0, distance: -1 };
    for (let deg = 10; deg <= 45; deg += 0.5) {
      const d = simulateBattedBall({
        exitVelocity: kmh / 3.6, launchAngle: deg, sprayAngle: 0,
        backspinRpm: 2500, sidespinRpm: 0, contactHeight: 0.9144,
      }).distance;
      if (d > best.distance) best = { angle: deg, distance: d };
    }
    assert.ok(best.angle >= 24 && best.angle <= 31,
      `${kmh} km/h optimum was ${best.angle} deg (expected 24-31)`);
  }
});

test('the hardest ball the game can hit stays in the realistic band', () => {
  // Not "under the 153.9 m record" — that record is the longest ball anyone has
  // happened to hit, not a physical ceiling, and the published envelope itself
  // gives 150 m at 188 km/h. What matters is that the GAME cannot exceed what
  // the sport produces, so the cap is on exit velocity (constants.ts) and this
  // test pins the distance that cap implies.
  let max = 0;
  for (let deg = 10; deg <= 45; deg += 1) {
    max = Math.max(max, simulateBattedBall({
      exitVelocity: EXIT_VELOCITY_MAX, launchAngle: deg, sprayAngle: 0,
      backspinRpm: 2200, sidespinRpm: 0, contactHeight: 1.0,
    }).distance);
  }
  assert.ok(max > 145 && max < 160,
    `capped maximum was ${max.toFixed(1)} m, expected 145-160 m`);
});

test('more backspin does NOT simply mean more distance', () => {
  // docs/SPEC.md 6-5: drag rises with spin, so distance peaks then falls.
  const at = (rpm: number): number => simulateBattedBall({
    exitVelocity: 178 / 3.6, launchAngle: 28, sprayAngle: 0,
    backspinRpm: rpm, sidespinRpm: 0, contactHeight: 0.9144,
  }).distance;
  assert.ok(at(3600) < at(1800), 'expected 3600 rpm to travel LESS than 1800 rpm');
  assert.ok(at(1800) > at(600), 'expected 1800 rpm to beat 600 rpm');
});

test('sidespin curves a right-handed batter toward left field', () => {
  const straight = simulateBattedBall({
    exitVelocity: 170 / 3.6, launchAngle: 26, sprayAngle: 0,
    backspinRpm: 2300, sidespinRpm: 0, contactHeight: 0.9144,
  });
  const hooked = simulateBattedBall({
    exitVelocity: 170 / 3.6, launchAngle: 26, sprayAngle: 0,
    backspinRpm: 2300, sidespinRpm: -849, contactHeight: 0.9144,
  });
  assert.equal(straight.landing.x, 0);
  assert.ok(hooked.landing.x < -0.5,
    `expected a hook toward -x (left field), got x=${hooked.landing.x.toFixed(2)}`);
});

test('the ball never goes below ground and never returns NaN', () => {
  for (const deg of [2, 10, 25, 48]) {
    for (const kmh of [80, 130, 195]) {
      const r = simulateBattedBall({
        exitVelocity: kmh / 3.6, launchAngle: deg, sprayAngle: -30,
        backspinRpm: 1500, sidespinRpm: -600, contactHeight: 1.0,
      });
      assert.ok(Number.isFinite(r.distance) && r.distance >= 0, `bad distance for ${kmh}/${deg}`);
      assert.ok(Number.isFinite(r.hangTime) && r.hangTime > 0, `bad hang time for ${kmh}/${deg}`);
      for (const p of r.trail) {
        assert.ok(p.y >= -1e-6, `trail dipped below ground: y=${p.y}`);
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
      }
    }
  }
});

test('a straight-up pop-up lands essentially where it started', () => {
  const r = simulateBattedBall({
    exitVelocity: 30, launchAngle: 89, sprayAngle: 0,
    backspinRpm: 600, sidespinRpm: 0, contactHeight: 1.0,
  });
  assert.ok(r.distance < 12, `pop-up travelled ${r.distance.toFixed(1)} m`);
  assert.ok(r.apex > 20, `pop-up apex only ${r.apex.toFixed(1)} m`);
});

test('the integrator is deterministic and step size is fixed', () => {
  const args = {
    exitVelocity: 45, launchAngle: 27, sprayAngle: -12,
    backspinRpm: 2300, sidespinRpm: -700, contactHeight: 0.95,
  } as const;
  const a = simulateBattedBall(args);
  const b = simulateBattedBall(args);
  assert.equal(a.distance, b.distance);
  assert.equal(a.hangTime, b.hangTime);
  assert.equal(a.trail.length, b.trail.length);
  near(DT, 1 / 240, 1e-12, 'integration step');
});

test('spinForContact depends on launch angle only, and clamps', () => {
  // backspin = -763 + 120*theta, with no phi term. See the comment on
  // spinForContact: the published fit's phi term makes a mistimed ball travel
  // FURTHER, which violates PROMPT.md 3-4.
  const mid = spinForContact(24, 0);
  near(mid.backspinRpm, -763 + 120 * 24, 1e-9, 'backspin at 24 deg');
  near(mid.sidespinRpm, -849, 1e-9, 'sidespin at phi=0');

  assert.equal(spinForContact(24, -20).backspinRpm, spinForContact(24, 20).backspinRpm,
    'spray angle must not change backspin');
  assert.equal(spinForContact(24, -20).backspinRpm, mid.backspinRpm);

  // sidespin magnitude grows with |phi|, symmetrically, and is capped so a ball
  // sprayed toward the line does not pick up unmeasurable amounts of spin
  near(spinForContact(24, -10).sidespinRpm, -(849 + 94 * 10), 1e-9, 'sidespin when pulled');
  assert.equal(spinForContact(24, -10).sidespinRpm, spinForContact(24, 10).sidespinRpm);
  assert.ok(Math.abs(spinForContact(24, 30).sidespinRpm) > Math.abs(mid.sidespinRpm));
  assert.equal(spinForContact(24, 45).sidespinRpm, -SIDESPIN_MAX, 'sidespin must cap');

  assert.equal(spinForContact(2, 0).backspinRpm, SPIN_MIN, 'low angle must clamp');
  assert.equal(spinForContact(48, 40).backspinRpm, SPIN_MAX, 'high angle must clamp');
});
