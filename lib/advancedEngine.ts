// ─── Advanced Predictive Features (Overlay — Non-destructive to param sets) ──
// All 8 features compute from OHLCV only. No external data required.
// Attached to AnalysisResult as `advanced` field; shown in the Advanced tab.
//
// Tier boundaries and composite weights derived from 558,650-observation backtest
// on NIFTY ALL 1617 dataset (every 3rd bar from bar 80+, 20-day forward return).

import type { Candle } from './compute';

export interface AdvancedFeatures {
  // 9. UT Bot Alerts — live buy-signal detection (two param sets from grid-search backtest)
  //    PRECISION: VWMA-55/ATR14/Sens2.0 → 60.5% WR10 (late but high confidence)
  //    EARLY:     TEMA-10/ATR7 /Sens1.0 → 57.0% WR10  (fires 5 bars sooner, lag≈8)
  //    BOTH:      confluence — when VRAM<−1.1 + FER≥0.55 also present → empirical ~85% WR10
  utbotMode: 'BOTH' | 'PRECISION' | 'EARLY' | 'NONE';
  utbotBarsAgo: number;   // bars since signal fired (0=today, 1=yesterday, 99=no signal in last 3 bars)
  utbotLag: number;       // bars from 20-bar rolling low to signal (lower=earlier catch)
  utbotEntry: number;     // ATR-based entry price: signalBar High + 0.75×ATR14 (best reversal formula)

  // 1. Fractal Efficiency Ratio — how linearly price is trending (0→1)
  //    Higher = more efficient move = stronger trend.  Sweet spot: >0.55 (+3.11pp edge)
  fer20: number;
  ferTier: 'EFFICIENT' | 'MODERATE' | 'CHOPPY';

  // 2. CUSUM Filter — cumulative upward return deviation above adaptive threshold
  //    INVERTED: high CUSUM = overbought/chased. Sweet spot: CUSUM ≈ 0 (no signal).
  cusumPos: number;       // S+ value (% return units)
  cusumNeg: number;       // S- value
  cusumSignal: boolean;   // S+ > 2×ATR% (elevated drift detected — bearish for 20d)
  cusumTier: 'IDLE' | 'MILD' | 'ELEVATED';

  // 3. Momentum Wave Convergence — CONTRARIAN: low score = not yet chased
  //    Score 0 best (+0.94pp), Score 4 worst (-1.38pp). Counter-trend sweet spot.
  mwcScore: number;       // 0-4
  roc5: number;
  roc20: number;
  roc60: number;
  mwcTier: 'CONTRARIAN' | 'MIXED' | 'CROWDED';

  // 4. Tail-Risk Adjusted Momentum — MEAN REVERSION: negative TRAM = oversold
  //    TRAM < −3 → +3.96pp edge (bounce candidate). TRAM > 0 → no edge.
  tram: number;
  cvar95: number;
  tramTier: 'OVERSOLD' | 'DEPRESSED' | 'NEUTRAL' | 'EXTENDED';

  // 5. Clean Momentum — MEAN REVERSION: deep negative = crash bounce candidate
  //    CleanMom < −28% → +3-5pp edge. Overbought (>+11%) → −0.87pp.
  cleanMom: number;
  roc20pct: number;
  maxDD20: number;
  cleanTier: 'DEEP_VALUE' | 'RECOVERING' | 'NEUTRAL' | 'OVERBOUGHT';

  // 6. Regime Duration Ratio — IDLE (not in run) is sweet spot (+1.59pp)
  //    When stock IS in a momentum run, forward returns are worse.
  regimeDays: number;
  avgRunLen: number;
  durationRatio: number;
  durationTier: 'IDLE' | 'EARLY' | 'MID' | 'EXTENDED';

  // 7. Vol-Regime Adjusted Momentum — INVERTED: low z-score = oversold = bounce
  //    VRAM < −1.1 → +4.64pp edge (strongest single feature signal).
  volRegime: 'LOW' | 'MID' | 'HIGH';
  vram: number;
  vramTier: 'OVERSOLD' | 'LOW' | 'NEUTRAL' | 'ELEVATED' | 'OVERBOUGHT';

  // 8. Price Impact Coefficient — mid-range PIC (16-25) has slight edge (+0.96pp)
  //    Low PIC (<8) is weakly negative. Feature has modest discriminating power.
  pic: number;
  picTier: 'REACTIVE_LOW' | 'FAIR' | 'ACTIVE' | 'HIGH' | 'SATURATED';

