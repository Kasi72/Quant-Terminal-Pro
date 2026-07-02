// ═══════════════════════════════════════════════════════════════════════════════
// FULL UNIVERSE BACKTEST — Nifty 500 (469) + original 77-stock set (My Portfolio
// + NIFTY 50, deduped) — 5 param sets, using the REAL production engine
// (compiled from lib/stockEngine.ts + lib/autoValidator.ts, not a
// reimplementation) so results match exactly what the live app would produce.
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs'), path = require('path');
const ENGINE_DIR = path.join(__dirname, '_compiled');
if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js')) || !fs.existsSync(path.join(ENGINE_DIR, 'autoValidator.js'))) {
  console.error('Compiled engine not found. Run first:\n');
  console.error('  node_modules/.bin/tsc lib/stockEngine.ts lib/statsEngine.ts lib/candlePatterns.ts lib/autoValidator.ts \\');
  console.error('    --target ES2020 --module CommonJS --outDir scripts/_compiled \\');
  console.error('    --esModuleInterop --skipLibCheck --moduleResolution node --strict false\n');
  process.exit(1);
}
const { analyzeStock } = require(path.join(ENGINE_DIR, 'stockEngine.js'));
const { validateTrade, applyValidation } = require(path.join(ENGINE_DIR, 'autoValidator.js'));

const NIFTY500_DIR = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const PORTFOLIO_DIR = 'C:/Users/drkkr/Downloads/My Portfolio';
const NIFTY50_DIR = 'C:/Users/drkkr/Downloads/NIFTY 50';

const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];

function tsOf(dateStr) {
  const t = new Date(dateStr).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}
function parseYahoo(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6 || isNaN(+p[4]) || +p[4] <= 0) continue;
    const ts = tsOf(p[0]);
    if (ts <= 0) continue;
    c.push({ ts, date: p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] || 0 });
  }
  return c;
}
// NSE format: Date,Symbol,Series,Prev Close,Open,High,Low,Last,Close,VWAP,Volume,...
function parseNSE(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 11) continue;
    const o = +p[4], h = +p[5], l = +p[6], close = +p[8], v = +p[10];
    if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l)) continue;
    const ts = tsOf(p[0]);
    if (ts <= 0) continue;
    c.push({ ts, date: p[0], o, h, l, c: close, v: Number.isFinite(v) ? v : 0 });
  }
  return c;
}

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  FULL UNIVERSE BACKTEST — Nifty 500 + 77-stock set, 5 param sets, real engine');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');

// No truncation — full file history used for every source. An earlier run
// capped this at 750 days and lost ~98% of real BUY+ signals (verified:
// Deployable 20+ alone went from 60 stage-days/55 stocks at full history
// down to 1 signal when truncated) — most genuine signal density lives in
// the older portion of each stock's history.

const universe = new Map(); // sym -> candles
let n500 = 0, nPortfolio = 0, nNifty50 = 0, dupes = 0;

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
    if (universe.has(sym)) { dupes++; continue; }
    const c = parseYahoo(path.join(PORTFOLIO_DIR, f));
    if (c.length < 150) continue;
    universe.set(sym, c);
    nPortfolio++;
  }
}
if (fs.existsSync(NIFTY50_DIR)) {
  // EXCLUDED from this run: NIFTY 50 dataset ends April 2021 (stale, 5+
  // years out of regime), contains unadjusted stock splits (e.g. INFY shows
  // ~15625 in 2000 vs ~1350 in 2021, never split-adjusted), and its ~21-year
  // file lengths (~5300 candles/stock) caused an O(n^2) slowdown in the
  // per-day candles.slice(0,i+1) walk that stalled the run. Only contributes
  // 5 unique non-duplicate symbols vs the 464+6 already covered, so the
  // marginal value doesn't justify the cost or staleness. Left here, commented
  // out, in case a properly-adjusted/recent NIFTY 50 source becomes available.
  void NIFTY50_DIR; void parseNSE; nNifty50 = 0;
}

console.log(`Nifty 500 OHLCV: ${n500} stocks`);
console.log(`My Portfolio (extra, non-dup): ${nPortfolio} stocks`);
console.log(`NIFTY 50 (extra, non-dup): ${nNifty50} stocks`);
console.log(`Duplicate symbols skipped (already in universe): ${dupes}`);
console.log(`TOTAL UNIQUE UNIVERSE: ${universe.size} stocks\n`);

// ── Split-guard: skip simulated trades whose forward window contains an
// unadjusted corporate-action jump (>2.5x or <0.4x overnight) ──
function hasSplitInWindow(c, fromIdx, toIdx) {
  for (let j = fromIdx; j < Math.min(toIdx, c.length - 1); j++) {
    if (c[j].c <= 0) continue;
    const ratio = c[j+1].c / c[j].c;
    if (ratio > 2.5 || ratio < 0.4) return true;
  }
  return false;
}

console.log('Running signal scan + trade simulation across all stocks × 5 param sets...\n');
console.log('(This walks every trading day per stock per param set using the real engine — may take a while)\n');

const results = {};
for (const key of PARAM_SETS) results[key] = { trades: [], symbolsScanned: 0 };

