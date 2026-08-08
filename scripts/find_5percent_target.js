#!/usr/bin/env node
/**
 * FIND 5% PROFIT TARGET
 * Test different ATR multiples to find what achieves 5% profit
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  FINDING 5% PROFIT TARGET');
console.log('  What ATR multiple gets you to 5% profit?');
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

function testTarget(candles, entryIdx, entryPrice, atr14, targetMultiplier, maxHoldBars = 20) {
  const target = entryPrice + (targetMultiplier * atr14);
  const sl = entryPrice - (3 * atr14);

  let hitTarget = false, bars = 0, maxPrice = entryPrice, hitSL = false;

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
  const targetPct = (target - entryPrice) / entryPrice * 100;
  const maxGain = (maxPrice - entryPrice) / entryPrice * 100;

  return {
    hitTarget,
    hitSL,
    bars,
    maxGain,
    slPct,
    targetPct
  };
}

// Test different multiples
const multiples = [3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8];

const results = {};
for (const m of multiples) {
  results[m] = { hits: 0, total: 0, sumBars: 0, sumGain: 0, losses: 0 };
}

const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('_OHLCV.csv'))
  .sort()
  .slice(0, 30);

console.log(`Testing ${files.length} stocks with different target multiples...\n`);

let totalTrades = 0;

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

      for (const mult of multiples) {
        const result = testTarget(candles, i, entry, atr14, mult, 20);

        results[mult].total++;

        if (result.hitSL) {
          results[mult].losses++;
        } else if (result.hitTarget) {
          results[mult].hits++;
          results[mult].sumBars += result.bars;
        }

        results[mult].sumGain += result.maxGain;
        totalTrades++;
      }
    }
  } catch (e) {}
}

console.log(`Processed ${totalTrades} signal-target combinations\n`);
console.log('═══════════════════════════════════════════════════════════════\n');

const ranked = Object.entries(results)
  .map(([mult, v]) => {
    const hitRate = (v.hits / v.total) * 100;
    const lossRate = (v.losses / v.total) * 100;
    const avgGain = v.sumGain / v.total;
    const targetPct = parseFloat(mult) * 2.5; // Approx: avg ATR ~2.5% of price

    return {
      multiplier: parseFloat(mult),
      targetPct: targetPct.toFixed(1),
      hitRate: hitRate.toFixed(1),
      lossRate: lossRate.toFixed(1),
      avgGain: avgGain.toFixed(2),
      expectancy: ((hitRate / 100 * targetPct) - (lossRate / 100 * 7.5)).toFixed(2),
      trades: v.total,
      hits: v.hits,
      losses: v.losses
    };
  })
  .sort((a, b) => b.hitRate - a.hitRate);

console.log('Multiple | Target | Hit% | Loss% | Avg Gain | Expectancy');
console.log('─'.repeat(63));
for (const r of ranked) {
  console.log(
    `${r.multiplier.toFixed(1)}×ATR    | ${r.targetPct.padStart(6)}% | ${r.hitRate.padStart(5)}% | ${r.lossRate.padStart(5)}% | ${r.avgGain.padStart(7)}% | ${r.expectancy.padStart(9)}%`
  );
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('FINDING 5% TARGET\n');

// Find which multiple gets ~5%
const near5pct = ranked.find(r => Math.abs(parseFloat(r.targetPct) - 5) < 1);

if (near5pct) {
  console.log(`Target: ${near5pct.targetPct}% (${near5pct.multiplier.toFixed(1)}×ATR)`);
  console.log(`Hit Rate: ${near5pct.hitRate}%`);
  console.log(`Avg Gain: ${near5pct.avgGain}%`);
  console.log(`Expectancy: ${near5pct.expectancy}%\n`);
}

// Show what it takes to hit 5% consistently
console.log('RECOMMENDATION:\n');

const profitable5pct = ranked.filter(r => parseFloat(r.targetPct) >= 4.5 && parseFloat(r.targetPct) <= 5.5);

if (profitable5pct.length > 0) {
  const best = profitable5pct[0];
  console.log(`✅ To hit 5% profit target:`);
  console.log(`   Use T1/T2/T3 = ${best.multiplier.toFixed(1)}×ATR`);
  console.log(`   Expected: ${best.targetPct}% profit`);
  console.log(`   Hit Rate: ${best.hitRate}%`);
  console.log(`   Expectancy: ${best.expectancy}%\n`);
} else {
  // Find closest to 5%
  const closest = ranked[0];
  console.log(`⚠️  No single multiplier targets exactly 5%`);
  console.log(`\n   Best option: ${closest.multiplier.toFixed(1)}×ATR`);
  console.log(`   Targets: ${closest.targetPct}%`);
  console.log(`   Hit Rate: ${closest.hitRate}%`);
  console.log(`   Expectancy: ${closest.expectancy}%\n`);
}

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('MULTI-TIER OPTION FOR 5% PROFIT\n');

console.log(`If your goal is 5% profit, use multi-target approach:`);
console.log(`  T1 = 3×ATR (34% hit, lock partial profit)`);
console.log(`  T2 = 5×ATR (hit for remainder, reach 5%+ goal)`);
console.log(`  T3 = 7×ATR (extended hold for runners)\n`);
console.log(`This combines probability (hit T1 early) with profit (hit 5%+ at T2)`);

console.log('═══════════════════════════════════════════════════════════════');
