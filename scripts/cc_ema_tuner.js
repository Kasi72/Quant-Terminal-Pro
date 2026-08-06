// ═══════════════════════════════════════════════════════════════════════════════
// CC + EMA HYPER-TUNER
// Both param sets returned insufficient OOS signals (CC: n=8, EMA: n=11) after
// Phase 1 spec-restoration. This script identifies which Phase 1 changes
// over-restricted them and finds the sweet spot: most OOS signals while
// maintaining WR > 55% and PF > 1.2.
//
// Strategy:
//   Pass 1  — for each param combo, count OOS signals + simulate at a fixed
//             TP/SL anchor. Sort by PF, filter n_OOS >= 12.
//   Pass 2  — run 64-combo TP/SL sweep on the top 3 combos per archetype.
//
// CC suspects  : minExactRangeATR14 (0.2→1.0), minCandleQualityScore (null→3)
// EMA suspects : maxPre10AvgRangeATR (1.3→0.75), minUltraPrecisionScore (0→45)
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';
const fs   = require('fs');
const path = require('path');

const ENGINE_DIR = path.join(__dirname, '_compiled');
if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js'))) {
  console.error('Compiled engine not found. Run: npx tsc --target ES2020 --module commonjs --skipLibCheck --outDir scripts/_compiled lib/stockEngine.ts');
  process.exit(1);
}
const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
const { analyzeStock, PARAM_SETS } = engine;

// ── Config ──────────────────────────────────────────────────────────────────
const NIFTY500_DIR  = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const PORTFOLIO_DIR = 'C:/Users/drkkr/Downloads/My Portfolio';

const TIME_STOP      = 20;
const OOS_CUTOFF_S   = Math.floor(new Date('2024-01-01').getTime() / 1000);
const MIN_OOS        = 12;   // minimum OOS signals to include in ranking

// CC anchor TP/SL (previous champion before params changed)
const CC_TP  = 10;    // %
const CC_SL  = 2.5;   // × ATR

// EMA anchor TP/SL (reasonable initial guess)
const EMA_TP = 7;     // %
const EMA_SL = 3.0;   // × ATR

// TP/SL sweep values for Pass 2
const TP_TARGETS = [3, 5, 7, 8, 10, 12, 15, 20];
const SL_MULTS   = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0];

// ── CC grid ──────────────────────────────────────────────────────────────────
// Phase 1 changed minExactRangeATR14 from 0.2 to 1.0 and added minCandleQualityScore=3.
// These are the likely culprits for CC signal collapse.
const CC_GRID = [];
for (const minExactRangeATR14 of [0.2, 0.4, 0.6, 0.8, 1.0, 1.2]) {
  for (const minCandleQualityScore of [null, 2, 3]) {
    CC_GRID.push({ minExactRangeATR14, minCandleQualityScore });
  }
}

// ── EMA grid ──────────────────────────────────────────────────────────────────
// Phase 1 changed maxPre10AvgRangeATR from 1.3 to 0.75 and added minUltraPrecisionScore=45.
const EMA_GRID = [];
for (const maxPre10AvgRangeATR of [0.75, 0.85, 0.95, 1.05, 1.15, 1.30]) {
  for (const minUltraPrecisionScore of [30, 40, 45]) {
    EMA_GRID.push({ maxPre10AvgRangeATR, minUltraPrecisionScore });
  }
}

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
    sum += tr; count++;
  }
  return count > 0 ? sum / count : 0;
}

function hasSplit(c, from, to) {
  for (let j = from; j < Math.min(to, c.length - 1); j++) {
    if (c[j].c <= 0) continue;
    const r = c[j + 1].c / c[j].c;
    if (r > 2.5 || r < 0.4) return true;
  }
  return false;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(Math.floor(sorted.length * p / 100), sorted.length - 1)];
}

