/**
 * The left/right of the world, pinned.
 *
 * This is not a formality. The screen-right basis vector was derived by hand
 * three times during design and got the wrong sign every time, which flipped
 * the whole scene and produced a written spec that put the outfield on the
 * wrong side. These assertions make that impossible to reintroduce silently.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeProjector, BATTING_CAMERA, PITCH_CAMERA, SWING_CAMERA, shakeCamera,
  cameraAfterContact, CUT_SWING_END, CUT_PULLBACK_END,
} from '../src/render/camera.js';
import { vec } from '../src/core/vec.js';
import {
  PLATE_HALF_WIDTH, ZONE_BOTTOM, ZONE_TOP, FENCE_CENTRE, MOUND_DISTANCE, FENCE_HEIGHT,
} from '../src/core/constants.js';

/**
 * Portrait. The game is portrait-only (index.html shows a "turn your phone"
 * card in landscape), so the composition assertions below are portrait too.
 */
const VIEW = { width: 720, height: 1280 } as const;
/** A short 16:9 phone and a tall 20:9 one, for the aspect-independence test. */
const SHORT = { width: 720, height: 1080 } as const;
const TALL = { width: 720, height: 1600 } as const;
const ZONE_MID_Y = (ZONE_BOTTOM + ZONE_TOP) / 2;

test('from behind the catcher, first base is on the right and third on the left', () => {
  const p = makeProjector(
    { eye: vec(0, 1.5, -10), target: vec(0, 1.5, 5), vfov: 40 }, VIEW);
  const first = p.project(vec(10, 0, 0));
  const third = p.project(vec(-10, 0, 0));
  assert.ok(first && third, 'both bases must be in front of the camera');
  assert.ok(first.x > VIEW.width / 2, `first base landed at x=${first.x}, expected right half`);
  assert.ok(third.x < VIEW.width / 2, `third base landed at x=${third.x}, expected left half`);
});

test('up is up', () => {
  const p = makeProjector(
    { eye: vec(0, 1.5, -10), target: vec(0, 1.5, 5), vfov: 40 }, VIEW);
  const high = p.project(vec(0, 5, 5));
  const low = p.project(vec(0, 0, 5));
  assert.ok(high && low);
  assert.ok(high.y < low.y, 'a higher point must have a smaller screen y');
});

test('the batting camera puts the batter left and the outfield right', () => {
  const p = makeProjector(BATTING_CAMERA, VIEW);
  const batter = p.project(vec(-0.75, 1.0, 0));
  const mound = p.project(vec(0, 0.25, MOUND_DISTANCE));
  const centre = p.project(vec(0, 3.6, FENCE_CENTRE));
  assert.ok(batter && mound && centre, 'all three must be in front of the camera');
  assert.ok(batter.x < mound.x, 'the batter must be left of the mound');
  assert.ok(mound.x < centre.x, 'the mound must be left of centre field');
  assert.ok(batter.x < VIEW.width / 2, 'the batter belongs in the left half of frame');
});

test('a pure side-on camera collapses the strike zone — the rejected layout', () => {
  // docs/SPEC.md 2-3. Kept as a regression test: if anyone "fixes" the camera
  // back to a true side view, the cursor stops working and this catches it.
  const sideOn = makeProjector(
    { eye: vec(12, 1.8, 0), target: vec(0, 1.0, 0), vfov: 26 }, VIEW);
  const l = sideOn.project(vec(-PLATE_HALF_WIDTH, ZONE_BOTTOM, 0));
  const r = sideOn.project(vec(PLATE_HALF_WIDTH, ZONE_BOTTOM, 0));
  assert.ok(l && r);
  assert.ok(Math.abs(l.x - r.x) < 1, 'a side-on camera must show the zone edge-on');
});

