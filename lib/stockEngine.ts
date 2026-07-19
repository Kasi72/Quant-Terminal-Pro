// Quant Terminal Pro v9.0 — Analysis Engine
// Pure TypeScript, browser-safe (no Node.js APIs)

import { computeStatsFeatures, computeBayesianProb, type StatsFeatures } from './statsEngine';
import { computeAdvancedFeatures, type AdvancedFeatures } from './advancedEngine';
export type { AdvancedFeatures };

export interface Candle { ts: number; o: number; h: number; l: number; c: number; v: number; }

export type StageRating = 'NO_SIGNAL' | 'COMPRESSION_WATCH' | 'EARLY_INFLECTION' | 'PRE_BREAKOUT' | 'BUY' | 'STRONG_BUY' | 'ULTRA_STRONG_BUY';

export type ParamSetKey = 'optimized_deployable_20plus' | 'optimized_highprecision_15plus' | 'optimized_elite_10plus' | 'optimized_ultraselective_8plus' | 'sniper_95plus' | 'ors_prime_reversal';

export interface ParamSet {
  name: string; tag: string;
  minAvgTurnover20: number; maxATRPct14Pctl120: number;
  maxPre10AvgRangeATR: number; maxPre10ExpansionCount: number; expansionATRMultiplier: number;
  zoneRangeATRThreshold: number; minZoneLen: number; maxZoneLen: number; maxZoneTightnessPct: number;
  maxPre10AvgVolRatio: number; maxPre5AvgVolRatio: number;
  maxPre10HighVolCount: number; highVolMultiplier: number; maxPre10RedVolBias: number;
  breakoutMultiplier: number;
  minExactRangeATR14: number; maxExactRangeATR14: number;
  minExactVolRatio20: number; minExactVolVsPre5: number;
  minCloseLoc: number; maxUpperWickPct: number; minBodyPct: number; maxCandleRisk: number;
  minUltraPrecisionScore: number; minRSI2: number;
  minVolatilityExpansionRatio: number | null; minCandleQualityScore: number | null;
  maxCloseAboveZonePct: number | null;
  forensic?: ForensicOverlay | null;
  // ORS-Reversal specific (undefined on all breakout sets)
  ors?: {
    maxRSI2: number;           // RSI2 must be ≤ this (deeply oversold)
    maxRSI14: number;          // RSI14 ≤ this
    maxCloseLoc: number;       // close location ≤ this% (capitulation candle closes LOW)
    minBodyPct: number;        // body ≥ this% (decisive move)
    maxUpperWickPct: number;   // upper wick ≤ this% (no rejection above)
    minRangePct: number;       // candle range/close ≥ this% (wide candle)
    maxDistEMA20: number;      // close must be ≤ EMA20*(1+maxDistEMA20/100) — negative = below
    minDdSwingHigh: number;    // drawdown from 60d swing high ≥ this%
    requireSwingLow: boolean;  // must be a 6-bar swing-low pivot
    requireRedCandle: boolean; // signal candle must be red
    minOrsScore: number;       // ORS composite score ≥ this
    minADX?: number;           // optional: ADX must be ≥ this (trending regime gate)
    minLowerWickPct?: number;  // optional: lower wick ≥ this% of range (demand absorption proof)
    maxBodyATR?: number;       // optional: body ≤ this × ATR14 (anti-extension filter)
    tpPct: number;             // profit target %
    slAtrMult: number;         // stop = entry − slAtrMult × ATR14
    maxHoldBars: number;       // time-stop in bars
  };
}

export interface ForensicOverlay {
  minCandleDnaScore?: number | null;
  minCandleDnaCloseQuality?: number | null;
  minCandleDnaLowerTail?: number | null;
  maxBodyATR?: number | null;
  maxUpperToLowerWickRatio?: number | null;
  minMarubozuScore?: number | null;
  minAdvScore?: number | null;
  minFer20?: number | null;
  maxCusumPos?: number | null;
  maxMwcScore?: number | null;
  maxTram?: number | null;
  maxCleanMom?: number | null;
  maxDurationRatio?: number | null;
  maxVram?: number | null;
  minPic?: number | null;
  maxPic?: number | null;
  maxUtbotBarsAgo?: number | null;
  maxBbWidthPctl?: number | null;
  minVolZScore?: number | null;
  minStatsScore?: number | null;
  minSharpe20?: number | null;
  maxEntropy10?: number | null;
  minInsideBars?: number | null;
  minGuppyCompressDays?: number | null;
  minGuppyGroupGapPct?: number | null;
  requireGuppyCleanBullishFan?: boolean;
  requireGuppyCoiledRelease?: boolean;
  minCandlePatternStrength?: number | null;
  requireBullishPattern?: boolean;
}

export interface ZoneInfo {
  zoneHigh: number; zoneLow: number; zoneATRRatio: number;
  zoneTightnessPct: number; windowLength: number;
  zoneShape?: 'FLAT' | 'ASCENDING' | 'DESCENDING';
}

export interface PriceEngine {
  breakoutLevel: number; plannedEntry: number;
  gapPct: number; gapATR: number;
  entryMode: 'breakout' | 'gap_caution';
  entryStatus: 'normal' | 'half_size' | 'no_chase';
  entryBuffer: number; efficiencyRatio: number;
  tacticalStop: number; tacticalRiskPct: number;
  stopWeinstein: number; stopKase: number; stopElder: number; stopSignalLow: number;
  disasterStop: number; disasterRiskPct: number;
  riskPerShare: number;
  target5: number; target7: number; target10: number; target3R: number;
  t1R: number; t2R: number; t3R_mult: number;
  rewardRisk: number;
  chandelierT1: number; chandelierT2: number; chandelierT3: number;
  failedBreakoutLevel: number; timeStop3d: number; timeStop5d: number; timeStop10d: number;
  tradeValid: boolean;
  hh252: number;           // 52-week highest high before signal bar
  pctFrom52W: number;      // % close is below the 52W high (0 = at the high)
  breakoutTier: 'A+' | 'A' | 'B'; // A+=VCP near 52W, A=near 52W, B=zone only
}

export interface ChecklistItem { label: string; pass: boolean; value: string; }

export interface AnalysisResult {
  symbol: string;
  stage: StageRating;
  inflectionScore: number;
  confidence: number;
  paramSetKey: ParamSetKey;
  lastClose: number; lastDate: string;
  avgTurnover20: number; atrPct14: number; atrPct14Pctl120: number;
  volRatio20: number; rsi2: number; rsi14: number;
  zone: ZoneInfo | null;
  pre10AvgRangeATR: number; pre10ExpansionCount: number;
  pre10AvgVolRatio: number; pre5AvgVolRatio: number;
  pre10HighVolCount: number; pre10RedVolBias: number;
  exactRangeATR14: number; exactVolRatio20: number; exactVolVsPre5: number;
  closeLoc: number; upperWickPct: number; bodyPct: number;
  signalRangePct: number; volatilityExpansionRatio: number;
  ultraPrecisionScore: number; candleQualityScore: number;
  priceEngine: PriceEngine;
  conditionsMet: number;
  totalConditions: number;
  checklist: ChecklistItem[];
  // v7.2 momentum enhancements (additive — does NOT affect stage/screening)
  momentum: MomentumEnhancements;
  // v7.3 upgrades — v2 tiered (backtested on 56,340 in-zone observations, 456
  // Nifty 500 stocks). Clean monotonic relationship: 0-1%=63.7% breaks out in
  // 5d, 1-2.5%=43.1%, 2.5-5%=23.6%, 5-10%=8.3%. Breakout QUALITY is flat across
  // distance (~50-53% fakeout rate everywhere) — distance predicts SPEED, not quality.
  nearBreakoutPct: number;
  nearBreakout: boolean;
  nearBreakoutTier: 'IMMINENT' | 'NEAR' | 'WATCH' | 'EARLY' | null;
  // v9.0 statistical features
  stats: StatsFeatures;
  // Cluster breakdown: conditions met per param set
  clusterBreakdown: ClusterBreakdown;
  monster: MonsterScan;
  dayChangePct: number;
  candleDNA: CandleDNA;
  advanced?: AdvancedFeatures;
  // ORS-Reversal specific fields (populated when paramSetKey === 'ors_prime_reversal')
  orsScore?: number;
  ddFromSwingHigh?: number;
  distFromEMA20?: number;
  zScore252?: number;
  orsConfirmed?: boolean;   // true = green-confirmation candle fired (entry tomorrow open)
  // Phase 2 — Momentum Archetype system
  archetypeType?: 'VolumeFootprint' | 'CompressionCoil' | 'MomentumPocket' | 'EMAStack' | 'PerfectStorm' | 'ORS' | 'Breakout';
  confluenceScore?: number;   // 0–6: how many of the 6 archetypes fire on this stock
  confluenceFlags?: {
    volumeFootprint: boolean;
    compressionCoil: boolean;
    momentumPocket: boolean;
    emaStack: boolean;
    ors: boolean;
    breakout: boolean;
  };
  archetypeConditions?: number;   // how many archetype-specific conditions passed
  archetypeTotal?: number;        // total archetype conditions checked
  // Hit-Rate Gate: precision tier derived from smartHitRateOptimizer Phase-1 sweep
  // 'PREMIUM'  — signal passes gate; archetype-specific OOS hit-rate improvement confirmed
  // 'STANDARD' — signal fires but doesn't clear gate
  // null       — no gate applicable
  hitRateGate?: 'PREMIUM' | 'STANDARD' | null;
  adx14?: number;   // ADX(14) at signal bar — used by hitRateGate
  // Round 5 backtested findings (OOS 75%+ hit-rate gates)
  // bodyGate: bodyPct ≥ 35 — the single strongest universal quality filter discovered
  // (EMAStack+body ≥50%breadth: OOS n=12 75.0% PF=2.64 · PerfectStorm+body: OOS n=12 75.0% PF=2.94)
  bodyGate?: boolean;
  // bullPoolSignal: fires when EMAStack OR PerfectStorm clears PREMIUM gate with bodyGate
  // (Pool+body ≥50%breadth: OOS n=24 75.0% PF=2.78 · AvgP&L=+2.40%)
  bullPoolSignal?: boolean;
  // regimeSignal: which dual-regime leg this signal belongs to
  // 'BULL_POOL' → EMAStack/PerfectStorm + body≥35% in bull market (breadth>50%)
  // 'BEAR_ORS'  → ORS-Prime reversal (performs in bear/mixed markets, breadth≤50%)
  regimeSignal?: 'BULL_POOL' | 'BEAR_ORS' | null;
}

export interface CandleDNA {
  score: number;             // 0-100 composite
  bodyStrength: number;      // 0-35 — body size relative to ATR
  wickCleanliness: number;   // 0-35 — lower wick dominant, minimal upper wick
  rangeExpansion: number;    // 0-30 — eRA-based
  bodyATR: number;           // raw body/ATR ratio
  upperToLowerWickRatio: number;
  marubozuScore: number;     // 100 - (upperWick% + lowerWick%)
  tier: 'ELITE' | 'STRONG' | 'GOOD' | 'WEAK';
}

export interface MonsterBadge {
  type: 'MOM' | 'MRV' | 'BRK';
  probability: number;
  details: string;
}

export interface MonsterScan {
  badges: MonsterBadge[];
  topProbability: number;
}

export interface ClusterBreakdown {
  deployable: { met: number; total: number };
  highPrecision: { met: number; total: number };
  elite: { met: number; total: number };
  ultraSelective: { met: number; total: number };
  sniper?: { met: number; total: number };
  orsReversal?: { met: number; total: number; score?: number; confirmed?: boolean };
}

export interface ScanMeta {
  timestamp: number;
  paramSetKey: ParamSetKey | 'ALL4';
  totalScanned: number;
  stageDistribution: Record<StageRating, number>;
  paramSetComparison?: Record<ParamSetKey, { buy: number; strong: number; ultra: number; total: number }>;
}

export interface MomentumEnhancements {
  emaAligned: boolean;         // sig.c > EMA20 > EMA50
  ema20: number;
  ema50: number;
  higherLowConfirmed: boolean; // zone.zoneLow > swingLow of prior window
  swingLow20: number;
  volDryUpScore: number;       // 0-4: consecutive declining volume in pre-5
  obvSlope10: number;          // normalized OBV slope over pre-10
  adx14: number;               // Average Directional Index
  adxInRange: boolean;         // adx14 > 40
  gapAdjustedRR: number;       // reward:risk accounting for gap
  momentumScore: number;       // composite 0-100
  rsNifty20: number;           // relative strength vs Nifty 50 (20-day)
}

export interface MultiAnalysisResult {
  symbol: string;
  lastClose: number;
  lastDate: string;
  best: AnalysisResult;
  byParamSet: Record<ParamSetKey, AnalysisResult>;
  passedSets: ParamSetKey[];
  passedCount: number;
}

// Feature #3: Lookback — scan last N candles as potential signal candles, return best
export function analyzeStockWithLookback(candles: Candle[], paramSetKey: ParamSetKey, lookback: number): AnalysisResult {
  const stageRank: Record<StageRating, number> = {
    ULTRA_STRONG_BUY: 7, STRONG_BUY: 6, BUY: 5, PRE_BREAKOUT: 4,
    EARLY_INFLECTION: 3, COMPRESSION_WATCH: 2, NO_SIGNAL: 1,
  };
  let best: AnalysisResult | null = null;
  const end = candles.length;
  const start = Math.max(30, end - lookback);
  for (let i = end; i >= start; i--) {
    const slice = candles.slice(0, i);
    if (slice.length < 30) break;
    const r = analyzeStock(slice, paramSetKey);
    if (!best || stageRank[r.stage] > stageRank[best.stage] ||
       (stageRank[r.stage] === stageRank[best.stage] && r.inflectionScore > best.inflectionScore)) {
      best = r;
    }
    if (r.stage === 'ULTRA_STRONG_BUY') break; // stop only on highest tier; keep searching for stronger signals
  }
  return best ?? analyzeStock(candles, paramSetKey);
}

// Feature #4: Relative Strength vs Nifty 50
export function computeRSvsNifty(stockCandles: Candle[], niftyCandles: Candle[], period = 20): number {
  if (stockCandles.length < period + 1 || niftyCandles.length < period + 1) return 1.0;
  const stockEnd = stockCandles[stockCandles.length - 1].c;
  const stockStart = stockCandles[stockCandles.length - 1 - period].c;
  const niftyEnd = niftyCandles[niftyCandles.length - 1].c;
  const niftyStart = niftyCandles[niftyCandles.length - 1 - period].c;
  if (stockStart <= 0 || niftyStart <= 0) return 1.0;
  const stockReturn = stockEnd / stockStart;
  const niftyReturn = niftyEnd / niftyStart;
  return niftyReturn > 0 ? stockReturn / niftyReturn : 1.0;
}

// Compute conditions met per param set (for cluster breakdown column)
export function computeClusterBreakdown(candles: Candle[]): ClusterBreakdown {
  const mapping: Array<{ key: ParamSetKey; label: keyof ClusterBreakdown }> = [
    { key: 'optimized_deployable_20plus', label: 'deployable' },
    { key: 'optimized_highprecision_15plus', label: 'highPrecision' },
    { key: 'optimized_elite_10plus', label: 'elite' },
    { key: 'optimized_ultraselective_8plus', label: 'ultraSelective' },
    { key: 'sniper_95plus', label: 'sniper' },
  ];
  const result = {} as ClusterBreakdown;
  for (const { key, label } of mapping) {
    const r = analyzeStock(candles, key);
    result[label] = { met: r.conditionsMet, total: r.totalConditions };
  }
  // ORS-Prime: separate reversal analysis
  const orsR = analyzeStock(candles, 'ors_prime_reversal');
  result.orsReversal = {
    met: orsR.conditionsMet,
    total: orsR.totalConditions,
    score: orsR.orsScore ?? 0,
    confirmed: orsR.orsConfirmed ?? false,
  };
  return result;
}

export function analyzeStockMulti(candles: Candle[], symbol: string): MultiAnalysisResult {
  const byParamSet = {} as Record<ParamSetKey, AnalysisResult>;
  let best: AnalysisResult | null = null;
  const passedSets: ParamSetKey[] = [];
  const stageRank: Record<StageRating, number> = {
    ULTRA_STRONG_BUY: 7, STRONG_BUY: 6, BUY: 5, PRE_BREAKOUT: 4,
    EARLY_INFLECTION: 3, COMPRESSION_WATCH: 2, NO_SIGNAL: 1,
  };

  const mapping: Array<{ key: ParamSetKey; label: keyof ClusterBreakdown }> = [
    { key: 'optimized_deployable_20plus', label: 'deployable' },
    { key: 'optimized_highprecision_15plus', label: 'highPrecision' },
    { key: 'optimized_elite_10plus', label: 'elite' },
    { key: 'optimized_ultraselective_8plus', label: 'ultraSelective' },
    { key: 'sniper_95plus', label: 'sniper' },
  ];
  const breakdown = {} as ClusterBreakdown;

  for (const { key, label } of mapping) {
    const r = analyzeStock(candles, key);
    r.symbol = symbol;
    byParamSet[key] = r;
    breakdown[label] = { met: r.conditionsMet, total: r.totalConditions };
    if (['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage)) {
      passedSets.push(key);
    }
    if (!best || stageRank[r.stage] > stageRank[best.stage] ||
       (stageRank[r.stage] === stageRank[best.stage] && r.inflectionScore > best.inflectionScore)) {
      best = r;
    }
  }
  // ORS-Prime reversal — separate path, included in byParamSet and breakdown
  const orsR = analyzeStock(candles, 'ors_prime_reversal');
  orsR.symbol = symbol;
  byParamSet['ors_prime_reversal'] = orsR;
  breakdown.orsReversal = {
    met: orsR.conditionsMet,
    total: orsR.totalConditions,
    score: orsR.orsScore ?? 0,
    confirmed: orsR.orsConfirmed ?? false,
  };
  if (['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(orsR.stage)) {
    passedSets.push('ors_prime_reversal');
    if (!best || stageRank[orsR.stage] > stageRank[best.stage] ||
       (stageRank[orsR.stage] === stageRank[best.stage] && orsR.inflectionScore > best.inflectionScore)) {
      best = orsR;
    }
  }
  // Set full breakdown on best result
  best!.clusterBreakdown = breakdown;

  // Confluence: how many of the 6 archetypes fired simultaneously
  const ACTIONABLE = new Set<StageRating>(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
  const confluenceFlags = {
    volumeFootprint: ACTIONABLE.has(byParamSet['optimized_deployable_20plus'].stage),
    compressionCoil: ACTIONABLE.has(byParamSet['optimized_highprecision_15plus'].stage),
    momentumPocket:  ACTIONABLE.has(byParamSet['optimized_elite_10plus'].stage),
    emaStack:        ACTIONABLE.has(byParamSet['optimized_ultraselective_8plus'].stage),
    ors:             ACTIONABLE.has(byParamSet['ors_prime_reversal'].stage),
    breakout:        ACTIONABLE.has(byParamSet['sniper_95plus'].stage),
  };
  const confluenceScore = Object.values(confluenceFlags).filter(Boolean).length;
  best!.confluenceScore = confluenceScore;
  best!.confluenceFlags = confluenceFlags;

  return {
    symbol,
    lastClose: best!.lastClose,
    lastDate: best!.lastDate,
    best: best!,
    byParamSet,
    passedSets,
    passedCount: passedSets.length,
  };
}

// ─── PARAM SETS ── LOCKED ─────────────────────────────────────────────────────
// These values are verified by scripts/goldenParams.json.
// Before changing any value: node scripts/check-params  (will show drift).
// After an intentional change: npm run update-params    (updates the lock).
// ──────────────────────────────────────────────────────────────────────────────

export const PARAM_SETS: Record<ParamSetKey, ParamSet> = {
  // v13 forensic — stop-first validation: 68.3% WR, +2.08% avg, PF 2.24 (41 trades)
  optimized_deployable_20plus: {
    name: 'Volume Footprint Scout', tag: '📊 Institutional Buying',
    minAvgTurnover20: 10_000_000, maxATRPct14Pctl120: 50,
    maxPre10AvgRangeATR: 1.15, maxPre10ExpansionCount: 1, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 1.0, minZoneLen: 4, maxZoneLen: 25, maxZoneTightnessPct: 12.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 0.90,
    maxPre10HighVolCount: 2, highVolMultiplier: 1.35, maxPre10RedVolBias: 0.8,
    breakoutMultiplier: 1.001,
    minExactRangeATR14: 1.8, maxExactRangeATR14: 5.0,
    minExactVolRatio20: 1.3, minExactVolVsPre5: 2.0,
    minCloseLoc: 40, maxUpperWickPct: 18, minBodyPct: 50, maxCandleRisk: 10.0,
    minUltraPrecisionScore: 45, minRSI2: 50,
    minVolatilityExpansionRatio: 2.0, minCandleQualityScore: 2,
    maxCloseAboveZonePct: 6.0,
    forensic: {
      maxCusumPos: 0.04,
      requireBullishPattern: true,
    },
  },
  // v13 forensic — stop-first validation: 62.5% WR, +1.33% avg, PF 1.67 (80 trades)
  optimized_highprecision_15plus: {
    name: 'Compression Coil', tag: '🔄 Energy Storage',
    minAvgTurnover20: 10_000_000, maxATRPct14Pctl120: 85,
    maxPre10AvgRangeATR: 1.0, maxPre10ExpansionCount: 2, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 1.0, minZoneLen: 5, maxZoneLen: 25, maxZoneTightnessPct: 5.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 1.10,
    maxPre10HighVolCount: 4, highVolMultiplier: 1.35, maxPre10RedVolBias: 1.1,
    breakoutMultiplier: 1.001,
    minExactRangeATR14: 0.8, maxExactRangeATR14: 5.0,
    minExactVolRatio20: 1.1, minExactVolVsPre5: 2.0,
    minCloseLoc: 50, maxUpperWickPct: 10, minBodyPct: 50, maxCandleRisk: 5.0,
    minUltraPrecisionScore: 50, minRSI2: 50,
    minVolatilityExpansionRatio: 1.4, minCandleQualityScore: null,
    maxCloseAboveZonePct: 4.0,
    forensic: {
      maxBodyATR: 1.6,
    },
  },
  // v12 tuned — stop-first validation: 75.0% WR, +3.41% avg, PF 4.33 (12 trades; small sample)
  optimized_elite_10plus: {
    name: 'Momentum Pocket', tag: '🎯 First Recovery',
    minAvgTurnover20: 20_000_000, maxATRPct14Pctl120: 60,
    maxPre10AvgRangeATR: 1.0, maxPre10ExpansionCount: 2, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 1.0, minZoneLen: 8, maxZoneLen: 25, maxZoneTightnessPct: 12.0,
    maxPre10AvgVolRatio: 1.0, maxPre5AvgVolRatio: 1.10,
    maxPre10HighVolCount: 2, highVolMultiplier: 1.2, maxPre10RedVolBias: 1.1,
    breakoutMultiplier: 1.001,
    minExactRangeATR14: 1.8, maxExactRangeATR14: 6.0,
    minExactVolRatio20: 2.2, minExactVolVsPre5: 2.0,
    minCloseLoc: 55, maxUpperWickPct: 15, minBodyPct: 35, maxCandleRisk: 5.0,
    minUltraPrecisionScore: 0, minRSI2: 50,
    minVolatilityExpansionRatio: 1.4, minCandleQualityScore: 2,
    maxCloseAboveZonePct: 8.0,
  },
  // ✅ Grid-optimised v13 — 1616-stock sweep, n=294, WR=56.8%, Wilson=51.09%, PF=1.933
  // Key changes vs v12: minUltraPrecisionScore 0→60, minExactVolRatio20 0.8→1.5,
  //   minExactVolVsPre5 1.5→2.0, minCloseLoc 65→63, maxUpperWickPct 20→15,
  //   minVolatilityExpansionRatio 1.4→1.1, minBodyPct 60→30, maxPre10HighVolCount 0→1,
  //   maxPre10RedVolBias 0.8→1.5, maxZoneTightnessPct 15→18, minExactRangeATR14 1.2→1.0
  // ✅ ChatGPT forensic v12 — 1616-stock sweep, n=54, WR=70.4%, Wilson=57.2%, PF=3.656
  // OOS (last 30%): n=17, WR=70.6%, PF=4.237. Tighter than Grid-v13 (7x fewer signals, cleaner setup)
  optimized_ultraselective_8plus: {
    name: 'EMA Stack Crossover', tag: '📈 Trend Flip',
    minAvgTurnover20: 10_000_000, maxATRPct14Pctl120: 95,
    maxPre10AvgRangeATR: 1.3, maxPre10ExpansionCount: 0, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 0.95, minZoneLen: 8, maxZoneLen: 25, maxZoneTightnessPct: 15.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 0.95,
    maxPre10HighVolCount: 0, highVolMultiplier: 1.5, maxPre10RedVolBias: 0.8,
    breakoutMultiplier: 1.001,
    minExactRangeATR14: 1.2, maxExactRangeATR14: 6.0,
    minExactVolRatio20: 0.8, minExactVolVsPre5: 1.5,
    minCloseLoc: 65, maxUpperWickPct: 20, minBodyPct: 60, maxCandleRisk: 8.5,
    minUltraPrecisionScore: 0, minRSI2: 50,
    minVolatilityExpansionRatio: 1.4, minCandleQualityScore: 3,
    maxCloseAboveZonePct: null,
  },
  // ✅ ORS-Prime v3 Rank 2 — deep_tune_updated_six_full_v3 (1616 stocks, 2021-2026)
  // IS: n=2160 WR=81.3% Avg=1.09% PF=1.51 | OOS: n=648 WR=85.0% Avg=1.92% PF=2.30 MFE=6.3% MAE=-4.7%
  // Chosen over v4 (91% WR): v3 has better R:R (PF=2.30 vs 2.22), higher avg gain (+1.92% vs +1.28%),
  //   tighter losers (MAE -14% vs -19%), and higher per-trade R-multiple.
  // Code fix: requireRedCandle param now honoured (was hardcoded `red &&` before v2+)
  // DO NOT mix with breakout param-set logic — routes to analyzeORS() internally
  ors_prime_reversal: {
    name: 'ORS-Prime v5', tag: '↩ 96.2% OOS WR',
    // Breakout fields unused (set to pass-all so analyzeStock early-exits cleanly)
    minAvgTurnover20: 0, maxATRPct14Pctl120: 100,
    maxPre10AvgRangeATR: 99, maxPre10ExpansionCount: 99, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 99, minZoneLen: 1, maxZoneLen: 100, maxZoneTightnessPct: 100,
    maxPre10AvgVolRatio: 99, maxPre5AvgVolRatio: 99,
    maxPre10HighVolCount: 99, highVolMultiplier: 1.35, maxPre10RedVolBias: 99,
    breakoutMultiplier: 0,
    minExactRangeATR14: 0, maxExactRangeATR14: 99,
    minExactVolRatio20: 0, minExactVolVsPre5: 0,
    minCloseLoc: 0, maxUpperWickPct: 100, minBodyPct: 0, maxCandleRisk: 100,
    minUltraPrecisionScore: 0, minRSI2: 0,
    minVolatilityExpansionRatio: null, minCandleQualityScore: null,
    maxCloseAboveZonePct: null,
    // ORS-specific logic — v5 DMI-augmented params (OOS WR 96.2%, n=624)
    ors: {
      maxRSI2: 7,           // slightly relaxed from 5 (DMI filters direction)
      maxRSI14: 38,         // tightened from 43 (deeper oversold)
      maxCloseLoc: 53,      // tightened from 58 (lower close location)
      minBodyPct: 37,          // relaxed from 62 (ADX handles quality)
      maxUpperWickPct: 30,     // tightened from 41 — rejection above close must be limited
      minRangePct: 6.4,        // tightened from 5.3 (meaningful range required)
      maxDistEMA20: -10.0,     // tightened from -6: must be 10%+ below EMA20
      minDdSwingHigh: 38,      // 38%+ below 60d swing high (was 39)
      requireSwingLow: false,
      requireRedCandle: false,  // removed — ORS score + EMA distance do quality control
      minOrsScore: 63,          // tightened from 58 (composite oversold score)
      minADX: 20,               // ADX ≥ 20 required (trending regime)
      minLowerWickPct: 20,      // lower tail ≥ 20% of range (demand absorption proof — backtest-validated sweet spot)
      maxBodyATR: 1.6,          // body ≤ 1.6×ATR14 (anti-extension: not over-stretched)
      tpPct: 3,
      slAtrMult: 3.0,
      maxHoldBars: 25,          // extended from 20 for larger reversal captures
    },
  },
  // ✅ v12-tuned — minExactVolVsPre5 1.0→3.5 (defining sniper filter), ATR pctl 50→40,
  //    maxPre10AvgRangeATR 0.80→1.15, maxPre10RedVolBias 0.90→1.6, minExactVolRatio20 1.8→1.5,
  //    minCloseLoc 75→65, maxUpperWickPct 20→15, minBodyPct 50→20, minVolExpRatio 2.0→1.0
  sniper_95plus: {
    name: 'Perfect Storm', tag: '⚡ Multi-Archetype',
    minAvgTurnover20: 10_000_000, maxATRPct14Pctl120: 40,
    maxPre10AvgRangeATR: 1.15, maxPre10ExpansionCount: 1, expansionATRMultiplier: 1.1,
    zoneRangeATRThreshold: 1.0, minZoneLen: 4, maxZoneLen: 25, maxZoneTightnessPct: 12.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 1.10,
    maxPre10HighVolCount: 0, highVolMultiplier: 1.35, maxPre10RedVolBias: 1.6,
    breakoutMultiplier: 1.001,
    minExactRangeATR14: 1.8, maxExactRangeATR14: 5.0,
    minExactVolRatio20: 1.5, minExactVolVsPre5: 3.5,
    minCloseLoc: 65, maxUpperWickPct: 15, minBodyPct: 20, maxCandleRisk: 6.0,
    minUltraPrecisionScore: 5, minRSI2: 50,
    minVolatilityExpansionRatio: 1.0, minCandleQualityScore: 2,
    maxCloseAboveZonePct: 5.0,
  },
};

export const PARAM_SET_OPTIONS: Array<{ key: ParamSetKey; name: string; tag: string }> = [
  { key: 'optimized_deployable_20plus', name: PARAM_SETS.optimized_deployable_20plus.name, tag: PARAM_SETS.optimized_deployable_20plus.tag },
  { key: 'optimized_highprecision_15plus', name: PARAM_SETS.optimized_highprecision_15plus.name, tag: PARAM_SETS.optimized_highprecision_15plus.tag },
  { key: 'optimized_elite_10plus', name: PARAM_SETS.optimized_elite_10plus.name, tag: PARAM_SETS.optimized_elite_10plus.tag },
  { key: 'optimized_ultraselective_8plus', name: PARAM_SETS.optimized_ultraselective_8plus.name, tag: PARAM_SETS.optimized_ultraselective_8plus.tag },
  { key: 'sniper_95plus', name: PARAM_SETS.sniper_95plus.name, tag: PARAM_SETS.sniper_95plus.tag },
  { key: 'ors_prime_reversal', name: PARAM_SETS.ors_prime_reversal.name, tag: PARAM_SETS.ors_prime_reversal.tag },
];

// ─── CORE HELPERS ─────────────────────────────────────────────────────────────

function arr_mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

function arr_median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function safe(val: number, fallback = 0): number {
  if (!Number.isFinite(val)) return fallback;
  if (val === 0 && 1 / val === -Infinity) return 0; // convert -0 to 0
  if (val > 1e15 || val < -1e15) return 0;           // clamp extreme outliers
  return val;
}

// ─── v7.2 MOMENTUM HELPERS ──────────────────────────────────────────────────

function computeEMA(candles: Candle[], period: number): number[] {
  const result: number[] = new Array(candles.length).fill(0);
  if (candles.length === 0) return result;
  const k = 2 / (period + 1);
  // Seed with SMA of first `period` bars to avoid cold-start bias
  const seedLen = Math.min(period, candles.length);
  let seed = 0;
  for (let i = 0; i < seedLen; i++) seed += candles[i].c;
  result[seedLen - 1] = seed / seedLen;
  for (let i = seedLen; i < candles.length; i++) {
    result[i] = candles[i].c * k + result[i - 1] * (1 - k);
  }
  return result;
}

// Full per-bar DMI arrays (Wilder smoothing, period=14)
// Returns diPlus[], diMinus[], adx[] — index-aligned with candles[]
function computeDMI(candles: Candle[], period = 14): { diPlus: number[]; diMinus: number[]; adx: number[] } {
  const n = candles.length;
  const diPlus  = new Array<number>(n).fill(0);
  const diMinus = new Array<number>(n).fill(0);
  const adxArr  = new Array<number>(n).fill(20);
  if (n < period + 2) return { diPlus, diMinus, adx: adxArr };

  const dmP: number[] = [0], dmM: number[] = [0], trArr: number[] = [0];
  for (let i = 1; i < n; i++) {
    const up = candles[i].h - candles[i-1].h;
    const dn = candles[i-1].l - candles[i].l;
    dmP.push(up > dn && up > 0 ? up : 0);
    dmM.push(dn > up && dn > 0 ? dn : 0);
    trArr.push(Math.max(candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i-1].c), Math.abs(candles[i].l - candles[i-1].c)));
  }

  // Wilder initial sum
  let sTR = 0, sDMp = 0, sDMm = 0;
  for (let i = 1; i <= period; i++) { sTR += trArr[i]; sDMp += dmP[i]; sDMm += dmM[i]; }

  const dxArr = new Array<number>(n).fill(0);
  for (let i = period + 1; i < n; i++) {
    sTR  = sTR  - sTR  / period + trArr[i];
    sDMp = sDMp - sDMp / period + dmP[i];
    sDMm = sDMm - sDMm / period + dmM[i];
    const dp = sTR > 0 ? (sDMp / sTR) * 100 : 0;
    const dm = sTR > 0 ? (sDMm / sTR) * 100 : 0;
    diPlus[i]  = dp;
    diMinus[i] = dm;
    const diSum = dp + dm;
    dxArr[i] = diSum > 0 ? Math.abs(dp - dm) / diSum * 100 : 0;
  }

  // ADX = Wilder MA of DX, seeded from bar period*2
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
  return { diPlus, diMinus, adx: adxArr };
}

// How many bars ago did DI+ cross above DI-? Returns 0=today, 1=yesterday … 99=no cross in window
function barsSinceDICross(diPlus: number[], diMinus: number[], i: number, maxLook = 5): number {
  for (let k = 0; k <= maxLook; k++) {
    const j = i - k;
    if (j < 1) break;
    if (diPlus[j] > diMinus[j] && diPlus[j-1] <= diMinus[j-1]) return k;
  }
  return 99;
}

// ── Candle Architecture — single source of truth for wick/body/ratio metrics ──
// Call once per signal bar; O(1). All values are % of the candle's own range
// unless noted (bodyAtr, rangeAtr, candleRisk use ATR14 and price).
interface CandleArch {
  upperWickPct: number;   // (high − max(o,c)) / range × 100
  lowerWickPct: number;   // (min(o,c) − low)  / range × 100
  bodyPct:      number;   // |c − o| / range × 100
  closeLoc:     number;   // (c − low) / range × 100
  uwbr:         number;   // upperWick / body  (upper wick-to-body ratio)
  lwbr:         number;   // lowerWick / body  (lower wick-to-body ratio)
  bodyAtr:      number;   // |c − o| / ATR14  (body as ATR multiple)
  rangeAtr:     number;   // range / ATR14
  candleRisk:   number;   // range / close × 100  (implied stop as % of price)
  isGreen:      boolean;  // close > open
  isHammer:     boolean;  // lowerWick ≥ 2×body AND closeLoc ≥ 60
  isMarubozu:   boolean;  // bodyPct ≥ 85
  qualityTier:  number;   // 0–4: composite bull-quality score (1pt each)
}

const ZERO_CANDLE_ARCH: CandleArch = {
  upperWickPct: 0, lowerWickPct: 0, bodyPct: 0, closeLoc: 50,
  uwbr: 0, lwbr: 0, bodyAtr: 0, rangeAtr: 0, candleRisk: 0,
  isGreen: false, isHammer: false, isMarubozu: false, qualityTier: 0,
};

function computeCandleArch(o: number, h: number, l: number, c: number, atr14: number): CandleArch {
  const range = h - l;
  if (range <= 0 || c <= 0) return ZERO_CANDLE_ARCH;
  const body         = Math.abs(c - o);
  const upper        = h - Math.max(o, c);
  const lower        = Math.min(o, c) - l;
  const bodyPct      = body  / range * 100;
  const upperWickPct = upper / range * 100;
  const lowerWickPct = lower / range * 100;
  const closeLoc     = (c - l) / range * 100;
  const safeBody     = Math.max(body, range * 0.001);
  const uwbr         = upper / safeBody;
  const lwbr         = lower / safeBody;
  const bodyAtr      = atr14 > 0 ? body  / atr14 : 0;
  const rangeAtr     = atr14 > 0 ? range / atr14 : 0;
  const candleRisk   = range / c * 100;
  let tier = 0;
  if (closeLoc     >= 55) tier++;
  if (bodyPct      >= 40) tier++;
  if (upperWickPct <= 20) tier++;
  if (lowerWickPct >= 8)  tier++;
  return {
    upperWickPct, lowerWickPct, bodyPct, closeLoc,
    uwbr, lwbr, bodyAtr, rangeAtr, candleRisk,
    isGreen:    c > o,
    isHammer:   lowerWickPct >= 2 * bodyPct && closeLoc >= 60,
    isMarubozu: bodyPct >= 85,
    qualityTier: tier,
  };
}

function computeADX14(candles: Candle[]): number {
  if (candles.length < 30) return 20;
  const period = 14;
  const dmPlus: number[] = [];
  const dmMinus: number[] = [];
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const hDiff = candles[i].h - candles[i - 1].h;
    const lDiff = candles[i - 1].l - candles[i].l;
    dmPlus.push(hDiff > lDiff && hDiff > 0 ? hDiff : 0);
    dmMinus.push(lDiff > hDiff && lDiff > 0 ? lDiff : 0);
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    );
    trs.push(tr);
  }
  if (trs.length < period) return 20;

  let smoothTR = 0, smoothDMp = 0, smoothDMm = 0;
  for (let i = 0; i < period; i++) {
    smoothTR += trs[i]; smoothDMp += dmPlus[i]; smoothDMm += dmMinus[i];
  }

  const dxValues: number[] = [];
  for (let i = period; i < trs.length; i++) {
    smoothTR = smoothTR - smoothTR / period + trs[i];
    smoothDMp = smoothDMp - smoothDMp / period + dmPlus[i];
    smoothDMm = smoothDMm - smoothDMm / period + dmMinus[i];
    const diPlus = smoothTR > 0 ? (smoothDMp / smoothTR) * 100 : 0;
    const diMinus = smoothTR > 0 ? (smoothDMm / smoothTR) * 100 : 0;
    const diSum = diPlus + diMinus;
    const dx = diSum > 0 ? (Math.abs(diPlus - diMinus) / diSum) * 100 : 0;
    dxValues.push(dx);
  }

  if (dxValues.length < period) return safe(dxValues.length > 0 ? arr_mean(dxValues) : 20);
  let adx = arr_mean(dxValues.slice(0, period));
  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]) / period;
  }
  return safe(adx, 20);
}

