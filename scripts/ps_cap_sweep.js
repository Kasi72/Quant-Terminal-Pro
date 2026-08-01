'use strict';
// PerfectStorm capPct sweep.
// PS (sniper_95plus) is 100% cap-bound at avg stop=12.5% (HIGH-band, non-ORS/VF).
// Current capPct = 12.5%. SL=25%, P&L=+0.10%, PF=1.03x — nearly breakeven.
//
// PS archetype: HIGH-band (atrPct≥3.5%), t1Mult=1.5, t3Mult=5.0
//   T1 = entry + 1.5 × atr14
//   T3 = entry + 5.0 × atr14
//   R:R = (T3-entry)/(entry-newStop) = 5×atrPct / capPct
//   R:R≥1.0 requires: capPct ≤ 5×atrPct
//   For atrPct=3.5%: capPct ≤ 17.5%
//   For atrPct=4.0%: capPct ≤ 20.0%
//   For atrPct=5.0%: capPct ≤ 25.0%
//
// Wider cap → fewer SL hits (stock needs deeper drop) but bigger loss per SL.

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

const PS_KEY     = 'sniper_95plus';
const ALL_ACTION = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

const T3_MULT   = 5.0;   // PS: t1Mult=1.5, t3Mult=1.5×(10/3)=5.0
const FLOOR_PCT = 2.0;

const CAP_TEST  = [10.0, 12.5, 15.0, 17.5, 20.0, 25.0];

