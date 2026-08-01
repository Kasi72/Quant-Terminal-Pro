'use strict';

/**
 * Verification script for pure production engine defaults.
 * Simulates buy trades with no dynamic tuning overrides, representing
 * exactly how the live web app / screener executes on the updated stockEngine.ts.
 */

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = path.join(__dirname, '_compiled');
const WINDOW = 300;
const OOS_CUT = '2025-05-05';
const TARGET_PCT = 5;

const IDS = ['VolumeFootprint', 'CompressionCoil', 'MomentumPocket', 'EMAStack', 'PerfectStorm'];
const KEYS = {
  VolumeFootprint: 'optimized_deployable_20plus',
  CompressionCoil: 'optimized_highprecision_15plus',
  MomentumPocket: 'optimized_elite_10plus',
  EMAStack: 'optimized_ultraselective_8plus',
  PerfectStorm: 'sniper_95plus',
};

// Map each archetype to its production SL/Hold limits defined in PARAM_SETS or our optimizer results
const RECS = {
  VolumeFootprint: { slAtrMult: 3.5, maxHoldBars: 20 },
  CompressionCoil: { slAtrMult: 3.0, maxHoldBars: 20 },
  MomentumPocket:  { slAtrMult: 3.5, maxHoldBars: 20 },
  EMAStack:        { slAtrMult: 4.5, maxHoldBars: 25 },
  PerfectStorm:    { slAtrMult: 3.5, maxHoldBars: 20 }
};

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
  if (!c.length) return out;
  const tr = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    const pc = c[i - 1].c;
    tr[i] = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - pc), Math.abs(c[i].l - pc));
  }
  if (c.length <= 14) { for (let i = 1; i < c.length; i++) out[i] = tr[i]; return out; }
  let s = 0;
  for (let i = 1; i <= 14; i++) s += tr[i];
  out[14] = s / 14;
  for (let i = 15; i < c.length; i++) out[i] = (out[i - 1] * 13 + tr[i]) / 14;
  return out;
}

function dateOf(ts) { return new Date(ts * 1000).toISOString().slice(0, 10); }

function simulate(c, sigIdx, atr, slAtrMult, maxHoldBars) {
  const entryIdx = sigIdx + 1;
  if (entryIdx >= c.length || !(c[entryIdx].o > 0) || !(atr > 0)) return null;
  const entry = c[entryIdx].o;
  const stop = entry - slAtrMult * atr;
  const target = entry * (1 + TARGET_PCT / 100);

  const end = Math.min(c.length - 1, entryIdx + maxHoldBars - 1);
  let result = 'TIME', exitIdx = end, exitPrice = c[end].c;
  for (let i = entryIdx; i <= end; i++) {
    const b = c[i];
    if (b.o <= stop) { result = 'STOP_GAP'; exitIdx = i; exitPrice = b.o; break; }
    if (b.l <= stop) { result = 'STOP'; exitIdx = i; exitPrice = stop; break; }
    if (b.h >= target) { result = 'TARGET5'; exitIdx = i; exitPrice = target; break; }
    if (i === end) { exitIdx = i; exitPrice = b.c; }
  }
  return {
    hit5: result === 'TARGET5',
    pnl: (exitPrice - entry) / entry * 100,
    exitIdx
  };
}

function workerMain() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const acc = Object.fromEntries(IDS.map(id => [id, []]));
  let processed = 0;
  for (const file of workerData.files) {
    let c; try { c = parseCSV(file.fp); } catch { processed++; continue; }
    processed++;
    if (c.length < WINDOW + 21) continue;
    const atr = atr14Array(c);
    const symbol = file.name.replace(/_OHLCV\.csv$/i, '');
    const nextAllowed = Object.fromEntries(IDS.map(id => [id, -1]));

    for (let i = WINDOW - 1; i <= c.length - 21; i++) {
      const w = c.slice(i - WINDOW + 1, i + 1);
      for (const id of IDS) {
        if (i < nextAllowed[id]) continue;
        let r; try { r = engine.analyzeStock(w, KEYS[id], false); } catch { continue; }
        if (!r || !['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY'].includes(r.stage)) continue;
        const limits = RECS[id];
        const trade = simulate(c, i, atr[i] || c[i].c * 0.02, limits.slAtrMult, limits.maxHoldBars);
        if (!trade) continue;

        const row = { symbol, signalDate: dateOf(c[i].ts), pnl: trade.pnl, hit5: trade.hit5, exitIdx: trade.exitIdx };
        acc[id].push(row);
        nextAllowed[id] = trade.exitIdx + 1; // non-overlap
      }
    }
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }
  parentPort.postMessage({ type: 'done', acc });
}

