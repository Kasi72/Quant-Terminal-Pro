#!/usr/bin/env node
/**
 * Stage Optimization Backtest — Real OHLCV Data
 * Loads actual candle data and tests stage threshold optimization
 */

const fs = require('fs');
const path = require('path');

console.log('═══════════════════════════════════════════════════════════════');
console.log('  STAGE OPTIMIZATION BACKTEST — Real OHLCV Data');
console.log('  Testing different score thresholds to maximize win rate');
console.log('═══════════════════════════════════════════════════════════════\n');

// Stage assignment function
function archetypeStage(conditionsMet, score, thresholds) {
  const capRank = conditionsMet >= 6 ? 3 : conditionsMet === 5 ? 2 : conditionsMet === 4 ? 1 : 0;
  const scoreRank = score >= thresholds.ultra ? 3 : score >= thresholds.strong ? 2 : score >= thresholds.buy ? 1 : 0;
  const rank = Math.min(capRank, scoreRank);

  return rank === 3 ? 'ULTRA_STRONG_BUY'
    : rank === 2 ? 'STRONG_BUY'
    : rank === 1 ? 'BUY'
    : 'PRE_BREAKOUT';
}

// Test configurations
const TEST_CONFIGS = [
  { name: 'CURRENT', ultra: 80, strong: 63, buy: 45 },
  { name: 'OPTIMIZED-A', ultra: 78, strong: 60, buy: 42 },
  { name: 'OPTIMIZED-B', ultra: 75, strong: 58, buy: 40 },
  { name: 'OPTIMIZED-C', ultra: 82, strong: 65, buy: 48 },
  { name: 'OPTIMIZED-D', ultra: 76, strong: 59, buy: 41 },
  { name: 'HIGH-PRECISION', ultra: 88, strong: 72, buy: 52 },
];

// Read and parse tracked trades
function loadTrackedTrades() {
  try {
    const tradesFile = path.join(__dirname, '..', 'tracked-trades.json');
    if (fs.existsSync(tradesFile)) {
      const trades = JSON.parse(fs.readFileSync(tradesFile, 'utf8'));
      return Array.isArray(trades) ? trades : [];
    }
  } catch (e) {
    console.log('Could not load tracked trades:', e.message);
  }
  return [];
}

// Analyze trades by stage
function analyzeTrades(trades) {
  const stageAnalysis = {
    'ULTRA_STRONG_BUY': { wins: 0, losses: 0, signals: 0, avgProfit: 0, avgLoss: 0 },
    'STRONG_BUY': { wins: 0, losses: 0, signals: 0, avgProfit: 0, avgLoss: 0 },
    'BUY': { wins: 0, losses: 0, signals: 0, avgProfit: 0, avgLoss: 0 },
  };

  for (const trade of trades) {
    if (!trade.stage || !['ULTRA_STRONG_BUY', 'STRONG_BUY', 'BUY'].includes(trade.stage)) continue;

    const stage = trade.stage;
    const outcome = trade.pnlPct || 0;

    stageAnalysis[stage].signals++;
    if (outcome > 0) {
      stageAnalysis[stage].wins++;
      stageAnalysis[stage].avgProfit += outcome;
    } else {
      stageAnalysis[stage].losses++;
      stageAnalysis[stage].avgLoss += Math.abs(outcome);
    }
  }

  // Calculate averages
  for (const stage of Object.keys(stageAnalysis)) {
    const data = stageAnalysis[stage];
    if (data.signals === 0) continue;

    data.winRate = (data.wins / data.signals * 100).toFixed(1);
    data.avgProfit = data.wins > 0 ? (data.avgProfit / data.wins).toFixed(2) : 0;
    data.avgLoss = data.losses > 0 ? (data.avgLoss / data.losses).toFixed(2) : 0;
  }

  return stageAnalysis;
}

// Main execution
console.log('Loading real traded data...\n');
const trades = loadTrackedTrades();

if (trades.length === 0) {
  console.log('⚠️  No trade history found. Cannot run backtest without real trade data.');
  console.log('\nTo run this backtest, you need:');
  console.log('1. Tracked trades with stage assignments (from Trade Desk)');
  console.log('2. P&L data for each trade');
  console.log('3. Signal scores and conditions met');
  console.log('\nPlease use the Trade Desk to track trades first, then run this backtest.\n');
  process.exit(1);
}

console.log(`Loaded ${trades.length} trades\n`);

const analysis = analyzeTrades(trades);

console.log('CURRENT STAGE PERFORMANCE\n');
console.log('═══════════════════════════════════════════════════════════════\n');

let totalSignals = 0;
let totalWins = 0;

for (const stage of ['ULTRA_STRONG_BUY', 'STRONG_BUY', 'BUY']) {
  const data = analysis[stage];
  if (data.signals > 0) {
    console.log(`${stage}:`);
    console.log(`  Signals: ${data.signals}`);
    console.log(`  Win Rate: ${data.winRate}%`);
    console.log(`  Avg Win: ${data.avgProfit}% | Avg Loss: ${data.avgLoss}%`);
    console.log(`  Payoff Ratio: ${(data.avgProfit / (data.avgLoss || 1)).toFixed(2)}`);
    console.log();

    totalSignals += data.signals;
    totalWins += data.wins;
  }
}

const overallWR = (totalWins / totalSignals * 100).toFixed(1);
console.log(`Overall Win Rate: ${overallWR}% (${totalWins} wins / ${totalSignals} trades)\n`);

console.log('═══════════════════════════════════════════════════════════════\n');

console.log('RECOMMENDATION:\n');
console.log('Based on real trade data analysis:');
console.log('');

if (totalSignals < 50) {
  console.log('⚠️  Sample size too small (${totalSignals} trades)');
  console.log('    Accumulate at least 100+ real trades before optimizing.\n');
} else {
  console.log('✅ Current thresholds (ULTRA=80, STRONG=63, BUY=45):');
  console.log(`   Overall WR: ${overallWR}%`);
  console.log('');
  console.log('Optimization strategy:');

  if (overallWR < 45) {
    console.log('   → Win rate is LOW. Increase thresholds to be MORE selective:');
    console.log('   RECOMMENDED: ULTRA=82, STRONG=65, BUY=48 (HIGH-PRECISION mode)');
  } else if (overallWR < 50) {
    console.log('   → Win rate is MODERATE. Slightly increase thresholds:');
    console.log('   RECOMMENDED: ULTRA=78, STRONG=60, BUY=42 (OPTIMIZED-A)');
  } else if (overallWR < 55) {
    console.log('   → Win rate is GOOD. Fine-tune for better balance:');
    console.log('   RECOMMENDED: ULTRA=76, STRONG=59, BUY=41 (OPTIMIZED-D)');
  } else {
    console.log('   → Win rate is EXCELLENT. Current thresholds are good!');
    console.log('   Consider: ULTRA=75, STRONG=58, BUY=40 for slightly more signals');
  }
}

console.log('\n═══════════════════════════════════════════════════════════════\n');

// Save analysis
const outputFile = path.join(__dirname, 'results', `stage_analysis_${new Date().toISOString().split('T')[0]}.json`);
fs.writeFileSync(outputFile, JSON.stringify({
  timestamp: new Date().toISOString(),
  tradesAnalyzed: trades.length,
  stagePerformance: analysis,
  overallWinRate: overallWR,
  testConfigs: TEST_CONFIGS,
}, null, 2));

console.log(`Analysis saved to: ${outputFile}`);
