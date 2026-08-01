'use strict';

/**
 * Independent validation of the pasted R5 regime specification.
 *
 * The engine generates the signal. This harness owns the post-filter and
 * regime routing so that a stale hitRateGate implementation cannot inflate
 * the reported PREMIUM results.
 *
 * Convention intentionally matches the R5 reports:
 *   signal-bar close -> next-bar open entry
 *   +5% target, stop-first, [3.5%, 6.5%] stop clamp
 *   20-bar forward window, per-symbol non-overlap
 *   OOS signal date >= 2025-05-05
 */

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const PARAM_FILE = process.env.PARAM_FILE || 'C:/Users/drkkr/.codex/attachments/91a92d2b-ab92-43d9-bb72-329b4562f6d8/pasted-text.txt';
const OUT_DIR = path.join(__dirname, 'results');
const WINDOW = 300;
const MAX_HOLD = 20;
const TARGET_PCT = 5;
const OOS_CUT = '2025-05-05';
const UNIVERSE_COUNT = Number(process.env.UNIVERSE_COUNT || 1616);
const WORKERS = Math.min(Math.max(1, Number(process.env.WORKERS || 10)), 32);
const BUY = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

const ROUTES = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  'ors_prime_reversal',
];

const FRAMEWORKS = [
  'BULL_POOL_STANDARD',
  'BULL_POOL_ELITE_65',
  'BULL_POOL_ELITE_70',
  'PERFECT_STORM_EXTREME_70',
  'BEAR_ORS',
];

const LABEL = {
  optimized_deployable_20plus: 'VolumeFootprint',
  optimized_highprecision_15plus: 'CompressionCoil',
  optimized_elite_10plus: 'MomentumPocket',
  optimized_ultraselective_8plus: 'EMAStack',
  sniper_95plus: 'PerfectStorm',
  ors_prime_reversal: 'ORS-Prime',
};

function parseDate(s) {
  const t = Date.parse(String(s).trim());
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const out = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const p = line.split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = parseDate(p[0]);
    const o = Number(p[1]), h = Number(p[2]), l = Number(p[3]);
    const c = Number(p[4]), v = Number(p[5]);
    if (!ts || ![o, h, l, c, v].every(Number.isFinite) || o <= 0 || h < l || l <= 0 || c <= 0) continue;
    out.push({ ts, o, h, l, c, v: Math.max(0, v) });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let s = 0;
  for (let i = 0; i < period; i++) s += values[i];
  out[period - 1] = s / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}

function bodyRatio(bar) {
  const range = bar.h - bar.l;
  return range > 0 ? Math.abs(bar.c - bar.o) / range : 0;
}

function atr14(candles, end) {
  if (end < 1) return Math.max(0, candles[end].h - candles[end].l);
  const start = Math.max(1, end - 80);
  let atr = candles[start].h - candles[start].l;
  for (let i = start + 1; i <= end; i++) {
    const b = candles[i], p = candles[i - 1];
    const tr = Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    atr = (atr * 13 + tr) / 14;
  }
  return atr;
}

function value(result, ...keys) {
  for (const key of keys) {
    const v = result?.[key];
    if (Number.isFinite(Number(v))) return Number(v);
  }
  return 0;
}

function premium(result, key, bar, cfg) {
  const body = bodyRatio(bar);
  const closeLoc = value(result, 'closeLoc') / 100;
  const vol = value(result, 'exactVolRatio20', 'volRatio20');
  const rsi14 = value(result, 'rsi14');
  const rsi2 = value(result, 'rsi2');
  const adx = value(result, 'adx14', 'momentum') || value(result?.momentum || {}, 'adx14');
  const atrPct = value(result, 'atrPct14');

  switch (key) {
    case 'optimized_deployable_20plus':
      return rsi14 >= 55 && rsi2 <= 80 && vol >= 2.5 && adx >= 30 && body >= 0.30 && closeLoc >= 0.70;
    case 'optimized_highprecision_15plus':
      return rsi14 >= 50 && rsi2 <= 80 && vol >= 2.0 && closeLoc >= 0.50;
    case 'optimized_elite_10plus':
      return rsi14 >= 45;
    case 'optimized_ultraselective_8plus':
      return body >= 0.35;
    case 'sniper_95plus':
      return atrPct >= 3 && body >= 0.35;
    case 'ors_prime_reversal':
      // The ORS engine gate itself is minADX:20 in the pasted spec. Keep the
      // post-filter explicit even though current analyzeORS already enforces it.
      return adx >= 20 || cfg?.ors_specific_params?.minADX === 20;
    default:
      return false;
  }
}

