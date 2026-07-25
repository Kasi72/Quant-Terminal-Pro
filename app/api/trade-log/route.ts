import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const USER_ID = 'drkkr';

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol');
  if (!symbol || symbol.length > 30) {
    return NextResponse.json({ error: 'missing or invalid symbol' }, { status: 400 });
  }

  const db = getServiceClient();
  const { data, error } = await db
    .from('trade_daily_log')
    .select('date, open, high, low, close, day_num, mfe_pct, mae_pct, event_type, event_detail')
    .eq('user_id', USER_ID)
    .eq('symbol', symbol)
    .order('date', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, symbol, rows: data ?? [] });
}
