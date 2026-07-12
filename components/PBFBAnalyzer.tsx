'use client';
import { useState, useRef, Fragment, useEffect } from 'react';
import { fetchOHLCVClient } from '@/lib/fetchClient';
import { analyzeStock, type StageRating, type ParamSetKey, type AnalysisResult } from '@/lib/stockEngine';
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

interface UCHitter {
  symbol:     string;
  movePct:    number;
  isUCLock:   boolean;
  closePrice: number;
  prevClose:  number;
  volume:     number;
}

interface BreakoutEvent {
  symbol:    string;
  eventIdx:  number;
  date:      string;
  movePct:   number;
  volMult:   number;
  isUCLock:  boolean;
  candles:   Candle[];
}

interface ForensicResult {
  symbol:       string;
  date:         string;
  movePct:      number;
  volMult:      number;
  isUCLock:     boolean;
  nBefore:      number;
  stages:       Partial<Record<ParamSetKey, StageRating>>;
  bestStage:    StageRating;
  bestParamSet: ParamSetKey | null;
  bestResult:   AnalysisResult | null;  // full snapshot N days before breakout
  anyZone:      boolean;
  classification: 'actionable' | 'on_radar' | 'zone_only' | 'missed';
}

interface FeatureCentroid {
  closeLoc: number; bodyPct: number; upperWickPct: number;
  volRatio20: number; volPre5: number; rangeATR: number;
  rsi2: number; zoneLen: number; zoneTightness: number;
}
interface BrainData {
  eventCount: number; actionableCount: number; runCount: number;
  lastRunDate: string; overallDetectionRate: number;
  centroid: FeatureCentroid;
  stageHitCounts: Partial<Record<StageRating, number>>;
  featureLifts: { label: string; lift: number }[];
}

// ─── Colour helpers ───────────────────────────────────────────────────────────

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
  return 'NO SIGNAL';
}

function classColor(c: 'actionable' | 'on_radar' | 'zone_only' | 'missed'): string {
  if (c === 'actionable') return '#4ade80';
  if (c === 'on_radar')   return '#818cf8';
  if (c === 'zone_only')  return '#fbbf24';
  return '#f87171';
}

function pct(n: number, d: number) { return d > 0 ? ((n / d) * 100).toFixed(1) : '0.0'; }
function f2(n: number)  { return n.toFixed(2); }
function f1(n: number)  { return n.toFixed(1); }
function f0(n: number)  { return n.toFixed(0); }

function metricColor(v: number, lo: number, hi: number): string {
  return v >= hi ? '#4ade80' : v >= lo ? '#fbbf24' : '#f87171';
}

// ─── Expanded pre-event detail panel ─────────────────────────────────────────

