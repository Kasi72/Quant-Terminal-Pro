import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { symbols }: { symbols: string[] } = await req.json();

  if (!symbols?.length) {
    return NextResponse.json({ error: 'No symbols provided' }, { status: 400 });
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
