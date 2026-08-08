'use strict';
/**
 * vf_optimizer.js — VolumeFootprint hyper-tune
 * =============================================
 * Problem: T1=3.8% avg, MFEp50=8.1%, W1=0.70 exits 70% of position at a tiny 3.8% move
 *          while T2 hit=73% and T3 hit=60% show strong follow-through.
 *
 * Sweeps: t1Mult (0.5→4.0) × T3/T1 ratio × W1/W2/W3 weights
 * Uses MFE-based target detection (stop detection via bit-fields, exact).
 */

const fs   = require('fs');
const path = require('path');

const RESULTS_DIR = path.join(__dirname, 'results');
const VF_AI       = 1;   // VolumeFootprint archetype index in deep_extract
const OOS_DATE    = new Date('2024-01-01').getTime() / 1000;

// ── Load latest extract ───────────────────────────────────────────────────────
function loadVFTrades() {
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith('deep_extract_') && f.endsWith('.json'))
    .sort().reverse();
  if (!files.length) { console.error('No deep_extract found'); process.exit(1); }
  const fp = path.join(RESULTS_DIR, files[0]);
  console.log(`\n  Extract: ${files[0]}\n`);
  const { trades } = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const oos = trades.filter(t => t.ai === VF_AI && t.o);
  const is_ = trades.filter(t => t.ai === VF_AI && !t.o);
  console.log(`  VF trades: OOS n=${oos.length}  IS n=${is_.length}\n`);
  return { oos, is: is_ };
}

// ── Re-simulator (MFE-based targets, bit-field stops) ─────────────────────────
function resim(t, t1P, t2P, t3P, W1, W2, W3) {
  const maxJ = Math.min(t.mh, t.bt.length, t.cp.length, t.mf.length);
  let phase = 1, wLeft = 1.0, wPL = 0;
  let t1Hit = false, t2Hit = false, t3Hit = false;

  for (let j = 0; j < maxJ; j++) {
    const stopB = (t.bt[j] & 1) !== 0;
    const cMFE  = t.mf[j];

    if (phase === 1) {
      if (stopB && cMFE < t1P) { wPL -= wLeft * t.rp; return { wPL, t1Hit, t2Hit, t3Hit }; }
      if (cMFE >= t1P) { wPL += W1 * t1P; wLeft -= W1; t1Hit = true; phase = 2; }
    }
    if (phase === 2) {
      if (stopB && cMFE < t2P) { wPL -= wLeft * t.rp; return { wPL, t1Hit, t2Hit, t3Hit }; }
      if (cMFE >= t2P) { wPL += W2 * t2P; wLeft -= W2; t2Hit = true; phase = 3; }
    }
    if (phase === 3) {
      if (stopB && cMFE < t3P) { wPL -= wLeft * t.rp; return { wPL, t1Hit, t2Hit, t3Hit }; }
      if (cMFE >= t3P) { wPL += W3 * t3P; t3Hit = true; return { wPL, t1Hit, t2Hit, t3Hit }; }
    }

    if (j === maxJ - 1 && wLeft > 0) {
      wPL += wLeft * (t.cp[j] ?? 0);
      return { wPL, t1Hit, t2Hit, t3Hit };
    }
  }
  return { wPL, t1Hit, t2Hit, t3Hit };
}

function evaluate(trades, t1M, t2R, t3R, W1, W2, W3) {
  let n = 0, wins = 0, sumPL = 0, sumWin = 0, sumLoss = 0;
  let nt1 = 0, nt2 = 0, nt3 = 0;
  for (const t of trades) {
    const t1P = t1M * t.ap;
    const t2P = t1P * t2R;
    const t3P = t1P * t3R;
    const r = resim(t, t1P, t2P, t3P, W1, W2, W3);
    n++;
    sumPL += r.wPL;
    if (r.wPL > 0) { wins++; sumWin += r.wPL; }
    else             sumLoss += r.wPL;
    if (r.t1Hit) nt1++;
    if (r.t2Hit) nt2++;
    if (r.t3Hit) nt3++;
  }
  const wr    = wins / n * 100;
  const pf    = sumLoss === 0 ? 99 : Math.abs(sumWin / sumLoss);
  const avgPL = sumPL / n;
  const score = pf * wr / 100;
  const escT1 = nt1 / n * 100;
  const escT2 = nt1 > 0 ? nt2 / nt1 * 100 : 0;
  const escT3 = nt2 > 0 ? nt3 / nt2 * 100 : 0;
  return { n, wr, pf, avgPL, score, escT1, escT2, escT3 };
}

