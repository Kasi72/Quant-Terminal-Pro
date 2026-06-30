// ═══════════════════════════════════════════════════════════════════════════════
// MOM PATTERN — ATR% THRESHOLD SWEEP
// ═══════════════════════════════════════════════════════════════════════════════
// Follow-up to the GUFIC near-miss: Mom5=8.74%, eRA=1.68, VolRatio=1.37x,
// aboveSMA50=true all cleared the validated MOM thresholds, but ATR%=4.50%
// missed the 5% floor by a hair. This sweeps the ATR floor specifically
// (holding Mom5>=7, eRA>=1.2, VR>=1.0, aboveSMA50 fixed at their already-
// validated levels) to see whether lowering it catches more real monster
// moves or just adds false positives -- using the same 60/40 train/test
// split + split-guard methodology as the original Monster Move recalibration.
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
console.log('  MOM PATTERN — ATR% THRESHOLD SWEEP (Mom5>=7, eRA>=1.2, VR>=1.0, aboveSMA50 fixed)');
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

    const eRA = rng / atr[i];
    const atrPctVal = atr[i] / s.c * 100;
    const v20 = volAvg(c, i, 20);
    const volRatio20 = v20 > 0 ? s.v / v20 : 0;
    const mom5 = i >= 5 ? (s.c - c[i-5].c) / c[i-5].c * 100 : 0;

    let sma50 = 0;
    if (i >= 49) { let s50 = 0; for (let j = i - 49; j <= i; j++) s50 += c[j].c; sma50 = s50 / 50; }
    const aboveSMA50 = s.c > sma50 && sma50 > 0;

    // Fixed gate on the already-validated dims; only ATR% is swept below
    if (mom5 < 7 || eRA < 1.2 || volRatio20 < 1.0 || !aboveSMA50) continue;

    points.push({ sym, idx: i, isMonster, atrPctVal });
    i += 2;
  }
}
console.log(`Candidates passing fixed gates (Mom5>=7, eRA>=1.2, VR>=1.0, aboveSMA50): ${points.length.toLocaleString()}\n`);

// 60/40 chronological split (same methodology as original recalibration)
const symFirstIdx = {}, symLastIdx = {};
for (const p of points) { if (!(p.sym in symFirstIdx)) symFirstIdx[p.sym] = p.idx; symLastIdx[p.sym] = p.idx; }
for (const p of points) { const range = symLastIdx[p.sym] - symFirstIdx[p.sym]; p.isTrain = range > 0 ? (p.idx - symFirstIdx[p.sym]) / range <= 0.6 : true; }
const trainPts = points.filter(p => p.isTrain);
const testPts = points.filter(p => !p.isTrain);
console.log(`Train: ${trainPts.length} | Test/OOS: ${testPts.length}\n`);

function rate(arr) { return arr.length > 0 ? arr.filter(p => p.isMonster).length / arr.length * 100 : 0; }

console.log('ATR%≥ │ TrainN │ TestN │ TrainRate% │ TestRate%(OOS) │ Degrad   │ Stability');
console.log('──────┼────────┼───────┼────────────┼────────────────┼──────────┼──────────');

const sweepResults = [];
for (let atrMin = 2.5; atrMin <= 8.0; atrMin += 0.25) {
  const trainMatch = trainPts.filter(p => p.atrPctVal >= atrMin);
  const testMatch = testPts.filter(p => p.atrPctVal >= atrMin);
  if (trainMatch.length < 20 || testMatch.length < 10) continue;
  const trainRate = rate(trainMatch), testRate = rate(testMatch);
  const degradation = testRate - trainRate;
  const stability = Math.min(trainRate, testRate) - Math.abs(degradation) * 0.3;
  sweepResults.push({ atrMin, trainN: trainMatch.length, testN: testMatch.length, trainRate, testRate, degradation, stability });
  console.log(`${atrMin.toFixed(2).padStart(5)}%│ ${String(trainMatch.length).padStart(6)} │ ${String(testMatch.length).padStart(5)} │ ${trainRate.toFixed(1).padStart(9)}% │ ${testRate.toFixed(1).padStart(13)}% │ ${(degradation>=0?'+':'')+degradation.toFixed(1).padStart(6)}pp │ ${stability.toFixed(1)}`);
}

console.log('\n═══ ZOOMED VIEW: 4.0%-5.5% (the GUFIC near-miss zone) ═══\n');
console.log('ATR%≥ │ TrainN │ TestN │ TrainRate% │ TestRate%(OOS) │ Degrad');
console.log('──────┼────────┼───────┼────────────┼────────────────┼──────────');
for (const r of sweepResults.filter(r => r.atrMin >= 4.0 && r.atrMin <= 5.5)) {
  console.log(`${r.atrMin.toFixed(2).padStart(5)}%│ ${String(r.trainN).padStart(6)} │ ${String(r.testN).padStart(5)} │ ${r.trainRate.toFixed(1).padStart(9)}% │ ${r.testRate.toFixed(1).padStart(13)}% │ ${(r.degradation>=0?'+':'')+r.degradation.toFixed(1)}pp`);
}

// Best by raw OOS rate vs best by stability
const byOOS = [...sweepResults].sort((a,b) => b.testRate - a.testRate)[0];
const byStability = [...sweepResults].sort((a,b) => b.stability - a.stability)[0];
console.log(`\nBest by raw OOS test rate: ATR%>=${byOOS.atrMin.toFixed(2)} -> ${byOOS.testRate.toFixed(1)}% OOS (train ${byOOS.trainRate.toFixed(1)}%, n=${byOOS.testN})`);
console.log(`Best by stability score:   ATR%>=${byStability.atrMin.toFixed(2)} -> ${byStability.testRate.toFixed(1)}% OOS (train ${byStability.trainRate.toFixed(1)}%, n=${byStability.testN})`);

// Specifically report what happens at the current 5.0% floor vs a lowered 4.0% floor
const at40 = sweepResults.find(r => Math.abs(r.atrMin - 4.0) < 0.01);
const at50 = sweepResults.find(r => Math.abs(r.atrMin - 5.0) < 0.01);
if (at40 && at50) {
  console.log(`\n── Current floor (5.0%) vs lowering to 4.0% (would have caught GUFIC) ──`);
  console.log(`  ATR>=5.0%: TrainN=${at50.trainN} TestN=${at50.testN} OOS=${at50.testRate.toFixed(1)}%`);
  console.log(`  ATR>=4.0%: TrainN=${at40.trainN} TestN=${at40.testN} OOS=${at40.testRate.toFixed(1)}%`);
  console.log(`  Extra OOS candidates gained by lowering to 4.0%: ${at40.testN - at50.testN}`);
  console.log(`  OOS hit-rate change: ${(at40.testRate - at50.testRate >= 0 ? '+' : '')}${(at40.testRate - at50.testRate).toFixed(1)}pp`);
}

console.log('\n═══ MOM ATR THRESHOLD SWEEP COMPLETE ═══');
