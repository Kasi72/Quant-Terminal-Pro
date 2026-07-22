'use strict';
/**
 * MP + EMA Stack Hyper-Tuner — 2-phase grid search with bootstrap CI
 *
 * Phase 1: 200k random combos across expanded search space
 * Phase 2: 80k neighborhood refinement around Phase 1 winner
 * Bootstrap: 500 resamples → 95% CI on OOS Hit5%
 *
 * Fitness: OOS hit5 weighted + IS-OOS gap penalty + sample bonus
 * MFE/MAE capped at ±50% per trade to prevent bad-data corruption
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = path.join(__dirname, '_compiled_current');
const OUT_DIR    = path.join(__dirname, 'results');
const WINDOW     = 300;
const OOS_CUT    = '2025-05-05';
const PHASE1_N   = Number(process.env.PHASE1 || 200000);
const PHASE2_N   = Number(process.env.PHASE2 || 80000);
const BOOT_N     = 500;
const MIN_OOS    = 40;
const MIN_FULL   = 100;

const SL   = [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
const HOLD = [10, 15, 20, 25];
const TP   = [5];
const EXIT_N = TP.length * SL.length * HOLD.length;

const KEYS = [
  ['MomentumPocket', 'optimized_elite_10plus'],
  ['EMAStack',       'optimized_ultraselective_8plus'],
];

// ─── CSV / ATR helpers ───────────────────────────────────────────────────────

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
    if (!Number.isFinite(ts) || !o || !h || !l || !c || h < l) continue;
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
  const tr  = new Array(c.length).fill(0);
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

function exitIdx(si, hi) { return si * HOLD.length + hi; }  // TP fixed at 5%

function outcomes(c, sig, atr) {
  const ei = sig + 1;
  const out = new Int16Array(EXIT_N);
  const dur = new Uint8Array(EXIT_N);
  const tpVal = ei < c.length ? c[ei].o * 1.05 : 0;
  for (let si = 0; si < SL.length; si++) {
    const stop = ei < c.length ? c[ei].o - SL[si] * atr : 0;
    for (let hi = 0; hi < HOLD.length; hi++) {
      const idx = exitIdx(si, hi);
      if (ei >= c.length || !(c[ei].o > 0)) { out[idx] = 0; dur[idx] = 0; continue; }
      const entry = c[ei].o;
      const end   = Math.min(c.length - 1, ei + HOLD[hi] - 1);
      let result = 0, steps = end - ei + 1;
      for (let j = ei; j <= end; j++) {
        const b = c[j];
        if (b.o <= stop) { result = Math.round((b.o - entry) / entry * 1000); steps = j - sig; break; }
        if (b.l <= stop) { result = Math.round((stop - entry)  / entry * 1000); steps = j - sig; break; }
        if (b.h >= tpVal){ result = 50 /* = 5% × 10 */;                         steps = j - sig; break; }
        if (j === end)    { result = Math.round((b.c - entry) / entry * 1000); }
      }
      out[idx] = result;
      dur[idx] = steps;
    }
  }
  return { out, dur };
}

// MFE/MAE capped at ±50% to kill bad-data outliers
function excursions(c, sig) {
  const ei = sig + 1;
  if (ei >= c.length || !(c[ei].o > 0)) return { mfe10: 0, mae10: 0 };
  const entry = c[ei].o;
  const end10 = Math.min(c.length - 1, ei + 9);
  let mfe = 0, mae = 0;
  for (let i = ei; i <= end10; i++) {
    mfe = Math.max(mfe, Math.min(50, (c[i].h - entry) / entry * 100));
    mae = Math.min(mae, Math.max(-50, (c[i].l - entry) / entry * 100));
  }
  return { mfe10: mfe, mae10: mae };
}

// ─── Worker: collect raw signal events ──────────────────────────────────────

