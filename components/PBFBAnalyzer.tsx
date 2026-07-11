'use client';
import { useState, useRef } from 'react';
import { fetchOHLCVClient } from '@/lib/fetchClient';
import { analyzeStock, PARAM_SETS, type StageRating, type ParamSetKey } from '@/lib/stockEngine';
import type { Candle } from '@/lib/compute';

// ─── Constants ────────────────────────────────────────────────────────────────

const PARAM_SET_KEYS: ParamSetKey[] = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  'ors_prime_reversal',
];

const PARAM_SET_LABELS: Record<string, string> = {
  optimized_deployable_20plus:    'Deployable',
  optimized_highprecision_15plus: 'HiPrec',
  optimized_elite_10plus:         'Elite',
  optimized_ultraselective_8plus: 'Ultra',
  sniper_95plus:                  'Sniper',
  ors_prime_reversal:             'ORS↩Prime',
};

const STAGE_RANK: Record<StageRating, number> = {
  ULTRA_STRONG_BUY: 7, STRONG_BUY: 6, BUY: 5,
  PRE_BREAKOUT: 4, EARLY_INFLECTION: 3, COMPRESSION_WATCH: 2, NO_SIGNAL: 1,
};

const ACTIONABLE = new Set<StageRating>(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
const ON_RADAR   = new Set<StageRating>(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY', 'PRE_BREAKOUT', 'EARLY_INFLECTION', 'COMPRESSION_WATCH']);

// ─── Types ────────────────────────────────────────────────────────────────────

interface BreakoutEvent {
  symbol:    string;
  eventIdx:  number;  // index in candles array
  date:      string;
  movePct:   number;  // close-to-close %
  volMult:   number;  // vs 20-day avg
  candles:   Candle[];
}

interface ForensicResult {
  symbol:      string;
  date:        string;
  movePct:     number;
  volMult:     number;
  nBefore:     number;
  // per-param-set results
  stages:      Partial<Record<ParamSetKey, StageRating>>;
  bestStage:   StageRating;
  bestParamSet: ParamSetKey | null;
  anyZone:     boolean;
  classification: 'actionable' | 'on_radar' | 'missed';
}

// ─── Stage colour helpers ─────────────────────────────────────────────────────

function stageColor(s: StageRating): string {
  if (s === 'ULTRA_STRONG_BUY') return '#4ade80';
  if (s === 'STRONG_BUY')       return '#34d399';
  if (s === 'BUY')               return '#22d3ee';
  if (s === 'PRE_BREAKOUT')      return '#818cf8';
  if (s === 'EARLY_INFLECTION')  return '#fbbf24';
  if (s === 'COMPRESSION_WATCH') return '#fb923c';
  return '#475569';
}

function stageBg(s: StageRating): string {
  if (s === 'ULTRA_STRONG_BUY') return '#14532d40';
  if (s === 'STRONG_BUY')       return '#064e3b40';
  if (s === 'BUY')               return '#0e4f6440';
  if (s === 'PRE_BREAKOUT')      return '#1e1b4b40';
  if (s === 'EARLY_INFLECTION')  return '#713f1240';
  if (s === 'COMPRESSION_WATCH') return '#7c2d1240';
  return '#0f172a40';
}

function stageLabel(s: StageRating): string {
  if (s === 'ULTRA_STRONG_BUY') return 'ULTRA BUY';
  if (s === 'STRONG_BUY')       return 'STRONG BUY';
  if (s === 'BUY')               return 'BUY';
  if (s === 'PRE_BREAKOUT')      return 'PRE-BREAKOUT';
  if (s === 'EARLY_INFLECTION')  return 'EARLY INFL';
  if (s === 'COMPRESSION_WATCH') return 'COMPRESSION';
  return 'MISSED';
}

function classColor(c: 'actionable' | 'on_radar' | 'missed'): string {
  return c === 'actionable' ? '#4ade80' : c === 'on_radar' ? '#fbbf24' : '#f87171';
}

function pct(n: number, d: number) { return d > 0 ? ((n / d) * 100).toFixed(1) : '0.0'; }

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PBFBAnalyzer() {
  const [symbolText, setSymbolText]     = useState('');
  const [maxNBefore, setMaxNBefore]     = useState(3);
  const [minMovePct, setMinMovePct]     = useState(7);
  const [minVolMult, setMinVolMult]     = useState(3);
  const [loading, setLoading]           = useState(false);
  const [progress, setProgress]         = useState({ done: 0, total: 0, phase: '' });
  const [events, setEvents]             = useState<BreakoutEvent[]>([]);
  const [results, setResults]           = useState<ForensicResult[]>([]);
  const [error, setError]               = useState('');
  const [activeN, setActiveN]           = useState(1);
  const [sortKey, setSortKey]           = useState<'movePct' | 'volMult' | 'bestStage' | 'symbol'>('movePct');
  const [sortDir, setSortDir]           = useState<'asc' | 'desc'>('desc');
  const [filterClass, setFilterClass]   = useState<'all' | 'actionable' | 'on_radar' | 'missed'>('all');
  const [expanded, setExpanded]         = useState<string | null>(null);
  const csvRef  = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  // ── Parse symbols ───────────────────────────────────────────────────────────
  function parseSymbols(text: string): string[] {
    return text.split(/[\n,;|\t]+/)
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length > 0 && s.length <= 20)
      .map(s => s.includes('.') ? s : s + '.NS');
  }

  // ── CSV upload ──────────────────────────────────────────────────────────────
  function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const lines = text.split('\n');
      const header = lines[0]?.split(',').map(h => h.trim().toLowerCase()) ?? [];
      const symIdx = header.findIndex(h => h === 'symbol' || h === 'sym' || h === 'ticker' || h === 'stock');
      let syms: string[];
      if (symIdx >= 0) syms = lines.slice(1).map(l => l.split(',')[symIdx]?.trim().toUpperCase()).filter(Boolean) as string[];
      else             syms = lines.map(l => l.split(',')[0]?.trim().toUpperCase()).filter(Boolean).slice(1) as string[];
      setSymbolText(syms.map(s => s.includes('.') ? s : s + '.NS').join('\n'));
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ── Detect breakout events in a candle array ────────────────────────────────
  function detectEvents(candles: Candle[], symbol: string): BreakoutEvent[] {
    const evts: BreakoutEvent[] = [];
    for (let i = 60; i < candles.length - 1; i++) {
      const prev = candles[i - 1], cur = candles[i];
      if (prev.c <= 0) continue;
      const movePct = ((cur.c - prev.c) / prev.c) * 100;
      if (movePct < minMovePct || movePct > 80) continue;  // >80% = corporate action

      let v20 = 0, n = 0;
      for (let j = Math.max(0, i - 20); j < i; j++) { v20 += candles[j].v; n++; }
      v20 = n > 0 ? v20 / n : 0;
      if (v20 <= 0 || cur.v < v20 * minVolMult) continue;

      // Format date
      let date = `row-${i}`;
      if (cur.ts) {
        const d = new Date(cur.ts * 1000);
        date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
      }

      evts.push({ symbol, eventIdx: i, date, movePct, volMult: cur.v / v20, candles });
      i += 10;  // skip ahead to avoid counting the same multi-day run multiple times
    }
    return evts;
  }

  // ── Main run ────────────────────────────────────────────────────────────────
  async function runForensic() {
    const symbols = parseSymbols(symbolText);
    if (symbols.length === 0) { setError('No symbols entered.'); return; }
    if (symbols.length > 150) { setError('Maximum 150 symbols.'); return; }
    setError('');
    setLoading(true);
    setEvents([]);
    setResults([]);
    abortRef.current = false;

    // Phase 1: fetch OHLCV + detect breakout events
    setProgress({ done: 0, total: symbols.length, phase: 'Finding monster-move events' });
    const allEvents: BreakoutEvent[] = [];
    for (let si = 0; si < symbols.length; si++) {
      if (abortRef.current) break;
      const sym = symbols[si];
      try {
        const { candles } = await fetchOHLCVClient(sym);
        if (candles && candles.length >= 100) {
          const evts = detectEvents(candles, sym);
          allEvents.push(...evts);
        }
      } catch { /* skip */ }
      setProgress(p => ({ ...p, done: p.done + 1 }));
    }
    setEvents(allEvents);

    if (allEvents.length === 0) {
      setError(`No monster-move events found (≥${minMovePct}% + ≥${minVolMult}× vol) in the selected stocks.`);
      setLoading(false);
      return;
    }

    // Phase 2: replay screener for each event × each N-before
    const Ns = Array.from({ length: maxNBefore }, (_, i) => i + 1);
    const totalWork = allEvents.length * Ns.length * PARAM_SET_KEYS.length;
    setProgress({ done: 0, total: totalWork, phase: 'Replaying screener' });

    const allResults: ForensicResult[] = [];
    let workDone = 0;

    for (const ev of allEvents) {
      if (abortRef.current) break;
      for (const nb of Ns) {
        const cutIdx = ev.eventIdx - nb;
        if (cutIdx < 60) { workDone += PARAM_SET_KEYS.length; continue; }
        const truncated = ev.candles.slice(0, cutIdx + 1);

        const stages: Partial<Record<ParamSetKey, StageRating>> = {};
        let bestStage: StageRating = 'NO_SIGNAL';
        let bestParamSet: ParamSetKey | null = null;
        let anyZone = false;

        for (const key of PARAM_SET_KEYS) {
          try {
            const r = analyzeStock(truncated, key);
            stages[key] = r.stage;
            if (r.zone) anyZone = true;
            if (STAGE_RANK[r.stage] > STAGE_RANK[bestStage]) {
              bestStage = r.stage;
              bestParamSet = key;
            }
          } catch { stages[key] = 'NO_SIGNAL'; }
          workDone++;
          if (workDone % 50 === 0) setProgress(p => ({ ...p, done: workDone }));
        }

        const classification: ForensicResult['classification'] =
          ACTIONABLE.has(bestStage) ? 'actionable' :
          ON_RADAR.has(bestStage)   ? 'on_radar'   : 'missed';

        allResults.push({
          symbol:      ev.symbol,
          date:        ev.date,
          movePct:     ev.movePct,
          volMult:     ev.volMult,
          nBefore:     nb,
          stages,
          bestStage,
          bestParamSet,
          anyZone,
          classification,
        });
      }
    }

    setProgress(p => ({ ...p, done: totalWork }));
    setResults(allResults);
    setActiveN(1);
    setLoading(false);
  }

  // ── Sort + filter ───────────────────────────────────────────────────────────
  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const nResults = results.filter(r => r.nBefore === activeN);
  const displayed = nResults
    .filter(r => filterClass === 'all' || r.classification === filterClass)
    .sort((a, b) => {
      let av: number | string, bv: number | string;
      if (sortKey === 'movePct')   { av = a.movePct; bv = b.movePct; }
      else if (sortKey === 'volMult')  { av = a.volMult; bv = b.volMult; }
      else if (sortKey === 'bestStage'){ av = STAGE_RANK[a.bestStage]; bv = STAGE_RANK[b.bestStage]; }
      else { av = a.symbol; bv = b.symbol; }
      if (typeof av === 'number' && typeof bv === 'number')
        return sortDir === 'desc' ? bv - av : av - bv;
      return sortDir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
    });

  // ── Summary stats per N ─────────────────────────────────────────────────────
  function summaryFor(nb: number) {
    const rs = results.filter(r => r.nBefore === nb);
    const actionable = rs.filter(r => r.classification === 'actionable').length;
    const onRadar    = rs.filter(r => r.classification === 'on_radar').length;
    const missed     = rs.filter(r => r.classification === 'missed').length;
    const total      = rs.length;
    return { total, actionable, onRadar, missed };
  }

  // ── Best param set analysis ─────────────────────────────────────────────────
  function bestParamStats(nb: number) {
    const rs = results.filter(r => r.nBefore === nb);
    const counts: Partial<Record<ParamSetKey, number>> = {};
    for (const r of rs) {
      if (r.bestParamSet && ACTIONABLE.has(r.bestStage)) {
        counts[r.bestParamSet] = (counts[r.bestParamSet] ?? 0) + 1;
      }
    }
    return PARAM_SET_KEYS.map(k => ({ key: k, label: PARAM_SET_LABELS[k], count: counts[k] ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }

  // ── Move size breakdown ─────────────────────────────────────────────────────
  function moveBreakdown(nb: number) {
    const rs = results.filter(r => r.nBefore === nb);
    const buckets: [number, number, string][] = [[7, 10, '7-10%'], [10, 15, '10-15%'], [15, 25, '15-25%'], [25, 999, '>25%']];
    return buckets.map(([lo, hi, label]) => {
      const b = rs.filter(r => r.movePct >= lo && r.movePct < hi);
      const act = b.filter(r => ACTIONABLE.has(r.bestStage)).length;
      const onR = b.filter(r => ON_RADAR.has(r.bestStage)).length;
      return { label, total: b.length, actionable: act, onRadar: onR };
    }).filter(b => b.total > 0);
  }

  const symCount = parseSymbols(symbolText).length;
  const Ns = Array.from({ length: maxNBefore }, (_, i) => i + 1);
  const summary = summaryFor(activeN);
  const hasResults = results.length > 0;

  const Th = ({ k, label }: { k: typeof sortKey; label: string }) => (
    <th onClick={() => toggleSort(k)}
      className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-200 select-none whitespace-nowrap">
      {label}{sortKey === k ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
    </th>
  );

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            🔬 Post Breakout Forensic Backtest (PBFB)
          </h2>
          <p className="text-[10px] text-slate-600 mt-0.5">
            "Would my screener have seen this monster move coming?" — truncates each stock's history N candles before the event and runs all 5 param sets
          </p>
        </div>
        {hasResults && (
          <div className="text-[10px] text-slate-500">
            {events.length} events · {new Set(events.map(e => e.symbol)).size} stocks · {results.length / (maxNBefore || 1)} avg/event
          </div>
        )}
      </div>

      {/* ── Input panel ── */}
      <div className="bg-slate-800/40 rounded-lg p-3 space-y-3">
        <div className="grid grid-cols-3 gap-3">

          {/* Symbols */}
          <div className="col-span-1 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">Stocks</div>
              <div className="flex gap-1">
                <button onClick={() => csvRef.current?.click()}
                  className="px-2 py-0.5 bg-slate-700/60 hover:bg-slate-700 border border-slate-600 rounded text-[10px] text-slate-300 transition-colors">
                  CSV
                </button>
                <button onClick={() => setSymbolText('')}
                  className="px-2 py-0.5 bg-slate-700/60 hover:bg-slate-700 border border-slate-600 rounded text-[10px] text-slate-400 transition-colors">
                  Clear
                </button>
              </div>
            </div>
            <textarea
              value={symbolText}
              onChange={e => setSymbolText(e.target.value)}
              placeholder={'Paste symbols...\nRELIANCE.NS\nTCS.NS\nINFY.NS\n\nComma or newline separated'}
              rows={7}
              className="w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-[11px] text-slate-200 font-mono resize-none focus:outline-none focus:border-slate-500"
            />
            <input ref={csvRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCSV} />
            <div className="text-[9px] text-slate-600">{symCount} symbol{symCount !== 1 ? 's' : ''} · .NS added automatically</div>
          </div>

          {/* Parameters */}
          <div className="col-span-2 grid grid-cols-2 gap-3">

            {/* Candles before */}
            <div className="bg-slate-900/40 rounded p-2.5 space-y-2">
              <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">Candles Before Breakout</div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-600">1</span>
                <input type="range" min={1} max={10} value={maxNBefore} step={1}
                  onChange={e => setMaxNBefore(Number(e.target.value))}
                  className="flex-1 h-1.5 rounded cursor-pointer" />
                <span className="text-[10px] text-slate-600">10</span>
              </div>
              <div className="text-center">
                <span className="text-2xl font-bold font-mono text-cyan-400">{maxNBefore}</span>
                <span className="text-[10px] text-slate-500 ml-1">candle{maxNBefore > 1 ? 's' : ''}</span>
              </div>
              <div className="flex flex-wrap gap-1 justify-center">
                {[1, 2, 3, 5, 7, 10].map(n => (
                  <button key={n} onClick={() => setMaxNBefore(n)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${maxNBefore === n ? 'bg-cyan-800/50 border-cyan-600 text-cyan-300' : 'bg-slate-700/40 border-slate-600 text-slate-500 hover:text-slate-300'}`}>
                    {n}
                  </button>
                ))}
              </div>
              <div className="text-[9px] text-slate-600 text-center">
                Tests each N from 1 to {maxNBefore} simultaneously
              </div>
            </div>

            {/* Event criteria */}
            <div className="bg-slate-900/40 rounded p-2.5 space-y-2">
              <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">Monster-Move Criteria</div>
              <div className="space-y-2">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-slate-400">Min move %</span>
                    <span className="text-[11px] font-mono font-bold text-emerald-400">≥{minMovePct}%</span>
                  </div>
                  <input type="range" min={5} max={20} value={minMovePct} step={1}
                    onChange={e => setMinMovePct(Number(e.target.value))}
                    className="w-full h-1.5 rounded cursor-pointer" />
                  <div className="flex justify-between text-[9px] text-slate-600 mt-0.5"><span>5%</span><span>20%</span></div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-slate-400">Min volume ×</span>
                    <span className="text-[11px] font-mono font-bold text-emerald-400">≥{minVolMult}×</span>
                  </div>
                  <input type="range" min={1.5} max={6} value={minVolMult} step={0.5}
                    onChange={e => setMinVolMult(Number(e.target.value))}
                    className="w-full h-1.5 rounded cursor-pointer" />
                  <div className="flex justify-between text-[9px] text-slate-600 mt-0.5"><span>1.5×</span><span>6×</span></div>
                </div>
              </div>
              <div className="text-[9px] text-slate-600 border-t border-slate-700/50 pt-1.5">
                Close-to-close gain + volume vs 20-day avg.<br/>
                &gt;80% moves skipped (corporate actions).
              </div>
            </div>

            {/* What this does */}
            <div className="col-span-2 bg-slate-900/30 rounded p-2 border border-slate-700/30">
              <div className="text-[9px] text-slate-500 leading-relaxed">
                <span className="text-slate-400 font-semibold">How it works:</span>{' '}
                For each stock, finds every genuine monster-move day (≥{minMovePct}% on ≥{minVolMult}× volume).
                Then rewinds the clock — for each N from 1 to {maxNBefore} — takes the candle history ending N days
                BEFORE the breakout, and runs all 5 param sets to see if the stock was already on the radar.
                Result: the percentage of monster moves that your screener would have caught beforehand.
              </div>
            </div>
          </div>
        </div>

        {/* Run button */}
        <div className="flex items-center gap-2">
          <button onClick={runForensic} disabled={loading || symCount === 0}
            className="px-5 py-1.5 bg-indigo-700/60 hover:bg-indigo-700/80 disabled:opacity-40 disabled:cursor-not-allowed border border-indigo-500 rounded text-[11px] text-indigo-100 font-semibold transition-colors">
            {loading ? `${progress.phase}… ${progress.done}/${progress.total}` : `▶ Run Forensic on ${symCount} Stock${symCount !== 1 ? 's' : ''}`}
          </button>
          {loading && (
            <button onClick={() => { abortRef.current = true; setLoading(false); }}
              className="px-3 py-1.5 bg-red-900/40 hover:bg-red-900/60 border border-red-700 rounded text-[11px] text-red-300 transition-colors">
              ✕ Stop
            </button>
          )}
          {hasResults && !loading && (
            <button onClick={() => { setResults([]); setEvents([]); setError(''); }}
              className="px-3 py-1.5 bg-slate-700/40 hover:bg-slate-700 border border-slate-600 rounded text-[11px] text-slate-400 transition-colors">
              Clear
            </button>
          )}
          {error && <span className="text-[11px] text-red-400">{error}</span>}
        </div>

        {/* Progress bar */}
        {loading && progress.total > 0 && (
          <div className="space-y-1">
            <div className="w-full bg-slate-700/40 rounded-full h-1.5">
              <div className="bg-indigo-500 h-1.5 rounded-full transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <div className="text-[9px] text-slate-600">{progress.phase} · {progress.done}/{progress.total}</div>
          </div>
        )}
      </div>

      {/* ── Results ── */}
      {hasResults && (
        <>
          {/* N-selector tabs */}
          <div className="flex items-center gap-1 bg-slate-800/30 rounded-lg p-1">
            <div className="text-[10px] text-slate-600 px-2 font-semibold uppercase tracking-wider mr-1">N before:</div>
            {Ns.map(nb => {
              const s = summaryFor(nb);
              const hitRate = s.total > 0 ? ((s.actionable + s.onRadar) / s.total * 100).toFixed(0) : '0';
              const actRate = s.total > 0 ? (s.actionable / s.total * 100).toFixed(0) : '0';
              return (
                <button key={nb} onClick={() => setActiveN(nb)}
                  className={`flex-1 py-1.5 px-2 rounded text-center transition-colors ${activeN === nb ? 'bg-indigo-800/60 border border-indigo-600' : 'hover:bg-slate-700/40 border border-transparent'}`}>
                  <div className="text-[11px] font-bold text-slate-200 font-mono">{nb}d before</div>
                  <div className="text-[9px] mt-0.5">
                    <span className="text-emerald-400">{actRate}% act</span>
                    <span className="text-slate-600"> · </span>
                    <span className="text-slate-400">{hitRate}% radar</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Actionable (BUY+)', val: summary.actionable, sub: `${pct(summary.actionable, summary.total)}% of events`, color: '#4ade80' },
              { label: 'On Radar (any stage)', val: summary.actionable + summary.onRadar, sub: `${pct(summary.actionable + summary.onRadar, summary.total)}% of events`, color: '#818cf8' },
              { label: 'Missed entirely', val: summary.missed, sub: `${pct(summary.missed, summary.total)}% of events`, color: '#f87171' },
              { label: 'Total events found', val: summary.total, sub: `≥${minMovePct}% + ≥${minVolMult}× vol`, color: '#94a3b8' },
            ].map((card, i) => (
              <div key={i} className="bg-slate-800/60 rounded-lg p-2.5 text-center">
                <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1">{card.label}</div>
                <div className="text-2xl font-bold font-mono" style={{ color: card.color }}>{card.val}</div>
                <div className="text-[9px] text-slate-600 mt-0.5">{card.sub}</div>
              </div>
            ))}
          </div>

          {/* Move-size breakdown + param set hit rate */}
          <div className="grid grid-cols-2 gap-3">

            {/* Move size breakdown */}
            <div className="bg-slate-800/30 rounded-lg p-3">
              <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider mb-2">
                Hit rate by move size — {activeN}d before
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    <th className="text-left text-[9px] text-slate-500 pb-1">Move</th>
                    <th className="text-right text-[9px] text-slate-500 pb-1">n</th>
                    <th className="text-right text-[9px] text-slate-500 pb-1">Actionable</th>
                    <th className="text-right text-[9px] text-slate-500 pb-1">On Radar</th>
                  </tr>
                </thead>
                <tbody>
                  {moveBreakdown(activeN).map((b, i) => (
                    <tr key={i} className="border-b border-slate-700/20">
                      <td className="py-1 text-[11px] font-mono text-slate-300">{b.label}</td>
                      <td className="py-1 text-[10px] text-slate-500 text-right font-mono">{b.total}</td>
                      <td className="py-1 text-right">
                        <span className="text-[10px] font-mono font-bold" style={{ color: b.actionable > 0 ? '#4ade80' : '#475569' }}>
                          {pct(b.actionable, b.total)}%
                        </span>
                      </td>
                      <td className="py-1 text-right">
                        <span className="text-[10px] font-mono" style={{ color: b.onRadar > 0 ? '#818cf8' : '#475569' }}>
                          {pct(b.onRadar, b.total)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Param set breakdown */}
            <div className="bg-slate-800/30 rounded-lg p-3">
              <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider mb-2">
                Which param set catches the most — {activeN}d before
              </div>
              {bestParamStats(activeN).map((ps, i) => (
                <div key={i} className="flex items-center gap-2 mb-1.5">
                  <div className="w-20 text-[10px] font-mono text-slate-400">{ps.label}</div>
                  <div className="flex-1 bg-slate-700/40 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${summary.total > 0 ? (ps.count / summary.actionable || 0) * 100 : 0}%` }} />
                  </div>
                  <div className="text-[10px] font-mono text-emerald-400 w-8 text-right">{ps.count}</div>
                </div>
              ))}
              <div className="text-[9px] text-slate-600 mt-2 border-t border-slate-700/40 pt-1.5">
                Count of times each param set gave the highest stage (actionable events only)
              </div>
            </div>
          </div>

          {/* Event table */}
          <div className="bg-slate-800/30 rounded-lg overflow-hidden">
            {/* Table filter bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/50">
              <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{activeN}d before · {displayed.length} events</div>
              <div className="flex gap-1 ml-auto">
                {(['all', 'actionable', 'on_radar', 'missed'] as const).map(fc => (
                  <button key={fc} onClick={() => setFilterClass(fc)}
                    className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${filterClass === fc ? 'bg-slate-600 border-slate-500 text-slate-200' : 'bg-transparent border-slate-700 text-slate-500 hover:text-slate-300'}`}
                    style={filterClass === fc && fc !== 'all' ? { borderColor: classColor(fc), color: classColor(fc) } : {}}>
                    {fc === 'all' ? 'All' : fc === 'actionable' ? '✓ Actionable' : fc === 'on_radar' ? '~ On Radar' : '✗ Missed'}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-auto max-h-[480px]">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-slate-800/95">
                  <tr className="border-b border-slate-700/50">
                    <Th k="symbol" label="Symbol" />
                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Event Date</th>
                    <Th k="movePct" label="Move %" />
                    <Th k="volMult" label="Vol ×" />
                    <Th k="bestStage" label="Best Stage" />
                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Param Set</th>
                    {PARAM_SET_KEYS.map(k => (
                      <th key={k} className="px-2 py-1.5 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                        {PARAM_SET_LABELS[k]}
                      </th>
                    ))}
                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((r, i) => {
                    const rowKey = `${r.symbol}-${r.date}-${r.nBefore}`;
                    return (
                      <tr key={rowKey} onClick={() => setExpanded(expanded === rowKey ? null : rowKey)}
                        className={`border-b border-slate-700/20 cursor-pointer text-[11px] transition-colors
                          ${r.classification === 'actionable' ? 'hover:bg-emerald-900/10' :
                            r.classification === 'on_radar'   ? 'hover:bg-indigo-900/10' :
                                                                'hover:bg-slate-700/10'}`}>
                        <td className="px-2 py-1.5 font-mono font-semibold text-slate-200">
                          {r.symbol.replace('.NS', '').replace('.BO', '')}
                        </td>
                        <td className="px-2 py-1.5 text-slate-400 font-mono whitespace-nowrap">{r.date}</td>
                        <td className="px-2 py-1.5 font-mono font-bold text-emerald-400">+{r.movePct.toFixed(1)}%</td>
                        <td className="px-2 py-1.5 font-mono text-slate-300">{r.volMult.toFixed(1)}×</td>
                        <td className="px-2 py-1.5">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold"
                            style={{ color: stageColor(r.bestStage), background: stageBg(r.bestStage), border: `1px solid ${stageColor(r.bestStage)}40` }}>
                            {stageLabel(r.bestStage)}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-slate-400 font-mono">
                          {r.bestParamSet ? PARAM_SET_LABELS[r.bestParamSet] : '—'}
                        </td>
                        {PARAM_SET_KEYS.map(k => {
                          const s = r.stages[k] ?? 'NO_SIGNAL';
                          return (
                            <td key={k} className="px-2 py-1.5 text-center">
                              <span className="text-[9px] font-mono" style={{ color: stageColor(s) }}>
                                {ACTIONABLE.has(s) ? '●' : ON_RADAR.has(s) ? '◐' : '○'}
                              </span>
                            </td>
                          );
                        })}
                        <td className="px-2 py-1.5">
                          <span className="text-[10px] font-semibold" style={{ color: classColor(r.classification) }}>
                            {r.classification === 'actionable' ? '✓ Caught' :
                             r.classification === 'on_radar'   ? '~ On Radar' : '✗ Missed'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {displayed.length === 0 && (
                <div className="text-center py-6 text-[11px] text-slate-600">
                  No events match the current filter.
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="px-3 py-2 border-t border-slate-700/30 flex items-center gap-4 text-[9px] text-slate-600">
              <span>● Actionable (BUY+)</span>
              <span>◐ On Radar (PRE_BREAKOUT / EARLY_INFL / COMPRESSION)</span>
              <span>○ Missed (NO_SIGNAL)</span>
              <span className="ml-auto">Click any row to expand · Sorted by {sortKey} {sortDir}</span>
            </div>
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && !hasResults && (
        <div className="text-center py-16">
          <div className="text-5xl mb-3">🔬</div>
          <div className="text-sm font-semibold text-slate-400 mb-2">Post Breakout Forensic Backtest</div>
          <div className="text-xs text-slate-600 max-w-lg mx-auto leading-relaxed">
            Paste the stocks you want to audit. For each one, this finds every genuine monster-move day
            (≥{minMovePct}% on ≥{minVolMult}× volume), then rewinds the clock N candles before that move
            and asks: <span className="text-slate-400">"Was this already in my screener?"</span>
            <br/><br/>
            The result shows your screener's advance detection rate across all 5 param sets — and which moves
            it consistently misses.
          </div>
        </div>
      )}
    </div>
  );
}
