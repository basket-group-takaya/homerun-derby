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
import { PLAYER_IDS, PLAYERS, ZONE_BOTTOM, ZONE_TOP, T_SWING } from './core/constants.js';
import type { RoundEvent, RoundMode } from './core/round.js';
import { GRADE_LABEL, TARGET_LABEL } from './core/round.js';
import { vec } from './core/vec.js';
import type { Camera, Viewport } from './render/camera.js';
import {
  makeProjector, PITCH_CAMERA, cameraAfterContact, shakeCamera,
  CUT_HOLD_END, CUT_PULLBACK_END,
} from './render/camera.js';
import type { Sprites, ViewMode } from './render/scene.js';
import { drawScene } from './render/scene.js';
import { DELIVERY_SECONDS } from './render/pitcher.js';
import { drawHud, resultCardVisible } from './render/hud.js';
import type { CutIn, Faces } from './render/screens.js';
import {
  cardBoxes, dayBox, drawCutIn, drawShop, drawTitle, modeBox, pitcherBoxes, shopBackBox,
  shopListBottom, shopListTop, shopOpenBox, shopRows, shopScrollMax, soundBox,
} from './render/screens.js';
import { BATS, bankedPoints } from './core/bats.js';
import { batsGained, levelOf, levelProgress } from './core/level.js';
import type { PlayerSave, Save } from './storage.js';
import { batsFor, loadSave, storeSave, withPlayer } from './storage.js';
import type { SpecialId } from './core/ability.js';
import { SPECIAL_NAME, specialXp, specialsAt } from './core/ability.js';
import { PITCHERS } from './core/pitchers.js';
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

/**
 * How much finer than the display to render, and the ceiling on it. 【調整可】
 *
 * 1.15 is enough headroom for diagonal edges to anti-alias without the cost of
 * a full 2x. The cap stops a very large desktop window from asking for a canvas
 * that no phone would ever need and that would halve the frame rate to draw.
 */
const RENDER_SUPERSAMPLE = 1.15;
const MAX_RENDER_SCALE = 3;

/**
 * How long the pitcher's delivery takes, from first movement to release [s].
 *
 * 0.55 was roughly two and a half times too fast. A real delivery — gather, leg
 * lift, the arm breaking down and back, cocking, coming over the top — takes
 * about 1.2 to 1.5 seconds, and the whole of it was being played in half of
 * that. The owner reported it as two separate complaints, 「1球ごとに投げる
 * タイミングが早すぎる」 and 「投げるモーションが明らかにおかしい」, and they
 * were the same fault: an arm moving too fast to read does not look fast, it
 * looks broken.
 */
const WINDUP_SECONDS = DELIVERY_SECONDS;
/**
 * How long the result stands before the next pitch is set up [s].
 *
 * The whole gap between two pitches is this plus RESET_SECONDS (the batter
 * unwinding) plus WINDUP_SECONDS (the pitcher's delivery). It went to 1.55 when
 * the owner asked for a beat after contact, and came back to 1.25 when the
 * delivery itself slowed from 0.55 s to 1.25 s — the beat is now IN the pitch,
 * where it reads as a pitcher taking his time rather than as dead air.
 */
const RESULT_PAUSE = 1.25;

/**
 * Extra time after a ball that was actually STRUCK, on top of RESULT_PAUSE.
 *
 * A swing and a miss is over the moment it happens. A batted ball is not: the
 * camera has travelled downfield, the ball has landed, a number has come up,
 * and the eye has to come back to the plate before anything else can be asked
 * of it. That return trip is what the owner was missing.
 */
const CONTACT_SETTLE = 0.75;

/** And a home run gets longer still. It is the thing the game is about. */
const HOME_RUN_SETTLE = 0.9;

/**
 * The shortest the wait can be cut to by an impatient tap [s].
 *
 * NOT zero, which is what it was. With one button, tapping is the only thing a
 * player ever does, so tapping again after a hit is a reflex rather than a
 * request — and it was skipping the entire pause and firing the next pitch at
 * once. A tap may still hurry the game along; it may no longer erase the beat.
 */
const MIN_PAUSE_AFTER_TAP = 0.45;
/**
 * How long the bat takes to travel from the shoulder to the follow-through [s].
 *
 * Must outlast the batter's time on screen. The pitch camera holds for
 * CUT_HOLD_END (0.16 s) after contact and contact itself is T_SWING (0.13 s)
 * after the input, so the bat is visible for 0.29 s — at 0.22 s the sweep
 * finished early and the bat snapped back to the shoulder in shot.
 */
