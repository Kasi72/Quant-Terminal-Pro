'use strict';

/**
 * R5 post-filter optimizer.
 *
 * It starts from the pasted engine signal + regime/PREMIUM definition, then
 * searches causal candle-geometry and technical confirmation filters. The
 * OOS period is never used for selection. Selection uses three chronological
 * folds inside the pre-2025-05-05 period and penalizes a weak fold.
 */

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const PARAM_FILE = process.env.PARAM_FILE || 'C:/Users/drkkr/.codex/attachments/91a92d2b-ab92-43d9-bb72-329b4562f6d8/pasted-text.txt';
const OUT_DIR = path.join(__dirname, 'results');
const WINDOW = 300, MAX_HOLD = 20, TARGET_PCT = 5, UNIVERSE_COUNT = 1616;
const OOS_CUT = '2025-05-05', OOS_TS = Date.parse(`${OOS_CUT}T00:00:00Z`) / 1000;
const N_WORKERS = Math.min(10, Math.max(1, Number(process.env.WORKERS || 10)));
const BUY = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
const ROUTES = [
  'optimized_deployable_20plus', 'optimized_highprecision_15plus',
  'optimized_elite_10plus', 'optimized_ultraselective_8plus',
  'sniper_95plus', 'ors_prime_reversal',
];
const LABEL = {
  optimized_deployable_20plus: 'VolumeFootprint',
  optimized_highprecision_15plus: 'CompressionCoil',
  optimized_elite_10plus: 'MomentumPocket',
  optimized_ultraselective_8plus: 'EMAStack',
  sniper_95plus: 'PerfectStorm', ors_prime_reversal: 'ORS-Prime',
};

