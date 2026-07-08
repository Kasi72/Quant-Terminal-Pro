// ─── Advanced Predictive Features (Overlay — Non-destructive to param sets) ──
// All 8 features compute from OHLCV only. No external data required.
// Attached to AnalysisResult as `advanced` field; shown in the Advanced tab.

import type { Candle } from './compute';

export interface AdvancedFeatures {
  // 1. Fractal Efficiency Ratio — how linearly price is trending (0→1)
  fer20: number;          // 20-bar FER
  ferTier: 'STRONG' | 'MODERATE' | 'CHOPPY';

  // 2. CUSUM Filter — cumulative return deviation above adaptive threshold
  cusumPos: number;       // S+ value (% return units)
  cusumNeg: number;       // S- value (negative, % return units)
  cusumSignal: boolean;   // S+ > 2 × ATR% (breakout detected)

  // 3. Momentum Wave Convergence — all timeframes aligned + accelerating
  mwcScore: number;       // 0-4 (ROC5>ROC20, ROC20>ROC60, slope5d>0, all 3 positive)
  roc5: number;           // 5-day return %
  roc20: number;          // 20-day return %
  roc60: number;          // 60-day return %

  // 4. Tail-Risk Adjusted Momentum — upside/CVaR ratio
  tram: number;           // ROC_20 / |CVaR_95%|. Higher = better risk/reward
  cvar95: number;         // 60-bar CVaR at 95th worst percentile (negative %)
  tramTier: 'EXCEPTIONAL' | 'GOOD' | 'FAIR' | 'POOR';

  // 5. Clean Momentum Score — return minus max drawdown during the run
  cleanMom: number;       // ROC_20 - MaxDD_20 (both %)
  roc20pct: number;       // raw 20-day return %
  maxDD20: number;        // max intrarun drawdown % (negative)
  cleanTier: 'CLEAN' | 'MODERATE' | 'ROUGH';

  // 6. Regime Duration Signal — where in the run are we?
  regimeDays: number;     // trading days since current momentum regime started
  avgRunLen: number;      // this stock's historical average momentum run length
  durationRatio: number;  // regimeDays / avgRunLen. >1.0 = extended
  durationTier: 'EARLY' | 'MID' | 'LATE' | 'EXTENDED';

  // 7. Vol-Regime Adjusted Momentum — z-score within volatility regime
  volRegime: 'LOW' | 'MID' | 'HIGH';
  vram: number;           // z-score of ROC_20 vs same-regime history
  vramTier: 'STRONG' | 'MODERATE' | 'WEAK' | 'NEGATIVE';

  // 8. Price Impact Coefficient — how much volume moves price (low = latent demand)
  pic: number;            // OLS beta: signed_volume → daily_return (normalised)
  picTier: 'LATENT' | 'NORMAL' | 'REACTIVE';

  // Composite score (0-100) — weighted sum of all 8 signals
  advScore: number;
  advGrade: 'A+' | 'A' | 'B' | 'C' | 'D';
}

// ── helpers ──────────────────────────────────────────────────────────────────

