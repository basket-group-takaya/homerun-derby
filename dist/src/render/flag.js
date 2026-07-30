/**
 * Company flags on poles above the scoreboard, moving in the wind.
 *
 * Asked for by the owner (令和8年7月31日): 「弊社のロゴを野球場の旗みたいな感じで
 * 掲げて、風でなびいているような感じで」.
 *
 * THE LOGO IS NOT ALTERED. PROMPT.md 0-4 allows the company mark and forbids
 * changing it, so the same untouched PNG the batter wears on his back is the
 * flag's cloth — no recolour, no crop, no redraw. It was cut from the jersey
 * with its navy background attached, which turns out to be exactly what a
 * company flag looks like, so nothing had to be removed either.
 *
 * The wave does bend it, the way a real flag bends a real logo. That is a
 * judgement the owner gets to make rather than me, so WAVE_AMPLITUDE is the one
 * dial: at 0 the flag is a rigid board with a perfectly flat logo, and every
 * increase trades legibility for life. It is set low deliberately.
 *
 * Nothing here reads the wind, because there is no wind — the physics has none
 * (src/core/physics.ts). The flag must therefore never be drawn in a way that
 * invites the player to read a direction off it and aim, so both flags fly the
 * same way at a steady rate and it stays decoration.
 */
import { vec, dot, normalize, cross, sub } from '../core/vec.js';
import { LIGHT } from './figure.js';
import { SCOREBOARD_TOP, SCOREBOARD_Z } from '../core/constants.js';
/**
 * How many vertical strips the cloth is cut into.
 *
 * Canvas 2D cannot map an image onto an arbitrary quadrilateral — drawImage
 * takes a rectangle and setTransform is affine, which together can only produce
 * a parallelogram. A narrow enough strip IS very nearly a parallelogram, so the
 * flag is drawn as a row of them. Twenty-two is where the error stops being
 * visible on a phone; going higher costs a drawImage each and buys nothing.
 */
const STRIPS = 22;
/**
 * Metres the free edge swings out of plane, toward and away from the camera.
 *
 * Almost invisible ON ITS OWN, and that is the whole lesson of this file. A real
 * flag ripples perpendicular to its own cloth; here the cloth faces home plate
 * and the camera sits behind home plate, so "perpendicular to the cloth" is
 * straight down the view axis. The first version waved correctly and looked
 * completely still, because every point was moving towards the lens.
 *
 * What this term still buys is the SHADING. Tilting each strip out of plane is
 * what makes the light run in bands along the cloth, and the bands are what the
 * eye actually reads as fabric. So it stays, and the visible motion comes from
 * WAVE_LIFT instead.
 */
const WAVE_AMPLITUDE = 0.62;
/**
 * Metres the free edge rises and falls. 【要判断・会社ロゴ】
 *
 * The dial that trades logo legibility for the flag looking alive, because this
 * is the component that actually bends the mark on screen. 0 gives a rigid
 * board and a perfectly undistorted logo.
 */
const WAVE_LIFT = 0.62;
/** Ripples along the flag's length. Under one and it does not read as cloth. */
const WAVES = 1.35;
/** Radians per second the wave travels. Slow: a flag is not a flapping towel. */
const WAVE_SPEED = 2.6;
const FLAG_WIDTH = 10.5;
const FLAG_HEIGHT = 6.2;
const POLE_HEIGHT = 15.5;
const POLE_BASE = SCOREBOARD_TOP - 1.0;
/** Poles sit outboard of the board, so the cloth flies over sky, not over it. */
const POLE_X = 17.0;
/*
 * Both flags fly the same way — that is what makes it read as weather rather
 * than as two independent animations. The phase offset stops them from being
 * the same flag drawn twice, which the eye picks up immediately.
 */
const POLES = [
    { x: -POLE_X, phase: 0 },
    { x: POLE_X, phase: 1.9 },
];
/**
 * A point on the cloth.
 *
 * u runs from the pole (0) to the free edge (1), v from the top (0) down.
 * The out-of-plane displacement grows with u because the pole end cannot move:
 * a flag hinges at its hoist, and a wave of constant amplitude across the whole
 * width reads as a rippling sheet of paper flying beside a pole instead.
 */
