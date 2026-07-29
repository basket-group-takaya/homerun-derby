/**
 * 3D vector helpers. Pure functions over frozen plain objects.
 *
 * World frame (docs/SPEC.md 1-1): x = toward first base, y = up,
 * z = toward centre field, origin = home plate.
 */

export type Vec3 = { readonly x: number; readonly y: number; readonly z: number };

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const ZERO: Vec3 = vec(0, 0, 0);

export const add = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);

export const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);

export const scale = (a: Vec3, k: number): Vec3 => vec(a.x * k, a.y * k, a.z * k);

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

export const lengthSq = (a: Vec3): number => dot(a, a);

export const length = (a: Vec3): number => Math.sqrt(dot(a, a));

/** Unit vector. Returns ZERO for a zero-length input rather than NaN. */
export const normalize = (a: Vec3): Vec3 => {
  const len = length(a);
  return len < 1e-12 ? ZERO : scale(a, 1 / len);
};

/** a + b*k — the workhorse of the integrator. */
export const addScaled = (a: Vec3, b: Vec3, k: number): Vec3 =>
  vec(a.x + b.x * k, a.y + b.y * k, a.z + b.z * k);

export const isFinite3 = (a: Vec3): boolean =>
  Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);

/** Horizontal distance from the origin, ignoring height. Used for carry distance. */
export const horizontalDistance = (a: Vec3): number => Math.hypot(a.x, a.z);

export const degrees = (rad: number): number => (rad * 180) / Math.PI;

export const radians = (deg: number): number => (deg * Math.PI) / 180;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;
