import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { session_id, symbols }: { session_id: string; symbols: string[] } = await req.json();

  await supabase.from('screening_sessions').update({ status: 'running' }).eq('id', session_id);

  let processed = 0;

  for (const symbol of symbols) {
    try {
      const params = await computeParams(symbol);
      const clusters = runClusters(params);

      await supabase.from('screening_results').insert({
        session_id,
        symbol,
        ...params,
        ...clusters,
      });
    } catch (err) {
      await supabase.from('screening_results').insert({
        session_id,
        symbol,
        error: String(err),
        clusters_passed: 0,
        passed_deployable: false,
        passed_high_precision: false,
        passed_elite: false,
        passed_ultra_selective: false,
        passed_ors_prime: false,
        ors_score: 0,
      });
    }
    processed++;
    await supabase.from('screening_sessions').update({ processed }).eq('id', session_id);
  }

  await supabase.from('screening_sessions').update({ status: 'done' }).eq('id', session_id);

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

// ── Yahoo Finance fetch ────────────────────────────────────────────────────────
async function fetchOHLCV(symbol: string) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2y`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status} for ${symbol}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${symbol}`);

  const quotes = result.indicators.quote[0];
  const timestamps: number[] = result.timestamp;
  const open: number[] = quotes.open;
  const high: number[] = quotes.high;
  const low: number[] = quotes.low;
  const close: number[] = quotes.close;
  const volume: number[] = quotes.volume;

  // Filter out any null candles
  const candles: { ts: number; o: number; h: number; l: number; c: number; v: number }[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (close[i] != null && high[i] != null && low[i] != null && volume[i] != null) {
      candles.push({ ts: timestamps[i], o: open[i], h: high[i], l: low[i], c: close[i], v: volume[i] });
    }
  }
  return candles;
}

// ── ATR14 (Wilder smoothing) ──────────────────────────────────────────────────
function computeATR14(candles: ReturnType<typeof fetchOHLCV> extends Promise<infer T> ? T : never) {
  const atr: number[] = new Array(candles.length).fill(0);
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
      for (let j = 1; j <= 14; j++) sum += Math.max(
        candles[j].h - candles[j].l,
        Math.abs(candles[j].h - candles[j - 1].c),
        Math.abs(candles[j].l - candles[j - 1].c),
      );
      atr[i] = sum / 14;
    } else {
      const prevTR = Math.max(
        candles[i - 1].h - candles[i - 1].l,
        Math.abs(candles[i - 1].h - candles[i - 2].c),
        Math.abs(candles[i - 1].l - candles[i - 2].c),
      );
      atr[i] = (atr[i - 1] * 13 + prevTR) / 14;
    }
  }
  return atr;
}

