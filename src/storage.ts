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
 *
 * THE SAVE IS PER PLAYER. Each of the three keeps his own experience, his own
 * bat and his own opponent, because abilities now start different and grow —
 * 「パワプロのサクセスのような感じ」 — so choosing 敦司 opens 敦司's save rather
 * than reskinning 貴也's. Records stay global: a best score is a best score.
 */

import type { BatId } from './core/bats.js';
import { BAT_IDS, DEFAULT_BAT, isBatId } from './core/bats.js';
import type { PitcherId } from './core/pitchers.js';
import { DEFAULT_PITCHER, isPitcherId, unlockedPitchers } from './core/pitchers.js';
import type { PlayerId } from './core/constants.js';
import { PLAYER_IDS } from './core/constants.js';
import { levelOf, unlockedBats } from './core/level.js';

const KEY = 'bhrd.save.v1';

/** One character's career. */
export type PlayerSave = {
  /**
   * Lifetime experience. Levels, abilities, bats and opponents all follow it.
   *
   * Nothing subtracts from it. It was a spendable currency when bats were
   * bought; they are handed over by level now, so it only ever grows — which is
   * the point, because a bad round still moves the player forward.
   */
  readonly xp: number;
  readonly bat: BatId;
  readonly pitcher: PitcherId;
};

export type Save = {
  readonly players: Readonly<Record<PlayerId, PlayerSave>>;
  /** Night game or day game. One setting for the whole app, not per player. */
  readonly timeOfDay: 'night' | 'day';
  /** Who was batting when the game was last closed, so it resumes there. */
  readonly last: PlayerId;
  readonly bestScore: number;
  readonly bestDistance: number;
  readonly rounds: number;
  readonly homeRuns: number;
};

const freshPlayer = (): PlayerSave => ({
  xp: 0, bat: DEFAULT_BAT, pitcher: DEFAULT_PITCHER,
});

export const emptySave = (): Save => ({
  players: {
    yuki: freshPlayer(), takaya: freshPlayer(), atsushi: freshPlayer(),
  },
  last: 'takaya',
  timeOfDay: 'night',
  bestScore: 0,
  bestDistance: 0,
  rounds: 0,
  homeRuns: 0,
});

const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;

const isPlayerId = (v: unknown): v is PlayerId =>
  typeof v === 'string' && (PLAYER_IDS as readonly string[]).includes(v);

/**
 * Read one character's slot, repairing anything that does not fit.
 *
 * The bat and the opponent are checked against the LEVEL, not taken on trust.
 * Both are functions of experience, so experience is the truth and the stored
 * ids are a cache: a save written before either existed still resolves, and a
 * hand-edited one cannot equip a bat that has not been earned.
 */
const parsePlayer = (v: unknown): PlayerSave => {
  if (typeof v !== 'object' || v === null) return freshPlayer();
  const o = v as Record<string, unknown>;
  const xp = num(o.xp);
  const level = levelOf(xp);

  const bats = unlockedBats(level);
  const wantedBat = isBatId(o.bat) ? o.bat : DEFAULT_BAT;
  const bat = bats.includes(wantedBat) ? wantedBat : DEFAULT_BAT;

  const pitchers = unlockedPitchers(level);
  const wantedPitcher = isPitcherId(o.pitcher) ? o.pitcher : DEFAULT_PITCHER;
  const pitcher = pitchers.includes(wantedPitcher) ? wantedPitcher : DEFAULT_PITCHER;

  return { xp, bat, pitcher };
};

/**
 * Parse a save, repairing anything that does not fit.
 *
 * Deliberately total: a corrupt or hand-edited save must degrade to a playable
 * state rather than throw, because a throw here means the game will not start
 * and the player has no way to clear it from inside the app.
 *
 * It also reads the OLD single-career shape, where one `points` total and one
 * equipped bat were shared by all three. That total is given to 貴也, who was
 * the default batter — splitting it three ways would invent progress nobody
 * made, and dropping it would throw away somebody's evening.
 */
export const parseSave = (raw: string | null): Save => {
  const base = emptySave();
  if (!raw) return base;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return base; }
  if (typeof parsed !== 'object' || parsed === null) return base;
  const o = parsed as Record<string, unknown>;

  const stored = typeof o.players === 'object' && o.players !== null
    ? o.players as Record<string, unknown>
    : null;

  const legacyXp = num(o.points);
  const legacyBat = isBatId(o.equipped) ? o.equipped : DEFAULT_BAT;

  const players = {
    yuki: parsePlayer(stored?.yuki),
    takaya: stored
      ? parsePlayer(stored.takaya)
      : parsePlayer({ xp: legacyXp, bat: legacyBat, pitcher: DEFAULT_PITCHER }),
    atsushi: parsePlayer(stored?.atsushi),
  };

  return {
    players,
    last: isPlayerId(o.last) ? o.last : base.last,
    timeOfDay: o.timeOfDay === 'day' ? 'day' : 'night',
    bestScore: num(o.bestScore),
    bestDistance: num(o.bestDistance),
    rounds: num(o.rounds),
    homeRuns: num(o.homeRuns),
  };
};

/** Replace one character's slot, leaving the others alone. */
export const withPlayer = (save: Save, id: PlayerId, patch: Partial<PlayerSave>): Save => ({
  ...save,
  players: { ...save.players, [id]: { ...save.players[id], ...patch } },
  last: id,
});

/** Every bat this character has earned. */
export const batsFor = (save: Save, id: PlayerId): readonly BatId[] => {
  const owned = unlockedBats(levelOf(save.players[id].xp));
  return BAT_IDS.filter((b) => owned.includes(b));
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