function ExpandedDetail({ r }: { r: ForensicResult }) {
  const br = r.bestResult;
  if (!br) {
    return (
      <div className="px-4 py-3 text-[10px] text-slate-600 italic">
        No analysis data — candle history too short to replay {r.nBefore}d before this event.
      </div>
    );
  }
  const z = br.zone;
  const passed = br.checklist?.filter(c => c.pass) ?? [];
  const failed = br.checklist?.filter(c => !c.pass) ?? [];

  return (
    <div className="bg-slate-900/70 border-t border-b border-indigo-900/40 px-4 py-3 grid grid-cols-3 gap-5 text-[10px]">

      {/* Col 1: Pre-event candle profile */}
      <div className="space-y-1.5">
        <div className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider mb-2">
          Pre-event candle ({r.nBefore}d before · ₹{f2(br.lastClose)})
        </div>

        {/* Candle body visual */}
        <div className="flex items-center gap-2 mb-2">
          <div className="text-[9px] text-slate-600 w-20">Close location</div>
          <div className="flex-1 bg-slate-700/40 rounded-full h-2 relative">
            <div className="absolute left-0 top-0 h-2 rounded-full bg-indigo-500 transition-all"
              style={{ width: `${Math.min(100, Math.max(0, br.closeLoc))}%` }} />
          </div>
          <span className="font-mono text-[10px] w-8 text-right" style={{ color: metricColor(br.closeLoc, 50, 70) }}>
            {f1(br.closeLoc)}%
          </span>
        </div>

        <div className="space-y-1">
          {[
            { label: 'Body %',          val: f1(br.bodyPct) + '%',    color: metricColor(br.bodyPct, 30, 50),       tip: '≥50% strong bull candle' },
            { label: 'Upper wick %',    val: f1(br.upperWickPct) + '%', color: br.upperWickPct <= 25 ? '#4ade80' : br.upperWickPct <= 40 ? '#fbbf24' : '#f87171', tip: '≤25% clean close' },
            { label: 'Signal vol/20d',  val: f2(br.exactVolRatio20) + '×', color: metricColor(br.exactVolRatio20, 1.2, 2.0), tip: 'breakout vol surge' },
            { label: 'Signal vol/pre5', val: f2(br.exactVolVsPre5) + '×',  color: metricColor(br.exactVolVsPre5, 1.5, 2.5),  tip: 'vs quiet pre-window' },
            { label: 'Range / ATR14',   val: f2(br.exactRangeATR14),       color: metricColor(br.exactRangeATR14, 1.0, 1.5),  tip: 'candle range expansion' },
            { label: 'ATR %',           val: f2(br.atrPct14) + '%',        color: '#94a3b8',                                    tip: 'volatility regime' },
            { label: 'RSI-2',           val: f1(br.rsi2),                  color: metricColor(br.rsi2, 50, 65),                 tip: '≥55 momentum' },
            { label: 'Pre-10 range/ATR',val: f2(br.pre10AvgRangeATR),      color: br.pre10AvgRangeATR <= 0.7 ? '#4ade80' : br.pre10AvgRangeATR <= 1.0 ? '#fbbf24' : '#f87171', tip: '≤0.7 quiet' },
            { label: 'Pre-10 vol ratio', val: f2(br.pre10AvgVolRatio) + '×', color: br.pre10AvgVolRatio <= 0.85 ? '#4ade80' : br.pre10AvgVolRatio <= 1.0 ? '#fbbf24' : '#f87171', tip: '≤0.85 subdued vol' },
          ].map(({ label, val, color, tip }) => (
            <div key={label} className="flex items-center justify-between group">
              <span className="text-slate-600 group-hover:text-slate-400 transition-colors">{label}</span>
              <span className="font-mono font-semibold" style={{ color }} title={tip}>{val}</span>
            </div>
          ))}
        </div>

        {r.isUCLock && (
          <div className="mt-2 px-2 py-1 bg-amber-900/30 border border-amber-700/40 rounded text-[9px] text-amber-400">
            ⚡ Upper circuit lock detected on breakout day
          </div>
        )}
      </div>

      {/* Col 2: Zone + context */}
      <div className="space-y-1.5">
        <div className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider mb-2">
          Compression zone — {r.nBefore}d before
        </div>

        {z ? (
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-600">Zone ceiling</span>
              <span className="font-mono text-amber-300 font-semibold">₹{f2(z.zoneHigh)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Zone floor</span>
              <span className="font-mono text-slate-300">₹{f2(z.zoneLow)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Tightness</span>
              <span className="font-mono" style={{ color: z.zoneTightnessPct <= 5 ? '#4ade80' : z.zoneTightnessPct <= 10 ? '#fbbf24' : '#fb923c' }}>
                {f2(z.zoneTightnessPct)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Zone length</span>
              <span className="font-mono text-slate-300">{z.windowLength} candles</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Zone ATR ratio</span>
              <span className="font-mono text-slate-300">{f2(z.zoneATRRatio ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Close → zone ceil</span>
              <span className="font-mono" style={{ color: br.lastClose < z.zoneHigh ? '#fbbf24' : '#4ade80' }}>
                {br.lastClose < z.zoneHigh
                  ? `${f1(((z.zoneHigh - br.lastClose) / br.lastClose) * 100)}% below`
                  : `${f1(((br.lastClose - z.zoneHigh) / z.zoneHigh) * 100)}% above (BRK)`}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-[9px] space-y-1.5">
            <div className="text-red-400 font-semibold">No compression zone found.</div>
            {r.anyZone && (
              <div className="text-amber-500">Zone seen by another param set — different thresholds.</div>
            )}
            <div className="text-slate-600 leading-relaxed">
              The stock may have been in expansion mode, or the zone length/tightness thresholds weren't met.
              Check a shorter N before (e.g. N=1) or a looser param set.
            </div>
          </div>
        )}

        {/* Separator */}
        <div className="border-t border-slate-700/40 pt-1.5 space-y-1 mt-2">
          <div className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider">Best param set result</div>
          <div className="flex justify-between">
            <span className="text-slate-600">Param set</span>
            <span className="font-mono text-slate-300">{r.bestParamSet ? PARAM_SET_LABELS[r.bestParamSet] : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Stage</span>
            <span className="font-mono font-semibold" style={{ color: stageColor(r.bestStage) }}>
              {stageLabel(r.bestStage)}
            </span>
          </div>
          {br.inflectionScore > 0 && (
            <div className="flex justify-between">
              <span className="text-slate-600">Inflection score</span>
              <span className="font-mono" style={{ color: metricColor(br.inflectionScore, 45, 60) }}>
                {f0(br.inflectionScore)} / 100
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-600">Conditions met</span>
            <span className="font-mono text-slate-300">{br.conditionsMet} / {br.totalConditions}</span>
          </div>
          {/* Condition progress bar */}
          <div className="w-full bg-slate-700/40 rounded-full h-1.5 mt-1">
            <div className="h-1.5 rounded-full transition-all"
              style={{
                width: `${br.totalConditions > 0 ? (br.conditionsMet / br.totalConditions) * 100 : 0}%`,
                background: br.totalConditions > 0 && br.conditionsMet === br.totalConditions ? '#4ade80' : '#818cf8',
              }} />
          </div>
        </div>

        {/* All param set stages */}
        <div className="border-t border-slate-700/40 pt-1.5 space-y-0.5 mt-1">
          <div className="text-[9px] text-slate-600 uppercase font-semibold tracking-wider mb-1">All 6 param sets</div>
          {PARAM_SET_KEYS.map(k => {
            const s = r.stages[k] ?? 'NO_SIGNAL';
            return (
              <div key={k} className="flex items-center justify-between">
                <span className="text-slate-600 text-[9px]">{PARAM_SET_LABELS[k]}</span>
                <span className="text-[9px] font-mono font-semibold" style={{ color: stageColor(s) }}>
                  {stageLabel(s)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Col 3: Checklist failed / passed */}
      <div className="space-y-1.5">
        <div className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider mb-2">
          Why it was {r.classification === 'actionable' ? 'caught' : 'missed'} ({r.bestParamSet ? PARAM_SET_LABELS[r.bestParamSet] : '—'})
        </div>

        {br.checklist && br.checklist.length > 0 ? (
          <div className="max-h-52 overflow-auto pr-1 space-y-0.5">

            {/* Failed conditions first — that's the "why missed" */}
            {failed.length > 0 && (
              <>
                <div className="text-[9px] text-red-400 font-semibold mb-0.5">
                  Failed ({failed.length}):
                </div>
                {failed.map((c, i) => (
                  <div key={`f${i}`} className="flex items-start gap-1.5 bg-red-950/20 rounded px-1 py-0.5">
                    <span className="text-red-400 shrink-0 mt-0.5">✗</span>
                    <span className="text-slate-400 leading-tight flex-1">{c.label}</span>
                    {c.value && (
                      <span className="font-mono text-[9px] text-slate-500 shrink-0 ml-1">{c.value}</span>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Passed conditions */}
            {passed.length > 0 && (
              <>
                <div className="text-[9px] text-emerald-500 font-semibold mt-2 mb-0.5">
                  Passed ({passed.length}):
                </div>
                {passed.map((c, i) => (
                  <div key={`p${i}`} className="flex items-start gap-1.5">
                    <span className="text-emerald-500 shrink-0 mt-0.5">✓</span>
                    <span className="text-slate-600 leading-tight flex-1">{c.label}</span>
                    {c.value && (
                      <span className="font-mono text-[9px] text-slate-600 shrink-0 ml-1">{c.value}</span>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        ) : (
          <div className="text-slate-600 italic text-[9px]">
            No detailed checklist data available for this param set at this N.
          </div>
        )}

        {/* Improvement hint */}
        {r.classification !== 'actionable' && (
          <div className="mt-2 border-t border-slate-700/40 pt-2 text-[9px] text-slate-600 leading-relaxed">
            <span className="text-slate-500 font-semibold">Hint: </span>
            {r.classification === 'zone_only'
              ? `Zone was visible but param set conditions not met. Try a looser param set or increase N (look further back).`
              : r.classification === 'on_radar'
              ? `Stock was on radar but not fully actionable. Looser entry criteria or earlier N might catch this.`
              : failed.length > 0
              ? `${failed.length} condition${failed.length > 1 ? 's' : ''} blocked the signal. The most common causes are listed above.`
              : `No param set found this stock. It may have been a gap-up without prior compression.`}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PBFBAnalyzer() {
  const [symbolText, setSymbolText]   = useState('');
  const [maxNBefore, setMaxNBefore]   = useState(3);
  const [minMovePct, setMinMovePct]   = useState(5);    // 5% = NSE min upper circuit
  const [minVolMult, setMinVolMult]   = useState(3);
  const [loading, setLoading]         = useState(false);
  const [progress, setProgress]       = useState({ done: 0, total: 0, phase: '' });
  const [events, setEvents]           = useState<BreakoutEvent[]>([]);
  const [results, setResults]         = useState<ForensicResult[]>([]);
  const [error, setError]             = useState('');
  const [activeN, setActiveN]         = useState(1);
  const [sortKey, setSortKey]         = useState<'movePct' | 'volMult' | 'bestStage' | 'symbol'>('movePct');
  const [sortDir, setSortDir]         = useState<'asc' | 'desc'>('desc');
  const [filterClass, setFilterClass] = useState<'all' | 'actionable' | 'on_radar' | 'zone_only' | 'missed'>('all');
  const [expanded, setExpanded]       = useState<string | null>(null);
  const [brainData,    setBrainData]    = useState<BrainData | null>(null);
  const [brainLoading, setBrainLoading] = useState(false);
  const [saveState,    setSaveState]    = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // UC hitter fetcher state
  const [ucPanelOpen, setUcPanelOpen] = useState(false);
  const [ucSource, setUcSource]       = useState<'chartink' | 'bhavcopy'>('chartink');
  const [ucDate, setUcDate]           = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [ucMinPct, setUcMinPct]       = useState(5);
  const [ucFetching, setUcFetching]   = useState(false);
  const [ucError, setUcError]         = useState('');
  const [ucHitters, setUcHitters]     = useState<UCHitter[]>([]);
  const [ucFetchedDate, setUcFetchedDate] = useState('');

  const csvRef   = useRef<HTMLInputElement>(null);
  const abortRef = useRef(false);

  // Load brain data on mount and after each run
  useEffect(() => { loadBrainData(); }, []);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function fetchUCHitters() {
    setUcFetching(true);
    setUcError('');
    setUcHitters([]);
    try {
      const url = ucSource === 'chartink'
        ? `/api/chartink-scan?minPct=${ucMinPct}`
        : `/api/uc-hitters?date=${ucDate}&minPct=${ucMinPct}`;
      const res  = await fetch(url);
      const json = await res.json();
      if (!res.ok) {
        setUcError(json.error ?? 'Fetch failed');
      } else {
        // Normalise — chartink returns {symbol, movePct, closePrice, volume},
        // bhavcopy returns same shape after the route mapping
        const raw: UCHitter[] = (json.hitters ?? []).map((h: {
          symbol: string; movePct?: number; isUCLock?: boolean;
          closePrice?: number; prevClose?: number; volume?: number;
        }) => ({
          symbol:     h.symbol,
          movePct:    h.movePct    ?? 0,
          isUCLock:   h.isUCLock   ?? false,
          closePrice: h.closePrice ?? 0,
          prevClose:  h.prevClose  ?? 0,
          volume:     h.volume     ?? 0,
        }));
        setUcHitters(raw);
        setUcFetchedDate(
          ucSource === 'chartink'
            ? 'latest trading day (Chartink)'
            : (json.date ?? ucDate)
        );
      }
    } catch {
      setUcError('Network error — could not reach the server');
    } finally {
      setUcFetching(false);
    }
  }

  function addUCHittersToSymbols(replace: boolean) {
    const syms = ucHitters.map(h => h.symbol + '.NS').join('\n');
    setSymbolText(replace ? syms : (symbolText.trim() ? symbolText.trim() + '\n' + syms : syms));
  }

  function parseSymbols(text: string): string[] {
    return text.split(/[\n,;|\t]+/)
      .map(s => s.trim().toUpperCase())
      .filter(s => s.length > 0 && s.length <= 20)
      .map(s => s.includes('.') ? s : s + '.NS');
  }

  function handleCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const lines = text.split('\n');
      const header = lines[0]?.split(',').map(h => h.trim().toLowerCase()) ?? [];
      const symIdx = header.findIndex(h => ['symbol', 'sym', 'ticker', 'stock'].includes(h));
      let syms: string[];
      if (symIdx >= 0) syms = lines.slice(1).map(l => l.split(',')[symIdx]?.trim().toUpperCase()).filter(Boolean) as string[];
      else             syms = lines.map(l => l.split(',')[0]?.trim().toUpperCase()).filter(Boolean).slice(1) as string[];
      setSymbolText(syms.map(s => s.includes('.') ? s : s + '.NS').join('\n'));
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // ── Brain V2 intelligence ────────────────────────────────────────────────────

  async function loadBrainData() {
    setBrainLoading(true);
    try {
      const res = await fetch('/api/pbfb-intelligence');
      if (res.ok) setBrainData(await res.json());
    } catch { /* silent */ }
    finally { setBrainLoading(false); }
  }

  async function saveRun() {
    if (results.length === 0 || saveState === 'saving') return;
    setSaveState('saving');
    const today = new Date().toISOString().slice(0, 10);
    const payload = {
      runDate: today,
      activeN,
      events: results.map(r => ({
        symbol:       r.symbol,
        nBefore:      r.nBefore,
        bestStage:    r.bestStage,
        bestParamSet: r.bestParamSet,
        classification: r.classification,
        anyZone:      r.anyZone,
        isUCLock:     r.isUCLock,
        movePct:      r.movePct,
        volMult:      r.volMult,
        closeLoc:        r.bestResult?.closeLoc        ?? null,
        upperWickPct:    r.bestResult?.upperWickPct    ?? null,
        bodyPct:         r.bestResult?.bodyPct         ?? null,
        exactVolRatio20: r.bestResult?.exactVolRatio20 ?? null,
        exactVolVsPre5:  r.bestResult?.exactVolVsPre5  ?? null,
        exactRangeATR14: r.bestResult?.exactRangeATR14 ?? null,
        atrPct14:        r.bestResult?.atrPct14        ?? null,
        rsi2:            r.bestResult?.rsi2            ?? null,
        pre10AvgRangeATR: r.bestResult?.pre10AvgRangeATR ?? null,
        pre10AvgVolRatio: r.bestResult?.pre10AvgVolRatio ?? null,
        zoneTightness:   r.bestResult?.zone?.zoneTightnessPct ?? null,
        zoneLen:         r.bestResult?.zone?.windowLength     ?? null,
        closePrice:      r.bestResult?.lastClose ?? null,
      })),
    };
    try {
      const res = await fetch('/api/pbfb-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setSaveState(res.ok ? 'saved' : 'error');
      if (res.ok) loadBrainData();
    } catch {
      setSaveState('error');
    }
  }

  // Feature Alignment Score — how similar is this event's candle profile
  // to the historical centroid of actionable breakouts (0–100)
  function computeFAS(r: ForensicResult): number | null {
    if (!brainData || brainData.eventCount < 10 || !r.bestResult) return null;
    const br = r.bestResult;
    const c  = brainData.centroid;
    const diffs: number[] = [];
    if (c.closeLoc > 0)     diffs.push(Math.max(0, 1 - Math.abs(br.closeLoc      - c.closeLoc)     / 50));
    if (c.bodyPct > 0)      diffs.push(Math.max(0, 1 - Math.abs(br.bodyPct       - c.bodyPct)      / 40));
    if (c.upperWickPct > 0) diffs.push(Math.max(0, 1 - Math.abs(br.upperWickPct  - c.upperWickPct) / 30));
    if (c.volRatio20 > 0)   diffs.push(Math.max(0, 1 - Math.abs(br.exactVolRatio20 - c.volRatio20) / 3));
    if (c.volPre5 > 0)      diffs.push(Math.max(0, 1 - Math.abs(br.exactVolVsPre5  - c.volPre5)    / 4));
    if (c.rangeATR > 0)     diffs.push(Math.max(0, 1 - Math.abs(br.exactRangeATR14 - c.rangeATR)   / 2));
    if (c.rsi2 > 0)         diffs.push(Math.max(0, 1 - Math.abs(br.rsi2           - c.rsi2)        / 40));
    return diffs.length > 0 ? Math.round(diffs.reduce((a, b) => a + b) / diffs.length * 100) : null;
  }

  // ── Event detection ─────────────────────────────────────────────────────────
  // Detects monster-move days: large close-to-close % OR upper circuit lock (h≈c)
  function detectEvents(candles: Candle[], symbol: string): BreakoutEvent[] {
    const evts: BreakoutEvent[] = [];
    for (let i = 60; i < candles.length - 1; i++) {
      const prev = candles[i - 1], cur = candles[i];
      if (prev.c <= 0 || cur.h <= 0) continue;
      const movePct = ((cur.c - prev.c) / prev.c) * 100;
      if (movePct < minMovePct || movePct > 25) continue;  // >25% = corporate action

      // UC lock: high ≈ close (within 0.2%), meaning no seller got through
      const isUCLock = (cur.h - cur.c) / cur.h < 0.002;

      let v20 = 0, n = 0;
      for (let j = Math.max(0, i - 20); j < i; j++) { v20 += candles[j].v; n++; }
      v20 = n > 0 ? v20 / n : 0;

      // UC-locked stocks can have lower-than-normal volume (no sellers means no trades)
      // so relax the vol filter for them: any positive volume is accepted
      const volOk = v20 > 0 && (isUCLock ? cur.v > 0 : cur.v >= v20 * minVolMult);
      if (!volOk) continue;

      let date = `row-${i}`;
      if (cur.ts) {
        const d = new Date(cur.ts * 1000);
        date = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
      }

      evts.push({ symbol, eventIdx: i, date, movePct, volMult: cur.v / v20, isUCLock, candles });
      i += 10;  // skip ahead — don't count the same multi-day run twice
    }
    return evts;
  }

  // ── Main forensic run ────────────────────────────────────────────────────────
  async function runForensic() {
    const symbols = parseSymbols(symbolText);
    if (symbols.length === 0) { setError('No symbols entered.'); return; }
    if (symbols.length > 150) { setError('Maximum 150 symbols.'); return; }
    setError('');
    setLoading(true);
    setEvents([]);
    setResults([]);
    setSaveState('idle');
    abortRef.current = false;

    // Phase 1: fetch OHLCV and detect monster-move events
    setProgress({ done: 0, total: symbols.length, phase: 'Scanning for monster-move events' });
    const allEvents: BreakoutEvent[] = [];
    for (let si = 0; si < symbols.length; si++) {
      if (abortRef.current) break;
      try {
        const { candles } = await fetchOHLCVClient(symbols[si]);
        if (candles && candles.length >= 100) allEvents.push(...detectEvents(candles, symbols[si]));
      } catch { /* skip */ }
      setProgress(p => ({ ...p, done: p.done + 1 }));
    }
    setEvents(allEvents);

    if (allEvents.length === 0) {
      setError(`No monster-move events found (≥${minMovePct}% + ≥${minVolMult}× vol, or UC lock) in the selected stocks.`);
      setLoading(false);
      return;
    }

    // Phase 2: replay all 6 param sets at each N before each event
    const Ns = Array.from({ length: maxNBefore }, (_, i) => i + 1);
    const totalWork = allEvents.length * Ns.length * PARAM_SET_KEYS.length;
    setProgress({ done: 0, total: totalWork, phase: 'Replaying screener N days before each event' });

    const allResults: ForensicResult[] = [];
    let workDone = 0;

    for (const ev of allEvents) {
      if (abortRef.current) break;
      for (const nb of Ns) {
        const cutIdx = ev.eventIdx - nb;
        // Need at least 80 candles before the cut to run a meaningful analysis
        if (cutIdx < 80) { workDone += PARAM_SET_KEYS.length; continue; }
        const truncated = ev.candles.slice(0, cutIdx + 1);

        const stages: Partial<Record<ParamSetKey, StageRating>> = {};
        let bestStage: StageRating = 'NO_SIGNAL';
        let bestParamSet: ParamSetKey | null = null;
        let bestResult: AnalysisResult | null = null;
        let anyZone = false;

        for (const key of PARAM_SET_KEYS) {
          try {
            const r = analyzeStock(truncated, key);
            stages[key] = r.stage;
            if (r.zone) anyZone = true;
            // Same tiebreak logic as analyzeStockMulti: stage rank first, inflection score second
            if (STAGE_RANK[r.stage] > STAGE_RANK[bestStage] ||
               (STAGE_RANK[r.stage] === STAGE_RANK[bestStage] && r.inflectionScore > (bestResult?.inflectionScore ?? 0))) {
              bestStage = r.stage;
              bestParamSet = key;
              bestResult = r;
            }
          } catch { stages[key] = 'NO_SIGNAL'; }
          workDone++;
          // Yield every 100 work units to keep the progress bar and UI responsive
          if (workDone % 100 === 0) {
            setProgress(p => ({ ...p, done: workDone }));
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        }

        // 4-way classification — zone_only is a new tier between on_radar and missed
        const classification: ForensicResult['classification'] =
          ACTIONABLE.has(bestStage) ? 'actionable' :
          ON_RADAR.has(bestStage)   ? 'on_radar'   :
          anyZone                   ? 'zone_only'  : 'missed';

        allResults.push({
          symbol: ev.symbol, date: ev.date, movePct: ev.movePct, volMult: ev.volMult,
          isUCLock: ev.isUCLock, nBefore: nb,
          stages, bestStage, bestParamSet, bestResult, anyZone, classification,
        });
      }
    }

    setProgress(p => ({ ...p, done: totalWork }));
    setResults(allResults);
    setActiveN(1);
    setLoading(false);
    loadBrainData();
  }

  // ── Sort + filter ────────────────────────────────────────────────────────────
  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }

  const nResults = results.filter(r => r.nBefore === activeN);
  const displayed = nResults
    .filter(r => filterClass === 'all' || r.classification === filterClass)
    .sort((a, b) => {
      let av: number | string, bv: number | string;
      if (sortKey === 'movePct')    { av = a.movePct;              bv = b.movePct; }
      else if (sortKey === 'volMult')   { av = a.volMult;              bv = b.volMult; }
      else if (sortKey === 'bestStage') { av = STAGE_RANK[a.bestStage]; bv = STAGE_RANK[b.bestStage]; }
      else                              { av = a.symbol;               bv = b.symbol; }
      if (typeof av === 'number' && typeof bv === 'number')
        return sortDir === 'desc' ? bv - av : av - bv;
      return sortDir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
    });

  // ── Analytics ────────────────────────────────────────────────────────────────
  function summaryFor(nb: number) {
    const rs = results.filter(r => r.nBefore === nb);
    return {
      total:      rs.length,
      actionable: rs.filter(r => r.classification === 'actionable').length,
      onRadar:    rs.filter(r => r.classification === 'on_radar').length,
      zoneOnly:   rs.filter(r => r.classification === 'zone_only').length,
      missed:     rs.filter(r => r.classification === 'missed').length,
    };
  }

  function bestParamStats(nb: number) {
    const rs    = results.filter(r => r.nBefore === nb);
    const actN  = rs.filter(r => ACTIONABLE.has(r.bestStage)).length;
    const counts: Partial<Record<ParamSetKey, number>> = {};
    for (const r of rs) {
      if (r.bestParamSet && ACTIONABLE.has(r.bestStage))
        counts[r.bestParamSet] = (counts[r.bestParamSet] ?? 0) + 1;
    }
    return { actN, rows: PARAM_SET_KEYS.map(k => ({ key: k, label: PARAM_SET_LABELS[k], count: counts[k] ?? 0 })).sort((a, b) => b.count - a.count) };
  }

  function moveBreakdown(nb: number) {
    const rs = results.filter(r => r.nBefore === nb);
    const buckets: [number, number, string][] = [[5, 7, '5–7%'], [7, 10, '7–10%'], [10, 15, '10–15%'], [15, 25, '15–25%']];
    return buckets.map(([lo, hi, label]) => {
      const b  = rs.filter(r => r.movePct >= lo && r.movePct < hi);
      const act = b.filter(r => ACTIONABLE.has(r.bestStage)).length;
      const onR = b.filter(r => ON_RADAR.has(r.bestStage) && !ACTIONABLE.has(r.bestStage)).length;
      const zO  = b.filter(r => r.classification === 'zone_only').length;
      return { label, total: b.length, act, onR, zO };
    }).filter(b => b.total > 0);
  }

  function stageBreakdown(nb: number) {
    const rs = results.filter(r => r.nBefore === nb);
    const total = rs.length;
    const ORDERED: StageRating[] = [
      'ULTRA_STRONG_BUY', 'STRONG_BUY', 'BUY',
      'PRE_BREAKOUT', 'EARLY_INFLECTION', 'COMPRESSION_WATCH', 'NO_SIGNAL',
    ];
    return ORDERED.map(stage => ({
      stage,
      count: rs.filter(r => r.bestStage === stage).length,
      pct:   total > 0 ? rs.filter(r => r.bestStage === stage).length / total * 100 : 0,
    }));
  }

  const symCount   = parseSymbols(symbolText).length;
  const Ns         = Array.from({ length: maxNBefore }, (_, i) => i + 1);
  const summary    = summaryFor(activeN);
  const hasResults = results.length > 0;

  const Th = ({ k, label }: { k: typeof sortKey; label: string }) => (
    <th onClick={() => toggleSort(k)}
      className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider cursor-pointer hover:text-slate-200 select-none whitespace-nowrap">
      {label}{sortKey === k ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}
    </th>
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            🔬 Post Breakout Forensic Backtest (PBFB)
          </h2>
          <p className="text-[10px] text-slate-600 mt-0.5">
            "Would my screener have caught this monster move?" — rewinds N candles before each event, replays all 6 param sets, shows exactly what the stock looked like that day.
          </p>
        </div>
        {hasResults && (
          <div className="text-[10px] text-slate-500">
            {events.length} events · {new Set(events.map(e => e.symbol)).size} stocks
          </div>
        )}
      </div>

      {/* UC Hitters Panel */}
      <div className="bg-slate-800/40 rounded-lg overflow-hidden">
        <button
          onClick={() => setUcPanelOpen(o => !o)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-700/30 transition-colors">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-amber-400">⚡ Fetch NSE Daily UC Hitters</span>
            {ucHitters.length > 0 && (
              <span className="px-1.5 py-0.5 bg-amber-900/40 border border-amber-700/40 rounded text-[9px] text-amber-300 font-mono">
                {ucHitters.length} found · {ucFetchedDate}
              </span>
            )}
          </div>
          <span className="text-[10px] text-slate-500">{ucPanelOpen ? '▲' : '▼'}</span>
        </button>

        {ucPanelOpen && (
          <div className="border-t border-slate-700/40 px-3 py-3 space-y-3">

            {/* Source toggle */}
            <div className="flex items-center gap-1 bg-slate-900/40 rounded p-0.5 w-fit">
              {([
                { key: 'chartink',  label: '📊 Chartink',     desc: 'Latest trading day · JSON · No date picker' },
                { key: 'bhavcopy',  label: '📋 NSE Bhavcopy', desc: 'Any historical date · ZIP/CSV parse' },
              ] as const).map(({ key, label, desc }) => (
                <button key={key}
                  onClick={() => { setUcSource(key); setUcHitters([]); setUcError(''); setUcFetchedDate(''); }}
                  title={desc}
                  className={`px-3 py-1 rounded text-[10px] font-semibold transition-colors ${ucSource === key ? 'bg-amber-700/60 text-amber-100 border border-amber-600' : 'text-slate-500 hover:text-slate-300'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Controls row */}
            <div className="flex items-end gap-3 flex-wrap">

              {/* Date controls — only for bhavcopy */}
              {ucSource === 'bhavcopy' && (
                <>
                  <div className="space-y-1">
                    <div className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider">Trading date</div>
                    <input
                      type="date"
                      value={ucDate}
                      onChange={e => setUcDate(e.target.value)}
                      className="bg-slate-900/60 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-slate-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider">Quick select</div>
                    <div className="flex gap-1">
                      {[
                        { label: 'Yesterday', days: 1 },
                        { label: '2d ago',    days: 2 },
                        { label: '3d ago',    days: 3 },
                        { label: '5d ago',    days: 5 },
                        { label: '1w ago',    days: 7 },
                      ].map(({ label, days }) => {
                        const d = new Date(); d.setDate(d.getDate() - days);
                        const iso = d.toISOString().slice(0, 10);
                        return (
                          <button key={days} onClick={() => setUcDate(iso)}
                            className={`px-2 py-1 rounded text-[10px] border transition-colors ${ucDate === iso ? 'bg-amber-800/50 border-amber-600 text-amber-300' : 'bg-slate-700/40 border-slate-600 text-slate-500 hover:text-slate-300'}`}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {ucSource === 'chartink' && (
                <div className="text-[10px] text-slate-500 italic self-center">
                  Runs live scan on Chartink — always returns the latest market close data
                </div>
              )}

              <div className="space-y-1">
                <div className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider">Min move %</div>
                <div className="flex items-center gap-2">
                  <input type="range" min={3} max={15} value={ucMinPct} step={1}
                    onChange={e => setUcMinPct(Number(e.target.value))}
                    className="w-20 h-1.5 rounded cursor-pointer" />
                  <span className="text-[11px] font-mono font-bold text-amber-400 w-8">≥{ucMinPct}%</span>
                </div>
              </div>

              <button
                onClick={fetchUCHitters}
                disabled={ucFetching}
                className="px-4 py-1.5 bg-amber-800/50 hover:bg-amber-800/70 disabled:opacity-40 border border-amber-600 rounded text-[11px] text-amber-100 font-semibold transition-colors">
                {ucFetching ? 'Fetching…' : '⚡ Fetch'}
              </button>

              {ucError && (
                <div className="text-[10px] text-red-400 flex-1 leading-relaxed">{ucError}</div>
              )}
            </div>

            {/* Results */}
            {ucHitters.length > 0 && (
              <div className="space-y-2">
                <div className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider">
                  {ucHitters.length} stocks · {ucFetchedDate}
                  {ucSource === 'bhavcopy' && (
                    <>
                      {' '}— {ucHitters.filter(h => h.isUCLock).length} UC locks,
                      {' '}{ucHitters.filter(h => !h.isUCLock).length} large moves
                    </>
                  )}
                  {ucSource === 'chartink' && ' — Chartink live scan'}
                </div>

                {/* Chip grid */}
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-auto pr-1">
                  {ucHitters.map(h => (
                    <div key={h.symbol}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-mono ${
                        h.isUCLock
                          ? 'bg-amber-900/30 border-amber-700/50 text-amber-200'
                          : 'bg-slate-700/40 border-slate-600/50 text-slate-300'
                      }`}>
                      {h.isUCLock && <span className="text-amber-400">⚡</span>}
                      <span className="font-semibold">{h.symbol}</span>
                      <span className={h.movePct >= 10 ? 'text-emerald-400' : 'text-emerald-500'}>
                        +{h.movePct.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 pt-1 border-t border-slate-700/30">
                  <button
                    onClick={() => addUCHittersToSymbols(false)}
                    className="px-3 py-1 bg-slate-700/60 hover:bg-slate-700 border border-slate-600 rounded text-[10px] text-slate-300 transition-colors">
                    + Add to existing
                  </button>
                  <button
                    onClick={() => addUCHittersToSymbols(true)}
                    className="px-3 py-1 bg-slate-700/60 hover:bg-slate-700 border border-slate-600 rounded text-[10px] text-slate-300 transition-colors">
                    ↺ Replace
                  </button>
                  <button
                    onClick={() => { addUCHittersToSymbols(true); setMinMovePct(ucMinPct); }}
                    className="px-3 py-1 bg-indigo-800/50 hover:bg-indigo-800/70 border border-indigo-600 rounded text-[10px] text-indigo-200 font-semibold transition-colors">
                    ↺ Replace + sync min%
                  </button>
                  <div className="ml-auto text-[9px] text-slate-600">
                    Then ▶ Run Forensic — PBFB looks N days before each move
                  </div>
                </div>
              </div>
            )}

            {!ucFetching && ucHitters.length === 0 && ucFetchedDate && !ucError && (
              <div className="text-[10px] text-slate-600 py-2">
                No stocks found with ≥{ucMinPct}% move
                {ucSource === 'bhavcopy' ? ` on ${ucFetchedDate}` : ' in latest session'}.
                Try a lower threshold{ucSource === 'bhavcopy' ? ' or a different date' : ''}.
              </div>
            )}

            <div className="text-[9px] text-slate-600 border-t border-slate-700/30 pt-2 leading-relaxed">
              {ucSource === 'chartink'
                ? 'Chartink runs a live cash-segment scan: stocks where close rose ≥ min% vs previous close. Requires Chartink to be reachable. UC lock detection happens when PBFB fetches full OHLCV for each stock.'
                : 'NSE bhavcopy: EQ series only. UC locks (high ≈ close within 0.2%) detected from bhavcopy data. Corporate actions (>25% moves) filtered out. Tries 4 URL formats + NSE API fallback.'}
            </div>
          </div>
        )}
      </div>

      {/* Input panel */}
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
              placeholder={'Paste symbols...\nRELIANCE.NS\nTCS.NS\n\nComma or newline separated'}
              rows={7}
              className="w-full bg-slate-900/60 border border-slate-700 rounded px-2 py-1.5 text-[11px] text-slate-200 font-mono resize-none focus:outline-none focus:border-slate-500"
            />
            <input ref={csvRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCSV} />
            <div className="text-[9px] text-slate-600">{symCount} symbol{symCount !== 1 ? 's' : ''} · .NS appended automatically</div>
          </div>

          {/* Controls */}
          <div className="col-span-2 grid grid-cols-2 gap-3">

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
              <div className="text-[9px] text-slate-600 text-center">Tests each N from 1→{maxNBefore} simultaneously</div>
            </div>

            <div className="bg-slate-900/40 rounded p-2.5 space-y-2">
              <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider">Monster-Move Criteria</div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-slate-400">Min close-to-close %</span>
                  <span className="text-[11px] font-mono font-bold text-emerald-400">≥{minMovePct}%</span>
                </div>
                <input type="range" min={3} max={20} value={minMovePct} step={1}
                  onChange={e => setMinMovePct(Number(e.target.value))}
                  className="w-full h-1.5 rounded cursor-pointer" />
                <div className="flex justify-between text-[9px] text-slate-700 mt-0.5">
                  <span>3% (5% UC)</span><span>20%</span>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-slate-400">Min volume × <span className="text-slate-600">(relaxed for UC locks)</span></span>
                  <span className="text-[11px] font-mono font-bold text-emerald-400">≥{minVolMult}×</span>
                </div>
                <input type="range" min={1.5} max={6} value={minVolMult} step={0.5}
                  onChange={e => setMinVolMult(Number(e.target.value))}
                  className="w-full h-1.5 rounded cursor-pointer" />
                <div className="flex justify-between text-[9px] text-slate-700 mt-0.5"><span>1.5×</span><span>6×</span></div>
              </div>
              <div className="text-[9px] text-slate-600 border-t border-slate-700/50 pt-1.5 leading-relaxed">
                Upper circuit locks (h≈c) detected automatically — volume filter relaxed since no sellers means fewer trades.
                &gt;25% moves filtered (corporate actions).
              </div>
            </div>

            <div className="col-span-2 bg-slate-900/30 rounded p-2 border border-slate-700/30">
              <div className="text-[9px] text-slate-500 leading-relaxed">
                <span className="text-slate-400 font-semibold">How it works:</span>{' '}
                Finds every genuine monster-move day (≥{minMovePct}% or UC lock).
                Rewinds N candles before each one. Runs all 6 param sets on that truncated history.
                <span className="text-cyan-500"> Click any result row</span> to see the full pre-event candle profile — close location, body/wick, zone status, and every condition that passed or failed.
              </div>
            </div>
          </div>
        </div>

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
            <button onClick={() => { setResults([]); setEvents([]); setError(''); setSaveState('idle'); }}
              className="px-3 py-1.5 bg-slate-700/40 hover:bg-slate-700 border border-slate-600 rounded text-[11px] text-slate-400 transition-colors">
              Clear
            </button>
          )}
          {hasResults && !loading && (
            <button onClick={saveRun} disabled={saveState === 'saving'}
              className={`px-3 py-1.5 border rounded text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                saveState === 'saved'  ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300' :
                saveState === 'error'  ? 'bg-red-900/40 border-red-700 text-red-300' :
                saveState === 'saving' ? 'bg-slate-700/40 border-slate-600 text-slate-400' :
                'bg-purple-900/40 hover:bg-purple-900/60 border-purple-700 text-purple-300'
              }`}>
              {saveState === 'saving' ? '💾 Saving…' :
               saveState === 'saved'  ? '✓ Saved to Brain V2' :
               saveState === 'error'  ? '✗ Save failed — retry?' :
               '🧠 Save to Brain V2'}
            </button>
          )}
          {error && <span className="text-[11px] text-red-400">{error}</span>}
        </div>

        {loading && progress.total > 0 && (
          <div className="space-y-1">
            <div className="w-full bg-slate-700/40 rounded-full h-1.5">
              <div className="bg-indigo-500 h-1.5 rounded-full transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <div className="text-[9px] text-slate-600">{progress.phase} · {progress.done} / {progress.total}</div>
          </div>
        )}
      </div>

      {/* Results */}
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

          {/* 5-card summary */}
          <div className="grid grid-cols-5 gap-2">
            {([
              { label: 'Actionable (BUY+)',   val: summary.actionable, sub: `${pct(summary.actionable, summary.total)}%`, color: '#4ade80' },
              { label: 'On Radar (stage)',     val: summary.onRadar,    sub: `${pct(summary.onRadar, summary.total)}%`,    color: '#818cf8' },
              { label: 'Zone seen, not ready', val: summary.zoneOnly,   sub: `${pct(summary.zoneOnly, summary.total)}%`,   color: '#fbbf24' },
              { label: 'Missed entirely',      val: summary.missed,     sub: `${pct(summary.missed, summary.total)}%`,     color: '#f87171' },
              { label: 'Total events',         val: summary.total,      sub: `≥${minMovePct}% or UC lock`,                 color: '#94a3b8' },
            ] as const).map((card, i) => (
              <div key={i} className="bg-slate-800/60 rounded-lg p-2.5 text-center">
                <div className="text-[9px] text-slate-500 uppercase tracking-wider mb-1 leading-tight">{card.label}</div>
                <div className="text-2xl font-bold font-mono" style={{ color: card.color }}>{card.val}</div>
                <div className="text-[9px] text-slate-600 mt-0.5">{card.sub}</div>
              </div>
            ))}
          </div>

          {/* Move breakdown + param-set hit rate */}
          <div className="grid grid-cols-2 gap-3">

            <div className="bg-slate-800/30 rounded-lg p-3">
              <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider mb-2">
                Hit rate by move size — {activeN}d before
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    <th className="text-left text-[9px] text-slate-500 pb-1">Move</th>
                    <th className="text-right text-[9px] text-slate-500 pb-1">n</th>
                    <th className="text-right text-[9px] text-slate-500 pb-1">✓ Actionable</th>
                    <th className="text-right text-[9px] text-slate-500 pb-1">~ On Radar</th>
                    <th className="text-right text-[9px] text-slate-500 pb-1">◎ Zone</th>
                  </tr>
                </thead>
                <tbody>
                  {moveBreakdown(activeN).map((b, i) => (
                    <tr key={i} className="border-b border-slate-700/20">
                      <td className="py-1 text-[11px] font-mono text-slate-300">{b.label}</td>
                      <td className="py-1 text-[10px] text-slate-500 text-right font-mono">{b.total}</td>
                      <td className="py-1 text-right font-mono font-bold text-[10px]" style={{ color: b.act > 0 ? '#4ade80' : '#475569' }}>{pct(b.act, b.total)}%</td>
                      <td className="py-1 text-right font-mono text-[10px]" style={{ color: b.onR > 0 ? '#818cf8' : '#475569' }}>{pct(b.onR, b.total)}%</td>
                      <td className="py-1 text-right font-mono text-[10px]" style={{ color: b.zO > 0 ? '#fbbf24' : '#475569' }}>{pct(b.zO, b.total)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-slate-800/30 rounded-lg p-3">
              {(() => { const { actN, rows } = bestParamStats(activeN); return (
                <>
                  <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider mb-2">
                    Which param set catches the most — {activeN}d before
                  </div>
                  {rows.map((ps, i) => (
                    <div key={i} className="flex items-center gap-2 mb-1.5">
                      <div className="w-20 text-[10px] font-mono text-slate-400">{ps.label}</div>
                      <div className="flex-1 bg-slate-700/40 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${actN > 0 ? (ps.count / actN) * 100 : 0}%` }} />
                      </div>
                      <div className="text-[10px] font-mono text-emerald-400 w-8 text-right">{ps.count}</div>
                    </div>
                  ))}
                  <div className="text-[9px] text-slate-600 mt-2 border-t border-slate-700/40 pt-1.5">
                    Count of times each param set was highest stage for actionable events
                  </div>
                </>
              ); })()}
            </div>
          </div>

          {/* Stage distribution breakdown */}
          {(() => {
            const breakdown = stageBreakdown(activeN);
            const total = breakdown.reduce((s, b) => s + b.count, 0);
            return (
              <div className="bg-slate-800/30 rounded-lg p-3">
                <div className="text-[10px] text-slate-500 uppercase font-semibold tracking-wider mb-2">
                  Best-stage distribution — {activeN}d before ({total} events)
                </div>
                {/* Stacked bar */}
                <div className="flex h-3 rounded-full overflow-hidden mb-3 gap-px">
                  {breakdown.map(b => b.pct > 0 && (
                    <div key={b.stage} title={`${stageLabel(b.stage)}: ${b.pct.toFixed(1)}%`}
                      style={{ width: `${b.pct}%`, backgroundColor: stageColor(b.stage) }} />
                  ))}
                </div>
                {/* Per-stage rows */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                  {breakdown.map(b => (
                    <div key={b.stage} className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: stageColor(b.stage) }} />
                      <div className="text-[10px] text-slate-400 w-28 truncate">{stageLabel(b.stage)}</div>
                      <div className="flex-1 bg-slate-700/40 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all"
                          style={{ width: `${b.pct}%`, backgroundColor: stageColor(b.stage) }} />
                      </div>
                      <div className="text-[10px] font-mono w-10 text-right" style={{ color: b.count > 0 ? stageColor(b.stage) : '#475569' }}>
                        {b.pct.toFixed(1)}%
                      </div>
                      <div className="text-[9px] font-mono text-slate-600 w-5 text-right">{b.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Brain V2 Intelligence Panel */}
          {brainLoading && !brainData && (
            <div className="text-[10px] text-slate-600 italic px-1">🧠 Loading Brain V2 intelligence…</div>
          )}
          {brainData && brainData.eventCount >= 10 && (
            <div className="bg-slate-800/30 rounded-lg p-3 border border-purple-900/40">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-purple-300">🧠 Brain V2 Intelligence</span>
                  <span className="text-[10px] text-slate-500">
                    {brainData.eventCount} events · {brainData.runCount} runs
                  </span>
                  {brainData.lastRunDate && (
                    <span className="px-1.5 py-0.5 bg-purple-900/30 border border-purple-800/50 rounded text-[9px] text-purple-400 font-mono">
                      last saved {brainData.lastRunDate}
                    </span>
                  )}
                </div>
                <div className="text-[9px] text-slate-600">
                  {brainData.actionableCount} actionable detected ({(brainData.overallDetectionRate * 100).toFixed(1)}% rate)
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {/* Detection rate vs current */}
                <div>
                  <div className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider mb-2">Detection Rate</div>
                  <div className="flex items-baseline gap-1.5 mb-1">
                    <span className="text-2xl font-bold font-mono" style={{ color: '#a855f7' }}>
                      {(brainData.overallDetectionRate * 100).toFixed(1)}%
                    </span>
                    <span className="text-[9px] text-slate-600">historical avg</span>
                  </div>
                  {summary.total > 0 && (() => {
                    const curRate = summary.actionable / summary.total;
                    const delta   = curRate - brainData.overallDetectionRate;
                    return (
                      <div className="text-[10px]">
                        <span className="text-slate-500">This run: </span>
                        <span className="font-mono font-bold" style={{ color: delta >= 0 ? '#4ade80' : '#f87171' }}>
                          {(curRate * 100).toFixed(1)}%
                        </span>
                        <span className="ml-1 text-[9px]" style={{ color: delta >= 0 ? '#4ade80' : '#f87171' }}>
                          {delta >= 0 ? `↑ +${(delta * 100).toFixed(1)}pp above` : `↓ ${(delta * 100).toFixed(1)}pp below`} avg
                        </span>
                      </div>
                    );
                  })()}
                  <div className="mt-3 text-[9px] text-slate-500 uppercase font-semibold tracking-wider mb-1.5">Top Feature Lifts</div>
                  {brainData.featureLifts.map((fl, i) => (
                    <div key={i} className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] text-slate-500 flex-1">{fl.label}</span>
                      <div className="w-12 bg-slate-700/40 rounded-full h-1">
                        <div className="h-1 rounded-full bg-purple-500" style={{ width: `${Math.min(100, (fl.lift - 1) * 50)}%` }} />
                      </div>
                      <span className="text-[9px] font-mono text-purple-300 w-10 text-right">
                        {fl.lift.toFixed(1)}×
                      </span>
                    </div>
                  ))}
                </div>

                {/* Stage distribution in historical data */}
                <div>
                  <div className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider mb-2">Historical Stage Mix</div>
                  {(['ULTRA_STRONG_BUY', 'STRONG_BUY', 'BUY', 'PRE_BREAKOUT', 'EARLY_INFLECTION', 'COMPRESSION_WATCH', 'NO_SIGNAL'] as StageRating[]).map(s => {
                    const count = brainData.stageHitCounts[s] ?? 0;
                    if (count === 0) return null;
                    const pctVal = brainData.eventCount > 0 ? count / brainData.eventCount * 100 : 0;
                    return (
                      <div key={s} className="flex items-center gap-1.5 mb-1">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: stageColor(s) }} />
                        <span className="text-[9px] text-slate-500 w-24 truncate">{stageLabel(s)}</span>
                        <div className="flex-1 bg-slate-700/40 rounded-full h-1">
                          <div className="h-1 rounded-full transition-all" style={{ width: `${pctVal}%`, backgroundColor: stageColor(s) }} />
                        </div>
                        <span className="text-[9px] font-mono text-slate-500 w-12 text-right">{count} ({pctVal.toFixed(0)}%)</span>
                      </div>
                    );
                  })}
                </div>

                {/* Actionable centroid — what a "caught" breakout looks like */}
                <div>
                  <div className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider mb-2">
                    Avg Actionable Profile ({brainData.actionableCount} events)
                  </div>
                  {[
                    { label: 'Close location', val: `${f1(brainData.centroid.closeLoc)}%` },
                    { label: 'Body %',         val: `${f1(brainData.centroid.bodyPct)}%` },
                    { label: 'Upper wick',     val: `${f1(brainData.centroid.upperWickPct)}%` },
                    { label: 'Vol / 20d avg',  val: `${f2(brainData.centroid.volRatio20)}×` },
                    { label: 'Vol / Pre-5',    val: `${f2(brainData.centroid.volPre5)}×` },
                    { label: 'Range / ATR',    val: f2(brainData.centroid.rangeATR) },
                    { label: 'RSI-2',          val: f1(brainData.centroid.rsi2) },
                    { label: 'Zone length',    val: `${f0(brainData.centroid.zoneLen)} candles` },
                    { label: 'Zone tightness', val: `${f1(brainData.centroid.zoneTightness)}%` },
                  ].map(({ label, val }) => (
                    <div key={label} className="flex justify-between items-center border-b border-slate-700/20 py-0.5">
                      <span className="text-[9px] text-slate-600">{label}</span>
                      <span className="font-mono text-[9px] font-semibold text-purple-300">{val}</span>
                    </div>
                  ))}
                  <div className="mt-2 text-[8px] text-slate-700 leading-relaxed">
                    Compare your current events' 🧠 FAS score to see how close they match this profile.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Event table with expandable rows */}
          <div className="bg-slate-800/30 rounded-lg overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-700/50">
              <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                {activeN}d before · {displayed.length} event{displayed.length !== 1 ? 's' : ''}
              </div>
              <div className="flex gap-1 ml-auto">
                {(['all', 'actionable', 'on_radar', 'zone_only', 'missed'] as const).map(fc => (
                  <button key={fc} onClick={() => setFilterClass(fc)}
                    className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${filterClass === fc ? 'bg-slate-600 border-slate-500 text-slate-200' : 'bg-transparent border-slate-700 text-slate-500 hover:text-slate-300'}`}
                    style={filterClass === fc && fc !== 'all' ? { borderColor: classColor(fc), color: classColor(fc) } : {}}>
                    {fc === 'all' ? 'All' : fc === 'actionable' ? '✓ Actionable' : fc === 'on_radar' ? '~ On Radar' : fc === 'zone_only' ? '◎ Zone Only' : '✗ Missed'}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-auto max-h-[560px]">
              <table className="w-full border-collapse">
                <thead className="sticky top-0 bg-slate-800/95">
                  <tr className="border-b border-slate-700/50">
                    <Th k="symbol" label="Symbol" />
                    <th className="px-2 py-1.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Event Date</th>
                    <Th k="movePct" label="Move %" />
                    <Th k="volMult" label="Vol ×" />
                    <Th k="bestStage" label="Best Stage" />
                    <th className="px-2 py-1.5 text-center text-[10px] font-semibold text-purple-400 uppercase tracking-wider" title="Feature Alignment Score — how closely this event's candle profile matches the historical actionable centroid (Brain V2)">🧠 DNA</th>
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
                  {displayed.map(r => {
                    const rowKey    = `${r.symbol}-${r.date}-${r.nBefore}`;
                    const isExpanded = expanded === rowKey;
                    return (
                      <Fragment key={rowKey}>
                        <tr
                          onClick={() => setExpanded(isExpanded ? null : rowKey)}
                          className={`border-b border-slate-700/20 cursor-pointer text-[11px] transition-colors
                            ${isExpanded ? 'bg-slate-800/80' :
                              r.classification === 'actionable' ? 'hover:bg-emerald-900/10' :
                              r.classification === 'on_radar'   ? 'hover:bg-indigo-900/10'  :
                              r.classification === 'zone_only'  ? 'hover:bg-amber-900/10'   :
                                                                  'hover:bg-slate-700/10'}`}>
                          <td className="px-2 py-1.5 font-mono font-semibold text-slate-200">
                            {r.symbol.replace('.NS', '').replace('.BO', '')}
                            {r.isUCLock && <span className="ml-1 text-[8px] text-amber-500">⚡UC</span>}
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
                          <td className="px-2 py-1.5 text-center">
                            {(() => {
                              const fas = computeFAS(r);
                              if (fas == null) return <span className="text-slate-700 text-[9px]">—</span>;
                              const col = fas >= 75 ? '#4ade80' : fas >= 50 ? '#facc15' : '#64748b';
                              return (
                                <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded"
                                  style={{ color: col, background: `${col}14`, border: `1px solid ${col}33` }}
                                  title={`Feature Alignment Score: ${fas.toFixed(0)}/100 vs historical actionable profile`}>
                                  {fas.toFixed(0)}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-2 py-1.5 text-[10px] text-slate-400 font-mono">
                            {r.bestParamSet ? PARAM_SET_LABELS[r.bestParamSet] : '—'}
                          </td>
                          {PARAM_SET_KEYS.map(k => {
                            const s = r.stages[k] ?? 'NO_SIGNAL';
                            const isNS = s === 'NO_SIGNAL';
                            return (
                              <td key={k} className="px-1.5 py-1.5 text-center">
                                {isNS
                                  ? <span className="text-[9px] text-slate-600">—</span>
                                  : <span className="px-1 py-0.5 rounded text-[8px] font-semibold whitespace-nowrap"
                                      style={{ color: stageColor(s), background: stageBg(s), border: `1px solid ${stageColor(s)}40` }}>
                                      {stageLabel(s)}
                                    </span>
                                }
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5">
                            <span className="text-[10px] font-semibold" style={{ color: classColor(r.classification) }}>
                              {r.classification === 'actionable' ? '✓ Caught' :
                               r.classification === 'on_radar'   ? '~ On Radar' :
                               r.classification === 'zone_only'  ? '◎ Zone Only' : '✗ Missed'}
                            </span>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-slate-900/40">
                            <td colSpan={7 + PARAM_SET_KEYS.length + 1} className="p-0">
                              <ExpandedDetail r={r} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>

              {displayed.length === 0 && (
                <div className="text-center py-6 text-[11px] text-slate-600">No events match the current filter.</div>
              )}
            </div>

            <div className="px-3 py-2 border-t border-slate-700/30 flex items-center gap-4 text-[9px] text-slate-600">
              <span>● Actionable (BUY+)</span>
              <span>◐ On Radar (pre/early/compression)</span>
              <span>◎ Zone seen</span>
              <span>○ Missed</span>
              <span className="ml-auto text-slate-700">Click row for pre-event detail · Sort: {sortKey} {sortDir}</span>
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
            Paste stocks that had monster moves — upper circuits, 10%+ days, anything surprising.
            PBFB rewinds to N days before each move and asks: <span className="text-slate-400">"Was my screener already watching this?"</span>
            <br/><br/>
            Click any result row to see the full pre-event candle profile — price, zone, body/wick, volume,
            RSI, and every condition that passed or failed across all 6 param sets.
          </div>
        </div>
      )}
    </div>
  );
}
