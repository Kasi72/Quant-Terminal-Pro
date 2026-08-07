// PBFB Brain Worker — Sprint 2
// Vectorize fingerprinting + Workers AI narration for the UC-hitter intelligence loop.
//
// Endpoints (all require x-worker-token header except OPTIONS):
//   POST /ingest      — pull recent pbfb_uc_events from Supabase, upsert fingerprints into Vectorize
//   POST /similar     — body { features: EventFeatures, topK? } → nearest historical events + hit rate
//   GET  /narrate     — Llama 3.1 summary of the current brain state
//   GET  /bayes-wr    — Bayesian Beta-Binomial win-rate posteriors per archetype
//   scheduled()       — nightly /ingest + /label-outcomes + Bayesian WR update (cron in wrangler.toml)

interface VectorizeMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}
interface VectorizeIndex {
  upsert(vectors: { id: string; values: number[]; metadata?: Record<string, unknown> }[]): Promise<unknown>;
  query(vector: number[], opts: { topK: number; returnMetadata?: string }): Promise<{ matches: VectorizeMatch[] }>;
}
interface Ai {
  run(model: string, input: Record<string, unknown>): Promise<{ response?: string }>;
}

interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  WORKER_TOKEN: string;
  ALLOWED_ORIGINS?: string;
}

interface EventFeatures {
  closeLoc: number;      // 0–100
  bodyPct: number;       // 0–100
  upperWickPct: number;  // 0–100
  volRatio20: number;    // ~0–10
  volPre5: number;       // ~0–15
  rangeATR: number;      // ~0–5
  rsi2: number;          // 0–100
  zoneLen: number;       // 0–25
  zoneTightness: number; // 0–30 (%)
}

interface EventRow {
  id: string;
  run_date: string;
  event_date: string | null;
  symbol: string;
  best_stage: string;
  best_param_set: string | null;
  classification: string;
  move_pct: number;
  close_loc: number | null;
  body_pct: number | null;
  upper_wick_pct: number | null;
  vol_ratio_20: number | null;
  vol_vs_pre5: number | null;
  range_atr: number | null;
  rsi2: number | null;
  zone_len: number | null;
  zone_tightness: number | null;
  shape_vec: number[] | null;
  near_breakout_tier: string | null;
  archetype_type: string | null;
  zone_shape: string | null;
  // Trajectory features (D-1 vs D-3): stored on n_before=1 rows
  vol_accel: number | null;      // vol_ratio_20[D-1] / vol_ratio_20[D-3]
  rsi2_velocity: number | null;  // rsi2[D-1] - rsi2[D-3]
  cl_trend: number | null;       // close_loc[D-1] - close_loc[D-3]
}

interface TrajectoryFeatures {
  volAccel: number | null;
  rsi2Velocity: number | null;
  clTrend: number | null;
}

// Per-feature scales so cosine distance weights all 9 dimensions comparably.
// Must stay in sync with the FAS scales in components/PBFBAnalyzer.tsx.
const SCALES: Record<keyof EventFeatures, number> = {
  closeLoc: 100, bodyPct: 100, upperWickPct: 100,
  volRatio20: 5, volPre5: 8, rangeATR: 3,
  rsi2: 100, zoneLen: 25, zoneTightness: 20,
};
const FEATURE_ORDER = Object.keys(SCALES) as (keyof EventFeatures)[];

// Vector layout (32 dims, Vectorize minimum):
//   0-8   scaled FAS features
//   9-28  candle-shape fingerprint (10 normalized closes + 10 volume ratios),
//         downweighted so 20 shape dims don't drown out the 9 feature dims
//   29-31 reserved
const VECTOR_DIMS = 32;
const SHAPE_OFFSET = 9;
const SHAPE_LEN = 20;
const SHAPE_WEIGHT = 0.6;

