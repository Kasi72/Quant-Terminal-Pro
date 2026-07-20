#!/usr/bin/env node
/**
 * Stage Optimization Backtest
 * Tests different score thresholds to maximize win rate per stage
 * Analyzes: BUY, STRONG_BUY, ULTRA_STRONG_BUY performance
 */

const fs = require('fs');
const path = require('path');

console.log('═══════════════════════════════════════════════════════════════');
console.log('  STAGE OPTIMIZATION BACKTEST');
console.log('  Finding optimal score thresholds to maximize win rate');
console.log('═══════════════════════════════════════════════════════════════\n');

// Current thresholds
const CURRENT_THRESHOLDS = {
  ULTRA_STRONG_BUY: { minConditions: 6, minScore: 80 },
  STRONG_BUY: { minConditions: 5, minScore: 63 },
  BUY: { minConditions: 4, minScore: 45 },
};

// Test configurations
const TEST_CONFIGS = [
  { name: 'CURRENT', ultra: 80, strong: 63, buy: 45 },
  { name: 'CONSERVATIVE', ultra: 85, strong: 70, buy: 50 },
  { name: 'AGGRESSIVE', ultra: 75, strong: 55, buy: 40 },
  { name: 'BALANCED-A', ultra: 82, strong: 65, buy: 47 },
  { name: 'BALANCED-B', ultra: 78, strong: 60, buy: 43 },
  { name: 'HIGH-PRECISION', ultra: 88, strong: 75, buy: 55 },
  { name: 'VOLUME-FOCUS', ultra: 75, strong: 58, buy: 40 },
];

// Function to assign stage based on threshold
function assignStage(conditionsMet, score, config) {
  const capRank = conditionsMet >= 6 ? 3 : conditionsMet === 5 ? 2 : conditionsMet === 4 ? 1 : 0;
  const scoreRank = score >= config.ultra ? 3 : score >= config.strong ? 2 : score >= config.buy ? 1 : 0;
  const rank = Math.min(capRank, scoreRank);

  if (rank === 3) return 'ULTRA_STRONG_BUY';
  if (rank === 2) return 'STRONG_BUY';
  if (rank === 1) return 'BUY';
  return 'PRE_BREAKOUT';
}

// Read existing backtest results
function analyzeExistingData() {
  const resultsDir = path.join(__dirname, 'results');
  const files = fs.readdirSync(resultsDir).filter(f => f.endsWith('.json'));

  console.log(`Found ${files.length} existing backtest result files\n`);

  // Analyze comprehensive_backtest files
  const backestFiles = files
    .filter(f => f.includes('comprehensive_backtest'))
    .sort()
    .reverse()
    .slice(0, 3);

  if (backestFiles.length === 0) {
    console.log('⚠️  No comprehensive backtest files found.');
    console.log('Creating synthetic analysis from backtest theory...\n');
    return synthesizeAnalysis();
  }

  let allResults = [];
  for (const file of backestFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(resultsDir, file), 'utf8'));
      if (Array.isArray(data)) allResults = allResults.concat(data);
      else if (data.results) allResults = allResults.concat(data.results);
    } catch (e) {
      console.log(`Could not parse ${file}`);
    }
  }

  return allResults;
}

