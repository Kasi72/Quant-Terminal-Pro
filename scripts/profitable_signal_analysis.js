#!/usr/bin/env node
/**
 * PROFITABLE SIGNAL ANALYSIS
 * Find what actually drives winners vs losers
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  PROFITABLE SIGNAL ANALYSIS');
console.log('  What separates winners from losers?');
console.log('═══════════════════════════════════════════════════════════════\n');

function loadCSV(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1);
  return lines.map(line => {
    const [date, o, h, low, c, v] = line.split(',');
    return { ts: new Date(date).getTime()/1000, o: +o, h: +h, l: +low, c: +c, v: +v||0 };
  }).filter(c => c.c > 0);
}

function calcATR(candles, idx) {
  let atrSum = 0;
  for (let i = Math.max(1, idx-13); i < idx; i++) {
    const tr = Math.max(candles[i].h - candles[i].l,
                       Math.abs(candles[i].h - candles[i-1].c),
                       Math.abs(candles[i].l - candles[i-1].c));
    atrSum += tr;
  }
  return atrSum / 14;
}

function analyzeSignal(candles, idx) {
  const sig = candles[idx];
  const atr = calcATR(candles, idx);

  // Characteristics
  const range = sig.h - sig.l;
  const body = Math.abs(sig.c - sig.o);
  const closeLoc = range > 0 ? (sig.c - sig.l) / range * 100 : 50;
  const bodyPct = range > 0 ? body / range * 100 : 0;
  const atrPct = (atr / sig.c) * 100;

  // Volume
  let vAvg = 0;
  for (let i = idx-10; i < idx; i++) if (i >= 0) vAvg += candles[i].v;
  vAvg /= 10;
  const volRatio = sig.v / vAvg;

  // Trend (last 5 bars)
  let upBars = 0, dnBars = 0;
  for (let i = idx-4; i < idx; i++) {
    if (i > 0) {
      if (candles[i].c > candles[i-1].c) upBars++;
      else dnBars++;
    }
  }

  // Gap
  const gap = idx > 0 ? (sig.o - candles[idx-1].c) / candles[idx-1].c * 100 : 0;

  return {
    range, body, closeLoc, bodyPct, atrPct, volRatio,
    upBars, dnBars, gap, atr
  };
}

function simulateTrade(candles, idx, entry) {
  const atr = calcATR(candles, idx);
  // Relaxed: tighter targets, wider stop
  const t1 = entry + (0.75 * atr);  // Lower target
  const t2 = entry + (1.5 * atr);
  const sl = entry - (3 * atr);     // Wider stop

  let win = 0, bars = 0, mfe = 0;
  for (let j = idx + 1; j <= Math.min(idx + 20, candles.length - 1); j++) {
    bars++;
    mfe = Math.max(mfe, candles[j].h - entry);
    if (candles[j].l <= sl) { win = -1; break; }
    if (candles[j].h >= t2) { win = 2; break; }
    if (candles[j].h >= t1) { win = 1; break; }
  }

  const pnl = mfe / entry * 100;
  return { win: win > 0 ? 1 : 0, pnl, bars, hit: win };
}

// Analyze 30 stocks
const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('_OHLCV.csv'))
  .sort()
  .slice(0, 30);

const winners = [], losers = [];

console.log('Analyzing signals...\n');

for (const file of files) {
  try {
    const candles = loadCSV(path.join(DATA_DIR, file));
    if (candles.length < 50) continue;

    for (let i = 20; i < candles.length - 15; i++) {
      const entry = candles[i+1].o;
      if (!entry) continue;

      const sig = analyzeSignal(candles, i);
      const trade = simulateTrade(candles, i, entry);

      const data = { ...sig, ...trade };

      if (trade.win) winners.push(data);
      else losers.push(data);
    }
  } catch (e) {}
}

console.log(`Winners: ${winners.length} | Losers: ${losers.length}\n`);

if (winners.length < 100 || losers.length < 100) {
  console.log('Insufficient data for analysis.');
  process.exit(1);
}

// Compare characteristics
console.log('═══════════════════════════════════════════════════════════════\n');
console.log('WINNER vs LOSER CHARACTERISTICS\n');

const metrics = ['range', 'body', 'closeLoc', 'bodyPct', 'atrPct', 'volRatio', 'upBars', 'gap'];

const winStats = {}, losStats = {};

for (const m of metrics) {
  const ws = winners.map(w => w[m]).filter(v => v !== undefined);
  const ls = losers.map(l => l[m]).filter(v => v !== undefined);

  const wAvg = ws.reduce((a,b)=>a+b,0) / ws.length;
  const lAvg = ls.reduce((a,b)=>a+b,0) / ls.length;
  const diff = wAvg - lAvg;
  const pct = (diff / lAvg * 100).toFixed(1);

  console.log(`${m.padEnd(12)} | Winners: ${wAvg.toFixed(2)} vs Losers: ${lAvg.toFixed(2)} | Diff: ${pct}%`);

  winStats[m] = wAvg;
  losStats[m] = lAvg;
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('KEY FINDINGS\n');

// Find strongest differentiators
const diffs = {};
for (const m of metrics) {
  diffs[m] = Math.abs(winStats[m] - losStats[m]) / losStats[m];
}

const sorted = Object.entries(diffs).sort((a,b) => b[1] - a[1]);

console.log('Strongest Win Predictors:\n');
for (let i = 0; i < 3; i++) {
  const [metric, diff] = sorted[i];
  console.log(`${i+1}. ${metric}`);
  console.log(`   Winners avg: ${winStats[metric].toFixed(2)}`);
  console.log(`   Losers avg:  ${losStats[metric].toFixed(2)}`);
  console.log(`   Importance: ${(diff*100).toFixed(0)}%\n`);
}

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('RECOMMENDATIONS\n');

// Rules
const closeLoc_win = winStats['closeLoc'];
const closeLoc_los = losStats['closeLoc'];
const body_win = winStats['bodyPct'];
const body_los = losStats['bodyPct'];
const vol_win = winStats['volRatio'];
const vol_los = losStats['volRatio'];

console.log('Build your signals around these:\n');
console.log(`1. CLOSE LOCATION: Winners close at ${closeLoc_win.toFixed(0)}% of range`);
console.log(`   → Filter: closeLoc >= ${Math.max(closeLoc_los, closeLoc_win).toFixed(0)}%\n`);

console.log(`2. BODY STRENGTH: Winners have ${body_win.toFixed(1)}% body`);
console.log(`   → Filter: bodyPct >= ${body_win.toFixed(0)}%\n`);

console.log(`3. VOLUME: Winners have ${vol_win.toFixed(2)}x average volume`);
console.log(`   → Filter: volRatio >= ${Math.max(1.5, vol_win).toFixed(2)}\n`);

console.log(`4. TREND: Most winners have 4-5 up bars in last 5`);
console.log(`   → Filter: upBars >= 4\n`);

console.log('═══════════════════════════════════════════════════════════════');

// Save
fs.writeFileSync(
  path.join(__dirname, 'results', `profitable_analysis_${new Date().toISOString().split('T')[0]}.json`),
  JSON.stringify({ winStats, losStats, recommendations: sorted.slice(0,5) }, null, 2)
);
