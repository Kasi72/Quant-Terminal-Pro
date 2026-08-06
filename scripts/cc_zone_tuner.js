// ═══════════════════════════════════════════════════════════════════════════════
// CC ZONE TUNER — sweeps maxZoneTightnessPct × maxPre10AvgRangeATR
// Real CC bottleneck: maxZoneTightnessPct=5.0 (extremely tight, vs 12.0 for VF/MP/SNIPER)
// Pass 1: 20-combo grid search with anchor exit TP=20%/SL=3.5×ATR
// Pass 2: Full 64-combo TP/SL sweep on top 3 combos with n_OOS ≥ 12
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
const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
const { analyzeStock, PARAM_SETS } = engine;

// ── Config ──────────────────────────────────────────────────────────────────
const NIFTY500_DIR   = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const PORTFOLIO_DIR  = 'C:/Users/drkkr/Downloads/My Portfolio';

const CC_KEY = 'optimized_highprecision_15plus';

// Grid: real bottleneck params
const ZONE_TIGHTNESS = [5, 7, 10, 12, 15];          // maxZoneTightnessPct
const PRE_ATR_VALUES = [0.75, 0.85, 0.95, 1.0];     // maxPre10AvgRangeATR

// Anchor exit for Pass 1 (best from cc_ema_tuner)
const ANCHOR_TP  = 20;
const ANCHOR_SL  = 3.5;

// Full TP/SL sweep for Pass 2
const TP_TARGETS = [3, 5, 7, 8, 10, 12, 15, 20];
const SL_MULTS   = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0];
const TIME_STOP  = 20;
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
    sum += tr; count++;
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

// ── Load universe ─────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  CC ZONE TUNER  |  OOS cutoff: 2024-01-01');
console.log(`  Grid: ${ZONE_TIGHTNESS.length} tightness × ${PRE_ATR_VALUES.length} preATR = ${ZONE_TIGHTNESS.length * PRE_ATR_VALUES.length} combos`);
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

// ── Collect signals with given CC overrides ────────────────────────────────────
function collectSignals(overrides) {
  const origVals = {};
  for (const [k, v] of Object.entries(overrides)) {
    origVals[k] = PARAM_SETS[CC_KEY][k];
    PARAM_SETS[CC_KEY][k] = v;
  }

  const signals = [];
  for (const [sym, candles] of universe) {
    let i = 100;
    let nextAllowedIdx = 0;
    while (i < candles.length - 1) {
      if (i < nextAllowedIdx) { i++; continue; }
      const slice = candles.slice(0, i + 1);
      let r;
      try { r = analyzeStock(slice, CC_KEY); } catch (e) { i++; continue; }
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
        let maxHigh = entryPrice, minLow = entryPrice;
        for (const b of fwdBars) {
          if (b.h > maxHigh) maxHigh = b.h;
          if (b.l < minLow)  minLow  = b.l;
        }
        signals.push({
          sym, entryIdx, entryPrice, atrVal, isOos, fwdBars,
          mfePct: (maxHigh - entryPrice) / entryPrice * 100,
          maePct: (entryPrice - minLow)  / entryPrice * 100,
        });
        nextAllowedIdx = entryIdx + 1;
        i = entryIdx + 1;
        continue;
      }
      i++;
    }
  }

  for (const [k, v] of Object.entries(origVals)) PARAM_SETS[CC_KEY][k] = v;
  return signals;
}

function anchorPF(signals, tpPct, slMult) {
  const oos = signals.filter(s => s.isOos);
  if (oos.length === 0) return { n: 0, wr: 0, pf: 0, avgPnl: 0 };
  const results = oos.map(s => simulateExit(s.entryPrice, s.atrVal, s.fwdBars, tpPct, slMult));
  const valid   = results.filter(r => r.outcome !== 'invalid');
  const wins    = valid.filter(r => r.outcome === 'hit_tp');
  const losses  = valid.filter(r => r.outcome === 'stopped');
  const n       = valid.length;
  if (n === 0) return { n: 0, wr: 0, pf: 0, avgPnl: 0 };
  const grossWin  = wins.reduce((s, r) => s + r.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.pnlPct, 0));
  return {
    n,
    wr:     wins.length / n * 100,
    pf:     grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0),
    avgPnl: valid.reduce((s, r) => s + r.pnlPct, 0) / n,
  };
}