function parseDate(s) { const t = Date.parse(String(s).trim()); return Number.isFinite(t) ? Math.floor(t / 1000) : 0; }
function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const out = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const p = line.split(',').map(x => x.trim()); if (p.length < 6) continue;
    const ts = parseDate(p[0]), o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (!ts || ![o, h, l, c, v].every(Number.isFinite) || o <= 0 || l <= 0 || c <= 0 || h < l) continue;
    out.push({ ts, o, h, l, c, v: Math.max(0, v) });
  }
  out.sort((a, b) => a.ts - b.ts); return out;
}
function ema(values, period) {
  const out = new Array(values.length).fill(null); if (values.length < period) return out;
  let s = 0; for (let i = 0; i < period; i++) s += values[i]; out[period - 1] = s / period;
  const k = 2 / (period + 1); for (let i = period; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}
function atrAt(candles, end) {
  if (end < 1) return Math.max(0, candles[end].h - candles[end].l);
  let a = candles[1].h - candles[1].l;
  for (let i = 2; i <= end; i++) { const b = candles[i], p = candles[i - 1]; const tr = Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)); a = (a * 13 + tr) / 14; }
  return a;
}
function num(x, d = 0) { return Number.isFinite(Number(x)) ? Number(x) : d; }
function bodyMetrics(bar) {
  const r = bar.h - bar.l, body = Math.abs(bar.c - bar.o);
  const upper = bar.h - Math.max(bar.o, bar.c), lower = Math.min(bar.o, bar.c) - bar.l;
  const safeBody = Math.max(body, r * 0.001);
  return {
    body: r > 0 ? body / r : 0,
    upper: r > 0 ? upper / r : 0,
    lower: r > 0 ? lower / r : 0,
    closeLoc: r > 0 ? (bar.c - bar.l) / r : 0.5,
    upperBody: upper / safeBody,
    lowerBody: lower / safeBody,
    risk: bar.c > 0 ? r / bar.c * 100 : 0,
  };
}
function rawStop(result, bar) {
  for (const x of [result?.tacticalPlan?.stop, result?.priceEngine?.stop, result?.priceEngine?.tacticalStop, result?.priceEngine?.plannedStop]) if (num(x) > 0) return num(x);
  return bar.c * 0.95;
}
function premium(result, key, bar, cfg) {
  const m = bodyMetrics(bar), closeLoc = num(result?.closeLoc) / 100;
  const vol = num(result?.exactVolRatio20, num(result?.volRatio20));
  const rsi14 = num(result?.rsi14), rsi2 = num(result?.rsi2);
  const adx = num(result?.adx14, num(result?.momentum?.adx14, 20));
  const atrPct = num(result?.atrPct14);
  switch (key) {
    case 'optimized_deployable_20plus': return rsi14 >= 55 && rsi2 <= 80 && vol >= 2.5 && adx >= 30 && m.body >= .30 && closeLoc >= .70;
    case 'optimized_highprecision_15plus': return rsi14 >= 50 && rsi2 <= 80 && vol >= 2.0 && closeLoc >= .50;
    case 'optimized_elite_10plus': return rsi14 >= 45;
    case 'optimized_ultraselective_8plus': return m.body >= .35;
    case 'sniper_95plus': return atrPct >= 3 && m.body >= .35;
    case 'ors_prime_reversal': return num(result?.adx14, num(result?.momentum?.adx14, 20)) >= 20 || cfg?.ors_specific_params?.minADX === 20;
    default: return false;
  }
}
function simulate(candles, signalIdx, stopRaw) {
  const e = signalIdx + 1; if (e >= candles.length - 1) return null;
  const entry = candles[e].o; if (!(entry > 0)) return null;
  const stop = Math.min(entry * .965, Math.max(entry * .935, stopRaw)), target = entry * 1.05;
  let hit = false, stopped = false, bars = null, mfe = 0, mae = 0;
  for (let b = 1; b <= MAX_HOLD; b++) {
    const i = e + b; if (i >= candles.length) break; const bar = candles[i];
    mfe = Math.max(mfe, (bar.h - entry) / entry * 100); if (!hit) mae = Math.max(mae, (entry - bar.l) / entry * 100);
    if (bar.l <= stop) { stopped = true; break; }
    if (bar.h >= target) { hit = true; bars = b; break; }
  }
  const risk = (entry - stop) / entry * 100;
  return { hit, stopped, pnl: hit ? 5 : (stopped ? -risk : 0), risk, mfe, mae: hit ? mae : null, bars, nextAllowed: signalIdx + 1 + (bars ?? MAX_HOLD) };
}

