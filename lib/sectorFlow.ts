// ─── Sector Relative Capital Flow (Phase 2, Sprint 1) ───────────────────────
//
// Strips the sector tailwind from stock returns to reveal pure stock-specific
// demand. Multi-horizon relative returns → robust MAD z-score (±4 clamp) →
// liquidity-weighted sector flow score. Shadow mode: displayed, not ranked.
//
// Design constraints baked in from the plan:
//  - Date-alignment guard: never compute divergence across mismatched calendars
//  - MAD floor (0.15% daily-return units) prevents fake ±50σ in quiet sectors
//  - Sectors with <8 scanned stocks fall back to market-wide normalization
//  - One failed index never fails the scan — per-sector fresh/stale/missing state

import { getSectorTag } from './signals';

// ── Sector → index ticker adapter config ────────────────────────────────────
// Candidate lists, tried in order. Yahoo ticker availability changes; this is
// configuration, not truth. Sector keys are the short tags from getSectorTag().

export const SECTOR_INDEX_CONFIG: Record<string, { indexName: string; candidates: string[] }> = {
  AUTO: { indexName: 'NIFTY Auto',        candidates: ['^CNXAUTO'] },
  BNK:  { indexName: 'NIFTY Bank',        candidates: ['^NSEBANK'] },
  PVB:  { indexName: 'NIFTY Bank',        candidates: ['^NSEBANK'] },
  PSB:  { indexName: 'NIFTY PSU Bank',    candidates: ['^CNXPSUBANK'] },
  IT:   { indexName: 'NIFTY IT',          candidates: ['^CNXIT'] },
  PHR:  { indexName: 'NIFTY Pharma',      candidates: ['^CNXPHARMA'] },
  HC:   { indexName: 'NIFTY Pharma',      candidates: ['^CNXPHARMA'] },
  HOS:  { indexName: 'NIFTY Pharma',      candidates: ['^CNXPHARMA'] },
  FMCG: { indexName: 'NIFTY FMCG',        candidates: ['^CNXFMCG'] },
  MTL:  { indexName: 'NIFTY Metal',       candidates: ['^CNXMETAL'] },
  RLT:  { indexName: 'NIFTY Realty',      candidates: ['^CNXREALTY'] },
  'O&G':{ indexName: 'NIFTY Energy',      candidates: ['^CNXENERGY'] },
  PWR:  { indexName: 'NIFTY Energy',      candidates: ['^CNXENERGY'] },
  MED:  { indexName: 'NIFTY Media',       candidates: ['^CNXMEDIA'] },
  CON:  { indexName: 'NIFTY Infra',       candidates: ['^CNXINFRA'] },
  CAP:  { indexName: 'NIFTY Infra',       candidates: ['^CNXINFRA'] },
  FIN:  { indexName: 'NIFTY Fin Service', candidates: ['NIFTY_FIN_SERVICE.NS', '^CNXFINANCE'] },
  FEX:  { indexName: 'NIFTY Fin Service', candidates: ['NIFTY_FIN_SERVICE.NS', '^CNXFINANCE'] },
  NBFC: { indexName: 'NIFTY Fin Service', candidates: ['NIFTY_FIN_SERVICE.NS', '^CNXFINANCE'] },
  HF:   { indexName: 'NIFTY Fin Service', candidates: ['NIFTY_FIN_SERVICE.NS', '^CNXFINANCE'] },
  INS:  { indexName: 'NIFTY Fin Service', candidates: ['NIFTY_FIN_SERVICE.NS', '^CNXFINANCE'] },
  SVC:  { indexName: 'NIFTY Consumption', candidates: ['^CNXCONSUM'] },
  RTL:  { indexName: 'NIFTY Consumption', candidates: ['^CNXCONSUM'] },
  DUR:  { indexName: 'NIFTY Cons Durables', candidates: ['NIFTY_CONSR_DURBL.NS', '^CNXCONSUM'] },
  CHM:  { indexName: 'NIFTY Commodities', candidates: ['^CNXCMDT', '^CNXCOMMODITIES'] },
  TRN:  { indexName: 'NIFTY Services',    candidates: ['^CNXSERVICE'] },
  TEL:  { indexName: 'NIFTY Services',    candidates: ['^CNXSERVICE'] },
  // industryMap-specific tags (NSE official industry classification)
  MAT:  { indexName: 'NIFTY Infra',       candidates: ['^CNXINFRA'] },   // cement/construction materials
  AGR:  { indexName: 'NIFTY Commodities', candidates: ['^CNXCMDT', '^CNXCOMMODITIES'] },
  // TEX (Textiles), FRM (Forest Materials), DIV (Diversified) — no suitable NIFTY
  // sector index; deliberately unmapped. Bad classification is worse than no signal.
};

