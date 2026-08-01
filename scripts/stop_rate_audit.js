'use strict';
const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR    = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR  = path.join(__dirname, '_compiled_current');
const WINDOW      = 300;
const MIN_BARS    = 200;
const OOS_CUT     = new Date('2025-01-01').getTime() / 1000;
const MAX_HOLD_CAP = 40;   // hard cap on simulation horizon
const NUM_WORKERS = 10;

const PARAM_KEYS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  'ors_prime_reversal',
  'circuit_breaker_v2',
];

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

// Returns 'sl' | 'tp' | 'time' + pnlPct
function simulateTrade(candles, sigIdx, stop, t1, hold) {
  const entry = candles[sigIdx].c;
  const end = Math.min(sigIdx + hold, candles.length - 1);
  for (let j = sigIdx + 1; j <= end; j++) {
    const bar = candles[j];
    const slHit = bar.l <= stop;
    const tpHit = bar.h >= t1;
    if (slHit && tpHit) {
      // Same bar: use open to break tie
      if (bar.o <= stop) return { outcome: 'sl', pnl: (stop - entry) / entry * 100 };
      return { outcome: 'tp', pnl: (t1 - entry) / entry * 100 };
    }
    if (slHit) return { outcome: 'sl', pnl: (stop - entry) / entry * 100 };
    if (tpHit) return { outcome: 'tp', pnl: (t1 - entry) / entry * 100 };
  }
  // Time exit at close of last bar
  const exitClose = candles[end].c;
  return { outcome: 'time', pnl: (exitClose - entry) / entry * 100 };
}

// ── WORKER ───────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

  const makeAcc = () => ({ n: 0, sl: 0, tp: 0, time: 0, wins: 0, sumPnl: 0 });
  const is  = {};
  const oos = {};
  for (const k of PARAM_KEYS) { is[k] = makeAcc(); oos[k] = makeAcc(); }

  for (const file of workerData.files) {
    let candles;
    try { candles = parseCSV(file.fp); } catch (e) { continue; }
    if (candles.length < MIN_BARS + MAX_HOLD_CAP) continue;

    for (const key of PARAM_KEYS) {
      for (let i = WINDOW - 1; i < candles.length - 1; i++) {
        const w = candles.slice(Math.max(0, i - WINDOW + 1), i + 1);
        let r;
        try { r = engine.analyzeStock(w, key); } catch (e) { continue; }
        if (!ACTIONABLE.has(r.stage)) continue;

        const pe = r.priceEngine;
        if (!pe || !pe.tradeValid) continue;

        const entry = pe.plannedEntry;
        const stop  = pe.tacticalStop;
        const t1    = pe.target5;
        const hold  = Math.min(pe.maxHoldBars || 20, MAX_HOLD_CAP);

        if (!entry || entry <= 0 || !stop || stop >= entry || !t1 || t1 <= entry) continue;

        const { outcome, pnl } = simulateTrade(candles, i, stop, t1, hold);
        const bucket = candles[i].ts >= OOS_CUT ? oos[key] : is[key];

        bucket.n++;
        bucket.sumPnl += pnl;
        if (outcome === 'sl')   { bucket.sl++;   }
        if (outcome === 'tp')   { bucket.tp++;   bucket.wins++; }
        if (outcome === 'time') { bucket.time++; if (pnl > 0) bucket.wins++; }
      }
    }
    parentPort.postMessage({ type: 'progress' });
  }

  parentPort.postMessage({ type: 'done', is, oos });
  return;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
const allFiles = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv'))
  .map(name => ({ name, fp: path.join(DATA_DIR, name) }));

console.log(`\nStop Rate Audit — ${allFiles.length} stocks · ${NUM_WORKERS} workers`);
console.log(`Exit logic: SL=tacticalStop | TP=target5 (T1) | TIME=maxHoldBars expired`);
console.log(`OOS cut: 2025-01-01 | Target: SL% < 20%\n`);

const chunks = Array.from({ length: NUM_WORKERS }, () => []);
allFiles.forEach((f, i) => chunks[i % NUM_WORKERS].push(f));

const totIS  = {};
const totOOS = {};
for (const k of PARAM_KEYS) {
  totIS[k]  = { n: 0, sl: 0, tp: 0, time: 0, wins: 0, sumPnl: 0 };
  totOOS[k] = { n: 0, sl: 0, tp: 0, time: 0, wins: 0, sumPnl: 0 };
}

let processed = 0;
let doneCt = 0;

chunks.map(files => {
  const w = new Worker(__filename, { workerData: { files } });
  w.on('message', msg => {
    if (msg.type === 'progress') {
      processed++;
      if (processed % 100 === 0) process.stdout.write(`  Processed ${processed}/${allFiles.length}\r`);
    } else if (msg.type === 'done') {
      for (const k of PARAM_KEYS) {
        for (const field of ['n','sl','tp','time','wins','sumPnl']) {
          totIS[k][field]  += msg.is[k][field];
          totOOS[k][field] += msg.oos[k][field];
        }
      }
      doneCt++;
      if (doneCt === NUM_WORKERS) printResults();
    }
  });
  w.on('error', e => console.error('Worker error:', e.message));
});

const LABELS = {
  'optimized_deployable_20plus':    'VolumeFootprint ',
  'optimized_highprecision_15plus': 'CompressionCoil ',
  'optimized_elite_10plus':         'MomentumPocket  ',
  'optimized_ultraselective_8plus': 'EMAStack        ',
  'sniper_95plus':                  'PerfectStorm    ',
  'ors_prime_reversal':             'ORS-Prime       ',
  'circuit_breaker_v2':             'CircuitBreaker  ',
};

function fmt(n, t) {
  if (t === 0) return '  — ';
  return (n / t * 100).toFixed(1).padStart(5);
}

function printBlock(label, tot) {
  const W = 90;
  console.log('='.repeat(W));
  console.log(label);
  console.log('='.repeat(W));
  console.log('  Archetype            N      SL%     TP%   TIME%    WR%   Avg P&L%   Status');
  console.log('-'.repeat(W));
  for (const k of PARAM_KEYS) {
    const t = tot[k];
    if (t.n === 0) {
      console.log(`  ${LABELS[k]}  (no signals in period)`);
      continue;
    }
    const slPct  = parseFloat(fmt(t.sl, t.n));
    const tpPct  = fmt(t.tp, t.n);
    const tmPct  = fmt(t.time, t.n);
    const wrPct  = fmt(t.wins, t.n);
    const avgPnl = (t.sumPnl / t.n).toFixed(2);
    const status = slPct < 20 ? '✅ <20%' : slPct < 30 ? '⚠️  HIGH' : '❌ CRIT';
    console.log(
      `  ${LABELS[k]}` +
      `  n=${String(t.n).padStart(4)}` +
      `  SL=${String(slPct.toFixed(1)).padStart(5)}%` +
      `  TP=${tpPct}%` +
      `  TIME=${tmPct}%` +
      `  WR=${wrPct}%` +
      `  ${avgPnl >= 0 ? '+' : ''}${avgPnl}%` +
      `   ${status}`
    );
  }
}

function printResults() {
  console.log('\n\n');
  printBlock('IN-SAMPLE (before 2025-01-01)', totIS);
  console.log('');
  printBlock('OUT-OF-SAMPLE (2025-01-01 onward)', totOOS);
  console.log('='.repeat(90));
  console.log('\nNote: TP = target5 (T1 first target). SL% <20% = acceptable stop rate.');
  console.log('Win = TP hit OR time-exit with positive P&L.\n');
}
