'use strict';
/**
 * Daily Brain Trainer — Brain V3 Continuous Learning Orchestrator
 *
 * Runs every weekday evening (20:30) via Task Scheduler.
 * Sequence:
 *   1. Label yesterday's UC scan outcomes (calls Vercel API)
 *   2. Pattern similarity engine  — rebuild winner clusters → Supabase
 *   3. False negative miner       — study escaped winners → propose DNA-E/F
 *   4. Daily precision snapshot   — detect fast drift (7d/14d/30d per clause)
 *
 * No code patching here — that stays in monthly auto_apply_improvements.js.
 * This is the daily observation + learning layer only.
 */

const https   = require('https');
const fs      = require('fs');
const path    = require('path');

const ROOT       = path.join(__dirname, '..');
const RESULT_DIR = path.join(ROOT, 'scripts', 'results');
const LOG_FILE   = path.join(RESULT_DIR, 'daily_brain_trainer.log');

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);
const SUPA_URL  = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY  = env.SUPABASE_SERVICE_ROLE_KEY;
const VERCEL_URL = env.NEXT_PUBLIC_VERCEL_URL || 'https://stock-screener-tau-fawn.vercel.app';
const CRON_SECRET = env.CRON_SECRET;

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function sbGet(urlPath) {
  return new Promise((res, rej) => {
    const req = https.request(new URL(`${SUPA_URL}/rest/v1/${urlPath}`), {
      headers: { apikey: SUPA_KEY, authorization: `Bearer ${SUPA_KEY}`, accept: 'application/json' },
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,200)))} }); });
    req.on('error', rej); req.end();
  });
}

function sbPost(urlPath, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const req = https.request(new URL(`${SUPA_URL}/rest/v1/${urlPath}`), {
      method: 'POST',
      headers: {
        apikey: SUPA_KEY, authorization: `Bearer ${SUPA_KEY}`,
        'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation',
      },
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,200)))} }); });
    req.on('error', rej); req.write(data); req.end();
  });
}

// Step 1: Label outcomes via Vercel API
async function labelOutcomes() {
  log('Step 1: Calling /api/label-uc-outcomes...');
  return new Promise((res, rej) => {
    const url = new URL(`${VERCEL_URL}/api/label-uc-outcomes`);
    const req = https.request(url, {
      method: 'POST',
      headers: { 'x-cron-secret': CRON_SECRET, 'content-type': 'application/json' },
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,200)))} }); });
    req.on('error', rej); req.write('{}'); req.end();
  });
}

// DNA clause tests — in sync with tradeOps.ts
const DNA_CLAUSES = [
  { id:'A', test: r => r.vol_pre5 >= 3.18 && r.cl_trend >= 63 },
  { id:'B', test: r => r.upper_wick_pct <= 1.38 && r.inflection_score >= 34 },
  { id:'C', test: r => r.uc_goldmine === true },
  { id:'D', test: r => r.vol_pre5 >= 3.18 && r.inflection_score >= 34 },
  { id:'ANY', test: r =>
      (r.vol_pre5 >= 3.18 && r.cl_trend >= 63) ||
      (r.upper_wick_pct <= 1.38 && r.inflection_score >= 34) ||
      r.uc_goldmine === true ||
      (r.vol_pre5 >= 3.18 && r.inflection_score >= 34) },
];

