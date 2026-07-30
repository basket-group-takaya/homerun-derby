/**
 * Entry point: the impure shell around a pure core.
 *
 * Everything the core is forbidden to touch lives here (PROMPT.md 2) — the
 * clock, the canvas, images, audio, storage, the viewport, and input. The core
 * is advanced by a fixed 1/60 s step; nothing else is allowed to move it.
 *
 * Shape of a pitch, as the player experiences it:
 *
 *   windup (0.55 s, presentation only)
 *     -> ball in flight, behind-the-plate camera, meet cursor live
 *     -> swing: contact resolved in core; hit stop freezes the whole loop
 *     -> the pitch camera HOLDS for 0.16 s while the bat sweeps through
 *     -> pull back from the same position, then follow the ball
 *     -> landing: slow motion, dust, crowd
 *     -> result card, then the next pitch arrives on its own
 *
 * The camera never crosses the plate. It used to cut to a side view so the five
 * side-on swing sprites could play, and the batter then read as changing
 * batter's box at the moment of contact.
 *
 * The hit stop is implemented by simply not sending ticks. That works only
 * because step() is pure — there is no hidden animation clock inside the core to
 * fall out of sync with.
 */

import type { GameState, Command } from './core/game.js';
import { initialState, step, battedBallAt } from './core/game.js';
import type { PlayerId } from './core/constants.js';
import { PLAYER_IDS, ZONE_BOTTOM, ZONE_TOP, T_SWING } from './core/constants.js';
import type { RoundEvent, RoundMode } from './core/round.js';
import { GRADE_LABEL, TARGET_LABEL } from './core/round.js';
import { vec } from './core/vec.js';
import type { Camera, Viewport } from './render/camera.js';
import {
  makeProjector, PITCH_CAMERA, cameraAfterContact, shakeCamera,
  CUT_HOLD_END, CUT_PULLBACK_END,
} from './render/camera.js';
import type { BatAnchor, Sprites, ViewMode } from './render/scene.js';
import { drawScene } from './render/scene.js';
import { drawHud } from './render/hud.js';
import type { CutIn, Faces } from './render/screens.js';
import {
  cardBoxes, drawCutIn, drawShop, drawTitle, modeBox, shopBackBox, shopOpenBox,
  shopRows, soundBox,
} from './render/screens.js';
import { BATS, bankedPoints } from './core/bats.js';
import type { Save } from './storage.js';
import { loadSave, storeSave } from './storage.js';
import { createFx } from './render/fx.js';
import { createSfx } from './audio/sfx.js';

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const TICK = 1 / 60;
/** Logical width. Height follows the device so the game is always full-bleed. */
const LOGICAL_WIDTH = 720;
const MIN_ASPECT = 1.30;
const MAX_ASPECT = 2.30;

const WINDUP_SECONDS = 0.55;
const RESULT_PAUSE = 1.25;
/**
 * How long the bat takes to travel from the shoulder to the follow-through [s].
 *
 * Must outlast the batter's time on screen. The pitch camera holds for
 * CUT_HOLD_END (0.16 s) after contact and contact itself is T_SWING (0.13 s)
 * after the input, so the bat is visible for 0.29 s — at 0.22 s the sweep
 * finished early and the bat snapped back to the shoulder in shot.
 */
const SWING_ARC_SECONDS = 0.30;

const POSES = [
  'stance', 'swing_0', 'swing_1', 'swing_2', 'swing_3', 'swing_4',
  'back', 'back_cam', 'back_cam_body', 'back_cam_bat',
] as const;

// ---------------------------------------------------------------------------
// canvas
// ---------------------------------------------------------------------------

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
if (!canvas) throw new Error('canvas #game not found');
const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) throw new Error('2d context unavailable');

let view: Viewport = { width: LOGICAL_WIDTH, height: LOGICAL_WIDTH * 16 / 9 };
let insets = { top: 0, bottom: 0 };

/**
 * Read the notch inset in CSS pixels.
 *
 * Via a probe element's computed padding rather than a custom property: engines
 * disagree about whether env() is substituted before getPropertyValue sees it,
 * and a wrong answer here puts the score under the notch.
 */