function fmt(n, dp=2, w=8) { return n.toFixed(dp).padStart(w); }
function fmtPct(n, w=7) { return (n.toFixed(1)+'%').padStart(w); }

const SEP = '═'.repeat(110);
const sep = '─'.repeat(110);

const { oos, is: isTrades } = loadVFTrades();

console.log(SEP);
console.log('  VolumeFootprint HYPER-OPTIMIZER');
console.log(`  Baseline: t1Mult=1.0, T2/T1=1.67, T3/T1=3.33, W1=0.70 W2=0.10 W3=0.20`);
console.log(`  Problem : T1avg=3.8% << MFEp50=8.1%; W1=0.70 exits 70% at tiny 3.8% move`);
console.log(SEP);

// ── Baseline ─────────────────────────────────────────────────────────────────
const baseline = evaluate(oos, 1.0, 5/3, 10/3, 0.70, 0.10, 0.20);
console.log(`\n  BASELINE (OOS n=${baseline.n}):`);
console.log(`    WR=${baseline.wr.toFixed(1)}% PF=${baseline.pf.toFixed(2)} AvgPL=+${baseline.avgPL.toFixed(2)}% Score=${baseline.score.toFixed(3)} escT1=${baseline.escT1.toFixed(1)}% escT2=${baseline.escT2.toFixed(1)}% escT3=${baseline.escT3.toFixed(1)}%`);

// ── SECTION 1: T1Mult Sweep (current weights) ─────────────────────────────────
console.log(`\n${SEP}`);
console.log('  SECTION 1 — T1Mult Sweep  (W1=0.70 W2=0.10 W3=0.20, T2/T1=1.67, T3/T1=3.33)\n');
console.log('  ' + ['t1M', 'AvgT1%', 'AvgT2%', 'AvgT3%', 'escT1%', 'escT2%', 'escT3%', 'WR%', 'PF', 'AvgPL%', 'Score'].map((h,i)=>h.padStart([5,7,7,7,7,7,7,7,6,8,8][i])).join(' '));
console.log('  ' + sep.slice(0,108));

const t1Sweep = [];
for (let t1M = 0.50; t1M <= 4.01; t1M = Math.round((t1M+0.25)*100)/100) {
  const ev = evaluate(oos, t1M, 5/3, 10/3, 0.70, 0.10, 0.20);
  const avgT1 = oos.reduce((s,t) => s + t1M*t.ap, 0) / oos.length;
  const avgT2 = avgT1 * (5/3);
  const avgT3 = avgT1 * (10/3);
  t1Sweep.push({ t1M, avgT1, ...ev });
  const marker = t1M === 1.0 ? ' ◄ baseline' : '';
  console.log('  ' + [
    t1M.toFixed(2).padStart(5),
    avgT1.toFixed(1).padStart(7),
    avgT2.toFixed(1).padStart(7),
    avgT3.toFixed(1).padStart(7),
    fmtPct(ev.escT1), fmtPct(ev.escT2), fmtPct(ev.escT3),
    fmtPct(ev.wr), fmt(ev.pf,2,6), fmt(ev.avgPL,2,8), fmt(ev.score,3,8),
  ].join(' ') + marker);
}

const bestT1M = t1Sweep.reduce((b,x) => x.score > b.score ? x : b);
console.log(`\n  Best t1Mult = ${bestT1M.t1M.toFixed(2)}, Score=${bestT1M.score.toFixed(3)}, WR=${bestT1M.wr.toFixed(1)}%, PF=${bestT1M.pf.toFixed(2)}, AvgPL=+${bestT1M.avgPL.toFixed(2)}%`);

