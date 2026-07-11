export interface Candle {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

async function yfFetchOne(sym: string): Promise<{ ok: boolean; res?: Response; err?: string }> {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y&includePrePost=false`;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const r = await fetch(`https://${host}${path}`, {
        headers: YF_HEADERS,
        signal: AbortSignal.timeout(15000),
      });
      if (r.status === 200) return { ok: true, res: r };
      if (r.status === 404) return { ok: false, err: `Symbol not found: ${sym}` };
      // 429/503 → try next host
    } catch {
      // network error → try next host
    }
  }
  return { ok: false, err: `Yahoo Finance unreachable for ${sym}` };
}

export async function fetchOHLCV(rawSymbol: string): Promise<{ candles: Candle[]; resolvedSymbol: string }> {
  // Try the symbol as-is first, then with .NS suffix for bare NSE tickers
  const candidates = rawSymbol.includes('.')
    ? [rawSymbol]
    : [rawSymbol, `${rawSymbol}.NS`, `${rawSymbol}.BO`];

  let lastErr = '';
  for (const sym of candidates) {
    const { ok, res, err } = await yfFetchOne(sym);
    if (!ok) { lastErr = err!; continue; }
    const json = await res!.json();
    const result = json?.chart?.result?.[0];
    if (!result) {
      lastErr = json?.chart?.error?.description ?? `No data for ${sym}`;
      continue;
    }

    const quotes = result.indicators.quote[0];
    const timestamps: number[] = result.timestamp;
    const candles: Candle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = quotes.close[i], h = quotes.high[i], l = quotes.low[i], v = quotes.volume[i];
      if (c != null && h != null && l != null && v != null && h > 0) {
        candles.push({ ts: timestamps[i], o: quotes.open[i] ?? c, h, l, c, v });
      }
    }
    return { candles, resolvedSymbol: sym };
  }
  throw new Error(lastErr || `No data for ${rawSymbol}`);
}

function computeATR14(candles: Candle[]): number[] {
  const atr = new Array<number>(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c),
    );
    if (i < 14) {
      atr[i] = tr;
    } else if (i === 14) {
      let sum = 0;
      for (let j = 1; j <= 14; j++) {
        sum += Math.max(
          candles[j].h - candles[j].l,
          Math.abs(candles[j].h - candles[j - 1].c),
          Math.abs(candles[j].l - candles[j - 1].c),
        );
      }
      atr[i] = sum / 14;
    } else {
      atr[i] = (atr[i - 1] * 13 + tr) / 14;
    }
  }
  return atr;
}

