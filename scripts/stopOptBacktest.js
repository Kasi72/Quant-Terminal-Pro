// Stop-Loss Optimization Backtest on 29 OHLCV files
// Tests different minimum stop widths and reports hit rate, expectancy, false stop-out rate

const fs = require('fs');
const path = require('path');

const DIR = 'C:/Users/drkkr/Downloads/Portfolio';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv') && !f.includes('(1)'));

function parseCSV(filepath) {
  const lines = fs.readFileSync(filepath, 'utf8').trim().split('\n');
  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, o, h, l, c, v] = lines[i].split(',');
    const [d, m, y] = date.split('-');
    const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
    const ts = new Date(parseInt(y), months[m], parseInt(d)).getTime() / 1000;
    candles.push({ ts, o: +o, h: +h, l: +l, c: +c, v: +v });
  }
  return candles;
}

function computeATR14(candles) {
  const atr = new Array(candles.length).fill(0);
  if (candles.length < 15) return atr;
  let sum = 0;
  for (let i = 1; i <= 14; i++) {
    sum += Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i-1].c), Math.abs(candles[i].l - candles[i-1].c));
  }
  atr[14] = sum / 14;
  for (let i = 15; i < candles.length; i++) {
    const tr = Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i-1].c), Math.abs(candles[i].l - candles[i-1].c));
    atr[i] = (atr[i-1] * 13 + tr) / 14;
  }
  return atr;
}

// Find compression breakout signals (same as screener logic)
function findSignals(candles, atr) {
  const signals = [];
  for (let i = 40; i < candles.length - 11; i++) {
    const sig = candles[i];
    const r = sig.h - sig.l;
    if (r <= 0 || sig.c <= 0 || atr[i] <= 0) continue;
    const rangeATR = r / atr[i];
    const closeLoc = (sig.c - sig.l) / r * 100;
    const bodyPct = Math.abs(sig.c - sig.o) / r * 100;
    const uwPct = (sig.h - Math.max(sig.o, sig.c)) / r * 100;

    // Pre-6 compression
    let compressed = true;
    for (let j = i - 6; j < i; j++) {
      if (j < 1) { compressed = false; break; }
      const pTr = Math.max(candles[j].h - candles[j].l, Math.abs(candles[j].h - candles[j-1].c), Math.abs(candles[j].l - candles[j-1].c));
      if (pTr / atr[j] > 1.0) { compressed = false; break; }
    }
    if (!compressed) continue;

    // Zone
    let zoneHigh = -Infinity, zoneLow = Infinity;
    for (let j = i - 6; j < i; j++) {
      if (j < 0) continue;
      zoneHigh = Math.max(zoneHigh, candles[j].h);
      zoneLow = Math.min(zoneLow, candles[j].l);
    }
    if (sig.c <= zoneHigh * 1.001) continue;

    // Volume
    let volSum = 0;
    for (let j = Math.max(0, i - 20); j < i; j++) volSum += candles[j].v;
    const avgVol = volSum / Math.max(i - Math.max(0, i - 20), 1);
    const volRatio = avgVol > 0 ? sig.v / avgVol : 0;

    if (rangeATR < 1.0 || closeLoc < 60 || bodyPct < 30 || uwPct > 40 || volRatio < 1.2) continue;

    signals.push({ idx: i, entry: candles[i+1]?.o || sig.c, zoneLow, atr: atr[i] });
  }
  return signals;
}

// Test different stop widths
const stopWidths = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 6.0, 7.0];
const results = {};
for (const sw of stopWidths) {
  results[sw] = { total: 0, hits: 0, stops: 0, expired: 0, totalR: 0, falseStopOuts: 0 };
}

