import test from 'node:test';
import assert from 'node:assert/strict';
import {
  vec, add, sub, scale, dot, cross, length, normalize, addScaled,
  horizontalDistance, isFinite3, degrees, radians, clamp, ZERO,
} from '../src/core/vec.js';

const close = (a: number, b: number, eps = 1e-12): void => {
  assert.ok(Math.abs(a - b) < eps, `${a} !~= ${b}`);
};

test('basic arithmetic', () => {
  assert.deepEqual(add(vec(1, 2, 3), vec(4, 5, 6)), vec(5, 7, 9));
  assert.deepEqual(sub(vec(4, 5, 6), vec(1, 2, 3)), vec(3, 3, 3));
  assert.deepEqual(scale(vec(1, -2, 3), 2), vec(2, -4, 6));
  assert.equal(dot(vec(1, 2, 3), vec(4, -5, 6)), 4 - 10 + 18);
});

test('cross product follows the right-hand rule of the world frame', () => {
  // x (first base) cross y (up) = -z, so +z (centre field) is on the third-base
  // side of that pair. This pins the handedness the camera code depends on.
  assert.deepEqual(cross(vec(1, 0, 0), vec(0, 1, 0)), vec(0, 0, 1));
  assert.deepEqual(cross(vec(0, 1, 0), vec(0, 0, 1)), vec(1, 0, 0));
  assert.deepEqual(cross(vec(0, 0, 1), vec(1, 0, 0)), vec(0, 1, 0));
});

test('cross product is perpendicular to both inputs', () => {
  const a = vec(1.5, -2.25, 0.75);
  const b = vec(-0.5, 3, 2);
  const c = cross(a, b);
  close(dot(a, c), 0, 1e-9);
  close(dot(b, c), 0, 1e-9);
});

test('length and normalize', () => {
  close(length(vec(3, 4, 0)), 5);
  close(length(normalize(vec(3, 4, 12))), 1, 1e-12);
});

test('normalize returns zero rather than NaN for a zero vector', () => {
  assert.deepEqual(normalize(ZERO), ZERO);
  assert.ok(isFinite3(normalize(ZERO)));
});

test('addScaled matches add(a, scale(b, k))', () => {
  const a = vec(1, 2, 3);
  const b = vec(-4, 5, -6);
  assert.deepEqual(addScaled(a, b, 0.25), add(a, scale(b, 0.25)));
});

test('horizontalDistance ignores height', () => {
  close(horizontalDistance(vec(3, 999, 4)), 5);
  close(horizontalDistance(vec(0, -12, 0)), 0);
});

test('isFinite3 catches NaN and Infinity', () => {
  assert.ok(isFinite3(vec(1, 2, 3)));
  assert.ok(!isFinite3(vec(NaN, 0, 0)));
  assert.ok(!isFinite3(vec(0, Infinity, 0)));
  assert.ok(!isFinite3(vec(0, 0, -Infinity)));
});

test('angle conversion round-trips', () => {
  for (const deg of [0, 18, 24, 29, 45, 90, -30]) close(degrees(radians(deg)), deg, 1e-12);
});

test('clamp', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});
