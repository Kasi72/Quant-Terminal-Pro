'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OUT_PREFIX = process.env.OUT_PREFIX || 'production_param_tuning';
const HISTORY_WINDOW = Number(process.env.HISTORY_WINDOW || 280);
const MIN_HISTORY = Number(process.env.MIN_HISTORY || 220);
const MAX_HOLD = Number(process.env.MAX_HOLD || 20);
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
  const iDate = idx('date'), iOpen = idx('open'), iHigh = idx('high'), iLow = idx('low'), iClose = idx('close'), iVol = idx('volume');
  if ([iDate, iOpen, iHigh, iLow, iClose, iVol].some(i => i < 0)) return [];
  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const { iso, ts } = parseDate(p[iDate]);
    const o = Number(p[iOpen]), h = Number(p[iHigh]), l = Number(p[iLow]), c = Number(p[iClose]), v = Number(p[iVol]);
    if (!iso || !ts || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c) || c <= 0) continue;
    candles.push({ ts, date: iso, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
  }
  candles.sort((a, b) => a.ts - b.ts);
  return candles;
}

function pct(n, d) { return d > 0 ? n / d * 100 : 0; }
function avg(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function wilson(h, n) {
  if (n <= 0) return 0;
  const z = 1.96, p = h / n;
  return ((p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n)) * 100;
}

function buildLevels(priceEngine, fallbackEntry) {
  const pe = priceEngine || {};
  const entry = Number(pe.plannedEntry || fallbackEntry);
  const stop = Number(pe.tacticalStop || entry * 0.94);
  const t1 = Number(pe.target5 || entry * 1.05);
  const t2 = Number(pe.target7 || entry * 1.08);
  const t3 = Number(pe.target10 || entry * 1.12);
  if (![entry, stop, t1, t2, t3].every(Number.isFinite) || entry <= 0 || stop <= 0 || stop >= entry) return null;
  return { entry, stop, t1: Math.max(t1, entry * 1.001), t2: Math.max(t2, t1), t3: Math.max(t3, t2) };
}

function simulateNextOpenStopFirst(candles, signalIdx, levels) {
  const entryIdx = signalIdx + 1;
  if (entryIdx >= candles.length) return null;
  const entry = candles[entryIdx].o;
  if (!Number.isFinite(entry) || entry <= 0) return null;
  const riskAbs = Math.max(0.0001, entry - levels.stop);
  const pctTo = price => (price - entry) / entry * 100;
  const t1Pct = pctTo(levels.t1), t2Pct = pctTo(levels.t2), t3Pct = pctTo(levels.t3);
  let stop = levels.stop, pos = 1, pnl = 0, status = 'time', exitIdx = Math.min(entryIdx + MAX_HOLD - 1, candles.length - 1);
  let mfe = 0, mae = 0, t1Hit = false, t2Hit = false, t3Hit = false;
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
    const last = candles[exitIdx];
    pnl += pos * pctTo(last.c);
    status = t2Hit ? 'time_t2' : t1Hit ? 'time_t1' : 'time';
  }
  return { pnl, pnlR: ((entry * (1 + pnl / 100)) - entry) / riskAbs, status, mfe, mae, days: exitIdx - entryIdx + 1, entryDate: candles[entryIdx].date, exitDate: candles[exitIdx].date };
}