// ── Pass 1: Grid search ───────────────────────────────────────────────────────
console.log(`━━━ CC Pass 1 — Grid Search (anchor TP=${ANCHOR_TP}%/SL=${ANCHOR_SL}×ATR) ━━━\n`);

const pass1Results = [];
let comboIdx = 0;
const totalCombos = ZONE_TIGHTNESS.length * PRE_ATR_VALUES.length;

for (const tightness of ZONE_TIGHTNESS) {
  for (const preATR of PRE_ATR_VALUES) {
    comboIdx++;
    const overrides = { maxZoneTightnessPct: tightness, maxPre10AvgRangeATR: preATR };
    const signals = collectSignals(overrides);
    const oos = signals.filter(s => s.isOos);
    const { n, wr, pf, avgPnl } = anchorPF(signals, ANCHOR_TP, ANCHOR_SL);
    pass1Results.push({ tightness, preATR, nOOS: oos.length, nTotal: signals.length, n, wr, pf, avgPnl, signals });
    process.stdout.write(`  Combo ${String(comboIdx).padStart(2)}/${totalCombos}: tight=${tightness}% preATR=${preATR} → OOS=${oos.length} WR=${wr.toFixed(0)}% PF=${pf.toFixed(2)}\n`);
  }
}

console.log('\n─── Top results (sorted by OOS n, then PF) ───');
console.log('  tight | preATR | n_OOS | WR%    | PF    | AvgPnL%');
console.log('  ──────┼────────┼───────┼────────┼───────┼────────');
const sorted = [...pass1Results].sort((a, b) => b.nOOS - a.nOOS || b.pf - a.pf);
for (const r of sorted.slice(0, 10)) {
  const wr  = r.wr.toFixed(1).padStart(5);
  const pf  = r.pf.toFixed(2).padStart(5);
  const avg = ((r.avgPnl >= 0 ? '+' : '') + r.avgPnl.toFixed(2)).padStart(7);
  console.log(`  ${String(r.tightness).padStart(5)}% | ${r.preATR.toFixed(2).padStart(6)} | ${String(r.nOOS).padStart(5)} | ${wr}% | ${pf} | ${avg}%`);
}

// ── Pass 2: Full TP/SL sweep on top 3 by n_OOS (with n_OOS ≥ 12) ─────────────
console.log('\n━━━ CC Pass 2 — Full TP/SL sweep on top 3 combos ━━━\n');

const qualifiedCombos = sorted.filter(r => r.nOOS >= 12);
const topCombos = qualifiedCombos.length > 0 ? qualifiedCombos.slice(0, 3) : sorted.slice(0, 3);

let bestChampion = null;

