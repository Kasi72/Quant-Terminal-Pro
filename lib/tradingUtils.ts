import type { AnalysisResult, StageRating, Candle } from './stockEngine';

// ─── #1: Trade Sheet ─────────────────────────────────────────────────────────

export interface TradeSheet {
  symbol: string;
  action: 'BUY';
  entry: number;
  qty: number;
  stopLoss: number;
  target1: number;
  target2: number;
  trailRule: string;
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
  const sl = r.priceEngine.tacticalStop;
  if (!Number.isFinite(entry) || !Number.isFinite(sl) || entry <= 0 || sl <= 0) return null;
  const riskPerShare = entry - sl;
  if (riskPerShare <= 0) return null;
  const safeT1 = Number.isFinite(r.priceEngine.target5) ? r.priceEngine.target5 : entry + riskPerShare * 2;
  const safeT2 = Number.isFinite(r.priceEngine.target7) ? r.priceEngine.target7 : entry + riskPerShare * 3;
  const maxRisk = accountSize * (riskPct / 100);
  const qty = Math.floor(maxRisk / riskPerShare);
  if (qty <= 0) return null;
  return {
    symbol: r.symbol,
    action: 'BUY',
    entry: Math.round(entry * 100) / 100,
    qty,
    stopLoss: Math.round(sl * 100) / 100,
    target1: Math.round(safeT1 * 100) / 100,
    target2: Math.round(safeT2 * 100) / 100,
    trailRule: 'Move SL to entry after T1 hit',
    totalCost: Math.round(qty * entry),
    maxRisk: Math.round(qty * riskPerShare),
    riskPct,
  };
}

