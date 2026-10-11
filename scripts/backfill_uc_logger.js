'use strict';
// backfill_uc_logger.js — rebuild pbfb_uc_logger history from Yahoo daily candles.
// Mirrors the live logger in app/page.tsx: analyzeStock(optimized_deployable_20plus), Nifty 5d regime
// multiplier, RS63 stage modifier, VF/EMA RS gates, ucScore >= 58, locked-candle nulling.
// Each row is labelled from the next bar (next_day_chg_pct etc.) and tagged source='backfill'.
// Existing rows (live logs) are never overwritten.
//
// Usage: node scripts/backfill_uc_logger.js [--days=120] [--dry] [--limit=50]

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ROOT       = path.join(__dirname, '..');
const ENGINE_DIR = path.join(__dirname, '_compiled_current');
const UC_GATE    = 58;
const WINDOW     = 300;
const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Referer: 'https://finance.yahoo.com/',
};
const BAYES_WR = { CompressionCoil: 0.67, VolumeFootprint: 0.81, MomentumPocket: 0.90, EMAStack: 0.78, CircuitBreaker: 0.78, PerfectStorm: 0.75 };
const TIER_DOWN = {
  ULTRA_STRONG_BUY: 'STRONG_BUY', STRONG_BUY: 'BUY', BUY: 'PRE_BREAKOUT', PRE_BREAKOUT: 'EARLY_INFLECTION',
  EARLY_INFLECTION: 'COMPRESSION_WATCH', COMPRESSION_WATCH: 'NO_SIGNAL', NO_SIGNAL: 'NO_SIGNAL',
};