function stats(rows) {
  const n = rows.length;
  if (!n) return { n: 0, wr: 0, hit5: 0, pf: 0, avgPnl: 0 };
  const wins = rows.filter(x => x.pnl > 0).length;
  const targets = rows.filter(x => x.hit5).length;
  const gw = rows.filter(x => x.pnl > 0).reduce((a, x) => a + x.pnl, 0);
  const gl = -rows.filter(x => x.pnl < 0).reduce((a, x) => a + x.pnl, 0);
  return { n, wr: wins / n * 100, hit5: targets / n * 100, pf: gl ? gw / gl : Infinity, avgPnl: rows.reduce((a, x) => a + x.pnl, 0) / n };
}

async function main() {
  const files = fs.readdirSync(DATA_DIR).filter(n => n.toLowerCase().endsWith('.csv') && n !== 'ALL_SYMBOLS_OHLCV.csv').sort().map(name => ({ name, fp: path.join(DATA_DIR, name) }));
  const workers = Math.min(10, files.length);
  const chunks = Array.from({ length: workers }, () => []);
  files.forEach((f, i) => chunks[i % workers].push(f));

  console.log(`\n======================================================================`);
  console.log(`LIVE PRODUCTION DEFAULTS VALIDATION`);
  console.log(`Verifies pure unmodified stockEngine.ts default screening metrics`);
  console.log(`======================================================================\n`);

  const combined = Object.fromEntries(IDS.map(id => [id, []]));
  let done = 0;

  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk } });
    w.on('message', msg => {
      if (msg.type === 'progress') { done += msg.n; if (done % 50 === 0) process.stdout.write(`  Processed ${done}/${files.length} symbols...\r`); }
      else if (msg.type === 'done') {
        for (const id of IDS) combined[id].push(...msg.acc[id]);
        resolve();
      }
    });
    w.on('error', reject);
    w.on('exit', code => { if (code) reject(new Error(`worker exited with code ${code}`)); });
  })));

  console.log(`\n\nRESULTS SUMMARY (Next-session OPEN entry, STOP-first logic):`);
  console.log(`------------------------------------------------------------------------------------------------------`);
  console.log(`${'Archetype'.padEnd(20)} | ${'Full N'.padStart(6)} | ${'Full WR'.padStart(9)} | ${'Full Hit5'.padStart(9)} | ${'Full PF'.padStart(7)} | ${'OOS N'.padStart(5)} | ${'OOS WR'.padStart(8)} | ${'OOS Hit5'.padStart(8)} | ${'OOS PF'.padStart(6)}`);
  console.log(`------------------------------------------------------------------------------------------------------`);

  for (const id of IDS) {
    const full = stats(combined[id]);
    const is = stats(combined[id].filter(r => r.signalDate <= OOS_CUT));
    const oos = stats(combined[id].filter(r => r.signalDate > OOS_CUT));

    console.log(
      `${id.padEnd(20)} | ` +
      `${String(full.n).padStart(6)} | ` +
      `${full.wr.toFixed(1).padStart(7)}% | ` +
      `${full.hit5.toFixed(1).padStart(7)}% | ` +
      `${(full.pf === Infinity ? '∞' : full.pf.toFixed(2)).padStart(7)} | ` +
      `${String(oos.n).padStart(5)} | ` +
      `${oos.wr.toFixed(1).padStart(6)}% | ` +
      `${oos.hit5.toFixed(1).padStart(6)}% | ` +
      `${(oos.pf === Infinity ? '∞' : oos.pf.toFixed(2)).padStart(6)}`
    );
  }
  console.log(`------------------------------------------------------------------------------------------------------\n`);
}

if (isMainThread) {
  main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
} else {
  workerMain();
}