// ── SECTION 2: Weight Sweep at best T1Mult ────────────────────────────────────
console.log(`\n${SEP}`);
console.log(`  SECTION 2 — Weight Sweep  (t1Mult=${bestT1M.t1M.toFixed(2)}, T3/T1=3.33)\n`);
console.log('  ' + ['W1', 'W2', 'W3', 'WR%', 'PF', 'AvgPL%', 'Score', 'escT1%', 'escT2%', 'escT3%'].map((h,i)=>h.padStart([6,6,6,7,6,8,8,7,7,7][i])).join(' '));
console.log('  ' + sep.slice(0,108));

const wResults = [];
const W1_vals = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70];
const W2_vals = [0.05, 0.10, 0.15, 0.20];
for (const w1 of W1_vals) {
  for (const w2 of W2_vals) {
    const w3 = Math.round((1 - w1 - w2) * 100) / 100;
    if (w3 < 0.05) continue;
    const ev = evaluate(oos, bestT1M.t1M, 5/3, 10/3, w1, w2, w3);
    wResults.push({ w1, w2, w3, ...ev });
    const marker = (w1===0.70 && w2===0.10) ? ' ◄ baseline' : '';
    console.log('  ' + [
      w1.toFixed(2).padStart(6), w2.toFixed(2).padStart(6), w3.toFixed(2).padStart(6),
      fmtPct(ev.wr), fmt(ev.pf,2,6), fmt(ev.avgPL,2,8), fmt(ev.score,3,8),
      fmtPct(ev.escT1), fmtPct(ev.escT2), fmtPct(ev.escT3),
    ].join(' ') + marker);
  }
}

const bestW = wResults.reduce((b,x) => x.score > b.score ? x : b);
console.log(`\n  Best weights: W1=${bestW.w1.toFixed(2)} W2=${bestW.w2.toFixed(2)} W3=${bestW.w3.toFixed(2)}, Score=${bestW.score.toFixed(3)}, WR=${bestW.wr.toFixed(1)}%, PF=${bestW.pf.toFixed(2)}`);

// ── SECTION 3: Joint Grid (t1Mult × T3/T1 × W1) ───────────────────────────────
console.log(`\n${SEP}`);
console.log('  SECTION 3 — Joint Grid: t1Mult × T3/T1 × W1  (top 25 by score)\n');
console.log('  ' + ['t1M', 'T3/T1', 'W1', 'W2', 'W3', 'WR%', 'PF', 'AvgPL%', 'Score', 'escT1%', 'escT2%', 'escT3%'].map((h,i)=>h.padStart([5,6,6,6,6,7,6,8,8,7,7,7][i])).join(' '));
console.log('  ' + sep.slice(0,108));

const gridResults = [];
const t1Ms = [0.50, 0.75, 1.00, 1.25, 1.50, 2.00, 2.50, 3.00, 3.50];
const t3Rs = [2.00, 2.50, 3.33, 4.00, 5.00, 7.00];
const w1s  = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60];
const w2s  = [0.05, 0.10, 0.20];

for (const t1M of t1Ms) {
  for (const t3R of t3Rs) {
    for (const w1 of w1s) {
      for (const w2 of w2s) {
        const w3 = Math.round((1 - w1 - w2) * 100) / 100;
        if (w3 < 0.05) continue;
        const ev = evaluate(oos, t1M, 5/3, t3R, w1, w2, w3);
        gridResults.push({ t1M, t3R, w1, w2, w3, ...ev });
      }
    }
  }
}

