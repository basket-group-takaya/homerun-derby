/**
 * The batter, as an articulated 3D figure.
 *
 * This replaces the rear sprite. The sprite was a picture taken from one
 * viewpoint, so every camera that was not that viewpoint contradicted it, and
 * the contradictions kept coming back in new forms: looking away from the
 * pitcher, changing batter's box at contact, holding two bats at once. A figure
 * that exists in the world cannot do any of that — where it faces is decided by
 * the geometry, not by a drawing.
 *
 * The likeness is the cost, and it is a real one: the batter in play is no longer
 * the employee's illustration. The illustrations stay on the select screen, in
 * the home-run cut-in, and as the small portrait beside the HUD, and the shirt
 * carries the right number. docs/PROGRESS.md star-judgement 13 records the trade.
 *
 * ORIENTATION, which is the part that has gone wrong repeatedly and so is
 * spelled out rather than assumed:
 *
 *   World: x = first base, y = up, z = centre field, origin = home plate.
 *   A right-handed batter stands at x < 0 (third-base side) and faces ACROSS the
 *   plate, so his chest faces +x. Standing that way, up is +y, and his left hand
 *   side is +z — which is where the pitcher is. That is the whole point: a
 *   right-handed batter presents his left shoulder to the pitcher.
 *   His back therefore faces -x, and his rear (right) shoulder is at -z, on the
 *   catcher's side, which is where the bat rests.
 *
 * Local coordinates below are measured from the midpoint between his feet, with
 * the same axes as the world at rest, so "local" is just "world minus stance".
 */

import type { PlayerId } from '../core/constants.js';
import type { Vec3 } from '../core/vec.js';
import { vec, add, sub, scale, cross, dot, normalize, radians } from '../core/vec.js';
import type { Projector } from './camera.js';
import type { Quad, RGB } from './figure.js';
import {
  ROUND_SIDES, drawGroundShadow, drawQuads, jointQuads, limbQuads, roundLimb,
  taperQuads, yawAbout,
} from './figure.js';

/** Where the batter's feet are. Left of the plate, level with it. */
export const STANCE: Vec3 = vec(-0.72, 0, -0.04);

/**
 * The uniform, read off the character art in assets/player/<id>/back.png.
 *
 * The owner's note was that the figure had become "似て非なるもの" — recognisably
 * meant to be the character and recognisably not him. It was a generic ballplayer
 * in a batting helmet. The art is specific: navy jersey with orange and green
 * trim at the cuffs and collar, the company logo and the player's name above a
 * large number, white pants belted at the waist and ending below the knee, high
 * navy socks, and NO HELMET — bare, spiked hair, and glasses on 貴也.
 *
 * The helmet was the single largest error. It is a bright shape on top of the
 * silhouette, so the eye reads it first, and no character in the art wears one.
 */
const NAVY: RGB = [34, 48, 78];
const TRIM_ORANGE: RGB = [214, 108, 32];
const BELT: RGB = [26, 32, 52];
// Off-white rather than white: at full white the pants were the brightest thing
// on screen, brighter than the lit scoreboard, and the eye went straight to them.
const PANTS: RGB = [198, 203, 214];
const SOCK: RGB = [26, 38, 64];
// Hair, not helmets. A navy helmet on a navy night sky was invisible anyway,
// which is how the head came to read as a bare skin-coloured block.
const HAIR_BLACK: RGB = [26, 26, 32];
const HAIR_BROWN: RGB = [86, 58, 38];
// The art's bat is nearly black. Pure black disappears against the night sky,
// so this is as dark as it can go and still read as a bat in silhouette.
const WOOD: RGB = [78, 58, 46];
const GRIP: RGB = [40, 34, 32];
const GLOVE: RGB = [232, 234, 240];

/**
 * What makes each player himself.
 *
 * Everything here is taken from his own back.png rather than invented. The three
 * are distinguished at playing size by hair colour, glasses, number colour and
 * build — in that order of how well each one reads at about 340 px tall.
 */
export type PlayerLook = {
  readonly hair: RGB;
  readonly skin: RGB;
  readonly glasses: boolean;
  /** Number fill and outline, as canvas colours. 勇樹's number is orange. */
  readonly numberFill: string;
  readonly numberEdge: string;
  readonly shoe: RGB;
  /** Shoulder and arm scale. 勇樹 is visibly the heaviest build in the art. */
  readonly build: number;
};

