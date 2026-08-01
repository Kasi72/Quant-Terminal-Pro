#!/usr/bin/env node
/**
 * POSITIONAL TRADER OPTIMIZATION (CORRECTED)
 * Uses ACTUAL dynamic stop loss: MIN(1.5×ATR, 5-day swing low)
 * Tests 15-day holds with realistic risk profile
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  POSITIONAL TRADER (DYNAMIC STOP LOSS)');
console.log('  Stop: MIN(1.5×ATR, 5-day swing low)');
console.log('  Target: 7-15 day hold, 5% profit goal');
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

function get5DaySwingLow(candles, idx) {
  let low = candles[idx].l;
  for (let i = Math.max(0, idx - 4); i <= idx; i++) {
    low = Math.min(low, candles[i].l);
  }
  return low;
}

function getDynamicStop(candles, idx, entry, atr14) {
  // Stop option 1: 1.5 × ATR below entry
  const atrStop = entry - (1.5 * atr14);

  // Stop option 2: 5-day swing low
  const swingLowStop = get5DaySwingLow(candles, idx);

  // Take the TIGHTER (higher) of the two
  const dynamicStop = Math.max(atrStop, swingLowStop);

  return {
    stop: dynamicStop,
    riskPct: ((entry - dynamicStop) / entry * 100),
    useSwingLow: swingLowStop > atrStop
  };
}

function analyzeTargetReach(candles, idx, entry, targetPct, maxDays = 15) {
  const atr = calcATR(candles, idx);
  const stopInfo = getDynamicStop(candles, idx, entry, atr);
  const stop = stopInfo.stop;
  const slPct = stopInfo.riskPct;

  const target = entry * (1 + targetPct / 100);

  let hitTarget = false, bars = 0, maxPrice = entry, hitSL = false;

  for (let j = idx + 1; j <= Math.min(idx + maxDays, candles.length - 1); j++) {
    bars++;
    maxPrice = Math.max(maxPrice, candles[j].h);

    // Check stop loss
    if (candles[j].l <= stop) {
      hitSL = true;
      break;
    }

    // Check target
    if (candles[j].h >= target) {
      hitTarget = true;
      break;
    }
  }

  const maxGain = (maxPrice - entry) / entry * 100;

  return {
    hitTarget,
    hitSL,
    bars,
    maxGain,
    slPct,
    atrPct: (atr / entry) * 100
  };
}

// Test target percentages
const targetPcts = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20];

const results = {};

const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('_OHLCV.csv'))
  .sort()
  .slice(0, 30);

console.log(`Testing ${files.length} stocks...\n`);

let processed = 0;

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

      // Gates
      if (bodyPct < 60 || closeLoc < 40) continue;

      const entry = sig.c;

      for (const targetPct of targetPcts) {
        const key = `T${targetPct}`;
        if (!results[key]) {
          results[key] = { hits: 0, total: 0, sumBars: 0, avgRiskPct: 0, losses: 0 };
        }

        const analysis = analyzeTargetReach(candles, i, entry, targetPct, 15);

        results[key].total++;
        results[key].avgRiskPct += analysis.slPct;

        if (analysis.hitSL) {
          results[key].losses++;
        } else if (analysis.hitTarget) {
          results[key].hits++;
          results[key].sumBars += analysis.bars;
        }

        processed++;
      }
    }
  } catch (e) {}
}

console.log(`Processed ${processed} signal-target combinations\n`);
console.log('═══════════════════════════════════════════════════════════════\n');
console.log('15-DAY HOLD TARGET ANALYSIS (Dynamic Stop)\n');

const ranked = Object.entries(results)
  .map(([k, v]) => {
    const winRate = (v.hits / v.total) * 100;
    const lossRate = (v.losses / v.total) * 100;
    const avgRisk = v.avgRiskPct / v.total;
    const targetNum = parseInt(k.substring(1));
    const expectancy = (winRate / 100 * targetNum) - (lossRate / 100 * avgRisk);

    return {
      target: k,
      winRate: winRate.toFixed(1),
      lossRate: lossRate.toFixed(1),
      avgRisk: avgRisk.toFixed(2),
      avgBars: (v.sumBars / v.hits || 0).toFixed(1),
      expectancy: expectancy.toFixed(2),
      trades: v.total,
      hits: v.hits
    };
  })
  .sort((a, b) => parseFloat(b.expectancy) - parseFloat(a.expectancy));

console.log('Target | Win% | Loss% | Avg Risk | Avg Days | Expectancy');
console.log('─'.repeat(63));
for (const r of ranked) {
  const targetNum = parseInt(r.target.substring(1));
  console.log(
    `${r.target.padEnd(7)}` +
    `| ${r.winRate.padStart(5)}% ` +
    `| ${r.lossRate.padStart(5)}% ` +
    `| ${r.avgRisk.padStart(8)}% ` +
    `| ${r.avgBars.padStart(7)} ` +
    `| ${r.expectancy.padStart(10)}%`
  );
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('5% TARGET (Your Goal)\n');

const t5 = results['T5'];
if (t5) {
  const winRate = (t5.hits / t5.total) * 100;
  const lossRate = (t5.losses / t5.total) * 100;
  const avgRisk = t5.avgRiskPct / t5.total;
  const expectancy = (winRate / 100 * 5) - (lossRate / 100 * avgRisk);
  const avgDays = (t5.sumBars / t5.hits || 0).toFixed(1);

  console.log(`Target: 5%`);
  console.log(`Win Rate: ${winRate.toFixed(1)}% (${t5.hits} of ${t5.total})`);
  console.log(`Loss Rate: ${lossRate.toFixed(1)}`);
  console.log(`Avg Stop Loss: -${avgRisk.toFixed(2)}%`);
  console.log(`Avg Days to Hit: ${avgDays} days`);
  console.log(`Expected Edge (Expectancy): ${expectancy.toFixed(2)}%\n`);

  if (expectancy > 1) {
    console.log(`✅ VERDICT: 5% target is PROFITABLE`);
    console.log(`   Expected edge: ${expectancy.toFixed(2)}% per trade`);
    console.log(`   ${winRate.toFixed(1)}% of trades hit 5% within 15 days`);
  } else if (expectancy > 0) {
    console.log(`⚠️  VERDICT: 5% target SLIGHTLY PROFITABLE`);
    console.log(`   Expected edge: ${expectancy.toFixed(2)}% per trade`);
    console.log(`   Consider tighter stops or higher targets`);
  } else {
    console.log(`❌ VERDICT: 5% target is UNPROFITABLE`);
    console.log(`   Expected edge: ${expectancy.toFixed(2)}% per trade`);
    console.log(`   Need to adjust strategy`);
  }
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('RECOMMENDED TARGETS (Positive Expectancy)\n');

const profitable = ranked.filter(r => parseFloat(r.expectancy) > 0);
if (profitable.length > 0) {
  for (let i = 0; i < Math.min(5, profitable.length); i++) {
    const r = profitable[i];
    const targetNum = parseInt(r.target.substring(1));
    console.log(
      `${r.target.padEnd(8)}` +
      `| Win: ${r.winRate}% | Risk: ${r.avgRisk}% | Edge: ${r.expectancy}%`
    );
  }
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('EXIT STRATEGY OPTIONS\n');

const t3 = ranked.find(r => r.target === 'T3');
const t4 = ranked.find(r => r.target === 'T4');
const t5_data = ranked.find(r => r.target === 'T5');

if (t3) {
  console.log(`OPTION 1: Aggressive (3% target)`);
  console.log(`  Win Rate: ${t3.winRate}% | Expectancy: ${t3.expectancy}%`);
  console.log(`  Fast exits, highest frequency\n`);
}

if (t4) {
  console.log(`OPTION 2: Balanced (4% target)`);
  console.log(`  Win Rate: ${t4.winRate}% | Expectancy: ${t4.expectancy}%`);
  console.log(`  Sweet spot between speed and profit\n`);
}

if (t5_data) {
  console.log(`OPTION 3: Your Goal (5% target)`);
  console.log(`  Win Rate: ${t5_data.winRate}% | Expectancy: ${t5_data.expectancy}%`);
  const exp = parseFloat(t5_data.expectancy);
  if (exp > 0) {
    console.log(`  ✅ Profitable - use this\n`);
  } else {
    console.log(`  ❌ Unprofitable - too aggressive\n`);
  }
}

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('IMPLEMENTATION SUMMARY\n');

const best = profitable.length > 0 ? profitable[0] : ranked[0];
const bestNum = parseInt(best.target.substring(1));

console.log(`Recommended: ${best.target} target`);
console.log(`Expected Edge: ${best.expectancy}% per trade`);
console.log(`Win Rate: ${best.winRate}%`);
console.log(`Average Risk: ${best.avgRisk}%`);
console.log(`Average Hold: ${best.avgBars} days\n`);

const monthlyTrades = 60;
const monthlyReturn = parseFloat(best.expectancy) * monthlyTrades / 100;
console.log(`Monthly Return (60 trades): ${(monthlyReturn * 100).toFixed(1)}%`);
console.log(`Annualized: ${(monthlyReturn * 12 * 100).toFixed(1)}%\n`);

console.log('═══════════════════════════════════════════════════════════════');
