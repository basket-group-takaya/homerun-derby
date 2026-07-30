/**
 * Print where the things that matter land on screen, for each camera.
 *
 * Camera numbers were got wrong by hand three times during design (docs/PROGRESS
 * "訂正した重大な誤り"), so they are tuned by reading this table rather than by
 * arithmetic. tests/projection.test.ts then pins whatever this converged on.
 *
 *   npx tsc && node dist/scripts/camera-check.js
 */
import { vec } from '../src/core/vec.js';
import { makeProjector, PITCH_CAMERA, SWING_CAMERA } from '../src/render/camera.js';
import { RELEASE_POINT } from '../src/core/pitch.js';
import { MOUND_DISTANCE, PLATE_HALF_WIDTH, ZONE_BOTTOM, ZONE_TOP, FENCE_CENTRE, FENCE_HEIGHT, } from '../src/core/constants.js';
/** Portrait. 720 x 1280 is the reference shape; phones vary and the camera
 *  compensates by fixing the horizontal angle (see camera.ts Camera.hfov). */
const VIEW = { width: 720, height: 1280 };
const BATTER_X = -0.78;
const BATTER_Z = -0.15;
const ZONE_MID_Y = (ZONE_BOTTOM + ZONE_TOP) / 2;
const points = [
    ['zone centre', vec(0, ZONE_MID_Y, 0)],
    ['zone top-left', vec(-PLATE_HALF_WIDTH, ZONE_TOP, 0)],
    ['zone bottom-right', vec(PLATE_HALF_WIDTH, ZONE_BOTTOM, 0)],
    ['release point', RELEASE_POINT],
    ['pitcher head', vec(0, 2.05, MOUND_DISTANCE)],
    ['pitcher feet', vec(0, 0.254, MOUND_DISTANCE)],
    ['batter head', vec(BATTER_X, 1.75, BATTER_Z)],
    ['batter feet', vec(BATTER_X, 0, BATTER_Z)],
    ['fence centre top', vec(0, FENCE_HEIGHT, FENCE_CENTRE)],
    ['first base', vec(19.4, 0, 19.4)],
    ['third base', vec(-19.4, 0, 19.4)],
];
const report = (name, camera) => {
    const p = makeProjector(camera, VIEW);
    console.log(`\n=== ${name} ===`);
    console.log(`eye ${JSON.stringify(camera.eye)}  target ${JSON.stringify(camera.target)}  vfov ${camera.vfov}`);
    console.log('  label                 screen x    screen y     depth m');
    for (const [label, v] of points) {
        const s = p.project(v);
        if (!s) {
            console.log(`  ${label.padEnd(20)}  (behind camera)`);
            continue;
        }
        const off = s.x < 0 || s.x > VIEW.width || s.y < 0 || s.y > VIEW.height ? '  <- off screen' : '';
        console.log(`  ${label.padEnd(20)} ${s.x.toFixed(1).padStart(9)} ${s.y.toFixed(1).padStart(11)}`
            + ` ${s.depth.toFixed(2).padStart(11)}${off}`);
    }
    const c = p.project(vec(0, ZONE_MID_Y, 0));
    const tl = p.project(vec(-PLATE_HALF_WIDTH, ZONE_TOP, 0));
    const br = p.project(vec(PLATE_HALF_WIDTH, ZONE_BOTTOM, 0));
    const head = p.project(vec(BATTER_X, 1.75, BATTER_Z));
    const feet = p.project(vec(BATTER_X, 0, BATTER_Z));
    if (c && tl && br) {
        console.log(`  zone box            ${(br.x - tl.x).toFixed(0)} x ${(br.y - tl.y).toFixed(0)} px`
            + `   centre offset from middle: ${(c.x - VIEW.width / 2).toFixed(0)}, ${(c.y - VIEW.height / 2).toFixed(0)}`);
    }
    if (head && feet) {
        console.log(`  batter height       ${(feet.y - head.y).toFixed(0)} px`
            + `  (${(((feet.y - head.y) / VIEW.height) * 100).toFixed(0)}% of frame)`);
    }
};
report('PITCH_CAMERA (behind the plate — HB2 style)', PITCH_CAMERA);
report('SWING_CAMERA (side, for the impact cut)', SWING_CAMERA);
/**
 * Try variants without editing camera.ts:
 *   node dist/scripts/camera-check.js --try 0.16,1.46,-3.95,0.02,0.385,4.2,26
 */
const arg = process.argv.indexOf('--try');
if (arg >= 0) {
    const n = (process.argv[arg + 1] ?? '').split(',').map(Number);
    if (n.length >= 7 && n.every((v) => Number.isFinite(v))) {
        const base = {
            eye: vec(n[0], n[1], n[2]),
            target: vec(n[3], n[4], n[5]),
            vfov: n[6],
        };
        report('--try', (n.length >= 8 ? { ...base, hfov: n[7] } : base));
    }
    else {
        console.error('--try needs 7 or 8 numbers: ex,ey,ez,tx,ty,tz,vfov[,hfov]');
    }
}
//# sourceMappingURL=camera-check.js.map