export const LOOKS: Readonly<Record<PlayerId, PlayerLook>> = {
  yuki: {
    hair: HAIR_BLACK, skin: [231, 190, 160], glasses: false,
    numberFill: '#e87a2a', numberEdge: '#ffffff', shoe: [236, 238, 244], build: 1.14,
  },
  takaya: {
    hair: HAIR_BLACK, skin: [228, 186, 158], glasses: true,
    numberFill: '#ffffff', numberEdge: '#e87a2a', shoe: [236, 238, 244], build: 1.00,
  },
  atsushi: {
    hair: HAIR_BROWN, skin: [232, 192, 164], glasses: false,
    numberFill: '#ffffff', numberEdge: '#e87a2a', shoe: [30, 32, 40], build: 0.94,
  },
};

/**
 * Body landmarks at rest, local. Roughly a 1.78 m adult.
 *
 * The masses hung off these are deliberately NOT life proportions. A correctly
 * proportioned adult, drawn 340 px tall and shaded flat, reads as spindly — the
 * head is too small to carry expression and the shoulders vanish. Game figures
 * are built a head short and a shoulder wide for the same reason cartoonists
 * enlarge hands, and the reference is no exception. So the head is about 1.15x
 * life and the shoulders about 1.1x, while the skeleton below stays honest.
 */
const HIP_Y = 0.90;
const CHEST_Y = 1.26;
const SHOULDER_Y = 1.41;
const HEAD_Y = 1.60;

// ---------------------------------------------------------------------------
// the pose
// ---------------------------------------------------------------------------

export type BatterPose = {
  /** Body rotation about the vertical, opening toward the pitcher [rad]. */
  readonly yaw: number;
  /** Hand position, local. */
  readonly hands: Vec3;
  /**
   * Unit direction from the hands toward the barrel tip, in WORLD space.
   *
   * Deliberately not body-local. A local direction has to be composed with the
   * trunk's yaw to mean anything, and that composition is where the sign error
   * lived that made the drawn bat miss the ball by half a metre: local z had to
   * be negative to LAG the open trunk, which is not something anyone can check
   * by looking at the number. In world space the vector says what it means —
   * +x is across the plate, +z is at the pitcher — so a wrong one is obvious on
   * sight and pinned by tests/batter.test.ts. The wrists move independently of
   * the trunk anyway, so world was always the better frame.
   */
  readonly batDir: Vec3;
  /** 0 at rest, 1 at the end of the follow-through. */
  readonly progress: number;
};

type Key = {
  readonly at: number;
  readonly yawDeg: number;
  readonly hands: Vec3;
  readonly batDir: Vec3;
};

/**
 * Keyframes. `at` is the fraction of the swing.
 *
 * Contact happens at 0.43 (T_SWING is 0.13 s of a 0.30 s sweep), so that is the
 * frame the eye actually reads and the one worth getting right.
 *
 * ALL THREE OF THESE NUMBERS ARE LOAD-BEARING, and `batDir.z` at contact is the
 * one that has already been wrong once. It is a LOCAL direction, so reading it
 * requires composing it with that frame's yaw. At contact the trunk has opened
 * 38 degrees, and the barrel has to come out along world +x — across the plate,
 * toward first base — so in local terms the bat must LAG the trunk by the same
 * 38 degrees, which makes local z NEGATIVE. It was +0.43, which rotated to a
 * world barrel pointing at the pitcher: the implied spray angle was -63.5
 * degrees, outside the foul line and unreachable by any legal batted ball, and
 * the drawn bat missed the ball by half a metre at its closest approach. Nothing
 * caught it because the bat's world path was never asserted anywhere. It is now:
 * tests/batter.test.ts.
 */
/**
 * How far open the stance is at rest [deg]. 【調整可】
 *
 * THIS IS THE NUMBER THAT MAKES THE VIEW READ AS "FROM BEHIND", and it is the
 * answer to the owner's complaint that the batter looked sideways.
 *
 * Zero would be square: chest along world +x, so the pitch camera — which sits
 * behind the plate at z = -5.05, on the batter's catcher side — would see his
 * right flank almost exactly edge-on, 15.5 degrees off pure profile. That is a
 * SIDE view, and no amount of modelling makes a side view look like a view from
 * behind. Opening the trunk turns his back (-x, rotated) toward the camera; at
 * 30 degrees the back sits 25 degrees off edge-on, which is a three-quarter rear
 * view, the framing the reference uses (docs/REFERENCE-HB2.md 3-1).
 *
 * The alternative was to move the camera onto his back side, x < -0.72. That
 * does not work: at 5 m back, the plate and the batter are then only 8 degrees
 * apart, so centring the strike zone yaws the camera far enough that centre
 * field leaves the frame. Opening the stance costs nothing and keeps the
 * composition. Plenty of hitters stand open; the feet barely rotate (see
 * LEG_SHARE) so the box still reads correctly.
 */
const STANCE_OPEN_DEG = 40;

