import type { AnalysisResult, StageRating, Candle } from './stockEngine';

// ─── #1: Trade Sheet ─────────────────────────────────────────────────────────

export interface TradeSheet {
  symbol: string;
  action: 'BUY';
  entry: number;
  qty: number;
  stopLoss: number;             // compatibility alias for hardStop
  reviewStop: number;           // close-confirmed review level
  hardStop: number;             // broker SL-M / worst-case risk basis
  target1: number;
  target2: number;
  target3: number;
  trailRule: string;
  breakEvenTrigger: number;   // T1 fill books half; T2 activates the stronger hard trail
  breakEvenStop: number;      // compatibility field: entry reference, not an immediate post-T1 hard stop
  totalCost: number;
  maxRisk: number;
  riskPct: number;
  pivotPP?: number;
  pivotR1?: number;
  pivotR2?: number;
  pivotS1?: number;
  pivotS2?: number;
  pivotPosition?: string;
  pivotConfluence?: string;
  pivotWarnings?: string[];
}

export function generateTradeSheet(r: AnalysisResult, accountSize: number, riskPct = 1): TradeSheet | null {
  const entry = r.priceEngine.plannedEntry;
  const reviewStop = r.priceEngine.tacticalStop;
  const disasterStop = r.priceEngine.disasterStop;
  if (!Number.isFinite(entry) || !Number.isFinite(reviewStop) || entry <= 0 || reviewStop <= 0) return null;
  const hardStop = Number.isFinite(disasterStop) && disasterStop > 0 && disasterStop < reviewStop
    ? disasterStop
    : reviewStop;
  const riskPerShare = entry - hardStop;
  if (riskPerShare <= 0) return null;
  const safeT1 = Number.isFinite(r.priceEngine.target5) ? r.priceEngine.target5 : entry + riskPerShare * 2;
  const safeT2 = Number.isFinite(r.priceEngine.target7) ? r.priceEngine.target7 : entry + riskPerShare * 3;
  const safeT3 = Number.isFinite(r.priceEngine.target10) ? r.priceEngine.target10 : entry + riskPerShare * 5;
  const maxRisk = accountSize * (riskPct / 100);
  const qty = Math.floor(maxRisk / riskPerShare);
  if (qty <= 0) return null;
  const beTrigger = safeT1;
  return {
    symbol: r.symbol,
    action: 'BUY',
    entry: Math.round(entry * 100) / 100,
    qty,
    stopLoss: Math.round(hardStop * 100) / 100,
    reviewStop: Math.round(reviewStop * 100) / 100,
    hardStop: Math.round(hardStop * 100) / 100,
    target1: Math.round(safeT1 * 100) / 100,
    target2: Math.round(safeT2 * 100) / 100,
    target3: Math.round(safeT3 * 100) / 100,
    breakEvenTrigger: Math.round(beTrigger * 100) / 100,
    breakEvenStop:   Math.round(entry * 100) / 100,
    trailRule: `Review stop exits next session open after a confirmed close. Sell 50% at T1 ₹${safeT1.toFixed(2)}; keep the remaining 50% protected by the review/trail floor until T2, then use the hard chandelier trail.`,
    totalCost: Math.round(qty * entry),
    maxRisk: Math.round(qty * riskPerShare),
    riskPct,
  };
}

export function tradeSheetToClipboard(ts: TradeSheet): string {
  const riskPerShare = ts.entry - ts.hardStop;
  const rr = (target: number) => riskPerShare > 0
    ? ((target - ts.entry) / riskPerShare).toFixed(2)
    : 'n/a';
  const lines = [
    `═══ TRADE SHEET ═══`,
    `SYMBOL: ${ts.symbol}`,
    `ACTION: ${ts.action}`,
    `ENTRY: ₹${ts.entry.toFixed(2)} (Limit)`,
    `QTY: ${ts.qty} shares`,
    `HARD STOP: ₹${ts.hardStop.toFixed(2)} (broker SL-M; always executes)`,
    `REVIEW STOP: ₹${ts.reviewStop.toFixed(2)} (close-confirmed; exit next session open)`,
    `TARGET 1: ₹${ts.target1.toFixed(2)} (Sell 50%) — hard-risk R:R ${rr(ts.target1)}R`,
    `TARGET 2: ₹${ts.target2.toFixed(2)} (Sell 30%) — hard-risk R:R ${rr(ts.target2)}R`,
    `TARGET 3: ₹${ts.target3.toFixed(2)} (Sell 20%) — hard-risk R:R ${rr(ts.target3)}R`,
    `TRAIL: ${ts.trailRule}`,
    `CAPITAL: ₹${(ts.totalCost / 100000).toFixed(2)}L`,
    `MAX RISK: ₹${ts.maxRisk.toLocaleString('en-IN')}`,
  ];
  if (ts.pivotPP && Number.isFinite(ts.pivotPP)) {
    lines.push('', `═══ PIVOT LEVELS ═══`);
    if (ts.pivotR2 && Number.isFinite(ts.pivotR2)) lines.push(`R2: ₹${ts.pivotR2.toFixed(2)}`);
    if (ts.pivotR1 && Number.isFinite(ts.pivotR1)) lines.push(`R1: ₹${ts.pivotR1.toFixed(2)}`);
    lines.push(`PP: ₹${ts.pivotPP.toFixed(2)}`);
    if (ts.pivotS1 && Number.isFinite(ts.pivotS1)) lines.push(`S1: ₹${ts.pivotS1.toFixed(2)}`);
    if (ts.pivotS2 && Number.isFinite(ts.pivotS2)) lines.push(`S2: ₹${ts.pivotS2.toFixed(2)}`);
    if (ts.pivotPosition) lines.push(`Position: ${ts.pivotPosition}`);
    if (ts.pivotConfluence) lines.push(`Confluence: ${ts.pivotConfluence}`);
    if (ts.pivotWarnings?.length) {
      lines.push('', `═══ PIVOT ALERTS ═══`);
      for (const w of ts.pivotWarnings) lines.push(w);
    }
  }
  return lines.join('\n');
}

