'use strict';
/**
 * mp_target_optimizer.js — MomentumPocket T1/T2/T3 multiplier deep study
 * =========================================================================
 * Problem: MP T1=3.0×ATR yields only 37% escape rate (T1 is too far).
 * MFE p50 for MP is 8.5%, but T1 at 3×ATR is ~9-15% depending on band.
 *
 * Method: Use Phase 1 deep_extract bt[] (stop) and mf[] (cumulative MFE)
 * arrays to re-simulate cascade at candidate t1Mult values.
 *
 * The stop never changes — only target distances change.
 * Simulation is EXACT for stop (uses bit0) and for targets (MFE crossing).
 *
 * Grid searches:
 *   1. t1Mult sweep: 0.50 → 4.00 step 0.10  (fixed Phase2 weights, fixed ratios)
 *   2. Joint: (t1Mult × t2/t1 ratio × t3/t1 ratio) near best t1Mult
 *   3. Per-band: each of NORMAL / VOLATILE / HIGH independently
 *   4. Fine weight search at best joint target params
 *   5. Quarterly walk-forward — baseline vs optimized
 *   6. Final recommendation with exact code change
 *
 * Usage: node scripts/mp_target_optimizer.js [deep_extract_TIMESTAMP.json]
 */

const fs   = require('fs');
const path = require('path');

const ARCH_NAMES = ['ORS','VolumeFootprint','CompressionCoil','MomentumPocket','EMAStack','CircuitBreaker'];
const MP_IDX  = 3;
const BANDS   = ['TIGHT','NORMAL','VOLATILE','HIGH'];
const OUT_DIR = path.join(__dirname, 'results');

// Current production constants
const PROD_T1M = 3.0;
const PROD_T2R = 5 / 3;   // T2 = T1 × 5/3
const PROD_T3R = 10 / 3;  // T3 = T1 × 10/3
const PROD_W1 = 0.40, PROD_W2 = 0.10, PROD_W3 = 0.50;  // Phase-2 weights

// ── Load ─────────────────────────────────────────────────────────────────────
const files = fs.readdirSync(OUT_DIR).filter(f => f.startsWith('deep_extract_')).sort().reverse();
if (!files.length) { console.error('No deep_extract found. Run Phase 1 first.'); process.exit(1); }
const extractPath = process.argv[2] || path.join(OUT_DIR, files[0]);
console.log(`\n🎯 MP Target Optimizer`);
console.log(`   Reading: ${extractPath}`);
const { trades } = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
const oosMP = trades.filter(t => t.ai === MP_IDX && t.o === 1);
console.log(`   MP OOS trades: ${oosMP.length.toLocaleString()}`);

// Band distribution
for (let bi = 0; bi < 4; bi++) {
  const n = oosMP.filter(t => t.bi === bi).length;
  if (n) console.log(`     ${BANDS[bi].padEnd(8)}: ${n}`);
}
console.log('');

// ── Core re-simulator ─────────────────────────────────────────────────────────
// Stop uses bt[j] bit0 (ORIGINAL stop level — unchanged by target change).
// Targets checked against mf[j] (cumulative MFE array in %).
// Returns {wPL, t1Hit, t2Hit, t3Hit}.
function resim(t, t1P, t2P, t3P, W1, W2, W3) {
  const { rp, bt, mf, cp, mh } = t;
  const maxJ = Math.min(mh, bt.length, mf.length, cp.length);
  let phase = 1, wLeft = 1.0, wPL = 0;
  let t1Hit = false, t2Hit = false, t3Hit = false;

  for (let j = 0; j < maxJ; j++) {
    const stop = (bt[j] & 1) !== 0;
    const cMFE = mf[j];

    // Phase 1 → stop vs T1
    if (phase === 1) {
      if (stop && cMFE < t1P) { wPL -= wLeft * rp; return { wPL, t1Hit, t2Hit, t3Hit }; }
      if (cMFE >= t1P)        { wPL += W1 * t1P; wLeft = W2 + W3; t1Hit = true; phase = 2; }
    }
    // Phase 2 → stop vs T2
    if (phase === 2) {
      if (stop && cMFE < t2P) { wPL -= wLeft * rp; return { wPL, t1Hit, t2Hit, t3Hit }; }
      if (cMFE >= t2P)        { wPL += W2 * t2P;  wLeft = W3;      t2Hit = true; phase = 3; }
    }
    // Phase 3 → stop vs T3
    if (phase === 3) {
      if (stop && cMFE < t3P) { wPL -= wLeft * rp; return { wPL, t1Hit, t2Hit, t3Hit }; }
      if (cMFE >= t3P)        { wPL += W3 * t3P;  t3Hit = true;    return { wPL, t1Hit, t2Hit, t3Hit }; }
    }

    if (j === maxJ - 1 && wLeft > 0) wPL += wLeft * cp[j];
  }
  return { wPL, t1Hit, t2Hit, t3Hit };
}

