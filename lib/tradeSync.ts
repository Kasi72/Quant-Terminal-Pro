import { getClient } from './supabase';
import type { TrackedTrade } from './tradingUtils';

const USER_ID = 'drkkr';
const LS_KEY = 'qtp_tracked_trades';
const LS_BACKUP = 'qtp_tracked_trades_backup';

// ─── Supabase helpers ───────────────────────────────────────────────────────

function toRow(t: TrackedTrade) {
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
    exit_price: (t as any).exitPrice,
    exit_date: (t as any).exitDate,
    pnl_pct: (t as any).pnlPct,
    outcome: (t as any).outcome,
    notes: (t as any).notes,
    raw_json: t,
    updated_at: new Date().toISOString(),
  };
}

function fromRow(row: any): TrackedTrade {
  // raw_json is the full object — merge any DB-side fields on top
  return {
    ...row.raw_json,
    symbol: row.symbol,
    status: row.status,
    entryPrice: Number(row.entry_price),
    stopLoss: Number(row.stop_loss),
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
    if (error) return null;
    return (data ?? []).map(fromRow);
  } catch {
    return null;
  }
}

export function loadTradesFromLocal(): TrackedTrade[] {
  for (const key of [LS_KEY, LS_BACKUP]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const valid = parsed.filter(
          (t: any) => t && typeof t.entryPrice === 'number' && typeof t.stopLoss === 'number',
        );
        if (valid.length > 0) return valid;
      }
    } catch {}
  }
  return [];
}

// ─── Save ───────────────────────────────────────────────────────────────────

function saveToLocal(trades: TrackedTrade[]) {
  const json = JSON.stringify(trades);
  try { localStorage.setItem(LS_KEY, json); } catch {}
  try { localStorage.setItem(LS_BACKUP, json); } catch {}
}

// Upsert all trades to Supabase (fire-and-forget — never blocks UI)
export async function syncTradesToCloud(trades: TrackedTrade[]): Promise<void> {
  saveToLocal(trades);
  if (trades.length === 0) return;
  try {
    const rows = trades.map(toRow);
    await getClient()
      .from('tracked_trades')
      .upsert(rows, { onConflict: 'user_id,symbol', ignoreDuplicates: false });
  } catch {}
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

// Delete all trades from cloud
export async function deleteAllTradesFromCloud(): Promise<void> {
  try {
    await getClient()
      .from('tracked_trades')
      .delete()
      .eq('user_id', USER_ID);
  } catch {}
}
