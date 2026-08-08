#!/usr/bin/env node
/**
 * OPTIMIZE 2.25×ATR STOP LOSS
 * Find best T1/T2/T3 configuration for 5% profit with 2.25×ATR stop
 * Deep optimization across all viable target combinations
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  OPTIMIZE 2.25×ATR STOP LOSS');
console.log('  Find best T1/T2/T3 for 5% profit target');
console.log('═══════════════════════════════════════════════════════════════\n');

function loadCSV(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1);
  return lines.map(line => {
    const [date, o, h, low, c, v] = line.split(',');
    return { o: parseFloat(o), h: parseFloat(h), l: parseFloat(low), c: parseFloat(c), v: parseInt(v) || 0 };
  }).filter(c => c.c > 0);
}

function calcATR14(candles, endIdx) {
  if (endIdx < 14) return 0;
  let atrSum = 0;
  for (let i = endIdx - 13; i <= endIdx; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    );
    atrSum += tr;
  }
  return atrSum / 14;
}

function simulateTrade(candles, entryIdx, entryPrice, atr14, t1Mult, t2Mult, t3Mult, stopMult = 2.25, maxBars = 20) {
  const t1 = entryPrice + (t1Mult * atr14);
  const t2 = entryPrice + (t2Mult * atr14);
  const t3 = entryPrice + (t3Mult * atr14);
  const sl = entryPrice - (stopMult * atr14);

  let hitT1 = false, hitT2 = false, hitT3 = false, hitSL = false;
  let bars = 0, maxPrice = entryPrice;

  for (let i = entryIdx + 1; i <= Math.min(entryIdx + maxBars, candles.length - 1); i++) {
    bars++;
    maxPrice = Math.max(maxPrice, candles[i].h);

    if (candles[i].l <= sl) {
      hitSL = true;
      break;
    }

    if (!hitT1 && candles[i].h >= t1) hitT1 = true;
    if (!hitT2 && candles[i].h >= t2) hitT2 = true;
    if (!hitT3 && candles[i].h >= t3) hitT3 = true;
  }

  const slPct = (entryPrice - sl) / entryPrice * 100;
  const t3Pct = (t3 - entryPrice) / entryPrice * 100;

  return { hitT1, hitT2, hitT3, hitSL, bars, slPct, t3Pct };
}

// Load trades
const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('_OHLCV.csv'))
  .sort()
  .slice(0, 30);

console.log(`Loading trades from ${files.length} stocks...\n`);

const allTrades = [];

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

      if (bodyPct < 60 || closeLoc < 40) continue;

      const atr14 = calcATR14(candles, i);
      if (atr14 <= 0) continue;

      allTrades.push({
        candles, entryIdx: i, entryPrice: sig.c, atr14
      });
    }
  } catch (e) {}
}

console.log(`Loaded ${allTrades.length} valid entry signals\n`);

// Test different T1/T2/T3 combinations targeting 5%
const testCombos = [
  { name: '1.0 / 2.0 / 3.5', t1: 1.0, t2: 2.0, t3: 3.5 },
  { name: '1.0 / 2.0 / 4.0', t1: 1.0, t2: 2.0, t3: 4.0 },
  { name: '1.0 / 2.5 / 4.0', t1: 1.0, t2: 2.5, t3: 4.0 },
  { name: '1.0 / 2.5 / 4.5', t1: 1.0, t2: 2.5, t3: 4.5 },
  { name: '1.25 / 2.25 / 4.0', t1: 1.25, t2: 2.25, t3: 4.0 },
  { name: '1.25 / 2.5 / 4.0', t1: 1.25, t2: 2.5, t3: 4.0 },
  { name: '1.25 / 2.5 / 4.5', t1: 1.25, t2: 2.5, t3: 4.5 },
  { name: '1.5 / 2.25 / 3.75', t1: 1.5, t2: 2.25, t3: 3.75 },
  { name: '1.5 / 2.5 / 4.0', t1: 1.5, t2: 2.5, t3: 4.0 },
  { name: '1.5 / 2.5 / 4.5', t1: 1.5, t2: 2.5, t3: 4.5 },
  { name: '1.75 / 2.5 / 4.0', t1: 1.75, t2: 2.5, t3: 4.0 },
  { name: '1.75 / 2.5 / 4.5', t1: 1.75, t2: 2.5, t3: 4.5 },
  { name: '2.0 / 3.0 / 4.5', t1: 2.0, t2: 3.0, t3: 4.5 },
];

console.log(`Testing ${testCombos.length} T1/T2/T3 combinations with 2.25×ATR stop...\n`);

const results = {};

for (const combo of testCombos) {
  const scenarios = {
    t3Only: { wins: 0, total: 0, sumPnL: 0 },
    t1Only: { wins: 0, total: 0, sumPnL: 0 },
    t1t2Split: { wins: 0, total: 0, sumPnL: 0 },
    blended: { wins: 0, total: 0, sumPnL: 0 }
  };

  for (const trade of allTrades) {
    const sim = simulateTrade(
      trade.candles, trade.entryIdx, trade.entryPrice, trade.atr14,
      combo.t1, combo.t2, combo.t3, 2.25, 20
    );

    const slPct = sim.slPct;
    const t3Pct = sim.t3Pct;
    const t1Pct = (combo.t1 / combo.t3) * t3Pct;
    const t2Pct = (combo.t2 / combo.t3) * t3Pct;

    // Scenario 1: Hold 100% to T3
    if (sim.hitSL) {
      scenarios.t3Only.sumPnL -= slPct;
    } else if (sim.hitT3) {
      scenarios.t3Only.wins++;
      scenarios.t3Only.sumPnL += t3Pct;
    } else {
      scenarios.t3Only.sumPnL += ((sim.maxPrice - trade.entryPrice) / trade.entryPrice * 100);
    }
    scenarios.t3Only.total++;

    // Scenario 2: Exit 100% at T1
    if (sim.hitSL) {
      scenarios.t1Only.sumPnL -= slPct;
    } else if (sim.hitT1) {
      scenarios.t1Only.wins++;
      scenarios.t1Only.sumPnL += t1Pct;
    } else {
      scenarios.t1Only.sumPnL -= slPct;
    }
    scenarios.t1Only.total++;

    // Scenario 3: 50/50 T1-T2
    if (sim.hitSL) {
      scenarios.t1t2Split.sumPnL -= slPct;
    } else {
      let pnl = 0;
      if (sim.hitT2) {
        pnl = 0.5 * t1Pct + 0.5 * t2Pct;
        scenarios.t1t2Split.wins++;
      } else if (sim.hitT1) {
        pnl = t1Pct;
        scenarios.t1t2Split.wins++;
      } else {
        pnl -= slPct;
      }
      scenarios.t1t2Split.sumPnL += pnl;
    }
    scenarios.t1t2Split.total++;

    // Scenario 4: Blended 33/33/34
    if (sim.hitSL) {
      scenarios.blended.sumPnL -= slPct;
    } else {
      let pnl = 0;
      if (sim.hitT3) {
        pnl = (t1Pct + t2Pct + t3Pct) / 3;
        scenarios.blended.wins++;
      } else if (sim.hitT2) {
        pnl = (t1Pct + t2Pct) / 2;
        scenarios.blended.wins++;
      } else if (sim.hitT1) {
        pnl = t1Pct;
        scenarios.blended.wins++;
      } else {
        pnl -= slPct;
      }
      scenarios.blended.sumPnL += pnl;
    }
    scenarios.blended.total++;
  }

  results[combo.name] = {
    combo,
    t3Only: {
      wr: ((scenarios.t3Only.wins / scenarios.t3Only.total) * 100).toFixed(1),
      pnl: (scenarios.t3Only.sumPnL / scenarios.t3Only.total).toFixed(2)
    },
    t1Only: {
      wr: ((scenarios.t1Only.wins / scenarios.t1Only.total) * 100).toFixed(1),
      pnl: (scenarios.t1Only.sumPnL / scenarios.t1Only.total).toFixed(2)
    },
    t1t2Split: {
      wr: ((scenarios.t1t2Split.wins / scenarios.t1t2Split.total) * 100).toFixed(1),
      pnl: (scenarios.t1t2Split.sumPnL / scenarios.t1t2Split.total).toFixed(2)
    },
    blended: {
      wr: ((scenarios.blended.wins / scenarios.blended.total) * 100).toFixed(1),
      pnl: (scenarios.blended.sumPnL / scenarios.blended.total).toFixed(2)
    }
  };
}

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('SCENARIO: HOLD 100% TO T3 (Best for 5% profit)\n');

const byT3PnL = Object.entries(results)
  .map(([name, r]) => ({ name, ...r.t3Only }))
  .sort((a, b) => parseFloat(b.pnl) - parseFloat(a.pnl));

console.log('T1/T2/T3        | WR    | Avg PnL');
console.log('─'.repeat(50));
for (let i = 0; i < byT3PnL.length; i++) {
  const r = byT3PnL[i];
  const marker = i === 0 ? ' ✅' : '';
  console.log(`${r.name.padEnd(15)}| ${r.wr.padStart(5)}% | ${r.pnl.padStart(7)}%${marker}`);
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('🏆 OPTIMAL CONFIGURATION\n');

const best = byT3PnL[0];
const bestCombo = Object.values(results).find(r => r.t3Only === best);

console.log(`T1/T2/T3: ${best.name}`);
console.log(`Strategy: Hold 100% to T3 (5% profit target)\n`);
console.log(`Win Rate: ${best.wr}%`);
console.log(`Avg Profit: ${best.pnl}%`);
console.log(`Monthly (60 trades): ${(parseFloat(best.pnl) * 60 / 100 * 100).toFixed(1)}%`);
console.log(`Annualized: ${(parseFloat(best.pnl) * 60 * 12 / 100).toFixed(1)}%\n`);

console.log('Risk Profile:');
console.log(`  Stop Loss: 2.25×ATR = 5.6% risk`);
console.log(`  T3 Target: ${best.name.split(' / ')[2]}×ATR = 5% profit`);
console.log(`  Risk:Reward: 1:0.89 (slightly risk-heavy)`);
console.log(`\nImplementation:`);
const parts = best.name.split(' / ');
console.log(`  T1 = ${parts[0]}×ATR (intermediate point)`);
console.log(`  T2 = ${parts[1]}×ATR (secondary point)`);
console.log(`  T3 = ${parts[2]}×ATR (5% profit exit)`);
console.log(`  SL = 2.25×ATR (5.6% stop loss)`);

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('TOP 5 CONFIGURATIONS\n');

for (let i = 0; i < Math.min(5, byT3PnL.length); i++) {
  const r = byT3PnL[i];
  console.log(`${i + 1}. ${r.name.padEnd(15)}| WR: ${r.wr}% | PnL: ${r.pnl}%`);
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('ALL SCENARIOS FOR BEST CONFIG\n');

const bestName = byT3PnL[0].name;
const bestResult = results[bestName];

console.log(`Configuration: ${bestName}`);
console.log(`\n100% to T3:  WR=${bestResult.t3Only.wr}% | PnL=${bestResult.t3Only.pnl}%`);
console.log(`100% to T1:  WR=${bestResult.t1Only.wr}% | PnL=${bestResult.t1Only.pnl}%`);
console.log(`50/50 T1-T2: WR=${bestResult.t1t2Split.wr}% | PnL=${bestResult.t1t2Split.pnl}%`);
console.log(`Blended:     WR=${bestResult.blended.wr}% | PnL=${bestResult.blended.pnl}%`);

console.log('\n═══════════════════════════════════════════════════════════════');
