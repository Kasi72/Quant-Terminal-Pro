'use client';

import { useState, useMemo, useRef, useCallback } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  useReactTable,
  type SortingState,
  type ColumnFiltersState,
  type FilterFn,
} from '@tanstack/react-table';
import type { ScreeningResult } from '@/lib/types';
import { exportCSV, exportXLSX, exportPDF } from '@/lib/export';
import {
  ChevronUp, ChevronDown, ChevronsUpDown,
  Search, SlidersHorizontal, Download, Star,
} from 'lucide-react';

// ── Tier derivation ────────────────────────────────────────────────────────────
type Tier = 'OrsConfirmed' | 'OrsSignal' | 'Ultra' | 'Elite' | 'HighPrecision' | 'Deployable' | null;

interface DerivedRow extends ScreeningResult {
  tier: Tier;
  win_rate: number;
  confidence: number;
  stop_loss: number | null;
  target: number | null;
}

const TIER_WIN_RATE: Record<string, number> = {
  OrsConfirmed: 74, OrsSignal: 70,
  Ultra: 90, Elite: 82, HighPrecision: 78, Deployable: 72,
};

const TIER_COLOR: Record<string, string> = {
  OrsConfirmed:  'bg-purple-500/30 text-purple-200 border-purple-400/60',
  OrsSignal:     'bg-purple-500/15 text-purple-300 border-purple-500/40',
  Ultra:         'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  Elite:         'bg-orange-500/20 text-orange-300 border-orange-500/40',
  HighPrecision: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
  Deployable:    'bg-blue-500/20 text-blue-300 border-blue-500/40',
};

const TIER_LABEL: Record<string, string> = {
  Ultra: 'Tier 1 · Ultra', Elite: 'Tier 2 · Elite',
  HighPrecision: 'Tier 3 · HighPrec', Deployable: 'Tier 4 · Deploy',
};

const ROW_BORDER: Record<string, string> = {
  OrsConfirmed: 'border-l-2 border-purple-400',
  OrsSignal: 'border-l-2 border-purple-300',
  Ultra: 'border-l-2 border-yellow-400',
  Elite: 'border-l-2 border-orange-400',
  HighPrecision: 'border-l-2 border-teal-400',
  Deployable: 'border-l-2 border-blue-400',
};

function deriveRow(r: ScreeningResult): DerivedRow {
  const tier: Tier = r.ors_confirmed ? 'OrsConfirmed'
    : r.passed_ors_prime ? 'OrsSignal'
    : r.passed_ultra_selective ? 'Ultra'
    : r.passed_elite ? 'Elite'
    : r.passed_high_precision ? 'HighPrecision'
    : r.passed_deployable ? 'Deployable'
    : null;

  const win_rate  = tier ? TIER_WIN_RATE[tier] : 0;
  const confidence = Math.min(99, Math.round(r.ultra_precision_score ?? 0));

  // Stop loss = entry minus 1× signal candle range (rounded to ₹0.05)
  const stop_loss = r.last_close && r.signal_range_pct
    ? +( r.last_close * (1 - r.signal_range_pct / 100) ).toFixed(2)
    : null;

  // Target = minimum 5% move from entry
  const target = r.last_close ? +(r.last_close * 1.05).toFixed(2) : null;

  return { ...r, tier, win_rate, confidence, stop_loss, target };
}

// ── Range filter fn ────────────────────────────────────────────────────────────
const rangeFilterFn: FilterFn<DerivedRow> = (row, columnId, filterValue) => {
  const [min, max] = filterValue as [number, number];
  const val = row.getValue<number>(columnId);
  return (isNaN(min) || val >= min) && (isNaN(max) || val <= max);
};
rangeFilterFn.autoRemove = (val) => !val || (isNaN(val[0]) && isNaN(val[1]));

// ── Column helper ──────────────────────────────────────────────────────────────
const ch = createColumnHelper<DerivedRow>();

function fmt(v: number | null | undefined, dp = 2) {
  return v == null ? '–' : v.toFixed(dp);
}
function inr(v: number | null | undefined, dp = 2) {
  if (v == null) return '–';
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}
function crore(v: number | null | undefined) {
  if (v == null) return '–';
  if (v >= 1e9) return `₹${(v / 1e9).toFixed(1)}B`;
  return `₹${(v / 1e7).toFixed(1)}Cr`;
}

