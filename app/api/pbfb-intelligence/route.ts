import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const revalidate = 60;

// ── Temporal decay: 30-day half-life (ln(3)/30) ──────────────────────────────
const DECAY_LAMBDA = Math.log(3) / 30;
function decayW(eventDate: string | null, nowMs: number): number {
  if (!eventDate) return 1;
  const days = (nowMs - new Date(eventDate).getTime()) / 86400000;
  return Math.exp(-DECAY_LAMBDA * Math.max(0, days));
}

// ── Weighted statistics ───────────────────────────────────────────────────────
function wavg(vals: (number | null | undefined)[], w: number[]): number {
  let s = 0, ws = 0;
  vals.forEach((v, i) => { if (v != null && !isNaN(v as number)) { s += (v as number) * w[i]; ws += w[i]; } });
  return ws > 0 ? s / ws : 0;
}
function wstd(vals: (number | null | undefined)[], w: number[], mean: number): number {
  let vs = 0, ws = 0;
  vals.forEach((v, i) => { if (v != null && !isNaN(v as number)) { vs += w[i] * ((v as number) - mean) ** 2; ws += w[i]; } });
  return ws > 0 ? Math.sqrt(vs / ws) : 0;
}

// ── Mutual information (continuous feature vs binary label) ───────────────────
function mutualInfo(vals: unknown[], labels: unknown[]): number {
  const pairs: [number, boolean][] = [];
  vals.forEach((v, i) => {
    if (v != null && !isNaN(v as number) && labels[i] != null)
      pairs.push([v as number, labels[i] as boolean]);
  });
  if (pairs.length < 20) return 0;
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const BINS = 5, n = sorted.length;
  const joint: [number, number][] = Array.from({ length: BINS }, () => [0, 0]);
  sorted.forEach(([, l], idx) => { joint[Math.min(Math.floor(idx * BINS / n), BINS - 1)][l ? 1 : 0]++; });
  const totPos = pairs.filter(([, l]) => l).length;
  const totNeg = n - totPos;
  let mi = 0;
  for (let b = 0; b < BINS; b++) {
    const bN = joint[b][0] + joint[b][1]; if (!bN) continue;
    const pB = bN / n;
    for (const [cnt, tot] of [[joint[b][1], totPos], [joint[b][0], totNeg]] as [number, number][]) {
      if (!cnt || !tot) continue;
      mi += (cnt / n) * Math.log2((cnt / n) / (pB * (tot / n)));
    }
  }
  return Math.max(0, mi);
}

// ── Two-sample KS statistic ───────────────────────────────────────────────────
function ksStat(a: number[], b: number[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  const sa = [...a].sort((x, y) => x - y), sb = [...b].sort((x, y) => x - y);
  let i = 0, j = 0, f1 = 0, f2 = 0, d = 0;
  while (i < sa.length || j < sb.length) {
    const va = sa[i] ?? Infinity, vb = sb[j] ?? Infinity;
    if (va <= vb) { i++; f1 = i / sa.length; }
    if (vb <= va) { j++; f2 = j / sb.length; }
    d = Math.max(d, Math.abs(f1 - f2));
  }
  return d;
}
function ksSignificant(d: number, n1: number, n2: number): boolean {
  return n1 > 0 && n2 > 0 && d > 1.36 * Math.sqrt((n1 + n2) / (n1 * n2));
}

// ── K-Means Lloyd's (k=5, evenly-spaced seed) ────────────────────────────────
const K = 5;
function kMeans(pts: number[][]): { asgn: number[]; cents: number[][] } {
  const n = pts.length, dim = pts[0]?.length ?? 0;
  if (n < K || dim === 0) return { asgn: pts.map((_, i) => i % K), cents: pts.slice(0, K).map(p => [...p]) };
  const cents = Array.from({ length: K }, (_, j) => [...pts[Math.floor(j * n / K)]]);
  const asgn = new Array(n).fill(0);
  for (let it = 0; it < 40; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      for (let j = 0; j < K; j++) {
        const d = cents[j].reduce((s, v, di) => s + (v - pts[i][di]) ** 2, 0);
        if (d < bestD) { bestD = d; best = j; }
      }
      if (asgn[i] !== best) { asgn[i] = best; changed = true; }
    }
    if (!changed) break;
    const sums = Array.from({ length: K }, () => new Array(dim).fill(0));
    const cnts = new Array(K).fill(0);
    for (let i = 0; i < n; i++) { cnts[asgn[i]]++; pts[i].forEach((v, d) => { sums[asgn[i]][d] += v; }); }
    for (let j = 0; j < K; j++) if (cnts[j] > 0) cents[j] = sums[j].map(s => s / cnts[j]);
  }
  return { asgn, cents };
}

