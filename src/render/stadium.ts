/**
 * The ballpark, drawn entirely in code.
 *
 * PROMPT.md 1 allows no images beyond the 21 player sprites, so every blade of
 * grass here is a polygon. That constraint turns out to help: the reference work
 * (docs/REFERENCE-HB2.md 7) says the genre deliberately abandons photorealism,
 * so flat saturated shapes are the target rather than a compromise.
 *
 * Read-only with respect to game state (PROMPT.md 2).
 */

import type { Vec3 } from '../core/vec.js';
import { vec, radians } from '../core/vec.js';
import type { Projector, Viewport } from './camera.js';
import { fenceDistance, POLE_POSITIONS } from '../core/stadium.js';
import {
  FENCE_HEIGHT, FOUL_ANGLE, MOUND_DISTANCE, POLE_TOP,
  SCOREBOARD_BOTTOM, SCOREBOARD_HALF_WIDTH, SCOREBOARD_TOP, SCOREBOARD_Z,
  FENCE_CENTRE, FENCE_ALLEY, FENCE_LINE,
} from '../core/constants.js';

// A dusk palette: warm horizon under a deep sky is what makes floodlights read.
const SKY_HIGH = '#0b1430';
const SKY_MID = '#1d3566';
const SKY_LOW = '#4a6ea3';
const HORIZON = '#7b8fae';
const GRASS = '#2e7a3c';
const GRASS_DARK = '#266a33';
const GRASS_RIM = '#1f5a2a';
const DIRT = '#9a6f4c';
const DIRT_DARK = '#845c3d';
const WALL = '#16402a';
const WALL_TOP = '#f2d24b';
const STAND_LOW = '#243046';
const STAND_HIGH = '#161f30';

/**
 * Fill a polygon, clipped against the near plane.
 *
 * Uses Projector.projectPolygon rather than projecting vertex by vertex: the
 * follow camera travels downfield past home plate, so polygons that reach back
 * to the plate end up straddling the eye. See the comment on projectPolygon.
 */
const fill = (
  ctx: CanvasRenderingContext2D, p: Projector, pts: readonly Vec3[], colour: string,
): void => {
  const poly = p.projectPolygon(pts);
  if (!poly) return;
  ctx.beginPath();
  poly.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
};

/** Stroke an open polyline. Segments that cross behind the eye are dropped. */
const stroke = (
  ctx: CanvasRenderingContext2D, p: Projector, pts: readonly Vec3[],
  colour: string, width: number,
): void => {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.beginPath();
  let started = false;
  for (const v of pts) {
    const s = p.project(v);
    if (!s) { started = false; continue; }
    if (started) ctx.lineTo(s.x, s.y);
    else { ctx.moveTo(s.x, s.y); started = true; }
  }
  ctx.stroke();
};

/** A point on the fence at a given spray angle and height. */
const onFence = (a: number, y: number, out = 0): Vec3 => {
  const d = fenceDistance(a) + out;
  return vec(d * Math.sin(radians(a)), y, d * Math.cos(radians(a)));
};

// ---------------------------------------------------------------------------
// crowd — precomputed once so the same people sit in the same seats every frame
// ---------------------------------------------------------------------------

type Spectator = { readonly pos: Vec3; readonly colour: string };

