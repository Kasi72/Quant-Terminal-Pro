// GET /api/batch-results
// Returns pre-computed scan results from daily_scan_results table.
// Used by the frontend to load last night's session instantly on page mount.
//
// Query params:
//   date   — ISO date (YYYY-MM-DD). Defaults to latest available session.
//   stage  — comma-separated stages to filter (e.g. "BUY,STRONG_BUY,ULTRA_STRONG_BUY").
//            Omit to return all stages.

import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

const ALLOWED_STAGES = new Set([
  'ULTRA_STRONG_BUY', 'STRONG_BUY', 'BUY',
  'PRE_BREAKOUT', 'EARLY_INFLECTION', 'COMPRESSION_WATCH', 'NO_SIGNAL',
]);

export async function GET(req: NextRequest) {
  const supabase = getServiceClient();
  const { searchParams } = req.nextUrl;

  let sessionDate = searchParams.get('date');
  const stageParam = searchParams.get('stage');

  // Resolve latest session date if not specified
  if (!sessionDate) {
    const { data } = await supabase
      .from('daily_scan_results')
      .select('session_date')
      .order('session_date', { ascending: false })
      .limit(1)
      .single();
    if (!data) return NextResponse.json({ ok: false, error: 'No scan data yet' }, { status: 404 });
    sessionDate = data.session_date as string;
  }

  let query = supabase
    .from('daily_scan_results')
    .select('symbol, best_stage, best_param_set, inflection_score, last_close, uc_score, passed_sets, passed_count, raw_json')
    .eq('session_date', sessionDate)
    .order('inflection_score', { ascending: false });

  if (stageParam) {
    const stages = stageParam.split(',').map(s => s.trim()).filter(s => ALLOWED_STAGES.has(s));
    if (stages.length > 0) {
      query = query.in('best_stage', stages);
    }
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    sessionDate,
    count: data?.length ?? 0,
    results: data ?? [],
  });
}