const istDate = ts => new Date((ts + 19800) * 1000).toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchCandles(sym) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const host = attempt % 2 ? 'query2.finance.yahoo.com' : 'query1.finance.yahoo.com';
    try {
      const r = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y`, { headers: YF_HEADERS, signal: AbortSignal.timeout(15000) });
      if (r.status === 404) return null;
      if (!r.ok) { await sleep(800 * (attempt + 1)); continue; }
      const res = (await r.json())?.chart?.result?.[0];
      if (!res?.timestamp) return null;
      const q = res.indicators.quote[0], out = [];
      for (let i = 0; i < res.timestamp.length; i++) {
        if (q.close[i] == null || q.high[i] == null || q.low[i] == null || q.open[i] == null) continue;
        out.push({ ts: res.timestamp[i], o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 });
      }
      return out;
    } catch { await sleep(800 * (attempt + 1)); }
  }
  return null;
}

// ─── Worker ──────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const eng = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const { getSectorTag } = require(path.join(ENGINE_DIR, 'lib', 'signals.js'));
  const { symbols, nifty, days } = workerData;
  const niftyIdx = new Map(nifty.map((k, i) => [istDate(k.ts), i]));

  (async () => {
    const rows = []; let fetched = 0, failed = 0;
    for (const sym of symbols) {
      const c = await fetchCandles(sym + '.NS');
      if (!c || c.length < WINDOW + 2) { failed++; continue; }
      fetched++;
      const start = Math.max(WINDOW - 1, c.length - 1 - days);
      for (let i = start; i <= c.length - 2; i++) {
        const scanDate = istDate(c[i].ts);
        const ni = niftyIdx.get(scanDate);
        if (ni == null || ni < 64) continue;
        let r;
        try { r = eng.analyzeStock(c.slice(i - WINDOW + 1, i + 1), 'optimized_deployable_20plus'); } catch { continue; }
        if (!r || r.ucScore == null) continue;

        const nw = nifty.slice(ni - 64, ni + 1), sw = c.slice(Math.max(0, i - 64), i + 1);
        const rs20 = eng.computeRSvsNifty(sw, nw, 20);
        const rs63 = eng.computeRSvsNifty(sw, nw, 63);
        let stage = r.stage;
        if (Number.isFinite(rs63)) {
          if (rs63 >= 1.15 && stage === 'EARLY_INFLECTION') stage = 'PRE_BREAKOUT';
          else if (rs63 < 0.75 && stage !== 'NO_SIGNAL') stage = TIER_DOWN[stage];
        }
        const rs = Number.isFinite(rs20) ? rs20 : 1.0;
        if (r.archetypeType === 'VolumeFootprint' && stage === 'PRE_BREAKOUT' && rs < 1.05) continue;
        if (r.archetypeType === 'EMAStack' && rs < 1.0) continue;

        const ret5d = (nifty[ni].c - nifty[ni - 5].c) / nifty[ni - 5].c * 100;
        const mult = ret5d > 2 ? 1.10 : ret5d < -2 ? 0.85 : 1.0;
        const uc = mult !== 1.0 ? Math.min(100, Math.round(r.ucScore * mult)) : r.ucScore;
        if (uc < UC_GATE) continue;

        const nx = c[i + 1];
        const chg = (nx.c / c[i].c - 1) * 100;
        const locked = r.bodyPct === 0 && r.upperWickPct === 0;
        const st = r.stats || {};
        rows.push({
          symbol: sym, scan_date: scanDate, source: 'backfill',
          uc_score: uc, uc_elite: !!r.ucElite, uc_strong: !!r.ucStrong, uc_goldmine: !!r.ucGoldmine,
          close_loc: r.closeLoc ?? null,
          rsi2: locked ? null : r.rsi2 ?? null,
          body_pct: locked ? null : r.bodyPct ?? null,
          upper_wick_pct: locked ? null : r.upperWickPct ?? null,
          vol_ratio_20: r.volRatio20 ?? null, vol_pre5: r.exactVolVsPre5 ?? null, range_atr: r.exactRangeATR14 ?? null,
          stage, sector: getSectorTag(sym), morph_type: r.morphType ?? null,
          day_chg_pct: r.dayChangePct ?? null, inflection_score: r.inflectionScore ?? null,
          cl_trend: r.clTrend ?? null, rsi2_velocity: r.rsi2Velocity ?? null,
          guppy_spread_pct: st.guppySpreadPct < 99 ? st.guppySpreadPct : null,
          guppy_compressed: st.guppyCompressed ?? null, guppy_ultra_compressed: st.guppyUltraCompressed ?? null,
          guppy_compress_days: st.guppyCompressDays > 0 ? st.guppyCompressDays : null,
          guppy_primed: st.guppyPrimed ?? null, guppy_coiled_release: st.guppyCoiledRelease ?? null,
          guppy_clean_bullish_fan: st.guppyCleanBullishFan ?? null, guppy_group_gap_pct: st.guppyGroupGapPct ?? null,
          candle_dna_score: r.candleDNA?.score ?? null, candle_dna_tier: r.candleDNA?.tier ?? null,
          near_breakout_tier: r.nearBreakoutTier ?? null, near_breakout_pct: r.nearBreakoutPct < 99 ? r.nearBreakoutPct : null,
          archetype_type: r.archetypeType ?? null, bayes_wr: BAYES_WR[r.archetypeType ?? ''] ?? null,
          stats_score: st.statsScore ?? null, momentum_score: r.momentum?.momentumScore ?? null, rs_nifty20: rs,
          volatility_expansion_ratio: r.volatilityExpansionRatio > 0 ? r.volatilityExpansionRatio : null,
          ultra_precision_score: r.ultraPrecisionScore > 0 ? r.ultraPrecisionScore : null,
          next_day_chg_pct: Number(chg.toFixed(3)),
          hit_uc_next_day: chg >= 4.9 && nx.c >= nx.h * 0.999,
          hit_5pct_3d: chg >= 5, hit_10pct_5d: chg >= 10,
          uc_classification: 'backfill_proxy',
          labeled_at: new Date().toISOString(),
        });
      }
    }
    parentPort.postMessage({ rows, fetched, failed });
  })();
  return;
}

// ─── Main ────────────────────────────────────────────────────────────────────
(async function main() {
  const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
  const DAYS = Number(arg('days', 120)), LIMIT = Number(arg('limit', 0)), DRY = process.argv.includes('--dry');
  const env = {};
  for (const l of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/); if (m) env[m[1]] = m[2].trim();
  }
  const URL = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) throw new Error('Supabase URL / service key missing in .env.local');

  const { NIFTY_PRESETS } = require(path.join(ENGINE_DIR, 'lib', 'niftyPresets.js'));
  let symbols = NIFTY_PRESETS.find(p => p.key === 'clean_nse_2026').symbols;
  if (LIMIT) symbols = symbols.slice(0, LIMIT);
  const nifty = await fetchCandles('^NSEI');
  if (!nifty) throw new Error('Nifty fetch failed');
  console.log(`target ${URL.split('//')[1].split('.')[0]} | ${symbols.length} symbols | last ${DAYS} trading days | Nifty to ${istDate(nifty[nifty.length - 1].ts)}${DRY ? ' | DRY RUN' : ''}`);

  const N = Number(process.env.WORKERS || Math.min(3, os.cpus().length));
  const chunks = Array.from({ length: N }, () => []);
  symbols.forEach((s, i) => chunks[i % N].push(s));
  const t0 = Date.now();
  const results = await Promise.all(chunks.map(ch => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { symbols: ch, nifty, days: DAYS } });
    w.on('message', res); w.on('error', rej);
  })));
  const rows = results.flatMap(r => r.rows);
  console.log(`fetched ${results.reduce((a, r) => a + r.fetched, 0)} / failed ${results.reduce((a, r) => a + r.failed, 0)} | ${rows.length} rows | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const pos = rows.filter(r => r.next_day_chg_pct >= 5).length;
  const dates = [...new Set(rows.map(r => r.scan_date))].sort();
  console.log(`dates ${dates[0]} → ${dates[dates.length - 1]} (${dates.length}) | next-day ≥5%: ${pos} (${(pos / Math.max(rows.length, 1) * 100).toFixed(1)}%) | UC proxy: ${rows.filter(r => r.hit_uc_next_day).length}`);
  if (DRY) return;

  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const r = await fetch(`${URL}/rest/v1/pbfb_uc_logger?on_conflict=symbol,scan_date`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) throw new Error(`upsert ${r.status}: ${(await r.text()).slice(0, 300)}`);
    written += chunk.length;
  }
  console.log(`written ${written} rows (existing live rows untouched)`);
})().catch(e => { console.error(e.message); process.exit(1); });
