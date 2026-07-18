'use strict';

// Full-universe, exact-live-pipeline backtest for the six screener routes.
// Signal generation is delegated to the compiled stockEngine dispatcher.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OUT_DIR = path.join(__dirname, 'results');
const WINDOW = 300;             // enough history for the 252-bar drawdown feature
const STEP = 1;                 // every daily bar
const OOS_CUT = '2025-05-05';    // fixed chronological 70/30-style split
const BUY = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
const KEYS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  'ors_prime_reversal',
];
const LABEL = {
  optimized_deployable_20plus: 'VolumeFootprint',
  optimized_highprecision_15plus: 'CompressionCoil',
  optimized_elite_10plus: 'MomentumPocket',
  optimized_ultraselective_8plus: 'EMAStack',
  sniper_95plus: 'PerfectStorm',
  ors_prime_reversal: 'ORS-Prime',
};

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = Number(p[1]), h = Number(p[2]), l = Number(p[3]);
    const c = Number(p[4]), v = Number(p[5]);
    if (!Number.isFinite(ts) || ![o, h, l, c, v].every(Number.isFinite)) continue;
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < l) continue;
    out.push({ ts: Math.floor(ts / 1000), o, h, l, c, v: Math.max(0, v) });
  }
  out.sort((a, b) => a.ts - b.ts);
  const dedup = [];
  for (const bar of out) {
    if (dedup.length && dedup[dedup.length - 1].ts === bar.ts) dedup[dedup.length - 1] = bar;
    else dedup.push(bar);
  }
  return dedup;
}

function dateOf(ts) {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function wilson(wins, n) {
  if (!n) return 0;
  const z = 1.96;
  const p = wins / n;
  const z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

function simTrade(candles, sigIdx, result, key) {
  const entryIdx = sigIdx + 1;
  if (entryIdx >= candles.length) return null;
  const entry = candles[entryIdx].o;
  if (!(entry > 0)) return null;

  const ors = key === 'ors_prime_reversal';
  const maxHold = ors ? 15 : 20;
  const targetPct = ors ? 4 : 5;
  const riskAbsRaw = Number(result?.priceEngine?.riskPerShare);
  const riskAbs = Number.isFinite(riskAbsRaw) && riskAbsRaw > 0 ? riskAbsRaw : entry * (ors ? 0.04 : 0.05);
  const stop = Math.max(0, entry - riskAbs);
  const target = entry * (1 + targetPct / 100);
  let exitIdx = Math.min(candles.length - 1, entryIdx + maxHold - 1);
  let exitPrice = candles[exitIdx].c;
  let reason = 'TIME';

  // Stop-first convention when a daily OHLC bar touches both stop and target.
  for (let idx = entryIdx; idx <= exitIdx; idx++) {
    const bar = candles[idx];
    if (bar.o <= stop) {
      exitIdx = idx; exitPrice = bar.o; reason = 'STOP_GAP'; break;
    }
    if (bar.l <= stop) {
      exitIdx = idx; exitPrice = stop; reason = 'STOP'; break;
    }
    if (bar.h >= target) {
      exitIdx = idx; exitPrice = target; reason = 'TARGET'; break;
    }
    if (idx === exitIdx) {
      exitPrice = bar.c;
      reason = 'TIME';
    }
  }

  const pnl = (exitPrice - entry) / entry * 100;
  const hit = (horizon) => {
    const end = Math.min(candles.length - 1, entryIdx + horizon - 1);
    for (let idx = entryIdx; idx <= end; idx++) if (candles[idx].h >= entry * 1.03) return true;
    return false;
  };
  const hit5 = (horizon) => {
    const end = Math.min(candles.length - 1, entryIdx + horizon - 1);
    for (let idx = entryIdx; idx <= end; idx++) if (candles[idx].h >= entry * 1.05) return true;
    return false;
  };
  const hit10 = (horizon) => {
    const end = Math.min(candles.length - 1, entryIdx + horizon - 1);
    for (let idx = entryIdx; idx <= end; idx++) if (candles[idx].h >= entry * 1.10) return true;
    return false;
  };
  const excursion = (horizon, adverse) => {
    const end = Math.min(candles.length - 1, entryIdx + horizon - 1);
    let value = adverse ? 0 : 0;
    for (let idx = entryIdx; idx <= end; idx++) {
      const x = adverse ? (candles[idx].l - entry) / entry * 100 : (candles[idx].h - entry) / entry * 100;
      value = adverse ? Math.min(value, x) : Math.max(value, x);
    }
    return value;
  };

  return {
    signalDate: dateOf(candles[sigIdx].ts),
    entryDate: dateOf(candles[entryIdx].ts),
    signalIdx: sigIdx,
    exitIdx,
    entry,
    exitPrice,
    pnl,
    win: pnl > 0,
    reason,
    hit3_10: hit(10),
    hit3_20: hit(20),
    hit5_10: hit5(10),
    hit5_20: hit5(20),
    hit10_20: hit10(20),
    mfe10: excursion(10, false),
    mfe20: excursion(20, false),
    mae10: excursion(10, true),
    mae20: excursion(20, true),
  };
}

function stats(trades) {
  const n = trades.length;
  if (!n) return { n: 0, wins: 0, wr: 0, wilson95: 0, avgPnl: 0, medianPnl: 0, pf: 0, avgMFE10: 0, avgMFE20: 0, avgMAE10: 0, avgMAE20: 0, hit3_10: 0, hit3_20: 0, hit5_10: 0, hit5_20: 0, hit10_20: 0 };
  const wins = trades.filter(t => t.win).length;
  const sum = (k) => trades.reduce((a, t) => a + Number(t[k] || 0), 0);
  const positives = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const negatives = Math.abs(trades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0));
  const sorted = trades.map(t => t.pnl).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    n, wins,
    wr: wins / n * 100,
    wilson95: wilson(wins, n) * 100,
    avgPnl: sum('pnl') / n,
    medianPnl: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    pf: negatives > 0 ? positives / negatives : Infinity,
    avgMFE10: sum('mfe10') / n,
    avgMFE20: sum('mfe20') / n,
    avgMAE10: sum('mae10') / n,
    avgMAE20: sum('mae20') / n,
    hit3_10: trades.filter(t => t.hit3_10).length / n * 100,
    hit3_20: trades.filter(t => t.hit3_20).length / n * 100,
    hit5_10: trades.filter(t => t.hit5_10).length / n * 100,
    hit5_20: trades.filter(t => t.hit5_20).length / n * 100,
    hit10_20: trades.filter(t => t.hit10_20).length / n * 100,
  };
}

