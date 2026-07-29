/**
 * Game state and the single reducer that advances it.
 *
 * PROMPT.md 2: step(state, cmd) is pure. No DOM, no clock, no Math.random —
 * the RNG lives inside the state, so the same (state, cmd) always yields the
 * same next state.
 */

import type { Vec3 } from './vec.js';
import { clamp } from './vec.js';
import type { Rng } from './rng.js';
import { seedRng } from './rng.js';
import type { PlayerId } from './constants.js';
import {
  PLAYERS, PLATE_HALF_WIDTH, T_SWING, ZONE_BOTTOM, ZONE_TOP,
  TITANIC_DISTANCE,
} from './constants.js';
import type { Pitch, PitchFlight } from './pitch.js';
import { choosePitch, flyPitch } from './pitch.js';
import type { Contact } from './bat.js';
import { resolveContact, catchRadius } from './bat.js';
import { simulateBattedBall } from './physics.js';
import type { FieldResult } from './stadium.js';
import { judgeBattedBall } from './stadium.js';
import type { Round, RoundEvent, RoundMode } from './round.js';
import { applySwing, applyTake, newRound } from './round.js';
import type { BatId } from './bats.js';
import { BATS, DEFAULT_BAT } from './bats.js';

export type Phase = 'ready' | 'pitching' | 'flight' | 'result' | 'roundOver';

export type Cursor = { readonly x: number; readonly y: number };

export type Swing = {
  readonly contact: Contact;
  readonly field: FieldResult | null;
  readonly trail: readonly Vec3[];
  readonly hangTime: number;
  readonly apex: number;
  readonly titanic: boolean;
};

export type GameState = {
  readonly rng: Rng;
  readonly phase: Phase;
  /** Seconds since the pitch was released. */
  readonly time: number;
  readonly player: PlayerId;
  readonly cursor: Cursor;
  readonly pitch: Pitch | null;
  readonly flight: PitchFlight | null;
  readonly swing: Swing | null;
  readonly whiffStreak: number;
  /** Ball position right now, for rendering. */
  readonly ballPos: Vec3 | null;
  /** Seconds since the batted ball was struck; null until then. */
  readonly flightTime: number | null;
  readonly pitchCount: number;
  readonly round: Round;
  /** What the last completed swing amounted to; drives the HUD and effects. */
  readonly lastEvent: RoundEvent | null;
  /** Equipped bat. Chosen before the round and fixed for its duration. */
  readonly bat: BatId;
};

export type Command =
  | { readonly kind: 'tick'; readonly dt: number }
  | { readonly kind: 'moveCursor'; readonly x: number; readonly y: number }
  | { readonly kind: 'swing' }
  | { readonly kind: 'pitch' }
  | { readonly kind: 'selectPlayer'; readonly player: PlayerId }
  | { readonly kind: 'newRound'; readonly mode?: RoundMode }
  | { readonly kind: 'equipBat'; readonly bat: BatId };

/** Cursor travel is limited to a little outside the zone. */
const CURSOR_X = PLATE_HALF_WIDTH + 0.16;
const CURSOR_Y_LO = ZONE_BOTTOM - 0.18;
const CURSOR_Y_HI = ZONE_TOP + 0.18;

export const initialState = (
  seed: number, player: PlayerId = 'takaya', mode: RoundMode = 'classic',
  bat: BatId = DEFAULT_BAT,
): GameState => ({
  rng: seedRng(seed),
  phase: 'ready',
  time: 0,
  player,
  cursor: { x: 0, y: (ZONE_BOTTOM + ZONE_TOP) / 2 },
  pitch: null,
  flight: null,
  swing: null,
  whiffStreak: 0,
  ballPos: null,
  flightTime: null,
  pitchCount: 0,
  round: newRound(mode, PLAYERS[player].skill === 'tenacity'),
  lastEvent: null,
  bat,
});

/** Where the pitch is at time t, interpolated from the integrated samples. */
export const ballAt = (flight: PitchFlight, t: number): Vec3 => {
  const { samples } = flight;
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) throw new Error('pitch flight has no samples');
  if (t <= first.t) return first.pos;
  if (t >= last.t) return last.pos;
  // samples are on a fixed dt grid, so index directly
  const step = samples.length > 1 ? (last.t - first.t) / (samples.length - 1) : 1;
  const i = clamp(Math.floor((t - first.t) / step), 0, samples.length - 2);
  const a = samples[i];
  const b = samples[i + 1];
  if (!a || !b) return last.pos;
  const f = (t - a.t) / (b.t - a.t);
  return {
    x: a.pos.x + (b.pos.x - a.pos.x) * f,
    y: a.pos.y + (b.pos.y - a.pos.y) * f,
    z: a.pos.z + (b.pos.z - a.pos.z) * f,
  };
};

const startPitch = (state: GameState): GameState => {
  const chosen = choosePitch(state.rng);
  const flight = flyPitch(chosen.pitch);
  return {
    ...state,
    rng: chosen.rng,
    phase: 'pitching',
    time: 0,
    pitch: chosen.pitch,
    flight,
    swing: null,
    ballPos: chosen.pitch.release,
    flightTime: null,
    pitchCount: state.pitchCount + 1,
  };
};

