'use strict';
// VF T1-mult × capPct grid sweep.
//
// VF problem: t1Mult=0.75 → T1 = 0.75×atrPct% above entry. Too tight vs stop.
// At 9% cap: SL drops to ~21% but avg P&L only +0.39% (stop loss still huge vs tiny gain).
// Theory: stocks that survive wider stop DO trend up → higher T1 also reachable.
//
// Grid: capPct ∈ {4,5,6,7,8,9} × t1Mult ∈ {0.75, 1.0, 1.25, 1.5, 1.75, 2.0}
//
// R:R check uses T3 = entry + 2.5×atr14 (VF t3Mult fixed, not changed in this sweep).
// R:R = (T3-entry)/(entry-newStop) ≥ 1.0
//
// Simulation TP = entry + t1Mult_test × atr14 (NOT pe.target5).

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

const VF_KEY    = 'optimized_deployable_20plus';
const ALL_ACTION = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

const T3_MULT   = 2.5;   // VF: t3Mult = t1Mult × (10/3) = 0.75 × 3.333 = 2.5
const FLOOR_PCT = 2.0;

const CAP_TEST  = [4.0, 5.0, 6.0, 7.0, 8.0, 9.0];
const T1_TEST   = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

function makeAcc() {
  return { n: 0, sl: 0, tp: 0, wins: 0, sumPnl: 0, rrokN: 0, rrokSl: 0, rrokTp: 0, rrokWins: 0, rrokPnl: 0 };
}
function comboKey(cap, t1m) { return `${cap}::${t1m}`; }

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
  for (const cap of CAP_TEST)
    for (const t1m of T1_TEST)
      buckets[comboKey(cap, t1m)] = { is: makeAcc(), oos: makeAcc() };

  for (const file of workerData.files) {
    let candles;
    try { candles = parseCSV(file.fp); } catch { continue; }
    if (candles.length < MIN_BARS + MAX_HOLD_CAP) continue;

    for (let i = WINDOW - 1; i < candles.length - 1; i++) {
      const w = candles.slice(Math.max(0, i - WINDOW + 1), i + 1);
      let r;
      try { r = engine.analyzeStock(w, VF_KEY); } catch { continue; }
      if (!ALL_ACTION.has(r.stage)) continue;

      const pe = r.priceEngine;
      if (!pe || !pe.tradeValid) continue;

      const entry = pe.plannedEntry;
      const atr14 = pe.atr14AtEntry;
      const hold  = Math.min(pe.maxHoldBars || 12, MAX_HOLD_CAP);
      const ts    = candles[i].ts;

      if (entry <= 0 || atr14 <= 0) continue;

      const t3    = entry + T3_MULT * atr14;  // T3 fixed for R:R check
      const isOos = ts >= OOS_CUT;

      for (const capTest of CAP_TEST) {
        const newStop   = entry * (1 - capTest / 100);
        const floorStop = entry * (1 - FLOOR_PCT / 100);
        const stop      = Math.min(floorStop, newStop);
        if (stop <= 0 || stop >= entry) continue;

        const riskAbs = entry - stop;
        const rr      = t3 > entry ? (t3 - entry) / riskAbs : 0;
        const isRrok  = rr >= 1.0;

        for (const t1m of T1_TEST) {
          const t1 = entry + t1m * atr14;
          if (t1 <= entry) continue;

          const { outcome, pnl } = simulate(candles, i + 1, entry, stop, t1, hold);

          const ck  = comboKey(capTest, t1m);
          const acc = isOos ? buckets[ck].oos : buckets[ck].is;

          acc.n++;
          acc.sumPnl += pnl;
          if (outcome === 'sl') acc.sl++;
          if (outcome === 'tp') { acc.tp++; acc.wins++; }
          if (outcome === 'time' && pnl > 0) acc.wins++;

          if (isRrok) {
            acc.rrokN++;
            acc.rrokPnl += pnl;
            if (outcome === 'sl') acc.rrokSl++;
            if (outcome === 'tp') { acc.rrokTp++; acc.rrokWins++; }
            if (outcome === 'time' && pnl > 0) acc.rrokWins++;
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

console.log(`\nVF T1-mult × capPct Sweep — ${allFiles.length} stocks · ${NUM_WORKERS} workers`);
console.log(`VF key: ${VF_KEY}`);
console.log(`capPct: ${CAP_TEST.join(', ')}%`);
console.log(`t1Mult: ${T1_TEST.join(', ')}`);
console.log(`T3 fixed at 2.5×ATR. R:R = (T3-entry)/(entry-newStop) ≥ 1.0\n`);

const chunks = Array.from({ length: NUM_WORKERS }, () => []);
allFiles.forEach((f, i) => chunks[i % NUM_WORKERS].push(f));

const agg = {};
for (const cap of CAP_TEST)
  for (const t1m of T1_TEST)
    agg[comboKey(cap, t1m)] = { is: makeAcc(), oos: makeAcc() };

let processed = 0;
let doneCt    = 0;

function printResults() {
  const W = 100;
  console.log('\n' + '='.repeat(W));
  console.log('OOS (2025-01-01+) — VolumeFootprint — T1mult × capPct grid');
  console.log('='.repeat(W));

  // Header
  process.stdout.write(`${'cap%'.padStart(6)} ${'t1m'.padStart(5)}`);
  process.stdout.write(`  ${'N'.padStart(4)}  ${'SL%'.padStart(6)}  ${'TP%'.padStart(6)}  ${'WR%'.padStart(6)}  ${'AvgP&L'.padStart(7)}`);
  process.stdout.write(`  ${'Nrr'.padStart(4)}  ${'SLrr'.padStart(6)}  ${'WRrr'.padStart(6)}  ${'P&Lrr'.padStart(7)}`);
  process.stdout.write(`  Status\n`);
  console.log('-'.repeat(W));

  let bestPnl = { pnl: -999, cap: 0, t1m: 0 };
  let bestSl  = { sl: 999,  cap: 0, t1m: 0 };

  for (const cap of CAP_TEST) {
    for (const t1m of T1_TEST) {
      const a = agg[comboKey(cap, t1m)].oos;
      const { n, sl, tp, wins, sumPnl, rrokN, rrokSl, rrokWins, rrokPnl } = a;
      if (n === 0) continue;

      const slP   = (sl   / n * 100).toFixed(1);
      const tpP   = (tp   / n * 100).toFixed(1);
      const wrP   = (wins / n * 100).toFixed(1);
      const pnl   = (sumPnl / n).toFixed(2);
      const slRr  = rrokN > 0 ? (rrokSl   / rrokN * 100).toFixed(1) : '-';
      const wrRr  = rrokN > 0 ? (rrokWins / rrokN * 100).toFixed(1) : '-';
      const pnlRr = rrokN > 0 ? (rrokPnl  / rrokN).toFixed(2)       : '-';

      const slNum = parseFloat(slP);
      const pnlNum = parseFloat(pnl);
      let status = slNum < 20 ? '✅' : slNum < 30 ? '⚠️ ' : '❌ ';
      if (pnlNum > 0 && slNum < 20) status = '✅✅';

      if (pnlNum > bestPnl.pnl && slNum < 25) bestPnl = { pnl: pnlNum, cap, t1m };
      if (slNum < bestSl.sl && pnlNum > 0) bestSl = { sl: slNum, cap, t1m };

      process.stdout.write(`${String(cap).padStart(6)}%`);
      process.stdout.write(` ${String(t1m).padStart(5)}`);
      process.stdout.write(`  ${String(n).padStart(4)}`);
      process.stdout.write(`  ${slP.padStart(5)}%`);
      process.stdout.write(`  ${tpP.padStart(5)}%`);
      process.stdout.write(`  ${wrP.padStart(5)}%`);
      process.stdout.write(`  ${pnl.padStart(7)}%`);
      process.stdout.write(`  ${String(rrokN).padStart(4)}`);
      process.stdout.write(`  ${slRr.padStart(5)}%`);
      process.stdout.write(`  ${wrRr.padStart(5)}%`);
      process.stdout.write(`  ${pnlRr.padStart(7)}%`);
      process.stdout.write(`  ${status}\n`);
    }
    console.log('');
  }

  console.log('='.repeat(W));
  console.log(`\nBest P&L  (SL<25%): cap=${bestPnl.cap}%  t1m=${bestPnl.t1m}  P&L=${bestPnl.pnl.toFixed(2)}%`);
  console.log(`Best SL%  (P&L>0): cap=${bestSl.cap}%  t1m=${bestSl.t1m}  SL=${bestSl.sl.toFixed(1)}%\n`);

  console.log('NOTES');
  console.log(' - N = all OOS VF signals (tradeValid at engine defaults)');
  console.log(' - Nrr = subset where T3/riskAbs >= 1.0 at the test capPct');
  console.log(' - T3 = entry + 2.5×ATR (VF fixed, not swept)');
  console.log(' - T1 = entry + t1Mult×ATR (swept — current engine uses 0.75)');
  console.log(' - Wider stop = more signals survive = more reach T1');
  console.log(' - Higher T1 = each win worth more, but harder to reach');
}

chunks.map(files => {
  const w = new Worker(__filename, { workerData: { files } });
  w.on('message', msg => {
    if (msg.type === 'progress') {
      processed++;
      if (processed % 100 === 0) process.stdout.write(`  Scanning ${processed}/${allFiles.length}\r`);
    } else if (msg.type === 'done') {
      for (const ck of Object.keys(msg.buckets)) {
        if (!agg[ck]) continue;
        for (const p of ['is', 'oos']) {
          const src = msg.buckets[ck][p];
          const dst = agg[ck][p];
          for (const f of ['n','sl','tp','wins','sumPnl','rrokN','rrokSl','rrokTp','rrokWins','rrokPnl'])
            dst[f] += src[f];
        }
      }
      doneCt++;
      if (doneCt === NUM_WORKERS) printResults();
    }
  });
  w.on('error', e => console.error('Worker error:', e.message));
});
