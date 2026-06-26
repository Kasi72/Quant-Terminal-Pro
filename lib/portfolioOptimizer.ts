// ─── Portfolio Optimizer (Markowitz-Inspired) ────────────────────────────────
// Given N BUY signals, selects the optimal subset maximizing diversification

interface Candle { ts: number; o: number; h: number; l: number; c: number; v: number; }

function safe(v: number, f = 0): number { return Number.isFinite(v) ? v : f; }

export interface PortfolioStock {
  symbol: string;
  sector: string;
  weight: number;         // 0-100%
  conviction: number;
  rewardRisk: number;
  rsRank: number;
  correlation: number;    // avg correlation with other selected stocks
  grade: 'A' | 'B' | 'C';
  reason: string;
}

export interface PortfolioResult {
  selected: PortfolioStock[];
  skipped: Array<{ symbol: string; reason: string }>;
  portfolioCorrelation: number;
  expectedRR: number;
  diversificationScore: number;   // 0-100
  capitalAllocation: Array<{ symbol: string; shares: number; capital: number; risk: number }>;
}

export function optimizePortfolio(
  signals: Array<{
    symbol: string;
    sector: string;
    conviction: number;
    rewardRisk: number;
    rsRank: number;
    entryPrice: number;
    stopLoss: number;
    tradeValid: boolean;
  }>,
  candleCache: Record<string, Candle[]>,
  accountSize: number,
  maxPositions = 5,
  riskPerTrade = 1.0,
): PortfolioResult {
  const empty: PortfolioResult = { selected: [], skipped: [], portfolioCorrelation: 0, expectedRR: 0, diversificationScore: 0, capitalAllocation: [] };
  const valid = signals.filter(s => s.tradeValid && s.entryPrice > 0 && s.stopLoss > 0 && s.entryPrice > s.stopLoss);
  if (valid.length === 0) return empty;

  // Step 1: Compute pairwise correlations
  const corrMatrix = new Map<string, Map<string, number>>();
  const returns: Record<string, number[]> = {};
  for (const s of valid) {
    const candles = candleCache[s.symbol];
    if (!candles || candles.length < 21) continue;
    const ret: number[] = [];
    for (let i = candles.length - 20; i < candles.length; i++) {
      if (candles[i - 1].c > 0) ret.push((candles[i].c - candles[i - 1].c) / candles[i - 1].c);
    }
    if (ret.length >= 15) returns[s.symbol] = ret;
  }

  const symsWithReturns = Object.keys(returns);
  for (let i = 0; i < symsWithReturns.length; i++) {
    if (!corrMatrix.has(symsWithReturns[i])) corrMatrix.set(symsWithReturns[i], new Map());
    for (let j = i + 1; j < symsWithReturns.length; j++) {
      if (!corrMatrix.has(symsWithReturns[j])) corrMatrix.set(symsWithReturns[j], new Map());
      const a = returns[symsWithReturns[i]], b = returns[symsWithReturns[j]];
      const n = Math.min(a.length, b.length);
      let mA = 0, mB = 0;
      for (let k = 0; k < n; k++) { mA += a[k]; mB += b[k]; }
      mA /= n; mB /= n;
      let num = 0, dA = 0, dB = 0;
      for (let k = 0; k < n; k++) { num += (a[k] - mA) * (b[k] - mB); dA += (a[k] - mA) ** 2; dB += (b[k] - mB) ** 2; }
      const den = Math.sqrt(dA * dB);
      const corr = den > 0 ? safe(num / den) : 0;
      corrMatrix.get(symsWithReturns[i])!.set(symsWithReturns[j], corr);
      corrMatrix.get(symsWithReturns[j])!.set(symsWithReturns[i], corr);
    }
  }

  // Step 2: Score each signal — composite of conviction, R:R, RS rank
  const scored = valid.map(s => ({
    ...s,
    score: safe(s.conviction * 0.4 + s.rewardRisk * 15 + s.rsRank * 0.3),
  })).sort((a, b) => b.score - a.score);

  // Step 3: Greedy selection — pick best score, then skip correlated stocks
  const selected: typeof scored = [];
  const skipped: Array<{ symbol: string; reason: string }> = [];

  for (const candidate of scored) {
    if (selected.length >= maxPositions) {
      skipped.push({ symbol: candidate.symbol, reason: `Max ${maxPositions} positions reached` });
      continue;
    }

    // Check correlation with already selected
    let tooCorrelated = false;
    let highCorrWith = '';
    for (const sel of selected) {
      const corr = corrMatrix.get(candidate.symbol)?.get(sel.symbol) ?? 0;
      if (Math.abs(corr) > 0.70) {
        tooCorrelated = true;
        highCorrWith = sel.symbol;
        break;
      }
    }

    // Check sector concentration
    const sectorCount = selected.filter(s => s.sector === candidate.sector).length;
    if (sectorCount >= 2) {
      skipped.push({ symbol: candidate.symbol, reason: `Sector ${candidate.sector} already has 2 positions` });
      continue;
    }

    if (tooCorrelated) {
      skipped.push({ symbol: candidate.symbol, reason: `Correlated ${(corrMatrix.get(candidate.symbol)?.get(highCorrWith) ?? 0).toFixed(2)} with ${highCorrWith.replace('.NS', '')}` });
      continue;
    }

    selected.push(candidate);
  }

  // Step 4: Compute weights (equal risk, adjusted by conviction)
  const totalConv = selected.reduce((s, x) => s + x.conviction, 0) || 1;
  const portfolioStocks: PortfolioStock[] = selected.map(s => {
    const weight = safe((s.conviction / totalConv) * 100);
    const avgCorr = selected.length > 1
      ? selected.filter(x => x.symbol !== s.symbol).reduce((sum, x) => sum + Math.abs(corrMatrix.get(s.symbol)?.get(x.symbol) ?? 0), 0) / (selected.length - 1)
      : 0;
    const grade = s.rewardRisk >= 0.9 && s.rsRank >= 60 ? 'A' : s.rewardRisk >= 0.5 ? 'B' : 'C';
    const reasons: string[] = [];
    if (grade === 'A') reasons.push('Strong R:R + RS leader');
    if (grade === 'B') reasons.push('Acceptable setup');
    if (grade === 'C') reasons.push('Marginal — consider half-size');
    return {
      symbol: s.symbol, sector: s.sector, weight: safe(weight), conviction: s.conviction,
      rewardRisk: s.rewardRisk, rsRank: s.rsRank, correlation: safe(avgCorr), grade,
      reason: reasons.join(', '),
    };
  });

  // Step 5: Portfolio-level metrics
  let totalCorr = 0, pairCount = 0;
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      totalCorr += Math.abs(corrMatrix.get(selected[i].symbol)?.get(selected[j].symbol) ?? 0);
      pairCount++;
    }
  }
  const portfolioCorrelation = pairCount > 0 ? safe(totalCorr / pairCount) : 0;
  const diversificationScore = Math.round(Math.max(0, Math.min(100, (1 - portfolioCorrelation) * 100)));
  const expectedRR = selected.length > 0 ? safe(selected.reduce((s, x) => s + x.rewardRisk, 0) / selected.length) : 0;

  // Step 6: Capital allocation
  const capitalAllocation = selected.map(s => {
    const rps = s.entryPrice - s.stopLoss;
    const riskAmt = accountSize * (riskPerTrade / 100);
    const shares = rps > 0 ? Math.floor(riskAmt / rps) : 0;
    const capital = shares * s.entryPrice;
    return { symbol: s.symbol, shares, capital: Math.round(capital), risk: Math.round(shares * rps) };
  });

  // Remaining signals skipped for ranking
  for (const s of scored) {
    if (!selected.find(x => x.symbol === s.symbol) && !skipped.find(x => x.symbol === s.symbol)) {
      skipped.push({ symbol: s.symbol, reason: 'Lower score' });
    }
  }

  return { selected: portfolioStocks, skipped, portfolioCorrelation, expectedRR, diversificationScore, capitalAllocation };
}
