'use strict';
// VF threshold sweep — validate Brain finding that vol≥5x and rangeATR≥3.5 are too strict.
// Tests vol in {3.0, 3.5, 4.0, 4.5, 5.0} × rangeATR in {1.5, 2.0, 2.5, 3.0, 3.5}
// Also tests current gate: atrPct≥3.6 (added in VF capPct sweep 2026-08-01).
// Uses real engine pe.tacticalStop + pe.target5 + pe.maxHoldBars — no re-simulation.
//
// VF OOS baseline (cap=9%, atrPct≥3.6): n=45, SL=20.0%, WR=80.0%, P&L=+0.88%
// Brain: UC stocks avg vol=2.0x, rangeATR=1.2x at D-1 → current thresholds miss most UC events

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR     = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR   = path.join(__dirname, '_sweep_vf'); // patched: vol≥3.0, rangeATR≥1.5
const WINDOW       = 300;
const MIN_BARS     = 200;
const OOS_CUT      = new Date('2025-01-01').getTime() / 1000;
const MAX_HOLD_CAP = 40;
const NUM_WORKERS  = 10;

const VF_KEY    = 'optimized_deployable_20plus';
const ALL_ACTION = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

// Grid to test
const VOL_LEVELS = [3.0, 3.5, 4.0, 4.5, 5.0];
const ATR_LEVELS = [1.5, 2.0, 2.5, 3.0, 3.5];

function comboKey(vol, atr) { return `${vol}_${atr}`; }

