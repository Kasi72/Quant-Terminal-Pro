// ═══════════════════════════════════════════════════════════════════════════════
// FULL BACKTEST — 1980 STOCKS × 5 YEARS × 5 PARAM SETS
// Multi-threaded (worker_threads). Uses the compiled production engine.
// ═══════════════════════════════════════════════════════════════════════════════
//
// STEP 1 — Compile the engine (run once, re-run after lib/ changes):
//   node_modules/.bin/tsc lib/stockEngine.ts lib/statsEngine.ts lib/candlePatterns.ts ^
//     --target ES2020 --module CommonJS --outDir scripts/_compiled ^
//     --esModuleInterop --skipLibCheck --moduleResolution node --strict false
//
// STEP 2 — Run the backtest:
//   node scripts/fullBacktest1980.js
//
// CONFIGURATION — edit the section below:
//   DATA_DIR    : folder containing your CSV files
//   N_WORKERS   : parallel threads (default = CPU cores − 1)
//   DATE_FROM   : ignore candles before this date (YYYY-MM-DD)
//   STOP_PCT    : hard stop loss %  (default 7)
//   T1_PCT      : first target %    (default 5)
//   T2_PCT      : second target %   (default 10)
//   T3_PCT      : third target %    (default 15)
//   MAX_HOLD    : time stop in days (default 20)
//
// OUTPUT:
//   scripts/backtest1980_results.json  — full per-trade detail
//   scripts/backtest1980_summary.txt   — human-readable report
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const DATA_DIR  = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORKERS = 8;
const DATE_FROM = '2019-01-01';   // ignore candles before this date
const STOP_PCT  = 7;              // −7% hard stop
const T1_PCT    = 5;              // +5% T1
const T2_PCT    = 10;             // +10% T2
const T3_PCT    = 15;             // +15% T3
const MAX_HOLD  = 20;             // exit at close of day 20 if not hit

const ENGINE_DIR   = path.join(__dirname, '_compiled');
const RESULTS_FILE = path.join(__dirname, 'backtest1980_results.json');
const SUMMARY_FILE = path.join(__dirname, 'backtest1980_summary.txt');

const PARAM_SET_KEYS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];

const PARAM_SET_LABELS = {
  optimized_deployable_20plus:    'Deployable',
  optimized_highprecision_15plus: 'HiPrec',
  optimized_elite_10plus:         'Elite',
  optimized_ultraselective_8plus: 'Ultra',
  sniper_95plus:                  'Sniper',
};

const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

// ─── WORKER THREAD ───────────────────────────────────────────────────────────