function computeRSI2(candles: Candle[]): number {
  const n = candles.length;
  if (n < 3) return 50;
  const g1 = Math.max(0, candles[n - 1].c - candles[n - 2].c);
  const l1 = Math.max(0, candles[n - 2].c - candles[n - 1].c);
  const g0 = Math.max(0, candles[n - 2].c - candles[n - 3].c);
  const l0 = Math.max(0, candles[n - 3].c - candles[n - 2].c);
  const avgG = (g0 + g1) / 2;
  const avgL = (l0 + l1) / 2;
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function percentileRank(arr: number[], value: number): number {
  const below = arr.filter((v) => v < value).length;
  return arr.length ? (below / arr.length) * 100 : 50;
}

export interface ComputedParams {
  last_close: number;
  last_date: string;
  avg_turnover_20: number;
  atr_pct14_pctl120: number;
  pre10_avg_range_atr: number;
  pre10_expansion_count: number;
  compression_zone_len: number;
  zone_tightness_pct: number;
  pre10_avg_vol_ratio: number;
  pre5_avg_vol_ratio: number;
  pre10_high_vol_count: number;
  pre10_red_vol_bias: number;
  exact_range_atr: number;
  exact_vol_ratio20: number;
  exact_vol_vs_pre5: number;
  close_loc: number;
  upper_wick_pct: number;
  body_pct: number;
  signal_range_pct: number;
  ultra_precision_score: number;
  rsi2: number;
  volatility_expansion_ratio: number;
  candle_quality_score: number;
  passed_deployable: boolean;
  passed_high_precision: boolean;
  passed_elite: boolean;
  passed_ultra_selective: boolean;
  passed_ors_prime: boolean;
  ors_score: number;
  ors_dd_from_swing_high: number;
  ors_dist_ema20: number;
  ors_confirmed: boolean;
  clusters_passed: number;
}

export function computeParams(candles: Candle[]): ComputedParams {
  if (candles.length < 50) throw new Error('Insufficient data (need 50+ candles)');

  const atr14 = computeATR14(candles);
  const n = candles.length;

  const sigIdx = n - 1;
  const pre10Start = n - 11;
  const pre10End = n - 2;
  const pre5Start = n - 6;

  const sig = candles[sigIdx];
  const sigATR = Math.max(atr14[sigIdx], 0.0001);

  // ATR percentile over last 120 candles
  const atrPctHistory: number[] = [];
  for (let i = Math.max(1, n - 121); i < n - 1; i++) {
    atrPctHistory.push((atr14[i] / candles[i].c) * 100);
  }
  const atrPct14Current = (sigATR / sig.c) * 100;
  const atr_pct14_pctl120 = percentileRank(atrPctHistory, atrPct14Current);

  // avgTurnover20
  const avg_turnover_20 = mean(candles.slice(n - 20).map((c) => c.c * c.v));

  // RangeATR for all candles
  const rangeATR = candles.map((c, i) => atr14[i] > 0 ? (c.h - c.l) / atr14[i] : 0);

  // volRatio20
  const volRatio20 = new Array<number>(n).fill(1);
  for (let i = 20; i < n; i++) {
    const avg = mean(candles.slice(i - 20, i).map((c) => c.v));
    volRatio20[i] = avg > 0 ? candles[i].v / avg : 1;
  }

  // Pre-10 / pre-5 windows
  const pre10Range = rangeATR.slice(pre10Start, pre10End + 1);
  const pre10Vol   = volRatio20.slice(pre10Start, pre10End + 1);
  const pre5Vol    = volRatio20.slice(pre5Start, pre10End + 1);
  const pre10Candles = candles.slice(pre10Start, pre10End + 1);

  const pre10_avg_range_atr   = mean(pre10Range);
  const pre10_expansion_count = pre10Range.filter((r) => r > 1.1).length;
  const pre10_avg_vol_ratio   = mean(pre10Vol);
  const pre5_avg_vol_ratio    = mean(pre5Vol);
  const pre10_high_vol_count  = pre10Vol.filter((v) => v > 1.35).length;
  const redVols = pre10Candles.filter((c) => c.c < c.o).map((c) => c.v);
  const pre10VolAvg = mean(pre10Candles.map((c) => c.v));
  const pre10_red_vol_bias = redVols.length > 0 && pre10VolAvg > 0
    ? mean(redVols) / pre10VolAvg : 0;

  // Compression zone — scan backward from pre10Start
  let zoneStart = pre10End;
  let zoneLen = 0;
  for (let i = pre10End; i >= Math.max(0, n - 30); i--) {
    if (rangeATR[i] <= 1.0) { zoneStart = i; zoneLen++; }
    else break;
  }

  let compression_zone_len = 0;
  let zone_tightness_pct = 100;

  if (zoneLen >= 6) {
    const zoneCandles = candles.slice(zoneStart, pre10End + 1);
    const zoneHigh = Math.max(...zoneCandles.map((c) => c.h));
    const zoneLow  = Math.min(...zoneCandles.map((c) => c.l));
    zone_tightness_pct = ((zoneHigh - zoneLow) / zoneLow) * 100;
    if (sig.c > zoneHigh * 1.001) {
      compression_zone_len = zoneLen;
    }
  }

  // Signal candle metrics
  const sigRange  = Math.max(sig.h - sig.l, 0.0001);
  const exact_range_atr    = sigRange / sigATR;
  const vol20avg           = mean(candles.slice(n - 21, n - 1).map((c) => c.v));
  const exact_vol_ratio20  = vol20avg > 0 ? sig.v / vol20avg : 1;
  const pre5VolAvg         = mean(candles.slice(pre5Start, pre10End + 1).map((c) => c.v));
  const exact_vol_vs_pre5  = pre5VolAvg > 0 ? sig.v / pre5VolAvg : 1;
  const close_loc          = ((sig.c - sig.l) / sigRange) * 100;
  const upper_wick_pct     = ((sig.h - Math.max(sig.o, sig.c)) / sigRange) * 100;
  const body_pct           = (Math.abs(sig.c - sig.o) / sigRange) * 100;
  const signal_range_pct   = (sigRange / sig.c) * 100;
  const rsi2               = computeRSI2(candles.slice(-10));
  const volatility_expansion_ratio = pre10_avg_range_atr > 0
    ? exact_range_atr / pre10_avg_range_atr : 0;

  // UltraPrecisionScore (0–100)
  let ultra_precision_score = 0;
  ultra_precision_score += close_loc >= 80 ? 20 : close_loc >= 65 ? 12 : 0;
  ultra_precision_score += upper_wick_pct <= 20 ? 20 : upper_wick_pct <= 35 ? 12 : 0;
  ultra_precision_score += body_pct >= 55 ? 15 : body_pct >= 35 ? 9 : 0;
  ultra_precision_score += exact_vol_vs_pre5 >= 4 ? 20 : exact_vol_vs_pre5 >= 2 ? 12 : 0;
  ultra_precision_score += zone_tightness_pct <= 5 ? 15 : zone_tightness_pct <= 15 ? 9 : 0;
  ultra_precision_score += compression_zone_len >= 12 ? 10 : compression_zone_len >= 6 ? 6 : 0;

  // CandleQualityScore_v8 (0–5)
  let candle_quality_score = 0;
  if (close_loc >= 65) candle_quality_score++;
  if (upper_wick_pct <= 30) candle_quality_score++;
  if (body_pct >= 40) candle_quality_score++;
  if (exact_vol_vs_pre5 >= 2.5) candle_quality_score++;
  if (volatility_expansion_ratio >= 1.5) candle_quality_score++;

  const last_date = new Date(sig.ts * 1000).toISOString().slice(0, 10);

  // ── Cluster filters ─────────────────────────────────────────────────────────
  const CRORE = 10_000_000;
  const p = {
    avg_turnover_20, atr_pct14_pctl120, pre10_avg_range_atr, pre10_expansion_count,
    compression_zone_len, zone_tightness_pct, pre10_avg_vol_ratio, pre5_avg_vol_ratio,
    pre10_high_vol_count, pre10_red_vol_bias, exact_range_atr, exact_vol_ratio20,
    exact_vol_vs_pre5, close_loc, upper_wick_pct, body_pct, signal_range_pct,
    ultra_precision_score, rsi2, volatility_expansion_ratio, candle_quality_score,
  };

  const passed_deployable = (
    p.avg_turnover_20 >= 1 * CRORE && p.atr_pct14_pctl120 <= 75 &&
    p.pre10_avg_range_atr <= 0.75 && p.pre10_expansion_count <= 2 &&
    p.compression_zone_len >= 6 && p.compression_zone_len <= 20 &&
    p.pre10_avg_vol_ratio <= 0.90 && p.pre5_avg_vol_ratio <= 0.90 &&
    p.pre10_high_vol_count <= 4 && p.pre10_red_vol_bias <= 1.10 &&
    p.zone_tightness_pct <= 15 &&
    p.exact_range_atr >= 1.0 && p.exact_range_atr <= 5.0 &&
    p.exact_vol_ratio20 >= 1.00 && p.exact_vol_vs_pre5 >= 2.00 &&
    p.close_loc >= 65 && p.upper_wick_pct <= 35 && p.body_pct >= 35 &&
    p.signal_range_pct <= 8.5 && p.ultra_precision_score >= 55 &&
    p.rsi2 >= 50 && p.volatility_expansion_ratio >= 1.50 && p.candle_quality_score >= 3
  );

  const passed_high_precision = (
    p.avg_turnover_20 >= 1 * CRORE && p.atr_pct14_pctl120 <= 75 &&
    p.pre10_avg_range_atr <= 0.75 && p.pre10_expansion_count <= 0 &&
    p.compression_zone_len >= 6 && p.compression_zone_len <= 25 &&
    p.pre10_avg_vol_ratio <= 0.90 && p.pre5_avg_vol_ratio <= 1.10 &&
    p.pre10_high_vol_count <= 4 && p.pre10_red_vol_bias <= 1.10 &&
    p.zone_tightness_pct <= 15 &&
    p.exact_range_atr >= 1.0 && p.exact_range_atr <= 5.0 &&
    p.exact_vol_ratio20 >= 1.10 && p.exact_vol_vs_pre5 >= 2.00 &&
    p.close_loc >= 65 && p.upper_wick_pct <= 35 && p.body_pct >= 25 &&
    p.signal_range_pct <= 11.0 && p.ultra_precision_score >= 45 && p.rsi2 >= 50
  );

  const passed_elite = (
    p.avg_turnover_20 >= 2 * CRORE && p.atr_pct14_pctl120 <= 60 &&
    p.pre10_avg_range_atr <= 0.95 && p.pre10_expansion_count <= 4 &&
    p.compression_zone_len >= 8 && p.compression_zone_len <= 15 &&
    p.pre10_avg_vol_ratio <= 0.85 && p.pre5_avg_vol_ratio <= 0.90 &&
    p.pre10_high_vol_count <= 2 && p.pre10_red_vol_bias <= 1.20 &&
    p.zone_tightness_pct <= 12 &&
    p.exact_range_atr >= 1.0 && p.exact_range_atr <= 6.0 &&
    p.exact_vol_ratio20 >= 1.00 && p.exact_vol_vs_pre5 >= 3.00 &&
    p.close_loc >= 65 && p.upper_wick_pct <= 35 && p.body_pct >= 35 &&
    p.signal_range_pct <= 8.5 && p.ultra_precision_score >= 45 &&
    p.rsi2 >= 50 && p.volatility_expansion_ratio >= 1.10 && p.candle_quality_score >= 3
  );

  const passed_ultra_selective = (
    p.avg_turnover_20 >= 1 * CRORE && p.atr_pct14_pctl120 <= 60 &&
    p.pre10_avg_range_atr <= 0.75 && p.pre10_expansion_count <= 0 &&
    p.compression_zone_len >= 6 && p.compression_zone_len <= 15 &&
    p.pre10_avg_vol_ratio <= 0.85 && p.pre5_avg_vol_ratio <= 1.10 &&
    p.pre10_high_vol_count <= 4 && p.pre10_red_vol_bias <= 1.10 &&
    p.zone_tightness_pct <= 8 &&
    p.exact_range_atr >= 1.0 && p.exact_range_atr <= 6.0 &&
    p.exact_vol_ratio20 >= 1.20 && p.exact_vol_vs_pre5 >= 2.00 &&
    p.close_loc >= 65 && p.upper_wick_pct <= 40 && p.body_pct >= 25 &&
    p.signal_range_pct <= 8.5 && p.ultra_precision_score >= 45 &&
    p.rsi2 >= 55 && p.volatility_expansion_ratio >= 1.50
  );

  // ── ORS-Prime Reversal cluster ────────────────────────────────────────────
  // Signal candle = last candle; uses same candle array already computed above.
  const ors_rsi2 = rsi2;  // already computed
  // RSI14 (14-period)
  let g14 = 0, l14 = 0;
  for (let i = Math.max(1, n - 13); i < n; i++) {
    const d = candles[i].c - candles[i - 1].c;
    if (d > 0) g14 += d; else l14 -= d;
  }
  const ors_rsi14 = l14 === 0 ? 100 : 100 - 100 / (1 + g14 / l14);

  // EMA20 at signal candle
  const ema20Vals: number[] = [];
  { const k = 2 / 21; let v = candles[0].c; for (let i = 0; i < n; i++) { v = i === 0 ? candles[i].c : candles[i].c * k + v * (1 - k); ema20Vals.push(v); } }
  const ors_ema20 = ema20Vals[n - 1];
  const ors_dist_ema20 = ors_ema20 > 0 ? (sig.c - ors_ema20) / ors_ema20 * 100 : 0;

  // 60d swing-high drawdown
  let swHi = -Infinity;
  for (let i = Math.max(0, n - 61); i < n - 1; i++) if (candles[i].h > swHi) swHi = candles[i].h;
  const ors_dd_from_swing_high = swHi > 0 ? (swHi - sig.c) / swHi * 100 : 0;

  // 252d z-score
  const zStart = Math.max(0, n - 252);
  let zSum = 0, zCnt = 0;
  for (let i = zStart; i < n; i++) { zSum += candles[i].c; zCnt++; }
  const zMean = zCnt ? zSum / zCnt : sig.c;
  let zVar = 0;
  for (let i = zStart; i < n; i++) { const d = candles[i].c - zMean; zVar += d * d; }
  const zStd = zCnt > 1 ? Math.sqrt(zVar / (zCnt - 1)) : 0;
  const ors_z_score = zStd > 0 ? (sig.c - zMean) / zStd : 0;

  // Volume dry-up
  const ors_v5avg = mean(candles.slice(n - 6, n - 1).map(c => c.v));
  const ors_vol20avg = mean(candles.slice(n - 21, n - 1).map(c => c.v));
  const ors_vol_dry_up = ors_vol20avg > 0 ? ors_v5avg / ors_vol20avg : 1;

  // Swing-low pivot (6-bar)
  let minLo6 = Infinity;
  for (let i = Math.max(0, n - 7); i < n - 1; i++) if (candles[i].l < minLo6) minLo6 = candles[i].l;
  const ors_is_sw_lo = sig.l <= minLo6;

  // ORS score
  const ors_body_pct = body_pct;
  const ors_rPct = signal_range_pct;
  const ors_up_wick = upper_wick_pct;
  let ors_score = 0;
  if (ors_rsi2 <= 3) ors_score += 30; else if (ors_rsi2 <= 5) ors_score += 25;
  else if (ors_rsi2 <= 10) ors_score += 20; else if (ors_rsi2 <= 15) ors_score += 12;
  if (ors_rsi14 <= 30) ors_score += 15; else if (ors_rsi14 <= 38) ors_score += 10; else if (ors_rsi14 <= 45) ors_score += 5;
  if (ors_rPct >= 5) ors_score += 10; else if (ors_rPct >= 3.5) ors_score += 7; else if (ors_rPct >= 2.4) ors_score += 4;
  if (ors_dist_ema20 <= -8) ors_score += 10; else if (ors_dist_ema20 <= -5) ors_score += 7; else if (ors_dist_ema20 <= -2) ors_score += 4;
  if (ors_body_pct >= 60) ors_score += 8; else if (ors_body_pct >= 45) ors_score += 5; else if (ors_body_pct >= 35) ors_score += 2;
  if (ors_up_wick <= 10) ors_score += 7; else if (ors_up_wick <= 20) ors_score += 5; else if (ors_up_wick <= 30) ors_score += 2;
  if (ors_is_sw_lo) ors_score += 5;
  if (ors_vol_dry_up <= 0.70) ors_score += 5; else if (ors_vol_dry_up <= 0.85) ors_score += 3;
  if (ors_dd_from_swing_high >= 30) ors_score += 10; else if (ors_dd_from_swing_high >= 25) ors_score += 8;
  else if (ors_dd_from_swing_high >= 20) ors_score += 6; else if (ors_dd_from_swing_high >= 15) ors_score += 3;
  if (ors_z_score <= -3.0) ors_score += 12; else if (ors_z_score <= -2.5) ors_score += 8; else if (ors_z_score <= -2.0) ors_score += 5;
  ors_score = Math.min(ors_score, 100);

  // Signal gate
  const ors_red = sig.c < sig.o;
  const ors_close_loc = close_loc;
  const passed_ors_signal = (
    ors_red &&
    ors_rsi2 <= 5 &&
    ors_rsi14 <= 38 &&
    ors_close_loc <= 35 &&
    ors_body_pct >= 45 &&
    ors_up_wick <= 20 &&
    ors_rPct >= 3.5 &&
    ors_dist_ema20 <= -3.0 &&
    ors_dd_from_swing_high >= 30 &&
    ors_is_sw_lo &&
    ors_score >= 72
  );

  // Confirmation: previous candle was ORS signal AND current candle is green
  // (In compute.ts we only have the full candle array — check if n>=2)
  let ors_confirmed = false;
  if (n >= 2 && sig.c > sig.o) {
    // Check prev candle ORS gates
    const prev = candles[n - 2]; const prevRange = prev.h - prev.l;
    if (prevRange > 0 && prev.c > 0) {
      let pg14 = 0, pl14 = 0;
      for (let i = Math.max(1, n - 14); i < n - 1; i++) { const d = candles[i].c - candles[i - 1].c; if (d > 0) pg14 += d; else pl14 -= d; }
      const prevRsi14 = pl14 === 0 ? 100 : 100 - 100 / (1 + pg14 / pl14);
      let pg2 = 0, pl2 = 0;
      for (let i = Math.max(1, n - 2); i < n - 1; i++) { const d = candles[i].c - candles[i - 1].c; if (d > 0) pg2 += d; else pl2 -= d; }
      const prevRsi2 = pl2 === 0 ? 100 : 100 - 100 / (1 + pg2 / pl2);
      const prevBodyPct = Math.abs(prev.c - prev.o) / prevRange * 100;
      const prevUpWick = (prev.h - Math.max(prev.o, prev.c)) / prevRange * 100;
      const prevRPct = prevRange / prev.c * 100;
      const prevCloseLoc = (prev.c - prev.l) / prevRange * 100;
      const prevDistE20 = ema20Vals[n - 2] > 0 ? (prev.c - ema20Vals[n - 2]) / ema20Vals[n - 2] * 100 : 0;
      let prevSwHi = -Infinity;
      for (let i = Math.max(0, n - 62); i < n - 2; i++) if (candles[i].h > prevSwHi) prevSwHi = candles[i].h;
      const prevDd = prevSwHi > 0 ? (prevSwHi - prev.c) / prevSwHi * 100 : 0;
      let prevMinLo = Infinity;
      for (let i = Math.max(0, n - 8); i < n - 2; i++) if (candles[i].l < prevMinLo) prevMinLo = candles[i].l;
      ors_confirmed = (
        prev.c < prev.o && prevRsi2 <= 5 && prevRsi14 <= 38 && prevCloseLoc <= 35 &&
        prevBodyPct >= 45 && prevUpWick <= 20 && prevRPct >= 3.5 &&
        prevDistE20 <= -3.0 && prevDd >= 30 && prev.l <= prevMinLo
      );
    }
  }

  const passed_ors_prime = passed_ors_signal || ors_confirmed;

  const clusters_passed = [passed_deployable, passed_high_precision, passed_elite, passed_ultra_selective, passed_ors_prime]
    .filter(Boolean).length;

  return {
    last_close: +sig.c.toFixed(2),
    last_date,
    avg_turnover_20:            +avg_turnover_20.toFixed(0),
    atr_pct14_pctl120:          +atr_pct14_pctl120.toFixed(1),
    pre10_avg_range_atr:        +pre10_avg_range_atr.toFixed(3),
    pre10_expansion_count,
    compression_zone_len,
    zone_tightness_pct:         +zone_tightness_pct.toFixed(2),
    pre10_avg_vol_ratio:        +pre10_avg_vol_ratio.toFixed(3),
    pre5_avg_vol_ratio:         +pre5_avg_vol_ratio.toFixed(3),
    pre10_high_vol_count,
    pre10_red_vol_bias:         +pre10_red_vol_bias.toFixed(3),
    exact_range_atr:            +exact_range_atr.toFixed(3),
    exact_vol_ratio20:          +exact_vol_ratio20.toFixed(3),
    exact_vol_vs_pre5:          +exact_vol_vs_pre5.toFixed(3),
    close_loc:                  +close_loc.toFixed(1),
    upper_wick_pct:             +upper_wick_pct.toFixed(1),
    body_pct:                   +body_pct.toFixed(1),
    signal_range_pct:           +signal_range_pct.toFixed(2),
    ultra_precision_score:      +ultra_precision_score.toFixed(1),
    rsi2:                       +rsi2.toFixed(1),
    volatility_expansion_ratio: +volatility_expansion_ratio.toFixed(3),
    candle_quality_score,
    passed_deployable,
    passed_high_precision,
    passed_elite,
    passed_ultra_selective,
    passed_ors_prime,
    ors_score,
    ors_dd_from_swing_high: +ors_dd_from_swing_high.toFixed(1),
    ors_dist_ema20: +ors_dist_ema20.toFixed(2),
    ors_confirmed,
    clusters_passed,
  };
}
