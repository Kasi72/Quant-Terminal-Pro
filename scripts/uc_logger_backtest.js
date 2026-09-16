#!/usr/bin/env node
/**
 * uc_logger_backtest.js — Full-feature backtest on pbfb_uc_logger
 *
 * Goals:
 *   1. Validate v3 weights on logger dataset (different from pbfb_uc_events)
 *   2. Grid-search optimal weights for features with coverage
 *   3. Cohen's d per feature to guide manual weights
 *   4. Report cl_trend/rsi2_vel/morph_type coverage when labeled positives exist
 *
 * Run: node scripts/uc_logger_backtest.js [--apply]
 *   --apply  overwrite lib/ucScoreWeights.ts if new AUC > v3 by >=0.005
 */

'use strict';

const SUPABASE_URL = 'https://cmkfqlppbwyrhjmooqbq.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) { console.error('Set SUPABASE_SERVICE_ROLE_KEY env var'); process.exit(1); }
const APPLY        = process.argv.includes('--apply');

const V3_AUC = 0.856; // baseline from pbfb_uc_events grid search (2026-09-14)

// ─── Current v3 production weights ───────────────────────────────────────────
const W_V3 = {
  closeLoc_pts:      22,
  rsi2_pts:          16,
  clTrend_pts:       18,  clTrend_neutral:   9,
  rsi2Vel_pts:       13,  rsi2Vel_neutral:   6.5,
  rangeATR_pts:      10,
  bodyPct_pts:        7,
  zoneTight_pts:      8,  zoneTight_neutral: 4,
  upperWick_pts:      4,  upperWick_neutral: 2,
  volBonus_3x5:      12,
  volBonus_2x:        5,
  volBonus_1x5:       2,
  volAccel_pts:      10,  volAccel_neutral:  5,
  nearBrkAPlus_pts:   5,
  nearBrkA_pts:       2.5,
  archVF_pts:         4,  archMP_pts: 3, archCC_pts: 2, archOther_pts: 1,
  volDrySurge_pts:    8,
  weeklyResonate_pts: 6,
  magnetFlag_pts:     4,
  morphCoiledSpring_pts: 5,
  morphGravestone_penalty: 4,
};

// ─── Score formula (mirrors stockEngine.ts computeUCScore) ──────────────────
function computeScore(row, W) {
  const cl   = row.close_loc    ?? 50;
  const rs   = row.rsi2         ?? 50;
  const bp   = row.body_pct     ?? 50;
  const uw   = row.upper_wick_pct ?? 50;
  const zt   = row.zone_tightness;          // may be null
  const clt  = row.cl_trend;               // may be null
  const rv   = row.rsi2_velocity;          // may be null
  const vr20 = row.vol_ratio_20 ?? 1;
  const vp5  = row.vol_pre5     ?? 1;
  const ratr = row.range_atr    ?? 1;
  const morph = row.morph_type  ?? null;
  const nbt  = row.near_breakout_tier ?? null;
  const arch = row.archetype_type ?? null;

  // close_loc component [0, closeLoc_pts]
  const clComp  = Math.min(1, Math.max(0, cl / 100)) * W.closeLoc_pts;

  // RSI2: penalise extremes, reward 30–60 zone
  const rsiComp = rs < 30 ? (rs / 30) * W.rsi2_pts * 0.5
                : rs > 80 ? ((100 - rs) / 20) * W.rsi2_pts * 0.5
                : (1 - Math.abs(rs - 50) / 50) * W.rsi2_pts;

  // clTrend continuous [0, clTrend_pts]; neutral when null
  const cltComp = clt != null
    ? Math.min(1, Math.max(0, (clt + 100) / 200)) * W.clTrend_pts
    : W.clTrend_neutral;

  // rsi2Velocity continuous; neutral when null
  const rsvComp = rv != null
    ? Math.min(1, Math.max(0, (rv + 50) / 100)) * W.rsi2Vel_pts
    : W.rsi2Vel_neutral;

  // rangeATR (higher = better momentum room) [0, rangeATR_pts]
  const rngComp = Math.min(1, Math.max(0, Math.min(ratr, 3) / 3)) * W.rangeATR_pts;

  // bodyPct [0, bodyPct_pts]
  const bPComp  = Math.min(1, Math.max(0, bp / 100)) * W.bodyPct_pts;

  // Volume bonus (step function)
  let volBonus = 0;
  const maxVol = Math.max(vr20, vp5);
  if      (maxVol >= 3.5 || maxVol >= 3.0) volBonus = W.volBonus_3x5;
  else if (maxVol >= 2.0)                  volBonus = W.volBonus_2x;
  else if (maxVol >= 1.5)                  volBonus = W.volBonus_1x5;

  // zone tightness (lower pct = tighter coil = better)
  const ztComp = zt != null
    ? Math.min(1, Math.max(0, (100 - zt) / 100)) * W.zoneTight_pts
    : W.zoneTight_neutral;

  // upper wick continuous (lower wick = better, range 0–30)
  const uwCont = Math.min(1, Math.max(0, (30 - uw) / 30)) * W.upperWick_pts;

  // near breakout tier
  let nbtComp = 0;
  if      (nbt === 'A+') nbtComp = W.nearBrkAPlus_pts;
  else if (nbt === 'A')  nbtComp = W.nearBrkA_pts;

  // archetype
  let archComp = 0;
  if      (arch === 'VF')    archComp = W.archVF_pts;
  else if (arch === 'MP')    archComp = W.archMP_pts;
  else if (arch === 'CC')    archComp = W.archCC_pts;
  else if (arch != null)     archComp = W.archOther_pts;

  // morph (categorical from morph_type string)
  let morphComp = 0;
  if (morph === 'coiled_spring')  morphComp =  W.morphCoiledSpring_pts;
  else if (morph === 'gravestone') morphComp = -W.morphGravestone_penalty;

  // volAccel proxy: use vol_pre5 as best available (no separate volAccel col)
  const vaComp = Math.min(1, Math.max(0, Math.min(vp5, 5) / 5)) * W.volAccel_pts;

  const raw = clComp + rsiComp + cltComp + rsvComp + rngComp + bPComp
            + volBonus + ztComp + uwCont + nbtComp + archComp
            + morphComp + vaComp;

  return Math.min(100, Math.round(raw));
}

