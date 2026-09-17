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
 *   5. UC Logger XGBoost retrain  — pure-JS gradient boosting on pbfb_uc_logger
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
// DNA retune 2026-09-16 — keep in sync with tradeOps.ts and false_negative_miner.js
const DNA_CLAUSES = [
  { id:'A', test: r => r.vol_pre5 >= 4.5  && r.cl_trend >= 63 },
  { id:'B', test: r => r.upper_wick_pct <= 1.38 && r.inflection_score >= 34 },
  { id:'C', test: r => r.uc_goldmine === true && r.body_pct >= 35 },
  { id:'D', test: r => r.vol_pre5 >= 4.0  && r.inflection_score >= 34 && r.body_pct >= 40 },
  { id:'E', test: r => (r.close_loc||0) >= 80 && r.vol_pre5 >= 2 && r.body_pct >= 40 },
  { id:'F', test: r => (r.rsi2||99) <= 8 && r.vol_pre5 >= 1.8 && r.body_pct <= 12 },
  { id:'ANY', test: r =>
      (r.vol_pre5 >= 4.5  && r.cl_trend >= 63) ||
      (r.upper_wick_pct <= 1.38 && r.inflection_score >= 34) ||
      (r.uc_goldmine === true && r.body_pct >= 35) ||
      (r.vol_pre5 >= 4.0  && r.inflection_score >= 34 && r.body_pct >= 40) ||
      ((r.close_loc||0) >= 80 && r.vol_pre5 >= 2 && r.body_pct >= 40) ||
      ((r.rsi2||99) <= 8 && r.vol_pre5 >= 1.8 && r.body_pct <= 12) },
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

  // Step 5: UC Logger XGBoost retrain (pure JS, no Python needed)
  try {
    log('Step 5: UC Logger XGBoost retrain...');
    const { main: trainXgb } = require('./train_uc_xgb_js');
    const xgbResult = await trainXgb();
    if (xgbResult) {
      log(`  XGB retrain done: test_auc=${xgbResult.test_auc.toFixed(4)} prec@10%=${(xgbResult.prec_top10pct*100).toFixed(1)}% n_train=${xgbResult.n_train}`);
    }
  } catch(e) {
    log(`  ERR: XGB retrain failed: ${e.message?.slice(0,100)}`);
  }

  // Step 6: Daily watchlist — rank today's candidates by tiered signal stack
  try {
    log('Step 6: Building daily watchlist...');
    await buildDailyWatchlist();
  } catch(e) {
    log(`  ERR: daily watchlist failed: ${e.message?.slice(0,100)}`);
  }

  log('Daily brain trainer complete.\n');
}

// ── XGB inference (mirrors ucLoggerXgbInfer.ts, pure JS) ─────────────────────
function walkTree(node, features) {
  if (node.leaf !== undefined) return node.leaf;
  const val = features[node.split];
  const child = (val === undefined || val === null || !isFinite(val))
    ? node.missing
    : val < node.split_condition ? node.yes : node.no;
  return walkTree(child, features);
}
function sigmoid(rawSum, baseScore) {
  const bs = Math.max(0.001, Math.min(0.999, baseScore));
  const bl = Math.log(bs / (1 - bs));
  return 1 / (1 + Math.exp(-(bl + rawSum)));
}
function inferLoggerXgb(model, r) {
  if (!model) return null;
  const vp  = r.vol_pre5        || 0;
  const bp  = r.body_pct        || 0;
  const uwp = r.upper_wick_pct  || 0;
  const cl  = r.close_loc       || 0;
  const rsi = r.rsi2            || 0;
  const uc  = r.uc_score        || 0;
  const features = {
    vol_pre5:         vp,
    cl_trend:         r.cl_trend         || 0,
    inflection_score: r.inflection_score || 0,
    upper_wick_pct:   uwp,
    uc_score:         uc,
    body_pct:         bp,
    close_loc:        cl,
    rsi2:             rsi,
    range_atr:        r.range_atr        || 0,
    momentum_score:   r.momentum_score   || 0,
    vol_quality:      vp * bp / 100,
    clean_close:      (100 - uwp) * cl / 100,
    oversold_surge:   vp / Math.max(rsi, 1),
    uc_vol_gate:      uc * vp / 100,
  };
  let rawSum = 0;
  for (const tree of model.trees) rawSum += walkTree(tree, features);
  return sigmoid(rawSum, model.base_score);
}