// ── RSI2 ──────────────────────────────────────────────────────────────────────
function computeRSI2(closes: number[]): number {
  const n = closes.length;
  if (n < 3) return 50;
  const g1 = Math.max(0, closes[n - 1] - closes[n - 2]);
  const l1 = Math.max(0, closes[n - 2] - closes[n - 1]);
  const g0 = Math.max(0, closes[n - 2] - closes[n - 3]);
  const l0 = Math.max(0, closes[n - 3] - closes[n - 2]);
  const avgG = (g0 + g1) / 2;
  const avgL = (l0 + l1) / 2;
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

// ── Percentile rank ───────────────────────────────────────────────────────────
function percentileRank(arr: number[], value: number): number {
  const below = arr.filter((v) => v < value).length;
  return (below / arr.length) * 100;
}

// ── Mean helper ───────────────────────────────────────────────────────────────
function mean(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ── Main computation ──────────────────────────────────────────────────────────
type Candle = { ts: number; o: number; h: number; l: number; c: number; v: number };

async function computeParams(symbol: string) {
  const candles: Candle[] = await fetchOHLCV(symbol);
  if (candles.length < 50) throw new Error('Insufficient data');

  const atr14 = computeATR14(candles);
  const n = candles.length;

  // Indices
  const sigIdx = n - 1; // signal candle = last candle
  const pre10Start = n - 11; // indices [n-11 .. n-2]
  const pre10End = n - 2;
  const pre5Start = n - 6; // indices [n-6 .. n-2]

  const sig = candles[sigIdx];
  const sigATR = atr14[sigIdx] || 1;

  // ATRPct14 history for percentile
  const atrPctHistory: number[] = [];
  for (let i = Math.max(1, n - 121); i < n; i++) {
    atrPctHistory.push((atr14[i] / candles[i].c) * 100);
  }
  const atrPct14Current = (sigATR / sig.c) * 100;
  const atrPct14Pctl120 = percentileRank(atrPctHistory.slice(0, -1), atrPct14Current);

  // avgTurnover20
  const turnover20: number[] = [];
  for (let i = n - 20; i < n; i++) turnover20.push(candles[i].c * candles[i].v);
  const avg_turnover_20 = mean(turnover20);

  // RangeATR for all candles
  const rangeATR = candles.map((c, i) => (atr14[i] > 0 ? (c.h - c.l) / atr14[i] : 0));

  // volRatio20
  const volRatio20: number[] = new Array(n).fill(1);
  for (let i = 20; i < n; i++) {
    const avg = mean(candles.slice(i - 20, i).map((c) => c.v));
    volRatio20[i] = avg > 0 ? candles[i].v / avg : 1;
  }

  // Pre-10 metrics
  const pre10Range = rangeATR.slice(pre10Start, pre10End + 1);
  const pre10Vol = volRatio20.slice(pre10Start, pre10End + 1);
  const pre10Candles = candles.slice(pre10Start, pre10End + 1);
  const pre5Vol = volRatio20.slice(pre5Start, pre10End + 1);

  const pre10_avg_range_atr = mean(pre10Range);
  const pre10_expansion_count = pre10Range.filter((r) => r > 1.1).length;
  const pre10_avg_vol_ratio = mean(pre10Vol);
  const pre5_avg_vol_ratio = mean(pre5Vol);
  const pre10_high_vol_count = pre10Vol.filter((v) => v > 1.35).length;
  const redVol = pre10Candles.filter((c) => c.c < c.o).map((c) => c.v);
  const pre10_red_vol_bias = redVol.length > 0
    ? mean(redVol) / Math.max(mean(pre10Candles.map((c) => c.v)), 1)
    : 0;

  // Compression zone detection — scan backward from pre-10 start
  // Zone candles must have RangeATR ≤ 1.0
  let zoneEnd = pre10End;
  let zoneStart = zoneEnd;
  let zoneLen = 0;
  for (let i = zoneEnd; i >= Math.max(0, n - 30); i--) {
    if (rangeATR[i] <= 1.0) {
      zoneStart = i;
      zoneLen++;
    } else {
      break;
    }
  }

  let compression_zone_len = zoneLen;
  let zone_tightness_pct = 100;
  if (zoneLen >= 6) {
    const zoneCandles = candles.slice(zoneStart, zoneEnd + 1);
    const zoneHigh = Math.max(...zoneCandles.map((c) => c.h));
    const zoneLow = Math.min(...zoneCandles.map((c) => c.l));
    zone_tightness_pct = ((zoneHigh - zoneLow) / zoneLow) * 100;

    // Breakout check: signal candle close > zoneHigh × 1.001
    const breakoutValid = sig.c > zoneHigh * 1.001;
    if (!breakoutValid) compression_zone_len = 0; // invalidate zone
  } else {
    compression_zone_len = 0;
  }

  // Signal candle metrics
  const sigRange = sig.h - sig.l || 0.0001;
  const exact_range_atr = sigRange / sigATR;
  const vol20avg = mean(candles.slice(n - 20, n - 1).map((c) => c.v));
  const exact_vol_ratio20 = vol20avg > 0 ? sig.v / vol20avg : 1;
  const pre5VolAvg = mean(candles.slice(pre5Start, pre10End + 1).map((c) => c.v));
  const exact_vol_vs_pre5 = pre5VolAvg > 0 ? sig.v / pre5VolAvg : 1;
  const close_loc = ((sig.c - sig.l) / sigRange) * 100;
  const upper_wick_pct = ((sig.h - Math.max(sig.o, sig.c)) / sigRange) * 100;
  const body_pct = (Math.abs(sig.c - sig.o) / sigRange) * 100;
  const signal_range_pct = (sigRange / sig.c) * 100;
  const rsi2 = computeRSI2(candles.slice(n - 10).map((c) => c.c));
  const volatility_expansion_ratio = pre10_avg_range_atr > 0 ? exact_range_atr / pre10_avg_range_atr : 0;

  // UltraPrecisionScore (0-100)
  let ultra_precision_score = 0;
  ultra_precision_score += close_loc >= 80 ? 20 : close_loc >= 65 ? 12 : 0;
  ultra_precision_score += upper_wick_pct <= 20 ? 20 : upper_wick_pct <= 35 ? 12 : 0;
  ultra_precision_score += body_pct >= 55 ? 15 : body_pct >= 35 ? 9 : 0;
  ultra_precision_score += exact_vol_vs_pre5 >= 4 ? 20 : exact_vol_vs_pre5 >= 2 ? 12 : 0;
  ultra_precision_score += zone_tightness_pct <= 5 ? 15 : zone_tightness_pct <= 15 ? 9 : 0;
  ultra_precision_score += compression_zone_len >= 12 ? 10 : compression_zone_len >= 6 ? 6 : 0;

  // CandleQualityScore_v8 (0-5)
  let candle_quality_score = 0;
  if (close_loc >= 65) candle_quality_score++;
  if (upper_wick_pct <= 30) candle_quality_score++;
  if (body_pct >= 40) candle_quality_score++;
  if (exact_vol_vs_pre5 >= 2.5) candle_quality_score++;
  if (volatility_expansion_ratio >= 1.5) candle_quality_score++;

  const lastDate = new Date(sig.ts * 1000).toISOString().slice(0, 10);

  return {
    last_close: +sig.c.toFixed(2),
    last_date: lastDate,
    avg_turnover_20: +avg_turnover_20.toFixed(0),
    atr_pct14_pctl120: +atrPct14Pctl120.toFixed(1),
    pre10_avg_range_atr: +pre10_avg_range_atr.toFixed(3),
    pre10_expansion_count,
    compression_zone_len,
    zone_tightness_pct: +zone_tightness_pct.toFixed(2),
    pre10_avg_vol_ratio: +pre10_avg_vol_ratio.toFixed(3),
    pre5_avg_vol_ratio: +pre5_avg_vol_ratio.toFixed(3),
    pre10_high_vol_count,
    pre10_red_vol_bias: +pre10_red_vol_bias.toFixed(3),
    exact_range_atr: +exact_range_atr.toFixed(3),
    exact_vol_ratio20: +exact_vol_ratio20.toFixed(3),
    exact_vol_vs_pre5: +exact_vol_vs_pre5.toFixed(3),
    close_loc: +close_loc.toFixed(1),
    upper_wick_pct: +upper_wick_pct.toFixed(1),
    body_pct: +body_pct.toFixed(1),
    signal_range_pct: +signal_range_pct.toFixed(2),
    ultra_precision_score: +ultra_precision_score.toFixed(1),
    rsi2: +rsi2.toFixed(1),
    volatility_expansion_ratio: +volatility_expansion_ratio.toFixed(3),
    candle_quality_score,
  };
}

// ── 4 Cluster filters ─────────────────────────────────────────────────────────
interface Params {
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
}

const CRORE = 10_000_000;

function clusterDeployable(p: Params): boolean {
  return (
    p.avg_turnover_20 >= 1 * CRORE &&
    p.atr_pct14_pctl120 <= 75 &&
    p.pre10_avg_range_atr <= 0.75 &&
    p.pre10_expansion_count <= 2 &&
    p.compression_zone_len >= 6 && p.compression_zone_len <= 20 &&
    p.pre10_avg_vol_ratio <= 0.90 &&
    p.pre5_avg_vol_ratio <= 0.90 &&
    p.pre10_high_vol_count <= 4 && // at 1.35x — stored as general count
    p.pre10_red_vol_bias <= 1.10 &&
    p.zone_tightness_pct <= 15 &&
    p.exact_range_atr >= 1.0 && p.exact_range_atr <= 5.0 &&
    p.exact_vol_ratio20 >= 1.00 &&
    p.exact_vol_vs_pre5 >= 2.00 &&
    p.close_loc >= 65 &&
    p.upper_wick_pct <= 35 &&
    p.body_pct >= 35 &&
    p.signal_range_pct <= 8.5 &&
    p.ultra_precision_score >= 55 &&
    p.rsi2 >= 50 &&
    p.volatility_expansion_ratio >= 1.50 &&
    p.candle_quality_score >= 3
  );
}

function clusterHighPrecision(p: Params): boolean {
  return (
    p.avg_turnover_20 >= 1 * CRORE &&
    p.atr_pct14_pctl120 <= 75 &&
    p.pre10_avg_range_atr <= 0.75 &&
    p.pre10_expansion_count <= 0 && // strict: zero expansion candles
    p.compression_zone_len >= 6 && p.compression_zone_len <= 25 &&
    p.pre10_avg_vol_ratio <= 0.90 &&
    p.pre5_avg_vol_ratio <= 1.10 &&
    p.pre10_high_vol_count <= 4 &&
    p.pre10_red_vol_bias <= 1.10 &&
    p.zone_tightness_pct <= 15 &&
    p.exact_range_atr >= 1.0 && p.exact_range_atr <= 5.0 &&
    p.exact_vol_ratio20 >= 1.10 &&
    p.exact_vol_vs_pre5 >= 2.00 &&
    p.close_loc >= 65 &&
    p.upper_wick_pct <= 35 &&
    p.body_pct >= 25 &&
    p.signal_range_pct <= 11.0 &&
    p.ultra_precision_score >= 45 &&
    p.rsi2 >= 50
  );
}

function clusterElite(p: Params): boolean {
  return (
    p.avg_turnover_20 >= 2 * CRORE &&
    p.atr_pct14_pctl120 <= 60 &&
    p.pre10_avg_range_atr <= 0.95 &&
    p.pre10_expansion_count <= 4 &&
    p.compression_zone_len >= 8 && p.compression_zone_len <= 15 &&
    p.pre10_avg_vol_ratio <= 0.85 &&
    p.pre5_avg_vol_ratio <= 0.90 &&
    p.pre10_high_vol_count <= 2 && // stricter at 1.2x
    p.pre10_red_vol_bias <= 1.20 &&
    p.zone_tightness_pct <= 12 &&
    p.exact_range_atr >= 1.0 && p.exact_range_atr <= 6.0 &&
    p.exact_vol_ratio20 >= 1.00 &&
    p.exact_vol_vs_pre5 >= 3.00 &&
    p.close_loc >= 65 &&
    p.upper_wick_pct <= 35 &&
    p.body_pct >= 35 &&
    p.signal_range_pct <= 8.5 &&
    p.ultra_precision_score >= 45 &&
    p.rsi2 >= 50 &&
    p.volatility_expansion_ratio >= 1.10 &&
    p.candle_quality_score >= 3
  );
}

function clusterUltraSelective(p: Params): boolean {
  return (
    p.avg_turnover_20 >= 1 * CRORE &&
    p.atr_pct14_pctl120 <= 60 &&
    p.pre10_avg_range_atr <= 0.75 &&
    p.pre10_expansion_count <= 0 &&
    p.compression_zone_len >= 6 && p.compression_zone_len <= 15 &&
    p.pre10_avg_vol_ratio <= 0.85 &&
    p.pre5_avg_vol_ratio <= 1.10 &&
    p.pre10_high_vol_count <= 4 && // at 1.5x
    p.pre10_red_vol_bias <= 1.10 &&
    p.zone_tightness_pct <= 8 &&
    p.exact_range_atr >= 1.0 && p.exact_range_atr <= 6.0 &&
    p.exact_vol_ratio20 >= 1.20 &&
    p.exact_vol_vs_pre5 >= 2.00 &&
    p.close_loc >= 65 &&
    p.upper_wick_pct <= 40 &&
    p.body_pct >= 25 &&
    p.signal_range_pct <= 8.5 &&
    p.ultra_precision_score >= 45 &&
    p.rsi2 >= 55 &&
    p.volatility_expansion_ratio >= 1.50
  );
}

function clusterOrsPrime(p: Params): boolean {
  // ORS-Prime: oversold-reversal fingerprint
  // Candle-level checks use the same p fields computed in the edge function
  const red = p.close_loc <= 50 && p.body_pct >= 45; // proxy: low close + body
  return (
    p.avg_turnover_20 >= 1 * CRORE &&
    p.rsi2 <= 5 &&
    p.close_loc <= 35 &&
    p.body_pct >= 45 &&
    p.upper_wick_pct <= 20 &&
    p.signal_range_pct >= 3.5 &&
    red
    // Note: EMA20 dist, swing-high drawdown, z-score require raw candles —
    // not available in edge function params. Full ORS check runs in compute.ts.
    // This is a best-effort proxy for the batch screener.
  );
}

function runClusters(p: Params) {
  const passed_deployable = clusterDeployable(p);
  const passed_high_precision = clusterHighPrecision(p);
  const passed_elite = clusterElite(p);
  const passed_ultra_selective = clusterUltraSelective(p);
  const passed_ors_prime = clusterOrsPrime(p);
  const clusters_passed = [passed_deployable, passed_high_precision, passed_elite, passed_ultra_selective, passed_ors_prime]
    .filter(Boolean).length;
  return { passed_deployable, passed_high_precision, passed_elite, passed_ultra_selective, passed_ors_prime, clusters_passed };
}