// ─── AUC (trapezoidal ROC) ────────────────────────────────────────────────────
function auc(rows, scoreFn) {
  const scored = rows.map(r => ({ s: scoreFn(r), y: r.hit_uc_next_day ? 1 : 0 }));
  scored.sort((a, b) => b.s - a.s);
  const P = scored.filter(x => x.y === 1).length;
  const N = scored.length - P;
  if (P === 0 || N === 0) return 0;
  let tp = 0, fp = 0, prevTp = 0, prevFp = 0, area = 0;
  for (const { y } of scored) {
    if (y === 1) tp++; else fp++;
    if (fp !== prevFp || tp !== prevTp) {
      area += (fp - prevFp) * (tp + prevTp) / 2;
      prevTp = tp; prevFp = fp;
    }
  }
  return area / (P * N);
}

// ─── Precision @ threshold ────────────────────────────────────────────────────
function precisionAt(rows, scoreFn, threshold) {
  const above = rows.filter(r => scoreFn(r) >= threshold);
  if (above.length === 0) return { prec: 0, n: 0 };
  const hits = above.filter(r => r.hit_uc_next_day).length;
  return { prec: hits / above.length, n: above.length, hits };
}

// ─── Cohen's d ───────────────────────────────────────────────────────────────
function cohensD(rows, colFn) {
  const vals = rows.map(colFn).filter(v => v != null && !isNaN(v));
  const pos  = rows.filter(r => r.hit_uc_next_day).map(colFn).filter(v => v != null && !isNaN(v));
  const neg  = rows.filter(r => !r.hit_uc_next_day).map(colFn).filter(v => v != null && !isNaN(v));
  if (pos.length < 5 || neg.length < 5) return null;
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const std  = a => { const m = mean(a); return Math.sqrt(a.reduce((s,v) => s+(v-m)**2, 0) / a.length); };
  const sdp  = Math.sqrt((std(pos)**2 + std(neg)**2) / 2);
  return sdp === 0 ? null : (mean(pos) - mean(neg)) / sdp;
}

