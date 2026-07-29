/**
 * Presentation effects: hit stop, shake, particles, flash, floating text.
 *
 * docs/REFERENCE-HB2.md 8. None of this changes what happens — the physics in
 * src/core already decided that. It changes whether the player can FEEL what
 * happened, which the reference research says is where the whole genre lives.
 *
 * Two rules that the research is emphatic about and that the code enforces:
 *   - effects must coincide. A freeze alone reads as a stutter; a freeze plus a
 *     shake plus a flash plus debris reads as a collision.
 *   - effects must be rare. A screen that always shakes is a screen that never
 *     shakes, so every trigger here is one-shot and decays to nothing.
 *
 * This module owns mutable animation state, which is why it lives in render/
 * and not core/ (PROMPT.md 2: core stays pure). main.ts drives it on the same
 * fixed timestep as the simulation.
 */

import type { Vec3 } from '../core/vec.js';
import { vec } from '../core/vec.js';
import type { Projector, Shake, Viewport } from './camera.js';

// ---------------------------------------------------------------------------
// a local PRNG, so effects are reproducible across screenshots
// ---------------------------------------------------------------------------

let seed = 0x9e3779b9;
const rnd = (): number => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 0x100000000;
};
const between = (a: number, b: number): number => a + (b - a) * rnd();

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

export type ImpactQuality = 'just' | 'good' | 'poor' | 'foul';

type Particle = {
  pos: Vec3;
  vel: Vec3;
  life: number;
  readonly maxLife: number;
  readonly size: number;
  readonly colour: string;
  readonly gravity: number;
  readonly drag: number;
};

type Telop = {
  readonly text: string;
  /** Anchor in world space; null means screen-centred. */
  readonly at: Vec3 | null;
  life: number;
  readonly maxLife: number;
  readonly size: number;
  readonly colour: string;
  readonly rise: number;
  /** Vertical position as a fraction of viewport height, for screen telops. */
  readonly band: number;
};

type Ring = {
  readonly at: Vec3;
  life: number;
  readonly maxLife: number;
  readonly colour: string;
  /** Final radius in metres. Impact rings are hand-sized, landing rings are not. */
  readonly radius: number;
};

export type Fx = ReturnType<typeof createFx>;

/** Hit stop lengths [s]. PROMPT.md 0-6 asks for 2-3 frames; just-met gets 4. */
const STOP_JUST = 4 / 60;
const STOP_GOOD = 3 / 60;
const STOP_POOR = 2 / 60;

