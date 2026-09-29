import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabaseServer';
import { isAuthorizedScreenerRequest } from '@/lib/screenerSession';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const db = getServiceClient();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data, error } = await db
    .from('pbfb_uc_events')
    .select(
      'symbol, event_date, uc_score, uc_goldmine, uc_strong, hit_t1, hit_t2, stopped_out, outcome_pct_5d, outcome_pct_10d, best_stage, best_param_set'
    )
    .gte('event_date', cutoffStr)
    .or('uc_goldmine.eq.true,uc_strong.eq.true')
    .order('event_date', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}

async function requireAuth(req: NextRequest): Promise<NextResponse | null> {
  return (await isAuthorizedScreenerRequest(req))
    ? null
    : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