  // Composite score (0–100) — weighted by empirical edge size
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
// Sweet spot: >0.55 (+3.11pp). Monotonically positive relationship.

function computeFER(candles: Candle[], endIdx: number, period = 20): {
  fer20: number; ferTier: AdvancedFeatures['ferTier'];
} {
  if (endIdx < period) return { fer20: 0, ferTier: 'CHOPPY' };
  const start = endIdx - period;
  const netMove = Math.abs(candles[endIdx].c - candles[start].c);
  let pathLen = 0;
  for (let i = start + 1; i <= endIdx; i++) {
    pathLen += Math.abs(candles[i].c - candles[i - 1].c);
  }
  const fer20 = pathLen > 0 ? safe(netMove / pathLen) : 0;
  // Backtest-validated thresholds:  >0.55 = +3.11pp,  0.30-0.55 = ~+0.5pp,  <0.30 = ~−0.8pp
  const ferTier: AdvancedFeatures['ferTier'] =
    fer20 >= 0.55 ? 'EFFICIENT' : fer20 >= 0.30 ? 'MODERATE' : 'CHOPPY';
  return { fer20, ferTier };
}

// ── Feature 2: CUSUM Filter ───────────────────────────────────────────────────
// INVERTED: high CUSUM signals chased price, not accumulation.
// >0.064 CUSUM → −2.36pp worst bin. CUSUM≈0 → slight positive.

function computeCUSUM(candles: Candle[], endIdx: number, atr14: number): {
  cusumPos: number; cusumNeg: number; cusumSignal: boolean;
  cusumTier: AdvancedFeatures['cusumTier'];
} {
  if (endIdx < 20) return { cusumPos: 0, cusumNeg: 0, cusumSignal: false, cusumTier: 'IDLE' };
  const close = candles[endIdx].c;
  const atrPct = close > 0 ? atr14 / close : 0;
  const threshold = 0.5 * atrPct;
  const signalLevel = 2.0 * atrPct;

  let sPos = 0, sNeg = 0;
  const startIdx = Math.max(1, endIdx - 60);
  for (let i = startIdx; i <= endIdx; i++) {
    const ret = candles[i - 1].c > 0 ? (candles[i].c - candles[i - 1].c) / candles[i - 1].c : 0;
    sPos = Math.max(0, sPos + ret - threshold);
    sNeg = Math.min(0, sNeg + ret + threshold);
  }

  // Empirical thresholds: >0.064 CUSUM → bearish signal (−2.36pp), 0-0.064 → mild positive
  const cusumTier: AdvancedFeatures['cusumTier'] =
    sPos === 0 ? 'IDLE' : sPos < 0.064 ? 'MILD' : 'ELEVATED';

  return {
    cusumPos: safe(sPos),
    cusumNeg: safe(sNeg),
    cusumSignal: sPos > signalLevel,
    cusumTier,
  };
}

// ── Feature 3: Momentum Wave Convergence ─────────────────────────────────────
// CONTRARIAN: Score 0 → +0.94pp, Score 4 → −1.38pp. "Low score = not chased yet."

function computeMWC(candles: Candle[], endIdx: number): {
  mwcScore: number; roc5: number; roc20: number; roc60: number;
  mwcTier: AdvancedFeatures['mwcTier'];
} {
  const c = candles[endIdx].c;
  const roc5  = endIdx >= 5  && candles[endIdx - 5].c  > 0 ? (c / candles[endIdx - 5].c  - 1) * 100 : 0;
  const roc20 = endIdx >= 20 && candles[endIdx - 20].c > 0 ? (c / candles[endIdx - 20].c - 1) * 100 : 0;
  const roc60 = endIdx >= 60 && candles[endIdx - 60].c > 0 ? (c / candles[endIdx - 60].c - 1) * 100 : 0;

  let slopePosCount = 0;
  if (endIdx >= 8) {
    const prev5Base = candles[endIdx - 3 - 5].c;
    const prev5End  = candles[endIdx - 3].c;
    const roc5_prev = prev5Base > 0 ? (prev5End / prev5Base - 1) * 100 : 0;
    if (roc5 > roc5_prev) slopePosCount = 1;
  }

  const score =
    (roc5 > roc20 ? 1 : 0) +
    (roc20 > roc60 ? 1 : 0) +
    (roc5 > 0 ? 1 : 0) +
    slopePosCount;

  // Score 0-1 = contrarian sweet spot; Score 2 = neutral; Score 3-4 = crowded/overbought
  const mwcTier: AdvancedFeatures['mwcTier'] =
    score <= 1 ? 'CONTRARIAN' : score <= 2 ? 'MIXED' : 'CROWDED';

  return { mwcScore: score, roc5: safe(roc5), roc20: safe(roc20), roc60: safe(roc60), mwcTier };
}

// ── Feature 4: Tail-Risk Adjusted Momentum (CVaR) ────────────────────────────
// MEAN-REVERSION: TRAM < −3 → +3.96pp. Negative = beaten-down stock with high tail risk.
// Old interpretation (high TRAM = good) was WRONG. Inverted.

function computeTRAM(candles: Candle[], endIdx: number): {
  tram: number; cvar95: number; tramTier: AdvancedFeatures['tramTier'];
} {
  if (endIdx < 60) return { tram: 0, cvar95: 0, tramTier: 'NEUTRAL' };

  const returns: number[] = [];
  for (let i = endIdx - 59; i <= endIdx; i++) {
    if (i >= 1 && candles[i - 1].c > 0) {
      returns.push((candles[i].c - candles[i - 1].c) / candles[i - 1].c * 100);
    }
  }
  if (returns.length < 10) return { tram: 0, cvar95: 0, tramTier: 'NEUTRAL' };

  returns.sort((a, b) => a - b);
  const cutoff = Math.max(1, Math.floor(returns.length * 0.05));
  const cvar95 = mean(returns.slice(0, cutoff));

  const base20 = candles[endIdx - 20];
  const roc20 = base20.c > 0 ? (candles[endIdx].c / base20.c - 1) * 100 : 0;

  const tram = Math.abs(cvar95) > 0.001 ? safe(roc20 / Math.abs(cvar95)) : 0;

  // Backtest-validated: <−3.0 → +3.96pp, −3 to −1.4 → +1.37pp, −1.4 to 0.5 → flat, >0.5 → no edge
  const tramTier: AdvancedFeatures['tramTier'] =
    tram < -3.0 ? 'OVERSOLD' :
    tram < -1.4 ? 'DEPRESSED' :
    tram < 0.5  ? 'NEUTRAL' : 'EXTENDED';

  return { tram: safe(tram), cvar95: safe(cvar95), tramTier };
}

// ── Feature 5: Clean Momentum Score ──────────────────────────────────────────
// MEAN-REVERSION: deeply negative = crash bounce candidate.
// <−28% → +3-5pp edge (best bin). >+11% → −0.87pp (overbought).

function computeCleanMom(candles: Candle[], endIdx: number): {
  cleanMom: number; roc20pct: number; maxDD20: number;
  cleanTier: AdvancedFeatures['cleanTier'];
} {
  if (endIdx < 20) return { cleanMom: 0, roc20pct: 0, maxDD20: 0, cleanTier: 'NEUTRAL' };

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

  const cleanMom = safe(roc20pct + maxDD);

  // Backtest-validated: <−28% → deep value bounce (+3-5pp); −28 to −10% → recovering;
  // −10 to +11% → neutral; >+11% → overbought (−0.87pp)
  const cleanTier: AdvancedFeatures['cleanTier'] =
    cleanMom < -28 ? 'DEEP_VALUE' :
    cleanMom < -10 ? 'RECOVERING' :
    cleanMom < 11  ? 'NEUTRAL' : 'OVERBOUGHT';

  return { cleanMom: safe(cleanMom), roc20pct: safe(roc20pct), maxDD20: safe(maxDD), cleanTier };
}

// ── Feature 6: Regime Duration Signal ────────────────────────────────────────
// IDLE (durationRatio=0, not in a run) is the sweet spot (+1.59pp).
// When stock IS in an active run, forward returns progressively worsen.

function computeRegimeDuration(candles: Candle[], endIdx: number, atr14: number): {
  regimeDays: number; avgRunLen: number; durationRatio: number;
  durationTier: AdvancedFeatures['durationTier'];
} {
  if (endIdx < 30) return { regimeDays: 0, avgRunLen: 0, durationRatio: 0, durationTier: 'IDLE' };

  const close = candles[endIdx].c;
  const threshold = close > 0 ? atr14 / close : 0.015;

  const runs: number[] = [];
  let inRun = false;
  let runLen = 0;

  for (let i = 5; i <= endIdx; i++) {
    const ret = candles[i - 5].c > 0 ? (candles[i].c / candles[i - 5].c - 1) : 0;
    if (ret > threshold) {
      if (!inRun) { inRun = true; runLen = 1; }
      else runLen++;
    } else {
      if (inRun && runLen >= 3) runs.push(runLen);
      inRun = false;
      runLen = 0;
    }
  }

  const regimeDays = inRun ? runLen : 0;
  const avgRunLen = runs.length >= 3 ? mean(runs) : 10;
  const durationRatio = avgRunLen > 0 ? safe(regimeDays / avgRunLen) : 0;

  // Backtest-validated: IDLE (not in run) → +1.59pp. In run → worsening returns.
  const durationTier: AdvancedFeatures['durationTier'] =
    !inRun ? 'IDLE' :
    durationRatio < 0.30 ? 'EARLY' :
    durationRatio < 0.76 ? 'MID' : 'EXTENDED';

  return { regimeDays, avgRunLen: safe(avgRunLen), durationRatio: safe(durationRatio), durationTier };
}

// ── Feature 7: Vol-Regime Adjusted Momentum ──────────────────────────────────
// INVERTED: VRAM < −1.1 → +4.64pp (strongest feature). Positive VRAM → mean-reverting down.

function pctRank(sortedArr: number[], v: number): number {
  if (sortedArr.length === 0) return 0.5;
  let lo = 0, hi = sortedArr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sortedArr[m] < v) lo = m + 1; else hi = m; }
  return lo / sortedArr.length;
}

