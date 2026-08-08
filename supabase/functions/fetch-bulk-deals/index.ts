// ─── fetch-bulk-deals v2 ──────────────────────────────────────────────────────
// NSE primary source, BSE fallback. Cookie preflight handles session requirements.

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

function todayIST(): string {
  return new Date(Date.now() + 19800_000).toISOString().slice(0, 10);
}
function toNSEDate(iso: string): string {
  const [y, m, d] = iso.split('-'); return `${d}-${m}-${y}`;
}
function toBSEDate(iso: string): string {
  return iso.replace(/-/g, '');
}

// ── Cookie preflight ─────────────────────────────────────────────────────────

async function getCookies(homeUrl: string): Promise<string> {
  try {
    const res = await fetch(homeUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    const raw: string[] = (res.headers as unknown as { getSetCookie?(): string[] }).getSetCookie?.()
      ?? [res.headers.get('set-cookie') ?? ''];
    return raw.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
  } catch { return ''; }
}

// ── CSV parser ─────────────────────────────────────────────────────────────────

function parseCSVtoRows(csv: string): Record<string, unknown>[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  return lines.slice(1)
    .map(line => {
      const vals = line.split(',');
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => { obj[h] = (vals[i] ?? '').trim(); });
      return obj;
    })
    .filter(r => Object.values(r).some(v => v !== ''));
}

// ── Fetch strategies ─────────────────────────────────────────────────────────

type FetchResult = { body: string; rows: Record<string, unknown>[]; source: string };

async function tryNSEArchivesCSV(dateISO: string): Promise<FetchResult | null> {
  try {
    const res = await fetch('https://nsearchives.nseindia.com/content/equities/bulk.csv', {
      headers: { 'User-Agent': UA, 'Accept': 'text/csv,*/*', 'Referer': 'https://www.nseindia.com/' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const body = await res.text();
    if (!body.includes(',') || body.trim().length < 50) return null;
    const rows = parseCSVtoRows(body);
    if (rows.length < 1) return null;
    const todayNSE = toNSEDate(dateISO).toUpperCase();
    const todayRows = rows.filter(r => {
      const d = String(r['date'] ?? r['trade_date'] ?? r['dt'] ?? '').toUpperCase();
      return !d || d.includes(todayNSE.replace(/-/g, ' ').slice(0, 7)) || d === todayNSE || d.startsWith(dateISO);
    });
    return { body, rows: todayRows.length > 0 ? todayRows : rows, source: 'nse_archives_csv' };
  } catch { return null; }
}

async function tryNSEApiWithCookies(dateISO: string): Promise<FetchResult | null> {
  const cookies = await getCookies('https://www.nseindia.com/');
  const nseDate = toNSEDate(dateISO);
  const headers: Record<string, string> = {
    'User-Agent': UA, 'Accept': 'application/json,*/*', 'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.nseindia.com/market-data/bulk-block-deals',
  };
  if (cookies) headers['Cookie'] = cookies;
  for (const url of [
    `https://www.nseindia.com/api/bulk-deals-archives?from=${nseDate}&to=${nseDate}`,
    `https://www.nseindia.com/api/bulk-deals?from=${nseDate}&to=${nseDate}`,
  ]) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      const body = await res.text();
      const json = JSON.parse(body);
      const rows = Array.isArray(json) ? json : (json.data ?? json.result ?? null);
      if (Array.isArray(rows) && rows.length > 0) return { body, rows, source: 'nse_api' };
    } catch { /* try next */ }
  }
  return null;
}

async function tryBSEApiWithCookies(dateISO: string): Promise<FetchResult | null> {
  const cookies = await getCookies('https://www.bseindia.com/');
  const bseDate = toBSEDate(dateISO);
  const headers: Record<string, string> = {
    'User-Agent': UA, 'Accept': 'application/json,*/*', 'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.bseindia.com/', 'Origin': 'https://www.bseindia.com',
  };
  if (cookies) headers['Cookie'] = cookies;
  for (const url of [
    `https://api.bseindia.com/BseIndiaAPI/api/BulkDeals/w?dttm=${bseDate}`,
    `https://api.bseindia.com/BseIndiaAPI/api/GetBulkDealsData/w?flag=0&dttm=${bseDate}`,
    'https://api.bseindia.com/BseIndiaAPI/api/BulkDeals/w',
  ]) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      const body = await res.text();
      const json = JSON.parse(body);
      const rows = Array.isArray(json) ? json : (json.Table ?? json.data ?? json.result ?? json.Data ?? null);
      if (Array.isArray(rows) && rows.length > 0) return { body, rows, source: 'bse_api' };
    } catch { /* try next */ }
  }
  return null;
}

