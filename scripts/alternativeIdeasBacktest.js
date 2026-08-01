'use strict';

// Backtest the five proposed high-probability ideas under one fixed convention.
// Direct ideas use only information available at the signal close. Confluence
// and gap confirmation use the current compiled engine and pasted param sets.

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const PARAM_JSON = process.env.PARAM_JSON || path.join(__dirname, 'results', 'best_of_both_hybrid_param_sets_2026-07-19.json');
const WINDOW = 300;
const OOS_CUT = '2025-05-05';
const TARGET_PCT = 5;
const SL_ATR = 3.5;
const HORIZONS = [10, 20];
const BUY = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
const IDS = ['VolumeFootprint', 'CompressionCoil', 'MomentumPocket', 'EMAStack', 'PerfectStorm'];
const KEYS = {
  VolumeFootprint: 'optimized_deployable_20plus',
  CompressionCoil: 'optimized_highprecision_15plus',
  MomentumPocket: 'optimized_elite_10plus',
  EMAStack: 'optimized_ultraselective_8plus',
  PerfectStorm: 'sniper_95plus',
};

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const out = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const p = line.split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = Number(p[1]), h = Number(p[2]), l = Number(p[3]), c = Number(p[4]), v = Number(p[5]);
    if (!Number.isFinite(ts) || ![o, h, l, c, v].every(Number.isFinite) || o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < l) continue;
    out.push({ ts: Math.floor(ts / 1000), o, h, l, c, v: Math.max(0, v) });
  }
  out.sort((a, b) => a.ts - b.ts);
  const d = [];
  for (const x of out) {
    if (d.length && d[d.length - 1].ts === x.ts) d[d.length - 1] = x;
    else d.push(x);
  }
  return d;
}

function atr14Array(c) {
  const tr = new Array(c.length).fill(0), out = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) tr[i] = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  if (c.length <= 14) return out;
  let s = 0;
  for (let i = 1; i <= 14; i++) s += tr[i];
  out[14] = s / 14;
  for (let i = 15; i < c.length; i++) out[i] = (out[i - 1] * 13 + tr[i]) / 14;
  return out;
}

function emaArray(c, n) {
  const out = new Array(c.length).fill(0), k = 2 / (n + 1);
  if (!c.length) return out;
  out[0] = c[0].c;
  for (let i = 1; i < c.length; i++) out[i] = c[i].c * k + out[i - 1] * (1 - k);
  return out;
}

function sma(c, i, n, field = 'c') {
  const s = Math.max(0, i - n + 1); let x = 0, count = 0;
  for (let j = s; j <= i; j++) { x += c[j][field]; count++; }
  return count ? x / count : 0;
}

function rsiArray(c, n) {
  const out = new Array(c.length).fill(50); let gain = 0, loss = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i].c - c[i - 1].c;
    if (i <= n) { gain += Math.max(0, d); loss += Math.max(0, -d); if (i === n) out[i] = loss ? 100 - 100 / (1 + gain / loss) : 100; continue; }
    gain = (gain * (n - 1) + Math.max(0, d)) / n;
    loss = (loss * (n - 1) + Math.max(0, -d)) / n;
    out[i] = loss ? 100 - 100 / (1 + gain / loss) : 100;
  }
  return out;
}

function adxArray(c, n = 14) {
  const tr = new Array(c.length).fill(0), plus = new Array(c.length).fill(0), minus = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    tr[i] = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    const up = c[i].h - c[i - 1].h, down = c[i - 1].l - c[i].l;
    if (up > down && up > 0) plus[i] = up;
    if (down > up && down > 0) minus[i] = down;
  }
  const adx = new Array(c.length).fill(0); let stTR = 0, stP = 0, stM = 0;
  for (let i = 1; i < c.length; i++) {
    if (i <= n) { stTR += tr[i]; stP += plus[i]; stM += minus[i]; continue; }
    if (i === n + 1) { stTR += tr[i]; stP += plus[i]; stM += minus[i]; }
    else { stTR = stTR - stTR / n + tr[i]; stP = stP - stP / n + plus[i]; stM = stM - stM / n + minus[i]; }
    const dip = stTR ? 100 * stP / stTR : 0, dim = stTR ? 100 * stM / stTR : 0;
    const dx = dip + dim ? 100 * Math.abs(dip - dim) / (dip + dim) : 0;
    adx[i] = i > 2 * n ? (adx[i - 1] * (n - 1) + dx) / n : dx;
  }
  return adx;
}

function avgPrev(c, i, n, field) { let x = 0; const s = Math.max(0, i - n); for (let j = s; j < i; j++) x += c[j][field]; return x / Math.max(1, i - s); }
function maxPrev(c, i, n, field) { let x = -Infinity; for (let j = Math.max(0, i - n); j < i; j++) x = Math.max(x, c[j][field]); return x; }
function dateOf(ts) { return new Date(ts * 1000).toISOString().slice(0, 10); }

