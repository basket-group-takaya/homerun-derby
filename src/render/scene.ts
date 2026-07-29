/**
 * M2 rendering: deliberately plain. Enough of the world to judge whether the
 * timing and cursor mechanic feels good, which is the only thing M2 is for.
 * The real presentation is M4.
 */

import type { Vec3 } from '../core/vec.js';
import { vec, radians } from '../core/vec.js';
import type { GameState } from '../core/game.js';
import { ballAt, battedBallAt, currentCatchRadius } from '../core/game.js';
import type { Projector, Viewport } from './camera.js';
import { PITCH_LABEL } from '../core/pitch.js';
import {
  BALL_RADIUS, FENCE_HEIGHT, FOUL_ANGLE, MOUND_DISTANCE, PLATE_HALF_WIDTH,
  PLAYERS, ZONE_BOTTOM, ZONE_TOP, T_MISS, T_JUST,
} from '../core/constants.js';
import { fenceDistance } from '../core/stadium.js';

export type Sprites = Partial<Record<string, HTMLImageElement>>;

const SKY_TOP = '#1d3f6b';
const SKY_LOW = '#5b86b8';
const GRASS = '#2f6b34';
const GRASS_DARK = '#285c2d';
const DIRT = '#8a6446';

const poly = (
  ctx: CanvasRenderingContext2D, p: Projector, pts: readonly Vec3[],
): boolean => {
  ctx.beginPath();
  let started = false;
  for (const v of pts) {
    const s = p.project(v);
    if (!s) return false;
    if (started) ctx.lineTo(s.x, s.y);
    else { ctx.moveTo(s.x, s.y); started = true; }
  }
  return started;
};

const drawField = (ctx: CanvasRenderingContext2D, p: Projector, view: Viewport): void => {
  const sky = ctx.createLinearGradient(0, 0, 0, view.height);
  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(1, SKY_LOW);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, view.width, view.height);

  // grass: one big wedge of fair territory, drawn as a fan from home plate
  const fan: Vec3[] = [vec(0, 0, 0)];
  for (let a = -FOUL_ANGLE; a <= FOUL_ANGLE; a += 2.5) {
    const d = fenceDistance(a);
    fan.push(vec(d * Math.sin(radians(a)), 0, d * Math.cos(radians(a))));
  }
  ctx.fillStyle = GRASS;
  if (poly(ctx, p, fan)) { ctx.closePath(); ctx.fill(); }

  // mowing stripes, so distance reads without needing a number
  for (let i = -8; i < 8; i += 2) {
    const a0 = (i * FOUL_ANGLE) / 8;
    const a1 = ((i + 1) * FOUL_ANGLE) / 8;
    const seg: Vec3[] = [vec(0, 0, 0)];
    for (let a = a0; a <= a1 + 0.01; a += 1.2) {
      const d = fenceDistance(a);
      seg.push(vec(d * Math.sin(radians(a)), 0, d * Math.cos(radians(a))));
    }
    ctx.fillStyle = GRASS_DARK;
    if (poly(ctx, p, seg)) { ctx.closePath(); ctx.fill(); }
  }

  // infield dirt
  const dirt: Vec3[] = [];
  for (let a = -FOUL_ANGLE; a <= FOUL_ANGLE; a += 3) {
    dirt.push(vec(29 * Math.sin(radians(a)), 0, 29 * Math.cos(radians(a))));
  }
  dirt.push(vec(0, 0, 0));
  ctx.fillStyle = DIRT;
  if (poly(ctx, p, dirt)) { ctx.closePath(); ctx.fill(); }

  // distance rings at 100 / 120 / 140 m
  ctx.lineWidth = 1;
  for (const r of [100, 120, 140]) {
    const ring: Vec3[] = [];
    for (let a = -FOUL_ANGLE; a <= FOUL_ANGLE; a += 2) {
      ring.push(vec(r * Math.sin(radians(a)), 0.02, r * Math.cos(radians(a))));
    }
    ctx.strokeStyle = r === 120 ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.16)';
    if (poly(ctx, p, ring)) ctx.stroke();
  }

  // foul lines
  for (const s of [-1, 1]) {
    const d = fenceDistance(FOUL_ANGLE);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    if (poly(ctx, p, [
      vec(0, 0.02, 0),
      vec(s * d * Math.sin(radians(FOUL_ANGLE)), 0.02, d * Math.cos(radians(FOUL_ANGLE))),
    ])) ctx.stroke();
  }

  // fence
  const top: Vec3[] = [];
  const bottom: Vec3[] = [];
  for (let a = -FOUL_ANGLE; a <= FOUL_ANGLE; a += 1.5) {
    const d = fenceDistance(a);
    const sx = d * Math.sin(radians(a));
    const sz = d * Math.cos(radians(a));
    top.push(vec(sx, FENCE_HEIGHT, sz));
    bottom.push(vec(sx, 0, sz));
  }
  ctx.fillStyle = '#1e3a24';
  if (poly(ctx, p, [...bottom, ...[...top].reverse()])) { ctx.closePath(); ctx.fill(); }
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 2;
  if (poly(ctx, p, top)) ctx.stroke();

  // mound
  const mound: Vec3[] = [];
  for (let a = 0; a < 360; a += 12) {
    mound.push(vec(2.7 * Math.cos(radians(a)), 0.05, MOUND_DISTANCE + 2.7 * Math.sin(radians(a))));
  }
  ctx.fillStyle = DIRT;
  if (poly(ctx, p, mound)) { ctx.closePath(); ctx.fill(); }
};

