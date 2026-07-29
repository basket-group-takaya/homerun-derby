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
import { makeProjector, BATTING_CAMERA } from '../src/render/camera.js';
import { vec } from '../src/core/vec.js';
import {
  PLATE_HALF_WIDTH, ZONE_BOTTOM, ZONE_TOP, FENCE_CENTRE, MOUND_DISTANCE,
} from '../src/core/constants.js';

const VIEW = { width: 1280, height: 720 } as const;

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