/**
 * Keyframes. `at` is the fraction of the swing; `batDir` is WORLD.
 *
 * Contact is at 0.43 — T_SWING 0.13 s of a 0.30 s sweep — so it is the frame the
 * eye actually reads, and the only one whose numbers are derived rather than
 * chosen: the barrel has to pass through the nominal contact point
 * (0, 0.9144, 0), which fixes the hands once the direction is fixed.
 *
 * From the lag frame on, the barrel's azimuth atan2(x, z) is the number to read
 * down this table: 200 -> 90 -> 29 -> -112 degrees, one continuous sweep from
 * pointing back at the backstop, through square across the plate, and round into
 * the finish. 90 degrees at contact is a ball hit to centre field.
 *
 * For the first two frames the azimuth is meaningless: the bat is within 20
 * degrees of vertical, so atan2 is reading two small numbers against each other.
 * What matters there is that it IS vertical (y > 0.85) and that it leans a little
 * toward the plate (x > 0) — the reference silhouette, bat up and toward the
 * middle of frame, crossing just past the helmet.
 */
const KEYS: readonly Key[] = [
  {
    // Hands up and back off the rear shoulder, and far enough from the body to
    // leave an arm. At 0.2 m from the shoulder there was nothing to draw and he
    // read as armless; a real stance holds them about 0.3 m out.
    at: 0.00, yawDeg: STANCE_OPEN_DEG,
    hands: vec(-0.40, 1.36, -0.28),
    batDir: normalize(vec(0.22, 0.95, -0.22)),
  },
  {
    // load: coil away, hands back, bat still up
    at: 0.18, yawDeg: 34,
    hands: vec(-0.44, 1.39, -0.32),
    batDir: normalize(vec(0.16, 0.95, -0.27)),
  },
  {
    // Lag: the hips have opened but the barrel is still behind the hands,
    // pointing back at the backstop. Without this frame the bat interpolates
    // straight from vertical to level, and the chord cuts through his chest.
    at: 0.33, yawDeg: 58,
    hands: vec(-0.04, 1.26, -0.30),
    batDir: normalize(vec(-0.30, 0.45, -0.84)),
  },
  {
    // contact: barrel across the plate, through (0, 0.9144, 0)
    at: 0.43, yawDeg: 78,
    hands: vec(0.075, 0.969, -0.161),
    batDir: normalize(vec(0.995, -0.0995, 0)),
  },
  {
    // extension: the barrel is released out toward the pitcher
    at: 0.70, yawDeg: 94,
    hands: vec(0.16, 1.10, 0.20),
    batDir: normalize(vec(0.48, 0.12, 0.87)),
  },
  {
    // finish: wrapped round behind the front shoulder, pointing back at third
    at: 1.00, yawDeg: 112,
    hands: vec(-0.04, 1.30, 0.30),
    batDir: normalize(vec(-0.86, 0.36, -0.35)),
  },
];

const lerpVec = (a: Vec3, b: Vec3, f: number): Vec3 =>
  vec(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);

/** Interpolate the keyframes. `progress` below 0 means "not swinging". */
export const batterPose = (progress: number): BatterPose => {
  const t = Math.min(1, Math.max(0, progress));
  let lo = KEYS[0] as Key;
  let hi = KEYS[0] as Key;
  for (let i = 1; i < KEYS.length; i++) {
    const a = KEYS[i - 1] as Key;
    const b = KEYS[i] as Key;
    if (t <= b.at || i === KEYS.length - 1) { lo = a; hi = b; break; }
  }
  const span = hi.at - lo.at;
  const f = span <= 0 ? 0 : Math.min(1, Math.max(0, (t - lo.at) / span));
  return {
    yaw: radians(lo.yawDeg + (hi.yawDeg - lo.yawDeg) * f),
    hands: lerpVec(lo.hands, hi.hands, f),
    // normalising a lerp is not a great slerp, but over 20-40 degree steps the
    // difference is invisible and it cannot produce a zero-length direction
    batDir: normalize(lerpVec(lo.batDir, hi.batDir, f)),
    progress: t,
  };
};

// ---------------------------------------------------------------------------
// the body
// ---------------------------------------------------------------------------

/** A point on the line a->b, extrapolated when f is outside 0..1. */
const lerpTo = (a: Vec3, b: Vec3, f: number): Vec3 =>
  vec(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);

/** An elbow placed off the shoulder-hand line, so the arm reads as jointed. */
const elbow = (shoulder: Vec3, hand: Vec3, out: Vec3, bend: number): Vec3 => {
  const mid = scale(add(shoulder, hand), 0.5);
  return add(mid, scale(normalize(out), bend));
};

/**
 * Where the bat is, in world space, for a given pose.
 *
 * Split out of batterQuads and exported so a test can assert the thing that
 * matters and that nothing was checking: that the barrel actually goes through
 * the ball at contact, and that the direction it points implies a batted ball
 * inside the foul lines. See tests/batter.test.ts.
 */
