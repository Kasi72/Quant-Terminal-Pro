'use strict';

// Exact-live validation of P&L candidates. Detection is delegated to the
// compiled stockEngine; only the candidate's exit convention is simulated here.

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const WINDOW = 300;
const OOS_CUT = '2025-05-05';
const BUY = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
const OUT_DIR = path.join(__dirname, 'results');

const CANDIDATES = [
  {
    id: 'VolumeFootprint', key: 'optimized_deployable_20plus',
    p: { minVolRatio: 4.7, minCloseLoc: 89, maxUpperWick: 12, minHi20Frac: 0.91, minRangeATR: 1.6, maxGapDownPct: -2.1, requireDIBull: true, maxBsc: 5, minADX: 15, maxCandleRisk: 8, tpPct: 4, slAtrMult: 2.5, maxHoldBars: 25 }
  },
  {
    id: 'CompressionCoil', key: 'optimized_highprecision_15plus',
    // No positive full+OOS candidate survived the approximate sweep. Keep the
    // production detector as the honest comparison row.
    p: { productionBaseline: true, tpPct: 5, slAtrMult: 2, maxHoldBars: 20 }
  },
  {
    id: 'MomentumPocket', key: 'optimized_elite_10plus',
    p: { minDd52W: 28, maxDd52W: 48, minStabBars: 5, minCloseLoc: 76, minBodyPct: 33, maxUpperWick: 44, minVolRatio: 1.6, minRSI14: 14, maxRSI14: 45, requireDIBull: false, maxBsc: 5, minADX: 0, tpPct: 4, slAtrMult: 2.5, maxHoldBars: 15 }
  },
  {
    id: 'EMAStack', key: 'optimized_ultraselective_8plus',
    p: { minBelowBars: 3, minEMA10VsEma20: 0.3, minBodyPct: 63, maxUpperWick: 20, maxCandleRisk: 9, minVolRatio: 1.1, maxRSI2Last5: 27, requireDIBull: true, maxBsc: 99, minADX: 20, tpPct: 7, slAtrMult: 3, maxHoldBars: 15 }
  },
  {
    id: 'PerfectStorm', key: 'sniper_95plus',
    p: { minFires: 3, minADXGate: 45, minQualityTier: 2, maxCandleRisk: 12, tpPct: 5, slAtrMult: 3, maxHoldBars: 15 }
  },
];

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = Number(p[1]), h = Number(p[2]), l = Number(p[3]), c = Number(p[4]), v = Number(p[5]);
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

function dateOf(ts) { return new Date(ts * 1000).toISOString().slice(0, 10); }

function atr14At(candles, endIdx) {
  if (endIdx < 1) return candles[endIdx]?.c * 0.02 || 0;
  const start = Math.max(1, endIdx - 13);
  let sum = 0, n = 0;
  for (let i = start; i <= endIdx; i++) {
    const prev = candles[i - 1].c;
    sum += Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - prev), Math.abs(candles[i].l - prev));
    n++;
  }
  return n ? sum / n : candles[endIdx].c * 0.02;
}

function simTrade(candles, sigIdx, p) {
  const entryIdx = sigIdx + 1;
  if (entryIdx >= candles.length) return null;
  const entry = candles[entryIdx].o;
  if (!(entry > 0)) return null;
  const atr = atr14At(candles, sigIdx) || entry * 0.02;
  const stop = entry - p.slAtrMult * atr;
  const target = entry * (1 + p.tpPct / 100);
  const exitIdxLimit = Math.min(candles.length - 1, entryIdx + p.maxHoldBars - 1);
  let exitIdx = exitIdxLimit, exitPrice = candles[exitIdx].c, reason = 'TIME';
  for (let i = entryIdx; i <= exitIdxLimit; i++) {
    const b = candles[i];
    if (b.o <= stop) { exitIdx = i; exitPrice = b.o; reason = 'STOP_GAP'; break; }
    if (b.l <= stop) { exitIdx = i; exitPrice = stop; reason = 'STOP'; break; }
    if (b.h >= target) { exitIdx = i; exitPrice = target; reason = 'TARGET'; break; }
    if (i === exitIdxLimit) { exitIdx = i; exitPrice = b.c; }
  }
  const pnl = (exitPrice - entry) / entry * 100;
  const excursion = (adverse, horizon) => {
    const end = Math.min(candles.length - 1, entryIdx + horizon - 1);
    let x = 0;
    for (let i = entryIdx; i <= end; i++) {
      const v = (adverse ? candles[i].l : candles[i].h) / entry * 100 - 100;
      x = adverse ? Math.min(x, v) : Math.max(x, v);
    }
    return x;
  };
  return {
    signalDate: dateOf(candles[sigIdx].ts), entryDate: dateOf(candles[entryIdx].ts),
    exitIdx, pnl, win: pnl > 0, reason,
    mfe10: excursion(false, 10), mfe20: excursion(false, 20), mae10: excursion(true, 10), mae20: excursion(true, 20),
  };
}

