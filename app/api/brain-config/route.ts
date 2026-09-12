import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabaseServer';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('uc_brain_config')
    .select('config_value, updated_at')
    .eq('config_key', key)
    .single();

  if (error || !data) return NextResponse.json(null, { status: 404 });
  return NextResponse.json(data.config_value, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