export const batWorld = (pose: BatterPose): {
  readonly hands: Vec3;
  readonly dir: Vec3;
  readonly knob: Vec3;
  readonly barrelStart: Vec3;
  readonly tip: Vec3;
} => {
  const centre = vec(0, 0, 0);
  const hands = add(STANCE, yawAbout(pose.hands, centre, pose.yaw));
  const dir = normalize(pose.batDir);
  return {
    hands,
    dir,
    knob: add(hands, scale(dir, -0.10)),
    barrelStart: add(hands, scale(dir, 0.42)),
    tip: add(hands, scale(dir, 0.83)),
  };
};

/**
 * Which way his chest points, in world space. His back is the negation.
 *
 * Exported so the "we are looking at his back, not his side" requirement is a
 * test rather than an opinion.
 */
export const chestDirection = (pose: BatterPose): Vec3 =>
  normalize(yawAbout(vec(1, 0, 0), vec(0, 0, 0), pose.yaw));

export type BatterParts = {
  readonly quads: readonly Quad[];
  /** Jersey-back corners, for the number decal: [topLeft, topRight, botRight, botLeft]. */
  readonly backPanel: readonly Vec3[];
  /** Where the barrel tip ended up, world. Used for the bat's motion smear. */
  readonly barrelTip: Vec3;
};

/**
 * Build the whole figure in world space.
 *
 * Legs take only a third of the body rotation: the back foot is planted and the
 * hips lead, which is what makes a swing look like a swing rather than like a
 * doll being spun.
 */