test('the chosen batting camera keeps the strike zone usable', () => {
  const p = makeProjector(BATTING_CAMERA, VIEW);
  const corners = [
    p.project(vec(-PLATE_HALF_WIDTH, ZONE_BOTTOM, 0)),
    p.project(vec(PLATE_HALF_WIDTH, ZONE_BOTTOM, 0)),
    p.project(vec(PLATE_HALF_WIDTH, ZONE_TOP, 0)),
    p.project(vec(-PLATE_HALF_WIDTH, ZONE_TOP, 0)),
  ];
  assert.ok(corners.every((c) => c !== null));
  const xs = corners.map((c) => c!.x);
  const ys = corners.map((c) => c!.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  assert.ok(w > 55, `zone only ${w.toFixed(0)} px wide — the cursor would be unusable`);
  assert.ok(h > 70, `zone only ${h.toFixed(0)} px tall`);
  // and it must not be sheared into a sliver
  assert.ok(w / h > 0.45, `zone aspect ${(w / h).toFixed(2)} is too squashed`);
});

test('things further away project smaller', () => {
  const p = makeProjector(BATTING_CAMERA, VIEW);
  const near = p.project(vec(0, 1, 0));
  const far = p.project(vec(0, 1, 60));
  assert.ok(near && far);
  assert.ok(p.scaleAt(near.depth) > p.scaleAt(far.depth));
});

test('points behind the camera are rejected rather than mirrored', () => {
  const p = makeProjector(BATTING_CAMERA, VIEW);
  assert.equal(p.project(vec(40, 2, -60)), null);
});

// ---------------------------------------------------------------------------
// the pitch camera — docs/REFERENCE-HB2.md 3, 10
//
// These pin a COMPOSITION, not just a handedness. The whole point of standing
// behind the plate is that the zone sits near the middle of frame and is big
// enough to aim inside; if a later edit drifts the camera, the mechanic quietly
// gets worse and nothing else would notice.
// ---------------------------------------------------------------------------

test('the pitch camera still obeys the handedness rule', () => {
  const p = makeProjector(PITCH_CAMERA, VIEW);
  const first = p.project(vec(6, 0.5, 6));
  const third = p.project(vec(-6, 0.5, 6));
  assert.ok(first && third);
  assert.ok(first.x > third.x, 'first base must be right of third base');
  assert.ok(third.x < VIEW.width / 2 && first.x > VIEW.width / 2);
});

test('the pitch camera puts the strike zone near the middle of frame', () => {
  const p = makeProjector(PITCH_CAMERA, VIEW);
  const c = p.project(vec(0, ZONE_MID_Y, 0));
  assert.ok(c);
  assert.ok(Math.abs(c.x - VIEW.width / 2) < 90,
    `zone centre x is ${c.x.toFixed(0)}, too far from the middle`);
  // deliberately below centre: the pitcher and the sky need the upper half
  assert.ok(c.y > VIEW.height / 2 && c.y < VIEW.height * 0.78,
    `zone centre y is ${c.y.toFixed(0)}, expected the lower-middle band`);
});

test('the pitch camera shows the zone large enough to aim inside', () => {
  const p = makeProjector(PITCH_CAMERA, VIEW);
  const tl = p.project(vec(-PLATE_HALF_WIDTH, ZONE_TOP, 0));
  const br = p.project(vec(PLATE_HALF_WIDTH, ZONE_BOTTOM, 0));
  assert.ok(tl && br);
  const w = br.x - tl.x;
  const h = br.y - tl.y;
  assert.ok(w > 140, `zone only ${w.toFixed(0)} px wide; the side view already gave 69`);
  assert.ok(h > 150, `zone only ${h.toFixed(0)} px tall`);
  // face-on, so it must be close to the real 0.432 x 0.463 m aspect
  const aspect = w / h;
  assert.ok(aspect > 0.8 && aspect < 1.1,
    `zone aspect ${aspect.toFixed(2)} — the zone is no longer seen face-on`);
});

test('the strike zone is the same width on a short phone and a tall one', () => {
  // This is the entire reason Camera.hfov exists. Phones ship at 16:9, 19.5:9
  // and 20:9; if the zone's apparent width tracked the aspect ratio, the same
  // swing would need different precision on different handsets.
  const widthOn = (v: { readonly width: number; readonly height: number }): number => {
    const p = makeProjector(PITCH_CAMERA, v);
    const l = p.project(vec(-PLATE_HALF_WIDTH, ZONE_MID_Y, 0));
    const r = p.project(vec(PLATE_HALF_WIDTH, ZONE_MID_Y, 0));
    assert.ok(l && r);
    return r.x - l.x;
  };
  const a = widthOn(SHORT);
  const b = widthOn(TALL);
  assert.ok(Math.abs(a - b) < 0.5,
    `zone width differs by ${(b - a).toFixed(1)} px between aspect ratios`);
  // and the zone must still be on screen on the short one
  const p = makeProjector(PITCH_CAMERA, SHORT);
  const c = p.project(vec(0, ZONE_MID_Y, 0));
  assert.ok(c && c.y > 0 && c.y < SHORT.height, 'zone fell off a 16:9 screen');
});

test('the pitch camera keeps the pitcher above the zone and in frame', () => {
  const p = makeProjector(PITCH_CAMERA, VIEW);
  const zone = p.project(vec(0, ZONE_MID_Y, 0));
  const head = p.project(vec(0, 2.05, MOUND_DISTANCE));
  const feet = p.project(vec(0, 0.254, MOUND_DISTANCE));
  assert.ok(zone && head && feet);
  assert.ok(head.y > 0 && feet.y < VIEW.height, 'the pitcher must be on screen');
  assert.ok(head.y < zone.y, 'the pitcher must be above the zone');
  assert.ok(feet.y - head.y > 60,
    `pitcher only ${(feet.y - head.y).toFixed(0)} px tall — too small to read the release`);
});

test('the pitch camera still shows centre field, so a home run has somewhere to go', () => {
  const p = makeProjector(PITCH_CAMERA, VIEW);
  const fence = p.project(vec(0, FENCE_HEIGHT, FENCE_CENTRE));
  assert.ok(fence);
  assert.ok(fence.y > 0 && fence.y < VIEW.height, 'the centre-field fence must be in frame');
});

test('the ball grows several times over on its way to the plate', () => {
  const p = makeProjector(PITCH_CAMERA, VIEW);
  const released = p.project(vec(0.35, 1.85, 16.7));
  const arriving = p.project(vec(0, ZONE_MID_Y, 0));
  assert.ok(released && arriving);
  const growth = p.scaleAt(arriving.depth) / p.scaleAt(released.depth);
  assert.ok(growth > 3.5,
    `ball only grows ${growth.toFixed(1)}x — the approach will not read as depth`);
});

// ---------------------------------------------------------------------------
// near-plane clipping
// ---------------------------------------------------------------------------

test('a ground polygon that straddles the eye still covers the lower frame', () => {
  // The follow camera ends up downfield of home plate late in a home run, so
  // the grass polygon — which has a vertex at the plate — has vertices both in
  // front of and behind the eye. Dropping the behind ones reshapes the polygon
  // and the sky shows through the outfield in stripes. This is that regression.
  const p = makeProjector(
    { eye: vec(0, 6, 3.2), target: vec(0, 5, 117), vfov: 46, hfov: 32 }, VIEW);
  const ground = [
    vec(0, 0, 0),        // behind the eye
    vec(-40, 0, 90),
    vec(40, 0, 90),
  ];
  const poly = p.projectPolygon(ground);
  assert.ok(poly, 'the polygon was clipped away entirely');
  assert.ok(poly.length >= 3, `clipping produced only ${poly.length} points`);
  assert.ok(poly.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)),
    'clipping produced a non-finite vertex');
  const bottom = Math.max(...poly.map((q) => q.y));
  assert.ok(bottom >= VIEW.height,
    `the ground stops at y=${bottom.toFixed(0)}; it must run off the bottom edge`);

  // and the naive version really would have been wrong: only two of the three
  // vertices survive a plain project(), which cannot make a polygon at all
  const survivors = ground.map((v) => p.project(v)).filter((s) => s !== null);
  assert.equal(survivors.length, 2, 'the fixture no longer exercises the bug');
});