/** Crude pitcher: a silhouette. docs/SPEC.md 2-4 — there is no pitcher art. */
const drawPitcher = (ctx: CanvasRenderingContext2D, p: Projector): void => {
  const feet = p.project(vec(0, 0.254, MOUND_DISTANCE));
  const head = p.project(vec(0, 2.05, MOUND_DISTANCE));
  if (!feet || !head) return;
  const h = feet.y - head.y;
  const w = h * 0.30;
  ctx.fillStyle = '#16233a';
  ctx.fillRect(feet.x - w / 2, head.y + h * 0.16, w, h * 0.84);
  ctx.beginPath();
  ctx.arc(feet.x, head.y + h * 0.10, h * 0.10, 0, Math.PI * 2);
  ctx.fill();
};

const drawZone = (ctx: CanvasRenderingContext2D, p: Projector): void => {
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  if (poly(ctx, p, [
    vec(-PLATE_HALF_WIDTH, ZONE_BOTTOM, 0), vec(PLATE_HALF_WIDTH, ZONE_BOTTOM, 0),
    vec(PLATE_HALF_WIDTH, ZONE_TOP, 0), vec(-PLATE_HALF_WIDTH, ZONE_TOP, 0),
  ])) { ctx.closePath(); ctx.stroke(); }

  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    const x = -PLATE_HALF_WIDTH + (2 * PLATE_HALF_WIDTH * i) / 3;
    if (poly(ctx, p, [vec(x, ZONE_BOTTOM, 0), vec(x, ZONE_TOP, 0)])) ctx.stroke();
    const y = ZONE_BOTTOM + ((ZONE_TOP - ZONE_BOTTOM) * i) / 3;
    if (poly(ctx, p, [vec(-PLATE_HALF_WIDTH, y, 0), vec(PLATE_HALF_WIDTH, y, 0)])) ctx.stroke();
  }
};

const drawCursor = (ctx: CanvasRenderingContext2D, p: Projector, state: GameState): void => {
  const centre = p.project(vec(state.cursor.x, state.cursor.y, 0));
  const edge = p.project(vec(state.cursor.x + currentCatchRadius(state), state.cursor.y, 0));
  if (!centre || !edge) return;
  const r = Math.abs(edge.x - centre.x);
  ctx.strokeStyle = state.whiffStreak >= 2 && state.player === 'yuki'
    ? 'rgba(255,196,64,0.95)' : 'rgba(120,230,255,0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(centre.x - 1, centre.y - 1, 2, 2);
};