export const batterQuads = (
  pose: BatterPose, look: PlayerLook = LOOKS.takaya,
): BatterParts => {
  const quads: Quad[] = [];
  const centre = vec(0, 0, 0);

  const place = (local: Vec3, share = 1): Vec3 =>
    add(STANCE, yawAbout(local, centre, pose.yaw * share));

  /**
   * The head keeps its own rotation.
   *
   * A hitter's head stays still and stays on the ball; only the trunk turns. If
   * the head took the trunk's 30 degrees of open stance it would be looking at
   * the shortstop, and the helmet brim — the one part of the figure that shows
   * where he is looking — would point away from the pitcher. Keeping the face
   * on the pitcher at rest and letting it follow the finish at less than half
   * rate is what makes him read as watching the pitch.
   */
  const HEAD_FOLLOW = 0.45;
  const headYaw = radians(-1.3) + (pose.yaw - radians(STANCE_OPEN_DEG)) * HEAD_FOLLOW;
  const placeHead = (local: Vec3): Vec3 =>
    add(STANCE, yawAbout(local, centre, headYaw));

  /**
   * The feet and knees carry part of the open stance, but almost none of the
   * swing.
   *
   * Two separate reasons, and they pull the same way. Physically: an open stance
   * IS the front foot pulled off the line, and during the swing the feet stay
   * planted while the hips turn over them — feet that followed the trunk would
   * look like he was walking round the ball. Visually: the stance line runs
   * along his local z, which from a camera behind the plate is nearly the line
   * of sight, so square feet 0.6 m apart project 8 px apart and the two thighs
   * fuse into one pale block. Turning the feet halfway out spreads them to about
   * 45 px, which is the difference between legs and a nappy.
   */
  const extra = pose.yaw - radians(STANCE_OPEN_DEG);
  const footYaw = radians(STANCE_OPEN_DEG) * 0.50 + extra * 0.10;
  // The follow-through coefficient was 0.42, tuned on the rest frame alone. By
  // the finish the trunk has turned 72 degrees past rest, so the knees came
  // round 30 degrees more, their 0.43 m separation swung square across the view,
  // and he ended the swing doing the splits. The stance opening is a constant;
  // only a little of the swing belongs in the legs.
  const kneeYaw = radians(STANCE_OPEN_DEG) * 0.70 + extra * 0.18;
  const placeAt = (local: Vec3, yaw: number): Vec3 =>
    add(STANCE, yawAbout(local, centre, yaw));

  const push = (built: readonly Quad[]): void => { quads.push(...built); };

  // ----- legs. Feet stay put; knees and hips turn a little.
  // The art plants him wide — the feet are about a shoulder and a half apart —
  // and that width is most of why the character reads as braced rather than
  // standing about.
  const footL = placeAt(vec(0.02, 0.04, 0.36), footYaw);
  const footR = placeAt(vec(0.02, 0.04, -0.38), footYaw);
  // knees pushed forward and down: a batter waits in a crouch, and straight
  // legs made the figure look like it was standing in a queue
  // Knees closer together than the feet, which is what a crouched stance does
  // and what stops the legs reading as a wishbone.
  const kneeL = placeAt(vec(0.11, 0.47, 0.14), kneeYaw);
  const kneeR = placeAt(vec(0.08, 0.47, -0.15), kneeYaw);
  const hipL = place(vec(0, HIP_Y - 0.06, 0.12), 1);
  const hipR = place(vec(0, HIP_Y - 0.06, -0.12), 1);

  // Calves taper; a constant-width sock under a much wider thigh made the step
  // at the knee read as a pair of shorts rather than as a leg.
  push(taperQuads(footL, kneeL, 0.054, 0.068, SOCK, vec(0, 1, 0), ROUND_SIDES));
  push(taperQuads(footR, kneeR, 0.054, 0.068, SOCK, vec(0, 1, 0), ROUND_SIDES));
  // knees and ankles, so the leg bends instead of hinging
  push(jointQuads(kneeL, 0.076, PANTS));
  push(jointQuads(kneeR, 0.076, PANTS));
  push(jointQuads(footL, 0.052, SOCK));
  push(jointQuads(footR, 0.052, SOCK));
  // Baseball pants end below the knee, so the trouser overlaps the top of the
  // sock rather than meeting it exactly at the joint.
  push(taperQuads(
    lerpTo(kneeL, hipL, -0.16), hipL, 0.070, 0.084, PANTS, vec(0, 1, 0), ROUND_SIDES));
  push(taperQuads(
    lerpTo(kneeR, hipR, -0.16), hipR, 0.070, 0.084, PANTS, vec(0, 1, 0), ROUND_SIDES));
  push(taperQuads(
    add(footL, vec(-0.03, -0.032, 0)), add(footL, vec(0.15, -0.032, 0)),
    0.052, 0.038, look.shoe, vec(0, 1, 0), 10, 0.58));
  push(taperQuads(
    add(footR, vec(-0.03, -0.032, 0)), add(footR, vec(0.15, -0.032, 0)),
    0.052, 0.038, look.shoe, vec(0, 1, 0), 10, 0.58));

  // ----- pelvis and torso
  const pelvis = place(vec(0, HIP_Y, 0));
  const chest = place(vec(0, CHEST_Y, 0));
  const neck = place(vec(0, SHOULDER_Y + 0.05, 0));
  // Hips, waist and chest as rounded prisms flattened front-to-back, which is
  // the actual cross-section of a torso. Boxes read as furniture.
  push(taperQuads(
    add(pelvis, vec(0, -0.075, 0)), add(pelvis, vec(0, 0.06, 0)),
    0.108, 0.104, PANTS, vec(1, 0, 0), ROUND_SIDES, 0.74));
  push(taperQuads(
    add(pelvis, vec(0, 0.05, 0)), chest, 0.104, 0.144, NAVY, vec(1, 0, 0), ROUND_SIDES, 0.74));
  push(taperQuads(chest, neck, 0.144, 0.082, NAVY, vec(1, 0, 0), ROUND_SIDES, 0.74));
  // hip joints, filling the step from the pelvis to the top of each thigh
  push(jointQuads(hipL, 0.086, PANTS, 0.9));
  push(jointQuads(hipR, 0.086, PANTS, 0.9));
  // Belt. In the art it is the line that separates the navy jersey from the
  // white pants, and without it the two just abut.
  push(taperQuads(
    add(pelvis, vec(0, 0.030, 0)), add(pelvis, vec(0, 0.075, 0)),
    0.107, 0.109, BELT, vec(1, 0, 0), 8, 0.74));
  // shoulders: a crossbar, which is what gives a human outline its width without
  // making the whole trunk that wide
  const halfSpan = 0.235 * look.build;
  push(roundLimb(
    place(vec(0, SHOULDER_Y, -halfSpan)), place(vec(0, SHOULDER_Y, halfSpan)),
    0.072 * look.build, NAVY, vec(1, 0, 0)));
  // Collar trim, sitting on the neck rather than above it. At SHOULDER_Y + 0.085
  // it cleared the top of the neck and hung in the air as a loose orange ring.
  push(taperQuads(
    place(vec(0, SHOULDER_Y + 0.040, 0)), place(vec(0, SHOULDER_Y + 0.062, 0)),
    0.086, 0.080, TRIM_ORANGE, vec(1, 0, 0), ROUND_SIDES, 0.74));
  // shoulder caps, where the sleeve meets the trunk
  push(jointQuads(place(vec(0, SHOULDER_Y, halfSpan * 0.82)), 0.078, NAVY));
  push(jointQuads(place(vec(0, SHOULDER_Y, -halfSpan * 0.82)), 0.078, NAVY));

  // ----- head, helmet and a brim that points where he is looking
  push(roundLimb(
    placeHead(vec(0, HEAD_Y - 0.115, 0)), placeHead(vec(0, HEAD_Y + 0.05, 0)),
    0.095, look.skin, vec(1, 0, 0), 0.92));

  /**
   * Hair, in place of the batting helmet.
   *
   * A skull cap plus spikes. The cap alone reads as a swimming hat; the spikes
   * are what make it the character's hair, and they matter more than usual here
   * because we are looking at the BACK of his head, where hair is the only
   * feature there is. Each spike leans back and outward from the crown, which is
   * how all three are drawn.
   */
  // Crown only. The first version was a full shell of radius 0.101 around a head
  // of radius 0.095, so it swallowed the face as well — hair over the eyes, from
  // every angle. Hair goes on the top and the back of a head, not the front.
  push(taperQuads(
    placeHead(vec(0, HEAD_Y + 0.012, 0)), placeHead(vec(0, HEAD_Y + 0.062, 0)),
    0.100, 0.092, look.hair, vec(1, 0, 0), ROUND_SIDES, 0.96));
  push(taperQuads(
    placeHead(vec(0, HEAD_Y + 0.062, 0)), placeHead(vec(0, HEAD_Y + 0.108, 0)),
    0.092, 0.050, look.hair, vec(1, 0, 0), ROUND_SIDES, 0.94));
  // the back of the head, offset away from the face so the front stays skin
  push(taperQuads(
    placeHead(vec(0, HEAD_Y - 0.075, -0.040)), placeHead(vec(0, HEAD_Y + 0.045, -0.034)),
    0.070, 0.086, look.hair, vec(1, 0, 0), ROUND_SIDES, 0.90));
  // the neck, so the head does not sit straight on the shoulders
  push(taperQuads(
    place(vec(0, SHOULDER_Y + 0.02, 0)), placeHead(vec(0, HEAD_Y - 0.10, 0)),
    0.052, 0.058, look.skin, vec(1, 0, 0), ROUND_SIDES));
  const SPIKES: readonly { readonly z: number; readonly x: number; readonly len: number }[] = [
    { z: 0.055, x: -0.02, len: 0.070 },
    { z: 0.020, x: -0.05, len: 0.086 },
    { z: -0.020, x: -0.05, len: 0.082 },
    { z: -0.058, x: -0.02, len: 0.066 },
    { z: 0.036, x: 0.035, len: 0.058 },
    { z: -0.036, x: 0.035, len: 0.056 },
  ];
  for (const s of SPIKES) {
    const root = placeHead(vec(s.x, HEAD_Y + 0.090, s.z));
    const tipAt = placeHead(vec(
      s.x - 0.030, HEAD_Y + 0.090 + s.len, s.z + (s.z >= 0 ? 0.022 : -0.022)));
    push(taperQuads(root, tipAt, 0.030, 0.008, look.hair, vec(1, 0, 0), 5));
  }
  // Sideburns down each side, in front of the ears, so the crown meets the face
  // instead of hovering over it.
  for (const side of [-1, 1]) {
    push(limbQuads(
      placeHead(vec(0.072 * side, HEAD_Y + 0.030, 0.004)),
      placeHead(vec(0.070 * side, HEAD_Y - 0.045, -0.006)),
      0.030, 0.034, look.hair, vec(0, 1, 0)));
    push(roundLimb(
      placeHead(vec(0.086 * side, HEAD_Y - 0.012, -0.010)),
      placeHead(vec(0.098 * side, HEAD_Y - 0.012, -0.010)),
      0.030, look.skin, vec(0, 1, 0), 0.72));
  }

  /**
   * The nose, pointing along the head's local +Z — his left, and so the pitcher.
   *
   * This replaces the batting-helmet peak as the tell for where he is looking.
   * It is four millimetres of geometry and it does a job nothing else can: from
   * behind, a head is an ovoid with no front, and the eye cannot tell a man
   * watching the pitch from a man staring at the backstop.
   */
  push(taperQuads(
    placeHead(vec(0.004, HEAD_Y + 0.005, 0.072)),
    placeHead(vec(0.004, HEAD_Y - 0.012, 0.116)),
    0.026, 0.013, look.skin, vec(0, 1, 0), 6));
  // chin, so the jaw has a front edge in profile
  push(taperQuads(
    placeHead(vec(0.004, HEAD_Y - 0.088, 0.010)),
    placeHead(vec(0.004, HEAD_Y - 0.072, 0.068)),
    0.050, 0.030, look.skin, vec(0, 1, 0), 6, 0.8));

  if (look.glasses) {
    // 貴也's glasses. From behind, the temple arm along the side of his head is
    // the part that shows, and it is the one detail that names him instantly.
    // 貴也's glasses: a lens frame across the face at +Z, and a temple arm back
    // along each side of the head. From behind it is the arm that shows, and it
    // is the one detail that names him at a glance.
    const GLASS: RGB = [42, 44, 52];
    for (const side of [-1, 1]) {
      push(limbQuads(
        placeHead(vec(0.070 * side, HEAD_Y + 0.020, -0.052)),
        placeHead(vec(0.052 * side, HEAD_Y + 0.014, 0.062)),
        0.008, 0.017, GLASS, vec(0, 1, 0)));
      push(limbQuads(
        placeHead(vec(0.052 * side, HEAD_Y + 0.014, 0.062)),
        placeHead(vec(0.008 * side, HEAD_Y + 0.012, 0.082)),
        0.008, 0.017, GLASS, vec(0, 1, 0)));
    }
  }

  // ----- arms to the hands
  const shoulderL = place(vec(0, SHOULDER_Y, 0.205));
  const shoulderR = place(vec(0, SHOULDER_Y, -0.205));
  const hands = place(pose.hands);
  /**
   * Which way the elbows break, in WORLD space: away from the plate and up.
   *
   * The direction matters more than the amount. The previous reference was a
   * local offset that came out pointing at the camera, and a limb pointing at
   * the camera projects to a dot — which is why the figure had no visible arms
   * at all. World -x is square across the line of sight, so an elbow pushed
   * that way is an elbow you can see.
   */
  const outward = normalize(vec(-0.72, 0.62, -0.32));
  const armR = 0.062 * look.build;
  // The two arms converge on one pair of hands, so anything thick here fuses
  // into a single skin-coloured mitten. Upper arms stay in the sleeve and only
  // the forearms are bare, which is also how the jersey works.
  const elbowL = elbow(shoulderL, hands, outward, 0.15);
  const elbowR = elbow(shoulderR, hands, outward, 0.21);
  push(roundLimb(shoulderL, elbowL, armR, NAVY));
  push(roundLimb(shoulderR, elbowR, armR, NAVY));
  push(jointQuads(elbowL, armR * 0.92, look.skin));
  push(jointQuads(elbowR, armR * 0.92, look.skin));
  /*
   * No coloured cuff on the sleeve, though the art has one.
   *
   * The arms point roughly at the camera, so a band around one projects to a
   * full DISC of the arm's radius however short the band is — 26 px of flat
   * orange and green stuck on each elbow. Thinning it does nothing, because the
   * radius sets the size, not the length. The collar keeps its trim: that ring
   * is seen side-on, so it reads as the thin line it is.
   */
  push(roundLimb(elbowL, hands, 0.039 * look.build, look.skin));
  push(roundLimb(elbowR, hands, 0.039 * look.build, look.skin));
  push(roundLimb(
    add(hands, vec(0, 0, -0.038)), add(hands, vec(0, 0, 0.038)), 0.042, GLOVE));

  // ----- the bat, in his hands and pointing where the pose says
  const { knob, barrelStart, tip } = batWorld(pose);
  push(taperQuads(knob, barrelStart, 0.020, 0.026, GRIP, vec(0, 1, 0), ROUND_SIDES));
  push(taperQuads(barrelStart, tip, 0.026, 0.035, WOOD, vec(0, 1, 0), ROUND_SIDES));
  // rounded end cap, rather than a flat disc looking straight at the camera
  push(jointQuads(tip, 0.035, WOOD));

  // ----- the jersey back panel, for the number decal. Slightly proud of the
  // torso so it is never swallowed by the surface it sits on.
  // Seen from 33 degrees off edge-on the panel foreshortens to about half its
  // width, so at the old +/-0.10 m the number came out a 25 px smudge. Wider,
  // and pushed a little further out from the surface it sits on.
  // The torso's back surface is at local x = -0.095: half-width 0.132 squashed
  // by 0.72 across. The panel sat at -0.158, six centimetres proud of it, and
  // the number visibly floated to the left of his outline.
  const panel = [
    vec(-0.103, CHEST_Y + 0.155, 0.150),
    vec(-0.103, CHEST_Y + 0.155, -0.150),
    vec(-0.103, CHEST_Y - 0.215, -0.150),
    vec(-0.103, CHEST_Y - 0.215, 0.150),
  ].map((p) => place(p));

  return { quads, backPanel: panel, barrelTip: tip };
};