function toVolRegime(rank: number): AdvancedFeatures['volRegime'] {
  return rank < 0.33 ? 'LOW' : rank < 0.67 ? 'MID' : 'HIGH';
}

function computeVRAM(candles: Candle[], endIdx: number): {
  volRegime: AdvancedFeatures['volRegime']; vram: number; vramTier: AdvancedFeatures['vramTier'];
} {
  if (endIdx < 80) return { volRegime: 'MID', vram: 0, vramTier: 'NEUTRAL' };

  const atrPcts: number[] = [];
  let prevC = candles[0].c;
  for (let i = 1; i <= endIdx; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - prevC),
      Math.abs(candles[i].l - prevC),
    );
    atrPcts.push(candles[i].c > 0 ? tr / candles[i].c * 100 : 0);
    prevC = candles[i].c;
  }

  const window = atrPcts.slice(Math.max(0, endIdx - 120), endIdx);
  const sorted = [...window].sort((a, b) => a - b);

  const currentATRPct = atrPcts[endIdx - 1];
  const volRegime = toVolRegime(pctRank(sorted, currentATRPct));

  const regimeROCs: number[] = [];
  for (let i = 20; i < endIdx; i++) {
    const histRank = pctRank(sorted, atrPcts[i - 1]);
    if (toVolRegime(histRank) === volRegime && candles[i - 20].c > 0) {
      regimeROCs.push((candles[i].c / candles[i - 20].c - 1) * 100);
    }
  }

  if (regimeROCs.length < 10) return { volRegime, vram: 0, vramTier: 'NEUTRAL' };

  const currentROC20 = candles[endIdx - 20].c > 0
    ? (candles[endIdx].c / candles[endIdx - 20].c - 1) * 100 : 0;

  const mu = mean(regimeROCs);
  const sigma = std(regimeROCs, mu);
  const vram = sigma > 0 ? safe((currentROC20 - mu) / sigma) : 0;

  // Backtest-validated (INVERTED from original design):
  // < −1.1 → +4.64pp (OVERSOLD), −1.1 to −0.76 → +2.93pp (LOW),
  // −0.76 to +0.35 → ~flat (NEUTRAL), +0.35 to +0.93 → +1pp (ELEVATED),
  // > +0.93 → −1.14pp (OVERBOUGHT)
  const vramTier: AdvancedFeatures['vramTier'] =
    vram < -1.1  ? 'OVERSOLD' :
    vram < -0.76 ? 'LOW' :
    vram < 0.35  ? 'NEUTRAL' :
    vram < 0.93  ? 'ELEVATED' : 'OVERBOUGHT';

  return { volRegime, vram: safe(vram), vramTier };
}

