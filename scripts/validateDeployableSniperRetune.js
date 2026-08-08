'use strict';

/**
 * Research-only validation for Deployable and Sniper retune candidates.
 * Uses compiled current stockEngine with setArchetypeTuning overrides, next-open
 * entry, stop-first +5% target, Kotak app/web delivery costs, and chronological
 * OOS split. Does not alter production params.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const OUT_DIR = path.join(__dirname, 'results');
const WINDOW = 300;
const OOS_CUT = process.env.OOS_CUT || '2025-05-05';
const ACCOUNT = 1_000_000;
const RISK_PCT = 1;
const BUY = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

const DEPLOYABLE_TUNING = {
      minVolRatio: 5,
      minCloseLoc: 75,
      maxUpperWick: 25,
      minHi20Frac: 0.92,
      minRangeATR: 2.4,
      maxGapDownPct: 0,
      minCMF20: 0.2,
      minOBVSlope10: 0.5,
      minAtrPct14: 1.5,
      minCloseVsEMA20: 0.5,
      minEMA20VsEMA50: 0,
      requireDIBull: false,
      maxBsc: 3,
      minADX: 25,
};
const SNIPER_STRICT_TUNING = {
      minFires: 2,
      minADXGate: 25,
      minQualityTier: 1,
      maxCandleRisk: 10,
      minCMF20: 0.05,
      minOBVSlope10: -1.5,
      minAtrPct14: 0,
      maxAtrPct14: 999,
      minCloseVsEMA20: -999,
      minEMA20VsEMA50: -999,
};
const SNIPER_ONEFIRE_TUNING = {
      minFires: 1,
      minADXGate: 30,
      minQualityTier: 2,
      maxCandleRisk: 12,
      minCMF20: 0.05,
      minOBVSlope10: -1.5,
      minAtrPct14: 4,
      maxAtrPct14: 5,
      minCloseVsEMA20: -999,
      minEMA20VsEMA50: 0.5,
};

const CANDIDATES = [
  ...[1.25, 1.5, 1.75, 2, 2.5, 3, 3.5].flatMap(slAtrMult =>
    [8, 10, 15, 20].map(maxHoldBars => ({
      id: `Deployable_Retuned_SL${slAtrMult}_H${maxHoldBars}`,
      label: `Deployable SL${slAtrMult} H${maxHoldBars}`,
      group: 'Deployable retuned',
      key: 'optimized_deployable_20plus',
      tuning: DEPLOYABLE_TUNING,
      exit: { tpPct: 5, slAtrMult, maxHoldBars },
    }))
  ),
  {
    id: 'Sniper_Strict_Current_Best',
    label: 'Sniper strict current best',
    group: 'Sniper strict',
    key: 'sniper_95plus',
    tuning: SNIPER_STRICT_TUNING,
    exit: { tpPct: 5, slAtrMult: 2, maxHoldBars: 20 },
  },
  ...[1.25, 1.5, 1.75, 2, 2.5, 3, 3.5].flatMap(slAtrMult =>
    [8, 10, 15, 20].map(maxHoldBars => ({
      id: `Sniper_OneFire_SL${slAtrMult}_H${maxHoldBars}`,
      label: `Sniper 1-fire SL${slAtrMult} H${maxHoldBars}`,
      group: 'Sniper one-fire',
      key: 'sniper_95plus',
      tuning: SNIPER_ONEFIRE_TUNING,
      exit: { tpPct: 5, slAtrMult, maxHoldBars },
    }))
  ),
];

function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^\uFEFF/, '').trim();
  if (!raw) return [];
  const out = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const p = line.split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (!Number.isFinite(ts) || ![o, h, l, c, v].every(Number.isFinite) || o <= 0 || h < l || l <= 0 || c <= 0) continue;
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

function dateOf(ts) { return new Date(ts * 1000).toISOString().slice(0, 10); }

function atr14Array(c) {
  const out = new Array(c.length).fill(0);
  const tr = new Array(c.length).fill(0);
  for (let i = 1; i < c.length; i++) {
    const pc = c[i - 1].c;
    tr[i] = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - pc), Math.abs(c[i].l - pc));
  }
  if (c.length > 14) {
    let s = 0;
    for (let i = 1; i <= 14; i++) s += tr[i];
    out[14] = s / 14;
    for (let i = 15; i < c.length; i++) out[i] = (out[i - 1] * 13 + tr[i]) / 14;
  }
  return out;
}

function costs(buyValue, sellValue) {
  const turnover = Math.max(0, buyValue) + Math.max(0, sellValue);
  const brokerage = turnover * 0.002;
  const stt = turnover * 0.001;
  const exchange = turnover * 0.0000297;
  const sebi = turnover * 0.000001;
  const stamp = Math.max(0, buyValue) * 0.00015;
  const dp = sellValue > 0 ? Math.max(20, sellValue * 0.0004) : 0;
  const gst = (brokerage + exchange + sebi + dp) * 0.18;
  const slippage = Math.max(0, sellValue) * 0.0005;
  return brokerage + stt + exchange + sebi + stamp + dp + gst + slippage;
}

function simulate(c, sigIdx, atr, exitPlan) {
  const entryIdx = sigIdx + 1;
  if (entryIdx >= c.length) return null;
  const entry = c[entryIdx].o;
  if (!(entry > 0) || !(atr > 0)) return null;
  const signalClose = c[sigIdx].c;
  const chaseGapPct = signalClose > 0 ? (entry / signalClose - 1) * 100 : 0;
  if (chaseGapPct > 2.5) return null;

  const stop = entry - exitPlan.slAtrMult * atr;
  if (!(stop > 0) || stop >= entry) return null;
  const riskAbs = entry - stop;
  const target = entry * (1 + exitPlan.tpPct / 100);
  const end = Math.min(c.length - 1, entryIdx + exitPlan.maxHoldBars - 1);
  let exitIdx = end, exitPrice = c[end].c, reason = 'TIME';
  let mfe = 0, mae = 0, hit5 = false;
  for (let i = entryIdx; i <= end; i++) {
    const b = c[i];
    mfe = Math.max(mfe, (b.h - entry) / entry * 100);
    mae = Math.min(mae, (b.l - entry) / entry * 100);
    if (b.o <= stop) { exitIdx = i; exitPrice = b.o; reason = 'STOP_GAP'; break; }
    if (b.l <= stop) { exitIdx = i; exitPrice = stop; reason = 'STOP'; break; }
    if (b.h >= target) { exitIdx = i; exitPrice = target; reason = 'TARGET5'; hit5 = true; break; }
  }
  const shares = Math.floor((ACCOUNT * RISK_PCT / 100) / riskAbs);
  if (shares <= 0) return null;
  const gross = (exitPrice - entry) * shares;
  const net = gross - costs(entry * shares, exitPrice * shares);
  const riskCapital = riskAbs * shares;
  return {
    entryDate: dateOf(c[entryIdx].ts),
    signalDate: dateOf(c[sigIdx].ts),
    exitIdx,
    hit5,
    pnlPct: (exitPrice - entry) / entry * 100,
    netR: net / riskCapital,
    mfe,
    mae,
    reason,
  };
}

function workerMain() {
  const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const out = Object.fromEntries(CANDIDATES.map(c => [c.id, []]));
  for (const fp of workerData.files) {
    let c;
    try { c = parseCSV(fp); } catch { continue; }
    if (c.length < WINDOW + 25) continue;
    const symbol = path.basename(fp).replace(/_OHLCV\.csv$/i, '');
    const atr = atr14Array(c);
    const nextAllowed = Object.fromEntries(CANDIDATES.map(x => [x.id, -1]));
    for (let i = WINDOW - 1; i < c.length - 1; i++) {
      const win = c.slice(i - WINDOW + 1, i + 1);
      for (const cand of CANDIDATES) {
        if (i <= nextAllowed[cand.id]) continue;
        for (const x of CANDIDATES) engine.setArchetypeTuning(x.key, null);
        engine.setArchetypeTuning(cand.key, cand.tuning);
        let r;
        try { r = engine.analyzeStock(win, cand.key, false); } catch { continue; }
        if (!r || !BUY.has(r.stage)) continue;
        const trade = simulate(c, i, atr[i] || c[i].c * 0.02, cand.exit);
        if (!trade) continue;
        out[cand.id].push({ symbol, stage: r.stage, score: r.inflectionScore, ...trade });
        nextAllowed[cand.id] = trade.exitIdx;
      }
    }
  }
  parentPort.postMessage(out);
}

function stat(rows) {
  const n = rows.length;
  if (!n) return { n: 0, hit5: 0, win: 0, pf: 0, exp: 0, avgPnl: 0, mfe: 0, mae: 0, stops: 0 };
  const pos = rows.filter(r => r.netR > 0).reduce((s, r) => s + r.netR, 0);
  const neg = -rows.filter(r => r.netR < 0).reduce((s, r) => s + r.netR, 0);
  return {
    n,
    hit5: rows.filter(r => r.hit5).length / n * 100,
    win: rows.filter(r => r.netR > 0).length / n * 100,
    pf: neg > 0 ? pos / neg : (pos > 0 ? 99 : 0),
    exp: rows.reduce((s, r) => s + r.netR, 0) / n,
    avgPnl: rows.reduce((s, r) => s + r.pnlPct, 0) / n,
    mfe: rows.reduce((s, r) => s + r.mfe, 0) / n,
    mae: rows.reduce((s, r) => s + r.mae, 0) / n,
    stops: rows.filter(r => r.reason.startsWith('STOP')).length / n * 100,
  };
}

function summarize(rows) {
  return {
    all: stat(rows),
    is: stat(rows.filter(r => r.signalDate <= OOS_CUT)),
    oos: stat(rows.filter(r => r.signalDate > OOS_CUT)),
  };
}

function fmt(x, d = 2) { return Number.isFinite(x) ? x.toFixed(d) : 'Inf'; }
function pct(x) { return `${fmt(x, 1)}%`; }
function r(x) { return `${x >= 0 ? '+' : ''}${fmt(x, 3)}R`; }

async function main() {
  const files = fs.readdirSync(DATA_DIR).filter(f => /\.csv$/i.test(f) && f !== 'ALL_SYMBOLS_OHLCV.csv').sort().map(f => path.join(DATA_DIR, f));
  const workers = Math.min(Number(process.env.WORKERS || 10), os.cpus().length, files.length);
  const chunks = Array.from({ length: workers }, () => []);
  files.forEach((f, i) => chunks[i % workers].push(f));
  console.log(`Validating Deployable/Sniper retunes | files=${files.length} workers=${workers} OOS>${OOS_CUT}`);
  const all = Object.fromEntries(CANDIDATES.map(c => [c.id, []]));
  let done = 0;
  await Promise.all(chunks.map(chunk => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files: chunk } });
    w.on('message', data => {
      for (const c of CANDIDATES) all[c.id].push(...data[c.id]);
      done += chunk.length;
      process.stdout.write(`  ${done}/${files.length}\r`);
      resolve();
    });
    w.on('error', reject);
    w.on('exit', code => { if (code) reject(new Error(`worker exited ${code}`)); });
  })));
  process.stdout.write('\n');

  const results = {};
  const ranking = [];
  const lines = [
    'DEPLOYABLE / SNIPER RETUNE COST-AWARE VALIDATION',
    `Data: ${DATA_DIR}`,
    `Files: ${files.length} | OOS>${OOS_CUT}`,
    'Convention: tuned analyzeStock, next-open, skip >2.5% chase gaps, stop-first, +5 target, ATR stop from candidate, 20 bars, Kotak app/web delivery costs.',
    '',
    'Candidate                 Full n/H5/WR/PF/Exp/AvgPnl/MFE/MAE    OOS n/H5/WR/PF/Exp/AvgPnl/MFE/MAE',
    '-'.repeat(150),
  ];
  for (const cand of CANDIDATES) {
    const s = summarize(all[cand.id]);
    results[cand.id] = { ...cand, trades: all[cand.id].length, stats: s };
    const pass = s.oos.n >= 20 && s.oos.hit5 >= 55 && s.oos.pf >= 1.2 && s.oos.exp >= 0.05 && s.all.pf >= 1 && s.all.exp >= 0;
    const score = (pass ? 1000 : 0) + s.oos.hit5 * 0.35 + Math.min(4, s.oos.pf) * 8 + s.oos.exp * 35 + Math.min(1, Math.log10(Math.max(1, s.oos.n)) / 2) * 5;
    ranking.push({ id: cand.id, label: cand.label, group: cand.group, exit: cand.exit, tuning: cand.tuning, pass, score, stats: s });
    lines.push(`${cand.label.padEnd(25)} ${String(s.all.n).padStart(4)} ${pct(s.all.hit5).padStart(6)} ${pct(s.all.win).padStart(6)} ${fmt(s.all.pf).padStart(5)} ${r(s.all.exp).padStart(8)} ${(s.all.avgPnl >= 0 ? '+' : '') + fmt(s.all.avgPnl).padStart(6)}% ${fmt(s.all.mfe).padStart(5)} ${fmt(s.all.mae).padStart(6)}   ${String(s.oos.n).padStart(4)} ${pct(s.oos.hit5).padStart(6)} ${pct(s.oos.win).padStart(6)} ${fmt(s.oos.pf).padStart(5)} ${r(s.oos.exp).padStart(8)} ${(s.oos.avgPnl >= 0 ? '+' : '') + fmt(s.oos.avgPnl).padStart(6)}% ${fmt(s.oos.mfe).padStart(5)} ${fmt(s.oos.mae).padStart(6)}`);
  }
  ranking.sort((a, b) => b.score - a.score);
  lines.push('');
  lines.push('Top exit variants by practical gate/score');
  lines.push('Group              Candidate                 OOS n/H5/WR/PF/Exp/AvgPnl     Full n/H5/PF/Exp    Pass');
  lines.push('-'.repeat(130));
  for (const row of ranking.slice(0, 12)) {
    const s = row.stats;
    lines.push(`${row.group.padEnd(18)} ${row.label.padEnd(25)} ${String(s.oos.n).padStart(4)} ${pct(s.oos.hit5).padStart(6)} ${pct(s.oos.win).padStart(6)} ${fmt(s.oos.pf).padStart(5)} ${r(s.oos.exp).padStart(8)} ${(s.oos.avgPnl >= 0 ? '+' : '') + fmt(s.oos.avgPnl).padStart(6)}%   ${String(s.all.n).padStart(4)} ${pct(s.all.hit5).padStart(6)} ${fmt(s.all.pf).padStart(5)} ${r(s.all.exp).padStart(8)}   ${row.pass ? 'YES' : 'NO'}`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, `deployable_sniper_retune_validation_${stamp}.json`);
  const txtPath = path.join(OUT_DIR, `deployable_sniper_retune_validation_${stamp}.txt`);
  fs.writeFileSync(jsonPath, JSON.stringify({ generated: new Date().toISOString(), dataDir: DATA_DIR, files: files.length, oosCut: OOS_CUT, results, ranking }, null, 2));
  fs.writeFileSync(txtPath, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\nJSON: ${jsonPath}\nTXT: ${txtPath}`);
}

if (isMainThread) main().catch(e => { console.error(e.stack || e); process.exit(1); });
else workerMain();