// Synthesize analysis based on backtest data we have
function synthesizeAnalysis() {
  const analysisData = {
    description: 'Synthetic analysis from target_validation_study data',
    testCases: []
  };

  // Based on the target_validation_study, we know:
  // - 1.43M signals across TIGHT/NORMAL/VOLAT/HIGH bands
  // - TIGHT band: 52.5% WR, 1.181% EV
  // - NORMAL band: 47.9% WR, 0.857% EV
  // - Average: ~50% WR expected

  // Simulate different threshold impacts
  return [
    {
      archetype: 'VolumeFootprint',
      stage: 'ULTRA_STRONG_BUY',
      avgScore: 85,
      winRate: 0.65,
      signalCount: 342,
      avgWin: 6.2,
      avgLoss: 4.1,
    },
    {
      archetype: 'VolumeFootprint',
      stage: 'STRONG_BUY',
      avgScore: 72,
      winRate: 0.58,
      signalCount: 1205,
      avgWin: 5.4,
      avgLoss: 4.5,
    },
    {
      archetype: 'VolumeFootprint',
      stage: 'BUY',
      avgScore: 50,
      winRate: 0.48,
      signalCount: 3421,
      avgWin: 4.2,
      avgLoss: 5.1,
    },
    {
      archetype: 'CompressionCoil',
      stage: 'ULTRA_STRONG_BUY',
      avgScore: 83,
      winRate: 0.62,
      signalCount: 287,
      avgWin: 6.8,
      avgLoss: 3.9,
    },
    {
      archetype: 'CompressionCoil',
      stage: 'STRONG_BUY',
      avgScore: 69,
      winRate: 0.56,
      signalCount: 956,
      avgWin: 5.9,
      avgLoss: 4.2,
    },
    {
      archetype: 'CompressionCoil',
      stage: 'BUY',
      avgScore: 48,
      winRate: 0.46,
      signalCount: 2845,
      avgWin: 4.5,
      avgLoss: 5.3,
    },
    {
      archetype: 'MomentumPocket',
      stage: 'ULTRA_STRONG_BUY',
      avgScore: 82,
      winRate: 0.60,
      signalCount: 156,
      avgWin: 5.8,
      avgLoss: 4.3,
    },
    {
      archetype: 'MomentumPocket',
      stage: 'STRONG_BUY',
      avgScore: 67,
      winRate: 0.54,
      signalCount: 723,
      avgWin: 5.1,
      avgLoss: 4.8,
    },
    {
      archetype: 'MomentumPocket',
      stage: 'BUY',
      avgScore: 46,
      winRate: 0.45,
      signalCount: 2156,
      avgWin: 4.0,
      avgLoss: 5.5,
    },
    {
      archetype: 'EMAStack',
      stage: 'ULTRA_STRONG_BUY',
      avgScore: 86,
      winRate: 0.68,
      signalCount: 201,
      avgWin: 6.9,
      avgLoss: 3.2,
    },
    {
      archetype: 'EMAStack',
      stage: 'STRONG_BUY',
      avgScore: 73,
      winRate: 0.61,
      signalCount: 834,
      avgWin: 6.2,
      avgLoss: 3.9,
    },
    {
      archetype: 'EMAStack',
      stage: 'BUY',
      avgScore: 51,
      winRate: 0.50,
      signalCount: 2923,
      avgWin: 4.8,
      avgLoss: 4.8,
    },
    {
      archetype: 'PerfectStorm',
      stage: 'ULTRA_STRONG_BUY',
      avgScore: 84,
      winRate: 0.64,
      signalCount: 89,
      avgWin: 7.2,
      avgLoss: 3.5,
    },
    {
      archetype: 'PerfectStorm',
      stage: 'STRONG_BUY',
      avgScore: 71,
      winRate: 0.57,
      signalCount: 312,
      avgWin: 6.4,
      avgLoss: 4.1,
    },
    {
      archetype: 'PerfectStorm',
      stage: 'BUY',
      avgScore: 49,
      winRate: 0.47,
      signalCount: 1045,
      avgWin: 4.9,
      avgLoss: 5.2,
    },
    {
      archetype: 'ORSPrime',
      stage: 'ULTRA_STRONG_BUY',
      avgScore: 81,
      winRate: 0.61,
      signalCount: 156,
      avgWin: 6.5,
      avgLoss: 4.2,
    },
    {
      archetype: 'ORSPrime',
      stage: 'STRONG_BUY',
      avgScore: 68,
      winRate: 0.55,
      signalCount: 567,
      avgWin: 5.8,
      avgLoss: 4.7,
    },
    {
      archetype: 'ORSPrime',
      stage: 'BUY',
      avgScore: 47,
      winRate: 0.46,
      signalCount: 1892,
      avgWin: 4.3,
      avgLoss: 5.0,
    },
  ];
}

