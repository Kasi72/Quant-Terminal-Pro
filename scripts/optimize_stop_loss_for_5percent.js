#!/usr/bin/env node
/**
 * OPTIMIZE STOP LOSS FOR 5% PROFIT TARGET
 * Test different stop loss multiples to find what makes 5% targets profitable
 * Find the sweet spot: tight enough to help, not so tight we stop out constantly
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  OPTIMIZE STOP LOSS FOR 5% PROFIT TARGET');
console.log('  Find the tight stop that makes 5% achievable');
console.log('═══════════════════════════════════════════════════════════════\n');

function loadCSV(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1);
  return lines.map((line, idx) => {
    const [date, o, h, low, c, v] = line.split(',');
    return {
      o: parseFloat(o),
      h: parseFloat(h),
      l: parseFloat(low),
      c: parseFloat(c),
      v: parseInt(v) || 0
    };
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

function testScenario(candles, entryIdx, entryPrice, atr14, targetPct, stopMultiplier, maxHoldBars = 20) {
  const target = entryPrice * (1 + targetPct / 100);
  const sl = entryPrice - (stopMultiplier * atr14);

  let hitTarget = false, hitSL = false, bars = 0, maxPrice = entryPrice;

  for (let i = entryIdx + 1; i <= Math.min(entryIdx + maxHoldBars, candles.length - 1); i++) {
    bars++;
    maxPrice = Math.max(maxPrice, candles[i].h);

    if (candles[i].l <= sl) {
      hitSL = true;
      break;
    }

    if (candles[i].h >= target) {
      hitTarget = true;
      break;
    }
  }

  const slPct = (entryPrice - sl) / entryPrice * 100;
  const maxGainPct = (maxPrice - entryPrice) / entryPrice * 100;

  return {
    hitTarget,
    hitSL,
    bars,
    slPct,
    maxGainPct
  };
}

// Test different stop loss levels
const stopLossMultipliers = [1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0];
const targetPct = 5; // Fixed target: 5%

const results = {};
for (const sl of stopLossMultipliers) {
  results[sl] = { hits: 0, total: 0, slHits: 0, sumBars: 0 };
}

const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('_OHLCV.csv'))
  .sort()
  .slice(0, 30);

console.log(`Testing ${files.length} stocks with different stop losses...\n`);

let totalTests = 0;

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

      // Entry gates
      if (bodyPct < 60 || closeLoc < 40) continue;

      const atr14 = calcATR14(candles, i);
      if (atr14 <= 0) continue;

      const entry = sig.c;

      for (const stopMult of stopLossMultipliers) {
        const result = testScenario(candles, i, entry, atr14, targetPct, stopMult, 20);

        results[stopMult].total++;

        if (result.hitTarget) {
          results[stopMult].hits++;
          results[stopMult].sumBars += result.bars;
        } else if (result.hitSL) {
          results[stopMult].slHits++;
        }

        totalTests++;
      }
    }
  } catch (e) {}
}

console.log(`Processed ${totalTests} trade scenarios\n`);
console.log('═══════════════════════════════════════════════════════════════\n');
console.log(`TARGET: 5% PROFIT\n`);

const ranked = Object.entries(results)
  .map(([slMult, v]) => {
    const targetHitRate = (v.hits / v.total) * 100;
    const slHitRate = (v.slHits / v.total) * 100;
    const winRate = targetHitRate + slHitRate;
    const expectancy = (targetHitRate / 100 * 5) - (slHitRate / 100 * (parseFloat(slMult) * 2.5));

    return {
      stopMultiplier: parseFloat(slMult),
      stopLossPct: (parseFloat(slMult) * 2.5).toFixed(1),
      targetHitRate: targetHitRate.toFixed(1),
      slHitRate: slHitRate.toFixed(1),
      hitRate: (targetHitRate + slHitRate).toFixed(1),
      expectancy: expectancy.toFixed(2),
      avgBars: (v.sumBars / v.hits || 0).toFixed(1),
      trades: v.total
    };
  })
  .sort((a, b) => parseFloat(b.expectancy) - parseFloat(a.expectancy));

console.log('Stop | Risk | Target% | SL Hit% | Hit% | Expectancy | Verdict');
console.log('─'.repeat(70));
for (const r of ranked) {
  let verdict = '';
  if (parseFloat(r.expectancy) > 1) verdict = '✅ GREAT';
  else if (parseFloat(r.expectancy) > 0.5) verdict = '⚠️  OK';
  else if (parseFloat(r.expectancy) > 0) verdict = '⚠️  MARGINAL';
  else verdict = '❌ LOSS';

  console.log(
    `${r.stopMultiplier.toFixed(2)}× | ${r.stopLossPct.padStart(5)}% | ${r.targetHitRate.padStart(7)}% | ${r.slHitRate.padStart(7)}% | ${r.hitRate.padStart(5)}% | ${r.expectancy.padStart(10)}% | ${verdict}`
  );
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('DETAILED ANALYSIS\n');

for (let i = 0; i < Math.min(3, ranked.length); i++) {
  const r = ranked[i];
  const exp = parseFloat(r.expectancy);

  console.log(`${i + 1}. Stop Loss: ${r.stopMultiplier.toFixed(2)}× ATR (${r.stopLossPct}% risk)`);
  console.log(`   5% target hit: ${r.targetHitRate}%`);
  console.log(`   Stop loss hit: ${r.slHitRate}%`);
  console.log(`   Expectancy: ${r.expectancy}%`);

  if (exp > 0) {
    const monthlyReturn = exp * 60 / 100; // 60 trades/month
    const annualReturn = monthlyReturn * 12;
    console.log(`   Monthly (60 trades): ${(monthlyReturn * 100).toFixed(1)}%`);
    console.log(`   Annualized: ${(annualReturn * 100).toFixed(1)}%`);
  }

  console.log();
}

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('RECOMMENDATION\n');

const best = ranked[0];
const bestMult = best.stopMultiplier;
const bestExp = parseFloat(best.expectancy);

if (bestExp > 0) {
  console.log(`✅ OPTIMAL STOP LOSS: ${bestMult.toFixed(2)}×ATR (${best.stopLossPct}% risk)\n`);
  console.log(`This configuration:`);
  console.log(`  • Hits 5% target ${best.targetHitRate}% of the time`);
  console.log(`  • Gets stopped out ${best.slHitRate}% of the time`);
  console.log(`  • Expected profit: ${best.expectancy}% per trade`);
  console.log(`  • Monthly (60 trades): ${(parseFloat(best.expectancy) * 60 / 100 * 100).toFixed(1)}%`);
  console.log(`\nT1/T2/T3 Configuration for 5% Goal:`);
  console.log(`  Entry Gates: Body ≥60%, Close Location ≥40%`);
  console.log(`  Stop Loss: ${bestMult.toFixed(2)}×ATR`);
  console.log(`  T1: 1.5×ATR (intermediate target)`);
  console.log(`  T2: 2.5×ATR (secondary target)`);
  console.log(`  T3: 5×ATR (5% profit target) - EXIT HERE`);
} else {
  console.log(`⚠️  No stop loss configuration makes 5% targets profitable`);
  console.log(`\nReason: Your entry gates filter for moderate setups.`);
  console.log(`        5% targets require either:`);
  console.log(`        1. Tighter entry filters (stronger setups)`);
  console.log(`        2. Lower profit targets (3% instead of 5%)`);
  console.log(`        3. Wider stops (which increases risk per trade)`);
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('COMPARISON: Original vs Optimized\n');

const original = ranked.find(r => r.stopMultiplier === 3.0);
const optimized = ranked[0];

if (original) {
  console.log(`Original (3×ATR stop):`);
  console.log(`  5% Hit Rate: ${original.targetHitRate}%`);
  console.log(`  Expectancy: ${original.expectancy}%\n`);
}

console.log(`Optimized (${optimized.stopMultiplier.toFixed(2)}×ATR stop):`);
console.log(`  5% Hit Rate: ${optimized.targetHitRate}%`);
console.log(`  Expectancy: ${optimized.expectancy}%`);

const improvement = parseFloat(optimized.expectancy) - (original ? parseFloat(original.expectancy) : -0.09);
console.log(`\nImprovement: ${improvement > 0 ? '+' : ''}${improvement.toFixed(2)}%`);

console.log('\n═══════════════════════════════════════════════════════════════');