// ── Aggregate evaluator ───────────────────────────────────────────────────────
function evalSet(tradeset, t1M, t2R, t3R, W1, W2, W3) {
  if (!tradeset.length) return null;
  let n = 0, wins = 0, sumPL = 0, winPL = 0, lossPL = 0, sumR = 0;
  let ht1 = 0, ht2 = 0, ht3 = 0;

  for (const t of tradeset) {
    const t1P = t1M * t.ap;         // T1 in % above entry
    const t2P = t1P * t2R;
    const t3P = t1P * t3R;
    const { wPL, t1Hit, t2Hit, t3Hit } = resim(t, t1P, t2P, t3P, W1, W2, W3);
    const r = t.rp > 0 ? wPL / t.rp : 0;
    n++; sumPL += wPL; sumR += r;
    if (wPL >= 0) { wins++; winPL += wPL; } else lossPL += Math.abs(wPL);
    if (t1Hit) ht1++;
    if (t2Hit) ht2++;
    if (t3Hit) ht3++;
  }

  const wr   = wins / n * 100;
  const avgPL = sumPL / n;
  const avgR  = sumR / n;
  const pf    = lossPL > 0 ? winPL / lossPL : 99;
  const escT1 = ht1 / n * 100;
  const escT2 = ht2 / n * 100;
  const escT3 = ht3 / n * 100;
  const score = pf * (wr / 100);   // consistent with Phase 2 ranking

  return { n, wr, avgPL, avgR, pf, escT1, escT2, escT3, score };
}

// ── Quarter helper ─────────────────────────────────────────────────────────────
function qOf(ts) {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth()/3)+1}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. T1 MULTIPLIER SWEEP  (fixed Phase-2 weights, fixed T2/T3 ratios)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('═'.repeat(120));
console.log('  1. T1 MULTIPLIER SWEEP — fixed weights (W1=0.40 W2=0.10 W3=0.50) · fixed ratios (T2=T1×5/3, T3=T1×10/3)');
console.log('     "T1avg" = mean T1 target % across all MP OOS trades for that multiplier');
console.log('     ▶ = current production param   ◀ = top-score row');
console.log('═'.repeat(120));
console.log(`  ${'t1M'.padEnd(5)} ${'T1avg%'.padStart(8)} ${'T2avg%'.padStart(8)} ${'T3avg%'.padStart(8)} ${'WR%'.padStart(7)} ${'AvgPL%'.padStart(9)} ${'PF'.padStart(7)} ${'AvgR'.padStart(7)} ${'escT1%'.padStart(8)} ${'escT2%'.padStart(8)} ${'escT3%'.padStart(8)} ${'Score'.padStart(8)}`);
console.log('  ' + '-'.repeat(110));

const t1Vals = [];
for (let m10 = 5; m10 <= 40; m10++) t1Vals.push(m10 / 10);

const avgAtrPct = oosMP.reduce((s, t) => s + t.ap, 0) / oosMP.length;

const sweep1 = [];
let topScore1 = -Infinity;
for (const t1M of t1Vals) {
  const ev = evalSet(oosMP, t1M, PROD_T2R, PROD_T3R, PROD_W1, PROD_W2, PROD_W3);
  if (!ev) continue;
  const t1avg = (t1M * avgAtrPct).toFixed(1);
  const t2avg = (t1M * avgAtrPct * PROD_T2R).toFixed(1);
  const t3avg = (t1M * avgAtrPct * PROD_T3R).toFixed(1);
  sweep1.push({ t1M, t1avg, ...ev });
  if (ev.score > topScore1) topScore1 = ev.score;
}

