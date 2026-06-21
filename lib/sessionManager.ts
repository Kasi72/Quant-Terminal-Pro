import type { AnalysisResult, StageRating, ParamSetKey } from './stockEngine';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CompactResult {
  sym: string;
  stg: StageRating;
  infl: number;
  conf: number;
  conv: number;
  cls: number;
  dt: string;
  pk: ParamSetKey;
  tv: boolean;
  en: number;
  sl: number;
  t1: number;
  rr: number;
  rk: number;
  ms: number;
  ss: number;
  nb: boolean;
  cd: { d: number; dt: number; h: number; ht: number; e: number; et: number; u: number; ut: number };
}

export interface ScanSession {
  id: string;
  timestamp: number;
  label: string;
  paramSet: ParamSetKey | 'ALL4';
  source: string;
  totalScanned: number;
  actionableCount: number;
  stages: Record<string, number>;
  results: CompactResult[];
}

const MAX_SESSIONS = 20;
const STORAGE_KEY = 'qtp_sessions';

// ─── Compress/Decompress ─────────────────────────────────────────────────────

function compress(r: AnalysisResult): CompactResult {
  try {
    return {
      sym: r.symbol ?? '', stg: r.stage ?? 'NO_SIGNAL', infl: r.inflectionScore ?? 0,
      conf: Math.round(r.confidence ?? 0), conv: 0,
      cls: r.lastClose ?? 0, dt: r.lastDate ?? '', pk: r.paramSetKey ?? 'optimized_deployable_20plus',
      tv: r.priceEngine?.tradeValid ?? false, en: r.priceEngine?.plannedEntry ?? 0,
      sl: r.priceEngine?.tacticalStop ?? 0, t1: r.priceEngine?.target5 ?? 0,
      rr: r.priceEngine?.rewardRisk ?? 0, rk: r.priceEngine?.tacticalRiskPct ?? 0,
      ms: r.momentum?.momentumScore ?? 0, ss: r.stats?.statsScore ?? 0,
      nb: r.nearBreakout ?? false,
      cd: {
        d: r.clusterBreakdown?.deployable?.met ?? 0, dt: r.clusterBreakdown?.deployable?.total ?? 21,
        h: r.clusterBreakdown?.highPrecision?.met ?? 0, ht: r.clusterBreakdown?.highPrecision?.total ?? 19,
        e: r.clusterBreakdown?.elite?.met ?? 0, et: r.clusterBreakdown?.elite?.total ?? 21,
        u: r.clusterBreakdown?.ultraSelective?.met ?? 0, ut: r.clusterBreakdown?.ultraSelective?.total ?? 20,
      },
    };
  } catch {
    return { sym: r.symbol ?? '', stg: 'NO_SIGNAL', infl: 0, conf: 0, conv: 0, cls: 0, dt: '', pk: 'optimized_deployable_20plus', tv: false, en: 0, sl: 0, t1: 0, rr: 0, rk: 0, ms: 0, ss: 0, nb: false, cd: { d: 0, dt: 21, h: 0, ht: 19, e: 0, et: 21, u: 0, ut: 20 } };
  }
}

// ─── Session CRUD ────────────────────────────────────────────────────────────

export function loadSessions(): ScanSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s: ScanSession) => s && typeof s.id === 'string' && typeof s.timestamp === 'number');
  } catch { return []; }
}

function saveSessions(sessions: ScanSession[]) {
  try {
    const json = JSON.stringify(sessions);
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // localStorage full or quota exceeded — progressively prune
    for (let limit = 10; limit >= 1; limit--) {
      try {
        sessions.splice(limit);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
        return;
      } catch { /* keep pruning */ }
    }
    // Last resort: clear sessions entirely
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

export function saveSession(
  results: AnalysisResult[],
  paramSet: ParamSetKey | 'ALL4',
  source: string
): ScanSession {
  const stages: Record<string, number> = {};
  for (const r of results) stages[r.stage] = (stages[r.stage] ?? 0) + 1;

  const session: ScanSession = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: Date.now(),
    label: '',
    paramSet,
    source,
    totalScanned: results.length,
    actionableCount: results.filter(r => ['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage)).length,
    stages,
    results: results.map(compress),
  };

  const sessions = loadSessions();
  sessions.unshift(session);
  if (sessions.length > MAX_SESSIONS) sessions.splice(MAX_SESSIONS);
  saveSessions(sessions);
  return session;
}

export function deleteSession(id: string) {
  const sessions = loadSessions().filter(s => s.id !== id);
  saveSessions(sessions);
}

export function deleteAllSessions() {
  saveSessions([]);
}

export function renameSession(id: string, label: string) {
  const sessions = loadSessions();
  const s = sessions.find(x => x.id === id);
  if (s) { s.label = label; saveSessions(sessions); }
}

export function exportSessions(): string {
  return JSON.stringify(loadSessions(), null, 2);
}

export function importSessions(json: string): number {
  try {
    const imported = JSON.parse(json) as ScanSession[];
    if (!Array.isArray(imported)) return 0;
    const existing = loadSessions();
    const existingIds = new Set(existing.map(s => s.id));
    let added = 0;
    for (const s of imported) {
      if (s && typeof s.id === 'string' && typeof s.timestamp === 'number' && !existingIds.has(s.id)) { existing.unshift(s); added++; }
    }
    if (existing.length > MAX_SESSIONS) existing.splice(MAX_SESSIONS);
    saveSessions(existing);
    return added;
  } catch { return 0; }
}

// ─── Session Comparison ──────────────────────────────────────────────────────

export interface SessionDiff {
  newSignals: string[];
  droppedSignals: string[];
  upgraded: Array<{ sym: string; from: StageRating; to: StageRating }>;
  downgraded: Array<{ sym: string; from: StageRating; to: StageRating }>;
}

export function compareSessions(older: ScanSession, newer: ScanSession): SessionDiff {
  const actionable = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
  const stageRank: Record<string, number> = {
    ULTRA_STRONG_BUY: 7, STRONG_BUY: 6, BUY: 5, PRE_BREAKOUT: 4,
    EARLY_INFLECTION: 3, COMPRESSION_WATCH: 2, NO_SIGNAL: 1,
  };

  const oldMap = new Map(older.results.map(r => [r.sym, r.stg]));
  const newMap = new Map(newer.results.map(r => [r.sym, r.stg]));

  const newSignals: string[] = [];
  const droppedSignals: string[] = [];
  const upgraded: SessionDiff['upgraded'] = [];
  const downgraded: SessionDiff['downgraded'] = [];

  for (const [sym, stg] of newMap) {
    const old = oldMap.get(sym);
    if (!old && actionable.has(stg)) newSignals.push(sym);
    else if (old && stg !== old) {
      if (stageRank[stg] > stageRank[old]) upgraded.push({ sym, from: old as StageRating, to: stg });
      else downgraded.push({ sym, from: old as StageRating, to: stg });
    }
  }

  for (const [sym, stg] of oldMap) {
    if (actionable.has(stg) && !newMap.has(sym)) droppedSignals.push(sym);
  }

  return { newSignals, droppedSignals, upgraded, downgraded };
}

// ─── Format Helpers ──────────────────────────────────────────────────────────

export function formatSessionTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
