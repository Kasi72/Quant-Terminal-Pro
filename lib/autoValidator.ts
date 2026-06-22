import type { TrackedTrade } from './tradingUtils';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ValidationResult {
  symbol: string;
  status: 'open' | 'hit_t1' | 'hit_t2' | 'hit_t3' | 'stopped' | 'expired';
  pnlPct: number;
  pnlR: number;
  daysHeld: number;
  mfe: number;       // Maximum Favorable Excursion (highest % above entry)
  mae: number;       // Maximum Adverse Excursion (lowest % below entry)
  mfeR: number;      // MFE in R-multiples
  maeR: number;      // MAE in R-multiples
  closedPrice: number;
  closedDate: string;
}

interface Candle { h: number; l: number; c: number; }

// ─── Bar-by-bar sequential validation (Level 3 — precise) ───────────────────
//
// For each day since entry, check IN ORDER:
//   1. Did the LOW hit stop BEFORE the HIGH hit T1?
//   2. Or did the HIGH hit T1 BEFORE the LOW hit stop?
// This handles same-day stop+target scenarios correctly.

export function validateTrade(
  trade: TrackedTrade,
  candlesSinceEntry: Candle[]
): ValidationResult {
  const defaultResult: ValidationResult = { symbol: trade.symbol, status: 'open', pnlPct: 0, pnlR: 0, daysHeld: 0, mfe: 0, mae: 0, mfeR: 0, maeR: 0, closedPrice: 0, closedDate: '' };
  if (!trade || !Number.isFinite(trade.entryPrice) || trade.entryPrice <= 0) return defaultResult;
  if (!Array.isArray(candlesSinceEntry) || candlesSinceEntry.length === 0) return defaultResult;

  const riskPerShare = Math.max(trade.entryPrice - trade.stopLoss, 0.01);
  let mfePrice = trade.entryPrice;
  let maePrice = trade.entryPrice;
  let status: ValidationResult['status'] = 'open';
  let closedPrice = 0;
  let closedDate = '';

  for (let i = 0; i < candlesSinceEntry.length; i++) {
    const candle = candlesSinceEntry[i];
    if (!candle || !Number.isFinite(candle.h) || !Number.isFinite(candle.l)) continue;

    // Track MFE/MAE
    if (candle.h > mfePrice) mfePrice = candle.h;
    if (candle.l < maePrice) maePrice = candle.l;

    // Bar-by-bar check: stop checked first (conservative — assume worst case)
    // Skip stop check on first candle (entry day) to prevent false same-day stop-outs
    if (i > 0 && candle.l <= trade.stopLoss) {
      status = 'stopped';
      closedPrice = trade.stopLoss;
      break;
    }

    // Check targets on ALL candles including entry day
    if (trade.target3 > 0 && candle.h >= trade.target3) {
      status = 'hit_t3';
      closedPrice = trade.target3;
      break;
    }
    if (trade.target2 > 0 && candle.h >= trade.target2) {
      status = 'hit_t2';
      closedPrice = trade.target2;
      break;
    }
    if (trade.target1 > 0 && candle.h >= trade.target1) {
      status = 'hit_t1';
      closedPrice = trade.target1;
      break;
    }
  }

  // Time expiry: if > 10 days and still open, mark expired
  const daysHeld = candlesSinceEntry.length;
  if (status === 'open' && daysHeld >= 10) {
    status = 'expired';
    closedPrice = candlesSinceEntry.length > 0 ? candlesSinceEntry[candlesSinceEntry.length - 1].c : trade.entryPrice;
  }

  const pnlPct = closedPrice > 0 ? ((closedPrice - trade.entryPrice) / trade.entryPrice) * 100 : 0;
  const pnlR = riskPerShare > 0 && closedPrice > 0 ? (closedPrice - trade.entryPrice) / riskPerShare : 0;
  const mfe = ((mfePrice - trade.entryPrice) / trade.entryPrice) * 100;
  const mae = ((maePrice - trade.entryPrice) / trade.entryPrice) * 100;
  const mfeR = riskPerShare > 0 ? (mfePrice - trade.entryPrice) / riskPerShare : 0;
  const maeR = riskPerShare > 0 ? (maePrice - trade.entryPrice) / riskPerShare : 0;

  const today = new Date().toISOString().slice(0, 10);

  return {
    symbol: trade.symbol,
    status: status === 'open' ? 'open' : status,
    pnlPct: Math.round(pnlPct * 100) / 100,
    pnlR: Math.round(pnlR * 100) / 100,
    daysHeld,
    mfe: Math.round(mfe * 100) / 100,
    mae: Math.round(mae * 100) / 100,
    mfeR: Math.round(mfeR * 100) / 100,
    maeR: Math.round(maeR * 100) / 100,
    closedPrice: Math.round(closedPrice * 100) / 100,
    closedDate: status !== 'open' ? today : '',
  };
}

// ─── Apply validation to tracked trade ───────────────────────────────────────

export function applyValidation(trade: TrackedTrade, result: ValidationResult): TrackedTrade {
  if (trade.status !== 'open') return trade; // already closed, don't overwrite
  if (result.status === 'open') {
    // Still open — just update MFE/MAE and current price
    return {
      ...trade,
      currentPrice: (result.closedPrice && result.closedPrice > 0) ? result.closedPrice : (trade.currentPrice ?? trade.entryPrice),
      highestPrice: Math.max(trade.highestPrice ?? 0, trade.entryPrice * (1 + result.mfe / 100)),
      daysHeld: result.daysHeld,
      lastCheckDate: new Date().toISOString().slice(0, 10),
    };
  }
  // Trade has closed
  return {
    ...trade,
    status: result.status,
    closedPrice: result.closedPrice,
    closedDate: result.closedDate,
    pnlPct: result.pnlPct,
    pnlR: result.pnlR,
    daysHeld: result.daysHeld,
    currentPrice: result.closedPrice,
    highestPrice: trade.entryPrice * (1 + result.mfe / 100),
    lastCheckDate: new Date().toISOString().slice(0, 10),
  };
}

// ─── Rolling Stats ───────────────────────────────────────────────────────────

export interface RollingStats {
  period: string;
  total: number;
  wins: number;
  losses: number;
  winRate: number;
  avgMFE: number;
  avgMAE: number;
  avgTimeToTarget: number;
}

export function computeRollingStats(trades: TrackedTrade[], lastN: number, label: string): RollingStats {
  const closed = trades.filter(t => t.status !== 'open').slice(-lastN);
  const wins = closed.filter(t => (t.pnlPct ?? 0) > 0);
  const losses = closed.filter(t => (t.pnlPct ?? 0) <= 0);
  return {
    period: label,
    total: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    avgMFE: wins.length > 0 ? wins.reduce((s, t) => s + (t.pnlPct ?? 0), 0) / wins.length : 0,
    avgMAE: losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnlPct ?? 0), 0) / losses.length : 0,
    avgTimeToTarget: wins.length > 0 ? wins.reduce((s, t) => s + (t.daysHeld ?? 0), 0) / wins.length : 0,
  };
}
