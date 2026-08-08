'use strict';
// capPct sweep for ORS and VF.
// The slAtrMult sweep proved cap is 100% binding for all signals.
// Real stop = entry * (1 - capPct/100). This sweep tests relaxing that cap.
//
// R:R uses T3 (not T1): rewardRisk = (T3 - entry) / riskAbs
//   ORS: T3 = entry + 3.75 * atr14  (t1Mult=0.75, t3Mult=0.75*5=3.75)
//   VF:  T3 = entry + 2.50 * atr14  (t1Mult=0.75, t3Mult=0.75*10/3=2.5)
// R:R constraint: capPct <= t3Mult * atrPct
//   ORS NORMAL (atrPct=2%): capPct <= 7.5%
//   VF  VOLATILE(atrPct=3%): capPct <= 7.5%
//
// Simulation TP = pe.target5 = T1 = entry + 0.75 * atrPct% (ATR-based, fixed)
// Results reported per (archetype, capPct_test):
//   all  = all existing tradeValid signals (R:R check used current 4% cap)
//   rrok = subset where new capPct still satisfies R:R >= 1.0

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

const TARGET_KEYS = ['optimized_deployable_20plus', 'ors_prime_reversal'];
const ALL_ACTION  = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

// T3 mult per archetype (for R:R check only)
const T3_MULT = { 'optimized_deployable_20plus': 2.5, 'ors_prime_reversal': 3.75 };
const FLOOR_PCT = 2.0;

const CAP_TEST = [4.0, 5.0, 6.0, 7.0, 8.0, 9.0];

function makeAcc() {
  return { n: 0, nRrok: 0, sl: 0, slRrok: 0, tp: 0, tpRrok: 0,
           wins: 0, winsRrok: 0, sumPnl: 0, sumPnlRrok: 0,
           sumStop: 0, sumStopRrok: 0 };
}
function comboKey(key, cap) { return `${key}::${cap}`; }

