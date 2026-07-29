/**
 * Scene composition: what gets drawn, in what order, for each of the three
 * camera beats.
 *
 * docs/REFERENCE-HB2.md 10 (★要判断7, option c) settled the shot list:
 *   'pitch'  — behind the plate. Zone face-on and centred, ball grows at you.
 *   'swing'  — a 0.30 s cut to the side view, where the five swing sprites live.
 *   'flight' — follow the ball.
 * The batter is drawn differently in each: from behind in screen space during
 * the pitch (the sprite is scenery there, not information), from the five swing
 * frames in world space during the cut, and not at all in flight.
 *
 * Reads state, never writes it (PROMPT.md 2).
 */

import type { Vec3 } from '../core/vec.js';
import { vec } from '../core/vec.js';
import type { GameState } from '../core/game.js';
import { ballAt, battedBallAt, currentCatchRadius } from '../core/game.js';
import type { Projector, Viewport } from './camera.js';
import type { StadiumFlags } from './stadium.js';
import { drawStadium, drawPitcher } from './stadium.js';
import {
  BALL_RADIUS, PLATE_HALF_WIDTH, ZONE_BOTTOM, ZONE_TOP,
} from '../core/constants.js';

export type Sprites = Partial<Record<string, HTMLImageElement>>;

export type ViewMode = 'pitch' | 'swing' | 'flight';

export type Presentation = {
  readonly mode: ViewMode;
  /** Seconds since the bat met the ball; null when no swing is in flight. */
  readonly sinceContact: number | null;
  /** 0..1 windup progress for the pitcher silhouette. */
  readonly windup: number;
  /** 0..1, how far through the bat's arc we are during a swing. */
  readonly swingArc: number;
  readonly stadium: StadiumFlags;
  /** Set while the player is on a home-run streak. docs/REFERENCE-HB2.md 9-B5. */
  readonly hot: number;
};

const ZONE_MID_Y = (ZONE_BOTTOM + ZONE_TOP) / 2;

// ---------------------------------------------------------------------------
// ball
// ---------------------------------------------------------------------------

const drawBall = (
  ctx: CanvasRenderingContext2D, p: Projector, pos: Vec3, glow = 0,
): void => {
  const s = p.project(pos);
  if (!s) return;

  const g = p.project(vec(pos.x, 0.01, pos.z));
  if (g && pos.y < 40) {
    const gr = Math.max(1.5, p.scaleAt(g.depth) * BALL_RADIUS * 1.4);
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.08, 0.34 - pos.y * 0.012)})`;
    ctx.beginPath();
    ctx.ellipse(g.x, g.y, gr * 1.6, gr * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const r = Math.max(3, p.scaleAt(s.depth) * BALL_RADIUS);
  if (glow > 0) {
    const halo = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 4.5);
    halo.addColorStop(0, `rgba(255,232,160,${0.55 * glow})`);
    halo.addColorStop(1, 'rgba(255,232,160,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(24,28,38,0.8)';
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.stroke();
  // seam, so spin has something to show on
  if (r > 5) {
    ctx.strokeStyle = 'rgba(200,60,60,0.85)';
    ctx.lineWidth = Math.max(1, r * 0.12);
    ctx.beginPath();
    ctx.arc(s.x - r * 0.25, s.y, r * 0.85, -1.0, 1.0);
    ctx.stroke();
  }
};

/**
 * The last few positions of the pitch, fading out.
 *
 * Without this the ball is a dot that teleports: at 146 km/h it moves 68 cm per
 * frame, and the eye reads discrete jumps as "the game is stuttering" rather
 * than "the ball is fast". The trail is what turns the jump into speed.
 */
const drawPitchTrail = (
  ctx: CanvasRenderingContext2D, p: Projector, state: GameState,
): void => {
  const flight = state.flight;
  if (!flight) return;
  for (let i = 1; i <= 7; i++) {
    const t = state.time - i * (1 / 120);
    if (t <= 0) break;
    const s = p.project(ballAt(flight, t));
    if (!s) continue;
    const f = 1 - i / 8;
    const r = Math.max(1, p.scaleAt(s.depth) * BALL_RADIUS * f);
    ctx.fillStyle = `rgba(255,255,255,${0.30 * f})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
};

// ---------------------------------------------------------------------------
// strike zone and meet cursor
// ---------------------------------------------------------------------------

const zoneQuad = (p: Projector): readonly { x: number; y: number }[] | null => {
  const corners = [
    p.project(vec(-PLATE_HALF_WIDTH, ZONE_TOP, 0)),
    p.project(vec(PLATE_HALF_WIDTH, ZONE_TOP, 0)),
    p.project(vec(PLATE_HALF_WIDTH, ZONE_BOTTOM, 0)),
    p.project(vec(-PLATE_HALF_WIDTH, ZONE_BOTTOM, 0)),
  ];
  if (corners.some((c) => c === null)) return null;
  return corners as { x: number; y: number }[];
};