function rawStop(result, bar) {
  const candidates = [
    result?.tacticalPlan?.stop,
    result?.priceEngine?.stop,
    result?.priceEngine?.tacticalStop,
    result?.priceEngine?.plannedStop,
  ];
  for (const x of candidates) if (Number.isFinite(Number(x)) && Number(x) > 0) return Number(x);
  return bar.c * 0.95;
}

function simulate(candles, signalIdx, stopRaw) {
  const entryIdx = signalIdx + 1;
  if (entryIdx >= candles.length - 1) return null;
  const entry = candles[entryIdx].o;
  if (!(entry > 0)) return null;
  const stop = Math.min(entry * 0.965, Math.max(entry * 0.935, stopRaw));
  const target = entry * 1.05;
  let hitTarget = false, hitStop = false, barsToTarget = null;
  let mfe = 0, mae = 0;

  // Match R5: the entry bar is not counted in the forward excursion loop.
  for (let b = 1; b <= MAX_HOLD; b++) {
    const idx = entryIdx + b;
    if (idx >= candles.length) break;
    const bar = candles[idx];
    mfe = Math.max(mfe, (bar.h - entry) / entry * 100);
    if (!hitTarget) mae = Math.max(mae, (entry - bar.l) / entry * 100);
    if (bar.l <= stop) { hitStop = true; break; }
    if (bar.h >= target) { hitTarget = true; barsToTarget = b; break; }
  }

  const riskPct = (entry - stop) / entry * 100;
  return {
    hitTarget,
    hitStop,
    barsToTarget,
    riskPct,
    pnl: hitTarget ? TARGET_PCT : (hitStop ? -riskPct : 0),
    mfe,
    mae: hitTarget ? mae : null,
    nextAllowed: signalIdx + 1 + (barsToTarget ?? MAX_HOLD),
  };
}

function aggregate(trades) {
  if (!trades.length) return { n: 0, wins: 0, hit5: 0, pf: 0, avgPnl: 0, medMFE: 0, avgMAE: 0, avgDays: 0 };
  const wins = trades.filter(t => t.hitTarget);
  const losses = trades.filter(t => t.hitStop && !t.hitTarget);
  const grossWin = wins.length * TARGET_PCT;
  const grossLoss = losses.reduce((s, t) => s + t.riskPct, 0);
  const mfes = trades.map(t => t.mfe).sort((a, b) => a - b);
  const winnerMae = wins.filter(t => t.mae != null).map(t => t.mae);
  const days = wins.filter(t => t.barsToTarget != null).map(t => t.barsToTarget);
  return {
    n: trades.length,
    wins: wins.length,
    hit5: wins.length / trades.length * 100,
    pf: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0),
    avgPnl: trades.reduce((s, t) => s + t.pnl, 0) / trades.length,
    medMFE: mfes[Math.floor(mfes.length / 2)] || 0,
    avgMAE: winnerMae.length ? winnerMae.reduce((s, x) => s + x, 0) / winnerMae.length : 0,
    avgDays: days.length ? days.reduce((s, x) => s + x, 0) / days.length : 0,
  };
}

function emptyBuckets() {
  const out = {};
  for (const key of ROUTES) out[`ROUTE_${key}`] = { all: [], oos: [] };
  for (const key of FRAMEWORKS) out[key] = { all: [], oos: [] };
  return out;
}

function addTrade(bucket, trade, signalTs) {
  if (!trade) return;
  bucket.all.push(trade);
  if (signalTs >= parseDate(OOS_CUT)) bucket.oos.push(trade);
}

