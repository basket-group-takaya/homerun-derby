/**
 * Drive the whole loop headlessly: pitch, aim, swing, fly, land.
 *
 * Proves the state machine end to end without needing a human to hit a 0.4 s
 * pitch, and gives an early read on the numbers M7 will have to balance.
 *
 * Run: npx tsc && node dist/scripts/swing-demo.js
 */

import type { GameState } from '../src/core/game.js';
import { initialState, step } from '../src/core/game.js';
import { PLAYERS, PLAYER_IDS, T_SWING } from '../src/core/constants.js';
import type { PlayerId } from '../src/core/constants.js';
import { PITCH_LABEL } from '../src/core/pitch.js';

const TICK = 1 / 60;
const line = (s = ''): void => { process.stdout.write(s + '\n'); };
const f = (n: number, w: number, d = 1): string => n.toFixed(d).padStart(w);

/**
 * Play one pitch. `frameOffset` mistimes the swing by that many 60fps frames,
 * `aimError` moves the cursor off the ball by that many metres.
 */
const playOne = (
  seed: number, player: PlayerId, frameOffset: number, aimError: number,
): GameState => {
  let s = initialState(seed, player);
  s = step(s, { kind: 'pitch' });
  const flight = s.flight;
  if (!flight) throw new Error('no pitch');

  // aim at where the ball will actually cross, offset horizontally if asked
  s = step(s, {
    kind: 'moveCursor',
    x: flight.crossPoint.x + aimError,
    y: flight.crossPoint.y,
  });

  // swing so the bat arrives frameOffset frames off the crossing
  const swingAt = flight.crossTime - T_SWING + frameOffset * TICK;
  let guard = 0;
  while (s.phase === 'pitching' && guard++ < 600) {
    if (s.time >= swingAt) { s = step(s, { kind: 'swing' }); break; }
    s = step(s, { kind: 'tick', dt: TICK });
  }
  // let the batted ball land
  guard = 0;
  while (s.phase === 'flight' && guard++ < 2000) s = step(s, { kind: 'tick', dt: TICK });
  return s;
};

line('='.repeat(78));
line('スイング検証  scripts/swing-demo.ts');
line('='.repeat(78));

line();
line('■ 完璧な入力（カーソルをボールに合わせ、タイミング誤差0）');
line('  選手      球種            初速km/h   角度   方向    飛距離   判定       判定名');
for (const id of PLAYER_IDS) {
  for (const seed of [1, 2, 3]) {
    const s = playOne(seed, id, 0, 0);
    const c = s.swing?.contact;
    const fld = s.swing?.field;
    if (!c) { line(`  ${id}: no contact`); continue; }
    line(`  ${PLAYERS[id].roman.padEnd(9)} ${(PITCH_LABEL[s.pitch!.type]).padEnd(13)}`
      + ` ${f(c.exitVelocity * 3.6, 8)} ${f(c.launchAngle, 6)} ${f(c.sprayAngle, 6)}`
      + ` ${f(fld?.distance ?? 0, 8)} m ${(fld?.outcome ?? '-').padEnd(10)} ${c.kind}`);
  }
}

line();
line('■ タイミングをずらすと何が起きるか（貴也・同じ球）');
line('  ずれ      初速km/h   角度   方向     飛距離   判定');
for (const off of [-5, -3, -2, -1, 0, 1, 2, 3, 5]) {
  const s = playOne(1, 'takaya', off, 0);
  const c = s.swing?.contact;
  const fld = s.swing?.field;
  if (!c) continue;
  const tag = c.kind === 'whiff' ? '空振り' : (fld?.outcome ?? '');
  line(`  ${String(off).padStart(3)} フレーム ${f(c.exitVelocity * 3.6, 8)}`
    + ` ${f(c.launchAngle, 6)} ${f(c.sprayAngle, 6)} ${f(fld?.distance ?? 0, 8)} m  ${tag}`);
}

line();
line('■ HR率のごく粗い先行測定（各選手 60球 × 3精度）');
line('  ※ M7 の scripts/difficulty.ts が正式版。ここでは傾向だけ見る');
line('  選手       完璧    ±2フレーム   ±5フレーム');
for (const id of PLAYER_IDS) {
  const rates: string[] = [];
  for (const spread of [0, 2, 5]) {
    let hr = 0;
    let n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      // alternate the sign so the sample is symmetric
      const off = spread === 0 ? 0 : (seed % 2 === 0 ? spread : -spread);
      const s = playOne(seed, id, off, 0);
      if (!s.pitch?.intendedStrike) continue;
      n++;
      if (s.swing?.field?.outcome === 'homeRun') hr++;
    }
    rates.push(`${f((hr / Math.max(1, n)) * 100, 5, 1)}%`.padStart(11));
  }
  line(`  ${PLAYERS[id].roman.padEnd(10)}${rates.join('')}`);
}
line();
line('='.repeat(78));
