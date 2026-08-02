'use strict';
// Comprehensive backtest — all 7 param sets + multi-scan (IS + OOS)
//
// Metrics per archetype:
//   N, SL%, TP%, TIME%, WR%, AvgP&L%, MedianP&L%, PF, AvgMFE%, AvgMAE%,
//   MFE>5%, MFE>10%, BestWin%, WorstLoss%
//
// Multi-scan: all 7 archetypes fired together per bar.
//   Dedup by (stock, bar): pick highest-priority archetype per stock×bar.
//   Priority (highest first): ORS > VF > PS > MP > CC > ES > CB
//
// Stop = pe.tacticalStop (real engine stop — includes structStop, cap, floor)
// T1   = pe.target5 (real T1 from engine)
// Hold = pe.maxHoldBars (capped at 40)

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR     = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR   = path.join(__dirname, '_compiled_current');
const WINDOW       = 300;
const MIN_BARS     = 200;
const OOS_CUT      = new Date('2025-01-01').getTime() / 1000;
const MAX_HOLD_CAP = 40;
const NUM_WORKERS  = 10;

const ALL_KEYS = [
  'optimized_deployable_20plus',     // VF
  'optimized_highprecision_15plus',  // CC
  'optimized_elite_10plus',          // MP
  'optimized_ultraselective_8plus',  // ES
  'sniper_95plus',                   // PS
  'ors_prime_reversal',              // ORS
  'circuit_breaker_v2',              // CB
];

const LABELS = {
  'optimized_deployable_20plus':    'VolumeFootprint',
  'optimized_highprecision_15plus': 'CompressionCoil',
  'optimized_elite_10plus':         'MomentumPocket ',
  'optimized_ultraselective_8plus': 'EMAStack       ',
  'sniper_95plus':                  'PerfectStorm   ',
  'ors_prime_reversal':             'ORS-Prime      ',
  'circuit_breaker_v2':             'CircuitBreaker ',
  '__multi__':                      'MULTI-SCAN     ',
};

// Dedup priority (higher index = lower priority for multi-scan)
const PRIORITY = {
  'ors_prime_reversal':             0,
  'optimized_deployable_20plus':    1,
  'sniper_95plus':                  2,
  'optimized_elite_10plus':         3,
  'optimized_highprecision_15plus': 4,
  'optimized_ultraselective_8plus': 5,
  'circuit_breaker_v2':             6,
};

const ALL_ACTION = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

function makeAcc() {
  return {
    n: 0, sl: 0, tp: 0, timeExit: 0,
    wins: 0,
    grossWin: 0, grossLoss: 0,
    sumPnl: 0,
    pnls: [],        // for median
    sumMFE: 0, sumMAE: 0,
    mfe5: 0, mfe10: 0,
    bestWin: -Infinity, worstLoss: Infinity,
  };
}

function addResult(acc, outcome, pnl, mfe, mae) {
  acc.n++;
  acc.sumPnl += pnl;
  acc.pnls.push(pnl);
  acc.sumMFE += mfe;
  acc.sumMAE += mae;
  if (mfe >= 5.0)  acc.mfe5++;
  if (mfe >= 10.0) acc.mfe10++;
  if (pnl > acc.bestWin)   acc.bestWin   = pnl;
  if (pnl < acc.worstLoss) acc.worstLoss = pnl;

  if (outcome === 'sl')   acc.sl++;
  if (outcome === 'tp')   { acc.tp++; acc.wins++; }
  if (outcome === 'time') {
    acc.timeExit++;
    if (pnl > 0) acc.wins++;
  }
  if (pnl > 0) acc.grossWin  += pnl;
  if (pnl < 0) acc.grossLoss += Math.abs(pnl);
}

