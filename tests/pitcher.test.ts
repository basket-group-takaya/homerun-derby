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

import { pitcherHand, pitcherQuads, releaseError } from '../src/render/pitcher.js';
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

test('the delivery is continuous — no frame teleports the hand', () => {
  // Linear keys can still jump if two keys share an `at`. At 60 fps a hand
  // moving faster than about 0.35 m per frame reads as a cut, not a throw.
  let previous = pitcherHand(0);
  for (let i = 1; i <= 60; i++) {
    const hand = pitcherHand(i / 60);
    const step = Math.hypot(hand.x - previous.x, hand.y - previous.y, hand.z - previous.z);
    assert.ok(step < 0.35, `the hand jumped ${step.toFixed(3)} m at frame ${i}`);
    previous = hand;
  }
});