if (!isMainThread) {
  const { files, config } = workerData;
  const { analyzeStock } = require(path.join(config.engineDir, 'stockEngine.js'));

  // ── CSV parser — handles both YYYY-MM-DD and DD-Mon-YYYY formats ──
  const MONTH_MAP = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  function parseDate(s) {
    s = s.trim();
    // DD-Mon-YYYY  e.g. 29-Jun-2021
    if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
      const [d, mon, y] = s.split('-');
      const iso = `${y}-${String((MONTH_MAP[mon]??0)+1).padStart(2,'0')}-${d.padStart(2,'0')}`;
      return { iso, ts: Math.floor(new Date(iso).getTime() / 1000) };
    }
    // YYYY-MM-DD
    const ts = Math.floor(new Date(s).getTime() / 1000);
    return { iso: s, ts: isNaN(ts) ? 0 : ts };
  }

  function parseCSV(fp) {
    const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const iDate  = header.indexOf('date');
    const iOpen  = header.indexOf('open');
    const iHigh  = header.indexOf('high');
    const iLow   = header.indexOf('low');
    const iClose = header.findIndex(h => h === 'close' || h === 'adj close');
    const iVol   = header.findIndex(h => h === 'volume');
    if (iClose < 0 || iVol < 0) return [];

    const candles = [];
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split(',');
      const raw = p[iDate]?.trim() ?? '';
      const { iso, ts } = parseDate(raw);
      if (iso < config.dateFrom) continue;   // string compare on YYYY-MM-DD
      if (ts === 0) continue;
      const c = +p[iClose], o = +p[iOpen] || c, h = +p[iHigh] || c, l = +p[iLow] || c;
      const v = +p[iVol] || 0;
      if (isNaN(c) || c <= 0) continue;
      candles.push({ ts, date: iso, o, h, l, c, v });
    }
    return candles;
  }

  // ── Trade simulator ──────────────────────────────────────────────────────
  function simulateTrade(candles, entryBarIdx, cfg) {
    if (entryBarIdx >= candles.length) return null;
    const entryBar   = candles[entryBarIdx];
    const entryPrice = entryBar.o > 0 ? entryBar.o : entryBar.c; // use open of entry day
    if (entryPrice <= 0) return null;

    const stop = entryPrice * (1 - cfg.stopPct / 100);
    const t1   = entryPrice * (1 + cfg.t1Pct  / 100);
    const t2   = entryPrice * (1 + cfg.t2Pct  / 100);
    const t3   = entryPrice * (1 + cfg.t3Pct  / 100);

    let t1Hit = false, t2Hit = false;
    let trailStop = stop; // rises to entry after T1, to T1 after T2

    for (let d = 0; d < cfg.maxHold; d++) {
      const ci = entryBarIdx + d;
      if (ci >= candles.length) {
        // Ran out of data — treat as time stop on last available close
        const lastClose = candles[candles.length - 1].c;
        const closePct  = (lastClose - entryPrice) / entryPrice * 100;
        if (t2Hit) return { pnl: 0.5*cfg.t1Pct + 0.3*cfg.t2Pct + 0.2*closePct, exitType:'time_t2', days:d };
        if (t1Hit) return { pnl: 0.5*cfg.t1Pct + 0.5*closePct, exitType:'time_t1', days:d };
        return { pnl: closePct, exitType:'time', days:d };
      }

      const bar  = candles[ci];
      const open = bar.o > 0 ? bar.o : bar.c;

      // ── Gap-down open through trail stop ──
      if (open <= trailStop) {
        const fillPct = (open - entryPrice) / entryPrice * 100;
        if (t2Hit) return { pnl: 0.5*cfg.t1Pct + 0.3*cfg.t2Pct + 0.2*fillPct, exitType:'stop_gap_t2', days:d };
        if (t1Hit) return { pnl: 0.5*cfg.t1Pct + 0.5*fillPct, exitType:'stop_gap_t1', days:d };
        return { pnl: fillPct, exitType:'stop_gap', days:d };
      }

      // ── Intraday stop hit ──
      if (bar.l <= trailStop) {
        const fillPct = (trailStop - entryPrice) / entryPrice * 100;
        if (t2Hit) return { pnl: 0.5*cfg.t1Pct + 0.3*cfg.t2Pct + 0.2*fillPct, exitType:'stop_t2', days:d };
        if (t1Hit) return { pnl: 0.5*cfg.t1Pct + 0.5*fillPct,  exitType:'stop_t1', days:d };
        return { pnl: (trailStop - entryPrice) / entryPrice * 100, exitType:'stop', days:d };
      }

      // ── T3 hit ──
      if (t2Hit && bar.h >= t3) {
        return { pnl: 0.5*cfg.t1Pct + 0.3*cfg.t2Pct + 0.2*cfg.t3Pct, exitType:'t3', days:d+1 };
      }

      // ── T2 hit ──
      if (t1Hit && !t2Hit && bar.h >= t2) {
        t2Hit = true;
        trailStop = t1; // trail to T1 after T2
      }

      // ── T1 hit ──
      if (!t1Hit && bar.h >= t1) {
        t1Hit = true;
        trailStop = entryPrice; // trail to breakeven after T1
      }

      // ── Time stop (last allowed day) ──
      if (d === cfg.maxHold - 1) {
        const closePct = (bar.c - entryPrice) / entryPrice * 100;
        if (t2Hit) return { pnl: 0.5*cfg.t1Pct + 0.3*cfg.t2Pct + 0.2*closePct, exitType:'time_t2', days:d+1 };
        if (t1Hit) return { pnl: 0.5*cfg.t1Pct + 0.5*closePct, exitType:'time_t1', days:d+1 };
        return { pnl: closePct, exitType:'time', days:d+1 };
      }
    }
    return null;
  }

  // ── Process each file ────────────────────────────────────────────────────
  const tradesByParamSet = {};
  for (const key of PARAM_SET_KEYS) tradesByParamSet[key] = [];

  let processed = 0;
  for (const fp of files) {
    const sym     = path.basename(fp).replace(/_NS_OHLCV\.csv$/,'').replace(/\.csv$/,'');
    const candles = parseCSV(fp);
    if (candles.length < 100) { processed++; continue; }

    for (const key of PARAM_SET_KEYS) {
      let i = 60;
      while (i < candles.length - 1) {
        let r;
        try { r = analyzeStock(candles.slice(0, i + 1), key); } catch { i++; continue; }

        if (ACTIONABLE.has(r.stage)) {
          const trade = simulateTrade(candles, i + 1, {
            stopPct: config.stopPct, t1Pct: config.t1Pct,
            t2Pct: config.t2Pct, t3Pct: config.t3Pct, maxHold: config.maxHold,
          });
          if (trade) {
            tradesByParamSet[key].push({
              sym, date: candles[i].date, stage: r.stage,
              entryPrice: candles[i+1]?.o || candles[i].c,
              ...trade,
            });
            i += config.maxHold; // skip to avoid overlapping trades
            continue;
          }
        }
        i++;
      }
    }
    processed++;
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', done: processed, total: files.length });
  }

  parentPort.postMessage({ type: 'done', tradesByParamSet });
  return;
}