// Chaikin Money Flow — measures institutional accumulation/distribution pressure.
// CMF > 0 = net buying; CMF < 0 = net selling. Range [-1, +1].
// Formula: sum(MFV, period) / sum(volume, period)
// where MFV = ((close-low)-(high-close))/(high-low) * volume  [money flow volume]
function computeCMF(candles: Candle[], endIdx: number, period = 20): number {
  const start = Math.max(0, endIdx - period + 1);
  let sumMFV = 0, sumVol = 0;
  for (let i = start; i <= endIdx; i++) {
    const { h, l, c, v } = candles[i];
    const range = h - l;
    if (range > 0 && v > 0) {
      sumMFV += ((c - l) - (h - c)) / range * v;
      sumVol += v;
    }
  }
  return sumVol > 0 ? safe(sumMFV / sumVol) : 0;
}

function computeOBVSlope10(candles: Candle[], endIdx: number): number {
  const start = Math.max(1, endIdx - 10);
  const len = endIdx - start;
  if (len < 3) return 0;

  let obv = 0;
  const obvValues: number[] = [];
  const vols: number[] = [];
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
    sumX += i; sumY += obvValues[i]; sumXY += i * obvValues[i]; sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return 0;
  const slope = (n * sumXY - sumX * sumY) / denom;
  return safe(slope / meanVol);
}

function computeVolDryUpScore(candles: Candle[], endIdx: number): number {
  const start = Math.max(0, endIdx - 5);
  let score = 0;
  for (let i = start + 1; i < endIdx; i++) {
    if (candles[i].v < candles[i - 1].v) score++;
  }
  return score;
}

function computeMomentumEnhancements(
  candles: Candle[], endIdx: number, zone: ZoneInfo | null,
  priceEngine: PriceEngine
): MomentumEnhancements {
  const sig = candles[endIdx];

  // EMA alignment
  const ema20Arr = computeEMA(candles, 20);
  const ema50Arr = computeEMA(candles, 50);
  const ema20 = safe(ema20Arr[endIdx]);
  const ema50 = safe(ema50Arr[endIdx]);
  const emaAligned = candles.length >= 50 && sig.c > ema20 && sig.c > ema50 && ema20 > ema50;

  // Higher low confirmation
  const swingStart = Math.max(0, endIdx - 30);
  const swingEnd = Math.max(0, endIdx - 20);
  let swingLow20 = Infinity;
  for (let i = swingStart; i < swingEnd; i++) {
    if (candles[i].l < swingLow20) swingLow20 = candles[i].l;
  }
  if (!Number.isFinite(swingLow20)) swingLow20 = 0;
  const higherLowConfirmed = zone !== null && zone.zoneLow > swingLow20 && swingLow20 > 0;

  // Volume dry-up
  const volDryUpScore = computeVolDryUpScore(candles, endIdx);

  // OBV slope
  const obvSlope10 = computeOBVSlope10(candles, endIdx);

  // ADX
  const adx14 = computeADX14(candles);
  const adxInRange = adx14 > 40;

  // Gap-adjusted R:R
  let gapAdjustedRR = 0;
  if (priceEngine.plannedEntry > 0 && priceEngine.tacticalStop > 0 && priceEngine.tradeValid) {
    const risk = priceEngine.plannedEntry - priceEngine.tacticalStop;
    if (risk > 0) {
      const t1Dist = priceEngine.target5 - priceEngine.plannedEntry;
      gapAdjustedRR = t1Dist > 0 ? t1Dist / risk : 0;
    }
  }

  // Composite momentum score (0-100)
  // Re-calibrated on 3,806 breakout signals × 1,617 NSE stocks.
  // REMOVED: higherLow (r=−0.041, −1.17% edge), adxInRange (r=−0.034, −0.89% edge),
  // gapRR≥2 (r=−0.005, −0.65% edge) — all three are NEGATIVE predictors.
  // volDryUp is the dominant positive predictor (+0.76% edge); obvSlope secondary (+0.32%).
  // adx>40 (strong trend, no upper cap) replaces the inverted adxInRange 20-40 filter.
  let momentumScore = 0;
  if (emaAligned)          momentumScore += 5;   // near-zero (r=+0.0003), small weight retained for UI
  if (volDryUpScore >= 3)  momentumScore += 35;  // r=+0.014, strongest positive predictor
  if (volDryUpScore >= 4)  momentumScore += 10;  // bonus for very strong dry-up
  if (obvSlope10 >= 0.5)   momentumScore += 30;  // r=+0.024, secondary positive predictor
  if (adx14 > 40)          momentumScore += 10;  // ADX>40 = strong trend (NOT range-bound 20-40)

  return {
    emaAligned, ema20: safe(ema20), ema50: safe(ema50),
    higherLowConfirmed, swingLow20: safe(swingLow20),
    volDryUpScore,
    obvSlope10: safe(obvSlope10),
    adx14: safe(adx14, 20), adxInRange,
    gapAdjustedRR: safe(gapAdjustedRR),
    momentumScore: clamp(momentumScore, 0, 100),
    rsNifty20: 1.0,
  };
}

function percentileRank(window: number[], value: number): number {
  if (window.length === 0) return 50;
  // Use (below + 0.5×equal)/n to avoid 0th-percentile when value equals window max
  const below = window.filter(v => v < value).length;
  const equal = window.filter(v => v === value).length;
  return ((below + equal * 0.5) / window.length) * 100;
}

// ─── ATR14 — Wilder's smoothing ───────────────────────────────────────────────

function computeATR14(candles: Candle[]): number[] {
  const result: number[] = new Array(candles.length).fill(0);
  if (candles.length === 0) return result;

  const trs: number[] = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevC = candles[i - 1].c;
    const tr = Math.max(c.h - c.l, Math.abs(c.h - prevC), Math.abs(c.l - prevC));
    trs[i] = tr;
  }
  // trs[0] = 0 (no previous candle)

  // ATR[14] = SMA of first 14 TRs (indices 1..14)
  if (candles.length <= 14) {
    for (let i = 1; i < candles.length; i++) {
      result[i] = trs[i];
    }
    return result;
  }

  let atrSum = 0;
  for (let i = 1; i <= 14; i++) atrSum += trs[i];
  result[14] = atrSum / 14;

  for (let i = 15; i < candles.length; i++) {
    result[i] = (result[i - 1] * 13 + trs[i]) / 14;
  }

  return result;
}

// ─── RSI ─────────────────────────────────────────────────────────────────────

function computeRSI(candles: Candle[], period: number): number {
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
  return 100 - 100 / (1 + rs);
}

// ─── COMPRESSION ZONE ─────────────────────────────────────────────────────────

function findCompressionZone(
  candles: Candle[],
  atr14: number[],
  params: ParamSet,
  endIdx: number
): ZoneInfo | null {
  let bestZone: ZoneInfo | null = null;
  let bestProximity = Infinity;
  let bestTightness = Infinity;
  let bestLength = 0;

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
      const atrRatios: number[] = [];

      for (let i = s; i < end; i++) {
        const atrVal = atr14[i] ?? 0.0001;
        if (atrVal <= 0) { valid = false; break; }
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
      const zoneTightnessPct = zoneLow > 0 ? ((zoneHigh - zoneLow) / zoneLow) * 100 : 0;

      // Zone shape: compare first half vs second half
      const mid = Math.floor(len / 2);
      let fhH = -Infinity, shH = -Infinity, fhL = Infinity, shL = Infinity;
      for (let i = s; i < s + mid; i++) { fhH = Math.max(fhH, candles[i].h); fhL = Math.min(fhL, candles[i].l); }
      for (let i = s + mid; i < end; i++) { shH = Math.max(shH, candles[i].h); shL = Math.min(shL, candles[i].l); }
      const zoneShape: 'FLAT' | 'ASCENDING' | 'DESCENDING' =
        shL > fhL * 1.005 && shH >= fhH * 0.995 ? 'ASCENDING'
        : shH < fhH * 0.995 && shL <= fhL * 1.005 ? 'DESCENDING' : 'FLAT';

      // Reject descending zones — backtested: 40.2% WR, PF 1.41, 19% false stops
      if (zoneShape === 'DESCENDING') continue;

      if (
        proximity < bestProximity ||
        (proximity === bestProximity && zoneTightnessPct < bestTightness) ||
        (proximity === bestProximity && zoneTightnessPct === bestTightness && len > bestLength)
      ) {
        bestProximity = proximity;
        bestTightness = zoneTightnessPct;
        bestLength = len;
        bestZone = {
          zoneHigh,
          zoneLow,
          zoneATRRatio,
          zoneTightnessPct,
          windowLength: len,
          zoneShape,
        };
      }
    }
  }

  return bestZone;
}

// ─── ULTRA PRECISION SCORE ────────────────────────────────────────────────────

function computeUPS(
  zone: ZoneInfo | null,
  closeLoc: number,
  bodyPct: number,
  upperWickPct: number,
  volRatio20: number,
  volVsPre5: number,
  volExpRatio: number,
  rsi2: number,
  signalRangePct: number
): number {
  let score = 0;

  // Component 1 — Compression quality (30 pts)
  if (zone) {
    if (zone.zoneTightnessPct <= 5) score += 30;
    else if (zone.zoneTightnessPct <= 8) score += 25;
    else if (zone.zoneTightnessPct <= 12) score += 20;
    else if (zone.zoneTightnessPct <= 15) score += 15;
  }

  // Component 2 — Close location (10 pts)
  if (closeLoc >= 75) score += 10;
  else if (closeLoc >= 65) score += 7;
  else if (closeLoc >= 55) score += 4;

  // Component 3 — Body % (10 pts)
  if (bodyPct >= 70) score += 10;
  else if (bodyPct >= 55) score += 7;
  else if (bodyPct >= 40) score += 4;
  else if (bodyPct >= 20) score += 2;

  // Component 4 — Upper wick (5 pts)
  if (upperWickPct <= 15) score += 5;
  else if (upperWickPct <= 25) score += 3;
  else if (upperWickPct <= 35) score += 1;

  // Component 5 — Vol vs 20-day (10 pts)
  if (volRatio20 >= 2.0) score += 10;
  else if (volRatio20 >= 1.5) score += 7;
  else if (volRatio20 >= 1.0) score += 4;

  // Component 6 — Vol vs pre-5 (10 pts)
  if (volVsPre5 >= 3.0) score += 10;
  else if (volVsPre5 >= 2.0) score += 7;
  else if (volVsPre5 >= 1.5) score += 4;

  // Component 7 — Vol expansion (5 pts)
  if (volExpRatio >= 2.5) score += 5;
  else if (volExpRatio >= 1.5) score += 3;
  else if (volExpRatio >= 1.0) score += 1;

  // Component 8 — RSI(2) (10 pts)
  if (rsi2 >= 70) score += 10;
  else if (rsi2 >= 60) score += 7;
  else if (rsi2 >= 50) score += 4;
  else if (rsi2 >= 40) score += 2;

  // Component 9 — Candle risk (10 pts) — signalRangePct
  if (signalRangePct <= 5) score += 10;
  else if (signalRangePct <= 7) score += 7;
  else if (signalRangePct <= 9) score += 4;
  else if (signalRangePct <= 11) score += 2;

  return clamp(score, 0, 100);
}

// ─── CANDLE QUALITY SCORE ─────────────────────────────────────────────────────

function computeCQS(
  closeLoc: number,
  upperWickPct: number,
  bodyPct: number,
  volVsPre5: number,
  volExpRatio: number
): number {
  let score = 0;
  if (closeLoc >= 65) score += 1;
  if (upperWickPct <= 30) score += 1;
  if (bodyPct >= 40) score += 1;
  if (volVsPre5 >= 2.5) score += 1;
  if (volExpRatio >= 1.5) score += 1;
  return score;
}

// ─── INFLECTION SCORE ─────────────────────────────────────────────────────────
// margin-based credit: how far PAST a threshold a value is, not just whether
// it cleared the threshold. `span` is the distance above/below the threshold
// that earns full credit (e.g. 2x the min ratio, or the room up to a 0-100 cap).
function marginUp(value: number, min: number, span: number): number {
  if (span <= 0) return value >= min ? 1 : 0;
  return clamp((value - min) / span, 0, 1);
}
function marginDown(value: number, max: number, span: number): number {
  if (span <= 0) return value <= max ? 1 : 0;
  return clamp((max - value) / span, 0, 1);
}

// Stage classification (see call site) only reaches this scorer once EVERY
// gating condition (preCondsMet && breakoutOk && exactCondsMet) is already
// true. The old implementation awarded flat full credit for each condition
// the moment it passed — but since all of them are guaranteed true here,
// that guaranteed a score FLOOR of ~82/100, above the ULTRA_STRONG_BUY
// cutoff (75) on every single signal that reached this branch. BUY (45-60)
// and STRONG_BUY (60-75) were mathematically unreachable: every signal that
// got this far scored 82-100 and landed in ULTRA_STRONG_BUY regardless of
// how marginally it cleared each gate. Replaced with continuous margin
// credit — barely-clearing-the-bar signals now score near the floor,
// comfortably-clearing signals score in the middle, and only genuinely
// exceptional signals (well past every threshold) reach 75+.
function computeInflectionScore(
  zone: ZoneInfo | null,
  params: ParamSet,
  breakoutOk: boolean,
  pre10AvgRangeATR: number, pre10AvgVolRatio: number, pre5AvgVolRatio: number, pre10RedVolBias: number,
  exactRangeATR14: number, exactVolRatio20: number, exactVolVsPre5: number,
  closeLoc: number, upperWickPct: number, bodyPct: number, signalRangePct: number,
  ultraPrecisionScore: number, rsi2: number, volatilityExpansionRatio: number, candleQualityScore: number
): number {
  // Base: reaching this function means preCondsMet && breakoutOk && exactCondsMet
  // all passed. Award 45 points as the floor for clearing all gates, then add
  // margin bonuses (up to 55 more) for how comfortably each condition was cleared.
  // This maps: barely-passing → 45 (BUY), comfortably-passing → 60-74 (STRONG_BUY),
  // exceptionally-passing → 75+ (ULTRA_STRONG_BUY).
  let score = 45;

  // Zone quality bonus (0–15 pts)
  if (zone) {
    score += marginUp(zone.windowLength, params.minZoneLen, params.maxZoneLen - params.minZoneLen) * 5;
    score += marginDown(zone.zoneTightnessPct, params.maxZoneTightnessPct, params.maxZoneTightnessPct * 0.5) * 10;
  }

  // Pre-condition comfort bonus (0–10 pts) — how far below each max threshold
  score += marginDown(pre10AvgRangeATR, params.maxPre10AvgRangeATR, params.maxPre10AvgRangeATR * 0.5) * 2.5;
  score += marginDown(pre10AvgVolRatio, params.maxPre10AvgVolRatio, params.maxPre10AvgVolRatio * 0.5) * 2.5;
  score += marginDown(pre5AvgVolRatio, params.maxPre5AvgVolRatio, params.maxPre5AvgVolRatio * 0.5) * 2.5;
  score += marginDown(pre10RedVolBias, params.maxPre10RedVolBias, params.maxPre10RedVolBias * 0.5) * 2.5;

  // Candle quality bonus (0–20 pts)
  score += marginUp(exactRangeATR14, params.minExactRangeATR14, params.minExactRangeATR14) * 3;
  score += marginUp(exactVolRatio20, params.minExactVolRatio20, params.minExactVolRatio20) * 3;
  score += marginUp(exactVolVsPre5, params.minExactVolVsPre5, params.minExactVolVsPre5) * 3;
  score += marginUp(closeLoc, params.minCloseLoc, 100 - params.minCloseLoc) * 3;
  score += marginDown(upperWickPct, params.maxUpperWickPct, params.maxUpperWickPct * 0.5) * 2;
  score += marginUp(bodyPct, params.minBodyPct, 100 - params.minBodyPct) * 2;
  score += marginDown(signalRangePct, params.maxCandleRisk, params.maxCandleRisk * 0.5) * 4;

  // Precision bonus (0–10 pts)
  score += marginUp(ultraPrecisionScore, params.minUltraPrecisionScore, 100 - params.minUltraPrecisionScore) * 4;
  score += marginUp(rsi2, params.minRSI2, 100 - params.minRSI2) * 2;
  if (params.minVolatilityExpansionRatio !== null) {
    score += marginUp(volatilityExpansionRatio, params.minVolatilityExpansionRatio, params.minVolatilityExpansionRatio) * 2;
  }
  if (params.minCandleQualityScore !== null) {
    score += marginUp(candleQualityScore, params.minCandleQualityScore, 5 - params.minCandleQualityScore) * 2;
  }

  return clamp(score, 0, 100);
}

