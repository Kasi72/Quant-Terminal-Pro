// ─── fetch-bulk-deals ─────────────────────────────────────────────────────────
// Daily BSE bulk deal ingestion (Phase 3).
//
// Pipeline: fetch BSE report → parse by field NAME (never position) → normalize
// client names → pattern-classify → file-hash dedup → upsert raw rows → compute
// daily symbol scores → write audit record. Idempotent: safe to invoke 3× per
// evening (7:15 / 8:15 / 9:30 PM IST cron) — exits early once today succeeded.
//
// Alerting: failures land in market_data_ingestion_runs; optional Telegram push
// when TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID secrets are set.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const BSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.bseindia.com/',
  'Origin': 'https://www.bseindia.com',
};

// Candidate endpoints, tried in order. BSE's API surface shifts; parse by field
// name so a schema reshuffle degrades to "unrecognized" rather than bad data.
const BSE_ENDPOINTS = [
  'https://api.bseindia.com/BseIndiaAPI/api/BulkDeals/w',
  'https://api.bseindia.com/BseIndiaAPI/api/GetBulkDealsData/w?flag=0',
  'https://api.bseindia.com/BseIndiaAPI/api/GetBulkBlockDeal/w?flag=bulk',
];

interface RawDeal {
  dealDate: string;      // ISO
  scripCode: string;
  securityName: string;
  clientName: string;
  side: 'BUY' | 'SELL' | null;
  quantity: number;
  price: number;
}

// ── Field-name based extraction ──────────────────────────────────────────────
// BSE JSON rows vary in casing across endpoints (DealDate/Deal_Date/DT_TM etc).
// Match by lowercase substring of the key name.

function pick(row: Record<string, unknown>, ...needles: string[]): unknown {
  for (const [k, v] of Object.entries(row)) {
    const lk = k.toLowerCase();
    if (needles.some(n => lk.includes(n))) return v;
  }
  return undefined;
}

function parseDealRow(row: Record<string, unknown>): RawDeal | null {
  const dateRaw = String(pick(row, 'date', 'dt_tm', 'dttm') ?? '');
  const scrip = String(pick(row, 'scrip_cd', 'scripcode', 'scrip cd', 'code') ?? '').trim();
  const name = String(pick(row, 'scripname', 'scrip_name', 'sname', 'security') ?? '').trim();
  const client = String(pick(row, 'client', 'name of client', 'deal_client') ?? '').trim();
  const sideRaw = String(pick(row, 'buysell', 'buy_sell', 'dealtype', 'deal type', 'side') ?? '').toUpperCase();
  const qty = Number(String(pick(row, 'qty', 'quantity', 'shares') ?? '').replace(/,/g, ''));
  const price = Number(String(pick(row, 'price', 'rate', 'trade price') ?? '').replace(/,/g, ''));

  if (!name || !client || !Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price <= 0) return null;

  // Date formats seen: "2026-07-11T00:00:00", "11/07/2026", "11 Jul 2026"
  let iso = '';
  if (/^\d{4}-\d{2}-\d{2}/.test(dateRaw)) iso = dateRaw.slice(0, 10);
  else if (/^(\d{2})\/(\d{2})\/(\d{4})/.test(dateRaw)) {
    const m = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})/)!;
    iso = `${m[3]}-${m[2]}-${m[1]}`;
  } else {
    const d = new Date(dateRaw);
    if (!isNaN(d.getTime())) iso = d.toISOString().slice(0, 10);
  }
  if (!iso) return null;

  const side = sideRaw.startsWith('B') || sideRaw.includes('BUY') ? 'BUY'
             : sideRaw.startsWith('S') || sideRaw.includes('SELL') ? 'SELL' : null;

  return { dealDate: iso, scripCode: scrip, securityName: name, clientName: client, side, quantity: qty, price };
}

// ── Client normalization + pattern classification ───────────────────────────

