/**
 * M2 entry point: fixed-timestep loop wiring input -> core -> render.
 *
 * The core stays pure; every impure thing (clock, DOM, images) lives here.
 */

import type { GameState, Command } from './core/game.js';
import { initialState, step, battedBallAt } from './core/game.js';
import type { PlayerId } from './core/constants.js';
import { PLAYER_IDS, PLATE_HALF_WIDTH, ZONE_BOTTOM, ZONE_TOP } from './core/constants.js';
import { vec } from './core/vec.js';
import {
  makeProjector, BATTING_CAMERA, FLIGHT_CAMERA, followCamera, lerpCamera, ease,
} from './render/camera.js';
import type { Sprites } from './render/scene.js';
import { drawScene } from './render/scene.js';

const VIEW = { width: 1280, height: 720 } as const;
const TICK = 1 / 60;
const POSES = ['stance', 'swing_0', 'swing_1', 'swing_2', 'swing_3', 'swing_4', 'back'] as const;

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
if (!canvas) throw new Error('canvas #game not found');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2d context unavailable');
canvas.width = VIEW.width;
canvas.height = VIEW.height;

let state: GameState = initialState(20260729, 'takaya');
const queue: Command[] = [];
const send = (c: Command): void => { queue.push(c); };

// ---------------------------------------------------------------------------
// sprites
// ---------------------------------------------------------------------------

const spriteCache = new Map<PlayerId, Sprites>();

const loadSprites = (id: PlayerId): Sprites => {
  const cached = spriteCache.get(id);
  if (cached) return cached;
  const set: Sprites = {};
  for (const pose of POSES) {
    const img = new Image();
    img.src = `assets/player/${id}/${pose}.png`;
    set[pose] = img;
  }
  spriteCache.set(id, set);
  return set;
};
for (const id of PLAYER_IDS) loadSprites(id);

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------

/**
 * Map the pointer onto the strike-zone plane.
 *
 * The zone is seen at an angle, so a fixed ratio would drift. Instead the
 * projected zone basis is measured each frame and inverted — one 2x2 solve.
 */
const pointerToZone = (px: number, py: number): { x: number; y: number } | null => {
  const p = makeProjector(BATTING_CAMERA, VIEW);
  const o = p.project(vec(0, (ZONE_BOTTOM + ZONE_TOP) / 2, 0));
  const ax = p.project(vec(0.1, (ZONE_BOTTOM + ZONE_TOP) / 2, 0));
  const ay = p.project(vec(0, (ZONE_BOTTOM + ZONE_TOP) / 2 + 0.1, 0));
  if (!o || !ax || !ay) return null;
  const a = (ax.x - o.x) / 0.1;
  const b = (ay.x - o.x) / 0.1;
  const c = (ax.y - o.y) / 0.1;
  const d = (ay.y - o.y) / 0.1;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return null;
  const dx = px - o.x;
  const dy = py - o.y;
  return {
    x: (d * dx - b * dy) / det,
    y: (ZONE_BOTTOM + ZONE_TOP) / 2 + (-c * dx + a * dy) / det,
  };
};

canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * VIEW.width;
  const py = ((e.clientY - r.top) / r.height) * VIEW.height;
  const z = pointerToZone(px, py);
  if (z) send({ kind: 'moveCursor', x: z.x, y: z.y });
});

canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  if (e.button === 2) send({ kind: 'pitch' });
  else send({ kind: 'swing' });
});
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); });

// WASD nudges the cursor for players who prefer the keyboard
const held = new Set<string>();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  held.add(k);
  if (k === ' ') { e.preventDefault(); send({ kind: 'swing' }); }
  if (k === 'enter') send({ kind: 'pitch' });
  const idx = ['1', '2', '3'].indexOf(k);
  if (idx >= 0) {
    const id = PLAYER_IDS[idx];
    if (id) send({ kind: 'selectPlayer', player: id });
  }
});
window.addEventListener('keyup', (e) => { held.delete(e.key.toLowerCase()); });

const applyKeyboardCursor = (): void => {
  const speed = 0.9 * TICK;
  let dx = 0;
  let dy = 0;
  if (held.has('a')) dx -= speed;
  if (held.has('d')) dx += speed;
  if (held.has('w')) dy += speed;
  if (held.has('s')) dy -= speed;
  if (dx !== 0 || dy !== 0) {
    send({ kind: 'moveCursor', x: state.cursor.x + dx, y: state.cursor.y + dy });
  }
};

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------

const cameraFor = (s: GameState) => {
  if (s.phase !== 'flight' && !(s.phase === 'result' && s.swing?.field)) {
    return BATTING_CAMERA;
  }
  const swing = s.swing;
  if (!swing || swing.trail.length === 0) return BATTING_CAMERA;
  const t = s.flightTime ?? swing.hangTime;
  const ball = battedBallAt(swing, t);
  // pull back over the first 0.45 s, then follow
  const pullBack = lerpCamera(BATTING_CAMERA, FLIGHT_CAMERA, ease(t / 0.45));
  return t < 0.45 ? pullBack : followCamera(ball);
};

let previous = 0;
let accumulator = 0;

const frame = (now: number): void => {
  if (previous === 0) previous = now;
  let elapsed = (now - previous) / 1000;
  previous = now;
  if (elapsed > 0.25) elapsed = 0.25;
  accumulator += elapsed;

  while (accumulator >= TICK) {
    applyKeyboardCursor();
    while (queue.length > 0) {
      const cmd = queue.shift();
      if (cmd) state = step(state, cmd);
    }
    state = step(state, { kind: 'tick', dt: TICK });
    accumulator -= TICK;
  }

  const projector = makeProjector(cameraFor(state), VIEW);
  drawScene(ctx, projector, state, loadSprites(state.player), VIEW);

  requestAnimationFrame(frame);
};

// cursor starts in the middle of the zone
send({ kind: 'moveCursor', x: 0, y: (ZONE_BOTTOM + ZONE_TOP) / 2 });
void PLATE_HALF_WIDTH;
requestAnimationFrame(frame);
