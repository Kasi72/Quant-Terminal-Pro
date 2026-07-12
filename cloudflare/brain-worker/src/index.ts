// PBFB Brain Worker — Sprint 2
// Vectorize fingerprinting + Workers AI narration for the UC-hitter intelligence loop.
//
// Endpoints (all require x-worker-token header except OPTIONS):
//   POST /ingest   — pull recent pbfb_uc_events from Supabase, upsert fingerprints into Vectorize
//   POST /similar  — body { features: EventFeatures, topK? } → nearest historical events + hit rate
//   GET  /narrate  — Llama 3.1 summary of the current brain state
//   scheduled()    — nightly /ingest (cron in wrangler.toml)

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
  symbol: string;
  best_stage: string;
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
}

// Per-feature scales so cosine distance weights all 9 dimensions comparably.
// Must stay in sync with the FAS scales in components/PBFBAnalyzer.tsx.
const SCALES: Record<keyof EventFeatures, number> = {
  closeLoc: 100, bodyPct: 100, upperWickPct: 100,
  volRatio20: 5, volPre5: 8, rangeATR: 3,
  rsi2: 100, zoneLen: 25, zoneTightness: 20,
};
const FEATURE_ORDER = Object.keys(SCALES) as (keyof EventFeatures)[];

// Vectorize requires >= 32 dims. Zero-padding beyond the 9 real features
// preserves cosine similarity exactly; dims 9-31 are reserved for future
// candle-shape (DTW) features.
const VECTOR_DIMS = 32;

function toVector(f: EventFeatures): number[] {
  const v = new Array<number>(VECTOR_DIMS).fill(0);
  FEATURE_ORDER.forEach((k, i) => { v[i] = (f[k] ?? 0) / SCALES[k]; });
  return v;
}

function rowToFeatures(r: EventRow): EventFeatures {
  return {
    closeLoc: r.close_loc ?? 0, bodyPct: r.body_pct ?? 0, upperWickPct: r.upper_wick_pct ?? 0,
    volRatio20: r.vol_ratio_20 ?? 0, volPre5: r.vol_vs_pre5 ?? 0, rangeATR: r.range_atr ?? 0,
    rsi2: r.rsi2 ?? 0, zoneLen: r.zone_len ?? 0, zoneTightness: r.zone_tightness ?? 0,
  };
}

// Workers runtime extends SubtleCrypto with a synchronous timing-safe compare.
interface SubtleCryptoWithTSE extends SubtleCrypto {
  timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
}

function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const enc = new TextEncoder();
  const a = enc.encode(provided);
  const b = enc.encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  return (crypto.subtle as SubtleCryptoWithTSE).timingSafeEqual(a, b);
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-worker-token',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

async function supabaseGet(env: Env, path: string): Promise<unknown> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Ingest: Supabase events → Vectorize fingerprints ────────────────────────
async function ingest(env: Env): Promise<{ ingested: number }> {
  const rows = await supabaseGet(
    env,
    'pbfb_uc_events?select=id,run_date,symbol,best_stage,classification,move_pct,close_loc,body_pct,upper_wick_pct,vol_ratio_20,vol_vs_pre5,range_atr,rsi2,zone_len,zone_tightness&n_before=eq.1&order=created_at.desc&limit=1000',
  ) as EventRow[];

  let ingested = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await env.VECTORIZE.upsert(chunk.map(r => ({
      id: r.id,
      values: toVector(rowToFeatures(r)),
      metadata: {
        symbol: r.symbol, run_date: r.run_date, best_stage: r.best_stage,
        classification: r.classification, move_pct: r.move_pct,
      },
    })));
    ingested += chunk.length;
  }
  return { ingested };
}

// ── Similar: nearest historical fingerprints for a live event ───────────────
async function similar(env: Env, features: EventFeatures, topK: number) {
  const { matches } = await env.VECTORIZE.query(toVector(features), {
    topK: Math.min(Math.max(topK, 1), 20),
    returnMetadata: 'all',
  });
  const actionable = matches.filter(m => m.metadata?.classification === 'actionable').length;
  return {
    matches: matches.map(m => ({
      score: Math.round(m.score * 1000) / 1000,
      symbol: m.metadata?.symbol ?? null,
      runDate: m.metadata?.run_date ?? null,
      bestStage: m.metadata?.best_stage ?? null,
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

// ── Router ───────────────────────────────────────────────────────────────────
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (!tokenMatches(req.headers.get('x-worker-token'), env.WORKER_TOKEN)) {
      return json({ error: 'unauthorized' }, 401);
    }

    const { pathname } = new URL(req.url);
    try {
      if (req.method === 'POST' && pathname === '/ingest') {
        return json(await ingest(env));
      }
      if (req.method === 'POST' && pathname === '/similar') {
        const body = await req.json() as { features?: EventFeatures; topK?: number };
        if (!body.features) return json({ error: 'features required' }, 400);
        return json(await similar(env, body.features, body.topK ?? 10));
      }
      if (req.method === 'GET' && pathname === '/narrate') {
        return json(await narrate(env));
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'internal error' }, 500);
    }
  },

  async scheduled(_event: unknown, env: Env): Promise<void> {
    await ingest(env);
  },
};