const SWING_ARC_SECONDS = 0.30;

/**
 * How long the batter takes to come back to his stance after a swing [s].
 *
 * Without this the bat sat frozen at the end of the follow-through for the whole
 * result pause, and then the pitcher started his wind-up with the batter still
 * finished — so the next pitch arrived at somebody who had never reset. The
 * owner reported it as 「空振りした後の次も、ちゃんとピッチャーもバッターも
 * 構えてから、もう一度投げる形に」.
 *
 * The order now is: hold the finish while the result reads, unwind to the
 * stance, THEN let the pitcher gather. The pitcher waiting on the batter is the
 * right way round — it is what a pitcher does.
 */
const RESET_SECONDS = 0.34;

/**
 * How long everyone stands still after the camera has cut back [s].
 *
 * The camera used to FLY back from the outfield over 0.65 s. The owner watched
 * it and said the trip itself was not wanted — 「距離を見てからバッターボックス
 * に戻る演出は、なしでいい」 — but that the pitcher then started too soon.
 *
 * So the journey is gone and the time went into standing still instead. A cut
 * is instant, and then nothing happens for about two beats: the batter is in
 * the box, the pitcher is on the mound, and neither moves. That reads as a
 * pitcher taking his time, which a camera move never did — it read as the game
 * making the player wait for a transition.
 *
 * The order is now: hold the result, cut, batter resets, EVERYBODY WAITS,
 * pitcher gathers, throw. Each waits for the one before it.
 */
const SET_PAUSE = 1.1;

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

/**
 * The area that is ACTUALLY VISIBLE, in CSS pixels.
 *
 * Not window.innerHeight. On a phone that reports the LARGE viewport — the
 * height the page would have if the browser's toolbars were hidden — while the
 * URL bar is still sitting on top of the bottom of it. Sizing to it puts the
 * bottom of the game underneath the browser chrome, which is exactly the
 * symptom the owner reported: swing on a phone and the bottom of the screen
 * runs off the edge. It shows up on the swing specifically because the tap is
 * what asks for fullscreen and makes the toolbars move.
 *
 * visualViewport is the visible area and nothing else, and it updates when the
 * toolbars slide, when the keyboard opens, and when the user pinches.
 */
const viewportSize = (): { readonly w: number; readonly h: number } => {
  const vv = window.visualViewport;
  return {
    w: Math.max(1, Math.round(vv ? vv.width : window.innerWidth)),
    h: Math.max(1, Math.round(vv ? vv.height : window.innerHeight)),
  };
};

const resize = (): void => {
  const { w: cssW, h: cssH } = viewportSize();
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, cssH / cssW));
  view = { width: LOGICAL_WIDTH, height: Math.round(LOGICAL_WIDTH * aspect) };

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

  /*
   * THE BACKING STORE IS SIZED FROM WHAT IS DISPLAYED, NOT FROM THE LOGICAL SIZE.
   *
   * It used to be `view.width * min(2, dpr)`, which sounds right and is not: the
   * logical size is 720 wide whatever the screen, and the canvas is then
   * STRETCHED by CSS to whatever the window can give it. On a 935-px-wide window
   * at dpr 1 that meant drawing 720 pixels and blowing them up to 935 — a
   * measured supersample of 0.77, i.e. the game was rendering at 77% of the
   * resolution it was being shown at and the browser was interpolating the rest.
   * That is a direct, measurable cause of the softness the owner is asking about,
   * and no amount of art fixes it.
   *
   * The right number is (displayed CSS pixels x device pixel ratio), which is the
   * real pixel grid the game lands on, plus a little headroom so diagonal edges
   * have somewhere to anti-alias.
   */
  const dpr = window.devicePixelRatio || 1;
  const scale = Math.min(
    MAX_RENDER_SCALE, ((drawW * dpr) / view.width) * RENDER_SUPERSAMPLE);
  canvas.width = Math.round(view.width * scale);
  canvas.height = Math.round(view.height * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // CSS reports the notch in CSS pixels; convert to our logical units
  const cssToLogical = fit === 0 ? 1 : 1 / fit;
  insets = {
    top: readInset('paddingTop') * cssToLogical,
    bottom: readInset('paddingBottom') * cssToLogical,
  };
};
/**
 * Re-fit now, and again after the browser has finished moving.
 *
 * Toolbars slide, fullscreen animates, and an orientation change is not one
 * event but a sequence. Measuring once, at the moment the event fires, measures
 * the middle of the transition — and then the layout is wrong until something
 * else happens to trigger another measurement.
 */