const CROWD: readonly Spectator[] = (() => {
  const people: Spectator[] = [];
  // a deterministic hash, so screenshots are reproducible run to run
  let h = 0x2545f491;
  const r = (): number => {
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    return h / 0x100000000;
  };
  // Muted, low-contrast, and seated in ROWS. Scattering bright squares freely
  // produced something that read as confetti: a crowd is recognisable because
  // it is regular, not because the individual people are.
  const shirts = [
    '#9aa6bb', '#7e8ca6', '#b0a08a', '#6d7a94', '#a6b2c4', '#8d97ab', '#bfae93', '#69748c',
  ];
  const rows = 26;
  for (let row = 0; row < rows; row++) {
    const tier = row / (rows - 1);
    // a gap between the lower bowl and the upper deck
    const out = 3.2 + tier * 29 + (tier > 0.55 ? 2.4 : 0);
    const y = FENCE_HEIGHT + 0.7 + tier * 15.0 + (tier > 0.55 ? 1.0 : 0);
    const perRow = 128;
    for (let i = 0; i < perRow; i++) {
      // jitter within the seat, not across the stand: rows stay legible
      const a = -FOUL_ANGLE - 6
        + ((i + 0.5 + (r() - 0.5) * 0.55) / perRow) * (2 * FOUL_ANGLE + 12);
      if (r() < 0.16) continue; // empty seats, so it is not a solid wall
      const clamped = Math.max(-FOUL_ANGLE, Math.min(FOUL_ANGLE, a));
      const d = fenceDistance(clamped) + out;
      people.push({
        pos: vec(d * Math.sin(radians(a)), y + (r() - 0.5) * 0.25,
          d * Math.cos(radians(a))),
        colour: shirts[Math.floor(r() * shirts.length)] ?? '#9aa6bb',
      });
    }
  }
  return people;
})();

// ---------------------------------------------------------------------------
// pieces
// ---------------------------------------------------------------------------

const drawSky = (ctx: CanvasRenderingContext2D, view: Viewport): void => {
  const g = ctx.createLinearGradient(0, 0, 0, view.height);
  g.addColorStop(0, SKY_HIGH);
  g.addColorStop(0.42, SKY_MID);
  g.addColorStop(0.78, SKY_LOW);
  g.addColorStop(1, HORIZON);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view.width, view.height);
};

const drawStands = (ctx: CanvasRenderingContext2D, p: Projector): void => {
  const step = 1.5;
  const inner: Vec3[] = [];
  const outer: Vec3[] = [];
  for (let a = -FOUL_ANGLE - 6; a <= FOUL_ANGLE + 6; a += step) {
    const clamped = Math.max(-FOUL_ANGLE, Math.min(FOUL_ANGLE, a));
    inner.push(onFence(clamped, FENCE_HEIGHT, 2.0));
    outer.push(onFence(clamped, FENCE_HEIGHT + 16.5, 34));
  }
  fill(ctx, p, [...inner, ...[...outer].reverse()], STAND_LOW);

  // upper deck, darker, so the bowl has depth rather than reading as one slab
  const upperLow: Vec3[] = [];
  const upperHigh: Vec3[] = [];
  for (let a = -FOUL_ANGLE - 6; a <= FOUL_ANGLE + 6; a += step) {
    const clamped = Math.max(-FOUL_ANGLE, Math.min(FOUL_ANGLE, a));
    upperLow.push(onFence(clamped, FENCE_HEIGHT + 11.0, 22));
    upperHigh.push(onFence(clamped, FENCE_HEIGHT + 17.5, 36));
  }
  fill(ctx, p, [...upperLow, ...[...upperHigh].reverse()], STAND_HIGH);

  // the crowd
  for (const s of CROWD) {
    const q = p.project(s.pos);
    if (!q) continue;
    const r = p.scaleAt(q.depth) * 0.16;
    if (r < 0.28) continue;
    ctx.fillStyle = s.colour;
    ctx.globalAlpha = 0.62;
    ctx.fillRect(q.x - r, q.y - r, r * 1.9, r * 2.1);
  }
  ctx.globalAlpha = 1;

  // a rail along the front of the stands, which is what actually sells the
  // difference between "seating" and "textured wall"
  const rail: Vec3[] = [];
  for (let a = -FOUL_ANGLE; a <= FOUL_ANGLE; a += 1.5) rail.push(onFence(a, FENCE_HEIGHT + 0.7, 2.6));
  stroke(ctx, p, rail, 'rgba(150,168,196,0.35)', 1.5);
};