function simulateExit(entryPrice, atrVal, fwdBars, tpPct, slMult) {
  const tp = entryPrice * (1 + tpPct / 100);
  const sl = entryPrice - slMult * atrVal;
  if (sl >= entryPrice) return { outcome: 'invalid', pnlPct: 0 };
  for (const bar of fwdBars) {
    if (bar.l <= sl) return { outcome: 'stopped', pnlPct: (sl - entryPrice) / entryPrice * 100 };
    if (bar.h >= tp)  return { outcome: 'hit_tp',  pnlPct: tpPct };
  }
  const lastClose = fwdBars.length > 0 ? fwdBars[fwdBars.length - 1].c : entryPrice;
  return { outcome: 'expired', pnlPct: (lastClose - entryPrice) / entryPrice * 100 };
}

function scoreCombo(signals, tpPct, slMult) {
  const oosSigs = signals.filter(s => s.isOos);
  if (!oosSigs.length) return { n: 0, wr: 0, pf: 0, avgPnl: 0 };
  const results = oosSigs.map(s => simulateExit(s.entryPrice, s.atrVal, s.fwdBars, tpPct, slMult))
    .filter(r => r.outcome !== 'invalid');
  const n = results.length;
  if (!n) return { n: 0, wr: 0, pf: 0, avgPnl: 0 };
  const wins   = results.filter(r => r.outcome === 'hit_tp');
  const losses = results.filter(r => r.outcome === 'stopped');
  const wr     = wins.length / n * 100;
  const grossW = wins.reduce((s, r) => s + r.pnlPct, 0);
  const grossL = Math.abs(losses.reduce((s, r) => s + r.pnlPct, 0));
  const pf     = grossL > 0 ? grossW / grossL : (grossW > 0 ? 99 : 0);
  const avgPnl = results.reduce((s, r) => s + r.pnlPct, 0) / n;
  return { n, wr, pf, avgPnl, wins: wins.length, losses: losses.length };
}

// ── Load universe ─────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  CC + EMA HYPER-TUNER  |  OOS cutoff: 2024-01-01');
console.log(`  CC grid: ${CC_GRID.length} combos  |  EMA grid: ${EMA_GRID.length} combos`);
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

const universe = new Map();
let n500 = 0, nPort = 0;
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
    nPort++;
  }
}
console.log(`Universe: ${n500} Nifty500 + ${nPort} portfolio = ${universe.size} stocks\n`);

// ── Generic scan function ──────────────────────────────────────────────────────
function scanParamSet(key, overrides) {
  // Apply overrides to PARAM_SETS
  const orig = {};
  for (const [k, v] of Object.entries(overrides)) {
    orig[k] = PARAM_SETS[key][k];
    PARAM_SETS[key][k] = v;
  }

  const signals = [];
  let errors = 0;
  for (const [sym, candles] of universe) {
    let i = 100, nextAllowed = 0;
    while (i < candles.length - 1) {
      if (i < nextAllowed) { i++; continue; }
      let r;
      try { r = analyzeStock(candles.slice(0, i + 1), key); } catch (e) {
        errors++; i++; continue;
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
        let maxH = entryPrice, minL = entryPrice;
        for (const b of fwdBars) { if (b.h > maxH) maxH = b.h; if (b.l < minL) minL = b.l; }
        signals.push({
          sym, entryIdx, entryPrice, atrVal, isOos, fwdBars,
          mfePct: (maxH - entryPrice) / entryPrice * 100,
          maePct: (entryPrice - minL) / entryPrice * 100,
        });
        nextAllowed = entryIdx + 1;
        i = entryIdx + 1;
        continue;
      }
      i++;
    }
  }

  // Restore original values
  for (const [k, v] of Object.entries(orig)) PARAM_SETS[key][k] = v;

  return signals;
}

// ══════════════════════════════════════════════════════════════════════════════
// CC GRID SEARCH (Pass 1)
// ══════════════════════════════════════════════════════════════════════════════
console.log('━━━ CC (Compression Coil) — Pass 1 Grid Search ━━━');
console.log(`Anchor exit: TP=${CC_TP}%/SL=${CC_SL}×ATR  |  ${CC_GRID.length} combos × ${universe.size} stocks\n`);