if (!isMainThread) {
  const engine = require(path.join(workerData.engineDir, 'stockEngine.js'));
  const out = Object.fromEntries(ROUTES.map(k => [k, []]));
  for (const fp of workerData.files) {
    let candles; try { candles = parseCSV(fp); } catch { continue; }
    if (candles.length < WINDOW + MAX_HOLD + 2) continue;
    const symbol = path.basename(fp).replace(/_OHLCV\.csv$/i, ''), closes = candles.map(x => x.c);
    const ema20 = ema(closes, 20), ema50 = ema(closes, 50);
    const last = Object.fromEntries(ROUTES.map(k => [k, -1]));
    for (let i = WINDOW - 1; i < candles.length - MAX_HOLD - 2; i++) {
      const bar = candles[i], m = bodyMetrics(bar), prev = candles[i - 1];
      const ratio = workerData.breadth[candles[i].ts] || 0;
      const bull = ratio > .50, bear = ratio <= .50;
      const v0 = Math.max(1, candles.slice(Math.max(0, i - 20), i).reduce((s, x) => s + x.v, 0) / Math.max(1, Math.min(20, i)));
      const atr = atrAt(candles, i);
      const gap = prev?.c > 0 ? (bar.o / prev.c - 1) * 100 : 0;
      const roc10 = candles[i - 10]?.c > 0 ? (bar.c / candles[i - 10].c - 1) * 100 : 0;
      const slope5 = candles[i - 5]?.c > 0 ? (bar.c / candles[i - 5].c - 1) * 100 : 0;
      const techBase = {
        body: m.body, upper: m.upper, lower: m.lower, closeLoc: m.closeLoc, upperBody: m.upperBody, lowerBody: m.lowerBody,
        risk: m.risk, gap, vol: bar.v / v0, atrPct: bar.c > 0 ? atr / bar.c * 100 : 0,
        emaTrend: ema50[i] > 0 ? (ema20[i] / ema50[i] - 1) * 100 : 0,
        closeEma: ema20[i] > 0 ? (bar.c / ema20[i] - 1) * 100 : 0,
        roc10, slope5, macdPositive: false, emaSlopePositive: slope5 > 0,
      };
      // A compact causal MACD sign check; no centered or future-looking data.
      let e12 = closes[Math.max(0, i - 60)], e26 = e12, prevMacd = 0;
      for (let j = Math.max(0, i - 60); j <= i; j++) { e12 = closes[j] * (2 / 13) + e12 * (11 / 13); e26 = closes[j] * (2 / 27) + e26 * (25 / 27); prevMacd = e12 - e26; }
      techBase.macdPositive = prevMacd > 0;

      for (const key of ROUTES) {
        if (i <= last[key]) continue;
        let result; try { result = engine.analyzeStock(candles.slice(i - WINDOW + 1, i + 1), key, false); } catch { continue; }
        if (!result || !BUY.has(result.stage) || !premium(result, key, bar, workerData.paramByKey[key])) continue;
        // The dual-regime framework only routes EMA/PerfectStorm in bull
        // breadth and ORS in bear breadth. Other routes remain diagnostics.
        if (key === 'optimized_ultraselective_8plus' || key === 'sniper_95plus') {
          if (!bull || m.body < .35) continue;
        } else if (key === 'ors_prime_reversal' && !bear) continue;
        const trade = simulate(candles, i, rawStop(result, bar)); if (!trade) continue;
        const eventTech = {
          ...techBase,
          rsi14: num(result.rsi14, 50),
          rsi2: num(result.rsi2, 50),
          adx: num(result.adx14, num(result.momentum?.adx14, 20)),
          distEma: num(result.distFromEMA20, techBase.closeEma),
        };
        out[key].push({ symbol, sigIdx: i, ts: bar.ts, oos: bar.ts >= OOS_TS, ...eventTech, ...trade });
        last[key] = trade.nextAllowed;
      }
    }
  }
  parentPort.postMessage(out); process.exit(0);
}

