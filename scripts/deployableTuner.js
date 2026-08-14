'use strict';
/**
 * deployableTuner.js
 * ==================
 * Rescue optimized_deployable_20plus.
 * Root cause: T1 (target5) is ~2.9% median — too tight vs 9% stop.
 * Strategy: treat sig.t2 as effective T1, sig.t3 as effective T2.
 * Also grid-search stopMult to tighten the wide stop.
 * Reads existing gridOptim_cache.json (Phase 2 only — no rescan).
 *
 * Usage:
 *   node scripts/deployableTuner.js
 */

const fs   = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'gridOptim_cache.json');
const KEY        = 'optimized_deployable_20plus';
const OOS_SPLIT  = 0.70;
const BARS_YEAR  = 252;
const TOP_N      = 30;

// Dense grid — T2/T3 reassignment + stop tightening
const G_MAX_HOLD   = [5, 8, 10, 12, 15, 20];
const G_T1_SIZE    = [0.0, 0.25, 0.50, 0.75, 1.0];
const G_T2_SPLIT   = [0.50, 0.70, 1.0];
const G_STOP_MULT  = [0.40, 0.50, 0.60, 0.70, 1.0];  // scale cached stop down
const G_MIN_UC     = [60, 65, 70, 75, 80];
const G_MIN_T1_PCT = [2, 3, 4, 5];   // effective T1 = sig.t2 distance from nextOpen

// ─── Stats helpers ────────────────────────────────────────────────────────────
function avg(arr)  { return arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0; }
function stdv(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length);
}
function wilsonLB(wins, n, z=1.645) {
  if (n === 0) return 0;
  const p = wins/n;
  const denom = 1 + z*z/n;
  return (p + z*z/(2*n) - z*Math.sqrt(p*(1-p)/n + z*z/(4*n*n))) / denom;
}