const drawZone = (ctx: CanvasRenderingContext2D, p: Projector): void => {
  const q = zoneQuad(p);
  if (!q) return;
  const [a, b, c, d] = q as [
    { x: number; y: number }, { x: number; y: number },
    { x: number; y: number }, { x: number; y: number },
  ];

  ctx.beginPath();
  ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(120,190,255,0.055)';
  ctx.fill();

  // inner thirds
  ctx.strokeStyle = 'rgba(190,225,255,0.20)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    const f = i / 3;
    ctx.beginPath();
    ctx.moveTo(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
    ctx.lineTo(d.x + (c.x - d.x) * f, d.y + (c.y - d.y) * f);
    ctx.moveTo(a.x + (d.x - a.x) * f, a.y + (d.y - a.y) * f);
    ctx.lineTo(b.x + (c.x - b.x) * f, b.y + (c.y - b.y) * f);
    ctx.stroke();
  }

  // corner brackets rather than a full box: the eye needs the extent, not a cage
  ctx.strokeStyle = 'rgba(225,240,255,0.72)';
  ctx.lineWidth = 2.5;
  const bracket = (
    o: { x: number; y: number }, u: { x: number; y: number }, v: { x: number; y: number },
  ): void => {
    ctx.beginPath();
    ctx.moveTo(o.x + (u.x - o.x) * 0.28, o.y + (u.y - o.y) * 0.28);
    ctx.lineTo(o.x, o.y);
    ctx.lineTo(o.x + (v.x - o.x) * 0.28, o.y + (v.y - o.y) * 0.28);
    ctx.stroke();
  };
  bracket(a, b, d); bracket(b, a, c); bracket(c, b, d); bracket(d, a, c);
};

const drawCursor = (
  ctx: CanvasRenderingContext2D, p: Projector, state: GameState, hot: number,
): void => {
  const centre = p.project(vec(state.cursor.x, state.cursor.y, 0));
  const edge = p.project(vec(state.cursor.x + currentCatchRadius(state), state.cursor.y, 0));
  if (!centre || !edge) return;
  const r = Math.abs(edge.x - centre.x);

  const boosted = state.whiffStreak >= 2 && state.player === 'yuki';
  const tint = boosted ? '255,198,72' : hot > 0 ? '255,150,90' : '130,225,255';

  const fillGrad = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, r);
  fillGrad.addColorStop(0, `rgba(${tint},0.20)`);
  fillGrad.addColorStop(1, `rgba(${tint},0.03)`);
  ctx.fillStyle = fillGrad;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(${tint},0.95)`;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, r, 0, Math.PI * 2);
  ctx.stroke();

  // the sweet spot, drawn as its own ring — this is the thing being aimed
  ctx.strokeStyle = `rgba(${tint},0.45)`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(centre.x, centre.y, r * 0.35, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = `rgba(255,255,255,0.9)`;
  ctx.lineWidth = 1.5;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    ctx.beginPath();
    ctx.moveTo(centre.x + dx * r * 0.16, centre.y + dy * r * 0.16);
    ctx.lineTo(centre.x + dx * r * 0.42, centre.y + dy * r * 0.42);
    ctx.stroke();
  }
};

// ---------------------------------------------------------------------------
// batter
// ---------------------------------------------------------------------------

/**
 * Which swing frame to show, given how long ago the bat met the ball.
 *
 * The five sprites are stance / takeback / IMPACT / follow / follow-through, and
 * the cut begins at contact — so it begins at frame 2 and plays out, not at
 * frame 0. Starting at 0 had the batter winding up after the ball had already
 * left, which is the kind of thing that reads as "wrong" long before anyone can
 * say why.
 */
const IMPACT_FRAME = 2;
const swingFrame = (elapsed: number): string => {
  if (elapsed < 0) return 'stance';
  return `swing_${Math.min(4, IMPACT_FRAME + Math.floor(elapsed / 0.085))}`;
};

/**
 * The batter as seen from behind, placed in screen space.
 *
 * Deliberately not projected. At the pitch camera the batter is 3.7 m from the
 * eye and the zone is 4.0 m, so a physically-sized sprite is 97% of frame height
 * and swallows the shot. In this beat the batter is framing, not information —
 * so it is composed by eye and cropped by the bottom edge, the way the reference
 * genre frames it.
 */
const drawBatterFromBehind = (
  ctx: CanvasRenderingContext2D, view: Viewport, sprites: Sprites, hot: number,
): void => {
  const img = sprites.back;
  if (!img || !img.complete || img.naturalWidth === 0) return;
  // Sized so the batter owns the lower-left quadrant and nothing else. At
  // physical scale the sprite is 95% of frame height and covers the strike zone,
  // which is exactly backwards: the zone is what the player is looking at.
  const h = view.height * 0.46;
  const w = (h * img.naturalWidth) / img.naturalHeight;
  const x = view.width * 0.185 - w / 2;
  const y = view.height * 1.02 - h;

  if (hot > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(255,196,96,${0.75 * hot})`;
    ctx.shadowBlur = 34 * hot;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }
  ctx.drawImage(img, x, y, w, h);
};