function toVector(f: EventFeatures, shape?: number[] | null, traj?: TrajectoryFeatures | null): number[] {
  const v = new Array<number>(VECTOR_DIMS).fill(0);
  FEATURE_ORDER.forEach((k, i) => { v[i] = (f[k] ?? 0) / SCALES[k]; });
  if (shape && shape.length === SHAPE_LEN) {
    shape.forEach((s, i) => { v[SHAPE_OFFSET + i] = Number(s) * SHAPE_WEIGHT; });
  }
  // dims 29-31: trajectory features (reserved → active 2026-08-02)
  if (traj?.volAccel != null)     v[29] = Math.min(3, Math.max(0, traj.volAccel)) / 3;
  if (traj?.rsi2Velocity != null) v[30] = (Math.min(50, Math.max(-50, traj.rsi2Velocity)) + 50) / 100;
  if (traj?.clTrend != null)      v[31] = (Math.min(80, Math.max(-80, traj.clTrend)) + 80) / 160;
  return v;
}

function rowToTrajectory(r: EventRow): TrajectoryFeatures {
  return { volAccel: r.vol_accel, rsi2Velocity: r.rsi2_velocity, clTrend: r.cl_trend };
}

function rowToFeatures(r: EventRow): EventFeatures {
  return {
    closeLoc: r.close_loc ?? 0, bodyPct: r.body_pct ?? 0, upperWickPct: r.upper_wick_pct ?? 0,
    volRatio20: r.vol_ratio_20 ?? 0, volPre5: r.vol_vs_pre5 ?? 0, rangeATR: r.range_atr ?? 0,
    rsi2: r.rsi2 ?? 0, zoneLen: r.zone_len ?? 0, zoneTightness: r.zone_tightness ?? 0,
  };
}

function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-worker-token',
};

const MAX_REQUEST_BYTES = 64_000;

function corsHeaders(req?: Request, env?: Env): Record<string, string> {
  const origin = req?.headers.get('origin') ?? '';
  const allowed = (env?.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (allowed.length === 0) return CORS;
  return {
    ...CORS,
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    Vary: 'Origin',
  };
}

function json(data: unknown, status = 200, req?: Request, env?: Env): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(req, env) },
  });
}

async function readJsonWithLimit<T>(req: Request, maxBytes: number): Promise<T> {
  const declaredLength = Number(req.headers.get('content-length') ?? 0);
  if (declaredLength > maxBytes) throw new Error('payload too large');
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error('payload too large');
  return JSON.parse(raw) as T;
}

async function supabaseGet(env: Env, path: string): Promise<unknown> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

async function supabasePatch(env: Env, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${res.status}: ${await res.text()}`);
}

async function supabasePost(env: Env, path: string, body: unknown): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Supabase POST ${res.status}: ${await res.text()}`);
}

// ── Outcome labeling ─────────────────────────────────────────────────────────
const HIT_T1_MULT  = 1.08;
const HIT_T2_MULT  = 1.15;
const STOP_MULT    = 0.95;
const LABEL_BATCH  = 30;
const LABEL_DAYS   = 20;

interface UnlabeledRow {
  id: string;
  event_date: string;
  symbol: string;
  close_price: number | null;
}

async function fetchYahooOHLCV(symbol: string, fromDate: string, toDate: string): Promise<{ date: string; high: number; low: number; close: number }[]> {
  const nseSymbol = `${symbol}.NS`;
  const p1 = Math.floor(new Date(fromDate).getTime() / 1000);
  const p2 = Math.floor(new Date(toDate).getTime() / 1000);
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(nseSymbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const j = await res.json() as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{ high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null> }>;
            adjclose?: Array<{ adjclose?: number[] }>;
          };
        }>;
      };
    };
    const result = j.chart?.result?.[0];
    if (!result?.timestamp) return [];
    const quote = result.indicators?.quote?.[0];
    // Keep OHLC in one price basis. Mixing adjusted close with raw high/low can
    // corrupt outcome labels around corporate actions.
    const closes = quote?.close ?? [];
    const highs = quote?.high ?? closes;
    const lows = quote?.low ?? closes;
    return result.timestamp
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        high: highs[i] ?? closes[i] ?? 0,
        low: lows[i] ?? closes[i] ?? 0,
        close: closes[i] ?? 0,
      }))
      .filter(r => r.close > 0 && r.high > 0 && r.low > 0);
  } catch { return []; }
}

