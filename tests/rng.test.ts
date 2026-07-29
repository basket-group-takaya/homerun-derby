import test from 'node:test';
import assert from 'node:assert/strict';
import { seedRng, nextU32, nextFloat, nextInt, nextBool, pick } from '../src/core/rng.js';
import type { Rng } from '../src/core/rng.js';

const drawMany = (seed: number, n: number): number[] => {
  let r = seedRng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = nextU32(r);
    r = d.rng;
    out.push(d.value);
  }
  return out;
};

test('same seed produces the same sequence', () => {
  assert.deepEqual(drawMany(12345, 500), drawMany(12345, 500));
});

test('different seeds produce different sequences', () => {
  const a = drawMany(1, 200);
  const b = drawMany(2, 200);
  assert.notDeepEqual(a, b);
  // and they should not merely be offset copies of each other
  const overlap = a.filter((v) => b.includes(v)).length;
  assert.ok(overlap < 10, `sequences overlap too much: ${overlap}`);
});

test('drawing never mutates the generator it was given', () => {
  const r = seedRng(99);
  const snapshot: Rng = { s0: r.s0, s1: r.s1, s2: r.s2, s3: r.s3 };
  for (let i = 0; i < 50; i++) nextU32(r);
  assert.deepEqual(r, snapshot);
});

test('values stay in the unsigned 32-bit range', () => {
  for (const v of drawMany(7, 2000)) {
    assert.ok(Number.isInteger(v), `not an integer: ${v}`);
    assert.ok(v >= 0 && v <= 0xffff_ffff, `out of range: ${v}`);
  }
});

test('nextFloat lies in [0, 1) and is roughly uniform', () => {
  let r = seedRng(2024);
  const buckets = new Array<number>(10).fill(0);
  const n = 100_000;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = nextFloat(r);
    r = d.rng;
    assert.ok(d.value >= 0 && d.value < 1, `out of range: ${d.value}`);
    buckets[Math.floor(d.value * 10)] = (buckets[Math.floor(d.value * 10)] ?? 0) + 1;
    sum += d.value;
  }
  assert.ok(Math.abs(sum / n - 0.5) < 0.01, `mean off: ${sum / n}`);
  for (const [i, count] of buckets.entries()) {
    const share = count / n;
    assert.ok(Math.abs(share - 0.1) < 0.01, `bucket ${i} skewed: ${share}`);
  }
});

test('nextInt is uniform and never returns n', () => {
  let r = seedRng(555);
  const n = 6;
  const counts = new Array<number>(n).fill(0);
  const draws = 60_000;
  for (let i = 0; i < draws; i++) {
    const d = nextInt(r, n);
    r = d.rng;
    assert.ok(d.value >= 0 && d.value < n, `out of range: ${d.value}`);
    counts[d.value] = (counts[d.value] ?? 0) + 1;
  }
  for (const [i, c] of counts.entries()) {
    const share = c / draws;
    assert.ok(Math.abs(share - 1 / n) < 0.01, `value ${i} skewed: ${share}`);
  }
});

test('nextInt rejects a non-positive bound', () => {
  assert.throws(() => nextInt(seedRng(1), 0), RangeError);
  assert.throws(() => nextInt(seedRng(1), -3), RangeError);
});

test('nextBool honours its probability', () => {
  let r = seedRng(31337);
  let hits = 0;
  const n = 50_000;
  for (let i = 0; i < n; i++) {
    const d = nextBool(r, 0.8);
    r = d.rng;
    if (d.value) hits++;
  }
  assert.ok(Math.abs(hits / n - 0.8) < 0.01, `ratio off: ${hits / n}`);
});

test('pick covers every element and rejects an empty array', () => {
  let r = seedRng(4242);
  const items = ['straight', 'slider', 'curve', 'fork', 'shoot', 'change'] as const;
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const d = pick(r, items);
    r = d.rng;
    seen.add(d.value);
  }
  assert.equal(seen.size, items.length);
  assert.throws(() => pick(seedRng(1), []), RangeError);
});

test('the generator never falls into the all-zero state', () => {
  let r = seedRng(0);
  for (let i = 0; i < 10_000; i++) {
    assert.ok(r.s0 !== 0 || r.s1 !== 0 || r.s2 !== 0 || r.s3 !== 0, `zero state at ${i}`);
    r = nextU32(r).rng;
  }
});

test('seeding is deterministic across separate calls', () => {
  assert.deepEqual(seedRng(777), seedRng(777));
});
