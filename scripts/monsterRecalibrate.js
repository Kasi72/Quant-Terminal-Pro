// ═══════════════════════════════════════════════════════════════════════════════
// MONSTER MOVE DETECTOR — Ultra-deep recalibration on Nifty 500
// ═══════════════════════════════════════════════════════════════════════════════
// Original detector was calibrated on 77 stocks / 84,859 points with TINY best-
// tier samples (15-21 signals). This re-backtests on 456 Nifty 500 stocks with
// much larger samples, then builds finer-grained stratification (5-6 tiers per
// pattern instead of 3-4) plus an OOS validation split.
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs'), path = require('path');
const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';

function parseYahoo(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || isNaN(+p[4]) || +p[4] <= 0) continue;
    c.push({ d: p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] || 0 });
  }
  return c;
}
function computeATR14(c) {
  const a = new Array(c.length).fill(0);
  if (c.length < 15) return a;
  let s = 0;
  for (let i = 1; i <= 14; i++) s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
  a[14] = s / 14;
  for (let i = 15; i < c.length; i++) { const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c)); a[i] = (a[i-1] * 13 + tr) / 14; }
  return a;
}
function volAvg(c, idx, period) {
  let s = 0, n = 0; for (let j = Math.max(0, idx - period); j < idx; j++) { s += c[j].v; n++; } return n > 0 ? s / n : 1;
}

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  MONSTER MOVE DETECTOR — Ultra-Deep Recalibration on Nifty 500');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS') && !f.includes('_all'))) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 200) continue;
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr: computeATR14(c) });
}
console.log(`Loaded ${stockData.length} stocks\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1: Build full feature dataset
// ═══════════════════════════════════════════════════════════════════════════════
const points = [];
for (const { sym, c, atr } of stockData) {
  for (let i = 150; i < c.length - 21; i++) {
    const s = c[i], rng = s.h - s.l;
    if (s.c <= 0 || atr[i] <= 0 || rng <= 0) continue;

    // Split-guard: skip this point if any candle in the forward 20-day window
    // has an unadjusted split/bonus gap (ratio >2.5x or <0.4x close-to-close).
    // Genuine corporate actions (e.g. ABFRL, AFFLE, 360ONE) corrupt forward
    // return calculations if not filtered.
    let hasSplit = false;
    for (let j = i; j < Math.min(i + 21, c.length - 1); j++) {
      if (c[j].c <= 0) continue;
      const ratio = c[j+1].c / c[j].c;
      if (ratio > 2.5 || ratio < 0.4) { hasSplit = true; break; }
    }
    if (hasSplit) continue;

    let maxH = 0;
    for (let j = i + 1; j <= i + 20; j++) { const hPct = (c[j].h - s.c) / s.c * 100; if (hPct > maxH) maxH = hPct; }
    const fwd20 = (c[i + 20].c - s.c) / s.c * 100;
    const isMonster = maxH >= 10;

    const closeLoc = (s.c - s.l) / rng * 100;
    const upperWick = (s.h - Math.max(s.c, s.o)) / rng * 100;
    const lowerWick = (Math.min(s.c, s.o) - s.l) / rng * 100;
    const bodyPct = Math.abs(s.c - s.o) / rng * 100;
    const eRA = rng / atr[i];
    const atrPctVal = atr[i] / s.c * 100;

    const v20 = volAvg(c, i, 20);
    const v5 = volAvg(c, i, 5);
    const volRatio20 = v20 > 0 ? s.v / v20 : 0;
    const volVsPre5 = v5 > 0 ? s.v / v5 : 0;

    let pre10VR = 0, p10n = 0;
    for (let j = i - 10; j < i; j++) { if (j >= 0 && v20 > 0) { pre10VR += c[j].v / v20; p10n++; } }
    pre10VR = p10n > 0 ? pre10VR / p10n : 1;

    let sma50 = 0;
    if (i >= 49) { let s50 = 0; for (let j = i - 49; j <= i; j++) s50 += c[j].c; sma50 = s50 / 50; }
    const aboveSMA50 = s.c > sma50 && sma50 > 0;

    let high50 = 0;
    for (let j = Math.max(0, i - 50); j < i; j++) { if (c[j].h > high50) high50 = c[j].h; }
    const swingDist = high50 > 0 ? (s.c - high50) / high50 * 100 : 0;

    let low50 = Infinity;
    for (let j = Math.max(0, i - 50); j < i; j++) { if (c[j].l < low50) low50 = c[j].l; }
    const lowDist = low50 > 0 && low50 < Infinity ? (s.c - low50) / low50 * 100 : 0;

    const mom5 = i >= 5 ? (s.c - c[i-5].c) / c[i-5].c * 100 : 0;
    const mom10 = i >= 10 ? (s.c - c[i-10].c) / c[i-10].c * 100 : 0;

    let rsi2 = 50;
    if (i >= 2) {
      const ch1 = s.c - c[i-1].c, ch2 = c[i-1].c - c[i-2].c;
      const g = ((ch1>0?ch1:0)+(ch2>0?ch2:0))/2, l = ((ch1<0?-ch1:0)+(ch2<0?-ch2:0))/2;
      rsi2 = l < 0.001 ? 100 : 100 - 100/(1+g/l);
    }

    points.push({
      sym, idx: i, isMonster, maxH, fwd20,
      closeLoc, upperWick, lowerWick, bodyPct, eRA, atrPctVal,
      volRatio20, volVsPre5, pre10VR, aboveSMA50, swingDist, lowDist,
      mom5, mom10, rsi2,
    });
    i += 2;
  }
}

const totalPts = points.length;
const totalMonsters = points.filter(p => p.isMonster).length;
const baseRate = totalMonsters / totalPts * 100;
console.log(`Total data points: ${totalPts.toLocaleString()}`);
console.log(`Baseline monster rate: ${baseRate.toFixed(1)}% (${totalMonsters.toLocaleString()} monsters)\n`);

function avg(arr) { return arr.length > 0 ? arr.reduce((s,v)=>s+v,0)/arr.length : 0; }

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2: 60/40 CHRONOLOGICAL SPLIT for OOS validation
// ═══════════════════════════════════════════════════════════════════════════════
// Split each stock's points by index position
const symFirstIdx = {}, symLastIdx = {};
for (const p of points) {
  if (!(p.sym in symFirstIdx)) symFirstIdx[p.sym] = p.idx;
  symLastIdx[p.sym] = p.idx;
}
for (const p of points) {
  const range = symLastIdx[p.sym] - symFirstIdx[p.sym];
  p.isTrain = range > 0 ? (p.idx - symFirstIdx[p.sym]) / range <= 0.6 : true;
}
const trainPts = points.filter(p => p.isTrain);
const testPts = points.filter(p => !p.isTrain);
console.log(`Train (60%): ${trainPts.length.toLocaleString()} pts | Test (40% OOS): ${testPts.length.toLocaleString()} pts\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3: GRID SEARCH on TRAIN set — MOMENTUM CONTINUATION
// ═══════════════════════════════════════════════════════════════════════════════
function gridSearchPattern(name, filterFn, paramGrid, dataset) {
  const results = [];
  for (const combo of paramGrid) {
    const filtered = dataset.filter(p => filterFn(p, combo));
    if (filtered.length < 30) continue;
    const monsters = filtered.filter(p => p.isMonster).length;
    const rate = monsters / filtered.length * 100;
    const avgMFE = avg(filtered.map(p => p.maxH));
    const avgFwd = avg(filtered.map(p => p.fwd20));
    results.push({ ...combo, n: filtered.length, rate, avgMFE, avgFwd });
  }
  results.sort((a, b) => b.rate - a.rate);
  return results;
}

console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  🚀 MOMENTUM CONTINUATION — Grid Search on TRAIN (60%)                    ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const momGrid = [];
for (const m5 of [3,5,6,7,8,10,12,15,18]) for (const era of [0.8,1.0,1.2,1.5,1.8,2.0,2.5]) for (const vr of [0.5,0.8,1.0,1.2,1.5,2.0])
  for (const atrMin of [3,4,5,6,8,10]) momGrid.push({ m5, era, vr, atrMin });

const momResults = gridSearchPattern('MOM', (p, c) => p.mom5>=c.m5 && p.eRA>=c.era && p.volRatio20>=c.vr && p.atrPctVal>=c.atrMin && p.aboveSMA50, momGrid, trainPts);
console.log(`Tested ${momGrid.length} combos, ${momResults.length} passed min-30 gate\n`);
console.log('Top 20 by monster rate (TRAIN):');
console.log('  Mom5≥│eRA≥ │VR≥  │ATR≥ │ Count│ Rate%  │AvgMFE%│Avg20d%');
console.log('  ─────┼─────┼─────┼─────┼──────┼────────┼───────┼───────');
for (let i=0;i<Math.min(20,momResults.length);i++) {
  const r = momResults[i];
  console.log(`  ${String(r.m5).padStart(4)}%│${r.era.toFixed(1).padStart(4)} │${r.vr.toFixed(1).padStart(4)} │${String(r.atrMin).padStart(4)}%│ ${String(r.n).padStart(4)} │ ${r.rate.toFixed(1).padStart(6)}%│ ${('+'+r.avgMFE.toFixed(1)).padStart(6)}%│ ${(r.avgFwd>=0?'+':'')+r.avgFwd.toFixed(1)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4: MEAN REVERSION grid search
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  🔄 MEAN REVERSION — Grid Search on TRAIN (60%)                          ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const mrvGrid = [];
for (const sw of [-10,-12,-15,-18,-20,-22,-25,-28,-30,-35]) for (const rsi of [10,15,20,25,30,40,50,60,70])
  for (const pvr of [0.3,0.4,0.5,0.6,0.7,0.8,0.9,1.0,1.1]) for (const lw of [0,15,25,40])
  mrvGrid.push({ sw, rsi, pvr, lw });

const mrvResults = gridSearchPattern('MRV', (p, c) => p.swingDist<=c.sw && p.rsi2<=c.rsi && p.pre10VR<=c.pvr && p.lowerWick>=c.lw, mrvGrid, trainPts);
console.log(`Tested ${mrvGrid.length} combos, ${mrvResults.length} passed min-30 gate\n`);
console.log('Top 20 by monster rate (TRAIN):');
console.log('  Swing≤│RSI≤│PVR≤ │LW≥  │ Count│ Rate%  │AvgMFE%│Avg20d%');
console.log('  ──────┼────┼─────┼─────┼──────┼────────┼───────┼───────');
for (let i=0;i<Math.min(20,mrvResults.length);i++) {
  const r = mrvResults[i];
  console.log(`  ${String(r.sw).padStart(5)}%│${String(r.rsi).padStart(3)} │${r.pvr.toFixed(1).padStart(4)} │${String(r.lw).padStart(4)}%│ ${String(r.n).padStart(4)} │ ${r.rate.toFixed(1).padStart(6)}%│ ${('+'+r.avgMFE.toFixed(1)).padStart(6)}%│ ${(r.avgFwd>=0?'+':'')+r.avgFwd.toFixed(1)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5: BREAKOUT grid search
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  💥 BREAKOUT — Grid Search on TRAIN (60%)                                 ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');

const brkGrid = [];
for (const era of [1.2,1.5,1.8,2.0,2.5,3.0]) for (const vr of [1.0,1.5,2.0,2.5,3.0,4.0])
  for (const cl of [40,50,60,65,70,75,80]) for (const bp of [20,30,40,50,60]) for (const pvr of [0.5,0.7,0.8,0.9,1.0,1.2])
  brkGrid.push({ era, vr, cl, bp, pvr });

const brkResults = gridSearchPattern('BRK', (p, c) => p.eRA>=c.era && p.volRatio20>=c.vr && p.closeLoc>=c.cl && p.bodyPct>=c.bp && p.pre10VR<=c.pvr, brkGrid, trainPts);
console.log(`Tested ${brkGrid.length} combos, ${brkResults.length} passed min-30 gate\n`);
console.log('Top 20 by monster rate (TRAIN):');
console.log('  eRA≥ │VR≥  │CL≥ │BP≥ │PVR≤ │ Count│ Rate%  │AvgMFE%│Avg20d%');
console.log('  ─────┼─────┼────┼────┼─────┼──────┼────────┼───────┼───────');
for (let i=0;i<Math.min(20,brkResults.length);i++) {
  const r = brkResults[i];
  console.log(`  ${r.era.toFixed(1).padStart(4)} │${r.vr.toFixed(1).padStart(4)} │${String(r.cl).padStart(3)} │${String(r.bp).padStart(3)} │${r.pvr.toFixed(1).padStart(4)} │ ${String(r.n).padStart(4)} │ ${r.rate.toFixed(1).padStart(6)}%│ ${('+'+r.avgMFE.toFixed(1)).padStart(6)}%│ ${(r.avgFwd>=0?'+':'')+r.avgFwd.toFixed(1)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6: Build FINE-GRAINED tiers (5-6 tiers per pattern) using TRAIN, then
// validate each tier on TEST (OOS)
// ═══════════════════════════════════════════════════════════════════════════════
function buildTiers(name, results, dataset, testset, filterBuilder, minN) {
  console.log(`\n── ${name}: Fine-Grained Tier Construction (min n=${minN}/tier) ──`);
  const balanced = results.filter(r => r.n >= minN).sort((a,b) => b.rate - a.rate);
  const tiers = [];
  const usedSignatures = new Set();
  for (const r of balanced) {
    if (tiers.length >= 6) break;
    // De-duplicate near-identical tiers (avoid 10 variants of the same combo)
    const sig = JSON.stringify(Object.keys(r).filter(k=>!['n','rate','avgMFE','avgFwd'].includes(k)).map(k=>r[k]));
    if (usedSignatures.has(sig)) continue;
    // Reject if too similar in rate% to existing tier (within 1.5pp) — keep diversity
    if (tiers.some(t => Math.abs(t.rate - r.rate) < 1.5 && t.n > r.n*0.7)) continue;
    usedSignatures.add(sig);
    tiers.push(r);
  }
  console.log(`  Found ${tiers.length} distinct tiers from TRAIN data\n`);
  console.log('  Tier │ TRAIN Rate% │ TRAIN N │ Params');
  console.log('  ─────┼─────────────┼─────────┼────────────────────────────');
  const testedTiers = [];
  for (let i=0;i<tiers.length;i++) {
    const t = tiers[i];
    const filterFn = filterBuilder(t);
    const testMatch = testset.filter(p => filterFn(p));
    const testMonsters = testMatch.filter(p => p.isMonster).length;
    const testRate = testMatch.length > 0 ? testMonsters/testMatch.length*100 : 0;
    const paramStr = Object.entries(t).filter(([k])=>!['n','rate','avgMFE','avgFwd'].includes(k)).map(([k,v])=>`${k}=${v}`).join(',');
    console.log(`  T${i+1}   │ ${t.rate.toFixed(1).padStart(9)}%  │ ${String(t.n).padStart(7)} │ ${paramStr}`);
    testedTiers.push({ ...t, testN: testMatch.length, testRate });
  }
  console.log('\n  OOS VALIDATION (on TEST/40% unseen data):');
  console.log('  Tier │ TRAIN Rate% │ TEST Rate% │ TEST N │ Degradation');
  console.log('  ─────┼─────────────┼────────────┼────────┼────────────');
  for (let i=0;i<testedTiers.length;i++) {
    const t = testedTiers[i];
    const deg = t.testRate - t.rate;
    const flag = t.testN < 15 ? '⚠ thin' : Math.abs(deg) <= 15 ? '✅' : deg < -15 ? '🔴' : '🟢';
    console.log(`  T${i+1}   │ ${t.rate.toFixed(1).padStart(9)}%  │ ${t.testRate.toFixed(1).padStart(8)}%  │ ${String(t.testN).padStart(6)} │ ${(deg>=0?'+':'')+deg.toFixed(1)}pp ${flag}`);
  }
  return testedTiers;
}

console.log('\n\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  STEP 6: FINE-GRAINED TIERS + OOS VALIDATION                              ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝');

const momTiers = buildTiers('MOMENTUM', momResults, trainPts, testPts,
  (t) => (p) => p.mom5>=t.m5 && p.eRA>=t.era && p.volRatio20>=t.vr && p.atrPctVal>=t.atrMin && p.aboveSMA50, 40);

const mrvTiers = buildTiers('MEAN REVERSION', mrvResults, trainPts, testPts,
  (t) => (p) => p.swingDist<=t.sw && p.rsi2<=t.rsi && p.pre10VR<=t.pvr && p.lowerWick>=t.lw, 25);

const brkTiers = buildTiers('BREAKOUT', brkResults, trainPts, testPts,
  (t) => (p) => p.eRA>=t.era && p.volRatio20>=t.vr && p.closeLoc>=t.cl && p.bodyPct>=t.bp && p.pre10VR<=t.pvr, 25);

console.log('\n═══ MONSTER RECALIBRATION COMPLETE ═══');
