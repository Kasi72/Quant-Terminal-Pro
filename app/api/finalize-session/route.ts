import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const { session_id }: { session_id: string } = await req.json();
  if (!session_id) return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
  const supabase = getServiceClient();
  await supabase.rpc('finalize_session', { sid: session_id });
  return NextResponse.json({ ok: true });
}
