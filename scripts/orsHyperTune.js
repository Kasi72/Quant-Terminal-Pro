/**
 * ORS-Prime Hyper-Tuner
 * ─────────────────────
 * Sweeps ORS gate params + TP/SL axes with fine granularity across 1617 symbols (2021-2026).
 * Two-phase approach:
 *   Phase 1: sweep gate params (fix TP/SL at v3 best)       → ~3K combos
 *   Phase 2: sweep TP/SL for top gate combos                → ~192 × top-N combos
 *
 * Architecture:
 *   Main: collect all ORS candidates (relaxed gates), pre-compute future outcomes, then dispatch to workers.
 *   Workers: filter by gate combo → compute IS/OOS WR/PF → report back.
 *
 * Run: node scripts/orsHyperTune.js
 *      node scripts/orsHyperTune.js --phase 2   (TP/SL sweep using best gates from phase 1 output)
 */

'use strict';
const path  = require('path');
const fs    = require('fs');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { execSync } = require('child_process');

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const DATA_DIR    = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const NUM_WORKERS = Math.max(1, require('os').cpus().length - 1);
const MIN_HISTORY = 260;
const IS_SPLIT    = 0.70;   // 70% in-sample
const MIN_OOS_N   = 40;     // minimum OOS signals to be reportable
const MIN_IS_N    = 100;    // minimum IS signals
const MAX_HOLD_DEFAULT = 15;
const PHASE = process.argv.includes('--phase') ? parseInt(process.argv[process.argv.indexOf('--phase') + 1]) : 1;

const outFile = path.join(__dirname, `ors_hypertune_phase${PHASE}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 22)}Z.txt`);

// ─── RELAXED COLLECTION GATES (broad — captures everything worth considering) ─
const COLLECT_GATES = {
  maxRSI2:        25,   // very relaxed (production = 15)
  maxRSI14:       55,   // relaxed (production = 45)
  maxCloseLoc:    60,   // relaxed (production = 50)
  minBodyPct:     35,   // relaxed (production = 55)
  maxUpperWickPct: 40,  // relaxed (production = 25)
  minRangePct:    2.5,  // relaxed (production = 6)
  maxDistEMA20:   -2.0, // relaxed (production = -5)
  minDdSwingHigh: 12,   // relaxed (production = 30)
  minOrsScore:    40,   // very relaxed (production = 72)
};

// ─── PHASE 1: GATE SWEEP AXES (TP/SL fixed at v3 best) ──────────────────────
const GATE_AXES = {
  maxRSI2:         [3, 5, 7, 8, 10, 12, 15, 18],
  maxRSI14:        [35, 38, 40, 42, 45, 48, 50],
  minRangePct:     [4, 5, 5.5, 6, 6.5, 7, 8],
  maxDistEMA20:    [-3, -4, -5, -6, -7, -8, -10],
  minOrsScore:     [65, 68, 70, 72, 74, 76, 78, 80, 82, 85],
};
// Other gate params locked at v3 best for phase 1
const FIXED_GATES = {
  maxCloseLoc:     50,
  minBodyPct:      55,
  maxUpperWickPct: 25,
  minDdSwingHigh:  30,
  requireSwingLow: false,
  requireRedCandle:false,
};
// TP/SL locked at v3 best for phase 1
const FIXED_EXIT = { tpPct: 4, slAtrMult: 2.0, maxHoldBars: 15 };

// ─── PHASE 2: TP/SL SWEEP AXES (applied to top-10 gate combos from phase 1) ─
const TP_AXES      = [3, 3.5, 4, 4.5, 5, 5.5, 6, 8];
const SL_AXES      = [1.5, 1.75, 2.0, 2.25, 2.5, 3.0];
const HOLD_AXES    = [10, 12, 15, 20];

