'use strict';
/**
 * 5% Hit-Rate Backtest
 *
 * Objective: measure whether screener signals actually produce stocks capable
 * of a +5% momentum move — independent of realized exit P&L.
 *
 * Entry : next-bar open (same as live pipeline)
 * Stop  : archetypePriceEngine tacticalStop, clamped [3.5%, 6.5%] off entry
 * Target: +5% from entry open
 * Window: 20 bars max hold
 *
 * Primary metrics per archetype:
 *   Hit5_10  — % of trades reaching +5% within 10 bars before stop
 *   Hit5_20  — % of trades reaching +5% within 20 bars before stop
 *   Hit5_any — % of trades reaching +5% at any point before stop fires
 *   MedMFE   — median max favorable excursion over 20 bars (%)
 *   AvgMAE   — average max adverse excursion BEFORE reaching +5% (%)
 *              (for winners only — shows how much drawdown you endure)
 *   AvgDays  — average bars to reach +5% (winners only)
 *   PF_5pct  — profit factor: all trades exit at +5% (win) or stop (loss)
 *
 * Also splits IS / OOS (same 70/30 chronological split as other backtests).
 */

const fs      = require('fs');
const path    = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { analyzeStock } = require('./_compiled_current/stockEngine.js');

// ── Constants ──────────────────────────────────────────────────────────────
const WINDOW     = 300;
const MAX_HOLD   = 20;
const TARGET_PCT = 5.0;          // primary target %
const OOS_DATE   = '2025-05-05'; // same cutoff as other backtests
const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  'ors_prime_reversal',
];
const LABELS = {
  'optimized_deployable_20plus':    'VolumeFootprint',
  'optimized_highprecision_15plus': 'CompressionCoil',
  'optimized_elite_10plus':         'MomentumPocket',
  'optimized_ultraselective_8plus': 'EMAStack',
  'sniper_95plus':                  'PerfectStorm',
  'ors_prime_reversal':             'ORS-Prime',
};
const BUY_STAGES = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);
const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORKERS  = 10;

// ── Date helpers ───────────────────────────────────────────────────────────
const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseNSEDate(s) {
  s = s.trim();
  if (s.includes('-')) {
    const p = s.split('-');
    if (p.length === 3) {
      if (p[0].length === 4) return Date.UTC(+p[0], +p[1]-1, +p[2]);
      const m = MON[p[1]];
      if (m !== undefined) return Date.UTC(+p[2], m, +p[0]);
    }
  }
  const d = new Date(s); return isNaN(d.getTime()) ? 0 : d.getTime();
}

function parseNSE(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6) continue;
    const c = +p[4]; if (!c || c <= 0) continue;
    out.push({ ts: parseNSEDate(p[0]), o: +p[1], h: +p[2], l: +p[3], c, v: +p[5] || 0 });
  }
  return out;
}

// ── Per-trade simulation ───────────────────────────────────────────────────
function simulateTrade(candles, sigIdx, initStop) {
  const eIdx = sigIdx + 1;
  if (eIdx >= candles.length - 1) return null;

  const ep  = candles[eIdx].o;
  if (!ep || ep <= 0) return null;

  // Stop clamped [3.5%, 6.5%] off entry open (matches archetypePriceEngine)
  const rawStop = initStop;
  const floorStop = ep * (1 - 3.5 / 100);
  const capStop   = ep * (1 - 6.5 / 100);
  const stop = Math.min(floorStop, Math.max(capStop, rawStop));

  const target = ep * (1 + TARGET_PCT / 100);

  let hitTarget = false;
  let hitStop   = false;
  let barsToTarget = null;
  let mfe = 0;
  let maeBeforeTarget = 0;   // only tracked until target is hit or stop fires
  let targetReached = false;

  for (let b = 1; b <= MAX_HOLD; b++) {
    const idx = eIdx + b;
    if (idx >= candles.length) break;
    const bar = candles[idx];

    // Track MFE (% above entry)
    const barHigh = (bar.h - ep) / ep * 100;
    if (barHigh > mfe) mfe = barHigh;

    if (!targetReached) {
      // Track MAE before target (% below entry low)
      const barLow = (ep - bar.l) / ep * 100;
      if (barLow > maeBeforeTarget) maeBeforeTarget = barLow;
    }

    // Stop check (intrabar low)
    if (bar.l <= stop) {
      hitStop = true;
      break;
    }

    // Target check (intrabar high)
    if (bar.h >= target) {
      hitTarget = true;
      targetReached = true;
      barsToTarget = b;
      break;
    }
  }

  const riskPct  = (ep - stop) / ep * 100;
  const hit10    = hitTarget && barsToTarget !== null && barsToTarget <= 10;
  const hit20    = hitTarget;
  const stopLoss = !hitTarget ? (ep - stop) / ep * 100 : 0; // % loss if stopped

  return {
    ep, stop, riskPct,
    hitTarget, hitStop, hit10, hit20,
    barsToTarget,
    mfe,
    maeBeforeTarget: hitTarget ? maeBeforeTarget : null, // only for winners
    stopLoss,
    // For PF_5pct: win = hitTarget (+5%), loss = stopped at -riskPct%
    pnl: hitTarget ? TARGET_PCT : (hitStop ? -riskPct : 0),
    win: hitTarget,
  };
}