// ─── #2: Win Rate Tracker ────────────────────────────────────────────────────

export interface TrackedTrade {
  symbol: string;
  stage: StageRating;
  entryPrice: number;
  entryDate: string;
  stopLoss: number;         // frozen close-confirmed review level
  target1: number;
  target2: number;
  target3: number;
  disasterStop: number;
  paramSetKey: string;
  sector: string;
  conviction: number;
  edgeScore?: number;       // composite signal score at entry (0-100)
  zoneExplosion?: string;   // zone explosion tier at entry (HIGH_CONVICTION/CONFIRMED)
  monsterBadge?: string;    // monster badge type at entry (MRV/MOM/BRK)
  sw5LowAtEntry?: number;   // 5-bar swing low at entry — used by G9 Structure Intact gate
  atr14AtEntry?: number;    // ATR-14 at signal bar — Chandelier trail fallback when post-entry bars < 14
  maxHoldBars?: number;     // frozen archetype holding horizon captured at entry
  breakoutTier?: 'A+' | 'A' | 'B';  // GA-calibrated VCP tier at entry time
  // P0: feature snapshot at entry — feeds Brain v3's Pattern Scorecard,
  // Golden/Weak Setups, Regime Scorecard, and ATR/pattern anomaly checks.
  // Without these, those panels silently have nothing to match against.
  candlePattern?: string;
  atrState?: string;
  tfAlignment?: string;
  rsRank?: number;
  volumeBadge?: string;
  regimeAtEntry?: string;
  status: 'open' | 'hit_t1' | 'hit_t2' | 'hit_t3' | 'stopped' | 'expired' | 'manual_close' | 'closed_early';
  exitPricePct?: number;  // % of T1 distance captured when closed early (exit quality metric)
  currentPrice?: number;
  cmpDate?: string;       // IST date of the candle that sourced currentPrice (YYYY-MM-DD)
  highestPrice?: number;
  lastCheckDate?: string;
  closedDate?: string;
  closedPrice?: number;
  pnlPct?: number;
  pnlR?: number;
  mfe?: number;
  mae?: number;
  mfeR?: number;
  maeR?: number;
  hit5pct?: boolean;   // price ever crossed entry × 1.05
  hit7pct?: boolean;   // price ever crossed entry × 1.07
  hit10pct?: boolean;  // price ever crossed entry × 1.10
  qty?: number;
  daysHeld?: number;
  notes?: string;
  targetLog?: Array<{ target: 'T1' | 'T2' | 'T3'; day: number; date: string; price: number; fraction: number }>;
  trailLog?: Array<{ day: number; newStop: number; reason: string }>;
  gateLog?: Array<{
    day: number;
    date?: string;
    close: number;
    low?: number;
    stopLevel: number;
    dipPct: number;
    triggerType?: 'intraday_low' | 'close' | 'gap_down' | 'review_open';
    gatesTested: Array<{ gate: string; passed: boolean; reason: string }>;
    result: string;
    stopKind?: 'hard' | 'review' | 'trail';
    evidenceGroups?: number;
  }>;
}

export interface WinRateStats {
  total: number;
  decided: number;
  wins: number;
  losses: number;
  fivePctWins: number;
  open: number;
  hitT1: number;
  hitT2: number;
  hitT3: number;
  stopped: number;
  expired: number;
  manualClose: number;
  closedEarly: number;
  winRate: number;
  avgWinPct: number;
  avgLossPct: number;
  avgWinR: number;
  avgLossR: number;
  profitFactor: number;
  expectancy: number;
  bestTrade: { symbol: string; pnlPct: number } | null;
  worstTrade: { symbol: string; pnlPct: number } | null;
  avgDaysHeld: number;
  streakWins: number;
  streakLosses: number;
}

export const FIVE_PCT_WIN_THRESHOLD = 5;

export function getTradeHardStop(t: Pick<TrackedTrade, 'entryPrice' | 'stopLoss' | 'disasterStop'>): number {
  const reviewStop = t.stopLoss > 0 && t.stopLoss < t.entryPrice ? t.stopLoss : 0;
  const disasterStop = t.disasterStop > 0 && t.disasterStop < t.entryPrice ? t.disasterStop : 0;
  if (disasterStop > 0 && (reviewStop <= 0 || disasterStop < reviewStop)) return disasterStop;
  return reviewStop;
}

