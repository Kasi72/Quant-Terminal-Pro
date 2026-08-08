import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const revalidate = 300;

// Proxies to the Cloudflare brain worker's /narrate endpoint (Llama 3.1
// narration of the brain state). 503 until worker env vars are set.
export async function GET() {
  const url   = process.env.BRAIN_WORKER_URL;
  const token = process.env.BRAIN_WORKER_TOKEN;
  if (!url || !token) {
    return NextResponse.json({ error: 'Brain worker not configured' }, { status: 503 });
  }

  let res: Response;
  try {
    res = await fetch(`${url.replace(/\/$/, '')}/narrate`, {
      headers: { 'x-worker-token': token },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return NextResponse.json({ error: 'Brain worker request timed out' }, { status: 504 });
  }

  return new NextResponse(await res.text(), {
    status: res.status,
    headers: {
      'content-type': 'application/json',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900',
    },
  });
}