const clothPoint = (pole, u, v, t) => {
    const swing = Math.sin(u * WAVES * Math.PI * 2 - t * WAVE_SPEED + pole.phase);
    const reach = Math.pow(u, 1.3);
    const top = POLE_BASE + POLE_HEIGHT - 0.55;
    return vec(pole.x + u * FLAG_WIDTH, 
    // The visible part of the wave. The hem swings further than the head of the
    // flag, which is what stops it reading as a rigid board being waggled.
    top - v * FLAG_HEIGHT + swing * reach * WAVE_LIFT * (0.55 + 0.75 * v), SCOREBOARD_Z + swing * reach * WAVE_AMPLITUDE);
};
/** The pole, drawn whether or not the cloth is ready. */
const drawPole = (ctx, p, pole, day) => {
    const foot = p.project(vec(pole.x, POLE_BASE, SCOREBOARD_Z));
    const head = p.project(vec(pole.x, POLE_BASE + POLE_HEIGHT, SCOREBOARD_Z));
    if (!foot || !head)
        return;
    ctx.strokeStyle = day ? 'rgba(196,206,222,0.95)' : 'rgba(122,136,160,0.9)';
    ctx.lineWidth = Math.max(1, p.scaleAt(head.depth) * 0.16);
    ctx.beginPath();
    ctx.moveTo(foot.x, foot.y);
    ctx.lineTo(head.x, head.y);
    ctx.stroke();
    // finial, so the pole ends rather than just stopping
    const r = Math.max(1, p.scaleAt(head.depth) * 0.22);
    ctx.fillStyle = day ? 'rgba(232,238,248,0.95)' : 'rgba(180,194,216,0.9)';
    ctx.beginPath();
    ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
    ctx.fill();
};
/**
 * One flag: the cloth as a row of strips, then the shading over the top.
 *
 * The two passes are separate on purpose. The image strips overlap slightly so
 * no sky shows through the joins; the shading quads do not overlap, because a
 * translucent wash drawn twice on the same pixels makes a dark line exactly
 * where the joins are — the artefact it was added to hide.
 */