async function labelOutcomes(env: Env): Promise<{ labeled: number }> {
  const cutoff = new Date(Date.now() - LABEL_DAYS * 1.5 * 86400000).toISOString().slice(0, 10);
  const rows = await supabaseGet(
    env,
    `pbfb_uc_events?select=id,event_date,symbol,close_price&n_before=eq.1&hit_t1=is.null&outcome_labeled_at=is.null&event_date=lte.${cutoff}&order=event_date.desc&limit=${LABEL_BATCH}`,
  ) as UnlabeledRow[];

  let labeled = 0;
  for (const row of rows) {
    if (!row.close_price || !row.event_date) continue;
    const toDate = new Date(new Date(row.event_date).getTime() + 35 * 86400000).toISOString().slice(0, 10);
    const prices = await fetchYahooOHLCV(row.symbol, row.event_date, toDate);
    if (prices.length === 0) {
      // No Yahoo data — delisted or ticker gone. Mark to stop nightly retries.
      await supabasePatch(env, `pbfb_uc_events?id=eq.${row.id}`, {
        outcome_labeled_at: new Date().toISOString().slice(0, 10),
      });
      continue;
    }
    const fwd = prices.filter(p => p.date > row.event_date).slice(0, LABEL_DAYS);
    if (fwd.length < 10) continue;

    const base = row.close_price;
    let hit_t1 = false, hit_t2 = false, stopped_out = false;
    for (const p of fwd) {
      if (p.high >= base * HIT_T1_MULT) hit_t1 = true;
      if (p.high >= base * HIT_T2_MULT) hit_t2 = true;
      if (!hit_t1 && p.low <= base * STOP_MULT) stopped_out = true;
    }
    const outcome_pct_20d = +((fwd[fwd.length - 1].close - base) / base * 100).toFixed(2);

    await supabasePatch(env, `pbfb_uc_events?id=eq.${row.id}`, {
      hit_t1, hit_t2, stopped_out, outcome_pct_20d,
      outcome_labeled_at: new Date().toISOString().slice(0, 10),
    });
    labeled++;
  }
  return { labeled };
}

// ── Trajectory: compute & store D-1 vs D-3 features on n_before=1 rows ──────
async function computeAndStoreTrajectory(env: Env, d1Rows: EventRow[], sevenDaysAgo: string): Promise<void> {
  const needsTraj = d1Rows.filter(r => r.vol_accel == null);
  if (needsTraj.length === 0) return;

  // n_before=3 rows share the same event_date (the UC event date) as n_before=1 rows
  const d3Rows = await supabaseGet(
    env,
    `pbfb_uc_events?select=symbol,event_date,vol_ratio_20,rsi2,close_loc&n_before=eq.3&event_date=gte.${sevenDaysAgo}&order=event_date.desc&limit=2000`,
  ) as Array<{ symbol: string; event_date: string | null; vol_ratio_20: number | null; rsi2: number | null; close_loc: number | null }>;

  const d3Map = new Map<string, typeof d3Rows[0]>();
  for (const r of d3Rows) {
    if (r.event_date) d3Map.set(`${r.symbol}_${r.event_date}`, r);
  }

  for (const r of needsTraj) {
    if (!r.event_date) continue;
    const d3 = d3Map.get(`${r.symbol}_${r.event_date}`);
    if (!d3) continue;

    const vol_accel = (d3.vol_ratio_20 != null && d3.vol_ratio_20 > 0 && r.vol_ratio_20 != null)
      ? Math.round(r.vol_ratio_20 / d3.vol_ratio_20 * 1000) / 1000 : null;
    const rsi2_velocity = (r.rsi2 != null && d3.rsi2 != null)
      ? Math.round((r.rsi2 - d3.rsi2) * 100) / 100 : null;
    const cl_trend = (r.close_loc != null && d3.close_loc != null)
      ? Math.round((r.close_loc - d3.close_loc) * 100) / 100 : null;

    if (vol_accel == null && rsi2_velocity == null && cl_trend == null) continue;

    try {
      await supabasePatch(env, `pbfb_uc_events?id=eq.${r.id}`, { vol_accel, rsi2_velocity, cl_trend });
      r.vol_accel = vol_accel; r.rsi2_velocity = rsi2_velocity; r.cl_trend = cl_trend;
    } catch { /* non-fatal — vectorize uses null trajectory for this row */ }
  }
}