async function fetchDeals(dateISO: string): Promise<FetchResult | null> {
  const r1 = await tryNSEArchivesCSV(dateISO);
  if (r1) return r1;
  const r2 = await tryNSEApiWithCookies(dateISO);
  if (r2) return r2;
  return tryBSEApiWithCookies(dateISO);
}

// ── Field-name extraction ──────────────────────────────────────────────────────

function pick(row: Record<string, unknown>, ...needles: string[]): unknown {
  for (const [k, v] of Object.entries(row)) {
    const lk = k.toLowerCase();
    if (needles.some(n => lk.includes(n))) return v;
  }
  return undefined;
}

interface RawDeal {
  dealDate: string; scripCode: string; securityName: string;
  clientName: string; side: 'BUY' | 'SELL' | null; quantity: number; price: number;
}

const MONTHS: Record<string, string> = {
  JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',
  JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12',
};

function parseDate(raw: string, fallback: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const dmy = raw.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const dMonY = raw.match(/^(\d{2})-([A-Z]{3})-(\d{4})/i);
  if (dMonY) return `${dMonY[3]}-${MONTHS[dMonY[2].toUpperCase()] ?? '01'}-${dMonY[1]}`;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? fallback : d.toISOString().slice(0, 10);
}

function parseDealRow(row: Record<string, unknown>, dateISO: string): RawDeal | null {
  const dateRaw = String(pick(row, 'date', 'dt_tm', 'dttm', 'trade_date') ?? dateISO);
  const scrip = String(pick(row, 'scrip_cd', 'scripcode', 'code', 'symbol') ?? '').trim();
  const name = String(
    pick(row, 'scripname', 'scrip_name', 'sname', 'security_name', 'security', 'name_of_security') ??
    pick(row, 'symbol') ?? ''
  ).trim();
  const client = String(pick(row, 'client', 'name_of_client', 'deal_client', 'client_name') ?? '').trim();
  const sideRaw = String(
    pick(row, 'buysell', 'buy_sell', 'dealtype', 'deal_type', 'side', 'transaction_type') ?? ''
  ).toUpperCase();
  const qty = Number(String(pick(row, 'qty', 'quantity', 'shares', 'quantity_traded') ?? '').replace(/,/g, ''));
  const price = Number(String(pick(row, 'price', 'rate', 'trade_price', 'avg_price') ?? '').replace(/,/g, ''));

  if (!name || !client || !Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price <= 0) return null;

  const side: 'BUY' | 'SELL' | null =
    sideRaw.startsWith('B') || sideRaw === 'P' ? 'BUY'
    : sideRaw.startsWith('S') ? 'SELL'
    : null;

  return { dealDate: parseDate(dateRaw, dateISO), scripCode: scrip, securityName: name, clientName: client, side, quantity: qty, price };
}

// ── Client classification ────────────────────────────────────────────────────

