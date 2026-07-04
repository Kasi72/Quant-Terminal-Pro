import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { session_id }: { session_id: string } = await req.json();
  if (!session_id) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
  const supabase = getServiceClient();
  const { error } = await supabase.rpc('finalize_session', { sid: session_id });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
