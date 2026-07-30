/**
 * Title / player select, and the home-run cut-in.
 *
 * These are the only places the face art is used. PROMPT.md 0-5 is explicit
 * that faces are for cut-ins and the select screen, never for the batter in
 * play — the full-body sprites already do that job.
 *
 * Asset sizes constrain the design and are worth stating, because they are why
 * the layout is what it is (docs/PROGRESS.md ★要判断2):
 *   {id}_bust                       ~340 x 380  — the only art big enough to
 *                                                 fill a card or a cut-in
 *   {id}_front / angle / profile    ~110 x 174
 *   {id}_smile / thinking / ...      ~80 x 137  — thumbnails. Drawn at 64 px or
 *                                                 less, where they are sharp on
 *                                                 a 2x display, and never larger
 */

import type { PlayerId } from '../core/constants.js';
import {
  PLAYERS, PLAYER_IDS, PLAYER_FLAVOUR,
} from '../core/constants.js';
import type { RoundMode } from '../core/round.js';
import type { BatId } from '../core/bats.js';
import type { Save } from '../storage.js';
import { batsFor } from '../storage.js';
import { BAT_UNLOCK_LEVEL, levelOf, levelProgress, xpToNext } from '../core/level.js';
import { abilityAt, SPECIAL_IDS, SPECIAL_LEVEL, SPECIAL_NAME, SPECIAL_TIER } from '../core/ability.js';
import { rankOf } from '../core/ranks.js';
import type { PitcherId, PitcherSpec } from '../core/pitchers.js';
import { PITCHERS, PITCHER_IDS, speedFactor } from '../core/pitchers.js';
import { BATS, BAT_IDS } from '../core/bats.js';
import type { Viewport } from './camera.js';

const FONT = '"Segoe UI", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';

export type Faces = Partial<Record<string, HTMLImageElement>>;

export type Insets = { readonly top: number; readonly bottom: number };

