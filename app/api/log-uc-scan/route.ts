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
  close_loc?: number;
  rsi2?: number;
  body_pct?: number;
  upper_wick_pct?: number;
  vol_ratio_20?: number;
  vol_pre5?: number;
  range_atr?: number;
  cl_trend?: number;
  rsi2_velocity?: number;
  zone_tightness?: number;
  stage?: string;
  sector?: string;
  conviction?: number;
  day_chg_pct?: number;
  confluence_score?: number;
  inflection_score?: number;
  dd52wh?: number;
  market_regime?: string;
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
      total_scan_count: total_scan_count ?? null,
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
