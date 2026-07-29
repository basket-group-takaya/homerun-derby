/**
 * Persistence. The only module allowed to touch localStorage.
 *
 * PROMPT.md 2 puts this outside src/core, and core never calls it — the game
 * simulates identically whether or not anything was ever saved.
 *
 * Every access is wrapped. In iOS Safari private browsing, READING
 * window.localStorage throws, not just writing to it, and an unguarded read at
 * module scope aborts the whole ES module and leaves a black screen with no
 * explanation. That was the most likely cause of the phone build not opening.
 */

import type { BatId } from './core/bats.js';
import { BAT_IDS, DEFAULT_BAT, isBatId } from './core/bats.js';

const KEY = 'bhrd.save.v1';

export type Save = {
  /** Banked points, spendable in the shop. */
  readonly points: number;
  /** Lifetime total, never spent — used for records. */
  readonly earned: number;
  readonly bats: readonly BatId[];
  readonly equipped: BatId;
  readonly bestScore: number;
  readonly bestDistance: number;
  readonly rounds: number;
  readonly homeRuns: number;
};

export const emptySave = (): Save => ({
  points: 0,
  earned: 0,
  bats: [DEFAULT_BAT],
  equipped: DEFAULT_BAT,
  bestScore: 0,
  bestDistance: 0,
  rounds: 0,
  homeRuns: 0,
});

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;

/**
 * Parse a save, repairing anything that does not fit.
 *
 * Deliberately total: a corrupt or hand-edited save must degrade to a playable
 * state rather than throw, because a throw here means the game will not start
 * and the player has no way to clear it from inside the app.
 */
export const parseSave = (raw: string | null): Save => {
  const base = emptySave();
  if (!raw) return base;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return base; }
  if (typeof parsed !== 'object' || parsed === null) return base;
  const o = parsed as Record<string, unknown>;

  const bats = Array.isArray(o.bats) ? o.bats.filter(isBatId) : [];
  const owned: BatId[] = bats.includes(DEFAULT_BAT) ? [...bats] : [DEFAULT_BAT, ...bats];
  // keep the canonical order, and drop duplicates
  const ordered = BAT_IDS.filter((id) => owned.includes(id));

  const wanted = isBatId(o.equipped) ? o.equipped : DEFAULT_BAT;
  return {
    points: num(o.points),
    earned: num(o.earned, num(o.points)),
    bats: ordered,
    equipped: ordered.includes(wanted) ? wanted : DEFAULT_BAT,
    bestScore: num(o.bestScore),
    bestDistance: num(o.bestDistance),
    rounds: num(o.rounds),
    homeRuns: num(o.homeRuns),
  };
};

export const loadSave = (): Save => {
  try { return parseSave(window.localStorage.getItem(KEY)); } catch { return emptySave(); }
};

export const storeSave = (save: Save): void => {
  try { window.localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* private mode */ }
};

/** Is localStorage usable at all? The title screen says so if it is not. */
export const storageAvailable = (): boolean => {
  try {
    window.localStorage.setItem('bhrd.probe', '1');
    window.localStorage.removeItem('bhrd.probe');
    return true;
  } catch {
    return false;
  }
};
