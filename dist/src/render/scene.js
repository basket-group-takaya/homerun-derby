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
import { vec } from '../core/vec.js';
import { ballAt, battedBallAt } from '../core/game.js';
import { drawFlags } from './flag.js';
import { drawStadium } from './stadium.js';
import { setFigureLight } from './figure.js';
import { drawPitcher } from './pitcher.js';
import { drawBatter } from './batter.js';
import { RELEASE_POINT } from '../core/pitch.js';
import { BALL_RADIUS, PLATE_HALF_WIDTH, ZONE_BOTTOM, ZONE_TOP, } from '../core/constants.js';
const ZONE_MID_Y = (ZONE_BOTTOM + ZONE_TOP) / 2;
// ---------------------------------------------------------------------------
// ball
// ---------------------------------------------------------------------------
const drawBall = (ctx, p, pos, glow = 0) => {
    const s = p.project(pos);
    if (!s)
        return;
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
const drawPitchTrail = (ctx, p, state) => {
    const flight = state.flight;
    if (!flight)
        return;
    for (let i = 1; i <= 7; i++) {
        const t = state.time - i * (1 / 120);
        if (t <= 0)
            break;
        const s = p.project(ballAt(flight, t));
        if (!s)
            continue;
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
/**
 * The strike zone, drawn as the four tappable courses.
 *
 * The free-moving meet cursor is gone: the owner asked for the zone split into
 * four and the course tapped (令和8年7月30日), so the thing that has to be legible
 * is the partition, not a dot. Corner brackets rather than a full grid — the eye
 * needs the extent and the split, and a cage over the ball is exactly what you
 * do not want in the half second the ball is arriving.
 *
 * `armed` flashes the course the last swing chose, which is the only feedback
 * that tells a player whether they hit the course they thought they hit.
 */
/**
 * The strike zone: one rectangle.
 *
 * It was four tappable quadrants until the owner replaced course selection with
 * a single swing button on 令和8年7月30日. Nothing about the zone is an input any
 * more, so it is drawn as information only — where a strike is — and drawn
 * lightly, because a bright frame in the middle of the screen competes with the
 * ball, which is the thing the player is actually reading.
 */
const drawZone = (ctx, p) => {
    const project = (x, y) => {
        const q = p.project(vec(x, y, 0));
        return q ? { x: q.x, y: q.y } : null;
    };
    const outer = [
        project(-PLATE_HALF_WIDTH, ZONE_TOP), project(PLATE_HALF_WIDTH, ZONE_TOP),
        project(PLATE_HALF_WIDTH, ZONE_BOTTOM), project(-PLATE_HALF_WIDTH, ZONE_BOTTOM),
    ];
    if (outer.every((q) => q !== null)) {
        const q = outer;
        ctx.beginPath();
        q.forEach((v, i) => (i === 0 ? ctx.moveTo(v.x, v.y) : ctx.lineTo(v.x, v.y)));
        ctx.closePath();
        ctx.fillStyle = 'rgba(130,200,255,0.055)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(235,245,255,0.55)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
};
/*
 * The batter is no longer drawn from any sprite. src/render/batter.ts builds him
 * as an articulated 3D figure in world space.
 *
 * Every previous attempt was a 2D sprite placed by hand, and every one of them
 * broke in a new way: facing away from the pitcher, changing batter's box at
 * contact, holding two bats at once. Those were not bugs in the placement — a
 * sprite is a picture from one viewpoint, and the pitch camera is not that
 * viewpoint. Nothing decides which way a solid faces except its geometry.
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
export const drawScene = (ctx, p, state, view, show) => {
    setFigureLight(show.timeOfDay === 'day');
    drawStadium(ctx, p, view, show.stadium, show.timeOfDay);
    // After the stadium, because the stadium is a cached still and this is not.
    drawFlags(ctx, p, show.logo, show.clock, show.timeOfDay === 'day');
    if (show.mode !== 'flight')
        drawPitcher(ctx, p, show.windup);
    // batted ball and its arc
    const swing = state.swing;
    if (swing && swing.trail.length > 1 && show.sinceContact !== null) {
        const upTo = Math.max(2, Math.round(((state.flightTime ?? 0) / swing.hangTime) * swing.trail.length));
        const visible = swing.trail.slice(0, Math.min(upTo, swing.trail.length));
        ctx.beginPath();
        let started = false;
        for (const v of visible) {
            const s = p.project(v);
            if (!s)
                continue;
            if (started)
                ctx.lineTo(s.x, s.y);
            else {
                ctx.moveTo(s.x, s.y);
                started = true;
            }
        }
        if (started) {
            ctx.strokeStyle = swing.titanic ? 'rgba(255,214,120,0.75)' : 'rgba(255,255,255,0.55)';
            ctx.lineWidth = swing.titanic ? 3.5 : 2.5;
            ctx.stroke();
        }
        drawBall(ctx, p, battedBallAt(swing, state.flightTime ?? swing.hangTime), swing.titanic ? 1 : 0.35);
    }
    if (show.mode === 'pitch') {
        drawBatter(ctx, p, {
            progress: show.swingArc,
            player: state.player,
            number: show.batterNumber,
            name: show.batterName,
            logo: show.logo,
            hot: show.hot,
        });
        drawZone(ctx, p);
        if (state.flight && state.phase === 'pitching') {
            drawPitchTrail(ctx, p, state);
            drawBall(ctx, p, ballAt(state.flight, state.time));
        }
        else if (state.phase === 'ready') {
            // hold the ball in the pitcher's hand so the eye knows where to look
            drawBall(ctx, p, RELEASE_POINT);
        }
    }
};
export { ZONE_MID_Y };
//# sourceMappingURL=scene.js.map