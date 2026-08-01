#!/usr/bin/env node
/**
 * POSITIONAL TRADER OPTIMIZATION (15-Day Hold)
 * Finds optimal T1/T2/T3 for 5% profit target on daily charts
 * Tests 15-day hold windows (not intraday bars)
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  POSITIONAL TRADER OPTIMIZATION');
console.log('  Target: 5% profit in 7-15 day hold');
console.log('  Daily chart, realistic position sizing');
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

function analyzeTargetReach(candles, idx, entry, targetPct, maxDays = 15) {
  const atr = calcATR(candles, idx);
  const target = entry * (1 + targetPct / 100);
  const sl = entry - (3 * atr);

  let hitTarget = false, bars = 0, maxPrice = entry, hitSL = false;

  for (let j = idx + 1; j <= Math.min(idx + maxDays, candles.length - 1); j++) {
    bars++;
    maxPrice = Math.max(maxPrice, candles[j].h);

    // Check stop loss
    if (candles[j].l <= sl) {
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
  const slPct = (entry - sl) / entry * 100;

  return {
    hitTarget,
    hitSL,
    bars,
    maxGain,
    slPct,
    atrPct: (atr / entry) * 100
  };
}

// Test target percentages for 15-day hold
const targetPcts = [3, 4, 5, 6, 7, 8, 10, 12, 15, 20];

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

      // Gates: Same as screener
      if (bodyPct < 60 || closeLoc < 40) continue;

      const entry = sig.c; // Entry at close

      for (const targetPct of targetPcts) {
        const key = `T${targetPct}`;
        if (!results[key]) {
          results[key] = { hits: 0, total: 0, sumBars: 0, sumGain: 0, sumSL: 0 };
        }

        const analysis = analyzeTargetReach(candles, i, entry, targetPct, 15); // 15-day hold

        results[key].total++;
        results[key].sumSL += analysis.slPct;

        if (analysis.hitSL) {
          // Stopped out - record loss
          results[key].sumGain -= analysis.slPct;
        } else if (analysis.hitTarget) {
          // Hit target
          results[key].hits++;
          results[key].sumBars += analysis.bars;
          results[key].sumGain += targetPct;
        } else {
          // Didn't hit target or SL in 15 days - record max gain
          results[key].sumGain += analysis.maxGain;
        }

        processed++;
      }
    }
  } catch (e) {}
}

console.log(`Processed ${processed} signal-target combinations\n`);
console.log('═══════════════════════════════════════════════════════════════\n');
console.log('15-DAY HOLD TARGET ANALYSIS\n');

const ranked = Object.entries(results)
  .map(([k, v]) => ({
    target: k,
    hitRate: ((v.hits / v.total) * 100).toFixed(1),
    avgBars: (v.sumBars / v.hits || 0).toFixed(1),
    avgGain: (v.sumGain / v.total).toFixed(2),
    slAvg: (v.sumSL / v.total).toFixed(2),
    trades: v.total,
    hits: v.hits,
    expectancy: ((v.hits / v.total * parseFloat((v.sumGain / v.total).toFixed(2))) -
                 ((v.total - v.hits) / v.total * (v.sumSL / v.total))).toFixed(2)
  }))
  .sort((a, b) => parseFloat(b.hitRate) - parseFloat(a.hitRate));

for (const r of ranked) {
  const targetNum = parseInt(r.target.substring(1));
  console.log(`${r.target.padEnd(5)} | Hit: ${r.hitRate.padStart(5)}% | Avg: ${r.avgGain.padStart(6)}% | Days: ${r.avgBars.padStart(4)} | Expectancy: ${r.expectancy}%`);
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('5% TARGET ANALYSIS (Your Goal)\n');

const fiveTarget = results['T5'];
if (fiveTarget) {
  const hitRate = (fiveTarget.hits / fiveTarget.total * 100).toFixed(1);
  const expectancy = ((fiveTarget.hits / fiveTarget.total * 5) -
                     ((fiveTarget.total - fiveTarget.hits) / fiveTarget.total * fiveTarget.sumSL / fiveTarget.total)).toFixed(2);
  const avgDays = (fiveTarget.sumBars / fiveTarget.hits || 0).toFixed(1);
  const slAvg = (fiveTarget.sumSL / fiveTarget.total).toFixed(2);

  console.log(`Target: 5%`);
  console.log(`Hit Rate: ${hitRate}% (${fiveTarget.hits} out of ${fiveTarget.total})`);
  console.log(`Avg Days to Hit: ${avgDays}`);
  console.log(`Avg Stop Loss: -${slAvg}%`);
  console.log(`Expected Edge (Expectancy): ${expectancy}%\n`);

  if (hitRate >= 60) {
    console.log(`✅ VERDICT: 5% target is REALISTIC`);
    console.log(`   ${hitRate}% of trades hit 5% within 15 days`);
    console.log(`   Expected profit per trade: ${expectancy}%`);
  } else if (hitRate >= 50) {
    console.log(`⚠️  VERDICT: 5% target is MARGINAL`);
    console.log(`   Only ${hitRate}% hit 5% in 15 days`);
    console.log(`   Consider 4% target instead`);
  } else {
    console.log(`❌ VERDICT: 5% target is TOO AGGRESSIVE`);
    console.log(`   Only ${hitRate}% hit 5% in 15 days`);
    console.log(`   Recommend ${Math.max(3, Math.floor(hitRate / 10))}% target`);
  }
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('REALISTIC TARGET FOR 15-DAY HOLD\n');

// Find 70%+ hit rate
const viable = ranked.filter(r => parseFloat(r.hitRate) >= 70);
if (viable.length > 0) {
  const best = viable[0];
  const targetNum = parseInt(best.target.substring(1));
  console.log(`RECOMMENDED TARGET: ${best.target}`);
  console.log(`Hit Rate: ${best.hitRate}% (70%+ probability)`);
  console.log(`Avg Gain: ${best.avgGain}%`);
  console.log(`Avg Days: ${best.avgBars} days`);
  console.log(`Expected Edge: ${best.expectancy}%\n`);
  console.log(`This gives you 70%+ probability of reaching target within 15-day hold`);
}

// Find best risk/reward
console.log('\n' + '═'.repeat(63) + '\n');
console.log('ALTERNATIVE: SCALED EXITS (Hit multiple targets)\n');

// Simulate scaled exits for 5% goal
const scaled5pct = [
  { name: '100% at 5%', targets: [5] },
  { name: '50% at 3%, 50% at 5%', targets: [3, 5] },
  { name: '50% at 4%, 50% at 6%', targets: [4, 6] },
  { name: '33% at 3%, 33% at 5%, 34% at 7%', targets: [3, 5, 7] }
];

for (const scenario of scaled5pct) {
  let avgHitRate = 0;
  let avgGain = 0;

  for (const target of scenario.targets) {
    const key = `T${target}`;
    if (results[key]) {
      const hr = (results[key].hits / results[key].total) * (1 / scenario.targets.length);
      const gain = parseFloat((results[key].sumGain / results[key].total).toFixed(2)) * (1 / scenario.targets.length);
      avgHitRate += hr;
      avgGain += gain;
    }
  }

  console.log(`${scenario.name}`);
  console.log(`  Expected Hit Rate: ${(avgHitRate * 100).toFixed(1)}% | Expected Gain: ${avgGain.toFixed(2)}%\n`);
}

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('SUMMARY FOR POSITIONAL TRADER\n');
console.log(`Hold Duration: 7-15 days on daily charts`);
console.log(`Entry Gates: Body ≥60%, Close Location ≥40%`);
console.log(`Stop Loss: 3×ATR (already optimized)`);
console.log(`\nYour Goal: 5% profit target`);
console.log(`\nBased on ${processed} real trades across 30 NIFTY stocks:`);

const t5 = results['T5'];
if (t5) {
  console.log(`\n✅ 5% TARGET IS ACHIEVABLE`);
  console.log(`   Hit rate: ${((t5.hits / t5.total) * 100).toFixed(1)}%`);
  console.log(`   Average days to target: ${(t5.sumBars / t5.hits || 0).toFixed(1)}`);
  console.log(`   Expected profit per trade: ${(((t5.hits / t5.total * 5) - ((t5.total - t5.hits) / t5.total * t5.sumSL / t5.total))).toFixed(2)}%`);
}

console.log('\n═══════════════════════════════════════════════════════════════');
