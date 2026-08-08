'use strict';
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

const SWEEP_KEYS = [
  'optimized_deployable_20plus',    // VF
  'ors_prime_reversal',             // ORS
  'sniper_95plus',                  // PS
  'optimized_ultraselective_8plus', // ES
];

const ALL_ACTION   = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
const STRONG_ONLY  = new Set(['STRONG_BUY', 'ULTRA_STRONG_BUY']);

// Multipliers to test per archetype
const MULTS = {
  'optimized_deployable_20plus':    [3.5, 4.5, 5.5],
  'ors_prime_reversal':             [3.0, 4.0, 4.5, 5.0],
  'sniper_95plus':                  [4.0, 4.5, 5.0, 5.5],
  'optimized_ultraselective_8plus': [3.5, 4.0, 4.5],
};

const IS_OV = {
  'optimized_deployable_20plus':    true,
  'ors_prime_reversal':             true,
  'sniper_95plus':                  false,
  'optimized_ultraselective_8plus': false,
};

// Combo keys: "archetype::mult::stageFilter"
function comboKey(key, mult, stage) { return `${key}::${mult}::${stage}`; }

// Replicate engine cap/floor formula (structStop ignored)
function effectiveStop(entry, atr14, mult, isOrsVf) {
  const atrPct  = atr14 / entry * 100;
  const capPct  = atrPct < 1.5 ? 6.0
                : atrPct < 2.5 ? 4.0
                : atrPct < 3.5 ? 5.5
                : isOrsVf      ? 4.0
                : 12.5;
  const floorPct = 2.0;
  const atrStop   = entry - mult * atr14;
  const capStop   = entry * (1 - capPct  / 100);
  const floorStop = entry * (1 - floorPct / 100);
  return { stop: Math.min(floorStop, Math.max(capStop, atrStop)), capStop, capPct };
}

function simulate(candles, startIdx, entry, stop, t1, hold) {
  const end = Math.min(startIdx + hold, candles.length - 1);
  for (let j = startIdx; j <= end; j++) {
    const b = candles[j];
    const slHit = b.l <= stop;
    const tpHit = b.h >= t1;
    if (slHit && tpHit) {
      return b.o <= stop
        ? { outcome: 'sl',   pnl: (stop - entry) / entry * 100 }
        : { outcome: 'tp',   pnl: (t1   - entry) / entry * 100 };
    }
    if (slHit) return { outcome: 'sl',   pnl: (stop - entry) / entry * 100 };
    if (tpHit) return { outcome: 'tp',   pnl: (t1   - entry) / entry * 100 };
  }
  return { outcome: 'time', pnl: (candles[end].c - entry) / entry * 100 };
}

function makeAcc() { return { n: 0, sl: 0, tp: 0, wins: 0, sumPnl: 0, sumStop: 0, capBound: 0 }; }

