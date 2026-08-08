'use strict';

// Objective-aligned backtest: measure whether a signal reaches +5% before
// its ATR stop within 10/20 sessions, using the exact live dispatcher.

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OUT_DIR = path.join(__dirname, 'results');
const TUNE_JSON = process.env.TUNE_JSON || path.join(OUT_DIR, 'exact_live_hypertune_2026-07-18T17-42-56-761Z.json');
const WINDOW = 300;
const OOS_CUT = '2025-05-05';
const TARGET_PCT = 5;
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
  const out = new Array(c.length).fill(0);
  if (!c.length) return out;
  const tr = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    const pc = c[i - 1].c;
    tr[i] = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - pc), Math.abs(c[i].l - pc));
  }
  if (c.length <= 14) { for (let i = 1; i < c.length; i++) out[i] = tr[i]; return out; }
  let s = 0;
  for (let i = 1; i <= 14; i++) s += tr[i];
  out[14] = s / 14;
  for (let i = 15; i < c.length; i++) out[i] = (out[i - 1] * 13 + tr[i]) / 14;
  return out;
}

function dateOf(ts) { return new Date(ts * 1000).toISOString().slice(0, 10); }

function excursion(c, entryIdx, entry, horizon, adverse) {
  const end = Math.min(c.length - 1, entryIdx + horizon - 1);
  let x = 0;
  for (let i = entryIdx; i <= end; i++) {
    const v = ((adverse ? c[i].l : c[i].h) - entry) / entry * 100;
    x = adverse ? Math.min(x, v) : Math.max(x, v);
  }
  return x;
}

function simulate(c, sigIdx, atr, slAtrMult) {
  const entryIdx = sigIdx + 1;
  if (entryIdx >= c.length || !(c[entryIdx].o > 0) || !(atr > 0)) return null;
  const entry = c[entryIdx].o;
  const stop = entry - slAtrMult * atr;
  const target = entry * (1 + TARGET_PCT / 100);
  const byHorizon = {};
  for (const horizon of HORIZONS) {
    const end = Math.min(c.length - 1, entryIdx + horizon - 1);
    let result = 'TIME', exitIdx = end, exitPrice = c[end].c;
    for (let i = entryIdx; i <= end; i++) {
      const b = c[i];
      if (b.o <= stop) { result = 'STOP_GAP'; exitIdx = i; exitPrice = b.o; break; }
      if (b.l <= stop) { result = 'STOP'; exitIdx = i; exitPrice = stop; break; }
      if (b.h >= target) { result = 'TARGET5'; exitIdx = i; exitPrice = target; break; }
      if (i === end) { exitIdx = i; exitPrice = b.c; }
    }
    byHorizon[horizon] = {
      hit5: result === 'TARGET5',
      hitBeforeStop: result === 'TARGET5',
      result,
      pnl: (exitPrice - entry) / entry * 100,
      exitIdx,
      mfe: excursion(c, entryIdx, entry, horizon, false),
      mae: excursion(c, entryIdx, entry, horizon, true),
    };
  }
  return { entryDate: dateOf(c[entryIdx].ts), byHorizon };
}

function stageOk(conditions, score) { return conditions >= 4 && score >= 45; }

