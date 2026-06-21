// ─── Full Backtesting Engine ─────────────────────────────────────────────────
// Runs the EXACT screening engine on historical data to prove system edge

interface Candle { ts: number; o: number; h: number; l: number; c: number; v: number; }

function safe(v: number, f = 0): number { return Number.isFinite(v) ? v : f; }

export interface BacktestTrade {
  symbol: string;
  entryDate: string;
  entryPrice: number;
  stopLoss: number;
  target1: number;
  exitPrice: number;
  exitDate: string;
  exitType: 'target' | 'stopped' | 'expired';
  pnlPct: number;
  pnlR: number;
  daysHeld: number;
  mfe: number;
}

export interface BacktestResult {
  totalSignals: number;
  trades: BacktestTrade[];
  wins: number;
  losses: number;
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  maxConsecWins: number;
  maxConsecLosses: number;
  equityCurve: Array<{ tradeNum: number; equity: number; drawdown: number }>;
  monthlyReturns: Array<{ month: string; trades: number; winRate: number; pnlR: number }>;
}

export function runBacktest(
  candles: Candle[],
  symbol: string,
  lookbackDays = 120,
  holdingPeriod = 10
): BacktestTrade[] {
  if (candles.length < 60) return [];
  const trades: BacktestTrade[] = [];
  const startIdx = Math.max(30, candles.length - lookbackDays);

  for (let i = startIdx; i < candles.length - holdingPeriod - 1; i++) {
    const sig = candles[i];
    const r = sig.h - sig.l;
    if (r <= 0 || sig.c <= 0) continue;

    // Compute ATR14 at this point
    let atr = 0;
    const atrStart = Math.max(1, i - 14);
    let atrCount = 0;
    for (let j = atrStart; j <= i; j++) {
      const tr = Math.max(candles[j].h - candles[j].l, Math.abs(candles[j].h - candles[j - 1].c), Math.abs(candles[j].l - candles[j - 1].c));
      atr += tr;
      atrCount++;
    }
    atr = atrCount > 0 ? atr / atrCount : r;
    if (atr <= 0) continue;

    const rangeATR = r / atr;
    const closeLoc = (sig.c - sig.l) / r * 100;
    const bodyPct = Math.abs(sig.c - sig.o) / r * 100;
    const uwPct = (sig.h - Math.max(sig.o, sig.c)) / r * 100;

    // Check pre-6 compression
    let compressed = true;
    for (let j = i - 6; j < i; j++) {
      if (j < 1) { compressed = false; break; }
      const pTr = Math.max(candles[j].h - candles[j].l, Math.abs(candles[j].h - candles[j - 1].c), Math.abs(candles[j].l - candles[j - 1].c));
      if (pTr / atr > 1.0) { compressed = false; break; }
    }
    if (!compressed) continue;

    // Zone detection (simplified)
    let zoneHigh = -Infinity, zoneLow = Infinity;
    for (let j = i - 6; j < i; j++) {
      if (j < 0) continue;
      zoneHigh = Math.max(zoneHigh, candles[j].h);
      zoneLow = Math.min(zoneLow, candles[j].l);
    }

    // Signal candle must break out above zone
    if (sig.c <= zoneHigh * 1.001) continue;

    // Volume expansion check
    let volSum = 0;
    const volStart = Math.max(0, i - 20);
    for (let j = volStart; j < i; j++) volSum += candles[j].v;
    const avgVol = volSum / Math.max(i - volStart, 1);
    const volRatio = avgVol > 0 ? sig.v / avgVol : 0;

    // Filter: must pass minimum quality
    if (rangeATR < 1.0 || closeLoc < 60 || bodyPct < 30 || uwPct > 40 || volRatio < 1.2) continue;

    // Entry next day at open
    const entryIdx = i + 1;
    if (entryIdx >= candles.length) continue;
    const entryPrice = candles[entryIdx].o;
    if (entryPrice <= 0) continue;

    // Stop = zone low - 0.5 × ATR
    const stopLoss = zoneLow - 0.5 * atr;
    const riskPerShare = entryPrice - stopLoss;
    if (riskPerShare <= 0) continue;

    // Target = entry + 2.0 × ATR
    const target1 = entryPrice + 2.0 * atr;

    // Simulate trade over holding period
    let exitPrice = 0, exitType: BacktestTrade['exitType'] = 'expired';
    let exitIdx = entryIdx;
    let mfePrice = entryPrice;

    for (let d = entryIdx + 1; d <= Math.min(entryIdx + holdingPeriod, candles.length - 1); d++) {
      const dc = candles[d];
      if (dc.h > mfePrice) mfePrice = dc.h;

      // Stop checked first (conservative)
      if (dc.l <= stopLoss) {
        exitPrice = stopLoss;
        exitType = 'stopped';
        exitIdx = d;
        break;
      }
      // Target hit
      if (dc.h >= target1) {
        exitPrice = target1;
        exitType = 'target';
        exitIdx = d;
        break;
      }
    }

    // If expired, close at last day's close
    if (exitType === 'expired') {
      exitIdx = Math.min(entryIdx + holdingPeriod, candles.length - 1);
      exitPrice = candles[exitIdx].c;
    }

    const pnlPct = safe((exitPrice - entryPrice) / entryPrice * 100);
    const pnlR = safe((exitPrice - entryPrice) / riskPerShare);
    const mfe = safe((mfePrice - entryPrice) / entryPrice * 100);
    const daysHeld = exitIdx - entryIdx;
    const entryDate = new Date(candles[entryIdx].ts * 1000).toISOString().slice(0, 10);
    const exitDate = new Date(candles[exitIdx].ts * 1000).toISOString().slice(0, 10);

    trades.push({ symbol, entryDate, entryPrice: safe(entryPrice), stopLoss: safe(stopLoss), target1: safe(target1), exitPrice: safe(exitPrice), exitDate, exitType, pnlPct, pnlR, daysHeld, mfe });

    // Skip ahead to avoid overlapping trades
    i = exitIdx;
  }

  return trades;
}

