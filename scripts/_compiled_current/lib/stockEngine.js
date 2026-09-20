"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// lib/stockEngine.ts
var stockEngine_exports = {};
__export(stockEngine_exports, {
  ARCHETYPE_TUNING: () => ARCHETYPE_TUNING,
  PARAM_SETS: () => PARAM_SETS,
  PARAM_SET_OPTIONS: () => PARAM_SET_OPTIONS,
  analyzeStock: () => analyzeStock,
  analyzeStockMulti: () => analyzeStockMulti,
  analyzeStockWithLookback: () => analyzeStockWithLookback,
  computeClusterBreakdown: () => computeClusterBreakdown,
  computeRSvsNifty: () => computeRSvsNifty,
  computeSelfAdaptiveTrend: () => computeSelfAdaptiveTrend,
  detectCandleDNA: () => detectCandleDNA,
  detectMonster: () => detectMonster,
  generateDemoData: () => generateDemoData,
  getArchetypeExitDefaults: () => getArchetypeExitDefaults,
  setArchetypeTuning: () => setArchetypeTuning
});
module.exports = __toCommonJS(stockEngine_exports);

// lib/candlePatterns.ts
function body(c) {
  return Math.abs(c.c - c.o);
}
function range(c) {
  return c.h - c.l;
}
function upperWick(c) {
  return c.h - Math.max(c.o, c.c);
}
function lowerWick(c) {
  return Math.min(c.o, c.c) - c.l;
}
function isBull(c) {
  return c.c > c.o;
}
function isBear(c) {
  return c.c < c.o;
}
function bodyMid(c) {
  return (c.o + c.c) / 2;
}
function isDoji(c) {
  const r = range(c);
  return r > 0 && body(c) / r < 0.1;
}
function isLargeBody(c) {
  const r = range(c);
  return r > 0 && body(c) / r > 0.6;
}
function gapUp(a, b) {
  return b.o > a.h;
}
function gapDn(a, b) {
  return b.o < a.l;
}
var P = (name, short, type, strength) => ({ name, short, type, strength });
function detectCandlePattern(candles, endIdx) {
  if (endIdx < 2 || endIdx >= candles.length) return P("Unknown", "\u2014", "neutral", 1);
  const c = candles[endIdx];
  const p = candles[endIdx - 1];
  const pp = candles[endIdx - 2];
  const r = range(c);
  if (r < 1e-4) return P("Doji", "DOJI", "neutral", 2);
  const b = body(c);
  const uw = upperWick(c);
  const lw = lowerWick(c);
  const bPct = b / r;
  const uwPct = uw / r;
  const lwPct = lw / r;
  const pB = body(p);
  const pR = range(p);
  const ppB = body(pp);
  const ppR = range(pp);
  if (isBull(pp) && isBull(p) && isBull(c) && p.c > pp.c && c.c > p.c && ppB / ppR > 0.5 && pB / pR > 0.5 && bPct > 0.5 && p.o > pp.o && p.o < pp.c && c.o > p.o && c.o < p.c)
    return P("Three White Soldiers", "3WS", "bullish", 3);
  if (isBear(pp) && isBear(p) && isBear(c) && p.c < pp.c && c.c < p.c && ppB / ppR > 0.5 && pB / pR > 0.5 && bPct > 0.5 && p.o < pp.o && p.o > pp.c && c.o < p.o && c.o > p.c)
    return P("Three Black Crows", "3BC", "bearish", 3);
  if (isBear(pp) && isLargeBody(pp) && body(p) < ppB * 0.35 && p.o < pp.c && isBull(c) && b > ppB * 0.5 && c.c > bodyMid(pp))
    return P("Morning Star", "MRST", "bullish", 3);
  if (isBull(pp) && isLargeBody(pp) && body(p) < ppB * 0.35 && p.o > pp.c && isBear(c) && b > ppB * 0.5 && c.c < bodyMid(pp))
    return P("Evening Star", "EVST", "bearish", 3);
  if (isBear(pp) && isDoji(p) && p.h < pp.l && isBull(c) && c.l > p.h)
    return P("Abandoned Baby \u2191", "AB-U", "bullish", 3);
  if (isBull(pp) && isDoji(p) && p.l > pp.h && isBear(c) && c.h < p.l)
    return P("Abandoned Baby \u2193", "AB-D", "bearish", 3);
  if (isBear(pp) && isLargeBody(pp) && isBull(p) && p.o > pp.c && p.c < pp.o && isBull(c) && c.c > pp.o)
    return P("Three Inside Up", "3IU", "bullish", 3);
  if (isBull(pp) && isLargeBody(pp) && isBear(p) && p.o < pp.c && p.c > pp.o && isBear(c) && c.c < pp.o)
    return P("Three Inside Down", "3ID", "bearish", 3);
  if (endIdx >= 3) {
    const ppp = candles[endIdx - 3];
    if (isBull(ppp) && isBull(pp) && isBull(p) && pp.c > ppp.c && p.c > pp.c && isBear(c) && c.o >= p.c && c.c <= ppp.o)
      return P("3-Line Strike \u2191", "3LS", "bullish", 3);
    if (isBear(ppp) && isBear(pp) && isBear(p) && pp.c < ppp.c && p.c < pp.c && isBull(c) && c.o <= p.c && c.c >= ppp.o)
      return P("3-Line Strike \u2193", "3LD", "bearish", 3);
  }
  if (endIdx >= 4) {
    const p3 = candles[endIdx - 3];
    const p4 = candles[endIdx - 4];
    const p4B = body(p4);
    if (isBull(p4) && isLargeBody(p4) && body(p3) < p4B * 0.5 && body(pp) < p4B * 0.5 && body(p) < p4B * 0.5 && isBull(c) && c.c > p4.h)
      return P("Rising 3 Methods", "R3M", "bullish", 3);
    if (isBear(p4) && isLargeBody(p4) && body(p3) < p4B * 0.5 && body(pp) < p4B * 0.5 && body(p) < p4B * 0.5 && isBear(c) && c.c < p4.l)
      return P("Falling 3 Methods", "F3M", "bearish", 3);
  }
  if (isDoji(pp) && isDoji(p) && isDoji(c) && p.h < pp.l && c.l > p.h)
    return P("Tri-Star \u2191", "TS-U", "bullish", 3);
  if (isDoji(pp) && isDoji(p) && isDoji(c) && p.l > pp.h && c.h < p.l)
    return P("Tri-Star \u2193", "TS-D", "bearish", 3);
  if (isBull(pp) && isBull(p) && isBull(c) && isLargeBody(pp) && isLargeBody(p) && bPct < 0.3 && c.o >= p.c * 0.99)
    return P("Deliberation", "DLBR", "bearish", 2);
  if (isBull(pp) && isBull(p) && isBull(c) && pB < ppB && b < pB && upperWick(p) > upperWick(pp) && uw > upperWick(p))
    return P("Advance Block", "ADVB", "bearish", 2);
  if (isBear(pp) && isBear(p) && isBear(c) && Math.abs(p.o - pp.c) < ppR * 0.05 && Math.abs(c.o - p.c) < pR * 0.05)
    return P("Identical 3 Crows", "I3C", "bearish", 3);
  if (endIdx >= 4) {
    const p3 = candles[endIdx - 3];
    const p4 = candles[endIdx - 4];
    if (isBull(p4) && isLargeBody(p4) && !isBull(p3) && !isBull(pp) && body(p3) < body(p4) * 0.4 && body(pp) < body(p4) * 0.4 && isBull(c) && c.c > p4.h)
      return P("Mat Hold", "MATH", "bullish", 3);
  }
  if (isBull(pp) && isBull(p) && gapUp(pp, p) && isBear(c) && c.o > p.o && c.o < p.c && c.c < p.o && c.c > pp.c)
    return P("Tasuki Gap \u2191", "TG-U", "bullish", 2);
  if (isBear(pp) && isBear(p) && gapDn(pp, p) && isBull(c) && c.o < p.o && c.o > p.c && c.c > p.o && c.c < pp.c)
    return P("Tasuki Gap \u2193", "TG-D", "bearish", 2);
  if (isBear(pp) && ppR > 0 && ppB / ppR > 0.85 && isBear(p) && pR > 0 && pB / pR > 0.85 && isBear(c) && c.h > p.h)
    return P("Conceal Baby Swal", "CBS", "bullish", 3);
  if (isBear(pp) && isLargeBody(pp) && isBear(p) && p.l < pp.l && p.c > pp.c && isBull(c) && body(c) < body(p) * 0.5)
    return P("Unique 3 River", "U3R", "bullish", 2);
  if (isBull(pp) && isLargeBody(pp) && isBear(p) && gapUp(pp, p) && isBear(c) && c.o > p.o && c.c < pp.c)
    return P("Two Crows", "2CRW", "bearish", 2);
  if (isBear(p) && isBull(c) && c.o < p.c && c.c > p.o && b > pB * 1.1)
    return P("Bullish Engulfing", "B-EN", "bullish", 3);
  if (isBull(p) && isBear(c) && c.o > p.c && c.c < p.o && b > pB * 1.1)
    return P("Bearish Engulfing", "R-EN", "bearish", 3);
  if (isBear(p) && pB / pR > 0.85 && isBull(c) && bPct > 0.85 && c.o > p.o)
    return P("Bullish Kicking", "B-KK", "bullish", 3);
  if (isBull(p) && pB / pR > 0.85 && isBear(c) && bPct > 0.85 && c.o < p.o)
    return P("Bearish Kicking", "R-KK", "bearish", 3);
  if (isBear(p) && isLargeBody(p) && isBull(c) && c.o < p.l && c.c > bodyMid(p) && c.c < p.o)
    return P("Piercing Line", "PIRC", "bullish", 2);
  if (isBull(p) && isLargeBody(p) && isBear(c) && c.o > p.h && c.c < bodyMid(p) && c.c > p.o)
    return P("Dark Cloud Cover", "DKCC", "bearish", 2);
  if (isBear(p) && isLargeBody(p) && isBull(c) && c.o > p.c && c.c < p.o && b < pB * 0.5)
    return P("Bullish Harami", "B-HR", "bullish", 2);
  if (isBull(p) && isLargeBody(p) && isBear(c) && c.o < p.c && c.c > p.o && b < pB * 0.5)
    return P("Bearish Harami", "R-HR", "bearish", 2);
  if (isBear(p) && isBull(c) && Math.abs(c.l - p.l) < Math.min(r, pR) * 0.03)
    return P("Tweezer Bottom", "TWBT", "bullish", 2);
  if (isBull(p) && isBear(c) && Math.abs(c.h - p.h) < Math.min(r, pR) * 0.03)
    return P("Tweezer Top", "TWTP", "bearish", 2);
  if (isBear(p) && isLargeBody(p) && isBull(c) && isLargeBody(c) && Math.abs(c.c - p.c) < r * 0.05)
    return P("Bull Counterattack", "B-CA", "bullish", 2);
  if (isBull(p) && isLargeBody(p) && isBear(c) && isLargeBody(c) && Math.abs(c.c - p.c) < r * 0.05)
    return P("Bear Counterattack", "R-CA", "bearish", 2);
  if (isBear(p) && isLargeBody(p) && isBull(c) && c.o < p.l && Math.abs(c.c - p.l) < pR * 0.05)
    return P("In-Neck Line", "INNK", "bearish", 1);
  if (isBear(p) && isLargeBody(p) && isBull(c) && c.o < p.l && Math.abs(c.c - p.l) < pR * 0.1 && c.c < p.c)
    return P("On-Neck Line", "ONNK", "bearish", 1);
  if (isBear(p) && isLargeBody(p) && isBull(c) && c.o < p.l && c.c > p.c && c.c < bodyMid(p))
    return P("Thrusting Line", "THRS", "bearish", 1);
  if (isBear(p) && isBull(c) && Math.abs(c.o - p.o) < pR * 0.03 && isLargeBody(c))
    return P("Separating Lines \u2191", "SP-U", "bullish", 2);
  if (isBull(p) && isBear(c) && Math.abs(c.o - p.o) < pR * 0.03 && isLargeBody(c))
    return P("Separating Lines \u2193", "SP-D", "bearish", 2);
  if (isBear(p) && isLargeBody(p) && isBull(c) && isLargeBody(c) && Math.abs(c.c - p.c) < pR * 0.03)
    return P("Meeting Lines \u2191", "MT-U", "bullish", 2);
  if (isBull(p) && isLargeBody(p) && isBear(c) && isLargeBody(c) && Math.abs(c.c - p.c) < pR * 0.03)
    return P("Meeting Lines \u2193", "MT-D", "bearish", 2);
  if (isBear(p) && isBear(c) && Math.abs(c.c - p.c) < pR * 0.03)
    return P("Matching Low", "MTLO", "bullish", 2);
  if (isBear(p) && isLargeBody(p) && isBear(c) && c.o < p.o && c.c > p.c && b < pB * 0.5)
    return P("Homing Pigeon", "HMPG", "bullish", 2);
  if (bPct < 0.1) {
    if (lwPct > 0.6 && uwPct < 0.1) return P("Dragonfly Doji", "DGDF", "bullish", 2);
    if (uwPct > 0.6 && lwPct < 0.1) return P("Gravestone Doji", "GRVD", "bearish", 2);
    if (uwPct > 0.35 && lwPct > 0.35) return P("Rickshaw Man", "RKMN", "neutral", 2);
    if (uwPct > 0.3 && lwPct > 0.3) return P("Long-Legged Doji", "LLDO", "neutral", 2);
    return P("Doji", "DOJI", "neutral", 2);
  }
  if (bPct > 0.9) {
    if (isBull(c)) return P("Bullish Marubozu", "B-MZ", "bullish", 3);
    return P("Bearish Marubozu", "R-MZ", "bearish", 3);
  }
  if (isBull(c) && lwPct < 0.02 && bPct > 0.7)
    return P("Opening Marubozu \u2191", "OMZ", "bullish", 2);
  if (isBear(c) && uwPct < 0.02 && bPct > 0.7)
    return P("Opening Marubozu \u2193", "OMD", "bearish", 2);
  if (isBull(c) && uwPct < 0.02 && bPct > 0.7)
    return P("Closing Marubozu \u2191", "CMU", "bullish", 2);
  if (isBear(c) && lwPct < 0.02 && bPct > 0.7)
    return P("Closing Marubozu \u2193", "CMD", "bearish", 2);
  if (isBull(c) && lwPct < 0.03 && bPct > 0.6 && c.o === c.l)
    return P("Belt Hold \u2191", "BH-U", "bullish", 2);
  if (isBear(c) && uwPct < 0.03 && bPct > 0.6 && c.o === c.h)
    return P("Belt Hold \u2193", "BH-D", "bearish", 2);
  if (lwPct > 0.6 && uwPct < 0.1 && bPct < 0.35) {
    if (isBull(c)) return P("Hammer", "HAMR", "bullish", 2);
    return P("Hanging Man", "HNGM", "bearish", 2);
  }
  if (uwPct > 0.6 && lwPct < 0.1 && bPct < 0.35) {
    if (isBull(c)) return P("Inverted Hammer", "IHMR", "bullish", 2);
    return P("Shooting Star", "SHST", "bearish", 2);
  }
  if (bPct < 0.2 && uwPct > 0.35 && lwPct > 0.35)
    return P("High Wave", "HIWA", "neutral", 2);
  if (bPct < 0.3 && uwPct > 0.25 && lwPct > 0.25)
    return P("Spinning Top", "SPIN", "neutral", 1);
  if (uwPct < 0.02 && bPct > 0.4 && isBear(c))
    return P("Shaven Head", "SHVH", "bearish", 1);
  if (lwPct < 0.02 && bPct > 0.4 && isBull(c))
    return P("Shaven Bottom", "SHVB", "bullish", 1);
  if (isBull(c)) {
    if (bPct > 0.65 && lwPct < 0.15) return P("Strong Bullish", "B-ST", "bullish", 2);
    if (bPct > 0.45) return P("Bullish", "BULL", "bullish", 1);
    return P("Weak Bullish", "B-WK", "bullish", 1);
  } else {
    if (bPct > 0.65 && uwPct < 0.15) return P("Strong Bearish", "R-ST", "bearish", 2);
    if (bPct > 0.45) return P("Bearish", "BEAR", "bearish", 1);
    return P("Weak Bearish", "R-WK", "bearish", 1);
  }
}

// lib/statsEngine.ts
function mean(arr) {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}
function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let s = 0;
  for (const v of arr) s += (v - m) ** 2;
  return Math.sqrt(s / (arr.length - 1));
}
function pctRank(window, value) {
  if (window.length === 0) return 50;
  return window.filter((v) => v <= value).length / window.length * 100;
}
function linRegSlope(values) {
  const n = values.length;
  if (n < 3) return 0;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += values[i];
    sxy += i * values[i];
    sx2 += i * i;
  }
  const d = n * sx2 - sx * sx;
  return Math.abs(d) < 1e-10 ? 0 : (n * sxy - sx * sy) / d;
}
function safe(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}
function computeVolZScore(candles, endIdx) {
  const start = Math.max(0, endIdx - 20);
  const vols = [];
  for (let i = start; i < endIdx; i++) vols.push(candles[i].v);
  const sigVol = candles[endIdx]?.v ?? 0;
  const m = mean(vols);
  const sd = stdDev(vols);
  const z = sd > 0 ? (sigVol - m) / sd : 0;
  return { z: safe(z), sig: z >= 2 };
}
function computeBBSqueeze(candles, endIdx) {
  const period = 20;
  if (endIdx < period) return { width: 0, pctl: 50, squeeze: false };
  const closes = [];
  for (let i = endIdx - period + 1; i <= endIdx; i++) closes.push(candles[i].c);
  const sma = mean(closes);
  const sd = stdDev(closes);
  const upper = sma + 2 * sd;
  const lower = sma - 2 * sd;
  const width = sma > 0 ? (upper - lower) / sma : 0;
  const widthHistory = [];
  const histStart = Math.max(period, endIdx - 120);
  for (let e = histStart; e < endIdx; e++) {
    const cl = [];
    for (let i = e - period + 1; i <= e; i++) cl.push(candles[i].c);
    const s = mean(cl);
    const d = stdDev(cl);
    if (s > 0) widthHistory.push((s + 2 * d - (s - 2 * d)) / s);
  }
  const pctl = pctRank(widthHistory, width);
  return { width: safe(width), pctl: safe(pctl), squeeze: pctl <= 10 };
}
function computeKeltnerSqueeze(candles, endIdx) {
  const period = 20;
  if (endIdx < period + 14) return false;
  const closes = [];
  for (let i = endIdx - period + 1; i <= endIdx; i++) closes.push(candles[i].c);
  const sma = mean(closes);
  const sd = stdDev(closes);
  const bbUpper = sma + 2 * sd;
  const bbLower = sma - 2 * sd;
  let ema = candles[0].c;
  const k = 2 / 21;
  for (let i = 1; i <= endIdx; i++) ema = candles[i].c * k + ema * (1 - k);
  let atr = 0;
  for (let i = endIdx - 9; i <= endIdx; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    );
    atr += tr;
  }
  atr /= 10;
  const kUpper = ema + 1.5 * atr;
  const kLower = ema - 1.5 * atr;
  return bbLower > kLower && bbUpper < kUpper;
}
function computeLRSlope(candles, endIdx) {
  const start = Math.max(0, endIdx - 10);
  const closes = [];
  for (let i = start; i < endIdx; i++) closes.push(candles[i].c);
  if (closes.length < 5) return { slope: 0, flat: true };
  const rawSlope = linRegSlope(closes);
  const avgClose = mean(closes);
  const normalizedSlope = avgClose > 0 ? rawSlope / avgClose * 100 : 0;
  return { slope: safe(normalizedSlope), flat: Math.abs(normalizedSlope) < 0.15 };
}
function computeAutoCorr(candles, endIdx) {
  const returns = [];
  const start = Math.max(1, endIdx - 30);
  for (let i = start; i <= endIdx; i++) {
    if (candles[i - 1].c > 0) returns.push((candles[i].c - candles[i - 1].c) / candles[i - 1].c);
  }
  if (returns.length < 10) return { corr: 0, momentum: false };
  const r1 = returns.slice(0, -1);
  const r2 = returns.slice(1);
  const m1 = mean(r1), m2 = mean(r2);
  let num = 0, d1 = 0, d2 = 0;
  for (let i = 0; i < r1.length; i++) {
    num += (r1[i] - m1) * (r2[i] - m2);
    d1 += (r1[i] - m1) ** 2;
    d2 += (r2[i] - m2) ** 2;
  }
  const denom = Math.sqrt(d1 * d2);
  const corr = denom > 0 ? num / denom : 0;
  return { corr: safe(corr), momentum: corr > 0.1 };
}
function computeHurst(candles, endIdx) {
  const start = Math.max(1, endIdx - 100);
  const returns = [];
  for (let i = start; i <= endIdx; i++) {
    if (candles[i - 1].c > 0) returns.push(Math.log(candles[i].c / candles[i - 1].c));
  }
  if (returns.length < 20) return { h: 0.5, trending: false };
  const sizes = [10, 15, 20, 30, 50].filter((s) => s <= returns.length);
  if (sizes.length < 2) return { h: 0.5, trending: false };
  const logRS = [];
  const logN = [];
  for (const n of sizes) {
    const chunks = Math.floor(returns.length / n);
    if (chunks === 0) continue;
    let rsSum = 0, validChunks = 0;
    for (let c = 0; c < chunks; c++) {
      const chunk = returns.slice(c * n, (c + 1) * n);
      const m = mean(chunk);
      const sd = stdDev(chunk);
      if (sd < 1e-10) continue;
      let cumSum = 0, maxCum = -Infinity, minCum = Infinity;
      for (const r of chunk) {
        cumSum += r - m;
        if (cumSum > maxCum) maxCum = cumSum;
        if (cumSum < minCum) minCum = cumSum;
      }
      rsSum += (maxCum - minCum) / sd;
      validChunks++;
    }
    const avgRS = validChunks > 0 ? rsSum / validChunks : 0;
    if (chunks > 0 && avgRS > 0) {
      logRS.push(Math.log(avgRS));
      logN.push(Math.log(n));
    }
  }
  if (logRS.length < 2) return { h: 0.5, trending: false };
  const meanX = logN.reduce((a, b) => a + b, 0) / logN.length;
  const meanY = logRS.reduce((a, b) => a + b, 0) / logRS.length;
  let num = 0, den = 0;
  for (let i = 0; i < logN.length; i++) {
    num += (logN[i] - meanX) * (logRS[i] - meanY);
    den += (logN[i] - meanX) ** 2;
  }
  const h = den > 0 ? num / den : 0.5;
  const hClamped = Math.max(0, Math.min(1, safe(h, 0.5)));
  return { h: hClamped, trending: hClamped > 0.55 };
}
function computeSkewness(candles, endIdx) {
  const start = Math.max(1, endIdx - 20);
  const returns = [];
  for (let i = start; i <= endIdx; i++) {
    if (candles[i - 1].c > 0) returns.push((candles[i].c - candles[i - 1].c) / candles[i - 1].c * 100);
  }
  if (returns.length < 5) return { skew: 0, positive: false };
  const m = mean(returns);
  const sd = stdDev(returns);
  if (sd < 1e-10) return { skew: 0, positive: false };
  let s3 = 0;
  for (const r of returns) s3 += ((r - m) / sd) ** 3;
  const skew = s3 / returns.length;
  return { skew: safe(skew), positive: skew > 0.2 };
}
function compute52W(candles, endIdx) {
  const start = Math.max(0, endIdx - 252);
  let high52 = -Infinity, low52 = Infinity;
  for (let i = start; i <= endIdx; i++) {
    if (candles[i].h > high52) high52 = candles[i].h;
    if (candles[i].l < low52) low52 = candles[i].l;
  }
  const close = candles[endIdx]?.c ?? 0;
  const dd = high52 > 0 ? (high52 - close) / high52 * 100 : 0;
  const pctLow = low52 > 0 ? (close - low52) / low52 * 100 : 0;
  return { ddFromHigh: safe(dd), pctFromLow: safe(pctLow) };
}
function computeSharpe20(candles, endIdx) {
  const start = Math.max(1, endIdx - 20);
  const returns = [];
  for (let i = start; i <= endIdx; i++) {
    if (candles[i - 1].c > 0) returns.push((candles[i].c - candles[i - 1].c) / candles[i - 1].c);
  }
  if (returns.length < 5) return 0;
  const m = mean(returns);
  const sd = stdDev(returns);
  return sd > 1e-10 ? safe(m / sd * Math.sqrt(252)) : 0;
}
function computeEntropy10(candles, endIdx) {
  const start = Math.max(0, endIdx - 9);
  const closes = [];
  for (let i = start; i <= endIdx; i++) closes.push(candles[i].c);
  if (closes.length < 5) return 0;
  const min = Math.min(...closes), max = Math.max(...closes);
  const range2 = max - min;
  if (range2 < 1e-3) return 0;
  const bins = 5;
  const counts = new Array(bins).fill(0);
  for (const c of closes) {
    const bin = Math.min(Math.floor((c - min) / range2 * bins), bins - 1);
    counts[bin]++;
  }
  let entropy = 0;
  for (const cnt of counts) {
    if (cnt > 0) {
      const p = cnt / closes.length;
      entropy -= p * Math.log2(p);
    }
  }
  return safe(entropy);
}
function computeCUSUM(candles, endIdx) {
  const start = Math.max(1, endIdx - 50);
  const returns = [];
  for (let i = start; i <= endIdx; i++) {
    if (candles[i - 1].c > 0) returns.push((candles[i].c - candles[i - 1].c) / candles[i - 1].c);
  }
  if (returns.length < 20) return false;
  const m = mean(returns.slice(0, Math.floor(returns.length / 2)));
  const sd = stdDev(returns.slice(0, Math.floor(returns.length / 2)));
  if (sd < 1e-10) return false;
  const threshold = 4;
  let sPlus = 0, sMinus = 0;
  for (let i = Math.floor(returns.length / 2); i < returns.length; i++) {
    const z = (returns[i] - m) / sd;
    sPlus = Math.max(0, sPlus + z - 0.5);
    sMinus = Math.max(0, sMinus - z - 0.5);
    if (sPlus > threshold || sMinus > threshold) return true;
  }
  return false;
}
function computeInsideBars(candles, endIdx) {
  let count = 0;
  for (let i = endIdx - 1; i > Math.max(0, endIdx - 10); i--) {
    if (i < 1) break;
    const inside = candles[i].h <= candles[i - 1].h && candles[i].l >= candles[i - 1].l;
    if (inside) count++;
    else break;
  }
  return count;
}
function computeVolProfileSkew(candles, endIdx) {
  const start = Math.max(0, endIdx - 10);
  let accumVol = 0, distribVol = 0;
  for (let i = start; i <= endIdx; i++) {
    const range2 = candles[i].h - candles[i].l;
    if (range2 <= 0) continue;
    const closePosition = (candles[i].c - candles[i].l) / range2;
    accumVol += candles[i].v * closePosition;
    distribVol += candles[i].v * (1 - closePosition);
  }
  const total = accumVol + distribVol;
  return total > 0 ? safe((accumVol - distribVol) / total) : 0;
}
function computeGARCH(candles, endIdx) {
  const start = Math.max(1, endIdx - 30);
  const returns = [];
  for (let i = start; i <= endIdx; i++) {
    if (candles[i - 1].c > 0) returns.push(Math.log(candles[i].c / candles[i - 1].c));
  }
  if (returns.length < 15) return 1;
  const omega = 1e-5, alpha = 0.1, beta = 0.85;
  let sigma2 = 0;
  for (const r of returns.slice(0, 10)) sigma2 += r * r;
  sigma2 /= 10;
  for (let i = 10; i < returns.length; i++) {
    sigma2 = omega + alpha * returns[i] * returns[i] + beta * sigma2;
    if (sigma2 < 1e-10) sigma2 = 1e-10;
  }
  const lastReturn = returns[returns.length - 1];
  const forecastSigma2 = omega + alpha * lastReturn * lastReturn + beta * sigma2;
  const recent = returns.slice(-5);
  let realizedVar = 0;
  for (const r of recent) realizedVar += r * r;
  realizedVar /= recent.length;
  return realizedVar > 0 ? safe(Math.sqrt(forecastSigma2 / realizedVar)) : 1;
}
function computeTTMSqueeze(candles, endIdx) {
  const bbPeriod = 20, bbMult = 2;
  const kcPeriod = 20, kcMult = 1.5;
  if (endIdx < Math.max(bbPeriod, kcPeriod) + 14) {
    return { squeezeOn: false, squeezeFired: false, momentum: 0, momentumRising: false };
  }
  const bbCloses = [];
  for (let i = endIdx - bbPeriod + 1; i <= endIdx; i++) bbCloses.push(candles[i].c);
  const bbSMA = mean(bbCloses);
  const bbSD = stdDev(bbCloses);
  const bbUpper = bbSMA + bbMult * bbSD;
  const bbLower = bbSMA - bbMult * bbSD;
  let ema = candles[0].c;
  const k = 2 / (kcPeriod + 1);
  for (let i = 1; i <= endIdx; i++) ema = candles[i].c * k + ema * (1 - k);
  let atr = 0;
  const atrPeriod = 10;
  let atrCount = 0;
  for (let i = endIdx - atrPeriod + 1; i <= endIdx; i++) {
    if (i < 1) continue;
    atr += Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    );
    atrCount++;
  }
  atr = atrCount > 0 ? atr / atrCount : atr / atrPeriod;
  const kcUpper = ema + kcMult * atr;
  const kcLower = ema - kcMult * atr;
  const squeezeOn = bbLower > kcLower && bbUpper < kcUpper;
  let prevSqueezeOn = false;
  if (endIdx > bbPeriod + 1) {
    const prevBBCloses = [];
    for (let i = endIdx - bbPeriod; i < endIdx; i++) prevBBCloses.push(candles[i].c);
    const prevSMA = mean(prevBBCloses);
    const prevSD = stdDev(prevBBCloses);
    const prevBBU = prevSMA + bbMult * prevSD;
    const prevBBL = prevSMA - bbMult * prevSD;
    let prevEma = candles[0].c;
    for (let i = 1; i < endIdx; i++) prevEma = candles[i].c * k + prevEma * (1 - k);
    let prevAtr = 0, prevAtrCount = 0;
    for (let i = endIdx - atrPeriod; i < endIdx; i++) {
      if (i < 1) continue;
      prevAtr += Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c));
      prevAtrCount++;
    }
    prevAtr = prevAtrCount > 0 ? prevAtr / prevAtrCount : prevAtr / atrPeriod;
    const prevKCU = prevEma + kcMult * prevAtr;
    const prevKCL = prevEma - kcMult * prevAtr;
    prevSqueezeOn = prevBBL > prevKCL && prevBBU < prevKCU;
  }
  const squeezeFired = prevSqueezeOn && !squeezeOn;
  const momValues = [];
  for (let bar = endIdx - bbPeriod + 1; bar <= endIdx; bar++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = bar - bbPeriod + 1; j <= bar; j++) {
      if (j >= 0) {
        if (candles[j].h > hh) hh = candles[j].h;
        if (candles[j].l < ll) ll = candles[j].l;
      }
    }
    const donchianMid = (hh + ll) / 2;
    let smaSum = 0, smaCount = 0;
    for (let j = bar - bbPeriod + 1; j <= bar; j++) {
      if (j >= 0) {
        smaSum += candles[j].c;
        smaCount++;
      }
    }
    const smaMid = smaCount > 0 ? smaSum / smaCount : candles[bar].c;
    const refLine = (donchianMid + smaMid) / 2;
    momValues.push(candles[bar].c - refLine);
  }
  const n = momValues.length;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += momValues[i];
    sxy += i * momValues[i];
    sx2 += i * i;
  }
  const regDenom = n * sx2 - sx * sx;
  const slope = regDenom !== 0 ? (n * sxy - sx * sy) / regDenom : 0;
  const intercept = (sy - slope * sx) / n;
  const momentum = intercept + slope * (n - 1);
  const prevMomentum = n > 1 ? intercept + slope * (n - 2) : 0;
  const momentumRising = momentum > prevMomentum;
  return {
    squeezeOn,
    squeezeFired,
    momentum: safe(momentum),
    momentumRising
  };
}
function computeRSI14(candles, endIdx) {
  const period = 14;
  const needed = period + 20;
  if (endIdx < needed) return 50;
  const start = endIdx - needed;
  let gains = 0, losses = 0;
  for (let i = start + 1; i <= start + period; i++) {
    const diff = candles[i].c - candles[i - 1].c;
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = start + period + 1; i <= endIdx; i++) {
    const diff = candles[i].c - candles[i - 1].c;
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }
  if (avgLoss < 1e-10) return avgGain < 1e-10 ? 50 : 100;
  return safe(100 - 100 / (1 + avgGain / avgLoss));
}
function computeCCI34(candles, endIdx) {
  const period = 34;
  if (endIdx < period) return 0;
  const tps = [];
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    tps.push((candles[i].h + candles[i].l + candles[i].c) / 3);
  }
  const smaTP = mean(tps);
  let mdSum = 0;
  for (const tp of tps) mdSum += Math.abs(tp - smaTP);
  const md = mdSum / period;
  if (md < 1e-10) return 0;
  const cci = (tps[tps.length - 1] - smaTP) / (0.015 * md);
  return safe(cci);
}
function computeEMALevel(candles, endIdx, period) {
  if (endIdx < period) return candles[endIdx]?.c ?? 0;
  const k = 2 / (period + 1);
  let ema = candles[0].c;
  for (let i = 1; i <= endIdx; i++) ema = candles[i].c * k + ema * (1 - k);
  return safe(ema);
}
function computeSMALevel(candles, endIdx, period) {
  if (endIdx < period - 1) return candles[endIdx]?.c ?? 0;
  let sum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) sum += candles[i].c;
  return safe(sum / period);
}
var SHORT_PERIODS = [3, 5, 8, 10, 12, 15];
var LONG_PERIODS = [30, 35, 40, 45, 50, 60];
function computeGuppySpread(candles, endIdx) {
  if (endIdx < 60) {
    return { spreadPct: 99, compressed: false, ultraCompressed: false, compressDays: 0, cleanBullishFan: false, groupGapPct: 0, coiledRelease: false, springAlert: false, primedAlert: false };
  }
  function buildGuppyEMAArr(period) {
    const k = 2 / (period + 1);
    const out = new Array(endIdx + 1).fill(0);
    out[0] = candles[0].c;
    for (let i = 1; i <= endIdx; i++) out[i] = candles[i].c * k + out[i - 1] * (1 - k);
    return out;
  }
  const shortEMAArrs = SHORT_PERIODS.map((p) => buildGuppyEMAArr(p));
  const longEMAArrs = LONG_PERIODS.map((p) => buildGuppyEMAArr(p));
  function spreadAt(idx) {
    const shortVals = shortEMAArrs.map((arr) => arr[idx]);
    const longVals = longEMAArrs.map((arr) => arr[idx]);
    const allVals = [...shortVals, ...longVals];
    const cmp = candles[idx]?.c ?? 0;
    const spreadPct = cmp > 0 ? (Math.max(...allVals) - Math.min(...allVals)) / cmp * 100 : 99;
    return { spreadPct, shortVals, longVals };
  }
  const now = spreadAt(endIdx);
  const minShort = Math.min(...now.shortVals), maxShort = Math.max(...now.shortVals);
  const minLong = Math.min(...now.longVals), maxLong = Math.max(...now.longVals);
  const avgShort = now.shortVals.reduce((a, b) => a + b, 0) / now.shortVals.length;
  const avgLong = now.longVals.reduce((a, b) => a + b, 0) / now.longVals.length;
  const groupGapPct = avgLong > 0 ? (avgShort - avgLong) / avgLong * 100 : 0;
  const cleanBullishFan = minShort > maxLong;
  let compressDays = 0;
  for (let j = Math.max(0, endIdx - 10); j < endIdx; j++) {
    if (spreadAt(j).spreadPct < 2) compressDays++;
  }
  const coiledRelease = compressDays >= 8 && now.spreadPct <= 5 && cleanBullishFan && groupGapPct >= 1;
  function checkSpringAt(idx) {
    if (idx < 3) return false;
    const s = spreadAt(idx);
    if (s.spreadPct >= 7) return false;
    const minS = Math.min(...s.shortVals), maxL = Math.max(...s.longVals);
    if (minS <= maxL) return false;
    const sPrev = spreadAt(idx - 1);
    const sPrev2 = spreadAt(idx - 2);
    const accel = sPrev.spreadPct > 0 ? (s.spreadPct - sPrev.spreadPct) / sPrev.spreadPct * 100 : 0;
    if (accel < -20 || accel > -5) return false;
    let volSum = 0, volCnt = 0;
    for (let i = Math.max(0, idx - 20); i < idx; i++) {
      volSum += candles[i].v;
      volCnt++;
    }
    const vol20 = volCnt > 0 ? volSum / volCnt : 0;
    if (!(vol20 > 0 && candles[idx].v < vol20)) return false;
    if (!(s.spreadPct < sPrev.spreadPct && sPrev.spreadPct < sPrev2.spreadPct)) return false;
    const rsiStart = Math.max(0, idx - 30);
    let ag2 = 0, al2 = 0;
    for (let i = rsiStart + 1; i <= rsiStart + 2 && i <= idx; i++) {
      const d = candles[i].c - candles[i - 1].c;
      if (d > 0) ag2 += d;
      else al2 -= d;
    }
    ag2 /= 2;
    al2 /= 2;
    for (let i = rsiStart + 3; i <= idx; i++) {
      const d = candles[i].c - candles[i - 1].c;
      ag2 = (ag2 + (d > 0 ? d : 0)) / 2;
      al2 = (al2 + (d < 0 ? -d : 0)) / 2;
    }
    const rsi2 = al2 < 1e-10 ? ag2 < 1e-10 ? 50 : 100 : 100 - 100 / (1 + ag2 / al2);
    if (rsi2 < 40 || rsi2 > 80) return false;
    let trSum = 0;
    const atrStart = Math.max(1, idx - 13);
    for (let i = atrStart; i <= idx; i++) {
      const tr = Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c));
      trSum += tr;
    }
    const atr14 = idx >= 14 ? trSum / Math.min(14, idx - atrStart + 1) : 0;
    return atr14 > 0 && (candles[idx].h - candles[idx].l) / atr14 < 1;
  }
  const springAlert = checkSpringAt(endIdx);
  const primedAlert = coiledRelease && checkSpringAt(endIdx - 1);
  return {
    spreadPct: safe(now.spreadPct),
    compressed: now.spreadPct < 1,
    ultraCompressed: now.spreadPct < 0.5,
    compressDays,
    cleanBullishFan,
    groupGapPct: safe(groupGapPct),
    coiledRelease,
    springAlert,
    primedAlert
  };
}
function computeStatsFeatures(candles, endIdx) {
  if (endIdx < 0 || endIdx >= candles.length || candles.length < 35) {
    const c = candles.length > 0 ? candles[Math.min(Math.max(0, endIdx), candles.length - 1)].c : 0;
    return { volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false, lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false, skewness20: 0, positiveSkew: false, drawdownFrom52WH: 0, pctFrom52WL: 0, sharpe20: 0, entropy10: 0, cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1, ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false, rsi14: 50, cci34: 0, ema10: c, ema21: c, ema55: c, sma200: c, ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false, guppySpreadPct: 99, guppyCompressed: false, guppyUltraCompressed: false, guppyCompressDays: 0, guppyCleanBullishFan: false, guppyGroupGapPct: 0, guppyCoiledRelease: false, guppySpring: false, guppyPrimed: false, candlePattern: "\u2014", candlePatternFull: "Unknown", candlePatternType: "neutral", candlePatternStrength: 0, statsScore: 0 };
  }
  const volZ = computeVolZScore(candles, endIdx);
  const bb = computeBBSqueeze(candles, endIdx);
  const kSqueeze = computeKeltnerSqueeze(candles, endIdx);
  const lr = computeLRSlope(candles, endIdx);
  const ac = computeAutoCorr(candles, endIdx);
  const hurst = computeHurst(candles, endIdx);
  const skew = computeSkewness(candles, endIdx);
  const ttm = computeTTMSqueeze(candles, endIdx);
  const rsi14val = computeRSI14(candles, endIdx);
  const cci34val = computeCCI34(candles, endIdx);
  const guppy = computeGuppySpread(candles, endIdx);
  const candlePat = detectCandlePattern(candles, endIdx);
  const ema10 = computeEMALevel(candles, endIdx, 10);
  const ema21 = computeEMALevel(candles, endIdx, 21);
  const ema55 = computeEMALevel(candles, endIdx, 55);
  const sma200 = computeSMALevel(candles, endIdx, 200);
  const w52 = compute52W(candles, endIdx);
  const sharpe = computeSharpe20(candles, endIdx);
  const entropy = computeEntropy10(candles, endIdx);
  const cusum = computeCUSUM(candles, endIdx);
  const insideBars = computeInsideBars(candles, endIdx);
  const volSkew = computeVolProfileSkew(candles, endIdx);
  const garch = computeGARCH(candles, endIdx);
  let score = 0;
  if (rsi14val >= 80) score += 14;
  else if (rsi14val >= 70) score += 9;
  else if (rsi14val >= 60) score += 5;
  if (cci34val >= 100 && cci34val <= 200) score += 6;
  if (w52.pctFromLow >= 80 && w52.pctFromLow <= 400) score += 6;
  if (ttm.squeezeFired && ttm.momentumRising) score += 8;
  if (volZ.sig) score -= 5;
  else if (volZ.z >= 1.5) score -= 2;
  if (bb.squeeze) score += 6;
  else if (bb.pctl <= 20) score += 3;
  if (kSqueeze) score += 4;
  if (lr.flat) score += 4;
  if (ac.momentum) score += 4;
  if (skew.positive) score += 4;
  if (kSqueeze && bb.squeeze) score += 3;
  if (sharpe > 2.5) score += 4;
  if (entropy < 1.5) score += 3;
  if (garch > 1.3) score += 2;
  if (guppy.coiledRelease) score += 12;
  else if (guppy.cleanBullishFan) score += 3;
  return {
    volZScore: safe(volZ.z),
    volZSignificant: volZ.sig,
    bbWidth: safe(bb.width),
    bbWidthPctl: safe(bb.pctl, 50),
    bbSqueeze: bb.squeeze,
    keltnerSqueeze: kSqueeze,
    lrSlope10: safe(lr.slope),
    lrSlopeFlat: lr.flat,
    autoCorr5: safe(ac.corr),
    momentumRegime: ac.momentum,
    hurst: safe(hurst.h, 0.5),
    hurstTrending: hurst.trending,
    skewness20: safe(skew.skew),
    positiveSkew: skew.positive,
    drawdownFrom52WH: safe(w52.ddFromHigh),
    pctFrom52WL: safe(w52.pctFromLow),
    sharpe20: safe(sharpe),
    entropy10: safe(entropy),
    cusumSignal: cusum,
    sectorRelZ: 0,
    insideBars: safe(insideBars),
    volProfileSkew: safe(volSkew),
    garchForecast: safe(garch, 1),
    ttmSqueezeOn: ttm.squeezeOn,
    ttmSqueezeFired: ttm.squeezeFired,
    ttmMomentum: safe(ttm.momentum),
    ttmMomentumRising: ttm.momentumRising,
    rsi14: safe(rsi14val, 50),
    cci34: safe(cci34val),
    ema10: safe(ema10),
    ema21: safe(ema21),
    ema55: safe(ema55),
    sma200: safe(sma200),
    // Cross detection — Bug 8 fix: pre-compute prev values once (was 4 redundant O(n) traversals)
    ...endIdx > 0 ? (() => {
      const prevC = candles[endIdx - 1].c;
      const pe10 = computeEMALevel(candles, endIdx - 1, 10);
      const pe21 = computeEMALevel(candles, endIdx - 1, 21);
      const pe55 = computeEMALevel(candles, endIdx - 1, 55);
      const ps200 = computeSMALevel(candles, endIdx - 1, 200);
      const curC = candles[endIdx].c;
      return {
        ema10Cross: curC > ema10 && prevC <= pe10 || curC < ema10 && prevC >= pe10,
        ema21Cross: curC > ema21 && prevC <= pe21 || curC < ema21 && prevC >= pe21,
        ema55Cross: curC > ema55 && prevC <= pe55 || curC < ema55 && prevC >= pe55,
        sma200Cross: curC > sma200 && prevC <= ps200 || curC < sma200 && prevC >= ps200
      };
    })() : { ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false },
    guppySpreadPct: safe(guppy.spreadPct, 99),
    guppyCompressed: guppy.compressed,
    guppyUltraCompressed: guppy.ultraCompressed,
    guppyCompressDays: guppy.compressDays,
    guppyCleanBullishFan: guppy.cleanBullishFan,
    guppyGroupGapPct: safe(guppy.groupGapPct),
    guppyCoiledRelease: guppy.coiledRelease,
    guppySpring: guppy.springAlert,
    guppyPrimed: guppy.primedAlert,
    candlePattern: candlePat.short,
    candlePatternFull: candlePat.name,
    candlePatternType: candlePat.type,
    candlePatternStrength: safe(candlePat.strength),
    statsScore: safe(Math.min(score, 100))
  };
}