function collectWorker(files, config) {
  const { analyzeStock } = require(path.join(config.engineDir, 'stockEngine.js'));
  const out = Object.fromEntries(PARAM_KEYS.map(k => [k, []]));
  let processed = 0, skipped = 0, minDate = '', maxDate = '';
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
        try { r = analyzeStock(window, key); } catch { continue; }
        if (!ACTIONABLE.has(r.stage)) continue;
        const levels = buildLevels(r.priceEngine, candles[i].c);
        if (!levels) continue;
        const sim = simulateNextOpenStopFirst(candles, i, levels);
        if (!sim) continue;
        out[key].push({
          sym,
          date: candles[i].date,
          stage: r.stage,
          pnl: sim.pnl,
          pnlR: sim.pnlR,
          status: sim.status,
          mfe: sim.mfe,
          mae: sim.mae,
          days: sim.days,
          confidence: r.confidence,
          inflectionScore: r.inflectionScore,
          tradeValid: !!(r.priceEngine && r.priceEngine.tradeValid),
          avgTurnover20: r.avgTurnover20,
          atrPct14Pctl120: r.atrPct14Pctl120,
          pre10AvgRangeATR: r.pre10AvgRangeATR,
          pre10ExpansionCount: r.pre10ExpansionCount,
          zoneRangeATRThreshold: r.zone ? r.zone.zoneATRRatio : 999,
          zoneLen: r.zone ? r.zone.windowLength : 0,
          zoneTightnessPct: r.zone ? r.zone.zoneTightnessPct : 999,
          pre10AvgVolRatio: r.pre10AvgVolRatio,
          pre5AvgVolRatio: r.pre5AvgVolRatio,
          pre10HighVolCount: r.pre10HighVolCount,
          pre10RedVolBias: r.pre10RedVolBias,
          exactRangeATR14: r.exactRangeATR14,
          exactVolRatio20: r.exactVolRatio20,
          exactVolVsPre5: r.exactVolVsPre5,
          closeLoc: r.closeLoc,
          upperWickPct: r.upperWickPct,
          bodyPct: r.bodyPct,
          signalRangePct: r.signalRangePct,
          ultraPrecisionScore: r.ultraPrecisionScore,
          rsi2: r.rsi2,
          volatilityExpansionRatio: r.volatilityExpansionRatio,
          candleQualityScore: r.candleQualityScore,
          closeAboveZonePct: r.zone && r.zone.zoneHigh > 0 ? ((candles[i].c - r.zone.zoneHigh) / r.zone.zoneHigh) * 100 : 999,
        });
      }
    }
    processed++;
    parentPort.postMessage({ type: 'progress', processed, skipped });
  }
  parentPort.postMessage({ type: 'done', out, meta: { processed, skipped, minDate, maxDate } });
}

function valuesAround(base, kind, opts = {}) {
  if (base == null) return [null];
  const vals = new Set([base]);
  for (const d of opts.deltas || []) vals.add(kind === 'min' ? base + d : base - d);
  for (const v of opts.values || []) vals.add(v);
  return [...vals].filter(v => v == null || (Number.isFinite(v) && v >= (opts.floor ?? 0))).sort((a, b) => (a ?? -999) - (b ?? -999));
}

