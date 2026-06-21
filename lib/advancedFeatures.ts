// ─── Advanced Features Module ────────────────────────────────────────────────
// Features 1-10: RS Ranking, Sector Rotation, Multi-TF, Historical Backtest,
// Correlation Guard, VWAP, Signal Decay, Adaptive Scan, Risk-of-Ruin

interface Candle { ts: number; o: number; h: number; l: number; c: number; v: number; }

function safe(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

// ═══════════════════════════════════════════════════════════════════════════════
// #1: MANSFIELD RELATIVE STRENGTH RANKING
// ═══════════════════════════════════════════════════════════════════════════════

export interface RSRanking {
  rs52w: number;        // Mansfield RS line (stock/nifty ratio smoothed)
  rsRank: number;       // Percentile rank 0-100 among all scanned stocks
  rsSlope: number;      // Slope of RS line (rising/falling)
  rsStatus: 'leader' | 'improving' | 'lagging' | 'declining';
}

export function computeMansfieldRS(stockCandles: Candle[], niftyCandles: Candle[]): Omit<RSRanking, 'rsRank'> {
  if (stockCandles.length < 55 || niftyCandles.length < 55) return { rs52w: 100, rsSlope: 0, rsStatus: 'lagging' };

  const len = Math.min(stockCandles.length, niftyCandles.length);
  const rsLine: number[] = [];
  for (let i = len - 52; i < len; i++) {
    const nC = niftyCandles[niftyCandles.length - len + i]?.c;
    const sC = stockCandles[stockCandles.length - len + i]?.c;
    if (nC > 0 && sC > 0) rsLine.push((sC / nC) * 100);
  }
  if (rsLine.length < 10) return { rs52w: 100, rsSlope: 0, rsStatus: 'lagging' };

  // 52-week SMA of RS line
  const sma = rsLine.reduce((s, v) => s + v, 0) / rsLine.length;
  const current = rsLine[rsLine.length - 1];
  const rs52w = sma > 0 ? safe((current / sma - 1) * 100 + 100) : 100;

  // Slope of last 10 RS values
  const last10 = rsLine.slice(-10);
  let sx = 0, sy = 0, sxy = 0, sx2 = 0;
  for (let i = 0; i < last10.length; i++) { sx += i; sy += last10[i]; sxy += i * last10[i]; sx2 += i * i; }
  const d = last10.length * sx2 - sx * sx;
  const slope = d > 0 ? safe((last10.length * sxy - sx * sy) / d) : 0;
  const avgRS = sy / last10.length;
  const rsSlope = avgRS > 0 ? safe((slope / avgRS) * 100) : 0;

  let rsStatus: RSRanking['rsStatus'];
  if (rs52w > 100 && rsSlope > 0) rsStatus = 'leader';
  else if (rs52w <= 100 && rsSlope > 0) rsStatus = 'improving';
  else if (rs52w > 100 && rsSlope <= 0) rsStatus = 'declining';
  else rsStatus = 'lagging';

  return { rs52w: safe(rs52w), rsSlope: safe(rsSlope), rsStatus };
}

export function rankRS(allRS: Array<{ symbol: string; rs52w: number }>): Map<string, number> {
  const sorted = [...allRS].sort((a, b) => a.rs52w - b.rs52w);
  const ranks = new Map<string, number>();
  sorted.forEach((item, i) => {
    ranks.set(item.symbol, Math.round((i / Math.max(sorted.length - 1, 1)) * 100));
  });
  return ranks;
}

// ═══════════════════════════════════════════════════════════════════════════════
// #2: SECTOR ROTATION HEATMAP
// ═══════════════════════════════════════════════════════════════════════════════

export interface SectorFlow {
  sector: string;
  signalCount: number;
  avgRS: number;
  netMoneyFlow: number;     // sum of volume × close change
  flowLabel: 'inflow' | 'neutral' | 'outflow';
  strength: number;          // 0-100 composite
}

export function computeSectorRotation(
  results: Array<{ symbol: string; stage: string; lastClose: number }>,
  sectorMap: Record<string, string>,
  candleCache: Record<string, Candle[]>,
  rsRanks: Map<string, number>
): SectorFlow[] {
  const sectors = new Map<string, { signals: number; rsSum: number; count: number; moneyFlow: number }>();

  for (const r of results) {
    const sector = sectorMap[r.symbol] || 'Unknown';
    if (!sectors.has(sector)) sectors.set(sector, { signals: 0, rsSum: 0, count: 0, moneyFlow: 0 });
    const s = sectors.get(sector)!;
    s.count++;
    s.rsSum += rsRanks.get(r.symbol) ?? 50;
    if (['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage)) s.signals++;

    const candles = candleCache[r.symbol];
    if (candles && candles.length >= 5) {
      for (let i = candles.length - 5; i < candles.length; i++) {
        s.moneyFlow += candles[i].v * (candles[i].c - candles[i].o);
      }
    }
  }

  const flows: SectorFlow[] = [];
  for (const [sector, data] of sectors) {
    if (data.count < 2) continue;
    const avgRS = data.rsSum / data.count;
    const flowLabel = data.moneyFlow > 0 ? 'inflow' : data.moneyFlow < 0 ? 'outflow' : 'neutral';
    const strength = Math.min(100, Math.round(
      (data.signals / data.count) * 40 +
      (avgRS / 100) * 30 +
      (data.moneyFlow > 0 ? 30 : 0)
    ));
    flows.push({ sector, signalCount: data.signals, avgRS: safe(avgRS), netMoneyFlow: safe(data.moneyFlow), flowLabel, strength });
  }
  return flows.sort((a, b) => b.strength - a.strength);
}

// ═══════════════════════════════════════════════════════════════════════════════
// #3: MULTI-TIMEFRAME CONFIRMATION
// ═══════════════════════════════════════════════════════════════════════════════

export interface TFAlignment {
  dailySignal: boolean;
  weeklyCompression: boolean;
  weeklyBreakout: boolean;
  alignment: 'DW' | 'D' | 'NONE';
}

export function checkWeeklyAlignment(dailyCandles: Candle[]): TFAlignment {
  const none: TFAlignment = { dailySignal: false, weeklyCompression: false, weeklyBreakout: false, alignment: 'NONE' };
  if (dailyCandles.length < 60) return none;

  // Resample daily to weekly
  const weeks: Candle[] = [];
  let wk: Candle | null = null;
  for (const c of dailyCandles) {
    const d = new Date(c.ts * 1000);
    const dow = d.getUTCDay();
    if (dow === 1 || !wk) {
      if (wk) weeks.push(wk);
      wk = { ts: c.ts, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v };
    } else {
      wk.h = Math.max(wk.h, c.h);
      wk.l = Math.min(wk.l, c.l);
      wk.c = c.c;
      wk.v += c.v;
    }
  }
  if (wk) weeks.push(wk);
  if (weeks.length < 12) return none;

  // Check weekly compression: last 6-12 weeks range tightness
  const last12 = weeks.slice(-12);
  const ranges = last12.map(w => w.h > 0 ? (w.h - w.l) / w.h * 100 : 0);
  const avgRange = ranges.reduce((s, v) => s + v, 0) / ranges.length;
  const weeklyCompression = avgRange < 8;

  // Check weekly breakout: last week's close > max high of prior 6 weeks
  const priorHigh = Math.max(...weeks.slice(-7, -1).map(w => w.h));
  const lastWeekClose = weeks[weeks.length - 1].c;
  const weeklyBreakout = lastWeekClose > priorHigh;

  const alignment = weeklyBreakout ? 'DW' : weeklyCompression ? 'D' : 'NONE';
  return { dailySignal: true, weeklyCompression, weeklyBreakout, alignment };
}

// ═══════════════════════════════════════════════════════════════════════════════
// #4: HISTORICAL SIGNAL BACKTEST
// ═══════════════════════════════════════════════════════════════════════════════

export interface HistBacktest {
  priorSignals: number;
  priorHits: number;
  hitRate: number;
  avgDaysToHit: number;
}

export function backtestSignal(candles: Candle[], atr14Arr: number[]): HistBacktest {
  if (candles.length < 60 || atr14Arr.length < 60) return { priorSignals: 0, priorHits: 0, hitRate: 0, avgDaysToHit: 0 };

  let signals = 0, hits = 0, totalDays = 0;
  // Scan backwards looking for compression breakout patterns
  for (let i = 40; i < candles.length - 11; i++) {
    const c = candles[i];
    const atr = atr14Arr[i] || 1;
    const rangeATR = (c.h - c.l) / atr;
    if (rangeATR < 1.0) continue; // not a breakout candle

    // Check if prior 6 candles were compressed
    let compressed = true;
    for (let j = i - 6; j < i; j++) {
      if (j < 0) { compressed = false; break; }
      const pAtr = atr14Arr[j] || 1;
      if ((candles[j].h - candles[j].l) / pAtr > 1.0) { compressed = false; break; }
    }
    if (!compressed) continue;

    // Check if close is in upper half
    if (c.h === c.l) continue;
    const closeLoc = (c.c - c.l) / (c.h - c.l) * 100;
    if (closeLoc < 60) continue;

    signals++;
    // Check next 10 candles for T1 hit (1.5x ATR above entry)
    const entry = c.c * 1.001;
    const target = entry + 1.5 * atr;
    let hit = false;
    for (let k = i + 1; k <= Math.min(i + 10, candles.length - 1); k++) {
      if (candles[k].h >= target) { hit = true; totalDays += k - i; break; }
    }
    if (hit) hits++;
  }

  return {
    priorSignals: signals,
    priorHits: hits,
    hitRate: signals > 0 ? safe((hits / signals) * 100) : 0,
    avgDaysToHit: hits > 0 ? safe(totalDays / hits) : 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// #5: POSITION CORRELATION GUARD
// ═══════════════════════════════════════════════════════════════════════════════

export interface CorrelationResult {
  avgCorrelation: number;
  maxCorrelation: number;
  maxPair: [string, string];
  concentrated: boolean;
  pairs: Array<{ a: string; b: string; corr: number }>;
}

export function computePortfolioCorrelation(
  symbols: string[],
  candleCache: Record<string, Candle[]>,
  period = 20
): CorrelationResult {
  const empty: CorrelationResult = { avgCorrelation: 0, maxCorrelation: 0, maxPair: ['', ''], concentrated: false, pairs: [] };
  if (symbols.length < 2) return empty;

  // Build return arrays
  const returns: Record<string, number[]> = {};
  for (const sym of symbols) {
    const candles = candleCache[sym];
    if (!candles || candles.length < period + 1) continue;
    const ret: number[] = [];
    for (let i = candles.length - period; i < candles.length; i++) {
      if (candles[i - 1].c > 0) ret.push((candles[i].c - candles[i - 1].c) / candles[i - 1].c);
    }
    if (ret.length >= period - 1) returns[sym] = ret;
  }

  const syms = Object.keys(returns);
  if (syms.length < 2) return empty;

  const pairs: CorrelationResult['pairs'] = [];
  let maxCorr = 0, maxPair: [string, string] = [syms[0], syms[1]];

  for (let i = 0; i < syms.length; i++) {
    for (let j = i + 1; j < syms.length; j++) {
      const a = returns[syms[i]], b = returns[syms[j]];
      const n = Math.min(a.length, b.length);
      let mA = 0, mB = 0;
      for (let k = 0; k < n; k++) { mA += a[k]; mB += b[k]; }
      mA /= n; mB /= n;
      let num = 0, dA = 0, dB = 0;
      for (let k = 0; k < n; k++) { num += (a[k] - mA) * (b[k] - mB); dA += (a[k] - mA) ** 2; dB += (b[k] - mB) ** 2; }
      const denom = Math.sqrt(dA * dB);
      const corr = denom > 0 ? safe(num / denom) : 0;
      pairs.push({ a: syms[i], b: syms[j], corr });
      if (Math.abs(corr) > Math.abs(maxCorr)) { maxCorr = corr; maxPair = [syms[i], syms[j]]; }
    }
  }

  const avgCorr = pairs.length > 0 ? pairs.reduce((s, p) => s + Math.abs(p.corr), 0) / pairs.length : 0;
  return { avgCorrelation: safe(avgCorr), maxCorrelation: safe(maxCorr), maxPair, concentrated: avgCorr > 0.7, pairs };
}

// ═══════════════════════════════════════════════════════════════════════════════
// #6: ANCHORED VWAP
// ═══════════════════════════════════════════════════════════════════════════════

export function computeAnchoredVWAP(candles: Candle[], anchorIdx: number): number {
  if (anchorIdx < 0 || anchorIdx >= candles.length) return 0;
  let cumPV = 0, cumV = 0;
  for (let i = anchorIdx; i < candles.length; i++) {
    const typicalPrice = (candles[i].h + candles[i].l + candles[i].c) / 3;
    cumPV += typicalPrice * candles[i].v;
    cumV += candles[i].v;
  }
  return cumV > 0 ? safe(cumPV / cumV) : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// #7: SIGNAL DECAY
// ═══════════════════════════════════════════════════════════════════════════════

export interface SignalDecay {
  ageDays: number;
  decayedConviction: number;
  status: 'fresh' | 'active' | 'aging' | 'stale';
  extended: boolean;       // already moved >1 ATR above entry
  pullback: boolean;       // pulled back to entry zone (second chance)
}

export function computeSignalDecay(
  signalDate: string,
  currentDate: string,
  conviction: number,
  currentPrice: number,
  entryPrice: number,
  atr: number
): SignalDecay {
  const sigTs = new Date(signalDate).getTime();
  const curTs = new Date(currentDate).getTime();
  const ageDays = Math.max(0, Math.round((curTs - sigTs) / 86400000));

  const decayRate = 0.12;
  const decayedConviction = Math.round(Math.max(0, conviction * (1 - decayRate * ageDays)));

  let status: SignalDecay['status'];
  if (ageDays <= 1) status = 'fresh';
  else if (ageDays <= 3) status = 'active';
  else if (ageDays <= 5) status = 'aging';
  else status = 'stale';

  const extended = atr > 0 && currentPrice > entryPrice + atr;
  const pullback = atr > 0 && currentPrice >= entryPrice - 0.5 * atr && currentPrice <= entryPrice + 0.3 * atr;

  return { ageDays, decayedConviction, status, extended, pullback };
}

// ═══════════════════════════════════════════════════════════════════════════════
// #8: ADAPTIVE SCAN SCHEDULE
// ═══════════════════════════════════════════════════════════════════════════════

export function getAdaptiveScanInterval(istHour: number, istMin: number): number {
  const t = istHour * 60 + istMin;
  if (t >= 555 && t <= 585) return 5;    // 9:15-9:45: every 5 min
  if (t >= 585 && t <= 870) return 30;   // 9:45-2:30: every 30 min
  if (t >= 870 && t <= 930) return 10;   // 2:30-3:30: every 10 min
  return 0;                               // outside market: don't scan
}

// ═══════════════════════════════════════════════════════════════════════════════
// #9: RISK OF RUIN CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════════

export interface RiskOfRuin {
  rorPct: number;          // probability of 30% drawdown
  kellyPct: number;        // Kelly criterion optimal size
  halfKellyPct: number;    // Conservative half-Kelly
  maxConsecLosses: number; // max consecutive losses before 30% DD
  safetyRating: 'safe' | 'moderate' | 'dangerous';
}

export function computeRiskOfRuin(winRate: number, avgWinR: number, avgLossR: number, riskPerTrade: number): RiskOfRuin {
  const w = winRate / 100;
  const l = 1 - w;
  if (w <= 0 || l <= 0 || avgLossR <= 0) return { rorPct: 100, kellyPct: 0, halfKellyPct: 0, maxConsecLosses: 0, safetyRating: 'dangerous' };

  // Kelly Criterion: f* = (bp - q) / b where b = avgWin/avgLoss, p = winRate, q = 1-p
  const b = avgWinR / avgLossR;
  const kelly = safe((b * w - l) / b * 100);
  const halfKelly = safe(kelly / 2);

  // Risk of ruin approximation (simplified)
  // RoR = ((1 - edge) / (1 + edge)) ^ (capital_units)
  const edge = w * avgWinR - l * avgLossR;
  const capitalUnits = 30 / riskPerTrade; // units to lose 30%
  let ror: number;
  if (edge <= 0) {
    ror = 100;
  } else {
    const ratio = (1 - edge / avgWinR) / (1 + edge / avgWinR);
    ror = safe(Math.pow(Math.max(0, Math.min(1, ratio)), capitalUnits) * 100);
  }

  const maxConsecLosses = riskPerTrade > 0 ? Math.floor(30 / riskPerTrade) : 0;
  const safetyRating: RiskOfRuin['safetyRating'] = ror < 5 ? 'safe' : ror < 25 ? 'moderate' : 'dangerous';

  return { rorPct: safe(ror), kellyPct: safe(kelly), halfKellyPct: safe(halfKelly), maxConsecLosses, safetyRating };
}

// ═══════════════════════════════════════════════════════════════════════════════
// #10: EARNINGS PROXIMITY (placeholder — needs external data)
// ═══════════════════════════════════════════════════════════════════════════════

export interface EarningsProximity {
  daysToEarnings: number | null;
  warning: boolean;
  message: string;
}

// In absence of a real earnings calendar API, flag stocks that typically report
// quarterly around certain months (rough heuristic for Indian markets)
export function checkEarningsProximity(currentDate: string): EarningsProximity {
  const d = new Date(currentDate);
  const month = d.getMonth(); // 0-indexed
  const day = d.getDate();
  // Indian quarterly earnings: Jan 15-Feb 15, Apr 15-May 15, Jul 15-Aug 15, Oct 15-Nov 15
  const earningsMonths = [0, 1, 3, 4, 6, 7, 9, 10];
  const inEarningsSeason = earningsMonths.includes(month) && day >= 10;
  return {
    daysToEarnings: null,
    warning: inEarningsSeason,
    message: inEarningsSeason ? 'Earnings season — verify before entry' : '',
  };
}
