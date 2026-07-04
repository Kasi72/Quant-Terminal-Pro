import type { TrackedTrade } from './tradingUtils';

function safe(v: number, fallback = 0): number { return Number.isFinite(v) ? v : fallback; }

// ═══════════════════════════════════════════════════════════════════════════════
// #1: MFE/MAE Scatter Data
// ═══════════════════════════════════════════════════════════════════════════════

export interface MfeMaePoint {
  symbol: string;
  maeR: number;
  mfeR: number;
  pnlR: number;
  winner: boolean;
}

export function computeMfeMaeScatter(trades: TrackedTrade[]): MfeMaePoint[] {
  return trades
    .filter(t => t.status !== 'open' && t.entryPrice > 0 && t.stopLoss > 0)
    .map(t => {
      const rps = Math.max(t.entryPrice - t.stopLoss, 0.01);
      const mfeR = t.highestPrice ? safe((t.highestPrice - t.entryPrice) / rps) : 0;
      const pnlR = safe(t.pnlR ?? 0);
      const maeR = t.maeR != null ? safe(t.maeR) : (pnlR < 0 ? pnlR : 0);
      return { symbol: t.symbol, maeR, mfeR, pnlR, winner: pnlR > 0 };
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// #2: Expectancy Curve
// ═══════════════════════════════════════════════════════════════════════════════

export interface ExpectancyPoint {
  tradeNum: number;
  cumulativeR: number;
  symbol: string;
}

export function computeExpectancyCurve(trades: TrackedTrade[]): ExpectancyPoint[] {
  const closed = trades.filter(t => t.status !== 'open' && t.closedDate)
    .sort((a, b) => (a.closedDate ?? '').localeCompare(b.closedDate ?? ''));
  let cumR = 0;
  return [{ tradeNum: 0, cumulativeR: 0, symbol: '' }, ...closed.map((t, i) => {
    cumR += safe(t.pnlR ?? 0);
    return { tradeNum: i + 1, cumulativeR: safe(cumR), symbol: t.symbol };
  })];
}

// ═══════════════════════════════════════════════════════════════════════════════
// #3: R-Multiple Distribution
// ═══════════════════════════════════════════════════════════════════════════════

export interface RBucket { range: string; count: number; color: string; }

export function computeRDistribution(trades: TrackedTrade[]): RBucket[] {
  const closed = trades.filter(t => t.status !== 'open');
  const buckets: Record<string, { count: number; color: string }> = {
    '<-2R': { count: 0, color: '#dc2626' },
    '-2 to -1R': { count: 0, color: '#ef4444' },
    '-1 to 0R': { count: 0, color: '#f87171' },
    '0 to +1R': { count: 0, color: '#4ade80' },
    '+1 to +2R': { count: 0, color: '#22c55e' },
    '+2 to +3R': { count: 0, color: '#16a34a' },
    '>+3R': { count: 0, color: '#15803d' },
  };
  for (const t of closed) {
    const r = safe(t.pnlR ?? 0);
    if (r < -2) buckets['<-2R'].count++;
    else if (r < -1) buckets['-2 to -1R'].count++;
    else if (r < 0) buckets['-1 to 0R'].count++;
    else if (r < 1) buckets['0 to +1R'].count++;
    else if (r < 2) buckets['+1 to +2R'].count++;
    else if (r < 3) buckets['+2 to +3R'].count++;
    else buckets['>+3R'].count++;
  }
  return Object.entries(buckets).map(([range, { count, color }]) => ({ range, count, color }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// #4: Stop & Target Optimization
// ═══════════════════════════════════════════════════════════════════════════════

export interface OptimizationResult {
  currentStopR: number;
  currentWinRate: number;
  currentExpectancy: number;
  tighterStopWR: number;
  tighterStopExp: number;
  widerStopWR: number;
  widerStopExp: number;
  optimalT1R: number;
  mfeReachPct: Array<{ rLevel: number; pctReaching: number }>;
  profitCapturePct: number;
}

export function computeOptimization(trades: TrackedTrade[]): OptimizationResult | null {
  const closed = trades.filter(t => t.status !== 'open' && t.entryPrice > 0 && t.stopLoss > 0);
  if (closed.length < 5) return null;

  const wins = closed.filter(t => (t.pnlR ?? 0) > 0);
  const losses = closed.filter(t => (t.pnlR ?? 0) < 0);
  const wr = closed.length > 0 ? wins.length / closed.length * 100 : 0;
  const avgWinR = wins.length > 0 ? wins.reduce((s, t) => s + safe(t.pnlR ?? 0), 0) / wins.length : 0;
  const avgLossR = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(safe(t.pnlR ?? 0)), 0) / losses.length : 0;
  const expectancy = closed.length > 0 ? closed.reduce((s, t) => s + safe(t.pnlR ?? 0), 0) / closed.length : 0;

  // Simulate tighter stop (0.7R) — use stored maeR if available, else fall back to pnlR proxy
  const tighterSurvive = closed.filter(t => {
    if (t.maeR != null) return Math.abs(t.maeR) <= 0.7;
    // For winners without maeR data we can't know MAE — exclude them (conservative)
    if ((t.pnlR ?? 0) > 0) return false;
    return Math.abs(t.pnlR ?? 0) <= 0.7;
  });
  const tighterWR = tighterSurvive.length > 0 ? tighterSurvive.filter(t => (t.pnlR ?? 0) > 0).length / tighterSurvive.length * 100 : 0;
  const tighterExp = tighterSurvive.length > 0 ? tighterSurvive.reduce((s, t) => s + safe(t.pnlR ?? 0), 0) / tighterSurvive.length : 0;

  // Simulate wider stop (1.5R)
  const widerWR = wr;
  const widerExp = expectancy;

  // MFE reach analysis
  const mfeReachPct: OptimizationResult['mfeReachPct'] = [];
  for (const rLevel of [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0]) {
    const reaching = closed.filter(t => {
      const rps = Math.max(t.entryPrice - t.stopLoss, 0.01);
      const mfeR = t.highestPrice ? (t.highestPrice - t.entryPrice) / rps : 0;
      return mfeR >= rLevel;
    });
    mfeReachPct.push({ rLevel, pctReaching: safe(reaching.length / closed.length * 100) });
  }

  // Optimal T1: highest rLevel where >60% trades reach
  const optimalT1R = mfeReachPct.filter(m => m.pctReaching >= 60).pop()?.rLevel ?? 1.0;

  // Profit capture: avg actual R for winners / avg MFE R for same winners
  const winsWithMfe = wins.filter(t => t.highestPrice && t.highestPrice > t.entryPrice);
  const avgMfeR = winsWithMfe.length > 0
    ? winsWithMfe.reduce((s, t) => {
        const rps = Math.max(t.entryPrice - t.stopLoss, 0.01);
        return s + (t.highestPrice! - t.entryPrice) / rps;
      }, 0) / winsWithMfe.length : 1;
  const avgWinRForCapture = winsWithMfe.length > 0
    ? winsWithMfe.reduce((s, t) => s + safe(t.pnlR ?? 0), 0) / winsWithMfe.length : 0;
  const profitCapturePct = avgMfeR > 0 ? safe(avgWinRForCapture / avgMfeR * 100) : 0;

  return {
    currentStopR: 1.0, currentWinRate: safe(wr), currentExpectancy: safe(expectancy),
    tighterStopWR: safe(tighterWR), tighterStopExp: safe(tighterExp),
    widerStopWR: safe(widerWR), widerStopExp: safe(widerExp),
    optimalT1R, mfeReachPct, profitCapturePct: safe(profitCapturePct),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// #5: Regime-Filtered Performance
// ═══════════════════════════════════════════════════════════════════════════════

export interface RegimePerf { regime: string; trades: number; winRate: number; avgR: number; expectancy: number; }

export function computeRegimePerformance(trades: TrackedTrade[]): RegimePerf[] {
  // Simple proxy: if entry was when Nifty trend was up/down
  // Without stored regime data, use PnL sign clustering as proxy
  const closed = trades.filter(t => t.status !== 'open')
    .sort((a, b) => (a.closedDate ?? '').localeCompare(b.closedDate ?? ''));
  if (closed.length < 3) return [];

  // Split into chronological halves as proxy for different regimes
  const half = Math.floor(closed.length / 2);
  const periods = [
    { label: 'Earlier Trades', trades: closed.slice(0, half) },
    { label: 'Recent Trades', trades: closed.slice(half) },
  ];

  return periods.map(p => {
    const wins = p.trades.filter(t => (t.pnlR ?? 0) > 0);
    const avgR = p.trades.length > 0 ? p.trades.reduce((s, t) => s + safe(t.pnlR ?? 0), 0) / p.trades.length : 0;
    return {
      regime: p.label, trades: p.trades.length,
      winRate: p.trades.length > 0 ? safe(wins.length / p.trades.length * 100) : 0,
      avgR: safe(avgR),
      expectancy: p.trades.length > 0 ? safe(p.trades.reduce((s, t) => s + safe(t.pnlR ?? 0), 0) / p.trades.length) : 0,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// #6: Sector Performance Breakdown
// ═══════════════════════════════════════════════════════════════════════════════

export interface SectorPerf { sector: string; trades: number; winRate: number; avgR: number; bestSymbol: string; }

export function computeSectorPerformance(trades: TrackedTrade[]): SectorPerf[] {
  const closed = trades.filter(t => t.status !== 'open');
  const sectors = new Map<string, TrackedTrade[]>();
  for (const t of closed) {
    const sec = t.sector || 'Unknown';
    if (!sectors.has(sec)) sectors.set(sec, []);
    sectors.get(sec)!.push(t);
  }
  const results: SectorPerf[] = [];
  for (const [sector, st] of sectors) {
    if (st.length < 1) continue;
    const wins = st.filter(t => (t.pnlR ?? 0) > 0);
    const avgR = st.reduce((s, t) => s + safe(t.pnlR ?? 0), 0) / st.length;
    const best = st.reduce((b, t) => (t.pnlR ?? 0) > (b.pnlR ?? 0) ? t : b, st[0]);
    results.push({ sector, trades: st.length, winRate: safe(wins.length / st.length * 100), avgR: safe(avgR), bestSymbol: best.symbol });
  }
  return results.sort((a, b) => (b.avgR - a.avgR) || a.sector.localeCompare(b.sector));
}

// ═══════════════════════════════════════════════════════════════════════════════
// #7: Conviction vs Outcome
// ═══════════════════════════════════════════════════════════════════════════════

export interface ConvictionPoint { conviction: number; pnlR: number; symbol: string; winner: boolean; }

export function computeConvictionCorrelation(trades: TrackedTrade[]): { points: ConvictionPoint[]; correlation: number } {
  const closed = trades.filter(t => t.status !== 'open' && t.conviction != null);
  const points = closed.map(t => ({
    conviction: t.conviction ?? 0, pnlR: safe(t.pnlR ?? 0), symbol: t.symbol, winner: (t.pnlR ?? 0) > 0,
  }));
  if (points.length < 3) return { points, correlation: 0 };

  const mX = points.length > 0 ? points.reduce((s, p) => s + p.conviction, 0) / points.length : 0;
  const mY = points.length > 0 ? points.reduce((s, p) => s + p.pnlR, 0) / points.length : 0;
  let num = 0, dX = 0, dY = 0;
  for (const p of points) { num += (p.conviction - mX) * (p.pnlR - mY); dX += (p.conviction - mX) ** 2; dY += (p.pnlR - mY) ** 2; }
  const den = Math.sqrt(dX * dY);
  return { points, correlation: den > 0 ? safe(num / den) : 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// #8: Edge Decay (Rolling 5-trade win rate)
// ═══════════════════════════════════════════════════════════════════════════════

export interface EdgePoint { windowEnd: number; winRate: number; avgR: number; }

export function computeEdgeDecay(trades: TrackedTrade[], windowSize = 5): { points: EdgePoint[]; trending: 'improving' | 'stable' | 'decaying' } {
  const closed = trades.filter(t => t.status !== 'open' && t.closedDate)
    .sort((a, b) => (a.closedDate ?? '').localeCompare(b.closedDate ?? ''));
  if (closed.length < windowSize) return { points: [], trending: 'stable' };

  const points: EdgePoint[] = [];
  for (let i = windowSize; i <= closed.length; i++) {
    const window = closed.slice(i - windowSize, i);
    const wins = window.filter(t => (t.pnlR ?? 0) > 0).length;
    const avgR = window.reduce((s, t) => s + safe(t.pnlR ?? 0), 0) / windowSize;
    points.push({ windowEnd: i, winRate: safe(wins / windowSize * 100), avgR: safe(avgR) });
  }

  if (points.length < 3) return { points, trending: 'stable' };
  const firstHalf = points.slice(0, Math.floor(points.length / 2));
  const secondHalf = points.slice(Math.floor(points.length / 2));
  const avgFirst = firstHalf.length > 0 ? firstHalf.reduce((s, p) => s + p.winRate, 0) / firstHalf.length : 0;
  const avgSecond = secondHalf.length > 0 ? secondHalf.reduce((s, p) => s + p.winRate, 0) / secondHalf.length : 0;
  const trending = avgSecond > avgFirst + 5 ? 'improving' : avgSecond < avgFirst - 5 ? 'decaying' : 'stable';

  return { points, trending };
}

// ═══════════════════════════════════════════════════════════════════════════════
// #9: Day-of-Week Analysis
// ═══════════════════════════════════════════════════════════════════════════════

export interface DayPerf { day: string; trades: number; winRate: number; avgR: number; }

export function computeDayOfWeek(trades: TrackedTrade[]): DayPerf[] {
  const closed = trades.filter(t => t.status !== 'open' && t.entryDate);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const buckets = new Map<number, TrackedTrade[]>();
  for (const t of closed) {
    const [y, mo, d] = (t.entryDate ?? '').split('-').map(Number);
    const dow = (y && mo && d) ? new Date(y, mo - 1, d).getDay() : new Date(t.entryDate).getDay();
    if (!buckets.has(dow)) buckets.set(dow, []);
    buckets.get(dow)!.push(t);
  }
  const results: DayPerf[] = [];
  for (let d = 1; d <= 5; d++) {
    const bt = buckets.get(d) ?? [];
    if (bt.length === 0) continue;
    const wins = bt.filter(t => (t.pnlR ?? 0) > 0);
    results.push({
      day: days[d], trades: bt.length,
      winRate: safe(wins.length / bt.length * 100),
      avgR: safe(bt.reduce((s, t) => s + safe(t.pnlR ?? 0), 0) / bt.length),
    });
  }
  return results;
}