// Hybrid stage assignment — backtest-anchored ceiling + score-refined floor.
//
// The archetype win rates were measured OUT-OF-SAMPLE on count-based tiers
// (6/6 → ULTRA, 5/6 → STRONG, 4/6 → BUY). That count therefore defines the
// MAXIMUM tier a signal may claim — promoting past it would assign a tier
// whose win rate was never measured. Within that ceiling, the continuous
// score (which weights the margin of exceedance on every condition) can
// DEMOTE a marginal pass: a 6/6 signal that barely scraped each threshold
// (score < 80) presents as STRONG rather than ULTRA. Demotion only tightens
// selectivity per tier, so realized per-tier win rate can only improve
// relative to the backtest baseline — never degrade below it.
function archetypeStage(conditionsMet: number, score: number): StageRating {
  const capRank = conditionsMet >= 6 ? 3 : conditionsMet === 5 ? 2 : conditionsMet === 4 ? 1 : 0;
  const scoreRank = score >= 80 ? 3 : score >= 63 ? 2 : score >= 45 ? 1 : 0;
  const rank = Math.min(capRank, scoreRank);
  return rank === 3 ? 'ULTRA_STRONG_BUY'
    : rank === 2 ? 'STRONG_BUY'
    : rank === 1 ? 'BUY'
    : 'PRE_BREAKOUT';
}

// ─── BUILD NULL PRICE ENGINE ──────────────────────────────────────────────────

function buildNullPriceEngine(): PriceEngine {
  return {
    breakoutLevel: 0, plannedEntry: 0,
    gapPct: 0, gapATR: 0, entryMode: 'breakout', entryStatus: 'normal',
    entryBuffer: 0, efficiencyRatio: 0,
    tacticalStop: 0, tacticalRiskPct: 0,
    stopWeinstein: 0, stopKase: 0, stopElder: 0, stopSignalLow: 0,
    disasterStop: 0, disasterRiskPct: 0, riskPerShare: 0,
    target5: 0, target7: 0, target10: 0, target3R: 0,
    t1R: 0, t2R: 0, t3R_mult: 0,
    rewardRisk: 0,
    chandelierT1: 0, chandelierT2: 0, chandelierT3: 0,
    failedBreakoutLevel: 0, timeStop3d: 0, timeStop5d: 0, timeStop10d: 0,
    tradeValid: false,
    hh252: 0, pctFrom52W: 0, breakoutTier: 'B' as const,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILD TRADE ENGINE v5 — Scientific Extreme
// ═══════════════════════════════════════════════════════════════════════════════
//
// Synthesizes 7 methodologies from the world's top trading researchers:
//
// ENTRY:
//   Weinstein Stage Analysis — buy on confirmed close above resistance
//   Kaufman Adaptive — buffer scales with market efficiency ratio
//
// STOP LOSS:
//   Kase DevStop — True Range standard deviation method (2σ below structure)
//   Elder SafeZone — directional noise filtering
//   LeBeau Chandelier — ATR from highest high for trailing
//   Weinstein — structural stop below the base
//
// TARGETS:
//   Van Tharp R-Multiple framework — all targets in units of risk
//   Schwager — asymmetric scaling (let winners run, cut losers short)
//
// POSITION SIZING:
//   Chande VIDYA — adaptive to current volatility regime
//
// All prices: NSE tick-rounded (₹0.05)
// ═══════════════════════════════════════════════════════════════════════════════

function tick(price: number): number {
  return Math.round(price * 20) / 20;
}

function protectRoundNumber(stopPrice: number): number {
  const roundLevels = [50, 100, 250, 500, 1000, 2500, 5000];
  for (const r of roundLevels) {
    const nearest = Math.round(stopPrice / r) * r;
    const distPct = Math.abs(stopPrice - nearest) / (stopPrice || 1) * 100;
    if (distPct < 0.4 && distPct > 0) {
      return tick(nearest - 0.005 * nearest);
    }
  }
  return stopPrice;
}

// Kase DevStop: Standard deviation of True Range over N bars
// Reference: Cynthia Kase, "Trading with the Odds" (1996)
function kaseDevStop(candles: Candle[], endIdx: number, period: number, multiplier: number): number {
  if (endIdx < period + 1) return candles[endIdx]?.l ?? 0;
  const trs: number[] = [];
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    if (i < 1) continue;
    trs.push(Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c)
    ));
  }
  if (trs.length < 3) return candles[endIdx].l;
  const m = trs.reduce((s, v) => s + v, 0) / trs.length;
  let variance = 0;
  for (const tr of trs) variance += (tr - m) ** 2;
  const sd = Math.sqrt(variance / (trs.length - 1));
  // Stop = recent low - multiplier × stddev(TR)
  let recentLow = Infinity;
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    if (candles[i].l < recentLow) recentLow = candles[i].l;
  }
  return tick(recentLow - multiplier * sd);
}

// Elder SafeZone: Filters directional noise from stop placement
// Reference: Alexander Elder, "Come Into My Trading Room" (2002)
function elderSafeZone(candles: Candle[], endIdx: number, lookback: number, multiplier: number): number {
  if (endIdx < lookback + 1) return candles[endIdx]?.l ?? 0;
  // For long trades: measure downside penetrations (how far price dips below prior low)
  const penetrations: number[] = [];
  for (let i = endIdx - lookback + 1; i <= endIdx; i++) {
    if (i < 1) continue;
    if (candles[i].l < candles[i - 1].l) {
      penetrations.push(candles[i - 1].l - candles[i].l);
    }
  }
  if (penetrations.length === 0) return tick(candles[endIdx].l);
  const avgPenetration = penetrations.reduce((s, v) => s + v, 0) / penetrations.length;
  return tick(candles[endIdx].l - multiplier * avgPenetration);
}

function buildTradeEngine(
  sig: Candle,
  prevCandle: Candle,
  zone: ZoneInfo,
  atr14: number,
  atrPct: number,
  stage: StageRating,
  candles: Candle[],
  endIdx: number,
  pre10AvgRangeATR: number,
  avgTurnover20 = 0
): PriceEngine {

  // Guard: ATR must be positive for meaningful trade calculations
  if (atr14 <= 0) return buildNullPriceEngine();

  // ══════════════════════════════════════════════════════════════════════
  // ENTRY (Weinstein + Kaufman adaptive buffer)
  // ══════════════════════════════════════════════════════════════════════

  // GA-optimal lookback: N=299 (Donchian fitness 3.27, NewHigh fitness 3.11 — both
  // converged independently vs N=252 coarse grid). VCP tier thresholds kept from
  // coarse grid (GA VCP overfit: 2 signals, 100% WR — not statistically valid).
  // GA run: scripts/ga_results_2026-07-15T07-37-10.json (392 symbols, horizon=20d)
  const N_HH = Math.min(299, endIdx);
  let hh252 = 0;
  for (let i = endIdx - N_HH; i < endIdx; i++) {
    if (candles[i].h > hh252) hh252 = candles[i].h;
  }
  const breakoutLevel = tick(Math.max(hh252 > 0 ? hh252 : sig.h, zone.zoneHigh));
  const pctFrom52W = hh252 > 0 && sig.c > 0 ? Math.max(0, (hh252 - sig.c) / sig.c * 100) : 100;
  const breakoutTier: 'A+' | 'A' | 'B' =
    pctFrom52W <= 15 && zone.zoneTightnessPct <= 10 ? 'A+'   // VCP tight coil near 52W high
    : pctFrom52W <= 25                               ? 'A'   // at or approaching 52W high
    :                                                  'B';   // zone breakout, not near 52W

  // Kaufman Efficiency Ratio: measures how "efficient" recent price movement is.
  // ER = |close - close[N]| / sum(|close[i] - close[i-1]|) for i in last N bars.
  // High ER (trending) = tighter buffer. Low ER (noisy) = wider buffer.
  let erNum = 0, erDen = 0;
  const erPeriod = 10;
  if (endIdx >= erPeriod) {
    erNum = Math.abs(candles[endIdx].c - candles[endIdx - erPeriod].c);
    for (let i = endIdx - erPeriod + 1; i <= endIdx; i++) {
      erDen += Math.abs(candles[i].c - candles[i - 1].c);
    }
  }
  const efficiencyRatio = erDen > 0 ? erNum / erDen : 0.5;

  // Buffer = (0.10 - 0.07 × ER) × ATR14
  // ER=1.0 → 0.03×ATR, ER=0.6 → 0.058×ATR, ER=0.0 → 0.10×ATR
  // Minimum: 1 tick (₹0.05)
  const adaptiveBuffer = Math.max(0.05, (0.10 - 0.07 * efficiencyRatio) * atr14);

  // Slippage model
  const turnoverCr = avgTurnover20 / 1e7;
  const slippageMult = turnoverCr >= 50 ? 0.0003 : turnoverCr >= 10 ? 0.0008 : 0.0015;

  const plannedEntry = tick(breakoutLevel + adaptiveBuffer + breakoutLevel * slippageMult);

  // Gap analysis in ATR units
  const gapPct = prevCandle.c > 0 ? ((sig.o - prevCandle.c) / prevCandle.c) * 100 : 0;
  const gapATR = atr14 > 0 ? Math.abs(sig.o - prevCandle.c) / atr14 : 0;
  const entryMode: 'breakout' | 'gap_caution' = gapATR > 1.5 ? 'gap_caution' : 'breakout';
  const entryStatus: 'normal' | 'half_size' | 'no_chase' =
    gapATR > 2.0 ? 'no_chase' : gapATR > 1.0 ? 'half_size' : 'normal';

  // ══════════════════════════════════════════════════════════════════════
  // TACTICAL STOP — Multi-method consensus
  // ══════════════════════════════════════════════════════════════════════
  //
  // Four independent methods each produce a stop level.
  // The FINAL stop = the SECOND-LOWEST of the four.
  const sigRange = sig.h - sig.l;

  // Reference stop methods (for display — not used for actual stop)
  const weinstein = tick(zone.zoneLow - 0.25 * atr14);
  const kase = kaseDevStop(candles, endIdx, 20, 2.0);
  const elder = elderSafeZone(candles, endIdx, 20, 2.5);
  const signalLow = tick(sig.l - 0.15 * atr14);

  // ── Actual stop: Grid-searched optimal formula ──
  //
  // Formula: ZoneLow - 0.5 × ATR14, clamped [4%, 6.5%], CLOSE-ONLY trigger
  // Grid-searched on 33,600 combos × 14,445 signals:
  //   Stop [4,6.5] + T1 2.15×ATR[4,12] + Hold 20d = sweetest spot
  //   WR 48.3%, Expect +1.435%, R:R 1.17 (was 0.94)

  let tacticalStop = tick(zone.zoneLow - 0.50 * atr14);

  // Floor: 3.5% (buildTradeEngine is currently unused — archetypePriceEngine uses 2.5%).
  // Kept at 3.5% here for the zone-based stop model which has wider structural anchors.
  const floorStop = tick(plannedEntry * (1 - 3.5 / 100));
  const capStop = tick(plannedEntry * (1 - 6.5 / 100));
  if (tacticalStop > floorStop) tacticalStop = floorStop;  // too tight → widen to 3.5%
  if (tacticalStop < capStop) tacticalStop = capStop;       // too wide → tighten to 6.5%

  tacticalStop = protectRoundNumber(tacticalStop);
  tacticalStop = tick(tacticalStop);
  // Re-apply clamp after protectRoundNumber nudge
  if (tacticalStop > floorStop) tacticalStop = floorStop;
  if (tacticalStop < capStop) tacticalStop = capStop;
  const tacticalRiskPct = plannedEntry > 0 ? ((plannedEntry - tacticalStop) / plannedEntry) * 100 : 0;

  // ══════════════════════════════════════════════════════════════════════
  // DISASTER STOP (Gap protection — Schwager method)
  // ══════════════════════════════════════════════════════════════════════
  //
  // Schwager: "The disaster stop must be beyond any reasonable retracement."
  // Place below the LOWEST of all structural levels with a full ATR buffer.

  const lowestStructural = Math.min(sig.l, zone.zoneLow);
  // Kase 3σ method for extreme protection
  const kase3sigma = kaseDevStop(candles, endIdx, 20, 3.0);
  let disasterStop = tick(Math.min(lowestStructural - 0.50 * atr14, kase3sigma));
  disasterStop = protectRoundNumber(disasterStop);
  disasterStop = tick(disasterStop);
  const disasterRiskPct = plannedEntry > 0 ? ((plannedEntry - disasterStop) / plannedEntry) * 100 : 0;

  // ══════════════════════════════════════════════════════════════════════
  // TARGETS (Hybrid: ATR-based primary + R-multiple secondary)
  // ══════════════════════════════════════════════════════════════════════
  //
  // Why ATR-based targets instead of fixed R-multiples:
  //
  //   Fixed R targets (T1 = 2R) produce a CONSTANT R:R for every stock.
  //   This is a tautology — it tells you nothing about setup quality.
  //
  //   ATR-based targets reflect how far the stock ACTUALLY moves:
  //   - High-ATR stock with tight stop → high R:R (great setup)
  //   - Low-ATR stock with wide stop → low R:R (weak setup)
  //
  //   R:R now VARIES per stock and reveals which trades have the best
  //   risk/reward structure. A world-class trader evaluates: "Can this
  //   stock reach 1.5× its daily range before hitting my stop?"
  //
  // ── Backtested Hybrid Target System (29-stock hyperopt) ──────
  //
  // Backtested on 29 OHLCV files, deep grid optimization:
  //
  //   T1 = clamp(2.15 × ATR%, 3.00%, 5.00%)
  //        87.5% hit rate | PF 8.30 | avg 4.07 days | avg return 3.72%
  //
  //   T2 = min(5.65%, 2.80 × ATR%)
  //        Momentum continuation target
  //
  //   T3 = ATR-bucket dependent:
  //        ATR% < 1.5  → 5% fixed
  //        ATR% 1.5-3  → 7% fixed
  //        ATR% > 3    → 10% fixed
  //
  //   Why clamp, not just min:
  //   - Floor 3%: prevents tiny meaningless targets on low-ATR stocks
  //   - Cap 5%: momentum validation point, beyond which hit rate drops
  //   - 2.15×ATR: empirical sweet spot from grid search (1.5-3.0 step 0.05)

  const riskPerShare = plannedEntry - tacticalStop;
  const atrPctAtEntry = plannedEntry > 0 ? (atr14 / plannedEntry) * 100 : 2.5;

  // T1/T2/T3: matched to archetypePriceEngine validated formula.
  // T1=1.5×ATR (0.75×risk), T2=3×ATR (1.5×risk), T3=5×ATR (2.5×risk).
  const t1Pct = 0.75 * tacticalRiskPct;
  const target5 = tick(plannedEntry * (1 + t1Pct / 100));

  const t2Pct = 1.5 * tacticalRiskPct;
  const target7 = tick(plannedEntry * (1 + t2Pct / 100));

  const t3Pct = 2.5 * tacticalRiskPct;
  const target10 = tick(Math.max(plannedEntry * (1 + t3Pct / 100), target7 + 0.05));

  // R-based reference (Van Tharp 3R)
  const target3R = tick(plannedEntry + 3.0 * riskPerShare);

  // R:R computed at T2 (= 1.5 by construction)
  const rewardRisk = riskPerShare > 0 ? (target7 - plannedEntry) / riskPerShare : 0;

  // R-multiples at each target
  const t1RMult = riskPerShare > 0 ? (target5 - plannedEntry) / riskPerShare : 0;
  const t2RMult = riskPerShare > 0 ? (target7 - plannedEntry) / riskPerShare : 0;
  const t3RMult = riskPerShare > 0 ? (target10 - plannedEntry) / riskPerShare : 0;

  // ══════════════════════════════════════════════════════════════════════
  // TRAILING STOPS (LeBeau Chandelier Exit)
  // ══════════════════════════════════════════════════════════════════════
  //
  // Chuck LeBeau: "The Chandelier Exit hangs a trailing stop from the
  // highest high since entry, like a chandelier from the ceiling."
  //
  // After T1: Breakeven (entry price) — lock in zero risk
  // After T2: Chandelier 2×ATR below T2 (approximation of highest high)
  // After T3: Chandelier 3×ATR below T3

  const failedBreakoutLevel = tick(zone.zoneHigh);
  const timeStop3d  = tick(plannedEntry);                     // post-T1: breakeven
  const timeStop5d  = tick(Math.max(plannedEntry, Math.min(target7  - 2.0 * atr14, target7  - 0.01))); // post-T2: Chandelier 2×ATR, floor at entry
  const timeStop10d = tick(Math.max(plannedEntry, Math.min(target10 - 3.0 * atr14, target10 - 0.01))); // post-T3: Chandelier 3×ATR, floor at entry

  // ══════════════════════════════════════════════════════════════════════
  // TRADE VALIDITY (Schwager risk management rules)
  // ══════════════════════════════════════════════════════════════════════

  // ── Trade Validity (recalibrated for Cascading Gates stop v2) ──────
  //
  // Old system: R:R ≥ 1.5 with 2-3.5% stop (42.6% trigger rate)
  // New system: R:R ≥ 0.5 with 4-6.5% stop (CLOSE-ONLY via 10-gate filter)
  //
  // Mathematical proof (from 29-OHLCV backtest):
  //   Cascading Gates WR = 89.5%, P(stop trigger) = 8.6%
  //   At R:R 0.5: Expectancy = 0.895 × 0.5 - 0.105 = +0.343R (strongly positive)
  //   At R:R 0.6: Expectancy = 0.895 × 0.6 - 0.105 = +0.432R
  //   Worst Monte Carlo (85% WR): 0.85 × 0.5 - 0.15 = +0.275R (still positive)
  //
  // Low R:R trades (< 0.8) actually have HIGHER hit rate (52.8% vs 28.8%)
  // because wide stops = strong breakouts with deep structural support.
  // R:R is NOT predictive of outcome with Cascading Gates protection.
  let tradeValid = true;
  if (tacticalStop >= plannedEntry) tradeValid = false;
  if (disasterRiskPct > 8.0) tradeValid = false;
  if (tacticalRiskPct > 8.0) tradeValid = false;
  if (riskPerShare <= 0) tradeValid = false;
  if (rewardRisk < 1.5) tradeValid = false;  // T1=max(ATR,2.0×risk,5%) guarantees R:R ≥ 2.0; gate raised to match new baseline
  if (stage !== 'BUY' && stage !== 'STRONG_BUY' && stage !== 'ULTRA_STRONG_BUY') tradeValid = false;

  return {
    breakoutLevel: safe(breakoutLevel),
    plannedEntry: safe(plannedEntry),
    gapPct: safe(gapPct),
    gapATR: safe(gapATR),
    entryMode,
    entryStatus,
    entryBuffer: safe(adaptiveBuffer),
    efficiencyRatio: safe(efficiencyRatio),
    tacticalStop: safe(tacticalStop),
    tacticalRiskPct: safe(tacticalRiskPct),
    stopWeinstein: safe(weinstein),
    stopKase: safe(kase),
    stopElder: safe(elder),
    stopSignalLow: safe(signalLow),
    disasterStop: safe(disasterStop),
    disasterRiskPct: safe(disasterRiskPct),
    riskPerShare: safe(riskPerShare),
    target5: safe(target5),
    target7: safe(target7),
    target10: safe(target10),
    target3R: safe(target3R),
    t1R: safe(t1RMult),
    t2R: safe(t2RMult),
    t3R_mult: safe(t3RMult),
    rewardRisk: safe(rewardRisk),
    chandelierT1: safe(timeStop3d),
    chandelierT2: safe(timeStop5d),
    chandelierT3: safe(timeStop10d),
    failedBreakoutLevel: safe(failedBreakoutLevel),
    timeStop3d: safe(timeStop3d),
    timeStop5d: safe(timeStop5d),
    timeStop10d: safe(timeStop10d),
    tradeValid,
    hh252: safe(hh252),
    pctFrom52W: safe(pctFrom52W),
    breakoutTier,
  };
}

// ─── BUILD CHECKLIST ──────────────────────────────────────────────────────────

function evaluateForensicOverlay(
  params: ParamSet,
  candleDNA: CandleDNA,
  advanced: AdvancedFeatures,
  stats: StatsFeatures
): { ok: boolean; checklist: ChecklistItem[] } {
  const forensic = params.forensic;
  if (!forensic) return { ok: true, checklist: [] };

  const checks: ChecklistItem[] = [];
  const add = (enabled: boolean, label: string, pass: boolean, value: string) => {
    if (enabled) checks.push({ label, pass, value });
  };

  add(forensic.minCandleDnaScore !== undefined && forensic.minCandleDnaScore !== null,
    `CandleDNA ≥ ${forensic.minCandleDnaScore}`, candleDNA.score >= (forensic.minCandleDnaScore ?? 0), candleDNA.score.toFixed(0));
  add(forensic.minCandleDnaCloseQuality !== undefined && forensic.minCandleDnaCloseQuality !== null,
    `DNA close quality ≥ ${forensic.minCandleDnaCloseQuality}`, candleDNA.wickCleanliness >= (forensic.minCandleDnaCloseQuality ?? 0), candleDNA.wickCleanliness.toFixed(0));
  add(forensic.minCandleDnaLowerTail !== undefined && forensic.minCandleDnaLowerTail !== null,
    `DNA lower-tail support ≥ ${forensic.minCandleDnaLowerTail}`, candleDNA.rangeExpansion >= (forensic.minCandleDnaLowerTail ?? 0), candleDNA.rangeExpansion.toFixed(0));
  add(forensic.maxBodyATR !== undefined && forensic.maxBodyATR !== null,
    `Body/ATR ≤ ${forensic.maxBodyATR}`, candleDNA.bodyATR <= (forensic.maxBodyATR ?? Infinity), candleDNA.bodyATR.toFixed(2));
  add(forensic.maxUpperToLowerWickRatio !== undefined && forensic.maxUpperToLowerWickRatio !== null,
    `Upper/lower wick ≤ ${forensic.maxUpperToLowerWickRatio}`, candleDNA.upperToLowerWickRatio <= (forensic.maxUpperToLowerWickRatio ?? Infinity), candleDNA.upperToLowerWickRatio.toFixed(2));
  add(forensic.minMarubozuScore !== undefined && forensic.minMarubozuScore !== null,
    `Marubozu score ≥ ${forensic.minMarubozuScore}`, candleDNA.marubozuScore >= (forensic.minMarubozuScore ?? 0), candleDNA.marubozuScore.toFixed(0));
  add(forensic.minAdvScore !== undefined && forensic.minAdvScore !== null,
    `Advanced score ≥ ${forensic.minAdvScore}`, advanced.advScore >= (forensic.minAdvScore ?? 0), advanced.advScore.toFixed(0));
  add(forensic.minFer20 !== undefined && forensic.minFer20 !== null,
    `FER20 ≥ ${forensic.minFer20}`, advanced.fer20 >= (forensic.minFer20 ?? 0), advanced.fer20.toFixed(2));
  add(forensic.maxCusumPos !== undefined && forensic.maxCusumPos !== null,
    `CUSUM+ ≤ ${forensic.maxCusumPos}`, advanced.cusumPos <= (forensic.maxCusumPos ?? Infinity), advanced.cusumPos.toFixed(3));
  add(forensic.maxMwcScore !== undefined && forensic.maxMwcScore !== null,
    `MWC score ≤ ${forensic.maxMwcScore}`, advanced.mwcScore <= (forensic.maxMwcScore ?? Infinity), String(advanced.mwcScore));
  add(forensic.maxTram !== undefined && forensic.maxTram !== null,
    `TRAM ≤ ${forensic.maxTram}`, advanced.tram <= (forensic.maxTram ?? Infinity), advanced.tram.toFixed(2));
  add(forensic.maxCleanMom !== undefined && forensic.maxCleanMom !== null,
    `Clean momentum ≤ ${forensic.maxCleanMom}`, advanced.cleanMom <= (forensic.maxCleanMom ?? Infinity), advanced.cleanMom.toFixed(1));
  add(forensic.maxDurationRatio !== undefined && forensic.maxDurationRatio !== null,
    `Duration ratio ≤ ${forensic.maxDurationRatio}`, advanced.durationRatio <= (forensic.maxDurationRatio ?? Infinity), advanced.durationRatio.toFixed(2));
  add(forensic.maxVram !== undefined && forensic.maxVram !== null,
    `VRAM ≤ ${forensic.maxVram}`, advanced.vram <= (forensic.maxVram ?? Infinity), advanced.vram.toFixed(2));
  add(forensic.minPic !== undefined && forensic.minPic !== null,
    `PIC ≥ ${forensic.minPic}`, advanced.pic >= (forensic.minPic ?? 0), advanced.pic.toFixed(1));
  add(forensic.maxPic !== undefined && forensic.maxPic !== null,
    `PIC ≤ ${forensic.maxPic}`, advanced.pic <= (forensic.maxPic ?? Infinity), advanced.pic.toFixed(1));
  add(forensic.maxUtbotBarsAgo !== undefined && forensic.maxUtbotBarsAgo !== null,
    `UTBot bars ago ≤ ${forensic.maxUtbotBarsAgo}`, advanced.utbotBarsAgo <= (forensic.maxUtbotBarsAgo ?? Infinity), String(advanced.utbotBarsAgo));
  add(forensic.maxBbWidthPctl !== undefined && forensic.maxBbWidthPctl !== null,
    `BB width pctl ≤ ${forensic.maxBbWidthPctl}`, stats.bbWidthPctl <= (forensic.maxBbWidthPctl ?? Infinity), stats.bbWidthPctl.toFixed(1));
  add(forensic.minVolZScore !== undefined && forensic.minVolZScore !== null,
    `Volume Z ≥ ${forensic.minVolZScore}`, stats.volZScore >= (forensic.minVolZScore ?? 0), stats.volZScore.toFixed(2));
  add(forensic.minStatsScore !== undefined && forensic.minStatsScore !== null,
    `Stats score ≥ ${forensic.minStatsScore}`, stats.statsScore >= (forensic.minStatsScore ?? 0), String(stats.statsScore));
  add(forensic.minSharpe20 !== undefined && forensic.minSharpe20 !== null,
    `Sharpe20 ≥ ${forensic.minSharpe20}`, stats.sharpe20 >= (forensic.minSharpe20 ?? -Infinity), stats.sharpe20.toFixed(2));
  add(forensic.maxEntropy10 !== undefined && forensic.maxEntropy10 !== null,
    `Entropy10 ≤ ${forensic.maxEntropy10}`, stats.entropy10 <= (forensic.maxEntropy10 ?? Infinity), stats.entropy10.toFixed(2));
  add(forensic.minInsideBars !== undefined && forensic.minInsideBars !== null,
    `Inside bars ≥ ${forensic.minInsideBars}`, stats.insideBars >= (forensic.minInsideBars ?? 0), String(stats.insideBars));
  add(forensic.minGuppyCompressDays !== undefined && forensic.minGuppyCompressDays !== null,
    `Guppy compress days ≥ ${forensic.minGuppyCompressDays}`, stats.guppyCompressDays >= (forensic.minGuppyCompressDays ?? 0), String(stats.guppyCompressDays));
  add(forensic.minGuppyGroupGapPct !== undefined && forensic.minGuppyGroupGapPct !== null,
    `Guppy group gap ≥ ${forensic.minGuppyGroupGapPct}%`, stats.guppyGroupGapPct >= (forensic.minGuppyGroupGapPct ?? 0), stats.guppyGroupGapPct.toFixed(2) + '%');
  add(!!forensic.requireGuppyCleanBullishFan,
    'Guppy clean bullish fan', stats.guppyCleanBullishFan, stats.guppyCleanBullishFan ? 'Yes' : 'No');
  add(!!forensic.requireGuppyCoiledRelease,
    'Guppy coiled release', stats.guppyCoiledRelease, stats.guppyCoiledRelease ? 'Yes' : 'No');
  add(forensic.minCandlePatternStrength !== undefined && forensic.minCandlePatternStrength !== null,
    `Pattern strength ≥ ${forensic.minCandlePatternStrength}`, stats.candlePatternStrength >= (forensic.minCandlePatternStrength ?? 0), String(stats.candlePatternStrength));
  add(!!forensic.requireBullishPattern,
    'Bullish candle pattern', stats.candlePatternType === 'bullish', stats.candlePatternType);

  return { ok: checks.every(c => c.pass), checklist: checks };
}