function empty() { return { signals: 0, skipped: 0, trades: [] }; }

function clearTuning(engine) {
  for (const c of CANDIDATES) engine.setArchetypeTuning(c.key, null);
}

function metrics(trades) {
  const n = trades.length;
  if (!n) return { n: 0, wins: 0, wr: 0, pf: 0, avgPnl: 0, avgMFE10: 0, avgMFE20: 0, avgMAE10: 0, avgMAE20: 0 };
  const wins = trades.filter(t => t.pnl > 0).length;
  const sum = k => trades.reduce((a, t) => a + (t[k] || 0), 0);
  const grossWin = trades.filter(t => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -trades.filter(t => t.pnl < 0).reduce((a, t) => a + t.pnl, 0);
  return { n, wins, wr: wins / n * 100, pf: grossLoss ? grossWin / grossLoss : Infinity, avgPnl: sum('pnl') / n, avgMFE10: sum('mfe10') / n, avgMFE20: sum('mfe20') / n, avgMAE10: sum('mae10') / n, avgMAE20: sum('mae20') / n };
}

function splitMetrics(trades) {
  const full = metrics(trades);
  const is = metrics(trades.filter(t => t.signalDate <= OOS_CUT));
  const oos = metrics(trades.filter(t => t.signalDate > OOS_CUT));
  return { full, is, oos };
}

async function workerMain() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const acc = Object.fromEntries(CANDIDATES.map(c => [c.id, empty()]));
  let processed = 0, usable = 0, skippedShort = 0;
  for (const file of workerData.files) {
    let candles;
    try { candles = parseCSV(file.fp); } catch { processed++; continue; }
    processed++;
    if (candles.length < WINDOW + 2) { skippedShort++; continue; }
    usable++;
    const nextAllowed = Object.fromEntries(CANDIDATES.map(c => [c.id, -1]));
    for (let i = WINDOW - 1; i < candles.length - 1; i++) {
      const window = candles.slice(i - WINDOW + 1, i + 1);
      for (const c of CANDIDATES) {
        clearTuning(engine);
        if (!c.p.productionBaseline) engine.setArchetypeTuning(c.key, c.p);
        if (i < nextAllowed[c.id]) continue;
        let result;
        try { result = engine.analyzeStock(window, c.key, false); } catch { continue; }
        if (!result || !BUY.has(result.stage)) continue;
        acc[c.id].signals++;
        const trade = simTrade(candles, i, c.p);
        if (!trade) { acc[c.id].skipped++; continue; }
        trade.symbol = file.name.replace(/_OHLCV\.csv$/i, '');
        trade.stage = result.stage;
        trade.score = result.inflectionScore;
        trade.conditionsMet = result.conditionsMet;
        acc[c.id].trades.push(trade);
        nextAllowed[c.id] = trade.exitIdx + 1;
      }
    }
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }
  parentPort.postMessage({ type: 'done', acc, meta: { processed, usable, skippedShort } });
}

function fmt(x) { return Number.isFinite(x) ? x.toFixed(2) : 'Inf'; }