// ── Feature 8: Price Impact Coefficient ──────────────────────────────────────
// Mid-range PIC (16-25) → +0.96pp edge. Low (<8) slightly negative. Modest signal.

function computePIC(candles: Candle[], endIdx: number): {
  pic: number; picTier: AdvancedFeatures['picTier'];
} {
  const period = 20;
  if (endIdx < period + 1) return { pic: 0, picTier: 'FAIR' };

  const signedVols: number[] = [];
  const dailyReturns: number[] = [];

  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    const ret = candles[i - 1].c > 0 ? (candles[i].c - candles[i - 1].c) / candles[i - 1].c : 0;
    const sign = ret > 0 ? 1 : ret < 0 ? -1 : 0;
    signedVols.push(candles[i].v * sign);
    dailyReturns.push(ret);
  }

  const meanAbsVol = mean(signedVols.map(Math.abs)) || 1;
  const normSignedVols = signedVols.map(v => v / meanAbsVol);

  const beta = olsBeta(normSignedVols, dailyReturns);
  const pic = safe(beta * 1000);

  // Backtest-validated: <8 → slight negative, 8-16 → fair, 16-25 → sweet spot, >25-30 → high, >30 → flat
  const picTier: AdvancedFeatures['picTier'] =
    pic < 8   ? 'REACTIVE_LOW' :
    pic < 16  ? 'FAIR' :
    pic < 25  ? 'ACTIVE' :
    pic < 30  ? 'HIGH' : 'SATURATED';

  return { pic: safe(pic), picTier };
}