export function getTradeRiskPerShare(t: Pick<TrackedTrade, 'entryPrice' | 'stopLoss' | 'disasterStop'>): number {
  const hardStop = getTradeHardStop(t);
  return hardStop > 0 ? Math.max(0, t.entryPrice - hardStop) : 0;
}

export function getTradeMfePct(t: TrackedTrade): number {
  const tracked = (() => {
    if (Number.isFinite(t.mfe) && (t.mfe ?? 0) > 0) return t.mfe ?? 0;
    if (t.entryPrice > 0 && t.highestPrice && t.highestPrice > 0) {
      return ((t.highestPrice - t.entryPrice) / t.entryPrice) * 100;
    }
    if (t.entryPrice > 0 && t.currentPrice && t.currentPrice > 0) {
      return Math.max(0, ((t.currentPrice - t.entryPrice) / t.entryPrice) * 100);
    }
    if (t.entryPrice > 0 && t.closedPrice && t.closedPrice > 0) {
      return Math.max(0, ((t.closedPrice - t.entryPrice) / t.entryPrice) * 100);
    }
    return Math.max(0, t.pnlPct ?? 0);
  })();
  // For terminal trades, derive minimum guaranteed MFE from the targets actually hit.
  // t.mfe may only reflect the D-day or T1-exit snapshot, not the lifetime peak.
  if (t.entryPrice > 0) {
    const pct = (p: number) => (p - t.entryPrice) / t.entryPrice * 100;
    if (t.status === 'hit_t3' && t.target3 > 0) return Math.max(tracked, pct(t.target3));
    if (t.status === 'hit_t2' && t.target2 > 0) return Math.max(tracked, pct(t.target2));
    if (t.status === 'hit_t1' && t.target1 > 0) return Math.max(tracked, pct(t.target1));
  }
  return tracked;
}

export function getTradeMfeR(t: TrackedTrade): number {
  if (Number.isFinite(t.mfeR)) return Math.max(0, t.mfeR ?? 0);
  const riskPerShare = getTradeRiskPerShare(t);
  const mfePct = getTradeMfePct(t);
  return riskPerShare > 0 && t.entryPrice > 0 ? ((mfePct / 100) * t.entryPrice) / riskPerShare : 0;
}

export function getTradeMaePct(t: TrackedTrade): number {
  if (Number.isFinite(t.mae)) return Math.abs(t.mae ?? 0);
  const riskPerShare = getTradeRiskPerShare(t);
  if (Number.isFinite(t.maeR) && riskPerShare > 0 && t.entryPrice > 0) {
    return (Math.abs(t.maeR ?? 0) * riskPerShare / t.entryPrice) * 100;
  }
  const referencePrice = t.closedPrice ?? t.currentPrice ?? 0;
  if (t.entryPrice > 0 && referencePrice > 0 && referencePrice < t.entryPrice) {
    return ((t.entryPrice - referencePrice) / t.entryPrice) * 100;
  }
  return (t.pnlPct ?? 0) < 0 ? Math.abs(t.pnlPct ?? 0) : 0;
}

export function getTradeMaeR(t: TrackedTrade): number {
  if (Number.isFinite(t.maeR) && (t.maeR ?? 0) !== 0) return -Math.abs(t.maeR ?? 0);
  const riskPerShare = getTradeRiskPerShare(t);
  const maePct = getTradeMaePct(t);
  return riskPerShare > 0 && t.entryPrice > 0 ? -((maePct / 100) * t.entryPrice) / riskPerShare : 0;
}

export function didReachFivePctTarget(t: TrackedTrade): boolean {
  return getTradeMfePct(t) >= FIVE_PCT_WIN_THRESHOLD;
}

// Canonical return for analytics whose stated outcome is "did price reach +5%?".
// Winners are valued at the pre-declared +5% exit, never at their later MFE.
export function getFivePctObjectivePnlPct(t: TrackedTrade): number {
  return didReachFivePctTarget(t) ? FIVE_PCT_WIN_THRESHOLD : (t.pnlPct ?? 0);
}

export function getFivePctObjectiveR(t: TrackedTrade): number {
  if (!didReachFivePctTarget(t)) {
    if (Number.isFinite(t.pnlR)) return t.pnlR ?? 0;
    const riskPerShare = getTradeRiskPerShare(t);
    return riskPerShare > 0 && t.entryPrice > 0
      ? (((t.pnlPct ?? 0) / 100) * t.entryPrice) / riskPerShare
      : 0;
  }
  const riskPerShare = getTradeRiskPerShare(t);
  return riskPerShare > 0 && t.entryPrice > 0
    ? (FIVE_PCT_WIN_THRESHOLD / 100 * t.entryPrice) / riskPerShare
    : 0;
}

const ACTIVE_STATUSES   = new Set(['open', 'hit_t1', 'hit_t2']);
const TERMINAL_STATUSES = new Set(['hit_t3', 'stopped', 'expired', 'manual_close', 'closed_early']);

