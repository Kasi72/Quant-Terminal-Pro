import { getTradeRiskPerShare, didReachFivePctTarget, type TrackedTrade } from './tradeOps';

// ─── Equity Curve ────────────────────────────────────────────────────────────

export interface EquityPoint {
  date: string;
  equity: number;
  drawdown: number;
  tradeCount: number;
}

export function buildEquityCurve(trades: TrackedTrade[], startingCapital = 1000000): EquityPoint[] {
  const closed = trades.filter(t => t.status !== 'open' && t.closedDate).sort((a, b) => (a.closedDate ?? '').localeCompare(b.closedDate ?? ''));
  if (closed.length === 0) return [];

  let equity = startingCapital;
  let peak = equity;
  const points: EquityPoint[] = [{ date: closed[0]?.closedDate ?? '', equity: startingCapital, drawdown: 0, tradeCount: 0 }];

  for (let i = 0; i < closed.length; i++) {
    const t = closed[i];
    const riskAmount = equity * 0.01; // 1% risk per trade (compounding)
    const riskPct = t.entryPrice > 0
      ? (getTradeRiskPerShare(t) / t.entryPrice) * 100
      : 2;
    // PnL = riskAmount × (pnlPct / riskPct) = actual rupees gained/lost
    const pnl = riskPct > 0 ? riskAmount * ((t.pnlPct ?? 0) / riskPct) : 0;
    equity += Number.isFinite(pnl) ? pnl : 0;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    points.push({ date: t.closedDate ?? '', equity: Math.round(equity), drawdown: Math.round(dd * 100) / 100, tradeCount: i + 1 });
  }
  return points;
}

// ─── Monthly Report ──────────────────────────────────────────────────────────

export interface MonthlyReport {
  month: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossPnlPct: number;       // equity-curve return for the month (1% risk/trade, compounded)
  bestTrade: { symbol: string; pnl: number } | null;
  worstTrade: { symbol: string; pnl: number } | null;
  maxDrawdown: number;       // equity-curve peak-to-trough drawdown within the month
  avgR: number | null;
  avgDaysHeld: number | null;
}

