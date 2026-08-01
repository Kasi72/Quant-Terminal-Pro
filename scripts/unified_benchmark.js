'use strict';
/**
 * Unified Post-Tuning Benchmark — all 4 archetypes, current production params
 *
 * Optimal SL×ATR and hold window per archetype:
 *   VolumeFootprint  → SL=4.0× Hold=20  (Phase-5 dynamic trail study)
 *   CompressionCoil  → SL=4.0× Hold=20  (Phase-5 dynamic trail study)
 *   MomentumPocket   → SL=5.0× Hold=25  (hypertune_mp_ema 2026-07-22)
 *   EMAStack         → SL=4.5× Hold=25  (hypertune_mp_ema 2026-07-22)
 *
 * Stage thresholds (from ARCH_ULTRA in stockEngine.ts):
 *   VF=98  CC=84  MP=99  EMA=99  (conditionsMet≥6 + score≥threshold → ULTRA_STRONG_BUY)
 *
 * Metrics: n, WR%, Hit5%, PF, Avg%, MFE10%, MAE10%, Bootstrap 95% CI on OOS Hit5
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = path.join(__dirname, '_compiled_current');
const OUT_DIR    = path.join(__dirname, 'results');
const WINDOW     = 300;
const OOS_CUT    = '2025-05-05';
const BOOT_N     = 1000;

const ARCHETYPES = [
  { id: 'VolumeFootprint', arcType: 'VolumeFootprint', key: 'optimized_deployable_20plus',     sl: 4.0, hold: 20, ultraT: 98 },
  { id: 'CompressionCoil', arcType: 'CompressionCoil', key: 'optimized_highprecision_15plus',  sl: 4.0, hold: 20, ultraT: 84 },
  { id: 'MomentumPocket',  arcType: 'MomentumPocket',  key: 'optimized_elite_10plus',          sl: 5.0, hold: 25, ultraT: 99 },
  { id: 'EMAStack',        arcType: 'EMAStack',         key: 'optimized_ultraselective_8plus', sl: 4.5, hold: 25, ultraT: 99 },
];

const STAGES_ORDERED = ['ULTRA_STRONG_BUY', 'STRONG_BUY', 'BUY'];
const STAGE_LABEL    = { ULTRA_STRONG_BUY: 'ULTRA', STRONG_BUY: 'STRONG', BUY: 'BUY' };

// ─── CSV + ATR ───────────────────────────────────────────────────────────────

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
    if (!Number.isFinite(ts) || !o || !h || !l || !c || h < l) continue;
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
  const tr  = new Array(c.length).fill(0);
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

function simulateTrade(c, sigIdx, atr, sl, hold) {
  const ei = sigIdx + 1;
  if (ei >= c.length || !(c[ei].o > 0)) return null;
  const entry = c[ei].o;
  const tpVal = entry * 1.05;
  const slVal = entry - sl * atr;
  const end   = Math.min(c.length - 1, ei + hold - 1);
  let pnl = 0, bars = end - ei + 1;
  let mfe10 = 0, mae10 = 0;
  const end10 = Math.min(c.length - 1, ei + 9);
  for (let i = ei; i <= end10; i++) {
    mfe10 = Math.max(mfe10, Math.min(50, (c[i].h - entry) / entry * 100));
    mae10 = Math.min(mae10, Math.max(-50, (c[i].l - entry) / entry * 100));
  }
  for (let j = ei; j <= end; j++) {
    const b = c[j];
    if (b.o <= slVal) { pnl = (b.o - entry) / entry * 100; bars = j - sigIdx; break; }
    if (b.l <= slVal) { pnl = (slVal - entry) / entry * 100; bars = j - sigIdx; break; }
    if (b.h >= tpVal) { pnl = 5.0; bars = j - sigIdx; break; }
    if (j === end)    { pnl = (b.c - entry) / entry * 100; }
  }
  const exitIdx = Math.min(c.length - 1, sigIdx + bars);
  return {
    pnl, bars, mfe10, mae10,
    exitDate: new Date(c[exitIdx].ts * 1000).toISOString().slice(0, 10),
  };
}

// ─── Worker ──────────────────────────────────────────────────────────────────

function collectWorker() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  for (const { key } of ARCHETYPES) engine.setArchetypeTuning(key, null);

  // trades[archetypeId][stage] = array of trade records
  const trades = {};
  for (const { id } of ARCHETYPES) {
    trades[id] = { ULTRA_STRONG_BUY: [], STRONG_BUY: [], BUY: [], PRE_BREAKOUT: [] };
  }

  let processed = 0;

  for (const file of workerData.files) {
    let c; try { c = parseCSV(file.fp); } catch { processed++; continue; }
    processed++;
    if (c.length < WINDOW + 30) continue;
    const atr14 = atr14Array(c);
    const symbol = file.name.replace(/_OHLCV\.csv$/i, '');

    for (let i = WINDOW - 1; i < c.length - 26; i++) {
      const w = c.slice(i - WINDOW + 1, i + 1);

      for (const { id, arcType, key, sl, hold } of ARCHETYPES) {
        let r;
        try { r = engine.analyzeStock(w, key, false); } catch { continue; }

        // Filter: must be the right archetype, must have fired (4+ conditions), stage is meaningful
        if (!r) continue;
        if (r.archetypeType !== arcType) continue;
        if ((r.archetypeConditions ?? 0) < 4) continue;
        if (!r.stage || r.stage === 'NO_SIGNAL') continue;

        const stageBucket = STAGES_ORDERED.includes(r.stage) ? r.stage : 'PRE_BREAKOUT';
        const atr = atr14[i] || c[i].c * 0.02;
        const t = simulateTrade(c, i, atr, sl, hold);
        if (!t) continue;

        trades[id][stageBucket].push({
          symbol,
          date: new Date(c[i].ts * 1000).toISOString().slice(0, 10),
          score: r.inflectionScore ?? 0,
          ...t,
        });
      }
    }
    if (processed % 10 === 0) parentPort.postMessage({ type: 'progress', n: 10 });
  }

  parentPort.postMessage({ type: 'done', trades, processed });
}

// ─── Stats + bootstrap ───────────────────────────────────────────────────────

function stats(rows) {
  const n = rows.length;
  if (!n) return { n: 0, wr: 0, hit5: 0, pf: 0, avg: 0, mfe10: 0, mae10: 0 };
  let wins = 0, gw = 0, gl = 0, hit5 = 0, sp = 0, sm = 0, sa = 0;
  for (const r of rows) {
    if (r.pnl > 0) { wins++; gw += r.pnl; } else if (r.pnl < 0) gl -= r.pnl;
    if (r.pnl >= 4.9) hit5++;
    sp += r.pnl; sm += r.mfe10; sa += r.mae10;
  }
  return { n, wr: wins/n*100, hit5: hit5/n*100, pf: gl ? gw/gl : 99, avg: sp/n, mfe10: sm/n, mae10: sa/n };
}

function bootstrap(rows, nBoots = BOOT_N) {
  const n = rows.length;
  if (n < 5) return { mean: 0, lo: 0, hi: 0 };
  const samples = [];
  for (let b = 0; b < nBoots; b++) {
    const boot = [];
    for (let i = 0; i < n; i++) boot.push(rows[Math.floor(Math.random() * n)]);
    samples.push(stats(boot).hit5);
  }
  samples.sort((a, b) => a - b);
  return {
    mean: samples.reduce((a, x) => a + x, 0) / nBoots,
    lo:   samples[Math.floor(nBoots * 0.025)],
    hi:   samples[Math.floor(nBoots * 0.975)],
  };
}

// Deduplicate overlapping trades per symbol
function dedup(rows) {
  const bySymbol = {};
  for (const r of rows) (bySymbol[r.symbol] ||= []).push(r);
  const out = [];
  for (const arr of Object.values(bySymbol)) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
    let nextDate = '';
    for (const r of arr) {
      if (r.date < nextDate) continue;
      out.push(r);
      nextDate = r.exitDate > r.date ? r.exitDate : r.date;
    }
  }
  return out;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const files = fs.readdirSync(DATA_DIR)
    .filter(n => n.toLowerCase().endsWith('.csv') && n !== 'ALL_SYMBOLS_OHLCV.csv')
    .sort()
    .map(name => ({ name, fp: path.join(DATA_DIR, name) }));

  const nWorkers = Math.min(10, files.length);
  const chunks   = Array.from({ length: nWorkers }, () => []);
  files.forEach((f, i) => chunks[i % nWorkers].push(f));

  console.log(`\n╔══════════════════════════════════════════════════════════════════╗`);
  console.log(`║         UNIFIED POST-TUNING BENCHMARK — all 4 archetypes         ║`);
  console.log(`╚══════════════════════════════════════════════════════════════════╝`);
  console.log(`  Stocks: ${files.length} | Workers: ${nWorkers} | OOS cutoff: ${OOS_CUT} | Bootstrap: ${BOOT_N}\n`);

  const allTrades = {};
  for (const { id } of ARCHETYPES) allTrades[id] = { ULTRA_STRONG_BUY: [], STRONG_BUY: [], BUY: [], PRE_BREAKOUT: [] };
  let done = 0;

  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk } });
    w.on('message', m => {
      if (m.type === 'progress') {
        done += m.n;
        if (done % 200 === 0) process.stdout.write(`  Scanning: ${done}/${files.length}\r`);
      } else if (m.type === 'done') {
        for (const { id } of ARCHETYPES) {
          for (const stage of [...STAGES_ORDERED, 'PRE_BREAKOUT']) {
            allTrades[id][stage] = allTrades[id][stage].concat(m.trades[id][stage]);
          }
        }
        resolve();
      }
    });
    w.on('error', reject);
    w.on('exit', c => { if (c) reject(new Error(`Worker exit ${c}`)); });
  })));

  console.log(`\n`);

  const F = (v, d = 1) => isFinite(v) && v < 90 ? v.toFixed(d) : isFinite(v) ? '>90' : '—';
  const N = (s, w) => s.toString().padStart(w);
  const L = (s, w) => s.toString().padEnd(w);
  const SEP = '─'.repeat(118);

  console.log(SEP);
  console.log(
    L('Archetype / Tier', 24) +
    N('ALL_n', 6) + N('WR%', 7) + N('Hit5%', 7) + N('PF', 6) + N('Avg%', 7) + N('MFE10', 7) + N('MAE10', 7) +
    '  ║  ' +
    N('IS_n', 6) + N('IS_H5', 7) + N('IS_PF', 6) +
    '  ║  ' +
    N('OOS_n', 6) + N('OOS_WR', 7) + N('OOS_H5', 7) + N('OOS_PF', 6) + N('OOS_Avg', 8) + N('CI_lo', 7) + N('CI_hi', 7)
  );
  console.log(SEP);

  const report = { generated: new Date().toISOString(), oosCut: OOS_CUT, archetypes: {} };

  for (const arc of ARCHETYPES) {
    const id = arc.id;
    const stageTrades = allTrades[id];

    // Build merged views
    const ultra  = dedup(stageTrades['ULTRA_STRONG_BUY']);
    const strong = dedup(stageTrades['STRONG_BUY']);
    const buy    = dedup(stageTrades['BUY']);
    const pre    = dedup(stageTrades['PRE_BREAKOUT']);
    const all    = dedup([...ultra, ...strong, ...buy, ...pre]);

    const rows  = { ULTRA: ultra, STRONG: strong, BUY: buy, ALL: all };
    const arcReport = { sl: arc.sl, hold: arc.hold, ultraT: arc.ultraT, tiers: {} };

    // Print archetype header row (ALL signals)
    const fAll = stats(all);
    const isAll = stats(all.filter(r => r.date <= OOS_CUT));
    const oosAll = stats(all.filter(r => r.date > OOS_CUT));
    const ciAll = bootstrap(all.filter(r => r.date > OOS_CUT));
    console.log(
      L(`${id} SL${arc.sl}× H${arc.hold}`, 24) +
      N(fAll.n, 6) + N(F(fAll.wr), 7) + N(F(fAll.hit5), 7) + N(F(fAll.pf), 6) + N(F(fAll.avg,2), 7) + N(F(fAll.mfe10), 7) + N(F(fAll.mae10), 7) +
      '  ║  ' +
      N(isAll.n, 6) + N(F(isAll.hit5), 7) + N(F(isAll.pf), 6) +
      '  ║  ' +
      N(oosAll.n, 6) + N(F(oosAll.wr), 7) + N(F(oosAll.hit5), 7) + N(F(oosAll.pf), 6) + N(F(oosAll.avg,2), 8) + N(F(ciAll.lo), 7) + N(F(ciAll.hi), 7)
    );

    // Print per-tier breakdown: ULTRA, STRONG, BUY
    for (const [tier, label] of [['ULTRA', 'ULTRA'], ['STRONG', 'STRONG'], ['BUY', 'BUY']]) {
      const tr = rows[tier];
      if (!tr.length) continue;
      const f   = stats(tr);
      const iis = stats(tr.filter(r => r.date <= OOS_CUT));
      const oos = stats(tr.filter(r => r.date > OOS_CUT));
      const ci  = bootstrap(tr.filter(r => r.date > OOS_CUT));
      console.log(
        L(`  └ ${label} (≥${tier === 'ULTRA' ? arc.ultraT : tier === 'STRONG' ? 62 : 43})`, 24) +
        N(f.n, 6) + N(F(f.wr), 7) + N(F(f.hit5), 7) + N(F(f.pf), 6) + N(F(f.avg,2), 7) + N(F(f.mfe10), 7) + N(F(f.mae10), 7) +
        '  ║  ' +
        N(iis.n, 6) + N(F(iis.hit5), 7) + N(F(iis.pf), 6) +
        '  ║  ' +
        N(oos.n, 6) + N(F(oos.wr), 7) + N(F(oos.hit5), 7) + N(F(oos.pf), 6) + N(F(oos.avg,2), 8) + N(F(ci.lo), 7) + N(F(ci.hi), 7)
      );
      arcReport.tiers[tier] = { n: f.n, full: f, is: iis, oos, bootstrapCI: ci };
    }

    console.log('');
    arcReport.all = { n: fAll.n, full: fAll, is: isAll, oos: oosAll, bootstrapCI: ciAll };
    report.archetypes[id] = arcReport;
  }

  console.log(SEP);

  // System composite — ULTRA only (what screener deploys)
  const ultraRows = ARCHETYPES.flatMap(a => dedup(allTrades[a.id]['ULTRA_STRONG_BUY']));
  const ultraOOS = ultraRows.filter(r => r.date > OOS_CUT);
  const us = stats(ultraOOS);
  const uci = bootstrap(ultraOOS);
  const totalUltra = ultraRows.length;
  console.log(`\n  ┌─ SYSTEM COMPOSITE — ULTRA signals only (what the screener deploys)`);
  console.log(`  │  Total ULTRA signals: ${totalUltra}  OOS n=${us.n}  WR=${F(us.wr)}%  Hit5=${F(us.hit5)}%  PF=${F(us.pf)}  Avg=${F(us.avg,2)}%`);
  console.log(`  └─ OOS Bootstrap 95% CI on Hit5: [${F(uci.lo)}%, ${F(uci.hi)}%]  mean=${F(uci.mean)}%\n`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jp = path.join(OUT_DIR, `unified_benchmark_${stamp}.json`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(jp, JSON.stringify(report, null, 2));
  console.log(`  Saved → ${jp}\n`);

  return report;
}

if (isMainThread) {
  main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
} else {
  collectWorker().catch(e => {
    parentPort.postMessage({ type: 'error', error: e.stack || String(e) });
    process.exitCode = 1;
  });
}
