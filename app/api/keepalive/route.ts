export const runtime = 'edge';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && key) {
    // Lightweight SELECT 1 — keeps Supabase free project from pausing after 7 days
    fetch(`${url}/rest/v1/tracked_trades?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }

  return new Response('ok', { status: 200 });
}
