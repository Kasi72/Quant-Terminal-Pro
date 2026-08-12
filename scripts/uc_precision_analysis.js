'use strict';
/**
 * UC Precision Analysis & Weight Recalibration
 * Reads pbfb_uc_logger (live forward-labeled screener candidates).
 * Label: hit_uc_next_day = did the flagged stock actually hit UC next day?
 *
 * Run monthly after 30+ trading days of logger data with outcomes.
 * Scheduled: node scripts/uc_precision_analysis.js --apply  (2026-09-16 onwards)
 *
 * Usage:
 *   node scripts/uc_precision_analysis.js           -- report only
 *   node scripts/uc_precision_analysis.js --apply   -- also write lib/ucScoreWeights.ts
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const APPLY = process.argv.includes('--apply');
const ROOT     = path.join(__dirname, '..');
const RESULT_DIR = path.join(ROOT, 'scripts', 'results');
if (!fs.existsSync(RESULT_DIR)) fs.mkdirSync(RESULT_DIR, { recursive: true });

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error('[ERROR] Missing Supabase creds in .env.local'); process.exit(1); }

function sbGet(urlPath) {
  return new Promise((res, rej) => {
    const req = https.request(new URL(`${SUPA_URL}/rest/v1/${urlPath}`), {
      headers: { apikey: SUPA_KEY, authorization: `Bearer ${SUPA_KEY}`, accept: 'application/json', 'accept-profile': 'public' },
    }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch(e) { rej(e); } }); });
    req.on('error', rej);
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

const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
function variance(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length;
}
function cohensD(groupA, groupB) {
  if (groupA.length < 3 || groupB.length < 3) return 0;
  const pooledVar = (variance(groupA) * groupA.length + variance(groupB) * groupB.length) / (groupA.length + groupB.length);
  const pooledStd = Math.sqrt(pooledVar) || 1;
  return Math.abs(mean(groupA) - mean(groupB)) / pooledStd;
}
const f2  = v => typeof v === 'number' ? v.toFixed(2) : '-';
const pct = (n, d) => d > 0 ? (n / d * 100).toFixed(1) + '%' : '-';
const sep = (n, c = '-') => c.repeat(n);

const FEATURES = [
  { key: 'close_loc',      label: 'CloseLoc%',    currentPts: 22, wKey: 'closeLoc_pts'   },
  { key: 'rsi2',           label: 'RSI2',          currentPts: 16, wKey: 'rsi2_pts'       },
  { key: 'cl_trend',       label: 'clTrend',       currentPts: 18, wKey: 'clTrend_pts'    },
  { key: 'rsi2_velocity',  label: 'rsi2Velocity',  currentPts: 13, wKey: 'rsi2Vel_pts'    },
  { key: 'range_atr',      label: 'RangeATR',      currentPts:  5, wKey: 'rangeATR_pts'   },
  { key: 'body_pct',       label: 'BodyPct%',      currentPts:  5, wKey: 'bodyPct_pts'    },
  { key: 'vol_ratio_20',   label: 'VolR20',        currentPts: 12, wKey: 'volBonus_3x5'   },
  { key: 'vol_pre5',       label: 'VolPre5',       currentPts:  5, wKey: 'volAccel_pts'   },
  // zone_tightness not in pbfb_uc_logger — skip for now
];

async function main() {
  // 1. Fetch labeled live screener candidates from pbfb_uc_logger
  console.log('[INFO] Fetching labeled pbfb_uc_logger rows (hit_uc_next_day not null)...');
  const cols = 'scan_date,symbol,uc_score,uc_elite,uc_strong,uc_goldmine,' +
    'close_loc,rsi2,body_pct,vol_ratio_20,vol_pre5,range_atr,cl_trend,rsi2_velocity,' +
    'hit_uc_next_day,next_day_chg_pct,stage';
  const rows = await fetchAllPages(
    `pbfb_uc_logger?select=${cols}&hit_uc_next_day=not.is.null&order=scan_date.asc`
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    console.error('[ERROR] No labeled rows. Run: node scripts/backfill_uc_labels.js --write');
    process.exit(1);
  }
  console.log(`[INFO] Fetched ${rows.length} labeled rows`);

  const pos = rows.filter(r => r.hit_uc_next_day === true);
  const neg = rows.filter(r => r.hit_uc_next_day === false);
  const baseRate = (pos.length / rows.length * 100).toFixed(2);
  const dates    = [...new Set(rows.map(r => r.scan_date))].sort();
  console.log(`[INFO] Dates: ${dates[0]} → ${dates[dates.length-1]}  (${dates.length} trading days)`);
  console.log(`[INFO] True UC hits: ${pos.length} / ${rows.length}  base_rate=${baseRate}%`);

  if (pos.length < 30) {
    console.warn(`[WARN] Only ${pos.length} positive examples. Need 30+ for reliable weights. Showing report only.`);
  }

  // 2. Cohen's d per feature
  const dValues = {};
  for (const f of FEATURES) {
    const posVals = pos.map(r => r[f.key]).filter(v => typeof v === 'number' && !isNaN(v));
    const negVals = neg.map(r => r[f.key]).filter(v => typeof v === 'number' && !isNaN(v));
    dValues[f.key] = { d: cohensD(posVals, negVals), n_pos: posVals.length, n_neg: negVals.length,
      mean_pos: mean(posVals), mean_neg: mean(negVals) };
  }

  // 3. Score tier precision/recall
  const scoreBuckets = [
    { label: '80+',   filter: r => r.uc_score >= 80 },
    { label: '70-79', filter: r => r.uc_score >= 70 && r.uc_score < 80 },
    { label: '60-69', filter: r => r.uc_score >= 60 && r.uc_score < 70 },
    { label: '50-59', filter: r => r.uc_score >= 50 && r.uc_score < 60 },
    { label: '40-49', filter: r => r.uc_score >= 40 && r.uc_score < 50 },
    { label: '35-39', filter: r => r.uc_score >= 35 && r.uc_score < 40 },
  ];
  const scoreTierStats = scoreBuckets.map(b => {
    const inTier = rows.filter(b.filter);
    const hits   = inTier.filter(r => r.hit_uc_next_day === true).length;
    const recall = pos.length > 0 ? hits / pos.length : 0;
    return { label: b.label, n: inTier.length, hits, prec: inTier.length > 0 ? hits / inTier.length : 0, recall };
  });

  // Named tier stats
  const namedTiers = [
    { name: 'ucElite',    filter: r => r.uc_elite    === true },
    { name: 'ucStrong',   filter: r => r.uc_strong   === true },
    { name: 'ucGoldmine', filter: r => r.uc_goldmine === true },
  ];
  const namedTierStats = namedTiers.map(t => {
    const inTier = rows.filter(t.filter);
    const hits   = inTier.filter(r => r.hit_uc_next_day === true).length;
    const recall = pos.length > 0 ? hits / pos.length : 0;
    return { name: t.name, n: inTier.length, hits, prec: inTier.length > 0 ? hits / inTier.length : 0, recall };
  });

  // Stage tier stats
  const stages = ['BUY','STRONG_BUY','ULTRA_STRONG_BUY','PRE_BREAKOUT','EARLY_INFLECTION','COMPRESSION_WATCH','NO_SIGNAL'];
  const stageTierStats = stages.map(s => {
    const inTier = rows.filter(r => r.stage === s);
    const hits   = inTier.filter(r => r.hit_uc_next_day === true).length;
    const recall = pos.length > 0 ? hits / pos.length : 0;
    return { stage: s, n: inTier.length, hits, prec: inTier.length > 0 ? hits / inTier.length : 0, recall };
  }).filter(s => s.n > 0);

  // 4. Weight proposal (only if pos.length >= 30 and d values are meaningful)
  const totalCurrentPts = FEATURES.reduce((s, f) => s + f.currentPts, 0);
  const totalD = FEATURES.reduce((s, f) => s + Math.max(0.01, dValues[f.key].d), 0);
  const proposal = {};
  for (const f of FEATURES) {
    const dNorm   = Math.max(0.01, dValues[f.key].d) / totalD;
    const newPts  = totalCurrentPts * dNorm;
    const clamped = Math.round(Math.max(f.currentPts * 0.5, Math.min(f.currentPts * 2.0, newPts)) * 10) / 10;
    proposal[f.wKey] = clamped;
  }
  proposal['clTrend_neutral']   = Math.round((proposal['clTrend_pts']  ?? 18) / 2 * 10) / 10;
  proposal['rsi2Vel_neutral']   = Math.round((proposal['rsi2Vel_pts']  ?? 13) / 2 * 10) / 10;
  const volScale                = (proposal['volBonus_3x5'] ?? 12) / 12;
  proposal['volBonus_2x']       = Math.round(5 * volScale * 10) / 10;
  proposal['volBonus_1x5']      = Math.round(2 * volScale * 10) / 10;
  proposal['volAccel_neutral']  = Math.round((proposal['volAccel_pts'] ?? 5) / 2 * 10) / 10;

  // 5. Format report
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push(`UC Precision Analysis -- ${today}`);
  lines.push(`Source: pbfb_uc_logger (live forward-labeled screener candidates)`);
  lines.push(`n_labeled=${rows.length}  n_uc_hit=${pos.length}  base_rate=${baseRate}%  trading_days=${dates.length}`);
  lines.push(`Date range: ${dates[0]} → ${dates[dates.length-1]}`);
  lines.push('');

  lines.push("FEATURE COHEN'S d  (hit_uc_next_day=T vs F, live screener candidates)");
  lines.push(sep(70));
  for (const f of FEATURES) {
    const { d, n_pos: np, n_neg: nn, mean_pos: mp, mean_neg: mn } = dValues[f.key];
    const bar = '+'.repeat(Math.min(20, Math.round(d * 20)));
    lines.push(`  ${f.label.padEnd(16)} d=${f2(d).padStart(5)}  mean+=${f2(mp)}  mean-=${f2(mn)}  n+=${String(np).padStart(3)} n-=${String(nn).padStart(4)}  ${bar}`);
  }

  lines.push('');
  lines.push('SCORE TIER PRECISION / RECALL');
  lines.push(sep(70));
  lines.push(`  ${'Tier'.padEnd(8)} ${'n'.padStart(5)}  ${'hits'.padStart(4)}  ${'precision'.padStart(10)}  ${'recall'.padStart(8)}`);
  for (const t of scoreTierStats) {
    if (t.n === 0) continue;
    lines.push(`  ${t.label.padEnd(8)} ${String(t.n).padStart(5)}  ${String(t.hits).padStart(4)}  ${(t.prec*100).toFixed(1).padStart(9)}%  ${(t.recall*100).toFixed(1).padStart(7)}%`);
  }

  lines.push('');
  lines.push('NAMED TIER PRECISION / RECALL');
  lines.push(sep(70));
  for (const t of namedTierStats) {
    lines.push(`  ${t.name.padEnd(14)} n=${String(t.n).padStart(4)}  hits=${String(t.hits).padStart(3)}  precision=${(t.prec*100).toFixed(1).padStart(5)}%  recall=${(t.recall*100).toFixed(1).padStart(5)}%`);
  }

  lines.push('');
  lines.push('STAGE PRECISION / RECALL');
  lines.push(sep(70));
  for (const t of stageTierStats) {
    lines.push(`  ${t.stage.padEnd(22)} n=${String(t.n).padStart(4)}  hits=${String(t.hits).padStart(3)}  precision=${(t.prec*100).toFixed(1).padStart(5)}%  recall=${(t.recall*100).toFixed(1).padStart(5)}%`);
  }

  lines.push('');
  if (pos.length >= 30) {
    lines.push('WEIGHT PROPOSAL  (clamped [50%,200%] of current — based on live forward labels)');
    lines.push(sep(70));
    for (const f of FEATURES) {
      const np  = proposal[f.wKey];
      const dir = np > f.currentPts ? 'UP  ' : np < f.currentPts ? 'DOWN' : 'SAME';
      lines.push(`  ${f.label.padEnd(16)} ${String(f.currentPts).padStart(4)} pts  ${dir}  ${String(np).padStart(6)} pts`);
    }
    lines.push('');
    lines.push('[NEXT] Run with --apply to write lib/ucScoreWeights.ts, then git commit + vercel deploy --prod --yes');
  } else {
    lines.push(`[WAIT] n_pos=${pos.length} < 30. Accumulate more data before applying weights.`);
    lines.push(`       Re-run after ${30 - pos.length} more UC hits are labeled.`);
  }

  const report = lines.join('\n');
  console.log('\n' + report);

  const reportPath   = path.join(RESULT_DIR, 'uc_precision_report.txt');
  const proposalPath = path.join(RESULT_DIR, 'uc_weights_proposal.json');
  const proposalDoc  = {
    generated: today, source: 'pbfb_uc_logger', n_labeled: rows.length,
    n_pos: pos.length, base_rate: parseFloat(baseRate), trading_days: dates.length,
    cohen_d:    Object.fromEntries(FEATURES.map(f => [f.key, +dValues[f.key].d.toFixed(3)])),
    mean_pos:   Object.fromEntries(FEATURES.map(f => [f.key, +dValues[f.key].mean_pos.toFixed(2)])),
    mean_neg:   Object.fromEntries(FEATURES.map(f => [f.key, +dValues[f.key].mean_neg.toFixed(2)])),
    score_tiers: scoreTierStats,
    weights: pos.length >= 30 ? proposal : null,
  };
  fs.writeFileSync(reportPath,   report, 'utf8');
  fs.writeFileSync(proposalPath, JSON.stringify(proposalDoc, null, 2), 'utf8');
  console.log(`[OK] Report  --> ${reportPath}`);
  console.log(`[OK] Weights --> ${proposalPath}`);

  if (APPLY && pos.length >= 30) {
    const W = proposal;
    const weightsPath = path.join(ROOT, 'lib', 'ucScoreWeights.ts');
    const existingContent = fs.readFileSync(weightsPath, 'utf8');
    // Preserve non-formula sections (feature set 2, morphology, nifty, categorical)
    // by only updating the continuous feature weights
    let content = existingContent;
    const patchMap = {
      'closeLoc_pts':      W.closeLoc_pts   ?? 22,
      'rsi2_pts':          W.rsi2_pts       ?? 16,
      'clTrend_pts':       W.clTrend_pts    ?? 18,
      'clTrend_neutral':   W.clTrend_neutral ?? 9,
      'rsi2Vel_pts':       W.rsi2Vel_pts    ?? 13,
      'rsi2Vel_neutral':   W.rsi2Vel_neutral ?? 6.5,
      'rangeATR_pts':      W.rangeATR_pts   ?? 5,
      'bodyPct_pts':       W.bodyPct_pts    ?? 5,
      'volBonus_3x5':      W.volBonus_3x5   ?? 12,
      'volBonus_2x':       W.volBonus_2x    ?? 5,
      'volBonus_1x5':      W.volBonus_1x5   ?? 2,
      'volAccel_pts':      W.volAccel_pts   ?? 5,
      'volAccel_neutral':  W.volAccel_neutral ?? 2.5,
    };
    for (const [key, val] of Object.entries(patchMap)) {
      content = content.replace(
        new RegExp(`(${key}:\\s*)([\\d.]+)`),
        `$1${val}`
      );
    }
    // Update metadata
    content = content
      .replace(/generated:\s*'[^']*'/, `generated:   '${today}'`)
      .replace(/source:\s*'[^']*'/,    `source:      'uc_precision_analysis'`)
      .replace(/n_labeled:\s*\d+/,     `n_labeled:   ${rows.length}`);
    fs.writeFileSync(weightsPath, content, 'utf8');
    console.log(`[OK] Applied weights --> ${weightsPath}`);
  } else if (APPLY) {
    console.log(`[SKIP] --apply ignored: need pos.length >= 30, got ${pos.length}`);
  }
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