test('a polygon entirely behind the camera is dropped', () => {
  const p = makeProjector(PITCH_CAMERA, VIEW);
  assert.equal(p.projectPolygon([
    vec(0, 0, -40), vec(1, 0, -40), vec(1, 1, -40),
  ]), null);
});

test('a polygon entirely in front is passed through unchanged', () => {
  const p = makeProjector(PITCH_CAMERA, VIEW);
  const pts = [vec(-4, 0, 30), vec(4, 0, 30), vec(4, 0, 50), vec(-4, 0, 50)];
  const poly = p.projectPolygon(pts);
  assert.ok(poly);
  assert.equal(poly.length, 4);
  pts.forEach((v, i) => {
    const direct = p.project(v);
    assert.ok(direct);
    assert.ok(Math.abs(direct.x - (poly[i]?.x ?? NaN)) < 1e-9);
    assert.ok(Math.abs(direct.y - (poly[i]?.y ?? NaN)) < 1e-9);
  });
});

// ---------------------------------------------------------------------------
// shake and the cut
// ---------------------------------------------------------------------------

test('shake translates the camera and does not rotate it', () => {
  const shaken = shakeCamera(PITCH_CAMERA, { x: 0.1, y: -0.05 });
  const d0 = {
    x: PITCH_CAMERA.target.x - PITCH_CAMERA.eye.x,
    y: PITCH_CAMERA.target.y - PITCH_CAMERA.eye.y,
    z: PITCH_CAMERA.target.z - PITCH_CAMERA.eye.z,
  };
  const d1 = {
    x: shaken.target.x - shaken.eye.x,
    y: shaken.target.y - shaken.eye.y,
    z: shaken.target.z - shaken.eye.z,
  };
  for (const k of ['x', 'y', 'z'] as const) {
    assert.ok(Math.abs(d0[k] - d1[k]) < 1e-12, `view direction changed on ${k}`);
  }
  assert.notEqual(shaken.eye.x, PITCH_CAMERA.eye.x, 'the eye should have moved');
});