// ---------------------------------------------------------------------------
// drawing
// ---------------------------------------------------------------------------

/**
 * Paint a string onto a flat quad in the world.
 *
 * Canvas 2D has no textured triangles, but a flat quad projects to a
 * quadrilateral, and mapping a unit square onto three of its corners is an
 * affine transform the canvas can do directly. Good enough for a number on a
 * shirt; it would visibly shear on a strongly non-planar surface, which is why
 * the panel above is a flat rectangle.
 */
type BackArt = {
  readonly name: string;
  readonly number: number;
  readonly look: PlayerLook;
  readonly logo: HTMLImageElement | null;
};

const drawDecal = (
  ctx: CanvasRenderingContext2D, p: Projector, panel: readonly Vec3[], art: BackArt,
): void => {
  // Cull the panel when it faces away from the camera. drawQuads does this for
  // every solid face; the decal did not, so the number was drawn on top of the
  // body it should have been hidden behind — and mirrored, because the affine
  // transform's determinant is negative when the quad is seen from behind.
  const mid = panel.reduce((acc, v) => add(acc, scale(v, 1 / panel.length)), vec(0, 0, 0));
  const normal = normalize(cross(
    sub(panel[1] as Vec3, panel[0] as Vec3), sub(panel[2] as Vec3, panel[1] as Vec3)));
  if (dot(normal, sub(mid, p.eye)) >= 0) return;

  const projected = panel.map((v) => p.project(v));
  if (projected.some((q) => q === null)) return;
  const [tl, tr, br] = projected as { x: number; y: number }[];
  if (!tl || !tr || !br) return;
  // unit square (0,0)-(1,1) mapped onto tl -> tr along u, tl -> bl along v
  const ux = tr.x - tl.x;
  const uy = tr.y - tl.y;
  const vx = br.x - tr.x;
  const vy = br.y - tr.y;
  const uLen = Math.hypot(ux, uy);
  const vLen = Math.hypot(vx, vy);
  if (uLen < 8 || vLen < 8) return;

  ctx.save();
  ctx.transform(ux, uy, vx, vy, tl.x, tl.y);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  /**
   * The company logo, copied out of the character art by tools/make_logo.py and
   * drawn unaltered — PROMPT.md 0-4 permits the logo but forbids changing it, so
   * it is blitted, never redrawn from primitives, and the destination rectangle
   * keeps its aspect ratio. If it has not loaded yet the rest still draws.
   */
  const logo = art.logo;
  if (logo && logo.complete && logo.naturalWidth > 0) {
    const w = 0.66;
    const h = w * (logo.naturalHeight / logo.naturalWidth) * (uLen / vLen);
    ctx.drawImage(logo, 0.5 - w / 2, 0.055, w, h);
  }

  // Everything below is inside the unit square, so sizes are fractions of it.
  // The square is taller than it is wide, so glyphs come out slightly condensed
  // — which is how the lettering is drawn in the art anyway.
  ctx.font = '700 0.135px "Segoe UI", sans-serif';
  ctx.lineWidth = 0.026;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(20,26,44,0.75)';
  ctx.strokeText(art.name, 0.5, 0.475);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillText(art.name, 0.5, 0.475);

  ctx.font = '800 0.40px "Segoe UI", sans-serif';
  // 0.055 swallowed the fill: at a 0.40 font the stroke is drawn half inside the
  // glyph, so a white number with an orange edge came out solid orange.
  ctx.lineWidth = 0.026;
  ctx.strokeStyle = art.look.numberEdge;
  ctx.strokeText(String(art.number), 0.5, 0.735);
  ctx.fillStyle = art.look.numberFill;
  ctx.fillText(String(art.number), 0.5, 0.735);
  ctx.restore();
};