const safeProbe = document.getElementById('safe');
const readInset = (side: 'paddingTop' | 'paddingBottom'): number => {
  if (!safeProbe) return 0;
  const n = Number.parseFloat(getComputedStyle(safeProbe)[side]);
  return Number.isFinite(n) ? n : 0;
};

const resize = (): void => {
  const cssW = Math.max(1, window.innerWidth);
  const cssH = Math.max(1, window.innerHeight);
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, cssH / cssW));
  view = { width: LOGICAL_WIDTH, height: Math.round(LOGICAL_WIDTH * aspect) };

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(view.width * dpr);
  canvas.height = Math.round(view.height * dpr);

  // Fit, do not stretch. The logical aspect is clamped to [1.30, 2.30] so that
  // the composition stays sane on any handset; when the real window falls
  // outside that range, filling it would squash the scene non-uniformly — which
  // is exactly what a desktop landscape window used to do. Letterbox instead.
  const fit = Math.min(cssW / view.width, cssH / view.height);
  const drawW = view.width * fit;
  const drawH = view.height * fit;
  canvas.style.width = `${drawW}px`;
  canvas.style.height = `${drawH}px`;
  canvas.style.marginLeft = `${(cssW - drawW) / 2}px`;
  canvas.style.marginTop = `${(cssH - drawH) / 2}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // CSS reports the notch in CSS pixels; convert to our logical units
  const scale = fit === 0 ? 1 : 1 / fit;
  insets = {
    top: readInset('paddingTop') * scale,
    bottom: readInset('paddingBottom') * scale,
  };
};
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => window.setTimeout(resize, 120));
resize();

// ---------------------------------------------------------------------------
// assets
// ---------------------------------------------------------------------------

const spriteCache = new Map<PlayerId, Sprites>();
let spritesPending = 0;

const loadSprites = (id: PlayerId): Sprites => {
  const cached = spriteCache.get(id);
  if (cached) return cached;
  const set: Sprites = {};
  for (const pose of POSES) {
    const img = new Image();
    spritesPending++;
    img.onload = (): void => { spritesPending--; };
    img.onerror = (): void => { spritesPending--; };
    img.src = `assets/player/${id}/${pose}.png`;
    set[pose] = img;
  }
  spriteCache.set(id, set);
  return set;
};
for (const id of PLAYER_IDS) loadSprites(id);

/**
 * Bat hinge points, fetched rather than inlined so they cannot drift away from
 * the sprites tools/make_back_camera.py generated alongside them. Until it
 * arrives — or if it never does — the batter is drawn as one piece and does not
 * swing, which is the pre-existing behaviour rather than a broken screen.
 */
let batAnchors: Partial<Record<PlayerId, BatAnchor>> = {};
void fetch('assets/player/bat_anchors.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((data: unknown) => {
    if (data && typeof data === 'object') {
      batAnchors = data as Partial<Record<PlayerId, BatAnchor>>;
    }
  })
  .catch(() => { /* offline first load, or the file is absent */ });

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

let state: GameState = initialState(Date.now() & 0x7fffffff, 'takaya');
const queue: Command[] = [];
const send = (c: Command): void => { queue.push(c); };

const fx = createFx();
const sfx = createSfx();

/**
 * The save. src/storage.ts owns every localStorage access and every one of them
 * is wrapped: in iOS Safari private browsing, TOUCHING localStorage throws, and
 * a throw during module evaluation aborts the whole ES module and leaves a black
 * canvas with nothing on screen to explain it.
 */
let save: Save = loadSave();
let best = save.bestScore;

/** Presentation-only timers, all in seconds. */
let windup = 0;
let pauseLeft = 0;
let swingArc = -1;
let scoreboardFlash = 0;
let poleFlash = 0;
let landed = false;
let lastBanked = 0;

type UiScreen = 'title' | 'shop' | 'playing';
let uiScreen: UiScreen = 'title';
let shopNotice = '';
let shopNoticeLeft = 0;
let selected: PlayerId = 'takaya';
let roundMode: RoundMode = 'classic';
let cutIn: CutIn | null = null;

const FACE_VARIANTS = ['bust', 'smile', 'thinking', 'relief', 'serious'] as const;
const faces: Faces = {};
for (const id of PLAYER_IDS) {
  for (const variant of FACE_VARIANTS) {
    const img = new Image();
    img.src = `assets/face/${id}_${variant}.png`;
    faces[`${id}_${variant}`] = img;
  }
}

const showCutIn = (variant: string, caption: string, colour: string, life = 1.6): void => {
  cutIn = { player: state.player, variant, caption, colour, life: 0, maxLife: life };
};

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------

/**
 * Map a screen point onto the strike-zone plane.
 *
 * The zone is seen nearly face-on from the pitch camera but not exactly, so a
 * fixed ratio would drift toward the edges. The projected basis is measured each
 * time and inverted — one 2x2 solve, exact for the plane.
 */
const screenToZone = (px: number, py: number): { x: number; y: number } | null => {
  const p = makeProjector(PITCH_CAMERA, view);
  const midY = (ZONE_BOTTOM + ZONE_TOP) / 2;
  const o = p.project(vec(0, midY, 0));
  const ax = p.project(vec(0.1, midY, 0));
  const ay = p.project(vec(0, midY + 0.1, 0));
  if (!o || !ax || !ay) return null;
  const a = (ax.x - o.x) / 0.1;
  const b = (ay.x - o.x) / 0.1;
  const c = (ax.y - o.y) / 0.1;
  const d = (ay.y - o.y) / 0.1;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return null;
  const dx = px - o.x;
  const dy = py - o.y;
  return { x: (d * dx - b * dy) / det, y: midY + (-c * dx + a * dy) / det };
};

/** Metres of cursor travel per logical pixel of drag, at the zone plane. */
const dragGain = (): number => {
  const z = screenToZone(view.width / 2 + 100, view.height / 2);
  const o = screenToZone(view.width / 2, view.height / 2);
  return z && o ? Math.abs(z.x - o.x) / 100 : 0.0015;
};

const toLogical = (e: PointerEvent): { x: number; y: number } => {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * view.width,
    y: ((e.clientY - r.top) / r.height) * view.height,
  };
};

type Touch = { id: number; x: number; y: number; startedAt: number; moved: number };
let aim: Touch | null = null;

/**
 * What separates a tap (swing) from a drag (aim).
 *
 * In LOGICAL pixels, and the logical width is 720 while a phone is around 390
 * CSS pixels wide — so a threshold of 12 logical px is 6.5 real pixels, tighter
 * than a finger can hold still. At that value a deliberate tap registered as a
 * drag and the swing never fired. 26 logical px is about 14 real pixels, which
 * is the usual touch-slop figure.
 */
const TAP_MOVE = 26;
const TAP_MS = 300;

const doSwing = (): void => {
  sfx.unlock();
  if (state.phase === 'roundOver') {
    // back to the select screen: choosing who bats is half the point of having
    // three players, and burying it behind a menu means nobody ever changes
    uiScreen = 'title';
    fx.reset();
    cutIn = null;
    return;
  }
  if (state.phase === 'pitching') {
    swingArc = 0;
    send({ kind: 'swing' });
  } else if (state.phase === 'result' || state.phase === 'ready') {
    pauseLeft = 0; // skip the wait and bring the next pitch now
  }
};

/**
 * Go full-screen and pin the orientation.
 *
 * Both need a user gesture, and both are allowed to fail: iOS Safari has no
 * Fullscreen API on iPhone, and orientation.lock throws unless the document is
 * already full-screen or installed. Failure is fine — the layout is portrait
 * either way, and the CSS rotate prompt covers the rest.
 */
const goFullscreen = (): void => {
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void>;
  };
  try {
    if (!document.fullscreenElement) {
      const request = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
      // The rejection MUST be swallowed here, not left to a global handler.
      // Chrome rejects with "Permissions check failed" inside an extension
      // context and iOS Safari has no API at all; either way it is harmless, and
      // an unhandled rejection tripped the boot-error overlay and hid the game
      // behind a false "failed to start" card.
      const promise = request?.call(el) as Promise<void> | undefined;
      if (promise && typeof promise.catch === 'function') promise.catch(() => { /* denied */ });
    }
  } catch { /* unsupported */ }
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (o: string) => Promise<void>;
  };
  try {
    const locked = orientation.lock?.('portrait');
    if (locked && typeof locked.catch === 'function') locked.catch(() => { /* denied */ });
  } catch { /* no ScreenOrientation on iOS Safari */ }
};

/** Tap handling on the title screen: pick a mode, or pick a player and play. */
const titleTap = (px: number, py: number): void => {
  const shopBtn = shopOpenBox(view, insets);
  if (px >= shopBtn.x && px <= shopBtn.x + shopBtn.w
      && py >= shopBtn.y && py <= shopBtn.y + shopBtn.h) {
    uiScreen = 'shop';
    shopNotice = '';
    sfx.blip(520, 0.10);
    return;
  }
  const sb = soundBox(view, insets);
  if (px >= sb.x && px <= sb.x + sb.w && py >= sb.y && py <= sb.y + sb.h) {
    sfx.setMuted(!sfx.isMuted());
    if (!sfx.isMuted()) sfx.blip(720, 0.10);
    return;
  }
  const m = modeBox(view, insets);
  if (px >= m.x && px <= m.x + m.w && py >= m.y && py <= m.y + m.h) {
    roundMode = px < m.x + m.w / 2 ? 'classic' : 'arcade';
    sfx.blip(660, 0.08);
    return;
  }
  for (const box of cardBoxes(view, insets)) {
    if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
      selected = box.player;
      state = initialState(Date.now() & 0x7fffffff, selected, roundMode, save.equipped);
      fx.reset();
      cutIn = null;
      previousEvent = null;
      previousPhase = state.phase;
      landed = false;
      pauseLeft = 0.35;
      windup = 0;
      uiScreen = 'playing';
      sfx.blip(880, 0.12);
      sfx.crowd(0.35, 1.6);
      return;
    }
  }
};

/**
 * Shop taps: buy what is not owned and affordable, equip what is owned.
 *
 * Buying and equipping are the same gesture on purpose. A separate "equip" step
 * after a purchase is a screen nobody wants to read, and there is no case where
 * a player buys a bat and does not want to try it.
 */
const shopTap = (px: number, py: number): void => {
  const back = shopBackBox(view, insets);
  if (px >= back.x && px <= back.x + back.w && py >= back.y && py <= back.y + back.h) {
    uiScreen = 'title';
    sfx.blip(420, 0.10);
    return;
  }
  for (const row of shopRows(view, insets)) {
    if (px < row.x || px > row.x + row.w || py < row.y || py > row.y + row.h) continue;
    const spec = BATS[row.bat];
    if (save.bats.includes(row.bat)) {
      if (save.equipped !== row.bat) {
        save = { ...save, equipped: row.bat };
        storeSave(save);
        state = step(state, { kind: 'equipBat', bat: row.bat });
        shopNotice = `${spec.name} を装備しました`;
        shopNoticeLeft = 2.2;
        sfx.blip(900, 0.12);
      }
      return;
    }
    if (save.points >= spec.price) {
      save = {
        ...save,
        points: save.points - spec.price,
        bats: [...save.bats, row.bat],
        equipped: row.bat,
      };
      storeSave(save);
      state = step(state, { kind: 'equipBat', bat: row.bat });
      shopNotice = `${spec.name} を購入して装備しました`;
      shopNoticeLeft = 2.6;
      sfx.fanfare();
    } else {
      shopNotice = `ポイントが ${(spec.price - save.points).toLocaleString()} PT 足りません`;
      shopNoticeLeft = 2.2;
      sfx.blip(220, 0.08);
    }
    return;
  }
};

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  sfx.unlock();
  goFullscreen();
  if (uiScreen === 'title') {
    const p = toLogical(e);
    titleTap(p.x, p.y);
    return;
  }
  if (uiScreen === 'shop') {
    const p = toLogical(e);
    shopTap(p.x, p.y);
    return;
  }
  if (aim === null) {
    canvas.setPointerCapture(e.pointerId);
    aim = { id: e.pointerId, x: toLogical(e).x, y: toLogical(e).y, startedAt: performance.now(), moved: 0 };
  } else {
    // a second finger while aiming: swing immediately
    doSwing();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!aim || e.pointerId !== aim.id) return;
  const p = toLogical(e);
  const dx = p.x - aim.x;
  const dy = p.y - aim.y;
  aim.moved += Math.hypot(dx, dy);
  aim.x = p.x; aim.y = p.y;
  const g = dragGain();
  send({ kind: 'moveCursor', x: state.cursor.x + dx * g, y: state.cursor.y - dy * g });
});

const endPointer = (e: PointerEvent): void => {
  if (!aim || e.pointerId !== aim.id) return;
  const quick = performance.now() - aim.startedAt < TAP_MS;
  const still = aim.moved < TAP_MOVE;
  aim = null;
  if (quick && still) doSwing();
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); });

// desktop conveniences; the phone build never sees these
const held = new Set<string>();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  held.add(k);
  if (k === ' ' || k === 'enter') { e.preventDefault(); doSwing(); }
  if (k === 'r') send({ kind: 'newRound' });
  if (k === 'm') sfx.setMuted(!sfx.isMuted());
  const idx = ['1', '2', '3'].indexOf(k);
  if (idx >= 0) {
    const id = PLAYER_IDS[idx];
    if (id) { send({ kind: 'selectPlayer', player: id }); fx.reset(); }
  }
});
window.addEventListener('keyup', (e) => { held.delete(e.key.toLowerCase()); });

const applyKeyboardCursor = (): void => {
  const speed = 0.85 * TICK;
  let dx = 0;
  let dy = 0;
  if (held.has('a') || held.has('arrowleft')) dx -= speed;
  if (held.has('d') || held.has('arrowright')) dx += speed;
  if (held.has('w') || held.has('arrowup')) dy += speed;
  if (held.has('s') || held.has('arrowdown')) dy -= speed;
  if (dx !== 0 || dy !== 0) {
    send({ kind: 'moveCursor', x: state.cursor.x + dx, y: state.cursor.y + dy });
  }
};

// ---------------------------------------------------------------------------
// reacting to what the core just decided
// ---------------------------------------------------------------------------

const contactPoint = (): { at: ReturnType<typeof vec>; dir: ReturnType<typeof vec> } => {
  const swing = state.swing;
  const at = vec(state.cursor.x, swing?.contact.contactHeight ?? 0.9, 0);
  if (!swing || swing.trail.length < 2) return { at, dir: vec(0, 0.4, 1) };
  const a = swing.trail[0] ?? at;
  const b = swing.trail[1] ?? at;
  const d = vec(b.x - a.x, b.y - a.y, b.z - a.z);
  const n = Math.hypot(d.x, d.y, d.z) || 1;
  return { at, dir: vec(d.x / n, d.y / n, d.z / n) };
};

const announce = (e: RoundEvent): void => {
  const swing = state.swing;
  const gradeColour: Record<string, string> = {
    perfect: '255,215,106', great: '143,227,255', good: '201,227,255',
    weak: '168,182,204', miss: '141,151,171',
  };

  if (e.outcome === 'whiff') {
    fx.whiff(vec(state.cursor.x, state.cursor.y, 0));
    sfx.whiff();
    fx.telop(GRADE_LABEL.miss, {
      size: view.width * 0.10, colour: gradeColour.miss ?? '255,255,255', band: 0.42,
    });
    return;
  }
  if (e.outcome === 'take') {
    sfx.mitt();
    if (e.out) {
      fx.telop('見逃しストライク', {
        size: view.width * 0.058, colour: '255,140,140', band: 0.42,
      });
    }
    return;
  }

  const { at, dir } = contactPoint();
  const quality = e.grade === 'perfect' || e.grade === 'great'
    ? 'just' : e.grade === 'good' ? 'good' : 'poor';
  fx.impact({ at, dir, quality, exitVelocity: swing?.contact.exitVelocity ?? 30 });
  sfx.crack(
    e.grade === 'perfect' ? 'just'
      : e.grade === 'great' ? 'just'
        : e.grade === 'good' ? 'good'
          : e.outcome === 'foul' ? 'foul' : 'poor',
    Math.min(1, ((swing?.contact.exitVelocity ?? 25) - 22) / 28));

  fx.telop(GRADE_LABEL[e.grade], {
    size: view.width * (e.grade === 'perfect' ? 0.13 : 0.10),
    colour: gradeColour[e.grade] ?? '255,255,255',
    life: 0.9,
    band: 0.42,
  });
  if (e.multiplier > 1 && e.gained > 0) {
    fx.telop(`x${e.multiplier} BONUS`, {
      size: view.width * 0.062, colour: '255,170,80', life: 1.2, rise: 60, band: 0.50,
    });
  }
};

const announceLanding = (e: RoundEvent): void => {
  const swing = state.swing;
  if (!swing || !swing.field) return;
  const landing = battedBallAt(swing, swing.hangTime);
  const homeRun = e.outcome === 'homeRun';

  fx.land({ at: landing, homeRun, distance: e.distance });
  sfx.thud(homeRun);

  if (e.target) {
    if (e.target === 'scoreboard') scoreboardFlash = 1; else poleFlash = 1;
    fx.telop(TARGET_LABEL[e.target], {
      size: view.width * 0.075, colour: '255,214,110', life: 1.5, rise: 40, band: 0.44,
    });
    sfx.fanfare();
  }

  if (homeRun) {
    sfx.crowd(e.titanic ? 1 : 0.75, e.titanic ? 3.2 : 2.4);
    // Cut-ins are reserved for home runs and personal bests. Firing one on
    // every swing would make the thing that says "that mattered" say nothing.
    if (e.titanic) showCutIn('bust', '特大弾！', '255,150,60', 2.0);
    else if (state.round.streak >= 3) showCutIn('bust', `${state.round.streak} 連発`, '255,215,106', 1.7);
    else showCutIn('bust', 'ホームラン', '255,215,106', 1.5);
    fx.telop(`${e.distance.toFixed(1)} m`, {
      at: landing, size: view.width * 0.085, colour: '255,236,180', life: 1.8, rise: 80,
    });
    fx.telop(e.titanic ? '特大ホームラン！' : 'ホームラン！', {
      size: view.width * 0.095, colour: '255,215,106', life: 1.6, band: 0.315,
    });
    if (e.gained > 0) {
      fx.telop(`+${e.gained}`, {
        size: view.width * 0.070, colour: '255,255,255', life: 1.4, rise: 50, band: 0.385,
      });
    }
    if (e.titanic) sfx.fanfare();
  } else if (e.outcome === 'offTheWall') {
    sfx.crowd(0.5, 1.4);
    fx.telop('フェンス直撃', {
      size: view.width * 0.060, colour: '200,225,255', life: 1.2, band: 0.42,
    });
  }
};

/** Watch for core transitions and fire the presentation off them. */
let previousPhase = state.phase;
let previousEvent: RoundEvent | null = null;

const reactToTransitions = (): void => {
  const e = state.lastEvent;
  if (e && e !== previousEvent) {
    previousEvent = e;
    landed = false;
    announce(e);
    if (e.outcome === 'whiff' || e.outcome === 'take' || e.outcome === 'foul') {
      pauseLeft = RESULT_PAUSE;
    }
  }

  // the ball has come down
  if (!landed && state.swing?.field && state.flightTime !== null
      && state.flightTime >= state.swing.hangTime - 1e-6) {
    landed = true;
    if (previousEvent) announceLanding(previousEvent);
    pauseLeft = RESULT_PAUSE + (previousEvent?.outcome === 'homeRun' ? 0.9 : 0);
  }

  // slow the descent of a home run so the landing can be seen
  const swing = state.swing;
  if (swing?.field && state.phase === 'flight' && state.flightTime !== null) {
    const remaining = swing.hangTime - state.flightTime;
    if (remaining < 0.55 && remaining > 0 && swing.field.outcome === 'homeRun') {
      fx.slowMotion(0.4, remaining + 0.1);
    }
  }

  if (previousPhase !== 'roundOver' && state.phase === 'roundOver') {
    // Bank the round. The points multiplier applies HERE, to the banked total,
    // and never to the round score on screen — otherwise the score a player
    // compares against their best would depend on which bat they held.
    const gained = bankedPoints(state.round.score, BATS[state.bat]);
    lastBanked = gained;
    save = {
      ...save,
      points: save.points + gained,
      earned: save.earned + gained,
      rounds: save.rounds + 1,
      homeRuns: save.homeRuns + state.round.homeRuns,
      bestScore: Math.max(save.bestScore, state.round.score),
      bestDistance: Math.max(save.bestDistance, Math.round(state.round.longest)),
    };
    storeSave(save);
    if (state.round.score > best) {
      best = state.round.score;
      sfx.fanfare();
      showCutIn('bust', '自己ベスト更新', '143,227,255', 2.2);
    }
    sfx.crowd(0.6, 2.6);
  }
  if (previousPhase === 'roundOver' && state.phase !== 'roundOver') {
    fx.reset();
    pauseLeft = 0.4;
  }
  previousPhase = state.phase;
};

// ---------------------------------------------------------------------------
// camera
// ---------------------------------------------------------------------------

const viewMode = (): ViewMode => {
  const t = sinceContact();
  if (t === null) return 'pitch';
  return t <= CUT_HOLD_END ? 'pitch' : 'flight';
};

/** The batter fades out as the camera pulls back, rather than popping. */
const batterFade = (): number => {
  const t = sinceContact();
  if (t === null) return 1;
  if (t <= CUT_HOLD_END) return 1;
  return Math.max(0, 1 - ((t - CUT_HOLD_END) / (CUT_PULLBACK_END - CUT_HOLD_END)) * 2.2);
};

const sinceContact = (): number | null => {
  if (!state.swing || !state.swing.field) return null;
  return state.flightTime ?? 0;
};

const cameraNow = (): Camera => {
  const t = sinceContact();
  if (t === null) return PITCH_CAMERA;
  const swing = state.swing;
  if (!swing) return PITCH_CAMERA;
  return cameraAfterContact(t, battedBallAt(swing, t));
};

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------

/**
 * Development hook: ?auto swings by itself, ?auto=-2 swings two frames early.
 *
 * PROMPT.md 3-8 requires judging the swing, the camera cut and the landing by
 * eye in a real browser. Those all happen inside a 200 ms window, which a human
 * (or a screenshot tool) cannot reliably click into. This makes the moment
 * reproducible. It is inert unless the query string asks for it.
 *
 *   ?auto         swing at the optimal instant
 *   ?auto=-2      swing two frames early
 *   ?dev          expose the hooks WITHOUT auto-swinging, for UI checks
 *   ?p=yuki       start as a different player
 *
 * hrdStep() exists because requestAnimationFrame is frozen in a background tab.
 * That is correct behaviour for a game and completely defeats screenshot-based
 * verification, which cannot hold window focus — a tap changes the state and the
 * screen simply never repaints.
 */
const params = new URLSearchParams(window.location.search);
const autoParam = params.get('auto');
const autoSwing = params.has('auto');
const devHooks = autoSwing || params.has('dev');
const autoOffsetFrames = Number.parseFloat(autoParam ?? '0') || 0;
const startPlayer = params.get('p');
if (startPlayer && (PLAYER_IDS as readonly string[]).includes(startPlayer)) {
  state = initialState(Date.now() & 0x7fffffff, startPlayer as PlayerId);
}
if (autoSwing) {
  uiScreen = 'playing';
  selected = state.player;
}

if (devHooks) {
  // a read-only window onto the loop, so a browser session can assert on the
  // same numbers the tests do. Only ever attached under ?auto.
  (window as unknown as Record<string, unknown>).hrd = (): unknown => ({
    phase: state.phase, time: state.time, pitchCount: state.pitchCount,
    round: state.round, lastEvent: state.lastEvent,
    windup, pauseLeft, uiScreen, hitStop: fx.hitStop(), scale: fx.timeScale(),
    crossTime: state.flight?.crossTime ?? null,
  });
}

const runAutoSwing = (): void => {
  if (!autoSwing || state.phase !== 'pitching' || !state.flight) return;
  // aim as well as time it: a perfectly timed swing at a cursor that never moved
  // is still a whiff, which tells us nothing about the flight or the camera
  const flight = state.flight;
  const target = flight.crossPoint;
  if (state.cursor.x !== target.x || state.cursor.y !== target.y) {
    state = step(state, { kind: 'moveCursor', x: target.x, y: target.y });
  }
  const ideal = flight.crossTime - T_SWING + autoOffsetFrames * TICK;
  if (state.time >= ideal && state.time < ideal + TICK) {
    swingArc = 0;
    state = step(state, { kind: 'swing' });
  }
};

let previous = 0;
let accumulator = 0;

const advance = (dt: number): void => {
  // presentation timers run on real time even while the core is frozen
  fx.update(dt);
  if (cutIn) {
    cutIn.life += dt;
    if (cutIn.life >= cutIn.maxLife) cutIn = null;
  }
  if (shopNoticeLeft > 0) {
    shopNoticeLeft -= dt;
    if (shopNoticeLeft <= 0) shopNotice = '';
  }
  if (uiScreen === 'title' || uiScreen === 'shop') return;
  scoreboardFlash = Math.max(0, scoreboardFlash - dt * 1.2);
  poleFlash = Math.max(0, poleFlash - dt * 1.2);
  if (swingArc >= 0) {
    // held at 1, not reset: the bat stays where the swing left it until the next
    // pitch, instead of springing back to the shoulder while still on screen
    swingArc = Math.min(1, swingArc + dt / SWING_ARC_SECONDS);
  }

  if (fx.hitStop() > 0) return;

  const scale = fx.timeScale();

  applyKeyboardCursor();
  while (queue.length > 0) {
    const cmd = queue.shift();
    if (cmd) state = step(state, cmd);
  }

  if (state.phase === 'ready' || state.phase === 'result') {
    pauseLeft -= dt;
    if (pauseLeft <= 0) {
      windup += dt;
      if (windup >= WINDUP_SECONDS) {
        windup = 0;
        swingArc = -1;
        state = step(state, { kind: 'pitch' });
        sfx.blip(300, 0.05);
      }
    }
  } else {
    windup = 0;
  }

  state = step(state, { kind: 'tick', dt: dt * scale });
  runAutoSwing();
  reactToTransitions();
};

const render = (): void => {
  if (uiScreen === 'title') {
    drawTitle(ctx, view, insets, faces, selected, roundMode, best, sfx.isMuted(),
      save.points, BATS[save.equipped].name);
    return;
  }
  if (uiScreen === 'shop') {
    drawShop(ctx, view, insets, save, shopNotice);
    return;
  }

  const projector = makeProjector(shakeCamera(cameraNow(), fx.shake()), view);
  const mode = viewMode();
  const streak = state.round.streak;

  drawScene(ctx, projector, state, loadSprites(state.player), view, {
    mode,
    sinceContact: sinceContact(),
    // 0 -> 0.82 while winding up, so the release pose lands exactly when the
    // ball appears; then 0.82 -> 1 over the first quarter second of the pitch so
    // the follow-through plays out instead of snapping
    windup: state.phase === 'pitching'
      ? Math.min(1, 0.82 + state.time * 0.72)
      : Math.min(0.82, (windup / WINDUP_SECONDS) * 0.82),
    swingArc,
    stadium: { scoreboardFlash, poleFlash },
    batterFade: batterFade(),
    hot: streak >= 2 ? Math.min(1, (streak - 1) / 2) : 0,
    batAnchor: batAnchors[state.player] ?? null,
  });
  fx.drawWorld(ctx, projector);
  drawHud(ctx, state, view, insets, best, lastBanked, save.points);
  if (cutIn) drawCutIn(ctx, view, faces, cutIn);
  fx.drawScreen(ctx, projector, view);
};

const frame = (now: number): void => {
  if (previous === 0) previous = now;
  let elapsed = (now - previous) / 1000;
  previous = now;
  if (elapsed > 0.25) elapsed = 0.25;
  accumulator += elapsed;

  let guard = 0;
  while (accumulator >= TICK && guard++ < 8) {
    advance(TICK);
    accumulator -= TICK;
  }

  render();
  requestAnimationFrame(frame);
};

if (devHooks) {
  /**
   * Advance the game by hand, N ticks at a time, and redraw.
   *
   * requestAnimationFrame is frozen in a background tab, which is correct
   * behaviour for a game but makes the browser check in PROMPT.md 3-8
   * impossible to perform from a tool that does not hold window focus. This
   * drives the same advance() the real loop drives, so what gets screenshotted
   * is the real game, not a mock.
   */
  (window as unknown as Record<string, unknown>).hrdStep = (n = 1): unknown => {
    for (let i = 0; i < n; i++) advance(TICK);
    render();
    return { phase: state.phase, t: state.time, ft: state.flightTime, score: state.round.score };
  };
}

send({ kind: 'moveCursor', x: 0, y: (ZONE_BOTTOM + ZONE_TOP) / 2 });
// tells the boot watchdog in index.html that the loop actually started
(window as unknown as Record<string, unknown>).__hrdBooted = true;
requestAnimationFrame(frame);