function safe(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[], m?: number): number {
  if (arr.length < 2) return 0;
  const mu = m ?? mean(arr);
  const variance = arr.reduce((s, x) => s + (x - mu) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function olsBeta(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// ── Feature 1: Fractal Efficiency Ratio ──────────────────────────────────────

function computeFER(candles: Candle[], endIdx: number, period = 20): { fer20: number; ferTier: AdvancedFeatures['ferTier'] } {
  if (endIdx < period) return { fer20: 0, ferTier: 'CHOPPY' };
  const start = endIdx - period;
  const netMove = Math.abs(candles[endIdx].c - candles[start].c);
  let pathLen = 0;
  for (let i = start + 1; i <= endIdx; i++) {
    pathLen += Math.abs(candles[i].c - candles[i - 1].c);
  }
  const fer20 = pathLen > 0 ? safe(netMove / pathLen) : 0;
  const ferTier: AdvancedFeatures['ferTier'] =
    fer20 >= 0.60 ? 'STRONG' : fer20 >= 0.35 ? 'MODERATE' : 'CHOPPY';
  return { fer20, ferTier };
}

// ── Feature 2: CUSUM Filter ───────────────────────────────────────────────────

function computeCUSUM(candles: Candle[], endIdx: number, atr14: number): {
  cusumPos: number; cusumNeg: number; cusumSignal: boolean;
} {
  if (endIdx < 20) return { cusumPos: 0, cusumNeg: 0, cusumSignal: false };
  const close = candles[endIdx].c;
  const atrPct = close > 0 ? atr14 / close : 0;
  const threshold = 0.5 * atrPct; // adaptive threshold as % return
  const signalLevel = 2.0 * atrPct;

  let sPos = 0, sNeg = 0;
  const startIdx = Math.max(1, endIdx - 60);
  for (let i = startIdx; i <= endIdx; i++) {
    const ret = candles[i - 1].c > 0 ? (candles[i].c - candles[i - 1].c) / candles[i - 1].c : 0;
    sPos = Math.max(0, sPos + ret - threshold);
    sNeg = Math.min(0, sNeg + ret + threshold);
  }
  return {
    cusumPos: safe(sPos),
    cusumNeg: safe(sNeg),
    cusumSignal: sPos > signalLevel,
  };
}

// ── Feature 3: Momentum Wave Convergence ────────────────────────────────────

function computeMWC(candles: Candle[], endIdx: number): {
  mwcScore: number; roc5: number; roc20: number; roc60: number;
} {
  const c = candles[endIdx].c;
  const roc5  = endIdx >= 5  && candles[endIdx - 5].c  > 0 ? (c / candles[endIdx - 5].c  - 1) * 100 : 0;
  const roc20 = endIdx >= 20 && candles[endIdx - 20].c > 0 ? (c / candles[endIdx - 20].c - 1) * 100 : 0;
  const roc60 = endIdx >= 60 && candles[endIdx - 60].c > 0 ? (c / candles[endIdx - 60].c - 1) * 100 : 0;

  // slope of 5D ROC over last 3 bars
  let slopePosCount = 0;
  if (endIdx >= 7) {
    const roc5_3 = candles[endIdx - 3].c > 0 ? (c / candles[endIdx - 3].c - 1) * 100 : 0;
    if (roc5 > roc5_3) slopePosCount = 1;
  }

  const score =
    (roc5 > roc20 ? 1 : 0) +
    (roc20 > roc60 ? 1 : 0) +
    (roc5 > 0 ? 1 : 0) +
    slopePosCount;

  return { mwcScore: score, roc5: safe(roc5), roc20: safe(roc20), roc60: safe(roc60) };
}

// ── Feature 4: Tail-Risk Adjusted Momentum (CVaR) ────────────────────────────

function computeTRAM(candles: Candle[], endIdx: number): {
  tram: number; cvar95: number; tramTier: AdvancedFeatures['tramTier'];
} {
  const period60 = 60;
  if (endIdx < period60) return { tram: 0, cvar95: 0, tramTier: 'POOR' };

  const returns: number[] = [];
  for (let i = endIdx - period60 + 1; i <= endIdx; i++) {
    if (candles[i - 1].c > 0) {
      returns.push((candles[i].c - candles[i - 1].c) / candles[i - 1].c * 100);
    }
  }
  returns.sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor(returns.length * 0.05));
  const worstReturns = returns.slice(0, cutoff);
  const cvar95 = mean(worstReturns); // negative number

  const roc20 = candles[endIdx - 20].c > 0
    ? (candles[endIdx].c / candles[endIdx - 20].c - 1) * 100 : 0;

  const tram = Math.abs(cvar95) > 0.001 ? safe(roc20 / Math.abs(cvar95)) : 0;
  const tramTier: AdvancedFeatures['tramTier'] =
    tram >= 3.0 ? 'EXCEPTIONAL' : tram >= 1.5 ? 'GOOD' : tram >= 0.5 ? 'FAIR' : 'POOR';

  return { tram: safe(tram), cvar95: safe(cvar95), tramTier };
}

// ── Feature 5: Clean Momentum Score ──────────────────────────────────────────

function computeCleanMom(candles: Candle[], endIdx: number): {
  cleanMom: number; roc20pct: number; maxDD20: number; cleanTier: AdvancedFeatures['cleanTier'];
} {
  if (endIdx < 20) return { cleanMom: 0, roc20pct: 0, maxDD20: 0, cleanTier: 'ROUGH' };

  const startClose = candles[endIdx - 20].c;
  const endClose = candles[endIdx].c;
  const roc20pct = startClose > 0 ? (endClose / startClose - 1) * 100 : 0;

  // max drawdown within the 20-bar window
  let peak = candles[endIdx - 20].h;
  let maxDD = 0;
  for (let i = endIdx - 19; i <= endIdx; i++) {
    if (candles[i].h > peak) peak = candles[i].h;
    const dd = peak > 0 ? (candles[i].l - peak) / peak * 100 : 0; // negative
    if (dd < maxDD) maxDD = dd;
  }

  const cleanMom = safe(roc20pct + maxDD); // maxDD is negative, so this penalises drawdowns
  const cleanTier: AdvancedFeatures['cleanTier'] =
    maxDD > -3 && roc20pct > 5  ? 'CLEAN' :
    maxDD > -7 ? 'MODERATE' : 'ROUGH';

  return { cleanMom: safe(cleanMom), roc20pct: safe(roc20pct), maxDD20: safe(maxDD), cleanTier };
}

// ── Feature 6: Regime Duration Signal ────────────────────────────────────────

function computeRegimeDuration(candles: Candle[], endIdx: number, atr14: number): {
  regimeDays: number; avgRunLen: number; durationRatio: number;
  durationTier: AdvancedFeatures['durationTier'];
} {
  if (endIdx < 30) return { regimeDays: 0, avgRunLen: 0, durationRatio: 0, durationTier: 'EARLY' };

  const close = candles[endIdx].c;
  const threshold = close > 0 ? atr14 / close : 0.015; // ~1 ATR% as momentum threshold per bar

  // Build a list of all momentum runs: count consecutive bars where 5D return > threshold
  const runs: number[] = [];
  let inRun = false;
  let runLen = 0;
  let currentRunStart = -1;

  for (let i = 5; i <= endIdx; i++) {
    const ret = candles[i - 5].c > 0 ? (candles[i].c / candles[i - 5].c - 1) : 0;
    if (ret > threshold) {
      if (!inRun) { inRun = true; runLen = 1; currentRunStart = i; }
      else runLen++;
    } else {
      if (inRun && runLen >= 3) runs.push(runLen); // only count meaningful runs (≥3 days)
      inRun = false;
      runLen = 0;
    }
  }

  // Current run: from currentRunStart to endIdx
  const regimeDays = inRun ? runLen : 0;
  const avgRunLen = runs.length >= 3 ? mean(runs) : 10; // default 10 bars if no history
  const durationRatio = avgRunLen > 0 ? safe(regimeDays / avgRunLen) : 0;

  const durationTier: AdvancedFeatures['durationTier'] =
    !inRun || durationRatio < 0.3 ? 'EARLY' :
    durationRatio < 0.6 ? 'MID' :
    durationRatio < 1.0 ? 'LATE' : 'EXTENDED';

  return { regimeDays, avgRunLen: safe(avgRunLen), durationRatio: safe(durationRatio), durationTier };
}

// ── Feature 7: Vol-Regime Adjusted Momentum ──────────────────────────────────

function computeVRAM(candles: Candle[], endIdx: number): {
  volRegime: AdvancedFeatures['volRegime']; vram: number; vramTier: AdvancedFeatures['vramTier'];
} {
  if (endIdx < 80) return { volRegime: 'MID', vram: 0, vramTier: 'WEAK' };

  // Build ATR% history to classify vol regimes
  const atrPcts: number[] = [];
  let prevH = candles[0].h, prevL = candles[0].l, prevC = candles[0].c;
  for (let i = 1; i <= endIdx; i++) {
    const tr = Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - prevC), Math.abs(candles[i].l - prevC));
    atrPcts.push(candles[i].c > 0 ? tr / candles[i].c * 100 : 0);
    prevH = candles[i].h; prevL = candles[i].l; prevC = candles[i].c;
  }

  // Classify each bar into vol regime using rolling 20-bar ATR pctl
  const currentATRPct = atrPcts[endIdx - 1];
  const window = atrPcts.slice(Math.max(0, endIdx - 120), endIdx);
  const sorted = [...window].sort((a, b) => a - b);
  const rank = sorted.findIndex(v => v >= currentATRPct) / sorted.length;
  const volRegime: AdvancedFeatures['volRegime'] = rank < 0.33 ? 'LOW' : rank < 0.67 ? 'MID' : 'HIGH';

  // Collect ROC20 values from same vol regime in history
  const regimeROCs: number[] = [];
  for (let i = 30; i < endIdx; i++) {
    const histATRPct = atrPcts[i - 1];
    const histRank = sorted.findIndex(v => v >= histATRPct) / sorted.length;
    const histRegime: AdvancedFeatures['volRegime'] = histRank < 0.33 ? 'LOW' : histRank < 0.67 ? 'MID' : 'HIGH';
    if (histRegime === volRegime && i >= 20 && candles[i - 20].c > 0) {
      regimeROCs.push((candles[i].c / candles[i - 20].c - 1) * 100);
    }
  }

  if (regimeROCs.length < 10) return { volRegime, vram: 0, vramTier: 'WEAK' };

  const currentROC20 = endIdx >= 20 && candles[endIdx - 20].c > 0
    ? (candles[endIdx].c / candles[endIdx - 20].c - 1) * 100 : 0;

  const mu = mean(regimeROCs);
  const sigma = std(regimeROCs, mu);
  const vram = sigma > 0 ? safe((currentROC20 - mu) / sigma) : 0;

  const vramTier: AdvancedFeatures['vramTier'] =
    vram >= 1.5 ? 'STRONG' : vram >= 0.5 ? 'MODERATE' : vram >= 0 ? 'WEAK' : 'NEGATIVE';

  return { volRegime, vram: safe(vram), vramTier };
}

