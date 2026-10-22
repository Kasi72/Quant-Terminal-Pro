import type { TrackedTrade } from './tradeOps';
import { isPlausibleTrade } from './tradeCodec';

const LS_KEY = 'qtp_tracked_trades';
const LS_BACKUP = 'qtp_tracked_trades_backup';
const LS_EMERGENCY = 'qtp_tracked_trades_emergency'; // restored: triple-redundancy
const LS_OWNER_TOKEN = 'qtp_owner_token';
// Trades changed locally but not yet confirmed stored by the server. Cleared per trade only when
// the server returns its id as stored, so an unsaved trade can never be lost on reload.
const LS_UNSYNCED = 'qtp_trades_unsynced';
// id -> fingerprint of the version the server last confirmed.
const LS_CONFIRMED = 'qtp_trades_confirmed';

export interface TradeSyncStatus {
  pending: number;
  rejected: { id: string | null; symbol: string | null; reason: string }[];
  error: string | null;
  localSaveFailed: boolean;
}

function getOwnerToken(): string {
  try { return localStorage.getItem(LS_OWNER_TOKEN) ?? ''; } catch { return ''; }
}

export function setOwnerToken(token: string): void {
  try { localStorage.setItem(LS_OWNER_TOKEN, token); } catch {}
}

export function hasOwnerToken(): boolean {
  return getOwnerToken().length > 0;
}

// ─── Identity + change tracking ─────────────────────────────────────────────