// ─── MAIN THREAD ─────────────────────────────────────────────────────────────

console.log('═'.repeat(80));
console.log('  FULL BACKTEST — 1980 STOCKS × 5 YEARS × 5 PARAM SETS');
console.log('═'.repeat(80));
console.log();

// ── Guard: compiled engine must exist ──
if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js'))) {
  console.error('❌  Compiled engine not found. Run this first:\n');
  console.error('  node_modules/.bin/tsc lib/stockEngine.ts lib/statsEngine.ts lib/candlePatterns.ts ^');
  console.error('    --target ES2020 --module CommonJS --outDir scripts/_compiled ^');
  console.error('    --esModuleInterop --skipLibCheck --moduleResolution node --strict false\n');
  process.exit(1);
}

// ── Guard: DATA_DIR must exist ──
if (!fs.existsSync(DATA_DIR)) {
  console.error(`❌  Data directory not found: ${DATA_DIR}`);
  console.error('    Edit the DATA_DIR constant at the top of this script.\n');
  process.exit(1);
}

const startTime = Date.now();

// ── Load all CSV files ──
const allFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS') && !f.toLowerCase().includes('_all'))
  .map(f => path.join(DATA_DIR, f));

console.log(`📁  Data directory : ${DATA_DIR}`);
console.log(`📊  CSV files found: ${allFiles.length}`);
console.log(`⚙️   Workers        : ${N_WORKERS}`);
console.log(`📅  Date range     : ${DATE_FROM} → today`);
console.log(`🎯  Stop / T1 / T2 / T3 : −${STOP_PCT}% / +${T1_PCT}% / +${T2_PCT}% / +${T3_PCT}%`);
console.log(`⏱   Time stop      : day ${MAX_HOLD}`);
console.log();

// ── Split files into chunks (one per worker) ──
const chunks = Array.from({ length: N_WORKERS }, () => []);
allFiles.forEach((f, i) => chunks[i % N_WORKERS].push(f));

const workerConfig = {
  engineDir: ENGINE_DIR, dateFrom: DATE_FROM,
  stopPct: STOP_PCT, t1Pct: T1_PCT, t2Pct: T2_PCT, t3Pct: T3_PCT, maxHold: MAX_HOLD,
};

// ── Spawn workers ──
let progressDone = 0;
const progressTotal = allFiles.length;
let lastPrint = 0;

function printProgress() {
  const pct = (progressDone / progressTotal * 100).toFixed(1);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const eta = progressDone > 0
    ? Math.round((Date.now() - startTime) / progressDone * (progressTotal - progressDone) / 1000)
    : '?';
  process.stdout.write(`\r  Progress: ${progressDone}/${progressTotal} (${pct}%)  elapsed ${elapsed}s  ETA ~${eta}s   `);
}

const allTradesByParamSet = {};
for (const key of PARAM_SET_KEYS) allTradesByParamSet[key] = [];

let workersFinished = 0;
const workerPromises = chunks.map((chunk, wi) => new Promise((resolve, reject) => {
  if (chunk.length === 0) { workersFinished++; resolve(); return; }
  const w = new Worker(__filename, { workerData: { files: chunk, config: workerConfig } });
  w.on('message', msg => {
    if (msg.type === 'progress') {
      progressDone += msg.done - (wi === 0 ? 0 : 0); // rough
      progressDone = Math.min(progressDone + msg.done, progressTotal);
      const now = Date.now();
      if (now - lastPrint > 500) { printProgress(); lastPrint = now; }
    } else if (msg.type === 'done') {
      for (const key of PARAM_SET_KEYS) {
        allTradesByParamSet[key].push(...(msg.tradesByParamSet[key] || []));
      }
      workersFinished++;
      resolve();
    }
  });
  w.on('error', reject);
  w.on('exit', code => { if (code !== 0) reject(new Error(`Worker ${wi} exited with code ${code}`)); });
}));