const drawBall = (ctx: CanvasRenderingContext2D, p: Projector, pos: Vec3): void => {
  const s = p.project(pos);
  if (!s) return;
  // shadow first, so height off the ground is readable
  const g = p.project(vec(pos.x, 0.01, pos.z));
  if (g) {
    const gr = Math.max(2, p.scaleAt(g.depth) * BALL_RADIUS * 1.4);
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, gr * 1.5, gr * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const r = Math.max(4, p.scaleAt(s.depth) * BALL_RADIUS);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(20,20,20,0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
};

/** Which swing frame to show, given how long ago the bat met the ball. */
const swingFrame = (elapsed: number): string => {
  if (elapsed < 0) return 'stance';
  const i = Math.min(4, Math.floor(elapsed / 0.055));
  return `swing_${i}`;
};

const drawBatter = (
  ctx: CanvasRenderingContext2D, p: Projector, state: GameState, sprites: Sprites,
): void => {
  const swinging = state.swing !== null;
  const elapsed = swinging ? (state.flightTime ?? 0.3) : -1;
  const key = swinging ? swingFrame(elapsed) : 'stance';
  const img = sprites[key] ?? sprites.stance;
  if (!img || !img.complete || img.naturalWidth === 0) return;

  const feet = p.project(vec(-0.78, 0, -0.15));
  const head = p.project(vec(-0.78, 1.75, -0.15));
  if (!feet || !head) return;
  const h = (feet.y - head.y) * 1.12;
  const w = (h * img.naturalWidth) / img.naturalHeight;
  ctx.drawImage(img, feet.x - w * 0.5, feet.y - h, w, h);
};

const fmt = (n: number, d = 1): string => n.toFixed(d);

const drawHud = (
  ctx: CanvasRenderingContext2D, state: GameState, view: Viewport,
): void => {
  const player = PLAYERS[state.player];
  ctx.font = '600 15px "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(12, 12, 300, 74);
  ctx.fillStyle = '#fff';
  ctx.fillText(`${player.roman}  #${player.number}`, 24, 36);
  ctx.font = '13px "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#cfe0f5';
  ctx.fillText(
    `ミート ${player.meet} / パワー ${player.power} / 弾道 ${player.trajectory}`, 24, 58);
  ctx.fillText(`第 ${state.pitchCount} 球   空振り連続 ${state.whiffStreak}`, 24, 76);

  if (state.pitch && state.phase !== 'ready') {
    ctx.font = '600 15px "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(view.width - 212, 12, 200, 30);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillText(PITCH_LABEL[state.pitch.type], view.width - 200, 33);
  }

  const swing = state.swing;
  if (state.phase === 'result' && swing) {
    const c = swing.contact;
    const lines: string[] = [];
    const label: Record<string, string> = {
      just: 'ジャストミート', good: '芯を捉えた', poor: '凡打',
      jammed: '差し込まれた', reachedOut: '泳いだ', foul: 'ファウル', whiff: '空振り',
    };
    lines.push(label[c.kind] ?? c.kind);
    if (c.kind !== 'whiff') {
      lines.push(`初速 ${fmt(c.exitVelocity * 3.6)} km/h   打ち出し角 ${fmt(c.launchAngle)}°`);
      lines.push(`方向 ${fmt(c.sprayAngle)}°   飛距離 ${fmt(swing.field?.distance ?? 0)} m`);
      const outcome: Record<string, string> = {
        homeRun: 'ホームラン', offTheWall: 'フェンス直撃', inPlay: '凡打', foul: 'ファウル',
      };
      lines.push(outcome[swing.field?.outcome ?? 'inPlay'] ?? '');
      if (swing.titanic) lines.push('★ 特大弾');
    }
    // the after-the-fact stamp: how far off, in units a human can feel
    lines.push(`ミート誤差 ${fmt(c.e * 100)} cm`);
    lines.push(`タイミング ${c.t >= 0 ? '+' : ''}${fmt(c.t * 1000, 0)} ms `
      + `(${c.t >= 0 ? '+' : ''}${fmt(c.t * 60, 1)} フレーム)`);

    const h = 26 + lines.length * 22;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(12, view.height - h - 52, 360, h);
    ctx.fillStyle = '#fff';
    ctx.font = '600 16px "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif';
    lines.forEach((s, i) => {
      ctx.fillStyle = i === 0 ? '#ffd76a' : '#e8eefa';
      ctx.fillText(s, 24, view.height - h - 26 + i * 22);
    });
  }

  ctx.font = '13px "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  const help = state.phase === 'ready' || state.phase === 'result'
    ? 'Enter / 右クリック: 次の投球     1 2 3: 選手変更     マウス: カーソル'
    : 'クリック または Space: スイング';
  ctx.fillText(help, 24, view.height - 22);
};

/** Timing bar: shows the window the swing has to land in. */
const drawTimingBar = (
  ctx: CanvasRenderingContext2D, state: GameState, view: Viewport,
): void => {
  if (state.phase !== 'pitching' || !state.flight) return;
  const w = 360;
  const x = view.width / 2 - w / 2;
  const y = view.height - 46;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, y, w, 12);
  const half = w / 2;
  ctx.fillStyle = 'rgba(120,230,255,0.35)';
  ctx.fillRect(x + half - (half * T_MISS) / T_MISS * 0.5, y, half, 12);
  ctx.fillStyle = 'rgba(255,215,106,0.9)';
  ctx.fillRect(x + half - (half * T_JUST) / T_MISS, y, (2 * half * T_JUST) / T_MISS, 12);
  // marker for where a swing pressed right now would land
  const err = state.time + 0.130 - state.flight.crossTime;
  const px = x + half + (half * err) / T_MISS;
  ctx.fillStyle = '#fff';
  ctx.fillRect(Math.max(x, Math.min(x + w, px)) - 1.5, y - 4, 3, 20);
};

export const drawScene = (
  ctx: CanvasRenderingContext2D,
  p: Projector,
  state: GameState,
  sprites: Sprites,
  view: Viewport,
): void => {
  drawField(ctx, p, view);
  drawPitcher(ctx, p);

  if (state.phase === 'flight' || (state.phase === 'result' && state.swing?.field)) {
    const swing = state.swing;
    if (swing && swing.trail.length > 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      const upTo = state.phase === 'flight'
        ? Math.max(2, Math.round((state.flightTime ?? 0) / swing.hangTime * swing.trail.length))
        : swing.trail.length;
      if (poly(ctx, p, swing.trail.slice(0, upTo))) ctx.stroke();
      drawBall(ctx, p, battedBallAt(swing, state.flightTime ?? swing.hangTime));
    }
  }

  drawBatter(ctx, p, state, sprites);

  if (state.phase === 'pitching' || state.phase === 'ready') {
    drawZone(ctx, p);
    if (state.flight && state.phase === 'pitching') {
      drawBall(ctx, p, ballAt(state.flight, state.time));
    }
    drawCursor(ctx, p, state);
  }

  drawTimingBar(ctx, state, view);
  drawHud(ctx, state, view);
};