function hash32(s: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// Stable id for legacy trades saved before ids existed, so repeated syncs upsert one row.
function deterministicId(t: TrackedTrade): string {
  const k = `${t.symbol}|${t.entryDate ?? ''}|${t.entryPrice ?? ''}`;
  const h = hash32(k, 2166136261) + hash32(k, 374761393) + hash32(k, 668265263) + hash32(k, 2246822519);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function ensureTradeIds(trades: TrackedTrade[]): TrackedTrade[] {
  return trades.some(t => !t.id) ? trades.map(t => (t.id ? t : { ...t, id: deterministicId(t) })) : trades;
}

const fingerprint = (t: TrackedTrade) => hash32(JSON.stringify(t), 2166136261);

function readJson<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}

function writeJson(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

function computePending(trades: TrackedTrade[]): TrackedTrade[] {
  const confirmed = readJson<Record<string, string>>(LS_CONFIRMED, {});
  return trades.filter(t => t.id && confirmed[t.id] !== fingerprint(t));
}

export function getUnsyncedTrades(): TrackedTrade[] {
  const list = readJson<unknown[]>(LS_UNSYNCED, []);
  return Array.isArray(list) ? list.filter(isPlausibleOrRecoverable) : [];
}

function isPlausibleOrRecoverable(t: unknown): t is TrackedTrade {
  const x = t as Partial<TrackedTrade> | null;
  return !!x && typeof x.symbol === 'string' && typeof x.id === 'string' && (x.entryPrice ?? 0) > 0 && !!x.status && !!x.entryDate;
}

// Local unsynced copies are newer than the cloud: replace by id, or append when the cloud lacks them.
export function mergeUnsyncedInto(cloudTrades: TrackedTrade[]): { trades: TrackedTrade[]; recovered: number } {
  const unsynced = getUnsyncedTrades();
  if (unsynced.length === 0) return { trades: cloudTrades, recovered: 0 };
  const byId = new Map(unsynced.map(t => [t.id!, t]));
  const merged = cloudTrades.map(t => (t.id && byId.has(t.id) ? byId.get(t.id)! : t));
  const present = new Set(cloudTrades.map(t => t.id));
  for (const t of unsynced) if (!present.has(t.id)) merged.push(t);
  return { trades: merged, recovered: unsynced.length };
}

// ─── Status events ──────────────────────────────────────────────────────────

type Listener = (s: TradeSyncStatus) => void;
const listeners = new Set<Listener>();
let lastStatus: TradeSyncStatus = { pending: 0, rejected: [], error: null, localSaveFailed: false };

export function subscribeTradeSync(fn: Listener): () => void {
  listeners.add(fn);
  fn(lastStatus);
  return () => { listeners.delete(fn); };
}

function emit(patch: Partial<TradeSyncStatus>) {
  lastStatus = { ...lastStatus, ...patch };
  for (const fn of listeners) fn(lastStatus);
}

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

function saveToLocal(trades: TrackedTrade[]): boolean {
  const json = JSON.stringify(trades);
  let ok = true;
  try { localStorage.setItem(LS_KEY, json); } catch { ok = false; }
  try { localStorage.setItem(LS_BACKUP, json); } catch {}
  // Emergency key updated every 5th write — survives partial corruption
  try {
    const count = parseInt(localStorage.getItem('qtp_backup_count') || '0') + 1;
    localStorage.setItem('qtp_backup_count', String(count));
    if (count % 5 === 0) localStorage.setItem(LS_EMERGENCY, json);
  } catch {}
  return ok;
}

let _syncing = false;
let _pendingTrades: TrackedTrade[] | null = null;
let _activeSync: Promise<void> | null = null;

// Upsert all trades to Supabase + mirror to localStorage. Unconfirmed trades stay in the
// unsynced list until the server reports each id as stored.
export async function syncTradesToCloud(input: TrackedTrade[]): Promise<void> {
  const trades = ensureTradeIds(input);
  const localOk = saveToLocal(trades);
  const pending = computePending(trades);
  const unsyncedOk = writeJson(LS_UNSYNCED, pending);
  emit({ pending: pending.length, localSaveFailed: !localOk || !unsyncedOk });
  _pendingTrades = trades;
  if (_syncing) return _activeSync ?? Promise.resolve();
  _syncing = true;
  _activeSync = (async () => {
    while (_pendingTrades) {
      const batch = _pendingTrades;
      _pendingTrades = null;
      const sentPrints = new Map(batch.map(t => [t.id!, fingerprint(t)]));
      let body: { stored?: string[]; rejected?: TradeSyncStatus['rejected']; error?: string } = {};
      try {
        const res = await fetch('/api/trades', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Owner-Token': getOwnerToken() },
          body: JSON.stringify({ trades: batch }),
        });
        body = await res.json().catch(() => ({}));
        if (!res.ok && !Array.isArray(body.stored)) {
          emit({ error: body.error ?? `Save failed (HTTP ${res.status})`, rejected: body.rejected ?? [] });
          continue;
        }
      } catch (e) {
        emit({ error: e instanceof Error ? e.message : 'Network error while saving trades' });
        continue;
      }
      const confirmed = readJson<Record<string, string>>(LS_CONFIRMED, {});
      for (const id of body.stored ?? []) { const fp = sentPrints.get(id); if (fp) confirmed[id] = fp; }
      for (const id of Object.keys(confirmed)) if (!sentPrints.has(id)) delete confirmed[id];
      writeJson(LS_CONFIRMED, confirmed);
      const latest = _pendingTrades ?? batch;
      const stillPending = latest.filter(t => t.id && confirmed[t.id] !== fingerprint(t));
      writeJson(LS_UNSYNCED, stillPending);
      emit({ pending: stillPending.length, rejected: body.rejected ?? [], error: null });
      if ((body.rejected?.length ?? 0) > 0) console.error('[tradeSync] rejected by server:', body.rejected);
    }
  })();
  try {
    await _activeSync;
  } catch (e) {
    console.error('[tradeSync] syncTradesToCloud error:', e);
  } finally {
    _syncing = false;
    _activeSync = null;
  }
}

function forgetTrade(tradeId?: string) {
  if (!tradeId) return;
  writeJson(LS_UNSYNCED, getUnsyncedTrades().filter(t => t.id !== tradeId));
  const confirmed = readJson<Record<string, string>>(LS_CONFIRMED, {});
  delete confirmed[tradeId];
  writeJson(LS_CONFIRMED, confirmed);
}

async function waitForSyncIdle(): Promise<void> {
  while (_activeSync) await _activeSync;
}

// Delete one trade from cloud by id. Symbol-only deletes would wipe that symbol's whole history.
export async function deleteTradeFromCloud(symbol: string, tradeId?: string): Promise<void> {
  if (!tradeId) {
    console.error('[tradeSync] refusing symbol-wide delete without trade id:', symbol);
    return;
  }
  forgetTrade(tradeId);
  try {
    await waitForSyncIdle();
    const res = await fetch(`/api/trades?id=${encodeURIComponent(tradeId)}`, { method: 'DELETE', headers: { 'X-Owner-Token': getOwnerToken() } });
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
  // Serialize behind any in-flight upsert; otherwise an older PUT can recreate
  // rows after this DELETE has completed.
  await waitForSyncIdle();
  const res = await fetch('/api/trades', { method: 'DELETE', headers: { 'X-Owner-Token': getOwnerToken() } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }));
    throw new Error(body.error ?? res.statusText);
  }

  // Wipe localStorage only after the cloud delete is confirmed. If the network
  // fails, keep the local copy as the user's recoverable source of truth.
  const empty = '[]';
  try { localStorage.setItem(LS_KEY, empty); } catch {}
  try { localStorage.setItem(LS_BACKUP, empty); } catch {}
  try { localStorage.setItem(LS_EMERGENCY, empty); } catch {}
  writeJson(LS_UNSYNCED, []);
  writeJson(LS_CONFIRMED, {});
  emit({ pending: 0, rejected: [], error: null });
}