// ─── WORKER THREAD ENTRY ─────────────────────────────────────────────────────
if (!isMainThread) {
  const { candidates, combos, isCutoffIdx, phase } = workerData;
  const results = [];

  for (const combo of combos) {
    // filter candidates by gate combo
    const filtered = candidates.filter(c => passesCombGates(c, combo, phase));
    const isSignals = filtered.filter(c => c.sigIdx < isCutoffIdx);
    const oosSignals = filtered.filter(c => c.sigIdx >= isCutoffIdx);

    if (isSignals.length < MIN_IS_N) continue;
    if (oosSignals.length < MIN_OOS_N) continue;

    const exitKey = phase === 2
      ? `${combo.tpPct}_${combo.slAtrMult}_${combo.maxHoldBars}`
      : `${FIXED_EXIT.tpPct}_${FIXED_EXIT.slAtrMult}_${FIXED_EXIT.maxHoldBars}`;

    const isStats  = computeStats(isSignals, exitKey);
    const oosStats = computeStats(oosSignals, exitKey);

    const wilIS = wilsonScore(isStats.wr, isSignals.length);
    results.push({ combo, isN: isSignals.length, oosN: oosSignals.length, isStats, oosStats, wilIS });
  }

  // Sort by IS Wilson score descending, send top results back
  results.sort((a, b) => b.wilIS - a.wilIS);
  parentPort.postMessage({ results: results.slice(0, 100) });
  return;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function passesCombGates(c, combo, phase) {
  if (c.rsi2       > (combo.maxRSI2        ?? FIXED_GATES.maxRSI2 ?? 999))     return false;
  if (c.rsi14      > (combo.maxRSI14       ?? FIXED_GATES.maxRSI14 ?? 999))    return false;
  if (c.closeLoc   > (combo.maxCloseLoc    ?? FIXED_GATES.maxCloseLoc ?? 999)) return false;
  if (c.bodyPct    < (combo.minBodyPct     ?? FIXED_GATES.minBodyPct ?? 0))    return false;
  if (c.upWick     > (combo.maxUpperWickPct?? FIXED_GATES.maxUpperWickPct ?? 999)) return false;
  if (c.rPct       < (combo.minRangePct    ?? FIXED_GATES.minRangePct ?? 0))   return false;
  if (c.distE20    > (combo.maxDistEMA20   ?? FIXED_GATES.maxDistEMA20 ?? 999))return false;
  if (c.ddFromSwHi < (combo.minDdSwingHigh ?? FIXED_GATES.minDdSwingHigh ?? 0))return false;
  if (c.orsScore   < (combo.minOrsScore    ?? FIXED_GATES.minOrsScore ?? 0))   return false;
  if ((combo.requireSwingLow ?? FIXED_GATES.requireSwingLow) && !c.isSwLo)     return false;
  return true;
}

function computeStats(signals, exitKey) {
  let wins = 0, totalPct = 0;
  for (const s of signals) {
    const outcome = s.outcomes[exitKey];
    if (!outcome) continue;
    if (outcome.won) wins++;
    totalPct += outcome.pctGain;
  }
  const n  = signals.length;
  const wr = n > 0 ? wins / n : 0;
  const avg = n > 0 ? totalPct / n : 0;
  const losers = n - wins;
  const avgWin  = wins > 0 ? signals.filter(s => s.outcomes[exitKey]?.won).reduce((a, s) => a + s.outcomes[exitKey].pctGain, 0) / wins : 0;
  const avgLoss = losers > 0 ? signals.filter(s => !s.outcomes[exitKey]?.won).reduce((a, s) => a + s.outcomes[exitKey].pctGain, 0) / losers : 0;
  const grossWin  = wins > 0 ? wins * avgWin : 0;
  const grossLoss = losers > 0 ? Math.abs(losers * avgLoss) : 0;
  const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0);
  return { wr: wr * 100, avg, pf, wins, n };
}

function wilsonScore(wrPct, n) {
  if (n === 0) return 0;
  const p = wrPct / 100;
  const z = 1.645; // 90% CI lower bound
  return ((p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n)) * 100;
}

function computeEMA(candles, period) {
  const k = 2 / (period + 1);
  const arr = new Float64Array(candles.length);
  let ema = candles[0].c;
  arr[0] = ema;
  for (let i = 1; i < candles.length; i++) {
    ema = candles[i].c * k + ema * (1 - k);
    arr[i] = ema;
  }
  return arr;
}

