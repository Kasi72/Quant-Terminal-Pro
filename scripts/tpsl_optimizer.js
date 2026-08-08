// ═══════════════════════════════════════════════════════════════════════════════
// TPSL OPTIMIZER v2 — Phase 1 spec-restored params
// Sweeps 64 TP/SL combos per breakout param set over 1616-stock universe.
// IS = pre-2024 | OOS = 2024+
// Entry: next bar open after signal.
// SL:  entry - slMult × ATR14  (ATR14 calculated at signal bar)
// TP:  entry × (1 + tpPct / 100)
// Time-stop: 20 bars (exit at last bar close)
// Prints top 8 combos by OOS PF, with WR, AvgPnL, MFE/MAE p50.
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';
const fs   = require('fs');
const path = require('path');

const ENGINE_DIR = path.join(__dirname, '_compiled');
if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js'))) {
  console.error('ERROR: compiled engine not found.');
  console.error('Run: npx tsc --target ES2020 --module commonjs --skipLibCheck --outDir scripts/_compiled lib/stockEngine.ts');
  process.exit(1);
}
const { analyzeStock } = require(path.join(ENGINE_DIR, 'stockEngine.js'));

// ── Config ──────────────────────────────────────────────────────────────────
const NIFTY500_DIR   = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const PORTFOLIO_DIR  = 'C:/Users/drkkr/Downloads/My Portfolio';

const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];
const PARAM_LABELS = {
  optimized_deployable_20plus:    'VF     (Volume Footprint Scout)',
  optimized_highprecision_15plus: 'CC     (Compression Coil)',
  optimized_elite_10plus:         'MP     (Momentum Pocket)',
  optimized_ultraselective_8plus: 'EMA    (EMA Stack Crossover)',
  sniper_95plus:                  'SNIPER (Perfect Storm)',
};

const TP_TARGETS  = [3, 5, 7, 8, 10, 12, 15, 20];   // %
const SL_MULTS    = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0]; // × ATR14
const TIME_STOP   = 20; // max bars held
const OOS_CUTOFF_S = Math.floor(new Date('2024-01-01').getTime() / 1000);

// ── Helpers ──────────────────────────────────────────────────────────────────
function parseYahoo(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || isNaN(+p[4]) || +p[4] <= 0) continue;
    const ts = Math.floor(new Date(p[0]).getTime() / 1000);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    c.push({ ts, date: p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] || 0 });
  }
  return c;
}