const bestT1M = sweep1.reduce((b, r) => r.score > b.score ? r : b, sweep1[0]);

for (const r of sweep1) {
  const cur  = Math.abs(r.t1M - PROD_T1M) < 0.01 ? '▶' : ' ';
  const best = r === bestT1M ? '◀' : ' ';
  console.log(
    `${cur} ${r.t1M.toFixed(2).padEnd(4)} ${best} ` +
    `${(r.t1avg+'%').padStart(7)} ${(r.t2avg+'%').padStart(8)} ${(r.t3avg+'%').padStart(8)} ` +
    `${r.wr.toFixed(1).padStart(6)}% ${(r.avgPL>=0?'+':'')}${r.avgPL.toFixed(2).padStart(8)}% ` +
    `${r.pf.toFixed(2).padStart(6)} ${(r.avgR>=0?'+':'')}${r.avgR.toFixed(2).padStart(6)} ` +
    `${r.escT1.toFixed(1).padStart(7)}% ${r.escT2.toFixed(1).padStart(7)}% ${r.escT3.toFixed(1).padStart(7)}%  ${r.score.toFixed(3).padStart(7)}`
  );
}

const blAll = evalSet(oosMP, PROD_T1M, PROD_T2R, PROD_T3R, PROD_W1, PROD_W2, PROD_W3);
console.log(`\n  Current (t1M=3.0): WR=${blAll.wr.toFixed(1)}% PF=${blAll.pf.toFixed(2)} escT1=${blAll.escT1.toFixed(1)}% AvgPL=+${blAll.avgPL.toFixed(2)}% Score=${blAll.score.toFixed(3)}`);
console.log(`  Best sweep  (t1M=${bestT1M.t1M.toFixed(2)}): WR=${bestT1M.wr.toFixed(1)}% PF=${bestT1M.pf.toFixed(2)} escT1=${bestT1M.escT1.toFixed(1)}% AvgPL=+${bestT1M.avgPL.toFixed(2)}% Score=${bestT1M.score.toFixed(3)}`);

// ═══════════════════════════════════════════════════════════════════════════════
// 2. JOINT GRID: t1Mult × T2 ratio × T3 ratio
//    Fine search around bestT1M.t1M  — varying target spacing
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\n' + '═'.repeat(120));
console.log('  2. JOINT GRID — t1Mult × T2/T1 ratio × T3/T1 ratio  (Phase-2 weights)');
console.log('     Question: does changing the T2 or T3 gap add value beyond lowering T1?');
console.log('═'.repeat(120));

// Fine t1M range: ±0.7 around best, step 0.10
const T1_FINE = [];
for (let m10 = Math.max(5, Math.round((bestT1M.t1M - 0.7)*10));
         m10 <= Math.min(40, Math.round((bestT1M.t1M + 0.7)*10)); m10++) {
  T1_FINE.push(m10 / 10);
}
const T2_RATIOS = [1.2, 1.4, 5/3, 2.0, 2.5, 3.0];
const T3_RATIOS = [2.0, 2.5, 10/3, 4.5, 6.0, 8.0];

const joint = [];
for (const t1M of T1_FINE)
  for (const t2R of T2_RATIOS)
    for (const t3R of T3_RATIOS) {
      if (t3R <= t2R + 0.5) continue;   // T3 must be meaningfully past T2
      const ev = evalSet(oosMP, t1M, t2R, t3R, PROD_W1, PROD_W2, PROD_W3);
      if (ev) joint.push({ t1M, t2R, t3R, ...ev });
    }
joint.sort((a, b) => b.score - a.score);

