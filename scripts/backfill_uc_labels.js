'use strict';
/**
 * Backfill hit_uc_next_day labels in pbfb_uc_logger from pbfb_uc_events crossref.
 * Matches: pbfb_uc_logger.symbol+scan_date ↔ pbfb_uc_events.symbol+event_date (n_before=1)
 * UC hit = stock appeared in pbfb_uc_events with event_date=scan_date and n_before=1
 *        = the screener flagged it on scan_date AND it circuited on scan_date+1
 *
 * Usage:
 *   node scripts/backfill_uc_labels.js             -- dry run (print plan)
 *   node scripts/backfill_uc_labels.js --write      -- write labels to Supabase
 */
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const WRITE = process.argv.includes('--write');

const ROOT     = path.join(__dirname, '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error('Missing Supabase creds'); process.exit(1); }

function sbGet(urlPath) {
  return new Promise((res, rej) => {
    const req = https.request(new URL(`${SUPA_URL}/rest/v1/${urlPath}`), {
      headers: { apikey: SUPA_KEY, authorization: `Bearer ${SUPA_KEY}`, accept: 'application/json', 'accept-profile': 'public' },
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch(e) { rej(e); } }); });
    req.on('error', rej);
    req.end();
  });
}

function sbPatch(urlPath, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const url  = new URL(`${SUPA_URL}/rest/v1/${urlPath}`);
    const req  = https.request(url, {
      method: 'PATCH',
      headers: {
        apikey: SUPA_KEY, authorization: `Bearer ${SUPA_KEY}`,
        'content-type': 'application/json', accept: 'application/json',
        'accept-profile': 'public', prefer: 'return=minimal',
      },
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => res({ status: r.statusCode, body: d })); });
    req.on('error', rej);
    req.write(data);
    req.end();
  });
}

async function fetchAllPages(baseQuery) {
  let all = [], page = 0;
  while (true) {
    const rows = await sbGet(`${baseQuery}&limit=1000&offset=${page * 1000}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    all = all.concat(rows);
    if (rows.length < 1000) break;
    page++;
  }
  return all;
}

async function main() {
  // 1. Fetch all unlabeled pbfb_uc_logger rows
  console.log('[1/4] Fetching unlabeled pbfb_uc_logger rows...');
  const logRows = await fetchAllPages(
    'pbfb_uc_logger?select=id,symbol,scan_date,uc_score,uc_elite,uc_strong,uc_goldmine&hit_uc_next_day=is.null&order=scan_date.asc'
  );
  console.log(`      Found ${logRows.length} unlabeled rows`);
  if (logRows.length === 0) { console.log('Nothing to label.'); return; }

  // Distinct scan_dates
  const scanDates = [...new Set(logRows.map(r => r.scan_date))].sort();
  console.log(`      Dates: ${scanDates.join(', ')}`);

  // 2. Fetch UC events (n_before=1) for all relevant dates
  console.log('[2/4] Fetching pbfb_uc_events (n_before=1) for scan dates...');
  const minDate = scanDates[0];
  const maxDate = scanDates[scanDates.length - 1];
  const ucEvents = await fetchAllPages(
    `pbfb_uc_events?select=event_date,symbol,classification&n_before=eq.1&event_date=gte.${minDate}&event_date=lte.${maxDate}&order=event_date.asc`
  );
  console.log(`      Found ${ucEvents.length} UC events (n_before=1) in date range`);

  // Build lookup: event_date|symbol → classification
  const ucMap = new Map();
  for (const e of ucEvents) {
    ucMap.set(`${e.event_date}|${e.symbol}`, e.classification ?? 'actionable');
  }

  // 3. Label each logged row
  console.log('[3/4] Computing labels...');
  const updates = logRows.map(row => ({
    id:              row.id,
    hit_uc_next_day: ucMap.has(`${row.scan_date}|${row.symbol}`),
    uc_classification: ucMap.get(`${row.scan_date}|${row.symbol}`) ?? null,
    labeled_at:      new Date().toISOString(),
  }));

  const truePositives = updates.filter(u => u.hit_uc_next_day).length;
  const precision     = (truePositives / updates.length * 100).toFixed(1);
  console.log(`      Total: ${updates.length}  TP: ${truePositives}  FP: ${updates.length - truePositives}  Precision: ${precision}%`);

  // Tier breakdowns
  const logById = Object.fromEntries(logRows.map(r => [r.id, r]));
  for (const tier of ['uc_elite', 'uc_strong', 'uc_goldmine']) {
    const inTier = updates.filter(u => logById[u.id]?.[tier] === true);
    const hits   = inTier.filter(u => u.hit_uc_next_day).length;
    console.log(`      ${tier}: n=${inTier.length}  hits=${hits}  precision=${inTier.length > 0 ? (hits/inTier.length*100).toFixed(1)+'%' : '-'}`);
  }

  // Score tier breakdown
  const scoreBuckets = [
    { label: '80+',   filter: r => r.uc_score >= 80 },
    { label: '70-79', filter: r => r.uc_score >= 70 && r.uc_score < 80 },
    { label: '60-69', filter: r => r.uc_score >= 60 && r.uc_score < 70 },
    { label: '50-59', filter: r => r.uc_score >= 50 && r.uc_score < 60 },
    { label: '40-49', filter: r => r.uc_score >= 40 && r.uc_score < 50 },
    { label: '35-39', filter: r => r.uc_score >= 35 && r.uc_score < 40 },
  ];
  console.log('\n  Score tier precision:');
  for (const b of scoreBuckets) {
    const inTier = updates.filter(u => b.filter(logById[u.id] ?? {}));
    const hits   = inTier.filter(u => u.hit_uc_next_day).length;
    if (inTier.length > 0) {
      console.log(`    ${b.label.padEnd(6)}: n=${String(inTier.length).padStart(4)}  hits=${String(hits).padStart(3)}  precision=${(hits/inTier.length*100).toFixed(1).padStart(5)}%`);
    }
  }

  if (!WRITE) {
    console.log('\n[DRY RUN] Add --write to apply labels to Supabase');
    return;
  }

  // 4. Write labels in batches of 1 (by id filter)
  console.log('\n[4/4] Writing labels to Supabase...');
  let written = 0;
  const BATCH = 50;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    // Update each row by id using filter
    await Promise.all(chunk.map(u => {
      const { id, ...fields } = u;
      return sbPatch(`pbfb_uc_logger?id=eq.${id}`, fields);
    }));
    written += chunk.length;
    if (i % 500 === 0) process.stdout.write('.');
  }
  console.log(`\n      Written: ${written} rows`);
  console.log('[DONE] Labels backfilled. Run: node scripts/uc_precision_analysis.js');
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
