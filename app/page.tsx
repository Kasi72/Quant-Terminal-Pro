'use client';

import { useState, useRef, useCallback } from 'react';
import UploadZone from '@/components/UploadZone';
import ProgressBar from '@/components/ProgressBar';
import ScreenerTable from '@/components/ScreenerTable';
import type { ScreeningResult } from '@/lib/types';
import { Activity, TrendingUp, Zap, Shield } from 'lucide-react';

const CLUSTERS = [
  { key: 'passed_deployable', label: 'Deployable 20+', icon: Activity, color: 'text-blue-400' },
  { key: 'passed_high_precision', label: 'HighPrecision 15+', icon: TrendingUp, color: 'text-teal-400' },
  { key: 'passed_elite', label: 'Elite 10+', icon: Zap, color: 'text-orange-400' },
  { key: 'passed_ultra_selective', label: 'UltraSelective 8+', icon: Shield, color: 'text-yellow-400' },
] as const;

const CONCURRENCY = 4; // parallel fetches

export default function HomePage() {
  const [loading, setLoading]     = useState(false);
  const [processed, setProcessed] = useState(0);
  const [total, setTotal]         = useState(0);
  const [results, setResults]     = useState<ScreeningResult[]>([]);
  const abortRef = useRef(false);

  const handleSymbols = useCallback(async (symbols: string[]) => {
    abortRef.current = false;
    setLoading(true);
    setResults([]);
    setProcessed(0);
    setTotal(symbols.length);

    // 1. Create session
    const sessRes = await fetch('/api/screen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols }),
    });
    const { session_id } = await sessRes.json();

    // 2. Process symbols in parallel batches (4 at a time)
    async function processOne(sym: string) {
      if (abortRef.current) return;
      await fetch('/api/process-symbol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id, symbol: sym }),
      });
      setProcessed((p) => p + 1);
    }

    const queue = [...symbols];
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0 && !abortRef.current) {
        const sym = queue.shift();
        if (sym) await processOne(sym);
      }
    });
    await Promise.all(workers);

    // 3. Finalize session
    await fetch('/api/finalize-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id }),
    });

    // 4. Fetch all results
    const finalRes = await fetch(`/api/session/${session_id}`);
    const finalData = await finalRes.json();
    if (finalData.results) setResults(finalData.results);

    setLoading(false);
  }, []);

  const stats = CLUSTERS.map(({ key, label, icon: Icon, color }) => ({
    label,
    Icon,
    color,
    count: results.filter((r) => r[key as keyof ScreeningResult]).length,
  }));

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-screen-xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <TrendingUp size={18} className="text-white" />
          </div>
          <div>
            <h1 className="font-bold text-slate-100 leading-none">Momentum Screener</h1>
            <p className="text-xs text-slate-500 mt-0.5">Compression Breakout · 4 Cluster Model</p>
          </div>
          <div className="ml-auto text-xs text-slate-600 hidden sm:block">
            Powered by Yahoo Finance · NSE / BSE / Global
          </div>
        </div>
      </header>

      <div className="max-w-screen-xl mx-auto px-6 py-8 space-y-8">
        <section>
          <h2 className="text-slate-300 font-semibold text-sm uppercase tracking-widest mb-3">
            Step 1 · Upload symbol list
          </h2>
          <UploadZone onSymbols={handleSymbols} loading={loading} />
        </section>

        {loading && (
          <ProgressBar processed={processed} total={total} status="running" />
        )}

        {results.length > 0 && (
          <section>
            <h2 className="text-slate-300 font-semibold text-sm uppercase tracking-widest mb-3">
              Cluster summary
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {stats.map(({ label, Icon, color, count }) => (
                <div key={label} className="bg-slate-900 border border-slate-700 rounded-2xl p-4">
                  <Icon size={18} className={color} />
                  <div className="text-3xl font-bold mt-2 text-slate-100">{count}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-400">
              <span className="text-slate-200 font-semibold">{results.length}</span> stocks scanned ·
              <span className="text-emerald-300 font-semibold">{results.filter((r) => r.clusters_passed > 0).length}</span> with ≥1 cluster ·
              <span className="text-yellow-300 font-semibold">{results.filter((r) => r.clusters_passed === 4).length}</span> hit all 4
            </div>
          </section>
        )}

        {results.length > 0 && (
          <section>
            <h2 className="text-slate-300 font-semibold text-sm uppercase tracking-widest mb-3">
              Step 2 · Results
            </h2>
            <ScreenerTable results={results} />
          </section>
        )}

        {!loading && results.length === 0 && total > 0 && (
          <div className="text-center py-16 text-slate-500">
            No results returned. Check that your symbols are valid Yahoo Finance tickers (e.g. RELIANCE.NS).
          </div>
        )}
      </div>
    </main>
  );
}
