/**
 * PROMPT.md 3-3: print the physics numbers so they can be checked against
 * reality, rather than asserting that the model "looks right".
 *
 * Run: npx tsc && node dist/scripts/physics-check.js
 */

import { simulateBattedBall, spinForContact, dragCoefficient, liftCoefficient }
  from '../src/core/physics.js';
import { abilityAt } from '../src/core/ability.js';
import { resolveContact, catchRadius } from '../src/core/bat.js';
import { judgeBattedBall, fenceDistance } from '../src/core/stadium.js';
import {
  PLAYERS, PLAYER_IDS, MAX_EXIT_KMH, BASE_LAUNCH_ANGLE, CURSOR_RADIUS,
  REFERENCE_AIR_DENSITY, AIR_DENSITY, EXIT_VELOCITY_MAX,
  FENCE_CENTRE, FENCE_ALLEY, FENCE_LINE, FENCE_HEIGHT, DEFAULT_CONTACT_HEIGHT,
} from '../src/core/constants.js';

/** Scripts measure the mid-career batter; level 1 and 99 are different games. */
const LEVEL = 50;

const line = (s = ''): void => { process.stdout.write(s + '\n'); };
const f = (n: number, w: number, d = 1): string => n.toFixed(d).padStart(w);

const carry = (kmh: number, deg: number, rpm?: number, rho?: number): number =>
  simulateBattedBall({
    exitVelocity: kmh / 3.6,
    launchAngle: deg,
    sprayAngle: 0,
    backspinRpm: rpm ?? spinForContact(deg, 0).backspinRpm,
    sidespinRpm: 0,
    contactHeight: DEFAULT_CONTACT_HEIGHT,
    ...(rho === undefined ? {} : { airDensity: rho }),
  }).distance;

line('='.repeat(76));
line('物理チェック  scripts/physics-check.ts');
line('='.repeat(76));

// ---------------------------------------------------------------------------
line();
line('■ 1. 係数（一次情報。調整禁止）');
line(`   Cd(0rpm)=${dragCoefficient(0).toFixed(4)}  Cd(2000)=${dragCoefficient(2000).toFixed(4)}`
  + `  Cd(3600)=${dragCoefficient(3600).toFixed(4)}   ← 回転が増えると抗力も増える`);
line(`   Cl(S=0.10)=${liftCoefficient(0.10).toFixed(3)}  Cl(S=0.20)=${liftCoefficient(0.20).toFixed(3)}`
  + `  Cl(S→∞)=${liftCoefficient(1e6).toFixed(3)}`);
line(`   空気密度  ゲーム標準 ${AIR_DENSITY}  / ベンチマーク照合用 ${REFERENCE_AIR_DENSITY}`);

// ---------------------------------------------------------------------------
line();
line('■ 2. 公開ベンチマークとの照合（最大飛距離エンベロープ・75°F条件）');
line('     初速km/h   角度   回転rpm    本実装      公開値      誤差');
const bench: readonly [number, number, number, number][] = [
  [145.4, 28.6, 2480, 110], [155.7, 27.8, 2384, 120], [166.2, 27.0, 2288, 130],
  [177.1, 26.3, 2204, 140], [188.2, 25.6, 2120, 150],
];
let worst = 0;
for (const [kmh, deg, rpm, want] of bench) {
  const got = carry(kmh, deg, rpm, REFERENCE_AIR_DENSITY);
  const err = ((got - want) / want) * 100;
  worst = Math.max(worst, Math.abs(err));
  line(`     ${f(kmh, 7)}  ${f(deg, 5)}   ${String(rpm).padStart(6)}   ${f(got, 7)} m`
    + `  ${f(want, 7)} m   ${f(err, 6, 2)} %`);
}
line(`     最大誤差 ${worst.toFixed(2)} %   ${worst < 1 ? '合格（1%以内）' : '不合格'}`);

// ---------------------------------------------------------------------------
line();
line('■ 3. PROMPT.md 3-3 指定: 初速180km/h・打ち出し角30°・標準バックスピン');
const spin30 = spinForContact(30, 0).backspinRpm;
line(`     回転 ${spin30} rpm（打ち出し角から算出）  →  飛距離 ${carry(180, 30).toFixed(1)} m`);
line(`     現実のMLB平均HR飛距離 121.1 m / 典型レンジ 110.9〜130.8 m / 記録 153.9 m`);

// ---------------------------------------------------------------------------
line();
line('■ 4. 打ち出し角と飛距離（回転は角度から算出。ゲーム標準の空気）');
const angles = [14, 18, 22, 26, 29, 34, 38];
line('     初速     ' + angles.map((a) => `${a}°`.padStart(8)).join(''));
for (const kmh of [150, 158, 166, 172, 178, 185, 195]) {
  line(`     ${f(kmh, 4, 0)} km/h` + angles.map((a) => f(carry(kmh, a), 8)).join(''));
}
line('     回転rpm  ' + angles.map((a) => String(spinForContact(a, 0).backspinRpm).padStart(8)).join(''));

// ---------------------------------------------------------------------------
line();
line('■ 5. 各初速での最適打ち出し角（現実は25〜30°）');
for (const kmh of [150, 166, 178, 185, 195]) {
  let best = { deg: 0, dist: -1 };
  for (let deg = 10; deg <= 45; deg += 0.5) {
    const d = carry(kmh, deg);
    if (d > best.dist) best = { deg, dist: d };
  }
  line(`     ${f(kmh, 4, 0)} km/h → ${f(best.deg, 5)}°  ${f(best.dist, 7)} m`);
}

