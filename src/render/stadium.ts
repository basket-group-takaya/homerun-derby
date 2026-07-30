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
import { seedRng, nextFloat } from '../core/rng.js';
import {
  FENCE_HEIGHT, FOUL_ANGLE, MOUND_DISTANCE, POLE_TOP,
  SCOREBOARD_BOTTOM, SCOREBOARD_HALF_WIDTH, SCOREBOARD_TOP, SCOREBOARD_Z,
  FENCE_CENTRE, FENCE_ALLEY, FENCE_LINE,
} from '../core/constants.js';

/**
 * The two times of day, requested on 令和8年7月31日.
 *
 * Written as two complete palettes rather than as a night palette plus a
 * brightness multiplier. Daylight is not night turned up: the sky inverts from
 * dark-at-the-top to light-at-the-horizon, shadows go from long and warm to
 * short and neutral, and the floodlights stop being the light source and become
 * grey towers. A multiplier gets none of that and produces a washed-out night.
 *
 * 【要確認：意匠】 The park is ours, not a copy of a real one — PROMPT.md 0/5
 * forbids real team names and logos, and a stadium's branding is exactly that.
 * What IS taken from 阪神甲子園球場, because they are facts about a place rather
 * than a mark: the infield is 黒土, a blend of black soil and white sand
 * (spring 5.5:4.5, summer 6:4), the outfield fence is dark green, the outfield
 * grass is kept green all year by two grasses in rotation, and the ground's
 * basic colours since 1980 are green, yellow and black.
 * Sources: koshien.hanshin.co.jp, ja.wikipedia.org/wiki/阪神甲子園球場,
 * read 令和8年7月31日.
 */
export type TimeOfDay = 'night' | 'day';

type Skin = {
  readonly skyHigh: string;
  readonly skyMid: string;
  readonly skyLow: string;
  readonly horizon: string;
  readonly grass: string;
  readonly grassDark: string;
  readonly grassRim: string;
  readonly dirt: string;
  readonly dirtDark: string;
  readonly wall: string;
  readonly wallTop: string;
  readonly standLow: string;
  readonly standHigh: string;
  /** Are the floodlights lit? Daylight leaves them as grey towers. */
  readonly lightsOn: boolean;
};

const SKINS: Readonly<Record<TimeOfDay, Skin>> = {
  night: {
    skyHigh: '#0b1430', skyMid: '#1d3566', skyLow: '#4a6ea3', horizon: '#7b8fae',
    grass: '#2e7a3c', grassDark: '#266a33', grassRim: '#1f5a2a',
    // 黒土: darker and browner than the orange clay most parks use
    dirt: '#7a5539', dirtDark: '#63432c',
    wall: '#16402a', wallTop: '#f2d24b',
    standLow: '#243046', standHigh: '#161f30',
    lightsOn: true,
  },
  day: {
    // Sky the other way up: pale at the horizon, deep overhead.
    skyHigh: '#2f6fc4', skyMid: '#5b98dd', skyLow: '#9cc6ef', horizon: '#d6e6f4',
    grass: '#3f9a48', grassDark: '#35893e', grassRim: '#2b7433',
    dirt: '#7f5a3c', dirtDark: '#69492f',
    wall: '#1d5535', wallTop: '#f7dc5c',
    standLow: '#5a6274', standHigh: '#414859',
    lightsOn: false,
  },
};

/*
 * The active palette, as plain bindings.
 *
 * Module-level and mutable, which is normally the wrong shape — but every one of
 * the two dozen draw helpers below reads these by name, and threading a palette
 * through all of them would be a large diff for no behavioural gain. It is set
 * once at the top of drawStadium, before anything is drawn, and read-only for
 * the rest of the frame. The render layer still never writes game state
 * (PROMPT.md 2); this is a drawing parameter, not a fact about the game.
 */
let SKY_HIGH = SKINS.night.skyHigh;
let SKY_MID = SKINS.night.skyMid;
let SKY_LOW = SKINS.night.skyLow;
let HORIZON = SKINS.night.horizon;
let GRASS = SKINS.night.grass;
let GRASS_DARK = SKINS.night.grassDark;
let GRASS_RIM = SKINS.night.grassRim;
let DIRT = SKINS.night.dirt;
let DIRT_DARK = SKINS.night.dirtDark;
let WALL = SKINS.night.wall;
let WALL_TOP = SKINS.night.wallTop;
let STAND_LOW = SKINS.night.standLow;
let STAND_HIGH = SKINS.night.standHigh;
let LIGHTS_ON = SKINS.night.lightsOn;

