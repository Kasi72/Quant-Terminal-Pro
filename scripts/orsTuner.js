'use strict';
/**
 * orsTuner.js
 * ===========
 * Tune exit model for ors_prime_reversal.
 * stageTierReport shows BUY: WR=77.1%, OOS WR=72.7%, PF=1.16.
 * Reversal param — stock likely near bottom, T1 = bounce target.
 * Tests stop tightening and hold time. No T2-as-T1 (reversal has different dynamics).
 *
 * Usage: node scripts/orsTuner.js
 */

const fs   = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'gridOptim_cache.json');
const KEY        = 'ors_prime_reversal';
const OOS_SPLIT  = 0.70;
const BARS_YEAR  = 252;
const TOP_N      = 30;

const G_MAX_HOLD   = [5, 7, 10, 12, 15, 20];
const G_T1_SIZE    = [0.50, 0.70, 1.00];
const G_T2_SPLIT   = [0.50, 0.70, 1.00];
const G_STOP_MULT  = [0.40, 0.50, 0.60, 0.70, 0.80, 1.00];
const G_MIN_UC     = [0, 10, 20, 30];  // ORS is reversal — ucScore naturally low (p50=33)
const G_MIN_T1_PCT = [2, 3, 4, 5];

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

function simulateTrade(sig, cfg) {
  const entryPrice = sig.nextOpenPrice;
  if (!entryPrice || !isFinite(entryPrice) || entryPrice <= 0) return null;
  if (sig.stop >= entryPrice) return null;

  const t1PctActual = ((sig.t1 - entryPrice) / entryPrice) * 100;
  if (t1PctActual < cfg.minT1Pct) return null;

  const t1Pct = t1PctActual;
  const t2Pct = sig.t2 > 0 ? ((sig.t2 - entryPrice) / entryPrice) * 100 : 0;

  const stopGap = entryPrice - sig.stop;
  const effStopPrice = entryPrice - stopGap * cfg.stopMult;
  if (effStopPrice >= entryPrice) return null;

  const { t1Size, t2Split, maxHold } = cfg;
  const rem    = 1 - t1Size;
  const t2Size = rem * t2Split;

  let stopCur = effStopPrice, pos = 1.0, pnl = 0;
  let t1Hit = false, t2Hit = false;
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

    if (bi === 0 && pos > 0 && bo <= stopCur) {
      pnl += pos * ((bo - entryPrice) / entryPrice) * 100;
      pos = 0; break;
    }
    if (pos > 0 && bl <= stopCur) {
      pnl += pos * ((stopCur - entryPrice) / entryPrice) * 100;
      pos = 0; break;
    }

    if (!t1Hit && bh >= sig.t1 && pos > 0) {
      pnl += t1Size * t1Pct; pos -= t1Size; t1Hit = true;
      stopCur = Math.max(stopCur, entryPrice);
    }
    if (t1Hit && !t2Hit && sig.t2 > 0 && bh >= sig.t2 && pos > 0 && t2Size > 0) {
      pnl += t2Size * t2Pct; pos -= t2Size; t2Hit = true;
      stopCur = Math.max(stopCur, sig.t1);
    }
    if (t1Hit && pos <= 0.001) { exitBar = bi; break; }
  }
  if (pos > 0.001) {
    const bc = sig.fwdBars[Math.min(exitBar, maxBar) * 4 + 3];
    pnl += pos * ((bc - entryPrice) / entryPrice) * 100;
  }
  return { pnl, mfe, mae, days: exitBar + 1, exitAbsIdx: sig.signalIdx + 1 + exitBar };
}

if (!fs.existsSync(CACHE_FILE)) {
  console.error('Cache not found. Run: node scripts/cacheExtender.js ors_prime_reversal');
  process.exit(1);
}

console.log('Loading cache...');
const cache  = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
const allSig = cache[KEY] || [];
if (!allSig.length) {
  console.error(`No signals for ${KEY} in cache. Run: node scripts/cacheExtender.js ors_prime_reversal`);
  process.exit(1);
}

const pArr = (arr,pct) => arr[Math.floor(arr.length*pct/100)];
const t1arr = allSig.filter(s=>s.nextOpenPrice>0).map(s=>((s.t1-s.nextOpenPrice)/s.nextOpenPrice)*100).sort((a,b)=>a-b);
const t2arr = allSig.filter(s=>s.nextOpenPrice>0).map(s=>((s.t2-s.nextOpenPrice)/s.nextOpenPrice)*100).sort((a,b)=>a-b);
console.log(`T1 (target5) from nextOpen: p25=${pArr(t1arr,25).toFixed(2)}%  p50=${pArr(t1arr,50).toFixed(2)}%  p75=${pArr(t1arr,75).toFixed(2)}%`);
console.log(`T2 (target7) from nextOpen: p25=${pArr(t2arr,25).toFixed(2)}%  p50=${pArr(t2arr,50).toFixed(2)}%  p75=${pArr(t2arr,75).toFixed(2)}%`);