function buildAxes(params, key) {
  const common = {
    minAvgTurnover20: valuesAround(params.minAvgTurnover20, 'min', { values: [params.minAvgTurnover20, Math.max(params.minAvgTurnover20, 20_000_000), Math.max(params.minAvgTurnover20, 30_000_000)] }),
    maxATRPct14Pctl120: valuesAround(params.maxATRPct14Pctl120, 'max', { deltas: [10, 20, 30], floor: 5 }),
    maxPre10AvgRangeATR: valuesAround(params.maxPre10AvgRangeATR, 'max', { deltas: [0.1, 0.2, 0.3], floor: 0.1 }),
    maxPre10ExpansionCount: [...new Set([params.maxPre10ExpansionCount, Math.max(0, params.maxPre10ExpansionCount - 1), 0])].sort((a, b) => a - b),
    minZoneLen: [...new Set([params.minZoneLen, params.minZoneLen + 1, params.minZoneLen + 2])],
    maxZoneTightnessPct: valuesAround(params.maxZoneTightnessPct, 'max', { deltas: [2, 4, 6], floor: 1 }),
    maxPre10AvgVolRatio: valuesAround(params.maxPre10AvgVolRatio, 'max', { deltas: [0.05, 0.1, 0.15], floor: 0.1 }),
    maxPre5AvgVolRatio: valuesAround(params.maxPre5AvgVolRatio, 'max', { deltas: [0.05, 0.1, 0.15], floor: 0.1 }),
    maxPre10HighVolCount: [...new Set([params.maxPre10HighVolCount, Math.max(0, params.maxPre10HighVolCount - 1), 0])].sort((a, b) => a - b),
    maxPre10RedVolBias: valuesAround(params.maxPre10RedVolBias, 'max', { deltas: [0.1, 0.2, 0.4], floor: 0.1 }),
    minExactRangeATR14: valuesAround(params.minExactRangeATR14, 'min', { deltas: [0.2, 0.4, 0.6] }),
    minExactVolRatio20: valuesAround(params.minExactVolRatio20, 'min', { deltas: [0.2, 0.4, 0.7] }),
    minExactVolVsPre5: valuesAround(params.minExactVolVsPre5, 'min', { deltas: [0.5, 1.0, 1.5] }),
    minCloseLoc: valuesAround(params.minCloseLoc, 'min', { deltas: [5, 10, 15] }),
    maxUpperWickPct: valuesAround(params.maxUpperWickPct, 'max', { deltas: [5, 10, 15], floor: 0 }),
    minBodyPct: valuesAround(params.minBodyPct, 'min', { deltas: [5, 10, 15] }),
    maxCandleRisk: valuesAround(params.maxCandleRisk, 'max', { deltas: [1, 2, 3], floor: 1 }),
    minUltraPrecisionScore: valuesAround(params.minUltraPrecisionScore, 'min', { deltas: [10, 20, 30] }),
    minRSI2: valuesAround(params.minRSI2, 'min', { deltas: [5, 10, 15] }),
  };
  if (params.minVolatilityExpansionRatio !== null) common.minVolatilityExpansionRatio = valuesAround(params.minVolatilityExpansionRatio, 'min', { deltas: [0.25, 0.5, 0.8] });
  if (params.minCandleQualityScore !== null) common.minCandleQualityScore = [...new Set([params.minCandleQualityScore, params.minCandleQualityScore + 1, params.minCandleQualityScore + 2])];
  if (params.maxCloseAboveZonePct !== null) common.maxCloseAboveZonePct = valuesAround(params.maxCloseAboveZonePct, 'max', { deltas: [1, 2, 3], floor: 0 });

  const priority = {
    optimized_deployable_20plus: ['minExactVolVsPre5', 'minCloseLoc', 'maxUpperWickPct', 'minBodyPct', 'maxCandleRisk', 'minVolatilityExpansionRatio', 'maxPre10RedVolBias', 'maxCloseAboveZonePct'],
    optimized_highprecision_15plus: ['maxATRPct14Pctl120', 'minExactVolRatio20', 'minExactVolVsPre5', 'minCloseLoc', 'maxUpperWickPct', 'minBodyPct', 'maxPre10RedVolBias', 'maxCloseAboveZonePct'],
    optimized_elite_10plus: ['minExactVolRatio20', 'minExactVolVsPre5', 'minCloseLoc', 'maxUpperWickPct', 'minBodyPct', 'maxCandleRisk', 'minVolatilityExpansionRatio', 'maxPre10RedVolBias'],
    optimized_ultraselective_8plus: ['minExactVolRatio20', 'minExactVolVsPre5', 'minCloseLoc', 'maxUpperWickPct', 'minBodyPct', 'minVolatilityExpansionRatio', 'minCandleQualityScore', 'maxATRPct14Pctl120'],
    sniper_95plus: ['minExactVolRatio20', 'minCloseLoc', 'maxUpperWickPct', 'minBodyPct', 'maxPre10RedVolBias', 'minVolatilityExpansionRatio', 'maxCandleRisk', 'maxCloseAboveZonePct'],
  }[key];
  return Object.fromEntries(priority.filter(k => common[k] && common[k].length > 1).map(k => [k, common[k]]));
}

