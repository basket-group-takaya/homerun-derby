/**
 * The twenty bats, one every five levels from 1 to 95. Pure (PROMPT.md 2).
 *
 * Asked for on 令和8年7月30日: 「バットについてもレベル1からレベル99まで作成し、
 * レベル5ずつ段階的に解放していく仕様に」.
 *
 * Three things a bat can carry, and none carries all three well:
 *
 *   exit    the exit-velocity CEILING — 飛距離アップ
 *   timing  how far off the beat a swing may be. This is where the old meet
 *           multiplier went: the swing is one button and the bat always meets
 *           the ball, so a wider cursor would multiply nothing, and timing is
 *           the only thing the player still controls.
 *   points  experience earned at the end of a round — 点数アップ
 *
 * WHY THE LAST BAT'S exit IS 1.14 AND NOT MORE. effectiveMaxExit scales the
 * ceiling, and the ceiling is the real 197.8 km/h record. maxExitKmhFor(100) is
 * 172, and 172 x 1.14 = 196.1 still fits underneath. Push a bat past that and a
 * slightly mistimed swing produces exactly the same exit velocity as a perfect
 * one, because both clamp — and the monotonicity property PROMPT.md 3-4 requires
 * stops holding with nothing on screen to say so. tests/bats.test.ts pins it.
 */

import { maxExitKmhFor } from './ranks.js';
import { EXIT_VELOCITY_MAX } from './constants.js';

export type BatId =
  | 'wood' | 'ash' | 'maple' | 'birch' | 'gold'
  | 'bamboo' | 'aodamo' | 'duralumin' | 'silver' | 'carbon'
  | 'pressed' | 'titanium' | 'platinum' | 'damascus' | 'moonlight'
  | 'meteorite' | 'thunder' | 'dragonbone' | 'kiwami' | 'basket';

export type BatSpec = {
  readonly id: BatId;
  readonly name: string;
  readonly note: string;
  /** Level at which it is handed over. */
  readonly level: number;
  /** Multiplier on the maximum exit velocity: 飛距離アップ. */
  readonly exit: number;
  /** Multiplier on the timing window. */
  readonly timing: number;
  /** Multiplier on experience earned: 点数アップ. */
  readonly points: number;
};

/**
 * 【調整可】 Every number here is a design dial, not a sourced fact.
 *
 * Read down the columns rather than across the rows. At any level you own three
 * or four of these and they lean different ways, so equipping is a choice rather
 * than "take the newest". The ladder does climb — it is a reward for playing —
 * but a bat five levels older can still be the right one for how you swing.
 */