console.log(`  ${'t1M'.padEnd(5)} ${'t2R'.padEnd(6)} ${'t3R'.padEnd(6)} ${'T1avg%'.padStart(7)} ${'T2avg%'.padStart(7)} ${'T3avg%'.padStart(7)} ${'WR%'.padStart(7)} ${'AvgPL%'.padStart(9)} ${'PF'.padStart(7)} ${'escT1%'.padStart(8)} ${'escT2%'.padStart(8)} ${'Score'.padStart(8)}`);
console.log('  ' + '-'.repeat(110));
for (let i = 0; i < Math.min(25, joint.length); i++) {
  const r = joint[i];
  const mark = i === 0 ? '◀' : ' ';
  const prod = (Math.abs(r.t1M-PROD_T1M)<0.01 && Math.abs(r.t2R-PROD_T2R)<0.01 && Math.abs(r.t3R-PROD_T3R)<0.01) ? '▶' : ' ';
  console.log(
    `${prod} ${r.t1M.toFixed(2).padEnd(4)} ${mark} ${r.t2R.toFixed(2).padEnd(5)} ${r.t3R.toFixed(2).padEnd(5)} ` +
    `${(r.t1M*avgAtrPct).toFixed(1).padStart(6)}% ${(r.t1M*avgAtrPct*r.t2R).toFixed(1).padStart(6)}% ${(r.t1M*avgAtrPct*r.t3R).toFixed(1).padStart(6)}% ` +
    `${r.wr.toFixed(1).padStart(6)}% ${(r.avgPL>=0?'+':'')}${r.avgPL.toFixed(2).padStart(8)}% ` +
    `${r.pf.toFixed(2).padStart(6)} ${r.escT1.toFixed(1).padStart(7)}% ${r.escT2.toFixed(1).padStart(7)}% ${r.score.toFixed(3).padStart(8)}`
  );
}

const bestJoint = joint[0];
console.log(`\n  Joint winner: t1M=${bestJoint.t1M.toFixed(2)} T2/T1=${bestJoint.t2R.toFixed(2)} T3/T1=${bestJoint.t3R.toFixed(2)}`);

// ═══════════════════════════════════════════════════════════════════════════════
// 3. PER-BAND OPTIMAL t1Mult  (each band separately)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\n' + '═'.repeat(120));
console.log('  3. PER-BAND T1 MULTIPLIER (NORMAL / VOLATILE / HIGH independently)');
console.log('     Shows whether a per-band t1Mult would beat a single universal multiplier');
console.log('═'.repeat(120));

const perBandBest = {};