// ── Sub-cells ──────────────────────────────────────────────────────────────────
function Pill({ v, good, neutral, dp = 2 }: { v: number | null | undefined; good: boolean; neutral?: boolean; dp?: number }) {
  if (v == null) return <span className="text-slate-600">–</span>;
  const color = neutral ? 'text-slate-300' : good ? 'text-emerald-300' : 'text-rose-300';
  return <span className={`font-mono text-xs ${color}`}>{v.toFixed(dp)}</span>;
}

function UpsBar({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="text-slate-600">–</span>;
  const pct = Math.min(100, v);
  const color = v >= 70 ? 'bg-yellow-400' : v >= 55 ? 'bg-emerald-400' : v >= 45 ? 'bg-amber-400' : 'bg-slate-600';
  const text  = v >= 70 ? 'text-yellow-300' : v >= 55 ? 'text-emerald-300' : v >= 45 ? 'text-amber-300' : 'text-slate-400';
  return (
    <div className="flex items-center gap-1.5 min-w-[68px]">
      <div className="w-10 h-1.5 bg-slate-700 rounded-full overflow-hidden flex-shrink-0">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-xs font-bold ${text}`}>{v.toFixed(0)}</span>
    </div>
  );
}

function ConfBar({ v }: { v: number }) {
  const color = v >= 80 ? 'text-emerald-300' : v >= 60 ? 'text-amber-300' : 'text-slate-400';
  return <span className={`font-mono text-sm font-bold ${color}`}>{v}%</span>;
}

function TierBadge({ tier }: { tier: Tier }) {
  if (!tier) return <span className="text-slate-600 text-xs">–</span>;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${TIER_COLOR[tier]}`}>
      <Star size={9} className="fill-current" />
      {TIER_LABEL[tier]}
    </span>
  );
}

