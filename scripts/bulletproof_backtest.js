#!/usr/bin/env node
/**
 * BULLETPROOF BACKTEST - ZERO HALLUCINATION
 * Complete transparency: every calculation shown
 * Real OHLCV data, real trade simulation
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = 'C:\\Users\\drkkr\\Downloads\\NIFTY ALL1783';

console.log('═══════════════════════════════════════════════════════════════');
console.log('  BULLETPROOF BACKTEST - COMPLETE TRANSPARENCY');
console.log('  No assumptions. Every number auditable.');
console.log('═══════════════════════════════════════════════════════════════\n');

function loadCSV(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1);
  return lines.map((line, idx) => {
    const [date, o, h, low, c, v] = line.split(',');
    return {
      idx: idx,
      date,
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

function analyzeTrade(candles, entryIdx, entryPrice, atr14, maxHoldBars = 20) {
  const t1 = entryPrice + (1 * atr14);
  const t2 = entryPrice + (1.75 * atr14);
  const t3 = entryPrice + (3 * atr14);
  const sl = entryPrice - (3 * atr14);

  let hitT1 = false, hitT2 = false, hitT3 = false, hitSL = false;
  let bars = 0, maxPrice = entryPrice;

  // Simulate forward from entry
  for (let i = entryIdx + 1; i <= Math.min(entryIdx + maxHoldBars, candles.length - 1); i++) {
    bars++;
    maxPrice = Math.max(maxPrice, candles[i].h);

    // Check stop loss first
    if (candles[i].l <= sl) {
      hitSL = true;
      break;
    }

    // Check targets in order
    if (!hitT1 && candles[i].h >= t1) hitT1 = true;
    if (!hitT2 && candles[i].h >= t2) hitT2 = true;
    if (!hitT3 && candles[i].h >= t3) hitT3 = true;
  }

  const pnlPct = (maxPrice - entryPrice) / entryPrice * 100;
  const slPct = (entryPrice - sl) / entryPrice * 100;

  return {
    entryPrice,
    t1, t2, t3, sl,
    hitT1, hitT2, hitT3, hitSL,
    bars,
    maxPrice,
    pnlPct,
    slPct,
    atr14,
    atrPct: (atr14 / entryPrice) * 100
  };
}

// Load all files
const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('_OHLCV.csv'))
  .sort()
  .slice(0, 30);

console.log(`Loading ${files.length} stock files...\n`);

const allTrades = [];
let totalCandlesProcessed = 0;

for (const file of files) {
  try {
    const candles = loadCSV(path.join(DATA_DIR, file));
    if (candles.length < 50) continue;

    totalCandlesProcessed += candles.length;

    // Process each candle as potential entry
    for (let i = 20; i < candles.length - 20; i++) {
      const sig = candles[i];
      const range = sig.h - sig.l;
      const body = Math.abs(sig.c - sig.o);
      const closeLoc = range > 0 ? (sig.c - sig.l) / range * 100 : 50;
      const bodyPct = range > 0 ? body / range * 100 : 0;

      // ENTRY GATES
      const bodyGate = bodyPct >= 60;
      const closeGate = closeLoc >= 40;

      if (!bodyGate || !closeGate) continue; // Skip if gates fail

      const atr14 = calcATR14(candles, i);
      if (atr14 <= 0) continue;

      // Entry: same-day close
      const trade = analyzeTrade(candles, i, sig.c, atr14, 20);
      trade.stock = file.replace('_OHLCV.csv', '');
      trade.date = sig.date;
      trade.bodyGate = bodyGate;
      trade.closeGate = closeGate;

      allTrades.push(trade);
    }
  } catch (e) {
    console.error(`Error processing ${file}: ${e.message}`);
  }
}

console.log(`Loaded ${allTrades.length} valid trades from ${totalCandlesProcessed} candles\n`);

if (allTrades.length === 0) {
  console.log('ERROR: No trades matched criteria');
  process.exit(1);
}

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('SCENARIO ANALYSIS: T1=1×ATR, T2=1.75×ATR, T3=3×ATR\n');

// Scenario 1: 100% T1 only
console.log('SCENARIO 1: Exit 100% at T1 (1×ATR)\n');
const s1 = allTrades.map(t => {
  if (t.hitSL) return { win: 0, pnl: -t.slPct, target: 'SL' };
  if (t.hitT1) return { win: 1, pnl: (t.t1 - t.entryPrice) / t.entryPrice * 100, target: 'T1' };
  return { win: 0, pnl: t.pnlPct, target: 'none' };
});
const s1wins = s1.filter(x => x.win).length;
const s1loss = s1.filter(x => !x.win).length;
const s1wr = (s1wins / s1.length * 100).toFixed(1);
const s1pnl = (s1.reduce((a, b) => a + b.pnl, 0) / s1.length).toFixed(2);
console.log(`  Trades: ${s1.length} | Wins: ${s1wins} | Losses: ${s1loss}`);
console.log(`  Win Rate: ${s1wr}% | Avg PnL: ${s1pnl}%\n`);

// Scenario 2: 100% T3 only
console.log('SCENARIO 2: Hold 100% to T3 (3×ATR)\n');
const s3 = allTrades.map(t => {
  if (t.hitSL) return { win: 0, pnl: -t.slPct, target: 'SL' };
  if (t.hitT3) return { win: 1, pnl: (t.t3 - t.entryPrice) / t.entryPrice * 100, target: 'T3' };
  if (t.hitT2) return { win: 1, pnl: (t.t2 - t.entryPrice) / t.entryPrice * 100, target: 'T2' };
  if (t.hitT1) return { win: 1, pnl: (t.t1 - t.entryPrice) / t.entryPrice * 100, target: 'T1' };
  return { win: 0, pnl: t.pnlPct, target: 'none' };
});
const s3wins = s3.filter(x => x.win).length;
const s3loss = s3.filter(x => !x.win).length;
const s3wr = (s3wins / s3.length * 100).toFixed(1);
const s3pnl = (s3.reduce((a, b) => a + b.pnl, 0) / s3.length).toFixed(2);
console.log(`  Trades: ${s3.length} | Wins: ${s3wins} | Losses: ${s3loss}`);
console.log(`  Win Rate: ${s3wr}% | Avg PnL: ${s3pnl}%\n`);

// Scenario 3: 50/50 T1-T2
console.log('SCENARIO 3: 50% at T1, 50% at T2\n');
const s2 = allTrades.map(t => {
  if (t.hitSL) return { win: 0, pnl: -t.slPct, target: 'SL' };

  let pnl = 0;
  let hasWin = false;

  // 50% at T1
  if (t.hitT1) {
    pnl += 0.5 * ((t.t1 - t.entryPrice) / t.entryPrice * 100);
    hasWin = true;
  } else {
    pnl += 0.5 * t.pnlPct;
  }

  // 50% at T2
  if (t.hitT2) {
    pnl += 0.5 * ((t.t2 - t.entryPrice) / t.entryPrice * 100);
    hasWin = true;
  } else if (t.hitT1) {
    pnl += 0.5 * ((t.t1 - t.entryPrice) / t.entryPrice * 100);
  } else {
    pnl += 0.5 * t.pnlPct;
  }

  return { win: hasWin ? 1 : 0, pnl, target: hasWin ? 'T1/T2' : 'none' };
});
const s2wins = s2.filter(x => x.win).length;
const s2loss = s2.filter(x => !x.win).length;
const s2wr = (s2wins / s2.length * 100).toFixed(1);
const s2pnl = (s2.reduce((a, b) => a + b.pnl, 0) / s2.length).toFixed(2);
console.log(`  Trades: ${s2.length} | Wins: ${s2wins} | Losses: ${s2loss}`);
console.log(`  Win Rate: ${s2wr}% | Avg PnL: ${s2pnl}%\n`);

// Scenario 4: Blended (scale out at each target)
console.log('SCENARIO 4: Scale out 33% at T1, 33% at T2, 34% at T3\n');
const s4 = allTrades.map(t => {
  if (t.hitSL) return { win: 0, pnl: -t.slPct, target: 'SL' };

  let pnl = 0;
  let hasWin = false;

  if (t.hitT3) {
    pnl = 0.33 * ((t.t1 - t.entryPrice) / t.entryPrice * 100) +
          0.33 * ((t.t2 - t.entryPrice) / t.entryPrice * 100) +
          0.34 * ((t.t3 - t.entryPrice) / t.entryPrice * 100);
    hasWin = true;
  } else if (t.hitT2) {
    pnl = 0.33 * ((t.t1 - t.entryPrice) / t.entryPrice * 100) +
          0.67 * ((t.t2 - t.entryPrice) / t.entryPrice * 100);
    hasWin = true;
  } else if (t.hitT1) {
    pnl = ((t.t1 - t.entryPrice) / t.entryPrice * 100);
    hasWin = true;
  } else {
    pnl = t.pnlPct;
  }

  return { win: hasWin ? 1 : 0, pnl, target: hasWin ? 'blended' : 'none' };
});
const s4wins = s4.filter(x => x.win).length;
const s4loss = s4.filter(x => !x.win).length;
const s4wr = (s4wins / s4.length * 100).toFixed(1);
const s4pnl = (s4.reduce((a, b) => a + b.pnl, 0) / s4.length).toFixed(2);
console.log(`  Trades: ${s4.length} | Wins: ${s4wins} | Losses: ${s4loss}`);
console.log(`  Win Rate: ${s4wr}% | Avg PnL: ${s4pnl}%\n`);

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('TARGET HIT RATES (All trades)\n');
const t1hits = allTrades.filter(t => t.hitT1).length;
const t2hits = allTrades.filter(t => t.hitT2).length;
const t3hits = allTrades.filter(t => t.hitT3).length;
const slhits = allTrades.filter(t => t.hitSL).length;

console.log(`T1 (1×ATR):    ${((t1hits / allTrades.length) * 100).toFixed(1)}% (${t1hits} trades)`);
console.log(`T2 (1.75×ATR): ${((t2hits / allTrades.length) * 100).toFixed(1)}% (${t2hits} trades)`);
console.log(`T3 (3×ATR):    ${((t3hits / allTrades.length) * 100).toFixed(1)}% (${t3hits} trades)`);
console.log(`SL Hit:        ${((slhits / allTrades.length) * 100).toFixed(1)}% (${slhits} trades)\n`);

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('COMPARISON TABLE\n');
console.log('Scenario          | Win Rate | Avg PnL | Wins | Losses');
console.log('─'.repeat(63));
console.log(`100% T1           |  ${s1wr.padStart(5)}% | ${s1pnl.padStart(7)}% | ${s1wins.toString().padStart(4)} | ${s1loss.toString().padStart(6)}`);
console.log(`50% T1 / 50% T2   |  ${s2wr.padStart(5)}% | ${s2pnl.padStart(7)}% | ${s2wins.toString().padStart(4)} | ${s2loss.toString().padStart(6)}`);
console.log(`100% T3           |  ${s3wr.padStart(5)}% | ${s3pnl.padStart(7)}% | ${s3wins.toString().padStart(4)} | ${s3loss.toString().padStart(6)}`);
console.log(`33/33/34 Blended  |  ${s4wr.padStart(5)}% | ${s4pnl.padStart(7)}% | ${s4wins.toString().padStart(4)} | ${s4loss.toString().padStart(6)}`);

console.log('\n═══════════════════════════════════════════════════════════════\n');
console.log('STATISTICS\n');

// Find best scenario
const scenarios = [
  { name: '100% T1', wr: parseFloat(s1wr), pnl: parseFloat(s1pnl), data: s1 },
  { name: '50/50 T1-T2', wr: parseFloat(s2wr), pnl: parseFloat(s2pnl), data: s2 },
  { name: '100% T3', wr: parseFloat(s3wr), pnl: parseFloat(s3pnl), data: s3 },
  { name: 'Blended', wr: parseFloat(s4wr), pnl: parseFloat(s4pnl), data: s4 }
];

for (const scenario of scenarios) {
  const wins = scenario.data.filter(x => x.win);
  const losses = scenario.data.filter(x => !x.win);

  const winPnLs = wins.map(x => x.pnl).sort((a, b) => a - b);
  const lossPnLs = losses.map(x => x.pnl).sort((a, b) => a - b);

  const avgWin = winPnLs.length > 0 ? winPnLs.reduce((a, b) => a + b, 0) / winPnLs.length : 0;
  const avgLoss = lossPnLs.length > 0 ? lossPnLs.reduce((a, b) => a + b, 0) / lossPnLs.length : 0;
  const profitFactor = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 999;

  console.log(`${scenario.name}:`);
  console.log(`  Win Rate: ${scenario.wr.toFixed(1)}%`);
  console.log(`  Avg PnL: ${scenario.pnl.toFixed(2)}%`);
  console.log(`  Avg Win: ${avgWin.toFixed(2)}% | Avg Loss: ${avgLoss.toFixed(2)}%`);
  console.log(`  Profit Factor: ${profitFactor.toFixed(2)}x`);
  console.log(`  Expectancy: ${((scenario.wr / 100 * avgWin) + ((1 - scenario.wr / 100) * avgLoss)).toFixed(2)}%\n`);
}

console.log('═══════════════════════════════════════════════════════════════\n');
console.log('METHODOLOGY\n');
console.log(`Entry Gates:`);
console.log(`  - Body ≥ 60% of range`);
console.log(`  - Close Location ≥ 40% of range`);
console.log(`  - Entry: Same-day close`);
console.log(`\nTargets (based on ATR14):`);
console.log(`  - T1 = Entry + 1×ATR`);
console.log(`  - T2 = Entry + 1.75×ATR`);
console.log(`  - T3 = Entry + 3×ATR`);
console.log(`\nStop Loss:`);
console.log(`  - Entry - 3×ATR`);
console.log(`\nHold Window: 20 bars forward`);
console.log(`\nData: ${allTrades.length} real trades across 30 NIFTY stocks`);

console.log('\n═══════════════════════════════════════════════════════════════');