function directSignals(c) {
  const atr = atr14Array(c), ema20 = emaArray(c, 20), ema50 = emaArray(c, 50), rsi2 = rsiArray(c, 2), adx = adxArray(c);
  const out = { HighProximityBreakout: [], SqueezeExpansion: [], TrendPullbackRSI2: [] };
  for (let i = Math.max(252, WINDOW - 1); i < c.length - 1; i++) {
    const range = c[i].h - c[i].l, loc = range > 0 ? (c[i].c - c[i].l) / range : 0.5;
    const prevRange = avgPrev(c, i, 5, 'h') - avgPrev(c, i, 5, 'l');
    const atrDown = atr[i] > 0 && [1, 2, 3, 4].every(k => atr[i - k] > atr[i - k - 1]);
    const high52 = maxPrev(c, i, 252, 'h'), localHigh = maxPrev(c, i, 5, 'h');
    const volRatio = avgPrev(c, i, 20, 'v') > 0 ? c[i].v / avgPrev(c, i, 20, 'v') : 0;
    if (c[i].c >= high52 * 0.95 && c[i].c > localHigh && volRatio >= 2 && c[i].c > ema50[i] && loc >= 0.7) out.HighProximityBreakout.push(i);
    if (atrDown && range >= 1.5 * Math.max(0.0001, prevRange) && loc >= 0.7 && c[i].c > ema20[i]) out.SqueezeExpansion.push(i);
    const s50 = sma(c, i, 50), s100 = sma(c, i, 100);
    if (adx[i] >= 30 && c[i].c > s50 && c[i].c > s100 && rsi2[i] <= 10 && c[i].c > c[i].o && c[i].c > s50 * 0.97) out.TrendPullbackRSI2.push(i);
  }
  return out;
}

function simulate(c, sigIdx, atr, gapConfirmed = false) {
  const entryIdx = sigIdx + 1;
  if (entryIdx >= c.length || !(c[entryIdx].o > 0) || !(atr > 0)) return null;
  if (gapConfirmed && c[entryIdx].o < c[sigIdx].c * 1.005) return null;
  const entry = c[entryIdx].o, stop = entry - SL_ATR * atr, by = {};
  for (const horizon of HORIZONS) {
    const end = Math.min(c.length - 1, entryIdx + horizon - 1); let result = 'TIME', exitIdx = end, exitPrice = c[end].c;
    for (let i = entryIdx; i <= end; i++) {
      if (c[i].o <= stop) { result = 'STOP_GAP'; exitIdx = i; exitPrice = c[i].o; break; }
      if (c[i].l <= stop) { result = 'STOP'; exitIdx = i; exitPrice = stop; break; }
      if (c[i].h >= entry * 1.05) { result = 'TARGET5'; exitIdx = i; exitPrice = entry * 1.05; break; }
    }
    let mfe = 0, mae = 0;
    for (let i = entryIdx; i <= end; i++) { mfe = Math.max(mfe, (c[i].h - entry) / entry * 100); mae = Math.min(mae, (c[i].l - entry) / entry * 100); }
    by[horizon] = { hit5: result === 'TARGET5', pnl: (exitPrice - entry) / entry * 100, exitIdx, mfe, mae };
  }
  return { entryDate: dateOf(c[entryIdx].ts), by };
}

function stats(rows, horizon) {
  const h = rows.map(x => x.by[horizon]); const n = h.length;
  if (!n) return { n: 0, wr: 0, hit5: 0, pf: 0, avgPnl: 0, mfe: 0, mae: 0 };
  const wins = h.filter(x => x.pnl > 0), losses = h.filter(x => x.pnl < 0);
  const gw = wins.reduce((a, x) => a + x.pnl, 0), gl = -losses.reduce((a, x) => a + x.pnl, 0);
  return { n, wr: wins.length / n * 100, hit5: h.filter(x => x.hit5).length / n * 100, pf: gl ? gw / gl : Infinity, avgPnl: h.reduce((a, x) => a + x.pnl, 0) / n, mfe: h.reduce((a, x) => a + x.mfe, 0) / n, mae: h.reduce((a, x) => a + x.mae, 0) / n };
}

function tradeRows(records, horizonSet = false) {
  const by = {}; for (const r of records) (by[r.symbol] ||= []).push(r);
  const rows = [];
  for (const arr of Object.values(by)) {
    arr.sort((a, b) => a.idx - b.idx); let next = -1;
    for (const r of arr) { if (r.idx < next) continue; const t = simulate(r.c, r.idx, r.atr, horizonSet && r.gapConfirmed); if (!t) continue; rows.push({ ...t, date: r.date }); next = t.by[20].exitIdx + 1; }
  }
  return rows;
}

function evaluateTradeRows(rows) {
  const result = {};
  for (const h of HORIZONS) result[h] = {
    full: stats(rows, h),
    is: stats(rows.filter(r => r.date <= OOS_CUT), h),
    oos: stats(rows.filter(r => r.date > OOS_CUT), h),
  };
  return result;
}