for (let bi = 1; bi <= 3; bi++) {
  const bTrades = oosMP.filter(t => t.bi === bi);
  if (bTrades.length < 10) { console.log(`  ${BANDS[bi]}: too few trades (${bTrades.length})`); continue; }
  const bAvgAtr = bTrades.reduce((s, t) => s + t.ap, 0) / bTrades.length;

  const bRows = t1Vals.map(t1M => {
    const ev = evalSet(bTrades, t1M, bestJoint.t2R, bestJoint.t3R, PROD_W1, PROD_W2, PROD_W3);
    return ev ? { t1M, ...ev } : null;
  }).filter(Boolean);

  const bBest = bRows.reduce((b, r) => r.score > b.score ? r : b, bRows[0]);
  perBandBest[bi] = bBest;

  const blB = evalSet(bTrades, PROD_T1M, bestJoint.t2R, bestJoint.t3R, PROD_W1, PROD_W2, PROD_W3);
  console.log(`\n  ── ${BANDS[bi].padEnd(8)} (n=${bTrades.length}, avgATR=${bAvgAtr.toFixed(1)}%) ─────────────────────────────────────────`);
  console.log(`  Baseline t1M=3.0: WR=${blB.wr.toFixed(1)}% PF=${blB.pf.toFixed(2)} escT1=${blB.escT1.toFixed(1)}% AvgPL=+${blB.avgPL.toFixed(2)}%`);
  console.log(`  Best    t1M=${bBest.t1M.toFixed(2)}: WR=${bBest.wr.toFixed(1)}% PF=${bBest.pf.toFixed(2)} escT1=${bBest.escT1.toFixed(1)}% AvgPL=+${bBest.avgPL.toFixed(2)}%`);
  console.log(`  Δ improvement:  ΔWR=${(bBest.wr-blB.wr>=0?'+':'')+(bBest.wr-blB.wr).toFixed(1)}pp  ΔPF=${(bBest.pf-blB.pf>=0?'+':'')+(bBest.pf-blB.pf).toFixed(2)}  ΔAvgPL=${(bBest.avgPL-blB.avgPL>=0?'+':'')+(bBest.avgPL-blB.avgPL).toFixed(2)}%`);

  console.log(`  t1M sweep (top-8):`);
  const top8 = [...bRows].sort((a,b) => b.score - a.score).slice(0, 8);
  for (const r of top8) {
    const mark = r === bBest ? '◀' : ' ';
    console.log(`  ${mark} t1M=${r.t1M.toFixed(2)} T1≈${(r.t1M*bAvgAtr).toFixed(1)}%  WR=${r.wr.toFixed(1)}%  PF=${r.pf.toFixed(2)}  escT1=${r.escT1.toFixed(1)}%  escT2=${r.escT2.toFixed(1)}%  Score=${r.score.toFixed(3)}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. FINE WEIGHT SEARCH at joint-best target params
// ═══════════════════════════════════════════════════════════════════════════════
const { t1M: OPT_T1M, t2R: OPT_T2R, t3R: OPT_T3R } = bestJoint;

console.log('\n\n' + '═'.repeat(120));
console.log(`  4. FINE WEIGHT SEARCH — target locked at t1M=${OPT_T1M} T2/T1=${OPT_T2R.toFixed(2)} T3/T1=${OPT_T3R.toFixed(2)}`);
console.log('     Question: are the Phase-2 weights (0.40/0.10/0.50) still optimal at the new targets?');
console.log('═'.repeat(120));

const W1_VALS = [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70];
const W2_VALS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
const wRows = [];

for (const w1 of W1_VALS)
  for (const w2 of W2_VALS) {
    const w3 = Math.round((1 - w1 - w2) * 1000) / 1000;
    if (w3 < 0.05 || w3 > 0.90) continue;
    const ev = evalSet(oosMP, OPT_T1M, OPT_T2R, OPT_T3R, w1, w2, w3);
    if (ev) wRows.push({ w1, w2, w3, ...ev });
  }
wRows.sort((a, b) => b.score - a.score);

console.log(`  ${'W1'.padEnd(5)} ${'W2'.padEnd(5)} ${'W3'.padEnd(5)} ${'WR%'.padStart(7)} ${'AvgPL%'.padStart(9)} ${'PF'.padStart(7)} ${'AvgR'.padStart(7)} ${'escT1%'.padStart(8)} ${'Score'.padStart(8)}`);
console.log('  ' + '-'.repeat(90));
for (let i = 0; i < Math.min(20, wRows.length); i++) {
  const r = wRows[i];
  const mark = i === 0 ? '◀' : ' ';
  const p2m  = (r.w1===PROD_W1 && r.w2===PROD_W2) ? '●' : ' ';
  console.log(
    `${mark}${p2m} ${r.w1.toFixed(2).padEnd(4)} ${r.w2.toFixed(2).padEnd(4)} ${r.w3.toFixed(2).padEnd(4)} ` +
    `${r.wr.toFixed(1).padStart(6)}% ${(r.avgPL>=0?'+':'')}${r.avgPL.toFixed(2).padStart(8)}% ` +
    `${r.pf.toFixed(2).padStart(6)} ${(r.avgR>=0?'+':'')}${r.avgR.toFixed(2).padStart(6)} ${r.escT1.toFixed(1).padStart(7)}%  ${r.score.toFixed(3).padStart(7)}`
  );
}
const bestFull = wRows[0];

// ═══════════════════════════════════════════════════════════════════════════════
// 5. QUARTERLY WALK-FORWARD — Baseline vs Optimized
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n\n' + '═'.repeat(120));
console.log(`  5. QUARTERLY WALK-FORWARD — Baseline (t1M=3.0 W=0.40/0.10/0.50) vs Optimized`);
console.log(`     Optimized: t1M=${OPT_T1M} T2/T1=${OPT_T2R.toFixed(2)} T3/T1=${OPT_T3R.toFixed(2)} W1=${bestFull.w1} W2=${bestFull.w2} W3=${bestFull.w3}`);
console.log('═'.repeat(120));

const byQ = {};
for (const t of oosMP) {
  const q = qOf(t.di);
  (byQ[q] = byQ[q] || []).push(t);
}

console.log(`  ${'Quarter'.padEnd(9)} ${'N'.padStart(5)}  ${'BL WR'.padStart(7)} ${'BL PF'.padStart(7)} ${'BL PL%'.padStart(8)}  ${'OPT WR'.padStart(8)} ${'OPT PF'.padStart(7)} ${'OPT PL%'.padStart(9)}  ${'ΔWR'.padStart(6)} ${'ΔPF'.padStart(6)} ${'ΔPL'.padStart(6)}`);
console.log('  ' + '-'.repeat(110));
for (const q of Object.keys(byQ).sort()) {
  const qt = byQ[q];
  const bl  = evalSet(qt, PROD_T1M, PROD_T2R, PROD_T3R, PROD_W1, PROD_W2, PROD_W3);
  const opt = evalSet(qt, OPT_T1M,  OPT_T2R,  OPT_T3R,  bestFull.w1, bestFull.w2, bestFull.w3);
  if (!bl || !opt) continue;
  const dwr = opt.wr - bl.wr, dpf = opt.pf - bl.pf, dpl = opt.avgPL - bl.avgPL;
  console.log(
    `  ${q.padEnd(9)} ${String(qt.length).padStart(5)}  ` +
    `${bl.wr.toFixed(1).padStart(6)}% ${bl.pf.toFixed(2).padStart(6)} ${(bl.avgPL>=0?'+':'')}${bl.avgPL.toFixed(2).padStart(7)}%  ` +
    `${opt.wr.toFixed(1).padStart(7)}% ${opt.pf.toFixed(2).padStart(6)} ${(opt.avgPL>=0?'+':'')}${opt.avgPL.toFixed(2).padStart(8)}%  ` +
    `${(dwr>=0?'+':'')+(dwr.toFixed(1)).padStart(5)}  ${(dpf>=0?'+':'')+(dpf.toFixed(2)).padStart(5)}  ${(dpl>=0?'+':'')+(dpl.toFixed(2)).padStart(5)}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. FINAL RECOMMENDATION
// ═══════════════════════════════════════════════════════════════════════════════
const fullOpt = evalSet(oosMP, OPT_T1M, OPT_T2R, OPT_T3R, bestFull.w1, bestFull.w2, bestFull.w3);
const dWR = fullOpt.wr - blAll.wr, dPF = fullOpt.pf - blAll.pf, dPL = fullOpt.avgPL - blAll.avgPL;
const dEsc = fullOpt.escT1 - blAll.escT1;

console.log('\n\n' + '═'.repeat(120));
console.log('  6. FINAL RECOMMENDATION');
console.log('═'.repeat(120));

console.log(`\n  ── BEFORE (production) ────────────────────────────────────────────`);
console.log(`     t1Mult=3.00  T2/T1=${PROD_T2R.toFixed(2)}  T3/T1=${PROD_T3R.toFixed(2)}`);
console.log(`     W1=0.40  W2=0.10  W3=0.50`);
console.log(`     WR=${blAll.wr.toFixed(1)}%  PF=${blAll.pf.toFixed(2)}  AvgPL=+${blAll.avgPL.toFixed(2)}%  escT1=${blAll.escT1.toFixed(1)}%  escT2=${blAll.escT2.toFixed(1)}%  escT3=${blAll.escT3.toFixed(1)}%`);

console.log(`\n  ── AFTER (recommended) ────────────────────────────────────────────`);
console.log(`     t1Mult=${OPT_T1M.toFixed(2)}  T2/T1=${OPT_T2R.toFixed(2)}  T3/T1=${OPT_T3R.toFixed(2)}`);
console.log(`     W1=${bestFull.w1.toFixed(2)}  W2=${bestFull.w2.toFixed(2)}  W3=${bestFull.w3.toFixed(2)}`);
console.log(`     WR=${fullOpt.wr.toFixed(1)}%  PF=${fullOpt.pf.toFixed(2)}  AvgPL=+${fullOpt.avgPL.toFixed(2)}%  escT1=${fullOpt.escT1.toFixed(1)}%  escT2=${fullOpt.escT2.toFixed(1)}%  escT3=${fullOpt.escT3.toFixed(1)}%`);

console.log(`\n  ── Δ improvement ─────────────────────────────────────────────────`);
console.log(`     ΔWR  = ${(dWR>=0?'+':'')+dWR.toFixed(1)}pp`);
console.log(`     ΔPF  = ${(dPF>=0?'+':'')+dPF.toFixed(2)}`);
console.log(`     ΔAvgPL = ${(dPL>=0?'+':'')+dPL.toFixed(2)}%`);
console.log(`     ΔescT1 = ${(dEsc>=0?'+':'')+dEsc.toFixed(1)}pp  (escape rate recovery)`);

console.log(`\n  ── Per-band universal recommendation ─────────────────────────────`);
const perBandResults = Object.entries(perBandBest).map(([bi, b]) =>
  `${BANDS[+bi].padEnd(8)}: t1M=${b.t1M.toFixed(2)}  T1≈${(b.t1M*oosMP.filter(t=>t.bi===+bi).reduce((s,t)=>s+t.ap,0)/oosMP.filter(t=>t.bi===+bi).length).toFixed(1)}%  WR=${b.wr.toFixed(1)}%  PF=${b.pf.toFixed(2)}  escT1=${b.escT1.toFixed(1)}%`
);
for (const s of perBandResults) console.log(`     ${s}`);

// Recommend single vs per-band
const singleScore = fullOpt.score;
const perBandAvgScore = Object.values(perBandBest).reduce((s, b) => s + b.score, 0) / Object.values(perBandBest).length;
const perBandVals = Object.values(perBandBest).map(b => b.t1M);
const convergent = Math.max(...perBandVals) - Math.min(...perBandVals) < 0.4;

console.log(`\n  Per-band t1M spread: [${perBandVals.map(v=>v.toFixed(2)).join(', ')}]  (${convergent ? 'CONVERGENT — single multiplier is sufficient' : 'DIVERGENT — consider per-band implementation'})`);

console.log('\n  ── stockEngine.ts code change ────────────────────────────────────');
console.log(`  // archetypePriceEngine(), around line 2535:`);
console.log(`  Before: const t1Mult = isVF ? 1.0 : isMP ? 3.0 : 1.5;`);
console.log(`  After:  const t1Mult = isVF ? 1.0 : isMP ? ${OPT_T1M.toFixed(2)} : 1.5;`);
if (Math.abs(OPT_T2R - PROD_T2R) > 0.05) {
  const newT2Val = `(${OPT_T2R.toFixed(4)})`;
  console.log(`  Before: const t2Mult = t1Mult * (5 / 3);`);
  console.log(`  After:  const t2Mult = t1Mult * ${newT2Val};`);
}
if (Math.abs(OPT_T3R - PROD_T3R) > 0.05) {
  const newT3Val = `(${OPT_T3R.toFixed(4)})`;
  console.log(`  Before: const t3Mult = t1Mult * (10 / 3);`);
  console.log(`  After:  const t3Mult = t1Mult * ${newT3Val};`);
}
if (Math.abs(bestFull.w1 - PROD_W1) > 0.01 || Math.abs(bestFull.w2 - PROD_W2) > 0.01) {
  console.log(`\n  Pro Analytics: update MP entry in ARCH_EXIT to W1=${bestFull.w1} W2=${bestFull.w2} W3=${bestFull.w3}`);
}

// ── Save ─────────────────────────────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
const outFile = path.join(OUT_DIR, `mp_target_opt_${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({
  stamp, avgAtrPct,
  baseline: { t1M: PROD_T1M, t2R: PROD_T2R, t3R: PROD_T3R, W1: PROD_W1, W2: PROD_W2, W3: PROD_W3, ...blAll },
  bestT1M, bestJoint, bestFull, fullOpt,
  perBandBest,
  sweep1: sweep1.slice(0, 40),
  joint: joint.slice(0, 50),
  wRows: wRows.slice(0, 30),
}, null, 2));
console.log(`\n  Saved: ${outFile}`);
console.log('\n  ✅ MP target optimization complete.\n');