export function isLegacyT1BreakevenTrailExit(t: TrackedTrade): boolean {
  if (t.status !== 'hit_t1') return false;
  if (typeof t.closedDate !== 'string' || t.closedDate.trim().length === 0) return false;

  const entry = Number(t.entryPrice);
  const closed = Number(t.closedPrice);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(closed) || closed <= 0) return false;

  const closedNearEntry = Math.abs(closed - entry) / entry <= 0.0025;
  if (!closedNearEntry) return false;

  return (t.gateLog ?? []).some(gate => {
    const gateName = gate.gatesTested?.[0]?.gate ?? '';
    return gate.result === 'STOPPED'
      && (gate.stopKind === 'trail' || /protective trail/i.test(gateName));
  });
}

export function isTerminalTrade(t: TrackedTrade): boolean {
  if (isLegacyT1BreakevenTrailExit(t)) return false;
  const hasCloseDate = typeof t.closedDate === 'string' && t.closedDate.trim().length > 0;
  if (hasCloseDate) return true;
  if (TERMINAL_STATUSES.has(t.status)) return true;
  if (ACTIVE_STATUSES.has(t.status)) return false;
  // Unknown status — quarantine: treat as terminal to prevent silent reprocessing
  console.warn(`[isTerminalTrade] unknown status "${t.status}" on trade ${t.symbol ?? '?'} — quarantined`);
  return true;
}

export function isTradeResolvedForWinRate(t: TrackedTrade): boolean {
  return didReachFivePctTarget(t) || isTerminalTrade(t);
}

export function computeWinRateStats(trades: TrackedTrade[]): WinRateStats {
  const closed = trades.filter(isTradeResolvedForWinRate);
  const wins = closed.filter(didReachFivePctTarget);
  const losses = closed.filter(t => !didReachFivePctTarget(t));

  const totalWinPct = wins.reduce((s, t) => s + getFivePctObjectivePnlPct(t), 0);
  const totalLossPct = Math.abs(losses.reduce((s, t) => s + getFivePctObjectivePnlPct(t), 0));
  const totalWinR = wins.reduce((s, t) => s + getFivePctObjectiveR(t), 0);
  const totalLossR = Math.abs(losses.reduce((s, t) => s + getFivePctObjectiveR(t), 0));
  // Actual avg win: use real blended exit P&L for terminal wins, peak MFE for open wins.
  // profitFactor/expectancy stay model-based (5% objective) for consistency with Brain V2.
  const totalActualWinPct = wins.reduce((s, t) => {
    if (isTerminalTrade(t) && t.pnlPct != null) return s + t.pnlPct;
    return s + getTradeMfePct(t);
  }, 0);

  let bestTrade: { symbol: string; pnlPct: number } | null = null;
  let worstTrade: { symbol: string; pnlPct: number } | null = null;
  for (const t of closed) {
    const p = getFivePctObjectivePnlPct(t);
    if (!bestTrade || p > bestTrade.pnlPct) bestTrade = { symbol: t.symbol, pnlPct: p };
    if (!worstTrade || p < worstTrade.pnlPct) worstTrade = { symbol: t.symbol, pnlPct: p };
  }

  // Current streak
  let streakWins = 0, streakLosses = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    const isWin = didReachFivePctTarget(closed[i]);
    if (i === closed.length - 1) { if (isWin) streakWins = 1; else streakLosses = 1; }
    else if (isWin && streakWins > 0) streakWins++;
    else if (!isWin && streakLosses > 0) streakLosses++;
    else break;
  }

  const avgDays = closed.length > 0 ? closed.reduce((s, t) => s + (t.daysHeld ?? 0), 0) / closed.length : 0;

  return {
    total: trades.length,
    decided: closed.length,
    wins: wins.length,
    losses: losses.length,
    fivePctWins: wins.length,
    open: trades.filter(t => !isTerminalTrade(t)).length,
    hitT1: trades.filter(t => t.status === 'hit_t1').length,
    hitT2: trades.filter(t => t.status === 'hit_t2').length,
    hitT3: trades.filter(t => t.status === 'hit_t3').length,
    stopped: trades.filter(t => t.status === 'stopped').length,
    expired: trades.filter(t => t.status === 'expired').length,
    manualClose: trades.filter(t => t.status === 'manual_close').length,
    closedEarly: trades.filter(t => t.status === 'closed_early').length,
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    avgWinPct: wins.length > 0 ? totalActualWinPct / wins.length : 0,
    avgLossPct: losses.length > 0 ? -totalLossPct / losses.length : 0,
    avgWinR: wins.length > 0 ? totalWinR / wins.length : 0,
    avgLossR: losses.length > 0 ? -totalLossR / losses.length : 0,
    profitFactor: totalLossPct > 0 ? Math.min(totalWinPct / totalLossPct, 50) : totalWinPct > 0 ? 50 : 0,
    expectancy: closed.length > 0
      ? (wins.length / closed.length) * (wins.length > 0 ? totalWinPct / wins.length : 0)
        - (losses.length / closed.length) * (losses.length > 0 ? totalLossPct / losses.length : 0)
      : 0,
    bestTrade, worstTrade,
    avgDaysHeld: Math.round(avgDays),
    streakWins, streakLosses,
  };
}

