'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OUT_PREFIX = process.env.OUT_PREFIX || 'production_param_broad_hypertune';
const HISTORY_WINDOW = Number(process.env.HISTORY_WINDOW || 320);
const MIN_HISTORY = Number(process.env.MIN_HISTORY || 220);
const MAX_HOLD = Number(process.env.MAX_HOLD || 20);
const RANDOM_COMBOS = Number(process.env.RANDOM_COMBOS || 120000);
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

const ACTIONABLE_OR_CLOSE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY', 'PRE_BREAKOUT']);
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
  const h = lines[0].split(',').map(x => x.trim().toLowerCase());
  const ix = n => h.indexOf(n);
  const iDate = ix('date'), iOpen = ix('open'), iHigh = ix('high'), iLow = ix('low'), iClose = ix('close'), iVol = ix('volume');
  if ([iDate, iOpen, iHigh, iLow, iClose, iVol].some(i => i < 0)) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const { iso, ts } = parseDate(p[iDate]);
    const o = Number(p[iOpen]), hi = Number(p[iHigh]), lo = Number(p[iLow]), c = Number(p[iClose]), v = Number(p[iVol]);
    if (!iso || !ts || !Number.isFinite(o) || !Number.isFinite(hi) || !Number.isFinite(lo) || !Number.isFinite(c) || c <= 0) continue;
    out.push({ ts, date: iso, o, h: hi, l: lo, c, v: Number.isFinite(v) ? v : 0 });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function avg(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function pct(n, d) { return d > 0 ? n / d * 100 : 0; }
function wilson(h, n) {
  if (n <= 0) return 0;
  const z = 1.96, p = h / n;
  return ((p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n)) * 100;
}

function relaxedParams(base) {
  return {
    ...base,
    minAvgTurnover20: Math.min(base.minAvgTurnover20, 5_000_000),
    maxATRPct14Pctl120: 95,
    maxPre10AvgRangeATR: Math.max(base.maxPre10AvgRangeATR, 1.35),
    maxPre10ExpansionCount: Math.max(base.maxPre10ExpansionCount, 4),
    zoneRangeATRThreshold: Math.max(base.zoneRangeATRThreshold, 1.2),
    minZoneLen: Math.min(base.minZoneLen, 4),
    maxZoneLen: Math.max(base.maxZoneLen, 30),
    maxZoneTightnessPct: Math.max(base.maxZoneTightnessPct, 20),
    maxPre10AvgVolRatio: Math.max(base.maxPre10AvgVolRatio, 1.2),
    maxPre5AvgVolRatio: Math.max(base.maxPre5AvgVolRatio, 1.3),
    maxPre10HighVolCount: Math.max(base.maxPre10HighVolCount, 5),
    maxPre10RedVolBias: Math.max(base.maxPre10RedVolBias, 2.5),
    minExactRangeATR14: Math.min(base.minExactRangeATR14, 0.4),
    maxExactRangeATR14: Math.max(base.maxExactRangeATR14, 7),
    minExactVolRatio20: Math.min(base.minExactVolRatio20, 0.6),
    minExactVolVsPre5: Math.min(base.minExactVolVsPre5, 0.8),
    minCloseLoc: Math.min(base.minCloseLoc, 30),
    maxUpperWickPct: Math.max(base.maxUpperWickPct, 50),
    minBodyPct: Math.min(base.minBodyPct, 10),
    maxCandleRisk: Math.max(base.maxCandleRisk, 12),
    minUltraPrecisionScore: 0,
    minRSI2: Math.min(base.minRSI2, 35),
    minVolatilityExpansionRatio: null,
    minCandleQualityScore: null,
    maxCloseAboveZonePct: null,
  };
}

function buildLevels(pe, fallback) {
  const entry = Number(pe?.plannedEntry || fallback);
  const stop = Number(pe?.tacticalStop || entry * 0.94);
  const t1 = Number(pe?.target5 || entry * 1.05);
  const t2 = Number(pe?.target7 || entry * 1.08);
  const t3 = Number(pe?.target10 || entry * 1.12);
  if (![entry, stop, t1, t2, t3].every(Number.isFinite) || entry <= 0 || stop <= 0 || stop >= entry) return null;
  return { entry, stop, t1: Math.max(t1, entry * 1.001), t2: Math.max(t2, t1), t3: Math.max(t3, t2) };
}

function simulateNextOpen(candles, signalIdx, levels) {
  const entryIdx = signalIdx + 1;
  if (entryIdx >= candles.length) return null;
  const entry = candles[entryIdx].o;
  if (!Number.isFinite(entry) || entry <= 0) return null;
  const riskAbs = Math.max(0.0001, entry - levels.stop);
  const toPct = price => (price - entry) / entry * 100;
  const t1Pct = toPct(levels.t1), t2Pct = toPct(levels.t2), t3Pct = toPct(levels.t3);
  let stop = levels.stop, pos = 1, pnl = 0, mfe = 0, mae = 0, t1Hit = false, t2Hit = false, status = 'time';
  let exitIdx = Math.min(entryIdx + MAX_HOLD - 1, candles.length - 1);
  for (let i = entryIdx; i <= Math.min(entryIdx + MAX_HOLD - 1, candles.length - 1); i++) {
    const b = candles[i];
    mfe = Math.max(mfe, toPct(b.h));
    mae = Math.min(mae, toPct(b.l));
    if (pos > 0 && b.o <= stop) { pnl += pos * toPct(b.o); status = t2Hit ? 'stop_gap_t2' : t1Hit ? 'stop_gap_t1' : 'stop_gap'; exitIdx = i; pos = 0; break; }
    if (pos > 0 && b.l <= stop) { pnl += pos * toPct(stop); status = t2Hit ? 'stop_t2' : t1Hit ? 'stop_t1' : 'stop'; exitIdx = i; pos = 0; break; }
    if (!t1Hit && b.h >= levels.t1 && pos > 0) { pnl += 0.5 * t1Pct; pos -= 0.5; t1Hit = true; status = 'hit_t1'; stop = Math.max(stop, entry); }
    if (t1Hit && !t2Hit && b.h >= levels.t2 && pos > 0) { pnl += 0.3 * t2Pct; pos -= 0.3; t2Hit = true; status = 'hit_t2'; stop = Math.max(stop, levels.t1); }
    if (t2Hit && b.h >= levels.t3 && pos > 0) { pnl += pos * t3Pct; pos = 0; status = 'hit_t3'; exitIdx = i; break; }
  }
  if (pos > 0) {
    pnl += pos * toPct(candles[exitIdx].c);
    status = t2Hit ? 'time_t2' : t1Hit ? 'time_t1' : 'time';
  }
  return { pnl, pnlR: ((entry * (1 + pnl / 100)) - entry) / riskAbs, status, mfe, mae, days: exitIdx - entryIdx + 1 };
}

function collectWorker(files, config) {
  const engine = require(path.join(config.engineDir, 'stockEngine.js'));
  for (const key of PARAM_KEYS) Object.assign(engine.PARAM_SETS[key], relaxedParams(engine.PARAM_SETS[key]));
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
        try { r = engine.analyzeStock(window, key); } catch { continue; }
        if (!ACTIONABLE_OR_CLOSE.has(r.stage)) continue;
        const levels = buildLevels(r.priceEngine, candles[i].c);
        if (!levels) continue;
        const sim = simulateNextOpen(candles, i, levels);
        if (!sim) continue;
        out[key].push({
          sym, date: candles[i].date, stage: r.stage, pnl: sim.pnl, pnlR: sim.pnlR, status: sim.status, mfe: sim.mfe, mae: sim.mae, days: sim.days,
          avgTurnover20: r.avgTurnover20,
          atrPct14Pctl120: r.atrPct14Pctl120,
          pre10AvgRangeATR: r.pre10AvgRangeATR,
          pre10ExpansionCount: r.pre10ExpansionCount,
          zoneLen: r.zone?.windowLength ?? 0,
          zoneTightnessPct: r.zone?.zoneTightnessPct ?? 999,
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
  parentPort.postMessage({ type: 'done', out, meta: { skipped, minDate, maxDate } });
}

function passes(s, p) {
  return s.avgTurnover20 >= p.minAvgTurnover20 &&
    s.atrPct14Pctl120 <= p.maxATRPct14Pctl120 &&
    s.pre10AvgRangeATR <= p.maxPre10AvgRangeATR &&
    s.pre10ExpansionCount <= p.maxPre10ExpansionCount &&
    s.zoneLen >= p.minZoneLen && s.zoneLen <= p.maxZoneLen &&
    s.zoneTightnessPct <= p.maxZoneTightnessPct &&
    s.pre10AvgVolRatio <= p.maxPre10AvgVolRatio &&
    s.pre5AvgVolRatio <= p.maxPre5AvgVolRatio &&
    s.pre10HighVolCount <= p.maxPre10HighVolCount &&
    s.pre10RedVolBias <= p.maxPre10RedVolBias &&
    s.exactRangeATR14 >= p.minExactRangeATR14 && s.exactRangeATR14 <= p.maxExactRangeATR14 &&
    s.exactVolRatio20 >= p.minExactVolRatio20 &&
    s.exactVolVsPre5 >= p.minExactVolVsPre5 &&
    s.closeLoc >= p.minCloseLoc &&
    s.upperWickPct <= p.maxUpperWickPct &&
    s.bodyPct >= p.minBodyPct &&
    s.signalRangePct <= p.maxCandleRisk &&
    s.ultraPrecisionScore >= p.minUltraPrecisionScore &&
    s.rsi2 >= p.minRSI2 &&
    (p.minVolatilityExpansionRatio === null || s.volatilityExpansionRatio >= p.minVolatilityExpansionRatio) &&
    (p.minCandleQualityScore === null || s.candleQualityScore >= p.minCandleQualityScore) &&
    (p.maxCloseAboveZonePct === null || s.closeAboveZonePct <= p.maxCloseAboveZonePct);
}

function metrics(trades) {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length, wins = sorted.filter(t => t.pnl > 0), losses = sorted.filter(t => t.pnl <= 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const cut = Math.floor(n * 0.7);
  const is = sorted.slice(0, cut), oos = sorted.slice(cut);
  const calc = arr => {
    const w = arr.filter(t => t.pnl > 0), l = arr.filter(t => t.pnl <= 0);
    const aw = w.reduce((s, t) => s + t.pnl, 0), al = Math.abs(l.reduce((s, t) => s + t.pnl, 0));
    return { n: arr.length, wr: pct(w.length, arr.length), avg: avg(arr.map(t => t.pnl)), pf: al > 0 ? aw / al : (aw > 0 ? Infinity : 0), wilson: wilson(w.length, arr.length) };
  };
  return { n, wr: pct(wins.length, n), avg: avg(sorted.map(t => t.pnl)), pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0), wilson: wilson(wins.length, n), is: calc(is), oos: calc(oos), stocks: new Set(sorted.map(t => t.sym)).size };
}

function grid(base, key) {
  const z = (arr) => [...new Set(arr.filter(v => v === null || (Number.isFinite(v) && v >= 0)))];
  const common = {
    minAvgTurnover20: z([5_000_000, 10_000_000, 15_000_000, 20_000_000, 30_000_000]),
    maxATRPct14Pctl120: z([20, 30, 40, 50, 60, 70, 85, 95]),
    maxPre10AvgRangeATR: z([0.65, 0.75, 0.8, 0.9, 1.0, 1.15, 1.3]),
    maxPre10ExpansionCount: z([0, 1, 2, 3]),
    minZoneLen: z([4, 5, 6, 8, 10]),
    maxZoneTightnessPct: z([4, 6, 8, 10, 12, 15, 18]),
    maxPre10AvgVolRatio: z([0.75, 0.85, 0.9, 1.0, 1.1]),
    maxPre5AvgVolRatio: z([0.85, 0.95, 1.05, 1.1, 1.2]),
    maxPre10HighVolCount: z([0, 1, 2, 3, 4]),
    maxPre10RedVolBias: z([0.8, 0.9, 1.0, 1.1, 1.3, 1.6, 2.0]),
    minExactRangeATR14: z([0.4, 0.8, 1.2, 1.5, 1.8, 2.1, 2.4]),
    minExactVolRatio20: z([0.8, 1.1, 1.3, 1.5, 1.8, 2.1, 2.4]),
    minExactVolVsPre5: z([1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]),
    minCloseLoc: z([30, 45, 55, 65, 70, 75, 80]),
    maxUpperWickPct: z([12, 15, 18, 20, 25, 30, 35, 40]),
    minBodyPct: z([20, 35, 50, 60, 70, 75, 80]),
    maxCandleRisk: z([4, 5, 6, 7, 8.5, 10, 12]),
    minUltraPrecisionScore: z([0, 5, 25, 45, 50, 60]),
    minRSI2: z([35, 45, 50, 55, 60]),
    minVolatilityExpansionRatio: z([null, 0.75, 1.0, 1.4, 1.8, 2.0, 2.4, 2.8]),
    minCandleQualityScore: z([null, 1, 2, 3, 4, 5]),
    maxCloseAboveZonePct: z([null, 3, 4, 5, 6, 8, 10]),
  };
  const dimsByKey = {
    optimized_deployable_20plus: ['maxATRPct14Pctl120','maxPre10AvgRangeATR','minZoneLen','maxZoneTightnessPct','maxPre10RedVolBias','minExactVolRatio20','minExactVolVsPre5','minCloseLoc','maxUpperWickPct','minBodyPct','maxCandleRisk','minVolatilityExpansionRatio','maxCloseAboveZonePct'],
    optimized_highprecision_15plus: ['maxATRPct14Pctl120','maxPre10AvgRangeATR','maxZoneTightnessPct','maxPre10RedVolBias','minExactRangeATR14','minExactVolRatio20','minExactVolVsPre5','minCloseLoc','maxUpperWickPct','minBodyPct','maxCandleRisk','minVolatilityExpansionRatio','maxCloseAboveZonePct'],
    optimized_elite_10plus: ['minAvgTurnover20','maxATRPct14Pctl120','maxPre10AvgRangeATR','maxPre10RedVolBias','minExactVolRatio20','minExactVolVsPre5','minCloseLoc','maxUpperWickPct','minBodyPct','maxCandleRisk','minVolatilityExpansionRatio','maxCloseAboveZonePct'],
    optimized_ultraselective_8plus: ['maxATRPct14Pctl120','maxPre10AvgRangeATR','maxZoneTightnessPct','maxPre10RedVolBias','minExactRangeATR14','minExactVolRatio20','minExactVolVsPre5','minCloseLoc','maxUpperWickPct','minBodyPct','maxCandleRisk','minVolatilityExpansionRatio','minCandleQualityScore'],
    sniper_95plus: ['maxATRPct14Pctl120','maxPre10AvgRangeATR','maxPre10RedVolBias','minExactVolRatio20','minExactVolVsPre5','minCloseLoc','maxUpperWickPct','minBodyPct','maxCandleRisk','minVolatilityExpansionRatio','maxCloseAboveZonePct'],
  };
  const axes = {};
  for (const d of dimsByKey[key]) axes[d] = common[d].filter(v => v === null || v === base[d] || true);
  return axes;
}

function randomCombo(axes, base) {
  const p = { ...base };
  for (const [k, vals] of Object.entries(axes)) p[k] = vals[Math.floor(Math.random() * vals.length)];
  return p;
}

function score(m, base) {
  if (m.oos.n < Math.max(8, Math.min(40, Math.round(base.oos.n * 0.25)))) return -Infinity;
  if (m.n < Math.max(15, Math.round(base.n * 0.20))) return -Infinity;
  const pf = Math.min(5, Number.isFinite(m.oos.pf) ? m.oos.pf : 5);
  const allPf = Math.min(5, Number.isFinite(m.pf) ? m.pf : 5);
  return m.oos.wr * 0.52 + m.wilson * 0.20 + m.oos.avg * 8 + Math.log(Math.max(0.2, pf)) * 10 + Math.log(Math.max(0.2, allPf)) * 4 - Math.max(0, m.is.wr - m.oos.wr - 18) * 0.7;
}

function optimize(signals, base, key) {
  const baseTrades = signals.filter(s => passes(s, base));
  const baseM = metrics(baseTrades);
  const axes = grid(base, key);
  const candidates = [];
  const seen = new Set();
  const add = p => {
    const id = JSON.stringify(Object.fromEntries(Object.keys(axes).map(k => [k, p[k]])));
    if (seen.has(id)) return;
    seen.add(id);
    const t = signals.filter(s => passes(s, p));
    if (t.length < 5) return;
    const m = metrics(t);
    const sc = score(m, baseM);
    if (Number.isFinite(sc)) candidates.push({ params: p, metrics: m, score: sc });
  };
  add(base);
  for (let i = 0; i < RANDOM_COMBOS; i++) add(randomCombo(axes, base));
  candidates.sort((a, b) => b.score - a.score);
  return { base: baseM, axes: Object.fromEntries(Object.entries(axes).map(([k, v]) => [k, v.length])), tested: seen.size, top: candidates.slice(0, 25) };
}

function fmt(v, d = 1) { return Number(v || 0).toFixed(d); }
function fpf(v) { return v === Infinity ? 'Inf' : fmt(v, 2); }

if (!isMainThread) {
  collectWorker(workerData.files, workerData.config);
  return;
}

if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js'))) throw new Error('Missing compiled engine');
const { PARAM_SETS } = require(path.join(ENGINE_DIR, 'stockEngine.js'));
const files = fs.readdirSync(DATA_DIR).filter(f => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().includes('_all') && !f.toLowerCase().includes('all_symbols')).map(f => path.join(DATA_DIR, f));
const chunks = Array.from({ length: Math.min(N_WORKERS, files.length) }, () => []);
files.forEach((f, i) => chunks[i % chunks.length].push(f));
const config = { engineDir: ENGINE_DIR, historyWindow: HISTORY_WINDOW, minHistory: MIN_HISTORY, maxHold: MAX_HOLD };
const all = Object.fromEntries(PARAM_KEYS.map(k => [k, []]));
let done = 0, skipped = 0, minDate = '', maxDate = '', lastPrint = 0;
const started = Date.now();

console.log('='.repeat(90));
console.log('Broad production param hyper-tune');
console.log('='.repeat(90));
console.log(`Data: ${DATA_DIR}`);
console.log(`Files: ${files.length}`);
console.log(`Random combos per set: ${RANDOM_COMBOS}`);
console.log('');

function progress(force = false) {
  const now = Date.now();
  if (!force && now - lastPrint < 1000) return;
  lastPrint = now;
  const elapsed = (now - started) / 1000;
  const rate = done ? done / elapsed : 0;
  const eta = rate ? (files.length - done) / rate : 0;
  process.stdout.write(`\rCollecting relaxed candidates ${done}/${files.length} (${fmt(pct(done, files.length))}%) elapsed ${elapsed.toFixed(0)}s ETA ${eta.toFixed(0)}s   `);
}

Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
  const w = new Worker(__filename, { workerData: { files: chunk, config } });
  let wd = 0;
  w.on('message', msg => {
    if (msg.type === 'progress') {
      done += Math.max(0, msg.processed - wd);
      wd = msg.processed;
      progress();
    } else if (msg.type === 'done') {
      for (const k of PARAM_KEYS) all[k].push(...msg.out[k]);
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
  console.log('\nOptimizing...');
  const tuned = {};
  for (const key of PARAM_KEYS) tuned[key] = optimize(all[key], PARAM_SETS[key], key);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const txtFile = path.join(__dirname, `${OUT_PREFIX}_${stamp}.txt`);
  const jsonFile = path.join(__dirname, `${OUT_PREFIX}_${stamp}.json`);
  const lines = [];
  const push = s => lines.push(s);
  push('='.repeat(130));
  push('BROAD PRODUCTION PARAM HYPER-TUNE RESULTS');
  push('='.repeat(130));
  push(`Data: ${DATA_DIR}`);
  push(`Files: ${files.length}; skipped=${skipped}; date=${minDate} to ${maxDate}`);
  push(`Candidate collection: relaxed params, PRE_BREAKOUT and BUY-family candidates, next-open stop-first simulation.`);
  push(`Search: ${RANDOM_COMBOS} random broad combinations per param set; objective OOS WR + avg profit + PF + Wilson with count penalties.`);
  push('');
  for (const key of PARAM_KEYS) {
    const r = tuned[key];
    push('-'.repeat(130));
    push(`${LABELS[key]} | relaxed candidates=${all[key].length} | combos tested=${r.tested}`);
    push(`Baseline: n=${r.base.n}, WR=${fmt(r.base.wr)}%, avg=${fmt(r.base.avg,2)}%, PF=${fpf(r.base.pf)}, Wilson=${fmt(r.base.wilson)}%, OOS n=${r.base.oos.n}, OOS WR=${fmt(r.base.oos.wr)}%, OOS avg=${fmt(r.base.oos.avg,2)}%, OOS PF=${fpf(r.base.oos.pf)}`);
    push(`${'Rank'.padEnd(5)} ${'Score'.padStart(8)} ${'n'.padStart(5)} ${'WR'.padStart(7)} ${'Avg'.padStart(8)} ${'PF'.padStart(7)} ${'Wilson'.padStart(8)} ${'OOSn'.padStart(6)} ${'OOSWR'.padStart(7)} ${'OOSAvg'.padStart(8)} ${'OOSPF'.padStart(7)}  Changes`);
    r.top.slice(0, 12).forEach((c, i) => {
      const changes = Object.keys(c.params).filter(p => PARAM_SETS[key][p] !== undefined && c.params[p] !== PARAM_SETS[key][p]).map(p => `${p}:${PARAM_SETS[key][p]}->${c.params[p]}`).join('; ');
      push(`${String(i + 1).padEnd(5)} ${fmt(c.score,2).padStart(8)} ${String(c.metrics.n).padStart(5)} ${fmt(c.metrics.wr).padStart(6)}% ${fmt(c.metrics.avg,2).padStart(7)}% ${fpf(c.metrics.pf).padStart(7)} ${fmt(c.metrics.wilson).padStart(7)}% ${String(c.metrics.oos.n).padStart(6)} ${fmt(c.metrics.oos.wr).padStart(6)}% ${fmt(c.metrics.oos.avg,2).padStart(7)}% ${fpf(c.metrics.oos.pf).padStart(7)}  ${changes}`);
    });
  }
  const report = lines.join('\n');
  fs.writeFileSync(txtFile, report, 'utf8');
  fs.writeFileSync(jsonFile, JSON.stringify({ meta: { dataDir: DATA_DIR, files: files.length, skipped, minDate, maxDate, randomCombos: RANDOM_COMBOS, runAt: new Date().toISOString() }, tuned }, null, 2), 'utf8');
  console.log(report);
  console.log(`\nTXT : ${txtFile}`);
  console.log(`JSON: ${jsonFile}`);
}).catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