// ─── Simulator — uses sig.t2 as T1 target, sig.t3 as T2 target ───────────────
function simulateTrade(sig, cfg) {
  const entryPrice = sig.nextOpenPrice;
  if (!entryPrice || !isFinite(entryPrice) || entryPrice <= 0) return null;

  // Effective targets: T2→T1, T3→T2
  const effT1 = sig.t2;
  const effT2 = sig.t3;
  // Effective stop: scaled
  const effStop = sig.stop + (entryPrice - sig.stop) * (1 - cfg.stopMult);
  // i.e. effStop = entryPrice - (entryPrice - sig.stop) * stopMult
  // simplify: effStop = entryPrice * (1 - cfg.stopMult * (1 - sig.stop/entryPrice))
  // Actually: cached sig.stop is the stop price level, not a %. Scale the gap:
  // gap = entryPrice - sig.stop ; effGap = gap * stopMult ; effStop = entryPrice - effGap
  const stopGap = entryPrice - sig.stop;
  const effStopPrice = entryPrice - stopGap * cfg.stopMult;

  if (effStopPrice >= entryPrice) return null;

  const t1PctActual = ((effT1 - entryPrice) / entryPrice) * 100;
  if (t1PctActual < cfg.minT1Pct) return null;

  const t1Pct = t1PctActual;
  const t2Pct = ((effT2 - entryPrice) / entryPrice) * 100;

  const { t1Size, t2Split, maxHold } = cfg;
  const rem    = 1 - t1Size;
  const t2Size = rem * t2Split;
  const t3Size = rem * (1 - t2Split);  // residual time-exit only

  let stopCur = effStopPrice, pos = 1.0, pnl = 0;
  let t1Hit = false, t2Hit = false;
  let mfe = 0, mae = 0, exitBar = 0;
  const nFwd   = sig.fwdBars.length / 4;
  const maxBar = Math.min(maxHold, nFwd) - 1;

  for (let bi = 0; bi <= maxBar; bi++) {
    const base = bi * 4;
    const bh = sig.fwdBars[base+1];
    const bl = sig.fwdBars[base+2];
    const bc = sig.fwdBars[base+3];
    const hiP = ((bh - entryPrice) / entryPrice) * 100;
    const loP = ((bl - entryPrice) / entryPrice) * 100;
    if (hiP > mfe) mfe = hiP;
    if (loP < mae) mae = loP;
    exitBar = bi;

    // Check open gap down on first bar
    if (bi === 0) {
      const bo = sig.fwdBars[base];
      if (pos > 0 && bo <= stopCur) { pnl += pos * ((bo - entryPrice)/entryPrice)*100; pos = 0; break; }
    }
    if (pos > 0 && bl <= stopCur) { pnl += pos * ((stopCur - entryPrice)/entryPrice)*100; pos = 0; break; }

    if (!t1Hit && bh >= effT1 && pos > 0) {
      pnl += t1Size * t1Pct; pos -= t1Size; t1Hit = true;
      stopCur = Math.max(stopCur, entryPrice);  // trail to breakeven
    }
    if (t1Hit && !t2Hit && bh >= effT2 && pos > 0 && t2Size > 0) {
      pnl += t2Size * t2Pct; pos -= t2Size; t2Hit = true;
      stopCur = Math.max(stopCur, effT1);  // trail to T1 level
    }
    if (t1Hit && pos <= 0.001) { exitBar = bi; break; }
  }
  if (pos > 0.001) {
    const bc = sig.fwdBars[Math.min(exitBar, maxBar) * 4 + 3];
    pnl += pos * ((bc - entryPrice)/entryPrice)*100;
  }
  return { pnl, mfe, mae, days: exitBar+1, exitAbsIdx: sig.signalIdx + 1 + exitBar };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
if (!fs.existsSync(CACHE_FILE)) {
  console.error('Cache not found. Run: node scripts/gridOptimizer.js --rescan');
  process.exit(1);
}

console.log('Loading cache...');
const cache  = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
const allSig = cache[KEY] || [];
if (!allSig.length) {
  console.error(`No signals for ${KEY} in cache. Re-run Phase 1.`);
  process.exit(1);
}

// Print T2/T3 stats from nextOpen for reference
const t2arr = allSig.filter(s=>s.nextOpenPrice>0).map(s=>((s.t2-s.nextOpenPrice)/s.nextOpenPrice)*100).sort((a,b)=>a-b);
const t3arr = allSig.filter(s=>s.nextOpenPrice>0).map(s=>((s.t3-s.nextOpenPrice)/s.nextOpenPrice)*100).sort((a,b)=>a-b);
const p = (arr,pct) => arr[Math.floor(arr.length*pct/100)];
console.log(`T2 from nextOpen: p25=${p(t2arr,25).toFixed(2)}% p50=${p(t2arr,50).toFixed(2)}% p75=${p(t2arr,75).toFixed(2)}%`);
console.log(`T3 from nextOpen: p25=${p(t3arr,25).toFixed(2)}% p50=${p(t3arr,50).toFixed(2)}% p75=${p(t3arr,75).toFixed(2)}%`);

// IS/OOS split by signal index order
const sorted  = [...allSig].sort((a,b) => a.signalIdx - b.signalIdx);
const splitIdx = Math.floor(sorted.length * OOS_SPLIT);
const isSet   = new Set(sorted.slice(0, splitIdx).map(s=>`${s.sym}|${s.signalIdx}`));
const oosSet  = new Set(sorted.slice(splitIdx).map(s=>`${s.sym}|${s.signalIdx}`));

console.log(`Deployable: ${allSig.length} signals  IS=${isSet.size}  OOS=${oosSet.size}`);

// Build config grid
const configs = [];
for (const maxHold  of G_MAX_HOLD)
for (const t1Size   of G_T1_SIZE)
for (const t2Split  of G_T2_SPLIT)
for (const stopMult of G_STOP_MULT)
for (const minUcScore of G_MIN_UC)
for (const minT1Pct of G_MIN_T1_PCT)
  configs.push({ maxHold, t1Size, t2Split, stopMult, minUcScore, minT1Pct });

console.log(`Running ${configs.length} configs...`);
const t0 = Date.now();

const results = [];

for (const cfg of configs) {
  const isTrades = [], oosTrades = [];
  const lastExit = {};

  for (const sig of allSig) {
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

  if (isTrades.length < 20 || oosTrades.length < 10) continue;

  const isWins  = isTrades.filter(t=>t.pnl>0).length;
  const oosWins = oosTrades.filter(t=>t.pnl>0).length;
  const isWR    = isWins  / isTrades.length * 100;
  const oosWR   = oosWins / oosTrades.length * 100;
  const wilson  = wilsonLB(oosWins, oosTrades.length) * 100;

  const allTrades = [...isTrades, ...oosTrades];
  const pnls    = allTrades.map(t=>t.pnl);
  const m       = avg(pnls), sd = stdv(pnls);
  const avgDays = avg(allTrades.map(t=>t.days)) || 1;
  const sharpe  = sd > 0 ? (m/sd)*Math.sqrt(BARS_YEAR/avgDays) : 0;

  const gW = allTrades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
  const gL = Math.abs(allTrades.filter(t=>t.pnl<=0).reduce((s,t)=>s+t.pnl,0));
  const pfVal = gL > 0 ? gW/gL : (gW>0?99:0);

  const oosPnl  = avg(oosTrades.map(t=>t.pnl));
  const composite = Math.max(0, oosWR - 50) * Math.max(0, sharpe);

  results.push({
    ...cfg,
    N: allTrades.length,
    isN: isTrades.length,
    oosN: oosTrades.length,
    isWR, oosWR, wilson,
    pf: pfVal,
    avgPnl: m,
    oosPnl,
    sharpe,
    avgDays,
    avgMFE: avg(allTrades.map(t=>t.mfe)),
    avgMAE: avg(allTrades.map(t=>t.mae)),
    composite,
  });
}

results.sort((a,b) => b.composite - a.composite || b.sharpe - a.sharpe);

const elapsed = ((Date.now()-t0)/1000).toFixed(1);
console.log(`Done in ${elapsed}s.  Valid configs: ${results.length}`);

if (!results.length) {
  console.log('\nNo valid configs found. Signal count too low at all filters.');
  process.exit(0);
}

// ─── Print table ──────────────────────────────────────────────────────────────
const top = results.slice(0, TOP_N);
const W = 160;
console.log('\n' + '═'.repeat(W));
console.log(`  DEPLOYABLE RESCUE — Top ${TOP_N} by Composite (OOS WR × Sharpe)`);
console.log('═'.repeat(W));
console.log(
  '  mxH  t1Sz  t2Sp  stpM  minUC  mT1%   N_IS  N_OOS   IS WR  OOS WR  WilsonLB   Sharpe   PF   AvgDays  AvgPnl  OosPnl  Composite'
);
console.log('-'.repeat(W));

for (const r of top) {
  console.log(
    `  ${String(r.maxHold).padEnd(4)} ${r.t1Size.toFixed(2).padEnd(5)} ${r.t2Split.toFixed(2).padEnd(5)} ${r.stopMult.toFixed(2).padEnd(5)}` +
    ` ${String(r.minUcScore).padEnd(6)} ${String(r.minT1Pct).padEnd(4)}` +
    `${String(r.isN).padStart(6)}  ${String(r.oosN).padStart(5)}` +
    `  ${r.isWR.toFixed(1).padStart(5)}%  ${r.oosWR.toFixed(1).padStart(6)}%  ${r.wilson.toFixed(1).padStart(7)}%` +
    `  ${r.sharpe.toFixed(2).padStart(7)}` +
    `  ${r.pf.toFixed(2).padStart(5)}` +
    `  ${r.avgDays.toFixed(1).padStart(6)}` +
    `  ${r.avgPnl.toFixed(2).padStart(6)}%  ${r.oosPnl.toFixed(2).padStart(6)}%` +
    `  ${r.composite.toFixed(2).padStart(9)}`
  );
}

console.log('-'.repeat(W));

const champ = top[0];
console.log(`\n  CHAMPION (best composite):`);
console.log(`    maxHold=${champ.maxHold}  t1Size=${champ.t1Size}  t2Split=${champ.t2Split}  stopMult=${champ.stopMult}`);
console.log(`    minUcScore=${champ.minUcScore}  minT1Pct(T2)=${champ.minT1Pct}%`);
console.log(`    IS WR=${champ.isWR.toFixed(1)}%  OOS WR=${champ.oosWR.toFixed(1)}%  Wilson90=${champ.wilson.toFixed(1)}%`);
console.log(`    Sharpe=${champ.sharpe.toFixed(2)}  PF=${champ.pf.toFixed(2)}  N=${champ.N}  AvgDays=${champ.avgDays.toFixed(1)}`);
console.log(`    AvgPnl=${champ.avgPnl.toFixed(2)}%  OosPnl=${champ.oosPnl.toFixed(2)}%  Composite=${champ.composite.toFixed(2)}`);

// Top 5 by OOS WR
const byOosWR = [...results].sort((a,b)=>b.oosWR-a.oosWR).slice(0,5);
console.log(`\n  TOP 5 BY OOS WR:`);
console.log('  mxH  t1Sz  stpM  minUC  mT1%  N_OOS   OOS WR  Wilson90  Sharpe  Composite');
console.log('  ' + '-'.repeat(80));
for (const r of byOosWR) {
  console.log(
    `  ${r.maxHold}    ${r.t1Size.toFixed(2)}   ${r.stopMult.toFixed(2)}   ${String(r.minUcScore).padEnd(5)} ${String(r.minT1Pct).padEnd(4)}` +
    `${String(r.oosN).padStart(5)}   ${r.oosWR.toFixed(1).padStart(5)}%  ${r.wilson.toFixed(1).padStart(7)}%` +
    `  ${r.sharpe.toFixed(2).padStart(6)}  ${r.composite.toFixed(2).padStart(9)}`
  );
}

// Top 5 by Sharpe
const bySharpe = [...results].sort((a,b)=>b.sharpe-a.sharpe).slice(0,5);
console.log(`\n  TOP 5 BY SHARPE:`);
console.log('  mxH  t1Sz  stpM  minUC  mT1%  N_OOS   OOS WR  Sharpe  Composite');
console.log('  ' + '-'.repeat(70));
for (const r of bySharpe) {
  console.log(
    `  ${r.maxHold}    ${r.t1Size.toFixed(2)}   ${r.stopMult.toFixed(2)}   ${String(r.minUcScore).padEnd(5)} ${String(r.minT1Pct).padEnd(4)}` +
    `${String(r.oosN).padStart(5)}   ${r.oosWR.toFixed(1).padStart(5)}%  ${r.sharpe.toFixed(2).padStart(6)}  ${r.composite.toFixed(2).padStart(9)}`
  );
}

const outFile = path.join(__dirname, `deployableTuner_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.json`);
fs.writeFileSync(outFile, JSON.stringify({ champion: champ, top30: top }, null, 2));
console.log(`\n  Results saved: ${outFile}`);
