#!/usr/bin/env node
/**
 * GENUINE STAGE THRESHOLD BACKTEST
 * Real trade simulation on OHLCV data
 * Tests actual entry/exit outcomes per stage
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  GENUINE STAGE BACKTEST - Real Trade Simulation');
console.log('═══════════════════════════════════════════════════════════════\n');

// Load CSV
function loadCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split('\n').slice(1); // Skip header

  return lines.map(line => {
    const [date, o, h, low, c, v] = line.split(',');
    return { ts: new Date(date).getTime()/1000, o: +o, h: +h, l: +low, c: +c, v: +v||0 };
  }).filter(c => c.c > 0);
}

// Simple score (momentum + volume + trend)
function calcScore(candles, idx) {
  if (idx < 5) return 0;
  const c = candles[idx];
  let s = 0;

  // Close location (0-20 pts)
  const r = c.h - c.l;
  if (r > 0) s += Math.min((c.c - c.l) / r * 20, 20);

  // Volume (0-20 pts)
  let vAvg = 0;
  for (let i = idx-10; i < idx; i++) if (i >= 0) vAvg += candles[i].v;
  if (c.v > vAvg) s += Math.min(20 * (c.v / (vAvg/10) - 1), 20);

  // Trend (0-30 pts)
  let up = 0;
  for (let i = idx-5; i < idx; i++) if (i > 0 && candles[i].c > candles[i-1].c) up++;
  s += up * 6;

  // ATR (0-30 pts)
  let atrSum = 0;
  for (let i = Math.max(1, idx-13); i < idx; i++) {
    const tr = Math.max(candles[i].h - candles[i].l,
                       Math.abs(candles[i].h - candles[i-1].c),
                       Math.abs(candles[i].l - candles[i-1].c));
    atrSum += tr;
  }
  const atr = atrSum / 14;
  const atrPct = (atr / c.c) * 100;
  if (atrPct > 2.5) s += 30; else if (atrPct > 1.5) s += 20;

  return Math.min(s, 100);
}

// Assign stage
function assignStage(score, config) {
  if (score >= config.ultra) return 'ULTRA';
  if (score >= config.strong) return 'STRONG';
  if (score >= config.buy) return 'BUY';
  return 'PRE';
}

// Backtest: entry at next bar, track for 15 bars
function backtest(candles, configs) {
  const results = {};
  for (const cfg of configs) results[cfg.name] = { ULTRA: [], STRONG: [], BUY: [] };

  for (let i = 20; i < candles.length - 15; i++) {
    const score = calcScore(candles, i);
    if (score < 40) continue; // Skip weak signals

    const entry = candles[i + 1].o; // Next bar open
    if (!entry || entry <= 0) continue;

    // ATR-based targets
    let atrSum = 0;
    for (let j = Math.max(1, i-13); j < i; j++) {
      const tr = Math.max(candles[j].h - candles[j].l,
                         Math.abs(candles[j].h - candles[j-1].c),
                         Math.abs(candles[j].l - candles[j-1].c));
      atrSum += tr;
    }
    const atr = atrSum / 14;

    const t1 = entry + (1.5 * atr);  // T1=1.5×ATR
    const t2 = entry + (3 * atr);    // T2=3×ATR
    const t3 = entry + (5 * atr);    // T3=5×ATR
    const sl = entry - (2 * atr);    // SL=2×ATR

    // Simulate 15-bar hold
    let hitT1=0, hitT2=0, hitT3=0, hitSL=0, mfe=0, mae=0;
    let win = 0;

    for (let j = i + 1; j <= Math.min(i + 15, candles.length - 1); j++) {
      const bar = candles[j];
      mfe = Math.max(mfe, bar.h - entry);
      mae = Math.min(mae, bar.l - entry);

      if (!hitSL && bar.l <= sl) { hitSL = 1; win = -1; break; }
      if (!hitT3 && bar.h >= t3) { hitT3 = 1; if (!win) win = 1; }
      if (!hitT2 && bar.h >= t2) { hitT2 = 1; }
      if (!hitT1 && bar.h >= t1) { hitT1 = 1; }
    }

    const pnl = (win > 0 ? mfe : mae) / entry * 100;

    // Store results for each config
    for (const cfg of configs) {
      const stage = assignStage(score, cfg);
      if (stage in results[cfg.name]) {
        results[cfg.name][stage].push({ score, pnl, win: win > 0 ? 1 : 0 });
      }
    }
  }

  return results;
}

// Analyze results
function analyze(results) {
  const summary = {};

  for (const [configName, stages] of Object.entries(results)) {
    summary[configName] = {};

    for (const [stage, trades] of Object.entries(stages)) {
      if (trades.length === 0) continue;

      const wins = trades.filter(t => t.win).length;
      const wr = (wins / trades.length * 100).toFixed(1);
      const avgPnl = (trades.reduce((s, t) => s + t.pnl, 0) / trades.length).toFixed(2);

      summary[configName][stage] = {
        count: trades.length,
        winRate: wr,
        avgPnl,
        wins
      };
    }
  }

  return summary;
}

// Load subset of stocks (top 50 for speed)
const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('_OHLCV.csv'))
  .sort()
  .slice(0, 50);

console.log(`Testing ${files.length} stocks...\n`);

const configs = [
  { name: 'CURRENT', ultra: 80, strong: 63, buy: 45 },
  { name: 'OPT-A', ultra: 80, strong: 62, buy: 43 },
  { name: 'OPT-B', ultra: 78, strong: 60, buy: 40 },
];

let allResults = { CURRENT: {ULTRA:[], STRONG:[], BUY:[]},
                   'OPT-A': {ULTRA:[], STRONG:[], BUY:[]},
                   'OPT-B': {ULTRA:[], STRONG:[], BUY:[]} };

for (const file of files) {
  try {
    const candles = loadCSV(path.join(DATA_DIR, file));
    if (candles.length < 50) continue;

    const results = backtest(candles, configs);

    // Aggregate
    for (const cfg of configs) {
      for (const stage of ['ULTRA', 'STRONG', 'BUY']) {
        if (results[cfg.name][stage]) {
          allResults[cfg.name][stage].push(...results[cfg.name][stage]);
        }
      }
    }
  } catch (e) {}
}

// Print results
console.log('═══════════════════════════════════════════════════════════════\n');
console.log('BACKTEST RESULTS (Real Trade Simulation)\n');

const output = {};

for (const cfg of configs) {
  console.log(`${cfg.name.padEnd(12)} | ULTRA=${cfg.ultra} STRONG=${cfg.strong} BUY=${cfg.buy}`);
  output[cfg.name] = {};

  for (const stage of ['ULTRA', 'STRONG', 'BUY']) {
    const trades = allResults[cfg.name][stage];
    if (trades.length === 0) continue;

    const wins = trades.filter(t => t.win).length;
    const wr = (wins / trades.length * 100).toFixed(1);
    const avgPnl = (trades.reduce((s,t) => s+t.pnl, 0) / trades.length).toFixed(2);

    console.log(`  ${stage.padEnd(7)}: ${trades.length} trades | WR=${wr}% | Avg PnL=${avgPnl}%`);

    output[cfg.name][stage] = { trades: trades.length, winRate: wr, avgPnl };
  }
  console.log();
}

// Comparison
console.log('═══════════════════════════════════════════════════════════════\n');
console.log('WIN RATE IMPROVEMENT vs CURRENT\n');

const current = output['CURRENT'];
const optA = output['OPT-A'];
const optB = output['OPT-B'];

for (const stage of ['ULTRA', 'STRONG', 'BUY']) {
  if (!current[stage]) continue;

  const currWr = parseFloat(current[stage].winRate);
  const optAWr = parseFloat(optA[stage].winRate);
  const optBWr = parseFloat(optB[stage].winRate);

  const impA = (optAWr - currWr).toFixed(1);
  const impB = (optBWr - currWr).toFixed(1);

  console.log(`${stage}:`);
  console.log(`  CURRENT: ${currWr}%`);
  console.log(`  OPT-A:   ${optAWr}% (${impA > 0 ? '+' : ''}${impA}%) ${impA > 0.5 ? '✅' : ''}`);
  console.log(`  OPT-B:   ${optBWr}% (${impB > 0 ? '+' : ''}${impB}%) ${impB > 0.5 ? '✅' : ''}`);
  console.log();
}

console.log('═══════════════════════════════════════════════════════════════\n');

// Save
const report = {
  timestamp: new Date().toISOString(),
  stocks_tested: files.length,
  output,
  recommendation: 'OPT-A if +0.5-1% WR gain, else keep CURRENT'
};

fs.writeFileSync(
  path.join(__dirname, 'results', `genuine_stage_backtest_${new Date().toISOString().split('T')[0]}.json`),
  JSON.stringify(report, null, 2)
);

console.log('✅ Report saved\n');