// ── WORKER ─────────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));

  function parseCSV(fp) {
    const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!raw) return [];
    const lines = raw.split(/\r?\n/);
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const p = lines[i].split(',').map(x => x.trim());
      if (p.length < 6) continue;
      const ts = Date.parse(p[0]);
      const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
      if (!Number.isFinite(ts) || o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < l) continue;
      out.push({ ts: Math.floor(ts / 1000), o, h, l, c, v: Math.max(0, v) });
    }
    out.sort((a, b) => a.ts - b.ts);
    const d = [];
    for (const x of out) {
      if (d.length && d[d.length - 1].ts === x.ts) d[d.length - 1] = x;
      else d.push(x);
    }
    return d;
  }

  function simulate(candles, startIdx, entry, stop, t1, hold) {
    let maxHigh = entry;
    let minLow  = entry;
    const end = Math.min(startIdx + hold, candles.length - 1);
    for (let j = startIdx; j <= end; j++) {
      const b = candles[j];
      if (b.h > maxHigh) maxHigh = b.h;
      if (b.l < minLow)  minLow  = b.l;
      const slHit = b.l <= stop;
      const tpHit = b.h >= t1;
      const mfe = (maxHigh - entry) / entry * 100;
      const mae = (minLow  - entry) / entry * 100;
      if (slHit && tpHit) {
        return b.o <= stop
          ? { outcome: 'sl', pnl: (stop - entry) / entry * 100, mfe, mae }
          : { outcome: 'tp', pnl: (t1   - entry) / entry * 100, mfe, mae };
      }
      if (slHit) return { outcome: 'sl', pnl: (stop - entry) / entry * 100, mfe, mae };
      if (tpHit) return { outcome: 'tp', pnl: (t1   - entry) / entry * 100, mfe, mae };
    }
    const mfe = (maxHigh - entry) / entry * 100;
    const mae = (minLow  - entry) / entry * 100;
    return { outcome: 'time', pnl: (candles[end].c - entry) / entry * 100, mfe, mae };
  }

  // Buckets: per-key + multi-scan
  const buckets = {};
  for (const key of [...ALL_KEYS, '__multi__'])
    buckets[key] = { is: makeAcc(), oos: makeAcc() };

  for (const file of workerData.files) {
    let candles;
    try { candles = parseCSV(file.fp); } catch { continue; }
    if (candles.length < MIN_BARS + MAX_HOLD_CAP) continue;

    for (let i = WINDOW - 1; i < candles.length - 1; i++) {
      const w = candles.slice(Math.max(0, i - WINDOW + 1), i + 1);
      const isOos = candles[i].ts >= OOS_CUT;

      // Try all keys at this bar; pick winner for multi-scan
      let multiWinner = null;

      for (const key of ALL_KEYS) {
        let r;
        try { r = engine.analyzeStock(w, key); } catch { continue; }
        if (!ALL_ACTION.has(r.stage)) continue;

        const pe = r.priceEngine;
        if (!pe || !pe.tradeValid) continue;

        const entry = pe.plannedEntry;
        const stop  = pe.tacticalStop;
        const t1    = pe.target5;
        const hold  = Math.min(pe.maxHoldBars || 12, MAX_HOLD_CAP);

        if (entry <= 0 || stop <= 0 || stop >= entry || t1 <= entry) continue;

        const res = simulate(candles, i + 1, entry, stop, t1, hold);
        const acc = isOos ? buckets[key].oos : buckets[key].is;
        addResult(acc, res.outcome, res.pnl, res.mfe, res.mae);

        // Multi-scan: track highest-priority signal at this bar
        const pri = PRIORITY[key] ?? 99;
        if (multiWinner === null || pri < multiWinner.pri) {
          multiWinner = { pri, res };
        }
      }

      if (multiWinner) {
        const acc = isOos ? buckets['__multi__'].oos : buckets['__multi__'].is;
        addResult(acc, multiWinner.res.outcome, multiWinner.res.pnl, multiWinner.res.mfe, multiWinner.res.mae);
      }
    }
    parentPort.postMessage({ type: 'progress' });
  }

  parentPort.postMessage({ type: 'done', buckets });
  return;
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
const allFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv'))
  .map(name => ({ name, fp: path.join(DATA_DIR, name) }));

console.log(`\nFull Backtest — All 7 Param Sets + Multi-Scan`);
console.log(`Stocks: ${allFiles.length}  Workers: ${NUM_WORKERS}  OOS cut: 2025-01-01`);
console.log(`Stop = tacticalStop (real engine), T1 = target5 (T1), Hold = maxHoldBars\n`);

const chunks = Array.from({ length: NUM_WORKERS }, () => []);
allFiles.forEach((f, i) => chunks[i % NUM_WORKERS].push(f));

const agg = {};
for (const key of [...ALL_KEYS, '__multi__'])
  agg[key] = { is: makeAcc(), oos: makeAcc() };

let processed = 0;
let doneCt    = 0;

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2;
}

function mergeAcc(dst, src) {
  dst.n += src.n;
  dst.sl += src.sl;
  dst.tp += src.tp;
  dst.timeExit += src.timeExit;
  dst.wins += src.wins;
  dst.grossWin += src.grossWin;
  dst.grossLoss += src.grossLoss;
  dst.sumPnl += src.sumPnl;
  dst.pnls.push(...src.pnls);
  dst.sumMFE += src.sumMFE;
  dst.sumMAE += src.sumMAE;
  dst.mfe5 += src.mfe5;
  dst.mfe10 += src.mfe10;
  if (src.bestWin   > dst.bestWin)   dst.bestWin   = src.bestWin;
  if (src.worstLoss < dst.worstLoss) dst.worstLoss = src.worstLoss;
}

