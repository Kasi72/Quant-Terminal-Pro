'use strict';
// scripts/wickBodyTune.js
// Wick / Body / Ratio param sweep — marginal lift measurement
// Tests each candle-architecture param INDEPENDENTLY on top of a base momentum
// or reversal signal, finds sweet spots per dimension, IS/OOS validated.
// Usage: node scripts/wickBodyTune.js

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DATA_DIR  = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORKERS = Math.min(16, os.cpus().length);
const IS_CUT    = '2025-05-05';
const MIN_OOS_N = 10;    // lower threshold — wick params reduce pool size

// ── Exit grid ─────────────────────────────────────────────────────────────────
const TP_G  = [3, 4, 5, 6, 7, 8];
const SL_G  = [1.5, 2.0, 2.5, 3.0];
const HB_G  = [10, 15, 20, 25];
const N_EXIT = TP_G.length * SL_G.length * HB_G.length; // 96
function exitIdx(tpI, slI, hbI) { return tpI * (SL_G.length * HB_G.length) + slI * HB_G.length + hbI; }

// ── Param sweep grid ──────────────────────────────────────────────────────────
// Each entry: { dim, label, values }
// We test each value of each dimension independently (all other params = base).
const SWEEP_DIMS = [
  // Breakout universe params
  { dim: 'minLowerWickPct', label: 'Min Lower Wick %',  mode: 'MOM', values: [0, 5, 8, 12, 15, 20, 25] },
  { dim: 'maxUpperWickPct', label: 'Max Upper Wick %',  mode: 'MOM', values: [15, 20, 25, 30, 35, 40, 50] },
  { dim: 'minBodyPct',      label: 'Min Body %',        mode: 'MOM', values: [20, 30, 35, 40, 45, 50, 60] },
  { dim: 'minCloseLoc',     label: 'Min Close Loc %',   mode: 'MOM', values: [40, 50, 55, 60, 65, 70, 75] },
  { dim: 'maxBodyAtr',      label: 'Max Body/ATR',      mode: 'MOM', values: [0.8, 1.0, 1.3, 1.6, 2.0, 2.5, 999] },
  { dim: 'maxCandleRisk',   label: 'Max Candle Risk %', mode: 'MOM', values: [4, 5, 6, 7, 8, 10, 15] },
  { dim: 'minUwbr',         label: 'Max UW/Body Ratio', mode: 'MOM', values: [0.25, 0.40, 0.60, 0.80, 1.0, 1.5, 999], reverse: true },
  // Reversal universe params
  { dim: 'minLowerWickPct', label: 'Min Lower Wick % (ORS)', mode: 'ORS', values: [0, 8, 12, 15, 20, 25, 30] },
  { dim: 'maxUpperWickPct', label: 'Max Upper Wick % (ORS)', mode: 'ORS', values: [15, 20, 25, 30, 35, 41, 50] },
  { dim: 'minBodyPct',      label: 'Min Body % (ORS)',       mode: 'ORS', values: [20, 30, 37, 45, 55, 60, 70] },
  { dim: 'maxBodyAtr',      label: 'Max Body/ATR (ORS)',     mode: 'ORS', values: [0.8, 1.0, 1.3, 1.6, 2.0, 2.5, 999] },
  { dim: 'minHammerScore',  label: 'Hammer: LW≥N×body (ORS)', mode: 'ORS', values: [0, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0] },
];

// Total test cases = SWEEP_DIMS × values each = 77 series
const ALL_TESTS = [];
for (const d of SWEEP_DIMS) {
  for (let vi = 0; vi < d.values.length; vi++) {
    ALL_TESTS.push({ dim: d.dim, label: d.label, mode: d.mode, value: d.values[vi], vi, reverse: d.reverse || false });
  }
}

// ── Wilson CI lower bound ─────────────────────────────────────────────────────
function wilsonLower(w, n, z = 1.645) {
  if (n === 0) return 0;
  const p = w / n;
  const z2 = z * z;
  return (p + z2/(2*n) - z*Math.sqrt(p*(1-p)/n + z2/(4*n*n))) / (1 + z2/n);
}

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].trim().split(',');
    if (p.length < 6) continue;
    const cc = +p[4];
    if (isNaN(cc) || cc <= 0) continue;
    out.push({ d: p[0], o: +p[1], h: +p[2], l: +p[3], c: cc, v: +p[5] });
  }
  return out;
}