export function generateMonthlyReports(trades: TrackedTrade[], startingCapital = 1000000): MonthlyReport[] {
  const closed = trades
    .filter(t => t.status !== 'open' && t.closedDate)
    .sort((a, b) => (a.closedDate ?? '').localeCompare(b.closedDate ?? ''));
  if (closed.length === 0) return [];

  // Replay equity curve (same logic as buildEquityCurve) capturing per-trade snapshots
  type TradeSnap = { month: string; preEq: number; postEq: number; trade: TrackedTrade };
  let equity = startingCapital;
  const snaps: TradeSnap[] = [];

  for (const t of closed) {
    const preEq = equity;
    const riskAmount = equity * 0.01;
    const riskPct = t.entryPrice > 0
      ? (getTradeRiskPerShare(t) / t.entryPrice) * 100
      : 2;
    const pnl = riskPct > 0 ? riskAmount * ((t.pnlPct ?? 0) / riskPct) : 0;
    equity += Number.isFinite(pnl) ? pnl : 0;
    snaps.push({ month: (t.closedDate ?? '').slice(0, 7), preEq, postEq: equity, trade: t });
  }

  const byMonth = new Map<string, TradeSnap[]>();
  for (const s of snaps) {
    if (!byMonth.has(s.month)) byMonth.set(s.month, []);
    byMonth.get(s.month)!.push(s);
  }

  const reports: MonthlyReport[] = [];
  for (const [month, monthSnaps] of Array.from(byMonth.entries()).sort()) {
    const monthTrades = monthSnaps.map(s => s.trade);

    // True equity-curve monthly return
    const monthStartEq = monthSnaps[0].preEq;
    const monthEndEq   = monthSnaps[monthSnaps.length - 1].postEq;
    const equityReturnPct = monthStartEq > 0
      ? ((monthEndEq - monthStartEq) / monthStartEq) * 100
      : 0;

    // Equity-curve max drawdown within month
    let peakEq = monthStartEq;
    let monthMaxDD = 0;
    for (const s of monthSnaps) {
      if (s.postEq > peakEq) peakEq = s.postEq;
      const dd = peakEq > 0 ? ((peakEq - s.postEq) / peakEq) * 100 : 0;
      if (dd > monthMaxDD) monthMaxDD = dd;
    }

    // Win rate — consistent with headline 5% target KPI
    const wins   = monthTrades.filter(didReachFivePctTarget);
    const losses = monthTrades.filter(t => !didReachFivePctTarget(t));

    let best: { symbol: string; pnl: number } | null = null;
    let worst: { symbol: string; pnl: number } | null = null;
    let totalR = 0, rCount = 0, totalDays = 0, daysCount = 0;

    for (const t of monthTrades) {
      const p = t.pnlPct ?? 0;
      if (!best  || p > best.pnl)  best  = { symbol: t.symbol, pnl: p };
      if (!worst || p < worst.pnl) worst = { symbol: t.symbol, pnl: p };
      if (t.pnlR != null && Number.isFinite(t.pnlR)) { totalR += t.pnlR; rCount++; }
      const days = t.daysHeld != null
        ? t.daysHeld
        : (t.entryDate && t.closedDate
          ? Math.round((new Date(t.closedDate).getTime() - new Date(t.entryDate).getTime()) / 86400000)
          : null);
      if (days != null && days >= 0) { totalDays += days; daysCount++; }
    }

    reports.push({
      month,
      trades:    monthTrades.length,
      wins:      wins.length,
      losses:    losses.length,
      winRate:   monthTrades.length > 0 ? (wins.length / monthTrades.length) * 100 : 0,
      grossPnlPct: Math.round(equityReturnPct * 100) / 100,
      bestTrade:  best,
      worstTrade: worst,
      maxDrawdown: Math.round(monthMaxDD * 100) / 100,
      avgR:        rCount > 0    ? Math.round((totalR / rCount) * 100) / 100 : null,
      avgDaysHeld: daysCount > 0 ? Math.round(totalDays / daysCount)         : null,
    });
  }
  return reports;
}

// ─── Scan Favorites ──────────────────────────────────────────────────────────

export interface ScanFavorite {
  id: string;
  name: string;
  source: string;
  symbols: string[];
  paramSet: string;
}

export function loadFavorites(): ScanFavorite[] {
  try { return JSON.parse(localStorage.getItem('qtp_favorites') ?? '[]'); } catch { return []; }
}

export function saveFavorites(favs: ScanFavorite[]) {
  try { localStorage.setItem('qtp_favorites', JSON.stringify(favs)); } catch {}
}

// ─── Trade Rules ─────────────────────────────────────────────────────────────

export interface TradeRule {
  id: string;
  label: string;
  check: string;
  enabled: boolean;
}

export const DEFAULT_RULES: TradeRule[] = [
  { id: 'regime', label: 'Market regime is Bull or Neutral', check: 'regime', enabled: true },
  { id: 'maxpos', label: 'No more than 5 open positions', check: 'maxpos', enabled: true },
  { id: 'accrisk', label: 'Total account risk < 5% after this trade', check: 'accrisk', enabled: true },
  { id: 'conviction', label: 'Conviction score ≥ 50', check: 'conviction', enabled: true },
  { id: 'stats', label: 'Stats score ≥ 30', check: 'stats', enabled: true },
  { id: 'rr', label: 'Reward:Risk ≥ 1.5', check: 'rr', enabled: true },
];

// ─── Trade Review ────────────────────────────────────────────────────────────

export interface TradeReview {
  symbol: string;
  date: string;
  outcome: string;
  pnlPct: number;
  notes: string;
  lessons: string;
}

export function loadReviews(): TradeReview[] {
  try { return JSON.parse(localStorage.getItem('qtp_reviews') ?? '[]'); } catch { return []; }
}

export function saveReviews(reviews: TradeReview[]) {
  try { localStorage.setItem('qtp_reviews', JSON.stringify(reviews)); } catch {}
}