// ── Aggregate stats ────────────────────────────────────────────────────────
function aggregate(trades) {
  if (!trades.length) return null;
  const n        = trades.length;
  const hit5Any  = trades.filter(t => t.hit20).length;
  const hit5_10  = trades.filter(t => t.hit10).length;
  const hit5_20  = trades.filter(t => t.hit20).length;
  const winners  = trades.filter(t => t.hitTarget);
  const losers   = trades.filter(t => t.hitStop && !t.hitTarget);

  const mfes = trades.map(t => t.mfe).sort((a,b) => a-b);
  const medMFE = mfes.length ? mfes[Math.floor(mfes.length/2)] : 0;
  const avgMFE = mfes.reduce((a,b)=>a+b,0) / (mfes.length||1);

  const maes = winners.filter(t=>t.maeBeforeTarget!==null).map(t=>t.maeBeforeTarget);
  const avgMAE = maes.length ? maes.reduce((a,b)=>a+b,0)/maes.length : 0;

  const days = winners.filter(t=>t.barsToTarget!==null).map(t=>t.barsToTarget);
  const avgDays = days.length ? days.reduce((a,b)=>a+b,0)/days.length : 0;
  const medDays = days.length ? [...days].sort((a,b)=>a-b)[Math.floor(days.length/2)] : 0;

  // PF using binary 5%/stop exit
  const grossWin  = winners.reduce((s,t) => s + TARGET_PCT, 0);
  const grossLoss = losers.reduce((s,t) => s + t.riskPct, 0);
  const pf5 = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 999 : 0);

  const avgRisk = trades.reduce((s,t)=>s+t.riskPct,0)/n;

  return {
    n,
    hit5_10_pct:  (hit5_10 / n * 100).toFixed(1),
    hit5_20_pct:  (hit5_20 / n * 100).toFixed(1),
    hit5_any_pct: (hit5Any / n * 100).toFixed(1),
    medMFE:       medMFE.toFixed(2),
    avgMFE:       avgMFE.toFixed(2),
    avgMAE_winners: avgMAE.toFixed(2),
    avgDays:      avgDays.toFixed(1),
    medDays:      medDays.toFixed(0),
    pf5:          pf5.toFixed(2),
    avgRisk:      avgRisk.toFixed(2),
    nWinners:     winners.length,
    nLosers:      losers.length,
    nOpen:        n - winners.length - losers.length,
  };
}

// ── Worker thread ──────────────────────────────────────────────────────────
if (!isMainThread) {
  const { files, oosTs } = workerData;
  const results = {};
  for (const ps of PARAM_SETS) results[ps] = { all: [], is: [], oos: [] };

  for (const fp of files) {
    const all = parseNSE(fp);
    if (all.length < WINDOW + MAX_HOLD + 5) continue;

    const lastTrade = {}; // ps → last signal idx (non-overlapping)

    for (let i = WINDOW; i < all.length - MAX_HOLD - 2; i++) {
      for (const ps of PARAM_SETS) {
        const lt = lastTrade[ps] ?? -1;
        if (i <= lt) continue; // still in a prior trade

        const win = all.slice(i - WINDOW, i + 1);
        let res;
        try { res = analyzeStock(win, ps); } catch { continue; }
        if (!res || !BUY_STAGES.has(res.stage)) continue;

        const stop = res.priceEngine?.tacticalStop ?? all[i].c * 0.95;
        const trade = simulateTrade(all, i, stop);
        if (!trade) continue;

        // Advance last-trade pointer past exit
        const exitBar = i + 1 + (trade.barsToTarget ?? (trade.hitStop ? MAX_HOLD : MAX_HOLD));
        lastTrade[ps] = exitBar;

        const bucket = all[i].ts < oosTs ? 'is' : 'oos';
        results[ps].all.push(trade);
        results[ps][bucket].push(trade);
      }
    }
  }
  parentPort.postMessage(results);
  process.exit(0);
}

// ── Main thread ────────────────────────────────────────────────────────────
const allFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv') && f !== 'ALL_SYMBOLS_OHLCV.csv')
  .map(f => path.join(DATA_DIR, f));

const oosTs = parseNSEDate(OOS_DATE);
const chunks = Array.from({ length: N_WORKERS }, (_, i) =>
  allFiles.filter((_, j) => j % N_WORKERS === i));

console.log(`5% Hit-Rate Backtest`);
console.log(`Data: ${DATA_DIR}`);
console.log(`Files: ${allFiles.length} | workers: ${N_WORKERS} | window: ${WINDOW} | max-hold: ${MAX_HOLD} bars | target: +${TARGET_PCT}% | OOS cutoff: ${OOS_DATE}\n`);

const combined = {};
for (const ps of PARAM_SETS) combined[ps] = { all: [], is: [], oos: [] };

