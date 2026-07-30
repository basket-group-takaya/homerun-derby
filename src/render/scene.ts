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
import { RELEASE_POINT } from '../core/pitch.js';
import {
  BALL_RADIUS, PLATE_HALF_WIDTH, ZONE_BOTTOM, ZONE_TOP,
} from '../core/constants.js';

export type Sprites = Partial<Record<string, HTMLImageElement>>;

/**
 * Where a player's bat is hinged, in fractions of the sprite, plus the angle it
 * rests at. Produced by tools/make_back_camera.py, which cuts the bat out of the
 * rear art so it can be swung as its own layer.
 */
export type BatAnchor = {
  readonly pivotX: number;
  readonly pivotY: number;
  readonly restAngleDeg: number;
};

/** Absolute angle the bat reaches at the end of the follow-through [deg]. */
/**
 * Absolute angle the bat reaches at the end of the follow-through [deg].
 *
 * Chosen so the bat is LEVEL at the moment of contact, which is 43% of the way
 * through the sweep (0.13 s of 0.30 s). Level at the ball is what the reference
 * footage shows, and it is the frame the eye actually reads.
 */
const BAT_FOLLOW_THROUGH_DEG = 70;

export type ViewMode = 'pitch' | 'flight';

export type Presentation = {
  readonly mode: ViewMode;
  /** Seconds since the bat met the ball; null when no swing is in flight. */
  readonly sinceContact: number | null;
  /** 0..1 windup progress for the pitcher silhouette. */
  readonly windup: number;
  /** 0..1, how far through the bat's arc we are during a swing. */
  readonly swingArc: number;
  readonly stadium: StadiumFlags;
  /** 1 while the batter is in shot, fading to 0 as the camera pulls back. */
  readonly batterFade: number;
  /** Set while the player is on a home-run streak. docs/REFERENCE-HB2.md 9-B5. */
  readonly hot: number;
  /** Bat hinge data for the batting player, or null until it has loaded. */
  readonly batAnchor: BatAnchor | null;
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
 * The batter as seen from behind, placed in screen space, with a swinging bat.
 *
 * Two layers. back_cam_body is the figure with the bat cut out of it, and
 * back_cam_bat is the bat alone; tools/make_back_camera.py produces both, plus
 * the hinge point. Rotating the bat layer about that hinge gives a real swing in
 * the pitch camera — which is what the reference game does — where before there
 * was a static sprite with a drawn streak beside it, so two bats were visible at
 * once. If either layer or the hinge is missing, this falls back to the single
 * back_cam image and no swing.
 *
 * Deliberately not projected. At the pitch camera the batter is 2.5 m from the
 * eye, so a physically-sized sprite swallows the strike zone. In this beat the
 * batter is the frame and the zone is the subject.
 */
const drawBatterFromBehind = (
  ctx: CanvasRenderingContext2D, view: Viewport, sprites: Sprites,
  hot: number, fade: number, arc: number, anchor: BatAnchor | null,
): void => {
  const ready = (i: HTMLImageElement | undefined): i is HTMLImageElement =>
    i !== undefined && i.complete && i.naturalWidth > 0;

  const body = sprites.back_cam_body;
  const bat = sprites.back_cam_bat;
  const whole = sprites.back_cam ?? sprites.back;
  const twoLayer = anchor !== null && ready(body) && ready(bat);
  const base = twoLayer ? body : whole;
  if (!ready(base) || fade <= 0.01) return;

  // 52% of frame height with the feet on the bottom edge, which is what the
  // reference footage measures at (docs/REFERENCE-HB2.md 3-1: about 51%).
  const h = view.height * 0.52;
  const w = (h * base.naturalWidth) / base.naturalHeight;
  const x = view.width * 0.26 - w / 2;
  const y = view.height * 1.00 - h;

  ctx.save();
  ctx.globalAlpha = Math.min(1, fade);

  // Body turn. The rear art is a single frame, so the torso cannot be animated
  // cel by cel, but pivoting it at the hips and leaning into the ball carries
  // the swing along with the bat instead of leaving the body frozen.
  const swinging = arc > 0;
  const progress = Math.min(1, arc);
  if (swinging) {
    const turn = 1 - Math.pow(1 - progress, 2.2);
    ctx.translate(x + w * 0.52, y + h * 0.93);
    ctx.rotate(turn * 0.16);
    const lunge = 1 + turn * 0.03;
    ctx.scale(lunge, lunge);
    ctx.translate(-(x + w * 0.52), -(y + h * 0.93));
  }

  if (hot > 0) {
    ctx.shadowColor = `rgba(255,196,96,${0.75 * hot})`;
    ctx.shadowBlur = 34 * hot;
    ctx.drawImage(base, x, y, w, h);
    ctx.shadowBlur = 0;
  }
  ctx.drawImage(base, x, y, w, h);

  if (twoLayer && anchor) {
    const px = x + anchor.pivotX * w;
    const py = y + anchor.pivotY * h;
    // Linear, and tuned so the bat is level at the moment of contact rather than
    // after it: the bat reaches the ball T_SWING (130 ms) after the input, which
    // is 59% of the way through the 220 ms sweep.
    const sweep = (progress: number): number =>
      ((BAT_FOLLOW_THROUGH_DEG - anchor.restAngleDeg) * progress * Math.PI) / 180;

    const drawBat = (progress: number, alpha: number): void => {
      ctx.save();
      ctx.globalAlpha = Math.min(1, fade) * alpha;
      ctx.translate(px, py);
      ctx.rotate(sweep(progress));
      ctx.translate(-px, -py);
      ctx.drawImage(bat, x, y, w, h);
      ctx.restore();
    };

    if (swinging) {
      // ghosts behind the bat, for a motion smear made of the bat itself
      for (let i = 3; i >= 1; i--) {
        const back = progress - i * 0.075;
        if (back > 0) drawBat(back, 0.10 * (4 - i) * 0.5);
      }
    }
    drawBat(swinging ? progress : 0, 1);
  }

  ctx.restore();
};

/*
 * The code-drawn bat arc that used to live here is gone. It existed because the
 * rear sprite's bat could not move, and it meant two bats were on screen during
 * every swing — the sprite's, held up, and the drawn one, swinging. The bat is
 * now a real layer that rotates (see drawBatterFromBehind).
 */

/*
 * There is deliberately no side-view batter here any more.
 *
 * The swing_0..4 sprites are drawn from the first-base side (chest to camera).
 * Showing them mid-swing meant cutting across the plate, and the batter then
 * appeared to change batter's box at the moment of contact - the single worst
 * bug in the build. Removing the cut costs those fifteen sprites their use in
 * play, and that cost is the argument for a rear-view swing sheet. See
 * docs/PROGRESS.md star-judgement 11.
 */

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

  if (show.mode === 'pitch') {
    drawBatterFromBehind(
      ctx, view, sprites, show.hot, show.batterFade, show.swingArc, show.batAnchor);
    drawZone(ctx, p);
    if (state.flight && state.phase === 'pitching') {
      drawPitchTrail(ctx, p, state);
      drawBall(ctx, p, ballAt(state.flight, state.time));
    } else if (state.phase === 'ready') {
      // hold the ball in the pitcher's hand so the eye knows where to look
      drawBall(ctx, p, RELEASE_POINT);
    }
    drawCursor(ctx, p, state, show.hot);
  }
};

export { ZONE_MID_Y };