const drawFloodlights = (ctx: CanvasRenderingContext2D, p: Projector): void => {
  for (const a of [-40, -20, 20, 40]) {
    const base = onFence(a, FENCE_HEIGHT + 17.5, 36);
    const top = onFence(a, FENCE_HEIGHT + 40, 36);
    stroke(ctx, p, [base, top], '#0d1522', 5);
    const head = p.project(top);
    if (!head) continue;
    const w = Math.max(6, p.scaleAt(head.depth) * 7);
    ctx.fillStyle = '#0d1522';
    ctx.fillRect(head.x - w / 2, head.y - w * 0.34, w, w * 0.42);
    const glow = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, w * 2.4);
    glow.addColorStop(0, 'rgba(255,246,214,0.55)');
    glow.addColorStop(1, 'rgba(255,246,214,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(head.x, head.y, w * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
};

const drawScoreboard = (
  ctx: CanvasRenderingContext2D, p: Projector, lit: boolean,
): void => {
  const hw = SCOREBOARD_HALF_WIDTH;
  const face: Vec3[] = [
    vec(-hw, SCOREBOARD_BOTTOM, SCOREBOARD_Z),
    vec(hw, SCOREBOARD_BOTTOM, SCOREBOARD_Z),
    vec(hw, SCOREBOARD_TOP, SCOREBOARD_Z),
    vec(-hw, SCOREBOARD_TOP, SCOREBOARD_Z),
  ];
  // legs
  for (const x of [-hw + 2, hw - 2]) {
    stroke(ctx, p, [vec(x, 0, SCOREBOARD_Z), vec(x, SCOREBOARD_BOTTOM, SCOREBOARD_Z)], '#0d1522', 6);
  }
  fill(ctx, p, face, lit ? '#2a2410' : '#12161f');
  stroke(ctx, p, [...face, face[0] as Vec3], lit ? '#ffd76a' : '#39445c', 3);

  // a grid of "bulbs" so it reads as a board rather than a black rectangle
  const cols = 26;
  const rows = 9;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -hw + 1.0 + ((2 * hw - 2.0) * c) / (cols - 1);
      const y = SCOREBOARD_BOTTOM + 0.9
        + ((SCOREBOARD_TOP - SCOREBOARD_BOTTOM - 1.8) * r) / (rows - 1);
      const s = p.project(vec(x, y, SCOREBOARD_Z - 0.05));
      if (!s) continue;
      const rad = p.scaleAt(s.depth) * 0.18;
      if (rad < 0.3) continue;
      // a fixed pattern that vaguely reads as characters
      const on = ((r * 7 + c * 3) % 11) < 4;
      ctx.fillStyle = lit
        ? (on ? 'rgba(255,214,110,0.95)' : 'rgba(120,96,40,0.5)')
        : (on ? 'rgba(150,170,200,0.5)' : 'rgba(60,72,96,0.5)');
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};

/** A horizontal disc of radius r centred on `at`, as a polygon. */
const disc = (at: Vec3, r: number, y: number, steps = 28): Vec3[] => {
  const out: Vec3[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 360;
    out.push(vec(at.x + r * Math.cos(radians(a)), y, at.z + r * Math.sin(radians(a))));
  }
  return out;
};

/** The four bases, in world coordinates. 27.43 m between them. */
const BASE_SIDE = 27.43;
const FIRST = vec(BASE_SIDE * Math.SQRT1_2, 0, BASE_SIDE * Math.SQRT1_2);
const SECOND = vec(0, 0, BASE_SIDE * Math.SQRT2);
const THIRD = vec(-BASE_SIDE * Math.SQRT1_2, 0, BASE_SIDE * Math.SQRT1_2);

/** A dirt strip of the given half-width joining two points. */
const pathStrip = (a: Vec3, b: Vec3, halfWidth: number): Vec3[] => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * halfWidth;
  const nz = (dx / len) * halfWidth;
  return [
    vec(a.x + nx, 0.02, a.z + nz), vec(b.x + nx, 0.02, b.z + nz),
    vec(b.x - nx, 0.02, b.z - nz), vec(a.x - nx, 0.02, a.z - nz),
  ];
};

