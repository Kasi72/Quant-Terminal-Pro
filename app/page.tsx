'use client';

import { useState, useRef, useCallback, useEffect, useMemo, Component, Fragment, type ReactNode } from 'react';

// Global error boundary — prevents white screen crashes
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: ReactNode }) { super(props); this.state = { hasError: false, error: '' }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error: error.message }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen bg-[#0a0c10] flex items-center justify-center">
          <div className="bg-slate-800 rounded-lg p-8 max-w-md text-center">
            <div className="text-3xl mb-3">⚠️</div>
            <h2 className="text-slate-200 font-bold mb-2">Something went wrong</h2>
            <p className="text-slate-400 text-sm mb-4">{this.state.error}</p>
            <button onClick={() => {
              try {
                // Preserve all user data — only nuke cache/candle keys
                const preserveKeys = [
                  'qtp_tracked_trades', 'qtp_tracked_trades_backup', 'qtp_tracked_trades_emergency',
                  'qtp_watchlist', 'qtp_sessions', 'qtp_signal_history', 'qtp_favorites',
                  'qtp_reviews', 'qtp_theme', 'qtp_paramSetKey', 'qtp_paramset', 'qtp_tg_config',
                ];
                const saved: Record<string, string | null> = {};
                for (const key of preserveKeys) saved[key] = localStorage.getItem(key);
                localStorage.clear();
                for (const key of preserveKeys) {
                  if (saved[key] != null) localStorage.setItem(key, saved[key]!);
                }
              } catch {}
              window.location.reload();
            }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium">
              Clear Data & Reload (trades preserved)
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import { fetchOHLCVClient } from '@/lib/fetchClient';
import { fetchSectorIndexData, computeSectorFlowScores, sectorFlowBadgeColor, sectorFlowLabel, sectorFlowConvictionBoost, sectorFlowCoverage, type SectorFlowScore, type SectorBreadth, type StockSeries } from '@/lib/sectorFlow';
import { fetchBulkFlowScores, bulkFlowConvictionBoost, bulkFlowLabel, bulkFlowColor, type BulkFlowScore, type BulkIngestionHealth } from '@/lib/bulkFlow';
import PBFBAnalyzer from '@/components/PBFBAnalyzer';
import {
  analyzeStock, analyzeStockMulti, analyzeStockWithLookback, computeRSvsNifty,
  computeClusterBreakdown, generateDemoData, detectMonster, PARAM_SETS, PARAM_SET_OPTIONS,
  computeSelfAdaptiveTrend,
  type AnalysisResult, type ParamSetKey, type StageRating, type Candle,
  type SelfAdaptiveTrendResult,
} from '@/lib/stockEngine';
import { NIFTY_PRESETS } from '@/lib/niftyPresets';
import { SECTOR_PRESETS } from '@/lib/sectorPresets';
import { THEMATIC_PRESETS } from '@/lib/thematicPresets';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { computeBrainInsights, getSetupQuality, getSymbolReliability, rankSignalsByBrainV2, getSetupQualityMatrix, getNSECalendarContext } from '@/lib/adaptiveBrain';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import brainPrior from '@/lib/brainPrior.json';
import {
  generateTradeSheet, tradeSheetToClipboard, computeWinRateStats, checkTradeStatus,
  detectMarketRegime, computeParamSensitivity, QUICK_FILTERS,
  type TrackedTrade, type TradeSheet, type QuickFilterKey, type RegimeInfo,
} from '@/lib/tradeOps';
import {
  loadWatchlist, saveWatchlist, loadSignalHistory, saveSignalHistory, updateSignalHistory,
  getSignalAge, exportZerodhaBasket, detectOverlap, generateSparklineSVG,
  type WatchlistItem, type SignalHistory,
} from '@/lib/workspace';
import {
  loadTradesFromCloud, loadTradesFromLocal, syncTradesToCloud,
  deleteTradeFromCloud, deleteAllTradesFromCloud,
} from '@/lib/tradeSync';
import {
  computeConviction, getSectorTag, computeScanStats, generateJournalMarkdown,
  deduplicateSymbols, type ScanStats,
} from '@/lib/signals';
import { computeExpectedValue, computeKelly } from '@/lib/statsEngine';
import {
  loadSessions, saveSession, deleteSession, deleteAllSessions, renameSession,
  exportSessions, importSessions, compareSessions, formatSessionTime,
  type ScanSession, type SessionDiff,
} from '@/lib/sessionManager';
import {
  buildEquityCurve, generateMonthlyReports, loadFavorites, saveFavorites,
  DEFAULT_RULES, loadReviews, saveReviews,
  type ScanFavorite, type TradeReview, type MonthlyReport,
} from '@/lib/performanceEngine';
import { validateTrade, applyValidation, computeRollingStats } from '@/lib/autoValidator';
import {
  computeMfeMaeScatter, computeExpectancyCurve, computeRDistribution,
  computeOptimization, computeSectorPerformance, computeConvictionCorrelation,
  computeEdgeDecay, computeDayOfWeek, computeRegimePerformance,
} from '@/lib/validationAnalytics';
import { computeAllPivots, checkTargetPivotConflict, type AllPivots } from '@/lib/pivotCalculator';
import { buildTearSheetData, exportTearSheetPDF, exportTearSheetXLSX } from '@/lib/tearSheet';
import { aggregateBacktest, computeTradeCosts, type BacktestResult, type BacktestTrade } from '@/lib/backtestEngine';
import { generateNarrative, type SignalNarrative } from '@/lib/narrativeEngine';
import { optimizePortfolio, type PortfolioResult } from '@/lib/portfolioOptimizer';
import {
  loadTelegramConfig, saveTelegramConfig, sendTelegramMessage,
  formatNewSignalAlert, formatTargetHitAlert, formatStoppedAlert,
  formatRegimeChangeAlert, formatDailySummaryAlert, formatSignalDecayAlert, formatValidationSummaryAlert,
  formatMomAlert,
  type TelegramConfig,
} from '@/lib/telegramAlerts';
import {
  computeMansfieldRS, rankRS, computeSectorRotation, checkWeeklyAlignment,
  backtestSignal, computePortfolioCorrelation, computeAnchoredVWAP,
  computeSignalDecay, getAdaptiveScanInterval, computeRiskOfRuin, checkEarningsProximity,
  type RSRanking, type SectorFlow, type TFAlignment, type HistBacktest,
  type CorrelationResult, type SignalDecay, type RiskOfRuin, type EarningsProximity,
} from '@/lib/advancedFeatures';

type ColDef = {
  key: string; label: string; width: number; align: 'left' | 'right' | 'center';
  fmt: (r: AnalysisResult) => string;
  numVal?: (r: AnalysisResult) => number;
  cellClass?: (r: AnalysisResult) => string;
  cellStyle?: (r: AnalysisResult) => React.CSSProperties | undefined;
  headerTipHtml?: string;
};

// ── Export helpers ──────────────────────────────────────────────────────────

// Safe column formatter for exports — catches errors from missing fields
// Volume-Thrust Close-High Onset Candle detection (backtested: 81.82% hit rate for >5% momentum run)
// Onset Candle v2 — OOS-validated on 6,982 actual breakout candles, 455 Nifty
// 500 stocks (60/40 train/test split). FINDING: nearly the entire v1 system
// (5 tiers, claimed 48-82% hit rates) underperformed the 62.0% baseline once
// properly validated — candle SHAPE barely matters once a real zone breakout
// has already occurred (max feature correlation r=0.09). Only one combo
// survived stability search: extreme range expansion.
type OnsetTier = 'STRONG' | null;
function detectOnsetCandle(r: AnalysisResult): OnsetTier {
  const cl = r.closeLoc, ra = r.exactRangeATR14, bp = r.bodyPct;
  const brk = r.zone !== null && r.lastClose > r.zone.zoneHigh * 1.001;
  if (!brk) return null;
  // Validated: eRA>=3.0, closeLoc>=75%, body>=50% -> 68.6% train, 65.5% OOS
  // (-3.1pp degradation, the most stable combo found). Thin sample (n=29 OOS).
  if (ra >= 3.0 && cl >= 75 && bp >= 50) return 'STRONG';
  return null;
}

// Breakout DNA v2 — same backtest as above. MARUBOZU/HAMMER/THRUST/COMPRESSION
// ALL underperformed the 62.0% baseline OOS (53-57% range) and have been
// removed. R-EXP survives only at much stricter thresholds than v1 claimed.
type BreakoutDNA = 'R-EXP' | null;
function detectBreakoutDNA(r: AnalysisResult): BreakoutDNA {
  if (!r.zone || r.lastClose <= r.zone.zoneHigh * 1.001) return null;
  const cl = r.closeLoc, bp = r.bodyPct, ra = r.exactRangeATR14;
  // Validated: eRA>=3.0, closeLoc>=75%, body>=50% -> 65.5% OOS (n=29, thin
  // but most stable of all archetypes tested; v1's eRA>=1.5 threshold
  // showed NO edge OOS at 54.2%, barely above its own train/test noise).
  if (ra >= 3.0 && cl >= 75 && bp >= 50) return 'R-EXP';
  return null;
}

// Clenow Momentum Score — exponential regression slope × R² (125-day lookback)
// Andreas Clenow "Stocks on the Move" methodology
// Backtested: top-25% Clenow breakouts have 54.1% hit rate vs 46.4% baseline
function computeClenowScore(candles: Candle[], lookback = 125): { score: number; r2: number; annReturn: number } {
  const n = candles.length;
  if (n < lookback + 1) return { score: 0, r2: 0, annReturn: 0 };
  const logP: number[] = [];
  for (let i = n - lookback; i < n; i++) {
    if (candles[i].c <= 0) return { score: 0, r2: 0, annReturn: 0 };
    logP.push(Math.log(candles[i].c));
  }
  let sX = 0, sY = 0, sXY = 0, sX2 = 0;
  for (let i = 0; i < lookback; i++) { sX += i; sY += logP[i]; sXY += i * logP[i]; sX2 += i * i; }
  const d = lookback * sX2 - sX * sX;
  if (d === 0) return { score: 0, r2: 0, annReturn: 0 };
  const slope = (lookback * sXY - sX * sY) / d;
  const intercept = (sY - slope * sX) / lookback;
  const yM = sY / lookback;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < lookback; i++) { ssRes += (logP[i] - (intercept + slope * i)) ** 2; ssTot += (logP[i] - yM) ** 2; }
  const r2 = ssTot > 0 ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;
  const annReturn = (Math.exp(slope * 252) - 1) * 100;
  return { score: annReturn * r2, r2, annReturn };
}

// Guppy Coiled Overlay — detects breakout from extreme Guppy compression zone
// When ALL Guppy EMAs were compressed (spread < 3%) during the zone → "💎 GUPPY COILED"
// Backtested: monster moves (OSWALAGRO +55%, NATIONALUM +48%, KTKBANK +25%)
// start from extreme Guppy compression → breakout with volume
function detectGuppyCoiled(r: AnalysisResult, candles: Candle[]): { coiled: boolean; avgSpread: number; minSpread: number } | null {
  if (!r.zone || !candles || candles.length < 70) return null;
  if (!['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage)) return null;
  const periods = [3, 5, 8, 10, 12, 15, 30, 35, 40, 45, 50, 60];
  const n = candles.length;
  const zoneLen = r.zone.windowLength;
  const zoneStart = n - 1 - zoneLen;
  if (zoneStart < 60) return null;
  const spreads: number[] = [];
  for (let checkIdx = zoneStart; checkIdx < n - 1; checkIdx += Math.max(1, Math.floor(zoneLen / 5))) {
    if (checkIdx < 60 || checkIdx >= n) continue;
    const emaVals: number[] = [];
    for (const p of periods) {
      let ema = candles[0].c;
      const k = 2 / (p + 1);
      for (let j = 1; j <= checkIdx; j++) ema = candles[j].c * k + ema * (1 - k);
      emaVals.push(ema);
    }
    const cmp = candles[checkIdx].c;
    if (cmp > 0) spreads.push(((Math.max(...emaVals) - Math.min(...emaVals)) / cmp) * 100);
  }
  if (spreads.length === 0) return null;
  const avgSpread = spreads.reduce((s, v) => s + v, 0) / spreads.length;
  const minSpread = Math.min(...spreads);
  // Backtested: avgSpread ≤5% + vol ≥1.5× = 50% hit rate vs 27.8% at old 3%
  // Volume confirmation: breakout candle volume vs 20-day avg
  const brkCandle = candles[n - 1];
  let avgVol = 0;
  for (let j = n - 21; j < n - 1; j++) { if (j >= 0) avgVol += (candles[j].v || 0); }
  avgVol /= 20;
  const volRatio = avgVol > 0 ? (brkCandle.v || 0) / avgVol : 0;
  const coiled = avgSpread <= 5.0 && volRatio >= 1.5;
  return { coiled, avgSpread, minSpread };
}

// Flag Pattern Overlay (Stock Bee definition — backtested: 71.8% hit, R:R 2.51)
// Detects if a qualifying breakout signal ALSO has a prior flag pole
// Pole: 8%+ gain in 1-5 days on vol≥2× | Flag: 3-10d tight consolidation
function detectFlagOverlay(r: AnalysisResult, candles: Candle[]): { hasFlag: boolean; poleGain: number; flagDays: number; measuredTarget: number } | null {
  if (!r.zone || !candles || candles.length < 25) return null;
  if (!['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage)) return null;
  const n = candles.length;
  const entry = r.lastClose;
  // The zone IS the flag. Check if there was a strong pole BEFORE the zone.
  const zoneLen = r.zone.windowLength;
  const poleEndIdx = n - 1 - zoneLen; // candle just before zone started
  if (poleEndIdx < 6) return null;
  // Check for pole: 8%+ gain in 1-5 days before the zone
  for (let pLen = 1; pLen <= 5; pLen++) {
    const pStart = poleEndIdx - pLen;
    if (pStart < 1) continue;
    const poleGain = ((candles[poleEndIdx].c - candles[pStart].c) / candles[pStart].c) * 100;
    if (poleGain < 8) continue;
    // Pole volume: avg during pole must be ≥ 2× prior 20d average
    let v20 = 0; for (let j = Math.max(0, pStart - 20); j < pStart; j++) v20 += candles[j].v; v20 /= 20;
    let poleVol = 0; for (let j = pStart; j <= poleEndIdx; j++) poleVol += candles[j].v;
    const poleAvgVol = poleVol / pLen;
    if (v20 > 0 && poleAvgVol < v20 * 1.5) continue; // relaxed to 1.5× for overlay
    // Zone retracement: zone low should not retrace more than 60% of pole
    const poleHigh = Math.max(...candles.slice(pStart, poleEndIdx + 1).map(c => c.h));
    const poleLow = candles[pStart].l;
    const poleRange = poleHigh - poleLow;
    if (poleRange <= 0) continue;
    const retrace = (poleHigh - r.zone.zoneLow) / poleRange * 100;
    if (retrace > 60) continue;
    // Measured move target
    const measuredTarget = entry + poleRange;
    return { hasFlag: true, poleGain, flagDays: zoneLen, measuredTarget };
  }
  return null;
}

// Trade Verdict v3 — re-derived on 2,914 completed trades, 456 Nifty 500 stocks.
// Stop: max(1.5×ATR, 5-bar swing low ×0.997) — phase-3 backtest winner (1.07L signal bars).
// R:R at T2 = 3×ATR / stop_dist. Baseline = 2.0 when stop = 1.5×ATR exactly.
// Elite+ = R:R≥2.0 (stop = 1.5×ATR, structure tight — best possible entry).
// Elite  = R:R 1.5–2.0 (structure stop slightly wider than 1.5×ATR).
// Good   = R:R 1.2–1.5 (wider structure stop or slightly capped stop).
// Weak   = R:R 0.8–1.2 (stop too wide relative to target — review before entry).
// Fair   = R:R < 0.8 (structurally poor — avoid breakout archetypes here).
function rrVerdict(rr: number): 'Elite+' | 'Elite' | 'Good' | 'Fair' | 'Weak' | '—' {
  if (rr <= 0) return '—';
  if (rr >= 2.0) return 'Elite+';
  if (rr >= 1.5) return 'Elite';
  if (rr >= 1.2) return 'Good';
  if (rr >= 0.8) return 'Weak';
  return 'Fair';
}
function rrVerdictColor(rr: number): string {
  if (rr >= 2.0) return 'text-cyan-300';
  if (rr >= 1.5) return 'text-green-300';
  if (rr >= 1.2) return 'text-emerald-400';
  if (rr >= 0.8) return 'text-orange-400';
  return 'text-yellow-300';
}

// Volume Thrust Badge — calibrated on 3,802 signals across 1,617 NSE stocks.
// Key finding: very high volume (>4x avg) is blow-off risk. Sweet spot 1.5-3.0x.
// HC optimal: vr20≥4.0, vp5≥5.0, rvb≤0.90, uw≤15 → +2.30% avg20d, MFE+16.17%.
// CONFIRMED optimal: vp5≥2.0, vr20≥1.0, rvb≤0.80 → +1.80% avg20d.
type VolumeBadge = 'HIGH_CONVICTION' | 'CONFIRMED' | null;
function detectVolumeBadge(r: AnalysisResult): VolumeBadge {
  const vr20 = r.volRatio20, vp5 = r.exactVolVsPre5, rvb = r.pre10RedVolBias;
  const uw = r.upperWickPct;
  // HIGH_CONVICTION: strong volume surge + clean close (uw≤15 is the key gate)
  if (vr20 >= 4.00 && vp5 >= 5.00 && rvb <= 0.90 && uw <= 15)
    return 'HIGH_CONVICTION';
  // CONFIRMED: moderate volume with sellers absent (rvb≤0.80 tightened from 1.10)
  if (vp5 >= 2.00 && vr20 >= 1.00 && rvb <= 0.80)
    return 'CONFIRMED';
  return null;
}

// ATR Compression State — calibrated on 3,802 signals across 1,617 NSE stocks.
// Key finding: pctl >90 is BEST (+4.51% avg20d, 60% win rate).
// pctl <10 also good (+1.92%). SWEET_SPOT middle (30-70) is mediocre.
// BUILDING zone (25-30) is worst (-0.60% avg20d).
type ATRState = 'DEEP_COMPRESSION' | 'BUILDING' | 'SWEET_SPOT' | 'HIGH_VOL' | null;
function detectATRState(r: AnalysisResult): { state: ATRState; explosion: boolean } {
  const pctl = r.atrPct14Pctl120;
  if (!Number.isFinite(pctl)) return { state: null, explosion: false };
  let state: ATRState;
  if (pctl < 20) state = 'DEEP_COMPRESSION';     // <20: ultra-quiet (+1.92% avg20d)
  else if (pctl < 35) state = 'BUILDING';         // 20-35: transitional (worst zone, -0.60%)
  else if (pctl <= 85) state = 'SWEET_SPOT';      // 35-85: active compression (+0.86-1.71%)
  else state = 'HIGH_VOL';                        // >85: momentum burst (+4.51%, 60% win rate)
  // EXPLOSION filter — calibrated on 1617 stocks:
  // Best: pctl 35-85, eRA≥1.4, adr≥3.5%, vr≥1.4, cl≥65 → +2.05% avg20d, 37.9% >5%.
  // Lowered eRA from 1.80→1.40, widened pctl from 45-90→35-85, adr from 4.0→3.5%.
  const adrPct = r.atrPct14 ?? 0;
  const volExpRatio = r.volatilityExpansionRatio ?? 0;
  const explosion = pctl >= 35 && pctl <= 85
    && r.exactRangeATR14 >= 1.40 && r.exactRangeATR14 <= 5.00
    && volExpRatio >= 1.20
    && adrPct >= 3.50 && adrPct <= 7.00
    && r.volRatio20 >= 1.40 && r.exactVolVsPre5 >= 2.00
    && r.pre10RedVolBias <= 1.20
    && r.closeLoc >= 65 && r.bodyPct >= 30 && r.upperWickPct <= 40;
  return { state, explosion };
}

// Narrow Zone Explosion Badge (backtested on 29 OHLCV files)
// High-conviction: 94.74% hit rate | Practical: 80.56% hit rate
type ZoneExplosionTier = 'HIGH_CONVICTION' | 'CONFIRMED' | null;
function detectZoneExplosion(r: AnalysisResult): ZoneExplosionTier {
  if (!r.zone) return null;
  const zt = r.zone.zoneTightnessPct;
  const zl = r.zone.windowLength;
  const zatr = r.pre10AvgRangeATR;
  const ra = r.exactRangeATR14;
  const cl = r.closeLoc, bp = r.bodyPct, uw = r.upperWickPct;
  // close_above_zone_pct
  const cazp = r.zone.zoneHigh > 0 ? ((r.lastClose - r.zone.zoneHigh) / r.zone.zoneHigh) * 100 : 0;
  // ADR20% approximation: atrPct14 is ATR as % of close
  const adrPct = r.atrPct14 ?? 0;

  // v4 Precision Max: 100% hit rate (17/17 trades, Wilson LB 81.57%, MFE 12.97%)
  const volExpRatio = r.volatilityExpansionRatio ?? 0;
  const pre10VolR = r.pre10AvgVolRatio ?? 0;
  const isGreen = r.lastClose > 0 && r.closeLoc > 50;
  if (zatr <= 0.75 && cazp >= 0.75 && cazp <= 4.00
    && ra >= 1.00 && ra <= 4.00 && cl >= 75 && bp >= 25 && uw <= 35
    && volExpRatio >= 1.25 && pre10VolR <= 1.10
    && adrPct >= 3.50 && adrPct <= 7.50 && zt <= 20 && zl >= 5 && zl <= 25
    && isGreen)
    return 'HIGH_CONVICTION';

  // VolumeFootprint: 75.86% hit rate (29 trades, Wilson LB 57.89%, MFE 14.48%)
  if (zt <= 20 && zl >= 5 && zl <= 20 && zatr <= 1.00
    && cazp >= 0.75 && cazp <= 6.00 && ra >= 1.00 && ra <= 8.00
    && adrPct >= 3.50 && adrPct <= 7.50
    && r.volRatio20 >= 1.20 && r.exactVolVsPre5 >= 2.00
    && cl >= 70 && bp >= 35 && uw <= 35)
    return 'CONFIRMED';

  return null;
}

// Composite Edge Score (0–100): ranks all signals by backtested avg20d advantage.
// StatsScore×0.25 + MomScore×0.20 + Zone(15) + Vol(10) + ATR(10) + DNA(10) + Monster(10) + Conv×0.10
function computeEdgeScore(r: AnalysisResult): number {
  const stats = (r.stats?.statsScore ?? 0) * 0.20;      // reduced from 0.25
  const mom   = (r.momentum?.momentumScore ?? 0) * 0.16; // reduced from 0.20
  const ze = detectZoneExplosion(r);
  const zone = ze === 'HIGH_CONVICTION' ? 15 : ze === 'CONFIRMED' ? 10 : 0;
  const vb = detectVolumeBadge(r);
  const vol = vb === 'HIGH_CONVICTION' ? 10 : vb === 'CONFIRMED' ? 7 : 0;
  const { state, explosion } = detectATRState(r);
  const atr = explosion ? 10 : state === 'HIGH_VOL' ? 8 : state === 'DEEP_COMPRESSION' ? 6 : state === 'SWEET_SPOT' ? 4 : 0;
  const dna = r.candleDNA?.tier === 'ELITE' ? 10 : r.candleDNA?.tier === 'STRONG' ? 8 : r.candleDNA?.tier === 'GOOD' ? 5 : 1;
  const topBadge = r.monster?.badges?.[0];
  const monster = topBadge?.type === 'MRV' ? 10 : topBadge?.type === 'MOM' ? 8 : topBadge?.type === 'BRK' ? 5 : 0;
  const conv = computeConviction(r) * 0.10;
  // inflectionScore: primary archetype quality metric (previously absent from EdgeScore)
  const inf = (r.inflectionScore ?? 0) * 0.07;  // max 7 pts at score=100
  // Stage tier bump: ensures tier order is preserved in top-picks ranking
  const stageTier = r.stage === 'ULTRA_STRONG_BUY' ? 6 : r.stage === 'STRONG_BUY' ? 4 : r.stage === 'BUY' ? 2 : 0;
  return Math.round(Math.min(stats + mom + zone + vol + atr + dna + monster + conv + inf + stageTier, 100));
}

function safeColFmt(col: ColDef, r: AnalysisResult): string {
  try { return col.fmt(r); } catch { return '—'; }
}

function csvEscape(val: string): string {
  if (val.includes('"') || val.includes(',') || val.includes('\n')) {
    return '"' + val.replace(/"/g, '""') + '"';
  }
  return '"' + val + '"';
}

function exportGroupCSV(rows: AnalysisResult[], cols: ColDef[], filename: string) {
  const headers = cols.map(c => csvEscape(c.label)).join(',');
  const body = rows.map(r => cols.map(c => csvEscape(safeColFmt(c, r))).join(',')).join('\n');
  const blob = new Blob(['﻿' + headers + '\n' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportGroupXLSX(rows: AnalysisResult[], cols: ColDef[], filename: string) {
  let XLSX: typeof import('xlsx');
  try { XLSX = await import('xlsx'); } catch { alert('Failed to load XLSX library'); return; }
  const data = rows.map(r => Object.fromEntries(cols.map(c => [c.label, safeColFmt(c, r)])));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Results');
  XLSX.writeFile(wb, filename);
}

async function exportGroupPDF(rows: AnalysisResult[], cols: ColDef[], title: string, filename: string) {
  let jsPDF: typeof import('jspdf')['default'], autoTable: typeof import('jspdf-autotable')['default'];
  try { jsPDF = (await import('jspdf')).default; autoTable = (await import('jspdf-autotable')).default; } catch { alert('Failed to load PDF library'); return; }
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' });
  doc.setFontSize(14);
  doc.setTextColor(100, 160, 255);
  doc.text(title, 14, 12);
  doc.setFontSize(8);
  doc.setTextColor(120, 130, 150);
  doc.text(`Dr KKR Quant Terminal Pro v9.0  ·  ${rows.length} stocks  ·  ${new Date().toLocaleDateString('en-IN')}  ·  Param: ${rows[0]?.paramSetKey ?? 'N/A'}`, 14, 18);

  const stageColors: Record<string, [number, number, number]> = {
    'ULTRA STRONG BUY': [253, 224, 71], 'STRONG BUY': [134, 239, 172], 'BUY': [52, 211, 153],
    'PRE-BREAKOUT': [147, 197, 253], 'EARLY INFLECTION': [34, 211, 238],
    'COMPRESSION WATCH': [203, 213, 225], 'NO SIGNAL': [100, 116, 139],
  };

  autoTable(doc, {
    head: [cols.map(c => c.label)],
    body: rows.map(r => cols.map(c => safeColFmt(c, r))),
    startY: 22,
    styles: { fontSize: 5.5, cellPadding: 1.0, textColor: [200, 210, 220] },
    headStyles: { fillColor: [30, 41, 59], textColor: [148, 163, 184], fontSize: 5.5 },
    alternateRowStyles: { fillColor: [15, 23, 42] },
    bodyStyles: { fillColor: [10, 12, 16] },
    theme: 'grid',
    didParseCell: (data: any) => {
      if (data.section === 'body') {
        const stageIdx = cols.findIndex(c => c.key === 'stage');
        if (data.column.index === stageIdx && data.row.raw) {
          const stageText = data.row.raw[stageIdx];
          const color = stageColors[stageText];
          if (color) data.cell.styles.textColor = color;
        }
      }
    },
  });
  doc.save(filename);
}

const STAGE_CONFIG: Record<StageRating, { label: string; color: string; textColor: string; bgColor: string }> = {
  ULTRA_STRONG_BUY:  { label: 'ULTRA STRONG BUY', color: 'text-[#39FF14]',    textColor: '#39FF14', bgColor: '#39FF1420' },
  STRONG_BUY:        { label: 'STRONG BUY',        color: 'text-[#22c55e]',   textColor: '#22c55e', bgColor: '#22c55e20' },
  // Elite Signal: STRONG_BUY + Compression Coil — backtest avg +4.10%, median +6.27%, 69% of trades >5%
  BUY:               { label: 'BUY',               color: 'text-[#4ade80]',   textColor: '#4ade80', bgColor: '#4ade8020' },
  PRE_BREAKOUT:      { label: 'PRE-BREAKOUT',       color: 'text-[#a3e635]',   textColor: '#a3e635', bgColor: '#a3e63520' },
  EARLY_INFLECTION:  { label: 'EARLY INFLECTION',   color: 'text-[#facc15]',   textColor: '#facc15', bgColor: '#facc1520' },
  COMPRESSION_WATCH: { label: 'COMPRESSION WATCH',  color: 'text-[#f97316]',   textColor: '#f97316', bgColor: '#f9731620' },
  NO_SIGNAL:         { label: 'NO SIGNAL',          color: 'text-[#ef4444]',   textColor: '#ef4444', bgColor: '#ef444420' },
};

const ALL_STAGES: StageRating[] = [
  'ULTRA_STRONG_BUY','STRONG_BUY','BUY','PRE_BREAKOUT','EARLY_INFLECTION','COMPRESSION_WATCH','NO_SIGNAL',
];

const COLUMNS: ColDef[] = [
  { key: 'symbol',    label: 'Symbol',      width: 120, align: 'left',
    fmt: r => r.symbol,
    cellClass: () => 'text-slate-200 font-medium font-mono' },
  { key: 'sector',    label: 'Sector',     width: 50, align: 'center',
    fmt: r => getSectorTag(r.symbol),
    cellClass: () => 'text-slate-500 text-xs' },
  { key: 'conviction', label: 'Conv', width: 60, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Conviction Score (0-100)</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Composite score measuring how STRONG the breakout signal is. Combines breakout stage tier, inflection score, momentum quality, and confidence level.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">80+</span></div><div><div class="rt-desc">Exceptional — nearly all conditions met across param sets. Trade with full size.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">60-79</span></div><div><div class="rt-desc">Strong — majority of conditions met. Standard position size.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">40-59</span></div><div><div class="rt-desc">Moderate — some conditions missing. Reduced size or wait for improvement.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">&lt;40</span></div><div><div class="rt-desc">Weak — too many conditions failing. Monitor only, do not trade.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Formula</span></div><div><div class="rt-desc">Stage tier (0-30) + Inflection×0.25 (0-25) + Momentum×0.20 (0-20) + Confidence×0.15 (0-15) + TradeValid (+10). Capped at 100.</div><div class="rt-hit hit-green">Higher conviction = more dimensions aligned = stronger setup</div></div></div>',
    fmt: r => '',  // rendered custom in cell
    numVal: r => computeConviction(r),
    cellClass: () => '' },
  { key: 'stage',     label: 'Stage',       width: 155, align: 'left',
    headerTipHtml: '<div class="rt-hdr">Stage</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Zone-breakout classification: compression detected, then graded by how cleanly it broke out.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">🚀 MOM Alert</span></div><div><div class="rt-desc">Independent of stage. The zone engine misses ~70% of real monster moves (PBFB forensic backtest, 3,102 events) because they\'re momentum-continuation on already-elevated-volatility stocks, not quiet compression. A 🚀MOM tag can appear on ANY stage, including NO_SIGNAL — it means a different, separately-validated pattern fired: Mom5≥7%, eRA≥1.2, Vol≥1.0x, ATR≥4.5%, above SMA50.</div><div class="rt-hit hit-green">50.9% OOS hit rate vs 35% baseline · ATR floor lowered from 5.0% to 4.5% via dedicated threshold sweep — same/better OOS rate, 2x+ more coverage · use the MOM Alert quick filter to surface all of these at once</div></div></div>',
    fmt: r => {
      const hasMom = !!r.monster?.badges?.some(b => b.type === 'MOM');
      const isElite = r.stage === 'STRONG_BUY' && r.paramSetKey === 'optimized_highprecision_15plus';
      const base = STAGE_CONFIG[r.stage].label;
      return base + (isElite ? ' ⭐ELITE' : '') + (hasMom ? ' 🚀MOM' : '');
    },
    cellClass: r => {
      const hasMom = !!r.monster?.badges?.some(b => b.type === 'MOM');
      const isElite = r.stage === 'STRONG_BUY' && r.paramSetKey === 'optimized_highprecision_15plus';
      if (isElite) return 'text-[#FFD700] font-bold';
      if (hasMom && (r.stage === 'NO_SIGNAL' || r.stage === 'COMPRESSION_WATCH' || r.stage === 'EARLY_INFLECTION')) {
        return 'text-orange-300 font-bold animate-pulse';
      }
      return STAGE_CONFIG[r.stage].color + ' font-semibold';
    } },
  { key: 'inflectionScore', label: 'Infl.Score', width: 90, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Inflection Score (0-100)</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Measures how close the stock is to a TURNING POINT — the moment compression transitions into a breakout. Like a pressure gauge for stored energy.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">80+</span></div><div><div class="rt-desc">Inflection imminent — one strong candle triggers the breakout. Zone highs tested repeatedly, volume ticking up.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">60-79</span></div><div><div class="rt-desc">Building pressure — setup forming. EMA converging, ATR contracting, higher lows inside zone. Needs 1-3 days.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">40-59</span></div><div><div class="rt-desc">Early signs — compression detected but not ready. Volume still drying up, zone still forming.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">&lt;40</span></div><div><div class="rt-desc">No inflection — stock is flat, trending, or not at a turning point. Not actionable yet.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">Detects</span></div><div><div class="rt-desc">EMA alignment converging · Volume dry-up then tick-up · ATR contracting then expanding · Price testing zone highs · Higher lows forming inside zone</div><div class="rt-hit hit-green">Higher score = more compressed energy about to release</div></div></div>',
    fmt: r => r.inflectionScore.toFixed(0),
    numVal: r => r.inflectionScore,
    cellClass: r => r.inflectionScore >= 80 ? 'text-green-300 font-semibold' : r.inflectionScore >= 60 ? 'text-emerald-400' : r.inflectionScore >= 40 ? 'text-yellow-300' : 'text-slate-400' },
  { key: 'confidence', label: 'Conf%',      width: 68,  align: 'right',
    headerTipHtml: '<div class="rt-hdr">Confidence Percentage (0-100%)</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">How RELIABLE the signal classification is. Measures agreement across all 6 archetypes and consistency of the inflection score.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">90%+</span></div><div><div class="rt-desc">Very high — most param sets agree on the stage. Classification is trustworthy.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">70-89%</span></div><div><div class="rt-desc">Good — reasonable agreement. Classification is likely correct.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">50-69%</span></div><div><div class="rt-desc">Moderate — some param sets disagree. Verify with other indicators.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">&lt;50%</span></div><div><div class="rt-desc">Low — significant disagreement between param sets. Stage may change.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Difference</span></div><div><div class="rt-desc">Conv = how GOOD the setup is. Conf% = how SURE the screener is about the classification. A stock can have high conviction but low confidence if only 1 param set passes it.</div><div class="rt-hit hit-cyan">High Conv + High Conf = strongest signal</div></div></div>',
    fmt: r => r.confidence.toFixed(0) + '%',
    numVal: r => r.confidence,
    cellClass: () => 'text-slate-300' },
  { key: 'confluenceScore', label: 'Confluence', width: 90, align: 'center',
    headerTipHtml: '<div class="rt-hdr">Confluence Score (0–6)</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">How many of the 6 momentum archetypes fire simultaneously on this stock. Higher = stronger institutional conviction.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">4–6</span></div><div><div class="rt-desc">Perfect Storm — multiple independent detectors agree. Highest probability inflection.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">2–3</span></div><div><div class="rt-desc">Strong alignment — 2-3 archetypes corroborate each other.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">1</span></div><div><div class="rt-desc">Single signal — valid but requires extra confirmation.</div></div></div>',
    fmt: r => {
      const s = (r as AnalysisResult & { confluenceScore?: number }).confluenceScore;
      if (s == null) return '—';
      const stars = s >= 4 ? '⚡⚡⚡' : s === 3 ? '⚡⚡' : s === 2 ? '⚡' : s === 1 ? '·' : '—';
      return `${s}/6 ${stars}`;
    },
    numVal: r => (r as AnalysisResult & { confluenceScore?: number }).confluenceScore ?? 0,
    cellClass: r => {
      const s = (r as AnalysisResult & { confluenceScore?: number }).confluenceScore ?? 0;
      return s >= 4 ? 'text-yellow-300 font-bold' : s >= 2 ? 'text-emerald-400 font-semibold' : 'text-slate-400';
    } },
  { key: 'archetypeType', label: 'Archetype', width: 160, align: 'left',
    headerTipHtml: '<div class="rt-hdr">Momentum Archetype + R5 Signal</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Which inflection-detection archetype fired this signal.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">VF</span></div><div><div class="rt-desc">Volume Footprint — institutional buying detected via volume surge near 20d high.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">CC</span></div><div><div class="rt-desc">Compression Coil — narrow bars + volume dry-up + BB squeeze = coiled spring.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">MP</span></div><div><div class="rt-desc">Momentum Pocket — first strong up-day after post-markdown stabilization.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">ES</span></div><div><div class="rt-desc">EMA Stack — price crosses above EMA20 with volume surge after pullback.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-purple">PS</span></div><div><div class="rt-desc">Perfect Storm — ATR-volatile bull-momentum setup.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge" style="background:#f59e0b20;color:#f59e0b;border:1px solid #f59e0b55">🔥 BULL POOL</span></div><div><div class="rt-desc">R5 gate: EMAStack OR PerfectStorm + body≥35% (candle body/range≥0.35) + PREMIUM hitRateGate · OOS n=24 · Hit5=75% · PF=2.78 · AvgP&L=+2.40% · At breadth&gt;70%: 83.3% OOS n=12 PF=4.06</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge" style="background:#fbbf2420;color:#fbbf24;border:1px solid #fbbf2455">body✓</span></div><div><div class="rt-desc">bodyGate: candle body ≥ 35% of its high–low range. R5 universal momentum quality filter. Shown on BULL POOL signals in the R5 banner above the table.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge" style="background:#a855f720;color:#a855f7;border:1px solid #a855f755">↩ BEAR ORS</span></div><div><div class="rt-desc">ORS-Prime v5 reversal — bear-regime capitulation signal (breadth≤50%) · OOS n=53 · Hit5=66% · PF=1.84 · ADX≥20 gate (PREMIUM) · Stop=3×ATR · Target+3%</div></div></div>',
    fmt: r => {
      const t = (r as AnalysisResult & { archetypeType?: string }).archetypeType;
      const pool = (r as AnalysisResult).bullPoolSignal;
      const regime = (r as AnalysisResult).regimeSignal;
      const map: Record<string, string> = {
        VolumeFootprint: '📊 Vol Footprint',
        CompressionCoil: '🔄 Comp Coil',
        MomentumPocket: '🎯 Mom Pocket',
        EMAStack: '📈 EMA Stack',
        PerfectStorm: '⚡ Perf Storm',
        ORS: '↩ ORS-Prime',
        Breakout: '💥 Breakout',
      };
      const base = t ? (map[t] ?? t) : '—';
      if (pool && regime === 'BULL_POOL') return `🔥 ${base}`;
      if (regime === 'BEAR_ORS') return `↩ ${base}`;
      return base;
    },
    numVal: () => 0,
    cellClass: r => {
      const pool = (r as AnalysisResult).bullPoolSignal;
      const regime = (r as AnalysisResult).regimeSignal;
      const t = (r as AnalysisResult & { archetypeType?: string }).archetypeType;
      if (pool && regime === 'BULL_POOL') return 'font-bold';
      if (regime === 'BEAR_ORS') return 'text-purple-400 font-semibold';
      return t === 'PerfectStorm' ? 'text-yellow-300 font-bold' : t === 'ORS' ? 'text-purple-400 font-semibold' : 'text-sky-300';
    },
    cellStyle: r => {
      const pool = (r as AnalysisResult).bullPoolSignal;
      const regime = (r as AnalysisResult).regimeSignal;
      if (pool && regime === 'BULL_POOL') return { color: '#f59e0b' };
      return undefined;
    } },
  { key: 'brkTier', label: 'BrkTier', width: 68, align: 'center',
    headerTipHtml: '<div class="rt-hdr">52W Breakout Tier (empirical model)</div><div class="rt-row"><div><span class="rt-badge bg-neon">★ A+</span></div><div><div class="rt-desc">VCP tight coil (zone tightness ≤10%) within 15% of 52-week high. Highest-quality breakout setup. 55.4% win rate.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-blue">✓ A</span></div><div><div class="rt-desc">Price within 25% of 52-week high. Near-high breakout — strong quality. 52.6-52.9% win rate.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-dim">B</span></div><div><div class="rt-desc">Zone-only breakout, not near 52-week high. Lower quality vs A/A+.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-cyan">Edge</span></div><div><div class="rt-desc">52W high model: 52.6-55.4% win rate vs 46% for old 5%-move trigger. Fitness 2.80-2.82 vs 1.37 (1,617 NSE symbols × 5yr backtest).</div></div></div>',
    fmt: r => r.priceEngine.breakoutTier === 'A+' ? '★ A+' : r.priceEngine.breakoutTier === 'A' ? '✓ A' : 'B',
    numVal: r => r.priceEngine.breakoutTier === 'A+' ? 3 : r.priceEngine.breakoutTier === 'A' ? 2 : 1,
    cellClass: r => r.priceEngine.breakoutTier === 'A+' ? 'text-emerald-400 font-bold bg-green-900/30 px-1 rounded' : r.priceEngine.breakoutTier === 'A' ? 'text-blue-400 font-semibold' : 'text-slate-600' },
  { key: 'clDep', label: 'VF', width: 50, align: 'center',
    fmt: r => r.clusterBreakdown?.deployable ? `${r.clusterBreakdown.deployable.met}/${r.clusterBreakdown.deployable.total}` : '—',
    numVal: r => r.clusterBreakdown?.deployable?.met ?? 0,
    cellClass: r => { const c = r.clusterBreakdown?.deployable; if (!c || c.total === 0) return 'text-slate-700'; return c.met === c.total ? 'text-yellow-300 font-bold' : c.met >= c.total - 2 ? 'text-emerald-400' : c.met >= c.total * 0.7 ? 'text-slate-300' : 'text-slate-600'; } },
  { key: 'clHP', label: 'CC', width: 50, align: 'center',
    fmt: r => r.clusterBreakdown?.highPrecision ? `${r.clusterBreakdown.highPrecision.met}/${r.clusterBreakdown.highPrecision.total}` : '—',
    numVal: r => r.clusterBreakdown?.highPrecision?.met ?? 0,
    cellClass: r => { const c = r.clusterBreakdown?.highPrecision; if (!c || c.total === 0) return 'text-slate-700'; return c.met === c.total ? 'text-yellow-300 font-bold' : c.met >= c.total - 2 ? 'text-emerald-400' : c.met >= c.total * 0.7 ? 'text-slate-300' : 'text-slate-600'; } },
  { key: 'clElt', label: 'MP', width: 50, align: 'center',
    fmt: r => r.clusterBreakdown?.elite ? `${r.clusterBreakdown.elite.met}/${r.clusterBreakdown.elite.total}` : '—',
    numVal: r => r.clusterBreakdown?.elite?.met ?? 0,
    cellClass: r => { const c = r.clusterBreakdown?.elite; if (!c || c.total === 0) return 'text-slate-700'; return c.met === c.total ? 'text-yellow-300 font-bold' : c.met >= c.total - 2 ? 'text-emerald-400' : c.met >= c.total * 0.7 ? 'text-slate-300' : 'text-slate-600'; } },
  { key: 'clUS', label: 'ES', width: 50, align: 'center',
    fmt: r => r.clusterBreakdown?.ultraSelective ? `${r.clusterBreakdown.ultraSelective.met}/${r.clusterBreakdown.ultraSelective.total}` : '—',
    numVal: r => r.clusterBreakdown?.ultraSelective?.met ?? 0,
    cellClass: r => { const c = r.clusterBreakdown?.ultraSelective; if (!c || c.total === 0) return 'text-slate-700'; return c.met === c.total ? 'text-yellow-300 font-bold' : c.met >= c.total - 2 ? 'text-emerald-400' : c.met >= c.total * 0.7 ? 'text-slate-300' : 'text-slate-600'; } },
  { key: 'clSN', label: 'PS', width: 50, align: 'center',
    headerTipHtml: '<div class="rt-hdr">⚡ Perfect Storm (R5)</div><div class="rt-row"><div><span class="rt-badge bg-neon">75%</span></div><div><div class="rt-desc">OOS Hit5=75% n=12 PF=2.94 (R5 gate: ATR≥3% AND body≥35%). At breadth&gt;70%: 87.5% OOS n=8 PF=6.03 — highest quality signal in study.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-cyan">Setup</span></div><div><div class="rt-desc">Dead-calm low-ATR-pctl stocks that explode. ATR Pctl≤40, Zero high-vol days pre-breakout, Vol vs Pre5 ≥3.5×.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-orange">R5 Gate</span></div><div><div class="rt-desc">PREMIUM = ATR14%≥3 AND body≥35%. Vol≥2× kills this signal — do NOT add vol filter.</div><div class="rt-hit hit-green">BULL POOL signal — fire only when breadth&gt;50%</div></div></div>',
    fmt: r => r.clusterBreakdown?.sniper ? `${r.clusterBreakdown.sniper.met}/${r.clusterBreakdown.sniper.total}` : '—',
    numVal: r => r.clusterBreakdown?.sniper?.met ?? 0,
    cellClass: r => { const c = r.clusterBreakdown?.sniper; if (!c || c.total === 0) return 'text-slate-700'; return c.met === c.total ? 'text-red-400 font-bold animate-pulse' : c.met >= c.total - 2 ? 'text-yellow-300' : c.met >= c.total * 0.7 ? 'text-slate-300' : 'text-slate-600'; } },
  { key: 'cmp',      label: 'CMP ₹',        width: 85,  align: 'right',
    fmt: r => r.lastClose > 0 ? r.lastClose.toFixed(2) : '—',
    numVal: r => r.lastClose,
    cellClass: () => 'text-slate-200 font-mono' },
  { key: 'dayChg', label: 'Chg%', width: 55, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Day Change %</div><div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Today\'s percentage change from previous close. Updates on every rescan/refresh.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-emerald">Green</span></div><div><div class="rt-desc">Positive change — price up from previous close</div></div></div><div class="rt-row"><div><span class="rt-badge bg-orange">Red</span></div><div><div class="rt-desc">Negative change — price down from previous close</div></div></div>',
    fmt: r => r.dayChangePct !== 0 ? `${r.dayChangePct >= 0 ? '+' : ''}${r.dayChangePct.toFixed(1)}%` : '—',
    numVal: r => r.dayChangePct,
    cellClass: r => r.dayChangePct > 3 ? 'text-green-300 font-bold font-mono' : r.dayChangePct > 0 ? 'text-emerald-400 font-mono' : r.dayChangePct < -3 ? 'text-red-400 font-bold font-mono' : r.dayChangePct < 0 ? 'text-red-400 font-mono' : 'text-slate-600 font-mono' },
  { key: 'atr14pct', label: 'ATR%', width: 50, align: 'right',
    headerTipHtml: '<div class="rt-hdr">ATR-14 as % of Price — v2 backtested (13,968 candles, 455 stocks)</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">Key finding</span></div><div><div class="rt-desc">ATR% does NOT predict win rate (r=-0.02, flat 53-58% everywhere). It predicts MAGNITUDE — both upside (r=+0.13 vs MFE) and downside (r=-0.24 vs MAE). Higher ATR = bigger winners AND bigger losers.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">★ 4-6% SWEET SPOT</span></div><div><div class="rt-desc">Best validated combo: 55-58% WR, +3.1 to +6.3% avg 20d return, 50-65% monster rate (4.5-4.75% band: +5.84% avg, 58% monster rate).</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">3-4%</span></div><div><div class="rt-desc">Good — 54-57% WR, +2.0 to +3.2% avg 20d, 36-46% monster rate. Building magnitude.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">1-3%</span></div><div><div class="rt-desc">Below-average magnitude — WR can be decent (54-66%) but moves are small (+1.2 to +1.7% avg 20d), monster rate only 9-30%.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">6-8% caution</span></div><div><div class="rt-desc">Transitional zone — thin data shows degradation (44.1% WR, -2.67% avg5d at 6-7%). Treat with caution.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-red">&gt;10% DANGER</span></div><div><div class="rt-desc">Catastrophic — 27.4% WR, -19.69% avg 20d return. Almost always distressed/crashing stocks, not healthy momentum. AVOID.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Used by</span></div><div><div class="rt-desc">Stop formula: ZoneLow - 0.5×ATR14 [4%, 6.5%]. Targets: T1 = 2.15×ATR14 [4%, 12%]. All 5 param sets reference ATR-14.</div></div></div>',
    fmt: r => r.atrPct14 > 0 ? r.atrPct14.toFixed(1) + '%' : '—',
    numVal: r => r.atrPct14,
    cellClass: r => r.atrPct14 > 10 ? 'text-red-500 font-bold font-mono' : r.atrPct14 >= 6 ? 'text-orange-400 font-mono' : r.atrPct14 >= 4 ? 'text-green-300 font-bold font-mono' : r.atrPct14 >= 3 ? 'text-emerald-400 font-mono' : r.atrPct14 >= 1 ? 'text-slate-400 font-mono' : 'text-slate-700 font-mono' },
  { key: 'candle',  label: 'Candle',        width: 75,  align: 'center',
    headerTipHtml: '<div class="rt-hdr">Breakout DNA + Onset Candle v2 — OOS-validated</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">★ STRONG / R-EXP</span></div><div><div class="rt-desc">Extreme range expansion: eRA≥3.0×ATR, closeLoc≥75%, body≥50%.</div><div class="rt-hit hit-green">65.5% OOS hit-5% rate (29 held-out signals) · +3.5pp vs 62.0% baseline · most stable combo found</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">No badge</span></div><div><div class="rt-desc">Candle pattern shown for reference only — no validated predictive edge.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">Major correction</span></div><div><div class="rt-desc">v1 had 5 onset tiers + 5 DNA archetypes (MARUBOZU, HAMMER, THRUST, COMPRESSION, looser R-EXP) claiming 48-82% hit rates from a 29-stock sample. Proper 60/40 OOS validation on 6,982 breakout candles (455 Nifty 500 stocks) showed EVERY one of them underperformed the 62.0% baseline (53-57% OOS) — candle shape barely matters once a real zone breakout has occurred (max correlation r=0.09). All removed except the one combo above.</div></div></div>',
    fmt: r => {
      const onset = detectOnsetCandle(r);
      const dna = detectBreakoutDNA(r);
      const pattern = r.stats?.candlePattern ?? '—';
      const dnaBadge = dna ? ` ${dna}` : '';
      if (onset === 'STRONG') return `★ ${pattern}${dnaBadge}`;
      if (dna) return `${pattern} ${dna}`;
      return pattern;
    },
    cellClass: r => {
      const onset = detectOnsetCandle(r);
      if (onset === 'STRONG') return 'text-[#4ade80] font-bold';
      const dna = detectBreakoutDNA(r);
      if (dna) return 'text-cyan-300 font-semibold';
      const t = r.stats?.candlePatternType;
      const s = r.stats?.candlePatternStrength ?? 0;
      if (t === 'bullish') return s >= 3 ? 'text-emerald-400 font-bold' : s >= 2 ? 'text-emerald-400' : 'text-emerald-600';
      if (t === 'bearish') return s >= 3 ? 'text-red-400 font-bold' : s >= 2 ? 'text-red-400' : 'text-red-600';
      return 'text-slate-500';
    } },
  { key: 'guppy',   label: 'Guppy',        width: 80,  align: 'right',
    headerTipHtml: '<div class="rt-hdr">Guppy GMMA v2 — Coil-Then-Release</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">🌀 COILED</span></div><div><div class="rt-desc">VALIDATED signal: spread was tight (&lt;2%) for 8+ of the last 10 days, NOW expanding (≤5%) with a clean bullish fan (all 6 short EMAs above all 6 long EMAs) and positive group gap (≥1%).</div><div class="rt-hit hit-green">62.4% WR vs 54.5% baseline (+7.9pp) · 19,987 candles, 456 Nifty 500 stocks</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">Fan</span></div><div><div class="rt-desc">Clean Bullish Fan alone (no recent compression required): 55.7% WR vs 50.5% when fan is messy/overlapping.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">Correction</span></div><div><div class="rt-desc">IMPORTANT: tight spread RIGHT NOW (not coiled-release) is actually the WORST tier — 1-1.5% spread bucket = 48% WR, the lowest of any range. Raw "compressed" is NOT bullish on its own.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Spread%</span></div><div><div class="rt-desc">Raw spread of all 12 EMAs as % of price — shown for reference, not predictive alone.</div></div></div>',
    fmt: r => r.stats.guppyCoiledRelease ? '🌀 ' + r.stats.guppySpreadPct.toFixed(1) + '%' : r.stats.guppyCleanBullishFan ? r.stats.guppySpreadPct.toFixed(1) + '%' : r.stats.guppySpreadPct < 99 ? r.stats.guppySpreadPct.toFixed(1) + '%' : '—',
    numVal: r => r.stats.guppyCoiledRelease ? 1000 - r.stats.guppySpreadPct : r.stats.guppyCleanBullishFan ? 500 - r.stats.guppySpreadPct : -r.stats.guppySpreadPct,
    cellClass: r => r.stats.guppyCoiledRelease ? 'text-green-300 font-bold font-mono bg-green-900/30 px-1 rounded' : r.stats.guppyCleanBullishFan ? 'text-cyan-400 font-semibold font-mono' : 'text-slate-600 font-mono' },
  { key: 'ema10',   label: '10 EMA',       width: 78,  align: 'right',
    fmt: r => r.stats.ema10 > 0 ? r.stats.ema10.toFixed(2) + (r.stats.ema10Cross ? ' ✕' : '') : '—',
    numVal: r => r.stats.ema10,
    cellClass: r => r.stats.ema10Cross ? 'text-yellow-300 font-bold font-mono' : r.lastClose > r.stats.ema10 ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono' },
  { key: 'ema21',   label: '21 EMA',       width: 78,  align: 'right',
    fmt: r => r.stats.ema21 > 0 ? r.stats.ema21.toFixed(2) + (r.stats.ema21Cross ? ' ✕' : '') : '—',
    numVal: r => r.stats.ema21,
    cellClass: r => r.stats.ema21Cross ? 'text-yellow-300 font-bold font-mono' : r.lastClose > r.stats.ema21 ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono' },
  { key: 'ema55',   label: '55 EMA',       width: 78,  align: 'right',
    fmt: r => r.stats.ema55 > 0 ? r.stats.ema55.toFixed(2) + (r.stats.ema55Cross ? ' ✕' : '') : '—',
    numVal: r => r.stats.ema55,
    cellClass: r => r.stats.ema55Cross ? 'text-yellow-300 font-bold font-mono' : r.lastClose > r.stats.ema55 ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono' },
  { key: 'sma200',  label: '200 SMA',      width: 80,  align: 'right',
    fmt: r => r.stats.sma200 > 0 ? r.stats.sma200.toFixed(2) + (r.stats.sma200Cross ? ' ✕' : '') : '—',
    numVal: r => r.stats.sma200,
    cellClass: r => r.stats.sma200Cross ? 'text-yellow-300 font-bold font-mono' : r.lastClose > r.stats.sma200 ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono' },
  { key: 'pe_er',     label: 'ER',           width: 42,  align: 'right',
    fmt: r => r.priceEngine.efficiencyRatio > 0 ? r.priceEngine.efficiencyRatio.toFixed(2) : '—',
    numVal: r => r.priceEngine.efficiencyRatio,
    cellClass: r => r.priceEngine.efficiencyRatio >= 0.6 ? 'text-emerald-400 font-mono' : r.priceEngine.efficiencyRatio >= 0.3 ? 'text-slate-300 font-mono' : 'text-red-400 font-mono' },
  { key: 'pe_entry',  label: 'Entry ₹',     width: 90,  align: 'right',
    fmt: r => r.priceEngine.plannedEntry > 0 ? r.priceEngine.plannedEntry.toFixed(2) : '—',
    numVal: r => r.priceEngine.plannedEntry,
    cellClass: () => 'text-slate-200' },
  { key: 'pe_tact',   label: 'Tactical Stop', width: 100, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Gate Cascade v6 — 10-Gate Precision Stop System</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-teal">Formula</span></div><div><div class="rt-desc">max(entry−1.5×ATR, 5-bar swing low×0.997) clamped [2.5%, 6.5%]. T1/T2/T3 = 1.5×/3×/5×ATR above entry. Trail-A day 8+: 5-bar swing trail. Trail-B post-T2: Chandelier = highClose−1.5×ATR.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-teal">G-GAP</span></div><div><div class="rt-desc">Gap-down open below stop → immediate SL-M at open. Bypasses all gates (uncontrollable).</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">G0</span></div><div><div class="rt-desc">Wyckoff Spring: dip &lt; 0.5×ATR (ATR-relative) AND close above stop — smart-money sweep that recovers.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">G1</span></div><div><div class="rt-desc">Verified Capitulation: RSI-2 &lt; 10 + close within 0.25×ATR of stop (spring zone) + buyer evidence (wick &gt;20% or close loc &gt;35%). All three required — stops APLLTD/GOODLUCK false-shield pattern.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-blue">G2</span></div><div><div class="rt-desc">2-Day Confirm: day-1 grace unless high-vol (&gt;1.8×) OR deep bearish dip (&gt;1×ATR deep + close loc &lt;25%). Day 2+: shield if stabilizing toward stop (close≥prev AND close&gt;stop×0.97) or low-vol noise.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">G3</span></div><div><div class="rt-desc">Hammer: lower wick ≥40% of range + close loc ≥55% — strong intraday buyer rejection.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">G4</span></div><div><div class="rt-desc">OBV 5-day slope positive — rising smart-money accumulation while price dips = not distribution.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">G5</span></div><div><div class="rt-desc">Narrow-Range Sweep: range &lt; 0.75×ATR AND close above stop — surgical stop-hunt, not a breakdown.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">G6</span></div><div><div class="rt-desc">Low-Vol Sweep: volume &lt; 0.65× avg AND close above stop — thin-session sweep, not institutional selling.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-teal">G7</span></div><div><div class="rt-desc">Isolated Red: previous candle was green AND closed above the stop level — single red dip into stop is noise.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-blue">G8</span></div><div><div class="rt-desc">Close Recovery: close recovered &gt;60% from intraday low back to stop level — buyers defended intraday.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-purple">G9</span></div><div><div class="rt-desc">Structure Intact: close ≥ 5-bar swing low×0.997 (entry-time basis; current 5-bar low used after Trail-A day 8+).</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">Exits</span></div><div><div class="rt-desc">50%@T1 + 30%@T2 + 20%@T3. T1 moves stop to breakeven; T2 starts Chandelier trail.</div></div></div>',
    fmt: r => r.priceEngine.tacticalStop > 0 ? '₹' + r.priceEngine.tacticalStop.toFixed(2) : '—',
    numVal: r => r.priceEngine.tacticalStop,
    cellClass: () => 'text-red-400 font-semibold' },
  { key: 'pe_risk',   label: 'Risk%',        width: 68,  align: 'right',
    headerTipHtml: '<div class="rt-hdr">Risk % (Stop Distance) v3 — Phase-3 Optimised</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">3.5-5.5%</span></div><div><div class="rt-desc">Sweet spot — ATR 2-4% stocks land here with the new 1.5×ATR structure stop. Avg across all signals: 5.23%.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">2.5-3.5% or 5.5-6.5%</span></div><div><div class="rt-desc">Acceptable — tight coil (2.5-3.5%) or wide ATR stock (5.5-6.5%). Both tradeable.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">&lt;2.5% or &gt;6.5%</span></div><div><div class="rt-desc">Outside clamped range — engine floors at 2.5% (prevents micro-stops) and caps at 6.5% (prevents over-wide stops on high-ATR stocks).</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Formula</span></div><div><div class="rt-desc">ATR-bucket tiers (OOS-validated, 629 signals): TIGHT/NORMAL → 3×ATR, cap 6%; VOLATILE → 3×ATR, cap 8%; HIGH → 2×ATR, cap 8%. Floor 2% universal.</div><div class="rt-hit hit-green">EV +0.18–1.43% vs flat 4×10% · Avg stop 10%→5-8%</div></div></div>',
    fmt: r => r.priceEngine.tacticalRiskPct > 0 ? r.priceEngine.tacticalRiskPct.toFixed(2) + '%' : '—',
    numVal: r => r.priceEngine.tacticalRiskPct,
    cellClass: r => { const rk = r.priceEngine.tacticalRiskPct; return rk >= 4.0 && rk <= 8.5 ? 'text-green-300 font-bold' : rk >= 2.5 && rk < 4.0 ? 'text-yellow-300' : 'text-orange-400'; } },
  { key: 'pe_rr',     label: 'R:R',          width: 60,  align: 'right',
    headerTipHtml: '<div class="rt-hdr">Reward : Risk Ratio v3 — Phase-3 Optimised</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">≥2.0</span></div><div><div class="rt-desc">BEST tier — stop = 1.5×ATR exactly (structure tight). T2 gain = 3×ATR → R:R = 2.0. EV_R +0.101R in ATR 1-2% band (POSITIVE expected value).</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">1.5-2.0</span></div><div><div class="rt-desc">Strong — structure stop slightly wider than 1.5×ATR. Still well above break-even expectancy. Bulk of well-structured trades land here.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">1.0-1.5</span></div><div><div class="rt-desc">Acceptable — review stop: structure may be loose. Consider sizing down.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">0.8-1.0</span></div><div><div class="rt-desc">DEAD ZONE — validated worst tier: near-zero or NEGATIVE avg P&L. Stop too wide relative to targets.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Key insight</span></div><div><div class="rt-desc">New stop formula: max(1.5×ATR, 5-bar swing low ×0.997). Baseline R:R@T2 = 2.0 (up from 1.5 with old 2×ATR stop).</div><div class="rt-hit hit-cyan">Phase-3: 1.07L signal bars · EV_R +34% vs old formula</div></div></div>',
    fmt: r => r.priceEngine.rewardRisk > 0 ? r.priceEngine.rewardRisk.toFixed(2) : '—',
    numVal: r => r.priceEngine.rewardRisk,
    cellClass: r => { const rr = r.priceEngine.rewardRisk; return rr >= 2.0 ? 'text-cyan-300 font-bold' : rr >= 1.5 ? 'text-green-300 font-bold' : rr >= 1.2 ? 'text-emerald-400' : rr >= 0.8 ? 'text-orange-400' : 'text-yellow-300'; } },
  { key: 'pe_rr_verdict', label: 'Verdict', width: 72, align: 'left',
    headerTipHtml: '<div class="rt-hdr">Trade Verdict v3 — Phase-3 Stop Engine</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">Elite+</span></div><div><div class="rt-desc">R:R ≥ 2.0. Stop = 1.5×ATR, structure tight. New BASELINE — every clean setup should hit this. T1=+1.5×ATR, T2=+3×ATR, T3=+5×ATR.</div><div class="rt-hit hit-green">ATR 1-2% band: +0.101R EV · 51% WR · Phase-3 validated</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">Elite</span></div><div><div class="rt-desc">R:R 1.5–2.0. Structure stop slightly wider than 1.5×ATR (swing low provides cushion). Still strong positive expectancy.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">Good</span></div><div><div class="rt-desc">R:R 1.2–1.5. Acceptable — structure wider than expected. Review the 5-bar swing zone before entry.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">Weak</span></div><div><div class="rt-desc">R:R 0.8–1.2. DEAD ZONE — worst avg P&L band. Stop too wide. Avoid breakout entries here.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">Fair</span></div><div><div class="rt-desc">R:R &lt;0.8. ORS-only territory (high WR compensates tight target). Not applicable to breakout archetypes.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Engine v3</span></div><div><div class="rt-desc">Stop: max(1.5×ATR, 5-bar low ×0.997) [2.5%, 6.5%]. Targets: T1/T2/T3 fixed in ATR space. Cascade R:R = (1.0+2.0+3.33)/3 = 2.11. Phase-3 EV_R improvement: +34%.</div></div></div>',
    fmt: r => { const rr = r.priceEngine.rewardRisk; if (rr <= 0) return '—'; return rr >= 2.0 ? 'Elite+' : rr >= 1.5 ? 'Elite' : rr >= 1.2 ? 'Good' : rr >= 0.8 ? 'Weak' : 'Fair'; },
    numVal: r => r.priceEngine.rewardRisk,
    cellClass: r => { const rr = r.priceEngine.rewardRisk; return rr >= 2.0 ? 'text-cyan-300 font-bold' : rr >= 1.5 ? 'text-green-300 font-bold' : rr >= 1.2 ? 'text-emerald-400 font-semibold' : rr >= 0.8 ? 'text-orange-400' : 'text-yellow-300'; } },
  { key: 'pe_t1',     label: 'T1 ₹',         width: 85,  align: 'right',
    fmt: r => r.priceEngine.target5 > 0 ? r.priceEngine.target5.toFixed(2) : '—',
    numVal: r => r.priceEngine.target5,
    cellClass: () => 'text-emerald-400' },
  { key: 'pe_t2',     label: 'T2 ₹',         width: 85,  align: 'right',
    fmt: r => r.priceEngine.target7 > 0 ? r.priceEngine.target7.toFixed(2) : '—',
    numVal: r => r.priceEngine.target7,
    cellClass: () => 'text-emerald-300' },
  { key: 'pe_t3r',    label: 'T3R ₹',         width: 85,  align: 'right',
    fmt: r => r.priceEngine.target3R > 0 ? r.priceEngine.target3R.toFixed(2) : '—',
    numVal: r => r.priceEngine.target3R,
    cellClass: () => 'text-yellow-300' },
  { key: 'pe_gap',    label: 'Gap%',           width: 65,  align: 'right',
    fmt: r => r.priceEngine.plannedEntry > 0 ? r.priceEngine.gapPct.toFixed(2) + '%' : '—',
    numVal: r => r.priceEngine.gapPct,
    cellClass: () => 'text-slate-400' },
  { key: 'pe_status', label: 'Entry Status',   width: 100, align: 'center',
    fmt: r => r.priceEngine.plannedEntry > 0 ? r.priceEngine.entryStatus : '—',
    cellClass: r => r.priceEngine.plannedEntry === 0 ? 'text-slate-600' : r.priceEngine.entryStatus === 'normal' ? 'text-emerald-400' : r.priceEngine.entryStatus === 'half_size' ? 'text-amber-400' : 'text-red-400' },
  { key: 'pe_valid',  label: 'Trade Valid',    width: 90,  align: 'center',
    fmt: r => r.priceEngine.plannedEntry > 0 ? (r.priceEngine.tradeValid ? '✓ YES' : '✗ NO') : '—',
    cellClass: r => r.priceEngine.plannedEntry === 0 ? 'text-slate-600' : r.priceEngine.tradeValid ? 'text-emerald-400 font-semibold' : 'text-slate-600' },
  { key: 'pe_rps',   label: 'R ₹',           width: 65,  align: 'right',
    fmt: r => r.priceEngine.riskPerShare > 0 ? r.priceEngine.riskPerShare.toFixed(2) : '—',
    numVal: r => r.priceEngine.riskPerShare,
    cellClass: () => 'text-amber-400 font-mono' },
  { key: 'pe_chT1',  label: 'Ch@T1',         width: 72,  align: 'right',
    fmt: r => r.priceEngine.chandelierT1 > 0 ? r.priceEngine.chandelierT1.toFixed(2) : '—',
    numVal: r => r.priceEngine.chandelierT1,
    cellClass: () => 'text-cyan-400 font-mono' },
  { key: 'pe_chT2',  label: 'Ch@T2',         width: 72,  align: 'right',
    fmt: r => r.priceEngine.chandelierT2 > 0 ? r.priceEngine.chandelierT2.toFixed(2) : '—',
    numVal: r => r.priceEngine.chandelierT2,
    cellClass: () => 'text-cyan-400 font-mono' },
  { key: 'pe_gATR',  label: 'Gap ATR',       width: 60,  align: 'right',
    fmt: r => r.priceEngine.gapATR > 0 ? r.priceEngine.gapATR.toFixed(1) : '—',
    numVal: r => r.priceEngine.gapATR,
    cellClass: r => r.priceEngine.gapATR > 2 ? 'text-red-400 font-mono' : r.priceEngine.gapATR > 1 ? 'text-amber-400 font-mono' : 'text-slate-400 font-mono' },
  { key: 'volRatio20', label: 'Vol/20d',       width: 75,  align: 'right',
    fmt: r => r.volRatio20.toFixed(2) + '×',
    numVal: r => r.volRatio20,
    cellClass: () => 'text-slate-300' },
  { key: 'atrPct14Pctl120', label: 'ATR%Pctl', width: 82, align: 'right',
    fmt: r => r.atrPct14Pctl120.toFixed(1) + '%',
    numVal: r => r.atrPct14Pctl120,
    cellClass: () => 'text-slate-400' },
  { key: 'zone_atr',  label: 'Zone ATR',       width: 78,  align: 'right',
    fmt: r => r.zone ? r.zone.zoneATRRatio.toFixed(2) : '—',
    numVal: r => r.zone?.zoneATRRatio ?? 0,
    cellClass: () => 'text-slate-400' },
  { key: 'closeLoc',  label: 'CloseLoc%',      width: 80,  align: 'right',
    fmt: r => r.closeLoc.toFixed(0) + '%',
    numVal: r => r.closeLoc,
    cellClass: () => 'text-slate-300' },
  { key: 'upperWickPct', label: 'Wick%',       width: 68,  align: 'right',
    fmt: r => r.upperWickPct.toFixed(0) + '%',
    numVal: r => r.upperWickPct,
    cellClass: () => 'text-slate-400' },
  { key: 'ultraPrecisionScore', label: 'Prec.Score', width: 82, align: 'right',
    fmt: r => r.ultraPrecisionScore.toFixed(0),
    numVal: r => r.ultraPrecisionScore,
    cellClass: r => r.ultraPrecisionScore >= 70 ? 'text-yellow-300' : r.ultraPrecisionScore >= 50 ? 'text-emerald-400' : 'text-slate-400' },
  { key: 'volatilityExpansionRatio', label: 'VolExp×', width: 75, align: 'right',
    fmt: r => r.volatilityExpansionRatio.toFixed(2) + '×',
    numVal: r => r.volatilityExpansionRatio,
    cellClass: () => 'text-slate-300' },
  // v9.0 momentum columns
  { key: 'momentumScore', label: 'MomScore', width: 82, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Momentum Score — Recalibrated on 3,806 signals × 1,617 stocks</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Composite score measuring breakout momentum quality. Rebuilt from scratch after backtesting revealed 3 of the original 6 components were NEGATIVE predictors.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">+35 VolDryUp≥3</span></div><div><div class="rt-desc">Vol dried up ≥3 bars before breakout — the primary weight. Quiet accumulation before the surge is the strongest momentum predictor.</div><div class="rt-hit hit-green">+10 bonus if ≥4 bars dry · Max vol-dry contribution: 45pts</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">+30 OBVSlope≥0.5</span></div><div><div class="rt-desc">On-Balance Volume rising steeply (≥0.5 normalized slope over 10 days) — confirms institutional accumulation behind price action.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">+10 ADX>40</span></div><div><div class="rt-desc">ADX above 40 = powerfully trending market. Unlike the old filter (ADX 20-40), strong trends (ADX>40) are BETTER for momentum breakouts.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">+5 EMA Aligned</span></div><div><div class="rt-desc">EMA stack 10>20>50>200 — minor confirming factor. Weight reduced from 25pts after validation showed marginal contribution.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">Removed ✗</span></div><div><div class="rt-desc">higherLowConfirmed (was +20pts, r=−0.01), adxInRange 20-40 (was +10pts, r=−0.005), gapAdjustedRR≥2 (was +10pts, r=−0.02) — all three were NEGATIVE predictors. Removed entirely.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">≥70</span></div><div><div class="rt-desc">Exceptional — requires vol-dry + OBV + ADX all aligned. Rare, high-conviction entry.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">≥40</span></div><div><div class="rt-desc">Actionable — at least one primary factor confirmed.</div></div></div>',
    fmt: r => r.momentum.momentumScore.toFixed(0),
    numVal: r => r.momentum.momentumScore,
    cellClass: r => r.momentum.momentumScore >= 70 ? 'text-yellow-300 font-semibold' : r.momentum.momentumScore >= 40 ? 'text-emerald-400' : 'text-slate-500' },
  { key: 'emaAligned', label: 'EMA✓', width: 55, align: 'center',
    fmt: r => r.momentum.emaAligned ? '✓' : '✗',
    numVal: r => r.momentum.emaAligned ? 1 : 0,
    cellClass: r => r.momentum.emaAligned ? 'text-emerald-400' : 'text-slate-600' },
  { key: 'higherLow', label: 'HL✓', width: 50, align: 'center',
    fmt: r => r.momentum.higherLowConfirmed ? '✓' : '✗',
    numVal: r => r.momentum.higherLowConfirmed ? 1 : 0,
    cellClass: r => r.momentum.higherLowConfirmed ? 'text-emerald-400' : 'text-slate-600' },
  { key: 'volDryUp', label: 'DryUp', width: 55, align: 'right',
    fmt: r => String(r.momentum.volDryUpScore),
    numVal: r => r.momentum.volDryUpScore,
    cellClass: r => r.momentum.volDryUpScore >= 3 ? 'text-emerald-400' : 'text-slate-500' },
  { key: 'obvSlope', label: 'OBV↗', width: 62, align: 'right',
    fmt: r => r.momentum.obvSlope10.toFixed(2),
    numVal: r => r.momentum.obvSlope10,
    cellClass: r => r.momentum.obvSlope10 >= 0.5 ? 'text-emerald-400' : r.momentum.obvSlope10 > 0 ? 'text-slate-400' : 'text-red-400' },
  { key: 'adx14', label: 'ADX', width: 55, align: 'right',
    fmt: r => r.momentum.adx14.toFixed(0),
    numVal: r => r.momentum.adx14,
    cellClass: r => r.momentum.adxInRange ? 'text-emerald-400' : 'text-slate-500' },
  { key: 'gapRR', label: 'GapRR', width: 60, align: 'right',
    fmt: r => r.momentum.gapAdjustedRR > 0 ? r.momentum.gapAdjustedRR.toFixed(1) : '—',
    numVal: r => r.momentum.gapAdjustedRR,
    cellClass: r => r.momentum.gapAdjustedRR >= 2 ? 'text-emerald-400' : r.momentum.gapAdjustedRR > 0 ? 'text-amber-400' : 'text-slate-600' },
  { key: 'rsNifty', label: 'RS/N50', width: 65, align: 'right',
    fmt: r => r.momentum.rsNifty20.toFixed(2),
    numVal: r => r.momentum.rsNifty20,
    cellClass: r => r.momentum.rsNifty20 >= 1.05 ? 'text-emerald-400 font-semibold' : r.momentum.rsNifty20 >= 1.0 ? 'text-slate-300' : 'text-red-400' },
  { key: 'brain', label: '🧠 Brain', width: 80, align: 'right',
    headerTipHtml: '<div class="rt-hdr">🧠 Adaptive Brain v2</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Brain-adjusted conviction score. Learns from YOUR closed trades using Bayesian inference.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">Factors</span></div><div><div class="rt-desc">Adjusts for: sector performance, stock memory, streak, conviction threshold, Clenow, overlays</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">Sizing</span></div><div><div class="rt-desc">90+: A+ (1.5% risk) · 75+: Good (1%) · 60+: Avg (0.75%) · 45+: Weak (0.5%) · &lt;45: Skip</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">Learning</span></div><div><div class="rt-desc">Gets smarter every trade. LOW confidence until 50+ trades, then patterns emerge.</div><div class="rt-hit hit-green">Pure Bayesian math · No external AI · YOUR personal edge</div></div></div>',
    fmt: () => '', numVal: () => 0, cellClass: () => '' },
  { key: 'clenow', label: 'Clenow', width: 75, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Clenow Momentum Score (125d)</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">Formula</span></div><div><div class="rt-desc">Annualized exp. regression slope × R² (trend smoothness). Higher = stronger AND smoother momentum.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">SMOOTH</span></div><div><div class="rt-desc">R² ≥ 0.7: stock rising in a clean, orderly trend — institutional accumulation</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">MODERATE</span></div><div><div class="rt-desc">R² 0.4-0.7: trending but with some noise — mixed participation</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">CHOPPY</span></div><div><div class="rt-desc">R² &lt; 0.4: no clean trend — random or rotational movement</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">Use</span></div><div><div class="rt-desc">Prioritize trades with higher Clenow. Top-25% Clenow breakouts: 54.1% hit rate vs 46.4% baseline.</div><div class="rt-hit hit-green">Ranking tool, not a filter · Andreas Clenow method</div></div></div>',
    fmt: () => '',  // rendered custom in cell via clenowMap
    numVal: () => 0,
    cellClass: () => '' },
  { key: 'pcaScore', label: 'PCA', width: 65, align: 'right',
    headerTipHtml: '<div class="rt-hdr">PCA Super-Score v2</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Optimal linear combination of 6 features weighted by win-correlation. Re-derived and validated on 5,026 breakout signals across 456 Nifty 500 stocks (the old weights were found to be INVERTED on this larger dataset and have been fixed).</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">Formula</span></div><div><div class="rt-desc">0.06×ZoneTight - 0.10×RangeATR - 0.19×VolRatio - 0.07×VolVsPre5 + 0.05×Pre10Range - 0.20×UpperWick (all standardized) — recalibrated on 3,806 signals × 1,617 stocks. UpperWick penalty DOUBLED (−0.10→−0.20) as strongest negative predictor.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">6-Tier Rank</span></div><div><div class="rt-desc">S (top 20%): highest conviction · A (20-40%): strong · B (40-60%): moderate · C (60-80%): below avg · D (80-90%): weak · F (bottom 10%): avoid. Tier boundaries widened — S now top 20% (decile analysis showed D1+D2 both ~+2.8%, same edge).</div><div class="rt-hit hit-green">Upper wick is the dominant signal — low wick % + high zone tightness = best combos</div></div></div>',
    fmt: () => '',
    numVal: () => 0,
    cellClass: () => '' },
  // v9.0 stats columns
  { key: 'statsScore', label: 'Stats', width: 55, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Stats Composite Score (0-100) v3 — recalibrated on 3,806 signals × 1,617 stocks</div><div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Composite statistical edge score rebuilt from correlation analysis. Three components REMOVED (zero or negative predictors), one INVERTED (volZ now costs points), one NARROWED (CCI sweet spot).</div></div></div><div class="rt-row"><div><span class="rt-badge bg-neon">≥50</span></div><div><div class="rt-desc">Exceptional — +5.06% avg 20d return, 54.7% win rate. ≥55 tier: +5.50%, 63.9% WR.</div><div class="rt-hit hit-green">Sweet spot: Stats≥40 + CandleDNA STRONG+ = +7.27% avg 20d, 58.9% WR</div></div></div><div class="rt-row"><div><span class="rt-badge bg-yellow">≥40</span></div><div><div class="rt-desc">Actionable — meaningful statistical edge confirmed.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-slate">&lt;30</span></div><div><div class="rt-desc">Weak — limited statistical support.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-orange">Inverted ⚠</span></div><div><div class="rt-desc">volZ HIGH is now −5pts (was +5pts). High breakout-day volume z-score is strongly NEGATIVE (r=−0.074) — blow-off top risk, not confirmation. CCI sweet spot NARROWED to 100-200 (was 150-300).</div></div></div><div class="rt-row"><div><span class="rt-badge bg-dim">Removed ✗</span></div><div><div class="rt-desc">hurstTrending +12pts removed (r=0.000, zero correlation). ddFromHigh≤10 +6pts removed (r=−0.037, negative). volSkew>0.2 +3pts removed (r=−0.022, negative). guppy.coiledRelease INCREASED to +12pts (best component, 62% win rate).</div></div></div>',
    fmt: r => String(r.stats.statsScore),
    numVal: r => r.stats.statsScore,
    cellClass: r => r.stats.statsScore >= 50 ? 'text-yellow-300 font-semibold' : r.stats.statsScore >= 40 ? 'text-emerald-400' : 'text-slate-500' },
  { key: 'volZ', label: 'VolZ', width: 50, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Volume Z-Score</div><div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">How many standard deviations today\'s volume is above the 20-day mean. Measures statistical significance of the volume surge.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-neon">≥2.0</span></div><div><div class="rt-desc">Statistically significant — 95% confidence this is NOT random. Institutional activity.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-yellow">1.0-2.0</span></div><div><div class="rt-desc">Above average — notable but not statistically significant.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-slate">&lt;1.0</span></div><div><div class="rt-desc">Normal volume — no unusual activity detected.</div></div></div>',
    fmt: r => r.stats.volZScore.toFixed(1),
    numVal: r => r.stats.volZScore,
    cellClass: r => r.stats.volZSignificant ? 'text-emerald-400 font-semibold' : r.stats.volZScore >= 1.5 ? 'text-slate-300' : 'text-slate-600' },
  { key: 'bbPctl', label: 'BB%', width: 48, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Bollinger Band Width Percentile</div><div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Current BB width ranked against its own 120-day history. Low = bands squeezed tight (volatility compressed). Expansion follows compression.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-neon">0-10%</span></div><div><div class="rt-desc">Maximum squeeze — tightest bands in 120 days. Explosion imminent.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-yellow">10-25%</span></div><div><div class="rt-desc">Compressed — building energy. Watch for breakout candle.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-slate">&gt;50%</span></div><div><div class="rt-desc">Normal or expanded — no squeeze detected.</div></div></div>',
    fmt: r => r.stats.bbWidthPctl.toFixed(0),
    numVal: r => r.stats.bbWidthPctl,
    cellClass: r => r.stats.bbSqueeze ? 'text-yellow-300 font-semibold' : r.stats.bbWidthPctl <= 25 ? 'text-emerald-400' : 'text-slate-500' },
  { key: 'hurst', label: 'Hurst', width: 50, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Hurst Exponent (validated ★★★ strongest stable predictor)</div><div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Measures whether price movements are trending (persistent) or mean-reverting. Fractal analysis of price structure.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-neon">&gt;0.65</span></div><div><div class="rt-desc">Strongly trending — 58.9% WR, +2.86% avg 20d. Best tier.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-emerald">0.55-0.65</span></div><div><div class="rt-desc">Trending — 55-57% WR. Breakouts more likely to continue.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-orange">&lt;0.4</span></div><div><div class="rt-desc">CATASTROPHIC — 41.4% WR, -13.41% avg 20d. Strongly mean-reverting; breakouts here fail hard.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-slate">Validated</span></div><div><div class="rt-desc">r=+0.15 vs fwd 20d return, 6,064 candles, 447 Nifty 500 stocks — strongest STABLE (non-outlier-driven) predictor of all 12 Stats indicators.</div></div></div>',
    fmt: r => r.stats.hurst.toFixed(2),
    numVal: r => r.stats.hurst,
    cellClass: r => r.stats.hurst >= 0.65 ? 'text-green-300 font-bold' : r.stats.hurstTrending ? 'text-emerald-400' : r.stats.hurst < 0.4 ? 'text-red-400 font-bold' : 'text-slate-500' },
  { key: 'ttmSqz', label: 'TTM', width: 52, align: 'center',
    headerTipHtml: '<div class="rt-hdr">TTM Squeeze (John Carter)</div><div class="rt-row"><div><span class="rt-badge bg-neon">🟢 FIRE</span></div><div><div class="rt-desc">Squeeze has FIRED — Bollinger Bands just expanded outside Keltner Channels. Breakout in progress. Trade NOW.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-orange">🔴 ON</span></div><div><div class="rt-desc">Squeeze is ON — BB inside KC. Volatility compressed, energy building. Breakout approaching. Get ready.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-slate">⚫ OFF</span></div><div><div class="rt-desc">No squeeze — normal volatility. Not a compression setup.</div></div></div>',
    fmt: r => r.stats.ttmSqueezeFired ? '🟢 FIRE' : r.stats.ttmSqueezeOn ? '🔴 ON' : '⚫ OFF',
    numVal: r => r.stats.ttmSqueezeFired ? 2 : r.stats.ttmSqueezeOn ? 1 : 0,
    cellClass: r => r.stats.ttmSqueezeFired ? 'text-green-400 font-bold' : r.stats.ttmSqueezeOn ? 'text-red-400 font-semibold' : 'text-slate-600' },
  { key: 'ttmMom', label: 'Mom', width: 50, align: 'right',
    headerTipHtml: '<div class="rt-hdr">TTM Momentum</div><div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Momentum oscillator from TTM Squeeze. Positive = bullish momentum, negative = bearish. Rising = accelerating.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-neon">Positive + Rising</span></div><div><div class="rt-desc">Bullish momentum accelerating — ideal for breakout entry.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-yellow">Positive + Falling</span></div><div><div class="rt-desc">Still bullish but decelerating — momentum fading.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-orange">Negative</span></div><div><div class="rt-desc">Bearish momentum — avoid long entries or wait for reversal.</div></div></div>',
    fmt: r => r.stats.ttmMomentum.toFixed(1),
    numVal: r => r.stats.ttmMomentum,
    cellClass: r => r.stats.ttmMomentum > 0 && r.stats.ttmMomentumRising ? 'text-emerald-400' : r.stats.ttmMomentum > 0 ? 'text-cyan-400' : r.stats.ttmMomentum < 0 && !r.stats.ttmMomentumRising ? 'text-red-400' : 'text-amber-400' },
  { key: 'rsi14', label: 'RSI14', width: 50, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Relative Strength Index (14-day) v2</div><div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Classic momentum oscillator. Measures speed and magnitude of price changes over 14 days.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-neon">&gt;80</span></div><div><div class="rt-desc">VALIDATED best tier — 60.6% WR, +3.24% avg 20d. In a momentum-breakout context, strength confirms strength, not exhaustion.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-emerald">70-80</span></div><div><div class="rt-desc">Strong — 56.2% WR, +2.55% avg.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-yellow">60-70</span></div><div><div class="rt-desc">Above baseline — 54.4% WR.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-orange">50-60</span></div><div><div class="rt-desc">WORST tier — 49.0% WR, -3.83% avg 20d. Counter-intuitively the weakest RSI zone for breakouts.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-slate">Correction</span></div><div><div class="rt-desc">Old "overbought &gt;70 = bad" framing was backward for momentum breakouts. Re-derived on 6,064 candles, 447 Nifty 500 stocks.</div></div></div>',
    fmt: r => r.stats.rsi14.toFixed(0),
    numVal: r => r.stats.rsi14,
    cellClass: r => r.stats.rsi14 >= 80 ? 'text-green-300 font-bold' : r.stats.rsi14 >= 70 ? 'text-emerald-400 font-semibold' : r.stats.rsi14 >= 60 ? 'text-cyan-400' : r.stats.rsi14 >= 50 ? 'text-orange-400' : 'text-slate-400' },
  { key: 'cci34', label: 'CCI34', width: 55, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Commodity Channel Index (34-day) v2</div><div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Measures price deviation from its statistical mean. Identifies trend strength and potential reversals.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-neon">100-200</span></div><div><div class="rt-desc">VALIDATED sweet spot (recalibrated) — strong trend without extreme exhaustion. Narrowed from 150-300 after 3,806-signal backtest.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-yellow">&gt;200</span></div><div><div class="rt-desc">Extended — elevated but past peak sweet spot zone.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-slate">0-100</span></div><div><div class="rt-desc">Mild bullish — building momentum, below the validated sweet spot.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-orange">&lt;0</span></div><div><div class="rt-desc">Below mean — pullback or early reversal, weakest zone (51.7% WR).</div></div></div>',
    fmt: r => r.stats.cci34.toFixed(0),
    numVal: r => r.stats.cci34,
    cellClass: r => r.stats.cci34 >= 100 && r.stats.cci34 <= 200 ? 'text-green-300 font-bold' : r.stats.cci34 > 200 ? 'text-emerald-400' : r.stats.cci34 >= 0 ? 'text-slate-300' : 'text-orange-400' },
  { key: 'dd52WH', label: '52WH%', width: 55, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Drawdown from 52-Week High (%)</div><div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">How far current price is below its 52-week high. Lower = closer to highs = stronger relative position.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-neon">0-5%</span></div><div><div class="rt-desc">Near 52-week high — strong relative strength. Leader stock.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-yellow">5-15%</span></div><div><div class="rt-desc">Moderate pullback from highs — normal correction territory.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-orange">&gt;15%</span></div><div><div class="rt-desc">Deep drawdown — stock in correction or downtrend. Weak relative strength.</div></div></div>',
    fmt: r => r.stats.drawdownFrom52WH.toFixed(1),
    numVal: r => r.stats.drawdownFrom52WH,
    cellClass: r => r.stats.drawdownFrom52WH <= 5 ? 'text-emerald-400 font-semibold' : r.stats.drawdownFrom52WH <= 15 ? 'text-slate-300' : 'text-red-400' },
  { key: 'pct52WL', label: '52WL%', width: 55, align: 'right',
    headerTipHtml: '<div class="rt-hdr">% Above 52-Week Low</div><div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">How far current price is above its 52-week low. Higher = more recovery from bottom = stronger trend.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-neon">&gt;50%</span></div><div><div class="rt-desc">Strong uptrend — well above yearly lows. Institutional accumulation likely.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-yellow">20-50%</span></div><div><div class="rt-desc">Moderate recovery — trending up but still building base.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-orange">&lt;20%</span></div><div><div class="rt-desc">Near 52-week lows — weak stock, still in downtrend or bottoming.</div></div></div>',
    fmt: r => r.stats.pctFrom52WL.toFixed(0),
    numVal: r => r.stats.pctFrom52WL,
    cellClass: r => r.stats.pctFrom52WL >= 50 ? 'text-emerald-400' : r.stats.pctFrom52WL >= 20 ? 'text-slate-300' : 'text-red-400' },
  { key: 'sharpe', label: 'Sharpe', width: 55, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Sharpe Ratio (20-day) v2</div><div class="rt-row"><div><span class="rt-badge bg-cyan">What</span></div><div><div class="rt-desc">Risk-adjusted return: average daily return ÷ standard deviation of returns × √252. Higher = better return per unit of risk.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-neon">&gt;2.5</span></div><div><div class="rt-desc">Validated threshold (was &gt;2.0) — 56.4% WR, +2.13% avg 20d. Weak standalone signal (r=-0.01) but part of the winning combined filter.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-yellow">0.5-2.5</span></div><div><div class="rt-desc">Below the validated threshold — 48-54% WR range, no clean edge.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-orange">&lt;0</span></div><div><div class="rt-desc">Negative — losing money on a risk-adjusted basis. Avoid.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-slate">Note</span></div><div><div class="rt-desc">Weakest of the 12 Stats indicators individually — use as a confirming factor, not a primary signal.</div></div></div>',
    fmt: r => r.stats.sharpe20.toFixed(1),
    numVal: r => r.stats.sharpe20,
    cellClass: r => r.stats.sharpe20 >= 2.5 ? 'text-emerald-400 font-semibold' : r.stats.sharpe20 >= 0.5 ? 'text-slate-400' : r.stats.sharpe20 > 0 ? 'text-slate-500' : 'text-red-400' },
  { key: 'insBar', label: 'InsBr', width: 45, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Inside Bars (consecutive) — CORRECTED</div><div class="rt-row"><div><span class="rt-badge bg-orange">Backtest result</span></div><div><div class="rt-desc">2 inside bars actually UNDERPERFORMS: 47.5% WR vs 55.8% WR at 0 inside bars. The "coiling spring" assumption did NOT hold on 6,064 candles, 447 Nifty 500 stocks.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-slate">What</span></div><div><div class="rt-desc">Count of consecutive inside bars (each bar\'s high/low within the previous bar\'s range). Shown for reference — no longer scored as a bullish factor.</div></div></div><div class="rt-row"><div><span class="rt-badge bg-slate">Recommendation</span></div><div><div class="rt-desc">Use Guppy Coil-Then-Release (🌀 in Guppy column) instead — that pattern IS validated at +7.9pp WR edge.</div></div></div>',
    fmt: r => r.stats.insideBars > 0 ? String(r.stats.insideBars) : '—',
    numVal: r => r.stats.insideBars,
    cellClass: () => 'text-slate-500' },
  // Monster Scan
  { key: 'monster', label: 'Monster', width: 85, align: 'center',
    headerTipHtml: '<div class="rt-hdr">Monster Move Detector v2 — OOS-validated (>10% MFE in 20d)</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-blue">🔄 MRV</span></div><div><div class="rt-desc">Mean Reversion — ≤-30% below 50d high, RSI-2 ≤60, pre-10 vol dried up ≤0.3x. Deep oversold bounce setup.</div><div class="rt-hit hit-cyan">88.6% OOS monster rate (35 held-out signals) · Strongest validated pattern, 2.5x baseline edge</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">🚀 MOM</span></div><div><div class="rt-desc">Momentum Continuation — 5d mom ≥7%, eRA ≥1.2, vol ≥1.0x, ATR ≥4.5%, above SMA50.</div><div class="rt-hit hit-green">50.9% OOS monster rate (507 held-out signals) · 1.5x baseline edge · ATR floor tuned via dedicated sweep (scripts/momAtrThresholdSweep.js)</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">— NONE</span></div><div><div class="rt-desc">No validated monster pattern detected. Baseline monster probability is 35.0%.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">Correction</span></div><div><div class="rt-desc">v1 had a 💥 BRK badge claiming 60-90% monster rate from a 15-21 signal sample. Proper 60/40 train/test validation on 146,425 points (455 Nifty 500 stocks) showed it has NO real edge — OOS rate converges to the 35% baseline. Removed.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Method</span></div><div><div class="rt-desc">Stability-optimized grid search (scored by min(train,test) rate, penalized for degradation) on 455 Nifty 500 stocks — not just train-set winners.</div></div></div>',
    fmt: r => {
      if (!r.monster || r.monster.badges.length === 0) return '—';
      return r.monster.badges.map(b => `${b.type === 'MOM' ? '🚀' : '🔄'}${b.type}`).join(' ');
    },
    numVal: r => r.monster?.topProbability ?? 0,
    cellClass: r => {
      if (!r.monster || r.monster.badges.length === 0) return 'text-slate-500';
      const top = r.monster.topProbability;
      return top >= 80 ? 'text-green-300 font-bold bg-green-900/30 px-1 rounded animate-pulse' :
             top >= 60 ? 'text-cyan-300 font-semibold bg-cyan-900/20 px-1 rounded' :
             top >= 50 ? 'text-amber-300 bg-amber-900/15 px-1 rounded' : 'text-slate-400';
    } },
  // Candle DNA Score
  { key: 'candleDNA', label: 'Candle DNA', width: 95, align: 'center',
    headerTipHtml: '<div class="rt-hdr">Candle DNA Score v3 — Recalibrated on 3,806 signals × 1,617 stocks</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">ELITE (≥70)</span></div><div><div class="rt-desc">Near-zero upper wick (uw&lt;0.08), high close location (≥55%), strong support tail (lw≥0.15). Sweet spot: +4.99% avg 20d. Threshold lowered from 75 — more signals qualify without losing edge.</div><div class="rt-hit hit-green">Best combo: uw&lt;0.08 + lw≥0.15 + cl≥55 → +4.99% avg 20d</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">STRONG (50-69)</span></div><div><div class="rt-desc">Minimal rejection with consistent upward closes. Good support tail. Threshold lowered from 55.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-amber">GOOD (30-49)</span></div><div><div class="rt-desc">Moderate quality — acceptable close location but some upper wick or weak support tail. Threshold lowered from 35.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">WEAK (&lt;30)</span></div><div><div class="rt-desc">Heavy upper wick rejection and/or low close location. Caution on sizing.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Components v3</span></div><div><div class="rt-desc">Upper Wick (0-40pts): uw&lt;0.02→40, &lt;0.08→30, &lt;0.15→15 — the strongest component. Close Location (0-35pts): cl 65-70 sweet spot = 22pts (+2.97%). Support Tail (0-25pts): lw≥0.60→25, ≥0.40→20, ≥0.25→14, ≥0.15→8.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">Cross-feature</span></div><div><div class="rt-desc">Stats≥40 + DNA STRONG+ = +7.27% avg 20d, 58.9% win rate — strongest validated multi-feature combination across the full 3,806-signal dataset.</div></div></div>',
    fmt: r => r.candleDNA ? `${Math.round(r.candleDNA.score)}-${r.candleDNA.tier.charAt(0) + r.candleDNA.tier.slice(1).toLowerCase()}` : '—',
    numVal: r => r.candleDNA?.score ?? 0,
    cellClass: r => {
      if (!r.candleDNA) return 'text-slate-700';
      const t = r.candleDNA.tier;
      return t === 'ELITE' ? 'text-green-300 font-bold bg-green-900/30 px-1.5 rounded' :
             t === 'STRONG' ? 'text-cyan-300 font-semibold bg-cyan-900/20 px-1.5 rounded' :
             t === 'GOOD' ? 'text-amber-400 px-1.5' : 'text-slate-600';
    } },
  // v7.3 columns
  { key: 'ors_reversal', label: 'ORS↩', width: 88, align: 'center',
    headerTipHtml: '<div class="rt-hdr">ORS-Prime Reversal Signal</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-purple">↩✓✓ CONFIRMED</span></div><div><div class="rt-desc">Yesterday was the oversold red signal AND today closed green. Enter at tomorrow open. Stop = 3×ATR. Target +3%.</div><div class="rt-hit hit-green">ORS-Prime v5 · 96.2% OOS WR · Bear regime (breadth ≤50%) · OOS n=53 · PF=1.84</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">↩✓ SIGNAL</span></div><div><div class="rt-desc">Today is the oversold red candle: RSI2≤7 · RSI14≤38 · Body≥37% · UpWick≤30% · ≥10% below EMA20 · ≥38% from 60d high · ORS Score≥63 · ADX≥20 · LowerWick≥20% · BodyATR≤1.6. Watch for green confirmation tomorrow.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Score 0-100</span></div><div><div class="rt-desc">ORS score: RSI2 depth (30pts) · RSI14 (15pts) · Range% (10pts) · EMA20 dist (10pts) · Body (8pts) · Wick (7pts) · SwingLow (5pts) · VolDryUp (5pts) · Drawdown (10pts) · 252d z-score bonus</div></div></div>',
    fmt: r => {
      const ors = r.clusterBreakdown?.orsReversal;
      if (!ors || !ors.score || ors.score < 72) return '—';
      return ors.confirmed ? `↩✓✓` : `↩✓ ${ors.score}`;
    },
    numVal: r => {
      const ors = r.clusterBreakdown?.orsReversal;
      if (!ors || !ors.score || ors.score < 72) return 0;
      return ors.confirmed ? 1000 + (ors.score ?? 0) : ors.score ?? 0;
    },
    cellClass: r => {
      const ors = r.clusterBreakdown?.orsReversal;
      if (!ors || !ors.score || ors.score < 72) return 'text-slate-500';
      return ors.confirmed
        ? 'text-purple-300 font-bold bg-purple-900/30 px-1 rounded animate-pulse'
        : 'text-purple-400 font-semibold';
    } },
  { key: 'sat_signal', label: 'SAT Signal', width: 120, align: 'center',
    headerTipHtml: '<div class="rt-hdr">Self-Adaptive Trend (SAT) Signal</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">BUY</span></div><div><div class="rt-desc">Trend just flipped from DOWN to UP on the self-learning supertrend. Strongest entry signal — trend reversal confirmed.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">BOUNCE↑</span></div><div><div class="rt-desc">Price dipped into the inner bounce zone and closed back above it during an uptrend — pullback-to-trend entry.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">UP</span></div><div><div class="rt-desc">Uptrend in progress. Trend line is below price and ratcheting up. No fresh signal this bar.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-red">SELL</span></div><div><div class="rt-desc">Trend flipped from UP to DOWN — exit/short signal.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Factor</span></div><div><div class="rt-desc">The learned ATR multiple shown beside the signal is how many normal price moves of room the system has learned to allow. Lower = tighter stops. Updates as more price history accumulates.</div></div></div>',
    fmt: () => '',   // rendered custom in cell via satMap
    numVal: () => 0,
    cellClass: () => '' },
  { key: 'nearBrk', label: 'Near BRK', width: 90, align: 'center',
    headerTipHtml: '<div class="rt-hdr">Near Breakout v2 — Tiered (56,340 obs, 456 Nifty 500 stocks)</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">🔥 IMMINENT (0-1%)</span></div><div><div class="rt-desc">Breaks out within 5 days: 63.7% of the time. Within 10 days: 74.1%. Avg 3.1 days to breakout.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">⚡ NEAR (1-2.5%)</span></div><div><div class="rt-desc">Breaks out within 5 days: 43.1%. Within 10 days: 57.7%. Avg 4.4-5.5 days.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">👁 WATCH (2.5-5%)</span></div><div><div class="rt-desc">Breaks out within 5 days: 23.6%. Within 10 days: 38.9%. Avg 6-7 days.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">EARLY (5-10%)</span></div><div><div class="rt-desc">Breaks out within 5 days: only 8.3%. Within 10 days: 19.3%. Too far to act on yet.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">Key finding</span></div><div><div class="rt-desc">Distance predicts SPEED of breakout (clean monotonic relationship) but NOT quality — fakeout rate stays flat ~50-53% across every distance band. Closer = sooner, not necessarily better.</div></div></div>',
    fmt: r => r.nearBreakoutTier === 'IMMINENT' ? `🔥 ${r.nearBreakoutPct.toFixed(1)}%` : r.nearBreakoutTier === 'NEAR' ? `⚡ ${r.nearBreakoutPct.toFixed(1)}%` : r.nearBreakoutTier === 'WATCH' ? `👁 ${r.nearBreakoutPct.toFixed(1)}%` : r.nearBreakoutTier === 'EARLY' ? `${r.nearBreakoutPct.toFixed(1)}%` : '—',
    numVal: r => r.nearBreakoutTier ? -r.nearBreakoutPct : 99,
    cellClass: r => r.nearBreakoutTier === 'IMMINENT' ? 'text-green-300 font-bold bg-green-900/30 px-1 rounded animate-pulse' : r.nearBreakoutTier === 'NEAR' ? 'text-yellow-300 font-semibold' : r.nearBreakoutTier === 'WATCH' ? 'text-orange-400' : r.nearBreakoutTier === 'EARLY' ? 'text-slate-500' : 'text-slate-400' },
  { key: 'zone_exp', label: 'Zone', width: 75, align: 'left',
    headerTipHtml: '<div class="rt-hdr">Zone Explosion Badge</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">💎 EXPLODE</span></div><div><div class="rt-desc">Zone ≤20%, close 0.75–4% above, rangeATR 1–4, volExp ≥1.25, ADR 3.5–7.5%, close ≥75%, green candle</div><div class="rt-hit hit-green">63.4% hit rate (290 signals) · Rarest & strongest</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-blue">🎯 READY</span></div><div><div class="rt-desc">Zone ≤20%, close 0.75–6% above, volR20 ≥1.2, volVsPre5 ≥2.0, close ≥70%, body ≥35%</div><div class="rt-hit hit-cyan">63.5% hit rate (219 signals) · Confirmed breakout</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">— NONE</span></div><div><div class="rt-desc">No qualifying zone breakout detected (45.6% baseline hit rate)</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">Insight</span></div><div><div class="rt-desc">Zone tightness 5-15% outperforms 0-3% (55% vs 35% hit rate). Wider zones store MORE energy. Best zone length: 6-7 candles.</div><div class="rt-hit hit-cyan">Backtested on 14,457 signals across 77 stocks</div></div></div>',
    fmt: r => {
      const ze = detectZoneExplosion(r);
      return ze === 'HIGH_CONVICTION' ? '💎 EXPLODE' : ze === 'CONFIRMED' ? '🎯 READY' : '—';
    },
    numVal: r => detectZoneExplosion(r) === 'HIGH_CONVICTION' ? 2 : detectZoneExplosion(r) === 'CONFIRMED' ? 1 : 0,
    cellClass: r => {
      const ze = detectZoneExplosion(r);
      return ze === 'HIGH_CONVICTION' ? 'text-cyan-300 font-bold bg-cyan-900/30 px-1 rounded' : ze === 'CONFIRMED' ? 'text-blue-400 bg-blue-900/20 px-1 rounded' : 'text-slate-500';
    } },
  { key: 'atr_state', label: 'ATR', width: 80, align: 'left',
    headerTipHtml: '<div class="rt-hdr">ATR Compression State — Recalibrated on 3,802 signals × 1,617 stocks</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">💥 EXPLODE</span></div><div><div class="rt-desc">Pctl 35–85, rangeATR ≥1.4, ADR 3.5–7%, volR20 ≥1.4, volPre5 ≥2.0, redVolBias ≤1.2, close ≥65%, body ≥30%</div><div class="rt-hit hit-green">+2.05% avg20d, 37.9% &gt;5% moves · Grid-searched on 1,617 stocks</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-teal">🎯 INFLECT</span></div><div><div class="rt-desc">ATR percentile 35–85. Active compression zone — moderate expected returns</div><div class="rt-hit hit-cyan">+0.86–1.71% avg20d · Broad sweet spot</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">⚡ BUILD</span></div><div><div class="rt-desc">ATR percentile 20–35. Transitional zone — worst performing state in backtest</div><div class="rt-hit hit-amber">-0.60% avg20d · Wait for INFLECT or MOMEN before acting</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">💤 SLEEP</span></div><div><div class="rt-desc">ATR percentile &lt;20. Ultra-quiet coiling — surprisingly decent breakout setup</div><div class="rt-hit hit-cyan">+1.92% avg20d · Low vol pre-breakout state, 1,496 signals</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">🔥 MOMEN</span></div><div><div class="rt-desc">ATR percentile &gt;85. Highest performing state in backtest — momentum burst zone</div><div class="rt-hit hit-green">+4.51% avg20d, 60% win rate · Best single ATR state (90-100 pctl)</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Key Insight</span></div><div><div class="rt-desc">BUILD zone (20-35%) is the true danger zone (-0.60%). MOMEN (&gt;85%) is the strongest state, not a warning. EXPLODE filter now catches wider entry conditions.</div><div class="rt-hit hit-cyan">Calibrated on 3,802 breakout-context signals across 1,617 NSE stocks</div></div></div>',
    fmt: r => {
      const { state, explosion } = detectATRState(r);
      if (explosion) return '💥 EXPLODE';
      if (state === 'SWEET_SPOT') return '🎯 INFLECT';
      if (state === 'BUILDING') return '⚡ BUILD';
      if (state === 'DEEP_COMPRESSION') return '💤 SLEEP';
      if (state === 'HIGH_VOL') return '🔥 MOMEN';
      return '—';
    },
    numVal: r => { const { state, explosion } = detectATRState(r); if (explosion) return 4; if (state === 'HIGH_VOL') return 3; if (state === 'DEEP_COMPRESSION') return 2; if (state === 'SWEET_SPOT') return 1; return 0; },
    cellClass: r => {
      const { state, explosion } = detectATRState(r);
      if (explosion) return 'text-[#39FF14] font-bold bg-green-900/30 px-1 rounded';
      if (state === 'SWEET_SPOT') return 'text-cyan-300 font-bold bg-cyan-900/30 px-1 rounded';
      if (state === 'BUILDING') return 'text-yellow-400 bg-yellow-900/20 px-1 rounded';
      if (state === 'DEEP_COMPRESSION') return 'text-slate-500';
      if (state === 'HIGH_VOL') return 'text-orange-400 bg-orange-900/20 px-1 rounded';
      return 'text-slate-500';
    } },
  { key: 'vol_badge', label: 'Vol', width: 75, align: 'left',
    headerTipHtml: '<div class="rt-hdr">Volume Thrust Badge — Recalibrated on 3,802 signals × 1,617 stocks</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">🔥 THRUST</span></div><div><div class="rt-desc">volR20 ≥4.0, volVsPre5 ≥5.0, redVolBias ≤0.9, upperWick ≤15%. Key gate is clean candle (uw≤15%) — volume alone not sufficient.</div><div class="rt-hit hit-green">+2.30% avg20d, MFE +16.2% · Grid-searched on 1,617 stocks</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">✓ CONF</span></div><div><div class="rt-desc">volVsPre5 ≥2.0, volR20 ≥1.0, redVolBias ≤0.80. Sellers absent with moderate volume surge.</div><div class="rt-hit hit-cyan">+1.80% avg20d · rvb tightened from 1.10→0.80 (sellers absent = better signal)</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">— NONE</span></div><div><div class="rt-desc">No qualifying volume profile (+1.42% baseline avg20d)</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Blow-off Warning</span></div><div><div class="rt-desc">Very high volume (&gt;4× avg, D9-D10 decile) is actually NEGATIVE: -0.54% avg20d. Sweet spot is 1.5–3.0× for moderate surge. Extreme volume = institutions distributing.</div><div class="rt-hit hit-amber">Calibrated on 3,802 breakout-context signals across 1,617 NSE stocks</div></div></div>',
    fmt: r => {
      const vb = detectVolumeBadge(r);
      return vb === 'HIGH_CONVICTION' ? '🔥 THRUST' : vb === 'CONFIRMED' ? '✓ CONF' : '—';
    },
    numVal: r => detectVolumeBadge(r) === 'HIGH_CONVICTION' ? 2 : detectVolumeBadge(r) === 'CONFIRMED' ? 1 : 0,
    cellClass: r => {
      const vb = detectVolumeBadge(r);
      return vb === 'HIGH_CONVICTION' ? 'text-orange-400 font-bold bg-orange-900/20 px-1 rounded' : vb === 'CONFIRMED' ? 'text-emerald-500 bg-emerald-900/20 px-1 rounded' : 'text-slate-500';
    } },
  { key: 'missing', label: 'Missing', width: 110, align: 'left',
    fmt: r => {
      if (['BUY','STRONG_BUY','ULTRA_STRONG_BUY','NO_SIGNAL','COMPRESSION_WATCH'].includes(r.stage)) return '—';
      const fails = r.checklist?.filter(c => !c.pass).slice(0, 2).map(c => c.label.replace(/[≥≤<>]/g, '').slice(0, 15)) ?? [];
      return fails.length > 0 ? fails.join(', ') : '—';
    },
    numVal: r => r.checklist ? r.checklist.filter(c => !c.pass).length : 99,
    cellClass: r => ['PRE_BREAKOUT','EARLY_INFLECTION'].includes(r.stage) ? 'text-amber-500 text-[9px]' : 'text-slate-500 text-[9px]' },
  { key: 'pivot_pp', label: 'PP', width: 70, align: 'right',
    fmt: () => '', numVal: () => 0, cellClass: () => '' },
  { key: 'pivot_r1', label: 'R1', width: 70, align: 'right',
    fmt: () => '', numVal: () => 0, cellClass: () => '' },
  { key: 'pivot_s1', label: 'S1', width: 70, align: 'right',
    fmt: () => '', numVal: () => 0, cellClass: () => '' },
  { key: 'rs_rank', label: 'RS Rank', width: 65, align: 'right',
    fmt: () => '', numVal: () => 0, cellClass: () => '' },
  { key: 'tf_align', label: 'TF', width: 40, align: 'center',
    fmt: () => '',
    numVal: () => 0,
    cellClass: () => '' },
  { key: 'narrative', label: 'Narrative', width: 300, align: 'left',
    fmt: r => {
      if (!['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage)) return '—';
      try { const n = generateNarrative(r); return `${n.setup} ${n.entry} ${n.verdict}`; } catch { return '—'; }
    },
    numVal: () => 0, cellClass: () => 'text-slate-500 text-[9px]' },
  { key: 'track_btn', label: '📌', width: 40, align: 'center',
    fmt: () => '',
    numVal: () => 0,
    cellClass: () => '' },
  // ── Advanced Features Tab ──────────────────────────────────────────────────
  { key: 'adv_utbot', label: 'UT Bot', width: 160, align: 'center',
    headerTipHtml: '<div class="rt-hdr">UT Bot Alerts — Live buy-signal detection (two grid-search-optimal param sets)</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow-400 text-black">⚡ BOTH</span></div><div><div class="rt-desc">VWMA-55 (precision, 60.5% WR10) AND TEMA-10 (early, 57% WR10) confluence fired. When VRAM OVERSOLD + FER EFFICIENT also align: empirical ~85% WR10 from 1,617-stock grid-search backtest. Highest-conviction UT Bot setup.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-amber">PRECISION</span></div><div><div class="rt-desc">VWMA-55 / ATR14 / Sensitivity 2.0 buy signal fired. 60.5% WR10 base — fires ~14 bars after bottom. When VRAM+FER both align: +25pp lift observed in backtest. Use for high-conviction slow entries.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">EARLY</span></div><div><div class="rt-desc">TEMA-10 / ATR7 / Sensitivity 1.0 buy signal fired. 57% WR10 base — fires ~8 bars after bottom (5 bars sooner). +8-12pp lift when VRAM+FER align. Larger signal count, more actionable for active traders.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Format</span></div><div><div class="rt-desc">Shows: MODE · freshness · lag (bars from 20-bar low) · entry price (High+0.75×ATR14). Lag ≤ 5 = caught early. Entry price is ATR-based formula — best reversal entry from prior entry formula backtest.</div></div></div>',
    fmt: r => {
      const adv = r.advanced;
      // utbotMode is undefined for results scanned before the UT Bot update — show rescan hint
      if (!adv || !adv.utbotMode) return '↻ rescan';
      if (adv.utbotMode === 'NONE') return '—';
      const m     = adv.utbotMode;
      const ago   = adv.utbotBarsAgo === 0 ? 'today' : `${adv.utbotBarsAgo}d ago`;
      const lag   = `lag:${adv.utbotLag}`;
      const entry = adv.utbotEntry > 0 ? ` ₹${adv.utbotEntry.toFixed(1)}` : '';
      // APEX = UT Bot BOTH (confluence) + VRAM OVERSOLD + FER EFFICIENT — the ~85% WR10 setup
      // EARLY-only is NOT APEX: its base WR is 57%, not 85%. BOTH confluence required.
      const apex  = m === 'BOTH' &&
                    adv.vramTier === 'OVERSOLD' && adv.ferTier === 'EFFICIENT';
      if (apex) return `★ APEX · ${ago} · ${lag}${entry}`;
      const icon  = m === 'BOTH' ? '⚡ ' : '';
      return `${icon}${m} · ${ago} · ${lag}${entry}`;
    },
    numVal: r => {
      const adv = r.advanced;
      if (!adv) return 0;
      const m   = adv.utbotMode;
      const apex = m === 'BOTH' &&
                   adv.vramTier === 'OVERSOLD' && adv.ferTier === 'EFFICIENT';
      if (apex) return 10;
      return m === 'BOTH' ? 3 : m === 'PRECISION' ? 2 : m === 'EARLY' ? 1 : 0;
    },
    cellClass: r => {
      const adv = r.advanced;
      const m   = adv?.utbotMode;
      const ago = adv?.utbotBarsAgo ?? 99;
      if (!m || m === 'NONE') return 'text-slate-600 text-xs';
      const fresh = ago <= 1;
      const apex  = m === 'BOTH' &&
                    adv?.vramTier === 'OVERSOLD' && adv?.ferTier === 'EFFICIENT';
      // APEX gets a solid green background — unmissable even when scanning 500 rows
      if (apex) return `text-xs font-black ${fresh
        ? 'text-black bg-green-400 px-1 rounded animate-pulse'
        : 'text-green-300 bg-green-900/60 px-1 rounded'}`;
      if (m === 'BOTH')      return `text-xs font-bold ${fresh ? 'text-yellow-300' : 'text-yellow-500'}`;
      if (m === 'PRECISION') return `text-xs font-semibold ${fresh ? 'text-amber-300' : 'text-amber-500'}`;
      return `text-xs font-semibold ${fresh ? 'text-cyan-300' : 'text-cyan-500'}`;
    } },
  { key: 'adv_score', label: 'AdvScore', width: 80, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Advanced Score (0-100) — Empirically weighted composite of 9 signals incl. UT Bot</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">A+ (≥80)</span></div><div><div class="rt-desc">Multiple high-edge signals firing: UT Bot buy signal (BOTH/PRECISION/EARLY), VRAM oversold, TRAM oversold, FER efficient, CleanMom deep value, Duration idle, MWC contrarian. Validated vs 558,650-obs NIFTY backtest.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">A (65-79)</span></div><div><div class="rt-desc">Most signals positive. Strong mean-reversion setup with 1-2 absent confirmations. Actionable.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-amber">B (45-64)</span></div><div><div class="rt-desc">Mixed signals. Some edge but not fully confirmed across features.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">C/D (&lt;45)</span></div><div><div class="rt-desc">Few signals aligned. Low conviction from this overlay.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Weights</span></div><div><div class="rt-desc">UTBot(up to 20) + VRAM(20) + TRAM(20) + FER(15) + CleanMom(15) + Duration(10) + MWC(10) + CUSUM(5) + PIC(5) → capped 100. BOTH fresh=+20, PRECISION fresh=+12, EARLY fresh=+10.</div></div></div>',
    fmt: r => r.advanced ? `${r.advanced.advScore}` : '—',
    numVal: r => r.advanced?.advScore ?? 0,
    cellClass: r => {
      const g = r.advanced?.advGrade;
      return g === 'A+' ? 'text-green-300 font-bold bg-green-900/30 px-1 rounded' :
             g === 'A'  ? 'text-cyan-300 font-semibold' :
             g === 'B'  ? 'text-amber-400' :
             g === 'C'  ? 'text-orange-500' : 'text-slate-600';
    } },
  { key: 'adv_fer', label: 'FER', width: 72, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Fractal Efficiency Ratio (20-bar) — How linearly price trends</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">EFFICIENT (≥0.55) +3.1pp</span></div><div><div class="rt-desc">Net move covers ≥55% of total path. Price trending cleanly — backtest shows +3.11pp 20d edge at this level (monotonically positive, highest confidence feature).</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-amber">MODERATE (0.30-0.54)</span></div><div><div class="rt-desc">Some directionality with normal oscillation. Mild positive edge (~+0.5pp). Most stocks fall here.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">CHOPPY (&lt;0.30)</span></div><div><div class="rt-desc">Highly non-linear price path — noise-dominated, no clear 20-bar trend. Slight negative edge (−0.8pp).</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Formula</span></div><div><div class="rt-desc">FER = |Close[t] − Close[t-20]| / Σ|Close[i]−Close[i-1]|. Range: 0 (random walk) → 1 (straight line). Thresholds from 558,650-obs NIFTY backtest.</div></div></div>',
    fmt: r => r.advanced ? r.advanced.fer20.toFixed(2) : '—',
    numVal: r => r.advanced?.fer20 ?? 0,
    cellClass: r => {
      const t = r.advanced?.ferTier;
      return t === 'EFFICIENT' ? 'text-green-300 font-semibold' :
             t === 'MODERATE'  ? 'text-amber-400' : 'text-slate-600';
    } },
  { key: 'adv_cusum', label: 'CUSUM', width: 80, align: 'center',
    headerTipHtml: '<div class="rt-hdr">CUSUM Filter — Cumulative drift (INVERTED: low = better)</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">IDLE (S+=0) sweet spot</span></div><div><div class="rt-desc">No accumulated upward drift detected. Backtest shows IDLE is the best state — stock has NOT been chased. Slight positive edge when drift is absent.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-amber">MILD (S+ 0-0.064)</span></div><div><div class="rt-desc">Early drift accumulating. Modest positive edge still present but diminishing. Price starting to get noticed.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">ELEVATED (S+&gt;0.064) −2.4pp</span></div><div><div class="rt-desc">High accumulated drift = price has been chased. Backtest shows −2.36pp 20d edge at ELEVATED level. Overbought drift signal — avoid for new entries.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Formula</span></div><div><div class="rt-desc">S+ = max(0, S+[prev] + ret − 0.5×ATR%). Looks back 60 bars. High S+ means price kept rising above ATR-adjusted noise threshold — a chase signal, not accumulation.</div></div></div>',
    fmt: r => r.advanced ? (r.advanced.cusumTier === 'IDLE' ? 'IDLE' : `${r.advanced.cusumTier} ${r.advanced.cusumPos.toFixed(3)}`) : '—',
    numVal: r => r.advanced?.cusumPos ?? 0,
    cellClass: r => {
      const t = r.advanced?.cusumTier;
      return t === 'IDLE'     ? 'text-green-300 font-semibold' :
             t === 'MILD'     ? 'text-amber-400' :
             t === 'ELEVATED' ? 'text-red-400 font-semibold' : 'text-slate-600';
    } },
  { key: 'adv_mwc', label: 'MWC', width: 65, align: 'center',
    headerTipHtml: '<div class="rt-hdr">Momentum Wave Convergence (0-4) — CONTRARIAN: low score = not yet chased</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">Score 0-1 — CONTRARIAN +0.9pp</span></div><div><div class="rt-desc">No or minimal momentum wave aligned. Backtest shows Score 0-1 = contrarian sweet spot (+0.94pp 20d edge) — stock has NOT been chased yet. Uncrowded, ignored by trend followers.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">Score 2 — MIXED</span></div><div><div class="rt-desc">Partial alignment. Modest positive edge. Some interest building but not yet overbought.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">Score 3-4 — CROWDED −1.4pp</span></div><div><div class="rt-desc">All timeframes aligned and accelerating = everyone is already long. Score 4 shows −1.38pp 20d edge — momentum is priced in. Avoid for new entries.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Checks</span></div><div><div class="rt-desc">+1 each: ROC5&gt;ROC20 (accelerating), ROC20&gt;ROC60 (medium outpacing long), ROC5&gt;0 (short-term up), ROC5 slope rising vs 3 bars ago. High score = chased; low score = opportunity.</div></div></div>',
    fmt: r => r.advanced ? `${r.advanced.mwcScore}/4` : '—',
    numVal: r => r.advanced?.mwcScore ?? 0,
    cellClass: r => {
      const t = r.advanced?.mwcTier;
      return t === 'CONTRARIAN' ? 'text-green-300 font-semibold' :
             t === 'MIXED'      ? 'text-amber-400' : 'text-red-400';
    } },
  { key: 'adv_tram', label: 'TRAM', width: 72, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Tail-Risk Adjusted Momentum — MEAN-REVERSION: negative TRAM = oversold bounce</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">OVERSOLD (&lt;−3.0) +4.0pp</span></div><div><div class="rt-desc">ROC20 is deeply negative relative to tail risk — stock is oversold with elevated downside volatility. Backtest: +3.96pp 20d edge. Classic mean-reversion bounce setup. The negative value means upside/CVaR ratio is extreme on the downside.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">DEPRESSED (−3.0 to −1.4) +1.4pp</span></div><div><div class="rt-desc">Moderately negative TRAM — beaten down but not extreme. +1.37pp 20d edge. Recovering candidates.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-amber">NEUTRAL (−1.4 to +0.5)</span></div><div><div class="rt-desc">No clear directional tilt in risk-adjusted momentum. Near-baseline forward returns.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">EXTENDED (&gt;+0.5)</span></div><div><div class="rt-desc">High positive TRAM = momentum has run far relative to tail risk. No forward edge — overbought on this metric.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Formula</span></div><div><div class="rt-desc">TRAM = ROC_20 / |CVaR_95%|. CVaR_95% = mean of worst 5% of 60 daily returns (negative). Negative TRAM = negative ROC20 with high tail risk = oversold.</div></div></div>',
    fmt: r => r.advanced ? r.advanced.tram.toFixed(2) : '—',
    numVal: r => r.advanced?.tram ?? 0,
    cellClass: r => {
      const t = r.advanced?.tramTier;
      return t === 'OVERSOLD'  ? 'text-green-300 font-bold' :
             t === 'DEPRESSED' ? 'text-cyan-300' :
             t === 'NEUTRAL'   ? 'text-slate-400' : 'text-orange-400';
    } },
  { key: 'adv_cleanmom', label: 'CleanMom', width: 82, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Clean Momentum — ROC20 + MaxDD20 (MEAN-REVERSION: deep negative = bounce)</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">DEEP_VALUE (&lt;−28%) +3-5pp</span></div><div><div class="rt-desc">Stock has crashed hard — large negative ROC20 AND large drawdown. Backtest: −28% bin → +3.34pp, extreme bins → +5.03pp 20d edge. Classic crash-bounce mean-reversion setup. Best combined with VRAM OVERSOLD.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">RECOVERING (−28% to −10%)</span></div><div><div class="rt-desc">Moderately beaten down. Some mean-reversion potential. Mild positive edge (~+1pp).</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-amber">NEUTRAL (−10% to +11%)</span></div><div><div class="rt-desc">No strong directional tilt. Near-baseline forward returns in this range.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">OVERBOUGHT (&gt;+11%) −0.9pp</span></div><div><div class="rt-desc">Strong clean upside move already happened. Backtest shows −0.87pp 20d edge — momentum is priced in, mean-reversion risk increases.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Formula</span></div><div><div class="rt-desc">CleanMom = ROC_20% + MaxDD_20% (MaxDD is negative). Very negative = deep crash. E.g. −25% return with −20% DD → CleanMom = −45 → DEEP_VALUE.</div></div></div>',
    fmt: r => r.advanced ? `${r.advanced.cleanMom.toFixed(1)}%` : '—',
    numVal: r => r.advanced?.cleanMom ?? 0,
    cellClass: r => {
      const t = r.advanced?.cleanTier;
      return t === 'DEEP_VALUE'  ? 'text-green-300 font-bold' :
             t === 'RECOVERING'  ? 'text-cyan-300' :
             t === 'NEUTRAL'     ? 'text-slate-400' : 'text-orange-400';
    } },
  { key: 'adv_regime', label: 'Regime', width: 90, align: 'center',
    headerTipHtml: '<div class="rt-hdr">Regime Duration — IDLE (not in a run) is the sweet spot (+1.6pp)</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">IDLE — not in run +1.6pp</span></div><div><div class="rt-desc">Stock is NOT currently in a momentum run. Backtest shows IDLE = +1.59pp 20d edge — uncrowded, no active trend chasers. Once a run starts, forward returns worsen progressively.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">EARLY (&lt;30% of avg run)</span></div><div><div class="rt-desc">Run just started. Mild positive edge early on (+0.4pp) before chasers pile in.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-amber">MID (30-76% of avg run)</span></div><div><div class="rt-desc">Run in middle phase. Forward edge diminishing. Return is mostly priced in.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">EXTENDED (&gt;76% of avg run)</span></div><div><div class="rt-desc">Run has exceeded 76% of historical average length. Backtest shows worsening returns. Tail end of momentum cycle.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Method</span></div><div><div class="rt-desc">Identifies prior momentum runs (≥3 bars with 5D return &gt; 1 ATR%). DurationRatio = current run / avg past run. IDLE when no run is active.</div></div></div>',
    fmt: r => {
      if (!r.advanced) return '—';
      const { durationTier, regimeDays } = r.advanced;
      return durationTier === 'IDLE' ? 'IDLE' : `${durationTier} ${regimeDays}d`;
    },
    numVal: r => r.advanced?.durationRatio ?? 0,
    cellClass: r => {
      const t = r.advanced?.durationTier;
      return t === 'IDLE'     ? 'text-green-300 font-semibold' :
             t === 'EARLY'    ? 'text-cyan-300' :
             t === 'MID'      ? 'text-amber-400' : 'text-red-400';
    } },
  { key: 'adv_vram', label: 'VRAM', width: 72, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Vol-Regime Adjusted Momentum — INVERTED: low z-score = oversold = best entry</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">OVERSOLD (z&lt;−1.1) +4.6pp</span></div><div><div class="rt-desc">Stock is &gt;1.1 std devs BELOW its own historical mean within same vol regime. Strongest single signal: +4.64pp 20d edge. Significantly underperforming vs its own history = oversold mean-reversion setup.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">LOW (z −1.1 to −0.76) +2.9pp</span></div><div><div class="rt-desc">Moderately below regime average. +2.93pp 20d edge. Solid contrarian setup.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-amber">NEUTRAL (z −0.76 to +0.35)</span></div><div><div class="rt-desc">Near the regime average. No strong directional tilt. Near-baseline forward returns.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">ELEVATED (z +0.35 to +0.93)</span></div><div><div class="rt-desc">Modestly above regime average. Mild positive edge (+1pp) but momentum partly priced in.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">OVERBOUGHT (z&gt;+0.93) −1.1pp</span></div><div><div class="rt-desc">Significantly outperforming vs its own vol-regime history. Overbought — backtest shows −1.14pp 20d edge. Mean-reversion risk. Avoid new entries.</div></div></div>',
    fmt: r => r.advanced ? `${r.advanced.vram.toFixed(2)}z` : '—',
    numVal: r => r.advanced?.vram ?? 0,
    cellClass: r => {
      const t = r.advanced?.vramTier;
      return t === 'OVERSOLD'   ? 'text-green-300 font-bold' :
             t === 'LOW'        ? 'text-cyan-300' :
             t === 'NEUTRAL'    ? 'text-slate-400' :
             t === 'ELEVATED'   ? 'text-amber-400' : 'text-red-400';
    } },
  { key: 'adv_pic', label: 'PIC', width: 65, align: 'right',
    headerTipHtml: '<div class="rt-hdr">Price Impact Coefficient — Mid-range PIC (16-25) has modest edge (+1pp)</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">ACTIVE (16-25) +1.0pp</span></div><div><div class="rt-desc">Price responds efficiently to flow — not too thin, not too reactive. Sweet spot from backtest: +0.96pp 20d edge. Healthy market microstructure with genuine two-sided activity.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">HIGH (25-30)</span></div><div><div class="rt-desc">Slightly reactive. Near-neutral edge (+0.4pp). Volume moves price a bit more than average.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-amber">FAIR (8-16)</span></div><div><div class="rt-desc">Below-average price sensitivity per unit of flow. Mild positive edge. Normal range.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">SATURATED (&gt;30)</span></div><div><div class="rt-desc">Very high PIC — price jumps sharply per unit of signed flow. Thin book or news-driven. Neutral to slightly negative forward edge (−0.6pp).</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">REACTIVE_LOW (&lt;8) −1.0pp</span></div><div><div class="rt-desc">Price barely responds to flow despite signed volume. Weak edge (−1pp). Structural low-sensitivity that historically underperforms.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Method</span></div><div><div class="rt-desc">OLS: signed_volume (normalised) → daily return. Beta × 1000. Over last 20 bars. Note: this feature has modest discriminating power (~1pp max edge).</div></div></div>',
    fmt: r => r.advanced ? r.advanced.pic.toFixed(1) : '—',
    numVal: r => r.advanced?.pic ?? 0,
    cellClass: r => {
      const t = r.advanced?.picTier;
      return t === 'ACTIVE'       ? 'text-green-300 font-semibold' :
             t === 'HIGH'         ? 'text-cyan-300' :
             t === 'FAIR'         ? 'text-slate-400' :
             t === 'SATURATED'    ? 'text-amber-400' : 'text-red-400';
    } },
];

type ScannerSubTab = 'overview' | 'screening' | 'tradeplan' | 'momentum' | 'statistics' | 'advanced' | 'all';

const SUBTAB_KEYS: Record<ScannerSubTab, Set<string>> = {
  overview: new Set(['symbol','sector','conviction','stage','confluenceScore','archetypeType','sat_signal','inflectionScore','confidence','cmp','dayChg','atr14pct','candle','candleDNA','guppy','pe_entry','pe_tact','pe_risk','pe_rr','pe_rr_verdict','brain','pcaScore','monster','zone_exp','atr_state','vol_badge','rs_rank','tf_align','momentumScore','statsScore','ors_reversal','nearBrk','brkTier','dd52WH','missing','track_btn']),
  screening: new Set(['symbol','stage','clDep','clHP','clElt','clUS','clSN','ors_reversal','volRatio20','atrPct14Pctl120','zone_atr','closeLoc','upperWickPct','ultraPrecisionScore','volatilityExpansionRatio']),
  tradeplan: new Set(['symbol','stage','cmp','candle','guppy','ema10','ema21','ema55','sma200','pe_er','pe_entry','pe_tact','pe_risk','pe_rr','pe_rr_verdict','pe_rps','pe_t1','pe_t2','pe_t3r','pivot_pp','pivot_r1','pivot_s1','pe_gap','pe_gATR','pe_status','pe_valid','pe_chT1','pe_chT2','track_btn']),
  momentum: new Set(['symbol','stage','sat_signal','archetypeType','confluenceScore','brain','pcaScore','monster','candleDNA','momentumScore','emaAligned','higherLow','volDryUp','obvSlope','adx14','gapRR','rsNifty','clenow','ultraPrecisionScore','volatilityExpansionRatio','volRatio20']),
  statistics: new Set(['symbol','stage','statsScore','guppy','ttmSqz','ttmMom','rsi14','cci34','volZ','bbPctl','hurst','dd52WH','pct52WL','brkTier','sharpe','insBar']),
  advanced: new Set(['symbol','stage','adv_utbot','adv_score','adv_fer','adv_cusum','adv_mwc','adv_tram','adv_cleanmom','adv_regime','adv_vram','adv_pic']),
  all: new Set(/* all keys — handled below */),
};

const SUBTAB_META: Array<{ key: ScannerSubTab; label: string; emoji: string; color: string; tip: string; tipColor: string }> = [
  { key: 'overview',   label: 'Overview',    emoji: '📊', color: '#60a5fa', tip: 'Key columns: Stage, Conviction, Entry, R:R, Verdict, RS Rank', tipColor: 'blue' },
  { key: 'screening',  label: 'Screening',   emoji: '🔬', color: '#a78bfa', tip: 'Screening parameters: ATR, zone, volume ratios, UPS, CQS', tipColor: 'purple' },
  { key: 'tradeplan',  label: 'Trade Plan',  emoji: '💰', color: '#34d399', tip: 'Full trade engine: Entry, Stop, Targets, R:R, Gap%, EMAs', tipColor: 'green' },
  { key: 'momentum',   label: 'Momentum',    emoji: '📈', color: '#fb923c', tip: 'Momentum quality: EMA alignment, OBV, ADX, vol dry-up', tipColor: 'orange' },
  { key: 'statistics', label: 'Statistics',   emoji: '📉', color: '#22d3ee', tip: 'Statistical edge: TTM Squeeze, Hurst, GARCH, entropy, BB/KC', tipColor: 'cyan' },
  { key: 'advanced',   label: 'Advanced',     emoji: '🧠', color: '#e879f9', tip: 'Advanced predictive features: FER, CUSUM, MWC, TRAM, CleanMom, Regime Duration, VRAM, PIC', tipColor: 'purple' },
  { key: 'all',        label: 'All',          emoji: '⊡',  color: '#94a3b8', tip: 'All 60+ columns visible — use horizontal scroll', tipColor: 'blue' },
];

function getVisibleColumns(subtab: ScannerSubTab) {
  if (subtab === 'all') return COLUMNS;
  const keys = SUBTAB_KEYS[subtab];
  return COLUMNS.filter(c => keys.has(c.key));
}

function getTableWidth(cols: ColDef[]) { return cols.reduce((s, c) => s + c.width, 0); }

function safeFmt(fmt: (r: AnalysisResult) => string): (r: AnalysisResult) => string {
  return (r: AnalysisResult) => { try { return fmt(r); } catch { return '—'; } };
}
function safeNum(fn?: (r: AnalysisResult) => number): ((r: AnalysisResult) => number) | undefined {
  if (!fn) return undefined;
  return (r: AnalysisResult) => { try { return fn(r); } catch { return 0; } };
}
function safeCls(fn?: (r: AnalysisResult) => string): ((r: AnalysisResult) => string) | undefined {
  if (!fn) return undefined;
  return (r: AnalysisResult) => { try { return fn(r); } catch { return 'text-slate-500'; } };
}

// Apply a filter string to a formatted cell value.
// Supports: ">50" ">=50" "<50" "<=50" "=50" or plain text/number (contains match).
function matchesFilter(formatted: string, filter: string): boolean {
  if (!filter) return true;
  const f = filter.trim();
  if (!f) return true;

  const numMatch = f.match(/^(>=|<=|!=|>|<|=)\s*(-?[\d.]+)$/);
  if (numMatch) {
    const op = numMatch[1];
    const threshold = parseFloat(numMatch[2]);
    if (isNaN(threshold)) return formatted.toLowerCase().includes(f.toLowerCase());
    const cellNum = parseFloat(formatted.replace(/[^0-9.-]/g, ''));
    if (isNaN(cellNum)) return false;
    if (op === '>')  return cellNum > threshold;
    if (op === '>=') return cellNum >= threshold;
    if (op === '<')  return cellNum < threshold;
    if (op === '<=') return cellNum <= threshold;
    if (op === '=')  return cellNum === threshold;
    if (op === '!=') return cellNum !== threshold;
  }
  // Plain text — case-insensitive contains
  return formatted.toLowerCase().includes(f.toLowerCase());
}

function parseSymbols(text: string): string[] {
  return text
    .split(/[\n,;\t]+/)
    .map(s => s.trim().replace(/^["']|["']$/g, '').toUpperCase())
    .filter(s => s.length > 0 && s.length <= 20 && /^[A-Z0-9.&-]+$/.test(s));
}

function parseCSV(text: string): string[] {
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];

  function splitLine(line: string): string[] {
    const cols: string[] = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cols.push(cur.trim());
    return cols;
  }

  const SYMBOL_EXACT = ['SYMBOL','SYMBOLS','TICKER','TICKERS','SCRIP','SCRIPS','STOCK','STOCKS','SCRIPT','SCRIPTS','NSE_SYMBOL','BSE_SYMBOL','CODE','NAME','COMPANY','SCRIP_NAME','SCRIP_CODE','STOCK_NAME','STOCK_CODE','TRADING_SYMBOL','TRADINGSYMBOL','ISIN','NSESYMBOL','BSESYMBOL','INSTRUMENT','SECURITY'];
  // Scan first 5 lines for the actual header row (skip title/label rows like "Stock Index,,,,")
  let headerRow = 0, symCol = -1;
  for (let r = 0; r < Math.min(5, lines.length); r++) {
    const cols = splitLine(lines[r]).map(h => h.replace(/^["']|["']$/g, '').trim().toUpperCase());
    // Skip rows with mostly empty columns (title rows)
    const nonEmpty = cols.filter(c => c.length > 0).length;
    if (nonEmpty < 2) continue;
    // Exact match first
    const exact = cols.findIndex(h => SYMBOL_EXACT.includes(h));
    if (exact >= 0) { headerRow = r; symCol = exact; break; }
    // Fuzzy match
    const fuzzy = cols.findIndex(h => /SYMBOL|STOCK|SCRIP|TICKER|SECURITY|INSTRUMENT/.test(h) && h !== 'STOCK INDEX');
    if (fuzzy >= 0) { headerRow = r; symCol = fuzzy; break; }
  }
  // Auto-detect: find column with most stock-like values
  if (symCol < 0 && lines.length >= 3) {
    let bestCol = -1, bestScore = 0;
    const startRow = headerRow + 1;
    const sampleRows = lines.slice(startRow, Math.min(startRow + 10, lines.length));
    const colCount = splitLine(lines[Math.min(headerRow, lines.length - 1)]).length;
    for (let c = 0; c < colCount; c++) {
      let score = 0;
      const seen = new Set();
      for (const row of sampleRows) {
        const val = (splitLine(row)[c] ?? '').replace(/^["']|["']$/g, '').trim();
        if (val.length >= 2 && val.length <= 20 && /^[A-Za-z0-9][A-Za-z0-9.&-]*$/.test(val) && !/^\d+(\.\d+)?$/.test(val) && /[A-Za-z]/.test(val)) { score++; seen.add(val); }
      }
      // Penalize columns with low uniqueness (EQ, POS, NEG repeat = not stock names)
      const uniqueRatio = sampleRows.length > 0 ? seen.size / sampleRows.length : 0;
      if (uniqueRatio < 0.5) score = Math.floor(score * 0.3);
      if (score > bestScore) { bestScore = score; bestCol = c; }
    }
    if (bestScore >= Math.min(3, sampleRows.length * 0.5)) symCol = bestCol;
  }
  const dataStart = symCol >= 0 ? headerRow + 1 : 0;
  if (symCol < 0) symCol = 0;

  const syms: string[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    const raw = (cols[symCol] ?? '').replace(/^["']|["']$/g, '').trim().toUpperCase();
    if (raw && raw.length > 0 && raw.length <= 20 && /^[A-Z0-9.&-]+$/.test(raw)) {
      syms.push(raw);
    }
  }
  return [...new Set(syms)];
}

function HomePageInner() {
  const [paramSetKey, setParamSetKey] = useState<ParamSetKey>('optimized_deployable_20plus');
  const [scanAll, setScanAll] = useState(false);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [stopAlerts, setStopAlerts] = useState<Array<{symbol: string; stopPrice: number; timestamp: string; entryPrice: number}>>([]);
  const [gapAlert, setGapAlert] = useState<{type:'bullish'|'bearish'|null;gapPct:number;vix:number;confidence:number;prevClose:number;todayOpen:number}|null>(null);
  const [flagMap, setFlagMap] = useState<Record<string, {poleGain: number; flagDays: number; measuredTarget: number}>>({});
  const [guppyCoilMap, setGuppyCoilMap] = useState<Record<string, {avgSpread: number; minSpread: number}>>({});
  const [clenowMap, setClenowMap] = useState<Record<string, {score: number; r2: number; annReturn: number; quality: string}>>({});
  const [satMap, setSatMap] = useState<Record<string, SelfAdaptiveTrendResult>>({});
  const [pcaMap, setPcaMap] = useState<Record<string, {score: number; rank: string; pctl: number; species: string; speciesEmoji: string; candle: number; compression: number; volume: number}>>({});
  const [sectorFlowMap, setSectorFlowMap] = useState<Record<string, SectorFlowScore>>({});
  const [sectorBreadthList, setSectorBreadthList] = useState<SectorBreadth[]>([]);
  const [bulkFlowMap, setBulkFlowMap] = useState<Record<string, BulkFlowScore>>({});
  const [bulkHealth, setBulkHealth] = useState<BulkIngestionHealth | null>(null);
  // Sprint 4+5: flow filter / kill switches / weight tuning / settings panel
  const [focusFlowFilter, setFocusFlowFilter] = useState<'all'|'bulk'|'bulk_high'|'sector_in'|'synergy'>('all');
  const [sectorFlowOn, setSectorFlowOn] = useState(() => { try { return localStorage.getItem('qtp_sf_on') !== 'false'; } catch { return true; } });
  const [bulkFlowOn, setBulkFlowOn] = useState(() => { try { return localStorage.getItem('qtp_bf_on') !== 'false'; } catch { return true; } });
  const [sectorFlowW, setSectorFlowW] = useState(() => { try { return parseFloat(localStorage.getItem('qtp_sf_w') ?? '1'); } catch { return 1; } });
  const [bulkFlowW, setBulkFlowW] = useState(() => { try { return parseFloat(localStorage.getItem('qtp_bf_w') ?? '1'); } catch { return 1; } });
  const [showFlowSettings, setShowFlowSettings] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [brainInsights, setBrainInsights] = useState<any>(null);
  const [showAllSignals, setShowAllSignals] = useState(false);
  const [fiiSellStreak, setFiiSellStreak] = useState<number>(() => {
    try { return Math.max(0, parseInt(localStorage.getItem('qtp_fii_streak') || '0') || 0); } catch { return 0; }
  });
  const [brainScores, setBrainScores] = useState<Record<string, {original: number; brain: number; adjustments: Array<{factor: string; adj: number; reason: string; engine?: string}>; riskPct: number; riskLabel: string; ciLow: number; ciHigh: number; formLabel: string; formEMA: string; formTrend: string; anomalyCount: number; anomalyNote: string; priority?: number; confidence?: string; premortem?: {winRate: number; verdict: string; matches: Array<{symbol: string; conviction: number; status: string; pnlPct: number; similarity: number}>} | null}>>({});
  const [scanning, setScanning] = useState(false);
  const scanningRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [errCount, setErrCount] = useState(0);
  const [lastErr, setLastErr] = useState('');
  const [failedSymbols, setFailedSymbols] = useState<Array<{sym: string; err: string}>>([]);
  const [showFailedPanel, setShowFailedPanel] = useState(false);
  const [deadSymbols, setDeadSymbols] = useState<Set<string>>(() => {
    try { const s = localStorage.getItem('qtp_dead_symbols'); return s ? new Set(JSON.parse(s) as string[]) : new Set<string>(); } catch { return new Set<string>(); }
  });
  const [skippedDeadCount, setSkippedDeadCount] = useState(0);
  const [stageFilter, setStageFilter] = useState<StageRating | 'ALL'>('ALL');
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState('inflectionScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [globalSearch, setGlobalSearch] = useState('');
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [scannerSubTab, setScannerSubTab] = useState<ScannerSubTab>('overview');
  const [lookback, setLookback] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastScanSymbols, setLastScanSymbols] = useState<string[]>([]);
  const [secondarySortCol, setSecondarySortCol] = useState<string | null>(null);
  const [secondarySortDir, setSecondarySortDir] = useState<'asc' | 'desc'>('desc');
  const [niftyCandles, setNiftyCandles] = useState<Candle[] | null>(null);
  const [vixCandles, setVixCandles] = useState<Candle[] | null>(null);
  const [previousResults, setPreviousResults] = useState<AnalysisResult[]>([]);
  const [accountSize, setAccountSize] = useState(1000000);
  const [showRiskSizer, setShowRiskSizer] = useState(false);
  const [showHeatMap, setShowHeatMap] = useState(false);
  const [showDataQuality, setShowDataQuality] = useState(false);
  const [trackedTrades, setTrackedTrades] = useState<TrackedTrade[]>([]);
  const resultsRef = useRef<AnalysisResult[]>([]);
  resultsRef.current = results;
  const trackedTradesRef = useRef<TrackedTrade[]>([]);
  const tradesLoadedRef = useRef(false); // prevents save effect from firing before cloud load
  trackedTradesRef.current = trackedTrades;
  const [showTracker, setShowTracker] = useState(false);
  const [autoTrackCount, setAutoTrackCount] = useState(0);
  // Trade daily log
  const [logSymbol, setLogSymbol] = useState<string | null>(null);
  type DailyLogRow = { date: string; open: number; high: number; low: number; close: number; day_num: number; mfe_pct: number; mae_pct: number; event_type: string | null; event_detail: string | null };
  const [logRows, setLogRows] = useState<DailyLogRow[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logShareCopied, setLogShareCopied] = useState(false);
  const [showTopPicks, setShowTopPicks] = useState(true);
  const [quickFilter, setQuickFilter] = useState<QuickFilterKey>('all');
  const [marketRegime, setMarketRegime] = useState<RegimeInfo | null>(null);
  const [showTradeSheet, setShowTradeSheet] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [signalHistory, setSignalHistory] = useState<SignalHistory>({});
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [candleCache, setCandleCache] = useState<Record<string, Candle[]>>({});
  const [activeTab, setActiveTab] = useState<'scanner' | 'performance' | 'tradedesk' | 'tradelog' | 'journal' | 'focus' | 'validation' | 'intelligence' | 'pbfb' | 'pro'>('scanner');
  const [sessions, setSessions] = useState<ScanSession[]>([]);
  const [favorites, setFavorites] = useState<ScanFavorite[]>([]);
  const [reviews, setReviews] = useState<TradeReview[]>([]);
  const [showRulesCheck, setShowRulesCheck] = useState(false);
  const [rulesChecked, setRulesChecked] = useState<Set<string>>(new Set());
  const [showSessions, setShowSessions] = useState(false);
  const [scanSource, setScanSource] = useState('Custom');
  const [sessionDiff, setSessionDiff] = useState<SessionDiff | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const sessionImportRef = useRef<HTMLInputElement>(null);
  const [multiStageFilter, setMultiStageFilter] = useState<Set<StageRating>>(new Set());
  const [scanStartTime, setScanStartTime] = useState(0);
  const [scanEndTime, setScanEndTime] = useState<string>('');
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [selectedRowIdx, setSelectedRowIdx] = useState(-1);

  const abortRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const botScrollRef = useRef<HTMLDivElement>(null);

  // Feature #2: localStorage persistence
  useEffect(() => {
    if (results.length > 0) {
      try { localStorage.setItem('qtp_paramSetKey', paramSetKey); } catch {}
      // Don't persist full results to localStorage — use sessions instead
    }
  }, [results, paramSetKey]);

  useEffect(() => {
    // ─── TRACKED TRADES: Cloud-first load (Supabase → localStorage fallback) ───
    const migrateTrades = (loadedTrades: TrackedTrade[]) => {
      tradesLoadedRef.current = true;
      if (loadedTrades.length === 0) { setTrackedTrades([]); return; }
      const tickFn = (p: number) => Math.round(p / 0.05) * 0.05;
      const migrated = loadedTrades.map(t => {
        if (!t.entryPrice || !t.target1 || t.target1 <= t.entryPrice) return t;
        const t1Pct = (t.target1 - t.entryPrice) / t.entryPrice * 100;
        // T1=1.5×ATR (absolute). Since T1=0.75×oldRisk and oldRisk=2×ATR, t1Pct≈1.5×ATR%.
        // Targets haven't moved — derive implied ATR to recompute T2/T3.
        const riskPct = Math.max(t1Pct / 0.75, 2.5); // implied old-risk; used only for T2/T3 migration
        const t2Pct   = 1.5 * riskPct;               // T2 = 3×ATR ≈ 1.5×risk
        const t3Pct   = 2.5 * riskPct;               // T3 = 5×ATR ≈ 2.5×risk
        const t2New = tickFn(t.entryPrice * (1 + t2Pct / 100));
        const t3New = tickFn(Math.max(t.entryPrice * (1 + t3Pct / 100), t2New + 0.05));
        // Only migrate if stored T2 is materially wrong (gap < 60% of expected)
        const oldGap = (t.target2 ?? 0) - t.target1;
        const expectedGap = t.entryPrice * ((t2Pct - t1Pct) / 100);
        if (oldGap < expectedGap * 0.6) return { ...t, target2: t2New, target3: t3New };
        return t;
      });
      // Auto-heal trades with inverted stop loss (SL ≥ entry price — data corruption artifact)
      const healed = migrated.map(t => {
        if (t.entryPrice > 0 && t.stopLoss > 0 && t.stopLoss >= t.entryPrice) {
          return { ...t, stopLoss: 0, status: 'open' as const, closedPrice: undefined, closedDate: undefined, pnlPct: undefined, pnlR: undefined };
        }
        return t;
      });
      const anyHealed = healed.some((t, i) => t !== migrated[i]);
      setTrackedTrades(healed);
      if (anyHealed) {
        // Force-overwrite ALL localStorage keys including emergency backup so stale inverted-SL
        // data can never win by trade-count on next load.
        const healedJson = JSON.stringify(healed);
        try { localStorage.setItem('qtp_tracked_trades', healedJson); } catch {}
        try { localStorage.setItem('qtp_tracked_trades_backup', healedJson); } catch {}
        try { localStorage.setItem('qtp_tracked_trades_emergency', healedJson); } catch {}
        syncTradesToCloud(healed);
      }
    };

    // Cloud-first load. null=error (use localStorage), []=healthy empty, [...]=use cloud.
    loadTradesFromCloud().then(cloudTrades => {
      if (cloudTrades === null) {
        // Cloud error — fall back to localStorage, don't attempt re-seed (may be transient)
        migrateTrades(loadTradesFromLocal());
      } else if (cloudTrades.length > 0) {
        // Cloud has authoritative data
        migrateTrades(cloudTrades);
      } else {
        // Cloud healthy but empty — seed from localStorage if available (new device onboarding)
        const local = loadTradesFromLocal();
        migrateTrades(local);
        if (local.length > 0) syncTradesToCloud(local);
      }
    }).catch(() => {
      migrateTrades(loadTradesFromLocal());
    });

    // ─── OTHER SETTINGS: Load individually (failures are isolated) ───
    try { localStorage.removeItem('qtp_results'); } catch {}
    try { const savedKey = localStorage.getItem('qtp_paramSetKey'); if (savedKey) setParamSetKey(savedKey as ParamSetKey); } catch {}
    try { setWatchlist(loadWatchlist()); } catch {}
    try { setSignalHistory(loadSignalHistory()); } catch {}
    try { setSessions(loadSessions()); } catch {}
    try { setFavorites(loadFavorites()); } catch {}
    try { setReviews(loadReviews()); } catch {}
    try { const savedTheme = localStorage.getItem('qtp_theme'); if (savedTheme === 'light') setTheme('light'); } catch {}
    try { setTgConfig(loadTelegramConfig()); } catch {}
    try {
      const savedParamSet = localStorage.getItem('qtp_paramset');
      if (savedParamSet === 'ALL4') setScanAll(true);
      else if (savedParamSet && PARAM_SET_OPTIONS.some(o => o.key === savedParamSet)) setParamSetKey(savedParamSet as ParamSetKey);
    } catch {}
    // NO localStorage.clear() fallback — never nuke tracked trades
  }, []);

  // Persist tracked trades — Supabase cloud + localStorage mirror
  // Guard: skip until cloud load has completed to avoid wiping localStorage with []
  useEffect(() => {
    if (!tradesLoadedRef.current) return;
    syncTradesToCloud(trackedTrades);
  }, [trackedTrades]);

  // P2: Daily off-device auto-backup. The triple-redundancy above all lives
  // in the SAME browser's localStorage — clearing browser data, switching
  // devices, or an OS reinstall wipes all three copies at once. This drops
  // one dated JSON file into Downloads at most once per calendar day, so a
  // real off-device copy exists without relying on the user remembering to
  // click Export.
  useEffect(() => {
    if (trackedTrades.length === 0) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const lastBackup = localStorage.getItem('qtp_last_autobackup_date');
      if (lastBackup === today) return;
      const json = JSON.stringify(trackedTrades, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `DrKKR_Trades_AutoBackup_${today}.json`;
      a.click();
      URL.revokeObjectURL(url);
      localStorage.setItem('qtp_last_autobackup_date', today);
    } catch { /* non-critical — manual Export button still available */ }
  }, [trackedTrades]);

  // #3: Update signal history when results change
  useEffect(() => {
    if (results.length > 0) {
      setSignalHistory(prev => {
        const updated = updateSignalHistory(results, prev);
        saveSignalHistory(updated);
        return updated;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.length]);

  // Theme persistence
  useEffect(() => {
    try { localStorage.setItem('qtp_theme', theme); } catch {}
  }, [theme]);

  // Compute market regime from nifty candles
  useEffect(() => {
    if (niftyCandles && niftyCandles.length > 50) {
      setMarketRegime(detectMarketRegime(niftyCandles, vixCandles ?? undefined));
    }
  }, [niftyCandles, vixCandles]);

  // Keyboard shortcuts moved after filteredResults declaration

  const visibleColumns = useMemo(() => {
    return getVisibleColumns(scannerSubTab).map(c => ({
      ...c, fmt: safeFmt(c.fmt), numVal: safeNum(c.numVal), cellClass: safeCls(c.cellClass),
    }));
  }, [scannerSubTab]);
  const tableWidth = useMemo(() => getTableWidth(visibleColumns), [visibleColumns]);

  // Sync top ↔ bottom scrollbars (width + scroll position)
  const [actualTableWidth, setActualTableWidth] = useState(0);
  useEffect(() => {
    const top = topScrollRef.current;
    const bot = botScrollRef.current;
    if (!top || !bot) return;

    // Sync inner width of top scrollbar to actual scrollWidth of bottom
    const syncWidth = () => {
      const sw = bot.scrollWidth;
      if (sw > 0) setActualTableWidth(sw);
    };
    syncWidth();
    const resizeObs = new ResizeObserver(syncWidth);
    resizeObs.observe(bot);

    let source: 'top' | 'bot' | null = null;
    let rafId = 0;
    const onTop = () => {
      if (source === 'bot') return;
      source = 'top';
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => { bot.scrollLeft = top.scrollLeft; source = null; });
    };
    const onBot = () => {
      if (source === 'top') return;
      source = 'bot';
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => { top.scrollLeft = bot.scrollLeft; source = null; });
    };
    top.addEventListener('scroll', onTop);
    bot.addEventListener('scroll', onBot);
    return () => { top.removeEventListener('scroll', onTop); bot.removeEventListener('scroll', onBot); resizeObs.disconnect(); cancelAnimationFrame(rafId); };
  }, [results.length, visibleColumns.length]);

  const runScan = useCallback(async (symbols: string[]) => {
    if (scanningRef.current) return;
    // #10: Dedup guard
    const { unique: dedupedSymbols, removed } = deduplicateSymbols(symbols);
    if (removed > 0) console.log(`Removed ${removed} duplicate symbols`);
    // Skip known-delisted symbols — they were auto-blacklisted on a previous scan
    const scanSymbols = dedupedSymbols.filter(s => !deadSymbols.has(s));
    const skipped = dedupedSymbols.length - scanSymbols.length;

    abortRef.current = false;
    const preScanSnapshot = resultsRef.current;
    setPreviousResults(preScanSnapshot);
    setScanning(true); scanningRef.current = true;
    try {
    setResults([]);
    setSelectedRowIdx(-1);
    setProgress(0);
    setErrCount(0);
    setLastErr('');
    setFailedSymbols([]);
    setSkippedDeadCount(skipped);
    setTotal(scanSymbols.length);
    setSelectedSymbol(null);
    setStageFilter('ALL');
    setColFilters({});
    setGlobalSearch('');

    const newResults: AnalysisResult[] = [];
    const freshCandleMap: Record<string, Candle[]> = {};
    const freshFullCandleMap: Record<string, Candle[]> = {};  // full history for post-scan cluster breakdown
    const freshClenowMap: Record<string, {score: number; r2: number; annReturn: number; quality: string}> = {};
    const freshSatMap: Record<string, SelfAdaptiveTrendResult> = {};
    const newFailed: Array<{sym: string; err: string}> = [];
    const CONCURRENCY = 12;
    const queue = [...scanSymbols];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flushResults() {
      setResults([...newResults]);
    }

    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(() => { flushTimer = null; if (!abortRef.current) flushResults(); }, 300);
    }

    // Sector Flow (Phase 2): fetch 13 sector indices in parallel with the stock scan.
    // fetchSectorIndexData never throws — failed indices come back as stale/missing.
    const sectorIndexPromise = fetchSectorIndexData();
    const stockSeriesForFlow: StockSeries[] = [];

    // Feature #4: Fetch Nifty 50 + VIX candles (every scan — keeps regime/VIX fresh)
    let niftyData: Candle[] | null = niftyCandles;
    try {
      const [nR, vR] = await Promise.allSettled([fetchOHLCVClient('^NSEI'), fetchOHLCVClient('^INDIAVIX')]);
      const nc = nR.status === 'fulfilled' ? nR.value.candles : null;
      const vc = vR.status === 'fulfilled' ? vR.value.candles : null;
      if (nc && nc.length > 50) { niftyData = nc; setNiftyCandles(nc); }
      if (vc && vc.length > 20) setVixCandles(vc);
    } catch {
      if (!niftyData) {
        try {
          const { candles: nc } = await fetchOHLCVClient('NIFTY_50.NS');
          niftyData = nc; setNiftyCandles(nc);
        } catch {}
      }
    }
    // Start ETA clock only after the Nifty/VIX prefetch — otherwise those 3-5s inflate perStock estimate
    setScanStartTime(Date.now());

    async function processOne(sym: string) {
      if (abortRef.current) return;
      try {
        const { candles, resolvedSymbol } = await fetchOHLCVClient(sym);
        if (abortRef.current) return;
        let result: AnalysisResult;
        if (scanAll) {
          const multi = analyzeStockMulti(candles, resolvedSymbol);
          result = multi.best;
        } else if (lookback > 1) {
          result = analyzeStockWithLookback(candles, paramSetKey, lookback);
          result.symbol = resolvedSymbol.trim();
        } else {
          result = analyzeStock(candles, paramSetKey);
          result.symbol = resolvedSymbol.trim();
        }
        // Monster scan
        result.monster = detectMonster(candles, candles.length - 1, result);
        // Feature #4: compute RS vs Nifty
        if (niftyData && niftyData.length > 20) {
          const rs = computeRSvsNifty(candles, niftyData, 20);
          result.momentum = { ...result.momentum, rsNifty20: Number.isFinite(rs) ? rs : 1.0 };
        }
        // Clenow score computed before slice while full candle array available
        if (candles.length >= 130) {
          const cl = computeClenowScore(candles, 125);
          const quality = cl.r2 >= 0.7 ? 'SMOOTH' : cl.r2 >= 0.4 ? 'MODERATE' : 'CHOPPY';
          freshClenowMap[result.symbol] = { score: cl.score, r2: cl.r2, annReturn: cl.annReturn, quality };
        }
        // Self-Adaptive Supertrend signal
        if (candles.length >= 30) {
          freshSatMap[result.symbol] = computeSelfAdaptiveTrend(candles);
        }
        // Sector Flow: capture close series tail (dates in IST) for post-scan divergence pass
        const flowTail = candles.slice(-15);
        stockSeriesForFlow.push({
          symbol: result.symbol,
          dates: flowTail.map(k => new Date((k.ts + 19800) * 1000).toISOString().slice(0, 10)),
          closes: flowTail.map(k => k.c),
          avgTurnover20: result.avgTurnover20 ?? 0,
        });
        // Cache candles for sparkline + production backtest (batched — setCandleCache called once post-scan)
        const sliced = candles.slice(-400);
        freshCandleMap[result.symbol] = sliced;
        // Keep full history for post-scan cluster breakdown (not in React state — GC'd after scan)
        freshFullCandleMap[result.symbol] = candles;
        newResults.push(result);
        // #8: Alert sound on new BUY signal (compare against snapshot taken before setResults([]))
        if (['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(result.stage)) {
          const prevStage = preScanSnapshot.find(p => p.symbol === result.symbol)?.stage;
          if (!prevStage || !['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(prevStage)) {
            try { new Audio('data:audio/wav;base64,UklGRl9vT19teleXBQVZFZm10teleIBAAEARKwAAIhYAQACABAAZGF0YQ==').play().catch(() => {}); } catch {}
          }
        }
        scheduleFlush();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        if (/no data|delisted|suspended|too few candles/i.test(errMsg)) {
          // Permanently blacklist — skip silently on future scans
          setDeadSymbols(prev => {
            const next = new Set(prev); next.add(sym);
            try { localStorage.setItem('qtp_dead_symbols', JSON.stringify([...next])); } catch {}
            return next;
          });
        } else {
          newFailed.push({ sym, err: errMsg });
          setErrCount(n => n + 1);
          setLastErr(`${sym}: ${errMsg}`);
        }
      }
      setProgress(p => p + 1);
    }

    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (!abortRef.current) {
          const sym = queue.shift();
          if (!sym) break;
          await processOne(sym);
        }
      })
    );
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushResults();
    setCandleCache(prev => ({ ...prev, ...freshCandleMap }));
    setFailedSymbols(newFailed);
    setLastScanSymbols(scanSymbols);

    // ── Post-scan cluster breakdown (async, chunked to keep UI responsive) ───────
    // During the scan, computeClusterBreakdown is skipped to avoid blocking the
    // event loop between fetch responses (6 engine calls × ~10ms = 60ms per stock).
    // Now that network is done, compute it in 15-stock chunks with yielding.
    // Priority: BUY+ signals first (visible in table), then rest in background.
    if (!scanAll && !abortRef.current) {
      const buySignals = newResults.filter(r => ['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage));
      const restSignals = newResults.filter(r => !['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage));
      const ordered = [...buySignals, ...restSignals];
      const CHUNK = 15;
      for (let i = 0; i < ordered.length; i += CHUNK) {
        if (abortRef.current) break;
        await new Promise<void>(resolve => setTimeout(resolve, 0)); // yield to browser
        const chunk = ordered.slice(i, i + CHUNK);
        for (const r of chunk) {
          const full = freshFullCandleMap[r.symbol];
          if (full) r.clusterBreakdown = computeClusterBreakdown(full);
        }
        // Flush after each BUY+ chunk so columns populate promptly; rest is lower priority
        if (i < buySignals.length) setResults([...newResults]);
      }
      setResults([...newResults]); // final flush with all cluster data
    }
    // ─────────────────────────────────────────────────────────────────────────────

    // Flag pattern + Guppy Coiled overlay detection on qualifying signals
    const newFlagMap: Record<string, {poleGain: number; flagDays: number; measuredTarget: number}> = {};
    const newGuppyCoilMap: Record<string, {avgSpread: number; minSpread: number}> = {};
    for (const r of newResults) {
      if (!['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage)) continue;
      const candles = freshCandleMap[r.symbol];
      if (!candles) continue;
      const flag = detectFlagOverlay(r, candles);
      if (flag?.hasFlag) newFlagMap[r.symbol] = { poleGain: flag.poleGain, flagDays: flag.flagDays, measuredTarget: flag.measuredTarget };
      const gCoil = detectGuppyCoiled(r, candles);
      if (gCoil?.coiled) newGuppyCoilMap[r.symbol] = { avgSpread: gCoil.avgSpread, minSpread: gCoil.minSpread };
    }
    setFlagMap(newFlagMap);
    setGuppyCoilMap(newGuppyCoilMap);
    // Sector Flow (Phase 2, shadow mode): compute divergence scores post-scan —
    // normalization needs all peers, so this can't run inside processOne.
    let freshSectorMap: Record<string, SectorFlowScore> = {};
    try {
      const sectorIndexData = await sectorIndexPromise;
      const { scores, breadth } = computeSectorFlowScores(stockSeriesForFlow, sectorIndexData);
      freshSectorMap = Object.fromEntries(scores);
      setSectorFlowMap(freshSectorMap);
      setSectorBreadthList(breadth);
    } catch {
      // sector flow is additive — never fail the scan over it
      setSectorFlowMap({});
      setSectorBreadthList([]);
    }
    // Bulk Deal Flow (Phase 3): batched read of precomputed daily scores from Supabase
    let freshBulkMap: Record<string, BulkFlowScore> = {};
    try {
      const { scores: bfScores, health } = await fetchBulkFlowScores(newResults.map(r => r.symbol));
      freshBulkMap = bfScores;
      setBulkFlowMap(bfScores);
      setBulkHealth(health);
    } catch {
      setBulkFlowMap({});
      setBulkHealth(null);
    }
    // Sprint 5: shadow validation log — save per-scan flow snapshot to localStorage
    try {
      const cov = sectorFlowCoverage(newResults.length, freshSectorMap);
      const synergyCount = newResults.filter(r => {
        const sf = freshSectorMap[r.symbol];
        const bf = freshBulkMap[r.symbol.replace(/\.(NS|BO)$/i, '')];
        return (sf?.score ?? 0) > 0 && (bf?.finalScore ?? 0) > 60;
      }).length;
      const shadowEntry = {
        date: new Date().toISOString().slice(0, 10),
        scanCount: newResults.length,
        sectorCovPct: cov.pct,
        bulkCount: Object.keys(freshBulkMap).length,
        synergyCount,
      };
      const prev: typeof shadowEntry[] = JSON.parse(localStorage.getItem('qtp_shadow_log') ?? '[]');
      localStorage.setItem('qtp_shadow_log', JSON.stringify(
        [shadowEntry, ...prev.filter(e => e.date !== shadowEntry.date)].slice(0, 30)
      ));
    } catch { /* shadow log is best-effort */ }
    // Clenow momentum score — computed per-symbol in processOne before candle slice
    setClenowMap(freshClenowMap);
    setSatMap(freshSatMap);
    // PCA Super-Score v2 — re-derived weights, validated on 456 Nifty 500 stocks
    // Backtested 5,026 signals: OLD weights showed INVERTED decile spread
    // (top decile 49.4% WR vs bottom 55.7% WR). Fresh weights below produce a
    // genuine monotonic gradient: top decile 59.8% WR vs bottom 47.5% WR (+12.2pp).
    const pcaMeans = [6.84, 1.34, 1.92, 2.41, 0.62, 24.18]; // zoneTight, eRA, eVR, eVP5, p10R, uW
    const pcaStds  = [4.92, 0.58, 1.41, 2.05, 0.21, 14.62];
    // Re-calibrated weights (3,806 breakout signals × 1,617 NSE stocks, grid search top-1):
    // zt: +0.06 (tighter zone = better), eRA: −0.10 (reduced from −0.16 — high eRA penalty softened),
    // vr20: −0.19 (kept — blow-off volume confirmed negative r=−0.080),
    // vp5: −0.07 (kept), p10R: +0.05 (reduced from +0.10 — pre10 range small positive effect),
    // uw: −0.20 (DOUBLED from −0.10 — upper wick most actionable negative predictor r=−0.047).
    // Top-25% with new weights: +2.85% avg20d vs −0.01% bottom-25% (spread=+2.84%).
    const pcaWeights = [0.06, -0.10, -0.19, -0.07, 0.05, -0.20];
    const newPcaMap: Record<string, {score: number; rank: string; pctl: number; species: string; speciesEmoji: string; candle: number; compression: number; volume: number}> = {};
    const pcaScores: Array<{sym: string; score: number; cL: number; uW: number; ups: number; p10A: number; zt: number; evr20: number; evp5: number}> = [];
    for (const r of newResults) {
      // Use actual zone tightness when available; fall back to pre10 range ATR as proxy
      const zoneTightnessPct = r.zone?.zoneTightnessPct ?? (r.pre10AvgRangeATR * 4);
      const raw = [zoneTightnessPct, r.exactRangeATR14, r.volRatio20 || 0, r.exactVolVsPre5 || 0, r.pre10AvgRangeATR, r.upperWickPct];
      let score = 0;
      for (let i = 0; i < 6; i++) score += pcaWeights[i] * ((raw[i] - pcaMeans[i]) / pcaStds[i]);
      pcaScores.push({ sym: r.symbol, score, cL: r.closeLoc, uW: r.upperWickPct, ups: r.ultraPrecisionScore || 0, p10A: r.pre10AvgRangeATR, zt: zoneTightnessPct, evr20: r.volRatio20 || 0, evp5: r.exactVolVsPre5 || 0 });
    }
    // Percentile-rank sub-scores (0-10) — fixes saturation bug where raw formula
    // clamped 75%+ of signals to candle=10, making species classification useless.
    function pctRank(vals: number[]): number[] {
      const n = vals.length;
      if (n <= 1) return vals.map(() => 5);
      const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
      const rank = new Array(n);
      for (let r = 0; r < order.length; r++) rank[order[r]] = r / (n - 1) * 10;
      return rank;
    }
    const cLRank = pctRank(pcaScores.map(p => p.cL));
    const uWRank = pctRank(pcaScores.map(p => -p.uW));
    const upsRank = pctRank(pcaScores.map(p => p.ups));
    const compRank = pctRank(pcaScores.map(p => -p.p10A));
    const ztRank = pctRank(pcaScores.map(p => -p.zt));
    const evr20Rank = pctRank(pcaScores.map(p => p.evr20));
    const evp5Rank = pctRank(pcaScores.map(p => p.evp5));
    // Attach percentile-rank sub-scores BEFORE sorting (so indices stay aligned)
    const pcaWithSub = pcaScores.map((p, idx) => ({
      ...p,
      candle: (cLRank[idx] + uWRank[idx] + upsRank[idx]) / 3,
      compression: (compRank[idx] + ztRank[idx]) / 2,
      volume: (evr20Rank[idx] + evp5Rank[idx]) / 2,
    }));
    pcaWithSub.sort((a, b) => b.score - a.score);
    for (let i = 0; i < pcaWithSub.length; i++) {
      const { sym, score, candle, compression, volume } = pcaWithSub[i];
      const pctl = pcaScores.length > 1 ? Math.round((1 - i / (pcaScores.length - 1)) * 100) : 50;
      // 6-tier S/A/B/C/D/F — re-calibrated on 3,806 breakout signals.
      // Decile analysis: D1+D2 (top 20%) avg +2.80%, D3-D7 avg +2.00%, D8 +1.32%, D9 +0.16%, D10 −0.75%.
      // S = top 20% (+2.8%), A = top 20-40%, B = top 40-60%, C = 20-40%, D = 10-20%, F = bottom 10%.
      const rank = pctl >= 80 ? 'S' : pctl >= 60 ? 'A' : pctl >= 40 ? 'B' : pctl >= 20 ? 'C' : pctl >= 10 ? 'D' : 'F';
      let species: string, speciesEmoji: string;
      if (candle >= 7 && compression >= 6 && volume >= 6) { species = 'TRIPLE THREAT'; speciesEmoji = '⚡'; }
      else if (volume >= 7 && compression < 5) { species = 'VOL EXPLOSION'; speciesEmoji = '🟡'; }
      else if (compression >= 7 && volume < 5) { species = 'COMPRESSION'; speciesEmoji = '🔵'; }
      else if (candle >= 7) { species = 'STRONG CANDLE'; speciesEmoji = '🟢'; }
      else if (compression >= 5) { species = 'BUILDING'; speciesEmoji = '🔷'; }
      else { species = 'DEVELOPING'; speciesEmoji = '⚪'; }
      newPcaMap[sym] = { score: Math.round(score * 100) / 100, rank, pctl, species, speciesEmoji, candle: Math.round(candle * 10) / 10, compression: Math.round(compression * 10) / 10, volume: Math.round(volume * 10) / 10 };
    }
    setPcaMap(newPcaMap);
    // Adaptive Brain — compute insights + per-signal adjusted scores
    try {
      const bi = computeBrainInsights(trackedTradesRef.current, getNSECalendarContext(fiiSellStreak) as any);
      setBrainInsights(bi);
      const newBrainScores: Record<string, {original: number; brain: number; adjustments: Array<{factor: string; adj: number; reason: string; engine?: string}>; riskPct: number; riskLabel: string; ciLow: number; ciHigh: number; formLabel: string; formEMA: string; formTrend: string; anomalyCount: number; anomalyNote: string; priority?: number; confidence?: string; premortem?: {winRate: number; verdict: string; matches: Array<{symbol: string; conviction: number; status: string; pnlPct: number; similarity: number}>} | null}> = {};
      const buySignals = newResults.filter(r => ['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage));
      for (const r of buySignals) {
        const cl = freshClenowMap[r.symbol];
        // P0 follow-up: AnalysisResult has no top-level conviction/atrState/
        // candlePattern/paramSetKey fields — adjustScore reads these from
        // extraData, so they must be computed and passed explicitly or the
        // brain score silently falls back to a flat 50 baseline.
        const atrInfoForBrain = detectATRState(r);
        const adj = bi.adjustScore(r, {
          sector: getSectorTag(r.symbol), clenowScore: cl?.score, hasFlag: !!newFlagMap[r.symbol], hasCoiled: !!newGuppyCoilMap[r.symbol],
          conviction: computeConviction(r), atrState: atrInfoForBrain.explosion ? 'EXPLOSION' : atrInfoForBrain.state,
          candlePattern: r.stats?.candlePattern, paramSetKey: r.paramSetKey,
        });
        // Brain v2: enrich with backtest prior quality lookup
        const setupQual = getSetupQuality(brainPrior, r.stage, r.paramSetKey);
        // Override sizing label with prior-informed recommendation if available
        let riskLabel = adj.sizing.label;
        let riskPct = adj.sizing.risk;
        if (setupQual) {
          riskPct = Math.round(adj.sizing.risk * setupQual.sizeMultiplier * 10) / 10;
          riskLabel = setupQual.tier === 'ELITE' ? `ELITE — size ${setupQual.sizeMultiplier}× (${setupQual.expectedPnl.toFixed(1)}% avg)` :
                     setupQual.tier === 'STRONG' ? `STRONG — size ${setupQual.sizeMultiplier}× (${setupQual.expectedPnl.toFixed(1)}% avg)` :
                     setupQual.tier === 'GOOD'   ? `GOOD — normal size (${setupQual.expectedPnl.toFixed(1)}% avg)` :
                     setupQual.tier === 'AVERAGE'? `AVERAGE — reduce 0.75× (${setupQual.expectedPnl.toFixed(1)}% avg)` :
                                                   `WEAK — half size (${setupQual.expectedPnl.toFixed(1)}% avg)`;
        }
        const pm = bi.premortem(r, { sector: getSectorTag(r.symbol), conviction: computeConviction(r) });
        newBrainScores[r.symbol] = { original: adj.originalScore, brain: adj.brainScore, adjustments: adj.adjustments, riskPct, riskLabel, ciLow: adj.confidenceInterval?.low ?? 0, ciHigh: adj.confidenceInterval?.high ?? 100, formLabel: adj.form?.label || 'NEUTRAL', formEMA: (adj.form?.ema ?? 0.5).toFixed(2), formTrend: adj.form?.trend || 'STABLE', anomalyCount: adj.anomalies?.anomalyCount || 0, anomalyNote: adj.anomalies?.anomalies?.map((a: {feature: string}) => a.feature).join(', ') || '', confidence: adj.confidence, premortem: pm };
      }
      // Engine 2: Thompson ranking for priority order — multi-factor (sector + stock + ATR + pattern + conviction tier)
      if (buySignals.length > 1) {
        const extraMap: Record<string, {sector: string; atrState?: string; candlePattern?: string; conviction?: number}> = {};
        for (const r of buySignals) {
          const atrI = detectATRState(r);
          extraMap[r.symbol] = {
            sector: getSectorTag(r.symbol),
            atrState: atrI.explosion ? 'EXPLOSION' : (atrI.state ?? undefined),
            candlePattern: r.stats?.candlePattern ?? undefined,
            conviction: computeConviction(r),
          };
        }
        const ranked = bi.thompsonRank(buySignals, extraMap);
        for (const r of ranked) {
          if (newBrainScores[r.symbol]) newBrainScores[r.symbol].priority = r.priority;
        }
      }
      setBrainScores(newBrainScores);
    } catch { /* brain computation failed — non-critical */ }
    // Market breadth: % of stocks above 200 SMA
    if (newResults.length > 20) {
      const above200 = newResults.filter(r => r.stats?.sma200 > 0 && r.lastClose > r.stats.sma200).length;
      const pct = newResults.length > 0 ? above200 / newResults.length * 100 : 0;
      setMarketBreadth({ above200, total: newResults.length, pct: Number.isFinite(pct) ? pct : 0 });
    }

    // Auto-filter to show actionable signals first (but keep ALL visible with stage chips)
    const hasActionable = newResults.some(r => ['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage));
    if (hasActionable) {
      setSortCol('stage'); setSortDir('desc');
    }
    // Auto-validate open trades using freshly fetched candle data (local map, not stale state)
    // Also sync stop/target from latest scan results (ensures formula changes propagate)
    if (trackedTradesRef.current.some(t => t.status === 'open')) {
      setTrackedTrades(prev => {
        let updated = [...prev];
        for (let i = 0; i < updated.length; i++) {
          const t = updated[i];
          // Re-validate stopped/partial-exit trades: false-stop recovery + live mark-to-market
          if (t.status !== 'open' && t.status !== 'stopped' && t.status !== 'hit_t1' && t.status !== 'hit_t2') continue;
          // Sync stop/targets from fresh scan results only when param set matches
          const freshResult = newResults.find(r => r.symbol === t.symbol);
          // Only sync STOP (for trailing/formula propagation). NEVER overwrite targets —
          // targets are locked at entry time. Overwriting causes T1/T2 to drift as ATR
          // changes post-entry, making it impossible for the validator to match real execution.
          if (freshResult && freshResult.priceEngine.tacticalStop > 0 && freshResult.paramSetKey === t.paramSetKey && freshResult.priceEngine.tacticalStop < t.entryPrice) {
            updated[i] = { ...updated[i], stopLoss: freshResult.priceEngine.tacticalStop };
          }
          const cached = freshCandleMap[t.symbol];
          if (!cached || cached.length === 0) continue;
          // Yahoo Finance NSE timestamps are IST midnight expressed in UTC (+19800s offset).
          // new Date("YYYY-MM-DD") parses as UTC midnight, so a same-day NSE candle appears
          // BEFORE entryTs and gets excluded — causing the slice(-10) fallback to run prior-day
          // candles whose close was below the stop. Fix: IST-adjust each candle's ts, use
          // strictly-after comparison (entry is for next morning's open, not today's close).
          const entryDateStr = t.entryDate;
          if (!entryDateStr) continue; // guard: empty entryDate would make ''>date TRUE for all candles
          const sinceEntry = cached.filter(c => {
            const cDateIST = new Date((c.ts + 19800) * 1000).toISOString().slice(0, 10);
            return cDateIST > entryDateStr;
          });
          // Always show last known price even on holidays/weekends (before any post-entry candle)
          const latestCandle = cached[cached.length - 1];
          if (latestCandle?.c > 0) {
            const latestCmpDate = new Date((latestCandle.ts + 19800) * 1000).toISOString().slice(0, 10);
            updated[i] = { ...updated[i], currentPrice: latestCandle.c, cmpDate: latestCmpDate };
          }
          if (sinceEntry.length === 0) continue; // no post-entry candles yet (holiday/weekend/same-day)
          const result = validateTrade(updated[i], sinceEntry);
          const prevStatus = updated[i].status;
          updated[i] = applyValidation(updated[i], result);
          // FAIL-SAFE: Detect STOPPED status change → trigger alert
          if (prevStatus === 'open' && updated[i].status === 'stopped') {
            const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' });
            setStopAlerts(prev => [...prev, { symbol: updated[i].symbol, stopPrice: updated[i].stopLoss, timestamp: now, entryPrice: updated[i].entryPrice }]);
            try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1sbJObi4BvUl5zjJuTi3tlWm+Ij5eLgHVcYHWIkpKKe2pcanmGjo6IeGhbZ3mFjI2Jdmhba3eEi4yJeGldaXmFjY2LfG1gcX+KkJONgHFjcH+MlJaShXZpcIKPlpiWjoF3coCQmJyalIiBe4OSmJ2cmJOLhIaQl5ydnJeTjIiIkJaanJuZlI+KiI+Ul5qamJWRjIuNk5eZmpiVkY6LjJGVl5eXlJGOi4yQk5aWlpSRjoyLj5KUlZWUko+NjI6RkpSUlJKQjoyNj5GTk5OSkI6MjY+RkpKSkZCOjY2Oj5GRkZGQj42NjY+QkJCQj46NjY2Oj4+Pj4+OjY2Njo+Pj4+Pjo2NjY6Ojo6Ojo2NjY2Ojo6Ojo6NjY2NjY6Ojo6OjY2NjY2Njo6Ojo2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjQ==').play().catch(() => {}); } catch {}
          }
        }
        return updated;
      });
    }

    // Intelligence features computation
    let localRsMap = new Map<string, RSRanking>();
    let localTfMap = new Map<string, TFAlignment>();
    let localPivMap = pivotData;
    if (newResults.length > 0 && niftyData) {
      // #1: Mansfield RS Ranking
      const rsRaw: Array<{ symbol: string; rs52w: number }> = [];
      const rsMap = new Map<string, RSRanking>();
      for (const r of newResults) {
        const candles = freshCandleMap[r.symbol];
        if (candles && niftyData) {
          const rs = computeMansfieldRS(candles, niftyData);
          rsRaw.push({ symbol: r.symbol, rs52w: rs.rs52w });
          rsMap.set(r.symbol, { ...rs, rsRank: 0 });
        }
      }
      const ranks = rankRS(rsRaw);
      for (const [sym, rank] of ranks) {
        const existing = rsMap.get(sym);
        if (existing) rsMap.set(sym, { ...existing, rsRank: rank });
      }
      setRsData(rsMap);

      // #2: Sector Rotation
      const sectorMap: Record<string, string> = {};
      for (const r of newResults) { sectorMap[r.symbol] = getSectorTag(r.symbol); }
      setSectorFlows(computeSectorRotation(newResults, sectorMap, freshCandleMap, ranks));

      // #3: Multi-TF Alignment
      const tfMap = new Map<string, TFAlignment>();
      for (const r of newResults) {
        if (!['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage)) continue;
        const candles = freshCandleMap[r.symbol];
        if (candles) tfMap.set(r.symbol, checkWeeklyAlignment(candles));
      }
      setTfAlignments(tfMap);

      // #5: Portfolio correlation of tracked trades
      const openSymbols = trackedTradesRef.current.filter(t => t.status === 'open').map(t => t.symbol);
      if (openSymbols.length >= 2) setPortCorrelation(computePortfolioCorrelation(openSymbols, freshCandleMap));

      // #7+10: Earnings season check
      setEarningsSeason(checkEarningsProximity(new Date().toISOString().slice(0, 10)));
      localRsMap = rsMap;
      localTfMap = tfMap;
    }

    // Pivot points — computed independently of Nifty data
    if (newResults.length > 0) {
      const pivMap = new Map<string, AllPivots>();
      for (const r of newResults) {
        const candles = freshCandleMap[r.symbol];
        if (candles && candles.length >= 2) {
          const piv = computeAllPivots(candles);
          if (piv) pivMap.set(r.symbol, piv);
        }
      }
      setPivotData(pivMap);
      localPivMap = pivMap;
    }

    // ── Telegram Alerts ──
    if (tgConfig.enabled && newResults.length > 0) {
      const tg = tgConfig;
      // #1: New or upgraded BUY signals
      if (tg.alerts.newSignal) {
        const stageRank: Record<string, number> = { NO_SIGNAL: 0, COMPRESSION_WATCH: 1, EARLY_INFLECTION: 2, PRE_BREAKOUT: 3, BUY: 4, STRONG_BUY: 5, ULTRA_STRONG_BUY: 6 };
        const prevMap = new Map(preScanSnapshot.map(r => [r.symbol, r.stage]));
        const newBuys = newResults.filter(r => {
          if (!['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage)) return false;
          const prevStage = prevMap.get(r.symbol);
          if (!prevStage) return true; // brand new — alert
          if ((stageRank[r.stage] || 0) > (stageRank[prevStage] || 0)) return true; // upgraded — alert
          return false;
        });
        for (const r of newBuys.slice(0, 5)) {
          const rs = localRsMap.get(r.symbol);
          const tf = localTfMap.get(r.symbol);
          const piv = localPivMap.get(r.symbol);
          const flagInfo = newFlagMap[r.symbol];
          let msg = formatNewSignalAlert(r, {
            conviction: computeConviction(r), rsRank: rs?.rsRank, tfAlign: tf?.alignment,
            pivotPosition: piv?.position, pivotR1: piv?.classic.r1, pivotS1: piv?.classic.s1,
          });
          // ATR / Zone / Vol badges
          const atrInfo = detectATRState(r);
          const zoneInfo = detectZoneExplosion(r);
          const volInfo = detectVolumeBadge(r);
          const dnaInfo = detectBreakoutDNA(r);
          msg += `\n<b>📈 BREAKOUT QUALITY</b>\n`;
          msg += `ATR: ${atrInfo.explosion ? '💥 EXPLODE (+2.05% avg20d)' : atrInfo.state === 'SWEET_SPOT' ? '🎯 INFLECT' : atrInfo.state === 'BUILDING' ? '⚡ BUILD (worst zone)' : atrInfo.state === 'DEEP_COMPRESSION' ? '💤 SLEEP' : '🔥 MOMEN (+4.5% avg20d)'}\n`;
          msg += `Zone: ${zoneInfo === 'HIGH_CONVICTION' ? '💎 EXPLODE (63.4% HR)' : zoneInfo === 'CONFIRMED' ? '🎯 READY (63.5% HR)' : '— None'}`;
          if (r.zone) msg += ` | Tight: ${r.zone.zoneTightnessPct.toFixed(1)}% | Len: ${r.zone.windowLength}d`;
          msg += `\n`;
          msg += `Vol: ${volInfo === 'HIGH_CONVICTION' ? '🔥 THRUST (+2.3% avg20d)' : volInfo === 'CONFIRMED' ? '✓ CONF (+1.8% avg20d)' : '— None'} | ${r.volRatio20.toFixed(1)}× 20d | ${r.exactVolVsPre5.toFixed(1)}× pre5\n`;
          if (dnaInfo) msg += `DNA: ★ ${dnaInfo}\n`;
          // PCA + Clenow
          const pcaInfo = newPcaMap[r.symbol];
          const clInfo = freshClenowMap[r.symbol];
          if (pcaInfo || clInfo) {
            msg += `\n<b>📊 SCORING</b>\n`;
            if (pcaInfo) msg += `PCA: ${pcaInfo.score.toFixed(1)} [${pcaInfo.rank}] ${pcaInfo.speciesEmoji} ${pcaInfo.species} (P${pcaInfo.pctl})\n`;
            if (clInfo) msg += `Clenow: ${clInfo.score.toFixed(0)} [${clInfo.quality}] | Ann: ${clInfo.annReturn >= 0 ? '+' : ''}${clInfo.annReturn.toFixed(0)}% | R²: ${clInfo.r2.toFixed(2)}\n`;
          }
          // Sniper status
          if (r.clusterBreakdown?.sniper) {
            const sn = r.clusterBreakdown.sniper;
            if (sn.met === sn.total) msg += `\n🎯 <b>SNIPER 95+ TRIGGERED!</b> ${sn.met}/${sn.total} — MAX SIZE\n`;
            else if (sn.met >= sn.total - 2) msg += `🎯 Sniper: ${sn.met}/${sn.total} (${sn.total - sn.met} away)\n`;
          }
          msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
          if (flagInfo) {
            msg += `🚩 <b>FLAG PATTERN</b>\n`;
            msg += `Pole: +${flagInfo.poleGain.toFixed(0)}% → ${flagInfo.flagDays}d flag → breakout | Target: Rs.${flagInfo.measuredTarget.toFixed(0)}\n`;
          }
          const guppyInfo = newGuppyCoilMap[r.symbol];
          if (guppyInfo) {
            msg += `💎 <b>GUPPY COILED</b> — ${guppyInfo.avgSpread.toFixed(1)}% spread — max stored energy\n`;
          }
          // Brain v3 — 5-Engine Intelligence in Telegram
          try {
            const brainTg = computeBrainInsights(trackedTradesRef.current, getNSECalendarContext(fiiSellStreak) as any);
            const atrInfoTg = detectATRState(r);
            const brainAdj = brainTg.adjustScore(r, {
              sector: getSectorTag(r.symbol), clenowScore: freshClenowMap[r.symbol]?.score, hasFlag: !!flagInfo, hasCoiled: !!guppyInfo,
              conviction: computeConviction(r), atrState: atrInfoTg.explosion ? 'EXPLOSION' : atrInfoTg.state,
              candlePattern: r.stats?.candlePattern, paramSetKey: r.paramSetKey,
            });
            const delta = brainAdj.brainScore - brainAdj.originalScore;
            msg += `\n🧠 <b>ADAPTIVE BRAIN v3</b>\n`;
            msg += `Score: ${brainAdj.originalScore} → <b>${brainAdj.brainScore}</b> (${delta >= 0 ? '+' : ''}${delta})\n`;
            msg += `Range: ${brainAdj.confidenceInterval?.low ?? 0}-${brainAdj.confidenceInterval?.high ?? 100} | ${brainTg.confidence}\n`;
            for (const a of brainAdj.adjustments.slice(0, 6)) {
              msg += `${a.adj >= 0 ? '🟢' : '🟠'} ${a.adj >= 0 ? '+' : ''}${a.adj}: ${a.factor}${a.engine && a.engine !== 'Bayesian' ? ` [${a.engine}]` : ''}\n`;
            }
            msg += `💰 Sizing: ${brainAdj.sizing.label} (${brainAdj.sizing.risk}% risk)\n`;
            // Engine 4: Performance EMA
            msg += `📊 Form: ${brainAdj.form?.label || 'NEUTRAL'} (EMA ${(brainAdj.form?.ema ?? 0.5).toFixed(2)}) · ${brainAdj.form?.trend || 'STABLE'}\n`;
            // Engine 3: Anomaly detection
            if (brainAdj.anomalies?.anomalyCount > 0) {
              msg += `⚠ ${brainAdj.anomalies.anomalyCount} anomal${brainAdj.anomalies.anomalyCount > 1 ? 'ies' : 'y'}: ${brainAdj.anomalies.anomalies.map((a) => `${a.feature} (${a.note})`).join(', ')}\n`;
            }
            // Engine 2: Thompson priority (if multiple signals)
            const otherBuys = newResults.filter(x => x.symbol !== r.symbol && ['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(x.stage));
            if (otherBuys.length > 0) {
              const allBuys = [r, ...otherBuys];
              const extraMap: Record<string, {sector: string; atrState?: string; candlePattern?: string; conviction?: number}> = {};
              for (const b of allBuys) {
                const atrI = detectATRState(b);
                extraMap[b.symbol] = { sector: getSectorTag(b.symbol), atrState: atrI.explosion ? 'EXPLOSION' : (atrI.state ?? undefined), candlePattern: b.stats?.candlePattern ?? undefined, conviction: computeConviction(b) };
              }
              const ranked = brainTg.thompsonRank(allBuys, extraMap);
              const myRank = ranked.find((x: {symbol: string; badge: string}) => x.symbol === r.symbol);
              if (myRank) msg += `🏆 Thompson Priority: <b>${myRank.badge}</b> of ${ranked.length} signals\n`;
            }
            // Engine 5: Param set bandit
            if (brainTg.bestParamSet) {
              msg += `🎰 Best param set for you: ${brainTg.bestParamSet.name} (${brainTg.bestParamSet.wr}% WR)\n`;
            }
            // Emotional + Decay warnings
            if (brainTg.emotionalAlert && brainTg.streakType === 'L' && brainTg.currentStreak >= 2) {
              msg += `\n⚠ <b>CAUTION:</b> ${brainTg.emotionalAlert.message}\n`;
            }
            for (const da of (brainTg.decayAlerts || [])) {
              msg += `⚠ Decay: ${da.name} ${da.oldWR}% → ${da.newWR}%\n`;
            }
          } catch { /* brain failed — non-critical */ }
          sendTelegramMessage(tg, msg);
        }
      }
      // #1b: MOM Alert — independent of stage, deliberately separate from
      // #1 above since these often fire on NO_SIGNAL/COMPRESSION_WATCH rows
      // that #1's stage filter would never see (see formatMomAlert).
      if (tg.alerts.momAlert) {
        const prevMomSet = new Set(
          resultsRef.current.filter(r => r.monster?.badges?.some(b => b.type === 'MOM')).map(r => r.symbol)
        );
        const newMomAlerts = newResults.filter(r =>
          r.monster?.badges?.some(b => b.type === 'MOM') && !prevMomSet.has(r.symbol)
        );
        for (const r of newMomAlerts.slice(0, 5)) {
          sendTelegramMessage(tg, formatMomAlert(r));
        }
      }
      // #4: Market regime change
      if (tg.alerts.regimeChange && marketRegime && prevRegimeRef.current && prevRegimeRef.current !== marketRegime.regime) {
        sendTelegramMessage(tg, formatRegimeChangeAlert(prevRegimeRef.current, marketRegime.regime, marketRegime.niftyClose, marketRegime.ema50, marketRegime.ema200, marketRegime.sizingMultiplier));
      }
      if (marketRegime) prevRegimeRef.current = marketRegime.regime;
      // #5: Daily summary (first scan of day)
      if (tg.alerts.dailySummary) {
        const today = new Date().toISOString().slice(0, 10);
        const lastSummaryDate = localStorage.getItem('qtp_tg_last_summary');
        if (lastSummaryDate !== today) {
          const actionable = newResults.filter(r => ['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage));
          const prevSyms2 = new Set(resultsRef.current.map(r => r.symbol));
          const newSigs = actionable.filter(r => !prevSyms2.has(r.symbol)).map(r => r.symbol);
          const ws = computeWinRateStats(trackedTradesRef.current);
          const cumR = trackedTradesRef.current.filter(t => t.status !== 'open').reduce((s, t) => s + (t.pnlR ?? 0), 0);
          const best = actionable.sort((a, b) => computeConviction(b) - computeConviction(a))[0];
          sendTelegramMessage(tg, formatDailySummaryAlert(today, newResults.length, actionable.length, newSigs, [],
            trackedTradesRef.current.filter(t => t.status === 'open').length, ws.winRate, cumR,
            best ? { symbol: best.symbol, conviction: computeConviction(best), rr: best.priceEngine.rewardRisk } : undefined
          ));
          try { localStorage.setItem('qtp_tg_last_summary', today); } catch {}
        }
      }
    }

    // Auto-save session
    if (newResults.length > 0) {
      saveSession(newResults, scanAll ? 'ALL4' : paramSetKey, scanSource);
      setSessions(loadSessions());
    }

    // Auto-track: add every BUY/STRONG_BUY/ULTRA_STRONG_BUY that isn't already open
    if (newResults.length > 0 && tradesLoadedRef.current) {
      const openSymbols = new Set(trackedTradesRef.current.filter(t => t.status === 'open').map(t => t.symbol));
      const toAutoTrack = newResults.filter(r =>
        (r.stage === 'BUY' || r.stage === 'STRONG_BUY' || r.stage === 'ULTRA_STRONG_BUY') &&
        !openSymbols.has(r.symbol) &&
        r.priceEngine.tradeValid
      );
      if (toAutoTrack.length > 0) {
        const newTrades: TrackedTrade[] = toAutoTrack.map(r => {
          const atrInfo = detectATRState(r);
          const zeInfo = detectZoneExplosion(r);
          const monsterBadgeType = r.monster?.badges?.[0]?.type;
          const rsEntry = localRsMap.get(r.symbol);
          const tfEntry = localTfMap.get(r.symbol);
          return {
            symbol: r.symbol, stage: r.stage,
            entryPrice: r.priceEngine.plannedEntry,
            entryDate: r.lastDate || new Date(Date.now() + 19800000).toISOString().slice(0, 10),
            stopLoss: r.priceEngine.tacticalStop < r.priceEngine.plannedEntry ? r.priceEngine.tacticalStop : 0,
            target1: r.priceEngine.target5,
            target2: r.priceEngine.target7,
            target3: r.priceEngine.target10,
            disasterStop: r.priceEngine.disasterStop,
            paramSetKey: r.paramSetKey,
            sector: getSectorTag(r.symbol),
            conviction: computeConviction(r),
            edgeScore: computeEdgeScore(r),
            status: 'open' as const,
            candlePattern: r.stats?.candlePattern || undefined,
            atrState: atrInfo.explosion ? 'EXPLOSION' : (atrInfo.state || undefined),
            tfAlignment: tfEntry?.alignment || undefined,
            rsRank: rsEntry?.rsRank,
            volumeBadge: detectVolumeBadge(r) || undefined,
            zoneExplosion: zeInfo || undefined,
            monsterBadge: monsterBadgeType || undefined,
            regimeAtEntry: marketRegime?.label || undefined,
            sw5LowAtEntry: r.priceEngine.sw5LowAtEntry > 0 ? r.priceEngine.sw5LowAtEntry : undefined,
            atr14AtEntry: r.priceEngine.atr14AtEntry > 0 ? r.priceEngine.atr14AtEntry : undefined,
            breakoutTier: r.priceEngine.breakoutTier ?? 'B',
          };
        });
        setTrackedTrades(prev => {
          const autoSyms = new Set(newTrades.map(t => t.symbol));
          return [...prev.filter(t => !autoSyms.has(t.symbol) || t.status !== 'open'), ...newTrades];
        });
        setAutoTrackCount(toAutoTrack.length);
        setTimeout(() => setAutoTrackCount(0), 4000);
      }
    }

    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      setScanning(false); scanningRef.current = false;
      setScanEndTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }));
    }
  }, [paramSetKey, scanAll, lookback, niftyCandles, scanSource]);

  // Feature #5+#8: Adaptive auto-refresh during market hours
  useEffect(() => {
    if (!autoRefresh || lastScanSymbols.length === 0) return;
    const check = () => {
      if (scanningRef.current) return 0;
      const now = new Date();
      const istMins = (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
      const istHour = Math.floor(istMins / 60);
      const istMin = istMins % 60;
      const adaptiveMin = getAdaptiveScanInterval(istHour, istMin);
      if (adaptiveMin > 0) runScan(lastScanSymbols);
      return adaptiveMin;
    };
    const adaptiveMin = check();
    const intervalMs = (adaptiveMin > 0 ? adaptiveMin : 15) * 60 * 1000;
    const interval = setInterval(check, intervalMs);
    return () => clearInterval(interval);
  }, [autoRefresh, lastScanSymbols, runScan]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const symbols = parseCSV(ev.target?.result as string);
      if (symbols.length > 0) {
        runScan(symbols);
      } else {
        setLastErr('No valid symbols found in CSV. Use a column named Symbol/Stock/Scrip/Ticker or any column with stock codes.');
        setErrCount(1);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [runScan]);

  const setColFilter = useCallback((key: string, val: string) => {
    setColFilters(prev => ({ ...prev, [key]: val }));
  }, []);

  const filteredResults = useMemo(() => {
    let rows = stageFilter === 'ALL'
      ? (multiStageFilter.size > 0 ? results.filter(r => multiStageFilter.has(r.stage)) : results)
      : results.filter(r => r.stage === stageFilter);

    // Quick filter (#8)
    if (quickFilter !== 'all') {
      const qf = QUICK_FILTERS.find(f => f.key === quickFilter);
      if (qf) rows = rows.filter(qf.filter);
    }

    // Global search
    if (globalSearch) {
      const q = globalSearch.toUpperCase();
      rows = rows.filter(r =>
        r.symbol.toUpperCase().includes(q) ||
        STAGE_CONFIG[r.stage].label.toUpperCase().includes(q)
      );
    }

    // Per-column filters
    for (const col of visibleColumns) {
      const f = colFilters[col.key];
      if (!f) continue;
      rows = rows.filter(r => matchesFilter(col.fmt(r), f));
    }

    // Sort with optional secondary sort (Feature #8)
    const sortDef = COLUMNS.find(c => c.key === sortCol);
    const secDef = secondarySortCol ? COLUMNS.find(c => c.key === secondarySortCol) : null;
    return [...rows].sort((a, b) => {
      let cmp = 0;
      try {
        if (sortDef?.numVal) cmp = (sortDef.numVal(a) ?? 0) - (sortDef.numVal(b) ?? 0);
        else if (sortDef) cmp = safeColFmt(sortDef, a).localeCompare(safeColFmt(sortDef, b));
      } catch { cmp = 0; }
      cmp = sortDir === 'desc' ? -cmp : cmp;
      if (cmp === 0 && secDef) {
        let cmp2 = 0;
        try {
          if (secDef.numVal) cmp2 = (secDef.numVal(a) ?? 0) - (secDef.numVal(b) ?? 0);
          else cmp2 = safeColFmt(secDef, a).localeCompare(safeColFmt(secDef, b));
        } catch { cmp2 = 0; }
        cmp = secondarySortDir === 'desc' ? -cmp2 : cmp2;
      }
      return cmp;
    });
  }, [results, stageFilter, multiStageFilter, globalSearch, colFilters, sortCol, sortDir, secondarySortCol, secondarySortDir, visibleColumns, quickFilter]);

  const selectedResult = useMemo(
    () => results.find(r => r.symbol === selectedSymbol) ?? null,
    [results, selectedSymbol]
  );

  const stageCounts = useMemo(() => {
    const c: Record<string, number> = { ALL: results.length };
    for (const r of results) c[r.stage] = (c[r.stage] ?? 0) + 1;
    return c;
  }, [results]);

  // #7: Scan statistics
  const scanStats = useMemo(() => computeScanStats(results), [results]);

  // Top picks ranked by EdgeScore — BUY/STRONG/ULTRA/PRE-BRK stages only, top 8
  const topPicks = useMemo(() => {
    const buySet = new Set<StageRating>(['ULTRA_STRONG_BUY', 'STRONG_BUY', 'BUY', 'PRE_BREAKOUT']);
    return [...results]
      .filter(r => buySet.has(r.stage))
      .map(r => ({ r, score: computeEdgeScore(r) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(x => x.r);
  }, [results]);

  // Win rate stats (#2)
  const winStats = useMemo(() => computeWinRateStats(trackedTrades), [trackedTrades]);

  // Track a trade (#2)
  function trackTrade(r: AnalysisResult) {
    // Risk warning: check if adding this trade exceeds 5% total risk
    const openTrades = trackedTradesRef.current.filter(t => t.status === 'open' && t.symbol !== r.symbol);
    // Each open trade risks 1% of account; new trade adds another 1%
    const totalRiskPct = (openTrades.length + 1) * 1;
    if (totalRiskPct > 5 && !confirm(`⚠ Total risk will be ${totalRiskPct.toFixed(1)}% of account (exceeds 5% max recommended). Continue?`)) return;

    // P0: snapshot the features Brain v3 needs to learn from at entry time —
    // captured here once, since they can drift (RS rank, ATR state, etc.)
    // by the time the trade closes weeks later.
    const atrInfo = detectATRState(r);
    const tf = tfAlignments.get(r.symbol);
    const rs = rsData.get(r.symbol);
    const zeInfo = detectZoneExplosion(r);
    const monsterBadgeType = r.monster?.badges?.[0]?.type;

    const trade: TrackedTrade = {
      symbol: r.symbol, stage: r.stage, entryPrice: r.priceEngine.plannedEntry,
      entryDate: r.lastDate || new Date(Date.now() + 19800000).toISOString().slice(0, 10), stopLoss: r.priceEngine.tacticalStop < r.priceEngine.plannedEntry ? r.priceEngine.tacticalStop : 0,
      target1: r.priceEngine.target5, target2: r.priceEngine.target7,
      target3: r.priceEngine.target10, disasterStop: r.priceEngine.disasterStop,
      paramSetKey: r.paramSetKey, sector: getSectorTag(r.symbol),
      conviction: computeConviction(r), edgeScore: computeEdgeScore(r), status: 'open',
      candlePattern: r.stats?.candlePattern || undefined,
      atrState: atrInfo.explosion ? 'EXPLOSION' : (atrInfo.state || undefined),
      tfAlignment: tf?.alignment || undefined,
      rsRank: rs?.rsRank,
      volumeBadge: detectVolumeBadge(r) || undefined,
      zoneExplosion: zeInfo || undefined,
      monsterBadge: monsterBadgeType || undefined,
      regimeAtEntry: marketRegime?.label || undefined,
      sw5LowAtEntry: r.priceEngine.sw5LowAtEntry > 0 ? r.priceEngine.sw5LowAtEntry : undefined,
      atr14AtEntry: r.priceEngine.atr14AtEntry > 0 ? r.priceEngine.atr14AtEntry : undefined,
      breakoutTier: r.priceEngine.breakoutTier ?? 'B',
    };
    setTrackedTrades(prev => [...prev.filter(t => !(t.symbol === r.symbol && t.status === 'open')), trade]);
  }

  function removeTrade(trade: TrackedTrade) {
    deleteTradeFromCloud(trade.symbol);
    setTrackedTrades(prev => prev.filter(t => t !== trade));
  }

  // Tooltip portal system — positions a single div at body level via JS
  useEffect(() => {
    let tip = document.getElementById('qtp-tooltip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'qtp-tooltip'; document.body.appendChild(tip); }
    const colorClasses = ['tip-green','tip-amber','tip-purple','tip-blue','tip-cyan','tip-red','tip-pink','tip-yellow','tip-orange'];
    function show(e: MouseEvent) {
      const el = (e.target as HTMLElement).closest('[data-tip],[data-tip-html]') as HTMLElement | null;
      if (!el || !tip) return;
      const html = el.getAttribute('data-tip-html');
      if (html) { tip.innerHTML = html; tip.className = 'rich-tip'; }
      else {
        tip.textContent = el.getAttribute('data-tip') ?? '';
        tip.className = '';
        const color = el.getAttribute('data-tip-color');
        if (color && colorClasses.includes(`tip-${color}`)) tip.classList.add(`tip-${color}`);
      }

      // Reset position so we can measure natural tip dimensions
      tip.style.visibility = 'hidden';
      tip.style.display = 'block';
      tip.style.maxHeight = '';
      tip.style.overflowY = '';
      const tipW = 320;
      const tipH = tip.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const rect = el.getBoundingClientRect();

      // Horizontal: centre on element, clamp to viewport
      let left = rect.left + rect.width / 2 - tipW / 2;
      left = Math.max(8, Math.min(vw - tipW - 8, left));

      // Vertical: prefer below, flip above if not enough room; clamp + scroll if needed
      const gap = 8;
      const spaceBelow = vh - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      let top: number;
      if (spaceBelow >= tipH || spaceBelow >= spaceAbove) {
        top = rect.bottom + gap;
        if (top + tipH > vh - 8) {
          tip.style.maxHeight = `${Math.max(120, vh - top - 8)}px`;
          tip.style.overflowY = 'auto';
        }
      } else {
        top = rect.top - tipH - gap;
        if (top < 8) {
          top = 8;
          tip.style.maxHeight = `${Math.max(120, spaceAbove)}px`;
          tip.style.overflowY = 'auto';
        }
      }

      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
      tip.style.visibility = '';
      tip.style.display = '';
      requestAnimationFrame(() => tip!.classList.add('visible'));
    }
    function hide() { if (tip) { tip.classList.remove('visible'); } }
    document.addEventListener('mouseover', show);
    document.addEventListener('mouseout', hide);
    return () => { document.removeEventListener('mouseover', show); document.removeEventListener('mouseout', hide); };
  }, []);

  // Auto-fetch market regime on mount (ref guards against StrictMode double-fire)
  const regimeFetchedRef = useRef(false);
  const [rsData, setRsData] = useState<Map<string, RSRanking>>(new Map());
  const [sectorFlows, setSectorFlows] = useState<SectorFlow[]>([]);
  const [tfAlignments, setTfAlignments] = useState<Map<string, TFAlignment>>(new Map());
  const [histBacktests, setHistBacktests] = useState<Map<string, HistBacktest>>(new Map());
  const [portCorrelation, setPortCorrelation] = useState<CorrelationResult | null>(null);
  const [earningsSeason, setEarningsSeason] = useState<EarningsProximity>({ daysToEarnings: null, warning: false, message: '' });
  const [pivotData, setPivotData] = useState<Map<string, AllPivots>>(new Map());
  const [validateFlash, setValidateFlash] = useState(0);
  const [marketBreadth, setMarketBreadth] = useState<{ above200: number; total: number; pct: number } | null>(null);
  const [compareList, setCompareList] = useState<string[]>([]);
  const [reviewedSymbols, setReviewedSymbols] = useState<Set<string>>(new Set());
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [backtestRunning, setBacktestRunning] = useState(false);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [portfolioResult, setPortfolioResult] = useState<PortfolioResult | null>(null);
  const [tgConfig, setTgConfig] = useState<TelegramConfig>({ botToken: '', chatId: '', enabled: false, alerts: { newSignal: true, momAlert: true, eliteSignal: true, targetHit: true, stopped: true, regimeChange: true, dailySummary: true, signalDecay: false, validationSummary: true } });
  const [showTgSettings, setShowTgSettings] = useState(false);
  const [tgTestStatus, setTgTestStatus] = useState<'' | 'sending' | 'ok' | 'fail'>('');
  const prevRegimeRef = useRef<string | null>(null);
  useEffect(() => {
    if (marketRegime || regimeFetchedRef.current) return;
    regimeFetchedRef.current = true;
    (async () => {
      try {
        const [niftyRes, vixRes] = await Promise.allSettled([
          fetchOHLCVClient('^NSEI'),
          fetchOHLCVClient('^INDIAVIX'),
        ]);
        const nc = niftyRes.status === 'fulfilled' ? niftyRes.value.candles : null;
        const vc = vixRes.status === 'fulfilled' ? vixRes.value.candles : null;
        if (nc && nc.length > 50) {
          setNiftyCandles(nc);
          if (vc && vc.length > 20) setVixCandles(vc);
          setMarketRegime(detectMarketRegime(nc, vc ?? undefined));
          // Gap + VIX morning alert (Gift Nifty proxy)
          // Backtested: gap>+0.5% + VIX<15 = 93.2% bullish, gap<-0.5% + VIX>20 = 85.1% bearish
          const lastCandle = nc[nc.length - 1];
          const prevCandle = nc[nc.length - 2];
          const currentVix = vc && vc.length > 0 ? vc[vc.length - 1].c : 0;
          // Data freshness guard: only show gap alert when last Nifty candle is from today (IST).
          // Without this, weekend/pre-market fetches would show yesterday's open vs day-before close — a stale, irrelevant gap.
          const istMs = 19800000; // UTC+5:30 in milliseconds
          const todayIST = new Date(Date.now() + istMs).toISOString().slice(0, 10);
          const lastCandleDateIST = lastCandle ? new Date(lastCandle.ts * 1000 + istMs).toISOString().slice(0, 10) : '';
          const gapIsFresh = lastCandleDateIST === todayIST;
          if (gapIsFresh && lastCandle && prevCandle && prevCandle.c > 0) {
            const gapPct = ((lastCandle.o - prevCandle.c) / prevCandle.c) * 100;
            if (gapPct > 0.5 && currentVix > 0 && currentVix < 15) {
              setGapAlert({ type: 'bullish', gapPct, vix: currentVix, confidence: 93.2, prevClose: prevCandle.c, todayOpen: lastCandle.o });
            } else if (gapPct < -0.5 && currentVix > 20) {
              setGapAlert({ type: 'bearish', gapPct, vix: currentVix, confidence: 85.1, prevClose: prevCandle.c, todayOpen: lastCandle.o });
            } else if (gapPct > 0.3 && currentVix > 0 && currentVix < 16) {
              setGapAlert({ type: 'bullish', gapPct, vix: currentVix, confidence: 67.4, prevClose: prevCandle.c, todayOpen: lastCandle.o });
            } else if (gapPct < -0.3 && currentVix > 18) {
              setGapAlert({ type: 'bearish', gapPct, vix: currentVix, confidence: 71.3, prevClose: prevCandle.c, todayOpen: lastCandle.o });
            }
          }
        }
      } catch {}
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // #4: Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') { setSelectedSymbol(null); setShowPasteBox(false); setShowCompare(false); }
      if (e.key === 'ArrowDown' && filteredResults.length > 0) {
        e.preventDefault();
        setSelectedRowIdx(prev => { const next = Math.min(prev + 1, filteredResults.length - 1); setSelectedSymbol(filteredResults[next]?.symbol ?? null); return next; });
      }
      if (e.key === 'ArrowUp' && filteredResults.length > 0) {
        e.preventDefault();
        setSelectedRowIdx(prev => { const next = Math.max(prev - 1, 0); setSelectedSymbol(filteredResults[next]?.symbol ?? null); return next; });
      }
      if (e.key === 't' && selectedResult?.priceEngine.tradeValid) trackTrade(selectedResult);
      if (e.key === 'w' && selectedResult) {
        if (!watchlist.some(w => w.symbol === selectedResult.symbol)) {
          const item: WatchlistItem = { symbol: selectedResult.symbol, note: '', addedDate: new Date().toISOString().slice(0,10), stage: selectedResult.stage, lastClose: selectedResult.lastClose };
          const updated = [...watchlist, item]; setWatchlist(updated); saveWatchlist(updated);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filteredResults, selectedRowIdx, selectedResult, watchlist]);

  // Feature #12: Scan diff — what changed since last scan
  const scanDiff = useMemo(() => {
    if (previousResults.length === 0) return new Map<string, { prev: StageRating; curr: StageRating }>();
    const prevMap = new Map(previousResults.map(r => [r.symbol, r.stage]));
    const diff = new Map<string, { prev: StageRating; curr: StageRating }>();
    for (const r of results) {
      const prev = prevMap.get(r.symbol);
      if (prev && prev !== r.stage) diff.set(r.symbol, { prev, curr: r.stage });
    }
    return diff;
  }, [results, previousResults]);

  // Feature #11: Near-breakout count
  // Count IMMINENT+NEAR+WATCH (≤5%) — matches what the BRK button filter shows.
  // Old: used r.nearBreakout which is only ≤2.5%, undercounting vs the button.
  const nearBreakoutCount = useMemo(() => results.filter(r => r.nearBreakoutTier === 'IMMINENT' || r.nearBreakoutTier === 'NEAR' || r.nearBreakoutTier === 'WATCH').length, [results]);
  const aPlusCount = useMemo(() => results.filter(r => r.priceEngine?.breakoutTier === 'A+').length, [results]);

  // Feature #2: Sector heatmap data
  const sectorHeatData = useMemo(() => {
    const sectorMap: Record<string, Record<string, number>> = {};
    const SECTOR_PRESETS_LOCAL = typeof SECTOR_PRESETS !== 'undefined' ? SECTOR_PRESETS : [];
    for (const sp of SECTOR_PRESETS_LOCAL) {
      const sectorStocks = new Set(sp.symbols);
      const counts: Record<string, number> = {};
      for (const r of results) {
        if (sectorStocks.has(r.symbol.replace('.NS', '').replace('.BO', ''))) {
          counts[r.stage] = (counts[r.stage] ?? 0) + 1;
        }
      }
      const total = Object.values(counts).reduce((s, v) => s + v, 0);
      if (total > 0) sectorMap[sp.label] = counts;
    }
    return sectorMap;
  }, [results]);

  // Feature #9: Data quality
  const dataQuality = useMemo(() => {
    if (results.length === 0) return null;
    const dates = results.map(r => r.lastDate).filter(d => d);
    const latestDate = dates.sort().pop() ?? '';
    const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10); // IST date
    const isStale = latestDate && latestDate < today;
    return { latestDate, isStale, totalStocks: results.length, withZone: results.filter(r => r.zone).length };
  }, [results]);

  // Feature #8: Shift+click for secondary sort
  function handleSort(key: string, shiftKey = false) {
    if (shiftKey && sortCol !== key) {
      if (secondarySortCol === key) setSecondarySortDir(d => d === 'desc' ? 'asc' : 'desc');
      else { setSecondarySortCol(key); setSecondarySortDir('desc'); }
    } else {
      if (sortCol === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
      else { setSortCol(key); setSortDir('desc'); setSecondarySortCol(null); }
    }
  }

  const hasColFilters = Object.values(colFilters).some(v => v);

  const exportCSV = useCallback(() => {
    exportGroupCSV(filteredResults, COLUMNS, 'quant_terminal_pro.csv');
  }, [filteredResults]);

  const exportXLSX = useCallback(async () => {
    await exportGroupXLSX(filteredResults, COLUMNS, 'quant_terminal_pro.xlsx');
  }, [filteredResults]);

  const pasteSymbols = useMemo(() => parseSymbols(pasteText), [pasteText]);

  return (
    <main className={`h-screen flex flex-col overflow-hidden ${theme === 'dark' ? 'bg-[#0a0c10] text-slate-100' : 'theme-light bg-white text-slate-900'}`}>

      {/* ── Header ── */}
      <header className="flex-shrink-0 border-b border-slate-800 bg-[#0d1117] px-4 py-2.5 flex items-center gap-3">
        <div className="w-7 h-7 bg-indigo-600 rounded flex items-center justify-center text-xs font-bold text-white select-none">Q</div>
        <span className="font-bold text-slate-100 text-sm">Dr KKR Quant Terminal Pro</span>
        <span className="text-xs text-slate-600">v9.0</span>
        <select
          value={scanAll ? 'ALL4' : paramSetKey}
          onChange={e => {
            if (e.target.value === 'ALL4') { setScanAll(true); try { localStorage.setItem('qtp_paramset', 'ALL4'); } catch {} }
            else { setScanAll(false); setParamSetKey(e.target.value as ParamSetKey); try { localStorage.setItem('qtp_paramset', e.target.value); } catch {} }
          }}
          className={`ml-2 border-2 rounded-md text-[13px] font-semibold px-3 py-1.5 focus:outline-none cursor-pointer shadow-md transition-all ${scanAll ? 'bg-cyan-950 border-cyan-400 text-cyan-100 focus:border-cyan-300' : 'bg-slate-950 border-indigo-500 text-indigo-100 focus:border-indigo-300'}`}
          style={{colorScheme:'dark'}}
        >
          <option value="ALL4">★ All 6 Param Sets (Multi-Scan)</option>
          {PARAM_SET_OPTIONS.map(o => (
            <option key={o.key} value={o.key}>{o.name} [{o.tag}]</option>
          ))}
        </select>
        {/* Feature #3: Lookback — disabled in multi-scan mode */}
        <div className="flex items-center gap-1 text-xs" data-tip={scanAll ? 'Lookback N/A in 6-Set mode' : undefined} data-tip-color={scanAll ? 'slate' : undefined}>
          <span className={scanAll ? 'text-slate-700' : 'text-slate-600'}>Lookback:</span>
          <select value={lookback} onChange={e => setLookback(Number(e.target.value))}
            disabled={scanAll}
            className={`bg-slate-800 border border-slate-700 rounded text-xs px-1 py-0.5 focus:outline-none transition-colors ${scanAll ? 'text-slate-700 cursor-not-allowed opacity-40' : 'text-slate-300 cursor-pointer'}`}>
            <option value={1}>1d</option>
            <option value={3}>3d</option>
            <option value={5}>5d</option>
          </select>
        </div>
        {/* Feature #5: Auto-refresh */}
        <button onClick={() => setAutoRefresh(v => !v)}
          className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${autoRefresh ? 'bg-green-900/50 border-green-600 text-green-300' : 'bg-slate-800 border-slate-700 text-slate-600 hover:text-slate-400'}`}>
          {autoRefresh ? '⟳ Auto 15m' : '⟳ Auto'}
        </button>
        {/* #9: Market Regime — 8-factor + VIX + CUSUM */}
        {marketRegime ? (<>
          <div className={`px-2.5 py-0.5 rounded text-xs font-bold border cursor-help ${
            marketRegime.regime === 'strong_bull' ? 'bg-green-900/50 border-green-500 text-green-300' :
            marketRegime.regime === 'bull' ? 'bg-green-900/40 border-green-600 text-green-300' :
            marketRegime.regime === 'neutral' ? 'bg-yellow-900/40 border-yellow-600 text-yellow-300' :
            marketRegime.regime === 'bear' ? 'bg-red-900/40 border-red-600 text-red-300' :
            'bg-red-900/60 border-red-500 text-red-300 animate-pulse'}`}
            data-tip-html={`<div class="rt-hdr">9-Factor Regime · Score ${marketRegime.score >= 0 ? '+' : ''}${marketRegime.score}</div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.dayChangePct >= 0 ? 'bg-emerald' : 'bg-orange'}">Today</span></div><div><div class="rt-desc">1d return: ${marketRegime.dayChangePct >= 0 ? '+' : ''}${marketRegime.dayChangePct.toFixed(2)}%</div></div></div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.factors.momentum >= 0 ? 'bg-emerald' : 'bg-orange'}">Momentum</span></div><div><div class="rt-desc">20d return: ${marketRegime.factors.momentum >= 0 ? '+' : ''}${marketRegime.factors.momentum.toFixed(2)}%</div></div></div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.factors.breadth > 50 ? 'bg-emerald' : 'bg-orange'}">Breadth</span></div><div><div class="rt-desc">${marketRegime.factors.breadth.toFixed(0)}% green days</div></div></div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.factors.volatility < 1.5 ? 'bg-teal' : 'bg-orange'}">Volatility</span></div><div><div class="rt-desc">${marketRegime.factors.volatility.toFixed(2)}% realized vol</div></div></div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.factors.acceleration >= 0 ? 'bg-cyan' : 'bg-orange'}">Accel</span></div><div><div class="rt-desc">${marketRegime.factors.acceleration >= 0 ? '+' : ''}${marketRegime.factors.acceleration.toFixed(2)}%</div></div></div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.factors.distEma200 >= 0 ? 'bg-blue' : 'bg-orange'}">EMA200</span></div><div><div class="rt-desc">${marketRegime.factors.distEma200 >= 0 ? '+' : ''}${marketRegime.factors.distEma200.toFixed(1)}% from EMA200</div></div></div>`
              + (marketRegime.vix > 0 ? `<div class="rt-row"><div><span class="rt-badge ${marketRegime.vix < 20 ? 'bg-emerald' : 'bg-orange'}">VIX</span></div><div><div class="rt-desc">${marketRegime.vix.toFixed(1)} ${marketRegime.vix < 12 ? '(complacent)' : marketRegime.vix < 16 ? '(low fear)' : marketRegime.vix < 22 ? '(moderate)' : marketRegime.vix < 30 ? '(elevated)' : marketRegime.vix < 45 ? '(high fear)' : '(PANIC)'}</div></div></div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.factors.vixROC < 0 ? 'bg-emerald' : 'bg-orange'}">VIX ROC</span></div><div><div class="rt-desc">5d change: ${marketRegime.factors.vixROC >= 0 ? '+' : ''}${marketRegime.factors.vixROC.toFixed(1)}%</div></div></div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.factors.vixVsSma < 0 ? 'bg-teal' : 'bg-orange'}">VIX/SMA</span></div><div><div class="rt-desc">${marketRegime.factors.vixVsSma >= 0 ? '+' : ''}${marketRegime.factors.vixVsSma.toFixed(1)}% vs 20d avg</div></div></div>` : '')
              + `<div class="rt-row"><div><span class="rt-badge bg-neon">Sizing</span></div><div><div class="rt-desc">Position: ×${marketRegime.sizingMultiplier}</div></div></div>`
              + (() => { const ts = niftyCandles?.[niftyCandles.length-1]?.ts; const d = ts ? new Date(ts*1000+19800000).toISOString().slice(0,10) : ''; const today = new Date(Date.now()+19800000).toISOString().slice(0,10); const fresh = d===today; return `<div class="rt-row"><div><span class="rt-badge ${fresh?'bg-teal':'bg-orange'}">Data</span></div><div><div class="rt-desc">As of: ${d||'unavailable'}</div><div class="rt-hit ${fresh?'hit-green':'hit-amber'}">${fresh?'Today\'s live data':'Prior session — click \'Check Market\' to refresh'}</div></div></div>`; })()}>
            {marketRegime.emoji} {marketRegime.label} · Nifty ₹{marketRegime.niftyClose.toFixed(0)} {marketRegime.dayChangePct >= 0 ? `▲ +${marketRegime.dayChangePct.toFixed(2)}%` : `▼ ${marketRegime.dayChangePct.toFixed(2)}%`}{marketRegime.vix > 0 ? ` · VIX ${marketRegime.vix.toFixed(1)}` : ''} · ×{marketRegime.sizingMultiplier}
          </div>
          {/* Signal Regime — trading decision derived from existing regime state */}
          {(() => {
            const r = marketRegime.regime;
            const isBull    = r === 'strong_bull' || r === 'bull';
            const isCaution = r === 'neutral';
            const isAvoid   = r === 'bear' || r === 'strong_bear';
            const label  = isBull ? '🟢 BULL REGIME' : isCaution ? '🟡 CAUTION' : '🔴 AVOID';
            const cls    = isBull
              ? 'bg-emerald-900/50 border-emerald-500 text-emerald-300'
              : isCaution
              ? 'bg-yellow-900/40 border-yellow-500 text-yellow-300'
              : 'bg-red-900/50 border-red-500 text-red-300 animate-pulse';
            const tip = isBull
              ? 'Signal Regime: BULL — all 5 param sets active · full position sizing'
              : isCaution
              ? 'Signal Regime: CAUTION — take only Elite/Sniper signals · reduce size to ×0.75'
              : 'Signal Regime: AVOID — regime filter suppressing signals · stand aside or hedge only';
            return (
              <div className={`px-2.5 py-0.5 rounded text-xs font-bold border cursor-help ${cls}`}
                title={tip}>
                {label}
              </div>
            );
          })()}
          {marketRegime.cusumAlert && (
            <div className={`px-2 py-0.5 rounded text-xs font-bold border ${marketRegime.cusumAlert === 'bearish_shift' ? 'bg-red-900/60 border-red-500 text-red-300 animate-pulse' : 'bg-green-900/50 border-green-500 text-green-300'}`}>
              {marketRegime.cusumAlert === 'bearish_shift' ? '⚠️ CUSUM: Bearish shift detected' : '✅ CUSUM: Bullish shift detected'}
            </div>
          )}
          {marketRegime.blackSwanLevel !== 'normal' && (
            <div className={`px-2.5 py-1 rounded text-xs font-bold border cursor-help ${
              marketRegime.blackSwanLevel === 'extreme' ? 'bg-red-950/80 border-red-500 text-red-200 animate-pulse' :
              marketRegime.blackSwanLevel === 'severe' ? 'bg-red-900/60 border-red-600 text-red-300 animate-pulse' :
              marketRegime.blackSwanLevel === 'high' ? 'bg-orange-900/50 border-orange-600 text-orange-300' :
              'bg-yellow-900/40 border-yellow-600 text-yellow-300'}`}
              data-tip-html={`<div class="rt-hdr">${marketRegime.blackSwanLevel === 'extreme' ? '💀' : marketRegime.blackSwanLevel === 'severe' ? '🔴' : marketRegime.blackSwanLevel === 'high' ? '🟠' : '🟡'} Black Swan Warning — ${marketRegime.blackSwanLevel.toUpperCase()}</div>`
                + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.blackSwanLevel==='extreme'||marketRegime.blackSwanLevel==='severe'?'bg-orange':'bg-yellow'}">Trigger</span></div><div><div class="rt-desc">VIX: ${marketRegime.vix.toFixed(1)} | VIX ROC: ${marketRegime.factors.vixROC>=0?'+':''}${marketRegime.factors.vixROC.toFixed(0)}% | Nifty momentum: ${marketRegime.factors.momentum>=0?'+':''}${marketRegime.factors.momentum.toFixed(1)}%</div></div></div>`
                + `<div class="rt-row"><div><span class="rt-badge bg-orange">Action</span></div><div><div class="rt-desc">${marketRegime.blackSwanAction}</div></div></div>`
                + `<div class="rt-row"><div><span class="rt-badge bg-teal">Backtest</span></div><div><div class="rt-desc">10yr Nifty+VIX: this level caught COVID crash 25 days early (Feb 26, 2020). System escalated from ELEVATED → HIGH → SEVERE → EXTREME as crash deepened.</div><div class="rt-hit hit-amber">Insurance system — most triggers are false alarms, but the one time it's real saves your capital</div></div></div>`}>
              {marketRegime.blackSwanLevel === 'extreme' ? '💀' : marketRegime.blackSwanLevel === 'severe' ? '🔴' : marketRegime.blackSwanLevel === 'high' ? '🟠' : '🟡'} {marketRegime.blackSwanLevel.toUpperCase()}: {marketRegime.blackSwanAction.split('.')[0]}
            </div>
          )}
          {gapAlert && (
            <div className={`px-2 py-0.5 rounded text-xs font-bold border cursor-help ${
              gapAlert.type === 'bullish' ? 'bg-emerald-900/40 border-emerald-600 text-emerald-300' : 'bg-red-900/40 border-red-600 text-red-300'}`}
              data-tip-html={`<div class="rt-hdr">Gap + VIX Morning Alert (Gift Nifty Proxy)</div>`
                + `<div class="rt-row"><div><span class="rt-badge ${gapAlert.type==='bullish'?'bg-emerald':'bg-orange'}">Gap</span></div><div><div class="rt-desc">Today open: Rs.${gapAlert.todayOpen.toFixed(0)} vs prev close: Rs.${gapAlert.prevClose.toFixed(0)} = ${gapAlert.gapPct>=0?'+':''}${gapAlert.gapPct.toFixed(2)}%</div></div></div>`
                + `<div class="rt-row"><div><span class="rt-badge ${gapAlert.vix<16?'bg-teal':'bg-orange'}">VIX</span></div><div><div class="rt-desc">India VIX: ${gapAlert.vix.toFixed(1)} ${gapAlert.vix<15?'(low fear — calm)':gapAlert.vix<20?'(moderate)':'(elevated — anxiety)'}</div></div></div>`
                + `<div class="rt-row"><div><span class="rt-badge bg-neon">Backtest</span></div><div><div class="rt-desc">10yr Nifty daily data: this opening gap + VIX combo resolved ${gapAlert.type==='bullish'?'bullish':'bearish'} ${gapAlert.confidence.toFixed(1)}% of sessions next day</div><div class="rt-hit hit-green">Historical base rate · Not a guarantee — verify with live Gift Nifty before trading</div></div></div>`}>
              {gapAlert.type === 'bullish' ? '📈' : '📉'} Gap {gapAlert.gapPct >= 0 ? '+' : ''}{gapAlert.gapPct.toFixed(2)}% · VIX {gapAlert.vix.toFixed(1)} · {gapAlert.confidence.toFixed(0)}% {gapAlert.type === 'bullish' ? 'Bullish' : 'Bearish'}
            </div>
          )}
          <button
            data-tip="Download regime tear sheet PDF" data-tip-color="cyan"
            onClick={async () => {
              try {
                const jsPDF = (await import('jspdf')).default;
                const autoTable = (await import('jspdf-autotable')).default;
                const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                const W = 210, mr = marketRegime, f = mr.factors;
                const now = new Date().toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'short' });
                const isBull = mr.regime.includes('bull'), isBear = mr.regime.includes('bear');
                const accentR = isBull ? 34 : isBear ? 220 : 200;
                const accentG = isBull ? 197 : isBear ? 50 : 160;
                const accentB = isBull ? 94 : isBear ? 50 : 0;

                // ── Dark header band ──
                doc.setFillColor(13, 17, 23); doc.rect(0, 0, W, 42, 'F');
                // Accent bar
                doc.setFillColor(accentR, accentG, accentB); doc.rect(0, 42, W, 2, 'F');
                // Title
                doc.setTextColor(255, 255, 255); doc.setFontSize(16);
                doc.text('Dr KKR Quant Terminal Pro', 15, 14);
                doc.setFontSize(10); doc.setTextColor(150, 160, 170);
                doc.text('Market Regime Tear Sheet', 15, 21);
                doc.setFontSize(8); doc.text(now, 15, 28);
                // Regime badge (right side)
                doc.setFillColor(accentR, accentG, accentB); doc.roundedRect(130, 8, 65, 14, 3, 3, 'F');
                doc.setTextColor(255, 255, 255); doc.setFontSize(13);
                doc.text(mr.label.toUpperCase(), 162.5, 16, { align: 'center' });
                // Score + sizing below badge
                doc.setTextColor(200, 210, 220); doc.setFontSize(9);
                doc.text(`Score: ${mr.score >= 0 ? '+' : ''}${mr.score}  |  Sizing: x${mr.sizingMultiplier}`, 162.5, 28, { align: 'center' });
                // CUSUM alert
                if (mr.cusumAlert) {
                  doc.setFillColor(mr.cusumAlert === 'bearish_shift' ? 127 : 20, mr.cusumAlert === 'bearish_shift' ? 29 : 83, mr.cusumAlert === 'bearish_shift' ? 29 : 45);
                  doc.roundedRect(130, 32, 65, 7, 2, 2, 'F');
                  doc.setTextColor(255, 200, 200); doc.setFontSize(7);
                  doc.text(mr.cusumAlert === 'bearish_shift' ? 'CUSUM: Bearish Shift Detected' : 'CUSUM: Bullish Shift Detected', 162.5, 37, { align: 'center' });
                }

                // ── KPI Cards Row ──
                let y = 52;
                const kpis = [
                  ['Nifty 50', `Rs.${mr.niftyClose.toFixed(0)}`],
                  ['EMA 50', `Rs.${mr.ema50.toFixed(0)}`],
                  ['EMA 200', `Rs.${mr.ema200.toFixed(0)}`],
                  ['India VIX', mr.vix > 0 ? mr.vix.toFixed(2) : 'N/A'],
                ];
                const cardW = 42, gap = 4, startX = 15;
                for (let k = 0; k < kpis.length; k++) {
                  const cx = startX + k * (cardW + gap);
                  doc.setFillColor(245, 247, 250); doc.roundedRect(cx, y, cardW, 18, 2, 2, 'F');
                  doc.setDrawColor(220, 225, 230); doc.roundedRect(cx, y, cardW, 18, 2, 2, 'S');
                  doc.setTextColor(120, 130, 140); doc.setFontSize(7); doc.text(kpis[k][0], cx + cardW / 2, y + 6, { align: 'center' });
                  doc.setTextColor(30, 40, 50); doc.setFontSize(11); doc.text(kpis[k][1], cx + cardW / 2, y + 14, { align: 'center' });
                }

                // ── 8-Factor Analysis Table ──
                y = 78;
                doc.setTextColor(30, 40, 50); doc.setFontSize(11); doc.text('8-Factor Composite Analysis', 15, y);
                doc.setDrawColor(accentR, accentG, accentB); doc.setLineWidth(0.5); doc.line(15, y + 2, 95, y + 2);
                y += 6;
                const signalColor = (bullish: boolean): [number, number, number] => bullish ? [230, 255, 230] : [255, 235, 235];
                const textSignal = (bullish: boolean): [number, number, number] => bullish ? [22, 128, 57] : [180, 40, 40];
                const factorData = [
                  { name: 'Momentum (20d return)', val: `${f.momentum >= 0 ? '+' : ''}${f.momentum.toFixed(2)}%`, interp: f.momentum > 2 ? 'Bullish' : f.momentum > 0 ? 'Mildly Bullish' : f.momentum > -2 ? 'Mildly Bearish' : 'Bearish', bull: f.momentum > 0 },
                  { name: 'Breadth (% green days)', val: `${f.breadth.toFixed(0)}%`, interp: f.breadth > 55 ? 'Strong participation' : f.breadth > 45 ? 'Mixed' : 'Weak', bull: f.breadth > 50 },
                  { name: 'Volatility (realized)', val: `${f.volatility.toFixed(2)}%`, interp: f.volatility < 1.0 ? 'Low - safe' : f.volatility < 1.8 ? 'Moderate' : 'High - caution', bull: f.volatility < 1.5 },
                  { name: 'Acceleration', val: `${f.acceleration >= 0 ? '+' : ''}${f.acceleration.toFixed(2)}%`, interp: f.acceleration > 1 ? 'Accelerating' : f.acceleration > -1 ? 'Stable' : 'Decelerating', bull: f.acceleration > 0 },
                  { name: 'EMA200 Distance', val: `${f.distEma200 >= 0 ? '+' : ''}${f.distEma200.toFixed(1)}%`, interp: f.distEma200 > 3 ? 'Well above' : f.distEma200 > 0 ? 'Above - healthy' : 'Below - watch', bull: f.distEma200 > -3 },
                  { name: 'India VIX Level', val: f.vixLevel > 0 ? f.vixLevel.toFixed(1) : 'N/A', interp: f.vixLevel < 16 ? 'Low fear' : f.vixLevel < 22 ? 'Moderate' : f.vixLevel < 30 ? 'Elevated' : 'High fear', bull: f.vixLevel < 20 },
                  { name: 'VIX 5-day ROC', val: `${f.vixROC >= 0 ? '+' : ''}${f.vixROC.toFixed(1)}%`, interp: f.vixROC < -5 ? 'Fear subsiding' : f.vixROC < 5 ? 'Stable' : 'Fear rising', bull: f.vixROC < 5 },
                  { name: 'VIX vs 20d SMA', val: `${f.vixVsSma >= 0 ? '+' : ''}${f.vixVsSma.toFixed(1)}%`, interp: f.vixVsSma < -5 ? 'Below avg - calm' : f.vixVsSma < 5 ? 'At average' : 'Above avg - stress', bull: f.vixVsSma < 5 },
                ];
                autoTable(doc, {
                  startY: y, margin: { left: 15, right: 15 },
                  head: [['#', 'Factor', 'Value', 'Reading', 'Signal']],
                  body: factorData.map((fd, idx) => [String(idx + 1), fd.name, fd.val, fd.interp, fd.bull ? 'BULLISH' : 'BEARISH']),
                  theme: 'plain',
                  headStyles: { fillColor: [30, 41, 59], textColor: [220, 230, 240], fontSize: 8, fontStyle: 'bold', cellPadding: 3 },
                  bodyStyles: { fontSize: 8.5, cellPadding: 2.5, lineWidth: 0.1, lineColor: [230, 235, 240] },
                  columnStyles: { 0: { cellWidth: 8, halign: 'center', textColor: [140, 150, 160] }, 1: { cellWidth: 50 }, 2: { cellWidth: 25, halign: 'right', fontStyle: 'bold' }, 3: { cellWidth: 45 }, 4: { cellWidth: 22, halign: 'center', fontStyle: 'bold' } },
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  didParseCell: (data: any) => {
                    if (data.section === 'body' && data.column.index === 4) {
                      const bull = factorData[data.row.index]?.bull;
                      data.cell.styles.fillColor = signalColor(!!bull);
                      data.cell.styles.textColor = textSignal(!!bull);
                    }
                  },
                  alternateRowStyles: { fillColor: [250, 251, 253] },
                });

                // ── Regime Scale ──
                const tblEnd = ((doc as unknown as Record<string, Record<string, number>>).lastAutoTable?.finalY ?? 170) + 10;
                doc.setTextColor(30, 40, 50); doc.setFontSize(10); doc.text('Position Sizing Scale', 15, tblEnd);
                doc.setDrawColor(accentR, accentG, accentB); doc.setLineWidth(0.5); doc.line(15, tblEnd + 2, 80, tblEnd + 2);
                const scaleData: Array<[string, string, number, number, number, boolean]> = [
                  ['Strong Bull', 'x1.25  (Score >= +40)', 22, 163, 74, mr.regime === 'strong_bull'],
                  ['Bull', 'x1.00  (Score +15 to +39)', 46, 184, 108, mr.regime === 'bull'],
                  ['Neutral', 'x0.75  (Score -15 to +14)', 202, 160, 20, mr.regime === 'neutral'],
                  ['Bear', 'x0.25  (Score -16 to -40)', 220, 80, 80, mr.regime === 'bear'],
                  ['Strong Bear', 'x0.00  (Score < -40)', 185, 28, 28, mr.regime === 'strong_bear'],
                ];
                let sy = tblEnd + 6;
                for (const [label, desc, r2, g, b, active] of scaleData) {
                  if (active) { doc.setFillColor(r2, g, b); doc.roundedRect(14, sy - 1, 182, 9, 2, 2, 'F'); doc.setTextColor(255, 255, 255); }
                  else { doc.setFillColor(248, 249, 250); doc.roundedRect(14, sy - 1, 182, 9, 2, 2, 'F'); doc.setDrawColor(230, 230, 230); doc.roundedRect(14, sy - 1, 182, 9, 2, 2, 'S'); doc.setTextColor(100, 110, 120); }
                  doc.setFontSize(8); doc.text(label, 18, sy + 5);
                  doc.setFontSize(7); doc.text(desc, 60, sy + 5);
                  // Dot indicator
                  doc.setFillColor(r2, g, b); doc.circle(190, sy + 3, 2, 'F');
                  sy += 11;
                }

                // ── Footer ──
                const footY = 280;
                doc.setDrawColor(200, 205, 210); doc.line(15, footY - 5, W - 15, footY - 5);
                doc.setTextColor(160, 165, 170); doc.setFontSize(7);
                doc.text('Dr KKR Quant Terminal Pro | 8-Factor + VIX Regime Engine', 15, footY);
                doc.text('Backtested on 10yr Nifty + India VIX: +2,101% return, 7.8% max DD, Ret/DD 269.9', 15, footY + 4);
                doc.text('This is not investment advice. Past performance does not guarantee future results.', 15, footY + 8);
                doc.setTextColor(accentR, accentG, accentB); doc.setFontSize(7);
                doc.text(`Generated: ${now}`, W - 15, footY, { align: 'right' });

                doc.save(`RegimeTearSheet_${new Date().toISOString().slice(0, 10)}.pdf`);
              } catch (e) { console.error('PDF export error:', e); }
            }}
            className="px-1.5 py-0.5 rounded text-[10px] font-medium border bg-slate-800 border-slate-700 text-slate-500 hover:text-cyan-300 hover:border-cyan-700 transition-colors">
            📋
          </button>
        </>) : (
          <button onClick={async () => {
            try {
              const [nR, vR] = await Promise.allSettled([fetchOHLCVClient('^NSEI'), fetchOHLCVClient('^INDIAVIX')]);
              const nc = nR.status === 'fulfilled' ? nR.value.candles : null;
              const vc = vR.status === 'fulfilled' ? vR.value.candles : null;
              if (nc && nc.length > 50) { setNiftyCandles(nc); if (vc) setVixCandles(vc); setMarketRegime(detectMarketRegime(nc, vc ?? undefined)); }
            } catch {}
          }}
            className="px-2 py-0.5 rounded text-xs font-medium border bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300 transition-colors">
            🔍 Check Market</button>
        )}
        {marketBreadth && (
          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${marketBreadth.pct >= 60 ? 'bg-emerald-900/30 border-emerald-700 text-emerald-300' : marketBreadth.pct >= 40 ? 'bg-yellow-900/30 border-yellow-700 text-yellow-300' : 'bg-red-900/30 border-red-700 text-red-300'}`}
            title={`Scan breadth: ${marketBreadth.above200} of ${marketBreadth.total} scanned stocks above 200 SMA (current scan universe only, not full Nifty 500) — ${marketBreadth.pct >= 60 ? 'Healthy' : marketBreadth.pct >= 40 ? 'Mixed' : 'Weak'}`}>
            Scan {marketBreadth.pct.toFixed(0)}%
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {(() => {
            const openT = trackedTrades.filter(t => t.status === 'open');
            if (openT.length === 0) return <span className="text-[10px] text-slate-600 font-mono flex items-center gap-1">Acc ₹<input type="number" value={accountSize} onChange={e => setAccountSize(Number(e.target.value) || 0)} className="w-14 bg-transparent border-b border-slate-700 focus:border-indigo-500 text-slate-400 text-[10px] font-mono text-center focus:outline-none" />({(accountSize/100000).toFixed(0)}L)</span>;
            const totalRisk = openT.reduce((s, t) => s + Math.max(t.entryPrice - t.stopLoss, 0), 0);
            const totalCap = openT.reduce((s, t) => s + t.entryPrice, 0);
            const riskPct = accountSize > 0 ? (totalRisk / accountSize * 100) : 0;
            return (
              <span className={`text-[10px] font-mono ${riskPct > 3 ? 'text-red-400' : riskPct > 1.5 ? 'text-amber-400' : 'text-slate-500'}`}
                title={`${openT.length} open · ₹${(totalCap/1000).toFixed(0)}K deployed · ₹${totalRisk.toFixed(0)} at risk`}>
                {openT.length} pos · ₹{totalRisk.toFixed(0)} risk ({riskPct.toFixed(1)}%) · <input type="number" value={accountSize} onChange={e => setAccountSize(Number(e.target.value) || 0)} className="w-14 bg-transparent border-b border-slate-700 focus:border-indigo-500 text-[10px] font-mono text-center focus:outline-none" style={{color: 'inherit'}} />({(accountSize/100000).toFixed(0)}L)
              </span>
            );
          })()}
          {results.length > 0 && (
            <button onClick={() => setShowRiskSizer(v => !v)}
              className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${showRiskSizer ? 'bg-emerald-900/50 border-emerald-600 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>
              ₹ Risk</button>
          )}
          <input value={globalSearch} onChange={e => setGlobalSearch(e.target.value)}
            placeholder="🔍 Search…"
            className="w-28 px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 focus:outline-none focus:border-indigo-500" />
        </div>
      </header>

      {/* ── Controls bar — organized into logical groups ── */}
      <div className="flex-shrink-0 border-b border-slate-800 bg-[#0d1117] px-4 py-1.5 flex items-center gap-1 overflow-x-auto">

        {/* Group 1: Scan actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button disabled={scanning} data-tip="Clear results and start a fresh scan" data-tip-color="red" onClick={() => { abortRef.current = true; setScanning(false); scanningRef.current = false; setResults([]); setSelectedSymbol(null); setStageFilter('ALL'); setGlobalSearch(''); setColFilters({}); setErrCount(0); setLastErr(''); }}
            className="h-7 px-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 rounded text-[11px] font-medium text-slate-200 transition-colors">New Scan</button>
          <button disabled={scanning} data-tip="Load sample data to explore the screener without scanning" data-tip-color="indigo" onClick={() => { setResults(generateDemoData(scanAll ? 'optimized_deployable_20plus' : paramSetKey)); setSelectedSymbol(null); setStageFilter('ALL'); setColFilters({}); }}
            className="h-7 px-2.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 rounded text-[11px] font-medium text-white transition-colors">Demo</button>
          {lastScanSymbols.length > 0 && (
            <button disabled={scanning} data-tip={`Rescan same ${lastScanSymbols.length} stocks from last scan`} data-tip-color="green"
              onClick={() => runScan(lastScanSymbols)}
              className="h-7 px-2.5 bg-emerald-900/40 hover:bg-emerald-900/60 disabled:opacity-40 border border-emerald-700 rounded text-[11px] font-semibold text-emerald-300 transition-colors">↻ Rescan</button>
          )}
          <button disabled={scanning} data-tip="Upload a CSV file with stock symbols (one per row)" data-tip-color="blue" onClick={() => fileInputRef.current?.click()}
            className="h-7 px-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 rounded text-[11px] font-medium text-slate-300 transition-colors">CSV ↑</button>
          <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileUpload} disabled={scanning} />
          {trackedTrades.filter(t => t.status === 'open').length > 0 && (
            <button disabled={scanning}
              data-tip="Fetch latest prices for tracked trades only — validates stops, targets, MFE/MAE without running a full scan"
              data-tip-color="cyan"
              onClick={async () => {
                if (scanningRef.current) return;
                // Include stopped/partial-exit trades: false-stop recovery + live mark-to-market
                const openTrades = trackedTradesRef.current.filter(t => t.status === 'open' || t.status === 'stopped' || t.status === 'hit_t1' || t.status === 'hit_t2');
                if (openTrades.length === 0) return;
                setScanning(true); scanningRef.current = true;
                setTotal(openTrades.length); setProgress(0);
                try {
                  let updated = [...trackedTradesRef.current];
                  let validated = 0;
                  for (const t of openTrades) {
                    try {
                      const { candles } = await fetchOHLCVClient(t.symbol);
                      if (!candles || candles.length < 2) { setProgress(p => p + 1); continue; }
                      // Sync stop/targets from fresh analysis (ensures formula changes propagate)
                      const idx = updated.findIndex(u => u.symbol === t.symbol);
                      if (idx >= 0) {
                        try {
                          const freshR = analyzeStock(candles, (t.paramSetKey || 'optimized_deployable_20plus') as ParamSetKey);
                          if (freshR.priceEngine.tacticalStop > 0 && freshR.priceEngine.tacticalStop < t.entryPrice) {
                            updated[idx] = { ...updated[idx],
                              stopLoss: freshR.priceEngine.tacticalStop,
                              target1: freshR.priceEngine.target5,
                              target2: freshR.priceEngine.target7,
                              target3: freshR.priceEngine.target10,
                            };
                          }
                        } catch { /* analysis failed — keep existing values */ }
                      }
                      const entryDateStr2 = t.entryDate;
                      if (!entryDateStr2) { setProgress(p => p + 1); continue; }
                      // Always update CMP from latest candle regardless of whether post-entry candles exist
                      const lastCandle2 = candles[candles.length - 1];
                      if (idx >= 0 && lastCandle2 && lastCandle2.c > 0) {
                        const latestCmpDate2 = new Date((lastCandle2.ts + 19800) * 1000).toISOString().slice(0, 10);
                        updated[idx] = { ...updated[idx], currentPrice: lastCandle2.c, cmpDate: latestCmpDate2 };
                        validated++;
                      }
                      const sinceEntry = candles.filter(c => new Date((c.ts + 19800) * 1000).toISOString().slice(0, 10) > entryDateStr2);
                      if (sinceEntry.length === 0) { setProgress(p => p + 1); continue; }
                      const result = validateTrade(updated[idx >= 0 ? idx : 0], sinceEntry);
                      if (idx >= 0) {
                        let u = applyValidation(updated[idx], result);
                        const maxH = Math.max(...sinceEntry.map(c => c.h));
                        if (maxH > (u.highestPrice ?? 0)) u = { ...u, highestPrice: maxH };
                        updated[idx] = u;
                      }
                    } catch {}
                    setProgress(p => p + 1);
                  }
                  // Telegram alerts #2/#3: target hit / stopped + FAIL-SAFE stop alert
                  const prev = trackedTradesRef.current;
                  for (const u of updated) {
                    const p = prev.find(x => x.symbol === u.symbol);
                    if (!p || p.status !== 'open') continue;
                    if (tgConfig.enabled) {
                      if ((u.status === 'hit_t1' || u.status === 'hit_t2' || u.status === 'hit_t3') && tgConfig.alerts.targetHit) sendTelegramMessage(tgConfig, formatTargetHitAlert(u));
                      if (u.status === 'stopped' && tgConfig.alerts.stopped) sendTelegramMessage(tgConfig, formatStoppedAlert(u));
                    }
                    // FAIL-SAFE: Detect STOPPED → banner + sound
                    if (u.status === 'stopped') {
                      const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'medium' });
                      setStopAlerts(prev => [...prev, { symbol: u.symbol, stopPrice: u.stopLoss, timestamp: now, entryPrice: u.entryPrice }]);
                      try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1sbJObi4BvUl5zjJuTi3tlWm+Ij5eLgHVcYHWIkpKKe2pcanmGjo6IeGhbZ3mFjI2Jdmhba3eEi4yJeGldaXmFjY2LfG1gcX+KkJONgHFjcH+MlJaShXZpcIKPlpiWjoF3coCQmJyalIiBe4OSmJ2cmJOLhIaQl5ydnJeTjIiIkJaanJuZlI+KiI+Ul5qamJWRjIuNk5eZmpiVkY6LjJGVl5eXlJGOi4yQk5aWlpSRjoyLj5KUlZWUko+NjI6RkpSUlJKQjoyNj5GTk5OSkI6MjY+RkpKSkZCOjY2Oj5GRkZGQj42NjY+QkJCQj46NjY2Oj4+Pj4+OjY2Njo+Pj4+Pjo2NjY6Ojo6Ojo2NjY2Ojo6Ojo6NjY2NjY6Ojo6OjY2NjY2Njo6Ojo2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjQ==').play().catch(() => {}); } catch {}
                    }
                  }
                  setTrackedTrades(updated);
                  setValidateFlash(validated);
                  setTimeout(() => setValidateFlash(0), 3000);
                  // Telegram: push validation summary
                  if (tgConfig.enabled && tgConfig.alerts.validationSummary && validated > 0) {
                    const summaryMsg = formatValidationSummaryAlert(updated);
                    if (summaryMsg) sendTelegramMessage(tgConfig, summaryMsg);
                  }
                } catch {} finally {
                  setScanning(false); scanningRef.current = false;
                }
              }}
              className="h-7 px-2.5 bg-cyan-900/40 hover:bg-cyan-900/60 disabled:opacity-40 border border-cyan-600 rounded text-[11px] font-semibold text-cyan-300 transition-colors">
              {scanning ? `🔬 ${progress}/${total}` : validateFlash > 0 ? `✓ ${validateFlash} validated` : `🔬 Validate (${trackedTrades.filter(t => t.status === 'open' || t.status === 'stopped' || t.status === 'hit_t1' || t.status === 'hit_t2').length})`}</button>
          )}
        </div>

        <div className="w-px h-5 bg-slate-700 shrink-0" />

        {/* Group 2: Index presets */}
        <div className="flex items-center gap-1 shrink-0">
          <select disabled={scanning} value="" data-tip="Scan stocks from Nifty broad market indices (50, 100, 200, 500, Full Equity)" data-tip-color="green"
            onChange={e => { const p = NIFTY_PRESETS.find(p => p.key === e.target.value); if (p) { setScanSource(p.label); runScan([...p.symbols]); } }}
            className="h-7 px-2 bg-emerald-950 hover:bg-emerald-900 disabled:opacity-40 border border-emerald-600 rounded text-[11px] font-semibold text-emerald-200 cursor-pointer focus:outline-none focus:border-emerald-400 shadow-sm"
            style={{colorScheme:'dark'}}>
            <option value="" disabled>Nifty ▾</option>
            {NIFTY_PRESETS.map(p => (<option key={p.key} value={p.key}>{p.label} ({p.count})</option>))}
          </select>
          <select disabled={scanning} value="" data-tip="Scan stocks from 30 NSE sectoral indices (IT, Bank, Pharma, Auto, etc.)" data-tip-color="amber"
            onChange={e => { const p = SECTOR_PRESETS.find(p => p.key === e.target.value); if (p) { setScanSource(p.label); runScan([...p.symbols]); } }}
            className="h-7 px-2 bg-amber-950 hover:bg-amber-900 disabled:opacity-40 border border-amber-600 rounded text-[11px] font-semibold text-amber-200 cursor-pointer focus:outline-none focus:border-amber-400 shadow-sm"
            style={{colorScheme:'dark'}}>
            <option value="" disabled>Sector ▾</option>
            {SECTOR_PRESETS.map(p => (<option key={p.key} value={p.key}>{p.label} ({p.count})</option>))}
          </select>
          <select disabled={scanning} value="" data-tip="Scan thematic & strategy indices (MNC, PSE, Growth, Value, Momentum, etc.)" data-tip-color="purple"
            onChange={e => { const p = THEMATIC_PRESETS.find(p => p.key === e.target.value); if (p) { setScanSource(p.label); runScan([...p.symbols]); } }}
            className="h-7 px-2 bg-purple-950 hover:bg-purple-900 disabled:opacity-40 border border-purple-600 rounded text-[11px] font-semibold text-purple-200 cursor-pointer focus:outline-none focus:border-purple-400 shadow-sm"
            style={{colorScheme:'dark'}}>
            <option value="" disabled>Thematic ▾</option>
            <optgroup label="── My Portfolio ──">
              {THEMATIC_PRESETS.filter(p => p.category === 'portfolio').map(p => (<option key={p.key} value={p.key}>{p.label} ({p.count})</option>))}
            </optgroup>
            <optgroup label="── Thematic ──">
              {THEMATIC_PRESETS.filter(p => p.category === 'thematic').map(p => (<option key={p.key} value={p.key}>{p.label} ({p.count})</option>))}
            </optgroup>
            <optgroup label="── Strategy ──">
              {THEMATIC_PRESETS.filter(p => p.category === 'strategy').map(p => (<option key={p.key} value={p.key}>{p.label} ({p.count})</option>))}
            </optgroup>
          </select>
          <button disabled={scanning} data-tip="Paste stock symbols directly — one per line or comma-separated" data-tip-color="cyan" onClick={() => setShowPasteBox(p => !p)}
            className={`h-7 px-2.5 border rounded text-[11px] font-medium transition-colors disabled:opacity-40 ${showPasteBox ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'}`}>
            Paste</button>
        </div>

        <div className="w-px h-5 bg-slate-700 shrink-0" />

        {/* Group 3: Export */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={exportCSV} disabled={filteredResults.length === 0} data-tip="Export filtered results as CSV spreadsheet" data-tip-color="blue"
            className="h-7 px-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 rounded text-[11px] font-medium text-slate-400 transition-colors">CSV</button>
          <button onClick={exportXLSX} disabled={filteredResults.length === 0} data-tip="Export filtered results as Excel workbook" data-tip-color="blue"
            className="h-7 px-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 rounded text-[11px] font-medium text-slate-400 transition-colors">XLSX</button>
          {filteredResults.some(r => r.priceEngine.tradeValid) && (
            <button onClick={() => {
              const csv = exportZerodhaBasket(filteredResults, accountSize);
              const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
              a.download = 'zerodha_basket.csv'; a.click(); URL.revokeObjectURL(a.href);
            }} data-tip="Export as Zerodha basket order — auto-detects NSE/BSE exchange" data-tip-color="green" className="h-7 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-[11px] font-medium text-slate-400 transition-colors">Zerodha</button>
          )}
        </div>

        <div className="w-px h-5 bg-slate-700 shrink-0" />

        {/* Group 4: Quick filters */}
        <div className="flex items-center gap-1 shrink-0">
          {results.length > 0 && (() => {
            const qfColors: Record<string, string> = { all: 'blue', ready: 'green', tomorrow: 'yellow', strongest: 'orange', safe: 'cyan', momAlert: 'orange', eliteSignal: 'yellow' };
            return QUICK_FILTERS.map(qf => (
              <button key={qf.key} onClick={() => setQuickFilter(quickFilter === qf.key ? 'all' : qf.key)}
                data-tip={qf.description} data-tip-color={qfColors[qf.key] ?? 'blue'}
                className={`h-7 px-2 rounded text-[11px] font-medium border transition-colors ${quickFilter === qf.key ? 'bg-indigo-900/50 border-indigo-500 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>
                {qf.emoji} {qf.label}</button>
            ));
          })()}
          {nearBreakoutCount > 0 && (
            <button onClick={() => setColFilters(prev => ({ ...prev, nearBrk: prev.nearBrk ? '' : '<5' }))}
              data-tip="IMMINENT (0-1%), NEAR (1-2.5%), WATCH (2.5-5%) proximity tiers — excludes EARLY (5-10%, only 8% 5-day rate). Click to filter." data-tip-color="yellow"
              className={`h-7 px-2 rounded text-[11px] font-medium border transition-colors ${colFilters.nearBrk ? 'bg-yellow-900/50 border-yellow-600 text-yellow-300' : 'bg-slate-800 border-yellow-700 text-yellow-500 hover:text-yellow-300'}`}>
              ⚡ {nearBreakoutCount} BRK</button>
          )}
          {aPlusCount > 0 && (
            <button onClick={() => setColFilters(prev => ({ ...prev, brkTier: prev.brkTier === 'A+' ? '' : 'A+' }))}
              data-tip="A+ tier: within 10% of 52W high + EMA20>EMA50 + RSI14>50 + CMF20>0 + volume contraction. Highest conviction VCP geometry. Click to filter." data-tip-color="green"
              className={`h-7 px-2 rounded text-[11px] font-medium border transition-colors ${colFilters.brkTier === 'A+' ? 'bg-emerald-900/50 border-emerald-500 text-emerald-300' : 'bg-slate-800 border-emerald-800 text-emerald-600 hover:text-emerald-400'}`}>
              ★ {aPlusCount} A+</button>
          )}
          {hasColFilters && (
            <button onClick={() => setColFilters({})}
              className="h-7 px-2 bg-amber-900/50 hover:bg-amber-900 border border-amber-700 rounded text-[11px] font-medium text-amber-300 transition-colors">× Clr</button>
          )}
        </div>

        <div className="w-px h-5 bg-slate-700 shrink-0" />

        {/* Group 5: Panels & tools */}
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setShowTracker(v => !v)} data-tip="Win rate tracker — shows open positions, P&L, and trading statistics" data-tip-color="green"
            className={`h-7 px-2 rounded text-[11px] font-medium border transition-colors ${showTracker ? 'bg-emerald-900/50 border-emerald-600 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>
            📊 {trackedTrades.length > 0 ? `${winStats.winRate.toFixed(0)}% (${winStats.hitT1 + winStats.hitT2 + winStats.hitT3}W/${winStats.stopped}L · ${trackedTrades.filter(t => t.status === 'open').length} open)` : 'WR'}</button>
          <button onClick={() => setShowSessions(v => !v)} data-tip="Saved scan sessions — compare, export, import historical scans" data-tip-color="blue"
            className={`h-7 px-2 rounded text-[11px] font-medium border transition-colors ${showSessions ? 'bg-blue-900/50 border-blue-600 text-blue-300' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>
            💾 {sessions.length || '—'}</button>
          <button onClick={() => setShowWatchlist(v => !v)} data-tip="Watchlist — stocks you're monitoring for future entries" data-tip-color="amber"
            className={`h-7 px-2 rounded text-[11px] font-medium border transition-colors ${showWatchlist ? 'bg-amber-900/50 border-amber-600 text-amber-300' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>
            ⭐ {watchlist.length || '—'}</button>
          {results.length > 0 && (
            <button onClick={() => setShowHeatMap(v => !v)} data-tip="Sector heatmap — signal density by sector" data-tip-color="purple"
              className={`h-7 px-2 rounded text-[11px] font-medium border transition-colors ${showHeatMap ? 'bg-purple-900/50 border-purple-600 text-purple-300' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>
              ▦</button>
          )}
          {results.length > 0 && (
            <button onClick={() => {
              const md = generateJournalMarkdown(results, scanStats, trackedTrades, marketRegime?.label ?? 'Unknown');
              const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], {type:'text/markdown'}));
              a.download = `trade_journal_${new Date().toISOString().slice(0,10)}.md`; a.click(); URL.revokeObjectURL(a.href);
            }} data-tip="Export trade journal as Markdown file" data-tip-color="purple" className="h-7 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-[11px] font-medium text-slate-500 hover:text-slate-300 transition-colors">
              📝</button>
          )}
          <button onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} data-tip={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} data-tip-color="yellow"
            className="h-7 w-7 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-[11px] font-medium text-slate-500 hover:text-slate-300 transition-colors flex items-center justify-center">
            {theme === 'dark' ? '☀' : '🌙'}</button>
          <button data-tip="Keyboard: ↑↓ navigate rows · T track trade · W add to watchlist · Esc close sidebar" data-tip-color="blue"
            className="h-7 w-7 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-[11px] font-medium text-slate-500 hover:text-slate-300 transition-colors flex items-center justify-center">?</button>
          <button onClick={() => setShowTgSettings(v => !v)}
            data-tip="Telegram alerts — get notified on new signals, target hits, stops" data-tip-color="blue"
            className={`h-7 w-7 rounded text-[11px] font-medium border transition-colors flex items-center justify-center ${tgConfig.enabled ? 'bg-blue-900/50 border-blue-500 text-blue-300' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>
            ✈</button>
        </div>
        {/* Feature #6: Failed symbols */}
        {failedSymbols.length > 0 && (
          <button onClick={() => setShowFailedPanel(v => !v)}
            className="px-2.5 py-1 bg-red-900/40 border border-red-700 rounded text-xs font-medium text-red-400 hover:text-red-300 transition-colors">
            {failedSymbols.length} failed ({failedSymbols.slice(0, 3).map(f => f.sym.replace('.NS', '').replace('.BO', '')).join(', ')}{failedSymbols.length > 3 ? '...' : ''})</button>
        )}
        {skippedDeadCount > 0 && (
          <span className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-500"
            title={`${skippedDeadCount} delisted symbols auto-skipped. Clear the blacklist via Settings to re-scan them.`}>
            {skippedDeadCount} delisted skipped</span>
        )}
        {scanning && (
          <button onClick={() => { abortRef.current = true; setScanning(false); scanningRef.current = false; }}
            className="px-3 py-1.5 bg-red-900 hover:bg-red-800 border border-red-700 rounded text-xs font-medium text-red-200 transition-colors">Stop</button>
        )}
      </div>

      {/* ── Paste box ── */}
      {showPasteBox && (
        <div className="flex-shrink-0 border-b border-slate-800 bg-[#0d1117] px-4 py-3 flex gap-2 items-start">
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
            placeholder="Paste symbols separated by commas, newlines, or semicolons (e.g. RELIANCE.NS, TCS.NS)..."
            className="flex-1 h-20 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 focus:outline-none focus:border-indigo-500 resize-none font-mono placeholder:text-slate-600" />
          <div className="flex flex-col gap-2">
            <button onClick={() => { if (pasteSymbols.length > 0) { setShowPasteBox(false); setPasteText(''); runScan(pasteSymbols); } }}
              disabled={pasteSymbols.length === 0}
              className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 rounded text-xs font-medium text-white transition-colors">
              Scan ({pasteSymbols.length})</button>
            <button onClick={() => { setShowPasteBox(false); setPasteText(''); }}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs font-medium text-slate-300 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {/* ── AUTO-TRACK TOAST ── */}
      {autoTrackCount > 0 && (
        <div className="flex-shrink-0 border-b border-emerald-700 bg-emerald-950/70 px-4 py-2 flex items-center gap-2">
          <span className="text-emerald-400 font-bold text-sm">📌 Auto-tracked {autoTrackCount} new signal{autoTrackCount > 1 ? 's' : ''}</span>
          <span className="text-emerald-600 text-xs">→ open in Tracker to review</span>
        </div>
      )}

      {/* ── FAIL-SAFE STOP ALERT BANNER ── */}
      {stopAlerts.length > 0 && (
        <div className="flex-shrink-0 border-b-2 border-red-500 bg-red-950/80 px-4 py-3 animate-pulse">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">🚨</span>
            <span className="text-red-300 font-bold text-sm uppercase tracking-wider">STOP LOSS TRIGGERED — EXIT REQUIRED</span>
          </div>
          {stopAlerts.map((a, i) => (
            <div key={i} className="bg-red-900/50 border border-red-700 rounded-lg px-4 py-3 mb-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-red-200 font-bold text-lg font-mono">{a.symbol.replace('.NS','').replace('.BO','')}</span>
                <span className="text-red-400 text-xs font-mono">{a.timestamp}</span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-xs mb-3">
                <div><span className="text-red-400">Entry:</span> <span className="text-red-200 font-mono font-bold">Rs.{a.entryPrice.toFixed(2)}</span></div>
                <div><span className="text-red-400">Stop Price:</span> <span className="text-red-200 font-mono font-bold">Rs.{a.stopPrice.toFixed(2)}</span></div>
                <div><span className="text-red-400">Loss:</span> <span className="text-red-200 font-mono font-bold">-{((a.entryPrice - a.stopPrice) / a.entryPrice * 100).toFixed(1)}%</span></div>
              </div>
              <div className="bg-red-900/70 rounded px-3 py-2 text-xs text-red-200 space-y-1">
                <div className="font-bold text-red-300">ACTION REQUIRED:</div>
                <div>1. EXIT at market open tomorrow morning</div>
                <div>2. Place SELL order for ALL shares of {a.symbol.replace('.NS','').replace('.BO','')}</div>
                <div>3. Do NOT hold hoping for recovery — all 10 gates (G0-G9 + Chandelier trail) confirmed genuine breakdown</div>
              </div>
            </div>
          ))}
          <button onClick={() => setStopAlerts([])} className="text-red-500 text-xs hover:text-red-300 mt-1">
            Dismiss alerts ×
          </button>
        </div>
      )}

      {/* ── Win Rate Tracker (Professional) ── */}
      {showTracker && (
        <div className="flex-shrink-0 border-b border-slate-800 bg-[#0d1117] px-4 py-2 max-h-72 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">Performance Analytics</span>
            <button onClick={() => setShowTracker(false)} className="text-slate-500 text-xs hover:text-slate-300">close ×</button>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-10 gap-2 mb-3">
            {[
              { label: 'Win Rate', value: `${winStats.winRate.toFixed(0)}%`, color: winStats.winRate >= 55 ? 'text-emerald-400' : winStats.winRate >= 40 ? 'text-amber-400' : 'text-red-400' },
              { label: 'Wins', value: String(winStats.hitT1 + winStats.hitT2 + winStats.hitT3), color: 'text-emerald-400' },
              { label: 'Losses', value: String(winStats.stopped), color: 'text-red-400' },
              { label: 'Open', value: String(winStats.open), color: 'text-amber-400' },
              { label: 'Profit Factor', value: winStats.profitFactor > 0 ? winStats.profitFactor.toFixed(1) : '—', color: winStats.profitFactor >= 1.5 ? 'text-emerald-400' : 'text-slate-400' },
              { label: 'Expectancy', value: winStats.expectancy !== 0 ? `${winStats.expectancy > 0 ? '+' : ''}${winStats.expectancy.toFixed(2)}%` : '—', color: winStats.expectancy > 0 ? 'text-emerald-400' : 'text-red-400' },
              { label: 'Avg Win', value: winStats.avgWinPct !== 0 ? `+${winStats.avgWinPct.toFixed(1)}%` : '—', color: 'text-emerald-400' },
              { label: 'Avg Loss', value: winStats.avgLossPct !== 0 ? `${winStats.avgLossPct.toFixed(1)}%` : '—', color: 'text-red-400' },
              { label: 'Avg Days', value: winStats.avgDaysHeld > 0 ? `${winStats.avgDaysHeld}d` : '—', color: 'text-slate-300' },
              { label: 'Streak', value: winStats.streakWins > 0 ? `🔥${winStats.streakWins}W` : winStats.streakLosses > 0 ? `❄${winStats.streakLosses}L` : '—', color: winStats.streakWins > 0 ? 'text-green-400' : 'text-red-400' },
            ].map(kpi => (
              <div key={kpi.label} className="bg-slate-800/50 rounded px-2 py-1.5 text-center">
                <div className="text-xs text-slate-600 leading-none mb-0.5">{kpi.label}</div>
                <div className={`text-sm font-bold leading-none ${kpi.color}`}>{kpi.value}</div>
              </div>
            ))}
          </div>

          {/* Trade Log Table */}
          {trackedTrades.length > 0 ? (
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-700 text-slate-500">
                <th className="px-2 py-1 text-left font-medium">Symbol</th>
                <th className="px-2 py-1 text-center font-medium">Status</th>
                <th className="px-2 py-1 text-right font-medium">Entry</th>
                <th className="px-2 py-1 text-right font-medium">SL</th>
                <th className="px-2 py-1 text-right font-medium">T1</th>
                <th className="px-2 py-1 text-right font-medium">T2</th>
                <th className="px-2 py-1 text-right font-medium">T3R</th>
                <th className="px-2 py-1 text-right font-medium">Exit ₹</th>
                <th className="px-2 py-1 text-right font-medium">P&L</th>
                <th className="px-2 py-1 text-right font-medium">R-Mult</th>
                <th className="px-2 py-1 text-left font-medium">Entry Date</th>
                <th className="px-2 py-1 text-left font-medium">Hit Date</th>
                <th className="px-2 py-1 text-right font-medium">To T1</th>
                <th className="px-2 py-1 text-right font-medium">Days</th>
                <th className="px-2 py-1 text-left font-medium">Sector</th>
                <th className="px-2 py-1 text-center font-medium">Seq</th>
                <th className="px-2 py-1 text-center font-medium"></th>
              </tr></thead>
              <tbody>
                {[...trackedTrades].sort((a, b) => {
                  if (a.status !== 'open' && b.status === 'open') return -1;
                  if (a.status === 'open' && b.status !== 'open') return 1;
                  if (a.status !== 'open' && b.status !== 'open') return (b.closedDate ?? '').localeCompare(a.closedDate ?? '');
                  return 0;
                }).map((t, i, arr) => {
                  // validSL: SL must be positive AND below entry (guards against inverted SL corruption)
                  const validSL = t.stopLoss > 0 && t.stopLoss < t.entryPrice;
                  const rps = validSL ? (t.entryPrice - t.stopLoss) : 0;
                  const riskPct = validSL && t.entryPrice > 0 ? (rps / t.entryPrice * 100) : 0;
                  // Reference price: for open trades use CMP, for closed use the actual exit price
                  const refPrice = t.status === 'open' ? (t.currentPrice ?? null) : (t.closedPrice ?? null);
                  // P&L: partial exits (hit_t1/hit_t2) use the validator's weighted pnlPct
                  // (50%@T1 + 50%@live, or 50%@T1+30%@T2+20%@live) stored after validation.
                  // All other statuses: recompute simply from the reference price.
                  const displayPnl = (() => {
                    if (!t.entryPrice) return null;
                    if ((t.status === 'hit_t1' || t.status === 'hit_t2') && t.pnlPct != null) {
                      return t.pnlPct; // weighted P&L from validator
                    }
                    return refPrice ? (refPrice - t.entryPrice) / t.entryPrice * 100 : null;
                  })();
                  const displayR = refPrice && t.entryPrice > 0 && validSL
                    ? ((refPrice - t.entryPrice) / rps)
                    : null;
                  const unrealPnl = displayPnl; // alias used below for the '*' live indicator
                  const toT1Pct = t.status === 'open' && t.currentPrice && t.target1 > 0 ? ((t.target1 - t.currentPrice) / t.currentPrice * 100) : null;
                  // Sequence: W/L markers for closed trades (use computed displayPnl, not stored pnlPct)
                  const seqMark = t.status !== 'open' ? ((displayPnl ?? 0) >= 0 ? 'W' : 'L') : '·';
                  return (
                  <tr key={i} className={`border-b border-slate-800/30 hover:bg-slate-800/20 ${t.status !== 'open' ? '' : 'opacity-80'}`}>
                    <td className="px-2 py-1 font-mono text-slate-200">{t.symbol.replace('.NS','').replace('.BO','')}</td>
                    <td className="px-2 py-1 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${t.status === 'open' ? 'bg-amber-900/30 text-amber-400' : (displayPnl ?? 0) > 0 ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>
                        {t.status === 'open' ? 'OPEN' : t.status === 'hit_t1' ? 'T1' : t.status === 'hit_t2' ? 'T2' : t.status === 'hit_t3' ? 'T3' : t.status === 'stopped' ? 'STOP' : t.status === 'expired' ? 'EXP' : t.status === 'closed_early' ? 'EXIT' : 'CLOSE'}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right text-slate-300 font-mono">₹{t.entryPrice.toFixed(0)}</td>
                    <td className={`px-2 py-1 text-right font-mono ${!validSL ? 'text-orange-500' : riskPct <= 2 ? 'text-emerald-500' : riskPct <= 3 ? 'text-amber-500' : 'text-red-500'}`} title={!validSL ? (t.stopLoss >= t.entryPrice ? '⚠ SL above entry — set a valid stop-loss' : '⚠ No stop-loss set') : `Risk: ${riskPct.toFixed(1)}%`}>{validSL ? `₹${t.stopLoss.toFixed(0)}` : '⚠ —'}</td>
                    <td className={`px-2 py-1 text-right font-mono ${t.status === 'hit_t1' ? 'text-emerald-400 font-bold' : 'text-emerald-700'}`}>{t.target1 > 0 ? `₹${t.target1.toFixed(2)}` : '—'}</td>
                    <td className={`px-2 py-1 text-right font-mono ${t.status === 'hit_t2' ? 'text-emerald-400 font-bold' : 'text-emerald-800'}`}>{t.target2 > 0 ? `₹${t.target2.toFixed(0)}` : '—'}</td>
                    <td className={`px-2 py-1 text-right font-mono ${t.status === 'hit_t3' ? 'text-yellow-300 font-bold' : 'text-yellow-900'}`}>{t.target3 > 0 ? `₹${t.target3.toFixed(0)}` : '—'}</td>
                    <td className={`px-2 py-1 text-right font-mono font-semibold ${t.closedPrice ? ((t.pnlPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400') : t.currentPrice ? 'text-slate-300' : 'text-slate-600'}`}
                      title={!t.closedPrice && t.currentPrice && t.cmpDate ? `Data as of ${t.cmpDate}${t.cmpDate < (t.entryDate ?? '') ? ' ⚠ STALE — before entry date' : ''}` : undefined}>
                      {t.closedPrice ? `₹${t.closedPrice.toFixed(2)}` : t.currentPrice ? (
                        <span>
                          ₹{t.currentPrice.toFixed(0)}
                          {t.cmpDate && (
                            <span className={`block text-[9px] font-normal leading-none mt-0.5 ${t.cmpDate < (t.entryDate ?? '') ? 'text-orange-400 font-bold' : 'text-slate-500'}`}>
                              {t.cmpDate < (t.entryDate ?? '') ? '⚠ ' : ''}{t.cmpDate?.slice(5)}
                            </span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td className={`px-2 py-1 text-right font-mono font-semibold ${displayPnl !== null && displayPnl !== undefined ? (displayPnl >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-600'}`}>
                      {displayPnl !== null && displayPnl !== undefined ? `${displayPnl >= 0 ? '+' : ''}${displayPnl.toFixed(1)}%` : '—'}
                      {t.status === 'open' && unrealPnl !== null ? ' *' : ''}
                    </td>
                    <td className={`px-2 py-1 text-right font-mono ${displayR !== null && displayR !== undefined ? (displayR >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-600'}`}>
                      {displayR !== null && displayR !== undefined ? `${displayR >= 0 ? '+' : ''}${displayR.toFixed(1)}R` : '—'}
                    </td>
                    <td className="px-2 py-1 text-slate-500">{t.entryDate}</td>
                    <td className={`px-2 py-1 ${t.closedDate ? 'text-emerald-400' : 'text-slate-700'}`}>{t.closedDate || '—'}</td>
                    <td className={`px-2 py-1 text-right font-mono ${toT1Pct !== null ? (toT1Pct <= 2 ? 'text-yellow-300 font-semibold' : 'text-slate-500') : 'text-slate-700'}`}>
                      {toT1Pct !== null ? `${toT1Pct.toFixed(1)}%` : t.status !== 'open' ? '✓' : '—'}
                    </td>
                    <td className="px-2 py-1 text-right text-slate-500">{t.daysHeld ?? '—'}</td>
                    <td className="px-2 py-1 text-slate-600">{t.sector || '—'}</td>
                    <td className={`px-2 py-1 text-center text-[10px] font-bold ${seqMark === 'W' ? 'text-emerald-400' : seqMark === 'L' ? 'text-red-400' : 'text-slate-700'}`}>{seqMark}</td>
                    <td className="px-2 py-1 text-center">
                      <button onClick={() => { if (t.status === 'open') deleteTradeFromCloud(t.symbol); setTrackedTrades(prev => t.status === 'open' ? prev.filter(x => !(x.symbol === t.symbol && x.status === 'open')) : prev.filter(x => x !== t)); }}
                        className="text-slate-700 hover:text-red-400">×</button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="text-xs text-slate-600 py-3 text-center">No tracked trades yet. Click "📌 Track Trade" on any BUY signal.</div>
          )}
        </div>
      )}

      {/* ── Sessions Panel ── */}
      {showSessions && (
        <div className="flex-shrink-0 border-b border-slate-800 bg-[#0d1117] px-4 py-2 max-h-64 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-blue-400 font-semibold uppercase tracking-wider">Saved Sessions ({sessions.length}/20)</span>
            <div className="flex gap-2">
              <button onClick={() => {
                const json = exportSessions();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
                a.download = `qtp_sessions_${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
              }} className="text-xs text-slate-500 hover:text-blue-300">Export</button>
              <button onClick={() => sessionImportRef.current?.click()} className="text-xs text-slate-500 hover:text-blue-300">Import</button>
              <input ref={sessionImportRef} type="file" accept=".json" className="hidden" onChange={e => {
                const file = e.target.files?.[0]; if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => { const count = importSessions(ev.target?.result as string); setSessions(loadSessions()); alert(`Imported ${count} sessions`); };
                reader.readAsText(file); e.target.value = '';
              }} />
              {sessions.length > 0 && <button onClick={() => { if (confirm('Delete all sessions?')) { deleteAllSessions(); setSessions([]); } }} className="text-xs text-red-500 hover:text-red-300">Clear All</button>}
              <button onClick={() => setShowSessions(false)} className="text-xs text-slate-500 hover:text-slate-300">close ×</button>
            </div>
          </div>
          {sessions.length === 0 ? (
            <div className="text-xs text-slate-600 py-2">No saved sessions. Sessions auto-save after each scan.</div>
          ) : (
            <div className="space-y-1">
              {sessions.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 text-xs bg-slate-800/40 rounded px-2 py-1.5 hover:bg-slate-800/70 transition-colors">
                  <span className="text-slate-400 w-28 shrink-0">{formatSessionTime(s.timestamp)}</span>
                  {editingSessionId === s.id ? (
                    <input autoFocus defaultValue={s.label} className="w-24 px-1 bg-slate-700 border border-blue-600 rounded text-xs text-slate-200 focus:outline-none"
                      onBlur={e => { renameSession(s.id, e.target.value); setSessions(loadSessions()); setEditingSessionId(null); }}
                      onKeyDown={e => { if (e.key === 'Enter') { renameSession(s.id, (e.target as HTMLInputElement).value); setSessions(loadSessions()); setEditingSessionId(null); } }} />
                  ) : (
                    <span className="text-blue-300 w-24 truncate cursor-pointer hover:text-blue-200 shrink-0" onClick={() => setEditingSessionId(s.id)}
                      title="Click to rename">{s.label || s.source}</span>
                  )}
                  <span className="text-slate-500">{s.totalScanned} stocks</span>
                  <span className="text-emerald-500 font-semibold">{s.actionableCount} BUY</span>
                  <span className="text-slate-600">{s.paramSet === 'ALL4' ? '6-Set' : s.paramSet === 'ors_prime_reversal' ? 'ORS↩' : s.paramSet.replace('optimized_', '').slice(0, 8)}</span>
                  {/* Compare with previous session */}
                  {i < sessions.length - 1 && (
                    <button onClick={() => { setSessionDiff(compareSessions(sessions[i + 1], s)); }}
                      className="text-slate-600 hover:text-cyan-400 transition-colors" title="Compare with previous">⇄</button>
                  )}
                  <div className="ml-auto flex gap-1.5">
                    <button onClick={() => {
                      // Restore session results — rebuild minimal AnalysisResult from compact
                      const restored: AnalysisResult[] = s.results.map((c: any) => {
                        const rps = (c.rps ?? (c.en - c.sl)) || 0;
                        return {
                        symbol: c.sym, stage: c.stg, inflectionScore: c.infl, confidence: c.conf, paramSetKey: c.pk,
                        lastClose: c.cls, lastDate: c.dt, avgTurnover20: 0, atrPct14: 0, atrPct14Pctl120: 0,
                        volRatio20: 0, rsi2: 50, rsi14: 50, zone: null,
                        pre10AvgRangeATR: 0, pre10ExpansionCount: 0, pre10AvgVolRatio: 0, pre5AvgVolRatio: 0,
                        pre10HighVolCount: 0, pre10RedVolBias: 0, exactRangeATR14: 0, exactVolRatio20: 0,
                        exactVolVsPre5: 0, closeLoc: 0, upperWickPct: 0, bodyPct: 0,
                        signalRangePct: 0, volatilityExpansionRatio: 0, ultraPrecisionScore: 0, candleQualityScore: 0,
                        priceEngine: {
                          breakoutLevel: 0, plannedEntry: c.en, gapPct: c.gapP ?? 0, gapATR: 0,
                          entryMode: 'breakout' as const, entryStatus: 'normal' as const, entryBuffer: 0, efficiencyRatio: 0,
                          tacticalStop: c.sl, tacticalRiskPct: c.rk,
                          stopWeinstein: c.sl2 ?? 0, stopKase: c.sl2 ?? 0, stopElder: 0, stopSignalLow: 0,
                          disasterStop: c.ds ?? 0, disasterRiskPct: c.dr ?? 0, riskPerShare: rps,
                          target5: c.t1, target7: c.t2 ?? 0, target10: c.t3 ?? 0, target3R: 0,
                          t1R: rps > 0 ? (c.t1 - c.en) / rps : 0, t2R: rps > 0 && c.t2 ? (c.t2 - c.en) / rps : 0, t3R_mult: 0,
                          rewardRisk: c.rr, chandelierT1: 0, chandelierT2: 0, chandelierT3: 0,
                          failedBreakoutLevel: 0, timeStop3d: 0, timeStop5d: 0, timeStop10d: 0,
                          maxHoldBars: 20, tradeValid: c.tv,
                          hh252: 0, pctFrom52W: 0, breakoutTier: ((c as any).bt ?? 'B') as 'A+' | 'A' | 'B',
                          sw5LowAtEntry: 0, atr14AtEntry: 0,
                        },
                        conditionsMet: 0, totalConditions: 20, checklist: [],
                        momentum: { emaAligned: false, ema20: 0, ema50: 0, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: 0, obvSlope10: 0, adx14: 20, adxInRange: true, gapAdjustedRR: 0, momentumScore: c.ms, rsNifty20: 1.0 },
                        nearBreakoutPct: c.nbp ?? (c.nb ? 1 : 99), nearBreakout: c.nb, nearBreakoutTier: null,
                        stats: {
                          volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false,
                          lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false,
                          skewness20: 0, positiveSkew: false, drawdownFrom52WH: 0, pctFrom52WL: 0, sharpe20: 0, entropy10: 0,
                          cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1.0,
                          ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false,
                          rsi14: 50, cci34: 0, ema10: 0, ema21: 0, ema55: 0, sma200: 0,
                          ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false,
                          guppySpreadPct: c.gp ?? 99, guppyCompressed: (c.gp ?? 99) < 1, guppyUltraCompressed: (c.gp ?? 99) < 0.5,
                          guppyCompressDays: 0, guppyCleanBullishFan: false, guppyGroupGapPct: 0, guppyCoiledRelease: false,
                          candlePattern: c.cp ?? '—', candlePatternFull: c.cpf ?? 'Unknown',
                          candlePatternType: (c.cpt ?? 'neutral') as 'bullish' | 'bearish' | 'neutral',
                          candlePatternStrength: c.cps ?? 0, statsScore: c.ss,
                        },
                        clusterBreakdown: { deployable: { met: c.cd?.d ?? 0, total: c.cd?.dt ?? 21 }, highPrecision: { met: c.cd?.h ?? 0, total: c.cd?.ht ?? 19 }, elite: { met: c.cd?.e ?? 0, total: c.cd?.et ?? 21 }, ultraSelective: { met: c.cd?.u ?? 0, total: c.cd?.ut ?? 20 } },
                        monster: { badges: [], topProbability: 0 },
                        dayChangePct: c.dcp ?? 0,
                        candleDNA: { score: 0, bodyStrength: 0, wickCleanliness: 0, rangeExpansion: 0, bodyATR: 0, upperToLowerWickRatio: 0, marubozuScore: 0, tier: 'WEAK' },
                      };});
                      setResults(restored); setShowSessions(false);
                    }} className="px-1.5 py-0.5 bg-blue-900/40 hover:bg-blue-900/60 border border-blue-700 rounded text-blue-300 text-xs">Restore</button>
                    <button onClick={() => { deleteSession(s.id); setSessions(loadSessions()); }}
                      className="px-1.5 py-0.5 bg-red-900/30 hover:bg-red-900/50 border border-red-800 rounded text-red-400 text-xs">×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Session Diff */}
          {sessionDiff && (
            <div className="mt-2 pt-2 border-t border-slate-700 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="text-cyan-400 font-semibold">Session Comparison</span>
                <button onClick={() => setSessionDiff(null)} className="text-slate-600 hover:text-slate-300">×</button>
              </div>
              <div className="flex gap-4 flex-wrap">
                {sessionDiff.newSignals.length > 0 && <span className="text-emerald-400">🆕 New BUY: {sessionDiff.newSignals.join(', ')}</span>}
                {sessionDiff.droppedSignals.length > 0 && <span className="text-red-400">❌ Dropped: {sessionDiff.droppedSignals.join(', ')}</span>}
                {sessionDiff.upgraded.length > 0 && <span className="text-cyan-400">⬆ Upgraded: {sessionDiff.upgraded.map(u => `${u.sym}`).join(', ')}</span>}
                {sessionDiff.downgraded.length > 0 && <span className="text-amber-400">⬇ Downgraded: {sessionDiff.downgraded.map(d => `${d.sym}`).join(', ')}</span>}
                {sessionDiff.newSignals.length === 0 && sessionDiff.upgraded.length === 0 && sessionDiff.droppedSignals.length === 0 && sessionDiff.downgraded.length === 0 && <span className="text-slate-500">No changes between sessions</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Watchlist (#2) ── */}
      {showWatchlist && (
        <div className="flex-shrink-0 border-b border-slate-800 bg-[#0d1117] px-4 py-2 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-amber-400 font-semibold uppercase tracking-wider">Watchlist ({watchlist.length})</span>
            <button onClick={() => setShowWatchlist(false)} className="text-slate-500 text-xs hover:text-slate-300">close ×</button>
          </div>
          {watchlist.length === 0 ? (
            <div className="text-xs text-slate-600 py-1">Click ⭐ on a stock in the detail panel to add to watchlist</div>
          ) : (
            <div className="space-y-1">
              {watchlist.map((w, i) => (
                <div key={i} className="flex items-center gap-2 text-xs bg-slate-800/40 rounded px-2 py-1">
                  <span className="font-mono text-slate-200 w-28 truncate cursor-pointer hover:text-indigo-400" onClick={() => setSelectedSymbol(w.symbol)}>{w.symbol}</span>
                  <span className="text-slate-500">₹{w.lastClose.toFixed(0)}</span>
                  <span className={`${STAGE_CONFIG[w.stage]?.color ?? 'text-slate-500'}`}>{STAGE_CONFIG[w.stage]?.label ?? w.stage}</span>
                  {(() => {
                    const isTracked = trackedTrades.some(t => t.symbol === w.symbol);
                    const matchedResult = results.find(r => r.symbol === w.symbol);
                    return isTracked ? (
                      <span className="text-emerald-400 text-[10px] px-1.5 py-0.5 bg-emerald-900/30 rounded">✓ Tracked</span>
                    ) : matchedResult ? (
                      <button onClick={() => trackTrade(matchedResult)}
                        className="text-[10px] px-1.5 py-0.5 bg-emerald-900/40 hover:bg-emerald-900/60 border border-emerald-700 rounded text-emerald-300 transition-colors">📌 Track</button>
                    ) : (
                      <span className="text-[10px] text-slate-600 px-1.5" title="Run a scan that includes this stock to enable tracking">scan first</span>
                    );
                  })()}
                  <input value={w.note} onChange={e => {
                    const updated = [...watchlist]; updated[i] = { ...w, note: e.target.value }; setWatchlist(updated); saveWatchlist(updated);
                  }} placeholder="Add note..." className="flex-1 bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-slate-300 focus:outline-none focus:border-amber-600 min-w-0" />
                  <button onClick={() => { const updated = watchlist.filter((_, j) => j !== i); setWatchlist(updated); saveWatchlist(updated); }}
                    className="text-slate-700 hover:text-red-400">×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Sector Heat Map (Feature #2) ── */}
      {showHeatMap && Object.keys(sectorHeatData).length > 0 && (
        <div className="flex-shrink-0 border-b border-slate-800 bg-[#0d1117] px-4 py-2 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-purple-400 font-semibold uppercase tracking-wider">Sector Signal Density</span>
            <button onClick={() => setShowHeatMap(false)} className="text-slate-500 text-xs hover:text-slate-300">close ×</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
            {Object.entries(sectorHeatData).sort((a, b) => {
              const actionableA = (a[1]['BUY'] ?? 0) + (a[1]['STRONG_BUY'] ?? 0) + (a[1]['ULTRA_STRONG_BUY'] ?? 0) + (a[1]['PRE_BREAKOUT'] ?? 0);
              const actionableB = (b[1]['BUY'] ?? 0) + (b[1]['STRONG_BUY'] ?? 0) + (b[1]['ULTRA_STRONG_BUY'] ?? 0) + (b[1]['PRE_BREAKOUT'] ?? 0);
              return actionableB - actionableA;
            }).map(([sector, counts]) => {
              const buy = (counts['BUY'] ?? 0) + (counts['STRONG_BUY'] ?? 0) + (counts['ULTRA_STRONG_BUY'] ?? 0);
              const pre = counts['PRE_BREAKOUT'] ?? 0;
              const total = Object.values(counts).reduce((s, v) => s + v, 0);
              const intensity = buy > 2 ? 'bg-emerald-900/40 border-emerald-700' : buy > 0 ? 'bg-emerald-900/20 border-emerald-800' : pre > 2 ? 'bg-blue-900/20 border-blue-800' : 'bg-slate-800/40 border-slate-700';
              return (
                <div key={sector} className={`rounded border px-2 py-1.5 ${intensity}`}>
                  <div className="text-xs text-slate-300 font-medium truncate">{sector}</div>
                  <div className="flex gap-2 mt-0.5 text-xs">
                    {buy > 0 && <span className="text-emerald-400">{buy} BUY</span>}
                    {pre > 0 && <span className="text-blue-300">{pre} PRE</span>}
                    <span className="text-slate-600 ml-auto">{total}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Telegram Settings Panel ── */}
      {showTgSettings && (
        <div className="flex-shrink-0 border-b border-blue-800/50 bg-[#0d1117] px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-blue-400 font-semibold uppercase tracking-wider">✈ Telegram Alerts</span>
            <div className="flex items-center gap-2">
              <button onClick={async () => {
                setTgTestStatus('sending');
                const ok = await sendTelegramMessage(tgConfig, '✅ <b>Dr KKR Quant Terminal Pro</b> — Telegram connected successfully!');
                setTgTestStatus(ok ? 'ok' : 'fail');
                setTimeout(() => setTgTestStatus(''), 3000);
              }} disabled={!tgConfig.botToken || !tgConfig.chatId}
                className="px-2 py-0.5 bg-blue-900/50 hover:bg-blue-900 border border-blue-700 rounded text-xs text-blue-300 disabled:opacity-40 transition-colors">
                {tgTestStatus === 'sending' ? '...' : tgTestStatus === 'ok' ? '✓ Sent!' : tgTestStatus === 'fail' ? '✗ Failed' : 'Test'}</button>
              <button onClick={() => setShowTgSettings(false)} className="text-slate-500 text-xs hover:text-slate-300">close ×</button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Bot Token (from @BotFather)</label>
              <input value={tgConfig.botToken} onChange={e => { const c = { ...tgConfig, botToken: e.target.value }; setTgConfig(c); saveTelegramConfig(c); }}
                placeholder="7123456789:AAHx..." className="w-full h-7 px-2 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Chat ID (your Telegram user ID)</label>
              <input value={tgConfig.chatId} onChange={e => { const c = { ...tgConfig, chatId: e.target.value }; setTgConfig(c); saveTelegramConfig(c); }}
                placeholder="123456789" className="w-full h-7 px-2 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 focus:outline-none focus:border-blue-500 font-mono" />
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={tgConfig.enabled} onChange={e => { const c = { ...tgConfig, enabled: e.target.checked }; setTgConfig(c); saveTelegramConfig(c); }}
                className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500 w-3.5 h-3.5" />
              <span className={tgConfig.enabled ? 'text-blue-300 font-semibold' : 'text-slate-400'}>Enabled</span>
            </label>
            <div className="flex gap-3 text-[10px]">
              {([
                ['newSignal', '🟢 New Signal'],
                ['momAlert', '🚀 MOM Alert'],
                ['eliteSignal', '⭐ Elite Signal'],
                ['targetHit', '✅ Target Hit'],
                ['stopped', '🔴 Stopped'],
                ['regimeChange', '⚠ Regime'],
                ['dailySummary', '📊 Summary'],
                ['signalDecay', '⏳ Decay'],
                ['validationSummary', '📋 Validation'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={tgConfig.alerts[key]} onChange={e => {
                    const c = { ...tgConfig, alerts: { ...tgConfig.alerts, [key]: e.target.checked } };
                    setTgConfig(c); saveTelegramConfig(c);
                  }} className="rounded border-slate-600 bg-slate-800 text-blue-500 w-3 h-3" />
                  <span className={tgConfig.alerts[key] ? 'text-slate-300' : 'text-slate-600'}>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Risk Sizer (Feature #7) ── */}
      {showRiskSizer && (
        <div className="flex-shrink-0 border-b border-slate-800 bg-[#0d1117] px-4 py-2">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs text-emerald-400 font-semibold uppercase tracking-wider">Position Sizer</span>
            <div className="flex items-center gap-1 text-xs">
              <span className="text-slate-500">Account ₹:</span>
              <input type="number" value={accountSize} onChange={e => setAccountSize(Number(e.target.value) || 0)}
                className="w-24 px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 focus:outline-none focus:border-emerald-500" />
            </div>
            <span className="text-xs text-slate-600">Max risk per trade: 1%</span>
            <button onClick={() => setShowRiskSizer(false)} className="ml-auto text-slate-500 text-xs hover:text-slate-300">close ×</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-32 overflow-y-auto">
            {filteredResults.filter(r => r.priceEngine.tradeValid).map(r => {
              const riskPerShare = r.priceEngine.plannedEntry - r.priceEngine.tacticalStop;
              const maxRisk = accountSize * 0.01;
              const shares = riskPerShare > 0 ? Math.floor(maxRisk / riskPerShare) : 0;
              const position = shares * r.priceEngine.plannedEntry;
              return (
                <div key={r.symbol} className="bg-slate-800/60 rounded px-2 py-1.5 text-xs flex items-center gap-2">
                  <span className="text-slate-200 font-mono font-medium w-24 truncate">{r.symbol}</span>
                  <span className="text-emerald-400">{shares} shares</span>
                  <span className="text-slate-500">₹{(position/100000).toFixed(1)}L</span>
                  <span className="text-red-400 ml-auto">risk ₹{maxRisk > riskPerShare * shares ? (riskPerShare * shares).toFixed(0) : maxRisk.toFixed(0)}</span>
                </div>
              );
            })}
            {filteredResults.filter(r => r.priceEngine.tradeValid).length === 0 && (
              <div className="text-xs text-slate-600 col-span-full">No valid trades to size</div>
            )}
          </div>
        </div>
      )}

      {/* ── Failed symbols panel (Feature #6) ── */}
      {showFailedPanel && failedSymbols.length > 0 && (
        <div className="flex-shrink-0 border-b border-slate-800 bg-red-950/20 px-4 py-2 max-h-32 overflow-y-auto">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-red-400 font-semibold">{failedSymbols.length} symbols failed to fetch:</span>
            <button onClick={() => setShowFailedPanel(false)} className="text-red-500 text-xs hover:text-red-300">close ×</button>
          </div>
          <div className="space-y-0.5">
            {failedSymbols.map((f, i) => {
              const cleanSym = f.sym.replace(/\.(NS|BO)$/i, '');
              const isNoData = /no data|delisted|suspended|too few candles/i.test(f.err);
              const label = isNoData ? 'Delisted / no data on Yahoo Finance' : f.err;
              return (
                <div key={i} className="text-xs flex gap-2">
                  <span className="text-red-400 font-mono shrink-0">{cleanSym}</span>
                  <span className={isNoData ? 'text-slate-500 truncate' : 'text-red-600 truncate'}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Progress ── */}
      {scanning && (
        <div className="flex-shrink-0 border-b border-slate-800 bg-[#0d1117] px-4 py-2">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span>Scanning {progress} / {total} stocks…{progress > 3 && (() => {
              const elapsed = (Date.now() - scanStartTime) / 1000;
              const perStock = elapsed / progress;
              const remaining = Math.round(perStock * (total - progress));
              return remaining > 5 ? ` ~${remaining < 60 ? `${remaining}s` : `${Math.round(remaining / 60)}m ${remaining % 60}s`} left` : '';
            })()}</span>
            {errCount > 0 && <span className="text-amber-400 truncate ml-4">{errCount} errors · {lastErr}</span>}
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full transition-all duration-200"
              style={{ width: total > 0 ? `${(progress / total) * 100}%` : '0%' }} />
          </div>
        </div>
      )}

      {/* ── Stage filters + exports (unified single bar) ── */}
      {results.length > 0 && (
        <div className="flex-shrink-0 border-b border-slate-800 bg-[#0d1117] px-4 py-1.5 flex items-center gap-1.5 overflow-x-auto">
          {/* All filter + export */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={() => setStageFilter('ALL')}
              className={`px-2 py-0.5 rounded-l text-[11px] font-medium border transition-colors ${stageFilter === 'ALL' ? 'bg-slate-700 border-slate-500 text-white' : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}>
              All ({stageCounts['ALL'] ?? 0})</button>
            <button onClick={() => exportGroupCSV(results, COLUMNS, `QTP_all.csv`)} className="px-1 py-0.5 border border-slate-700 text-[10px] text-slate-500 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors">CSV</button>
            <button onClick={() => exportGroupXLSX(results, COLUMNS, `QTP_all.xlsx`)} className="px-1 py-0.5 border border-slate-700 text-[10px] text-slate-500 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors">XLSX</button>
            <button onClick={() => exportGroupPDF(results, COLUMNS, `All Results`, `QTP_all.pdf`)} className="px-1 py-0.5 border border-slate-700 rounded-r text-[10px] text-slate-500 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors">PDF</button>
          </div>

          <div className="w-px h-5 bg-slate-700 shrink-0" />

          {/* Per-stage: filter chip + export buttons grouped together */}
          {ALL_STAGES.map(stage => {
            const count = stageCounts[stage] ?? 0;
            if (count === 0) return null;
            const cfg = STAGE_CONFIG[stage];
            const active = stageFilter === stage;
            const stageRows = results.filter(r => r.stage === stage);
            const shortName = stage.replace(/_/g, '-').toLowerCase();
            return (
              <div key={stage} className="flex items-center gap-0.5 shrink-0">
                <button onClick={(e) => {
                    if (e.shiftKey) { setStageFilter('ALL'); setMultiStageFilter(prev => { const next = new Set(prev); if (next.has(stage)) next.delete(stage); else next.add(stage); return next; }); }
                    else { setStageFilter(stage); setMultiStageFilter(new Set()); }
                  }}
                  style={{ borderColor: active ? cfg.textColor : undefined, color: cfg.textColor, backgroundColor: active ? cfg.bgColor : undefined }}
                  className={`px-2 py-0.5 rounded-l text-[11px] font-semibold border transition-colors ${active ? '' : 'border-slate-700 hover:border-slate-500'}`}>
                  {cfg.label} ({count})</button>
                <button onClick={() => exportGroupCSV(stageRows, COLUMNS, `QTP_${shortName}.csv`)} className="px-1 py-0.5 border border-slate-700 text-[10px] text-slate-500 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors">CSV</button>
                <button onClick={() => exportGroupXLSX(stageRows, COLUMNS, `QTP_${shortName}.xlsx`)} className="px-1 py-0.5 border border-slate-700 text-[10px] text-slate-500 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors">XLSX</button>
                <button onClick={() => exportGroupPDF(stageRows, COLUMNS, `${cfg.label}`, `QTP_${shortName}.pdf`)} className="px-1 py-0.5 border border-slate-700 rounded-r text-[10px] text-slate-500 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors">PDF</button>
              </div>
            );
          })}

          {/* Scan stats inline */}
          {scanStats.actionable > 0 && (
            <div className="flex items-center gap-2 ml-auto text-[10px] text-slate-500 shrink-0">
              {scanStats.bestRR && <span>R:R <b className="text-emerald-400">{scanStats.bestRR.symbol}</b> {scanStats.bestRR.rr.toFixed(1)}</span>}
              {scanStats.highestConviction && <span>Conv <b className="text-yellow-300">{scanStats.highestConviction.symbol}</b> {scanStats.highestConviction.conv}</span>}
              {filteredResults.length !== results.length && <span>{filteredResults.length}/{results.length}</span>}
            </div>
          )}
        </div>
      )}

      {/* ── Tab Bar ── */}
      <div className="flex-shrink-0 bg-[#0a0d14] border-b border-slate-700/60">
        {/* Tab row */}
        <div className="px-3 pt-2 pb-2 flex items-center gap-1.5 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent" style={{scrollbarWidth:'thin'}}>
          {([
            ['scanner',      '📊', 'Scanner',      '#818cf8', 'Main screening table — 60+ sortable columns with 6 sub-views', 'indigo'],
            ['performance',  '📈', 'Performance',  '#34d399', 'Equity curve, monthly reports, and win rate dashboard', 'green'],
            ['tradedesk',    '🎯', 'Trade Desk',   '#f97316', 'Position sizing, open/closed trades, watchlist management', 'orange'],
            ['tradelog',     '📋', 'Trade Log',    '#38bdf8', 'Daily price excursion log per trade — events, MFE, MAE, stop & target triggers', 'blue'],
            ['journal',      '📝', 'Journal',      '#a78bfa', 'Post-trade reviews and lessons learned tracker', 'purple'],
            ['focus',        '⚡', 'Focus',        '#facc15', 'Top 5 signals — zero-clutter, one-click decision view', 'yellow'],
            ['validation',   '🔬', 'Validation',   '#22d3ee', 'Auto-validated trades with MFE/MAE, scatter plots, edge analysis', 'cyan'],
            ['intelligence', '🧠', 'Brain v2',     '#f472b6', 'Signal Command ranked by expected P&L · Setup Quality Matrix · Stock DNA · RS · Sector Rotation', 'pink'],
            ['pbfb',         '📉', 'PBFB',         '#e879f9', 'Post Breakout Forensic Backtest — was the stock on my radar before it exploded?', 'pink'],
            ['pro',          '🏆', 'Pro',          '#fbbf24', 'Backtester, signal narrative, portfolio optimizer', 'yellow'],
          ] as const).map(([key, emoji, label, color, tip, tipColor]) => (
            <button key={key} onClick={() => setActiveTab(key as typeof activeTab)}
              data-tip={tip} data-tip-color={tipColor}
              style={activeTab === key
                ? { borderColor: color, color, backgroundColor: `${color}18`, boxShadow: `0 0 10px ${color}40, inset 0 1px 0 ${color}30` }
                : {}}
              className={`flex-shrink-0 h-7 px-3 rounded border text-[11px] font-semibold transition-all duration-150 whitespace-nowrap select-none ${
                activeTab === key
                  ? 'border-current'
                  : 'border-slate-600/70 text-slate-400 hover:text-slate-200 hover:border-slate-500 hover:bg-slate-700/40'
              }`}>
              {emoji} {label}
            </button>
          ))}
        </div>
        {/* Scan favorites row (only when scanner active and favorites exist) */}
        {activeTab === 'scanner' && (favorites.length > 0 || lastScanSymbols.length > 0) && (
          <div className="px-4 pb-1 flex items-center gap-1">
            {favorites.map(f => (
              <button key={f.id} onClick={() => { setScanSource(f.source); runScan([...f.symbols]); }}
                className="px-2 py-0.5 bg-indigo-900/30 hover:bg-indigo-900/50 border border-indigo-700 rounded text-xs text-indigo-300 transition-colors"
                title={`${f.symbols.length} stocks · ${f.paramSet}`}>▶ {f.name}</button>
            ))}
            {lastScanSymbols.length > 0 && (
              <button onClick={() => {
                const name = prompt('Name this scan favorite:', scanSource);
                if (name) {
                  const fav: ScanFavorite = { id: Date.now().toString(36), name, source: scanSource, symbols: lastScanSymbols, paramSet: scanAll ? 'ALL4' : paramSetKey };
                  const updated = [...favorites, fav]; setFavorites(updated); saveFavorites(updated);
                }
              }}
                className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs text-slate-500 hover:text-slate-300 transition-colors">
                + Save Favorite</button>
            )}
          </div>
        )}
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Performance Tab ── */}
        {activeTab === 'performance' && (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">📈 Performance Dashboard</h2>

            {/* Equity Curve */}
            {trackedTrades.length > 0 ? (() => {
              const curve = buildEquityCurve(trackedTrades);
              const reports = generateMonthlyReports(trackedTrades);
              if (curve.length < 2) return <div className="text-xs text-slate-600">Need at least 2 closed trades to show equity curve</div>;
              const maxEq = Math.max(...curve.map(p => p.equity));
              const minEq = Math.min(...curve.map(p => p.equity));
              const range = maxEq - minEq || 1;
              return (
                <>
                  <div className="bg-slate-800/40 rounded-lg p-3">
                    <div className="text-xs text-slate-500 font-semibold mb-2">Equity Curve ({curve.length - 1} trades)</div>
                    <svg viewBox={`0 0 600 120`} className="w-full h-28">
                      <rect width="600" height="120" fill="#0d1117" rx="4" />
                      {/* Grid */}
                      <line x1="0" y1="60" x2="600" y2="60" stroke="#1e293b" strokeWidth="0.5" />
                      {/* Curve */}
                      <polyline fill="none" stroke="#34d399" strokeWidth="2" points={
                        curve.map((p, i) => `${(i / (curve.length - 1)) * 580 + 10},${110 - ((p.equity - minEq) / range) * 100}`).join(' ')
                      } />
                      {/* Starting capital line */}
                      <line x1="0" y1={110 - ((curve[0].equity - minEq) / range) * 100} x2="600" y2={110 - ((curve[0].equity - minEq) / range) * 100} stroke="#64748b" strokeWidth="0.5" strokeDasharray="4,4" />
                      <text x="590" y="15" textAnchor="end" fill="#34d399" fontSize="10">₹{(curve[curve.length - 1].equity / 100000).toFixed(1)}L</text>
                      <text x="10" y="15" fill="#64748b" fontSize="10">Start: ₹{(curve[0].equity / 100000).toFixed(1)}L</text>
                    </svg>
                  </div>

                  {/* Monthly Reports */}
                  {reports.length > 0 && (
                    <div className="bg-slate-800/40 rounded-lg p-3">
                      <div className="text-xs text-slate-500 font-semibold mb-2">Monthly Report Card</div>
                      <div className="space-y-1">
                        {reports.map(r => (
                          <div key={r.month} className="flex items-center gap-3 text-xs bg-slate-900/40 rounded px-2 py-1.5">
                            <span className="text-slate-300 font-medium w-16">{r.month}</span>
                            <span className="text-slate-400">{r.trades} trades</span>
                            <span className={r.winRate >= 60 ? 'text-emerald-400 font-semibold' : r.winRate >= 45 ? 'text-slate-300' : 'text-red-400'}>{r.winRate.toFixed(0)}% WR</span>
                            <span className={r.grossPnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}>{r.grossPnlPct >= 0 ? '+' : ''}{r.grossPnlPct.toFixed(1)}%</span>
                            {r.bestTrade && <span className="text-slate-500">Best: {r.bestTrade.symbol} +{r.bestTrade.pnl.toFixed(1)}%</span>}
                            {r.maxDrawdown > 0 && <span className="text-red-500 ml-auto">DD: -{r.maxDrawdown.toFixed(1)}%</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })() : (
              <div className="text-sm text-slate-600 py-8 text-center">
                <div className="text-3xl mb-2">📈</div>
                Track trades to see your equity curve and monthly performance.
                <br />Click "📌 Track Trade" on any BUY signal to start.
              </div>
            )}
          </div>
        )}

        {/* ── Trade Desk Tab ── */}
        {activeTab === 'tradedesk' && (
          <div className="flex-1 overflow-auto p-4 space-y-4">

            {/* Quick Entry Calculator — proper table */}
            <div className="bg-slate-800/30 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-slate-800/50 flex items-center justify-between">
                <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Quick Entry Calculator</span>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500">Account:</span>
                  <input type="number" value={accountSize} onChange={e => setAccountSize(Number(e.target.value) || 0)}
                    className="w-24 px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 focus:outline-none focus:border-indigo-500 text-right" />
                  {marketRegime && <span className={marketRegime.regime.includes('bull') ? 'text-green-400' : marketRegime.regime.includes('bear') ? 'text-red-400' : 'text-yellow-400'}>{marketRegime.emoji} ×{marketRegime.sizingMultiplier}</span>}
                </div>
              </div>
              {filteredResults.filter(r => r.priceEngine.tradeValid).length > 0 ? (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-500">
                      <th className="px-3 py-1.5 text-left font-medium">Symbol</th>
                      <th className="px-2 py-1.5 text-left font-medium">Stage</th>
                      <th className="px-2 py-1.5 text-right font-medium">Entry ₹</th>
                      <th className="px-2 py-1.5 text-right font-medium">Stop ₹</th>
                      <th className="px-2 py-1.5 text-right font-medium">Risk/Sh</th>
                      <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                      <th className="px-2 py-1.5 text-right font-medium">Capital ₹</th>
                      <th className="px-2 py-1.5 text-right font-medium">Max Risk ₹</th>
                      <th className="px-2 py-1.5 text-right font-medium">T1 ₹</th>
                      <th className="px-2 py-1.5 text-right font-medium">R:R</th>
                      <th className="px-2 py-1.5 text-left font-medium">Verdict</th>
                      <th className="px-2 py-1.5 text-center font-medium">Conv</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.filter(r => r.priceEngine.tradeValid).map(r => {
                      const risk = r.priceEngine.plannedEntry - r.priceEngine.tacticalStop;
                      const regimeMult = marketRegime?.sizingMultiplier ?? 1;
                      const qty = risk > 0 ? Math.floor((accountSize * regimeMult * 0.01) / risk) : 0;
                      const capital = qty * r.priceEngine.plannedEntry;
                      const maxRisk = qty * risk;
                      return (
                        <tr key={r.symbol} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                          <td className="px-3 py-1.5 font-mono text-slate-200 font-medium cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => setSelectedSymbol(r.symbol)} title="Click to open details">{r.symbol.replace('.NS','').replace('.BO','')}</td>
                          <td className={`px-2 py-1.5 font-semibold ${STAGE_CONFIG[r.stage].color}`}>{STAGE_CONFIG[r.stage].label}</td>
                          <td className="px-2 py-1.5 text-right text-slate-200 font-mono">₹{r.priceEngine.plannedEntry.toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right text-red-400 font-mono">₹{r.priceEngine.tacticalStop.toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right text-amber-400 font-mono">₹{risk.toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right text-emerald-400 font-mono font-bold">{qty}</td>
                          <td className="px-2 py-1.5 text-right text-slate-300 font-mono">₹{(capital / 1000).toFixed(0)}K</td>
                          <td className="px-2 py-1.5 text-right text-red-400 font-mono">₹{maxRisk.toFixed(0)}</td>
                          <td className="px-2 py-1.5 text-right text-emerald-300 font-mono">₹{r.priceEngine.target5.toFixed(2)}</td>
                          <td className={`px-2 py-1.5 text-right font-mono font-semibold ${rrVerdictColor(r.priceEngine.rewardRisk)}`}>{r.priceEngine.rewardRisk.toFixed(2)}</td>
                          <td className={`px-2 py-1.5 text-left text-xs font-semibold ${rrVerdictColor(r.priceEngine.rewardRisk)}`}>{rrVerdict(r.priceEngine.rewardRisk)}</td>
                          <td className={`px-2 py-1.5 text-center font-semibold ${computeConviction(r) >= 60 ? 'text-yellow-300' : 'text-slate-400'}`}>{computeConviction(r)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="text-xs text-slate-600 py-6 text-center">No valid trades. Run a scan first.</div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Trade Rules Checklist */}
              <div className="bg-slate-800/30 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-800/50">
                  <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Pre-Trade Checklist</span>
                </div>
                <div className="p-3 space-y-2">
                  {DEFAULT_RULES.map(rule => {
                    const checked = rulesChecked.has(rule.id);
                    return (
                      <label key={rule.id} className="flex items-center gap-2.5 text-xs cursor-pointer py-0.5">
                        <input type="checkbox" checked={checked} onChange={() => {
                          setRulesChecked(prev => { const next = new Set(prev); if (next.has(rule.id)) next.delete(rule.id); else next.add(rule.id); return next; });
                        }} className="rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-0 w-3.5 h-3.5" />
                        <span className={checked ? 'text-emerald-400' : 'text-slate-400'}>{rule.label}</span>
                      </label>
                    );
                  })}
                  <div className="pt-2 border-t border-slate-700">
                    {rulesChecked.size === DEFAULT_RULES.length ? (
                      <span className="text-emerald-400 font-semibold text-xs">✓ All rules passed — clear to trade</span>
                    ) : (
                      <span className="text-amber-400 text-xs">{rulesChecked.size}/{DEFAULT_RULES.length} checked</span>
                    )}
                    {rulesChecked.size > 0 && <button onClick={() => setRulesChecked(new Set())} className="ml-3 text-slate-600 hover:text-slate-400 text-xs">Reset</button>}
                  </div>
                </div>
              </div>

              {/* Open Positions */}
              <div className="bg-slate-800/30 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-slate-800/50">
                  <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Open Positions ({trackedTrades.filter(t => t.status === 'open').length})</span>
                  {trackedTrades.length > 0 && (
                    <button onClick={() => { if (confirm('Remove ALL tracked trades? This cannot be undone.')) { deleteAllTradesFromCloud(); setTrackedTrades([]); } }}
                      className="text-xs text-red-600 hover:text-red-400 ml-auto transition-colors">Clear All</button>
                  )}
                </div>
                {trackedTrades.filter(t => t.status === 'open').length > 0 ? (
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-slate-700 text-slate-500">
                      <th className="px-3 py-1 text-left font-medium">Symbol</th>
                      <th className="px-2 py-1 text-right font-medium">Entry</th>
                      <th className="px-2 py-1 text-right font-medium">SL</th>
                      <th className="px-2 py-1 text-right font-medium">T1</th>
                      <th className="px-2 py-1 text-left font-medium">Date</th>
                      <th className="px-2 py-1 text-left font-medium">Sector</th>
                      <th className="px-2 py-1 text-right font-medium" title="Maximum Favorable Excursion %">MFE%</th>
                      <th className="px-2 py-1 text-right font-medium" title="MFE in R-multiples">MFE-R</th>
                      <th className="px-2 py-1 text-right font-medium" title="Maximum Adverse Excursion %">MAE%</th>
                      <th className="px-2 py-1 text-right font-medium" title="MAE in R-multiples">MAE-R</th>
                      <th className="px-2 py-1 text-right font-medium">Days</th>
                      <th className="px-2 py-1 text-right font-medium">CMP</th>
                      <th className="px-2 py-1 text-right font-medium">P&L%</th>
                      <th className="px-2 py-1 text-center font-medium">Status</th>
                      <th className="px-2 py-1 text-center font-medium">Gate</th>
                      <th className="px-1 py-1 text-center font-medium w-8"></th>
                    </tr></thead>
                    <tbody>
                      {trackedTrades.filter(t => t.status === 'open').map((t, i) => {
                        const riskPerShare = t.entryPrice - t.stopLoss;
                        const mfePct = t.highestPrice && t.entryPrice > 0 ? ((t.highestPrice - t.entryPrice) / t.entryPrice) * 100 : 0;
                        const mfeR = t.highestPrice && riskPerShare > 0 ? (t.highestPrice - t.entryPrice) / riskPerShare : 0;
                        const maePct = t.currentPrice && t.entryPrice > 0 ? Math.min(0, ((Math.min(t.currentPrice, t.entryPrice) - t.entryPrice) / t.entryPrice) * 100) : 0;
                        const maeR = riskPerShare > 0 ? maePct / 100 * t.entryPrice / riskPerShare : 0;
                        const curPnl = t.currentPrice && t.entryPrice > 0 ? ((t.currentPrice - t.entryPrice) / t.entryPrice) * 100 : 0;
                        const daysLeft = 20 - (t.daysHeld ?? 0);
                        const gLog = t.gateLog;
                        return (<Fragment key={t.symbol + '-' + i}>
                        <tr className="border-b border-slate-800/40 group">
                          <td className="px-3 py-1.5 font-mono text-slate-200 cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => setSelectedSymbol(t.symbol)} title="Click to open details">{t.symbol.replace('.NS','').replace('.BO','')}</td>
                          <td className="px-2 py-1.5 text-right text-slate-300 font-mono">₹{t.entryPrice.toFixed(0)}</td>
                          <td className="px-2 py-1.5 text-right font-mono" title={(() => {
                            const stopDist = t.entryPrice > 0 ? ((t.entryPrice - t.stopLoss) / t.entryPrice) * 100 : 0;
                            const avgMAE = Math.abs(brainInsights?.avgMAE ?? 0);
                            if (avgMAE > 0 && stopDist < avgMAE) return `⚠ Stop distance (${stopDist.toFixed(1)}%) < your avg MAE (${avgMAE.toFixed(1)}%) — stop is inside normal noise range`;
                            return `Stop distance: ${stopDist.toFixed(1)}%`;
                          })()}>
                            <span className={(() => {
                              const stopDist = t.entryPrice > 0 ? ((t.entryPrice - t.stopLoss) / t.entryPrice) * 100 : 0;
                              const avgMAE = Math.abs(brainInsights?.avgMAE ?? 0);
                              return avgMAE > 0 && stopDist < avgMAE ? 'text-amber-400' : 'text-red-400';
                            })()}>₹{t.stopLoss.toFixed(0)}</span>
                            {(() => {
                              const stopDist = t.entryPrice > 0 ? ((t.entryPrice - t.stopLoss) / t.entryPrice) * 100 : 0;
                              const avgMAE = Math.abs(brainInsights?.avgMAE ?? 0);
                              return avgMAE > 0 && stopDist < avgMAE ? <span className="text-[8px] text-amber-400 ml-0.5">⚠</span> : null;
                            })()}
                          </td>
                          <td className="px-2 py-1.5 text-right text-emerald-400 font-mono">₹{t.target1.toFixed(0)}</td>
                          <td className="px-2 py-1.5 text-slate-500">{t.entryDate}</td>
                          <td className="px-2 py-1.5 text-slate-600">{t.sector || '—'}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${mfePct > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>{mfePct > 0 ? `+${mfePct.toFixed(1)}%` : '—'}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${mfeR > 0 ? 'text-emerald-300' : 'text-slate-600'}`}>{mfeR > 0 ? `+${mfeR.toFixed(1)}R` : '—'}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${maePct < 0 ? 'text-red-400' : 'text-slate-600'}`}>{maePct < 0 ? `${maePct.toFixed(1)}%` : '—'}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${maeR < 0 ? 'text-red-300' : 'text-slate-600'}`}>{maeR < 0 ? `${maeR.toFixed(1)}R` : '—'}</td>
                          <td className={`px-2 py-1.5 text-right ${(t.daysHeld ?? 0) >= 16 ? 'text-amber-400' : 'text-slate-500'}`} title={daysLeft > 0 ? `Auto-expires in ${daysLeft} days` : 'Expiring soon!'}>{t.daysHeld ?? '—'}{(t.daysHeld ?? 0) >= 16 ? ' ⏳' : ''}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${t.currentPrice ? 'text-slate-300' : 'text-slate-600'}`}>{t.currentPrice ? `₹${t.currentPrice.toFixed(0)}` : '—'}</td>
                          <td className={`px-2 py-1.5 text-right font-mono font-semibold ${curPnl > 0 ? 'text-emerald-400' : curPnl < 0 ? 'text-red-400' : 'text-slate-500'}`}>{t.currentPrice ? `${curPnl >= 0 ? '+' : ''}${curPnl.toFixed(1)}%` : '—'}</td>
                          <td className="px-2 py-1.5 text-center"><span className="bg-blue-900/40 text-blue-300 text-[10px] px-1.5 py-0.5 rounded font-medium">OPEN</span></td>
                          <td className="px-2 py-1.5 text-center">
                            {(() => {
                              if (!gLog || gLog.length === 0) return <span className="text-[9px] text-slate-700">No tests</span>;
                              const shielded = gLog.filter(e => e.result === 'SHIELDED').length;
                              const lastEntry = gLog[gLog.length - 1];
                              const activeGate = lastEntry?.gatesTested?.find(g => !g.passed);
                              return <span className="text-[9px] font-mono" title={`${gLog.length} tests, ${shielded} shielded\nLast: ${activeGate?.gate || '—'}: ${activeGate?.reason || ''}`}>
                                <span className="text-emerald-400 font-bold">{shielded}🛡</span>
                                {activeGate && <span className="text-cyan-400 ml-0.5">{activeGate.gate.slice(0, 5)}</span>}
                              </span>;
                            })()}
                          </td>
                          <td className="px-1 py-1.5 text-center">
                            <button onClick={() => removeTrade(t)} className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-300 transition-all" title="Remove trade">✕</button>
                          </td>
                        </tr>
                        {gLog && gLog.length > 0 && (
                          <tr className="border-b border-slate-800/20">
                            <td colSpan={16} className="px-4 py-1 bg-slate-900/50">
                              <div className="text-[10px] text-slate-500 font-semibold">🔬 Gate Log (last 5 stop tests)</div>
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                                {gLog.slice(-5).map((entry, gi) => (
                                  <div key={gi} className="text-[9px] font-mono whitespace-nowrap">
                                    <span className={`font-bold ${entry.result === 'SHIELDED' ? 'text-emerald-400' : 'text-red-400'}`}>
                                      D{entry.day}{entry.result === 'SHIELDED' ? '🛡' : '🛑'}
                                    </span>
                                    {entry.gatesTested.slice(0, 3).map((g, gj) => (
                                      <span key={gj} className={`ml-0.5 ${!g.passed ? 'text-emerald-500' : 'text-red-500'}`} title={g.reason}>
                                        {!g.passed ? '✓' : '✗'}
                                      </span>
                                    ))}
                                    <span className="text-slate-600 ml-1">{entry.dipPct.toFixed(1)}%↓</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>);
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-xs text-slate-600 py-4 text-center">No open positions</div>
                )}
              </div>
            </div>

            {/* Closed / Auto-Validated Trades */}
            {trackedTrades.filter(t => t.status !== 'open').length > 0 && (
              <div className="bg-slate-800/40 rounded-lg p-3">
                <div className="flex items-center mb-2">
                  <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Closed Trades ({trackedTrades.filter(t => t.status !== 'open').length})</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="border-b border-slate-700 text-slate-500">
                      <th className="px-3 py-1 text-left font-medium">Symbol</th>
                      <th className="px-2 py-1 text-right font-medium">Entry</th>
                      <th className="px-2 py-1 text-right font-medium">Exit</th>
                      <th className="px-2 py-1 text-right font-medium">P&L%</th>
                      <th className="px-2 py-1 text-right font-medium">P&L R</th>
                      <th className="px-2 py-1 text-right font-medium">MFE%</th>
                      <th className="px-2 py-1 text-right font-medium">MFE-R</th>
                      <th className="px-2 py-1 text-right font-medium">MAE%</th>
                      <th className="px-2 py-1 text-right font-medium">MAE-R</th>
                      <th className="px-2 py-1 text-right font-medium">Days</th>
                      <th className="px-2 py-1 text-center font-medium">Outcome</th>
                      <th className="px-2 py-1 text-center font-medium cursor-help" title="10-Gate Cascade (Phase-3 calibrated, v6)&#10;Stop: max(1.5×ATR, 5-bar swing low×0.997) clamped [2.5%,6.5%]&#10;G-GAP: gap-down → instant exit at open&#10;G0: Wyckoff Spring — dip &lt;0.5×ATR deep + close above stop&#10;G1: RSI-2 &lt;25 Capitulation flush&#10;G2: 2-Day Confirm — first day low-vol OR narrow bar (&lt;0.7×ATR)&#10;G3: Hammer — lower wick ≥40%, close loc ≥55%&#10;G4: OBV 5d slope rising (accumulation)&#10;G5: Narrow Sweep — range &lt;0.75×ATR + close above stop&#10;G6: Low-Vol Sweep — vol &lt;0.65×avg + close above stop&#10;G7: Isolated Red — prev candle was green&#10;G8: Close Recovery — recovered &gt;60% of stop-to-low range&#10;G9: Structure OK — close ≥ 5-bar swing low × 0.997&#10;🛡 = shielded (false stop), 🛑 = all gates passed (real stop)">Gate Status</th>
                      <th className="px-1 py-1 text-center font-medium w-8"></th>
                    </tr></thead>
                    <tbody>
                      {trackedTrades.filter(t => t.status !== 'open').reverse().map((t, i) => {
                        const riskPerShare = t.entryPrice - t.stopLoss;
                        const mfePct = t.highestPrice && t.entryPrice > 0 ? ((t.highestPrice - t.entryPrice) / t.entryPrice) * 100 : 0;
                        const mfeR = t.highestPrice && riskPerShare > 0 ? (t.highestPrice - t.entryPrice) / riskPerShare : 0;
                        const maePct = t.pnlPct && t.pnlPct < 0 ? t.pnlPct : 0;
                        const maeR = riskPerShare > 0 && maePct < 0 ? (maePct / 100 * t.entryPrice) / riskPerShare : 0;
                        const statusCfg: Record<string, { label: string; color: string }> = {
                          hit_t1: { label: '✓ T1 Hit', color: 'bg-emerald-900/40 text-emerald-300' },
                          hit_t2: { label: '✓ T2 Hit', color: 'bg-emerald-900/40 text-emerald-200' },
                          hit_t3: { label: '✓ T3 Hit', color: 'bg-yellow-900/40 text-yellow-300' },
                          stopped: { label: '✗ Stopped', color: 'bg-red-900/40 text-red-300' },
                          expired: { label: '⏳ Expired', color: 'bg-amber-900/40 text-amber-300' },
                          manual_close: { label: '◉ Manual', color: 'bg-slate-700/40 text-slate-300' },
                          closed_early: { label: '↗ Early Exit', color: 'bg-cyan-900/40 text-cyan-300' },
                        };
                        const sc = statusCfg[t.status] ?? { label: t.status, color: 'bg-slate-700 text-slate-400' };
                        const cGLog = t.gateLog;
                        return (<Fragment key={t.symbol + '-c-' + i}>
                          <tr className="border-b border-slate-800/40 group">
                            <td className="px-3 py-1.5 font-mono text-slate-300 cursor-pointer hover:text-indigo-400 transition-colors" onClick={() => setSelectedSymbol(t.symbol)} title="Click to open details">{t.symbol.replace('.NS','').replace('.BO','')}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-slate-400">₹{t.entryPrice.toFixed(0)}</td>
                            <td className="px-2 py-1.5 text-right font-mono text-slate-400">{t.closedPrice ? `₹${t.closedPrice.toFixed(0)}` : '—'}</td>
                            <td className={`px-2 py-1.5 text-right font-mono font-semibold ${(t.pnlPct ?? 0) > 0 ? 'text-emerald-400' : (t.pnlPct ?? 0) < 0 ? 'text-red-400' : 'text-slate-500'}`}>{t.pnlPct != null ? `${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(1)}%` : '—'}</td>
                            <td className={`px-2 py-1.5 text-right font-mono ${(t.pnlR ?? 0) > 0 ? 'text-emerald-300' : (t.pnlR ?? 0) < 0 ? 'text-red-300' : 'text-slate-500'}`}>{t.pnlR != null ? `${t.pnlR >= 0 ? '+' : ''}${t.pnlR.toFixed(1)}R` : '—'}</td>
                            <td className={`px-2 py-1.5 text-right font-mono ${mfePct > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>{mfePct > 0 ? `+${mfePct.toFixed(1)}%` : '—'}</td>
                            <td className={`px-2 py-1.5 text-right font-mono ${mfeR > 0 ? 'text-emerald-300' : 'text-slate-600'}`}>{mfeR > 0 ? `+${mfeR.toFixed(1)}R` : '—'}</td>
                            <td className={`px-2 py-1.5 text-right font-mono ${maePct < 0 ? 'text-red-400' : 'text-slate-600'}`}>{maePct < 0 ? `${maePct.toFixed(1)}%` : '—'}</td>
                            <td className={`px-2 py-1.5 text-right font-mono ${maeR < 0 ? 'text-red-300' : 'text-slate-600'}`}>{maeR < 0 ? `${maeR.toFixed(1)}R` : '—'}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{t.daysHeld ?? '—'}</td>
                            <td className="px-2 py-1.5 text-center"><span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sc.color}`}>{sc.label}</span></td>
                            <td className="px-2 py-1.5 text-center">
                              {(() => {
                                if (!cGLog || cGLog.length === 0) return <span className="text-slate-700 text-[9px]">—</span>;
                                const shielded = cGLog.filter(e => e.result === 'SHIELDED').length;
                                const stopped = cGLog.filter(e => e.result === 'STOPPED').length;
                                const lastEntry = cGLog[cGLog.length - 1];
                                const lastGate = lastEntry?.gatesTested?.[lastEntry.gatesTested.length - 1];
                                if (stopped > 0) {
                                  return <span className="text-[9px] font-mono" title={`${cGLog.length} tests: ${shielded} shielded, ${stopped} stopped\nLast gate: ${lastGate?.gate || '—'}\n${lastGate?.reason || ''}`}>
                                    <span className="text-red-400 font-bold">🛑 ALL PASS</span>
                                    {shielded > 0 && <span className="text-emerald-500 ml-0.5">({shielded}🛡)</span>}
                                  </span>;
                                }
                                const activeGate = lastEntry?.gatesTested?.find(g => !g.passed);
                                return <span className="text-[9px] font-mono" title={`${cGLog.length} tests: ${shielded} shielded\nBlocked by: ${activeGate?.gate || '—'}\n${activeGate?.reason || ''}`}>
                                  <span className="text-emerald-400 font-bold">🛡 {activeGate?.gate?.slice(0, 9) || 'SHIELDED'}</span>
                                </span>;
                              })()}
                            </td>
                            <td className="px-1 py-1.5 text-center">
                              <button onClick={() => removeTrade(t)} className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-300 transition-all" title="Remove trade">✕</button>
                            </td>
                          </tr>
                          {cGLog && cGLog.length > 0 && (
                            <tr className="border-b border-slate-800/20">
                              <td colSpan={13} className="px-4 py-1 bg-slate-900/50">
                                <div className="text-[10px] text-slate-500 font-semibold">🔬 Gate Log ({cGLog.length} stop test{cGLog.length > 1 ? 's' : ''} — {cGLog.filter(e => e.result === 'SHIELDED').length} shielded, {cGLog.filter(e => e.result === 'STOPPED').length} stopped)</div>
                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                                  {cGLog.map((entry, gi) => (
                                    <div key={gi} className="text-[9px] font-mono whitespace-nowrap" title={entry.gatesTested.map(g => `${g.passed ? '✗' : '✓'} ${g.gate}: ${g.reason}`).join('\n')}>
                                      <span className={`font-bold ${entry.result === 'SHIELDED' ? 'text-emerald-400' : 'text-red-400'}`}>
                                        D{entry.day}{entry.result === 'SHIELDED' ? '🛡' : '🛑'}
                                      </span>
                                      {entry.gatesTested.slice(0, 3).map((g, gj) => (
                                        <span key={gj} className={`ml-0.5 ${!g.passed ? 'text-emerald-500' : 'text-red-500'}`}>
                                          {!g.passed ? '✓' : '✗'}
                                        </span>
                                      ))}
                                      <span className="text-slate-600 ml-1">{entry.dipPct.toFixed(1)}%↓</span>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>);
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Desktop Notifications */}
            <div className="bg-slate-800/40 rounded-lg p-3">
              <div className="text-xs text-slate-500 font-semibold mb-2">Desktop Notifications</div>
              <button onClick={() => {
                if ('Notification' in window) {
                  Notification.requestPermission().then(p => { if (p === 'granted') new Notification('QTP Notifications Enabled', { body: 'You will be alerted on new BUY signals' }); });
                }
              }} className="px-3 py-1.5 bg-indigo-900/40 hover:bg-indigo-900/60 border border-indigo-700 rounded text-xs text-indigo-300 transition-colors">
                Enable Push Notifications</button>
              <span className="text-xs text-slate-600 ml-2">Alerts on new BUY signals during auto-refresh</span>
            </div>
          </div>
        )}

        {/* ── Journal Tab ── */}
        {activeTab === 'journal' && (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">📝 Trade Journal</h2>

            {/* Add Review */}
            <div className="bg-slate-800/40 rounded-lg p-3">
              <div className="text-xs text-slate-500 font-semibold mb-2">Post-Trade Review</div>
              {trackedTrades.filter(t => t.status !== 'open').slice(-5).reverse().map((t, i) => {
                const existing = reviews.find(r => r.symbol === t.symbol && r.date === t.closedDate);
                return (
                  <div key={i} className="flex items-start gap-2 text-xs bg-slate-900/40 rounded px-2 py-1.5 mb-1">
                    <span className="font-mono text-slate-200 w-24 shrink-0">{t.symbol}</span>
                    <span className={t.pnlPct && t.pnlPct >= 0 ? 'text-emerald-400 w-14 shrink-0' : 'text-red-400 w-14 shrink-0'}>{t.pnlPct ? `${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(1)}%` : '—'}</span>
                    <span className="text-slate-500 w-20 shrink-0">{t.closedDate ?? ''}</span>
                    {existing ? (
                      <span className="text-slate-400 flex-1 truncate" title={existing.lessons}>{existing.lessons || existing.notes}</span>
                    ) : (
                      <button onClick={() => {
                        const notes = prompt(`What happened with ${t.symbol}? What did you learn?`);
                        if (notes) {
                          const review: TradeReview = { symbol: t.symbol, date: t.closedDate ?? '', outcome: t.status, pnlPct: t.pnlPct ?? 0, notes: '', lessons: notes };
                          const updated = [...reviews, review]; setReviews(updated); saveReviews(updated);
                        }
                      }} className="text-amber-500 hover:text-amber-300">+ Add review</button>
                    )}
                  </div>
                );
              })}
              {trackedTrades.filter(t => t.status !== 'open').length === 0 && (
                <div className="text-xs text-slate-600 py-2">No closed trades to review yet</div>
              )}
            </div>

            {/* Review History */}
            {reviews.length > 0 && (
              <div className="bg-slate-800/40 rounded-lg p-3">
                <div className="text-xs text-slate-500 font-semibold mb-2">Lessons Learned ({reviews.length})</div>
                <div className="space-y-1.5">
                  {reviews.slice().reverse().map((r, i) => (
                    <div key={i} className="text-xs bg-slate-900/40 rounded px-2 py-1.5">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-mono text-slate-300">{r.symbol}</span>
                        <span className={r.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}>{r.pnlPct >= 0 ? '+' : ''}{r.pnlPct.toFixed(1)}%</span>
                        <span className="text-slate-600">{r.date}</span>
                      </div>
                      <div className="text-slate-400 leading-relaxed">{r.lessons}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Trade Timeline */}
            <div className="bg-slate-800/40 rounded-lg p-3">
              <div className="text-xs text-slate-500 font-semibold mb-2">Trade History Timeline</div>
              <div className="space-y-1">
                {trackedTrades.slice().reverse().map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${t.status === 'open' ? 'bg-amber-400' : t.pnlPct && t.pnlPct > 0 ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span className="text-slate-500 w-20">{t.entryDate}</span>
                    <span className="font-mono text-slate-300 w-24 truncate">{t.symbol}</span>
                    <span className="text-slate-600">{t.status}</span>
                    {t.pnlPct !== undefined && <span className={t.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}>{t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(1)}%</span>}
                    {t.daysHeld !== undefined && <span className="text-slate-600">{t.daysHeld}d</span>}
                  </div>
                ))}
                {trackedTrades.length === 0 && <div className="text-xs text-slate-600 py-2">No trades tracked yet</div>}
              </div>
            </div>
          </div>
        )}

        {/* ── Intelligence Tab ── */}
        {activeTab === 'intelligence' && (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* ── SYSTEM HEALTH BAR ── */}
            {(() => {
              const ws = computeWinRateStats(trackedTrades);
              const sysExp = brainInsights?.expectancy;
              const brainConf = brainInsights?.confidence ?? 'INACTIVE';
              const confColor = brainConf === 'HIGH' ? '#4ade80' : brainConf === 'MEDIUM' ? '#facc15' : brainConf === 'LOW' ? '#fb923c' : '#475569';
              const totalClosed = trackedTrades.filter(t => t.status !== 'open').length;
              const needsMoreTrades = totalClosed < 5;
              return (
                <div className="bg-slate-800/60 rounded-lg p-3 border border-slate-700/50">
                  <div className="flex items-center gap-2 mb-2.5">
                    <h2 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">🧠 Brain v2 · Trading Intelligence</h2>
                    {brainPrior && (
                      <span className="text-[9px] text-slate-600 ml-auto">prior: {brainPrior.total} trades · updated {new Date(brainPrior.generatedAt).toLocaleDateString()}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {/* Card 1: Closed Trades */}
                    <div className="bg-slate-900/50 rounded p-2 text-center">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">Closed Trades</div>
                      <div className="text-xl font-bold font-mono text-slate-200">{totalClosed}</div>
                      {needsMoreTrades && <div className="text-[8px] text-amber-500 mt-0.5">Need {5 - totalClosed} more</div>}
                    </div>
                    {/* Card 2: Win Rate */}
                    <div className="bg-slate-900/50 rounded p-2 text-center">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">Win Rate</div>
                      <div className="text-xl font-bold font-mono" style={{color: ws.total >= 5 ? (ws.winRate >= 55 ? '#4ade80' : ws.winRate >= 40 ? '#facc15' : '#ef4444') : '#475569'}}>
                        {ws.total >= 5 ? `${ws.winRate}%` : '—'}
                      </div>
                      {ws.total >= 5 && <div className="text-[8px] text-slate-600">{ws.hitT1 + ws.hitT2 + ws.hitT3}W / {ws.stopped + ws.expired + ws.manualClose + ws.closedEarly}L</div>}
                    </div>
                    {/* Card 3: Expectancy */}
                    <div className="bg-slate-900/50 rounded p-2 text-center">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">Expectancy</div>
                      <div className="text-xl font-bold font-mono" style={{color: sysExp == null ? '#475569' : sysExp >= 1 ? '#4ade80' : sysExp >= 0 ? '#facc15' : '#ef4444'}}>
                        {sysExp != null ? `${sysExp >= 0 ? '+' : ''}${sysExp.toFixed(2)}%` : '—'}
                      </div>
                      {sysExp != null && <div className="text-[8px] text-slate-600">per trade</div>}
                    </div>
                    {/* Card 4: Brain Confidence */}
                    <div className="bg-slate-900/50 rounded p-2 text-center">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">Brain State</div>
                      <div className="text-sm font-bold font-mono mt-1" style={{color: confColor}}>{brainConf}</div>
                      <div className="text-[8px] text-slate-600 mt-0.5">{brainConf === 'HIGH' ? 'scores reliable' : brainConf === 'MEDIUM' ? 'moderate signal' : brainConf === 'LOW' ? 'near-baseline' : 'track trades'}</div>
                    </div>
                    {/* Card 5: FII Streak */}
                    <div className="bg-slate-900/50 rounded p-2 text-center">
                      <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-0.5">FII Sell Days</div>
                      <div className="flex items-center justify-center gap-1.5 mt-1">
                        <button onClick={() => { const v = Math.max(0, fiiSellStreak - 1); setFiiSellStreak(v); try { localStorage.setItem('qtp_fii_streak', String(v)); } catch {} }}
                          className="w-5 h-5 flex items-center justify-center rounded bg-slate-700/80 text-slate-400 hover:text-slate-200 text-[11px]">−</button>
                        <span className="text-xl font-bold font-mono w-6 text-center" style={{color: fiiSellStreak >= 5 ? '#ef4444' : fiiSellStreak >= 3 ? '#fb923c' : fiiSellStreak > 0 ? '#facc15' : '#4ade80'}}>{fiiSellStreak}</span>
                        <button onClick={() => { const v = Math.min(15, fiiSellStreak + 1); setFiiSellStreak(v); try { localStorage.setItem('qtp_fii_streak', String(v)); } catch {} }}
                          className="w-5 h-5 flex items-center justify-center rounded bg-slate-700/80 text-slate-400 hover:text-slate-200 text-[11px]">+</button>
                      </div>
                      <div className="text-[8px] mt-0.5" style={{color: fiiSellStreak >= 3 ? '#fb923c' : '#475569'}}>{fiiSellStreak >= 5 ? 'strong headwind' : fiiSellStreak >= 3 ? 'headwind' : fiiSellStreak > 0 ? 'mild' : 'neutral'}</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── EMOTIONAL ALERT BANNER ── */}
            {brainInsights?.emotionalAlert && brainInsights.streakType === 'L' && brainInsights.currentStreak >= 2 && (
              <div className="flex items-start gap-3 bg-red-900/20 border border-red-700/50 rounded-lg px-3 py-2.5">
                <span className="text-lg mt-0.5">⚠</span>
                <div>
                  <div className="text-[11px] font-bold text-red-300 mb-0.5">{brainInsights.currentStreak}-loss streak detected — Brain has reduced all scores</div>
                  <div className="text-[10px] text-red-400/80">{brainInsights.emotionalAlert.message ?? 'Review position sizing before your next entry. Consider taking a session off.'}</div>
                </div>
              </div>
            )}
            {brainInsights?.emotionalAlert && brainInsights.streakType === 'W' && brainInsights.currentStreak >= 4 && (
              <div className="flex items-start gap-3 bg-amber-900/20 border border-amber-700/50 rounded-lg px-3 py-2.5">
                <span className="text-lg mt-0.5">🔥</span>
                <div>
                  <div className="text-[11px] font-bold text-amber-300 mb-0.5">{brainInsights.currentStreak}-win streak — watch for overconfidence</div>
                  <div className="text-[10px] text-amber-400/80">Keep sizing disciplined. Hot streaks end. Stick to the process.</div>
                </div>
              </div>
            )}

            {/* ── BRAIN v2 SIGNAL COMMAND — only when signals exist ── */}
            {(() => {
              const buySignals = results.filter(r => ['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage));
              if (!buySignals.length) return null;
              const ranked = rankSignalsByBrainV2(buySignals, brainScores, brainPrior, brainInsights?.confidence);
              const brainConf = brainInsights?.confidence;
              const calCtx = getNSECalendarContext(fiiSellStreak);
              const totalClosed = trackedTrades.filter(t => t.status !== 'open').length;
              const isWarmingUp = totalClosed < 5;
              const visibleCount = showAllSignals ? ranked.length : Math.min(8, ranked.length);
              const paramShort: Record<string,string> = {
                'optimized_deployable_20plus':    'VF',
                'optimized_highprecision_15plus': 'CC',
                'optimized_elite_10plus':         'MP',
                'optimized_ultraselective_8plus': 'ES',
                'sniper_95plus':                  'PS',
                'ors_prime_reversal':             'ORS↩',
              };
              return (
                <div className="bg-slate-800/40 rounded-lg p-3 space-y-2">
                  {/* NSE Calendar Banners */}
                  {(calCtx.isExpiryWeek || calCtx.isBudgetWeek || fiiSellStreak >= 3) && (
                    <div className="flex flex-wrap gap-1.5">
                      {calCtx.isExpiryWeek && (
                        <div className="flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400" title="F&O monthly expiry week — IV crush creates false breakouts, reliability drops ~15-20%. Reduce position size.">
                          📅 F&amp;O EXPIRY {calCtx.daysToExpiry === 0 ? 'TODAY' : `in ${calCtx.daysToExpiry}d`} — reduced reliability
                        </div>
                      )}
                      {calCtx.isBudgetWeek && (
                        <div className="flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-purple-500/15 text-purple-400">
                          📋 BUDGET WEEK — half-size all trades
                        </div>
                      )}
                      {fiiSellStreak >= 3 && (
                        <div className="flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-red-500/15 text-red-400">
                          🔴 FII NET SELL ×{fiiSellStreak}d — institutional headwind
                        </div>
                      )}
                    </div>
                  )}

                  {/* Best param set callout — T1.8 */}
                  {brainInsights?.bestParamSet && (
                    <div className="flex items-center gap-2 bg-indigo-900/20 border border-indigo-800/40 rounded px-2.5 py-1.5">
                      <span className="text-[10px] text-indigo-400">🎰 Best param set for your history:</span>
                      <span className="text-[11px] font-bold text-indigo-200 font-mono">{brainInsights.bestParamSet.name}</span>
                      <span className="text-[10px] text-indigo-400">{brainInsights.bestParamSet.wr}% WR</span>
                      {brainInsights.bestParamSet.n && <span className="text-[9px] text-slate-600">{brainInsights.bestParamSet.n} trades</span>}
                    </div>
                  )}

                  {/* Header row */}
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
                      Signal Command — Ranked by Expected P&L
                    </div>
                    <div className="text-[10px] text-slate-600">{ranked.length} signal{ranked.length !== 1 ? 's' : ''}</div>
                  </div>

                  {/* Brain warming-up guard — T1.2 */}
                  {isWarmingUp && (
                    <div className="bg-amber-900/15 border border-amber-800/40 rounded px-3 py-2 flex items-start gap-2">
                      <span className="text-amber-400 mt-0.5">🧠</span>
                      <div>
                        <div className="text-[10px] font-semibold text-amber-300 mb-0.5">Brain warming up ({totalClosed}/{5} closed trades)</div>
                        <div className="text-[9px] text-amber-500/80">Scores below are near-baseline until you close {5 - totalClosed} more trade{5 - totalClosed !== 1 ? 's' : ''}. Track your trades in the Trade Desk to activate Bayesian learning.</div>
                      </div>
                    </div>
                  )}

                  {/* Signal rows — T1.5 show-all, T1.6 entry/stop/T2 */}
                  <div className="space-y-1">
                    {ranked.slice(0, visibleCount).map((sig: ReturnType<typeof rankSignalsByBrainV2>[number], idx: number) => {
                      const q = sig.quality;
                      const rel = sig.reliability;
                      const pe = sig.priceEngine;
                      const stageColor = sig.stage === 'ULTRA_STRONG_BUY' ? '#39FF14' : sig.stage === 'STRONG_BUY' ? '#22d3ee' : '#facc15';
                      const stageShort = sig.stage === 'ULTRA_STRONG_BUY' ? 'USB' : sig.stage === 'STRONG_BUY' ? 'SB' : 'BUY';
                      return (
                        <div key={sig.symbol} className="bg-slate-900/50 rounded px-2.5 py-1.5 cursor-pointer hover:bg-slate-800/60 transition-colors" onClick={() => setSelectedSymbol(sig.symbol)}>
                          {/* Main row */}
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-slate-600 font-mono w-4 text-center shrink-0">{idx + 1}</span>
                            <span className="font-mono font-bold text-slate-100 w-20 shrink-0">{sig.symbol.replace('.NS','').replace('.BO','')}</span>
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0" style={{color: stageColor, backgroundColor: `${stageColor}15`}}>{stageShort}</span>
                            <span className="text-[10px] text-slate-500 w-10 shrink-0">{paramShort[sig.paramSetKey] ?? '—'}</span>
                            {q ? (
                              <span className="font-mono font-bold text-[11px] w-14 shrink-0" style={{color: q.color}}>{q.expectedPnl >= 0 ? '+' : ''}{q.expectedPnl.toFixed(1)}%</span>
                            ) : <span className="w-14 shrink-0"/>}
                            {q ? <span className="text-[10px] text-slate-500 w-12 shrink-0">{q.wr}%WR</span> : <span className="w-12 shrink-0"/>}
                            {q && <span className="text-[9px] font-bold px-1 rounded shrink-0" style={{color: q.color, backgroundColor: `${q.color}20`}}>{q.tier}</span>}
                            <span className="text-slate-500 text-[10px] shrink-0">R:R {pe?.rewardRisk?.toFixed(1) ?? '—'}</span>
                            <span className="ml-auto text-[10px] shrink-0" style={{color: sig.brainScore >= 75 ? '#22d3ee' : sig.brainScore >= 60 ? '#facc15' : '#94a3b8'}}>
                              🧠{sig.brainScore} · {sig.riskLabel || `${sig.riskPct}% risk`}
                            </span>
                            {rel && rel.n >= 3 && (
                              <span className={`text-[9px] font-bold px-1 rounded shrink-0 ${rel.wr >= 70 ? 'text-emerald-400 bg-emerald-900/30' : rel.wr <= 40 ? 'text-red-400 bg-red-900/30' : 'text-slate-400 bg-slate-800/50'}`}>
                                {rel.n}× {rel.wr}%
                              </span>
                            )}
                            {(() => {
                              const pm = brainScores[sig.symbol]?.premortem;
                              if (!pm) return null;
                              const pmColor = pm.verdict === 'FAVORABLE' ? '#22d3ee' : pm.verdict === 'MIXED' ? '#facc15' : '#ef4444';
                              return (
                                <span className="text-[9px] font-mono font-bold px-1 rounded shrink-0" style={{color: pmColor, backgroundColor: `${pmColor}15`}}
                                  title={`${pm.matches.length} similar past trade${pm.matches.length !== 1 ? 's' : ''}: ${pm.winRate}% WR — ${pm.verdict}`}>
                                  PM {pm.winRate}%
                                </span>
                              );
                            })()}
                          </div>
                          {/* Entry / Stop / T2 sub-row — T1.6 */}
                          {pe && pe.entryPrice > 0 && (
                            <div className="flex items-center gap-3 mt-1 pl-6 text-[9px] font-mono">
                              <span className="text-slate-500">In <span className="text-emerald-400 font-bold">₹{pe.entryPrice.toFixed(1)}</span></span>
                              <span className="text-slate-500">SL <span className="text-red-400 font-bold">₹{(pe.tacticalStop ?? pe.stopLoss ?? 0).toFixed(1)}</span></span>
                              {pe.target2 > 0 && <span className="text-slate-500">T2 <span className="text-cyan-400 font-bold">₹{pe.target2.toFixed(1)}</span></span>}
                              {pe.target3 > 0 && <span className="text-slate-500">T3 <span className="text-indigo-400 font-bold">₹{pe.target3.toFixed(1)}</span></span>}
                              {pe.riskPct > 0 && <span className="text-slate-600">risk {pe.riskPct.toFixed(1)}%</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Show all toggle — T1.5 */}
                  {ranked.length > 8 && (
                    <button onClick={() => setShowAllSignals(v => !v)}
                      className="w-full text-center text-[10px] text-slate-500 hover:text-slate-300 py-1 border border-slate-700/50 rounded transition-colors">
                      {showAllSignals ? `▲ Show top 8 only` : `▼ Show all ${ranked.length} signals (${ranked.length - 8} more)`}
                    </button>
                  )}

                  <div className="text-[10px] text-slate-700 pt-1 border-t border-slate-700/30">
                    Brain weight {ranked[0]?.brainWeight ?? 60}% · Prior weight {100 - (ranked[0]?.brainWeight ?? 60)}% · Thompson: 5 factors · PM = premortem WR · FII sell streak adjusts all scores · Click row → scanner detail
                  </div>
                </div>
              );
            })()}

            {/* ── DECAY ALERTS — T1.4 ── */}
            {brainInsights?.decayAlerts && brainInsights.decayAlerts.length > 0 && (
              <div className="bg-slate-800/40 rounded-lg p-3 border border-orange-900/30">
                <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">⚡ Edge Decay Alerts</div>
                <div className="space-y-1.5">
                  {brainInsights.decayAlerts.map((da: {type: string; name: string; message: string; severity?: string}, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <span className="shrink-0 mt-0.5" style={{color: da.severity === 'high' ? '#ef4444' : '#fb923c'}}>▼</span>
                      <div>
                        <span className="font-semibold text-slate-300">{da.name}</span>
                        <span className="text-slate-500 ml-1">({da.type})</span>
                        <span className="text-slate-500 ml-1">— {da.message}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-[9px] text-slate-700 mt-2">Stop prioritising these param sets / sectors until edge recovers. Rotate to the strongest performers above.</div>
              </div>
            )}

            {/* ── SETUP QUALITY MATRIX ── */}
            {(() => {
              type MatrixCell = { param: string; label: string; data: {n:number;wr:number;avgPnl:number;medPnl:number;pct25:number;pct75:number} | null };
              type MatrixRow  = { stage: string; cells: MatrixCell[] };
              const matrix: MatrixRow[] | null = getSetupQualityMatrix(brainPrior);
              if (!matrix) return null;
              const stageLabel: Record<string,string> = { ULTRA_STRONG_BUY: 'Ultra Strong', STRONG_BUY: 'Strong Buy', BUY: 'Buy' };
              const stageColor: Record<string,string> = { ULTRA_STRONG_BUY: '#39FF14', STRONG_BUY: '#22d3ee', BUY: '#facc15' };
              const pnlColor = (v: number | undefined) => {
                if (v === undefined) return '#475569';
                if (v >= 3.8) return '#39FF14';
                if (v >= 2.8) return '#22d3ee';
                if (v >= 1.8) return '#facc15';
                if (v >= 0.5) return '#fb923c';
                return '#ef4444';
              };
              return (
                <div className="bg-slate-800/40 rounded-lg p-3">
                  <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Setup Quality Matrix — Avg P&L by Stage × Param Set</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr>
                          <th className="text-left text-slate-600 font-medium pb-2 pr-3">Stage</th>
                          {matrix[0].cells.map(c => (
                            <th key={c.param} className="text-center text-slate-500 font-medium pb-2 px-2 text-[10px]">{c.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.map(row => (
                          <tr key={row.stage} className="border-t border-slate-800/50">
                            <td className="py-1.5 pr-3 font-semibold" style={{color: stageColor[row.stage]}}>{stageLabel[row.stage] ?? row.stage}</td>
                            {row.cells.map(cell => {
                              const sparse = cell.data && cell.data.n < 5;
                              return (
                                <td key={cell.param} className="py-1.5 px-2 text-center" style={sparse ? {opacity: 0.45} : {}}>
                                  {cell.data ? (
                                    <div title={sparse ? `Only ${cell.data.n} trades — unreliable estimate` : undefined}>
                                      <div className="font-mono font-bold text-[11px]" style={{color: pnlColor(cell.data.avgPnl)}}>
                                        {sparse ? '≈' : ''}{cell.data.avgPnl >= 0 ? '+' : ''}{cell.data.avgPnl.toFixed(1)}%
                                      </div>
                                      <div className="text-[9px] text-slate-600">{cell.data.wr}%WR n={cell.data.n}</div>
                                    </div>
                                  ) : <span className="text-slate-700 text-[10px]">—</span>}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 text-[10px] text-slate-700">Based on {brainPrior?.total ?? '—'}-trade backtest. Green ≥+3.8% · Cyan ≥+2.8% · Yellow ≥+1.8% · Orange ≥+0.5% · Red below</div>
                </div>
              );
            })()}

            {/* ── PARAM SET PERFORMANCE SCORECARD ── */}
            {(() => {
              if (!brainPrior?.byParamSet) return null;
              const rows = Object.entries(brainPrior.byParamSet)
                .map(([key, s]: [string, {n:number,wr:number,avgPnl:number,medPnl:number}]) => ({key, label: (brainPrior.paramLabels as Record<string,string>)?.[key] ?? key, ...s}))
                .sort((a, b) => b.avgPnl - a.avgPnl);
              const maxPnl = Math.max(...rows.map(r => r.avgPnl));
              return (
                <div className="bg-slate-800/40 rounded-lg p-3">
                  <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Param Set Performance (Backtest)</div>
                  <div className="space-y-1.5">
                    {rows.map((r, i) => (
                      <div key={r.key} className="flex items-center gap-3 text-xs">
                        <span className="text-slate-600 w-3">{i + 1}</span>
                        <span className="font-mono text-slate-300 w-20 font-semibold">{r.label}</span>
                        <div className="flex-1 bg-slate-900/60 rounded-full h-1.5">
                          <div className="h-1.5 rounded-full" style={{width: `${maxPnl > 0 ? (r.avgPnl / maxPnl) * 100 : 0}%`, backgroundColor: r.avgPnl >= 3 ? '#22d3ee' : r.avgPnl >= 1 ? '#facc15' : '#ef4444'}} />
                        </div>
                        <span className="font-mono font-bold w-12 text-right" style={{color: r.avgPnl >= 3 ? '#22d3ee' : r.avgPnl >= 1 ? '#facc15' : '#ef4444'}}>{r.avgPnl >= 0 ? '+' : ''}{r.avgPnl.toFixed(2)}%</span>
                        <span className="text-slate-600 w-16">{r.wr}% WR</span>
                        <span className="text-slate-700 text-[10px]">n={r.n}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* ── STOCK DNA — backtest history for symbols in current scan ── */}
            {(() => {
              if (!brainPrior?.bySymbol) return null;
              const scanSymbols = results
                .filter(r => ['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage))
                .map(r => r.symbol);
              const withHistory = scanSymbols
                .map(sym => {
                  const rel = getSymbolReliability(brainPrior, sym);
                  return rel && rel.n >= 2 ? { sym, ...rel } : null;
                })
                .filter(Boolean)
                .sort((a, b) => (b!.wr - a!.wr));
              if (!withHistory.length) return null;
              return (
                <div className="bg-slate-800/40 rounded-lg p-3">
                  <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Stock DNA — Backtest History for Current Signals</div>
                  <div className="grid grid-cols-3 gap-2">
                    {withHistory.slice(0, 9).map(s => {
                      if (!s) return null;
                      const c = s.wr >= 70 ? '#22d3ee' : s.wr >= 50 ? '#facc15' : '#ef4444';
                      return (
                        <div key={s.sym} className="bg-slate-900/50 rounded px-2.5 py-1.5 cursor-pointer hover:bg-slate-800/60" onClick={() => setSelectedSymbol(s.sym)}>
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-slate-200 text-xs">{s.sym.replace('.NS','').replace('.BO','')}</span>
                            <span className="font-bold text-xs" style={{color: c}}>{s.wr}% WR</span>
                          </div>
                          <div className="flex items-center justify-between mt-0.5 text-[10px]">
                            <span className="text-slate-600">{s.n}× in backtest</span>
                            <span style={{color: (s.avgPnl ?? 0) >= 0 ? '#22d3ee' : '#ef4444'}}>{(s.avgPnl ?? 0) >= 0 ? '+' : ''}{(s.avgPnl ?? 0).toFixed(1)}%</span>
                          </div>
                          <div className="mt-1 bg-slate-800 rounded-full h-1">
                            <div className="h-1 rounded-full" style={{width: `${s.wr}%`, backgroundColor: c}} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-600">
                <div className="text-4xl mb-3">📡</div>
                <div className="text-sm font-medium mb-1">Run a scan to activate live intelligence</div>
                <div className="text-xs">RS ranking, sector rotation, multi-TF, signal command</div>
              </div>
            ) : (<>

            {/* Earnings Season Warning */}
            {earningsSeason.warning && (
              <div className="bg-amber-900/30 border border-amber-700 rounded-lg px-4 py-2 text-xs text-amber-300">
                ⚠ {earningsSeason.message} — reduce position size or verify individual stock earnings dates before entry
              </div>
            )}

            {/* #1: RS Ranking — Top 10 Leaders */}
            <div className="bg-slate-800/40 rounded-lg p-3">
              <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">RS Leaders (Top 10)</div>
              <div className="grid grid-cols-5 gap-2">
                {[...rsData.entries()]
                  .sort((a, b) => b[1].rsRank - a[1].rsRank)
                  .slice(0, 10)
                  .map(([sym, rs]) => {
                    const isBuy = results.find(r => r.symbol === sym && ['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage));
                    return (
                      <div key={sym} className={`bg-slate-900/40 rounded px-2 py-1.5 text-xs cursor-pointer hover:bg-slate-800/60 ${isBuy ? 'border border-emerald-800' : ''}`} onClick={() => setSelectedSymbol(sym)}>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-slate-200 font-semibold">{sym.replace('.NS', '').replace('.BO', '')}</span>
                          <span className="text-green-300 font-bold">{rs.rsRank}</span>
                        </div>
                        <div className="flex items-center justify-between mt-0.5">
                          <span className={`text-[10px] ${rs.rsStatus === 'leader' ? 'text-green-400' : rs.rsStatus === 'improving' ? 'text-emerald-400' : rs.rsStatus === 'declining' ? 'text-amber-400' : 'text-red-400'}`}>{rs.rsStatus}</span>
                          <span className="text-[10px] text-slate-500">slope {rs.rsSlope > 0 ? '+' : ''}{rs.rsSlope.toFixed(1)}</span>
                        </div>
                        {isBuy && <div className="text-[10px] text-emerald-400 mt-0.5">★ {STAGE_CONFIG[isBuy.stage].label}</div>}
                      </div>
                    );
                  })}
              </div>
              {rsData.size === 0 && <div className="text-xs text-slate-600 py-2">RS data not available — run a scan with Nifty data</div>}
            </div>

            {/* #2: Sector Rotation Heatmap */}
            <div className="bg-slate-800/40 rounded-lg p-3">
              <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Sector Rotation</div>
              {sectorFlows.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {sectorFlows.slice(0, 12).map(sf => (
                    <div key={sf.sector} className={`rounded px-2.5 py-1.5 text-xs border ${sf.flowLabel === 'inflow' ? 'bg-emerald-900/20 border-emerald-800' : sf.flowLabel === 'outflow' ? 'bg-red-900/20 border-red-800' : 'bg-slate-900/40 border-slate-700'}`}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-200 truncate">{sf.sector}</span>
                        <span className={`font-bold ${sf.flowLabel === 'inflow' ? 'text-emerald-400' : sf.flowLabel === 'outflow' ? 'text-red-400' : 'text-slate-500'}`}>{sf.strength}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px]">
                        <span className="text-slate-500">{sf.signalCount} signals</span>
                        <span className="text-slate-500">RS {sf.avgRS.toFixed(0)}</span>
                        <span className={sf.flowLabel === 'inflow' ? 'text-emerald-500' : sf.flowLabel === 'outflow' ? 'text-red-500' : 'text-slate-600'}>
                          {sf.flowLabel === 'inflow' ? '↑ inflow' : sf.flowLabel === 'outflow' ? '↓ outflow' : '— neutral'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <div className="text-xs text-slate-600 py-2">Run a scan to see sector rotation</div>}
            </div>

            {/* #3: Multi-TF Aligned Signals */}
            <div className="bg-slate-800/40 rounded-lg p-3">
              <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Multi-Timeframe Aligned (Daily + Weekly)</div>
              {(() => {
                const dwSignals = [...tfAlignments.entries()].filter(([, tf]) => tf.alignment === 'DW');
                const dSignals = [...tfAlignments.entries()].filter(([, tf]) => tf.alignment === 'D');
                return dwSignals.length > 0 || dSignals.length > 0 ? (
                  <div className="space-y-1">
                    {dwSignals.map(([sym]) => {
                      const r = results.find(x => x.symbol === sym);
                      const rs = rsData.get(sym);
                      return (
                        <div key={sym} className="flex items-center gap-3 text-xs bg-emerald-900/20 border border-emerald-800/50 rounded px-2 py-1.5 cursor-pointer hover:bg-emerald-900/30" onClick={() => setSelectedSymbol(sym)}>
                          <span className="text-green-300 font-bold w-6">DW</span>
                          <span className="font-mono text-slate-200 w-28">{sym.replace('.NS', '').replace('.BO', '')}</span>
                          <span className={`${STAGE_CONFIG[r?.stage ?? 'NO_SIGNAL'].color}`}>{STAGE_CONFIG[r?.stage ?? 'NO_SIGNAL'].label}</span>
                          <span className="text-slate-500">RS {rs?.rsRank ?? '—'}</span>
                          <span className="text-slate-500">R:R {r?.priceEngine.rewardRisk.toFixed(1) ?? '—'}</span>
                          <span className="text-emerald-400 ml-auto">★ Weekly Breakout Confirmed</span>
                        </div>
                      );
                    })}
                    {dSignals.map(([sym]) => {
                      const r = results.find(x => x.symbol === sym);
                      return (
                        <div key={sym} className="flex items-center gap-3 text-xs bg-slate-900/40 rounded px-2 py-1.5 cursor-pointer hover:bg-slate-800/40" onClick={() => setSelectedSymbol(sym)}>
                          <span className="text-yellow-300 font-bold w-6">D</span>
                          <span className="font-mono text-slate-200 w-28">{sym.replace('.NS', '').replace('.BO', '')}</span>
                          <span className={`${STAGE_CONFIG[r?.stage ?? 'NO_SIGNAL'].color}`}>{STAGE_CONFIG[r?.stage ?? 'NO_SIGNAL'].label}</span>
                          <span className="text-slate-500">Weekly compressing — watch for DW</span>
                        </div>
                      );
                    })}
                  </div>
                ) : <div className="text-xs text-slate-600 py-2">{results.length > 0 ? 'No multi-timeframe aligned signals in this scan' : 'Run a scan first'}</div>;
              })()}
            </div>

            {/* #5: Portfolio Correlation */}
            {portCorrelation && portCorrelation.pairs.length > 0 && (
              <div className={`rounded-lg p-3 ${portCorrelation.concentrated ? 'bg-red-900/20 border border-red-800' : 'bg-slate-800/40'}`}>
                <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">
                  Portfolio Correlation {portCorrelation.concentrated && <span className="text-red-400 ml-2">⚠ CONCENTRATED</span>}
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs mb-2">
                  <div className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                    <div className="text-slate-500">Avg Correlation</div>
                    <div className={`text-lg font-bold ${portCorrelation.avgCorrelation > 0.7 ? 'text-red-400' : portCorrelation.avgCorrelation > 0.5 ? 'text-amber-400' : 'text-emerald-400'}`}>{portCorrelation.avgCorrelation.toFixed(2)}</div>
                  </div>
                  <div className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                    <div className="text-slate-500">Max Correlation</div>
                    <div className="text-slate-200 text-lg font-bold">{portCorrelation.maxCorrelation.toFixed(2)}</div>
                    <div className="text-[10px] text-slate-600">{portCorrelation.maxPair[0].replace('.NS', '')} / {portCorrelation.maxPair[1].replace('.NS', '')}</div>
                  </div>
                  <div className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                    <div className="text-slate-500">Diversification</div>
                    <div className={`text-lg font-bold ${portCorrelation.avgCorrelation < 0.4 ? 'text-emerald-400' : portCorrelation.avgCorrelation < 0.6 ? 'text-yellow-300' : 'text-red-400'}`}>{portCorrelation.avgCorrelation < 0.4 ? 'Good' : portCorrelation.avgCorrelation < 0.6 ? 'Fair' : 'Poor'}</div>
                  </div>
                </div>
                <div className="space-y-0.5">
                  {portCorrelation.pairs.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr)).slice(0, 5).map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-slate-400 w-24">{p.a.replace('.NS', '')}</span>
                      <span className="text-slate-600">↔</span>
                      <span className="font-mono text-slate-400 w-24">{p.b.replace('.NS', '')}</span>
                      <div className="flex-1 bg-slate-800 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${Math.abs(p.corr) > 0.7 ? 'bg-red-500' : Math.abs(p.corr) > 0.4 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.abs(p.corr) * 100}%` }} />
                      </div>
                      <span className={`font-mono w-12 text-right ${Math.abs(p.corr) > 0.7 ? 'text-red-400' : 'text-slate-400'}`}>{p.corr.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* #9: Risk of Ruin */}
            {(() => {
              const ws = computeWinRateStats(trackedTrades);
              if (ws.total < 5) return (
                <div className="bg-slate-800/40 rounded-lg p-3">
                  <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-1">Risk of Ruin</div>
                  <div className="text-xs text-slate-600">Need 5+ closed trades to compute risk metrics</div>
                </div>
              );
              const ror = computeRiskOfRuin(ws.winRate, ws.avgWinR, Math.abs(ws.avgLossR), 1.0);
              return (
                <div className={`rounded-lg p-3 ${ror.safetyRating === 'dangerous' ? 'bg-red-900/20 border border-red-800' : ror.safetyRating === 'moderate' ? 'bg-amber-900/20 border border-amber-800' : 'bg-emerald-900/20 border border-emerald-800'}`}>
                  <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Risk of Ruin Analysis</div>
                  <div className="grid grid-cols-5 gap-2 text-xs">
                    <div className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                      <div className="text-slate-500">30% DD Prob</div>
                      <div className={`text-lg font-bold ${ror.rorPct < 5 ? 'text-emerald-400' : ror.rorPct < 25 ? 'text-amber-400' : 'text-red-400'}`}>{ror.rorPct.toFixed(1)}%</div>
                    </div>
                    <div className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                      <div className="text-slate-500">Kelly %</div>
                      <div className="text-slate-200 text-lg font-bold">{ror.kellyPct.toFixed(1)}%</div>
                    </div>
                    <div className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                      <div className="text-slate-500">Half-Kelly</div>
                      <div className="text-emerald-400 text-lg font-bold">{ror.halfKellyPct.toFixed(1)}%</div>
                    </div>
                    <div className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                      <div className="text-slate-500">Max Consec Loss</div>
                      <div className="text-slate-200 text-lg font-bold">{ror.maxConsecLosses}</div>
                    </div>
                    <div className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                      <div className="text-slate-500">Safety</div>
                      <div className={`text-lg font-bold ${ror.safetyRating === 'safe' ? 'text-emerald-400' : ror.safetyRating === 'moderate' ? 'text-amber-400' : 'text-red-400'}`}>{ror.safetyRating.toUpperCase()}</div>
                    </div>
                  </div>
                  {/* Recommendation line — T1.9 */}
                  <div className="mt-2 flex items-center gap-2 text-[10px]">
                    <span className="text-emerald-400 font-bold">→ Suggested risk per trade:</span>
                    <span className="font-mono font-bold text-emerald-300">{ror.halfKellyPct.toFixed(1)}% (Half-Kelly)</span>
                    {ror.rorPct >= 25 && <span className="text-red-400 ml-1">— reduce size immediately</span>}
                    {ror.rorPct >= 5 && ror.rorPct < 25 && <span className="text-amber-400 ml-1">— moderate caution</span>}
                    {ror.rorPct < 5 && <span className="text-slate-500 ml-1">— system is healthy</span>}
                  </div>
                </div>
              );
            })()}

            {/* #8: Adaptive Scan Info */}
            <div className="bg-slate-800/40 rounded-lg p-3">
              <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Adaptive Scan Schedule (IST)</div>
              <div className="grid grid-cols-4 gap-2 text-xs">
                {[
                  { time: '9:15-9:45', interval: '5 min', reason: 'Opening breakouts', active: true },
                  { time: '9:45-2:30', interval: '30 min', reason: 'Midday consolidation', active: false },
                  { time: '2:30-3:30', interval: '10 min', reason: 'Closing hour action', active: true },
                  { time: 'After 3:30', interval: 'Off', reason: 'Market closed', active: false },
                ].map((s, i) => (
                  <div key={i} className={`rounded px-2 py-1.5 border ${s.active ? 'bg-emerald-900/20 border-emerald-800' : 'bg-slate-900/40 border-slate-700'}`}>
                    <div className="font-semibold text-slate-200">{s.time}</div>
                    <div className={s.active ? 'text-emerald-400' : 'text-slate-500'}>{s.interval}</div>
                    <div className="text-[10px] text-slate-600">{s.reason}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Legend */}
            <div className="bg-slate-800/20 rounded-lg px-3 py-2 text-[10px] text-slate-600 space-y-0.5">
              <div><span className="text-slate-500 font-semibold">Signal Command:</span> Ranks current BUY signals by composite score (brain + backtest expected P&L). Size up on ELITE tier setups.</div>
              <div><span className="text-slate-500 font-semibold">Setup Matrix:</span> Expected P&L per Stage × Param Set from {brainPrior?.total ?? '—'}-trade backtest. STRONG_BUY + Compression Coil (CC) is the elite tier. R5: PS+ES = BULL POOL at breadth&gt;50% (75% OOS Hit5).</div>
              <div><span className="text-slate-500 font-semibold">RS Rank:</span> Mansfield Relative Strength percentile (0-100). Above 70 = leader, below 30 = laggard. Only buy RS leaders.</div>
              <div><span className="text-slate-500 font-semibold">TF Align:</span> DW = Daily + Weekly breakout confirmed (highest probability). D = Daily only (weekly still compressing).</div>
              <div><span className="text-slate-500 font-semibold">Sector Rotation:</span> Green = money flowing in + signals appearing. Red = money leaving. Trade WITH sector momentum.</div>
              <div><span className="text-slate-500 font-semibold">Risk of Ruin:</span> Probability of a 30% drawdown given current win rate and R:R. Below 5% = safe.</div>
            </div>

            </>)}
          </div>
        )}

        {/* ── PBFB Tab ── */}
        {activeTab === 'pbfb' && <PBFBAnalyzer />}

        {/* ── Pro Tab (Backtester + Portfolio Optimizer) ── */}
        {activeTab === 'pro' && (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">🏆 Pro Analytics</h2>

            {/* Backtest Section */}
            <div className="bg-slate-800/40 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Signal History · Production Engine</div>
                <button disabled={scanning || backtestRunning || Object.keys(candleCache).length === 0}
                  onClick={() => {
                    setBacktestRunning(true);
                    setBacktestError(null);
                    const _run = async () => {
                      const WINDOW = 250;
                      // Phase 2 exit weights (deep_backtest 2026-07-24, n=87333 OOS, 65M simulations)
                      const ARCH_EXIT: Record<string, {w1:number;w2:number;w3:number}> = {
                        'ors_prime_reversal':             { w1:0.50, w2:0.05, w3:0.45 },
                        'optimized_deployable_20plus':    { w1:0.70, w2:0.10, w3:0.20 },
                        'optimized_highprecision_15plus': { w1:0.65, w2:0.10, w3:0.25 },
                        'optimized_elite_10plus':         { w1:0.70, w2:0.10, w3:0.20 },
                        'optimized_ultraselective_8plus': { w1:0.55, w2:0.10, w3:0.35 },
                        'circuit_breaker_v2':             { w1:0.65, w2:0.10, w3:0.25 },
                      };
                      const ARCH_KEYS: ParamSetKey[] = [
                        'ors_prime_reversal', 'optimized_deployable_20plus',
                        'optimized_highprecision_15plus', 'optimized_elite_10plus',
                        'optimized_ultraselective_8plus', 'circuit_breaker_v2',
                      ];
                      const allTrades: BacktestTrade[] = [];
                      const symbolList = Object.keys(candleCache);
                      for (let si = 0; si < symbolList.length; si++) {
                        if (si % 5 === 0) await new Promise(r => setTimeout(r, 0));
                        const sym = symbolList[si];
                        const bars = candleCache[sym];
                        if (!bars || bars.length < WINDOW + 21) continue;
                        let i = WINDOW - 1;
                        while (i <= bars.length - 22) {
                          const w = bars.slice(i - WINDOW + 1, i + 1);
                          let advanced = false;
                          for (const key of ARCH_KEYS) {
                            let res: ReturnType<typeof analyzeStock> | undefined;
                            try { res = analyzeStock(w, key, false); } catch (_e) { continue; }
                            if (!res || !['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(res.stage)) continue;
                            const pe = res.priceEngine;
                            if (!pe?.tradeValid || pe.tacticalStop <= 0 || pe.target5 <= pe.plannedEntry) continue;
                            const entry = pe.plannedEntry;
                            const stop  = pe.tacticalStop;
                            const t1 = pe.target5, t2 = pe.target7, t3 = pe.target10;
                            const maxHold = Math.min(pe.maxHoldBars ?? 20, bars.length - i - 2);
                            const riskPct = Math.max((entry - stop) / entry * 100, 0.1);
                            const { w1: W1, w2: W2, w3: W3 } = ARCH_EXIT[key] ?? { w1:0.50, w2:0.30, w3:0.20 };
                            let phase = 1, wLeft = 1.0, wPL = 0, t1Hit = false;
                            let mfe = 0, exitI = i + 1, exitType: 'target' | 'stopped' | 'expired' = 'expired';
                            const eBar = bars[i + 1];
                            if (!eBar) { i++; advanced = true; break; }
                            if (eBar.o < stop) {
                              wPL = (eBar.o - entry) / entry * 100; exitI = i + 1; exitType = 'stopped';
                            } else {
                              for (let j = i + 1; j <= i + maxHold && j < bars.length; j++) {
                                const b = bars[j]; exitI = j;
                                const hiD = (b.h - entry) / entry * 100; if (hiD > mfe) mfe = hiD;
                                if (phase === 1) {
                                  if (b.l <= stop) { wPL += wLeft * (stop - entry) / entry * 100; exitType = 'stopped'; break; }
                                  if (b.h >= t1)   { wPL += W1 * (t1 - entry) / entry * 100; wLeft -= W1; t1Hit = true; phase = 2; }
                                }
                                if (phase === 2) {
                                  if (b.l <= stop) { wPL += wLeft * (stop - entry) / entry * 100; exitType = 'stopped'; break; }
                                  if (b.h >= t2)   { wPL += W2 * (t2 - entry) / entry * 100; wLeft -= W2; phase = 3; }
                                }
                                if (phase === 3) {
                                  if (b.l <= stop) { wPL += wLeft * (stop - entry) / entry * 100; exitType = 'stopped'; break; }
                                  if (b.h >= t3)   { wPL += W3 * (t3 - entry) / entry * 100; wLeft = 0; exitType = 'target'; break; }
                                }
                                if (j === i + maxHold && wLeft > 0) {
                                  wPL += wLeft * (b.c - entry) / entry * 100;
                                  exitType = t1Hit ? 'target' : wPL > 0 ? 'target' : 'stopped';
                                }
                              }
                            }
                            const exitPrice = entry * (1 + wPL / 100);
                            const shares = Math.max(1, Math.floor(accountSize * 0.01 / (riskPct / 100 * entry)));
                            const costs = computeTradeCosts(entry * shares, exitPrice * shares);
                            allTrades.push({
                              symbol: sym, entryDate: new Date((eBar.ts + 19800) * 1000).toISOString().slice(0, 10),
                              entryPrice: entry, stopLoss: stop, target1: t1,
                              exitPrice, exitDate: new Date((bars[exitI].ts + 19800) * 1000).toISOString().slice(0, 10),
                              exitType, pnlPct: wPL, pnlR: wPL / riskPct,
                              pnlGross: wPL * shares * entry / 100, pnlNet: wPL * shares * entry / 100 - costs.totalCost,
                              costs, daysHeld: exitI - (i + 1), mfe, shares,
                            });
                            i = exitI + 1; advanced = true; break;
                          }
                          if (!advanced) i++;
                        }
                      }
                      setBacktestResult(aggregateBacktest(allTrades, niftyCandles ?? undefined, accountSize));
                    };
                    _run()
                      .catch((err: unknown) => { setBacktestError(err instanceof Error ? err.message : 'Backtest failed'); })
                      .finally(() => { setBacktestRunning(false); });
                  }}
                  className="h-6 px-3 bg-amber-900/40 hover:bg-amber-900/60 border border-amber-600 rounded text-[11px] font-semibold text-amber-300 disabled:opacity-40 transition-colors">
                  {backtestRunning ? '⏳ Running…' : backtestResult ? 'Re-run Backtest' : 'Run Backtest'}</button>
              </div>
              {backtestError && (
                <div className="text-xs text-red-400 py-2 px-3 bg-red-950/30 rounded border border-red-900/50 mb-2">⚠ {backtestError}</div>
              )}
              {!backtestResult ? (
                <div className="text-xs text-slate-600 py-4 text-center">{backtestRunning ? 'Running backtest across all cached symbols…' : 'Run a scan first, then click "Run Backtest" to test the screening engine on historical data'}</div>
              ) : (
                <>
                  {/* KPIs */}
                  <div className="grid grid-cols-6 gap-2 mb-3">
                    {[
                      { label: 'Signals', value: String(backtestResult.totalSignals), color: 'text-slate-200' },
                      { label: 'Win Rate', value: `${backtestResult.winRate.toFixed(0)}%`, color: backtestResult.winRate >= 55 ? 'text-emerald-400' : 'text-red-400' },
                      { label: 'Expectancy', value: `${backtestResult.expectancyR >= 0 ? '+' : ''}${backtestResult.expectancyR.toFixed(2)}R`, color: backtestResult.expectancyR >= 0 ? 'text-emerald-400' : 'text-red-400' },
                      { label: 'Profit Factor', value: backtestResult.profitFactor.toFixed(2), color: backtestResult.profitFactor >= 1.5 ? 'text-emerald-400' : 'text-amber-400' },
                      { label: 'Max DD', value: `${backtestResult.maxDrawdownPct.toFixed(1)}%`, color: backtestResult.maxDrawdownPct < 15 ? 'text-emerald-400' : 'text-red-400' },
                      { label: 'Sharpe', value: backtestResult.sharpeRatio.toFixed(2), color: backtestResult.sharpeRatio >= 1.5 ? 'text-emerald-400' : 'text-amber-400' },
                    ].map((k, i) => (
                      <div key={i} className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                        <div className="text-[10px] text-slate-500">{k.label}</div>
                        <div className={`text-lg font-bold ${k.color}`}>{k.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Equity Curve */}
                  <div className="bg-slate-900/40 rounded p-2 mb-3">
                    <div className="text-[10px] text-slate-500 mb-1">Equity Curve (₹10L start, 1% risk/trade)</div>
                    {(() => {
                      const ec = backtestResult.equityCurve;
                      if (ec.length < 2) return null;
                      const maxE = Math.max(...ec.map(p => p.equity));
                      const minE = Math.min(...ec.map(p => p.equity));
                      const range = maxE - minE || 1;
                      const h = 100;
                      return (
                        <div className="relative" style={{ height: h }}>
                          <svg viewBox={`0 0 100 ${h}`} className="w-full h-full" preserveAspectRatio="none">
                            <polyline fill="none" stroke={ec[ec.length - 1].equity >= 1000000 ? '#22c55e' : '#ef4444'} strokeWidth="1.5"
                              points={ec.map((p, i) => `${(i / Math.max(ec.length - 1, 1)) * 100},${((maxE - p.equity) / range) * h}`).join(' ')} />
                          </svg>
                          <div className="absolute top-0 right-1 text-[9px] text-emerald-400">₹{(maxE / 100000).toFixed(1)}L</div>
                          <div className="absolute bottom-0 right-1 text-[9px] text-slate-500">₹{(minE / 100000).toFixed(1)}L</div>
                          <div className="absolute bottom-0 left-1 text-[9px] text-slate-600">{ec.length - 1} trades</div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Monthly Returns */}
                  {backtestResult.monthlyReturns.length > 0 && (
                    <div className="bg-slate-900/40 rounded p-2 mb-3">
                      <div className="text-[10px] text-slate-500 mb-1">Monthly Returns</div>
                      <div className="grid grid-cols-6 gap-1">
                        {backtestResult.monthlyReturns.slice(-12).map(m => (
                          <div key={m.month} className={`text-center rounded px-1 py-0.5 text-[9px] ${m.pnlR >= 0 ? 'bg-emerald-900/30 text-emerald-300' : 'bg-red-900/30 text-red-300'}`}>
                            <div className="text-slate-500">{m.month.slice(5)}</div>
                            <div className="font-bold">{m.pnlR >= 0 ? '+' : ''}{m.pnlR.toFixed(1)}R</div>
                            <div className="text-slate-600">{m.trades}t</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-4 gap-2 text-[10px]">
                    <div className="bg-slate-900/40 rounded px-2 py-1 text-center"><span className="text-slate-500">Avg Win</span><div className="text-emerald-400 font-bold">+{backtestResult.avgWinR.toFixed(2)}R</div></div>
                    <div className="bg-slate-900/40 rounded px-2 py-1 text-center"><span className="text-slate-500">Avg Loss</span><div className="text-red-400 font-bold">-{backtestResult.avgLossR.toFixed(2)}R</div></div>
                    <div className="bg-slate-900/40 rounded px-2 py-1 text-center"><span className="text-slate-500">Max Win Streak</span><div className="text-emerald-400 font-bold">{backtestResult.maxConsecWins}</div></div>
                    <div className="bg-slate-900/40 rounded px-2 py-1 text-center"><span className="text-slate-500">Max Loss Streak</span><div className="text-red-400 font-bold">{backtestResult.maxConsecLosses}</div></div>
                  </div>

                  {/* Kotak Costs Summary */}
                  <div className="bg-slate-900/40 rounded p-2 mb-3 text-[10px]">
                    <div className="text-slate-500 font-semibold mb-1">Kotak Securities Costs</div>
                    <div className="grid grid-cols-4 gap-2">
                      <div><span className="text-slate-600">Total Costs</span><div className="text-red-400 font-mono">₹{backtestResult.totalCosts.toFixed(0)}</div></div>
                      <div><span className="text-slate-600">Avg/Trade</span><div className="text-slate-300 font-mono">₹{backtestResult.avgCostPerTrade.toFixed(0)}</div></div>
                      <div><span className="text-slate-600">Net P&L</span><div className={`font-mono font-bold ${backtestResult.trades.reduce((s,t) => s + t.pnlNet, 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>₹{backtestResult.trades.reduce((s,t) => s + t.pnlNet, 0).toFixed(0)}</div></div>
                      <div><span className="text-slate-600">Gross P&L</span><div className="text-slate-400 font-mono">₹{backtestResult.trades.reduce((s,t) => s + t.pnlGross, 0).toFixed(0)}</div></div>
                    </div>
                  </div>

                  {/* #3: Benchmark vs Nifty */}
                  {backtestResult.benchmark && (
                    <div className="bg-slate-900/40 rounded p-2 mb-3 text-[10px]">
                      <div className="text-slate-500 font-semibold mb-1">Strategy vs Nifty 50 (Buy & Hold)</div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div><span className="text-slate-600">Strategy</span><div className={`text-lg font-bold ${backtestResult.benchmark.strategyReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{backtestResult.benchmark.strategyReturn >= 0 ? '+' : ''}{backtestResult.benchmark.strategyReturn.toFixed(1)}%</div></div>
                        <div><span className="text-slate-600">Nifty B&H</span><div className={`text-lg font-bold ${backtestResult.benchmark.niftyReturn >= 0 ? 'text-slate-300' : 'text-red-400'}`}>{backtestResult.benchmark.niftyReturn >= 0 ? '+' : ''}{backtestResult.benchmark.niftyReturn.toFixed(1)}%</div></div>
                        <div><span className="text-slate-600">Alpha</span><div className={`text-lg font-bold ${backtestResult.benchmark.alpha >= 0 ? 'text-[#39FF14]' : 'text-red-400'}`}>{backtestResult.benchmark.alpha >= 0 ? '+' : ''}{backtestResult.benchmark.alpha.toFixed(1)}%</div></div>
                      </div>
                    </div>
                  )}

                  {/* #4: Monte Carlo */}
                  {backtestResult.monteCarlo && (
                    <div className="bg-slate-900/40 rounded p-2 mb-3 text-[10px]">
                      <div className="text-slate-500 font-semibold mb-1">Monte Carlo (500 simulations, shuffled trade order)</div>
                      <div className="grid grid-cols-4 gap-2 text-center">
                        <div><span className="text-slate-600">Worst 10%</span><div className="text-red-400 font-bold font-mono">₹{(backtestResult.monteCarlo.p10/100000).toFixed(1)}L</div></div>
                        <div><span className="text-slate-600">Median</span><div className="text-slate-200 font-bold font-mono">₹{(backtestResult.monteCarlo.median/100000).toFixed(1)}L</div></div>
                        <div><span className="text-slate-600">Best 10%</span><div className="text-emerald-400 font-bold font-mono">₹{(backtestResult.monteCarlo.p90/100000).toFixed(1)}L</div></div>
                        <div><span className="text-slate-600">Ruin Prob</span><div className={`font-bold ${backtestResult.monteCarlo.ruinProbability < 5 ? 'text-emerald-400' : backtestResult.monteCarlo.ruinProbability < 20 ? 'text-amber-400' : 'text-red-400'}`}>{backtestResult.monteCarlo.ruinProbability.toFixed(1)}%</div></div>
                      </div>
                    </div>
                  )}

                  {/* #5: Drawdown + #6: Walk-Forward side by side */}
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="bg-slate-900/40 rounded p-2 text-[10px]">
                      <div className="text-slate-500 font-semibold mb-1">Drawdown Analysis</div>
                      <div className="space-y-0.5">
                        <div className="flex justify-between"><span className="text-slate-600">Max DD</span><span className="text-red-400 font-mono font-bold">{backtestResult.drawdownAnalysis.maxDDPct.toFixed(1)}%</span></div>
                        <div className="flex justify-between"><span className="text-slate-600">DD Duration</span><span className="text-slate-300 font-mono">{backtestResult.drawdownAnalysis.maxDDDuration} trades</span></div>
                        <div className="flex justify-between"><span className="text-slate-600">Avg DD</span><span className="text-slate-400 font-mono">{backtestResult.drawdownAnalysis.avgDDPct.toFixed(1)}%</span></div>
                        <div className="flex justify-between"><span className="text-slate-600">Recovery</span><span className="text-emerald-400 font-mono">{backtestResult.drawdownAnalysis.recoveryTrades} trades</span></div>
                      </div>
                      {/* Underwater curve mini */}
                      {backtestResult.drawdownAnalysis.underwaterCurve.length > 2 && (
                        <div className="mt-1 h-8 relative">
                          <svg viewBox={`0 0 100 20`} className="w-full h-full" preserveAspectRatio="none">
                            <polyline fill="none" stroke="#ef4444" strokeWidth="1"
                              points={backtestResult.drawdownAnalysis.underwaterCurve.map((p, i) => `${(i / Math.max(backtestResult.drawdownAnalysis.underwaterCurve.length - 1, 1)) * 100},${Math.min(p.ddPct / Math.max(backtestResult.drawdownAnalysis.maxDDPct, 1) * 18, 18) + 1}`).join(' ')} />
                          </svg>
                        </div>
                      )}
                    </div>

                    <div className="bg-slate-900/40 rounded p-2 text-[10px]">
                      <div className="text-slate-500 font-semibold mb-1">Walk-Forward (70/30 split)</div>
                      <div className="space-y-0.5">
                        <div className="flex justify-between"><span className="text-slate-600">In-Sample WR</span><span className="text-slate-300 font-mono">{backtestResult.walkForward.inSampleWR.toFixed(0)}%</span></div>
                        <div className="flex justify-between"><span className="text-slate-600">In-Sample Exp</span><span className="text-slate-300 font-mono">{backtestResult.walkForward.inSampleExp >= 0 ? '+' : ''}{backtestResult.walkForward.inSampleExp.toFixed(2)}R</span></div>
                        <div className="flex justify-between"><span className="text-slate-600">Out-Sample WR</span><span className={`font-mono font-bold ${backtestResult.walkForward.outSampleWR >= backtestResult.walkForward.inSampleWR * 0.8 ? 'text-emerald-400' : 'text-amber-400'}`}>{backtestResult.walkForward.outSampleWR.toFixed(0)}%</span></div>
                        <div className="flex justify-between"><span className="text-slate-600">Out-Sample Exp</span><span className={`font-mono font-bold ${backtestResult.walkForward.outSampleExp >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{backtestResult.walkForward.outSampleExp >= 0 ? '+' : ''}{backtestResult.walkForward.outSampleExp.toFixed(2)}R</span></div>
                        <div className="flex justify-between"><span className="text-slate-600">Degradation</span><span className={`font-mono ${backtestResult.walkForward.degradation < 30 ? 'text-emerald-400' : 'text-amber-400'}`}>{backtestResult.walkForward.degradation.toFixed(0)}%</span></div>
                        <div className={`mt-1 text-center font-semibold ${backtestResult.walkForward.robust ? 'text-emerald-400' : 'text-red-400'}`}>{backtestResult.walkForward.robust ? '✓ ROBUST' : '✗ NOT ROBUST'}</div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Portfolio Optimizer Section */}
            <div className="bg-slate-800/40 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Portfolio Optimizer</div>
                <button disabled={filteredResults.length === 0}
                  onClick={() => {
                    const signals = filteredResults
                      .filter(r => ['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage))
                      .map(r => ({
                        symbol: r.symbol, sector: getSectorTag(r.symbol), conviction: computeConviction(r),
                        rewardRisk: r.priceEngine.rewardRisk, rsRank: rsData.get(r.symbol)?.rsRank ?? 50,
                        entryPrice: r.priceEngine.plannedEntry, stopLoss: r.priceEngine.tacticalStop,
                        tradeValid: r.priceEngine.tradeValid,
                      }));
                    setPortfolioResult(optimizePortfolio(signals, candleCache, accountSize));
                  }}
                  className="h-6 px-3 bg-indigo-900/40 hover:bg-indigo-900/60 border border-indigo-600 rounded text-[11px] font-semibold text-indigo-300 disabled:opacity-40 transition-colors">
                  Optimize</button>
              </div>
              {!portfolioResult ? (
                <div className="text-xs text-slate-600 py-4 text-center">Run a scan with BUY signals, then click "Optimize" to build the best portfolio</div>
              ) : portfolioResult.selected.length === 0 ? (
                <div className="text-xs text-slate-600 py-4 text-center">No valid BUY signals to optimize</div>
              ) : (
                <>
                  {/* Portfolio KPIs */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <div className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                      <div className="text-[10px] text-slate-500">Diversification</div>
                      <div className={`text-xl font-bold ${portfolioResult.diversificationScore >= 70 ? 'text-emerald-400' : portfolioResult.diversificationScore >= 40 ? 'text-yellow-300' : 'text-red-400'}`}>{portfolioResult.diversificationScore}</div>
                    </div>
                    <div className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                      <div className="text-[10px] text-slate-500">Avg Correlation</div>
                      <div className={`text-xl font-bold ${portfolioResult.portfolioCorrelation < 0.4 ? 'text-emerald-400' : 'text-amber-400'}`}>{portfolioResult.portfolioCorrelation.toFixed(2)}</div>
                    </div>
                    <div className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                      <div className="text-[10px] text-slate-500">Expected R:R</div>
                      <div className="text-xl font-bold text-slate-200">{portfolioResult.expectedRR.toFixed(2)}</div>
                    </div>
                  </div>

                  {/* Selected stocks */}
                  <div className="text-[10px] text-emerald-400 font-semibold mb-1 uppercase">Selected ({portfolioResult.selected.length})</div>
                  <div className="space-y-1 mb-3">
                    {portfolioResult.selected.map((s, i) => (
                      <div key={s.symbol} className="flex items-center gap-2 text-xs bg-emerald-900/15 border border-emerald-800/30 rounded px-2 py-1.5 cursor-pointer hover:bg-emerald-900/25" onClick={() => setSelectedSymbol(s.symbol)}>
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${s.grade === 'A' ? 'bg-emerald-600 text-white' : s.grade === 'B' ? 'bg-yellow-600 text-white' : 'bg-slate-600 text-white'}`}>{s.grade}</span>
                        <span className="font-mono text-slate-200 font-semibold w-24">{s.symbol.replace('.NS', '').replace('.BO', '')}</span>
                        <span className="text-slate-500 w-10">{s.sector || '—'}</span>
                        <span className="text-slate-400">Conv {s.conviction}</span>
                        <span className={rrVerdictColor(s.rewardRisk)}>R:R {s.rewardRisk.toFixed(1)}</span>
                        <span className="text-slate-500">RS {s.rsRank}</span>
                        <span className="ml-auto text-slate-400 font-mono">{s.weight.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>

                  {/* Capital allocation */}
                  <div className="text-[10px] text-slate-500 font-semibold mb-1 uppercase">Capital Allocation (₹{(accountSize / 100000).toFixed(0)}L, {1}% risk)</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[10px]">
                      <thead><tr className="text-slate-500 border-b border-slate-700">
                        <th className="text-left py-0.5 px-1">Symbol</th><th className="text-right py-0.5 px-1">Shares</th><th className="text-right py-0.5 px-1">Capital</th><th className="text-right py-0.5 px-1">Risk</th>
                      </tr></thead>
                      <tbody>
                        {portfolioResult.capitalAllocation.map(a => (
                          <tr key={a.symbol} className="border-b border-slate-800/30">
                            <td className="py-0.5 px-1 font-mono text-slate-200">{a.symbol.replace('.NS', '')}</td>
                            <td className="py-0.5 px-1 text-right text-emerald-400 font-bold">{a.shares}</td>
                            <td className="py-0.5 px-1 text-right text-slate-300 font-mono">₹{(a.capital / 1000).toFixed(0)}K</td>
                            <td className="py-0.5 px-1 text-right text-red-400 font-mono">₹{a.risk.toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Skipped stocks */}
                  {portfolioResult.skipped.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[10px] text-red-400/70 font-semibold mb-0.5 uppercase">Skipped ({portfolioResult.skipped.length})</div>
                      <div className="space-y-0.5">
                        {portfolioResult.skipped.slice(0, 8).map(s => (
                          <div key={s.symbol} className="flex items-center gap-2 text-[10px] text-slate-600">
                            <span className="font-mono w-24">{s.symbol.replace('.NS', '').replace('.BO', '')}</span>
                            <span className="text-slate-700">— {s.reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Signal Narrative Preview */}
            <div className="bg-slate-800/40 rounded-lg p-3">
              <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Signal Narratives (Top 3)</div>
              {(() => {
                const topSignals = filteredResults
                  .filter(r => ['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage) && r.priceEngine.tradeValid)
                  .sort((a, b) => computeConviction(b) - computeConviction(a))
                  .slice(0, 3);
                if (topSignals.length === 0) return <div className="text-xs text-slate-600 py-4 text-center">No BUY signals — run a scan first</div>;
                return (
                  <div className="space-y-3">
                    {topSignals.map(r => {
                      const nar = generateNarrative(r, rsData.get(r.symbol), tfAlignments.get(r.symbol), pivotData.get(r.symbol), detectOnsetCandle(r), computeConviction(r), earningsSeason.warning);
                      return (
                        <div key={r.symbol} className="bg-slate-900/40 rounded-lg p-3 border border-slate-700/50 cursor-pointer hover:border-slate-600" onClick={() => setSelectedSymbol(r.symbol)}>
                          <div className="text-xs text-slate-200 font-semibold mb-1">{nar.headline}</div>
                          <div className="text-[10px] text-slate-400 leading-relaxed mb-1.5">{nar.setup}</div>
                          <div className="text-[10px] text-emerald-400/80 mb-1">{nar.entry}</div>
                          {nar.caution !== 'No specific risk flags identified.' && <div className="text-[10px] text-amber-400/70 mb-1">⚠ {nar.caution}</div>}
                          <div className="flex items-center gap-2">
                            <div className={`text-[10px] font-semibold flex-1 ${nar.verdict.includes('A-grade') ? 'text-[#39FF14]' : nar.verdict.includes('B-grade') ? 'text-yellow-300' : 'text-slate-500'}`}>{nar.verdict}</div>
                            <button onClick={(e) => {
                              e.stopPropagation();
                              const text = `${nar.headline}\n\n${nar.setup}\n\n${nar.entry}\n${nar.caution !== 'No specific risk flags identified.' ? '\n⚠ ' + nar.caution : ''}\n\n${nar.verdict}\n\n— Dr KKR Quant Terminal Pro v9.0`;
                              const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                              const btn = e.currentTarget; btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = '📋 Copy'; }, 2000);
                            }}
                              className="px-2 py-0.5 bg-cyan-900/40 hover:bg-cyan-900/60 border border-cyan-700 rounded text-[10px] font-medium text-cyan-300 transition-colors shrink-0">📋 Copy</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── Trade Log Tab ── */}
        {activeTab === 'tradelog' && (() => {
          const fetchLog = async (sym: string) => {
            setLogLoading(true);
            setLogRows([]);
            try {
              const r = await fetch(`/api/trade-log?symbol=${encodeURIComponent(sym)}`);
              const d = await r.json();
              setLogRows(d.rows ?? []);
            } catch { setLogRows([]); }
            finally { setLogLoading(false); }
          };
          const selectTrade = (sym: string) => { setLogSymbol(sym); fetchLog(sym); };

          const selectedTrade = trackedTrades.find(t => t.symbol === logSymbol);
          const statusChip = (st: string) => {
            const map: Record<string, { label: string; cls: string }> = {
              open:         { label: 'OPEN',    cls: 'bg-amber-900/50 text-amber-300 border-amber-700' },
              hit_t1:       { label: 'T1 HIT',  cls: 'bg-emerald-900/50 text-emerald-300 border-emerald-700' },
              hit_t2:       { label: 'T2 HIT',  cls: 'bg-emerald-800/60 text-emerald-200 border-emerald-600' },
              hit_t3:       { label: 'T3 HIT',  cls: 'bg-green-800/60 text-green-200 border-green-600' },
              stopped:      { label: 'STOPPED', cls: 'bg-red-900/50 text-red-300 border-red-700' },
              expired:      { label: 'EXPIRED', cls: 'bg-slate-700/60 text-slate-400 border-slate-600' },
              manual_close: { label: 'CLOSED',  cls: 'bg-slate-700/60 text-slate-400 border-slate-600' },
              closed_early: { label: 'CLOSED',  cls: 'bg-slate-700/60 text-slate-400 border-slate-600' },
            };
            const m = map[st] ?? { label: st.toUpperCase(), cls: 'bg-slate-700 text-slate-400 border-slate-600' };
            return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${m.cls}`}>{m.label}</span>;
          };

          const eventRowCls = (ev: string | null) => {
            if (!ev) return 'border-b border-slate-800/60 hover:bg-slate-800/30';
            if (ev === 'stopped')  return 'border-b border-red-900/40 bg-red-950/30 hover:bg-red-950/50';
            if (ev === 'expired')  return 'border-b border-slate-700/40 bg-slate-800/30';
            return 'border-b border-emerald-900/40 bg-emerald-950/25 hover:bg-emerald-950/40'; // any hit
          };
          const eventLabel = (ev: string | null) => {
            if (!ev) return null;
            const icons: Record<string, string> = { stopped: '🛑', hit_t1: '🎯', hit_t2: '🎯🎯', hit_t3: '🎯🎯🎯', expired: '⏰' };
            return <span className="font-semibold">{icons[ev] ?? '•'}</span>;
          };
          const pctColor = (v: number) => v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-slate-400';
          const fmt = (v: number, d = 2) => v?.toFixed(d) ?? '—';

          const highCls = (h: number) => {
            if (!selectedTrade) return 'text-slate-300';
            if (selectedTrade.target3 != null && h >= selectedTrade.target3) return 'text-green-300 font-semibold';
            if (selectedTrade.target2 != null && h >= selectedTrade.target2) return 'text-emerald-300 font-semibold';
            if (h >= selectedTrade.target1) return 'text-emerald-400 font-semibold';
            if (h > selectedTrade.entryPrice) return 'text-emerald-600';
            return 'text-slate-400';
          };
          const lowCls = (l: number) => {
            if (!selectedTrade) return 'text-slate-300';
            if (l <= selectedTrade.stopLoss) return 'text-red-300 font-semibold';
            if (l < selectedTrade.entryPrice) return 'text-amber-400';
            return 'text-slate-500';
          };
          const closeCls = (c: number) => {
            if (!selectedTrade) return 'text-slate-200';
            const diff = (c - selectedTrade.entryPrice) / selectedTrade.entryPrice * 100;
            if (diff >= 5) return 'text-emerald-300 font-bold';
            if (diff >= 2) return 'text-emerald-400 font-semibold';
            if (diff > 0) return 'text-emerald-600';
            if (diff >= -1) return 'text-amber-500';
            return 'text-red-400 font-semibold';
          };
          const vsEntryCls = (v: number) => {
            if (v >= 5) return 'text-emerald-300 font-bold';
            if (v >= 2) return 'text-emerald-400 font-semibold';
            if (v > 0) return 'text-emerald-600';
            if (v >= -2) return 'text-amber-500';
            return 'text-red-400 font-semibold';
          };
          const mfeCls = (v: number) => {
            if (v >= 8) return 'text-emerald-200 font-bold';
            if (v >= 5) return 'text-emerald-300 font-semibold';
            if (v >= 3) return 'text-emerald-400';
            if (v >= 1) return 'text-emerald-600';
            return 'text-slate-500';
          };
          const maeCls = (v: number) => {
            if (v >= 8) return 'text-red-200 font-bold';
            if (v >= 5) return 'text-red-300 font-semibold';
            if (v >= 3) return 'text-red-400';
            if (v >= 1) return 'text-red-600';
            return 'text-slate-500';
          };
          const highTag = (h: number) => {
            if (!selectedTrade) return null;
            if (selectedTrade.target3 != null && h >= selectedTrade.target3)
              return <span className="ml-1 text-[9px] font-bold px-1 rounded bg-green-900/60 text-green-300 border border-green-700">T3✓</span>;
            if (selectedTrade.target2 != null && h >= selectedTrade.target2)
              return <span className="ml-1 text-[9px] font-bold px-1 rounded bg-emerald-900/60 text-emerald-300 border border-emerald-700">T2✓</span>;
            if (h >= selectedTrade.target1)
              return <span className="ml-1 text-[9px] font-bold px-1 rounded bg-sky-900/60 text-sky-300 border border-sky-700">T1✓</span>;
            return null;
          };
          const lowTag = (l: number) => {
            if (!selectedTrade) return null;
            if (l <= selectedTrade.stopLoss)
              return <span className="ml-1 text-[9px] font-bold px-1 rounded bg-red-900/60 text-red-300 border border-red-700">SL✗</span>;
            return null;
          };

          const sortedTrades = [...trackedTrades].sort((a, b) => {
            const order = (s: string) => s === 'open' ? 0 : 1;
            if (order(a.status) !== order(b.status)) return order(a.status) - order(b.status);
            return (b.entryDate ?? '').localeCompare(a.entryDate ?? '');
          });

          const statusEmoji = (s: string) => ({ open: '🟡', hit_t1: '🎯', hit_t2: '🎯🎯', hit_t3: '🏆', stopped: '🛑', expired: '⏰', manual_close: '✅', closed_early: '✅' }[s] ?? '•');
          const statusLabel = (s: string) => ({ open: 'OPEN', hit_t1: 'T1 HIT', hit_t2: 'T2 HIT', hit_t3: 'T3 HIT', stopped: 'STOPPED', expired: 'EXPIRED', manual_close: 'CLOSED', closed_early: 'CLOSED' }[s] ?? s.toUpperCase());

          const buildShareText = (trade: typeof selectedTrade, rows: typeof logRows): string => {
            if (!trade) return '';
            const lines: string[] = [];
            const se = statusEmoji(trade.status);
            const sl = statusLabel(trade.status);
            lines.push(`📊 *${trade.symbol}* — Trade Log`);
            lines.push('━━━━━━━━━━━━━━━━━━━━━━━━');
            lines.push(`${se} Status: *${sl}*`);
            lines.push(`📅 Entry ₹${fmt(trade.entryPrice)} on ${trade.entryDate?.slice(0, 10) ?? '—'}`);
            lines.push(`🛑 SL ₹${fmt(trade.stopLoss)}  |  🎯 T1 ₹${fmt(trade.target1)}  |  T2 ₹${fmt(trade.target2)}  |  T3 ₹${fmt(trade.target3 ?? 0)}`);
            if (trade.breakoutTier) lines.push(`⭐ Breakout Tier: ${trade.breakoutTier}`);
            lines.push('');
            lines.push('📈 *Performance Summary*');
            if (trade.mfe != null)    lines.push(`🟢 Peak MFE  : +${fmt(trade.mfe, 1)}%`);
            if (trade.mae != null)    lines.push(`🔴 Worst MAE : -${fmt(trade.mae, 1)}%`);
            if (trade.daysHeld != null) lines.push(`⏱️ Days Held  : ${trade.daysHeld}`);
            if (trade.pnlPct != null) lines.push(`💰 Final P&L  : ${trade.pnlPct >= 0 ? '+' : ''}${fmt(trade.pnlPct, 2)}%`);
            if (rows.length > 0) {
              lines.push('');
              lines.push('📋 *Daily Price Log*');
              lines.push('─────────────────────────────────────────');
              for (const row of rows) {
                const vsE = ((row.close - trade.entryPrice) / trade.entryPrice * 100);
                const vsSign = vsE >= 0 ? '+' : '';
                const dayLine = `D${String(row.day_num).padStart(2)} │ ${row.date} │ H:${fmt(row.high, 0)}  L:${fmt(row.low, 0)}  C:${fmt(row.close, 0)} │ ${vsSign}${fmt(vsE, 1)}% │ MFE ${row.mfe_pct >= 0 ? '+' : ''}${fmt(row.mfe_pct, 1)}% MAE -${fmt(row.mae_pct, 1)}%`;
                if (row.event_type) {
                  const evEmoji = { stopped: '🛑', hit_t1: '🎯', hit_t2: '🎯🎯', hit_t3: '🏆', expired: '⏰' }[row.event_type] ?? '•';
                  lines.push(`${dayLine}  ${evEmoji} ${row.event_detail ?? ''}`);
                } else {
                  lines.push(dayLine);
                }
              }
              lines.push('─────────────────────────────────────────');
            }
            lines.push('');
            lines.push('🤖 _Dr KKR Quant Terminal Pro_ • #NSE #Momentum');
            return lines.join('\n');
          };

          const handleShare = async () => {
            if (!selectedTrade) return;
            const text = buildShareText(selectedTrade, logRows);
            try {
              await navigator.clipboard.writeText(text);
              setLogShareCopied(true);
              setTimeout(() => setLogShareCopied(false), 2500);
            } catch { /* silent */ }
          };

          return (
            <div className="flex-1 flex overflow-hidden min-h-0">
              {/* ── Left: master trade list ── */}
              <div className="w-52 flex-shrink-0 border-r border-slate-800 bg-[#0c1018] overflow-y-auto flex flex-col">
                <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] text-sky-400 font-bold uppercase tracking-wider">Tracked</span>
                  <span className="text-[10px] text-slate-500">{trackedTrades.length} trades</span>
                </div>
                {sortedTrades.length === 0 && (
                  <div className="px-3 py-4 text-[11px] text-slate-600">No trades yet. Run a scan to auto-track BUY signals.</div>
                )}
                {sortedTrades.map(t => (
                  <button key={t.symbol} onClick={() => selectTrade(t.symbol)}
                    className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 border-b border-slate-800/50 transition-colors
                      ${logSymbol === t.symbol ? 'bg-sky-900/25 border-l-2 border-l-sky-500' : 'hover:bg-slate-800/40 border-l-2 border-l-transparent'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-slate-200 tracking-wide">{t.symbol}</span>
                      {statusChip(t.status)}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span>{t.entryDate?.slice(5)}</span>
                      {t.pnlPct != null
                        ? <span className={pctColor(t.pnlPct)}>{t.pnlPct > 0 ? '+' : ''}{fmt(t.pnlPct, 1)}%</span>
                        : t.currentPrice && t.entryPrice
                          ? <span className={pctColor((t.currentPrice - t.entryPrice) / t.entryPrice * 100)}>
                              {((t.currentPrice - t.entryPrice) / t.entryPrice * 100) > 0 ? '+' : ''}
                              {fmt((t.currentPrice - t.entryPrice) / t.entryPrice * 100, 1)}%
                            </span>
                          : <span className="text-slate-600">—</span>
                      }
                    </div>
                    {t.status === 'open' && (t.mfe != null || t.mae != null) && (
                      <div className="flex gap-2 text-[9px] text-slate-600">
                        {t.mfe != null && <span className="text-emerald-700">▲{fmt(t.mfe, 1)}%</span>}
                        {t.mae != null && <span className="text-red-800">▼{fmt(t.mae, 1)}%</span>}
                      </div>
                    )}
                  </button>
                ))}
              </div>

              {/* ── Right: daily log table ── */}
              <div className="flex-1 overflow-auto flex flex-col min-w-0">
                {!logSymbol ? (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-slate-600">
                      <div className="text-2xl mb-2">📋</div>
                      <div className="text-sm">Select a trade to view its daily log</div>
                      <div className="text-xs mt-1">Log populates nightly at 19:30 IST after market close</div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Trade header */}
                    {selectedTrade && (
                      <div className="flex-shrink-0 px-4 py-3 border-b border-slate-800 bg-[#0d1117] flex items-center gap-4 flex-wrap">
                        <span className="text-base font-bold text-slate-100">{selectedTrade.symbol}</span>
                        {statusChip(selectedTrade.status)}
                        <span className="text-xs text-slate-500">Entry <span className="text-slate-300">₹{fmt(selectedTrade.entryPrice)}</span> on {selectedTrade.entryDate?.slice(0, 10)}</span>
                        <span className="text-xs text-slate-500">SL <span className="text-red-400">₹{fmt(selectedTrade.stopLoss)}</span></span>
                        <span className="text-xs text-slate-500">T1 <span className="text-emerald-400">₹{fmt(selectedTrade.target1)}</span></span>
                        <span className="text-xs text-slate-500">T2 <span className="text-emerald-300">₹{fmt(selectedTrade.target2)}</span></span>
                        <span className="text-xs text-slate-500">T3 <span className="text-green-300">₹{fmt(selectedTrade.target3)}</span></span>
                        {selectedTrade.breakoutTier && (
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border
                            ${selectedTrade.breakoutTier === 'A+' ? 'bg-emerald-900/50 border-emerald-600 text-emerald-300'
                              : selectedTrade.breakoutTier === 'A' ? 'bg-sky-900/40 border-sky-700 text-sky-300'
                              : 'bg-slate-800 border-slate-600 text-slate-400'}`}>
                            {selectedTrade.breakoutTier}
                          </span>
                        )}
                        {selectedTrade.mfe != null && (
                          <span className="text-xs text-emerald-600">Peak MFE <span className="text-emerald-400 font-semibold">+{fmt(selectedTrade.mfe, 1)}%</span></span>
                        )}
                        {selectedTrade.mae != null && (
                          <span className="text-xs text-red-700">Worst MAE <span className="text-red-400 font-semibold">-{fmt(selectedTrade.mae, 1)}%</span></span>
                        )}
                        {selectedTrade.daysHeld != null && (
                          <span className="text-xs text-slate-500">Days <span className="text-slate-300">{selectedTrade.daysHeld}</span></span>
                        )}
                        <button onClick={handleShare}
                          className={`ml-auto flex-shrink-0 flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-bold border transition-all duration-200
                            ${logShareCopied
                              ? 'bg-emerald-900/50 border-emerald-600 text-emerald-300'
                              : 'bg-sky-900/30 border-sky-700 text-sky-300 hover:bg-sky-800/50 hover:border-sky-500'}`}>
                          {logShareCopied ? '✅ Copied!' : '📤 Share'}
                        </button>
                      </div>
                    )}

                    {/* Table */}
                    {logLoading ? (
                      <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">Loading log…</div>
                    ) : logRows.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center">
                        <div className="text-center text-slate-600">
                          <div className="text-lg mb-1">📭</div>
                          <div className="text-sm">No log yet for {logSymbol}</div>
                          <div className="text-xs mt-1 text-slate-700">Nightly cron runs at 19:30 IST on trading days</div>
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-auto flex-1">
                        <table className="min-w-max w-full text-xs border-separate border-spacing-0">
                          <thead className="sticky top-0 z-10">
                            <tr className="bg-[#0a0f16] text-[10px] uppercase tracking-wider">
                              <th className="px-3 py-2 text-center font-medium border-b border-slate-800 text-slate-600">Day</th>
                              <th className="px-3 py-2 text-left font-medium border-b border-slate-800 text-slate-500">Date</th>
                              <th className="px-3 py-2 text-right font-medium border-b border-slate-800 text-sky-600">Entry ₹</th>
                              <th className="px-3 py-2 text-right font-medium border-b border-slate-800 text-red-700">Stop ₹</th>
                              <th className="px-3 py-2 text-right font-medium border-b border-slate-800 text-slate-500">High</th>
                              <th className="px-3 py-2 text-right font-medium border-b border-slate-800 text-slate-500">Low</th>
                              <th className="px-3 py-2 text-right font-medium border-b border-slate-800 text-slate-500">Close</th>
                              <th className="px-3 py-2 text-right font-medium border-b border-slate-800 text-slate-500">vs Entry</th>
                              <th className="px-3 py-2 text-right font-medium border-b border-slate-800 text-emerald-700">MFE%</th>
                              <th className="px-3 py-2 text-right font-medium border-b border-slate-800 text-red-800">MAE%</th>
                              <th className="px-3 py-2 text-left font-medium border-b border-slate-800 text-slate-500">Event</th>
                            </tr>
                          </thead>
                          <tbody>
                            {logRows.map(row => {
                              const vsEntry = selectedTrade
                                ? (row.close - selectedTrade.entryPrice) / selectedTrade.entryPrice * 100
                                : null;
                              return (
                                <tr key={row.date} className={eventRowCls(row.event_type)}>
                                  <td className="px-3 py-1.5 text-center text-slate-600 font-mono text-[11px]">{row.day_num}</td>
                                  <td className="px-3 py-1.5 text-slate-400 font-mono tabular-nums text-[11px]">{row.date}</td>
                                  {/* Entry — static reference col, sky tinted */}
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-sky-500/70 text-[11px]">
                                    {selectedTrade ? fmt(selectedTrade.entryPrice) : '—'}
                                  </td>
                                  {/* Stop — static reference col, red tinted */}
                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-red-600/70 text-[11px]">
                                    {selectedTrade ? fmt(selectedTrade.stopLoss) : '—'}
                                  </td>
                                  {/* High — green gradient + target chip */}
                                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${highCls(row.high)}`}>
                                    <span className="inline-flex items-center justify-end gap-0.5">
                                      {fmt(row.high)}{highTag(row.high)}
                                    </span>
                                  </td>
                                  {/* Low — amber/red gradient + stop breach chip */}
                                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${lowCls(row.low)}`}>
                                    <span className="inline-flex items-center justify-end gap-0.5">
                                      {fmt(row.low)}{lowTag(row.low)}
                                    </span>
                                  </td>
                                  {/* Close — color encodes position vs entry */}
                                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${closeCls(row.close)}`}>
                                    {fmt(row.close)}
                                  </td>
                                  {/* vs Entry% — intensity gradient */}
                                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${vsEntry != null ? vsEntryCls(vsEntry) : 'text-slate-500'}`}>
                                    {vsEntry != null ? `${vsEntry > 0 ? '+' : ''}${fmt(vsEntry, 2)}%` : '—'}
                                  </td>
                                  {/* MFE — green intensity */}
                                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${mfeCls(row.mfe_pct)}`}>
                                    +{fmt(row.mfe_pct, 2)}%
                                  </td>
                                  {/* MAE — red intensity */}
                                  <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${maeCls(row.mae_pct)}`}>
                                    -{fmt(row.mae_pct, 2)}%
                                  </td>
                                  <td className="px-3 py-1.5 text-left">
                                    <div className="flex items-center gap-1.5">
                                      {eventLabel(row.event_type)}
                                      {row.event_detail && (
                                        <span className={`text-[11px] font-medium
                                          ${row.event_type === 'stopped' ? 'text-red-400'
                                          : row.event_type === 'expired' ? 'text-slate-400'
                                          : 'text-emerald-400'}`}>
                                          {row.event_detail}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── Trade Auto Validation Tab (Scientific Dashboard) ── */}
        {activeTab === 'validation' && (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* ═══════════════════════════════════════════ */}
            {/* SECTION 1: DASHBOARD HEADER                */}
            {/* ═══════════════════════════════════════════ */}
            {(() => {
              const all = trackedTrades;
              const open = all.filter(t => t.status === 'open');
              const closed = all.filter(t => t.status !== 'open');
              const wins = closed.filter(t => (t.pnlPct ?? 0) > 0);
              const losses = closed.filter(t => (t.pnlPct ?? 0) <= 0);
              const hitT1 = closed.filter(t => t.status === 'hit_t1');
              const hitT2 = closed.filter(t => t.status === 'hit_t2');
              const hitT3 = closed.filter(t => t.status === 'hit_t3');
              const stopped = closed.filter(t => t.status === 'stopped');
              const expired = closed.filter(t => t.status === 'expired');

              const avgWinR = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnlR ?? 0), 0) / wins.length : 0;
              const avgLossR = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnlR ?? 0), 0) / losses.length : 0;
              const avgDays = closed.length > 0 ? closed.reduce((s, t) => s + (t.daysHeld ?? 0), 0) / closed.length : 0;
              const avgDaysWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.daysHeld ?? 0), 0) / wins.length : 0;

              const riskTrades = closed.filter(t => t.entryPrice - t.stopLoss > 0);
              const avgMfeR = riskTrades.filter(t => t.highestPrice != null && t.highestPrice > 0).length > 0
                ? riskTrades.filter(t => t.highestPrice != null && t.highestPrice > 0).reduce((s, t) => s + (t.highestPrice! - t.entryPrice) / (t.entryPrice - t.stopLoss), 0) / riskTrades.filter(t => t.highestPrice != null && t.highestPrice > 0).length : 0;
              const avgMaeR = losses.filter(t => t.entryPrice - t.stopLoss > 0).length > 0
                ? losses.filter(t => t.entryPrice - t.stopLoss > 0).reduce((s, t) => s + ((t.pnlPct ?? 0) / 100 * t.entryPrice) / (t.entryPrice - t.stopLoss), 0) / losses.filter(t => t.entryPrice - t.stopLoss > 0).length : 0;

              return (
                <>
                  <div className="bg-slate-800/30 rounded-lg px-4 py-2.5 -mx-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-bold text-slate-200 tracking-wider">🔬 Trade Auto Validation</h2>
                        <div className="text-[10px] text-slate-500 mt-0.5">{all.length} trades · {open.length} open · {closed.length} closed · Partial exit (50/30/20)</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-600">Level 3 Bar-by-bar · Stop before target</div>
                        {/* #1: Last validated timestamp */}
                        <div className="text-[10px] text-slate-500">Last validated: <span className="text-slate-400 font-mono">{scanEndTime || '—'}</span></div>
                        {/* Tear Sheet Export buttons */}
                        <div className="flex gap-1 mt-1">
                          <button onClick={() => { const d = buildTearSheetData(trackedTrades, accountSize); exportTearSheetPDF(d); }}
                            disabled={trackedTrades.length === 0}
                            data-tip="Export trade tear sheet as PDF — full summary + trade log" data-tip-color="red"
                            className="h-5 px-2 bg-red-900/40 hover:bg-red-900/60 border border-red-700 rounded text-[9px] font-semibold text-red-300 disabled:opacity-40 transition-colors">📄 Tear Sheet PDF</button>
                          <button onClick={() => { const d = buildTearSheetData(trackedTrades, accountSize); exportTearSheetXLSX(d); }}
                            disabled={trackedTrades.length === 0}
                            data-tip="Export trade tear sheet as Excel — multi-sheet workbook" data-tip-color="green"
                            className="h-5 px-2 bg-emerald-900/40 hover:bg-emerald-900/60 border border-emerald-700 rounded text-[9px] font-semibold text-emerald-300 disabled:opacity-40 transition-colors">📊 Tear Sheet XLSX</button>
                          <button
                            disabled={scanning || trackedTrades.filter(t => t.status === 'open').length === 0}
                            onClick={async () => {
                              if (scanningRef.current) return;
                              // Include stopped/partial-exit trades: false-stop recovery + live mark-to-market
                              const openTrades = trackedTradesRef.current.filter(t => t.status === 'open' || t.status === 'stopped' || t.status === 'hit_t1' || t.status === 'hit_t2');
                              if (openTrades.length === 0) return;
                              setScanning(true); scanningRef.current = true; setProgress(0); setTotal(openTrades.length);
                              try {
                                const updated = [...trackedTradesRef.current];
                                let validated = 0;
                                const tgConfig = loadTelegramConfig();
                                for (const t of openTrades) {
                                  try {
                                    const { candles } = await fetchOHLCVClient(t.symbol);
                                    if (candles.length > 0) {
                                      const idx = updated.findIndex(u => u.symbol === t.symbol);
                                      const entryDateStr3 = t.entryDate;
                                      if (!entryDateStr3) { setProgress(p => p + 1); continue; }
                                      const sinceEntry = candles.filter(c => new Date((c.ts + 19800) * 1000).toISOString().slice(0, 10) > entryDateStr3);
                                      if (sinceEntry.length === 0) { setProgress(p => p + 1); continue; }
                                      const result = validateTrade(updated[idx >= 0 ? idx : 0], sinceEntry);
                                      if (idx >= 0) {
                                        let u = applyValidation(updated[idx], result);
                                        const lastCandle = candles[candles.length - 1];
                                        if (lastCandle && lastCandle.c > 0) {
                                          const latestCmpDate3 = new Date((lastCandle.ts + 19800) * 1000).toISOString().slice(0, 10);
                                          u = { ...u, currentPrice: lastCandle.c, cmpDate: latestCmpDate3 };
                                        }
                                        const maxH = Math.max(...sinceEntry.map(c => c.h));
                                        if (maxH > (u.highestPrice ?? 0)) u = { ...u, highestPrice: maxH };
                                        updated[idx] = u;
                                        validated++;
                                      }
                                    }
                                  } catch {}
                                  setProgress(p => p + 1);
                                }
                                const prev = trackedTradesRef.current;
                                for (const u of updated) {
                                  const p = prev.find(x => x.symbol === u.symbol);
                                  if (!p || p.status !== 'open') continue;
                                  if (tgConfig.enabled) {
                                    if ((u.status === 'hit_t1' || u.status === 'hit_t2' || u.status === 'hit_t3') && tgConfig.alerts.targetHit) sendTelegramMessage(tgConfig, formatTargetHitAlert(u));
                                    if (u.status === 'stopped' && tgConfig.alerts.stopped) sendTelegramMessage(tgConfig, formatStoppedAlert(u));
                                  }
                                }
                                setTrackedTrades(updated);
                                setValidateFlash(validated);
                                setTimeout(() => setValidateFlash(0), 3000);
                                if (tgConfig.enabled && tgConfig.alerts.validationSummary && validated > 0) {
                                  const summaryMsg = formatValidationSummaryAlert(updated);
                                  if (summaryMsg) sendTelegramMessage(tgConfig, summaryMsg);
                                }
                              } catch {} finally { setScanning(false); scanningRef.current = false; }
                            }}
                            className="h-5 px-3 bg-cyan-900/50 hover:bg-cyan-900/70 disabled:opacity-40 border border-cyan-500 rounded text-[9px] font-bold text-cyan-200 transition-colors">
                            {scanning ? `🔬 ${progress}/${total}` : validateFlash > 0 ? `✓ ${validateFlash} validated` : `🔬 Validate (${trackedTrades.filter(t => t.status === 'open').length})`}
                          </button>
                          <span className="text-[9px] text-slate-600">{trackedTrades.length} tracked</span>
                          <button onClick={() => {
                            const json = JSON.stringify(trackedTrades, null, 2);
                            const blob = new Blob([json], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a'); a.href = url;
                            a.download = `DrKKR_Trades_Backup_${new Date().toISOString().slice(0, 10)}.json`;
                            a.click(); URL.revokeObjectURL(url);
                          }} disabled={trackedTrades.length === 0}
                            className="h-5 px-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-600 rounded text-[9px] text-slate-400 transition-colors">💾 Export</button>
                          <button onClick={() => {
                            const input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
                            input.onchange = (e) => {
                              const file = (e.target as HTMLInputElement).files?.[0];
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = (ev) => {
                                try {
                                  const parsed = JSON.parse(ev.target?.result as string);
                                  if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].entryPrice) {
                                    if (confirm(`Restore ${parsed.length} trades? This will REPLACE current ${trackedTrades.length} trades.`)) {
                                      deleteAllTradesFromCloud(); // purge old cloud rows before seeding
                                      setTrackedTrades(parsed);
                                    }
                                  } else { alert('Invalid trade backup file'); }
                                } catch { alert('Failed to parse backup file'); }
                              };
                              reader.readAsText(file);
                            };
                            input.click();
                          }}
                            className="h-5 px-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded text-[9px] text-slate-400 transition-colors">📂 Import</button>
                        </div>
                      </div>
                    </div>
                    {/* #2: Traffic light + #6: Portfolio heat + #4: P&L in rupees */}
                    {open.length > 0 && (
                      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-700/30 text-[10px]">
                        {/* Traffic light */}
                        {(() => {
                          const openWithPrice = open.filter(t => t.currentPrice && t.entryPrice > 0);
                          const profitable = openWithPrice.filter(t => (t.currentPrice ?? 0) >= t.entryPrice).length;
                          const losing = openWithPrice.length - profitable;
                          const light = openWithPrice.length === 0 ? '⚪' : losing === 0 ? '🟢' : profitable === 0 ? '🔴' : '🟡';
                          const label = openWithPrice.length === 0 ? 'No CMP data' : losing === 0 ? 'All profitable' : profitable === 0 ? 'All losing' : `${profitable} green, ${losing} red`;
                          return <span className={`font-semibold ${losing === 0 ? 'text-emerald-400' : profitable === 0 ? 'text-red-400' : 'text-yellow-300'}`}>{light} {label}</span>;
                        })()}
                        <span className="text-slate-700">|</span>
                        {/* Portfolio heat */}
                        {(() => {
                          const deployed = open.reduce((s, t) => s + t.entryPrice, 0);
                          const deployedPct = accountSize > 0 ? (deployed / accountSize * 100) : 0;
                          const maxPos = 5;
                          const room = maxPos - open.length;
                          return <span className="text-slate-500">Deployed: ₹{(deployed/1000).toFixed(0)}K ({deployedPct.toFixed(1)}% of ₹{(accountSize/100000).toFixed(0)}L) · Room for {room > 0 ? room : 0} more</span>;
                        })()}
                        <span className="text-slate-700">|</span>
                        {/* Total realized P&L in rupees */}
                        {(() => {
                          const realizedPnl = closed.reduce((s, t) => {
                            const rps = t.entryPrice - t.stopLoss;
                            const riskAmt = accountSize * 0.01;
                            return s + (rps > 0 ? riskAmt * (t.pnlR ?? 0) : 0);
                          }, 0);
                          return <span className={`font-mono font-semibold ${realizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>Realized: {realizedPnl >= 0 ? '+' : ''}₹{Math.abs(realizedPnl).toFixed(0)}</span>;
                        })()}
                      </div>
                    )}
                  </div>

                  {/* P3: Stale validation reminder — open trades only get marked
                      stopped/hit/expired when you click Validate. Miss a session
                      and a stop-out sits stale while Brain's form EMA trains on
                      outdated outcomes. */}
                  {(() => {
                    if (open.length === 0) return null;
                    const todayDow = new Date().getDay();
                    if (todayDow === 0 || todayDow === 6) return null; // skip weekends, market's closed anyway
                    const msPerDay = 86400000;
                    const staleTrades = open.filter(t => {
                      const lastChecked = t.lastCheckDate || t.entryDate;
                      if (!lastChecked) return false;
                      const days = (Date.now() - new Date(lastChecked).getTime()) / msPerDay;
                      return days >= 1.5; // >1 trading day stale
                    });
                    if (staleTrades.length === 0) return null;
                    return (
                      <div className="text-[10px] px-3 py-1.5 rounded-lg flex items-center gap-2 bg-cyan-900/20 border border-cyan-800/40 text-cyan-300">
                        <span className="font-bold">🔬</span>
                        <span>{staleTrades.length} open trade{staleTrades.length > 1 ? 's' : ''} not validated in 1+ trading days — hit Validate to keep stops/targets and Brain's form score current</span>
                      </div>
                    );
                  })()}

                  {/* #7: Alerts for trades near stop */}
                  {(() => {
                    const alerts: Array<{symbol: string; msg: string; severity: 'danger' | 'warning'}> = [];
                    for (const t of open) {
                      if (!t.currentPrice || t.entryPrice <= 0) continue;
                      const rps = t.entryPrice - t.stopLoss;
                      if (rps <= 0) continue;
                      const distToStop = t.currentPrice - t.stopLoss;
                      const distPct = (distToStop / t.currentPrice) * 100;
                      if (distPct <= 1.0) alerts.push({ symbol: t.symbol, msg: `within ${distPct.toFixed(1)}% of stop (₹${t.stopLoss.toFixed(0)})`, severity: 'danger' });
                      else if (distPct <= 2.0) alerts.push({ symbol: t.symbol, msg: `${distPct.toFixed(1)}% above stop — approaching danger zone`, severity: 'warning' });

                      // #3: Near T1 alert
                      if (t.target1 > 0 && t.currentPrice > 0) {
                        const toT1 = ((t.target1 - t.currentPrice) / t.currentPrice) * 100;
                        if (toT1 > 0 && toT1 <= 1.5) alerts.push({ symbol: t.symbol, msg: `only ${toT1.toFixed(1)}% from T1 (₹${t.target1.toFixed(0)}) — watch closely`, severity: 'warning' });
                      }
                    }
                    if (alerts.length === 0) return null;
                    return (
                      <div className="space-y-1">
                        {alerts.map((a, i) => (
                          <div key={i} className={`text-[10px] px-3 py-1.5 rounded-lg flex items-center gap-2 ${a.severity === 'danger' ? 'bg-red-900/30 border border-red-800/50 text-red-300' : 'bg-amber-900/20 border border-amber-800/30 text-amber-300'}`}>
                            <span className="font-bold">{a.severity === 'danger' ? '🚨' : '⚠'}</span>
                            <span className="font-mono font-semibold">{a.symbol.replace('.NS','').replace('.BO','')}</span>
                            <span>{a.msg}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {/* KPI Row */}
                  <div className="grid grid-cols-6 gap-2">
                    {[
                      { label: 'Total Trades', value: String(all.length), sub: `${open.length} open · ${closed.length} closed`, color: 'text-slate-200' },
                      { label: 'Win Rate', value: closed.length > 0 ? `${(wins.length / closed.length * 100).toFixed(0)}%` : '—', sub: `${wins.length}W / ${losses.length}L`, color: closed.length > 0 && wins.length / closed.length >= 0.55 ? 'text-emerald-400' : closed.length > 0 && wins.length / closed.length >= 0.4 ? 'text-amber-400' : 'text-red-400' },
                      { label: 'Avg Win R', value: avgWinR > 0 ? `+${avgWinR.toFixed(2)}R` : '—', sub: `Avg Loss: -${avgLossR.toFixed(2)}R`, color: 'text-emerald-400' },
                      { label: 'Avg MFE-R', value: avgMfeR > 0 ? `+${avgMfeR.toFixed(2)}R` : '—', sub: 'Best price in R', color: 'text-emerald-300' },
                      { label: 'Avg MAE-R', value: avgMaeR < 0 ? `${avgMaeR.toFixed(2)}R` : '—', sub: 'Worst drawdown in R', color: 'text-red-300' },
                      { label: 'Avg Days', value: avgDays > 0 ? `${avgDays.toFixed(1)}d` : '—', sub: avgDaysWin > 0 ? `Winners: ${avgDaysWin.toFixed(1)}d` : '', color: 'text-slate-300' },
                    ].map((kpi, i) => (
                      <div key={i} className="bg-slate-800/40 rounded-lg px-3 py-2 text-center">
                        <div className="text-[10px] text-slate-500 uppercase tracking-wider">{kpi.label}</div>
                        <div className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</div>
                        <div className="text-[10px] text-slate-600">{kpi.sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* #1: Open positions unrealized P&L summary */}
                  {open.length > 0 && (
                    <div className="bg-slate-800/40 rounded-lg px-3 py-2 flex items-center gap-4 text-xs">
                      <span className="text-slate-500 font-semibold">Open Positions ({open.length}):</span>
                      {(() => {
                        const unrealPnls = open.filter(t => t.currentPrice && t.entryPrice > 0).map(t => ((t.currentPrice! - t.entryPrice) / t.entryPrice) * 100);
                        const avgUnreal = unrealPnls.length > 0 ? unrealPnls.reduce((s, v) => s + v, 0) / unrealPnls.length : 0;
                        const totalRisk = open.reduce((s, t) => s + Math.max(t.entryPrice - t.stopLoss, 0), 0);
                        return <>
                          <span className={`font-mono font-semibold ${avgUnreal >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>Avg P&L: {avgUnreal >= 0 ? '+' : ''}{avgUnreal.toFixed(2)}%</span>
                          <span className="text-red-400 font-mono">At risk: ₹{totalRisk.toFixed(0)}</span>
                          {unrealPnls.length > 0 && <span className="text-slate-500">Range: {Math.min(...unrealPnls).toFixed(1)}% to {Math.max(...unrealPnls) >= 0 ? '+' : ''}{Math.max(...unrealPnls).toFixed(1)}%</span>}
                        </>;
                      })()}
                    </div>
                  )}

                  {/* Outcome Breakdown — #4: with profit from each hit */}
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { label: 'T1 Hit', count: hitT1.length, profit: hitT1.reduce((s, t) => s + (t.pnlPct ?? 0), 0), color: 'bg-emerald-900/30 border-emerald-800 text-emerald-400' },
                      { label: 'T2 Hit', count: hitT2.length, profit: hitT2.reduce((s, t) => s + (t.pnlPct ?? 0), 0), color: 'bg-emerald-900/30 border-emerald-800 text-emerald-300' },
                      { label: 'T3 Hit', count: hitT3.length, profit: hitT3.reduce((s, t) => s + (t.pnlPct ?? 0), 0), color: 'bg-yellow-900/30 border-yellow-800 text-yellow-300' },
                      { label: 'Stopped', count: stopped.length, profit: stopped.reduce((s, t) => s + (t.pnlPct ?? 0), 0), color: 'bg-red-900/30 border-red-800 text-red-400' },
                      { label: 'Expired', count: expired.length, profit: expired.reduce((s, t) => s + (t.pnlPct ?? 0), 0), color: 'bg-amber-900/30 border-amber-800 text-amber-400' },
                    ].map((o, i) => (
                      <div key={i} className={`rounded-lg border px-3 py-2 text-center ${o.color}`}>
                        <div className="text-2xl font-bold">{o.count}</div>
                        <div className="text-[10px] uppercase tracking-wider opacity-70">{o.label}</div>
                        {o.count > 0 && <div className="text-[10px] font-mono mt-0.5">{o.profit >= 0 ? '+' : ''}{o.profit.toFixed(1)}%</div>}
                      </div>
                    ))}
                  </div>

                  {/* #5: Best / Worst trade highlight */}
                  {closed.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {(() => {
                        const best = closed.reduce((b, t) => (t.pnlPct ?? 0) > (b.pnlPct ?? 0) ? t : b, closed[0]);
                        const worst = closed.reduce((w, t) => (t.pnlPct ?? 0) < (w.pnlPct ?? 0) ? t : w, closed[0]);
                        return <>
                          <div className="bg-emerald-900/20 border border-emerald-800/30 rounded-lg px-3 py-2 text-xs">
                            <div className="text-[10px] text-emerald-500 font-semibold uppercase">Best Trade</div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="font-mono text-emerald-400 font-bold">{best.symbol.replace('.NS','').replace('.BO','')}</span>
                              <span className="text-emerald-300 font-mono">+{(best.pnlPct ?? 0).toFixed(2)}%</span>
                              <span className="text-emerald-400/60 font-mono">+{(best.pnlR ?? 0).toFixed(1)}R</span>
                              <span className="text-slate-500 ml-auto">{best.daysHeld ?? 0}d</span>
                            </div>
                          </div>
                          {worst !== best && (
                            <div className="bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2 text-xs">
                              <div className="text-[10px] text-red-500 font-semibold uppercase">Worst Trade</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="font-mono text-red-400 font-bold">{worst.symbol.replace('.NS','').replace('.BO','')}</span>
                                <span className="text-red-300 font-mono">{(worst.pnlPct ?? 0).toFixed(2)}%</span>
                                <span className="text-red-400/60 font-mono">{(worst.pnlR ?? 0).toFixed(1)}R</span>
                                <span className="text-slate-500 ml-auto">{worst.daysHeld ?? 0}d</span>
                              </div>
                            </div>
                          )}
                        </>;
                      })()}
                    </div>
                  )}

                  {/* ═══════════════════════════════════════════ */}
                  {/* SECTION 2: ROLLING PERFORMANCE            */}
                  {/* ═══════════════════════════════════════════ */}
                  <div className="bg-slate-800/40 rounded-lg p-3">
                    <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2 flex items-center gap-2"><span className="w-1 h-4 bg-cyan-500 rounded-full"></span>Rolling Performance</div>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        computeRollingStats(trackedTrades, 10, 'Last 10'),
                        computeRollingStats(trackedTrades, 20, 'Last 20'),
                        computeRollingStats(trackedTrades, 999, 'All Time'),
                      ].filter(s => s.total > 0).map(s => {
                        const slicedTrades = trackedTrades.filter(tt => tt.status !== 'open').slice(-(s.period === 'Last 10' ? 10 : s.period === 'Last 20' ? 20 : 999));
                        const rt = slicedTrades.filter(tt => tt.entryPrice - tt.stopLoss > 0);
                        const sMfeR = rt.filter(tt => tt.highestPrice != null && tt.highestPrice > 0).length > 0 ? rt.filter(tt => tt.highestPrice != null && tt.highestPrice > 0).reduce((sum, tt) => sum + (tt.highestPrice! - tt.entryPrice) / (tt.entryPrice - tt.stopLoss), 0) / rt.filter(tt => tt.highestPrice != null && tt.highestPrice > 0).length : 0;
                        const sLosers = slicedTrades.filter(tt => (tt.pnlPct ?? 0) < 0 && tt.entryPrice - tt.stopLoss > 0);
                        const sMaeR = sLosers.length > 0 ? sLosers.reduce((sum, tt) => sum + ((tt.pnlPct ?? 0) / 100 * tt.entryPrice) / (tt.entryPrice - tt.stopLoss), 0) / sLosers.length : 0;
                        return (
                          <div key={s.period} className="bg-slate-900/40 rounded px-3 py-2 text-xs">
                            <div className="text-slate-400 font-semibold mb-1.5">{s.period}</div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                              <span className="text-slate-500">Win Rate</span>
                              <span className={`text-right font-mono font-semibold ${s.winRate >= 55 ? 'text-emerald-400' : s.winRate >= 40 ? 'text-amber-400' : 'text-red-400'}`}>{s.winRate.toFixed(0)}%</span>
                              <span className="text-slate-500">Record</span>
                              <span className="text-right text-slate-300">{s.wins}W / {s.losses}L</span>
                              <span className="text-slate-500">Avg Days</span>
                              <span className="text-right text-slate-300">{s.avgTimeToTarget > 0 ? `${s.avgTimeToTarget.toFixed(1)}d` : '—'}</span>
                              <span className="text-slate-500">MFE%</span>
                              <span className="text-right text-emerald-400">{s.avgMFE > 0 ? `+${s.avgMFE.toFixed(1)}%` : '—'}</span>
                              <span className="text-slate-500">MFE-R</span>
                              <span className="text-right text-emerald-300 font-mono">{sMfeR > 0 ? `+${sMfeR.toFixed(1)}R` : '—'}</span>
                              <span className="text-slate-500">MAE%</span>
                              <span className="text-right text-red-400">{s.avgMAE > 0 ? `-${s.avgMAE.toFixed(1)}%` : '—'}</span>
                              <span className="text-slate-500">MAE-R</span>
                              <span className="text-right text-red-300 font-mono">{sMaeR < 0 ? `${sMaeR.toFixed(1)}R` : '—'}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Full Trade Log */}
                  {/* ═══════════════════════════════════════════ */}
                  {/* SECTION 3: TRADE LOG                      */}
                  {/* ═══════════════════════════════════════════ */}
                  <div className="bg-slate-800/40 rounded-lg p-3">
                    <div className="flex items-center mb-2">
                      <span className="text-xs text-slate-400 font-bold uppercase tracking-wider flex items-center gap-2"><span className="w-1 h-4 bg-emerald-500 rounded-full"></span>Trade Log ({all.length} trades)</span>
                      {all.length > 0 && (
                        <button onClick={() => { if (confirm('Remove ALL tracked trades?')) { deleteAllTradesFromCloud(); setTrackedTrades([]); } }}
                          className="text-xs text-red-600 hover:text-red-400 ml-auto transition-colors">Clear All</button>
                      )}
                    </div>
                    {all.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs whitespace-nowrap">
                          <thead><tr className="border-b border-slate-700 text-slate-500">
                            <th className="px-2 py-1 text-left font-medium">Symbol</th>
                            <th className="px-2 py-1 text-left font-medium">Stage</th>
                            <th className="px-2 py-1 text-right font-medium">Entry</th>
                            <th className="px-2 py-1 text-right font-medium">SL</th>
                            <th className="px-2 py-1 text-right font-medium">T1</th>
                            <th className="px-2 py-1 text-right font-medium">T2</th>
                            <th className="px-2 py-1 text-right font-medium">T3</th>
                            <th className="px-2 py-1 text-right font-medium">Risk/sh</th>
                            <th className="px-2 py-1 text-left font-medium">Entry Dt</th>
                            <th className="px-2 py-1 text-right font-medium">CMP/Exit</th>
                            <th className="px-2 py-1 text-right font-medium">Planned R:R</th>
                            <th className="px-2 py-1 text-right font-medium">P&L%</th>
                            <th className="px-2 py-1 text-right font-medium">P&L R</th>
                            <th className="px-2 py-1 text-right font-medium">MFE%</th>
                            <th className="px-2 py-1 text-right font-medium">MFE-R</th>
                            <th className="px-2 py-1 text-right font-medium">MAE%</th>
                            <th className="px-2 py-1 text-right font-medium">MAE-R</th>
                            <th className="px-2 py-1 text-right font-medium">Days</th>
                            <th className="px-2 py-1 text-center font-medium">Expiry</th>
                            <th className="px-2 py-1 text-center font-medium">Outcome</th>
                            <th className="px-2 py-1 text-center font-medium cursor-help" title="10-Gate Cascade (Phase-3 calibrated, v6)&#10;Stop: max(1.5×ATR, 5-bar swing low×0.997) clamped [2.5%,6.5%]&#10;G-GAP: gap-down → instant exit at open&#10;G0: Wyckoff Spring — dip &lt;0.5×ATR deep + close above stop&#10;G1: RSI-2 &lt;25 Capitulation flush&#10;G2: 2-Day Confirm — first day low-vol OR narrow bar (&lt;0.7×ATR)&#10;G3: Hammer — lower wick ≥40%, close loc ≥55%&#10;G4: OBV 5d slope rising (accumulation)&#10;G5: Narrow Sweep — range &lt;0.75×ATR + close above stop&#10;G6: Low-Vol Sweep — vol &lt;0.65×avg + close above stop&#10;G7: Isolated Red — prev candle was green&#10;G8: Close Recovery — recovered &gt;60% of stop-to-low range&#10;G9: Structure OK — close ≥ 5-bar swing low × 0.997&#10;🛡 = shielded (false stop), 🛑 = all gates passed (real stop)">Gate Status</th>
                            <th className="px-2 py-1 text-left font-medium">Exit Model</th>
                            <th className="px-2 py-1 text-left font-medium">Sector</th>
                            <th className="px-2 py-1 text-right font-medium">Conv</th>
                            <th className="px-2 py-1 text-left font-medium">Closed Dt</th>
                            <th className="px-1 py-1 w-6"></th>
                          </tr></thead>
                          <tbody>
                            {[...all].sort((a, b) => {
                              if (a.status === 'open' && b.status !== 'open') return -1;
                              if (a.status !== 'open' && b.status === 'open') return 1;
                              return 0;
                            }).map((t, i) => {
                              const rps = t.entryPrice - t.stopLoss;
                              const mfePct = t.highestPrice && t.entryPrice > 0 ? ((t.highestPrice - t.entryPrice) / t.entryPrice) * 100 : 0;
                              const mfeR = t.highestPrice && rps > 0 ? (t.highestPrice - t.entryPrice) / rps : 0;
                              const curPrice = t.closedPrice ?? t.currentPrice ?? 0;
                              const curPnl = curPrice > 0 && t.entryPrice > 0 ? ((curPrice - t.entryPrice) / t.entryPrice) * 100 : (t.pnlPct ?? 0);
                              const curR = rps > 0 && curPrice > 0 ? (curPrice - t.entryPrice) / rps : (t.pnlR ?? 0);
                              const maePct = t.status !== 'open' && (t.pnlPct ?? 0) < 0 ? (t.pnlPct ?? 0) : (t.status === 'open' && curPnl < 0 ? curPnl : 0);
                              const maeR = rps > 0 && maePct < 0 ? (maePct / 100 * t.entryPrice) / rps : 0;
                              const daysLeft = 20 - (t.daysHeld ?? 0);

                              const statusCfg: Record<string, { label: string; color: string }> = {
                                open: { label: 'OPEN', color: 'bg-blue-900/40 text-blue-300' },
                                hit_t1: { label: '✓ T1', color: 'bg-emerald-900/40 text-emerald-300' },
                                hit_t2: { label: '✓ T2', color: 'bg-emerald-900/40 text-emerald-200' },
                                hit_t3: { label: '✓ T3', color: 'bg-yellow-900/40 text-yellow-300' },
                                stopped: { label: '✗ SL', color: 'bg-red-900/40 text-red-300' },
                                expired: { label: '⏳ EXP', color: 'bg-amber-900/40 text-amber-300' },
                                manual_close: { label: '◉ MAN', color: 'bg-slate-700/40 text-slate-300' },
                                closed_early: { label: '↗ EXIT', color: 'bg-cyan-900/40 text-cyan-300' },
                              };
                              const sc = statusCfg[t.status] ?? { label: t.status, color: 'bg-slate-700 text-slate-400' };
                              const stgCfg = STAGE_CONFIG[t.stage];

                              return (
                                <tr key={i} className={`border-b border-slate-800/30 group ${t.status === 'open' ? 'bg-slate-800/20' : ''}`}>
                                  <td className="px-2 py-1.5 font-mono text-slate-200 font-semibold">{t.symbol}</td>
                                  <td className={`px-2 py-1.5 ${stgCfg?.color ?? 'text-slate-500'}`}>{stgCfg?.label ?? t.stage}</td>
                                  <td className="px-2 py-1.5 text-right font-mono text-slate-300">₹{t.entryPrice.toFixed(2)}</td>
                                  <td className="px-2 py-1.5 text-right font-mono text-red-400">₹{t.stopLoss.toFixed(2)}</td>
                                  <td className="px-2 py-1.5 text-right font-mono text-emerald-400">₹{t.target1.toFixed(2)}</td>
                                  <td className="px-2 py-1.5 text-right font-mono text-emerald-500">{t.target2 > 0 ? `₹${t.target2.toFixed(0)}` : '—'}</td>
                                  <td className="px-2 py-1.5 text-right font-mono text-yellow-400">{t.target3 > 0 ? `₹${t.target3.toFixed(0)}` : '—'}</td>
                                  <td className="px-2 py-1.5 text-right font-mono text-slate-400">₹{rps.toFixed(2)}</td>
                                  <td className="px-2 py-1.5 text-slate-500">{t.entryDate}</td>
                                  <td className={`px-2 py-1.5 text-right font-mono ${t.status === 'open' ? 'text-slate-300' : 'text-slate-400'}`}>{curPrice > 0 ? `₹${curPrice.toFixed(2)}` : '—'}</td>
                                  {(() => {
                                    const rrBase = t.target2 > t.entryPrice ? t.target2 : t.target1;
                                    const plannedRR = rps > 0 && rrBase > t.entryPrice ? (rrBase - t.entryPrice) / rps : 0;
                                    const rrColor = plannedRR >= 2.0 ? 'text-cyan-300 font-semibold' : plannedRR >= 1.5 ? 'text-emerald-400 font-semibold' : plannedRR >= 1.2 ? 'text-emerald-400' : plannedRR > 0 ? 'text-amber-400' : 'text-slate-600';
                                    return <td className={`px-2 py-1.5 text-right font-mono ${rrColor}`} title={`Planned R:R at T2 = T2 gain / stop risk. Baseline: 2.0 (Phase-3 stop engine — max(1.5×ATR, 5-bar low×0.997))`}>{plannedRR > 0 ? `${plannedRR.toFixed(2)}R` : '—'}</td>;
                                  })()}
                                  <td className={`px-2 py-1.5 text-right font-mono font-semibold ${curPnl > 0 ? 'text-emerald-400' : curPnl < 0 ? 'text-red-400' : 'text-slate-500'}`}>{curPrice > 0 ? `${curPnl >= 0 ? '+' : ''}${curPnl.toFixed(2)}%` : '—'}</td>
                                  <td className={`px-2 py-1.5 text-right font-mono ${curR > 0 ? 'text-emerald-300' : curR < 0 ? 'text-red-300' : 'text-slate-500'}`}>{curPrice > 0 ? `${curR >= 0 ? '+' : ''}${curR.toFixed(2)}R` : '—'}</td>
                                  <td className={`px-2 py-1.5 text-right font-mono ${mfePct > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>{mfePct > 0 ? `+${mfePct.toFixed(2)}%` : '—'}</td>
                                  <td className={`px-2 py-1.5 text-right font-mono ${mfeR > 0 ? 'text-emerald-300' : 'text-slate-600'}`}>{mfeR > 0 ? `+${mfeR.toFixed(2)}R` : '—'}</td>
                                  <td className={`px-2 py-1.5 text-right font-mono ${maePct < 0 ? 'text-red-400' : 'text-slate-600'}`}>{maePct < 0 ? `${maePct.toFixed(2)}%` : '—'}</td>
                                  <td className={`px-2 py-1.5 text-right font-mono ${maeR < 0 ? 'text-red-300' : 'text-slate-600'}`}>{maeR < 0 ? `${maeR.toFixed(2)}R` : '—'}</td>
                                  <td className={`px-2 py-1.5 text-right ${t.status === 'open' && (t.daysHeld ?? 0) >= 8 ? 'text-amber-400' : 'text-slate-500'}`}>{t.daysHeld ?? '—'}{t.status === 'open' && (t.daysHeld ?? 0) >= 8 ? ` ⏳${daysLeft}d` : ''}</td>
                                  {/* #3/#7: Days to expiry countdown */}
                                  <td className="px-2 py-1.5 text-center">{t.status === 'open' ? (() => {
                                    const dl = 20 - (t.daysHeld ?? 0);
                                    const pct = Math.max(0, Math.min(100, ((t.daysHeld ?? 0) / 20) * 100));
                                    return <div className="flex items-center gap-1" title={`Day ${t.daysHeld ?? 0} of 20 — expires in ${dl} days`}>
                                      <div className="w-10 h-1.5 bg-slate-700 rounded-full overflow-hidden"><div className={`h-full rounded-full ${pct >= 80 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{width:`${pct}%`}} /></div>
                                      <span className={`text-[9px] font-mono ${dl <= 2 ? 'text-red-400' : dl <= 5 ? 'text-amber-400' : 'text-slate-500'}`}>{dl}d</span>
                                    </div>;
                                  })() : <span className="text-slate-700">—</span>}</td>
                                  {/* #2: Outcome with tooltip */}
                                  <td className="px-2 py-1.5 text-center"><span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sc.color}`}
                                    title={t.status === 'hit_t1' ? 'T1 hit: 50% booked, SL moved to breakeven' : t.status === 'hit_t2' ? 'T2 hit: 50% at T1 + 30% at T2, SL at T1' : t.status === 'hit_t3' ? 'T3 hit: 50% at T1 + 30% at T2 + 20% at T3 — fully closed' : t.status === 'stopped' ? 'Stop loss triggered — full loss' : t.status === 'expired' ? 'Expired after 20 days — closed at market' : 'Trade is open — monitoring'}>{sc.label}</span></td>
                                  {/* Gate Status */}
                                  <td className="px-2 py-1.5 text-center">{(() => {
                                    const tgLog = t.gateLog;
                                    if (!tgLog || tgLog.length === 0) return <span className="text-[9px] text-slate-700">—</span>;
                                    const shielded = tgLog.filter(e => e.result === 'SHIELDED').length;
                                    const stopped = tgLog.filter(e => e.result === 'STOPPED').length;
                                    const lastEntry = tgLog[tgLog.length - 1];
                                    const blockedGate = lastEntry?.gatesTested?.find(g => !g.passed);
                                    const tipText = tgLog.map(e => `D${e.day}: ${e.result} ${e.dipPct.toFixed(1)}%↓ — ${e.gatesTested.map(g => `${g.passed?'✗':'✓'}${g.gate}`).join(', ')}`).join('\n');
                                    if (stopped > 0) return <span className="text-[9px] font-mono cursor-help" title={tipText}><span className="text-red-400 font-bold">🛑ALL</span>{shielded > 0 && <span className="text-emerald-500"> {shielded}🛡</span>}</span>;
                                    return <span className="text-[9px] font-mono cursor-help" title={tipText}><span className="text-emerald-400 font-bold">{shielded}🛡</span><span className="text-cyan-500 ml-0.5">{blockedGate?.gate?.slice(0,5) || ''}</span></span>;
                                  })()}</td>
                                  {/* #6: Exit model */}
                                  <td className="px-2 py-1.5 text-[9px] text-slate-500">{t.status === 'hit_t1' ? '50% T1 + 50% BE' : t.status === 'hit_t2' ? '50% T1 + 30% T2 + 20% BE' : t.status === 'hit_t3' ? '50% T1 + 30% T2 + 20% T3' : t.status === 'stopped' ? '100% SL' : t.status === 'open' ? '—' : 'Market'}</td>
                                  <td className="px-2 py-1.5 text-slate-600 truncate max-w-[80px]">{t.sector || '—'}</td>
                                  <td className="px-2 py-1.5 text-right text-slate-400">{t.conviction ?? '—'}</td>
                                  <td className="px-2 py-1.5 text-slate-600">{t.closedDate ?? '—'}</td>
                                  <td className="px-1 py-1.5 text-center">
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                      {t.status === 'open' && t.currentPrice && t.entryPrice > 0 && (
                                        <button
                                          onClick={() => {
                                            const exitPnlPct = ((t.currentPrice! - t.entryPrice) / t.entryPrice) * 100;
                                            const exitPricePct = t.target1 > t.entryPrice ? ((t.currentPrice! - t.entryPrice) / (t.target1 - t.entryPrice)) * 100 : 0;
                                            const updated = trackedTrades.map(x => x === t ? { ...x, status: 'closed_early' as const, pnlPct: Math.round(exitPnlPct * 100) / 100, closedPrice: t.currentPrice, closedDate: new Date().toISOString().slice(0, 10), exitPricePct: Math.round(exitPricePct) } : x);
                                            setTrackedTrades(updated); syncTradesToCloud(updated);
                                          }}
                                          className="text-[9px] px-1 py-0.5 rounded bg-cyan-900/40 text-cyan-400 hover:bg-cyan-800/60 font-bold"
                                          title={`Mark closed early at CMP ₹${t.currentPrice?.toFixed(0)} — records exit quality for Brain learning`}>↗ Exit</button>
                                      )}
                                      <button onClick={() => removeTrade(t)} className="text-red-500 hover:text-red-300 transition-all" title="Remove trade">✕</button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-600 py-8 text-center">No tracked trades yet. Track a trade from Scanner or Focus tab to see validation here.</div>
                    )}
                  </div>

                  {/* ══════════════════════════════════════════════════════ */}
                  {/* ═══════════════════════════════════════════ */}
                  {/* SECTION 4: SCIENTIFIC ANALYTICS            */}
                  {/* ═══════════════════════════════════════════ */}
                  <div className="flex items-center gap-2 mt-2"><span className="w-1 h-4 bg-indigo-500 rounded-full"></span><span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Scientific Analytics</span><span className="flex-1 border-t border-slate-700/50"></span></div>

                  {closed.length >= 3 && (<>

                  {/* ROW: Expectancy Curve + R-Distribution side by side */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* #2: Expectancy Curve */}
                    <div className="bg-slate-800/40 rounded-lg p-3">
                      <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Expectancy Curve (Cumulative R)</div>
                      {(() => {
                        const curve = computeExpectancyCurve(trackedTrades);
                        if (curve.length < 2) return <div className="text-xs text-slate-600 py-4 text-center">Need more closed trades</div>;
                        const maxR = Math.max(...curve.map(p => p.cumulativeR), 0.1);
                        const minR = Math.min(...curve.map(p => p.cumulativeR), -0.1);
                        const range = maxR - minR || 1;
                        const h = 120, w = 100;
                        const zeroY = ((maxR) / range) * 100;
                        return (
                          <div className="relative" style={{ height: h }}>
                            <div className="absolute inset-0 border border-slate-700/30 rounded overflow-hidden">
                              {/* Zero line */}
                              <div className="absolute left-0 right-0 border-t border-slate-600/50 border-dashed" style={{ top: `${zeroY}%` }} />
                              {/* Curve */}
                              <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none">
                                <polyline fill="none" stroke={curve[curve.length - 1].cumulativeR >= 0 ? '#22c55e' : '#ef4444'} strokeWidth="2"
                                  points={curve.map((p, i) => `${(i / Math.max(curve.length - 1, 1)) * w},${((maxR - p.cumulativeR) / range) * h}`).join(' ')} />
                              </svg>
                            </div>
                            <div className="absolute top-0 right-1 text-[10px] text-emerald-400">+{maxR.toFixed(1)}R</div>
                            <div className="absolute bottom-0 right-1 text-[10px] text-red-400">{minR.toFixed(1)}R</div>
                            <div className="absolute bottom-0 left-1 text-[10px] text-slate-600">{curve.length - 1} trades</div>
                          </div>
                        );
                      })()}
                      <div className={`text-center text-[10px] mt-1 ${(computeExpectancyCurve(trackedTrades).pop()?.cumulativeR ?? 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                        {(computeExpectancyCurve(trackedTrades).pop()?.cumulativeR ?? 0) >= 0 ? '↑ Positive edge — keep trading' : '↓ Negative edge — review system'}
                      </div>
                    </div>

                    {/* #3: R-Multiple Distribution */}
                    <div className="bg-slate-800/40 rounded-lg p-3">
                      <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">R-Multiple Distribution</div>
                      {(() => {
                        const dist = computeRDistribution(trackedTrades);
                        const maxCount = Math.max(...dist.map(d => d.count), 1);
                        return (
                          <div className="space-y-1">
                            {dist.map(d => (
                              <div key={d.range} className="flex items-center gap-2 text-[10px]">
                                <span className="w-16 text-right text-slate-400 shrink-0">{d.range}</span>
                                <div className="flex-1 bg-slate-800 rounded-full h-4 overflow-hidden">
                                  <div className="h-full rounded-full flex items-center pl-1 text-[9px] font-bold text-white" style={{ width: `${Math.max((d.count / maxCount) * 100, d.count > 0 ? 12 : 0)}%`, backgroundColor: d.color }}>
                                    {d.count > 0 ? d.count : ''}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* #1: MFE/MAE Scatter */}
                  <div className="bg-slate-800/40 rounded-lg p-3">
                    <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">MFE vs MAE Scatter (each dot = 1 trade)</div>
                    {(() => {
                      const points = computeMfeMaeScatter(trackedTrades);
                      if (points.length < 2) return <div className="text-xs text-slate-600 py-4 text-center">Need more closed trades</div>;
                      const maxMfe = Math.max(...points.map(p => p.mfeR), 1);
                      const minMae = Math.min(...points.map(p => p.maeR), -1);
                      return (
                        <div className="relative h-40 border border-slate-700/30 rounded overflow-hidden">
                          {/* Axes */}
                          <div className="absolute bottom-0 left-1/2 top-0 border-l border-slate-600/30" />
                          <div className="absolute left-0 right-0 bottom-1/2 border-t border-slate-600/30" />
                          {/* Labels */}
                          <div className="absolute top-1 left-1 text-[9px] text-slate-600">MFE (profit potential) ↑</div>
                          <div className="absolute bottom-1 right-1 text-[9px] text-slate-600">MAE (drawdown) →</div>
                          {/* Points */}
                          {points.map((p, i) => {
                            const x = 50 + (minMae !== 0 ? (p.maeR / Math.abs(minMae)) * 45 : 0);
                            const y = 95 - (maxMfe > 0 ? (p.mfeR / maxMfe) * 85 : 0);
                            return (
                              <div key={i} title={`${p.symbol}: MFE +${p.mfeR.toFixed(1)}R, MAE ${p.maeR.toFixed(1)}R, P&L ${p.pnlR.toFixed(1)}R`}
                                className={`absolute w-2.5 h-2.5 rounded-full border ${p.winner ? 'bg-emerald-500/70 border-emerald-400' : 'bg-red-500/70 border-red-400'}`}
                                style={{ left: `${Math.max(2, Math.min(98, x))}%`, top: `${Math.max(2, Math.min(98, y))}%`, transform: 'translate(-50%, -50%)' }} />
                            );
                          })}
                        </div>
                      );
                    })()}
                    <div className="flex justify-between text-[9px] text-slate-600 mt-1 px-1">
                      <span>🟢 = winner &nbsp; 🔴 = loser</span>
                      <span>Top-left = high MFE, low MAE (ideal)</span>
                    </div>
                  </div>

                  {/* ROW: Stop/Target Optimization + Conviction */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* #4: Stop & Target Optimization */}
                    <div className="bg-slate-800/40 rounded-lg p-3">
                      <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Target Reach Analysis</div>
                      {(() => {
                        const opt = computeOptimization(trackedTrades);
                        if (!opt) return <div className="text-xs text-slate-600 py-2">Need 5+ closed trades</div>;
                        return (
                          <div className="space-y-1.5">
                            {opt.mfeReachPct.map(m => (
                              <div key={m.rLevel} className="flex items-center gap-2 text-[10px]">
                                <span className="w-8 text-right text-slate-400 font-mono">{m.rLevel}R</span>
                                <div className="flex-1 bg-slate-800 rounded-full h-3.5 overflow-hidden">
                                  <div className={`h-full rounded-full flex items-center justify-end pr-1 text-[9px] font-bold text-white ${m.pctReaching >= 60 ? 'bg-emerald-600' : m.pctReaching >= 40 ? 'bg-yellow-600' : 'bg-red-600'}`}
                                    style={{ width: `${Math.max(m.pctReaching, 8)}%` }}>
                                    {m.pctReaching.toFixed(0)}%
                                  </div>
                                </div>
                              </div>
                            ))}
                            <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-700/50 space-y-0.5">
                              <div>Optimal T1: <b className="text-emerald-400">{opt.optimalT1R}R</b> (60%+ trades reach this)</div>
                              <div>Profit capture: <b className={opt.profitCapturePct >= 50 ? 'text-emerald-400' : 'text-amber-400'}>{opt.profitCapturePct.toFixed(0)}%</b> of available MFE</div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* #7: Conviction vs Outcome */}
                    <div className="bg-slate-800/40 rounded-lg p-3">
                      <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Conviction vs Outcome</div>
                      {(() => {
                        const { points, correlation } = computeConvictionCorrelation(trackedTrades);
                        if (points.length < 3) return <div className="text-xs text-slate-600 py-2">Need 3+ closed trades</div>;
                        return (
                          <div>
                            <div className="relative h-28 border border-slate-700/30 rounded overflow-hidden mb-1">
                              {points.map((p, i) => {
                                const x = Math.max(5, Math.min(95, p.conviction));
                                const maxR = Math.max(...points.map(q => Math.abs(q.pnlR)), 1);
                                const y = 50 - (p.pnlR / maxR) * 45;
                                return (
                                  <div key={i} title={`${p.symbol}: Conv ${p.conviction}, P&L ${p.pnlR.toFixed(1)}R`}
                                    className={`absolute w-2 h-2 rounded-full ${p.winner ? 'bg-emerald-400' : 'bg-red-400'}`}
                                    style={{ left: `${x}%`, top: `${Math.max(2, Math.min(98, y))}%`, transform: 'translate(-50%, -50%)' }} />
                                );
                              })}
                              <div className="absolute bottom-0 left-0 right-0 border-t border-slate-600/30" style={{ top: '50%' }} />
                            </div>
                            <div className="flex justify-between text-[10px]">
                              <span className="text-slate-600">Low conv ← → High conv</span>
                              <span className={`font-semibold ${correlation > 0.3 ? 'text-emerald-400' : correlation > 0 ? 'text-slate-400' : 'text-red-400'}`}>
                                r = {correlation.toFixed(2)} {correlation > 0.3 ? '✓ Scoring works' : correlation < 0 ? '⚠ Inverted!' : '— Weak signal'}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* ROW: Edge Decay + Day of Week + Sector */}
                  <div className="grid grid-cols-3 gap-3">
                    {/* #8: Edge Decay */}
                    <div className="bg-slate-800/40 rounded-lg p-3">
                      <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Edge Trend</div>
                      {(() => {
                        const { points, trending } = computeEdgeDecay(trackedTrades);
                        if (points.length < 2) return <div className="text-xs text-slate-600 py-2">Need 6+ trades</div>;
                        const maxWR = Math.max(...points.map(p => p.winRate), 1);
                        return (
                          <div>
                            <div className="flex items-end gap-px h-16">
                              {points.map((p, i) => (
                                <div key={i} className="flex-1 flex flex-col justify-end" title={`Trade ${p.windowEnd}: ${p.winRate.toFixed(0)}% WR`}>
                                  <div className={`rounded-t ${p.winRate >= 50 ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                                    style={{ height: `${(p.winRate / maxWR) * 100}%`, minHeight: 2 }} />
                                </div>
                              ))}
                            </div>
                            <div className={`text-center text-[10px] mt-1 font-semibold ${trending === 'improving' ? 'text-emerald-400' : trending === 'decaying' ? 'text-red-400' : 'text-slate-400'}`}>
                              {trending === 'improving' ? '↑ Edge improving' : trending === 'decaying' ? '↓ Edge decaying — review system' : '— Edge stable'}
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* #9: Day of Week */}
                    <div className="bg-slate-800/40 rounded-lg p-3">
                      <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Entry Day Analysis</div>
                      {(() => {
                        const days = computeDayOfWeek(trackedTrades);
                        if (days.length === 0) return <div className="text-xs text-slate-600 py-2">Need closed trades</div>;
                        return (
                          <div className="space-y-1">
                            {days.map(d => (
                              <div key={d.day} className="flex items-center gap-2 text-[10px]">
                                <span className="w-6 text-slate-400 font-semibold">{d.day}</span>
                                <div className="flex-1 bg-slate-800 rounded-full h-3 overflow-hidden">
                                  <div className={`h-full rounded-full ${d.winRate >= 60 ? 'bg-emerald-500' : d.winRate >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                    style={{ width: `${Math.max(d.winRate, 5)}%` }} />
                                </div>
                                <span className={`w-10 text-right font-mono ${d.winRate >= 60 ? 'text-emerald-400' : d.winRate >= 40 ? 'text-yellow-300' : 'text-red-400'}`}>{d.winRate.toFixed(0)}%</span>
                                <span className="text-slate-600 w-4 text-right">{d.trades}</span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>

                    {/* #6: Sector Performance */}
                    <div className="bg-slate-800/40 rounded-lg p-3">
                      <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Sector Performance</div>
                      {(() => {
                        const sectors = computeSectorPerformance(trackedTrades);
                        if (sectors.length === 0) return <div className="text-xs text-slate-600 py-2">Need closed trades</div>;
                        return (
                          <div className="space-y-1">
                            {sectors.slice(0, 6).map(s => (
                              <div key={s.sector} className="flex items-center gap-2 text-[10px]">
                                <span className="w-14 text-slate-300 font-semibold truncate">{s.sector}</span>
                                <span className={`w-10 text-right font-mono ${s.winRate >= 60 ? 'text-emerald-400' : s.winRate >= 40 ? 'text-yellow-300' : 'text-red-400'}`}>{s.winRate.toFixed(0)}%</span>
                                <span className={`w-10 text-right font-mono ${s.avgR >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{s.avgR >= 0 ? '+' : ''}{s.avgR.toFixed(1)}R</span>
                                <span className="text-slate-600">{s.trades}t</span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* #5: Regime Performance */}
                  {(() => {
                    const regimes = computeRegimePerformance(trackedTrades);
                    if (regimes.length < 2) return null;
                    return (
                      <div className="bg-slate-800/40 rounded-lg p-3">
                        <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Period Comparison</div>
                        <div className="grid grid-cols-2 gap-3">
                          {regimes.map(r => (
                            <div key={r.regime} className="bg-slate-900/40 rounded px-3 py-2 text-xs">
                              <div className="text-slate-400 font-semibold mb-1">{r.regime}</div>
                              <div className="grid grid-cols-3 gap-2 text-center">
                                <div><div className="text-[10px] text-slate-600">WR</div><div className={`font-bold ${r.winRate >= 55 ? 'text-emerald-400' : 'text-red-400'}`}>{r.winRate.toFixed(0)}%</div></div>
                                <div><div className="text-[10px] text-slate-600">Avg R</div><div className={`font-bold ${r.avgR >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{r.avgR >= 0 ? '+' : ''}{r.avgR.toFixed(2)}R</div></div>
                                <div><div className="text-[10px] text-slate-600">Trades</div><div className="font-bold text-slate-300">{r.trades}</div></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  </>)}

                  {/* ═══════════════════════════════════════════ */}
                  {/* SECTION 5B: WHAT'S WORKING                 */}
                  {/* ═══════════════════════════════════════════ */}
                  {(() => {
                    const closed = trackedTrades.filter(t => t.status !== 'open' && t.pnlPct != null);
                    const signalDefs: Array<{ name: string; icon: string; check: (t: TrackedTrade) => boolean }> = [
                      { name: 'Zone Explosion', icon: '💎', check: t => t.zoneExplosion === 'HIGH_CONVICTION' },
                      { name: 'Zone Confirmed',  icon: '🎯', check: t => t.zoneExplosion === 'CONFIRMED' },
                      { name: 'ATR Explosion',   icon: '💥', check: t => t.atrState === 'EXPLOSION' },
                      { name: 'Vol Thrust',      icon: '🔥', check: t => t.volumeBadge === 'HIGH_CONVICTION' },
                      { name: 'Vol Confirmed',   icon: '✓',  check: t => t.volumeBadge === 'CONFIRMED' },
                      { name: 'Monster MRV',     icon: '👾', check: t => t.monsterBadge === 'MRV' },
                      { name: 'Monster MOM',     icon: '🚀', check: t => t.monsterBadge === 'MOM' },
                      { name: 'Conv 70+',        icon: '⚡', check: t => t.conviction >= 70 },
                      { name: 'EdgeScore 65+',   icon: '📈', check: t => (t.edgeScore ?? 0) >= 65 },
                    ];
                    const rows = signalDefs.map(def => {
                      const matching = closed.filter(def.check);
                      if (matching.length < 2) return null;
                      const wins = matching.filter(t => (t.pnlPct ?? 0) > 0);
                      const wr = (wins.length / matching.length) * 100;
                      const avgPnl = matching.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / matching.length;
                      return { name: def.name, icon: def.icon, n: matching.length, wins: wins.length, wr, avgPnl };
                    }).filter((x): x is { name: string; icon: string; n: number; wins: number; wr: number; avgPnl: number } => x !== null)
                      .sort((a, b) => b.wr - a.wr);
                    return (
                      <div className="bg-slate-800/30 rounded-lg overflow-hidden">
                        <div className="px-3 py-2 bg-slate-800/50 flex items-center gap-2">
                          <span className="text-xs text-slate-300 font-semibold">📊 What's Working — Signal Attribution</span>
                          <span className="text-[10px] text-slate-600 ml-auto">{closed.length} closed trades</span>
                        </div>
                        <div className="px-3 pb-3 pt-2">
                          {closed.length < 3 ? (
                            <div className="text-[10px] text-slate-600 text-center py-2">Need 3+ closed trades to see which signals are working for you</div>
                          ) : rows.length === 0 ? (
                            <div className="text-[10px] text-slate-600 text-center py-2">No signals with 2+ trades yet — keep tracking</div>
                          ) : (
                            <>
                              <div className="text-[10px] text-slate-600 mb-2">Win rate per signal present at entry — min 2 trades shown</div>
                              <div className="space-y-1.5">
                                {rows.map(row => (
                                  <div key={row.name} className="flex items-center gap-2 text-[10px]">
                                    <span className="w-3 text-center">{row.icon}</span>
                                    <span className="w-28 text-slate-400 font-medium truncate">{row.name}</span>
                                    <div className="flex-1 bg-slate-800 rounded-full h-2.5 overflow-hidden">
                                      <div className={`h-full rounded-full ${row.wr >= 60 ? 'bg-emerald-500' : row.wr >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                        style={{ width: `${Math.max(row.wr, 3)}%` }} />
                                    </div>
                                    <span className={`w-10 text-right font-mono font-bold ${row.wr >= 60 ? 'text-emerald-400' : row.wr >= 40 ? 'text-yellow-300' : 'text-red-400'}`}>{row.wr.toFixed(0)}%</span>
                                    <span className={`w-12 text-right font-mono ${row.avgPnl >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{row.avgPnl >= 0 ? '+' : ''}{row.avgPnl.toFixed(1)}%</span>
                                    <span className="text-slate-600 w-8 text-right">{row.wins}/{row.n}</span>
                                  </div>
                                ))}
                              </div>
                              <div className="text-[9px] text-slate-700 mt-2 border-t border-slate-800 pt-1.5">Signals &gt;60% WR → full size. Red rows → half-size or wait for more confirmation before entry.</div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ═══════════════════════════════════════════ */}
                  {/* SECTION 5: EXIT BEHAVIOR ANALYSIS          */}
                  {/* ═══════════════════════════════════════════ */}
                  {brainInsights && (() => {
                    const eb = brainInsights.analyzeExitBehavior?.();
                    if (!eb) return null;
                    const typeColor = eb.sellerType === 'SELL_TOO_SOON' ? 'text-amber-400' : eb.sellerType === 'HOLD_TOO_LONG' ? 'text-red-400' : eb.sellerType === 'PATIENT_HOLDER' ? 'text-emerald-400' : 'text-cyan-400';
                    const typeIcon = eb.sellerType === 'SELL_TOO_SOON' ? '⏩' : eb.sellerType === 'HOLD_TOO_LONG' ? '⏳' : eb.sellerType === 'PATIENT_HOLDER' ? '🎯' : '⚖';
                    return (
                      <div className="bg-slate-800/40 rounded-lg p-3">
                        <div className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                          <span className="w-1 h-4 bg-amber-500 rounded-full"></span>
                          Exit Behavior Analysis
                          <span className={`ml-auto text-[10px] font-bold ${typeColor}`}>{typeIcon} {eb.sellerType.replace(/_/g,' ')}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-3 mb-2">
                          <div className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                            <div className="text-[10px] text-slate-500 uppercase">T2 Capture</div>
                            <div className={`text-xl font-bold ${eb.t2CaptureRate >= 50 ? 'text-emerald-400' : eb.t2CaptureRate >= 30 ? 'text-amber-400' : 'text-red-400'}`}>{eb.t2CaptureRate}%</div>
                            <div className="text-[10px] text-slate-600">{eb.t2Hits} of {eb.reachedT1} T1 hits</div>
                          </div>
                          <div className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                            <div className="text-[10px] text-slate-500 uppercase">MFE Gap</div>
                            <div className={`text-xl font-bold ${Math.abs(eb.avgMFEGap) < 1 ? 'text-emerald-400' : Math.abs(eb.avgMFEGap) < 3 ? 'text-amber-400' : 'text-red-400'}`}>{eb.avgMFEGap > 0 ? '+' : ''}{eb.avgMFEGap.toFixed(1)}%</div>
                            <div className="text-[10px] text-slate-600">left on table / winner</div>
                          </div>
                          <div className="bg-slate-900/40 rounded px-2 py-1.5 text-center">
                            <div className="text-[10px] text-slate-500 uppercase">Expire Rate</div>
                            <div className={`text-xl font-bold ${eb.expireRate <= 20 ? 'text-emerald-400' : eb.expireRate <= 40 ? 'text-amber-400' : 'text-red-400'}`}>{eb.expireRate}%</div>
                            <div className="text-[10px] text-slate-600">{eb.expiredCount} expired trades</div>
                          </div>
                        </div>
                        <div className={`text-[10px] px-2.5 py-1.5 rounded ${eb.sellerType === 'SELL_TOO_SOON' ? 'bg-amber-900/20 border border-amber-800/30 text-amber-300' : eb.sellerType === 'HOLD_TOO_LONG' ? 'bg-red-900/20 border border-red-800/30 text-red-300' : eb.sellerType === 'PATIENT_HOLDER' ? 'bg-emerald-900/20 border border-emerald-800/30 text-emerald-300' : 'bg-slate-700/30 border border-slate-700/40 text-slate-400'}`}>
                          {eb.advice}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ═══════════════════════════════════════════ */}
                  {/* SECTION 6: ENGINE REFERENCE                */}
                  {/* ═══════════════════════════════════════════ */}
                  <div className="bg-slate-800/20 rounded-lg px-3 py-2 text-[10px] text-slate-600 grid grid-cols-2 gap-x-4 gap-y-0.5 border border-slate-700/30">
                    <div><b className="text-slate-500">Engine:</b> Level 3 bar-by-bar sequential (stop checked before target)</div>
                    <div><b className="text-slate-500">Auto-Runs:</b> After every scan on all open tracked trades</div>
                    <div><b className="text-slate-500">MFE:</b> Highest R-multiple above entry — profit left on the table</div>
                    <div><b className="text-slate-500">MAE:</b> Deepest R-multiple below entry — how close to stop</div>
                    <div><b className="text-slate-500">Expiry:</b> 20 trading days without target or stop → auto-expired</div>
                    <div><b className="text-slate-500">Entry Skip:</b> Validates from day AFTER entry (no same-day false stops)</div>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ── Focus Tab ── */}
        {activeTab === 'focus' && (
          <div className="flex-1 overflow-auto p-4">

            {/* ── 1. Consecutive Loss / Drawdown Alert ── */}
            {(() => {
              const closed = trackedTrades.filter(t => t.status !== 'open').slice().reverse();
              let streak = 0;
              for (const t of closed) {
                if ((t.pnlPct ?? 0) < 0) streak++; else break;
              }
              if (streak < 2) return null;
              return (
                <div className={`flex items-center gap-3 mb-3 px-4 py-2.5 rounded-lg border text-xs font-medium ${streak >= 3 ? 'bg-red-950/60 border-red-700 text-red-300' : 'bg-amber-950/60 border-amber-700 text-amber-300'}`}>
                  <span className="text-base">{streak >= 3 ? '🛑' : '⚠️'}</span>
                  <span>
                    <span className="font-bold">{streak} consecutive losses.</span>
                    {streak >= 3
                      ? ' Consider pausing until market conditions improve. No new full-size trades.'
                      : ' Trade half-size on the next signal until a win resets the streak.'}
                  </span>
                </div>
              );
            })()}

            {/* Bulk deal feed health banner */}
            {bulkHealth?.failing && (
              <div className="flex items-center gap-2 mb-3 px-4 py-2 rounded-lg border bg-orange-950/60 border-orange-700 text-orange-300 text-xs">
                <span>📡</span>
                <span><span className="font-bold">Bulk deal feed degraded</span> — last successful BSE ingestion: {bulkHealth.lastSuccessDate ?? 'never'}. Bulk scores are excluded from ranking until the feed recovers.</span>
              </div>
            )}

            {/* Context bar */}
            <div className="flex items-center gap-4 mb-4 text-xs">
              {marketRegime && (
                <span className={`px-2 py-1 rounded font-medium ${marketRegime.regime.includes('bull') ? 'bg-green-900/40 text-green-300' : marketRegime.regime.includes('bear') ? 'bg-red-900/40 text-red-300' : 'bg-yellow-900/40 text-yellow-300'}`}>
                  {marketRegime.emoji} {marketRegime.label} · Size: ×{marketRegime.sizingMultiplier}
                </span>
              )}
              <span className="text-slate-500">Open: {trackedTrades.filter(t => t.status === 'open').length} positions</span>
              {winStats.total >= 5 && (
                <span className={winStats.winRate >= 55 ? 'text-emerald-400' : 'text-amber-400'}>
                  Win Rate: {winStats.winRate.toFixed(0)}% ({winStats.total} trades)
                </span>
              )}
              {dataQuality && (
                <span className={dataQuality.isStale ? 'text-red-400' : 'text-slate-500'}>
                  Data: {dataQuality.latestDate}{dataQuality.isStale ? ' ⚠' : ' ✓'}
                </span>
              )}
              <span className="text-slate-600 ml-auto">{results.length > 0 ? `${results.length} scanned` : 'No scan yet'}</span>
            </div>

            {/* ── Sprint 5: Flow Settings Panel ── */}
            <div className="mb-3">
              <button
                onClick={() => setShowFlowSettings(v => !v)}
                className="flex items-center gap-1.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors uppercase tracking-wider font-semibold"
              >
                <span>{showFlowSettings ? '▼' : '▶'}</span> Flow Intelligence Settings
              </button>
              {showFlowSettings && (
                <div className="mt-2 p-3 bg-slate-900/60 border border-slate-800 rounded-lg space-y-3">
                  {/* Kill switches */}
                  <div className="flex gap-4 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <div
                        onClick={() => { const v = !sectorFlowOn; setSectorFlowOn(v); try { localStorage.setItem('qtp_sf_on', v ? 'true' : 'false'); } catch {} }}
                        className={`w-8 h-4 rounded-full transition-colors relative ${sectorFlowOn ? 'bg-emerald-600' : 'bg-slate-700'}`}
                      >
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${sectorFlowOn ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      <span className="text-[11px] text-slate-400">Sector Flow</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <div
                        onClick={() => { const v = !bulkFlowOn; setBulkFlowOn(v); try { localStorage.setItem('qtp_bf_on', v ? 'true' : 'false'); } catch {} }}
                        className={`w-8 h-4 rounded-full transition-colors relative ${bulkFlowOn ? 'bg-emerald-600' : 'bg-slate-700'}`}
                      >
                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${bulkFlowOn ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </div>
                      <span className="text-[11px] text-slate-400">Bulk Flow</span>
                    </label>
                  </div>
                  {/* Weight sliders */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-500 w-24">Sector weight</span>
                      <input type="range" min={0.5} max={2} step={0.1} value={sectorFlowW}
                        onChange={e => { const v = parseFloat(e.target.value); setSectorFlowW(v); try { localStorage.setItem('qtp_sf_w', String(v)); } catch {} }}
                        className="flex-1 accent-indigo-500 h-1" />
                      <span className="text-[10px] text-slate-400 w-8 text-right">{sectorFlowW.toFixed(1)}×</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-slate-500 w-24">Bulk weight</span>
                      <input type="range" min={0.5} max={2} step={0.1} value={bulkFlowW}
                        onChange={e => { const v = parseFloat(e.target.value); setBulkFlowW(v); try { localStorage.setItem('qtp_bf_w', String(v)); } catch {} }}
                        className="flex-1 accent-indigo-500 h-1" />
                      <span className="text-[10px] text-slate-400 w-8 text-right">{bulkFlowW.toFixed(1)}×</span>
                    </div>
                  </div>
                  {/* Shadow comparison table */}
                  {(() => {
                    try {
                      const log: Array<{date: string; scanCount: number; sectorCovPct: number; bulkCount: number; synergyCount: number}> =
                        JSON.parse(localStorage.getItem('qtp_shadow_log') ?? '[]');
                      if (log.length === 0) return <p className="text-[10px] text-slate-600 italic">Run scans to build the 20-session comparison table.</p>;
                      return (
                        <div>
                          <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold mb-1">Shadow Log ({log.length} sessions)</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-[10px] text-slate-400 border-collapse">
                              <thead>
                                <tr className="text-slate-600 border-b border-slate-800">
                                  <th className="text-left pr-3 pb-1 font-normal">Date</th>
                                  <th className="text-right pr-3 pb-1 font-normal">Scanned</th>
                                  <th className="text-right pr-3 pb-1 font-normal">SF Cov%</th>
                                  <th className="text-right pr-3 pb-1 font-normal">Bulk</th>
                                  <th className="text-right pb-1 font-normal">⚡Synergy</th>
                                </tr>
                              </thead>
                              <tbody>
                                {log.map((e, i) => (
                                  <tr key={e.date} className={i % 2 === 0 ? 'bg-slate-900/30' : ''}>
                                    <td className="pr-3 py-0.5">{e.date}</td>
                                    <td className="text-right pr-3 py-0.5 tabular-nums">{e.scanCount}</td>
                                    <td className={`text-right pr-3 py-0.5 tabular-nums ${e.sectorCovPct >= 85 ? 'text-emerald-500' : e.sectorCovPct >= 70 ? 'text-slate-400' : 'text-amber-500'}`}>{e.sectorCovPct}%</td>
                                    <td className="text-right pr-3 py-0.5 tabular-nums">{e.bulkCount}</td>
                                    <td className={`text-right py-0.5 tabular-nums ${e.synergyCount > 0 ? 'text-yellow-400 font-bold' : 'text-slate-600'}`}>{e.synergyCount}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    } catch { return null; }
                  })()}
                </div>
              )}
            </div>

            {/* ── 2. Sector Strength Strip ── */}
            {sectorFlows.length > 0 && (
              <div className="mb-4">
                <div className="text-[10px] text-slate-600 uppercase tracking-wider font-semibold mb-1.5">
                  Sector Rotation
                  {(() => {
                    const cov = sectorFlowCoverage(results.length, sectorFlowMap);
                    if (cov.total === 0) return null;
                    return (
                      <span className={`ml-2 normal-case font-normal ${cov.pct >= 85 ? 'text-emerald-600' : cov.pct >= 70 ? 'text-slate-500' : 'text-amber-500'}`}
                        title={`${cov.covered}/${cov.total} scanned stocks have a sector flow score. Below 70% the sector signal loses reliability.`}>
                        flow coverage {cov.pct}%
                      </span>
                    );
                  })()}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {sectorFlows.slice(0, 10).map(sf => {
                    const br = sectorBreadthList.find(b => b.sector === sf.sector || b.indexName.toUpperCase().includes(sf.sector.toUpperCase()));
                    return (
                      <span key={sf.sector}
                        title={br ? `${br.breadthPct}% of ${br.count} scanned stocks beating their sector index over 5d — ${br.breadthPct >= 60 ? 'broad rotation' : br.breadthPct <= 35 ? 'narrow (heavyweights only)' : 'mixed'}` : undefined}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${br ? 'cursor-help' : ''} ${sf.flowLabel === 'inflow' ? 'bg-emerald-900/30 border-emerald-700 text-emerald-300' : sf.flowLabel === 'outflow' ? 'bg-red-900/30 border-red-800 text-red-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
                        {sf.flowLabel === 'inflow' ? '▲' : sf.flowLabel === 'outflow' ? '▼' : '—'} {sf.sector}
                        {br && <span className={br.breadthPct >= 60 ? 'text-emerald-400' : br.breadthPct <= 35 ? 'text-amber-400' : 'text-slate-500'}> {br.breadthPct}%</span>}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Top signals */}
            {(() => {
              // Sprint 4+5: conviction + weighted sector/bulk flow boosts with kill switches.
              // Circuit breakers inside each boost function ensure stale/missing data → 0.
              const isSynergy = (r: AnalysisResult) => {
                const sf = sectorFlowMap[r.symbol];
                const bf = bulkFlowMap[r.symbol.replace(/\.(NS|BO)$/i, '')];
                return (sf?.score ?? 0) > 0 && (bf?.finalScore ?? 0) > 60;
              };
              const flowAdjusted = (r: AnalysisResult) =>
                computeConviction(r)
                + (sectorFlowOn ? sectorFlowConvictionBoost(sectorFlowMap[r.symbol]) * sectorFlowW : 0)
                + (bulkFlowOn ? bulkFlowConvictionBoost(bulkFlowMap[r.symbol.replace(/\.(NS|BO)$/i, '')]) * bulkFlowW : 0);
              // BUY-stage, tradeable signals BEFORE the flow filter — drives whether
              // the filter chips should appear at all.
              const baseSignals = filteredResults
                .filter(r => ['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage) && r.priceEngine.tradeValid);
              const topSignals = baseSignals
                .filter(r => {
                  if (focusFlowFilter === 'all') return true;
                  const bf = bulkFlowMap[r.symbol.replace(/\.(NS|BO)$/i, '')];
                  const sf = sectorFlowMap[r.symbol];
                  if (focusFlowFilter === 'bulk') return !!bf;
                  if (focusFlowFilter === 'bulk_high') return bf && bf.finalScore >= 75;
                  if (focusFlowFilter === 'sector_in') return sf && sf.score > 0;
                  if (focusFlowFilter === 'synergy') return isSynergy(r);
                  return true;
                })
                .sort((a, b) => flowAdjusted(b) - flowAdjusted(a))
                .slice(0, focusFlowFilter !== 'all' ? 20 : 5);

              // Reusable filter chip row — shown whenever there are base signals to filter.
              const filterChips = (
                <div className="flex flex-wrap gap-1.5">
                  {([
                    ['all', 'All Signals'],
                    ['bulk', '💰 Has Bulk'],
                    ['bulk_high', '💰 Bulk ≥75'],
                    ['sector_in', '▲ Sector In'],
                    ['synergy', '⚡ Synergy'],
                  ] as const).map(([key, label]) => (
                    <button key={key}
                      onClick={() => setFocusFlowFilter(key)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${focusFlowFilter === key ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              );

              if (results.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-600">
                    <div className="text-5xl mb-4">⚡</div>
                    <div className="text-lg font-medium mb-1">Focus Mode</div>
                    <div className="text-sm">Run a scan to see your top signals here</div>
                  </div>
                );
              }

              // Scan ran but nothing cleared the BUY-stage bar — genuinely nothing to filter.
              if (baseSignals.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-600">
                    <div className="text-4xl mb-3">✓</div>
                    <div className="text-sm">No actionable BUY signals in this scan</div>
                    <div className="text-xs text-slate-700 mt-1">This is normal — patience is an edge</div>
                  </div>
                );
              }

              // There ARE base signals but the active flow filter removed them all — keep the
              // chips visible so the user can widen or reset the filter (no dead end).
              if (topSignals.length === 0) {
                return (
                  <div className="space-y-3">
                    {filterChips}
                    <div className="flex flex-col items-center justify-center py-12 text-slate-600">
                      <div className="text-3xl mb-2">🔍</div>
                      <div className="text-sm">No signals match this flow filter</div>
                      <div className="text-xs text-slate-700 mt-1">
                        {baseSignals.length} BUY signal{baseSignals.length !== 1 ? 's' : ''} available —
                        <button onClick={() => setFocusFlowFilter('all')} className="text-indigo-400 hover:text-indigo-300 ml-1 underline">show all</button>
                      </div>
                    </div>
                  </div>
                );
              }

              const regimeMult = marketRegime?.sizingMultiplier ?? 1;

              return (
                <div className="space-y-3">
                  {/* Sprint 4: Flow filter chips */}
                  {filterChips}
                  <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                    {focusFlowFilter === 'all'
                      ? `Today's Top ${topSignals.length} Signal${topSignals.length > 1 ? 's' : ''}`
                      : `${topSignals.length} Signal${topSignals.length !== 1 ? 's' : ''} · ${(['all','bulk','bulk_high','sector_in','synergy'] as const).find(k => k === focusFlowFilter) === 'bulk' ? 'Has Bulk Deal' : focusFlowFilter === 'bulk_high' ? 'Bulk ≥75' : focusFlowFilter === 'sector_in' ? 'Sector Inflow' : '⚡ Synergy'}`
                    }
                  </div>
                  {topSignals.map((r, idx) => {
                    const conv = computeConviction(r);
                    const risk = r.priceEngine.riskPerShare;
                    const qty = risk > 0 ? Math.floor((accountSize * regimeMult * 0.01) / risk) : 0;
                    const capital = qty * r.priceEngine.plannedEntry;
                    const maxRisk = qty * risk;
                    const isTracked = trackedTrades.some(t => t.symbol === r.symbol);
                    const sector = getSectorTag(r.symbol);
                    const signalSectorFlow = sectorFlows.find(sf => sf.sector === sector);

                    // ── 3. Entry timing quality (gap/chase warning) ──
                    const plannedEntry = r.priceEngine.plannedEntry;
                    const cmp = r.lastClose;
                    const chaseGapPct = plannedEntry > 0 ? ((cmp - plannedEntry) / plannedEntry) * 100 : 0;
                    const isChasingEntry = chaseGapPct > 1.5;

                    // ── 4. Plain-English narrative (top 3 bullets) ──
                    const narBullets: string[] = [];
                    if (r.zone) {
                      const tight = r.zone.zoneTightnessPct <= 5 ? 'extremely tight' : r.zone.zoneTightnessPct <= 10 ? 'tight' : 'moderate';
                      narBullets.push(`${r.zone.windowLength}-day ${tight} zone (${r.zone.zoneTightnessPct.toFixed(1)}% range) — compression coiled for breakout`);
                    }
                    const volDesc = r.exactVolVsPre5 >= 3 ? `${r.exactVolVsPre5.toFixed(1)}× pre-5 avg` : r.exactVolRatio20 >= 2 ? `${r.exactVolRatio20.toFixed(1)}× 20-day avg` : null;
                    if (volDesc) narBullets.push(`Breakout volume ${volDesc} — institutional participation confirmed`);
                    if (r.closeLoc >= 70 && r.bodyPct >= 40) narBullets.push(`Strong candle: close at ${r.closeLoc.toFixed(0)}% of range, body ${r.bodyPct.toFixed(0)}% — buyers in control`);
                    else if (r.momentum?.emaAligned && r.momentum?.higherLowConfirmed) narBullets.push('EMAs aligned bullish + higher-low structure — trend confirmed on daily');
                    if (narBullets.length < 3 && r.stats?.ttmSqueezeFired) narBullets.push('TTM Squeeze just fired — momentum released from tight compression');
                    if (narBullets.length < 3 && r.ultraPrecisionScore >= 60) narBullets.push(`UltraPrecision Score ${r.ultraPrecisionScore}/100 — top-tier candle quality`);

                    return (
                      <div key={r.symbol} className="bg-slate-800/40 rounded-lg overflow-hidden border border-slate-700/50">
                        {/* Gap/Chase Warning Banner */}
                        {isChasingEntry && (
                          <div className="flex items-center gap-2 px-4 py-1.5 bg-amber-950/60 border-b border-amber-800/50 text-xs text-amber-300">
                            <span>⚠️</span>
                            <span><span className="font-bold">Chasing entry</span> — CMP ₹{cmp.toFixed(2)} is {chaseGapPct.toFixed(1)}% above planned entry ₹{plannedEntry.toFixed(2)}. Stop unchanged → R:R degraded. Consider waiting for pullback or reduce size.</span>
                          </div>
                        )}

                        {/* Header */}
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/30">
                          <span className="text-lg font-bold text-slate-100 font-mono">{idx + 1}.</span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-100 text-base">{r.symbol}</span>
                              {sector && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium border ${signalSectorFlow?.flowLabel === 'inflow' ? 'bg-emerald-900/30 border-emerald-700 text-emerald-300' : signalSectorFlow?.flowLabel === 'outflow' ? 'bg-red-900/20 border-red-800 text-red-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
                                  {signalSectorFlow?.flowLabel === 'inflow' ? '▲' : signalSectorFlow?.flowLabel === 'outflow' ? '▼' : ''} {sector}
                                </span>
                              )}
                              <span className={`text-xs font-semibold ${STAGE_CONFIG[r.stage].color}`}>{STAGE_CONFIG[r.stage].label}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                              <span>CMP ₹{r.lastClose.toFixed(2)}</span>
                              {(() => {
                                const sf = sectorFlowMap[r.symbol];
                                if (!sf) return null;
                                return (
                                  <span className={`${sectorFlowBadgeColor(sf)} cursor-help`}
                                    title={`5D stock: ${sf.stockRet5d >= 0 ? '+' : ''}${sf.stockRet5d.toFixed(1)}% · 5D sector: ${sf.sectorRet5d >= 0 ? '+' : ''}${sf.sectorRet5d.toFixed(1)}% · Relative: ${sf.rel5d >= 0 ? '+' : ''}${sf.rel5d.toFixed(1)}% · Rank ${sf.sectorRank}/${sf.sectorSize} (${sf.normalization}-normalized) · Data: ${sf.freshness}`}>
                                    {sf.score >= 1 ? '▲' : sf.score <= -1 ? '▼' : '◆'} {sectorFlowLabel(sf)}
                                  </span>
                                );
                              })()}
                              {(() => {
                                const bf = bulkFlowMap[r.symbol.replace(/\.(NS|BO)$/i, '')];
                                if (!bf) return null;
                                const conflict = bf.netBuyValue > 0 && (sectorFlowMap[r.symbol]?.score ?? 0) < -1;
                                return (
                                  <span className={`${bulkFlowColor(bf)} cursor-help`}
                                    title={`Disclosed bulk deal ${bf.dealDate} · z=${bf.abnormalityZ?.toFixed(1) ?? 'n/a'} · credibility ${(bf.clientCredibility * 100).toFixed(0)}% · confidence: ${bf.confidence}${bf.flags.length ? ` · flags: ${bf.flags.join(', ')}` : ''}${conflict ? ' · ⚠ CONFLICT: bulk buying but sector-relative weakness' : ''}`}>
                                    💰 {bulkFlowLabel(bf)}{conflict ? ' ⚠' : ''}
                                  </span>
                                );
                              })()}
                              {/* Sprint 5: Synergy badge — sector inflow + bulk deal agree */}
                              {isSynergy(r) && (
                                <span className="text-yellow-300 font-bold" title="Sector inflow AND disclosed bulk buying align — dual confirmation">
                                  ⚡ SYNERGY
                                </span>
                              )}
                              <span>Candle: <span className={detectOnsetCandle(r) ? 'text-[#39FF14] font-bold' : r.stats.candlePatternType === 'bullish' ? 'text-emerald-400' : r.stats.candlePatternType === 'bearish' ? 'text-red-400' : 'text-slate-400'}>{detectOnsetCandle(r) ? `★ ${r.stats.candlePatternFull}` : r.stats.candlePatternFull}</span></span>
                              {r.stats.guppyCompressed && <span className="text-yellow-300">Guppy: {r.stats.guppySpreadPct.toFixed(1)}%</span>}
                              {r.stats.ttmSqueezeFired && <span className="text-green-400">TTM 🟢</span>}
                              {detectVolumeBadge(r) === 'HIGH_CONVICTION' && <span className="text-orange-400 font-bold">🔥 Vol Thrust</span>}
                              {detectVolumeBadge(r) === 'CONFIRMED' && <span className="text-emerald-500">✓ Vol</span>}
                              {detectATRState(r).explosion && <span className="text-[#39FF14] font-bold">💥 ATR+Vol Explosion</span>}
                              {!detectATRState(r).explosion && detectATRState(r).state === 'SWEET_SPOT' && <span className="text-orange-300">🎯 ATR Sweet Spot</span>}
                              {detectZoneExplosion(r) === 'HIGH_CONVICTION' && <span className="text-cyan-300 font-bold">💎 Zone Explosion</span>}
                              {detectZoneExplosion(r) === 'CONFIRMED' && <span className="text-blue-400">🎯 Zone Ready</span>}
                              {(() => { const age = getSignalAge(r.symbol, r.stage, signalHistory); return age > 0 ? <span className={age <= 1 ? 'text-emerald-400' : age <= 3 ? 'text-slate-400' : 'text-amber-400'}>{age <= 1 ? 'NEW today' : `${age}d old`}</span> : null; })()}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={`text-2xl font-bold ${conv >= 70 ? 'text-yellow-300' : conv >= 50 ? 'text-emerald-400' : 'text-slate-300'}`}>{conv}</div>
                            <div className="text-xs text-slate-500">Conviction</div>
                          </div>
                        </div>

                        {/* ── Plain-English "Why This Signal" ── */}
                        {narBullets.length > 0 && (
                          <div className="px-4 py-2 bg-slate-900/30 border-b border-slate-700/20 space-y-0.5">
                            {narBullets.slice(0, 3).map((b, i) => (
                              <div key={i} className="flex items-start gap-2 text-[11px] text-slate-400">
                                <span className="text-indigo-400 mt-px shrink-0">{'›'}</span>
                                <span>{b}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Trade details */}
                        <div className="grid grid-cols-4 gap-0 text-xs">
                          <div className="px-3 py-2 border-r border-slate-700/30">
                            <div className="text-slate-500">Entry</div>
                            <div className="text-slate-200 font-mono font-semibold">₹{r.priceEngine.plannedEntry.toFixed(2)}</div>
                          </div>
                          <div className="px-3 py-2 border-r border-slate-700/30">
                            <div className="text-slate-500">Stop</div>
                            <div className="text-red-400 font-mono font-semibold">₹{r.priceEngine.tacticalStop.toFixed(2)}</div>
                          </div>
                          <div className="px-3 py-2 border-r border-slate-700/30">
                            <div className="text-slate-500">T1 ({r.priceEngine.t1R.toFixed(1)}R)</div>
                            <div className="text-emerald-400 font-mono font-semibold">₹{r.priceEngine.target5.toFixed(2)}</div>
                          </div>
                          <div className="px-3 py-2">
                            <div className="text-slate-500">R:R</div>
                            <div className={`font-mono font-bold ${rrVerdictColor(r.priceEngine.rewardRisk)}`}>{r.priceEngine.rewardRisk.toFixed(2)}</div>
                            <div className={`text-[10px] ${rrVerdictColor(r.priceEngine.rewardRisk)}`}>{rrVerdict(r.priceEngine.rewardRisk)}</div>
                          </div>
                        </div>

                        {/* Position sizing */}
                        <div className="flex items-center gap-4 px-4 py-2 bg-slate-900/40 text-xs border-t border-slate-700/30">
                          <span className="text-emerald-400 font-semibold">Buy {qty} shares</span>
                          <span className="text-slate-400">@ ₹{r.priceEngine.plannedEntry.toFixed(2)}</span>
                          <span className="text-slate-500">Capital: ₹{(capital / 1000).toFixed(0)}K</span>
                          <span className="text-red-400">Risk: ₹{maxRisk.toFixed(0)}</span>
                          <span className="text-slate-500">({(accountSize > 0 ? maxRisk / accountSize * 100 : 0).toFixed(2)}% of account)</span>
                        </div>

                        {/* Action buttons */}
                        <div className="flex gap-2 px-4 py-2.5 border-t border-slate-700/30">
                          <button onClick={() => { trackTrade(r); }}
                            disabled={isTracked}
                            className={`flex-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${isTracked ? 'bg-emerald-900/30 border border-emerald-700 text-emerald-400 cursor-default' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}>
                            {isTracked ? '✓ Tracked' : '✓ Trade'}
                          </button>
                          {isTracked && (
                            <button onClick={() => { const tr = trackedTrades.find(t => t.symbol === r.symbol && t.status === 'open'); if (tr) removeTrade(tr); }}
                              className="px-3 py-1.5 bg-red-900/30 hover:bg-red-900/50 border border-red-800 rounded text-xs font-medium text-red-400 transition-colors">
                              ✕ Remove</button>
                          )}
                          <button onClick={() => setSelectedSymbol(r.symbol)}
                            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs font-medium text-slate-300 transition-colors">
                            Details</button>
                          <button onClick={() => {
                            const exists = watchlist.some(w => w.symbol === r.symbol);
                            if (!exists) { const item = { symbol: r.symbol, note: '', addedDate: new Date().toISOString().slice(0,10), stage: r.stage, lastClose: r.lastClose }; const updated = [...watchlist, item]; setWatchlist(updated); saveWatchlist(updated); }
                          }}
                            className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-xs font-medium text-amber-400 transition-colors">
                            ⭐ Watch</button>
                        </div>
                      </div>
                    );
                  })}

                  {/* ── 5. Near-Miss / Tomorrow's Watchlist ── */}
                  {(() => {
                    const allChecked = filteredResults.filter(r => !['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage));
                    const nearMiss = allChecked
                      .map(r => {
                        const cl = r.checklist ?? [];
                        const met = cl.filter((c: { pass: boolean }) => c.pass).length;
                        const total = cl.length;
                        const missed = total - met;
                        const failedNames = cl.filter((c: { pass: boolean; label?: string }) => !c.pass).map((c: { label?: string }) => c.label ?? '').filter(Boolean).slice(0, 2);
                        return { r, met, total, missed, failedNames };
                      })
                      .filter(x => x.total > 0 && x.missed >= 1 && x.missed <= 2)
                      .sort((a, b) => b.met - a.met)
                      .slice(0, 5);

                    if (nearMiss.length === 0) return null;
                    return (
                      <div className="bg-slate-800/20 rounded-lg p-3 mt-2 border border-slate-700/30">
                        <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">👀 Near-Miss — Tomorrow's Watchlist</div>
                        <div className="space-y-1.5">
                          {nearMiss.map(({ r, met, total, failedNames }) => (
                            <div key={r.symbol} className="flex items-center gap-3 text-xs">
                              <span className="font-mono font-semibold text-slate-300 w-28 shrink-0">{r.symbol.replace('.NS','').replace('.BO','')}</span>
                              <span className="text-slate-600">{met}/{total} checks</span>
                              <span className="text-amber-500/80 flex-1">Missing: {failedNames.join(', ') || `${total - met} condition${total - met > 1 ? 's' : ''}`}</span>
                              <button onClick={() => {
                                const exists = watchlist.some(w => w.symbol === r.symbol);
                                if (!exists) { const item = { symbol: r.symbol, note: 'Near-miss', addedDate: new Date().toISOString().slice(0,10), stage: r.stage, lastClose: r.lastClose }; const updated = [...watchlist, item]; setWatchlist(updated); saveWatchlist(updated); }
                              }} className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-[10px] text-amber-400 shrink-0">⭐ Watch</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Rolling validation stats */}
                  {trackedTrades.length >= 3 && (
                    <div className="bg-slate-800/30 rounded-lg p-3 mt-4">
                      <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Signal Validation</div>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          computeRollingStats(trackedTrades, 10, 'Last 10'),
                          computeRollingStats(trackedTrades, 20, 'Last 20'),
                          computeRollingStats(trackedTrades, 999, 'All Time'),
                        ].filter(s => s.total > 0).map(s => (
                          <div key={s.period} className="bg-slate-900/40 rounded px-3 py-2 text-xs text-center">
                            <div className="text-slate-500 mb-1">{s.period}</div>
                            <div className={`text-lg font-bold ${s.winRate >= 55 ? 'text-emerald-400' : s.winRate >= 40 ? 'text-amber-400' : 'text-red-400'}`}>{s.winRate.toFixed(0)}%</div>
                            <div className="text-slate-600">{s.wins}W / {s.losses}L of {s.total}</div>
                            {s.avgTimeToTarget > 0 && <div className="text-slate-600 mt-0.5">Avg {s.avgTimeToTarget.toFixed(1)}d to T1</div>}
                            {s.avgMFE > 0 && <div className="text-emerald-600 mt-0.5" title="Avg best price on winners">MFE +{s.avgMFE.toFixed(1)}%</div>}
                            {s.avgMAE > 0 && <div className="text-red-600" title="Avg worst drawdown on losers">MAE -{s.avgMAE.toFixed(1)}%</div>}
                            {(() => {
                              const closed = trackedTrades.filter(tt => tt.status !== 'open').slice(-(s.period === 'Last 10' ? 10 : s.period === 'Last 20' ? 20 : 999));
                              const riskTrades = closed.filter(tt => tt.entryPrice - tt.stopLoss > 0);
                              if (riskTrades.length === 0) return null;
                              const mfeTrades = riskTrades.filter(tt => tt.highestPrice != null && tt.highestPrice > 0);
                              const avgMfeR = mfeTrades.length > 0 ? mfeTrades.reduce((sum, tt) => sum + (tt.highestPrice! - tt.entryPrice) / (tt.entryPrice - tt.stopLoss), 0) / mfeTrades.length : 0;
                              const avgMaeR = riskTrades.filter(tt => (tt.pnlPct ?? 0) < 0).reduce((sum, tt) => sum + ((tt.pnlPct ?? 0) / 100 * tt.entryPrice) / (tt.entryPrice - tt.stopLoss), 0) / (riskTrades.filter(tt => (tt.pnlPct ?? 0) < 0).length || 1);
                              return <>
                                {avgMfeR > 0 && <div className="text-emerald-500 text-[10px]">MFE-R +{avgMfeR.toFixed(1)}R</div>}
                                {avgMaeR < 0 && <div className="text-red-500 text-[10px]">MAE-R {avgMaeR.toFixed(1)}R</div>}
                              </>;
                            })()}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ── Scanner Tab (existing table) ── */}
        {activeTab === 'scanner' && <>

        {/* Table area — full width, no sidebar */}
        <div className="flex flex-col overflow-hidden flex-1 min-w-0">

          {/* Fix #9: Scan summary card */}
          {results.length > 0 && (() => {
            const buys = results.filter(r => ['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage));
            const best = buys.sort((a, b) => computeConviction(b) - computeConviction(a))[0];
            if (buys.length === 0) return <div className="flex-shrink-0 bg-slate-800/20 px-4 py-1.5 text-[11px] text-slate-500 border-b border-slate-800/30">No actionable signals in this scan · {results.length} stocks screened</div>;
            const ze = best ? detectZoneExplosion(best) : null;
            const ae = best ? detectATRState(best) : { explosion: false };
            const vb = best ? detectVolumeBadge(best) : null;
            const onset = best ? detectOnsetCandle(best) : null;
            const badges = [ze === 'HIGH_CONVICTION' ? '💎Zone' : '', ae.explosion ? '💥ATR' : '', vb === 'HIGH_CONVICTION' ? '🔥Vol' : '', onset === 'STRONG' ? '★Onset' : ''].filter(Boolean).join(' ');
            return <div className="flex-shrink-0 bg-gradient-to-r from-emerald-900/20 to-slate-900/10 px-4 py-2 border-b border-emerald-800/20 flex items-center gap-3 text-[11px]">
              <span className="text-emerald-400 font-bold">{buys.length} BUY signal{buys.length > 1 ? 's' : ''}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">Best: <span className="text-slate-200 font-semibold">{best.symbol.replace('.NS','').replace('.BO','')}</span></span>
              <span className="text-slate-400">Conv <span className="text-yellow-300 font-bold">{computeConviction(best)}</span></span>
              <span className="text-slate-400">R:R <span className={`font-bold ${rrVerdictColor(best.priceEngine.rewardRisk)}`}>{best.priceEngine.rewardRisk.toFixed(2)}</span></span>
              {badges && <span className="text-[10px] text-emerald-500">{badges}</span>}
              <span className="text-slate-600 ml-auto">{results.length} scanned</span>
            </div>;
          })()}

          {/* R5 BULL POOL Signal Banner — fires when EMAStack/PerfectStorm hits body≥35% gate */}
          {(() => {
            const poolSignals = results.filter(r =>
              r.bullPoolSignal === true && ['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage)
            );
            const bearORS = results.filter(r =>
              r.regimeSignal === 'BEAR_ORS' && r.hitRateGate === 'PREMIUM' && ['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage)
            );
            if (poolSignals.length === 0 && bearORS.length === 0) return null;
            return (
              <div className="flex-shrink-0 border-b border-amber-800/30"
                style={{ background: 'linear-gradient(90deg, #78350f18 0%, #0a0d1400 100%)' }}>
                <div className="px-4 py-2 flex items-center gap-3 flex-wrap">
                  <span className="text-[9px] font-bold tracking-widest uppercase"
                    style={{ color: '#f59e0b', letterSpacing: '0.15em' }}>
                    R5 Signal
                  </span>
                  <span className="text-[9px] text-amber-800/70 font-mono">75% OOS hit-rate · body≥35% gate</span>

                  {/* BULL POOL signals */}
                  {poolSignals.map(r => {
                    const entry = r.priceEngine.plannedEntry || r.lastClose;
                    const stop  = r.priceEngine.tacticalStop;
                    const tgt5  = entry * 1.05;
                    const risk  = stop > 0 ? ((entry - stop) / entry * 100).toFixed(1) : '—';
                    const archShort = r.archetypeType === 'EMAStack' ? 'EMA' : r.archetypeType === 'PerfectStorm' ? 'PS' : r.archetypeType ?? '?';
                    return (
                      <div key={r.symbol}
                        onClick={() => { const idx = filteredResults.findIndex(x => x.symbol === r.symbol); if (idx >= 0) { setSelectedRowIdx(idx); setSelectedSymbol(r.symbol); } }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer transition-all hover:brightness-125"
                        style={{ background: '#f59e0b12', border: '1px solid #f59e0b40' }}>
                        <span className="text-[10px] font-bold" style={{ color: '#f59e0b' }}>
                          🔥 {r.symbol.replace('.NS','').replace('.BO','')}
                        </span>
                        <span className="text-[9px] px-1 rounded font-mono"
                          style={{ background: '#f59e0b20', color: '#fbbf24' }}>{archShort}</span>
                        <span className="text-[9px] text-slate-400 font-mono">
                          E₹{entry.toFixed(0)}
                        </span>
                        <span className="text-[9px] font-mono" style={{ color: '#ef4444' }}>
                          S₹{stop > 0 ? stop.toFixed(0) : '—'}
                        </span>
                        <span className="text-[9px] font-mono" style={{ color: '#4ade80' }}>
                          T₹{tgt5.toFixed(0)}
                        </span>
                        <span className="text-[9px] text-slate-500 font-mono">R{risk}%</span>
                        <span className="text-[8px] px-1 rounded font-bold tracking-wide ml-1"
                          style={{ color: '#4ade80', background: '#4ade8015', border: '1px solid #4ade8030' }}>
                          +5% target
                        </span>
                        {r.bodyGate === true && (
                          <span className="text-[8px] px-1 rounded font-mono ml-0.5"
                            style={{ color: '#fbbf24', background: '#fbbf2410', border: '1px solid #fbbf2430' }}
                            title="Body≥35% quality gate cleared (R5 universal filter)">
                            body✓
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {/* BEAR ORS signals */}
                  {bearORS.map(r => {
                    const entry = r.priceEngine.plannedEntry || r.lastClose;
                    const stop  = r.priceEngine.tacticalStop;
                    const tgt   = entry * 1.05;
                    const risk  = stop > 0 ? ((entry - stop) / entry * 100).toFixed(1) : '—';
                    return (
                      <div key={r.symbol}
                        onClick={() => { const idx = filteredResults.findIndex(x => x.symbol === r.symbol); if (idx >= 0) { setSelectedRowIdx(idx); setSelectedSymbol(r.symbol); } }}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer transition-all hover:brightness-125"
                        style={{ background: '#a855f712', border: '1px solid #a855f740' }}>
                        <span className="text-[10px] font-bold" style={{ color: '#c084fc' }}>
                          ↩ {r.symbol.replace('.NS','').replace('.BO','')}
                        </span>
                        <span className="text-[9px] px-1 rounded font-mono"
                          style={{ background: '#a855f720', color: '#d8b4fe' }}>ORS</span>
                        <span className="text-[9px] text-slate-400 font-mono">
                          E₹{entry.toFixed(0)}
                        </span>
                        <span className="text-[9px] font-mono" style={{ color: '#ef4444' }}>
                          S₹{stop > 0 ? stop.toFixed(0) : '—'}
                        </span>
                        <span className="text-[9px] font-mono" style={{ color: '#a78bfa' }}>
                          T₹{tgt.toFixed(0)}
                        </span>
                        <span className="text-[9px] text-slate-500 font-mono">R{risk}%</span>
                        <span className="text-[8px] px-1 rounded font-bold tracking-wide ml-1"
                          style={{ color: '#c084fc', background: '#a855f715', border: '1px solid #a855f730' }}>
                          66% OOS · ADX≥20 · bear
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Scanner sub-tab bar (horizontal) */}
          {results.length > 0 && (
            <div className="flex-shrink-0 bg-[#0d1117] px-4 py-1 flex items-center gap-1 border-b border-slate-800/50">
              {SUBTAB_META.map(st => (
                <button key={st.key} onClick={() => setScannerSubTab(st.key)}
                  data-tip={st.tip} data-tip-color={st.tipColor}
                  style={scannerSubTab === st.key ? { borderColor: st.color, color: st.color, backgroundColor: `${st.color}15` } : {}}
                  className={`h-6 px-2.5 rounded border text-[11px] font-semibold transition-colors ${scannerSubTab === st.key ? '' : 'border-slate-700/50 text-slate-500 hover:text-slate-300 hover:border-slate-600 hover:bg-slate-800/40'}`}>
                  {st.emoji} {st.label}
                </button>
              ))}
              <span className="ml-auto text-[10px] text-slate-600">{visibleColumns.length} cols</span>
            </div>
          )}

          {/* ── Today's Edge: Top Picks ranked shortlist ── */}
          {topPicks.length > 0 && (
            <div className="flex-shrink-0 border-b border-slate-800/50 bg-[#0d1117]">
              <button
                onClick={() => setShowTopPicks(v => !v)}
                className="flex items-center gap-2 w-full px-4 py-1.5 hover:bg-slate-800/20 transition-colors text-left group"
              >
                <span className="text-[11px] font-bold text-indigo-400">⚡ TODAY'S EDGE</span>
                <span className="text-[10px] text-slate-600">— top {topPicks.length} setups ranked by composite signal strength</span>
                <span className="ml-auto text-[10px] text-slate-600 group-hover:text-slate-400">{showTopPicks ? '▲ hide' : '▼ show'}</span>
              </button>
              {showTopPicks && (
                <div className="flex gap-2 px-4 pb-2.5 pt-0.5 overflow-x-auto">
                  {topPicks.map((r, i) => {
                    const es = computeEdgeScore(r);
                    const ze = detectZoneExplosion(r);
                    const { state: atrSt, explosion: atrExp } = detectATRState(r);
                    const vb = detectVolumeBadge(r);
                    const topBadge = r.monster?.badges?.[0];
                    const conv = computeConviction(r);
                    const stageShort = r.stage === 'ULTRA_STRONG_BUY' ? 'ULTRA' : r.stage === 'STRONG_BUY' ? 'STRONG' : r.stage === 'BUY' ? 'BUY' : 'PRE-BRK';
                    const esColor = es >= 70 ? 'text-green-300' : es >= 50 ? 'text-indigo-300' : es >= 35 ? 'text-yellow-300' : 'text-slate-400';
                    const barColor = es >= 70 ? 'bg-green-500' : es >= 50 ? 'bg-indigo-500' : es >= 35 ? 'bg-yellow-500' : 'bg-slate-600';
                    return (
                      <div key={r.symbol}
                        onClick={() => setSelectedSymbol(r.symbol)}
                        className="flex-shrink-0 w-[11.5rem] bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/60 hover:border-slate-600 rounded-lg px-3 py-2 cursor-pointer transition-all group">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-[10px] font-bold text-slate-600">#{i + 1}</span>
                          <span className="text-[13px] font-mono font-bold text-slate-100 group-hover:text-indigo-300 transition-colors truncate">{r.symbol.replace('.NS', '').replace('.BO', '')}</span>
                          <span className={`ml-auto text-[9px] font-bold ${STAGE_CONFIG[r.stage].color}`}>{stageShort}</span>
                        </div>
                        <div className="mb-1.5">
                          <div className="flex justify-between items-center mb-0.5">
                            <span className="text-[9px] text-slate-600">Edge</span>
                            <span className={`text-[11px] font-bold ${esColor}`}>{es}</span>
                          </div>
                          <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
                            <div className={`h-full ${barColor} rounded-full`} style={{ width: `${es}%` }} />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1 mb-1.5 min-h-[14px]">
                          {ze === 'HIGH_CONVICTION' && <span className="text-[8px] bg-cyan-900/50 text-cyan-300 border border-cyan-700/50 px-1 rounded">💎Zone</span>}
                          {ze === 'CONFIRMED' && !atrExp && <span className="text-[8px] bg-blue-900/40 text-blue-300 border border-blue-700/40 px-1 rounded">Zone✓</span>}
                          {atrExp && <span className="text-[8px] bg-green-900/50 text-[#39FF14] border border-green-700/50 px-1 rounded">💥ATR</span>}
                          {!atrExp && atrSt === 'HIGH_VOL' && <span className="text-[8px] bg-purple-900/40 text-purple-300 border border-purple-700/40 px-1 rounded">HiVol</span>}
                          {vb === 'HIGH_CONVICTION' && <span className="text-[8px] bg-orange-900/50 text-orange-300 border border-orange-700/50 px-1 rounded">🔥Vol</span>}
                          {vb === 'CONFIRMED' && <span className="text-[8px] bg-yellow-900/40 text-yellow-300 border border-yellow-700/40 px-1 rounded">Vol✓</span>}
                          {r.candleDNA?.tier === 'ELITE' && <span className="text-[8px] bg-fuchsia-900/40 text-fuchsia-300 border border-fuchsia-700/40 px-1 rounded">Elite</span>}
                          {topBadge && <span className="text-[8px] bg-pink-900/40 text-pink-300 border border-pink-700/40 px-1 rounded">{topBadge.type}</span>}
                        </div>
                        <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-700/40 text-[9px]">
                          <span className="text-slate-600">Conv</span>
                          <span className={`font-bold ${conv >= 60 ? 'text-yellow-300' : conv >= 40 ? 'text-emerald-400' : 'text-slate-400'}`}>{conv}</span>
                          <span className="text-slate-700 mx-0.5">·</span>
                          <span className="text-slate-600">R:R</span>
                          <span className={`font-bold ${rrVerdictColor(r.priceEngine.rewardRisk)}`}>{r.priceEngine.rewardRisk.toFixed(1)}</span>
                          <button
                            onClick={e => { e.stopPropagation(); trackTrade(r); }}
                            className="ml-auto text-[8px] text-slate-600 hover:text-emerald-400 border border-slate-700 hover:border-emerald-600 rounded px-1 py-0.5 transition-colors">+Track</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {results.length === 0 && !scanning && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-600 gap-3">
              <div className="text-5xl select-none">&#x1F4CA;</div>
              <div className="text-sm">Upload a CSV or paste symbols to scan</div>
              <div className="text-xs text-slate-700">
                Click{' '}
                <span className="text-indigo-500 cursor-pointer"
                  onClick={() => setResults(generateDemoData(scanAll ? 'optimized_deployable_20plus' : paramSetKey))}>Demo Mode</span>
                {' '}to see sample results
              </div>
              {lastErr && errCount > 0 && (
                <div className="text-xs text-amber-400 bg-amber-950/40 border border-amber-800 rounded px-4 py-2 max-w-md text-center">
                  {lastErr}
                </div>
              )}
            </div>
          )}

          {filteredResults.length > 0 && (
            <>
              {/* ── Top scrollbar ── */}
              <div
                ref={topScrollRef}
                className="flex-shrink-0 overflow-x-scroll border-b border-slate-700 bg-slate-900"
                style={{ height: '16px' }}
              >
                <div style={{ width: `${actualTableWidth || tableWidth}px`, height: '1px' }} />
              </div>

              {/* ── Table ── */}
              <div ref={botScrollRef} className="flex-1 overflow-auto">
                <table className="text-xs border-collapse"
                  style={{ width: `${tableWidth}px`, minWidth: `${tableWidth}px` }}>

                  <thead className="sticky top-0 z-10 bg-[#0d1117]">
                    {/* Sort row */}
                    <tr>
                      {visibleColumns.map(col => (
                        <th key={col.key}
                          onClick={(e) => handleSort(col.key, e.shiftKey)}
                          {...(col.headerTipHtml ? { 'data-tip-html': col.headerTipHtml } : {})}
                          style={{ width: col.width, minWidth: col.width }}
                          className={[
                            'px-2 py-2 font-medium border-b border-slate-700 whitespace-nowrap select-none cursor-pointer hover:bg-slate-800/60 transition-colors',
                            col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                            sortCol === col.key ? 'text-indigo-400 bg-slate-800/40' : secondarySortCol === col.key ? 'text-cyan-500 bg-slate-800/20' : 'text-slate-500',
                            col.headerTipHtml ? 'underline decoration-dotted decoration-slate-600 underline-offset-4' : '',
                          ].join(' ')}>
                          {col.label}
                          {sortCol === col.key
                            ? <span className="ml-1 text-indigo-400">{sortDir === 'desc' ? ' ↓' : ' ↑'}</span>
                            : secondarySortCol === col.key
                            ? <span className="ml-1 text-cyan-500">{secondarySortDir === 'desc' ? ' ²↓' : ' ²↑'}</span>
                            : null}
                        </th>
                      ))}
                    </tr>

                    {/* Filter row */}
                    <tr className="bg-[#0d1117]">
                      {visibleColumns.map(col => (
                        <th key={col.key}
                          style={{ width: col.width, minWidth: col.width }}
                          className="px-1 py-1 border-b border-slate-800">
                          <input
                            value={colFilters[col.key] ?? ''}
                            onChange={e => setColFilter(col.key, e.target.value)}
                            placeholder={col.numVal ? '>50' : '…'}
                            title={col.numVal ? 'Supports: >50  <80  >=60  <=70  =75  or text' : 'Contains match'}
                            className={[
                              'w-full px-1.5 py-0.5 bg-slate-800/80 border rounded text-xs text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-indigo-500 transition-colors',
                              colFilters[col.key] ? 'border-indigo-600 bg-indigo-950/30' : 'border-slate-700',
                            ].join(' ')}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {filteredResults.map((row, i) => {
                      const isSelected = selectedSymbol === row.symbol;
                      const diff = scanDiff.get(row.symbol);
                      return (
                        <tr key={row.symbol + i}
                          onClick={() => { setSelectedSymbol(isSelected ? null : row.symbol); if (!isSelected) setReviewedSymbols(prev => new Set(prev).add(row.symbol)); }}
                          style={{ borderLeft: `3px solid ${STAGE_CONFIG[row.stage].textColor}` }}
                          className={`cursor-pointer border-b border-slate-800/40 transition-colors group ${isSelected ? 'bg-indigo-900/25' : diff ? 'bg-cyan-900/10' : 'hover:bg-slate-800/40'} ${reviewedSymbols.has(row.symbol) && !isSelected ? 'opacity-70' : ''}`}>
                          {visibleColumns.map(col => (
                            <td key={col.key}
                              style={{ width: col.width, minWidth: col.width, ...(col.cellStyle ? col.cellStyle(row) : {}) }}
                              className={[
                                'px-2 py-1.5 whitespace-nowrap',
                                col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                                col.cellClass ? col.cellClass(row) : 'text-slate-300',
                              ].join(' ')}>
                              {col.key === 'brain' ? (() => {
                                const bs = brainScores[row.symbol];
                                if (!bs) return <span className="text-slate-700">—</span>;
                                const delta = bs.brain - bs.original;
                                const color = bs.brain >= 85 ? '#39FF14' : bs.brain >= 70 ? '#22d3ee' : bs.brain >= 55 ? '#facc15' : bs.brain >= 40 ? '#fb923c' : '#ef4444';
                                const arrow = delta > 3 ? '↑' : delta < -3 ? '↓' : '→';
                                const tipParts = bs.adjustments.map((a: {factor: string; adj: number; reason: string; engine?: string}) =>
                                  `<div class="rt-row"><div><span class="rt-badge ${a.adj>0?'bg-emerald':'bg-orange'}">${a.adj>=0?'+':''}${a.adj}</span></div><div><div class="rt-desc">${a.factor}: ${a.reason}${a.engine && a.engine !== 'Bayesian' ? ` <span style="opacity:0.6;font-size:9px">[${a.engine}]</span>` : ''}</div></div></div>`).join('');
                                return <div className="flex items-center gap-1 cursor-help"
                                  data-tip-html={`<div class="rt-hdr">🧠 Brain v3 — ${row.symbol.replace('.NS','').replace('.BO','')}</div><div class="rt-row"><div><span class="rt-badge bg-cyan">Original</span></div><div><div class="rt-desc">Conviction: ${bs.original} → Brain: ${bs.brain} (${delta>=0?'+':''}${delta})</div></div></div>${tipParts}<div class="rt-row"><div><span class="rt-badge bg-teal">Sizing</span></div><div><div class="rt-desc">${bs.riskLabel} (${bs.riskPct}% risk)</div></div></div><div class="rt-row"><div><span class="rt-badge bg-purple">Form</span></div><div><div class="rt-desc">${bs.formLabel} (EMA ${bs.formEMA}) · Trend: ${bs.formTrend}</div></div></div>${bs.anomalyCount > 0 ? `<div class="rt-row"><div><span class="rt-badge bg-orange">⚠ ${bs.anomalyCount} anomaly</span></div><div><div class="rt-desc">${bs.anomalyNote}</div></div></div>` : ''}<div class="rt-row"><div><span class="rt-badge bg-slate">CI</span></div><div><div class="rt-desc">Range ${bs.ciLow}-${bs.ciHigh} · ${bs.ciHigh-bs.ciLow<=20?'Narrow (reliable)':bs.ciHigh-bs.ciLow<=35?'Moderate':'Wide (need more trades)'}</div></div></div><div class="rt-row"><div><span class="rt-badge bg-cyan">Engines</span></div><div><div class="rt-desc">Bayesian + Thompson + Anomaly + Form EMA + Bandit</div></div></div>`}>
                                  <span className="font-mono font-bold text-[11px]" style={{color}}>{bs.brain}</span>
                                  <span className="text-[9px]" style={{color: delta > 0 ? '#4ade80' : delta < 0 ? '#f87171' : '#94a3b8'}}>{arrow}</span>
                                  {bs.priority === 1 && <span className="ml-0.5 px-0.5 bg-yellow-500/30 border border-yellow-500 rounded text-[7px] text-yellow-300 font-bold">#1</span>}
                                </div>;
                              })() : col.key === 'sat_signal' ? (() => {
                                const s = satMap[row.symbol];
                                if (!s || s.signal === 'NONE' || s.trend === 0) return <span className="text-slate-700">—</span>;
                                const isBull = s.trend === 1;
                                const factorVal = isBull ? s.bullishFactor : s.bearishFactor;
                                const conf = isBull ? s.bullishConfidence : s.bearishConfidence;
                                const confPct = Math.round(conf * 100);
                                const signalLabels: Record<string, string> = { BUY: '▲ BUY', BOUNCE_UP: '↗ BOUNCE↑', UP: '▲ UP', SELL: '▼ SELL', BOUNCE_DOWN: '↘ BOUNCE↓', DOWN: '▼ DOWN' };
                                const cellColor = s.signal === 'BUY' ? '#00ffbb' : s.signal === 'BOUNCE_UP' ? '#4ade80' : s.signal === 'UP' ? '#86efac' : s.signal === 'SELL' ? '#ff1100' : s.signal === 'BOUNCE_DOWN' ? '#f87171' : '#fca5a5';
                                const label = signalLabels[s.signal] ?? s.signal;
                                const samples = isBull ? s.bullishSamples : s.bearishSamples;
                                const tipHtml = `<div class="rt-hdr">SAT — ${row.symbol.replace('.NS','').replace('.BO','')}</div>`
                                  + `<div class="rt-row"><div><span class="rt-badge ${isBull ? 'bg-neon' : 'bg-red'}">${label}</span></div><div><div class="rt-desc">Trend: ${isBull ? 'UP ▲' : 'DOWN ▼'} | Supertrend: ₹${s.superTrend.toFixed(1)} | Distance: ${s.distancePct.toFixed(1)}% from price</div></div></div>`
                                  + `<div class="rt-row"><div><span class="rt-badge bg-cyan">Learned Factor</span></div><div><div class="rt-desc">${factorVal.toFixed(2)}× ATR — learned from ${samples} past pullbacks (${confPct}% confident)</div></div></div>`
                                  + `<div class="rt-row"><div><span class="rt-badge bg-yellow">Up Factor</span></div><div><div class="rt-desc">${s.bullishFactor.toFixed(2)}× ATR (${s.bullishSamples} samples)</div></div></div>`
                                  + `<div class="rt-row"><div><span class="rt-badge bg-orange">Down Factor</span></div><div><div class="rt-desc">${s.bearishFactor.toFixed(2)}× ATR (${s.bearishSamples} samples)</div></div></div>`;
                                return <div className="flex items-center gap-1 font-mono text-[10px] cursor-help" data-tip-html={tipHtml}>
                                  <span className="font-bold" style={{color: cellColor}}>{label}</span>
                                  <span className="text-[9px] text-slate-400">{factorVal.toFixed(1)}×{confPct < 100 ? <span className="text-slate-600"> {confPct}%</span> : ''}</span>
                                </div>;
                              })() : col.key === 'clenow' ? (() => {
                                const cl = clenowMap[row.symbol];
                                if (!cl) return <span className="text-slate-700">—</span>;
                                const color = cl.r2 >= 0.7 ? '#22d3ee' : cl.r2 >= 0.4 ? '#facc15' : '#64748b';
                                const label = cl.r2 >= 0.7 ? 'S' : cl.r2 >= 0.4 ? 'M' : 'C';
                                return <div className="flex items-center gap-1 font-mono text-[10px]" title={`Clenow: ${cl.score.toFixed(0)} | Ann: ${cl.annReturn >= 0 ? '+' : ''}${cl.annReturn.toFixed(0)}% | R²: ${cl.r2.toFixed(2)} | ${cl.quality}`}>
                                  <span className="font-bold" style={{color}}>{cl.score.toFixed(0)}</span>
                                  <span className="px-0.5 rounded text-[8px] font-bold" style={{color, borderColor: color, border: '1px solid'}}>{label}</span>
                                </div>;
                              })() : col.key === 'monster' ? (() => {
                                const m = row.monster;
                                if (!m || m.badges.length === 0) return <span className="text-slate-700">—</span>;
                                const tipParts = m.badges.map(b => {
                                  const emoji = b.type === 'MOM' ? '🚀' : '🔄';
                                  const label = b.type === 'MOM' ? 'Momentum' : 'Mean Reversion';
                                  const bg = b.type === 'MOM' ? 'bg-emerald' : 'bg-cyan';
                                  return `<div class="rt-row"><div><span class="rt-badge ${bg}">${emoji} ${label}</span></div><div><div class="rt-desc">${b.details}</div><div class="rt-hit hit-green">${b.probability}% monster probability (>10% MFE in 20d)</div></div></div>`;
                                }).join('');
                                return <div className="flex items-center gap-0.5 cursor-help"
                                  data-tip-html={`<div class="rt-hdr">🔮 Monster Scan v2 — ${row.symbol.replace('.NS','').replace('.BO','')}</div>${tipParts}<div class="rt-row"><div><span class="rt-badge bg-slate">Method</span></div><div><div class="rt-desc">OOS-validated on 146,425 points across 455 Nifty 500 stocks (60/40 train/test split). Baseline monster rate: 35.0%. Breakout (BRK) pattern was removed after validation showed no real edge.</div></div></div>`}>
                                  {m.badges.map((b, bi) => {
                                    const emoji = b.type === 'MOM' ? '🚀' : '🔄';
                                    const color = b.probability >= 80 ? '#39FF14' : b.probability >= 60 ? '#22d3ee' : '#facc15';
                                    return <span key={bi} className="text-[9px] font-bold" style={{color}}>{emoji}{b.type}</span>;
                                  })}
                                  <span className="text-[8px] ml-0.5" style={{color: m.topProbability >= 80 ? '#39FF14' : '#22d3ee'}}>{m.topProbability}%</span>
                                </div>;
                              })() : col.key === 'pcaScore' ? (() => {
                                const pca = pcaMap[row.symbol];
                                if (!pca) return <span className="text-slate-700">—</span>;
                                const color = pca.rank === 'S' ? '#39FF14' : pca.rank === 'A' ? '#4ade80' : pca.rank === 'B' ? '#22d3ee' : pca.rank === 'C' ? '#facc15' : pca.rank === 'D' ? '#fb923c' : '#ef4444';
                                const spColor = pca.species === 'TRIPLE THREAT' ? 'bg-neon' : pca.species === 'VOL EXPLOSION' ? 'bg-yellow' : pca.species === 'COMPRESSION' ? 'bg-cyan' : pca.species === 'STRONG CANDLE' ? 'bg-emerald' : 'bg-slate';
                                const spDesc = pca.species === 'TRIPLE THREAT' ? 'All 3 factors strong — MAX SIZE' : pca.species === 'VOL EXPLOSION' ? 'Volume-driven — quick T1 exit' : pca.species === 'COMPRESSION' ? 'Compression spring — hold for T3' : pca.species === 'STRONG CANDLE' ? 'Clean candle — standard exit' : pca.species === 'BUILDING' ? 'Building — not ready' : 'Early — monitor only';
                                return <div className="flex items-center gap-1 font-mono text-[10px] cursor-help"
                                  data-tip-html={`<div class="rt-hdr">${pca.speciesEmoji} PCA — ${row.symbol.replace('.NS','').replace('.BO','')}</div>`
                                    + `<div class="rt-row"><div><span class="rt-badge bg-neon">Score</span></div><div><div class="rt-desc">${pca.score.toFixed(2)} | Rank ${pca.rank} | P${pca.pctl}</div></div></div>`
                                    + `<div class="rt-row"><div><span class="rt-badge ${spColor}">${pca.speciesEmoji} ${pca.species}</span></div><div><div class="rt-desc">${spDesc}</div></div></div>`
                                    + `<div class="rt-row"><div><span class="rt-badge bg-orange">Candle</span></div><div><div class="rt-desc">${pca.candle.toFixed(1)}/10</div></div></div>`
                                    + `<div class="rt-row"><div><span class="rt-badge bg-cyan">Compress</span></div><div><div class="rt-desc">${pca.compression.toFixed(1)}/10</div></div></div>`
                                    + `<div class="rt-row"><div><span class="rt-badge bg-yellow">Volume</span></div><div><div class="rt-desc">${pca.volume.toFixed(1)}/10</div></div></div>`
                                    + `<div class="rt-row"><div><span class="rt-badge bg-slate">WR</span></div><div><div class="rt-desc">${pca.rank === 'S' ? '59.8%' : pca.rank === 'A' ? '56.8%' : pca.rank === 'B' ? '56.4%' : pca.rank === 'C' ? '53.1%' : pca.rank === 'D' ? '49.2%' : '49.5%'} expected win rate (backtested, 456 stocks)</div></div></div>`}>
                                  <span className="font-bold" style={{color}}>{pca.score.toFixed(1)}</span>
                                  <span className="px-0.5 rounded text-[8px] font-bold" style={{color, borderColor: color, border: '1px solid'}}>{pca.rank}</span>
                                </div>;
                              })() : col.key === 'conviction' ? (() => {
                                const c = computeConviction(row);
                                const color = c >= 70 ? '#facc15' : c >= 50 ? '#34d399' : c >= 30 ? '#94a3b8' : '#475569';
                                return <div className="flex items-center gap-1">
                                  <span className="font-mono font-bold text-[11px]" style={{color}}>{c}</span>
                                  <div className="w-8 h-1.5 bg-slate-800 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width:`${c}%`, backgroundColor:color}} /></div>
                                </div>;
                              })() : (col.key === 'pivot_pp' || col.key === 'pivot_r1' || col.key === 'pivot_s1') ? (() => {
                                const piv = pivotData.get(row.symbol);
                                if (!piv) return <span className="text-slate-700">—</span>;
                                const val = col.key === 'pivot_pp' ? piv.classic.pp : col.key === 'pivot_r1' ? piv.classic.r1 : piv.classic.s1;
                                const isAbove = piv.cmp > val;
                                return <span className={`font-mono ${col.key === 'pivot_r1' ? 'text-red-400' : col.key === 'pivot_s1' ? 'text-emerald-400' : isAbove ? 'text-emerald-400' : 'text-red-400'}`} title={`${col.key === 'pivot_pp' ? 'Pivot Point' : col.key === 'pivot_r1' ? 'Resistance 1' : 'Support 1'} (Classic) | CMP ${piv.position}`}>₹{val.toFixed(0)}</span>;
                              })() : col.key === 'rs_rank' ? (() => {
                                const rs = rsData.get(row.symbol);
                                if (!rs) return <span className="text-slate-600">—</span>;
                                return <span className={`font-mono ${rs.rsRank >= 80 ? 'text-green-300 font-bold' : rs.rsRank >= 60 ? 'text-emerald-400' : rs.rsRank >= 40 ? 'text-slate-300' : rs.rsRank >= 20 ? 'text-amber-400' : 'text-red-400'}`} title={`RS: ${rs.rs52w.toFixed(0)} | Slope: ${rs.rsSlope.toFixed(1)} | ${rs.rsStatus}`}>{rs.rsRank}</span>;
                              })() : col.key === 'tf_align' ? (() => {
                                const tf = tfAlignments.get(row.symbol);
                                if (!tf) return <span className="text-slate-700">—</span>;
                                return <span className={`font-semibold ${tf.alignment === 'DW' ? 'text-green-300' : tf.alignment === 'D' ? 'text-yellow-300' : 'text-slate-600'}`} title={tf.alignment === 'DW' ? 'Daily + Weekly aligned' : tf.alignment === 'D' ? 'Daily only (weekly compressing)' : 'No alignment'}>{tf.alignment}</span>;
                              })() : col.key === 'track_btn' ? (
                                <div className="flex gap-0.5">
                                  <button onClick={(e) => { e.stopPropagation(); trackTrade(row); }}
                                    className={`text-[10px] px-1 py-0.5 rounded transition-colors ${trackedTrades.some(t => t.symbol === row.symbol) ? 'bg-emerald-900/40 text-emerald-400' : 'bg-slate-700 hover:bg-emerald-900/40 text-slate-500 hover:text-emerald-300'}`}>
                                    {trackedTrades.some(t => t.symbol === row.symbol) ? '✓' : '📌'}</button>
                                  <button onClick={(e) => { e.stopPropagation(); setCompareList(prev => prev.includes(row.symbol) ? prev.filter(s => s !== row.symbol) : prev.length < 3 ? [...prev, row.symbol] : prev); }}
                                    className={`text-[10px] px-1 py-0.5 rounded transition-colors ${compareList.includes(row.symbol) ? 'bg-indigo-900/40 text-indigo-300' : 'opacity-0 group-hover:opacity-100 bg-slate-700 hover:bg-indigo-900/40 text-slate-600 hover:text-indigo-300'}`}
                                    title="Add to compare (max 3)">⇔</button>
                                </div>
                              ) : col.fmt(row)}
                              {col.key === 'symbol' && (
                                <button onClick={(e) => { e.stopPropagation(); const ta = document.createElement('textarea'); ta.value = row.symbol.replace('.NS','').replace('.BO',''); ta.style.cssText='position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }}
                                  className="ml-0.5 text-slate-700 hover:text-slate-400 text-[9px] opacity-0 group-hover:opacity-100 transition-opacity" title="Copy symbol">⧉</button>
                              )}
                              {col.key === 'symbol' && diff && (
                                <span className="ml-0.5 px-1 py-0 bg-cyan-900/50 border border-cyan-700 rounded text-[8px] text-cyan-300 font-bold" title={`Upgraded from ${STAGE_CONFIG[diff.prev].label}`}>NEW</span>
                              )}
                              {col.key === 'symbol' && row.nearBreakout && !diff && (
                                <span className="ml-0.5 text-yellow-400 text-xs" title="Near breakout">⚡</span>
                              )}
                              {col.key === 'symbol' && flagMap[row.symbol] && (
                                <span className="ml-1 px-1.5 py-0.5 bg-orange-900/60 border border-orange-500 rounded text-[9px] text-orange-200 font-bold cursor-help inline-block"
                                  data-tip-html={`<div class="rt-hdr">🚩 Flag Pattern — Stock Bee Setup</div><div class="rt-row"><div><span class="rt-badge bg-orange">Pole</span></div><div><div class="rt-desc">+${flagMap[row.symbol].poleGain.toFixed(0)}% surge in 1-5 days on heavy volume — the thrust move that started it all</div></div></div><div class="rt-row"><div><span class="rt-badge bg-yellow">Flag</span></div><div><div class="rt-desc">${flagMap[row.symbol].flagDays} days of tight consolidation — sellers exhausted, buyers accumulating quietly</div></div></div><div class="rt-row"><div><span class="rt-badge bg-emerald">Breakout</span></div><div><div class="rt-desc">Price just broke above the flag high with volume — continuation move starting NOW</div></div></div><div class="rt-row"><div><span class="rt-badge bg-neon">Target</span></div><div><div class="rt-desc">Measured move target: Rs.${flagMap[row.symbol].measuredTarget.toFixed(0)} (pole length added to breakout)</div><div class="rt-hit hit-green">71.8% hit rate · R:R 2.51 · Double conviction setup</div></div></div>`}>🚩 FLAG +{flagMap[row.symbol].poleGain.toFixed(0)}%</span>
                              )}
                              {col.key === 'symbol' && guppyCoilMap[row.symbol] && (
                                <span className="ml-1 px-1.5 py-0.5 bg-cyan-900/60 border border-cyan-400 rounded text-[9px] text-cyan-200 font-bold cursor-help inline-block"
                                  data-tip-html={`<div class="rt-hdr">💎 Guppy Coiled — Maximum Compression Breakout</div><div class="rt-row"><div><span class="rt-badge bg-cyan">Compression</span></div><div><div class="rt-desc">All 12 Guppy EMAs compressed to just ${guppyCoilMap[row.symbol].avgSpread.toFixed(1)}% spread (min ${guppyCoilMap[row.symbol].minSpread.toFixed(1)}%) during the zone</div></div></div><div class="rt-row"><div><span class="rt-badge bg-teal">Energy</span></div><div><div class="rt-desc">Like a spring coiled to its maximum — all moving averages converged, volatility at rock bottom, massive energy stored</div></div></div><div class="rt-row"><div><span class="rt-badge bg-neon">Breakout</span></div><div><div class="rt-desc">The coil is now releasing — price breaking out with volume confirmation</div></div></div><div class="rt-row"><div><span class="rt-badge bg-emerald">History</span></div><div><div class="rt-desc">Monster moves start here: OSWALAGRO +55%, NATIONALUM +48%, KTKBANK +25%, DHANUKA +55%</div><div class="rt-hit hit-green">Highest conviction setup · Maximum stored energy</div></div></div>`}>💎 COILED {guppyCoilMap[row.symbol].avgSpread.toFixed(1)}%</span>
                              )}
                              {col.key === 'symbol' && (flagMap[row.symbol] || guppyCoilMap[row.symbol]) && ['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(row.stage) && (
                                <span className="ml-1 px-1 py-0.5 bg-purple-900/60 border border-purple-400 rounded text-[9px] text-purple-200 font-bold cursor-help inline-block"
                                  data-tip-html={`<div class="rt-hdr">⚡ Setup Quality — ${row.symbol.replace('.NS','').replace('.BO','')}</div>${guppyCoilMap[row.symbol] ? `<div class="rt-row"><div><span class="rt-badge bg-cyan">💎 COILED</span></div><div><div class="rt-desc">Guppy EMAs compressed to ${guppyCoilMap[row.symbol].avgSpread.toFixed(1)}% — maximum stored energy.</div><div class="rt-hit hit-green">Highest conviction overlay</div></div></div>` : ''}${flagMap[row.symbol] ? `<div class="rt-row"><div><span class="rt-badge bg-orange">🚩 FLAG</span></div><div><div class="rt-desc">Prior +${flagMap[row.symbol].poleGain.toFixed(0)}% pole → ${flagMap[row.symbol].flagDays}d consolidation. Target Rs.${flagMap[row.symbol].measuredTarget.toFixed(0)}</div><div class="rt-hit hit-cyan">R:R 2.51 · Continuation</div></div></div>` : ''}<div class="rt-row"><div><span class="rt-badge bg-neon">ACTION</span></div><div><div class="rt-desc">${guppyCoilMap[row.symbol] && flagMap[row.symbol] ? 'RARE DOUBLE SETUP: Both Guppy coil + Flag. Highest conviction — prioritize this trade.' : guppyCoilMap[row.symbol] ? 'Guppy coil breakout — expect above-average move.' : 'Flag continuation — use measured move target.'}</div></div></div>`}>⚡{guppyCoilMap[row.symbol] && flagMap[row.symbol] ? 'DOUBLE' : 'SETUP'}</span>
                              )}
                              {col.key === 'symbol' && (() => {
                                const age = getSignalAge(row.symbol, row.stage, signalHistory);
                                if (age === 1) return <span className="ml-1 text-green-400 text-xs font-bold" title="New signal today">●</span>;
                                if (age >= 2) return <span className="ml-1 text-amber-500 text-xs" title={`Signal Day ${age}`}>{age}d</span>;
                                return null;
                              })()}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        </>}

        {/* ── Quick Compare Panel ── */}
        {compareList.length >= 2 && (
          <div className="w-80 flex-shrink-0 border-l border-indigo-800/50 bg-[#0d1117] overflow-y-auto p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-indigo-400 font-semibold uppercase tracking-wider">Compare ({compareList.length})</span>
              <button onClick={() => setCompareList([])} className="text-xs text-slate-600 hover:text-slate-300">Clear ×</button>
            </div>
            <table className="w-full text-[10px]">
              <thead><tr className="text-slate-500 border-b border-slate-700">
                <th className="text-left py-1">Metric</th>
                {compareList.map(sym => <th key={sym} className="text-right py-1 font-mono text-slate-300">{sym.replace('.NS','').replace('.BO','')}</th>)}
              </tr></thead>
              <tbody>
                {(() => {
                  const cr = compareList.map(sym => results.find(r => r.symbol === sym)).filter(Boolean) as AnalysisResult[];
                  if (cr.length < 2) return null;
                  const metrics = [
                    { label: 'Stage', fn: (r: AnalysisResult) => STAGE_CONFIG[r.stage].label, color: (r: AnalysisResult) => STAGE_CONFIG[r.stage].color },
                    { label: 'Conviction', fn: (r: AnalysisResult) => String(computeConviction(r)), color: (r: AnalysisResult) => computeConviction(r) >= 70 ? 'text-yellow-300' : 'text-slate-300' },
                    { label: 'Entry ₹', fn: (r: AnalysisResult) => r.priceEngine.plannedEntry.toFixed(2), color: () => 'text-slate-200' },
                    { label: 'Stop ₹', fn: (r: AnalysisResult) => r.priceEngine.tacticalStop.toFixed(2), color: () => 'text-red-400' },
                    { label: 'T1 ₹', fn: (r: AnalysisResult) => r.priceEngine.target5.toFixed(2), color: () => 'text-emerald-400' },
                    { label: 'R:R', fn: (r: AnalysisResult) => r.priceEngine.rewardRisk.toFixed(2), color: (r: AnalysisResult) => rrVerdictColor(r.priceEngine.rewardRisk) },
                    { label: 'Risk%', fn: (r: AnalysisResult) => r.priceEngine.tacticalRiskPct.toFixed(1) + '%', color: (r: AnalysisResult) => r.priceEngine.tacticalRiskPct <= 2 ? 'text-emerald-400' : 'text-amber-400' },
                    { label: 'RS Rank', fn: (r: AnalysisResult) => String(rsData.get(r.symbol)?.rsRank ?? '—'), color: (r: AnalysisResult) => (rsData.get(r.symbol)?.rsRank ?? 0) >= 70 ? 'text-emerald-400' : 'text-slate-400' },
                    { label: 'Candle', fn: (r: AnalysisResult) => r.stats?.candlePatternFull ?? '—', color: (r: AnalysisResult) => r.stats?.candlePatternType === 'bullish' ? 'text-emerald-400' : 'text-slate-400' },
                    { label: 'Sector', fn: (r: AnalysisResult) => getSectorTag(r.symbol) || '—', color: () => 'text-slate-500' },
                    { label: 'MomScore', fn: (r: AnalysisResult) => String(r.momentum?.momentumScore ?? '—'), color: (r: AnalysisResult) => (r.momentum?.momentumScore ?? 0) >= 60 ? 'text-emerald-400' : 'text-slate-400' },
                  ];
                  return metrics.map(m => (
                    <tr key={m.label} className="border-b border-slate-800/30">
                      <td className="py-0.5 text-slate-500">{m.label}</td>
                      {cr.map(r => <td key={r.symbol} className={`py-0.5 text-right font-mono ${m.color(r)}`}>{m.fn(r)}</td>)}
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Trade Desk fallback sidebar: symbol clicked but not in current scan ── */}
        {!selectedResult && selectedSymbol && activeTab === 'tradedesk' && (() => {
          const trade = trackedTrades.find(t => t.symbol === selectedSymbol);
          if (!trade) return null;
          const rps = trade.entryPrice - trade.stopLoss;
          const curPnl = trade.currentPrice && trade.entryPrice > 0 ? ((trade.currentPrice - trade.entryPrice) / trade.entryPrice) * 100 : null;
          const mfePct = trade.highestPrice && trade.entryPrice > 0 ? ((trade.highestPrice - trade.entryPrice) / trade.entryPrice) * 100 : null;
          const statusCfg: Record<string,{label:string;color:string}> = {
            open: { label: 'OPEN', color: 'text-blue-300 bg-blue-900/40' },
            hit_t1: { label: '✓ T1 Hit', color: 'text-emerald-300 bg-emerald-900/40' },
            hit_t2: { label: '✓ T2 Hit', color: 'text-emerald-200 bg-emerald-900/40' },
            hit_t3: { label: '✓ T3 Hit', color: 'text-yellow-300 bg-yellow-900/40' },
            stopped: { label: '✗ Stopped', color: 'text-red-300 bg-red-900/40' },
            expired: { label: '⏳ Expired', color: 'text-amber-300 bg-amber-900/40' },
          };
          const sc = statusCfg[trade.status] ?? { label: trade.status, color: 'text-slate-400 bg-slate-800/40' };
          return (
            <div className="w-80 flex-shrink-0 border-l border-slate-800 bg-[#0d1117] overflow-y-auto">
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-mono font-bold text-slate-100 text-base">{trade.symbol.replace('.NS','').replace('.BO','')}</div>
                    <div className="text-xs text-slate-500 mt-0.5">Entry date: {trade.entryDate}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${sc.color}`}>{sc.label}</span>
                    <button onClick={() => setSelectedSymbol(null)} className="text-slate-600 hover:text-slate-300 text-lg leading-none">×</button>
                  </div>
                </div>
                <div className="space-y-3">
                  {/* Price levels */}
                  <div className="bg-slate-800/40 rounded-lg p-3 space-y-1.5 text-xs">
                    <div className="text-slate-500 font-semibold uppercase text-[10px] tracking-wider mb-2">Trade Levels</div>
                    {[
                      { label: 'Entry', val: `₹${trade.entryPrice.toFixed(2)}`, color: 'text-slate-200' },
                      { label: 'Stop Loss', val: `₹${trade.stopLoss.toFixed(2)}`, color: 'text-red-400' },
                      { label: 'Risk/Share', val: `₹${rps.toFixed(2)} (${(rps/trade.entryPrice*100).toFixed(1)}%)`, color: 'text-amber-400' },
                      { label: 'Target 1', val: `₹${trade.target1.toFixed(2)}`, color: 'text-emerald-400' },
                      { label: 'Target 2', val: trade.target2 ? `₹${trade.target2.toFixed(2)}` : '—', color: 'text-emerald-300' },
                      { label: 'Target 3', val: trade.target3 ? `₹${trade.target3.toFixed(2)}` : '—', color: 'text-yellow-300' },
                      ...(trade.currentPrice ? [{ label: 'CMP', val: `₹${trade.currentPrice.toFixed(2)}`, color: 'text-slate-300' }] : []),
                    ].map(row => (
                      <div key={row.label} className="flex justify-between">
                        <span className="text-slate-500">{row.label}</span>
                        <span className={`font-mono font-semibold ${row.color}`}>{row.val}</span>
                      </div>
                    ))}
                  </div>
                  {/* P&L & Excursion */}
                  <div className="bg-slate-800/40 rounded-lg p-3 space-y-1.5 text-xs">
                    <div className="text-slate-500 font-semibold uppercase text-[10px] tracking-wider mb-2">P&L & Excursion</div>
                    {curPnl !== null && <div className="flex justify-between"><span className="text-slate-500">Current P&L</span><span className={`font-mono font-bold ${curPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{curPnl >= 0 ? '+' : ''}{curPnl.toFixed(2)}%</span></div>}
                    {trade.pnlPct != null && trade.status !== 'open' && <div className="flex justify-between"><span className="text-slate-500">Final P&L</span><span className={`font-mono font-bold ${trade.pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{trade.pnlPct >= 0 ? '+' : ''}{trade.pnlPct.toFixed(2)}%</span></div>}
                    {mfePct !== null && <div className="flex justify-between"><span className="text-slate-500">Max Favorable (MFE)</span><span className="font-mono text-emerald-300">+{mfePct.toFixed(2)}%</span></div>}
                    {trade.daysHeld != null && <div className="flex justify-between"><span className="text-slate-500">Days held</span><span className="font-mono text-slate-300">{trade.daysHeld}</span></div>}
                    {trade.pnlR != null && <div className="flex justify-between"><span className="text-slate-500">P&L in R</span><span className={`font-mono font-bold ${trade.pnlR >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{trade.pnlR >= 0 ? '+' : ''}{trade.pnlR.toFixed(2)}R</span></div>}
                  </div>
                  {/* Gate log */}
                  {trade.gateLog && trade.gateLog.length > 0 && (
                    <div className="bg-slate-800/40 rounded-lg p-3 text-xs">
                      <div className="text-slate-500 font-semibold uppercase text-[10px] tracking-wider mb-2">Gate Shield Log ({trade.gateLog.filter(e => e.result === 'SHIELDED').length} shields)</div>
                      <div className="space-y-1">
                        {trade.gateLog.slice(-8).map((entry, gi) => (
                          <div key={gi} className="flex items-center gap-2 text-[10px]">
                            <span className={`font-bold w-8 ${entry.result === 'SHIELDED' ? 'text-emerald-400' : 'text-red-400'}`}>D{entry.day}{entry.result === 'SHIELDED' ? '🛡' : '🛑'}</span>
                            <span className="text-slate-600">{entry.dipPct.toFixed(1)}%↓</span>
                            <span className={`text-[9px] ${entry.result === 'SHIELDED' ? 'text-emerald-600' : 'text-red-600'}`}>{entry.result}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Metadata */}
                  <div className="text-[10px] text-slate-700 space-y-0.5">
                    {trade.paramSetKey && <div>Param set: <span className="text-slate-500">{trade.paramSetKey}</span></div>}
                    {trade.sector && <div>Sector: <span className="text-slate-500">{trade.sector}</span></div>}
                    {trade.stage && <div>Stage: <span className="text-slate-500">{trade.stage}</span></div>}
                    <div className="mt-1 text-slate-700 italic">Symbol not in current scan — run a fresh scan to see live analysis</div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── Detail panel (shared across tabs) ── */}
        {selectedResult && (activeTab === 'scanner' || activeTab === 'focus' || activeTab === 'validation' || activeTab === 'tradedesk') && (
          <div className="w-80 flex-shrink-0 border-l border-slate-800 bg-[#0d1117] overflow-y-auto">
            <div className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-mono font-bold text-slate-100 text-base">{selectedResult.symbol}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{selectedResult.lastDate} · ₹{selectedResult.lastClose.toFixed(2)}</div>
                  {(() => {
                    const onset = detectOnsetCandle(selectedResult);
                    if (!onset) return null;
                    const labels: Record<string, { label: string; desc: string }> = {
                      STRONG: { label: '★ Strong Onset (R-EXP)', desc: 'Extreme range expansion: eRA≥3.0×ATR, closeLoc≥75%, body≥50% — 65.5% OOS hit-5% rate, +3.5pp vs 62.0% baseline' },
                    };
                    const cfg = labels[onset];
                    return (
                      <div className={`mt-1 px-2 py-1 rounded text-[10px] font-semibold ${onset === 'STRONG' ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-700' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
                        <div>{cfg.label}</div>
                        <div className="font-normal text-[9px] opacity-70 mt-0.5">{cfg.desc}</div>
                      </div>
                    );
                  })()}
                </div>
                <button onClick={() => setSelectedSymbol(null)}
                  className="text-slate-600 hover:text-slate-300 text-xl leading-none ml-2 mt-0.5">×</button>
              </div>

              <div style={{ borderColor: STAGE_CONFIG[selectedResult.stage].textColor, color: STAGE_CONFIG[selectedResult.stage].textColor }}
                className="border rounded px-2 py-1 text-xs font-bold mb-4 inline-block">
                {STAGE_CONFIG[selectedResult.stage].label}
              </div>

              <div className="grid grid-cols-2 gap-2 mb-4">
                {([
                  ['Infl. Score', selectedResult.inflectionScore.toFixed(0)],
                  ['Prec. Score', selectedResult.ultraPrecisionScore.toFixed(0)],
                  ['Confidence',  selectedResult.confidence.toFixed(0) + '%'],
                  ['Conditions',  `${selectedResult.conditionsMet} / ${selectedResult.totalConditions}`],
                ] as [string, string][]).map(([label, val]) => (
                  <div key={label} className="bg-slate-800/60 rounded px-2.5 py-2">
                    <div className="text-xs text-slate-500">{label}</div>
                    <div className="text-sm font-semibold text-slate-200 mt-0.5">{val}</div>
                  </div>
                ))}
              </div>

              {/* Watchlist star + Signal Age */}
              <div className="flex items-center gap-2 mb-3">
                <button onClick={() => {
                  const exists = watchlist.some(w => w.symbol === selectedResult.symbol);
                  if (exists) { const updated = watchlist.filter(w => w.symbol !== selectedResult.symbol); setWatchlist(updated); saveWatchlist(updated); }
                  else { const item: WatchlistItem = { symbol: selectedResult.symbol, note: '', addedDate: new Date().toISOString().slice(0,10), stage: selectedResult.stage, lastClose: selectedResult.lastClose }; const updated = [...watchlist, item]; setWatchlist(updated); saveWatchlist(updated); }
                }}
                  className={`px-2 py-1 rounded text-xs border transition-colors ${watchlist.some(w => w.symbol === selectedResult.symbol) ? 'bg-amber-900/50 border-amber-600 text-amber-300' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-amber-300'}`}>
                  {watchlist.some(w => w.symbol === selectedResult.symbol) ? '⭐ Watched' : '☆ Watch'}
                </button>
                {(() => {
                  const age = getSignalAge(selectedResult.symbol, selectedResult.stage, signalHistory);
                  if (age > 0) return <span className={`px-2 py-0.5 rounded text-xs font-medium ${age === 1 ? 'bg-green-900/40 text-green-300' : age <= 3 ? 'bg-amber-900/40 text-amber-300' : 'bg-red-900/40 text-red-300'}`}>{age === 1 ? 'NEW' : `Day ${age}`}</span>;
                  return null;
                })()}
              </div>

              {/* #1: Inline sparkline chart */}
              {candleCache[selectedResult.symbol] && (
                <div className="mb-3" dangerouslySetInnerHTML={{ __html: generateSparklineSVG(
                  candleCache[selectedResult.symbol],
                  selectedResult.zone?.zoneHigh,
                  selectedResult.zone?.zoneLow,
                  selectedResult.priceEngine.tradeValid ? selectedResult.priceEngine.plannedEntry : undefined,
                  selectedResult.priceEngine.tradeValid ? selectedResult.priceEngine.tacticalStop : undefined,
                  selectedResult.priceEngine.tradeValid ? selectedResult.priceEngine.target5 : undefined,
                  selectedResult.zone?.windowLength,
                  selectedResult.zone?.zoneTightnessPct,
                  selectedResult.zone?.zoneATRRatio,
                  selectedResult.zone?.zoneShape,
                ) }} />
              )}

              {/* #1 Trade Sheet + #2 Track buttons — always visible */}
              <div className="flex gap-2 mb-3">
                <button onClick={() => { trackTrade(selectedResult); }}
                  className={`flex-1 px-2 py-1.5 border rounded text-xs font-medium transition-colors ${selectedResult.priceEngine.tradeValid ? 'bg-emerald-900/40 hover:bg-emerald-900/60 border-emerald-700 text-emerald-300' : 'bg-amber-900/30 hover:bg-amber-900/50 border-amber-700 text-amber-400'}`}>
                  {trackedTrades.some(t => t.symbol === selectedResult.symbol) ? '✓ Tracked' : selectedResult.priceEngine.tradeValid ? '📌 Track Trade' : '⚠ Track (R:R low)'}
                </button>
                  {(() => {
                    const regimeMult = marketRegime?.sizingMultiplier ?? 1;
                    const ts = generateTradeSheet(selectedResult, accountSize * regimeMult);
                    const piv = pivotData.get(selectedResult.symbol);
                    if (ts && piv) {
                      ts.pivotPP = piv.classic.pp; ts.pivotR1 = piv.classic.r1; ts.pivotR2 = piv.classic.r2;
                      ts.pivotS1 = piv.classic.s1; ts.pivotS2 = piv.classic.s2; ts.pivotPosition = piv.position;
                      ts.pivotConfluence = piv.confluence.slice(0, 3).map(c => `₹${c.price.toFixed(0)} (${c.strength}m, ${c.type})`).join(' | ');
                      const warns = checkTargetPivotConflict(ts.entry, ts.stopLoss, ts.target1, ts.target2, piv);
                      ts.pivotWarnings = warns.map(w => w.warning);
                    }
                    const sheetText = ts ? tradeSheetToClipboard(ts) : '';
                    return (
                      <div className="flex-1">
                        <button onClick={() => {
                          if (!sheetText) { setShowTradeSheet('no_data'); setTimeout(() => setShowTradeSheet(null), 2000); return; }
                          const ta = document.createElement('textarea'); ta.value = sheetText; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
                          document.body.appendChild(ta); ta.select();
                          try { document.execCommand('copy'); } catch {}
                          document.body.removeChild(ta);
                          try { navigator.clipboard.writeText(sheetText).catch(() => {}); } catch {}
                          setShowTradeSheet(selectedResult.symbol === showTradeSheet ? null : selectedResult.symbol);
                        }}
                          className="w-full px-2 py-1.5 bg-blue-900/40 hover:bg-blue-900/60 border border-blue-700 rounded text-xs font-medium text-blue-300 transition-colors">
                          {showTradeSheet === selectedResult.symbol ? '✓ Copied!' : showTradeSheet === 'no_data' ? '⚠ No entry/SL' : '📋 Trade Sheet'}
                        </button>
                        {/* Inline trade sheet (shown on click) */}
                        {showTradeSheet === selectedResult.symbol && sheetText && (
                          <div className="mt-2">
                            <div className="bg-gradient-to-br from-[#0f172a] to-[#020617] border-2 border-blue-500/40 rounded-lg p-2.5 shadow-lg">
                              <div className="text-[9px] font-mono leading-relaxed">
                                {sheetText.split('\n').map((line, i) => (
                                  <div key={i} className={
                                    line.startsWith('═══') ? 'text-blue-400 font-bold mb-0.5' :
                                    line.startsWith('SYMBOL') ? 'text-white font-bold' :
                                    line.startsWith('ENTRY') ? 'text-slate-200' :
                                    line.startsWith('STOP') ? 'text-red-400' :
                                    line.startsWith('TARGET') ? 'text-emerald-400' :
                                    line.startsWith('R1') || line.startsWith('R2') ? 'text-red-300' :
                                    line.startsWith('S1') || line.startsWith('S2') ? 'text-emerald-300' :
                                    line.startsWith('PP') ? 'text-yellow-300' :
                                    line.startsWith('Position') || line.startsWith('Confluence') ? 'text-cyan-300' :
                                    line.startsWith('T1 near') || line.startsWith('T2') ? 'text-amber-300' :
                                    line.startsWith('Stop protected') ? 'text-emerald-300' :
                                    'text-slate-400'
                                  }>{line || ' '}</div>
                                ))}
                              </div>
                              <div className="text-[8px] text-emerald-400 mt-1.5 pt-1 border-t border-blue-800/30 text-center font-semibold">Copied to clipboard</div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  <button onClick={() => {
                    const sym = selectedResult.symbol.replace('.NS','').replace('.BO','');
                    const stage = STAGE_CONFIG[selectedResult.stage].label;
                    const pe = selectedResult.priceEngine;
                    const conv = computeConviction(selectedResult);
                    const verdict = rrVerdict(pe.rewardRisk);
                    const sector = getSectorTag(selectedResult.symbol);
                    const signalDate = selectedResult.lastDate || new Date().toISOString().slice(0, 10);
                    const atr14 = selectedResult.priceEngine.atr14AtEntry || 0;
                    const rsi2 = selectedResult.rsi2 || 50;
                    const rsi14 = selectedResult.rsi14 || 50;
                    const t1Pct = pe.plannedEntry > 0 ? ((pe.target5 - pe.plannedEntry) / pe.plannedEntry * 100) : 0;
                    const t2Pct = pe.plannedEntry > 0 ? ((pe.target7 - pe.plannedEntry) / pe.plannedEntry * 100) : 0;
                    const t3Pct = pe.plannedEntry > 0 ? ((pe.target10 - pe.plannedEntry) / pe.plannedEntry * 100) : 0;
                    const slPct = pe.plannedEntry > 0 ? ((pe.tacticalStop - pe.plannedEntry) / pe.plannedEntry * 100) : 0;

                    const text = `*${sym}* — *${stage}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 *Entry* ₹${pe.plannedEntry.toFixed(2)}
⛔ *SL* ₹${pe.tacticalStop.toFixed(2)} (${slPct.toFixed(1)}%)

🎯 *Targets*
   T1: ₹${pe.target5.toFixed(2)} (+${t1Pct.toFixed(1)}%)
   T2: ₹${pe.target7.toFixed(2)} (+${t2Pct.toFixed(1)}%)
   T3: ₹${pe.target10.toFixed(2)} (+${t3Pct.toFixed(1)}%)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 *ATR14* (Wilder's): ₹${atr14.toFixed(2)}
📈 *RSI2/RSI14*: ${rsi2.toFixed(0)}/​${rsi14.toFixed(0)}
🏢 *Sector*: ${sector || 'N/A'}
📅 *Signal Date*: ${signalDate}
💯 *Score*: ${selectedResult.inflectionScore}/100
🎲 *Confidence*: ${(selectedResult.confidence * 100).toFixed(0)}%
📊 *Conditions Met*: ${selectedResult.conditionsMet}/${selectedResult.totalConditions}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💹 *R:R Ratio*: ${pe.rewardRisk.toFixed(2)}:1 (${verdict})
📌 *Risk %*: ${pe.tacticalRiskPct.toFixed(1)}%

— *Quant Terminal Pro v9.0*`;

                    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                  }} data-tip="Copy quick summary to share with others" data-tip-color="cyan"
                    className="flex-1 px-2 py-1.5 bg-cyan-900/40 hover:bg-cyan-900/60 border border-cyan-700 rounded text-xs font-medium text-cyan-300 transition-colors">📤 Share</button>
                </div>

              {/* Signal Narrative */}
              {['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(selectedResult.stage) && (() => {
                const nar = generateNarrative(selectedResult, rsData.get(selectedResult.symbol), tfAlignments.get(selectedResult.symbol), pivotData.get(selectedResult.symbol), detectOnsetCandle(selectedResult), computeConviction(selectedResult), earningsSeason.warning);
                return (
                  <div className="mb-4">
                    <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Trade Thesis</div>
                    <div className="text-[10px] leading-relaxed space-y-1.5">
                      <div className="text-slate-200 font-semibold">{nar.headline}</div>
                      <div className="text-slate-400">{nar.setup}</div>
                      <div className="text-emerald-400/80">{nar.entry}</div>
                      {nar.caution !== 'No specific risk flags identified.' && <div className="text-amber-400/80">⚠ {nar.caution}</div>}
                      <div className={`font-semibold ${nar.verdict.includes('A-grade') ? 'text-[#39FF14]' : nar.verdict.includes('B-grade') ? 'text-yellow-300' : 'text-slate-400'}`}>{nar.verdict}</div>
                    </div>
                  </div>
                );
              })()}

              {/* Pivot Levels */}
              {(() => {
                const piv = pivotData.get(selectedResult.symbol);
                if (!piv) return null;
                const warnings = selectedResult.priceEngine.tradeValid ? checkTargetPivotConflict(
                  selectedResult.priceEngine.plannedEntry, selectedResult.priceEngine.tacticalStop,
                  selectedResult.priceEngine.target5, selectedResult.priceEngine.target7, piv
                ) : [];
                return (
                  <div className="mb-4">
                    <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Pivot Levels (Classic)</div>
                    <div className="space-y-0.5 text-xs font-mono">
                      {[
                        { label: 'R3', price: piv.classic.r3, color: 'text-red-500' },
                        { label: 'R2', price: piv.classic.r2, color: 'text-red-400' },
                        { label: 'R1', price: piv.classic.r1, color: 'text-red-300' },
                        { label: 'PP', price: piv.classic.pp, color: 'text-slate-200 font-semibold' },
                        { label: 'S1', price: piv.classic.s1, color: 'text-emerald-300' },
                        { label: 'S2', price: piv.classic.s2, color: 'text-emerald-400' },
                        { label: 'S3', price: piv.classic.s3, color: 'text-emerald-500' },
                      ].map(lv => {
                        const isCmpHere = piv.cmp >= lv.price - 2 && piv.cmp <= lv.price + 2;
                        return (
                          <div key={lv.label} className={`flex justify-between items-center ${isCmpHere ? 'bg-indigo-900/30 rounded px-1 -mx-1' : ''}`}>
                            <span className="text-slate-500 w-6">{lv.label}</span>
                            <div className="flex-1 mx-2 border-b border-dotted border-slate-800" />
                            <span className={lv.color}>₹{lv.price.toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1.5">
                      CMP: {piv.position}
                      {piv.nextResistance && <span className="text-red-400"> · R: ₹{piv.nextResistance.price.toFixed(0)} ({piv.nextResistance.distance.toFixed(0)} away)</span>}
                      {piv.nextSupport && <span className="text-emerald-400"> · S: ₹{piv.nextSupport.price.toFixed(0)}</span>}
                    </div>
                    {/* Confluence zones */}
                    {piv.confluence.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <div className="text-[10px] text-slate-500 font-semibold">Confluence Zones</div>
                        {piv.confluence.slice(0, 4).map((cz, i) => (
                          <div key={i} className={`flex items-center gap-1.5 text-[10px] px-1.5 py-0.5 rounded ${cz.type === 'resistance' ? 'bg-red-900/20 text-red-300' : 'bg-emerald-900/20 text-emerald-300'}`}>
                            <span className="font-semibold">{cz.type === 'resistance' ? '▲' : '▼'}</span>
                            <span>₹{cz.price.toFixed(0)}</span>
                            <span className="text-slate-500">({cz.strength} methods)</span>
                            <span className={`ml-auto ${cz.relevance === 'immediate' ? 'text-yellow-300 font-semibold' : 'text-slate-600'}`}>{cz.relevance}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Target vs Pivot warnings */}
                    {warnings.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {warnings.map((w, i) => (
                          <div key={i} className={`text-[10px] px-1.5 py-1 rounded ${w.target === 'SL' ? 'bg-emerald-900/20 text-emerald-300' : 'bg-amber-900/20 text-amber-300'}`}>
                            {w.target === 'SL' ? '🛡' : '⚠'} {w.warning}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {selectedResult.priceEngine.tradeValid && (
                <div className="mb-4">
                  <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Trade Engine</div>
                  <div className="space-y-1.5 text-xs">
                    {([
                      ['Entry',         '₹' + selectedResult.priceEngine.plannedEntry.toFixed(2)],
                      ['Breakout Level','₹' + selectedResult.priceEngine.breakoutLevel.toFixed(2)],
                      ['Tactical Stop', '₹' + selectedResult.priceEngine.tacticalStop.toFixed(2) + ' (−' + selectedResult.priceEngine.tacticalRiskPct.toFixed(2) + '%)'],
                      ['T1 (50%)', '₹' + selectedResult.priceEngine.target5.toFixed(2) + (() => { const r = selectedResult.priceEngine; const rps = r.plannedEntry - r.tacticalStop; const pct = r.plannedEntry > 0 ? ((r.target5 - r.plannedEntry) / r.plannedEntry * 100).toFixed(1) : '0'; return rps > 0 ? ` (${pct}% · ${((r.target5 - r.plannedEntry) / rps).toFixed(1)}R)` : ''; })()],
                      ['T2 (30%)', '₹' + selectedResult.priceEngine.target7.toFixed(2) + (() => { const r = selectedResult.priceEngine; const rps = r.plannedEntry - r.tacticalStop; const pct = r.plannedEntry > 0 ? ((r.target7 - r.plannedEntry) / r.plannedEntry * 100).toFixed(1) : '0'; return rps > 0 ? ` (${pct}% · ${((r.target7 - r.plannedEntry) / rps).toFixed(1)}R)` : ''; })()],
                      ['T3 (20%)', '₹' + selectedResult.priceEngine.target10.toFixed(2) + (() => { const r = selectedResult.priceEngine; const rps = r.plannedEntry - r.tacticalStop; const pct = r.plannedEntry > 0 ? ((r.target10 - r.plannedEntry) / r.plannedEntry * 100).toFixed(1) : '0'; return rps > 0 ? ` (${pct}% · ${((r.target10 - r.plannedEntry) / rps).toFixed(1)}R)` : ''; })()],
                      ['T3R (3×risk)',  '₹' + selectedResult.priceEngine.target3R.toFixed(2)],
                      ['Reward:Risk',   selectedResult.priceEngine.rewardRisk.toFixed(2) + ':1'],
                      ['BE Trigger',    '₹' + (selectedResult.priceEngine.plannedEntry * 1.02).toFixed(2) + ' (+2%) → move SL to BE'],
                      ['BE Stop',       '₹' + (selectedResult.priceEngine.plannedEntry * 1.005).toFixed(2) + ' (+0.5% entry)'],
                      ['Trail @T1',     '₹' + selectedResult.priceEngine.plannedEntry.toFixed(2) + ' (breakeven)'],
                      ['Trail @T2',     '₹' + (selectedResult.priceEngine.target7 > 0 ? (Math.round((selectedResult.priceEngine.target7 - 1.5 * ((Number.isFinite(selectedResult.atrPct14) ? selectedResult.atrPct14 : 0) / 100 * selectedResult.lastClose)) * 20) / 20).toFixed(2) : '—')],
                      ['Gap',          selectedResult.priceEngine.gapPct.toFixed(2) + '% → ' + selectedResult.priceEngine.entryStatus],
                    ] as [string, string][]).map(([label, val]) => (
                      <div key={label} className="flex justify-between gap-2">
                        <span className="text-slate-500 flex-shrink-0">{label}</span>
                        <span className="text-slate-200 font-mono text-right">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* v9.0 Momentum */}
              {selectedResult.momentum && <div className="mb-4">
                <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">
                  Momentum Quality ({selectedResult.momentum?.momentumScore ?? 0}/100)
                </div>
                <div className="space-y-1 text-xs">
                  {([
                    ['EMA Aligned',    selectedResult.momentum.emaAligned ? '✓ Yes' : '✗ No',    selectedResult.momentum.emaAligned],
                    ['Higher Low',     selectedResult.momentum.higherLowConfirmed ? '✓ Yes' : '✗ No', selectedResult.momentum.higherLowConfirmed],
                    ['Vol Dry-Up',     `${selectedResult.momentum.volDryUpScore}/4`, selectedResult.momentum.volDryUpScore >= 3],
                    ['OBV Slope',      selectedResult.momentum.obvSlope10.toFixed(2), selectedResult.momentum.obvSlope10 >= 0.5],
                    ['ADX (15-35)',    selectedResult.momentum.adx14.toFixed(0), selectedResult.momentum.adxInRange],
                    ['Gap-Adj R:R',   selectedResult.momentum.gapAdjustedRR > 0 ? selectedResult.momentum.gapAdjustedRR.toFixed(1) + ':1' : '—', selectedResult.momentum.gapAdjustedRR >= 2],
                    ['RS vs Nifty50', selectedResult.momentum.rsNifty20.toFixed(2), selectedResult.momentum.rsNifty20 >= 1.0],
                  ] as [string, string, boolean][]).map(([label, val, pass]) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className={`flex-shrink-0 ${pass ? 'text-emerald-400' : 'text-red-500'}`}>{pass ? '✓' : '✗'}</span>
                      <span className={pass ? 'text-slate-300 flex-1' : 'text-slate-600 flex-1'}>{label}</span>
                      <span className="text-slate-500 font-mono">{val}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 mt-1 pt-1 border-t border-slate-800">
                    <span className="text-slate-400 flex-1">EMA20 / EMA50</span>
                    <span className="text-slate-500 font-mono">₹{(selectedResult.momentum?.ema20 ?? 0).toFixed(1)} / ₹{(selectedResult.momentum?.ema50 ?? 0).toFixed(1)}</span>
                  </div>
                </div>
              </div>}

              {/* v9.0 Statistical Features */}
              {selectedResult.stats && <div className="mb-4">
                <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">
                  Statistical Edge ({selectedResult.stats?.statsScore ?? 0}/100)
                </div>
                <div className="space-y-1 text-xs">
                  {([
                    ['Vol Z-Score',    selectedResult.stats.volZScore.toFixed(1) + 'σ', selectedResult.stats.volZSignificant],
                    ['BB Squeeze',     selectedResult.stats.bbWidthPctl.toFixed(0) + '% pctl', selectedResult.stats.bbSqueeze],
                    ['Keltner Squeeze', selectedResult.stats.keltnerSqueeze ? 'Active' : 'No', selectedResult.stats.keltnerSqueeze],
                    ['LR Slope (flat)', selectedResult.stats.lrSlope10.toFixed(3), selectedResult.stats.lrSlopeFlat],
                    ['Auto-Corr',      selectedResult.stats.autoCorr5.toFixed(2), selectedResult.stats.momentumRegime],
                    ['Hurst Exp',      selectedResult.stats.hurst.toFixed(2), selectedResult.stats.hurstTrending],
                    ['Skewness',       selectedResult.stats.skewness20.toFixed(2), selectedResult.stats.positiveSkew],
                    ['52W High DD',    selectedResult.stats.drawdownFrom52WH.toFixed(1) + '%', selectedResult.stats.drawdownFrom52WH <= 10],
                    ['52W Low Up',     selectedResult.stats.pctFrom52WL.toFixed(0) + '%', selectedResult.stats.pctFrom52WL >= 30],
                    ['Sharpe (20d)',    selectedResult.stats.sharpe20.toFixed(2), selectedResult.stats.sharpe20 >= 1.0],
                    ['Entropy',        selectedResult.stats.entropy10.toFixed(2), selectedResult.stats.entropy10 < 1.5],
                    ['CUSUM Shift',    selectedResult.stats.cusumSignal ? 'Yes' : 'No', selectedResult.stats.cusumSignal],
                    ['Inside Bars',    String(selectedResult.stats.insideBars), selectedResult.stats.insideBars >= 2],
                    ['Vol Skew',       selectedResult.stats.volProfileSkew.toFixed(2), selectedResult.stats.volProfileSkew > 0.2],
                    ['Guppy GMMA',     selectedResult.stats.guppySpreadPct.toFixed(2) + '%', selectedResult.stats.guppyCompressed],
                    ['GARCH Vol',      selectedResult.stats.garchForecast.toFixed(2) + '×', selectedResult.stats.garchForecast > 1.3],
                    ['TTM Squeeze',    selectedResult.stats.ttmSqueezeFired ? '🟢 FIRED' : selectedResult.stats.ttmSqueezeOn ? '🔴 ON' : '⚫ OFF', selectedResult.stats.ttmSqueezeFired],
                    ['TTM Momentum',   selectedResult.stats.ttmMomentum.toFixed(1) + (selectedResult.stats.ttmMomentumRising ? ' ↑' : ' ↓'), selectedResult.stats.ttmMomentum > 0 && selectedResult.stats.ttmMomentumRising],
                    ['RSI(14)',        selectedResult.stats.rsi14.toFixed(1), selectedResult.stats.rsi14 >= 50 && selectedResult.stats.rsi14 <= 70],
                    ['CCI(34)',        selectedResult.stats.cci34.toFixed(0), selectedResult.stats.cci34 >= 0 && selectedResult.stats.cci34 <= 200],
                  ] as [string, string, boolean][]).map(([label, val, pass]) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className={`flex-shrink-0 ${pass ? 'text-emerald-400' : 'text-slate-600'}`}>{pass ? '✓' : '○'}</span>
                      <span className={pass ? 'text-slate-300 flex-1' : 'text-slate-600 flex-1'}>{label}</span>
                      <span className="text-slate-500 font-mono">{val}</span>
                    </div>
                  ))}
                  {selectedResult.stats.bbSqueeze && selectedResult.stats.keltnerSqueeze && (
                    <div className="text-yellow-300 text-xs font-semibold mt-1 pt-1 border-t border-slate-800">⚡ Double Squeeze Active — high probability breakout</div>
                  )}
                </div>
              </div>}

              {selectedResult.zone && (
                <div className="mb-4">
                  <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Compression Zone</div>
                  <div className="space-y-1 text-xs">
                    {([
                      ['High',      '₹' + selectedResult.zone.zoneHigh.toFixed(2)],
                      ['Low',       '₹' + selectedResult.zone.zoneLow.toFixed(2)],
                      ['Tightness', selectedResult.zone.zoneTightnessPct.toFixed(2) + '%'],
                      ['Length',    selectedResult.zone.windowLength + ' candles'],
                      ['ATR ratio', selectedResult.zone.zoneATRRatio.toFixed(2)],
                    ] as [string, string][]).map(([label, val]) => (
                      <div key={label} className="flex justify-between gap-2">
                        <span className="text-slate-500">{label}</span>
                        <span className="text-slate-200 font-mono">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">
                  Conditions ({selectedResult.conditionsMet}/{selectedResult.totalConditions})
                </div>
                <div className="space-y-1">
                  {selectedResult.checklist.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs">
                      <span className={`flex-shrink-0 mt-0.5 ${item.pass ? 'text-emerald-400' : 'text-red-500'}`}>
                        {item.pass ? '✓' : '✗'}
                      </span>
                      <span className={`flex-1 leading-tight ${item.pass ? 'text-slate-300' : 'text-slate-600'}`}>{item.label}</span>
                      <span className="text-slate-500 font-mono flex-shrink-0 text-right">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* #12: Parameter Sensitivity */}
              {selectedResult.priceEngine.tradeValid && (
                <div className="mt-3">
                  <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Signal Strength</div>
                  <div className="space-y-1">
                    {computeParamSensitivity(selectedResult).slice(0, 8).map((p, i) => (
                      <div key={i} className="flex items-center gap-1 text-xs">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.strength === 'strong' ? 'bg-emerald-400' : p.strength === 'moderate' ? 'bg-blue-400' : p.strength === 'marginal' ? 'bg-amber-400' : 'bg-red-500'}`} />
                        <span className={`flex-1 truncate ${p.strength === 'fail' ? 'text-slate-600' : 'text-slate-400'}`}>{p.label}</span>
                        <span className={`font-mono flex-shrink-0 ${p.strength === 'marginal' ? 'text-amber-400' : p.strength === 'fail' ? 'text-red-500' : 'text-slate-500'}`}>
                          {p.marginPct > 0 ? '+' : ''}{p.marginPct.toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* ── Footer ── */}
      <footer className="flex-shrink-0 border-t border-slate-800 bg-[#0d1117] px-4 py-1.5 flex items-center gap-3 text-xs text-slate-600">
        <span>{results.length} scanned{failedSymbols.length > 0 ? ` · ${failedSymbols.length} errors` : ''}{skippedDeadCount > 0 ? ` · ${skippedDeadCount} delisted skipped` : ''}</span>
        <span>·</span>
        <span className="text-emerald-700">
          {results.filter(r => ['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage)).length} actionable
        </span>
        {scanEndTime && <><span>·</span><span className="text-slate-500">⏱ {scanEndTime}</span></>}
        {nearBreakoutCount > 0 && <><span>·</span><span className="text-yellow-600">⚡ {nearBreakoutCount} near breakout</span></>}
        {scanDiff.size > 0 && <><span>·</span><span className="text-cyan-600">↑ {scanDiff.size} changed</span></>}
        <span>·</span>
        <span>{filteredResults.length} shown</span>
        {hasColFilters && <span className="text-amber-600">· filters active</span>}
        {dataQuality && (
          dataQuality.isStale ? (
            <span className="text-red-500 cursor-pointer relative group">
              · Data: {dataQuality.latestDate} ⚠ STALE
              <div className="absolute bottom-full left-0 mb-2 w-72 p-3 bg-slate-800 border border-red-700 rounded-lg shadow-xl text-xs text-slate-300 hidden group-hover:block z-50">
                <div className="font-semibold text-red-400 mb-1.5">⚠ Data is stale — last candle is from {dataQuality.latestDate}</div>
                <div className="text-slate-400 mb-2">
                  Today is {new Date().toISOString().slice(0, 10)}. The OHLCV data hasn't updated to today's trading session yet.
                </div>
                <div className="font-semibold text-slate-300 mb-1">Common reasons:</div>
                <ul className="list-disc list-inside text-slate-400 space-y-0.5 mb-2">
                  <li>Market is closed (weekend/holiday)</li>
                  <li>Yahoo Finance hasn't updated yet (updates ~4-6 PM IST)</li>
                  <li>Scan was run before market close (3:30 PM IST)</li>
                  <li>Yahoo Finance API delay or outage</li>
                </ul>
                <div className="font-semibold text-slate-300 mb-1">How to fix:</div>
                <ul className="list-disc list-inside text-slate-400 space-y-0.5">
                  <li>Wait until after 4:30 PM IST and rescan</li>
                  <li>Enable ⟳ Auto-refresh to rescan automatically</li>
                  <li>Click "New Scan" to force a fresh data fetch</li>
                  <li>If persistent, Yahoo Finance may be temporarily down</li>
                </ul>
                <div className="mt-2 pt-1.5 border-t border-slate-700 text-slate-500">
                  Note: Signals from yesterday's close are still valid for next-day entry
                </div>
              </div>
            </span>
          ) : (
            <span className="text-slate-600">· Data: {dataQuality.latestDate} ✓</span>
          )
        )}
        {autoRefresh && <span className="text-green-600">· ⟳ Auto 15m</span>}
        <span className="ml-auto hidden sm:block">{scanAll ? '★ All 5 Sets' : PARAM_SETS[paramSetKey].name} · Dr KKR Quant Terminal Pro v9.0</span>
      </footer>
    </main>
  );
}

export default function HomePage() { return <ErrorBoundary><HomePageInner /></ErrorBoundary>; }