function makeAcc() {
  return { n: 0, sl: 0, tp: 0, timeExit: 0, wins: 0,
           grossWin: 0, grossLoss: 0, sumPnl: 0,
           rrokN: 0, rrokSl: 0, rrokWins: 0, rrokPnl: 0,
           sumStop: 0, sumMFE: 0 };
}
function comboKey(cap) { return `${cap}`; }

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
    let maxHigh = entry;
    const end = Math.min(startIdx + hold, candles.length - 1);
    for (let j = startIdx; j <= end; j++) {
      const b = candles[j];
      if (b.h > maxHigh) maxHigh = b.h;
      const slHit = b.l <= stop;
      const tpHit = b.h >= t1;
      const mfe = (maxHigh - entry) / entry * 100;
      if (slHit && tpHit) {
        return b.o <= stop
          ? { outcome: 'sl', pnl: (stop - entry) / entry * 100, mfe }
          : { outcome: 'tp', pnl: (t1   - entry) / entry * 100, mfe };
      }
      if (slHit) return { outcome: 'sl', pnl: (stop - entry) / entry * 100, mfe };
      if (tpHit) return { outcome: 'tp', pnl: (t1   - entry) / entry * 100, mfe };
    }
    return { outcome: 'time', pnl: (candles[end].c - entry) / entry * 100, mfe: (maxHigh - entry) / entry * 100 };
  }

  const buckets = {};
  for (const cap of CAP_TEST)
    buckets[comboKey(cap)] = { is: makeAcc(), oos: makeAcc() };

  for (const file of workerData.files) {
    let candles;
    try { candles = parseCSV(file.fp); } catch { continue; }
    if (candles.length < MIN_BARS + MAX_HOLD_CAP) continue;

    for (let i = WINDOW - 1; i < candles.length - 1; i++) {
      const w = candles.slice(Math.max(0, i - WINDOW + 1), i + 1);
      let r;
      try { r = engine.analyzeStock(w, PS_KEY); } catch { continue; }
      if (!ALL_ACTION.has(r.stage)) continue;

      const pe = r.priceEngine;
      if (!pe || !pe.tradeValid) continue;

      const entry = pe.plannedEntry;
      const atr14 = pe.atr14AtEntry;
      const t1    = pe.target5;   // T1 from engine (1.5×ATR-based)
      const hold  = Math.min(pe.maxHoldBars || 20, MAX_HOLD_CAP);
      const ts    = candles[i].ts;

      if (entry <= 0 || atr14 <= 0 || t1 <= entry) continue;

      const t3    = entry + T3_MULT * atr14;
      const isOos = ts >= OOS_CUT;

      for (const capTest of CAP_TEST) {
        const newStop   = entry * (1 - capTest / 100);
        const floorStop = entry * (1 - FLOOR_PCT / 100);
        const stop      = Math.min(floorStop, newStop);
        if (stop <= 0 || stop >= entry) continue;

        const riskAbs = entry - stop;
        const rr      = t3 > entry ? (t3 - entry) / riskAbs : 0;
        const isRrok  = rr >= 1.0;

        const { outcome, pnl, mfe } = simulate(candles, i + 1, entry, stop, t1, hold);
        const stopPct = riskAbs / entry * 100;

        const ck  = comboKey(capTest);
        const acc = isOos ? buckets[ck].oos : buckets[ck].is;

        acc.n++;
        acc.sumPnl  += pnl;
        acc.sumStop += stopPct;
        acc.sumMFE  += mfe;
        if (outcome === 'sl') acc.sl++;
        if (outcome === 'tp') { acc.tp++; acc.wins++; }
        if (outcome === 'time') { acc.timeExit++; if (pnl > 0) acc.wins++; }
        if (pnl > 0) acc.grossWin  += pnl;
        if (pnl < 0) acc.grossLoss += Math.abs(pnl);

        if (isRrok) {
          acc.rrokN++;
          acc.rrokPnl += pnl;
          if (outcome === 'sl') acc.rrokSl++;
          if (outcome === 'tp' || (outcome === 'time' && pnl > 0)) acc.rrokWins++;
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

console.log(`\nPS capPct Sweep — PerfectStorm (sniper_95plus)`);
console.log(`${allFiles.length} stocks · ${NUM_WORKERS} workers · OOS cut: 2025-01-01`);
console.log(`T3=5.0×ATR, T1=pe.target5. R:R = (T3-entry)/(entry-newStop) ≥ 1.0`);
console.log(`Test caps: ${CAP_TEST.join(', ')}%  (current: 12.5% for HIGH-band non-ORS/VF)\n`);

const chunks = Array.from({ length: NUM_WORKERS }, () => []);
allFiles.forEach((f, i) => chunks[i % NUM_WORKERS].push(f));

const agg = {};
for (const cap of CAP_TEST)
  agg[comboKey(cap)] = { is: makeAcc(), oos: makeAcc() };

let processed = 0;
let doneCt    = 0;

function printResults() {
  const W = 120;
  console.log('\n' + '='.repeat(W));
  console.log('OUT-OF-SAMPLE (2025-01-01+) — PerfectStorm capPct sweep');
  console.log('='.repeat(W));
  console.log('  Cap%    N     SL%    TP%  TIME%    WR%  AvgP&L%     PF  AvgStop%  AvgMFE%  Nrr  SLrr%  WRrr%  P&Lrr%  Status');
  console.log('-'.repeat(W));

  let bestSl  = { sl: 999, cap: 0 };
  let bestPnl = { pnl: -999, cap: 0 };

  for (const cap of CAP_TEST) {
    const a = agg[comboKey(cap)].oos;
    const { n, sl, tp, timeExit, wins, grossWin, grossLoss, sumPnl, sumStop, sumMFE,
            rrokN, rrokSl, rrokWins, rrokPnl } = a;
    if (n === 0) continue;

    const slP    = (sl   / n * 100).toFixed(1);
    const tpP    = (tp   / n * 100).toFixed(1);
    const timeP  = (timeExit / n * 100).toFixed(1);
    const wrP    = (wins / n * 100).toFixed(1);
    const avgPnl = (sumPnl / n).toFixed(2);
    const pf     = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : grossWin > 0 ? '∞' : '0.00';
    const avgSt  = (sumStop / n).toFixed(1);
    const avgMfe = (sumMFE  / n).toFixed(1);
    const slRr   = rrokN > 0 ? (rrokSl   / rrokN * 100).toFixed(1) : '-';
    const wrRr   = rrokN > 0 ? (rrokWins / rrokN * 100).toFixed(1) : '-';
    const pnlRr  = rrokN > 0 ? (rrokPnl  / rrokN).toFixed(2)       : '-';

    const slNum  = parseFloat(slP);
    const pnlNum = parseFloat(avgPnl);
    const curr   = cap === 12.5 ? ' ← current' : '';
    const status = slNum < 20 ? '✅' : slNum < 25 ? '⚠️ ' : '❌ ';

    if (slNum < bestSl.sl && pnlNum > 0) bestSl = { sl: slNum, cap };
    if (pnlNum > bestPnl.pnl && slNum < 30) bestPnl = { pnl: pnlNum, cap };

    console.log(
      `  ${String(cap).padStart(4)}%` +
      `  ${String(n).padStart(4)}` +
      `  ${slP.padStart(5)}%` +
      `  ${tpP.padStart(5)}%` +
      `  ${timeP.padStart(5)}%` +
      `  ${wrP.padStart(5)}%` +
      `  ${avgPnl.padStart(6)}%` +
      `  ${String(pf).padStart(6)}x` +
      `  ${avgSt.padStart(7)}%` +
      `  ${avgMfe.padStart(6)}%` +
      `  ${String(rrokN).padStart(4)}` +
      `  ${slRr.padStart(5)}%` +
      `  ${wrRr.padStart(5)}%` +
      `  ${pnlRr.padStart(6)}%` +
      `  ${status}${curr}`
    );
  }

  console.log('='.repeat(W));
  console.log(`\nBest SL% (P&L>0): cap=${bestSl.cap}%  SL=${bestSl.sl}%`);
  console.log(`Best P&L (SL<30%): cap=${bestPnl.cap}%  P&L=+${bestPnl.pnl}%`);
  console.log('\nrrok = signals where (T3-entry)/riskAbs >= 1.0 at test cap. R:R=5×atrPct/capPct.\n');
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
          for (const f of ['n','sl','tp','timeExit','wins','grossWin','grossLoss','sumPnl',
                           'sumStop','sumMFE','rrokN','rrokSl','rrokWins','rrokPnl'])
            dst[f] += src[f];
        }
      }
      doneCt++;
      if (doneCt === NUM_WORKERS) printResults();
    }
  });
  w.on('error', e => console.error('Worker error:', e.message));
});
