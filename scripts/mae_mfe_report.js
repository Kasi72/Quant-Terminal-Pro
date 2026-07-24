'use strict';
/**
 * mae_mfe_report.js  —  Phase 4: MAE/MFE distributions + Walk-Forward + Escape rates
 * ======================================================================================
 * Reads deep_extract JSON from Phase 1. Pure analysis — no re-scanning.
 *
 * Reports:
 *   1. MAE distribution: p10/p25/p50/p75/p90/p95 per archetype × band (OOS)
 *   2. MFE distribution: same
 *   3. Time-to-target: histogram (which bar# T1/T2/T3 fires) per archetype
 *   4. Escape rates: P(MFE ≥ T1), P(MFE ≥ T2), P(MFE ≥ T3) — target reachability
 *   5. Quarterly walk-forward: WR / PF / AvgPL per quarter per archetype (OOS 2024+)
 *   6. Stage quality: BUY vs STRONG vs ULTRA comparison
 *
 * Usage: node scripts/mae_mfe_report.js [deep_extract_TIMESTAMP.json]
 */

const fs   = require('fs');
const path = require('path');

const ARCH_NAMES = ['ORS','VolumeFootprint','CompressionCoil','MomentumPocket','EMAStack','CircuitBreaker'];
const STAGES     = ['BUY','STRONG','ULTRA'];
const BUCKETS    = ['TIGHT','NORMAL','VOLATILE','HIGH'];
const OUT_DIR    = path.join(__dirname, 'results');
const W1 = 0.50, W2 = 0.30, W3 = 0.20;

// ── Load ─────────────────────────────────────────────────────────────────────
const files1 = fs.readdirSync(OUT_DIR).filter(f => f.startsWith('deep_extract_')).sort().reverse();
const extractPath = process.argv[2] || (files1.length ? path.join(OUT_DIR, files1[0]) : null);
if (!extractPath) { console.error('No deep_extract found. Run Phase 1 first.'); process.exit(1); }

console.log(`\n📊 MAE/MFE Report + Walk-Forward (Phase 4)`);
console.log(`   Reading: ${extractPath}`);
const { meta, trades } = JSON.parse(fs.readFileSync(extractPath, 'utf8'));
const oosTrades = trades.filter(t => t.o === 1);
console.log(`   OOS trades: ${oosTrades.length.toLocaleString()}\n`);

// ── Percentile helper ─────────────────────────────────────────────────────────
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b)=>a-b);
  const idx = (p/100)*(s.length-1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo]+(s[hi]-s[lo])*(idx-lo);
}
function pctRow(arr) {
  if (!arr.length) return 'n/a';
  return `p10=${pct(arr,10).toFixed(2).padStart(5)}  p25=${pct(arr,25).toFixed(2).padStart(5)}  p50=${pct(arr,50).toFixed(2).padStart(5)}  p75=${pct(arr,75).toFixed(2).padStart(5)}  p90=${pct(arr,90).toFixed(2).padStart(5)}  p95=${pct(arr,95).toFixed(2).padStart(5)}  p99=${pct(arr,99).toFixed(2).padStart(5)}`;
}

// ── Resimulate original cascade to get exit type and T1/T2/T3 hit bars ───────
function resimOrig(t) {
  const { rp, p1, p2, p3, bt, cp } = t;
  let phase = 1, wLeft = 1.0, wPL = 0;
  let t1Bar = null, t2Bar = null, t3Bar = null, stopBar = null;

  for (let j = 0; j < Math.min(t.mh, bt.length); j++) {
    const bits = bt[j]; const cpl = cp[j];
    const sb = (bits&1)!==0, t1b=(bits&2)!==0, t2b=(bits&4)!==0, t3b=(bits&8)!==0;

    if (phase === 1) {
      if (sb && !t1b) { stopBar=j+1; wPL -= wLeft*rp; break; }
      if (t1b) { t1Bar=j+1; wPL += W1*p1; wLeft=W2+W3; phase=2; }
    }
    if (phase === 2) {
      if (sb && !t2b) { stopBar=j+1; wPL -= wLeft*rp; break; }
      if (t2b) { t2Bar=j+1; wPL += W2*p2; wLeft=W3; phase=3; }
    }
    if (phase === 3) {
      if (sb && !t3b) { stopBar=j+1; wPL -= wLeft*rp; break; }
      if (t3b) { t3Bar=j+1; wPL += W3*p3; wLeft=0; break; }
    }
    if (j === Math.min(t.mh, bt.length)-1 && wLeft>0) { wPL += wLeft*cpl; }
  }
  return { wPL, t1Bar, t2Bar, t3Bar, stopBar };
}