function QualityDots({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="text-slate-600">–</span>;
  return (
    <div className="flex gap-0.5 items-center">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={`w-2 h-2 rounded-full ${i < v ? 'bg-emerald-400' : 'bg-slate-700'}`} />
      ))}
      <span className="text-xs text-slate-400 ml-1">{v}/5</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function ScreenerTable({ results }: { results: ScreeningResult[] }) {
  const [sorting, setSorting]           = useState<SortingState>([{ id: 'clusters_passed', desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [tierFilter, setTierFilter]     = useState<Tier | 'all'>('all');
  const [showFilters, setShowFilters]   = useState(false);

  // Dual-scrollbar sync
  const topBarRef   = useRef<HTMLDivElement>(null);
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const syncFrom = useCallback((src: 'top' | 'table') => {
    if (!topBarRef.current || !tableWrapRef.current) return;
    if (src === 'top')   tableWrapRef.current.scrollLeft = topBarRef.current.scrollLeft;
    if (src === 'table') topBarRef.current.scrollLeft   = tableWrapRef.current.scrollLeft;
  }, []);

  const rows = useMemo(() => results.map(deriveRow), [results]);

  const filtered = useMemo(() => {
    if (tierFilter === 'all') return rows;
    if (tierFilter === null) return rows.filter((r) => !r.tier);
    return rows.filter((r) => r.tier === tierFilter);
  }, [rows, tierFilter]);

  // Tier counts for export buttons
  const counts = useMemo(() => ({
    Ultra:         rows.filter((r) => r.tier === 'Ultra').length,
    Elite:         rows.filter((r) => r.tier === 'Elite').length,
    HighPrecision: rows.filter((r) => r.tier === 'HighPrecision').length,
    Deployable:    rows.filter((r) => r.tier === 'Deployable').length,
    All:           rows.length,
  }), [rows]);

  const columns = useMemo(() => [
    ch.display({
      id: 'row_num',
      header: '#',
      cell: (i) => <span className="text-slate-500 text-xs tabular-nums">{i.row.index + 1}</span>,
      enableSorting: false,
    }),
    ch.accessor('symbol', {
      header: 'Symbol',
      cell: (i) => (
        <span className="font-mono font-bold text-indigo-300 text-sm tracking-wide">
          {i.getValue()}
        </span>
      ),
    }),
    ch.accessor('last_close', {
      header: 'Price',
      cell: (i) => <span className="text-slate-100 font-semibold tabular-nums">{inr(i.getValue())}</span>,
    }),
    ch.accessor('tier', {
      header: 'Tier',
      cell: (i) => <TierBadge tier={i.getValue()} />,
      enableColumnFilter: false,
    }),
    ch.accessor('win_rate', {
      header: 'Win-Rate',
      cell: (i) => {
        const v = i.getValue();
        return v ? <span className="font-bold text-emerald-300">{v}%</span> : <span className="text-slate-600">–</span>;
      },
    }),
    ch.accessor('clusters_passed', {
      header: 'Paramsets',
      cell: (i) => {
        const v = i.getValue();
        const color = v >= 5 ? 'text-purple-300' : v === 4 ? 'text-yellow-300' : v === 3 ? 'text-orange-300' : v === 2 ? 'text-teal-300' : v === 1 ? 'text-blue-300' : 'text-slate-600';
        return <span className={`font-bold text-sm ${color}`}>{v}/5</span>;
      },
    }),
    ch.accessor('passed_ors_prime', {
      header: 'ORS↩',
      cell: (i) => {
        const r = i.row.original;
        if (!i.getValue()) return <span className="text-slate-600 text-xs">–</span>;
        return r.ors_confirmed
          ? <span className="text-purple-300 font-bold text-xs" title={`Confirmed entry · ORS score ${r.ors_score ?? 0} · DD ${r.ors_dd_from_swing_high?.toFixed(1) ?? '?'}%`}>✓✓ Confirmed</span>
          : <span className="text-purple-400 text-xs" title={`Signal · ORS score ${r.ors_score ?? 0} · DD ${r.ors_dd_from_swing_high?.toFixed(1) ?? '?'}%`}>✓ Signal</span>;
      },
      enableColumnFilter: false,
    }),
    ch.accessor('candle_quality_score', {
      header: 'Quality',
      cell: (i) => <QualityDots v={i.getValue()} />,
    }),
    ch.accessor('compression_zone_len', {
      header: 'Zone Len',
      cell: (i) => {
        const v = i.getValue();
        return (
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 rounded-full bg-indigo-500/40 overflow-hidden" style={{ width: '36px' }}>
              <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${Math.min(100, ((v ?? 0) / 25) * 100)}%` }} />
            </div>
            <span className="text-slate-300 text-xs tabular-nums">{v ?? '–'}</span>
          </div>
        );
      },
    }),
    ch.accessor('zone_tightness_pct', {
      header: 'Tightness%',
      cell: (i) => <Pill v={i.getValue()} good={(i.getValue() ?? 99) <= 8} neutral={(i.getValue() ?? 99) <= 15} dp={1} />,
    }),
    ch.accessor('exact_vol_vs_pre5', {
      header: 'Vol/Pre5',
      cell: (i) => <Pill v={i.getValue()} good={(i.getValue() ?? 0) >= 3} neutral={(i.getValue() ?? 0) >= 2} dp={2} />,
    }),
    ch.accessor('close_loc', {
      header: 'CloseLoc',
      cell: (i) => <Pill v={i.getValue()} good={(i.getValue() ?? 0) >= 80} neutral={(i.getValue() ?? 0) >= 65} dp={1} />,
    }),
    ch.accessor('upper_wick_pct', {
      header: 'UWick%',
      cell: (i) => <Pill v={i.getValue()} good={(i.getValue() ?? 99) <= 20} neutral={(i.getValue() ?? 99) <= 35} dp={1} />,
    }),
    ch.accessor('body_pct', {
      header: 'Body%',
      cell: (i) => <Pill v={i.getValue()} good={(i.getValue() ?? 0) >= 55} neutral={(i.getValue() ?? 0) >= 35} dp={1} />,
    }),
    ch.accessor('confidence', {
      header: 'Confidence',
      cell: (i) => <ConfBar v={i.getValue()} />,
    }),
    ch.accessor('ultra_precision_score', {
      header: 'UPS',
      cell: (i) => <UpsBar v={i.getValue()} />,
    }),
    ch.accessor('rsi2', {
      header: 'RSI2',
      cell: (i) => <Pill v={i.getValue()} good={(i.getValue() ?? 0) >= 70} neutral={(i.getValue() ?? 0) >= 50} dp={1} />,
    }),
    ch.accessor('last_close', {
      id: 'entry',
      header: 'Entry',
      cell: (i) => <span className="text-slate-200 tabular-nums font-mono text-xs">{inr(i.getValue())}</span>,
    }),
    ch.accessor('stop_loss', {
      header: 'Stop Loss',
      cell: (i) => <span className="text-rose-400 tabular-nums font-mono text-xs">{inr(i.getValue())}</span>,
    }),
    ch.accessor('target', {
      header: 'Target',
      cell: (i) => <span className="text-emerald-400 tabular-nums font-mono text-xs">{inr(i.getValue())}</span>,
    }),
    ch.accessor('avg_turnover_20', {
      header: 'Turnover',
      cell: (i) => <span className="text-slate-400 text-xs">{crore(i.getValue())}</span>,
    }),
    ch.accessor('atr_pct14_pctl120', {
      header: 'ATR Pctl',
      cell: (i) => <Pill v={i.getValue()} good={(i.getValue() ?? 99) <= 60} neutral={(i.getValue() ?? 99) <= 75} dp={1} />,
    }),
    ch.accessor('volatility_expansion_ratio', {
      header: 'VER',
      cell: (i) => <Pill v={i.getValue()} good={(i.getValue() ?? 0) >= 1.5} neutral={(i.getValue() ?? 0) >= 1.1} dp={2} />,
    }),
    ch.accessor('signal_range_pct', {
      header: 'SigRng%',
      cell: (i) => <Pill v={i.getValue()} good={(i.getValue() ?? 99) <= 5} neutral={(i.getValue() ?? 99) <= 8.5} dp={2} />,
    }),
    ch.accessor('tier', {
      id: 'best_paramset',
      header: 'Best Paramset',
      cell: (i) => {
        const t = i.getValue();
        if (!t) return <span className="text-slate-600 text-xs">–</span>;
        return <span className="text-xs font-semibold text-slate-300">{t}</span>;
      },
      enableSorting: false,
    }),
  ], []);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, columnFilters, globalFilter },
    filterFns: { rangeFilter: rangeFilterFn },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const visibleRows = table.getRowModel().rows;

  return (
    <div className="space-y-3">

      {/* ── Top toolbar ── */}
      <div className="flex flex-col gap-3">

        {/* Export tier buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400 text-xs font-medium uppercase tracking-wide mr-1">Export tier:</span>
          {(['Ultra', 'Elite', 'HighPrecision', 'Deployable'] as const).map((t) => (
            <button
              key={t}
              onClick={() => exportXLSX(rows.filter((r) => r.tier === t), `screener_${t}.xlsx`)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${TIER_COLOR[t]}`}
            >
              <Download size={11} /> {t} <span className="opacity-70">{counts[t]}</span>
            </button>
          ))}
          <button
            onClick={() => exportXLSX(rows, 'screener_all.xlsx')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-600 text-slate-300 bg-slate-800 transition-colors hover:bg-slate-700"
          >
            <Download size={11} /> All <span className="opacity-70">({counts.All})</span>
          </button>
          <div className="ml-auto flex gap-2">
            <button onClick={() => exportCSV(rows)} className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors">
              <Download size={11} /> CSV
            </button>
            <button onClick={() => exportPDF(rows)} className="flex items-center gap-1 px-2.5 py-1.5 bg-red-900/60 hover:bg-red-800/60 text-red-300 text-xs rounded-lg transition-colors">
              <Download size={11} /> PDF
            </button>
          </div>
        </div>

        {/* Tier weight legend */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="font-medium">Win-Rate-Weighted Tiers —</span>
          <span className="text-slate-500">backtested rank: Ultra (No.1) › Elite (No.2) › HighPrecision (No.3) › Deployable (No.4)</span>
          <div className="flex gap-1.5 ml-auto flex-wrap">
            {(['Ultra', 'Elite', 'HighPrecision', 'Deployable'] as const).map((t, i) => (
              <button
                key={t}
                onClick={() => setTierFilter(tierFilter === t ? 'all' : t)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${tierFilter === t ? TIER_COLOR[t] : 'border-slate-700 text-slate-500 bg-transparent hover:border-slate-500'}`}
              >
                Tier {i + 1} · {t} w={[50, 20, 8, 4][i]}
              </button>
            ))}
          </div>
        </div>

        {/* Search + filter row */}
        <div className="flex flex-wrap gap-2 items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold text-sm">
              <span className="text-indigo-400">⚡</span> Scan Results
              <span className="text-slate-500 font-normal ml-1">
                {visibleRows.length} of {rows.length} found
              </span>
              {tierFilter !== 'all' && (
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-semibold border ${TIER_COLOR[tierFilter as string] ?? ''}`}>
                  {tierFilter}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder="Search symbol…"
                className="pl-8 pr-3 py-1.5 bg-slate-800 border border-slate-600 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-indigo-500 w-40"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-xl text-sm transition-colors ${showFilters ? 'bg-indigo-700 border-indigo-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-slate-500'}`}
            >
              <SlidersHorizontal size={13} /> Filters
            </button>
            {tierFilter !== 'all' && (
              <button onClick={() => setTierFilter('all')} className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1.5 border border-slate-700 rounded-xl transition-colors">
                × Clear filter
              </button>
            )}
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { col: 'compression_zone_len', label: 'Zone Len ≥', min: true },
              { col: 'ultra_precision_score', label: 'UPS ≥', min: true },
              { col: 'exact_vol_vs_pre5', label: 'Vol/Pre5 ≥', min: true },
              { col: 'zone_tightness_pct', label: 'Tightness% ≤', min: false },
            ].map(({ col, label, min }) => (
              <div key={col}>
                <label className="text-slate-400 text-xs block mb-1">{label}</label>
                <input
                  type="number"
                  step="0.1"
                  defaultValue=""
                  placeholder="–"
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) {
                      table.getColumn(col)?.setFilterValue(min ? [v, Infinity] : [-Infinity, v]);
                    } else {
                      table.getColumn(col)?.setFilterValue(undefined);
                    }
                  }}
                  className="w-full px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── TOP scrollbar (mirrors bottom) ── */}
      <div
        ref={topBarRef}
        onScroll={() => syncFrom('top')}
        className="overflow-x-auto overflow-y-hidden"
        style={{ height: '12px' }}
      >
        <div style={{ height: '1px', minWidth: '1800px' }} />
      </div>

      {/* ── Table ── */}
      <div
        ref={tableWrapRef}
        onScroll={() => syncFrom('table')}
        className="overflow-x-auto rounded-2xl border border-slate-700/80"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#475569 #1e293b' }}
      >
        <table className="w-full text-sm border-collapse" style={{ minWidth: '1800px' }}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="bg-slate-800 border-b border-slate-700 sticky top-0 z-10">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    onClick={h.column.getToggleSortingHandler()}
                    className={`px-3 py-2.5 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap select-none ${h.column.getCanSort() ? 'cursor-pointer hover:text-slate-200 hover:bg-slate-700/50' : ''} transition-colors`}
                  >
                    <span className="flex items-center gap-1">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === 'asc'  ? <ChevronUp   size={11} className="text-indigo-400" /> :
                       h.column.getIsSorted() === 'desc' ? <ChevronDown  size={11} className="text-indigo-400" /> :
                       h.column.getCanSort()             ? <ChevronsUpDown size={11} className="opacity-25" /> : null}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-16 text-slate-500">
                  No results match the current filters
                </td>
              </tr>
            ) : (
              visibleRows.map((row, idx) => {
                const t = row.original.tier;
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-slate-800/60 hover:bg-slate-800/50 transition-colors ${t ? ROW_BORDER[t] : ''} ${idx % 2 === 1 ? 'bg-slate-900/20' : ''}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Bottom status bar ── */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <span>
          Showing <span className="text-slate-300 font-semibold">{visibleRows.length}</span> of{' '}
          <span className="text-slate-300 font-semibold">{rows.length}</span> stocks
          {tierFilter !== 'all' && ` · filtered to ${tierFilter}`}
        </span>
        <div className="flex items-center gap-3">
          {(['Ultra', 'Elite', 'HighPrecision', 'Deployable'] as const).map((t) => (
            <span key={t} className="flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${t === 'Ultra' ? 'bg-yellow-400' : t === 'Elite' ? 'bg-orange-400' : t === 'HighPrecision' ? 'bg-teal-400' : 'bg-blue-400'}`} />
              {t}: {counts[t]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
