'use strict';

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR   = process.env.DATA_DIR   || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OOS_CUT    = process.env.OOS_CUT    || '2025-01-01';

const TP_PCT    = Number(process.env.TP    || 5);
const SL_ATR    = Number(process.env.SL    || 4);
const MAX_HOLD  = Number(process.env.HOLD  || 20);
const MIN_BARS  = 150;
const WINDOW    = 300;
const WORKERS   = Number(process.env.WORKERS || 10);

const PARAM_KEYS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  'ors_prime_reversal',
];
const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '').trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (!Number.isFinite(ts) || !Number.isFinite(o) || o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < l) continue;
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

function atr14Array(c) {
  const out = new Array(c.length).fill(0);
  if (c.length < 2) return out;
  const tr = [0];
  for (let i = 1; i < c.length; i++) {
    tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c)));
  }
  if (c.length <= 14) { for (let i = 1; i < c.length; i++) out[i] = tr[i]; return out; }
  let s = 0;
  for (let i = 1; i <= 14; i++) s += tr[i];
  out[14] = s / 14;
  for (let i = 15; i < c.length; i++) out[i] = (out[i-1] * 13 + tr[i]) / 14;
  return out;
}

function simulateTrade(c, sigIdx, atrAtSig, orsMode) {
  const entryIdx = sigIdx + 1;
  if (entryIdx >= c.length || c[entryIdx].o <= 0 || atrAtSig <= 0)
    return null;

  const entry  = c[entryIdx].o;
  const tp     = orsMode ? entry * (1 + 3 / 100)  : entry * (1 + TP_PCT / 100);
  const stop   = orsMode ? entry - 2.0 * atrAtSig  : entry - SL_ATR * atrAtSig;
  const maxEnd = orsMode
    ? Math.min(c.length - 1, entryIdx + 25 - 1)
    : Math.min(c.length - 1, entryIdx + MAX_HOLD - 1);

  let exitPx = c[maxEnd].c;
  let exitIdx = maxEnd;
  let hit = false;

  for (let j = entryIdx; j <= maxEnd; j++) {
    const b = c[j];
    if (b.o <= stop) { exitPx = b.o; exitIdx = j; break; }
    if (b.l <= stop) { exitPx = stop; exitIdx = j; break; }
    if (b.h >= tp)   { exitPx = tp;   exitIdx = j; hit = true; break; }
    if (j === maxEnd) { exitPx = b.c; exitIdx = j; }
  }

  const pnl = (exitPx - entry) / entry * 100;
  return { pnl, hit, dur: exitIdx - sigIdx };
}

// ─── Worker logic ─────────────────────────────────────────────────────────────

function runWorker() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  for (const k of PARAM_KEYS) {
    if (typeof engine.setArchetypeTuning === 'function') engine.setArchetypeTuning(k, null);
  }

  const oosCutTs = workerData.oosCutTs;
  const trades = [];
  let processed = 0;

  for (const file of workerData.files) {
    let c;
    try { c = parseCSV(file.fp); } catch { processed++; continue; }
    if (c.length < MIN_BARS) { processed++; continue; }
    const atr14 = atr14Array(c);

    for (const key of PARAM_KEYS) {
      const isORS = key === 'ors_prime_reversal';
      let lastExitIdx = -1;

      for (let i = WINDOW - 1; i < c.length - 1; i++) {
        if (i <= lastExitIdx) continue;
        const w = c.slice(i - WINDOW + 1, i + 1);
        let r;
        try { r = engine.analyzeStock(w, key); } catch { continue; }
        if (!r || !ACTIONABLE.has(r.stage)) continue;

        const split = c[i].ts < oosCutTs ? 'is' : 'oos';
        const atrSig = atr14[i] || c[i].c * 0.02;
        const result = simulateTrade(c, i, atrSig, isORS);
        if (!result) continue;

        trades.push({ key, split, stage: r.stage, pnl: result.pnl, hit: result.hit });
        if (result.dur > 0) lastExitIdx = i + result.dur;
      }
    }

    processed++;
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }

  parentPort.postMessage({ type: 'done', trades });
}

// ─── Main thread ──────────────────────────────────────────────────────────────

function wilsonLower(wins, n, z = 1.96) {
  if (n === 0) return 0;
  const p = wins / n;
  const denom = 1 + z * z / n;
  const centre = p + z * z / (2 * n);
  const spread = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return ((centre - spread) / denom) * 100;
}

function mkAcc() { return { n: 0, wins: 0, sumPnl: 0, sumWin: 0, sumLoss: 0 }; }

function addTrade(acc, pnl, hit) {
  acc.n++;
  if (hit) { acc.wins++; acc.sumWin += pnl; }
  else { acc.sumLoss += Math.abs(pnl); }
  acc.sumPnl += pnl;
}

function summarize(acc) {
  const { n, wins, sumPnl, sumWin, sumLoss } = acc;
  if (n === 0) return { n: 0, wr: '—', avg: '—', pf: '—', wils: '—' };
  const wr   = (wins / n * 100).toFixed(1) + '%';
  const avg  = (sumPnl / n).toFixed(2) + '%';
  const pf   = sumLoss > 0 ? (sumWin / sumLoss).toFixed(2) : sumWin > 0 ? '∞' : '0.00';
  const wils = wilsonLower(wins, n).toFixed(1) + '%';
  return { n, wr, avg, pf, wils };
}