function normalizeClient(name: string): string {
  return name.toUpperCase()
    .replace(/[.,'"()]/g, ' ')
    .replace(/\bLIMITED\b/g, 'LTD')
    .replace(/\bPRIVATE\b/g, 'PVT')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyClient(norm: string): string {
  if (/MUTUAL FUND|\bMF\b|TRUSTEE|INSURANCE|\bAIF\b|\bFPI\b|\bPMS\b|LIFE INS|ASSET MANAGEMENT|INVESTMENT MANAGER|PENSION/.test(norm)) return 'institutional';
  if (/PROMOTER|HOLDINGS PVT|FAMILY TRUST|VENTURES LLP/.test(norm)) return 'promoter_group';
  return 'unknown';
}

// ── Fetch + hash ─────────────────────────────────────────────────────────────

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function fetchBSE(): Promise<{ body: string; rows: Record<string, unknown>[] } | null> {
  for (const url of BSE_ENDPOINTS) {
    try {
      const res = await fetch(url, { headers: BSE_HEADERS, signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      const body = await res.text();
      const json = JSON.parse(body);
      // Rows may live under Table / data / result / the root array
      const rows = Array.isArray(json) ? json
        : json.Table ?? json.data ?? json.result ?? json.Data ?? null;
      if (Array.isArray(rows) && rows.length > 0) return { body, rows };
    } catch { /* try next endpoint */ }
  }
  return null;
}

// ── Scoring (robust MAD z over 180d history, same recipe as sector flow) ────

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function computeDailyScores(dealDate: string) {
  // Aggregate today's deals per symbol
  const { data: todays } = await supabase
    .from('bulk_deals')
    .select('symbol, side, deal_value, client_category, client_name_normalized')
    .eq('deal_date', dealDate);
  if (!todays?.length) return 0;

  const bySymbol = new Map<string, typeof todays>();
  for (const d of todays) {
    const arr = bySymbol.get(d.symbol) ?? [];
    arr.push(d); bySymbol.set(d.symbol, arr);
  }

  // 180-day net-buy history per symbol (single query)
  const since = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
  const { data: hist } = await supabase
    .from('bulk_deals')
    .select('symbol, deal_date, side, deal_value')
    .gte('deal_date', since)
    .lt('deal_date', dealDate)
    .in('symbol', [...bySymbol.keys()]);

  const histNet = new Map<string, Map<string, number>>(); // symbol → date → net
  for (const h of hist ?? []) {
    const m = histNet.get(h.symbol) ?? new Map<string, number>();
    const v = (h.side === 'BUY' ? 1 : h.side === 'SELL' ? -1 : 0) * (h.deal_value ?? 0);
    m.set(h.deal_date, (m.get(h.deal_date) ?? 0) + v);
    histNet.set(h.symbol, m);
  }

  const upserts = [];
  for (const [symbol, deals] of bySymbol) {
    const grossBuy = deals.filter(d => d.side === 'BUY').reduce((s, d) => s + (d.deal_value ?? 0), 0);
    const grossSell = deals.filter(d => d.side === 'SELL').reduce((s, d) => s + (d.deal_value ?? 0), 0);
    const net = grossBuy - grossSell;
    const netRatio = grossBuy + grossSell > 0 ? net / (grossBuy + grossSell) : 0;

    const flags: string[] = [];
    // Matched-deal red flag: same client on both sides same day
    const buyers = new Set(deals.filter(d => d.side === 'BUY').map(d => d.client_name_normalized));
    const sellers = new Set(deals.filter(d => d.side === 'SELL').map(d => d.client_name_normalized));
    if ([...buyers].some(b => sellers.has(b))) flags.push('matched_client');
    if (deals.some(d => d.client_category === 'promoter_group')) flags.push('promoter_involved');

    // Credibility: mean of category weights
    const catW: Record<string, number> = { institutional: 1.0, promoter_group: 0.4, operator_hni: 0.4, inter_se_transfer: 0.2, unknown: 0.5 };
    const cred = deals.reduce((s, d) => s + (catW[d.client_category] ?? 0.5), 0) / deals.length;

    // Abnormality z over history
    const histVals = [...(histNet.get(symbol)?.values() ?? [])];
    let z: number | null = null;
    let confidence = 'new_large_deal';
    if (histVals.length >= 10) {
      const med = median(histVals);
      const mad = Math.max(median(histVals.map(v => Math.abs(v - med))), 1);
      z = Math.max(-4, Math.min(4, 0.6745 * (net - med) / mad));
      confidence = histVals.length >= 60 ? 'high' : histVals.length >= 25 ? 'medium' : 'low';
    }

    // Composite 0–100: abnormality 45%, net ratio 25%, credibility 30%
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

// ── Telegram alert (optional) ────────────────────────────────────────────────

async function telegramAlert(msg: string) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chat = Deno.env.get('TELEGRAM_CHAT_ID');
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: msg }),
    });
  } catch { /* alerting is best-effort */ }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function todayIST(): string {
  return new Date(Date.now() + 19800_000).toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const isFinalAttempt = url.searchParams.get('final') === '1';
  const runDate = todayIST();

  // Idempotency: exit if today already succeeded
  const { data: prior } = await supabase
    .from('market_data_ingestion_runs')
    .select('id, attempt')
    .eq('source', 'bse_bulk_deals').eq('run_date', runDate).eq('status', 'success')
    .limit(1);
  if (prior?.length) {
    return Response.json({ ok: true, skipped: true, reason: 'already ingested today' });
  }

  const { data: attempts } = await supabase
    .from('market_data_ingestion_runs')
    .select('attempt').eq('source', 'bse_bulk_deals').eq('run_date', runDate)
    .order('attempt', { ascending: false }).limit(1);
  const attempt = (attempts?.[0]?.attempt ?? 0) + 1;

  const audit = async (status: string, rows: number, err?: string, hash?: string) => {
    await supabase.from('market_data_ingestion_runs').insert({
      source: 'bse_bulk_deals', run_date: runDate, attempt, status,
      rows_ingested: rows, error_message: err ?? null, source_file_hash: hash ?? null,
      completed_at: new Date().toISOString(),
    });
  };

  try {
    const fetched = await fetchBSE();
    if (!fetched) {
      await audit('error', 0, 'all BSE endpoints failed');
      if (isFinalAttempt) await telegramAlert(`⚠️ Bulk deal ingestion FAILED for ${runDate} — all BSE endpoints unreachable after final attempt.`);
      return Response.json({ ok: false, error: 'all BSE endpoints failed', attempt }, { status: 502 });
    }

    const hash = await sha256hex(fetched.body);

    // File-level dedup: same hash already ingested → skip whole file
    const { data: sameFile } = await supabase
      .from('market_data_ingestion_runs')
      .select('id').eq('source_file_hash', hash).eq('status', 'success').limit(1);
    if (sameFile?.length) {
      await audit('skipped', 0, 'identical file hash already ingested', hash);
      return Response.json({ ok: true, skipped: true, reason: 'duplicate file' });
    }

    const parsed = fetched.rows
      .map((r, i) => ({ deal: parseDealRow(r as Record<string, unknown>), seq: i }))
      .filter((x): x is { deal: RawDeal; seq: number } => x.deal !== null);

    if (parsed.length < 3) {
      await audit('empty', parsed.length, `only ${parsed.length} parseable rows`, hash);
      if (isFinalAttempt) await telegramAlert(`⚠️ Bulk deal ingestion for ${runDate}: only ${parsed.length} rows parsed — possible BSE schema change.`);
      return Response.json({ ok: false, error: 'too few rows', parsed: parsed.length, attempt });
    }

    // Symbol normalization via crossref (scrip code → NSE symbol), fallback to security name
    const scripCodes = [...new Set(parsed.map(p => p.deal.scripCode).filter(Boolean))];
    const { data: xref } = scripCodes.length
      ? await supabase.from('symbol_crossref').select('nse_symbol, bse_scrip_code').in('bse_scrip_code', scripCodes)
      : { data: [] };
    const codeToSymbol = new Map((xref ?? []).map(x => [x.bse_scrip_code, x.nse_symbol]));

    const rows = parsed.map(({ deal, seq }) => {
      const norm = normalizeClient(deal.clientName);
      const symbol = codeToSymbol.get(deal.scripCode)
        ?? deal.securityName.toUpperCase().replace(/\s+LTD\.?$/,'').replace(/[^A-Z0-9&-]/g, '').slice(0, 20);
      return {
        deal_date: deal.dealDate, exchange: 'BSE', symbol,
        bse_scrip_code: deal.scripCode || null, security_name: deal.securityName,
        client_name: deal.clientName, client_name_normalized: norm,
        client_category: classifyClient(norm),
        side: deal.side, quantity: deal.quantity, price: deal.price,
        row_seq: seq, source_file_hash: hash,
      };
    });

    // Inter-se detection: same normalized client both sides, same symbol, same date
    const key = (r: typeof rows[0], side: string) => `${r.deal_date}|${r.symbol}|${r.client_name_normalized}|${side}`;
    const buyKeys = new Set(rows.filter(r => r.side === 'BUY').map(r => key(r, '')));
    for (const r of rows) {
      if (r.side === 'SELL' && buyKeys.has(key(r, '')) && r.client_category === 'unknown') {
        r.client_category = 'inter_se_transfer';
      }
    }

    const { error: insErr } = await supabase
      .from('bulk_deals')
      .upsert(rows, { onConflict: 'deal_date,source_file_hash,row_seq', ignoreDuplicates: true });
    if (insErr) throw new Error(`deal upsert: ${insErr.message}`);

    // Score every deal date present in the file (usually just today)
    const dates = [...new Set(rows.map(r => r.deal_date))];
    let scored = 0;
    for (const d of dates) scored += await computeDailyScores(d);

    await audit('success', rows.length, undefined, hash);
    return Response.json({ ok: true, ingested: rows.length, scored, dates, attempt });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await audit('error', 0, msg);
    if (isFinalAttempt) await telegramAlert(`⚠️ Bulk deal ingestion ERROR for ${runDate}: ${msg}`);
    return Response.json({ ok: false, error: msg, attempt }, { status: 500 });
  }
});