async function buildDailyWatchlist() {
  // Load XGB model if available
  const modelPath = path.join(RESULT_DIR, 'uc_logger_xgb_model.json');
  let xgbModel = null;
  try {
    if (fs.existsSync(modelPath)) xgbModel = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  } catch(e) { /* model not trained yet */ }

  // Fetch latest scan date candidates (no next_day_chg_pct filter — these are live candidates)
  const latestRows = await new Promise((res, rej) => {
    const req = require('https').request(
      new URL(`${SUPA_URL}/rest/v1/pbfb_uc_logger?select=symbol,scan_date,uc_score,uc_goldmine,vol_pre5,cl_trend,upper_wick_pct,inflection_score,body_pct,rsi2,range_atr,momentum_score,close_loc&order=scan_date.desc&limit=500`),
      { headers: { apikey: SUPA_KEY, authorization: `Bearer ${SUPA_KEY}`, accept: 'application/json' } },
      r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,200)))} }); }
    );
    req.on('error', rej); req.end();
  });

  if (!Array.isArray(latestRows) || latestRows.length === 0) {
    log('  No candidates found for watchlist');
    return;
  }

  // Use only most recent scan_date
  const latestDate = latestRows[0].scan_date;
  const candidates = latestRows.filter(r => r.scan_date === latestDate);
  log(`  Candidates for ${latestDate}: ${candidates.length} stocks`);

  const dnaTest = DNA_CLAUSES.find(c => c.id === 'ANY').test;

  const scored = candidates.map(r => {
    const dnaHit   = dnaTest(r);
    const dnaClauses = DNA_CLAUSES.filter(c => c.id !== 'ANY' && c.test(r)).map(c => c.id);
    const loggerXgb = inferLoggerXgb(xgbModel, r);
    const ucScoreN  = (r.uc_score || 0) / 100;
    const composite = loggerXgb != null
      ? loggerXgb * 0.6 + ucScoreN * 0.4
      : ucScoreN;

    // Tier assignment
    let tier = null;
    if (dnaHit && loggerXgb != null && loggerXgb >= 0.55 && (r.uc_score || 0) >= 60) {
      tier = 1;
    } else if (!dnaHit && loggerXgb != null && loggerXgb >= 0.65 && (r.rsi2 || 99) <= 12 && (r.vol_pre5 || 0) >= 1.5) {
      tier = 2;
    } else if (composite >= 0.50) {
      tier = 3;
    }

    return { symbol: r.symbol, scan_date: latestDate, tier, dnaHit, dnaClauses,
             loggerXgbScore: loggerXgb != null ? Math.round(loggerXgb * 1000) / 1000 : null,
             ucScore: r.uc_score, composite: Math.round(composite * 1000) / 1000,
             vol_pre5: r.vol_pre5, rsi2: r.rsi2, body_pct: r.body_pct,
             uc_score: r.uc_score };
  });

  // Rank: tier first (1 best), then composite desc
  const ranked = scored
    .filter(r => r.tier !== null)
    .sort((a, b) => (a.tier - b.tier) || (b.composite - a.composite));

  const top10  = ranked.slice(0, 10);
  const tier1  = top10.filter(r => r.tier === 1);
  const tier2  = top10.filter(r => r.tier === 2);
  const tier3  = top10.filter(r => r.tier === 3);

  log(`  Tier 1 (DNA+XGB≥0.55+ucScore≥60): ${tier1.length} | Tier 2 (escape archetype): ${tier2.length} | Tier 3 (watchlist): ${tier3.length}`);
  top10.forEach(r => {
    const xgbStr = r.loggerXgbScore != null ? `xgb=${(r.loggerXgbScore*100).toFixed(0)}%` : 'xgb=—';
    log(`    [T${r.tier}] ${r.symbol.padEnd(12)} composite=${(r.composite*100).toFixed(0)}% ${xgbStr} uc=${r.uc_score} dna=${r.dnaHit ? r.dnaClauses.join('+') : 'none'}`);
  });

  const watchlist = {
    generated: new Date().toISOString(),
    scan_date: latestDate,
    model_available: xgbModel !== null,
    model_auc: xgbModel?.test_auc ?? null,
    total_candidates: candidates.length,
    picks: top10,
  };

  fs.writeFileSync(path.join(RESULT_DIR, 'daily_watchlist.json'), JSON.stringify(watchlist, null, 2));
  log(`  Watchlist saved: ${top10.length} picks → scripts/results/daily_watchlist.json`);
  return watchlist;
}

main().catch(e => { console.error(e); process.exit(1); });
