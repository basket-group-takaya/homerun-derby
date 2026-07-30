/**
 * The batter's orientation, which has broken five times and was never asserted.
 *
 * Every previous failure was reported by the owner rather than by a test: facing
 * away from the pitcher, changing batter's box at contact, holding two bats,
 * looking sideways. The camera's handedness has around twenty assertions on it
 * (tests/projection.test.ts) and never broke once; the batter had none.
 *
 * The most expensive one to find was silent: the contact keyframe's local
 * batDir.z had the wrong sign, so the drawn barrel pointed at the pitcher
 * instead of across the plate. The implied spray angle was -63.5 degrees —
 * outside the foul line, unreachable by any batted ball the physics can produce
 * — and the bat missed the ball by 0.51 m at its closest approach. Nothing on
 * screen said so, because a bat that misses still looks like a bat.
 *
 * World axes, restated because every one of those bugs was a sign error:
 *   +x = first base, +y = up, +z = centre field.
 * The batter is right-handed, so he stands at x < 0 and the barrel must come
 * out along +x at contact.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOOKS, STANCE, batWorld, batterPose, batterQuads, chestDirection,
} from '../src/render/batter.js';
import { PITCH_CAMERA } from '../src/render/camera.js';
import { DEFAULT_CONTACT_HEIGHT, FOUL_ANGLE } from '../src/core/constants.js';
import type { Vec3 } from '../src/core/vec.js';
import { vec, sub, dot, normalize, length } from '../src/core/vec.js';

/** Contact is 43% of the way through the sweep: T_SWING 0.13 s of 0.30 s. */
const CONTACT = 0.43;

const SAMPLES = [0, 0.1, 0.18, 0.25, 0.33, 0.43, 0.55, 0.7, 0.85, 1];

/** Shortest distance from a point to a segment. */
const pointToSegment = (p: Vec3, a: Vec3, b: Vec3): number => {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  if (len2 < 1e-12) return length(sub(p, a));
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / len2));
  return length(sub(p, vec(a.x + ab.x * t, a.y + ab.y * t, a.z + ab.z * t)));
};

// ---------------------------------------------------------------------------
// he stays where he is standing
// ---------------------------------------------------------------------------

test('the batter stands on the third-base side of the plate', () => {
  assert.ok(STANCE.x < 0, `STANCE.x is ${STANCE.x}; a right-hander stands at x < 0`);
});

test('nothing about the swing moves him out of his own box', () => {
  // The bug this pins: yawing the figure about the WORLD y axis rather than
  // about his own vertical makes him orbit home plate. At yaw 90 he would be
  // standing where the catcher is. Every part must be yawed locally and then
  // translated, never the other way round.
  for (const t of SAMPLES) {
    const parts = batterQuads(batterPose(t));
    for (const quad of parts.quads) {
      for (const p of quad.pts) {
        // the bat legitimately reaches across the plate; the body does not.
        // 0.42 m is where the barrel starts, so bound the body by the hands.
        if (p.x > 0.02 && Math.abs(p.y - DEFAULT_CONTACT_HEIGHT) > 0.6) {
          assert.fail(`a body point reached x=${p.x.toFixed(3)} at progress ${t}`);
        }
      }
    }
    const feet = parts.quads[0]?.pts[0];
    assert.ok(feet && feet.x < -0.3, `his feet left the box at progress ${t}`);
  }
});

// ---------------------------------------------------------------------------
// the bat goes where the ball is
// ---------------------------------------------------------------------------

test('at contact the barrel actually passes through the ball', () => {
  const bat = batWorld(batterPose(CONTACT));
  const ball = vec(0, DEFAULT_CONTACT_HEIGHT, 0);
  const gap = pointToSegment(ball, bat.barrelStart, bat.tip);
  assert.ok(gap < 0.10,
    `the barrel misses the ball by ${gap.toFixed(3)} m; it was 0.51 m before this test existed`);
});

test('at contact the barrel points across the plate, not at the pitcher', () => {
  const { dir } = batWorld(batterPose(CONTACT));
  assert.ok(dir.x > 0.9,
    `barrel world x is ${dir.x.toFixed(3)}; it must run along +x, toward first base`);
  assert.ok(Math.abs(dir.z) < 0.25,
    `barrel world z is ${dir.z.toFixed(3)}; a large +z means it is pointing downfield`);
});