function computeATR14(candles) {
  const arr = new Float64Array(candles.length);
  for (let i = 1; i < candles.length; i++) {
    const hi = candles[i].h, lo = candles[i].l, pc = candles[i - 1].c;
    const tr = Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc));
    arr[i] = i < 14 ? tr : arr[i - 1] * 13 / 14 + tr / 14;
  }
  arr[0] = candles[0].h - candles[0].l;
  return arr;
}

function computeOrsScore({ rsi2, rsi14, rPct, distE20, bodyPct, upWick, isSwLo, volDryUp, ddFromSwHi, zScore }) {
  let s = 0;
  if (rsi2 <= 3) s += 30; else if (rsi2 <= 5) s += 25; else if (rsi2 <= 10) s += 20; else if (rsi2 <= 15) s += 12;
  if (rsi14 <= 30) s += 15; else if (rsi14 <= 38) s += 10; else if (rsi14 <= 45) s += 5;
  if (rPct >= 5) s += 10; else if (rPct >= 3.5) s += 7; else if (rPct >= 2.4) s += 4;
  if (distE20 <= -8) s += 10; else if (distE20 <= -5) s += 7; else if (distE20 <= -2) s += 4;
  if (bodyPct >= 60) s += 8; else if (bodyPct >= 45) s += 5; else if (bodyPct >= 35) s += 2;
  if (upWick <= 10) s += 7; else if (upWick <= 20) s += 5; else if (upWick <= 30) s += 2;
  if (isSwLo) s += 5;
  if (volDryUp <= 0.70) s += 5; else if (volDryUp <= 0.85) s += 3;
  if (ddFromSwHi >= 30) s += 10; else if (ddFromSwHi >= 25) s += 8; else if (ddFromSwHi >= 20) s += 6; else if (ddFromSwHi >= 15) s += 3;
  if (zScore <= -3.0) s += 12; else if (zScore <= -2.5) s += 8; else if (zScore <= -2.0) s += 5;
  return Math.min(s, 100);
}

function simulateOutcome(candles, sigIdx, a14, tpPct, slAtrMult, maxHoldBars) {
  const entry = candles[sigIdx].c; // approximate: close of signal day (next open would be ideal)
  if (entry <= 0) return { won: false, pctGain: 0 };
  const tp = entry * (1 + tpPct / 100);
  const sl = Math.max(0, entry - slAtrMult * a14);

  for (let j = sigIdx + 1; j <= Math.min(candles.length - 1, sigIdx + maxHoldBars); j++) {
    const bar = candles[j];
    // Check SL first (intraday — low hits before high in a down scenario)
    if (bar.l <= sl && sl < entry) {
      return { won: false, pctGain: (sl - entry) / entry * 100 };
    }
    if (bar.h >= tp) {
      return { won: true, pctGain: (tp - entry) / entry * 100 };
    }
  }
  // Exit at close of last hold bar
  const exitBar = Math.min(candles.length - 1, sigIdx + maxHoldBars);
  const exitPrc = candles[exitBar].c;
  return { won: exitPrc > entry, pctGain: (exitPrc - entry) / entry * 100 };
}