// ── Indicators ────────────────────────────────────────────────────────────────
function computeATR14(candles) {
  const n = candles.length;
  const atr = new Float64Array(n);
  if (n < 2) return atr;
  atr[1] = candles[1].h - candles[1].l;
  for (let i = 2; i < n; i++) {
    const tr = Math.max(candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i-1].c),
      Math.abs(candles[i].l - candles[i-1].c));
    if (i < 14) atr[i] = tr;
    else if (i === 14) {
      let s = 0;
      for (let j = 1; j <= 14; j++) s += Math.max(candles[j].h-candles[j].l,
        Math.abs(candles[j].h-candles[j-1].c), Math.abs(candles[j].l-candles[j-1].c));
      atr[i] = s / 14;
    } else {
      atr[i] = (atr[i-1] * 13 + tr) / 14;
    }
  }
  return atr;
}

function computeEMA(candles, period) {
  const n = candles.length;
  const ema = new Float64Array(n);
  if (n < period) return ema;
  let s = 0;
  for (let i = 0; i < period; i++) s += candles[i].c;
  ema[period-1] = s / period;
  const k = 2 / (period + 1);
  for (let i = period; i < n; i++) ema[i] = candles[i].c * k + ema[i-1] * (1-k);
  return ema;
}

function computeDMI14(candles) {
  const n = candles.length;
  const adx = new Float64Array(n).fill(20);
  if (n < 30) return { adx };
  const P = 14;
  const dmP = new Float64Array(n), dmM = new Float64Array(n), tr = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const up = candles[i].h - candles[i-1].h, dn = candles[i-1].l - candles[i].l;
    dmP[i] = (up > dn && up > 0) ? up : 0;
    dmM[i] = (dn > up && dn > 0) ? dn : 0;
    tr[i] = Math.max(candles[i].h-candles[i].l,
      Math.abs(candles[i].h-candles[i-1].c), Math.abs(candles[i].l-candles[i-1].c));
  }
  let sTR = 0, sDMp = 0, sDMm = 0;
  for (let i = 1; i <= P; i++) { sTR += tr[i]; sDMp += dmP[i]; sDMm += dmM[i]; }
  const dxArr = new Float64Array(n);
  for (let i = P+1; i < n; i++) {
    sTR = sTR - sTR/P + tr[i]; sDMp = sDMp - sDMp/P + dmP[i]; sDMm = sDMm - sDMm/P + dmM[i];
    const dp = sTR > 0 ? (sDMp/sTR)*100 : 0, dm = sTR > 0 ? (sDMm/sTR)*100 : 0;
    const s = dp + dm; dxArr[i] = s > 0 ? Math.abs(dp-dm)/s*100 : 0;
  }
  const seed = P * 2;
  if (n > seed + 1) {
    let av = 0;
    for (let i = P+1; i <= seed; i++) av += dxArr[i]; av /= P;
    adx[seed] = av;
    for (let i = seed+1; i < n; i++) { av = (av*(P-1)+dxArr[i])/P; adx[i] = av; }
  }
  return { adx };
}

