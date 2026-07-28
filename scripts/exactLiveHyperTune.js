'use strict';

// Exact-live feature collection + walk-forward hyper-tuning. The engine emits
// non-enumerable per-bar debug features; this script never approximates signal
// generation and enforces per-symbol non-overlap for every exit combination.

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OUT_DIR = path.join(__dirname, 'results');
const WINDOW = 300;
const OOS_CUT = '2025-05-05';
const COMBOS = Number(process.env.COMBOS || 5000);
const MIN_OOS = Number(process.env.MIN_OOS || 50);
const TARGET5_MODE = process.env.TARGET5 === '1';
const ULTRA_HIT75_MODE = process.env.ULTRA_HIT75 === '1';
const HIT_TARGET = Number(process.env.HIT_TARGET || 75);
const HIT_RATE_OBJECTIVE = ULTRA_HIT75_MODE || process.env.HIT_RATE_MODE === '1';
const HYBRID_MODE = process.env.HYBRID === '1';
const RELAX_PS_ONE = process.env.RELAX_PS_ONE === '1';
const TP = TARGET5_MODE ? [5] : [2, 3, 4, 5, 6, 7, 8];
const SL = [1, 1.5, 2, 2.5, 3, 3.5];
const HOLD = TARGET5_MODE ? [10, 20] : [10, 15, 20, 25];
const EXIT_N = TP.length * SL.length * HOLD.length;
const BSC = [0, 1, 3, 5, 99];
const ADX = [0, 15, 20, 25, 30, 35, 45];
const KEYS = [
  ['VolumeFootprint', 'optimized_deployable_20plus'],
  ['CompressionCoil', 'optimized_highprecision_15plus'],
  ['MomentumPocket', 'optimized_elite_10plus'],
  ['EMAStack', 'optimized_ultraselective_8plus'],
  ['PerfectStorm', 'sniper_95plus'],
];

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

function exitIndex(t, s, h) { return (t * SL.length + s) * HOLD.length + h; }