async function main() {
  const files = fs.readdirSync(DATA_DIR).filter(n => n.toLowerCase().endsWith('.csv') && n !== 'ALL_SYMBOLS_OHLCV.csv').sort().map(name => ({ name, fp: path.join(DATA_DIR, name) }));
  const workers = Math.min(Math.max(1, Number(process.env.WORKERS || 10)), files.length || 1);
  const chunks = Array.from({ length: workers }, () => []);
  files.forEach((f, i) => chunks[i % workers].push(f));
  console.log(`Exact candidate validation: ${files.length} files, ${workers} workers, window=${WINDOW}, OOS>${OOS_CUT}`);
  console.log('Detection: compiled analyzeStock with tuning overrides; entry: next open; stop-first; non-overlap per symbol/cluster.');

  const combined = Object.fromEntries(CANDIDATES.map(c => [c.id, empty()]));
  let done = 0, usable = 0, skippedShort = 0;
  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk } });
    w.on('message', msg => {
      if (msg.type === 'progress') { done += msg.n; if (done % 100 === 0) process.stdout.write(`  processed ${done}/${files.length}\r`); }
      else if (msg.type === 'done') {
        usable += msg.meta.usable; skippedShort += msg.meta.skippedShort;
        for (const c of CANDIDATES) {
          combined[c.id].signals += msg.acc[c.id].signals;
          combined[c.id].skipped += msg.acc[c.id].skipped;
          combined[c.id].trades.push(...msg.acc[c.id].trades);
        }
        resolve();
      }
    });
    w.on('error', reject);
    w.on('exit', code => { if (code) reject(new Error(`worker exited ${code}`)); });
  })));

  const result = { generated: new Date().toISOString(), dataDir: DATA_DIR, window: WINDOW, oosCut: OOS_CUT, convention: 'exact analyzeStock dispatcher; next-open; stop-first; non-overlap per symbol/set', candidates: {} };
  for (const c of CANDIDATES) {
    const m = splitMetrics(combined[c.id].trades);
    result.candidates[c.id] = { key: c.key, p: c.p, signals: combined[c.id].signals, skippedNoTrade: combined[c.id].skipped, ...m };
    console.log(`${c.id.padEnd(18)} n=${m.full.n} WR=${fmt(m.full.wr)}% PF=${fmt(m.full.pf)} Avg=${fmt(m.full.avgPnl)}% | OOS n=${m.oos.n} WR=${fmt(m.oos.wr)}% PF=${fmt(m.oos.pf)} Avg=${fmt(m.oos.avgPnl)}%`);
  }
  result.meta = { files: files.length, usable, skippedShort };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUT_DIR, `exact_candidate_validation_${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  const lines = [`Exact candidate validation ${result.generated}`, `Data: ${DATA_DIR}`, `Files=${files.length} usable=${usable} skippedShort=${skippedShort}`, `OOS cutoff: ${OOS_CUT}`, ''];
  for (const c of CANDIDATES) {
    const x = result.candidates[c.id];
    lines.push(`${c.id}: full n=${x.full.n} WR=${fmt(x.full.wr)}% PF=${fmt(x.full.pf)} Avg=${fmt(x.full.avgPnl)}% | IS n=${x.is.n} WR=${fmt(x.is.wr)}% PF=${fmt(x.is.pf)} Avg=${fmt(x.is.avgPnl)}% | OOS n=${x.oos.n} WR=${fmt(x.oos.wr)}% PF=${fmt(x.oos.pf)} Avg=${fmt(x.oos.avgPnl)}% | MFE20=${fmt(x.full.avgMFE20)}% MAE20=${fmt(x.full.avgMAE20)}%`);
  }
  const txtPath = jsonPath.replace(/\.json$/, '.txt');
  fs.writeFileSync(txtPath, lines.join('\n'));
  console.log(`\nSaved: ${jsonPath}`);
  console.log(`Saved: ${txtPath}`);
}

if (isMainThread) main().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
else workerMain().catch(err => { parentPort.postMessage({ type: 'error', error: err.stack || String(err) }); process.exitCode = 1; });