// ── Ingest: Supabase events → Vectorize fingerprints ────────────────────────
async function ingest(env: Env): Promise<{ ingested: number }> {
  // Bug 22 fix: date filter keeps nightly ingestion well within the 1000-row Supabase limit
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await supabaseGet(
    env,
    `pbfb_uc_events?select=id,run_date,event_date,symbol,best_stage,best_param_set,classification,move_pct,close_loc,body_pct,upper_wick_pct,vol_ratio_20,vol_vs_pre5,range_atr,rsi2,zone_len,zone_tightness,shape_vec,near_breakout_tier,archetype_type,zone_shape,vol_accel,rsi2_velocity,cl_trend&n_before=eq.1&run_date=gte.${sevenDaysAgo}&order=created_at.desc&limit=1000`,
  ) as EventRow[];

  // Compute & persist trajectory for rows that don't have it yet, then update in-memory rows
  await computeAndStoreTrajectory(env, rows, sevenDaysAgo);

  let ingested = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await env.VECTORIZE.upsert(chunk.map(r => ({
      id: r.id,
      values: toVector(rowToFeatures(r), r.shape_vec, rowToTrajectory(r)),
      metadata: {
        symbol: r.symbol, run_date: r.run_date, event_date: r.event_date ?? '',
        best_stage: r.best_stage, best_param_set: r.best_param_set ?? '',
        classification: r.classification, move_pct: r.move_pct,
        near_breakout_tier: r.near_breakout_tier ?? null,
        archetype_type:     r.archetype_type     ?? null,
        zone_shape:         r.zone_shape         ?? null,
      },
    })));
    ingested += chunk.length;
  }
  return { ingested };
}

// ── Similar: nearest historical fingerprints for a live event ───────────────
async function similar(env: Env, features: EventFeatures, topK: number, shape?: number[] | null) {
  const { matches } = await env.VECTORIZE.query(toVector(features, shape), {
    topK: Math.min(Math.max(topK, 1), 20),
    returnMetadata: 'all',
  });
  const actionable = matches.filter(m => m.metadata?.classification === 'actionable').length;
  return {
    matches: matches.map(m => ({
      score: Math.round(m.score * 1000) / 1000,
      symbol: m.metadata?.symbol ?? null,
      runDate: (m.metadata?.event_date || m.metadata?.run_date) ?? null,
      bestStage: m.metadata?.best_stage ?? null,
      bestParamSet: m.metadata?.best_param_set ?? null,
      classification: m.metadata?.classification ?? null,
      movePct: m.metadata?.move_pct ?? null,
    })),
    neighborHitRate: matches.length > 0 ? actionable / matches.length : null,
  };
}

// ── Narrate: Llama summary of the brain state ────────────────────────────────
async function narrate(env: Env): Promise<{ narration: string }> {
  const events = await supabaseGet(
    env,
    'pbfb_uc_events?select=classification,best_stage&n_before=eq.1&order=created_at.desc&limit=500',
  ) as { classification: string; best_stage: string }[];

  const total = events.length;
  const actionable = events.filter(e => e.classification === 'actionable').length;
  const stageCounts: Record<string, number> = {};
  for (const e of events) stageCounts[e.best_stage] = (stageCounts[e.best_stage] ?? 0) + 1;

  const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [
      {
        role: 'system',
        content: 'You are a terse quant assistant. Summarize breakout-screener statistics in 3 sentences max. No preamble, no hedging, no advice — just what the data says.',
      },
      {
        role: 'user',
        content: `Last ${total} upper-circuit events (1 day before breakout): ${actionable} were caught at an actionable stage (${total > 0 ? (actionable / total * 100).toFixed(1) : 0}% detection). Stage distribution: ${JSON.stringify(stageCounts)}. Summarize the screener's current form.`,
      },
    ],
    max_tokens: 150,
  });

  return { narration: result.response ?? 'No narration generated.' };
}

