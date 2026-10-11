'use strict';
// backfill_bulk_deals.js — load NSE bulk-deal history and rebuild bulk_deal_daily_scores.
// Source: NSE historical bulk-deal CSV export (full rows; the JSON API caps at 70 per call).
// Row cleaning and scoring mirror supabase/functions/fetch-bulk-deals, except the history window
// is anchored on each deal date (the live function anchors on "now", equivalent for same-day runs).
// Dates already present in bulk_deals are not re-ingested; all scores in range are recomputed.
//
// Usage: node scripts/backfill_bulk_deals.js [--days=180] [--dry]

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MONTHS = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
const CAT_W = { institutional: 1.0, promoter_group: 0.4, operator_hni: 0.4, inter_se_transfer: 0.2, unknown: 0.5 };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = d => d.toISOString().slice(0, 10);
const nseDate = s => { const [y, m, d] = s.split('-'); return `${d}-${m}-${y}`; };

function parseLine(line) {
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(x => x.trim());
}
const normalizeClient = n => n.toUpperCase().replace(/[.,'"()]/g, ' ').replace(/\bLIMITED\b/g, 'LTD')
  .replace(/\bPRIVATE\b/g, 'PVT').replace(/\s+/g, ' ').trim();
function classifyClient(n) {
  if (/MUTUAL FUND|\bMF\b|TRUSTEE|INSURANCE|\bAIF\b|\bFPI\b|\bPMS\b|LIFE INS|ASSET MANAGEMENT|INVESTMENT MANAGER|PENSION/.test(n)) return 'institutional';
  if (/PROMOTER|HOLDINGS PVT|FAMILY TRUST|VENTURES LLP/.test(n)) return 'promoter_group';
  return 'unknown';
}
const isRights = (sym, name) => /-RE$/i.test(sym) || /\bRIGHTS?\b/i.test(name);
const median = xs => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function nseCookies() {
  const r = await fetch('https://www.nseindia.com/', { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' } });
  return (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
}
async function fetchRange(from, to, cookie) {
  const url = `https://www.nseindia.com/api/historicalOR/bulk-block-short-deals?optionType=bulk_deals&from=${nseDate(from)}&to=${nseDate(to)}&csv=true`;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', Referer: 'https://www.nseindia.com/report-detail/display-bulk-and-block-deals', Cookie: cookie }, signal: AbortSignal.timeout(30000) });
      const t = await r.text();
      if (r.ok && t.includes('Symbol')) return t.replace(/^﻿/, '').trim().split(/\r?\n/).slice(1).map(parseLine);
      cookie = await nseCookies();
    } catch { /* retry */ }
    await sleep(1500 * (a + 1));
  }
  throw new Error(`NSE fetch failed ${from}..${to}`);
}

(async function main() {
  const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
  const DAYS = Number(arg('days', 180)), DRY = process.argv.includes('--dry');
  const env = {};
  for (const l of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/); if (m) env[m[1]] = m[2].trim();
  }
  const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
  const rest = async (p, opt = {}) => {
    const r = await fetch(`${URL}/rest/v1/${p}`, { ...opt, headers: { ...H, ...(opt.headers || {}) } });
    if (!r.ok) throw new Error(`${p.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.status === 204 || r.status === 201 ? null : r.json();
  };

  const today = new Date(Date.now() + 19800_000);
  const start = new Date(today.getTime() - DAYS * 86400_000);
  const startISO = iso(start), endISO = iso(today);

  // 1. Fetch NSE history month by month
  let cookie = await nseCookies();
  const raw = [];
  for (let d = new Date(start); d <= today; ) {
    const from = iso(d);
    const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    const to = iso(monthEnd < today ? monthEnd : today);
    const rows = await fetchRange(from, to, cookie);
    raw.push(...rows);
    console.log(`  ${from} → ${to}: ${rows.length} rows`);
    d = new Date(monthEnd.getTime() + 86400_000);
    await sleep(1200);
  }

  // 2. Clean rows exactly like the live function, grouped per deal date
  const existing = new Set((await rest(`bulk_deals?select=deal_date&deal_date=gte.${startISO}`)).map(r => r.deal_date));
  const byDate = new Map();
  for (const c of raw) {
    const m = (c[0] || '').match(/^(\d{2})-([A-Z]{3})-(\d{4})$/i);
    if (!m) continue;
    const date = `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1]}`;
    const qty = Number((c[5] || '').replace(/,/g, '')), price = Number((c[6] || '').replace(/,/g, ''));
    const side = /^B/i.test(c[4]) ? 'BUY' : /^S/i.test(c[4]) ? 'SELL' : null;
    if (!c[1] || !c[3] || !(qty > 0) || !(price > 0)) continue;
    if (isRights(c[1], c[2])) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({ symbol: c[1], security_name: c[2], client_name: c[3], side, quantity: qty, price });
  }
  const newRows = [];
  for (const [date, rows] of byDate) {
    if (existing.has(date)) continue;
    const hash = 'nse_hist_' + crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    const mapped = rows.map((r, i) => {
      const norm = normalizeClient(r.client_name);
      return { deal_date: date, exchange: 'NSE', symbol: r.symbol, bse_scrip_code: null, security_name: r.security_name,
        client_name: r.client_name, client_name_normalized: norm, client_category: classifyClient(norm),
        side: r.side, quantity: r.quantity, price: r.price, row_seq: i, source_file_hash: hash };
    });
    const key = r => `${r.deal_date}|${r.symbol}|${r.client_name_normalized}`;
    const buyKeys = new Set(mapped.filter(r => r.side === 'BUY').map(key));
    for (const r of mapped) if (r.side === 'SELL' && buyKeys.has(key(r)) && r.client_category === 'unknown') r.client_category = 'inter_se_transfer';
    newRows.push(...mapped);
  }
  console.log(`NSE dates ${byDate.size} (already in DB: ${[...byDate.keys()].filter(d => existing.has(d)).length}) | new rows ${newRows.length}`);
  if (DRY) return;

  for (let i = 0; i < newRows.length; i += 500) {
    await rest('bulk_deals?on_conflict=deal_date,source_file_hash,row_seq', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(newRows.slice(i, i + 500)),
    });
  }
  console.log(`inserted ${newRows.length} deal rows`);

  // 3. Recompute daily scores for every date in range, oldest first, history anchored on deal date
  const all = [];
  for (let off = 0; ; off += 1000) {
    const page = await rest(`bulk_deals?select=deal_date,symbol,side,deal_value,client_category,client_name_normalized&deal_date=gte.${iso(new Date(start.getTime() - 180 * 86400_000))}&order=deal_date.asc,id.asc&limit=1000&offset=${off}`);
    all.push(...page); if (page.length < 1000) break;
  }
  const netByDate = new Map(); // symbol -> Map(date -> signed net value)
  for (const d of all) {
    const v = (d.side === 'BUY' ? 1 : d.side === 'SELL' ? -1 : 0) * (+d.deal_value || 0);
    if (!netByDate.has(d.symbol)) netByDate.set(d.symbol, new Map());
    const m = netByDate.get(d.symbol); m.set(d.deal_date, (m.get(d.deal_date) || 0) + v);
  }
  const dates = [...new Set(all.map(d => d.deal_date))].filter(d => d >= startISO && d <= endISO).sort();
  const scores = [];
  for (const date of dates) {
    const since = iso(new Date(Date.parse(date) - 180 * 86400_000));
    const bySym = new Map();
    for (const d of all) if (d.deal_date === date) { if (!bySym.has(d.symbol)) bySym.set(d.symbol, []); bySym.get(d.symbol).push(d); }
    for (const [symbol, deals] of bySym) {
      const grossBuy = deals.filter(d => d.side === 'BUY').reduce((s, d) => s + (+d.deal_value || 0), 0);
      const grossSell = deals.filter(d => d.side === 'SELL').reduce((s, d) => s + (+d.deal_value || 0), 0);
      const net = grossBuy - grossSell, netRatio = grossBuy + grossSell > 0 ? net / (grossBuy + grossSell) : 0;
      const flags = [];
      const buyers = new Set(deals.filter(d => d.side === 'BUY').map(d => d.client_name_normalized));
      if (deals.some(d => d.side === 'SELL' && buyers.has(d.client_name_normalized))) flags.push('matched_client');
      if (deals.some(d => d.client_category === 'promoter_group')) flags.push('promoter_involved');
      const cred = deals.reduce((s, d) => s + (CAT_W[d.client_category] ?? 0.5), 0) / deals.length;
      const hist = [...(netByDate.get(symbol) || new Map())].filter(([dt]) => dt >= since && dt < date).map(([, v]) => v);
      let z = null, confidence = 'new_large_deal';
      if (hist.length >= 10) {
        const med = median(hist), mad = Math.max(median(hist.map(v => Math.abs(v - med))), 1);
        z = Math.max(-4, Math.min(4, 0.6745 * (net - med) / mad));
        confidence = hist.length >= 60 ? 'high' : hist.length >= 25 ? 'medium' : 'low';
      }
      const zScore = z != null ? ((z + 4) / 8) * 100 : (net > 0 ? 65 : 35);
      let final = 0.45 * zScore + 0.25 * ((netRatio + 1) / 2) * 100 + 0.30 * cred * 100;
      if (flags.includes('matched_client')) final = Math.min(final, 45);
      scores.push({ deal_date: date, symbol, gross_buy_value: grossBuy, gross_sell_value: grossSell, net_buy_value: net,
        net_buy_ratio: Number(netRatio.toFixed(4)), abnormality_z: z, client_credibility: Number(cred.toFixed(3)),
        final_bulk_score: Math.round(final), confidence, flags });
    }
  }
  for (let i = 0; i < scores.length; i += 500) {
    await rest('bulk_deal_daily_scores?on_conflict=deal_date,symbol', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(scores.slice(i, i + 500)),
    });
  }
  const conf = scores.reduce((m, s) => (m[s.confidence] = (m[s.confidence] || 0) + 1, m), {});
  console.log(`scored ${scores.length} symbol-days across ${dates.length} dates | confidence ${JSON.stringify(conf)}`);
})().catch(e => { console.error(e.message); process.exit(1); });