function selected(id, d, p) {
  let score = 0, conditions = 0;
  if (id === 'VolumeFootprint') {
    if (d.cmf20 < p.minCMF20 || d.obvSlope10 < p.minOBVSlope10 || d.atrPct14 < (p.minAtrPct14 || 0) || d.closeVsEMA20 < p.minCloseVsEMA20 || d.ema20Vs50 < p.minEMA20VsEMA50) return false;
    const q = [d.volRatio20 >= p.minVolRatio, d.closeLoc >= p.minCloseLoc && d.upperWickPct <= p.maxUpperWick, d.hi20Frac >= p.minHi20Frac, d.rangeATR >= p.minRangeATR, d.gapDownPct >= p.maxGapDownPct, (!p.requireDIBull || d.diBull) && (p.maxBsc >= 99 || d.bsc <= p.maxBsc) && d.adx >= p.minADX];
    conditions = q.filter(Boolean).length;
    score = (q[0] ? 20 : 0) + (q[1] ? 20 : 0) + (q[2] ? 15 : 0) + (q[3] ? 20 : 0) + (q[4] ? 10 : 0) + (q[5] ? 15 : 0) + Math.min(10, (d.volRatio20 - 3) * 5) + Math.min(5, (d.closeLoc - 68) * 0.3);
  } else if (id === 'CompressionCoil') {
    if (d.cmf20 < p.minCMF20 || d.obvSlope10 < p.minOBVSlope10 || d.atrPct14 < (p.minAtrPct14 || 0) || d.volRatio20 < p.minGateVolRatio || d.closeVsEMA20 < p.minCloseVsEMA20 || d.ema20Vs50 < p.minEMA20VsEMA50) return false;
    const q = [d.compressionBars >= p.minCompressionBars && d.compressionBars <= p.maxCompressionBars, d.volDeclineDays >= p.minVolumeDeclineDays, d.pricePos20 >= p.minPricePos20, d.bbWidthPctl <= p.maxBBWidthPctl, d.rangeATR <= p.maxRangeATR && d.isGreen && d.closeLoc >= p.minCloseLoc && d.bodyPct >= p.minBodyPct && d.candleRisk <= p.maxCandleRisk, (!p.requireDIBull || d.diBull) && (p.maxBsc >= 99 || d.bsc <= p.maxBsc) && d.adx >= p.minADX];
    conditions = q.filter(Boolean).length;
    score = (q[0] ? 20 : 0) + (q[1] ? 15 : 0) + (q[2] ? 15 : 0) + (q[3] ? 20 : 0) + (q[4] ? 15 : 0) + (q[5] ? 15 : 0) + Math.min(10, d.compressionBars * 3) + Math.min(5, Math.max(0, d.pricePos20 - 65) * 0.5);
  } else if (id === 'MomentumPocket') {
    if (d.cmf20 < p.minCMF20 || d.obvSlope10 < p.minOBVSlope10 || d.atrPct14 < (p.minAtrPct14 || 0) || d.rsi14 < p.minGateRSI14 || d.rsi14 > p.maxGateRSI14 || d.rsi2 > p.maxGateRSI2 || d.volRatio20 < p.minGateVolRatio || d.closeVsEMA20 < p.minCloseVsEMA20 || d.ema20Vs50 < p.minEMA20VsEMA50) return false;
    const candle = (d.isGreen && d.closeLoc >= p.minCloseLoc && d.bodyPct >= p.minBodyPct && d.upperWickPct <= p.maxUpperWick) || (d.hammer && d.closeLoc >= 60);
    const q = [d.dd52W >= p.minDd52W && d.dd52W <= p.maxDd52W, d.stabilizationBars >= p.minStabBars, candle, d.volRatio20 >= p.minVolRatio, d.rsi14 >= p.minRSI14 && d.rsi14 <= p.maxRSI14, (!p.requireDIBull || d.diBull) && (p.maxBsc >= 99 || d.bsc <= p.maxBsc) && d.adx >= p.minADX];
    conditions = q.filter(Boolean).length;
    score = (q[0] ? 18 : 0) + (q[1] ? 12 : 0) + (q[2] ? 20 : 0) + (q[3] ? 17 : 0) + (q[4] ? 13 : 0) + (q[5] ? 20 : 0) + Math.min(10, d.stabilizationBars * 3) + Math.min(5, (d.volRatio20 - 1.5) * 4);
  } else if (id === 'EMAStack') {
    if (d.cmf20 < p.minCMF20 || d.obvSlope10 < p.minOBVSlope10 || d.closeVsEMA20 < p.minCloseVsEMA20 || d.ema20Vs50 < p.minEMA20VsEMA50) return false;
    const q = [true, d.belowCount >= p.minBelowBars, d.ema10VsEma20 >= p.minEMA10VsEma20 && d.isGreen && d.bodyPct >= p.minBodyPct && d.upperWickPct <= p.maxUpperWick && d.candleRisk <= p.maxCandleRisk, d.volRatio20 >= p.minVolRatio, d.recentlyOversold && d.rsi2Pass !== false, (!p.requireDIBull || d.diBull) && (p.maxBsc >= 99 || d.bsc <= p.maxBsc) && d.adx >= p.minADX];
    conditions = q.filter(Boolean).length;
    score = (q[0] ? 25 : 0) + (q[1] ? 15 : 0) + (q[2] ? 15 : 0) + (q[3] ? 15 : 0) + (q[4] ? 10 : 0) + (q[5] ? 20 : 0) + Math.min(10, d.belowCount * 2) + Math.min(5, (d.volRatio20 - 1.8) * 5);
  } else {
    if (d.fires < p.minFires || d.quality < p.minQualityTier || d.candleRisk > p.maxCandleRisk || d.adx < p.minADXGate || d.cmf20 < p.minCMF20 || d.obvSlope10 < p.minOBVSlope10 || d.atrPct14 < (p.minAtrPct14 || 0) || d.closeVsEMA20 < p.minCloseVsEMA20 || d.ema20Vs50 < p.minEMA20VsEMA50) return false;
    if (d.atrPct14 > (p.maxAtrPct14 || 999)) return false;
    score = d.fireScores.reduce((a, b) => a + b, 0) / d.fireScores.length + (d.fires >= 4 ? 15 : d.fires === 3 ? 10 : 5);
    return score >= 45;
  }
  return stageOk(conditions, score);
}

