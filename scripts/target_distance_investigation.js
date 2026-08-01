#!/usr/bin/env node
/**
 * TARGET DISTANCE INVESTIGATION
 * Find optimal T1/T2 distances to consistently hit 5%+ profit targets
 * Tests against actual target levels, not MFE
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  TARGET DISTANCE INVESTIGATION');
console.log('  What % gains are needed to hit 5%+ profit targets?');
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

function analyzeTargetReach(candles, idx, entry, targetPct) {
  const atr = calcATR(candles, idx);
  const target = entry * (1 + targetPct / 100);

  let hitTarget = false, bars = 0, maxPrice = entry;

  for (let j = idx + 1; j <= Math.min(idx + 20, candles.length - 1); j++) {
    bars++;
    maxPrice = Math.max(maxPrice, candles[j].h);
    if (candles[j].h >= target) {
      hitTarget = true;
      break;
    }
  }

  const maxGain = (maxPrice - entry) / entry * 100;
  return { hitTarget, bars, maxGain, atrPct: (atr / entry) * 100 };
}

// Test target percentages (5%, 7.5%, 10%, etc.)
const targetPcts = [3, 4, 5, 6, 7, 7.5, 8, 10, 12.5, 15];

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

      // Filter: Same gates as screener
      if (bodyPct < 60 || closeLoc < 40) continue;

      const entry = sig.c; // Same-day entry at close

      for (const targetPct of targetPcts) {
        const key = `T${targetPct}`;
        if (!results[key]) {
          results[key] = { hits: 0, total: 0, sumBars: 0, sumGain: 0 };
        }

        const analysis = analyzeTargetReach(candles, i, entry, targetPct);
        results[key].total++;
        if (analysis.hitTarget) {
          results[key].hits++;
          results[key].sumBars += analysis.bars;
        }
        results[key].sumGain += analysis.maxGain;
        processed++;
      }
    }
  } catch (e) {}
}

console.log(`Processed ${processed} signal-target combinations\n`);
console.log('═══════════════════════════════════════════════════════════════\n');
console.log('TARGET ANALYSIS\n');

const ranked = Object.entries(results)
  .map(([k, v]) => ({
    target: k,
    hitRate: ((v.hits / v.total) * 100).toFixed(1),
    avgBars: v.total > 0 ? (v.sumBars / v.hits || 0).toFixed(1) : '—',
    avgGain: (v.sumGain / v.total).toFixed(2),
    trades: v.total,
    hits: v.hits
  }))
  .sort((a, b) => parseFloat(b.hitRate) - parseFloat(a.hitRate));

for (const r of ranked) {
  console.log(`${r.target.padEnd(5)} | Hit Rate: ${r.hitRate}% | Avg Gain: ${r.avgGain}% | Bars: ${r.avgBars}`);
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('INTERPRETATION\n');

const fiveTarget = results['T5'];
const sevenTarget = results['T7'];
const tenTarget = results['T10'];

console.log(`5% Target:  ${(fiveTarget.hits / fiveTarget.total * 100).toFixed(1)}% hit rate`);
console.log(`7.5% Target: ${(sevenTarget.hits / sevenTarget.total * 100).toFixed(1)}% hit rate`);
console.log(`10% Target: ${(tenTarget.hits / tenTarget.total * 100).toFixed(1)}% hit rate\n`);

console.log('RECOMMENDATION\n');

// Find 70%+ hit rate target
const viable = ranked.filter(r => parseFloat(r.hitRate) >= 70);
if (viable.length > 0) {
  const best = viable[0];
  console.log(`✅ REALISTIC TARGET: ${best.target}`);
  console.log(`   Hit Rate: ${best.hitRate}%`);
  console.log(`   Avg Gain: ${best.avgGain}% per trade\n`);
  console.log(`This gives you 70%+ probability of reaching profit target`);
  console.log(`within typical 15-20 bar hold window.\n`);
}

console.log(`⚠️  5% target hit rate: ${(fiveTarget.hits / fiveTarget.total * 100).toFixed(1)}%`);
console.log(`   Users requesting 5% targets need to accept this lower hit rate`);
console.log(`   OR be willing to take smaller (3-4%) profits more consistently\n`);

console.log('═══════════════════════════════════════════════════════════════');