function passes(s, p) {
  if (s.avgTurnover20 < p.minAvgTurnover20) return false;
  if (s.atrPct14Pctl120 > p.maxATRPct14Pctl120) return false;
  if (s.pre10AvgRangeATR > p.maxPre10AvgRangeATR) return false;
  if (s.pre10ExpansionCount > p.maxPre10ExpansionCount) return false;
  if (s.zoneLen < p.minZoneLen || s.zoneLen > p.maxZoneLen) return false;
  if (s.zoneTightnessPct > p.maxZoneTightnessPct) return false;
  if (s.pre10AvgVolRatio > p.maxPre10AvgVolRatio) return false;
  if (s.pre5AvgVolRatio > p.maxPre5AvgVolRatio) return false;
  if (s.pre10HighVolCount > p.maxPre10HighVolCount) return false;
  if (s.pre10RedVolBias > p.maxPre10RedVolBias) return false;
  if (s.exactRangeATR14 < p.minExactRangeATR14 || s.exactRangeATR14 > p.maxExactRangeATR14) return false;
  if (s.exactVolRatio20 < p.minExactVolRatio20) return false;
  if (s.exactVolVsPre5 < p.minExactVolVsPre5) return false;
  if (s.closeLoc < p.minCloseLoc) return false;
  if (s.upperWickPct > p.maxUpperWickPct) return false;
  if (s.bodyPct < p.minBodyPct) return false;
  if (s.signalRangePct > p.maxCandleRisk) return false;
  if (s.ultraPrecisionScore < p.minUltraPrecisionScore) return false;
  if (s.rsi2 < p.minRSI2) return false;
  if (p.minVolatilityExpansionRatio !== null && s.volatilityExpansionRatio < p.minVolatilityExpansionRatio) return false;
  if (p.minCandleQualityScore !== null && s.candleQualityScore < p.minCandleQualityScore) return false;
  if (p.maxCloseAboveZonePct !== null && s.closeAboveZonePct > p.maxCloseAboveZonePct) return false;
  return true;
}

function comboList(axes) {
  const keys = Object.keys(axes);
  const combos = [];
  function rec(i, cur) {
    if (i === keys.length) { combos.push({ ...cur }); return; }
    for (const v of axes[keys[i]]) { cur[keys[i]] = v; rec(i + 1, cur); }
  }
  rec(0, {});
  return combos;
}

function metrics(trades) {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length, wins = sorted.filter(t => t.pnl > 0), losses = sorted.filter(t => t.pnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const cut = Math.floor(n * 0.7);
  const is = sorted.slice(0, cut), oos = sorted.slice(cut);
  const calc = arr => {
    const w = arr.filter(t => t.pnl > 0), l = arr.filter(t => t.pnl <= 0);
    const gw = w.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(l.reduce((s, t) => s + t.pnl, 0));
    return { n: arr.length, wr: pct(w.length, arr.length), avg: avg(arr.map(t => t.pnl)), pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0), wilson: wilson(w.length, arr.length) };
  };
  return { n, wins: wins.length, wr: pct(wins.length, n), avg: avg(sorted.map(t => t.pnl)), pf: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0), wilson: wilson(wins.length, n), is: calc(is), oos: calc(oos) };
}

function score(m, base) {
  if (m.oos.n < Math.max(4, Math.min(30, Math.round(base.oos.n * 0.35)))) return -Infinity;
  if (m.n < Math.max(8, Math.round(base.n * 0.25))) return -Infinity;
  const oosPf = Math.min(4, Number.isFinite(m.oos.pf) ? m.oos.pf : 4);
  const allPf = Math.min(4, Number.isFinite(m.pf) ? m.pf : 4);
  const wrTerm = m.oos.wr * 0.55 + m.wilson * 0.20;
  const profitTerm = m.oos.avg * 7 + Math.log(Math.max(0.2, oosPf)) * 9 + Math.log(Math.max(0.2, allPf)) * 4;
  const robustnessPenalty = Math.max(0, m.is.wr - m.oos.wr - 15) * 0.6;
  const countPenalty = m.oos.n < 10 ? (10 - m.oos.n) * 1.5 : 0;
  return wrTerm + profitTerm - robustnessPenalty - countPenalty;
}