export const createFx = () => {
  let particles: Particle[] = [];
  let telops: Telop[] = [];
  let rings: Ring[] = [];

  let stop = 0;
  let flash = 0;
  let flashColour = '255,255,255';
  let shakeAmp = 0;
  let shakeDir = { x: 1, y: 0 };
  let shakeTime = 0;
  /** Slow-motion factor applied to the simulation, 1 = normal. */
  let slow = 1;
  let slowTime = 0;

  const burst = (
    at: Vec3, dir: Vec3, count: number, speed: number, colour: string,
    opts: { spread?: number; size?: number; gravity?: number; drag?: number; life?: number } = {},
  ): void => {
    const spread = opts.spread ?? 0.75;
    for (let i = 0; i < count; i++) {
      const s = speed * between(0.35, 1.0);
      particles.push({
        pos: { ...at },
        vel: vec(
          dir.x * s + between(-spread, spread) * s,
          dir.y * s + between(-spread, spread) * s + s * 0.25,
          dir.z * s + between(-spread, spread) * s,
        ),
        life: 0,
        maxLife: (opts.life ?? 0.55) * between(0.6, 1.3),
        size: (opts.size ?? 0.05) * between(0.6, 1.5),
        colour,
        gravity: opts.gravity ?? 9.807,
        drag: opts.drag ?? 1.4,
      });
    }
  };

  return {
    // -- triggers ----------------------------------------------------------

    /**
     * The bat meets the ball.
     *
     * `dir` is the unit direction the ball leaves in; debris and the shake both
     * follow it, because the research is specific that particles thrown along
     * the strike vector read as force while symmetric puffs read as decoration.
     */
    impact(p: {
      at: Vec3; dir: Vec3; quality: ImpactQuality; exitVelocity: number;
    }): void {
      const strength = Math.min(1, Math.max(0, (p.exitVelocity - 22) / 28));
      // Ring radii are in METRES and stay hand-sized. An earlier version let the
      // impact ring grow to 1.6 m, which at the swing camera's focal length was
      // 500 px — a white circle across the entire screen every time contact was
      // made. Effects are sized by what they represent, not by what looks big.
      if (p.quality === 'just') {
        stop = Math.max(stop, STOP_JUST);
        flash = 0.9; flashColour = '255,244,214';
        shakeAmp = 0.055 + 0.045 * strength;
        burst(p.at, p.dir, 34, 9 + 7 * strength, '255,236,170',
          { size: 0.020, life: 0.5, drag: 2.2 });
        burst(p.at, p.dir, 18, 5, '255,255,255', { size: 0.014, life: 0.32, spread: 1.2 });
        rings.push({
          at: { ...p.at }, life: 0, maxLife: 0.30, colour: '255,238,180', radius: 0.55,
        });
      } else if (p.quality === 'good') {
        stop = Math.max(stop, STOP_GOOD);
        flash = 0.42; flashColour = '255,255,255';
        shakeAmp = 0.030 + 0.030 * strength;
        burst(p.at, p.dir, 20, 7 + 5 * strength, '235,240,255', { size: 0.017, life: 0.4 });
        rings.push({
          at: { ...p.at }, life: 0, maxLife: 0.24, colour: '210,228,255', radius: 0.40,
        });
      } else {
        stop = Math.max(stop, STOP_POOR);
        flash = 0.16; flashColour = '210,225,255';
        shakeAmp = 0.014;
        burst(p.at, p.dir, 11, 4, '190,200,220', { size: 0.015, life: 0.3 });
      }
      // shake perpendicular-ish to the ball, mostly vertical: an upward jolt
      shakeDir = { x: p.dir.x > 0 ? -0.5 : 0.5, y: -1 };
      shakeTime = 0;
    },

    /** A swing that hit nothing. A small, dry nudge — never a big shake. */
    whiff(at: Vec3): void {
      shakeAmp = 0.010;
      shakeDir = { x: 1, y: 0.2 };
      shakeTime = 0;
      burst(at, vec(0, 0, -1), 6, 2.2, '150,165,190',
        { size: 0.022, life: 0.26, gravity: 0, drag: 3.0 });
    },

    /** The ball comes down. Dust where it lands; slow motion just before. */
    land(p: { at: Vec3; homeRun: boolean; distance: number }): void {
      shakeAmp = p.homeRun ? 0.05 : 0.02;
      shakeDir = { x: 0.3, y: -1 };
      shakeTime = 0;
      burst(p.at, vec(0, 1, 0), p.homeRun ? 26 : 14, p.homeRun ? 6 : 3.5,
        p.homeRun ? '255,225,150' : '190,160,130',
        { size: 0.11, life: 0.9, spread: 1.0, drag: 1.0 });
      rings.push({
        at: { ...p.at }, life: 0, maxLife: 0.5,
        colour: p.homeRun ? '255,230,160' : '200,200,200',
        radius: p.homeRun ? 4.5 : 2.5,
      });
      if (p.homeRun) { flash = 0.3; flashColour = '255,236,180'; }
    },

    /** Ask the simulation to run slowly for a while (used on the descent). */
    slowMotion(factor: number, seconds: number): void {
      slow = factor;
      slowTime = seconds;
    },

    /**
     * `band` is where a screen-anchored telop sits, as a fraction of viewport
     * height. Call sites choose distinct bands so that a PERFECT, an x2 BONUS
     * and a distance readout on the same swing stack instead of overprinting.
     */
    telop(
      text: string,
      opts: {
        at?: Vec3 | null; size?: number; colour?: string;
        life?: number; rise?: number; band?: number;
      } = {},
    ): void {
      telops.push({
        text,
        at: opts.at ?? null,
        life: 0,
        maxLife: opts.life ?? 1.1,
        size: opts.size ?? 30,
        colour: opts.colour ?? '255,255,255',
        rise: opts.rise ?? 46,
        band: opts.band ?? 0.34,
      });
    },

    /** Everything cleared between pitches, so nothing bleeds across at-bats. */
    reset(): void {
      particles = []; telops = []; rings = [];
      stop = 0; flash = 0; shakeAmp = 0; slow = 1; slowTime = 0;
    },

    // -- per-frame ---------------------------------------------------------

    /** Seconds of simulation freeze still owed. main.ts skips ticks while > 0. */
    hitStop(): number { return stop; },

    /** Current simulation time scale. */
    timeScale(): number { return slow; },

    shake(): Shake {
      if (shakeAmp <= 0.0001) return { x: 0, y: 0 };
      // a decaying square wave: sharp reversals read as impact, sine reads as wobble
      const phase = Math.sin(shakeTime * 62) >= 0 ? 1 : -1;
      const a = shakeAmp * phase;
      return { x: shakeDir.x * a, y: shakeDir.y * a };
    },

    update(dt: number): void {
      if (stop > 0) { stop = Math.max(0, stop - dt); }
      shakeTime += dt;
      shakeAmp *= Math.pow(0.0006, dt); // ~99.94% gone after 1 s
      flash *= Math.pow(0.0000015, dt);
      if (slowTime > 0) {
        slowTime -= dt;
        if (slowTime <= 0) { slow = 1; slowTime = 0; }
      }

      for (const q of particles) {
        q.life += dt;
        const d = Math.pow(1 / (1 + q.drag), dt);
        q.vel = vec(q.vel.x * d, (q.vel.y - q.gravity * dt) * d, q.vel.z * d);
        q.pos = vec(q.pos.x + q.vel.x * dt, Math.max(0, q.pos.y + q.vel.y * dt), q.pos.z + q.vel.z * dt);
      }
      particles = particles.filter((q) => q.life < q.maxLife);

      for (const t of telops) t.life += dt;
      telops = telops.filter((t) => t.life < t.maxLife);

      for (const r of rings) r.life += dt;
      rings = rings.filter((r) => r.life < r.maxLife);
    },

    // -- drawing -----------------------------------------------------------

    /** World-space effects. Call after the field, before the HUD. */
    drawWorld(ctx: CanvasRenderingContext2D, p: Projector): void {
      for (const r of rings) {
        const s = p.project(r.at);
        if (!s) continue;
        const f = r.life / r.maxLife;
        const radius = p.scaleAt(s.depth) * (r.radius * (0.15 + f * 0.85));
        ctx.strokeStyle = `rgba(${r.colour},${(1 - f) * 0.85})`;
        ctx.lineWidth = Math.max(1, 6 * (1 - f));
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (const q of particles) {
        const s = p.project(q.pos);
        if (!s) continue;
        const f = q.life / q.maxLife;
        const r = Math.max(0.6, p.scaleAt(s.depth) * q.size * (1 - f * 0.55));
        ctx.fillStyle = `rgba(${q.colour},${(1 - f) * 0.9})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    },

    /** Screen-space effects. Call last, over everything including the HUD. */
    drawScreen(ctx: CanvasRenderingContext2D, p: Projector, view: Viewport): void {
      for (const t of telops) {
        const f = t.life / t.maxLife;
        let x = view.width / 2;
        let y = view.height * t.band;
        if (t.at) {
          const s = p.project(t.at);
          if (!s) continue;
          x = s.x; y = s.y;
        }
        y -= t.rise * (1 - Math.pow(1 - f, 2.2));
        // pop in over the first 90 ms, then hold, then fade
        const pop = f < 0.09 ? 0.6 + 0.4 * (f / 0.09) : 1;
        const alpha = f > 0.72 ? 1 - (f - 0.72) / 0.28 : 1;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(pop, pop);
        ctx.font = `800 ${t.size}px "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = Math.max(3, t.size * 0.18);
        ctx.strokeStyle = `rgba(8,12,20,${alpha * 0.85})`;
        ctx.strokeText(t.text, 0, 0);
        ctx.fillStyle = `rgba(${t.colour},${alpha})`;
        ctx.fillText(t.text, 0, 0);
        ctx.restore();
      }

      if (flash > 0.01) {
        ctx.fillStyle = `rgba(${flashColour},${Math.min(0.65, flash)})`;
        ctx.fillRect(0, 0, view.width, view.height);
      }
    },
  };
};
