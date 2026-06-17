import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { fetchOHLCV, computeParams } from '@/lib/compute';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { session_id, symbol }: { session_id: string; symbol: string } = await req.json();

  if (!session_id || !symbol) {
    return NextResponse.json({ error: 'Missing session_id or symbol' }, { status: 400 });
  }

  const supabase = getServiceClient();

  try {
    const candles = await fetchOHLCV(symbol);
    const params  = computeParams(candles);

    const { error } = await supabase.from('screening_results').insert({
      session_id,
      symbol,
      ...params,
    });

    if (error) throw new Error(error.message);
  } catch (err) {
    // Insert error row so the session still counts it as processed
    await supabase.from('screening_results').insert({
      session_id,
      symbol,
      error: String(err),
      clusters_passed: 0,
      passed_deployable: false,
      passed_high_precision: false,
      passed_elite: false,
      passed_ultra_selective: false,
    });
  }

  // Increment processed count
  await supabase.rpc('increment_processed', { sid: session_id });

  return NextResponse.json({ ok: true });
}