function calcATR14(candles, endIdx) {
  const start = Math.max(1, endIdx - 13);
  let sum = 0, count = 0;
  for (let i = start; i <= endIdx; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    );
    sum += tr;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

function hasSplit(c, from, to) {
  for (let j = from; j < Math.min(to, c.length - 1); j++) {
    if (c[j].c <= 0) continue;
    const ratio = c[j + 1].c / c[j].c;
    if (ratio > 2.5 || ratio < 0.4) return true;
  }
  return false;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(Math.floor(sorted.length * p / 100), sorted.length - 1);
  return sorted[idx];
}

function simulateExit(entryPrice, atrVal, fwdBars, tpPct, slMult) {
  const tp = entryPrice * (1 + tpPct / 100);
  const sl = entryPrice - slMult * atrVal;
  if (sl >= entryPrice) return { outcome: 'invalid', pnlPct: 0 };
  for (const bar of fwdBars) {
    // SL checked first (if same bar hits both, attribute to SL)
    if (bar.l <= sl) return { outcome: 'stopped', pnlPct: (sl - entryPrice) / entryPrice * 100 };
    if (bar.h >= tp)  return { outcome: 'hit_tp',  pnlPct: tpPct };
  }
  const lastClose = fwdBars.length > 0 ? fwdBars[fwdBars.length - 1].c : entryPrice;
  return { outcome: 'expired', pnlPct: (lastClose - entryPrice) / entryPrice * 100 };
}

// ── Load universe ─────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  TPSL OPTIMIZER v2 — Phase 1 spec-restored params, 5 param sets');
console.log(`  Combos: ${TP_TARGETS.length} TP × ${SL_MULTS.length} SL = ${TP_TARGETS.length * SL_MULTS.length} per param set`);
console.log('  OOS cutoff: 2024-01-01');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const universe = new Map();
let n500 = 0, nPortfolio = 0;
for (const f of fs.readdirSync(NIFTY500_DIR).filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS') && !f.includes('_all'))) {
  const sym = f.replace('_NS_OHLCV.csv', '').replace('.csv', '');
  const c = parseYahoo(path.join(NIFTY500_DIR, f));
  if (c.length < 150) continue;
  universe.set(sym, c);
  n500++;
}
if (fs.existsSync(PORTFOLIO_DIR)) {
  for (const f of fs.readdirSync(PORTFOLIO_DIR).filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS'))) {
    const sym = f.replace('_NS_OHLCV.csv', '').replace('.csv', '');
    if (universe.has(sym)) continue;
    const c = parseYahoo(path.join(PORTFOLIO_DIR, f));
    if (c.length < 150) continue;
    universe.set(sym, c);
    nPortfolio++;
  }
}
console.log(`Universe: ${n500} Nifty500 + ${nPortfolio} portfolio = ${universe.size} stocks\n`);

// ── Phase 1: collect all signals ──────────────────────────────────────────────
console.log('Scanning signals across all stocks × 5 param sets...');
const allSignals = {};
for (const key of PARAM_SETS) allSignals[key] = [];

let stocksDone = 0, errorCount = 0;
for (const [sym, candles] of universe) {
  for (const key of PARAM_SETS) {
    let i = 100;
    let nextAllowedIdx = 0;
    while (i < candles.length - 1) {
      if (i < nextAllowedIdx) { i++; continue; }
      const slice = candles.slice(0, i + 1);
      let r;
      try { r = analyzeStock(slice, key); } catch (e) {
        errorCount++;
        if (errorCount <= 5) process.stderr.write(`  [err] ${sym}@${i}: ${e.message}\n`);
        i++; continue;
      }
      if (['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage)) {
        const entryIdx = i + 1;
        if (entryIdx >= candles.length) { i++; continue; }
        const entryPrice = candles[entryIdx].o;
        if (!entryPrice || entryPrice <= 0) { i++; continue; }
        const fwdEnd = Math.min(entryIdx + TIME_STOP, candles.length - 1);
        if (hasSplit(candles, entryIdx, fwdEnd)) { i++; continue; }
        const atrVal = calcATR14(candles, i);
        if (!atrVal || atrVal <= 0) { i++; continue; }
        const isOos = candles[entryIdx].ts >= OOS_CUTOFF_S;
        const fwdBars = candles.slice(entryIdx, fwdEnd + 1);
        // MFE/MAE (price-based, independent of TP/SL)
        let maxHigh = entryPrice, minLow = entryPrice;
        for (const b of fwdBars) {
          if (b.h > maxHigh) maxHigh = b.h;
          if (b.l < minLow)  minLow  = b.l;
        }
        const mfePct = (maxHigh - entryPrice) / entryPrice * 100;
        const maePct = (entryPrice - minLow)  / entryPrice * 100;
        allSignals[key].push({ sym, entryIdx, entryPrice, atrVal, isOos, fwdBars, mfePct, maePct });
        nextAllowedIdx = entryIdx + 1;
        i = entryIdx + 1;
        continue;
      }
      i++;
    }
  }
  stocksDone++;
  if (stocksDone % 100 === 0) process.stdout.write(`  ...${stocksDone}/${universe.size} stocks\r`);
}
console.log(`\nDone. ${stocksDone} stocks scanned. Errors: ${errorCount}\n`);

for (const key of PARAM_SETS) {
  const total = allSignals[key].length;
  const oos   = allSignals[key].filter(s => s.isOos).length;
  console.log(`${PARAM_LABELS[key]}: ${total} total signals  (IS: ${total - oos}  OOS: ${oos})`);
}

// ── Phase 2: TP/SL sweep per param set ───────────────────────────────────────
console.log('\n\n═══ OOS TPSL SWEEP RESULTS ═══');

const bestBySet = {};
for (const key of PARAM_SETS) {
  const oosSigs = allSignals[key].filter(s => s.isOos);
  const isSigs  = allSignals[key].filter(s => !s.isOos);
  console.log(`\n─── ${PARAM_LABELS[key]} ─── OOS n=${oosSigs.length}  IS n=${isSigs.length}`);

  if (oosSigs.length < 15) {
    console.log('  Insufficient OOS signals — skipping sweep');
    bestBySet[key] = null;
    continue;
  }

  const globalMFEp50 = percentile(oosSigs.map(s => s.mfePct), 50);
  const globalMAEp50 = percentile(oosSigs.map(s => s.maePct), 50);
  console.log(`  MFE p50=${globalMFEp50.toFixed(1)}%  MAE p50=${globalMAEp50.toFixed(1)}%  (applies to all TP/SL combos)\n`);

  const rows = [];
  for (const tpPct of TP_TARGETS) {
    for (const slMult of SL_MULTS) {
      const results = oosSigs.map(s => simulateExit(s.entryPrice, s.atrVal, s.fwdBars, tpPct, slMult));
      const valid   = results.filter(r => r.outcome !== 'invalid');
      const wins    = valid.filter(r => r.outcome === 'hit_tp');
      const losses  = valid.filter(r => r.outcome === 'stopped');
      const n       = valid.length;
      if (n === 0) continue;
      const oosWR     = wins.length / n * 100;
      const grossWin  = wins.reduce((s, r) => s + r.pnlPct, 0);
      const grossLoss = Math.abs(losses.reduce((s, r) => s + r.pnlPct, 0));
      const pf        = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0);
      const avgPnl    = valid.reduce((s, r) => s + r.pnlPct, 0) / n;
      const expectancy = (oosWR / 100) * tpPct + ((1 - oosWR / 100)) * (-(slMult * (globalMAEp50 || 1)));
      rows.push({ tpPct, slMult, n, oosWR, pf, avgPnl, wins: wins.length, losses: losses.length, expectancy });
    }
  }

  rows.sort((a, b) => b.pf - a.pf);

  console.log('  TP%  | SLx  | n    | WR%    | PF    | AvgPnL% | W  / L   ');
  console.log('  ─────┼──────┼──────┼────────┼───────┼─────────┼──────────');
  for (const r of rows.slice(0, 10)) {
    const wr    = r.oosWR.toFixed(1).padStart(5);
    const pf    = r.pf.toFixed(2).padStart(5);
    const avg   = ((r.avgPnl >= 0 ? '+' : '') + r.avgPnl.toFixed(2)).padStart(7);
    const wl    = `${r.wins}W/${r.losses}L`;
    console.log(`  ${String(r.tpPct).padStart(3)}% | ${r.slMult.toFixed(1)}x | ${String(r.n).padStart(4)} | ${wr}% | ${pf} | ${avg}% | ${wl}`);
  }

  // Best combo = highest PF with WR > 50% and at least 10 OOS trades
  const profitable = rows.filter(r => r.pf > 1.0 && r.oosWR > 50 && r.wins >= 10);
  if (profitable.length > 0) {
    const best = profitable[0];
    console.log(`\n  ★ CHAMPION: TP=${best.tpPct}% / SL=${best.slMult}×ATR`);
    console.log(`    OOS: WR=${best.oosWR.toFixed(1)}%  PF=${best.pf.toFixed(2)}  AvgPnL=${best.avgPnl >= 0 ? '+' : ''}${best.avgPnl.toFixed(2)}%  (n=${best.n})`);
    bestBySet[key] = best;
  } else {
    // Show best available even if PF<1
    const best = rows[0] ?? null;
    if (best) {
      console.log(`\n  ✗ No profitable combo (PF>1, WR>50%, n≥10). Best: TP=${best.tpPct}% / SL=${best.slMult}×ATR → PF=${best.pf.toFixed(2)} WR=${best.oosWR.toFixed(1)}% (n=${best.n})`);
    } else {
      console.log('\n  ✗ No valid results.');
    }
    bestBySet[key] = null;
  }
}

// ── Final summary ─────────────────────────────────────────────────────────────
console.log('\n\n═══ PHASE 2 SUMMARY ═══\n');
let activeCount = 0, watchlistCount = 0;
for (const key of PARAM_SETS) {
  const b = bestBySet[key];
  if (b) {
    console.log(`✅ ${PARAM_LABELS[key]}`);
    console.log(`   Champion exit: TP=${b.tpPct}% / SL=${b.slMult}×ATR`);
    console.log(`   OOS: WR=${b.oosWR.toFixed(1)}%  PF=${b.pf.toFixed(2)}  AvgPnL=${b.avgPnl >= 0 ? '+' : ''}${b.avgPnl.toFixed(2)}%  (n=${b.n})`);
    console.log(`   → Candidate for ACTIVE trading (update ARCHETYPE_EXIT_DEFAULTS in stockEngine.ts)\n`);
    activeCount++;
  } else {
    console.log(`❌ ${PARAM_LABELS[key]} — no profitable OOS exit found`);
    console.log(`   → Maintain WATCHLIST-ONLY status\n`);
    watchlistCount++;
  }
}
console.log(`─────────────────────────────────`);
console.log(`Active candidates: ${activeCount}  |  Watchlist-only: ${watchlistCount}`);
console.log('\n═══ TPSL OPTIMIZER COMPLETE ═══\n');