// Step 4: Daily precision snapshot (fast drift detection, 7d/14d/30d)
async function dailyPrecisionSnapshot(allLabeled) {
  log('Step 4: Computing daily precision snapshot...');

  function windowRows(rows, days) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutStr = cutoff.toISOString().slice(0,10);
    return rows.filter(r => r.scan_date >= cutStr);
  }
  function prec(rows) {
    if (!rows.length) return null;
    const hits = rows.filter(r => r.next_day_chg_pct >= 5).length;
    return { p: hits/rows.length, n: rows.length, hits };
  }

  const windows = [7, 14, 30, 90];
  const snapshot = {};
  const driftFlags = [];

  for (const clause of DNA_CLAUSES) {
    const wData = {};
    for (const w of windows) {
      const wRows = windowRows(allLabeled, w).filter(clause.test);
      wData[`p${w}d`] = prec(wRows);
    }
    snapshot[clause.id] = wData;

    // Fast drift: 7d precision drops >3pp vs 14d
    const p7 = wData.p7d?.p, p14 = wData.p14d?.p;
    if (p7 != null && p14 != null && (p14 - p7) > 0.03) {
      driftFlags.push(`DNA-${clause.id}: 7d prec ${(p7*100).toFixed(1)}% vs 14d ${(p14*100).toFixed(1)}% — FAST DRIFT`);
    }
  }

  const out = {
    date: new Date().toISOString().slice(0,10),
    total_labeled: allLabeled.length,
    clauses: snapshot,
    drift_flags: driftFlags,
    fast_drift_detected: driftFlags.length > 0,
  };

  driftFlags.forEach(f => log(`  ⚠ ${f}`));
  if (!driftFlags.length) log('  ✓ No fast drift detected');

  try {
    await sbPost('uc_brain_config', { config_key: 'daily_precision', config_value: out, updated_at: new Date().toISOString() });
    log('  Supabase uc_brain_config[daily_precision] updated');
  } catch(e) {
    log(`  WARN: Supabase upsert failed: ${e.message?.slice(0,80)}`);
  }

  fs.writeFileSync(path.join(RESULT_DIR, 'daily_precision_snapshot.json'), JSON.stringify(out, null, 2));
  return out;
}

async function fetchAllLabeled() {
  let all=[], page=0;
  while(true) {
    const rows = await sbGet(
      `pbfb_uc_logger?select=scan_date,next_day_chg_pct,uc_goldmine,vol_pre5,cl_trend,` +
      `upper_wick_pct,inflection_score,uc_score,body_pct,rsi2,range_atr,momentum_score,stats_score` +
      `&next_day_chg_pct=not.is.null&order=scan_date.desc&limit=1000&offset=${page*1000}`
    );
    if(!Array.isArray(rows)||rows.length===0) break;
    all=all.concat(rows); if(rows.length<1000) break; page++;
  }
  return all;
}

async function main() {
  if (!fs.existsSync(RESULT_DIR)) fs.mkdirSync(RESULT_DIR, { recursive: true });

  log('╔═══════════════════════════════════════════════════════════════╗');
  log('║  DAILY BRAIN TRAINER — CONTINUOUS LEARNING LOOP              ║');
  log('╚═══════════════════════════════════════════════════════════════╝');

  // Step 1: Label outcomes
  try {
    const result = await labelOutcomes();
    log(`  Labeled: ${result?.labeled ?? 'N/A'} rows`);
  } catch(e) {
    log(`  WARN: Label outcomes failed: ${e.message?.slice(0,100)}`);
  }

  // Fetch fresh labeled data for steps 2-4
  const allLabeled = await fetchAllLabeled();
  log(`  Total labeled rows available: ${allLabeled.length}`);

  // Step 2: Pattern similarity engine
  try {
    log('Step 2: Running pattern_similarity_engine.js...');
    const simEngine = require('./pattern_similarity_engine');
    const result = await simEngine.main();
    if (result) log(`  Winner clusters built: ${result.clusters?.length} archetypes, ${result.n_winners} winners`);
  } catch(e) {
    log(`  ERR: pattern_similarity_engine failed: ${e.message?.slice(0,100)}`);
  }

  // Step 3: False negative miner
  try {
    log('Step 3: Running false_negative_miner.js...');
    const fnMiner = require('./false_negative_miner');
    const result = await fnMiner.main();
    if (result) log(`  Escaped winners: ${result.escaped_count}, Candidates proposed: ${result.candidate_clauses?.length}`);
  } catch(e) {
    log(`  ERR: false_negative_miner failed: ${e.message?.slice(0,100)}`);
  }

  // Step 4: Daily precision snapshot
  try {
    const snapshot = await dailyPrecisionSnapshot(allLabeled);
    if (snapshot.fast_drift_detected) {
      log(`  ⚠ FAST DRIFT — ${snapshot.drift_flags.length} alert(s). Consider early re-mine.`);
    }
  } catch(e) {
    log(`  ERR: daily precision snapshot failed: ${e.message?.slice(0,100)}`);
  }

  log('Daily brain trainer complete.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
