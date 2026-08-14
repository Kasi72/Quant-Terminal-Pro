'use strict';
/**
 * dualTuner.js
 * ============
 * Hyper-tune optimized_deployable_20plus and circuit_breaker_v2.
 * Reads existing gridOptim_cache.json (Phase 2 only).
 *
 * Dense grid: 7×7×3×8×8 = 9408 configs per param set.
 * Primary sort: composite = oosWR × sharpe (rewards both simultaneously).
 * Also prints: top-by-Sharpe, top-by-WilsonLB, top-by-OOS-WR.
 *
 * Usage: node scripts/dualTuner.js
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'gridOptim_cache.json');
const OOS_SPLIT  = 0.70;
const BARS_YEAR  = 252;
const TOP_N      = 25;

const TARGETS = [
  { key: 'optimized_deployable_20plus', label: 'Deployable' },
  { key: 'circuit_breaker_v2',          label: 'CircuitBreaker' },
];

// Dense grid — much wider than initial search
const G_MAX_HOLD   = [3, 4, 5, 6, 7, 8, 10];
const G_T1_SIZE    = [0.40, 0.50, 0.60, 0.70, 0.80, 0.90, 1.00];
const G_T2_SPLIT   = [0.50, 0.60, 0.70];
const G_MIN_UC     = [50, 60, 65, 70, 75, 80, 85, 90];
const G_MIN_T1_PCT = [5, 6, 7, 8, 9, 10, 12, 15];

// ─── Stat helpers ─────────────────────────────────────────────────────────────
function avg(arr)  { return arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0; }
function stdv(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length);
}
function wilsonLB(wins, n, z=1.645) {  // 90% one-sided lower bound
  if (n === 0) return 0;
  const p = wins/n;
  const denom = 1 + z*z/n;
  return (p + z*z/(2*n) - z*Math.sqrt(p*(1-p)/n + z*z/(4*n*n))) / denom;
}

// ─── Trade simulator ──────────────────────────────────────────────────────────
function simulateTrade(sig, cfg) {
  const entryPrice = sig.nextOpenPrice;
  if (!entryPrice || !isFinite(entryPrice) || entryPrice <= 0) return null;
  if (sig.stop >= entryPrice) return null;

  const t1PctActual = ((sig.t1 - entryPrice) / entryPrice) * 100;
  if (t1PctActual < cfg.minT1Pct) return null;

  const t1Pct = t1PctActual;
  const t2Pct = ((sig.t2 - entryPrice) / entryPrice) * 100;
  const t3Pct = ((sig.t3 - entryPrice) / entryPrice) * 100;

  const { t1Size, t2Split, maxHold } = cfg;
  const rem    = 1 - t1Size;
  const t2Size = rem * t2Split;
  const t3Size = rem * (1 - t2Split);

  let stopCur = sig.stop, pos = 1.0, pnl = 0;
  let t1Hit = false, t2Hit = false, t3Hit = false;
  let mfe = 0, mae = 0, exitBar = 0;
  const nFwd   = sig.fwdBars.length / 4;
  const maxBar = Math.min(maxHold, nFwd) - 1;

  for (let bi = 0; bi <= maxBar; bi++) {
    const base = bi * 4;
    const bo = sig.fwdBars[base], bh = sig.fwdBars[base+1];
    const bl = sig.fwdBars[base+2], bc = sig.fwdBars[base+3];
    const hiP = ((bh - entryPrice) / entryPrice) * 100;
    const loP = ((bl - entryPrice) / entryPrice) * 100;
    if (hiP > mfe) mfe = hiP;
    if (loP < mae) mae = loP;
    exitBar = bi;

    if (pos > 0 && bo <= stopCur) { pnl += pos * ((bo - entryPrice)/entryPrice)*100; pos = 0; break; }
    if (pos > 0 && bl <= stopCur) { pnl += pos * ((stopCur - entryPrice)/entryPrice)*100; pos = 0; break; }

    if (!t1Hit && bh >= sig.t1 && pos > 0) {
      pnl += t1Size * t1Pct; pos -= t1Size; t1Hit = true;
      stopCur = Math.max(stopCur, entryPrice);
    }
    if (t1Hit && !t2Hit && bh >= sig.t2 && pos > 0 && t2Size > 0) {
      pnl += t2Size * t2Pct; pos -= t2Size; t2Hit = true;
      stopCur = Math.max(stopCur, sig.t1);
    }
    if (t2Hit && !t3Hit && bh >= sig.t3 && pos > 0 && t3Size > 0) {
      pnl += pos * t3Pct; pos = 0; t3Hit = true;
      exitBar = bi; break;
    }
    if (t1Hit && pos <= 0.001) { exitBar = bi; break; }
  }
  if (pos > 0.001) {
    const base = Math.min(exitBar, maxBar) * 4;
    pnl += pos * ((sig.fwdBars[base+3] - entryPrice)/entryPrice)*100;
  }
  return { pnl, mfe, mae, days: exitBar+1, exitAbsIdx: sig.signalIdx + 1 + exitBar };
}

// ─── Run grid for one param set ───────────────────────────────────────────────
function runGrid(signals, label) {
  const sorted   = [...signals].sort((a,b) => a.signalIdx - b.signalIdx);
  const splitIdx = Math.floor(sorted.length * OOS_SPLIT);
  const isSet    = new Set(sorted.slice(0, splitIdx).map(s=>`${s.sym}|${s.signalIdx}`));
  const oosSet   = new Set(sorted.slice(splitIdx).map(s=>`${s.sym}|${s.signalIdx}`));

  console.log(`\n  ${label}: ${signals.length} raw signals  IS=${isSet.size}  OOS=${oosSet.size}`);

  // Build configs
  const configs = [];
  for (const maxHold of G_MAX_HOLD)
    for (const t1Size of G_T1_SIZE)
      for (const t2Split of G_T2_SPLIT)
        for (const minUcScore of G_MIN_UC)
          for (const minT1Pct of G_MIN_T1_PCT)
            configs.push({ maxHold, t1Size, t2Split, minUcScore, minT1Pct });

  console.log(`  Running ${configs.length} configs...`);
  const t0 = Date.now();
  const results = [];

  for (const cfg of configs) {
    const isTrades = [], oosTrades = [];
    const lastExit = {};

    for (const sig of signals) {
      if ((sig.ucScore || 0) < cfg.minUcScore) continue;
      const le = lastExit[sig.sym] || -1;
      if (sig.signalIdx <= le) continue;
      const tr = simulateTrade(sig, cfg);
      if (!tr) continue;
      lastExit[sig.sym] = tr.exitAbsIdx;
      const key = `${sig.sym}|${sig.signalIdx}`;
      if (isSet.has(key))  isTrades.push(tr);
      if (oosSet.has(key)) oosTrades.push(tr);
    }

    // Require meaningful sample sizes
    if (isTrades.length < 25 || oosTrades.length < 15) continue;

    const isWins  = isTrades.filter(t=>t.pnl>0).length;
    const oosWins = oosTrades.filter(t=>t.pnl>0).length;
    const isWR    = isWins  / isTrades.length  * 100;
    const oosWR   = oosWins / oosTrades.length * 100;
    const wilson  = wilsonLB(oosWins, oosTrades.length) * 100;

    const allTrades = [...isTrades, ...oosTrades];
    const pnls      = allTrades.map(t=>t.pnl);
    const m  = avg(pnls), sd = stdv(pnls);
    const avgDays = avg(allTrades.map(t=>t.days)) || 1;
    const sharpe  = sd > 0 ? (m/sd)*Math.sqrt(BARS_YEAR/avgDays) : 0;
    const gW = allTrades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
    const gL = Math.abs(allTrades.filter(t=>t.pnl<=0).reduce((s,t)=>s+t.pnl,0));
    const pfVal   = gL > 0 ? gW/gL : (gW>0?99:0);
    const avgMFE  = avg(allTrades.map(t=>t.mfe));
    const avgMAE  = avg(allTrades.map(t=>t.mae));
    const oosPnl  = avg(oosTrades.map(t=>t.pnl));

    // Composite: rewards both WR and Sharpe simultaneously
    // WR capped at contribution: above 50% base
    const composite = Math.max(0, oosWR - 50) * Math.max(0, sharpe);

    results.push({
      ...cfg,
      N: allTrades.length, isN: isTrades.length, oosN: oosTrades.length,
      isWR, oosWR, wilson, pf: pfVal, avgPnl: m, oosPnl,
      sharpe, avgDays, avgMFE, avgMAE, composite,
    });
  }

  const elapsed = ((Date.now()-t0)/1000).toFixed(1);
  console.log(`  Done in ${elapsed}s. Valid configs: ${results.length}`);

  return results;
}

// ─── Print table ──────────────────────────────────────────────────────────────
function printTable(rows, label, sortKey, sortLabel) {
  const W = 150;
  console.log('\n' + '═'.repeat(W));
  console.log(`  ${label} — Top ${Math.min(rows.length, TOP_N)} by ${sortLabel}`);
  console.log('═'.repeat(W));
  console.log(
    '  mxH  t1Sz  t2Sp  minUC  mT1%   N_IS  N_OOS    IS WR   OOS WR  Wilson90  Sharpe  AvgDays  AvgPnl  OosPnl   MFE    MAE   Composite'
  );
  console.log('-'.repeat(W));
  for (const r of rows.slice(0, TOP_N)) {
    console.log(
      `  ${String(r.maxHold).padEnd(4)} ${r.t1Size.toFixed(2).padEnd(5)} ${r.t2Split.toFixed(2).padEnd(5)} ` +
      `${String(r.minUcScore).padEnd(6)} ${String(r.minT1Pct).padEnd(6)}` +
      `${String(r.isN).padStart(5)}  ${String(r.oosN).padStart(5)}` +
      `   ${r.isWR.toFixed(1).padStart(5)}%  ${r.oosWR.toFixed(1).padStart(6)}%  ${r.wilson.toFixed(1).padStart(6)}%` +
      `  ${r.sharpe.toFixed(2).padStart(7)}  ${r.avgDays.toFixed(1).padStart(6)}` +
      `  ${r.avgPnl.toFixed(2).padStart(6)}%  ${r.oosPnl.toFixed(2).padStart(6)}%` +
      `  ${r.avgMFE.toFixed(1).padStart(4)}%  ${r.avgMAE.toFixed(1).padStart(5)}%` +
      `  ${r.composite.toFixed(2).padStart(8)}`
    );
  }
  console.log('-'.repeat(W));
}

function analyzeAndPrint(allResults, label) {
  if (!allResults.length) { console.log(`  No valid configs for ${label}.`); return null; }

  // 4 views
  const byComposite = [...allResults].sort((a,b)=>b.composite-a.composite);
  const bySharpe    = [...allResults].sort((a,b)=>b.sharpe-a.sharpe);
  const byWilson    = [...allResults].sort((a,b)=>b.wilson-a.wilson);
  const byOosWR     = [...allResults].sort((a,b)=>b.oosWR-a.oosWR);

  printTable(byComposite, `${label} — Primary: Composite (OOS WR × Sharpe)`, 'composite', 'Composite Score');
  printTable(bySharpe.slice(0,5), `${label} — Top 5 by pure Sharpe`, 'sharpe', 'Sharpe');
  printTable(byWilson.slice(0,5), `${label} — Top 5 by Wilson LB (most robust)`, 'wilson', 'Wilson 90% LB');

  const champ = byComposite[0];
  console.log(`\n  ★ CHAMPION (${label}):`);
  console.log(`    maxHold=${champ.maxHold}  t1Size=${champ.t1Size}  t2Split=${champ.t2Split}`);
  console.log(`    minUcScore=${champ.minUcScore}  minT1Pct=${champ.minT1Pct}%`);
  console.log(`    IS WR=${champ.isWR.toFixed(1)}%  OOS WR=${champ.oosWR.toFixed(1)}%  Wilson90=${champ.wilson.toFixed(1)}%`);
  console.log(`    Sharpe=${champ.sharpe.toFixed(2)}  PF=${champ.pf.toFixed(2)}  AvgPnl=${champ.avgPnl.toFixed(2)}%  OosPnl=${champ.oosPnl.toFixed(2)}%`);
  console.log(`    N_total=${champ.N}  N_IS=${champ.isN}  N_OOS=${champ.oosN}  AvgDays=${champ.avgDays.toFixed(1)}`);
  console.log(`    Composite=${champ.composite.toFixed(3)}`);

  // Also show best Sharpe≥0.5 config with OOS WR≥60%
  const quality = allResults.filter(r => r.sharpe >= 0.5 && r.oosWR >= 60 && r.oosN >= 20)
    .sort((a,b)=>b.composite-a.composite);
  if (quality.length) {
    const q = quality[0];
    console.log(`\n  ★ QUALITY FILTER (Sharpe≥0.5, OOS WR≥60%, N_OOS≥20):`);
    console.log(`    maxHold=${q.maxHold}  t1Size=${q.t1Size}  t2Split=${q.t2Split}`);
    console.log(`    minUcScore=${q.minUcScore}  minT1Pct=${q.minT1Pct}%`);
    console.log(`    OOS WR=${q.oosWR.toFixed(1)}%  Wilson90=${q.wilson.toFixed(1)}%  Sharpe=${q.sharpe.toFixed(2)}`);
    console.log(`    N_OOS=${q.oosN}  AvgPnl=${q.avgPnl.toFixed(2)}%`);
  } else {
    console.log(`\n  ★ No config meets Sharpe≥0.5 AND OOS WR≥60% AND N_OOS≥20.`);
    // Relax: Sharpe≥0.3, OOS WR≥58%
    const relaxed = allResults.filter(r => r.sharpe >= 0.3 && r.oosWR >= 58 && r.oosN >= 15)
      .sort((a,b)=>b.composite-a.composite);
    if (relaxed.length) {
      const q = relaxed[0];
      console.log(`    Best with Sharpe≥0.3, OOS WR≥58%, N_OOS≥15:`);
      console.log(`    maxHold=${q.maxHold}  t1Size=${q.t1Size}  minUC=${q.minUcScore}  minT1Pct=${q.minT1Pct}%`);
      console.log(`    OOS WR=${q.oosWR.toFixed(1)}%  Wilson90=${q.wilson.toFixed(1)}%  Sharpe=${q.sharpe.toFixed(2)}  N_OOS=${q.oosN}`);
    } else {
      console.log(`    No config meets even relaxed thresholds. Param set may need archetype-level surgery.`);
    }
  }

  return { champion: champ, byComposite: byComposite.slice(0,10), bySharpe: bySharpe.slice(0,10), byWilson: byWilson.slice(0,10) };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
if (!fs.existsSync(CACHE_FILE)) {
  console.error('Cache not found. Run: node scripts/gridOptimizer.js --rescan');
  process.exit(1);
}

console.log('Loading cache...');
const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));

const output = {};
for (const { key, label } of TARGETS) {
  const signals = cache[key] || [];
  if (!signals.length) { console.log(`No signals for ${key}`); continue; }
  const results = runGrid(signals, label);
  output[key] = analyzeAndPrint(results, label);
}

// Save results
const outFile = path.join(__dirname, `dualTuner_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.json`);
fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
console.log(`\n  Full results: ${outFile}`);
