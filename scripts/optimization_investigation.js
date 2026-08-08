#!/usr/bin/env node
/**
 * COMPREHENSIVE OPTIMIZATION INVESTIGATION
 * Tests: Close Location, Body Strength, Entry Timing, Target Distances
 * Find the winning combination
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  OPTIMIZATION INVESTIGATION');
console.log('  Close Location | Body Strength | Entry Timing | Target Distances');
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

function simulateTrade(candles, idx, entry, config) {
  const atr = calcATR(candles, idx);
  const sl = entry - (3 * atr);

  // Target multipliers from config
  const t1 = entry + (config.t1 * atr);
  const t2 = entry + (config.t2 * atr);

  let win = 0, bars = 0;
  for (let j = idx + 1; j <= Math.min(idx + 20, candles.length - 1); j++) {
    bars++;
    if (candles[j].l <= sl) { win = -1; break; }
    if (candles[j].h >= t2) { win = 2; break; }
    if (candles[j].h >= t1) { win = 1; break; }
  }

  const mfe = Math.max(...candles.slice(idx+1, Math.min(idx+21, candles.length)).map(c => c.h)) - entry;
  const pnl = mfe / entry * 100;
  return { win: win > 0 ? 1 : 0, pnl, bars };
}

// Test configurations
const closeLocations = [40, 44, 50, 55, 60];
const bodyStrengths = [40, 43, 50, 60];
const entryModes = ['nextBar', 'sameDay'];
const targetSets = [
  { name: 'Current', t1: 0.75, t2: 1.5 },
  { name: 'Conservative', t1: 0.5, t2: 1.0 },
  { name: 'Aggressive', t1: 1.0, t2: 2.0 },
  { name: 'Optimized', t1: 0.8, t2: 1.75 },
];

const results = {};

// Load 30 stocks
const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('_OHLCV.csv'))
  .sort()
  .slice(0, 30);

console.log(`Testing ${files.length} stocks...\n`);

let totalProcessed = 0;

for (const file of files) {
  try {
    const candles = loadCSV(path.join(DATA_DIR, file));
    if (candles.length < 50) continue;

    for (let i = 20; i < candles.length - 20; i++) {
      const sig = candles[i];
      const range = sig.h - sig.l;
      const body = Math.abs(sig.c - sig.o);
      const closeLoc = range > 0 ? (sig.c - sig.l) / range * 100 : 50;
      const bodyPct = range > 0 ? body / range * 100 : 0;

      // Test each combination
      for (const cl of closeLocations) {
        if (closeLoc < cl) continue; // Filter: close location

        for (const bs of bodyStrengths) {
          if (bodyPct < bs) continue; // Filter: body strength

          for (const em of entryModes) {
            const entryIdx = em === 'nextBar' ? i + 1 : i;
            const entry = em === 'nextBar' ? candles[i + 1].o : sig.c;
            if (!entry || entryIdx >= candles.length - 20) continue;

            for (const tset of targetSets) {
              const key = `CL${cl}_BS${bs}_${em}_${tset.name}`;

              if (!results[key]) {
                results[key] = { wins: 0, total: 0, totalPnl: 0, config: { cl, bs, em, targets: tset } };
              }

              const trade = simulateTrade(candles, entryIdx, entry, tset);
              results[key].wins += trade.win;
              results[key].total++;
              results[key].totalPnl += trade.pnl;
              totalProcessed++;
            }
          }
        }
      }
    }
  } catch (e) {}
}

console.log(`Processed ${totalProcessed} trades\n`);
console.log('═══════════════════════════════════════════════════════════════\n');
console.log('TOP 15 CONFIGURATIONS\n');

// Rank by win rate
const ranked = Object.entries(results)
  .filter(([k, v]) => v.total >= 100) // Min trades
  .map(([k, v]) => ({
    key: k,
    wr: ((v.wins / v.total) * 100).toFixed(1),
    trades: v.total,
    avgPnl: (v.totalPnl / v.total).toFixed(2),
    config: v.config
  }))
  .sort((a, b) => parseFloat(b.wr) - parseFloat(a.wr))
  .slice(0, 15);

for (let i = 0; i < ranked.length; i++) {
  const r = ranked[i];
  console.log(`${(i + 1).toString().padStart(2)}. WR=${r.wr}% | PnL=${r.avgPnl}% | Trades=${r.trades}`);
  console.log(`    Close Location >= ${r.config.cl}% | Body >= ${r.config.bs}% | Entry: ${r.config.em} | Targets: ${r.config.targets.name}`);
  console.log();
}

console.log('═══════════════════════════════════════════════════════════════\n');

// Best overall
if (ranked.length > 0) {
  const best = ranked[0];
  console.log('★ OPTIMAL CONFIGURATION\n');
  console.log(`Win Rate: ${best.wr}%`);
  console.log(`Avg PnL: ${best.avgPnl}%`);
  console.log(`Close Location Filter: >= ${best.config.cl}%`);
  console.log(`Body Strength Gate: >= ${best.config.bs}%`);
  console.log(`Entry Timing: ${best.config.em}`);
  console.log(`Target Multipliers: T1=${best.config.targets.t1}×ATR, T2=${best.config.targets.t2}×ATR`);
}

// Save results
fs.writeFileSync(
  path.join(__dirname, 'results', `optimization_investigation_${new Date().toISOString().split('T')[0]}.json`),
  JSON.stringify({ ranked: ranked.slice(0, 20), timestamp: new Date().toISOString() }, null, 2)
);

console.log('\n═══════════════════════════════════════════════════════════════');
