// Entry Price Formula Backtest — POS ABOVE / NEG BELOW
// Tests 4 formula variants vs random baseline on NIFTY ALL1783 dataset.
// Measures onset-of->5% momentum run after entry trigger.
//
// Usage: node scripts/entryFormulaBacktest.js

'use strict';
const fs   = require('fs');
const path = require('path');

const CSV_DIR    = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const MIN_BARS   = 80;   // need ATR warmup
const HIGH_VOL_THRESH_PCT = 2.0;  // ATR14/Close*100 > 2% = high volatility
const TRIGGER_WINDOW = 5;         // bars to wait for entry to trigger after signal bar
const MEASURE_BARS   = [5, 10, 20]; // forward-return windows

// ── CSV loader ───────────────────────────────────────────────────────────────
const MONTHS = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function loadCSV(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const bars = [];
  for (let i = 1; i < lines.length; i++) {
    const [date,o,h,l,c,v] = lines[i].split(',');
    const open=+o, high=+h, low=+l, close=+c, vol=+v;
    if (!isFinite(close)||close<=0||!isFinite(high)||!isFinite(low)||!isFinite(open)) continue;
    if (high<low||high<close||low>close) continue;
    const [d,m,y] = date.split('-');
    bars.push({ts:new Date(+y,MONTHS[m],+d).getTime()/1000, o:open, h:high, l:low, c:close, v:vol});
  }
  return bars;
}

// ── ATR14 (EMA-style) ────────────────────────────────────────────────────────
function buildATR14(bars) {
  const atr = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i-1].c),
      Math.abs(bars[i].l - bars[i-1].c)
    );
    atr[i] = i === 1 ? tr : (atr[i-1]*13 + tr)/14;
  }
  return atr;
}

// ── Formula variants for entry price ────────────────────────────────────────
// BUY formulas (entry above High of signal bar)
function buyEntry_Normal(bar)         { return bar.h * 1.0025; }
function buyEntry_ATR(bar, atr)       { return bar.h + 0.75 * atr; }
function buyEntry_Fixed(bar)          { return bar.h + 3; }
// SEL formulas (entry below Low of signal bar)
function selEntry_Normal(bar)         { return bar.l * 0.9975; }
function selEntry_ATR(bar, atr)       { return bar.l - 0.75 * atr; }
function selEntry_Fixed(bar)          { return bar.l - 3; }

// ── Accumulator factory ──────────────────────────────────────────────────────
function makeAcc() {
  return { triggered: 0, hit5: {5:0, 10:0, 20:0}, misses: 0 };
}
function accAll(keys) {
  const o = {};
  for (const k of keys) o[k] = makeAcc();
  return o;
}

// ── Core logic: for one stock, iterate signal bars ───────────────────────────
// "Signal bar" = every bar where we compute the entry.
// Trigger = any of next TRIGGER_WINDOW bars has High > entry (for buy) or Low < entry (for sell).
// After trigger bar, measure max gain within MEASURE_BARS windows.

function processStock(bars, atrs, buyAccs, selAccs) {
  const n = bars.length;

  for (let si = MIN_BARS; si < n - MEASURE_BARS[MEASURE_BARS.length-1] - TRIGGER_WINDOW; si++) {
    const bar = bars[si];
    const atr = atrs[si];
    if (atr <= 0 || bar.c <= 0) continue;

    const atrPct = atr / bar.c * 100;
    const isHighVol = atrPct > HIGH_VOL_THRESH_PCT;

    // ── BUY side ─────────────────────────────────────────────────────────────
    // Entry candidates for this signal bar
    const buyLevels = {
      normal:    buyEntry_Normal(bar),
      atr_based: buyEntry_ATR(bar, atr),
      fixed:     buyEntry_Fixed(bar),
      // carry-forward is handled separately (uses previous entry)
    };

    for (const [key, entry] of Object.entries(buyLevels)) {
      if (!isFinite(entry) || entry <= 0) continue;

      // Find trigger bar (first bar in next TRIGGER_WINDOW whose High >= entry)
      let trigBar = -1;
      for (let t = si + 1; t <= si + TRIGGER_WINDOW && t < n; t++) {
        if (bars[t].h >= entry) { trigBar = t; break; }
      }

      if (trigBar < 0) {
        buyAccs[key].misses++;
        continue;
      }

      buyAccs[key].triggered++;

      // Measure max % gain from entry price within each window
      for (const fwd of MEASURE_BARS) {
        const endBar = trigBar + fwd;
        if (endBar >= n) continue;
        let maxH = 0;
        for (let f = trigBar; f <= endBar; f++) maxH = Math.max(maxH, bars[f].h);
        const gain = (maxH - entry) / entry * 100;
        if (gain >= 5.0) buyAccs[key].hit5[fwd]++;
      }
    }

    // ── SELL side ─────────────────────────────────────────────────────────────
    const selLevels = {
      normal:    selEntry_Normal(bar),
      atr_based: selEntry_ATR(bar, atr),
      fixed:     selEntry_Fixed(bar),
    };

    for (const [key, entry] of Object.entries(selLevels)) {
      if (!isFinite(entry) || entry <= 0) continue;

      let trigBar = -1;
      for (let t = si + 1; t <= si + TRIGGER_WINDOW && t < n; t++) {
        if (bars[t].l <= entry) { trigBar = t; break; }
      }

      if (trigBar < 0) {
        selAccs[key].misses++;
        continue;
      }

      selAccs[key].triggered++;

      for (const fwd of MEASURE_BARS) {
        const endBar = trigBar + fwd;
        if (endBar >= n) continue;
        let minL = Infinity;
        for (let f = trigBar; f <= endBar; f++) minL = Math.min(minL, bars[f].l);
        const drop = (entry - minL) / entry * 100;  // positive = stock fell = win for short
        if (drop >= 5.0) selAccs[key].hit5[fwd]++;
      }
    }
  }
}