function evaluateSignals(records, horizonSet = false) { return evaluateTradeRows(tradeRows(records, horizonSet)); }

function workerMain() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const params = JSON.parse(fs.readFileSync(PARAM_JSON, 'utf8')).paramSets;
  const records = { HighProximityBreakout: [], SqueezeExpansion: [], TrendPullbackRSI2: [], Confluence2of5: [], GapConfirmedEngine: [] };
  let processed = 0, usable = 0, short = 0;
  for (const file of workerData.files) {
    let c; try { c = parseCSV(file.fp); } catch { processed++; continue; }
    processed++;
    if (c.length < WINDOW + 21) { short++; continue; }
    usable++;
    const atr = atr14Array(c), symbol = file.name.replace(/_OHLCV\.csv$/i, ''), direct = directSignals(c), routeBars = Object.fromEntries(IDS.map(id => [id, []]));
    for (const [name, indices] of Object.entries(direct)) for (const i of indices) records[name].push({ symbol, idx: i, date: dateOf(c[i].ts), c, atr: atr[i] });
    for (let i = WINDOW - 1; i <= c.length - 21; i++) {
      const w = c.slice(i - WINDOW + 1, i + 1), fired = [];
      for (const id of IDS) {
        for (const key of Object.values(KEYS)) engine.setArchetypeTuning(key, null);
        engine.setArchetypeTuning(KEYS[id], params[id].params);
        let r; try { r = engine.analyzeStock(w, KEYS[id], false); } catch { r = null; }
        if (r && BUY.has(r.stage)) { routeBars[id].push(i); fired.push(id); records.GapConfirmedEngine.push({ symbol, idx: i, date: dateOf(c[i].ts), c, atr: atr[i], gapConfirmed: true }); }
      }
      const recent = new Set();
      for (const id of IDS) for (const b of routeBars[id]) if (b >= i - 2 && b <= i) recent.add(id);
      if (recent.size >= 2) records.Confluence2of5.push({ symbol, idx: i, date: dateOf(c[i].ts), c, atr: atr[i] });
    }
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }
  const trades = Object.fromEntries(Object.entries(records).map(([k, v]) => [k, tradeRows(v, k === 'GapConfirmedEngine')]));
  parentPort.postMessage({ type: 'done', trades, meta: { processed, usable, short } });
}

async function main() {
  const files = fs.readdirSync(DATA_DIR).filter(n => n.toLowerCase().endsWith('.csv') && n !== 'ALL_SYMBOLS_OHLCV.csv').sort().map(name => ({ name, fp: path.join(DATA_DIR, name) }));
  const workers = Math.min(Math.max(1, Number(process.env.WORKERS || 10)), files.length || 1);
  const chunks = Array.from({ length: workers }, () => []);
  files.forEach((f, i) => chunks[i % workers].push(f));
  console.log(`Alternative-ideas backtest: ${files.length} files, workers=${workers}`);
  const all = { HighProximityBreakout: [], SqueezeExpansion: [], TrendPullbackRSI2: [], Confluence2of5: [], GapConfirmedEngine: [] };
  let usable = 0, short = 0, done = 0;
  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk } });
    w.on('message', m => {
      if (m.type === 'done') {
        usable += m.meta.usable; short += m.meta.short;
        for (const name of Object.keys(all)) all[name].push(...m.trades[name]);
        resolve();
      } else if (m.type === 'progress') { done += m.n; if (done % 100 === 0) process.stdout.write(`  ${done}/${files.length}\r`); }
    });
    w.on('error', reject); w.on('exit', code => { if (code) reject(new Error(`worker exited ${code}`)); });
  })));
  const out = { generated: new Date().toISOString(), dataDirectory: DATA_DIR, files: files.length, usable, short, target: '+5% before ATR stop', slAtrMult: SL_ATR, horizons: HORIZONS, oosCutoff: OOS_CUT, results: {} };
  for (const [name, rows] of Object.entries(all)) { out.results[name] = { trades: rows.length, ...evaluateTradeRows(rows) }; const x = out.results[name][20]; console.log(`${name.padEnd(24)} trades=${rows.length} full Hit5=${x.full.hit5.toFixed(1)}% PF=${x.full.pf.toFixed(2)} | OOS Hit5=${x.oos.hit5.toFixed(1)}% PF=${x.oos.pf.toFixed(2)} Avg=${x.oos.avgPnl.toFixed(2)} n=${x.oos.n}`); }
  fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jp = path.join(__dirname, 'results', `alternative_ideas_backtest_${stamp}.json`); fs.writeFileSync(jp, JSON.stringify(out, null, 2));
  console.log(`Saved: ${jp}`);
}

if (isMainThread) main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
else workerMain().catch(e => { parentPort.postMessage({ type: 'error', error: e.stack || String(e) }); process.exitCode = 1; });