function filesIn(dir) {
  return fs.readdirSync(dir)
    .filter(name => name.toLowerCase().endsWith('.csv') && name !== 'ALL_SYMBOLS_OHLCV.csv')
    .sort()
    .map(name => ({ name, fp: path.join(dir, name) }));
}

function makeAccumulator() {
  const out = {};
  for (const key of KEYS) out[key] = { signals: 0, skippedNoTrade: 0, stageCounts: {}, trades: [] };
  return out;
}

function mergeAcc(dst, src) {
  for (const key of KEYS) {
    dst[key].signals += src[key].signals;
    dst[key].skippedNoTrade += src[key].skippedNoTrade;
    for (const [stage, n] of Object.entries(src[key].stageCounts)) dst[key].stageCounts[stage] = (dst[key].stageCounts[stage] || 0) + n;
    dst[key].trades.push(...src[key].trades);
  }
}

async function runWorker() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const acc = makeAccumulator();
  let processed = 0, usable = 0, skippedShort = 0;
  for (const file of workerData.files) {
    let candles;
    try { candles = parseCSV(file.fp); } catch { processed++; continue; }
    processed++;
    if (candles.length < WINDOW + 2) { skippedShort++; continue; }
    usable++;
    const nextAllowed = Object.fromEntries(KEYS.map(k => [k, -1]));
    for (let i = WINDOW - 1; i < candles.length - 1; i += STEP) {
      const window = candles.slice(i - WINDOW + 1, i + 1);
      for (const key of KEYS) {
        if (i < nextAllowed[key]) continue;
        let result;
        // Signal stages are decided inside the archetype dispatchers. Skip only
        // post-processing enrichment here; the live/default call remains unchanged.
        try { result = engine.analyzeStock(window, key, false); } catch { continue; }
        if (!result || !BUY.has(result.stage)) continue;
        const a = acc[key];
        a.signals++;
        a.stageCounts[result.stage] = (a.stageCounts[result.stage] || 0) + 1;
        const trade = simTrade(candles, i, result, key);
        if (!trade) { a.skippedNoTrade++; continue; }
        trade.symbol = file.name.replace(/_OHLCV\.csv$/i, '');
        trade.stage = result.stage;
        trade.score = result.inflectionScore;
        trade.conditionsMet = result.conditionsMet;
        trade.oos = trade.signalDate > OOS_CUT;
        a.trades.push(trade);
        nextAllowed[key] = trade.exitIdx + 1;
      }
    }
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }
  parentPort.postMessage({ type: 'done', acc, meta: { processed, usable, skippedShort } });
}

