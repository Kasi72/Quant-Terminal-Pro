// ─── Professional Backtesting Engine v2 ──────────────────────────────────────
// 8 features: real costs, Monte Carlo, walk-forward, benchmark, drawdown, sensitivity

interface Candle { ts: number; o: number; h: number; l: number; c: number; v: number; }

function safe(v: number, f = 0): number { return Number.isFinite(v) ? v : f; }

// ═══════════════════════════════════════════════════════════════════════════════
// KOTAK SECURITIES COST MODEL
// ═══════════════════════════════════════════════════════════════════════════════

export interface TradeCosts {
  brokerage: number;      // ₹20/order or 0.05% whichever lower (delivery)
  stt: number;            // 0.1% on sell side (delivery)
  exchangeTxn: number;    // NSE 0.00297%
  gst: number;            // 18% on (brokerage + exchange txn)
  sebiCharges: number;    // 0.0001% on turnover
  stampDuty: number;      // 0.015% on buy side
  slippage: number;       // 0.05% estimated market impact
  totalCost: number;
  costPct: number;        // as % of trade value
}

export function computeTradeCosts(buyValue: number, sellValue: number): TradeCosts {
  // Brokerage: ₹20 per order or 0.05% whichever is lower (both legs)
  const buyBrokerage = Math.min(20, buyValue * 0.0005);
  const sellBrokerage = Math.min(20, sellValue * 0.0005);
  const brokerage = buyBrokerage + sellBrokerage;

  // STT: 0.1% on sell side only (equity delivery)
  const stt = sellValue * 0.001;

  // Exchange transaction charges: NSE 0.00297% on both legs
  const exchangeTxn = (buyValue + sellValue) * 0.0000297;

  // GST: 18% on (brokerage + exchange charges)
  const gst = (brokerage + exchangeTxn) * 0.18;

  // SEBI charges: 0.0001% on turnover
  const sebiCharges = (buyValue + sellValue) * 0.000001;

  // Stamp duty: 0.015% on buy side only
  const stampDuty = buyValue * 0.00015;

  // Slippage: 0.05% estimated market impact per leg
  const slippage = (buyValue + sellValue) * 0.0005;

  const totalCost = brokerage + stt + exchangeTxn + gst + sebiCharges + stampDuty + slippage;
  const costPct = (buyValue + sellValue) > 0 ? safe(totalCost / (buyValue + sellValue) * 100) : 0;

  return { brokerage: safe(brokerage), stt: safe(stt), exchangeTxn: safe(exchangeTxn), gst: safe(gst), sebiCharges: safe(sebiCharges), stampDuty: safe(stampDuty), slippage: safe(slippage), totalCost: safe(totalCost), costPct: safe(costPct) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKTEST TRADE
// ═══════════════════════════════════════════════════════════════════════════════

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
  pnlGross: number;      // before costs
  pnlNet: number;        // after Kotak costs
  costs: TradeCosts;
  daysHeld: number;
  mfe: number;
  shares: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// #1: CORE BACKTEST (with real screening logic + costs)
// ═══════════════════════════════════════════════════════════════════════════════

export function runBacktest(
  candles: Candle[],
  symbol: string,
  lookbackDays = 200,
  holdingPeriod = 10,
  accountSize = 1000000,
  riskPct = 1.0,
  _targetATRMult = 2.0, // deprecated — now uses hybrid clamp model
): BacktestTrade[] {
  if (candles.length < 60) return [];
  const trades: BacktestTrade[] = [];
  const startIdx = Math.max(30, candles.length - lookbackDays);

  for (let i = startIdx; i < candles.length - holdingPeriod - 1; i++) {
    const sig = candles[i];
    const r = sig.h - sig.l;
    if (r <= 0 || sig.c <= 0) continue;

    // ATR14 at this point
    let atrSum = 0, atrCount = 0;
    for (let j = Math.max(1, i - 14); j <= i; j++) {
      atrSum += Math.max(candles[j].h - candles[j].l, Math.abs(candles[j].h - candles[j - 1].c), Math.abs(candles[j].l - candles[j - 1].c));
      atrCount++;
    }
    const atr = atrCount > 0 ? atrSum / atrCount : r;
    if (atr <= 0) continue;

    const rangeATR = r / atr;
    const closeLoc = (sig.c - sig.l) / r * 100;
    const bodyPct = Math.abs(sig.c - sig.o) / r * 100;
    const uwPct = (sig.h - Math.max(sig.o, sig.c)) / r * 100;

    // Pre-6 compression check (strict: all candles must have rangeATR <= 1.0)
    let compressed = true;
    for (let j = i - 6; j < i; j++) {
      if (j < 1) { compressed = false; break; }
      const pTr = Math.max(candles[j].h - candles[j].l, Math.abs(candles[j].h - candles[j - 1].c), Math.abs(candles[j].l - candles[j - 1].c));
      if (pTr / atr > 1.0) { compressed = false; break; }
    }
    if (!compressed) continue;

    // Zone detection
    let zoneHigh = -Infinity, zoneLow = Infinity;
    for (let j = i - 6; j < i; j++) {
      if (j < 0) continue;
      zoneHigh = Math.max(zoneHigh, candles[j].h);
      zoneLow = Math.min(zoneLow, candles[j].l);
    }
    if (sig.c <= zoneHigh * 1.001) continue;

    // Volume expansion
    let volSum = 0;
    for (let j = Math.max(0, i - 20); j < i; j++) volSum += candles[j].v;
    const avgVol = volSum / Math.max(i - Math.max(0, i - 20), 1);
    const volRatio = avgVol > 0 ? sig.v / avgVol : 0;

    // Quality filter (matches actual screener thresholds)
    if (rangeATR < 1.0 || closeLoc < 60 || bodyPct < 30 || uwPct > 40 || volRatio < 1.2) continue;

    // Entry: next day open + 0.05% slippage
    const entryIdx = i + 1;
    if (entryIdx >= candles.length) continue;
    const rawEntry = candles[entryIdx].o;
    if (rawEntry <= 0) continue;
    const entryPrice = rawEntry * 1.0005; // slippage

    // Stop: zone low - 0.5 × ATR
    const stopLoss = zoneLow - 0.5 * atr;
    const riskPerShare = entryPrice - stopLoss;
    if (riskPerShare <= 0) continue;

    // Position sizing: 1% risk
    const riskAmount = accountSize * (riskPct / 100);
    const shares = Math.floor(riskAmount / riskPerShare);
    if (shares <= 0) continue;

    // Target: backtested hybrid — clamp(2.15 × ATR%, 3%, 5%)
    const atrPctAtEntry = entryPrice > 0 ? (atr / entryPrice) * 100 : 2.5;
    const t1Pct = Math.max(3.0, Math.min(5.0, 2.15 * atrPctAtEntry));
    const target1 = entryPrice * (1 + t1Pct / 100);

    // Simulate trade
    let exitPrice = 0, exitType: BacktestTrade['exitType'] = 'expired';
    let exitIdx = entryIdx;
    let mfePrice = entryPrice;

    for (let d = entryIdx + 1; d <= Math.min(entryIdx + holdingPeriod, candles.length - 1); d++) {
      const dc = candles[d];
      if (dc.h > mfePrice) mfePrice = dc.h;
      if (dc.l <= stopLoss) { exitPrice = dc.o <= stopLoss ? dc.o : stopLoss; exitType = 'stopped'; exitIdx = d; break; }
      if (dc.h >= target1) { exitPrice = target1; exitType = 'target'; exitIdx = d; break; }
    }

    if (exitType === 'expired') {
      exitIdx = Math.min(entryIdx + holdingPeriod, candles.length - 1);
      exitPrice = candles[exitIdx].c;
    }

    // Apply exit slippage
    exitPrice *= 0.9995;

    // Compute costs
    const buyValue = entryPrice * shares;
    const sellValue = exitPrice * shares;
    const costs = computeTradeCosts(buyValue, sellValue);

    const pnlGross = (exitPrice - entryPrice) * shares;
    const pnlNet = pnlGross - costs.totalCost;
    const pnlPct = safe((exitPrice - entryPrice) / entryPrice * 100);
    const pnlR = safe((exitPrice - entryPrice) / riskPerShare);
    const mfe = safe((mfePrice - entryPrice) / entryPrice * 100);
    const daysHeld = exitIdx - entryIdx;
    const entryDate = new Date(candles[entryIdx].ts * 1000).toISOString().slice(0, 10);
    const exitDate = new Date(candles[exitIdx].ts * 1000).toISOString().slice(0, 10);

    trades.push({ symbol, entryDate, entryPrice: safe(entryPrice), stopLoss: safe(stopLoss), target1: safe(target1), exitPrice: safe(exitPrice), exitDate, exitType, pnlPct, pnlR, pnlGross: safe(pnlGross), pnlNet: safe(pnlNet), costs, daysHeld, mfe, shares });

    i = exitIdx; // skip ahead
  }
  return trades;
}

// ═══════════════════════════════════════════════════════════════════════════════
// #3: BENCHMARK — Buy and hold Nifty comparison
// ═══════════════════════════════════════════════════════════════════════════════

export interface BenchmarkResult {
  niftyReturn: number;
  strategyReturn: number;
  alpha: number;
  niftyMaxDD: number;
}

export function computeBenchmark(niftyCandles: Candle[], trades: BacktestTrade[], startingCapital: number): BenchmarkResult {
  if (!niftyCandles || niftyCandles.length < 30 || trades.length === 0) return { niftyReturn: 0, strategyReturn: 0, alpha: 0, niftyMaxDD: 0 };
  const firstDate = trades[0].entryDate;
  const lastDate = trades[trades.length - 1].exitDate;
  const niftyStart = niftyCandles.find(c => new Date(c.ts * 1000).toISOString().slice(0, 10) >= firstDate);
  const niftyEnd = [...niftyCandles].reverse().find(c => new Date(c.ts * 1000).toISOString().slice(0, 10) <= lastDate);
  const niftyReturn = niftyStart && niftyEnd && niftyStart.c > 0 ? safe((niftyEnd.c - niftyStart.c) / niftyStart.c * 100) : 0;

  const totalPnl = trades.reduce((s, t) => s + t.pnlNet, 0);
  const strategyReturn = safe(totalPnl / startingCapital * 100);
  const alpha = safe(strategyReturn - niftyReturn);

  // Nifty max DD
  let peak = 0, maxDD = 0;
  for (const c of niftyCandles) {
    if (c.c > peak) peak = c.c;
    const dd = peak > 0 ? (peak - c.c) / peak * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }

  return { niftyReturn: safe(niftyReturn), strategyReturn: safe(strategyReturn), alpha: safe(alpha), niftyMaxDD: safe(maxDD) };
}

// ═══════════════════════════════════════════════════════════════════════════════
// #4: MONTE CARLO SIMULATION
// ═══════════════════════════════════════════════════════════════════════════════

export interface MonteCarloResult {
  median: number;
  p10: number;           // 10th percentile (worst case)
  p90: number;           // 90th percentile (best case)
  ruinProbability: number; // % of runs that hit 30% DD
  distribution: number[]; // final equity of each run
}

export function runMonteCarlo(trades: BacktestTrade[], startingCapital: number, simulations = 500): MonteCarloResult {
  if (trades.length < 5) return { median: startingCapital, p10: startingCapital, p90: startingCapital, ruinProbability: 0, distribution: [] };

  const rMultiples = trades.map(t => t.pnlR);
  const results: number[] = [];
  let ruinCount = 0;

  for (let sim = 0; sim < simulations; sim++) {
    let equity = startingCapital;
    let peak = equity;
    let ruined = false;

    // Shuffle trade order (Fisher-Yates)
    const shuffled = [...rMultiples];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    for (const r of shuffled) {
      const riskAmt = equity * 0.01;
      equity += riskAmt * r;
      if (equity > peak) peak = equity;
      const dd = peak > 0 ? (peak - equity) / peak * 100 : 0;
      if (dd >= 30) { ruined = true; break; }
    }

    results.push(Math.round(equity));
    if (ruined) ruinCount++;
  }

  results.sort((a, b) => a - b);
  return {
    median: results[Math.floor(results.length / 2)],
    p10: results[Math.floor(results.length * 0.1)],
    p90: results[Math.floor(results.length * 0.9)],
    ruinProbability: safe(ruinCount / simulations * 100),
    distribution: results,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// #5: DRAWDOWN ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════════

export interface DrawdownAnalysis {
  maxDDPct: number;
  maxDDDuration: number;    // trades in drawdown
  avgDDPct: number;
  recoveryTrades: number;   // trades to recover from max DD
  underwaterCurve: Array<{ tradeNum: number; ddPct: number }>;
}

export function analyzeDrawdowns(trades: BacktestTrade[], startingCapital: number): DrawdownAnalysis {
  if (trades.length === 0) return { maxDDPct: 0, maxDDDuration: 0, avgDDPct: 0, recoveryTrades: 0, underwaterCurve: [] };

  let equity = startingCapital, peak = equity;
  let maxDD = 0, maxDDStart = 0, maxDDEnd = 0;
  let currentDDStart = 0, inDD = false;
  let equityAtMaxDDEnd = startingCapital;
  let peakAtMaxDD = startingCapital;
  const ddValues: number[] = [];
  const underwaterCurve: DrawdownAnalysis['underwaterCurve'] = [];

  for (let i = 0; i < trades.length; i++) {
    const riskAmt = startingCapital * 0.01;
    equity += riskAmt * trades[i].pnlR;
    if (equity > peak) { peak = equity; inDD = false; }
    const dd = peak > 0 ? (peak - equity) / peak * 100 : 0;
    underwaterCurve.push({ tradeNum: i + 1, ddPct: safe(dd) });
    if (dd > 0) {
      ddValues.push(dd);
      if (!inDD) { currentDDStart = i; inDD = true; }
      if (dd > maxDD) { maxDD = dd; maxDDStart = currentDDStart; maxDDEnd = i; equityAtMaxDDEnd = equity; peakAtMaxDD = peak; }
    }
  }

  const maxDDDuration = maxDDEnd - maxDDStart + 1;
  const avgDDPct = ddValues.length > 0 ? safe(ddValues.reduce((s, v) => s + v, 0) / ddValues.length) : 0;

  // Recovery: how many trades after maxDDEnd to get back to peak at that point
  let recoveryTrades = 0;
  let recEquity = equityAtMaxDDEnd;
  for (let i = maxDDEnd + 1; i < trades.length; i++) {
    recEquity += startingCapital * 0.01 * trades[i].pnlR;
    recoveryTrades++;
    if (recEquity >= peakAtMaxDD) break;
  }

  return { maxDDPct: safe(maxDD), maxDDDuration, avgDDPct, recoveryTrades, underwaterCurve };
}

// ═══════════════════════════════════════════════════════════════════════════════
// #6: WALK-FORWARD VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

export interface WalkForwardResult {
  inSampleWR: number;
  inSampleExp: number;
  outSampleWR: number;
  outSampleExp: number;
  robust: boolean;         // out-of-sample expectancy > 0
  degradation: number;     // % drop in expectancy from in-sample to out-sample
}

export function walkForwardValidation(trades: BacktestTrade[], splitPct = 70): WalkForwardResult {
  if (trades.length < 10) return { inSampleWR: 0, inSampleExp: 0, outSampleWR: 0, outSampleExp: 0, robust: false, degradation: 100 };

  const sorted = [...trades].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  const splitIdx = Math.floor(sorted.length * splitPct / 100);
  const inSample = sorted.slice(0, splitIdx);
  const outSample = sorted.slice(splitIdx);

  const calc = (t: BacktestTrade[]) => {
    const wins = t.filter(x => x.pnlR > 0);
    const wr = t.length > 0 ? wins.length / t.length * 100 : 0;
    const exp = t.length > 0 ? t.reduce((s, x) => s + x.pnlR, 0) / t.length : 0;
    return { wr: safe(wr), exp: safe(exp) };
  };

  const is = calc(inSample);
  const os = calc(outSample);
  const degradation = is.exp > 0 ? safe((1 - os.exp / is.exp) * 100) : 100;

  return {
    inSampleWR: is.wr, inSampleExp: is.exp,
    outSampleWR: os.wr, outSampleExp: os.exp,
    robust: os.exp > 0,
    degradation: safe(Math.max(0, degradation)),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// #7: PARAMETER SENSITIVITY
// ═══════════════════════════════════════════════════════════════════════════════

export interface SensitivityRow {
  param: string;
  value: number;
  trades: number;
  winRate: number;
  expectancy: number;
  profitFactor: number;
}

export function parameterSensitivity(candles: Candle[], symbol: string): SensitivityRow[] {
  const results: SensitivityRow[] = [];
  // Current model uses hybrid clamp — run single backtest and report
  const trades = runBacktest(candles, symbol, 200, 10, 1000000, 1.0);
  if (trades.length >= 3) {
    const wins = trades.filter(t => t.pnlR > 0);
    const losses = trades.filter(t => t.pnlR <= 0);
    const totalWin = wins.reduce((s, t) => s + t.pnlR, 0);
    const totalLoss = losses.reduce((s, t) => s + Math.abs(t.pnlR), 0);
    results.push({
      param: 'Hybrid T1',
      value: 2.15,
      trades: trades.length,
      winRate: safe(wins.length / trades.length * 100),
      expectancy: safe(trades.reduce((s, t) => s + t.pnlR, 0) / trades.length),
      profitFactor: totalLoss > 0 ? safe(totalWin / totalLoss) : totalWin > 0 ? 99 : 0,
    });
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGGREGATE RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

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
  totalCosts: number;
  avgCostPerTrade: number;
  equityCurve: Array<{ tradeNum: number; equity: number; drawdown: number }>;
  monthlyReturns: Array<{ month: string; trades: number; winRate: number; pnlR: number }>;
  // v2 additions
  benchmark: BenchmarkResult | null;
  monteCarlo: MonteCarloResult | null;
  drawdownAnalysis: DrawdownAnalysis;
  walkForward: WalkForwardResult;
  sensitivity: SensitivityRow[];
}

export function aggregateBacktest(
  allTrades: BacktestTrade[],
  niftyCandles?: Candle[],
  startingCapital = 1000000,
): BacktestResult {
  const t = allTrades;
  const empty: BacktestResult = {
    totalSignals: 0, trades: [], wins: 0, losses: 0, winRate: 0, avgWinR: 0, avgLossR: 0,
    expectancyR: 0, profitFactor: 0, maxDrawdownPct: 0, sharpeRatio: 0,
    maxConsecWins: 0, maxConsecLosses: 0, totalCosts: 0, avgCostPerTrade: 0,
    equityCurve: [], monthlyReturns: [],
    benchmark: null, monteCarlo: null,
    drawdownAnalysis: { maxDDPct: 0, maxDDDuration: 0, avgDDPct: 0, recoveryTrades: 0, underwaterCurve: [] },
    walkForward: { inSampleWR: 0, inSampleExp: 0, outSampleWR: 0, outSampleExp: 0, robust: false, degradation: 100 },
    sensitivity: [],
  };
  if (t.length === 0) return empty;

  const wins = t.filter(x => x.pnlR > 0);
  const losses = t.filter(x => x.pnlR <= 0);
  const winRate = t.length > 0 ? wins.length / t.length * 100 : 0;
  const avgWinR = wins.length > 0 ? wins.reduce((s, x) => s + x.pnlR, 0) / wins.length : 0;
  const avgLossR = losses.length > 0 ? losses.reduce((s, x) => s + Math.abs(x.pnlR), 0) / losses.length : 0;
  const expectancyR = t.length > 0 ? t.reduce((s, x) => s + x.pnlR, 0) / t.length : 0;
  const totalWinR = wins.reduce((s, x) => s + x.pnlR, 0);
  const totalLossR = losses.reduce((s, x) => s + Math.abs(x.pnlR), 0);
  const profitFactor = totalLossR > 0 ? safe(totalWinR / totalLossR) : totalWinR > 0 ? 99 : 0;

  // Costs
  const totalCosts = t.reduce((s, x) => s + x.costs.totalCost, 0);
  const avgCostPerTrade = t.length > 0 ? safe(totalCosts / t.length) : 0;

  // Equity curve (1% risk, costs deducted)
  let equity = startingCapital, peak = equity;
  let maxDD = 0;
  const equityCurve: BacktestResult['equityCurve'] = [{ tradeNum: 0, equity, drawdown: 0 }];
  for (let i = 0; i < t.length; i++) {
    equity += t[i].pnlNet;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak * 100 : 0;
    if (dd > maxDD) maxDD = dd;
    equityCurve.push({ tradeNum: i + 1, equity: Math.round(equity), drawdown: safe(dd) });
  }

  // Sharpe
  const rValues = t.map(x => x.pnlR);
  const meanR = rValues.reduce((s, v) => s + v, 0) / rValues.length;
  const sdR = rValues.length > 1 ? Math.sqrt(rValues.reduce((s, v) => s + (v - meanR) ** 2, 0) / (rValues.length - 1)) : 0;
  const sharpeRatio = sdR > 0 ? safe(meanR / sdR * Math.sqrt(Math.min(t.length, 252) / Math.max(1, t.length / 20))) : 0;

  // Streaks
  let cw = 0, cl = 0, mcw = 0, mcl = 0;
  for (const x of t) {
    if (x.pnlR > 0) { cw++; cl = 0; if (cw > mcw) mcw = cw; }
    else { cl++; cw = 0; if (cl > mcl) mcl = cl; }
  }

  // Monthly returns
  const months = new Map<string, BacktestTrade[]>();
  for (const x of t) { const m = x.entryDate.slice(0, 7); if (!months.has(m)) months.set(m, []); months.get(m)!.push(x); }
  const monthlyReturns: BacktestResult['monthlyReturns'] = [];
  for (const [month, mt] of months) {
    const mWins = mt.filter(x => x.pnlR > 0);
    monthlyReturns.push({ month, trades: mt.length, winRate: safe(mWins.length / mt.length * 100), pnlR: safe(mt.reduce((s, x) => s + x.pnlR, 0)) });
  }

  // v2 features
  const benchmark = niftyCandles ? computeBenchmark(niftyCandles, t, startingCapital) : null;
  const monteCarlo = t.length >= 10 ? runMonteCarlo(t, startingCapital) : null;
  const drawdownAnalysis = analyzeDrawdowns(t, startingCapital);
  const walkForward = walkForwardValidation(t);

  return {
    totalSignals: t.length, trades: t, wins: wins.length, losses: losses.length,
    winRate: safe(winRate), avgWinR: safe(avgWinR), avgLossR: safe(avgLossR),
    expectancyR: safe(expectancyR), profitFactor: safe(profitFactor),
    maxDrawdownPct: safe(maxDD), sharpeRatio: safe(sharpeRatio),
    maxConsecWins: mcw, maxConsecLosses: mcl,
    totalCosts: safe(totalCosts), avgCostPerTrade: safe(avgCostPerTrade),
    equityCurve, monthlyReturns,
    benchmark, monteCarlo, drawdownAnalysis, walkForward, sensitivity: [],
  };
}