const drawFieldSurface = (ctx: CanvasRenderingContext2D, p: Projector): void => {
  const fan: Vec3[] = [vec(0, 0, 0)];
  for (let a = -FOUL_ANGLE - 6; a <= FOUL_ANGLE + 6; a += 2) {
    const clamped = Math.max(-FOUL_ANGLE, Math.min(FOUL_ANGLE, a));
    fan.push(onFence(clamped, 0, 3.2));
  }
  fill(ctx, p, fan, GRASS);

  // Mowing stripes, as concentric bands rather than wedges radiating from home.
  // Wedges are geometrically defensible — some parks are mown that way — but
  // from a camera standing at the apex they all converge on the viewer and the
  // outfield reads as a sunburst. Bands run across the line of sight instead, so
  // they do the opposite job: they measure the distance to the fence.
  for (let r = 10; r < FENCE_CENTRE + 12; r += 16) {
    const inner: Vec3[] = [];
    const outer: Vec3[] = [];
    for (let a = -FOUL_ANGLE; a <= FOUL_ANGLE; a += 1.5) {
      const limit = fenceDistance(a);
      const r0 = Math.min(r, limit);
      const r1 = Math.min(r + 8, limit);
      inner.push(vec(r0 * Math.sin(radians(a)), 0.01, r0 * Math.cos(radians(a))));
      outer.push(vec(r1 * Math.sin(radians(a)), 0.01, r1 * Math.cos(radians(a))));
    }
    fill(ctx, p, [...inner, ...[...outer].reverse()], GRASS_DARK);
  }

  // warning track
  const trackInner: Vec3[] = [];
  const trackOuter: Vec3[] = [];
  for (let a = -FOUL_ANGLE; a <= FOUL_ANGLE; a += 1.5) {
    trackInner.push(onFence(a, 0.015, -3.6));
    trackOuter.push(onFence(a, 0.015, 0));
  }
  fill(ctx, p, [...trackInner, ...[...trackOuter].reverse()], DIRT_DARK);

  // The dirt. NOT the whole 28.5 m infield: a real infield is grass, and the
  // skin is only the home circle, the base paths, the base cutouts and the
  // mound. Filling the infield made the bottom half of a portrait frame one
  // flat brown wall, which is the single thing that stopped it reading as
  // baseball at all.
  fill(ctx, p, disc(vec(0, 0, 0), 4.0, 0.02), DIRT);
  for (const [a, b] of [
    [vec(0, 0, 0), FIRST], [FIRST, SECOND], [SECOND, THIRD], [THIRD, vec(0, 0, 0)],
  ] as const) {
    fill(ctx, p, pathStrip(a, b, 0.95), DIRT);
  }
  for (const base of [FIRST, SECOND, THIRD]) {
    fill(ctx, p, disc(base, 3.6, 0.02, 20), DIRT);
  }
  // the bases themselves
  for (const base of [FIRST, SECOND, THIRD]) {
    fill(ctx, p, [
      vec(base.x - 0.23, 0.05, base.z - 0.23), vec(base.x + 0.23, 0.05, base.z - 0.23),
      vec(base.x + 0.23, 0.05, base.z + 0.23), vec(base.x - 0.23, 0.05, base.z + 0.23),
    ], '#f2f2f2');
  }

  // mound
  fill(ctx, p, disc(vec(0, 0, MOUND_DISTANCE), 2.74, 0.06), DIRT);
  fill(ctx, p, disc(vec(0, 0, MOUND_DISTANCE), 2.74, 0.06, 28)
    .map((v) => vec(v.x * 0.55, 0.07, MOUND_DISTANCE + (v.z - MOUND_DISTANCE) * 0.55)), DIRT_DARK);
  stroke(ctx, p, [vec(-0.31, 0.09, MOUND_DISTANCE), vec(0.31, 0.09, MOUND_DISTANCE)], '#f0f0f0', 3);

  // a faint rim where the outfield grass meets the infield, for depth
  const rim: Vec3[] = [];
  for (let a = -FOUL_ANGLE; a <= FOUL_ANGLE; a += 2) {
    rim.push(vec(28.5 * Math.sin(radians(a)), 0.015, 28.5 * Math.cos(radians(a))));
  }
  stroke(ctx, p, rim, GRASS_RIM, 2);
};