// Unique index tickers to fetch (multiple sectors share indices)
function uniqueIndexGroups(): Array<{ key: string; indexName: string; candidates: string[] }> {
  const seen = new Map<string, { key: string; indexName: string; candidates: string[] }>();
  for (const [, cfg] of Object.entries(SECTOR_INDEX_CONFIG)) {
    const key = cfg.candidates[0];
    if (!seen.has(key)) seen.set(key, { key, indexName: cfg.indexName, candidates: cfg.candidates });
  }
  return [...seen.values()];
}

// ── Types ────────────────────────────────────────────────────────────────────

export type IndexFreshness = 'fresh' | 'stale' | 'missing';

export interface SectorIndexSeries {
  indexName: string;
  ticker: string;          // resolved ticker that actually returned data
  freshness: IndexFreshness;
  dates: string[];         // IST date strings, ascending
  closes: number[];        // aligned with dates
}

export interface SectorFlowScore {
  symbol: string;
  sector: string;          // short tag
  indexName: string;
  score: number;           // robustZ × liquidityConfidence — the headline number
  robustZ: number;         // clamped ±4
  relativeFlowRaw: number; // blended multi-horizon relative return (%)
  stockRet5d: number;      // %
  sectorRet5d: number;     // %
  rel5d: number;           // %
  liquidityConfidence: number;  // 0..1
  normalization: 'sector' | 'market';
  sectorRank: number;      // 1 = strongest in peer set
  sectorSize: number;      // peer set size
  freshness: IndexFreshness;
}

export interface SectorBreadth {
  sector: string;          // short tag
  indexName: string;
  breadthPct: number;      // % of scanned constituents with rel_5d > 0
  count: number;           // scanned constituents
}

// Minimal per-stock input captured during scan
export interface StockSeries {
  symbol: string;
  dates: string[];         // IST dates ascending, last ~15 needed
  closes: number[];
  avgTurnover20: number;   // ₹
}

// ── Index fetcher ────────────────────────────────────────────────────────────

interface RawChart { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> } }

function toISTDate(ts: number): string {
  return new Date((ts + 19800) * 1000).toISOString().slice(0, 10);
}

// Lightweight index parse — volume-optional (index volume is often null on Yahoo,
// which would make fetchClient's parseRaw drop every candle).
function parseIndexRaw(json: RawChart): { dates: string[]; closes: number[] } {
  const r0 = json?.chart?.result?.[0];
  const timestamps = r0?.timestamp ?? [];
  const closeArr = r0?.indicators?.quote?.[0]?.close ?? [];
  const dates: string[] = [], closes: number[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closeArr[i];
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    dates.push(toISTDate(timestamps[i]));
    closes.push(c);
  }
  return { dates, closes };
}

