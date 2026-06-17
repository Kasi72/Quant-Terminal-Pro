import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = getServiceClient();

  const [{ data: session }, { data: results }] = await Promise.all([
    supabase.from('screening_sessions').select('*').eq('id', id).single(),
    supabase
      .from('screening_results')
      .select('*')
      .eq('session_id', id)
      .order('clusters_passed', { ascending: false }),
  ]);

  return NextResponse.json({ session, results: results ?? [] });
}
