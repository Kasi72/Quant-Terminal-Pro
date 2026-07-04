import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';
import { computeParams } from '@/lib/compute';
import type { Candle } from '@/lib/compute';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: { session_id: string; symbol: string; candles: Candle[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { session_id, symbol, candles } = body;

  if (!session_id || typeof session_id !== 'string' || !symbol || typeof symbol !== 'string') {
    return NextResponse.json({ error: 'Missing session_id or symbol' }, { status: 400 });
  }

  const supabase = getServiceClient();

  if (!Array.isArray(candles) || candles.length < 30) {
    // Not enough data — insert error row
    await supabase.from('screening_results').insert({
      session_id, symbol,
      clusters_passed: 0, passed_deployable: false,
      passed_high_precision: false, passed_elite: false,
      passed_ultra_selective: false, last_close: 0,
    });
    await supabase.rpc('increment_processed', { sid: session_id });
    return NextResponse.json({ ok: false, error: `Insufficient candle data for ${symbol}` });
  }

  try {
    const params = computeParams(candles);
    const { error } = await supabase.from('screening_results').insert({
      session_id, symbol, ...params,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    await supabase.from('screening_results').insert({
      session_id, symbol,
      clusters_passed: 0, passed_deployable: false,
      passed_high_precision: false, passed_elite: false,
      passed_ultra_selective: false, last_close: 0,
    });
    await supabase.rpc('increment_processed', { sid: session_id });
    return NextResponse.json({ ok: false, error: String(err) });
  }

  await supabase.rpc('increment_processed', { sid: session_id });
  return NextResponse.json({ ok: true });
}