let totalFiles = 0;
for (const file of files) {
  const candles = parseCSV(path.join(DIR, file));
  if (candles.length < 60) continue;
  totalFiles++;
  const atr = computeATR14(candles);
  const signals = findSignals(candles, atr);

  for (const sig of signals) {
    const entry = sig.entry * 1.0005; // slippage
    if (entry <= 0) continue;

    for (const sw of stopWidths) {
      const stopLoss = entry * (1 - sw / 100);
      const riskPerShare = entry - stopLoss;
      if (riskPerShare <= 0) continue;

      // T1: clamp(2.15 * atrPct, 3%, 5%)
      const atrPct = (sig.atr / entry) * 100;
      const t1Pct = Math.max(3.0, Math.min(5.0, 2.15 * atrPct));
      const target1 = entry * (1 + t1Pct / 100);

      // Simulate 10 days
      let exitType = 'expired', exitPrice = 0, mfe = 0;
      for (let d = sig.idx + 2; d <= Math.min(sig.idx + 11, candles.length - 1); d++) {
        const dc = candles[d];
        if (dc.h > entry) mfe = Math.max(mfe, (dc.h - entry) / entry * 100);

        if (dc.l <= stopLoss) { exitType = 'stopped'; exitPrice = stopLoss; break; }
        if (dc.h >= target1) { exitType = 'target'; exitPrice = target1; break; }
      }
      if (exitType === 'expired') {
        const lastIdx = Math.min(sig.idx + 11, candles.length - 1);
        exitPrice = candles[lastIdx].c;
      }

      const pnlR = (exitPrice - entry) / riskPerShare;
      results[sw].total++;
      results[sw].totalR += pnlR;
      if (exitType === 'target') results[sw].hits++;
      else if (exitType === 'stopped') {
        results[sw].stops++;
        // False stop-out: stopped but MFE > T1 (would have won with wider stop)
        if (mfe >= t1Pct) results[sw].falseStopOuts++;
      }
      else results[sw].expired++;
    }
  }
}

console.log(`\n=== STOP-LOSS OPTIMIZATION BACKTEST ===`);
console.log(`Files: ${totalFiles}, Signals tested per stop width\n`);
console.log('Stop%  | Trades | Hits  | Stops | Expired | Hit%   | Stop% | FalseStop | Expectancy');
console.log('-------|--------|-------|-------|---------|--------|-------|-----------|----------');
for (const sw of stopWidths) {
  const r = results[sw];
  const hitPct = r.total > 0 ? (r.hits / r.total * 100).toFixed(1) : '0';
  const stopPct = r.total > 0 ? (r.stops / r.total * 100).toFixed(1) : '0';
  const exp = r.total > 0 ? (r.totalR / r.total).toFixed(3) : '0';
  const fsRate = r.stops > 0 ? (r.falseStopOuts / r.stops * 100).toFixed(0) : '0';
  console.log(`${sw.toFixed(1).padStart(5)}% | ${String(r.total).padStart(6)} | ${String(r.hits).padStart(5)} | ${String(r.stops).padStart(5)} | ${String(r.expired).padStart(7)} | ${hitPct.padStart(5)}% | ${stopPct.padStart(4)}% | ${(fsRate + '%').padStart(9)} | ${exp.padStart(9)}R`);
}

// Find optimal
let bestExp = -Infinity, bestSW = 3.0;
for (const sw of stopWidths) {
  const r = results[sw];
  const exp = r.total > 0 ? r.totalR / r.total : 0;
  if (exp > bestExp) { bestExp = exp; bestSW = sw; }
}
console.log(`\nOptimal stop width: ${bestSW}% (expectancy ${bestExp.toFixed(3)}R)`);

// Also compute MAE distribution
console.log(`\n=== MAE DISTRIBUTION (at 5% stop width) ===`);
const maeData = [];
for (const file of files) {
  const candles = parseCSV(path.join(DIR, file));
  if (candles.length < 60) continue;
  const atr = computeATR14(candles);
  const signals = findSignals(candles, atr);
  for (const sig of signals) {
    const entry = sig.entry * 1.0005;
    if (entry <= 0) continue;
    let mae = 0;
    for (let d = sig.idx + 2; d <= Math.min(sig.idx + 11, candles.length - 1); d++) {
      const drop = (candles[d].l - entry) / entry * 100;
      if (drop < mae) mae = drop;
    }
    maeData.push(mae);
  }
}
maeData.sort((a, b) => a - b);
const p10 = maeData[Math.floor(maeData.length * 0.10)];
const p25 = maeData[Math.floor(maeData.length * 0.25)];
const p50 = maeData[Math.floor(maeData.length * 0.50)];
const p75 = maeData[Math.floor(maeData.length * 0.75)];
const p90 = maeData[Math.floor(maeData.length * 0.90)];
const avg = maeData.reduce((s, v) => s + v, 0) / maeData.length;
console.log(`Trades: ${maeData.length}`);
console.log(`Avg MAE:  ${avg.toFixed(2)}%`);
console.log(`P10 MAE:  ${p10.toFixed(2)}% (worst 10% of trades dip this much)`);
console.log(`P25 MAE:  ${p25.toFixed(2)}%`);
console.log(`P50 MAE:  ${p50.toFixed(2)}% (median)`);
console.log(`P75 MAE:  ${p75.toFixed(2)}%`);
console.log(`P90 MAE:  ${p90.toFixed(2)}% (90% of trades dip less than this)`);
console.log(`\nRecommendation: Set minimum stop at 1.5x P75 MAE = ${(Math.abs(p75) * 1.5).toFixed(2)}%`);