// ── WORKER: simulate all combos per signal ────────────────────────────────────
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

  // Build all combo buckets (is + oos)
  const buckets = {};
  for (const key of SWEEP_KEYS) {
    const mults = MULTS[key];
    const stages = key === 'optimized_deployable_20plus'
      ? ['all', 'strong']
      : ['all'];
    for (const mult of mults) {
      for (const stage of stages) {
        const ck = comboKey(key, mult, stage);
        buckets[ck] = { is: makeAcc(), oos: makeAcc() };
      }
    }
  }

  for (const file of workerData.files) {
    let candles;
    try { candles = parseCSV(file.fp); } catch { continue; }
    if (candles.length < MIN_BARS + MAX_HOLD_CAP) continue;

    for (const key of SWEEP_KEYS) {
      const mults  = MULTS[key];
      const isOrsV = IS_OV[key];
      const hasStrong = key === 'optimized_deployable_20plus';

      for (let i = WINDOW - 1; i < candles.length - 1; i++) {
        const w = candles.slice(Math.max(0, i - WINDOW + 1), i + 1);
        let r;
        try { r = engine.analyzeStock(w, key); } catch { continue; }
        if (!ALL_ACTION.has(r.stage)) continue;

        const pe = r.priceEngine;
        if (!pe || !pe.tradeValid) continue;

        const entry  = pe.plannedEntry;
        const atr14  = pe.atr14AtEntry;
        const t1     = pe.target5;
        const hold   = Math.min(pe.maxHoldBars || 20, MAX_HOLD_CAP);
        const ts     = candles[i].ts;
        const stage  = r.stage;

        if (entry <= 0 || atr14 <= 0 || t1 <= entry) continue;

        const isOos  = ts >= OOS_CUT;
        const isStrg = STRONG_ONLY.has(stage);

        // Test all multiplier combinations for this archetype
        for (const mult of mults) {
          const { stop, capStop } = effectiveStop(entry, atr14, mult, isOrsV);
          if (stop <= 0 || stop >= entry) continue;

          const stopPct  = (entry - stop) / entry * 100;
          const capBound = (entry - mult * atr14) < capStop ? 1 : 0; // atrStop would be wider than cap

          const { outcome, pnl } = simulate(candles, i + 1, entry, stop, t1, hold);

          const stageKeys = ['all'];
          if (hasStrong && isStrg) stageKeys.push('strong');

          for (const sk of stageKeys) {
            const ck  = comboKey(key, mult, sk);
            const bkt = buckets[ck];
            if (!bkt) continue;
            const acc = isOos ? bkt.oos : bkt.is;
            acc.n++;
            acc.sumPnl  += pnl;
            acc.sumStop += stopPct;
            acc.capBound += capBound;
            if (outcome === 'sl') acc.sl++;
            if (outcome === 'tp') { acc.tp++; acc.wins++; }
            if (outcome === 'time' && pnl > 0) acc.wins++;
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

console.log(`\nSL Multiplier Sweep — ${allFiles.length} stocks · ${NUM_WORKERS} workers`);
console.log(`Archetypes: VF / ORS / PS / EMAStack   OOS cut: 2025-01-01`);
console.log(`CapBind%: pct of signals where stop capped (mult change = no-op for those)\n`);

const chunks = Array.from({ length: NUM_WORKERS }, () => []);
allFiles.forEach((f, i) => chunks[i % NUM_WORKERS].push(f));

// Aggregate buckets
const agg = {};
for (const key of SWEEP_KEYS) {
  for (const mult of MULTS[key]) {
    const stages = key === 'optimized_deployable_20plus' ? ['all', 'strong'] : ['all'];
    for (const stage of stages) {
      const ck = comboKey(key, mult, stage);
      agg[ck] = { is: makeAcc(), oos: makeAcc() };
    }
  }
}

let processed = 0;
let doneCt    = 0;

const LABELS = {
  'optimized_deployable_20plus':    'VolumeFootprint',
  'ors_prime_reversal':             'ORS-Prime      ',
  'sniper_95plus':                  'PerfectStorm   ',
  'optimized_ultraselective_8plus': 'EMAStack       ',
};

function printResults() {
  const W = 112;
  console.log('\n' + '='.repeat(W));
  console.log('OUT-OF-SAMPLE (2025-01-01 onward)');
  console.log('='.repeat(W));
  console.log('  Archetype        Mult  Filter    N      SL%    TP%    WR%   AvgP&L%  AvgStop%  CapBnd%  Status');
  console.log('-'.repeat(W));

  for (const key of SWEEP_KEYS) {
    const stages = key === 'optimized_deployable_20plus' ? ['all', 'strong'] : ['all'];
    for (const stage of stages) {
      for (const mult of MULTS[key]) {
        const ck  = comboKey(key, mult, stage);
        const acc = agg[ck].oos;
        const { n, sl, tp, wins, sumPnl, sumStop, capBound } = acc;
        if (n === 0) { console.log(`  ${LABELS[key]}  ${mult.toFixed(1)}×  ${stage}  (no signals)`); continue; }
        const slPct   = sl   / n * 100;
        const tpPct   = tp   / n * 100;
        const wrPct   = wins / n * 100;
        const avgPnl  = sumPnl  / n;
        const avgStop = sumStop / n;
        const capPct2 = capBound / n * 100;
        const status  = slPct < 20 ? '✅' : slPct < 30 ? '⚠️ ' : '❌ ';
        console.log(
          `  ${LABELS[key]}  ${mult.toFixed(1)}×  ${stage.padEnd(6)}` +
          `  n=${String(n).padStart(4)}` +
          `  SL=${slPct.toFixed(1).padStart(5)}%` +
          `  TP=${tpPct.toFixed(1).padStart(5)}%` +
          `  WR=${wrPct.toFixed(1).padStart(5)}%` +
          `  ${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(2).padStart(6)}%` +
          `  stop=${avgStop.toFixed(1).padStart(4)}%` +
          `  cap=${capPct2.toFixed(0).padStart(3)}%` +
          `  ${status}`
        );
      }
    }
    console.log('');
  }
  console.log('='.repeat(W));
  console.log('\nCapBnd%=100 for a row means slAtrMult had zero effect → fix is in capPct formula, not mult.\n');
}

chunks.map(files => {
  const w = new Worker(__filename, { workerData: { files } });
  w.on('message', msg => {
    if (msg.type === 'progress') {
      processed++;
      if (processed % 100 === 0) process.stdout.write(`  Collecting: ${processed}/${allFiles.length}\r`);
    } else if (msg.type === 'done') {
      // Merge worker buckets into agg
      for (const ck of Object.keys(msg.buckets)) {
        if (!agg[ck]) continue;
        for (const period of ['is', 'oos']) {
          const src = msg.buckets[ck][period];
          const dst = agg[ck][period];
          for (const field of ['n','sl','tp','wins','sumPnl','sumStop','capBound']) {
            dst[field] += src[field];
          }
        }
      }
      doneCt++;
      if (doneCt === NUM_WORKERS) printResults();
    }
  });
  w.on('error', e => console.error('Worker error:', e.message));
});
