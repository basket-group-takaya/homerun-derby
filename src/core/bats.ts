/**
 * Bats: the persistent progression layer. Pure (PROMPT.md 2).
 *
 * Requested by the owner on 令和8年7月30日: points accumulate across rounds, buy
 * bats with them, and bats carry traits — more distance, a bigger meet point, or
 * a points multiplier.
 *
 * Three rules this file is built to respect.
 *
 * 1. PROMPT.md 0-4 fixes the three players' meet / power / trajectory ranks and
 *    forbids editing them. A bat is a MULTIPLIER on top of a rank, never a
 *    replacement for one, so the ranks still mean what they meant.
 *
 * 2. The exit-velocity ceiling (197.8 km/h, the fastest batted ball ever
 *    measured) is a sourced fact, not a dial. A distance bat therefore cannot
 *    simply scale exit velocity: yuki is already at 178 x 1.10 = 195.8, so the
 *    product would clamp, and a clamped exit velocity is identical for a perfect
 *    swing and a mistimed one — which is exactly the monotonicity bug M1 found
 *    and killed. See effectiveMaxExit below for how that is avoided.
 *
 * 3. Every bat is a TRADE, not an upgrade. A bat that is better at everything
 *    turns the shop into a treadmill with one correct answer.
 */

import type { Rank } from './constants.js';
import { EXIT_VELOCITY_MAX, MAX_EXIT_KMH, PASSION_EXIT_BONUS } from './constants.js';

export type BatId = 'wood' | 'ash' | 'maple' | 'carbon' | 'gold' | 'basket';

export type BatSpec = {
  readonly id: BatId;
  readonly name: string;
  readonly note: string;
  /** Cost in banked points. 0 means owned from the start. */
  readonly price: number;
  /** Multiplier on the player's maximum exit velocity. */
  readonly exit: number;
  /** Multiplier on the meet cursor radius. */
  readonly meet: number;
  /** Multiplier on points banked at the end of a round. */
  readonly points: number;
};

/**
 * 【調整可】 Prices and multipliers are game-design dials, not sourced facts.
 *
 * Deliberately small numbers. A 12% exit-velocity bonus is already about 12 m of
 * carry, which is the difference between a fence-scraper and a comfortable home
 * run; anything larger and the bat, not the swing, decides the outcome.
 */
export const BATS: Readonly<Record<BatId, BatSpec>> = {
  wood: {
    id: 'wood', name: 'ノーマルバット', price: 0,
    note: '支給品。何の変哲もない木製バット',
    exit: 1.00, meet: 1.00, points: 1.00,
  },
  ash: {
    id: 'ash', name: 'トネリコの粘り', price: 900,
    note: 'ミートポイントが広い。飛距離は伸びない',
    exit: 1.00, meet: 1.18, points: 1.00,
  },
  maple: {
    id: 'maple', name: 'ハードメイプル', price: 1800,
    note: '飛距離は伸びるが、芯が狭くなる',
    exit: 1.06, meet: 0.92, points: 1.00,
  },
  gold: {
    id: 'gold', name: '黄金のバット', price: 3200,
    note: '獲得ポイントが1.6倍。打球性能は素のまま',
    exit: 1.00, meet: 1.00, points: 1.60,
  },
  carbon: {
    id: 'carbon', name: 'カーボンコンポジット', price: 5200,
    note: '飛距離とミートを両立。ポイントは増えない',
    exit: 1.09, meet: 1.06, points: 1.00,
  },
  basket: {
    id: 'basket', name: 'バスケット・スペシャル', price: 12000,
    note: '全部強い。ただしここまで貯めるのが本番',
    exit: 1.12, meet: 1.12, points: 1.25,
  },
};

export const BAT_IDS: readonly BatId[] = ['wood', 'ash', 'maple', 'gold', 'carbon', 'basket'];

export const DEFAULT_BAT: BatId = 'wood';

export const isBatId = (v: unknown): v is BatId =>
  typeof v === 'string' && (BAT_IDS as readonly string[]).includes(v);

/**
 * The player's ceiling on exit velocity [m/s], with the bat applied.
 *
 * This is the whole trick, and it is worth spelling out. The naive version is
 *
 *     exit = min(V_MIN + (max - V_MIN) * quality * batExit * skill, CEILING)
 *
 * and it is broken. For yuki, max * skill is already 195.8 of a 197.8 ceiling, so
 * a 1.12 bat pushes every decent swing past the ceiling and they all clamp to the
 * same number. Quality stops mattering, mistiming becomes free, and PROMPT.md 3-4
 * monotonicity fails — the identical failure M1 documented.
 *
 * So the bat scales the CEILING-CONSTRAINED MAXIMUM instead. The interval
 * [V_MIN, effectiveMax] is then traversed by quality alone and nothing ever
 * clamps mid-range, so the swing keeps deciding the result. The price is that a
 * distance bat gives yuki almost nothing: he is already at the physical limit of
 * a struck baseball. That is a real design consequence and it is reported rather
 * than hidden — docs/PROGRESS.md star-judgement 12.
 */
export const effectiveMaxExit = (
  power: Rank, bat: BatSpec, hasPassion: boolean,
): number => {
  const base = MAX_EXIT_KMH[power] / 3.6;
  const skill = hasPassion ? PASSION_EXIT_BONUS : 1;
  return Math.min(base * bat.exit, EXIT_VELOCITY_MAX / skill);
};

/** Points banked from a finished round. */
export const bankedPoints = (roundScore: number, bat: BatSpec): number =>
  Math.max(0, Math.round(roundScore * bat.points));

/** How much distance a bat is worth, for the shop copy. Rough, and labelled so. */
export const approximateMetres = (bat: BatSpec): number =>
  Math.round((bat.exit - 1) * 190);