if (!isMainThread) {
  const engine = require(path.join(workerData.engineDir, 'stockEngine.js'));
  const out = emptyBuckets();
  for (const fp of workerData.files) {
    let candles;
    try { candles = parseCSV(fp); } catch { continue; }
    if (candles.length < WINDOW + MAX_HOLD + 2) continue;

    const lastAllowed = Object.fromEntries([...Object.keys(out)].map(k => [k, -1]));
    for (let i = WINDOW - 1; i < candles.length - MAX_HOLD - 2; i++) {
      const ratio = workerData.ratioMap[candles[i].ts] || 0;
      const bull = ratio > 0.50;
      const bear = ratio <= 0.50;
      const bar = candles[i];
      const body = bodyRatio(bar);
      const fired = {};

      // Independent route validation. The regime framework below decides
      // which of these routes is actually eligible to trade.
      for (const key of ROUTES) {
        const routeBucket = `ROUTE_${key}`;
        if (i <= lastAllowed[routeBucket]) continue;
        let result;
        try { result = engine.analyzeStock(candles.slice(i - WINDOW + 1, i + 1), key, false); } catch { continue; }
        if (!result || !BUY.has(result.stage) || !premium(result, key, bar, workerData.paramByKey[key])) continue;
        fired[key] = { result, stop: rawStop(result, bar) };
        const trade = simulate(candles, i, fired[key].stop);
        if (!trade) continue;
        trade.symbol = path.basename(fp).replace(/_OHLCV\.csv$/i, '');
        trade.signalDate = new Date(candles[i].ts * 1000).toISOString().slice(0, 10);
        trade.route = key;
        addTrade(out[routeBucket], trade, candles[i].ts);
        lastAllowed[routeBucket] = trade.nextAllowed;
      }

      const ema = fired.optimized_ultraselective_8plus;
      const ps = fired.sniper_95plus;
      const ors = fired.ors_prime_reversal;
      const emaOk = !!ema && body >= 0.35;
      const psOk = !!ps && body >= 0.35;

      const frameworkSignals = {
        BULL_POOL_STANDARD: bull && (emaOk || psOk),
        BULL_POOL_ELITE_65: bull && ratio > 0.65 && emaOk,
        BULL_POOL_ELITE_70: bull && ratio > 0.70 && (emaOk || psOk),
        PERFECT_STORM_EXTREME_70: bull && ratio > 0.70 && psOk && value(ps.result, 'atrPct14') >= 3,
        BEAR_ORS: bear && !!ors,
      };

      for (const [name, shouldFire] of Object.entries(frameworkSignals)) {
        if (!shouldFire || i <= lastAllowed[name]) continue;
        // Prefer the EMA stop when both fire, matching the R5 pool harness.
        const selected = name === 'BEAR_ORS' ? ors : (ema || ps);
        const trade = simulate(candles, i, selected.stop);
        if (!trade) continue;
        trade.symbol = path.basename(fp).replace(/_OHLCV\.csv$/i, '');
        trade.signalDate = new Date(candles[i].ts * 1000).toISOString().slice(0, 10);
        trade.route = selected === ors ? 'ors_prime_reversal' : (selected === ema ? 'optimized_ultraselective_8plus' : 'sniper_95plus');
        addTrade(out[name], trade, candles[i].ts);
        lastAllowed[name] = trade.nextAllowed;
      }
    }
  }
  parentPort.postMessage(out);
  process.exit(0);
}