// ─── Grid search ─────────────────────────────────────────────────────────────
function gridSearch(rows, trials = 4000) {
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  let best = { auc: 0, W: null };

  for (let i = 0; i < trials; i++) {
    const W = {
      ...W_V3,  // start from v3 defaults
      closeLoc_pts:   rand(15, 30),
      rsi2_pts:       rand(8,  20),
      rangeATR_pts:   rand(8,  14),   // hold near live_v1 d=1.05
      bodyPct_pts:    rand(3,  12),
      zoneTight_pts:  rand(4,  12),   zoneTight_neutral: rand(2, 6),
      upperWick_pts:  rand(1,  8),    upperWick_neutral: rand(0.5, 4),
      volBonus_3x5:   rand(8,  16),
      volBonus_2x:    rand(3,  8),
      volAccel_pts:   rand(6,  14),
      morphCoiledSpring_pts:  rand(3, 8),
      morphGravestone_penalty: rand(2, 6),
    };
    const a = auc(rows, r => computeScore(r, W));
    if (a > best.auc) best = { auc: a, W };
  }
  return best;
}

// ─── Fetch all labeled rows (paginated) ──────────────────────────────────────
async function fetchAll() {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 20000; offset += pageSize) {
    const url = `${SUPABASE_URL}/rest/v1/pbfb_uc_logger`
      + `?select=close_loc,rsi2,body_pct,upper_wick_pct,zone_tightness,cl_trend,rsi2_velocity`
      + `,vol_ratio_20,vol_pre5,range_atr,morph_type,near_breakout_tier,archetype_type`
      + `,hit_uc_next_day,scan_date`
      + `&hit_uc_next_day=not.is.null`
      + `&order=id.asc`
      + `&limit=${pageSize}&offset=${offset}`;
    const batch = await fetch(url, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    }).then(r => r.json());
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('Fetching labeled rows from pbfb_uc_logger...');
  const all = await fetchAll();
  console.log(`Total labeled: ${all.length}`);

  const pos = all.filter(r => r.hit_uc_next_day === true);
  const neg = all.filter(r => r.hit_uc_next_day === false);
  const baseRate = (pos.length / all.length * 100).toFixed(2);
  console.log(`Positives (UC hit): ${pos.length}  Negatives: ${neg.length}  Base rate: ${baseRate}%`);

  // Feature coverage
  const cov = col => all.filter(r => r[col] != null).length;
  console.log('\nFeature coverage (non-null):');
  ['close_loc','rsi2','body_pct','upper_wick_pct','zone_tightness','cl_trend',
   'rsi2_velocity','vol_ratio_20','vol_pre5','range_atr','morph_type',
   'near_breakout_tier','archetype_type'].forEach(c =>
    console.log(`  ${c}: ${cov(c)}/${all.length}`)
  );

  // Cohen's d per feature
  console.log('\nCohen\'s d (feature discrimination):');
  const featureMap = {
    close_loc:     r => r.close_loc,
    rsi2:          r => r.rsi2,
    body_pct:      r => r.body_pct,
    upper_wick_pct:r => r.upper_wick_pct,
    vol_ratio_20:  r => r.vol_ratio_20,
    vol_pre5:      r => r.vol_pre5,
    range_atr:     r => r.range_atr,
    cl_trend:      r => r.cl_trend,
    rsi2_velocity: r => r.rsi2_velocity,
    zone_tightness:r => r.zone_tightness,
  };
  const dVals = {};
  for (const [name, fn] of Object.entries(featureMap)) {
    const d = cohensD(all, fn);
    dVals[name] = d;
    if (d != null) console.log(`  ${name}: d=${d.toFixed(3)}`);
    else console.log(`  ${name}: insufficient data`);
  }

  // v3 AUC on logger dataset
  const aucV3 = auc(all, r => computeScore(r, W_V3));
  console.log(`\nv3 weights AUC on logger: ${aucV3.toFixed(4)} (vs ${V3_AUC} on events table)`);

  // Precision at various thresholds (v3)
  console.log('\nPrecision @ threshold (v3 weights):');
  [45, 50, 55, 58, 60, 65, 70].forEach(t => {
    const { prec, n, hits } = precisionAt(all, r => computeScore(r, W_V3), t);
    console.log(`  @${t}: ${(prec*100).toFixed(1)}% prec  n=${n}  hits=${hits}`);
  });

  // Grid search
  console.log('\nRunning grid search (4000 trials)...');
  const result = gridSearch(all);
  console.log(`Best grid AUC: ${result.auc.toFixed(4)}`);
  console.log('Best weights:', JSON.stringify(result.W, null, 2));

  // Compare precision at 58
  const pV3 = precisionAt(all, r => computeScore(r, W_V3), 58);
  const pG4 = precisionAt(all, r => computeScore(r, result.W), 58);
  console.log(`\nPrec@58 v3: ${(pV3.prec*100).toFixed(1)}% (n=${pV3.n}, hits=${pV3.hits})`);
  console.log(`Prec@58 v4: ${(pG4.prec*100).toFixed(1)}% (n=${pG4.n}, hits=${pG4.hits})`);

  // Subset: rows with cl_trend populated
  const cltRows = all.filter(r => r.cl_trend != null);
  if (cltRows.length > 0) {
    const cltPos = cltRows.filter(r => r.hit_uc_next_day).length;
    console.log(`\ncl_trend subset: ${cltRows.length} rows, ${cltPos} positives`);
    if (cltPos >= 5) {
      const dClt = cohensD(cltRows, r => r.cl_trend);
      const dRv  = cohensD(cltRows, r => r.rsi2_velocity);
      const dMorph_cs = cohensD(cltRows, r => r.morph_type === 'coiled_spring' ? 1 : 0);
      console.log(`  cl_trend d=${dClt != null ? dClt.toFixed(3) : 'N/A'}`);
      console.log(`  rsi2_velocity d=${dRv != null ? dRv.toFixed(3) : 'N/A'}`);
      console.log(`  morph coiled_spring d=${dMorph_cs != null ? dMorph_cs.toFixed(3) : 'N/A'}`);
    } else {
      console.log(`  Insufficient positives for Cohen's d (need >=5, have ${cltPos})`);
    }
  }

  // Recommendation
  const delta = result.auc - aucV3;
  console.log('\n═══════════════════════════════════════════════');
  console.log('RECOMMENDATION:');
  if (delta >= 0.005) {
    console.log(`  v4 weights improve AUC by +${(delta).toFixed(4)} on logger dataset.`);
    console.log('  Review weight changes above — run with --apply to update ucScoreWeights.ts');
  } else {
    console.log(`  Grid delta ${(delta>=0?'+':'')}${delta.toFixed(4)} — marginal. Keep v3 weights.`);
  }
  console.log('  Next meaningful backtest: when post-2026-08-12 rows have >=20 UC hits');
  console.log('  (cl_trend/rsi2_vel/morphComp will then be optimizable)');
  console.log('═══════════════════════════════════════════════');

  if (APPLY && delta >= 0.005) {
    console.log('\nAPPLY mode: updating ucScoreWeights.ts...');
    // Only update weights that changed significantly
    const W = result.W;
    const fs = require('fs');
    const path = require('path');
    const file = path.join(__dirname, '../lib/ucScoreWeights.ts');
    let src = fs.readFileSync(file, 'utf8');

    const replace = (key, val) => {
      const rounded = Math.round(val * 10) / 10;
      src = src.replace(
        new RegExp(`(${key}\\s*:\\s*)([\\d.]+)`),
        `$1${rounded}`
      );
    };
    replace('closeLoc_pts',    W.closeLoc_pts);
    replace('rsi2_pts',        W.rsi2_pts);
    replace('rangeATR_pts',    W.rangeATR_pts);
    replace('bodyPct_pts',     W.bodyPct_pts);
    replace('zoneTight_pts',   W.zoneTight_pts);
    replace('zoneTight_neutral', W.zoneTight_neutral);
    replace('upperWick_pts',   W.upperWick_pts);
    replace('upperWick_neutral', W.upperWick_neutral);
    replace('volBonus_3x5',    W.volBonus_3x5);
    replace('volBonus_2x',     W.volBonus_2x);
    replace('volAccel_pts',    W.volAccel_pts);

    // Update metadata
    const today = new Date().toISOString().split('T')[0];
    src = src.replace(/generated:\s*'[^']*'/, `generated:   '${today}'`);
    src = src.replace(/source:\s*'[^']*'/, `source:      'logger_v4_backtest'`);
    src = src.replace(/n_labeled:\s*\d+/, `n_labeled:   ${all.length}`);

    fs.writeFileSync(file, src, 'utf8');
    console.log('ucScoreWeights.ts updated. Run: .\\deploy.ps1');
  }
})();