// ── Composite Score (empirically weighted) ────────────────────────────────────
// Weights proportional to confirmed 20d WR edge size from 558,650-obs backtest.

function computeAdvScore(f: Omit<AdvancedFeatures, 'advScore' | 'advGrade'>): number {
  let s = 0;

  // UTBot timing signal — up to 20 bonus pts (on top of feature scores, capped at 100 total)
  // BOTH mode = VWMA-55 + TEMA-10 confluence → highest conviction entry timing
  // When BOTH fires with VRAM OVERSOLD + FER EFFICIENT: empirical ~85% WR10 from grid search
  const utbotFresh = f.utbotBarsAgo <= 1; // signal fired today or yesterday
  s += f.utbotMode === 'BOTH'      ? (utbotFresh ? 20 : 14) :
       f.utbotMode === 'PRECISION' ? (utbotFresh ? 12 : 8)  :
       f.utbotMode === 'EARLY'     ? (utbotFresh ? 10 : 6)  : 0;

  // VRAM (max edge +4.64pp) — 20 pts
  s += f.vramTier === 'OVERSOLD'   ? 20 :
       f.vramTier === 'LOW'        ? 12 :
       f.vramTier === 'NEUTRAL'    ?  4 :
       f.vramTier === 'ELEVATED'   ?  6 :  // mild positive edge
       /* OVERBOUGHT */               0;

  // TRAM (max edge +3.96pp) — 20 pts
  s += f.tramTier === 'OVERSOLD'   ? 20 :
       f.tramTier === 'DEPRESSED'  ? 10 :
       f.tramTier === 'NEUTRAL'    ?  2 :
       /* EXTENDED */                 0;

  // FER (max edge +3.11pp, momentum-positive relationship) — 15 pts
  s += f.ferTier === 'EFFICIENT'   ? 15 :
       f.ferTier === 'MODERATE'    ?  7 :
       /* CHOPPY */                   0;

  // CleanMom (max edge +5.03pp deep value) — 15 pts
  s += f.cleanTier === 'DEEP_VALUE'  ? 15 :
       f.cleanTier === 'RECOVERING'  ?  8 :
       f.cleanTier === 'NEUTRAL'     ?  4 :
       /* OVERBOUGHT */                 0;

  // DurationRatio (IDLE = sweet spot +1.59pp) — 10 pts
  s += f.durationTier === 'IDLE'     ? 10 :
       f.durationTier === 'EARLY'    ?  4 :
       f.durationTier === 'MID'      ?  1 :
       /* EXTENDED */                   0;

  // MWC (contrarian: score 0 = +0.94pp, score 4 = −1.38pp) — 10 pts
  s += f.mwcTier === 'CONTRARIAN'  ? 10 :
       f.mwcTier === 'MIXED'       ?  5 :
       /* CROWDED */                  0;

  // CUSUM (inverted: IDLE = sweet spot) — 5 pts
  s += f.cusumTier === 'IDLE'      ?  5 :
       f.cusumTier === 'MILD'      ?  3 :
       /* ELEVATED */                 0;

  // PIC (weak edge at ACTIVE tier) — 5 pts
  s += f.picTier === 'ACTIVE'      ?  5 :
       f.picTier === 'HIGH'        ?  4 :
       f.picTier === 'FAIR'        ?  3 :
       f.picTier === 'SATURATED'   ?  2 :
       /* REACTIVE_LOW */             0;

  return Math.min(100, s);
}

