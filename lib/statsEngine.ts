interface Candle { ts: number; o: number; h: number; l: number; c: number; v: number; }
import { detectCandlePattern } from './candlePatterns';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0; for (const v of arr) s += v; return s / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let s = 0; for (const v of arr) s += (v - m) ** 2;
  return Math.sqrt(s / (arr.length - 1));
}

function pctRank(window: number[], value: number): number {
  if (window.length === 0) return 50;
  return (window.filter(v => v <= value).length / window.length) * 100;
}

function linRegSlope(values: number[]): number {
  const n = values.length;
  if (n < 3) return 0;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += values[i]; sxy += i * values[i]; sx2 += i * i;
  }
  const d = n * sx2 - sx * sx;
  return Math.abs(d) < 1e-10 ? 0 : (n * sxy - sx * sy) / d;
}

function safe(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

// ─── Statistical Features ────────────────────────────────────────────────────

export interface StatsFeatures {
  // #1: Z-Score Volume
  volZScore: number;
  volZSignificant: boolean;

  // #2: Bollinger Band Squeeze
  bbWidth: number;
  bbWidthPctl: number;
  bbSqueeze: boolean;

  // #3: Keltner Squeeze
  keltnerSqueeze: boolean;

  // #4: Linear Regression Slope
  lrSlope10: number;
  lrSlopeFlat: boolean;

  // #9: Auto-Correlation
  autoCorr5: number;
  momentumRegime: boolean;

  // #10: Hurst Exponent
  hurst: number;
  hurstTrending: boolean;

  // #11: Skewness
  skewness20: number;
  positiveSkew: boolean;

  // v9.1 advanced stats
  drawdownFrom52WH: number;    // % below 52-week high
  pctFrom52WL: number;         // % above 52-week low
  sharpe20: number;            // 20-day rolling Sharpe ratio
  entropy10: number;           // Shannon entropy of last 10 closes
  cusumSignal: boolean;        // CUSUM regime change detected
  sectorRelZ: number;          // sector-relative z-score (placeholder)
  insideBars: number;          // consecutive inside bars count
  volProfileSkew: number;      // volume skew (accumulation vs distribution)
  garchForecast: number;       // GARCH vol forecast ratio vs current

  // TTM Squeeze + RSI14 + CCI34
  ttmSqueezeOn: boolean;         // true = squeeze active (BB inside KC)
  ttmSqueezeFired: boolean;      // squeeze just released
  ttmMomentum: number;           // momentum histogram value
  ttmMomentumRising: boolean;    // momentum increasing
  rsi14: number;                 // 14-period RSI
  cci34: number;                 // 34-period CCI

  // EMA/SMA levels
  ema10: number;
  ema21: number;
  ema55: number;
  sma200: number;
  ema10Cross: boolean;   // CMP crossed EMA10 in the last candle
  ema21Cross: boolean;
  ema55Cross: boolean;
  sma200Cross: boolean;

  // Guppy Multiple Moving Averages — v2, re-derived on 19,987 candles / 456 stocks.
  // Finding: tight spread NOW is NOT bullish (1-1.5% bucket: 48% WR, worst).
  // The real edge is COIL-THEN-RELEASE: tight for 8+ of last 10 days, NOW
  // moderately expanding with bullish alignment. 62.4% WR vs 54.5% baseline.
  guppySpreadPct: number;       // spread of all 12 Guppy EMAs as % of CMP
  guppyCompressed: boolean;     // true if spread < 1% (raw metric, kept for display)
  guppyUltraCompressed: boolean;// true if spread < 0.5% (raw metric, kept for display)
  guppyCompressDays: number;    // 0-10: how many of last 10 days had spread < 2%
  guppyCleanBullishFan: boolean;// all 6 short EMAs > all 6 long EMAs (no overlap)
  guppyGroupGapPct: number;     // (avgShort - avgLong) / avgLong × 100 — alignment strength
  guppyCoiledRelease: boolean;  // VALIDATED signal: compressDays>=8 AND spread<=5% AND cleanFan AND groupGap>=1%

  // Candle pattern
  candlePattern: string;       // short name (3-4 chars)
  candlePatternFull: string;   // full name
  candlePatternType: 'bullish' | 'bearish' | 'neutral';
  candlePatternStrength: number;

  // Composite
  statsScore: number;
}

// #1: Z-Score Volume Anomaly
function computeVolZScore(candles: Candle[], endIdx: number): { z: number; sig: boolean } {
  const start = Math.max(0, endIdx - 20);
  const vols: number[] = [];
  for (let i = start; i < endIdx; i++) vols.push(candles[i].v);
  const sigVol = candles[endIdx]?.v ?? 0;
  const m = mean(vols);
  const sd = stdDev(vols);
  const z = sd > 0 ? (sigVol - m) / sd : 0;
  return { z: safe(z), sig: z >= 2.0 };
}

// #2: Bollinger Band Squeeze Width Percentile
function computeBBSqueeze(candles: Candle[], endIdx: number): { width: number; pctl: number; squeeze: boolean } {
  const period = 20;
  if (endIdx < period) return { width: 0, pctl: 50, squeeze: false };

  const closes: number[] = [];
  for (let i = endIdx - period + 1; i <= endIdx; i++) closes.push(candles[i].c);
  const sma = mean(closes);
  const sd = stdDev(closes);
  const upper = sma + 2 * sd;
  const lower = sma - 2 * sd;
  const width = sma > 0 ? (upper - lower) / sma : 0;

  // Compute BB width history for percentile
  const widthHistory: number[] = [];
  const histStart = Math.max(period, endIdx - 120);
  for (let e = histStart; e < endIdx; e++) {
    const cl: number[] = [];
    for (let i = e - period + 1; i <= e; i++) cl.push(candles[i].c);
    const s = mean(cl);
    const d = stdDev(cl);
    if (s > 0) widthHistory.push((s + 2 * d - (s - 2 * d)) / s);
  }

  const pctl = pctRank(widthHistory, width);
  return { width: safe(width), pctl: safe(pctl), squeeze: pctl <= 10 };
}

// #3: Keltner Channel Squeeze
function computeKeltnerSqueeze(candles: Candle[], endIdx: number): boolean {
  const period = 20;
  if (endIdx < period + 14) return false;

  // BB
  const closes: number[] = [];
  for (let i = endIdx - period + 1; i <= endIdx; i++) closes.push(candles[i].c);
  const sma = mean(closes);
  const sd = stdDev(closes);
  const bbUpper = sma + 2 * sd;
  const bbLower = sma - 2 * sd;

  // Keltner: EMA20 ± 1.5 × ATR10
  let ema = candles[0].c;
  const k = 2 / 21;
  for (let i = 1; i <= endIdx; i++) ema = candles[i].c * k + ema * (1 - k);

  // ATR10
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

  // Squeeze: BB inside Keltner
  return bbLower > kLower && bbUpper < kUpper;
}

// #4: Linear Regression Slope of Pre-10 Closes
function computeLRSlope(candles: Candle[], endIdx: number): { slope: number; flat: boolean } {
  const start = Math.max(0, endIdx - 10);
  const closes: number[] = [];
  for (let i = start; i < endIdx; i++) closes.push(candles[i].c);
  if (closes.length < 5) return { slope: 0, flat: true };

  const rawSlope = linRegSlope(closes);
  const avgClose = mean(closes);
  const normalizedSlope = avgClose > 0 ? (rawSlope / avgClose) * 100 : 0;
  return { slope: safe(normalizedSlope), flat: Math.abs(normalizedSlope) < 0.15 };
}

// #9: Auto-Correlation of 5-day Returns
function computeAutoCorr(candles: Candle[], endIdx: number): { corr: number; momentum: boolean } {
  const returns: number[] = [];
  const start = Math.max(1, endIdx - 30);
  for (let i = start; i <= endIdx; i++) {
    if (candles[i - 1].c > 0) returns.push((candles[i].c - candles[i - 1].c) / candles[i - 1].c);
  }
  if (returns.length < 10) return { corr: 0, momentum: false };

  // Lag-1 autocorrelation
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

// #10: Hurst Exponent (R/S method, simplified)
function computeHurst(candles: Candle[], endIdx: number): { h: number; trending: boolean } {
  const start = Math.max(1, endIdx - 100);
  const returns: number[] = [];
  for (let i = start; i <= endIdx; i++) {
    if (candles[i - 1].c > 0) returns.push(Math.log(candles[i].c / candles[i - 1].c));
  }
  if (returns.length < 20) return { h: 0.5, trending: false };

  const sizes = [10, 15, 20, 30, 50].filter(s => s <= returns.length);
  if (sizes.length < 2) return { h: 0.5, trending: false };

  const logRS: number[] = [];
  const logN: number[] = [];

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
  // Proper R/S regression: slope of logRS vs logN (not vs index)
  const meanX = logN.reduce((a, b) => a + b, 0) / logN.length;
  const meanY = logRS.reduce((a, b) => a + b, 0) / logRS.length;
  let num = 0, den = 0;
  for (let i = 0; i < logN.length; i++) { num += (logN[i] - meanX) * (logRS[i] - meanY); den += (logN[i] - meanX) ** 2; }
  const h = den > 0 ? num / den : 0.5;
  const hClamped = Math.max(0, Math.min(1, safe(h, 0.5)));
  return { h: hClamped, trending: hClamped > 0.55 };
}

// #11: Skewness of 20-day Returns
function computeSkewness(candles: Candle[], endIdx: number): { skew: number; positive: boolean } {
  const start = Math.max(1, endIdx - 20);
  const returns: number[] = [];
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

// ─── Main Export ─────────────────────────────────────────────────────────────

// #2v2: Drawdown from 52-Week High + % from 52-Week Low
function compute52W(candles: Candle[], endIdx: number): { ddFromHigh: number; pctFromLow: number } {
  const start = Math.max(0, endIdx - 252);
  let high52 = -Infinity, low52 = Infinity;
  for (let i = start; i <= endIdx; i++) {
    if (candles[i].h > high52) high52 = candles[i].h;
    if (candles[i].l < low52) low52 = candles[i].l;
  }
  const close = candles[endIdx]?.c ?? 0;
  const dd = high52 > 0 ? ((high52 - close) / high52) * 100 : 0;
  const pctLow = low52 > 0 ? ((close - low52) / low52) * 100 : 0;
  return { ddFromHigh: safe(dd), pctFromLow: safe(pctLow) };
}

// #3v2: Sharpe Ratio (20-day rolling)
function computeSharpe20(candles: Candle[], endIdx: number): number {
  const start = Math.max(1, endIdx - 20);
  const returns: number[] = [];
  for (let i = start; i <= endIdx; i++) {
    if (candles[i - 1].c > 0) returns.push((candles[i].c - candles[i - 1].c) / candles[i - 1].c);
  }
  if (returns.length < 5) return 0;
  const m = mean(returns);
  const sd = stdDev(returns);
  return sd > 1e-10 ? safe((m / sd) * Math.sqrt(252)) : 0;
}

// #4v2: Shannon Entropy of last 10 closes
function computeEntropy10(candles: Candle[], endIdx: number): number {
  const start = Math.max(0, endIdx - 9);
  const closes: number[] = [];
  for (let i = start; i <= endIdx; i++) closes.push(candles[i].c);
  if (closes.length < 5) return 0;

  const min = Math.min(...closes), max = Math.max(...closes);
  const range = max - min;
  if (range < 0.001) return 0; // perfectly flat = zero entropy

  const bins = 5;
  const counts = new Array(bins).fill(0);
  for (const c of closes) {
    const bin = Math.min(Math.floor(((c - min) / range) * bins), bins - 1);
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

// #5v2: CUSUM Regime Change Detection
function computeCUSUM(candles: Candle[], endIdx: number): boolean {
  const start = Math.max(1, endIdx - 50);
  const returns: number[] = [];
  for (let i = start; i <= endIdx; i++) {
    if (candles[i - 1].c > 0) returns.push((candles[i].c - candles[i - 1].c) / candles[i - 1].c);
  }
  if (returns.length < 20) return false;

  const m = mean(returns.slice(0, Math.floor(returns.length / 2)));
  const sd = stdDev(returns.slice(0, Math.floor(returns.length / 2)));
  if (sd < 1e-10) return false;

  const threshold = 4.0; // standard CUSUM threshold
  let sPlus = 0, sMinus = 0;
  for (let i = Math.floor(returns.length / 2); i < returns.length; i++) {
    const z = (returns[i] - m) / sd;
    sPlus = Math.max(0, sPlus + z - 0.5);
    sMinus = Math.max(0, sMinus - z - 0.5);
    if (sPlus > threshold || sMinus > threshold) return true;
  }
  return false;
}

// #7v2: Consecutive Inside Bars
function computeInsideBars(candles: Candle[], endIdx: number): number {
  let count = 0;
  for (let i = endIdx - 1; i > Math.max(0, endIdx - 10); i--) {
    if (i < 1) break;
    const inside = candles[i].h <= candles[i - 1].h && candles[i].l >= candles[i - 1].l;
    if (inside) count++;
    else break;
  }
  return count;
}

// #8v2: Volume Profile Skew (accumulation vs distribution)
function computeVolProfileSkew(candles: Candle[], endIdx: number): number {
  const start = Math.max(0, endIdx - 10);
  let accumVol = 0, distribVol = 0;
  for (let i = start; i <= endIdx; i++) {
    const range = candles[i].h - candles[i].l;
    if (range <= 0) continue;
    const closePosition = (candles[i].c - candles[i].l) / range; // 0=bottom, 1=top
    accumVol += candles[i].v * closePosition;
    distribVol += candles[i].v * (1 - closePosition);
  }
  const total = accumVol + distribVol;
  return total > 0 ? safe((accumVol - distribVol) / total) : 0;
}

// #1v2: Simplified GARCH(1,1) Volatility Forecast
function computeGARCH(candles: Candle[], endIdx: number): number {
  const start = Math.max(1, endIdx - 30);
  const returns: number[] = [];
  for (let i = start; i <= endIdx; i++) {
    if (candles[i - 1].c > 0) returns.push(Math.log(candles[i].c / candles[i - 1].c));
  }
  if (returns.length < 15) return 1.0;

  // GARCH(1,1): σ²(t+1) = ω + α·ε²(t) + β·σ²(t)
  const omega = 0.00001, alpha = 0.10, beta = 0.85;
  let sigma2 = 0;
  for (const r of returns.slice(0, 10)) sigma2 += r * r;
  sigma2 /= 10;

  for (let i = 10; i < returns.length; i++) {
    sigma2 = omega + alpha * returns[i] * returns[i] + beta * sigma2;
    if (sigma2 < 1e-10) sigma2 = 1e-10; // variance floor to prevent collapse to 0
  }

  // Forecast next day's vol
  const lastReturn = returns[returns.length - 1];
  const forecastSigma2 = omega + alpha * lastReturn * lastReturn + beta * sigma2;

  // Current realized vol (last 5 days)
  const recent = returns.slice(-5);
  let realizedVar = 0;
  for (const r of recent) realizedVar += r * r;
  realizedVar /= recent.length;

  return realizedVar > 0 ? safe(Math.sqrt(forecastSigma2 / realizedVar)) : 1.0;
}

// ─── TTM Squeeze (John Carter) ───────────────────────────────────────────────
// Squeeze ON  = BB inside KC (red dots — volatility compressed)
// Squeeze OFF = BB outside KC (green dots — breakout firing)
// Momentum    = Linear regression of (close - midline(KC+BB)/2) over 20 bars

function computeTTMSqueeze(candles: Candle[], endIdx: number): {
  squeezeOn: boolean; squeezeFired: boolean; momentum: number; momentumRising: boolean;
} {
  const bbPeriod = 20, bbMult = 2.0;
  const kcPeriod = 20, kcMult = 1.5;

  if (endIdx < Math.max(bbPeriod, kcPeriod) + 14) {
    return { squeezeOn: false, squeezeFired: false, momentum: 0, momentumRising: false };
  }

  // Bollinger Bands
  const bbCloses: number[] = [];
  for (let i = endIdx - bbPeriod + 1; i <= endIdx; i++) bbCloses.push(candles[i].c);
  const bbSMA = mean(bbCloses);
  const bbSD = stdDev(bbCloses);
  const bbUpper = bbSMA + bbMult * bbSD;
  const bbLower = bbSMA - bbMult * bbSD;

  // Keltner Channels (EMA20 ± 1.5 × ATR10)
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

  // Squeeze condition
  const squeezeOn = bbLower > kcLower && bbUpper < kcUpper;

  // Check if squeeze just fired (was on, now off)
  let prevSqueezeOn = false;
  if (endIdx > bbPeriod + 1) {
    const prevBBCloses: number[] = [];
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

  // Momentum (John Carter method):
  // For each bar: mom = close - avg(avg(highestHigh(20), lowestLow(20)), SMA(20))
  // Then linear regression of the last 20 momentum values, take value at last bar
  const momValues: number[] = [];
  for (let bar = endIdx - bbPeriod + 1; bar <= endIdx; bar++) {
    // Donchian channel: highest high and lowest low over 20 bars ending at 'bar'
    let hh = -Infinity, ll = Infinity;
    for (let j = bar - bbPeriod + 1; j <= bar; j++) {
      if (j >= 0) {
        if (candles[j].h > hh) hh = candles[j].h;
        if (candles[j].l < ll) ll = candles[j].l;
      }
    }
    const donchianMid = (hh + ll) / 2;
    // SMA of close over 20 bars ending at 'bar'
    let smaSum = 0, smaCount = 0;
    for (let j = bar - bbPeriod + 1; j <= bar; j++) {
      if (j >= 0) { smaSum += candles[j].c; smaCount++; }
    }
    const smaMid = smaCount > 0 ? smaSum / smaCount : candles[bar].c;
    const refLine = (donchianMid + smaMid) / 2;
    momValues.push(candles[bar].c - refLine);
  }

  // Linear regression of momentum values — value at last point
  const n = momValues.length;
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += momValues[i]; sxy += i * momValues[i]; sx2 += i * i;
  }
  const regDenom = n * sx2 - sx * sx;
  const slope = regDenom !== 0 ? (n * sxy - sx * sy) / regDenom : 0;
  const intercept = (sy - slope * sx) / n;
  const momentum = intercept + slope * (n - 1);

  // Previous momentum for rising/falling
  const prevMomentum = n > 1 ? intercept + slope * (n - 2) : 0;
  const momentumRising = momentum > prevMomentum;

  return {
    squeezeOn, squeezeFired,
    momentum: safe(momentum),
    momentumRising,
  };
}

// ─── RSI(14) — Wilder's Method ───────────────────────────────────────────────

function computeRSI14(candles: Candle[], endIdx: number): number {
  const period = 14;
  const needed = period + 20;
  if (endIdx < needed) return 50;

  const start = endIdx - needed;
  let gains = 0, losses = 0;
  for (let i = start + 1; i <= start + period; i++) {
    const diff = candles[i].c - candles[i - 1].c;
    if (diff > 0) gains += diff; else losses += Math.abs(diff);
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

// ─── CCI(34) — Commodity Channel Index ───────────────────────────────────────

function computeCCI34(candles: Candle[], endIdx: number): number {
  const period = 34;
  if (endIdx < period) return 0;

  // Typical price = (H + L + C) / 3
  const tps: number[] = [];
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    tps.push((candles[i].h + candles[i].l + candles[i].c) / 3);
  }
  const smaTP = mean(tps);

  // Mean deviation
  let mdSum = 0;
  for (const tp of tps) mdSum += Math.abs(tp - smaTP);
  const md = mdSum / period;

  if (md < 1e-10) return 0;
  const cci = (tps[tps.length - 1] - smaTP) / (0.015 * md);
  return safe(cci);
}

// ─── EMA/SMA Levels ──────────────────────────────────────────────────────────

function computeEMALevel(candles: Candle[], endIdx: number, period: number): number {
  if (endIdx < period) return candles[endIdx]?.c ?? 0;
  const k = 2 / (period + 1);
  let ema = candles[0].c;
  for (let i = 1; i <= endIdx; i++) ema = candles[i].c * k + ema * (1 - k);
  return safe(ema);
}

function computeSMALevel(candles: Candle[], endIdx: number, period: number): number {
  if (endIdx < period - 1) return candles[endIdx]?.c ?? 0;
  let sum = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) sum += candles[i].c;
  return safe(sum / period);
}

// ─── Guppy Multiple Moving Averages (GMMA) v2 ───────────────────────────────
// Short-term (traders):  3, 5, 8, 10, 12, 15
// Long-term (investors): 30, 35, 40, 45, 50, 60
// Spread = (max - min) / CMP × 100. Ultra-compressed < 0.5%, Compressed < 1%
// (raw display thresholds — kept as-is, NOT predictive on their own).
//
// VALIDATED signal (backtested on 19,987 candles / 456 Nifty 500 stocks):
// tight spread RIGHT NOW is NOT bullish (1-1.5% bucket = 48% WR, worst tier).
// The real edge is COIL-THEN-RELEASE: spread was tight for 8+ of the last 10
// days (energy stored), but is NOW moderately expanding (<=5%) with a clean
// bullish fan (all short EMAs above all long EMAs) and positive group gap.
// guppyCoiledRelease = 62.4% WR vs 54.5% baseline (+7.9pp edge).

const SHORT_PERIODS = [3, 5, 8, 10, 12, 15];
const LONG_PERIODS = [30, 35, 40, 45, 50, 60];

function computeGuppySpread(candles: Candle[], endIdx: number): {
  spreadPct: number; compressed: boolean; ultraCompressed: boolean;
  compressDays: number; cleanBullishFan: boolean; groupGapPct: number; coiledRelease: boolean;
} {
  if (endIdx < 60) {
    return { spreadPct: 99, compressed: false, ultraCompressed: false, compressDays: 0, cleanBullishFan: false, groupGapPct: 0, coiledRelease: false };
  }

  function spreadAt(idx: number): { spreadPct: number; shortVals: number[]; longVals: number[] } {
    const shortVals = SHORT_PERIODS.map(p => computeEMALevel(candles, idx, p));
    const longVals = LONG_PERIODS.map(p => computeEMALevel(candles, idx, p));
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
  for (let j = Math.max(0, endIdx - 10); j <= endIdx; j++) {
    if (spreadAt(j).spreadPct < 2.0) compressDays++;
  }

  const coiledRelease = compressDays >= 8 && now.spreadPct <= 5.0 && cleanBullishFan && groupGapPct >= 1.0;

  return {
    spreadPct: safe(now.spreadPct),
    compressed: now.spreadPct < 1.0,
    ultraCompressed: now.spreadPct < 0.5,
    compressDays,
    cleanBullishFan,
    groupGapPct: safe(groupGapPct),
    coiledRelease,
  };
}

export function computeStatsFeatures(candles: Candle[], endIdx: number): StatsFeatures {
  // Bounds guard
  if (endIdx < 0 || endIdx >= candles.length || candles.length < 35) {
    const c = candles.length > 0 ? candles[Math.min(Math.max(0, endIdx), candles.length - 1)].c : 0;
    return { volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false, lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false, skewness20: 0, positiveSkew: false, drawdownFrom52WH: 0, pctFrom52WL: 0, sharpe20: 0, entropy10: 0, cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1.0, ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false, rsi14: 50, cci34: 0, ema10: c, ema21: c, ema55: c, sma200: c, ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false, guppySpreadPct: 99, guppyCompressed: false, guppyUltraCompressed: false, guppyCompressDays: 0, guppyCleanBullishFan: false, guppyGroupGapPct: 0, guppyCoiledRelease: false, candlePattern: '—', candlePatternFull: 'Unknown', candlePatternType: 'neutral', candlePatternStrength: 0, statsScore: 0 };
  }
  const volZ = computeVolZScore(candles, endIdx);
  const bb = computeBBSqueeze(candles, endIdx);
  const kSqueeze = computeKeltnerSqueeze(candles, endIdx);
  const lr = computeLRSlope(candles, endIdx);
  const ac = computeAutoCorr(candles, endIdx);
  const hurst = computeHurst(candles, endIdx);
  const skew = computeSkewness(candles, endIdx);

  // TTM Squeeze + RSI14 + CCI34
  const ttm = computeTTMSqueeze(candles, endIdx);
  const rsi14val = computeRSI14(candles, endIdx);
  const cci34val = computeCCI34(candles, endIdx);

  // Guppy GMMA
  const guppy = computeGuppySpread(candles, endIdx);

  // Candle pattern
  const candlePat = detectCandlePattern(candles, endIdx);

  // EMA/SMA levels
  const ema10 = computeEMALevel(candles, endIdx, 10);
  const ema21 = computeEMALevel(candles, endIdx, 21);
  const ema55 = computeEMALevel(candles, endIdx, 55);
  const sma200 = computeSMALevel(candles, endIdx, 200);

  // v9.1 advanced stats
  const w52 = compute52W(candles, endIdx);
  const sharpe = computeSharpe20(candles, endIdx);
  const entropy = computeEntropy10(candles, endIdx);
  const cusum = computeCUSUM(candles, endIdx);
  const insideBars = computeInsideBars(candles, endIdx);
  const volSkew = computeVolProfileSkew(candles, endIdx);
  const garch = computeGARCH(candles, endIdx);

  // Composite stats score (0-100) — re-calibrated on 3,806 breakout signals × 1,617 NSE stocks.
  // REMOVED negative predictors: Hurst (r=0.000, zero correlation — was wasting 12pts),
  // ddFromHigh≤10 (r=−0.037 NEGATIVE — near 52WH actually hurts in this context),
  // volSkew>0.2 (r=−0.022 NEGATIVE — was wrongly scored positive).
  // INVERTED: volZ — strongly NEGATIVE predictor (r=−0.074, r=−0.046). High breakout-day
  // volume Z-score = blow-off risk. Now SUBTRACTS points.
  // CCI narrowed from 150-300 to 100-200 (200-300 bucket underperforms: +1.08% vs baseline +1.67%).
  // Guppy coiledRelease increased to +12pts (r=+0.030, Guppy fan confirmed r=+0.030).
  // Score ≥50: +5.06% avg20d, Win 54.7%. Score ≥55: +5.50%, Win 63.9%.
  let score = 0;
  if (rsi14val >= 80) score += 14;                // validated: 80-85→+3.55%, 85-90→+10.56% avg20d
  else if (rsi14val >= 70) score += 9;            // 70-75→+1.47%, 75-80→+1.43%
  else if (rsi14val >= 60) score += 5;            // 60-65→+1.79%, 65-70→+1.25%
  // Hurst trending REMOVED — r=0.000 (zero correlation), was wasting 12pts
  if (cci34val >= 100 && cci34val <= 200) score += 6; // narrowed: 150-200→+2.35% (sweet spot confirmed)
  if (w52.pctFromLow >= 80) score += 6;           // validated: strong stocks far from 52WL outperform
  // ddFromHigh REMOVED — r=−0.037 (NEGATIVE). Near 52WH = exhaustion, not strength, in breakout context.
  if (ttm.squeezeFired && ttm.momentumRising) score += 8; // squeeze firing confirmed: +0.011 r
  if (volZ.sig) score -= 5;                       // INVERTED: blow-off volume r=−0.074 (strongly NEGATIVE)
  else if (volZ.z >= 1.5) score -= 2;             // moderate blow-off penalty
  if (bb.squeeze) score += 6;                     // confirmed positive: r=+0.012
  else if (bb.pctl <= 20) score += 3;             // confirmed: tight BB width → continuation
  if (kSqueeze) score += 4;
  if (lr.flat) score += 4;
  if (ac.momentum) score += 4;
  if (skew.positive) score += 4;
  if (kSqueeze && bb.squeeze) score += 3;         // double squeeze bonus: r=+0.012
  if (sharpe > 2.5) score += 4;
  if (entropy < 1.5) score += 3;
  // insideBars REMOVED; volSkew REMOVED — r=−0.022 (NEGATIVE predictor)
  if (garch > 1.3) score += 2;
  if (guppy.coiledRelease) score += 12;           // INCREASED: r=+0.030, +3.60% avg20d, 62% win rate
  else if (guppy.cleanBullishFan) score += 3;     // confirmed: r=+0.030, +1.80% avg20d

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
    garchForecast: safe(garch, 1.0),
    ttmSqueezeOn: ttm.squeezeOn,
    ttmSqueezeFired: ttm.squeezeFired,
    ttmMomentum: safe(ttm.momentum),
    ttmMomentumRising: ttm.momentumRising,
    rsi14: safe(rsi14val, 50),
    cci34: safe(cci34val),
    ema10: safe(ema10), ema21: safe(ema21), ema55: safe(ema55), sma200: safe(sma200),
    // Cross detection: was prev close on the other side of the MA?
    ema10Cross: endIdx > 0 && ((candles[endIdx].c > ema10 && candles[endIdx - 1].c <= computeEMALevel(candles, endIdx - 1, 10)) || (candles[endIdx].c < ema10 && candles[endIdx - 1].c >= computeEMALevel(candles, endIdx - 1, 10))),
    ema21Cross: endIdx > 0 && ((candles[endIdx].c > ema21 && candles[endIdx - 1].c <= computeEMALevel(candles, endIdx - 1, 21)) || (candles[endIdx].c < ema21 && candles[endIdx - 1].c >= computeEMALevel(candles, endIdx - 1, 21))),
    ema55Cross: endIdx > 0 && ((candles[endIdx].c > ema55 && candles[endIdx - 1].c <= computeEMALevel(candles, endIdx - 1, 55)) || (candles[endIdx].c < ema55 && candles[endIdx - 1].c >= computeEMALevel(candles, endIdx - 1, 55))),
    sma200Cross: endIdx > 0 && ((candles[endIdx].c > sma200 && candles[endIdx - 1].c <= computeSMALevel(candles, endIdx - 1, 200)) || (candles[endIdx].c < sma200 && candles[endIdx - 1].c >= computeSMALevel(candles, endIdx - 1, 200))),
    guppySpreadPct: safe(guppy.spreadPct, 99),
    guppyCompressed: guppy.compressed,
    guppyUltraCompressed: guppy.ultraCompressed,
    guppyCompressDays: guppy.compressDays,
    guppyCleanBullishFan: guppy.cleanBullishFan,
    guppyGroupGapPct: safe(guppy.groupGapPct),
    guppyCoiledRelease: guppy.coiledRelease,
    candlePattern: candlePat.short,
    candlePatternFull: candlePat.name,
    candlePatternType: candlePat.type,
    candlePatternStrength: safe(candlePat.strength),
    statsScore: safe(Math.min(score, 100)),
  };
}

// ─── #6: Expected Value Calculator ───────────────────────────────────────────

export function computeExpectedValue(
  winRate: number, avgWinPct: number, avgLossPct: number
): number {
  const wr = winRate / 100;
  return wr * avgWinPct + (1 - wr) * avgLossPct;
}

// ─── #7: Kelly Criterion ─────────────────────────────────────────────────────

export function computeKelly(
  winRate: number, avgWinPct: number, avgLossPct: number, fraction = 0.25
): number {
  const wr = winRate / 100;
  const lr = 1 - wr;
  if (lr <= 0) return 25; // 100% win rate → max Kelly fraction
  if (avgLossPct >= 0) return 0; // no loss data or wrongly signed
  const wlRatio = Math.abs(avgWinPct / avgLossPct);
  const kelly = wr - (lr / wlRatio);
  return Math.max(0, Math.min(kelly * fraction * 100, 25));
}

// ─── #8: Value at Risk (Historical, 95%) ─────────────────────────────────────

export function computeVaR95(
  positions: { symbol: string; value: number; dailyReturns: number[] }[]
): number {
  if (positions.length === 0) return 0;
  // Simple: sum individual VaR (ignores correlation — conservative)
  let totalVaR = 0;
  for (const p of positions) {
    if (p.dailyReturns.length < 10) continue;
    const sorted = [...p.dailyReturns].sort((a, b) => a - b);
    const idx5 = Math.floor(sorted.length * 0.05);
    const var95pct = sorted[idx5] ?? sorted[0] ?? 0;
    totalVaR += p.value * Math.abs(var95pct);
  }
  return totalVaR;
}

// ─── #12: Bayesian Candle Probability ────────────────────────────────────────

export function computeBayesianProb(candles: Candle[], endIdx: number): number {
  // Look back 250 days, find candles similar to the signal candle
  // Check what % moved 5%+ in the next 5 days
  const sig = candles[endIdx];
  const sigRange = sig.h - sig.l;
  if (sigRange <= 0 || sig.c <= 0) return 0;

  const closeLoc = (sig.c - sig.l) / sigRange;
  const bodyPct = Math.abs(sig.c - sig.o) / sigRange;

  let matches = 0, wins = 0;
  const lookback = Math.min(250, endIdx - 5);

  for (let i = Math.max(1, endIdx - lookback); i < endIdx - 5; i++) {
    const c = candles[i];
    const r = c.h - c.l;
    if (r <= 0 || c.c <= 0) continue;

    const cl = (c.c - c.l) / r;
    const bp = Math.abs(c.c - c.o) / r;

    // Similar candle: closeLoc within 15%, bodyPct within 15%
    if (Math.abs(cl - closeLoc) < 0.15 && Math.abs(bp - bodyPct) < 0.15) {
      matches++;
      // Check if price moved 5%+ in next 5 days
      const futureHigh = Math.max(...Array.from({ length: 5 }, (_, j) =>
        i + j + 1 <= endIdx ? candles[i + j + 1].h : 0
      ));
      if (futureHigh >= c.c * 1.05) wins++;
    }
  }

  return matches >= 5 ? Math.round((wins / matches) * 100) : 0;
}
