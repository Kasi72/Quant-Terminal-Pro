// ─── Bulk Deal Flow (Phase 3, frontend) ──────────────────────────────────────
// Reads precomputed bulk_deal_daily_scores from Supabase at scan time.
// One batched query — never per-symbol round trips, never raw deal rows.

import { getClient } from './supabase';

// Kill switch: one-line disable when the BSE feed misbehaves.
export const BULK_FLOW_ENABLED = true;

// Circuit breaker: scores older than this many trading days are not shown/ranked.
const MAX_AGE_DAYS = 4; // ~2 trading days + weekend

export interface BulkFlowScore {
  symbol: string;
  dealDate: string;
  netBuyValue: number;       // ₹
  netBuyRatio: number;       // -1..+1
  abnormalityZ: number | null;
  clientCredibility: number; // 0..1
  finalScore: number;        // 0..100
  confidence: 'high' | 'medium' | 'low' | 'new_large_deal';
  flags: string[];
  ageDays: number;
}

export interface BulkIngestionHealth {
  lastSuccessDate: string | null;
  lastRunStatus: string | null;
  failing: boolean;          // latest run errored AND no success in window
}

// Strips .NS/.BO so screener symbols match the stored NSE-style symbols.
function cleanSymbol(s: string): string {
  return s.replace(/\.(NS|BO)$/i, '').toUpperCase();
}

export async function fetchBulkFlowScores(
  symbols: string[],
): Promise<{ scores: Record<string, BulkFlowScore>; health: BulkIngestionHealth }> {
  const empty = { scores: {}, health: { lastSuccessDate: null, lastRunStatus: null, failing: false } };
  if (!BULK_FLOW_ENABLED || symbols.length === 0) return empty;

  try {
    const supabase = getClient();
    const since = new Date(Date.now() - MAX_AGE_DAYS * 86400_000).toISOString().slice(0, 10);
    const cleaned = [...new Set(symbols.map(cleanSymbol))];

    // Supabase .in() caps around 1000 comfortably; chunk to stay safe at 1600+ symbols
    const chunks: string[][] = [];
    for (let i = 0; i < cleaned.length; i += 500) chunks.push(cleaned.slice(i, i + 500));

    const scores: Record<string, BulkFlowScore> = {};
    const today = Date.now();

    for (const chunk of chunks) {
      const { data } = await supabase
        .from('bulk_deal_daily_scores')
        .select('deal_date, symbol, net_buy_value, net_buy_ratio, abnormality_z, client_credibility, final_bulk_score, confidence, flags')
        .gte('deal_date', since)
        .in('symbol', chunk)
        .order('deal_date', { ascending: false });

      for (const row of data ?? []) {
        if (scores[row.symbol]) continue; // keep most recent per symbol (ordered desc)
        const ageDays = Math.floor((today - new Date(row.deal_date + 'T00:00:00Z').getTime()) / 86400_000);
        scores[row.symbol] = {
          symbol: row.symbol, dealDate: row.deal_date,
          netBuyValue: row.net_buy_value ?? 0,
          netBuyRatio: row.net_buy_ratio ?? 0,
          abnormalityZ: row.abnormality_z,
          clientCredibility: row.client_credibility ?? 0.5,
          finalScore: row.final_bulk_score ?? 0,
          confidence: row.confidence ?? 'low',
          flags: Array.isArray(row.flags) ? row.flags : [],
          ageDays,
        };
      }
    }

    // Ingestion health for the failure banner
    const { data: runs } = await supabase
      .from('market_data_ingestion_runs')
      .select('run_date, status')
      .eq('source', 'bse_bulk_deals')
      .order('started_at', { ascending: false })
      .limit(6);
    const lastSuccess = runs?.find(r => r.status === 'success')?.run_date ?? null;
    const lastStatus = runs?.[0]?.status ?? null;
    const failing = lastStatus === 'error' && (!lastSuccess ||
      (Date.now() - new Date(lastSuccess + 'T00:00:00Z').getTime()) > MAX_AGE_DAYS * 86400_000);

    return { scores, health: { lastSuccessDate: lastSuccess, lastRunStatus: lastStatus, failing } };
  } catch {
    return empty; // bulk flow is additive — never fail a scan over it
  }
}

// Ranking contribution — bounded ±6, smaller than sector flow's ±8 because the
// data source is operationally more fragile. Stale scores contribute 0.
export function bulkFlowConvictionBoost(bf: BulkFlowScore | undefined): number {
  if (!BULK_FLOW_ENABLED || !bf) return 0;
  if (bf.ageDays > MAX_AGE_DAYS) return 0;
  if (bf.flags.includes('matched_client')) return 0;
  if (bf.finalScore >= 75) return 6;
  if (bf.finalScore >= 60) return 3;
  if (bf.finalScore <= 25 && bf.netBuyValue < 0) return -6;
  return 0;
}

export function bulkFlowLabel(bf: BulkFlowScore): string {
  const cr = Math.abs(bf.netBuyValue) / 1e7;
  const dir = bf.netBuyValue >= 0 ? 'Net Buy' : 'Net Sell';
  return `Bulk ${bf.finalScore} · ${dir} ₹${cr.toFixed(1)}Cr${bf.ageDays > 0 ? ` · ${bf.ageDays}d ago` : ''}`;
}

export function bulkFlowColor(bf: BulkFlowScore): string {
  if (bf.flags.includes('matched_client') || bf.ageDays > MAX_AGE_DAYS) return 'text-slate-500';
  if (bf.finalScore >= 75 && bf.netBuyValue > 0) return 'text-emerald-400';
  if (bf.finalScore >= 60 && bf.netBuyValue > 0) return 'text-emerald-500';
  if (bf.netBuyValue < 0) return 'text-red-400';
  return 'text-slate-400';
}