// ── Feature 9: UT Bot Alerts (two grid-search-optimal param sets) ────────────
// Translates Pine Script v5 UT Bot Alerts to TypeScript.
// Buy signal = src crosses ABOVE the ATR trailing stop.
// Two modes run in parallel; BOTH = confluence (highest conviction).

function emaArr(candles: Candle[], endIdx: number, period: number): number[] {
  const k = 2 / (period + 1);
  const out = new Array(endIdx + 1).fill(0);
  out[0] = candles[0].c;
  for (let i = 1; i <= endIdx; i++) out[i] = candles[i].c * k + out[i - 1] * (1 - k);
  return out;
}

function temaArr(candles: Candle[], endIdx: number, period: number): number[] {
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

function vwmaArr(candles: Candle[], endIdx: number, period: number): number[] {
  const out = new Array(endIdx + 1).fill(0);
  let sumPV = 0, sumV = 0;
  for (let i = 0; i <= endIdx; i++) {
    sumPV += candles[i].c * candles[i].v;
    sumV  += candles[i].v;
    if (i >= period) {
      sumPV -= candles[i - period].c * candles[i - period].v;
      sumV  -= candles[i - period].v;
    }
    out[i] = sumV > 0 ? sumPV / sumV : candles[i].c;
  }
  return out;
}

function atrArr(candles: Candle[], endIdx: number, period: number): number[] {
  const out = new Array(endIdx + 1).fill(0);
  for (let i = 1; i <= endIdx; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c),
    );
    out[i] = i === 1 ? tr : (out[i - 1] * (period - 1) + tr) / period;
  }
  return out;
}

function utBotTrailingStop(src: number[], atr: number[], endIdx: number, sensitivity: number): number[] {
  const stop = new Array(endIdx + 1).fill(0);
  // Bug 12 fix: seed stop[0] properly to avoid cold-start discontinuity (was 0)
  stop[0] = src[0] - sensitivity * (atr[0] || atr[1] || 1);
  for (let i = 1; i <= endIdx; i++) {
    if (atr[i] === 0) { stop[i] = stop[i - 1]; continue; }
    const ps = stop[i - 1], pSrc = src[i - 1], cSrc = src[i], loss = sensitivity * atr[i];
    if (cSrc > ps && pSrc > ps)       stop[i] = Math.max(ps, cSrc - loss);
    else if (cSrc < ps && pSrc < ps)  stop[i] = Math.min(ps, cSrc + loss);
    else                               stop[i] = cSrc > ps ? cSrc - loss : cSrc + loss;
  }
  return stop;
}

function findLatestBuySignal(
  src: number[], stop: number[], candles: Candle[], atr14: number[], endIdx: number, lookback = 3,
): { fired: boolean; barsAgo: number; lag: number; entry: number } {
  for (let d = 0; d < lookback; d++) {
    const i = endIdx - d;
    if (i < 1) continue;
    if (src[i] > stop[i] && src[i - 1] <= stop[i - 1]) {
      // Buy crossover at bar i — measure lag from 20-bar rolling low
      const lb = Math.max(0, i - 20);
      let minC = candles[lb].c, minBar = lb;
      for (let k = lb + 1; k <= i; k++) {
        if (candles[k].c < minC) { minC = candles[k].c; minBar = k; }
      }
      const entry = candles[i].h + 0.75 * (atr14[i] || 0);
      return { fired: true, barsAgo: d, lag: i - minBar, entry: safe(entry) };
    }
  }
  return { fired: false, barsAgo: 99, lag: 0, entry: 0 };
}