// ── Bayesian WR: Beta-Binomial posterior per archetype ───────────────────────
// Prior from OOS backtests. Live data from pbfb_uc_events (labeled).
// Posterior alpha = prior_wins + live_wins; beta = prior_losses + live_losses.
const BAYES_PRIORS: Record<string, { alpha: number; beta: number }> = {
  CompressionCoil:  { alpha: 173, beta:  84 }, // OOS WR 67.3%, n=257
  VolumeFootprint:  { alpha:  50, beta:  12 }, // OOS WR ~81%, n≈62
  MomentumPocket:   { alpha:  35, beta:   4 }, // OOS WR ~90%, n≈39
  EMAStack:         { alpha:  25, beta:   7 }, // OOS WR ~78%, n≈32
  CircuitBreaker:   { alpha:  45, beta:  13 }, // OOS WR ~78%, n≈58
};

function betaCI(a: number, b: number): { low: number; high: number } {
  const mean = a / (a + b);
  const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
  const std = Math.sqrt(variance);
  return { low: Math.max(0, mean - 1.96 * std), high: Math.min(1, mean + 1.96 * std) };
}

async function computeBayesianWR(env: Env): Promise<{ updated: number }> {
  type LabeledRow = { archetype_type: string | null; hit_t1: boolean | null; stopped_out: boolean | null };
  const rows = await supabaseGet(
    env,
    `pbfb_uc_events?select=archetype_type,hit_t1,stopped_out&n_before=eq.1&outcome_labeled_at=not.is.null&archetype_type=not.is.null&limit=5000`,
  ) as LabeledRow[];

  const tally = new Map<string, { wins: number; losses: number }>();
  for (const r of rows) {
    if (!r.archetype_type) continue;
    const arch = r.archetype_type;
    if (!tally.has(arch)) tally.set(arch, { wins: 0, losses: 0 });
    const t = tally.get(arch)!;
    if (r.hit_t1 === true) t.wins++;
    else if (r.stopped_out === true || r.hit_t1 === false) t.losses++;
  }

  const today = new Date().toISOString().slice(0, 10);
  let updated = 0;

  for (const [arch, prior] of Object.entries(BAYES_PRIORS)) {
    const live = tally.get(arch) ?? { wins: 0, losses: 0 };
    const alpha = prior.alpha + live.wins;
    const beta  = prior.beta  + live.losses;
    const posterior_mean = alpha / (alpha + beta);
    const ci = betaCI(alpha, beta);
    await supabasePost(env, `archetype_bayes_wr`, {
      archetype: arch, prior_alpha: prior.alpha, prior_beta: prior.beta,
      live_wins: live.wins, live_losses: live.losses,
      alpha, beta, posterior_mean,
      ci_low: ci.low, ci_high: ci.high, updated_at: today,
    });
    updated++;
  }
  return { updated };
}

async function getBayesianWR(env: Env): Promise<unknown> {
  return supabaseGet(env, `archetype_bayes_wr?select=*&order=posterior_mean.desc`);
}

// ── Router ───────────────────────────────────────────────────────────────────
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });

    if (!tokenMatches(req.headers.get('x-worker-token'), env.WORKER_TOKEN)) {
      return json({ error: 'unauthorized' }, 401, req, env);
    }

    const { pathname } = new URL(req.url);
    try {
      if (req.method === 'POST' && pathname === '/ingest') {
        return json(await ingest(env), 200, req, env);
      }
      if (req.method === 'POST' && pathname === '/similar') {
        let body: { features?: EventFeatures; shape?: number[] | null; topK?: number };
        try {
          body = await readJsonWithLimit(req, MAX_REQUEST_BYTES);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'invalid json';
          return json({ error: message === 'payload too large' ? message : 'invalid json' }, message === 'payload too large' ? 413 : 400, req, env);
        }
        if (!body.features) return json({ error: 'features required' }, 400, req, env);
        return json(await similar(env, body.features, body.topK ?? 10, body.shape), 200, req, env);
      }
      if (req.method === 'GET' && pathname === '/narrate') {
        return json(await narrate(env), 200, req, env);
      }
      if (req.method === 'GET' && pathname === '/bayes-wr') {
        return json(await getBayesianWR(env), 200, req, env);
      }
      if (req.method === 'POST' && pathname === '/label-outcomes') {
        return json(await labelOutcomes(env), 200, req, env);
      }
      return json({ error: 'not found' }, 404, req, env);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'internal error' }, 500, req, env);
    }
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    await ingest(env);
    await labelOutcomes(env);
    await computeBayesianWR(env);
  },
};