/**
 * The bat sweeping through, drawn over the behind view.
 *
 * The back sprite cannot animate — there is exactly one frame of it — so the
 * swing is carried by an arc drawn in code. That is enough: what the eye needs
 * at this moment is evidence that the bat crossed the zone, not anatomy.
 */
const drawBatArc = (
  ctx: CanvasRenderingContext2D, view: Viewport, arc: number,
): void => {
  if (arc <= 0 || arc >= 1) return;
  const cx = view.width * 0.30;
  const cy = view.height * 0.74;
  const radius = view.height * 0.52;
  const from = -2.35;
  const to = 0.55;
  const angle = from + (to - from) * arc;

  ctx.save();
  ctx.lineCap = 'round';
  // the smear behind the bat
  for (let i = 1; i <= 6; i++) {
    const a = angle - i * 0.16;
    if (a < from) break;
    ctx.strokeStyle = `rgba(255,255,255,${0.16 * (1 - i / 7) * (1 - arc * 0.4)})`;
    ctx.lineWidth = 12 - i;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, a, a + 0.14);
    ctx.stroke();
  }
  // the bat itself
  const bx = cx + Math.cos(angle) * radius;
  const by = cy + Math.sin(angle) * radius;
  const hx = cx + Math.cos(angle) * radius * 0.28;
  const hy = cy + Math.sin(angle) * radius * 0.28;
  ctx.strokeStyle = '#1a1a1e';
  ctx.lineWidth = 15;
  ctx.beginPath();
  ctx.moveTo(hx, hy); ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.strokeStyle = '#3a3a42';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(hx, hy); ctx.lineTo(bx, by);
  ctx.stroke();
  ctx.restore();
};

/** The batter at world scale, for the side-view cut. */
const drawBatterFromSide = (
  ctx: CanvasRenderingContext2D, p: Projector, sprites: Sprites,
  sinceContact: number | null, hot: number,
): void => {
  const key = sinceContact === null ? 'stance' : swingFrame(sinceContact);
  const img = sprites[key] ?? sprites.stance;
  if (!img || !img.complete || img.naturalWidth === 0) return;

  const feet = p.project(vec(-0.78, 0, -0.15));
  const head = p.project(vec(-0.78, 1.75, -0.15));
  if (!feet || !head) return;
  const h = (feet.y - head.y) * 1.12;
  const w = (h * img.naturalWidth) / img.naturalHeight;
  if (hot > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(255,196,96,${0.8 * hot})`;
    ctx.shadowBlur = 30 * hot;
    ctx.drawImage(img, feet.x - w * 0.5, feet.y - h, w, h);
    ctx.restore();
  }
  ctx.drawImage(img, feet.x - w * 0.5, feet.y - h, w, h);
};

// ---------------------------------------------------------------------------

export const drawScene = (
  ctx: CanvasRenderingContext2D,
  p: Projector,
  state: GameState,
  sprites: Sprites,
  view: Viewport,
  show: Presentation,
): void => {
  drawStadium(ctx, p, view, show.stadium);

  if (show.mode !== 'flight') drawPitcher(ctx, p, show.windup);

  // batted ball and its arc
  const swing = state.swing;
  if (swing && swing.trail.length > 1 && show.sinceContact !== null) {
    const upTo = Math.max(
      2, Math.round(((state.flightTime ?? 0) / swing.hangTime) * swing.trail.length));
    const visible = swing.trail.slice(0, Math.min(upTo, swing.trail.length));
    ctx.beginPath();
    let started = false;
    for (const v of visible) {
      const s = p.project(v);
      if (!s) continue;
      if (started) ctx.lineTo(s.x, s.y); else { ctx.moveTo(s.x, s.y); started = true; }
    }
    if (started) {
      ctx.strokeStyle = swing.titanic ? 'rgba(255,214,120,0.75)' : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = swing.titanic ? 3.5 : 2.5;
      ctx.stroke();
    }
    drawBall(ctx, p, battedBallAt(swing, state.flightTime ?? swing.hangTime),
      swing.titanic ? 1 : 0.35);
  }

  if (show.mode === 'swing') {
    drawBatterFromSide(ctx, p, sprites, show.sinceContact, show.hot);
  }

  if (show.mode === 'pitch') {
    drawBatterFromBehind(ctx, view, sprites, show.hot);
    drawZone(ctx, p);
    if (state.flight && state.phase === 'pitching') {
      drawPitchTrail(ctx, p, state);
      drawBall(ctx, p, ballAt(state.flight, state.time));
    } else if (state.phase === 'ready' || state.phase === 'result') {
      // hold the ball at the release point so the eye knows where to look
      const s = p.project(vec(0.35, 1.85, 16.7));
      if (s && state.phase === 'ready') drawBall(ctx, p, vec(0.35, 1.85, 16.7));
    }
    drawCursor(ctx, p, state, show.hot);
    drawBatArc(ctx, view, show.swingArc);
  }
};

export { ZONE_MID_Y };
