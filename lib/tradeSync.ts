import type { TrackedTrade } from './tradeOps';

const LS_KEY = 'qtp_tracked_trades';
const LS_BACKUP = 'qtp_tracked_trades_backup';
const LS_EMERGENCY = 'qtp_tracked_trades_emergency'; // restored: triple-redundancy
const LS_OWNER_TOKEN = 'qtp_owner_token';
// Trades changed locally but not yet confirmed stored by the server. Cleared per trade only when
// the server returns its id as stored, so an unsaved trade can never be lost on reload.
const LS_UNSYNCED = 'qtp_trades_unsynced';
// id -> fingerprint of the version the server last confirmed (or that was loaded from it).
const LS_CONFIRMED = 'qtp_trades_confirmed';
// Trade ids deleted locally whose cloud delete has not been confirmed yet.
const LS_PENDING_DELETES = 'qtp_trades_pending_deletes';
const PUT_CHUNK = 200; // server caps a request at 500 trades / 2 MB

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

const readConfirmed = () => readJson<Record<string, string>>(LS_CONFIRMED, {});
const readPendingDeletes = () => new Set(readJson<string[]>(LS_PENDING_DELETES, []));

function isRecoverable(t: unknown): t is TrackedTrade {
  const x = t as Partial<TrackedTrade> | null;
  return !!x && typeof x.symbol === 'string' && typeof x.id === 'string' && (x.entryPrice ?? 0) > 0 && !!x.status && !!x.entryDate;
}

export function getUnsyncedTrades(): TrackedTrade[] {
  const list = readJson<unknown[]>(LS_UNSYNCED, []);
  return Array.isArray(list) ? list.filter(isRecoverable) : [];
}

// Ids with local changes the server has not confirmed. Local wins for these; cloud wins otherwise.
export function getPendingIds(): Set<string> {
  return new Set(getUnsyncedTrades().map(t => t.id!));
}

// True when this browser previously saw the trade stored in the cloud.
export function wasConfirmed(id?: string): boolean {
  return !!id && id in readConfirmed();
}

// Record cloud versions as the confirmed baseline so unchanged trades are never re-sent.
// Re-sending a stale copy would overwrite newer server-side changes (e.g. the nightly update).
export function markConfirmed(trades: TrackedTrade[]): void {
  const confirmed = readConfirmed();
  for (const t of trades) if (t.id) confirmed[t.id] = fingerprint(t);
  writeJson(LS_CONFIRMED, confirmed);
}