gridResults.sort((a, b) => b.score - a.score);
for (const r of gridResults.slice(0, 25)) {
  console.log('  ' + [
    r.t1M.toFixed(2).padStart(5), r.t3R.toFixed(2).padStart(6),
    r.w1.toFixed(2).padStart(6), r.w2.toFixed(2).padStart(6), r.w3.toFixed(2).padStart(6),
    fmtPct(r.wr), fmt(r.pf,2,6), fmt(r.avgPL,2,8), fmt(r.score,3,8),
    fmtPct(r.escT1), fmtPct(r.escT2), fmtPct(r.escT3),
  ].join(' '));
}

const bestGrid = gridResults[0];

// ── SECTION 4: Per-Band Analysis ──────────────────────────────────────────────
console.log(`\n${SEP}`);
console.log(`  SECTION 4 — Per-Band (t1Mult=${bestGrid.t1M.toFixed(2)}, T3/T1=${bestGrid.t3R.toFixed(2)}, W1=${bestGrid.w1.toFixed(2)} W2=${bestGrid.w2.toFixed(2)} W3=${bestGrid.w3.toFixed(2)})\n`);

const BANDS = ['TIGHT','NORMAL','VOLATILE','HIGH'];
const BAND_THRESH = [1.5, 2.5, 3.5, Infinity];

for (let bi = 0; bi < 4; bi++) {
  const band = oos.filter(t => t.bi === bi);
  if (!band.length) continue;
  // Sweep t1Mult per band
  let bBest = null;
  for (const t1M of [0.50, 0.75, 1.00, 1.25, 1.50, 2.00, 2.50, 3.00]) {
    const ev = evaluate(band, t1M, 5/3, bestGrid.t3R, bestGrid.w1, bestGrid.w2, bestGrid.w3);
    if (!bBest || ev.score > bBest.score) bBest = { t1M, ...ev };
  }
  const baseBand = evaluate(band, 1.0, 5/3, 10/3, 0.70, 0.10, 0.20);
  const avgT1 = band.reduce((s,t) => s + bBest.t1M*t.ap, 0)/band.length;
  console.log(`  ${BANDS[bi].padEnd(8)} n=${String(band.length).padStart(4)}  bestT1M=${bBest.t1M.toFixed(2)} (T1avg≈${avgT1.toFixed(1)}%)  WR=${bBest.wr.toFixed(1)}%(was ${baseBand.wr.toFixed(1)}%)  PF=${bBest.pf.toFixed(2)}  AvgPL=+${bBest.avgPL.toFixed(2)}%  Score=${bBest.score.toFixed(3)}`);
}

// ── SECTION 5: Quarterly Walk-Forward at best params ─────────────────────────
console.log(`\n${SEP}`);
console.log(`  SECTION 5 — Quarterly Walk-Forward (best params vs baseline)\n`);

