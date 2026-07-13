import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export interface UCHitter {
  symbol:     string;
  movePct:    number;
  isUCLock:   boolean;
  closePrice: number;
  prevClose:  number;
  volume:     number;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function parts(dateStr: string) {
  // dateStr = "YYYY-MM-DD"
  const [y, m, d] = dateStr.split('-');
  return { y, m, d: d.padStart(2, '0') };
}

// ── NSE headers ───────────────────────────────────────────────────────────────

const NSE_BROWSER_HEADERS = {
  'user-agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'accept':           'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language':  'en-IN,en-US;q=0.9,en;q=0.8',
  'cache-control':    'no-cache',
};
const NSE_API_HEADERS = {
  'user-agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'accept':          '*/*',
  'accept-language': 'en-IN,en-US;q=0.9,en;q=0.8',
  'referer':         'https://www.nseindia.com/',
  'cache-control':   'no-cache',
};

function extractCookies(h: string | null): string {
  if (!h) return '';
  return h.split(/,\s*(?=[^;=,\s]+=[^;,])/g)
    .map(c => c.split(';')[0].trim())
    .filter(Boolean).join('; ');
}

// ── ZIP decompressor (single-file ZIP → text, no external packages) ───────────

async function unzipFirst(buf: Uint8Array): Promise<string | null> {
  // Verify PK local file header signature
  if (buf[0] !== 0x50 || buf[1] !== 0x4B || buf[2] !== 0x03 || buf[3] !== 0x04) return null;

  const view    = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const method  = view.getUint16(8,  true);  // 0=stored, 8=deflate
  const nameLen = view.getUint16(26, true);
  const xtraLen = view.getUint16(28, true);
  const dataOff = 30 + nameLen + xtraLen;

  const raw = buf.slice(dataOff);

  if (method === 0) {
    return new TextDecoder('utf-8').decode(raw);
  }
  if (method === 8) {
    try {
      // DecompressionStream is available in Node 18+ (Vercel runtime)
      const ds     = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      await writer.write(raw);
      await writer.close();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      let offset = 0, total = 0;
      for (const c of chunks) total += c.length;
      const out = new Uint8Array(total);
      for (const c of chunks) { out.set(c, offset); offset += c.length; }
      return new TextDecoder('utf-8').decode(out);
    } catch { return null; }
  }
  return null;
}

// ── CSV parsers ───────────────────────────────────────────────────────────────

// UDiFF bhavcopy columns (current NSE format since 2024):
//   TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,
//   FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,
//   ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,
//   TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1..4
function parseBhav(text: string, minPct: number): UCHitter[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const hdr = lines[0].split(',').map(h => h.trim().replace(/\r/g, ''));
  const c = (...names: string[]) => {
    for (const n of names) {
      const i = hdr.findIndex(h => h.toUpperCase() === n.toUpperCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  // UDiFF names first, then legacy names as fallback in case NSE ever re-serves older files
  const iSym  = c('TckrSymb', 'SYMBOL');
  const iSer  = c('SctySrs',  'SERIES');
  const iPrev = c('PrvsClsgPric', 'PREV_CLOSE', 'PREVCLOSE');
  const iHi   = c('HghPric',      'HIGH_PRICE', 'HIGH');
  const iCl   = c('ClsPric',      'CLOSE_PRICE', 'CLOSE');
  const iVol  = c('TtlTradgVol',  'TTL_TRD_QNTY', 'TOTTRDQTY');
  if (iSym < 0 || iCl < 0 || iPrev < 0) return [];
  return filterRows(lines.slice(1), iSym, iSer, iPrev, iHi, iCl, iVol, minPct);
}

function filterRows(
  rows: string[], iSym: number, iSer: number, iPrev: number,
  iHi: number, iCl: number, iVol: number, minPct: number,
): UCHitter[] {
  const results: UCHitter[] = [];
  for (const line of rows) {
    const cols = line.split(',');
    const series = cols[iSer]?.trim().replace(/\r/g, '').toUpperCase();
    if (series !== 'EQ') continue;
    const symbol     = cols[iSym]?.trim().replace(/\r/g, '');
    const prevClose  = parseFloat(cols[iPrev]);
    const highPrice  = iHi >= 0 ? parseFloat(cols[iHi]) : NaN;
    const closePrice = parseFloat(cols[iCl]);
    const volume     = iVol >= 0 ? Math.abs(parseInt(cols[iVol] ?? '0', 10)) : 0;
    if (!symbol || isNaN(prevClose) || isNaN(closePrice) || prevClose <= 0) continue;
    const movePct = (closePrice - prevClose) / prevClose * 100;
    // Corporate action filter — any single-day move >25% without a UC lock is almost certainly a bonus/split
    if (movePct > 25) continue;
    const isUCLock = !isNaN(highPrice) && highPrice > 0 && (highPrice - closePrice) / highPrice < 0.002;
    if (movePct >= minPct || (isUCLock && movePct > 0)) {
      results.push({ symbol, movePct, isUCLock, closePrice, prevClose, volume });
    }
  }
  return results.sort((a, b) => {
    if (a.isUCLock !== b.isUCLock) return a.isUCLock ? -1 : 1;
    return b.movePct - a.movePct;
  });
}

// ── Attempt 1: Public archive URL ─────────────────────────────────────────────
// NSE now serves only ONE bhavcopy: UDiFF format, ZIP, filename uses YYYYMMDD.
// Cookies are primed first — some Vercel edge regions get 403 without them.

async function tryArchive(dateStr: string, minPct: number, cookies: string): Promise<{ hitters: UCHitter[]; source: string } | null> {
  const { y, m, d } = parts(dateStr);
  const yyyymmdd = `${y}${m}${d}`;
  const url = `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${yyyymmdd}_F_0000.csv.zip`;

  try {
    const resp = await fetch(url, {
      headers: {
        ...NSE_BROWSER_HEADERS,
        accept: 'application/zip,application/octet-stream,*/*',
        referer: 'https://www.nseindia.com/all-reports',
        ...(cookies ? { cookie: cookies } : {}),
      },
      signal: AbortSignal.timeout(12000),
      next: { revalidate: 3600 },
    });
    if (!resp.ok) return null;

    const buf = new Uint8Array(await resp.arrayBuffer());
    const text = await unzipFirst(buf);
    if (!text) return null;

    const hitters = parseBhav(text, minPct);
    if (hitters.length > 0) return { hitters, source: url };
  } catch { /* fall through */ }
  return null;
}

