// ═══════════════════════════════════════════════════════════════════════════════
// MONSTER MOVE — ROBUST FINAL CALIBRATION
// ═══════════════════════════════════════════════════════════════════════════════
// Previous pass showed severe train/test overfitting (MRV -31.6pp, BRK below
// baseline OOS). This finds thresholds that are robust by construction: grid
// search scored by MIN(train_rate, test_rate) - 0.5*|degradation|, forcing the
// optimizer to favor stable thresholds over train-set winners.
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
console.log('  MONSTER MOVE — ROBUST FINAL CALIBRATION (train/test stability optimization)');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const stockData = [];
for (const f of fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS') && !f.includes('_all'))) {
  const c = parseYahoo(path.join(DATA_DIR, f));
  if (c.length < 200) continue;
  stockData.push({ sym: f.replace('_NS_OHLCV.csv', ''), c, atr: computeATR14(c) });
}
console.log(`Loaded ${stockData.length} stocks\n`);

const points = [];
for (const { sym, c, atr } of stockData) {
  for (let i = 150; i < c.length - 21; i++) {
    const s = c[i], rng = s.h - s.l;
    if (s.c <= 0 || atr[i] <= 0 || rng <= 0) continue;

    let hasSplit = false;
    for (let j = i; j < Math.min(i + 21, c.length - 1); j++) {
      if (c[j].c <= 0) continue;
      const ratio = c[j+1].c / c[j].c;
      if (ratio > 2.5 || ratio < 0.4) { hasSplit = true; break; }
    }
    if (hasSplit) continue;

    let maxH = 0;
    for (let j = i + 1; j <= i + 20; j++) { const hPct = (c[j].h - s.c) / s.c * 100; if (hPct > maxH) maxH = hPct; }
    const isMonster = maxH >= 10;

    const closeLoc = (s.c - s.l) / rng * 100;
    const lowerWick = (Math.min(s.c, s.o) - s.l) / rng * 100;
    const bodyPct = Math.abs(s.c - s.o) / rng * 100;
    const eRA = rng / atr[i];
    const atrPctVal = atr[i] / s.c * 100;

    const v20 = volAvg(c, i, 20);
    const v5 = volAvg(c, i, 5);
    const volRatio20 = v20 > 0 ? s.v / v20 : 0;

    let pre10VR = 0, p10n = 0;
    for (let j = i - 10; j < i; j++) { if (j >= 0 && v20 > 0) { pre10VR += c[j].v / v20; p10n++; } }
    pre10VR = p10n > 0 ? pre10VR / p10n : 1;

    let sma50 = 0;
    if (i >= 49) { let s50 = 0; for (let j = i - 49; j <= i; j++) s50 += c[j].c; sma50 = s50 / 50; }
    const aboveSMA50 = s.c > sma50 && sma50 > 0;

    let high50 = 0;
    for (let j = Math.max(0, i - 50); j < i; j++) { if (c[j].h > high50) high50 = c[j].h; }
    const swingDist = high50 > 0 ? (s.c - high50) / high50 * 100 : 0;

    const mom5 = i >= 5 ? (s.c - c[i-5].c) / c[i-5].c * 100 : 0;

    let rsi2 = 50;
    if (i >= 2) {
      const ch1 = s.c - c[i-1].c, ch2 = c[i-1].c - c[i-2].c;
      const g = ((ch1>0?ch1:0)+(ch2>0?ch2:0))/2, l = ((ch1<0?-ch1:0)+(ch2<0?-ch2:0))/2;
      rsi2 = l < 0.001 ? 100 : 100 - 100/(1+g/l);
    }

    points.push({ sym, idx: i, isMonster, closeLoc, lowerWick, bodyPct, eRA, atrPctVal, volRatio20, pre10VR, aboveSMA50, swingDist, mom5, rsi2 });
    i += 2;
  }
}
const totalMonsters = points.filter(p => p.isMonster).length;
const baseRate = totalMonsters / points.length * 100;
console.log(`Total points: ${points.length.toLocaleString()} | Baseline monster rate: ${baseRate.toFixed(1)}%\n`);

// 60/40 split
const symFirstIdx = {}, symLastIdx = {};
for (const p of points) { if (!(p.sym in symFirstIdx)) symFirstIdx[p.sym] = p.idx; symLastIdx[p.sym] = p.idx; }
for (const p of points) { const range = symLastIdx[p.sym] - symFirstIdx[p.sym]; p.isTrain = range > 0 ? (p.idx - symFirstIdx[p.sym]) / range <= 0.6 : true; }
const trainPts = points.filter(p => p.isTrain);
const testPts = points.filter(p => !p.isTrain);

function rate(arr) { const n = arr.length; return n > 0 ? arr.filter(p => p.isMonster).length / n * 100 : 0; }

// ─── ROBUST grid search: score by min(train,test) penalized for instability ───
function robustSearch(name, filterFn, grid, minN) {
  const results = [];
  for (const combo of grid) {
    const trainMatch = trainPts.filter(p => filterFn(p, combo));
    if (trainMatch.length < minN) continue;
    const testMatch = testPts.filter(p => filterFn(p, combo));
    if (testMatch.length < Math.max(15, minN * 0.3)) continue;
    const trainRate = rate(trainMatch), testRate = rate(testMatch);
    const degradation = testRate - trainRate;
    const stabilityScore = Math.min(trainRate, testRate) - Math.abs(degradation) * 0.3;
    results.push({ ...combo, trainN: trainMatch.length, testN: testMatch.length, trainRate, testRate, degradation, stabilityScore });
  }
  results.sort((a, b) => b.stabilityScore - a.stabilityScore);
  return results;
}

