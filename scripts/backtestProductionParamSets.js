'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OUT_PREFIX = process.env.OUT_PREFIX || 'production_param_backtest';
const HISTORY_WINDOW = Number(process.env.HISTORY_WINDOW || 280);
const MIN_HISTORY = Number(process.env.MIN_HISTORY || 220);
const MAX_HOLD = Number(process.env.MAX_HOLD || 20);
const ENTRY_WINDOW = Number(process.env.ENTRY_WINDOW || 3);
const N_WORKERS = Math.max(1, Number(process.env.N_WORKERS || Math.min(8, Math.max(1, os.cpus().length - 1))));

const PARAM_KEYS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];

const LABELS = {
  optimized_deployable_20plus: 'Deployable',
  optimized_highprecision_15plus: 'HighPrecision',
  optimized_elite_10plus: 'Elite',
  optimized_ultraselective_8plus: 'UltraSelective',
  sniper_95plus: 'Sniper',
};

const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function parseDate(raw) {
  const s = String(raw || '').trim();
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
    const [dd, mon, yyyy] = s.split('-');
    const mm = String((MONTHS[mon] ?? 0) + 1).padStart(2, '0');
    const iso = `${yyyy}-${mm}-${dd.padStart(2, '0')}`;
    return { iso, ts: Math.floor(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)) / 1000) };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = s.slice(0, 10);
    return { iso, ts: Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000) };
  }
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return { iso: '', ts: 0 };
  return { iso: new Date(t).toISOString().slice(0, 10), ts: Math.floor(t / 1000) };
}

function parseCSV(fp) {
  const text = fs.readFileSync(fp, 'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const idx = name => header.indexOf(name);
  const iDate = idx('date');
  const iOpen = idx('open');
  const iHigh = idx('high');
  const iLow = idx('low');
  const iClose = idx('close');
  const iVol = idx('volume');
  if (iDate < 0 || iOpen < 0 || iHigh < 0 || iLow < 0 || iClose < 0 || iVol < 0) return [];

  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length <= Math.max(iDate, iOpen, iHigh, iLow, iClose, iVol)) continue;
    const { iso, ts } = parseDate(p[iDate]);
    const o = Number(p[iOpen]);
    const h = Number(p[iHigh]);
    const l = Number(p[iLow]);
    const c = Number(p[iClose]);
    const v = Number(p[iVol]);
    if (!iso || !ts || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c) || c <= 0) continue;
    candles.push({ ts, date: iso, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
  }
  candles.sort((a, b) => a.ts - b.ts);
  return candles;
}

function pct(n, d) {
  return d > 0 ? (n / d) * 100 : 0;
}