export type BatterView = {
  /** Swing progress; below 0 means standing still. */
  readonly progress: number;
  readonly player: PlayerId;
  readonly number: number;
  /** Name across the shoulders, as it is lettered in the art. */
  readonly name: string;
  /** The company logo, or null until it has loaded. */
  readonly logo: HTMLImageElement | null;
  /** 0..1 glow while on a home-run streak. */
  readonly hot: number;
};

export const drawBatter = (
  ctx: CanvasRenderingContext2D, p: Projector, view: BatterView,
): void => {
  const swinging = view.progress >= 0;
  const pose = batterPose(swinging ? view.progress : 0);
  const look = LOOKS[view.player];
  const parts = batterQuads(pose, look);

  drawGroundShadow(ctx, p, add(STANCE, vec(0.05, 0, 0)), 0.62, 0.32);

  // Motion smear: the bat alone, a few frames back. Made from the same solid, so
  // it cannot disagree with where the bat actually is.
  if (swinging && view.progress > 0.05) {
    for (let i = 3; i >= 1; i--) {
      const back = view.progress - i * 0.055;
      if (back <= 0) continue;
      const ghost = batterQuads(batterPose(back), look);
      const batOnly = ghost.quads.slice(-20);
      ctx.save();
      ctx.globalAlpha = 0.11 * (4 - i);
      drawQuads(ctx, p, batOnly);
      ctx.restore();
    }
  }

  if (view.hot > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(255,190,90,${0.7 * view.hot})`;
    ctx.shadowBlur = 26 * view.hot;
    drawQuads(ctx, p, parts.quads);
    ctx.restore();
  }
  drawQuads(ctx, p, parts.quads);
  drawDecal(ctx, p, parts.backPanel, {
    name: view.name, number: view.number, look, logo: view.logo,
  });
};