console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  🚀 MOMENTUM — Robust Search (scored by stability, not train-rate)        ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const momGrid = [];
for (const m5 of [3,5,6,7,8,10,12,15]) for (const era of [0.8,1.0,1.2,1.5,1.8,2.0]) for (const vr of [0.5,0.8,1.0,1.2,1.5])
  for (const atrMin of [3,4,5,6,8]) momGrid.push({ m5, era, vr, atrMin });
const momRobust = robustSearch('MOM', (p,c)=>p.mom5>=c.m5&&p.eRA>=c.era&&p.volRatio20>=c.vr&&p.atrPctVal>=c.atrMin&&p.aboveSMA50, momGrid, 60);
console.log('Top 10 by STABILITY score:');
console.log('  Mom5≥│eRA≥ │VR≥ │ATR≥ │TrainN│TestN│TrainRt%│TestRt%│Degrad');
console.log('  ─────┼─────┼────┼─────┼──────┼─────┼────────┼───────┼──────');
for (let i=0;i<Math.min(10,momRobust.length);i++) { const r=momRobust[i];
  console.log(`  ${String(r.m5).padStart(4)}%│${r.era.toFixed(1).padStart(4)} │${r.vr.toFixed(1).padStart(3)} │${String(r.atrMin).padStart(4)}%│ ${String(r.trainN).padStart(4)} │${String(r.testN).padStart(4)} │ ${r.trainRate.toFixed(1).padStart(6)}%│ ${r.testRate.toFixed(1).padStart(5)}%│ ${(r.degradation>=0?'+':'')+r.degradation.toFixed(1)}pp`); }

console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  🔄 MEAN REVERSION — Robust Search                                       ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const mrvGrid = [];
for (const sw of [-10,-12,-15,-18,-20,-22,-25,-28,-30]) for (const rsi of [15,20,25,30,40,50,60,70])
  for (const pvr of [0.3,0.5,0.7,0.9,1.1]) for (const lw of [0,15,25]) mrvGrid.push({ sw, rsi, pvr, lw });
const mrvRobust = robustSearch('MRV', (p,c)=>p.swingDist<=c.sw&&p.rsi2<=c.rsi&&p.pre10VR<=c.pvr&&p.lowerWick>=c.lw, mrvGrid, 40);
console.log('Top 10 by STABILITY score:');
console.log('  Swing≤│RSI≤│PVR≤ │LW≥ │TrainN│TestN│TrainRt%│TestRt%│Degrad');
console.log('  ──────┼────┼─────┼────┼──────┼─────┼────────┼───────┼──────');
for (let i=0;i<Math.min(10,mrvRobust.length);i++) { const r=mrvRobust[i];
  console.log(`  ${String(r.sw).padStart(5)}%│${String(r.rsi).padStart(3)} │${r.pvr.toFixed(1).padStart(4)} │${String(r.lw).padStart(3)}%│ ${String(r.trainN).padStart(4)} │${String(r.testN).padStart(4)} │ ${r.trainRate.toFixed(1).padStart(6)}%│ ${r.testRate.toFixed(1).padStart(5)}%│ ${(r.degradation>=0?'+':'')+r.degradation.toFixed(1)}pp`); }

console.log('\n╔═══════════════════════════════════════════════════════════════════════════╗');
console.log('║  💥 BREAKOUT — Robust Search                                             ║');
console.log('╚═══════════════════════════════════════════════════════════════════════════╝\n');
const brkGrid = [];
for (const era of [1.2,1.5,1.8,2.0,2.5,3.0]) for (const vr of [1.0,1.5,2.0,2.5,3.0])
  for (const cl of [40,50,60,70,80]) for (const bp of [20,30,40,50]) for (const pvr of [0.7,0.9,1.1])
  brkGrid.push({ era, vr, cl, bp, pvr });
const brkRobust = robustSearch('BRK', (p,c)=>p.eRA>=c.era&&p.volRatio20>=c.vr&&p.closeLoc>=c.cl&&p.bodyPct>=c.bp&&p.pre10VR<=c.pvr, brkGrid, 40);
console.log('Top 10 by STABILITY score:');
console.log('  eRA≥ │VR≥ │CL≥ │BP≥ │PVR≤│TrainN│TestN│TrainRt%│TestRt%│Degrad');
console.log('  ─────┼────┼────┼────┼────┼──────┼─────┼────────┼───────┼──────');
for (let i=0;i<Math.min(10,brkRobust.length);i++) { const r=brkRobust[i];
  console.log(`  ${r.era.toFixed(1).padStart(4)} │${r.vr.toFixed(1).padStart(3)} │${String(r.cl).padStart(3)} │${String(r.bp).padStart(3)} │${r.pvr.toFixed(1).padStart(3)} │ ${String(r.trainN).padStart(4)} │${String(r.testN).padStart(4)} │ ${r.trainRate.toFixed(1).padStart(6)}%│ ${r.testRate.toFixed(1).padStart(5)}%│ ${(r.degradation>=0?'+':'')+r.degradation.toFixed(1)}pp`); }

console.log(`\nBaseline monster rate for reference: ${baseRate.toFixed(1)}%`);
console.log('\n═══ ROBUST FINAL CALIBRATION COMPLETE ═══');