function outcomes(c, sig, atr) {
  const out = new Int16Array(EXIT_N);
  const dur = new Uint8Array(EXIT_N);
  const entryIdx = sig + 1;
  if (entryIdx >= c.length || !(c[entryIdx].o > 0) || !(atr > 0)) return { out, dur };
  const entry = c[entryIdx].o;
  for (let ti = 0; ti < TP.length; ti++) for (let si = 0; si < SL.length; si++) for (let hi = 0; hi < HOLD.length; hi++) {
    const stop = entry - SL[si] * atr;
    const target = entry * (1 + TP[ti] / 100);
    const end = Math.min(c.length - 1, entryIdx + HOLD[hi] - 1);
    let exit = end, px = c[end].c;
    for (let j = entryIdx; j <= end; j++) {
      const b = c[j];
      if (b.o <= stop) { exit = j; px = b.o; break; }
      if (b.l <= stop) { exit = j; px = stop; break; }
      if (b.h >= target) { exit = j; px = target; break; }
      if (j === end) { exit = j; px = b.c; }
    }
    out[exitIndex(ti, si, hi)] = Math.max(-32767, Math.min(32767, Math.round(((px - entry) / entry * 100) * 10)));
    dur[exitIndex(ti, si, hi)] = Math.min(255, exit - sig);
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
  let processed = 0, usable = 0, short = 0;
  for (const file of workerData.files) {
    let c; try { c = parseCSV(file.fp); } catch { processed++; continue; }
    processed++;
    if (c.length < WINDOW + 2) { short++; continue; }
    usable++;
    const atr14 = atr14Array(c);
    const symbol = file.name.replace(/_OHLCV\.csv$/i, '');
    for (let i = WINDOW - 1; i < c.length - 1; i++) {
      if (TARGET5_MODE && i > c.length - 21) continue;
      const w = c.slice(i - WINDOW + 1, i + 1);
      for (const [id, key] of KEYS) {
        let r; try { r = engine.analyzeStock(w, key, false); } catch { continue; }
        const d = r && r.__tuning;
        if (!d) continue;
        // Hard gates that are immutable in the live functions.
        if (id === 'EMAStack' && !d.crossedAboveToday) continue;
        if (id === 'PerfectStorm' && d.fires < (RELAX_PS_ONE ? 1 : 2)) continue;
        const eo = outcomes(c, i, atr14[i] || c[i].c * 0.02);
        const ex = excursions(c, i);
        events[id].push({ symbol, idx: i, date: new Date(c[i].ts * 1000).toISOString().slice(0, 10), d, o: eo.out, dur: eo.dur, ...ex });
      }
    }
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }
  parentPort.postMessage({ type: 'done', events, meta: { processed, usable, short } });
}

function rand(a, b) { return a + Math.random() * (b - a); }
function ri(a, b) { return Math.floor(rand(a, b + 1)); }
function pick(a) { return a[ri(0, a.length - 1)]; }
function r1(a, b) { return +rand(a, b).toFixed(1); }
function r0(a, b) { return Math.round(rand(a, b)); }

function gen(id) {
  if (id === 'VolumeFootprint') return { minVolRatio:r1(2.5,8), minCloseLoc:r0(55,96), maxUpperWick:r0(5,30), minHi20Frac:+rand(.80,.99).toFixed(3), minRangeATR:r1(.8,4), maxGapDownPct:r1(-5,0), requireDIBull:Math.random()>.5, maxBsc:pick(BSC), minADX:pick(ADX), tpPct:pick(TP), slAtrMult:pick(SL), maxHoldBars:pick(HOLD) };
  if (id === 'CompressionCoil') return { minCompressionBars:ri(5,14), maxCompressionBars:ri(8,18), minVolumeDeclineDays:ri(1,5), minPricePos20:r0(35,85), maxBBWidthPctl:r0(10,60), maxRangeATR:r1(.4,1.3), minCloseLoc:r0(30,75), minBodyPct:r0(20,75), maxCandleRisk:r0(5,14), requireDIBull:Math.random()>.5, maxBsc:pick(BSC), minADX:pick(ADX), tpPct:pick(TP), slAtrMult:pick(SL), maxHoldBars:pick(HOLD) };
  if (id === 'MomentumPocket') return { minDd52W:r0(10,60), maxDd52W:r0(35,80), minStabBars:ri(1,10), minCloseLoc:r0(25,90), minBodyPct:r0(10,80), maxUpperWick:r0(10,60), minVolRatio:r1(.6,4), minRSI14:r0(5,55), maxRSI14:r0(35,85), requireDIBull:Math.random()>.5, maxBsc:pick(BSC), minADX:pick(ADX), tpPct:pick(TP), slAtrMult:pick(SL), maxHoldBars:pick(HOLD) };
  if (id === 'EMAStack') return { minBelowBars:ri(1,12), minEMA10VsEma20:r1(.1,2), minBodyPct:r0(15,85), maxUpperWick:r0(10,55), maxCandleRisk:r0(5,15), minVolRatio:r1(.6,4), maxRSI2Last5:r0(10,75), requireDIBull:Math.random()>.5, maxBsc:pick(BSC), minADX:pick(ADX), tpPct:pick(TP), slAtrMult:pick(SL), maxHoldBars:pick(HOLD) };
  return { minFires:ri(2,4), minADXGate:ri(20,60), minQualityTier:ri(1,4), maxCandleRisk:r0(8,20), tpPct:pick(TP), slAtrMult:pick(SL), maxHoldBars:pick(HOLD) };
}

// Deterministic mixed-grid coordinates. Strides spread each parameter across
// the fixed grid instead of relying on a lucky random seed.
function gv(values, k, stride) { return values[Math.floor(k / stride) % values.length]; }
function ultraGridGen(id, k) {
  if (id === 'VolumeFootprint') return {
    minVolRatio: gv([4.5, 5, 6, 7, 8], k, 1),
    minCloseLoc: gv([70, 78, 85, 92], k, 2),
    maxUpperWick: gv([5, 8, 12, 16], k, 3),
    minHi20Frac: gv([.88, .92, .95, .98], k, 5),
    minRangeATR: gv([2.5, 3, 3.5, 4, 5], k, 7),
    maxGapDownPct: gv([-1, 0], k, 11),
    minCMF20: gv([.2, .3, .4, .5], k, 13),
    minOBVSlope10: gv([1, 2, 3, 4], k, 17),
    minCloseVsEMA20: gv([0, .5, 1, 2], k, 19),
    minEMA20VsEMA50: gv([0, .5, 1, 2], k, 23),
    requireDIBull: true, maxBsc: gv([0, 1, 3], k, 29), minADX: gv([30, 40, 50, 60], k, 37),
    tpPct: pick(TP), slAtrMult: pick(SL), maxHoldBars: pick(HOLD)
  };
  if (id === 'CompressionCoil') {
    const minCompressionBars = gv([9, 10, 11, 12, 14], k, 1);
    return {
      minCompressionBars, maxCompressionBars: Math.max(minCompressionBars, gv([10, 12, 14, 16, 18], k, 2)),
      minVolumeDeclineDays: gv([2, 3, 4, 5], k, 3), minPricePos20: gv([65, 75, 85, 90], k, 5),
      maxBBWidthPctl: gv([10, 15, 20, 25], k, 7), maxRangeATR: gv([.5, .7, .9], k, 11),
      minCloseLoc: gv([55, 65, 75, 85], k, 13), minBodyPct: gv([35, 50, 65, 80], k, 17),
      maxCandleRisk: gv([6, 8, 10], k, 19), minCMF20: gv([.15, .25, .35, .45], k, 23),
      minOBVSlope10: gv([0, .5, 1, 2], k, 29), minGateVolRatio: gv([2.5, 3, 4, 5], k, 31),
      minCloseVsEMA20: gv([0, .5, 1, 2], k, 37), minEMA20VsEMA50: gv([0, .5, 1, 2], k, 41),
      requireDIBull: true, maxBsc: gv([0, 1, 3], k, 47), minADX: gv([30, 40, 50, 60], k, 53),
      tpPct: pick(TP), slAtrMult: pick(SL), maxHoldBars: pick(HOLD)
    };
  }
  if (id === 'MomentumPocket') {
    const minDd52W = gv([20, 30, 40, 50, 60], k, 1);
    return {
      minDd52W, maxDd52W: Math.max(minDd52W, gv([35, 45, 55, 65, 75], k, 2)),
      minStabBars: gv([3, 5, 7, 9], k, 3), minCloseLoc: gv([55, 65, 75, 85], k, 5),
      minBodyPct: gv([35, 50, 65, 80], k, 7), maxUpperWick: gv([10, 20, 30], k, 11),
      minVolRatio: gv([1.8, 2.5, 3, 4], k, 13), minRSI14: gv([15, 25, 35, 40], k, 17),
      maxRSI14: gv([45, 50, 55], k, 19), minCMF20: gv([0, .1, .2, .3], k, 23),
      minOBVSlope10: gv([0, .5, 1, 2], k, 29), minGateRSI14: gv([35, 40, 45], k, 31),
      maxGateRSI14: gv([45, 50, 55], k, 37), maxGateRSI2: gv([25, 35, 45], k, 41),
      minGateVolRatio: gv([2.5, 3, 4, 5], k, 43), minCloseVsEMA20: gv([-999, 0, .5, 1], k, 47),
      minEMA20VsEMA50: gv([0, .5, 1, 2], k, 53), requireDIBull: true, maxBsc: gv([0, 1, 3], k, 61),
      minADX: gv([25, 35, 45, 55], k, 67), tpPct: pick(TP), slAtrMult: pick(SL), maxHoldBars: pick(HOLD)
    };
  }
  if (id === 'EMAStack') return {
    minBelowBars: gv([3, 5, 7, 10], k, 1), minEMA10VsEma20: gv([.5, .8, 1.2, 1.6, 2], k, 2),
    minBodyPct: gv([45, 60, 75, 85], k, 3), maxUpperWick: gv([5, 10, 15, 20], k, 5),
    maxCandleRisk: gv([6, 8, 10], k, 7), minVolRatio: gv([1.5, 2, 2.5, 3.5, 4.5], k, 11),
    maxRSI2Last5: gv([25, 35, 45, 50], k, 13), minCMF20: gv([.15, .25, .35, .45], k, 17),
    minOBVSlope10: gv([1, 2, 3, 4], k, 19), minCloseVsEMA20: gv([0, .5, 1, 2], k, 23),
    minEMA20VsEMA50: gv([0, .5, 1, 2], k, 29), requireDIBull: true, maxBsc: gv([0, 1, 3], k, 37),
    minADX: gv([25, 35, 45, 55], k, 41), tpPct: pick(TP), slAtrMult: pick(SL), maxHoldBars: pick(HOLD)
  };
  return {
    minFires: gv([3, 4], k, 1), minADXGate: gv([35, 45, 55, 65], k, 2),
    minQualityTier: gv([3, 4], k, 3), maxCandleRisk: gv([8, 10, 12], k, 5),
    minCMF20: gv([.1, .2, .3, .4], k, 7), minOBVSlope10: gv([0, .5, 1, 2], k, 11),
    minCloseVsEMA20: gv([0, .5, 1, 2], k, 13), minEMA20VsEMA50: gv([0, .5, 1, 2], k, 17),
    tpPct: pick(TP), slAtrMult: pick(SL), maxHoldBars: pick(HOLD)
  };
}
function hybridGridGen(id, k) {
  if (id === 'VolumeFootprint') return {
    minVolRatio: gv([3.7, 4, 4.5, 5, 5.5, 6], k, 1), minCloseLoc: gv([60, 68, 75, 82], k, 2),
    maxUpperWick: gv([12, 16, 20, 25], k, 3), minHi20Frac: gv([.82, .88, .92, .95], k, 5),
    minRangeATR: gv([2.4, 2.8, 3, 3.5], k, 7), maxGapDownPct: gv([-2.6, -1, 0], k, 11),
    minCMF20: gv([.15, .2, .3], k, 13), minOBVSlope10: gv([.5, 1, 2], k, 17), minAtrPct14: gv([0, 1.5, 2, 2.5, 3], k, 18),
    minCloseVsEMA20: gv([0, .5, 1], k, 19), minEMA20VsEMA50: gv([0, .5, 1], k, 23),
    requireDIBull: gv([false, true], k, 29), maxBsc: gv([0, 1, 3], k, 31), minADX: gv([25, 35, 45, 55], k, 37),
    tpPct: pick(TP), slAtrMult: pick([1.5, 2, 2.5, 3, 3.5]), maxHoldBars: pick(HOLD)
  };
  if (id === 'CompressionCoil') {
    const minCompressionBars = gv([8, 9, 10, 11, 12], k, 1);
    return {
      minCompressionBars, maxCompressionBars: Math.max(minCompressionBars, gv([10, 12, 14, 16], k, 2)),
      minVolumeDeclineDays: gv([1, 2, 3], k, 3), minPricePos20: gv([50, 60, 70, 80], k, 5),
      maxBBWidthPctl: gv([20, 25, 30, 40], k, 7), maxRangeATR: gv([.7, .9, 1.1], k, 11),
      minCloseLoc: gv([40, 45, 55, 65], k, 13), minBodyPct: gv([20, 35, 50, 65], k, 17),
      maxCandleRisk: gv([8, 10, 12], k, 19), minCMF20: gv([.1, .15, .2, .3], k, 23),
      minOBVSlope10: gv([-1, 0, .5, 1], k, 29), minAtrPct14: gv([0, 1.5, 2, 2.5, 3], k, 30), minGateVolRatio: gv([1.5, 2, 2.5, 3], k, 31),
      minCloseVsEMA20: gv([0, .5, 1], k, 37), minEMA20VsEMA50: gv([0, .5, 1], k, 41),
      requireDIBull: gv([false, true], k, 43), maxBsc: gv([0, 1, 3], k, 47), minADX: gv([25, 35, 45], k, 53),
      tpPct: pick(TP), slAtrMult: pick([1.5, 2, 2.5, 3, 3.5]), maxHoldBars: pick(HOLD)
    };
  }
  if (id === 'MomentumPocket') {
    const minDd52W = gv([15, 25, 34, 40, 45, 55], k, 1);
    return {
      minDd52W, maxDd52W: Math.max(minDd52W, gv([40, 45, 50, 55, 65], k, 2)),
      minStabBars: gv([2, 3, 5, 7], k, 3), minCloseLoc: gv([43, 55, 60, 68], k, 5),
      minBodyPct: gv([15, 35, 50, 60], k, 7), maxUpperWick: gv([20, 30, 40], k, 11),
      minVolRatio: gv([1.8, 2, 2.5, 3], k, 13), minRSI14: gv([20, 30, 35, 40], k, 17),
      maxRSI14: gv([50, 55, 60], k, 19), minCMF20: gv([-.1, 0, .1], k, 23),
      minOBVSlope10: gv([-1, 0, .5], k, 29), minAtrPct14: gv([0, 1.5, 2, 2.5, 3, 3.5], k, 30), maxAtrPct14: gv([999, 3.5, 4.5, 5.5, 7], k, 32), minGateRSI14: gv([35, 40, 45], k, 31),
      maxGateRSI14: gv([50, 55], k, 37), maxGateRSI2: gv([40, 50], k, 41),
      minGateVolRatio: gv([2, 2.5, 3], k, 43), minCloseVsEMA20: gv([0, .5], k, 47),
      minEMA20VsEMA50: gv([0, .5, 1], k, 53), requireDIBull: gv([false, true], k, 59),
      maxBsc: gv([0, 1, 3], k, 61), minADX: gv([20, 30, 35, 45], k, 67),
      tpPct: pick(TP), slAtrMult: pick([2, 2.5, 3, 3.5]), maxHoldBars: pick(HOLD)
    };
  }
  if (id === 'EMAStack') return {
    minBelowBars: gv([1, 2, 3, 5, 8], k, 1), minEMA10VsEma20: gv([.2, .3, .5, 1, 1.5], k, 2),
    minBodyPct: gv([40, 50, 65, 80], k, 3), maxUpperWick: gv([12, 20, 25], k, 5),
    maxCandleRisk: gv([8, 10, 12], k, 7), minVolRatio: gv([.8, 1.3, 1.6, 2, 2.5], k, 11),
    maxRSI2Last5: gv([40, 50, 60], k, 13), minCMF20: gv([.1, .15, .2], k, 17),
    minOBVSlope10: gv([.5, 1, 2], k, 19), minCloseVsEMA20: gv([-.5, 0, .5], k, 23),
    minEMA20VsEMA50: gv([0, .5, 1], k, 29), requireDIBull: gv([false, true], k, 31),
    maxBsc: gv([0, 1, 3], k, 37), minADX: gv([15, 25, 35, 45], k, 41),
    tpPct: pick(TP), slAtrMult: pick([2, 2.5, 3, 3.5]), maxHoldBars: pick(HOLD)
  };
  return {
    minFires: gv(RELAX_PS_ONE ? [1, 2, 3] : [2, 3], k, 1), minADXGate: gv([25, 30, 35, 45], k, 2), minQualityTier: gv([1, 2, 3], k, 3),
    maxCandleRisk: gv([10, 12, 16], k, 5), minCMF20: gv([.05, .1, .15, .2], k, 7),
    minOBVSlope10: gv([-1.5, -.5, 0, .5], k, 11), minAtrPct14: gv([0, 2, 2.5, 3, 3.5, 4], k, 12), maxAtrPct14: gv([999, 4, 5, 6, 8], k, 14), minCloseVsEMA20: gv([-999, 0, .5], k, 13),
    minEMA20VsEMA50: gv([-999, 0, .5], k, 17), tpPct: pick(TP),
    slAtrMult: pick([1.5, 2, 2.5, 3, 3.5]), maxHoldBars: pick(HOLD)
  };
}
function gridGen(id, k) {
  if (ULTRA_HIT75_MODE) return ultraGridGen(id, k);
  if (HYBRID_MODE) return hybridGridGen(id, k);
  if (ULTRA_HIT75_MODE) return ultraGridGen(id, k);
  if (id === 'VolumeFootprint') return { minVolRatio:gv([2.8,3.2,3.6,4,4.5,5,6],k,1), minCloseLoc:gv([60,68,75,82,88,94],k,2), maxUpperWick:gv([8,12,16,20,25,30],k,3), minHi20Frac:gv([.82,.86,.9,.94,.97],k,5), minRangeATR:gv([1.5,2,2.5,3,3.5],k,7), maxGapDownPct:gv([-5,-4,-3,-2,-1,0],k,11), minCMF20:gv([.15,.2,.3,.4],k,13), minOBVSlope10:gv([.5,1,2,3],k,17), minCloseVsEMA20:gv([-999,0,.5,1],k,19), minEMA20VsEMA50:gv([-999,0,.5,1],k,23), requireDIBull:gv([false,true],k,29), maxBsc:gv(BSC,k,31), minADX:gv(ADX,k,37), tpPct:gv(TP,k,41), slAtrMult:gv(SL,k,43), maxHoldBars:gv(HOLD,k,47) };
  if (id === 'CompressionCoil') { const minCompressionBars=gv([5,7,9,10,11,12],k,1); const maxCompressionBars=Math.max(minCompressionBars,gv([8,10,12,14,16],k,2)); return { minCompressionBars, maxCompressionBars, minVolumeDeclineDays:gv([1,2,3,4,5],k,3), minPricePos20:gv([40,50,60,70,80],k,5), maxBBWidthPctl:gv([15,25,35,45,55],k,7), maxRangeATR:gv([.5,.7,.9,1.1,1.3],k,11), minCloseLoc:gv([40,50,60,70],k,13), minBodyPct:gv([20,35,50,65],k,17), maxCandleRisk:gv([6,8,10,12,14],k,19), minCMF20:gv([.1,.15,.2,.3],k,23), minOBVSlope10:gv([-1,-.5,0,.5,1],k,29), minGateVolRatio:gv([1.5,2,2.5,3],k,31), minCloseVsEMA20:gv([-999,0,.5,1],k,37), minEMA20VsEMA50:gv([-999,0,.5,1],k,41), requireDIBull:gv([false,true],k,43), maxBsc:gv(BSC,k,47), minADX:gv(ADX,k,53), tpPct:gv(TP,k,59), slAtrMult:gv(SL,k,61), maxHoldBars:gv(HOLD,k,67) }; }
  if (id === 'MomentumPocket') { const minDd52W=gv([15,25,35,45,55,65],k,1); const maxDd52W=Math.max(minDd52W,gv([40,50,60,70,80],k,2)); const minRSI14=gv([10,20,30,40,50],k,17); return { minDd52W, maxDd52W, minStabBars:gv([1,2,3,4,5,6,8],k,3), minCloseLoc:gv([30,45,60,75],k,5), minBodyPct:gv([15,30,45,60,75],k,7), maxUpperWick:gv([20,30,40,50,60],k,11), minVolRatio:gv([.8,1.2,1.6,2,2.5,3,3.5],k,13), minRSI14, maxRSI14:Math.max(gv([45,55,65,75,85],k,19),minRSI14), minCMF20:gv([-.1,0,.1,.2],k,23), minOBVSlope10:gv([-1,-.5,0,.5,1],k,29), minGateRSI14:gv([35,40,45],k,31), maxGateRSI14:gv([50,55,60],k,37), maxGateRSI2:gv([40,50,60],k,41), minGateVolRatio:gv([2,2.5,3,3.5],k,43), minCloseVsEMA20:gv([-999,0,.5,1],k,47), minEMA20VsEMA50:gv([-999,0,.5,1],k,53), requireDIBull:gv([false,true],k,59), maxBsc:gv(BSC,k,61), minADX:gv(ADX,k,67), tpPct:gv(TP,k,71), slAtrMult:gv(SL,k,73), maxHoldBars:gv(HOLD,k,79) }; }
  if (id === 'EMAStack') return { minBelowBars:gv([1,2,3,5,8,10],k,1), minEMA10VsEma20:gv([.2,.4,.6,.8,1,1.2,1.5],k,2), minBodyPct:gv([20,35,50,65,80],k,3), maxUpperWick:gv([10,15,20,30,40,50],k,5), maxCandleRisk:gv([6,8,10,12,15],k,7), minVolRatio:gv([.8,1.2,1.6,2,2.5,3,3.5],k,11), maxRSI2Last5:gv([20,30,40,50,60,70],k,13), minCMF20:gv([.1,.15,.2,.3],k,17), minOBVSlope10:gv([.5,1,2,3],k,19), minCloseVsEMA20:gv([-.5,0,.5,1],k,23), minEMA20VsEMA50:gv([-.5,0,.5,1],k,29), requireDIBull:gv([false,true],k,31), maxBsc:gv(BSC,k,37), minADX:gv(ADX,k,41), tpPct:gv(TP,k,43), slAtrMult:gv(SL,k,47), maxHoldBars:gv(HOLD,k,53) };
  return { minFires:gv(RELAX_PS_ONE?[1,2,3,4]:[2,3,4],k,1), minADXGate:gv([25,30,35,40,45,50,55,60],k,2), minQualityTier:gv([1,2,3,4],k,3), maxCandleRisk:gv([8,10,12,14,16,18],k,5), minCMF20:gv([.05,.1,.15,.2],k,7), minOBVSlope10:gv([-1.5,-.5,0,.5,1],k,11), minCloseVsEMA20:gv([-999,0,.5,1],k,13), minEMA20VsEMA50:gv([-999,0,.5,1],k,17), tpPct:gv(TP,k,19), slAtrMult:gv(SL,k,23), maxHoldBars:gv(HOLD,k,29) };
}

function stageOk(conditions, score) { return conditions >= 4 && score >= 45; }
function passDmi(d, p, defaultBsc, defaultAdx, defaultBull) {
  return (!p.requireDIBull && !defaultBull || p.requireDIBull === false || d.diBull) && (p.maxBsc >= 99 || d.bsc <= p.maxBsc) && d.adx >= p.minADX;
}
function selected(id, d, p) {
  let score = 0, conditions = 0;
  if (id === 'VolumeFootprint') {
    if (d.cmf20 < p.minCMF20 || d.obvSlope10 < p.minOBVSlope10 || d.atrPct14 < (p.minAtrPct14 || 0) || d.closeVsEMA20 < p.minCloseVsEMA20 || d.ema20Vs50 < p.minEMA20VsEMA50) return false;
    const q = [d.volRatio20>=p.minVolRatio, d.closeLoc>=p.minCloseLoc&&d.upperWickPct<=p.maxUpperWick, d.hi20Frac>=p.minHi20Frac, d.rangeATR>=p.minRangeATR, d.gapDownPct>=p.maxGapDownPct, (!p.requireDIBull||d.diBull)&&(p.maxBsc>=99||d.bsc<=p.maxBsc)&&d.adx>=p.minADX];
    conditions=q.filter(Boolean).length; score=(q[0]?20:0)+(q[1]?20:0)+(q[2]?15:0)+(q[3]?20:0)+(q[4]?10:0)+(q[5]?15:0)+Math.min(10,(d.volRatio20-3)*5)+Math.min(5,(d.closeLoc-68)*.3);
  } else if (id === 'CompressionCoil') {
    if (d.cmf20 < p.minCMF20 || d.obvSlope10 < p.minOBVSlope10 || d.volRatio20 < p.minGateVolRatio || d.closeVsEMA20 < p.minCloseVsEMA20 || d.ema20Vs50 < p.minEMA20VsEMA50) return false;
    const q=[d.compressionBars>=p.minCompressionBars&&d.compressionBars<=p.maxCompressionBars,d.volDeclineDays>=p.minVolumeDeclineDays,d.pricePos20>=p.minPricePos20,d.bbWidthPctl<=p.maxBBWidthPctl,d.rangeATR<=p.maxRangeATR&&d.isGreen&&d.closeLoc>=p.minCloseLoc&&d.bodyPct>=p.minBodyPct&&d.candleRisk<=p.maxCandleRisk,(!p.requireDIBull||d.diBull)&&(p.maxBsc>=99||d.bsc<=p.maxBsc)&&d.adx>=p.minADX];
    conditions=q.filter(Boolean).length; score=(q[0]?20:0)+(q[1]?15:0)+(q[2]?15:0)+(q[3]?20:0)+(q[4]?15:0)+(q[5]?15:0)+Math.min(10,d.compressionBars*3)+Math.min(5,Math.max(0,d.pricePos20-65)*.5);
  } else if (id === 'MomentumPocket') {
    if (d.cmf20 < p.minCMF20 || d.obvSlope10 < p.minOBVSlope10 || d.atrPct14 < (p.minAtrPct14 || 0) || d.atrPct14 > (p.maxAtrPct14 || 999) || d.rsi14 < p.minGateRSI14 || d.rsi14 > p.maxGateRSI14 || d.rsi2 > p.maxGateRSI2 || d.volRatio20 < p.minGateVolRatio || d.closeVsEMA20 < p.minCloseVsEMA20 || d.ema20Vs50 < p.minEMA20VsEMA50) return false;
    const candle=(d.isGreen&&d.closeLoc>=p.minCloseLoc&&d.bodyPct>=p.minBodyPct&&d.upperWickPct<=p.maxUpperWick)||(d.hammer&&d.closeLoc>=60);
    const q=[d.dd52W>=p.minDd52W&&d.dd52W<=p.maxDd52W,d.stabilizationBars>=p.minStabBars,candle,d.volRatio20>=p.minVolRatio,d.rsi14>=p.minRSI14&&d.rsi14<=p.maxRSI14,(!p.requireDIBull||d.diBull)&&(p.maxBsc>=99||d.bsc<=p.maxBsc)&&d.adx>=p.minADX];
    conditions=q.filter(Boolean).length; score=(q[0]?18:0)+(q[1]?12:0)+(q[2]?20:0)+(q[3]?17:0)+(q[4]?13:0)+(q[5]?20:0)+Math.min(10,d.stabilizationBars*3)+Math.min(5,(d.volRatio20-1.5)*4);
  } else if (id === 'EMAStack') {
    if (d.cmf20 < p.minCMF20 || d.obvSlope10 < p.minOBVSlope10 || d.closeVsEMA20 < p.minCloseVsEMA20 || d.ema20Vs50 < p.minEMA20VsEMA50) return false;
    const q=[true,d.belowCount>=p.minBelowBars,d.ema10VsEma20>=p.minEMA10VsEma20&&d.isGreen&&d.bodyPct>=p.minBodyPct&&d.upperWickPct<=p.maxUpperWick&&d.candleRisk<=p.maxCandleRisk,d.volRatio20>=p.minVolRatio,d.recentlyOversold&&d.rsi2Pass!==false,(!p.requireDIBull||d.diBull)&&(p.maxBsc>=99||d.bsc<=p.maxBsc)&&d.adx>=p.minADX];
    // d.recentlyOversold is emitted as a boolean by the engine; the fallback
    // keeps the row compatible with older collected event files.
    conditions=q.filter(Boolean).length; score=(q[0]?25:0)+(q[1]?15:0)+(q[2]?15:0)+(q[3]?15:0)+(q[4]?10:0)+(q[5]?20:0)+Math.min(10,d.belowCount*2)+Math.min(5,(d.volRatio20-1.8)*5);
  } else {
    if (d.fires < p.minFires || d.quality < p.minQualityTier || d.candleRisk > p.maxCandleRisk || d.adx < p.minADXGate || d.cmf20 < p.minCMF20 || d.obvSlope10 < p.minOBVSlope10 || d.atrPct14 < (p.minAtrPct14 || 0) || d.closeVsEMA20 < p.minCloseVsEMA20 || d.ema20VsEMA50 < p.minEMA20VsEMA50) return false;
    if (d.atrPct14 > (p.maxAtrPct14 || 999)) return false;
    score=d.fireScores.reduce((a,b)=>a+b,0)/d.fireScores.length+(d.fires>=4?15:d.fires===3?10:5); return score>=45;
  }
  return stageOk(conditions, score);
}

function stats(rows) {
  const n=rows.length; if(!n) return {n:0,wr:0,hit5:0,pf:0,avg:0,avgMFE10:0,avgMFE20:0,avgMAE10:0,avgMAE20:0};
  const wins=rows.filter(x=>x.pnl>0).length, gw=rows.filter(x=>x.pnl>0).reduce((a,x)=>a+x.pnl,0), gl=-rows.filter(x=>x.pnl<0).reduce((a,x)=>a+x.pnl,0);
  const hit5=rows.filter(x=>x.pnl>=4.9).length;
  return {n,wr:wins/n*100,hit5:hit5/n*100,pf:gl?gw/gl:Infinity,avg:rows.reduce((a,x)=>a+x.pnl,0)/n,avgMFE10:rows.reduce((a,x)=>a+x.mfe10,0)/n,avgMFE20:rows.reduce((a,x)=>a+x.mfe20,0)/n,avgMAE10:rows.reduce((a,x)=>a+x.mae10,0)/n,avgMAE20:rows.reduce((a,x)=>a+x.mae20,0)/n};
}

function evaluate(events, id, p) {
  const ti=TP.indexOf(p.tpPct), si=SL.indexOf(p.slAtrMult), hi=HOLD.indexOf(p.maxHoldBars), ei=exitIndex(ti,si,hi);
  const by={}; for(const e of events) (by[e.symbol] ||= []).push(e); for(const a of Object.values(by)) a.sort((x,y)=>x.idx-y.idx);
  const rows=[];
  for(const a of Object.values(by)) { let next=-1; for(const e of a) { if(e.idx<next||!selected(id,e.d,p)) continue; const pnl=e.o[ei]/10; const dur=e.dur[ei]; const exit=e.idx+dur; rows.push({pnl,date:e.date,exit,mfe10:e.mfe10,mfe20:e.mfe20,mae10:e.mae10,mae20:e.mae20}); next=exit+1; } }
  const full=stats(rows), is=stats(rows.filter(x=>x.date<=OOS_CUT)), oos=stats(rows.filter(x=>x.date>OOS_CUT));
  return {p,full,is,oos};
}

function fitness(r) {
  if (r.oos.n < MIN_OOS || r.full.n < MIN_OOS*2) return -1e9;
  const pf=x=>Math.min(4,Math.max(0,x.pf))/4, avg=x=>Math.max(0,Math.min(4,x.avg+2))/6;
  const mfe=x=>Math.min(1,Math.max(0,x.avgMFE20/8));
  const mae=x=>Math.max(0,1-Math.min(1,Math.abs(x.avgMAE20)/8));
  if (HIT_RATE_OBJECTIVE) {
    // Hit-rate is primary, but PF, average return and OOS sample size still
    // matter so a narrow losing subset cannot win on accuracy alone.
    const sample = Math.min(1, Math.log10(Math.max(10, r.oos.n)) / 2);
    return .40*(r.oos.hit5/100) + .18*(r.full.hit5/100) + .16*pf(r.oos) +
      .10*avg(r.oos) + .06*pf(r.full) + .04*avg(r.full) + .03*mfe(r.oos) +
      .03*mae(r.oos) + .05*sample;
  }
  if (TARGET5_MODE) {
    const base=.04*(r.full.wr/100)+.10*(r.full.hit5/100)+.10*pf(r.full)+.08*avg(r.full)+.05*(r.oos.wr/100)+.25*(r.oos.hit5/100)+.18*pf(r.oos)+.12*avg(r.oos)+.04*mfe(r.oos)+.04*mae(r.oos);
    const consistency=(r.full.hit5>=50&&r.oos.hit5>=50&&r.full.avg>0&&r.oos.avg>0&&r.full.pf>=1&&r.oos.pf>=1)?0.15:0;
    return base+consistency+Math.min(.05,Math.log10(r.oos.n)/100);
  }
  const base=.12*(r.full.wr/100)+.18*pf(r.full)+.12*avg(r.full)+.12*(r.oos.wr/100)+.25*pf(r.oos)+.15*avg(r.oos)+.03*mfe(r.oos)+.03*mae(r.oos);
  const consistency=(r.full.avg>0&&r.oos.avg>0&&r.full.pf>=1&&r.oos.pf>=1)?0.15:0;
  return base+consistency+Math.min(.05,Math.log10(r.oos.n)/100);
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) throw new Error(`Missing ${DATA_DIR}`);
  const files=fs.readdirSync(DATA_DIR).filter(n=>n.toLowerCase().endsWith('.csv')&&n!=='ALL_SYMBOLS_OHLCV.csv').sort().map(name=>({name,fp:path.join(DATA_DIR,name)}));
  const workers=Math.min(Math.max(1,Number(process.env.WORKERS||10)),files.length||1), chunks=Array.from({length:workers},()=>[]); files.forEach((f,i)=>chunks[i%workers].push(f));
  console.log(`Exact live feature collection: ${files.length} files, workers=${workers}`);
  const all=Object.fromEntries(KEYS.map(([id])=>[id,[]])); let done=0, usable=0, short=0;
  await Promise.all(chunks.map(chunk=>new Promise((resolve,reject)=>{ const w=new Worker(__filename,{workerData:{files:chunk}}); w.on('message',m=>{ if(m.type==='progress'){done+=m.n;if(done%100===0)process.stdout.write(`  ${done}/${files.length}\r`);} else if(m.type==='done'){usable+=m.meta.usable;short+=m.meta.short;for(const [id] of KEYS)all[id].push(...m.events[id]);resolve();} }); w.on('error',reject); w.on('exit',c=>{if(c)reject(new Error(`worker exited ${c}`));}); })));
  console.log(`\nEvents: ${KEYS.map(([id])=>`${id}=${all[id].length}`).join(' | ')}`);
  const out={generated:new Date().toISOString(),dataDir:DATA_DIR,window:WINDOW,oosCut:OOS_CUT,combos:COMBOS,minOOS:MIN_OOS,target5Mode:TARGET5_MODE,hybridMode:HYBRID_MODE,relaxPerfectStormOneFire:RELAX_PS_ONE,ultraHit75Mode:ULTRA_HIT75_MODE,hitRateObjective:HIT_RATE_OBJECTIVE,targetHit5:HIT_TARGET,objective:TARGET5_MODE?'+5% hit-before-stop plus PF/Avg/MFE/MAE':'realized P&L',meta:{files:files.length,usable,short},bestBySet:{}};
  for(const [id] of KEYS){ let best=null,bestQualified=null,bestISRobust=null; for(let i=0;i<COMBOS;i++){const p=gridGen(id,i);const r=evaluate(all[id],id,p);const f=fitness(r);r.fitness=f;if(!best||f>best.fitness)best=r;const sampleOK=r.full.n>=MIN_OOS*2&&r.oos.n>=MIN_OOS;const common=sampleOK&&(HIT_RATE_OBJECTIVE?(r.full.pf>=1&&r.oos.pf>=1&&r.full.avg>0&&r.oos.avg>0&&r.full.hit5>=65&&r.oos.hit5>=HIT_TARGET):(TARGET5_MODE?(r.full.pf>=1&&r.oos.pf>=1&&r.full.avg>0&&r.oos.avg>0&&r.full.hit5>=50&&r.oos.hit5>=50):(r.full.pf>=1&&r.oos.pf>=1&&r.full.avg>0&&r.oos.avg>0&&r.full.wr>=50&&r.oos.wr>=50)));if(common&&(!bestQualified||f>bestQualified.fitness))bestQualified=r;const robust=HIT_RATE_OBJECTIVE?(common&&r.is.pf>=1&&r.is.avg>0&&r.is.hit5>=65&&r.is.n>=100):(TARGET5_MODE?(common&&r.is.pf>=1&&r.is.avg>0&&r.is.hit5>=50&&r.is.n>=100):(common&&r.is.pf>=1&&r.is.avg>0&&r.is.wr>=50&&r.is.n>=100));if(robust&&(!bestISRobust||f>bestISRobust.fitness))bestISRobust=r;} out.bestBySet[id]={best,bestQualified,bestISRobust}; const q=bestISRobust||bestQualified||best; console.log(`${id.padEnd(18)} ${bestISRobust?'ROBUST':bestQualified?'TARGET-QUALIFIED':'NO TARGET QUALIFIED'} full n=${q.full.n} Hit5=${q.full.hit5.toFixed(1)}% PF=${q.full.pf.toFixed(2)} Avg=${q.full.avg.toFixed(2)} | OOS n=${q.oos.n} Hit5=${q.oos.hit5.toFixed(1)}% PF=${q.oos.pf.toFixed(2)} Avg=${q.oos.avg.toFixed(2)}`); }
  fs.mkdirSync(OUT_DIR,{recursive:true}); const stamp=new Date().toISOString().replace(/[:.]/g,'-'); const prefix=ULTRA_HIT75_MODE?'ultra_hit75':(HYBRID_MODE?'hybrid':(HIT_RATE_OBJECTIVE?'hit_rate':'exact_live')); const jp=path.join(OUT_DIR,`${prefix}_hypertune_${stamp}.json`); fs.writeFileSync(jp,JSON.stringify(out,null,2)); console.log(`Saved: ${jp}`);
}

if(isMainThread)main().catch(e=>{console.error(e.stack||e);process.exitCode=1;}); else collectWorker().catch(e=>{parentPort.postMessage({type:'error',error:e.stack||String(e)});process.exitCode=1;});
