import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface UCCandidate {
  symbol: string;
  scan_date: string;
  uc_score: number;
  uc_elite: boolean;
  uc_strong: boolean;
  uc_goldmine: boolean;
  close_loc?: number | null;
  rsi2?: number | null;
  body_pct?: number | null;
  upper_wick_pct?: number | null;
  vol_ratio_20?: number | null;
  vol_pre5?: number | null;
  range_atr?: number | null;
  cl_trend?: number | null;
  rsi2_velocity?: number | null;
  zone_tightness?: number | null;
  stage?: string | null;
  sector?: string | null;
  morph_type?: string | null;
  conviction?: number | null;
  day_chg_pct?: number | null;
  confluence_score?: number | null;
  inflection_score?: number | null;
  dd52wh?: number | null;
  market_regime?: string | null;
  guppy_spread_pct?: number | null;
  guppy_compressed?: boolean | null;
  guppy_ultra_compressed?: boolean | null;
  guppy_compress_days?: number | null;
  guppy_primed?: boolean | null;
  guppy_coiled_release?: boolean | null;
  guppy_clean_bullish_fan?: boolean | null;
  guppy_group_gap_pct?: number | null;
  // Migration 014 — ML + screener signals
  xgb_score?: number | null;
  candle_dna_score?: number | null;
  candle_dna_tier?: string | null;
  near_breakout_tier?: string | null;
  near_breakout_pct?: number | null;
  archetype_type?: string | null;
  bayes_wr?: number | null;
  stats_score?: number | null;
  momentum_score?: number | null;
  rs_nifty20?: number | null;
  volatility_expansion_ratio?: number | null;
  ultra_precision_score?: number | null;
}

export async function POST(req: NextRequest) {
  try {
    const { candidates, total_scan_count } = (await req.json()) as { candidates: UCCandidate[]; total_scan_count?: number };
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return NextResponse.json({ logged: 0 });
    }

    const sb = getServiceClient();

    // Upsert — on conflict (symbol, scan_date) keep the row with higher uc_score
    const rows = candidates.map(c => ({
      symbol:           c.symbol,
      scan_date:        c.scan_date,
      uc_score:         c.uc_score,
      uc_elite:         c.uc_elite ?? false,
      uc_strong:        c.uc_strong ?? false,
      uc_goldmine:      c.uc_goldmine ?? false,
      close_loc:        c.close_loc ?? null,
      rsi2:             c.rsi2 ?? null,
      body_pct:         c.body_pct ?? null,
      upper_wick_pct:   c.upper_wick_pct ?? null,
      vol_ratio_20:     c.vol_ratio_20 ?? null,
      vol_pre5:         c.vol_pre5 ?? null,
      range_atr:        c.range_atr ?? null,
      cl_trend:         c.cl_trend ?? null,
      rsi2_velocity:    c.rsi2_velocity ?? null,
      zone_tightness:   c.zone_tightness ?? null,
      stage:            c.stage ?? null,
      sector:           c.sector ?? null,
      conviction:       c.conviction ?? null,
      day_chg_pct:      c.day_chg_pct ?? null,
      confluence_score: c.confluence_score ?? null,
      inflection_score: c.inflection_score ?? null,
      dd52wh:           c.dd52wh ?? null,
      market_regime:    c.market_regime ?? null,
      morph_type:            c.morph_type ?? null,
      total_scan_count:      total_scan_count ?? null,
      guppy_spread_pct:      c.guppy_spread_pct ?? null,
      guppy_compressed:      c.guppy_compressed ?? null,
      guppy_ultra_compressed: c.guppy_ultra_compressed ?? null,
      guppy_compress_days:   c.guppy_compress_days ?? null,
      guppy_primed:          c.guppy_primed ?? null,
      guppy_coiled_release:  c.guppy_coiled_release ?? null,
      guppy_clean_bullish_fan: c.guppy_clean_bullish_fan ?? null,
      guppy_group_gap_pct:   c.guppy_group_gap_pct ?? null,
      // Migration 014 — ML + screener signals
      xgb_score:                  c.xgb_score ?? null,
      candle_dna_score:           c.candle_dna_score ?? null,
      candle_dna_tier:            c.candle_dna_tier ?? null,
      near_breakout_tier:         c.near_breakout_tier ?? null,
      near_breakout_pct:          c.near_breakout_pct ?? null,
      archetype_type:             c.archetype_type ?? null,
      bayes_wr:                   c.bayes_wr ?? null,
      stats_score:                c.stats_score ?? null,
      momentum_score:             c.momentum_score ?? null,
      rs_nifty20:                 c.rs_nifty20 ?? null,
      volatility_expansion_ratio: c.volatility_expansion_ratio ?? null,
      ultra_precision_score:      c.ultra_precision_score ?? null,
    }));

    const { error, count } = await sb
      .from('pbfb_uc_logger')
      .upsert(rows, {
        onConflict: 'symbol,scan_date',
        ignoreDuplicates: false,   // update if new scan has higher score
        count: 'exact',
      });

    if (error) {
      console.error('[log-uc-scan] upsert error:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ logged: count ?? rows.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[log-uc-scan] error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