const sorted   = [...allSig].sort((a,b) => a.signalIdx - b.signalIdx);
const splitIdx = Math.floor(sorted.length * OOS_SPLIT);
const isSet    = new Set(sorted.slice(0, splitIdx).map(s=>`${s.sym}|${s.signalIdx}`));
const oosSet   = new Set(sorted.slice(splitIdx).map(s=>`${s.sym}|${s.signalIdx}`));
console.log(`ORS-Prime: ${allSig.length} signals  IS=${isSet.size}  OOS=${oosSet.size}`);

const configs = [];
for (const maxHold    of G_MAX_HOLD)
for (const t1Size     of G_T1_SIZE)
for (const t2Split    of G_T2_SPLIT)
for (const stopMult   of G_STOP_MULT)
for (const minUcScore of G_MIN_UC)
for (const minT1Pct   of G_MIN_T1_PCT)
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

  const oosWins = oosTrades.filter(t=>t.pnl>0).length;
  const isWins  = isTrades.filter(t=>t.pnl>0).length;
  const oosWR   = oosWins / oosTrades.length * 100;
  const isWR    = isWins  / isTrades.length  * 100;
  const wilson  = wilsonLB(oosWins, oosTrades.length) * 100;

  const allTrades = [...isTrades, ...oosTrades];
  const pnls    = allTrades.map(t=>t.pnl);
  const m       = avg(pnls), sd = stdv(pnls);
  const avgDays = avg(allTrades.map(t=>t.days)) || 1;
  const sharpe  = sd > 0 ? (m/sd)*Math.sqrt(BARS_YEAR/avgDays) : 0;

  const gW = allTrades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0);
  const gL = Math.abs(allTrades.filter(t=>t.pnl<=0).reduce((s,t)=>s+t.pnl,0));
  const pfVal = gL > 0 ? gW/gL : (gW>0?99:0);

  const oosPnl    = avg(oosTrades.map(t=>t.pnl));
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
    composite,
  });
}

results.sort((a,b) => b.composite - a.composite || b.sharpe - a.sharpe);

const elapsed = ((Date.now()-t0)/1000).toFixed(1);
console.log(`Done in ${elapsed}s.  Valid configs: ${results.length}`);

if (!results.length) {
  console.log('\nNo valid configs found.');
  process.exit(0);
}

const top = results.slice(0, TOP_N);
const W = 175;
console.log('\n' + '═'.repeat(W));
console.log(`  ORS-PRIME TUNER — Top ${TOP_N} by Composite (OOS WR × Sharpe)`);
console.log('═'.repeat(W));
console.log('  mxH  t1Sz  t2Sp  stpM  minUC  mT1%   N_IS  N_OOS   IS WR  OOS WR  WilsonLB   Sharpe    PF   AvgDays  AvgPnl  OosPnl  Composite');
console.log('-'.repeat(W));

for (const r of top) {
  console.log(
    `  ${String(r.maxHold).padEnd(4)} ${r.t1Size.toFixed(2).padEnd(5)} ${r.t2Split.toFixed(2).padEnd(5)} ${r.stopMult.toFixed(2).padEnd(5)}` +
    ` ${String(r.minUcScore).padEnd(6)} ${String(r.minT1Pct).padEnd(6)}` +
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
console.log(`\n  CHAMPION:`);
console.log(`    maxHold=${champ.maxHold}  t1Size=${champ.t1Size}  t2Split=${champ.t2Split}  stopMult=${champ.stopMult}`);
console.log(`    minUcScore=${champ.minUcScore}  minT1Pct=${champ.minT1Pct}%`);
console.log(`    IS WR=${champ.isWR.toFixed(1)}%  OOS WR=${champ.oosWR.toFixed(1)}%  Wilson90=${champ.wilson.toFixed(1)}%`);
console.log(`    Sharpe=${champ.sharpe.toFixed(2)}  PF=${champ.pf.toFixed(2)}  N=${champ.N}  AvgDays=${champ.avgDays.toFixed(1)}`);
console.log(`    AvgPnl=${champ.avgPnl.toFixed(2)}%  OosPnl=${champ.oosPnl.toFixed(2)}%  Composite=${champ.composite.toFixed(2)}`);

const byOosWR = [...results].sort((a,b)=>b.oosWR-a.oosWR).slice(0,5);
console.log(`\n  TOP 5 BY OOS WR:`);
console.log('  mxH  t1Sz  stpM  minUC  mT1%  N_OOS   OOS WR  Wilson90  Sharpe  Composite');
console.log('  ' + '-'.repeat(75));
for (const r of byOosWR) {
  console.log(`  ${r.maxHold}    ${r.t1Size.toFixed(2)}  ${r.stopMult.toFixed(2)}  ${r.minUcScore}     ${r.minT1Pct}` +
    `     ${String(r.oosN).padStart(4)}    ${r.oosWR.toFixed(1)}%    ${r.wilson.toFixed(1)}%` +
    `    ${r.sharpe.toFixed(2)}    ${r.composite.toFixed(2)}`);
}