const applySkin = (when: TimeOfDay): void => {
  const k = SKINS[when];
  SKY_HIGH = k.skyHigh;
  SKY_MID = k.skyMid;
  SKY_LOW = k.skyLow;
  HORIZON = k.horizon;
  GRASS = k.grass;
  GRASS_DARK = k.grassDark;
  GRASS_RIM = k.grassRim;
  DIRT = k.dirt;
  DIRT_DARK = k.dirtDark;
  WALL = k.wall;
  WALL_TOP = k.wallTop;
  STAND_LOW = k.standLow;
  STAND_HIGH = k.standHigh;
  LIGHTS_ON = k.lightsOn;
};

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

/**
 * A city behind the park.
 *
 * The single biggest difference between this frame and a finished baseball game
 * is not shading, it is EMPTINESS: ours was sky, a bowl and a wall, and roughly
 * a third of the screen had nothing in it. Real parks sit in a place. Putting
 * buildings behind the stands costs a few dozen rectangles and gives the sky a
 * bottom edge, which is what makes the stadium feel like it has an outside.
 *
 * Generated once from the seeded PRNG so the skyline is the same every frame and
 * every session — a city that reshuffles itself between pitches is worse than no
 * city at all.
 */
type Building = {
  readonly angle: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly shade: number;
  readonly windows: readonly { readonly u: number; readonly v: number }[];
};

const SKYLINE: readonly Building[] = (() => {
  let rng = seedRng(20260731);
  const draw = (): number => {
    const next = nextFloat(rng);
    rng = next.rng;
    return next.value;
  };
  const out: Building[] = [];
  for (let a = -FOUL_ANGLE - 10; a <= FOUL_ANGLE + 10; a += 3.4 + draw() * 2.2) {
    const height = FENCE_HEIGHT + 20 + draw() * 34;
    const width = 2.6 + draw() * 3.4;
    const windows: { u: number; v: number }[] = [];
    const rows = Math.floor(height / 5);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 3; c++) {
        if (draw() < 0.42) windows.push({ u: (c + 0.5) / 3, v: (r + 0.5) / rows });
      }
    }
    out.push({
      angle: a,
      width,
      height,
      depth: 62 + draw() * 46,
      shade: 0.55 + draw() * 0.45,
      windows,
    });
  }
  return out;
})();