// ── Quarter helper ───────────────────────────────────────────────────────────
function quarterOf(ts) {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

// ── Build per-archetype analysis ──────────────────────────────────────────────
const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
const fullReport = {};

// ── 1. MAE / MFE DISTRIBUTIONS ───────────────────────────────────────────────
console.log('\n\n' + '═'.repeat(100));
console.log('  1. MAE / MFE DISTRIBUTIONS (OOS 2024+, all stages)');
console.log('     MAE = max adverse excursion (% below entry).  MFE = max favorable (% above entry).');
console.log('═'.repeat(100));
console.log('     All percentages from entry. p90 MAE = stop must survive this to avoid 90% of stops.\n');

for (let ai = 0; ai < 6; ai++) {
  const archName  = ARCH_NAMES[ai];
  const archTrades = oosTrades.filter(t => t.ai === ai);
  if (archTrades.length < 5) continue;
  console.log(`  ── ${archName} (n=${archTrades.length.toLocaleString()}) ─────────────────────────────`);

  for (const bkt of BUCKETS) {
    const bi = BUCKETS.indexOf(bkt);
    const bkT = archTrades.filter(t => t.bi === bi);
    if (bkT.length < 5) continue;
    const maeVals = bkT.map(t => t.ma[t.ma.length-1] ?? 0);
    const mfeVals = bkT.map(t => t.mf[t.mf.length-1] ?? 0);
    console.log(`    ${bkt.padEnd(8)} n=${String(bkT.length).padStart(6)}`);
    console.log(`      MAE: ${pctRow(maeVals)}`);
    console.log(`      MFE: ${pctRow(mfeVals)}`);
  }
}

// ── 2. ESCAPE RATES (Target reachability) ────────────────────────────────────
console.log('\n\n' + '═'.repeat(100));
console.log('  2. ESCAPE RATES — P(MFE ≥ T1), P(MFE ≥ T2), P(MFE ≥ T3)');
console.log('     How often does price actually reach each target level?');
console.log('═'.repeat(100));

for (let ai = 0; ai < 6; ai++) {
  const archName  = ARCH_NAMES[ai];
  const archTrades = oosTrades.filter(t => t.ai === ai);
  if (archTrades.length < 5) continue;

  let n=0, reachT1=0, reachT2=0, reachT3=0;
  for (const t of archTrades) {
    const finalMFE = t.mf[t.mf.length-1] ?? 0;
    n++;
    if (finalMFE >= t.p1) reachT1++;
    if (finalMFE >= t.p2) reachT2++;
    if (finalMFE >= t.p3) reachT3++;
  }
  console.log(
    `  ${archName.padEnd(18)} n=${String(n).padStart(7)}   ` +
    `P(≥T1)=${(reachT1/n*100).toFixed(1).padStart(5)}%   ` +
    `P(≥T2)=${(reachT2/n*100).toFixed(1).padStart(5)}%   ` +
    `P(≥T3)=${(reachT3/n*100).toFixed(1).padStart(5)}%`
  );
}

// ── 3. TIME-TO-TARGET HISTOGRAMS ─────────────────────────────────────────────
console.log('\n\n' + '═'.repeat(100));
console.log('  3. TIME-TO-TARGET — which bar# does T1/T2/T3 fire? (OOS, all bands)');
console.log('     Bar 1 = day after signal.  Distributions are conditional on target being hit.');
console.log('═'.repeat(100));

for (let ai = 0; ai < 6; ai++) {
  const archName   = ARCH_NAMES[ai];
  const archTrades = oosTrades.filter(t => t.ai === ai);
  if (archTrades.length < 5) continue;

  const t1Bars = [], t2Bars = [], t3Bars = [], stopBars = [];
  for (const t of archTrades) {
    const { t1Bar, t2Bar, t3Bar, stopBar } = resimOrig(t);
    if (t1Bar) t1Bars.push(t1Bar);
    if (t2Bar) t2Bars.push(t2Bar);
    if (t3Bar) t3Bars.push(t3Bar);
    if (stopBar && !t1Bar) stopBars.push(stopBar);
  }

  const fmt = (arr, label) => {
    if (!arr.length) return `  ${label}: n/a`;
    return `  ${label} (n=${arr.length.toLocaleString()})  p25=${pct(arr,25).toFixed(0).padStart(2)}d  p50=${pct(arr,50).toFixed(0).padStart(2)}d  p75=${pct(arr,75).toFixed(0).padStart(2)}d  p90=${pct(arr,90).toFixed(0).padStart(2)}d  max=${Math.max(...arr).toFixed(0).padStart(2)}d`;
  };

  console.log(`\n  ── ${archName} ───────────────────────────────────────────────`);
  console.log(fmt(t1Bars,   '  T1'));
  console.log(fmt(t2Bars,   '  T2'));
  console.log(fmt(t3Bars,   '  T3'));
  console.log(fmt(stopBars, 'Stop'));
}

// ── 4. QUARTERLY WALK-FORWARD ─────────────────────────────────────────────────
console.log('\n\n' + '═'.repeat(120));
console.log('  4. QUARTERLY WALK-FORWARD (OOS 2024+ by calendar quarter)');
console.log('═'.repeat(120));
console.log(`  ${'Archetype'.padEnd(18)} ${'Quarter'.padEnd(9)} ${'N'.padStart(6)} ${'WR%'.padStart(7)} ${'AvgPL%'.padStart(8)} ${'PF'.padStart(7)} ${'AvgR'.padStart(7)} ${'Trend'}`);
console.log('  ' + '-'.repeat(80));

const quarterlyData = {};

for (let ai = 0; ai < 6; ai++) {
  const archName   = ARCH_NAMES[ai];
  const archTrades = oosTrades.filter(t => t.ai === ai);
  if (archTrades.length < 5) continue;

  // Group by quarter
  const byQ = {};
  for (const t of archTrades) {
    const q = quarterOf(t.di);
    (byQ[q] = byQ[q] || []).push(t);
  }

  const quarters = Object.keys(byQ).sort();
  const qRows = [];

  for (const q of quarters) {
    const qt = byQ[q];
    let n=0, wins=0, sumPL=0, swPL=0, slPL=0, sumR=0;
    for (const t of qt) {
      const { wPL } = resimOrig(t);
      const r = wPL / t.rp;
      n++; sumPL+=wPL; sumR+=r;
      if (wPL>=0) { wins++; swPL+=wPL; } else slPL+=Math.abs(wPL);
    }
    const wr    = n > 0 ? wins/n*100 : 0;
    const avgPL = n > 0 ? sumPL/n : 0;
    const pf    = slPL > 0 ? swPL/slPL : Infinity;
    const avgR  = n > 0 ? sumR/n : 0;
    qRows.push({ q, n, wr, avgPL, pf, avgR });
  }

  quarterlyData[archName] = qRows;

  // Trend detection (improving / degrading / stable)
  const wrTrend = qRows.length >= 3
    ? (qRows.slice(-2).reduce((s,r)=>s+r.wr,0)/2 - qRows.slice(0,2).reduce((s,r)=>s+r.wr,0)/2).toFixed(1)
    : 'n/a';
  const trendStr = qRows.length < 3 ? '' : (+wrTrend > 3 ? '↑ IMPROVING' : +wrTrend < -3 ? '↓ DEGRADING' : '→ STABLE');

  for (let qi = 0; qi < qRows.length; qi++) {
    const r = qRows[qi];
    const trend = qi === qRows.length - 1 ? trendStr : '';
    console.log(
      `  ${(qi===0?archName:'').padEnd(18)} ${r.q.padEnd(9)} ` +
      `${String(r.n).padStart(6)} ` +
      `${r.wr.toFixed(1).padStart(6)}% ` +
      `${(r.avgPL>=0?'+':'')}${r.avgPL.toFixed(2).padStart(7)}% ` +
      `${r.pf===Infinity?'∞     ':r.pf.toFixed(2).padStart(7)} ` +
      `${(r.avgR>=0?'+':'')}${r.avgR.toFixed(2).padStart(6)}  ${trend}`
    );
  }
  console.log('');
}

// ── 5. STAGE QUALITY BREAKDOWN ────────────────────────────────────────────────
console.log('\n\n' + '═'.repeat(110));
console.log('  5. STAGE QUALITY — BUY vs STRONG vs ULTRA (OOS, all bands)');
console.log('═'.repeat(110));
console.log(`  ${'Archetype'.padEnd(18)} ${'Stage'.padEnd(8)} ${'N'.padStart(7)} ${'WR%'.padStart(7)} ${'AvgPL%'.padStart(9)} ${'PF'.padStart(7)} ${'AvgR'.padStart(7)}`);
console.log('  ' + '-'.repeat(80));

for (let ai = 0; ai < 6; ai++) {
  const archName   = ARCH_NAMES[ai];
  const archTrades = oosTrades.filter(t => t.ai === ai);
  if (archTrades.length < 5) continue;

  for (let gi = 0; gi < 3; gi++) {
    const gTrades = archTrades.filter(t => t.gi === gi);
    if (gTrades.length < 3) continue;
    let n=0, wins=0, sumPL=0, swPL=0, slPL=0, sumR=0;
    for (const t of gTrades) {
      const { wPL } = resimOrig(t);
      const r = wPL / t.rp; n++; sumPL+=wPL; sumR+=r;
      if (wPL>=0) { wins++; swPL+=wPL; } else slPL+=Math.abs(wPL);
    }
    const wr=n>0?wins/n*100:0, avgPL=n>0?sumPL/n:0;
    const pf=slPL>0?swPL/slPL:Infinity;
    const avgR=n>0?sumR/n:0;
    console.log(
      `  ${(gi===0?archName:'').padEnd(18)} ${STAGES[gi].padEnd(8)} ` +
      `${String(n).padStart(7)} ${wr.toFixed(1).padStart(6)}% ` +
      `${(avgPL>=0?'+':'')}${avgPL.toFixed(2).padStart(8)}% ` +
      `${pf===Infinity?'∞     ':pf.toFixed(2).padStart(7)} ` +
      `${(avgR>=0?'+':'')}${avgR.toFixed(2).padStart(6)}`
    );
  }
}

// ── 6. KEY INSIGHTS SUMMARY ──────────────────────────────────────────────────
console.log('\n\n' + '═'.repeat(100));
console.log('  6. KEY INSIGHTS');
console.log('═'.repeat(100));

// Stop analysis: average MAE p50 vs stop (rp)
for (let ai = 0; ai < 6; ai++) {
  const archName   = ARCH_NAMES[ai];
  const archTrades = oosTrades.filter(t => t.ai === ai);
  if (archTrades.length < 5) continue;

  const maeVals  = archTrades.map(t => t.ma[t.ma.length-1] ?? 0);
  const mfeVals  = archTrades.map(t => t.mf[t.mf.length-1] ?? 0);
  const riskVals = archTrades.map(t => t.rp);
  const maeP50   = pct(maeVals, 50);
  const maeP90   = pct(maeVals, 90);
  const mfeP50   = pct(mfeVals, 50);
  const mfeP90   = pct(mfeVals, 90);
  const avgRisk  = riskVals.reduce((a,b)=>a+b,0)/riskVals.length;
  const t1Reach  = archTrades.filter(t=>(t.mf[t.mf.length-1]??0)>=t.p1).length/archTrades.length*100;

  const stopComment = maeP90 > avgRisk * 1.2
    ? `⚠️  MAE p90 (${maeP90.toFixed(1)}%) EXCEEDS avg stop (${avgRisk.toFixed(1)}%) — many stops grazed then recovered`
    : `✅  MAE p90 (${maeP90.toFixed(1)}%) within avg stop (${avgRisk.toFixed(1)}%)`;

  const mfeComment = t1Reach > 70
    ? `✅  T1 escape rate ${t1Reach.toFixed(0)}% — target reachable`
    : t1Reach > 50
    ? `⚠️  T1 escape rate ${t1Reach.toFixed(0)}% — T1 may be slightly far`
    : `❌  T1 escape rate ${t1Reach.toFixed(0)}% — T1 too far, consider tightening`;

  console.log(`\n  ${archName}`);
  console.log(`    ${stopComment}`);
  console.log(`    MFE: p50=${mfeP50.toFixed(1)}% p90=${mfeP90.toFixed(1)}%  |  ${mfeComment}`);
}

// ── Save ─────────────────────────────────────────────────────────────────────
const outFile = path.join(OUT_DIR, `mae_mfe_report_${stamp}.json`);
fs.writeFileSync(outFile, JSON.stringify({ stamp, quarterlyData }, null, 2));
console.log(`\n\n  Saved: ${outFile}`);
console.log('\n  ✅ Phase 4 complete.\n');
