'use strict';
/**
 * ideaBacktest2.js — Round 2: targeted tests based on Round 1 findings
 *
 * Phase 1 (workers): scan all 1616 files → per-date market breadth
 *                    regime = true when >50% of stocks above EMA50
 *
 * Phase 2 (workers): 3 test scenarios using compiled engine + regime
 *
 *   B1: ORS-Prime + ≥1 other archetype on same bar
 *       (ORS is our 66.7% baseline — confluence partner should push higher)
 *
 *   B2: Regime filter on all 6 archetypes (per-archetype results)
 *       (market-breadth uptrend filter applied to existing signals)
 *
 *   B3: Confluence ≥3 archetypes agree on same bar
 *       (stricter version of A4 which was 52.6% at ≥2)
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { analyzeStock } = require('./_compiled_current/stockEngine.js');

const WINDOW     = 300;
const MAX_HOLD   = 20;
const TARGET_PCT = 5.0;
const OOS_DATE   = '2025-05-05';
const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORKERS  = 10;
const MIN_TURN   = 5_000_000;

const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  'ors_prime_reversal',
];
const PS_LABELS = {
  'optimized_deployable_20plus':    'VolumeFootprint',
  'optimized_highprecision_15plus': 'CompressionCoil',
  'optimized_elite_10plus':         'MomentumPocket',
  'optimized_ultraselective_8plus': 'EMAStack',
  'sniper_95plus':                  'PerfectStorm',
  'ors_prime_reversal':             'ORS-Prime',
};
const BUY_STAGES = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);

const PHASE2_BUCKETS = [
  'B1_ors_plus', 'B3_conf3',
  'B2_VolumeFootprint','B2_CompressionCoil','B2_MomentumPocket',
  'B2_EMAStack','B2_PerfectStorm','B2_ORS-Prime',
];

// ── Date helpers ──────────────────────────────────────────────────────────────
const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseNSEDate(s) {
  s = s.trim();
  if (s.includes('-')) {
    const p = s.split('-');
    if (p[0].length === 4) return Date.UTC(+p[0],+p[1]-1,+p[2]);
    const m = MON[p[1]];
    if (m !== undefined) return Date.UTC(+p[2],m,+p[0]);
  }
  const d = new Date(s); return isNaN(d.getTime()) ? 0 : d.getTime();
}
function parseNSE(fp) {
  const lines = fs.readFileSync(fp,'utf8').trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6) continue;
    const c = +p[4]; if (!c || c <= 0) continue;
    out.push({ ts:parseNSEDate(p[0]), o:+p[1], h:+p[2], l:+p[3], c, v:+p[5]||0 });
  }
  return out;
}

// ── EMA helper ────────────────────────────────────────────────────────────────
function buildEMA(closes, period) {
  const k = 2 / (period + 1);
  const out = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  out[period - 1] = sum / period;
  for (let i = period; i < closes.length; i++)
    out[i] = closes[i] * k + out[i-1] * (1 - k);
  return out;
}

// ── Trade simulator ───────────────────────────────────────────────────────────
function simulate(candles, sigIdx, rawStop) {
  const eIdx = sigIdx + 1;
  if (eIdx >= candles.length - 1) return null;
  const ep = candles[eIdx].o;
  if (!ep || ep <= 0) return null;
  const floorStop = ep * (1 - 3.5/100);
  const capStop   = ep * (1 - 6.5/100);
  const stop      = Math.min(floorStop, Math.max(capStop, rawStop));
  const target    = ep * (1 + TARGET_PCT/100);
  let hitTarget = false, hitStop = false, barsToTarget = null, mfe = 0, mae = 0;
  for (let b = 1; b <= MAX_HOLD; b++) {
    const idx = eIdx + b; if (idx >= candles.length) break;
    const bar = candles[idx];
    const barH = (bar.h - ep) / ep * 100; if (barH > mfe) mfe = barH;
    if (!hitTarget) { const barL = (ep - bar.l) / ep * 100; if (barL > mae) mae = barL; }
    if (bar.l <= stop) { hitStop = true; break; }
    if (bar.h >= target) { hitTarget = true; barsToTarget = b; break; }
  }
  const riskPct = (ep - stop) / ep * 100;
  return { hitTarget, hitStop, barsToTarget, riskPct,
    pnl: hitTarget ? TARGET_PCT : (hitStop ? -riskPct : 0),
    mfe, mae: hitTarget ? mae : null };
}

function avgTurn(candles, i) {
  let s = 0, n = 0;
  for (let j = Math.max(0, i - 20); j < i; j++) { s += candles[j].c * candles[j].v; n++; }
  return n > 0 ? s/n : 0;
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function aggregate(trades) {
  if (!trades.length) return null;
  const n = trades.length;
  const W = trades.filter(t => t.hitTarget);
  const L = trades.filter(t => t.hitStop && !t.hitTarget);
  const gW = W.length * TARGET_PCT, gL = L.reduce((s,t)=>s+t.riskPct,0);
  const pf = gL > 0 ? gW/gL : (gW > 0 ? 999 : 0);
  const mfes = trades.map(t=>t.mfe).sort((a,b)=>a-b);
  const medMFE = mfes[Math.floor(mfes.length/2)]??0;
  const maesW = W.filter(t=>t.mae!==null).map(t=>t.mae);
  const avgMAE = maesW.length ? maesW.reduce((a,b)=>a+b,0)/maesW.length : 0;
  const days = W.filter(t=>t.barsToTarget!==null).map(t=>t.barsToTarget);
  const avgDays = days.length ? days.reduce((a,b)=>a+b,0)/days.length : 0;
  return { n,
    hit5:   (W.length/n*100).toFixed(1),
    pf:     pf.toFixed(2),
    avgPnl: (trades.reduce((s,t)=>s+t.pnl,0)/n).toFixed(2),
    medMFE: medMFE.toFixed(2),
    avgMAE: avgMAE.toFixed(2),
    avgDays:avgDays.toFixed(1),
    avgRisk:(trades.reduce((s,t)=>s+t.riskPct,0)/n).toFixed(2) };
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER
// ─────────────────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { phase, files, oosTs, regimeMap } = workerData;

  // ── Phase 1: compute per-date market breadth ─────────────────────────────
  if (phase === 1) {
    // Returns: { [ts]: { above: N, total: N } }
    const dateCounts = {};
    for (const fp of files) {
      const candles = parseNSE(fp);
      if (candles.length < 50) continue;
      const ema50 = buildEMA(candles.map(c=>c.c), 50);
      for (let i = 49; i < candles.length; i++) {
        const ts = candles[i].ts;
        const above = (ema50[i] !== null && candles[i].c > ema50[i]) ? 1 : 0;
        if (!dateCounts[ts]) dateCounts[ts] = { above: 0, total: 0 };
        dateCounts[ts].above += above;
        dateCounts[ts].total++;
      }
    }
    parentPort.postMessage(dateCounts);
    process.exit(0);
  }

  // ── Phase 2: run B1, B2, B3 tests ────────────────────────────────────────
  const buckets = {};
  for (const k of PHASE2_BUCKETS) buckets[k] = { all: [], oos: [] };

  // non-overlapping trackers per test per symbol
  for (const fp of files) {
    const candles = parseNSE(fp);
    if (candles.length < WINDOW + MAX_HOLD + 5) continue;

    const lastTrade = {};
    for (const k of PHASE2_BUCKETS) lastTrade[k] = -1;

    for (let i = WINDOW; i < candles.length - MAX_HOLD - 2; i++) {
      if (avgTurn(candles, i) < MIN_TURN) continue;

      const ts     = candles[i].ts;
      const isOOS  = ts >= oosTs;
      const inBull = regimeMap[ts] === true;

      // Run all 6 archetypes once — share results across B1/B2/B3
      const slice = candles.slice(0, i + 1);
      const fires = []; // { ps, label, stop }
      let orsStop = null;
      let orsLabel = 'ors_prime_reversal';

      for (const ps of PARAM_SETS) {
        try {
          const r = analyzeStock(slice, ps);
          if (r && BUY_STAGES.has(r.stage)) {
            const stop = r.tacticalPlan?.stop ?? r.priceEngine?.stop ?? candles[i].c * 0.95;
            fires.push({ ps, label: PS_LABELS[ps], stop });
            if (ps === 'ors_prime_reversal') orsStop = stop;
          }
        } catch {}
      }

      const orsFired = fires.some(f => f.ps === 'ors_prime_reversal');
      const count    = fires.length;

      // ── B1: ORS-Prime + ≥1 other archetype ────────────────────────────
      if (i > lastTrade['B1_ors_plus'] && orsFired && count >= 2) {
        const trade = simulate(candles, i, orsStop ?? fires[0].stop);
        if (trade) {
          lastTrade['B1_ors_plus'] = i + 1 + (trade.barsToTarget ?? MAX_HOLD);
          buckets['B1_ors_plus'].all.push(trade);
          if (isOOS) buckets['B1_ors_plus'].oos.push(trade);
        }
      }

      // ── B2: per-archetype with regime filter ───────────────────────────
      if (inBull) {
        for (const { ps, label, stop } of fires) {
          const key = `B2_${label}`;
          if (i > lastTrade[key]) {
            const trade = simulate(candles, i, stop);
            if (trade) {
              lastTrade[key] = i + 1 + (trade.barsToTarget ?? MAX_HOLD);
              buckets[key].all.push(trade);
              if (isOOS) buckets[key].oos.push(trade);
            }
          }
        }
      }

      // ── B3: confluence ≥3 archetypes ──────────────────────────────────
      if (i > lastTrade['B3_conf3'] && count >= 3) {
        const trade = simulate(candles, i, fires[0].stop);
        if (trade) {
          lastTrade['B3_conf3'] = i + 1 + (trade.barsToTarget ?? MAX_HOLD);
          buckets['B3_conf3'].all.push(trade);
          if (isOOS) buckets['B3_conf3'].oos.push(trade);
        }
      }
    }
  }

  parentPort.postMessage(buckets);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
const allFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv') && f !== 'ALL_SYMBOLS_OHLCV.csv')
  .map(f => path.join(DATA_DIR, f));
const oosTs = parseNSEDate(OOS_DATE);
const chunks = Array.from({ length: N_WORKERS }, (_, i) =>
  allFiles.filter((_, j) => j % N_WORKERS === i));

function runWorkers(phase, extra = {}) {
  const combined = {};
  let done = 0;
  return Promise.all(chunks.map(files => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { phase, files, oosTs, ...extra } });
    w.on('message', data => {
      // merge data into combined
      for (const [k, v] of Object.entries(data)) {
        if (!combined[k]) combined[k] = { above: 0, total: 0, all: [], oos: [] };
        if (phase === 1) {
          combined[k].above = (combined[k].above||0) + v.above;
          combined[k].total = (combined[k].total||0) + v.total;
        } else {
          combined[k].all.push(...(v.all||[]));
          combined[k].oos.push(...(v.oos||[]));
        }
      }
      done += files.length;
      process.stdout.write(`  Phase ${phase}: ${done}/${allFiles.length}\r`);
      resolve();
    });
    w.on('error', reject);
  }))).then(() => { process.stdout.write('\n'); return combined; });
}

(async () => {
  // ── Phase 1: compute regime ──────────────────────────────────────────────
  process.stdout.write('\nPhase 1: computing market regime breadth...\n');
  const breadthRaw = await runWorkers(1);

  // Build regime map: date → true if >50% of stocks above EMA50
  const regimeMap = {};
  let bullDays = 0, bearDays = 0;
  for (const [ts, { above, total }] of Object.entries(breadthRaw)) {
    regimeMap[+ts] = total > 0 && above / total > 0.50;
    if (regimeMap[+ts]) bullDays++; else bearDays++;
  }
  const totalDays = bullDays + bearDays;
  process.stdout.write(`  Regime computed: ${bullDays}/${totalDays} bull days (${(bullDays/totalDays*100).toFixed(1)}%), ${bearDays} bear days\n`);

  // ── Phase 2: run tests ───────────────────────────────────────────────────
  process.stdout.write('Phase 2: running B1/B2/B3 tests...\n');
  const results = await runWorkers(2, { regimeMap });

  // ── Output ───────────────────────────────────────────────────────────────
  const ts = new Date().toISOString();
  const lines = [];
  const pr = s => { lines.push(s); process.stdout.write(s + '\n'); };

  pr(`\n${'═'.repeat(112)}`);
  pr(`Round 2 Idea Backtest   ${ts}`);
  pr(`Universe: ${allFiles.length} NIFTY ALL | OOS cutoff: ${OOS_DATE} | Target: +5% | MaxHold: ${MAX_HOLD} bars | MinTurn: 5M`);
  pr(`Market regime: >50% stocks above EMA50 | Bull days: ${bullDays}/${totalDays} (${(bullDays/totalDays*100).toFixed(1)}%)`);
  pr(`${'═'.repeat(112)}`);

  pr(`\nBaseline (no filters, OOS):`);
  pr(`  VF 47.9% PF=0.85 | CC 44.3% | MP 43.8% | EMA 40.9% | PS 52.6% PF=1.12 | ORS 66.7% PF=1.62`);
  pr(`  Confluence ≥2 (Round1 A4): OOS n=38  Hit5=52.6%  PF=1.18`);

  // B1
  pr(`\n${'─'.repeat(112)}`);
  pr(`B1: ORS-Prime + ≥1 other archetype on same bar`);
  {
    const full = aggregate(results['B1_ors_plus']?.all || []);
    const oos  = aggregate(results['B1_ors_plus']?.oos || []);
    pr(`  Full: ${full ? `n=${full.n}  Hit5=${full.hit5}%  PF=${full.pf}  AvgP&L=${full.avgPnl>0?'+':''}${full.avgPnl}%  MedMFE=${full.medMFE}%  AvgMAE=-${full.avgMAE}%  AvgDays=${full.avgDays}` : 'no signals'}`);
    pr(`  OOS:  ${oos  ? `n=${oos.n}   Hit5=${oos.hit5}%  PF=${oos.pf}  AvgP&L=${oos.avgPnl>0?'+':''}${oos.avgPnl}%  MedMFE=${oos.medMFE}%  AvgMAE=-${oos.avgMAE}%  AvgDays=${oos.avgDays}` : 'no signals'}`);
    if (full && oos) pr(`  IS→OOS: ${(parseFloat(oos.hit5)-parseFloat(full.hit5)).toFixed(1)}pp`);
  }

  // B2
  pr(`\n${'─'.repeat(112)}`);
  pr(`B2: Per-archetype with market regime filter (only trade when >50% stocks above EMA50)`);
  pr(`    ${'Archetype'.padEnd(18)} ${'Full n'.padStart(7)} ${'Full H5%'.padStart(9)} ${'Full PF'.padStart(8)} | ${'OOS n'.padStart(6)} ${'OOS H5%'.padStart(9)} ${'OOS PF'.padStart(8)} ${'AvgP&L'.padStart(8)} ${'MedMFE'.padStart(8)} ${'AvgDays'.padStart(8)}`);
  pr(`    ${'─'.repeat(106)}`);
  const regimeBaseline = {
    VolumeFootprint: { oos_hit5: '47.9', oos_pf: '0.85' },
    CompressionCoil: { oos_hit5: '44.3', oos_pf: '0.84' },
    MomentumPocket:  { oos_hit5: '43.8', oos_pf: '0.77' },
    EMAStack:        { oos_hit5: '40.9', oos_pf: '0.62' },
    PerfectStorm:    { oos_hit5: '52.6', oos_pf: '1.12' },
    'ORS-Prime':     { oos_hit5: '66.7', oos_pf: '1.62' },
  };
  for (const label of ['VolumeFootprint','CompressionCoil','MomentumPocket','EMAStack','PerfectStorm','ORS-Prime']) {
    const key  = `B2_${label}`;
    const full = aggregate(results[key]?.all || []);
    const oos  = aggregate(results[key]?.oos || []);
    const base = regimeBaseline[label];
    const lift = oos ? `  [lift ${(parseFloat(oos.hit5)-parseFloat(base.oos_hit5)).toFixed(1)}pp vs no-regime]` : '';
    const fStr = full ? `${String(full.n).padStart(7)} ${(full.hit5+'%').padStart(9)} ${full.pf.padStart(8)}` : '      —         —        —';
    const oStr = oos  ? `${String(oos.n).padStart(6)} ${(oos.hit5+'%').padStart(9)} ${oos.pf.padStart(8)} ${((oos.avgPnl>0?'+':'')+oos.avgPnl+'%').padStart(8)} ${(oos.medMFE+'%').padStart(8)} ${(oos.avgDays+'d').padStart(8)}${lift}` : '     —         —        —';
    pr(`    ${label.padEnd(18)} ${fStr} | ${oStr}`);
  }

  // B3
  pr(`\n${'─'.repeat(112)}`);
  pr(`B3: Confluence ≥3 archetypes fire on same bar`);
  {
    const full = aggregate(results['B3_conf3']?.all || []);
    const oos  = aggregate(results['B3_conf3']?.oos || []);
    pr(`  Full: ${full ? `n=${full.n}  Hit5=${full.hit5}%  PF=${full.pf}  AvgP&L=${full.avgPnl>0?'+':''}${full.avgPnl}%  MedMFE=${full.medMFE}%  AvgMAE=-${full.avgMAE}%  AvgDays=${full.avgDays}` : 'no signals'}`);
    pr(`  OOS:  ${oos  ? `n=${oos.n}   Hit5=${oos.hit5}%  PF=${oos.pf}  AvgP&L=${oos.avgPnl>0?'+':''}${oos.avgPnl}%  MedMFE=${oos.medMFE}%  AvgMAE=-${oos.avgMAE}%  AvgDays=${oos.avgDays}` : 'no signals'}`);
    if (full && oos) pr(`  IS→OOS: ${(parseFloat(oos.hit5)-parseFloat(full.hit5)).toFixed(1)}pp`);
  }

  pr(`\n${'═'.repeat(112)}`);

  const outPath = path.join(__dirname, 'results',
    `idea_backtest2_${ts.replace(/[:.]/g,'-').slice(0,19)}.txt`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.join('\n'));
  pr(`Saved → ${outPath}`);
})();