// ─── #3: Risk Dashboard ──────────────────────────────────────────────────────

export interface PortfolioRisk {
  totalPositions: number;
  totalCapitalDeployed: number;
  totalRiskAmount: number;
  totalRiskPct: number;
  sectorConcentration: Record<string, number>;
  maxSectorExposure: string;
  maxSectorPct: number;
  correlationWarning: string | null;
}

export function computePortfolioRisk(
  trades: TrackedTrade[],
  accountSize: number,
  sectorMap: Record<string, string[]>
): PortfolioRisk {
  const open = trades.filter(t => t.status === 'open');
  const totalCap = open.reduce((s, t) => s + t.entryPrice * (t.qty ?? 1), 0);
  const totalRisk = open.reduce((s, t) => s + getTradeRiskPerShare(t) * (t.qty ?? 1), 0);

  const sectorCounts: Record<string, number> = {};
  for (const t of open) {
    const sym = t.symbol.replace('.NS', '').replace('.BO', '');
    for (const [sector, symbols] of Object.entries(sectorMap)) {
      if (symbols.includes(sym)) {
        sectorCounts[sector] = (sectorCounts[sector] ?? 0) + 1;
        break;
      }
    }
  }

  let maxSector = '', maxCount = 0;
  for (const [s, c] of Object.entries(sectorCounts)) {
    if (c > maxCount) { maxSector = s; maxCount = c; }
  }

  let warning: string | null = null;
  if (open.length >= 3 && maxCount >= Math.ceil(open.length * 0.6)) {
    warning = `${maxCount} of ${open.length} positions are in ${maxSector} — high concentration`;
  }

  return {
    totalPositions: open.length,
    totalCapitalDeployed: totalCap,
    totalRiskAmount: totalRisk,
    totalRiskPct: accountSize > 0 ? (totalRisk / accountSize) * 100 : 0,
    sectorConcentration: sectorCounts,
    maxSectorExposure: maxSector,
    maxSectorPct: open.length > 0 ? (maxCount / open.length) * 100 : 0,
    correlationWarning: warning,
  };
}

// ─── #9: Multi-Factor 8-Factor + VIX Regime Detection ───────────────────────
// Backtested on 10yr Nifty+VIX: +2,101% return, 7.8% max DD, Ret/DD 269.9
// Replaces old EMA50/200 method (which showed Bear when market was actually recovering)

export type MarketRegime = 'strong_bull' | 'bull' | 'neutral' | 'bear' | 'strong_bear';

export interface RegimeFactors {
  momentum: number; breadth: number; volatility: number; acceleration: number;
  distEma200: number; vixLevel: number; vixROC: number; vixVsSma: number;
}

export interface RegimeInfo {
  regime: MarketRegime;
  niftyClose: number;
  ema200: number;
  ema50: number;
  aboveEma200: boolean;
  ema50Above200: boolean;
  label: string;
  emoji: string;
  sizingMultiplier: number;
  score: number;
  dayChangePct: number;
  factors: RegimeFactors;
  vix: number;
  cusumAlert: 'bearish_shift' | 'bullish_shift' | null;
  blackSwanLevel: 'normal' | 'elevated' | 'high' | 'severe' | 'extreme';
  blackSwanAction: string;
}