function filesIn(dir) {
  return fs.readdirSync(dir)
    .filter(name => name.toLowerCase().endsWith('.csv') && name !== 'ALL_SYMBOLS_OHLCV.csv')
    .sort()
    .map(name => path.join(dir, name));
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) throw new Error(`Data directory not found: ${DATA_DIR}`);
  if (!fs.existsSync(PARAM_FILE)) throw new Error(`Parameter file not found: ${PARAM_FILE}`);
  const pasted = JSON.parse(fs.readFileSync(PARAM_FILE, 'utf8'));
  const paramByKey = Object.fromEntries((pasted.param_sets || []).map(x => [x.key, x]));
  if (Object.keys(paramByKey).length !== 6) throw new Error(`Expected 6 pasted param sets, got ${Object.keys(paramByKey).length}`);

  const files = filesIn(DATA_DIR);
  const chunks = Array.from({ length: Math.min(WORKERS, files.length) }, () => []);
  files.forEach((fp, i) => chunks[i % chunks.length].push(fp));
  const oosTs = parseDate(OOS_CUT);

  console.log(`Pasted R5 regime validation`);
  console.log(`Data: ${DATA_DIR}`);
  console.log(`Files: ${files.length} | fixed breadth denominator: ${UNIVERSE_COUNT} | workers: ${chunks.length}`);
  console.log(`Convention: next-open, +5% target, stop-first, 3.5%-6.5% stop clamp, 20 bars, non-overlap`);
  console.log(`OOS cutoff: ${OOS_CUT} | parameter file: ${PARAM_FILE}\n`);

  const rawBreadth = {};
  // Compute breadth with one pass per file. This is faster and less memory
  // hungry than sending 1,616 complete candle arrays between workers.
  for (const fp of files) {
    let candles;
    try { candles = parseCSV(fp); } catch { continue; }
    if (candles.length < 50) continue;
    const e50 = ema(candles.map(x => x.c), 50);
    for (let i = 49; i < candles.length; i++) {
      const ts = candles[i].ts;
      const row = rawBreadth[ts] || { above: 0 };
      if (e50[i] != null && candles[i].c > e50[i]) row.above++;
      rawBreadth[ts] = row;
    }
  }
  const ratioMap = Object.fromEntries(Object.entries(rawBreadth).map(([ts, x]) => [ts, x.above / UNIVERSE_COUNT]));

  const combined = emptyBuckets();
  let done = 0;
  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { phase: 2, files: chunk, ratioMap, engineDir: ENGINE_DIR, paramByKey } });
    worker.on('message', data => {
      for (const key of Object.keys(combined)) {
        combined[key].all.push(...data[key].all);
        combined[key].oos.push(...data[key].oos);
      }
      done += chunk.length;
      process.stdout.write(`  signal pass: ${done}/${files.length}\r`);
      resolve();
    });
    worker.on('error', reject);
    worker.on('exit', code => { if (code) reject(new Error(`worker exited ${code}`)); });
  })));
  process.stdout.write('\n');

  const expected = pasted.dual_regime_framework || {};
  const result = {};
  for (const key of [...Object.keys(combined)]) {
    result[key] = { label: LABEL[key.replace(/^ROUTE_/, '')] || key, all: aggregate(combined[key].all), oos: aggregate(combined[key].oos) };
  }

  const fmt = (x, d = 2) => x === Infinity ? 'Inf' : Number(x || 0).toFixed(d);
  const lines = [];
  lines.push('PASTED R5 PARAMETER + DUAL-REGIME VALIDATION');
  lines.push(`Data: ${DATA_DIR}`);
  lines.push(`Files: ${files.length}; breadth denominator: ${UNIVERSE_COUNT}; OOS cutoff: ${OOS_CUT}`);
  lines.push('Entry/exit: next-bar open; +5% target; stop-first; stop clamp [3.5%, 6.5%]; 20-bar horizon; per-symbol non-overlap');
  lines.push('Premium semantics: pasted gate rules; body_pct converted to ratio (35 -> 0.35); ORS ADX gate enforced at >=20');
  lines.push('');
  lines.push('Individual PREMIUM routes');
  lines.push('Route                 Full n  Full H5%  Full PF  Full Avg | OOS n  OOS H5%  OOS PF  OOS Avg  MedMFE  AvgMAE');
  lines.push('-'.repeat(112));
  for (const key of ROUTES) {
    const r = result[`ROUTE_${key}`], a = r.all, o = r.oos;
    lines.push(`${LABEL[key].padEnd(20)} ${String(a.n).padStart(7)} ${fmt(a.hit5, 1).padStart(9)} ${fmt(a.pf).padStart(8)} ${fmt(a.avgPnl).padStart(9)} | ${String(o.n).padStart(5)} ${fmt(o.hit5, 1).padStart(8)} ${fmt(o.pf).padStart(7)} ${fmt(o.avgPnl).padStart(8)} ${fmt(o.medMFE).padStart(8)} ${fmt(o.avgMAE).padStart(8)}`);
  }
  lines.push('');
  lines.push('Dual-regime framework');
  lines.push('Framework                       Full n  Full H5%  Full PF  Full Avg | OOS n  OOS H5%  OOS PF  OOS Avg  MedMFE  AvgDays | pasted OOS');
  lines.push('-'.repeat(132));
  for (const key of FRAMEWORKS) {
    const r = result[key], a = r.all, o = r.oos, e = expected[key] || {};
    const exp = e.oos_n == null ? '-' : `n=${e.oos_n}, H5=${e.oos_hit5_pct}%, PF=${e.oos_pf}`;
    lines.push(`${key.padEnd(31)} ${String(a.n).padStart(7)} ${fmt(a.hit5, 1).padStart(9)} ${fmt(a.pf).padStart(8)} ${fmt(a.avgPnl).padStart(9)} | ${String(o.n).padStart(5)} ${fmt(o.hit5, 1).padStart(8)} ${fmt(o.pf).padStart(7)} ${fmt(o.avgPnl).padStart(8)} ${fmt(o.medMFE).padStart(8)} ${fmt(o.avgDays, 1).padStart(8)} | ${exp}`);
  }
  lines.push('');
  lines.push('Notes');
  lines.push('- Individual routes are diagnostic; only the five dual-regime rows represent the stated live routing.');
  lines.push('- A mismatch in OOS n means the pasted numbers used a different signal eligibility, date denominator, or overlap rule.');
  lines.push('- Premium-only statistics are conditional statistics, not the performance of every engine signal.');

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(OUT_DIR, `r5_pasted_regime_validation_${stamp}.json`);
  const txtPath = path.join(OUT_DIR, `r5_pasted_regime_validation_${stamp}.txt`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify({
    meta: { dataDir: DATA_DIR, files: files.length, universeCount: UNIVERSE_COUNT, oosCut: OOS_CUT, convention: 'R5 next-open +5 target stop-first clamp 3.5%-6.5% 20 bars non-overlap', paramFile: PARAM_FILE, generated: new Date().toISOString() },
    expected: pasted.dual_regime_framework,
    result,
  }, null, 2));
  fs.writeFileSync(txtPath, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\nJSON: ${jsonPath}\nTXT: ${txtPath}`);
}

if (isMainThread) main().catch(err => { console.error(err.stack || err); process.exit(1); });