// ── Wait for all workers ──
console.log('🚀  Starting parallel backtest...\n');
Promise.all(workerPromises).then(() => {
  progressDone = progressTotal;
  printProgress();
  console.log('\n');

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`✅  All workers done in ${elapsed} minutes.\n`);

  // ── Aggregate results ─────────────────────────────────────────────────────

  const lines = [];
  const push  = s => { lines.push(s); console.log(s); };

  push('═'.repeat(80));
  push('  BACKTEST RESULTS — ALL 5 PARAM SETS');
  push('═'.repeat(80));
  push(`  Stocks: ${allFiles.length}  ·  Period: ${DATE_FROM} → today  ·  Engine: production`);
  push(`  Stop: −${STOP_PCT}%  ·  T1: +${T1_PCT}%  ·  T2: +${T2_PCT}%  ·  T3: +${T3_PCT}%  ·  Time stop: day ${MAX_HOLD}`);
  push('');

  const summaryByKey = {};

  for (const key of PARAM_SET_KEYS) {
    const trades = allTradesByParamSet[key];
    const label  = PARAM_SET_LABELS[key];
    if (trades.length === 0) { push(`  ${label}: no trades found`); continue; }

    // ── Core stats ──
    const wins    = trades.filter(t => t.pnl > 0);
    const losses  = trades.filter(t => t.pnl <= 0);
    const winRate = wins.length / trades.length * 100;
    const avgPnl  = trades.reduce((s, t) => s + t.pnl, 0) / trades.length;
    const avgWin  = wins.length  > 0 ? wins.reduce((s,t) => s+t.pnl,0)/wins.length  : 0;
    const avgLoss = losses.length> 0 ? losses.reduce((s,t)=>s+t.pnl,0)/losses.length: 0;
    const grossW  = wins.reduce((s,t)=>s+t.pnl,0);
    const grossL  = Math.abs(losses.reduce((s,t)=>s+t.pnl,0));
    const profitF = grossL > 0 ? (grossW / grossL) : Infinity;

    // Exit type breakdown
    const byExit = {};
    for (const t of trades) byExit[t.exitType] = (byExit[t.exitType] || 0) + 1;

    // Avg days held
    const avgDays = trades.reduce((s,t)=>s+t.days,0) / trades.length;

    // Max consecutive losses
    let maxConsecL = 0, consecL = 0;
    for (const t of trades) {
      if (t.pnl <= 0) { consecL++; maxConsecL = Math.max(maxConsecL, consecL); }
      else consecL = 0;
    }

    // Year breakdown
    const byYear = {};
    for (const t of trades) {
      const yr = (t.date || '').slice(0, 4);
      if (!byYear[yr]) byYear[yr] = [];
      byYear[yr].push(t);
    }

    // IS / OOS split (first 60% = IS, last 40% = OOS)
    const isCut = Math.floor(trades.length * 0.6);
    const isTrades  = trades.slice(0, isCut);
    const oosTrades = trades.slice(isCut);
    const isWR   = isTrades.length  > 0 ? isTrades.filter(t=>t.pnl>0).length/isTrades.length*100   : 0;
    const oosWR  = oosTrades.length > 0 ? oosTrades.filter(t=>t.pnl>0).length/oosTrades.length*100 : 0;
    const isAvg  = isTrades.length  > 0 ? isTrades.reduce((s,t)=>s+t.pnl,0)/isTrades.length        : 0;
    const oosAvg = oosTrades.length > 0 ? oosTrades.reduce((s,t)=>s+t.pnl,0)/oosTrades.length      : 0;

    // Per-stage breakdown within param set
    const byStage = {};
    for (const t of trades) byStage[t.stage] = (byStage[t.stage]||[]).concat(t);

    summaryByKey[key] = { label, trades: trades.length, winRate, avgPnl, avgWin, avgLoss, profitF, avgDays, maxConsecL, byYear, byExit, isWR, oosWR, isAvg, oosAvg };

    push(`${'─'.repeat(80)}`);
    push(`  📊 ${label.padEnd(16)} n=${String(trades.length).padStart(5)}  WR=${winRate.toFixed(1)}%  avgP&L=${avgPnl>=0?'+':''}${avgPnl.toFixed(2)}%  PF=${profitF === Infinity ? '∞' : profitF.toFixed(2)}  avgDays=${avgDays.toFixed(1)}`);
    push(`     avgWin=${avgWin>=0?'+':''}${avgWin.toFixed(2)}%  avgLoss=${avgLoss.toFixed(2)}%  maxConsecL=${maxConsecL}`);
    push(`     IS WR=${isWR.toFixed(1)}% avg=${isAvg>=0?'+':''}${isAvg.toFixed(2)}%  →  OOS WR=${oosWR.toFixed(1)}% avg=${oosAvg>=0?'+':''}${oosAvg.toFixed(2)}%`);

    // Exit breakdown
    const exitStr = Object.entries(byExit).map(([k,v]) => `${k}:${v}`).join('  ');
    push(`     Exits → ${exitStr}`);

    // Stage breakdown
    const stageStr = Object.entries(byStage).map(([k,v]) => {
      const wr = v.filter(t=>t.pnl>0).length/v.length*100;
      return `${k}(n=${v.length} WR=${wr.toFixed(0)}%)`;
    }).join('  ');
    push(`     Stages → ${stageStr}`);

    // Year breakdown
    push(`     Year breakdown:`);
    for (const [yr, yTrades] of Object.entries(byYear).sort()) {
      const yWR  = yTrades.filter(t=>t.pnl>0).length/yTrades.length*100;
      const yAvg = yTrades.reduce((s,t)=>s+t.pnl,0)/yTrades.length;
      push(`       ${yr}: n=${String(yTrades.length).padStart(4)}  WR=${yWR.toFixed(1)}%  avg=${yAvg>=0?'+':''}${yAvg.toFixed(2)}%`);
    }
    push('');
  }

  // ── Cross-param comparison ────────────────────────────────────────────────
  push('═'.repeat(80));
  push('  CROSS-PARAM COMPARISON (sorted by OOS win rate)');
  push('═'.repeat(80));
  push(`  ${'Param Set'.padEnd(16)} ${'n'.padStart(6)} ${'WR%'.padStart(6)} ${'AvgP&L'.padStart(8)} ${'PF'.padStart(6)} ${'IS WR'.padStart(7)} ${'OOS WR'.padStart(8)} ${'ΔWR'.padStart(6)}`);
  push(`  ${'─'.repeat(70)}`);
  const sorted = Object.values(summaryByKey).sort((a,b)=>b.oosWR-a.oosWR);
  for (const s of sorted) {
    const delta = s.oosWR - s.isWR;
    push(`  ${s.label.padEnd(16)} ${String(s.trades).padStart(6)} ${s.winRate.toFixed(1).padStart(6)} ${(s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2)+'%'.padStart(8)} ${(s.profitF===Infinity?'∞':s.profitF.toFixed(2)).padStart(6)} ${s.isWR.toFixed(1).padStart(7)} ${s.oosWR.toFixed(1).padStart(8)} ${(delta>=0?'+':'')+delta.toFixed(1).padStart(6)}`);
  }

  push('');
  push('  ΔWR = OOS − IS  (positive = generalized, not overfit)');
  push('');
  push(`  Total run time : ${elapsed} minutes`);
  push(`  Results saved  : ${RESULTS_FILE}`);
  push(`  Summary saved  : ${SUMMARY_FILE}`);
  push('═'.repeat(80));

  // ── Write output files ────────────────────────────────────────────────────
  fs.writeFileSync(SUMMARY_FILE, lines.join('\n'), 'utf8');
  fs.writeFileSync(RESULTS_FILE, JSON.stringify({
    meta: {
      dataDir: DATA_DIR, stockCount: allFiles.length, dateFrom: DATE_FROM,
      stopPct: STOP_PCT, t1Pct: T1_PCT, t2Pct: T2_PCT, t3Pct: T3_PCT, maxHold: MAX_HOLD,
      runAt: new Date().toISOString(), elapsed: `${elapsed}m`,
    },
    summary: summaryByKey,
    trades:  allTradesByParamSet,
  }, null, 2), 'utf8');

  console.log(`\n📄  Summary → ${SUMMARY_FILE}`);
  console.log(`📦  Full trades → ${RESULTS_FILE}`);

}).catch(err => {
  console.error('\n❌  Worker error:', err.message);
  process.exit(1);
});
