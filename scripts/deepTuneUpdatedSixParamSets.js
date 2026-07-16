'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const PARAM_INPUT_FILE = process.env.PARAM_INPUT_FILE || path.join(__dirname, 'updated_six_param_sets_2026-07-15.json');
const OUT_PREFIX = process.env.OUT_PREFIX || 'deep_tune_updated_six_param_sets';
const HISTORY_WINDOW = Number(process.env.HISTORY_WINDOW || 320);
const MIN_HISTORY = Number(process.env.MIN_HISTORY || 220);
const MAX_HOLD = Number(process.env.MAX_HOLD || 20);
const ENTRY_WINDOW = Number(process.env.ENTRY_WINDOW || 3);
const RANDOM_COMBOS = Number(process.env.RANDOM_COMBOS || 12000);
const TOP_N = Number(process.env.TOP_N || 12);
const CANDIDATE_CAP = Math.max(1000, Number(process.env.CANDIDATE_CAP || 60000));
const N_WORKERS = Math.max(1, Number(process.env.N_WORKERS || Math.min(8, Math.max(1, os.cpus().length - 1))));

const BREAKOUT_KEYS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];
const PARAM_KEYS = [...BREAKOUT_KEYS, 'ors_prime_reversal'];
const LABELS = {
  optimized_deployable_20plus: 'Deployable',
  optimized_highprecision_15plus: 'HighPrecision',
  optimized_elite_10plus: 'Elite',
  optimized_ultraselective_8plus: 'UltraSelective',
  sniper_95plus: 'Sniper',
  ors_prime_reversal: 'ORS-Prime',
};
const ACTIONABLE_OR_CLOSE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
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
  return Number.isFinite(t) ? { iso: new Date(t).toISOString().slice(0, 10), ts: Math.floor(t / 1000) } : { iso: '', ts: 0 };
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
    const o = Number(p[iOpen]), hgh = Number(p[iHigh]), lo = Number(p[iLow]), c = Number(p[iClose]), v = Number(p[iVol]);
    if (!iso || !ts || !Number.isFinite(o) || !Number.isFinite(hgh) || !Number.isFinite(lo) || !Number.isFinite(c) || c <= 0 || hgh < lo) continue;
    out.push({ ts, date: iso, o, h: hgh, l: lo, c, v: Number.isFinite(v) ? v : 0 });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function pct(n, d) { return d > 0 ? n / d * 100 : 0; }