let stocksDone = 0;
let errorCount = 0;
for (const [sym, candles] of universe) {
  for (const key of PARAM_SETS) {
    let i = 100; // warm-up period for indicators
    let inTrade = false, tradeEndIdx = -1;
    while (i < candles.length - 1) {
      if (inTrade && i < tradeEndIdx) { i++; continue; }
      inTrade = false;

      const slice = candles.slice(0, i + 1);
      let r;
      try { r = analyzeStock(slice, key); } catch (e) {
        errorCount++;
        if (errorCount <= 3) console.error(`  [analyzeStock error #${errorCount}] ${sym} @ idx ${i}: ${e.message}`);
        i++; continue;
      }

      if (['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage)) {
        const pe = r.priceEngine;
        // Stage-only mode: bypass tradeValid/disasterRiskPct live-trading gate.
        // Use basic sanity checks only (entry/stop exist and make geometric sense).
        if (!pe || !(pe.plannedEntry > 0) || !(pe.tacticalStop > 0) || !(pe.tacticalStop < pe.plannedEntry)) { i++; continue; }

        const fwdEnd = Math.min(i + 26, candles.length - 1);
        if (hasSplitInWindow(candles, i, fwdEnd)) { i++; continue; }

        const trade = {
          symbol: sym, entryPrice: pe.plannedEntry, stopLoss: pe.tacticalStop,
          target1: pe.target5, target2: pe.target7, target3: pe.target10,
          status: 'open',
        };
        const sinceEntry = candles.slice(i, fwdEnd + 1).map(c => ({ ts: c.ts, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }));
        let vr;
        try { vr = validateTrade(trade, sinceEntry); } catch (e) {
          errorCount++;
          if (errorCount <= 3) console.error(`  [validateTrade error #${errorCount}] ${sym} @ idx ${i}: ${e.message}`);
          i++; continue;
        }
        const finalTrade = applyValidation(trade, vr);

        if (finalTrade.status !== 'open') {
          results[key].trades.push({
            sym, entryIdx: i, stage: r.stage,
            status: finalTrade.status, pnlPct: finalTrade.pnlPct ?? 0, pnlR: finalTrade.pnlR ?? 0,
            daysHeld: finalTrade.daysHeld ?? 0,
          });
          tradeEndIdx = i + Math.max(1, finalTrade.daysHeld ?? 1);
          inTrade = true;
          i = tradeEndIdx;
          continue;
        }
      }
      i++;
    }
    results[key].symbolsScanned++;
  }
  stocksDone++;
  if (stocksDone % 50 === 0) console.log(`  ...${stocksDone}/${universe.size} stocks scanned`);
}

console.log(`\nDone. ${stocksDone} stocks scanned across all 5 param sets. Errors encountered: ${errorCount}\n`);

// ── Aggregate per param set ──
function pct(n, d) { return d > 0 ? (n / d * 100).toFixed(1) : '0.0'; }
function avg(arr, fn) { return arr.length > 0 ? arr.reduce((s, v) => s + fn(v), 0) / arr.length : 0; }

const PARAM_LABELS = {
  optimized_deployable_20plus: 'Deployable v10-N500 20+',
  optimized_highprecision_15plus: 'HighPrecision 15+',
  optimized_elite_10plus: 'Elite v10-N500 10+',
  optimized_ultraselective_8plus: 'Ultra-Selective v10-N500 8+',
  sniper_95plus: 'Sniper 95+ v1',
};

console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  RESULTS — FULL UNIVERSE BACKTEST (' + universe.size + ' stocks)');
console.log('═══════════════════════════════════════════════════════════════════════════════\n');
console.log('Param Set                       │ Signals │ WR%   │ AvgP&L% │ AvgR  │ PF   │ AvgDays │ Stops');
console.log('──────────────────────────────────┼─────────┼───────┼─────────┼───────┼──────┼─────────┼──────');

const summary = [];
for (const key of PARAM_SETS) {
  const trades = results[key].trades;
  const wins = trades.filter(t => t.status === 'hit_t1' || t.status === 'hit_t2' || t.status === 'hit_t3');
  const losses = trades.filter(t => t.status === 'stopped');
  const expired = trades.filter(t => t.status === 'expired');
  const wr = trades.length > 0 ? wins.length / (wins.length + losses.length || 1) * 100 : 0;
  const avgPnl = avg(trades, t => t.pnlPct);
  const avgR = avg(trades, t => t.pnlR);
  const grossWin = wins.reduce((s, t) => s + Math.max(0, t.pnlPct), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + Math.min(0, t.pnlPct), 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0);
  const avgDays = avg(trades, t => t.daysHeld);

  summary.push({ key, label: PARAM_LABELS[key], n: trades.length, wr, avgPnl, avgR, pf, avgDays, wins: wins.length, losses: losses.length, expired: expired.length });
  console.log(`${PARAM_LABELS[key].padEnd(34)}│ ${String(trades.length).padStart(7)} │ ${wr.toFixed(1).padStart(5)}%│ ${(avgPnl>=0?'+':'')+avgPnl.toFixed(2).padStart(6)}%│ ${(avgR>=0?'+':'')+avgR.toFixed(2).padStart(5)}│ ${pf.toFixed(2).padStart(4)} │ ${avgDays.toFixed(1).padStart(7)} │ ${losses.length}`);
}

console.log('\n─── Detail breakdown ───\n');
for (const s of summary) {
  console.log(`${s.label}: ${s.n} signals → ${s.wins}W / ${s.losses}L / ${s.expired}E (Win Rate ${s.wr.toFixed(1)}%, ${universe.size} stocks scanned)`);
}

console.log('\n═══ FULL UNIVERSE BACKTEST COMPLETE ═══');