// Local unsynced copies are newer than the cloud: replace by id, or append when the cloud lacks them.
export function mergeUnsyncedInto(cloudTrades: TrackedTrade[]): { trades: TrackedTrade[]; recovered: number } {
  const deleted = readPendingDeletes();
  const unsynced = getUnsyncedTrades().filter(t => !deleted.has(t.id!));
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

function httpError(status: number, fallback?: string): string {
  if (status === 401) return 'Your login session expired. Log in again to save trades';
  if (status === 403) return 'Owner token missing or wrong on this device';
  return fallback ?? `Server error (HTTP ${status})`;
}

// ─── Load ───────────────────────────────────────────────────────────────────

// Lenient on purpose: a stored trade that fails the strict write check must still be shown,
// otherwise it silently disappears from the app while remaining in the database.
export async function loadTradesFromCloud(): Promise<TrackedTrade[] | null> {
  try {
    const res = await fetch('/api/trades', { cache: 'no-store' });
    if (!res.ok) return null; // null = error (distinct from [] = intentionally empty)
    const body = await res.json() as { trades?: unknown[] };
    if (!Array.isArray(body.trades)) return null;
    const deleted = readPendingDeletes();
    return body.trades.filter(isRecoverable).filter(t => !deleted.has(t.id!));
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

// This tab's pending trades, plus unsynced entries another tab recorded for trades this tab
// does not hold (two tabs must not erase each other's unsaved trades).
function writeUnsynced(trades: TrackedTrade[]): { pending: TrackedTrade[]; ok: boolean } {
  const confirmed = readConfirmed();
  const deleted = readPendingDeletes();
  const pending = trades.filter(t => t.id && !deleted.has(t.id) && confirmed[t.id] !== fingerprint(t));
  const mine = new Set(trades.map(t => t.id));
  const others = getUnsyncedTrades().filter(t => !mine.has(t.id) && !deleted.has(t.id!) && confirmed[t.id!] !== fingerprint(t));
  const all = [...pending, ...others];
  return { pending: all, ok: writeJson(LS_UNSYNCED, all) };
}

async function flushPendingDeletes(): Promise<string | null> {
  const ids = [...readPendingDeletes()];
  for (const id of ids) {
    try {
      const res = await fetch(`/api/trades?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-Owner-Token': getOwnerToken() } });
      if (!res.ok) return httpError(res.status, 'A deleted trade could not be removed from the cloud yet');
      const left = readPendingDeletes(); left.delete(id); writeJson(LS_PENDING_DELETES, [...left]);
    } catch {
      return 'Network error while deleting a trade';
    }
  }
  return null;
}

let _syncing = false;
let _pendingTrades: TrackedTrade[] | null = null;
let _activeSync: Promise<void> | null = null;

// Mirror all trades to localStorage, then send only trades whose content changed since the server
// last confirmed them. Unconfirmed trades stay in the unsynced list until stored.
export async function syncTradesToCloud(input: TrackedTrade[]): Promise<void> {
  const trades = ensureTradeIds(input);
  const localOk = saveToLocal(trades);
  const { pending, ok: unsyncedOk } = writeUnsynced(trades);
  emit({ pending: pending.length, localSaveFailed: !localOk || !unsyncedOk });
  _pendingTrades = trades;
  if (_syncing) return _activeSync ?? Promise.resolve();
  _syncing = true;
  _activeSync = (async () => {
    while (_pendingTrades) {
      const latest = _pendingTrades;
      _pendingTrades = null;
      const deleteError = await flushPendingDeletes();
      const { pending: toSend } = writeUnsynced(latest);
      const rejected: TradeSyncStatus['rejected'] = [];
      let error: string | null = deleteError;
      for (let i = 0; i < toSend.length; i += PUT_CHUNK) {
        const chunk = toSend.slice(i, i + PUT_CHUNK);
        const sentPrints = new Map(chunk.map(t => [t.id!, fingerprint(t)]));
        try {
          const res = await fetch('/api/trades', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Owner-Token': getOwnerToken() },
            body: JSON.stringify({ trades: chunk }),
          });
          const body = await res.json().catch(() => ({})) as { stored?: string[]; rejected?: TradeSyncStatus['rejected']; error?: string };
          if (!res.ok && !Array.isArray(body.stored)) { error = httpError(res.status, body.error); break; }
          const confirmed = readConfirmed();
          for (const id of body.stored ?? []) { const fp = sentPrints.get(id); if (fp) confirmed[id] = fp; }
          writeJson(LS_CONFIRMED, confirmed);
          rejected.push(...(body.rejected ?? []));
        } catch {
          error = 'Network error while saving trades';
          break;
        }
      }
      const { pending: stillPending } = writeUnsynced(_pendingTrades ?? latest);
      emit({ pending: stillPending.length, rejected, error });
      if (rejected.length > 0) console.error('[tradeSync] rejected by server:', rejected);
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

async function waitForSyncIdle(): Promise<void> {
  while (_activeSync) await _activeSync;
}

// Delete one trade by id. Queued locally first, so a failed request is retried on the next sync
// and the trade cannot reappear from the cloud in the meantime. Symbol-only deletes are refused:
// they would wipe that symbol's whole trade history.
export async function deleteTradeFromCloud(symbol: string, tradeId?: string): Promise<void> {
  if (!tradeId) {
    console.error('[tradeSync] refusing symbol-wide delete without trade id:', symbol);
    return;
  }
  const deletes = readPendingDeletes(); deletes.add(tradeId); writeJson(LS_PENDING_DELETES, [...deletes]);
  writeJson(LS_UNSYNCED, getUnsyncedTrades().filter(t => t.id !== tradeId));
  const confirmed = readConfirmed(); delete confirmed[tradeId]; writeJson(LS_CONFIRMED, confirmed);
  await waitForSyncIdle();
  const error = await flushPendingDeletes();
  if (error) emit({ error });
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
  writeJson(LS_PENDING_DELETES, []);
  emit({ pending: 0, rejected: [], error: null });
}