const roundRect = (
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const ready = (img: HTMLImageElement | undefined): img is HTMLImageElement =>
  img !== undefined && img.complete && img.naturalWidth > 0;

/** Draw an image cropped to fill a box, like CSS object-fit: cover. */
const drawCover = (
  ctx: CanvasRenderingContext2D, img: HTMLImageElement,
  x: number, y: number, w: number, h: number, focusY = 0.42,
): void => {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = Math.max(0, Math.min(img.naturalHeight - sh,
    img.naturalHeight * focusY - sh / 2));
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
};

// ---------------------------------------------------------------------------
// title and player select
// ---------------------------------------------------------------------------

export type CardBox = {
  readonly player: PlayerId;
  readonly x: number; readonly y: number;
  readonly w: number; readonly h: number;
};

/** Where the three cards sit. main.ts hit-tests taps against this. */
export const cardBoxes = (view: Viewport, insets: Insets): readonly CardBox[] => {
  const pad = view.width * 0.045;
  const top = insets.top + view.height * 0.258;
  const bottom = view.height - insets.bottom - view.width * 0.395;
  const gap = view.width * 0.028;
  const h = (bottom - top - gap * 2) / 3;
  return PLAYER_IDS.map((player, i) => ({
    player, x: pad, y: top + i * (h + gap), w: view.width - pad * 2, h,
  }));
};

/**
 * The sound toggle, top-right of the title screen.
 *
 * Only on the title screen: an always-visible mute button on the playing HUD is
 * one more thing between a thumb and the swing, and this is a game you play in
 * short rounds and come back to the title between.
 */
export const soundBox = (view: Viewport, insets: Insets): {
  x: number; y: number; w: number; h: number;
} => {
  const w = view.width * 0.20;
  const h = view.width * 0.085;
  return { x: view.width - w - view.width * 0.045, y: insets.top + view.width * 0.030, w, h };
};

/**
 * The four opponents, in a row above the mode toggle.
 *
 * On the select screen rather than behind a menu, because who you face changes
 * both the difficulty and the pay — 「相手が強いとポイントを稼ぎやすくて
 * レベルが上がりやすい」 — so it is a decision taken at the same moment as
 * choosing a batter, not a setting.
 */
export const pitcherBoxes = (view: Viewport, insets: Insets): readonly {
  pitcher: PitcherId; x: number; y: number; w: number; h: number;
}[] => {
  const pad = view.width * 0.045;
  const gap = view.width * 0.018;
  const h = view.width * 0.135;
  const total = view.width - pad * 2;
  const w = (total - gap * (PITCHER_IDS.length - 1)) / PITCHER_IDS.length;
  const y = view.height - insets.bottom - view.width * 0.345;
  return PITCHER_IDS.map((pitcher, i) => ({
    pitcher, x: pad + i * (w + gap), y, w, h,
  }));
};

/** The mode toggle at the foot of the select screen. */
export const modeBox = (view: Viewport, insets: Insets): {
  x: number; y: number; w: number; h: number;
} => {
  const w = view.width * 0.62;
  const h = view.width * 0.105;
  return {
    x: view.width / 2 - w / 2,
    y: view.height - insets.bottom - view.width * 0.165,
    w, h,
  };
};

const RANK_COLOUR: Record<string, string> = {
  S: '#ff8a5c', A: '#ffc45c', B: '#8fe3ff', C: '#9fd6a8', D: '#a8b6cc', E: '#8d97ab',
};

/**
 * Break a string to fit a width, measuring as it goes.
 *
 * Japanese has no spaces, so the usual word-splitting wrap does nothing and the
 * text simply runs off the card — which is exactly what the first version did.
 * This breaks per character, which is correct for Japanese and acceptable for
 * the short ASCII fragments that appear alongside it.
 */
const wrap = (
  ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number,
): string[] => {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line !== '') {
      lines.push(line);
      if (lines.length === maxLines) {
        // ran out of room: mark the truncation rather than cutting silently
        const last = lines[maxLines - 1] ?? '';
        lines[maxLines - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`;
        return lines;
      }
      line = ch;
    } else {
      line = next;
    }
  }
  if (line !== '') lines.push(line);
  return lines.slice(0, maxLines);
};

const drawCard = (
  ctx: CanvasRenderingContext2D, box: CardBox, faces: Faces, selected: boolean,
  save: Save,
): void => {
  const p = PLAYERS[box.player];
  const xp = save.players[box.player].xp;
  const level = levelOf(xp);
  const a = abilityAt(box.player, level);
  const r = box.h * 0.13;

  ctx.save();
  roundRect(ctx, box.x, box.y, box.w, box.h, r);
  ctx.fillStyle = selected ? 'rgba(34,52,84,0.92)' : 'rgba(16,24,40,0.78)';
  ctx.fill();
  ctx.strokeStyle = selected ? 'rgba(255,215,106,0.9)' : 'rgba(120,146,186,0.35)';
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.stroke();

  // portrait, clipped into the rounded left end of the card
  const pw = box.h * 0.86;
  ctx.save();
  roundRect(ctx, box.x + 1.5, box.y + 1.5, pw, box.h - 3, r);
  ctx.clip();
  const bust = faces[`${box.player}_bust`];
  if (ready(bust)) drawCover(ctx, bust, box.x, box.y, pw + 2, box.h, 0.36);
  else { ctx.fillStyle = '#20304c'; ctx.fillRect(box.x, box.y, pw, box.h); }
  // fade the portrait into the card so the crop edge does not read as a seam
  const fade = ctx.createLinearGradient(box.x + pw * 0.45, 0, box.x + pw, 0);
  fade.addColorStop(0, 'rgba(16,24,40,0)');
  fade.addColorStop(1, selected ? 'rgba(34,52,84,0.95)' : 'rgba(16,24,40,0.92)');
  ctx.fillStyle = fade;
  ctx.fillRect(box.x, box.y, pw + 2, box.h);
  ctx.restore();

  // Everything from here is clipped to the card. The first version let the
  // skill note and the character note run past the right edge and under the
  // next card, because Japanese does not wrap on spaces.
  roundRect(ctx, box.x, box.y, box.w, box.h, r);
  ctx.clip();

  // Rows are fixed fractions of the card height, not an accumulating cursor.
  // Accumulating meant a two-line skill note pushed the character note off the
  // bottom edge for one player and not the others.
  const tx = box.x + pw * 0.84;
  const textWidth = box.x + box.w - tx - box.h * 0.09;
  const row = (f: number): number => box.y + box.h * f;

  ctx.textAlign = 'left';
  ctx.font = `800 ${box.h * 0.165}px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(p.name, tx, row(0.195));

  ctx.font = `700 ${box.h * 0.095}px ${FONT}`;
  ctx.fillStyle = 'rgba(180,202,232,0.8)';
  ctx.fillText(`#${p.number}  ${p.roman}`, tx, row(0.315));

  ctx.font = `800 ${box.h * 0.115}px ${FONT}`;
  ctx.fillStyle = '#8fe3ff';
  ctx.fillText(`Lv.${level}`, box.x + box.w - box.h * 0.10 - ctx.measureText(`Lv.${level}`).width,
    row(0.195));

  /*
   * Rank AND number, パワプロ style.
   *
   * The owner asked for abilities 「パワプロの数値を基準として」, and the letter
   * on its own cannot carry that: F spans 20 to 39, so two players both showing
   * F can be nineteen points apart, and a level that raises 22 to 31 would look
   * like it changed nothing. The letter is the shape of the ability and the
   * number is the ability.
   */
  const stats: readonly (readonly [string, string, string])[] = [
    ['ミート', rankOf(a.meet), String(a.meet)],
    ['パワー', rankOf(a.power), String(a.power)],
    ['弾道', String(a.trajectory), ''],
  ];
  let rx = tx;
  for (const [label, letter, value] of stats) {
    ctx.font = `600 ${box.h * 0.082}px ${FONT}`;
    ctx.fillStyle = 'rgba(160,182,214,0.85)';
    ctx.fillText(label, rx, row(0.470));
    const lw = ctx.measureText(label).width;
    ctx.font = `800 ${box.h * 0.130}px ${FONT}`;
    ctx.fillStyle = RANK_COLOUR[letter] ?? '#fff';
    ctx.fillText(letter, rx + lw + box.h * 0.030, row(0.478));
    let used = lw + box.h * 0.030 + ctx.measureText(letter).width;
    if (value) {
      ctx.font = `600 ${box.h * 0.080}px ${FONT}`;
      ctx.fillStyle = 'rgba(150,172,204,0.85)';
      ctx.fillText(value, rx + used + box.h * 0.022, row(0.478));
      used += box.h * 0.022 + ctx.measureText(value).width;
    }
    rx += used + box.h * 0.075;
  }

  // the experience bar toward the next level
  const bw = textWidth;
  const by = row(0.560);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(tx, by, bw, box.h * 0.035);
  ctx.fillStyle = 'rgba(143,227,255,0.9)';
  ctx.fillRect(tx, by, bw * levelProgress(xp), box.h * 0.035);

  const owned = a.specials;
  if (owned.length === 0) {
    ctx.font = `500 ${box.h * 0.074}px ${FONT}`;
    ctx.fillStyle = 'rgba(150,172,204,0.8)';
    const next = SPECIAL_IDS.find((id) => SPECIAL_LEVEL[id] > level);
    ctx.fillText(
      next ? `Lv.${SPECIAL_LEVEL[next]} で ${SPECIAL_NAME[next]}` : '特殊能力なし',
      tx, row(0.680));
  } else {
    let sx = tx;
    for (const id of owned) {
      const tier = SPECIAL_TIER[id];
      ctx.font = `800 ${box.h * 0.082}px ${FONT}`;
      const label = SPECIAL_NAME[id];
      const w = ctx.measureText(label).width + box.h * 0.070;
      if (sx + w > box.x + box.w - box.h * 0.08) break;
      roundRect(ctx, sx, row(0.615), w, box.h * 0.105, box.h * 0.030);
      ctx.fillStyle = tier === 'crown'
        ? 'rgba(198,72,72,0.92)'
        : tier === 'gold' ? 'rgba(196,150,44,0.92)' : 'rgba(52,96,168,0.92)';
      ctx.fill();
      ctx.fillStyle = '#fff8e6';
      ctx.fillText(label, sx + box.h * 0.035, row(0.693));
      sx += w + box.h * 0.030;
    }
  }

  // PROMPT.md 0-5 requires the character note on this screen. It only fits on
  // the highlighted card, which is also the only one it is relevant to.
  if (selected) {
    ctx.font = `500 ${box.h * 0.068}px ${FONT}`;
    ctx.fillStyle = 'rgba(150,172,204,0.8)';
    wrap(ctx, PLAYER_FLAVOUR[box.player], textWidth, 2)
      .forEach((line, i) => ctx.fillText(line, tx, row(0.855 + i * 0.080)));
  }
  ctx.restore();
};

export const drawTitle = (
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  insets: Insets,
  faces: Faces,
  selected: PlayerId,
  mode: RoundMode,
  best: number,
  muted: boolean,
  save: Save,
  pitcher: PitcherSpec,
): void => {
  const g = ctx.createLinearGradient(0, 0, 0, view.height);
  g.addColorStop(0, '#070c18');
  g.addColorStop(0.55, '#0e1830');
  g.addColorStop(1, '#060a14');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.width, view.height);

  ctx.textAlign = 'center';
  const cx = view.width / 2;
  ctx.font = `800 ${view.width * 0.088}px ${FONT}`;
  ctx.fillStyle = '#ffd76a';
  ctx.fillText('BASKET', cx, insets.top + view.height * 0.122);
  ctx.font = `800 ${view.width * 0.062}px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('HOME RUN DERBY', cx, insets.top + view.height * 0.162);

  ctx.font = `600 ${view.width * 0.034}px ${FONT}`;
  ctx.fillStyle = 'rgba(160,182,214,0.85)';
  // Lifetime records. The save has carried these since M2 and nothing ever
  // showed them, which makes a hundred rounds of play look like none.
  ctx.fillText(
    save.rounds > 0
      ? `${save.rounds} ラウンド　HR ${save.homeRuns} 本　最長 ${save.bestDistance} m`
      : '選手を選んでください',
    cx, insets.top + view.height * 0.198);
  if (best > 0) {
    ctx.font = `700 ${view.width * 0.030}px ${FONT}`;
    ctx.fillStyle = 'rgba(143,227,255,0.9)';
    ctx.fillText(`自己ベスト ${best.toLocaleString()}`, cx, insets.top + view.height * 0.223);
  }
  ctx.font = `700 ${view.width * 0.032}px ${FONT}`;
  ctx.fillStyle = 'rgba(255,215,106,0.92)';
  ctx.fillText(
    `Lv.${levelOf(save.players[selected].xp)}　　`
    + `バット：${BATS[save.players[selected].bat].name}`,
    cx, insets.top + view.height * 0.248);

  // shop button, top-left
  const shopBtn = shopOpenBox(view, insets);
  roundRect(ctx, shopBtn.x, shopBtn.y, shopBtn.w, shopBtn.h, shopBtn.h / 2);
  ctx.fillStyle = 'rgba(46,64,96,0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,215,106,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = `700 ${shopBtn.h * 0.40}px ${FONT}`;
  ctx.fillStyle = '#ffd76a';
  ctx.fillText('バット', shopBtn.x + shopBtn.w / 2, shopBtn.y + shopBtn.h * 0.63);

  // sound toggle
  const sb = soundBox(view, insets);
  roundRect(ctx, sb.x, sb.y, sb.w, sb.h, sb.h / 2);
  ctx.fillStyle = muted ? 'rgba(24,32,48,0.9)' : 'rgba(46,64,96,0.9)';
  ctx.fill();
  ctx.strokeStyle = muted ? 'rgba(110,128,158,0.4)' : 'rgba(255,215,106,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = `700 ${sb.h * 0.42}px ${FONT}`;
  ctx.fillStyle = muted ? 'rgba(150,166,192,0.85)' : '#ffd76a';
  ctx.fillText(muted ? '🔇 OFF' : '🔊 ON', sb.x + sb.w / 2, sb.y + sb.h * 0.64);

  for (const box of cardBoxes(view, insets)) {
    drawCard(ctx, box, faces, box.player === selected, save);
  }

  // ----- opponents
  const level = levelOf(save.players[selected].xp);
  ctx.textAlign = 'center';
  ctx.font = `600 ${view.width * 0.030}px ${FONT}`;
  ctx.fillStyle = 'rgba(160,182,214,0.85)';
  const pb0 = pitcherBoxes(view, insets)[0];
  if (pb0) ctx.fillText('相手ピッチャー', cx, pb0.y - view.width * 0.022);

  for (const box of pitcherBoxes(view, insets)) {
    const spec = PITCHERS[box.pitcher];
    const locked = spec.level > level;
    const chosen = spec.id === pitcher.id;
    roundRect(ctx, box.x, box.y, box.w, box.h, box.h * 0.18);
    ctx.fillStyle = chosen ? 'rgba(34,52,84,0.95)' : 'rgba(16,24,40,0.75)';
    ctx.fill();
    ctx.strokeStyle = chosen
      ? 'rgba(255,215,106,0.9)'
      : locked ? 'rgba(90,104,130,0.30)' : 'rgba(120,146,186,0.35)';
    ctx.lineWidth = chosen ? 2.5 : 1.4;
    ctx.stroke();

    const dim = locked ? 0.35 : 1;
    ctx.font = `800 ${box.h * 0.24}px ${FONT}`;
    ctx.fillStyle = `rgba(238,246,255,${dim})`;
    ctx.fillText(spec.name, box.x + box.w / 2, box.y + box.h * 0.34);
    if (locked) {
      ctx.font = `700 ${box.h * 0.20}px ${FONT}`;
      ctx.fillStyle = 'rgba(150,166,192,0.7)';
      ctx.fillText(`Lv.${spec.level}`, box.x + box.w / 2, box.y + box.h * 0.64);
    } else {
      ctx.font = `700 ${box.h * 0.185}px ${FONT}`;
      ctx.fillStyle = `rgba(143,227,255,${dim})`;
      ctx.fillText(`EXP x${spec.xp.toFixed(2)}`, box.x + box.w / 2, box.y + box.h * 0.60);
      ctx.font = `600 ${box.h * 0.165}px ${FONT}`;
      ctx.fillStyle = `rgba(160,182,214,${dim * 0.9})`;
      const kmh = Math.round(150 * speedFactor(spec, level));
      ctx.fillText(`${kmh} km/h`, box.x + box.w / 2, box.y + box.h * 0.85);
    }
  }

  // mode toggle
  const m = modeBox(view, insets);
  roundRect(ctx, m.x, m.y, m.w, m.h, m.h / 2);
  ctx.fillStyle = 'rgba(20,30,50,0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,146,186,0.4)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  const half = m.w / 2;
  const activeX = mode === 'classic' ? m.x : m.x + half;
  roundRect(ctx, activeX + 3, m.y + 3, half - 6, m.h - 6, (m.h - 6) / 2);
  ctx.fillStyle = 'rgba(255,215,106,0.90)';
  ctx.fill();
  ctx.font = `800 ${view.width * 0.033}px ${FONT}`;
  ctx.fillStyle = mode === 'classic' ? '#14203a' : 'rgba(200,218,242,0.9)';
  ctx.fillText('CLASSIC', m.x + half / 2, m.y + m.h * 0.64);
  ctx.fillStyle = mode === 'arcade' ? '#14203a' : 'rgba(200,218,242,0.9)';
  ctx.fillText('ARCADE', m.x + half + half / 2, m.y + m.h * 0.64);

  ctx.font = `500 ${view.width * 0.028}px ${FONT}`;
  ctx.fillStyle = 'rgba(140,160,192,0.8)';
  ctx.fillText(
    mode === 'classic' ? 'ホームラン以外は全部アウト。10アウトで終了'
      : 'ホームラン以外の打球にも点が入る。10アウトで終了',
    cx, m.y + m.h + view.width * 0.048);
  ctx.textAlign = 'left';
};

// ---------------------------------------------------------------------------
// cut-in
// ---------------------------------------------------------------------------

export type CutIn = {
  readonly player: PlayerId;
  /** Which face file, e.g. 'bust' or 'smile'. */
  readonly variant: string;
  readonly caption: string;
  readonly colour: string;
  life: number;
  readonly maxLife: number;
};

/**
 * A diagonal band sweeping in from the left with the portrait riding it.
 *
 * Deliberately time-boxed and rare: the cut-in fires on home runs and personal
 * bests only. Firing it on every swing would turn the thing that says "that
 * mattered" into wallpaper — the same reason the shake decays to nothing.
 */
export const drawCutIn = (
  ctx: CanvasRenderingContext2D, view: Viewport, faces: Faces, cut: CutIn,
): void => {
  const f = cut.life / cut.maxLife;
  // in over 12%, hold, out over the last 18%
  const enter = Math.min(1, f / 0.12);
  const exit = f > 0.82 ? (f - 0.82) / 0.18 : 0;
  const ease = (t: number): number => 1 - Math.pow(1 - t, 3);
  const slide = (1 - ease(enter)) * -view.width * 0.9 + ease(exit) * view.width * 1.1;

  // The post-landing screen has four things stacked and they must not collide:
  //   0.28  ホームラン！        (telop)
  //   0.36  +points             (telop)
  //   0.52  this cut-in         (0.215 tall, so it ends at 0.735)
  //   0.77  result card         (drawn by hud.ts)
  const h = view.height * 0.215;
  const y = view.height * 0.520;
  const skew = view.width * 0.10;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(slide - skew, y + h);
  ctx.lineTo(slide + skew, y);
  ctx.lineTo(slide + view.width * 1.2, y);
  ctx.lineTo(slide + view.width * 1.2 - skew * 2, y + h);
  ctx.closePath();
  ctx.clip();

  const band = ctx.createLinearGradient(slide, y, slide + view.width, y + h);
  band.addColorStop(0, 'rgba(10,16,30,0.96)');
  band.addColorStop(0.55, 'rgba(22,36,64,0.92)');
  band.addColorStop(1, `rgba(${cut.colour},0.30)`);
  ctx.fillStyle = band;
  ctx.fillRect(slide - view.width, y - 10, view.width * 2.6, h + 20);

  const img = faces[`${cut.player}_${cut.variant}`];
  if (ready(img)) {
    const pw = h * (img.naturalWidth / img.naturalHeight) * 1.15;
    drawCover(ctx, img, slide + view.width * 0.03, y, pw, h, 0.34);
  }

  ctx.textAlign = 'right';
  ctx.font = `800 ${view.width * 0.072}px ${FONT}`;
  ctx.lineWidth = view.width * 0.012;
  ctx.strokeStyle = 'rgba(6,10,20,0.9)';
  ctx.strokeText(cut.caption, slide + view.width * 0.93, y + h * 0.62);
  ctx.fillStyle = `rgba(${cut.colour},1)`;
  ctx.fillText(cut.caption, slide + view.width * 0.93, y + h * 0.62);
  ctx.textAlign = 'left';
  ctx.restore();

  // bright edges on the band, so it reads as a cut rather than a panel
  ctx.strokeStyle = `rgba(${cut.colour},${0.9 * (1 - exit)})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(slide + skew, y);
  ctx.lineTo(slide + view.width * 1.2, y);
  ctx.moveTo(slide - skew, y + h);
  ctx.lineTo(slide + view.width * 1.2 - skew * 2, y + h);
  ctx.stroke();
};

// ---------------------------------------------------------------------------
// bat shop — owner request, 令和8年7月30日
// ---------------------------------------------------------------------------

export type ShopRow = {
  readonly bat: BatId;
  readonly x: number; readonly y: number;
  readonly w: number; readonly h: number;
};

/** Where the shop rows sit. main.ts hit-tests taps against this. */
/**
 * The bat shelf, at a FIXED row height, scrolled.
 *
 * It used to divide the available height by the number of bats. That was fine
 * for six and unusable for twenty: the rows collapsed to about fourteen pixels
 * and the names, the notes and the level requirements were all illegible. A list
 * that grows has to scroll; it cannot keep shrinking.
 */
export const shopListTop = (view: Viewport, insets: Insets): number =>
  insets.top + view.height * 0.185;

export const shopListBottom = (view: Viewport, insets: Insets): number =>
  view.height - insets.bottom - view.width * 0.165;

const SHOP_ROW_H = 0.155;
const SHOP_GAP = 0.018;

export const shopRows = (
  view: Viewport, insets: Insets, scroll = 0,
): readonly ShopRow[] => {
  const pad = view.width * 0.045;
  const top = shopListTop(view, insets);
  const h = view.width * SHOP_ROW_H;
  const gap = view.width * SHOP_GAP;
  return BAT_IDS.map((bat, i) => ({
    bat, x: pad, y: top + i * (h + gap) - scroll, w: view.width - pad * 2, h,
  }));
};

/** How far the shelf can be dragged before it runs out of bats. */
export const shopScrollMax = (view: Viewport, insets: Insets): number => {
  const h = view.width * SHOP_ROW_H;
  const gap = view.width * SHOP_GAP;
  const content = BAT_IDS.length * h + (BAT_IDS.length - 1) * gap;
  return Math.max(0, content - (shopListBottom(view, insets) - shopListTop(view, insets)));
};

/** The back button at the foot of the shop. */
export const shopBackBox = (view: Viewport, insets: Insets): {
  x: number; y: number; w: number; h: number;
} => {
  const w = view.width * 0.44;
  const h = view.width * 0.105;
  return {
    x: view.width / 2 - w / 2,
    y: view.height - insets.bottom - view.width * 0.125,
    w, h,
  };
};

/** The shop button on the title screen. */
export const shopOpenBox = (view: Viewport, insets: Insets): {
  x: number; y: number; w: number; h: number;
} => {
  const w = view.width * 0.30;
  const h = view.width * 0.085;
  return { x: view.width * 0.045, y: insets.top + view.width * 0.030, w, h };
};

const trait = (
  ctx: CanvasRenderingContext2D, x: number, y: number, size: number,
  label: string, value: number, suffix: string,
): number => {
  const text = value === 1
    ? '—'
    : `${value > 1 ? '+' : ''}${Math.round((value - 1) * 100)}%${suffix}`;
  ctx.font = `600 ${size * 0.78}px ${FONT}`;
  ctx.fillStyle = 'rgba(158,178,208,0.9)';
  ctx.fillText(label, x, y);
  const lw = ctx.measureText(label).width;
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.fillStyle = value > 1 ? '#8fe3ff' : value < 1 ? '#ff9a7a' : 'rgba(140,158,186,0.7)';
  ctx.fillText(text, x + lw + size * 0.35, y);
  return lw + ctx.measureText(text).width + size * 1.15;
};

const drawShopRow = (
  ctx: CanvasRenderingContext2D, row: ShopRow,
  owned: boolean, equipped: boolean, affordable: boolean,
): void => {
  const b = BATS[row.bat];
  const r = row.h * 0.22;

  ctx.save();
  roundRect(ctx, row.x, row.y, row.w, row.h, r);
  ctx.fillStyle = equipped ? 'rgba(38,58,92,0.94)'
    : owned ? 'rgba(20,30,50,0.86)' : 'rgba(14,20,34,0.80)';
  ctx.fill();
  ctx.strokeStyle = equipped ? 'rgba(255,215,106,0.95)'
    : owned ? 'rgba(120,146,186,0.45)'
      : affordable ? 'rgba(143,227,255,0.45)' : 'rgba(80,94,118,0.30)';
  ctx.lineWidth = equipped ? 3 : 1.5;
  ctx.stroke();
  roundRect(ctx, row.x, row.y, row.w, row.h, r);
  ctx.clip();

  const pad = row.h * 0.22;
  ctx.textAlign = 'left';
  ctx.globalAlpha = owned || affordable ? 1 : 0.55;

  ctx.font = `800 ${row.h * 0.255}px ${FONT}`;
  ctx.fillStyle = equipped ? '#ffd76a' : '#ffffff';
  ctx.fillText(b.name, row.x + pad, row.y + row.h * 0.32);

  ctx.font = `500 ${row.h * 0.145}px ${FONT}`;
  ctx.fillStyle = 'rgba(168,188,216,0.85)';
  for (const [i, line] of wrap(ctx, b.note, row.w - pad * 2 - row.w * 0.22, 2).entries()) {
    ctx.fillText(line, row.x + pad, row.y + row.h * (0.53 + i * 0.17));
  }

  // traits
  let tx = row.x + pad;
  const ts = row.h * 0.155;
  tx += trait(ctx, tx, row.y + row.h * 0.90, ts, '飛距離', b.exit, '');
  tx += trait(ctx, tx, row.y + row.h * 0.90, ts, 'タイミング', b.timing, '');
  trait(ctx, tx, row.y + row.h * 0.90, ts, '経験値', b.points, '');

  // status, right-aligned
  ctx.textAlign = 'right';
  const rx = row.x + row.w - pad;
  if (equipped) {
    ctx.font = `800 ${row.h * 0.20}px ${FONT}`;
    ctx.fillStyle = '#ffd76a';
    ctx.fillText('使用中', rx, row.y + row.h * 0.42);
  } else if (owned) {
    ctx.font = `800 ${row.h * 0.20}px ${FONT}`;
    ctx.fillStyle = '#9fe3a6';
    ctx.fillText('タップで装備', rx, row.y + row.h * 0.42);
  } else {
    ctx.font = `800 ${row.h * 0.26}px ${FONT}`;
    ctx.fillStyle = 'rgba(150,166,192,0.85)';
    ctx.fillText(`Lv.${BAT_UNLOCK_LEVEL[b.id]}`, rx, row.y + row.h * 0.38);
    ctx.font = `600 ${row.h * 0.155}px ${FONT}`;
    ctx.fillStyle = 'rgba(150,166,192,0.65)';
    ctx.fillText('レベルで解放', rx, row.y + row.h * 0.60);
  }
  ctx.restore();
  ctx.textAlign = 'left';
};

export const drawShop = (
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  insets: Insets,
  save: Save,
  who: PlayerId,
  notice: string,
  scroll = 0,
): void => {
  const g = ctx.createLinearGradient(0, 0, 0, view.height);
  g.addColorStop(0, '#07101c');
  g.addColorStop(0.6, '#0d1a2e');
  g.addColorStop(1, '#060a14');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.width, view.height);

  ctx.textAlign = 'center';
  ctx.font = `800 ${view.width * 0.062}px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('バット', view.width / 2, insets.top + view.height * 0.070);

  ctx.font = `600 ${view.width * 0.034}px ${FONT}`;
  ctx.fillStyle = 'rgba(160,182,214,0.9)';
  ctx.fillText('レベルで解放されます', view.width / 2, insets.top + view.height * 0.104);
  ctx.font = `800 ${view.width * 0.072}px ${FONT}`;
  ctx.fillStyle = '#ffd76a';
  ctx.fillText(
    `Lv.${levelOf(save.players[who].xp)}　　`
    + `次まで ${xpToNext(save.players[who].xp).toLocaleString()} EXP`,
    view.width / 2, insets.top + view.height * 0.148);

  if (notice) {
    ctx.font = `700 ${view.width * 0.032}px ${FONT}`;
    ctx.fillStyle = '#9fe3a6';
    ctx.fillText(notice, view.width / 2, insets.top + view.height * 0.172);
  }

  // Clip to the list, so a half-scrolled row does not spill over the heading or
  // the back button.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, shopListTop(view, insets), view.width,
    shopListBottom(view, insets) - shopListTop(view, insets));
  ctx.clip();
  const owned = batsFor(save, who);
  for (const row of shopRows(view, insets, scroll)) {
    if (row.y + row.h < shopListTop(view, insets)) continue;
    if (row.y > shopListBottom(view, insets)) continue;
    drawShopRow(ctx, row, owned.includes(row.bat), save.players[who].bat === row.bat, false);
  }
  ctx.restore();

  // a hint that there is more, while there is more
  if (scroll < shopScrollMax(view, insets) - 1) {
    ctx.textAlign = 'center';
    ctx.font = `700 ${view.width * 0.030}px ${FONT}`;
    ctx.fillStyle = 'rgba(160,182,214,0.75)';
    ctx.fillText('▼ 上下にドラッグ', view.width / 2,
      shopListBottom(view, insets) + view.width * 0.040);
  }

  const back = shopBackBox(view, insets);
  roundRect(ctx, back.x, back.y, back.w, back.h, back.h / 2);
  ctx.fillStyle = 'rgba(26,38,60,0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(130,156,196,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.font = `800 ${view.width * 0.036}px ${FONT}`;
  ctx.fillStyle = '#e6eefb';
  ctx.fillText('もどる', back.x + back.w / 2, back.y + back.h * 0.66);
  ctx.textAlign = 'left';
};