function fmt(x, digits = 2) {
  if (x === Infinity) return 'Inf';
  return Number.isFinite(x) ? x.toFixed(digits) : 'n/a';
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) throw new Error(`Data directory not found: ${DATA_DIR}`);
  if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js'))) throw new Error(`Compiled engine not found: ${ENGINE_DIR}`);
  const files = filesIn(DATA_DIR);
  const workerCount = Math.min(Math.max(1, Number(process.env.WORKERS || 10)), files.length || 1);
  const chunks = Array.from({ length: workerCount }, () => []);
  files.forEach((f, i) => chunks[i % workerCount].push(f));
  console.log(`Data: ${DATA_DIR}`);
  console.log(`Files: ${files.length} | workers: ${workerCount} | window: ${WINDOW} | step: ${STEP} | OOS cutoff: ${OOS_CUT}`);
  console.log('Convention: exact analyzeStock dispatcher, next-day open entry, non-overlapping per symbol/set, stop-first, full-position target/time exit');
  console.log('Breakout routes: 5% target, 2×ATR-equivalent engine risk, 20-bar max hold; ORS: declared 4% target, declared 2×ATR risk, 15-bar max hold.\n');

  const combined = makeAccumulator();
  let doneFiles = 0, usable = 0, skippedShort = 0;
  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { files: chunk } });
    worker.on('message', msg => {
      if (msg.type === 'progress') {
        doneFiles += msg.n;
        if (doneFiles % 100 === 0) process.stdout.write(`  processed ${doneFiles}/${files.length}\r`);
      } else if (msg.type === 'done') {
        mergeAcc(combined, msg.acc);
        usable += msg.meta.usable;
        skippedShort += msg.meta.skippedShort;
        resolve();
      }
    });
    worker.on('error', reject);
    worker.on('exit', code => { if (code) reject(new Error(`worker exited ${code}`)); });
  })));

  const result = {};
  for (const key of KEYS) {
    const all = combined[key].trades;
    const oos = all.filter(t => t.oos);
    const is = all.filter(t => !t.oos);
    result[key] = {
      label: LABEL[key],
      signals: combined[key].signals,
      skippedNoTrade: combined[key].skippedNoTrade,
      stageCounts: combined[key].stageCounts,
      all: stats(all),
      is: stats(is),
      oos: stats(oos),
    };
  }

  const lines = [];
  lines.push('SIX-ARCHETYPE EXACT LIVE-PIPELINE BACKTEST');
  lines.push(`Data: ${DATA_DIR}`);
  lines.push(`Files: ${files.length}; usable: ${usable}; skipped short: ${skippedShort}`);
  lines.push(`Window=${WINDOW}; every bar; OOS cutoff=${OOS_CUT}`);
  lines.push('Entry/exit: next-day open; stop-first; non-overlapping per symbol and route.');
  lines.push('');
  lines.push('Route              N       WR   Wilson   AvgPnL   PF   MFE20   MAE20  Hit3/10 Hit5/20 Hit10/20 | OOS N  OOS WR OOS Avg OOS PF');
  lines.push('-'.repeat(135));
  for (const key of KEYS) {
    const r = result[key], a = r.all, o = r.oos;
    lines.push(`${r.label.padEnd(18)} ${String(a.n).padStart(5)} ${fmt(a.wr,1).padStart(6)} ${fmt(a.wilson95,1).padStart(8)} ${fmt(a.avgPnl).padStart(8)} ${fmt(a.pf).padStart(5)} ${fmt(a.avgMFE20).padStart(7)} ${fmt(a.avgMAE20).padStart(7)} ${fmt(a.hit3_10,1).padStart(8)} ${fmt(a.hit5_20,1).padStart(8)} ${fmt(a.hit10_20,1).padStart(9)} | ${String(o.n).padStart(5)} ${fmt(o.wr,1).padStart(7)} ${fmt(o.avgPnl).padStart(8)} ${fmt(o.pf).padStart(6)}`);
  }
  lines.push('');
  lines.push('WR = net P&L > 0%; Wilson = 95% lower confidence bound. MFE/MAE are average maximum excursions over 20 bars.');
  lines.push('Hit rates are independent reach rates, not necessarily closed profitable trades.');
  lines.push('');
  for (const key of KEYS) {
    const r = result[key];
    lines.push(`${r.label}: signals=${r.signals}; executed=${r.all.n}; stages=${JSON.stringify(r.stageCounts)}`);
  }
  console.log(lines.join('\n'));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUT_DIR, `six_archetype_exact_backtest_${stamp}.json`);
  const txtPath = path.join(OUT_DIR, `six_archetype_exact_backtest_${stamp}.txt`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify({ meta: { dataDir: DATA_DIR, files: files.length, usable, skippedShort, window: WINDOW, step: STEP, oosCut: OOS_CUT, engineDir: ENGINE_DIR, generated: new Date().toISOString() }, result }, null, 2));
  fs.writeFileSync(txtPath, lines.join('\n'));
  console.log(`\nJSON: ${jsonPath}\nTXT: ${txtPath}`);
}

if (isMainThread) main().catch(err => { console.error(err.stack || err); process.exit(1); });
else runWorker().catch(err => { parentPort.postMessage({ type: 'error', error: err.stack || String(err) }); process.exit(1); });