function empty() { return { signals: 0, trades: [] }; }

function workerMain() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const tuning = workerData.tuning;
  const acc = Object.fromEntries(IDS.map(id => [id, empty()]));
  let processed = 0, usable = 0, short = 0;
  for (const file of workerData.files) {
    let c; try { c = parseCSV(file.fp); } catch { processed++; continue; }
    processed++;
    // Require a complete 20-session outcome to avoid partial terminal trades.
    if (c.length < WINDOW + 21) { short++; continue; }
    usable++;
    const atr = atr14Array(c);
    const symbol = file.name.replace(/_OHLCV\.csv$/i, '');
    const nextAllowed = Object.fromEntries(IDS.map(id => [id, -1]));
    for (let i = WINDOW - 1; i <= c.length - 21; i++) {
      const w = c.slice(i - WINDOW + 1, i + 1);
      for (const id of IDS) {
        if (i < nextAllowed[id]) continue;
        // Match the optimizer: collect one stable raw feature matrix using
        // production defaults, then apply the candidate overlay below.
        for (const key of Object.values(KEYS)) engine.setArchetypeTuning(key, null);
        let r; try { r = engine.analyzeStock(w, KEYS[id], false); } catch { continue; }
        const d = r && r.__tuning;
        if (!d || !selected(id, d, tuning[id])) continue;
        if (id === 'EMAStack' && !d.crossedAboveToday) continue;
        const trade = simulate(c, i, atr[i] || c[i].c * 0.02, Number(tuning[id].slAtrMult || 2));
        if (!trade) continue;
        const row = { symbol, signalDate: dateOf(c[i].ts), signalIdx: i, stage: r.stage, score: r.inflectionScore, ...trade };
        acc[id].signals++;
        acc[id].trades.push(row);
        // Non-overlap uses the selected 20-session realized horizon, unless a
        // target or stop terminates earlier.
        const lockHorizon = Number(tuning[id].maxHoldBars) === 10 ? 10 : 20;
        nextAllowed[id] = row.byHorizon[lockHorizon].exitIdx + 1;
      }
    }
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }
  parentPort.postMessage({ type: 'done', acc, meta: { processed, usable, short } });
}

function stats(rows, horizon) {
  const n = rows.length;
  if (!n) return { n: 0, wins: 0, wr: 0, hit5: 0, pf: 0, avgPnl: 0, avgMFE: 0, avgMAE: 0, targetCount: 0 };
  const h = rows.map(r => r.byHorizon[horizon]);
  const wins = h.filter(x => x.pnl > 0).length;
  const targets = h.filter(x => x.hit5).length;
  const gw = h.filter(x => x.pnl > 0).reduce((a, x) => a + x.pnl, 0);
  const gl = -h.filter(x => x.pnl < 0).reduce((a, x) => a + x.pnl, 0);
  return { n, wins, wr: wins / n * 100, hit5: targets / n * 100, pf: gl ? gw / gl : Infinity, avgPnl: h.reduce((a, x) => a + x.pnl, 0) / n, avgMFE: h.reduce((a, x) => a + x.mfe, 0) / n, avgMAE: h.reduce((a, x) => a + x.mae, 0) / n, targetCount: targets };
}

function split(rows, horizon) {
  return { full: stats(rows, horizon), is: stats(rows.filter(r => r.signalDate <= OOS_CUT), horizon), oos: stats(rows.filter(r => r.signalDate > OOS_CUT), horizon) };
}