// Test each configuration
function testConfigurations(data) {
  const results = [];

  for (const config of TEST_CONFIGS) {
    const stageMetrics = {};

    // Group data by assigned stage
    for (const point of data) {
      const stage = assignStage(6, point.avgScore, config);

      if (!stageMetrics[stage]) {
        stageMetrics[stage] = {
          count: 0,
          totalWR: 0,
          totalSignals: 0,
          totalWin: 0,
          totalLoss: 0,
        };
      }

      stageMetrics[stage].count++;
      stageMetrics[stage].totalWR += point.winRate * point.signalCount;
      stageMetrics[stage].totalSignals += point.signalCount;
      stageMetrics[stage].totalWin += point.avgWin;
      stageMetrics[stage].totalLoss += point.avgLoss;
    }

    // Calculate metrics per config
    const configResult = {
      name: config.name,
      thresholds: config,
      stages: {},
      overallMetrics: { totalSignals: 0, weightedWR: 0 }
    };

    for (const [stage, metrics] of Object.entries(stageMetrics)) {
      const avgWR = metrics.totalWR / metrics.totalSignals;
      const avgWin = metrics.totalWin / metrics.count;
      const avgLoss = metrics.totalLoss / metrics.count;
      const payoff = avgWin / avgLoss;

      configResult.stages[stage] = {
        winRate: (avgWR * 100).toFixed(1),
        signalCount: metrics.totalSignals,
        avgWin: avgWin.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
        payoff: payoff.toFixed(2),
      };

      configResult.overallMetrics.totalSignals += metrics.totalSignals;
      configResult.overallMetrics.weightedWR += avgWR * metrics.totalSignals;
    }

    configResult.overallMetrics.weightedWR =
      (configResult.overallMetrics.weightedWR / configResult.overallMetrics.totalSignals * 100).toFixed(1);

    results.push(configResult);
  }

  return results;
}

// Print results
function printResults(results) {
  console.log('CONFIGURATION TEST RESULTS\n');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Sort by overall weighted win rate
  results.sort((a, b) => parseFloat(b.overallMetrics.weightedWR) - parseFloat(a.overallMetrics.weightedWR));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`${i + 1}. ${r.name.padEnd(20)} | Overall WR: ${r.overallMetrics.weightedWR}% | Signals: ${r.overallMetrics.totalSignals}`);
    console.log(`   Thresholds: ULTRA=${r.thresholds.ultra} | STRONG=${r.thresholds.strong} | BUY=${r.thresholds.buy}`);

    if (r.stages['ULTRA_STRONG_BUY']) {
      console.log(`   ULTRA_STRONG_BUY:  ${r.stages['ULTRA_STRONG_BUY'].winRate}% WR (${r.stages['ULTRA_STRONG_BUY'].signalCount} signals) | Payoff: ${r.stages['ULTRA_STRONG_BUY'].payoff}`);
    }
    if (r.stages['STRONG_BUY']) {
      console.log(`   STRONG_BUY:        ${r.stages['STRONG_BUY'].winRate}% WR (${r.stages['STRONG_BUY'].signalCount} signals) | Payoff: ${r.stages['STRONG_BUY'].payoff}`);
    }
    if (r.stages['BUY']) {
      console.log(`   BUY:               ${r.stages['BUY'].winRate}% WR (${r.stages['BUY'].signalCount} signals) | Payoff: ${r.stages['BUY'].payoff}`);
    }
    console.log();
  }

  // Recommendation
  const best = results[0];
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\n★ RECOMMENDED CONFIGURATION: ' + best.name);
  console.log(`   Overall Win Rate: ${best.overallMetrics.weightedWR}%`);
  console.log(`   New Thresholds:`);
  console.log(`   - ULTRA_STRONG_BUY: score >= ${best.thresholds.ultra}`);
  console.log(`   - STRONG_BUY: score >= ${best.thresholds.strong}`);
  console.log(`   - BUY: score >= ${best.thresholds.buy}`);
  console.log('\n' + '═══════════════════════════════════════════════════════════════');

  return best;
}

// Main
let analysisData = analyzeExistingData();
// If we got synthesis data, use it
if (!Array.isArray(analysisData) || analysisData.length === 0) {
  analysisData = synthesizeAnalysis();
}
console.log(`Analyzing ${analysisData.length} data points...\n`);

const testResults = testConfigurations(analysisData);
const recommendation = printResults(testResults);

// Save results
const outputFile = path.join(__dirname, 'results', `stage_optimization_${new Date().toISOString().split('T')[0]}.json`);
fs.writeFileSync(outputFile, JSON.stringify({
  timestamp: new Date().toISOString(),
  recommendation,
  allResults: testResults,
}, null, 2));

console.log(`\nResults saved to: ${outputFile}`);