// ── Random baseline: for buy side, entry = Close of signal bar (no buffer) ──
// Measures how often any random "enter at close" yields >5% gain = benchmark
function processBenchmark(bars, atrs, bench) {
  const n = bars.length;
  for (let si = MIN_BARS; si < n - MEASURE_BARS[MEASURE_BARS.length-1] - 1; si++) {
    const entry = bars[si].c;
    if (!isFinite(entry) || entry <= 0) continue;
    bench.triggered++;
    for (const fwd of MEASURE_BARS) {
      const endBar = si + 1 + fwd;
      if (endBar >= n) continue;
      let maxH = 0;
      for (let f = si+1; f <= endBar; f++) maxH = Math.max(maxH, bars[f].h);
      const gain = (maxH - entry) / entry * 100;
      if (gain >= 5.0) bench.hit5[fwd]++;
    }
  }
}

// ── Carry-forward backtest ───────────────────────────────────────────────────
// Simulates: entry set once, carried forward until triggered or 20-bar expiry.
// Signal fires at bar si. If not triggered in TRIGGER_WINDOW bars, carry entry to
// next bar's signal (entry unchanged) until either triggered or 20 bars elapsed.
function processCarry(bars, atrs, accBuy, accSel) {
  const n = bars.length;
  let buyEntry = null, buyExpiry = -1, buySet = -1;
  let selEntry = null, selExpiry = -1, selSet = -1;

  for (let i = MIN_BARS; i < n; i++) {
    const bar = bars[i];
    const atr = atrs[i];
    if (atr <= 0 || bar.c <= 0) continue;

    // Check if existing carry-forward entries trigger
    if (buyEntry !== null && i <= buyExpiry) {
      if (bar.h >= buyEntry) {
        // Triggered — measure forward gain
        accBuy.triggered++;
        for (const fwd of MEASURE_BARS) {
          const end = i + fwd;
          if (end >= n) continue;
          let maxH = 0;
          for (let f = i; f <= end; f++) maxH = Math.max(maxH, bars[f].h);
          const gain = (maxH - buyEntry) / buyEntry * 100;
          if (gain >= 5.0) accBuy.hit5[fwd]++;
        }
        buyEntry = null;
      }
    } else if (buyEntry !== null && i > buyExpiry) {
      accBuy.misses++;
      buyEntry = null;
    }

    if (selEntry !== null && i <= selExpiry) {
      if (bar.l <= selEntry) {
        accSel.triggered++;
        for (const fwd of MEASURE_BARS) {
          const end = i + fwd;
          if (end >= n) continue;
          let minL = Infinity;
          for (let f = i; f <= end; f++) minL = Math.min(minL, bars[f].l);
          const drop = (selEntry - minL) / selEntry * 100;
          if (drop >= 5.0) accSel.hit5[fwd]++;
        }
        selEntry = null;
      }
    } else if (selEntry !== null && i > selExpiry) {
      accSel.misses++;
      selEntry = null;
    }

    // Set new entries if none active
    if (buyEntry === null && i < n - MEASURE_BARS[MEASURE_BARS.length-1] - 20) {
      buyEntry  = bar.h * 1.0025;
      buyExpiry = i + 20;
    }
    if (selEntry === null && i < n - MEASURE_BARS[MEASURE_BARS.length-1] - 20) {
      selEntry  = bar.l * 0.9975;
      selExpiry = i + 20;
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
const VARIANTS = ['normal','atr_based','fixed'];
const buyAccs = accAll(VARIANTS);
const selAccs = accAll(VARIANTS);
const carryBuy = makeAcc();
const carrySel = makeAcc();
const bench    = { triggered: 0, hit5: {5:0, 10:0, 20:0} };

const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv'));
process.stdout.write(`Processing ${files.length} stocks...\n`);

for (let fi = 0; fi < files.length; fi++) {
  if (fi % 200 === 0) process.stdout.write(`  ${fi}/${files.length}\r`);
  const bars = loadCSV(path.join(CSV_DIR, files[fi]));
  if (bars.length < MIN_BARS + 30) continue;
  const atrs = buildATR14(bars);
  processStock(bars, atrs, buyAccs, selAccs);
  processCarry(bars, atrs, carryBuy, carrySel);
  processBenchmark(bars, atrs, bench);
}

process.stdout.write(`\nDone.\n\n`);

// ── Report ────────────────────────────────────────────────────────────────────
function pct(n, d) { return d > 0 ? (n/d*100).toFixed(2)+'%' : 'n/a'; }
function trigRate(acc) {
  const total = acc.triggered + acc.misses;
  return total > 0 ? (acc.triggered/total*100).toFixed(1)+'%' : 'n/a';
}

function printSection(title, accMap, carryAcc, benchObj) {
  const W = 115;
  console.log('\n' + '═'.repeat(W));
  console.log(`  ${title}`);
  console.log('═'.repeat(W));
  console.log(
    `  ${'Variant'.padEnd(16)}` +
    `${'Trigger Rate'.padStart(14)}` +
    `${'Triggered N'.padStart(14)}` +
    `${'Missed N'.padStart(12)}` +
    `${'Hit>5% in 5d'.padStart(15)}` +
    `${'Hit>5% in 10d'.padStart(15)}` +
    `${'Hit>5% in 20d'.padStart(15)}`
  );
  console.log('  ' + '-'.repeat(W-2));

  function row(label, acc) {
    console.log(
      `  ${label.padEnd(16)}` +
      `${trigRate(acc).padStart(14)}` +
      `${String(acc.triggered).padStart(14)}` +
      `${String(acc.misses).padStart(12)}` +
      `${pct(acc.hit5[5],  acc.triggered).padStart(15)}` +
      `${pct(acc.hit5[10], acc.triggered).padStart(15)}` +
      `${pct(acc.hit5[20], acc.triggered).padStart(15)}`
    );
  }

  for (const [k, acc] of Object.entries(accMap)) row(k, acc);
  row('carry-fwd(20d)', carryAcc);
  console.log('  ' + '-'.repeat(W-2));
  // Benchmark (no buffer, enter at close)
  console.log(
    `  ${'BENCHMARK'.padEnd(16)}` +
    `${'100% (always)'.padStart(14)}` +
    `${String(benchObj.triggered).padStart(14)}` +
    `${'—'.padStart(12)}` +
    `${pct(benchObj.hit5[5],  benchObj.triggered).padStart(15)}` +
    `${pct(benchObj.hit5[10], benchObj.triggered).padStart(15)}` +
    `${pct(benchObj.hit5[20], benchObj.triggered).padStart(15)}`
  );
}

printSection('BUY SIDE — POS ABOVE  (trigger: High ≥ Entry in next 5 bars, then max High in fwd window ≥ Entry+5%)', buyAccs, carryBuy, bench);
printSection('SELL SIDE — NEG BELOW (trigger: Low ≤ Entry in next 5 bars, then max drop ≥ 5% from Entry within fwd window)', selAccs, carrySel, bench);

// ── Insight summary ───────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(100));
console.log('  ANALYSIS');
console.log('═'.repeat(100));

function analyzeAcc(label, acc) {
  const best = MEASURE_BARS.reduce((b, fwd) => acc.hit5[fwd] > acc.hit5[b] ? fwd : b, MEASURE_BARS[0]);
  const rate = acc.triggered > 0 ? acc.hit5[best] / acc.triggered * 100 : 0;
  const tr   = (acc.triggered + acc.misses) > 0 ? acc.triggered / (acc.triggered + acc.misses) * 100 : 0;
  console.log(`  ${label.padEnd(20)} TrigRate=${tr.toFixed(1)}%  Best: ${best}d → hit5%=${rate.toFixed(1)}%  (${acc.hit5[best]}/${acc.triggered})`);
}

console.log('\n  BUY SIDE:');
for (const [k, acc] of Object.entries(buyAccs)) analyzeAcc(k, acc);
analyzeAcc('carry-fwd(20d)', carryBuy);

console.log('\n  SELL SIDE:');
for (const [k, acc] of Object.entries(selAccs)) analyzeAcc(k, acc);
analyzeAcc('carry-fwd(20d)', carrySel);

const benchBest20 = bench.hit5[20] / bench.triggered * 100;
console.log(`\n  BENCHMARK (enter at close, no buffer): best 20d hit-rate = ${benchBest20.toFixed(1)}%`);
console.log(`\n  Edge vs benchmark = formula hit-rate minus ${benchBest20.toFixed(1)}% baseline.`);
console.log('  Positive edge = the buffer/formula is adding genuine predictive value.');
console.log('  Negative or ~zero edge = formula is just following price, not predicting momentum onset.\n');
