'use strict';
/**
 * NO-SIGNAL UPPER-CIRCUIT MINER
 * ─────────────────────────────────────────────────────────────────────────────
 * Finds stocks that hit upper circuit (≥9% single-day move) while all four
 * archetypes returned NO_SIGNAL at the pre-event bar. Extracts a complete
 * indicator profile for each missed event, runs statistical analysis at two
 * resolutions:
 *
 *   Pattern lens  — broad structure: trend regime, range contraction, volume
 *                   character, candlestick archetype, Bollinger squeeze
 *   Microscopic   — exact indicator values with P25/P50/P75 quartiles,
 *                   per-condition failure audit for each archetype, minimum
 *                   threshold relaxation to capture the event
 *
 * Output: JSON with full event list + per-indicator stats + suggested
 *         "CircuitBreaker" candidate param set.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR    = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR  = path.join(__dirname, '_compiled_current');
const OUT_DIR     = path.join(__dirname, 'results');
const WINDOW      = 300;          // bars fed to analyzeStock
const CIRCUIT_PCT = 9.0;         // ≥9% single-day move = circuit hit
const CIRCUIT_MAX = 25.0;        // cap: >25% = data anomaly (splits/errors) — exclude
// Circuit confirmation: on the actual circuit day, HIGH should be close to CLOSE
// (stock locked at upper limit, can't trade above it) → (H - C) / C < 0.5%
const CIRCUIT_CONFIRM_GAP = 0.5;
const PRE_BARS    = [1, 2, 3];   // look back these many bars before circuit day
const MIN_DATA    = 350;

const ARCH_KEYS = {
  VolumeFootprint:  'optimized_deployable_20plus',
  CompressionCoil:  'optimized_highprecision_15plus',
  MomentumPocket:   'optimized_elite_10plus',
  EMAStack:         'optimized_ultraselective_8plus',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',').map(s => s.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (!Number.isFinite(ts) || !o || h < l) continue;
    out.push({ ts: Math.floor(ts / 1000), date: p[0].trim(), o, h, l, c, v: Math.max(0, v) });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// ─── Indicator Math ───────────────────────────────────────────────────────────

function ema(data, period, fn) {
  const k = 2 / (period + 1);
  let val = fn(data[0]);
  const out = [val];
  for (let i = 1; i < data.length; i++) {
    val = fn(data[i]) * k + val * (1 - k);
    out.push(val);
  }
  return out;
}

function rsi(closes, period) {
  if (closes.length < period + 1) return Array(closes.length).fill(50);
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(0, d)); losses.push(Math.max(0, -d));
  }
  let ag = gains.slice(0, period).reduce((a, x) => a + x, 0) / period;
  let al = losses.slice(0, period).reduce((a, x) => a + x, 0) / period;
  const out = Array(period + 1).fill(50);
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period; i < gains.length; i++) {
    ag = (ag * (period - 1) + gains[i]) / period;
    al = (al * (period - 1) + losses[i]) / period;
    out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return out;
}

function atr(bars, period = 14) {
  const tr = [bars[0].h - bars[0].l];
  for (let i = 1; i < bars.length; i++) {
    tr.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c)));
  }
  let val = tr.slice(0, period).reduce((a, x) => a + x, 0) / period;
  const out = Array(period).fill(val);
  for (let i = period; i < tr.length; i++) { val = (val * (period - 1) + tr[i]) / period; out.push(val); }
  return out;
}

function sma(arr, period) {
  const out = Array(period - 1).fill(null);
  for (let i = period - 1; i < arr.length; i++) {
    out.push(arr.slice(i - period + 1, i + 1).reduce((a, x) => a + x, 0) / period);
  }
  return out;
}

function bollingerBands(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  return closes.map((_, i) => {
    if (mid[i] === null) return { mid: null, upper: null, lower: null, pctB: null, width: null };
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = mid[i];
    const sd = Math.sqrt(slice.reduce((a, x) => a + (x - mean) ** 2, 0) / period);
    const upper = mean + mult * sd, lower = mean - mult * sd;
    const bw = (upper - lower) / mean * 100;
    const pctB = sd === 0 ? 0.5 : (closes[i] - lower) / (upper - lower);
    return { mid, upper, lower, pctB, width: bw };
  });
}

function cmf(bars, period = 20) {
  const mfv = bars.map(b => {
    const rl = b.h - b.l;
    return rl < 1e-9 ? 0 : ((b.c - b.l) - (b.h - b.c)) / rl * b.v;
  });
  const out = Array(period - 1).fill(null);
  for (let i = period - 1; i < bars.length; i++) {
    const vol = bars.slice(i - period + 1, i + 1).reduce((a, b) => a + b.v, 0);
    const mfvSum = mfv.slice(i - period + 1, i + 1).reduce((a, x) => a + x, 0);
    out.push(vol === 0 ? 0 : mfvSum / vol);
  }
  return out;
}

function obvSlope(bars, period = 10) {
  const obv = [0];
  for (let i = 1; i < bars.length; i++) {
    const prev = obv[obv.length - 1];
    obv.push(bars[i].c > bars[i - 1].c ? prev + bars[i].v : bars[i].c < bars[i - 1].c ? prev - bars[i].v : prev);
  }
  const out = Array(period - 1).fill(null);
  for (let i = period - 1; i < obv.length; i++) {
    const slice = obv.slice(i - period + 1, i + 1);
    // linear regression slope (normalized)
    const n = slice.length;
    let sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (let j = 0; j < n; j++) { sx += j; sy += slice[j]; sxy += j * slice[j]; sx2 += j * j; }
    const slope = (n * sxy - sx * sy) / (n * sx2 - sx * sx);
    const normSlope = Math.abs(obv[i]) > 1 ? slope / Math.abs(obv[i]) * n * 1000 : 0;
    out.push(normSlope);
  }
  return out;
}

function adx(bars, period = 14) {
  const n = bars.length;
  if (n < period * 2) return Array(n).fill({ adx: 20, diPlus: 20, diMinus: 20 });
  const dmPlus = [], dmMinus = [], trArr = [];
  for (let i = 1; i < n; i++) {
    const upMove = bars[i].h - bars[i - 1].h, downMove = bars[i - 1].l - bars[i].l;
    dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
    dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trArr.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c)));
  }
  let atr14 = trArr.slice(0, period).reduce((a, x) => a + x, 0);
  let admp = dmPlus.slice(0, period).reduce((a, x) => a + x, 0);
  let admm = dmMinus.slice(0, period).reduce((a, x) => a + x, 0);
  const out = Array(period + 1).fill({ adx: 20, diPlus: 20, diMinus: 20 });
  let dxArr = [];
  for (let i = period; i < trArr.length; i++) {
    atr14 = atr14 - atr14 / period + trArr[i];
    admp  = admp  - admp / period  + dmPlus[i];
    admm  = admm  - admm / period  + dmMinus[i];
    const dp = atr14 > 0 ? admp / atr14 * 100 : 0;
    const dm = atr14 > 0 ? admm / atr14 * 100 : 0;
    const dx = dp + dm > 0 ? Math.abs(dp - dm) / (dp + dm) * 100 : 0;
    dxArr.push(dx);
    if (dxArr.length < period) { out.push({ adx: 20, diPlus: dp, diMinus: dm }); continue; }
    const adxVal = dxArr.length === period
      ? dxArr.reduce((a, x) => a + x, 0) / period
      : (out[out.length - 1].adx * (period - 1) + dx) / period;
    out.push({ adx: adxVal, diPlus: dp, diMinus: dm });
  }
  return out;
}

// ─── Full indicator profile at index i of bars array ─────────────────────────

function extractProfile(bars, idx, precomputed) {
  const { rsi14Arr, rsi2Arr, ema10Arr, ema20Arr, ema50Arr, atrArr, cmfArr, obvSlopeArr, bbArr, adxArr, volAvg20 } = precomputed;
  const b = bars[idx], prev = bars[idx - 1];
  if (!prev) return null;

  const c = b.c, h = b.h, l = b.l, o = b.o;
  const range = h - l;
  const bodyAbs = Math.abs(c - o);
  const bodyPct = range < 1e-9 ? 0 : bodyAbs / range * 100;
  const upperWick = range < 1e-9 ? 0 : (h - Math.max(c, o)) / range * 100;
  const lowerWick = range < 1e-9 ? 0 : (Math.min(c, o) - l) / range * 100;
  const closeLoc  = range < 1e-9 ? 50 : (c - l) / range * 100;
  const bullCandle = c > o;

  // 52w window (look back up to 252 bars)
  const w52Start = Math.max(0, idx - 252);
  const w52Bars = bars.slice(w52Start, idx + 1);
  const high52 = Math.max(...w52Bars.map(b => b.h));
  const low52  = Math.min(...w52Bars.map(b => b.l));
  const closeLoc52 = high52 === low52 ? 50 : (c - low52) / (high52 - low52) * 100;
  const dd52 = high52 > 0 ? (c / high52 - 1) * 100 : 0;

  // Stability: bars close > SMA20 in last 20
  const lookback20 = bars.slice(Math.max(0, idx - 19), idx + 1);
  const sma20Val = lookback20.reduce((a, b) => a + b.c, 0) / lookback20.length;
  const stabBars = lookback20.filter(b => b.c > sma20Val).length;

  // Volume ratio vs 20-bar avg
  const volAvg = volAvg20[idx] || 0;
  const volRatio = volAvg > 0 ? b.v / volAvg : 1;

  // Volume trend: last 5 bars
  const vol5 = bars.slice(Math.max(0, idx - 4), idx + 1).map(b => b.v);
  const volTrend = vol5.length >= 3 ? (vol5[vol5.length - 1] / (vol5.reduce((a, x) => a + x, 0) / vol5.length)) : 1;

  // NR4 / NR7 (narrowest range in N bars)
  const ranges = bars.slice(Math.max(0, idx - 6), idx + 1).map(b => b.h - b.l);
  const isNR7 = ranges.length === 7 && range <= Math.min(...ranges.slice(0, 6));
  const ranges4 = bars.slice(Math.max(0, idx - 3), idx + 1).map(b => b.h - b.l);
  const isNR4  = ranges4.length === 4 && range <= Math.min(...ranges4.slice(0, 3));

  // Range contraction: last 3 bars narrowing
  const r3 = bars.slice(Math.max(0, idx - 2), idx + 1).map(b => b.h - b.l);
  const rangeContracting = r3.length >= 2 && r3[r3.length - 1] < r3[r3.length - 2];

  // Inside bar
  const insideBar = h <= prev.h && l >= prev.l;

  // ATR% of close
  const atrVal = atrArr[idx] || (c * 0.02);
  const atrPct = c > 0 ? atrVal / c * 100 : 2;

  const e10 = ema10Arr[idx], e20 = ema20Arr[idx], e50 = ema50Arr[idx];
  const closeVsEMA10 = e10 > 0 ? (c / e10 - 1) * 100 : 0;
  const closeVsEMA20 = e20 > 0 ? (c / e20 - 1) * 100 : 0;
  const closeVsEMA50 = e50 > 0 ? (c / e50 - 1) * 100 : 0;
  const ema10VsEma20 = e20 > 0 ? (e10 / e20 - 1) * 100 : 0;
  const ema20Vs50    = e50 > 0 ? (e20 / e50 - 1) * 100 : 0;

  // EMAs trending up? (current vs 5 bars ago)
  const e20_5ago = ema20Arr[Math.max(0, idx - 5)] || e20;
  const ema20Slope = e20 > 0 ? (e20 / e20_5ago - 1) * 100 : 0;

  const bb = bbArr[idx] || {};
  const adxData = adxArr[idx] || { adx: 20, diPlus: 20, diMinus: 20 };

  return {
    // Candlestick
    bodyPct: +bodyPct.toFixed(1),
    upperWick: +upperWick.toFixed(1),
    lowerWick: +lowerWick.toFixed(1),
    closeLoc: +closeLoc.toFixed(1),
    bullCandle,
    insideBar,
    isNR4,
    isNR7,
    rangeContracting,

    // Momentum
    rsi14:   +(rsi14Arr[idx] || 50).toFixed(1),
    rsi2:    +(rsi2Arr[idx]  || 50).toFixed(1),

    // Volume
    volRatio: +volRatio.toFixed(2),
    volTrend: +volTrend.toFixed(2),

    // Trend / momentum
    cmf20:       +(cmfArr[idx] || 0).toFixed(3),
    obvSlope10:  +(obvSlopeArr[idx] || 0).toFixed(3),
    atrPct14:    +atrPct.toFixed(2),

    // EMA relations
    closeVsEMA10: +closeVsEMA10.toFixed(2),
    closeVsEMA20: +closeVsEMA20.toFixed(2),
    closeVsEMA50: +closeVsEMA50.toFixed(2),
    ema10VsEma20: +ema10VsEma20.toFixed(3),
    ema20Vs50:    +ema20Vs50.toFixed(3),
    ema20Slope:   +ema20Slope.toFixed(3),

    // Bollinger
    bbPctB:   bb.pctB !== undefined ? +bb.pctB.toFixed(3) : null,
    bbWidth:  bb.width !== undefined ? +bb.width.toFixed(2) : null,

    // ADX
    adx:     +adxData.adx.toFixed(1),
    diPlus:  +adxData.diPlus.toFixed(1),
    diMinus: +adxData.diMinus.toFixed(1),
    diBull:  adxData.diPlus > adxData.diMinus,

    // 52-week structure
    closeLoc52:  +closeLoc52.toFixed(1),
    dd52W:       +dd52.toFixed(1),

    // Stability
    stabBars,
    sma20Distance: sma20Val > 0 ? +((c / sma20Val - 1) * 100).toFixed(2) : 0,
  };
}

// ─── Worker ───────────────────────────────────────────────────────────────────

function collectWorker() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  for (const key of Object.values(ARCH_KEYS)) engine.setArchetypeTuning(key, null);

  const events = [];
  let processed = 0;

  for (const { name, fp } of workerData.files) {
    let bars; try { bars = parseCSV(fp); } catch { processed++; continue; }
    processed++;
    if (bars.length < MIN_DATA) continue;

    const symbol = name.replace(/_OHLCV\.csv$/i, '');
    const closes = bars.map(b => b.c);

    // Precompute indicators once for the whole series
    const rsi14Arr   = rsi(closes, 14);
    const rsi2Arr    = rsi(closes, 2);
    const ema10Arr   = ema(bars, 10, b => b.c);
    const ema20Arr   = ema(bars, 20, b => b.c);
    const ema50Arr   = ema(bars, 50, b => b.c);
    const atrArr     = atr(bars, 14);
    const cmfArr     = cmf(bars, 20);
    const obvSlopeArr = obvSlope(bars, 10);
    const bbArr      = bollingerBands(closes, 20, 2);
    const adxArr     = adx(bars, 14);

    // Volume 20-bar rolling avg
    const volAvg20 = bars.map((_, i) => {
      const sl = bars.slice(Math.max(0, i - 19), i + 1);
      return sl.reduce((a, b) => a + b.v, 0) / sl.length;
    });

    const precomp = { rsi14Arr, rsi2Arr, ema10Arr, ema20Arr, ema50Arr, atrArr, cmfArr, obvSlopeArr, bbArr, adxArr, volAvg20 };

    for (let i = WINDOW; i < bars.length; i++) {
      const b = bars[i], prev = bars[i - 1];
      if (!prev.c || prev.c === 0) continue;

      // Detect circuit: single-day move within [CIRCUIT_PCT, CIRCUIT_MAX]
      const dayMove = (b.c / prev.c - 1) * 100;
      if (dayMove < CIRCUIT_PCT || dayMove > CIRCUIT_MAX) continue;
      // Confirm stock was locked at upper circuit: high ≈ close (can't trade above)
      const gapHC = b.c > 0 ? (b.h - b.c) / b.c * 100 : 99;
      if (gapHC > CIRCUIT_CONFIRM_GAP) continue;

      // Pre-event bar is i-1; we extract indicator at pre_offset bars before circuit
      for (const offset of PRE_BARS) {
        const preIdx = i - offset;
        if (preIdx < WINDOW) continue;

        // Check NO_SIGNAL for all archetypes
        const window = bars.slice(preIdx - WINDOW + 1, preIdx + 1);
        let allNoSignal = true;
        const archetypeStatus = {};
        for (const [archName, key] of Object.entries(ARCH_KEYS)) {
          let r;
          try { r = engine.analyzeStock(window, key, false); } catch { continue; }
          const noSig = !r || r.stage === 'NO_SIGNAL';
          archetypeStatus[archName] = noSig ? 'NO_SIGNAL' : r.stage;
          if (!noSig) allNoSignal = false;
        }

        if (!allNoSignal) continue; // at least one archetype fired — not a pure miss

        const profile = extractProfile(bars, preIdx, precomp);
        if (!profile) continue;

        events.push({
          symbol,
          circuitDate:  bars[i].date,
          circuitMove:  +dayMove.toFixed(2),
          circuitClose: bars[i].c,
          preOffset: offset,
          preDate: bars[preIdx].date,
          profile,
          archetypeStatus,
        });
        break; // Only record the closest pre-bar (offset=1 if passed)
      }
    }

    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }

  parentPort.postMessage({ type: 'done', events, processed });
}

// ─── Statistics ───────────────────────────────────────────────────────────────

function pct(arr, p) {
  if (!arr.length) return null;
  const sorted = [...arr].filter(x => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const idx = Math.floor(sorted.length * p / 100);
  return +sorted[Math.min(idx, sorted.length - 1)].toFixed(3);
}

function statSummary(arr) {
  const valid = arr.filter(x => x !== null && Number.isFinite(x));
  if (!valid.length) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  const mean = valid.reduce((a, x) => a + x, 0) / valid.length;
  return {
    n:    valid.length,
    mean: +mean.toFixed(3),
    min:  +sorted[0].toFixed(3),
    p10:  pct(valid, 10),
    p25:  pct(valid, 25),
    p50:  pct(valid, 50),
    p75:  pct(valid, 75),
    p90:  pct(valid, 90),
    max:  +sorted[sorted.length - 1].toFixed(3),
  };
}

function boolFreq(arr) {
  const t = arr.filter(Boolean).length;
  return { true: t, false: arr.length - t, pctTrue: +(t / arr.length * 100).toFixed(1) };
}

// ─── Distill candidate param set ─────────────────────────────────────────────

function distillParamSet(stats, boolStats) {
  // For each indicator: use P25 as the lower gate (conservative entry zone)
  // These are the ranges where 50%+ of circuit events cluster
  const s = stats;
  const b = boolStats;

  const suggested = {
    // Core trigger zone (P25 = conservative floor, P75 = ceiling where applicable)
    minRSI14:          s.rsi14?.p25  ?? 40,
    maxRSI14:          s.rsi14?.p75  ?? 65,
    minRSI2:           s.rsi2?.min   ?? 5,
    maxRSI2:           s.rsi2?.p75   ?? 50,

    minCMF20:          s.cmf20?.p25  ?? -0.05,
    minOBVSlope10:     s.obvSlope10?.p25 ?? -0.5,

    minAtrPct14:       s.atrPct14?.p25 ?? 1.0,
    maxAtrPct14:       s.atrPct14?.p75 ?? 5.0,

    // Price-EMA structure
    minCloseVsEMA20:   s.closeVsEMA20?.p25 ?? -3.0,
    maxCloseVsEMA20:   s.closeVsEMA20?.p75 ?? 5.0,
    minEMA20Vs50:      s.ema20Vs50?.p25  ?? -2.0,
    minEMA20Slope:     s.ema20Slope?.p25 ?? -0.5,

    // Volume
    minVolRatio20:     s.volRatio?.p25 ?? 0.8,

    // Candle quality
    minBodyPct:        s.bodyPct?.p25  ?? 20,
    maxUpperWick:      s.upperWick?.p75 ?? 30,
    minCloseLoc:       s.closeLoc?.p25  ?? 40,

    // Bollinger
    minBBPctB:         s.bbPctB?.p25  ?? 0.3,
    maxBBWidth:        s.bbWidth?.p75 ?? 8.0,   // narrow band = coil

    // ADX / trend
    minADX:            s.adx?.p25    ?? 15,
    requireDIBull:     (b.diBull?.pctTrue ?? 50) >= 55,

    // 52-week structure
    minCloseLoc52:     s.closeLoc52?.p25 ?? 30,
    maxDd52W:          s.dd52W?.p75   ?? -5,

    // Stability
    minStabBars:       Math.round(s.stabBars?.p25 ?? 8),
  };

  return suggested;
}

// ─── Print report ─────────────────────────────────────────────────────────────

function printReport(events, stats, boolStats, paramSet) {
  const N = events.length;
  console.log(`\n${'═'.repeat(90)}`);
  console.log(`  NO-SIGNAL UPPER-CIRCUIT MINER — FINDINGS`);
  console.log(`  ${N} missed circuit events · Circuit threshold ≥${CIRCUIT_PCT}% · Pre-event offsets: ${PRE_BARS.join(',')} bars`);
  console.log(`${'═'.repeat(90)}\n`);

  if (N === 0) { console.log('  No events found.'); return; }

  // Aggregate circuit size
  const moves = events.map(e => e.circuitMove);
  const movePct = { p50: pct(moves, 50), p75: pct(moves, 75), max: Math.max(...moves) };
  console.log(`  Circuit move: median=${movePct.p50}%  P75=${movePct.p75}%  max=${movePct.max}%`);

  const off1 = events.filter(e => e.preOffset === 1).length;
  console.log(`  Detected at offset-1 (day before): ${off1} (${(off1/N*100).toFixed(0)}%)`);

  console.log(`\n${'─'.repeat(90)}`);
  console.log(`  ┌─ PATTERN LENS — structural & regime patterns across ${N} events`);
  console.log(`${'─'.repeat(90)}`);

  const pf = (label, val) => console.log(`  │  ${label.padEnd(34)} ${val}`);

  pf('Bullish candle at pre-event',  `${boolStats.bullCandle?.pctTrue}%`);
  pf('Inside bar pattern',           `${boolStats.insideBar?.pctTrue}%`);
  pf('NR4 (narrowest 4-bar range)', `${boolStats.isNR4?.pctTrue}%`);
  pf('NR7 (narrowest 7-bar range)', `${boolStats.isNR7?.pctTrue}%`);
  pf('Range contracting',           `${boolStats.rangeContracting?.pctTrue}%`);
  pf('DI+ > DI− (bull trend)',       `${boolStats.diBull?.pctTrue}%`);
  pf('Price above SMA20',            `${events.filter(e=>e.profile.sma20Distance > 0).length} / ${N} (${(events.filter(e=>e.profile.sma20Distance>0).length/N*100).toFixed(0)}%)`);

  // Trend regime analysis
  const trendUp   = events.filter(e => e.profile.ema20Vs50 > 0 && e.profile.ema20Slope > 0).length;
  const trendFlat = events.filter(e => Math.abs(e.profile.ema20Vs50) <= 1).length;
  const trendDown = events.filter(e => e.profile.ema20Vs50 < -1).length;
  pf('EMA20 > EMA50 (uptrend)',      `${trendUp} (${(trendUp/N*100).toFixed(0)}%)`);
  pf('EMA20 ≈ EMA50 (flat regime)',  `${trendFlat} (${(trendFlat/N*100).toFixed(0)}%)`);
  pf('EMA20 < EMA50 (downtrend)',    `${trendDown} (${(trendDown/N*100).toFixed(0)}%)`);

  // Compression: BB width low
  const bbNarrow = events.filter(e => e.profile.bbWidth !== null && e.profile.bbWidth < 5).length;
  pf('BB squeeze (width < 5%)',      `${bbNarrow} (${(bbNarrow/N*100).toFixed(0)}%)`);
  const bbLow    = events.filter(e => e.profile.bbPctB !== null && e.profile.bbPctB < 0.4).length;
  pf('BB %B < 0.4 (lower half)',     `${bbLow} (${(bbLow/N*100).toFixed(0)}%)`);

  // Volume character
  const volDry = events.filter(e => e.profile.volRatio < 0.8).length;
  const volSurge = events.filter(e => e.profile.volRatio > 1.5).length;
  pf('Volume drying (vol<0.8× avg)', `${volDry} (${(volDry/N*100).toFixed(0)}%)`);
  pf('Volume surging (vol>1.5× avg)',`${volSurge} (${(volSurge/N*100).toFixed(0)}%)`);

  // RSI regime buckets
  const rsiOverSold = events.filter(e => e.profile.rsi14 < 40).length;
  const rsiMid      = events.filter(e => e.profile.rsi14 >= 40 && e.profile.rsi14 <= 65).length;
  const rsiOB       = events.filter(e => e.profile.rsi14 > 65).length;
  pf('RSI14 < 40 (oversold)',       `${rsiOverSold} (${(rsiOverSold/N*100).toFixed(0)}%)`);
  pf('RSI14 40−65 (mid-zone)',       `${rsiMid} (${(rsiMid/N*100).toFixed(0)}%)`);
  pf('RSI14 > 65 (overbought)',      `${rsiOB} (${(rsiOB/N*100).toFixed(0)}%)`);

  // 52w structure
  const near52H = events.filter(e => e.profile.closeLoc52 > 70).length;
  const mid52   = events.filter(e => e.profile.closeLoc52 >= 30 && e.profile.closeLoc52 <= 70).length;
  const near52L = events.filter(e => e.profile.closeLoc52 < 30).length;
  pf('Near 52w high (loc>70%)',      `${near52H} (${(near52H/N*100).toFixed(0)}%)`);
  pf('Mid 52w range (30−70%)',       `${mid52} (${(mid52/N*100).toFixed(0)}%)`);
  pf('Near 52w low (<30%)',          `${near52L} (${(near52L/N*100).toFixed(0)}%)`);

  console.log(`\n  └─ KEY INSIGHT: Top patterns that distinguish this missed-signal universe`);
  // Find patterns shared by majority
  const patterns = [
    ['Bullish candle',      boolStats.bullCandle?.pctTrue],
    ['DI+ > DI−',           boolStats.diBull?.pctTrue],
    ['Range contracting',   boolStats.rangeContracting?.pctTrue],
    ['Price above SMA20',   events.filter(e=>e.profile.sma20Distance>0).length/N*100],
    ['RSI 40−65',           rsiMid/N*100],
    ['Near 52w high',       near52H/N*100],
    ['BB narrow',           bbNarrow/N*100],
    ['Volume drying',       volDry/N*100],
  ].filter(([, v]) => v >= 50).sort((a, b) => b[1] - a[1]);
  patterns.forEach(([k, v]) => console.log(`     ✓ ${k}: ${v.toFixed(0)}% of events`));

  console.log(`\n${'─'.repeat(90)}`);
  console.log(`  ┌─ MICROSCOPIC LENS — indicator quartiles (P25 / P50 / P75)`);
  console.log(`${'─'.repeat(90)}`);

  const mf = (label, key) => {
    const s = stats[key];
    if (!s) return;
    const bar = `[${s.p25} → ${s.p50} → ${s.p75}]`;
    console.log(`  │  ${label.padEnd(22)} P25=${String(s.p25).padStart(8)}  P50=${String(s.p50).padStart(8)}  P75=${String(s.p75).padStart(8)}   range ${bar}`);
  };

  console.log(`  │`);
  console.log(`  │  ── MOMENTUM ──`);
  mf('RSI14',              'rsi14');
  mf('RSI2',               'rsi2');
  mf('CMF20',              'cmf20');
  mf('OBV Slope 10',       'obvSlope10');

  console.log(`  │`);
  console.log(`  │  ── VOLATILITY ──`);
  mf('ATR% (14)',          'atrPct14');
  mf('BB %B',              'bbPctB');
  mf('BB Width %',         'bbWidth');

  console.log(`  │`);
  console.log(`  │  ── EMA STRUCTURE ──`);
  mf('Close vs EMA10 %',   'closeVsEMA10');
  mf('Close vs EMA20 %',   'closeVsEMA20');
  mf('Close vs EMA50 %',   'closeVsEMA50');
  mf('EMA10 vs EMA20 %',   'ema10VsEma20');
  mf('EMA20 vs EMA50 %',   'ema20Vs50');
  mf('EMA20 Slope (5b)',   'ema20Slope');

  console.log(`  │`);
  console.log(`  │  ── VOLUME ──`);
  mf('Vol Ratio (20)',     'volRatio');
  mf('Vol Trend (5b)',     'volTrend');

  console.log(`  │`);
  console.log(`  │  ── CANDLE ──`);
  mf('Body %',             'bodyPct');
  mf('Upper Wick %',       'upperWick');
  mf('Lower Wick %',       'lowerWick');
  mf('Close Loc (in bar)', 'closeLoc');

  console.log(`  │`);
  console.log(`  │  ── TREND ──`);
  mf('ADX14',              'adx');
  mf('DI+',                'diPlus');
  mf('DI−',                'diMinus');
  mf('Stability (bars)',   'stabBars');
  mf('SMA20 Distance %',   'sma20Distance');

  console.log(`  │`);
  console.log(`  │  ── 52-WEEK STRUCTURE ──`);
  mf('52w Close Loc %',    'closeLoc52');
  mf('52w Drawdown %',     'dd52W');

  console.log(`\n${'─'.repeat(90)}`);
  console.log(`  ┌─ DISTILLED "CircuitBreaker" CANDIDATE PARAM SET`);
  console.log(`${'─'.repeat(90)}`);
  console.log(`  │  (conservative — built from P25/P75 of missed-signal universe)\n`);
  Object.entries(paramSet).forEach(([k, v]) => {
    console.log(`  │  ${k.padEnd(30)} ${JSON.stringify(v)}`);
  });

  // Top 10 symbols by move size
  console.log(`\n${'─'.repeat(90)}`);
  console.log(`  SAMPLE EVENTS (top 15 by circuit move size)`);
  console.log(`${'─'.repeat(90)}`);
  const top = [...events].sort((a, b) => b.circuitMove - a.circuitMove).slice(0, 15);
  console.log(`  ${'Symbol'.padEnd(16)} ${'CircuitDate'.padEnd(12)} ${'Move%'.padStart(6)} ${'PreDate'.padEnd(12)} ${'RSI14'.padStart(6)} ${'CMF20'.padStart(7)} ${'ADX'.padStart(5)} ${'BB%B'.padStart(6)} ${'VRatio'.padStart(7)}`);
  top.forEach(e => {
    const p = e.profile;
    console.log(`  ${e.symbol.padEnd(16)} ${e.circuitDate.padEnd(12)} ${String(e.circuitMove).padStart(6)} ${e.preDate.padEnd(12)} ${String(p.rsi14).padStart(6)} ${String(p.cmf20).padStart(7)} ${String(p.adx).padStart(5)} ${String(p.bbPctB).padStart(6)} ${String(p.volRatio).padStart(7)}`);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(n => n.toLowerCase().endsWith('.csv') && n !== 'ALL_SYMBOLS_OHLCV.csv')
    .sort()
    .map(name => ({ name, fp: path.join(DATA_DIR, name) }));

  const nWorkers = Math.min(10, files.length);
  const chunks   = Array.from({ length: nWorkers }, () => []);
  files.forEach((f, i) => chunks[i % nWorkers].push(f));

  console.log(`\n  NO-SIGNAL CIRCUIT MINER — scanning ${files.length} stocks, ${nWorkers} workers`);
  console.log(`  Circuit threshold ≥${CIRCUIT_PCT}% · WINDOW ${WINDOW} · Min data ${MIN_DATA}\n`);

  let allEvents = [];
  let done = 0;

  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk } });
    w.on('message', m => {
      if (m.type === 'progress') {
        done += m.n;
        if (done % 200 === 0) process.stdout.write(`  Scanning ${done}/${files.length}\r`);
      } else if (m.type === 'done') {
        allEvents = allEvents.concat(m.events);
        resolve();
      }
    });
    w.on('error', reject);
    w.on('exit', c => { if (c) reject(new Error(`Worker exit ${c}`)); });
  })));

  console.log(`\n  Found ${allEvents.length} NO_SIGNAL circuit events\n`);
  if (!allEvents.length) { console.log('  No events found.'); return; }

  // Compute statistics over all events
  const INDICATOR_KEYS = Object.keys(allEvents[0].profile).filter(k => typeof allEvents[0].profile[k] === 'number');
  const BOOL_KEYS      = Object.keys(allEvents[0].profile).filter(k => typeof allEvents[0].profile[k] === 'boolean');

  const stats = {};
  for (const key of INDICATOR_KEYS) {
    stats[key] = statSummary(allEvents.map(e => e.profile[key]));
  }

  const boolStats = {};
  for (const key of BOOL_KEYS) {
    boolStats[key] = boolFreq(allEvents.map(e => e.profile[key]));
  }

  const paramSet = distillParamSet(stats, boolStats);

  printReport(allEvents, stats, boolStats, paramSet);

  // Save output
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const out = {
    generated: new Date().toISOString(),
    circuitThresholdPct: CIRCUIT_PCT,
    totalEvents: allEvents.length,
    uniqueSymbols: [...new Set(allEvents.map(e => e.symbol))].length,
    indicatorStats: stats,
    booleanStats: boolStats,
    distilledParamSet: paramSet,
    events: allEvents,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jp = path.join(OUT_DIR, `no_signal_circuit_miner_${stamp}.json`);
  fs.writeFileSync(jp, JSON.stringify(out, null, 2));
  console.log(`\n  Saved → ${jp}\n`);
}

if (isMainThread) {
  main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
} else {
  collectWorker().catch(e => {
    parentPort.postMessage({ type: 'error', error: e.stack || String(e) });
  });
}