let done = 0;
const workers = chunks.map(files => new Promise((resolve, reject) => {
  const w = new Worker(__filename, { workerData: { files, oosTs } });
  w.on('message', data => {
    for (const ps of PARAM_SETS) {
      combined[ps].all.push(...data[ps].all);
      combined[ps].is.push(...data[ps].is);
      combined[ps].oos.push(...data[ps].oos);
    }
    done += files.length;
    process.stdout.write(`  processed ${done}/${allFiles.length}\r`);
    resolve();
  });
  w.on('error', reject);
}));

Promise.all(workers).then(() => {
  console.log('\n');

  // Print results
  const hdr = [
    'Route'.padEnd(18),
    'N'.padStart(5),
    'Hit5/10'.padStart(8), 'Hit5/20'.padStart(8), 'Hit5/Any'.padStart(9),
    'MedMFE'.padStart(8), 'AvgMFE'.padStart(8),
    'MAE@win'.padStart(8), 'AvgDays'.padStart(8), 'MedDays'.padStart(8),
    'PF_5%'.padStart(7), 'AvgRisk'.padStart(8),
    '|',
    'OOS N'.padStart(6), 'H5/10'.padStart(7), 'H5/20'.padStart(7),
    'MedMFE'.padStart(8), 'PF_5%'.padStart(7),
  ].join('  ');

  console.log(hdr);
  console.log('─'.repeat(hdr.length));

  const rows = [];
  for (const ps of PARAM_SETS) {
    const label = LABELS[ps];
    const all = aggregate(combined[ps].all);
    const oos = aggregate(combined[ps].oos);
    if (!all) continue;

    const row = [
      label.padEnd(18),
      String(all.n).padStart(5),
      (all.hit5_10_pct + '%').padStart(8),
      (all.hit5_20_pct + '%').padStart(8),
      (all.hit5_any_pct + '%').padStart(9),
      (all.medMFE + '%').padStart(8),
      (all.avgMFE + '%').padStart(8),
      (all.avgMAE_winners + '%').padStart(8),
      all.avgDays.padStart(8),
      all.medDays.padStart(8),
      all.pf5.padStart(7),
      (all.avgRisk + '%').padStart(8),
      '|',
      oos ? String(oos.n).padStart(6) : '     -',
      oos ? (oos.hit5_10_pct + '%').padStart(7) : '      -',
      oos ? (oos.hit5_20_pct + '%').padStart(7) : '      -',
      oos ? (oos.medMFE + '%').padStart(8) : '       -',
      oos ? oos.pf5.padStart(7) : '      -',
    ].join('  ');

    console.log(row);
    rows.push({ ps, label, all, oos: oos ?? null });
  }

  console.log('\nNotes:');
  console.log('  Hit5/10  = reached +5% target within 10 bars (before stop)');
  console.log('  Hit5/20  = reached +5% target within 20 bars (before stop)');
  console.log('  Hit5/Any = reached +5% at any point in 20-bar window before stop fires');
  console.log('  MAE@win  = avg max adverse excursion BEFORE +5% hit (winners only)');
  console.log('  AvgDays  = avg bars to reach +5% (winners only)');
  console.log('  PF_5%    = profit factor: wins exit at +5%, losses exit at -stop%');
  console.log('  Stop is clamped [3.5%, 6.5%] off next-day open (engine stop)\n');

  // Save JSON
  const tag = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  const outJson = path.join(__dirname, 'results', `fivepct_hitrate_${tag}.json`);
  const outTxt  = path.join(__dirname, 'results', `fivepct_hitrate_${tag}.txt`);
  fs.writeFileSync(outJson, JSON.stringify({ generated: new Date().toISOString(), rows }, null, 2));
  fs.writeFileSync(outTxt, [hdr, '─'.repeat(hdr.length),
    ...rows.map(r => [
      r.label.padEnd(18),
      String(r.all.n).padStart(5),
      (r.all.hit5_10_pct+'%').padStart(8), (r.all.hit5_20_pct+'%').padStart(8), (r.all.hit5_any_pct+'%').padStart(9),
      (r.all.medMFE+'%').padStart(8), (r.all.avgMFE+'%').padStart(8),
      (r.all.avgMAE_winners+'%').padStart(8), r.all.avgDays.padStart(8), r.all.medDays.padStart(8),
      r.all.pf5.padStart(7), (r.all.avgRisk+'%').padStart(8),
      '|',
      r.oos ? String(r.oos.n).padStart(6) : '     -',
      r.oos ? (r.oos.hit5_10_pct+'%').padStart(7) : '      -',
      r.oos ? (r.oos.hit5_20_pct+'%').padStart(7) : '      -',
      r.oos ? (r.oos.medMFE+'%').padStart(8) : '       -',
      r.oos ? r.oos.pf5.padStart(7) : '      -',
    ].join('  '))
  ].join('\n'));

  console.log(`JSON → ${outJson}`);
  console.log(`TXT  → ${outTxt}`);
});