async function fetchOneIndex(candidates: string[]): Promise<{ ticker: string; dates: string[]; closes: number[] } | null> {
  for (const ticker of candidates) {
    try {
      const res = await fetch(`/api/fetch-ohlcv?symbol=${encodeURIComponent(ticker)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const body = await res.json();
      if (!body.ok || !body.raw) continue;
      const { dates, closes } = parseIndexRaw(body.raw);
      if (closes.length >= 15) return { ticker, dates, closes };
    } catch { /* try next candidate */ }
  }
  return null;
}

const LS_KEY = 'sectorIndexCache_v1';

interface CachedIndexData { savedAt: string; series: Record<string, SectorIndexSeries> }

function loadLastGood(): Record<string, SectorIndexSeries> | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed: CachedIndexData = JSON.parse(raw);
    return parsed.series ?? null;
  } catch { return null; }
}

function saveLastGood(series: Record<string, SectorIndexSeries>) {
  try {
    // Trim to last 30 points per index to keep localStorage small
    const trimmed: Record<string, SectorIndexSeries> = {};
    for (const [k, s] of Object.entries(series)) {
      trimmed[k] = { ...s, dates: s.dates.slice(-30), closes: s.closes.slice(-30) };
    }
    localStorage.setItem(LS_KEY, JSON.stringify({ savedAt: new Date().toISOString(), series: trimmed }));
  } catch { /* quota — non-fatal */ }
}

// Fetches all unique sector indices in parallel. Never throws.
// Returns a map keyed by primary candidate ticker; each entry marked
// fresh (fetched now) / stale (from last-good cache) / missing.
export async function fetchSectorIndexData(): Promise<Record<string, SectorIndexSeries>> {
  const groups = uniqueIndexGroups();
  const lastGood = loadLastGood();
  const out: Record<string, SectorIndexSeries> = {};

  const settled = await Promise.allSettled(groups.map(g => fetchOneIndex(g.candidates)));

  groups.forEach((g, i) => {
    const s = settled[i];
    const data = s.status === 'fulfilled' ? s.value : null;
    if (data) {
      out[g.key] = { indexName: g.indexName, ticker: data.ticker, freshness: 'fresh', dates: data.dates, closes: data.closes };
    } else if (lastGood?.[g.key]?.closes?.length) {
      out[g.key] = { ...lastGood[g.key], freshness: 'stale' };
    } else {
      out[g.key] = { indexName: g.indexName, ticker: g.candidates[0], freshness: 'missing', dates: [], closes: [] };
    }
  });

  // Persist only the fresh ones merged over previous cache
  const freshOnly = Object.fromEntries(Object.entries(out).filter(([, v]) => v.freshness === 'fresh'));
  if (Object.keys(freshOnly).length > 0) {
    saveLastGood({ ...(lastGood ?? {}), ...freshOnly });
  }
  return out;
}

// ── Return math with date-alignment guard ────────────────────────────────────

// Return over `h` trading bars ending at index `endIdx` (percent).
function retPct(closes: number[], endIdx: number, h: number): number | null {
  const startIdx = endIdx - h;
  if (startIdx < 0 || endIdx >= closes.length) return null;
  const a = closes[startIdx], b = closes[endIdx];
  if (!(a > 0) || !(b > 0)) return null;
  return (b / a - 1) * 100;
}

// Date-alignment guard: find the most recent date present in BOTH series,
// return the index of that date in each. Null if no overlap.
function alignByDate(stockDates: string[], indexDates: string[]): { si: number; ii: number } | null {
  const idxSet = new Map<string, number>();
  for (let i = indexDates.length - 1; i >= Math.max(0, indexDates.length - 20); i--) idxSet.set(indexDates[i], i);
  for (let s = stockDates.length - 1; s >= Math.max(0, stockDates.length - 5); s--) {
    const ii = idxSet.get(stockDates[s]);
    if (ii !== undefined) return { si: s, ii };
  }
  return null;
}

const HORIZONS = [1, 3, 5, 10] as const;
const H_WEIGHTS: Record<number, number> = { 1: 0.15, 3: 0.25, 5: 0.35, 10: 0.25 };

// ── Scoring ──────────────────────────────────────────────────────────────────

const MAD_FLOOR = 0.15;       // percent daily-return units
const Z_CLAMP = 4;
const MIN_SECTOR_PEERS = 8;
const TURNOVER_LO = 2e7;      // ₹2 crore  → confidence 0
const TURNOVER_HI = 1e8;      // ₹10 crore → confidence 1

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function computeSectorFlowScores(
  stocks: StockSeries[],
  indexData: Record<string, SectorIndexSeries>,
): { scores: Map<string, SectorFlowScore>; breadth: SectorBreadth[] } {
  // Pass 1: raw relative flow per stock
  interface Raw {
    symbol: string; sector: string; indexKey: string; indexName: string;
    relativeFlowRaw: number; stockRet5d: number; sectorRet5d: number; rel5d: number;
    turnover: number; freshness: IndexFreshness;
  }
  const raws: Raw[] = [];

  for (const st of stocks) {
    const sector = getSectorTag(st.symbol);
    if (!sector) continue;
    const cfg = SECTOR_INDEX_CONFIG[sector];
    if (!cfg) continue;
    const indexKey = cfg.candidates[0];
    const idx = indexData[indexKey];
    if (!idx || idx.freshness === 'missing' || idx.closes.length < 12) continue;

    const aligned = alignByDate(st.dates, idx.dates);
    if (!aligned) continue;
    const { si, ii } = aligned;

    let blended = 0, wSum = 0;
    let rel5: number | null = null, sRet5: number | null = null, xRet5: number | null = null;
    for (const h of HORIZONS) {
      const sr = retPct(st.closes, si, h);
      const ir = retPct(idx.closes, ii, h);
      if (sr == null || ir == null) continue;
      const rel = sr - ir;
      blended += H_WEIGHTS[h] * rel;
      wSum += H_WEIGHTS[h];
      if (h === 5) { rel5 = rel; sRet5 = sr; xRet5 = ir; }
    }
    if (wSum < 0.5) continue;  // too few horizons available
    blended /= wSum;           // renormalize over available horizons

    raws.push({
      symbol: st.symbol, sector, indexKey, indexName: idx.indexName,
      relativeFlowRaw: blended,
      stockRet5d: sRet5 ?? 0, sectorRet5d: xRet5 ?? 0, rel5d: rel5 ?? 0,
      turnover: st.avgTurnover20, freshness: idx.freshness,
    });
  }

  // Pass 2: normalize — within sector when ≥8 peers, else against all-market distribution
  const bySector = new Map<string, Raw[]>();
  for (const r of raws) {
    const arr = bySector.get(r.sector) ?? [];
    arr.push(r); bySector.set(r.sector, arr);
  }
  const marketVals = raws.map(r => r.relativeFlowRaw);
  const marketMed = marketVals.length ? median(marketVals) : 0;
  const marketMad = Math.max(marketVals.length ? median(marketVals.map(v => Math.abs(v - marketMed))) : MAD_FLOOR, MAD_FLOOR);

  const scores = new Map<string, SectorFlowScore>();

  for (const [sector, peers] of bySector) {
    const useSector = peers.length >= MIN_SECTOR_PEERS;
    const vals = peers.map(p => p.relativeFlowRaw);
    const med = useSector ? median(vals) : marketMed;
    const mad = useSector ? Math.max(median(vals.map(v => Math.abs(v - med))), MAD_FLOOR) : marketMad;

    // Rank within peer set (descending raw flow)
    const ranked = [...peers].sort((a, b) => b.relativeFlowRaw - a.relativeFlowRaw);
    const rankOf = new Map(ranked.map((p, i) => [p.symbol, i + 1]));

    for (const p of peers) {
      const z = Math.max(-Z_CLAMP, Math.min(Z_CLAMP, 0.6745 * (p.relativeFlowRaw - med) / mad));
      const liq = clamp01(Math.log10(Math.max(p.turnover, 1) / TURNOVER_LO) / Math.log10(TURNOVER_HI / TURNOVER_LO));
      scores.set(p.symbol, {
        symbol: p.symbol, sector, indexName: p.indexName,
        score: z * liq, robustZ: z,
        relativeFlowRaw: p.relativeFlowRaw,
        stockRet5d: p.stockRet5d, sectorRet5d: p.sectorRet5d, rel5d: p.rel5d,
        liquidityConfidence: liq,
        normalization: useSector ? 'sector' : 'market',
        sectorRank: rankOf.get(p.symbol) ?? 0, sectorSize: peers.length,
        freshness: p.freshness,
      });
    }
  }

  // Sector breadth: % of scanned constituents with positive 5d relative flow
  const breadth: SectorBreadth[] = [];
  for (const [sector, peers] of bySector) {
    if (peers.length < 3) continue;
    const pos = peers.filter(p => p.rel5d > 0).length;
    breadth.push({
      sector, indexName: peers[0].indexName,
      breadthPct: Math.round((pos / peers.length) * 100),
      count: peers.length,
    });
  }
  breadth.sort((a, b) => b.breadthPct - a.breadthPct);

  return { scores, breadth };
}

// ── Kill switch + ranking integration (Sprint 2) ─────────────────────────────

// One-line disable when the data source misbehaves — no formula surgery at 9:20 AM.
export const SECTOR_FLOW_ENABLED = true;

// Conviction adjustment for Focus Tab ranking. Bounded ±8 points so sector flow
// tilts the ordering without dominating the technical score. Stale/missing data
// and low-liquidity scores contribute exactly 0 (enforced circuit breaker).
export function sectorFlowConvictionBoost(sf: SectorFlowScore | undefined): number {
  if (!SECTOR_FLOW_ENABLED || !sf) return 0;
  if (sf.freshness !== 'fresh') return 0;          // circuit breaker: stale data never ranks
  if (sf.liquidityConfidence < 0.3) return 0;      // illiquid outliers never rank
  if (sf.score >= 1.5) return Math.min(8, Math.round(sf.score * 3));
  if (sf.score <= -1.5) return Math.max(-8, Math.round(sf.score * 3));
  return 0;
}

// Coverage report: how much of the scanned universe got a sector flow score.
export function sectorFlowCoverage(
  scannedCount: number,
  scores: Map<string, SectorFlowScore> | Record<string, SectorFlowScore>,
): { covered: number; total: number; pct: number } {
  const covered = scores instanceof Map ? scores.size : Object.keys(scores).length;
  return { covered, total: scannedCount, pct: scannedCount > 0 ? Math.round((covered / scannedCount) * 100) : 0 };
}

// ── UI helpers ────────────────────────────────────────────────────────────────

export function sectorFlowBadgeColor(s: SectorFlowScore): string {
  if (s.liquidityConfidence < 0.3 || s.freshness !== 'fresh') return 'text-slate-500';
  if (s.score >= 1.0) return 'text-emerald-400';
  if (s.score <= -1.0) return 'text-red-400';
  return 'text-slate-400';
}

export function sectorFlowLabel(s: SectorFlowScore): string {
  const sign = s.score >= 0 ? '+' : '';
  return `${sign}${s.score.toFixed(1)}σ vs ${s.indexName.replace('NIFTY ', '')}`;
}
