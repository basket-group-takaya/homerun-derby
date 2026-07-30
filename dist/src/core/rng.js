/**
 * xoshiro128** — a small, fast, well-distributed 32-bit PRNG.
 *
 * docs/SPEC.md 13 / PROMPT.md 2: the core must never call Math.random. The
 * generator state lives in GameState and every draw returns a NEW state, so
 * step(state, cmd) stays a pure function and replays identically from a seed.
 *
 * Reference: https://prng.di.unimi.it/xoshiro128starstar.c
 */
const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
/** splitmix32 — used only to expand a single seed into four non-zero words. */
const splitmix32 = (seed) => {
    let z = (seed + 0x9e3779b9) >>> 0;
    let t = z;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
    return { next: z, value: (t ^ (t >>> 15)) >>> 0 };
};
/** Build a generator from a single integer seed. Never yields the all-zero state. */
export const seedRng = (seed) => {
    let s = seed >>> 0;
    const words = [];
    for (let i = 0; i < 4; i++) {
        const step = splitmix32(s);
        s = step.next;
        words.push(step.value);
    }
    const [a = 1, b = 2, c = 3, d = 4] = words;
    const rng = { s0: a, s1: b, s2: c, s3: d };
    return rng.s0 === 0 && rng.s1 === 0 && rng.s2 === 0 && rng.s3 === 0
        ? { s0: 0x9e3779b9, s1: 0x243f6a88, s2: 0xb7e15162, s3: 0x85a308d3 }
        : rng;
};
/** One 32-bit draw. */
export const nextU32 = (r) => {
    const result = Math.imul(rotl(Math.imul(r.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (r.s1 << 9) >>> 0;
    let s0 = r.s0;
    let s1 = r.s1;
    let s2 = (r.s2 ^ r.s0) >>> 0;
    let s3 = (r.s3 ^ r.s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return { rng: { s0, s1, s2, s3 }, value: result };
};
/** Uniform in [0, 1). 32 bits of resolution. */
export const nextFloat = (r) => {
    const d = nextU32(r);
    return { rng: d.rng, value: d.value / 0x1_0000_0000 };
};
/** Uniform in [lo, hi). */
export const nextRange = (r, lo, hi) => {
    const d = nextFloat(r);
    return { rng: d.rng, value: lo + d.value * (hi - lo) };
};
/**
 * Uniform integer in [0, n). Rejection-sampled so the distribution is exactly
 * flat — modulo alone would bias the low values.
 */
export const nextInt = (r, n) => {
    if (n <= 0)
        throw new RangeError(`nextInt: n must be positive, got ${n}`);
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    let cur = r;
    for (;;) {
        const d = nextU32(cur);
        cur = d.rng;
        if (d.value < limit)
            return { rng: cur, value: d.value % n };
    }
};
/** Uniform choice from a non-empty array. */
export const pick = (r, items) => {
    if (items.length === 0)
        throw new RangeError('pick: empty array');
    const d = nextInt(r, items.length);
    return { rng: d.rng, value: items[d.value] };
};
/** True with probability p. */
export const nextBool = (r, p) => {
    const d = nextFloat(r);
    return { rng: d.rng, value: d.value < p };
};
//# sourceMappingURL=rng.js.map