function collectWorker() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  for (const [, key] of KEYS) engine.setArchetypeTuning(key, null);

  const events = Object.fromEntries(KEYS.map(([id]) => [id, []]));
  let processed = 0;

  for (const file of workerData.files) {
    let c; try { c = parseCSV(file.fp); } catch { processed++; continue; }
    processed++;
    if (c.length < WINDOW + 25) continue;
    const atr14 = atr14Array(c);
    const symbol = file.name.replace(/_OHLCV\.csv$/i, '');

    for (let i = WINDOW - 1; i < c.length - 25; i++) {
      const w = c.slice(i - WINDOW + 1, i + 1);
      for (const [id, key] of KEYS) {
        let r; try { r = engine.analyzeStock(w, key, false); } catch { continue; }
        const d = r && r.__tuning;
        if (!d) continue;
        if (id === 'EMAStack' && !d.crossedAboveToday) continue;
        const eo = outcomes(c, i, atr14[i] || c[i].c * 0.02);
        const ex = excursions(c, i);
        events[id].push({
          symbol, idx: i,
          date: new Date(c[i].ts * 1000).toISOString().slice(0, 10),
          d, o: eo.out, dur: eo.dur,
          mfe10: ex.mfe10, mae10: ex.mae10,
        });
      }
    }
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }
  parentPort.postMessage({ type: 'done', events, processed });
}

// ─── Search-space grid generators ───────────────────────────────────────────

function randInt(a, max) { return a[Math.floor(Math.random() * a.length)]; }

