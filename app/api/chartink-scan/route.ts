import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChartinkHitter {
  symbol:     string;
  bseCode:    string;
  movePct:    number;
  closePrice: number;
  volume:     number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  'user-agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'accept-language':'en-US,en;q=0.9',
  'accept-encoding':'gzip, deflate, br',
};

function extractCookies(h: string | null): string {
  if (!h) return '';
  return h.split(/,\s*(?=[^;=,\s]+=[^;,])/g)
    .map(c => c.split(';')[0].trim())
    .filter(Boolean).join('; ');
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const minPct = parseFloat(req.nextUrl.searchParams.get('minPct') ?? '4.9');
  if (!Number.isFinite(minPct) || minPct < 0 || minPct > 25) {
    return NextResponse.json({ error: 'minPct must be a finite number between 0 and 25' }, { status: 400 });
  }

  // ── Step 1: visit Chartink screener page to get CSRF token + session cookie ──
  let csrfToken = '';
  let sessionCookies = '';

  try {
    const pageResp = await fetch('https://chartink.com/screener/', {
      headers: {
        ...BROWSER_HEADERS,
        accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    if (!pageResp.ok) {
      return NextResponse.json(
        { error: `Chartink unreachable (HTTP ${pageResp.status})` },
        { status: 502 }
      );
    }

    // Collect cookies
    const setCookieFn = (pageResp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    sessionCookies = setCookieFn
      ? setCookieFn.call(pageResp.headers).map((c: string) => c.split(';')[0].trim()).join('; ')
      : extractCookies(pageResp.headers.get('set-cookie'));

    // Extract CSRF token from HTML meta tag
    const html = await pageResp.text();
    const m = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)
           ?? html.match(/name=["']_token["'][^>]*value=["']([^"']+)["']/i)
           ?? html.match(/window\.__CSRF_TOKEN__\s*=\s*["']([^"']+)["']/);
    if (!m) {
      return NextResponse.json({ error: 'Could not find CSRF token on chartink.com' }, { status: 502 });
    }
    csrfToken = m[1];
  } catch (err) {
    return NextResponse.json({ error: 'Failed to load chartink.com', detail: String(err) }, { status: 503 });
  }

  // ── Step 2: run the scan ──────────────────────────────────────────────────
  // Scan: cash-segment stocks whose close-to-close move is strictly above the threshold.
  // The 4.9% default intentionally catches rounded 4.95-4.99% circuit-lock prints
  // that a hard >=5.0% gate misses.
  const scanClause = `( {cash} ( latest close - 1 day ago close ) / 1 day ago close * 100 > ${minPct} )`;

  let scanData: ChartinkHitter[] = [];

  try {
    const body = new URLSearchParams({ '_token': csrfToken, 'scan_clause': scanClause });
    const scanResp = await fetch('https://chartink.com/screener/process', {
      method: 'POST',
      headers: {
        ...BROWSER_HEADERS,
        'accept':             'application/json, text/javascript, */*; q=0.01',
        'content-type':       'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with':   'XMLHttpRequest',
        'x-csrf-token':       csrfToken,
        'referer':            'https://chartink.com/screener/',
        'origin':             'https://chartink.com',
        ...(sessionCookies ? { cookie: sessionCookies } : {}),
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15000),
    });

    if (!scanResp.ok) {
      return NextResponse.json(
        { error: `Chartink scan failed (HTTP ${scanResp.status}). Try refreshing or try NSE bhavcopy instead.` },
        { status: 502 }
      );
    }

    const json = await scanResp.json();
    if (!json.data || !Array.isArray(json.data)) {
      return NextResponse.json(
        { error: 'Chartink returned unexpected data format', raw: json },
        { status: 502 }
      );
    }

    // Parse — field names can vary (Chartink returns different shapes)
    scanData = (json.data as Record<string, unknown>[])
      .map(row => {
        const symbol    = String(row['nsecode'] ?? row['NSECode'] ?? row['symbol'] ?? '').trim().toUpperCase();
        const bseCode   = String(row['bsecode'] ?? row['BSECode'] ?? '').trim();
        const closePrice = parseFloat(String(row['close']   ?? row['Close']   ?? 0));
        const movePct    = parseFloat(String(row['per_chg'] ?? row['Per_Chg'] ?? row['%_Change'] ?? 0));
        const volume     = parseInt(  String(row['volume']  ?? row['Volume']  ?? 0), 10);
        return { symbol, bseCode, movePct, closePrice, volume };
      })
      // Chartink returns per_chg rounded to two decimals, while the scan clause
      // is evaluated on its internal precision. Keep rows at the displayed
      // threshold so valid 4.90-ish matches are not dropped after parsing.
      .filter(h => h.symbol.length > 0 && h.movePct >= minPct && h.movePct <= 25)
      .sort((a, b) => b.movePct - a.movePct);

  } catch (err) {
    return NextResponse.json({ error: 'Chartink scan request failed', detail: String(err) }, { status: 503 });
  }

  return NextResponse.json(
    { count: scanData.length, minPct, hitters: scanData, source: 'chartink' },
    { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } }
  );
}