function makeAcc() {
  return { n: 0, sl: 0, tp: 0, timeExit: 0, wins: 0,
           grossWin: 0, grossLoss: 0, sumPnl: 0, sumMFE: 0, sumStop: 0 };
}

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
    let maxH = entry, minL = entry;
    const end = Math.min(startIdx + hold, candles.length - 1);
    for (let j = startIdx; j <= end; j++) {
      const b = candles[j];
      if (b.h > maxH) maxH = b.h;
      if (b.l < minL) minL = b.l;
      const slHit = b.l <= stop, tpHit = b.h >= t1;
      const mfe = (maxH - entry) / entry * 100;
      if (slHit && tpHit)
        return b.o <= stop
          ? { outcome: 'sl', pnl: (stop - entry) / entry * 100, mfe }
          : { outcome: 'tp', pnl: (t1   - entry) / entry * 100, mfe };
      if (slHit) return { outcome: 'sl', pnl: (stop - entry) / entry * 100, mfe };
      if (tpHit) return { outcome: 'tp', pnl: (t1   - entry) / entry * 100, mfe };
    }
    return { outcome: 'time', pnl: (candles[end].c - entry) / entry * 100, mfe: (maxH - entry) / entry * 100 };
  }

  // Build buckets for each combo
  const buckets = {};
  for (const vol of VOL_LEVELS)
    for (const atr of ATR_LEVELS)
      buckets[comboKey(vol, atr)] = { is: makeAcc(), oos: makeAcc() };

  for (const file of workerData.files) {
    let candles;
    try { candles = parseCSV(file.fp); } catch { continue; }
    if (candles.length < MIN_BARS + MAX_HOLD_CAP) continue;

    for (let i = WINDOW - 1; i < candles.length - 1; i++) {
      const w = candles.slice(Math.max(0, i - WINDOW + 1), i + 1);

      // Get base engine signal at VF key (uses engine's current thresholds)
      let r;
      try { r = engine.analyzeStock(w, VF_KEY); } catch { continue; }
      if (!ALL_ACTION.has(r.stage)) continue;

      const pe = r.priceEngine;
      if (!pe || !pe.tradeValid) continue;

      const entry   = pe.plannedEntry;
      const stop    = pe.tacticalStop;
      const t1      = pe.target5;
      const hold    = Math.min(pe.maxHoldBars || 12, MAX_HOLD_CAP);
      const ts      = candles[i].ts;
      const isOos   = ts >= OOS_CUT;

      // Read raw VF features from result
      const vol20 = (r.exactVolRatio20 != null ? r.exactVolRatio20 : r.volRatio20) || 0;
      const rATR  = (r.exactRangeATR14 != null ? r.exactRangeATR14 : r.volatilityExpansionRatio) || 0;

      if (entry <= 0 || stop <= 0 || stop >= entry || t1 <= entry) continue;

      const res = simulate(candles, i + 1, entry, stop, t1, hold);
      const stopPct = (entry - stop) / entry * 100;

      // Check each threshold combo — count signal in combo if it would have fired
      for (const vol of VOL_LEVELS) {
        for (const atr of ATR_LEVELS) {
          if (vol20 >= vol && rATR >= atr) {
            const ck = comboKey(vol, atr);
            const acc = isOos ? buckets[ck].oos : buckets[ck].is;
            acc.n++;
            acc.sumPnl += res.pnl;
            acc.sumMFE += res.mfe;
            acc.sumStop += stopPct;
            if (res.outcome === 'sl') acc.sl++;
            if (res.outcome === 'tp') { acc.tp++; acc.wins++; }
            if (res.outcome === 'time') { acc.timeExit++; if (res.pnl > 0) acc.wins++; }
            if (res.pnl > 0) acc.grossWin  += res.pnl;
            if (res.pnl < 0) acc.grossLoss += Math.abs(res.pnl);
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

console.log(`\nVF Threshold Sweep — VolumeFootprint (optimized_deployable_20plus)`);
console.log(`${allFiles.length} stocks · ${NUM_WORKERS} workers · OOS cut: 2025-01-01`);
console.log(`Vol grid: ${VOL_LEVELS.join(', ')}×  |  RangeATR grid: ${ATR_LEVELS.join(', ')}×`);
console.log(`Note: uses engine signals passing current vol=5.0/atr=3.5 gate, then down-filters.`);
console.log(`Current OOS baseline (cap=9%): n=45, SL=20.0%, WR=80.0%, P&L=+0.88%\n`);

const chunks = Array.from({ length: NUM_WORKERS }, () => []);
allFiles.forEach((f, i) => chunks[i % NUM_WORKERS].push(f));

const agg = {};
for (const vol of VOL_LEVELS)
  for (const atr of ATR_LEVELS)
    agg[comboKey(vol, atr)] = { is: makeAcc(), oos: makeAcc() };

let processed = 0, doneCt = 0;

function printResults() {
  const W = 115;
  console.log('\n' + '='.repeat(W));
  console.log('OUT-OF-SAMPLE (2025-01-01+) — VF threshold sweep (signals passing vol≥X AND rangeATR≥Y)');
  console.log('='.repeat(W));
  console.log('  Vol×  ATR×    N     SL%    WR%  AvgP&L%     PF  AvgStop%  AvgMFE%  Status');
  console.log('-'.repeat(W));

  // Print grid sorted by vol then atr
  let bestPnl = { pnl: -999, vol: 0, atr: 0 };

  for (const vol of VOL_LEVELS) {
    for (const atr of ATR_LEVELS) {
      const a = agg[comboKey(vol, atr)].oos;
      const { n, sl, wins, grossWin, grossLoss, sumPnl, sumMFE, sumStop } = a;
      if (n === 0) {
        console.log(`  ${String(vol).padEnd(4)}  ${String(atr).padEnd(4)}   (no signals)`);
        continue;
      }
      const slP    = (sl   / n * 100).toFixed(1);
      const wrP    = (wins / n * 100).toFixed(1);
      const avgPnl = (sumPnl / n).toFixed(2);
      const pf     = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : grossWin > 0 ? '∞' : '0.00';
      const avgSt  = (sumStop / n).toFixed(1);
      const avgMfe = (sumMFE  / n).toFixed(1);

      const slNum  = parseFloat(slP);
      const pnlNum = parseFloat(avgPnl);
      const curr   = (vol === 5.0 && atr === 3.5) ? ' ← current' : '';
      const status = slNum < 20 && pnlNum > 0.5 ? '✅✅' : slNum < 20 && pnlNum > 0 ? '✅' : slNum < 25 && pnlNum > 0 ? '⚠️ ' : '❌ ';

      if (pnlNum > bestPnl.pnl && n >= 30 && slNum < 25) bestPnl = { pnl: pnlNum, vol, atr };

      console.log(
        `  ${String(vol).padEnd(4)}  ${String(atr).padEnd(4)}` +
        `  ${String(n).padStart(4)}` +
        `  ${slP.padStart(5)}%` +
        `  ${wrP.padStart(5)}%` +
        `  ${avgPnl.padStart(6)}%` +
        `  ${String(pf).padStart(6)}x` +
        `  ${avgSt.padStart(7)}%` +
        `  ${avgMfe.padStart(6)}%` +
        `  ${status}${curr}`
      );
    }
    console.log('');
  }

  console.log('='.repeat(W));
  console.log(`Best OOS P&L (n≥30, SL<25%): vol=${bestPnl.vol}×, rangeATR=${bestPnl.atr}×, P&L=+${bestPnl.pnl}%`);
  console.log('\nNote: down-filtering from current engine signals (vol≥5.0 AND rangeATR≥3.5).');
  console.log('Looser combos require engine-level change to produce truly new signals.\n');
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
          const src = msg.buckets[ck][p], dst = agg[ck][p];
          for (const f of ['n','sl','tp','timeExit','wins','grossWin','grossLoss','sumPnl','sumMFE','sumStop'])
            dst[f] += src[f];
        }
      }
      doneCt++;
      if (doneCt === NUM_WORKERS) printResults();
    }
  });
  w.on('error', e => console.error('Worker error:', e.message));
});