test('shake of zero is the identity', () => {
  assert.equal(shakeCamera(PITCH_CAMERA, { x: 0, y: 0 }), PITCH_CAMERA);
});

test('the impact cut holds the side view, then hands over to the follow camera', () => {
  const ball = vec(20, 25, 60);
  assert.equal(cameraAfterContact(0, ball), SWING_CAMERA);
  assert.equal(cameraAfterContact(CUT_SWING_END, ball), SWING_CAMERA);

  const mid = cameraAfterContact((CUT_SWING_END + CUT_PULLBACK_END) / 2, ball);
  assert.notDeepEqual(mid, SWING_CAMERA, 'the pull-back must have started');
  assert.ok(mid.vfov > SWING_CAMERA.vfov, 'the pull-back should widen the view');

  const late = cameraAfterContact(2.0, ball);
  assert.ok(late.target.z > SWING_CAMERA.target.z, 'the late camera must look downfield');
});

test('the cut never leaves the ball behind the camera once it is following', () => {
  // a home run to left, a home run to right, and a towering one to centre
  for (const ball of [vec(-70, 30, 70), vec(70, 30, 70), vec(0, 45, 110)]) {
    for (const t of [0.7, 1.5, 3.0, 5.0]) {
      const p = makeProjector(cameraAfterContact(t, ball), VIEW);
      assert.ok(p.project(ball) !== null,
        `ball ${JSON.stringify(ball)} fell behind the camera at t=${t}`);
    }
  }
});