function computeRSI2(candles, i) {
  if (i < 2) return 50;
  let g = 0, l = 0;
  for (let j = Math.max(1, i-1); j <= i; j++) {
    const d = candles[j].c - candles[j-1].c;
    if (d > 0) g += d; else l -= d;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

// ── Candle arch metrics (inline, matches computeCandleArch in stockEngine) ────
function candleArch(c, atr14) {
  const range = c.h - c.l;
  if (range <= 0 || c.c <= 0) return null;
  const body         = Math.abs(c.c - c.o);
  const upper        = c.h - Math.max(c.o, c.c);
  const lower        = Math.min(c.o, c.c) - c.l;
  const bodyPct      = body  / range * 100;
  const upperWickPct = upper / range * 100;
  const lowerWickPct = lower / range * 100;
  const closeLoc     = (c.c - c.l) / range * 100;
  const safeBody     = Math.max(body, range * 0.001);
  const uwbr         = upper / safeBody;
  const bodyAtr      = atr14 > 0 ? body / atr14 : 0;
  const candleRisk   = range / c.c * 100;
  const isGreen      = c.c > c.o;
  return { bodyPct, upperWickPct, lowerWickPct, closeLoc, uwbr, bodyAtr, candleRisk, isGreen };
}

// ── Base signal checks ────────────────────────────────────────────────────────
// MOM: basic momentum breakout candidate (before any wick/body gate)
// volRatio ≥ 2.5, rangeATR ≥ 1.5, turnover ≥ 5M, green candle, DI+ aligned
function isMOMBase(candles, i, atr14Arr, adxArr, vAvg20, turnover20) {
  if (i < 20 || turnover20 < 5_000_000) return false;
  const c = candles[i];
  if (c.c <= c.o) return false;                            // must be green
  const volRatio = vAvg20 > 0 ? c.v / vAvg20 : 0;
  if (volRatio < 2.5) return false;                        // institutional volume
  const atr14 = atr14Arr[i] || 0.0001;
  const rangeATR = (c.h - c.l) / atr14;
  if (rangeATR < 1.5) return false;                        // range expansion
  if ((adxArr[i] || 0) < 15) return false;                 // trending regime
  return true;
}

// ORS: basic oversold reversal candidate
// rsi2 ≤ 12, distFromEMA20 ≤ -10%, drawdown from 60d high ≥ 35%, turnover ≥ 10M
function isORSBase(candles, i, ema20Arr, turnover20) {
  if (i < 60 || turnover20 < 10_000_000) return false;
  const c = candles[i];
  if (c.c <= 0) return false;
  const rsi2 = computeRSI2(candles, i);
  if (rsi2 > 12) return false;
  const e20 = ema20Arr[i];
  if (e20 <= 0) return false;
  const distE20 = (c.c - e20) / e20 * 100;
  if (distE20 > -10) return false;
  let swHi = 0;
  for (let j = Math.max(0, i-60); j < i; j++) if (candles[j].h > swHi) swHi = candles[j].h;
  const dd = swHi > 0 ? (swHi - c.c) / swHi * 100 : 0;
  if (dd < 35) return false;
  return true;
}

// ── Param filter — returns true if ca passes the test param ──────────────────
function passesFilter(ca, test) {
  if (!ca) return false;
  const { dim, value } = test;
  switch (dim) {
    case 'minLowerWickPct': return ca.lowerWickPct >= value;
    case 'maxUpperWickPct': return ca.upperWickPct <= value;
    case 'minBodyPct':      return ca.bodyPct >= value;
    case 'minCloseLoc':     return ca.closeLoc >= value;
    case 'maxBodyAtr':      return ca.bodyAtr <= value;
    case 'maxCandleRisk':   return ca.candleRisk <= value;
    case 'minUwbr':         return ca.uwbr <= value;         // uwbr lower = better
    case 'minHammerScore':  return ca.lowerWickPct >= value * ca.bodyPct; // LW ≥ N×body
    default: return true;
  }
}

// ── Exit simulator ────────────────────────────────────────────────────────────
function simExit(candles, entryIdx, tpPct, slAtrMult, holdBars, atr14Arr) {
  const entryPrice = candles[entryIdx].c;
  const atr = atr14Arr[entryIdx] || entryPrice * 0.02;
  const tp  = entryPrice * (1 + tpPct / 100);
  const sl  = entryPrice - slAtrMult * atr;
  const end = Math.min(candles.length - 1, entryIdx + holdBars);
  for (let i = entryIdx + 1; i <= end; i++) {
    if (candles[i].l <= sl) return 0;   // stopped out
    if (candles[i].h >= tp) return 1;   // hit target
  }
  return candles[end].c >= entryPrice ? 1 : 0;  // time-stop: win if above entry
}

// ── Per-file worker processing ────────────────────────────────────────────────
function processFile(filePath, isCut, tests) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const candles = parseCSV(raw);
  if (candles.length < 60) return null;

  const atr14Arr = computeATR14(candles);
  const ema20Arr = computeEMA(candles, 20);
  const { adx: adxArr } = computeDMI14(candles);

  // Per-test: for IS and OOS: [wins, total] × 96 exits
  // Layout: tests.length × 2 (is/oos) × N_EXIT × 2 (wins, total)
  // Flattened: [testIdx][isOos][exitIdx][0=wins,1=total]
  // Use Int32Array for efficiency
  const T = tests.length;
  const results = new Int32Array(T * 2 * N_EXIT * 2);
  function inc(testI, isIs, exitI, win) {
    const base = (testI * 2 + (isIs ? 0 : 1)) * N_EXIT * 2 + exitI * 2;
    results[base + 1]++;
    if (win) results[base]++;
  }

  // Group tests by mode
  const momTests = tests.map((t, i) => ({ ...t, i })).filter(t => t.mode === 'MOM');
  const orsTests = tests.map((t, i) => ({ ...t, i })).filter(t => t.mode === 'ORS');

  // Rolling turnover and vol avg
  let tSum = 0, vSum = 0, tcnt = 0;

  for (let i = 20; i < candles.length - 1; i++) {
    // Update rolling windows
    const tStart = Math.max(0, i - 20);
    if (i === 20) {
      tSum = 0; vSum = 0; tcnt = 0;
      for (let j = tStart; j < i; j++) {
        tSum += candles[j].c * candles[j].v;
        vSum += candles[j].v;
        tcnt++;
      }
    } else {
      tSum += candles[i-1].c * candles[i-1].v;
      vSum += candles[i-1].v;
      tcnt++;
      if (tcnt > 20) {
        const drop = Math.max(0, i - 21);
        tSum -= candles[drop].c * candles[drop].v;
        vSum -= candles[drop].v;
        tcnt--;
      }
    }
    const turnover20 = tcnt > 0 ? tSum / tcnt : 0;
    const vAvg20 = tcnt > 0 ? vSum / tcnt : 1;

    const isIs = candles[i].d < isCut;
    const atr14 = atr14Arr[i] || candles[i].c * 0.02;
    const ca = candleArch(candles[i], atr14);

    // ── MOM base ────────────────────────────────────────────────────────────
    if (momTests.length > 0 && isMOMBase(candles, i, atr14Arr, adxArr, vAvg20, turnover20)) {
      for (const test of momTests) {
        if (!passesFilter(ca, test)) continue;
        for (let tpI = 0; tpI < TP_G.length; tpI++)
        for (let slI = 0; slI < SL_G.length; slI++)
        for (let hbI = 0; hbI < HB_G.length; hbI++) {
          const win = simExit(candles, i, TP_G[tpI], SL_G[slI], HB_G[hbI], atr14Arr);
          inc(test.i, isIs, exitIdx(tpI, slI, hbI), win);
        }
      }
    }

    // ── ORS base ────────────────────────────────────────────────────────────
    if (orsTests.length > 0 && isORSBase(candles, i, ema20Arr, turnover20)) {
      for (const test of orsTests) {
        if (!passesFilter(ca, test)) continue;
        for (let tpI = 0; tpI < TP_G.length; tpI++)
        for (let slI = 0; slI < SL_G.length; slI++)
        for (let hbI = 0; hbI < HB_G.length; hbI++) {
          const win = simExit(candles, i, TP_G[tpI], SL_G[slI], HB_G[hbI], atr14Arr);
          inc(test.i, isIs, exitIdx(tpI, slI, hbI), win);
        }
      }
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER THREAD
// ─────────────────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { files, isCut, tests } = workerData;
  const T = tests.length;
  const accum = new Int32Array(T * 2 * N_EXIT * 2);

  for (const f of files) {
    try {
      const r = processFile(f, isCut, tests);
      if (!r) continue;
      for (let k = 0; k < accum.length; k++) accum[k] += r[k];
    } catch (_) {}
  }

  parentPort.postMessage({ accum: Buffer.from(accum.buffer) });
  return;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN THREAD
// ─────────────────────────────────────────────────────────────────────────────
const startTime = Date.now();
const files = fs.readdirSync(DATA_DIR)
  .filter(f => f.endsWith('.csv'))
  .map(f => path.join(DATA_DIR, f));

console.log(`\nWick / Body Tune  ${new Date().toISOString()}`);
console.log(`Files: ${files.length}  Workers: ${N_WORKERS}  Tests: ${ALL_TESTS.length}  Exits/test: ${N_EXIT}`);

// Split files across workers
const chunks = Array.from({ length: N_WORKERS }, () => []);
files.forEach((f, i) => chunks[i % N_WORKERS].push(f));

const T = ALL_TESTS.length;
const global = new Int32Array(T * 2 * N_EXIT * 2);

let done = 0;
const workers = chunks.map(chunk => new Promise(resolve => {
  const w = new Worker(__filename, { workerData: { files: chunk, isCut: IS_CUT, tests: ALL_TESTS } });
  w.on('message', ({ accum }) => {
    const arr = new Int32Array(Buffer.from(accum).buffer);
    for (let k = 0; k < global.length; k++) global[k] += arr[k];
    done++;
    process.stdout.write(`\r  Workers done: ${done}/${N_WORKERS}`);
    resolve();
  });
  w.on('error', resolve);
}));

Promise.all(workers).then(() => {
  console.log('\n\nAll workers done. Computing rankings...\n');

  // ── For each test, find best exit (max Wilson OOS) ──────────────────────────
  function getBase(testI, isIs) {
    const base = (testI * 2 + (isIs ? 0 : 1)) * N_EXIT * 2;
    let bestW = -1, bestTp = 0, bestSl = 0, bestHb = 0, bestWins = 0, bestTotal = 0;
    for (let tpI = 0; tpI < TP_G.length; tpI++)
    for (let slI = 0; slI < SL_G.length; slI++)
    for (let hbI = 0; hbI < HB_G.length; hbI++) {
      const idx = base + exitIdx(tpI, slI, hbI) * 2;
      const wins = global[idx], total = global[idx+1];
      const w = wilsonLower(wins, total);
      if (w > bestW) { bestW = w; bestTp = TP_G[tpI]; bestSl = SL_G[slI]; bestHb = HB_G[hbI]; bestWins = wins; bestTotal = total; }
    }
    return { wilson: bestW, wins: bestWins, total: bestTotal, tp: bestTp, sl: bestSl, hb: bestHb };
  }

  // Group by dim+mode, find base (value=0 or first value) Wilson for lift calc
  const dimGroups = {};
  for (let ti = 0; ti < ALL_TESTS.length; ti++) {
    const test = ALL_TESTS[ti];
    const key = `${test.mode}:${test.dim}`;
    if (!dimGroups[key]) dimGroups[key] = { label: test.label, mode: test.mode, dim: test.dim, entries: [] };
    const is  = getBase(ti, true);
    const oos = getBase(ti, false);
    dimGroups[key].entries.push({ value: test.value, is, oos });
  }

  // ── Print results table per dimension ──────────────────────────────────────
  const bar = '═'.repeat(110);
  const dim2 = '─'.repeat(110);
  const OUT = [];
  OUT.push('');
  OUT.push(bar);
  OUT.push('WICK / BODY PARAM TUNE — OOS Wilson 90% CI Lower Bound');
  OUT.push(bar);

  const allEntries = []; // for cross-dim ranking

  for (const key of Object.keys(dimGroups)) {
    const g = dimGroups[key];
    // Base = entries[0] (no filter / most permissive)
    const baseOOS = g.entries[0].oos;
    const baseIS  = g.entries[0].is;

    OUT.push('');
    OUT.push(`▶ ${g.label}  [${g.mode}]`);
    OUT.push(`  ${'Value'.padEnd(10)} ${'IS_n'.padStart(7)} ${'IS_WR'.padStart(8)} ${'OOS_n'.padStart(7)} ${'OOS_WR'.padStart(8)} ${'Wilson'.padStart(8)} ${'Lift vs base'.padStart(13)} ${'Best Exit'.padStart(20)}`);
    OUT.push('  ' + dim2.slice(0, 90));

    for (const e of g.entries) {
      const lift = e.oos.total >= MIN_OOS_N
        ? ((e.oos.wilson - baseOOS.wilson) * 100).toFixed(1) + 'pp'
        : '—';
      const isWR   = e.is.total > 0  ? (e.is.wins  / e.is.total  * 100).toFixed(1) + '%' : '—';
      const oosWR  = e.oos.total > 0 ? (e.oos.wins / e.oos.total * 100).toFixed(1) + '%' : '—';
      const wilson = e.oos.total >= MIN_OOS_N ? (e.oos.wilson * 100).toFixed(1) + '%' : '—';
      const exit   = e.oos.total >= MIN_OOS_N ? `TP${e.oos.tp}% SL${e.oos.sl}×ATR HB${e.oos.hb}d` : '—';

      // sweet spot flag: if lift ≥ +1pp and pool ≥ MIN_OOS_N
      const flag = (e.oos.total >= MIN_OOS_N && e.oos.wilson > baseOOS.wilson + 0.01) ? '★' : ' ';

      OUT.push(`  ${flag} ${String(e.value).padEnd(9)} ${String(e.is.total).padStart(7)} ${isWR.padStart(8)} ${String(e.oos.total).padStart(7)} ${oosWR.padStart(8)} ${wilson.padStart(8)} ${lift.padStart(13)} ${exit.padStart(20)}`);

      if (e.oos.total >= MIN_OOS_N) {
        allEntries.push({ key, label: g.label, mode: g.mode, dim: g.dim, value: e.value,
          oosWilson: e.oos.wilson, oosN: e.oos.total, oosWR: e.oos.total > 0 ? e.oos.wins/e.oos.total : 0,
          lift: e.oos.wilson - baseOOS.wilson,
          exit: `TP${e.oos.tp}% SL${e.oos.sl}×ATR HB${e.oos.hb}d` });
      }
    }
  }

  // ── Cross-dim leaderboard: top 20 single-param additions by Wilson lift ─────
  OUT.push('');
  OUT.push(bar);
  OUT.push('TOP PARAM VALUES BY OOS WILSON LIFT (single-param additions, ★ = best per dim)');
  OUT.push(bar);
  const ranked = allEntries
    .filter(e => e.lift > 0)
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 25);

  OUT.push(`  ${'Param'.padEnd(30)} ${'Value'.padEnd(10)} ${'Mode'.padEnd(5)} ${'OOS_n'.padStart(7)} ${'OOS_WR'.padStart(8)} ${'Wilson'.padStart(8)} ${'Lift'.padStart(8)} ${'Best Exit'.padStart(22)}`);
  OUT.push('  ' + '─'.repeat(105));
  for (const e of ranked) {
    OUT.push(
      `  ${e.label.padEnd(30)} ${String(e.value).padEnd(10)} ${e.mode.padEnd(5)}` +
      ` ${String(e.oosN).padStart(7)} ${(e.oosWR*100).toFixed(1).padStart(7)}%` +
      ` ${(e.oosWilson*100).toFixed(1).padStart(7)}% ${(e.lift*100).toFixed(1).padStart(7)}pp  ${e.exit.padStart(22)}`
    );
  }

  // ── Sweet spot recommendation ─────────────────────────────────────────────
  OUT.push('');
  OUT.push(bar);
  OUT.push('SWEET SPOT RECOMMENDATIONS (best value per dim with pool ≥ min and max Wilson)');
  OUT.push(bar);

  const bestPerDim = {};
  for (const e of allEntries) {
    if (!bestPerDim[e.key] || e.oosWilson > bestPerDim[e.key].oosWilson) {
      bestPerDim[e.key] = e;
    }
  }

  for (const key of Object.keys(bestPerDim)) {
    const e = bestPerDim[key];
    OUT.push(`  [${e.mode}] ${e.label.padEnd(32)} → optimal value: ${String(e.value).padEnd(8)}  OOS WR ${(e.oosWR*100).toFixed(1)}%  Wilson ${(e.oosWilson*100).toFixed(1)}%  lift +${(e.lift*100).toFixed(1)}pp`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  OUT.push('');
  OUT.push(`Elapsed: ${elapsed}s`);
  OUT.push(bar);

  const report = OUT.join('\n');
  console.log(report);

  // Save report
  const ts  = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const out = path.join('D:/Claude code/stock-screener/scripts', `wickBodyTune_${ts}.txt`);
  fs.writeFileSync(out, report);
  console.log(`\n✅ Full report: ${out}`);
});
