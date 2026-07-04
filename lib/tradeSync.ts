import { getClient } from './supabase';
import type { TrackedTrade } from './tradingUtils';

const USER_ID = 'drkkr';
const LS_KEY = 'qtp_tracked_trades';
const LS_BACKUP = 'qtp_tracked_trades_backup';
const LS_EMERGENCY = 'qtp_tracked_trades_emergency'; // restored: triple-redundancy

// ─── Supabase helpers ───────────────────────────────────────────────────────

function toRow(t: TrackedTrade) {
  const a = t as any;
  return {
    user_id: USER_ID,
    symbol: t.symbol,
    stage: t.stage,
    entry_price: t.entryPrice,
    entry_date: t.entryDate,
    stop_loss: t.stopLoss,
    target1: t.target1,
    target2: t.target2,
    target3: t.target3,
    disaster_stop: t.disasterStop,
    param_set_key: t.paramSetKey,
    sector: t.sector,
    conviction: t.conviction,
    status: t.status,
    candle_pattern: t.candlePattern,
    atr_state: t.atrState,
    volume_badge: t.volumeBadge,
    regime_at_entry: t.regimeAtEntry,
    exit_price: a.exitPrice ?? null,
    exit_date: a.exitDate ?? null,
    pnl_pct: a.pnlPct ?? null,
    outcome: a.outcome ?? null,
    notes: a.notes ?? null,
    tf_alignment: t.tfAlignment ?? null,
    rs_rank: safeNum(t.rsRank) ?? null,
    raw_json: t,
    updated_at: new Date().toISOString(),
  };
}

function safeNum(v: unknown, fallback?: number): number | undefined {
  if (v == null) return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function fromRow(row: any): TrackedTrade {
  // Spread raw_json as base, then overlay ALL authoritative DB columns on top.
  // raw_json may be stale (older schema) — DB columns are always current.
  const base = (row.raw_json ?? {}) as Partial<TrackedTrade>;
  return {
    ...base,
    symbol: row.symbol ?? base.symbol,
    status: row.status ?? base.status,
    stage: row.stage ?? base.stage,
    entryPrice: safeNum(row.entry_price) ?? base.entryPrice ?? 0,
    stopLoss: safeNum(row.stop_loss) ?? base.stopLoss ?? 0,
    target1: safeNum(row.target1) ?? base.target1,
    target2: safeNum(row.target2) ?? base.target2,
    target3: safeNum(row.target3) ?? base.target3,
    disasterStop: safeNum(row.disaster_stop) ?? base.disasterStop,
    entryDate: row.entry_date ?? base.entryDate,
    paramSetKey: row.param_set_key ?? base.paramSetKey,
    sector: row.sector ?? base.sector,
    conviction: safeNum(row.conviction) ?? base.conviction,
    candlePattern: row.candle_pattern ?? base.candlePattern,
    atrState: row.atr_state ?? base.atrState,
    volumeBadge: row.volume_badge ?? base.volumeBadge,
    regimeAtEntry: row.regime_at_entry ?? base.regimeAtEntry,
    closedPrice: safeNum(row.exit_price) ?? base.closedPrice,
    closedDate: row.exit_date ?? base.closedDate,
    pnlPct: safeNum(row.pnl_pct) ?? base.pnlPct,
    tfAlignment: row.tf_alignment ?? base.tfAlignment,
    rsRank: safeNum(row.rs_rank) ?? base.rsRank,
  } as TrackedTrade;
}

// ─── Load ───────────────────────────────────────────────────────────────────

export async function loadTradesFromCloud(): Promise<TrackedTrade[] | null> {
  try {
    const { data, error } = await getClient()
      .from('tracked_trades')
      .select('*')
      .eq('user_id', USER_ID)
      .order('created_at', { ascending: true });
    if (error) return null; // null = error (distinct from [] = intentionally empty)
    return (data ?? []).map(fromRow);
  } catch {
    return null;
  }
}

export function loadTradesFromLocal(): TrackedTrade[] {
  // Take the LONGEST valid array across all 3 keys (best recovery wins)
  let best: TrackedTrade[] = [];
  for (const key of [LS_KEY, LS_BACKUP, LS_EMERGENCY]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const valid = parsed.filter(
          (t: any) => t && t.symbol && t.entryPrice > 0 && t.stopLoss > 0 && t.status && t.entryDate,
        );
        if (valid.length > best.length) best = valid;
      }
    } catch {}
  }
  return best;
}

// ─── Save ───────────────────────────────────────────────────────────────────

function saveToLocal(trades: TrackedTrade[]) {
  const json = JSON.stringify(trades);
  try { localStorage.setItem(LS_KEY, json); } catch {}
  try { localStorage.setItem(LS_BACKUP, json); } catch {}
  // Emergency key updated every 5th write — survives partial corruption
  try {
    const count = parseInt(localStorage.getItem('qtp_backup_count') || '0') + 1;
    localStorage.setItem('qtp_backup_count', String(count));
    if (count % 5 === 0) localStorage.setItem(LS_EMERGENCY, json);
  } catch {}
}

let _syncing = false;

// Upsert all trades to Supabase + mirror to localStorage (fire-and-forget)
export async function syncTradesToCloud(trades: TrackedTrade[]): Promise<void> {
  if (_syncing) return;
  // Guard FIRST — never call saveToLocal([]) on mount before cloud load resolves
  if (trades.length === 0) return;
  _syncing = true;
  try {
    saveToLocal(trades);
    const rows = trades.map(toRow);
    await getClient()
      .from('tracked_trades')
      .upsert(rows, { onConflict: 'user_id,symbol', ignoreDuplicates: false });
  } catch {
  } finally {
    _syncing = false;
  }
}

// Delete one trade from cloud
export async function deleteTradeFromCloud(symbol: string): Promise<void> {
  try {
    await getClient()
      .from('tracked_trades')
      .delete()
      .eq('user_id', USER_ID)
      .eq('symbol', symbol);
  } catch {}
}

// Delete all trades from cloud AND wipe localStorage so next load doesn't re-seed
export async function deleteAllTradesFromCloud(): Promise<void> {
  // Wipe localStorage immediately — prevents stale local data from re-seeding cloud on next load
  const empty = '[]';
  try { localStorage.setItem(LS_KEY, empty); } catch {}
  try { localStorage.setItem(LS_BACKUP, empty); } catch {}
  try { localStorage.setItem(LS_EMERGENCY, empty); } catch {}
  try {
    await getClient()
      .from('tracked_trades')
      .delete()
      .eq('user_id', USER_ID);
  } catch {}
}
