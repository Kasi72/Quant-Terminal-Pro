import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

// Proxies to the Cloudflare brain worker's /similar endpoint so the
// WORKER_TOKEN never reaches the browser. Degrades gracefully (503)
// until BRAIN_WORKER_URL / BRAIN_WORKER_TOKEN are set in Vercel env.
export async function POST(req: NextRequest) {
  const url   = process.env.BRAIN_WORKER_URL;
  const token = process.env.BRAIN_WORKER_TOKEN;
  if (!url || !token) {
    return NextResponse.json({ error: 'Brain worker not configured' }, { status: 503 });
  }

  const body = await req.text();
  const res = await fetch(`${url.replace(/\/$/, '')}/similar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-worker-token': token },
    body,
  });

  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}