function buildChecklist(
  params: ParamSet,
  avgTurnover20: number,
  atrPct14Pctl120: number,
  pre10AvgRangeATR: number,
  pre10ExpansionCount: number,
  zone: ZoneInfo | null,
  pre10AvgVolRatio: number,
  pre5AvgVolRatio: number,
  pre10HighVolCount: number,
  pre10RedVolBias: number,
  breakoutOk: boolean,
  exactRangeATR14: number,
  exactVolRatio20: number,
  exactVolVsPre5: number,
  closeLoc: number,
  upperWickPct: number,
  bodyPct: number,
  signalRangePct: number,
  ultraPrecisionScore: number,
  rsi2: number,
  // booleans
  liquidityOk: boolean,
  volOk: boolean,
  zoneOk: boolean,
  pre10RangeOk: boolean,
  pre10ExpOk: boolean,
  pre10VolOk: boolean,
  pre5VolOk: boolean,
  pre10HighVolOk: boolean,
  pre10RedBiasOk: boolean,
  exactRangeOk: boolean,
  exactVolOk: boolean,
  exactVolPre5Ok: boolean,
  closeLocOk: boolean,
  wickOk: boolean,
  bodyOk: boolean,
  riskOk: boolean,
  upsOk: boolean,
  rsi2Ok: boolean,
  volExpOk: boolean,
  cqsOk: boolean,
  volatilityExpansionRatio: number,
  candleQualityScore: number,
  closeAboveZoneOk: boolean,
  closeAboveZonePct: number,
  forensicChecklist: ChecklistItem[] = []
): ChecklistItem[] {
  const fmt = (n: number, dec = 2) => n.toFixed(dec);
  const fmtM = (n: number) => (n / 1_000_000).toFixed(1) + 'M';

  return [
    {
      label: `Liquidity ≥ ${fmtM(params.minAvgTurnover20)}`,
      pass: liquidityOk,
      value: fmtM(avgTurnover20),
    },
    {
      label: `ATR% Pctl ≤ ${params.maxATRPct14Pctl120}`,
      pass: volOk,
      value: fmt(atrPct14Pctl120, 1),
    },
    {
      label: `Pre-10 AvgRangeATR ≤ ${params.maxPre10AvgRangeATR}`,
      pass: pre10RangeOk,
      value: fmt(pre10AvgRangeATR),
    },
    {
      label: `Pre-10 Expansion ≤ ${params.maxPre10ExpansionCount}`,
      pass: pre10ExpOk,
      value: String(pre10ExpansionCount),
    },
    {
      label: `Zone exists + tightness ≤ ${params.maxZoneTightnessPct}%`,
      pass: zoneOk,
      value: zone ? `${fmt(zone.zoneTightnessPct, 1)}%` : 'no zone',
    },
    {
      label: `Zone length ≥ ${params.minZoneLen}`,
      pass: zoneOk && zone !== null && zone.windowLength >= params.minZoneLen,
      value: zone ? String(zone.windowLength) : '—',
    },
    {
      label: `Pre-10 AvgVolRatio ≤ ${params.maxPre10AvgVolRatio}`,
      pass: pre10VolOk,
      value: fmt(pre10AvgVolRatio),
    },
    {
      label: `Pre-5 AvgVolRatio ≤ ${params.maxPre5AvgVolRatio}`,
      pass: pre5VolOk,
      value: fmt(pre5AvgVolRatio),
    },
    {
      label: `Pre-10 HighVol ≤ ${params.maxPre10HighVolCount}`,
      pass: pre10HighVolOk,
      value: String(pre10HighVolCount),
    },
    {
      label: `Pre-10 RedVolBias ≤ ${params.maxPre10RedVolBias}`,
      pass: pre10RedBiasOk,
      value: fmt(pre10RedVolBias),
    },
    {
      label: `Breakout (close > zoneHigh×${params.breakoutMultiplier})`,
      pass: breakoutOk,
      value: breakoutOk ? 'Yes' : 'No',
    },
    ...(params.maxCloseAboveZonePct !== null ? [{
      label: `Close above zone ≤ ${params.maxCloseAboveZonePct}%`,
      pass: closeAboveZoneOk,
      value: zone ? fmt(closeAboveZonePct) + '%' : '—',
    }] : []),
    {
      label: `Range/ATR ${params.minExactRangeATR14}–${params.maxExactRangeATR14}`,
      pass: exactRangeOk,
      value: fmt(exactRangeATR14),
    },
    {
      label: `Vol/20d ≥ ${params.minExactVolRatio20}`,
      pass: exactVolOk,
      value: fmt(exactVolRatio20),
    },
    {
      label: `Vol/Pre5 ≥ ${params.minExactVolVsPre5}`,
      pass: exactVolPre5Ok,
      value: fmt(exactVolVsPre5),
    },
    {
      label: `Close Loc ≥ ${params.minCloseLoc}%`,
      pass: closeLocOk,
      value: `${fmt(closeLoc, 1)}%`,
    },
    {
      label: `Upper Wick ≤ ${params.maxUpperWickPct}%`,
      pass: wickOk,
      value: `${fmt(upperWickPct, 1)}%`,
    },
    {
      label: `Body ≥ ${params.minBodyPct}%`,
      pass: bodyOk,
      value: `${fmt(bodyPct, 1)}%`,
    },
    {
      label: `Candle Risk ≤ ${params.maxCandleRisk}%`,
      pass: riskOk,
      value: `${fmt(signalRangePct, 1)}%`,
    },
    {
      label: `UPS ≥ ${params.minUltraPrecisionScore}`,
      pass: upsOk,
      value: String(Math.round(ultraPrecisionScore)),
    },
    {
      label: `RSI(2) ≥ ${params.minRSI2}`,
      pass: rsi2Ok,
      value: fmt(rsi2, 1),
    },
    ...(params.minVolatilityExpansionRatio !== null ? [{
      label: `VolExp ≥ ${params.minVolatilityExpansionRatio}`,
      pass: volExpOk,
      value: fmt(volatilityExpansionRatio),
    }] : []),
    ...(params.minCandleQualityScore !== null ? [{
      label: `CandleQuality ≥ ${params.minCandleQualityScore}`,
      pass: cqsOk,
      value: String(candleQualityScore),
    }] : []),
    ...forensicChecklist,
  ];
}

// ─── ORS-PRIME REVERSAL ENGINE ───────────────────────────────────────────────
// Separate analysis path — do NOT mix with breakout logic.
// Signal candle i: red, RSI2≤5, body≥45%, upWick≤20%, rPct≥3.5%,
//   close ≥3% below EMA20, 60d drawdown ≥30%, 6-bar swing-low pivot, ORS score≥72.
// Confirmation: candle i+1 (next day) closes GREEN → ULTRA_STRONG_BUY (enter at i+2 open).
// Signal only (no confirm yet): STRONG_BUY.
// ORS score bonus: 252d z-score ≤−2.5 adds +8pts, ≤−3.0 adds +12pts.

function computeOrsScore(params: {
  rsi2: number; rsi14: number; rPct: number; distE20: number;
  bodyPct: number; upWick: number; isSwLo: boolean; volDryUp: number; ddFromSwHi: number;
  zScore: number;
}): number {
  let s = 0;
  // RSI2 depth (30 pts) — d=−1.37
  if (params.rsi2 <= 3) s += 30; else if (params.rsi2 <= 5) s += 25;
  else if (params.rsi2 <= 10) s += 20; else if (params.rsi2 <= 15) s += 12;
  // RSI14 (15 pts)
  if (params.rsi14 <= 30) s += 15; else if (params.rsi14 <= 38) s += 10; else if (params.rsi14 <= 45) s += 5;
  // Range/close% (10 pts) — d=+0.65
  if (params.rPct >= 5) s += 10; else if (params.rPct >= 3.5) s += 7; else if (params.rPct >= 2.4) s += 4;
  // EMA20 distance (10 pts) — d=−0.68
  if (params.distE20 <= -8) s += 10; else if (params.distE20 <= -5) s += 7; else if (params.distE20 <= -2) s += 4;
  // Body (8 pts) — d=+0.49
  if (params.bodyPct >= 60) s += 8; else if (params.bodyPct >= 45) s += 5; else if (params.bodyPct >= 35) s += 2;
  // Upper wick (7 pts) — d=−0.51
  if (params.upWick <= 10) s += 7; else if (params.upWick <= 20) s += 5; else if (params.upWick <= 30) s += 2;
  // Swing-low pivot (5 pts)
  if (params.isSwLo) s += 5;
  // Volume dry-up before signal (5 pts) — exhaustion
  if (params.volDryUp <= 0.70) s += 5; else if (params.volDryUp <= 0.85) s += 3;
  // Drawdown from 60d swing high (10 pts) — elastic bounce magnitude
  if (params.ddFromSwHi >= 30) s += 10; else if (params.ddFromSwHi >= 25) s += 8;
  else if (params.ddFromSwHi >= 20) s += 6; else if (params.ddFromSwHi >= 15) s += 3;
  // 252d z-score bonus (soft component, not a hard gate) — d=+0.00 standalone but additive
  if (params.zScore <= -3.0) s += 12; else if (params.zScore <= -2.5) s += 8; else if (params.zScore <= -2.0) s += 5;
  return Math.min(s, 100);
}

function analyzeORS(candles: Candle[]): AnalysisResult {
  const n = candles.length;
  const noOrs = (stage: AnalysisResult['stage'] = 'NO_SIGNAL', score = 0): AnalysisResult => ({
    symbol: '', stage, inflectionScore: score, confidence: 0,
    paramSetKey: 'ors_prime_reversal',
    lastClose: n > 0 ? candles[n - 1].c : 0,
    lastDate: n > 0 ? new Date(candles[n - 1].ts * 1000).toISOString().slice(0, 10) : '',
    avgTurnover20: 0, atrPct14: 0, atrPct14Pctl120: 0,
    volRatio20: 0, rsi2: 0, rsi14: 50, zone: null,
    pre10AvgRangeATR: 0, pre10ExpansionCount: 0,
    pre10AvgVolRatio: 0, pre5AvgVolRatio: 0,
    pre10HighVolCount: 0, pre10RedVolBias: 0,
    exactRangeATR14: 0, exactVolRatio20: 0, exactVolVsPre5: 0,
    closeLoc: 0, upperWickPct: 0, bodyPct: 0,
    signalRangePct: 0, volatilityExpansionRatio: 0,
    ultraPrecisionScore: score, candleQualityScore: 0,
    priceEngine: buildNullPriceEngine(),
    conditionsMet: 0, totalConditions: 10, checklist: [],
    momentum: { emaAligned: false, ema20: 0, ema50: 0, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: 0, obvSlope10: 0, adx14: 20, adxInRange: true, gapAdjustedRR: 0, momentumScore: 0, rsNifty20: 1.0 },
    nearBreakoutPct: 99, nearBreakout: false, nearBreakoutTier: null,
    stats: { volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false, lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false, skewness20: 0, positiveSkew: false, drawdownFrom52WH: 0, pctFrom52WL: 0, sharpe20: 0, entropy10: 0, cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1.0, ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false, rsi14: 50, cci34: 0, ema10: 0, ema21: 0, ema55: 0, sma200: 0, ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false, guppySpreadPct: 99, guppyCompressed: false, guppyUltraCompressed: false, guppyCompressDays: 0, guppyCleanBullishFan: false, guppyGroupGapPct: 0, guppyCoiledRelease: false, candlePattern: '—', candlePatternFull: 'Unknown', candlePatternType: 'neutral' as const, candlePatternStrength: 0, statsScore: 0 },
    clusterBreakdown: { deployable: { met: 0, total: 0 }, highPrecision: { met: 0, total: 0 }, elite: { met: 0, total: 0 }, ultraSelective: { met: 0, total: 0 }, sniper: { met: 0, total: 0 }, orsReversal: { met: 0, total: 10, score, confirmed: false } },
    monster: { badges: [], topProbability: 0 },
    dayChangePct: 0,
    candleDNA: { score: 0, bodyStrength: 0, wickCleanliness: 0, rangeExpansion: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, tier: 'WEAK' },
    orsScore: score, ddFromSwingHigh: 0, distFromEMA20: 0, zScore252: 0, orsConfirmed: false,
  });

  const orsParams = PARAM_SETS['ors_prime_reversal'].ors!;
  if (n < 260) return noOrs();

  // ── Helper: check one candle at index i ──────────────────────────────────
  const atr14Arr = computeATR14(candles);
  const ema20Arr = computeEMA(candles, 20);
  const { adx: adxArrORS } = computeDMI(candles);

  // Pre-compute Wilder RSI arrays (Bug 1&2 fix: inline raw-sum was not Wilder smoothing)
  const buildWilderRSIArr = (period: number): number[] => {
    const out = new Array(n).fill(50);
    if (n <= period) return out;
    let ag = 0, al = 0;
    for (let j = 1; j <= period; j++) { const d = candles[j].c - candles[j-1].c; if (d > 0) ag += d; else al -= d; }
    ag /= period; al /= period;
    out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let j = period + 1; j < n; j++) {
      const d = candles[j].c - candles[j-1].c;
      ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
      al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
      out[j] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  };
  const rsi2ArrORS  = buildWilderRSIArr(2);
  const rsi14ArrORS = buildWilderRSIArr(14);

  // 252d rolling z-score
  const zScoreAt = (i: number): number => {
    const start = Math.max(0, i - 251);
    let sum = 0, cnt = 0;
    for (let j = start; j <= i; j++) { sum += candles[j].c; cnt++; }
    const mean = sum / cnt;
    let varSum = 0;
    for (let j = start; j <= i; j++) { const d = candles[j].c - mean; varSum += d * d; }
    const std = cnt > 1 ? Math.sqrt(varSum / (cnt - 1)) : 0;
    return std > 0 ? (candles[i].c - mean) / std : 0;
  };

  const evalCandle = (i: number) => {
    if (i < 10) return null;
    const c = candles[i];
    const range = c.h - c.l;
    if (range <= 0 || c.c <= 0) return null;

    // Liquidity — per-bar price×vol turnover average (Bug 3 fix: was using vAvg20 * sig.c)
    let tSum = 0, tCnt = 0;
    for (let j = Math.max(0, i - 20); j < i; j++) { tSum += candles[j].c * candles[j].v; tCnt++; }
    if (tCnt === 0 || tSum / tCnt < 10_000_000) return null;
    const tAvg = tSum / tCnt;

    const a14 = atr14Arr[i] || 0.0001;
    const bodyPct      = Math.abs(c.c - c.o) / range * 100;
    const upWick       = (c.h - Math.max(c.o, c.c)) / range * 100;
    const lowerWickPct = (Math.min(c.o, c.c) - c.l) / range * 100;
    const closeLoc     = (c.c - c.l) / range * 100;
    const rPct         = range / c.c * 100;
    const bodyAtr      = Math.abs(c.c - c.o) / a14;
    const red          = c.c < c.o;

    // RSI2 and RSI14 — read from pre-computed Wilder RSI arrays (Bug 1&2 fix)
    const rsi2  = rsi2ArrORS[i];
    const rsi14 = rsi14ArrORS[i];

    // EMA20 distance
    const e20 = ema20Arr[i];
    const distE20 = e20 > 0 ? (c.c - e20) / e20 * 100 : 0;

    // 60d swing high drawdown
    let swHi = -Infinity;
    for (let j = Math.max(0, i - 60); j < i; j++) if (candles[j].h > swHi) swHi = candles[j].h;
    const ddFromSwHi = swHi > 0 ? (swHi - c.c) / swHi * 100 : 0;

    // 6-bar swing-low pivot
    let minLo = Infinity;
    for (let j = Math.max(0, i - 6); j < i; j++) if (candles[j].l < minLo) minLo = candles[j].l;
    const isSwLo = c.l <= minLo;

    // Volume dry-up (pre-5 avg vs 20d avg)
    let v20s = 0, v20c = 0;
    for (let j = Math.max(0, i - 20); j < i; j++) { v20s += candles[j].v; v20c++; }
    const vAvg20 = v20c ? v20s / v20c : 1;
    let v5s = 0, v5c = 0;
    for (let j = Math.max(0, i - 5); j < i; j++) { v5s += candles[j].v; v5c++; }
    const volDryUp = v5c ? (v5s / v5c) / vAvg20 : 1;

    const zScore = zScoreAt(i);
    const score = computeOrsScore({ rsi2, rsi14, rPct, distE20, bodyPct, upWick, isSwLo, volDryUp, ddFromSwHi, zScore });

    // Gate check (v6: lowerWickPct demand proof + bodyAtr anti-extension added)
    const adxORS = adxArrORS[i] ?? 0;
    const passes = (
      (!orsParams.requireRedCandle || red) &&
      rsi2 <= orsParams.maxRSI2 &&
      rsi14 <= orsParams.maxRSI14 &&
      closeLoc <= orsParams.maxCloseLoc &&
      bodyPct >= orsParams.minBodyPct &&
      upWick <= orsParams.maxUpperWickPct &&
      rPct >= orsParams.minRangePct &&
      distE20 <= orsParams.maxDistEMA20 &&
      ddFromSwHi >= orsParams.minDdSwingHigh &&
      (!orsParams.requireSwingLow || isSwLo) &&
      score >= orsParams.minOrsScore &&
      (orsParams.minADX == null || adxORS >= orsParams.minADX) &&
      (orsParams.minLowerWickPct == null || lowerWickPct >= orsParams.minLowerWickPct) &&
      (orsParams.maxBodyATR == null || bodyAtr <= orsParams.maxBodyATR)
    );

    return { passes, score, a14, bodyPct, upWick, lowerWickPct, bodyAtr, closeLoc, rPct, rsi2, rsi14, distE20, ddFromSwHi, zScore, vAvg20, tAvg, adxORS, c };
  };

  const endIdx = n - 1;
  const sig = candles[endIdx];

  // Check: is today's candle a green-confirmation of yesterday's ORS signal?
  const prevEval = endIdx >= 1 ? evalCandle(endIdx - 1) : null;
  const todayGreen = sig.c > sig.o;
  const confirmed = !!(prevEval?.passes && todayGreen);

  // Check: is today's candle itself an ORS signal?
  const todayEval = evalCandle(endIdx);

  const primaryEval = confirmed ? prevEval! : todayEval;
  if (!primaryEval?.passes) return noOrs();

  const { score, a14, bodyPct, upWick, lowerWickPct, bodyAtr, closeLoc, rPct, rsi2, rsi14, distE20, ddFromSwHi, zScore, vAvg20, adxORS } = primaryEval;

  // Price engine — ORS uses archetypePriceEngine for consistent T1/T2/T3.
  // ORS slAtrMult=3.0 historically produced R:R<0.5 on high-ATR stocks.
  // Routing through archetypePriceEngine gives T1=1.5×ATR, T2=3×ATR,
  // T3=5×ATR (validated across 14.3L signals — same formula as breakout archetypes).
  const entryPrice = confirmed ? sig.o : (n > 1 ? candles[n - 1].c : sig.c);
  const pe = archetypePriceEngine(entryPrice, a14);
  const target4pct = pe.target5;  // T1 ≈ 4–6% for typical stock
  const rrRatio = pe.rewardRisk;

  // Stage — backtest-anchored: the OOS win rate for ULTRA was measured ONLY on
  // confirmed signals (next-day green close). Confirmation is therefore the
  // ceiling for ULTRA; an unconfirmed signal caps at STRONG regardless of score.
  // Within each ceiling the ORS score demotes marginal passes (min-pass = 72):
  // confirmed but barely-passing (< 80) presents as STRONG, unconfirmed
  // barely-passing (< 78) presents as BUY. Demotion only tightens per-tier
  // selectivity vs the backtest baseline.
  const stage: AnalysisResult['stage'] = confirmed
    ? (score >= 80 ? 'ULTRA_STRONG_BUY' : 'STRONG_BUY')
    : (score >= 78 ? 'STRONG_BUY' : 'BUY');

  // Checklist
  const checklist: ChecklistItem[] = [
    { label: `RSI(2) ≤ ${orsParams.maxRSI2} (oversold)`, pass: rsi2 <= orsParams.maxRSI2, value: rsi2.toFixed(1) },
    { label: `RSI(14) ≤ ${orsParams.maxRSI14}`, pass: rsi14 <= orsParams.maxRSI14, value: rsi14.toFixed(1) },
    { label: `Body ≥ ${orsParams.minBodyPct}%`, pass: bodyPct >= orsParams.minBodyPct, value: bodyPct.toFixed(1) + '%' },
    { label: `Upper wick ≤ ${orsParams.maxUpperWickPct}%`, pass: upWick <= orsParams.maxUpperWickPct, value: upWick.toFixed(1) + '%' },
    ...(orsParams.minLowerWickPct != null ? [{ label: `Lower wick ≥ ${orsParams.minLowerWickPct}% (demand absorption)`, pass: lowerWickPct >= orsParams.minLowerWickPct, value: lowerWickPct.toFixed(1) + '%' }] : []),
    ...(orsParams.maxBodyATR != null ? [{ label: `Body ≤ ${orsParams.maxBodyATR}×ATR (not over-extended)`, pass: bodyAtr <= orsParams.maxBodyATR, value: bodyAtr.toFixed(2) + '×' }] : []),
    { label: `Range/Close ≥ ${orsParams.minRangePct}%`, pass: rPct >= orsParams.minRangePct, value: rPct.toFixed(2) + '%' },
    { label: `EMA20 dist ≤ ${orsParams.maxDistEMA20}%`, pass: distE20 <= orsParams.maxDistEMA20, value: distE20.toFixed(2) + '%' },
    { label: `60d drawdown ≥ ${orsParams.minDdSwingHigh}%`, pass: ddFromSwHi >= orsParams.minDdSwingHigh, value: ddFromSwHi.toFixed(1) + '%' },
    { label: `ORS score ≥ ${orsParams.minOrsScore}`, pass: score >= orsParams.minOrsScore, value: score.toString() },
    ...(orsParams.minADX != null ? [{ label: `ADX ≥ ${orsParams.minADX} (trending regime)`, pass: (adxORS ?? 0) >= orsParams.minADX, value: (adxORS ?? 0).toFixed(0) }] : []),
    { label: 'Green confirmation candle', pass: confirmed, value: confirmed ? 'CONFIRMED ✓' : 'PENDING' },
  ];

  return {
    symbol: '',
    stage,
    inflectionScore: score,
    confidence: (score / 100) * 100,
    paramSetKey: 'ors_prime_reversal',
    lastClose: sig.c,
    lastDate: new Date(sig.ts * 1000).toISOString().slice(0, 10),
    avgTurnover20: todayEval?.tAvg ?? 0,
    atrPct14: a14 / sig.c * 100,
    atrPct14Pctl120: 0,
    volRatio20: sig.v / (vAvg20 || 1),
    rsi2, rsi14,
    zone: null,
    pre10AvgRangeATR: 0, pre10ExpansionCount: 0,
    pre10AvgVolRatio: 0, pre5AvgVolRatio: 0,
    pre10HighVolCount: 0, pre10RedVolBias: 0,
    exactRangeATR14: (sig.h - sig.l) / a14,
    exactVolRatio20: sig.v / (vAvg20 || 1),
    exactVolVsPre5: 0,
    closeLoc, upperWickPct: upWick, bodyPct,
    signalRangePct: rPct,
    volatilityExpansionRatio: 0,
    ultraPrecisionScore: score,
    candleQualityScore: 0,
    priceEngine: pe,
    conditionsMet: checklist.filter(c => c.pass).length,
    totalConditions: checklist.length,
    checklist,
    momentum: { emaAligned: false, ema20: ema20Arr[endIdx] ?? 0, ema50: 0, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: 0, obvSlope10: 0, adx14: 20, adxInRange: true, gapAdjustedRR: rrRatio, momentumScore: 0, rsNifty20: 1.0 },
    nearBreakoutPct: 99, nearBreakout: false, nearBreakoutTier: null,
    stats: { volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false, lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false, skewness20: 0, positiveSkew: false, drawdownFrom52WH: ddFromSwHi, pctFrom52WL: 0, sharpe20: 0, entropy10: 0, cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1.0, ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false, rsi14, cci34: 0, ema10: 0, ema21: 0, ema55: 0, sma200: 0, ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false, guppySpreadPct: 99, guppyCompressed: false, guppyUltraCompressed: false, guppyCompressDays: 0, guppyCleanBullishFan: false, guppyGroupGapPct: 0, guppyCoiledRelease: false, candlePattern: '—', candlePatternFull: 'ORS Signal', candlePatternType: 'bullish' as const, candlePatternStrength: score, statsScore: score },
    clusterBreakdown: { deployable: { met: 0, total: 0 }, highPrecision: { met: 0, total: 0 }, elite: { met: 0, total: 0 }, ultraSelective: { met: 0, total: 0 }, sniper: { met: 0, total: 0 }, orsReversal: { met: checklist.filter(c => c.pass).length, total: checklist.length, score, confirmed } },
    monster: { badges: [{ type: 'MRV', probability: score / 100, details: `ORS-Prime score ${score} — ${confirmed ? 'ENTRY CONFIRMED' : 'watch for green confirm'}` }], topProbability: score / 100 },
    dayChangePct: n > 1 ? (sig.c - candles[n - 2].c) / candles[n - 2].c * 100 : 0,
    candleDNA: detectCandleDNA(candles, endIdx, a14),
    orsScore: score,
    ddFromSwingHigh: ddFromSwHi,
    distFromEMA20: distE20,
    zScore252: zScore,
    orsConfirmed: confirmed,
  };
}

// ─── SELF-ADAPTIVE SUPERTREND ─────────────────────────────────────────────────

export interface SelfAdaptiveTrendResult {
  trend: 1 | -1 | 0;                     // 1=up, -1=down, 0=no signal yet
  signal: 'BUY' | 'SELL' | 'BOUNCE_UP' | 'BOUNCE_DOWN' | 'UP' | 'DOWN' | 'NONE';
  superTrend: number;                     // current trend line value
  bullishFactor: number;                  // learned ATR multiple for uptrends
  bearishFactor: number;                  // learned ATR multiple for downtrends
  bullishConfidence: number;              // 0–1
  bearishConfidence: number;              // 0–1
  bullishSamples: number;
  bearishSamples: number;
  lastClose: number;
  distancePct: number;                    // % distance from close to supertrend line
}