function normalizeClient(name: string): string {
  return name.toUpperCase()
    .replace(/[.,\'"()]/g, ' ').replace(/\bLIMITED\b/g, 'LTD').replace(/\bPRIVATE\b/g, 'PVT')
    .replace(/\s+/g, ' ').trim();
}

function classifyClient(norm: string): string {
  if (/MUTUAL FUND|\bMF\b|TRUSTEE|INSURANCE|\bAIF\b|\bFPI\b|\bPMS\b|LIFE INS|ASSET MANAGEMENT|INVESTMENT MANAGER|PENSION/.test(norm))
    return 'institutional';
  if (/PROMOTER|HOLDINGS PVT|FAMILY TRUST|VENTURES LLP/.test(norm)) return 'promoter_group';
  return 'unknown';
}

// Rights entitlements / rights issues are not tradeable equity and never map to a
// screener symbol — they only pollute the top of the score list. NSE tags them with
// a "-RE" symbol suffix (e.g. GANGAFO-RE); BSE names them "... RIGHTS".
function isRightsInstrument(symbol: string, securityName: string): boolean {
  return /-RE$/i.test(symbol) || /\bRIGHTS?\b/i.test(securityName);
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function computeDailyScores(dealDate: string): Promise<number> {
  const { data: todays } = await supabase
    .from('bulk_deals')
    .select('symbol, side, deal_value, client_category, client_name_normalized')
    .eq('deal_date', dealDate);
  if (!todays?.length) return 0;

  const bySymbol = new Map<string, typeof todays>();
  for (const d of todays) {
    const arr = bySymbol.get(d.symbol) ?? []; arr.push(d); bySymbol.set(d.symbol, arr);
  }

  const since = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
  const { data: hist } = await supabase
    .from('bulk_deals').select('symbol, deal_date, side, deal_value')
    .gte('deal_date', since).lt('deal_date', dealDate).in('symbol', [...bySymbol.keys()]);

  const histNet = new Map<string, Map<string, number>>();
  for (const h of hist ?? []) {
    const m = histNet.get(h.symbol) ?? new Map<string, number>();
    const v = (h.side === 'BUY' ? 1 : h.side === 'SELL' ? -1 : 0) * (h.deal_value ?? 0);
    m.set(h.deal_date, (m.get(h.deal_date) ?? 0) + v);
    histNet.set(h.symbol, m);
  }

  const upserts = [];
  for (const [symbol, deals] of bySymbol) {
    const grossBuy  = deals.filter(d => d.side === 'BUY').reduce((s, d) => s + (d.deal_value ?? 0), 0);
    const grossSell = deals.filter(d => d.side === 'SELL').reduce((s, d) => s + (d.deal_value ?? 0), 0);
    const net = grossBuy - grossSell;
    const netRatio = (grossBuy + grossSell) > 0 ? net / (grossBuy + grossSell) : 0;

    const flags: string[] = [];
    const buyers  = new Set(deals.filter(d => d.side === 'BUY').map(d => d.client_name_normalized));
    const sellers = new Set(deals.filter(d => d.side === 'SELL').map(d => d.client_name_normalized));
    if ([...buyers].some(b => sellers.has(b))) flags.push('matched_client');
    if (deals.some(d => d.client_category === 'promoter_group')) flags.push('promoter_involved');

    const catW: Record<string, number> = {
      institutional: 1.0, promoter_group: 0.4, operator_hni: 0.4, inter_se_transfer: 0.2, unknown: 0.5,
    };
    const cred = deals.reduce((s, d) => s + (catW[d.client_category] ?? 0.5), 0) / deals.length;

    const histVals = [...(histNet.get(symbol)?.values() ?? [])];
    let z: number | null = null;
    let confidence = 'new_large_deal';
    if (histVals.length >= 10) {
      const med = median(histVals);
      const mad = Math.max(median(histVals.map(v => Math.abs(v - med))), 1);
      z = Math.max(-4, Math.min(4, 0.6745 * (net - med) / mad));
      confidence = histVals.length >= 60 ? 'high' : histVals.length >= 25 ? 'medium' : 'low';
    }

    const zScore = z != null ? ((z + 4) / 8) * 100 : (net > 0 ? 65 : 35);
    let final = 0.45 * zScore + 0.25 * ((netRatio + 1) / 2) * 100 + 0.30 * cred * 100;
    if (flags.includes('matched_client')) final = Math.min(final, 45);

    upserts.push({
      deal_date: dealDate, symbol,
      gross_buy_value: grossBuy, gross_sell_value: grossSell,
      net_buy_value: net, net_buy_ratio: Number(netRatio.toFixed(4)),
      abnormality_z: z, client_credibility: Number(cred.toFixed(3)),
      final_bulk_score: Math.round(final), confidence, flags,
    });
  }

  const { error } = await supabase.from('bulk_deal_daily_scores').upsert(upserts);
  if (error) throw new Error(`score upsert: ${error.message}`);
  return upserts.length;
}

async function telegramAlert(msg: string) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chat  = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: msg }),
    });
  } catch { /* best-effort */ }
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  const isFinalAttempt = new URL(req.url).searchParams.get('final') === '1';
  const runDate = todayIST();

  const { data: prior } = await supabase
    .from('market_data_ingestion_runs')
    .select('id').eq('source', 'bse_bulk_deals').eq('run_date', runDate).eq('status', 'success').limit(1);
  if (prior?.length) return Response.json({ ok: true, skipped: true, reason: 'already ingested today' });

  const { data: attempts } = await supabase
    .from('market_data_ingestion_runs')
    .select('attempt').eq('source', 'bse_bulk_deals').eq('run_date', runDate)
    .order('attempt', { ascending: false }).limit(1);
  const attempt = (attempts?.[0]?.attempt ?? 0) + 1;

  const audit = async (status: string, rows: number, err?: string, hash?: string) =>
    supabase.from('market_data_ingestion_runs').insert({
      source: 'bse_bulk_deals', run_date: runDate, attempt, status,
      rows_ingested: rows, error_message: err ?? null, source_file_hash: hash ?? null,
      completed_at: new Date().toISOString(),
    });

  try {
    const fetched = await fetchDeals(runDate);
    if (!fetched) {
      await audit('error', 0, 'all sources failed (NSE CSV, NSE API, BSE API)');
      if (isFinalAttempt) await telegramAlert(`⚠️ Bulk deal ingestion FAILED ${runDate} — all sources unreachable.`);
      return Response.json({ ok: false, error: 'all sources failed', attempt }, { status: 502 });
    }

    const hash = await sha256hex(fetched.body);
    const { data: sameFile } = await supabase
      .from('market_data_ingestion_runs').select('id').eq('source_file_hash', hash).eq('status', 'success').limit(1);
    if (sameFile?.length) {
      await audit('skipped', 0, 'duplicate file hash', hash);
      return Response.json({ ok: true, skipped: true, reason: 'duplicate file' });
    }

    const parsed = fetched.rows
      .map((r, i) => ({ deal: parseDealRow(r as Record<string, unknown>, runDate), seq: i }))
      .filter((x): x is { deal: RawDeal; seq: number } => x.deal !== null);

    if (parsed.length < 3) {
      await audit('empty', parsed.length, `only ${parsed.length} parseable rows`, hash);
      if (isFinalAttempt) await telegramAlert(`⚠️ Bulk deal ${runDate}: only ${parsed.length} rows. Source: ${fetched.source}`);
      return Response.json({ ok: false, error: 'too few rows', parsed: parsed.length, source: fetched.source, attempt });
    }

    const scripCodes = [...new Set(parsed.map(p => p.deal.scripCode).filter(Boolean))];
    const { data: xref } = scripCodes.length
      ? await supabase.from('symbol_crossref').select('nse_symbol, bse_scrip_code').in('bse_scrip_code', scripCodes)
      : { data: [] };
    const codeToSymbol = new Map((xref ?? []).map((x: { bse_scrip_code: string; nse_symbol: string }) => [x.bse_scrip_code, x.nse_symbol]));

    const isNSE = fetched.source.startsWith('nse');
    const rows = parsed.map(({ deal, seq }) => {
      const norm = normalizeClient(deal.clientName);
      let symbol: string;
      if (isNSE) {
        // NSE: scripCode IS the NSE trading symbol
        symbol = deal.scripCode || deal.securityName.toUpperCase().replace(/\s+LTD\.?$/, '').replace(/[^A-Z0-9&]/g, '').slice(0, 20);
      } else {
        const mapped = codeToSymbol.get(deal.scripCode);
        symbol = mapped ?? deal.securityName.toUpperCase().replace(/\s+LTD\.?$/, '').replace(/[^A-Z0-9&]/g, '').slice(0, 20);
      }
      return {
        deal_date: deal.dealDate, exchange: isNSE ? 'NSE' : 'BSE', symbol,
        bse_scrip_code: isNSE ? null : (deal.scripCode || null),
        security_name: deal.securityName,
        client_name: deal.clientName, client_name_normalized: norm,
        client_category: classifyClient(norm),
        side: deal.side, quantity: deal.quantity, price: deal.price,
        row_seq: seq, source_file_hash: hash,
      };
    })
    // Skip rights entitlements / rights issues — not tradeable equity (see isRightsInstrument).
    .filter(r => !isRightsInstrument(r.symbol, r.security_name));

    const key = (r: typeof rows[0]) => `${r.deal_date}|${r.symbol}|${r.client_name_normalized}`;
    const buyKeys = new Set(rows.filter(r => r.side === 'BUY').map(key));
    for (const r of rows) {
      if (r.side === 'SELL' && buyKeys.has(key(r)) && r.client_category === 'unknown')
        r.client_category = 'inter_se_transfer';
    }

    const { error: insErr } = await supabase
      .from('bulk_deals').upsert(rows, { onConflict: 'deal_date,source_file_hash,row_seq', ignoreDuplicates: true });
    if (insErr) throw new Error(`deal upsert: ${insErr.message}`);

    const dates = [...new Set(rows.map(r => r.deal_date))];
    let scored = 0;
    for (const d of dates) scored += await computeDailyScores(d);

    await audit('success', rows.length, undefined, hash);
    return Response.json({ ok: true, ingested: rows.length, scored, dates, source: fetched.source, attempt });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit('error', 0, msg);
    if (isFinalAttempt) await telegramAlert(`⚠️ Bulk deal ERROR ${runDate}: ${msg}`);
    return Response.json({ ok: false, error: msg, attempt }, { status: 500 });
  }
});
