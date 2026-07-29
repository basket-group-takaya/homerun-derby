/**
 * Heads-up display, laid out for a portrait phone.
 *
 * The information set is the reference genre's (docs/REFERENCE-HB2.md 3): score,
 * home runs and outs live along the top, and nothing else competes with them.
 * The layout is our own — PROMPT.md 0 forbids copying a commercial game's UI, so
 * this reproduces WHAT is shown, not how that game showed it.
 *
 * Everything is drawn relative to the viewport, so the same code serves a 16:9
 * tablet and a 20:9 phone.
 */

import type { GameState } from '../core/game.js';
import type { Viewport } from './camera.js';
import { PITCH_LABEL } from '../core/pitch.js';
import { PLAYERS, OUTS_PER_ROUND, T_JUST, T_MISS, T_SWING } from '../core/constants.js';
import { GRADE_LABEL, comboMultiplier } from '../core/round.js';

const FONT = '"Segoe UI", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';

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

/** Extra padding at the top so the HUD clears a notch. Set from CSS env(). */
export type Insets = { readonly top: number; readonly bottom: number };

const drawTopBar = (
  ctx: CanvasRenderingContext2D, state: GameState, view: Viewport, insets: Insets,
): void => {
  const pad = view.width * 0.045;
  const top = insets.top + pad * 0.7;
  const round = state.round;

  // score — the biggest thing on screen after the ball
  ctx.textAlign = 'left';
  ctx.font = `600 ${view.width * 0.032}px ${FONT}`;
  ctx.fillStyle = 'rgba(198,216,242,0.85)';
  ctx.fillText('SCORE', pad, top + view.width * 0.035);

  ctx.font = `800 ${view.width * 0.098}px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 10;
  ctx.fillText(String(round.score), pad, top + view.width * 0.125);
  ctx.shadowBlur = 0;

  // home runs, right-aligned
  ctx.textAlign = 'right';
  ctx.font = `600 ${view.width * 0.032}px ${FONT}`;
  ctx.fillStyle = 'rgba(198,216,242,0.85)';
  ctx.fillText('HR', view.width - pad, top + view.width * 0.035);
  ctx.font = `800 ${view.width * 0.078}px ${FONT}`;
  ctx.fillStyle = '#ffd76a';
  ctx.fillText(String(round.homeRuns), view.width - pad, top + view.width * 0.118);

  // outs, as pips: a number is read, pips are seen
  const pipR = view.width * 0.0125;
  const gap = pipR * 2.75;
  const total = OUTS_PER_ROUND;
  const startX = view.width - pad - (total - 1) * gap;
  const pipY = top + view.width * 0.163;
  for (let i = 0; i < total; i++) {
    const used = i < round.outs;
    ctx.beginPath();
    ctx.arc(startX + i * gap, pipY, pipR, 0, Math.PI * 2);
    ctx.fillStyle = used ? '#ff6b6b' : 'rgba(255,255,255,0.20)';
    ctx.fill();
    if (used) {
      ctx.strokeStyle = 'rgba(255,180,180,0.9)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
  ctx.textAlign = 'left';
  ctx.font = `600 ${view.width * 0.028}px ${FONT}`;
  ctx.fillStyle = 'rgba(198,216,242,0.7)';
  ctx.fillText('OUT', startX - view.width * 0.085, pipY + view.width * 0.010);

  // Combo, only while it exists. The multiplier shown is the one the NEXT home
  // run will earn, not the one just banked — PROMPT.md 0-1 starts the bonus at
  // the second consecutive home run, so after one the chip is a promise.
  if (round.streak >= 1) {
    const m = comboMultiplier(round.streak);
    const label = `${round.streak} 連発  次 x${m.toFixed(1)}`;
    ctx.font = `800 ${view.width * 0.040}px ${FONT}`;
    const w = ctx.measureText(label).width + pad;
    const y = top + view.width * 0.195;
    ctx.fillStyle = 'rgba(255,150,60,0.22)';
    roundRect(ctx, pad, y, w, view.width * 0.062, view.width * 0.031);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,180,90,0.75)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffc06a';
    ctx.fillText(label, pad + pad * 0.5, y + view.width * 0.045);
  }
};

/**
 * The pitch chip: type, and the bonus multiplier if this ball carries one.
 *
 * Sits low, just above the timing bar. It used to sit under the score, where it
 * landed on top of the pitcher and the outfield wall's distance marking — and
 * where it competed with the ball for the eye at exactly the wrong moment.
 */
const drawPitchChip = (
  ctx: CanvasRenderingContext2D, state: GameState, view: Viewport, insets: Insets,
): void => {
  const pitch = state.pitch;
  // hidden once the swing has resolved: the result card lives in this space
  if (!pitch || state.phase === 'ready' || state.phase === 'result'
    || state.phase === 'roundOver') return;
  const pad = view.width * 0.045;
  const y = view.height - insets.bottom - view.width
    * (pitch.multiplier > 1 ? 0.335 : 0.205);

  ctx.textAlign = 'center';
  const label = PITCH_LABEL[pitch.type];
  ctx.font = `700 ${view.width * 0.038}px ${FONT}`;
  const w = ctx.measureText(label).width + pad * 1.4;
  const h = view.width * 0.062;
  ctx.fillStyle = 'rgba(10,16,28,0.55)';
  roundRect(ctx, view.width / 2 - w / 2, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(224,236,255,0.92)';
  ctx.fillText(label, view.width / 2, y + h * 0.68);

  if (pitch.multiplier > 1) {
    const bonus = `SCORE x${pitch.multiplier}`;
    ctx.font = `800 ${view.width * 0.046}px ${FONT}`;
    const bw = ctx.measureText(bonus).width + pad * 1.6;
    const by = y + h + view.width * 0.022;
    const grad = ctx.createLinearGradient(0, by, 0, by + h);
    grad.addColorStop(0, pitch.multiplier === 3 ? '#ff7a3d' : '#ffb648');
    grad.addColorStop(1, pitch.multiplier === 3 ? '#d63a2a' : '#e08a1e');
    ctx.fillStyle = grad;
    roundRect(ctx, view.width / 2 - bw / 2, by, bw, h, h / 2);
    ctx.fill();
    ctx.fillStyle = '#fff8e6';
    ctx.fillText(bonus, view.width / 2, by + h * 0.70);
  }
  ctx.textAlign = 'left';
};

/**
 * Timing bar.
 *
 * Kept from the M2 prototype because it is the only thing that makes the timing
 * window legible while learning. It sits low, where a thumb is not covering it.
 */
const drawTimingBar = (
  ctx: CanvasRenderingContext2D, state: GameState, view: Viewport, insets: Insets,
): void => {
  if (state.phase !== 'pitching' || !state.flight) return;
  const w = view.width * 0.74;
  const x = view.width / 2 - w / 2;
  const y = view.height - insets.bottom - view.width * 0.115;
  const h = view.width * 0.022;

  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();

  const half = w / 2;
  ctx.fillStyle = 'rgba(120,225,255,0.30)';
  roundRect(ctx, x + half * 0.5, y, half, h, h / 2);
  ctx.fill();

  const justW = (w * T_JUST) / T_MISS;
  ctx.fillStyle = 'rgba(255,215,106,0.92)';
  roundRect(ctx, x + half - justW / 2, y, justW, h, h / 2);
  ctx.fill();

  const err = state.time + T_SWING - state.flight.crossTime;
  const px = x + half + (half * err) / T_MISS;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.max(x, Math.min(x + w, px)) - 1.5, y - h * 0.55, 3, h * 2.1);
};

/** Result card, shown between pitches. */
const drawResult = (
  ctx: CanvasRenderingContext2D, state: GameState, view: Viewport, insets: Insets,
): void => {
  const e = state.lastEvent;
  if (!e || (state.phase !== 'result' && state.phase !== 'roundOver')) return;
  if (e.outcome === 'take' && !e.out) return;

  const pad = view.width * 0.045;
  const y = view.height - insets.bottom - view.width * 0.30;
  const w = view.width - pad * 2;
  const h = view.width * 0.155;

  ctx.fillStyle = 'rgba(8,13,23,0.66)';
  roundRect(ctx, pad, y, w, h, view.width * 0.028);
  ctx.fill();

  const gradeColour: Record<string, string> = {
    perfect: '#ffd76a', great: '#8fe3ff', good: '#c9e3ff', weak: '#a8b6cc', miss: '#8d97ab',
  };
  ctx.textAlign = 'left';
  ctx.font = `800 ${view.width * 0.052}px ${FONT}`;
  ctx.fillStyle = gradeColour[e.grade] ?? '#fff';
  ctx.fillText(GRADE_LABEL[e.grade], pad + view.width * 0.035, y + h * 0.44);

  const outcomeLabel: Record<string, string> = {
    homeRun: 'ホームラン', offTheWall: 'フェンス直撃', inPlay: '凡打',
    foul: 'ファウル', whiff: '空振り', take: '見逃し',
  };
  ctx.font = `600 ${view.width * 0.036}px ${FONT}`;
  ctx.fillStyle = 'rgba(220,232,250,0.9)';
  const detail = e.outcome === 'whiff' || e.outcome === 'take'
    ? (outcomeLabel[e.outcome] ?? '')
    : `${outcomeLabel[e.outcome] ?? ''}   ${e.distance.toFixed(1)} m`;
  ctx.fillText(detail, pad + view.width * 0.035, y + h * 0.80);

  if (e.gained > 0) {
    ctx.textAlign = 'right';
    ctx.font = `800 ${view.width * 0.058}px ${FONT}`;
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(`+${e.gained}`, view.width - pad - view.width * 0.035, y + h * 0.62);
  }
  if (e.savedByTenacity) {
    ctx.textAlign = 'right';
    ctx.font = `700 ${view.width * 0.032}px ${FONT}`;
    ctx.fillStyle = '#9fe3a6';
    ctx.fillText('粘り', view.width - pad - view.width * 0.035, y + h * 0.90);
  }
  ctx.textAlign = 'left';
};

const drawRoundOver = (
  ctx: CanvasRenderingContext2D, state: GameState, view: Viewport, best: number,
): void => {
  if (state.phase !== 'roundOver') return;
  const round = state.round;
  ctx.fillStyle = 'rgba(6,10,18,0.82)';
  ctx.fillRect(0, 0, view.width, view.height);

  ctx.textAlign = 'center';
  const cx = view.width / 2;
  let y = view.height * 0.30;

  ctx.font = `800 ${view.width * 0.072}px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('ラウンド終了', cx, y);

  y += view.width * 0.13;
  ctx.font = `600 ${view.width * 0.038}px ${FONT}`;
  ctx.fillStyle = 'rgba(190,210,238,0.85)';
  ctx.fillText('SCORE', cx, y);
  y += view.width * 0.115;
  ctx.font = `800 ${view.width * 0.135}px ${FONT}`;
  ctx.fillStyle = '#ffd76a';
  ctx.fillText(String(round.score), cx, y);

  y += view.width * 0.085;
  ctx.font = `600 ${view.width * 0.040}px ${FONT}`;
  ctx.fillStyle = 'rgba(220,232,250,0.9)';
  ctx.fillText(
    `ホームラン ${round.homeRuns} 本   最長 ${round.longest.toFixed(1)} m`, cx, y);

  if (round.score >= best && best > 0) {
    y += view.width * 0.075;
    ctx.font = `800 ${view.width * 0.046}px ${FONT}`;
    ctx.fillStyle = '#8fe3ff';
    ctx.fillText('★ 自己ベスト更新', cx, y);
  } else if (best > 0) {
    y += view.width * 0.070;
    ctx.font = `600 ${view.width * 0.034}px ${FONT}`;
    ctx.fillStyle = 'rgba(160,180,210,0.85)';
    ctx.fillText(`自己ベスト ${best}`, cx, y);
  }

  y += view.width * 0.13;
  ctx.font = `700 ${view.width * 0.042}px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillText('タップでもう一度', cx, y);
  ctx.textAlign = 'left';
};

const drawPlayerChip = (
  ctx: CanvasRenderingContext2D, state: GameState, view: Viewport, insets: Insets,
): void => {
  const p = PLAYERS[state.player];
  const pad = view.width * 0.045;
  const y = view.height - insets.bottom - view.width * 0.062;
  ctx.font = `700 ${view.width * 0.034}px ${FONT}`;
  ctx.fillStyle = 'rgba(226,238,255,0.75)';
  ctx.fillText(`#${p.number} ${p.roman}`, pad, y);
  ctx.font = `600 ${view.width * 0.028}px ${FONT}`;
  ctx.fillStyle = 'rgba(160,182,214,0.75)';
  ctx.fillText(
    `ミート ${p.meet} / パワー ${p.power} / 弾道 ${p.trajectory}`,
    pad, y + view.width * 0.042);
};

export const drawHud = (
  ctx: CanvasRenderingContext2D,
  state: GameState,
  view: Viewport,
  insets: Insets,
  best: number,
): void => {
  drawTopBar(ctx, state, view, insets);
  drawPitchChip(ctx, state, view, insets);
  drawTimingBar(ctx, state, view, insets);
  drawResult(ctx, state, view, insets);
  drawPlayerChip(ctx, state, view, insets);
  drawRoundOver(ctx, state, view, best);
};