function avg(values) {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function median(values) {
  if (!values.length) return 0;
  const a = [...values].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function wilson(hits, n) {
  if (n <= 0) return 0;
  const z = 1.96;
  const p = hits / n;
  return ((p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n)) * 100;
}

function forwardExcursion(candles, signalIdx, entryPrice, maxHold) {
  let mfe = 0;
  let mae = 0;
  let hit3 = false;
  let hit5 = false;
  let hitT1 = false;
  let day3 = 0;
  let day5 = 0;
  for (let d = 1; d <= maxHold && signalIdx + d < candles.length; d++) {
    const bar = candles[signalIdx + d];
    const highPct = ((bar.h - entryPrice) / entryPrice) * 100;
    const lowPct = ((bar.l - entryPrice) / entryPrice) * 100;
    if (highPct > mfe) mfe = highPct;
    if (lowPct < mae) mae = lowPct;
    if (!hit3 && highPct >= 3) { hit3 = true; day3 = d; }
    if (!hit5 && highPct >= 5) { hit5 = true; day5 = d; }
  }
  return { mfe, mae, hit3, hit5, day3, day5, hitT1 };
}

function buildLevelsFromEngine(priceEngine, fallbackEntry) {
  const pe = priceEngine || {};
  const plannedEntry = Number(pe.plannedEntry || fallbackEntry);
  const stop = Number(pe.tacticalStop || (plannedEntry * 0.94));
  const t1 = Number(pe.target5 || (plannedEntry * 1.05));
  const t2 = Number(pe.target7 || (plannedEntry * 1.08));
  const t3 = Number(pe.target10 || (plannedEntry * 1.12));
  if (![plannedEntry, stop, t1, t2, t3].every(Number.isFinite) || plannedEntry <= 0 || stop <= 0 || stop >= plannedEntry) return null;
  return { plannedEntry, stop, t1: Math.max(t1, plannedEntry * 1.001), t2: Math.max(t2, t1), t3: Math.max(t3, t2) };
}

function simulatePlannedEntry(candles, signalIdx, levels, maxHold, entryWindow, targetFirst) {
  let entryIdx = -1;
  let entry = levels.plannedEntry;
  for (let d = 1; d <= entryWindow && signalIdx + d < candles.length; d++) {
    const bar = candles[signalIdx + d];
    if (bar.o >= levels.plannedEntry) {
      entryIdx = signalIdx + d;
      entry = bar.o;
      break;
    }
    if (bar.h >= levels.plannedEntry) {
      entryIdx = signalIdx + d;
      entry = levels.plannedEntry;
      break;
    }
  }
  if (entryIdx < 0) return { filled: false };
  return simulateFromEntry(candles, entryIdx, entry, levels, maxHold, targetFirst, 'planned_entry');
}

function simulateNextOpen(candles, signalIdx, levels, maxHold, targetFirst) {
  const entryIdx = signalIdx + 1;
  if (entryIdx >= candles.length) return { filled: false };
  return simulateFromEntry(candles, entryIdx, candles[entryIdx].o, levels, maxHold, targetFirst, 'next_open');
}

function simulateFromEntry(candles, entryIdx, entry, levels, maxHold, targetFirst, model) {
  if (!Number.isFinite(entry) || entry <= 0) return { filled: false };
  const riskPct = ((entry - levels.stop) / entry) * 100;
  const t1Pct = ((levels.t1 - entry) / entry) * 100;
  const t2Pct = ((levels.t2 - entry) / entry) * 100;
  const t3Pct = ((levels.t3 - entry) / entry) * 100;
  let stop = levels.stop;
  let pos = 1.0;
  let pnl = 0;
  let status = 'expired';
  let mfe = 0;
  let mae = 0;
  let exitIdx = Math.min(entryIdx + maxHold - 1, candles.length - 1);
  let t1Hit = false;
  let t2Hit = false;
  let t3Hit = false;

  const bookTargets = bar => {
    if (!t1Hit && bar.h >= levels.t1 && pos > 0) {
      pnl += 0.5 * t1Pct;
      pos -= 0.5;
      t1Hit = true;
      status = 'hit_t1';
      stop = Math.max(stop, entry);
    }
    if (t1Hit && !t2Hit && bar.h >= levels.t2 && pos > 0) {
      pnl += 0.3 * t2Pct;
      pos -= 0.3;
      t2Hit = true;
      status = 'hit_t2';
      stop = Math.max(stop, levels.t1);
    }
    if (t2Hit && !t3Hit && bar.h >= levels.t3 && pos > 0) {
      pnl += pos * t3Pct;
      pos = 0;
      t3Hit = true;
      status = 'hit_t3';
      return true;
    }
    return false;
  };

  for (let i = entryIdx; i <= Math.min(entryIdx + maxHold - 1, candles.length - 1); i++) {
    const bar = candles[i];
    const highPct = ((bar.h - entry) / entry) * 100;
    const lowPct = ((bar.l - entry) / entry) * 100;
    if (highPct > mfe) mfe = highPct;
    if (lowPct < mae) mae = lowPct;

    if (targetFirst && bookTargets(bar)) {
      exitIdx = i;
      break;
    }

    if (pos > 0 && bar.o <= stop) {
      pnl += pos * (((bar.o - entry) / entry) * 100);
      status = t2Hit ? 'stop_gap_t2' : t1Hit ? 'stop_gap_t1' : 'stop_gap';
      pos = 0;
      exitIdx = i;
      break;
    }
    if (pos > 0 && bar.l <= stop) {
      pnl += pos * (((stop - entry) / entry) * 100);
      status = t2Hit ? 'stop_t2' : t1Hit ? 'stop_t1' : 'stop';
      pos = 0;
      exitIdx = i;
      break;
    }

    if (!targetFirst && bookTargets(bar)) {
      exitIdx = i;
      break;
    }
  }

  if (pos > 0) {
    const last = candles[exitIdx];
    pnl += pos * (((last.c - entry) / entry) * 100);
    if (status === 'expired') status = t2Hit ? 'time_t2' : t1Hit ? 'time_t1' : 'time';
  }

  const riskAbs = Math.max(0.0001, entry - levels.stop);
  return {
    filled: true,
    model,
    targetFirst,
    entryIdx,
    exitIdx,
    entryDate: candles[entryIdx].date,
    exitDate: candles[exitIdx].date,
    entry,
    stop: levels.stop,
    t1: levels.t1,
    t2: levels.t2,
    t3: levels.t3,
    riskPct,
    pnl,
    pnlR: ((entry * (1 + pnl / 100)) - entry) / riskAbs,
    status,
    days: exitIdx - entryIdx + 1,
    mfe,
    mae,
    t1Hit,
    t2Hit,
    t3Hit,
  };
}

function emptyBucket() {
  const b = {};
  for (const key of PARAM_KEYS) {
    b[key] = { rawSignals: [], plannedStopFirst: [], plannedTargetFirst: [], nextOpenStopFirst: [], nextOpenTargetFirst: [] };
  }
  return b;
}

function runWorker(files, config) {
  const { analyzeStock, PARAM_SETS } = require(path.join(config.engineDir, 'stockEngine.js'));
  const out = emptyBucket();
  let processed = 0;
  let skipped = 0;
  let minDate = '';
  let maxDate = '';

  for (const fp of files) {
    const sym = path.basename(fp).replace(/_NS_OHLCV\.csv$/i, '').replace(/\.csv$/i, '');
    const candles = parseCSV(fp);
    if (candles.length < config.minHistory + config.maxHold + 2) {
      skipped++;
      processed++;
      parentPort.postMessage({ type: 'progress', processed, skipped });
      continue;
    }
    if (!minDate || candles[0].date < minDate) minDate = candles[0].date;
    if (!maxDate || candles[candles.length - 1].date > maxDate) maxDate = candles[candles.length - 1].date;

    const nextAllowed = {};
    for (const key of PARAM_KEYS) nextAllowed[key] = { plannedStopFirst: 0, plannedTargetFirst: 0, nextOpenStopFirst: 0, nextOpenTargetFirst: 0 };

    for (let i = config.minHistory; i < candles.length - 1; i++) {
      const start = Math.max(0, i + 1 - config.historyWindow);
      const window = candles.slice(start, i + 1);
      for (const key of PARAM_KEYS) {
        if (!PARAM_SETS[key]) continue;
        let r;
        try {
          r = analyzeStock(window, key);
        } catch {
          continue;
        }
        if (!ACTIONABLE.has(r.stage)) continue;
        const levels = buildLevelsFromEngine(r.priceEngine, candles[i].c);
        const fwd10 = forwardExcursion(candles, i, candles[i].c, Math.min(10, config.maxHold));
        const fwd20 = forwardExcursion(candles, i, candles[i].c, config.maxHold);
        out[key].rawSignals.push({
          sym,
          date: candles[i].date,
          idx: i,
          stage: r.stage,
          inflectionScore: r.inflectionScore,
          confidence: r.confidence,
          tradeValid: !!(r.priceEngine && r.priceEngine.tradeValid),
          close: candles[i].c,
          fwd10,
          fwd20,
        });
        if (!levels) continue;

        const models = [
          ['plannedStopFirst', () => simulatePlannedEntry(candles, i, levels, config.maxHold, config.entryWindow, false)],
          ['plannedTargetFirst', () => simulatePlannedEntry(candles, i, levels, config.maxHold, config.entryWindow, true)],
          ['nextOpenStopFirst', () => simulateNextOpen(candles, i, levels, config.maxHold, false)],
          ['nextOpenTargetFirst', () => simulateNextOpen(candles, i, levels, config.maxHold, true)],
        ];
        for (const [modelName, fn] of models) {
          if (i < nextAllowed[key][modelName]) continue;
          const sim = fn();
          if (!sim.filled) continue;
          out[key][modelName].push({
            sym,
            signalDate: candles[i].date,
            stage: r.stage,
            inflectionScore: r.inflectionScore,
            confidence: r.confidence,
            tradeValid: !!(r.priceEngine && r.priceEngine.tradeValid),
            ...sim,
          });
          nextAllowed[key][modelName] = sim.exitIdx + 1;
        }
      }
    }
    processed++;
    parentPort.postMessage({ type: 'progress', processed, skipped });
  }
  parentPort.postMessage({ type: 'done', out, meta: { processed, skipped, minDate, maxDate } });
}

function summarizeRaw(signals) {
  const n = signals.length;
  const h5_10 = signals.filter(s => s.fwd10.hit5).length;
  const h5_20 = signals.filter(s => s.fwd20.hit5).length;
  const h3_10 = signals.filter(s => s.fwd10.hit3).length;
  const valid = signals.filter(s => s.tradeValid).length;
  return {
    n,
    tradeValid: valid,
    tradeValidPct: pct(valid, n),
    hit3_10: h3_10,
    hit3_10Pct: pct(h3_10, n),
    hit5_10: h5_10,
    hit5_10Pct: pct(h5_10, n),
    hit5_10Wilson: wilson(h5_10, n),
    hit5_20: h5_20,
    hit5_20Pct: pct(h5_20, n),
    avgMfe10: avg(signals.map(s => s.fwd10.mfe)),
    avgMae10: avg(signals.map(s => s.fwd10.mae)),
    uniqueStocks: new Set(signals.map(s => s.sym)).size,
  };
}

function summarizeTrades(trades) {
  const n = trades.length;
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const byStatus = {};
  for (const t of trades) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  const sorted = [...trades].sort((a, b) => String(a.signalDate).localeCompare(String(b.signalDate)));
  const cut = Math.floor(sorted.length * 0.7);
  const is = sorted.slice(0, cut);
  const oos = sorted.slice(cut);
  const wr = arr => pct(arr.filter(t => t.pnl > 0).length, arr.length);
  return {
    n,
    wins: wins.length,
    losses: losses.length,
    winRate: pct(wins.length, n),
    wilson: wilson(wins.length, n),
    avgPnl: avg(trades.map(t => t.pnl)),
    medianPnl: median(trades.map(t => t.pnl)),
    avgR: avg(trades.map(t => t.pnlR)),
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    avgMfe: avg(trades.map(t => t.mfe)),
    avgMae: avg(trades.map(t => t.mae)),
    avgDays: avg(trades.map(t => t.days)),
    uniqueStocks: new Set(trades.map(t => t.sym)).size,
    byStatus,
    inSample: { n: is.length, winRate: wr(is), avgPnl: avg(is.map(t => t.pnl)) },
    outSample: { n: oos.length, winRate: wr(oos), avgPnl: avg(oos.map(t => t.pnl)) },
  };
}

function mergeBuckets(target, source) {
  for (const key of PARAM_KEYS) {
    for (const model of Object.keys(target[key])) target[key][model].push(...source[key][model]);
  }
}

function fmtPct(v) {
  return `${Number(v || 0).toFixed(1)}%`;
}

function fmtNum(v, d = 2) {
  if (v === Infinity) return 'Inf';
  return Number(v || 0).toFixed(d);
}

function buildReport(results, meta) {
  const lines = [];
  const push = s => lines.push(s);
  push('='.repeat(110));
  push('PRODUCTION PARAM SET BACKTEST');
  push('='.repeat(110));
  push(`Data directory : ${meta.dataDir}`);
  push(`CSV files      : ${meta.fileCount} found, ${meta.skipped} skipped for short history`);
  push(`Date range     : ${meta.minDate || '?'} to ${meta.maxDate || '?'}`);
  push(`Engine dir     : ${meta.engineDir}`);
  push(`History window : ${meta.historyWindow} bars; min history ${meta.minHistory}; max hold ${meta.maxHold}; planned-entry window ${meta.entryWindow} bars`);
  push(`Run at         : ${meta.runAt}`);
  push('');
  push('Raw signal convention = signal close to future high. No entry fill, no stop ordering. This is useful, but easiest to inflate.');
  push('Fair models use non-overlapping trades per stock/param/model and production priceEngine levels.');
  push('Stop-first = conservative same-bar ordering. Target-first = optimistic same-bar ordering.');
  push('');

  push('RAW SIGNAL FORWARD EXCURSION');
  push('-'.repeat(110));
  push(`${'Param'.padEnd(18)} ${'Signals'.padStart(8)} ${'Stocks'.padStart(7)} ${'TradeValid'.padStart(11)} ${'+3% 10d'.padStart(9)} ${'+5% 10d'.padStart(9)} ${'Wilson'.padStart(8)} ${'+5% 20d'.padStart(9)} ${'AvgMFE10'.padStart(10)} ${'AvgMAE10'.padStart(10)}`);
  for (const key of PARAM_KEYS) {
    const r = results[key].rawSummary;
    push(`${LABELS[key].padEnd(18)} ${String(r.n).padStart(8)} ${String(r.uniqueStocks).padStart(7)} ${fmtPct(r.tradeValidPct).padStart(11)} ${fmtPct(r.hit3_10Pct).padStart(9)} ${fmtPct(r.hit5_10Pct).padStart(9)} ${fmtPct(r.hit5_10Wilson).padStart(8)} ${fmtPct(r.hit5_20Pct).padStart(9)} ${fmtPct(r.avgMfe10).padStart(10)} ${fmtPct(r.avgMae10).padStart(10)}`);
  }
  push('');

  for (const model of ['plannedStopFirst', 'plannedTargetFirst', 'nextOpenStopFirst', 'nextOpenTargetFirst']) {
    push(model.toUpperCase());
    push('-'.repeat(110));
    push(`${'Param'.padEnd(18)} ${'Trades'.padStart(7)} ${'Stocks'.padStart(7)} ${'WR'.padStart(8)} ${'Wilson'.padStart(8)} ${'AvgPnl'.padStart(9)} ${'MedPnl'.padStart(9)} ${'PF'.padStart(7)} ${'AvgR'.padStart(8)} ${'AvgMFE'.padStart(9)} ${'AvgMAE'.padStart(9)} ${'OOS WR'.padStart(8)}`);
    for (const key of PARAM_KEYS) {
      const r = results[key][model].summary;
      push(`${LABELS[key].padEnd(18)} ${String(r.n).padStart(7)} ${String(r.uniqueStocks).padStart(7)} ${fmtPct(r.winRate).padStart(8)} ${fmtPct(r.wilson).padStart(8)} ${fmtPct(r.avgPnl).padStart(9)} ${fmtPct(r.medianPnl).padStart(9)} ${fmtNum(r.profitFactor).padStart(7)} ${fmtNum(r.avgR, 3).padStart(8)} ${fmtPct(r.avgMfe).padStart(9)} ${fmtPct(r.avgMae).padStart(9)} ${fmtPct(r.outSample.winRate).padStart(8)}`);
    }
    push('');
  }

  push('EXIT BREAKDOWN, CONSERVATIVE PLANNED ENTRY');
  push('-'.repeat(110));
  for (const key of PARAM_KEYS) {
    const s = results[key].plannedStopFirst.summary;
    const statuses = Object.entries(s.byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
    push(`${LABELS[key].padEnd(18)} ${statuses || 'no trades'}`);
  }
  push('');
  push('FILES');
  push('-'.repeat(110));
  push(`JSON    : ${meta.jsonFile}`);
  push(`Summary : ${meta.summaryFile}`);
  push('='.repeat(110));
  return lines.join('\n');
}

if (!isMainThread) {
  runWorker(workerData.files, workerData.config);
  return;
}

if (!fs.existsSync(DATA_DIR)) {
  console.error(`Data directory not found: ${DATA_DIR}`);
  process.exit(1);
}
if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js'))) {
  console.error(`Compiled engine not found: ${path.join(ENGINE_DIR, 'stockEngine.js')}`);
  process.exit(1);
}

const allFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().includes('_all') && !f.toLowerCase().includes('all_symbols'))
  .map(f => path.join(DATA_DIR, f));

const started = Date.now();
const combined = emptyBucket();
let doneFiles = 0;
let skipped = 0;
let minDate = '';
let maxDate = '';
let lastPrint = 0;

const chunks = Array.from({ length: Math.min(N_WORKERS, allFiles.length) }, () => []);
allFiles.forEach((f, i) => chunks[i % chunks.length].push(f));

console.log('='.repeat(80));
console.log('Production param set backtest');
console.log('='.repeat(80));
console.log(`Data   : ${DATA_DIR}`);
console.log(`Files  : ${allFiles.length}`);
console.log(`Engine : ${ENGINE_DIR}`);
console.log(`Workers: ${chunks.length}`);
console.log('');

const config = { engineDir: ENGINE_DIR, historyWindow: HISTORY_WINDOW, minHistory: MIN_HISTORY, maxHold: MAX_HOLD, entryWindow: ENTRY_WINDOW };

function printProgress(force = false) {
  const now = Date.now();
  if (!force && now - lastPrint < 1000) return;
  lastPrint = now;
  const elapsed = (now - started) / 1000;
  const rate = doneFiles > 0 ? doneFiles / elapsed : 0;
  const eta = rate > 0 ? (allFiles.length - doneFiles) / rate : 0;
  process.stdout.write(`\rProgress ${doneFiles}/${allFiles.length} (${fmtPct(pct(doneFiles, allFiles.length))}) elapsed ${elapsed.toFixed(0)}s ETA ${eta.toFixed(0)}s   `);
}

Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
  const w = new Worker(__filename, { workerData: { files: chunk, config } });
  let workerProcessed = 0;
  w.on('message', msg => {
    if (msg.type === 'progress') {
      doneFiles += Math.max(0, msg.processed - workerProcessed);
      workerProcessed = msg.processed;
      printProgress();
    } else if (msg.type === 'done') {
      mergeBuckets(combined, msg.out);
      skipped += msg.meta.skipped || 0;
      if (msg.meta.minDate && (!minDate || msg.meta.minDate < minDate)) minDate = msg.meta.minDate;
      if (msg.meta.maxDate && (!maxDate || msg.meta.maxDate > maxDate)) maxDate = msg.meta.maxDate;
      resolve();
    }
  });
  w.on('error', reject);
  w.on('exit', code => {
    if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
  });
}))).then(() => {
  doneFiles = allFiles.length;
  printProgress(true);
  console.log('\n');

  const results = {};
  for (const key of PARAM_KEYS) {
    results[key] = {
      label: LABELS[key],
      rawSummary: summarizeRaw(combined[key].rawSignals),
      rawSignals: combined[key].rawSignals,
    };
    for (const model of ['plannedStopFirst', 'plannedTargetFirst', 'nextOpenStopFirst', 'nextOpenTargetFirst']) {
      results[key][model] = { summary: summarizeTrades(combined[key][model]), trades: combined[key][model] };
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonFile = path.join(__dirname, `${OUT_PREFIX}_${stamp}.json`);
  const summaryFile = path.join(__dirname, `${OUT_PREFIX}_${stamp}.txt`);
  const meta = {
    dataDir: DATA_DIR,
    engineDir: ENGINE_DIR,
    fileCount: allFiles.length,
    skipped,
    minDate,
    maxDate,
    historyWindow: HISTORY_WINDOW,
    minHistory: MIN_HISTORY,
    maxHold: MAX_HOLD,
    entryWindow: ENTRY_WINDOW,
    workers: chunks.length,
    runAt: new Date().toISOString(),
    elapsedSec: Math.round((Date.now() - started) / 1000),
    jsonFile,
    summaryFile,
  };
  const report = buildReport(results, meta);
  fs.writeFileSync(jsonFile, JSON.stringify({ meta, results }, null, 2), 'utf8');
  fs.writeFileSync(summaryFile, report, 'utf8');
  console.log(report);
}).catch(err => {
  console.error('\nBacktest failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
