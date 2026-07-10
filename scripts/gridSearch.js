'use strict';

/**
 * Two-pass grid search for v12 param set optimisation.
 *
 * Pass 1 (parallel workers): Load every CSV once, compute all raw metrics
 *   (ATR, vol ratios, zone, candle quality) for EVERY bar that clears the
 *   loosest possible turnover floor.  No param-specific filtering — store
 *   every candidate with its forward-return outcome.
 *
 * Pass 2 (main thread, milliseconds): For each param combination, filter the
 *   pre-computed record cache and score by WilsonWR × ProfitFactor.
 *   No I/O, no TA re-computation.
 *
 * Output: scripts/grid_search_results_<timestamp>.json
 *         scripts/grid_search_results_<timestamp>.txt  (readable top-20 per set)
 */

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── Config ──────────────────────────────────────────────────────────────────
const DATA_DIR   = process.env.DATA_DIR   || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const OUT_PREFIX = process.env.OUT_PREFIX || 'grid_search_results';
const N_WORKERS  = Math.max(1, Number(process.env.N_WORKERS  || Math.min(8, Math.max(1, os.cpus().length - 1))));
const MIN_HISTORY   = 220;   // bars of history needed before first signal
const HISTORY_WINDOW = 280;  // rolling window passed to metric computation
const MAX_HOLD       = 20;   // bars for fwd20 computation
const MIN_TURNOVER   = 5_000_000;  // loose pre-filter (5 cr); per-set minimums applied in grid sweep
const MIN_TRADES_FOR_SCORE = 25;   // discard combos below this threshold to avoid overfitting

const MONTHS = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };

// ─── Grid definitions ────────────────────────────────────────────────────────
// Fixed params are the v12 baseline values; only grid vars are swept.
// Note: maxPre10RedVolBias = mean(red candle vol) / mean(all pre-10 vol).
//       0 = no red candles; 1.0 = red same volume as average; >1 = red heavier.
const GRIDS = {
  // HighPrecision: richest signal pool (1,526 signals). Find tighter combos.
  highprecision: {
    label: 'HighPrecision',
    fixed: {
      minAvgTurnover20: 10_000_000,
      maxATRPct14Pctl120: 70,
      maxPre10AvgRangeATR: 1.2,
      maxPre10ExpansionCount: 3,
      zoneRangeATRThreshold: 1.0,
      minZoneLen: 6,
      maxZoneLen: 25,
      maxZoneTightnessPct: 15.0,
      maxPre10AvgVolRatio: 1.10,
      maxPre5AvgVolRatio: 1.20,
      maxPre10HighVolCount: 3,
      highVolMultiplier: 1.2,
      maxPre10RedVolBias: 1.5,
      maxExactRangeATR14: 7.0,
      minRSI2: 45,
      maxCloseAboveZonePct: 10.0,
    },
    vars: {
      minExactVolRatio20:          [0.8, 1.2, 1.8],
      minExactVolVsPre5:           [1.0, 1.5, 2.0],
      minExactRangeATR14:          [0.8, 1.2, 1.6],
      maxUpperWickPct:             [20, 25, 30],
      minCloseLoc:                 [45, 55, 65],
      minVolatilityExpansionRatio: [1.0, 1.2, 1.4],
      minBodyPct:                  [20, 30, 40],
      minCandleQualityScore:       [1, 2, 3],
      minUltraPrecisionScore:      [0, 30, 45, 60],
    },
  },

  // Elite: quality filter; relaxed fixed params so grid can find workable combos.
  elite: {
    label: 'Elite',
    fixed: {
      minAvgTurnover20: 10_000_000,
      maxATRPct14Pctl120: 70,
      maxPre10AvgRangeATR: 1.1,
      maxPre10ExpansionCount: 3,
      zoneRangeATRThreshold: 1.0,
      minZoneLen: 6,
      maxZoneLen: 25,
      maxZoneTightnessPct: 15.0,
      maxPre10AvgVolRatio: 1.10,
      maxPre5AvgVolRatio: 1.20,
      maxPre10HighVolCount: 3,
      highVolMultiplier: 1.2,
      maxPre10RedVolBias: 1.5,
      maxExactRangeATR14: 6.0,
      minRSI2: 50,
      maxCloseAboveZonePct: 10.0,
      minCandleQualityScore: 2,
    },
    vars: {
      minExactVolRatio20:          [1.5, 2.0, 2.5],
      minExactVolVsPre5:           [1.5, 2.0, 2.5],
      minExactRangeATR14:          [1.2, 1.5, 1.8],
      maxUpperWickPct:             [13, 16, 20],
      minCloseLoc:                 [50, 57, 65],
      minVolatilityExpansionRatio: [1.1, 1.3, 1.5],
      minBodyPct:                  [25, 32, 40],
      minUltraPrecisionScore:      [0, 30, 45, 60],
    },
  },

  // UltraSelective: relaxed fixed params; grid finds best candle + vol combo.
  ultraselective: {
    label: 'UltraSelective',
    fixed: {
      minAvgTurnover20: 10_000_000,
      maxPre10AvgRangeATR: 1.3,
      maxPre10ExpansionCount: 1,
      zoneRangeATRThreshold: 0.95,
      minZoneLen: 6,
      maxZoneLen: 25,
      maxZoneTightnessPct: 18.0,
      maxPre10AvgVolRatio: 1.00,
      maxPre5AvgVolRatio: 1.10,
      maxPre10HighVolCount: 1,
      highVolMultiplier: 1.5,
      maxPre10RedVolBias: 1.5,
      minExactRangeATR14: 1.0,
      maxExactRangeATR14: 6.0,
      minRSI2: 50,
      maxCloseAboveZonePct: null,
      minBodyPct: 30,
    },
    vars: {
      maxATRPct14Pctl120:          [65, 80, 95],
      minExactVolRatio20:          [0.6, 1.0, 1.5],
      minExactVolVsPre5:           [1.0, 1.5, 2.0],
      maxUpperWickPct:             [15, 20, 25],
      minCloseLoc:                 [55, 63, 70],
      minVolatilityExpansionRatio: [1.1, 1.3, 1.5],
      minCandleQualityScore:       [2, 3],
      minUltraPrecisionScore:      [0, 30, 45, 60],
    },
  },

  // Sniper: relaxed fixed params; grid focuses on vol-surge & candle quality.
  sniper: {
    label: 'Sniper',
    fixed: {
      minAvgTurnover20: 10_000_000,
      maxATRPct14Pctl120: 50,
      maxPre10AvgRangeATR: 1.2,
      maxPre10ExpansionCount: 2,
      zoneRangeATRThreshold: 1.0,
      minZoneLen: 4,
      maxZoneLen: 25,
      maxZoneTightnessPct: 15.0,
      maxPre10AvgVolRatio: 1.00,
      maxPre5AvgVolRatio: 1.20,
      maxPre10HighVolCount: 1,
      highVolMultiplier: 1.35,
      maxPre10RedVolBias: 1.8,
      maxExactRangeATR14: 5.0,
      minRSI2: 50,
      maxCloseAboveZonePct: 7.0,
      minCandleQualityScore: 2,
    },
    vars: {
      minExactVolVsPre5:           [2.0, 3.0, 4.0],
      minExactVolRatio20:          [1.2, 1.6, 2.0],
      minExactRangeATR14:          [1.2, 1.5, 1.8],
      maxUpperWickPct:             [12, 16, 20],
      minCloseLoc:                 [58, 64, 70],
      minVolatilityExpansionRatio: [0.8, 1.0, 1.2],
      minBodyPct:                  [15, 22, 30],
      minUltraPrecisionScore:      [0, 30, 45, 60],
    },
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseDate(raw) {
  const s = String(raw || '').trim();
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
    const [dd, mon, yyyy] = s.split('-');
    const mm = String((MONTHS[mon] ?? 0) + 1).padStart(2, '0');
    return Math.floor(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)) / 1000);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = s.slice(0, 10);
    return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

function parseCSV(fp) {
  const text = fs.readFileSync(fp, 'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const hdr   = lines[0].split(',').map(h => h.trim().toLowerCase());
  const iDate = hdr.indexOf('date'), iO = hdr.indexOf('open'),
        iH    = hdr.indexOf('high'), iL = hdr.indexOf('low'),
        iC    = hdr.indexOf('close'), iV = hdr.indexOf('volume');
  if ([iDate,iO,iH,iL,iC,iV].some(x => x < 0)) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const ts = parseDate(p[iDate]);
    const o  = Number(p[iO]), h = Number(p[iH]), l = Number(p[iL]),
          c  = Number(p[iC]), v = Number(p[iV]);
    if (!ts || !Number.isFinite(c) || c <= 0) continue;
    out.push({ ts, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function avg(arr) { return arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0; }

function wilson(hits, n) {
  if (n <= 0) return 0;
  const z = 1.96, p = hits / n;
  return ((p + z*z/(2*n) - z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)) / (1+z*z/n)) * 100;
}

// ─── Metric computation (per bar) ────────────────────────────────────────────
function computeATR14(candles) {
  const atr = new Float64Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const { h, l, c } = candles[i];
    const prevC = i > 0 ? candles[i-1].c : c;
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    atr[i] = i === 0 ? tr : atr[i-1] * (13/15) + tr * (2/15);
  }
  return atr;
}

function computeRSI2(candles) {
  const rsi = new Float64Array(candles.length).fill(50);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < candles.length; i++) {
    const chg  = candles[i].c - candles[i-1].c;
    const gain = Math.max(0, chg), loss = Math.max(0, -chg);
    if (i < 3) {
      avgGain = avgGain * ((i-1)/i) + gain/i;
      avgLoss = avgLoss * ((i-1)/i) + loss/i;
    } else {
      avgGain = avgGain * 0.5 + gain * 0.5;
      avgLoss = avgLoss * 0.5 + loss * 0.5;
    }
    rsi[i] = avgLoss < 1e-10 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function computeRecord(candles, atr, rsi, i) {
  // Need ≥10 pre-bars + 20 vol-ma bars
  if (i < 21) return null;

  const bar = candles[i];
  const { h, l, c, o, v } = bar;
  if (atr[i] < 1e-10) return null;

  // ── Turnover & vol MA20
  let sumTurnover = 0, sumVol = 0;
  for (let j = i - 20; j < i; j++) {
    sumTurnover += candles[j].c * candles[j].v;
    sumVol      += candles[j].v;
  }
  const avgTurnover20 = sumTurnover / 20;
  const volMa20       = sumVol / 20;
  if (avgTurnover20 < MIN_TURNOVER) return null;

  // ── ATR percentile over prior 120 bars
  let atrPct14Pctl120 = 50;
  {
    const curAtrPct = atr[i] / c * 100;
    const start = Math.max(0, i - 120);
    let below = 0, total = 0;
    for (let j = start; j < i; j++) {
      total++;
      if (atr[j] / candles[j].c * 100 <= curAtrPct) below++;
    }
    atrPct14Pctl120 = total > 0 ? (below / total) * 100 : 50;
  }

  // ── Pre-10 window metrics (bars i-10 .. i-1)
  let pre10AvgRangeATR = 0, pre10ExpansionCount = 0;
  let pre10AvgVolRatio = 0;
  let pre10HighVolCount_12 = 0, pre10HighVolCount_15 = 0, pre10HighVolCount_135 = 0;
  let redVolSum = 0, redCount = 0, totalVolSum = 0;
  const pre10Start = Math.max(0, i - 10);
  const pre10Count = i - pre10Start;
  if (pre10Count < 5) return null;

  for (let j = pre10Start; j < i; j++) {
    const rng  = (candles[j].h - candles[j].l) / atr[j];
    pre10AvgRangeATR += rng;
    if (rng > 1.1) pre10ExpansionCount++;
    const vr = volMa20 > 0 ? candles[j].v / volMa20 : 1;
    pre10AvgVolRatio += vr;
    if (vr > 1.2)  pre10HighVolCount_12++;
    if (vr > 1.35) pre10HighVolCount_135++;
    if (vr > 1.5)  pre10HighVolCount_15++;
    totalVolSum += candles[j].v;
    if (candles[j].c < candles[j].o) { redVolSum += candles[j].v; redCount++; }
  }
  pre10AvgRangeATR /= pre10Count;
  pre10AvgVolRatio  /= pre10Count;
  // redVolBias = mean(red candle vol) / mean(all pre-10 vol); 0 if no red candles
  const meanPre10Vol   = totalVolSum / pre10Count;
  const pre10RedVolBias = (redCount > 0 && meanPre10Vol > 0)
    ? (redVolSum / redCount) / meanPre10Vol
    : 0;

  // ── Pre-5 vol ratio (bars i-5 .. i-1)
  let pre5VolSum = 0;
  const pre5Start = Math.max(0, i - 5);
  for (let j = pre5Start; j < i; j++) pre5VolSum += candles[j].v;
  const pre5AvgVol     = pre5VolSum / (i - pre5Start);
  const pre5VolRatio   = volMa20 > 0 ? pre5AvgVol / volMa20 : 1;

  // ── Zone detection (backward from i-1, threshold 1.0 for Elite/Sniper)
  // Also compute for 0.95 threshold (UltraSelective)
  function detectZone(thresh) {
    let zLen = 0, zHigh = -Infinity, zLow = Infinity;
    for (let j = i - 1; j >= Math.max(0, i - 25); j--) {
      const rng = (candles[j].h - candles[j].l) / atr[j];
      if (rng > thresh) break;
      zLen++;
      if (candles[j].h > zHigh) zHigh = candles[j].h;
      if (candles[j].l < zLow)  zLow  = candles[j].l;
    }
    if (zLen < 2) return { len: 0, tight: 999, closeAbove: 999 };
    const tight      = (zHigh - zLow) / zLow * 100;
    const closeAbove = (c - zHigh) / zHigh * 100;
    return { len: zLen, tight, closeAbove };
  }
  const zone100  = detectZone(1.0);
  const zone095  = detectZone(0.95);

  // ── Signal candle metrics
  const range    = h - l;
  if (range < 1e-10) return null;
  const closeLoc    = (c - l) / range * 100;
  const upperWick   = (h - Math.max(o, c)) / range * 100;
  const bodyPct     = Math.abs(c - o) / range * 100;
  const exactRangeATR14 = range / atr[i];
  const exactVolRatio20 = volMa20 > 0 ? v / volMa20 : 0;
  const exactVolVsPre5  = pre5AvgVol > 0 ? v / pre5AvgVol : 0;
  const volExpRatio     = pre10AvgRangeATR > 0 ? exactRangeATR14 / pre10AvgRangeATR : 0;

  // candle quality score v8
  let cqs = 0;
  if (closeLoc >= 65)       cqs++;
  if (upperWick <= 30)      cqs++;
  if (bodyPct >= 40)        cqs++;
  if (exactVolVsPre5 >= 2.5) cqs++;
  if (volExpRatio >= 1.5)   cqs++;

  // UltraPrecisionScore (0-100) — mirrors computeUPS() in stockEngine.ts
  let ups = 0;
  // Component 1 — Zone tightness (30 pts)
  const zT = zone100.len >= 2 ? zone100.tight : 999;
  if (zT <= 5) ups += 30; else if (zT <= 8) ups += 25; else if (zT <= 12) ups += 20; else if (zT <= 15) ups += 15;
  // Component 2 — Close location (10 pts)
  if (closeLoc >= 75) ups += 10; else if (closeLoc >= 65) ups += 7; else if (closeLoc >= 55) ups += 4;
  // Component 3 — Body % (10 pts)
  if (bodyPct >= 70) ups += 10; else if (bodyPct >= 55) ups += 7; else if (bodyPct >= 40) ups += 4; else if (bodyPct >= 20) ups += 2;
  // Component 4 — Upper wick (5 pts)
  if (upperWick <= 15) ups += 5; else if (upperWick <= 25) ups += 3; else if (upperWick <= 35) ups += 1;
  // Component 5 — Vol vs 20-day (10 pts)
  if (exactVolRatio20 >= 2.0) ups += 10; else if (exactVolRatio20 >= 1.5) ups += 7; else if (exactVolRatio20 >= 1.0) ups += 4;
  // Component 6 — Vol vs pre-5 (10 pts)
  if (exactVolVsPre5 >= 3.0) ups += 10; else if (exactVolVsPre5 >= 2.0) ups += 7; else if (exactVolVsPre5 >= 1.5) ups += 4;
  // Component 7 — Vol expansion (5 pts)
  if (volExpRatio >= 2.5) ups += 5; else if (volExpRatio >= 1.5) ups += 3; else if (volExpRatio >= 1.0) ups += 1;
  // Component 8 — RSI(2) (10 pts)
  const r2 = rsi[i];
  if (r2 >= 70) ups += 10; else if (r2 >= 60) ups += 7; else if (r2 >= 50) ups += 4; else if (r2 >= 40) ups += 2;
  // Component 9 — Candle risk / signalRangePct (10 pts)
  const sigRangePct = c > 0 ? (range / c) * 100 : 99;
  if (sigRangePct <= 5) ups += 10; else if (sigRangePct <= 7) ups += 7; else if (sigRangePct <= 9) ups += 4; else if (sigRangePct <= 11) ups += 2;
  ups = Math.min(100, Math.max(0, ups));

  // ── Forward returns
  let mfe10 = 0, mae10 = 0, hit3_10 = false, hit5_10 = false;
  let mfe20 = 0, mae20 = 0, hit5_20 = false;
  for (let d = 1; d <= Math.min(10, MAX_HOLD) && i + d < candles.length; d++) {
    const fb = candles[i + d];
    const hi = (fb.h - c) / c * 100, lo = (fb.l - c) / c * 100;
    if (hi > mfe10) mfe10 = hi;
    if (lo < mae10) mae10 = lo;
    if (!hit3_10 && hi >= 3) hit3_10 = true;
    if (!hit5_10 && hi >= 5) hit5_10 = true;
  }
  for (let d = 1; d <= MAX_HOLD && i + d < candles.length; d++) {
    const fb = candles[i + d];
    const hi = (fb.h - c) / c * 100, lo = (fb.l - c) / c * 100;
    if (hi > mfe20) mfe20 = hi;
    if (lo < mae20) mae20 = lo;
    if (!hit5_20 && hi >= 5) hit5_20 = true;
  }

  return {
    // identifiers
    // (sym added by caller)
    // metrics
    avgTurnover20,
    atrPct14Pctl120,
    pre10AvgRangeATR,
    pre10ExpansionCount,
    // zone@1.0
    zoneLen100: zone100.len,
    zoneTight100: zone100.tight,
    zoneClose100: zone100.closeAbove,
    // zone@0.95
    zoneLen095: zone095.len,
    zoneTight095: zone095.tight,
    zoneClose095: zone095.closeAbove,
    // vol ratios
    pre10AvgVolRatio,
    pre5VolRatio,
    pre10HighVolCount_12,
    pre10HighVolCount_135,
    pre10HighVolCount_15,
    pre10RedVolBias,
    // candle
    exactRangeATR14,
    exactVolRatio20,
    exactVolVsPre5,
    closeLoc,
    upperWick,
    bodyPct,
    volExpRatio,
    cqs,
    ups,
    rsi2: rsi[i],
    // outcomes
    mfe10, mae10, hit3_10, hit5_10,
    mfe20, mae20, hit5_20,
  };
}

// ─── Grid sweep helpers ───────────────────────────────────────────────────────
function passesFilter(rec, p, gridKey) {
  const useZone095 = gridKey === 'ultraselective';
  const zLen   = useZone095 ? rec.zoneLen095   : rec.zoneLen100;
  const zTight = useZone095 ? rec.zoneTight095 : rec.zoneTight100;
  const zClose = useZone095 ? rec.zoneClose095 : rec.zoneClose100;
  const highVolCnt = gridKey === 'ultraselective'
    ? rec.pre10HighVolCount_15
    : gridKey === 'sniper'
    ? rec.pre10HighVolCount_135
    : rec.pre10HighVolCount_12;

  if (rec.avgTurnover20                < p.minAvgTurnover20)          return false;
  if (rec.atrPct14Pctl120              > p.maxATRPct14Pctl120)         return false;
  if (rec.pre10AvgRangeATR             > p.maxPre10AvgRangeATR)        return false;
  if (rec.pre10ExpansionCount          > p.maxPre10ExpansionCount)      return false;
  if (zLen                             < p.minZoneLen)                  return false;
  if (zLen                             > p.maxZoneLen)                  return false;
  if (zTight                           > p.maxZoneTightnessPct)         return false;
  if (rec.pre10AvgVolRatio             > p.maxPre10AvgVolRatio)         return false;
  if (rec.pre5VolRatio                 > p.maxPre5AvgVolRatio)          return false;
  if (highVolCnt                       > p.maxPre10HighVolCount)        return false;
  if (rec.pre10RedVolBias              > p.maxPre10RedVolBias)          return false;
  if (rec.exactRangeATR14              < p.minExactRangeATR14)          return false;
  if (rec.exactRangeATR14              > p.maxExactRangeATR14)          return false;
  if (rec.exactVolRatio20              < p.minExactVolRatio20)           return false;
  if (rec.exactVolVsPre5               < p.minExactVolVsPre5)            return false;
  if (rec.closeLoc                     < p.minCloseLoc)                  return false;
  if (rec.upperWick                    > p.maxUpperWickPct)              return false;
  if (rec.bodyPct                      < p.minBodyPct)                   return false;
  if (rec.volExpRatio                  < p.minVolatilityExpansionRatio)  return false;
  if (rec.cqs                          < p.minCandleQualityScore)        return false;
  if (p.minUltraPrecisionScore  != null && rec.ups < p.minUltraPrecisionScore) return false;
  if (p.maxCloseAboveZonePct !== null && zClose > p.maxCloseAboveZonePct) return false;
  return true;
}

function scoreCombo(records, params, gridKey) {
  const hits = records.filter(r => passesFilter(r, params, gridKey));
  const n    = hits.length;
  if (n < MIN_TRADES_FOR_SCORE) return null;

  const h5_10     = hits.filter(r => r.hit5_10).length;
  const h5_20     = hits.filter(r => r.hit5_20).length;
  const mfes      = hits.map(r => r.mfe10);
  const maes      = hits.map(r => r.mae10);
  const winMfes   = hits.filter(r => r.hit5_10).map(r => r.mfe10);
  const lossMaes  = hits.filter(r => !r.hit5_10).map(r => Math.abs(r.mae10));

  const winTotal  = winMfes.reduce((s,v)=>s+v,0);
  const lossTotal = lossMaes.reduce((s,v)=>s+v,0);
  const pf        = lossTotal > 0 ? winTotal / lossTotal : winTotal > 0 ? 99 : 0;
  const wr5_10    = h5_10 / n * 100;
  const wil       = wilson(h5_10, n);
  const composite = wil * pf;
  const stocks    = new Set(hits.map(r => r._sym)).size;

  return {
    n, stocks,
    wr5_10: +wr5_10.toFixed(2),
    wilson: +wil.toFixed(2),
    pf:     +pf.toFixed(3),
    composite: +composite.toFixed(3),
    hit5_20: +(h5_20/n*100).toFixed(1),
    avgMfe10: +(mfes.reduce((s,v)=>s+v,0)/n).toFixed(2),
    avgMae10: +(maes.reduce((s,v)=>s+v,0)/n).toFixed(2),
  };
}

function* cartesian(vars) {
  const keys = Object.keys(vars);
  const vals  = keys.map(k => vars[k]);
  const total = vals.reduce((p,a)=>p*a.length,1);
  for (let i = 0; i < total; i++) {
    const combo = {};
    let rem = i;
    for (let k = keys.length - 1; k >= 0; k--) {
      combo[keys[k]] = vals[k][rem % vals[k].length];
      rem = Math.floor(rem / vals[k].length);
    }
    yield combo;
  }
}

function sweepGrid(records, gridDef, gridKey) {
  const combos = [...cartesian(gridDef.vars)];
  const results = [];
  for (const varCombo of combos) {
    const params = { ...gridDef.fixed, ...varCombo };
    const score  = scoreCombo(records, params, gridKey);
    if (score) results.push({ params: varCombo, ...score });
  }
  results.sort((a, b) => b.composite - a.composite);
  return { label: gridDef.label, totalCombos: combos.length, tested: results.length, top: results.slice(0, 30) };
}

// ─── Worker entry point ───────────────────────────────────────────────────────
if (!isMainThread) {
  const { files } = workerData;
  const records = [];
  let processed = 0, skipped = 0;

  const BATCH_SIZE = 500;

  for (const fp of files) {
    const sym     = path.basename(fp).replace(/_NS_OHLCV\.csv$/i,'').replace(/\.csv$/i,'');
    const candles = parseCSV(fp);
    if (candles.length < MIN_HISTORY + MAX_HOLD + 2) { skipped++; processed++; parentPort.postMessage({ type: 'progress', processed, skipped }); continue; }

    const atr = computeATR14(candles);
    const rsi = computeRSI2(candles);

    for (let i = MIN_HISTORY; i < candles.length - 1; i++) {
      const rec = computeRecord(candles, atr, rsi, i);
      if (rec) { rec._sym = sym; records.push(rec); }
    }

    // Flush in batches to avoid oversized messages
    while (records.length >= BATCH_SIZE) {
      parentPort.postMessage({ type: 'data', records: records.splice(0, BATCH_SIZE) });
    }

    processed++;
    parentPort.postMessage({ type: 'progress', processed, skipped });
  }

  // Flush remaining
  while (records.length > 0) {
    parentPort.postMessage({ type: 'data', records: records.splice(0, BATCH_SIZE) });
  }
  parentPort.postMessage({ type: 'done', skipped });
  return;
}

// ─── Main thread ──────────────────────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) { console.error('Data dir not found:', DATA_DIR); process.exit(1); }

const allFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().includes('_all') && !f.toLowerCase().includes('all_symbols'))
  .map(f => path.join(DATA_DIR, f));

const started = Date.now();
let doneFiles = 0, totalSkipped = 0, lastPrint = 0;
const allRecords = [];

console.log('='.repeat(80));
console.log('GRID SEARCH — Two-pass param optimisation');
console.log('='.repeat(80));
console.log(`Data     : ${DATA_DIR}`);
console.log(`Files    : ${allFiles.length}`);
console.log(`Workers  : ${N_WORKERS}`);
const totalCombos = Object.values(GRIDS).reduce((s, g) => s + Object.values(g.vars).reduce((p,a)=>p*a.length,1), 0);
console.log(`Grid size: ~${totalCombos.toLocaleString()} total combinations`);
console.log('');
console.log('Pass 1: Loading & computing metrics...');

const chunks = Array.from({ length: Math.min(N_WORKERS, allFiles.length) }, () => []);
allFiles.forEach((f, i) => chunks[i % chunks.length].push(f));

function printProgress(force = false) {
  const now = Date.now();
  if (!force && now - lastPrint < 1000) return;
  lastPrint = now;
  const elapsed = (now - started) / 1000;
  const rate = doneFiles > 0 ? doneFiles / elapsed : 0;
  const eta  = rate > 0 ? (allFiles.length - doneFiles) / rate : 0;
  process.stdout.write(`\r  ${doneFiles}/${allFiles.length} (${(doneFiles/allFiles.length*100).toFixed(1)}%) elapsed ${elapsed.toFixed(0)}s ETA ${eta.toFixed(0)}s  `);
}

Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
  const w = new Worker(__filename, { workerData: { files: chunk } });
  let workerProcessed = 0;
  w.on('message', msg => {
    if (msg.type === 'progress') {
      doneFiles += Math.max(0, msg.processed - workerProcessed);
      workerProcessed = msg.processed;
      printProgress();
    } else if (msg.type === 'data') {
      for (const r of msg.records) allRecords.push(r);
    } else if (msg.type === 'done') {
      totalSkipped += msg.skipped || 0;
      resolve();
    }
  });
  w.on('error', reject);
  w.on('exit', code => { if (code !== 0) reject(new Error(`Worker exit ${code}`)); });
}))).then(() => {
  doneFiles = allFiles.length;
  printProgress(true);
  const pass1Sec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n  Done. ${allRecords.length.toLocaleString()} candidate records from ${allFiles.length - totalSkipped} stocks (${totalSkipped} skipped).`);
  console.log(`  Pass 1 elapsed: ${pass1Sec}s`);
  console.log('');

  console.log('Pass 2: Sweeping grid combinations...');
  const pass2Start = Date.now();

  const gridResults = {};
  for (const [key, gridDef] of Object.entries(GRIDS)) {
    process.stdout.write(`  ${gridDef.label}...`);
    const t0 = Date.now();
    gridResults[key] = sweepGrid(allRecords, gridDef, key);
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    const tried = gridResults[key].totalCombos;
    const kept  = gridResults[key].tested;
    console.log(` ${tried.toLocaleString()} combos, ${kept} passed min-trade threshold. (${dt}s)`);
  }

  const pass2Sec = ((Date.now() - pass2Start) / 1000).toFixed(1);
  console.log(`  Pass 2 elapsed: ${pass2Sec}s`);
  console.log('');

  // ─── Build human-readable report ─────────────────────────────────────────
  function fmtRow(r, rank) {
    const p = r.params;
    const varStr = Object.entries(p).map(([k,v]) => `${k.replace(/^(min|max)/,'').replace(/([A-Z])/,' $1').trim()}=${v}`).join('  ');
    return `  #${String(rank).padStart(2)}  n=${String(r.n).padStart(5)}  WR=${String(r.wr5_10).padStart(5)}%  Wil=${String(r.wilson).padStart(5)}%  PF=${String(r.pf).padStart(5)}  Comp=${String(r.composite).padStart(7)}  Stk=${String(r.stocks).padStart(4)}  Hit20d=${r.hit5_20}%  | ${varStr}`;
  }

  const lines = [];
  lines.push('='.repeat(120));
  lines.push('GRID SEARCH RESULTS  —  Top 20 per param set');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Candidate records: ${allRecords.length.toLocaleString()}  |  Pass 1: ${pass1Sec}s  Pass 2: ${pass2Sec}s`);
  lines.push('Composite score = WilsonWR × ProfitFactor  (higher is better; min ${MIN_TRADES_FOR_SCORE} trades)');
  lines.push('='.repeat(120));

  for (const [key, res] of Object.entries(gridResults)) {
    lines.push('');
    lines.push(`── ${res.label.toUpperCase()}  (${res.totalCombos.toLocaleString()} combos, ${res.tested} passed min-trade floor) ──`);
    lines.push(`   ${'Rank'.padEnd(4)} ${'n'.padStart(5)}  ${'WR%'.padStart(6)}  ${'Wilson%'.padStart(7)}  ${'PF'.padStart(6)}  ${'Composite'.padStart(9)}  ${'Stocks'.padStart(6)}  ${'Hit20d%'.padStart(7)}  Variable params`);
    lines.push('   ' + '-'.repeat(116));
    res.top.slice(0, 20).forEach((r, i) => lines.push(fmtRow(r, i + 1)));

    if (res.top.length > 0) {
      const best = res.top[0];
      lines.push('');
      lines.push(`  ★ Best combo for ${res.label}:`);
      Object.entries(best.params).forEach(([k, v]) => lines.push(`      ${k}: ${v}`));
      lines.push(`    → n=${best.n}  WR=${best.wr5_10}%  Wilson=${best.wilson}%  PF=${best.pf}  Composite=${best.composite}`);
    }
  }
  lines.push('');
  lines.push('='.repeat(120));

  const report = lines.join('\n');
  console.log(report);

  // ─── Write output files ──────────────────────────────────────────────────
  const stamp     = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonFile  = path.join(__dirname, `${OUT_PREFIX}_${stamp}.json`);
  const txtFile   = path.join(__dirname, `${OUT_PREFIX}_${stamp}.txt`);
  fs.writeFileSync(jsonFile, JSON.stringify({ meta: { stamp, recordCount: allRecords.length, pass1Sec, pass2Sec }, gridResults }, null, 2), 'utf8');
  fs.writeFileSync(txtFile, report, 'utf8');
  console.log(`\nFiles written:`);
  console.log(`  ${jsonFile}`);
  console.log(`  ${txtFile}`);

}).catch(err => {
  console.error('\nGrid search failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});