/** Resolve a swing against the pitch that is currently in the air. */
const doSwing = (state: GameState): GameState => {
  if (state.phase !== 'pitching' || !state.flight) return state;

  const contact = resolveContact({
    player: PLAYERS[state.player],
    cursor: state.cursor,
    ball: state.flight.crossPoint,
    // the bat arrives T_SWING after the input, so the error is measured there
    timingError: state.time + T_SWING - state.flight.crossTime,
    whiffStreak: state.whiffStreak,
    bat: BATS[state.bat],
  });
  const multiplier = state.pitch?.multiplier ?? 1;

  if (contact.kind === 'whiff') {
    const applied = applySwing(state.round, { contact, field: null, multiplier });
    return {
      ...state,
      phase: applied.round.over ? 'roundOver' : 'result',
      swing: { contact, field: null, trail: [], hangTime: 0, apex: 0, titanic: false },
      whiffStreak: state.whiffStreak + 1,
      round: applied.round,
      lastEvent: applied.event,
    };
  }

  const ball = simulateBattedBall({
    exitVelocity: contact.exitVelocity,
    launchAngle: contact.launchAngle,
    sprayAngle: contact.sprayAngle,
    backspinRpm: contact.spin.backspinRpm,
    sidespinRpm: contact.spin.sidespinRpm,
    contactHeight: contact.contactHeight,
  });
  const field = judgeBattedBall(ball.trail, ball.landing, ball.distance);
  const applied = applySwing(state.round, { contact, field, multiplier });

  return {
    ...state,
    // the round only ENDS once the ball has landed; the flight is the payoff
    phase: 'flight',
    flightTime: 0,
    swing: {
      contact,
      field,
      trail: ball.trail,
      hangTime: ball.hangTime,
      apex: ball.apex,
      titanic: ball.distance >= TITANIC_DISTANCE,
    },
    whiffStreak: 0,
    round: applied.round,
    lastEvent: applied.event,
  };
};

/** Position of a batted ball along its trail at time t. */
export const battedBallAt = (swing: Swing, t: number): Vec3 => {
  const trail = swing.trail;
  const last = trail[trail.length - 1];
  const first = trail[0];
  if (!first || !last) return { x: 0, y: 0, z: 0 };
  if (t >= swing.hangTime) return last;
  const f = clamp(t / swing.hangTime, 0, 1) * (trail.length - 1);
  const i = clamp(Math.floor(f), 0, trail.length - 2);
  const a = trail[i];
  const b = trail[i + 1];
  if (!a || !b) return last;
  const g = f - i;
  return {
    x: a.x + (b.x - a.x) * g,
    y: a.y + (b.y - a.y) * g,
    z: a.z + (b.z - a.z) * g,
  };
};

/** Did a pitch that was let go cross the zone? */
const crossedTheZone = (flight: PitchFlight): boolean => {
  const { x, y } = flight.crossPoint;
  return Math.abs(x) <= PLATE_HALF_WIDTH && y >= ZONE_BOTTOM && y <= ZONE_TOP;
};

export const step = (state: GameState, cmd: Command): GameState => {
  switch (cmd.kind) {
    case 'newRound':
      return initialState(
        state.rng.s0 + state.pitchCount + 1, state.player,
        cmd.mode ?? state.round.mode, state.bat);

    case 'equipBat':
      // only between rounds: swapping mid-round would change the physics of a
      // round already in progress and make its score meaningless
      return state.phase === 'pitching' || state.phase === 'flight'
        ? state
        : { ...state, bat: cmd.bat };

    case 'selectPlayer':
      return state.phase === 'pitching' || state.phase === 'flight'
        ? state
        : initialState(state.rng.s0, cmd.player, state.round.mode, state.bat);

    case 'moveCursor':
      return {
        ...state,
        cursor: {
          x: clamp(cmd.x, -CURSOR_X, CURSOR_X),
          y: clamp(cmd.y, CURSOR_Y_LO, CURSOR_Y_HI),
        },
      };

    case 'pitch':
      return state.phase === 'ready' || state.phase === 'result' ? startPitch(state) : state;

    case 'swing':
      return doSwing(state);

    case 'tick': {
      if (state.phase === 'pitching') {
        const time = state.time + cmd.dt;
        const flight = state.flight;
        if (!flight) return state;
        // the ball is past the batter and untouched: a taken pitch
        if (time > flight.crossTime + 0.35) {
          const applied = applyTake(state.round, crossedTheZone(flight));
          return {
            ...state,
            phase: applied.round.over ? 'roundOver' : 'result',
            time,
            ballPos: ballAt(flight, time),
            round: applied.round,
            lastEvent: applied.event,
          };
        }
        return { ...state, time, ballPos: ballAt(flight, time) };
      }
      if (state.phase === 'flight') {
        const swing = state.swing;
        if (!swing) return state;
        const flightTime = (state.flightTime ?? 0) + cmd.dt;
        if (flightTime >= swing.hangTime) {
          return {
            ...state,
            phase: state.round.over ? 'roundOver' : 'result',
            flightTime: swing.hangTime,
          };
        }
        return { ...state, flightTime };
      }
      return state;
    }

    default:
      return state;
  }
};

/** Convenience for the renderer: the catch radius in play right now. */
export const currentCatchRadius = (state: GameState): number =>
  catchRadius(PLAYERS[state.player], state.whiffStreak, BATS[state.bat]);