function computeUTBot(candles: Candle[], endIdx: number, atr14: number[]): {
  utbotMode: AdvancedFeatures['utbotMode'];
  utbotBarsAgo: number;
  utbotLag: number;
  utbotEntry: number;
} {
  if (endIdx < 60) return { utbotMode: 'NONE', utbotBarsAgo: 99, utbotLag: 0, utbotEntry: 0 };

  // PRECISION mode: VWMA-55, ATR14, sensitivity 2.0
  const vwma55 = vwmaArr(candles, endIdx, 55);
  const atr14a  = atr14;                            // already computed
  const stopP   = utBotTrailingStop(vwma55, atr14a, endIdx, 2.0);
  const precSig = findLatestBuySignal(vwma55, stopP, candles, atr14a, endIdx);

  // EARLY mode: TEMA-10, ATR7, sensitivity 1.0
  const tema10 = temaArr(candles, endIdx, 10);
  const atr7   = atrArr(candles, endIdx, 7);
  const stopE  = utBotTrailingStop(tema10, atr7, endIdx, 1.0);
  const earlySig = findLatestBuySignal(tema10, stopE, candles, atr14a, endIdx);

  const precFired  = precSig.fired;
  const earlyFired = earlySig.fired;

  if (precFired && earlyFired) {
    // Use the fresher signal's bar for lag/entry — older entry prices are stale
    const bestBarsAgo = Math.min(precSig.barsAgo, earlySig.barsAgo);
    const fresher     = precSig.barsAgo <= earlySig.barsAgo ? precSig : earlySig;
    return { utbotMode: 'BOTH', utbotBarsAgo: bestBarsAgo, utbotLag: fresher.lag, utbotEntry: fresher.entry };
  }
  if (precFired)  return { utbotMode: 'PRECISION', utbotBarsAgo: precSig.barsAgo,  utbotLag: precSig.lag,  utbotEntry: precSig.entry };
  if (earlyFired) return { utbotMode: 'EARLY',     utbotBarsAgo: earlySig.barsAgo, utbotLag: earlySig.lag, utbotEntry: earlySig.entry };
  return { utbotMode: 'NONE', utbotBarsAgo: 99, utbotLag: 0, utbotEntry: 0 };
}

// ── Main Export ───────────────────────────────────────────────────────────────

export function computeAdvancedFeatures(candles: Candle[], endIdx: number, atr14: number): AdvancedFeatures {
  if (endIdx < 20 || candles.length < 21) {
    return {
      utbotMode: 'NONE', utbotBarsAgo: 99, utbotLag: 0, utbotEntry: 0,
      fer20: 0, ferTier: 'CHOPPY',
      cusumPos: 0, cusumNeg: 0, cusumSignal: false, cusumTier: 'IDLE',
      mwcScore: 0, roc5: 0, roc20: 0, roc60: 0, mwcTier: 'CONTRARIAN',
      tram: 0, cvar95: 0, tramTier: 'NEUTRAL',
      cleanMom: 0, roc20pct: 0, maxDD20: 0, cleanTier: 'NEUTRAL',
      regimeDays: 0, avgRunLen: 0, durationRatio: 0, durationTier: 'IDLE',
      volRegime: 'MID', vram: 0, vramTier: 'NEUTRAL',
      pic: 0, picTier: 'FAIR',
      advScore: 0, advGrade: 'D',
    };
  }

  // Build ATR array for UTBot (needs per-bar ATR, not just the scalar atr14)
  const atr14Arr = atrArr(candles, endIdx, 14);

  const { fer20, ferTier } = computeFER(candles, endIdx);
  const { cusumPos, cusumNeg, cusumSignal, cusumTier } = computeCUSUM(candles, endIdx, atr14);
  const { mwcScore, roc5, roc20, roc60, mwcTier } = computeMWC(candles, endIdx);
  const { tram, cvar95, tramTier } = computeTRAM(candles, endIdx);
  const { cleanMom, roc20pct, maxDD20, cleanTier } = computeCleanMom(candles, endIdx);
  const { regimeDays, avgRunLen, durationRatio, durationTier } = computeRegimeDuration(candles, endIdx, atr14);
  const { volRegime, vram, vramTier } = computeVRAM(candles, endIdx);
  const { pic, picTier } = computePIC(candles, endIdx);
  const { utbotMode, utbotBarsAgo, utbotLag, utbotEntry } = computeUTBot(candles, endIdx, atr14Arr);

  const partial = {
    utbotMode, utbotBarsAgo, utbotLag, utbotEntry,
    fer20, ferTier, cusumPos, cusumNeg, cusumSignal, cusumTier,
    mwcScore, roc5, roc20, roc60, mwcTier,
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
