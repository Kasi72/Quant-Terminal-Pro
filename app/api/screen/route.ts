import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let symbols: string[];
  try {
    const body = await req.json();
    symbols = body?.symbols;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(symbols) || symbols.length === 0) {
    return NextResponse.json({ error: 'No symbols provided' }, { status: 400 });
  }
  if (!symbols.every(s => typeof s === 'string')) {
    return NextResponse.json({ error: 'symbols must be an array of strings' }, { status: 400 });
  }

  const supabase = getServiceClient();

  const { data: session, error: sessionErr } = await supabase
    .from('screening_sessions')
    .insert({ symbol_count: symbols.length, status: 'running', processed: 0 })
    .select()
    .single();

  if (sessionErr || !session) {
    return NextResponse.json({ error: sessionErr?.message ?? 'Failed to create session' }, { status: 500 });
  }

  return NextResponse.json({ session_id: session.id });
}