function optimizeForSet(signals, baseParams, key) {
  const baseTrades = signals.filter(s => passes(s, baseParams));
  const base = metrics(baseTrades);
  const axes = buildAxes(baseParams, key);
  const combos = comboList(axes);
  const results = [];
  for (const override of combos) {
    const p = { ...baseParams, ...override };
    const t = signals.filter(s => passes(s, p));
    if (t.length < 4) continue;
    const m = metrics(t);
    const sc = score(m, base);
    if (!Number.isFinite(sc)) continue;
    results.push({ override, params: p, metrics: m, score: sc });
  }
  results.sort((a, b) => b.score - a.score);
  return { base, axes, combos: combos.length, top: results.slice(0, 20) };
}

function fmt(v, d = 1) { return Number(v || 0).toFixed(d); }
function pf(v) { return v === Infinity ? 'Inf' : fmt(v, 2); }

if (!isMainThread) {
  collectWorker(workerData.files, workerData.config);
  return;
}

if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js'))) {
  console.error(`Compiled engine not found: ${path.join(ENGINE_DIR, 'stockEngine.js')}`);
  process.exit(1);
}
if (!fs.existsSync(DATA_DIR)) {
  console.error(`Data dir not found: ${DATA_DIR}`);
  process.exit(1);
}

const { PARAM_SETS } = require(path.join(ENGINE_DIR, 'stockEngine.js'));
let files = fs.readdirSync(DATA_DIR).filter(f => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().includes('_all') && !f.toLowerCase().includes('all_symbols')).map(f => path.join(DATA_DIR, f));
const chunks = Array.from({ length: Math.min(N_WORKERS, files.length) }, () => []);
files.forEach((f, i) => chunks[i % chunks.length].push(f));
const config = { engineDir: ENGINE_DIR, historyWindow: HISTORY_WINDOW, minHistory: MIN_HISTORY, maxHold: MAX_HOLD };
const collected = Object.fromEntries(PARAM_KEYS.map(k => [k, []]));
let doneFiles = 0, skipped = 0, minDate = '', maxDate = '', lastPrint = 0;
const started = Date.now();

console.log('='.repeat(90));
console.log('Production param hyper-optimizer');
console.log('='.repeat(90));
console.log(`Data: ${DATA_DIR}`);
console.log(`Files: ${files.length}`);
console.log(`Engine: ${ENGINE_DIR}`);
console.log(`Workers: ${chunks.length}`);
console.log('');