const drawLines = (ctx: CanvasRenderingContext2D, p: Projector): void => {
  for (const s of [-1, 1]) {
    const d = fenceDistance(FOUL_ANGLE);
    stroke(ctx, p, [
      vec(0, 0.04, 0),
      vec(s * d * Math.sin(radians(FOUL_ANGLE)), 0.04, d * Math.cos(radians(FOUL_ANGLE))),
    ], 'rgba(255,255,255,0.85)', 3);
  }
  // home plate
  fill(ctx, p, [
    vec(-0.216, 0.05, 0.0), vec(0.216, 0.05, 0.0),
    vec(0.216, 0.05, -0.216), vec(0, 0.05, -0.432), vec(-0.216, 0.05, -0.216),
  ], '#f4f4f4');
  // Batter's boxes. Faint: they are two metres from the camera in the pitch
  // view, so at full strength they are the brightest thing on screen and pull
  // the eye straight down away from the pitcher.
  for (const s of [-1, 1]) {
    stroke(ctx, p, [
      vec(s * 0.38, 0.04, 0.92), vec(s * 1.30, 0.04, 0.92),
      vec(s * 1.30, 0.04, -0.90), vec(s * 0.38, 0.04, -0.90), vec(s * 0.38, 0.04, 0.92),
    ], 'rgba(240,246,255,0.16)', 1.5);
  }
};

const drawFence = (ctx: CanvasRenderingContext2D, p: Projector): void => {
  const top: Vec3[] = [];
  const bottom: Vec3[] = [];
  for (let a = -FOUL_ANGLE; a <= FOUL_ANGLE; a += 1.2) {
    top.push(onFence(a, FENCE_HEIGHT));
    bottom.push(onFence(a, 0));
  }
  fill(ctx, p, [...bottom, ...[...top].reverse()], WALL);
  stroke(ctx, p, top, WALL_TOP, 4);

  // distance markers, painted on the wall
  ctx.textAlign = 'center';
  for (const [a, m] of [
    [-FOUL_ANGLE + 1.5, FENCE_LINE], [-22.5, FENCE_ALLEY], [0, FENCE_CENTRE],
    [22.5, FENCE_ALLEY], [FOUL_ANGLE - 1.5, FENCE_LINE],
  ] as const) {
    const s = p.project(onFence(a, FENCE_HEIGHT * 0.52, -0.05));
    if (!s) continue;
    const size = Math.max(6, p.scaleAt(s.depth) * 1.25);
    if (size < 8) continue;
    ctx.font = `800 ${size}px "Segoe UI", sans-serif`;
    // painted on a wall in the distance, not a HUD element: it must not compete
    // with the ball for attention
    ctx.fillStyle = 'rgba(228,236,246,0.55)';
    ctx.fillText(String(m), s.x, s.y + size * 0.35);
  }
  ctx.textAlign = 'left';
};

const drawPoles = (ctx: CanvasRenderingContext2D, p: Projector, flash: number): void => {
  for (const base of [POLE_POSITIONS.leftPole, POLE_POSITIONS.rightPole]) {
    const foot = vec(base.x, FENCE_HEIGHT - 0.2, base.z);
    const head = vec(base.x, POLE_TOP, base.z);
    const a = p.project(foot);
    const b = p.project(head);
    if (!a || !b) continue;
    const w = Math.max(2, p.scaleAt(a.depth) * 0.72);
    ctx.strokeStyle = flash > 0 ? `rgba(255,255,255,${0.4 + 0.6 * flash})` : WALL_TOP;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // screen at the top, the bit that actually gets hit
    ctx.strokeStyle = 'rgba(255,226,110,0.55)';
    ctx.lineWidth = Math.max(1, w * 0.4);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x + w * 2.2, b.y + (a.y - b.y) * 0.18);
    ctx.stroke();
  }
};

/**
 * The pitcher, as an articulated stick figure with volume.
 *
 * There is no pitcher art (docs/SPEC.md 2-4) and none can be fetched
 * (PROMPT.md 1), so the figure is jointed and drawn with round caps. The first
 * version was a rectangle with a stick arm and read as a scarecrow; what fixes
 * it is not detail but PROPORTION and a pose that changes — a head at 1/7.5 of
 * height, a stride, and an arm that travels from behind the body to release.
 *
 * `windup` runs 0 (set) to 1 (release).
 */