const MP_SPACE = {
  // Gate params
  minCMF20:        [-0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1],
  minOBVSlope10:   [-2.0, -1.5, -1.0, -0.5, 0, 0.5, 1.0],
  minGateRSI14:    [25, 30, 35, 40, 42, 45, 48, 50],
  maxGateRSI14:    [45, 48, 50, 52, 55, 58, 60, 65],
  maxGateRSI2:     [25, 30, 35, 40, 45, 50, 55, 60],
  minGateVolRatio: [1.2, 1.5, 1.8, 2.0, 2.2, 2.5, 3.0, 3.5],
  minCloseVsEMA20: [-999, -2, -1, -0.5, 0, 0.5, 1.0],
  minEMA20VsEMA50: [-999, 0, 0.3, 0.5, 0.8, 1.0, 1.5],
  minAtrPct14:     [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
  maxAtrPct14:     [3.0, 4.0, 5.0, 6.0, 7.0, 999],
  // Condition params
  minDd52W:        [5, 8, 10, 12, 15, 18, 20, 25],
  maxDd52W:        [30, 35, 40, 45, 50, 55, 60, 70, 80],
  minStabBars:     [1, 2, 3, 4, 5, 6, 7, 8],
  minCloseLoc:     [35, 40, 43, 45, 48, 50, 55, 60],
  minBodyPct:      [5, 10, 15, 20, 25, 30, 35, 40, 50],
  maxUpperWick:    [15, 20, 25, 28, 30, 35, 40, 45],
  minVolRatio:     [0.8, 1.0, 1.2, 1.4, 1.5, 1.6, 1.8, 2.0, 2.5],
  minRSI14:        [15, 20, 25, 28, 30, 33, 35, 40],
  maxRSI14:        [45, 48, 50, 52, 55, 58, 60, 65, 70],
  requireDIBull:   [false, true],
  maxBsc:          [0, 1, 2, 3, 4, 5, 99],
  minADX:          [15, 18, 20, 22, 25, 28, 30, 35, 40],
  // Exit
  slAtrMult:       SL,
  maxHoldBars:     HOLD,
};

const ES_SPACE = {
  // Gate params
  minCMF20:        [0.0, 0.03, 0.05, 0.08, 0.10, 0.12, 0.15, 0.20],
  minOBVSlope10:   [-1.0, -0.5, 0.0, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0],
  minCloseVsEMA20: [-999, -1.0, -0.5, 0, 0.3, 0.5, 1.0],
  minEMA20VsEMA50: [-999, 0, 0.2, 0.4, 0.5, 0.8, 1.0],
  // Condition params
  minBelowBars:    [1, 2, 3, 4, 5, 6, 8, 10],
  minEMA10VsEma20: [0.0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1.0],
  minBodyPct:      [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
  maxUpperWick:    [5, 8, 10, 12, 15, 18, 20, 25, 30, 35],
  maxCandleRisk:   [3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0, 12.0],
  minVolRatio:     [0.5, 0.8, 1.0, 1.2, 1.3, 1.5, 1.8, 2.0, 2.5],
  maxRSI2Last5:    [20, 25, 30, 35, 40, 45, 50, 55, 60],
  requireDIBull:   [false, true],
  maxBsc:          [1, 2, 3, 4, 5, 6, 8, 99],
  minADX:          [10, 12, 15, 18, 20, 22, 25, 28, 30, 35],
  // Exit
  slAtrMult:       SL,
  maxHoldBars:     HOLD,
};

function randomParams(id, space) {
  const p = {};
  for (const [k, arr] of Object.entries(space)) p[k] = randInt(arr);
  return p;
}

// Neighborhood: perturb each param by ±1 step in the space
function neighborParams(id, base, space) {
  const p = { ...base };
  // pick 1-3 params to perturb
  const keys = Object.keys(space);
  const nPerturb = 1 + Math.floor(Math.random() * 3);
  for (let t = 0; t < nPerturb; t++) {
    const k = keys[Math.floor(Math.random() * keys.length)];
    const arr = space[k];
    const cur = arr.indexOf(p[k]);
    if (cur === -1) { p[k] = randInt(arr); continue; }
    const delta = Math.random() < 0.5 ? -1 : 1;
    const ni = Math.max(0, Math.min(arr.length - 1, cur + delta));
    p[k] = arr[ni];
  }
  return p;
}

// ─── Signal filter / selector ─────────────────────────────────────────────────

function selectedMP(d, p) {
  // Gate
  if (d.cmf20 < p.minCMF20 || d.obvSlope10 < p.minOBVSlope10 ||
      d.atrPct14 < p.minAtrPct14 || d.atrPct14 > p.maxAtrPct14 ||
      d.rsi14 < p.minGateRSI14 || d.rsi14 > p.maxGateRSI14 ||
      d.rsi2 > p.maxGateRSI2 || d.volRatio20 < p.minGateVolRatio ||
      (p.minCloseVsEMA20 > -999 && d.closeVsEMA20 < p.minCloseVsEMA20) ||
      (p.minEMA20VsEMA50 > -999 && d.ema20Vs50 < p.minEMA20VsEMA50)) return false;

  const candle = (d.isGreen && d.closeLoc >= p.minCloseLoc && d.bodyPct >= p.minBodyPct && d.upperWickPct <= p.maxUpperWick)
              || (d.hammer && d.closeLoc >= 60);
  const q = [
    d.dd52W >= p.minDd52W && d.dd52W <= p.maxDd52W,
    d.stabilizationBars >= p.minStabBars,
    candle,
    d.volRatio20 >= p.minVolRatio,
    d.rsi14 >= p.minRSI14 && d.rsi14 <= p.maxRSI14,
    (!p.requireDIBull || d.diBull) && (p.maxBsc >= 99 || d.bsc <= p.maxBsc) && d.adx >= p.minADX,
  ];
  const met = q.filter(Boolean).length;
  const score = (q[0]?3:0)+(q[1]?10:0)+(q[2]?16:0)+(q[3]?3:0)+(q[4]?39:0)+(q[5]?25:0)
    + Math.min(10, d.stabilizationBars * 3) + Math.min(5, (d.volRatio20 - 1.5) * 4);
  return met >= 4 && score >= 45;
}

function selectedES(d, p) {
  // Gate
  if (d.cmf20 < p.minCMF20 || d.obvSlope10 < p.minOBVSlope10 ||
      (p.minCloseVsEMA20 > -999 && d.closeVsEMA20 < p.minCloseVsEMA20) ||
      (p.minEMA20VsEMA50 > -999 && d.ema20Vs50 < p.minEMA20VsEMA50)) return false;

  const q = [
    true,
    d.belowCount >= p.minBelowBars,
    d.ema10VsEma20 >= p.minEMA10VsEma20 && d.isGreen && d.bodyPct >= p.minBodyPct
      && d.upperWickPct <= p.maxUpperWick && d.candleRisk <= p.maxCandleRisk,
    d.volRatio20 >= p.minVolRatio,
    d.recentlyOversold,
    (!p.requireDIBull || d.diBull) && (p.maxBsc >= 99 || d.bsc <= p.maxBsc) && d.adx >= p.minADX,
  ];
  const met = q.filter(Boolean).length;
  const score = (q[0]?25:0)+(q[1]?15:0)+(q[2]?15:0)+(q[3]?15:0)+(q[4]?10:0)+(q[5]?20:0)
    + Math.min(10, d.belowCount * 2) + Math.min(5, (d.volRatio20 - 1.8) * 5);
  return met >= 4 && score >= 45;
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

function statsFrom(rows) {
  const n = rows.length;
  if (!n) return { n: 0, wr: 0, hit5: 0, pf: 0, avg: 0, avgMFE10: 0, avgMAE10: 0 };
  let wins = 0, gw = 0, gl = 0, hit5 = 0, sumPnl = 0, sumMFE = 0, sumMAE = 0;
  for (const r of rows) {
    if (r.pnl > 0) { wins++; gw += r.pnl; }
    else if (r.pnl < 0) gl -= r.pnl;
    if (r.pnl >= 4.9) hit5++;
    sumPnl += r.pnl;
    sumMFE += r.mfe10;
    sumMAE  += r.mae10;
  }
  return { n, wr: wins/n*100, hit5: hit5/n*100, pf: gl ? gw/gl : Infinity, avg: sumPnl/n,
           avgMFE10: sumMFE/n, avgMAE10: sumMAE/n };
}

function evaluate(events, id, p) {
  const si = SL.indexOf(p.slAtrMult);
  const hi = HOLD.indexOf(p.maxHoldBars);
  const ei = exitIdx(si, hi);
  const selectFn = id === 'MomentumPocket' ? selectedMP : selectedES;

  // group by symbol for non-overlap enforcement
  const bySymbol = {};
  for (const e of events) (bySymbol[e.symbol] ||= []).push(e);

  const rows = [];
  for (const arr of Object.values(bySymbol)) {
    let nextIdx = -1;
    for (const e of arr) {
      if (e.idx < nextIdx || !selectFn(e.d, p)) continue;
      const pnl = e.o[ei] / 10;
      const dur = e.dur[ei];
      rows.push({ pnl, date: e.date, exit: e.idx + dur, mfe10: e.mfe10, mae10: e.mae10 });
      nextIdx = e.idx + dur + 1;
    }
  }

  const full = statsFrom(rows);
  const is   = statsFrom(rows.filter(r => r.date <= OOS_CUT));
  const oos  = statsFrom(rows.filter(r => r.date > OOS_CUT));
  return { p, full, is, oos, rows };
}

// ─── Fitness function ─────────────────────────────────────────────────────────

function fitness(r) {
  const { full, is, oos } = r;
  if (full.n < MIN_FULL || oos.n < MIN_OOS) return -1e9;

  const pfScale = x => Math.min(8, Math.max(0, x.pf)) / 8;
  const avgScale = x => Math.max(0, Math.min(6, x.avg + 1)) / 7;

  // IS-OOS gap penalty (overfit detection)
  const hit5Gap = Math.max(0, (is.hit5 - oos.hit5) / 100);
  const gapPenalty = hit5Gap > 0.10 ? hit5Gap * 0.5 : 0;

  const base = 0.45 * (oos.hit5 / 100)
             + 0.15 * (full.hit5 / 100)
             + 0.20 * pfScale(oos)
             + 0.08 * avgScale(oos)
             + 0.07 * pfScale(full)
             + 0.05 * avgScale(full)
             - gapPenalty;

  // Consistency bonus: both IS and OOS pass all quality bars
  const allGreen = full.hit5 >= 50 && oos.hit5 >= 50 && full.pf >= 1 && oos.pf >= 1
                && full.avg > 0 && oos.avg > 0;
  const consistent = is.hit5 >= 50 && is.pf >= 1 && is.avg > 0 && is.n >= 80;

  return base + (allGreen ? 0.10 : 0) + (consistent ? 0.08 : 0)
              + Math.min(0.05, Math.log10(oos.n + 1) / 100);
}

// ─── Bootstrap CI ─────────────────────────────────────────────────────────────

function bootstrap(rows, stat, nBoots = BOOT_N) {
  const n = rows.length;
  if (!n) return { mean: 0, lo: 0, hi: 0 };
  const samples = [];
  for (let b = 0; b < nBoots; b++) {
    const boot = [];
    for (let i = 0; i < n; i++) boot.push(rows[Math.floor(Math.random() * n)]);
    samples.push(stat(boot));
  }
  samples.sort((a, b) => a - b);
  return {
    mean: samples.reduce((a, x) => a + x, 0) / nBoots,
    lo:   samples[Math.floor(nBoots * 0.025)],
    hi:   samples[Math.floor(nBoots * 0.975)],
  };
}

// ─── Main orchestration ───────────────────────────────────────────────────────

async function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(n => n.toLowerCase().endsWith('.csv') && n !== 'ALL_SYMBOLS_OHLCV.csv')
    .sort()
    .map(name => ({ name, fp: path.join(DATA_DIR, name) }));

  const nWorkers = Math.min(10, files.length);
  const chunks   = Array.from({ length: nWorkers }, () => []);
  files.forEach((f, i) => chunks[i % nWorkers].push(f));

  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║        MP + EMA Stack Hyper-Tuner — 2-Phase Grid Search          ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝`);
  console.log(`  Stocks: ${files.length} | Workers: ${nWorkers} | Phase1: ${PHASE1_N} | Phase2: ${PHASE2_N} | Bootstrap: ${BOOT_N}`);
  console.log(`  OOS cutoff: ${OOS_CUT} | Min OOS trades: ${MIN_OOS}\n`);

  // ── Collect events ──
  const allEvents = Object.fromEntries(KEYS.map(([id]) => [id, []]));
  let done = 0;

  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk } });
    w.on('message', m => {
      if (m.type === 'progress') {
        done += m.n;
        if (done % 100 === 0) process.stdout.write(`  Collecting events: ${done}/${files.length}\r`);
      } else if (m.type === 'done') {
        for (const [id] of KEYS) allEvents[id].push(...m.events[id]);
        resolve();
      }
    });
    w.on('error', reject);
    w.on('exit', c => { if (c) reject(new Error(`Worker exited ${c}`)); });
  })));

  console.log(`\n  Events: ${KEYS.map(([id]) => `${id}=${allEvents[id].length}`).join(' | ')}\n`);

  const report = { generated: new Date().toISOString(), phase1: PHASE1_N, phase2: PHASE2_N, results: {} };

  for (const [id] of KEYS) {
    const events  = allEvents[id];
    const space   = id === 'MomentumPocket' ? MP_SPACE : ES_SPACE;

    console.log(`\n${'─'.repeat(64)}`);
    console.log(`  ${id} — Phase 1: ${PHASE1_N} random combos`);
    console.log(`${'─'.repeat(64)}`);

    // ── Phase 1: broad sweep ──
    let p1Best = null;
    for (let i = 0; i < PHASE1_N; i++) {
      const p = randomParams(id, space);
      const r = evaluate(events, id, p);
      const f = fitness(r);
      if (!p1Best || f > p1Best.fitness) {
        p1Best = { ...r, fitness: f };
        if (i > 0 && i % 10000 === 0) {
          process.stdout.write(`  [Phase1] ${i}/${PHASE1_N}  best fitness=${p1Best.fitness.toFixed(4)}  OOS Hit5=${p1Best.oos.hit5.toFixed(1)}%  n=${p1Best.oos.n}\r`);
        }
      }
    }
    console.log(`\n  Phase 1 winner: OOS Hit5=${p1Best.oos.hit5.toFixed(1)}%  PF=${p1Best.oos.pf.toFixed(2)}  Avg=${p1Best.oos.avg.toFixed(2)}%  n=${p1Best.oos.n}  fitness=${p1Best.fitness.toFixed(4)}`);

    // ── Phase 2: neighborhood refinement ──
    console.log(`  ${id} — Phase 2: ${PHASE2_N} neighborhood combos around Phase 1 winner`);
    let best = p1Best;
    for (let i = 0; i < PHASE2_N; i++) {
      const p = neighborParams(id, best.p, space);
      const r = evaluate(events, id, p);
      const f = fitness(r);
      if (f > best.fitness) {
        best = { ...r, fitness: f };
        if (i % 5000 === 0) {
          process.stdout.write(`  [Phase2] ${i}/${PHASE2_N}  best fitness=${best.fitness.toFixed(4)}  OOS Hit5=${best.oos.hit5.toFixed(1)}%  n=${best.oos.n}\r`);
        }
      }
    }
    console.log(`\n  Phase 2 winner: OOS Hit5=${best.oos.hit5.toFixed(1)}%  PF=${best.oos.pf.toFixed(2)}  Avg=${best.oos.avg.toFixed(2)}%  n=${best.oos.n}  fitness=${best.fitness.toFixed(4)}`);

    // ── Bootstrap CI on OOS hit5 ──
    const oosRows = best.rows.filter(r => r.date > OOS_CUT);
    const ci = bootstrap(oosRows, rows => statsFrom(rows).hit5);
    console.log(`  Bootstrap 95% CI on OOS Hit5: [${ci.lo.toFixed(1)}%, ${ci.hi.toFixed(1)}%]  mean=${ci.mean.toFixed(1)}%`);

    // ── Tier breakdown ──
    const isRobust    = best.full.n >= MIN_FULL && best.oos.n >= MIN_OOS
                      && best.oos.hit5 >= 55 && best.oos.pf >= 1.2 && best.oos.avg > 0
                      && best.is.hit5 >= 55 && best.is.pf >= 1.0 && best.is.avg > 0;
    const isQualified = best.full.n >= MIN_FULL && best.oos.n >= MIN_OOS
                      && best.oos.hit5 >= 50 && best.oos.pf >= 1.0 && best.oos.avg > 0;

    const status = isRobust ? 'ROBUST ✅' : isQualified ? 'QUALIFIED ⚠️' : 'BEST FOUND ❌';

    // ── Print result ──
    console.log(`\n  ┌─ ${id} Final Result — ${status}`);
    console.log(`  │  Full  n=${best.full.n.toString().padStart(4)}  Hit5=${best.full.hit5.toFixed(1)}%  PF=${best.full.pf.toFixed(2)}  Avg=${best.full.avg.toFixed(2)}%  MFE10=${best.full.avgMFE10.toFixed(1)}%`);
    console.log(`  │  IS    n=${best.is.n.toString().padStart(4)}  Hit5=${best.is.hit5.toFixed(1)}%  PF=${best.is.pf.toFixed(2)}  Avg=${best.is.avg.toFixed(2)}%`);
    console.log(`  │  OOS   n=${best.oos.n.toString().padStart(4)}  Hit5=${best.oos.hit5.toFixed(1)}%  PF=${best.oos.pf.toFixed(2)}  Avg=${best.oos.avg.toFixed(2)}%`);
    console.log(`  │  SL=${best.p.slAtrMult}×ATR  Hold=${best.p.maxHoldBars}bars  CI=[${ci.lo.toFixed(1)}%,${ci.hi.toFixed(1)}%]`);
    console.log(`  └─ Params: ${JSON.stringify(best.p)}`);

    // ── Ready-to-paste tuning call ──
    const tuningObj = { ...best.p };
    delete tuningObj.slAtrMult;
    delete tuningObj.maxHoldBars;
    const key = id === 'MomentumPocket' ? 'optimized_elite_10plus' : 'optimized_ultraselective_8plus';
    console.log(`\n  ╔═ APPLY TO stockEngine.ts ═══════════════════════════════════════╗`);
    console.log(`  ║ engine.setArchetypeTuning('${key}', ${JSON.stringify(tuningObj)})`);
    console.log(`  ╚═════════════════════════════════════════════════════════════════╝`);

    report.results[id] = {
      status, params: best.p, full: best.full, is: best.is, oos: best.oos,
      bootstrapCI: ci, fitness: best.fitness,
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jp = path.join(OUT_DIR, `hypertune_mp_ema_${stamp}.json`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(jp, JSON.stringify(report, null, 2));
  console.log(`\n  Saved → ${jp}\n`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

if (isMainThread) {
  main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
} else {
  collectWorker().catch(e => {
    parentPort.postMessage({ type: 'error', error: e.stack || String(e) });
    process.exitCode = 1;
  });
}
