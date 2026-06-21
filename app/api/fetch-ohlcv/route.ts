import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
  'Cache-Control': 'no-cache',
};

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function tryFetch(sym: string): Promise<{ ok: boolean; data?: unknown; status?: number; rateLimited?: boolean }> {
  for (const host of HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y&includePrePost=false`;
      const r = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(12000),
      });
      if (r.status === 404) return { ok: false, status: 404 };
      if (r.status === 429) return { ok: false, status: 429, rateLimited: true };
      if (!r.ok) continue;
      const data = await r.json();
      return { ok: true, data };
    } catch {
      // try next host
    }
  }
  return { ok: false };
}

async function tryFetchWithRetry(sym: string, maxRetries = 2): Promise<{ ok: boolean; data?: unknown; status?: number }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await tryFetch(sym);
    if (result.ok || result.status === 404) return result;
    if (result.rateLimited && attempt < maxRetries) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (!result.ok && attempt < maxRetries) {
      await sleep(500);
      continue;
    }
    return result;
  }
  return { ok: false };
}

export async function GET(req: NextRequest) {
  const sym = req.nextUrl.searchParams.get('symbol');
  if (!sym) return NextResponse.json({ error: 'missing symbol' }, { status: 400 });
  if (sym.length > 30 || !/^[A-Za-z0-9._^&-]+$/.test(sym)) return NextResponse.json({ error: 'invalid symbol' }, { status: 400 });

  const base = sym.replace(/\.(NS|BO)$/i, '');
  let candidates: string[];
  if (sym.toUpperCase().endsWith('.BO')) {
    candidates = [`${base}.BO`, `${base}.NS`];
  } else if (sym.toUpperCase().endsWith('.NS')) {
    candidates = [`${base}.NS`, `${base}.BO`];
  } else {
    candidates = [`${base}.NS`, `${base}.BO`, base];
  }
  candidates = [...new Set(candidates)];

  for (const candidate of candidates) {
    const result = await tryFetchWithRetry(candidate);
    if (!result.ok) {
      if (result.status === 404) continue;
      continue;
    }

    const json = result.data as Record<string, unknown>;
    const chartResult = (json?.chart as Record<string, unknown>)?.result as Record<string, unknown>[];
    if (!chartResult?.[0]) continue;

    const entry = chartResult[0];
    const timestamps = entry.timestamp as number[] | undefined;
    const indicators = entry.indicators as Record<string, unknown[]> | undefined;
    const quote = indicators?.quote?.[0] as Record<string, unknown[]> | undefined;
    if (!timestamps || timestamps.length < 30 || !quote?.open || !quote?.close || !quote?.high || !quote?.low || !quote?.volume) continue;

    return NextResponse.json({ ok: true, resolvedSymbol: candidate, raw: json });
  }

  return NextResponse.json({ ok: false, error: `No data for ${sym}` }, { status: 404 });
}