function quarter(ts) {
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth()/3)+1}`;
}

const byQ = {};
for (const t of oos) {
  const q = quarter(t.di);
  if (!byQ[q]) byQ[q] = [];
  byQ[q].push(t);
}
const qKeys = Object.keys(byQ).sort().filter(q => q >= '2024-Q1');

console.log('  ' + ['Quarter', 'N', 'BASE-WR', 'BASE-AvgPL', 'OPT-WR', 'OPT-AvgPL', 'ΔWR', 'ΔAvgPL'].map((h,i)=>h.padStart([9,5,8,10,8,10,8,8][i])).join(' '));
console.log('  ' + sep.slice(0,90));

for (const q of qKeys) {
  const trades = byQ[q];
  if (!trades.length) continue;
  const base = evaluate(trades, 1.0, 5/3, 10/3, 0.70, 0.10, 0.20);
  const opt  = evaluate(trades, bestGrid.t1M, 5/3, bestGrid.t3R, bestGrid.w1, bestGrid.w2, bestGrid.w3);
  const dWR  = opt.wr - base.wr;
  const dPL  = opt.avgPL - base.avgPL;
  console.log('  ' + [
    q.padEnd(9), String(trades.length).padStart(5),
    fmtPct(base.wr,8), fmt(base.avgPL,2,10),
    fmtPct(opt.wr,8),  fmt(opt.avgPL,2,10),
    (dWR >= 0 ? '+' : '') + dWR.toFixed(1)+'%'.padStart(8),
    (dPL >= 0 ? '+' : '') + dPL.toFixed(2)+'%'.padStart(8),
  ].join(' '));
}

// ── SECTION 6: Recommendation ─────────────────────────────────────────────────
console.log(`\n${SEP}`);
console.log('  SECTION 6 — FINAL RECOMMENDATION\n');

const finalOpt = evaluate(oos, bestGrid.t1M, 5/3, bestGrid.t3R, bestGrid.w1, bestGrid.w2, bestGrid.w3);
const avgT1opt = oos.reduce((s,t) => s + bestGrid.t1M*t.ap, 0)/oos.length;
const avgT2opt = avgT1opt * (5/3);
const avgT3opt = avgT1opt * bestGrid.t3R;

console.log(`  BEFORE: t1Mult=1.00 T3/T1=3.33 W1=0.70 W2=0.10 W3=0.20`);
console.log(`          WR=${baseline.wr.toFixed(1)}% PF=${baseline.pf.toFixed(2)} AvgPL=+${baseline.avgPL.toFixed(2)}% escT1=${baseline.escT1.toFixed(1)}% Score=${baseline.score.toFixed(3)}`);
console.log('');
console.log(`  AFTER:  t1Mult=${bestGrid.t1M.toFixed(2)} T3/T1=${bestGrid.t3R.toFixed(2)} W1=${bestGrid.w1.toFixed(2)} W2=${bestGrid.w2.toFixed(2)} W3=${bestGrid.w3.toFixed(2)}`);
console.log(`          WR=${finalOpt.wr.toFixed(1)}% PF=${finalOpt.pf.toFixed(2)} AvgPL=+${finalOpt.avgPL.toFixed(2)}% escT1=${finalOpt.escT1.toFixed(1)}% Score=${finalOpt.score.toFixed(3)}`);
console.log('');
console.log(`  ΔWR=${(finalOpt.wr-baseline.wr>=0?'+':'')}${(finalOpt.wr-baseline.wr).toFixed(1)}pp  ΔPF=${(finalOpt.pf-baseline.pf>=0?'+':'')}${(finalOpt.pf-baseline.pf).toFixed(2)}  ΔAvgPL=${(finalOpt.avgPL-baseline.avgPL>=0?'+':'')}${(finalOpt.avgPL-baseline.avgPL).toFixed(2)}%  ΔScore=${(finalOpt.score-baseline.score>=0?'+':'')}${(finalOpt.score-baseline.score).toFixed(3)}`);
console.log('');
console.log(`  Avg target levels → T1=${avgT1opt.toFixed(1)}%  T2=${avgT2opt.toFixed(1)}%  T3=${avgT3opt.toFixed(1)}%`);
console.log('');
console.log('  stockEngine.ts code change:');
console.log(`    Before: const t1Mult = isVF ? 1.0 : ...`);
console.log(`    After:  const t1Mult = isVF ? ${bestGrid.t1M.toFixed(2)} : ...`);
if (bestGrid.t3R !== 10/3) {
  console.log(`    Also:   const t3Mult = t1Mult * (${bestGrid.t3R.toFixed(2)}) for VF  [currently isVF? special branch needed]`);
}
console.log('');
console.log(`  page.tsx ARCH_EXIT change (optimized_deployable_20plus):`);
console.log(`    Before: { w1:0.70, w2:0.10, w3:0.20 }`);
console.log(`    After:  { w1:${bestGrid.w1.toFixed(2)}, w2:${bestGrid.w2.toFixed(2)}, w3:${bestGrid.w3.toFixed(2)} }`);
console.log('');

// Save
const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
const outFile = path.join(RESULTS_DIR, `vf_opt_${ts}.json`);
fs.writeFileSync(outFile, JSON.stringify({ baseline, bestGrid, finalOpt, t1Sweep, gridResults: gridResults.slice(0,50) }, null, 2));
console.log(`  Saved → ${outFile}`);
console.log(SEP + '\n');
