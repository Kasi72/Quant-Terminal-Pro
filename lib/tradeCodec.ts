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

export function isPlausibleTrade(value: unknown): value is TrackedTrade {
  if (!value || typeof value !== 'object') return false;
  const t = value as Partial<TrackedTrade>;
  return typeof t.symbol === 'string'
    && /^[A-Z0-9._&-]{1,30}$/.test(t.symbol)
    && typeof t.entryDate === 'string'
    && safeNum(t.entryPrice, 0)! > 0
    && safeNum(t.stopLoss, 0)! >= 0
    && typeof t.status === 'string';
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