async function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.csv'))
    .map(name => ({ name, fp: path.join(DATA_DIR, name) }));

  const nWorkers = Math.min(WORKERS, files.length);
  const chunks = Array.from({ length: nWorkers }, () => []);
  files.forEach((f, i) => chunks[i % nWorkers].push(f));

  console.log(`\nTHOROUGH WIN RATE BACKTEST — ${files.length} stocks, ${nWorkers} workers`);
  console.log(`TP=${TP_PCT}%  SL=${SL_ATR}×ATR  HOLD=${MAX_HOLD}bars  OOS_CUT=${OOS_CUT}\n`);

  const oosCutTs = Date.parse(OOS_CUT) / 1000;
  let done = 0;
  const allTrades = [];

  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk, oosCutTs } });
    w.on('message', m => {
      if (m.type === 'progress') {
        done += m.n;
        if (done % 100 === 0) process.stdout.write(`  Processed ${done}/${files.length} stocks\r`);
      } else if (m.type === 'done') {
        allTrades.push(...m.trades);
        resolve();
      }
    });
    w.on('error', reject);
    w.on('exit', c => { if (c) reject(new Error(`worker exited ${c}`)); });
  })));

  console.log(`\n\nProcessed ${files.length} stocks — ${allTrades.length} total signals\n`);

  const results = {};
  for (const k of PARAM_KEYS) {
    results[k] = {
      is:  { all: mkAcc(), buy: mkAcc(), sb: mkAcc(), usb: mkAcc() },
      oos: { all: mkAcc(), buy: mkAcc(), sb: mkAcc(), usb: mkAcc() },
    };
  }

  for (const t of allTrades) {
    const acc = results[t.key][t.split];
    addTrade(acc.all, t.pnl, t.hit);
    if (t.stage === 'BUY')              addTrade(acc.buy, t.pnl, t.hit);
    else if (t.stage === 'STRONG_BUY')  addTrade(acc.sb,  t.pnl, t.hit);
    else if (t.stage === 'ULTRA_STRONG_BUY') addTrade(acc.usb, t.pnl, t.hit);
  }

  const PRETTY = {
    optimized_deployable_20plus:      'VolumeFootprint  (D20+)',
    optimized_highprecision_15plus:   'CompressionCoil  (HP15+)',
    optimized_elite_10plus:           'MomentumPocket   (E10+)',
    optimized_ultraselective_8plus:   'EMAStack         (US8+)',
    sniper_95plus:                    'PerfectStorm     (S95+)',
    ors_prime_reversal:               'ORS-Prime        (REV)',
  };

  const COL = (s, w) => String(s).padStart(w);

  console.log('='.repeat(100));
  console.log(`${'PARAM SET'.padEnd(28)} ${'SPLIT'.padEnd(5)} ${'STAGE'.padEnd(14)} ${'N'.padStart(6)} ${'WR'.padStart(8)} ${'AVG P&L'.padStart(9)} ${'PF'.padStart(6)} ${'WILSON'.padStart(8)}`);
  console.log('-'.repeat(100));

  for (const key of PARAM_KEYS) {
    const name = PRETTY[key];
    for (const split of ['is', 'oos']) {
      const label = split.toUpperCase();
      const buckets = [
        ['ALL actionable', results[key][split].all],
        ['BUY',            results[key][split].buy],
        ['STRONG_BUY',     results[key][split].sb],
        ['ULTRA_STRONG',   results[key][split].usb],
      ];
      for (const [bname, acc] of buckets) {
        const s = summarize(acc);
        if (s.n === 0) continue;
        console.log(
          `${name.padEnd(28)} ${label.padEnd(5)} ${bname.padEnd(14)} ` +
          `${COL(s.n, 6)} ${COL(s.wr, 8)} ${COL(s.avg, 9)} ${COL(s.pf, 6)} ${COL(s.wils, 8)}`
        );
      }
      console.log('-'.repeat(100));
    }
    console.log('='.repeat(100));
  }

  console.log('\nOOS REGIME SUMMARY (key metrics for live deployment):');
  console.log('-'.repeat(70));
  for (const key of PARAM_KEYS) {
    const acc = results[key].oos.all;
    const s   = summarize(acc);
    if (s.n === 0) { console.log(`  ${PRETTY[key].padEnd(32)}  No OOS signals`); continue; }
    const wrNum = parseFloat(s.wr);
    const verdict = wrNum >= 60 ? 'PASS' : wrNum >= 50 ? 'MARGINAL' : 'FAIL';
    console.log(`  [${verdict.padEnd(8)}] ${PRETTY[key].padEnd(32)}  n=${COL(s.n,5)}  WR=${COL(s.wr,6)}  Avg=${COL(s.avg,7)}  PF=${COL(s.pf,5)}  Wilson=${COL(s.wils,6)}`);
  }
  console.log('-'.repeat(70));

  console.log('\nOOS ULTRA_STRONG_BUY only (highest conviction):');
  console.log('-'.repeat(70));
  for (const key of PARAM_KEYS) {
    const acc = results[key].oos.usb;
    const s   = summarize(acc);
    if (s.n === 0) { console.log(`  ${PRETTY[key].padEnd(32)}  No USB signals`); continue; }
    const wrNum = parseFloat(s.wr);
    const verdict = wrNum >= 60 ? 'PASS' : wrNum >= 50 ? 'MARGINAL' : 'FAIL';
    console.log(`  [${verdict.padEnd(8)}] ${PRETTY[key].padEnd(32)}  n=${COL(s.n,5)}  WR=${COL(s.wr,6)}  Avg=${COL(s.avg,7)}  PF=${COL(s.pf,5)}  Wilson=${COL(s.wils,6)}`);
  }
  console.log('-'.repeat(70));
  console.log('\nDone.\n');
}

if (isMainThread) main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
else runWorker();