function progress(force = false) {
  const now = Date.now();
  if (!force && now - lastPrint < 1000) return;
  lastPrint = now;
  const elapsed = (now - started) / 1000;
  const rate = doneFiles > 0 ? doneFiles / elapsed : 0;
  const eta = rate > 0 ? (files.length - doneFiles) / rate : 0;
  process.stdout.write(`\rCollecting signals ${doneFiles}/${files.length} (${fmt(pct(doneFiles, files.length))}%) elapsed ${elapsed.toFixed(0)}s ETA ${eta.toFixed(0)}s   `);
}

Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
  const w = new Worker(__filename, { workerData: { files: chunk, config } });
  let workerProcessed = 0;
  w.on('message', msg => {
    if (msg.type === 'progress') {
      doneFiles += Math.max(0, msg.processed - workerProcessed);
      workerProcessed = msg.processed;
      progress();
    } else if (msg.type === 'done') {
      for (const k of PARAM_KEYS) collected[k].push(...msg.out[k]);
      skipped += msg.meta.skipped || 0;
      if (msg.meta.minDate && (!minDate || msg.meta.minDate < minDate)) minDate = msg.meta.minDate;
      if (msg.meta.maxDate && (!maxDate || msg.meta.maxDate > maxDate)) maxDate = msg.meta.maxDate;
      resolve();
    }
  });
  w.on('error', reject);
  w.on('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}`)); });
}))).then(() => {
  doneFiles = files.length;
  progress(true);
  console.log('\n');

  const tuned = {};
  for (const key of PARAM_KEYS) {
    tuned[key] = optimizeForSet(collected[key], PARAM_SETS[key], key);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonFile = path.join(__dirname, `${OUT_PREFIX}_${stamp}.json`);
  const txtFile = path.join(__dirname, `${OUT_PREFIX}_${stamp}.txt`);
  const lines = [];
  const push = s => lines.push(s);
  push('='.repeat(120));
  push('PRODUCTION PARAM HYPER-OPTIMIZER RESULTS');
  push('='.repeat(120));
  push(`Data: ${DATA_DIR}`);
  push(`Files: ${files.length}, skipped short history: ${skipped}`);
  push(`Date range: ${minDate} to ${maxDate}`);
  push(`Method: current production signals, stricter-threshold grid, 70/30 chronological split, next-open stop-first simulation.`);
  push(`Objective: OOS WR + OOS avg profit + OOS/all profit factor + Wilson lower bound, with trade-count penalties.`);
  push('');
  for (const key of PARAM_KEYS) {
    const r = tuned[key];
    push('-'.repeat(120));
    push(`${LABELS[key]}  | collected=${collected[key].length} | combos=${r.combos}`);
    push(`Baseline all: n=${r.base.n}, WR=${fmt(r.base.wr)}%, avg=${fmt(r.base.avg, 2)}%, PF=${pf(r.base.pf)}, Wilson=${fmt(r.base.wilson)}% | OOS: n=${r.base.oos.n}, WR=${fmt(r.base.oos.wr)}%, avg=${fmt(r.base.oos.avg, 2)}%, PF=${pf(r.base.oos.pf)}`);
    push(`Top candidates:`);
    push(`${'Rank'.padEnd(5)} ${'Score'.padStart(8)} ${'n'.padStart(5)} ${'WR'.padStart(7)} ${'Avg'.padStart(8)} ${'PF'.padStart(7)} ${'OOSn'.padStart(6)} ${'OOSWR'.padStart(7)} ${'OOSAvg'.padStart(8)} ${'OOSPF'.padStart(7)}  Changes`);
    r.top.slice(0, 10).forEach((c, i) => {
      const changes = Object.entries(c.override).filter(([p, v]) => v !== PARAM_SETS[key][p]).map(([p, v]) => `${p}:${PARAM_SETS[key][p]}->${v}`).join('; ');
      push(`${String(i + 1).padEnd(5)} ${fmt(c.score, 2).padStart(8)} ${String(c.metrics.n).padStart(5)} ${fmt(c.metrics.wr).padStart(6)}% ${fmt(c.metrics.avg, 2).padStart(7)}% ${pf(c.metrics.pf).padStart(7)} ${String(c.metrics.oos.n).padStart(6)} ${fmt(c.metrics.oos.wr).padStart(6)}% ${fmt(c.metrics.oos.avg, 2).padStart(7)}% ${pf(c.metrics.oos.pf).padStart(7)}  ${changes || '(baseline)'}`);
    });
    const best = r.top[0];
    if (best) {
      push(`Recommended changes:`);
      Object.entries(best.override).filter(([p, v]) => v !== PARAM_SETS[key][p]).forEach(([p, v]) => push(`  ${p}: ${PARAM_SETS[key][p]} -> ${v}`));
    }
  }
  push('');
  push(`JSON: ${jsonFile}`);
  push(`TXT : ${txtFile}`);
  push('='.repeat(120));
  const report = lines.join('\n');
  fs.writeFileSync(jsonFile, JSON.stringify({ meta: { dataDir: DATA_DIR, engineDir: ENGINE_DIR, files: files.length, skipped, minDate, maxDate, runAt: new Date().toISOString() }, tuned }, null, 2), 'utf8');
  fs.writeFileSync(txtFile, report, 'utf8');
  console.log(report);
}).catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
