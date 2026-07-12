import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

interface EventPayload {
  symbol:          string;
  nBefore:         number;
  bestStage:       string;
  bestParamSet:    string | null;
  classification:  string;
  anyZone:         boolean;
  isUCLock:        boolean;
  movePct:         number;
  volMult:         number;
  closeLoc:        number | null;
  upperWickPct:    number | null;
  bodyPct:         number | null;
  exactVolRatio20: number | null;
  exactVolVsPre5:  number | null;
  exactRangeATR14: number | null;
  atrPct14:        number | null;
  rsi2:            number | null;
  pre10AvgRangeATR: number | null;
  pre10AvgVolRatio: number | null;
  zoneTightness:   number | null;
  zoneLen:         number | null;
  closePrice:      number | null;
  shapeVec:        number[] | null;
}

interface SavePayload {
  runDate: string;
  activeN: number;
  events:  EventPayload[];
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  const body = await req.json() as SavePayload;
  if (!body.runDate || !Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const sb = createClient(url, key);

  // Log the daily run
  const { data: run, error: runErr } = await sb
    .from('pbfb_daily_runs')
    .insert({
      run_date:     body.runDate,
      symbol_count: new Set(body.events.map(e => e.symbol)).size,
      event_count:  body.events.length,
      uc_count:     body.events.filter(e => e.isUCLock).length,
      active_n:     body.activeN,
    })
    .select('id')
    .single();

  if (runErr) return NextResponse.json({ error: runErr.message }, { status: 500 });

  const rows = body.events.map(e => ({
    run_date:        body.runDate,
    symbol:          e.symbol,
    n_before:        e.nBefore,
    best_stage:      e.bestStage,
    best_param_set:  e.bestParamSet,
    classification:  e.classification,
    any_zone:        e.anyZone,
    is_uc_lock:      e.isUCLock,
    close_loc:       e.closeLoc,
    upper_wick_pct:  e.upperWickPct,
    body_pct:        e.bodyPct,
    vol_ratio_20:    e.exactVolRatio20,
    vol_vs_pre5:     e.exactVolVsPre5,
    range_atr:       e.exactRangeATR14,
    atr_pct:         e.atrPct14,
    rsi2:            e.rsi2,
    pre10_range_avg: e.pre10AvgRangeATR,
    pre10_vol_avg:   e.pre10AvgVolRatio,
    zone_tightness:  e.zoneTightness,
    zone_len:        e.zoneLen,
    move_pct:        e.movePct,
    vol_mult:        e.volMult,
    close_price:     e.closePrice,
    shape_vec:       e.shapeVec,
  }));

  // Batch upsert in chunks of 200 — re-saving the same run updates rows
  // instead of duplicating them (unique index on run_date, symbol, n_before)
  let stored = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await sb.from('pbfb_uc_events')
      .upsert(chunk, { onConflict: 'run_date,symbol,n_before' });
    if (!error) stored += chunk.length;
  }

  return NextResponse.json({ runId: run.id, eventsStored: stored });
}