const refit = (): void => {
  resize();
  window.setTimeout(resize, 120);
  window.setTimeout(resize, 420);
};

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', refit);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resize);
  // The visual viewport SCROLLS when the toolbars slide, without resizing.
  window.visualViewport.addEventListener('scroll', resize);
}
document.addEventListener('fullscreenchange', refit);
document.addEventListener('webkitfullscreenchange' as 'fullscreenchange', refit);
// iOS fires neither of the above reliably; a first paint after load catches it.
window.addEventListener('load', refit);
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
 * The company logo, worn on the batter's back.
 *
 * Cut out of the character art by tools/make_logo.py and never redrawn:
 * PROMPT.md 0-4 allows the logo but forbids altering it. Local file, so
 * PROMPT.md 1's ban on fetching art from the network is respected.
 */
const logoBack: HTMLImageElement = new Image();
logoBack.src = 'assets/logo_back.png';

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
/** Counts down while the batter unwinds back to his stance. */
let resetLeft = 0;
/** Where the swing had got to when the unwind started, so it eases from there. */
let resetFrom = 1;
/** Counts down while the camera flies back from the outfield to the plate. */
/** Counts down while everyone stands set, before the pitcher starts. */
let setLeft = 0;
/** Set once the camera is home, so it stays there until the next ball is struck. */
let cameraHome = false;
let scoreboardFlash = 0;
let poleFlash = 0;
let landed = false;
let lastBanked = 0;

/** The slot for whoever is batting. Everything progression-shaped reads this. */
const slot = (id: PlayerId = selected): PlayerSave => save.players[id];
const levelFor = (id: PlayerId = selected): number => levelOf(slot(id).xp);
/** Level-up banner state. Presentation only; the level itself lives in the save. */
let levelUpTo = 0;
let levelUpBats: readonly string[] = [];
let levelUpSpecials: readonly SpecialId[] = [];
let levelUpLeft = 0;


type UiScreen = 'title' | 'shop' | 'playing';
let uiScreen: UiScreen = 'title';
let shopNotice = '';
/** How far the bat shelf is scrolled [logical px], and the drag that moves it. */
let shopScroll = 0;
/**
 * First-run coaching, shown once and then never again.
 *
 * The game has exactly one control and one rule that is not obvious — do not
 * swing at the fork — and neither was written down anywhere the player would
 * see. Three lines on the first pitch is the difference between a toy somebody
 * can be handed and one that has to be explained.
 */
let coachLeft = 0;
let coachShown = false;

/**
 * Paused, and the two buttons the pause screen offers.
 *
 * A round is ten outs and there is no way to stop in the middle of one, which
 * is fine at a desk and not fine on a phone: the game is played standing up, in
 * a gap, and gaps end without warning. Pausing has to be reachable without
 * hitting swing by mistake, so the button sits in the strip beside the swing
 * button rather than anywhere a thumb travels through.
 */
let paused = false;

const pauseButton = (): { x: number; y: number; w: number; h: number } => {
  const b = swingButton(view, insets.bottom);
  const size = Math.min(view.width * 0.135, b.h * 1.05);
  return { x: view.width * 0.045, y: b.y + (b.h - size) / 2, w: size, h: size };
};

/** The two choices on the pause screen. */
const resumeButton = (): { x: number; y: number; w: number; h: number } => ({
  x: view.width * 0.18, y: view.height * 0.46, w: view.width * 0.64, h: view.width * 0.135,
});

const quitButton = (): { x: number; y: number; w: number; h: number } => ({
  x: view.width * 0.18, y: view.height * 0.46 + view.width * 0.185,
  w: view.width * 0.64, h: view.width * 0.135,
});
let dragFrom: { y: number; scroll: number } | null = null;
let dragged = 0;
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

const toLogical = (e: PointerEvent): { x: number; y: number } => {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * view.width,
    y: ((e.clientY - r.top) / r.height) * view.height,
  };
};

/**
 * The swing button, in logical pixels.
 *
 * There IS a button, and the whole screen is also the button. The drawn one
 * tells a first-time player what to do and gives the thumb a place to rest; the
 * whole-screen fallback means a panicked tap anywhere still swings, which
 * matters when the decision window is about 400 ms. Bottom-centre and large,
 * because that is where a thumb already is on a phone held one-handed.
 */
export const SWING_BAND = 0.21;

