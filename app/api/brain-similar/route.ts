import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const MAX_BODY_BYTES = 64_000;

// Proxies to the Cloudflare brain worker's /similar endpoint so the
// WORKER_TOKEN never reaches the browser. Degrades gracefully (503)
// until BRAIN_WORKER_URL / BRAIN_WORKER_TOKEN are set in Vercel env.
export async function POST(req: NextRequest) {
  const url   = process.env.BRAIN_WORKER_URL;
  const token = process.env.BRAIN_WORKER_TOKEN;
  if (!url || !token) {
    return NextResponse.json({ error: 'Brain worker not configured' }, { status: 503 });
  }

  const declaredLength = Number(req.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  }

  let body = '';
  try {
    body = await req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/similar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-worker-token': token },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    return NextResponse.json({ error: 'Brain worker request timed out' }, { status: 504 });
  }
}