// ── WORKER ────────────────────────────────────────────────────────────────────
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
    const end = Math.min(startIdx + hold, candles.length - 1);
    for (let j = startIdx; j <= end; j++) {
      const b = candles[j];
      const slHit = b.l <= stop;
      const tpHit = b.h >= t1;
      if (slHit && tpHit) {
        return b.o <= stop
          ? { outcome: 'sl', pnl: (stop - entry) / entry * 100 }
          : { outcome: 'tp', pnl: (t1   - entry) / entry * 100 };
      }
      if (slHit) return { outcome: 'sl', pnl: (stop - entry) / entry * 100 };
      if (tpHit) return { outcome: 'tp', pnl: (t1   - entry) / entry * 100 };
    }
    return { outcome: 'time', pnl: (candles[end].c - entry) / entry * 100 };
  }

  const buckets = {};
  for (const key of TARGET_KEYS)
    for (const cap of CAP_TEST)
      buckets[comboKey(key, cap)] = { is: makeAcc(), oos: makeAcc() };

  for (const file of workerData.files) {
    let candles;
    try { candles = parseCSV(file.fp); } catch { continue; }
    if (candles.length < MIN_BARS + MAX_HOLD_CAP) continue;

    for (const key of TARGET_KEYS) {
      const t3Mult = T3_MULT[key];

      for (let i = WINDOW - 1; i < candles.length - 1; i++) {
        const w = candles.slice(Math.max(0, i - WINDOW + 1), i + 1);
        let r;
        try { r = engine.analyzeStock(w, key); } catch { continue; }
        if (!ALL_ACTION.has(r.stage)) continue;

        const pe = r.priceEngine;
        if (!pe || !pe.tradeValid) continue;

        const entry = pe.plannedEntry;
        const atr14 = pe.atr14AtEntry;
        const t1    = pe.target5;   // T1 = entry + 0.75 * atr14 (ATR-based, fixed)
        const hold  = Math.min(pe.maxHoldBars || 12, MAX_HOLD_CAP);
        const ts    = candles[i].ts;

        if (entry <= 0 || atr14 <= 0 || t1 <= entry) continue;

        const t3      = entry + t3Mult * atr14;    // T3 for R:R check
        const isOos   = ts >= OOS_CUT;

        for (const capTest of CAP_TEST) {
          const newStop    = entry * (1 - capTest / 100);
          const floorStop  = entry * (1 - FLOOR_PCT / 100);
          const stop       = Math.min(floorStop, newStop); // floor: never < 2% away
          if (stop <= 0 || stop >= entry) continue;

          const riskAbs  = entry - stop;
          const rr       = t3 > entry ? (t3 - entry) / riskAbs : 0;
          const isRrok   = rr >= 1.0;

          const { outcome, pnl } = simulate(candles, i + 1, entry, stop, t1, hold);
          const stopPct = riskAbs / entry * 100;

          const ck  = comboKey(key, capTest);
          const acc = isOos ? buckets[ck].oos : buckets[ck].is;

          // all signals
          acc.n++;
          acc.sumPnl  += pnl;
          acc.sumStop += stopPct;
          if (outcome === 'sl') acc.sl++;
          if (outcome === 'tp') { acc.tp++; acc.wins++; }
          if (outcome === 'time' && pnl > 0) acc.wins++;

          // R:R-valid subset
          if (isRrok) {
            acc.nRrok++;
            acc.sumPnlRrok  += pnl;
            acc.sumStopRrok += stopPct;
            if (outcome === 'sl') acc.slRrok++;
            if (outcome === 'tp') { acc.tpRrok++; acc.winsRrok++; }
            if (outcome === 'time' && pnl > 0) acc.winsRrok++;
          }
        }
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

console.log(`\ncapPct Sweep — ORS + VF — ${allFiles.length} stocks · ${NUM_WORKERS} workers`);
console.log(`Test caps: ${CAP_TEST.join(', ')}%   OOS cut: 2025-01-01`);
console.log(`R:R check: (T3-entry)/(entry-newStop) >= 1.0  [ORS T3=3.75×ATR, VF T3=2.5×ATR]`);
console.log(`"all" = all existing signals | "rrok" = subset passing R:R at new cap\n`);

const chunks = Array.from({ length: NUM_WORKERS }, () => []);
allFiles.forEach((f, i) => chunks[i % NUM_WORKERS].push(f));

const agg = {};
for (const key of TARGET_KEYS)
  for (const cap of CAP_TEST)
    agg[comboKey(key, cap)] = { is: makeAcc(), oos: makeAcc() };

let processed = 0;
let doneCt    = 0;

const LABELS = {
  'optimized_deployable_20plus': 'VolumeFootprint',
  'ors_prime_reversal':          'ORS-Prime      ',
};

function fmt(n, t, digits) {
  if (t === 0) return '   —';
  return (n / t * 100).toFixed(digits ?? 1).padStart(5);
}

function printResults() {
  const W = 120;
  console.log('\n' + '='.repeat(W));
  console.log('OUT-OF-SAMPLE (2025-01-01 onward) — ALL signals');
  console.log('='.repeat(W));
  console.log('  Archetype        Cap%  N(all)  SL%    TP%    WR%   AvgP&L%  AvgStop%  N(rrok)  SL%(rr)  WR%(rr)  AvgP&L%(rr)  Status');
  console.log('-'.repeat(W));

  for (const key of TARGET_KEYS) {
    for (const cap of CAP_TEST) {
      const ck  = comboKey(key, cap);
      const a   = agg[ck].oos;
      const {
        n, nRrok, sl, slRrok, tp, tpRrok, wins, winsRrok,
        sumPnl, sumPnlRrok, sumStop, sumStopRrok
      } = a;

      const slPct     = n     > 0 ? (sl     / n     * 100).toFixed(1) : '—';
      const tpPct     = n     > 0 ? (tp     / n     * 100).toFixed(1) : '—';
      const wrPct     = n     > 0 ? (wins   / n     * 100).toFixed(1) : '—';
      const avgPnl    = n     > 0 ? (sumPnl / n)    .toFixed(2)       : '—';
      const avgStop   = n     > 0 ? (sumStop/ n)    .toFixed(1)       : '—';
      const slRr      = nRrok > 0 ? (slRrok / nRrok * 100).toFixed(1) : '—';
      const wrRr      = nRrok > 0 ? (winsRrok/nRrok * 100).toFixed(1) : '—';
      const pnlRr     = nRrok > 0 ? (sumPnlRrok/nRrok).toFixed(2)     : '—';
      const slNum     = parseFloat(slPct);
      const status    = isNaN(slNum) ? '' : slNum < 20 ? '✅' : slNum < 30 ? '⚠️ ' : '❌ ';
      const curr      = cap === 4.0 ? ' ← current' : '';

      console.log(
        `  ${LABELS[key]}  ${String(cap).padStart(3)}%` +
        `  n=${String(n).padStart(4)}` +
        `  SL=${slPct.padStart(5)}%` +
        `  TP=${tpPct.padStart(5)}%` +
        `  WR=${wrPct.padStart(5)}%` +
        `  ${avgPnl.padStart(6)}%` +
        `  stop=${avgStop.padStart(4)}%` +
        `  n(rr)=${String(nRrok).padStart(4)}` +
        `  SL(rr)=${slRr.padStart(5)}%` +
        `  WR(rr)=${wrRr.padStart(5)}%` +
        `  P&L(rr)=${pnlRr.padStart(6)}%` +
        `  ${status}${curr}`
      );
    }
    console.log('');
  }

  console.log('='.repeat(W));
  console.log('\nrrok = R:R-valid subset: signals where (T3-entry)/(entry-newStop) >= 1.0 at the test cap.');
  console.log('These are the signals that would still emit from the screener if capPct is deployed.\n');

  // Summary: best cap for each archetype
  console.log('BEST OOS SL% AMONG R:R-VALID SIGNALS:');
  for (const key of TARGET_KEYS) {
    let best = null;
    for (const cap of CAP_TEST) {
      const a = agg[comboKey(key, cap)].oos;
      if (a.nRrok === 0) continue;
      const sl = a.slRrok / a.nRrok * 100;
      if (!best || sl < best.sl) best = { cap, sl, n: a.nRrok, wr: a.winsRrok / a.nRrok * 100, pnl: a.sumPnlRrok / a.nRrok };
    }
    if (best) {
      console.log(`  ${LABELS[key]}: cap=${best.cap}%  SL=${best.sl.toFixed(1)}%  WR=${best.wr.toFixed(1)}%  AvgP&L=${best.pnl >= 0 ? '+' : ''}${best.pnl.toFixed(2)}%  n=${best.n}`);
    }
  }
  console.log('');
}

chunks.map(files => {
  const w = new Worker(__filename, { workerData: { files } });
  w.on('message', msg => {
    if (msg.type === 'progress') {
      processed++;
      if (processed % 100 === 0) process.stdout.write(`  Scanning: ${processed}/${allFiles.length}\r`);
    } else if (msg.type === 'done') {
      for (const ck of Object.keys(msg.buckets)) {
        if (!agg[ck]) continue;
        for (const p of ['is', 'oos']) {
          const src = msg.buckets[ck][p];
          const dst = agg[ck][p];
          for (const f of ['n','nRrok','sl','slRrok','tp','tpRrok','wins','winsRrok','sumPnl','sumPnlRrok','sumStop','sumStopRrok'])
            dst[f] += src[f];
        }
      }
      doneCt++;
      if (doneCt === NUM_WORKERS) printResults();
    }
  });
  w.on('error', e => console.error('Worker error:', e.message));
});