test('the direction the barrel points implies a fair ball', () => {
  // A batted ball leaves perpendicular to the barrel, so the barrel's azimuth is
  // 90 degrees ahead of the spray angle. If the barrel's implied spray is
  // outside the foul lines, the drawn swing contradicts every hit it produces.
  const { dir } = batWorld(batterPose(CONTACT));
  const barrelAzimuth = Math.atan2(dir.x, dir.z);
  const spray = barrelAzimuth - Math.PI / 2;
  const deg = (spray * 180) / Math.PI;
  const limit = (FOUL_ANGLE * 180) / Math.PI;
  assert.ok(Math.abs(deg) < limit,
    `implied spray ${deg.toFixed(1)} deg is outside the ${limit.toFixed(0)} deg foul lines`);
});

/** The barrel's azimuth, unwrapped so a swing is a monotone decrease. */
const barrelAzimuthDeg = (t: number): number => {
  const { dir } = batWorld(batterPose(t));
  const deg = (Math.atan2(dir.x, dir.z) * 180) / Math.PI;
  return t < CONTACT && deg < 0 ? deg + 360 : deg;
};

test('the bat stays vertical through the load, then sweeps one way and never reverses', () => {
  // Two invariants, because one does not fit the whole swing. The first version
  // of this test asserted a monotone azimuth from progress 0 and failed at 0.1 —
  // correctly, but for the wrong reason: while the bat is near vertical its
  // azimuth is atan2 of two small numbers and means nothing. So the load phase is
  // pinned by "still held up" instead, and monotonicity is asserted from the lag
  // frame on, where the azimuth is real. A reversal there is a bat that visibly
  // snaps backwards mid-swing, which is what a mis-ordered key looks like.
  const LAG = 0.33;
  for (const t of [0, 0.1, 0.18]) {
    const { dir } = batWorld(batterPose(t));
    assert.ok(dir.y > 0.85, `the bat is not up at progress ${t} (y ${dir.y.toFixed(3)})`);
  }

  let previous = Infinity;
  for (const t of SAMPLES.filter((s) => s >= LAG)) {
    const deg = barrelAzimuthDeg(t);
    assert.ok(deg <= previous + 1e-9,
      `the barrel went backwards at progress ${t}: ${deg.toFixed(1)} after ${previous.toFixed(1)}`);
    previous = deg;
  }
  // and it has to actually go somewhere: a swing is not a nudge
  const swept = barrelAzimuthDeg(LAG) - barrelAzimuthDeg(1);
  assert.ok(swept > 250, `the barrel only swept ${swept.toFixed(0)} deg from lag to finish`);
});

test('at rest the bat is up and leaning toward the plate, as the reference has it', () => {
  const { dir, tip, hands } = batWorld(batterPose(0));
  assert.ok(dir.y > 0.85, `rest bat y is ${dir.y.toFixed(3)}; it should be held up`);
  assert.ok(tip.y > hands.y + 0.6, 'the barrel tip should be well above the hands at rest');
  // Screen right is world +x (tests/projection.test.ts), so a positive lean is
  // the reference silhouette: bat up and toward the middle of frame. It leaned
  // the other way first, which read as the bat being on his wrong side.
  assert.ok(tip.x > hands.x + 0.1,
    `the rest barrel leans the wrong way: tip x ${tip.x.toFixed(3)} vs hands ${hands.x.toFixed(3)}`);
  // ...but not so far that it is standing over the plate
  assert.ok(tip.x < -0.35, `the rest barrel reaches the plate (tip x ${tip.x.toFixed(3)})`);
});

test('at contact the barrel is square across the plate', () => {
  const deg = barrelAzimuthDeg(CONTACT);
  assert.ok(Math.abs(deg - 90) < 15,
    `contact azimuth is ${deg.toFixed(1)} deg; 90 deg is square across the plate`);
});

// ---------------------------------------------------------------------------
// we are looking at his back
// ---------------------------------------------------------------------------

test('the pitch camera sees his back, not his side', () => {
  // The owner's complaint, made testable. A face is visible when its outward
  // normal points back toward the eye, so his back is visible when
  // dot(-chest, batter - eye) < 0. Being merely negative is not enough: at
  // 5 degrees off edge-on the back is a sliver and the figure reads as a
  // profile, which is exactly what was reported as "sideways".
  const pose = batterPose(0);
  const back = normalize(vec(-chestDirection(pose).x, 0, -chestDirection(pose).z));
  const ray = normalize(sub(vec(STANCE.x, 1.2, STANCE.z), PITCH_CAMERA.eye));
  const facing = -dot(back, ray);      // 1 = square on to his back
  const offEdgeOnDeg = (Math.asin(Math.max(-1, Math.min(1, facing))) * 180) / Math.PI;
  assert.ok(offEdgeOnDeg > 15,
    `his back is only ${offEdgeOnDeg.toFixed(1)} deg off edge-on; that reads as a side view`);
});

