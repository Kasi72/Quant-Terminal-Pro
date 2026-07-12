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

const MON_MIXED = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MON_UPPER = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function parts(dateStr: string) {
  // dateStr = "YYYY-MM-DD"
  const [y, m, d] = dateStr.split('-');
  const mi = parseInt(m, 10) - 1;
  return { y, m, d: d.padStart(2, '0'), mi };
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

// sec_bhavdata_full columns:
//   SYMBOL,SERIES,DATE1,PREV_CLOSE,OPEN_PRICE,HIGH_PRICE,LOW_PRICE,LAST_PRICE,
//   CLOSE_PRICE,AVG_PRICE,TTL_TRD_QNTY,TURNOVER_LACS,NO_OF_TRADES,DELIV_QTY,DELIV_PER
function parseSecBhav(text: string, minPct: number): UCHitter[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const hdr = lines[0].split(',').map(h => h.trim().replace(/\r/g, '').toUpperCase());
  const c = (n: string) => hdr.indexOf(n);
  const iSym = c('SYMBOL'), iSer = c('SERIES'), iPrev = c('PREV_CLOSE'),
        iHi  = c('HIGH_PRICE'), iCl = c('CLOSE_PRICE'), iVol = c('TTL_TRD_QNTY');
  if (iSym < 0 || iCl < 0 || iPrev < 0) return [];
  return filterRows(lines.slice(1), iSym, iSer, iPrev, iHi, iCl, iVol, minPct);
}

// CM bhavcopy (old/new ZIP) columns:
//   SYMBOL,SERIES,OPEN,HIGH,LOW,CLOSE,LAST,PREVCLOSE,TOTTRDQTY,...
function parseCMBhav(text: string, minPct: number): UCHitter[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const hdr = lines[0].split(',').map(h => h.trim().replace(/\r/g, '').toUpperCase());
  const c = (n: string) => hdr.indexOf(n);
  const iSym = c('SYMBOL'), iSer = c('SERIES'), iPrev = c('PREVCLOSE'),
        iHi  = c('HIGH'), iCl = c('CLOSE'), iVol = c('TOTTRDQTY');
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

// ── Attempt 1: Public archive URLs (no auth) ──────────────────────────────────

async function tryArchive(dateStr: string, minPct: number): Promise<{ hitters: UCHitter[]; source: string } | null> {
  const { y, m, d, mi } = parts(dateStr);
  const ddmmyyyy = `${d}${m}${y}`;

  const candidates: { url: string; parser: (t: string, p: number) => UCHitter[]; zip?: boolean }[] = [
    // sec_bhavdata_full — plain CSV, preferred
    { url: `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${d}${MON_MIXED[mi]}${y}.csv`, parser: parseSecBhav },
    { url: `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${d}${MON_UPPER[mi]}${y}.csv`, parser: parseSecBhav },
    // CM bhavcopy (new format, post-2024) — ZIP
    { url: `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_${ddmmyyyy}_F_0000.csv.zip`, parser: parseCMBhav, zip: true },
    // CM bhavcopy (old format) — ZIP
    { url: `https://nsearchives.nseindia.com/content/cm/cm${d}${MON_UPPER[mi]}${y}bhav.csv.zip`, parser: parseCMBhav, zip: true },
  ];

  for (const { url, parser, zip } of candidates) {
    try {
      const resp = await fetch(url, {
        headers: { ...NSE_BROWSER_HEADERS, accept: 'text/csv,application/zip,*/*' },
        signal: AbortSignal.timeout(10000),
        next: { revalidate: 3600 },
      });
      if (!resp.ok) continue;

      let text: string | null;
      if (zip) {
        const buf = new Uint8Array(await resp.arrayBuffer());
        text = await unzipFirst(buf);
      } else {
        text = await resp.text();
      }

      if (!text) continue;
      const hitters = parser(text, minPct);
      if (hitters.length > 0) return { hitters, source: url };
    } catch { continue; }
  }
  return null;
}

// ── Attempt 2: NSE API with cookie auth ───────────────────────────────────────

async function tryNSEapi(dateStr: string, minPct: number): Promise<{ hitters: UCHitter[]; source: string } | null> {
  const { y, m, d } = parts(dateStr);
  const nseDate = `${d}-${m}-${y}`;  // DD-MM-YYYY

  // Cookie preflight — visit a page that sets session cookies
  let cookies = '';
  try {
    const cr = await fetch('https://www.nseindia.com/market-data/live-equity-market', {
      headers: { ...NSE_BROWSER_HEADERS, 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' },
      signal: AbortSignal.timeout(6000), redirect: 'follow',
    });
    const setFn = (cr.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    cookies = setFn
      ? setFn.call(cr.headers).map((c: string) => c.split(';')[0].trim()).join('; ')
      : extractCookies(cr.headers.get('set-cookie'));
  } catch { return null; }

  if (!cookies) return null;

  // Try NSE bhavcopy report download
  const archives = JSON.stringify([{
    name: 'CM - Bhavcopy of NSE', type: 'archives',
    category: 'capital-market', section: 'equities',
  }]);
  const reportUrl = `https://www.nseindia.com/api/reports?archives=${encodeURIComponent(archives)}&date=${nseDate}&type=equity&mode=single`;

  try {
    const resp = await fetch(reportUrl, {
      headers: { ...NSE_API_HEADERS, cookie: cookies },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    if (!resp.ok) return null;

    const ct = resp.headers.get('content-type') ?? '';
    let text: string | null = null;

    if (ct.includes('text') || ct.includes('csv')) {
      text = await resp.text();
    } else if (ct.includes('zip') || ct.includes('octet-stream')) {
      const buf = new Uint8Array(await resp.arrayBuffer());
      text = await unzipFirst(buf);
    }

    if (!text) return null;

    // Try both parsers — we don't know which format NSE returns
    const hitters = parseSecBhav(text, minPct).length > 0
      ? parseSecBhav(text, minPct)
      : parseCMBhav(text, minPct);

    if (hitters.length > 0) return { hitters, source: 'nse-api-cookie' };
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

  // Attempt 1: public archive (fastest, no auth)
  const archiveResult = await tryArchive(date, minPct);
  if (archiveResult) {
    return NextResponse.json(
      { date, count: archiveResult.hitters.length, hitters: archiveResult.hitters, source: archiveResult.source },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } }
    );
  }

  // Attempt 2: NSE API with cookies
  const apiResult = await tryNSEapi(date, minPct);
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
      tried: ['sec_bhavdata_full (mixed/upper)', 'BhavCopy_NSE_CM zip (new format)', 'cm...bhav.csv.zip (old format)', 'NSE reports API with cookies'],
    },
    { status: 404 }
  );
}