// Feature scales (must stay in sync with brain-worker and FAS in PBFBAnalyzer)
const FS = [100, 100, 100, 5, 8, 3, 100, 25, 20] as const;
const FL = ['Close Loc', 'Body%', 'Upper Wick', 'Vol/20d', 'Vol/Pre5', 'Range/ATR', 'RSI-2', 'Zone Len', 'Zone Tight'];

function fv(e: Record<string, unknown>, k: string): number | null {
  return (e[k] as number | null) ?? null;
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ eventCount: 0 });

  const sb = createClient(url, key);
  const nowMs = Date.now();
  const cutoff180 = new Date(nowMs - 180 * 86400000).toISOString().slice(0, 10);

  const [evR, runsR] = await Promise.all([
    sb.from('pbfb_uc_events')
      .select('best_stage,best_param_set,classification,event_date,close_loc,body_pct,upper_wick_pct,vol_ratio_20,vol_vs_pre5,range_atr,rsi2,zone_len,zone_tightness,near_breakout_tier,archetype_type,zone_shape,hit_t1,hit_t2,stopped_out,outcome_pct_20d,market_regime')
      .eq('n_before', 1)
      .gte('event_date', cutoff180)
      .limit(2000)
      .order('event_date', { ascending: false }),
    sb.from('pbfb_daily_runs')
      .select('id,run_date')
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const raw = evR.data ?? [];
  const runs = runsR.data ?? [];
  const events = raw as Record<string, unknown>[];

  if (events.length === 0) {
    return NextResponse.json({ eventCount: 0, runCount: runs.length, lastRunDate: runs[0]?.run_date ?? '' });
  }

  const n = events.length;
  const ws = events.map(e => decayW(e.event_date as string | null, nowMs));

  // ── Subsets ────────────────────────────────────────────────────────────────
  const actionable = events.filter(e => e.classification === 'actionable');
  const missed     = events.filter(e => e.classification === 'missed');
  const zoneOnly   = events.filter(e => e.classification === 'zone_only');
  const labeled    = events.filter(e => e.hit_t1 != null);
  const aIdx       = events.reduce<number[]>((acc, e, i) => { if (e.classification === 'actionable') acc.push(i); return acc; }, []);
  const aWs        = aIdx.map(i => ws[i]);

  // ── Weighted centroid (actionable events, decay-weighted) ──────────────────
  const centroid = {
    closeLoc:     wavg(actionable.map(e => fv(e, 'close_loc')),      aWs),
    bodyPct:      wavg(actionable.map(e => fv(e, 'body_pct')),       aWs),
    upperWickPct: wavg(actionable.map(e => fv(e, 'upper_wick_pct')), aWs),
    volRatio20:   wavg(actionable.map(e => fv(e, 'vol_ratio_20')),   aWs),
    volPre5:      wavg(actionable.map(e => fv(e, 'vol_vs_pre5')),    aWs),
    rangeATR:     wavg(actionable.map(e => fv(e, 'range_atr')),      aWs),
    rsi2:         wavg(actionable.map(e => fv(e, 'rsi2')),           aWs),
    zoneLen:      wavg(actionable.map(e => fv(e, 'zone_len')),       aWs),
    zoneTightness: wavg(actionable.map(e => fv(e, 'zone_tightness')), aWs),
  };

  // ── Global weighted means & std dev (all events, for z-scores) ────────────
  const gMeans = [
    wavg(events.map(e => fv(e, 'close_loc')),      ws),
    wavg(events.map(e => fv(e, 'body_pct')),       ws),
    wavg(events.map(e => fv(e, 'upper_wick_pct')), ws),
    wavg(events.map(e => fv(e, 'vol_ratio_20')),   ws),
    wavg(events.map(e => fv(e, 'vol_vs_pre5')),    ws),
    wavg(events.map(e => fv(e, 'range_atr')),      ws),
    wavg(events.map(e => fv(e, 'rsi2')),           ws),
    wavg(events.map(e => fv(e, 'zone_len')),       ws),
    wavg(events.map(e => fv(e, 'zone_tightness')), ws),
  ];
  const featureStdDev = {
    closeLoc:     wstd(events.map(e => fv(e, 'close_loc')),      ws, gMeans[0]),
    bodyPct:      wstd(events.map(e => fv(e, 'body_pct')),       ws, gMeans[1]),
    upperWickPct: wstd(events.map(e => fv(e, 'upper_wick_pct')), ws, gMeans[2]),
    volRatio20:   wstd(events.map(e => fv(e, 'vol_ratio_20')),   ws, gMeans[3]),
    volPre5:      wstd(events.map(e => fv(e, 'vol_vs_pre5')),    ws, gMeans[4]),
    rangeATR:     wstd(events.map(e => fv(e, 'range_atr')),      ws, gMeans[5]),
    rsi2:         wstd(events.map(e => fv(e, 'rsi2')),           ws, gMeans[6]),
    zoneLen:      wstd(events.map(e => fv(e, 'zone_len')),       ws, gMeans[7]),
    zoneTightness: wstd(events.map(e => fv(e, 'zone_tightness')), ws, gMeans[8]),
  };

  // ── Stage hits & param set stats ───────────────────────────────────────────
  const stageHitCounts: Record<string, number> = {};
  for (const e of events) stageHitCounts[e.best_stage as string] = (stageHitCounts[e.best_stage as string] ?? 0) + 1;

  const paramSetStats: Record<string, { caught: number; total: number; rate: number }> = {};
  for (const e of events) {
    const ps = (e.best_param_set as string) || 'unknown';
    if (!paramSetStats[ps]) paramSetStats[ps] = { caught: 0, total: 0, rate: 0 };
    paramSetStats[ps].total++;
    if (e.classification === 'actionable') paramSetStats[ps].caught++;
  }
  for (const ps of Object.keys(paramSetStats)) { const s = paramSetStats[ps]; s.rate = s.total > 0 ? s.caught / s.total : 0; }

  // ── Archetype & zone tier counts ──────────────────────────────────────────
  const archetypeCounts: Record<string, number> = {};
  for (const e of events) { const a = e.archetype_type as string | null; if (a) archetypeCounts[a] = (archetypeCounts[a] ?? 0) + 1; }
  const breakoutTierCounts: Record<string, number> = {};
  for (const e of zoneOnly) { const t = e.near_breakout_tier as string | null; if (t) breakoutTierCounts[t] = (breakoutTierCounts[t] ?? 0) + 1; }

  // ── Feature lifts (actionable vs missed) ──────────────────────────────────
  function lift(pred: (e: Record<string, unknown>) => boolean): number {
    return (actionable.filter(pred).length / Math.max(1, actionable.length)) /
           Math.max(0.01, missed.filter(pred).length / Math.max(1, missed.length));
  }
  const featureLifts = [
    { label: 'Close Loc ≥ 70%',  lift: lift(e => (fv(e, 'close_loc') ?? 0) >= 70) },
    { label: 'Vol/Pre5 ≥ 2.5×',  lift: lift(e => (fv(e, 'vol_vs_pre5') ?? 0) >= 2.5) },
    { label: 'Body ≥ 45%',        lift: lift(e => (fv(e, 'body_pct') ?? 0) >= 45) },
    { label: 'Range/ATR ≥ 1.3×', lift: lift(e => (fv(e, 'range_atr') ?? 0) >= 1.3) },
    { label: 'Zone len ≥ 8',      lift: lift(e => (fv(e, 'zone_len') ?? 0) >= 8) },
    { label: 'Wick ≤ 25%',        lift: lift(e => (fv(e, 'upper_wick_pct') ?? 100) <= 25) },
  ].sort((a, b) => b.lift - a.lift).slice(0, 3);

  // ── Labeled outcome stats ──────────────────────────────────────────────────
  const lHits = labeled.filter(e => e.hit_t1 === true);
  const labeledHitRate = labeled.length > 0 ? lHits.length / labeled.length : null;

  const withOutcome = labeled.filter(e => e.outcome_pct_20d != null);
  const pos20 = withOutcome.filter(e => (e.outcome_pct_20d as number) > 0);
  const neg20 = withOutcome.filter(e => (e.outcome_pct_20d as number) <= 0);
  const avgWin  = pos20.length > 0 ? pos20.reduce((s, e) => s + (e.outcome_pct_20d as number), 0) / pos20.length : 0;
  const avgLoss = neg20.length > 0 ? Math.abs(neg20.reduce((s, e) => s + (e.outcome_pct_20d as number), 0) / neg20.length) : 5;
  const avgRMultiple = avgWin > 0 && avgLoss > 0 ? avgWin / avgLoss : null;

  // Kelly fraction: f* = max(0, (p·b − (1−p)) / b)
  const p = labeledHitRate ?? (n > 0 ? actionable.length / n : 0);
  const b = avgRMultiple ?? 1.8;
  const kellyFraction = Math.max(0, Math.min(0.5, (p * b - (1 - p)) / b));

  // ── Feature-bucketed hit rates (requires ≥20 labeled) ─────────────────────
  type BktEntry = { range: string; hitRate: number | null; count: number; labeledCount: number };
  let featureBuckets: Record<string, BktEntry[]> | null = null;
  if (labeled.length >= 20) {
    featureBuckets = {};
    for (const fk of ['vol_vs_pre5', 'zone_tightness', 'close_loc', 'body_pct', 'range_atr']) {
      const allVals = events.map(e => fv(e, fk)).filter(v => v != null) as number[];
      if (allVals.length < 8) continue;
      const sv = [...allVals].sort((a, b2) => a - b2);
      const q25 = sv[Math.floor(sv.length * .25)];
      const q50 = sv[Math.floor(sv.length * .50)];
      const q75 = sv[Math.floor(sv.length * .75)];
      const bkts: { range: string; min: number; max: number }[] = [
        { range: `≤${q25.toFixed(1)}`,                        min: -Infinity, max: q25 },
        { range: `${q25.toFixed(1)}–${q50.toFixed(1)}`,      min: q25,       max: q50 },
        { range: `${q50.toFixed(1)}–${q75.toFixed(1)}`,      min: q50,       max: q75 },
        { range: `>${q75.toFixed(1)}`,                        min: q75,       max: Infinity },
      ];
      featureBuckets[fk] = bkts.map(({ range, min, max }) => {
        const inB = labeled.filter(e => { const v = fv(e, fk); return v != null && v > min && v <= max; });
        const h   = inB.filter(e => e.hit_t1 === true).length;
        const cnt = events.filter(e => { const v = fv(e, fk); return v != null && v > min && v <= max; }).length;
        return { range, hitRate: inB.length >= 3 ? h / inB.length : null, count: cnt, labeledCount: inB.length };
      });
    }
  }

  // ── Mutual information ranking (requires ≥30 labeled) ─────────────────────
  let miRanking: { label: string; mi: number; featureKey: string }[] | null = null;
  if (labeled.length >= 30) {
    const hitLbls = labeled.map(e => e.hit_t1 as boolean | null);
    miRanking = [
      { featureKey: 'vol_vs_pre5',    label: 'Vol / Pre-5',    mi: mutualInfo(labeled.map(e => fv(e, 'vol_vs_pre5')),    hitLbls) },
      { featureKey: 'zone_tightness', label: 'Zone Tightness', mi: mutualInfo(labeled.map(e => fv(e, 'zone_tightness')), hitLbls) },
      { featureKey: 'close_loc',      label: 'Close Location', mi: mutualInfo(labeled.map(e => fv(e, 'close_loc')),      hitLbls) },
      { featureKey: 'body_pct',       label: 'Body %',         mi: mutualInfo(labeled.map(e => fv(e, 'body_pct')),       hitLbls) },
      { featureKey: 'range_atr',      label: 'Range / ATR',    mi: mutualInfo(labeled.map(e => fv(e, 'range_atr')),      hitLbls) },
      { featureKey: 'rsi2',           label: 'RSI-2',          mi: mutualInfo(labeled.map(e => fv(e, 'rsi2')),           hitLbls) },
      { featureKey: 'upper_wick_pct', label: 'Upper Wick',     mi: mutualInfo(labeled.map(e => fv(e, 'upper_wick_pct')), hitLbls) },
    ].sort((a, b2) => b2.mi - a.mi);
  }

  // ── K-Means clustering (k=5, 9 normalized features) ───────────────────────
  const pts = events.map(e => [
    (fv(e, 'close_loc')      ?? 0) / FS[0],
    (fv(e, 'body_pct')       ?? 0) / FS[1],
    (fv(e, 'upper_wick_pct') ?? 0) / FS[2],
    (fv(e, 'vol_ratio_20')   ?? 0) / FS[3],
    (fv(e, 'vol_vs_pre5')    ?? 0) / FS[4],
    (fv(e, 'range_atr')      ?? 0) / FS[5],
    (fv(e, 'rsi2')           ?? 0) / FS[6],
    (fv(e, 'zone_len')       ?? 0) / FS[7],
    (fv(e, 'zone_tightness') ?? 0) / FS[8],
  ]);
  const { asgn, cents } = kMeans(pts);

  // Global normalized means for cluster characterization
  const gNorm = gMeans.map((m, di) => m / FS[di]);

  const clusterProfiles = Array.from({ length: K }, (_, ci) => {
    const memIdx = asgn.reduce<number[]>((acc, a, i) => { if (a === ci) acc.push(i); return acc; }, []);
    const mems   = memIdx.map(i => events[i]);
    const lMems  = mems.filter(e => e.hit_t1 != null);
    const hits   = lMems.filter(e => e.hit_t1 === true).length;
    const cc = cents[ci];
    let topLbl = 'Mixed', topDev = 0;
    cc.forEach((v, di) => { const dev = Math.abs(v - gNorm[di]); if (dev > topDev) { topDev = dev; topLbl = `${v > gNorm[di] ? 'High' : 'Low'} ${FL[di]}`; } });
    return { id: ci, size: mems.length, hitRate: lMems.length >= 5 ? hits / lMems.length : null, dominant: topLbl, labeledCount: lMems.length };
  });

  // Denormalized centroids for front-end cluster assignment of live events
  const clusterCentroids = cents.map(cc => ({
    closeLoc: cc[0]*FS[0], bodyPct: cc[1]*FS[1], upperWickPct: cc[2]*FS[2],
    volRatio20: cc[3]*FS[3], volPre5: cc[4]*FS[4], rangeATR: cc[5]*FS[5],
    rsi2: cc[6]*FS[6], zoneLen: cc[7]*FS[7], zoneTightness: cc[8]*FS[8],
  }));

  // ── Regime stats ───────────────────────────────────────────────────────────
  const regimeStats: Record<string, { count: number; labeledCount: number; hitRate: number | null }> = {};
  for (const regime of ['bull', 'flat', 'bear']) {
    const rEvts    = events.filter(e => (e.market_regime as string | null ?? 'flat') === regime);
    const rLabeled = rEvts.filter(e => e.hit_t1 != null);
    const rHits    = rLabeled.filter(e => e.hit_t1 === true);
    regimeStats[regime] = {
      count: rEvts.length, labeledCount: rLabeled.length,
      hitRate: rLabeled.length >= 5 ? rHits.length / rLabeled.length : null,
    };
  }

  // ── KS drift (last 30d vs prior 60d) ──────────────────────────────────────
  const c30 = new Date(nowMs - 30  * 86400000).toISOString().slice(0, 10);
  const c90 = new Date(nowMs - 90  * 86400000).toISOString().slice(0, 10);
  const last30 = events.filter(e => (e.event_date as string) >= c30);
  const prev60 = events.filter(e => (e.event_date as string) >= c90 && (e.event_date as string) < c30);
  let ksDrift: { feature: string; stat: number; significant: boolean }[] | null = null;
  if (last30.length >= 5 && prev60.length >= 5) {
    ksDrift = (['vol_vs_pre5', 'zone_tightness', 'close_loc', 'range_atr'] as const).map(fk => {
      const a  = last30.map(e => fv(e, fk)).filter(v => v != null) as number[];
      const b2 = prev60.map(e => fv(e, fk)).filter(v => v != null) as number[];
      const lbl = fk === 'vol_vs_pre5' ? 'Vol/Pre5' : fk === 'zone_tightness' ? 'Zone Tight' : fk === 'close_loc' ? 'Close Loc' : 'Range/ATR';
      const stat = ksStat(a, b2);
      return { feature: lbl, stat: +stat.toFixed(3), significant: ksSignificant(stat, a.length, b2.length) };
    }).filter(r => r.stat > 0);
  }

  return NextResponse.json({
    eventCount: n, actionableCount: actionable.length, runCount: runs.length,
    lastRunDate: runs[0]?.run_date ?? '',
    overallDetectionRate: n > 0 ? actionable.length / n : 0,
    centroid, featureStdDev, stageHitCounts, paramSetStats, featureLifts, archetypeCounts, breakoutTierCounts,
    // Sprint 3
    labeledCount: labeled.length, labeledHitRate, avgRMultiple, kellyFraction,
    featureBuckets, miRanking, clusterProfiles, clusterCentroids, regimeStats, ksDrift,
  }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
}
