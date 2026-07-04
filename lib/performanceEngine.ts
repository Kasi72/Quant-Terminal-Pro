import type { TrackedTrade } from './tradingUtils';

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
    const riskPct = t.entryPrice > 0 && t.stopLoss > 0
      ? ((t.entryPrice - t.stopLoss) / t.entryPrice) * 100
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
  grossPnlPct: number;
  bestTrade: { symbol: string; pnl: number } | null;
  worstTrade: { symbol: string; pnl: number } | null;
  maxDrawdown: number;
}

export function generateMonthlyReports(trades: TrackedTrade[]): MonthlyReport[] {
  const closed = trades.filter(t => t.status !== 'open' && t.closedDate);
  const byMonth = new Map<string, TrackedTrade[]>();
  for (const t of closed) {
    const m = (t.closedDate ?? '').slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(t);
  }

  const reports: MonthlyReport[] = [];
  for (const [month, mTrades] of Array.from(byMonth.entries()).sort()) {
    const wins = mTrades.filter(t => (t.pnlPct ?? 0) > 0);
    const losses = mTrades.filter(t => (t.pnlPct ?? 0) < 0);
    let best: { symbol: string; pnl: number } | null = null;
    let worst: { symbol: string; pnl: number } | null = null;
    let grossPnl = 0, maxDD = 0, runningPnl = 0, peakPnl = 0;
    const sorted = [...mTrades].sort((a, b) => (a.closedDate ?? '').localeCompare(b.closedDate ?? ''));
    for (const t of sorted) {
      const p = t.pnlPct ?? 0;
      grossPnl += p;
      runningPnl += p;
      if (runningPnl > peakPnl) peakPnl = runningPnl;
      const dd = peakPnl - runningPnl;
      if (dd > maxDD) maxDD = dd;
      if (!best || p > best.pnl) best = { symbol: t.symbol, pnl: p };
      if (!worst || p < worst.pnl) worst = { symbol: t.symbol, pnl: p };
    }
    reports.push({
      month, trades: mTrades.length, wins: wins.length, losses: losses.length,
      winRate: mTrades.length > 0 ? (wins.length / mTrades.length) * 100 : 0,
      grossPnlPct: Math.round(grossPnl * 100) / 100,
      bestTrade: best, worstTrade: worst,
      maxDrawdown: Math.round(Math.abs(maxDD) * 100) / 100,
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