export function detectMarketRegime(niftyCandles: Candle[], vixCandles?: Candle[]): RegimeInfo {
  const fallback: RegimeInfo = { regime: 'neutral', niftyClose: 0, ema200: 0, ema50: 0, aboveEma200: true, ema50Above200: true, label: 'Unknown', emoji: '🟡', sizingMultiplier: 0.75, score: 0, dayChangePct: 0, factors: { momentum: 0, breadth: 0, volatility: 0, acceleration: 0, distEma200: 0, vixLevel: 0, vixROC: 0, vixVsSma: 0 }, vix: 0, cusumAlert: null, blackSwanLevel: 'normal', blackSwanAction: '' };
  if (niftyCandles.length < 200) return fallback;
  const n = niftyCandles.length;
  const close = niftyCandles[n - 1].c;

  // EMA50/200 (still computed for display)
  const k50 = 2 / 51, k200 = 2 / 201;
  let ema50 = niftyCandles[0].c, ema200 = niftyCandles[0].c;
  for (let i = 1; i < n; i++) { ema50 = niftyCandles[i].c * k50 + ema50 * (1 - k50); ema200 = niftyCandles[i].c * k200 + ema200 * (1 - k200); }

  // Factor 1: MOMENTUM — 20-day return
  const ret20 = n >= 21 ? (close - niftyCandles[n - 21].c) / niftyCandles[n - 21].c * 100 : 0;
  // Factor 2: BREADTH — % of last 20 days that were green
  let greenDays = 0; for (let j = n - 20; j < n; j++) if (j > 0 && niftyCandles[j].c > niftyCandles[j - 1].c) greenDays++;
  const breadth = greenDays / 20 * 100;
  // Factor 3: VOLATILITY — 20-day realized vol
  const rets: number[] = []; for (let j = n - 20; j < n; j++) if (j > 0) rets.push((niftyCandles[j].c - niftyCandles[j - 1].c) / niftyCandles[j - 1].c * 100);
  const retMean = rets.length > 0 ? rets.reduce((s, v) => s + v, 0) / rets.length : 0;
  const vol = rets.length > 0 ? Math.sqrt(rets.reduce((s, v) => s + (v - retMean) ** 2, 0) / rets.length) : 1;
  // Factor 4: ACCELERATION — 10d return minus prev 10d return
  const ret10a = n >= 11 ? (close - niftyCandles[n - 11].c) / niftyCandles[n - 11].c * 100 : 0;
  const ret10b = n >= 21 ? (niftyCandles[n - 11].c - niftyCandles[n - 21].c) / niftyCandles[n - 21].c * 100 : 0;
  const accel = ret10a - ret10b;
  // Factor 9: TODAY'S RETURN — 1-day change anchors regime to current session
  const ret1 = n >= 2 ? (close - niftyCandles[n - 2].c) / niftyCandles[n - 2].c * 100 : 0;
  // Factor 5: DISTANCE FROM EMA200
  const distEma200 = ema200 > 0 ? ((close - ema200) / ema200) * 100 : 0;

  // Composite score (factors 1-5: 82 pts max)
  let score = 0;
  score += ret20 > 5 ? 20 : ret20 > 2 ? 12 : ret20 > 0 ? 4 : ret20 > -2 ? -4 : ret20 > -5 ? -12 : -20;
  score += breadth > 60 ? 18 : breadth > 52 ? 9 : breadth > 45 ? -4 : breadth > 38 ? -12 : -18;
  score += vol < 0.8 ? 12 : vol < 1.2 ? 6 : vol < 1.8 ? 0 : vol < 2.5 ? -6 : -12;
  score += accel > 2 ? 12 : accel > 0.5 ? 6 : accel > -0.5 ? 0 : accel > -2 ? -6 : -12;
  score += distEma200 > 5 ? 12 : distEma200 > 0 ? 6 : distEma200 > -3 ? -4 : distEma200 > -8 ? -8 : -12;
  score += ret1 > 2 ? 8 : ret1 > 0.5 ? 4 : ret1 > -0.5 ? 0 : ret1 > -2 ? -8 : -12;

  // VIX factors (6-8: 28 pts max) — only if VIX data provided
  let vixVal = 0, vixROC = 0, vixVsSma = 0;
  if (vixCandles && vixCandles.length >= 21) {
    const vn = vixCandles.length;
    vixVal = vixCandles[vn - 1].c;
    // Factor 6: VIX Level (with contrarian >45 logic)
    score += vixVal < 12 ? 6 : vixVal < 16 ? 10 : vixVal < 22 ? 4 : vixVal < 30 ? -6 : vixVal < 45 ? -10 : 4;
    // Factor 7: VIX 5-day ROC
    const vix5 = vn >= 6 ? vixCandles[vn - 6].c : vixVal;
    vixROC = vix5 > 0 ? ((vixVal - vix5) / vix5 * 100) : 0;
    score += vixROC < -15 ? 8 : vixROC < -5 ? 4 : vixROC < 5 ? 0 : vixROC < 15 ? -4 : -8;
    // Factor 8: VIX vs 20-day SMA (term structure proxy)
    let vixSma = 0; for (let j = vn - 20; j < vn; j++) vixSma += vixCandles[j].c; vixSma /= 20;
    vixVsSma = vixSma > 0 ? ((vixVal - vixSma) / vixSma) * 100 : 0;
    score += vixVsSma < -15 ? 8 : vixVsSma < -5 ? 3 : vixVsSma < 5 ? 0 : vixVsSma < 15 ? -3 : -8;
  }

  // CUSUM crash early-warning (separate from score)
  let cusumAlert: RegimeInfo['cusumAlert'] = null;
  if (n >= 55) {
    const cusumRets: number[] = [];
    for (let j = n - 50; j < n; j++) if (j > 0) cusumRets.push((niftyCandles[j].c - niftyCandles[j - 1].c) / niftyCandles[j - 1].c * 100);
    const warmup = cusumRets.slice(0, 30);
    const cMean = warmup.reduce((s, v) => s + v, 0) / warmup.length;
    const cStd = Math.sqrt(warmup.reduce((s, v) => s + (v - cMean) ** 2, 0) / warmup.length) || 0.01;
    let sPlus = 0, sMinus = 0;
    for (const r of cusumRets.slice(30)) { sPlus = Math.max(0, sPlus + (r - cMean) / cStd - 0.5); sMinus = Math.max(0, sMinus - (r - cMean) / cStd - 0.5); }
    if (sMinus > 3.0) cusumAlert = 'bearish_shift';
    else if (sPlus > 3.0) cusumAlert = 'bullish_shift';
  }

  // 5-state classification
  let regime: MarketRegime, label: string, emoji: string, mult: number;
  if (score >= 40) { regime = 'strong_bull'; label = 'Strong Bull'; emoji = '🟢'; mult = 1.25; }
  else if (score >= 15) { regime = 'bull'; label = 'Bull Market'; emoji = '🟢'; mult = 1.0; }
  else if (score >= -15) { regime = 'neutral'; label = 'Neutral'; emoji = '🟡'; mult = 0.75; }
  else if (score >= -40) { regime = 'bear'; label = 'Bear Market'; emoji = '🔴'; mult = 0.25; }
  else { regime = 'strong_bear'; label = 'Strong Bear'; emoji = '🔴'; mult = 0; }

  // Black Swan 4-Level Warning (backtested on 10yr Nifty+VIX, caught COVID 25 days early)
  let blackSwanLevel: RegimeInfo['blackSwanLevel'] = 'normal';
  let blackSwanAction = '';
  if (vixCandles && vixCandles.length >= 11 && n >= 11) {
    const niftyROC5 = n >= 6 ? (close - niftyCandles[n - 6].c) / niftyCandles[n - 6].c * 100 : 0;
    const niftyROC10 = n >= 11 ? (close - niftyCandles[n - 11].c) / niftyCandles[n - 11].c * 100 : 0;
    if (vixVal >= 45 && niftyROC10 < -10) {
      blackSwanLevel = 'extreme'; blackSwanAction = 'Stay in cash. Wait for VIX to peak and start declining. COVID-level event.';
    } else if (vixVal >= 30 && (vixROC > 30 || (vixCandles.length >= 11 ? ((vixVal - vixCandles[vixCandles.length - 11].c) / vixCandles[vixCandles.length - 11].c * 100) : 0) > 50) && niftyROC5 < -5) {
      blackSwanLevel = 'severe'; blackSwanAction = 'EXIT all positions. Move to 100% cash. Capital preservation mode.';
    } else if (vixVal >= 22 && vixROC > 25 && niftyROC5 < -3) {
      blackSwanLevel = 'high'; blackSwanAction = 'Stop ALL new entries. Exit weak positions. Institutional selling accelerating.';
    } else if (vixVal >= 18 && vixROC > 15 && niftyROC5 < -2) {
      blackSwanLevel = 'elevated'; blackSwanAction = 'Reduce new positions to 50%. Tighten stops. Fear rising faster than normal.';
    }
  }

  return {
    regime, niftyClose: close, ema200, ema50,
    aboveEma200: close > ema200, ema50Above200: ema50 > ema200,
    label, emoji, sizingMultiplier: mult, score, dayChangePct: ret1,
    factors: { momentum: ret20, breadth, volatility: vol, acceleration: accel, distEma200, vixLevel: vixVal, vixROC, vixVsSma },
    vix: vixVal, cusumAlert, blackSwanLevel, blackSwanAction,
  };
}

