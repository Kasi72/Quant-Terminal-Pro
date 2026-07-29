import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get('symbol');
  if (!symbol || symbol.length > 40 || !/^[A-Z0-9._-]+$/i.test(symbol)) {
    return NextResponse.json({ error: 'missing or invalid symbol' }, { status: 400 });
  }

  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let meta: Record<string, number | string> | null = null;

  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
      const res = await fetch(url, {
        headers: YF_HEADERS,
        cache: 'no-store',
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      meta = data?.chart?.result?.[0]?.meta ?? null;
      if (meta) break;
    } catch { continue; }
  }

  if (!meta) {
    return NextResponse.json({ error: 'no data from Yahoo Finance' }, { status: 404 });
  }

  const price: number = (meta.regularMarketPrice as number) ?? (meta.previousClose as number) ?? 0;
  const prevClose: number = (meta.previousClose as number) ?? (meta.chartPreviousClose as number) ?? price;
  const dayChangePct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
  const marketState: string = (meta.marketState as string) ?? 'CLOSED';

  return NextResponse.json({
    symbol,
    price: Math.round(price * 100) / 100,
    prevClose: Math.round(prevClose * 100) / 100,
    dayChangePct: Math.round(dayChangePct * 100) / 100,
    marketState,        // REGULAR | PRE | POST | CLOSED
  });
}