// ── Cookie priming ────────────────────────────────────────────────────────────

async function primeCookies(): Promise<string> {
  try {
    const cr = await fetch('https://www.nseindia.com/all-reports', {
      headers: { ...NSE_BROWSER_HEADERS, 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' },
      signal: AbortSignal.timeout(6000), redirect: 'follow',
    });
    const setFn = (cr.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    return setFn
      ? setFn.call(cr.headers).map((c: string) => c.split(';')[0].trim()).join('; ')
      : extractCookies(cr.headers.get('set-cookie'));
  } catch { return ''; }
}

// ── Attempt 2: NSE merged-daily-reports API — authoritative link per date ─────
// Returns the actual bhavcopy URL for a given date, so we don't have to guess
// filenames if NSE ever changes them again.

async function tryReportsApi(dateStr: string, minPct: number, cookies: string): Promise<{ hitters: UCHitter[]; source: string } | null> {
  if (!cookies) return null;
  const { y, m, d } = parts(dateStr);
  const apiDate = `${d}-${m}-${y}`; // DD-MM-YYYY

  try {
    const listResp = await fetch(
      `https://www.nseindia.com/api/merged-daily-reports?key=favCapital&date=${apiDate}`,
      {
        headers: { ...NSE_API_HEADERS, cookie: cookies, referer: 'https://www.nseindia.com/all-reports' },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!listResp.ok) return null;
    const list = await listResp.json() as { name?: string; link?: string }[];
    const bhav = list.find(r => (r.name ?? '').toLowerCase().includes('bhavcopy') && (r.link ?? '').endsWith('.zip'));
    if (!bhav?.link) return null;

    const resp = await fetch(bhav.link, {
      headers: { ...NSE_BROWSER_HEADERS, cookie: cookies, referer: 'https://www.nseindia.com/all-reports' },
      signal: AbortSignal.timeout(12000),
    });
    if (!resp.ok) return null;
    const buf = new Uint8Array(await resp.arrayBuffer());
    const text = await unzipFirst(buf);
    if (!text) return null;

    const hitters = parseBhav(text, minPct);
    if (hitters.length > 0) return { hitters, source: bhav.link };
  } catch { /* fall through */ }
  return null;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const date   = req.nextUrl.searchParams.get('date');
  const minPct = parseFloat(req.nextUrl.searchParams.get('minPct') ?? '5');

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  // Quick weekend check (NSE is closed Saturday & Sunday)
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  if (dow === 0 || dow === 6) {
    return NextResponse.json(
      { error: `${date} is a ${dow === 6 ? 'Saturday' : 'Sunday'} — NSE is closed. Pick a weekday.`, date },
      { status: 404 }
    );
  }

  // Prime session cookies once; both attempts reuse them
  const cookies = await primeCookies();

  // Attempt 1: guessed archive URL (fastest, one round trip after cookies)
  const archiveResult = await tryArchive(date, minPct, cookies);
  if (archiveResult) {
    return NextResponse.json(
      { date, count: archiveResult.hitters.length, hitters: archiveResult.hitters, source: archiveResult.source },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } }
    );
  }

  // Attempt 2: ask NSE's own reports API for the authoritative link
  const apiResult = await tryReportsApi(date, minPct, cookies);
  if (apiResult) {
    return NextResponse.json(
      { date, count: apiResult.hitters.length, hitters: apiResult.hitters, source: apiResult.source },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } }
    );
  }

  return NextResponse.json(
    {
      error: `No bhavcopy data found for ${date}. It may be a market holiday, or NSE's archive is unavailable. Try a different date.`,
      date,
      tried: ['UDiFF BhavCopy zip', 'NSE merged-daily-reports API'],
    },
    { status: 404 }
  );
}