async function main() {
  if (!fs.existsSync(TUNE_JSON)) throw new Error(`Tuning JSON not found: ${TUNE_JSON}`);
  const tuned = JSON.parse(fs.readFileSync(TUNE_JSON, 'utf8'));
  const tuning = {};
  for (const id of IDS) {
    const row = tuned.bestBySet && tuned.bestBySet[id];
    const selected = row && (row.bestISRobust || row.bestQualified || row.best);
    const pasted = tuned.paramSets && tuned.paramSets[id];
    if (selected) tuning[id] = selected.p;
    else if (pasted && pasted.params) tuning[id] = pasted.params;
    else throw new Error(`No tuned candidate for ${id}`);
  }
  const files = fs.readdirSync(DATA_DIR).filter(n => n.toLowerCase().endsWith('.csv') && n !== 'ALL_SYMBOLS_OHLCV.csv').sort().map(name => ({ name, fp: path.join(DATA_DIR, name) }));
  const workers = Math.min(Math.max(1, Number(process.env.WORKERS || 10)), files.length || 1);
  const chunks = Array.from({ length: workers }, () => []);
  files.forEach((f, i) => chunks[i % workers].push(f));
  console.log(`5% objective backtest: ${files.length} files, ${workers} workers, complete 20-session outcomes only`);
  console.log(`Target: +${TARGET_PCT}% before ATR stop; OOS cutoff: ${OOS_CUT}`);
  const combined = Object.fromEntries(IDS.map(id => [id, empty()]));
  let done = 0, usable = 0, short = 0;
  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk, tuning } });
    w.on('message', msg => {
      if (msg.type === 'progress') { done += msg.n; if (done % 100 === 0) process.stdout.write(`  ${done}/${files.length}\r`); }
      else if (msg.type === 'done') {
        usable += msg.meta.usable; short += msg.meta.short;
        for (const id of IDS) { combined[id].signals += msg.acc[id].signals; combined[id].trades.push(...msg.acc[id].trades); }
        resolve();
      }
    });
    w.on('error', reject);
    w.on('exit', code => { if (code) reject(new Error(`worker exited ${code}`)); });
  })));

  const result = { generated: new Date().toISOString(), dataDir: DATA_DIR, tuneJson: TUNE_JSON, targetPct: TARGET_PCT, horizons: HORIZONS, window: WINDOW, oosCut: OOS_CUT, convention: 'exact analyzeStock; next-open entry; stop-first; non-overlap per symbol; complete 20-session outcomes only', tuning, meta: { files: files.length, usable, short }, clusters: {} };
  for (const id of IDS) {
    result.clusters[id] = { signals: combined[id].signals, trades: combined[id].trades.length, h10: split(combined[id].trades, 10), h20: split(combined[id].trades, 20) };
    const x = result.clusters[id];
    console.log(`${id.padEnd(18)} H20 full WR=${x.h20.full.wr.toFixed(1)} hit5=${x.h20.full.hit5.toFixed(1)} PF=${Number.isFinite(x.h20.full.pf) ? x.h20.full.pf.toFixed(2) : 'Inf'} avg=${x.h20.full.avgPnl.toFixed(2)} | OOS WR=${x.h20.oos.wr.toFixed(1)} hit5=${x.h20.oos.hit5.toFixed(1)} PF=${Number.isFinite(x.h20.oos.pf) ? x.h20.oos.pf.toFixed(2) : 'Inf'} avg=${x.h20.oos.avgPnl.toFixed(2)}`);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jp = path.join(OUT_DIR, `five_percent_objective_${stamp}.json`);
  fs.writeFileSync(jp, JSON.stringify(result, null, 2));
  const lines = [`5% objective backtest ${result.generated}`, `Data: ${DATA_DIR}`, `Target: +${TARGET_PCT}% before ATR stop`, `OOS cutoff: ${OOS_CUT}`, `Files=${files.length} usable=${usable} short=${short}`, ''];
  for (const id of IDS) {
    const x = result.clusters[id];
    for (const h of HORIZONS) {
      const z = x[`h${h}`];
      lines.push(`${id} H${h}: Full n=${z.full.n} WR=${z.full.wr.toFixed(2)}% Hit5=${z.full.hit5.toFixed(2)}% PF=${Number.isFinite(z.full.pf) ? z.full.pf.toFixed(2) : 'Inf'} Avg=${z.full.avgPnl.toFixed(2)}% MFE=${z.full.avgMFE.toFixed(2)}% MAE=${z.full.avgMAE.toFixed(2)}% | OOS n=${z.oos.n} WR=${z.oos.wr.toFixed(2)}% Hit5=${z.oos.hit5.toFixed(2)}% PF=${Number.isFinite(z.oos.pf) ? z.oos.pf.toFixed(2) : 'Inf'} Avg=${z.oos.avgPnl.toFixed(2)}% MFE=${z.oos.avgMFE.toFixed(2)}% MAE=${z.oos.avgMAE.toFixed(2)}%`);
    }
  }
  const tp = jp.replace(/\.json$/, '.txt');
  fs.writeFileSync(tp, lines.join('\n'));
  console.log(`Saved: ${jp}`);
  console.log(`Saved: ${tp}`);
}

if (isMainThread) main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
else workerMain();