test('he is never showing the camera his chest', () => {
  // Through the whole swing he opens up, so the back only becomes more visible.
  // If any frame flipped to chest-on, something reversed the yaw.
  for (const t of SAMPLES) {
    const chest = chestDirection(batterPose(t));
    const ray = normalize(sub(vec(STANCE.x, 1.2, STANCE.z), PITCH_CAMERA.eye));
    assert.ok(dot(chest, ray) > -0.05,
      `at progress ${t} his chest faces the camera (dot ${dot(chest, ray).toFixed(3)})`);
  }
});

test('his face points at the pitcher, and it is a face rather than hair', () => {
  // This used to check the batting-helmet peak. There is no helmet now — the
  // character art has none — so the tell is the nose, and the test has to check
  // two things the helmet made trivial: that something on his head reaches
  // toward the pitcher at all, and that the thing reaching is SKIN. The first
  // attempt at hair was a shell of radius 0.101 around a head of radius 0.095,
  // which covered his face completely, and nothing said so.
  const parts = batterQuads(batterPose(0));
  let furthest: { readonly p: Vec3; readonly colour: readonly number[] } | null = null;
  for (const quad of parts.quads) {
    for (const p of quad.pts) {
      if (p.y < 1.50 || p.y > 1.78) continue;
      if (!furthest || p.z > furthest.p.z) furthest = { p, colour: quad.colour };
    }
  }
  assert.ok(furthest, 'no head geometry found');
  const found = furthest as { readonly p: Vec3; readonly colour: readonly number[] };
  assert.ok(found.p.z > STANCE.z + 0.09,
    'nothing on his head reaches toward the pitcher; he is not watching the ball');
  const [r, g, b] = found.colour as [number, number, number];
  assert.ok(r > 180 && g > 140 && b > 110 && r > b,
    `the front of his head is rgb(${r},${g},${b}); that is hair over his face, not a face`);
});

test('each player is visibly a different person', () => {
  // 「似て非なるもの」 was the owner's word for the generic figure. Hair colour,
  // glasses and build come off each character's own back.png; if they ever
  // collapse back to one look, the batter stops being anybody.
  const looks = [LOOKS.yuki, LOOKS.takaya, LOOKS.atsushi];
  assert.ok(LOOKS.takaya.glasses, '貴也 wears glasses in the art');
  assert.ok(!LOOKS.yuki.glasses && !LOOKS.atsushi.glasses, 'only 貴也 wears glasses');
  assert.notDeepEqual(LOOKS.atsushi.hair, LOOKS.yuki.hair, '敦司 is the brown-haired one');
  assert.notEqual(LOOKS.yuki.numberFill, LOOKS.takaya.numberFill,
    "勇樹's number is orange and the others' are white");
  const builds = new Set(looks.map((l) => l.build));
  assert.equal(builds.size, 3, 'all three builds should differ');
  // and the difference has to survive into the geometry, not just the table
  // Measured across the JERSEY only. Measuring every quad in the band first
  // returned 0.72 m for all three, because the bat and the hands are in it too
  // and they swamped a 6 cm difference in shoulders.
  const shoulderSpan = (look: typeof LOOKS.yuki): number => {
    let min = Infinity;
    let max = -Infinity;
    for (const quad of batterQuads(batterPose(0), look).quads) {
      const [r, g, b] = quad.colour as [number, number, number];
      const navy = r < 60 && g < 70 && b > 60 && b < 100;
      if (!navy) continue;
      for (const p of quad.pts) {
        if (p.y < 1.36 || p.y > 1.47) continue;
        min = Math.min(min, p.z);
        max = Math.max(max, p.z);
      }
    }
    return max - min;
  };
  assert.ok(shoulderSpan(LOOKS.yuki) > shoulderSpan(LOOKS.atsushi) + 0.05,
    `勇樹 ${shoulderSpan(LOOKS.yuki).toFixed(3)} should be broader than `
    + `敦司 ${shoulderSpan(LOOKS.atsushi).toFixed(3)} across the shoulders`);
});
