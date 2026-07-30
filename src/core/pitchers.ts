/**
 * The opponents you can choose to face.
 *
 * Asked for on 令和8年7月30日: 「相手のピッチャーも選べるようにして、相手が
 * 強いとポイントを稼ぎやすくてレベルが上がりやすい」.
 *
 * This is パワプロ's ホームランアタック trade, moved from the stadium to the
 * pitcher. There, picking a bigger park scores more per home run and makes home
 * runs harder to hit — 「球場が大きいほど高得点だが、弱いチームだと打てない」
 * (altema, read 令和8年7月30日). Same shape here: a faster pitcher is worth more
 * experience and harder to time, so the choice is a real one at every level
 * rather than a difficulty setting you pick once.
 *
 * Pure (PROMPT.md 2).
 */

export type PitcherId = 'rookie' | 'setup' | 'ace' | 'closer';

export type PitcherSpec = {
  readonly id: PitcherId;
  readonly name: string;
  readonly note: string;
  /** Multiplier on every pitch's release speed. */
  readonly speed: number;
  /** Multiplier on experience earned from the round. */
  readonly xp: number;
  /** Level at which this opponent becomes available. */
  readonly level: number;
  /** Shirt number, painted on his back. */
  readonly number: number;
};

/**
 * 【調整可】 speed and xp are the two halves of the same dial and must move
 * together: an opponent who is faster without paying more is a worse choice than
 * the one below him, and nobody would ever pick him.
 *
 * The rookie is DELIBERATELY slow. The owner asked for 「最初はもう少し遅くて
 * 大丈夫」, and at level 1 the batter's power is in the E band, so a fastball at
 * full speed is not a challenge, it is a wall.
 */
export const PITCHERS: Readonly<Record<PitcherId, PitcherSpec>> = {
  rookie: {
    id: 'rookie', name: 'ルーキー', number: 41,
    note: '球は遅い。まずはここでタイミングを覚える',
    speed: 0.78, xp: 1.00, level: 1,
  },
  setup: {
    id: 'setup', name: 'セットアッパー', number: 28,
    note: 'そこそこ速い。経験値1.4倍',
    speed: 0.90, xp: 1.40, level: 8,
  },
  ace: {
    id: 'ace', name: 'エース', number: 18,
    note: '本格派。経験値1.9倍',
    speed: 1.00, xp: 1.90, level: 25,
  },
  closer: {
    id: 'closer', name: '守護神', number: 22,
    note: '手がつけられない速さ。経験値2.6倍',
    speed: 1.12, xp: 2.60, level: 55,
  },
};

export const PITCHER_IDS: readonly PitcherId[] =
  (Object.keys(PITCHERS) as PitcherId[]).sort((a, b) => PITCHERS[a].level - PITCHERS[b].level);

export const DEFAULT_PITCHER: PitcherId = 'rookie';

export const isPitcherId = (v: unknown): v is PitcherId =>
  typeof v === 'string' && (PITCHER_IDS as readonly string[]).includes(v);

export const unlockedPitchers = (level: number): readonly PitcherId[] =>
  PITCHER_IDS.filter((id) => PITCHERS[id].level <= level);

/**
 * How fast this opponent actually throws, at this batter's level. 【調整可】
 *
 *     factor = pitcher.speed * (0.86 + 0.14 * min(1, (level - 1) / 60))
 *
 * Two multipliers rather than one, because they answer different questions. The
 * pitcher's own factor is the CHOICE the player makes and stays constant for the
 * whole round. The level term is the game keeping pace: a level-1 batter facing
 * a rookie sees 100 km/h, and the same rookie at level 61 is throwing 117, so
 * the easy opponent stops being free without ever becoming the hard one.
 *
 * Capped, because 150 x 1.12 x 1.00 = 168 is already at the edge of what a
 * person can time on a phone, and the cap is what stops a tuning change to one
 * of the two multipliers quietly producing an unplayable pitch.
 */
export const SPEED_CAP = 1.15;

export const speedFactor = (pitcher: PitcherSpec, level: number): number => {
  const growth = 0.86 + 0.14 * Math.min(1, Math.max(0, (level - 1) / 60));
  return Math.min(SPEED_CAP, pitcher.speed * growth);
};