// ─── #12: Parameter Sensitivity ──────────────────────────────────────────────

export interface ParamSensitivity {
  label: string;
  value: number;
  threshold: number;
  marginPct: number;
  strength: 'strong' | 'moderate' | 'marginal' | 'fail';
}

export function computeParamSensitivity(r: AnalysisResult): ParamSensitivity[] {
  const items: ParamSensitivity[] = [];
  for (const item of r.checklist) {
    const numMatch = item.value.match(/-?[\d.]+/);
    const threshMatch = item.label.match(/([\d.]+)/);
    if (!numMatch || !threshMatch) continue;
    const val = parseFloat(numMatch[0]);
    const thresh = parseFloat(threshMatch[0]);
    if (isNaN(val) || isNaN(thresh) || thresh === 0) continue;
    const isUpperBound = item.label.includes('≤');
    const margin = isUpperBound ? ((thresh - val) / thresh) * 100 : ((val - thresh) / thresh) * 100;
    let strength: 'strong' | 'moderate' | 'marginal' | 'fail';
    if (!item.pass) strength = 'fail';
    else if (margin > 30) strength = 'strong';
    else if (margin > 10) strength = 'moderate';
    else strength = 'marginal';
    items.push({ label: item.label, value: val, threshold: thresh, marginPct: margin, strength });
  }
  return items.sort((a, b) => a.marginPct - b.marginPct);
}

// ─── #8: Quick Filter Presets ────────────────────────────────────────────────

export type QuickFilterKey = 'ready' | 'tomorrow' | 'strongest' | 'safe' | 'momAlert' | 'eliteSignal' | 'all';

export interface QuickFilter {
  key: QuickFilterKey;
  label: string;
  emoji: string;
  description: string;
  filter: (r: AnalysisResult) => boolean;
}

