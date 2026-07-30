/**
 * 3D vector helpers. Pure functions over frozen plain objects.
 *
 * World frame (docs/SPEC.md 1-1): x = toward first base, y = up,
 * z = toward centre field, origin = home plate.
 */
export const vec = (x, y, z) => ({ x, y, z });
export const ZERO = vec(0, 0, 0);
export const add = (a, b) => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a, b) => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a, k) => vec(a.x * k, a.y * k, a.z * k);
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const lengthSq = (a) => dot(a, a);
export const length = (a) => Math.sqrt(dot(a, a));
/** Unit vector. Returns ZERO for a zero-length input rather than NaN. */
export const normalize = (a) => {
    const len = length(a);
    return len < 1e-12 ? ZERO : scale(a, 1 / len);
};
/** a + b*k — the workhorse of the integrator. */
export const addScaled = (a, b, k) => vec(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);
export const isFinite3 = (a) => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
/** Horizontal distance from the origin, ignoring height. Used for carry distance. */
export const horizontalDistance = (a) => Math.hypot(a.x, a.z);
export const degrees = (rad) => (rad * 180) / Math.PI;
export const radians = (deg) => (deg * Math.PI) / 180;
export const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
//# sourceMappingURL=vec.js.map