// ── Feature 8: Price Impact Coefficient ──────────────────────────────────────

function computePIC(candles: Candle[], endIdx: number): {
  pic: number; picTier: AdvancedFeatures['picTier'];
} {
  const period = 20;
  if (endIdx < period + 1) return { pic: 0, picTier: 'NORMAL' };

  const signedVols: number[] = [];
  const dailyReturns: number[] = [];

  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    const ret = candles[i - 1].c > 0 ? (candles[i].c - candles[i - 1].c) / candles[i - 1].c : 0;
    const sign = ret > 0 ? 1 : ret < 0 ? -1 : 0;
    signedVols.push(candles[i].v * sign);
    dailyReturns.push(ret);
  }

  // Normalise signed volumes by mean absolute volume
  const meanAbsVol = mean(signedVols.map(Math.abs)) || 1;
  const normSignedVols = signedVols.map(v => v / meanAbsVol);

  const beta = olsBeta(normSignedVols, dailyReturns);
  const pic = safe(beta * 1000); // scale for readability (× 1000)

  // Low PIC = price barely moves per unit of signed flow = latent demand / stealth accumulation
  const picTier: AdvancedFeatures['picTier'] =
    Math.abs(pic) < 2.0 ? 'LATENT' : Math.abs(pic) < 5.0 ? 'NORMAL' : 'REACTIVE';

  return { pic: safe(pic), picTier };
}