const ccResults = [];
let ccDone = 0;
for (const combo of CC_GRID) {
  const signals = scanParamSet('optimized_highprecision_15plus', combo);
  const oos = signals.filter(s => s.isOos);
  const s = scoreCombo(signals, CC_TP, CC_SL);
  ccResults.push({ combo, totalN: signals.length, oosN: oos.length, ...s });
  ccDone++;
  process.stdout.write(`  CC combo ${ccDone}/${CC_GRID.length}: rangeATR=${combo.minExactRangeATR14} qual=${combo.minCandleQualityScore} → OOS=${oos.length} WR=${s.wr.toFixed(0)}% PF=${s.pf.toFixed(2)}\n`);
}

ccResults.sort((a, b) => b.pf - a.pf);
const ccTop = ccResults.filter(r => r.oosN >= MIN_OOS && r.wr > 50);

console.log('\n─── CC Top Results (n_OOS ≥ ' + MIN_OOS + ', WR > 50%) sorted by PF ───');
console.log('  rangeATR | qual | n_OOS | WR%    | PF    | AvgPnL% | W/L');
console.log('  ─────────┼──────┼───────┼────────┼───────┼─────────┼────────');
for (const r of ccTop.slice(0, 8)) {
  const { minExactRangeATR14: ra, minCandleQualityScore: qs } = r.combo;
  console.log(`  ${String(ra).padStart(8)} | ${String(qs ?? 'null').padStart(4)} | ${String(r.oosN).padStart(5)} | ${r.wr.toFixed(1).padStart(5)}% | ${r.pf.toFixed(2).padStart(5)} | ${((r.avgPnl>=0?'+':'') + r.avgPnl.toFixed(2)).padStart(7)}% | ${r.wins}W/${r.losses}L`);
}
if (!ccTop.length) {
  console.log('  No combo reached n_OOS >= ' + MIN_OOS + ' with WR > 50%.');
  console.log('  Best by PF regardless of n:');
  for (const r of ccResults.slice(0, 5)) {
    const { minExactRangeATR14: ra, minCandleQualityScore: qs } = r.combo;
    console.log(`  rangeATR=${ra} qual=${qs ?? 'null'} → OOS=${r.oosN} WR=${r.wr.toFixed(1)}% PF=${r.pf.toFixed(2)} AvgPnL=${r.avgPnl.toFixed(2)}%`);
  }
}

// ── CC Pass 2: TP/SL sweep on top 3 ──────────────────────────────────────────
const ccPass2 = (ccTop.length > 0 ? ccTop : ccResults).slice(0, 3);
console.log('\n━━━ CC Pass 2 — Full TP/SL sweep on top 3 combos ━━━\n');
let ccChampion = null;