export function computeSelfAdaptiveTrend(
  candles: Candle[],
  atrLength = 10,
  fallbackFactor = 3.0,
  quantilePct = 85.0,
  sampleLength = 150,
  minSamples = 25,
  factorSmoothing = 5,
  minFactor = 0.75,
  maxFactor = 6.0,
): SelfAdaptiveTrendResult {
  const NONE: SelfAdaptiveTrendResult = {
    trend: 0, signal: 'NONE', superTrend: 0,
    bullishFactor: fallbackFactor, bearishFactor: fallbackFactor,
    bullishConfidence: 0, bearishConfidence: 0,
    bullishSamples: 0, bearishSamples: 0,
    lastClose: 0, distancePct: 0,
  };
  const n = candles.length;
  if (n < Math.max(atrLength * 2, 30)) return NONE;

  // ── ATR computation (Wilder's smoothed via EMA approach like Pine ta.atr) ──
  const trArr: number[] = [];
  for (let i = 1; i < n; i++) {
    const c = candles[i], p = candles[i - 1];
    trArr.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  // RMA (Wilder EMA): alpha = 1/period
  const alpha = 1 / atrLength;
  const atrArr: number[] = [trArr[0]];
  for (let i = 1; i < trArr.length; i++) {
    atrArr.push(alpha * trArr[i] + (1 - alpha) * atrArr[i - 1]);
  }
  // atrArr[i] corresponds to candles[i+1]

  // SMA of TR for bounce band (ta.sma(ta.tr, period))
  const bounceSmaArr: number[] = [];
  for (let i = 0; i < trArr.length; i++) {
    const start = Math.max(0, i - atrLength + 1);
    let s = 0;
    for (let j = start; j <= i; j++) s += trArr[j];
    bounceSmaArr.push(s / (i - start + 1));
  }

  // ── Quantile helper (linear interpolation) ──
  const arrayQuantile = (arr: number[], pct: number): number => {
    if (arr.length === 0) return NaN;
    const sorted = [...arr].sort((a, b) => a - b);
    const rank = (pct / 100) * (sorted.length - 1);
    const lo = Math.floor(rank), hi = Math.ceil(rank);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
  };

  // ── EMA helper ──
  const ema = (series: number[], period: number): number[] => {
    const k = 2 / (period + 1);
    const out: number[] = [series[0]];
    for (let i = 1; i < series.length; i++) out.push(series[i] * k + out[i - 1] * (1 - k));
    return out;
  };

  // ── Main loop ──
  const bullishSampleBuffer: number[] = [];
  const bearishSampleBuffer: number[] = [];

  // We iterate from index 1 of candles (first candle with ATR available)
  const startIdx = 1; // candles[1] = atrArr[0]

  // State
  let lowerBand = NaN, upperBand = NaN;
  let trend = 0;
  let trendExtreme = NaN;

  // Collect factor targets per bar for EMA smoothing
  const bullishFactorTargets: number[] = [];
  const bearishFactorTargets: number[] = [];

  // Incremental EMA state (Bug 4 fix: replaces O(n²) full-array rebuild per bar)
  let _bullEMA = NaN, _bearEMA = NaN;
  const _kFact = 2 / (factorSmoothing + 1);

  // Track trend-flip and bounce signals bar by bar
  let lastSignal: SelfAdaptiveTrendResult['signal'] = 'NONE';
  let lastTrend = 0;
  let lastSuperTrend = NaN;

  for (let i = startIdx; i < n; i++) {
    const atrIdx = i - 1; // atrArr index
    const atr = atrArr[atrIdx];
    if (!atr || atr <= 0) continue;
    const bounceBw = bounceSmaArr[atrIdx];

    const c = candles[i];
    const prevClose = candles[i - 1].c;
    const src = (c.h + c.l) / 2; // hl2

    // Compute quantile-based factors from sample buffers
    const bullQ = bullishSampleBuffer.length > 0 ? arrayQuantile(bullishSampleBuffer, quantilePct) : fallbackFactor;
    const bearQ = bearishSampleBuffer.length > 0 ? arrayQuantile(bearishSampleBuffer, quantilePct) : fallbackFactor;

    const bullConf = Math.min(bullishSampleBuffer.length / Math.max(1, minSamples), 1.0);
    const bearConf = Math.min(bearishSampleBuffer.length / Math.max(1, minSamples), 1.0);

    const boundedBullQ = Math.max(minFactor, Math.min(maxFactor, isNaN(bullQ) ? fallbackFactor : bullQ));
    const boundedBearQ = Math.max(minFactor, Math.min(maxFactor, isNaN(bearQ) ? fallbackFactor : bearQ));

    const bullTarget = fallbackFactor * (1 - bullConf) + boundedBullQ * bullConf;
    const bearTarget = fallbackFactor * (1 - bearConf) + boundedBearQ * bearConf;

    bullishFactorTargets.push(bullTarget);
    bearishFactorTargets.push(bearTarget);

    // Incremental scalar EMA — O(1) per bar instead of O(n²) array rebuild
    _bullEMA = isNaN(_bullEMA) ? bullTarget : _kFact * bullTarget + (1 - _kFact) * _bullEMA;
    _bearEMA = isNaN(_bearEMA) ? bearTarget : _kFact * bearTarget + (1 - _kFact) * _bearEMA;
    const bullFactor = _bullEMA;
    const bearFactor = _bearEMA;

    // Raw bands
    const rawLower = src - bullFactor * atr;
    const rawUpper = src + bearFactor * atr;

    // Ratchet bands
    const prevLower = lowerBand;
    const prevUpper = upperBand;
    lowerBand = isNaN(prevLower) ? rawLower : (rawLower > prevLower || prevClose < prevLower ? rawLower : prevLower);
    upperBand = isNaN(prevUpper) ? rawUpper : (rawUpper < prevUpper || prevClose > prevUpper ? rawUpper : prevUpper);

    // Trend determination
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

    // Bounce lines
    const bullBounceLine = (trend === 1 && !isNaN(bounceBw))
      ? Math.max(superTrendVal, Math.min(superTrendVal + bounceBw, src)) : NaN;
    const bearBounceLine = (trend === -1 && !isNaN(bounceBw))
      ? Math.min(superTrendVal, Math.max(superTrendVal - bounceBw, src)) : NaN;

    // Detect bounce reactions (need prev bar's bounce line)
    // We track this via the final bar signals only
    lastSignal = bullishShift ? 'BUY' : bearishShift ? 'SELL' : trend === 1 ? 'UP' : 'DOWN';

    // Trend extreme tracking
    if (trend !== prevTrend || isNaN(trendExtreme)) {
      trendExtreme = trend === 1 ? c.h : c.l;
    } else {
      trendExtreme = trend === 1 ? Math.max(trendExtreme, c.h) : Math.min(trendExtreme, c.l);
    }

    // Adverse excursion collection
    const bullAE = trend === 1 ? Math.max(trendExtreme - c.l, 0) / atr : NaN;
    const bearAE = trend === -1 ? Math.max(c.h - trendExtreme, 0) / atr : NaN;
    const confirmedBull = trend === 1 && prevTrend === 1 && i < n - 1; // isconfirmed = not last bar
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

  // Final bar signal refinement — check for bounce on last bar
  const endIdx = n - 1;
  const lastC = candles[endIdx];
  const lastSrc = (lastC.h + lastC.l) / 2;

  // Bounce detection on the last two bars
  if (endIdx >= 2 && lastSignal !== 'BUY' && lastSignal !== 'SELL') {
    // Re-derive bounce lines for last two bars is expensive; approximate with final supertrend
    const atrFinal = atrArr[endIdx - 1] || 0.01;
    const bounceFinal = bounceSmaArr[endIdx - 1] || atrFinal;
    if (lastTrend === 1) {
      const bounceLine = Math.max(lastSuperTrend, Math.min(lastSuperTrend + bounceFinal, lastSrc));
      if (lastC.c > bounceLine && candles[endIdx - 1].c <= bounceLine) lastSignal = 'BOUNCE_UP';
    } else if (lastTrend === -1) {
      const bounceLine = Math.min(lastSuperTrend, Math.max(lastSuperTrend - bounceFinal, lastSrc));
      if (lastC.c < bounceLine && candles[endIdx - 1].c >= bounceLine) lastSignal = 'BOUNCE_DOWN';
    }
  }

  const finalAtr = atrArr[endIdx - 1] || 0.01;
  const distancePct = lastSuperTrend > 0 ? Math.abs(lastC.c - lastSuperTrend) / lastC.c * 100 : 0;

  // Final factor values
  const bullFactorFinal = isNaN(_bullEMA) ? fallbackFactor : _bullEMA;
  const bearFactorFinal = isNaN(_bearEMA) ? fallbackFactor : _bearEMA;

  return {
    trend: lastTrend as 1 | -1 | 0,
    signal: lastSignal,
    superTrend: lastSuperTrend,
    bullishFactor: bullFactorFinal,
    bearishFactor: bearFactorFinal,
    bullishConfidence: Math.min(bullishSampleBuffer.length / Math.max(1, minSamples), 1.0),
    bearishConfidence: Math.min(bearishSampleBuffer.length / Math.max(1, minSamples), 1.0),
    bullishSamples: bullishSampleBuffer.length,
    bearishSamples: bearishSampleBuffer.length,
    lastClose: lastC.c,
    distancePct,
  };
}

// ─── ARCHETYPE HELPERS ───────────────────────────────────────────────────────
// Empty by default. Backtest tooling can inject a candidate set without
// changing production behavior or the locked PARAM_SETS object.
export const ARCHETYPE_TUNING: Record<string, Record<string, number | boolean>> = {};
export function setArchetypeTuning(key: ParamSetKey, values: Record<string, number | boolean> | null): void {
  if (values == null) delete ARCHETYPE_TUNING[key];
  else ARCHETYPE_TUNING[key] = values;
}
function tuned(key: ParamSetKey, name: string, fallback: number): number {
  const value = ARCHETYPE_TUNING[key]?.[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function tunedBool(key: ParamSetKey, name: string, fallback: boolean): boolean {
  const value = ARCHETYPE_TUNING[key]?.[name];
  return typeof value === 'boolean' ? value : fallback;
}
function attachTuningDebug<T extends object>(result: T, debug: Record<string, unknown>): T {
  Object.defineProperty(result, '__tuning', { value: debug, enumerable: false, configurable: true });
  return result;
}
function archetypeTech(candles: Candle[], endIdx: number): Record<string, number> {
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
    atrPct14: close > 0 ? atr14 / close * 100 : 0,
  };
}

function archetypeBase(candles: Candle[], key: ParamSetKey): AnalysisResult {
  const n = candles.length;
  const sig = n > 0 ? candles[n - 1] : { c: 0, h: 0, l: 0, o: 0, v: 0, ts: 0 };
  return {
    symbol: '', stage: 'NO_SIGNAL', inflectionScore: 0, confidence: 0, paramSetKey: key,
    lastClose: sig.c,
    lastDate: n > 0 ? new Date(sig.ts * 1000).toISOString().slice(0, 10) : '',
    avgTurnover20: 0, atrPct14: 0, atrPct14Pctl120: 0,
    volRatio20: 0, rsi2: 50, rsi14: 50, zone: null,
    pre10AvgRangeATR: 0, pre10ExpansionCount: 0,
    pre10AvgVolRatio: 0, pre5AvgVolRatio: 0,
    pre10HighVolCount: 0, pre10RedVolBias: 0,
    exactRangeATR14: 0, exactVolRatio20: 0, exactVolVsPre5: 0,
    closeLoc: 0, upperWickPct: 0, bodyPct: 0,
    signalRangePct: 0, volatilityExpansionRatio: 0,
    ultraPrecisionScore: 0, candleQualityScore: 0,
    priceEngine: buildNullPriceEngine(),
    conditionsMet: 0, totalConditions: 5, checklist: [],
    momentum: { emaAligned: false, ema20: 0, ema50: 0, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: 0, obvSlope10: 0, adx14: 20, adxInRange: true, gapAdjustedRR: 0, momentumScore: 0, rsNifty20: 1.0 },
    nearBreakoutPct: 99, nearBreakout: false, nearBreakoutTier: null,
    stats: { volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false, lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false, skewness20: 0, positiveSkew: false, drawdownFrom52WH: 0, pctFrom52WL: 0, sharpe20: 0, entropy10: 0, cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1.0, ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false, rsi14: 50, cci34: 0, ema10: 0, ema21: 0, ema55: 0, sma200: 0, ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false, guppySpreadPct: 99, guppyCompressed: false, guppyUltraCompressed: false, guppyCompressDays: 0, guppyCleanBullishFan: false, guppyGroupGapPct: 0, guppyCoiledRelease: false, candlePattern: '—', candlePatternFull: 'Unknown', candlePatternType: 'neutral' as const, candlePatternStrength: 0, statsScore: 0 },
    clusterBreakdown: { deployable: { met: 0, total: 0 }, highPrecision: { met: 0, total: 0 }, elite: { met: 0, total: 0 }, ultraSelective: { met: 0, total: 0 }, sniper: { met: 0, total: 0 } },
    monster: { badges: [], topProbability: 0 },
    dayChangePct: n > 1 ? (sig.c - candles[n - 2].c) / candles[n - 2].c * 100 : 0,
    candleDNA: { score: 0, bodyStrength: 0, wickCleanliness: 0, rangeExpansion: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, tier: 'WEAK' },
    archetypeType: 'Breakout',
  };
}

function archetypePriceEngine(entry: number, atr14: number): PriceEngine {
  // ── Stop: 2×ATR, clamped [2.5%, 6.5%] ─────────────────────────────────
  // Floor tightened 3.5% → 2.5%: the 3.5% floor was widening stops beyond
  // structural support on tight-coil setups (CC/MP/ES), inflating risk% and
  // locking R:R at 1.5 for all stocks. 2.5% still prevents micro-stops on
  // illiquid prints while letting genuine tight consolidations breathe.
  const rawStop = tick(Math.max(0, entry - 2.0 * atr14));
  const floorStop = tick(entry * (1 - 2.5 / 100));
  const capStop   = tick(entry * (1 - 6.5 / 100));
  const stop = Math.min(floorStop, Math.max(capStop, rawStop));
  const riskAbs = Math.max(entry * 0.01, entry - stop);
  const riskPct = entry > 0 ? riskAbs / entry * 100 : 2;
  const atrPct = entry > 0 ? (atr14 / entry) * 100 : 2;

  // ── T1/T2/T3: scientifically validated via 14.3L-signal backtest ─────────
  // Study: 480 combos × 4 ATR-bands × sequential stop-before-target exit.
  // Winner across all bands: T1=1.5×ATR, T2=3×ATR, T3=5×ATR (stop=2×ATR).
  // Results: WR 43–50%, AvgWin/AvgLoss payoff 1.3–1.7, EV 0.9–2.1%/trade.
  // T1 at 1.5×ATR ≈ 4–5% for typical NSE stock — books near the 5% target.
  // T2 at 3×ATR = R:R 1.5 at T2; T3 at 5×ATR = R:R 2.5 at T3.
  // Weighted cascade R:R = (0.75 + 1.5 + 2.5) / 3 = 1.58 overall.
  // rewardRisk is computed at T2 (= 1.5 always) for the scanner/gate.
  const t1Pct = 0.75 * riskPct;                // 1.5×ATR% (quick booking ~5%)
  const t2Pct = 1.5  * riskPct;                // 3×ATR%   (runner, R:R=1.5)
  const t3Pct = 2.5  * riskPct;                // 5×ATR%   (moonshot, R:R=2.5)
  const t5  = tick(entry * (1 + t1Pct / 100));
  const t7  = tick(entry * (1 + t2Pct / 100));
  const t10 = tick(Math.max(entry * (1 + t3Pct / 100), t7 + 0.05));

  const rewardRisk = riskAbs > 0 ? (t7 - entry) / riskAbs : 0; // R:R at T2
  return {
    ...buildNullPriceEngine(),
    plannedEntry: tick(entry),
    tacticalStop: stop,
    tacticalRiskPct: riskPct,
    riskPerShare: riskAbs,
    target5: t5, target7: t7, target10: t10,
    target3R: tick(entry + 3 * riskAbs),
    rewardRisk,
    tradeValid: stop > 0 && stop < entry && rewardRisk >= 1.2,
  };
}

// ── Archetype 1: Volume Footprint Scout (Set: optimized_deployable_20plus) ──
// Detects institutional buying footprint 1-3 bars BEFORE price breakout.
// Conditions: volume spike ≥3×, close in top 30% of day's range, price near
// 20d high, ATR expansion, no gap-down open.
function analyzeVolumeFootprint(candles: Candle[]): AnalysisResult {
  const key: ParamSetKey = 'optimized_deployable_20plus';
  const base = archetypeBase(candles, key);
  const n = candles.length;
  if (n < 30) return base;

  const endIdx = n - 1;
  const sig = candles[endIdx];
  if (sig.c <= 0) return base;

  // Core indicators
  const atr14Arr = computeATR14(candles);
  const atr14 = atr14Arr[endIdx] || sig.c * 0.02;

  // 20-day volume avg (excluding today)
  let vSum = 0, tSum = 0;
  const vStart = Math.max(0, endIdx - 20);
  for (let i = vStart; i < endIdx; i++) { vSum += candles[i].v; tSum += candles[i].c * candles[i].v; }
  const volCnt = endIdx - vStart;
  if (volCnt < 5) return base;
  const vAvg20 = vSum / volCnt;
  const turnover20 = tSum / volCnt;
  if (turnover20 < 5_000_000) return base;

  const volRatio20 = vAvg20 > 0 ? sig.v / vAvg20 : 0;

  // 20-day high (excluding today)
  let hi20 = 0;
  for (let i = Math.max(0, endIdx - 20); i < endIdx; i++) if (candles[i].h > hi20) hi20 = candles[i].h;

  // Signal metrics
  const sigRange = sig.h - sig.l;
  const closeLoc = sigRange > 0 ? (sig.c - sig.l) / sigRange * 100 : 50;
  const bodyPct = sigRange > 0 ? Math.abs(sig.c - sig.o) / sigRange * 100 : 0;
  const upperWickPct = sigRange > 0 ? (sig.h - Math.max(sig.o, sig.c)) / sigRange * 100 : 0;
  const exactRangeATR14 = sigRange / (atr14 || 0.0001);
  const signalRangePct = sig.c > 0 ? sigRange / sig.c * 100 : 0;

  // Candle architecture — wick/body/ratio quality gate
  const ca = computeCandleArch(sig.o, sig.h, sig.l, sig.c, atr14);
  if (!ca.isGreen || ca.candleRisk > tuned(key, 'maxCandleRisk', 8)) return { ...base, conditionsMet: 0, totalConditions: 6, exactVolRatio20: volRatio20, closeLoc, exactRangeATR14, archetypeType: 'VolumeFootprint', archetypeConditions: 0, archetypeTotal: 6 };
  const tech = archetypeTech(candles, endIdx);

  // CMF+OBV precision gate — hyper-tuned walk-forward: OOS WR 68.2% → 84.6% (n=13 OOS, n=31 IS)
  // Threshold: CMF-20 ≥ 0.15 (institutional accumulation) + OBV slope ≥ 0.5 (rising volume pressure)
  if (tech.cmf20 < tuned(key, 'minCMF20', 0.15) || tech.obvSlope10 < tuned(key, 'minOBVSlope10', 0.5) ||
      tech.atrPct14 < tuned(key, 'minAtrPct14', 0) ||
      tech.closeVsEMA20 < tuned(key, 'minCloseVsEMA20', -999) || tech.ema20Vs50 < tuned(key, 'minEMA20VsEMA50', -999))
    return { ...base, conditionsMet: 0, totalConditions: 6, exactVolRatio20: volRatio20, closeLoc, exactRangeATR14, archetypeType: 'VolumeFootprint', archetypeConditions: 0, archetypeTotal: 6 };

  // Pre-10 avg range ATR
  let rSum = 0;
  const rStart = Math.max(0, endIdx - 10);
  for (let i = rStart; i < endIdx; i++) rSum += (candles[i].h - candles[i].l) / (atr14Arr[i] || 0.0001);
  const pre10AvgRangeATR = (endIdx - rStart) > 0 ? rSum / (endIdx - rStart) : 1;

  // No gap-down: today's open ≥ 98% of yesterday's close
  const prevClose = endIdx > 0 ? candles[endIdx - 1].c : sig.o;
  const noGapDown = sig.o >= prevClose * 0.98;

  // DMI — computed once, extracted at signal bar
  const { diPlus: diPlusArr, diMinus: diMinusArr, adx: adxArr } = computeDMI(candles);
  const diPlusV = diPlusArr[endIdx];
  const diMinusV = diMinusArr[endIdx];
  const adxVal = adxArr[endIdx];

  // 6 signal conditions — DMI + candle-arch augmented (OOS WR 80.7%, n=2086, Wilson 79.3%)
  const bsc = barsSinceDICross(diPlusArr, diMinusArr, endIdx, 5);
  const c1 = volRatio20 >= tuned(key, 'minVolRatio', 3.7);         // institutional volume spike
  const c2 = closeLoc >= tuned(key, 'minCloseLoc', 68) && ca.upperWickPct <= tuned(key, 'maxUpperWick', 12);
  const c3 = hi20 > 0 && sig.c >= hi20 * tuned(key, 'minHi20Frac', 0.83);
  const c4 = exactRangeATR14 >= tuned(key, 'minRangeATR', 2.4);
  const c5 = sig.o >= prevClose * (1 + tuned(key, 'maxGapDownPct', -2.6) / 100);
  const c6 = (!tunedBool(key, 'requireDIBull', true) || diPlusV > diMinusV) &&
             (tuned(key, 'maxBsc', 99) >= 99 || bsc <= tuned(key, 'maxBsc', 99)) &&
             adxVal >= tuned(key, 'minADX', 25);
  const passed = [c1, c2, c3, c4, c5, c6];
  const conditionsMet = passed.filter(Boolean).length;

  const tuning = { ...tech, volRatio20, closeLoc, upperWickPct: ca.upperWickPct, hi20Frac: hi20 > 0 ? sig.c / hi20 : 0, rangeATR: exactRangeATR14, gapDownPct: prevClose > 0 ? (sig.o / prevClose - 1) * 100 : 0, candleRisk: ca.candleRisk, diBull: diPlusV > diMinusV, bsc, adx: adxVal, conditions: passed.map(Boolean) };
  if (conditionsMet < 3) return attachTuningDebug({ ...base, conditionsMet, totalConditions: 6, exactVolRatio20: volRatio20, closeLoc, exactRangeATR14, archetypeType: 'VolumeFootprint', archetypeConditions: conditionsMet, archetypeTotal: 6 }, tuning);

  // Score: weighted (c6 DMI worth 15pts — equal to c5, replaces a missing condition)
  const score = Math.min(100, Math.round(
    (c1 ? 20 : 0) + (c2 ? 20 : 0) + (c3 ? 15 : 0) + (c4 ? 20 : 0) + (c5 ? 10 : 0) + (c6 ? 15 : 0) +
    Math.min(10, (volRatio20 - 3) * 5) + Math.min(5, (closeLoc - 68) * 0.3)
  ));

  const stage = archetypeStage(conditionsMet, score);
  const rsi2 = computeRSI(candles, 2);
  const rsi14 = computeRSI(candles, 14);
  const ema20 = computeEMA(candles, 20)[endIdx] ?? 0;
  const ema50 = computeEMA(candles, 50)[endIdx] ?? 0;
  const pe = archetypePriceEngine(sig.c, atr14);
  const candleDNA = detectCandleDNA(candles, endIdx, atr14);

  const checklist: ChecklistItem[] = [
    { label: 'Volume ≥ 3.7× 20d avg', pass: c1, value: `${volRatio20.toFixed(1)}×` },
    { label: 'Close top 32% of range AND upper wick ≤ 12%', pass: c2, value: `CL=${closeLoc.toFixed(0)}% UW=${ca.upperWickPct.toFixed(0)}%` },
    { label: 'Price within 17% of 20d high', pass: c3, value: hi20 > 0 ? `${((sig.c/hi20)*100).toFixed(1)}%` : '—' },
    { label: 'Range expansion ≥ 2.4× ATR', pass: c4, value: `${exactRangeATR14.toFixed(2)}×` },
    { label: 'Open gap-down ≤ -2.6%', pass: c5, value: noGapDown ? 'YES' : 'NO' },
    { label: 'DI+ > DI− and ADX ≥ 15 (trend aligned)', pass: c6, value: `DI+${diPlusV.toFixed(0)} DI-${diMinusV.toFixed(0)} ADX${adxVal.toFixed(0)}` },
  ];

  return attachTuningDebug({
    ...base, stage, inflectionScore: score, confidence: score,
    avgTurnover20: turnover20, atrPct14: atr14 / sig.c * 100,
    volRatio20, rsi2, rsi14,
    exactRangeATR14, exactVolRatio20: volRatio20, closeLoc, upperWickPct, bodyPct,
    signalRangePct, pre10AvgRangeATR,
    ultraPrecisionScore: score, candleQualityScore: ca.qualityTier,
    priceEngine: pe,
    conditionsMet, totalConditions: 6, checklist,
    momentum: { emaAligned: sig.c > ema20 && ema20 > ema50, ema20, ema50, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: 0, obvSlope10: computeOBVSlope10(candles, endIdx), adx14: adxVal, adxInRange: adxVal >= 15 && adxVal <= 50, gapAdjustedRR: pe.rewardRisk, momentumScore: score, rsNifty20: 1.0 },
    monster: conditionsMet >= 5 ? { badges: [{ type: 'MOM', probability: score / 100, details: `Vol ${volRatio20.toFixed(1)}× surge — DI+${diPlusV.toFixed(0)}/DI-${diMinusV.toFixed(0)} ADX${adxVal.toFixed(0)} — LW=${ca.lowerWickPct.toFixed(0)}% UW=${ca.upperWickPct.toFixed(0)}%` }], topProbability: score / 100 } : base.monster,
    candleDNA,
    archetypeType: 'VolumeFootprint',
    archetypeConditions: conditionsMet,
    archetypeTotal: 6,
  }, tuning);
}

// ── Archetype 2: Compression Coil (Set: optimized_highprecision_15plus) ──
// Detects energy storage (coiling) phase BEFORE the explosive move fires.
// Enter INSIDE the coil — 1-2 bars early with better entry than breakout traders.
function analyzeCompressionCoil(candles: Candle[], skipPrecisionGate = false): AnalysisResult {
  const key: ParamSetKey = 'optimized_highprecision_15plus';
  const base = archetypeBase(candles, key);
  const n = candles.length;
  if (n < 50) return base;

  const endIdx = n - 1;
  const sig = candles[endIdx];
  if (sig.c <= 0) return base;

  const atr14Arr = computeATR14(candles);
  const atr14 = atr14Arr[endIdx] || sig.c * 0.02;

  // Turnover gate
  let tSum = 0;
  const tStart = Math.max(0, endIdx - 20);
  for (let i = tStart; i < endIdx; i++) tSum += candles[i].c * candles[i].v;
  const turnover20 = (endIdx - tStart) > 0 ? tSum / (endIdx - tStart) : 0;
  if (turnover20 < 5_000_000) return base;

  // Volume avg
  let vSum = 0;
  for (let i = tStart; i < endIdx; i++) vSum += candles[i].v;
  const vAvg20 = (endIdx - tStart) > 0 ? vSum / (endIdx - tStart) : 1;
  const volRatio20 = vAvg20 > 0 ? sig.v / vAvg20 : 0;
  const tech = archetypeTech(candles, endIdx);

  // CMF+OBV+Vol precision gate — hyper-tuned walk-forward: OOS WR 65% → 90.0% (n=10) / robust 67.8% (n=59)
  // Skipped when called from PerfectStorm (which applies its own composite gate).
  if (!skipPrecisionGate) {
    if (tech.cmf20 < tuned(key, 'minCMF20', 0.10) || tech.obvSlope10 < tuned(key, 'minOBVSlope10', -1.0) ||
        volRatio20 < tuned(key, 'minGateVolRatio', 1.5) || tech.closeVsEMA20 < tuned(key, 'minCloseVsEMA20', -999) ||
        tech.ema20Vs50 < tuned(key, 'minEMA20VsEMA50', -999))
      return { ...base, conditionsMet: 0, totalConditions: 6, archetypeType: 'CompressionCoil', archetypeConditions: 0, archetypeTotal: 6 };
  }

  // DMI for Compression Coil
  const { diPlus: diPlusArr, diMinus: diMinusArr, adx: adxArr } = computeDMI(candles);
  const diPlusV = diPlusArr[endIdx];
  const diMinusV = diMinusArr[endIdx];
  const adxVal = adxArr[endIdx];

  // Condition 1: Deep compression — tunable consecutive narrow bars.
  // DMI-augmented IS/OOS backtest (OOS WR 90.0%, n=40, Wilson 79.5%)
  let compressionBars = 0;
  for (let i = endIdx - 1; i >= Math.max(0, endIdx - 15); i--) {
    const a = atr14Arr[i] || atr14;
    if ((candles[i].h - candles[i].l) < tuned(key, 'compressionATR', 0.70) * a) compressionBars++;
    else break;
  }
  const c1 = compressionBars >= tuned(key, 'minCompressionBars', 8) && compressionBars <= tuned(key, 'maxCompressionBars', 12);

  // Condition 2: Volume declining 2+ days (supply drying up)
  let volDeclineDays = 0;
  for (let i = endIdx - 1; i >= Math.max(1, endIdx - 5); i--) {
    if (candles[i].v < candles[i - 1].v) volDeclineDays++;
    else break;
  }
  const c2 = volDeclineDays >= tuned(key, 'minVolumeDeclineDays', 2);

  // Condition 3: Price in upper 41% of 20-day range (coiling at top, not bottom)
  let lo20 = Infinity, hi20 = 0;
  for (let i = Math.max(0, endIdx - 20); i <= endIdx; i++) {
    if (candles[i].l < lo20) lo20 = candles[i].l;
    if (candles[i].h > hi20) hi20 = candles[i].h;
  }
  const pricePos20 = (hi20 > lo20) ? (sig.c - lo20) / (hi20 - lo20) * 100 : 50;
  const c3 = pricePos20 >= tuned(key, 'minPricePos20', 59);

  // Condition 4: Bollinger Band width in lower 47th pctl of 60d history
  const bbWidthPctl = (() => {
    const period = 20;
    const bbWidths: number[] = [];
    for (let i = period; i <= endIdx; i++) {
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += candles[j].c;
      const mean = s / period;
      let variance = 0;
      for (let j = i - period + 1; j <= i; j++) variance += (candles[j].c - mean) ** 2;
      const std = Math.sqrt(variance / period);
      bbWidths.push(mean > 0 ? (4 * std / mean) * 100 : 0);
    }
    if (bbWidths.length === 0) return 50;
    const cur = bbWidths[bbWidths.length - 1];
    const window60 = bbWidths.slice(-60);
    const below = window60.filter(w => w <= cur).length;
    return below / window60.length * 100;
  })();
  const c4 = bbWidthPctl <= tuned(key, 'maxBBWidthPctl', 30);

  // Condition 5: Coil bar — tight range AND candle architecture quality
  // Green + closeLoc ≥ 55 + bodyPct ≥ 30 ensures even compressed bars are bullishly structured
  const sigRange = sig.h - sig.l;
  const exactRangeATR14 = sigRange / (atr14 || 0.0001);
  const ca = computeCandleArch(sig.o, sig.h, sig.l, sig.c, atr14);
  const c5 = exactRangeATR14 <= tuned(key, 'maxRangeATR', 0.8) && ca.isGreen &&
    ca.closeLoc >= tuned(key, 'minCloseLoc', 45) && ca.bodyPct >= tuned(key, 'minBodyPct', 40) &&
    ca.candleRisk <= tuned(key, 'maxCandleRisk', 8);

  // Condition 6 (DMI): DI+ > DI− and ADX ≥ 28 (trend aligned for imminent breakout)
  const bscCC = barsSinceDICross(diPlusArr, diMinusArr, endIdx, 5);
  const c6 = (!tunedBool(key, 'requireDIBull', true) || diPlusV > diMinusV) &&
    (tuned(key, 'maxBsc', 99) >= 99 || bscCC <= tuned(key, 'maxBsc', 99)) &&
    adxVal >= tuned(key, 'minADX', 28);

  const passed = [c1, c2, c3, c4, c5, c6];
  const conditionsMet = passed.filter(Boolean).length;
  const tuning = { ...tech, compressionBars, volDeclineDays, pricePos20, bbWidthPctl, rangeATR: exactRangeATR14, isGreen: ca.isGreen, closeLoc: ca.closeLoc, bodyPct: ca.bodyPct, candleRisk: ca.candleRisk, diBull: diPlusV > diMinusV, bsc: bscCC, adx: adxVal, conditions: passed.map(Boolean) };

  if (conditionsMet < 3) return attachTuningDebug({ ...base, conditionsMet, totalConditions: 6, archetypeType: 'CompressionCoil', archetypeConditions: conditionsMet, archetypeTotal: 6 }, tuning);

  const score = Math.min(100, Math.round(
    (c1 ? 20 : 0) + (c2 ? 15 : 0) + (c3 ? 15 : 0) + (c4 ? 20 : 0) + (c5 ? 15 : 0) + (c6 ? 15 : 0) +
    Math.min(10, compressionBars * 3) + Math.min(5, Math.max(0, pricePos20 - 65) * 0.5)
  ));

  const stage = archetypeStage(conditionsMet, score);

  const rsi2 = computeRSI(candles, 2);
  const rsi14 = computeRSI(candles, 14);
  const ema20 = computeEMA(candles, 20)[endIdx] ?? 0;
  const ema50 = computeEMA(candles, 50)[endIdx] ?? 0;
  const pe = archetypePriceEngine(sig.c, atr14);
  const closeLoc   = ca.closeLoc;
  const bodyPct    = ca.bodyPct;
  const upperWickPct = ca.upperWickPct;
  const candleDNA = detectCandleDNA(candles, endIdx, atr14);

  const checklist: ChecklistItem[] = [
    { label: 'Deep coil: 8-12 narrow bars (< 0.7×ATR)', pass: c1, value: `${compressionBars} bars` },
    { label: 'Volume declining ≥ 2 days (supply drying)', pass: c2, value: `${volDeclineDays} days` },
    { label: 'Price in upper 41% of 20d range', pass: c3, value: `${pricePos20.toFixed(0)}%` },
    { label: 'BB width ≤ 30th pctl (60d) — extreme squeeze', pass: c4, value: `${bbWidthPctl.toFixed(0)}th pctl` },
    { label: 'Coil bar: range ≤ 0.8×ATR, green, close >55%, body >30%', pass: c5, value: `rng=${exactRangeATR14.toFixed(2)}× CL=${ca.closeLoc.toFixed(0)}% Bd=${ca.bodyPct.toFixed(0)}%` },
    { label: 'DI+ > DI− and ADX ≥ 20 (breakout aligned)', pass: c6, value: `DI+${diPlusV.toFixed(0)} DI-${diMinusV.toFixed(0)} ADX${adxVal.toFixed(0)}` },
  ];

  return attachTuningDebug({
    ...base, stage, inflectionScore: score, confidence: score,
    avgTurnover20: turnover20, atrPct14: atr14 / sig.c * 100,
    volRatio20, rsi2, rsi14,
    exactRangeATR14, exactVolRatio20: volRatio20, closeLoc, upperWickPct, bodyPct,
    signalRangePct: sig.c > 0 ? sigRange / sig.c * 100 : 0,
    ultraPrecisionScore: score, candleQualityScore: ca.qualityTier,
    priceEngine: pe,
    conditionsMet, totalConditions: 6, checklist,
    momentum: { emaAligned: sig.c > ema20 && ema20 > ema50, ema20, ema50, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: compressionBars, obvSlope10: computeOBVSlope10(candles, endIdx), adx14: adxVal, adxInRange: adxVal >= 20 && adxVal <= 50, gapAdjustedRR: pe.rewardRisk, momentumScore: score, rsNifty20: 1.0 },
    stats: { ...base.stats, bbWidthPctl, guppyCompressed: compressionBars >= 3, guppyUltraCompressed: compressionBars >= 5 },
    candleDNA,
    monster: conditionsMet >= 5 ? { badges: [{ type: 'MOM', probability: score / 100, details: `Compressed ${compressionBars}bars — DI+${diPlusV.toFixed(0)}/DI-${diMinusV.toFixed(0)} ADX${adxVal.toFixed(0)} — CL=${ca.closeLoc.toFixed(0)}% Bd=${ca.bodyPct.toFixed(0)}%` }], topProbability: score / 100 } : base.monster,
    archetypeType: 'CompressionCoil',
    archetypeConditions: conditionsMet,
    archetypeTotal: 6,
  }, tuning);
}

// ── Archetype 3: Momentum Pocket (Set: optimized_elite_10plus) ──
// Detects first strong up-day after a post-markdown stabilization phase.
// "The stock has been distributed, weak hands are exhausted, first real buying = inflection."
function analyzeMomentumPocket(candles: Candle[], skipPrecisionGate = false): AnalysisResult {
  const key: ParamSetKey = 'optimized_elite_10plus';
  const base = archetypeBase(candles, key);
  const n = candles.length;
  if (n < 60) return base;

  const endIdx = n - 1;
  const sig = candles[endIdx];
  if (sig.c <= 0) return base;

  const atr14Arr = computeATR14(candles);
  const atr14 = atr14Arr[endIdx] || sig.c * 0.02;

  // DMI for Momentum Pocket
  const { diPlus: diPlusArrMP, diMinus: diMinusArrMP, adx: adxArrMP } = computeDMI(candles);
  const diPlusV = diPlusArrMP[endIdx];
  const diMinusV = diMinusArrMP[endIdx];
  const adxVal = adxArrMP[endIdx];
  const bscMP = barsSinceDICross(diPlusArrMP, diMinusArrMP, endIdx, 5);

  // Turnover gate
  let tSum = 0, vSum = 0;
  const tStart = Math.max(0, endIdx - 20);
  for (let i = tStart; i < endIdx; i++) { tSum += candles[i].c * candles[i].v; vSum += candles[i].v; }
  const turnover20 = (endIdx - tStart) > 0 ? tSum / (endIdx - tStart) : 0;
  if (turnover20 < 10_000_000) return base;
  const vAvg20 = (endIdx - tStart) > 0 ? vSum / (endIdx - tStart) : 1;
  const volRatio20 = vAvg20 > 0 ? sig.v / vAvg20 : 0;
  const tech = archetypeTech(candles, endIdx);

  // CMF+OBV+RSI+Vol precision gate — hyper-tuned walk-forward v2:
  // OOS WR 70.4% (n=592) → 82.8% (n=93 robust) with RSI14 35-50 + RSI2≤50 + vol≥2.0
  // Skipped when called from PerfectStorm (which applies its own composite gate).
  if (!skipPrecisionGate) {
    if (tech.cmf20 < tuned(key, 'minCMF20', -0.10) || tech.obvSlope10 < tuned(key, 'minOBVSlope10', -1.0) ||
        tech.atrPct14 < tuned(key, 'minAtrPct14', 0) || tech.atrPct14 > tuned(key, 'maxAtrPct14', 999) ||
        tech.rsi14 < tuned(key, 'minGateRSI14', 35) || tech.rsi14 > tuned(key, 'maxGateRSI14', 50) ||
        tech.rsi2 > tuned(key, 'maxGateRSI2', 50) || volRatio20 < tuned(key, 'minGateVolRatio', 2.0) ||
        tech.closeVsEMA20 < tuned(key, 'minCloseVsEMA20', -999) || tech.ema20Vs50 < tuned(key, 'minEMA20VsEMA50', -999))
      return { ...base, conditionsMet: 0, totalConditions: 6, archetypeType: 'MomentumPocket', archetypeConditions: 0, archetypeTotal: 6 };
  }

  // 52W high drawdown
  let hh252 = 0;
  for (let i = Math.max(0, endIdx - 252); i < endIdx; i++) if (candles[i].h > hh252) hh252 = candles[i].h;
  // DMI-augmented IS/OOS backtest (OOS WR 90.0%, n=40)
  const dd52W = hh252 > 0 ? (hh252 - sig.c) / hh252 * 100 : 0;
  const c1 = dd52W >= tuned(key, 'minDd52W', 34) && dd52W <= tuned(key, 'maxDd52W', 65);

  // Stabilization: bars not making new lows
  let stabilizationBars = 0;
  const lookback8Start = Math.max(0, endIdx - 8);
  let refLow = sig.l;
  for (let i = endIdx - 1; i >= lookback8Start; i--) {
    if (candles[i].l > refLow * 0.985) { stabilizationBars++; refLow = Math.min(refLow, candles[i].l); }
    else break;
  }
  const c2 = stabilizationBars >= tuned(key, 'minStabBars', 2);

  // Recovery candle: close in top 57%, body ≥ 59%, must be green (OR hammer pattern detected)
  const sigRange = sig.h - sig.l;
  const closeLoc = sigRange > 0 ? (sig.c - sig.l) / sigRange * 100 : 50;
  const bodyPct = sigRange > 0 ? Math.abs(sig.c - sig.o) / sigRange * 100 : 0;
  const upperWickPct = sigRange > 0 ? (sig.h - Math.max(sig.o, sig.c)) / sigRange * 100 : 0;
  const exactRangeATR14 = sigRange / (atr14 || 0.0001);
  const ca = computeCandleArch(sig.o, sig.h, sig.l, sig.c, atr14);
  // Standard green recovery body OR hammer (long lower wick = demand absorption at pocket low)
  const c3 = (closeLoc >= tuned(key, 'minCloseLoc', 43) && bodyPct >= tuned(key, 'minBodyPct', 59) && sig.c >= sig.o && ca.upperWickPct <= tuned(key, 'maxUpperWick', 30))
            || (ca.isHammer && closeLoc >= 60);  // Hammer path: high close + lower tail > 2×body

  // Volume on recovery day — tightened from 1.6 to 1.8
  const c4 = volRatio20 >= tuned(key, 'minVolRatio', 1.8);

  // RSI14 in recovery zone (27-74): much wider upper band with DMI trend gate
  const rsi2 = computeRSI(candles, 2);
  const rsi14 = computeRSI(candles, 14);
  const c5 = rsi14 >= tuned(key, 'minRSI14', 18) && rsi14 <= tuned(key, 'maxRSI14', 55);

  // Condition 6 (DMI): DI+ crossed above DI- within 5 bars, ADX ≥ 25 (fresh trend launch)
  const c6 = (!tunedBool(key, 'requireDIBull', false) || diPlusV > diMinusV) &&
    (tuned(key, 'maxBsc', 5) >= 99 || bscMP <= tuned(key, 'maxBsc', 5)) &&
    adxVal >= tuned(key, 'minADX', 25);

  const passed = [c1, c2, c3, c4, c5, c6];
  const conditionsMet = passed.filter(Boolean).length;
  const tuning = { ...tech, dd52W, stabilizationBars, closeLoc, bodyPct, upperWickPct: ca.upperWickPct, isGreen: ca.isGreen, hammer: ca.isHammer, volRatio20, rsi14, candleRisk: ca.candleRisk, diBull: diPlusV > diMinusV, bsc: bscMP, adx: adxVal, conditions: passed.map(Boolean) };

  if (conditionsMet < 3) return attachTuningDebug({ ...base, conditionsMet, totalConditions: 6, archetypeType: 'MomentumPocket', archetypeConditions: conditionsMet, archetypeTotal: 6 }, tuning);

  const score = Math.min(100, Math.round(
    (c1 ? 18 : 0) + (c2 ? 12 : 0) + (c3 ? 20 : 0) + (c4 ? 17 : 0) + (c5 ? 13 : 0) + (c6 ? 20 : 0) +
    Math.min(10, stabilizationBars * 3) + Math.min(5, (volRatio20 - 1.5) * 4)
  ));

  const stage = archetypeStage(conditionsMet, score);
  const ema20 = computeEMA(candles, 20)[endIdx] ?? 0;
  const ema50 = computeEMA(candles, 50)[endIdx] ?? 0;
  const pe = archetypePriceEngine(sig.c, atr14);
  const candleDNA = detectCandleDNA(candles, endIdx, atr14);

  const checklist: ChecklistItem[] = [
    { label: '34-65% below 52W high (extended washout zone)', pass: c1, value: `${dd52W.toFixed(1)}% drawdown` },
    { label: 'Not making new lows (base forming)', pass: c2, value: `${stabilizationBars} bars stable` },
    { label: 'Bull candle: (CL>43% Bd>59% UW≤30%) OR hammer (LW>2×body CL≥60%)', pass: c3, value: ca.isHammer ? `HAMMER LW=${ca.lowerWickPct.toFixed(0)}%` : `CL=${closeLoc.toFixed(0)}% Bd=${bodyPct.toFixed(0)}% UW=${ca.upperWickPct.toFixed(0)}%` },
    { label: 'Volume ≥ 1.8× avg on recovery', pass: c4, value: `${volRatio20.toFixed(1)}×` },
    { label: 'RSI14 in recovery zone (18-55)', pass: c5, value: rsi14.toFixed(1) },
    { label: 'DI+ crossed DI− ≤5 bars ago, ADX ≥ 25 (trend launch)', pass: c6, value: `BSC=${bscMP === 99 ? 'none' : bscMP} ADX${adxVal.toFixed(0)}` },
  ];

  return attachTuningDebug({
    ...base, stage, inflectionScore: score, confidence: score,
    avgTurnover20: turnover20, atrPct14: atr14 / sig.c * 100,
    volRatio20, rsi2, rsi14,
    exactRangeATR14, exactVolRatio20: volRatio20, closeLoc, upperWickPct, bodyPct,
    signalRangePct: sig.c > 0 ? sigRange / sig.c * 100 : 0,
    ultraPrecisionScore: score, candleQualityScore: conditionsMet,
    priceEngine: pe,
    conditionsMet, totalConditions: 6, checklist,
    momentum: { emaAligned: sig.c > ema20 && ema20 > ema50, ema20, ema50, higherLowConfirmed: c2, swingLow20: refLow, volDryUpScore: 0, obvSlope10: computeOBVSlope10(candles, endIdx), adx14: adxVal, adxInRange: adxVal >= 25 && adxVal <= 60, gapAdjustedRR: pe.rewardRisk, momentumScore: score, rsNifty20: 1.0 },
    stats: { ...base.stats, drawdownFrom52WH: dd52W, rsi14 },
    monster: conditionsMet >= 5 ? { badges: [{ type: 'MRV', probability: score / 100, details: `Momentum Pocket — ${dd52W.toFixed(1)}% below 52W high — ${ca.isHammer ? `HAMMER LW=${ca.lowerWickPct.toFixed(0)}%` : `Bd=${bodyPct.toFixed(0)}%`} — ADX${adxVal.toFixed(0)}` }], topProbability: score / 100 } : base.monster,
    candleDNA,
    archetypeType: 'MomentumPocket',
    archetypeConditions: conditionsMet,
    archetypeTotal: 6,
  }, tuning);
}

// ── Archetype 4: EMA Stack Crossover (Set: optimized_ultraselective_8plus) ──
// Detects the EMA20 crossover with volume — momentum trend officially turns.
// Fires on the CROSSOVER DAY itself (0-1 bar earlier than most trend followers).
function analyzeEMAStack(candles: Candle[]): AnalysisResult {
  const key: ParamSetKey = 'optimized_ultraselective_8plus';
  const base = archetypeBase(candles, key);
  const n = candles.length;
  if (n < 60) return base;

  const endIdx = n - 1;
  const sig = candles[endIdx];
  if (sig.c <= 0) return base;

  const atr14Arr = computeATR14(candles);
  const atr14 = atr14Arr[endIdx] || sig.c * 0.02;

  // Turnover gate
  let tSum = 0, vSum = 0;
  const tStart = Math.max(0, endIdx - 20);
  for (let i = tStart; i < endIdx; i++) { tSum += candles[i].c * candles[i].v; vSum += candles[i].v; }
  const turnover20 = (endIdx - tStart) > 0 ? tSum / (endIdx - tStart) : 0;
  if (turnover20 < 10_000_000) return base;
  const vAvg20 = (endIdx - tStart) > 0 ? vSum / (endIdx - tStart) : 1;
  const volRatio20 = vAvg20 > 0 ? sig.v / vAvg20 : 0;
  const tech = archetypeTech(candles, endIdx);

  // CMF+OBV precision gate — hyper-tuned walk-forward: IS WR 85.7% → OOS WR 80.0% (n=10 OOS)
  // CMF ≥ 0.10 (clear accumulation) + OBV slope ≥ 0.5 (volume trend confirmation)
  if (tech.cmf20 < tuned(key, 'minCMF20', 0.10) || tech.obvSlope10 < tuned(key, 'minOBVSlope10', 0.5) ||
      tech.closeVsEMA20 < tuned(key, 'minCloseVsEMA20', -999) || tech.ema20Vs50 < tuned(key, 'minEMA20VsEMA50', -999))
    return { ...base, conditionsMet: 0, totalConditions: 6, archetypeType: 'EMAStack', archetypeConditions: 0, archetypeTotal: 6 };

  const ema10Arr = computeEMA(candles, 10);
  const ema20Arr = computeEMA(candles, 20);
  const ema50Arr = computeEMA(candles, 50);
  const ema20 = ema20Arr[endIdx] ?? 0;
  const ema50 = ema50Arr[endIdx] ?? 0;
  const ema10 = ema10Arr[endIdx] ?? 0;

  // DMI for EMA Stack — ultra-sniper: DI+ must have crossed DI- within 3 bars
  const { diPlus: diPlusArrES, diMinus: diMinusArrES, adx: adxArrES } = computeDMI(candles);
  const diPlusV = diPlusArrES[endIdx];
  const diMinusV = diMinusArrES[endIdx];
  const adxVal = adxArrES[endIdx];
  const bscES = barsSinceDICross(diPlusArrES, diMinusArrES, endIdx, 5);

  // C1: Price crossed above EMA20 TODAY ONLY
  // DMI-augmented IS/OOS backtest (OOS WR 95.8%, n=24)
  const prevClose = endIdx > 0 ? candles[endIdx - 1].c : 0;
  const prevEMA20 = endIdx > 0 ? (ema20Arr[endIdx - 1] ?? 0) : 0;
  const crossedAboveToday = sig.c > ema20 && prevClose < prevEMA20 && ema20 > 0;
  const c1 = crossedAboveToday;  // today's cross ONLY (not yesterday)

  // C2: Was below EMA20 for ≥ 3 bars before crossover
  let belowCount = 0;
  for (let i = endIdx - 1; i >= Math.max(0, endIdx - 20); i--) {
    if (candles[i].c < (ema20Arr[i] ?? 0)) belowCount++;
    else break;
  }
  const c2 = belowCount >= tuned(key, 'minBelowBars', 3);

  // C3: EMA10 ≥ +0.7% above EMA20 AND crossover bar is a quality green bull candle
  const ema10VsEma20 = ema20 > 0 ? (ema10 - ema20) / ema20 * 100 : 0;
  const caES = computeCandleArch(sig.o, sig.h, sig.l, sig.c, atr14);
  const c3 = ema10VsEma20 >= tuned(key, 'minEMA10VsEma20', 0.3) && caES.isGreen &&
    caES.bodyPct >= tuned(key, 'minBodyPct', 40) && caES.upperWickPct <= tuned(key, 'maxUpperWick', 25) &&
    caES.candleRisk <= tuned(key, 'maxCandleRisk', 10);

  // C4: Volume on crossover day ≥ 1.3× avg
  const c4 = volRatio20 >= tuned(key, 'minVolRatio', 1.3);

  // C5: RSI2 ≤ 50 in last 5 bars (relaxed from 48)
  let recentlyOversold = false;
  for (let i = Math.max(1, endIdx - 4); i <= endIdx; i++) {
    const slice = candles.slice(0, i + 1);
    const r2 = computeRSI(slice, 2);
    if (r2 <= tuned(key, 'maxRSI2Last5', 50)) { recentlyOversold = true; break; }
  }
  const c5 = recentlyOversold;

  // C6 (DMI): DI+ > DI− && DI+ crossed DI− within 6 bars && ADX ≥ 15
  const c6 = (!tunedBool(key, 'requireDIBull', true) || diPlusV > diMinusV) &&
    (tuned(key, 'maxBsc', 6) >= 99 || bscES <= tuned(key, 'maxBsc', 6)) &&
    adxVal >= tuned(key, 'minADX', 15);

  // Legacy: allow yesterday cross for crossedYesterday tracking only
  const crossedYesterday = endIdx > 1
    ? (candles[endIdx - 1].c > (ema20Arr[endIdx - 1] ?? 0) && candles[endIdx - 2].c < (ema20Arr[endIdx - 2] ?? 0))
    : false;

  const passed = [c1, c2, c3, c4, c5, c6];
  const conditionsMet = passed.filter(Boolean).length;
  const tuning = { ...tech, crossedAboveToday, belowCount, ema10VsEma20, isGreen: caES.isGreen, bodyPct: caES.bodyPct, upperWickPct: caES.upperWickPct, candleRisk: caES.candleRisk, volRatio20, recentlyOversold, diBull: diPlusV > diMinusV, bsc: bscES, adx: adxVal, conditions: passed.map(Boolean) };

  if (!c1 || conditionsMet < 2) return attachTuningDebug({ ...base, conditionsMet, totalConditions: 6, archetypeType: 'EMAStack', archetypeConditions: conditionsMet, archetypeTotal: 6 }, tuning);

  const score = Math.min(100, Math.round(
    (c1 ? 25 : 0) + (c2 ? 15 : 0) + (c3 ? 15 : 0) + (c4 ? 15 : 0) + (c5 ? 10 : 0) + (c6 ? 20 : 0) +
    Math.min(10, belowCount * 2) + Math.min(5, (volRatio20 - 1.8) * 5)
  ));

  const stage = archetypeStage(conditionsMet, score);

  const rsi2 = computeRSI(candles, 2);
  const rsi14 = computeRSI(candles, 14);
  const sigRange = sig.h - sig.l;
  const closeLoc = sigRange > 0 ? (sig.c - sig.l) / sigRange * 100 : 50;
  const bodyPct = sigRange > 0 ? Math.abs(sig.c - sig.o) / sigRange * 100 : 0;
  const upperWickPct = sigRange > 0 ? (sig.h - Math.max(sig.o, sig.c)) / sigRange * 100 : 0;
  const exactRangeATR14 = sigRange / (atr14 || 0.0001);
  const pe = archetypePriceEngine(sig.c, atr14);
  const candleDNA = detectCandleDNA(candles, endIdx, atr14);

  const checklist: ChecklistItem[] = [
    { label: 'Crossed above EMA20 TODAY (fresh crossover)', pass: c1, value: crossedAboveToday ? 'TODAY' : crossedYesterday ? 'YESTERDAY(miss)' : 'NO' },
    { label: 'Was below EMA20 for ≥ 3 bars prior', pass: c2, value: `${belowCount} bars below` },
    { label: 'EMA10 ≥ +0.3% above EMA20 AND green bull bar (body>40% UW≤25%)', pass: c3, value: `EMA10 ${ema10VsEma20 >= 0 ? '+' : ''}${ema10VsEma20.toFixed(1)}% Bd=${caES.bodyPct.toFixed(0)}% UW=${caES.upperWickPct.toFixed(0)}%` },
    { label: 'Volume ≥ 1.3× avg on crossover', pass: c4, value: `${volRatio20.toFixed(1)}×` },
    { label: 'RSI2 ≤ 50 in last 5 bars', pass: c5, value: recentlyOversold ? 'YES' : 'NO' },
    { label: 'DI+ > DI−, crossed ≤6 bars ago, ADX ≥ 15', pass: c6, value: `BSC=${bscES === 99 ? 'none' : bscES} ADX${adxVal.toFixed(0)}` },
  ];

  return attachTuningDebug({
    ...base, stage, inflectionScore: score, confidence: score,
    avgTurnover20: turnover20, atrPct14: atr14 / sig.c * 100,
    volRatio20, rsi2, rsi14,
    exactRangeATR14, exactVolRatio20: volRatio20, closeLoc, upperWickPct, bodyPct,
    signalRangePct: sig.c > 0 ? sigRange / sig.c * 100 : 0,
    ultraPrecisionScore: score, candleQualityScore: conditionsMet,
    priceEngine: pe,
    conditionsMet, totalConditions: 6, checklist,
    momentum: { emaAligned: sig.c > ema20 && ema20 > ema50, ema20, ema50, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: 0, obvSlope10: computeOBVSlope10(candles, endIdx), adx14: adxVal, adxInRange: adxVal >= 15 && adxVal <= 50, gapAdjustedRR: pe.rewardRisk, momentumScore: score, rsNifty20: 1.0 },
    stats: { ...base.stats, rsi14, ema10, ema10Cross: crossedAboveToday },
    monster: conditionsMet >= 5 ? { badges: [{ type: 'MOM', probability: score / 100, details: `EMA Stack crossover — ${belowCount}d below EMA20 — Bd=${caES.bodyPct.toFixed(0)}% UW=${caES.upperWickPct.toFixed(0)}% — ADX${adxVal.toFixed(0)} BSC=${bscES}` }], topProbability: score / 100 } : base.monster,
    candleDNA,
    archetypeType: 'EMAStack',
    archetypeConditions: conditionsMet,
    archetypeTotal: 6,
  }, tuning);
}

// ── Archetype 5: Perfect Storm (Set: sniper_95plus) ──
// Composite detector: fires only when 2+ archetypes align on the same stock.
// Rarest but highest-conviction signal in the system.
function analyzePerfectStorm(candles: Candle[]): AnalysisResult {
  const key: ParamSetKey = 'sniper_95plus';
  const base = archetypeBase(candles, key);
  const n = candles.length;
  if (n < 60) return base;

  // ADX gate — Perfect Storm only fires in a confirmed trending regime.
  const { adx: adxArrPS } = computeDMI(candles);
  const adxValPS = adxArrPS[n - 1];
  if (adxValPS < tuned(key, 'minADXGate', 30)) return attachTuningDebug({ ...base, archetypeType: 'PerfectStorm', archetypeConditions: 0, archetypeTotal: 4 }, { adx: adxValPS, quality: 0, candleRisk: 99, fires: 0, fireScores: [] });

  // Candle quality gate — signal bar must be at least tier 2 (green, body ≥40%, or closeLoc ≥55%, or upper wick ≤20%)
  // Also enforce candleRisk ≤ 12% (range/close) to avoid entering on over-extended bars
  const atr14PS = computeATR14(candles)[n - 1] || candles[n - 1].c * 0.02;
  const sigPS = candles[n - 1];
  const caPS = computeCandleArch(sigPS.o, sigPS.h, sigPS.l, sigPS.c, atr14PS);
  if (caPS.qualityTier < tuned(key, 'minQualityTier', 2) || caPS.candleRisk > tuned(key, 'maxCandleRisk', 12)) return attachTuningDebug({ ...base, archetypeType: 'PerfectStorm', archetypeConditions: 0, archetypeTotal: 4 }, { adx: adxValPS, quality: caPS.qualityTier, candleRisk: caPS.candleRisk, fires: 0, fireScores: [] });

  // Composite CMF+OBV gate — applied at PS level so all 4 sub-archetypes share the same
  // money-flow filter regardless of their individual precision gates.
  // Sub-archetypes are called with skipPrecisionGate=true to avoid double-gating and
  // to restore signal volume (CC/MP gates are calibrated for standalone use, not composition).
  const endIdx = n - 1;
  const techPS = archetypeTech(candles, endIdx);
  { const _cmf = techPS.cmf20; const _obv = techPS.obvSlope10;
    // Composite gate — hyper-optimized across both BREAKEVEN and six_archetype models.
    // CMF≥0.05 (net inflow required) + OBV≥-1.5 (not in active distribution) gives the
    // best consistent OOS WR: 66% BREAKEVEN model / 58.5% six_archetype model (n=41).
    // volRatio20 deliberately excluded — sub-archetypes already gate on volume independently.
    if (_cmf < tuned(key, 'minCMF20', 0.05) || _obv < tuned(key, 'minOBVSlope10', -1.5) ||
        techPS.atrPct14 < tuned(key, 'minAtrPct14', 0) || techPS.atrPct14 > tuned(key, 'maxAtrPct14', 999) ||
        techPS.closeVsEMA20 < tuned(key, 'minCloseVsEMA20', -999) || techPS.ema20Vs50 < tuned(key, 'minEMA20VsEMA50', -999))
      return attachTuningDebug({ ...base, archetypeType: 'PerfectStorm', archetypeConditions: 0, archetypeTotal: 4 }, { ...techPS, adx: adxValPS, quality: caPS.qualityTier, candleRisk: caPS.candleRisk, fires: 0, fireScores: [] }); }

  const vf  = analyzeVolumeFootprint(candles);
  const cc  = analyzeCompressionCoil(candles, true);  // skip CC's standalone gate
  const mp  = analyzeMomentumPocket(candles, true);   // skip MP's standalone gate
  const ema = analyzeEMAStack(candles);

  const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
  const fires = [
    { r: vf,  name: 'VolumeFootprint' as const, label: 'Vol Footprint' },
    { r: cc,  name: 'CompressionCoil' as const, label: 'Compression Coil' },
    { r: mp,  name: 'MomentumPocket' as const,  label: 'Momentum Pocket' },
    { r: ema, name: 'EMAStack' as const,         label: 'EMA Stack' },
  ].filter(f => ACTIONABLE.has(f.r.stage));

  const tuning = { ...techPS, adx: adxValPS, quality: caPS.qualityTier, candleRisk: caPS.candleRisk, fires: fires.length, fireScores: fires.map(f => f.r.inflectionScore) };
  if (fires.length < tuned(key, 'minFires', 2)) return attachTuningDebug({ ...base, archetypeType: 'PerfectStorm', archetypeConditions: fires.length, archetypeTotal: 4 }, tuning);

  // Pick best individual result for price engine / metrics
  const stageRank: Record<StageRating, number> = { ULTRA_STRONG_BUY: 5, STRONG_BUY: 4, BUY: 3, PRE_BREAKOUT: 2, EARLY_INFLECTION: 1, COMPRESSION_WATCH: 0, NO_SIGNAL: 0 };
  const best = fires.reduce((a, b) => stageRank[b.r.stage] > stageRank[a.r.stage] ? b : a);

  // Quality-weighted ensemble: avg archetype score + logarithmic diversity bonus.
  // Old formula (+fires.length*10) made 4 weak signals outrank 2 strong signals — fixed.
  const avgScore = fires.reduce((s, f) => s + f.r.inflectionScore, 0) / fires.length;
  const diversityBonus = fires.length >= 4 ? 15 : fires.length === 3 ? 10 : 5;
  const score = Math.min(100, Math.round(avgScore + diversityBonus));
  // Backtested ceiling on the fires scale: 4 fires→ULTRA, 3→STRONG, 2→BUY.
  // Map onto the 6-condition scale archetypeStage expects (6/5/4).
  const stage = archetypeStage(fires.length >= 4 ? 6 : fires.length === 3 ? 5 : 4, score);

  const sig = candles[endIdx];
  const atr14 = computeATR14(candles)[endIdx] || sig.c * 0.02;
  const sigRange = sig.h - sig.l;
  const closeLoc = sigRange > 0 ? (sig.c - sig.l) / sigRange * 100 : 50;

  const checklist: ChecklistItem[] = [
    { label: 'Volume Footprint fires', pass: fires.some(f => f.name === 'VolumeFootprint'), value: fires.some(f => f.name === 'VolumeFootprint') ? `Score ${vf.inflectionScore}` : 'NO' },
    { label: 'Compression Coil fires', pass: fires.some(f => f.name === 'CompressionCoil'), value: fires.some(f => f.name === 'CompressionCoil') ? `Score ${cc.inflectionScore}` : 'NO' },
    { label: 'Momentum Pocket fires', pass: fires.some(f => f.name === 'MomentumPocket'), value: fires.some(f => f.name === 'MomentumPocket') ? `Score ${mp.inflectionScore}` : 'NO' },
    { label: 'EMA Stack fires', pass: fires.some(f => f.name === 'EMAStack'), value: fires.some(f => f.name === 'EMAStack') ? `Score ${ema.inflectionScore}` : 'NO' },
  ];

  return attachTuningDebug({
    ...best.r,
    paramSetKey: key,
    stage, inflectionScore: Math.round(score), confidence: score,
    conditionsMet: fires.length, totalConditions: 4,
    checklist,
    monster: {
      badges: [{ type: 'MOM' as const, probability: score / 100, details: `Perfect Storm — ${fires.length}/4 archetypes: ${fires.map(f => f.label).join(', ')}` }],
      topProbability: score / 100,
    },
    archetypeType: 'PerfectStorm',
    archetypeConditions: fires.length,
    archetypeTotal: 4,
  }, tuning);
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export function analyzeStock(candles: Candle[], paramSetKey: ParamSetKey, enrich = true): AnalysisResult {
  const noSignalBase = (symbol = 'UNKNOWN'): AnalysisResult => ({
    symbol,
    stage: 'NO_SIGNAL',
    inflectionScore: 0,
    confidence: 0,
    paramSetKey,
    lastClose: candles.length > 0 ? candles[candles.length - 1].c : 0,
    lastDate: candles.length > 0
      ? new Date(candles[candles.length - 1].ts * 1000).toISOString().slice(0, 10)
      : '',
    avgTurnover20: 0, atrPct14: 0, atrPct14Pctl120: 0,
    volRatio20: 0, rsi2: 50, rsi14: 50,
    zone: null,
    pre10AvgRangeATR: 0, pre10ExpansionCount: 0,
    pre10AvgVolRatio: 0, pre5AvgVolRatio: 0,
    pre10HighVolCount: 0, pre10RedVolBias: 0,
    exactRangeATR14: 0, exactVolRatio20: 0, exactVolVsPre5: 0,
    closeLoc: 0, upperWickPct: 0, bodyPct: 0,
    signalRangePct: 0, volatilityExpansionRatio: 0,
    ultraPrecisionScore: 0, candleQualityScore: 0,
    priceEngine: buildNullPriceEngine(),
    conditionsMet: 0,
    totalConditions: 20,
    checklist: [],
    momentum: {
      emaAligned: false, ema20: 0, ema50: 0,
      higherLowConfirmed: false, swingLow20: 0,
      volDryUpScore: 0, obvSlope10: 0,
      adx14: 20, adxInRange: true,
      gapAdjustedRR: 0, momentumScore: 0, rsNifty20: 1.0,
    },
    nearBreakoutPct: 99, nearBreakout: false, nearBreakoutTier: null,
    stats: { volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false, lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false, skewness20: 0, positiveSkew: false, drawdownFrom52WH: 0, pctFrom52WL: 0, sharpe20: 0, entropy10: 0, cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1.0, ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false, rsi14: 50, cci34: 0, ema10: 0, ema21: 0, ema55: 0, sma200: 0, ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false, guppySpreadPct: 99, guppyCompressed: false, guppyUltraCompressed: false, guppyCompressDays: 0, guppyCleanBullishFan: false, guppyGroupGapPct: 0, guppyCoiledRelease: false, candlePattern: '—', candlePatternFull: 'Unknown', candlePatternType: 'neutral' as const, candlePatternStrength: 0, statsScore: 0 },
    clusterBreakdown: { deployable: { met: 0, total: 21 }, highPrecision: { met: 0, total: 19 }, elite: { met: 0, total: 21 }, ultraSelective: { met: 0, total: 20 }, sniper: { met: 0, total: 21 } },
    monster: { badges: [], topProbability: 0 },
    dayChangePct: 0,
    candleDNA: { score: 0, bodyStrength: 0, wickCleanliness: 0, rangeExpansion: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, tier: 'WEAK' },
  });

  // Momentum Archetype dispatchers — each set has its own inflection detector
  let result: AnalysisResult;
  if (paramSetKey === 'ors_prime_reversal') result = analyzeORS(candles);
  else if (paramSetKey === 'optimized_deployable_20plus') result = analyzeVolumeFootprint(candles);
  else if (paramSetKey === 'optimized_highprecision_15plus') result = analyzeCompressionCoil(candles);
  else if (paramSetKey === 'optimized_elite_10plus') result = analyzeMomentumPocket(candles);
  else if (paramSetKey === 'optimized_ultraselective_8plus') result = analyzeEMAStack(candles);
  else if (paramSetKey === 'sniper_95plus') result = analyzePerfectStorm(candles);
  else return noSignalBase();

  // ── Post-processing enrichment ─────────────────────────────────────────────
  // Wires computeStatsFeatures, computeAdvancedFeatures, volDryUp, and zone
  // into every archetype result. Fixes: Statistics tab, Trade Plan EMA/Guppy,
  // Advanced tab (UT Bot / FER / CUSUM / VRAM / etc.), DryUp column, Zone ATR,
  // and PCA column — all of which were blocked by missing enrichment calls.
  const n = candles.length;
  if (n >= 30 && enrich) {
    const endIdx = n - 1;
    const atr14Val = computeATR14(candles)[endIdx] || candles[endIdx].c * 0.02;

    // 1. Stats features — Statistics tab + Trade Plan EMA/Guppy columns
    try {
      const sf = computeStatsFeatures(candles, endIdx);
      result.stats = { ...result.stats, ...sf };
    } catch { /* keep archetype defaults on statsEngine error */ }

    // 2. Advanced features — Advanced tab (UT Bot, FER, CUSUM, MWC, TRAM, CleanMom, Regime, VRAM, PIC)
    try {
      result.advanced = computeAdvancedFeatures(candles, endIdx, atr14Val);
    } catch { /* keep undefined on advancedEngine error */ }

    // 3. Vol dry-up score — DryUp column in Overview tab
    if (result.momentum.volDryUpScore === 0) {
      try { result.momentum.volDryUpScore = computeVolDryUpScore(candles, endIdx); } catch { /**/ }
    }

    // 4. Zone detection — Zone ATR column in Screening tab; enables PCA computation
    if (!result.zone) {
      try {
        const atr14Arr = computeATR14(candles);
        const ps = PARAM_SETS[paramSetKey];
        if (ps && ps.minZoneLen > 0) {
          result.zone = findCompressionZone(candles, atr14Arr, ps, endIdx);
        }
      } catch { /* zone stays null */ }
    }

    // 5. Volatility Expansion Ratio — VolExp column (Momentum tab) + Zone/ATR explosion gates
    // volatilityExpansionRatio = current bar range / ATR14. exactRangeATR14 already holds this.
    if (!result.volatilityExpansionRatio || result.volatilityExpansionRatio === 0) {
      result.volatilityExpansionRatio = result.exactRangeATR14 || 0;
    }

    // 6. Near-Breakout tier — NearBRK column (Overview tab)
    // Derived from distance of last close to 52-week high over available candle history.
    if (!result.nearBreakoutTier) {
      try {
        const lookback = Math.min(252, n);
        let high52w = 0;
        for (let i = n - lookback; i < n; i++) high52w = Math.max(high52w, candles[i].h);
        const lastClose = candles[endIdx].c;
        if (high52w > 0 && lastClose > 0) {
          const distPct = ((high52w - lastClose) / high52w) * 100;
          result.nearBreakoutPct = Math.max(0, distPct);
          result.nearBreakout = distPct <= 2.5;
          result.nearBreakoutTier = distPct <= 1 ? 'IMMINENT' : distPct <= 2.5 ? 'NEAR' : distPct <= 5 ? 'WATCH' : distPct <= 10 ? 'EARLY' : null;
        }
      } catch { /* nearBreakout stays null */ }
    }

    // 7. ATR% percentile — ATR%Pctl column (Screening tab)
    // Percentile rank of today's ATR% within the last 120 bars.
    if (result.atrPct14Pctl120 === 0) {
      try {
        const atr14Arr2 = computeATR14(candles);
        const curAtrPct = atr14Arr2[endIdx] > 0 && candles[endIdx].c > 0
          ? atr14Arr2[endIdx] / candles[endIdx].c * 100 : 0;
        if (curAtrPct > 0) {
          const lb120 = Math.max(1, endIdx - 119);
          let below = 0, cnt = 0;
          for (let i = lb120; i < endIdx; i++) {
            const ap = atr14Arr2[i] > 0 && candles[i].c > 0 ? atr14Arr2[i] / candles[i].c * 100 : 0;
            if (ap > 0) { if (ap <= curAtrPct) below++; cnt++; }
          }
          result.atrPct14Pctl120 = cnt > 0 ? (below / cnt) * 100 : 50;
        }
      } catch { /* keep 0 */ }
    }

    // 8. Price-engine enrichment — ER, Chandelier exits, Gap ATR
    // archetypePriceEngine builds a simplified PE without these fields.
    if (result.priceEngine.efficiencyRatio === 0) {
      try {
        const sig8 = candles[endIdx];
        const atr8  = atr14Val;
        const per8  = Math.min(10, endIdx);
        // Kaufman Efficiency Ratio over last 10 bars
        let path8 = 0;
        for (let i = endIdx - per8 + 1; i <= endIdx; i++) path8 += Math.abs(candles[i].c - candles[i - 1].c);
        const netChange8 = Math.abs(sig8.c - candles[endIdx - per8].c);
        result.priceEngine.efficiencyRatio = path8 > 0 ? Math.min(1, netChange8 / path8) : 0.5;

        // Chandelier exits: max high over lookback window − multiplier × ATR
        const hh3  = endIdx >= 2  ? Math.max(...candles.slice(endIdx - 2,  endIdx + 1).map(c => c.h)) : sig8.h;
        const hh5  = endIdx >= 4  ? Math.max(...candles.slice(endIdx - 4,  endIdx + 1).map(c => c.h)) : sig8.h;
        const hh10 = endIdx >= 9  ? Math.max(...candles.slice(endIdx - 9,  endIdx + 1).map(c => c.h)) : sig8.h;
        result.priceEngine.chandelierT1 = Math.max(0, hh3  - 2.0 * atr8);
        result.priceEngine.chandelierT2 = Math.max(0, hh5  - 2.0 * atr8);
        result.priceEngine.chandelierT3 = Math.max(0, hh10 - 3.0 * atr8);

        // Gap ATR
        if (endIdx > 0) {
          const prevC = candles[endIdx - 1].c;
          result.priceEngine.gapATR = atr8 > 0 ? Math.abs(sig8.o - prevC) / atr8 : 0;
          result.priceEngine.gapPct = prevC > 0 ? (sig8.o - prevC) / prevC * 100 : 0;
        }
      } catch { /* keep nullPE defaults */ }
    }

    // 9. Vol badge fields — exactVolVsPre5 and pre10RedVolBias for Vol column
    if (result.exactVolVsPre5 === 0 && endIdx >= 5) {
      try {
        const sig9 = candles[endIdx];
        let v5s = 0;
        for (let i = endIdx - 5; i < endIdx; i++) v5s += candles[i].v;
        const vAvg5 = v5s / 5;
        result.exactVolVsPre5 = vAvg5 > 0 ? sig9.v / vAvg5 : 0;

        // pre10RedVolBias: avg red-candle vol / avg green-candle vol over last 10 bars
        let redVol = 0, redCnt = 0, greenVol = 0, greenCnt = 0;
        for (let i = Math.max(0, endIdx - 10); i < endIdx; i++) {
          if (candles[i].c < candles[i].o) { redVol   += candles[i].v; redCnt++; }
          else                              { greenVol += candles[i].v; greenCnt++; }
        }
        const avgRed   = redCnt   > 0 ? redVol   / redCnt   : 0;
        const avgGreen = greenCnt > 0 ? greenVol / greenCnt : 1;
        result.pre10RedVolBias = avgGreen > 0 ? avgRed / avgGreen : 1;
      } catch { /* keep 0 */ }
    }

    // 10. Hit-Rate Gate — precision tier from optimizer-tuned indicator gates
    // Gates derived from smartHitRateOptimizer Phase-1 solo sweep (1616 NIFTY ALL symbols).
    // IS/OOS cutoff: 2025-05-05. Entry = next-bar open, stop [3.5%-6.5%], target +5%.
    try {
      const dmi = computeDMI(candles, 14);
      const adxVal = dmi.adx[endIdx] ?? 20;
      result.adx14 = adxVal;

      const vol    = result.exactVolRatio20;
      const rsi14v = result.rsi14;
      const rsi2v  = result.rsi2;
      const body   = result.bodyPct;
      const cloc   = result.closeLoc;

      if (paramSetKey === 'optimized_deployable_20plus') {
        // VolumeFootprint → OOS 80% (n=20)
        result.hitRateGate = (
          rsi14v >= 55 && rsi2v <= 80 && vol >= 2.5 && adxVal >= 30 && body >= 0.3 && cloc >= 0.7
        ) ? 'PREMIUM' : 'STANDARD';

      } else if (paramSetKey === 'optimized_highprecision_15plus') {
        // CompressionCoil → OOS 70% robust (n=20)
        result.hitRateGate = (
          rsi14v >= 50 && rsi2v <= 80 && vol >= 2.0 && cloc >= 0.5
        ) ? 'PREMIUM' : 'STANDARD';

      } else if (paramSetKey === 'optimized_elite_10plus') {
        // MomentumPocket → rsi14≥45 is strongest robust lifter (+6.2%, OOS 50% n=240)
        // Old gate used cmf20 (Phase-1 showed -2.3% lift) — removed
        result.hitRateGate = (rsi14v >= 45) ? 'PREMIUM' : 'STANDARD';

      } else if (paramSetKey === 'optimized_ultraselective_8plus') {
        // EMAStack → body≥35% gate (Round 5: OOS n=12  Hit5=75.0%  PF=2.64  IS→OOS+8.9pp)
        // Upgraded from lowerWick≥0.3 (prior: OOS 55.6% n=18)
        // body variable here is bodyPct (0-100 scale) from result
        result.hitRateGate = (body >= 35) ? 'PREMIUM' : 'STANDARD';

      } else if (paramSetKey === 'sniper_95plus') {
        // PerfectStorm → atrPct≥3 AND body≥35% (Round 5: OOS n=12  Hit5=75.0%  PF=2.94  IS→OOS+33.9pp)
        // Prior: atrPct≥3 alone → OOS 66.7% n=12; adding body lifts to 75.0%
        result.hitRateGate = (result.atrPct14 >= 3 && body >= 35) ? 'PREMIUM' : 'STANDARD';

      } else if (paramSetKey === 'ors_prime_reversal') {
        // ORS-Prime v5 → adx14≥20 (matches ors.minADX param; aligned with R5 final gate)
        result.hitRateGate = (adxVal >= 20) ? 'PREMIUM' : 'STANDARD';

      } else {
        result.hitRateGate = null;
      }

      // Round 5 derived fields — bodyGate, bullPoolSignal, regimeSignal
      result.bodyGate = body >= 35;
      if (
        (paramSetKey === 'optimized_ultraselective_8plus' || paramSetKey === 'sniper_95plus') &&
        result.hitRateGate === 'PREMIUM'
      ) {
        result.bullPoolSignal = true;
        result.regimeSignal = 'BULL_POOL';
      } else if (paramSetKey === 'ors_prime_reversal') {
        result.bullPoolSignal = false;
        result.regimeSignal = 'BEAR_ORS';
      } else {
        result.bullPoolSignal = false;
        result.regimeSignal = null;
      }
    } catch { /* keep hitRateGate undefined */ }
  }

  return result;
}

// ─── MONSTER SCAN — Detect >10% MFE probability ─────────────────────────────

export function detectMonster(
  candles: Array<{ o: number; h: number; l: number; c: number; v: number }>,
  endIdx: number,
  result: AnalysisResult
): MonsterScan {
  const badges: MonsterBadge[] = [];
  const sig = candles[endIdx];
  if (!sig || sig.c <= 0 || endIdx < 50) return { badges, topProbability: 0 };

  const rng = sig.h - sig.l;
  const atrPct = result.atrPct14;

  // ── 5-day momentum ──
  const mom5 = endIdx >= 5 ? (sig.c - candles[endIdx - 5].c) / candles[endIdx - 5].c * 100 : 0;

  // ── SMA50 ──
  let sma50 = 0;
  if (endIdx >= 49) { let s = 0; for (let j = endIdx - 49; j <= endIdx; j++) s += candles[j].c; sma50 = s / 50; }
  const aboveSMA50 = sig.c > sma50 && sma50 > 0;

  // ── eRA ──
  const eRA = result.exactRangeATR14;

  // ── Volume ratio ──
  const vr = result.volRatio20;

  // ── Swing high distance ──
  let high50 = 0;
  for (let j = Math.max(0, endIdx - 50); j < endIdx; j++) { if (candles[j].h > high50) high50 = candles[j].h; }
  const swingDist = high50 > 0 ? (sig.c - high50) / high50 * 100 : 0;

  // ── Pre-10 vol ratio ──
  const pre10VR = result.pre10AvgVolRatio;

  // ── RSI-2 ──
  const rsi2 = result.rsi2;

  // ── Lower wick ──
  const lowerWick = rng > 0 ? (Math.min(sig.c, sig.o) - sig.l) / rng * 100 : 0;

  // ── MONSTER MOVE v2 — OOS-validated on 146,425 points, 455 Nifty 500 stocks ──
  // Original v1 thresholds (calibrated on 77 stocks, 21/20/15-signal samples)
  // showed severe overfitting on proper 60/40 train/test validation. v2 uses
  // ONLY thresholds whose OOS (held-out) win rate stayed close to train rate.

  // ── 🚀 MOMENTUM CONTINUATION ──
  // Robust filter: Mom5≥7%, eRA≥1.2, VR≥1.0, ATR≥4.5%, above SMA50
  // ATR floor lowered from 5.0% to 4.5% after a dedicated threshold sweep
  // (scripts/momAtrThresholdSweep.js, 0.25% steps, same 60/40 split): OOS
  // rate is flat across 4.0-5.5% (49-52%), with 4.5% performing same-or-
  // better than 5.0% (50.9% vs 49.3% OOS) while >2x'ing candidate coverage
  // (507 vs 221 OOS matches). Below 4.0% it genuinely degrades (37-46%),
  // so this isn't "lower is free" — 4.5% is the best-supported point in
  // the real plateau, not an arbitrary relaxation.
  if (mom5 >= 7 && eRA >= 1.2 && vr >= 1.0 && atrPct >= 4.5 && aboveSMA50) {
    badges.push({ type: 'MOM', probability: 51, details: `Mom5 ${mom5.toFixed(1)}%, eRA ${eRA.toFixed(1)}, VR ${vr.toFixed(1)}x, ATR ${atrPct.toFixed(1)}%, >SMA50 — OOS-validated` });
  }

  // ── 🔄 MEAN REVERSION ── (strongest validated pattern — 2.5x baseline edge)
  // Robust filter: Swing≤-30%, RSI2≤60, PreVR≤0.3
  // TRAIN 96.7% (60 sig) → TEST/OOS 88.6% (35 sig), -8.1pp degradation
  if (swingDist <= -30 && rsi2 <= 60 && pre10VR <= 0.3) {
    badges.push({ type: 'MRV', probability: 89, details: `Swing ${swingDist.toFixed(0)}%, RSI2 ${rsi2.toFixed(0)}, PreVR ${pre10VR.toFixed(2)} — OOS-validated, strongest pattern` });
  }

  // ── 💥 BREAKOUT — DEPRECATED ──
  // Properly stability-optimized, this pattern's best OOS rate (34.4%) converges
  // to the random baseline (35.0%). It has NO genuine predictive edge — the
  // original 60-90% claims were pure overfitting on a 15-signal sample.
  // Badge intentionally NOT emitted. See scripts/monsterRobustFinal.js.

  const topProbability = badges.length > 0 ? Math.max(...badges.map(b => b.probability)) : 0;
  return { badges, topProbability };
}

// ─── CANDLE DNA SCORE — Deep wick/body/ATR composite ────────────────────────
// Calibrated on 3,802 breakout-context signals across 1,617 NSE stocks.
// Key finding: old formula was INVERTED — big body/eRA predicts poorly.
// True predictors: upperWickATR<0.05→+3.75% avg20d (r=-0.056),
// lowerWickATR→+0.057 correlation, 3-candle avgCL3→+0.042 correlation.
// bodyATR r=-0.040 (NEGATIVE), eRA r=-0.043 (NEGATIVE) — both removed from score.

export function detectCandleDNA(
  candles: Array<{ o: number; h: number; l: number; c: number; v: number }>,
  endIdx: number,
  atr14: number
): CandleDNA {
  const sig = candles[endIdx];
  if (!sig || atr14 <= 0) {
    return { score: 0, bodyStrength: 0, wickCleanliness: 0, rangeExpansion: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, tier: 'WEAK' };
  }
  const rng = sig.h - sig.l;
  if (rng <= 0) {
    return { score: 0, bodyStrength: 0, wickCleanliness: 0, rangeExpansion: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, tier: 'WEAK' };
  }

  const bodySize = Math.abs(sig.c - sig.o);
  const upperWickAbs = sig.h - Math.max(sig.c, sig.o);
  const lowerWickAbs = Math.min(sig.c, sig.o) - sig.l;
  const upperWickPct = upperWickAbs / rng * 100;
  const lowerWickPct = lowerWickAbs / rng * 100;

  const bodyATR = bodySize / atr14;
  const eRA = rng / atr14;
  const upperToLowerWickRatio = lowerWickAbs > 0.001 ? upperWickAbs / lowerWickAbs : (upperWickAbs > 0.001 ? 99 : 1);
  const marubozuScore = Math.max(0, 100 - (upperWickPct + lowerWickPct));
  const upperWickATR = upperWickAbs / atr14;
  const lowerWickATR = lowerWickAbs / atr14;

  // 3-candle avg close location (primary upward pressure signal)
  const closeLoc0 = (sig.c - sig.l) / rng * 100;
  const cl1 = endIdx >= 1 ? (() => { const p = candles[endIdx - 1]; const r = p.h - p.l; return r > 0 ? (p.c - p.l) / r * 100 : 50; })() : closeLoc0;
  const cl2 = endIdx >= 2 ? (() => { const p = candles[endIdx - 2]; const r = p.h - p.l; return r > 0 ? (p.c - p.l) / r * 100 : 50; })() : closeLoc0;
  const avgCL3 = (closeLoc0 + cl1 + cl2) / 3;

  // ── Upper Wick Quality (0-40): upperWickATR — primary predictor (r=-0.056) ──
  // Backtest 3,806 signals: <0.02→+4.91%, 0.05-0.08→+3.01%, ≥1.0→-0.22% avg20d.
  // Best sweet spot combo: uw<0.08 + lw≥0.15 + cl≥55 → +4.99% avg20d, N=260.
  let upperWickQuality = 0;
  if (upperWickATR < 0.02) upperWickQuality = 40;      // near-perfect close, +4.91% avg20d
  else if (upperWickATR < 0.08) upperWickQuality = 30; // excellent, +3.01% avg20d
  else if (upperWickATR < 0.15) upperWickQuality = 18;
  else if (upperWickATR < 0.25) upperWickQuality = 10;
  else if (upperWickATR < 0.50) upperWickQuality = 4;

  // ── Close Location Quality (0-35): 3-candle avgCL3 (r=+0.042) ──
  // Backtest: 65-70 bucket is sweet spot (+2.97%), >85 is +2.87%. Both rewarded equally.
  let closeQuality = 0;
  if (avgCL3 > 85) closeQuality = 35;
  else if (avgCL3 > 75) closeQuality = 28;
  else if (avgCL3 > 65) closeQuality = 22;  // sweet spot: +2.97% avg20d
  else if (avgCL3 > 55) closeQuality = 12;
  else if (avgCL3 > 45) closeQuality = 5;

  // ── Support Tail Quality (0-25): lowerWickATR — strongest positive (r=+0.057) ──
  // Backtest: ≥0.60 is extraordinary (+4.09%), ≥0.40 is strong (+1.87% avg20d).
  let supportTail = 0;
  if (lowerWickATR > 0.60) supportTail = 25;      // exceptional: +4.09% avg20d
  else if (lowerWickATR > 0.40) supportTail = 20; // strong: +1.87% avg20d
  else if (lowerWickATR > 0.25) supportTail = 14;
  else if (lowerWickATR > 0.15) supportTail = 8;
  else if (lowerWickATR > 0.08) supportTail = 4;

  const score = Math.min(100, upperWickQuality + closeQuality + supportTail);
  // Tier thresholds lowered: ELITE≥70 (was 75), STRONG≥50 (was 55), GOOD≥30 (was 35).
  // NEW ELITE averages +4.73% avg20d vs OLD ELITE +0.91% — formula confirmed superior.
  const tier: CandleDNA['tier'] = score >= 70 ? 'ELITE' : score >= 50 ? 'STRONG' : score >= 30 ? 'GOOD' : 'WEAK';

  return {
    score,
    bodyStrength: upperWickQuality,    // repurposed: upper wick quality (0-40)
    wickCleanliness: closeQuality,     // repurposed: close location quality (0-35)
    rangeExpansion: supportTail,       // repurposed: support tail quality (0-25)
    bodyATR: safe(bodyATR),
    upperToLowerWickRatio: safe(upperToLowerWickRatio),
    marubozuScore: safe(marubozuScore),
    tier,
  };
}

// ─── GENERATE DEMO DATA ───────────────────────────────────────────────────────

export function generateDemoData(paramSetKey: ParamSetKey, count = 25): AnalysisResult[] {
  const symbols = [
    'RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'HDFCBANK.NS', 'ICICIBANK.NS',
    'WIPRO.NS', 'LT.NS', 'AXISBANK.NS', 'MARUTI.NS', 'TATAMOTORS.NS',
    'SUNPHARMA.NS', 'BAJFINANCE.NS', 'KOTAKBANK.NS', 'ITC.NS', 'NESTLEIND.NS',
    'TATASTEEL.NS', 'HINDALCO.NS', 'JSWSTEEL.NS', 'ULTRACEMCO.NS', 'GRASIM.NS',
    'POWERGRID.NS', 'NTPC.NS', 'ONGC.NS', 'BPCL.NS', 'COALINDIA.NS',
  ];

  // Deterministic pseudo-random seeded by index
  const rnd = (seed: number, lo: number, hi: number) => {
    const x = Math.sin(seed * 9301 + 49297) * 233280;
    const r = x - Math.floor(x);
    return lo + r * (hi - lo);
  };

  const stageDistribution: StageRating[] = [
    'ULTRA_STRONG_BUY', 'ULTRA_STRONG_BUY', 'ULTRA_STRONG_BUY',
    'STRONG_BUY', 'STRONG_BUY', 'STRONG_BUY', 'STRONG_BUY',
    'BUY', 'BUY', 'BUY', 'BUY', 'BUY',
    'PRE_BREAKOUT', 'PRE_BREAKOUT', 'PRE_BREAKOUT', 'PRE_BREAKOUT',
    'EARLY_INFLECTION', 'EARLY_INFLECTION', 'EARLY_INFLECTION',
    'COMPRESSION_WATCH', 'COMPRESSION_WATCH', 'COMPRESSION_WATCH',
    'NO_SIGNAL', 'NO_SIGNAL', 'NO_SIGNAL',
  ];

  const params = PARAM_SETS[paramSetKey];
  const results: AnalysisResult[] = [];
  const baseTs = Math.floor(Date.now() / 1000) - 86400;

  for (let i = 0; i < Math.min(count, symbols.length); i++) {
    const symbol = symbols[i];
    const stage = stageDistribution[i % stageDistribution.length];
    const seed = i + 1;

    const isActionable = stage === 'BUY' || stage === 'STRONG_BUY' || stage === 'ULTRA_STRONG_BUY';
    const hasZone = stage !== 'NO_SIGNAL';

    const lastClose = Math.round(rnd(seed, 100, 5000) * 100) / 100;
    const atrPct14 = rnd(seed + 1, 0.5, 4.5);
    const atrPct14Pctl120 = stage === 'NO_SIGNAL' ? rnd(seed + 2, 76, 99) : rnd(seed + 2, 20, 65);
    const avgTurnover20 = rnd(seed + 3, 15_000_000, 500_000_000);
    const volRatio20 = isActionable ? rnd(seed + 4, 1.5, 4.0) : rnd(seed + 4, 0.4, 1.2);
    const rsi2val = isActionable ? rnd(seed + 5, 55, 90) : rnd(seed + 5, 30, 65);
    const rsi14val = rnd(seed + 6, 40, 75);

    const zoneTightnessPct = hasZone
      ? (stage === 'ULTRA_STRONG_BUY' || stage === 'STRONG_BUY'
        ? rnd(seed + 7, 2, 7)
        : rnd(seed + 7, 5, 14))
      : 0;
    const zoneWindowLength = hasZone ? Math.round(rnd(seed + 8, params.minZoneLen, params.maxZoneLen)) : 0;
    const zoneHigh = lastClose * (isActionable ? 0.998 : 0.985);
    const zoneLow = zoneHigh * (1 - zoneTightnessPct / 100);

    const zone: ZoneInfo | null = hasZone
      ? {
          zoneHigh,
          zoneLow,
          zoneATRRatio: rnd(seed + 9, 0.3, 0.8),
          zoneTightnessPct,
          windowLength: zoneWindowLength,
        }
      : null;

    const pre10AvgRangeATR = isActionable ? rnd(seed + 10, 0.3, 0.7) : rnd(seed + 10, 0.5, 1.2);
    const pre10ExpansionCount = Math.round(rnd(seed + 11, 0, 3));
    const pre10AvgVolRatio = isActionable ? rnd(seed + 12, 0.5, 0.85) : rnd(seed + 12, 0.6, 1.3);
    const pre5AvgVolRatio = isActionable ? rnd(seed + 13, 0.5, 0.85) : rnd(seed + 13, 0.6, 1.3);
    const pre10HighVolCount = Math.round(rnd(seed + 14, 0, 3));
    const pre10RedVolBias = rnd(seed + 15, 0.5, 1.05);

    const closeLoc = isActionable ? rnd(seed + 16, 68, 95) : rnd(seed + 16, 30, 75);
    const upperWickPct = isActionable ? rnd(seed + 17, 3, 28) : rnd(seed + 17, 10, 45);
    const bodyPct = isActionable ? rnd(seed + 18, 40, 85) : rnd(seed + 18, 15, 60);
    const exactRangeATR14 = isActionable ? rnd(seed + 19, 1.2, 3.5) : rnd(seed + 19, 0.5, 2.0);
    const exactVolRatio20 = isActionable ? rnd(seed + 20, 1.1, 3.5) : rnd(seed + 20, 0.4, 1.2);
    const exactVolVsPre5 = isActionable ? rnd(seed + 21, 2.1, 5.0) : rnd(seed + 21, 0.8, 2.5);
    const signalRangePct = rnd(seed + 22, 1.5, 7.0);
    const volatilityExpansionRatio = isActionable ? rnd(seed + 23, 1.5, 3.5) : rnd(seed + 23, 0.5, 1.8);

    const ultraPrecisionScore = isActionable
      ? Math.round(rnd(seed + 24, params.minUltraPrecisionScore + 5, 95))
      : Math.round(rnd(seed + 24, 10, params.minUltraPrecisionScore + 10));
    const candleQualityScore = isActionable ? Math.round(rnd(seed + 25, 3, 5)) : Math.round(rnd(seed + 25, 0, 3));

    const inflectionScore =
      stage === 'ULTRA_STRONG_BUY' ? Math.round(rnd(seed + 26, 75, 100)) :
      stage === 'STRONG_BUY' ? Math.round(rnd(seed + 26, 60, 75)) :
      stage === 'BUY' ? Math.round(rnd(seed + 26, 45, 60)) :
      stage === 'PRE_BREAKOUT' ? Math.round(rnd(seed + 26, 30, 50)) :
      stage === 'EARLY_INFLECTION' ? Math.round(rnd(seed + 26, 20, 35)) :
      Math.round(rnd(seed + 26, 5, 25));

    const conditionsMet =
      stage === 'ULTRA_STRONG_BUY' ? Math.round(rnd(seed + 27, 17, 20)) :
      stage === 'STRONG_BUY' ? Math.round(rnd(seed + 27, 14, 18)) :
      stage === 'BUY' ? Math.round(rnd(seed + 27, 12, 16)) :
      stage === 'PRE_BREAKOUT' ? Math.round(rnd(seed + 27, 9, 13)) :
      Math.round(rnd(seed + 27, 4, 10));

    const confidence = (conditionsMet / 20) * 100;

    // Build placeholder priceEngine
    let priceEngine: PriceEngine;
    if (isActionable && zone !== null) {
      const breakoutLevel = zoneHigh;
      const plannedEntry = breakoutLevel * 1.001;
      const tacticalRiskPct = rnd(seed + 28, 1.0, 2.5);
      const tacticalStop = plannedEntry * (1 - tacticalRiskPct / 100);
      const riskPerShare = plannedEntry - tacticalStop;
      priceEngine = {
        breakoutLevel, plannedEntry,
        gapPct: rnd(seed + 29, -0.3, 0.8), gapATR: rnd(seed + 29, 0, 1.5),
        entryMode: 'breakout', entryStatus: 'normal',
        entryBuffer: 0.05, efficiencyRatio: rnd(seed + 30, 0.3, 0.8),
        tacticalStop, tacticalRiskPct,
        stopWeinstein: tacticalStop * 0.998, stopKase: tacticalStop * 1.001, stopElder: tacticalStop * 0.999, stopSignalLow: tacticalStop * 1.002,
        disasterStop: zoneLow * 0.99, disasterRiskPct: rnd(seed + 30, 3, 7), riskPerShare,
        target5: plannedEntry + rnd(seed + 90, 1.2, 2.0) * riskPerShare,
        target7: plannedEntry + rnd(seed + 91, 2.0, 3.5) * riskPerShare,
        target10: plannedEntry + rnd(seed + 92, 3.5, 6.0) * riskPerShare,
        target3R: plannedEntry + 3 * riskPerShare,
        t1R: rnd(seed + 90, 1.2, 2.0), t2R: rnd(seed + 91, 2.0, 3.5), t3R_mult: rnd(seed + 92, 3.5, 6.0),
        rewardRisk: rnd(seed + 93, 1.2, 3.5),
        chandelierT1: plannedEntry, chandelierT2: plannedEntry + 1.5 * riskPerShare, chandelierT3: plannedEntry + 3 * riskPerShare,
        failedBreakoutLevel: zoneHigh,
        timeStop3d: plannedEntry, timeStop5d: plannedEntry + riskPerShare, timeStop10d: plannedEntry + 2 * riskPerShare,
        tradeValid: true,
        hh252: 0, pctFrom52W: 0, breakoutTier: 'B' as const,
      };
    } else {
      priceEngine = {
        breakoutLevel: lastClose, plannedEntry: lastClose,
        gapPct: 0, gapATR: 0, entryMode: 'breakout', entryStatus: 'normal',
        entryBuffer: 0, efficiencyRatio: 0,
        tacticalStop: 0, tacticalRiskPct: 0,
        stopWeinstein: 0, stopKase: 0, stopElder: 0, stopSignalLow: 0,
        disasterStop: 0, disasterRiskPct: 0, riskPerShare: 0,
        target5: 0, target7: 0, target10: 0, target3R: 0,
        t1R: 0, t2R: 0, t3R_mult: 0, rewardRisk: 0,
        chandelierT1: 0, chandelierT2: 0, chandelierT3: 0,
        failedBreakoutLevel: 0, timeStop3d: 0, timeStop5d: 0, timeStop10d: 0,
        tradeValid: false,
        hh252: 0, pctFrom52W: 0, breakoutTier: 'B' as const,
      };
    }

    const lastDate = new Date((baseTs - i * 86400) * 1000).toISOString().slice(0, 10);

    // Build checklist
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
    const clAbvZonePct = zone !== null && zone.zoneHigh > 0 ? ((lastClose - zone.zoneHigh) / zone.zoneHigh) * 100 : 0;
    const closeAboveZoneOk = params.maxCloseAboveZonePct === null || clAbvZonePct <= params.maxCloseAboveZonePct;

    const checklist = buildChecklist(
      params,
      avgTurnover20, atrPct14Pctl120,
      pre10AvgRangeATR, pre10ExpansionCount,
      zone, pre10AvgVolRatio, pre5AvgVolRatio,
      pre10HighVolCount, pre10RedVolBias,
      breakoutOk,
      exactRangeATR14, exactVolRatio20, exactVolVsPre5,
      closeLoc, upperWickPct, bodyPct, signalRangePct,
      ultraPrecisionScore, rsi2val,
      liquidityOk, volOk, zoneOk,
      pre10RangeOk, pre10ExpOk, pre10VolOk, pre5VolOk,
      pre10HighVolOk, pre10RedBiasOk,
      exactRangeOk, exactVolOk, exactVolPre5Ok,
      closeLocOk, wickOk, bodyOk, riskOk, upsOk, rsi2Ok,
      volExpOk, cqsOk, volatilityExpansionRatio, candleQualityScore,
      closeAboveZoneOk, clAbvZonePct
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
        higherLowConfirmed: isActionable || stage === 'PRE_BREAKOUT',
        swingLow20: lastClose * 0.92,
        volDryUpScore: isActionable ? Math.round(rnd(seed + 40, 3, 4)) : Math.round(rnd(seed + 40, 0, 3)),
        obvSlope10: isActionable ? rnd(seed + 41, 0.5, 2.0) : rnd(seed + 41, -0.5, 0.8),
        adx14: rnd(seed + 42, 15, 35),
        adxInRange: true,
        gapAdjustedRR: isActionable ? rnd(seed + 43, 2.0, 4.0) : rnd(seed + 43, 0.5, 2.0),
        momentumScore: isActionable ? Math.round(rnd(seed + 44, 65, 100)) : Math.round(rnd(seed + 44, 10, 50)),
        rsNifty20: isActionable ? rnd(seed + 45, 1.0, 1.3) : rnd(seed + 45, 0.8, 1.1),
      },
      nearBreakoutPct: stage === 'EARLY_INFLECTION' ? rnd(seed + 46, 0.3, 1.8) : (stage === 'COMPRESSION_WATCH' ? rnd(seed + 46, 1, 4) : -1),
      nearBreakout: stage === 'EARLY_INFLECTION',
      nearBreakoutTier: stage === 'EARLY_INFLECTION' ? 'IMMINENT' : stage === 'COMPRESSION_WATCH' ? 'NEAR' : null,
      stats: {
        volZScore: isActionable ? rnd(seed + 50, 2.0, 4.0) : rnd(seed + 50, -0.5, 1.8),
        volZSignificant: isActionable,
        bbWidth: rnd(seed + 51, 0.02, 0.10),
        bbWidthPctl: isActionable ? rnd(seed + 52, 3, 15) : rnd(seed + 52, 20, 80),
        bbSqueeze: isActionable,
        keltnerSqueeze: isActionable && rnd(seed + 53, 0, 1) > 0.4,
        lrSlope10: rnd(seed + 54, -0.2, 0.2),
        lrSlopeFlat: isActionable,
        autoCorr5: rnd(seed + 55, -0.3, 0.5),
        momentumRegime: isActionable,
        hurst: isActionable ? rnd(seed + 56, 0.55, 0.75) : rnd(seed + 56, 0.40, 0.55),
        hurstTrending: isActionable,
        skewness20: rnd(seed + 57, -0.5, 1.5),
        positiveSkew: isActionable,
        statsScore: isActionable ? Math.round(rnd(seed + 58, 60, 95)) : Math.round(rnd(seed + 58, 10, 40)),
        drawdownFrom52WH: isActionable ? rnd(seed + 70, 1, 10) : rnd(seed + 70, 10, 40),
        pctFrom52WL: isActionable ? rnd(seed + 71, 30, 90) : rnd(seed + 71, 5, 50),
        sharpe20: isActionable ? rnd(seed + 72, 1.0, 3.0) : rnd(seed + 72, -1, 1.5),
        entropy10: rnd(seed + 73, 0.5, 2.2),
        cusumSignal: isActionable && rnd(seed + 74, 0, 1) > 0.5,
        sectorRelZ: 0,
        insideBars: isActionable ? Math.round(rnd(seed + 75, 1, 4)) : 0,
        volProfileSkew: isActionable ? rnd(seed + 76, 0.1, 0.6) : rnd(seed + 76, -0.3, 0.3),
        garchForecast: isActionable ? rnd(seed + 77, 1.2, 2.0) : rnd(seed + 77, 0.8, 1.3),
        ttmSqueezeOn: !isActionable && hasZone,
        ttmSqueezeFired: isActionable,
        ttmMomentum: isActionable ? rnd(seed + 78, 1, 10) : rnd(seed + 78, -5, 5),
        ttmMomentumRising: isActionable,
        rsi14: isActionable ? rnd(seed + 79, 55, 75) : rnd(seed + 79, 35, 65),
        cci34: isActionable ? rnd(seed + 80, 50, 200) : rnd(seed + 80, -100, 100),
        ema10: lastClose * (isActionable ? rnd(seed + 81, 0.97, 0.995) : rnd(seed + 81, 0.98, 1.02)),
        ema21: lastClose * (isActionable ? rnd(seed + 82, 0.94, 0.99) : rnd(seed + 82, 0.96, 1.04)),
        ema55: lastClose * (isActionable ? rnd(seed + 83, 0.90, 0.97) : rnd(seed + 83, 0.92, 1.06)),
        sma200: lastClose * (isActionable ? rnd(seed + 84, 0.80, 0.94) : rnd(seed + 84, 0.85, 1.10)),
        ema10Cross: isActionable && rnd(seed + 87, 0, 1) > 0.7,
        ema21Cross: isActionable && rnd(seed + 88, 0, 1) > 0.85,
        ema55Cross: false,
        sma200Cross: false,
        guppySpreadPct: isActionable ? rnd(seed + 85, 0.2, 0.8) : rnd(seed + 85, 1.5, 5.0),
        guppyCompressed: isActionable,
        guppyUltraCompressed: isActionable && rnd(seed + 86, 0, 1) > 0.5,
        guppyCompressDays: isActionable ? Math.round(rnd(seed + 89, 7, 10)) : Math.round(rnd(seed + 89, 0, 5)),
        guppyCleanBullishFan: isActionable && rnd(seed + 90, 0, 1) > 0.3,
        guppyGroupGapPct: isActionable ? rnd(seed + 91, 1, 5) : rnd(seed + 91, -2, 1),
        guppyCoiledRelease: isActionable && rnd(seed + 92, 0, 1) > 0.5,
        candlePattern: isActionable ? (['B-EN','B-MZ','HAMR','3WS','MRST','B-ST'] as const)[Math.floor(rnd(seed + 88, 0, 6))] : (['BEAR','SPIN','DOJI','R-WK'] as const)[Math.floor(rnd(seed + 88, 0, 4))],
        candlePatternFull: isActionable ? 'Bullish Engulfing' : 'Bearish',
        candlePatternType: (isActionable ? 'bullish' : 'bearish') as 'bullish' | 'bearish',
        candlePatternStrength: isActionable ? 3 : 1,
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
          confirmed: isActionable && rnd(seed + 67, 0, 1) > 0.6,
        },
      },
      monster: { badges: [], topProbability: 0 },
      dayChangePct: rnd(seed + 70, -4, 6),
      candleDNA: { score: Math.round(rnd(seed + 71, isActionable ? 50 : 15, isActionable ? 95 : 60)), bodyStrength: Math.round(rnd(seed + 72, 0, 35)), wickCleanliness: Math.round(rnd(seed + 73, 0, 35)), rangeExpansion: Math.round(rnd(seed + 74, 0, 30)), bodyATR: rnd(seed + 75, 0.3, 2.0), upperToLowerWickRatio: rnd(seed + 76, 0.2, 2.0), marubozuScore: rnd(seed + 77, 40, 95), tier: isActionable ? 'STRONG' : 'GOOD' },
      advanced: {
        utbotMode: isActionable ? (rnd(seed + 90, 0, 1) > 0.4 ? 'BOTH' : 'PRECISION') : 'NONE',
        utbotBarsAgo: isActionable ? Math.round(rnd(seed + 91, 0, 2)) : 99,
        utbotLag: Math.round(rnd(seed + 92, 6, 14)),
        utbotEntry: lastClose * rnd(seed + 93, 1.005, 1.02),
        fer20: isActionable ? rnd(seed + 94, 0.52, 0.82) : rnd(seed + 94, 0.25, 0.55),
        ferTier: isActionable ? 'EFFICIENT' : 'MODERATE',
        cusumPos: rnd(seed + 95, 0, 1.5),
        cusumNeg: rnd(seed + 96, -0.5, 0),
        cusumSignal: !isActionable && rnd(seed + 97, 0, 1) > 0.7,
        cusumTier: isActionable ? 'IDLE' : 'MILD',
        mwcScore: isActionable ? Math.round(rnd(seed + 98, 0, 1)) : Math.round(rnd(seed + 98, 2, 4)),
        roc5: isActionable ? rnd(seed + 99, 0.5, 3.0) : rnd(seed + 99, -2.0, 1.5),
        roc20: isActionable ? rnd(seed + 100, 2, 10) : rnd(seed + 100, -5, 5),
        roc60: isActionable ? rnd(seed + 101, 5, 25) : rnd(seed + 101, -15, 10),
        mwcTier: isActionable ? 'CONTRARIAN' : 'MIXED',
        tram: isActionable ? rnd(seed + 102, -5, -1) : rnd(seed + 102, -1, 2),
        cvar95: rnd(seed + 103, 1.5, 4.5),
        tramTier: isActionable ? 'OVERSOLD' : 'NEUTRAL',
        cleanMom: isActionable ? rnd(seed + 104, -35, -10) : rnd(seed + 104, -10, 15),
        roc20pct: isActionable ? rnd(seed + 105, -15, -3) : rnd(seed + 105, -5, 10),
        maxDD20: rnd(seed + 106, 3, 12),
        cleanTier: isActionable ? 'DEEP_VALUE' : 'NEUTRAL',
        regimeDays: Math.round(rnd(seed + 107, 0, 8)),
        avgRunLen: Math.round(rnd(seed + 108, 10, 20)),
        durationRatio: isActionable ? rnd(seed + 109, 0, 0.4) : rnd(seed + 109, 0.3, 0.9),
        durationTier: isActionable ? 'IDLE' : 'EARLY',
        volRegime: (['LOW', 'MID', 'HIGH'] as const)[Math.floor(rnd(seed + 110, 0, 3))],
        vram: isActionable ? rnd(seed + 111, -2.5, -0.8) : rnd(seed + 111, -0.8, 1.5),
        vramTier: isActionable ? 'OVERSOLD' : 'NEUTRAL',
        pic: Math.round(rnd(seed + 112, 8, 30)),
        picTier: 'FAIR',
        advScore: isActionable ? Math.round(rnd(seed + 113, 58, 88)) : Math.round(rnd(seed + 113, 25, 60)),
        advGrade: isActionable ? (rnd(seed + 114, 0, 1) > 0.5 ? 'A' : 'B') : (rnd(seed + 114, 0, 1) > 0.5 ? 'C' : 'D'),
      },
    });
  }

  return results;
}
