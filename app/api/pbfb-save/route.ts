import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabaseServer';
import { isAuthorizedScreenerRequest } from '@/lib/screenerSession';

// Node.js serverless runtime: 4.5 MB body limit vs 1 MB edge limit
// Raised from 4 MB → 8 MB: 141-stock Chartink day pushed payload ~5-6 MB (2026-08-31)
const MAX_BODY_BYTES = 8_000_000;
const MAX_EVENTS_PER_RUN = 20_000;

interface EventPayload {
  symbol:          string;
  eventDate:       string | null;
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
  nearBreakoutTier?: string | null;
  archetypeType?:    string | null;
  zoneShape?:        string | null;
  rsi2Velocity?:     number | null;
  clTrend?:          number | null;
  ucScore?:          number | null;
  ucGoldmine?:       boolean | null;
  ucStrong?:         boolean | null;
  ucElite?:          boolean | null;
}

interface SavePayload {
  runDate: string;
  activeN: number;
  events:  EventPayload[];
}

// Bug 14 fix: unauthenticated POST let any caller write with service role key
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  const [ka, kb] = await Promise.all([
    crypto.subtle.importKey('raw', ab, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    crypto.subtle.importKey('raw', bb, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
  ]);
  const [sa, sb2] = await Promise.all([
    crypto.subtle.sign('HMAC', ka, ab),
    crypto.subtle.sign('HMAC', kb, bb),
  ]);
  const va = new Uint8Array(sa), vb = new Uint8Array(sb2);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export async function POST(req: NextRequest) {

  // The route writes with the service-role key, so it must never be callable by
  // an unauthenticated request. Browser users authenticate via screener cookie;
  // automation may use PBFB_INTERNAL_TOKEN.
  const internalToken = process.env.PBFB_INTERNAL_TOKEN;
  if (!internalToken && !process.env.SCREENER_PASSWORD) {
    return NextResponse.json({ error: 'PBFB write auth not configured' }, { status: 500 });
  }

  const providedInternal = req.headers.get('x-internal-token') ?? '';
  const okByInternal = !!internalToken && !!providedInternal
    && await timingSafeEqual(providedInternal, internalToken);
  const okByCookie = await isAuthorizedScreenerRequest(req);
  if (!okByInternal && !okByCookie) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const declaredLength = Number(req.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  let body: SavePayload;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    body = JSON.parse(raw) as SavePayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  if (!body.runDate || !Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }
  if (body.events.length > MAX_EVENTS_PER_RUN) {
    return NextResponse.json({ error: 'Too many events in one run' }, { status: 413 });
  }

  let sb: ReturnType<typeof getServiceClient>;
  try { sb = getServiceClient(); }
  catch { return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 }); }

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

  if (runErr) {
    console.error('[pbfb-save] pbfb_daily_runs insert failed:', runErr.message);
    return NextResponse.json({ error: runErr.message }, { status: 500 });
  }

  const rows = body.events.map(e => ({
    run_date:        body.runDate,
    symbol:          e.symbol,
    event_date:      e.eventDate,
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
    close_price:        e.closePrice,
    shape_vec:          e.shapeVec,
    near_breakout_tier: e.nearBreakoutTier ?? null,
    archetype_type:     e.archetypeType    ?? null,
    zone_shape:         e.zoneShape        ?? null,
    rsi2_velocity:      e.rsi2Velocity     ?? null,
    cl_trend:           e.clTrend          ?? null,
    uc_score:           e.ucScore          ?? null,
    uc_goldmine:        e.ucGoldmine       ?? null,
    uc_strong:          e.ucStrong         ?? null,
    uc_elite:           e.ucElite          ?? null,
  }));

  // Batch upsert in chunks of 200, keyed on the event itself — the same
  // historical breakout re-detected on a later run updates instead of duplicating
  let stored = 0;
  let firstError: string | null = null;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await sb.from('pbfb_uc_events')
      .upsert(chunk, { onConflict: 'symbol,event_date,n_before' });
    if (!error) stored += chunk.length;
    else if (!firstError) { firstError = error.message; console.error('[pbfb-save] upsert chunk error:', error.message); }
  }

  if (stored === 0 && firstError) {
    return NextResponse.json({ error: firstError }, { status: 500 });
  }

  return NextResponse.json({ runId: run.id, eventsStored: stored });
}