// lib/advancedEngine.ts
function safe2(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}
function mean2(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function std(arr, m) {
  if (arr.length < 2) return 0;
  const mu = m ?? mean2(arr);
  const variance = arr.reduce((s, x) => s + (x - mu) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}
function olsBeta(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  const mx = mean2(x.slice(0, n));
  const my = mean2(y.slice(0, n));
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}
function computeFER(candles, endIdx, period = 20) {
  if (endIdx < period) return { fer20: 0, ferTier: "CHOPPY" };
  const start = endIdx - period;
  const netMove = Math.abs(candles[endIdx].c - candles[start].c);
  let pathLen = 0;
  for (let i = start + 1; i <= endIdx; i++) {
    pathLen += Math.abs(candles[i].c - candles[i - 1].c);
  }
  const fer20 = pathLen > 0 ? safe2(netMove / pathLen) : 0;
  const ferTier = fer20 >= 0.55 ? "EFFICIENT" : fer20 >= 0.3 ? "MODERATE" : "CHOPPY";
  return { fer20, ferTier };
}
function computeCUSUM2(candles, endIdx, atr14) {
  if (endIdx < 20) return { cusumPos: 0, cusumNeg: 0, cusumSignal: false, cusumTier: "IDLE" };
  const close = candles[endIdx].c;
  const atrPct = close > 0 ? atr14 / close : 0;
  const threshold = 0.5 * atrPct;
  const signalLevel = 2 * atrPct;
  let sPos = 0, sNeg = 0;
  const startIdx = Math.max(1, endIdx - 60);
  for (let i = startIdx; i <= endIdx; i++) {
    const ret = candles[i - 1].c > 0 ? (candles[i].c - candles[i - 1].c) / candles[i - 1].c : 0;
    sPos = Math.max(0, sPos + ret - threshold);
    sNeg = Math.min(0, sNeg + ret + threshold);
  }
  const cusumTier = sPos === 0 ? "IDLE" : sPos < 0.064 ? "MILD" : "ELEVATED";
  return {
    cusumPos: safe2(sPos),
    cusumNeg: safe2(sNeg),
    cusumSignal: sPos > signalLevel,
    cusumTier
  };
}
function computeMWC(candles, endIdx) {
  const c = candles[endIdx].c;
  const roc5 = endIdx >= 5 && candles[endIdx - 5].c > 0 ? (c / candles[endIdx - 5].c - 1) * 100 : 0;
  const roc20 = endIdx >= 20 && candles[endIdx - 20].c > 0 ? (c / candles[endIdx - 20].c - 1) * 100 : 0;
  const roc60 = endIdx >= 60 && candles[endIdx - 60].c > 0 ? (c / candles[endIdx - 60].c - 1) * 100 : 0;
  let slopePosCount = 0;
  if (endIdx >= 8) {
    const prev5Base = candles[endIdx - 3 - 5].c;
    const prev5End = candles[endIdx - 3].c;
    const roc5_prev = prev5Base > 0 ? (prev5End / prev5Base - 1) * 100 : 0;
    if (roc5 > roc5_prev) slopePosCount = 1;
  }
  const score = (roc5 > roc20 ? 1 : 0) + (roc20 > roc60 ? 1 : 0) + (roc5 > 0 ? 1 : 0) + slopePosCount;
  const mwcTier = score <= 1 ? "CONTRARIAN" : score <= 2 ? "MIXED" : "CROWDED";
  return { mwcScore: score, roc5: safe2(roc5), roc20: safe2(roc20), roc60: safe2(roc60), mwcTier };
}
function computeTRAM(candles, endIdx) {
  if (endIdx < 60) return { tram: 0, cvar95: 0, tramTier: "NEUTRAL" };
  const returns = [];
  for (let i = endIdx - 59; i <= endIdx; i++) {
    if (i >= 1 && candles[i - 1].c > 0) {
      returns.push((candles[i].c - candles[i - 1].c) / candles[i - 1].c * 100);
    }
  }
  if (returns.length < 10) return { tram: 0, cvar95: 0, tramTier: "NEUTRAL" };
  returns.sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor(returns.length * 0.05));
  const cvar95 = mean2(returns.slice(0, cutoff));
  const base20 = candles[endIdx - 20];
  const roc20 = base20.c > 0 ? (candles[endIdx].c / base20.c - 1) * 100 : 0;
  const tram = Math.abs(cvar95) > 1e-3 ? safe2(roc20 / Math.abs(cvar95)) : 0;
  const tramTier = tram < -3 ? "OVERSOLD" : tram < -1.4 ? "DEPRESSED" : tram < 0.5 ? "NEUTRAL" : "EXTENDED";
  return { tram: safe2(tram), cvar95: safe2(cvar95), tramTier };
}
function computeCleanMom(candles, endIdx) {
  if (endIdx < 20) return { cleanMom: 0, roc20pct: 0, maxDD20: 0, cleanTier: "NEUTRAL" };
  const startClose = candles[endIdx - 20].c;
  const endClose = candles[endIdx].c;
  const roc20pct = startClose > 0 ? (endClose / startClose - 1) * 100 : 0;
  let peak = candles[endIdx - 20].h;
  let maxDD = 0;
  for (let i = endIdx - 19; i <= endIdx; i++) {
    if (candles[i].h > peak) peak = candles[i].h;
    const dd = peak > 0 ? (candles[i].l - peak) / peak * 100 : 0;
    if (dd < maxDD) maxDD = dd;
  }
  const cleanMom = safe2(roc20pct + maxDD);
  const cleanTier = cleanMom < -28 ? "DEEP_VALUE" : cleanMom < -10 ? "RECOVERING" : cleanMom < 11 ? "NEUTRAL" : "OVERBOUGHT";
  return { cleanMom: safe2(cleanMom), roc20pct: safe2(roc20pct), maxDD20: safe2(maxDD), cleanTier };
}
function computeRegimeDuration(candles, endIdx, atr14) {
  if (endIdx < 30) return { regimeDays: 0, avgRunLen: 0, durationRatio: 0, durationTier: "IDLE" };
  const close = candles[endIdx].c;
  const threshold = close > 0 ? atr14 / close : 0.015;
  const runs = [];
  let inRun = false;
  let runLen = 0;
  for (let i = 5; i <= endIdx; i++) {
    const ret = candles[i - 5].c > 0 ? candles[i].c / candles[i - 5].c - 1 : 0;
    if (ret > threshold) {
      if (!inRun) {
        inRun = true;
        runLen = 1;
      } else runLen++;
    } else {
      if (inRun && runLen >= 3) runs.push(runLen);
      inRun = false;
      runLen = 0;
    }
  }
  const regimeDays = inRun ? runLen : 0;
  const avgRunLen = runs.length >= 3 ? mean2(runs) : 10;
  const durationRatio = avgRunLen > 0 ? safe2(regimeDays / avgRunLen) : 0;
  const durationTier = !inRun ? "IDLE" : durationRatio < 0.3 ? "EARLY" : durationRatio < 0.76 ? "MID" : "EXTENDED";
  return { regimeDays, avgRunLen: safe2(avgRunLen), durationRatio: safe2(durationRatio), durationTier };
}
function pctRank2(sortedArr, v) {
  if (sortedArr.length === 0) return 0.5;
  let lo = 0, hi = sortedArr.length;
  while (lo < hi) {
    const m = lo + hi >> 1;
    if (sortedArr[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo / sortedArr.length;
}
function toVolRegime(rank) {
  return rank < 0.33 ? "LOW" : rank < 0.67 ? "MID" : "HIGH";
}
function computeVRAM(candles, endIdx) {
  if (endIdx < 80) return { volRegime: "MID", vram: 0, vramTier: "NEUTRAL" };
  const atrPcts = [];
  let prevC = candles[0].c;
  for (let i = 1; i <= endIdx; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - prevC),
      Math.abs(candles[i].l - prevC)
    );
    atrPcts.push(candles[i].c > 0 ? tr / candles[i].c * 100 : 0);
    prevC = candles[i].c;
  }
  const window = atrPcts.slice(Math.max(0, endIdx - 120), endIdx);
  const sorted = [...window].sort((a, b) => a - b);
  const currentATRPct = atrPcts[endIdx - 1];
  const volRegime = toVolRegime(pctRank2(sorted, currentATRPct));
  const regimeROCs = [];
  for (let i = 20; i < endIdx; i++) {
    const histRank = pctRank2(sorted, atrPcts[i - 1]);
    if (toVolRegime(histRank) === volRegime && candles[i - 20].c > 0) {
      regimeROCs.push((candles[i].c / candles[i - 20].c - 1) * 100);
    }
  }
  if (regimeROCs.length < 10) return { volRegime, vram: 0, vramTier: "NEUTRAL" };
  const currentROC20 = candles[endIdx - 20].c > 0 ? (candles[endIdx].c / candles[endIdx - 20].c - 1) * 100 : 0;
  const mu = mean2(regimeROCs);
  const sigma = std(regimeROCs, mu);
  const vram = sigma > 0 ? safe2((currentROC20 - mu) / sigma) : 0;
  const vramTier = vram < -1.1 ? "OVERSOLD" : vram < -0.76 ? "LOW" : vram < 0.35 ? "NEUTRAL" : vram < 0.93 ? "ELEVATED" : "OVERBOUGHT";
  return { volRegime, vram: safe2(vram), vramTier };
}
function computePIC(candles, endIdx) {
  const period = 20;
  if (endIdx < period + 1) return { pic: 0, picTier: "FAIR" };
  const signedVols = [];
  const dailyReturns = [];
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    const ret = candles[i - 1].c > 0 ? (candles[i].c - candles[i - 1].c) / candles[i - 1].c : 0;
    const sign = ret > 0 ? 1 : ret < 0 ? -1 : 0;
    signedVols.push(candles[i].v * sign);
    dailyReturns.push(ret);
  }
  const meanAbsVol = mean2(signedVols.map(Math.abs)) || 1;
  const normSignedVols = signedVols.map((v) => v / meanAbsVol);
  const beta = olsBeta(normSignedVols, dailyReturns);
  const pic = safe2(beta * 1e3);
  const picTier = pic < 8 ? "REACTIVE_LOW" : pic < 16 ? "FAIR" : pic < 25 ? "ACTIVE" : pic < 30 ? "HIGH" : "SATURATED";
  return { pic: safe2(pic), picTier };
}
function computeAdvScore(f) {
  let s = 0;
  const utbotFresh = f.utbotBarsAgo <= 1;
  s += f.utbotMode === "BOTH" ? utbotFresh ? 20 : 14 : f.utbotMode === "PRECISION" ? utbotFresh ? 12 : 8 : f.utbotMode === "EARLY" ? utbotFresh ? 10 : 6 : 0;
  s += f.vramTier === "OVERSOLD" ? 20 : f.vramTier === "LOW" ? 12 : f.vramTier === "NEUTRAL" ? 4 : f.vramTier === "ELEVATED" ? 6 : (
    // mild positive edge
    /* OVERBOUGHT */
    0
  );
  s += f.tramTier === "OVERSOLD" ? 20 : f.tramTier === "DEPRESSED" ? 10 : f.tramTier === "NEUTRAL" ? 2 : (
    /* EXTENDED */
    0
  );
  s += f.ferTier === "EFFICIENT" ? 15 : f.ferTier === "MODERATE" ? 7 : (
    /* CHOPPY */
    0
  );
  s += f.cleanTier === "DEEP_VALUE" ? 15 : f.cleanTier === "RECOVERING" ? 8 : f.cleanTier === "NEUTRAL" ? 4 : (
    /* OVERBOUGHT */
    0
  );
  s += f.durationTier === "IDLE" ? 10 : f.durationTier === "EARLY" ? 4 : f.durationTier === "MID" ? 1 : (
    /* EXTENDED */
    0
  );
  s += f.mwcTier === "CONTRARIAN" ? 10 : f.mwcTier === "MIXED" ? 5 : (
    /* CROWDED */
    0
  );
  s += f.cusumTier === "IDLE" ? 5 : f.cusumTier === "MILD" ? 3 : (
    /* ELEVATED */
    0
  );
  s += f.picTier === "ACTIVE" ? 5 : f.picTier === "HIGH" ? 4 : f.picTier === "FAIR" ? 3 : f.picTier === "SATURATED" ? 2 : (
    /* REACTIVE_LOW */
    0
  );
  return Math.min(100, s);
}
function temaArr(candles, endIdx, period) {
  const k = 2 / (period + 1);
  const e1 = new Array(endIdx + 1).fill(candles[0].c);
  const e2 = new Array(endIdx + 1).fill(candles[0].c);
  const e3 = new Array(endIdx + 1).fill(candles[0].c);
  for (let i = 1; i <= endIdx; i++) e1[i] = candles[i].c * k + e1[i - 1] * (1 - k);
  for (let i = 1; i <= endIdx; i++) e2[i] = e1[i] * k + e2[i - 1] * (1 - k);
  for (let i = 1; i <= endIdx; i++) e3[i] = e2[i] * k + e3[i - 1] * (1 - k);
  const out = new Array(endIdx + 1).fill(0);
  for (let i = 0; i <= endIdx; i++) out[i] = 3 * e1[i] - 3 * e2[i] + e3[i];
  return out;
}
function vwmaArr(candles, endIdx, period) {
  const out = new Array(endIdx + 1).fill(0);
  let sumPV = 0, sumV = 0;
  for (let i = 0; i <= endIdx; i++) {
    sumPV += candles[i].c * candles[i].v;
    sumV += candles[i].v;
    if (i >= period) {
      sumPV -= candles[i - period].c * candles[i - period].v;
      sumV -= candles[i - period].v;
    }
    out[i] = sumV > 0 ? sumPV / sumV : candles[i].c;
  }
  return out;
}
function atrArr(candles, endIdx, period) {
  const out = new Array(endIdx + 1).fill(0);
  for (let i = 1; i <= endIdx; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    );
    out[i] = i === 1 ? tr : (out[i - 1] * (period - 1) + tr) / period;
  }
  return out;
}
function utBotTrailingStop(src, atr, endIdx, sensitivity) {
  const stop = new Array(endIdx + 1).fill(0);
  stop[0] = src[0] - sensitivity * (atr[0] || atr[1] || 1);
  for (let i = 1; i <= endIdx; i++) {
    if (atr[i] === 0) {
      stop[i] = stop[i - 1];
      continue;
    }
    const ps = stop[i - 1], pSrc = src[i - 1], cSrc = src[i], loss = sensitivity * atr[i];
    if (cSrc > ps && pSrc > ps) stop[i] = Math.max(ps, cSrc - loss);
    else if (cSrc < ps && pSrc < ps) stop[i] = Math.min(ps, cSrc + loss);
    else stop[i] = cSrc > ps ? cSrc - loss : cSrc + loss;
  }
  return stop;
}
function findLatestBuySignal(src, stop, candles, atr14, endIdx, lookback = 3) {
  for (let d = 0; d < lookback; d++) {
    const i = endIdx - d;
    if (i < 1) continue;
    if (src[i] > stop[i] && src[i - 1] <= stop[i - 1]) {
      const lb = Math.max(0, i - 20);
      let minC = candles[lb].c, minBar = lb;
      for (let k = lb + 1; k <= i; k++) {
        if (candles[k].c < minC) {
          minC = candles[k].c;
          minBar = k;
        }
      }
      const entry = candles[i].h + 0.75 * (atr14[i] || 0);
      return { fired: true, barsAgo: d, lag: i - minBar, entry: safe2(entry) };
    }
  }
  return { fired: false, barsAgo: 99, lag: 0, entry: 0 };
}
function computeUTBot(candles, endIdx, atr14) {
  if (endIdx < 60) return { utbotMode: "NONE", utbotBarsAgo: 99, utbotLag: 0, utbotEntry: 0 };
  const vwma55 = vwmaArr(candles, endIdx, 55);
  const atr14a = atr14;
  const stopP = utBotTrailingStop(vwma55, atr14a, endIdx, 2);
  const precSig = findLatestBuySignal(vwma55, stopP, candles, atr14a, endIdx);
  const tema10 = temaArr(candles, endIdx, 10);
  const atr7 = atrArr(candles, endIdx, 7);
  const stopE = utBotTrailingStop(tema10, atr7, endIdx, 1);
  const earlySig = findLatestBuySignal(tema10, stopE, candles, atr14a, endIdx);
  const precFired = precSig.fired;
  const earlyFired = earlySig.fired;
  if (precFired && earlyFired) {
    const bestBarsAgo = Math.min(precSig.barsAgo, earlySig.barsAgo);
    const fresher = precSig.barsAgo <= earlySig.barsAgo ? precSig : earlySig;
    return { utbotMode: "BOTH", utbotBarsAgo: bestBarsAgo, utbotLag: fresher.lag, utbotEntry: fresher.entry };
  }
  if (precFired) return { utbotMode: "PRECISION", utbotBarsAgo: precSig.barsAgo, utbotLag: precSig.lag, utbotEntry: precSig.entry };
  if (earlyFired) return { utbotMode: "EARLY", utbotBarsAgo: earlySig.barsAgo, utbotLag: earlySig.lag, utbotEntry: earlySig.entry };
  return { utbotMode: "NONE", utbotBarsAgo: 99, utbotLag: 0, utbotEntry: 0 };
}
function computeAdvancedFeatures(candles, endIdx, atr14) {
  if (endIdx < 20 || candles.length < 21) {
    return {
      utbotMode: "NONE",
      utbotBarsAgo: 99,
      utbotLag: 0,
      utbotEntry: 0,
      fer20: 0,
      ferTier: "CHOPPY",
      cusumPos: 0,
      cusumNeg: 0,
      cusumSignal: false,
      cusumTier: "IDLE",
      mwcScore: 0,
      roc5: 0,
      roc20: 0,
      roc60: 0,
      mwcTier: "CONTRARIAN",
      tram: 0,
      cvar95: 0,
      tramTier: "NEUTRAL",
      cleanMom: 0,
      roc20pct: 0,
      maxDD20: 0,
      cleanTier: "NEUTRAL",
      regimeDays: 0,
      avgRunLen: 0,
      durationRatio: 0,
      durationTier: "IDLE",
      volRegime: "MID",
      vram: 0,
      vramTier: "NEUTRAL",
      pic: 0,
      picTier: "FAIR",
      advScore: 0,
      advGrade: "D"
    };
  }
  const atr14Arr = atrArr(candles, endIdx, 14);
  const { fer20, ferTier } = computeFER(candles, endIdx);
  const { cusumPos, cusumNeg, cusumSignal, cusumTier } = computeCUSUM2(candles, endIdx, atr14);
  const { mwcScore, roc5, roc20, roc60, mwcTier } = computeMWC(candles, endIdx);
  const { tram, cvar95, tramTier } = computeTRAM(candles, endIdx);
  const { cleanMom, roc20pct, maxDD20, cleanTier } = computeCleanMom(candles, endIdx);
  const { regimeDays, avgRunLen, durationRatio, durationTier } = computeRegimeDuration(candles, endIdx, atr14);
  const { volRegime, vram, vramTier } = computeVRAM(candles, endIdx);
  const { pic, picTier } = computePIC(candles, endIdx);
  const { utbotMode, utbotBarsAgo, utbotLag, utbotEntry } = computeUTBot(candles, endIdx, atr14Arr);
  const partial = {
    utbotMode,
    utbotBarsAgo,
    utbotLag,
    utbotEntry,
    fer20,
    ferTier,
    cusumPos,
    cusumNeg,
    cusumSignal,
    cusumTier,
    mwcScore,
    roc5,
    roc20,
    roc60,
    mwcTier,
    tram,
    cvar95,
    tramTier,
    cleanMom,
    roc20pct,
    maxDD20,
    cleanTier,
    regimeDays,
    avgRunLen,
    durationRatio,
    durationTier,
    volRegime,
    vram,
    vramTier,
    pic,
    picTier
  };
  const advScore = computeAdvScore(partial);
  const advGrade = advScore >= 80 ? "A+" : advScore >= 65 ? "A" : advScore >= 45 ? "B" : advScore >= 25 ? "C" : "D";
  return { ...partial, advScore, advGrade };
}

// lib/ucScoreWeights.ts
var UC_SCORE_WEIGHTS = {
  generated: "2026-09-16",
  source: "logger_v4_backtest",
  n_labeled: 10697,
  // Continuous-feature max points — updated from v4 logger backtest (2026-09-16).
  // Cohen d (logger, n=10697, n_pos=90): RangeATR=0.719, VolPre5=0.553, CloseLoc=0.315,
  //   VolR20=0.151, RSI2=-0.105 (negative!), UpperWick=-0.086, BodyPct=-0.059
  // clTrend/rsi2Vel: 4,941 rows logged but 0 labeled positives — held at manual until positives arrive
  closeLoc_pts: 16,
  // v4: 16 (was 22; d=0.315 moderate, rebalanced vs stronger features)
  rsi2_pts: 9,
  // v4: 9 (was 16; d=-0.105 NEGATIVE — lower RSI = more UC hits, overweighted)
  clTrend_pts: 18,
  // manual — no labeled positives in logged rows yet
  clTrend_neutral: 9,
  rsi2Vel_pts: 13,
  // manual — no labeled positives in logged rows yet
  rsi2Vel_neutral: 6.5,
  rangeATR_pts: 11,
  // v4: 11 (was 10; d=0.719 strongest continuous feature)
  bodyPct_pts: 3,
  // v4: 3 (was 7; d=-0.059 near-zero, was overweighted)
  zoneTight_pts: 8,
  // unchanged — 0 logger rows with zone_tightness, can't optimize
  zoneTight_neutral: 4,
  // unchanged
  upperWick_pts: 8,
  // v4: 8 (was 4; d=-0.086 negative = lower wick = better, doubled)
  upperWick_neutral: 3.5,
  // v4: 3.5 (was 2; raised proportionally)
  volAccel_pts: 12,
  // v4: 12 (was 10; d=0.553 via vol_pre5 proxy, strong)
  volAccel_neutral: 5,
  // Step-function vol bonus — thresholds fixed, pts are what we scale
  volBonus_3x5: 16,
  // v4: 16 (was 12; vol surge most reliable UC precursor)
  volBonus_2x: 6.5,
  // v4: 6.5 (was 5)
  volBonus_1x5: 2,
  // unchanged
  // Categorical bonuses (not auto-scaled — ratios are empirical, not Cohen's d)
  nearBrkAPlus_pts: 5,
  nearBrkA_pts: 2.5,
  archVF_pts: 4,
  archMP_pts: 3,
  archCC_pts: 2,
  archOther_pts: 1,
  // Brain V2 feature set 2 — added 2026-08-12 (manual_v4, pending labeled backtest)
  // vol dry+surge: surge vs quiet accumulation period (not vs 20d avg) — detects operator pre-positioning
  volDrySurge_pts: 8,
  // weekly resonance: last-5d pseudo-weekly close_loc≥70 + body≥25 — institutional follow-through
  weeklyResonate_pts: 6,
  // psychological magnet: price within 3% below round-number ceiling + close_loc≥70 — spring release
  magnetFlag_pts: 4,
  // Candle morphology (k-means K=5, N=1000 labeled, outcome_pct_20d>15% as UC proxy, 2026-08-12)
  // Coiled Spring (body<25 AND wick<20): hammer/dragonfly — 34.6% UC-proxy vs 27% baseline (+7.6pp)
  // Intraday absorption: traded down, recovered to high, no upper shadow = no distribution overhead
  morphCoiledSpring_pts: 3,
  // v4: 3 (was 5; grid reduced, consistent with bodyPct↓)
  // Gravestone (body<25 AND wick>35): doji/shooting star — 23.4% UC-proxy (-3.6pp below baseline)
  // Reinforces PRE_BREAKOUT quality gate; explicit penalty for cross-stage gravestone candles
  morphGravestone_penalty: 6,
  // v4: 6 (was 4; grid strengthened penalty)
  // Nifty 5d market regime multipliers (applied in page.tsx after formula blend)
  niftyBullMult: 1.1,
  // Nifty 5d > +2%
  niftyNeutralMult: 1,
  niftyBearMult: 0.85,
  // Nifty 5d < -2%
  niftyBullThreshold: 2,
  niftyBearThreshold: -2
};