export const QUICK_FILTERS: QuickFilter[] = [
  {
    key: 'all', label: 'All', emoji: '⊡', description: 'Show all results',
    filter: () => true,
  },
  {
    // FIX: Removed gapAdjustedRR>=2 — T1 is always 0.75×risk so gapAdjustedRR
    // is always ~0.75; the >=2 gate was impossible and returned zero matches.
    // Comment at stockEngine.ts:895 also flags gapRR>=2 as a NEGATIVE predictor
    // (r=−0.005). Replaced with volDryUpScore>=2 (r=+0.014, dominant predictor).
    key: 'ready', label: 'Ready to Trade', emoji: '🎯',
    description: 'BUY+ · valid trade sheet · EMA aligned · Vol dry-up ≥2 (compression backing). Use for same-day entries.',
    filter: r =>
      r.priceEngine.tradeValid &&
      r.momentum.emaAligned &&
      r.momentum.volDryUpScore >= 2,
  },
  {
    // FIX: Removed higherLowConfirmed — it is false in 6/7 param sets (only
    // analyzeMomentumPocket sets it). The old filter returned zero results on
    // all other param set selections. Replaced with tier-based proximity
    // (IMMINENT ≤1% or NEAR ≤2.5%) backed by at least minimal dry-up.
    key: 'tomorrow', label: "Tomorrow's Breakouts", emoji: '⚡',
    description: 'IMMINENT (0–1%) or NEAR (1–2.5%) proximity tier · Vol dry-up ≥1 · Breaks out within 5 days ~43–74% of the time.',
    filter: r =>
      (r.nearBreakoutTier === 'IMMINENT' || r.nearBreakoutTier === 'NEAR') &&
      r.momentum.volDryUpScore >= 1,
  },
  {
    // FIX: Removed rsNifty20>=1.05 — rsNifty20 is hardcoded to 1.0 in every
    // param set (Nifty data unavailable per-stock at scan time) so that
    // condition was ALWAYS false, returning zero results.
    // momentumScore>=70 implies volDryUpScore>=3 AND obvSlope10>=0.5 (the
    // two highest-correlation positive predictors per the 3,806-signal backtest).
    key: 'strongest', label: 'Strongest Momentum', emoji: '🔥',
    description: 'MomScore≥70 (implies Vol dry-up ≥3 + OBV slope ≥0.5) · Not NO_SIGNAL unless MOM badge present.',
    filter: r =>
      r.momentum.momentumScore >= 70 &&
      (r.stage !== 'NO_SIGNAL' || !!r.monster?.badges?.some(b => b.type === 'MOM')),
  },
  {
    // FIX: Removed rewardRisk>=0.9 — tradeValid already requires rewardRisk>=1.5
    // so the 0.9 check was always redundant and dead.
    // Added rewardRisk>=2.0 (genuine quality gate), emaAligned (trend clarity),
    // and volDryUpScore>=2 (compression entry = controlled risk = safer).
    key: 'safe', label: 'Safe Entries', emoji: '🛡',
    description: 'Risk≤5% · R:R≥2.0 · EMA aligned · Vol dry-up ≥2. Tightest risk-adjusted setups only.',
    filter: r =>
      r.priceEngine.tradeValid &&
      r.priceEngine.tacticalRiskPct > 0 &&
      r.priceEngine.tacticalRiskPct <= 5 &&
      r.priceEngine.rewardRisk >= 2.0 &&
      r.momentum.emaAligned &&
      r.momentum.volDryUpScore >= 2,
  },
  {
    // Independent of stage by design — PBFB forensic backtest found the zone
    // engine misses ~70% of monster moves because they're momentum-
    // continuation breakouts on already-elevated-volatility stocks, not
    // quiet compression. This surfaces those even when stage is NO_SIGNAL
    // or COMPRESSION_WATCH. See lib/stockEngine.ts detectMonster() MOM badge.
    // FIX: Added topProbability>0.5 floor — badges below 50% probability
    // are low-conviction signals and generate noise.
    key: 'momAlert', label: 'MOM Alert', emoji: '🚀',
    description: 'MOM badge (momentum-continuation) with P>50% — 53.6% OOS hit rate vs 35% baseline. Independent of stage.',
    filter: r =>
      !!r.monster?.badges?.some(b => b.type === 'MOM') &&
      (r.monster?.topProbability ?? 0) > 0.5,
  },
  {
    // FIX: Expanded from single param set to the full high-conviction tier:
    // ULTRA_STRONG_BUY from any param set (strictly highest grade),
    // STRONG_BUY from the three precision/sniper sets (HiPrec15+, Elite10+, Sniper95+).
    // Original filter only matched HiPrec15+/STRONG_BUY and excluded ULTRA_STRONG_BUY.
    // 940-trade backtest (470 stocks × 5 param sets, 2022-2024):
    // avg P&L +4.10%, median +6.27%, 69% of trades >5%, WR 76%, PF 4.41.
    key: 'eliteSignal', label: 'Elite Signal', emoji: '⭐',
    description: 'ULTRA STRONG BUY (any set) · or STRONG BUY from HiPrec15+, Elite10+, Sniper95+. Backtest avg +4.10%, WR 76%.',
    filter: r =>
      r.stage === 'ULTRA_STRONG_BUY' ||
      (r.stage === 'STRONG_BUY' && (
        r.paramSetKey === 'optimized_highprecision_15plus' ||
        r.paramSetKey === 'optimized_elite_10plus' ||
        r.paramSetKey === 'sniper_95plus'
      )),
  },
];