const drawCloth = (ctx, p, pole, logo, t, day) => {
    const iw = logo.naturalWidth;
    const ih = logo.naturalHeight;
    if (!iw || !ih)
        return;
    const strips = [];
    for (let i = 0; i < STRIPS; i++) {
        const u0 = i / STRIPS;
        const u1 = (i + 1) / STRIPS;
        const a = clothPoint(pole, u0, 0, t);
        const b = clothPoint(pole, u1, 0, t);
        const c = clothPoint(pole, u0, 1, t);
        const d = clothPoint(pole, u1, 1, t);
        const q0 = p.project(a);
        const q1 = p.project(b);
        const q2 = p.project(c);
        const q3 = p.project(d);
        if (!q0 || !q1 || !q2 || !q3)
            return; // any corner behind the eye: skip
        // The strip's own normal, from its two edges. This is what makes the wave
        // visible: the cloth is one flat colour otherwise and the ripple would only
        // show as a wobbling outline.
        const n = normalize(cross(sub(b, a), sub(c, a)));
        strips.push({ p0: q0, p1: q1, p2: q2, p3: q3, shade: dot(n, LIGHT) });
    }
    const sw = iw / STRIPS;
    /*
     * A dark edge under the cloth, before the cloth.
     *
     * The logo was cut from a navy jersey and it is a night game: a navy flag on
     * a navy sky has no silhouette, so it read as a logo floating unsupported
     * rather than as a flag. This is the same trick the figures use — draw a
     * slightly larger dark copy behind — and it touches only the space AROUND the
     * mark, never the mark.
     */
    const outline = [];
    for (const s of strips)
        outline.push(s.p0);
    outline.push(strips[strips.length - 1].p1);
    for (let i = strips.length - 1; i >= 0; i--)
        outline.push(strips[i].p3);
    outline.push(strips[0].p2);
    let ox = 0;
    let oy = 0;
    for (const q of outline) {
        ox += q.x;
        oy += q.y;
    }
    ox /= outline.length;
    oy /= outline.length;
    ctx.beginPath();
    outline.forEach((q, i) => {
        const dx = q.x - ox;
        const dy = q.y - oy;
        const d = Math.hypot(dx, dy) || 1;
        const k = (d + 1.6) / d;
        const x = ox + dx * k;
        const y = oy + dy * k;
        if (i === 0)
            ctx.moveTo(x, y);
        else
            ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = day ? 'rgba(30,42,62,0.55)' : 'rgba(4,8,16,0.72)';
    ctx.fill();
    ctx.save();
    for (let i = 0; i < STRIPS; i++) {
        const s = strips[i];
        const sx = i * sw;
        // Half a pixel of overlap on the far edge closes the joins. Taking it from
        // the projected corners rather than from the source keeps the image scale
        // right; stretching the source instead would shift the logo along the flag.
        const grow = 0.5;
        const ex = s.p1.x - s.p0.x;
        const ey = s.p1.y - s.p0.y;
        const elen = Math.hypot(ex, ey) || 1;
        const p1x = s.p1.x + (ex / elen) * grow;
        const p1y = s.p1.y + (ey / elen) * grow;
        const ax = (p1x - s.p0.x) / sw;
        const ay = (p1y - s.p0.y) / sw;
        const cx = (s.p2.x - s.p0.x) / ih;
        const cy = (s.p2.y - s.p0.y) / ih;
        if (!Number.isFinite(ax) || !Number.isFinite(cy))
            continue;
        // transform, NOT setTransform. setTransform REPLACES the matrix, and the
        // canvas is already carrying a device-scale one (main.ts renders above the
        // display resolution). Replacing it drew the flag in device pixels at
        // logical coordinates: adrift from its own pole, up and to the left.
        ctx.save();
        ctx.transform(ax, ay, cx, cy, s.p0.x - ax * sx, s.p0.y - ay * sx);
        ctx.drawImage(logo, sx, 0, sw, ih, sx, 0, sw, ih);
        ctx.restore();
    }
    ctx.restore();
    // shading pass: exact quads, no overlap
    ctx.save();
    for (const s of strips) {
        // Wrapped like the figures, so the away-facing side of a ripple darkens
        // without going black. Daylight lifts the floor: a flag in the sun is lit
        // from the sky on every side.
        const lambert = Math.max(0, (s.shade + 0.5) / 1.5);
        const k = (day ? 0.80 : 0.62) + (day ? 0.34 : 0.46) * lambert;
        ctx.beginPath();
        ctx.moveTo(s.p0.x, s.p0.y);
        ctx.lineTo(s.p1.x, s.p1.y);
        ctx.lineTo(s.p3.x, s.p3.y);
        ctx.lineTo(s.p2.x, s.p2.y);
        ctx.closePath();
        if (k < 1) {
            ctx.fillStyle = `rgba(6,10,20,${Math.min(0.55, 1 - k)})`;
        }
        else {
            ctx.fillStyle = `rgba(255,246,220,${Math.min(0.28, (k - 1) * 0.8)})`;
        }
        ctx.fill();
    }
    ctx.restore();
};
/**
 * Draw the flags. Called AFTER the stadium, never inside it.
 *
 * The park is baked to an offscreen canvas and blitted (src/render/stadium.ts)
 * because none of it changes while the camera is parked. The flags are the one
 * thing out there that does change, so putting them in the bake would either
 * freeze them or destroy the cache — the reason they live in their own module.
 */
export const drawFlags = (ctx, p, logo, clock, day) => {
    for (const pole of POLES) {
        drawPole(ctx, p, pole, day);
        if (logo && logo.complete)
            drawCloth(ctx, p, pole, logo, clock, day);
    }
};
//# sourceMappingURL=flag.js.map