const drawSkyline = (ctx: CanvasRenderingContext2D, p: Projector): void => {
  for (const b of SKYLINE) {
    const half = (b.width / (b.depth * 0.02)) * 0.5;
    const left = b.angle - half;
    const right = b.angle + half;
    const face = [
      onFence(left, 0, b.depth),
      onFence(right, 0, b.depth),
      onFence(right, b.height, b.depth),
      onFence(left, b.height, b.depth),
    ];
    const tone = Math.round(28 * b.shade);
    fill(ctx, p, face, `rgb(${tone + 6},${tone + 10},${tone + 20})`);

    if (!LIGHTS_ON) continue;                 // daylight: no lit windows
    for (const w of b.windows) {
      const a = left + (right - left) * w.u;
      const y = b.height * w.v;
      const q = p.project(onFence(a, y, b.depth));
      if (!q) continue;
      const r = p.scaleAt(q.depth) * 0.22;
      if (r < 0.35) continue;
      ctx.fillStyle = 'rgba(255,226,150,0.5)';
      ctx.fillRect(q.x - r * 0.5, q.y - r * 0.6, r, r * 1.2);
    }
  }
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
    // In daylight the towers are structure, not light. Leaving the glow on is
    // what makes a "day" mode look like a night scene with the brightness up.
    const pylon = LIGHTS_ON ? '#0d1522' : '#7e8798';
    stroke(ctx, p, [base, top], pylon, 5);
    const head = p.project(top);
    if (!head) continue;
    const w = Math.max(6, p.scaleAt(head.depth) * 7);
    ctx.fillStyle = pylon;
    ctx.fillRect(head.x - w / 2, head.y - w * 0.34, w, w * 0.42);
    if (!LIGHTS_ON) continue;
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

  /*
   * Boards along the wall.
   *
   * Every real outfield fence has them, and they do more than decorate: a plain
   * band of one colour gives the eye nothing to judge distance or speed against,
   * so a ball travelling along it looks slower than it is. These are abstract
   * colour panels — PROMPT.md 0/5 forbids real brands, and inventing fake ones
   * that look real is the same problem wearing a hat.
   */
  const BOARD_COLOURS = ['#1d3f6d', '#7a2230', '#20563a', '#5a4a1c', '#2c2f52'];
  const ADS_FROM = -FOUL_ANGLE + 3;
  const ADS_TO = FOUL_ANGLE - 3;
  const SPAN = 4.4;
  let index = 0;
  for (let a = ADS_FROM; a + SPAN <= ADS_TO; a += SPAN + 0.5) {
    const panel = [
      onFence(a, FENCE_HEIGHT * 0.20, -0.02),
      onFence(a + SPAN, FENCE_HEIGHT * 0.20, -0.02),
      onFence(a + SPAN, FENCE_HEIGHT * 0.86, -0.02),
      onFence(a, FENCE_HEIGHT * 0.86, -0.02),
    ];
    fill(ctx, p, panel, BOARD_COLOURS[index % BOARD_COLOURS.length] as string);
    // a lighter bar across each board, so they read as signs and not as holes
    const bar = [
      onFence(a + 0.4, FENCE_HEIGHT * 0.44, -0.03),
      onFence(a + SPAN - 0.4, FENCE_HEIGHT * 0.44, -0.03),
      onFence(a + SPAN - 0.4, FENCE_HEIGHT * 0.60, -0.03),
      onFence(a + 0.4, FENCE_HEIGHT * 0.60, -0.03),
    ];
    fill(ctx, p, bar, 'rgba(226,236,250,0.30)');
    index++;
  }

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
 * The pitcher, as an articulated silhouette.
 *
 * There is no pitcher art (docs/SPEC.md 2-4) and none can be fetched
 * (PROMPT.md 1), so the figure is jointed and drawn from primitives. Two
 * rewrites got here and both failures are worth recording, because they were
 * failures of PROPORTION rather than of detail:
 *
 *   1. A rectangle torso with a stick arm swung out sideways at release. A
 *      pitcher at release has the arm coming toward the viewer, so on screen it
 *      must shorten; extending it sideways read as a scarecrow.
 *   2. The torso was drawn as a 0.62-body-width line and the arms as 0.24, so
 *      at the size this figure actually appears (about 220 px tall) the arms
 *      never emerged from the torso silhouette at all. The delivery was
 *      invisible, and the head merged into the shoulders into one lump.
 *
 * So: a narrow tapered torso, a head with a neck gap, and arm keyframes that are
 * required to put the hand clearly OUTSIDE the torso — or clearly above the head
 * — at every moment of the delivery. Readability at 220 px is the constraint
 * that decides every number here.
 *
 * `windup` runs 0 (set) through 0.82 (release, hand high on the third-base side)
 * to 1 (follow-through, arm across the body).
 */

/**
 * Hand position through the delivery: [windup, x, y] in units of h * 0.33,
 * measured from the throwing shoulder, +x frame-right and +y down.
 *
 * The order matters and the obvious order is wrong. An arm that goes straight
 * from "at the chest" to "out to the side" spends most of the delivery held
 * horizontally, which reads as a T-pose scarecrow — the exact complaint this
 * is the second attempt at. A real delivery drops the hand DOWN and BEHIND the
 * hip first, then swings it up past the shoulder, so the arm is only briefly
 * near horizontal and is descending or climbing the rest of the time.
 */
const ARM_PATH: readonly (readonly [number, number, number])[] = [
  [0.00, -0.18, 0.34],   // set: hands together at the chest
  [0.22, -0.42, 0.90],   // hand drops down behind the hip
  [0.45, -0.82, 0.34],   // swings back, still below the shoulder
  [0.62, -0.72, -0.52],  // elbow up, hand climbing
  [0.78, -0.26, -1.05],  // over the top, hand above the head
  [0.88, -0.10, -0.78],  // release
  [1.00, 0.45, 0.32],    // follow-through, down across the body
];

const handAt = (whip: number): { x: number; y: number } => {
  for (let i = 1; i < ARM_PATH.length; i++) {
    const a = ARM_PATH[i - 1];
    const b = ARM_PATH[i];
    if (!a || !b) continue;
    if (whip <= b[0] || i === ARM_PATH.length - 1) {
      const span = b[0] - a[0];
      const f = span <= 0 ? 0 : Math.min(1, Math.max(0, (whip - a[0]) / span));
      return { x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f };
    }
  }
  return { x: ARM_PATH[0]?.[1] ?? 0, y: ARM_PATH[0]?.[2] ?? 0 };
};

export const drawPitcher = (
  ctx: CanvasRenderingContext2D, p: Projector, windup: number,
): void => {
  const ground = p.project(vec(0, 0.254, MOUND_DISTANCE));
  const crown = p.project(vec(0, 2.02, MOUND_DISTANCE));
  if (!ground || !crown) return;
  const h = ground.y - crown.y;
  if (h < 12) return;
  const x = ground.x;
  const y = ground.y;

  const t = Math.min(1, Math.max(0, windup));
  // slow gather, fast whip
  const whip = t < 0.55 ? (t / 0.55) * 0.30 : 0.30 + ((t - 0.55) / 0.45) ** 0.65 * 0.70;

  const SKIN = '#101a2c';
  const hipY = y - h * 0.47;
  const shoulderY = y - h * 0.78;
  const headY = y - h * 0.905;
  const headR = h * 0.072;
  // the body carries toward the plate; on screen that is a small lean
  const lean = whip * h * 0.075;
  const hipX = x + lean * 0.6;
  const shoulderX = x + lean;

  ctx.save();
  ctx.fillStyle = SKIN;
  ctx.strokeStyle = SKIN;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const limb = (
    from: { x: number; y: number }, via: { x: number; y: number },
    to: { x: number; y: number }, width: number,
  ): void => {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(via.x, via.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  };

  // back leg (his right, our left): planted and pushing
  const backFoot = { x: x - h * 0.10 - whip * h * 0.10, y };
  limb(
    { x: hipX, y: hipY },
    { x: x - h * 0.055 - whip * h * 0.05, y: y - h * 0.24 },
    backFoot, h * 0.062);

  // front leg (his left, our right): lifts, then strides toward the plate
  const lift = Math.sin(Math.min(1, t / 0.55) * Math.PI) * (1 - whip * 0.7);
  limb(
    { x: hipX, y: hipY },
    { x: hipX + h * (0.05 + 0.06 * whip), y: hipY - h * 0.13 * lift + h * 0.11 * whip },
    { x: hipX + h * (0.07 + 0.20 * whip), y: y - h * 0.40 * lift },
    h * 0.062);

  // torso: a tapered quad, narrow enough that the arms clear it
  const hipHalf = h * 0.055;
  // the shoulders start closed (nearly side-on) and open square to the plate,
  // which on screen is simply the torso getting wider
  const shoulderHalf = h * (0.048 + 0.036 * whip);
  ctx.beginPath();
  ctx.moveTo(hipX - hipHalf, hipY);
  ctx.lineTo(hipX + hipHalf, hipY);
  ctx.lineTo(shoulderX + shoulderHalf, shoulderY);
  ctx.lineTo(shoulderX - shoulderHalf, shoulderY);
  ctx.closePath();
  ctx.fill();

  // Glove arm (his left, our right). Deliberately SHORT: through the stride it
  // points at the plate, which is straight at the camera, so it foreshortens
  // almost to nothing. Drawing it extended sideways was half of what made the
  // figure a T-pose.
  const gloveOut = 0.11 - 0.05 * whip;
  const glove = {
    x: shoulderX + h * gloveOut,
    y: shoulderY + h * (0.03 + 0.11 * whip),
  };
  limb(
    { x: shoulderX + shoulderHalf * 0.6, y: shoulderY + h * 0.008 },
    { x: shoulderX + h * (gloveOut * 0.9), y: shoulderY + h * 0.06 },
    glove, h * 0.045);

  // throwing arm (his right, our left)
  const hand = handAt(whip);
  const handX = shoulderX + hand.x * h * 0.33;
  const handY = shoulderY + hand.y * h * 0.33;
  const dx = handX - shoulderX;
  const dy = handY - shoulderY;
  const reach = Math.hypot(dx, dy) || 1;
  // elbow pushed off the shoulder-hand line so the arm reads as jointed
  const bend = h * 0.055 * (1 - whip * 0.35);
  limb(
    { x: shoulderX - shoulderHalf * 0.6, y: shoulderY + h * 0.008 },
    {
      x: shoulderX + dx * 0.5 - (dy / reach) * bend,
      y: shoulderY + dy * 0.5 + (dx / reach) * bend,
    },
    { x: handX, y: handY }, h * 0.048);

  // head, with a neck gap so it does not merge into the shoulders
  ctx.beginPath();
  ctx.arc(shoulderX + lean * 0.25, headY, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = h * 0.028;
  ctx.beginPath();
  ctx.moveTo(shoulderX + lean * 0.25, headY + headR * 0.6);
  ctx.lineTo(shoulderX, shoulderY - h * 0.005);
  ctx.stroke();
  // cap brim, pointing at the plate
  ctx.lineWidth = h * 0.024;
  ctx.beginPath();
  ctx.moveTo(shoulderX + lean * 0.25 - headR * 0.2, headY - headR * 0.45);
  ctx.lineTo(shoulderX + lean * 0.25 - headR * 1.5, headY - headR * 0.15);
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

const paintStadium = (
  ctx: CanvasRenderingContext2D, p: Projector, view: Viewport, flags: StadiumFlags,
  when: TimeOfDay,
): void => {
  applySkin(when);
  drawSky(ctx, view);
  drawSkyline(ctx, p);
  drawStands(ctx, p);
  drawFloodlights(ctx, p);
  drawScoreboard(ctx, p, flags.scoreboardFlash > 0);
  drawFieldSurface(ctx, p);
  drawLines(ctx, p);
  drawFence(ctx, p);
  drawPoles(ctx, p, flags.poleFlash);
};

/*
 * The stadium is baked to an offscreen canvas and blitted.
 *
 * Measured, not guessed: one frame of the park costs about 1,600 fills, 1,300
 * strokes and 3,100 rectangles — the crowd and the lit windows are most of it.
 * And while the pitcher is winding up NONE of it changes, because the camera is
 * parked behind the batter and the park is not animated. The whole thing was
 * being redrawn sixty times a second to produce an identical image.
 *
 * The key comes from the projector rather than from a hand-picked list of
 * fields, so a camera change cannot quietly fail to invalidate it. When the
 * camera IS moving — following a fly ball — every frame misses and this costs
 * one extra blit over drawing directly, which is the right trade: the expensive
 * case is the common one.
 *
 * The practical consequence is that DETAIL IS NOW CHEAP. More boards, a fuller
 * scoreboard and more towers cost nothing on a static camera, which is what the
 * remaining work on the look needs.
 */
let cacheCanvas: HTMLCanvasElement | null = null;
let cacheKey = '';

export const drawStadium = (
  ctx: CanvasRenderingContext2D, p: Projector, view: Viewport, flags: StadiumFlags,
  when: TimeOfDay = 'night',
): void => {
  // The device transform: the visible canvas draws in logical units on a larger
  // backing store, and the bake has to match it or the blit comes back soft.
  const t = ctx.getTransform();
  const sx = t.a;
  const sy = t.d;
  const w = Math.max(1, Math.round(view.width * sx));
  const h = Math.max(1, Math.round(view.height * sy));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) {
    paintStadium(ctx, p, view, flags, when);
    return;
  }

  const key = `${p.key}|${when}|${w}x${h}|${flags.scoreboardFlash > 0 ? 1 : 0}`
    + `|${flags.poleFlash.toFixed(3)}`;

  if (cacheKey !== key || !cacheCanvas) {
    const surface = cacheCanvas ?? document.createElement('canvas');
    if (surface.width !== w || surface.height !== h) {
      surface.width = w;
      surface.height = h;
    }
    const bake = surface.getContext('2d');
    if (!bake) {                       // no second context: draw straight through
      paintStadium(ctx, p, view, flags, when);
      return;
    }
    bake.setTransform(sx, 0, 0, sy, 0, 0);
    bake.clearRect(0, 0, view.width, view.height);
    paintStadium(bake, p, view, flags, when);
    cacheCanvas = surface;
    cacheKey = key;
  } else {
    // The skin is global mutable state that the figures also read, and on a
    // cache hit paintStadium never runs to set it. Missing this leaves the
    // players lit for the wrong time of day the moment the cache warms up.
    applySkin(when);
  }

  ctx.drawImage(cacheCanvas, 0, 0, view.width, view.height);
};