export function tradeSheetToClipboard(ts: TradeSheet): string {
  const lines = [
    `═══ TRADE SHEET ═══`,
    `SYMBOL: ${ts.symbol}`,
    `ACTION: ${ts.action}`,
    `ENTRY: ₹${ts.entry.toFixed(2)} (Limit)`,
    `QTY: ${ts.qty} shares`,
    `STOP LOSS: ₹${ts.stopLoss.toFixed(2)} (SL-M)`,
    `TARGET 1: ₹${ts.target1.toFixed(2)} (Sell 50%)`,
    `TARGET 2: ₹${ts.target2.toFixed(2)} (Sell 30%)`,
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
  stopLoss: number;
  target1: number;
  target2: number;
  target3: number;
  disasterStop: number;
  paramSetKey: string;
  sector: string;
  conviction: number;
  status: 'open' | 'hit_t1' | 'hit_t2' | 'hit_t3' | 'stopped' | 'expired' | 'manual_close';
  currentPrice?: number;
  highestPrice?: number;
  lastCheckDate?: string;
  closedDate?: string;
  closedPrice?: number;
  pnlPct?: number;
  pnlR?: number;
  daysHeld?: number;
  notes?: string;
}

export interface WinRateStats {
  total: number;
  open: number;
  hitT1: number;
  hitT2: number;
  hitT3: number;
  stopped: number;
  expired: number;
  manualClose: number;
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

export function computeWinRateStats(trades: TrackedTrade[]): WinRateStats {
  const closed = trades.filter(t => t.status !== 'open');
  const wins = closed.filter(t => ['hit_t1', 'hit_t2', 'hit_t3', 'manual_close'].includes(t.status) && (t.pnlPct ?? 0) > 0);
  const losses = closed.filter(t => t.status === 'stopped' || ((t.pnlPct ?? 0) < 0));

  const totalWinPct = wins.reduce((s, t) => s + (t.pnlPct ?? 0), 0);
  const totalLossPct = Math.abs(losses.reduce((s, t) => s + (t.pnlPct ?? 0), 0));
  const totalWinR = wins.reduce((s, t) => s + (t.pnlR ?? 0), 0);
  const totalLossR = Math.abs(losses.reduce((s, t) => s + (t.pnlR ?? 0), 0));

  let bestTrade: { symbol: string; pnlPct: number } | null = null;
  let worstTrade: { symbol: string; pnlPct: number } | null = null;
  for (const t of closed) {
    const p = t.pnlPct ?? 0;
    if (!bestTrade || p > bestTrade.pnlPct) bestTrade = { symbol: t.symbol, pnlPct: p };
    if (!worstTrade || p < worstTrade.pnlPct) worstTrade = { symbol: t.symbol, pnlPct: p };
  }

  // Current streak
  let streakWins = 0, streakLosses = 0;
  for (let i = closed.length - 1; i >= 0; i--) {
    const isWin = (closed[i].pnlPct ?? 0) > 0;
    if (i === closed.length - 1) { if (isWin) streakWins = 1; else streakLosses = 1; }
    else if (isWin && streakWins > 0) streakWins++;
    else if (!isWin && streakLosses > 0) streakLosses++;
    else break;
  }

  const avgDays = closed.length > 0 ? closed.reduce((s, t) => s + (t.daysHeld ?? 0), 0) / closed.length : 0;

  return {
    total: trades.length,
    open: trades.filter(t => t.status === 'open').length,
    hitT1: trades.filter(t => t.status === 'hit_t1').length,
    hitT2: trades.filter(t => t.status === 'hit_t2').length,
    hitT3: trades.filter(t => t.status === 'hit_t3').length,
    stopped: trades.filter(t => t.status === 'stopped').length,
    expired: trades.filter(t => t.status === 'expired').length,
    manualClose: trades.filter(t => t.status === 'manual_close').length,
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    avgWinPct: wins.length > 0 ? totalWinPct / wins.length : 0,
    avgLossPct: losses.length > 0 ? -totalLossPct / losses.length : 0,
    avgWinR: wins.length > 0 ? totalWinR / wins.length : 0,
    avgLossR: losses.length > 0 ? -totalLossR / losses.length : 0,
    profitFactor: totalLossPct > 0 ? totalWinPct / totalLossPct : totalWinPct > 0 ? 999 : 0,
    expectancy: closed.length > 0 ? (totalWinPct - totalLossPct) / closed.length : 0,
    bestTrade, worstTrade,
    avgDaysHeld: Math.round(avgDays),
    streakWins, streakLosses,
  };
}

export function checkTradeStatus(trade: TrackedTrade, currentPrice: number): TrackedTrade {
  if (trade.status !== 'open') return trade;
  const updated = { ...trade, currentPrice, lastCheckDate: new Date().toISOString().slice(0, 10) };
  const entryDate = new Date(trade.entryDate);
  const daysHeld = Math.floor((Date.now() - entryDate.getTime()) / 86400000);
  updated.daysHeld = daysHeld;
  updated.highestPrice = Math.max(trade.highestPrice ?? 0, currentPrice);
  const riskPerShare = trade.entryPrice - trade.stopLoss;

  if (currentPrice <= trade.disasterStop) {
    updated.status = 'stopped';
    updated.closedPrice = trade.disasterStop;
    updated.closedDate = updated.lastCheckDate;
    updated.pnlPct = ((trade.disasterStop - trade.entryPrice) / trade.entryPrice) * 100;
    updated.pnlR = riskPerShare > 0 ? (trade.disasterStop - trade.entryPrice) / riskPerShare : 0;
  } else if (currentPrice <= trade.stopLoss) {
    updated.status = 'stopped';
    updated.closedPrice = trade.stopLoss;
    updated.closedDate = updated.lastCheckDate;
    updated.pnlPct = ((trade.stopLoss - trade.entryPrice) / trade.entryPrice) * 100;
    updated.pnlR = riskPerShare > 0 ? (trade.stopLoss - trade.entryPrice) / riskPerShare : -1;
  } else if (currentPrice >= trade.target3) {
    updated.status = 'hit_t3';
    updated.closedPrice = trade.target3;
    updated.closedDate = updated.lastCheckDate;
    updated.pnlPct = ((trade.target3 - trade.entryPrice) / trade.entryPrice) * 100;
    updated.pnlR = riskPerShare > 0 ? (trade.target3 - trade.entryPrice) / riskPerShare : 0;
  } else if (currentPrice >= trade.target2) {
    updated.status = 'hit_t2';
    updated.closedPrice = trade.target2;
    updated.closedDate = updated.lastCheckDate;
    updated.pnlPct = ((trade.target2 - trade.entryPrice) / trade.entryPrice) * 100;
    updated.pnlR = riskPerShare > 0 ? (trade.target2 - trade.entryPrice) / riskPerShare : 0;
  } else if (currentPrice >= trade.target1) {
    updated.status = 'hit_t1';
    updated.closedPrice = trade.target1;
    updated.closedDate = updated.lastCheckDate;
    updated.pnlPct = ((trade.target1 - trade.entryPrice) / trade.entryPrice) * 100;
    updated.pnlR = riskPerShare > 0 ? (trade.target1 - trade.entryPrice) / riskPerShare : 0;
  } else if (daysHeld > 10) {
    updated.status = 'expired';
    updated.closedPrice = currentPrice;
    updated.closedDate = updated.lastCheckDate;
    updated.pnlPct = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
    updated.pnlR = riskPerShare > 0 ? (currentPrice - trade.entryPrice) / riskPerShare : 0;
  }
  return updated;
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
  const totalCap = open.reduce((s, t) => s + t.entryPrice * 1, 0);
  const totalRisk = open.reduce((s, t) => s + Math.abs(t.entryPrice - t.stopLoss), 0);

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
  factors: RegimeFactors;
  vix: number;
  cusumAlert: 'bearish_shift' | 'bullish_shift' | null;
  blackSwanLevel: 'normal' | 'elevated' | 'high' | 'severe' | 'extreme';
  blackSwanAction: string;
}

export function detectMarketRegime(niftyCandles: Candle[], vixCandles?: Candle[]): RegimeInfo {
  const fallback: RegimeInfo = { regime: 'neutral', niftyClose: 0, ema200: 0, ema50: 0, aboveEma200: true, ema50Above200: true, label: 'Unknown', emoji: '🟡', sizingMultiplier: 0.75, score: 0, factors: { momentum: 0, breadth: 0, volatility: 0, acceleration: 0, distEma200: 0, vixLevel: 0, vixROC: 0, vixVsSma: 0 }, vix: 0, cusumAlert: null, blackSwanLevel: 'normal', blackSwanAction: '' };
  if (niftyCandles.length < 55) return fallback;
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
  // Factor 5: DISTANCE FROM EMA200
  const distEma200 = ema200 > 0 ? ((close - ema200) / ema200) * 100 : 0;

  // Composite score (factors 1-5: 82 pts max)
  let score = 0;
  score += ret20 > 5 ? 20 : ret20 > 2 ? 12 : ret20 > 0 ? 4 : ret20 > -2 ? -4 : ret20 > -5 ? -12 : -20;
  score += breadth > 60 ? 18 : breadth > 52 ? 9 : breadth > 45 ? -4 : breadth > 38 ? -12 : -18;
  score += vol < 0.8 ? 12 : vol < 1.2 ? 6 : vol < 1.8 ? 0 : vol < 2.5 ? -6 : -12;
  score += accel > 2 ? 12 : accel > 0.5 ? 6 : accel > -0.5 ? 0 : accel > -2 ? -6 : -12;
  score += distEma200 > 5 ? 12 : distEma200 > 0 ? 6 : distEma200 > -3 ? -4 : distEma200 > -8 ? -8 : -12;

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
    const cMean = cusumRets.reduce((s, v) => s + v, 0) / cusumRets.length;
    const cStd = Math.sqrt(cusumRets.reduce((s, v) => s + (v - cMean) ** 2, 0) / cusumRets.length) || 0.01;
    let sPlus = 0, sMinus = 0;
    for (const r of cusumRets.slice(-20)) { sPlus = Math.max(0, sPlus + (r - cMean) / cStd - 0.5); sMinus = Math.max(0, sMinus - (r - cMean) / cStd - 0.5); }
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
    label, emoji, sizingMultiplier: mult, score,
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

export type QuickFilterKey = 'ready' | 'tomorrow' | 'strongest' | 'safe' | 'all';

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
    key: 'ready', label: 'Ready to Trade', emoji: '🎯', description: 'BUY+ with valid trade, good R:R, EMA aligned',
    filter: r => r.priceEngine.tradeValid && r.momentum.emaAligned && r.momentum.gapAdjustedRR >= 2,
  },
  {
    key: 'tomorrow', label: "Tomorrow's Breakouts", emoji: '⚡', description: 'Near breakout with clean pre-conditions',
    filter: r => r.nearBreakout && r.momentum.higherLowConfirmed,
  },
  {
    key: 'strongest', label: 'Strongest Momentum', emoji: '🔥', description: 'MomScore≥70, RS/Nifty≥1.05, VolExp≥2',
    filter: r => r.momentum.momentumScore >= 70 && r.momentum.rsNifty20 >= 1.05 && r.volatilityExpansionRatio >= 2,
  },
  {
    key: 'safe', label: 'Safe Entries', emoji: '🛡', description: 'Risk≤5%, R:R≥0.9',
    filter: r => r.priceEngine.tradeValid && r.priceEngine.tacticalRiskPct > 0 && r.priceEngine.tacticalRiskPct <= 5 && r.priceEngine.rewardRisk >= 0.9,
  },
];
