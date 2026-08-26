import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabaseServer';
import { isAuthorizedScreenerRequest } from '@/lib/screenerSession';
import type { AnalysisResult } from '@/lib/stockEngine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authorized = await isAuthorizedScreenerRequest(req);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let results: AnalysisResult[];
  try {
    const body = await req.json();
    results = body.results;
    if (!Array.isArray(results) || results.length === 0) throw new Error('empty');
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  // Session date in IST
  const sessionDate = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  const supabase = getServiceClient();

  const rows = results.map(r => ({
    session_date:     sessionDate,
    symbol:           r.symbol,
    best_stage:       r.stage,
    best_param_set:   r.paramSetKey ?? null,
    inflection_score: r.inflectionScore ?? null,
    last_close:       r.lastClose ?? null,
    uc_score:         r.ucScore ?? null,
    passed_sets:      r.paramSetKey ? [r.paramSetKey] : [],
    passed_count:     1,
    // Store in same shape as batch-screener so /api/batch-results can read it back
    raw_json:         { best: r, passedSets: r.paramSetKey ? [r.paramSetKey] : [], passedCount: 1, lastClose: r.lastClose },
  }));

  let upserted = 0;
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from('daily_scan_results')
      .upsert(rows.slice(i, i + BATCH), { onConflict: 'session_date,symbol' });
    if (!error) upserted += Math.min(BATCH, rows.length - i);
  }

  return NextResponse.json({ ok: true, sessionDate, upserted });
}
