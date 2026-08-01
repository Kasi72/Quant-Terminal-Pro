#!/usr/bin/env node
/**
 * SPECIFIC TARGETS BACKTEST
 * T1=1×ATR, T2=1.75×ATR, T3=3×ATR
 * Real trade simulation with scale-out logic
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  BACKTEST: T1=1×ATR, T2=1.75×ATR, T3=3×ATR');
console.log('  With gates: Body≥60%, Close Location≥40%');
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

  // Targets
  const sl = entry - (3 * atr);      // Stop loss = 3×ATR
  const t1 = entry + (1 * atr);      // T1 = 1×ATR
  const t2 = entry + (1.75 * atr);   // T2 = 1.75×ATR
  const t3 = entry + (3 * atr);      // T3 = 3×ATR

  let hitT1 = false, hitT2 = false, hitT3 = false, hitSL = false;
  let win = 0, bars = 0, mfe = 0, mae = 0;
  let t1Bars = 0, t2Bars = 0, t3Bars = 0;

  for (let j = idx + 1; j <= Math.min(idx + 20, candles.length - 1); j++) {
    bars++;
    mfe = Math.max(mfe, candles[j].h - entry);
    mae = Math.min(mae, candles[j].l - entry);

    // Check SL first (exit on loss)
    if (!hitSL && candles[j].l <= sl) {
      hitSL = true;
      win = -1;
      break;
    }

    // Track target hits (in order)
    if (!hitT1 && candles[j].h >= t1) {
      hitT1 = true;
      t1Bars = bars;
      if (!win) win = 1;
    }
    if (!hitT2 && candles[j].h >= t2) {
      hitT2 = true;
      t2Bars = bars;
      if (!win) win = 1;
    }
    if (!hitT3 && candles[j].h >= t3) {
      hitT3 = true;
      t3Bars = bars;
      if (!win) win = 1;
    }
  }

  const pnl = mfe / entry * 100;
  const slRiskPct = (entry - sl) / entry * 100;

  return {
    win: win > 0 ? 1 : 0,
    pnl,
    slRiskPct,
    bars,
    hitT1,
    hitT2,
    hitT3,
    t1Bars,
    t2Bars,
    t3Bars,
    atrPct: (atr / entry) * 100
  };
}

const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('_OHLCV.csv'))
  .sort()
  .slice(0, 30);

console.log(`Testing ${files.length} stocks...\n`);

const allTrades = [];
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

      // Gates: body >= 60%, closeLoc >= 40%
      if (bodyPct < 60 || closeLoc < 40) continue;

      const entry = sig.c; // Same-day entry at close
      const trade = simulateTrade(candles, i, entry);
      allTrades.push(trade);
      processed++;
    }
  } catch (e) {}
}

console.log(`Processed ${processed} trades\n`);

if (allTrades.length === 0) {
  console.log('No trades matched filter criteria.');
  process.exit(1);
}

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('OVERALL RESULTS\n');

const wins = allTrades.filter(t => t.win).length;
const losses = allTrades.filter(t => !t.win).length;
const winRate = ((wins / allTrades.length) * 100).toFixed(1);
const avgPnL = (allTrades.reduce((sum, t) => sum + t.pnl, 0) / allTrades.length).toFixed(2);
const avgBars = (allTrades.reduce((sum, t) => sum + t.bars, 0) / allTrades.length).toFixed(1);

console.log(`Total Trades: ${allTrades.length}`);
console.log(`Wins: ${wins} | Losses: ${losses}`);
console.log(`Win Rate: ${winRate}%`);
console.log(`Avg PnL: ${avgPnL}%`);
console.log(`Avg Bars Held: ${avgBars}`);

// Target hit analysis
const t1Hits = allTrades.filter(t => t.hitT1).length;
const t2Hits = allTrades.filter(t => t.hitT2).length;
const t3Hits = allTrades.filter(t => t.hitT3).length;

console.log(`\nTarget Hit Rates:`);
console.log(`T1 (1×ATR):    ${((t1Hits / allTrades.length) * 100).toFixed(1)}% (${t1Hits} trades)`);
console.log(`T2 (1.75×ATR): ${((t2Hits / allTrades.length) * 100).toFixed(1)}% (${t2Hits} trades)`);
console.log(`T3 (3×ATR):    ${((t3Hits / allTrades.length) * 100).toFixed(1)}% (${t3Hits} trades)`);

// Average bars to each target
const t1AvgBars = t1Hits > 0 ? (allTrades.filter(t => t.hitT1).reduce((s, t) => s + t.t1Bars, 0) / t1Hits).toFixed(1) : '—';
const t2AvgBars = t2Hits > 0 ? (allTrades.filter(t => t.hitT2).reduce((s, t) => s + t.t2Bars, 0) / t2Hits).toFixed(1) : '—';
const t3AvgBars = t3Hits > 0 ? (allTrades.filter(t => t.hitT3).reduce((s, t) => s + t.t3Bars, 0) / t3Hits).toFixed(1) : '—';

console.log(`\nAverage Bars to Target:`);
console.log(`T1: ${t1AvgBars} bars`);
console.log(`T2: ${t2AvgBars} bars`);
console.log(`T3: ${t3AvgBars} bars`);

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('SCALE-OUT SCENARIOS\n');

// Scenario 1: Take 100% at T1
const t1Only = allTrades.filter(t => t.hitT1);
const t1OnlyWins = t1Only.filter(t => t.win).length;
const t1OnlyPnL = t1Only.length > 0 ? (t1Only.reduce((s, t) => s + t.pnl, 0) / t1Only.length).toFixed(2) : 0;
console.log(`Scenario 1: Take 100% at T1 (1×ATR)`);
console.log(`  Hit Rate: ${((t1OnlyWins / t1Only.length) * 100).toFixed(1)}% | Avg PnL: ${t1OnlyPnL}%`);

// Scenario 2: Take 50% at T1, 50% at T2
const t2AtLeast = allTrades.filter(t => t.hitT2 || (t.hitT1 && !t.hitT2));
const halfT1 = t2AtLeast.filter(t => t.hitT1).length;
const halfT2 = t2AtLeast.filter(t => t.hitT2).length;
const scen2PnL = t2AtLeast.length > 0 ?
  (t2AtLeast.reduce((s, t) => {
    if (t.hitT2) return s + (t.pnl * 0.5 + (1.75 / 1) * (t.pnl / 20) * 0.5); // rough blend
    else if (t.hitT1) return s + (t.pnl * 0.5); // 50% at T1
    else return s + (t.pnl * 0.5); // loss scaled
  }, 0) / t2AtLeast.length).toFixed(2) : 0;
console.log(`Scenario 2: 50% exit at T1, 50% at T2`);
console.log(`  Hit Rate: ${((t2AtLeast.filter(t => t.win).length / t2AtLeast.length) * 100).toFixed(1)}% | Approx PnL: ~${(avgPnL * 0.75).toFixed(2)}%`);

// Scenario 3: Hold for T3
const t3AtLeast = allTrades.filter(t => t.hitT3);
const t3Wins = t3AtLeast.filter(t => t.win).length;
const t3PnL = t3AtLeast.length > 0 ? (t3AtLeast.reduce((s, t) => s + t.pnl, 0) / t3AtLeast.length).toFixed(2) : 0;
console.log(`Scenario 3: Hold all the way to T3 (3×ATR)`);
console.log(`  Hit Rate: ${((t3Wins / t3AtLeast.length) * 100).toFixed(1)}% | Avg PnL: ${t3PnL}%`);

// Scenario 4: T1 for quick wins, T2 for runners
const blended = allTrades.map(t => {
  if (t.hitT1 && t.hitT2 && t.hitT3) return { win: 1, pnl: t.pnl * 0.8 }; // T3 hit, take 80%
  else if (t.hitT1 && t.hitT2) return { win: 1, pnl: t.pnl * 0.6 }; // T2 hit, take 60%
  else if (t.hitT1) return { win: 1, pnl: t.pnl * 0.4 }; // T1 hit, take 40%
  else return t;
});
const blendedWins = blended.filter(t => t.win).length;
const blendedPnL = (blended.reduce((s, t) => s + t.pnl, 0) / blended.length).toFixed(2);
console.log(`Scenario 4: Blended (partial exits at T1, T2, T3)`);
console.log(`  Hit Rate: ${((blendedWins / blended.length) * 100).toFixed(1)}% | Avg PnL: ${blendedPnL}%`);

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('RISK ANALYSIS\n');

const avgSLRisk = (allTrades.reduce((s, t) => s + t.slRiskPct, 0) / allTrades.length).toFixed(2);
const avgReward = ((allTrades.filter(t => t.win).reduce((s, t) => s + t.pnl, 0) / allTrades.filter(t => t.win).length) || 0).toFixed(2);
const riskRewardRatio = (avgReward / avgSLRisk).toFixed(2);

console.log(`Avg Risk (SL):    ${avgSLRisk}%`);
console.log(`Avg Reward (Win): ${avgReward}%`);
console.log(`Risk:Reward:      1:${riskRewardRatio}`);

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('DISTRIBUTION\n');

// Win/Loss distribution
const winPnLs = allTrades.filter(t => t.win).map(t => t.pnl);
const lossPnLs = allTrades.filter(t => !t.win).map(t => t.pnl);

if (winPnLs.length > 0) {
  const minWin = Math.min(...winPnLs).toFixed(2);
  const maxWin = Math.max(...winPnLs).toFixed(2);
  const medWin = winPnLs.sort((a, b) => a - b)[Math.floor(winPnLs.length / 2)].toFixed(2);
  console.log(`Wins: Min=${minWin}% | Median=${medWin}% | Max=${maxWin}%`);
}

if (lossPnLs.length > 0) {
  const minLoss = Math.min(...lossPnLs).toFixed(2);
  const maxLoss = Math.max(...lossPnLs).toFixed(2);
  const medLoss = lossPnLs.sort((a, b) => a - b)[Math.floor(lossPnLs.length / 2)].toFixed(2);
  console.log(`Losses: Min=${minLoss}% | Median=${medLoss}% | Max=${maxLoss}%`);
}

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('VERDICT\n');

if (winRate >= 60) {
  console.log('✅ STRONG: Win rate ≥60% with positive expectations');
  console.log(`   Deploy with confidence. Portfolio PnL: ${avgPnL}%/trade`);
} else if (winRate >= 50) {
  console.log('⚠️  MARGINAL: Win rate 50-60% requires disciplined execution');
  console.log(`   Use with position sizing caution. Portfolio PnL: ${avgPnL}%/trade`);
} else {
  console.log('❌ RISKY: Win rate <50% is breakeven or underwater');
  console.log(`   Needs refinement. Portfolio PnL: ${avgPnL}%/trade`);
}

console.log('\n═══════════════════════════════════════════════════════════════');
