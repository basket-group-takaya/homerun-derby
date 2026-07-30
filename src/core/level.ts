/**
 * Levels, experience, and the bats they unlock.
 *
 * Requested by the owner on 令和8年7月30日: 「能力は全員同じにして、レベルを
 * 上げていくとアイテムをもらえるように。アイテムはバットで、それを使用すると
 * 飛距離アップや点数アップなど加点する形に」.
 *
 * This replaces buying bats with points. The difference matters: a shop asks
 * "have you saved enough", which a good player answers in one round and a
 * struggling one never answers at all. A level asks "have you played", which
 * everybody answers eventually. Since all three characters now have identical
 * ability, this ladder is the only progression the game has, so it has to reach
 * the last bat in a number of rounds a person will actually play.
 *
 * Pure (PROMPT.md 2): no clock, no storage, no randomness.
 */

import type { BatId } from './bats.js';
import { BATS, BAT_IDS } from './bats.js';

export const MAX_LEVEL = 99;

/**
 * Experience needed to REACH each level, cumulative. 【調整可】
 *
 *     xpToReach(L) = XP_BASE * (L - 1) ^ XP_CURVE
 *
 * The ladder used to be triangular and stop at 30. Ninety-nine levels of
 * triangular growth would need two and a half million experience for the last
 * one — eight hundred rounds — so the curve had to change with the cap.
 *
 * A power curve below 2 keeps the early levels close together, which is the part
 * that matters: at level 1 a player cannot clear the fence at all, so the first
 * few levels have to arrive within the first sitting or nobody sees the second.
 * Level 2 lands at 180 experience, which is one decent round; level 10 at about
 * 6,800; level 99 at about 348,000, by which point a round with a strong pitcher
 * and a points bat is worth twenty thousand or more.
 */
export const XP_BASE = 180;
export const XP_CURVE = 1.65;

export const xpToReach = (level: number): number => {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return Math.round(XP_BASE * Math.pow(l - 1, XP_CURVE));
};

/** The level a given total experience buys. */
export const levelOf = (xp: number): number => {
  const total = Math.max(0, xp);
  if (total < xpToReach(2)) return 1;
  // invert the power curve, then step to be exactly consistent with xpToReach:
  // rounding inside xpToReach means the closed form can land one either side.
  let l = Math.floor(Math.pow(total / XP_BASE, 1 / XP_CURVE)) + 1;
  l = Math.max(1, Math.min(MAX_LEVEL, l));
  while (l < MAX_LEVEL && total >= xpToReach(l + 1)) l++;
  while (l > 1 && total < xpToReach(l)) l--;
  return l;
};

/** Progress through the current level, 0..1. */
export const levelProgress = (xp: number): number => {
  const level = levelOf(xp);
  if (level >= MAX_LEVEL) return 1;
  const from = xpToReach(level);
  const to = xpToReach(level + 1);
  if (to <= from) return 1;
  return Math.max(0, Math.min(1, (xp - from) / (to - from)));
};

/** Experience still needed for the next level, or 0 at the cap. */
export const xpToNext = (xp: number): number => {
  const level = levelOf(xp);
  if (level >= MAX_LEVEL) return 0;
  return Math.max(0, xpToReach(level + 1) - xp);
};

/**
 * Which level hands over which bat.
 *
 * Derived from the bats themselves rather than restated here. It was a second
 * table, and a second table of the same facts is a second table to forget to
 * update. One bat every five levels, 1 to 95, per the owner's brief.
 */
export const BAT_UNLOCK_LEVEL: Readonly<Record<BatId, number>> =
  Object.fromEntries(BAT_IDS.map((id) => [id, BATS[id].level])) as Record<BatId, number>;

/** Every bat unlocked at or below this level. */
export const unlockedBats = (level: number): readonly BatId[] =>
  BAT_IDS.filter((id) => BATS[id].level <= level);

/** The bats granted by crossing from one level to another. Usually none. */
export const batsGained = (before: number, after: number): readonly BatId[] =>
  BAT_IDS.filter((id) => BATS[id].level > before && BATS[id].level <= after);