// lib/stockEngine.ts
var atr14Cache = /* @__PURE__ */ new WeakMap();
var emaCache = /* @__PURE__ */ new WeakMap();
var rsiCache = /* @__PURE__ */ new WeakMap();
var dmiCache = /* @__PURE__ */ new WeakMap();
function analyzeStockWithLookback(candles, paramSetKey, lookback) {
  const stageRank = {
    ULTRA_STRONG_BUY: 7,
    STRONG_BUY: 6,
    BUY: 5,
    PRE_BREAKOUT: 4,
    EARLY_INFLECTION: 3,
    COMPRESSION_WATCH: 2,
    NO_SIGNAL: 1
  };
  let best = null;
  const end = candles.length;
  const start = Math.max(30, end - lookback);
  for (let i = end; i >= start; i--) {
    const slice = candles.slice(0, i);
    if (slice.length < 30) break;
    const r = analyzeStock(slice, paramSetKey);
    if (!best || stageRank[r.stage] > stageRank[best.stage] || stageRank[r.stage] === stageRank[best.stage] && r.inflectionScore > best.inflectionScore) {
      best = r;
    }
    if (r.stage === "ULTRA_STRONG_BUY") break;
  }
  return best ?? analyzeStock(candles, paramSetKey);
}
function computeRSvsNifty(stockCandles, niftyCandles, period = 20) {
  if (stockCandles.length < period + 1 || niftyCandles.length < period + 1) return 1;
  const stockEnd = stockCandles[stockCandles.length - 1].c;
  const stockStart = stockCandles[stockCandles.length - 1 - period].c;
  const niftyEnd = niftyCandles[niftyCandles.length - 1].c;
  const niftyStart = niftyCandles[niftyCandles.length - 1 - period].c;
  if (stockStart <= 0 || niftyStart <= 0) return 1;
  const stockReturn = stockEnd / stockStart;
  const niftyReturn = niftyEnd / niftyStart;
  return niftyReturn > 0 ? stockReturn / niftyReturn : 1;
}
function computeClusterBreakdown(candles) {
  const mapping = [
    { key: "optimized_deployable_20plus", label: "deployable" },
    { key: "optimized_highprecision_15plus", label: "highPrecision" },
    { key: "optimized_elite_10plus", label: "elite" },
    { key: "optimized_ultraselective_8plus", label: "ultraSelective" },
    { key: "sniper_95plus", label: "sniper" }
  ];
  const result = {};
  for (const { key, label } of mapping) {
    const r = analyzeStock(candles, key);
    result[label] = { met: r.conditionsMet, total: r.totalConditions };
  }
  const orsR = analyzeStock(candles, "ors_prime_reversal");
  result.orsReversal = {
    met: orsR.conditionsMet,
    total: orsR.totalConditions,
    score: orsR.orsScore ?? 0,
    confirmed: orsR.orsConfirmed ?? false
  };
  return result;
}
function analyzeStockMulti(candles, symbol) {
  const byParamSet = {};
  let best = null;
  const passedSets = [];
  const stageRank = {
    ULTRA_STRONG_BUY: 7,
    STRONG_BUY: 6,
    BUY: 5,
    PRE_BREAKOUT: 4,
    EARLY_INFLECTION: 3,
    COMPRESSION_WATCH: 2,
    NO_SIGNAL: 1
  };
  const mapping = [
    { key: "optimized_deployable_20plus", label: "deployable" },
    { key: "optimized_highprecision_15plus", label: "highPrecision" },
    { key: "optimized_elite_10plus", label: "elite" },
    { key: "optimized_ultraselective_8plus", label: "ultraSelective" },
    { key: "sniper_95plus", label: "sniper" }
  ];
  const breakdown = {};
  for (const { key, label } of mapping) {
    const r = analyzeStock(candles, key);
    r.symbol = symbol;
    byParamSet[key] = r;
    breakdown[label] = { met: r.conditionsMet, total: r.totalConditions };
    const minUC = PARAM_SETS[key].minUC;
    const ucGate = minUC === void 0 || (r.ucScore ?? 0) >= minUC;
    if (ucGate && ["BUY", "STRONG_BUY", "ULTRA_STRONG_BUY"].includes(r.stage)) {
      passedSets.push(key);
    }
    if (ucGate && (!best || stageRank[r.stage] > stageRank[best.stage] || stageRank[r.stage] === stageRank[best.stage] && r.inflectionScore > best.inflectionScore)) {
      best = r;
    }
  }
  const orsR = analyzeStock(candles, "ors_prime_reversal");
  orsR.symbol = symbol;
  byParamSet["ors_prime_reversal"] = orsR;
  breakdown.orsReversal = {
    met: orsR.conditionsMet,
    total: orsR.totalConditions,
    score: orsR.orsScore ?? 0,
    confirmed: orsR.orsConfirmed ?? false
  };
  if (["BUY", "STRONG_BUY", "ULTRA_STRONG_BUY"].includes(orsR.stage)) {
    passedSets.push("ors_prime_reversal");
    if (!best || stageRank[orsR.stage] > stageRank[best.stage] || stageRank[orsR.stage] === stageRank[best.stage] && orsR.inflectionScore > best.inflectionScore) {
      best = orsR;
    }
  }
  best.clusterBreakdown = breakdown;
  const ACTIONABLE = /* @__PURE__ */ new Set(["BUY", "STRONG_BUY", "ULTRA_STRONG_BUY"]);
  const confluenceFlags = {
    volumeFootprint: ACTIONABLE.has(byParamSet["optimized_deployable_20plus"].stage),
    compressionCoil: ACTIONABLE.has(byParamSet["optimized_highprecision_15plus"].stage),
    momentumPocket: ACTIONABLE.has(byParamSet["optimized_elite_10plus"].stage),
    emaStack: ACTIONABLE.has(byParamSet["optimized_ultraselective_8plus"].stage),
    ors: ACTIONABLE.has(byParamSet["ors_prime_reversal"].stage),
    breakout: ACTIONABLE.has(byParamSet["sniper_95plus"].stage)
  };
  const confluenceScore = Object.values(confluenceFlags).filter(Boolean).length;
  best.confluenceScore = confluenceScore;
  best.confluenceFlags = confluenceFlags;
  return {
    symbol,
    lastClose: best.lastClose,
    lastDate: best.lastDate,
    best,
    byParamSet,
    passedSets,
    passedCount: passedSets.length
  };
}
var PARAM_SETS = {
  // v13 forensic — stop-first validation: 68.3% WR, +2.08% avg, PF 2.24 (41 trades)
  optimized_deployable_20plus: {
    name: "VF Scout",
    tag: "\u{1F4CA} Vol Breakout",
    minAvgTurnover20: 1e7,
    maxATRPct14Pctl120: 50,
    maxPre10AvgRangeATR: 0.95,
    maxPre10ExpansionCount: 1,
    expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 1,
    minZoneLen: 4,
    maxZoneLen: 25,
    maxZoneTightnessPct: 6,
    // v2: 12→6 (tighter zone)
    maxPre10AvgVolRatio: 0.8,
    maxPre5AvgVolRatio: 0.9,
    // v14: vol10 0.90→0.80 (stricter pre-zone volume quiescence)
    maxPre10HighVolCount: 2,
    highVolMultiplier: 1.35,
    maxPre10RedVolBias: 1.1,
    breakoutMultiplier: 1.001,
    minExactRangeATR14: 1.2,
    maxExactRangeATR14: 5,
    minExactVolRatio20: 2.5,
    minExactVolVsPre5: 3.5,
    // v14: vp5 2.5→3.5 (stronger volume confirmation required)
    minCloseLoc: 75,
    maxUpperWickPct: 18,
    minBodyPct: 65,
    maxCandleRisk: 10,
    // V4 structural: closeLoc 68→75 (V4 best gate; baked into engine)
    minUltraPrecisionScore: 80,
    minRSI2: 50,
    // v14: prec 75→80 (higher signal quality floor)
    minVolatilityExpansionRatio: 2,
    minCandleQualityScore: 2,
    maxCloseAboveZonePct: 3.5,
    // v14: 6.0→3.5 (must break out cleanly, not extended)
    forensic: {
      maxCusumPos: 0.04,
      requireBullishPattern: true
    }
  },
  // v13 forensic — stop-first validation: 62.5% WR, +1.33% avg, PF 1.67 (80 trades)
  // tpsl_optimizer (2026-08-06): TP=10%/SL=2.5×ATR → WR=54.2%, PF=1.92, exp=+2.03% OOS (n=24).
  //   Exit configured in ARCHETYPE_EXIT_DEFAULTS: targetPct=10, slAtrMult=2.5.
  // Phase 1 spec-restoration (2026-08-06): maxPre10AvgRangeATR 1.0→0.85, minExactRangeATR14 0.2→1.0,
  //   maxExactRangeATR14 1.1→5.0, minExactVolRatio20 3.0→1.1, minCloseLoc 60→65,
  //   maxCandleRisk 12→11, minCandleQualityScore null→3 (spec alignment, broadens signal pool).
  optimized_highprecision_15plus: {
    name: "CC Precision",
    tag: "\u{1F504} Coil Breakout",
    minAvgTurnover20: 1e7,
    maxATRPct14Pctl120: 85,
    maxPre10AvgRangeATR: 0.72,
    maxPre10ExpansionCount: 2,
    expansionATRMultiplier: 1.1,
    // v14: 0.85→0.72 (stricter pre-zone calm)
    zoneRangeATRThreshold: 1,
    minZoneLen: 10,
    maxZoneLen: 25,
    maxZoneTightnessPct: 7,
    // v2: minZone 5→10, tight 5→7
    maxPre10AvgVolRatio: 0.9,
    maxPre5AvgVolRatio: 1.1,
    maxPre10HighVolCount: 4,
    highVolMultiplier: 1.35,
    maxPre10RedVolBias: 1.1,
    breakoutMultiplier: 1.001,
    minExactRangeATR14: 1,
    maxExactRangeATR14: 5,
    minExactVolRatio20: 2.5,
    minExactVolVsPre5: 2.5,
    // v14: vol20 2.0→2.5 (match VF Scout threshold)
    minCloseLoc: 78,
    maxUpperWickPct: 20,
    minBodyPct: 65,
    maxCandleRisk: 11,
    // v14: closeLoc 72→78 (strong upper close required)
    minUltraPrecisionScore: 75,
    minRSI2: 50,
    minVolatilityExpansionRatio: 1.4,
    minCandleQualityScore: 4,
    // v14: cqs 3→4 (higher candle quality bar)
    maxCloseAboveZonePct: 2.5,
    // v14: 4.0→2.5 (tighter zone breakout only)
    minUC: 50,
    // uc≥50 gate: OOS PF 0.99→1.56, avg -0.02→+0.84% (162-combo grid, 2026-09-20)
    forensic: {
      maxBodyATR: 1.6
    }
  },
  // v12 tuned — stop-first validation: 75.0% WR, +3.41% avg, PF 4.33 (12 trades; small sample)
  // tpsl_optimizer (2026-08-06): PF=0.90 max across all 64 TP/SL combos OOS (n=680). MAE p50=8.1%
  //   exceeds all viable TP targets. RETIRED from active trading → screener/watchlist only.
  // Phase 1 spec-restoration (2026-08-06): minUltraPrecisionScore 0→45, minCloseLoc 45→65,
  //   minBodyPct 5→25, maxCandleRisk 5→10, maxPre10AvgRangeATR 1.0→0.85, maxPre10AvgVolRatio 1.0→0.90
  //   (grid-search had zeroed quality gates; restored to remove low-quality signal contamination).
  optimized_elite_10plus: {
    name: "MP Elite",
    tag: "\u{1F3AF} Momentum Pocket",
    minAvgTurnover20: 2e7,
    maxATRPct14Pctl120: 60,
    maxPre10AvgRangeATR: 0.85,
    maxPre10ExpansionCount: 2,
    expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 1,
    minZoneLen: 6,
    maxZoneLen: 25,
    maxZoneTightnessPct: 12,
    // ZL6: OOS WR 75% Wilson 46.0% (n=8) vs ZL8 37.6%
    maxPre10AvgVolRatio: 0.9,
    maxPre5AvgVolRatio: 1.1,
    maxPre10HighVolCount: 2,
    highVolMultiplier: 1.2,
    maxPre10RedVolBias: 1.1,
    breakoutMultiplier: 1.001,
    minExactRangeATR14: 1.8,
    maxExactRangeATR14: 6,
    minExactVolRatio20: 1.2,
    minExactVolVsPre5: 2,
    minCloseLoc: 65,
    maxUpperWickPct: 30,
    minBodyPct: 65,
    maxCandleRisk: 10,
    // V3b CPCV: body≥65 (was 45)
    minUltraPrecisionScore: 75,
    minRSI2: 50,
    // opt: prec 45→75
    minVolatilityExpansionRatio: 1.4,
    minCandleQualityScore: 2,
    maxCloseAboveZonePct: 8,
    minZonePivotCount: 2
    // Q4: ZL6+Q4 OOS WR 75% Wilson 46.0% n=8 (vs baseline 37.6%)
  },
  // ✅ Grid-optimised v13 — 1616-stock sweep, n=294, WR=56.8%, Wilson=51.09%, PF=1.933
  // ✅ ChatGPT forensic v12 — 1616-stock sweep, n=54, WR=70.4%, Wilson=57.2%, PF=3.656
  // tpsl_optimizer (2026-08-06): PF=0.89 max across all 64 TP/SL combos OOS (n=314). MAE p50=7.6%
  //   wipes available TP. RETIRED from active trading → screener/watchlist only.
  // Phase 1 spec-restoration (2026-08-06): minUltraPrecisionScore 0→45, minBodyPct 60→25,
  //   maxPre10AvgRangeATR 1.3→0.75, maxPre10RedVolBias 0.8→1.1, maxCandleRisk 5→10
  //   (grid-search zeroed quality gates and over-tightened pre-zone ATR; restored spec defaults).
  optimized_ultraselective_8plus: {
    name: "EMA Stack",
    tag: "\u{1F4C8} Trend Crossover",
    minAvgTurnover20: 1e7,
    maxATRPct14Pctl120: 95,
    maxPre10AvgRangeATR: 0.68,
    maxPre10ExpansionCount: 0,
    expansionATRMultiplier: 1.1,
    // v14: 0.75→0.68 (tighter calm zone)
    zoneRangeATRThreshold: 0.95,
    minZoneLen: 8,
    maxZoneLen: 25,
    maxZoneTightnessPct: 12,
    // v2: tight 15→12
    maxPre10AvgVolRatio: 0.9,
    maxPre5AvgVolRatio: 0.95,
    maxPre10HighVolCount: 0,
    highVolMultiplier: 1.5,
    maxPre10RedVolBias: 1.1,
    breakoutMultiplier: 1.001,
    minExactRangeATR14: 1.5,
    maxExactRangeATR14: 6,
    // v14: 1.2→1.5 (stronger range expansion)
    minExactVolRatio20: 2.2,
    minExactVolVsPre5: 2.2,
    // v14: vol20 1.6→2.2, vp5 1.5→2.2 (institutional threshold)
    minCloseLoc: 65,
    maxUpperWickPct: 30,
    minBodyPct: 72,
    maxCandleRisk: 10,
    // v14: body 65→72 (stronger close conviction)
    minUltraPrecisionScore: 68,
    minRSI2: 50,
    // v14: prec 45→68 (was far below all other sets)
    minVolatilityExpansionRatio: 1.4,
    minCandleQualityScore: 3,
    maxCloseAboveZonePct: null
  },
  // ✅ ORS-Prime v3 Rank 2 — deep_tune_updated_six_full_v3 (1616 stocks, 2021-2026)
  // IS: n=2160 WR=81.3% Avg=1.09% PF=1.51 | OOS: n=648 WR=85.0% Avg=1.92% PF=2.30 MFE=6.3% MAE=-4.7%
  // Chosen over v4 (91% WR): v3 has better R:R (PF=2.30 vs 2.22), higher avg gain (+1.92% vs +1.28%),
  //   tighter losers (MAE -14% vs -19%), and higher per-trade R-multiple.
  // Code fix: requireRedCandle param now honoured (was hardcoded `red &&` before v2+)
  // DO NOT mix with breakout param-set logic — routes to analyzeORS() internally
  ors_prime_reversal: {
    name: "ORS Reversal",
    tag: "\u21A9 83.1% OOS WR",
    // Breakout fields unused (set to pass-all so analyzeStock early-exits cleanly)
    minAvgTurnover20: 0,
    maxATRPct14Pctl120: 100,
    maxPre10AvgRangeATR: 99,
    maxPre10ExpansionCount: 99,
    expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 99,
    minZoneLen: 1,
    maxZoneLen: 100,
    maxZoneTightnessPct: 100,
    maxPre10AvgVolRatio: 99,
    maxPre5AvgVolRatio: 99,
    maxPre10HighVolCount: 99,
    highVolMultiplier: 1.35,
    maxPre10RedVolBias: 99,
    breakoutMultiplier: 0,
    minExactRangeATR14: 0,
    maxExactRangeATR14: 99,
    minExactVolRatio20: 0,
    minExactVolVsPre5: 0,
    minCloseLoc: 0,
    maxUpperWickPct: 100,
    minBodyPct: 0,
    maxCandleRisk: 100,
    minUltraPrecisionScore: 0,
    minRSI2: 0,
    minVolatilityExpansionRatio: null,
    minCandleQualityScore: null,
    maxCloseAboveZonePct: null,
    // ORS-specific logic — v5 DMI-augmented params (OOS WR 96.2%, n=624)
    ors: {
      maxRSI2: 7,
      // slightly relaxed from 5 (DMI filters direction)
      maxRSI14: 35,
      // tightened from 38 — grid-search OOS WR 63.9% (n=448, PF 2.40)
      maxCloseLoc: 53,
      // tightened from 58 (lower close location)
      minBodyPct: 37,
      // relaxed from 62 (ADX handles quality)
      maxUpperWickPct: 30,
      // tightened from 41 — rejection above close must be limited
      minRangePct: 6.4,
      // tightened from 5.3 (meaningful range required)
      maxDistEMA20: -10,
      // tightened from -6: must be 10%+ below EMA20
      minDdSwingHigh: 38,
      // 38%+ below 60d swing high (was 39)
      requireSwingLow: false,
      requireRedCandle: false,
      // removed — ORS score + EMA distance do quality control
      minOrsScore: 68,
      // tightened from 63 — grid-search validated OOS champion
      minADX: 20,
      // ADX ≥ 20 required (trending regime)
      minLowerWickPct: 20,
      // lower tail ≥ 20% of range (demand absorption proof — backtest-validated sweet spot)
      maxBodyATR: 1.6,
      // body ≤ 1.6×ATR14 (anti-extension: not over-stretched)
      minCloseLoc: 45,
      // V3b CPCV: closeLoc∈[45,53] → minPF=4.20 WR=96% n=25 OOS
      tpPct: 3,
      slAtrMult: 5,
      // grid-opt 2026-09-20: SL 2×→5× → PF 2.66→3.33 WR unchanged 87.5%
      maxHoldBars: 10
      // grid-opt 2026-09-20: hold 12→10 — exits before losers recover
    }
  },
  // ✅ V3b CPCV-validated (2026-08-23) — breadthRising regime gate + candle thresholds
  //    Gate: breadthRising (market breadth >55% smoothed) + wick≤25 + prec≥75 + vol5≥3 + body≥0
  //    CPCV C(9,2)=36 paths: minPF=1.38 avgPF=1.71 valid_splits=15/36 DSR_eff=0 → DEPLOY_NODSR
  //    Flat OOS (2025-Q1+): n=11 WR=90.9% PF=2.79 avg=+2.92% stop=9.1%
  //    NOTE: regime gate (breadth>55%) must be applied externally — only activate sniper
  //    signals when Nifty market breadth is in bull regime (>55% stocks above EMA-50).
  //    body≥0 = no body gate (breadth + vol5≥3 handle quality selection)
  sniper_95plus: {
    name: "Sniper PS",
    tag: "\u26A1 Multi-Archetype",
    minAvgTurnover20: 1e7,
    maxATRPct14Pctl120: 40,
    maxPre10AvgRangeATR: 0.95,
    maxPre10ExpansionCount: 1,
    expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 1,
    minZoneLen: 4,
    maxZoneLen: 25,
    maxZoneTightnessPct: 12,
    maxPre10AvgVolRatio: 0.9,
    maxPre5AvgVolRatio: 1.1,
    maxPre10HighVolCount: 0,
    highVolMultiplier: 1.35,
    maxPre10RedVolBias: 1.6,
    breakoutMultiplier: 1.001,
    minExactRangeATR14: 1.8,
    maxExactRangeATR14: 5,
    minExactVolRatio20: 2.5,
    minExactVolVsPre5: 3,
    // V3b: vol5≥3 (was 1.5) — key discriminator in breadth-rising regime
    minCloseLoc: 65,
    maxUpperWickPct: 25,
    minBodyPct: 0,
    maxCandleRisk: 11,
    // V3b: body≥0 (was 65), wick≤25 ✓, closeLoc≥65 preserved
    minUltraPrecisionScore: 75,
    minRSI2: 50,
    // prec≥75 ✓
    minVolatilityExpansionRatio: 1,
    minCandleQualityScore: 2,
    maxCloseAboveZonePct: 5,
    minPriorRunUpPct: 10
    // Q5: OOS +16.7pp WR (83.3% vs 66.7%, n=12, Wilson lo 60.1%)
  },
  // Discriminant-analysis design: case-control study 6,339 circuit events vs 31,695 controls.
  // Backtest (cb_backtest.js): recall 15%, precision 0.36% OOS, lift 1.3× vs 0.27% base rate.
  // Designed as a momentum screener (universe reduction), not a binary next-day predictor.
  // tpsl_optimizer (2026-08-06): redesigned as Upper Circuit Candidate (ULTRA/STRONG + near 20d high
  //   + vol≥2x), n=1752 OOS. PF=0.82 max across all 64 TP/SL combos. SCREENER ONLY.
  circuit_breaker_v2: {
    name: "Circuit Breaker",
    tag: "\u26A1 Upper Circuit",
    screenerOnly: true,
    // OOS PF=1.00 max (162-combo grid, Sep-20); not in analyzeStockMulti; universe reduction only
    // Breakout fields set to pass-all — CB routes directly to analyzeCircuitBreaker()
    minAvgTurnover20: 1e7,
    maxATRPct14Pctl120: 100,
    maxPre10AvgRangeATR: 99,
    maxPre10ExpansionCount: 99,
    expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 99,
    minZoneLen: 0,
    maxZoneLen: 100,
    maxZoneTightnessPct: 100,
    maxPre10AvgVolRatio: 99,
    maxPre5AvgVolRatio: 99,
    maxPre10HighVolCount: 99,
    highVolMultiplier: 1.35,
    maxPre10RedVolBias: 99,
    breakoutMultiplier: 0,
    minExactRangeATR14: 0,
    maxExactRangeATR14: 99,
    minExactVolRatio20: 0,
    minExactVolVsPre5: 0,
    minCloseLoc: 0,
    maxUpperWickPct: 100,
    minBodyPct: 0,
    maxCandleRisk: 100,
    minUltraPrecisionScore: 0,
    minRSI2: 0,
    minVolatilityExpansionRatio: null,
    minCandleQualityScore: null,
    maxCloseAboveZonePct: null
  }
};
var PARAM_SET_OPTIONS = [
  { key: "optimized_deployable_20plus", name: PARAM_SETS.optimized_deployable_20plus.name, tag: PARAM_SETS.optimized_deployable_20plus.tag },
  { key: "optimized_highprecision_15plus", name: PARAM_SETS.optimized_highprecision_15plus.name, tag: PARAM_SETS.optimized_highprecision_15plus.tag },
  { key: "optimized_elite_10plus", name: PARAM_SETS.optimized_elite_10plus.name, tag: PARAM_SETS.optimized_elite_10plus.tag },
  { key: "optimized_ultraselective_8plus", name: PARAM_SETS.optimized_ultraselective_8plus.name, tag: PARAM_SETS.optimized_ultraselective_8plus.tag },
  { key: "sniper_95plus", name: PARAM_SETS.sniper_95plus.name, tag: PARAM_SETS.sniper_95plus.tag },
  { key: "ors_prime_reversal", name: PARAM_SETS.ors_prime_reversal.name, tag: PARAM_SETS.ors_prime_reversal.tag },
  { key: "circuit_breaker_v2", name: PARAM_SETS.circuit_breaker_v2.name, tag: PARAM_SETS.circuit_breaker_v2.tag }
];
function arr_mean(arr) {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}
function safe3(val, fallback = 0) {
  if (!Number.isFinite(val)) return fallback;
  if (val === 0 && 1 / val === -Infinity) return 0;
  if (val > 1e15 || val < -1e15) return 0;
  return val;
}
function computeEMA(candles, period) {
  if (!emaCache.has(candles)) emaCache.set(candles, /* @__PURE__ */ new Map());
  const periodMap = emaCache.get(candles);
  if (periodMap.has(period)) return periodMap.get(period);
  const result = new Array(candles.length).fill(0);
  if (candles.length === 0) return result;
  const k = 2 / (period + 1);
  const seedLen = Math.min(period, candles.length);
  let seed = 0;
  for (let i = 0; i < seedLen; i++) seed += candles[i].c;
  result[seedLen - 1] = seed / seedLen;
  for (let i = seedLen; i < candles.length; i++) {
    result[i] = candles[i].c * k + result[i - 1] * (1 - k);
  }
  periodMap.set(period, result);
  return result;
}
function computeDMI(candles, period = 14) {
  if (dmiCache.has(candles)) return dmiCache.get(candles);
  const n = candles.length;
  const diPlus = new Array(n).fill(0);
  const diMinus = new Array(n).fill(0);
  const adxArr = new Array(n).fill(20);
  if (n < period + 2) {
    dmiCache.set(candles, { diPlus, diMinus, adx: adxArr });
    return { diPlus, diMinus, adx: adxArr };
  }
  const dmP = [0], dmM = [0], trArr = [0];
  for (let i = 1; i < n; i++) {
    const up = candles[i].h - candles[i - 1].h;
    const dn = candles[i - 1].l - candles[i].l;
    dmP.push(up > dn && up > 0 ? up : 0);
    dmM.push(dn > up && dn > 0 ? dn : 0);
    trArr.push(Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    ));
  }
  let sTR = 0, sDMp = 0, sDMm = 0;
  for (let i = 1; i <= period; i++) {
    sTR += trArr[i];
    sDMp += dmP[i];
    sDMm += dmM[i];
  }
  const dxArr = new Array(n).fill(0);
  for (let i = period + 1; i < n; i++) {
    sTR = sTR - sTR / period + trArr[i];
    sDMp = sDMp - sDMp / period + dmP[i];
    sDMm = sDMm - sDMm / period + dmM[i];
    const dp = sTR > 0 ? sDMp / sTR * 100 : 0;
    const dm = sTR > 0 ? sDMm / sTR * 100 : 0;
    diPlus[i] = dp;
    diMinus[i] = dm;
    const diSum = dp + dm;
    dxArr[i] = diSum > 0 ? Math.abs(dp - dm) / diSum * 100 : 0;
  }
  const adxSeed = period * 2;
  if (n > adxSeed + 1) {
    let adxVal = 0;
    for (let i = period + 1; i <= adxSeed; i++) adxVal += dxArr[i];
    adxVal /= period;
    adxArr[adxSeed] = adxVal;
    for (let i = adxSeed + 1; i < n; i++) {
      adxVal = (adxVal * (period - 1) + dxArr[i]) / period;
      adxArr[i] = adxVal;
    }
  }
  const result = { diPlus, diMinus, adx: adxArr };
  dmiCache.set(candles, result);
  return result;
}
function barsSinceDICross(diPlus, diMinus, i, maxLook = 5) {
  for (let k = 0; k <= maxLook; k++) {
    const j = i - k;
    if (j < 1) break;
    if (diPlus[j] > diMinus[j] && diPlus[j - 1] <= diMinus[j - 1]) return k;
  }
  return 99;
}
var ZERO_CANDLE_ARCH = {
  upperWickPct: 0,
  lowerWickPct: 0,
  bodyPct: 0,
  closeLoc: 50,
  uwbr: 0,
  lwbr: 0,
  bodyAtr: 0,
  rangeAtr: 0,
  candleRisk: 0,
  isGreen: false,
  isHammer: false,
  isMarubozu: false,
  qualityTier: 0
};
function computeCandleArch(o, h, l, c, atr14) {
  const range2 = h - l;
  if (range2 <= 0 || c <= 0) return ZERO_CANDLE_ARCH;
  const body2 = Math.abs(c - o);
  const upper = h - Math.max(o, c);
  const lower = Math.min(o, c) - l;
  const bodyPct = body2 / range2 * 100;
  const upperWickPct = upper / range2 * 100;
  const lowerWickPct = lower / range2 * 100;
  const closeLoc = (c - l) / range2 * 100;
  const safeBody = Math.max(body2, range2 * 1e-3);
  const uwbr = upper / safeBody;
  const lwbr = lower / safeBody;
  const bodyAtr = atr14 > 0 ? body2 / atr14 : 0;
  const rangeAtr = atr14 > 0 ? range2 / atr14 : 0;
  const candleRisk = range2 / c * 100;
  let tier = 0;
  if (closeLoc >= 55) tier++;
  if (bodyPct >= 40) tier++;
  if (upperWickPct <= 20) tier++;
  if (lowerWickPct >= 8) tier++;
  return {
    upperWickPct,
    lowerWickPct,
    bodyPct,
    closeLoc,
    uwbr,
    lwbr,
    bodyAtr,
    rangeAtr,
    candleRisk,
    isGreen: c > o,
    isHammer: lowerWickPct >= 2 * bodyPct && closeLoc >= 60,
    isMarubozu: bodyPct >= 85,
    qualityTier: tier
  };
}
function isActionableStage(stage) {
  return stage === "BUY" || stage === "STRONG_BUY" || stage === "ULTRA_STRONG_BUY";
}
var PRACTICAL_TRADE_OVERLAYS = {
  optimized_highprecision_15plus: {
    name: "HighPrecision Practical Sweet Spot",
    minLower: 0.2,
    minLowerBody: 1,
    maxATRPct: 5
  },
  optimized_elite_10plus: {
    name: "Elite Practical Sweet Spot",
    minBody: 0.4,
    minLower: 0.2,
    minRangeATR: 1.6
  },
  optimized_ultraselective_8plus: {
    name: "UltraSelective Practical Sweet Spot",
    minScore: 30,
    maxUpperBody: 0.25,
    minSlope5: 2
  }
};
var WATCHLIST_ONLY_PARAM_SETS = /* @__PURE__ */ new Set([
  // CB rescued 2026-08-14: dualTuner champion Sharpe=2.19, OOS WR=61.3% (maxHold=3, minUC=70, minT1Pct=8%)
  "optimized_ultraselective_8plus"
  // N too low (USB:2, SB:21 OOS) — watch-only until retune
]);
var ARCHETYPE_EXIT_DEFAULTS = {
  optimized_deployable_20plus: { targetPct: 2, slAtrMult: 5, maxHoldBars: 30 },
  // v18: SL 4×→5×, H 20→30 — OOS WR=87.8% PF=1.12 avgPnL=+0.18% (v16: PF=1.04)
  optimized_highprecision_15plus: { targetPct: 3, slAtrMult: 4, maxHoldBars: 15, minUCScore: 55 },
  // v19: TP 2.5→3%, SL 5×→4×, H 30→15, UC≥55 gate — OOS WR=81.7% PF=2.43 (hyper_tune 2026-08-29)
  optimized_elite_10plus: { targetPct: 4, slAtrMult: 4, maxHoldBars: 15 },
  // v17: TP=4%/SL=4×/H≤15 — OOS WR=71% PF=1.43 avgPnL=+0.87% (H≤20 constraint)
  optimized_ultraselective_8plus: { targetPct: 3, slAtrMult: 2.5, maxHoldBars: 15 },
  // v18: TP 1.5→3%, H 12→15 — OOS WR=79.2% PF=3.07 avgPnL=+1.64% ✅ (v16: PF=1.88)
  sniper_95plus: { targetPct: 1.5, slAtrMult: 2.5, maxHoldBars: 8 },
  // v15: unchanged — OOS WR=87.5% PF=2.94 ✅
  circuit_breaker_v2: { targetPct: 1, slAtrMult: 2.5, maxHoldBars: 3 },
  // v15: unchanged — structural ceiling (CB not TP-based archetype)
  ors_prime_reversal: { targetPct: 5, slAtrMult: 2.5, maxHoldBars: 5 }
  // v15: unchanged — OOS WR=84.6% PF=3.76 ✅
};
function archetypeKeyFromHint(archetypeHint) {
  if (archetypeHint === "VF") return "optimized_deployable_20plus";
  if (archetypeHint === "CC") return "optimized_highprecision_15plus";
  if (archetypeHint === "MP") return "optimized_elite_10plus";
  if (archetypeHint === "EMA") return "optimized_ultraselective_8plus";
  if (archetypeHint === "PS") return "sniper_95plus";
  return null;
}
function tunedExit(key, name, fallback) {
  if (!key) return fallback;
  const injected = ARCHETYPE_TUNING[key]?.[name];
  if (typeof injected === "number" && Number.isFinite(injected)) return injected;
  const defaults = ARCHETYPE_EXIT_DEFAULTS[key];
  return defaults ? defaults[name] : fallback;
}
function getArchetypeExitDefaults(key) {
  return ARCHETYPE_EXIT_DEFAULTS[key] ?? null;
}
function evaluatePracticalTradeOverlay(candles, endIdx, result, atr14) {
  const cfg = PRACTICAL_TRADE_OVERLAYS[result.paramSetKey];
  if (!cfg || endIdx < 0 || endIdx >= candles.length) return null;
  const sig = candles[endIdx];
  const ca = computeCandleArch(sig.o, sig.h, sig.l, sig.c, atr14);
  const body2 = ca.bodyPct / 100;
  const lower = ca.lowerWickPct / 100;
  const upper = ca.upperWickPct / 100;
  const rangeATR = result.exactRangeATR14 > 0 ? result.exactRangeATR14 : ca.rangeAtr;
  const atrPct14 = result.atrPct14 > 0 ? result.atrPct14 : sig.c > 0 ? atr14 / sig.c * 100 : 0;
  const score = Math.max(result.inflectionScore || 0, result.ultraPrecisionScore || 0, result.confidence || 0);
  const slope5 = endIdx >= 5 && candles[endIdx - 5].c > 0 ? (sig.c / candles[endIdx - 5].c - 1) * 100 : 0;
  const checks = [];
  if (cfg.minBody != null) checks.push({ label: `Body >= ${(cfg.minBody * 100).toFixed(0)}%`, pass: body2 >= cfg.minBody, value: `${(body2 * 100).toFixed(1)}%` });
  if (cfg.minLower != null) checks.push({ label: `Lower wick >= ${(cfg.minLower * 100).toFixed(0)}%`, pass: lower >= cfg.minLower, value: `${(lower * 100).toFixed(1)}%` });
  if (cfg.minLowerBody != null) checks.push({ label: `Lower/body >= ${cfg.minLowerBody.toFixed(2)}`, pass: ca.lwbr >= cfg.minLowerBody, value: ca.lwbr.toFixed(2) });
  if (cfg.maxATRPct != null) checks.push({ label: `ATR14% <= ${cfg.maxATRPct.toFixed(1)}`, pass: atrPct14 <= cfg.maxATRPct, value: `${atrPct14.toFixed(2)}%` });
  if (cfg.minRangeATR != null) checks.push({ label: `Range/ATR >= ${cfg.minRangeATR.toFixed(1)}`, pass: rangeATR >= cfg.minRangeATR, value: `${rangeATR.toFixed(2)}x` });
  if (cfg.minScore != null) checks.push({ label: `Score >= ${cfg.minScore}`, pass: score >= cfg.minScore, value: score.toFixed(0) });
  if (cfg.maxUpperBody != null) checks.push({ label: `Upper/body <= ${cfg.maxUpperBody.toFixed(2)}`, pass: ca.uwbr <= cfg.maxUpperBody, value: ca.uwbr.toFixed(2) });
  if (cfg.minSlope5 != null) checks.push({ label: `5-bar slope >= ${cfg.minSlope5.toFixed(1)}%`, pass: slope5 >= cfg.minSlope5, value: `${slope5.toFixed(2)}%` });
  const passed = checks.length > 0 && checks.every((c) => c.pass);
  return {
    name: cfg.name,
    passed,
    reason: passed ? "Practical +5% target overlay passed" : checks.filter((c) => !c.pass).map((c) => c.label).join(", "),
    metrics: { body: body2, lower, upper, upperBody: ca.uwbr, lowerBody: ca.lwbr, atrPct14, rangeATR, score, slope5 },
    checks
  };
}
function computeCMF(candles, endIdx, period = 20) {
  const start = Math.max(0, endIdx - period + 1);
  let sumMFV = 0, sumVol = 0;
  for (let i = start; i <= endIdx; i++) {
    const { h, l, c, v } = candles[i];
    const range2 = h - l;
    if (range2 > 0 && v > 0) {
      sumMFV += (c - l - (h - c)) / range2 * v;
      sumVol += v;
    }
  }
  return sumVol > 0 ? safe3(sumMFV / sumVol) : 0;
}
function computeOBVSlope10(candles, endIdx) {
  const start = Math.max(1, endIdx - 10);
  const len = endIdx - start;
  if (len < 3) return 0;
  let obv = 0;
  const obvValues = [];
  const vols = [];
  for (let i = start; i <= endIdx; i++) {
    if (candles[i].c > candles[i - 1].c) obv += candles[i].v;
    else if (candles[i].c < candles[i - 1].c) obv -= candles[i].v;
    obvValues.push(obv);
    vols.push(candles[i].v);
  }
  const n = obvValues.length;
  if (n < 3) return 0;
  const meanVol = arr_mean(vols) || 1;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += obvValues[i];
    sumXY += i * obvValues[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return 0;
  const slope = (n * sumXY - sumX * sumY) / denom;
  return safe3(slope / meanVol);
}
function computeVolDryUpScore(candles, endIdx) {
  const start = Math.max(0, endIdx - 5);
  let score = 0;
  for (let i = start + 1; i < endIdx; i++) {
    if (candles[i].v < candles[i - 1].v) score++;
  }
  return score;
}
function computeATR14(candles) {
  if (atr14Cache.has(candles)) return atr14Cache.get(candles);
  const result = new Array(candles.length).fill(0);
  if (candles.length === 0) return result;
  const trs = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevC = candles[i - 1].c;
    const tr = Math.max(c.h - c.l, Math.abs(c.h - prevC), Math.abs(c.l - prevC));
    trs[i] = tr;
  }
  if (candles.length <= 14) {
    for (let i = 1; i < candles.length; i++) {
      result[i] = trs[i];
    }
    atr14Cache.set(candles, result);
    return result;
  }
  let atrSum = 0;
  for (let i = 1; i <= 14; i++) atrSum += trs[i];
  result[14] = atrSum / 14;
  for (let i = 15; i < candles.length; i++) {
    result[i] = (result[i - 1] * 13 + trs[i]) / 14;
  }
  atr14Cache.set(candles, result);
  return result;
}
function computeRSI(candles, period) {
  if (!rsiCache.has(candles)) rsiCache.set(candles, /* @__PURE__ */ new Map());
  const periodMap = rsiCache.get(candles);
  if (periodMap.has(period)) return periodMap.get(period);
  const needed = period + 20;
  if (candles.length < needed) return 50;
  const slice = candles.slice(candles.length - needed);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = slice[i].c - slice[i - 1].c;
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < slice.length; i++) {
    const diff = slice[i].c - slice[i - 1].c;
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss < 1e-10) return avgGain < 1e-10 ? 50 : 100;
  const rs = avgGain / avgLoss;
  const result = 100 - 100 / (1 + rs);
  periodMap.set(period, result);
  return result;
}
function findCompressionZone(candles, atr14, params, endIdx) {
  let bestZone = null;
  let bestProximity = Infinity;
  let bestTightness = Infinity;
  let bestLength = 0;
  let bestZoneStart = 0;
  const searchStart = Math.max(0, endIdx - 60);
  for (let s = searchStart; s <= endIdx - params.minZoneLen; s++) {
    for (let len = params.maxZoneLen; len >= params.minZoneLen; len--) {
      const end = s + len;
      if (end > endIdx) continue;
      const proximity = endIdx - end;
      if (proximity > 5) continue;
      let valid = true;
      let zoneHigh = -Infinity;
      let zoneLow = Infinity;
      const atrRatios = [];
      for (let i = s; i < end; i++) {
        const atrVal = atr14[i] ?? 1e-4;
        if (atrVal <= 0) {
          valid = false;
          break;
        }
        const rangeATR = (candles[i].h - candles[i].l) / atrVal;
        if (rangeATR > params.zoneRangeATRThreshold) {
          valid = false;
          break;
        }
        atrRatios.push(rangeATR);
        if (candles[i].h > zoneHigh) zoneHigh = candles[i].h;
        if (candles[i].l < zoneLow) zoneLow = candles[i].l;
      }
      if (!valid) continue;
      const zoneATRRatio = arr_mean(atrRatios);
      const zoneTightnessPct = zoneLow > 0 ? (zoneHigh - zoneLow) / zoneLow * 100 : 0;
      const mid = Math.floor(len / 2);
      let fhH = -Infinity, shH = -Infinity, fhL = Infinity, shL = Infinity;
      for (let i = s; i < s + mid; i++) {
        fhH = Math.max(fhH, candles[i].h);
        fhL = Math.min(fhL, candles[i].l);
      }
      for (let i = s + mid; i < end; i++) {
        shH = Math.max(shH, candles[i].h);
        shL = Math.min(shL, candles[i].l);
      }
      const zoneShape = shL > fhL * 1.005 && shH >= fhH * 0.995 ? "ASCENDING" : shH < fhH * 0.995 && shL <= fhL * 1.005 ? "DESCENDING" : "FLAT";
      if (zoneShape === "DESCENDING") continue;
      if (proximity < bestProximity || proximity === bestProximity && zoneTightnessPct < bestTightness || proximity === bestProximity && zoneTightnessPct === bestTightness && len > bestLength) {
        bestProximity = proximity;
        bestTightness = zoneTightnessPct;
        bestLength = len;
        bestZoneStart = s;
        bestZone = {
          zoneHigh,
          zoneLow,
          zoneATRRatio,
          zoneTightnessPct,
          windowLength: len,
          zoneShape,
          zoneStart: s
        };
      }
    }
  }
  return bestZone;
}
var ARCH_ULTRA = {
  CompressionCoil: 84,
  // WR 67.4% @ n=315
  VolumeFootprint: 88,
  // 98→88: score peaks high; 88 = achievable top-tier VF (was 98 = ~0 ULTRA signals)
  MomentumPocket: 85,
  // 99→85: 99 produced ~0 ULTRA; 85 = top-tier MP setup
  EMAStack: 85,
  // 99→85: same rationale; EMA still selective via pre-screen gates
  CircuitBreaker: 72
  // Discovery archetype — lower bar, case-control model not P&L archetype
};
var ARCH_TOTAL = {
  CompressionCoil: 7,
  VolumeFootprint: 6,
  MomentumPocket: 6,
  EMAStack: 6,
  CircuitBreaker: 8
};
function archetypeStage(conditionsMet, score, arch) {
  const total = arch !== void 0 && ARCH_TOTAL[arch] !== void 0 ? ARCH_TOTAL[arch] : 6;
  const ultraT = arch !== void 0 && ARCH_ULTRA[arch] !== void 0 ? ARCH_ULTRA[arch] : 86;
  const pct = total > 0 ? conditionsMet / total : 0;
  const capRank = pct >= 1 ? 4 : pct >= 0.75 ? 3 : pct >= 0.6 ? 2 : pct >= 0.45 ? 1 : pct >= 0.3 ? 0 : -1;
  const scoreRank = score >= ultraT ? 4 : score >= 62 ? 3 : score >= 43 ? 2 : score >= 22 ? 1 : score >= 10 ? 0 : -1;
  const rank = Math.min(capRank, scoreRank);
  return rank >= 4 ? "ULTRA_STRONG_BUY" : rank === 3 ? "STRONG_BUY" : rank === 2 ? "BUY" : rank === 1 ? "PRE_BREAKOUT" : rank === 0 ? "EARLY_INFLECTION" : "COMPRESSION_WATCH";
}
function applyEliteGate(stage, exactVolRatio20, exactRangeATR14, bodyPct, upperWickPct) {
  if (stage !== "ULTRA_STRONG_BUY") return stage;
  const eliteOk = exactVolRatio20 >= 3.5 && exactRangeATR14 >= 2.75 && bodyPct >= 68 && upperWickPct <= 5;
  return eliteOk ? "ULTRA_STRONG_BUY" : "STRONG_BUY";
}
function buildNullPriceEngine() {
  return {
    breakoutLevel: 0,
    plannedEntry: 0,
    gapPct: 0,
    gapATR: 0,
    entryMode: "breakout",
    entryStatus: "normal",
    entryBuffer: 0,
    efficiencyRatio: 0,
    tacticalStop: 0,
    tacticalRiskPct: 0,
    stopWeinstein: 0,
    stopKase: 0,
    stopElder: 0,
    stopSignalLow: 0,
    disasterStop: 0,
    disasterRiskPct: 0,
    riskPerShare: 0,
    target5: 0,
    target7: 0,
    target10: 0,
    target3R: 0,
    t1R: 0,
    t2R: 0,
    t3R_mult: 0,
    rewardRisk: 0,
    chandelierT1: 0,
    chandelierT2: 0,
    chandelierT3: 0,
    failedBreakoutLevel: 0,
    timeStop3d: 0,
    timeStop5d: 0,
    timeStop10d: 0,
    maxHoldBars: 20,
    tradeValid: false,
    hh252: 0,
    pctFrom52W: 0,
    breakoutTier: "B",
    sw5LowAtEntry: 0,
    atr14AtEntry: 0
  };
}
function tick(price) {
  return Math.round(price * 20) / 20;
}
function buildChecklist(params, avgTurnover20, atrPct14Pctl120, pre10AvgRangeATR, pre10ExpansionCount, zone, pre10AvgVolRatio, pre5AvgVolRatio, pre10HighVolCount, pre10RedVolBias, breakoutOk, exactRangeATR14, exactVolRatio20, exactVolVsPre5, closeLoc, upperWickPct, bodyPct, signalRangePct, ultraPrecisionScore, rsi2, liquidityOk, volOk, zoneOk, pre10RangeOk, pre10ExpOk, pre10VolOk, pre5VolOk, pre10HighVolOk, pre10RedBiasOk, exactRangeOk, exactVolOk, exactVolPre5Ok, closeLocOk, wickOk, bodyOk, riskOk, upsOk, rsi2Ok, volExpOk, cqsOk, volatilityExpansionRatio, candleQualityScore, closeAboveZoneOk, closeAboveZonePct, forensicChecklist = []) {
  const fmt = (n, dec = 2) => n.toFixed(dec);
  const fmtM = (n) => (n / 1e6).toFixed(1) + "M";
  return [
    {
      label: `Liquidity \u2265 ${fmtM(params.minAvgTurnover20)}`,
      pass: liquidityOk,
      value: fmtM(avgTurnover20)
    },
    {
      label: `ATR% Pctl \u2264 ${params.maxATRPct14Pctl120}`,
      pass: volOk,
      value: fmt(atrPct14Pctl120, 1)
    },
    {
      label: `Pre-10 AvgRangeATR \u2264 ${params.maxPre10AvgRangeATR}`,
      pass: pre10RangeOk,
      value: fmt(pre10AvgRangeATR)
    },
    {
      label: `Pre-10 Expansion \u2264 ${params.maxPre10ExpansionCount}`,
      pass: pre10ExpOk,
      value: String(pre10ExpansionCount)
    },
    {
      label: `Zone exists + tightness \u2264 ${params.maxZoneTightnessPct}%`,
      pass: zoneOk,
      value: zone ? `${fmt(zone.zoneTightnessPct, 1)}%` : "no zone"
    },
    {
      label: `Zone length \u2265 ${params.minZoneLen}`,
      pass: zoneOk && zone !== null && zone.windowLength >= params.minZoneLen,
      value: zone ? String(zone.windowLength) : "\u2014"
    },
    {
      label: `Pre-10 AvgVolRatio \u2264 ${params.maxPre10AvgVolRatio}`,
      pass: pre10VolOk,
      value: fmt(pre10AvgVolRatio)
    },
    {
      label: `Pre-5 AvgVolRatio \u2264 ${params.maxPre5AvgVolRatio}`,
      pass: pre5VolOk,
      value: fmt(pre5AvgVolRatio)
    },
    {
      label: `Pre-10 HighVol \u2264 ${params.maxPre10HighVolCount}`,
      pass: pre10HighVolOk,
      value: String(pre10HighVolCount)
    },
    {
      label: `Pre-10 RedVolBias \u2264 ${params.maxPre10RedVolBias}`,
      pass: pre10RedBiasOk,
      value: fmt(pre10RedVolBias)
    },
    {
      label: `Breakout (close > zoneHigh\xD7${params.breakoutMultiplier})`,
      pass: breakoutOk,
      value: breakoutOk ? "Yes" : "No"
    },
    ...params.maxCloseAboveZonePct !== null ? [{
      label: `Close above zone \u2264 ${params.maxCloseAboveZonePct}%`,
      pass: closeAboveZoneOk,
      value: zone ? fmt(closeAboveZonePct) + "%" : "\u2014"
    }] : [],
    {
      label: `Range/ATR ${params.minExactRangeATR14}\u2013${params.maxExactRangeATR14}`,
      pass: exactRangeOk,
      value: fmt(exactRangeATR14)
    },
    {
      label: `Vol/20d \u2265 ${params.minExactVolRatio20}`,
      pass: exactVolOk,
      value: fmt(exactVolRatio20)
    },
    {
      label: `Vol/Pre5 \u2265 ${params.minExactVolVsPre5}`,
      pass: exactVolPre5Ok,
      value: fmt(exactVolVsPre5)
    },
    {
      label: `Close Loc \u2265 ${params.minCloseLoc}%`,
      pass: closeLocOk,
      value: `${fmt(closeLoc, 1)}%`
    },
    {
      label: `Upper Wick \u2264 ${params.maxUpperWickPct}%`,
      pass: wickOk,
      value: `${fmt(upperWickPct, 1)}%`
    },
    {
      label: `Body \u2265 ${params.minBodyPct}%`,
      pass: bodyOk,
      value: `${fmt(bodyPct, 1)}%`
    },
    {
      label: `Candle Risk \u2264 ${params.maxCandleRisk}%`,
      pass: riskOk,
      value: `${fmt(signalRangePct, 1)}%`
    },
    {
      label: `UPS \u2265 ${params.minUltraPrecisionScore}`,
      pass: upsOk,
      value: String(Math.round(ultraPrecisionScore))
    },
    {
      label: `RSI(2) \u2265 ${params.minRSI2}`,
      pass: rsi2Ok,
      value: fmt(rsi2, 1)
    },
    ...params.minVolatilityExpansionRatio !== null ? [{
      label: `VolExp \u2265 ${params.minVolatilityExpansionRatio}`,
      pass: volExpOk,
      value: fmt(volatilityExpansionRatio)
    }] : [],
    ...params.minCandleQualityScore !== null ? [{
      label: `CandleQuality \u2265 ${params.minCandleQualityScore}`,
      pass: cqsOk,
      value: String(candleQualityScore)
    }] : [],
    ...forensicChecklist
  ];
}
function computeOrsScore(params) {
  let s = 0;
  if (params.rsi2 <= 3) s += 30;
  else if (params.rsi2 <= 5) s += 25;
  else if (params.rsi2 <= 10) s += 20;
  else if (params.rsi2 <= 15) s += 12;
  if (params.rsi14 <= 30) s += 15;
  else if (params.rsi14 <= 38) s += 10;
  else if (params.rsi14 <= 45) s += 5;
  if (params.rPct >= 5) s += 10;
  else if (params.rPct >= 3.5) s += 7;
  else if (params.rPct >= 2.4) s += 4;
  if (params.distE20 <= -8) s += 10;
  else if (params.distE20 <= -5) s += 7;
  else if (params.distE20 <= -2) s += 4;
  if (params.bodyPct >= 60) s += 8;
  else if (params.bodyPct >= 45) s += 5;
  else if (params.bodyPct >= 35) s += 2;
  if (params.upWick <= 10) s += 7;
  else if (params.upWick <= 20) s += 5;
  else if (params.upWick <= 30) s += 2;
  if (params.isSwLo) s += 5;
  if (params.volDryUp <= 0.7) s += 5;
  else if (params.volDryUp <= 0.85) s += 3;
  if (params.ddFromSwHi >= 30) s += 10;
  else if (params.ddFromSwHi >= 25) s += 8;
  else if (params.ddFromSwHi >= 20) s += 6;
  else if (params.ddFromSwHi >= 15) s += 3;
  if (params.zScore <= -3) s += 12;
  else if (params.zScore <= -2.5) s += 8;
  else if (params.zScore <= -2) s += 5;
  return Math.min(s, 100);
}
var _forensicMode = false;
function analyzeORS(candles) {
  const n = candles.length;
  const noOrs = (stage2 = "NO_SIGNAL", score2 = 0) => ({
    symbol: "",
    stage: stage2,
    inflectionScore: score2,
    confidence: 0,
    paramSetKey: "ors_prime_reversal",
    lastClose: n > 0 ? candles[n - 1].c : 0,
    lastDate: n > 0 ? new Date(candles[n - 1].ts * 1e3).toISOString().slice(0, 10) : "",
    avgTurnover20: 0,
    atrPct14: 0,
    atrPct14Pctl120: 0,
    volRatio20: 0,
    rsi2: 0,
    rsi14: 50,
    zone: null,
    pre10AvgRangeATR: 0,
    pre10ExpansionCount: 0,
    pre10AvgVolRatio: 0,
    pre5AvgVolRatio: 0,
    pre10HighVolCount: 0,
    pre10RedVolBias: 0,
    exactRangeATR14: 0,
    exactVolRatio20: 0,
    exactVolVsPre5: 0,
    closeLoc: 0,
    upperWickPct: 0,
    bodyPct: 0,
    signalRangePct: 0,
    volatilityExpansionRatio: 0,
    ultraPrecisionScore: score2,
    candleQualityScore: 0,
    priceEngine: buildNullPriceEngine(),
    conditionsMet: 0,
    totalConditions: 10,
    checklist: [],
    momentum: { emaAligned: false, ema20: 0, ema50: 0, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: 0, obvSlope10: 0, adx14: 20, adxInRange: true, gapAdjustedRR: 0, momentumScore: 0, rsNifty20: 1 },
    nearBreakoutPct: 99,
    nearBreakout: false,
    nearBreakoutTier: null,
    stats: { volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false, lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false, skewness20: 0, positiveSkew: false, drawdownFrom52WH: 0, pctFrom52WL: 0, sharpe20: 0, entropy10: 0, cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1, ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false, rsi14: 50, cci34: 0, ema10: 0, ema21: 0, ema55: 0, sma200: 0, ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false, guppySpreadPct: 99, guppyCompressed: false, guppyUltraCompressed: false, guppyCompressDays: 0, guppyCleanBullishFan: false, guppyGroupGapPct: 0, guppyCoiledRelease: false, guppySpring: false, guppyPrimed: false, candlePattern: "\u2014", candlePatternFull: "Unknown", candlePatternType: "neutral", candlePatternStrength: 0, statsScore: 0 },
    clusterBreakdown: { deployable: { met: 0, total: 0 }, highPrecision: { met: 0, total: 0 }, elite: { met: 0, total: 0 }, ultraSelective: { met: 0, total: 0 }, sniper: { met: 0, total: 0 }, orsReversal: { met: 0, total: 10, score: score2, confirmed: false } },
    monster: { badges: [], topProbability: 0 },
    dayChangePct: 0,
    candleDNA: { score: 0, upperWickQuality: 0, closeLocationQuality: 0, supportTailQuality: 0, volumeContextScore: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, volumeRatio: 0, springDepth: 0, predecessorScore: 0, tier: "WEAK" },
    orsScore: score2,
    ddFromSwingHigh: 0,
    distFromEMA20: 0,
    zScore252: 0,
    orsConfirmed: false
  });
  const orsParams = PARAM_SETS["ors_prime_reversal"].ors;
  if (n < 260) return noOrs();
  const atr14Arr = computeATR14(candles);
  const ema20Arr = computeEMA(candles, 20);
  const { adx: adxArrORS } = computeDMI(candles);
  const buildWilderRSIArr = (period) => {
    const out = new Array(n).fill(50);
    if (n <= period) return out;
    let ag = 0, al = 0;
    for (let j = 1; j <= period; j++) {
      const d = candles[j].c - candles[j - 1].c;
      if (d > 0) ag += d;
      else al -= d;
    }
    ag /= period;
    al /= period;
    out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let j = period + 1; j < n; j++) {
      const d = candles[j].c - candles[j - 1].c;
      ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
      al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
      out[j] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  };
  const rsi2ArrORS = buildWilderRSIArr(2);
  const rsi14ArrORS = buildWilderRSIArr(14);
  const zScoreAt = (i) => {
    const start = Math.max(0, i - 251);
    let sum = 0, cnt = 0;
    for (let j = start; j <= i; j++) {
      sum += candles[j].c;
      cnt++;
    }
    const mean3 = sum / cnt;
    let varSum = 0;
    for (let j = start; j <= i; j++) {
      const d = candles[j].c - mean3;
      varSum += d * d;
    }
    const std2 = cnt > 1 ? Math.sqrt(varSum / (cnt - 1)) : 0;
    return std2 > 0 ? (candles[i].c - mean3) / std2 : 0;
  };
  const evalCandle = (i) => {
    if (i < 10) return null;
    const c = candles[i];
    const range2 = c.h - c.l;
    if (range2 <= 0 || c.c <= 0) return null;
    let tSum = 0, tCnt = 0;
    for (let j = Math.max(0, i - 20); j < i; j++) {
      tSum += candles[j].c * candles[j].v;
      tCnt++;
    }
    if (!_forensicMode && (tCnt === 0 || tSum / tCnt < 1e7)) return null;
    const tAvg = tSum / tCnt;
    const a142 = atr14Arr[i] || 1e-4;
    const bodyPct2 = Math.abs(c.c - c.o) / range2 * 100;
    const upWick2 = (c.h - Math.max(c.o, c.c)) / range2 * 100;
    const lowerWickPct2 = (Math.min(c.o, c.c) - c.l) / range2 * 100;
    const closeLoc2 = (c.c - c.l) / range2 * 100;
    const rPct2 = range2 / c.c * 100;
    const bodyAtr2 = Math.abs(c.c - c.o) / a142;
    const red = c.c < c.o;
    const rsi22 = rsi2ArrORS[i];
    const rsi142 = rsi14ArrORS[i];
    const e20 = ema20Arr[i];
    const distE202 = e20 > 0 ? (c.c - e20) / e20 * 100 : 0;
    let swHi = -Infinity;
    for (let j = Math.max(0, i - 60); j < i; j++) if (candles[j].h > swHi) swHi = candles[j].h;
    const ddFromSwHi2 = swHi > 0 ? (swHi - c.c) / swHi * 100 : 0;
    let minLo = Infinity;
    for (let j = Math.max(0, i - 6); j < i; j++) if (candles[j].l < minLo) minLo = candles[j].l;
    const isSwLo = c.l <= minLo;
    let v20s = 0, v20c = 0;
    for (let j = Math.max(0, i - 20); j < i; j++) {
      v20s += candles[j].v;
      v20c++;
    }
    const vAvg202 = v20c ? v20s / v20c : 1;
    let v5s = 0, v5c = 0;
    for (let j = Math.max(0, i - 5); j < i; j++) {
      v5s += candles[j].v;
      v5c++;
    }
    const volDryUp = v5c ? v5s / v5c / vAvg202 : 1;
    const zScore2 = zScoreAt(i);
    const score2 = computeOrsScore({ rsi2: rsi22, rsi14: rsi142, rPct: rPct2, distE20: distE202, bodyPct: bodyPct2, upWick: upWick2, isSwLo, volDryUp, ddFromSwHi: ddFromSwHi2, zScore: zScore2 });
    const adxORS2 = adxArrORS[i] ?? 0;
    const passes = (!orsParams.requireRedCandle || red) && rsi22 <= orsParams.maxRSI2 && rsi142 <= orsParams.maxRSI14 && closeLoc2 <= orsParams.maxCloseLoc && bodyPct2 >= orsParams.minBodyPct && upWick2 <= orsParams.maxUpperWickPct && rPct2 >= orsParams.minRangePct && distE202 <= orsParams.maxDistEMA20 && ddFromSwHi2 >= orsParams.minDdSwingHigh && (!orsParams.requireSwingLow || isSwLo) && score2 >= orsParams.minOrsScore && (orsParams.minADX == null || adxORS2 >= orsParams.minADX) && (orsParams.minCloseLoc == null || closeLoc2 >= orsParams.minCloseLoc) && (orsParams.minLowerWickPct == null || lowerWickPct2 >= orsParams.minLowerWickPct) && (orsParams.maxBodyATR == null || bodyAtr2 <= orsParams.maxBodyATR);
    return { passes, score: score2, a14: a142, bodyPct: bodyPct2, upWick: upWick2, lowerWickPct: lowerWickPct2, bodyAtr: bodyAtr2, closeLoc: closeLoc2, rPct: rPct2, rsi2: rsi22, rsi14: rsi142, distE20: distE202, ddFromSwHi: ddFromSwHi2, zScore: zScore2, vAvg20: vAvg202, tAvg, adxORS: adxORS2, c };
  };
  const endIdx = n - 1;
  const sig = candles[endIdx];
  const prevEval = endIdx >= 1 ? evalCandle(endIdx - 1) : null;
  const todayGreen = sig.c > sig.o;
  const confirmed = !!(prevEval?.passes && todayGreen);
  const todayEval = evalCandle(endIdx);
  const primaryEval = confirmed ? prevEval : todayEval;
  if (!primaryEval?.passes) return noOrs();
  const { score, a14, bodyPct, upWick, lowerWickPct, bodyAtr, closeLoc, rPct, rsi2, rsi14, distE20, ddFromSwHi, zScore, vAvg20, adxORS } = primaryEval;
  const entryPrice = confirmed ? sig.o : n > 1 ? candles[n - 1].c : sig.c;
  const sw5LowORS = endIdx >= 4 ? Math.min(...candles.slice(endIdx - 4, endIdx + 1).map((b) => b.l)) : 0;
  const sw10LowORS = endIdx >= 9 ? Math.min(...candles.slice(endIdx - 9, endIdx + 1).map((b) => b.l)) : sw5LowORS;
  const wyckoffORS = computeWyckoffStop(candles, endIdx, sw10LowORS, a14);
  const pe = archetypePriceEngine(entryPrice, a14, sw5LowORS, "ORS", wyckoffORS);
  const btTechORS = archetypeTech(candles, endIdx);
  pe.breakoutTier = computeBreakoutTier(candles, endIdx, btTechORS, null);
  const target4pct = pe.target5;
  const rrRatio = pe.rewardRisk;
  const stage = confirmed ? score >= 80 ? "ULTRA_STRONG_BUY" : "STRONG_BUY" : score >= 78 ? "STRONG_BUY" : "BUY";
  const checklist = [
    { label: `RSI(2) \u2264 ${orsParams.maxRSI2} (oversold)`, pass: rsi2 <= orsParams.maxRSI2, value: rsi2.toFixed(1) },
    { label: `RSI(14) \u2264 ${orsParams.maxRSI14}`, pass: rsi14 <= orsParams.maxRSI14, value: rsi14.toFixed(1) },
    { label: `Body \u2265 ${orsParams.minBodyPct}%`, pass: bodyPct >= orsParams.minBodyPct, value: bodyPct.toFixed(1) + "%" },
    { label: `Upper wick \u2264 ${orsParams.maxUpperWickPct}%`, pass: upWick <= orsParams.maxUpperWickPct, value: upWick.toFixed(1) + "%" },
    ...orsParams.minLowerWickPct != null ? [{ label: `Lower wick \u2265 ${orsParams.minLowerWickPct}% (demand absorption)`, pass: lowerWickPct >= orsParams.minLowerWickPct, value: lowerWickPct.toFixed(1) + "%" }] : [],
    ...orsParams.maxBodyATR != null ? [{ label: `Body \u2264 ${orsParams.maxBodyATR}\xD7ATR (not over-extended)`, pass: bodyAtr <= orsParams.maxBodyATR, value: bodyAtr.toFixed(2) + "\xD7" }] : [],
    { label: `Range/Close \u2265 ${orsParams.minRangePct}%`, pass: rPct >= orsParams.minRangePct, value: rPct.toFixed(2) + "%" },
    { label: `EMA20 dist \u2264 ${orsParams.maxDistEMA20}%`, pass: distE20 <= orsParams.maxDistEMA20, value: distE20.toFixed(2) + "%" },
    { label: `60d drawdown \u2265 ${orsParams.minDdSwingHigh}%`, pass: ddFromSwHi >= orsParams.minDdSwingHigh, value: ddFromSwHi.toFixed(1) + "%" },
    { label: `ORS score \u2265 ${orsParams.minOrsScore}`, pass: score >= orsParams.minOrsScore, value: score.toString() },
    ...orsParams.minADX != null ? [{ label: `ADX \u2265 ${orsParams.minADX} (trending regime)`, pass: (adxORS ?? 0) >= orsParams.minADX, value: (adxORS ?? 0).toFixed(0) }] : [],
    { label: "Green confirmation candle", pass: confirmed, value: confirmed ? "CONFIRMED \u2713" : "PENDING" }
  ];
  return {
    symbol: "",
    stage,
    inflectionScore: score,
    confidence: score / 100 * 100,
    paramSetKey: "ors_prime_reversal",
    lastClose: sig.c,
    lastDate: new Date(sig.ts * 1e3).toISOString().slice(0, 10),
    avgTurnover20: todayEval?.tAvg ?? 0,
    atrPct14: a14 / sig.c * 100,
    atrPct14Pctl120: 0,
    volRatio20: sig.v / (vAvg20 || 1),
    rsi2,
    rsi14,
    zone: null,
    pre10AvgRangeATR: 0,
    pre10ExpansionCount: 0,
    pre10AvgVolRatio: 0,
    pre5AvgVolRatio: 0,
    pre10HighVolCount: 0,
    pre10RedVolBias: 0,
    exactRangeATR14: (sig.h - sig.l) / a14,
    exactVolRatio20: sig.v / (vAvg20 || 1),
    exactVolVsPre5: 0,
    closeLoc,
    upperWickPct: upWick,
    bodyPct,
    signalRangePct: rPct,
    volatilityExpansionRatio: 0,
    ultraPrecisionScore: score,
    candleQualityScore: 0,
    priceEngine: pe,
    conditionsMet: checklist.filter((c) => c.pass).length,
    totalConditions: checklist.length,
    checklist,
    momentum: { emaAligned: false, ema20: ema20Arr[endIdx] ?? 0, ema50: 0, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: 0, obvSlope10: 0, adx14: 20, adxInRange: true, gapAdjustedRR: rrRatio, momentumScore: 0, rsNifty20: 1 },
    nearBreakoutPct: 99,
    nearBreakout: false,
    nearBreakoutTier: null,
    stats: { volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false, lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false, skewness20: 0, positiveSkew: false, drawdownFrom52WH: ddFromSwHi, pctFrom52WL: 0, sharpe20: 0, entropy10: 0, cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1, ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false, rsi14, cci34: 0, ema10: 0, ema21: 0, ema55: 0, sma200: 0, ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false, guppySpreadPct: 99, guppyCompressed: false, guppyUltraCompressed: false, guppyCompressDays: 0, guppyCleanBullishFan: false, guppyGroupGapPct: 0, guppyCoiledRelease: false, guppySpring: false, guppyPrimed: false, candlePattern: "\u2014", candlePatternFull: "ORS Signal", candlePatternType: "bullish", candlePatternStrength: score, statsScore: score },
    clusterBreakdown: { deployable: { met: 0, total: 0 }, highPrecision: { met: 0, total: 0 }, elite: { met: 0, total: 0 }, ultraSelective: { met: 0, total: 0 }, sniper: { met: 0, total: 0 }, orsReversal: { met: checklist.filter((c) => c.pass).length, total: checklist.length, score, confirmed } },
    monster: { badges: [{ type: "MRV", probability: score / 100, details: `ORS-Prime score ${score} \u2014 ${confirmed ? "ENTRY CONFIRMED" : "watch for green confirm"}` }], topProbability: score / 100 },
    dayChangePct: n > 1 ? (sig.c - candles[n - 2].c) / candles[n - 2].c * 100 : 0,
    candleDNA: detectCandleDNA(candles, endIdx, a14),
    orsScore: score,
    ddFromSwingHigh: ddFromSwHi,
    distFromEMA20: distE20,
    zScore252: zScore,
    orsConfirmed: confirmed
  };
}
function computeSelfAdaptiveTrend(candles, atrLength = 10, fallbackFactor = 3, quantilePct = 85, sampleLength = 150, minSamples = 25, factorSmoothing = 5, minFactor = 0.75, maxFactor = 6) {
  const NONE = {
    trend: 0,
    signal: "NONE",
    superTrend: 0,
    bullishFactor: fallbackFactor,
    bearishFactor: fallbackFactor,
    bullishConfidence: 0,
    bearishConfidence: 0,
    bullishSamples: 0,
    bearishSamples: 0,
    lastClose: 0,
    distancePct: 0
  };
  const n = candles.length;
  if (n < Math.max(atrLength * 2, 30)) return NONE;
  const trArr = [];
  for (let i = 1; i < n; i++) {
    const c = candles[i], p = candles[i - 1];
    trArr.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const alpha = 1 / atrLength;
  const atrArr2 = [trArr[0]];
  for (let i = 1; i < trArr.length; i++) {
    atrArr2.push(alpha * trArr[i] + (1 - alpha) * atrArr2[i - 1]);
  }
  const bounceSmaArr = [];
  for (let i = 0; i < trArr.length; i++) {
    const start = Math.max(0, i - atrLength + 1);
    let s = 0;
    for (let j = start; j <= i; j++) s += trArr[j];
    bounceSmaArr.push(s / (i - start + 1));
  }
  const arrayQuantile = (arr, pct) => {
    if (arr.length === 0) return NaN;
    const sorted = [...arr].sort((a, b) => a - b);
    const rank = pct / 100 * (sorted.length - 1);
    const lo = Math.floor(rank), hi = Math.ceil(rank);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
  };
  const ema = (series, period) => {
    const k = 2 / (period + 1);
    const out = [series[0]];
    for (let i = 1; i < series.length; i++) out.push(series[i] * k + out[i - 1] * (1 - k));
    return out;
  };
  const bullishSampleBuffer = [];
  const bearishSampleBuffer = [];
  const startIdx = 1;
  let lowerBand = NaN, upperBand = NaN;
  let trend = 0;
  let trendExtreme = NaN;
  const bullishFactorTargets = [];
  const bearishFactorTargets = [];
  let _bullEMA = NaN, _bearEMA = NaN;
  const _kFact = 2 / (factorSmoothing + 1);
  let lastSignal = "NONE";
  let lastTrend = 0;
  let lastSuperTrend = NaN;
  for (let i = startIdx; i < n; i++) {
    const atrIdx = i - 1;
    const atr = atrArr2[atrIdx];
    if (!atr || atr <= 0) continue;
    const bounceBw = bounceSmaArr[atrIdx];
    const c = candles[i];
    const prevClose = candles[i - 1].c;
    const src = (c.h + c.l) / 2;
    const bullQ = bullishSampleBuffer.length > 0 ? arrayQuantile(bullishSampleBuffer, quantilePct) : fallbackFactor;
    const bearQ = bearishSampleBuffer.length > 0 ? arrayQuantile(bearishSampleBuffer, quantilePct) : fallbackFactor;
    const bullConf = Math.min(bullishSampleBuffer.length / Math.max(1, minSamples), 1);
    const bearConf = Math.min(bearishSampleBuffer.length / Math.max(1, minSamples), 1);
    const boundedBullQ = Math.max(minFactor, Math.min(maxFactor, isNaN(bullQ) ? fallbackFactor : bullQ));
    const boundedBearQ = Math.max(minFactor, Math.min(maxFactor, isNaN(bearQ) ? fallbackFactor : bearQ));
    const bullTarget = fallbackFactor * (1 - bullConf) + boundedBullQ * bullConf;
    const bearTarget = fallbackFactor * (1 - bearConf) + boundedBearQ * bearConf;
    bullishFactorTargets.push(bullTarget);
    bearishFactorTargets.push(bearTarget);
    _bullEMA = isNaN(_bullEMA) ? bullTarget : _kFact * bullTarget + (1 - _kFact) * _bullEMA;
    _bearEMA = isNaN(_bearEMA) ? bearTarget : _kFact * bearTarget + (1 - _kFact) * _bearEMA;
    const bullFactor = _bullEMA;
    const bearFactor = _bearEMA;
    const rawLower = src - bullFactor * atr;
    const rawUpper = src + bearFactor * atr;
    const prevLower = lowerBand;
    const prevUpper = upperBand;
    lowerBand = isNaN(prevLower) ? rawLower : rawLower > prevLower || prevClose < prevLower ? rawLower : prevLower;
    upperBand = isNaN(prevUpper) ? rawUpper : rawUpper < prevUpper || prevClose > prevUpper ? rawUpper : prevUpper;
    const prevTrend = trend;
    if (trend === 0) {
      trend = c.c >= src ? 1 : -1;
    } else if (prevTrend === 1) {
      trend = c.c < lowerBand ? -1 : 1;
    } else {
      trend = c.c > upperBand ? 1 : -1;
    }
    const superTrendVal = trend === 1 ? lowerBand : upperBand;
    const bullishShift = trend === 1 && prevTrend === -1;
    const bearishShift = trend === -1 && prevTrend === 1;
    const bullBounceLine = trend === 1 && !isNaN(bounceBw) ? Math.max(superTrendVal, Math.min(superTrendVal + bounceBw, src)) : NaN;
    const bearBounceLine = trend === -1 && !isNaN(bounceBw) ? Math.min(superTrendVal, Math.max(superTrendVal - bounceBw, src)) : NaN;
    lastSignal = bullishShift ? "BUY" : bearishShift ? "SELL" : trend === 1 ? "UP" : "DOWN";
    if (trend !== prevTrend || isNaN(trendExtreme)) {
      trendExtreme = trend === 1 ? c.h : c.l;
    } else {
      trendExtreme = trend === 1 ? Math.max(trendExtreme, c.h) : Math.min(trendExtreme, c.l);
    }
    const bullAE = trend === 1 ? Math.max(trendExtreme - c.l, 0) / atr : NaN;
    const bearAE = trend === -1 ? Math.max(c.h - trendExtreme, 0) / atr : NaN;
    const confirmedBull = trend === 1 && prevTrend === 1 && i < n - 1;
    const confirmedBear = trend === -1 && prevTrend === -1 && i < n - 1;
    if (confirmedBull && !isNaN(bullAE)) {
      bullishSampleBuffer.push(bullAE);
      if (bullishSampleBuffer.length > sampleLength) bullishSampleBuffer.shift();
    }
    if (confirmedBear && !isNaN(bearAE)) {
      bearishSampleBuffer.push(bearAE);
      if (bearishSampleBuffer.length > sampleLength) bearishSampleBuffer.shift();
    }
    lastTrend = trend;
    lastSuperTrend = superTrendVal;
  }
  const endIdx = n - 1;
  const lastC = candles[endIdx];
  const lastSrc = (lastC.h + lastC.l) / 2;
  if (endIdx >= 2 && lastSignal !== "BUY" && lastSignal !== "SELL") {
    const atrFinal = atrArr2[endIdx - 1] || 0.01;
    const bounceFinal = bounceSmaArr[endIdx - 1] || atrFinal;
    if (lastTrend === 1) {
      const bounceLine = Math.max(lastSuperTrend, Math.min(lastSuperTrend + bounceFinal, lastSrc));
      if (lastC.c > bounceLine && candles[endIdx - 1].c <= bounceLine) lastSignal = "BOUNCE_UP";
    } else if (lastTrend === -1) {
      const bounceLine = Math.min(lastSuperTrend, Math.max(lastSuperTrend - bounceFinal, lastSrc));
      if (lastC.c < bounceLine && candles[endIdx - 1].c >= bounceLine) lastSignal = "BOUNCE_DOWN";
    }
  }
  const finalAtr = atrArr2[endIdx - 1] || 0.01;
  const distancePct = lastSuperTrend > 0 ? Math.abs(lastC.c - lastSuperTrend) / lastC.c * 100 : 0;
  const bullFactorFinal = isNaN(_bullEMA) ? fallbackFactor : _bullEMA;
  const bearFactorFinal = isNaN(_bearEMA) ? fallbackFactor : _bearEMA;
  return {
    trend: lastTrend,
    signal: lastSignal,
    superTrend: lastSuperTrend,
    bullishFactor: bullFactorFinal,
    bearishFactor: bearFactorFinal,
    bullishConfidence: Math.min(bullishSampleBuffer.length / Math.max(1, minSamples), 1),
    bearishConfidence: Math.min(bearishSampleBuffer.length / Math.max(1, minSamples), 1),
    bullishSamples: bullishSampleBuffer.length,
    bearishSamples: bearishSampleBuffer.length,
    lastClose: lastC.c,
    distancePct
  };
}
var ARCHETYPE_TUNING = {};
function setArchetypeTuning(key, values) {
  if (values == null) delete ARCHETYPE_TUNING[key];
  else ARCHETYPE_TUNING[key] = values;
}
function tuned(key, name, fallback) {
  const value = ARCHETYPE_TUNING[key]?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function tunedBool(key, name, fallback) {
  const value = ARCHETYPE_TUNING[key]?.[name];
  return typeof value === "boolean" ? value : fallback;
}
function attachTuningDebug(result, debug) {
  Object.defineProperty(result, "__tuning", { value: debug, enumerable: false, configurable: true });
  return result;
}
function archetypeTech(candles, endIdx) {
  const ema10 = computeEMA(candles, 10)[endIdx] ?? 0;
  const ema20 = computeEMA(candles, 20)[endIdx] ?? 0;
  const ema50 = computeEMA(candles, 50)[endIdx] ?? 0;
  const close = candles[endIdx]?.c ?? 0;
  const atr14 = computeATR14(candles)[endIdx] ?? 0;
  return {
    cmf20: computeCMF(candles, endIdx, 20),
    obvSlope10: computeOBVSlope10(candles, endIdx),
    rsi14: computeRSI(candles, 14),
    rsi2: computeRSI(candles, 2),
    ema10Vs20: ema20 > 0 ? (ema10 - ema20) / ema20 * 100 : 0,
    ema20Vs50: ema50 > 0 ? (ema20 - ema50) / ema50 * 100 : 0,
    closeVsEMA20: ema20 > 0 ? (close - ema20) / ema20 * 100 : 0,
    closeVsEMA50: ema50 > 0 ? (close - ema50) / ema50 * 100 : 0,
    atrPct14: close > 0 ? atr14 / close * 100 : 0
  };
}
function computeBreakoutTier(candles, endIdx, tech, zoneTightPct) {
  const N_BT = Math.min(303, endIdx);
  let hh = 0;
  for (let i = endIdx - N_BT; i < endIdx; i++) {
    if (candles[i].h > hh) hh = candles[i].h;
  }
  const price = candles[endIdx]?.c ?? 0;
  const pctFrom52W = hh > 0 && price > 0 ? Math.max(0, (hh - price) / price * 100) : 100;
  if (pctFrom52W > 25) return "B";
  const zoneOk = zoneTightPct === null || zoneTightPct <= 15;
  if (pctFrom52W <= 10 && zoneOk) {
    const emaOk = tech.ema20Vs50 > 0;
    const rsiOk = tech.rsi14 > 50;
    const cmfOk = tech.cmf20 > 0;
    const rVol = endIdx >= 3 ? (candles[endIdx - 1].v + candles[endIdx - 2].v + candles[endIdx - 3].v) / 3 : 0;
    const pVol = endIdx >= 6 ? (candles[endIdx - 4].v + candles[endIdx - 5].v + candles[endIdx - 6].v) / 3 : rVol + 1;
    if (emaOk && rsiOk && cmfOk && rVol < pVol) return "A+";
  }
  return "A";
}
function archetypeBase(candles, key) {
  const n = candles.length;
  const sig = n > 0 ? candles[n - 1] : { c: 0, h: 0, l: 0, o: 0, v: 0, ts: 0 };
  return {
    symbol: "",
    stage: "NO_SIGNAL",
    inflectionScore: 0,
    confidence: 0,
    paramSetKey: key,
    lastClose: sig.c,
    lastDate: n > 0 ? new Date(sig.ts * 1e3).toISOString().slice(0, 10) : "",
    avgTurnover20: 0,
    atrPct14: 0,
    atrPct14Pctl120: 0,
    volRatio20: 0,
    rsi2: 50,
    rsi14: 50,
    zone: null,
    pre10AvgRangeATR: 0,
    pre10ExpansionCount: 0,
    pre10AvgVolRatio: 0,
    pre5AvgVolRatio: 0,
    pre10HighVolCount: 0,
    pre10RedVolBias: 0,
    exactRangeATR14: 0,
    exactVolRatio20: 0,
    exactVolVsPre5: 0,
    closeLoc: 0,
    upperWickPct: 0,
    bodyPct: 0,
    signalRangePct: 0,
    volatilityExpansionRatio: 0,
    ultraPrecisionScore: 0,
    candleQualityScore: 0,
    priceEngine: buildNullPriceEngine(),
    conditionsMet: 0,
    totalConditions: 5,
    checklist: [],
    momentum: { emaAligned: false, ema20: 0, ema50: 0, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: 0, obvSlope10: 0, adx14: 20, adxInRange: true, gapAdjustedRR: 0, momentumScore: 0, rsNifty20: 1 },
    nearBreakoutPct: 99,
    nearBreakout: false,
    nearBreakoutTier: null,
    stats: { volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false, lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false, skewness20: 0, positiveSkew: false, drawdownFrom52WH: 0, pctFrom52WL: 0, sharpe20: 0, entropy10: 0, cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1, ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false, rsi14: 50, cci34: 0, ema10: 0, ema21: 0, ema55: 0, sma200: 0, ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false, guppySpreadPct: 99, guppyCompressed: false, guppyUltraCompressed: false, guppyCompressDays: 0, guppyCleanBullishFan: false, guppyGroupGapPct: 0, guppyCoiledRelease: false, guppySpring: false, guppyPrimed: false, candlePattern: "\u2014", candlePatternFull: "Unknown", candlePatternType: "neutral", candlePatternStrength: 0, statsScore: 0 },
    clusterBreakdown: { deployable: { met: 0, total: 0 }, highPrecision: { met: 0, total: 0 }, elite: { met: 0, total: 0 }, ultraSelective: { met: 0, total: 0 }, sniper: { met: 0, total: 0 } },
    monster: { badges: [], topProbability: 0 },
    dayChangePct: n > 1 ? (sig.c - candles[n - 2].c) / candles[n - 2].c * 100 : 0,
    candleDNA: { score: 0, upperWickQuality: 0, closeLocationQuality: 0, supportTailQuality: 0, volumeContextScore: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, volumeRatio: 0, springDepth: 0, predecessorScore: 0, tier: "WEAK" },
    archetypeType: "Breakout"
  };
}
function computeWyckoffStop(candles, endIdx, sw10Low, atr14) {
  if (sw10Low <= 0 || atr14 <= 0) return 0;
  let springLow = 0;
  for (let k = Math.max(0, endIdx - 5); k <= endIdx; k++) {
    const b = candles[k];
    if (b.l < sw10Low && b.c > sw10Low * 0.998) {
      if (springLow === 0 || b.l < springLow) springLow = b.l;
    }
  }
  return springLow > 0 ? tick(springLow * 0.997) : tick(sw10Low - 0.75 * atr14);
}
function archetypePriceEngine(entry, atr14, sw5Low = 0, archetypeHint = "", wyckoffStop = 0) {
  const atrPct = entry > 0 ? atr14 / entry * 100 : 2;
  const tuneKey = archetypeKeyFromHint(archetypeHint);
  const isHigh = atrPct >= 3.5;
  const isCB = archetypeHint === "CB";
  const defaultAtrMult = isHigh ? isCB ? 2.5 : 2 : 3;
  const atrMult = tunedExit(tuneKey, "slAtrMult", defaultAtrMult);
  const isOrsOrVf = archetypeHint === "ORS" || archetypeHint === "VF";
  const capPct = archetypeHint === "ORS" ? 8 : archetypeHint === "VF" ? 9 : archetypeHint === "PS" ? 20 : atrPct < 1.5 ? 6 : atrPct < 2.5 ? 4 : atrPct < 3.5 ? isCB ? 8 : 5.5 : isOrsOrVf ? 4 : 12.5;
  const isMP = archetypeHint === "MP";
  const floorPct = isMP ? atrPct < 2.5 ? 3 : atrPct < 3.5 ? 3.5 : 2 : 2;
  const atrStop = entry - atrMult * atr14;
  const structStop = wyckoffStop > 0 ? wyckoffStop : sw5Low > 0 ? sw5Low * 0.997 : atrStop;
  const rawStop = tick(Math.max(0, Math.min(atrStop, structStop)));
  const floorStop = tick(entry * (1 - floorPct / 100));
  const capStop = tick(entry * (1 - capPct / 100));
  const stop = Math.min(floorStop, Math.max(capStop, rawStop));
  const riskAbs = Math.max(entry * 0.01, entry - stop);
  const riskPct = entry > 0 ? riskAbs / entry * 100 : 2;
  const isORS = archetypeHint === "ORS";
  const isVF = archetypeHint === "VF";
  const isCC = archetypeHint === "CC";
  const isPS = archetypeHint === "PS";
  const t1Mult = isMP ? isHigh ? 1.1 : 1.6 : isORS ? 0.75 : isPS ? 0.75 : isCC ? 0.65 : isVF ? 0.85 : 0.75;
  const t2Mult = isMP ? t1Mult * (5 / 3) : isORS ? 1.25 : isVF ? 3.3 : isPS ? 2.8 : isCC ? 3.75 : 4;
  const t3Mult = isMP ? t1Mult * (10 / 3) : isORS ? 3.75 : isVF ? 6.5 : isPS ? 5.5 : isCC ? 7.5 : 7.5;
  const fixedTargetPct = tunedExit(tuneKey, "targetPct", 0);
  const t5 = fixedTargetPct > 0 ? tick(entry * (1 + fixedTargetPct / 100)) : tick(entry * (1 + t1Mult * atrPct / 100));
  const t7 = fixedTargetPct > 0 ? tick(entry * (1 + fixedTargetPct * 1.5 / 100)) : tick(entry * (1 + t2Mult * atrPct / 100));
  const t10 = fixedTargetPct > 0 ? tick(entry * (1 + fixedTargetPct * 2 / 100)) : tick(Math.max(entry * (1 + t3Mult * atrPct / 100), t7 + 0.05));
  const rewardRisk = riskAbs > 0 ? (t10 - entry) / riskAbs : 0;
  const disasterStop = tick(entry * (1 - (capPct + 1) / 100));
  const defaultMaxHoldBars = isMP ? atrPct < 1.5 ? 20 : 25 : isCB ? 10 : archetypeHint === "ORS" ? 12 : archetypeHint === "EMA" ? 10 : archetypeHint === "CC" ? 18 : 20;
  const maxHoldBars = Math.max(1, Math.min(60, Math.round(tunedExit(tuneKey, "maxHoldBars", defaultMaxHoldBars))));
  return {
    ...buildNullPriceEngine(),
    plannedEntry: tick(entry),
    tacticalStop: stop,
    tacticalRiskPct: riskPct,
    riskPerShare: riskAbs,
    disasterStop,
    disasterRiskPct: capPct + 1,
    target5: t5,
    target7: t7,
    target10: t10,
    target3R: tick(entry + 3 * riskAbs),
    rewardRisk,
    maxHoldBars,
    // VF atrPct<3.6 gate: low-ATR signals fail R:R at 9% cap (sweep 2026-08-01, n=22 dropped → SL drops to 20%)
    tradeValid: stop > 0 && stop < entry && rewardRisk >= 1 && (archetypeHint !== "VF" || atrPct >= 3.6),
    sw5LowAtEntry: sw5Low,
    atr14AtEntry: atr14
  };
}
function analyzeVolumeFootprint(candles) {
  const key = "optimized_deployable_20plus";
  const base = archetypeBase(candles, key);
  const n = candles.length;
  if (n < 30) return base;
  const endIdx = n - 1;
  const sig = candles[endIdx];
  if (sig.c <= 0) return base;
  const atr14Arr = computeATR14(candles);
  const atr14 = atr14Arr[endIdx] || sig.c * 0.02;
  let vSum = 0, tSum = 0;
  const vStart = Math.max(0, endIdx - 20);
  for (let i = vStart; i < endIdx; i++) {
    vSum += candles[i].v;
    tSum += candles[i].c * candles[i].v;
  }
  const volCnt = endIdx - vStart;
  if (volCnt < 5) return base;
  const vAvg20 = vSum / volCnt;
  const turnover20 = tSum / volCnt;
  if (!_forensicMode && turnover20 < 5e6) return base;
  const volRatio20 = vAvg20 > 0 ? sig.v / vAvg20 : 0;
  let hi20 = 0;
  for (let i = Math.max(0, endIdx - 20); i < endIdx; i++) if (candles[i].h > hi20) hi20 = candles[i].h;
  const sigRange = sig.h - sig.l;
  const closeLoc = sigRange > 0 ? (sig.c - sig.l) / sigRange * 100 : 50;
  const bodyPct = sigRange > 0 ? Math.abs(sig.c - sig.o) / sigRange * 100 : 0;
  const upperWickPct = sigRange > 0 ? (sig.h - Math.max(sig.o, sig.c)) / sigRange * 100 : 0;
  const exactRangeATR14 = sigRange / (atr14 || 1e-4);
  const signalRangePct = sig.c > 0 ? sigRange / sig.c * 100 : 0;
  const ca = computeCandleArch(sig.o, sig.h, sig.l, sig.c, atr14);
  if (!ca.isGreen || ca.candleRisk > tuned(key, "maxCandleRisk", 8)) return { ...base, conditionsMet: 0, totalConditions: 6, exactVolRatio20: volRatio20, closeLoc, exactRangeATR14, archetypeType: "VolumeFootprint", archetypeConditions: 0, archetypeTotal: 6 };
  const tech = archetypeTech(candles, endIdx);
  if (!_forensicMode && (tech.cmf20 < tuned(key, "minCMF20", 0.2) || tech.obvSlope10 < tuned(key, "minOBVSlope10", 0.5) || tech.atrPct14 < tuned(key, "minAtrPct14", 3) || tech.atrPct14 > tuned(key, "maxAtrPct14", 99) || tech.closeVsEMA20 < tuned(key, "minCloseVsEMA20", 0.5) || tech.ema20Vs50 < tuned(key, "minEMA20VsEMA50", 1)))
    return { ...base, conditionsMet: 0, totalConditions: 6, exactVolRatio20: volRatio20, closeLoc, exactRangeATR14, archetypeType: "VolumeFootprint", archetypeConditions: 0, archetypeTotal: 6 };
  let rSum = 0;
  const rStart = Math.max(0, endIdx - 10);
  for (let i = rStart; i < endIdx; i++) rSum += (candles[i].h - candles[i].l) / (atr14Arr[i] || 1e-4);
  const pre10AvgRangeATR = endIdx - rStart > 0 ? rSum / (endIdx - rStart) : 1;
  const prevClose = endIdx > 0 ? candles[endIdx - 1].c : sig.o;
  const noGapDown = sig.o >= prevClose * 0.98;
  const { diPlus: diPlusArr, diMinus: diMinusArr, adx: adxArr } = computeDMI(candles);
  const diPlusV = diPlusArr[endIdx];
  const diMinusV = diMinusArr[endIdx];
  const adxVal = adxArr[endIdx];
  const bsc = barsSinceDICross(diPlusArr, diMinusArr, endIdx, 5);
  const c1 = volRatio20 >= tuned(key, "minVolRatio", 3.5);
  const c2 = closeLoc >= tuned(key, "minCloseLoc", 75) && ca.upperWickPct <= tuned(key, "maxUpperWick", 25);
  const c3 = hi20 > 0 && sig.c >= hi20 * tuned(key, "minHi20Frac", 0.88);
  const c4 = exactRangeATR14 >= tuned(key, "minRangeATR", 1.5);
  const c5 = sig.o >= prevClose * (1 + tuned(key, "maxGapDownPct", 0) / 100);
  const c6 = (!tunedBool(key, "requireDIBull", false) || diPlusV > diMinusV) && (tuned(key, "maxBsc", 3) >= 99 || bsc <= tuned(key, "maxBsc", 3)) && adxVal >= tuned(key, "minADX", 25);
  const passed = [c1, c2, c3, c4, c5, c6];
  const conditionsMet = passed.filter(Boolean).length;
  const tuning = { ...tech, volRatio20, closeLoc, upperWickPct: ca.upperWickPct, hi20Frac: hi20 > 0 ? sig.c / hi20 : 0, rangeATR: exactRangeATR14, gapDownPct: prevClose > 0 ? (sig.o / prevClose - 1) * 100 : 0, candleRisk: ca.candleRisk, diBull: diPlusV > diMinusV, bsc, adx: adxVal, conditions: passed.map(Boolean) };
  if (conditionsMet < 1) return attachTuningDebug({ ...base, conditionsMet, totalConditions: 6, exactVolRatio20: volRatio20, closeLoc, exactRangeATR14, archetypeType: "VolumeFootprint", archetypeConditions: conditionsMet, archetypeTotal: 6 }, tuning);
  const score = Math.min(100, Math.round(
    (c1 ? 43 : 0) + (c2 ? 3 : 0) + (c3 ? 3 : 0) + (c4 ? 21 : 0) + (c5 ? 3 : 0) + (c6 ? 18 : 0) + Math.min(10, (volRatio20 - 3) * 5) + Math.min(5, (closeLoc - 68) * 0.3)
  ));
  const stage = applyEliteGate(archetypeStage(conditionsMet, score, "VolumeFootprint"), volRatio20, exactRangeATR14, bodyPct, upperWickPct);
  const rsi2 = computeRSI(candles, 2);
  const rsi14 = computeRSI(candles, 14);
  const ema20 = computeEMA(candles, 20)[endIdx] ?? 0;
  const ema50 = computeEMA(candles, 50)[endIdx] ?? 0;
  const sw5Low = endIdx >= 4 ? Math.min(...candles.slice(endIdx - 4, endIdx + 1).map((b) => b.l)) : 0;
  const sw10Low = endIdx >= 9 ? Math.min(...candles.slice(endIdx - 9, endIdx + 1).map((b) => b.l)) : sw5Low;
  const wyckoffStop = computeWyckoffStop(candles, endIdx, sw10Low, atr14);
  const pe = archetypePriceEngine(sig.c, atr14, sw5Low, "VF", wyckoffStop);
  pe.breakoutTier = computeBreakoutTier(candles, endIdx, tech, null);
  const candleDNA = detectCandleDNA(candles, endIdx, atr14);
  const checklist = [
    { label: "Volume \u2265 3.5\xD7 20d avg", pass: c1, value: `${volRatio20.toFixed(1)}\xD7` },
    { label: "Close top 25% of range AND upper wick \u2264 25%", pass: c2, value: `CL=${closeLoc.toFixed(0)}% UW=${ca.upperWickPct.toFixed(0)}%` },
    { label: "Price within 12% of 20d high", pass: c3, value: hi20 > 0 ? `${(sig.c / hi20 * 100).toFixed(1)}%` : "\u2014" },
    { label: "Range expansion \u2265 1.5\xD7 ATR", pass: c4, value: `${exactRangeATR14.toFixed(2)}\xD7` },
    { label: "Open gap-down \u2264 0%", pass: c5, value: sig.o >= prevClose ? "YES" : "NO" },
    { label: "Fresh DI timing and ADX \u2265 25", pass: c6, value: `DI+${diPlusV.toFixed(0)} DI-${diMinusV.toFixed(0)} BSC=${bsc === 99 ? "none" : bsc} ADX${adxVal.toFixed(0)}` }
  ];
  return attachTuningDebug({
    ...base,
    stage,
    inflectionScore: score,
    confidence: score,
    avgTurnover20: turnover20,
    atrPct14: atr14 / sig.c * 100,
    volRatio20,
    rsi2,
    rsi14,
    exactRangeATR14,
    exactVolRatio20: volRatio20,
    closeLoc,
    upperWickPct,
    bodyPct,
    signalRangePct,
    pre10AvgRangeATR,
    ultraPrecisionScore: score,
    candleQualityScore: ca.qualityTier,
    priceEngine: pe,
    conditionsMet,
    totalConditions: 6,
    checklist,
    momentum: { emaAligned: sig.c > ema20 && ema20 > ema50, ema20, ema50, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: 0, obvSlope10: computeOBVSlope10(candles, endIdx), adx14: adxVal, adxInRange: adxVal >= 15 && adxVal <= 50, gapAdjustedRR: pe.rewardRisk, momentumScore: score, rsNifty20: 1 },
    monster: conditionsMet >= 5 ? { badges: [{ type: "MOM", probability: score / 100, details: `Vol ${volRatio20.toFixed(1)}\xD7 surge \u2014 DI+${diPlusV.toFixed(0)}/DI-${diMinusV.toFixed(0)} ADX${adxVal.toFixed(0)} \u2014 LW=${ca.lowerWickPct.toFixed(0)}% UW=${ca.upperWickPct.toFixed(0)}%` }], topProbability: score / 100 } : base.monster,
    candleDNA,
    archetypeType: "VolumeFootprint",
    archetypeConditions: conditionsMet,
    archetypeTotal: 6
  }, tuning);
}
function analyzeCompressionCoil(candles, skipPrecisionGate = false) {
  const key = "optimized_highprecision_15plus";
  const base = archetypeBase(candles, key);
  const n = candles.length;
  if (n < 50) return base;
  const endIdx = n - 1;
  const sig = candles[endIdx];
  if (sig.c <= 0) return base;
  const atr14Arr = computeATR14(candles);
  const atr14 = atr14Arr[endIdx] || sig.c * 0.02;
  let tSum = 0;
  const tStart = Math.max(0, endIdx - 20);
  for (let i = tStart; i < endIdx; i++) tSum += candles[i].c * candles[i].v;
  const turnover20 = endIdx - tStart > 0 ? tSum / (endIdx - tStart) : 0;
  if (!_forensicMode && turnover20 < 5e6) return base;
  let vSum = 0;
  for (let i = tStart; i < endIdx; i++) vSum += candles[i].v;
  const vAvg20 = endIdx - tStart > 0 ? vSum / (endIdx - tStart) : 1;
  const volRatio20 = vAvg20 > 0 ? sig.v / vAvg20 : 0;
  const tech = archetypeTech(candles, endIdx);
  if (!skipPrecisionGate && !_forensicMode) {
    if (tech.cmf20 < tuned(key, "minCMF20", 0.15) || tech.obvSlope10 < tuned(key, "minOBVSlope10", 0.5) || // v14: OBV -1→0.5 (enable meaningful OBV gate)
    tech.atrPct14 < tuned(key, "minAtrPct14", 0) || volRatio20 < tuned(key, "minGateVolRatio", 1) || tech.closeVsEMA20 < tuned(key, "minCloseVsEMA20", 1) || tech.ema20Vs50 < tuned(key, "minEMA20VsEMA50", 0))
      return { ...base, conditionsMet: 0, totalConditions: 6, archetypeType: "CompressionCoil", archetypeConditions: 0, archetypeTotal: 6 };
  }
  const { diPlus: diPlusArr, diMinus: diMinusArr, adx: adxArr } = computeDMI(candles);
  const diPlusV = diPlusArr[endIdx];
  const diMinusV = diMinusArr[endIdx];
  const adxVal = adxArr[endIdx];
  let compressionBars = 0;
  for (let i = endIdx - 1; i >= Math.max(0, endIdx - 20); i--) {
    const a = atr14Arr[i] || atr14;
    if (candles[i].h - candles[i].l < tuned(key, "compressionATR", 0.7) * a) compressionBars++;
    else break;
  }
  const minCB = _forensicMode ? 5 : tuned(key, "minCompressionBars", 9);
  const c1 = compressionBars >= minCB && compressionBars <= tuned(key, "maxCompressionBars", 16);
  let volDeclineDays = 0;
  for (let i = endIdx - 1; i >= Math.max(1, endIdx - 5); i--) {
    if (candles[i].v < candles[i - 1].v) volDeclineDays++;
    else break;
  }
  const c2 = volDeclineDays >= tuned(key, "minVolumeDeclineDays", 1);
  let lo20 = Infinity, hi20 = 0;
  for (let i = Math.max(0, endIdx - 20); i <= endIdx; i++) {
    if (candles[i].l < lo20) lo20 = candles[i].l;
    if (candles[i].h > hi20) hi20 = candles[i].h;
  }
  const pricePos20 = hi20 > lo20 ? (sig.c - lo20) / (hi20 - lo20) * 100 : 50;
  const c3 = pricePos20 >= tuned(key, "minPricePos20", 60);
  const bbWidthPctl = (() => {
    const period = 20;
    const bbWidths = [];
    for (let i = period; i <= endIdx; i++) {
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += candles[j].c;
      const mean3 = s / period;
      let variance = 0;
      for (let j = i - period + 1; j <= i; j++) variance += (candles[j].c - mean3) ** 2;
      const std2 = Math.sqrt(variance / period);
      bbWidths.push(mean3 > 0 ? 4 * std2 / mean3 * 100 : 0);
    }
    if (bbWidths.length === 0) return 50;
    const cur = bbWidths[bbWidths.length - 1];
    const window60 = bbWidths.slice(-60);
    const below = window60.filter((w) => w <= cur).length;
    return below / window60.length * 100;
  })();
  const c4 = bbWidthPctl <= tuned(key, "maxBBWidthPctl", 40);
  const sigRange = sig.h - sig.l;
  const exactRangeATR14 = sigRange / (atr14 || 1e-4);
  const ca = computeCandleArch(sig.o, sig.h, sig.l, sig.c, atr14);
  const c5 = exactRangeATR14 <= tuned(key, "maxRangeATR", 1.1) && ca.isGreen && ca.closeLoc >= tuned(key, "minCloseLoc", 55) && ca.bodyPct >= tuned(key, "minBodyPct", 20) && ca.candleRisk <= tuned(key, "maxCandleRisk", 12);
  const bscCC = barsSinceDICross(diPlusArr, diMinusArr, endIdx, 5);
  const c6 = _forensicMode ? diPlusV > diMinusV : (!tunedBool(key, "requireDIBull", true) || diPlusV > diMinusV) && (tuned(key, "maxBsc", 3) >= 99 || bscCC <= tuned(key, "maxBsc", 3)) && adxVal >= tuned(key, "minADX", 20);
  const atr5bAgo = atr14Arr[Math.max(0, endIdx - 5)] || atr14;
  const atrContraction5d = atr5bAgo > 0 ? (atr5bAgo - atr14) / atr5bAgo : 0;
  const c7 = atrContraction5d >= 0.08;
  const passed = [c1, c2, c3, c4, c5, c6, c7];
  const conditionsMet = passed.filter(Boolean).length;
  const tuning = { ...tech, compressionBars, volDeclineDays, pricePos20, bbWidthPctl, rangeATR: exactRangeATR14, isGreen: ca.isGreen, closeLoc: ca.closeLoc, bodyPct: ca.bodyPct, candleRisk: ca.candleRisk, diBull: diPlusV > diMinusV, bsc: bscCC, adx: adxVal, atrContraction5d, conditions: passed.map(Boolean) };
  if (conditionsMet < 1) return attachTuningDebug({ ...base, conditionsMet, totalConditions: 7, archetypeType: "CompressionCoil", archetypeConditions: conditionsMet, archetypeTotal: 7 }, tuning);
  const score = Math.min(100, Math.round(
    (c1 ? 20 : 0) + (c2 ? 3 : 0) + (c3 ? 45 : 0) + (c4 ? 18 : 0) + (c5 ? 3 : 0) + (c6 ? 3 : 0) + (c7 ? 4 : 0) + Math.min(10, compressionBars * 3) + Math.min(5, Math.max(0, pricePos20 - 65) * 0.5)
  ));
  const stage = applyEliteGate(archetypeStage(conditionsMet, score, "CompressionCoil"), volRatio20, exactRangeATR14, ca.bodyPct, ca.upperWickPct);
  const rsi2 = computeRSI(candles, 2);
  const rsi14 = computeRSI(candles, 14);
  const ema20 = computeEMA(candles, 20)[endIdx] ?? 0;
  const ema50 = computeEMA(candles, 50)[endIdx] ?? 0;
  const sw5Low = endIdx >= 4 ? Math.min(...candles.slice(endIdx - 4, endIdx + 1).map((b) => b.l)) : 0;
  const sw10Low = endIdx >= 9 ? Math.min(...candles.slice(endIdx - 9, endIdx + 1).map((b) => b.l)) : sw5Low;
  const wyckoffStop = computeWyckoffStop(candles, endIdx, sw10Low, atr14);
  const pe = archetypePriceEngine(sig.c, atr14, sw5Low, "CC", wyckoffStop);
  pe.breakoutTier = computeBreakoutTier(candles, endIdx, tech, null);
  const closeLoc = ca.closeLoc;
  const bodyPct = ca.bodyPct;
  const upperWickPct = ca.upperWickPct;
  const candleDNA = detectCandleDNA(candles, endIdx, atr14);
  const checklist = [
    { label: "Deep coil: 9-16 narrow bars (< 0.7\xD7ATR)", pass: c1, value: `${compressionBars} bars` },
    { label: "Volume declining \u2265 1 days (supply drying)", pass: c2, value: `${volDeclineDays} days` },
    { label: "Price in upper 40% of 20d range", pass: c3, value: `${pricePos20.toFixed(0)}%` },
    { label: "BB width \u2264 40th pctl (60d) \u2014 extreme squeeze", pass: c4, value: `${bbWidthPctl.toFixed(0)}th pctl` },
    { label: "Coil bar: range \u2264 1.1\xD7ATR, green, close \u226555%, body \u226520%", pass: c5, value: `rng=${exactRangeATR14.toFixed(2)}\xD7 CL=${ca.closeLoc.toFixed(0)}% Bd=${ca.bodyPct.toFixed(0)}%` },
    { label: "DI+ > DI\u2212 and ADX \u2265 45 (breakout aligned)", pass: c6, value: `DI+${diPlusV.toFixed(0)} DI-${diMinusV.toFixed(0)} ADX${adxVal.toFixed(0)}` },
    { label: "ATR contraction \u2265 8% over 5 bars (progressive squeeze)", pass: c7, value: `${(atrContraction5d * 100).toFixed(1)}%` }
  ];
  let rSum10 = 0;
  const rStart10 = Math.max(0, endIdx - 10);
  for (let i = rStart10; i < endIdx; i++) rSum10 += (candles[i].h - candles[i].l) / (atr14Arr[i] || 1e-4);
  const pre10AvgRangeATR = endIdx - rStart10 > 0 ? rSum10 / (endIdx - rStart10) : 1;
  return attachTuningDebug({
    ...base,
    stage,
    inflectionScore: score,
    confidence: score,
    avgTurnover20: turnover20,
    atrPct14: atr14 / sig.c * 100,
    volRatio20,
    rsi2,
    rsi14,
    exactRangeATR14,
    exactVolRatio20: volRatio20,
    closeLoc,
    upperWickPct,
    bodyPct,
    pre10AvgRangeATR,
    signalRangePct: sig.c > 0 ? sigRange / sig.c * 100 : 0,
    ultraPrecisionScore: score,
    candleQualityScore: ca.qualityTier,
    priceEngine: pe,
    conditionsMet,
    totalConditions: 7,
    checklist,
    momentum: { emaAligned: sig.c > ema20 && ema20 > ema50, ema20, ema50, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: compressionBars, obvSlope10: computeOBVSlope10(candles, endIdx), adx14: adxVal, adxInRange: adxVal >= 20 && adxVal <= 50, gapAdjustedRR: pe.rewardRisk, momentumScore: score, rsNifty20: 1 },
    stats: { ...base.stats, bbWidthPctl, guppyCompressed: compressionBars >= 3, guppyUltraCompressed: compressionBars >= 5 },
    candleDNA,
    monster: conditionsMet >= 5 ? { badges: [{ type: "MOM", probability: score / 100, details: `Compressed ${compressionBars}bars \u2014 DI+${diPlusV.toFixed(0)}/DI-${diMinusV.toFixed(0)} ADX${adxVal.toFixed(0)} \u2014 CL=${ca.closeLoc.toFixed(0)}% Bd=${ca.bodyPct.toFixed(0)}%` }], topProbability: score / 100 } : base.monster,
    archetypeType: "CompressionCoil",
    archetypeConditions: conditionsMet,
    archetypeTotal: 7
  }, tuning);
}
function analyzeMomentumPocket(candles, skipPrecisionGate = false) {
  const key = "optimized_elite_10plus";
  const base = archetypeBase(candles, key);
  const n = candles.length;
  if (n < 60) return base;
  const endIdx = n - 1;
  const sig = candles[endIdx];
  if (sig.c <= 0) return base;
  const atr14Arr = computeATR14(candles);
  const atr14 = atr14Arr[endIdx] || sig.c * 0.02;
  const { diPlus: diPlusArrMP, diMinus: diMinusArrMP, adx: adxArrMP } = computeDMI(candles);
  const diPlusV = diPlusArrMP[endIdx];
  const diMinusV = diMinusArrMP[endIdx];
  const adxVal = adxArrMP[endIdx];
  const bscMP = barsSinceDICross(diPlusArrMP, diMinusArrMP, endIdx, 5);
  let tSum = 0, vSum = 0;
  const tStart = Math.max(0, endIdx - 20);
  for (let i = tStart; i < endIdx; i++) {
    tSum += candles[i].c * candles[i].v;
    vSum += candles[i].v;
  }
  const turnover20 = endIdx - tStart > 0 ? tSum / (endIdx - tStart) : 0;
  if (!_forensicMode && turnover20 < 1e7) return base;
  const vAvg20 = endIdx - tStart > 0 ? vSum / (endIdx - tStart) : 1;
  const volRatio20 = vAvg20 > 0 ? sig.v / vAvg20 : 0;
  const tech = archetypeTech(candles, endIdx);
  if (!skipPrecisionGate && !_forensicMode) {
    if (tech.cmf20 < tuned(key, "minCMF20", 0) || tech.obvSlope10 < tuned(key, "minOBVSlope10", -0.5) || tech.atrPct14 < tuned(key, "minAtrPct14", 3.5) || tech.atrPct14 > tuned(key, "maxAtrPct14", 7) || // MP HIGH-only: NORMAL/VOLATILE WR<60%, STRONG VOLATILE WR=37.5%
    tech.rsi14 < tuned(key, "minGateRSI14", 42) || tech.rsi14 > tuned(key, "maxGateRSI14", 50) || tech.rsi2 > tuned(key, "maxGateRSI2", 30) || volRatio20 < tuned(key, "minGateVolRatio", 1.5) || tuned(key, "minCloseVsEMA20", -999) > -999 && tech.closeVsEMA20 < tuned(key, "minCloseVsEMA20", -999) || tuned(key, "minEMA20VsEMA50", 0) > -999 && tech.ema20Vs50 < tuned(key, "minEMA20VsEMA50", 0))
      return { ...base, conditionsMet: 0, totalConditions: 6, archetypeType: "MomentumPocket", archetypeConditions: 0, archetypeTotal: 6 };
  }
  let hh252 = 0;
  for (let i = Math.max(0, endIdx - 252); i < endIdx; i++) if (candles[i].h > hh252) hh252 = candles[i].h;
  const dd52W = hh252 > 0 ? (hh252 - sig.c) / hh252 * 100 : 0;
  const c1 = dd52W >= tuned(key, "minDd52W", 10) && dd52W <= tuned(key, "maxDd52W", 80);
  let stabilizationBars = 0;
  const lookback8Start = Math.max(0, endIdx - 8);
  let refLow = sig.l;
  for (let i = endIdx - 1; i >= lookback8Start; i--) {
    if (candles[i].l > refLow * 0.985) {
      stabilizationBars++;
      refLow = Math.min(refLow, candles[i].l);
    } else break;
  }
  const c2 = stabilizationBars >= tuned(key, "minStabBars", 7);
  const sigRange = sig.h - sig.l;
  const closeLoc = sigRange > 0 ? (sig.c - sig.l) / sigRange * 100 : 50;
  const bodyPct = sigRange > 0 ? Math.abs(sig.c - sig.o) / sigRange * 100 : 0;
  const upperWickPct = sigRange > 0 ? (sig.h - Math.max(sig.o, sig.c)) / sigRange * 100 : 0;
  const exactRangeATR14 = sigRange / (atr14 || 1e-4);
  const ca = computeCandleArch(sig.o, sig.h, sig.l, sig.c, atr14);
  const c3 = closeLoc >= tuned(key, "minCloseLoc", 43) && bodyPct >= tuned(key, "minBodyPct", 35) && sig.c >= sig.o && ca.upperWickPct <= tuned(key, "maxUpperWick", 30) || ca.isHammer && closeLoc >= 60;
  const c4 = volRatio20 >= tuned(key, "minVolRatio", 2);
  const rsi2 = computeRSI(candles, 2);
  const rsi14 = computeRSI(candles, 14);
  const c5 = rsi14 >= tuned(key, "minRSI14", 40) && rsi14 <= tuned(key, "maxRSI14", 60);
  const c6 = (!tunedBool(key, "requireDIBull", false) || diPlusV > diMinusV) && (tuned(key, "maxBsc", 3) >= 99 || bscMP <= tuned(key, "maxBsc", 3)) && adxVal >= tuned(key, "minADX", 30);
  const passed = [c1, c2, c3, c4, c5, c6];
  const conditionsMet = passed.filter(Boolean).length;
  const tuning = { ...tech, dd52W, stabilizationBars, closeLoc, bodyPct, upperWickPct: ca.upperWickPct, isGreen: ca.isGreen, hammer: ca.isHammer, volRatio20, rsi14, candleRisk: ca.candleRisk, diBull: diPlusV > diMinusV, bsc: bscMP, adx: adxVal, conditions: passed.map(Boolean) };
  if (conditionsMet < 2) return attachTuningDebug({ ...base, conditionsMet, totalConditions: 6, archetypeType: "MomentumPocket", archetypeConditions: conditionsMet, archetypeTotal: 6 }, tuning);
  const P4 = PARAM_SETS[key];
  let zonePivotCount = 0;
  let q4Pass = true;
  if (P4.minZonePivotCount != null) {
    const zoneE10 = findCompressionZone(candles, atr14Arr, P4, endIdx);
    if (zoneE10 && zoneE10.zoneStart != null) {
      const proximityThresh = zoneE10.zoneHigh * 0.995;
      const retraceLevel = zoneE10.zoneHigh * 0.992;
      for (let i = zoneE10.zoneStart; i < endIdx - 1; i++) {
        if (candles[i].h >= proximityThresh) {
          for (let j = i + 1; j <= Math.min(endIdx, i + 5); j++) {
            if (candles[j].l < retraceLevel) {
              zonePivotCount++;
              break;
            }
          }
        }
      }
      q4Pass = zonePivotCount >= P4.minZonePivotCount;
    }
  }
  if (!q4Pass) return attachTuningDebug({ ...base, conditionsMet, totalConditions: 6, archetypeType: "MomentumPocket", archetypeConditions: conditionsMet, archetypeTotal: 6 }, tuning);
  const score = Math.min(100, Math.round(
    (c1 ? 3 : 0) + (c2 ? 10 : 0) + (c3 ? 16 : 0) + (c4 ? 3 : 0) + (c5 ? 39 : 0) + (c6 ? 25 : 0) + Math.min(10, stabilizationBars * 3) + Math.min(5, (volRatio20 - 1.5) * 4)
  ));
  const stage = applyEliteGate(archetypeStage(conditionsMet, score, "MomentumPocket"), volRatio20, exactRangeATR14, bodyPct, upperWickPct);
  const ema20 = computeEMA(candles, 20)[endIdx] ?? 0;
  const ema50 = computeEMA(candles, 50)[endIdx] ?? 0;
  const sw5Low = endIdx >= 4 ? Math.min(...candles.slice(endIdx - 4, endIdx + 1).map((b) => b.l)) : 0;
  const sw10Low = endIdx >= 9 ? Math.min(...candles.slice(endIdx - 9, endIdx + 1).map((b) => b.l)) : sw5Low;
  const wyckoffStop = computeWyckoffStop(candles, endIdx, sw10Low, atr14);
  const pe = archetypePriceEngine(sig.c, atr14, sw5Low, "MP", wyckoffStop);
  pe.breakoutTier = computeBreakoutTier(candles, endIdx, tech, null);
  const candleDNA = detectCandleDNA(candles, endIdx, atr14);
  const checklist = [
    { label: "10-80% below 52W high (washout zone)", pass: c1, value: `${dd52W.toFixed(1)}% drawdown` },
    { label: "Not making new lows (base forming, \u22657 bars)", pass: c2, value: `${stabilizationBars} bars stable` },
    { label: "Bull candle: (CL\u226543% Bd\u226535% UW\u226430%) OR hammer (LW>2\xD7body CL\u226560%)", pass: c3, value: ca.isHammer ? `HAMMER LW=${ca.lowerWickPct.toFixed(0)}%` : `CL=${closeLoc.toFixed(0)}% Bd=${bodyPct.toFixed(0)}% UW=${ca.upperWickPct.toFixed(0)}%` },
    { label: "Volume \u2265 2.0\xD7 avg on recovery", pass: c4, value: `${volRatio20.toFixed(1)}\xD7` },
    { label: "RSI14 in recovery zone (40-60)", pass: c5, value: rsi14.toFixed(1) },
    { label: "DI+ > DI\u2212, crossed \u22643 bars ago, ADX \u2265 30 (trend launch)", pass: c6, value: `BSC=${bscMP === 99 ? "none" : bscMP} ADX${adxVal.toFixed(0)}` },
    ...P4.minZonePivotCount != null ? [{ label: `Zone pivot rejections \u2265${P4.minZonePivotCount} at zone top (Q4 base integrity)`, pass: q4Pass, value: `${zonePivotCount} pivot${zonePivotCount !== 1 ? "s" : ""}` }] : []
  ];
  return attachTuningDebug({
    ...base,
    stage,
    inflectionScore: score,
    confidence: score,
    avgTurnover20: turnover20,
    atrPct14: atr14 / sig.c * 100,
    volRatio20,
    rsi2,
    rsi14,
    exactRangeATR14,
    exactVolRatio20: volRatio20,
    closeLoc,
    upperWickPct,
    bodyPct,
    signalRangePct: sig.c > 0 ? sigRange / sig.c * 100 : 0,
    ultraPrecisionScore: score,
    candleQualityScore: conditionsMet,
    priceEngine: pe,
    conditionsMet,
    totalConditions: 6,
    checklist,
    momentum: { emaAligned: sig.c > ema20 && ema20 > ema50, ema20, ema50, higherLowConfirmed: c2, swingLow20: refLow, volDryUpScore: 0, obvSlope10: computeOBVSlope10(candles, endIdx), adx14: adxVal, adxInRange: adxVal >= 25 && adxVal <= 60, gapAdjustedRR: pe.rewardRisk, momentumScore: score, rsNifty20: 1 },
    stats: { ...base.stats, drawdownFrom52WH: dd52W, rsi14 },
    monster: conditionsMet >= 5 ? { badges: [{ type: "MRV", probability: score / 100, details: `Momentum Pocket \u2014 ${dd52W.toFixed(1)}% below 52W high \u2014 ${ca.isHammer ? `HAMMER LW=${ca.lowerWickPct.toFixed(0)}%` : `Bd=${bodyPct.toFixed(0)}%`} \u2014 ADX${adxVal.toFixed(0)}` }], topProbability: score / 100 } : base.monster,
    candleDNA,
    archetypeType: "MomentumPocket",
    archetypeConditions: conditionsMet,
    archetypeTotal: 6,
    zonePivotCount
  }, tuning);
}
function analyzeEMAStack(candles) {
  const key = "optimized_ultraselective_8plus";
  const base = archetypeBase(candles, key);
  const n = candles.length;
  if (n < 60) return base;
  const endIdx = n - 1;
  const sig = candles[endIdx];
  if (sig.c <= 0) return base;
  const atr14Arr = computeATR14(candles);
  const atr14 = atr14Arr[endIdx] || sig.c * 0.02;
  let tSum = 0, vSum = 0;
  const tStart = Math.max(0, endIdx - 20);
  for (let i = tStart; i < endIdx; i++) {
    tSum += candles[i].c * candles[i].v;
    vSum += candles[i].v;
  }
  const turnover20 = endIdx - tStart > 0 ? tSum / (endIdx - tStart) : 0;
  if (!_forensicMode && turnover20 < 1e7) return base;
  const vAvg20 = endIdx - tStart > 0 ? vSum / (endIdx - tStart) : 1;
  const volRatio20 = vAvg20 > 0 ? sig.v / vAvg20 : 0;
  const tech = archetypeTech(candles, endIdx);
  if (!_forensicMode && (tech.cmf20 < tuned(key, "minCMF20", 0.1) || tech.obvSlope10 < tuned(key, "minOBVSlope10", 0.5) || // v14: CMF 0→0.1 (add minimum money flow)
  tech.closeVsEMA20 < tuned(key, "minCloseVsEMA20", -0.5) || tuned(key, "minEMA20VsEMA50", 0) > -999 && tech.ema20Vs50 < tuned(key, "minEMA20VsEMA50", 0)))
    return { ...base, conditionsMet: 0, totalConditions: 6, archetypeType: "EMAStack", archetypeConditions: 0, archetypeTotal: 6 };
  const ema10Arr = computeEMA(candles, 10);
  const ema20Arr = computeEMA(candles, 20);
  const ema50Arr = computeEMA(candles, 50);
  const ema20 = ema20Arr[endIdx] ?? 0;
  const ema50 = ema50Arr[endIdx] ?? 0;
  const ema10 = ema10Arr[endIdx] ?? 0;
  const { diPlus: diPlusArrES, diMinus: diMinusArrES, adx: adxArrES } = computeDMI(candles);
  const diPlusV = diPlusArrES[endIdx];
  const diMinusV = diMinusArrES[endIdx];
  const adxVal = adxArrES[endIdx];
  const bscES = barsSinceDICross(diPlusArrES, diMinusArrES, endIdx, 5);
  const prevClose = endIdx > 0 ? candles[endIdx - 1].c : 0;
  const prevEMA20 = endIdx > 0 ? ema20Arr[endIdx - 1] ?? 0 : 0;
  const crossedAboveToday = sig.c > ema20 && prevClose < prevEMA20 && ema20 > 0;
  const c1 = crossedAboveToday;
  let belowCount = 0;
  for (let i = endIdx - 1; i >= Math.max(0, endIdx - 20); i--) {
    if (candles[i].c < (ema20Arr[i] ?? 0)) belowCount++;
    else break;
  }
  const c2 = belowCount >= tuned(key, "minBelowBars", 1);
  const ema10VsEma20 = ema20 > 0 ? (ema10 - ema20) / ema20 * 100 : 0;
  const caES = computeCandleArch(sig.o, sig.h, sig.l, sig.c, atr14);
  const c3 = ema10VsEma20 >= tuned(key, "minEMA10VsEma20", 0.5) && caES.isGreen && caES.bodyPct >= tuned(key, "minBodyPct", 65) && caES.upperWickPct <= tuned(key, "maxUpperWick", 20) && // v14: body 50→65 (align PARAM_SETS)
  caES.candleRisk <= tuned(key, "maxCandleRisk", 8);
  const c4 = volRatio20 >= tuned(key, "minVolRatio", 2.2);
  let recentlyOversold = false;
  for (let i = Math.max(1, endIdx - 4); i <= endIdx; i++) {
    const slice = candles.slice(0, i + 1);
    const r2 = computeRSI(slice, 2);
    if (r2 <= tuned(key, "maxRSI2Last5", 40)) {
      recentlyOversold = true;
      break;
    }
  }
  const c5 = recentlyOversold;
  const c6 = (!tunedBool(key, "requireDIBull", true) || diPlusV > diMinusV) && (tuned(key, "maxBsc", 5) >= 99 || bscES <= tuned(key, "maxBsc", 5)) && adxVal >= tuned(key, "minADX", 15);
  const crossedYesterday = endIdx > 1 ? candles[endIdx - 1].c > (ema20Arr[endIdx - 1] ?? 0) && candles[endIdx - 2].c < (ema20Arr[endIdx - 2] ?? 0) : false;
  const passed = [c1, c2, c3, c4, c5, c6];
  const conditionsMet = passed.filter(Boolean).length;
  const tuning = { ...tech, crossedAboveToday, belowCount, ema10VsEma20, isGreen: caES.isGreen, bodyPct: caES.bodyPct, upperWickPct: caES.upperWickPct, candleRisk: caES.candleRisk, volRatio20, recentlyOversold, diBull: diPlusV > diMinusV, bsc: bscES, adx: adxVal, conditions: passed.map(Boolean) };
  if (!c1 || conditionsMet < 2) return attachTuningDebug({ ...base, conditionsMet, totalConditions: 6, archetypeType: "EMAStack", archetypeConditions: conditionsMet, archetypeTotal: 6 }, tuning);
  const score = Math.min(100, Math.round(
    (c1 ? 23 : 0) + (c2 ? 3 : 0) + (c3 ? 39 : 0) + (c4 ? 17 : 0) + (c5 ? 3 : 0) + (c6 ? 11 : 0) + Math.min(10, belowCount * 2) + Math.min(5, (volRatio20 - 1.8) * 5)
  ));
  const rawStageEMA = applyEliteGate(archetypeStage(conditionsMet, score, "EMAStack"), volRatio20, (sig.h - sig.l) / (atr14 || 1e-4), caES.bodyPct, caES.upperWickPct);
  const stage = atr14 / sig.c * 100 >= 3.5 ? "NEUTRAL" : rawStageEMA;
  const rsi2 = computeRSI(candles, 2);
  const rsi14 = computeRSI(candles, 14);
  const sigRange = sig.h - sig.l;
  const closeLoc = sigRange > 0 ? (sig.c - sig.l) / sigRange * 100 : 50;
  const bodyPct = sigRange > 0 ? Math.abs(sig.c - sig.o) / sigRange * 100 : 0;
  const upperWickPct = sigRange > 0 ? (sig.h - Math.max(sig.o, sig.c)) / sigRange * 100 : 0;
  const exactRangeATR14 = sigRange / (atr14 || 1e-4);
  const sw5Low = endIdx >= 4 ? Math.min(...candles.slice(endIdx - 4, endIdx + 1).map((b) => b.l)) : 0;
  const sw10Low = endIdx >= 9 ? Math.min(...candles.slice(endIdx - 9, endIdx + 1).map((b) => b.l)) : sw5Low;
  const wyckoffStop = computeWyckoffStop(candles, endIdx, sw10Low, atr14);
  const pe = archetypePriceEngine(sig.c, atr14, sw5Low, "EMA", wyckoffStop);
  pe.breakoutTier = computeBreakoutTier(candles, endIdx, tech, null);
  const candleDNA = detectCandleDNA(candles, endIdx, atr14);
  const checklist = [
    { label: "Crossed above EMA20 TODAY (fresh crossover)", pass: c1, value: crossedAboveToday ? "TODAY" : crossedYesterday ? "YESTERDAY(miss)" : "NO" },
    { label: "Was below EMA20 for \u2265 1 bar prior", pass: c2, value: `${belowCount} bars below` },
    { label: "EMA10 \u2265 +0.5% above EMA20 AND green bull bar (body\u226550% UW\u226420%)", pass: c3, value: `EMA10 ${ema10VsEma20 >= 0 ? "+" : ""}${ema10VsEma20.toFixed(1)}% Bd=${caES.bodyPct.toFixed(0)}% UW=${caES.upperWickPct.toFixed(0)}%` },
    { label: "Volume \u2265 1.3\xD7 avg on crossover", pass: c4, value: `${volRatio20.toFixed(1)}\xD7` },
    { label: "RSI2 \u2264 40 in last 5 bars", pass: c5, value: recentlyOversold ? "YES" : "NO" },
    { label: "DI+ crossed today, ADX \u2265 15", pass: c6, value: `BSC=${bscES === 99 ? "none" : bscES} ADX${adxVal.toFixed(0)}` }
  ];
  return attachTuningDebug({
    ...base,
    stage,
    inflectionScore: score,
    confidence: score,
    avgTurnover20: turnover20,
    atrPct14: atr14 / sig.c * 100,
    volRatio20,
    rsi2,
    rsi14,
    exactRangeATR14,
    exactVolRatio20: volRatio20,
    closeLoc,
    upperWickPct,
    bodyPct,
    signalRangePct: sig.c > 0 ? sigRange / sig.c * 100 : 0,
    ultraPrecisionScore: score,
    candleQualityScore: conditionsMet,
    priceEngine: pe,
    conditionsMet,
    totalConditions: 6,
    checklist,
    momentum: { emaAligned: sig.c > ema20 && ema20 > ema50, ema20, ema50, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: 0, obvSlope10: computeOBVSlope10(candles, endIdx), adx14: adxVal, adxInRange: adxVal >= 15 && adxVal <= 50, gapAdjustedRR: pe.rewardRisk, momentumScore: score, rsNifty20: 1 },
    stats: { ...base.stats, rsi14, ema10, ema10Cross: crossedAboveToday },
    monster: conditionsMet >= 5 ? { badges: [{ type: "MOM", probability: score / 100, details: `EMA Stack crossover \u2014 ${belowCount}d below EMA20 \u2014 Bd=${caES.bodyPct.toFixed(0)}% UW=${caES.upperWickPct.toFixed(0)}% \u2014 ADX${adxVal.toFixed(0)} BSC=${bscES}` }], topProbability: score / 100 } : base.monster,
    candleDNA,
    archetypeType: "EMAStack",
    archetypeConditions: conditionsMet,
    archetypeTotal: 6
  }, tuning);
}
function analyzePerfectStorm(candles) {
  const key = "sniper_95plus";
  const base = archetypeBase(candles, key);
  const n = candles.length;
  if (n < 60) return base;
  const { adx: adxArrPS } = computeDMI(candles);
  const adxValPS = adxArrPS[n - 1];
  if (adxValPS < tuned(key, "minADXGate", 0)) return attachTuningDebug({ ...base, archetypeType: "PerfectStorm", archetypeConditions: 0, archetypeTotal: 4 }, { adx: adxValPS, quality: 0, candleRisk: 99, fires: 0, fireScores: [] });
  const atr14PS = computeATR14(candles)[n - 1] || candles[n - 1].c * 0.02;
  const sigPS = candles[n - 1];
  const caPS = computeCandleArch(sigPS.o, sigPS.h, sigPS.l, sigPS.c, atr14PS);
  if (caPS.qualityTier < tuned(key, "minQualityTier", 2) || caPS.candleRisk > tuned(key, "maxCandleRisk", 10)) return attachTuningDebug({ ...base, archetypeType: "PerfectStorm", archetypeConditions: 0, archetypeTotal: 4 }, { adx: adxValPS, quality: caPS.qualityTier, candleRisk: caPS.candleRisk, fires: 0, fireScores: [] });
  const endIdx = n - 1;
  const techPS = archetypeTech(candles, endIdx);
  {
    const _cmf = techPS.cmf20;
    const _obv = techPS.obvSlope10;
    if (_cmf < tuned(key, "minCMF20", 0.05) || _obv < tuned(key, "minOBVSlope10", 0.8) || // v14: OBV 0→0.8 (booster: 64.7% WR), CMF 0.1→0.05 (OBV does work)
    techPS.atrPct14 < tuned(key, "minAtrPct14", 4) || techPS.atrPct14 > tuned(key, "maxAtrPct14", 5) || techPS.closeVsEMA20 < tuned(key, "minCloseVsEMA20", 0) || tuned(key, "minEMA20VsEMA50", -999) > -999 && techPS.ema20Vs50 < tuned(key, "minEMA20VsEMA50", -999))
      return attachTuningDebug({ ...base, archetypeType: "PerfectStorm", archetypeConditions: 0, archetypeTotal: 4 }, { ...techPS, adx: adxValPS, quality: caPS.qualityTier, candleRisk: caPS.candleRisk, fires: 0, fireScores: [] });
  }
  const vf = analyzeVolumeFootprint(candles);
  const cc = analyzeCompressionCoil(candles, true);
  const mp = analyzeMomentumPocket(candles, true);
  const ema = analyzeEMAStack(candles);
  const ACTIONABLE = /* @__PURE__ */ new Set(["BUY", "STRONG_BUY", "ULTRA_STRONG_BUY"]);
  const fires = [
    { r: vf, name: "VolumeFootprint", label: "Vol Footprint" },
    { r: cc, name: "CompressionCoil", label: "Compression Coil" },
    { r: mp, name: "MomentumPocket", label: "Momentum Pocket" },
    { r: ema, name: "EMAStack", label: "EMA Stack" }
  ].filter((f) => ACTIONABLE.has(f.r.stage));
  const tuning = { ...techPS, adx: adxValPS, quality: caPS.qualityTier, candleRisk: caPS.candleRisk, fires: fires.length, fireScores: fires.map((f) => f.r.inflectionScore) };
  if (fires.length < tuned(key, "minFires", 1)) return attachTuningDebug({ ...base, archetypeType: "PerfectStorm", archetypeConditions: fires.length, archetypeTotal: 4 }, tuning);
  const P5 = PARAM_SETS[key];
  let priorRunUpPct = 0;
  let q5Pass = true;
  if (P5.minPriorRunUpPct != null) {
    const atr14ArrPS = computeATR14(candles);
    const zonePS = findCompressionZone(candles, atr14ArrPS, P5, endIdx);
    if (zonePS && zonePS.zoneStart != null) {
      const lb = Math.max(0, zonePS.zoneStart - 60);
      let localLow = Infinity;
      for (let i = lb; i < zonePS.zoneStart; i++) {
        if (candles[i].l < localLow) localLow = candles[i].l;
      }
      priorRunUpPct = localLow < Infinity && localLow > 0 ? (zonePS.zoneHigh - localLow) / localLow * 100 : 0;
      q5Pass = priorRunUpPct >= P5.minPriorRunUpPct;
    }
  }
  if (!q5Pass) return attachTuningDebug({ ...base, archetypeType: "PerfectStorm", archetypeConditions: fires.length, archetypeTotal: 4 }, tuning);
  const stageRank = { ULTRA_STRONG_BUY: 5, STRONG_BUY: 4, BUY: 3, PRE_BREAKOUT: 2, EARLY_INFLECTION: 1, COMPRESSION_WATCH: 0, NO_SIGNAL: 0 };
  const best = fires.reduce((a, b) => stageRank[b.r.stage] > stageRank[a.r.stage] ? b : a);
  const avgScore = fires.reduce((s, f) => s + f.r.inflectionScore, 0) / fires.length;
  const diversityBonus = fires.length >= 4 ? 15 : fires.length === 3 ? 10 : 5;
  const score = Math.min(100, Math.round(avgScore + diversityBonus));
  const stage = applyEliteGate(
    archetypeStage(fires.length >= 4 ? 6 : fires.length === 3 ? 5 : 4, score),
    best.r.exactVolRatio20,
    best.r.exactRangeATR14,
    best.r.bodyPct,
    best.r.upperWickPct
  );
  const sig = candles[endIdx];
  const atr14 = computeATR14(candles)[endIdx] || sig.c * 0.02;
  const sigRange = sig.h - sig.l;
  const closeLoc = sigRange > 0 ? (sig.c - sig.l) / sigRange * 100 : 50;
  const sw5Low = endIdx >= 4 ? Math.min(...candles.slice(endIdx - 4, endIdx + 1).map((b) => b.l)) : 0;
  const sw10Low = endIdx >= 9 ? Math.min(...candles.slice(endIdx - 9, endIdx + 1).map((b) => b.l)) : sw5Low;
  const wyckoffStop = computeWyckoffStop(candles, endIdx, sw10Low, atr14);
  const pe = archetypePriceEngine(sig.c, atr14, sw5Low, "PS", wyckoffStop);
  pe.breakoutTier = computeBreakoutTier(candles, endIdx, techPS, null);
  const checklist = [
    { label: "Volume Footprint fires", pass: fires.some((f) => f.name === "VolumeFootprint"), value: fires.some((f) => f.name === "VolumeFootprint") ? `Score ${vf.inflectionScore}` : "NO" },
    { label: "Compression Coil fires", pass: fires.some((f) => f.name === "CompressionCoil"), value: fires.some((f) => f.name === "CompressionCoil") ? `Score ${cc.inflectionScore}` : "NO" },
    { label: "Momentum Pocket fires", pass: fires.some((f) => f.name === "MomentumPocket"), value: fires.some((f) => f.name === "MomentumPocket") ? `Score ${mp.inflectionScore}` : "NO" },
    { label: "EMA Stack fires", pass: fires.some((f) => f.name === "EMAStack"), value: fires.some((f) => f.name === "EMAStack") ? `Score ${ema.inflectionScore}` : "NO" },
    ...P5.minPriorRunUpPct != null ? [{ label: `Prior run-up \u2265${P5.minPriorRunUpPct}% from 60-bar low to zone top (Stage 2 Q5)`, pass: q5Pass, value: priorRunUpPct > 0 ? `${priorRunUpPct.toFixed(1)}%` : "no zone" }] : []
  ];
  return attachTuningDebug({
    ...best.r,
    paramSetKey: key,
    stage,
    inflectionScore: Math.round(score),
    confidence: score,
    conditionsMet: fires.length,
    totalConditions: 4,
    checklist,
    priceEngine: pe,
    monster: {
      badges: [{ type: "MOM", probability: score / 100, details: `Perfect Storm \u2014 ${fires.length}/4 archetypes: ${fires.map((f) => f.label).join(", ")}` }],
      topProbability: score / 100
    },
    archetypeType: "PerfectStorm",
    archetypeConditions: fires.length,
    archetypeTotal: 4,
    priorRunUpPct
  }, tuning);
}
function analyzeCircuitBreaker(candles) {
  const key = "circuit_breaker_v2";
  const base = archetypeBase(candles, key);
  const n = candles.length;
  if (n < 80) return base;
  const endIdx = n - 1;
  const sig = candles[endIdx];
  if (sig.c <= 0) return base;
  const atr14Arr = computeATR14(candles);
  const atr14 = atr14Arr[endIdx] || sig.c * 0.02;
  const tStart = Math.max(0, endIdx - 20);
  let tSum = 0, vSum = 0;
  for (let i = tStart; i < endIdx; i++) {
    tSum += candles[i].c * candles[i].v;
    vSum += candles[i].v;
  }
  const turnover20 = endIdx - tStart > 0 ? tSum / (endIdx - tStart) : 0;
  if (!_forensicMode && turnover20 < tuned(key, "minAvgTurnover20", 1e7)) return base;
  const vAvg20 = endIdx - tStart > 0 ? vSum / (endIdx - tStart) : 1;
  const volRatioD1 = vAvg20 > 0 ? sig.v / vAvg20 : 0;
  const atrPct = sig.c > 0 ? atr14 / sig.c * 100 : 0;
  if (!_forensicMode && (atrPct < tuned(key, "minAtrPct", 3) || atrPct > tuned(key, "maxAtrPct", 20))) return base;
  if (n >= 5) {
    const last5 = candles.slice(endIdx - 4, endIdx + 1);
    const closes5 = last5.map((b) => b.c);
    const maxC5 = Math.max(...closes5), minC5 = Math.min(...closes5);
    const span5 = minC5 > 0 ? (maxC5 / minC5 - 1) * 100 : 99;
    if (span5 < tuned(key, "maxFlat5Pct", 2.5)) return base;
    const max3 = Math.max(closes5[2], closes5[3], closes5[4]);
    const min3 = Math.min(closes5[2], closes5[3], closes5[4]);
    const span3 = min3 > 0 ? (max3 / min3 - 1) * 100 : 99;
    if (span3 < tuned(key, "maxTight3Pct", 1.5)) return base;
    const vols5 = last5.map((b) => b.v);
    if (vols5[4] < vols5[3] && vols5[3] < vols5[2] && vols5[2] < vols5[1] && vols5[1] < vols5[0]) return base;
  }
  const { diPlus: dpArr, diMinus: dmArr, adx: adxArr } = computeDMI(candles);
  const diPlus = dpArr[endIdx] ?? 20;
  const diMinus = dmArr[endIdx] ?? 20;
  const adx = adxArr[endIdx] ?? 20;
  const trSlice5 = [];
  for (let i = Math.max(1, endIdx - 4); i <= endIdx; i++) {
    const prev = candles[i - 1];
    trSlice5.push(Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - prev.c), Math.abs(candles[i].l - prev.c)));
  }
  const atr5 = trSlice5.length ? trSlice5.reduce((a, x) => a + x, 0) / trSlice5.length : atr14;
  const atrComp = atr14 > 0 ? atr5 / atr14 : 1;
  const stSlice = candles.slice(Math.max(0, endIdx - 13), endIdx + 1);
  const stLo = Math.min(...stSlice.map((b) => b.l));
  const stHi = Math.max(...stSlice.map((b) => b.h));
  const stochK = stHi > stLo ? (sig.c - stLo) / (stHi - stLo) * 100 : 50;
  const mfiSlice = candles.slice(Math.max(0, endIdx - 4), endIdx + 1);
  let posFlow = 0, negFlow = 0;
  for (let i = 1; i < mfiSlice.length; i++) {
    const tpI = (mfiSlice[i].h + mfiSlice[i].l + mfiSlice[i].c) / 3;
    const tpP = (mfiSlice[i - 1].h + mfiSlice[i - 1].l + mfiSlice[i - 1].c) / 3;
    const mf = tpI * mfiSlice[i].v;
    if (tpI > tpP) posFlow += mf;
    else negFlow += mf;
  }
  const mfi5 = negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);
  const vol5Slice = candles.slice(Math.max(0, endIdx - 4), endIdx + 1);
  const bullVol = vol5Slice.filter((b) => b.c > b.o).reduce((a, b) => a + b.v, 0);
  const totalVol5 = vol5Slice.reduce((a, b) => a + b.v, 0);
  const volBullDom = totalVol5 > 0 ? bullVol / totalVol5 : 0.5;
  const sigRange = sig.h - sig.l;
  const closeLoc = sigRange > 1e-9 ? (sig.c - sig.l) / sigRange * 100 : 50;
  const upperWickPct = sigRange > 1e-9 ? (sig.h - Math.max(sig.o, sig.c)) / sigRange * 100 : 0;
  const isBull2 = sig.c > sig.o;
  const tech = archetypeTech(candles, endIdx);
  const rsi14 = tech.rsi14;
  const cmf20 = tech.cmf20;
  const c1 = isBull2;
  const c2 = diPlus > diMinus;
  const c3 = volRatioD1 >= tuned(key, "minVolRatioD1", 1.2);
  const c4 = stochK >= tuned(key, "minStoch", 35) && stochK <= tuned(key, "maxStoch", 82);
  const c5 = rsi14 >= tuned(key, "minRSI14", 42) && rsi14 <= tuned(key, "maxRSI14", 68);
  const c6 = closeLoc >= tuned(key, "minCloseLoc", 40);
  const c7 = atrComp >= tuned(key, "minAtrComp", 1);
  const c8 = upperWickPct <= tuned(key, "maxUpperWick", 30);
  const conditions = [c1, c2, c3, c4, c5, c6, c7, c8];
  const conditionsMet = conditions.filter(Boolean).length;
  const mandatoryFail = _forensicMode ? !c1 && !c2 : !c1 || !c2;
  if (mandatoryFail) {
    const tuningDebug2 = { isBull: isBull2, diPlus, diMinus, adx, volRatioD1, stochK, rsi14, closeLoc, atrComp, upperWickPct, mfi5, cmf20, volBullDom, atrPct, conditionsMet };
    return attachTuningDebug({ ...base, conditionsMet, totalConditions: 8, archetypeType: "CircuitBreaker", archetypeConditions: conditionsMet, archetypeTotal: 8 }, tuningDebug2);
  }
  if (conditionsMet < (_forensicMode ? 4 : 5)) {
    const tuningDebug2 = { isBull: isBull2, diPlus, diMinus, adx, volRatioD1, stochK, rsi14, closeLoc, atrComp, upperWickPct, mfi5, cmf20, volBullDom, atrPct, conditionsMet };
    return attachTuningDebug({ ...base, conditionsMet, totalConditions: 8, archetypeType: "CircuitBreaker", archetypeConditions: conditionsMet, archetypeTotal: 8 }, tuningDebug2);
  }
  const score = Math.min(100, Math.round(
    (c1 ? 18 : 0) + (c2 ? 16 : 0) + (c3 ? 12 : 0) + (c4 ? 10 : 0) + (c5 ? 9 : 0) + (c6 ? 9 : 0) + (c7 ? 12 : 0) + (c8 ? 5 : 0) + (volRatioD1 >= 1.8 ? 5 : volRatioD1 >= 1.4 ? 2 : 0) + (diPlus >= 25 ? 4 : 0) + (mfi5 >= 50 ? 4 : 0) + (cmf20 >= -0.1 ? 4 : 0) + (volBullDom >= 0.5 ? 3 : 0) + (atrComp >= 1.15 ? 3 : 0)
  ));
  const stage = archetypeStage(conditionsMet, score, "CircuitBreaker");
  const entry = sig.o > 0 ? sig.o : sig.c;
  const sw5Low = endIdx >= 4 ? Math.min(...candles.slice(endIdx - 4, endIdx + 1).map((b) => b.l)) : 0;
  const sw10Low = endIdx >= 9 ? Math.min(...candles.slice(endIdx - 9, endIdx + 1).map((b) => b.l)) : sw5Low;
  const wyckoffStop = computeWyckoffStop(candles, endIdx, sw10Low, atr14);
  const priceEngine = archetypePriceEngine(entry, atr14, sw5Low, "CB", wyckoffStop);
  const techCB = archetypeTech(candles, endIdx);
  priceEngine.breakoutTier = computeBreakoutTier(candles, endIdx, techCB, null);
  const checklist = [
    { label: "Bullish candle (isBull)", pass: c1, value: isBull2 ? "Yes" : "No" },
    { label: "DI+ > DI- (diBull)", pass: c2, value: `DI+ ${diPlus.toFixed(1)} / DI- ${diMinus.toFixed(1)}` },
    { label: "D-1 vol surge \u22651.2\xD7 avg", pass: c3, value: `${volRatioD1.toFixed(2)}\xD7` },
    { label: "Stoch %K 35\u201382", pass: c4, value: stochK.toFixed(1) },
    { label: "RSI14 42\u201368", pass: c5, value: rsi14.toFixed(1) },
    { label: "Close loc \u226540%", pass: c6, value: `${closeLoc.toFixed(1)}%` },
    { label: "ATRc \u22651.0 (expanding)", pass: c7, value: atrComp.toFixed(3) },
    { label: "Upper wick \u226430%", pass: c8, value: `${upperWickPct.toFixed(1)}%` }
  ];
  const tuningDebug = { isBull: isBull2, diPlus, diMinus, adx, volRatioD1, stochK, rsi14, closeLoc, atrComp, upperWickPct, mfi5, cmf20, volBullDom, atrPct, conditionsMet };
  return attachTuningDebug({
    ...base,
    stage,
    inflectionScore: score,
    confidence: score,
    conditionsMet,
    totalConditions: 8,
    closeLoc,
    upperWickPct,
    priceEngine,
    checklist,
    archetypeType: "CircuitBreaker",
    archetypeConditions: conditionsMet,
    archetypeTotal: 8,
    dayChangePct: n > 1 ? (sig.c - candles[n - 2].c) / candles[n - 2].c * 100 : 0
  }, tuningDebug);
}
function computeUCScore(closeLoc, volRatio20, rsi2, rangeATR14, bodyPct, clTrend, rsi2Velocity, volPre5, zoneTightness, volAccel, nearBreakoutTier, archetypeType, upperWickPct, volDryScore, volSurgeScore, weeklyCloseLoc, weeklyBodyPct, magnetFlag) {
  const clComp = Math.min(1, Math.max(0, (closeLoc - 40) / 52)) * UC_SCORE_WEIGHTS.closeLoc_pts;
  const rsiComp = Math.min(1, Math.max(0, (rsi2 - 30) / 70)) * UC_SCORE_WEIGHTS.rsi2_pts;
  const cltComp = clTrend != null ? Math.min(1, Math.max(0, (clTrend + 39) / 85)) * UC_SCORE_WEIGHTS.clTrend_pts : UC_SCORE_WEIGHTS.clTrend_neutral;
  const rsvComp = rsi2Velocity != null ? Math.min(1, Math.max(0, (rsi2Velocity + 36) / 83)) * UC_SCORE_WEIGHTS.rsi2Vel_pts : UC_SCORE_WEIGHTS.rsi2Vel_neutral;
  const rngComp = Math.min(1, Math.max(0, (rangeATR14 - 0.5) / 1.2)) * UC_SCORE_WEIGHTS.rangeATR_pts;
  const bPComp = Math.min(1, Math.max(0, (bodyPct - 15) / 56)) * UC_SCORE_WEIGHTS.bodyPct_pts;
  const volMax = Math.max(volRatio20, volPre5 ?? 0);
  const volBonus = volMax >= 3.5 ? UC_SCORE_WEIGHTS.volBonus_3x5 : volMax >= 3 ? UC_SCORE_WEIGHTS.volBonus_3x5 : volMax >= 2 ? UC_SCORE_WEIGHTS.volBonus_2x : volMax >= 1.5 ? UC_SCORE_WEIGHTS.volBonus_1x5 : 0;
  const ztComp = zoneTightness != null ? Math.min(1, Math.max(0, (8 - zoneTightness) / 6)) * UC_SCORE_WEIGHTS.zoneTight_pts : UC_SCORE_WEIGHTS.zoneTight_neutral;
  const vaComp = volAccel != null ? Math.min(1, Math.max(0, (volAccel - 0.8) / 2.2)) * UC_SCORE_WEIGHTS.volAccel_pts : UC_SCORE_WEIGHTS.volAccel_neutral;
  const nbtComp = nearBreakoutTier === "A+" ? UC_SCORE_WEIGHTS.nearBrkAPlus_pts : nearBreakoutTier === "A" ? UC_SCORE_WEIGHTS.nearBrkA_pts : 0;
  const archComp = archetypeType === "VolumeFootprint" ? UC_SCORE_WEIGHTS.archVF_pts : archetypeType === "MomentumPocket" ? UC_SCORE_WEIGHTS.archMP_pts : archetypeType === "CompressionCoil" ? UC_SCORE_WEIGHTS.archCC_pts : archetypeType ? UC_SCORE_WEIGHTS.archOther_pts : 0;
  let volDrySurgeComp = 0;
  if (volDryScore != null && volSurgeScore != null) {
    const dryDepth = Math.min(1, Math.max(0, 1 - volDryScore));
    const surgeStr = Math.min(1, Math.max(0, (volSurgeScore - 2) / 8));
    volDrySurgeComp = dryDepth * surgeStr * UC_SCORE_WEIGHTS.volDrySurge_pts;
  }
  const weeklyResComp = weeklyCloseLoc != null && weeklyCloseLoc >= 70 && (weeklyBodyPct ?? 0) >= 25 ? UC_SCORE_WEIGHTS.weeklyResonate_pts : 0;
  const magnetComp = magnetFlag ? UC_SCORE_WEIGHTS.magnetFlag_pts : 0;
  const uw = upperWickPct ?? 50;
  const morphComp = bodyPct < 25 && uw < 20 ? UC_SCORE_WEIGHTS.morphCoiledSpring_pts : bodyPct < 25 && uw > 35 ? -UC_SCORE_WEIGHTS.morphGravestone_penalty : 0;
  const uwContinuousComp = upperWickPct != null ? Math.min(1, Math.max(0, (30 - upperWickPct) / 30)) * UC_SCORE_WEIGHTS.upperWick_pts : UC_SCORE_WEIGHTS.upperWick_neutral;
  const ucScore = Math.round(Math.min(
    100,
    clComp + rsiComp + cltComp + rsvComp + rngComp + bPComp + volBonus + ztComp + vaComp + nbtComp + archComp + volDrySurgeComp + weeklyResComp + magnetComp + morphComp + uwContinuousComp
  ));
  const ucGoldmine = volRatio20 >= 3 && (closeLoc >= 75 || rsi2 >= 70);
  const ucStrong = volRatio20 >= 3 && closeLoc >= 75;
  const ucElite = volRatio20 >= 3 && closeLoc >= 75 && (bodyPct >= 50 || (upperWickPct ?? 100) <= 20);
  const ucClass = volRatio20 >= 3 && closeLoc >= 75 && rsi2 >= 70 ? "PRIME" : volMax >= 2 && (closeLoc >= 65 || rsi2 >= 60) ? "WATCH" : zoneTightness != null && zoneTightness < 6 && volMax < 2 ? "ZONE" : "COLD";
  const ucFeatureHits = [
    closeLoc >= 70,
    // CL in top 30% of range (d=0.20)
    rsi2 >= 65,
    // Short-term momentum rising (d=0.02 live but directional signal)
    rangeATR14 >= 1,
    // Wide-range expansion day (d=1.05 — strongest non-vol feature)
    volMax >= 2,
    // Vol surge ≥2x any baseline (d=1.21 strongest overall)
    volDrySurgeComp > 0,
    // Dry+surge accumulation pattern detected
    weeklyResComp > 0,
    // Multi-timeframe weekly resonance confirmed
    !!magnetFlag
    // Psychological round-number spring
  ].filter(Boolean).length;
  return { ucScore, ucGoldmine, ucStrong, ucElite, ucClass, ucFeatureHits };
}
function analyzeStock(candles, paramSetKey, enrich = true, forensicMode = false) {
  const noSignalBase = (symbol = "UNKNOWN") => ({
    symbol,
    stage: "NO_SIGNAL",
    inflectionScore: 0,
    confidence: 0,
    paramSetKey,
    lastClose: candles.length > 0 ? candles[candles.length - 1].c : 0,
    lastDate: candles.length > 0 ? new Date(candles[candles.length - 1].ts * 1e3).toISOString().slice(0, 10) : "",
    avgTurnover20: 0,
    atrPct14: 0,
    atrPct14Pctl120: 0,
    volRatio20: 0,
    rsi2: 50,
    rsi14: 50,
    zone: null,
    pre10AvgRangeATR: 0,
    pre10ExpansionCount: 0,
    pre10AvgVolRatio: 0,
    pre5AvgVolRatio: 0,
    pre10HighVolCount: 0,
    pre10RedVolBias: 0,
    exactRangeATR14: 0,
    exactVolRatio20: 0,
    exactVolVsPre5: 0,
    closeLoc: 0,
    upperWickPct: 0,
    bodyPct: 0,
    signalRangePct: 0,
    volatilityExpansionRatio: 0,
    ultraPrecisionScore: 0,
    candleQualityScore: 0,
    priceEngine: buildNullPriceEngine(),
    conditionsMet: 0,
    totalConditions: 20,
    checklist: [],
    momentum: {
      emaAligned: false,
      ema20: 0,
      ema50: 0,
      higherLowConfirmed: false,
      swingLow20: 0,
      volDryUpScore: 0,
      obvSlope10: 0,
      adx14: 20,
      adxInRange: true,
      gapAdjustedRR: 0,
      momentumScore: 0,
      rsNifty20: 1
    },
    nearBreakoutPct: 99,
    nearBreakout: false,
    nearBreakoutTier: null,
    stats: { volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false, lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false, skewness20: 0, positiveSkew: false, drawdownFrom52WH: 0, pctFrom52WL: 0, sharpe20: 0, entropy10: 0, cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1, ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false, rsi14: 50, cci34: 0, ema10: 0, ema21: 0, ema55: 0, sma200: 0, ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false, guppySpreadPct: 99, guppyCompressed: false, guppyUltraCompressed: false, guppyCompressDays: 0, guppyCleanBullishFan: false, guppyGroupGapPct: 0, guppyCoiledRelease: false, guppySpring: false, guppyPrimed: false, candlePattern: "\u2014", candlePatternFull: "Unknown", candlePatternType: "neutral", candlePatternStrength: 0, statsScore: 0 },
    clusterBreakdown: { deployable: { met: 0, total: 21 }, highPrecision: { met: 0, total: 19 }, elite: { met: 0, total: 21 }, ultraSelective: { met: 0, total: 20 }, sniper: { met: 0, total: 21 } },
    monster: { badges: [], topProbability: 0 },
    dayChangePct: 0,
    candleDNA: { score: 0, upperWickQuality: 0, closeLocationQuality: 0, supportTailQuality: 0, volumeContextScore: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, volumeRatio: 0, springDepth: 0, predecessorScore: 0, tier: "WEAK" }
  });
  _forensicMode = forensicMode;
  let result;
  if (paramSetKey === "ors_prime_reversal") result = analyzeORS(candles);
  else if (paramSetKey === "optimized_deployable_20plus") result = analyzeVolumeFootprint(candles);
  else if (paramSetKey === "optimized_highprecision_15plus") result = analyzeCompressionCoil(candles);
  else if (paramSetKey === "optimized_elite_10plus") result = analyzeMomentumPocket(candles);
  else if (paramSetKey === "optimized_ultraselective_8plus") result = analyzeEMAStack(candles);
  else if (paramSetKey === "sniper_95plus") result = analyzePerfectStorm(candles);
  else if (paramSetKey === "circuit_breaker_v2") result = analyzeCircuitBreaker(candles);
  else {
    _forensicMode = false;
    return noSignalBase();
  }
  _forensicMode = false;
  const n = candles.length;
  if (n >= 30 && enrich) {
    const endIdx = n - 1;
    const atr14Val = computeATR14(candles)[endIdx] || candles[endIdx].c * 0.02;
    try {
      const sf = computeStatsFeatures(candles, endIdx);
      result.stats = { ...result.stats, ...sf };
    } catch {
    }
    try {
      result.advanced = computeAdvancedFeatures(candles, endIdx, atr14Val);
    } catch {
    }
    if (result.momentum.volDryUpScore === 0) {
      try {
        result.momentum.volDryUpScore = computeVolDryUpScore(candles, endIdx);
      } catch {
      }
    }
    if (!result.zone) {
      try {
        const atr14Arr = computeATR14(candles);
        const ps = PARAM_SETS[paramSetKey];
        if (ps && ps.minZoneLen > 0) {
          result.zone = findCompressionZone(candles, atr14Arr, ps, endIdx);
        }
      } catch {
      }
    }
    if (!result.volatilityExpansionRatio || result.volatilityExpansionRatio === 0) {
      result.volatilityExpansionRatio = result.exactRangeATR14 || 0;
    }
    if (!result.nearBreakoutTier) {
      try {
        const lookback = Math.min(252, n);
        let high52w = 0;
        for (let i = n - lookback; i < n; i++) high52w = Math.max(high52w, candles[i].h);
        const lastClose = candles[endIdx].c;
        if (high52w > 0 && lastClose > 0) {
          const distPct = (high52w - lastClose) / high52w * 100;
          result.nearBreakoutPct = Math.max(0, distPct);
          result.nearBreakout = distPct <= 2.5;
          result.nearBreakoutTier = distPct <= 1 ? "IMMINENT" : distPct <= 2.5 ? "NEAR" : distPct <= 5 ? "WATCH" : distPct <= 10 ? "EARLY" : null;
        }
      } catch {
      }
    }
    if (result.atrPct14Pctl120 === 0) {
      try {
        const atr14Arr2 = computeATR14(candles);
        const curAtrPct = atr14Arr2[endIdx] > 0 && candles[endIdx].c > 0 ? atr14Arr2[endIdx] / candles[endIdx].c * 100 : 0;
        if (curAtrPct > 0) {
          const lb120 = Math.max(1, endIdx - 119);
          let below = 0, cnt = 0;
          for (let i = lb120; i < endIdx; i++) {
            const ap = atr14Arr2[i] > 0 && candles[i].c > 0 ? atr14Arr2[i] / candles[i].c * 100 : 0;
            if (ap > 0) {
              if (ap <= curAtrPct) below++;
              cnt++;
            }
          }
          result.atrPct14Pctl120 = cnt > 0 ? below / cnt * 100 : 50;
        }
      } catch {
      }
    }
    if (result.priceEngine.efficiencyRatio === 0) {
      try {
        const sig8 = candles[endIdx];
        const atr8 = atr14Val;
        const per8 = Math.min(10, endIdx);
        let path8 = 0;
        for (let i = endIdx - per8 + 1; i <= endIdx; i++) path8 += Math.abs(candles[i].c - candles[i - 1].c);
        const netChange8 = Math.abs(sig8.c - candles[endIdx - per8].c);
        result.priceEngine.efficiencyRatio = path8 > 0 ? Math.min(1, netChange8 / path8) : 0.5;
        const hh3 = endIdx >= 2 ? Math.max(...candles.slice(endIdx - 2, endIdx + 1).map((c) => c.h)) : sig8.h;
        const hh5 = endIdx >= 4 ? Math.max(...candles.slice(endIdx - 4, endIdx + 1).map((c) => c.h)) : sig8.h;
        const hh10 = endIdx >= 9 ? Math.max(...candles.slice(endIdx - 9, endIdx + 1).map((c) => c.h)) : sig8.h;
        result.priceEngine.chandelierT1 = Math.max(0, hh3 - 2 * atr8);
        result.priceEngine.chandelierT2 = Math.max(0, hh5 - 2.5 * atr8);
        result.priceEngine.chandelierT3 = Math.max(0, hh10 - 4 * atr8);
        if (endIdx > 0) {
          const prevC = candles[endIdx - 1].c;
          result.priceEngine.gapATR = atr8 > 0 ? Math.abs(sig8.o - prevC) / atr8 : 0;
          result.priceEngine.gapPct = prevC > 0 ? (sig8.o - prevC) / prevC * 100 : 0;
        }
      } catch {
      }
    }
    if (result.exactVolVsPre5 === 0 && endIdx >= 5) {
      try {
        const sig9 = candles[endIdx];
        let v5s = 0;
        for (let i = endIdx - 5; i < endIdx; i++) v5s += candles[i].v;
        const vAvg5 = v5s / 5;
        result.exactVolVsPre5 = vAvg5 > 0 ? sig9.v / vAvg5 : 0;
        let redVol = 0, redCnt = 0, greenVol = 0, greenCnt = 0;
        for (let i = Math.max(0, endIdx - 10); i < endIdx; i++) {
          if (candles[i].c < candles[i].o) {
            redVol += candles[i].v;
            redCnt++;
          } else {
            greenVol += candles[i].v;
            greenCnt++;
          }
        }
        const avgRed = redCnt > 0 ? redVol / redCnt : 0;
        const avgGreen = greenCnt > 0 ? greenVol / greenCnt : 1;
        result.pre10RedVolBias = avgGreen > 0 ? avgRed / avgGreen : 1;
      } catch {
      }
    }
    if (result.stage === "ULTRA_STRONG_BUY" && result.archetypeType !== "ORS" && result.archetypeType !== "CircuitBreaker") {
      try {
        let p10 = result.pre10AvgRangeATR;
        if ((!p10 || p10 === 0) && endIdx >= 24 && atr14Val > 0) {
          let p10s = 0, p10n = 0;
          for (let i = Math.max(0, endIdx - 10); i < endIdx; i++) {
            const bar = candles[i];
            p10s += (bar.h - bar.l) / atr14Val;
            p10n++;
          }
          p10 = p10n > 0 ? p10s / p10n : 1;
        }
        const vp5 = result.exactVolVsPre5;
        const extEliteOk = p10 <= 1.35 && vp5 >= 2.5;
        if (!extEliteOk) result.stage = "STRONG_BUY";
      } catch {
      }
    }
    if (result.stage === "ULTRA_STRONG_BUY" && result.archetypeType !== "ORS" && result.archetypeType !== "CircuitBreaker" && endIdx >= 50) {
      try {
        const sig9c = candles[endIdx];
        const k20 = 2 / 21, k50 = 2 / 51;
        let s20 = 0, e20 = 0, s50 = 0, e50 = 0;
        for (let i = 0; i <= endIdx; i++) {
          const c = candles[i].c;
          s20 += c;
          if (i === 19) {
            e20 = s20 / 20;
          } else if (i > 19) {
            e20 = c * k20 + e20 * (1 - k20);
          }
          s50 += c;
          if (i === 49) {
            e50 = s50 / 50;
          } else if (i > 49) {
            e50 = c * k50 + e50 * (1 - k50);
          }
        }
        if (!(sig9c.c > e20 && e20 > e50)) result.stage = "STRONG_BUY";
      } catch {
      }
    }
    try {
      result.practicalOverlay = evaluatePracticalTradeOverlay(candles, endIdx, result, atr14Val);
    } catch {
      result.practicalOverlay = null;
    }
    try {
      const dmi = computeDMI(candles, 14);
      const adxVal = dmi.adx[endIdx] ?? 20;
      result.adx14 = adxVal;
      const vol = result.exactVolRatio20;
      const rsi14v = result.rsi14;
      const rsi2v = result.rsi2;
      const body2 = result.bodyPct;
      const cloc = result.closeLoc;
      if (paramSetKey === "optimized_deployable_20plus") {
        result.hitRateGate = rsi14v >= 55 && rsi2v <= 80 && vol >= 2.5 && adxVal >= 30 && body2 >= 0.3 && cloc >= 0.7 ? "PREMIUM" : "STANDARD";
      } else if (paramSetKey === "optimized_highprecision_15plus") {
        result.hitRateGate = result.practicalOverlay?.passed ? "PREMIUM" : "STANDARD";
      } else if (paramSetKey === "optimized_elite_10plus") {
        result.hitRateGate = result.practicalOverlay?.passed ? "PREMIUM" : "STANDARD";
      } else if (paramSetKey === "optimized_ultraselective_8plus") {
        result.hitRateGate = result.practicalOverlay?.passed ? "PREMIUM" : "STANDARD";
      } else if (paramSetKey === "sniper_95plus") {
        result.hitRateGate = result.atrPct14 >= 3 && body2 >= 35 ? "PREMIUM" : "STANDARD";
      } else if (paramSetKey === "ors_prime_reversal") {
        result.hitRateGate = adxVal >= 20 ? "PREMIUM" : "STANDARD";
      } else {
        result.hitRateGate = null;
      }
      result.bodyGate = body2 >= 35;
      if (WATCHLIST_ONLY_PARAM_SETS.has(paramSetKey)) {
        result.tradePromoted = false;
      } else if (paramSetKey === "sniper_95plus") {
        const _pe = result.priceEngine;
        const _t1Pct = _pe?.target5 > 0 && _pe?.plannedEntry > 0 ? (_pe.target5 - _pe.plannedEntry) / _pe.plannedEntry * 100 : 0;
        result.tradePromoted = isActionableStage(result.stage) && (result.ucScore ?? 0) >= 65 && _t1Pct >= 8 && (result.practicalOverlay?.passed ?? false);
      } else if (paramSetKey === "optimized_deployable_20plus") {
        const _pe = result.priceEngine;
        const _t2Pct = _pe?.target7 > 0 && _pe?.plannedEntry > 0 ? (_pe.target7 - _pe.plannedEntry) / _pe.plannedEntry * 100 : 0;
        const _deployStage = isActionableStage(result.stage) || result.stage === "PRE_BREAKOUT";
        result.tradePromoted = _deployStage && (result.ucScore ?? 0) >= 60 && _t2Pct >= 4 && (result.practicalOverlay?.passed ?? false);
      } else if (paramSetKey === "circuit_breaker_v2") {
        const _pe = result.priceEngine;
        const _t1Pct = _pe?.target5 > 0 && _pe?.plannedEntry > 0 ? (_pe.target5 - _pe.plannedEntry) / _pe.plannedEntry * 100 : 0;
        result.tradePromoted = isActionableStage(result.stage) && (result.ucScore ?? 0) >= 70 && _t1Pct >= 8 && (result.practicalOverlay?.passed ?? false);
      } else if (paramSetKey === "optimized_elite_10plus") {
        result.tradePromoted = isActionableStage(result.stage) && (result.ucScore ?? 0) >= 55 && (result.practicalOverlay?.passed ?? false);
      } else if (paramSetKey === "optimized_highprecision_15plus") {
        const _pe = result.priceEngine;
        const _entry = _pe?.plannedEntry ?? 0;
        const _stop = _pe?.tacticalStop ?? 0;
        const _t1 = _pe?.target5 ?? 0;
        const _stopGapPct = _entry > 0 && _stop > 0 && _stop < _entry ? (_entry - _stop) / _entry * 100 : 0;
        const _ccT1Pct = _entry > 0 && _t1 > _entry ? (_t1 - _entry) / _entry * 100 : 0;
        result.tradePromoted = isActionableStage(result.stage) && (result.ucScore ?? 0) >= 60 && _stopGapPct >= 3 && _ccT1Pct >= 1 && _ccT1Pct <= 25 && (result.practicalOverlay?.passed ?? false);
      } else if (result.practicalOverlay) {
        result.tradePromoted = isActionableStage(result.stage) && result.practicalOverlay.passed;
      } else if (paramSetKey === "ors_prime_reversal") {
        result.tradePromoted = isActionableStage(result.stage) && result.hitRateGate === "PREMIUM";
      }
      if ((paramSetKey === "optimized_ultraselective_8plus" || paramSetKey === "sniper_95plus") && result.hitRateGate === "PREMIUM") {
        result.bullPoolSignal = true;
        result.regimeSignal = "BULL_POOL";
      } else if (paramSetKey === "ors_prime_reversal") {
        result.bullPoolSignal = false;
        result.regimeSignal = "BEAR_ORS";
      } else {
        result.bullPoolSignal = false;
        result.regimeSignal = null;
      }
    } catch {
    }
    try {
      let clTrend;
      if (candles.length >= 3) {
        const d1 = candles[candles.length - 1];
        const d3 = candles[candles.length - 3];
        const cl1 = d1.h > d1.l ? (d1.c - d1.l) / (d1.h - d1.l) * 100 : 50;
        const cl3 = d3.h > d3.l ? (d3.c - d3.l) / (d3.h - d3.l) * 100 : 50;
        clTrend = cl1 - cl3;
      }
      let rsi2Velocity;
      if (candles.length >= 25) {
        const rsi2D3 = computeRSI(candles.slice(0, candles.length - 2), 2);
        rsi2Velocity = (result.rsi2 ?? 50) - rsi2D3;
      }
      let volPre5;
      if (candles.length >= 6) {
        const curVol = candles[candles.length - 1].v;
        const prev5 = candles.slice(candles.length - 6, candles.length - 1);
        const avg5 = prev5.reduce((s, c) => s + c.v, 0) / 5;
        if (avg5 > 0) volPre5 = curVol / avg5;
      }
      let volDryScore;
      let volSurgeScore;
      if (candles.length >= 21) {
        const curVol = candles[candles.length - 1].v;
        const dryBars = candles.slice(candles.length - 5, candles.length - 2);
        const baseBars = candles.slice(candles.length - 21, candles.length - 5);
        const dryAvg = dryBars.reduce((s, c) => s + c.v, 0) / dryBars.length;
        const baseAvg = baseBars.reduce((s, c) => s + c.v, 0) / baseBars.length;
        if (dryAvg > 0 && baseAvg > 0) {
          volDryScore = dryAvg / baseAvg;
          volSurgeScore = curVol / dryAvg;
        }
      }
      let weeklyCloseLoc;
      let weeklyBodyPct;
      if (candles.length >= 6) {
        const wk = candles.slice(candles.length - 6, candles.length - 1);
        const wH = Math.max(...wk.map((c) => c.h));
        const wL = Math.min(...wk.map((c) => c.l));
        const wO = wk[0].o;
        const wC = wk[wk.length - 1].c;
        if (wH > wL) {
          weeklyCloseLoc = (wC - wL) / (wH - wL) * 100;
          weeklyBodyPct = Math.abs(wC - wO) / (wH - wL) * 100;
        }
      }
      const ROUND_LVLS = [10, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 750, 1e3, 1250, 1500, 2e3, 2500, 3e3, 5e3, 1e4];
      const closePrice = result.lastClose ?? 0;
      const nearRound = ROUND_LVLS.find((lvl) => lvl > closePrice) ?? null;
      const magnetFlag = nearRound != null && closePrice > 0 && (nearRound - closePrice) / closePrice <= 0.03 && (result.closeLoc ?? 0) >= 70;
      const { ucScore, ucGoldmine, ucStrong, ucElite, ucClass, ucFeatureHits } = computeUCScore(
        result.closeLoc ?? 50,
        result.exactVolRatio20 ?? result.volRatio20 ?? 1,
        result.rsi2 ?? 50,
        result.exactRangeATR14 ?? 1,
        result.bodyPct ?? 0,
        clTrend,
        rsi2Velocity,
        volPre5,
        result.zone?.zoneTightnessPct,
        result.exactVolVsPre5 ?? volPre5,
        result.priceEngine?.breakoutTier ?? null,
        result.archetypeType ?? null,
        result.upperWickPct ?? null,
        volDryScore,
        volSurgeScore,
        weeklyCloseLoc,
        weeklyBodyPct,
        magnetFlag
      );
      result.ucScore = ucScore;
      result.ucGoldmine = ucGoldmine;
      result.ucStrong = ucStrong;
      result.ucElite = ucElite;
      result.ucClass = ucClass;
      result.ucFeatureHits = ucFeatureHits;
      result.clTrend = clTrend;
      result.rsi2Velocity = rsi2Velocity;
      result.volDryScore = volDryScore;
      result.volSurgeScore = volSurgeScore;
      result.weeklyCloseLoc = weeklyCloseLoc;
      result.magnetFlag = magnetFlag;
      const _bp = result.bodyPct ?? 50;
      const _uw = result.upperWickPct ?? 50;
      result.morphType = _bp < 25 && _uw < 20 ? "coiled_spring" : _bp < 25 && _uw > 35 ? "gravestone" : null;
      if (forensicMode) {
        if (result.stage === "PRE_BREAKOUT" && ucScore >= 58) {
          result.stage = "BUY";
        } else if (result.stage === "EARLY_INFLECTION" && ucScore >= 75) {
          result.stage = "BUY";
        } else if (result.stage === "EARLY_INFLECTION" && ucScore >= 62) {
          result.stage = ucScore >= 58 ? "BUY" : "PRE_BREAKOUT";
        }
        if (result.ucElite && result.stage !== "BUY" && result.stage !== "STRONG_BUY" && result.stage !== "ULTRA_STRONG_BUY") {
          result.stage = "BUY";
        }
        if (result.stage === "NO_SIGNAL") {
          if (ucScore >= 65) result.stage = "EARLY_INFLECTION";
          else if (ucScore >= 45) result.stage = "COMPRESSION_WATCH";
        }
      }
      if (!forensicMode) {
        if (result.stage === "PRE_BREAKOUT") {
          const body2 = result.bodyPct ?? 100;
          const wick = result.upperWickPct ?? 0;
          if (body2 < 22 && wick > 40) {
            result.stage = "EARLY_INFLECTION";
            result.weakPBFlag = true;
          } else if (ucScore >= 58) {
            result.stage = "BUY";
          }
        }
        if (result.stage === "EARLY_INFLECTION" && (result.rsi2 ?? 0) >= 70) {
          result.stage = ucScore >= 58 ? "BUY" : "PRE_BREAKOUT";
        }
        if (result.stage === "NO_SIGNAL") {
          if (ucScore >= 65) result.stage = "EARLY_INFLECTION";
          else if (ucScore >= 45) result.stage = "COMPRESSION_WATCH";
        }
        if (result.stage === "COMPRESSION_WATCH" && ucScore >= 65) {
          result.stage = "EARLY_INFLECTION";
        }
      }
    } catch {
    }
  }
  return result;
}
function detectMonster(candles, endIdx, result) {
  const badges = [];
  const sig = candles[endIdx];
  if (!sig || sig.c <= 0 || endIdx < 50) return { badges, topProbability: 0 };
  const rng = sig.h - sig.l;
  const atrPct = result.atrPct14;
  const mom5 = endIdx >= 5 ? (sig.c - candles[endIdx - 5].c) / candles[endIdx - 5].c * 100 : 0;
  let sma50 = 0;
  if (endIdx >= 49) {
    let s = 0;
    for (let j = endIdx - 49; j <= endIdx; j++) s += candles[j].c;
    sma50 = s / 50;
  }
  const aboveSMA50 = sig.c > sma50 && sma50 > 0;
  const eRA = result.exactRangeATR14;
  const vr = result.volRatio20;
  let high50 = 0;
  for (let j = Math.max(0, endIdx - 50); j < endIdx; j++) {
    if (candles[j].h > high50) high50 = candles[j].h;
  }
  const swingDist = high50 > 0 ? (sig.c - high50) / high50 * 100 : 0;
  const pre10VR = result.pre10AvgVolRatio;
  const rsi2 = result.rsi2;
  const lowerWick2 = rng > 0 ? (Math.min(sig.c, sig.o) - sig.l) / rng * 100 : 0;
  if (mom5 >= 7 && eRA >= 1.2 && vr >= 1 && atrPct >= 4.5 && aboveSMA50) {
    badges.push({ type: "MOM", probability: 51, details: `Mom5 ${mom5.toFixed(1)}%, eRA ${eRA.toFixed(1)}, VR ${vr.toFixed(1)}x, ATR ${atrPct.toFixed(1)}%, >SMA50 \u2014 OOS-validated` });
  }
  if (swingDist <= -30 && rsi2 <= 60 && pre10VR <= 0.3) {
    badges.push({ type: "MRV", probability: 89, details: `Swing ${swingDist.toFixed(0)}%, RSI2 ${rsi2.toFixed(0)}, PreVR ${pre10VR.toFixed(2)} \u2014 OOS-validated, strongest pattern` });
  }
  const topProbability = badges.length > 0 ? Math.max(...badges.map((b) => b.probability)) : 0;
  return { badges, topProbability };
}
function detectCandleDNA(candles, endIdx, atr14) {
  const sig = candles[endIdx];
  if (!sig || atr14 <= 0) {
    return { score: 0, upperWickQuality: 0, closeLocationQuality: 0, supportTailQuality: 0, volumeContextScore: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, volumeRatio: 0, springDepth: 0, predecessorScore: 0, tier: "WEAK" };
  }
  const rng = sig.h - sig.l;
  if (rng <= 0) {
    return { score: 0, upperWickQuality: 0, closeLocationQuality: 0, supportTailQuality: 0, volumeContextScore: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, volumeRatio: 0, springDepth: 0, predecessorScore: 0, tier: "WEAK" };
  }
  const bodySize = Math.abs(sig.c - sig.o);
  const upperWickAbs = sig.h - Math.max(sig.c, sig.o);
  const lowerWickAbs = Math.min(sig.c, sig.o) - sig.l;
  const upperWickPct = upperWickAbs / rng * 100;
  const lowerWickPct = lowerWickAbs / rng * 100;
  const bodyATR = bodySize / atr14;
  const eRA = rng / atr14;
  const upperToLowerWickRatio = lowerWickAbs > 1e-3 ? upperWickAbs / lowerWickAbs : upperWickAbs > 1e-3 ? 99 : 1;
  const marubozuScore = Math.max(0, 100 - (upperWickPct + lowerWickPct));
  const upperWickATR = upperWickAbs / atr14;
  const lowerWickATR = lowerWickAbs / atr14;
  const closeLoc0 = (sig.c - sig.l) / rng * 100;
  const cl1 = endIdx >= 1 ? (() => {
    const p = candles[endIdx - 1];
    const r = p.h - p.l;
    return r > 0 ? (p.c - p.l) / r * 100 : 50;
  })() : closeLoc0;
  const cl2 = endIdx >= 2 ? (() => {
    const p = candles[endIdx - 2];
    const r = p.h - p.l;
    return r > 0 ? (p.c - p.l) / r * 100 : 50;
  })() : closeLoc0;
  const avgCL3 = (closeLoc0 + cl1 + cl2) / 3;
  let upperWickQuality = 0;
  if (upperWickATR < 0.02) upperWickQuality = 40;
  else if (upperWickATR < 0.08) upperWickQuality = 30;
  else if (upperWickATR < 0.15) upperWickQuality = 18;
  else if (upperWickATR < 0.25) upperWickQuality = 10;
  else if (upperWickATR < 0.5) upperWickQuality = 4;
  let closeQuality = 0;
  if (avgCL3 > 85) closeQuality = 35;
  else if (avgCL3 > 75) closeQuality = 28;
  else if (avgCL3 > 65) closeQuality = 22;
  else if (avgCL3 > 55) closeQuality = 12;
  else if (avgCL3 > 45) closeQuality = 5;
  let supportTail = 0;
  if (lowerWickATR > 0.6) supportTail = 25;
  else if (lowerWickATR > 0.4) supportTail = 20;
  else if (lowerWickATR > 0.25) supportTail = 14;
  else if (lowerWickATR > 0.15) supportTail = 8;
  else if (lowerWickATR > 0.08) supportTail = 4;
  const avgVol20 = endIdx >= 20 ? candles.slice(endIdx - 20, endIdx).reduce((s, c) => s + (c.v || 0), 0) / 20 : sig.v || 0;
  const volumeRatio = avgVol20 > 0 ? safe3((sig.v || 0) / avgVol20) : 1;
  let volumeContextScore = 0;
  if (volumeRatio > 1.5 && bodyATR < 0.35 && avgCL3 > 65) {
    volumeContextScore = 20;
  } else if (volumeRatio > 1.2 && lowerWickATR > 0.2) {
    volumeContextScore = 15;
  } else if (volumeRatio > 1 && upperWickATR < 0.05) {
    volumeContextScore = 10;
  } else if (volumeRatio < 0.7) {
    volumeContextScore = -5;
  }
  const lookback = Math.min(10, endIdx);
  const recent10Low = endIdx >= 1 ? Math.min(...candles.slice(Math.max(0, endIdx - lookback), endIdx).map((c) => c.l)) : sig.l;
  const springDepth = sig.l < recent10Low && sig.c > recent10Low ? safe3((recent10Low - sig.l) / atr14) : 0;
  let predecessorScore = 0;
  if (springDepth > 0.5) {
    predecessorScore = 20;
  } else if (springDepth > 0) {
    predecessorScore = 15;
  }
  if (endIdx >= 1) {
    const prev = candles[endIdx - 1];
    const prevBodySize = Math.abs(prev.c - prev.o);
    const curBodySize = Math.abs(sig.c - sig.o);
    if (prev.c < prev.o && sig.c > sig.o && curBodySize >= prevBodySize * 0.8) {
      predecessorScore = Math.min(20, predecessorScore + 5);
    }
  }
  const score = Math.min(100, Math.max(0, upperWickQuality + closeQuality + supportTail + volumeContextScore + predecessorScore));
  const tier = score >= 75 ? "ELITE" : score >= 50 ? "STRONG" : score >= 30 ? "GOOD" : "WEAK";
  return {
    score,
    upperWickQuality,
    closeLocationQuality: closeQuality,
    supportTailQuality: supportTail,
    volumeContextScore,
    bodyATR: safe3(bodyATR),
    upperToLowerWickRatio: safe3(upperToLowerWickRatio),
    marubozuScore: safe3(marubozuScore),
    volumeRatio,
    springDepth,
    predecessorScore,
    tier
  };
}
function generateDemoData(paramSetKey, count = 25) {
  const symbols = [
    "RELIANCE.NS",
    "TCS.NS",
    "INFY.NS",
    "HDFCBANK.NS",
    "ICICIBANK.NS",
    "WIPRO.NS",
    "LT.NS",
    "AXISBANK.NS",
    "MARUTI.NS",
    "TATAMOTORS.NS",
    "SUNPHARMA.NS",
    "BAJFINANCE.NS",
    "KOTAKBANK.NS",
    "ITC.NS",
    "NESTLEIND.NS",
    "TATASTEEL.NS",
    "HINDALCO.NS",
    "JSWSTEEL.NS",
    "ULTRACEMCO.NS",
    "GRASIM.NS",
    "POWERGRID.NS",
    "NTPC.NS",
    "ONGC.NS",
    "BPCL.NS",
    "COALINDIA.NS"
  ];
  const rnd = (seed, lo, hi) => {
    const x = Math.sin(seed * 9301 + 49297) * 233280;
    const r = x - Math.floor(x);
    return lo + r * (hi - lo);
  };
  const stageDistribution = [
    "ULTRA_STRONG_BUY",
    "ULTRA_STRONG_BUY",
    "ULTRA_STRONG_BUY",
    "STRONG_BUY",
    "STRONG_BUY",
    "STRONG_BUY",
    "STRONG_BUY",
    "BUY",
    "BUY",
    "BUY",
    "BUY",
    "BUY",
    "PRE_BREAKOUT",
    "PRE_BREAKOUT",
    "PRE_BREAKOUT",
    "PRE_BREAKOUT",
    "EARLY_INFLECTION",
    "EARLY_INFLECTION",
    "EARLY_INFLECTION",
    "COMPRESSION_WATCH",
    "COMPRESSION_WATCH",
    "COMPRESSION_WATCH",
    "NO_SIGNAL",
    "NO_SIGNAL",
    "NO_SIGNAL"
  ];
  const params = PARAM_SETS[paramSetKey];
  const results = [];
  const baseTs = Math.floor(Date.now() / 1e3) - 86400;
  for (let i = 0; i < Math.min(count, symbols.length); i++) {
    const symbol = symbols[i];
    const stage = stageDistribution[i % stageDistribution.length];
    const seed = i + 1;
    const isActionable = stage === "BUY" || stage === "STRONG_BUY" || stage === "ULTRA_STRONG_BUY";
    const hasZone = stage !== "NO_SIGNAL";
    const lastClose = Math.round(rnd(seed, 100, 5e3) * 100) / 100;
    const atrPct14 = rnd(seed + 1, 0.5, 4.5);
    const atrPct14Pctl120 = stage === "NO_SIGNAL" ? rnd(seed + 2, 76, 99) : rnd(seed + 2, 20, 65);
    const avgTurnover20 = rnd(seed + 3, 15e6, 5e8);
    const volRatio20 = isActionable ? rnd(seed + 4, 1.5, 4) : rnd(seed + 4, 0.4, 1.2);
    const rsi2val = isActionable ? rnd(seed + 5, 55, 90) : rnd(seed + 5, 30, 65);
    const rsi14val = rnd(seed + 6, 40, 75);
    const zoneTightnessPct = hasZone ? stage === "ULTRA_STRONG_BUY" || stage === "STRONG_BUY" ? rnd(seed + 7, 2, 7) : rnd(seed + 7, 5, 14) : 0;
    const zoneWindowLength = hasZone ? Math.round(rnd(seed + 8, params.minZoneLen, params.maxZoneLen)) : 0;
    const zoneHigh = lastClose * (isActionable ? 0.998 : 0.985);
    const zoneLow = zoneHigh * (1 - zoneTightnessPct / 100);
    const zone = hasZone ? {
      zoneHigh,
      zoneLow,
      zoneATRRatio: rnd(seed + 9, 0.3, 0.8),
      zoneTightnessPct,
      windowLength: zoneWindowLength
    } : null;
    const pre10AvgRangeATR = isActionable ? rnd(seed + 10, 0.3, 0.7) : rnd(seed + 10, 0.5, 1.2);
    const pre10ExpansionCount = Math.round(rnd(seed + 11, 0, 3));
    const pre10AvgVolRatio = isActionable ? rnd(seed + 12, 0.5, 0.85) : rnd(seed + 12, 0.6, 1.3);
    const pre5AvgVolRatio = isActionable ? rnd(seed + 13, 0.5, 0.85) : rnd(seed + 13, 0.6, 1.3);
    const pre10HighVolCount = Math.round(rnd(seed + 14, 0, 3));
    const pre10RedVolBias = rnd(seed + 15, 0.5, 1.05);
    const closeLoc = isActionable ? rnd(seed + 16, 68, 95) : rnd(seed + 16, 30, 75);
    const upperWickPct = isActionable ? rnd(seed + 17, 3, 28) : rnd(seed + 17, 10, 45);
    const bodyPct = isActionable ? rnd(seed + 18, 40, 85) : rnd(seed + 18, 15, 60);
    const exactRangeATR14 = isActionable ? rnd(seed + 19, 1.2, 3.5) : rnd(seed + 19, 0.5, 2);
    const exactVolRatio20 = isActionable ? rnd(seed + 20, 1.1, 3.5) : rnd(seed + 20, 0.4, 1.2);
    const exactVolVsPre5 = isActionable ? rnd(seed + 21, 2.1, 5) : rnd(seed + 21, 0.8, 2.5);
    const signalRangePct = rnd(seed + 22, 1.5, 7);
    const volatilityExpansionRatio = isActionable ? rnd(seed + 23, 1.5, 3.5) : rnd(seed + 23, 0.5, 1.8);
    const ultraPrecisionScore = isActionable ? Math.round(rnd(seed + 24, params.minUltraPrecisionScore + 5, 95)) : Math.round(rnd(seed + 24, 10, params.minUltraPrecisionScore + 10));
    const candleQualityScore = isActionable ? Math.round(rnd(seed + 25, 3, 5)) : Math.round(rnd(seed + 25, 0, 3));
    const inflectionScore = stage === "ULTRA_STRONG_BUY" ? Math.round(rnd(seed + 26, 75, 100)) : stage === "STRONG_BUY" ? Math.round(rnd(seed + 26, 60, 75)) : stage === "BUY" ? Math.round(rnd(seed + 26, 45, 60)) : stage === "PRE_BREAKOUT" ? Math.round(rnd(seed + 26, 30, 50)) : stage === "EARLY_INFLECTION" ? Math.round(rnd(seed + 26, 20, 35)) : Math.round(rnd(seed + 26, 5, 25));
    const conditionsMet = stage === "ULTRA_STRONG_BUY" ? Math.round(rnd(seed + 27, 17, 20)) : stage === "STRONG_BUY" ? Math.round(rnd(seed + 27, 14, 18)) : stage === "BUY" ? Math.round(rnd(seed + 27, 12, 16)) : stage === "PRE_BREAKOUT" ? Math.round(rnd(seed + 27, 9, 13)) : Math.round(rnd(seed + 27, 4, 10));
    const confidence = conditionsMet / 20 * 100;
    let priceEngine;
    if (isActionable && zone !== null) {
      const breakoutLevel = zoneHigh;
      const plannedEntry = breakoutLevel * 1.001;
      const tacticalRiskPct = rnd(seed + 28, 1, 2.5);
      const tacticalStop = plannedEntry * (1 - tacticalRiskPct / 100);
      const riskPerShare = plannedEntry - tacticalStop;
      priceEngine = {
        breakoutLevel,
        plannedEntry,
        gapPct: rnd(seed + 29, -0.3, 0.8),
        gapATR: rnd(seed + 29, 0, 1.5),
        entryMode: "breakout",
        entryStatus: "normal",
        entryBuffer: 0.05,
        efficiencyRatio: rnd(seed + 30, 0.3, 0.8),
        tacticalStop,
        tacticalRiskPct,
        stopWeinstein: tacticalStop * 0.998,
        stopKase: tacticalStop * 1.001,
        stopElder: tacticalStop * 0.999,
        stopSignalLow: tacticalStop * 1.002,
        disasterStop: zoneLow * 0.99,
        disasterRiskPct: rnd(seed + 30, 3, 7),
        riskPerShare,
        target5: plannedEntry + rnd(seed + 90, 1.2, 2) * riskPerShare,
        target7: plannedEntry + rnd(seed + 91, 2, 3.5) * riskPerShare,
        target10: plannedEntry + rnd(seed + 92, 3.5, 6) * riskPerShare,
        target3R: plannedEntry + 3 * riskPerShare,
        t1R: rnd(seed + 90, 1.2, 2),
        t2R: rnd(seed + 91, 2, 3.5),
        t3R_mult: rnd(seed + 92, 3.5, 6),
        rewardRisk: rnd(seed + 93, 1.2, 3.5),
        chandelierT1: plannedEntry,
        chandelierT2: plannedEntry + 1.5 * riskPerShare,
        chandelierT3: plannedEntry + 3 * riskPerShare,
        failedBreakoutLevel: zoneHigh,
        timeStop3d: plannedEntry,
        timeStop5d: plannedEntry + riskPerShare,
        timeStop10d: plannedEntry + 2 * riskPerShare,
        maxHoldBars: 20,
        tradeValid: true,
        hh252: 0,
        pctFrom52W: 0,
        breakoutTier: "B",
        sw5LowAtEntry: 0,
        atr14AtEntry: 0
      };
    } else {
      priceEngine = {
        breakoutLevel: lastClose,
        plannedEntry: lastClose,
        gapPct: 0,
        gapATR: 0,
        entryMode: "breakout",
        entryStatus: "normal",
        entryBuffer: 0,
        efficiencyRatio: 0,
        tacticalStop: 0,
        tacticalRiskPct: 0,
        stopWeinstein: 0,
        stopKase: 0,
        stopElder: 0,
        stopSignalLow: 0,
        disasterStop: 0,
        disasterRiskPct: 0,
        riskPerShare: 0,
        target5: 0,
        target7: 0,
        target10: 0,
        target3R: 0,
        t1R: 0,
        t2R: 0,
        t3R_mult: 0,
        rewardRisk: 0,
        chandelierT1: 0,
        chandelierT2: 0,
        chandelierT3: 0,
        failedBreakoutLevel: 0,
        timeStop3d: 0,
        timeStop5d: 0,
        timeStop10d: 0,
        maxHoldBars: 20,
        tradeValid: false,
        hh252: 0,
        pctFrom52W: 0,
        breakoutTier: "B",
        sw5LowAtEntry: 0,
        atr14AtEntry: 0
      };
    }
    const lastDate = new Date((baseTs - i * 86400) * 1e3).toISOString().slice(0, 10);
    const liquidityOk = avgTurnover20 >= params.minAvgTurnover20;
    const volOk = atrPct14Pctl120 <= params.maxATRPct14Pctl120;
    const zoneOk = zone !== null && zone.zoneTightnessPct <= params.maxZoneTightnessPct && zone.windowLength >= params.minZoneLen;
    const breakoutOk = zone !== null && lastClose > zone.zoneHigh * params.breakoutMultiplier;
    const pre10RangeOk = pre10AvgRangeATR <= params.maxPre10AvgRangeATR;
    const pre10ExpOk = pre10ExpansionCount <= params.maxPre10ExpansionCount;
    const pre10VolOk = pre10AvgVolRatio <= params.maxPre10AvgVolRatio;
    const pre5VolOk = pre5AvgVolRatio <= params.maxPre5AvgVolRatio;
    const pre10HighVolOk = pre10HighVolCount <= params.maxPre10HighVolCount;
    const pre10RedBiasOk = pre10RedVolBias <= params.maxPre10RedVolBias;
    const exactRangeOk = exactRangeATR14 >= params.minExactRangeATR14 && exactRangeATR14 <= params.maxExactRangeATR14;
    const exactVolOk = exactVolRatio20 >= params.minExactVolRatio20;
    const exactVolPre5Ok = exactVolVsPre5 >= params.minExactVolVsPre5;
    const closeLocOk = closeLoc >= params.minCloseLoc;
    const wickOk = upperWickPct <= params.maxUpperWickPct;
    const bodyOk = bodyPct >= params.minBodyPct;
    const riskOk = signalRangePct <= params.maxCandleRisk;
    const upsOk = ultraPrecisionScore >= params.minUltraPrecisionScore;
    const rsi2Ok = rsi2val >= params.minRSI2;
    const volExpOk = params.minVolatilityExpansionRatio === null || volatilityExpansionRatio >= params.minVolatilityExpansionRatio;
    const cqsOk = params.minCandleQualityScore === null || candleQualityScore >= params.minCandleQualityScore;
    const clAbvZonePct = zone !== null && zone.zoneHigh > 0 ? (lastClose - zone.zoneHigh) / zone.zoneHigh * 100 : 0;
    const closeAboveZoneOk = params.maxCloseAboveZonePct === null || clAbvZonePct <= params.maxCloseAboveZonePct;
    const checklist = buildChecklist(
      params,
      avgTurnover20,
      atrPct14Pctl120,
      pre10AvgRangeATR,
      pre10ExpansionCount,
      zone,
      pre10AvgVolRatio,
      pre5AvgVolRatio,
      pre10HighVolCount,
      pre10RedVolBias,
      breakoutOk,
      exactRangeATR14,
      exactVolRatio20,
      exactVolVsPre5,
      closeLoc,
      upperWickPct,
      bodyPct,
      signalRangePct,
      ultraPrecisionScore,
      rsi2val,
      liquidityOk,
      volOk,
      zoneOk,
      pre10RangeOk,
      pre10ExpOk,
      pre10VolOk,
      pre5VolOk,
      pre10HighVolOk,
      pre10RedBiasOk,
      exactRangeOk,
      exactVolOk,
      exactVolPre5Ok,
      closeLocOk,
      wickOk,
      bodyOk,
      riskOk,
      upsOk,
      rsi2Ok,
      volExpOk,
      cqsOk,
      volatilityExpansionRatio,
      candleQualityScore,
      closeAboveZoneOk,
      clAbvZonePct
    );
    results.push({
      symbol,
      stage,
      inflectionScore,
      confidence,
      paramSetKey,
      lastClose,
      lastDate,
      avgTurnover20,
      atrPct14,
      atrPct14Pctl120,
      volRatio20,
      rsi2: rsi2val,
      rsi14: rsi14val,
      zone,
      pre10AvgRangeATR,
      pre10ExpansionCount,
      pre10AvgVolRatio,
      pre5AvgVolRatio,
      pre10HighVolCount,
      pre10RedVolBias,
      exactRangeATR14,
      exactVolRatio20,
      exactVolVsPre5,
      closeLoc,
      upperWickPct,
      bodyPct,
      signalRangePct,
      volatilityExpansionRatio,
      ultraPrecisionScore,
      candleQualityScore,
      priceEngine,
      conditionsMet,
      totalConditions: checklist.length,
      checklist,
      momentum: {
        emaAligned: isActionable,
        ema20: lastClose * (isActionable ? 0.98 : 1.02),
        ema50: lastClose * (isActionable ? 0.95 : 1.05),
        higherLowConfirmed: isActionable || stage === "PRE_BREAKOUT",
        swingLow20: lastClose * 0.92,
        volDryUpScore: isActionable ? Math.round(rnd(seed + 40, 3, 4)) : Math.round(rnd(seed + 40, 0, 3)),
        obvSlope10: isActionable ? rnd(seed + 41, 0.5, 2) : rnd(seed + 41, -0.5, 0.8),
        adx14: rnd(seed + 42, 15, 35),
        adxInRange: true,
        gapAdjustedRR: isActionable ? rnd(seed + 43, 2, 4) : rnd(seed + 43, 0.5, 2),
        momentumScore: isActionable ? Math.round(rnd(seed + 44, 65, 100)) : Math.round(rnd(seed + 44, 10, 50)),
        rsNifty20: isActionable ? rnd(seed + 45, 1, 1.3) : rnd(seed + 45, 0.8, 1.1)
      },
      nearBreakoutPct: stage === "EARLY_INFLECTION" ? rnd(seed + 46, 0.3, 1.8) : stage === "COMPRESSION_WATCH" ? rnd(seed + 46, 1, 4) : -1,
      nearBreakout: stage === "EARLY_INFLECTION",
      nearBreakoutTier: stage === "EARLY_INFLECTION" ? "IMMINENT" : stage === "COMPRESSION_WATCH" ? "NEAR" : null,
      stats: {
        volZScore: isActionable ? rnd(seed + 50, 2, 4) : rnd(seed + 50, -0.5, 1.8),
        volZSignificant: isActionable,
        bbWidth: rnd(seed + 51, 0.02, 0.1),
        bbWidthPctl: isActionable ? rnd(seed + 52, 3, 15) : rnd(seed + 52, 20, 80),
        bbSqueeze: isActionable,
        keltnerSqueeze: isActionable && rnd(seed + 53, 0, 1) > 0.4,
        lrSlope10: rnd(seed + 54, -0.2, 0.2),
        lrSlopeFlat: isActionable,
        autoCorr5: rnd(seed + 55, -0.3, 0.5),
        momentumRegime: isActionable,
        hurst: isActionable ? rnd(seed + 56, 0.55, 0.75) : rnd(seed + 56, 0.4, 0.55),
        hurstTrending: isActionable,
        skewness20: rnd(seed + 57, -0.5, 1.5),
        positiveSkew: isActionable,
        statsScore: isActionable ? Math.round(rnd(seed + 58, 60, 95)) : Math.round(rnd(seed + 58, 10, 40)),
        drawdownFrom52WH: isActionable ? rnd(seed + 70, 1, 10) : rnd(seed + 70, 10, 40),
        pctFrom52WL: isActionable ? rnd(seed + 71, 30, 90) : rnd(seed + 71, 5, 50),
        sharpe20: isActionable ? rnd(seed + 72, 1, 3) : rnd(seed + 72, -1, 1.5),
        entropy10: rnd(seed + 73, 0.5, 2.2),
        cusumSignal: isActionable && rnd(seed + 74, 0, 1) > 0.5,
        sectorRelZ: 0,
        insideBars: isActionable ? Math.round(rnd(seed + 75, 1, 4)) : 0,
        volProfileSkew: isActionable ? rnd(seed + 76, 0.1, 0.6) : rnd(seed + 76, -0.3, 0.3),
        garchForecast: isActionable ? rnd(seed + 77, 1.2, 2) : rnd(seed + 77, 0.8, 1.3),
        ttmSqueezeOn: !isActionable && hasZone,
        ttmSqueezeFired: isActionable,
        ttmMomentum: isActionable ? rnd(seed + 78, 1, 10) : rnd(seed + 78, -5, 5),
        ttmMomentumRising: isActionable,
        rsi14: isActionable ? rnd(seed + 79, 55, 75) : rnd(seed + 79, 35, 65),
        cci34: isActionable ? rnd(seed + 80, 50, 200) : rnd(seed + 80, -100, 100),
        ema10: lastClose * (isActionable ? rnd(seed + 81, 0.97, 0.995) : rnd(seed + 81, 0.98, 1.02)),
        ema21: lastClose * (isActionable ? rnd(seed + 82, 0.94, 0.99) : rnd(seed + 82, 0.96, 1.04)),
        ema55: lastClose * (isActionable ? rnd(seed + 83, 0.9, 0.97) : rnd(seed + 83, 0.92, 1.06)),
        sma200: lastClose * (isActionable ? rnd(seed + 84, 0.8, 0.94) : rnd(seed + 84, 0.85, 1.1)),
        ema10Cross: isActionable && rnd(seed + 87, 0, 1) > 0.7,
        ema21Cross: isActionable && rnd(seed + 88, 0, 1) > 0.85,
        ema55Cross: false,
        sma200Cross: false,
        guppySpreadPct: isActionable ? rnd(seed + 85, 0.2, 0.8) : rnd(seed + 85, 1.5, 5),
        guppyCompressed: isActionable,
        guppyUltraCompressed: isActionable && rnd(seed + 86, 0, 1) > 0.5,
        guppyCompressDays: isActionable ? Math.round(rnd(seed + 89, 7, 10)) : Math.round(rnd(seed + 89, 0, 5)),
        guppyCleanBullishFan: isActionable && rnd(seed + 90, 0, 1) > 0.3,
        guppyGroupGapPct: isActionable ? rnd(seed + 91, 1, 5) : rnd(seed + 91, -2, 1),
        guppyCoiledRelease: isActionable && rnd(seed + 92, 0, 1) > 0.5,
        guppySpring: false,
        guppyPrimed: false,
        candlePattern: isActionable ? ["B-EN", "B-MZ", "HAMR", "3WS", "MRST", "B-ST"][Math.floor(rnd(seed + 88, 0, 6))] : ["BEAR", "SPIN", "DOJI", "R-WK"][Math.floor(rnd(seed + 88, 0, 4))],
        candlePatternFull: isActionable ? "Bullish Engulfing" : "Bearish",
        candlePatternType: isActionable ? "bullish" : "bearish",
        candlePatternStrength: isActionable ? 3 : 1
      },
      clusterBreakdown: {
        deployable: { met: Math.round(rnd(seed + 60, isActionable ? 18 : 8, 21)), total: 21 },
        highPrecision: { met: Math.round(rnd(seed + 61, isActionable ? 16 : 7, 19)), total: 19 },
        elite: { met: Math.round(rnd(seed + 62, isActionable ? 17 : 8, 21)), total: 21 },
        ultraSelective: { met: Math.round(rnd(seed + 63, isActionable ? 16 : 7, 20)), total: 20 },
        sniper: { met: Math.round(rnd(seed + 64, isActionable ? 17 : 5, 21)), total: 21 },
        orsReversal: {
          met: Math.round(rnd(seed + 65, isActionable ? 6 : 2, 10)),
          total: 10,
          score: isActionable ? Math.round(rnd(seed + 66, 60, 88)) : Math.round(rnd(seed + 66, 30, 65)),
          confirmed: isActionable && rnd(seed + 67, 0, 1) > 0.6
        }
      },
      monster: { badges: [], topProbability: 0 },
      dayChangePct: rnd(seed + 70, -4, 6),
      candleDNA: { score: Math.round(rnd(seed + 71, isActionable ? 50 : 15, isActionable ? 95 : 60)), upperWickQuality: Math.round(rnd(seed + 72, 0, 40)), closeLocationQuality: Math.round(rnd(seed + 73, 0, 35)), supportTailQuality: Math.round(rnd(seed + 74, 0, 25)), volumeContextScore: Math.round(rnd(seed + 79, 0, 20)), bodyATR: rnd(seed + 75, 0.3, 2), upperToLowerWickRatio: rnd(seed + 76, 0.2, 2), marubozuScore: rnd(seed + 77, 40, 95), volumeRatio: rnd(seed + 78, 0.5, 2.5), springDepth: 0, predecessorScore: 0, tier: isActionable ? "STRONG" : "GOOD" },
      advanced: {
        utbotMode: isActionable ? rnd(seed + 90, 0, 1) > 0.4 ? "BOTH" : "PRECISION" : "NONE",
        utbotBarsAgo: isActionable ? Math.round(rnd(seed + 91, 0, 2)) : 99,
        utbotLag: Math.round(rnd(seed + 92, 6, 14)),
        utbotEntry: lastClose * rnd(seed + 93, 1.005, 1.02),
        fer20: isActionable ? rnd(seed + 94, 0.52, 0.82) : rnd(seed + 94, 0.25, 0.55),
        ferTier: isActionable ? "EFFICIENT" : "MODERATE",
        cusumPos: rnd(seed + 95, 0, 1.5),
        cusumNeg: rnd(seed + 96, -0.5, 0),
        cusumSignal: !isActionable && rnd(seed + 97, 0, 1) > 0.7,
        cusumTier: isActionable ? "IDLE" : "MILD",
        mwcScore: isActionable ? Math.round(rnd(seed + 98, 0, 1)) : Math.round(rnd(seed + 98, 2, 4)),
        roc5: isActionable ? rnd(seed + 99, 0.5, 3) : rnd(seed + 99, -2, 1.5),
        roc20: isActionable ? rnd(seed + 100, 2, 10) : rnd(seed + 100, -5, 5),
        roc60: isActionable ? rnd(seed + 101, 5, 25) : rnd(seed + 101, -15, 10),
        mwcTier: isActionable ? "CONTRARIAN" : "MIXED",
        tram: isActionable ? rnd(seed + 102, -5, -1) : rnd(seed + 102, -1, 2),
        cvar95: rnd(seed + 103, 1.5, 4.5),
        tramTier: isActionable ? "OVERSOLD" : "NEUTRAL",
        cleanMom: isActionable ? rnd(seed + 104, -35, -10) : rnd(seed + 104, -10, 15),
        roc20pct: isActionable ? rnd(seed + 105, -15, -3) : rnd(seed + 105, -5, 10),
        maxDD20: rnd(seed + 106, 3, 12),
        cleanTier: isActionable ? "DEEP_VALUE" : "NEUTRAL",
        regimeDays: Math.round(rnd(seed + 107, 0, 8)),
        avgRunLen: Math.round(rnd(seed + 108, 10, 20)),
        durationRatio: isActionable ? rnd(seed + 109, 0, 0.4) : rnd(seed + 109, 0.3, 0.9),
        durationTier: isActionable ? "IDLE" : "EARLY",
        volRegime: ["LOW", "MID", "HIGH"][Math.floor(rnd(seed + 110, 0, 3))],
        vram: isActionable ? rnd(seed + 111, -2.5, -0.8) : rnd(seed + 111, -0.8, 1.5),
        vramTier: isActionable ? "OVERSOLD" : "NEUTRAL",
        pic: Math.round(rnd(seed + 112, 8, 30)),
        picTier: "FAIR",
        advScore: isActionable ? Math.round(rnd(seed + 113, 58, 88)) : Math.round(rnd(seed + 113, 25, 60)),
        advGrade: isActionable ? rnd(seed + 114, 0, 1) > 0.5 ? "A" : "B" : rnd(seed + 114, 0, 1) > 0.5 ? "C" : "D"
      }
    });
  }
  return results;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ARCHETYPE_TUNING,
  PARAM_SETS,
  PARAM_SET_OPTIONS,
  analyzeStock,
  analyzeStockMulti,
  analyzeStockWithLookback,
  computeClusterBreakdown,
  computeRSvsNifty,
  computeSelfAdaptiveTrend,
  detectCandleDNA,
  detectMonster,
  generateDemoData,
  getArchetypeExitDefaults,
  setArchetypeTuning
});