// ── Composite Score ───────────────────────────────────────────────────────────

function computeAdvScore(f: Omit<AdvancedFeatures, 'advScore' | 'advGrade'>): number {
  let s = 0;

  // FER (0-20 pts)
  s += f.ferTier === 'STRONG' ? 20 : f.ferTier === 'MODERATE' ? 10 : 0;

  // CUSUM (0-15 pts)
  s += f.cusumSignal ? 15 : f.cusumPos > 0 ? 7 : 0;

  // MWC (0-15 pts)
  s += f.mwcScore >= 4 ? 15 : f.mwcScore === 3 ? 10 : f.mwcScore === 2 ? 5 : 0;

  // TRAM (0-15 pts)
  s += f.tramTier === 'EXCEPTIONAL' ? 15 : f.tramTier === 'GOOD' ? 10 : f.tramTier === 'FAIR' ? 5 : 0;

  // Clean Momentum (0-15 pts)
  s += f.cleanTier === 'CLEAN' ? 15 : f.cleanTier === 'MODERATE' ? 7 : 0;

  // Duration (0-10 pts) — reward early/mid, penalise extended
  s += f.durationTier === 'EARLY' ? 10 : f.durationTier === 'MID' ? 8 : f.durationTier === 'LATE' ? 4 : 0;

  // VRAM (0-10 pts)
  s += f.vramTier === 'STRONG' ? 10 : f.vramTier === 'MODERATE' ? 6 : 0;

  // PIC (0-10 pts)
  s += f.picTier === 'LATENT' ? 10 : f.picTier === 'NORMAL' ? 5 : 0;

  return Math.min(100, s);
}

