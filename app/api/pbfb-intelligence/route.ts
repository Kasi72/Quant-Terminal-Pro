import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const runtime = 'edge';

// Runs at most once per minute — free tier bandwidth safe
export const revalidate = 60;

function avg(arr: (number | null | undefined)[]): number {
  const valid = arr.filter(v => v != null && !isNaN(v as number)) as number[];
  return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ eventCount: 0 });

  const sb = createClient(url, key);

  // Limit to recent 180 days so centroid reflects current market regime
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [eventsResult, runsResult] = await Promise.all([
    sb.from('pbfb_uc_events')
      .select('best_stage, best_param_set, classification, close_loc, body_pct, upper_wick_pct, vol_ratio_20, vol_vs_pre5, range_atr, rsi2, zone_len, zone_tightness, near_breakout_tier, archetype_type, zone_shape')
      .eq('n_before', 1)
      .gte('event_date', cutoff)
      .limit(2000)
      .order('created_at', { ascending: false }),
    sb.from('pbfb_daily_runs')
      .select('id, run_date')
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const events = eventsResult.data ?? [];
  const runs   = runsResult.data   ?? [];

  if (events.length === 0) {
    return NextResponse.json({
      eventCount: 0, runCount: runs.length,
      lastRunDate: runs[0]?.run_date ?? '',
    });
  }

  type Row = typeof events[0];

  const actionable = events.filter((e: Row) => e.classification === 'actionable');

  // Stage hit counts across all events
  const stageHitCounts: Record<string, number> = {};
  for (const e of events) {
    stageHitCounts[e.best_stage] = (stageHitCounts[e.best_stage] ?? 0) + 1;
  }

  // Per-param-set detection rate — how often each archetype caught the breakout
  const paramSetStats: Record<string, { caught: number; total: number; rate: number }> = {};
  for (const e of events) {
    const ps = (e.best_param_set as string) || 'unknown';
    if (!paramSetStats[ps]) paramSetStats[ps] = { caught: 0, total: 0, rate: 0 };
    paramSetStats[ps].total++;
    if (e.classification === 'actionable') paramSetStats[ps].caught++;
  }
  for (const ps of Object.keys(paramSetStats)) {
    const s = paramSetStats[ps];
    s.rate = s.total > 0 ? s.caught / s.total : 0;
  }

  // Feature centroid of actionable events (what a "caught" breakout looks like)
  const centroid = {
    closeLoc:     avg(actionable.map((e: Row) => e.close_loc)),
    bodyPct:      avg(actionable.map((e: Row) => e.body_pct)),
    upperWickPct: avg(actionable.map((e: Row) => e.upper_wick_pct)),
    volRatio20:   avg(actionable.map((e: Row) => e.vol_ratio_20)),
    volPre5:      avg(actionable.map((e: Row) => e.vol_vs_pre5)),
    rangeATR:     avg(actionable.map((e: Row) => e.range_atr)),
    rsi2:         avg(actionable.map((e: Row) => e.rsi2)),
    zoneLen:      avg(actionable.map((e: Row) => e.zone_len)),
    zoneTightness: avg(actionable.map((e: Row) => e.zone_tightness)),
  };

  // Archetype distribution across all events
  const archetypeCounts: Record<string, number> = {};
  for (const e of events) {
    const arch = (e.archetype_type as string | null);
    if (arch) archetypeCounts[arch] = (archetypeCounts[arch] ?? 0) + 1;
  }

  // Breakout proximity for zone-only events
  const zoneOnly = events.filter((e: Row) => e.classification === 'zone_only');
  const breakoutTierCounts: Record<string, number> = {};
  for (const e of zoneOnly) {
    const tier = (e.near_breakout_tier as string | null);
    if (tier) breakoutTierCounts[tier] = (breakoutTierCounts[tier] ?? 0) + 1;
  }

  // Top-3 features most different between actionable vs missed
  const missed = events.filter((e: Row) => e.classification === 'missed');
  const featureLifts = [
    { label: 'Close Loc ≥ 70%',   lift: actionable.filter((e: Row) => (e.close_loc ?? 0) >= 70).length / Math.max(1, actionable.length) / Math.max(0.01, missed.filter((e: Row) => (e.close_loc ?? 0) >= 70).length / Math.max(1, missed.length)) },
    { label: 'Vol/Pre5 ≥ 2.5×',   lift: actionable.filter((e: Row) => (e.vol_vs_pre5 ?? 0) >= 2.5).length / Math.max(1, actionable.length) / Math.max(0.01, missed.filter((e: Row) => (e.vol_vs_pre5 ?? 0) >= 2.5).length / Math.max(1, missed.length)) },
    { label: 'Body ≥ 45%',         lift: actionable.filter((e: Row) => (e.body_pct ?? 0) >= 45).length / Math.max(1, actionable.length) / Math.max(0.01, missed.filter((e: Row) => (e.body_pct ?? 0) >= 45).length / Math.max(1, missed.length)) },
    { label: 'Range/ATR ≥ 1.3×',  lift: actionable.filter((e: Row) => (e.range_atr ?? 0) >= 1.3).length / Math.max(1, actionable.length) / Math.max(0.01, missed.filter((e: Row) => (e.range_atr ?? 0) >= 1.3).length / Math.max(1, missed.length)) },
    { label: 'Zone len ≥ 8',       lift: actionable.filter((e: Row) => (e.zone_len ?? 0) >= 8).length  / Math.max(1, actionable.length) / Math.max(0.01, missed.filter((e: Row) => (e.zone_len ?? 0) >= 8).length  / Math.max(1, missed.length)) },
    { label: 'Wick ≤ 25%',         lift: actionable.filter((e: Row) => (e.upper_wick_pct ?? 100) <= 25).length / Math.max(1, actionable.length) / Math.max(0.01, missed.filter((e: Row) => (e.upper_wick_pct ?? 100) <= 25).length / Math.max(1, missed.length)) },
  ].sort((a, b) => b.lift - a.lift).slice(0, 3);

  return NextResponse.json({
    eventCount:          events.length,
    actionableCount:     actionable.length,
    runCount:            runs.length,
    lastRunDate:         runs[0]?.run_date ?? '',
    overallDetectionRate: events.length > 0 ? actionable.length / events.length : 0,
    centroid,
    stageHitCounts,
    paramSetStats,
    featureLifts,
    archetypeCounts,
    breakoutTierCounts,
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
