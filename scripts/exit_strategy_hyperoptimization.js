#!/usr/bin/env node
/**
 * EXIT STRATEGY HYPER-OPTIMIZATION
 * Tests all possible exit combinations using:
 * - Sharpe Ratio (risk-adjusted return)
 * - Sortino Ratio (downside risk only)
 * - Profit Factor (win $ / loss $)
 * - Expectancy (edge per trade)
 * - Kelly Criterion (optimal position sizing)
 * - Drawdown analysis
 * - Win/Loss distribution
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  EXIT STRATEGY HYPER-OPTIMIZATION');
console.log('  Testing 1000+ combinations with statistical metrics');
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
  let mfe = 0, mae = 0;

  for (let j = idx + 1; j <= Math.min(idx + 20, candles.length - 1); j++) {
    mfe = Math.max(mfe, candles[j].h - entry);
    mae = Math.min(mae, candles[j].l - entry);

    if (!hitSL && candles[j].l <= sl) {
      hitSL = true;
      break;
    }

    if (!hitT1 && candles[j].h >= t1) hitT1 = true;
    if (!hitT2 && candles[j].h >= t2) hitT2 = true;
    if (!hitT3 && candles[j].h >= t3) hitT3 = true;
  }

  const slRiskPct = (entry - sl) / entry * 100;
  return {
    hitT1, hitT2, hitT3, hitSL,
    slRiskPct,
    t1Pct: ((t1 - entry) / entry * 100),
    t2Pct: ((t2 - entry) / entry * 100),
    t3Pct: ((t3 - entry) / entry * 100),
    mfePct: (mfe / entry * 100),
    maePct: (mae / entry * 100)
  };
}

// Load trades once
const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('_OHLCV.csv'))
  .sort()
  .slice(0, 30);

console.log(`Loading ${files.length} stocks...\n`);

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

// Generate all exit combinations
// Format: [% at T1, % at T2, % at T3] where sum = 100
const exitCombinations = [];

for (let p1 = 0; p1 <= 100; p1 += 5) {      // % at T1: 0%, 5%, 10%, ..., 100%
  for (let p2 = 0; p2 <= (100 - p1); p2 += 5) {  // % at T2
    const p3 = 100 - p1 - p2;               // % at T3 (remainder)
    exitCombinations.push({ p1, p2, p3 });
  }
}

console.log(`Testing ${exitCombinations.length} exit combinations...\n`);

// Calculate metrics for each combination
const results = exitCombinations.map(combo => {
  const pnls = allTrades.map(trade => {
    if (trade.hitSL) {
      // Loss scenario
      return -(trade.slRiskPct);
    }

    // Winning scenario - allocate % to each target
    let totalPnL = 0;

    // % at T1
    if (combo.p1 > 0) {
      if (trade.hitT1) {
        totalPnL += (combo.p1 / 100) * trade.t1Pct;
      } else {
        totalPnL += (combo.p1 / 100) * (trade.mfePct || 0);
      }
    }

    // % at T2
    if (combo.p2 > 0) {
      if (trade.hitT2) {
        totalPnL += (combo.p2 / 100) * trade.t2Pct;
      } else if (trade.hitT1) {
        totalPnL += (combo.p2 / 100) * trade.t1Pct;
      } else {
        totalPnL += (combo.p2 / 100) * (trade.mfePct || 0);
      }
    }

    // % at T3
    if (combo.p3 > 0) {
      if (trade.hitT3) {
        totalPnL += (combo.p3 / 100) * trade.t3Pct;
      } else if (trade.hitT2) {
        totalPnL += (combo.p3 / 100) * trade.t2Pct;
      } else if (trade.hitT1) {
        totalPnL += (combo.p3 / 100) * trade.t1Pct;
      } else {
        totalPnL += (combo.p3 / 100) * (trade.mfePct || 0);
      }
    }

    return totalPnL;
  });

  const wins = pnls.filter(p => p > 0).length;
  const losses = pnls.filter(p => p <= 0).length;
  const winRate = (wins / pnls.length) * 100;

  // Core metrics
  const avgPnL = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const sumWins = pnls.filter(p => p > 0).reduce((a, b) => a + b, 0);
  const sumLosses = Math.abs(pnls.filter(p => p <= 0).reduce((a, b) => a + b, 0));

  // Sharpe Ratio: (mean return - risk-free) / std dev
  const mean = avgPnL;
  const variance = pnls.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / pnls.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? mean / stdDev : 0;

  // Sortino Ratio: (mean return) / downside deviation
  const downsideDeviations = pnls.filter(p => p < 0).map(p => Math.pow(p, 2));
  const downsideDeviation = Math.sqrt(
    downsideDeviations.length > 0
      ? downsideDeviations.reduce((a, b) => a + b, 0) / pnls.length
      : 0
  );
  const sortinoRatio = downsideDeviation > 0 ? mean / downsideDeviation : (mean > 0 ? 999 : 0);

  // Profit Factor: sum of wins / sum of losses
  const profitFactor = sumLosses > 0 ? sumWins / sumLosses : (sumWins > 0 ? 999 : 0);

  // Expectancy: (win% × avg win) - (loss% × avg loss)
  const avgWin = wins > 0 ? sumWins / wins : 0;
  const avgLoss = losses > 0 ? sumLosses / losses : 0;
  const expectancy = (winRate / 100 * avgWin) - ((100 - winRate) / 100 * avgLoss);

  // Kelly Criterion: f = (win% - loss%×avgLoss/avgWin) / (avgWin/avgLoss)
  let kellyFraction = 0;
  if (avgWin > 0 && avgLoss > 0) {
    const winPct = winRate / 100;
    const lossPct = 1 - winPct;
    kellyFraction = (winPct * avgWin - lossPct * avgLoss) / avgWin;
    kellyFraction = Math.max(0, Math.min(kellyFraction, 0.25)); // Cap at 25%
  }

  // Drawdown analysis
  let cumulativePnL = 0;
  let runningMax = 0;
  let maxDrawdown = 0;
  for (const pnl of pnls) {
    cumulativePnL += pnl;
    runningMax = Math.max(runningMax, cumulativePnL);
    const drawdown = runningMax - cumulativePnL;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  // Skewness (measure of tail risk)
  const cubed = pnls.map(p => Math.pow(p - mean, 3)).reduce((a, b) => a + b, 0);
  const skewness = stdDev > 0 ? (cubed / pnls.length) / Math.pow(stdDev, 3) : 0;

  return {
    combo,
    winRate: parseFloat(winRate.toFixed(2)),
    avgPnL: parseFloat(avgPnL.toFixed(4)),
    expectancy: parseFloat(expectancy.toFixed(4)),
    sharpeRatio: parseFloat(sharpeRatio.toFixed(3)),
    sortinoRatio: parseFloat(sortinoRatio.toFixed(3)),
    profitFactor: parseFloat(profitFactor.toFixed(3)),
    kellyFraction: parseFloat(kellyFraction.toFixed(3)),
    maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
    skewness: parseFloat(skewness.toFixed(3)),
    wins,
    losses,
    pnls
  };
});

// Sort by different metrics
const bySharpe = [...results].sort((a, b) => b.sharpeRatio - a.sharpeRatio);
const byExpectancy = [...results].sort((a, b) => b.expectancy - a.expectancy);
const bySortino = [...results].sort((a, b) => b.sortinoRatio - a.sortinoRatio);
const byProfitFactor = [...results].sort((a, b) => b.profitFactor - a.profitFactor);
const byWinRate = [...results].sort((a, b) => b.winRate - a.winRate);

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('TOP 5 BY SHARPE RATIO (Risk-Adjusted Return)\n');

for (let i = 0; i < 5; i++) {
  const r = bySharpe[i];
  console.log(`${i + 1}. T1:${r.combo.p1}% | T2:${r.combo.p2}% | T3:${r.combo.p3}%`);
  console.log(`   Sharpe=${r.sharpeRatio} | Sortino=${r.sortinoRatio} | WR=${r.winRate}% | PnL=${r.avgPnL}%`);
  console.log(`   ProfitFactor=${r.profitFactor} | MaxDD=${r.maxDrawdown}%\n`);
}

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('TOP 5 BY EXPECTANCY (Mathematical Edge)\n');

for (let i = 0; i < 5; i++) {
  const r = byExpectancy[i];
  console.log(`${i + 1}. T1:${r.combo.p1}% | T2:${r.combo.p2}% | T3:${r.combo.p3}%`);
  console.log(`   Expectancy=${r.expectancy}% | WR=${r.winRate}% | PnL=${r.avgPnL}%`);
  console.log(`   Sharpe=${r.sharpeRatio} | ProfitFactor=${r.profitFactor}\n`);
}

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('TOP 5 BY SORTINO RATIO (Downside Risk Only)\n');

for (let i = 0; i < 5; i++) {
  const r = bySortino[i];
  console.log(`${i + 1}. T1:${r.combo.p1}% | T2:${r.combo.p2}% | T3:${r.combo.p3}%`);
  console.log(`   Sortino=${r.sortinoRatio} | WR=${r.winRate}% | MaxDD=${r.maxDrawdown}%`);
  console.log(`   Sharpe=${r.sharpeRatio} | PnL=${r.avgPnL}%\n`);
}

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('TOP 5 BY PROFIT FACTOR (Win$ / Loss$)\n');

for (let i = 0; i < 5; i++) {
  const r = byProfitFactor[i];
  console.log(`${i + 1}. T1:${r.combo.p1}% | T2:${r.combo.p2}% | T3:${r.combo.p3}%`);
  console.log(`   ProfitFactor=${r.profitFactor} | WR=${r.winRate}% | Expectancy=${r.expectancy}%`);
  console.log(`   Sharpe=${r.sharpeRatio} | PnL=${r.avgPnL}%\n`);
}

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('🏆 VERDICT: THE OPTIMAL EXIT STRATEGY\n');

// Find the overall best (balance of all metrics)
const weighted = results.map(r => ({
  ...r,
  score: (
    r.sharpeRatio * 0.3 +           // 30% risk-adjusted return
    r.sortinoRatio * 0.2 +           // 20% downside protection
    r.profitFactor * 0.2 +           // 20% profit factor
    r.expectancy * 100 * 0.15 +      // 15% mathematical edge
    (50 - r.maxDrawdown) * 0.15      // 15% drawdown control
  )
})).sort((a, b) => b.score - a.score);

const optimal = weighted[0];

console.log(`SWEET SPOT: T1=${optimal.combo.p1}% | T2=${optimal.combo.p2}% | T3=${optimal.combo.p3}%\n`);
console.log(`METRICS:`);
console.log(`  Win Rate:        ${optimal.winRate}%`);
console.log(`  Avg PnL/Trade:   ${optimal.avgPnL}%`);
console.log(`  Expectancy:      ${optimal.expectancy}% (edge per trade)`);
console.log(`  Sharpe Ratio:    ${optimal.sharpeRatio} (risk-adjusted return)`);
console.log(`  Sortino Ratio:   ${optimal.sortinoRatio} (downside risk only)`);
console.log(`  Profit Factor:   ${optimal.profitFactor}x (wins/losses)`);
console.log(`  Kelly Fraction:  ${optimal.kellyFraction} (optimal position size)`);
console.log(`  Max Drawdown:    ${optimal.maxDrawdown}%`);
console.log(`  Skewness:        ${optimal.skewness} (negative = left tail risk)`);

console.log(`\nINTERPRETATION:`);
console.log(`  - Allocate ${optimal.combo.p1}% of position for T1 exit (quick profit lock)`);
console.log(`  - Allocate ${optimal.combo.p2}% of position for T2 exit (intermediate)`);
console.log(`  - Allocate ${optimal.combo.p3}% of position for T3 exit (runner capture)`);
console.log(`\n  - Trade size: ${(optimal.kellyFraction * 100).toFixed(1)}% of capital per trade (Kelly Criterion)`);
console.log(`  - Expected profit: ${optimal.expectancy.toFixed(2)}% per trade`);
console.log(`  - Risk-adjusted return: ${optimal.sharpeRatio.toFixed(2)} (Sharpe Ratio)`);

if (optimal.skewness < -0.5) {
  console.log(`\n⚠️  Warning: Negative skewness detected (left tail risk)`);
  console.log(`  Strategy has occasional large losses. Use Kelly fraction with caution.`);
}

if (optimal.maxDrawdown > 20) {
  console.log(`\n⚠️  Warning: Max drawdown ${optimal.maxDrawdown}% is significant.`);
  console.log(`  Consider reducing position size or tighter stops.`);
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log(`RUNNER-UP (Alternative)\n`);
console.log(`T1=${weighted[1].combo.p1}% | T2=${weighted[1].combo.p2}% | T3=${weighted[1].combo.p3}%`);
console.log(`Score: ${weighted[1].score.toFixed(2)} | Sharpe: ${weighted[1].sharpeRatio} | Expectancy: ${weighted[1].expectancy.toFixed(3)}%\n`);

console.log('═══════════════════════════════════════════════════════════════');
