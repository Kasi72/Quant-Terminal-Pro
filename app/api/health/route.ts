import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    env: {
      supabase_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      anon_key: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  };

  // Check Supabase connectivity
  try {
    const sb = getServiceClient();
    const { error } = await sb.from('screening_sessions').select('id').limit(1);
    checks.supabase = error ? `error: ${error.message}` : 'ok';
  } catch (e) {
    checks.supabase = `exception: ${e}`;
  }

  // Check Yahoo Finance connectivity
  try {
    const r = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=5d',
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000),
      }
    );
    checks.yahoo_finance = r.ok ? `ok (${r.status})` : `http_${r.status}`;
  } catch (e) {
    checks.yahoo_finance = `error: ${e}`;
  }

  return NextResponse.json(checks);
}
