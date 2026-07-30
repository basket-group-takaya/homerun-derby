/**
 * Smooth shading: which seams get averaged, and which keep their corner.
 *
 * The interesting failure is not "it looks wrong", it is that the rule is
 * per-edge and easy to apply too widely. Smoothing every seam turns the torso
 * and the bat into pillows; smoothing none leaves the twelve-sided limbs
 * looking like twelve flat strips, which is what the figure looked like before.
 * Both of those pass a "does it render" check, so they are pinned here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { vec, dot, length, sub } from '../src/core/vec.js';
import type { Quad } from '../src/render/figure.js';
import { boxQuads, taperQuads, yawQuads, ROUND_SIDES } from '../src/render/figure.js';

const A = vec(0, 0, 0);
const B = vec(0, 1, 0);
const COLOUR = [200, 100, 50] as const;

/** Side faces only — the two caps are genuinely flat and are excluded. */
const sides = (quads: readonly Quad[], n: number): readonly Quad[] => quads.slice(0, n);

/** Fail loudly rather than letting an absent value silently skip an assertion. */
const must = <T>(v: T | undefined | null, what: string): T => {
  assert.ok(v !== undefined && v !== null, `expected ${what}`);
  return v as T;
};

test('a round limb smooths every seam between its sides', () => {
  const q = taperQuads(A, B, 0.1, 0.1, COLOUR, vec(1, 0, 0), ROUND_SIDES);
  assert.equal(q.length, ROUND_SIDES + 2, 'sides plus two caps');
  for (const face of sides(q, ROUND_SIDES)) {
    assert.ok(face.edge, 'a 30-degree seam must be smoothed');
  }
});

test('the two caps stay flat', () => {
  const q = taperQuads(A, B, 0.1, 0.1, COLOUR, vec(1, 0, 0), ROUND_SIDES);
  assert.equal(q[ROUND_SIDES]?.edge, undefined);
  assert.equal(q[ROUND_SIDES + 1]?.edge, undefined);
});

test('a four-sided solid keeps its corners', () => {
  // The torso and the bat are built this way. A box that gets smoothed reads as
  // a dented pillow, which is a worse artefact than the facet it replaced.
  const q = taperQuads(A, B, 0.1, 0.1, COLOUR, vec(1, 0, 0), 4);
  for (const face of sides(q, 4)) {
    assert.equal(face.edge, undefined, '90-degree seams must not be averaged');
  }
  for (const face of boxQuads(
    { o: A, x: vec(0.1, 0, 0), y: vec(0, 0.1, 0), z: vec(0, 0, 0.1) }, COLOUR,
  )) {
    assert.equal(face.edge, undefined, 'a box is a box');
  }
});

test('edge normals are unit length and bracket the face normal', () => {
  // Each one is the average of this face and a neighbour, so it must sit
  // BETWEEN them: closer to the face than the neighbour is, and never further.
  const q = taperQuads(A, B, 0.1, 0.1, COLOUR, vec(1, 0, 0), ROUND_SIDES);
  for (const face of sides(q, ROUND_SIDES)) {
    for (const e of must(face.edge, 'edge normals')) {
      assert.ok(Math.abs(length(e) - 1) < 1e-9, 'must be normalised');
      const alignment = dot(e, face.normal);
      assert.ok(alignment > 0.9 && alignment < 0.9999,
        `edge normal must lean off the face but stay near it, got ${alignment}`);
    }
  }
});

test('the two edge normals lean opposite ways', () => {
  const q = taperQuads(A, B, 0.1, 0.1, COLOUR, vec(1, 0, 0), ROUND_SIDES);
  const face = must(q[0], 'a side face');
  // If both leaned the same way the gradient would run the wrong direction on
  // one side and the limb would look creased rather than round.
  const [l, r] = must(face.edge, 'edge normals');
  const offL = sub(l, face.normal);
  const offR = sub(r, face.normal);
  assert.ok(dot(offL, offR) < 0, 'the leans must be on opposite sides');
});

test('rotating a figure rotates its edge normals with it', () => {
  // Forgetting this leaves shading that stays pointing the way the limb faced
  // before it moved — invisible while still, obvious the moment it swings.
  const q = taperQuads(A, B, 0.1, 0.1, COLOUR, vec(1, 0, 0), ROUND_SIDES);
  const turned = yawQuads(q, vec(0, 0, 0), Math.PI / 2);
  const before = must(q[0]?.edge?.[0], 'edge normal before');
  const after = must(turned[0]?.edge?.[0], 'edge normal after');
  // yawAbout is x' = x cos - z sin, z' = x sin + z cos, so a quarter turn sends
  // (x, z) to (-z, x). Written out because every orientation bug in this project
  // so far has been a sign, and a test that guesses the sign is worse than none.
  assert.ok(Math.abs(after.x + before.z) < 1e-9 && Math.abs(after.z - before.x) < 1e-9,
    `a quarter turn about y must map (x,z) to (-z,x); got ${after.x},${after.z} `
    + `from ${before.x},${before.z}`);
  assert.ok(Math.abs(after.y - before.y) < 1e-9, 'a yaw must not change height');
  assert.ok(Math.abs(length(after) - 1) < 1e-9, 'still a unit vector');
});