function avg(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function wilson(h, n) {
  if (n <= 0) return 0;
  const z = 1.96, p = h / n;
  return ((p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n)) * 100;
}

function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

function levelsFromEngine(pe, fallback) {
  const entry = Number(pe?.plannedEntry || fallback);
  const stop = Number(pe?.tacticalStop || entry * 0.94);
  const t1 = Number(pe?.target5 || entry * 1.05);
  const t2 = Number(pe?.target7 || entry * 1.08);
  const t3 = Number(pe?.target10 || entry * 1.12);
  if (![entry, stop, t1, t2, t3].every(Number.isFinite) || entry <= 0 || stop <= 0 || stop >= entry) return null;
  return { entry, stop, t1: Math.max(t1, entry * 1.001), t2: Math.max(t2, t1), t3: Math.max(t3, t2) };
}

function simulateBreakout(candles, signalIdx, levels) {
  const entryIdx = signalIdx + 1;
  if (entryIdx >= candles.length) return null;
  const entry = candles[entryIdx].o;
  if (!Number.isFinite(entry) || entry <= 0) return null;
  const toPct = price => (price - entry) / entry * 100;
  const t1Pct = toPct(levels.t1), t2Pct = toPct(levels.t2), t3Pct = toPct(levels.t3);
  const riskAbs = Math.max(0.0001, entry - levels.stop);
  let stop = levels.stop, pos = 1, pnl = 0, status = 'time', t1Hit = false, t2Hit = false;
  let exitIdx = Math.min(entryIdx + MAX_HOLD - 1, candles.length - 1), mfe = 0, mae = 0;
  for (let i = entryIdx; i <= Math.min(entryIdx + MAX_HOLD - 1, candles.length - 1); i++) {
    const b = candles[i];
    mfe = Math.max(mfe, toPct(b.h)); mae = Math.min(mae, toPct(b.l));
    if (pos > 0 && b.o <= stop) { pnl += pos * toPct(b.o); status = t2Hit ? 'stop_gap_t2' : t1Hit ? 'stop_gap_t1' : 'stop_gap'; exitIdx = i; pos = 0; break; }
    if (pos > 0 && b.l <= stop) { pnl += pos * toPct(stop); status = t2Hit ? 'stop_t2' : t1Hit ? 'stop_t1' : 'stop'; exitIdx = i; pos = 0; break; }
    if (!t1Hit && b.h >= levels.t1 && pos > 0) { pnl += 0.5 * t1Pct; pos -= 0.5; t1Hit = true; status = 'hit_t1'; stop = Math.max(stop, entry); }
    if (t1Hit && !t2Hit && b.h >= levels.t2 && pos > 0) { pnl += 0.3 * t2Pct; pos -= 0.3; t2Hit = true; status = 'hit_t2'; stop = Math.max(stop, levels.t1); }
    if (t2Hit && b.h >= levels.t3 && pos > 0) { pnl += pos * t3Pct; pos = 0; status = 'hit_t3'; exitIdx = i; break; }
  }
  if (pos > 0) { pnl += pos * toPct(candles[exitIdx].c); status = t2Hit ? 'time_t2' : t1Hit ? 'time_t1' : 'time'; }
  return { pnl, pnlR: ((entry * (1 + pnl / 100)) - entry) / riskAbs, status, mfe, mae, days: exitIdx - entryIdx + 1, entryDate: candles[entryIdx].date };
}

function relaxedBreakout(base) {
  return {
    ...base,
    minAvgTurnover20: Math.min(base.minAvgTurnover20, 5000000),
    maxATRPct14Pctl120: 99,
    maxPre10AvgRangeATR: Math.max(base.maxPre10AvgRangeATR, 1.5),
    maxPre10ExpansionCount: Math.max(base.maxPre10ExpansionCount, 5),
    // Zone geometry is selected by the live engine, so keep it exact while
    // collecting cached candidates. Zone sweeps require a separate engine run.
    zoneRangeATRThreshold: base.zoneRangeATRThreshold,
    minZoneLen: base.minZoneLen,
    maxZoneLen: base.maxZoneLen,
    maxZoneTightnessPct: base.maxZoneTightnessPct,
    maxPre10AvgVolRatio: Math.max(base.maxPre10AvgVolRatio, 1.3),
    maxPre5AvgVolRatio: Math.max(base.maxPre5AvgVolRatio, 1.4),
    maxPre10HighVolCount: Math.max(base.maxPre10HighVolCount, 6),
    maxPre10RedVolBias: Math.max(base.maxPre10RedVolBias, 3),
    minExactRangeATR14: 0.1,
    maxExactRangeATR14: Math.max(base.maxExactRangeATR14, 8),
    minExactVolRatio20: 0.1,
    minExactVolVsPre5: 0.1,
    minCloseLoc: 0,
    maxUpperWickPct: 100,
    minBodyPct: 0,
    maxCandleRisk: Math.max(base.maxCandleRisk, 15),
    minUltraPrecisionScore: 0,
    minRSI2: 0,
    minVolatilityExpansionRatio: null,
    minCandleQualityScore: null,
    maxCloseAboveZonePct: null,
    forensic: {},
  };
}

function captureBreakout(r, candles, i, sym) {
  if (!ACTIONABLE_OR_CLOSE.has(r.stage)) return null;
  const levels = levelsFromEngine(r.priceEngine, candles[i].c);
  if (!levels) return null;
  const sim = simulateBreakout(candles, i, levels);
  if (!sim) return null;
  const dna = r.candleDNA || {}, adv = r.advanced || {}, st = r.stats || {};
  const fwd = (days) => {
    let mfe = 0, mae = 0, hit3 = false, hit5 = false;
    for (let d = 1; d <= days && i + d < candles.length; d++) {
      const b = candles[i + d];
      const hp = (b.h - candles[i].c) / candles[i].c * 100;
      const lp = (b.l - candles[i].c) / candles[i].c * 100;
      mfe = Math.max(mfe, hp); mae = Math.min(mae, lp); hit3 ||= hp >= 3; hit5 ||= hp >= 5;
    }
    return { mfe, mae, hit3, hit5 };
  };
  return {
    sym, idx: i, date: candles[i].date, pnl: sim.pnl, pnlR: sim.pnlR, status: sim.status, mfe: sim.mfe, mae: sim.mae, days: sim.days,
    hit3_10: fwd(10).hit3, hit5_10: fwd(10).hit5, hit5_20: fwd(20).hit5,
    avgTurnover20: r.avgTurnover20, atrPct14Pctl120: r.atrPct14Pctl120, pre10AvgRangeATR: r.pre10AvgRangeATR, pre10ExpansionCount: r.pre10ExpansionCount,
    zoneLen: r.zone?.windowLength ?? 0, zoneTightnessPct: r.zone?.zoneTightnessPct ?? 999, pre10AvgVolRatio: r.pre10AvgVolRatio, pre5AvgVolRatio: r.pre5AvgVolRatio,
    pre10HighVolCount: r.pre10HighVolCount, pre10RedVolBias: r.pre10RedVolBias, exactRangeATR14: r.exactRangeATR14, exactVolRatio20: r.exactVolRatio20,
    exactVolVsPre5: r.exactVolVsPre5, closeLoc: r.closeLoc, upperWickPct: r.upperWickPct, bodyPct: r.bodyPct, signalRangePct: r.signalRangePct,
    ultraPrecisionScore: r.ultraPrecisionScore, rsi2: r.rsi2, volatilityExpansionRatio: r.volatilityExpansionRatio, candleQualityScore: r.candleQualityScore,
    closeAboveZonePct: r.zone && r.zone.zoneHigh > 0 ? ((candles[i].c - r.zone.zoneHigh) / r.zone.zoneHigh) * 100 : 999,
    candleDnaScore: dna.score ?? 0, candleDnaCloseQuality: dna.wickCleanliness ?? 0, candleDnaLowerTail: dna.rangeExpansion ?? 0, bodyATR: dna.bodyATR ?? 0,
    upperToLowerWickRatio: dna.upperToLowerWickRatio ?? 99, marubozuScore: dna.marubozuScore ?? 0,
    advScore: adv.advScore ?? 0, fer20: adv.fer20 ?? 0, cusumPos: adv.cusumPos ?? 0, mwcScore: adv.mwcScore ?? 0, tram: adv.tram ?? 0,
    cleanMom: adv.cleanMom ?? 0, durationRatio: adv.durationRatio ?? 0, vram: adv.vram ?? 0, pic: adv.pic ?? 0, utbotBarsAgo: adv.utbotBarsAgo ?? 99,
    bbWidthPctl: st.bbWidthPctl ?? 50, volZScore: st.volZScore ?? 0, statsScore: st.statsScore ?? 0, sharpe20: st.sharpe20 ?? 0, entropy10: st.entropy10 ?? 0,
    insideBars: st.insideBars ?? 0, guppyCompressDays: st.guppyCompressDays ?? 0, guppyGroupGapPct: st.guppyGroupGapPct ?? 0,
    guppyCoiledRelease: !!st.guppyCoiledRelease, guppyCleanBullishFan: !!st.guppyCleanBullishFan, candlePatternStrength: st.candlePatternStrength ?? 0,
    bullishPattern: st.candlePatternType === 'bullish',
  };
}

function corePasses(s, p) {
  return s.avgTurnover20 >= p.minAvgTurnover20 && s.atrPct14Pctl120 <= p.maxATRPct14Pctl120 &&
    s.pre10AvgRangeATR <= p.maxPre10AvgRangeATR && s.pre10ExpansionCount <= p.maxPre10ExpansionCount &&
    s.zoneLen >= p.minZoneLen && s.zoneLen <= p.maxZoneLen && s.zoneTightnessPct <= p.maxZoneTightnessPct &&
    s.pre10AvgVolRatio <= p.maxPre10AvgVolRatio && s.pre5AvgVolRatio <= p.maxPre5AvgVolRatio &&
    s.pre10HighVolCount <= p.maxPre10HighVolCount && s.pre10RedVolBias <= p.maxPre10RedVolBias &&
    s.exactRangeATR14 >= p.minExactRangeATR14 && s.exactRangeATR14 <= p.maxExactRangeATR14 &&
    s.exactVolRatio20 >= p.minExactVolRatio20 && s.exactVolVsPre5 >= p.minExactVolVsPre5 &&
    s.closeLoc >= p.minCloseLoc && s.upperWickPct <= p.maxUpperWickPct && s.bodyPct >= p.minBodyPct &&
    s.signalRangePct <= p.maxCandleRisk && s.ultraPrecisionScore >= p.minUltraPrecisionScore && s.rsi2 >= p.minRSI2 &&
    (p.minVolatilityExpansionRatio == null || s.volatilityExpansionRatio >= p.minVolatilityExpansionRatio) &&
    (p.minCandleQualityScore == null || s.candleQualityScore >= p.minCandleQualityScore) &&
    (p.maxCloseAboveZonePct == null || s.closeAboveZonePct <= p.maxCloseAboveZonePct);
}

function forensicPasses(s, f = {}) {
  const ge = (key, value) => f[key] == null || value >= f[key];
  const le = (key, value) => f[key] == null || value <= f[key];
  return ge('minCandleDnaScore', s.candleDnaScore) && ge('minCandleDnaCloseQuality', s.candleDnaCloseQuality) &&
    ge('minCandleDnaLowerTail', s.candleDnaLowerTail) && le('maxBodyATR', s.bodyATR) &&
    le('maxUpperToLowerWickRatio', s.upperToLowerWickRatio) && ge('minMarubozuScore', s.marubozuScore) &&
    ge('minAdvScore', s.advScore) && ge('minFer20', s.fer20) && le('maxCusumPos', s.cusumPos) &&
    le('maxMwcScore', s.mwcScore) && le('maxTram', s.tram) && le('maxCleanMom', s.cleanMom) &&
    le('maxDurationRatio', s.durationRatio) && le('maxVram', s.vram) && ge('minPic', s.pic) &&
    le('maxPic', s.pic) && le('maxUtbotBarsAgo', s.utbotBarsAgo) && le('maxBbWidthPctl', s.bbWidthPctl) &&
    ge('minVolZScore', s.volZScore) && ge('minStatsScore', s.statsScore) && ge('minSharpe20', s.sharpe20) &&
    le('maxEntropy10', s.entropy10) && ge('minInsideBars', s.insideBars) && ge('minGuppyCompressDays', s.guppyCompressDays) &&
    ge('minGuppyGroupGapPct', s.guppyGroupGapPct) && (!f.requireGuppyCleanBullishFan || s.guppyCleanBullishFan) &&
    (!f.requireGuppyCoiledRelease || s.guppyCoiledRelease) && ge('minCandlePatternStrength', s.candlePatternStrength) &&
    (!f.requireBullishPattern || s.bullishPattern);
}

function atrSeries(c) {
  const out = new Array(c.length).fill(0);
  if (c.length < 15) return out;
  let sum = 0;
  for (let i = 1; i <= 14; i++) sum += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  out[14] = sum / 14;
  for (let i = 15; i < c.length; i++) {
    const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    out[i] = (out[i - 1] * 13 + tr) / 14;
  }
  return out;
}

function emaSeries(c, len) {
  const out = new Array(c.length).fill(0), k = 2 / (len + 1);
  if (!c.length) return out;
  out[0] = c[0].c;
  for (let i = 1; i < c.length; i++) out[i] = c[i].c * k + out[i - 1] * (1 - k);
  return out;
}

function rsiAt(c, i, len) {
  let g = 0, l = 0;
  for (let j = Math.max(1, i - len + 1); j <= i; j++) { const d = c[j].c - c[j - 1].c; if (d > 0) g += d; else l -= d; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

function orsScore(f) {
  let s = 0;
  if (f.rsi2 <= 3) s += 30; else if (f.rsi2 <= 5) s += 25; else if (f.rsi2 <= 10) s += 20; else if (f.rsi2 <= 15) s += 12;
  if (f.rsi14 <= 30) s += 15; else if (f.rsi14 <= 38) s += 10; else if (f.rsi14 <= 45) s += 5;
  if (f.rangePct >= 5) s += 10; else if (f.rangePct >= 3.5) s += 7; else if (f.rangePct >= 2.4) s += 4;
  if (f.distEMA20 <= -8) s += 10; else if (f.distEMA20 <= -5) s += 7; else if (f.distEMA20 <= -2) s += 4;
  if (f.bodyPct >= 60) s += 8; else if (f.bodyPct >= 45) s += 5; else if (f.bodyPct >= 35) s += 2;
  if (f.upperWickPct <= 10) s += 7; else if (f.upperWickPct <= 20) s += 5; else if (f.upperWickPct <= 30) s += 2;
  if (f.swingLow) s += 5;
  if (f.volDryUp <= 0.70) s += 5; else if (f.volDryUp <= 0.85) s += 3;
  if (f.ddSwingHigh >= 30) s += 10; else if (f.ddSwingHigh >= 25) s += 8; else if (f.ddSwingHigh >= 20) s += 6; else if (f.ddSwingHigh >= 15) s += 3;
  if (f.zScore <= -3) s += 12; else if (f.zScore <= -2.5) s += 8; else if (f.zScore <= -2) s += 5;
  return Math.min(s, 100);
}

function orsFeatures(c, atr, ema, i) {
  if (i < 260 || i <= 10 || !atr[i] || c[i].c <= 0) return null;
  const b = c[i], range = b.h - b.l;
  if (range <= 0) return null;
  const bodyPct = Math.abs(b.c - b.o) / range * 100;
  const upperWickPct = (b.h - Math.max(b.o, b.c)) / range * 100;
  const closeLoc = (b.c - b.l) / range * 100;
  const rangePct = range / b.c * 100;
  const v20 = avg(c.slice(Math.max(0, i - 20), i).map(x => x.v));
  const v5 = avg(c.slice(Math.max(0, i - 5), i).map(x => x.v));
  let hi = -Infinity, lo = Infinity;
  for (let j = Math.max(0, i - 60); j < i; j++) hi = Math.max(hi, c[j].h);
  for (let j = Math.max(0, i - 6); j < i; j++) lo = Math.min(lo, c[j].l);
  const prices = c.slice(Math.max(0, i - 251), i + 1).map(x => x.c);
  const mean = avg(prices), sd = prices.length > 1 ? Math.sqrt(prices.reduce((s, x) => s + (x - mean) ** 2, 0) / (prices.length - 1)) : 0;
  const f = {
    atr: atr[i], red: b.c < b.o, rsi2: rsiAt(c, i, 2), rsi14: rsiAt(c, i, 14), closeLoc, bodyPct, upperWickPct, rangePct,
    distEMA20: ema[i] > 0 ? (b.c - ema[i]) / ema[i] * 100 : 0, ddSwingHigh: hi > 0 ? (hi - b.c) / hi * 100 : 0,
    swingLow: b.l <= lo, volDryUp: v20 > 0 ? v5 / v20 : 1, zScore: sd > 0 ? (b.c - mean) / sd : 0,
    turnover20: v20 * b.c,
  };
  f.score = orsScore(f);
  return f;
}

function orsPasses(f, p) {
  return f && f.turnover20 >= 10000000 && (!p.requireRedCandle || f.red) && f.rsi2 <= p.maxRSI2 && f.rsi14 <= p.maxRSI14 &&
    f.closeLoc <= p.maxCloseLoc && f.bodyPct >= p.minBodyPct && f.upperWickPct <= p.maxUpperWickPct && f.rangePct >= p.minRangePct &&
    f.distEMA20 <= p.maxDistEMA20 && f.ddSwingHigh >= p.minDdSwingHigh && (!p.requireSwingLow || f.swingLow) && f.score >= p.minOrsScore;
}

function simulateORSPath(future, atr, p) {
  if (!future || !future[0]) return null;
  const entry = future[0].o;
  if (!Number.isFinite(entry) || entry <= 0) return null;
  const stop = entry - p.slAtrMult * atr, target = entry * (1 + p.tpPct / 100), maxHold = Math.max(1, Math.round(p.maxHoldBars));
  if (stop <= 0 || stop >= entry) return null;
  let pnl = 0, status = 'time', exitIdx = Math.min(maxHold - 1, future.length - 1), mfe = 0, mae = 0;
  for (let i = 0; i <= exitIdx; i++) {
    const b = future[i], hp = (b.h - entry) / entry * 100, lp = (b.l - entry) / entry * 100;
    mfe = Math.max(mfe, hp); mae = Math.min(mae, lp);
    if (b.o <= stop) { pnl = (b.o - entry) / entry * 100; status = 'stop_gap'; exitIdx = i; break; }
    if (b.l <= stop) { pnl = (stop - entry) / entry * 100; status = 'stop'; exitIdx = i; break; }
    if (b.h >= target) { pnl = p.tpPct; status = 'target'; exitIdx = i; break; }
    if (i === exitIdx) pnl = (b.c - entry) / entry * 100;
  }
  return { pnl, pnlR: pnl / Math.max(0.0001, (entry - stop) / entry * 100), status, mfe, mae: mae, days: exitIdx + 1, entryDate: future[0].date,
    hit3_10: mfe >= 3, hit5_10: mfe >= 5, hit5_20: mfe >= 5 };
}

function captureORS(candles, i, features, gateP, simP, sym) {
  const today = features[i], prev = features[i - 1];
  const confirmed = !!(prev && orsPasses(prev, gateP) && candles[i].c > candles[i].o);
  const current = !confirmed && orsPasses(today, gateP);
  if (!confirmed && !current) return null;
  const f = confirmed ? prev : today;
  const future = candles.slice(i + 1, i + 1 + Math.max(25, Math.round(simP.maxHoldBars))).map(b => ({ o: b.o, h: b.h, l: b.l, c: b.c, date: b.date }));
  const sim = simulateORSPath(future, f.atr, simP);
  if (!sim) return null;
  return { sym, idx: i, date: candles[i].date, confirmed, green: candles[i].c > candles[i].o, today, prev, future, score: f.score, ...sim, rsi2: f.rsi2, rsi14: f.rsi14, closeLoc: f.closeLoc, bodyPct: f.bodyPct,
    upperWickPct: f.upperWickPct, rangePct: f.rangePct, distEMA20: f.distEMA20, ddSwingHigh: f.ddSwingHigh, swingLow: f.swingLow, turnover20: f.turnover20 };
}

function collectWorker(files, config) {
  const engine = require(path.join(config.engineDir, 'stockEngine.js'));
  const base = config.base;
  for (const key of BREAKOUT_KEYS) Object.assign(engine.PARAM_SETS[key], relaxedBreakout(base[key]));
  const orsGatePool = {
    ...base.ors_prime_reversal.ors,
    maxRSI2: 15, maxRSI14: 45, maxCloseLoc: 50, minBodyPct: 35, maxUpperWickPct: 30,
    minRangePct: 2.4, maxDistEMA20: 0, minDdSwingHigh: 20, requireSwingLow: false,
    requireRedCandle: false, minOrsScore: 60,
  };
  const out = Object.fromEntries(PARAM_KEYS.map(k => [k, []]));
  let processed = 0, skipped = 0, minDate = '', maxDate = '';
  for (const fp of files) {
    const sym = path.basename(fp).replace(/_NS_OHLCV_OHLCV\.csv$/i, '').replace(/_NS_OHLCV\.csv$/i, '').replace(/\.csv$/i, '');
    const candles = parseCSV(fp);
    if (candles.length < config.minHistory + config.maxHold + 2) { skipped++; processed++; parentPort.postMessage({ type: 'progress', processed, skipped }); continue; }
    if (!minDate || candles[0].date < minDate) minDate = candles[0].date;
    if (!maxDate || candles[candles.length - 1].date > maxDate) maxDate = candles[candles.length - 1].date;
    const atr = atrSeries(candles), ema = emaSeries(candles, 20);
    const orsFs = new Array(candles.length);
    for (let i = config.minHistory; i < candles.length - 1; i++) orsFs[i] = orsFeatures(candles, atr, ema, i);
    for (let i = config.minHistory; i < candles.length - 1; i++) {
      const window = candles.slice(Math.max(0, i + 1 - config.historyWindow), i + 1);
      for (const key of BREAKOUT_KEYS) {
        let r;
        try { r = engine.analyzeStock(window, key); } catch { continue; }
        const row = captureBreakout(r, candles, i, sym);
        if (row) out[key].push(row);
      }
      const orsRow = captureORS(candles, i, orsFs, orsGatePool, base.ors_prime_reversal.ors, sym);
      if (orsRow) out.ors_prime_reversal.push(orsRow);
    }
    processed++;
    parentPort.postMessage({ type: 'progress', processed, skipped });
  }
  parentPort.postMessage({ type: 'done', out, meta: { skipped, minDate, maxDate } });
}

function dedupe(trades) {
  const sorted = [...trades].sort((a, b) => a.sym.localeCompare(b.sym) || a.idx - b.idx);
  const next = {}, out = [];
  for (const t of sorted) { if (t.idx < (next[t.sym] || 0)) continue; out.push(t); next[t.sym] = t.idx + Math.max(1, t.days); }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.sym.localeCompare(b.sym));
}

function calc(arr) {
  const n = arr.length, wins = arr.filter(t => t.pnl > 0), losses = arr.filter(t => t.pnl <= 0);
  const gw = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  return { n, stocks: new Set(arr.map(t => t.sym)).size, wr: pct(wins.length, n), wilson: wilson(wins.length, n), avg: avg(arr.map(t => t.pnl)),
    pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0), avgR: avg(arr.map(t => t.pnlR)), mfe: avg(arr.map(t => t.mfe)), mae: avg(arr.map(t => t.mae)),
    hit3_10: pct(arr.filter(t => t.hit3_10).length, n), hit5_10: pct(arr.filter(t => t.hit5_10).length, n), hit5_20: pct(arr.filter(t => t.hit5_20).length, n) };
}

function metrics(raw) {
  const sorted = dedupe(raw), cut = Math.floor(sorted.length * 0.7);
  const is = sorted.slice(0, cut), oos = sorted.slice(cut);
  return { ...calc(sorted), is: calc(is), oos: calc(oos), rawN: raw.length };
}

function valuePool(base, values) { return [...new Set(values.filter(v => v === null || typeof v === 'boolean' || Number.isFinite(v)))]; }
function axesFor(key, base) {
  if (key === 'ors_prime_reversal') {
    const p = base.ors;
    return {
      maxRSI2: valuePool(p.maxRSI2, [3, 5, 7, 10, 15]), maxRSI14: valuePool(p.maxRSI14, [30, 35, 38, 42, 45]), maxCloseLoc: valuePool(p.maxCloseLoc, [25, 30, 35, 40, 50]),
      minBodyPct: valuePool(p.minBodyPct, [35, 45, 55, 60, 70]), maxUpperWickPct: valuePool(p.maxUpperWickPct, [10, 15, 20, 25, 30]), minRangePct: valuePool(p.minRangePct, [2.4, 3, 3.5, 4, 5, 6]),
      maxDistEMA20: valuePool(p.maxDistEMA20, [-8, -5, -3, -2, 0]), minDdSwingHigh: valuePool(p.minDdSwingHigh, [20, 25, 30, 35, 40]), requireSwingLow: [false, true], requireRedCandle: [false, true],
      minOrsScore: valuePool(p.minOrsScore, [60, 65, 70, 72, 75, 80]),
    };
  }
  const c = {
    minAvgTurnover20: [5000000, 10000000, 15000000, 20000000, 30000000], maxATRPct14Pctl120: [20, 30, 40, 50, 60, 70, 85, 95],
    maxPre10AvgRangeATR: [0.65, 0.8, 1.0, 1.15, 1.3, 1.5], maxPre10ExpansionCount: [0, 1, 2, 3], minZoneLen: [3, 4, 5, 6, 8, 10],
    maxZoneTightnessPct: [4, 6, 8, 10, 12, 15, 18, 22], maxPre10AvgVolRatio: [0.75, 0.85, 0.9, 1.0, 1.1], maxPre5AvgVolRatio: [0.85, 0.95, 1.05, 1.1, 1.2],
    maxPre10HighVolCount: [0, 1, 2, 3, 4], maxPre10RedVolBias: [0.8, 0.9, 1.0, 1.1, 1.3, 1.6, 2.0], minExactRangeATR14: [0.4, 0.8, 1.2, 1.5, 1.8, 2.1, 2.4],
    minExactVolRatio20: [0.8, 1.1, 1.3, 1.5, 1.8, 2.1, 2.4], minExactVolVsPre5: [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0], minCloseLoc: [30, 40, 50, 55, 65, 70, 75, 80],
    maxUpperWickPct: [10, 12, 15, 18, 20, 25, 30, 40], minBodyPct: [20, 35, 50, 60, 70, 75, 80], maxCandleRisk: [4, 5, 6, 7, 8.5, 10, 12],
    minUltraPrecisionScore: [0, 5, 25, 45, 50, 60], minRSI2: [35, 45, 50, 55, 60], minVolatilityExpansionRatio: [null, 0.75, 1, 1.4, 1.8, 2, 2.4, 2.8],
    minCandleQualityScore: [null, 1, 2, 3, 4, 5], maxCloseAboveZonePct: [null, 3, 4, 5, 6, 8, 10],
  };
  const dims = key === 'optimized_deployable_20plus'
    ? ['maxATRPct14Pctl120','maxPre10AvgRangeATR','maxPre10RedVolBias','minExactVolRatio20','minExactVolVsPre5','minCloseLoc','maxUpperWickPct','minBodyPct','maxCandleRisk','minVolatilityExpansionRatio','maxCloseAboveZonePct']
    : key === 'optimized_highprecision_15plus'
      ? ['maxATRPct14Pctl120','maxPre10AvgRangeATR','maxPre10RedVolBias','minExactRangeATR14','minExactVolRatio20','minExactVolVsPre5','minCloseLoc','maxUpperWickPct','minBodyPct','maxCandleRisk','minVolatilityExpansionRatio','maxCloseAboveZonePct']
      : key === 'optimized_elite_10plus'
        ? ['minAvgTurnover20','maxATRPct14Pctl120','maxPre10AvgRangeATR','maxPre10RedVolBias','minExactVolRatio20','minExactVolVsPre5','minCloseLoc','maxUpperWickPct','minBodyPct','maxCandleRisk','minVolatilityExpansionRatio','maxCloseAboveZonePct']
        : key === 'optimized_ultraselective_8plus'
          ? ['maxATRPct14Pctl120','maxPre10AvgRangeATR','maxPre10RedVolBias','minExactRangeATR14','minExactVolRatio20','minExactVolVsPre5','minCloseLoc','maxUpperWickPct','minBodyPct','maxCandleRisk','minVolatilityExpansionRatio','minCandleQualityScore']
          : ['maxATRPct14Pctl120','maxPre10AvgRangeATR','maxPre10RedVolBias','minExactVolRatio20','minExactVolVsPre5','minCloseLoc','maxUpperWickPct','minBodyPct','maxCandleRisk','minVolatilityExpansionRatio','maxCloseAboveZonePct'];
  return Object.fromEntries(dims.map(k => [k, valuePool(base[k], c[k])]));
}

function orsSelectedFeature(row, p) {
  const confirmed = !!(row.prev && orsPasses(row.prev, p) && row.green);
  const current = !confirmed && orsPasses(row.today, p);
  return confirmed ? row.prev : current ? row.today : null;
}

function filterTrades(signals, p, key) {
  if (key !== 'ors_prime_reversal') return signals.filter(s => corePasses(s, p) && forensicPasses(s, p.forensic || {}));
  const out = [];
  for (const s of signals) {
    const f = orsSelectedFeature(s, p.ors);
    if (!f) continue;
    const sim = simulateORSPath(s.future, f.atr, p.ors);
    if (!sim) continue;
    out.push({ ...s, ...sim, score: f.score, rsi2: f.rsi2, rsi14: f.rsi14, closeLoc: f.closeLoc, bodyPct: f.bodyPct, upperWickPct: f.upperWickPct,
      rangePct: f.rangePct, distEMA20: f.distEMA20, ddSwingHigh: f.ddSwingHigh, swingLow: f.swingLow, turnover20: f.turnover20 });
  }
  return out;
}
function randomCandidate(base, axes, rand) {
  const p = JSON.parse(JSON.stringify(base));
  const target = p.ors ? p.ors : p;
  for (const [k, vals] of Object.entries(axes)) target[k] = vals[Math.floor(rand() * vals.length)];
  return p;
}

function score(m, baseM) {
  const minOos = Math.max(4, Math.min(14, Math.ceil(baseM.oos.n * 0.5)));
  const minN = Math.max(10, Math.ceil(baseM.n * 0.45));
  if (m.n < minN || m.oos.n < minOos) return -Infinity;
  const pf = clamp(Number.isFinite(m.oos.pf) ? m.oos.pf : 5, 0, 5);
  const countFactor = Math.min(1, Math.sqrt(m.oos.n / 20));
  const maePenalty = Math.max(0, Math.abs(m.oos.mae) - 6) * 0.8;
  return countFactor * (m.oos.wr * 0.32 + m.oos.wilson * 0.22 + m.oos.avg * 7 + pf * 6 + m.oos.hit5_20 * 0.10 + clamp(m.oos.mfe / Math.max(1, Math.abs(m.oos.mae)), 0, 8)) - maePenalty;
}

function optimize(signals, base, key, seed) {
  const baseTrades = filterTrades(signals, base, key);
  const baseM = metrics(baseTrades), axes = axesFor(key, key === 'ors_prime_reversal' ? base : base), rand = rng(seed);
  const candidates = [], seen = new Set();
  const add = p => {
    const target = p.ors ? p.ors : p;
    const id = JSON.stringify(Object.fromEntries(Object.keys(axes).map(k => [k, target[k]])));
    if (seen.has(id)) return; seen.add(id);
    const trades = filterTrades(signals, p, key);
    if (trades.length < 5) return;
    const m = metrics(trades), sc = score(m, baseM);
    if (Number.isFinite(sc)) candidates.push({ params: p, metrics: m, score: sc });
  };
  add(base);
  for (let i = 0; i < RANDOM_COMBOS; i++) add(randomCandidate(base, axes, rand));
  candidates.sort((a, b) => b.score - a.score);
  return { base: baseM, axes: Object.fromEntries(Object.entries(axes).map(([k, v]) => [k, v.length])), tested: seen.size, candidates: candidates.slice(0, TOP_N) };
}

function foldMetrics(trades) {
  const sorted = dedupe(trades), folds = [];
  for (let f = 0; f < 5; f++) { const lo = Math.floor(sorted.length * f / 5), hi = Math.floor(sorted.length * (f + 1) / 5); folds.push(calc(sorted.slice(lo, hi))); }
  return folds;
}

function capSignals(signals, cap) {
  if (signals.length <= cap) return signals;
  const stride = Math.ceil(signals.length / cap);
  return signals.filter((_, i) => i % stride === 0).slice(0, cap);
}

function fmt(v, d = 1) { return Number(v || 0).toFixed(d); }
function pf(v) { return v === Infinity ? 'Inf' : fmt(v, 2); }

if (!isMainThread) { collectWorker(workerData.files, workerData.config); return; }

if (!fs.existsSync(DATA_DIR)) throw new Error(`Data directory not found: ${DATA_DIR}`);
if (!fs.existsSync(PARAM_INPUT_FILE)) throw new Error(`Param input not found: ${PARAM_INPUT_FILE}`);
if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js'))) throw new Error(`Compiled engine not found: ${path.join(ENGINE_DIR, 'stockEngine.js')}`);

const input = JSON.parse(fs.readFileSync(PARAM_INPUT_FILE, 'utf8'));
const base = Object.fromEntries(PARAM_KEYS.map(k => [k, input[k]]));
const files = fs.readdirSync(DATA_DIR).filter(f => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().includes('_all') && !f.toLowerCase().includes('all_symbols')).map(f => path.join(DATA_DIR, f));
const chunks = Array.from({ length: Math.min(N_WORKERS, files.length) }, () => []);
files.forEach((f, i) => chunks[i % chunks.length].push(f));
const combined = Object.fromEntries(PARAM_KEYS.map(k => [k, []]));
const config = { engineDir: ENGINE_DIR, base, historyWindow: HISTORY_WINDOW, minHistory: MIN_HISTORY, maxHold: MAX_HOLD };
let done = 0, skipped = 0, minDate = '', maxDate = '', lastPrint = 0;
const started = Date.now();

console.log('='.repeat(110));
console.log('DEEP HYPER-TUNE: UPDATED SIX PARAMETER SETS');
console.log('='.repeat(110));
console.log(`Data: ${DATA_DIR}`);
  console.log(`Files: ${files.length}; workers: ${chunks.length}; combos/set: ${RANDOM_COMBOS}; candidate cap/set: ${CANDIDATE_CAP}`);
console.log(`Input: ${PARAM_INPUT_FILE}`);
console.log('Collection: relaxed live-engine breakout candidates plus ORS-specific raw reversal candidates.');
console.log('Simulation: next-open, stop-first, non-overlapping per-symbol trades; chronological 70/30 OOS.');
console.log('');

function progress(force = false) {
  const now = Date.now(); if (!force && now - lastPrint < 1000) return; lastPrint = now;
  const elapsed = (now - started) / 1000, rate = done ? done / elapsed : 0, eta = rate ? (files.length - done) / rate : 0;
  process.stdout.write(`\rCollecting ${done}/${files.length} (${fmt(pct(done, files.length))}%) elapsed ${elapsed.toFixed(0)}s ETA ${eta.toFixed(0)}s   `);
}

Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
  const w = new Worker(__filename, { workerData: { files: chunk, config } });
  let workerDone = 0;
  w.on('message', msg => {
    if (msg.type === 'progress') { done += Math.max(0, msg.processed - workerDone); workerDone = msg.processed; progress(); }
    else if (msg.type === 'done') {
      for (const key of PARAM_KEYS) combined[key].push(...msg.out[key]);
      skipped += msg.meta.skipped || 0;
      if (msg.meta.minDate && (!minDate || msg.meta.minDate < minDate)) minDate = msg.meta.minDate;
      if (msg.meta.maxDate && (!maxDate || msg.meta.maxDate > maxDate)) maxDate = msg.meta.maxDate;
      resolve();
    }
  });
  w.on('error', reject); w.on('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}`)); });
}))).then(() => {
  done = files.length; progress(true); console.log('\nTuning candidates...');
  const tuned = {};
  for (let i = 0; i < PARAM_KEYS.length; i++) {
    const key = PARAM_KEYS[i];
    const rawCount = combined[key].length;
    combined[key] = capSignals(combined[key], CANDIDATE_CAP);
    console.log(`  ${LABELS[key]}: ${rawCount} actionable candidates; scoring ${combined[key].length}`);
    tuned[key] = optimize(combined[key], base[key], key, 1000 + i * 97);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonFile = path.join(__dirname, `${OUT_PREFIX}_${stamp}.json`), txtFile = path.join(__dirname, `${OUT_PREFIX}_${stamp}.txt`);
  const lines = [];
  lines.push('='.repeat(140), 'DEEP HYPER-TUNE RESULTS: UPDATED SIX PARAMETER SETS', '='.repeat(140));
  lines.push(`Data: ${DATA_DIR}`); lines.push(`Files: ${files.length}; skipped: ${skipped}; date: ${minDate} to ${maxDate}`);
  lines.push(`Combos/set: ${RANDOM_COMBOS}; candidate cap/set: ${CANDIDATE_CAP}; candidate collection: relaxed live-engine actionable + ORS raw features`); lines.push('');
  for (const key of PARAM_KEYS) {
    const r = tuned[key]; lines.push('-'.repeat(140)); lines.push(`${LABELS[key]} | raw candidates=${combined[key].length} | tested=${r.tested}`);
    const b = r.base; lines.push(`BASE n=${b.n} WR=${fmt(b.wr)}% Wilson=${fmt(b.wilson)}% Avg=${fmt(b.avg,2)}% PF=${pf(b.pf)} OOSn=${b.oos.n} OOSWR=${fmt(b.oos.wr)}% OOSAvg=${fmt(b.oos.avg,2)}% OOSPF=${pf(b.oos.pf)} Hit5/20=${fmt(b.oos.hit5_20)}% MFE=${fmt(b.oos.mfe)}% MAE=${fmt(b.oos.mae)}%`);
    lines.push('Rank Score n WR Wilson Avg PF OOSn OOSWR OOSAvg OOSPF Hit3/10 Hit5/10 Hit5/20 MFE MAE Params');
    r.candidates.forEach((c, i) => {
      const m = c.metrics, target = c.params.ors || c.params;
      const changes = Object.keys(target).filter(k => target[k] !== (base[key].ors ? base[key].ors[k] : base[key][k])).map(k => `${k}:${base[key].ors ? base[key].ors[k] : base[key][k]}->${target[k]}`).join(';');
      lines.push(`${String(i + 1).padStart(4)} ${fmt(c.score,2).padStart(6)} ${String(m.n).padStart(4)} ${fmt(m.wr).padStart(5)} ${fmt(m.wilson).padStart(6)} ${fmt(m.avg,2).padStart(6)} ${pf(m.pf).padStart(5)} ${String(m.oos.n).padStart(5)} ${fmt(m.oos.wr).padStart(6)} ${fmt(m.oos.avg,2).padStart(7)} ${pf(m.oos.pf).padStart(6)} ${fmt(m.oos.hit3_10).padStart(7)} ${fmt(m.oos.hit5_10).padStart(7)} ${fmt(m.oos.hit5_20).padStart(7)} ${fmt(m.oos.mfe).padStart(6)} ${fmt(m.oos.mae).padStart(6)} ${changes}`);
    });
    lines.push('');
  }
  fs.writeFileSync(jsonFile, JSON.stringify({ meta: { dataDir: DATA_DIR, inputFile: PARAM_INPUT_FILE, files: files.length, skipped, minDate, maxDate, combosPerSet: RANDOM_COMBOS, historyWindow: HISTORY_WINDOW, minHistory: MIN_HISTORY, maxHold: MAX_HOLD, runAt: new Date().toISOString() }, tuned }, null, 2), 'utf8');
  fs.writeFileSync(txtFile, lines.join('\n'), 'utf8'); console.log(lines.join('\n')); console.log(`\nJSON: ${jsonFile}\nTXT : ${txtFile}`);
}).catch(err => { console.error(err && err.stack ? err.stack : err); process.exit(1); });