export const BATS: Readonly<Record<BatId, BatSpec>> = {
  wood: {
    id: 'wood', name: 'ノーマルバット', level: 1,
    note: '支給品。何の変哲もない木製バット',
    exit: 1.00, timing: 1.00, points: 1.00,
  },
  ash: {
    id: 'ash', name: 'トネリコの粘り', level: 5,
    note: 'タイミングの許容が広い。飛距離は伸びない',
    exit: 1.00, timing: 1.09, points: 1.00,
  },
  maple: {
    id: 'maple', name: 'ハードメイプル', level: 10,
    note: '飛距離は伸びるが、タイミングはシビアになる',
    exit: 1.03, timing: 0.97, points: 1.00,
  },
  birch: {
    id: 'birch', name: '白樺のしなり', level: 15,
    note: '軽く振れて、少しだけ飛ぶ',
    exit: 1.02, timing: 1.06, points: 1.00,
  },
  gold: {
    id: 'gold', name: '黄金のバット', level: 20,
    note: '経験値1.35倍。打球性能は素のまま',
    exit: 1.00, timing: 1.00, points: 1.35,
  },
  bamboo: {
    id: 'bamboo', name: '竹集成材', level: 25,
    note: '折れない。飛距離とタイミングを少しずつ',
    exit: 1.04, timing: 1.03, points: 1.00,
  },
  aodamo: {
    id: 'aodamo', name: 'アオダモ一本物', level: 30,
    note: '硬い木目。素直に飛ぶ',
    exit: 1.05, timing: 1.01, points: 1.00,
  },
  duralumin: {
    id: 'duralumin', name: '軽量ジュラルミン', level: 35,
    note: '振り遅れが減る。芯は硬くない',
    exit: 1.02, timing: 1.11, points: 1.00,
  },
  silver: {
    id: 'silver', name: '銀のバット', level: 40,
    note: '経験値1.45倍。少しだけ飛ぶ',
    exit: 1.03, timing: 1.02, points: 1.45,
  },
  carbon: {
    id: 'carbon', name: 'カーボンコンポジット', level: 45,
    note: '飛距離とタイミングを両立。経験値は増えない',
    exit: 1.07, timing: 1.04, points: 1.00,
  },
  pressed: {
    id: 'pressed', name: '圧縮バット', level: 50,
    note: '規定外の反発。当たれば飛ぶが、当たらない',
    exit: 1.09, timing: 0.99, points: 1.00,
  },
  titanium: {
    id: 'titanium', name: 'チタンコア', level: 55,
    note: '芯が広く、よく飛ぶ',
    exit: 1.06, timing: 1.08, points: 1.00,
  },
  platinum: {
    id: 'platinum', name: '白金のバット', level: 60,
    note: '経験値1.55倍。打球性能もそこそこ',
    exit: 1.04, timing: 1.04, points: 1.55,
  },
  damascus: {
    id: 'damascus', name: 'ダマスカス鋼', level: 65,
    note: '積層の刃文。飛距離重視',
    exit: 1.10, timing: 1.03, points: 1.05,
  },
  moonlight: {
    id: 'moonlight', name: '月光のバット', level: 70,
    note: '夜の試合でよく見える。バランス型',
    exit: 1.08, timing: 1.10, points: 1.05,
  },
  meteorite: {
    id: 'meteorite', name: '隕鉄バット', level: 75,
    note: '重い。振り切れれば最長',
    exit: 1.12, timing: 1.02, points: 1.05,
  },
  thunder: {
    id: 'thunder', name: '雷紋のバット', level: 80,
    note: 'タイミングが大きく広がる。経験値も少し',
    exit: 1.09, timing: 1.12, points: 1.15,
  },
  dragonbone: {
    id: 'dragonbone', name: '竜骨バット', level: 85,
    note: '飛距離特化。ここまで来たら振るだけ',
    exit: 1.13, timing: 1.05, points: 1.10,
  },
  kiwami: {
    id: 'kiwami', name: '極みの一本', level: 90,
    note: '全部が高い水準。最後の一歩手前',
    exit: 1.11, timing: 1.14, points: 1.15,
  },
  basket: {
    id: 'basket', name: 'バスケット・スペシャル', level: 95,
    note: 'レベル95の到達報酬。これ以上は無い',
    exit: 1.14, timing: 1.14, points: 1.40,
  },
};

export const BAT_IDS: readonly BatId[] =
  (Object.keys(BATS) as BatId[]).sort((a, b) => BATS[a].level - BATS[b].level);

export const DEFAULT_BAT: BatId = 'wood';

export const isBatId = (v: unknown): v is BatId =>
  typeof v === 'string' && (BAT_IDS as readonly string[]).includes(v);

/**
 * The exit-velocity ceiling for a power value, with the bat and any special.
 *
 * The bat scales the CEILING, not the instantaneous value. Scaling the value
 * clamps every well-struck ball at EXIT_VELOCITY_MAX and flattens the difference
 * between a good swing and a perfect one — the bug this signature exists to
 * prevent. Dividing the cap by the special's multiplier keeps the same property
 * once 世界の王's +9% is in play.
 */
export const effectiveMaxExit = (
  power: number, bat: BatSpec, specialExit = 1,
): number => Math.min(
  (maxExitKmhFor(power) / 3.6) * bat.exit,
  EXIT_VELOCITY_MAX / Math.max(1, specialExit),
);

/** Experience banked from a finished round. */
export const bankedPoints = (roundScore: number, bat: BatSpec, extra = 1): number =>
  Math.max(0, Math.round(roundScore * bat.points * extra));

/** How much distance a bat is worth [m], for the shelf copy. Rough, and labelled so. */
export const approximateMetres = (bat: BatSpec): number =>
  Math.round((bat.exit - 1) * 190);