function printTable(period, label) {
  const W = 135;
  console.log('\n' + '═'.repeat(W));
  console.log(`${label}  [${period.toUpperCase()}]`);
  console.log('═'.repeat(W));
  console.log(
    'Archetype          '.padEnd(20) +
    '   N'.padStart(6) +
    '  SL%'.padStart(7) +
    '  TP%'.padStart(7) +
    ' TIME%'.padStart(7) +
    '   WR%'.padStart(7) +
    ' AvgP&L%'.padStart(9) +
    ' MedP&L%'.padStart(9) +
    '     PF'.padStart(8) +
    ' AvgMFE%'.padStart(9) +
    ' AvgMAE%'.padStart(9) +
    ' MFE>5%'.padStart(8) +
    ' MFE>10%'.padStart(9) +
    ' BestWin%'.padStart(10) +
    ' WrstLoss%'.padStart(11)
  );
  console.log('─'.repeat(W));

  const keys = [...ALL_KEYS, '__multi__'];
  for (const key of keys) {
    const a = period === 'oos' ? agg[key].oos : agg[key].is;
    const { n, sl, tp, timeExit, wins, grossWin, grossLoss, sumPnl, pnls,
            sumMFE, sumMAE, mfe5, mfe10, bestWin, worstLoss } = a;
    if (n === 0) {
      console.log(`${LABELS[key].padEnd(20)}  (no signals)`);
      continue;
    }
    const slP    = (sl       / n * 100).toFixed(1);
    const tpP    = (tp       / n * 100).toFixed(1);
    const timeP  = (timeExit / n * 100).toFixed(1);
    const wrP    = (wins     / n * 100).toFixed(1);
    const avgPnl = (sumPnl   / n).toFixed(2);
    const medPnl = median(pnls).toFixed(2);
    const pf     = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : grossWin > 0 ? '∞' : '0.00';
    const avgMfe = (sumMFE   / n).toFixed(2);
    const avgMae = (sumMAE   / n).toFixed(2);
    const mfe5P  = (mfe5     / n * 100).toFixed(1);
    const mfe10P = (mfe10    / n * 100).toFixed(1);
    const bw     = bestWin   === -Infinity ? '-' : bestWin.toFixed(1);
    const wl     = worstLoss === Infinity  ? '-' : worstLoss.toFixed(1);

    const slNum = parseFloat(slP);
    const wrNum = parseFloat(wrP);
    const pnlNum = parseFloat(avgPnl);
    let status = '';
    if (slNum < 20 && pnlNum > 1.0) status = ' ✅✅';
    else if (slNum < 20 && pnlNum > 0) status = ' ✅';
    else if (slNum < 25 && pnlNum > 0) status = ' ⚠️';
    else status = ' ❌';

    const sep = key === '__multi__' ? '═' : ' ';

    console.log(
      `${LABELS[key].padEnd(20)}` +
      `${String(n).padStart(6)}` +
      `${slP.padStart(6)}%` +
      `${tpP.padStart(6)}%` +
      `${timeP.padStart(6)}%` +
      `${wrP.padStart(6)}%` +
      `${avgPnl.padStart(8)}%` +
      `${medPnl.padStart(8)}%` +
      `${String(pf).padStart(7)}x` +
      `${avgMfe.padStart(8)}%` +
      `${avgMae.padStart(8)}%` +
      `${mfe5P.padStart(7)}%` +
      `${mfe10P.padStart(8)}%` +
      `${bw.padStart(9)}%` +
      `${wl.padStart(10)}%` +
      `${status}`
    );
  }
  console.log('═'.repeat(W));
  console.log('\nPF = Profit Factor (grossWin/grossLoss). MFE = Max Favorable Excursion. MAE = Max Adverse Excursion.');
  console.log('Multi-scan: one signal per stock×bar (highest-priority archetype wins: ORS>VF>PS>MP>CC>ES>CB).');
}

chunks.map(files => {
  const w = new Worker(__filename, { workerData: { files } });
  w.on('message', msg => {
    if (msg.type === 'progress') {
      processed++;
      if (processed % 100 === 0) process.stdout.write(`  Scanning ${processed}/${allFiles.length}\r`);
    } else if (msg.type === 'done') {
      for (const key of Object.keys(msg.buckets)) {
        if (!agg[key]) continue;
        for (const p of ['is', 'oos']) mergeAcc(agg[key][p], msg.buckets[key][p]);
      }
      doneCt++;
      if (doneCt === NUM_WORKERS) {
        printTable('is',  'IN-SAMPLE  (before 2025-01-01)');
        printTable('oos', 'OUT-OF-SAMPLE (2025-01-01 onward)');
        console.log('');
      }
    }
  });
  w.on('error', e => console.error('Worker error:', e.message));
});
