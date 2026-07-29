import type { TrackedTrade } from './tradeOps';

export const TRADE_USER_ID = 'drkkr';

export type TrackedTradeRow = Record<string, unknown>;

export function safeNum(v: unknown, fallback?: number): number | undefined {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

const TRADE_STATUSES = new Set([
  'open', 'hit_t1', 'hit_t2', 'hit_t3', 'stopped', 'expired', 'manual_close', 'closed_early',
]);

const PARAM_SET_KEYS = new Set([
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  'ors_prime_reversal',
  'circuit_breaker_v2',
]);

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function finiteNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function optionalFiniteNumber(value: unknown, min: number, max: number): boolean {
  return value == null || finiteNumber(value, min, max);
}

export function isPlausibleTrade(value: unknown): value is TrackedTrade {
  if (!value || typeof value !== 'object') return false;
  const t = value as Partial<TrackedTrade>;
  if (typeof t.symbol !== 'string' || !/^[A-Z0-9._&-]{1,30}$/.test(t.symbol)) return false;
  if (!isDateOnly(t.entryDate)) return false;
  if (t.closedDate != null && t.closedDate !== '' && !isDateOnly(String(t.closedDate).slice(0, 10))) return false;
  if (!finiteNumber(t.entryPrice, 0.01, 10_000_000)) return false;
  if (!finiteNumber(t.stopLoss, 0, 10_000_000)) return false;
  if (t.stopLoss > 0 && t.stopLoss >= t.entryPrice) return false;
  if (!TRADE_STATUSES.has(String(t.status))) return false;
  if (t.paramSetKey != null && t.paramSetKey !== '' && !PARAM_SET_KEYS.has(String(t.paramSetKey))) return false;

  const target1 = safeNum(t.target1, 0) ?? 0;
  const target2 = safeNum(t.target2, 0) ?? 0;
  const target3 = safeNum(t.target3, 0) ?? 0;
  if (![target1, target2, target3].every(v => Number.isFinite(v) && v >= 0 && v <= 20_000_000)) return false;
  if (target1 > 0 && target1 <= t.entryPrice) return false;
  if (target2 > 0 && target1 > 0 && target2 < target1) return false;
  if (target3 > 0 && target2 > 0 && target3 < target2) return false;

  const disasterStop = safeNum(t.disasterStop, 0) ?? 0;
  if (!Number.isFinite(disasterStop) || disasterStop < 0 || disasterStop > 10_000_000) return false;
  if (disasterStop > 0 && disasterStop >= t.entryPrice) return false;

  return optionalFiniteNumber(t.currentPrice, 0, 20_000_000)
    && optionalFiniteNumber(t.highestPrice, 0, 20_000_000)
    && optionalFiniteNumber(t.closedPrice, 0, 20_000_000)
    && optionalFiniteNumber(t.pnlPct, -100, 10_000)
    && optionalFiniteNumber(t.pnlR, -100, 10_000)
    && optionalFiniteNumber(t.mfe, -100, 10_000)
    && optionalFiniteNumber(t.mae, -100, 10_000)
    && optionalFiniteNumber(t.mfeR, -100, 10_000)
    && optionalFiniteNumber(t.maeR, -100, 10_000)
    && optionalFiniteNumber(t.qty, 0, 100_000_000)
    && optionalFiniteNumber(t.daysHeld, 0, 10_000)
    && optionalFiniteNumber(t.conviction, 0, 100);
}

export function tradeToRow(t: TrackedTrade): TrackedTradeRow {
  return {
    user_id: TRADE_USER_ID,
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
    exit_price: t.closedPrice ?? null,
    exit_date: t.closedDate ?? null,
    pnl_pct: t.pnlPct ?? null,
    outcome: null,
    notes: t.notes ?? null,
    tf_alignment: t.tfAlignment ?? null,
    rs_rank: safeNum(t.rsRank) ?? null,
    sw5_low_at_entry: safeNum(t.sw5LowAtEntry) ?? null,
    atr14_at_entry: safeNum(t.atr14AtEntry) ?? null,
    raw_json: t,
    updated_at: new Date().toISOString(),
  };
}

export function rowToTrade(row: TrackedTradeRow): TrackedTrade {
  // Spread raw_json as base, then overlay authoritative DB columns. Legacy
  // raw_json can contain stale terminal fields, so normalized columns win.
  const base = ((row.raw_json ?? {}) as Partial<TrackedTrade>) || {};
  return {
    ...base,
    symbol: safeString(row.symbol, base.symbol),
    status: safeString(row.status, base.status) as TrackedTrade['status'],
    stage: safeString(row.stage, base.stage) as TrackedTrade['stage'],
    entryPrice: safeNum(row.entry_price) ?? base.entryPrice ?? 0,
    stopLoss: safeNum(row.stop_loss) ?? base.stopLoss ?? 0,
    target1: safeNum(row.target1) ?? base.target1 ?? 0,
    target2: safeNum(row.target2) ?? base.target2 ?? 0,
    target3: safeNum(row.target3) ?? base.target3 ?? 0,
    disasterStop: safeNum(row.disaster_stop) ?? base.disasterStop ?? 0,
    entryDate: safeString(row.entry_date, base.entryDate),
    paramSetKey: safeString(row.param_set_key, base.paramSetKey),
    sector: safeString(row.sector, base.sector),
    conviction: safeNum(row.conviction) ?? base.conviction ?? 0,
    candlePattern: safeString(row.candle_pattern, base.candlePattern),
    atrState: safeString(row.atr_state, base.atrState),
    volumeBadge: safeString(row.volume_badge, base.volumeBadge),
    regimeAtEntry: safeString(row.regime_at_entry, base.regimeAtEntry),
    closedPrice: safeNum(row.exit_price),
    closedDate: typeof row.exit_date === 'string' && row.exit_date.trim()
      ? row.exit_date.slice(0, 10)
      : undefined,
    pnlPct: safeNum(row.pnl_pct) ?? base.pnlPct,
    tfAlignment: safeString(row.tf_alignment, base.tfAlignment),
    rsRank: safeNum(row.rs_rank) ?? base.rsRank,
    sw5LowAtEntry: safeNum(row.sw5_low_at_entry) ?? base.sw5LowAtEntry,
    atr14AtEntry: safeNum(row.atr14_at_entry) ?? base.atr14AtEntry,
  } as TrackedTrade;
}
