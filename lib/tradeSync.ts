import type { TrackedTrade } from './tradeOps';
import { isPlausibleTrade } from './tradeCodec';

const LS_KEY = 'qtp_tracked_trades';
const LS_BACKUP = 'qtp_tracked_trades_backup';
const LS_EMERGENCY = 'qtp_tracked_trades_emergency'; // restored: triple-redundancy

// ─── Load ───────────────────────────────────────────────────────────────────

export async function loadTradesFromCloud(): Promise<TrackedTrade[] | null> {
  try {
    const res = await fetch('/api/trades', { cache: 'no-store' });
    if (!res.ok) return null; // null = error (distinct from [] = intentionally empty)
    const body = await res.json() as { trades?: unknown[] };
    return Array.isArray(body.trades)
      ? body.trades.filter(isPlausibleTrade)
      : null;
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
          (t: any) => t && t.symbol && t.entryPrice > 0 && t.status && t.entryDate,
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
let _pendingTrades: TrackedTrade[] | null = null;

// Upsert all trades to Supabase + mirror to localStorage (fire-and-forget)
export async function syncTradesToCloud(trades: TrackedTrade[]): Promise<void> {
  saveToLocal(trades);
  _pendingTrades = trades;
  if (_syncing) return;
  _syncing = true;
  try {
    while (_pendingTrades) {
      const batch = _pendingTrades;
      _pendingTrades = null;
      const res = await fetch('/api/trades', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades: batch }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        console.error('[tradeSync] upsert failed:', body.error ?? res.statusText);
      }
    }
  } catch (e) {
    console.error('[tradeSync] syncTradesToCloud error:', e);
  } finally {
    _syncing = false;
  }
}

// Delete one trade from cloud
export async function deleteTradeFromCloud(symbol: string): Promise<void> {
  try {
    const res = await fetch(`/api/trades?symbol=${encodeURIComponent(symbol)}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as { error?: string }));
      console.error('[tradeSync] delete failed:', symbol, body.error ?? res.statusText);
    }
  } catch (e) {
    console.error('[tradeSync] deleteTradeFromCloud error:', symbol, e);
  }
}

// Delete all trades from cloud AND wipe localStorage so next load doesn't re-seed
export async function deleteAllTradesFromCloud(): Promise<void> {
  // Wipe localStorage immediately — prevents stale local data from re-seeding cloud on next load
  const empty = '[]';
  try { localStorage.setItem(LS_KEY, empty); } catch {}
  try { localStorage.setItem(LS_BACKUP, empty); } catch {}
  try { localStorage.setItem(LS_EMERGENCY, empty); } catch {}
  try {
    const res = await fetch('/api/trades', { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as { error?: string }));
      console.error('[tradeSync] delete all failed:', body.error ?? res.statusText);
    }
  } catch {}
}
