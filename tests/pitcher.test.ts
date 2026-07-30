/**
 * The pitcher's delivery, now that he is geometry rather than a silhouette.
 *
 * One of these tests exists because of a bug that shipped: RELEASE_POINT.x was
 * +0.35, a left-hander's release point, while everything else in the game
 * treated him as a right-hander. Nothing detected it, because a silhouette drawn
 * in screen space has no opinion about which arm it is throwing with. Now that
 * the arm is in world space, the drawn hand and the physics release point are
 * two independently written numbers that have to agree, so a disagreement is a
 * test failure rather than something the owner has to notice.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DELIVERY_SECONDS, pitcherHand, pitcherQuads, releaseError,
} from '../src/render/pitcher.js';
import { RELEASE_POINT } from '../src/core/pitch.js';
import { MOUND_DISTANCE } from '../src/core/constants.js';

test('the ball leaves the hand that is drawn throwing it', () => {
  assert.ok(releaseError() < 0.01,
    `the drawn hand is ${releaseError().toFixed(3)} m from RELEASE_POINT`);
});

test('he throws right-handed, which for a pitcher facing home is the -x side', () => {
  // He looks along -z, so his right is cross(up, forward) = (-1, 0, 0): the
  // third-base side. Through the whole arm action the throwing hand stays there.
  for (const t of [0.3, 0.58, 0.72, 0.82]) {
    const hand = pitcherHand(t);
    assert.ok(hand.x < 0,
      `at ${t} the throwing hand is at x=${hand.x.toFixed(3)}; a right-hander's is negative`);
  }
  assert.ok(RELEASE_POINT.x < 0, 'RELEASE_POINT is on the wrong side for a right-hander');
});

test('the arm goes back, then up, then out over the front foot', () => {
  // The old silhouette ended stretched sideways and swung across the body, which
  // the owner reported as a scarecrow. Pinning the shape of the path stops that
  // returning: down and back, above the head, then released out in front.
  const back = pitcherHand(0.30);
  const cocked = pitcherHand(0.58);
  const release = pitcherHand(0.82);
  assert.ok(back.z > cocked.z - 0.5 && back.y < cocked.y,
    'the hand should be low and behind before it is cocked high');
  assert.ok(cocked.y > 1.6, `the cocked hand is only ${cocked.y.toFixed(2)} m up`);
  assert.ok(release.z < cocked.z - 1.0,
    'the release should be well in front of where the arm was cocked');
  assert.ok(release.z < MOUND_DISTANCE - 1.0,
    'he should be releasing more than a metre in front of the rubber');
});

test('he stays on his own mound', () => {
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    for (const quad of pitcherQuads(t)) {
      for (const p of quad.pts) {
        assert.ok(Math.abs(p.x) < 1.2, `he reached x=${p.x.toFixed(2)} at ${t}`);
        assert.ok(p.z > MOUND_DISTANCE - 2.6 && p.z < MOUND_DISTANCE + 1.2,
          `he reached z=${p.z.toFixed(2)} at ${t}`);
        assert.ok(p.y > -0.3 && p.y < 2.6, `he reached y=${p.y.toFixed(2)} at ${t}`);
      }
    }
  }
});

test('the hand moves at a speed a person could move it', () => {
  /*
   * In metres per SECOND, which needs the duration as well as the path — the
   * first version of this test measured metres per sample and could not tell a
   * teleport from a slow-motion replay. It also passed happily while the whole
   * delivery was running in 0.55 s, two and a half times faster than anyone can
   * throw, because per-sample distance does not change when you speed up the
   * clock.
   *
   * A pitched ball leaves at about 40 m/s and the hand is slower than the ball,
   * so anything past 45 m/s is not an arm, it is a cut between two poses.
   */
  const STEPS = 240;
  let previous = pitcherHand(0);
  let fastest = 0;
  for (let i = 1; i <= STEPS; i++) {
    const hand = pitcherHand(i / STEPS);
    const step = Math.hypot(hand.x - previous.x, hand.y - previous.y, hand.z - previous.z);
    const speed = step / (DELIVERY_SECONDS / STEPS);
    fastest = Math.max(fastest, speed);
    assert.ok(speed < 45,
      `the hand reached ${speed.toFixed(0)} m/s at ${(i / STEPS).toFixed(2)} — that is a cut`);
    previous = hand;
  }
  // ...and it has to actually whip somewhere, or it is a man miming a throw
  assert.ok(fastest > 8, `the fastest the hand ever moves is ${fastest.toFixed(1)} m/s`);
});

test('the delivery takes as long as a delivery takes', () => {
  // 0.55 s was the bug the owner saw as 「投げるモーションが明らかにおかしい」.
  // An arm moving too fast to read does not look fast, it looks broken.
  assert.ok(DELIVERY_SECONDS >= 1.0 && DELIVERY_SECONDS <= 1.8,
    `${DELIVERY_SECONDS} s is outside what a real delivery takes`);
});
