// Market-context steps applied after analyzeStock, shared by the live screener (app/page.tsx) and
// the nightly batch (/api/batch-screener) so both produce the same stages for the same stock.
import { computeRSvsNifty, ensurePriceLevels, type AnalysisResult } from './stockEngine';
import type { Candle } from './compute';

const TIER_DOWN: Record<string, AnalysisResult['stage']> = {
  ULTRA_STRONG_BUY: 'STRONG_BUY', STRONG_BUY: 'BUY', BUY: 'PRE_BREAKOUT',
  PRE_BREAKOUT: 'EARLY_INFLECTION', EARLY_INFLECTION: 'COMPRESSION_WATCH',
  COMPRESSION_WATCH: 'NO_SIGNAL', NO_SIGNAL: 'NO_SIGNAL',
};

const hasNifty = (nifty: Candle[] | null | undefined): nifty is Candle[] => !!nifty && nifty.length > 20;

// Nifty 5-day regime: bull market boosts UC probability, bear dampens it.
export function niftyRegimeMultiplier(nifty: Candle[] | null | undefined): number {
  if (!nifty || nifty.length < 6) return 1.0;
  const n = nifty.length;
  const ret5d = (nifty[n - 1].c - nifty[n - 6].c) / nifty[n - 6].c * 100;
  return ret5d > 2 ? 1.10 : ret5d < -2 ? 0.85 : 1.0;
}

// RS vs Nifty (20d + 63d). Strong 63d RS lifts EARLY_INFLECTION to PRE_BREAKOUT (with real price
// levels); weak 63d RS demotes one tier.
export function applyRelativeStrength(result: AnalysisResult, candles: Candle[], nifty: Candle[] | null | undefined): void {
  if (!hasNifty(nifty)) return;
  const rs20 = computeRSvsNifty(candles, nifty, 20);
  const rs63 = nifty.length > 63 && candles.length > 63 ? computeRSvsNifty(candles, nifty, 63) : undefined;
  result.momentum = {
    ...result.momentum,
    rsNifty20: Number.isFinite(rs20) ? rs20 : 1.0,
    rsNifty63: rs63 !== undefined && Number.isFinite(rs63) ? rs63 : undefined,
  };
  if (rs63 === undefined || !Number.isFinite(rs63)) return;
  if (rs63 >= 1.15 && result.stage === 'EARLY_INFLECTION') {
    result.stage = 'PRE_BREAKOUT';
    result.stageSource = 'rs63';
    ensurePriceLevels(result, candles);
  } else if (rs63 < 0.75 && result.stage !== 'NO_SIGNAL') {
    result.stage = TIER_DOWN[result.stage];
  }
}

// Regime multiplier on ucScore, the RS gates and CC watch-only. Returns a reason when the stock is
// excluded by a gate (the screener drops it; the batch stores it as NO_SIGNAL), otherwise null.
export function applyPostScanRules(result: AnalysisResult, nifty: Candle[] | null | undefined, regimeMult: number): string | null {
  if (regimeMult !== 1.0 && result.ucScore != null) {
    result.ucScore = Math.min(100, Math.round(result.ucScore * regimeMult));
  }
  // RS gates (research_remaining.js, OOS 2023-26). Skipped without Nifty data: default rsNifty20=1.0
  // would suppress everything. EMA Stack rs>=1.0: PF 0.55->1.87, positive in train and test.
  if (hasNifty(nifty)) {
    const rs = result.momentum.rsNifty20;
    if (result.archetypeType === 'VolumeFootprint' && result.stage === 'PRE_BREAKOUT' && rs < 1.05) return 'vf_rs_below_1.05';
    if (result.archetypeType === 'EMAStack' && rs < 1.0) return 'ema_rs_below_1.0';
  }
  // CC Precision PRE_BREAKOUT has no OOS edge (504 signals, negative on 2025-26): watch-only.
  if (result.paramSetKey === 'optimized_highprecision_15plus' && result.archetypeType === 'CompressionCoil' && result.stage === 'PRE_BREAKOUT') {
    result.stage = 'EARLY_INFLECTION';
    (result as AnalysisResult & { ccWatchOnly?: boolean }).ccWatchOnly = true;
  }
  return null;
}
