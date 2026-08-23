/**
 * Backfills uc_score in pbfb_uc_events for all rows where it is NULL.
 * Inlines the computeUCScore formula (matches lib/stockEngine.ts + ucScoreWeights.ts).
 * Run: node scripts/backfill_uc_score.js
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Weights from lib/ucScoreWeights.ts (live_v1, generated 2026-08-12)
const W = {
  closeLoc_pts: 20, rsi2_pts: 10,
  clTrend_pts: 18, clTrend_neutral: 9,
  rsi2Vel_pts: 13, rsi2Vel_neutral: 6.5,
  rangeATR_pts: 10, bodyPct_pts: 5,
  zoneTight_pts: 6, zoneTight_neutral: 3,
  volAccel_pts: 10, volAccel_neutral: 5,
  volBonus_3x5: 12, volBonus_2x: 5, volBonus_1x5: 2,
  nearBrkAPlus_pts: 5, nearBrkA_pts: 2.5,
  archVF_pts: 4, archMP_pts: 3, archCC_pts: 2, archOther_pts: 1,
  volDrySurge_pts: 8, weeklyResonate_pts: 6, magnetFlag_pts: 4,
  morphCoiledSpring_pts: 5, morphGravestone_penalty: 4,
};

function computeUCScore(r) {
  const closeLoc     = Number(r.close_loc)      || 50;
  const volRatio20   = Number(r.vol_ratio_20)   || 1;
  const rsi2         = Number(r.rsi2)           || 50;
  const rangeATR14   = Number(r.range_atr)      || 1;
  const bodyPct      = Number(r.body_pct)       || 0;
  const clTrend      = r.cl_trend      != null ? Number(r.cl_trend)      : null;
  const rsi2Velocity = r.rsi2_velocity != null ? Number(r.rsi2_velocity) : null;
  const volPre5      = r.vol_vs_pre5   != null ? Number(r.vol_vs_pre5)   : null;
  const zoneTightness= r.zone_tightness!= null ? Number(r.zone_tightness): null;
  const volAccel     = r.vol_accel     != null ? Number(r.vol_accel)     : null;
  const upperWickPct = r.upper_wick_pct!= null ? Number(r.upper_wick_pct): null;
  const nearBrkTier  = r.near_breakout_tier || null;
  const archType     = r.archetype_type     || null;

  const clComp  = Math.min(1, Math.max(0, (closeLoc - 40) / 52)) * W.closeLoc_pts;
  const rsiComp = Math.min(1, Math.max(0, (rsi2 - 30) / 70))     * W.rsi2_pts;
  const cltComp = clTrend != null
    ? Math.min(1, Math.max(0, (clTrend + 39) / 85)) * W.clTrend_pts
    : W.clTrend_neutral;
  const rsvComp = rsi2Velocity != null
    ? Math.min(1, Math.max(0, (rsi2Velocity + 36) / 83)) * W.rsi2Vel_pts
    : W.rsi2Vel_neutral;
  const rngComp = Math.min(1, Math.max(0, (rangeATR14 - 0.5) / 1.2)) * W.rangeATR_pts;
  const bPComp  = Math.min(1, Math.max(0, (bodyPct - 15) / 56))       * W.bodyPct_pts;

  const volMax  = Math.max(volRatio20, volPre5 ?? 0);
  const volBonus = volMax >= 3.5 ? W.volBonus_3x5
    : volMax >= 3.0 ? W.volBonus_3x5
    : volMax >= 2.0 ? W.volBonus_2x
    : volMax >= 1.5 ? W.volBonus_1x5 : 0;

  const ztComp = zoneTightness != null
    ? Math.min(1, Math.max(0, (8.0 - zoneTightness) / 6.0)) * W.zoneTight_pts
    : W.zoneTight_neutral;
  const vaComp = volAccel != null
    ? Math.min(1, Math.max(0, (volAccel - 0.8) / 2.2)) * W.volAccel_pts
    : W.volAccel_neutral;

  const nbtComp  = nearBrkTier === 'A+' ? W.nearBrkAPlus_pts : nearBrkTier === 'A' ? W.nearBrkA_pts : 0;
  const archComp = archType === 'VolumeFootprint' ? W.archVF_pts
    : archType === 'MomentumPocket'  ? W.archMP_pts
    : archType === 'CompressionCoil' ? W.archCC_pts
    : archType ? W.archOther_pts : 0;

  // volDryScore/volSurgeScore/weeklyCloseLoc/weeklyBodyPct/magnetFlag not in DB — skip (0 pts)
  const uw       = upperWickPct ?? 50;
  const morphComp = (bodyPct < 25 && uw < 20)  ?  W.morphCoiledSpring_pts
    :              (bodyPct < 25 && uw > 35)    ? -W.morphGravestone_penalty
    : 0;

  return Math.round(Math.min(100,
    clComp + rsiComp + cltComp + rsvComp + rngComp + bPComp
    + volBonus + ztComp + vaComp + nbtComp + archComp + morphComp
  ));
}

const BATCH = 500;

async function run() {
  let offset = 0;
  let totalUpdated = 0;

  while (true) {
    const { data: rows, error } = await supabase
      .from('pbfb_uc_events')
      .select('id, close_loc, body_pct, upper_wick_pct, vol_ratio_20, vol_vs_pre5, range_atr, rsi2, zone_tightness, vol_accel, cl_trend, rsi2_velocity, near_breakout_tier, archetype_type')
      .is('uc_score', null)
      .range(offset, offset + BATCH - 1);

    if (error) { console.error('Fetch error:', error.message); break; }
    if (!rows || rows.length === 0) break;

    const updates = rows.map(r => ({ id: r.id, uc_score: computeUCScore(r) }));

    const { error: upErr } = await supabase
      .from('pbfb_uc_events')
      .upsert(updates, { onConflict: 'id' });

    if (upErr) { console.error('Upsert error:', upErr.message); break; }

    totalUpdated += updates.length;
    offset += rows.length;
    process.stdout.write(`\rProcessed ${offset} rows | updated ${totalUpdated}`);

    if (rows.length < BATCH) break;
  }

  console.log(`\nDone. Total rows backfilled: ${totalUpdated}`);
}

run().catch(console.error);