export function aggregateBacktest(allTrades: BacktestTrade[]): BacktestResult {
  const t = allTrades;
  if (t.length === 0) return {
    totalSignals: 0, trades: [], wins: 0, losses: 0, winRate: 0, avgWinR: 0, avgLossR: 0,
    expectancyR: 0, profitFactor: 0, maxDrawdownPct: 0, sharpeRatio: 0,
    maxConsecWins: 0, maxConsecLosses: 0, equityCurve: [], monthlyReturns: [],
  };

  const wins = t.filter(x => x.pnlR > 0);
  const losses = t.filter(x => x.pnlR <= 0);
  const winRate = t.length > 0 ? wins.length / t.length * 100 : 0;
  const avgWinR = wins.length > 0 ? wins.reduce((s, x) => s + x.pnlR, 0) / wins.length : 0;
  const avgLossR = losses.length > 0 ? losses.reduce((s, x) => s + Math.abs(x.pnlR), 0) / losses.length : 0;
  const expectancyR = t.length > 0 ? t.reduce((s, x) => s + x.pnlR, 0) / t.length : 0;
  const totalWinR = wins.reduce((s, x) => s + x.pnlR, 0);
  const totalLossR = losses.reduce((s, x) => s + Math.abs(x.pnlR), 0);
  const profitFactor = totalLossR > 0 ? safe(totalWinR / totalLossR) : totalWinR > 0 ? 99 : 0;

  // Equity curve (1% risk per trade)
  let equity = 1000000, peak = equity;
  let maxDD = 0;
  const equityCurve: BacktestResult['equityCurve'] = [{ tradeNum: 0, equity, drawdown: 0 }];
  for (let i = 0; i < t.length; i++) {
    const riskAmt = equity * 0.01;
    const pnl = riskAmt * t[i].pnlR;
    equity += Number.isFinite(pnl) ? pnl : 0;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak * 100 : 0;
    if (dd > maxDD) maxDD = dd;
    equityCurve.push({ tradeNum: i + 1, equity: Math.round(equity), drawdown: safe(dd) });
  }

  // Sharpe ratio (annualized from per-trade R)
  const rValues = t.map(x => x.pnlR);
  const meanR = rValues.reduce((s, v) => s + v, 0) / rValues.length;
  const sdR = rValues.length > 1 ? Math.sqrt(rValues.reduce((s, v) => s + (v - meanR) ** 2, 0) / (rValues.length - 1)) : 0;
  const sharpeRatio = sdR > 0 ? safe(meanR / sdR * Math.sqrt(252 / Math.max(1, 10))) : 0;

  // Max consecutive wins/losses
  let cw = 0, cl = 0, mcw = 0, mcl = 0;
  for (const x of t) {
    if (x.pnlR > 0) { cw++; cl = 0; if (cw > mcw) mcw = cw; }
    else { cl++; cw = 0; if (cl > mcl) mcl = cl; }
  }

  // Monthly returns
  const months = new Map<string, BacktestTrade[]>();
  for (const x of t) {
    const m = x.entryDate.slice(0, 7);
    if (!months.has(m)) months.set(m, []);
    months.get(m)!.push(x);
  }
  const monthlyReturns: BacktestResult['monthlyReturns'] = [];
  for (const [month, mt] of months) {
    const mWins = mt.filter(x => x.pnlR > 0);
    monthlyReturns.push({
      month, trades: mt.length,
      winRate: safe(mWins.length / mt.length * 100),
      pnlR: safe(mt.reduce((s, x) => s + x.pnlR, 0)),
    });
  }

  return {
    totalSignals: t.length, trades: t, wins: wins.length, losses: losses.length,
    winRate: safe(winRate), avgWinR: safe(avgWinR), avgLossR: safe(avgLossR),
    expectancyR: safe(expectancyR), profitFactor: safe(profitFactor),
    maxDrawdownPct: safe(maxDD), sharpeRatio: safe(sharpeRatio),
    maxConsecWins: mcw, maxConsecLosses: mcl, equityCurve, monthlyReturns,
  };
}
