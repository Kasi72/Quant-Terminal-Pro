// ─── refresh-symbol-crossref ──────────────────────────────────────────────────
// Rebuilds symbol_crossref (BSE scrip code → NSE symbol) by joining two static,
// no-session CSVs on ISIN:
//   • NSE  EQUITY_L.csv          → nse_symbol + isin_number   (~2400 equities)
//   • BSE  UDiFF equity bhavcopy → fininstrmid (scrip code) + isin  (~4800 rows)
// Same source class as the bulk-deal NSE archives feed — both fetch fine from the
// Deno runtime without cookies. Intended to run on a weekly cron.
//
// Only ISIN-matched rows are upserted, so a stock temporarily absent from the
// bhavcopy never clobbers an existing good mapping with a null scrip code.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-token',
};

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function isAuthorized(req: Request): boolean {
  const secret = Deno.env.get('FUNCTION_INTERNAL_TOKEN') ?? Deno.env.get('CRON_SECRET');
  if (!secret) return false;
  return req.headers.get('x-internal-token') === secret
    || req.headers.get('authorization') === `Bearer ${secret}`;
}

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  return lines.slice(1)
    .map(line => {
      const vals = line.split(',');
      const o: Record<string, string> = {};
      header.forEach((h, i) => { o[h] = (vals[i] ?? '').trim(); });
      return o;
    })
    .filter(r => Object.values(r).some(v => v !== ''));
}

async function fetchText(url: string, referer: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9', 'Referer': referer },
      signal: AbortSignal.timeout(20000), redirect: 'follow',
    });
    if (!res.ok) return null;
    const t = await res.text();
    return t.includes(',') ? t : null;
  } catch { return null; }
}

// YYYYMMDD for (today IST − offsetDays)
function istYMD(offsetDays: number): string {
  return new Date(Date.now() + 19800_000 - offsetDays * 86400_000).toISOString().slice(0, 10).replace(/-/g, '');
}

// The bhavcopy is published EOD, so today's may not exist yet / weekends are gaps.
// Walk back up to a week to the most recent available file.
async function fetchBSEBhavcopy(): Promise<{ rows: Record<string, string>[]; date: string } | null> {
  for (let i = 0; i < 7; i++) {
    const ymd = istYMD(i);
    const url = `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${ymd}_F_0000.CSV`;
    const csv = await fetchText(url, 'https://www.bseindia.com/');
    if (csv) {
      const rows = parseCSV(csv);
      if (rows.length > 100 && 'fininstrmid' in rows[0] && 'isin' in rows[0]) return { rows, date: ymd };
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  try {
    // 1. NSE equity master: isin → symbol/name
    const nseCsv = await fetchText('https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv', 'https://www.nseindia.com/');
    if (!nseCsv) return Response.json({ ok: false, error: 'NSE EQUITY_L fetch failed' }, { status: 502 });
    const nseRows = parseCSV(nseCsv).filter(r => /^IN/i.test(r['isin_number'] ?? '') && (r['symbol'] ?? ''));
    if (nseRows.length < 500) return Response.json({ ok: false, error: `NSE list too small (${nseRows.length})` }, { status: 502 });

    // 2. BSE bhavcopy: isin → scrip code (first equity STK row wins)
    const bse = await fetchBSEBhavcopy();
    if (!bse) return Response.json({ ok: false, error: 'BSE bhavcopy fetch failed (7-day lookback)' }, { status: 502 });
    const isinToCode = new Map<string, string>();
    for (const r of bse.rows) {
      if (r['fininstrmtp'] !== 'STK') continue;
      const isin = (r['isin'] ?? '').toUpperCase();
      const code = r['fininstrmid'] ?? '';
      if (/^IN/.test(isin) && code && !isinToCode.has(isin)) isinToCode.set(isin, code);
    }

    // 3. join on ISIN — matched rows only
    const now = new Date().toISOString();
    const upserts = [];
    for (const r of nseRows) {
      const isin = (r['isin_number'] ?? '').toUpperCase();
      const code = isinToCode.get(isin);
      if (!code) continue; // NSE-only or unmatched — leave existing mapping untouched
      upserts.push({
        nse_symbol: r['symbol'], bse_scrip_code: code, isin,
        company_name: r['name_of_company'] ?? null, updated_at: now,
      });
    }

    // 4. chunked upsert
    let written = 0;
    for (let i = 0; i < upserts.length; i += 500) {
      const chunk = upserts.slice(i, i + 500);
      const { error } = await supabase.from('symbol_crossref').upsert(chunk, { onConflict: 'nse_symbol' });
      if (error) throw new Error(`crossref upsert: ${error.message}`);
      written += chunk.length;
    }

    return Response.json({
      ok: true, nseEquities: nseRows.length, bseIsinMappings: isinToCode.size,
      matched: upserts.length, written, bseBhavcopyDate: bse.date,
    });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
});