// ─── CSV PARSING ──────────────────────────────────────────────────────────────
const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function parseDate(raw) {
  const s = String(raw || '').trim();
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
    const [dd, mon, yyyy] = s.split('-');
    const mm = String((MONTHS[mon.toLowerCase()] ?? 0) + 1).padStart(2, '0');
    return { iso: `${yyyy}-${mm}-${dd.padStart(2,'0')}`, ts: Math.floor(Date.UTC(+yyyy, +mm-1, +dd) / 1000) };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const iso = s.slice(0, 10);
    return { iso, ts: Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000) };
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? { iso: new Date(t).toISOString().slice(0,10), ts: Math.floor(t/1000) } : { iso:'', ts:0 };
}
function parseCSV(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split(/\r?\n/);
  const h = lines[0].split(',').map(x => x.trim().toLowerCase());
  const [iDate, iOpen, iHigh, iLow, iClose, iVol] = ['date','open','high','low','close','volume'].map(n => h.indexOf(n));
  if ([iDate,iOpen,iHigh,iLow,iClose,iVol].some(i => i < 0)) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    const { iso, ts } = parseDate(p[iDate]);
    const o=+p[iOpen], hh=+p[iHigh], lo=+p[iLow], c=+p[iClose], v=+p[iVol];
    if (!iso || !ts || !isFinite(o) || !isFinite(hh) || !isFinite(lo) || !isFinite(c) || c<=0 || hh<lo) continue;
    out.push({ ts, date:iso, o, h:hh, l:lo, c, v:isFinite(v)?v:0 });
  }
  out.sort((a,b) => a.ts - b.ts);
  return out;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const tsStart = Date.now();
  const log = (s) => { console.log(s); fs.appendFileSync(outFile, s + '\n'); };

  // Determine exit keys to pre-compute
  const exitKeys = PHASE === 1
    ? [`${FIXED_EXIT.tpPct}_${FIXED_EXIT.slAtrMult}_${FIXED_EXIT.maxHoldBars}`]
    : TP_AXES.flatMap(tp => SL_AXES.flatMap(sl => HOLD_AXES.map(h => `${tp}_${sl}_${h}`)));

  const exitCombos = PHASE === 1
    ? [FIXED_EXIT]
    : TP_AXES.flatMap(tp => SL_AXES.flatMap(sl => HOLD_AXES.map(h => ({ tpPct: tp, slAtrMult: sl, maxHoldBars: h }))));

  // Load symbols
  log(`ORS Hyper-Tuner — Phase ${PHASE}   ${new Date().toISOString()}`);
  log(`Workers: ${NUM_WORKERS}  IS/OOS: 70/30  Exit keys: ${exitKeys.length}`);
  log(`Data: ${DATA_DIR}`);

  if (!fs.existsSync(DATA_DIR)) throw new Error(`Data directory not found: ${DATA_DIR}`);
  const csvFiles = fs.readdirSync(DATA_DIR)
    .filter(f => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().includes('_all') && !f.toLowerCase().includes('all_symbols'));
  log(`CSV files: ${csvFiles.length}`);

  // ── Collection ─────────────────────────────────────────────────────────────
  log('\nPhase: collecting ORS candidates (relaxed gates)...');
  const candidates = [];   // [{ sym, ts, sigIdx, rsi2, rsi14, closeLoc, bodyPct, upWick, rPct, distE20, ddFromSwHi, orsScore, isSwLo, outcomes }]
  let skipped = 0;
  let processed = 0;

  for (const csvFile of csvFiles) {
    const fp = path.join(DATA_DIR, csvFile);
    const sym = csvFile.replace(/\.csv$/i, '');
    let candles;
    try {
      candles = parseCSV(fp);
    } catch (e) { skipped++; continue; }

    if (!Array.isArray(candles) || candles.length < MIN_HISTORY) { skipped++; continue; }

    const atr14Arr = computeATR14(candles);
    const ema20Arr = computeEMA(candles, 20);

    // Compute 252d z-score array (rolling — expensive but needed)
    const zAt = (i) => {
      const start = Math.max(0, i - 251);
      let sum = 0, cnt = 0;
      for (let j = start; j <= i; j++) { sum += candles[j].c; cnt++; }
      const mean = sum / cnt;
      let vSum = 0;
      for (let j = start; j <= i; j++) { const d = candles[j].c - mean; vSum += d * d; }
      const std = cnt > 1 ? Math.sqrt(vSum / (cnt - 1)) : 0;
      return std > 0 ? (candles[i].c - mean) / std : 0;
    };

    for (let i = 10; i < candles.length - 1; i++) {
      const c = candles[i];
      const range = c.h - c.l;
      if (range <= 0 || c.c <= 0) continue;

      // Liquidity gate (≥ 10M avg turnover)
      let tSum = 0, tCnt = 0;
      for (let j = Math.max(0, i - 20); j < i; j++) { tSum += candles[j].c * candles[j].v; tCnt++; }
      if (tCnt === 0 || tSum / tCnt < 10_000_000) continue;

      const bodyPct  = Math.abs(c.c - c.o) / range * 100;
      const upWick   = (c.h - Math.max(c.o, c.c)) / range * 100;
      const closeLoc = (c.c - c.l) / range * 100;
      const rPct     = range / c.c * 100;

      // Quick pre-filter before computing expensive indicators
      if (bodyPct  < COLLECT_GATES.minBodyPct)     continue;
      if (upWick   > COLLECT_GATES.maxUpperWickPct) continue;
      if (rPct     < COLLECT_GATES.minRangePct)     continue;
      if (closeLoc > COLLECT_GATES.maxCloseLoc)     continue;

      // RSI2
      let g2 = 0, l2 = 0;
      for (let j = Math.max(1, i - 1); j <= i; j++) {
        const d = candles[j].c - candles[j - 1].c;
        if (d > 0) g2 += d; else l2 -= d;
      }
      const rsi2 = l2 === 0 ? 100 : 100 - 100 / (1 + g2 / l2);
      if (rsi2 > COLLECT_GATES.maxRSI2) continue;

      // RSI14
      let g14 = 0, l14 = 0;
      for (let j = Math.max(1, i - 13); j <= i; j++) {
        const d = candles[j].c - candles[j - 1].c;
        if (d > 0) g14 += d; else l14 -= d;
      }
      const rsi14 = l14 === 0 ? 100 : 100 - 100 / (1 + g14 / l14);
      if (rsi14 > COLLECT_GATES.maxRSI14) continue;

      // EMA20 distance
      const e20   = ema20Arr[i];
      const distE20 = e20 > 0 ? (c.c - e20) / e20 * 100 : 0;
      if (distE20 > COLLECT_GATES.maxDistEMA20) continue;

      // 60d swing high drawdown
      let swHi = -Infinity;
      for (let j = Math.max(0, i - 60); j < i; j++) if (candles[j].h > swHi) swHi = candles[j].h;
      const ddFromSwHi = swHi > 0 ? (swHi - c.c) / swHi * 100 : 0;
      if (ddFromSwHi < COLLECT_GATES.minDdSwingHigh) continue;

      // 6-bar swing-low
      let minLo = Infinity;
      for (let j = Math.max(0, i - 6); j < i; j++) if (candles[j].l < minLo) minLo = candles[j].l;
      const isSwLo = c.l <= minLo;

      // Volume dry-up
      let v20s = 0, v20c = 0;
      for (let j = Math.max(0, i - 20); j < i; j++) { v20s += candles[j].v; v20c++; }
      const vAvg20 = v20c ? v20s / v20c : 1;
      let v5s = 0, v5c = 0;
      for (let j = Math.max(0, i - 5); j < i; j++) { v5s += candles[j].v; v5c++; }
      const volDryUp = v5c ? (v5s / v5c) / vAvg20 : 1;

      const zScore   = zAt(i);
      const orsScore = computeOrsScore({ rsi2, rsi14, rPct, distE20, bodyPct, upWick, isSwLo, volDryUp, ddFromSwHi, zScore });
      if (orsScore < COLLECT_GATES.minOrsScore) continue;

      // Pre-compute outcomes for all exit combos
      const a14 = atr14Arr[i];
      const outcomes = {};
      for (const ex of exitCombos) {
        const key = `${ex.tpPct}_${ex.slAtrMult}_${ex.maxHoldBars}`;
        outcomes[key] = simulateOutcome(candles, i, a14, ex.tpPct, ex.slAtrMult, ex.maxHoldBars);
      }

      candidates.push({
        sym, ts: c.ts, sigIdx: candidates.length, // use running index for IS/OOS split
        rsi2, rsi14, closeLoc, bodyPct, upWick, rPct, distE20, ddFromSwHi, orsScore, isSwLo,
        outcomes,
      });
    }
    processed++;
    if (processed % 200 === 0) log(`  Processed ${processed}/${csvFiles.length} symbols, ${candidates.length} candidates so far...`);
  }

  // Re-index sigIdx by date for IS/OOS
  candidates.sort((a, b) => a.ts - b.ts);
  candidates.forEach((c, i) => { c.sigIdx = i; });

  const isCutoffIdx = Math.floor(candidates.length * IS_SPLIT);
  const isCount  = isCutoffIdx;
  const oosCount = candidates.length - isCutoffIdx;

  log(`\nCollection complete: ${candidates.length} candidates (IS: ${isCount} | OOS: ${oosCount})`);
  log(`IS/OOS cutoff at signal rank ${isCutoffIdx} (ts=${new Date(candidates[isCutoffIdx]?.ts * 1000).toISOString().slice(0, 10)})`);

  if (candidates.length < 200) {
    log('ERROR: Too few candidates. Check COLLECT_GATES or candle data.');
    process.exit(1);
  }

  // ── Build sweep combos ────────────────────────────────────────────────────
  let sweepCombos = [];
  if (PHASE === 1) {
    for (const maxRSI2 of GATE_AXES.maxRSI2)
    for (const maxRSI14 of GATE_AXES.maxRSI14)
    for (const minRangePct of GATE_AXES.minRangePct)
    for (const maxDistEMA20 of GATE_AXES.maxDistEMA20)
    for (const minOrsScore of GATE_AXES.minOrsScore) {
      sweepCombos.push({ maxRSI2, maxRSI14, minRangePct, maxDistEMA20, minOrsScore });
    }
    log(`\nPhase 1 gate sweep: ${sweepCombos.length} combos (${GATE_AXES.maxRSI2.length}×${GATE_AXES.maxRSI14.length}×${GATE_AXES.minRangePct.length}×${GATE_AXES.maxDistEMA20.length}×${GATE_AXES.minOrsScore.length})`);
    log(`Fixed gates: closeLoc≤${FIXED_GATES.maxCloseLoc} body≥${FIXED_GATES.minBodyPct}% upWick≤${FIXED_GATES.maxUpperWickPct}% dd≥${FIXED_GATES.minDdSwingHigh}%`);
    log(`Fixed exit: TP=${FIXED_EXIT.tpPct}% SL=${FIXED_EXIT.slAtrMult}×ATR hold≤${FIXED_EXIT.maxHoldBars}d`);
  } else {
    // Load top gate combos from phase 1 output
    const phase1Files = fs.readdirSync(__dirname)
      .filter(f => f.startsWith('ors_hypertune_phase1_'))
      .sort().reverse();
    if (phase1Files.length === 0) {
      log('ERROR: No phase 1 output file found. Run phase 1 first.');
      process.exit(1);
    }
    const phase1File = path.join(__dirname, phase1Files[0]);
    log(`Loading phase 1 top gate combos from: ${phase1Files[0]}`);
    const topGateCombos = parseTopGateCombos(fs.readFileSync(phase1File, 'utf8'), 10);
    for (const gateComb of topGateCombos)
    for (const tpPct of TP_AXES)
    for (const slAtrMult of SL_AXES)
    for (const maxHoldBars of HOLD_AXES) {
      sweepCombos.push({ ...gateComb, tpPct, slAtrMult, maxHoldBars });
    }
    log(`Phase 2 TP/SL sweep: ${topGateCombos.length} gate combos × ${TP_AXES.length}×${SL_AXES.length}×${HOLD_AXES.length} = ${sweepCombos.length} combos`);
  }

  // ── Dispatch to workers ───────────────────────────────────────────────────
  const chunkSize = Math.ceil(sweepCombos.length / NUM_WORKERS);
  const chunks    = [];
  for (let i = 0; i < sweepCombos.length; i += chunkSize) chunks.push(sweepCombos.slice(i, i + chunkSize));

  log(`\nDispatching to ${NUM_WORKERS} workers (${chunkSize} combos/worker)...`);

  const allResults = await Promise.all(chunks.map((chunk, wi) => {
    return new Promise((resolve, reject) => {
      const w = new Worker(__filename, {
        workerData: { candidates, combos: chunk, isCutoffIdx, phase: PHASE },
      });
      w.on('message', resolve);
      w.on('error', reject);
      w.on('exit', code => { if (code !== 0) reject(new Error(`Worker ${wi} exited with code ${code}`)); });
    });
  }));

  // Merge and sort all results
  const merged = allResults.flatMap(r => r.results);
  merged.sort((a, b) => b.wilIS - a.wilIS);
  const top = merged.slice(0, 50);

  // ── Report ─────────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - tsStart) / 1000).toFixed(0);
  log(`\n${'═'.repeat(120)}`);
  log(`ORS HYPER-TUNER RESULTS — Phase ${PHASE}   (${elapsed}s)`);
  log(`Candidates: ${candidates.length} (IS: ${isCount} | OOS: ${oosCount})   Workers: ${NUM_WORKERS}`);
  log(`${'═'.repeat(120)}`);

  const exitKey = PHASE === 1 ? `${FIXED_EXIT.tpPct}_${FIXED_EXIT.slAtrMult}_${FIXED_EXIT.maxHoldBars}` : null;

  log(`\n${'─'.repeat(120)}`);
  log(`Rank  IS_N  IS_WR%  IS_Wil%  IS_Avg%  IS_PF  OOS_N  OOS_WR%  OOS_Avg%  OOS_PF  Params`);
  log(`${'─'.repeat(120)}`);

  let rank = 1;
  for (const r of top) {
    if (r.oosStats.wr < 60 && PHASE === 1) continue; // only show OOS WR ≥ 60%
    const comboStr = PHASE === 1
      ? `rsi2≤${r.combo.maxRSI2} rsi14≤${r.combo.maxRSI14} rng≥${r.combo.minRangePct}% ema≤${r.combo.maxDistEMA20}% score≥${r.combo.minOrsScore}`
      : `rsi2≤${r.combo.maxRSI2} rsi14≤${r.combo.maxRSI14} rng≥${r.combo.minRangePct}% ema≤${r.combo.maxDistEMA20}% score≥${r.combo.minOrsScore} TP=${r.combo.tpPct}% SL=${r.combo.slAtrMult}x hold=${r.combo.maxHoldBars}d`;
    log(
      `${String(rank).padStart(4)}  ` +
      `${String(r.isN).padStart(5)}  ` +
      `${r.isStats.wr.toFixed(1).padStart(6)}%  ` +
      `${r.wilIS.toFixed(1).padStart(7)}%  ` +
      `${r.isStats.avg.toFixed(2).padStart(7)}%  ` +
      `${r.isStats.pf.toFixed(2).padStart(5)}  ` +
      `${String(r.oosN).padStart(5)}  ` +
      `${r.oosStats.wr.toFixed(1).padStart(7)}%  ` +
      `${r.oosStats.avg.toFixed(2).padStart(8)}%  ` +
      `${r.oosStats.pf.toFixed(2).padStart(6)}  ` +
      comboStr
    );
    rank++;
    if (rank > 20) break;
  }

  // Print top 3 in detail
  log(`\n${'═'.repeat(120)}`);
  log('TOP 3 COMBOS — FULL DETAIL');
  log(`${'═'.repeat(120)}`);
  for (let i = 0; i < Math.min(3, top.length); i++) {
    const r = top[i];
    log(`\nRank ${i + 1}:`);
    log(`  IS:  n=${r.isN}  WR=${r.isStats.wr.toFixed(1)}%  Wil=${r.wilIS.toFixed(1)}%  Avg=${r.isStats.avg.toFixed(2)}%  PF=${r.isStats.pf.toFixed(2)}`);
    log(`  OOS: n=${r.oosN}  WR=${r.oosStats.wr.toFixed(1)}%  Avg=${r.oosStats.avg.toFixed(2)}%  PF=${r.oosStats.pf.toFixed(2)}`);
    if (PHASE === 1) {
      log(`  Gate params (override v3):`);
      log(`    maxRSI2: ${r.combo.maxRSI2}`);
      log(`    maxRSI14: ${r.combo.maxRSI14}`);
      log(`    minRangePct: ${r.combo.minRangePct}`);
      log(`    maxDistEMA20: ${r.combo.maxDistEMA20}`);
      log(`    minOrsScore: ${r.combo.minOrsScore}`);
      log(`  Fixed:`);
      log(`    maxCloseLoc: ${FIXED_GATES.maxCloseLoc}`);
      log(`    minBodyPct: ${FIXED_GATES.minBodyPct}`);
      log(`    maxUpperWickPct: ${FIXED_GATES.maxUpperWickPct}`);
      log(`    minDdSwingHigh: ${FIXED_GATES.minDdSwingHigh}`);
    } else {
      log(`  All params:`);
      log(`    maxRSI2: ${r.combo.maxRSI2}  maxRSI14: ${r.combo.maxRSI14}  minRangePct: ${r.combo.minRangePct}  maxDistEMA20: ${r.combo.maxDistEMA20}  minOrsScore: ${r.combo.minOrsScore}`);
      log(`    tpPct: ${r.combo.tpPct}  slAtrMult: ${r.combo.slAtrMult}  maxHoldBars: ${r.combo.maxHoldBars}`);
    }
  }

  // Print machine-readable JSON for top gate combo (phase 1) or best overall (phase 2)
  if (top.length > 0) {
    const best = top[0];
    const bestParams = PHASE === 1
      ? {
          maxRSI2: best.combo.maxRSI2, maxRSI14: best.combo.maxRSI14,
          maxCloseLoc: FIXED_GATES.maxCloseLoc, minBodyPct: FIXED_GATES.minBodyPct,
          maxUpperWickPct: FIXED_GATES.maxUpperWickPct, minRangePct: best.combo.minRangePct,
          maxDistEMA20: best.combo.maxDistEMA20, minDdSwingHigh: FIXED_GATES.minDdSwingHigh,
          requireSwingLow: FIXED_GATES.requireSwingLow, requireRedCandle: FIXED_GATES.requireRedCandle,
          minOrsScore: best.combo.minOrsScore,
          tpPct: FIXED_EXIT.tpPct, slAtrMult: FIXED_EXIT.slAtrMult, maxHoldBars: FIXED_EXIT.maxHoldBars,
        }
      : {
          maxRSI2: best.combo.maxRSI2, maxRSI14: best.combo.maxRSI14,
          maxCloseLoc: best.combo.maxCloseLoc ?? FIXED_GATES.maxCloseLoc,
          minBodyPct: best.combo.minBodyPct ?? FIXED_GATES.minBodyPct,
          maxUpperWickPct: best.combo.maxUpperWickPct ?? FIXED_GATES.maxUpperWickPct,
          minRangePct: best.combo.minRangePct, maxDistEMA20: best.combo.maxDistEMA20,
          minDdSwingHigh: best.combo.minDdSwingHigh ?? FIXED_GATES.minDdSwingHigh,
          requireSwingLow: FIXED_GATES.requireSwingLow, requireRedCandle: FIXED_GATES.requireRedCandle,
          minOrsScore: best.combo.minOrsScore,
          tpPct: best.combo.tpPct, slAtrMult: best.combo.slAtrMult, maxHoldBars: best.combo.maxHoldBars,
        };
    log(`\n★ BEST PARAMS JSON (copy into stockEngine.ts):`);
    log(JSON.stringify(bestParams, null, 2));
  }

  log(`\n✅ Done in ${elapsed}s. Results saved to: ${outFile}`);
}

function parseTopGateCombos(fileContent, topN) {
  // Parse rank table from phase 1 output — extract gate params from combos
  const lines = fileContent.split('\n');
  const combos = [];
  const rankRegex = /rsi2≤(\d+)\s+rsi14≤(\d+)\s+rng≥([\d.]+)%\s+ema≤([-\d.]+)%\s+score≥(\d+)/;
  for (const line of lines) {
    const m = rankRegex.exec(line);
    if (m) {
      combos.push({
        maxRSI2: +m[1], maxRSI14: +m[2], minRangePct: +m[3],
        maxDistEMA20: +m[4], minOrsScore: +m[5],
      });
      if (combos.length >= topN) break;
    }
  }
  return combos;
}

main().catch(err => { console.error(err); process.exit(1); });
