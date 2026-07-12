'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OVERRIDES_FILE = process.env.PARAM_OVERRIDES_FILE || path.join(__dirname, 'production_param_tuned_overrides.json');
const OUT_PREFIX = process.env.OUT_PREFIX || 'production_param_tuned_validation';
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
  const iDate = header.indexOf('date');
  const iOpen = header.indexOf('open');
  const iHigh = header.indexOf('high');
  const iLow = header.indexOf('low');
  const iClose = header.indexOf('close');
  const iVol = header.indexOf('volume');
  if ([iDate, iOpen, iHigh, iLow, iClose, iVol].some(i => i < 0)) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const { iso, ts } = parseDate(p[iDate]);
    const o = Number(p[iOpen]), h = Number(p[iHigh]), l = Number(p[iLow]), c = Number(p[iClose]), v = Number(p[iVol]);
    if (!iso || !ts || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c) || c <= 0) continue;
    out.push({ ts, date: iso, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function pct(n, d) { return d > 0 ? n / d * 100 : 0; }
function avg(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function wilson(h, n) {
  if (n <= 0) return 0;
  const z = 1.96, p = h / n;
  return ((p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n)) * 100;
}

function levelsFromEngine(pe, fallbackEntry) {
  const entry = Number(pe?.plannedEntry || fallbackEntry);
  const stop = Number(pe?.tacticalStop || entry * 0.94);
  const t1 = Number(pe?.target5 || entry * 1.05);
  const t2 = Number(pe?.target7 || entry * 1.08);
  const t3 = Number(pe?.target10 || entry * 1.12);
  if (![entry, stop, t1, t2, t3].every(Number.isFinite) || entry <= 0 || stop <= 0 || stop >= entry) return null;
  return { plannedEntry: entry, stop, t1: Math.max(t1, entry * 1.001), t2: Math.max(t2, t1), t3: Math.max(t3, t2) };
}

function simulate(candles, entryIdx, entry, levels) {
  if (entryIdx >= candles.length || !Number.isFinite(entry) || entry <= 0) return null;
  const riskAbs = Math.max(0.0001, entry - levels.stop);
  const pctTo = price => (price - entry) / entry * 100;
  const t1Pct = pctTo(levels.t1), t2Pct = pctTo(levels.t2), t3Pct = pctTo(levels.t3);
  let stop = levels.stop, pos = 1, pnl = 0, status = 'time';
  let exitIdx = Math.min(entryIdx + MAX_HOLD - 1, candles.length - 1);
  let t1Hit = false, t2Hit = false, t3Hit = false, mfe = 0, mae = 0;
  for (let i = entryIdx; i <= Math.min(entryIdx + MAX_HOLD - 1, candles.length - 1); i++) {
    const bar = candles[i];
    mfe = Math.max(mfe, pctTo(bar.h));
    mae = Math.min(mae, pctTo(bar.l));
    if (pos > 0 && bar.o <= stop) {
      pnl += pos * pctTo(bar.o);
      status = t2Hit ? 'stop_gap_t2' : t1Hit ? 'stop_gap_t1' : 'stop_gap';
      exitIdx = i; pos = 0; break;
    }
    if (pos > 0 && bar.l <= stop) {
      pnl += pos * pctTo(stop);
      status = t2Hit ? 'stop_t2' : t1Hit ? 'stop_t1' : 'stop';
      exitIdx = i; pos = 0; break;
    }
    if (!t1Hit && bar.h >= levels.t1 && pos > 0) {
      pnl += 0.5 * t1Pct; pos -= 0.5; t1Hit = true; status = 'hit_t1'; stop = Math.max(stop, entry);
    }
    if (t1Hit && !t2Hit && bar.h >= levels.t2 && pos > 0) {
      pnl += 0.3 * t2Pct; pos -= 0.3; t2Hit = true; status = 'hit_t2'; stop = Math.max(stop, levels.t1);
    }
    if (t2Hit && !t3Hit && bar.h >= levels.t3 && pos > 0) {
      pnl += pos * t3Pct; pos = 0; t3Hit = true; status = 'hit_t3'; exitIdx = i; break;
    }
  }
  if (pos > 0) {
    pnl += pos * pctTo(candles[exitIdx].c);
    status = t2Hit ? 'time_t2' : t1Hit ? 'time_t1' : 'time';
  }
  return { pnl, pnlR: ((entry * (1 + pnl / 100)) - entry) / riskAbs, status, mfe, mae, days: exitIdx - entryIdx + 1, entryDate: candles[entryIdx].date, exitDate: candles[exitIdx].date };
}

function simulateNextOpen(candles, signalIdx, levels) {
  const entryIdx = signalIdx + 1;
  return simulate(candles, entryIdx, candles[entryIdx]?.o, levels);
}

function simulatePlanned(candles, signalIdx, levels) {
  for (let d = 1; d <= ENTRY_WINDOW && signalIdx + d < candles.length; d++) {
    const bar = candles[signalIdx + d];
    if (bar.o >= levels.plannedEntry) return simulate(candles, signalIdx + d, bar.o, levels);
    if (bar.h >= levels.plannedEntry) return simulate(candles, signalIdx + d, levels.plannedEntry, levels);
  }
  return null;
}

function emptyBuckets() {
  return Object.fromEntries(PARAM_KEYS.map(k => [k, { signals: 0, nextOpen: [], planned: [] }]));
}

function worker(files, config) {
  const engine = require(path.join(config.engineDir, 'stockEngine.js'));
  for (const [key, override] of Object.entries(config.overrides || {})) {
    if (engine.PARAM_SETS[key]) Object.assign(engine.PARAM_SETS[key], override);
  }
  const out = emptyBuckets();
  let processed = 0, skipped = 0, minDate = '', maxDate = '';
  const nextAllowed = {};
  for (const k of PARAM_KEYS) nextAllowed[k] = { nextOpen: {}, planned: {} };

  for (const fp of files) {
    const sym = path.basename(fp).replace(/_NS_OHLCV\.csv$/i, '').replace(/\.csv$/i, '');
    const candles = parseCSV(fp);
    if (candles.length < config.minHistory + config.maxHold + 2) {
      skipped++; processed++; parentPort.postMessage({ type: 'progress', processed, skipped }); continue;
    }
    if (!minDate || candles[0].date < minDate) minDate = candles[0].date;
    if (!maxDate || candles[candles.length - 1].date > maxDate) maxDate = candles[candles.length - 1].date;
    for (let i = config.minHistory; i < candles.length - 1; i++) {
      const window = candles.slice(Math.max(0, i + 1 - config.historyWindow), i + 1);
      for (const key of PARAM_KEYS) {
        let r;
        try { r = engine.analyzeStock(window, key); } catch { continue; }
        if (!ACTIONABLE.has(r.stage)) continue;
        out[key].signals++;
        const levels = levelsFromEngine(r.priceEngine, candles[i].c);
        if (!levels) continue;
        const models = { nextOpen: simulateNextOpen(candles, i, levels), planned: simulatePlanned(candles, i, levels) };
        for (const [model, sim] of Object.entries(models)) {
          if (!sim) continue;
          const allowedForSym = nextAllowed[key][model][sym] || 0;
          if (i < allowedForSym) continue;
          out[key][model].push({ sym, signalDate: candles[i].date, stage: r.stage, confidence: r.confidence, inflectionScore: r.inflectionScore, ...sim });
          nextAllowed[key][model][sym] = i + Math.max(1, sim.days);
        }
      }
    }
    processed++;
    parentPort.postMessage({ type: 'progress', processed, skipped });
  }
  parentPort.postMessage({ type: 'done', out, meta: { skipped, minDate, maxDate } });
}

function stats(trades) {
  const sorted = [...trades].sort((a, b) => a.signalDate.localeCompare(b.signalDate));
  const n = sorted.length, wins = sorted.filter(t => t.pnl > 0), losses = sorted.filter(t => t.pnl <= 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const cut = Math.floor(n * 0.7), oos = sorted.slice(cut), ow = oos.filter(t => t.pnl > 0), ol = oos.filter(t => t.pnl <= 0);
  const ogw = ow.reduce((s, t) => s + t.pnl, 0), ogl = Math.abs(ol.reduce((s, t) => s + t.pnl, 0));
  const byStatus = {};
  for (const t of sorted) byStatus[t.status] = (byStatus[t.status] || 0) + 1;
  return {
    n,
    stocks: new Set(sorted.map(t => t.sym)).size,
    wr: pct(wins.length, n),
    wilson: wilson(wins.length, n),
    avg: avg(sorted.map(t => t.pnl)),
    avgR: avg(sorted.map(t => t.pnlR)),
    pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0),
    mfe: avg(sorted.map(t => t.mfe)),
    mae: avg(sorted.map(t => t.mae)),
    days: avg(sorted.map(t => t.days)),
    oos: { n: oos.length, wr: pct(ow.length, oos.length), avg: avg(oos.map(t => t.pnl)), pf: ogl > 0 ? ogw / ogl : (ogw > 0 ? Infinity : 0) },
    byStatus,
  };
}

function fmt(v, d = 1) { return Number(v || 0).toFixed(d); }
function fmtPf(v) { return v === Infinity ? 'Inf' : fmt(v, 2); }

if (!isMainThread) {
  worker(workerData.files, workerData.config);
  return;
}

const overridesPayload = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
const overrides = overridesPayload.paramOverrides || overridesPayload.overrides || overridesPayload;
const files = fs.readdirSync(DATA_DIR).filter(f => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().includes('_all') && !f.toLowerCase().includes('all_symbols')).map(f => path.join(DATA_DIR, f));
const chunks = Array.from({ length: Math.min(N_WORKERS, files.length) }, () => []);
files.forEach((f, i) => chunks[i % chunks.length].push(f));
const config = { engineDir: ENGINE_DIR, overrides, historyWindow: HISTORY_WINDOW, minHistory: MIN_HISTORY, maxHold: MAX_HOLD };
const combined = emptyBuckets();
let done = 0, skipped = 0, minDate = '', maxDate = '', lastPrint = 0;
const started = Date.now();

console.log('='.repeat(90));
console.log('Tuned param validation');
console.log('='.repeat(90));
console.log(`Data: ${DATA_DIR}`);
console.log(`Overrides: ${OVERRIDES_FILE}`);
console.log(`Workers: ${chunks.length}`);
console.log('');

function progress(force = false) {
  const now = Date.now();
  if (!force && now - lastPrint < 1000) return;
  lastPrint = now;
  const elapsed = (now - started) / 1000;
  const rate = done ? done / elapsed : 0;
  const eta = rate ? (files.length - done) / rate : 0;
  process.stdout.write(`\rProgress ${done}/${files.length} (${fmt(pct(done, files.length))}%) elapsed ${elapsed.toFixed(0)}s ETA ${eta.toFixed(0)}s   `);
}

Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
  const w = new Worker(__filename, { workerData: { files: chunk, config } });
  let workerDone = 0;
  w.on('message', msg => {
    if (msg.type === 'progress') {
      done += Math.max(0, msg.processed - workerDone);
      workerDone = msg.processed;
      progress();
    } else if (msg.type === 'done') {
      for (const key of PARAM_KEYS) {
        combined[key].signals += msg.out[key].signals;
        combined[key].nextOpen.push(...msg.out[key].nextOpen);
        combined[key].planned.push(...msg.out[key].planned);
      }
      skipped += msg.meta.skipped || 0;
      if (msg.meta.minDate && (!minDate || msg.meta.minDate < minDate)) minDate = msg.meta.minDate;
      if (msg.meta.maxDate && (!maxDate || msg.meta.maxDate > maxDate)) maxDate = msg.meta.maxDate;
      resolve();
    }
  });
  w.on('error', reject);
  w.on('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}`)); });
}))).then(() => {
  done = files.length;
  progress(true);
  console.log('\n');
  const results = {};
  for (const key of PARAM_KEYS) {
    results[key] = { signals: combined[key].signals, nextOpen: stats(combined[key].nextOpen), planned: stats(combined[key].planned), trades: { nextOpen: combined[key].nextOpen, planned: combined[key].planned } };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonFile = path.join(__dirname, `${OUT_PREFIX}_${stamp}.json`);
  const txtFile = path.join(__dirname, `${OUT_PREFIX}_${stamp}.txt`);
  const lines = [];
  const push = s => lines.push(s);
  push('='.repeat(120));
  push('TUNED PARAM SET VALIDATION');
  push('='.repeat(120));
  push(`Data: ${DATA_DIR}`);
  push(`Files: ${files.length}, skipped: ${skipped}, date range: ${minDate} to ${maxDate}`);
  push(`Overrides: ${OVERRIDES_FILE}`);
  push('');
  for (const model of ['nextOpen', 'planned']) {
    push(model === 'nextOpen' ? 'NEXT-OPEN STOP-FIRST' : `PLANNED ENTRY WITHIN ${ENTRY_WINDOW} DAYS, STOP-FIRST`);
    push('-'.repeat(120));
    push(`${'Param'.padEnd(18)} ${'Signals'.padStart(8)} ${'Trades'.padStart(7)} ${'Stocks'.padStart(7)} ${'WR'.padStart(8)} ${'Wilson'.padStart(8)} ${'Avg'.padStart(8)} ${'PF'.padStart(7)} ${'AvgR'.padStart(8)} ${'MFE'.padStart(8)} ${'MAE'.padStart(8)} ${'OOSn'.padStart(6)} ${'OOSWR'.padStart(8)} ${'OOSAvg'.padStart(8)} ${'OOSPF'.padStart(7)}`);
    for (const key of PARAM_KEYS) {
      const r = results[key][model];
      push(`${LABELS[key].padEnd(18)} ${String(results[key].signals).padStart(8)} ${String(r.n).padStart(7)} ${String(r.stocks).padStart(7)} ${fmt(r.wr).padStart(7)}% ${fmt(r.wilson).padStart(7)}% ${fmt(r.avg, 2).padStart(7)}% ${fmtPf(r.pf).padStart(7)} ${fmt(r.avgR, 3).padStart(8)} ${fmt(r.mfe).padStart(7)}% ${fmt(r.mae).padStart(7)}% ${String(r.oos.n).padStart(6)} ${fmt(r.oos.wr).padStart(7)}% ${fmt(r.oos.avg, 2).padStart(7)}% ${fmtPf(r.oos.pf).padStart(7)}`);
    }
    push('');
  }
  push(`JSON: ${jsonFile}`);
  push(`TXT : ${txtFile}`);
  push('='.repeat(120));
  const report = lines.join('\n');
  fs.writeFileSync(jsonFile, JSON.stringify({ meta: { dataDir: DATA_DIR, engineDir: ENGINE_DIR, overridesFile: OVERRIDES_FILE, overrides, files: files.length, skipped, minDate, maxDate, runAt: new Date().toISOString() }, results }, null, 2), 'utf8');
  fs.writeFileSync(txtFile, report, 'utf8');
  console.log(report);
}).catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
