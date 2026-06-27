'use client';

import { useState, useRef, useCallback, useEffect, useMemo, Component, type ReactNode } from 'react';

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
            <button onClick={() => { try { localStorage.clear(); } catch {} window.location.reload(); }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-sm font-medium">
              Clear Data & Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import { fetchOHLCVClient } from '@/lib/fetchClient';
import {
  analyzeStock, analyzeStockMulti, analyzeStockWithLookback, computeRSvsNifty,
  computeClusterBreakdown, generateDemoData, PARAM_SETS, PARAM_SET_OPTIONS,
  type AnalysisResult, type ParamSetKey, type StageRating, type MultiAnalysisResult, type Candle,
} from '@/lib/stockEngine';
import { NIFTY_PRESETS } from '@/lib/niftyPresets';
import { SECTOR_PRESETS } from '@/lib/sectorPresets';
import { THEMATIC_PRESETS } from '@/lib/thematicPresets';
import {
  generateTradeSheet, tradeSheetToClipboard, computeWinRateStats, checkTradeStatus,
  detectMarketRegime, computeParamSensitivity, QUICK_FILTERS,
  type TrackedTrade, type TradeSheet, type QuickFilterKey, type RegimeInfo,
} from '@/lib/tradingUtils';
import {
  loadWatchlist, saveWatchlist, loadSignalHistory, saveSignalHistory, updateSignalHistory,
  getSignalAge, exportZerodhaBasket, detectOverlap, generateSparklineSVG,
  type WatchlistItem, type SignalHistory,
} from '@/lib/tradingUtils2';
import {
  computeConviction, getSectorTag, computeScanStats, generateJournalMarkdown,
  deduplicateSymbols, type ScanStats,
} from '@/lib/tradingUtils3';
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
import { runBacktest, aggregateBacktest, type BacktestResult } from '@/lib/backtestEngine';
import { generateNarrative, type SignalNarrative } from '@/lib/narrativeEngine';
import { optimizePortfolio, type PortfolioResult } from '@/lib/portfolioOptimizer';
import {
  loadTelegramConfig, saveTelegramConfig, sendTelegramMessage,
  formatNewSignalAlert, formatTargetHitAlert, formatStoppedAlert,
  formatRegimeChangeAlert, formatDailySummaryAlert, formatSignalDecayAlert,
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
  headerTipHtml?: string;
};

// ── Export helpers ──────────────────────────────────────────────────────────

// Safe column formatter for exports — catches errors from missing fields
// Volume-Thrust Close-High Onset Candle detection (backtested: 81.82% hit rate for >5% momentum run)
type OnsetTier = 'BEST' | 'STRONG' | 'FULL_BODY' | 'REJECTION' | 'WEAK' | null;
function detectOnsetCandle(r: AnalysisResult): OnsetTier {
  const cl = r.closeLoc, vp5 = r.exactVolVsPre5, vr20 = r.volRatio20, ra = r.exactRangeATR14;
  const bp = r.bodyPct, uw = r.upperWickPct, sr = r.signalRangePct;
  const brk = r.zone !== null && r.lastClose > r.zone.zoneHigh * 1.001;
  if (!brk) return null;
  // Tier 1: High Conviction (strictest — 81.82% backtest hit rate)
  if (cl >= 70 && vp5 >= 2.50 && vr20 >= 1.50 && ra >= 1.20 && ra <= 4.50 && bp >= 45 && uw <= 30 && sr <= 8.5)
    return 'BEST';
  // Tier 2: Volume-Thrust Close-High (standard — 52.30% Wilson lower bound)
  if (cl >= 65 && vp5 >= 2.00 && vr20 >= 1.20 && ra >= 1.00 && ra <= 5.00 && bp >= 35 && uw <= 35 && sr <= 11.0)
    return 'STRONG';
  // Tier 3: Near-Marubozu Bullish Drive (50% hit rate)
  if (cl >= 65 && bp >= 50 && uw <= 25 && ra >= 1.00)
    return 'FULL_BODY';
  // Tier 4: Hammer-like lower-wick rejection
  if (cl >= 60 && r.stats && (r.stats.candlePattern === 'HAMR' || r.stats.candlePattern === 'DGDF') && ra >= 1.00)
    return 'REJECTION';
  // Tier 5: Small body / weak onset
  if (cl >= 55 && bp < 35 && ra >= 1.00 && vp5 >= 1.50)
    return 'WEAK';
  return null;
}

// Breakout DNA detection (backtested on 29 OHLCV files)
// Identifies the signal candle archetype from the inflection study:
//   MARUBOZU: body≥70%, green, closeLoc≥80% → 51.1% hit, workhorse signal
//   HAMMER: lwPct≥50%, body≤35%, closeLoc≥60% → 48.4% hit, +8.6% MFE, fastest (3.4d)
//   THRUST: body≥45%, green, closeLoc≥65% → 47.7% hit, volume-driven
//   R-EXP: rangeATR≥1.5, green, closeLoc≥60% → 57.1% hit, range explosion
// Plus pre-breakout compression detection:
//   Zone has low pre-volume (≤0.82×) = volume dry-up confirmed
type BreakoutDNA = 'MARUBOZU' | 'HAMMER' | 'THRUST' | 'R-EXP' | 'COMPRESSION' | null;
function detectBreakoutDNA(r: AnalysisResult): BreakoutDNA {
  if (!r.zone || r.lastClose <= r.zone.zoneHigh * 1.001) return null;
  const cl = r.closeLoc, bp = r.bodyPct, uw = r.upperWickPct, ra = r.exactRangeATR14;
  const range = r.signalRangePct > 0 ? 1 : 0; // just checking it exists
  if (!range && !ra) return null;
  const lwPct = 100 - cl - (100 - cl - bp > 0 ? 0 : 0); // approximate
  // Classify the signal candle archetype
  if (bp >= 70 && cl >= 80 && uw <= 15) return 'MARUBOZU';
  if (ra >= 1.5 && cl >= 60 && bp >= 30) return 'R-EXP';
  if (cl >= 60 && bp <= 35 && uw <= 15 && (r.stats?.candlePattern === 'HAMR' || r.stats?.candlePattern === 'DGDF')) return 'HAMMER';
  if (bp >= 45 && cl >= 65 && r.exactVolVsPre5 >= 2.0) return 'THRUST';
  if (r.pre10AvgVolRatio <= 0.82 && r.pre10AvgRangeATR <= 0.75) return 'COMPRESSION';
  return null;
}

// Guppy Coiled Overlay — detects breakout from extreme Guppy compression zone
// When ALL Guppy EMAs were compressed (spread < 3%) during the zone → "💎 GUPPY COILED"
// Backtested: monster moves (OSWALAGRO +55%, NATIONALUM +48%, KTKBANK +25%)
// start from extreme Guppy compression → breakout with volume
function detectGuppyCoiled(r: AnalysisResult, candles: Candle[]): { coiled: boolean; avgSpread: number; minSpread: number } | null {
  if (!r.zone || !candles || candles.length < 70) return null;
  if (!['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage)) return null;
  // Compute Guppy EMA spread for candles DURING the zone period
  const periods = [3, 5, 8, 10, 12, 15, 30, 35, 40, 45, 50, 60];
  const n = candles.length;
  const zoneLen = r.zone.windowLength;
  const zoneStart = n - 1 - zoneLen;
  if (zoneStart < 60) return null;
  // Compute EMA spread at a few points during the zone
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
  // Coiled if average spread during zone was < 3%
  return { coiled: avgSpread < 3.0, avgSpread, minSpread };
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

// Volume Thrust Badge (backtested on 29 OHLCV files — 66.28% hit rate for +5% moves)
type VolumeBadge = 'HIGH_CONVICTION' | 'CONFIRMED' | null;
function detectVolumeBadge(r: AnalysisResult): VolumeBadge {
  const vr20 = r.volRatio20, vp5 = r.exactVolVsPre5, rvb = r.pre10RedVolBias;
  const cl = r.closeLoc, bp = r.bodyPct, uw = r.upperWickPct;
  // High Conviction Volume Thrust: 66.28% hit rate for +5% (vs 45.43% baseline)
  if (vr20 >= 2.00 && vp5 >= 2.00 && rvb <= 0.80 && cl >= 65 && bp >= 35 && uw <= 35)
    return 'HIGH_CONVICTION';
  // Volume Confirmed: softer version for compression-breakout context
  if (vp5 >= 2.00 && vr20 >= 1.20 && rvb <= 1.10)
    return 'CONFIRMED';
  return null;
}

// ATR Compression State (backtested on 29 OHLCV files)
type ATRState = 'DEEP_COMPRESSION' | 'BUILDING' | 'SWEET_SPOT' | 'HIGH_VOL' | null;
function detectATRState(r: AnalysisResult): { state: ATRState; explosion: boolean } {
  const pctl = r.atrPct14Pctl120;
  if (!Number.isFinite(pctl)) return { state: null, explosion: false };
  let state: ATRState;
  if (pctl < 20) state = 'DEEP_COMPRESSION';
  else if (pctl < 40) state = 'BUILDING';
  else if (pctl <= 60) state = 'SWEET_SPOT';    // 40-60: inflection zone (65% hit, MFE 11.7%)
  else if (pctl <= 95) state = 'HIGH_VOL';       // 65-95: momentum zone
  else state = 'HIGH_VOL';
  // ULTRA ATR+Volume+ADR Explosion: 97.62% hit rate (Wilson LB 87.68%)
  // Hyper-optimized from 29-OHLCV grid search
  const adrPct = r.atrPct14 ?? 0;
  const volExpRatio = r.volatilityExpansionRatio ?? 0;
  const explosion = pctl >= 40 && pctl <= 95
    && r.exactRangeATR14 >= 2.00 && r.exactRangeATR14 <= 5.00
    && volExpRatio >= 1.50
    && adrPct >= 4.00 && adrPct <= 8.00
    && r.volRatio20 >= 1.80 && r.exactVolVsPre5 >= 2.25
    && r.pre10RedVolBias <= 0.90
    && r.closeLoc >= 60 && r.bodyPct >= 30 && r.upperWickPct <= 40;
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

  // Deployable: 75.86% hit rate (29 trades, Wilson LB 57.89%, MFE 14.48%)
  if (zt <= 20 && zl >= 5 && zl <= 20 && zatr <= 1.00
    && cazp >= 0.75 && cazp <= 6.00 && ra >= 1.00 && ra <= 8.00
    && adrPct >= 3.50 && adrPct <= 7.50
    && r.volRatio20 >= 1.20 && r.exactVolVsPre5 >= 2.00
    && cl >= 70 && bp >= 35 && uw <= 35)
    return 'CONFIRMED';

  return null;
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
  doc.text(`Dr KKR Quant Terminal Pro v8.2  ·  ${rows.length} stocks  ·  ${new Date().toLocaleDateString('en-IN')}  ·  Param: ${rows[0]?.paramSetKey ?? 'N/A'}`, 14, 18);

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
    fmt: r => '',  // rendered custom in cell
    numVal: r => computeConviction(r),
    cellClass: () => '' },
  { key: 'stage',     label: 'Stage',       width: 155, align: 'left',
    fmt: r => STAGE_CONFIG[r.stage].label,
    cellClass: r => STAGE_CONFIG[r.stage].color + ' font-semibold' },
  { key: 'inflectionScore', label: 'Infl.Score', width: 90, align: 'right',
    fmt: r => r.inflectionScore.toFixed(0),
    numVal: r => r.inflectionScore,
    cellClass: r => r.inflectionScore >= 60 ? 'text-yellow-300 font-semibold' : r.inflectionScore >= 45 ? 'text-emerald-400' : 'text-slate-400' },
  { key: 'confidence', label: 'Conf%',      width: 68,  align: 'right',
    fmt: r => r.confidence.toFixed(0) + '%',
    numVal: r => r.confidence,
    cellClass: () => 'text-slate-300' },
  { key: 'clDep', label: 'D20+', width: 50, align: 'center',
    fmt: r => r.clusterBreakdown?.deployable ? `${r.clusterBreakdown.deployable.met}/${r.clusterBreakdown.deployable.total}` : '—',
    numVal: r => r.clusterBreakdown?.deployable?.met ?? 0,
    cellClass: r => { const c = r.clusterBreakdown?.deployable; if (!c || c.total === 0) return 'text-slate-700'; return c.met === c.total ? 'text-yellow-300 font-bold' : c.met >= c.total - 2 ? 'text-emerald-400' : c.met >= c.total * 0.7 ? 'text-slate-300' : 'text-slate-600'; } },
  { key: 'clHP', label: 'HP15+', width: 50, align: 'center',
    fmt: r => r.clusterBreakdown?.highPrecision ? `${r.clusterBreakdown.highPrecision.met}/${r.clusterBreakdown.highPrecision.total}` : '—',
    numVal: r => r.clusterBreakdown?.highPrecision?.met ?? 0,
    cellClass: r => { const c = r.clusterBreakdown?.highPrecision; if (!c || c.total === 0) return 'text-slate-700'; return c.met === c.total ? 'text-yellow-300 font-bold' : c.met >= c.total - 2 ? 'text-emerald-400' : c.met >= c.total * 0.7 ? 'text-slate-300' : 'text-slate-600'; } },
  { key: 'clElt', label: 'E10+', width: 50, align: 'center',
    fmt: r => r.clusterBreakdown?.elite ? `${r.clusterBreakdown.elite.met}/${r.clusterBreakdown.elite.total}` : '—',
    numVal: r => r.clusterBreakdown?.elite?.met ?? 0,
    cellClass: r => { const c = r.clusterBreakdown?.elite; if (!c || c.total === 0) return 'text-slate-700'; return c.met === c.total ? 'text-yellow-300 font-bold' : c.met >= c.total - 2 ? 'text-emerald-400' : c.met >= c.total * 0.7 ? 'text-slate-300' : 'text-slate-600'; } },
  { key: 'clUS', label: 'US8+', width: 50, align: 'center',
    fmt: r => r.clusterBreakdown?.ultraSelective ? `${r.clusterBreakdown.ultraSelective.met}/${r.clusterBreakdown.ultraSelective.total}` : '—',
    numVal: r => r.clusterBreakdown?.ultraSelective?.met ?? 0,
    cellClass: r => { const c = r.clusterBreakdown?.ultraSelective; if (!c || c.total === 0) return 'text-slate-700'; return c.met === c.total ? 'text-yellow-300 font-bold' : c.met >= c.total - 2 ? 'text-emerald-400' : c.met >= c.total * 0.7 ? 'text-slate-300' : 'text-slate-600'; } },
  { key: 'cmp',      label: 'CMP ₹',        width: 85,  align: 'right',
    fmt: r => r.lastClose > 0 ? r.lastClose.toFixed(2) : '—',
    numVal: r => r.lastClose,
    cellClass: () => 'text-slate-200 font-mono' },
  { key: 'candle',  label: 'Candle',        width: 75,  align: 'center',
    headerTipHtml: '<div class="rt-hdr">Breakout DNA + Onset Candle</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">★ BEST</span></div><div><div class="rt-desc">High-conviction onset: body≥45%, close≥70%, vol≥2.5x, wick≤30%</div><div class="rt-hit hit-green">81.8% hit rate</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">★ STRONG</span></div><div><div class="rt-desc">Volume-thrust close-high: body≥35%, close≥65%, vol≥2.0x</div><div class="rt-hit hit-cyan">52.3% Wilson LB</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">DNA tags</span></div><div><div class="rt-desc">MARUBOZU: big body, close at high (51% hit, workhorse). HAMMER: long lower wick (48% hit, +8.6% MFE, fastest). R-EXP: range explosion ≥1.5ATR (57% hit). THRUST: body+volume driven. COMPRESSION: pre-volume dry-up confirmed.</div></div></div>',
    fmt: r => {
      const onset = detectOnsetCandle(r);
      const dna = detectBreakoutDNA(r);
      const pattern = r.stats?.candlePattern ?? '—';
      const dnaBadge = dna ? ` ${dna}` : '';
      if (onset === 'BEST') return `★ ${pattern}${dnaBadge}`;
      if (onset === 'STRONG') return `★ ${pattern}${dnaBadge}`;
      if (dna) return `${pattern} ${dna}`;
      return pattern;
    },
    cellClass: r => {
      const onset = detectOnsetCandle(r);
      if (onset === 'BEST') return 'text-[#39FF14] font-bold';
      if (onset === 'STRONG') return 'text-[#4ade80] font-bold';
      const dna = detectBreakoutDNA(r);
      if (dna) return 'text-cyan-300 font-semibold';
      const t = r.stats?.candlePatternType;
      const s = r.stats?.candlePatternStrength ?? 0;
      if (t === 'bullish') return s >= 3 ? 'text-emerald-400 font-bold' : s >= 2 ? 'text-emerald-400' : 'text-emerald-600';
      if (t === 'bearish') return s >= 3 ? 'text-red-400 font-bold' : s >= 2 ? 'text-red-400' : 'text-red-600';
      return 'text-slate-500';
    } },
  { key: 'guppy',   label: 'Guppy',        width: 65,  align: 'right',
    fmt: r => r.stats.guppySpreadPct < 99 ? r.stats.guppySpreadPct.toFixed(2) + '%' : '—',
    numVal: r => r.stats.guppyCompressed ? -r.stats.guppySpreadPct : r.stats.guppySpreadPct,
    cellClass: r => r.stats.guppyUltraCompressed ? 'text-emerald-400 font-bold font-mono' : r.stats.guppyCompressed ? 'text-yellow-300 font-semibold font-mono' : r.stats.guppySpreadPct < 2 ? 'text-slate-400 font-mono' : 'text-slate-600 font-mono' },
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
    headerTipHtml: '<div class="rt-hdr">Cascading Gates v3 — 9-Gate Precision</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-teal">Formula</span></div><div><div class="rt-desc">ZoneLow - 0.5×ATR [3.5%, 8%]. Stop triggers ONLY after ALL 9 gates pass.</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">Gate 1</span></div><div><div class="rt-desc">RSI-2 &lt; 8: deep capitulation shield — only blocks on extreme oversold (99.7% WR, 23 fewer losers held vs RSI&lt;15)</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-blue">Gate 2</span></div><div><div class="rt-desc">Smart 2-Day: (a) prev day also below stop (b) today WORSE than yesterday (c) volume ≥ 0.8× avg</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">Gate 3</span></div><div><div class="rt-desc">Hammer shield: lower wick ≥40% + close upper half = rejection, don\'t stop</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">Gate 4</span></div><div><div class="rt-desc">Green recovery: green candle closing upper half = buyers stepping in</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">Gate 5</span></div><div><div class="rt-desc">Close in lower 35%: must show genuine weakness, not just a wick touch</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-teal">Gate 6</span></div><div><div class="rt-desc">OBV declining: volume must confirm distribution, not accumulation</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-blue">Gate 7</span></div><div><div class="rt-desc">≥2 consecutive red candles: single red = noise, sustained red = trend</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">Result</span></div><div><div class="rt-desc">0 false stops on 516 winners, 49 stocks. 93.7% WR, +0.672R. Smart 2-day exits 1 day faster than 3-day.</div><div class="rt-hit hit-green">0% false stop rate · Walk-forward OOS validated</div></div></div>',
    fmt: r => r.priceEngine.tacticalStop > 0 ? '₹' + r.priceEngine.tacticalStop.toFixed(2) : '—',
    numVal: r => r.priceEngine.tacticalStop,
    cellClass: () => 'text-red-400 font-semibold' },
  { key: 'pe_risk',   label: 'Risk%',        width: 68,  align: 'right',
    fmt: r => r.priceEngine.tacticalRiskPct > 0 ? r.priceEngine.tacticalRiskPct.toFixed(2) + '%' : '—',
    numVal: r => r.priceEngine.tacticalRiskPct,
    cellClass: r => { const rk = r.priceEngine.tacticalRiskPct; return rk <= 3.5 ? 'text-green-300 font-bold' : rk <= 5.0 ? 'text-yellow-300' : rk <= 6.5 ? 'text-orange-400' : 'text-red-400 font-semibold'; } },
  { key: 'pe_rr',     label: 'R:R',          width: 60,  align: 'right',
    fmt: r => r.priceEngine.rewardRisk > 0 ? r.priceEngine.rewardRisk.toFixed(2) : '—',
    numVal: r => r.priceEngine.rewardRisk,
    cellClass: r => { const rr = r.priceEngine.rewardRisk; return rr >= 1.2 ? 'text-green-300 font-bold' : rr >= 0.9 ? 'text-emerald-400 font-semibold' : rr >= 0.7 ? 'text-yellow-300' : rr >= 0.5 ? 'text-orange-400' : 'text-red-500'; } },
  { key: 'pe_rr_verdict', label: 'Verdict', width: 72, align: 'left',
    fmt: r => { const rr = r.priceEngine.rewardRisk; return rr >= 1.2 ? 'Elite' : rr >= 0.9 ? 'Very Good' : rr >= 0.7 ? 'Good' : rr >= 0.5 ? 'Acceptable' : rr > 0 ? 'Rejected' : '—'; },
    numVal: r => r.priceEngine.rewardRisk,
    cellClass: r => { const rr = r.priceEngine.rewardRisk; return rr >= 1.2 ? 'text-green-300 font-bold' : rr >= 0.9 ? 'text-emerald-400 font-semibold' : rr >= 0.7 ? 'text-yellow-300' : rr >= 0.5 ? 'text-orange-400' : 'text-red-500'; } },
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
  // v8.2 momentum columns
  { key: 'momentumScore', label: 'MomScore', width: 82, align: 'right',
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
  // v9.0 stats columns
  { key: 'statsScore', label: 'Stats', width: 55, align: 'right',
    fmt: r => String(r.stats.statsScore),
    numVal: r => r.stats.statsScore,
    cellClass: r => r.stats.statsScore >= 60 ? 'text-yellow-300 font-semibold' : r.stats.statsScore >= 30 ? 'text-emerald-400' : 'text-slate-500' },
  { key: 'volZ', label: 'VolZ', width: 50, align: 'right',
    fmt: r => r.stats.volZScore.toFixed(1),
    numVal: r => r.stats.volZScore,
    cellClass: r => r.stats.volZSignificant ? 'text-emerald-400 font-semibold' : r.stats.volZScore >= 1.5 ? 'text-slate-300' : 'text-slate-600' },
  { key: 'bbPctl', label: 'BB%', width: 48, align: 'right',
    fmt: r => r.stats.bbWidthPctl.toFixed(0),
    numVal: r => r.stats.bbWidthPctl,
    cellClass: r => r.stats.bbSqueeze ? 'text-yellow-300 font-semibold' : r.stats.bbWidthPctl <= 20 ? 'text-emerald-400' : 'text-slate-500' },
  { key: 'hurst', label: 'Hurst', width: 50, align: 'right',
    fmt: r => r.stats.hurst.toFixed(2),
    numVal: r => r.stats.hurst,
    cellClass: r => r.stats.hurstTrending ? 'text-emerald-400' : r.stats.hurst < 0.45 ? 'text-red-400' : 'text-slate-500' },
  // TTM Squeeze + RSI14 + CCI34 columns
  { key: 'ttmSqz', label: 'TTM', width: 52, align: 'center',
    fmt: r => r.stats.ttmSqueezeFired ? '🟢 FIRE' : r.stats.ttmSqueezeOn ? '🔴 ON' : '⚫ OFF',
    numVal: r => r.stats.ttmSqueezeFired ? 2 : r.stats.ttmSqueezeOn ? 1 : 0,
    cellClass: r => r.stats.ttmSqueezeFired ? 'text-green-400 font-bold' : r.stats.ttmSqueezeOn ? 'text-red-400 font-semibold' : 'text-slate-600' },
  { key: 'ttmMom', label: 'Mom', width: 50, align: 'right',
    fmt: r => r.stats.ttmMomentum.toFixed(1),
    numVal: r => r.stats.ttmMomentum,
    cellClass: r => r.stats.ttmMomentum > 0 && r.stats.ttmMomentumRising ? 'text-emerald-400' : r.stats.ttmMomentum > 0 ? 'text-cyan-400' : r.stats.ttmMomentum < 0 && !r.stats.ttmMomentumRising ? 'text-red-400' : 'text-amber-400' },
  { key: 'rsi14', label: 'RSI14', width: 50, align: 'right',
    fmt: r => r.stats.rsi14.toFixed(0),
    numVal: r => r.stats.rsi14,
    cellClass: r => r.stats.rsi14 >= 70 ? 'text-red-400 font-semibold' : r.stats.rsi14 >= 55 ? 'text-emerald-400' : r.stats.rsi14 <= 30 ? 'text-red-400' : r.stats.rsi14 <= 45 ? 'text-amber-400' : 'text-slate-400' },
  { key: 'cci34', label: 'CCI34', width: 55, align: 'right',
    fmt: r => r.stats.cci34.toFixed(0),
    numVal: r => r.stats.cci34,
    cellClass: r => r.stats.cci34 >= 100 ? 'text-emerald-400 font-semibold' : r.stats.cci34 >= 0 ? 'text-slate-300' : r.stats.cci34 <= -100 ? 'text-red-400 font-semibold' : 'text-amber-400' },
  // v9.1 columns
  { key: 'dd52WH', label: '52WH%', width: 55, align: 'right',
    fmt: r => r.stats.drawdownFrom52WH.toFixed(1),
    numVal: r => r.stats.drawdownFrom52WH,
    cellClass: r => r.stats.drawdownFrom52WH <= 5 ? 'text-emerald-400 font-semibold' : r.stats.drawdownFrom52WH <= 15 ? 'text-slate-300' : 'text-red-400' },
  { key: 'pct52WL', label: '52WL%', width: 55, align: 'right',
    fmt: r => r.stats.pctFrom52WL.toFixed(0),
    numVal: r => r.stats.pctFrom52WL,
    cellClass: r => r.stats.pctFrom52WL >= 50 ? 'text-emerald-400' : r.stats.pctFrom52WL >= 20 ? 'text-slate-300' : 'text-red-400' },
  { key: 'sharpe', label: 'Sharpe', width: 55, align: 'right',
    fmt: r => r.stats.sharpe20.toFixed(1),
    numVal: r => r.stats.sharpe20,
    cellClass: r => r.stats.sharpe20 >= 2 ? 'text-yellow-300 font-semibold' : r.stats.sharpe20 >= 1 ? 'text-emerald-400' : r.stats.sharpe20 > 0 ? 'text-slate-400' : 'text-red-400' },
  { key: 'insBar', label: 'InsBr', width: 45, align: 'right',
    fmt: r => r.stats.insideBars > 0 ? String(r.stats.insideBars) : '—',
    numVal: r => r.stats.insideBars,
    cellClass: r => r.stats.insideBars >= 3 ? 'text-yellow-300 font-semibold' : r.stats.insideBars >= 2 ? 'text-emerald-400' : 'text-slate-600' },
  // v7.3 columns
  { key: 'nearBrk', label: 'Near BRK', width: 72, align: 'center',
    fmt: r => r.nearBreakout ? `${r.nearBreakoutPct.toFixed(1)}% ↑` : r.nearBreakoutPct >= 0 && r.nearBreakoutPct <= 5 ? `${r.nearBreakoutPct.toFixed(1)}%` : '—',
    numVal: r => r.nearBreakout ? -r.nearBreakoutPct : 99,
    cellClass: r => r.nearBreakout ? 'text-yellow-300 font-semibold' : r.nearBreakoutPct >= 0 && r.nearBreakoutPct <= 5 ? 'text-amber-500' : 'text-slate-700' },
  { key: 'zone_exp', label: 'Zone', width: 75, align: 'left',
    headerTipHtml: '<div class="rt-hdr">Zone Explosion Badge</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-cyan">💎 EXPLODE</span></div><div><div class="rt-desc">Tight zone ≤20%, close 0.75–4% above zone, rangeATR 1–4, volExp ≥1.25, ADR 3.5–7.5%, close ≥75%, green candle</div><div class="rt-hit hit-green">94.7% hit rate · Rarest & strongest</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-blue">🎯 READY</span></div><div><div class="rt-desc">Zone ≤20%, close 0.75–6% above, volR20 ≥1.2, volVsPre5 ≥2.0, close ≥70%, body ≥35%</div><div class="rt-hit hit-cyan">75.9% hit rate · Confirmed breakout</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">— NONE</span></div><div><div class="rt-desc">No qualifying zone breakout detected</div></div></div>',
    fmt: r => {
      const ze = detectZoneExplosion(r);
      return ze === 'HIGH_CONVICTION' ? '💎 EXPLODE' : ze === 'CONFIRMED' ? '🎯 READY' : '—';
    },
    numVal: r => detectZoneExplosion(r) === 'HIGH_CONVICTION' ? 2 : detectZoneExplosion(r) === 'CONFIRMED' ? 1 : 0,
    cellClass: r => {
      const ze = detectZoneExplosion(r);
      return ze === 'HIGH_CONVICTION' ? 'text-cyan-300 font-bold bg-cyan-900/30 px-1 rounded' : ze === 'CONFIRMED' ? 'text-blue-400 bg-blue-900/20 px-1 rounded' : 'text-slate-700';
    } },
  { key: 'atr_state', label: 'ATR', width: 80, align: 'left',
    headerTipHtml: '<div class="rt-hdr">ATR Compression State</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-neon">💥 EXPLODE</span></div><div><div class="rt-desc">Pctl 40–95, rangeATR 2–5, volExp ≥1.5, ADR 4–8%, volR20 ≥1.8, volPre5 ≥2.25, redVolBias ≤0.9</div><div class="rt-hit hit-green">97.6% hit rate · The holy grail</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-teal">🎯 INFLECT</span></div><div><div class="rt-desc">ATR percentile 40–60. Volatility at inflection point — about to expand</div><div class="rt-hit hit-cyan">65% hit rate · Best for early breakouts</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-yellow">⚡ BUILD</span></div><div><div class="rt-desc">ATR percentile 20–40. Volatility rising from deep compression</div><div class="rt-hit hit-amber">Watch closely — building energy</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-slate">💤 SLEEP</span></div><div><div class="rt-desc">ATR percentile &lt;20. Very low volatility, coiling for future move</div><div class="rt-hit hit-slate">Too early — wait for build/inflect</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">🔥 MOMEN</span></div><div><div class="rt-desc">ATR percentile 60–95. Already expanded — ride momentum, not breakout</div><div class="rt-hit hit-amber">Trend continuation plays</div></div></div>',
    fmt: r => {
      const { state, explosion } = detectATRState(r);
      if (explosion) return '💥 EXPLODE';
      if (state === 'SWEET_SPOT') return '🎯 INFLECT';
      if (state === 'BUILDING') return '⚡ BUILD';
      if (state === 'DEEP_COMPRESSION') return '💤 SLEEP';
      if (state === 'HIGH_VOL') return '🔥 MOMEN';
      return '—';
    },
    numVal: r => { const { explosion } = detectATRState(r); return explosion ? 3 : detectATRState(r).state === 'SWEET_SPOT' ? 2 : detectATRState(r).state === 'BUILDING' ? 1 : 0; },
    cellClass: r => {
      const { state, explosion } = detectATRState(r);
      if (explosion) return 'text-[#39FF14] font-bold bg-green-900/30 px-1 rounded';
      if (state === 'SWEET_SPOT') return 'text-cyan-300 font-bold bg-cyan-900/30 px-1 rounded';
      if (state === 'BUILDING') return 'text-yellow-400 bg-yellow-900/20 px-1 rounded';
      if (state === 'DEEP_COMPRESSION') return 'text-slate-600';
      if (state === 'HIGH_VOL') return 'text-orange-400 bg-orange-900/20 px-1 rounded';
      return 'text-slate-700';
    } },
  { key: 'vol_badge', label: 'Vol', width: 75, align: 'left',
    headerTipHtml: '<div class="rt-hdr">Volume Thrust Badge</div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-orange">🔥 THRUST</span></div><div><div class="rt-desc">volR20 ≥2.0, volVsPre5 ≥2.0, redVolBias ≤0.8, close ≥65%, body ≥35%, wick ≤35%</div><div class="rt-hit hit-green">66.3% hit rate · Institutional buying</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-emerald">✓ CONF</span></div><div><div class="rt-desc">volVsPre5 ≥2.0, volR20 ≥1.2, redVolBias ≤1.1. Clear expansion above recent average</div><div class="rt-hit hit-cyan">Supports breakout · Less extreme</div></div></div>'
      + '<div class="rt-row"><div><span class="rt-badge bg-dim">— NONE</span></div><div><div class="rt-desc">No significant volume surge detected</div></div></div>',
    fmt: r => {
      const vb = detectVolumeBadge(r);
      return vb === 'HIGH_CONVICTION' ? '🔥 THRUST' : vb === 'CONFIRMED' ? '✓ CONF' : '—';
    },
    numVal: r => detectVolumeBadge(r) === 'HIGH_CONVICTION' ? 2 : detectVolumeBadge(r) === 'CONFIRMED' ? 1 : 0,
    cellClass: r => {
      const vb = detectVolumeBadge(r);
      return vb === 'HIGH_CONVICTION' ? 'text-orange-400 font-bold bg-orange-900/20 px-1 rounded' : vb === 'CONFIRMED' ? 'text-emerald-500 bg-emerald-900/20 px-1 rounded' : 'text-slate-700';
    } },
  { key: 'missing', label: 'Missing', width: 110, align: 'left',
    fmt: r => {
      if (['BUY','STRONG_BUY','ULTRA_STRONG_BUY','NO_SIGNAL','COMPRESSION_WATCH'].includes(r.stage)) return '—';
      const fails = r.checklist?.filter(c => !c.pass).slice(0, 2).map(c => c.label.replace(/[≥≤<>]/g, '').slice(0, 15)) ?? [];
      return fails.length > 0 ? fails.join(', ') : '—';
    },
    numVal: r => r.checklist ? r.checklist.filter(c => !c.pass).length : 99,
    cellClass: r => ['PRE_BREAKOUT','EARLY_INFLECTION'].includes(r.stage) ? 'text-amber-500 text-[9px]' : 'text-slate-700 text-[9px]' },
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
];

type ScannerSubTab = 'overview' | 'screening' | 'tradeplan' | 'momentum' | 'statistics' | 'all';

const SUBTAB_KEYS: Record<ScannerSubTab, Set<string>> = {
  overview: new Set(['symbol','sector','conviction','stage','inflectionScore','confidence','cmp','candle','guppy','pe_entry','pe_tact','pe_risk','pe_rr','pe_rr_verdict','zone_exp','atr_state','vol_badge','rs_rank','tf_align','momentumScore','statsScore','nearBrk','missing','track_btn']),
  screening: new Set(['symbol','stage','clDep','clHP','clElt','clUS','volRatio20','atrPct14Pctl120','zone_atr','closeLoc','upperWickPct','ultraPrecisionScore','volatilityExpansionRatio']),
  tradeplan: new Set(['symbol','stage','cmp','candle','guppy','ema10','ema21','ema55','sma200','pe_er','pe_entry','pe_tact','pe_risk','pe_rr','pe_rr_verdict','pe_rps','pe_t1','pe_t2','pe_t3r','pivot_pp','pivot_r1','pivot_s1','pe_gap','pe_gATR','pe_status','pe_valid','pe_chT1','pe_chT2','track_btn']),
  momentum: new Set(['symbol','stage','momentumScore','emaAligned','higherLow','volDryUp','obvSlope','adx14','gapRR','rsNifty','ultraPrecisionScore','volatilityExpansionRatio','volRatio20']),
  statistics: new Set(['symbol','stage','statsScore','guppy','ttmSqz','ttmMom','rsi14','cci34','volZ','bbPctl','hurst','dd52WH','pct52WL','sharpe','insBar']),
  all: new Set(/* all keys — handled below */),
};

const SUBTAB_META: Array<{ key: ScannerSubTab; label: string; emoji: string; color: string; tip: string; tipColor: string }> = [
  { key: 'overview',   label: 'Overview',    emoji: '📊', color: '#60a5fa', tip: 'Key columns: Stage, Conviction, Entry, R:R, Verdict, RS Rank', tipColor: 'blue' },
  { key: 'screening',  label: 'Screening',   emoji: '🔬', color: '#a78bfa', tip: 'Screening parameters: ATR, zone, volume ratios, UPS, CQS', tipColor: 'purple' },
  { key: 'tradeplan',  label: 'Trade Plan',  emoji: '💰', color: '#34d399', tip: 'Full trade engine: Entry, Stop, Targets, R:R, Gap%, EMAs', tipColor: 'green' },
  { key: 'momentum',   label: 'Momentum',    emoji: '📈', color: '#fb923c', tip: 'Momentum quality: EMA alignment, OBV, ADX, vol dry-up', tipColor: 'orange' },
  { key: 'statistics', label: 'Statistics',   emoji: '📉', color: '#22d3ee', tip: 'Statistical edge: TTM Squeeze, Hurst, GARCH, entropy, BB/KC', tipColor: 'cyan' },
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

  const headers = splitLine(lines[0]).map(h => h.replace(/^["']|["']$/g, '').trim().toUpperCase());
  const SYMBOL_HEADERS = ['SYMBOL','TICKER','SCRIP','STOCK','SCRIPT','NSE_SYMBOL','BSE_SYMBOL','CODE'];
  let symCol = headers.findIndex(h => SYMBOL_HEADERS.includes(h));
  const dataStart = symCol >= 0 ? 1 : 0;
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
  const [multiResults, setMultiResults] = useState<MultiAnalysisResult[]>([]);
  const [stopAlerts, setStopAlerts] = useState<Array<{symbol: string; stopPrice: number; timestamp: string; entryPrice: number}>>([]);
  const [gapAlert, setGapAlert] = useState<{type:'bullish'|'bearish'|null;gapPct:number;vix:number;confidence:number;prevClose:number;todayOpen:number}|null>(null);
  const [flagMap, setFlagMap] = useState<Record<string, {poleGain: number; flagDays: number; measuredTarget: number}>>({});
  const [guppyCoilMap, setGuppyCoilMap] = useState<Record<string, {avgSpread: number; minSpread: number}>>({});
  const [scanning, setScanning] = useState(false);
  const scanningRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [errCount, setErrCount] = useState(0);
  const [lastErr, setLastErr] = useState('');
  const [failedSymbols, setFailedSymbols] = useState<Array<{sym: string; err: string}>>([]);
  const [showFailedPanel, setShowFailedPanel] = useState(false);
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
  trackedTradesRef.current = trackedTrades;
  const [showTracker, setShowTracker] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickFilterKey>('all');
  const [marketRegime, setMarketRegime] = useState<RegimeInfo | null>(null);
  const [showTradeSheet, setShowTradeSheet] = useState<string | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [signalHistory, setSignalHistory] = useState<SignalHistory>({});
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [candleCache, setCandleCache] = useState<Record<string, Candle[]>>({});
  const [activeTab, setActiveTab] = useState<'scanner' | 'performance' | 'tradedesk' | 'journal' | 'focus' | 'validation' | 'intelligence' | 'pro'>('scanner');
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
    try {
      // Clear old results that may have incompatible schema
      // Only keep tracked trades, watchlist, sessions, and settings
      localStorage.removeItem('qtp_results');
      const savedKey = localStorage.getItem('qtp_paramSetKey');
      const savedTrades = localStorage.getItem('qtp_tracked_trades');
      if (savedKey) { setParamSetKey(savedKey as ParamSetKey); }
      if (savedTrades) { try {
        const parsed = JSON.parse(savedTrades);
        setTrackedTrades(Array.isArray(parsed) ? parsed.filter((t: TrackedTrade) => t && typeof t.entryPrice === 'number' && typeof t.stopLoss === 'number') : []);
      } catch { /* ignore */ } }
      try { setWatchlist(loadWatchlist()); } catch { /* ignore */ }
      try { setSignalHistory(loadSignalHistory()); } catch { /* ignore */ }
      try { setSessions(loadSessions()); } catch { /* ignore */ }
      try { setFavorites(loadFavorites()); } catch { /* ignore */ }
      try { setReviews(loadReviews()); } catch { /* ignore */ }
      const savedTheme = localStorage.getItem('qtp_theme');
      if (savedTheme === 'light') setTheme('light');
      setTgConfig(loadTelegramConfig());
      const savedParamSet = localStorage.getItem('qtp_paramset');
      if (savedParamSet === 'ALL4') setScanAll(true);
      else if (savedParamSet && PARAM_SET_OPTIONS.some(o => o.key === savedParamSet)) setParamSetKey(savedParamSet as ParamSetKey);
    } catch {
      // Nuclear fallback — clear everything
      try { localStorage.clear(); } catch { /* ignore */ }
    }
  }, []);

  // Persist tracked trades
  useEffect(() => {
    if (trackedTrades.length > 0) {
      try { localStorage.setItem('qtp_tracked_trades', JSON.stringify(trackedTrades)); } catch {}
    }
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
      if (sw > 0 && sw !== actualTableWidth) setActualTableWidth(sw);
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

    abortRef.current = false;
    setPreviousResults(resultsRef.current);
    setScanStartTime(Date.now());
    setScanning(true); scanningRef.current = true;
    try {
    setResults([]);
    setMultiResults([]);
    setSelectedRowIdx(-1);
    const scanSymbols = dedupedSymbols;
    setProgress(0);
    setErrCount(0);
    setLastErr('');
    setFailedSymbols([]);
    setTotal(scanSymbols.length);
    setSelectedSymbol(null);
    setStageFilter('ALL');
    setColFilters({});
    setGlobalSearch('');

    const newResults: AnalysisResult[] = [];
    const freshCandleMap: Record<string, Candle[]> = {};
    const newMultiResults: MultiAnalysisResult[] = [];
    const newFailed: Array<{sym: string; err: string}> = [];
    const CONCURRENCY = 6;
    const queue = [...scanSymbols];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function flushResults() {
      setResults([...newResults]);
      if (scanAll) setMultiResults([...newMultiResults]);
    }

    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(() => { flushTimer = null; flushResults(); }, 300);
    }

    // Feature #4: Pre-fetch Nifty 50 candles for RS calculation
    let niftyData: Candle[] | null = niftyCandles;
    if (!niftyData) {
      try {
        const { candles: nc } = await fetchOHLCVClient('^NSEI');
        niftyData = nc;
        setNiftyCandles(nc);
      } catch {
        try {
          const { candles: nc } = await fetchOHLCVClient('NIFTY_50.NS');
          niftyData = nc;
          setNiftyCandles(nc);
        } catch { /* Nifty fetch failed — RS will default to 1.0 */ }
      }
    }

    async function processOne(sym: string) {
      if (abortRef.current) return;
      try {
        const { candles, resolvedSymbol } = await fetchOHLCVClient(sym);
        if (abortRef.current) return;
        let result: AnalysisResult;
        if (scanAll) {
          const multi = analyzeStockMulti(candles, resolvedSymbol);
          newMultiResults.push(multi);
          result = multi.best;
        } else if (lookback > 1) {
          result = analyzeStockWithLookback(candles, paramSetKey, lookback);
          result.symbol = resolvedSymbol;
          result.clusterBreakdown = computeClusterBreakdown(candles);
        } else {
          result = analyzeStock(candles, paramSetKey);
          result.symbol = resolvedSymbol;
          result.clusterBreakdown = computeClusterBreakdown(candles);
        }
        // Feature #4: compute RS vs Nifty
        if (niftyData && niftyData.length > 20) {
          const rs = computeRSvsNifty(candles, niftyData, 20);
          result.momentum = { ...result.momentum, rsNifty20: Number.isFinite(rs) ? rs : 1.0 };
        }
        // Cache candles for sparkline + validation
        const sliced = candles.slice(-60);
        freshCandleMap[result.symbol] = sliced;
        setCandleCache(prev => ({ ...prev, [result.symbol]: sliced }));
        newResults.push(result);
        // #8: Alert sound on new BUY signal
        if (['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(result.stage)) {
          const prevStage = previousResults.find(p => p.symbol === result.symbol)?.stage;
          if (!prevStage || !['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(prevStage)) {
            try { new Audio('data:audio/wav;base64,UklGRl9vT19teleXBQVZFZm10teleIBAAEARKwAAIhYAQACABAAZGF0YQ==').play().catch(() => {}); } catch {}
          }
        }
        scheduleFlush();
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        newFailed.push({ sym, err: errMsg });
        setErrCount(n => n + 1);
        setLastErr(`${sym}: ${errMsg}`);
      }
      setProgress(p => p + 1);
    }

    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length > 0 && !abortRef.current) {
          const sym = queue.shift();
          if (sym) await processOne(sym);
        }
      })
    );
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushResults();
    setFailedSymbols(newFailed);
    setLastScanSymbols(scanSymbols);
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
          if (t.status !== 'open') continue;
          // Sync stop/targets from fresh scan results (fixes formula changes)
          const freshResult = newResults.find(r => r.symbol === t.symbol);
          if (freshResult && freshResult.priceEngine.tacticalStop > 0) {
            updated[i] = { ...updated[i],
              stopLoss: freshResult.priceEngine.tacticalStop,
              target1: freshResult.priceEngine.target5,
              target2: freshResult.priceEngine.target7,
              target3: freshResult.priceEngine.target10,
            };
          }
          const cached = freshCandleMap[t.symbol];
          if (!cached || cached.length === 0) continue;
          const entryTs = new Date(t.entryDate).getTime() / 1000;
          let sinceEntry = cached.filter(c => c.ts >= entryTs);
          if (sinceEntry.length === 0) sinceEntry = cached.slice(-10);
          if (sinceEntry.length === 0) continue;
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
        try { localStorage.setItem('qtp_tracked_trades', JSON.stringify(updated)); } catch {}
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
        const prevMap = new Map(resultsRef.current.map(r => [r.symbol, r.stage]));
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
          if (flagInfo) {
            msg += `\n🚩 <b>FLAG PATTERN DETECTED</b>\n`;
            msg += `Pole: +${flagInfo.poleGain.toFixed(0)}% surge → ${flagInfo.flagDays}d consolidation → breakout\n`;
            msg += `Measured target: Rs.${flagInfo.measuredTarget.toFixed(0)}\n`;
            msg += `Double conviction: compression + flag continuation\n`;
          }
          const guppyInfo = newGuppyCoilMap[r.symbol];
          if (guppyInfo) {
            msg += `\n💎 <b>GUPPY COILED — Max Compression Breakout</b>\n`;
            msg += `All 12 Guppy EMAs compressed to ${guppyInfo.avgSpread.toFixed(1)}% spread\n`;
            msg += `Maximum stored energy — monster move potential\n`;
          }
          sendTelegramMessage(tg, msg);
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
    } catch (err) {
      console.error('Scan error:', err);
    } finally {
      setScanning(false); scanningRef.current = false;
      setScanEndTime(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }));
    }
  }, [paramSetKey, scanAll, lookback, niftyCandles, scanSource]);

  // Feature #5+#8: Adaptive auto-refresh during market hours
  useEffect(() => {
    if (!autoRefresh || scanning || lastScanSymbols.length === 0) return;
    const check = () => {
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
  }, [autoRefresh, scanning, lastScanSymbols, runScan]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const symbols = parseCSV(ev.target?.result as string);
      if (symbols.length > 0) {
        runScan(symbols);
      } else {
        setLastErr('No valid symbols found in CSV. Ensure it has a "Symbol" column.');
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

  // Win rate stats (#2)
  const winStats = useMemo(() => computeWinRateStats(trackedTrades), [trackedTrades]);

  // Track a trade (#2)
  function trackTrade(r: AnalysisResult) {
    // Risk warning: check if adding this trade exceeds 5% total risk
    const openTrades = trackedTradesRef.current.filter(t => t.status === 'open' && t.symbol !== r.symbol);
    const currentRisk = openTrades.reduce((s, t) => s + Math.max(t.entryPrice - t.stopLoss, 0), 0);
    const newRisk = r.priceEngine.plannedEntry - r.priceEngine.tacticalStop;
    const totalRiskPct = accountSize > 0 ? ((currentRisk + newRisk) / accountSize) * 100 : 0;
    if (totalRiskPct > 5 && !confirm(`⚠ Total risk will be ${totalRiskPct.toFixed(1)}% of account (exceeds 5% max recommended). Continue?`)) return;

    const trade: TrackedTrade = {
      symbol: r.symbol, stage: r.stage, entryPrice: r.priceEngine.plannedEntry,
      entryDate: r.lastDate || new Date().toISOString().slice(0, 10), stopLoss: r.priceEngine.tacticalStop,
      target1: r.priceEngine.target5, target2: r.priceEngine.target7,
      target3: r.priceEngine.target10, disasterStop: r.priceEngine.disasterStop,
      paramSetKey: r.paramSetKey, sector: getSectorTag(r.symbol),
      conviction: computeConviction(r), status: 'open',
    };
    setTrackedTrades(prev => [...prev.filter(t => t.symbol !== r.symbol), trade]);
  }

  function removeTrade(symbol: string) {
    setTrackedTrades(prev => {
      const updated = prev.filter(t => t.symbol !== symbol);
      try { localStorage.setItem('qtp_tracked_trades', JSON.stringify(updated)); } catch {}
      return updated;
    });
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
      else { tip.textContent = el.getAttribute('data-tip') ?? ''; tip.className = ''; const color = el.getAttribute('data-tip-color'); if (color && colorClasses.includes(`tip-${color}`)) tip.classList.add(`tip-${color}`); }
      const rect = el.getBoundingClientRect();
      const tipW = 320;
      let left = rect.left + rect.width / 2;
      if (left - tipW / 2 < 8) left = tipW / 2 + 8;
      if (left + tipW / 2 > window.innerWidth - 8) left = window.innerWidth - tipW / 2 - 8;
      tip.style.left = `${left}px`;
      tip.style.top = `${rect.bottom + 10}px`;
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
  const [portfolioResult, setPortfolioResult] = useState<PortfolioResult | null>(null);
  const [tgConfig, setTgConfig] = useState<TelegramConfig>({ botToken: '', chatId: '', enabled: false, alerts: { newSignal: true, targetHit: true, stopped: true, regimeChange: true, dailySummary: true, signalDecay: false } });
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
          if (lastCandle && prevCandle && prevCandle.c > 0) {
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
  const nearBreakoutCount = useMemo(() => results.filter(r => r.nearBreakout).length, [results]);

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
    const today = new Date().toISOString().slice(0, 10);
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
        <span className="text-xs text-slate-600">v8.2</span>
        <select
          value={scanAll ? 'ALL4' : paramSetKey}
          onChange={e => {
            if (e.target.value === 'ALL4') { setScanAll(true); try { localStorage.setItem('qtp_paramset', 'ALL4'); } catch {} }
            else { setScanAll(false); setParamSetKey(e.target.value as ParamSetKey); try { localStorage.setItem('qtp_paramset', e.target.value); } catch {} }
          }}
          className={`ml-2 border rounded text-xs px-2 py-1 focus:outline-none cursor-pointer ${scanAll ? 'bg-cyan-900/40 border-cyan-600 text-cyan-300 focus:border-cyan-400' : 'bg-slate-800 border-slate-700 text-slate-200 focus:border-indigo-500'}`}
        >
          <option value="ALL4">★ All 4 Param Sets (Multi-Scan)</option>
          {PARAM_SET_OPTIONS.map(o => (
            <option key={o.key} value={o.key}>{o.name} [{o.tag}]</option>
          ))}
        </select>
        {/* Feature #3: Lookback */}
        <div className="flex items-center gap-1 text-xs">
          <span className="text-slate-600">Lookback:</span>
          <select value={lookback} onChange={e => setLookback(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 rounded text-xs text-slate-300 px-1 py-0.5 focus:outline-none cursor-pointer">
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
            data-tip-html={`<div class="rt-hdr">8-Factor Regime · Score ${marketRegime.score >= 0 ? '+' : ''}${marketRegime.score}</div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.factors.momentum >= 0 ? 'bg-emerald' : 'bg-orange'}">Momentum</span></div><div><div class="rt-desc">20d return: ${marketRegime.factors.momentum >= 0 ? '+' : ''}${marketRegime.factors.momentum.toFixed(2)}%</div></div></div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.factors.breadth > 50 ? 'bg-emerald' : 'bg-orange'}">Breadth</span></div><div><div class="rt-desc">${marketRegime.factors.breadth.toFixed(0)}% green days</div></div></div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.factors.volatility < 1.5 ? 'bg-teal' : 'bg-orange'}">Volatility</span></div><div><div class="rt-desc">${marketRegime.factors.volatility.toFixed(2)}% realized vol</div></div></div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.factors.acceleration >= 0 ? 'bg-cyan' : 'bg-orange'}">Accel</span></div><div><div class="rt-desc">${marketRegime.factors.acceleration >= 0 ? '+' : ''}${marketRegime.factors.acceleration.toFixed(2)}%</div></div></div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.factors.distEma200 >= 0 ? 'bg-blue' : 'bg-orange'}">EMA200</span></div><div><div class="rt-desc">${marketRegime.factors.distEma200 >= 0 ? '+' : ''}${marketRegime.factors.distEma200.toFixed(1)}% from EMA200</div></div></div>`
              + (marketRegime.vix > 0 ? `<div class="rt-row"><div><span class="rt-badge ${marketRegime.vix < 20 ? 'bg-emerald' : 'bg-orange'}">VIX</span></div><div><div class="rt-desc">${marketRegime.vix.toFixed(1)} ${marketRegime.vix < 12 ? '(complacent)' : marketRegime.vix < 16 ? '(low fear)' : marketRegime.vix < 22 ? '(moderate)' : marketRegime.vix < 30 ? '(elevated)' : marketRegime.vix < 45 ? '(high fear)' : '(PANIC)'}</div></div></div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.factors.vixROC < 0 ? 'bg-emerald' : 'bg-orange'}">VIX ROC</span></div><div><div class="rt-desc">5d change: ${marketRegime.factors.vixROC >= 0 ? '+' : ''}${marketRegime.factors.vixROC.toFixed(1)}%</div></div></div>`
              + `<div class="rt-row"><div><span class="rt-badge ${marketRegime.factors.vixVsSma < 0 ? 'bg-teal' : 'bg-orange'}">VIX/SMA</span></div><div><div class="rt-desc">${marketRegime.factors.vixVsSma >= 0 ? '+' : ''}${marketRegime.factors.vixVsSma.toFixed(1)}% vs 20d avg</div></div></div>` : '')
              + `<div class="rt-row"><div><span class="rt-badge bg-neon">Sizing</span></div><div><div class="rt-desc">Position: ×${marketRegime.sizingMultiplier}</div></div></div>`}>
            {marketRegime.emoji} {marketRegime.label} · Nifty ₹{marketRegime.niftyClose.toFixed(0)}{marketRegime.vix > 0 ? ` · VIX ${marketRegime.vix.toFixed(1)}` : ''} · ×{marketRegime.sizingMultiplier}
          </div>
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
                + `<div class="rt-row"><div><span class="rt-badge bg-neon">Backtest</span></div><div><div class="rt-desc">10yr Nifty+VIX backtest: this combo was ${gapAlert.type==='bullish'?'bullish':'bearish'} ${gapAlert.confidence.toFixed(1)}% of the time</div><div class="rt-hit hit-green">Based on ${gapAlert.confidence>90?'103':gapAlert.confidence>80?'87':gapAlert.confidence>70?'303':'852'} historical occurrences</div></div></div>`}>
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
            title={`${marketBreadth.above200} of ${marketBreadth.total} stocks above 200 SMA — ${marketBreadth.pct >= 60 ? 'Healthy market' : marketBreadth.pct >= 40 ? 'Mixed market' : 'Weak market'}`}>
            Breadth {marketBreadth.pct.toFixed(0)}%
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
          <button disabled={scanning} data-tip="Load sample data to explore the screener without scanning" data-tip-color="indigo" onClick={() => { setResults(generateDemoData(paramSetKey)); setSelectedSymbol(null); setStageFilter('ALL'); setColFilters({}); }}
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
                const openTrades = trackedTradesRef.current.filter(t => t.status === 'open');
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
                          if (freshR.priceEngine.tacticalStop > 0) {
                            updated[idx] = { ...updated[idx],
                              stopLoss: freshR.priceEngine.tacticalStop,
                              target1: freshR.priceEngine.target5,
                              target2: freshR.priceEngine.target7,
                              target3: freshR.priceEngine.target10,
                            };
                          }
                        } catch { /* analysis failed — keep existing values */ }
                      }
                      const entryTs = new Date(t.entryDate).getTime() / 1000;
                      let sinceEntry = candles.filter(c => c.ts >= entryTs);
                      if (sinceEntry.length === 0) sinceEntry = candles.slice(-10);
                      if (sinceEntry.length === 0) { setProgress(p => p + 1); continue; }
                      const result = validateTrade(updated[idx >= 0 ? idx : 0], sinceEntry);
                      if (idx >= 0) {
                        updated[idx] = applyValidation(updated[idx], result);
                        const lastCandle = candles[candles.length - 1];
                        if (lastCandle && lastCandle.c > 0) updated[idx].currentPrice = lastCandle.c;
                        const maxH = Math.max(...sinceEntry.map(c => c.h));
                        if (maxH > (updated[idx].highestPrice ?? 0)) updated[idx].highestPrice = maxH;
                        validated++;
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
                  try { localStorage.setItem('qtp_tracked_trades', JSON.stringify(updated)); } catch {}
                  setValidateFlash(validated);
                  setTimeout(() => setValidateFlash(0), 3000);
                } catch {} finally {
                  setScanning(false); scanningRef.current = false;
                }
              }}
              className="h-7 px-2.5 bg-cyan-900/40 hover:bg-cyan-900/60 disabled:opacity-40 border border-cyan-600 rounded text-[11px] font-semibold text-cyan-300 transition-colors">
              {scanning ? `🔬 ${progress}/${total}` : validateFlash > 0 ? `✓ ${validateFlash} validated` : `🔬 Validate (${trackedTrades.filter(t => t.status === 'open').length})`}</button>
          )}
        </div>

        <div className="w-px h-5 bg-slate-700 shrink-0" />

        {/* Group 2: Index presets */}
        <div className="flex items-center gap-1 shrink-0">
          <select disabled={scanning} value="" data-tip="Scan stocks from Nifty broad market indices (50, 100, 200, 500, Full Equity)" data-tip-color="green"
            onChange={e => { const p = NIFTY_PRESETS.find(p => p.key === e.target.value); if (p) { setScanSource(p.label); runScan([...p.symbols]); } }}
            className="h-7 px-1.5 bg-emerald-900/40 hover:bg-emerald-900/60 disabled:opacity-40 border border-emerald-700 rounded text-[11px] font-medium text-emerald-300 cursor-pointer focus:outline-none">
            <option value="" disabled>Nifty ▾</option>
            {NIFTY_PRESETS.map(p => (<option key={p.key} value={p.key}>{p.label} ({p.count})</option>))}
          </select>
          <select disabled={scanning} value="" data-tip="Scan stocks from 30 NSE sectoral indices (IT, Bank, Pharma, Auto, etc.)" data-tip-color="amber"
            onChange={e => { const p = SECTOR_PRESETS.find(p => p.key === e.target.value); if (p) { setScanSource(p.label); runScan([...p.symbols]); } }}
            className="h-7 px-1.5 bg-amber-900/40 hover:bg-amber-900/60 disabled:opacity-40 border border-amber-700 rounded text-[11px] font-medium text-amber-300 cursor-pointer focus:outline-none">
            <option value="" disabled>Sector ▾</option>
            {SECTOR_PRESETS.map(p => (<option key={p.key} value={p.key}>{p.label} ({p.count})</option>))}
          </select>
          <select disabled={scanning} value="" data-tip="Scan thematic & strategy indices (MNC, PSE, Growth, Value, Momentum, etc.)" data-tip-color="purple"
            onChange={e => { const p = THEMATIC_PRESETS.find(p => p.key === e.target.value); if (p) { setScanSource(p.label); runScan([...p.symbols]); } }}
            className="h-7 px-1.5 bg-purple-900/40 hover:bg-purple-900/60 disabled:opacity-40 border border-purple-700 rounded text-[11px] font-medium text-purple-300 cursor-pointer focus:outline-none">
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
            const qfColors: Record<string, string> = { all: 'blue', ready: 'green', tomorrow: 'yellow', strongest: 'orange', safe: 'cyan' };
            return QUICK_FILTERS.map(qf => (
              <button key={qf.key} onClick={() => setQuickFilter(quickFilter === qf.key ? 'all' : qf.key)}
                data-tip={qf.description} data-tip-color={qfColors[qf.key] ?? 'blue'}
                className={`h-7 px-2 rounded text-[11px] font-medium border transition-colors ${quickFilter === qf.key ? 'bg-indigo-900/50 border-indigo-500 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300'}`}>
                {qf.emoji} {qf.label}</button>
            ));
          })()}
          {nearBreakoutCount > 0 && (
            <button onClick={() => setColFilters(prev => ({ ...prev, nearBrk: prev.nearBrk ? '' : '>0' }))}
              data-tip="Stocks within 5% of breaking out of compression zone" data-tip-color="yellow"
              className={`h-7 px-2 rounded text-[11px] font-medium border transition-colors ${colFilters.nearBrk ? 'bg-yellow-900/50 border-yellow-600 text-yellow-300' : 'bg-slate-800 border-yellow-700 text-yellow-500 hover:text-yellow-300'}`}>
              ⚡ {nearBreakoutCount} BRK</button>
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
                <div>3. Do NOT hold hoping for recovery — 9 gates confirmed genuine breakdown</div>
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
                  const rps = t.entryPrice - t.stopLoss;
                  const riskPct = t.entryPrice > 0 ? (rps / t.entryPrice * 100) : 0;
                  const unrealPnl = t.status === 'open' && t.currentPrice && t.entryPrice > 0 ? ((t.currentPrice - t.entryPrice) / t.entryPrice * 100) : null;
                  const unrealR = t.status === 'open' && t.currentPrice && rps > 0 ? ((t.currentPrice - t.entryPrice) / rps) : null;
                  const toT1Pct = t.status === 'open' && t.currentPrice && t.target1 > 0 ? ((t.target1 - t.currentPrice) / t.currentPrice * 100) : null;
                  const displayPnl = t.pnlPct ?? unrealPnl;
                  const displayR = t.pnlR ?? unrealR;
                  // Sequence: W/L markers for closed trades
                  const closedUpToHere = arr.slice(0, i + 1).filter(x => x.status !== 'open');
                  const seqMark = t.status !== 'open' ? ((t.pnlPct ?? 0) >= 0 ? 'W' : 'L') : '·';
                  return (
                  <tr key={i} className={`border-b border-slate-800/30 hover:bg-slate-800/20 ${t.status !== 'open' ? '' : 'opacity-80'}`}>
                    <td className="px-2 py-1 font-mono text-slate-200">{t.symbol.replace('.NS','').replace('.BO','')}</td>
                    <td className="px-2 py-1 text-center">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${t.status === 'open' ? 'bg-amber-900/30 text-amber-400' : (t.pnlPct ?? 0) > 0 ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>
                        {t.status === 'open' ? 'OPEN' : t.status === 'hit_t1' ? 'T1' : t.status === 'hit_t2' ? 'T2' : t.status === 'hit_t3' ? 'T3' : t.status === 'stopped' ? 'STOP' : t.status === 'expired' ? 'EXP' : 'CLOSE'}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right text-slate-300 font-mono">₹{t.entryPrice.toFixed(0)}</td>
                    <td className={`px-2 py-1 text-right font-mono ${riskPct <= 2 ? 'text-emerald-500' : riskPct <= 3 ? 'text-amber-500' : 'text-red-500'}`} title={`Risk: ${riskPct.toFixed(1)}%`}>₹{t.stopLoss.toFixed(0)}</td>
                    <td className={`px-2 py-1 text-right font-mono ${t.status === 'hit_t1' ? 'text-emerald-400 font-bold' : 'text-emerald-700'}`}>{t.target1 > 0 ? `₹${t.target1.toFixed(2)}` : '—'}</td>
                    <td className={`px-2 py-1 text-right font-mono ${t.status === 'hit_t2' ? 'text-emerald-400 font-bold' : 'text-emerald-800'}`}>{t.target2 > 0 ? `₹${t.target2.toFixed(0)}` : '—'}</td>
                    <td className={`px-2 py-1 text-right font-mono ${t.status === 'hit_t3' ? 'text-yellow-300 font-bold' : 'text-yellow-900'}`}>{t.target3 > 0 ? `₹${t.target3.toFixed(0)}` : '—'}</td>
                    <td className={`px-2 py-1 text-right font-mono font-semibold ${t.closedPrice ? ((t.pnlPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400') : t.currentPrice ? 'text-slate-300' : 'text-slate-600'}`}>{t.closedPrice ? `₹${t.closedPrice.toFixed(2)}` : t.currentPrice ? `₹${t.currentPrice.toFixed(0)}` : '—'}</td>
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
                      <button onClick={() => setTrackedTrades(prev => prev.filter(x => x.symbol !== t.symbol))}
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
                  <span className="text-slate-600">{s.paramSet === 'ALL4' ? '4-Set' : s.paramSet.replace('optimized_', '').slice(0, 8)}</span>
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
                          failedBreakoutLevel: 0, timeStop3d: 0, timeStop5d: 0, timeStop10d: 0, tradeValid: c.tv,
                        },
                        conditionsMet: 0, totalConditions: 20, checklist: [],
                        momentum: { emaAligned: false, ema20: 0, ema50: 0, higherLowConfirmed: false, swingLow20: 0, volDryUpScore: 0, obvSlope10: 0, adx14: 20, adxInRange: true, gapAdjustedRR: 0, momentumScore: c.ms, rsNifty20: 1.0 },
                        nearBreakoutPct: c.nbp ?? (c.nb ? 1 : 99), nearBreakout: c.nb,
                        stats: {
                          volZScore: 0, volZSignificant: false, bbWidth: 0, bbWidthPctl: 50, bbSqueeze: false, keltnerSqueeze: false,
                          lrSlope10: 0, lrSlopeFlat: false, autoCorr5: 0, momentumRegime: false, hurst: 0.5, hurstTrending: false,
                          skewness20: 0, positiveSkew: false, drawdownFrom52WH: 0, pctFrom52WL: 0, sharpe20: 0, entropy10: 0,
                          cusumSignal: false, sectorRelZ: 0, insideBars: 0, volProfileSkew: 0, garchForecast: 1.0,
                          ttmSqueezeOn: false, ttmSqueezeFired: false, ttmMomentum: 0, ttmMomentumRising: false,
                          rsi14: 50, cci34: 0, ema10: 0, ema21: 0, ema55: 0, sma200: 0,
                          ema10Cross: false, ema21Cross: false, ema55Cross: false, sma200Cross: false,
                          guppySpreadPct: c.gp ?? 99, guppyCompressed: (c.gp ?? 99) < 1, guppyUltraCompressed: (c.gp ?? 99) < 0.5,
                          candlePattern: c.cp ?? '—', candlePatternFull: c.cpf ?? 'Unknown',
                          candlePatternType: (c.cpt ?? 'neutral') as 'bullish' | 'bearish' | 'neutral',
                          candlePatternStrength: c.cps ?? 0, statsScore: c.ss,
                        },
                        clusterBreakdown: { deployable: { met: c.cd?.d ?? 0, total: c.cd?.dt ?? 21 }, highPrecision: { met: c.cd?.h ?? 0, total: c.cd?.ht ?? 19 }, elite: { met: c.cd?.e ?? 0, total: c.cd?.et ?? 21 }, ultraSelective: { met: c.cd?.u ?? 0, total: c.cd?.ut ?? 20 } },
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
                ['targetHit', '✅ Target Hit'],
                ['stopped', '🔴 Stopped'],
                ['regimeChange', '⚠ Regime'],
                ['dailySummary', '📊 Summary'],
                ['signalDecay', '⏳ Decay'],
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
            {failedSymbols.map((f, i) => (
              <div key={i} className="text-xs flex gap-2">
                <span className="text-red-400 font-mono shrink-0">{f.sym}</span>
                <span className="text-red-600 truncate">{f.err}</span>
              </div>
            ))}
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
      <div className="flex-shrink-0 border-b border-slate-800 bg-[#0d1117] px-4 py-1 flex items-center gap-1">
        {([
          ['scanner',      '📊', 'Scanner',      '#818cf8', 'Main screening table — 60+ sortable columns with 6 sub-views', 'indigo'],
          ['performance',  '📈', 'Performance',  '#34d399', 'Equity curve, monthly reports, and win rate dashboard', 'green'],
          ['tradedesk',    '🎯', 'Trade Desk',   '#f97316', 'Position sizing, open/closed trades, watchlist management', 'orange'],
          ['journal',      '📝', 'Journal',      '#a78bfa', 'Post-trade reviews and lessons learned tracker', 'purple'],
          ['focus',        '⚡', 'Focus',        '#facc15', 'Top 5 signals — zero-clutter, one-click decision view', 'yellow'],
          ['validation',   '🔬', 'Validation',   '#22d3ee', 'Auto-validated trades with MFE/MAE, scatter plots, edge analysis', 'cyan'],
          ['intelligence', '🧠', 'Intelligence', '#f472b6', 'RS ranking, sector rotation, multi-TF, correlation guard', 'pink'],
          ['pro', '🏆', 'Pro', '#fbbf24', 'Backtester, signal narrative, portfolio optimizer', 'yellow'],
        ] as const).map(([key, emoji, label, color, tip, tipColor]) => (
          <button key={key} onClick={() => setActiveTab(key as typeof activeTab)}
            data-tip={tip} data-tip-color={tipColor}
            style={activeTab === key ? { borderColor: color, color, backgroundColor: `${color}15` } : {}}
            className={`h-7 px-3 rounded border text-[11px] font-semibold transition-colors ${activeTab === key ? '' : 'border-slate-700/50 text-slate-500 hover:text-slate-300 hover:border-slate-600 hover:bg-slate-800/40'}`}>
            {emoji} {label}
          </button>
        ))}
        {/* Scan favorites */}
        {favorites.length > 0 && activeTab === 'scanner' && (
          <div className="ml-auto flex gap-1 items-center">
            {favorites.map(f => (
              <button key={f.id} onClick={() => { setScanSource(f.source); runScan([...f.symbols]); }}
                className="px-2 py-1 bg-indigo-900/30 hover:bg-indigo-900/50 border border-indigo-700 rounded text-xs text-indigo-300 transition-colors"
                title={`${f.symbols.length} stocks · ${f.paramSet}`}>▶ {f.name}</button>
            ))}
          </div>
        )}
        {/* Save current scan as favorite */}
        {activeTab === 'scanner' && lastScanSymbols.length > 0 && (
          <button onClick={() => {
            const name = prompt('Name this scan favorite:', scanSource);
            if (name) {
              const fav: ScanFavorite = { id: Date.now().toString(36), name, source: scanSource, symbols: lastScanSymbols, paramSet: scanAll ? 'ALL4' : paramSetKey };
              const updated = [...favorites, fav]; setFavorites(updated); saveFavorites(updated);
            }
          }}
            className="ml-2 px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs text-slate-500 hover:text-slate-300 transition-colors">
            + Save Favorite</button>
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
                          <td className="px-3 py-1.5 font-mono text-slate-200 font-medium">{r.symbol}</td>
                          <td className={`px-2 py-1.5 font-semibold ${STAGE_CONFIG[r.stage].color}`}>{STAGE_CONFIG[r.stage].label}</td>
                          <td className="px-2 py-1.5 text-right text-slate-200 font-mono">₹{r.priceEngine.plannedEntry.toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right text-red-400 font-mono">₹{r.priceEngine.tacticalStop.toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right text-amber-400 font-mono">₹{risk.toFixed(2)}</td>
                          <td className="px-2 py-1.5 text-right text-emerald-400 font-mono font-bold">{qty}</td>
                          <td className="px-2 py-1.5 text-right text-slate-300 font-mono">₹{(capital / 1000).toFixed(0)}K</td>
                          <td className="px-2 py-1.5 text-right text-red-400 font-mono">₹{maxRisk.toFixed(0)}</td>
                          <td className="px-2 py-1.5 text-right text-emerald-300 font-mono">₹{r.priceEngine.target5.toFixed(2)}</td>
                          <td className={`px-2 py-1.5 text-right font-mono font-semibold ${r.priceEngine.rewardRisk >= 1.2 ? 'text-green-300' : r.priceEngine.rewardRisk >= 0.9 ? 'text-emerald-400' : r.priceEngine.rewardRisk >= 0.5 ? 'text-yellow-300' : 'text-slate-400'}`}>{r.priceEngine.rewardRisk.toFixed(2)}</td>
                          <td className={`px-2 py-1.5 text-left text-xs font-semibold ${r.priceEngine.rewardRisk >= 1.2 ? 'text-green-300' : r.priceEngine.rewardRisk >= 0.9 ? 'text-emerald-400' : r.priceEngine.rewardRisk >= 0.7 ? 'text-yellow-300' : r.priceEngine.rewardRisk >= 0.5 ? 'text-orange-400' : 'text-red-500'}`}>{r.priceEngine.rewardRisk >= 1.2 ? 'Elite' : r.priceEngine.rewardRisk >= 0.9 ? 'Very Good' : r.priceEngine.rewardRisk >= 0.7 ? 'Good' : r.priceEngine.rewardRisk >= 0.5 ? 'Acceptable' : 'Rejected'}</td>
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
                    <button onClick={() => { if (confirm('Remove ALL tracked trades? This cannot be undone.')) { setTrackedTrades([]); try { localStorage.removeItem('qtp_tracked_trades'); } catch {} } }}
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
                        const daysLeft = 10 - (t.daysHeld ?? 0);
                        return (
                        <tr key={i} className="border-b border-slate-800/40 group">
                          <td className="px-3 py-1.5 font-mono text-slate-200">{t.symbol}</td>
                          <td className="px-2 py-1.5 text-right text-slate-300 font-mono">₹{t.entryPrice.toFixed(0)}</td>
                          <td className="px-2 py-1.5 text-right text-red-400 font-mono">₹{t.stopLoss.toFixed(0)}</td>
                          <td className="px-2 py-1.5 text-right text-emerald-400 font-mono">₹{t.target1.toFixed(0)}</td>
                          <td className="px-2 py-1.5 text-slate-500">{t.entryDate}</td>
                          <td className="px-2 py-1.5 text-slate-600">{t.sector || '—'}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${mfePct > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>{mfePct > 0 ? `+${mfePct.toFixed(1)}%` : '—'}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${mfeR > 0 ? 'text-emerald-300' : 'text-slate-600'}`}>{mfeR > 0 ? `+${mfeR.toFixed(1)}R` : '—'}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${maePct < 0 ? 'text-red-400' : 'text-slate-600'}`}>{maePct < 0 ? `${maePct.toFixed(1)}%` : '—'}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${maeR < 0 ? 'text-red-300' : 'text-slate-600'}`}>{maeR < 0 ? `${maeR.toFixed(1)}R` : '—'}</td>
                          <td className={`px-2 py-1.5 text-right ${(t.daysHeld ?? 0) >= 8 ? 'text-amber-400' : 'text-slate-500'}`} title={daysLeft > 0 ? `Auto-expires in ${daysLeft} days` : 'Expiring soon!'}>{t.daysHeld ?? '—'}{(t.daysHeld ?? 0) >= 8 ? ' ⏳' : ''}</td>
                          <td className={`px-2 py-1.5 text-right font-mono ${t.currentPrice ? 'text-slate-300' : 'text-slate-600'}`}>{t.currentPrice ? `₹${t.currentPrice.toFixed(0)}` : '—'}</td>
                          <td className={`px-2 py-1.5 text-right font-mono font-semibold ${curPnl > 0 ? 'text-emerald-400' : curPnl < 0 ? 'text-red-400' : 'text-slate-500'}`}>{t.currentPrice ? `${curPnl >= 0 ? '+' : ''}${curPnl.toFixed(1)}%` : '—'}</td>
                          <td className="px-2 py-1.5 text-center"><span className="bg-blue-900/40 text-blue-300 text-[10px] px-1.5 py-0.5 rounded font-medium">OPEN</span></td>
                          <td className="px-1 py-1.5 text-center">
                            <button onClick={() => removeTrade(t.symbol)} className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-300 transition-all" title="Remove trade">✕</button>
                          </td>
                        </tr>
                        );
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
                        };
                        const sc = statusCfg[t.status] ?? { label: t.status, color: 'bg-slate-700 text-slate-400' };
                        return (
                          <tr key={i} className="border-b border-slate-800/40 group">
                            <td className="px-3 py-1.5 font-mono text-slate-300">{t.symbol}</td>
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
                            <td className="px-1 py-1.5 text-center">
                              <button onClick={() => removeTrade(t.symbol)} className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-300 transition-all" title="Remove trade">✕</button>
                            </td>
                          </tr>
                        );
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
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">🧠 Trading Intelligence</h2>

            {results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-600">
                <div className="text-5xl mb-4">🧠</div>
                <div className="text-lg font-medium mb-1">Intelligence Module</div>
                <div className="text-sm">Run a scan to activate RS ranking, sector rotation, multi-TF analysis</div>
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

            {/* Signal Decay Legend */}
            <div className="bg-slate-800/20 rounded-lg px-3 py-2 text-[10px] text-slate-600 space-y-0.5">
              <div><span className="text-slate-500 font-semibold">RS Rank:</span> Mansfield Relative Strength percentile (0-100). Above 70 = leader, below 30 = laggard. Only buy RS leaders.</div>
              <div><span className="text-slate-500 font-semibold">TF Align:</span> DW = Daily + Weekly breakout confirmed (highest probability). D = Daily only (weekly still compressing).</div>
              <div><span className="text-slate-500 font-semibold">Sector Rotation:</span> Green = money flowing in + signals appearing. Red = money leaving. Trade WITH sector momentum.</div>
              <div><span className="text-slate-500 font-semibold">Correlation:</span> Above 0.7 = concentrated risk. Diversify across uncorrelated sectors.</div>
              <div><span className="text-slate-500 font-semibold">Risk of Ruin:</span> Probability of a 30% drawdown given current win rate and R:R. Below 5% = safe.</div>
            </div>

            </>)}
          </div>
        )}

        {/* ── Pro Tab (Backtester + Portfolio Optimizer) ── */}
        {activeTab === 'pro' && (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">🏆 Pro Analytics</h2>

            {/* Backtest Section */}
            <div className="bg-slate-800/40 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Historical Backtest</div>
                <button disabled={scanning || Object.keys(candleCache).length === 0}
                  onClick={() => {
                    const allTrades: import('@/lib/backtestEngine').BacktestTrade[] = [];
                    for (const [sym, candles] of Object.entries(candleCache)) {
                      const trades = runBacktest(candles, sym, 200, 10, accountSize);
                      allTrades.push(...trades);
                    }
                    setBacktestResult(aggregateBacktest(allTrades, niftyCandles ?? undefined, accountSize));
                  }}
                  className="h-6 px-3 bg-amber-900/40 hover:bg-amber-900/60 border border-amber-600 rounded text-[11px] font-semibold text-amber-300 disabled:opacity-40 transition-colors">
                  {backtestResult ? 'Re-run Backtest' : 'Run Backtest'}</button>
              </div>
              {!backtestResult ? (
                <div className="text-xs text-slate-600 py-4 text-center">Run a scan first, then click "Run Backtest" to test the screening engine on historical data</div>
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
                        <span className={`${s.rewardRisk >= 0.9 ? 'text-emerald-400' : 'text-yellow-300'}`}>R:R {s.rewardRisk.toFixed(1)}</span>
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
                              const text = `${nar.headline}\n\n${nar.setup}\n\n${nar.entry}\n${nar.caution !== 'No specific risk flags identified.' ? '\n⚠ ' + nar.caution : ''}\n\n${nar.verdict}\n\n— Dr KKR Quant Terminal Pro v8.2`;
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
                        <button onClick={() => { if (confirm('Remove ALL tracked trades?')) { setTrackedTrades([]); try { localStorage.removeItem('qtp_tracked_trades'); } catch {} } }}
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
                            <th className="px-2 py-1 text-right font-medium">P&L%</th>
                            <th className="px-2 py-1 text-right font-medium">P&L R</th>
                            <th className="px-2 py-1 text-right font-medium">MFE%</th>
                            <th className="px-2 py-1 text-right font-medium">MFE-R</th>
                            <th className="px-2 py-1 text-right font-medium">MAE%</th>
                            <th className="px-2 py-1 text-right font-medium">MAE-R</th>
                            <th className="px-2 py-1 text-right font-medium">Days</th>
                            <th className="px-2 py-1 text-center font-medium">Expiry</th>
                            <th className="px-2 py-1 text-center font-medium">Outcome</th>
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
                              const daysLeft = 10 - (t.daysHeld ?? 0);

                              const statusCfg: Record<string, { label: string; color: string }> = {
                                open: { label: 'OPEN', color: 'bg-blue-900/40 text-blue-300' },
                                hit_t1: { label: '✓ T1', color: 'bg-emerald-900/40 text-emerald-300' },
                                hit_t2: { label: '✓ T2', color: 'bg-emerald-900/40 text-emerald-200' },
                                hit_t3: { label: '✓ T3', color: 'bg-yellow-900/40 text-yellow-300' },
                                stopped: { label: '✗ SL', color: 'bg-red-900/40 text-red-300' },
                                expired: { label: '⏳ EXP', color: 'bg-amber-900/40 text-amber-300' },
                                manual_close: { label: '◉ MAN', color: 'bg-slate-700/40 text-slate-300' },
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
                                  <td className={`px-2 py-1.5 text-right font-mono font-semibold ${curPnl > 0 ? 'text-emerald-400' : curPnl < 0 ? 'text-red-400' : 'text-slate-500'}`}>{curPrice > 0 ? `${curPnl >= 0 ? '+' : ''}${curPnl.toFixed(2)}%` : '—'}</td>
                                  <td className={`px-2 py-1.5 text-right font-mono ${curR > 0 ? 'text-emerald-300' : curR < 0 ? 'text-red-300' : 'text-slate-500'}`}>{curPrice > 0 ? `${curR >= 0 ? '+' : ''}${curR.toFixed(2)}R` : '—'}</td>
                                  <td className={`px-2 py-1.5 text-right font-mono ${mfePct > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>{mfePct > 0 ? `+${mfePct.toFixed(2)}%` : '—'}</td>
                                  <td className={`px-2 py-1.5 text-right font-mono ${mfeR > 0 ? 'text-emerald-300' : 'text-slate-600'}`}>{mfeR > 0 ? `+${mfeR.toFixed(2)}R` : '—'}</td>
                                  <td className={`px-2 py-1.5 text-right font-mono ${maePct < 0 ? 'text-red-400' : 'text-slate-600'}`}>{maePct < 0 ? `${maePct.toFixed(2)}%` : '—'}</td>
                                  <td className={`px-2 py-1.5 text-right font-mono ${maeR < 0 ? 'text-red-300' : 'text-slate-600'}`}>{maeR < 0 ? `${maeR.toFixed(2)}R` : '—'}</td>
                                  <td className={`px-2 py-1.5 text-right ${t.status === 'open' && (t.daysHeld ?? 0) >= 8 ? 'text-amber-400' : 'text-slate-500'}`}>{t.daysHeld ?? '—'}{t.status === 'open' && (t.daysHeld ?? 0) >= 8 ? ` ⏳${daysLeft}d` : ''}</td>
                                  {/* #3/#7: Days to expiry countdown */}
                                  <td className="px-2 py-1.5 text-center">{t.status === 'open' ? (() => {
                                    const dl = 10 - (t.daysHeld ?? 0);
                                    const pct = Math.max(0, Math.min(100, ((t.daysHeld ?? 0) / 10) * 100));
                                    return <div className="flex items-center gap-1" title={`Day ${t.daysHeld ?? 0} of 10 — expires in ${dl} days`}>
                                      <div className="w-10 h-1.5 bg-slate-700 rounded-full overflow-hidden"><div className={`h-full rounded-full ${pct >= 80 ? 'bg-red-500' : pct >= 50 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{width:`${pct}%`}} /></div>
                                      <span className={`text-[9px] font-mono ${dl <= 2 ? 'text-red-400' : dl <= 5 ? 'text-amber-400' : 'text-slate-500'}`}>{dl}d</span>
                                    </div>;
                                  })() : <span className="text-slate-700">—</span>}</td>
                                  {/* #2: Outcome with tooltip */}
                                  <td className="px-2 py-1.5 text-center"><span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sc.color}`}
                                    title={t.status === 'hit_t1' ? 'T1 hit: 50% booked, SL moved to breakeven' : t.status === 'hit_t2' ? 'T2 hit: 50% at T1 + 30% at T2, SL at T1' : t.status === 'hit_t3' ? 'T3 hit: 50% at T1 + 30% at T2 + 20% at T3 — fully closed' : t.status === 'stopped' ? 'Stop loss triggered — full loss' : t.status === 'expired' ? 'Expired after 10 days — closed at market' : 'Trade is open — monitoring'}>{sc.label}</span></td>
                                  {/* #6: Exit model */}
                                  <td className="px-2 py-1.5 text-[9px] text-slate-500">{t.status === 'hit_t1' ? '50% T1 + 50% BE' : t.status === 'hit_t2' ? '50% T1 + 30% T2 + 20% BE' : t.status === 'hit_t3' ? '50% T1 + 30% T2 + 20% T3' : t.status === 'stopped' ? '100% SL' : t.status === 'open' ? '—' : 'Market'}</td>
                                  <td className="px-2 py-1.5 text-slate-600 truncate max-w-[80px]">{t.sector || '—'}</td>
                                  <td className="px-2 py-1.5 text-right text-slate-400">{t.conviction ?? '—'}</td>
                                  <td className="px-2 py-1.5 text-slate-600">{t.closedDate ?? '—'}</td>
                                  <td className="px-1 py-1.5 text-center">
                                    <button onClick={() => removeTrade(t.symbol)} className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-300 transition-all" title="Remove trade">✕</button>
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
                  {/* SECTION 5: ENGINE REFERENCE                */}
                  {/* ═══════════════════════════════════════════ */}
                  <div className="bg-slate-800/20 rounded-lg px-3 py-2 text-[10px] text-slate-600 grid grid-cols-2 gap-x-4 gap-y-0.5 border border-slate-700/30">
                    <div><b className="text-slate-500">Engine:</b> Level 3 bar-by-bar sequential (stop checked before target)</div>
                    <div><b className="text-slate-500">Auto-Runs:</b> After every scan on all open tracked trades</div>
                    <div><b className="text-slate-500">MFE:</b> Highest R-multiple above entry — profit left on the table</div>
                    <div><b className="text-slate-500">MAE:</b> Deepest R-multiple below entry — how close to stop</div>
                    <div><b className="text-slate-500">Expiry:</b> 10 trading days without target or stop → auto-expired</div>
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

            {/* Top signals */}
            {(() => {
              const topSignals = filteredResults
                .filter(r => ['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage) && r.priceEngine.tradeValid)
                .sort((a, b) => computeConviction(b) - computeConviction(a))
                .slice(0, 5);

              if (topSignals.length === 0 && results.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-600">
                    <div className="text-5xl mb-4">⚡</div>
                    <div className="text-lg font-medium mb-1">Focus Mode</div>
                    <div className="text-sm">Run a scan to see your top signals here</div>
                  </div>
                );
              }

              if (topSignals.length === 0) {
                return (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-600">
                    <div className="text-4xl mb-3">✓</div>
                    <div className="text-sm">No actionable BUY signals in this scan</div>
                    <div className="text-xs text-slate-700 mt-1">This is normal — patience is an edge</div>
                  </div>
                );
              }

              const regimeMult = marketRegime?.sizingMultiplier ?? 1;

              return (
                <div className="space-y-3">
                  <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                    Today's Top {topSignals.length} Signal{topSignals.length > 1 ? 's' : ''}
                  </div>
                  {topSignals.map((r, idx) => {
                    const conv = computeConviction(r);
                    const risk = r.priceEngine.riskPerShare;
                    const qty = risk > 0 ? Math.floor((accountSize * regimeMult * 0.01) / risk) : 0;
                    const capital = qty * r.priceEngine.plannedEntry;
                    const maxRisk = qty * risk;
                    const isTracked = trackedTrades.some(t => t.symbol === r.symbol);
                    const sector = getSectorTag(r.symbol);

                    return (
                      <div key={r.symbol} className="bg-slate-800/40 rounded-lg overflow-hidden border border-slate-700/50">
                        {/* Header */}
                        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/30">
                          <span className="text-lg font-bold text-slate-100 font-mono">{idx + 1}.</span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-100 text-base">{r.symbol}</span>
                              {sector && <span className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">{sector}</span>}
                              <span className={`text-xs font-semibold ${STAGE_CONFIG[r.stage].color}`}>{STAGE_CONFIG[r.stage].label}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                              <span>CMP ₹{r.lastClose.toFixed(2)}</span>
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
                            <div className={`font-mono font-bold ${r.priceEngine.rewardRisk >= 1.2 ? 'text-green-300' : r.priceEngine.rewardRisk >= 0.9 ? 'text-emerald-400' : r.priceEngine.rewardRisk >= 0.5 ? 'text-yellow-300' : 'text-slate-400'}`}>{r.priceEngine.rewardRisk.toFixed(2)}</div>
                            <div className={`text-[10px] ${r.priceEngine.rewardRisk >= 1.2 ? 'text-green-400' : r.priceEngine.rewardRisk >= 0.9 ? 'text-emerald-300' : r.priceEngine.rewardRisk >= 0.7 ? 'text-yellow-200' : 'text-slate-500'}`}>{r.priceEngine.rewardRisk >= 1.2 ? 'Elite' : r.priceEngine.rewardRisk >= 0.9 ? 'Very Good' : r.priceEngine.rewardRisk >= 0.7 ? 'Good' : r.priceEngine.rewardRisk >= 0.5 ? 'Acceptable' : 'Weak'}</div>
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
                            <button onClick={() => removeTrade(r.symbol)}
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
            const badges = [ze === 'HIGH_CONVICTION' ? '💎Zone' : '', ae.explosion ? '💥ATR' : '', vb === 'HIGH_CONVICTION' ? '🔥Vol' : '', onset === 'BEST' ? '★Onset' : ''].filter(Boolean).join(' ');
            return <div className="flex-shrink-0 bg-gradient-to-r from-emerald-900/20 to-slate-900/10 px-4 py-2 border-b border-emerald-800/20 flex items-center gap-3 text-[11px]">
              <span className="text-emerald-400 font-bold">{buys.length} BUY signal{buys.length > 1 ? 's' : ''}</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">Best: <span className="text-slate-200 font-semibold">{best.symbol.replace('.NS','').replace('.BO','')}</span></span>
              <span className="text-slate-400">Conv <span className="text-yellow-300 font-bold">{computeConviction(best)}</span></span>
              <span className="text-slate-400">R:R <span className={`font-bold ${best.priceEngine.rewardRisk >= 0.9 ? 'text-emerald-400' : 'text-yellow-300'}`}>{best.priceEngine.rewardRisk.toFixed(2)}</span></span>
              {badges && <span className="text-[10px] text-emerald-500">{badges}</span>}
              <span className="text-slate-600 ml-auto">{results.length} scanned</span>
            </div>;
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

          {results.length === 0 && !scanning && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-600 gap-3">
              <div className="text-5xl select-none">&#x1F4CA;</div>
              <div className="text-sm">Upload a CSV or paste symbols to scan</div>
              <div className="text-xs text-slate-700">
                Click{' '}
                <span className="text-indigo-500 cursor-pointer"
                  onClick={() => setResults(generateDemoData(paramSetKey))}>Demo Mode</span>
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
                              style={{ width: col.width, minWidth: col.width }}
                              className={[
                                'px-2 py-1.5 whitespace-nowrap',
                                col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                                col.cellClass ? col.cellClass(row) : 'text-slate-300',
                              ].join(' ')}>
                              {col.key === 'conviction' ? (() => {
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
                    { label: 'R:R', fn: (r: AnalysisResult) => r.priceEngine.rewardRisk.toFixed(2), color: (r: AnalysisResult) => r.priceEngine.rewardRisk >= 0.9 ? 'text-emerald-400' : r.priceEngine.rewardRisk >= 0.5 ? 'text-yellow-300' : 'text-slate-400' },
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

        {/* ── Detail panel (shared across tabs) ── */}
        {selectedResult && (activeTab === 'scanner' || activeTab === 'focus' || activeTab === 'validation') && (
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
                      BEST: { label: '★ Best Onset Candle', desc: 'Volume-thrust close-high — 81.82% backtest hit rate for >5% move' },
                      STRONG: { label: '★ Strong Onset', desc: 'Volume-thrust expansion — 52.30% Wilson lower bound' },
                      FULL_BODY: { label: '◆ Full Body Drive', desc: 'Near-marubozu bullish — visually strong but can be late' },
                      REJECTION: { label: '◇ Rejection Breakout', desc: 'Hammer-like lower-wick — useful, needs more confirmation' },
                      WEAK: { label: '○ Weak Onset', desc: 'Small body — avoid unless other signals are very strong' },
                    };
                    const cfg = labels[onset];
                    return (
                      <div className={`mt-1 px-2 py-1 rounded text-[10px] font-semibold ${onset === 'BEST' ? 'bg-[#39FF14]/15 text-[#39FF14] border border-[#39FF14]/30' : onset === 'STRONG' ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-700' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
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
                    const verdict = pe.rewardRisk >= 1.2 ? 'Elite' : pe.rewardRisk >= 0.9 ? 'Very Good' : pe.rewardRisk >= 0.7 ? 'Good' : 'Acceptable';
                    const text = `${sym} — ${stage} (Conv ${conv})\nEntry ₹${pe.plannedEntry.toFixed(2)} | SL ₹${pe.tacticalStop.toFixed(2)} | T1 ₹${pe.target5.toFixed(2)}\nR:R ${pe.rewardRisk.toFixed(2)} (${verdict}) | Risk ${pe.tacticalRiskPct.toFixed(1)}%\n— Dr KKR Quant Terminal Pro v8.2`;
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

              {/* v8.2 Momentum */}
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
        <span>{results.length} scanned{failedSymbols.length > 0 ? ` (${results.length} ok, ${failedSymbols.length} failed)` : ''}</span>
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
        <span className="ml-auto hidden sm:block">{scanAll ? '★ All 4 Sets' : PARAM_SETS[paramSetKey].name} · Dr KKR Quant Terminal Pro v8.2</span>
      </footer>
    </main>
  );
}

export default function HomePage() { return <ErrorBoundary><HomePageInner /></ErrorBoundary>; }