function filesIn(dir) { return fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.csv') && n !== 'ALL_SYMBOLS_OHLCV.csv').sort().map(n => path.join(dir, n)); }
function wilson(w, n) {
  if (!n) return 0; const z = 1.645, p = w / n, z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / (1 + z2 / n) * 100;
}
function stats(events) {
  if (!events.length) return { n: 0, wins: 0, hit5: 0, wilson: 0, pf: 0, avgPnl: 0, medMFE: 0, avgMAE: 0, avgDays: 0 };
  const wins = events.filter(x => x.hit), losses = events.filter(x => x.stopped && !x.hit);
  const loss = losses.reduce((s, x) => s + x.risk, 0), gwin = wins.length * 5;
  const mfes = events.map(x => x.mfe).sort((a, b) => a - b), maes = wins.filter(x => x.mae != null).map(x => x.mae), days = wins.filter(x => x.bars != null).map(x => x.bars);
  return { n: events.length, wins: wins.length, hit5: wins.length / events.length * 100, wilson: wilson(wins.length, events.length), pf: loss ? gwin / loss : (gwin ? Infinity : 0), avgPnl: events.reduce((s, x) => s + x.pnl, 0) / events.length, medMFE: mfes[Math.floor(mfes.length / 2)] || 0, avgMAE: maes.length ? maes.reduce((s, x) => s + x, 0) / maes.length : 0, avgDays: days.length ? days.reduce((s, x) => s + x, 0) / days.length : 0 };
}
function evalFilter(events, filter) {
  const sorted = events.slice().sort((a, b) => a.symbol.localeCompare(b.symbol) || a.sigIdx - b.sigIdx), last = new Map(), used = [];
  for (const e of sorted) {
    if (!passes(e, filter)) continue;
    if (e.sigIdx <= (last.get(e.symbol) ?? -1)) continue;
    used.push(e); last.set(e.symbol, e.nextAllowed);
  }
  return stats(used);
}
function passes(e, f) {
  if (e.upper > f.maxUpper) return false; if (e.body < f.minBody) return false; if (e.closeLoc < f.minCloseLoc) return false;
  if (e.lower < f.minLower) return false; if (e.upperBody > f.maxUpperBody) return false; if (e.lowerBody < f.minLowerBody) return false;
  if (e.vol < f.minVol) return false; if (e.adx < f.minADX) return false; if (e.atrPct < f.minATR) return false;
  if (e.emaTrend < f.minEmaTrend || e.closeEma < f.minCloseEma || e.roc10 < f.minRoc10 || e.slope5 < f.minSlope5 || e.gap < f.minGap) return false;
  if (e.rsi14 != null && e.rsi14 < f.minRSI14) return false; if (e.rsi2 != null && e.rsi2 > f.maxRSI2) return false;
  if (e.distEma != null && e.distEma > f.maxDistEma) return false;
  if (f.macdPositive && !e.macdPositive) return false; if (f.emaSlopePositive && !e.emaSlopePositive) return false;
  return true;
}
function baseFilter() { return { maxUpper: 1, minBody: 0, minCloseLoc: 0, minLower: 0, maxUpperBody: 999, minLowerBody: 0, minVol: 0, minADX: 0, minATR: 0, minEmaTrend: -999, minCloseEma: -999, minRoc10: -999, minSlope5: -999, minGap: -999, minRSI14: 0, maxRSI2: 999, maxDistEma: 999, macdPositive: false, emaSlopePositive: false }; }
const DIMS = [
  ['maxUpper', [.10, .15, .20, .25, .30, .35]], ['minBody', [.25, .30, .35, .40, .45, .50, .60]],
  ['minCloseLoc', [.55, .60, .65, .70, .75, .80]], ['minLower', [.05, .10, .15, .20, .25, .30]],
  ['maxUpperBody', [.25, .40, .60, .80, 1.0, 1.5]], ['minLowerBody', [.10, .20, .30, .50, .75, 1.0]],
  ['minVol', [.8, 1.0, 1.3, 1.5, 2.0, 2.5]], ['minADX', [15, 20, 25, 30, 35, 40]],
  ['minATR', [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]], ['minEmaTrend', [0, .25, .5, 1.0, 2.0]],
  ['minCloseEma', [0, .25, .5, 1.0, 2.0]], ['minRoc10', [-2, 0, 2, 5, 8]],
  ['minSlope5', [0, .25, .5, 1.0, 2.0]], ['minGap', [-2, -1, 0, .5, 1]],
  ['minRSI14', [35, 40, 45, 50, 55, 60]], ['maxRSI2', [90, 80, 70, 60, 50, 40]],
  ['maxDistEma', [-5, -8, -10, -12, -15]], ['macdPositive', [true]], ['emaSlopePositive', [true]],
];
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function score(s, minN) {
  if (s.n < minN) return -Infinity;
  return s.wilson * .60 + Math.min(3, s.pf) / 3 * 20 + Math.max(-2, Math.min(3, s.avgPnl)) * 2;
}
function folds(events) {
  const is = events.filter(e => !e.oos).sort((a, b) => a.ts - b.ts); if (!is.length) return [];
  const a = is[Math.floor(is.length / 3)]?.ts || 0, b = is[Math.floor(is.length * 2 / 3)]?.ts || 0;
  return [is.filter(e => e.ts < a), is.filter(e => e.ts >= a && e.ts < b), is.filter(e => e.ts >= b)];
}
function robust(events, f, minN) {
  const fs = folds(events).map(x => evalFilter(x, f)).filter(s => s.n >= Math.max(4, Math.floor(minN / 3)));
  if (fs.length < 2) return { score: -Infinity, folds: fs };
  const vals = fs.map(s => score(s, Math.max(4, Math.floor(minN / 3))));
  return { score: vals.reduce((a, b) => a + b, 0) * .5 / vals.length + Math.min(...vals) * .5, folds: fs };
}
function renderFilter(f) { return Object.entries(f).filter(([k, v]) => !['maxUpper','minBody','minCloseLoc','minLower','maxUpperBody','minLowerBody','minVol','minADX','minATR','minEmaTrend','minCloseEma','minRoc10','minSlope5','minGap','minRSI14','maxRSI2','maxDistEma','macdPositive','emaSlopePositive'].includes(k) || v !== baseFilter()[k]).reduce((o, [k, v]) => (o[k] = v, o), {}); }

async function main() {
  const pasted = JSON.parse(fs.readFileSync(PARAM_FILE, 'utf8')), paramByKey = Object.fromEntries(pasted.param_sets.map(x => [x.key, x]));
  const files = filesIn(DATA_DIR), chunks = Array.from({ length: Math.min(N_WORKERS, files.length) }, () => []); files.forEach((f, i) => chunks[i % chunks.length].push(f));
  console.log(`Wick/body/technical optimizer | ${files.length} files | ${chunks.length} workers | fixed breadth /${UNIVERSE_COUNT}`);
  const breadthCounts = {};
  for (const fp of files) { let c; try { c = parseCSV(fp); } catch { continue; } if (c.length < 50) continue; const e = ema(c.map(x => x.c), 50); for (let i = 49; i < c.length; i++) { const row = breadthCounts[c[i].ts] || 0; breadthCounts[c[i].ts] = row + (c[i].c > e[i] ? 1 : 0); } }
  const breadth = Object.fromEntries(Object.entries(breadthCounts).map(([k, v]) => [k, v / UNIVERSE_COUNT]));
  const candidates = Object.fromEntries(ROUTES.map(k => [k, []])); let done = 0;
  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk, engineDir: ENGINE_DIR, breadth, paramByKey } });
    w.on('message', data => { for (const k of ROUTES) candidates[k].push(...data[k]); done += chunk.length; process.stdout.write(`  cached signals: ${done}/${files.length}\r`); resolve(); }); w.on('error', reject); w.on('exit', code => { if (code) reject(new Error(`worker exited ${code}`)); });
  })));
  process.stdout.write('\n');

  const allResults = {}, topRows = [];
  for (const key of ROUTES) {
    const events = candidates[key], base = baseFilter();
    const baseIsN = evalFilter(events.filter(e => !e.oos), base).n;
    // Do not let the optimizer buy a high IS score by discarding nearly all
    // signals. The selected candidate must retain at least half of baseline
    // IS coverage; this is a frequency constraint, not an OOS outcome leak.
    const minN = Math.max(8, Math.ceil(baseIsN * .50));
    const baseline = evalFilter(events, base), singles = [];
    for (const [dim, values] of DIMS) for (const value of values) { const f = clone(base); f[dim] = value; const r = robust(events, f, minN); singles.push({ filter: f, change: { dim, value }, robust: r.score, is: evalFilter(events.filter(e => !e.oos), f), folds: r.folds }); }
    singles.sort((a, b) => b.robust - a.robust);
    const bestByDim = {};
    for (const row of singles) { if (!bestByDim[row.change.dim]) bestByDim[row.change.dim] = []; if (bestByDim[row.change.dim].length < 3 && Number.isFinite(row.robust)) bestByDim[row.change.dim].push(row); }
    const pairRows = [];
    const dims = Object.keys(bestByDim);
    for (let x = 0; x < dims.length; x++) for (let y = x + 1; y < dims.length; y++) for (const a of bestByDim[dims[x]]) for (const b of bestByDim[dims[y]]) {
      const f = clone(base); f[dims[x]] = a.change.value; f[dims[y]] = b.change.value; const r = robust(events, f, minN); if (Number.isFinite(r.score)) pairRows.push({ filter: f, change: `${dims[x]}=${a.change.value} + ${dims[y]}=${b.change.value}`, robust: r.score, is: evalFilter(events.filter(e => !e.oos), f), folds: r.folds });
    }
    const pool = [{ filter: base, change: 'BASELINE', robust: robust(events, base, minN).score, is: evalFilter(events.filter(e => !e.oos), base), folds: [] }, ...singles, ...pairRows].sort((a, b) => b.robust - a.robust);
    const selected = pool.slice(0, 5).map(row => ({ change: row.change, filter: renderFilter(row.filter), robustScore: row.robust, is: row.is, folds: row.folds, oos: evalFilter(events.filter(e => e.oos), row.filter) }));
    allResults[key] = { label: LABEL[key], candidateSignals: events.length, baseline: { filter: {}, is: evalFilter(events.filter(e => !e.oos), base), oos: evalFilter(events.filter(e => e.oos), base) }, selected };
    topRows.push({ key, selected: selected[0] });
  }

  const fmt = (x, d = 2) => x === Infinity ? 'Inf' : Number(x || 0).toFixed(d), lines = [];
  lines.push('WICK/BODY + TECHNICAL POST-FILTER OPTIMIZATION');
  lines.push(`Data: ${DATA_DIR} | OOS: ${OOS_CUT} | fixed breadth denominator: ${UNIVERSE_COUNT}`);
  lines.push('Selection: three chronological IS folds; OOS untouched; next-open +5% target, stop-first, 3.5%-6.5% clamp, 20 bars, non-overlap');
  lines.push('');
  lines.push('Selected IS-robust candidate vs baseline');
  lines.push('Route             Base IS H5/PF/n   Best IS H5/PF/n   OOS H5/PF/n   AvgPnl   MedMFE   AvgMAE   Filter');
  lines.push('-'.repeat(150));
  for (const key of ROUTES) { const r = allResults[key], b = r.baseline, s = r.selected[0], o = s.oos; lines.push(`${LABEL[key].padEnd(17)} ${fmt(b.is.hit5,1)}%/${fmt(b.is.pf)}/${b.is.n}      ${fmt(s.is.hit5,1)}%/${fmt(s.is.pf)}/${s.is.n}      ${fmt(o.hit5,1)}%/${fmt(o.pf)}/${o.n}   ${fmt(o.avgPnl)}%   ${fmt(o.medMFE)}%   ${fmt(o.avgMAE)}%   ${JSON.stringify(s.filter)}`); }
  lines.push('');
  lines.push('Top five IS-robust candidates per route are stored in JSON, including their untouched OOS results.');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-'), jsonPath = path.join(OUT_DIR, `wick_body_technical_optimization_${stamp}.json`), txtPath = path.join(OUT_DIR, `wick_body_technical_optimization_${stamp}.txt`);
  fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(jsonPath, JSON.stringify({ meta: { dataDir: DATA_DIR, files: files.length, oosCut: OOS_CUT, universeCount: UNIVERSE_COUNT, convention: 'R5 next-open +5 target stop-first clamp 3.5%-6.5% 20 bars non-overlap', paramFile: PARAM_FILE, generated: new Date().toISOString() }, routes: allResults }, null, 2)); fs.writeFileSync(txtPath, lines.join('\n')); console.log(lines.join('\n')); console.log(`\nJSON: ${jsonPath}\nTXT: ${txtPath}`);
}
if (isMainThread) main().catch(e => { console.error(e.stack || e); process.exit(1); });