// ---------------------------------------------------------------------------
line();
line('■ 6. バックスピンと飛距離（178km/h・28°）— 多いほど飛ぶわけではない');
for (const rpm of [600, 1200, 1800, 2500, 3200, 3600]) {
  const r = simulateBattedBall({
    exitVelocity: 178 / 3.6, launchAngle: 28, sprayAngle: 0,
    backspinRpm: rpm, sidespinRpm: 0, contactHeight: DEFAULT_CONTACT_HEIGHT,
  });
  line(`     ${String(rpm).padStart(5)} rpm  Cd=${dragCoefficient(rpm).toFixed(4)}`
    + `  →  ${f(r.distance, 7)} m   滞空 ${r.hangTime.toFixed(2)} s   頂点 ${f(r.apex, 5)} m`);
}

// ---------------------------------------------------------------------------
line();
line('■ 7. 球場');
line(`     センター ${FENCE_CENTRE} m / 左右中間 ${FENCE_ALLEY} m / 両翼 ${FENCE_LINE} m`
  + ` / フェンス高 ${FENCE_HEIGHT} m`);
line('     角度別フェンス距離: '
  + [0, 10, 22.5, 35, 45].map((a) => `${a}°=${fenceDistance(a).toFixed(0)}m`).join('  '));

// ---------------------------------------------------------------------------
line();
line('■ 8. 選手別: 最善手（e=0, t=0）での打球');
line('     選手      ミート パワー 弾道  カーソル半径  初速km/h  角度  飛距離   判定');
for (const id of PLAYER_IDS) {
  const p = PLAYERS[id];
  const c = resolveContact({
    ability: abilityAt(id, LEVEL),
    cursor: { x: 0, y: DEFAULT_CONTACT_HEIGHT },
    ball: { x: 0, y: DEFAULT_CONTACT_HEIGHT },
    timingError: 0,
  });
  const r = simulateBattedBall({
    exitVelocity: c.exitVelocity, launchAngle: c.launchAngle, sprayAngle: c.sprayAngle,
    backspinRpm: c.spin.backspinRpm, sidespinRpm: c.spin.sidespinRpm,
    contactHeight: c.contactHeight,
  });
  const j = judgeBattedBall(r.trail, r.landing, r.distance);
  line(`     ${p.roman.padEnd(9)} ${p.meet}      ${p.power}     ${p.trajectory}`
    + `     ${f(catchRadius(abilityAt(id, LEVEL)), 7, 3)} m  ${f(c.exitVelocity * 3.6, 8)}`
    + `  ${f(c.launchAngle, 5)}  ${f(r.distance, 6)} m  ${j.outcome}`);
}

// ---------------------------------------------------------------------------
line();
line('■ 9. 敦司のスキル「上を狙う」— 弾道2の低さを技術で補えているか');
line('     アンダーカット   初速km/h   角度   飛距離   フェンス120m');
for (const u of [0, 0.005, 0.010, 0.013, 0.020, 0.030]) {
  const c = resolveContact({
    ability: abilityAt('atsushi', LEVEL),
    cursor: { x: 0, y: DEFAULT_CONTACT_HEIGHT - u },
    ball: { x: 0, y: DEFAULT_CONTACT_HEIGHT },
    timingError: 0,
  });
  const r = simulateBattedBall({
    exitVelocity: c.exitVelocity, launchAngle: c.launchAngle, sprayAngle: c.sprayAngle,
    backspinRpm: c.spin.backspinRpm, sidespinRpm: c.spin.sidespinRpm,
    contactHeight: c.contactHeight,
  });
  const j = judgeBattedBall(r.trail, r.landing, r.distance);
  line(`     ${f(u * 100, 10, 1)} cm  ${f(c.exitVelocity * 3.6, 9)}  ${f(c.launchAngle, 6)}`
    + `  ${f(r.distance, 7)} m   ${j.outcome === 'homeRun' ? '越える' : '届かない'}`);
}

// ---------------------------------------------------------------------------
line();
line('■ 10. 上限チェック');
let hardest = 0;
for (let deg = 10; deg <= 45; deg += 0.5) {
  hardest = Math.max(hardest, carry(EXIT_VELOCITY_MAX * 3.6, deg, 2200));
}
line(`     初速上限 ${(EXIT_VELOCITY_MAX * 3.6).toFixed(1)} km/h（現実の記録 197.8 km/h）`);
line(`     そのときの最長飛距離 ${hardest.toFixed(1)} m（現実の記録 153.9 m）`);
line(`     ランク別最大初速: ` + (Object.keys(MAX_EXIT_KMH) as (keyof typeof MAX_EXIT_KMH)[])
  .map((r) => `${r}=${MAX_EXIT_KMH[r]}`).join(' '));
line(`     ランク別カーソル半径: ` + (Object.keys(CURSOR_RADIUS) as (keyof typeof CURSOR_RADIUS)[])
  .map((r) => `${r}=${CURSOR_RADIUS[r]}`).join(' '));
line(`     弾道別ベース角: ` + (Object.keys(BASE_LAUNCH_ANGLE) as unknown as (1 | 2 | 3 | 4)[])
  .map((t) => `${t}=${BASE_LAUNCH_ANGLE[t]}°`).join(' '));
line();
line('='.repeat(76));