// ── Main Export ───────────────────────────────────────────────────────────────

export function computeAdvancedFeatures(candles: Candle[], endIdx: number, atr14: number): AdvancedFeatures {
  if (endIdx < 20 || candles.length < 21) {
    return {
      fer20: 0, ferTier: 'CHOPPY',
      cusumPos: 0, cusumNeg: 0, cusumSignal: false,
      mwcScore: 0, roc5: 0, roc20: 0, roc60: 0,
      tram: 0, cvar95: 0, tramTier: 'POOR',
      cleanMom: 0, roc20pct: 0, maxDD20: 0, cleanTier: 'ROUGH',
      regimeDays: 0, avgRunLen: 0, durationRatio: 0, durationTier: 'EARLY',
      volRegime: 'MID', vram: 0, vramTier: 'WEAK',
      pic: 0, picTier: 'NORMAL',
      advScore: 0, advGrade: 'D',
    };
  }

  const { fer20, ferTier } = computeFER(candles, endIdx);
  const { cusumPos, cusumNeg, cusumSignal } = computeCUSUM(candles, endIdx, atr14);
  const { mwcScore, roc5, roc20, roc60 } = computeMWC(candles, endIdx);
  const { tram, cvar95, tramTier } = computeTRAM(candles, endIdx);
  const { cleanMom, roc20pct, maxDD20, cleanTier } = computeCleanMom(candles, endIdx);
  const { regimeDays, avgRunLen, durationRatio, durationTier } = computeRegimeDuration(candles, endIdx, atr14);
  const { volRegime, vram, vramTier } = computeVRAM(candles, endIdx);
  const { pic, picTier } = computePIC(candles, endIdx);

  const partial = {
    fer20, ferTier, cusumPos, cusumNeg, cusumSignal,
    mwcScore, roc5, roc20, roc60,
    tram, cvar95, tramTier,
    cleanMom, roc20pct, maxDD20, cleanTier,
    regimeDays, avgRunLen, durationRatio, durationTier,
    volRegime, vram, vramTier,
    pic, picTier,
  };

  const advScore = computeAdvScore(partial);
  const advGrade: AdvancedFeatures['advGrade'] =
    advScore >= 80 ? 'A+' : advScore >= 65 ? 'A' : advScore >= 45 ? 'B' : advScore >= 25 ? 'C' : 'D';

  return { ...partial, advScore, advGrade };
}