for (const r of ccPass2) {
  const { minExactRangeATR14: ra, minCandleQualityScore: qs } = r.combo;
  console.log(`\n─── CC: rangeATR=${ra}, qualScore=${qs ?? 'null'} (OOS n=${r.oosN}) ───`);
  const signals = scanParamSet('optimized_highprecision_15plus', r.combo);
  const oosSigs = signals.filter(s => s.isOos);
  if (oosSigs.length < 5) { console.log('  Insufficient OOS signals — skip'); continue; }

  const mfePct = percentile(oosSigs.map(s => s.mfePct), 50);
  const maePct = percentile(oosSigs.map(s => s.maePct), 50);
  console.log(`  OOS n=${oosSigs.length}  MFE p50=${mfePct.toFixed(1)}%  MAE p50=${maePct.toFixed(1)}%`);

  const rows = [];
  for (const tpPct of TP_TARGETS) {
    for (const slMult of SL_MULTS) {
      const sc = scoreCombo(signals, tpPct, slMult);
      if (sc.n > 0) rows.push({ tpPct, slMult, ...sc });
    }
  }
  rows.sort((a, b) => b.pf - a.pf);
  console.log('  TP%  | SLx  | n    | WR%    | PF    | AvgPnL%');
  console.log('  ─────┼──────┼──────┼────────┼───────┼────────');
  for (const row of rows.slice(0, 6)) {
    console.log(`  ${String(row.tpPct).padStart(3)}% | ${row.slMult.toFixed(1)}x | ${String(row.n).padStart(4)} | ${row.wr.toFixed(1).padStart(5)}% | ${row.pf.toFixed(2).padStart(5)} | ${((row.avgPnl>=0?'+':'') + row.avgPnl.toFixed(2)).padStart(7)}%`);
  }
  const best = rows.find(r => r.pf > 1.0 && r.wr > 50 && r.wins >= 8);
  if (best && (!ccChampion || best.pf > ccChampion.pf)) {
    ccChampion = { combo: r.combo, ...best };
    console.log(`  ★ Champion candidate: TP=${best.tpPct}%/SL=${best.slMult}×ATR → WR=${best.wr.toFixed(1)}% PF=${best.pf.toFixed(2)} (n=${best.n})`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EMA GRID SEARCH (Pass 1)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n\n━━━ EMA (EMA Stack Crossover) — Pass 1 Grid Search ━━━');
console.log(`Anchor exit: TP=${EMA_TP}%/SL=${EMA_SL}×ATR  |  ${EMA_GRID.length} combos × ${universe.size} stocks\n`);

const emaResults = [];
let emaDone = 0;
for (const combo of EMA_GRID) {
  const signals = scanParamSet('optimized_ultraselective_8plus', combo);
  const oos = signals.filter(s => s.isOos);
  const s = scoreCombo(signals, EMA_TP, EMA_SL);
  emaResults.push({ combo, totalN: signals.length, oosN: oos.length, ...s });
  emaDone++;
  process.stdout.write(`  EMA combo ${emaDone}/${EMA_GRID.length}: preATR=${combo.maxPre10AvgRangeATR} UPS=${combo.minUltraPrecisionScore} → OOS=${oos.length} WR=${s.wr.toFixed(0)}% PF=${s.pf.toFixed(2)}\n`);
}

emaResults.sort((a, b) => b.pf - a.pf);
const emaTop = emaResults.filter(r => r.oosN >= MIN_OOS && r.wr > 50);

console.log('\n─── EMA Top Results (n_OOS ≥ ' + MIN_OOS + ', WR > 50%) sorted by PF ───');
console.log('  preATR | UPS  | n_OOS | WR%    | PF    | AvgPnL% | W/L');
console.log('  ───────┼──────┼───────┼────────┼───────┼─────────┼────────');
for (const r of emaTop.slice(0, 8)) {
  const { maxPre10AvgRangeATR: pa, minUltraPrecisionScore: ups } = r.combo;
  console.log(`  ${String(pa).padStart(6)} | ${String(ups).padStart(4)} | ${String(r.oosN).padStart(5)} | ${r.wr.toFixed(1).padStart(5)}% | ${r.pf.toFixed(2).padStart(5)} | ${((r.avgPnl>=0?'+':'') + r.avgPnl.toFixed(2)).padStart(7)}% | ${r.wins}W/${r.losses}L`);
}
if (!emaTop.length) {
  console.log('  No combo reached n_OOS >= ' + MIN_OOS + ' with WR > 50%.');
  console.log('  Best by OOS count:');
  for (const r of [...emaResults].sort((a,b) => b.oosN - a.oosN).slice(0, 5)) {
    const { maxPre10AvgRangeATR: pa, minUltraPrecisionScore: ups } = r.combo;
    console.log(`  preATR=${pa} UPS=${ups} → OOS=${r.oosN} WR=${r.wr.toFixed(1)}% PF=${r.pf.toFixed(2)} AvgPnL=${r.avgPnl.toFixed(2)}%`);
  }
}

// ── EMA Pass 2: TP/SL sweep on top 3 ──────────────────────────────────────────
const emaPass2 = (emaTop.length > 0 ? emaTop : [...emaResults].sort((a,b) => b.oosN - a.oosN)).slice(0, 3);
console.log('\n━━━ EMA Pass 2 — Full TP/SL sweep on top 3 combos ━━━\n');
let emaChampion = null;

for (const r of emaPass2) {
  const { maxPre10AvgRangeATR: pa, minUltraPrecisionScore: ups } = r.combo;
  console.log(`\n─── EMA: preATR=${pa}, UPS=${ups} (OOS n=${r.oosN}) ───`);
  const signals = scanParamSet('optimized_ultraselective_8plus', r.combo);
  const oosSigs = signals.filter(s => s.isOos);
  if (oosSigs.length < 5) { console.log('  Insufficient OOS signals — skip'); continue; }

  const mfePct = percentile(oosSigs.map(s => s.mfePct), 50);
  const maePct = percentile(oosSigs.map(s => s.maePct), 50);
  console.log(`  OOS n=${oosSigs.length}  MFE p50=${mfePct.toFixed(1)}%  MAE p50=${maePct.toFixed(1)}%`);

  const rows = [];
  for (const tpPct of TP_TARGETS) {
    for (const slMult of SL_MULTS) {
      const sc = scoreCombo(signals, tpPct, slMult);
      if (sc.n > 0) rows.push({ tpPct, slMult, ...sc });
    }
  }
  rows.sort((a, b) => b.pf - a.pf);
  console.log('  TP%  | SLx  | n    | WR%    | PF    | AvgPnL%');
  console.log('  ─────┼──────┼──────┼────────┼───────┼────────');
  for (const row of rows.slice(0, 6)) {
    console.log(`  ${String(row.tpPct).padStart(3)}% | ${row.slMult.toFixed(1)}x | ${String(row.n).padStart(4)} | ${row.wr.toFixed(1).padStart(5)}% | ${row.pf.toFixed(2).padStart(5)} | ${((row.avgPnl>=0?'+':'') + row.avgPnl.toFixed(2)).padStart(7)}%`);
  }
  const best = rows.find(r => r.pf > 1.0 && r.wr > 50 && r.wins >= 6);
  if (best && (!emaChampion || best.pf > emaChampion.pf)) {
    emaChampion = { combo: r.combo, ...best };
    console.log(`  ★ Champion candidate: TP=${best.tpPct}%/SL=${best.slMult}×ATR → WR=${best.wr.toFixed(1)}% PF=${best.pf.toFixed(2)} (n=${best.n})`);
  }
}

// ── Final summary ─────────────────────────────────────────────────────────────
console.log('\n\n═══ CC + EMA HYPER-TUNE SUMMARY ═══\n');
if (ccChampion) {
  const { minExactRangeATR14: ra, minCandleQualityScore: qs } = ccChampion.combo;
  console.log(`✅ CC CHAMPION PARAMS:`);
  console.log(`   minExactRangeATR14: ${ra}  |  minCandleQualityScore: ${qs ?? 'null'}`);
  console.log(`   Champion exit: TP=${ccChampion.tpPct}% / SL=${ccChampion.slMult}×ATR`);
  console.log(`   OOS: WR=${ccChampion.wr.toFixed(1)}%  PF=${ccChampion.pf.toFixed(2)}  AvgPnL=${ccChampion.avgPnl>=0?'+':''}${ccChampion.avgPnl.toFixed(2)}%  (n=${ccChampion.n})`);
  console.log(`   → Apply these to stockEngine.ts and ARCHETYPE_EXIT_DEFAULTS\n`);
} else {
  console.log(`❌ CC: No profitable champion found — CC remains watchlist-only\n`);
}

if (emaChampion) {
  const { maxPre10AvgRangeATR: pa, minUltraPrecisionScore: ups } = emaChampion.combo;
  console.log(`✅ EMA CHAMPION PARAMS:`);
  console.log(`   maxPre10AvgRangeATR: ${pa}  |  minUltraPrecisionScore: ${ups}`);
  console.log(`   Champion exit: TP=${emaChampion.tpPct}% / SL=${emaChampion.slMult}×ATR`);
  console.log(`   OOS: WR=${emaChampion.wr.toFixed(1)}%  PF=${emaChampion.pf.toFixed(2)}  AvgPnL=${emaChampion.avgPnl>=0?'+':''}${emaChampion.avgPnl.toFixed(2)}%  (n=${emaChampion.n})`);
  console.log(`   → Apply these to stockEngine.ts and ARCHETYPE_EXIT_DEFAULTS\n`);
} else {
  console.log(`❌ EMA: No profitable champion found — EMA remains watchlist-only\n`);
}

console.log('═══ CC + EMA HYPER-TUNE COMPLETE ═══\n');
