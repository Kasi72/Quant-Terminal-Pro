'use strict';

/**
 * Momentum Pocket and EMA Stack focused Sweet-Spot Hyper-Optimizer
 *
 * Runs a massive 100,000 combination search to find parameter sets that yield
 * maximum OOS hit-rate and Profit Factor at the +5% profit target.
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = path.join(__dirname, '_compiled');
const OUT_DIR    = path.join(__dirname, 'results');
const WINDOW     = 300;
const OOS_CUT    = '2025-05-05';
const COMBOS     = Number(process.env.COMBOS || 100000);
const MIN_OOS    = 50;

// Simulation constants
const TP = [5]; // Fixed 5% target mode!
const SL = [1.5, 2, 2.5, 3, 3.5, 4.0, 4.5, 5.0];
const HOLD = [10, 15, 20, 25];
const EXIT_N = TP.length * SL.length * HOLD.length;

const KEYS = [
  ['MomentumPocket', 'optimized_elite_10plus'],
  ['EMAStack', 'optimized_ultraselective_8plus']
];

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (!Number.isFinite(ts) || !Number.isFinite(o) || o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < l) continue;
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

function exitIndex(ti, si, hi) { return (ti * SL.length + si) * HOLD.length + hi; }

function outcomes(c, sig, atr) {
  const entryIdx = sig + 1;
  const out = new Int16Array(EXIT_N);
  const dur = new Uint8Array(EXIT_N);
  let ei = 0;
  for (let ti = 0; ti < TP.length; ti++) {
    const tpVal = entryIdx < c.length ? c[entryIdx].o * (1 + TP[ti] / 100) : 0;
    for (let si = 0; si < SL.length; si++) {
      const slMultiplier = SL[si];
      const stopVal = entryIdx < c.length ? c[entryIdx].o - slMultiplier * atr : 0;
      for (let hi = 0; hi < HOLD.length; hi++) {
        const holdBars = HOLD[hi];
        if (entryIdx >= c.length || !(c[entryIdx].o > 0)) { out[ei] = 0; dur[ei] = 0; ei++; continue; }
        const entry = c[entryIdx].o;
        const end = Math.min(c.length - 1, entryIdx + holdBars - 1);
        let result = 0, steps = end - entryIdx + 1, exitPrice = c[end].c;
        for (let j = entryIdx; j <= end; j++) {
          const b = c[j];
          if (b.o <= stopVal) { result = Math.round((b.o - entry) / entry * 1000); steps = j - sig; exitPrice = b.o; break; }
          if (b.l <= stopVal) { result = Math.round((stopVal - entry) / entry * 1000); steps = j - sig; exitPrice = stopVal; break; }
          if (b.h >= tpVal) { result = Math.round(TP[ti] * 10); steps = j - sig; exitPrice = tpVal; break; }
          if (j === end) { result = Math.round((b.c - entry) / entry * 1000); steps = j - sig; }
        }
        out[ei] = result;
        dur[ei] = steps;
        ei++;
      }
    }
  }
  return { out, dur };
}

function excursions(c, sig) {
  const entryIdx = sig + 1;
  if (entryIdx >= c.length || !(c[entryIdx].o > 0)) return { mfe10: 0, mfe20: 0, mae10: 0, mae20: 0 };
  const entry = c[entryIdx].o;
  const excursion = (adverse, horizon) => {
    const end = Math.min(c.length - 1, entryIdx + horizon - 1);
    let value = 0;
    for (let i = entryIdx; i <= end; i++) {
      const x = ((adverse ? c[i].l : c[i].h) - entry) / entry * 100;
      value = adverse ? Math.min(value, x) : Math.max(value, x);
    }
    return value;
  };
  return { mfe10: excursion(false, 10), mfe20: excursion(false, 20), mae10: excursion(true, 10), mae20: excursion(true, 20) };
}

function collectWorker() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  for (const [, key] of KEYS) engine.setArchetypeTuning(key, null);
  const events = Object.fromEntries(KEYS.map(([id]) => [id, []]));
  let processed = 0;

  for (const file of workerData.files) {
    let c; try { c = parseCSV(file.fp); } catch { processed++; continue; }
    processed++;
    if (c.length < WINDOW + 21) continue;
    const atr14 = atr14Array(c);
    const symbol = file.name.replace(/_OHLCV\.csv$/i, '');
    for (let i = WINDOW - 1; i < c.length - 21; i++) {
      const w = c.slice(i - WINDOW + 1, i + 1);

      for (const [id, key] of KEYS) {
        let r; try { r = engine.analyzeStock(w, key, false); } catch { continue; }
        if (!r || !['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage)) continue;

        const d = r.__tuning;
        if (!d) continue;

        const eo = outcomes(c, i, atr14[i] || c[i].c * 0.02);
        const ex = excursions(c, i);

        const row = {
          symbol,
          idx: i,
          date: new Date(c[i].ts * 1000).toISOString().slice(0, 10),
          d,
          o: eo.out,
          dur: eo.dur,
          ...ex
        };

        events[id].push(row);
      }
    }
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }
  parentPort.postMessage({ type: 'done', events });
}

function gv(values, k, stride) { return values[Math.floor(k / stride) % values.length]; }

function sweetSpotGridGen(id, k) {
  if (id === 'MomentumPocket') {
    return {
      minDd52W: gv([10, 15, 20, 25, 30, 40], k, 1),
      maxDd52W: gv([35, 40, 45, 50, 55, 65, 80], k, 2),
      minStabBars: gv([2, 3, 4, 5, 6, 8], k, 3),
      minCloseLoc: gv([40, 45, 50, 55, 60, 65], k, 5),
      minBodyPct: gv([5, 10, 15, 25, 35, 55], k, 7),
      maxUpperWick: gv([15, 20, 25, 30, 35, 40], k, 11),
      minVolRatio: gv([1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.5], k, 13),
      minRSI14: gv([15, 18, 20, 25, 30], k, 17),
      maxRSI14: gv([45, 50, 55, 60], k, 19),
      minCMF20: gv([-0.15, -0.1, -0.05, 0, 0.05, 0.1], k, 23),
      minOBVSlope10: gv([-1.5, -1.0, -0.5, 0, 0.5, 1.0], k, 29),
      minGateRSI14: gv([30, 35, 40, 45, 50], k, 31),
      maxGateRSI14: gv([45, 50, 55, 60], k, 37),
      maxGateRSI2: gv([30, 35, 40, 45, 50, 60], k, 41),
      minGateVolRatio: gv([1.5, 1.8, 2.0, 2.5, 3.0], k, 43),
      minCloseVsEMA20: gv([-999, -2, -1, 0, 0.5], k, 47),
      minEMA20VsEMA50: gv([-999, 0, 0.5, 1.0], k, 53),
      requireDIBull: gv([false, true], k, 59),
      maxBsc: gv([0, 1, 3, 5, 99], k, 61),
      minADX: gv([15, 20, 25, 30, 35], k, 67),
      minAtrPct14: gv([0, 1.0, 2.0], k, 71),
      maxAtrPct14: gv([999, 4.0, 5.0, 6.0], k, 73),
      tpPct: 5,
      slAtrMult: gv(SL, k, 79),
      maxHoldBars: gv(HOLD, k, 83)
    };
  }

  if (id === 'EMAStack') {
    return {
      minBelowBars: gv([1, 2, 3, 4, 6, 8], k, 1),
      minEMA10VsEma20: gv([0.05, 0.1, 0.2, 0.3, 0.5, 0.8], k, 2),
      minBodyPct: gv([20, 30, 40, 50, 60], k, 3),
      maxUpperWick: gv([10, 12, 15, 20, 25, 35], k, 5),
      maxCandleRisk: gv([5.0, 6.5, 8.0, 10.0, 12.0], k, 7),
      minVolRatio: gv([0.8, 1.0, 1.3, 1.6, 2.0, 2.5], k, 11),
      maxRSI2Last5: gv([25, 30, 35, 40, 50, 60], k, 13),
      minCMF20: gv([0.0, 0.05, 0.1, 0.15, 0.2], k, 17),
      minOBVSlope10: gv([-0.5, 0.0, 0.5, 1.0, 2.0], k, 19),
      minCloseVsEMA20: gv([-999, -1, -0.5, 0, 0.5], k, 23),
      minEMA20VsEMA50: gv([-999, 0, 0.5, 1.0], k, 29),
      requireDIBull: gv([false, true], k, 31),
      maxBsc: gv([0, 1, 3, 6, 99], k, 37),
      minADX: gv([10, 15, 20, 25, 30], k, 41),
      tpPct: 5,
      slAtrMult: gv(SL, k, 43),
      maxHoldBars: gv(HOLD, k, 47)
    };
  }
}

function selected(id, d, p) {
  let score = 0, conditions = 0;

  if (id === 'MomentumPocket') {
    if (d.cmf20 < p.minCMF20 || d.obvSlope10 < p.minOBVSlope10 || d.atrPct14 < (p.minAtrPct14 || 0) || d.atrPct14 > (p.maxAtrPct14 || 999) ||
        d.rsi14 < p.minGateRSI14 || d.rsi14 > p.maxGateRSI14 || d.rsi2 > p.maxGateRSI2 || d.volRatio20 < p.minGateVolRatio ||
        (p.minCloseVsEMA20 > -999 && d.closeVsEMA20 < p.minCloseVsEMA20) || (p.minEMA20VsEMA50 > -999 && d.ema20Vs50 < p.minEMA20VsEMA50)) return false;

    const candle = (d.isGreen && d.closeLoc >= p.minCloseLoc && d.bodyPct >= p.minBodyPct && d.upperWickPct <= p.maxUpperWick) || (d.hammer && d.closeLoc >= 60);
    const q = [d.dd52W >= p.minDd52W && d.dd52W <= p.maxDd52W, d.stabilizationBars >= p.minStabBars, candle, d.volRatio20 >= p.minVolRatio, d.rsi14 >= p.minRSI14 && d.rsi14 <= p.maxRSI14, (!p.requireDIBull || d.diBull) && (p.maxBsc >= 99 || d.bsc <= p.maxBsc) && d.adx >= p.minADX];
    conditions = q.filter(Boolean).length;
    score = (q[0] ? 18 : 0) + (q[1] ? 12 : 0) + (q[2] ? 20 : 0) + (q[3] ? 17 : 0) + (q[4] ? 13 : 0) + (q[5] ? 20 : 0) + Math.min(10, d.stabilizationBars * 3) + Math.min(5, (d.volRatio20 - 1.5) * 4);

    return conditions >= 4 && score >= 45;
  }

  if (id === 'EMAStack') {
    if (d.cmf20 < p.minCMF20 || d.obvSlope10 < p.minOBVSlope10 ||
        (p.minCloseVsEMA20 > -999 && d.closeVsEMA20 < p.minCloseVsEMA20) ||
        (p.minEMA20VsEMA50 > -999 && d.ema20Vs50 < p.minEMA20VsEMA50)) return false;

    const q = [true, d.belowCount >= p.minBelowBars, d.ema10VsEma20 >= p.minEMA10VsEma20 && d.isGreen && d.bodyPct >= p.minBodyPct && d.upperWickPct <= p.maxUpperWick && d.candleRisk <= p.maxCandleRisk, d.volRatio20 >= p.minVolRatio, d.recentlyOversold && d.rsi2Pass !== false, (!p.requireDIBull || d.diBull) && (p.maxBsc >= 99 || d.bsc <= p.maxBsc) && d.adx >= p.minADX];
    conditions = q.filter(Boolean).length;
    score = (q[0] ? 25 : 0) + (q[1] ? 15 : 0) + (q[2] ? 15 : 0) + (q[3] ? 15 : 0) + (q[4] ? 10 : 0) + (q[5] ? 20 : 0) + Math.min(10, d.belowCount * 2) + Math.min(5, (d.volRatio20 - 1.8) * 5);

    return conditions >= 4 && score >= 45;
  }

  return false;
}

function stats(rows) {
  const n = rows.length;
  if (!n) return { n: 0, wr: 0, hit5: 0, pf: 0, avg: 0, avgMFE10: 0, avgMFE20: 0, avgMAE10: 0, avgMAE20: 0 };
  const wins = rows.filter(x => x.pnl > 0).length, gw = rows.filter(x => x.pnl > 0).reduce((a, x) => a + x.pnl, 0), gl = -rows.filter(x => x.pnl < 0).reduce((a, x) => a + x.pnl, 0);
  const hit5 = rows.filter(x => x.pnl >= 4.9).length;
  return { n, wr: wins / n * 100, hit5: hit5 / n * 100, pf: gl ? gw / gl : Infinity, avg: rows.reduce((a, x) => a + x.pnl, 0) / n, avgMFE10: rows.reduce((a, x) => a + x.mfe10, 0) / n, avgMFE20: rows.reduce((a, x) => a + x.mfe20, 0) / n, avgMAE10: rows.reduce((a, x) => a + x.mae10, 0) / n, avgMAE20: rows.reduce((a, x) => a + x.mae20, 0) / n };
}

function evaluate(events, id, p) {
  const ti = 0;
  const si = SL.indexOf(p.slAtrMult);
  const hi = HOLD.indexOf(p.maxHoldBars);
  const ei = exitIndex(ti, si, hi);

  const by = {};
  for (const e of events) (by[e.symbol] ||= []).push(e);
  for (const a of Object.values(by)) a.sort((x, y) => x.idx - y.idx);

  const rows = [];
  for (const a of Object.values(by)) {
    let nextIdx = -1;
    for (const e of a) {
      if (e.idx < nextIdx || !selected(id, e.d, p)) continue;
      const pnl = e.o[ei] / 10;
      const dur = e.dur[ei];
      const exit = e.idx + dur;
      rows.push({ pnl, date: e.date, exit, mfe10: e.mfe10, mfe20: e.mfe20, mae10: e.mae10, mae20: e.mae20 });
      nextIdx = exit + 1;
    }
  }

  const full = stats(rows), is = stats(rows.filter(x => x.date <= OOS_CUT)), oos = stats(rows.filter(x => x.date > OOS_CUT));
  return { p, full, is, oos };
}

function fitness(r) {
  if (r.oos.n < MIN_OOS || r.full.n < MIN_OOS * 2) return -1e9;

  const pf = x => Math.min(8, Math.max(0, x.pf)) / 8;
  const avg = x => Math.max(0, Math.min(5, x.avg + 1)) / 6;
  const sampleBonus = Math.min(0.05, Math.log10(r.oos.n) / 100);

  const base = 0.40 * (r.oos.hit5 / 100) + 0.20 * (r.full.hit5 / 100) + 0.20 * pf(r.oos) + 0.10 * avg(r.oos) + 0.05 * pf(r.full) + 0.05 * avg(r.full);
  const consistency = (r.full.hit5 >= 50 && r.oos.hit5 >= 50 && r.full.avg > 0 && r.oos.avg > 0 && r.full.pf >= 1.0 && r.oos.pf >= 1.0) ? 0.15 : 0;

  return base + consistency + sampleBonus;
}

async function main() {
  const files = fs.readdirSync(DATA_DIR).filter(n => n.toLowerCase().endsWith('.csv') && n !== 'ALL_SYMBOLS_OHLCV.csv').sort().map(name => ({ name, fp: path.join(DATA_DIR, name) }));
  const workers = Math.min(10, files.length);
  const chunks = Array.from({ length: workers }, () => []);
  files.forEach((f, i) => chunks[i % workers].push(f));

  console.log(`\n======================================================================`);
  console.log(`SWEET-SPOT HYPER-OPTIMIZER — Sweeping ${files.length} symbols using ${workers} workers...`);
  console.log(`Analyzing actionable signals inside production engine to find optimal configurations.`);
  console.log(`======================================================================\n`);

  const all = Object.fromEntries(KEYS.map(([id]) => [id, []]));
  let done = 0;

  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk } });
    w.on('message', m => {
      if (m.type === 'progress') {
        done += m.n;
        if (done % 50 === 0) process.stdout.write(`  Processed ${done}/${files.length} symbols...\r`);
      } else if (m.type === 'done') {
        for (const [id] of KEYS) all[id].push(...m.events[id]);
        resolve();
      }
    });
    w.on('error', reject);
    w.on('exit', c => { if (c) reject(new Error(`worker exited with code ${c}`)); });
  })));

  console.log(`\nCollected events: ${KEYS.map(([id]) => `${id}=${all[id].length}`).join(' | ')}`);

  const report = {
    generated: new Date().toISOString(),
    combos: COMBOS,
    minOOS: MIN_OOS,
    bestBySet: {}
  };

  for (const [id] of KEYS) {
    console.log(`\nOptimising ${id} over ${COMBOS} combinations...`);
    let best = null, bestQualified = null, bestISRobust = null;

    for (let i = 0; i < COMBOS; i++) {
      const p = sweetSpotGridGen(id, i);
      const r = evaluate(all[id], id, p);
      const f = fitness(r);
      r.fitness = f;

      if (!best || f > best.fitness) {
        best = r;
      }

      const sampleOK = r.full.n >= MIN_OOS * 2 && r.oos.n >= MIN_OOS;
      const common = sampleOK && r.full.pf >= 1.0 && r.oos.pf >= 1.0 && r.full.avg > 0 && r.oos.avg > 0 && r.full.hit5 >= 50 && r.oos.hit5 >= 50;

      if (common && (!bestQualified || f > bestQualified.fitness)) {
        bestQualified = r;
      }

      const robust = common && r.is.pf >= 1.0 && r.is.avg > 0 && r.is.hit5 >= 50 && r.is.n >= 100;
      if (robust && (!bestISRobust || f > bestISRobust.fitness)) {
        bestISRobust = r;
      }
    }

    report.bestBySet[id] = { best, bestQualified, bestISRobust };

    const winner = bestISRobust || bestQualified || best;

    console.log(`  Winner for ${id}:`);
    console.log(`    Status:   ${bestISRobust ? 'ROBUST' : bestQualified ? 'QUALIFIED' : 'NO QUALIFIED'}`);
    console.log(`    Full:     n=${winner.full.n} Hit5=${winner.full.hit5.toFixed(1)}% PF=${winner.full.pf.toFixed(2)} Avg=${winner.full.avg.toFixed(2)}%`);
    console.log(`    OOS:      n=${winner.oos.n} Hit5=${winner.oos.hit5.toFixed(1)}% PF=${winner.oos.pf.toFixed(2)} Avg=${winner.oos.avg.toFixed(2)}%`);
    console.log(`    IS:       n=${winner.is.n} Hit5=${winner.is.hit5.toFixed(1)}% PF=${winner.is.pf.toFixed(2)} Avg=${winner.is.avg.toFixed(2)}%`);
    console.log(`    StopMult: ${winner.p.slAtrMult}× | Holding: ${winner.p.maxHoldBars} bars`);
    console.log(`    Params:   ${JSON.stringify(winner.p)}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jp = path.join(OUT_DIR, `sweet_spot_${stamp}.json`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(jp, JSON.stringify(report, null, 2));
  console.log(`\nSaved sweet-spot results → ${jp}\n`);
}

if (isMainThread) {
  main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
} else {
  collectWorker().catch(e => {
    parentPort.postMessage({ type: 'error', error: e.stack || String(e) });
    process.exitCode = 1;
  });
}