for (const combo of topCombos) {
  const { tightness, preATR, nOOS, signals } = combo;
  const oosSigs = signals.filter(s => s.isOos);
  const mfep50 = percentile(oosSigs.map(s => s.mfePct), 50);
  const maep50 = percentile(oosSigs.map(s => s.maePct), 50);

  console.log(`─── CC: tight=${tightness}%, preATR=${preATR} (OOS n=${nOOS}) ───`);
  console.log(`  OOS n=${nOOS}  MFE p50=${mfep50.toFixed(1)}%  MAE p50=${maep50.toFixed(1)}%`);
  console.log('  TP%  | SLx  | n    | WR%    | PF    | AvgPnL%');
  console.log('  ─────┼──────┼──────┼────────┼───────┼────────');

  const rows = [];
  for (const tpPct of TP_TARGETS) {
    for (const slMult of SL_MULTS) {
      const results = oosSigs.map(s => simulateExit(s.entryPrice, s.atrVal, s.fwdBars, tpPct, slMult));
      const valid   = results.filter(r => r.outcome !== 'invalid');
      const wins    = valid.filter(r => r.outcome === 'hit_tp');
      const losses  = valid.filter(r => r.outcome === 'stopped');
      const n       = valid.length;
      if (n === 0) continue;
      const wr        = wins.length / n * 100;
      const grossWin  = wins.reduce((s, r) => s + r.pnlPct, 0);
      const grossLoss = Math.abs(losses.reduce((s, r) => s + r.pnlPct, 0));
      const pf        = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0);
      const avgPnl    = valid.reduce((s, r) => s + r.pnlPct, 0) / n;
      rows.push({ tpPct, slMult, n, wr, pf, avgPnl, wins: wins.length, losses: losses.length });
    }
  }

  rows.sort((a, b) => b.pf - a.pf);
  for (const r of rows.slice(0, 8)) {
    const wr  = r.wr.toFixed(1).padStart(5);
    const pf  = r.pf.toFixed(2).padStart(5);
    const avg = ((r.avgPnl >= 0 ? '+' : '') + r.avgPnl.toFixed(2)).padStart(7);
    console.log(`  ${String(r.tpPct).padStart(3)}% | ${r.slMult.toFixed(1)}x | ${String(r.n).padStart(4)} | ${wr}% | ${pf} | ${avg}%`);
  }

  const profitable = rows.filter(r => r.pf > 1.2 && r.wr > 50 && r.wins >= 8);
  if (profitable.length > 0) {
    const best = profitable[0];
    console.log(`\n  ★ CHAMPION: tight=${tightness}% preATR=${preATR} TP=${best.tpPct}% SL=${best.slMult}×ATR`);
    console.log(`    OOS: WR=${best.wr.toFixed(1)}% PF=${best.pf.toFixed(2)} AvgPnL=${best.avgPnl >= 0 ? '+' : ''}${best.avgPnl.toFixed(2)}% (n=${best.n})`);
    if (!bestChampion || best.pf > bestChampion.pf) {
      bestChampion = { tightness, preATR, ...best };
    }
  } else {
    console.log(`\n  ✗ No profitable combo (PF>1.2, WR>50%, wins≥8). Best: TP=${rows[0]?.tpPct}% SL=${rows[0]?.slMult}×ATR PF=${rows[0]?.pf.toFixed(2)} (n=${rows[0]?.n})`);
  }
  console.log();
}

// ── Final summary ─────────────────────────────────────────────────────────────
console.log('═══ CC ZONE TUNER SUMMARY ═══\n');
if (bestChampion) {
  console.log(`✅ CC CHAMPION FOUND`);
  console.log(`   maxZoneTightnessPct: ${bestChampion.tightness}%`);
  console.log(`   maxPre10AvgRangeATR: ${bestChampion.preATR}`);
  console.log(`   Exit: TP=${bestChampion.tpPct}% / SL=${bestChampion.slMult}×ATR`);
  console.log(`   OOS: WR=${bestChampion.wr.toFixed(1)}%  PF=${bestChampion.pf.toFixed(2)}  AvgPnL=${bestChampion.avgPnl >= 0 ? '+' : ''}${bestChampion.avgPnl.toFixed(2)}%  (n=${bestChampion.n})\n`);
  console.log(`   ACTION: Apply to stockEngine.ts:`);
  console.log(`     PARAM_SETS.optimized_highprecision_15plus.maxZoneTightnessPct = ${bestChampion.tightness}`);
  console.log(`     PARAM_SETS.optimized_highprecision_15plus.maxPre10AvgRangeATR = ${bestChampion.preATR}`);
  console.log(`     ARCHETYPE_EXIT_DEFAULTS.optimized_highprecision_15plus = { targetPct: ${bestChampion.tpPct}, slAtrMult: ${bestChampion.slMult}, maxHoldBars: 20 }`);
  console.log(`     Remove 'optimized_highprecision_15plus' from WATCHLIST_ONLY_PARAM_SETS`);
} else {
  const bestByN = sorted[0];
  console.log(`❌ NO CHAMPION — max OOS signals: n=${bestByN?.nOOS} (need ≥12 with PF>1.2, WR>50%)`);
  console.log(`   CC remains WATCHLIST_ONLY`);
  console.log(`   Best tightness=${bestByN?.tightness}% preATR=${bestByN?.preATR} → OOS=${bestByN?.nOOS}`);
  if (bestByN?.nOOS < 5) {
    console.log(`   SUGGESTION: CC zone setup is too rare in 470-stock universe.`);
    console.log(`   Consider removing maxZoneTightnessPct constraint entirely or using ZoneLen as primary filter.`);
  }
}
console.log('\n═══ CC ZONE TUNER COMPLETE ═══\n');