export const drawPitcher = (
  ctx: CanvasRenderingContext2D, p: Projector, windup: number,
): void => {
  const ground = p.project(vec(0, 0.254, MOUND_DISTANCE));
  const crown = p.project(vec(0, 2.02, MOUND_DISTANCE));
  if (!ground || !crown) return;
  const h = ground.y - crown.y;
  if (h < 12) return;
  const w = h * 0.26;
  const x = ground.x;
  const y = ground.y;

  const t = Math.min(1, Math.max(0, windup));
  // ease: slow gather, fast whip
  const whip = t < 0.55 ? (t / 0.55) * 0.30 : 0.30 + ((t - 0.55) / 0.45) ** 0.65 * 0.70;

  const hipY = y - h * 0.47;
  const shoulderY = y - h * 0.76;
  const headY = y - h * 0.885;
  const drift = whip * w * 0.55;          // the body moves toward the plate
  const hipX = x + drift;
  const shoulderX = x + drift * 1.25;

  ctx.save();
  ctx.fillStyle = '#101a2c';
  ctx.strokeStyle = '#101a2c';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // back leg: planted, pushing
  ctx.lineWidth = w * 0.34;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(x - w * 0.10 - whip * w * 0.35, y - h * 0.22);
  ctx.lineTo(x - w * 0.28 - whip * w * 0.7, y);
  ctx.stroke();

  // front leg: lifts, then strides out toward the plate
  const lift = Math.sin(Math.min(1, t / 0.55) * Math.PI) * (1 - whip * 0.7);
  const kneeY = hipY - h * 0.16 * lift + h * 0.14 * whip;
  const footY = y - h * 0.42 * lift;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(hipX + w * (0.18 + 0.35 * whip), kneeY);
  ctx.lineTo(hipX + w * (0.30 + 1.05 * whip), footY);
  ctx.stroke();

  // torso: hips to shoulders, with a bit of width
  ctx.lineWidth = w * 0.62;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(shoulderX, shoulderY);
  ctx.stroke();

  // glove arm, tucking in as the throwing arm comes over
  ctx.lineWidth = w * 0.26;
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(shoulderX - w * (0.55 - 0.25 * whip), shoulderY + h * (0.02 + 0.10 * whip));
  ctx.stroke();

  // throwing arm: from behind the head, over the top, down to release
  const angle = -1.95 + whip * 2.35;
  const elbowA = angle - 0.55;
  const upper = w * 0.72;
  const fore = w * 0.78;
  const elbowX = shoulderX + Math.cos(elbowA) * upper;
  const elbowY = shoulderY + Math.sin(elbowA) * upper;
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(elbowX, elbowY);
  ctx.lineTo(elbowX + Math.cos(angle) * fore, elbowY + Math.sin(angle) * fore);
  ctx.stroke();

  // head
  ctx.beginPath();
  ctx.arc(shoulderX + drift * 0.3, headY, h * 0.068, 0, Math.PI * 2);
  ctx.fill();
  // cap brim, pointing at the batter
  ctx.lineWidth = h * 0.030;
  ctx.beginPath();
  ctx.moveTo(shoulderX + drift * 0.3, headY - h * 0.035);
  ctx.lineTo(shoulderX + drift * 0.3 - h * 0.075, headY - h * 0.020);
  ctx.stroke();

  ctx.restore();
};

// ---------------------------------------------------------------------------

export type StadiumFlags = {
  /** 0..1, lights the scoreboard up when it has just been struck. */
  readonly scoreboardFlash: number;
  /** 0..1, whitens the foul poles when one has just been struck. */
  readonly poleFlash: number;
};

export const drawStadium = (
  ctx: CanvasRenderingContext2D, p: Projector, view: Viewport, flags: StadiumFlags,
): void => {
  drawSky(ctx, view);
  drawStands(ctx, p);
  drawFloodlights(ctx, p);
  drawScoreboard(ctx, p, flags.scoreboardFlash > 0);
  drawFieldSurface(ctx, p);
  drawLines(ctx, p);
  drawFence(ctx, p);
  drawPoles(ctx, p, flags.poleFlash);
};
