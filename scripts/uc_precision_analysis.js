'use strict';
/**
 * UC Precision Analysis & Weight Recalibration
 * Run monthly after 30 trading days of logger data. First run: 2026-09-16.
 *
 * What it does:
 *   1. Fetches all labeled pbfb_uc_events (hit_t1 not null)
 *   2. Computes hit_uc_proxy = hit_t1 AND outcome_pct_20d > 20
 *   3. Computes Cohen d per feature (proxy=true vs proxy=false)
 *   4. Computes precision per tier (ucElite, ucStrong, ucGoldmine)
 *   5. Outputs: scripts/results/uc_precision_report.txt
 *              scripts/results/uc_weights_proposal.json
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
const ENV_PATH = path.join(ROOT, '.env.local');
const RESULT_DIR = path.join(ROOT, 'scripts', 'results');
if (!fs.existsSync(RESULT_DIR)) fs.mkdirSync(RESULT_DIR, { recursive: true });

const env = Object.fromEntries(
  fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPA_URL || !SUPA_KEY) {
  console.error('[ERROR] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local');
  process.exit(1);
}

function sbGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPA_URL}/rest/v1/${urlPath}`);
    const req = https.request(url, {
      headers: {
        apikey: SUPA_KEY,
        authorization: `Bearer ${SUPA_KEY}`,
        accept: 'application/json',
        'range-unit': 'items',
        range: '0-4999',
      },
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`Parse error: ${body.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
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
  { key: 'vol_vs_pre5',    label: 'VolPre5',       currentPts:  5, wKey: 'volAccel_pts'   },
  { key: 'zone_tightness', label: 'ZoneTightness', currentPts:  6, wKey: 'zoneTight_pts'  },
];

async function main() {
  console.log('[INFO] Fetching labeled pbfb_uc_events (hit_t1 not null)...');

  const cols = 'close_loc,body_pct,rsi2,range_atr,vol_ratio_20,vol_vs_pre5,zone_tightness,' +
    'cl_trend,rsi2_velocity,near_breakout_tier,archetype_type,hit_t1,outcome_pct_20d';
  const rows = await sbGet(
    `pbfb_uc_events?select=${cols}&n_before=eq.1&hit_t1=not.is.null&order=event_date.desc&limit=5000`
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    console.error('[ERROR] No labeled rows found. Have you run the brain worker labeling cron?');
    process.exit(1);
  }
  console.log(`[INFO] Fetched ${rows.length} labeled rows`);

  const labeled = rows.map(r => ({
    ...r,
    hit_uc_proxy: r.hit_t1 === true && typeof r.outcome_pct_20d === 'number' && r.outcome_pct_20d > 20,
  }));

  const pos = labeled.filter(r => r.hit_uc_proxy);
  const neg = labeled.filter(r => !r.hit_uc_proxy);
  const baseRate = (pos.length / labeled.length * 100).toFixed(1);
  console.log(`[INFO] hit_uc_proxy base rate: ${baseRate}% (${pos.length} / ${labeled.length})`);

  if (pos.length < 20) {
    console.warn(`[WARN] Only ${pos.length} positive examples. Need >=20 for reliable Cohen d.`);
  }

  const dValues = {};
  for (const f of FEATURES) {
    const posVals = pos.map(r => r[f.key]).filter(v => typeof v === 'number' && !isNaN(v));
    const negVals = neg.map(r => r[f.key]).filter(v => typeof v === 'number' && !isNaN(v));
    dValues[f.key] = { d: cohensD(posVals, negVals), n_pos: posVals.length, n_neg: negVals.length };
  }

  const isUCGoldmine = r => (r.vol_ratio_20 ?? 0) >= 3.0 && ((r.close_loc ?? 0) >= 75 || (r.rsi2 ?? 0) >= 70);
  const isUCStrong   = r => (r.vol_ratio_20 ?? 0) >= 3.0 && (r.close_loc ?? 0) >= 75 && (r.rsi2 ?? 0) >= 70;
  const isUCElite    = r => (r.vol_ratio_20 ?? 0) >= 2.0 && (r.vol_vs_pre5 ?? 0) >= 2.0 && (r.close_loc ?? 0) >= 65 && (r.rsi2 ?? 0) >= 60;
  const tierFns = [
    { name: 'ucElite',    fn: isUCElite    },
    { name: 'ucStrong',   fn: isUCStrong   },
    { name: 'ucGoldmine', fn: isUCGoldmine },
  ];
  const tierStats = {};
  for (const t of tierFns) {
    const inTier = labeled.filter(t.fn);
    const hits   = inTier.filter(r => r.hit_uc_proxy);
    tierStats[t.name] = { n: inTier.length, hits: hits.length };
  }

  // Scale maxPts by Cohen d -- clamped to [50%, 200%] of current value
  const totalCurrentPts = FEATURES.reduce((s, f) => s + f.currentPts, 0);
  const totalD = FEATURES.reduce((s, f) => s + Math.max(0.01, dValues[f.key].d), 0);

  const proposal = {};
  for (const f of FEATURES) {
    const dNorm   = Math.max(0.01, dValues[f.key].d) / totalD;
    const newPts  = totalCurrentPts * dNorm;
    const clamped = Math.round(Math.max(f.currentPts * 0.5, Math.min(f.currentPts * 2.0, newPts)) * 10) / 10;
    proposal[f.wKey] = clamped;
  }
  proposal['clTrend_neutral']   = Math.round(proposal['clTrend_pts']  / 2 * 10) / 10;
  proposal['rsi2Vel_neutral']   = Math.round(proposal['rsi2Vel_pts']  / 2 * 10) / 10;
  const volScale                = proposal['volBonus_3x5'] / 12;
  proposal['volBonus_2x']       = Math.round(5 * volScale * 10) / 10;
  proposal['volBonus_1x5']      = Math.round(2 * volScale * 10) / 10;
  proposal['zoneTight_neutral'] = Math.round(proposal['zoneTight_pts'] / 2 * 10) / 10;
  proposal['volAccel_neutral']  = Math.round(proposal['volAccel_pts']  / 2 * 10) / 10;

  const today = new Date().toISOString().slice(0, 10);
  const proposalDoc = {
    generated: today, source: 'uc_precision_analysis',
    n_labeled: labeled.length, n_pos: pos.length, base_rate: parseFloat(baseRate),
    cohen_d: Object.fromEntries(FEATURES.map(f => [f.key, +dValues[f.key].d.toFixed(3)])),
    weights: proposal,
  };

  const lines = [];
  lines.push(`UC Precision Analysis -- ${today}`);
  lines.push(`n_labeled=${labeled.length}  n_pos=${pos.length}  base_rate=${baseRate}%`);
  lines.push('');
  lines.push("FEATURE COHEN'S d  (hit_uc_proxy=T vs F)");
  lines.push(sep(58));
  for (const f of FEATURES) {
    const { d, n_pos: np, n_neg: nn } = dValues[f.key];
    const bar = '+'.repeat(Math.min(20, Math.round(d * 20)));
    lines.push(`  ${f.label.padEnd(16)} d=${f2(d).padStart(5)}  n+=${String(np).padStart(4)} n-=${String(nn).padStart(4)}  ${bar}`);
  }
  lines.push('');
  lines.push('TIER PRECISION');
  lines.push(sep(45));
  for (const t of tierFns) {
    const s = tierStats[t.name];
    lines.push(`  ${t.name.padEnd(12)} n=${String(s.n).padStart(4)}  hits=${String(s.hits).padStart(3)}  precision=${pct(s.hits, s.n).padStart(6)}`);
  }
  lines.push('');
  lines.push('WEIGHT PROPOSAL  (clamped to [50%, 200%] of current)');
  lines.push(sep(58));
  for (const f of FEATURES) {
    const np = proposal[f.wKey];
    const dir = np > f.currentPts ? 'UP  ' : np < f.currentPts ? 'DOWN' : 'SAME';
    lines.push(`  ${f.label.padEnd(16)} ${String(f.currentPts).padStart(4)} pts  ${dir}  ${String(np).padStart(6)} pts`);
  }
  lines.push('');
  lines.push('[NEXT] Run: node scripts/uc_precision_analysis.js --apply  then git commit + vercel deploy --prod --yes');

  const reportText = lines.join('\n');
  console.log('\n' + reportText);

  const reportPath   = path.join(RESULT_DIR, 'uc_precision_report.txt');
  const proposalPath = path.join(RESULT_DIR, 'uc_weights_proposal.json');
  fs.writeFileSync(reportPath,   reportText, 'utf8');
  fs.writeFileSync(proposalPath, JSON.stringify(proposalDoc, null, 2), 'utf8');
  console.log(`[OK] Report  --> ${reportPath}`);
  console.log(`[OK] Weights --> ${proposalPath}`);

  if (APPLY) {
    const W = proposal;
    const weightsPath = path.join(ROOT, 'lib', 'ucScoreWeights.ts');
    const content = [
      '/**',
      ' * UC score formula weight constants.',
      ' * Auto-generated by scripts/uc_precision_analysis.js -- do not edit manually.',
      ` * Generated: ${today} | source: uc_precision_analysis | n_labeled: ${labeled.length}`,
      ' */',
      '',
      'export const UC_SCORE_WEIGHTS = {',
      `  generated:   '${today}',`,
      `  source:      'uc_precision_analysis',`,
      `  n_labeled:   ${labeled.length},`,
      '',
      `  closeLoc_pts:      ${W.closeLoc_pts ?? 22},`,
      `  rsi2_pts:          ${W.rsi2_pts ?? 16},`,
      `  clTrend_pts:       ${W.clTrend_pts ?? 18},`,
      `  clTrend_neutral:   ${W.clTrend_neutral ?? 9},`,
      `  rsi2Vel_pts:       ${W.rsi2Vel_pts ?? 13},`,
      `  rsi2Vel_neutral:   ${W.rsi2Vel_neutral ?? 6.5},`,
      `  rangeATR_pts:      ${W.rangeATR_pts ?? 5},`,
      `  bodyPct_pts:       ${W.bodyPct_pts ?? 5},`,
      `  zoneTight_pts:     ${W.zoneTight_pts ?? 6},`,
      `  zoneTight_neutral: ${W.zoneTight_neutral ?? 3},`,
      `  volAccel_pts:      ${W.volAccel_pts ?? 5},`,
      `  volAccel_neutral:  ${W.volAccel_neutral ?? 2.5},`,
      '',
      `  volBonus_3x5:  ${W.volBonus_3x5 ?? 12},`,
      `  volBonus_2x:   ${W.volBonus_2x  ?? 5},`,
      `  volBonus_1x5:  ${W.volBonus_1x5 ?? 2},`,
      '',
      '  nearBrkAPlus_pts:  5,',
      '  nearBrkA_pts:      2.5,',
      '  archVF_pts:        4,',
      '  archMP_pts:        3,',
      '  archCC_pts:        2,',
      '  archOther_pts:     1,',
      '',
      '  niftyBullMult:      1.10,',
      '  niftyNeutralMult:   1.00,',
      '  niftyBearMult:      0.85,',
      '  niftyBullThreshold:   2,',
      '  niftyBearThreshold:  -2,',
      '} as const;',
      '',
      'export type UCScoreWeights = typeof UC_SCORE_WEIGHTS;',
      '',
    ].join('\n');
    fs.writeFileSync(weightsPath, content, 'utf8');
    console.log(`[OK] Applied --> ${weightsPath}`);
  }
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