export const swingButton = (
  v: { width: number; height: number }, bottomInset: number,
): { x: number; y: number; w: number; h: number } => {
  const w = v.width * 0.62;
  const h = v.width * 0.135;
  return {
    x: (v.width - w) / 2,
    y: v.height - bottomInset - v.width * 0.175,
    w,
    h,
  };
};

const swingNow = (): void => {
  swingArc = 0;
  send({ kind: 'swing' });
};

const doSwing = (): void => {
  if (coachLeft > 0) { coachLeft = 0; return; }
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
    swingNow();
  } else if (state.phase === 'result' || state.phase === 'ready') {
    // Hurry the wait along, but never erase it. See MIN_PAUSE_AFTER_TAP.
    pauseLeft = Math.min(pauseLeft, MIN_PAUSE_AFTER_TAP);
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
/**
 * Asked for once, not on every tap.
 *
 * Requesting fullscreen again while already in it is harmless but not free: on
 * a phone it can restart the toolbar animation, which moves the visible area
 * under the game mid-swing. Once is enough; if it was refused the first time it
 * will be refused every time.
 */
let fullscreenAsked = false;

const goFullscreen = (): void => {
  if (fullscreenAsked) return;
  fullscreenAsked = true;
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
  const d = dayBox(view, insets);
  if (px >= d.x && px <= d.x + d.w && py >= d.y && py <= d.y + d.h) {
    save = { ...save, timeOfDay: px < d.x + d.w / 2 ? 'night' : 'day' };
    storeSave(save);
    sfx.blip(px < d.x + d.w / 2 ? 520 : 760, 0.09);
    return;
  }
  for (const box of pitcherBoxes(view, insets)) {
    if (px < box.x || px > box.x + box.w || py < box.y || py > box.y + box.h) continue;
    const spec = PITCHERS[box.pitcher];
    if (spec.level > levelFor()) {
      shopNotice = `${spec.name} はレベル ${spec.level} で挑戦できます`;
      shopNoticeLeft = 2.2;
      sfx.blip(220, 0.08);
      return;
    }
    save = withPlayer(save, selected, { pitcher: box.pitcher });
    storeSave(save);
    state = step(state, { kind: 'selectPitcher', pitcher: box.pitcher });
    sfx.blip(700, 0.09);
    return;
  }
  for (const box of cardBoxes(view, insets)) {
    if (px >= box.x && px <= box.x + box.w && py >= box.y && py <= box.y + box.h) {
      selected = box.player;
      const me = slot(selected);
      save = { ...save, last: selected };
      storeSave(save);
      state = initialState(
        Date.now() & 0x7fffffff, selected, roundMode,
        me.bat, levelOf(me.xp), me.pitcher);
      fx.reset();
      cutIn = null;
      previousEvent = null;
      previousPhase = state.phase;
      landed = false;
      pauseLeft = 0.35;
      windup = 0;
      swingArc = -1;
      resetLeft = 0;
      setLeft = SET_PAUSE;
      uiScreen = 'playing';
      if (!coachShown) { coachShown = true; coachLeft = 6.5; }
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
  // A drag scrolls; only a tap equips. Without this the shelf equipped whatever
  // was under the thumb at the end of every scroll.
  if (dragged > view.width * 0.02) return;
  if (py < shopListTop(view, insets) || py > shopListBottom(view, insets)) return;
  for (const row of shopRows(view, insets, shopScroll)) {
    if (px < row.x || px > row.x + row.w || py < row.y || py > row.y + row.h) continue;
    const spec = BATS[row.bat];
    if (batsFor(save, selected).includes(row.bat)) {
      if (slot().bat !== row.bat) {
        save = withPlayer(save, selected, { bat: row.bat });
        storeSave(save);
        state = step(state, { kind: 'equipBat', bat: row.bat });
        shopNotice = `${spec.name} を装備しました`;
        shopNoticeLeft = 2.2;
        sfx.blip(900, 0.12);
      }
      return;
    }
    shopNotice = `${spec.name} はレベル ${BATS[row.bat].level} で手に入ります`;
    shopNoticeLeft = 2.2;
    sfx.blip(220, 0.08);
    return;
  }
};

/*
 * Swing on POINTERDOWN, not on pointerup.
 *
 * There is no drag to disambiguate any more — the course is the tap position —
 * so waiting for the finger to lift only adds latency, and the window between a
 * pitch becoming readable and it crossing the plate is about 400 ms. The old
 * code waited for pointerup and then checked whether the finger had moved less
 * than a touch-slop threshold, which on a phone silently ate deliberate taps.
 */
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  sfx.unlock();
  goFullscreen();
  const p = toLogical(e);
  if (uiScreen === 'title') { titleTap(p.x, p.y); return; }
  if (uiScreen === 'shop') {
    dragFrom = { y: p.y, scroll: shopScroll };
    dragged = 0;
    return;
  }

  const inside = (b: { x: number; y: number; w: number; h: number }): boolean =>
    p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

  if (paused) {
    if (inside(resumeButton())) { paused = false; sfx.blip(720, 0.10); return; }
    if (inside(quitButton())) {
      paused = false;
      uiScreen = 'title';
      fx.reset();
      cutIn = null;
      sfx.blip(420, 0.10);
      return;
    }
    return;                       // anywhere else on the pause screen does nothing
  }
  if (state.phase !== 'roundOver' && inside(pauseButton())) {
    paused = true;
    sfx.blip(500, 0.09);
    return;
  }
  doSwing();
});

canvas.addEventListener('pointermove', (e) => {
  if (uiScreen !== 'shop' || !dragFrom) return;
  const p = toLogical(e);
  dragged = Math.max(dragged, Math.abs(p.y - dragFrom.y));
  shopScroll = Math.max(0, Math.min(
    shopScrollMax(view, insets), dragFrom.scroll - (p.y - dragFrom.y)));
});

canvas.addEventListener('pointerup', (e) => {
  if (uiScreen !== 'shop' || !dragFrom) return;
  const p = toLogical(e);
  dragFrom = null;
  shopTap(p.x, p.y);
  dragged = 0;
});

canvas.addEventListener('contextmenu', (ev) => { ev.preventDefault(); });

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

/**
 * Haptics.
 *
 * The one piece of feedback a phone has that a desktop does not, and the game
 * had none of it. A bat crack you can FEEL is most of what separates a mobile
 * game that feels finished from one that feels like a web page — and it costs a
 * single call.
 *
 * Wrapped, because Vibration is unsupported on iOS Safari and a browser may
 * throw if the page has never been interacted with. Silence is the correct
 * fallback: it is a garnish, never information.
 */
const buzz = (pattern: number | readonly number[]): void => {
  try {
    const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
    if (typeof nav.vibrate === 'function') nav.vibrate(pattern as number | number[]);
  } catch { /* unsupported, or blocked until a gesture */ }
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
    // Contact you can feel. A home run gets a double pulse so it is a different
    // event in the hand, not just a longer one.
    if (e.outcome === 'homeRun') buzz([28, 60, 90]);
    else if (e.outcome === 'offTheWall') buzz(34);
    else if (e.outcome === 'inPlay' || e.outcome === 'foul') buzz(18);
    else if (e.outcome === 'whiff') buzz(9);
    else if (e.discipline) buzz([12, 40, 12]);
    if (e.outcome === 'whiff' || e.outcome === 'take' || e.outcome === 'foul') {
      // No set pause here. Nothing was struck, so the camera never left the
      // plate and there is no switch to settle after — the owner's note was
      // about 「次の画面に切り替わってから」, and on a swing and a miss there is
      // no next screen. Adding it anyway made a round of ten misses forty
      // seconds of mostly waiting.
      pauseLeft = RESULT_PAUSE;
      setLeft = 0;
    }
  }

  // the ball has come down
  if (!landed && state.swing?.field && state.flightTime !== null
      && state.flightTime >= state.swing.hangTime - 1e-6) {
    landed = true;
    if (previousEvent) announceLanding(previousEvent);
    pauseLeft = RESULT_PAUSE + CONTACT_SETTLE
      + (previousEvent?.outcome === 'homeRun' ? HOME_RUN_SETTLE : 0);
    setLeft = SET_PAUSE;
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
    /*
     * Everything that makes a round worth more is multiplied HERE, at the bank,
     * and never into the score on screen. The score a player compares against
     * their best has to mean the same thing in every round, or a personal best
     * is just a record of which bat they were holding.
     */
    const me = slot();
    const bonus = PITCHERS[state.pitcher].xp * specialXp(state.ability.specials);
    const gained = bankedPoints(state.round.score, BATS[state.bat], bonus);
    lastBanked = gained;
    const before = levelOf(me.xp);
    const after = levelOf(me.xp + gained);
    save = withPlayer(save, selected, { xp: me.xp + gained });
    save = {
      ...save,
      rounds: save.rounds + 1,
      homeRuns: save.homeRuns + state.round.homeRuns,
      bestScore: Math.max(save.bestScore, state.round.score),
      bestDistance: Math.max(save.bestDistance, Math.round(state.round.longest)),
    };
    storeSave(save);
    if (after > before) {
      levelUpTo = after;
      levelUpBats = batsGained(before, after);
      levelUpSpecials = specialsAt(after).filter((id) => !specialsAt(before).includes(id));
      levelUpLeft = 3.6;
      sfx.fanfare();
    }
    if (state.round.score > best) {
      best = state.round.score;
      sfx.fanfare();
      // No cut-in here. The round-over card already prints ★自己ベスト更新, and
      // the portrait band was landing across the experience total underneath it.
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

/**
 * How long ago the ball was hit, or null if no batted ball is being SHOWN.
 *
 * The null case is the important one, and it is why cameraHome is checked here
 * rather than by each caller. state.swing survives until the next pitch clears
 * it, so "was there a hit" stays true right through the set position and the
 * wind-up — but the camera has already cut back to the plate by then and the
 * flight is over as far as the screen is concerned.
 *
 * Four things ask this question: the camera, whether to draw the batter, how
 * far he has faded, and whether to draw the ball's arc. Three of them used to
 * test cameraHome themselves and the fourth did not, so the arc of the last
 * home run stayed painted across the sky while the next pitch was thrown. That
 * is the failure mode of a flag every caller has to remember: it is not that
 * the check is hard, it is that nothing tells you when you have forgotten it.
 */
const sinceContact = (): number | null => {
  if (cameraHome) return null;
  if (!state.swing || !state.swing.field) return null;
  return state.flightTime ?? 0;
};

const viewMode = (): ViewMode => {
  const t = sinceContact();
  if (t === null) return 'pitch';
  return t <= CUT_HOLD_END ? 'pitch' : 'flight';
};

/** The batter fades out as the camera pulls back, rather than popping. */
const batterFade = (): number => {
  const t = sinceContact();
  if (t === null) return 1;          // at the plate, or back at it after the cut
  if (t <= CUT_HOLD_END) return 1;
  return Math.max(0, 1 - ((t - CUT_HOLD_END) / (CUT_PULLBACK_END - CUT_HOLD_END)) * 2.2);
};

const cameraNow = (): Camera => {
  // A cut, not a journey. See SET_PAUSE.
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
    // The gate that decides whether the batted ball's arc is on screen. Exposed
    // because the arc outliving the flight is invisible to every other readout:
    // the phase, the score and the pitch count all look correct while the last
    // home run is still painted across the sky.
    cameraHome, sinceContact: sinceContact(), hasSwing: state.swing !== null,
  });
  // Skip the title screen without a tap. Synthetic clicks land on the card
  // roughly half the time — the canvas is letterboxed and the first click after
  // a reload gets eaten focusing the page — and each miss costs a round trip.
  (window as unknown as Record<string, unknown>).hrdPlay = (who = 'takaya'): unknown => {
    if (!(PLAYER_IDS as readonly string[]).includes(who)) return 'unknown player';
    selected = who as PlayerId;
    const me = slot(selected);
    state = initialState(
      Date.now() & 0x7fffffff, selected, roundMode, me.bat, levelOf(me.xp), me.pitcher);
    fx.reset();
    cutIn = null;
    previousEvent = null;
    previousPhase = state.phase;
    landed = false;
    pauseLeft = 0.35;
    windup = 0;
    swingArc = -1;
    resetLeft = 0;
    setLeft = SET_PAUSE;
    uiScreen = 'playing';
    if (!coachShown) { coachShown = true; coachLeft = 6.5; }
    return state.phase;
  };
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

/** Presentation clock: real seconds, unaffected by hit stop or pauses. */
let clock = 0;

const advance = (dt: number): void => {
  // presentation timers run on real time even while the core is frozen
  clock += dt;
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
  // Frozen, not slowed: nothing is stepped, no timer moves, and the frame is
  // still drawn so the pause screen can sit on top of the game rather than
  // replacing it.
  if (paused) return;
  coachLeft = Math.max(0, coachLeft - dt);
  scoreboardFlash = Math.max(0, scoreboardFlash - dt * 1.2);
  poleFlash = Math.max(0, poleFlash - dt * 1.2);
  if (swingArc >= 0 && resetLeft <= 0) {
    // held at 1, not reset: the bat stays where the swing left it while the
    // result reads, instead of springing back to the shoulder in shot. The
    // unwind is driven separately, below, so the two never fight.
    swingArc = Math.min(1, swingArc + dt / SWING_ARC_SECONDS);
    resetFrom = swingArc;
  }

  if (fx.hitStop() > 0) return;

  const scale = fx.timeScale();

  while (queue.length > 0) {
    const cmd = queue.shift();
    if (cmd) state = step(state, cmd);
  }

  if (state.phase === 'ready' || state.phase === 'result') {
    pauseLeft -= dt;
    if (pauseLeft <= 0) {
      // 1. the camera cuts home
      cameraHome = true;
      // 2. the batter unwinds to his stance
      if (swingArc >= 0 && resetLeft <= 0) resetLeft = RESET_SECONDS;
      if (resetLeft > 0) {
        resetLeft -= dt;
        const f = Math.max(0, resetLeft / RESET_SECONDS);
        swingArc = resetFrom * f;
        if (resetLeft <= 0) { swingArc = -1; resetLeft = 0; }
      } else if (setLeft > 0) {
        // 3. two beats where nobody moves
        setLeft -= dt;
      } else {
        // 4. only then does the pitcher gather, and 5. throw
        windup += dt;
        if (windup >= WINDUP_SECONDS) {
          windup = 0;
          swingArc = -1;
          cameraHome = false;
          state = step(state, { kind: 'pitch' });
          sfx.blip(300, 0.05);
        }
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
      save, PITCHERS[slot().pitcher]);
    return;
  }
  if (uiScreen === 'shop') {
    drawShop(ctx, view, insets, save, selected, shopNotice, shopScroll);
    return;
  }

  const projector = makeProjector(shakeCamera(cameraNow(), fx.shake()), view);
  const mode = viewMode();
  const streak = state.round.streak;

  drawScene(ctx, projector, state, view, {
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
    batterNumber: PLAYERS[state.player].number,
    batterName: PLAYERS[state.player].roman,
    timeOfDay: save.timeOfDay,
    logo: logoBack,
    clock,

  });
  fx.drawWorld(ctx, projector);

/**
 * The swing button.
 *
 * Drawn even though a tap anywhere also swings. A control the player cannot see
 * is a control they have to be told about, and this game is meant to be handed
 * to somebody at a desk with no explanation. It also stops the thumb hovering
 * over the middle of the screen, where it would cover the ball.
 */
const drawSwingButton = (): void => {
  if (uiScreen !== 'playing') return;
  if (state.phase === 'roundOver') return;
  const b = swingButton(view, insets.bottom);
  const live = state.phase === 'pitching';

  ctx.save();
  ctx.beginPath();
  const r = b.h / 2;
  ctx.moveTo(b.x + r, b.y);
  ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, r);
  ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, r);
  ctx.arcTo(b.x, b.y + b.h, b.x, b.y, r);
  ctx.arcTo(b.x, b.y, b.x + b.w, b.y, r);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  g.addColorStop(0, live ? 'rgba(255,206,92,0.96)' : 'rgba(92,106,134,0.55)');
  g.addColorStop(1, live ? 'rgba(232,150,42,0.96)' : 'rgba(64,76,100,0.55)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = live ? 'rgba(255,240,200,0.9)' : 'rgba(150,166,192,0.4)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${b.h * 0.44}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = live ? 'rgba(38,26,8,0.95)' : 'rgba(210,220,238,0.5)';
  ctx.fillText('スイング', b.x + b.w / 2, b.y + b.h / 2 + 1);
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
};

/** The pause button, beside the swing button where a thumb does not travel. */
const drawPauseButton = (): void => {
  if (uiScreen !== 'playing' || paused) return;
  if (state.phase === 'roundOver') return;
  const b = pauseButton();
  ctx.save();
  ctx.beginPath();
  ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(16,24,40,0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(160,182,214,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = 'rgba(224,236,255,0.9)';
  const bw = b.w * 0.10;
  const bh = b.h * 0.34;
  ctx.fillRect(b.x + b.w / 2 - bw * 2.1, b.y + b.h / 2 - bh / 2, bw, bh);
  ctx.fillRect(b.x + b.w / 2 + bw * 1.1, b.y + b.h / 2 - bh / 2, bw, bh);
  ctx.restore();
};

/** The pause screen itself: the state of play, and two ways out of it. */
const drawPauseScreen = (): void => {
  if (!paused || uiScreen !== 'playing') return;
  ctx.save();
  ctx.fillStyle = 'rgba(6,10,18,0.86)';
  ctx.fillRect(0, 0, view.width, view.height);

  ctx.textAlign = 'center';
  const cx = view.width / 2;
  ctx.font = `800 ${view.width * 0.078}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = '#ffd76a';
  ctx.fillText('タイム', cx, view.height * 0.30);

  // What the player is coming back to, so the pause is also a scoreboard.
  ctx.font = `700 ${view.width * 0.040}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(224,236,255,0.92)';
  ctx.fillText(
    `SCORE ${state.round.score}　HR ${state.round.homeRuns}　OUT ${state.round.outs}/10`,
    cx, view.height * 0.30 + view.width * 0.075);
  ctx.font = `600 ${view.width * 0.032}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(160,182,214,0.9)';
  ctx.fillText(
    `${PLAYERS[state.player].name}　Lv.${levelOf(slot().xp)}　${BATS[state.bat].name}`,
    cx, view.height * 0.30 + view.width * 0.125);

  const button = (
    b: { x: number; y: number; w: number; h: number }, label: string, primary: boolean,
  ): void => {
    roundRectPath(b.x, b.y, b.w, b.h, b.h / 2);
    ctx.fillStyle = primary ? 'rgba(255,206,92,0.95)' : 'rgba(26,38,60,0.95)';
    ctx.fill();
    ctx.strokeStyle = primary ? 'rgba(255,240,200,0.9)' : 'rgba(130,156,196,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = `800 ${b.h * 0.42}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillStyle = primary ? '#2a1e08' : '#e6eefb';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, b.x + b.w / 2, b.y + b.h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  };
  button(resumeButton(), '再開する', true);
  button(quitButton(), '選手選択へもどる', false);

  ctx.restore();
  ctx.textAlign = 'left';
};

/** The three things a first-time player cannot work out by looking. */
const drawCoach = (): void => {
  if (coachLeft <= 0 || uiScreen !== 'playing') return;
  const fade = Math.min(1, coachLeft / 0.8);
  const lines = [
    'タイミングよく「スイング」をタップ',
    'フォークは打てない。見送ると +120',
    '打つほど経験値がたまり、レベルが上がる',
  ];
  const w = view.width * 0.86;
  const h = view.width * 0.34;
  const x = (view.width - w) / 2;
  const y = view.height * 0.30;

  ctx.save();
  ctx.globalAlpha = fade;
  ctx.fillStyle = 'rgba(7,12,22,0.90)';
  roundRectPath(x, y, w, h, view.width * 0.03);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,215,106,0.55)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = `800 ${view.width * 0.042}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = '#ffd76a';
  ctx.fillText('あそびかた', view.width / 2, y + h * 0.22);
  ctx.font = `600 ${view.width * 0.034}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(224,236,255,0.95)';
  lines.forEach((line, i) => {
    ctx.fillText(line, view.width / 2, y + h * (0.44 + i * 0.19));
  });
  ctx.restore();
  ctx.textAlign = 'left';
};

/** A rounded rectangle path. Canvas has roundRect only in newer engines. */
const roundRectPath = (x: number, y: number, w: number, h: number, r: number): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/** Level and the bar toward the next one, tucked under the score. */
const drawLevelBar = (): void => {
  if (uiScreen !== 'playing') return;
  if (state.phase === 'roundOver') return;   // the full-screen card owns it all
  if (resultCardVisible(state)) return;      // the card owns this strip
  const level = levelOf(slot().xp);
  const f = levelProgress(slot().xp);
  // Bottom-left, under the player chip: the top-right corner already holds the
  // home-run count and the out markers, and the bar sat on top of both.
  const w = view.width * 0.40;
  const h = 8;
  // Bottom RIGHT, level with the player chip on the left. The top-right corner
  // already holds the home-run count and the out markers.
  const x = view.width * 0.545;
  const y = view.height - insets.bottom - view.width * (SWING_BAND + 0.048);

  ctx.save();
  ctx.font = `800 ${view.width * 0.030}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(214,228,250,0.85)';
  ctx.textAlign = 'left';
  ctx.fillText(`Lv.${level}`, x, y - 7);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(143,227,255,0.92)';
  ctx.fillRect(x, y, w * f, h);
  ctx.restore();
};

  // The bottom HUD is pushed up by the height of the swing button's band, so
  // the timing bar and the player chip are never underneath the thumb.
  drawHud(
    ctx, state, view, insets, best, lastBanked, slot().xp,
    uiScreen === 'playing' ? view.width * SWING_BAND : 0,
    levelUpLeft > 0
      ? {
        level: levelUpTo,
        bats: levelUpBats.map((id) => BATS[id as keyof typeof BATS].name),
        specials: levelUpSpecials.map((id) => SPECIAL_NAME[id]),
      }
      : null);
  drawSwingButton();
  drawLevelBar();
  drawCoach();
  drawPauseButton();
  drawPauseScreen();
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
