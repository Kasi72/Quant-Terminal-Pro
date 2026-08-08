#!/usr/bin/env node
/**
 * EXIT OPTIMIZATION (CORRECTED)
 * Directly tests actual target hits with position sizing
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  EXIT STRATEGY OPTIMIZATION (CORRECTED)');
console.log('  Testing real target hits with position allocation');
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

function simulateTrade(candles, idx, entry) {
  const atr = calcATR(candles, idx);
  const sl = entry - (3 * atr);
  const t1 = entry + (1 * atr);
  const t2 = entry + (1.75 * atr);
  const t3 = entry + (3 * atr);

  let hitT1 = false, hitT2 = false, hitT3 = false, hitSL = false;
  let bars = 0;

  for (let j = idx + 1; j <= Math.min(idx + 20, candles.length - 1); j++) {
    bars++;

    if (!hitSL && candles[j].l <= sl) {
      hitSL = true;
      break;
    }

    if (!hitT1 && candles[j].h >= t1) hitT1 = true;
    if (!hitT2 && candles[j].h >= t2) hitT2 = true;
    if (!hitT3 && candles[j].h >= t3) hitT3 = true;
  }

  const t1Pct = ((t1 - entry) / entry * 100);
  const t2Pct = ((t2 - entry) / entry * 100);
  const t3Pct = ((t3 - entry) / entry * 100);
  const slPct = (entry - sl) / entry * 100;

  return {
    hitT1, hitT2, hitT3, hitSL,
    t1Pct, t2Pct, t3Pct, slPct,
    bars
  };
}

// Load trades
const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('_OHLCV.csv'))
  .sort()
  .slice(0, 30);

console.log(`Loading trades...\n`);

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

      const entry = sig.c;
      const trade = simulateTrade(candles, i, entry);
      allTrades.push(trade);
    }
  } catch (e) {}
}

console.log(`Loaded ${allTrades.length} trades\n`);

// Test specific exit combinations
const exitStrategies = [
  { name: 'Scenario 1: 100% T1', t1: 100, t2: 0, t3: 0 },
  { name: 'Scenario 2: 50/50 T1-T2', t1: 50, t2: 50, t3: 0 },
  { name: 'Scenario 3: 100% T3', t1: 0, t2: 0, t3: 100 },
  { name: 'Scenario 4: 50/50 T1-T3', t1: 50, t2: 0, t3: 50 },
  { name: 'Optimal 1: 33/33/34', t1: 33, t2: 33, t3: 34 },
  { name: 'Optimal 2: 25/25/50', t1: 25, t2: 25, t3: 50 },
  { name: 'Optimal 3: 20/30/50', t1: 20, t2: 30, t3: 50 },
  { name: 'Optimal 4: 30/20/50', t1: 30, t2: 20, t3: 50 },
  { name: 'Optimal 5: 0/50/50', t1: 0, t2: 50, t3: 50 },
  { name: 'Optimal 6: 10/40/50', t1: 10, t2: 40, t3: 50 },
];

console.log('═══════════════════════════════════════════════════════════════\n');

const resultsData = [];

for (const strategy of exitStrategies) {
  // Calculate PnL for each trade using this exit strategy
  const tradePnLs = allTrades.map(trade => {
    if (trade.hitSL) {
      return -trade.slPct; // Loss
    }

    let pnl = 0;

    // Determine which targets were hit and allocate accordingly
    if (trade.hitT3) {
      // All three targets hit - allocate as planned
      pnl = (strategy.t1 / 100) * trade.t1Pct +
            (strategy.t2 / 100) * trade.t2Pct +
            (strategy.t3 / 100) * trade.t3Pct;
    } else if (trade.hitT2) {
      // T1 and T2 hit, T3 missed
      pnl = (strategy.t1 / 100) * trade.t1Pct +
            (strategy.t2 / 100) * trade.t2Pct +
            (strategy.t3 / 100) * trade.t2Pct; // T3 position stays at T2
    } else if (trade.hitT1) {
      // Only T1 hit
      pnl = (strategy.t1 / 100) * trade.t1Pct +
            (strategy.t2 / 100) * trade.t1Pct +
            (strategy.t3 / 100) * trade.t1Pct; // All exit at T1
    } else {
      // No targets hit - loss at stop
      return -trade.slPct;
    }

    return pnl;
  });

  const wins = tradePnLs.filter(p => p > 0).length;
  const losses = tradePnLs.filter(p => p <= 0).length;
  const winRate = (wins / tradePnLs.length) * 100;

  // Calculate statistical metrics
  const mean = tradePnLs.reduce((a, b) => a + b, 0) / tradePnLs.length;
  const variance = tradePnLs.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / tradePnLs.length;
  const stdDev = Math.sqrt(variance);

  // Sharpe Ratio
  const sharpe = stdDev > 0 ? mean / stdDev : 0;

  // Sortino (downside only)
  const downside = tradePnLs.filter(p => p < 0);
  const downDownside = Math.sqrt(downside.length > 0 ?
    downside.reduce((sum, p) => sum + Math.pow(p, 2), 0) / tradePnLs.length : 0);
  const sortino = downDownside > 0 ? mean / downDownside : (mean > 0 ? 999 : 0);

  // Profit Factor
  const sumWins = tradePnLs.filter(p => p > 0).reduce((a, b) => a + b, 0);
  const sumLosses = Math.abs(tradePnLs.filter(p => p <= 0).reduce((a, b) => a + b, 0));
  const profitFactor = sumLosses > 0 ? sumWins / sumLosses : 999;

  // Max Drawdown
  let cumulativePnL = 0;
  let runningMax = 0;
  let maxDrawdown = 0;
  for (const pnl of tradePnLs) {
    cumulativePnL += pnl;
    runningMax = Math.max(runningMax, cumulativePnL);
    maxDrawdown = Math.max(maxDrawdown, runningMax - cumulativePnL);
  }

  // Skewness
  const cubed = tradePnLs.map(p => Math.pow(p - mean, 3)).reduce((a, b) => a + b, 0);
  const skewness = stdDev > 0 ? (cubed / tradePnLs.length) / Math.pow(stdDev, 3) : 0;

  // Kelly Criterion
  const avgWin = wins > 0 ? sumWins / wins : 0;
  const avgLoss = losses > 0 ? sumLosses / losses : 0;
  let kelly = 0;
  if (avgWin > 0 && avgLoss > 0) {
    kelly = ((winRate / 100 * avgWin) - ((100 - winRate) / 100 * avgLoss)) / avgWin;
    kelly = Math.max(0, Math.min(kelly, 0.25));
  }

  resultsData.push({
    strategy: strategy.name,
    t1: strategy.t1,
    t2: strategy.t2,
    t3: strategy.t3,
    winRate: parseFloat(winRate.toFixed(1)),
    avgPnL: parseFloat(mean.toFixed(2)),
    sharpe: parseFloat(sharpe.toFixed(3)),
    sortino: parseFloat(sortino.toFixed(3)),
    profitFactor: parseFloat(profitFactor.toFixed(3)),
    maxDD: parseFloat(maxDrawdown.toFixed(2)),
    skewness: parseFloat(skewness.toFixed(3)),
    kelly: parseFloat(kelly.toFixed(3)),
    wins,
    losses,
    sumWins: parseFloat(sumWins.toFixed(2)),
    sumLosses: parseFloat(sumLosses.toFixed(2))
  });
}

// Sort by Sharpe Ratio
const bySharpe = [...resultsData].sort((a, b) => b.sharpe - a.sharpe);

console.log('ALL STRATEGIES (Ranked by Sharpe Ratio)\n');
for (let i = 0; i < resultsData.length; i++) {
  const r = resultsData[i];
  console.log(`${i + 1}. ${r.strategy}`);
  console.log(`   Allocation: T1=${r.t1}% | T2=${r.t2}% | T3=${r.t3}%`);
  console.log(`   WR=${r.winRate}% | PnL=${r.avgPnL}% | Sharpe=${r.sharpe} | Sortino=${r.sortino}`);
  console.log(`   ProfitFactor=${r.profitFactor}x | MaxDD=${r.maxDD}% | Kelly=${(r.kelly*100).toFixed(1)}%\n`);
}

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('🏆 OPTIMAL STRATEGY (By Sharpe Ratio)\n');
const optimal = bySharpe[0];
console.log(`${optimal.strategy}`);
console.log(`Allocation: T1=${optimal.t1}% | T2=${optimal.t2}% | T3=${optimal.t3}%\n`);
console.log(`Key Metrics:`);
console.log(`  Win Rate:         ${optimal.winRate}%`);
console.log(`  Avg PnL/Trade:    ${optimal.avgPnL}% (expected edge)`);
console.log(`  Sharpe Ratio:     ${optimal.sharpe} (risk-adjusted return) ⭐`);
console.log(`  Sortino Ratio:    ${optimal.sortino} (downside protection)`);
console.log(`  Profit Factor:    ${optimal.profitFactor}x (wins/losses)`);
console.log(`  Max Drawdown:     ${optimal.maxDD}%`);
console.log(`  Skewness:         ${optimal.skewness} (tail risk: ${optimal.skewness < -0.5 ? 'HIGH' : 'normal'})`);
console.log(`  Kelly Fraction:   ${(optimal.kelly*100).toFixed(1)}% (position size)`);
console.log(`\nImplementation:`);
console.log(`  - For every 100 shares: take ${optimal.t1} at T1, ${optimal.t2} at T2, ${optimal.t3} at T3`);
console.log(`  - Use ${(optimal.kelly*100).toFixed(1)}% of account per trade (Kelly Criterion)`);
console.log(`  - Expected edge: ${optimal.avgPnL}% per trade`);

console.log('\n═══════════════════════════════════════════════════════════════');
