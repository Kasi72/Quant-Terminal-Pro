'use client';

import { useState, useMemo } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  useReactTable,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table';
import type { ScreeningResult } from '@/lib/types';
import ClusterBadge from './ClusterBadge';
import ExportButtons from './ExportButtons';
import { ChevronUp, ChevronDown, ChevronsUpDown, Search, SlidersHorizontal } from 'lucide-react';

const ch = createColumnHelper<ScreeningResult>();

const rowBg: Record<number, string> = {
  4: 'bg-yellow-500/10 border-l-2 border-yellow-400',
  3: 'bg-orange-500/10 border-l-2 border-orange-400',
  2: 'bg-teal-500/10 border-l-2 border-teal-400',
  1: 'bg-blue-500/10 border-l-2 border-blue-400',
};

function num(v: number | null | undefined, dp = 2) {
  return v == null ? '–' : v.toFixed(dp);
}
function crore(v: number | null | undefined) {
  if (v == null) return '–';
  return `₹${(v / 1e7).toFixed(1)}Cr`;
}

export default function ScreenerTable({ results }: { results: ScreeningResult[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'clusters_passed', desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [clusterFilter, setClusterFilter] = useState<number>(0); // 0 = all
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(
    () => clusterFilter > 0 ? results.filter((r) => r.clusters_passed >= clusterFilter) : results,
    [results, clusterFilter]
  );

  const columns = useMemo(() => [
    ch.accessor('symbol', {
      header: 'Symbol',
      cell: (i) => <span className="font-mono font-bold text-indigo-300">{i.getValue()}</span>,
    }),
    ch.accessor('last_close', {
      header: 'Close ₹',
      cell: (i) => <span className="text-slate-200">{num(i.getValue())}</span>,
    }),
    ch.accessor('last_date', {
      header: 'Date',
      cell: (i) => <span className="text-slate-400 text-xs">{i.getValue()}</span>,
    }),
    ch.accessor('avg_turnover_20', {
      header: 'Turnover',
      cell: (i) => <span className="text-slate-300 text-xs">{crore(i.getValue())}</span>,
    }),
    ch.accessor('atr_pct14_pctl120', {
      header: 'ATR Pctl',
      cell: (i) => <Pill v={i.getValue()} low={60} high={80} lowGood />,
    }),
    ch.accessor('compression_zone_len', {
      header: 'Zone Len',
      cell: (i) => <span className="text-slate-300">{i.getValue() ?? '–'}</span>,
    }),
    ch.accessor('zone_tightness_pct', {
      header: 'Tight%',
      cell: (i) => <Pill v={i.getValue()} low={5} high={15} lowGood dp={1} />,
    }),
    ch.accessor('pre10_avg_range_atr', {
      header: 'Pre10 rATR',
      cell: (i) => <span className="text-slate-400 text-xs">{num(i.getValue(), 3)}</span>,
    }),
    ch.accessor('exact_vol_vs_pre5', {
      header: 'Vol/Pre5',
      cell: (i) => <Pill v={i.getValue()} low={2} high={4} lowGood={false} dp={2} />,
    }),
    ch.accessor('close_loc', {
      header: 'CloseLoc',
      cell: (i) => <Pill v={i.getValue()} low={65} high={80} lowGood={false} dp={1} />,
    }),
    ch.accessor('upper_wick_pct', {
      header: 'UWick%',
      cell: (i) => <Pill v={i.getValue()} low={20} high={35} lowGood dp={1} />,
    }),
    ch.accessor('body_pct', {
      header: 'Body%',
      cell: (i) => <Pill v={i.getValue()} low={35} high={55} lowGood={false} dp={1} />,
    }),
    ch.accessor('signal_range_pct', {
      header: 'SigRng%',
      cell: (i) => <span className="text-slate-400 text-xs">{num(i.getValue(), 2)}</span>,
    }),
    ch.accessor('ultra_precision_score', {
      header: 'UPS',
      cell: (i) => <UpsCell v={i.getValue()} />,
    }),
    ch.accessor('rsi2', {
      header: 'RSI2',
      cell: (i) => <Pill v={i.getValue()} low={50} high={70} lowGood={false} dp={1} />,
    }),
    ch.accessor('volatility_expansion_ratio', {
      header: 'VER',
      cell: (i) => <span className="text-slate-300 text-xs">{num(i.getValue(), 2)}</span>,
    }),
    ch.accessor('passed_deployable', {
      header: 'D20+',
      cell: (i) => <ClusterBadge passed={!!i.getValue()} label="D" />,
      enableSorting: true,
    }),
    ch.accessor('passed_high_precision', {
      header: 'HP15+',
      cell: (i) => <ClusterBadge passed={!!i.getValue()} label="HP" />,
    }),
    ch.accessor('passed_elite', {
      header: 'E10+',
      cell: (i) => <ClusterBadge passed={!!i.getValue()} label="E" />,
    }),
    ch.accessor('passed_ultra_selective', {
      header: 'US8+',
      cell: (i) => <ClusterBadge passed={!!i.getValue()} label="US" />,
    }),
    ch.accessor('clusters_passed', {
      header: '#',
      cell: (i) => {
        const v = i.getValue();
        const color = v === 4 ? 'text-yellow-300' : v === 3 ? 'text-orange-300' : v === 2 ? 'text-teal-300' : v === 1 ? 'text-blue-300' : 'text-slate-600';
        return <span className={`font-bold text-lg ${color}`}>{v}</span>;
      },
    }),
  ], []);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder="Search symbol…"
              className="pl-8 pr-3 py-2 bg-slate-800 border border-slate-600 rounded-xl text-slate-200 text-sm focus:outline-none focus:border-indigo-500 w-44"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 border rounded-xl text-sm transition-colors ${showFilters ? 'bg-indigo-700 border-indigo-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:border-slate-500'}`}
          >
            <SlidersHorizontal size={14} /> Filters
          </button>
        </div>
        <ExportButtons rows={filtered} />
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-4 flex flex-wrap gap-4 items-center">
          <div>
            <label className="text-slate-400 text-xs block mb-1">Min clusters passed</label>
            <div className="flex gap-1.5">
              {[0, 1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => setClusterFilter(n)}
                  className={`w-8 h-8 rounded-lg text-sm font-semibold transition-colors ${clusterFilter === n ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                >
                  {n === 0 ? 'All' : `${n}+`}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="text-slate-400 text-xs block mb-1">Zone Len ≥</label>
              <input
                type="number"
                min={0}
                max={25}
                defaultValue={0}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0) table.getColumn('compression_zone_len')?.setFilterValue([v, 999]);
                  else table.getColumn('compression_zone_len')?.setFilterValue(undefined);
                }}
                className="w-16 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-slate-200 text-sm"
              />
            </div>
            <div>
              <label className="text-slate-400 text-xs block mb-1">UPS ≥</label>
              <input
                type="number"
                min={0}
                max={100}
                defaultValue={0}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0) table.getColumn('ultra_precision_score')?.setFilterValue([v, 100]);
                  else table.getColumn('ultra_precision_score')?.setFilterValue(undefined);
                }}
                className="w-16 px-2 py-1.5 bg-slate-700 border border-slate-600 rounded-lg text-slate-200 text-sm"
              />
            </div>
          </div>
          <div className="ml-auto text-slate-400 text-xs">
            Showing <span className="text-slate-200 font-semibold">{table.getRowModel().rows.length}</span> / {results.length} stocks
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-700">
        <table className="w-full text-sm border-collapse">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="bg-slate-800/80 border-b border-slate-700">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    onClick={h.column.getToggleSortingHandler()}
                    className="px-3 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-slate-200 whitespace-nowrap select-none"
                  >
                    <span className="flex items-center gap-1">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === 'asc' ? (
                        <ChevronUp size={12} className="text-indigo-400" />
                      ) : h.column.getIsSorted() === 'desc' ? (
                        <ChevronDown size={12} className="text-indigo-400" />
                      ) : (
                        <ChevronsUpDown size={12} className="opacity-30" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="text-center py-12 text-slate-500">
                  No results match the current filters
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row, idx) => (
                <tr
                  key={row.id}
                  className={`border-b border-slate-800 hover:bg-slate-800/40 transition-colors ${rowBg[row.original.clusters_passed] ?? ''} ${idx % 2 === 0 ? 'bg-slate-900/30' : ''}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2.5 whitespace-nowrap">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Mini sub-components ────────────────────────────────────────────────────────
function Pill({ v, low, high, lowGood, dp = 2 }: { v: number | null | undefined; low: number; high: number; lowGood: boolean; dp?: number }) {
  if (v == null) return <span className="text-slate-600">–</span>;
  const isGood = lowGood ? v <= low : v >= high;
  const isMid = lowGood ? v <= high : v >= low;
  const color = isGood ? 'text-emerald-300' : isMid ? 'text-amber-300' : 'text-slate-400';
  return <span className={`font-mono text-xs ${color}`}>{v.toFixed(dp)}</span>;
}

function UpsCell({ v }: { v: number | null | undefined }) {
  if (v == null) return <span className="text-slate-600">–</span>;
  const color = v >= 70 ? 'text-yellow-300' : v >= 55 ? 'text-emerald-300' : v >= 45 ? 'text-amber-300' : 'text-slate-400';
  const width = Math.min(100, v);
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${v >= 70 ? 'bg-yellow-400' : v >= 55 ? 'bg-emerald-400' : 'bg-amber-400'}`} style={{ width: `${width}%` }} />
      </div>
      <span className={`font-mono text-xs font-bold ${color}`}>{v.toFixed(0)}</span>
    </div>
  );
}
