'use strict';
// scripts/patternDiagnostic.js
// Deep-dive diagnostic: evaluates 7 new pattern hypotheses against full NSE universe
// Tests each independently and in combination with existing archetype conditions.
// Methodology: Same IS/OOS exit grid (96 combos), Wilson-ranked OOS WR per pattern.
// Usage: node scripts/patternDiagnostic.js

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const DATA_DIR  = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORKERS = Math.min(16, os.cpus().length);
const IS_CUT    = '2025-05-05';
const MIN_OOS_N = 20;

// Exit param grid — same as archetypeHyperTune
const TP_G  = [3, 4, 5, 6, 7, 8];
const SL_G  = [1.5, 2.0, 2.5, 3.0];
const HB_G  = [10, 15, 20, 25];
const N_EXIT = TP_G.length * SL_G.length * HB_G.length; // 96
function exitIdx(tpI, slI, hbI) { return tpI * (SL_G.length * HB_G.length) + slI * HB_G.length + hbI; }

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function wilsonLower(w, n, z = 1.645) {
  if (n === 0) return 0;
  const p = w / n;
  const z2 = z * z;
  return (p + z2/(2*n) - z*Math.sqrt(p*(1-p)/n + z2/(4*n*n))) / (1 + z2/n);
}

function parseCSV(content) {
  const lines = content.split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].trim().split(',');
    if (p.length < 6) continue;
    const [d, oc, hc, lc, cc, vc] = [p[0], +p[1], +p[2], +p[3], +p[4], +p[5]];
    if (!d || isNaN(cc) || cc <= 0) continue;
    out.push({ d, o: oc, h: hc, l: lc, c: cc, v: vc });
  }
  return out;
}

// ─── INDICATORS ──────────────────────────────────────────────────────────────
function computeATR14(candles) {
  const n = candles.length;
  const atr = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const tr = Math.max(candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i-1].c),
      Math.abs(candles[i].l - candles[i-1].c));
    if (i === 14) { let s = 0; for (let j=1;j<=14;j++) s += Math.max(candles[j].h-candles[j].l,Math.abs(candles[j].h-candles[j-1].c),Math.abs(candles[j].l-candles[j-1].c)); atr[i] = s/14; }
    else if (i < 14) atr[i] = tr;
    else atr[i] = (atr[i-1]*13 + tr) / 14;
  }
  return atr;
}

function computeEMA(candles, period) {
  const n = candles.length;
  const ema = new Float64Array(n);
  const k = 2 / (period + 1);
  ema[period-1] = candles.slice(0, period).reduce((s,c) => s + c.c, 0) / period;
  for (let i = period; i < n; i++) ema[i] = candles[i].c * k + ema[i-1] * (1-k);
  return ema;
}

function computeRSI(candles, period, endIdx) {
  let gain = 0, loss = 0;
  const start = Math.max(1, endIdx - period + 1);
  for (let i = start; i <= endIdx; i++) {
    const d = candles[i].c - candles[i-1].c;
    if (d > 0) gain += d; else loss -= d;
  }
  const cnt = endIdx - start + 1;
  const avg_g = gain / cnt, avg_l = loss / cnt;
  return avg_l === 0 ? 100 : 100 - 100 / (1 + avg_g / avg_l);
}

function computeDMI14(candles) {
  const n = candles.length;
  const dp = new Float64Array(n), dm = new Float64Array(n), adx = new Float64Array(n).fill(20);
  if (n < 30) return { dp, dm, adx };
  const P = 14;
  const dmP = new Float64Array(n), dmM = new Float64Array(n), tr = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const up = candles[i].h - candles[i-1].h, dn = candles[i-1].l - candles[i].l;
    dmP[i] = (up > dn && up > 0) ? up : 0;
    dmM[i] = (dn > up && dn > 0) ? dn : 0;
    tr[i] = Math.max(candles[i].h-candles[i].l, Math.abs(candles[i].h-candles[i-1].c), Math.abs(candles[i].l-candles[i-1].c));
  }
  let sTR = 0, sDMp = 0, sDMm = 0;
  for (let i = 1; i <= P; i++) { sTR += tr[i]; sDMp += dmP[i]; sDMm += dmM[i]; }
  const dxArr = new Float64Array(n);
  for (let i = P+1; i < n; i++) {
    sTR = sTR - sTR/P + tr[i]; sDMp = sDMp - sDMp/P + dmP[i]; sDMm = sDMm - sDMm/P + dmM[i];
    const d = sTR > 0 ? (sDMp/sTR)*100 : 0, e = sTR > 0 ? (sDMm/sTR)*100 : 0;
    dp[i] = d; dm[i] = e;
    const s = d + e; dxArr[i] = s > 0 ? Math.abs(d-e)/s*100 : 0;
  }
  const seed = P * 2;
  if (n > seed + 1) {
    let av = 0; for (let i=P+1;i<=seed;i++) av += dxArr[i]; av /= P;
    adx[seed] = av;
    for (let i = seed+1; i < n; i++) { av = (av*(P-1)+dxArr[i])/P; adx[i] = av; }
  }
  return { dp, dm, adx };
}

// Compute per-bar ATR for AVWAP swing-low anchor
function computeVolAvg(candles, endIdx, period) {
  let s = 0, cnt = 0;
  for (let i = Math.max(0, endIdx - period); i < endIdx; i++) { s += candles[i].v; cnt++; }
  return cnt > 0 ? s / cnt : 1;
}

// ─── PATTERN DETECTORS ───────────────────────────────────────────────────────
// Each returns true/false for a given bar index i

// P1: NR7 — current candle has smallest range in 7 days
function isNR7(candles, i) {
  if (i < 6) return false;
  const range = candles[i].h - candles[i].l;
  for (let j = i-6; j < i; j++) {
    if ((candles[j].h - candles[j].l) <= range) return false;
  }
  return true;
}

// P2: VCP Cheat — final tight consolidation breakout with volume dry-up then surge
// Detects: price range in last 5 bars ≤ 3% of price AND today's range > 1.5× last 5d avg range
// with volume > 1.5× 20d avg (breakout of tight zone)
function isVCPCheat(candles, i, volAvg20) {
  if (i < 25) return false;
  // Final consolidation range: max range of last 5 bars ≤ 3% of price
  let hiZone = -Infinity, loZone = Infinity;
  for (let j = i-5; j < i; j++) { hiZone = Math.max(hiZone, candles[j].h); loZone = Math.min(loZone, candles[j].l); }
  const zonePct = candles[i].c > 0 ? (hiZone - loZone) / candles[i].c * 100 : 99;
  if (zonePct > 4.0) return false;  // tighter: last 5 days consolidated within 4%

  // Volume dry-up in prior 5 days vs 20d avg (vol should be shrinking)
  const vPre5 = computeVolAvg(candles, i, 5);
  if (vPre5 > volAvg20 * 1.2) return false;  // vol must be below avg during base

  // Today: breakout above zone high on volume surge
  const todayAboveZone = candles[i].c > hiZone && candles[i].h > hiZone;
  const todayVolSurge  = candles[i].v > volAvg20 * 1.5;
  return todayAboveZone && todayVolSurge;
}

// P3: Pin Bar at Support (Hammer/Doji rejection with 2x volume)
// Lower tail ≥ 2× body, upper wick ≤ 30% of range, close in top 50%, vol > 2× 10d avg
function isPinBarAtSupport(candles, i, atr14, ema50Arr) {
  if (i < 15) return false;
  const c = candles[i];
  const range = c.h - c.l;
  if (range <= 0) return false;
  const body    = Math.abs(c.c - c.o);
  const lowerTail = Math.min(c.o, c.c) - c.l;
  const upperWick = c.h - Math.max(c.o, c.c);
  const closeLoc  = (c.c - c.l) / range;

  if (lowerTail < body * 2)     return false;  // lower tail must be 2× body
  if (upperWick > range * 0.30) return false;  // minimal upper wick
  if (closeLoc < 0.50)          return false;  // close in top half

  // Must be near EMA50 or 20d low (support zone)
  const ema50   = ema50Arr[i];
  const nearEma = ema50 > 0 && c.l < ema50 * 1.03 && c.c > ema50 * 0.97;
  let lo20 = Infinity;
  for (let j = Math.max(0, i-20); j < i; j++) lo20 = Math.min(lo20, candles[j].l);
  const nearLo20 = c.l < lo20 * 1.03;
  if (!nearEma && !nearLo20) return false;

  // Volume 2× 10d avg
  let vSum = 0;
  for (let j = Math.max(0, i-10); j < i; j++) vSum += candles[j].v;
  const vAvg10 = i >= 10 ? vSum / 10 : vSum / Math.max(1, i);
  return c.v > vAvg10 * 2.0;
}

// P4: Drop-Base-Rally (DBR)
// ≥3 consecutive bearish candles, then 1-2 neutral/base candles, then 2+ consecutive bullish
// "Today" must be the first or second bullish candle of the rally
function isDBR(candles, i) {
  if (i < 7) return false;

  // Check today and yesterday are both bullish (consecutive)
  if (candles[i].c <= candles[i].o) return false;  // today must be green
  if (i >= 1 && candles[i-1].c <= candles[i-1].o) return false;  // yesterday must be green

  // Find base (1-2 candles before the rally where range < 0.7× ATR-proxy)
  // Simple proxy: candle range < 60% of avg range of prior 5 candles
  let avgRangePre = 0;
  for (let j = Math.max(0, i-7); j < i-2; j++) avgRangePre += (candles[j].h - candles[j].l);
  avgRangePre /= Math.min(5, i-2);
  const baseRange1 = candles[i-2].h - candles[i-2].l;
  const baseRange2 = i >= 3 ? candles[i-3].h - candles[i-3].l : 999;
  const hasBase = baseRange1 < avgRangePre * 0.80 || baseRange2 < avgRangePre * 0.80;
  if (!hasBase) return false;

  // Find drop: ≥3 consecutive bearish candles before base
  const baseStart = baseRange1 < baseRange2 ? i-2 : i-3;
  let dropCount = 0;
  for (let j = baseStart - 1; j >= Math.max(0, baseStart-5); j--) {
    if (candles[j].c < candles[j].o) dropCount++;
    else break;
  }
  return dropCount >= 3;
}

// P5: Elder Force Index (EFI) flip from negative to positive
// EFI = (close - prevClose) * volume; smoothed with 2-bar EMA
// Inflection: today's 2-EMA EFI crosses above zero from below
function isEFIFlip(candles, i) {
  if (i < 5) return false;
  // Compute 2-bar EMA of raw EFI
  const rawEFI = (c, p) => (c.c - p.c) * c.v;
  const k = 2 / (2 + 1); // EMA2 multiplier
  let ema = rawEFI(candles[1], candles[0]);
  let prevEma = ema;
  for (let j = 2; j <= i; j++) {
    prevEma = ema;
    ema = rawEFI(candles[j], candles[j-1]) * k + ema * (1-k);
  }
  return ema > 0 && prevEma <= 0;
}

// P6: Anchored VWAP (AVWAP) breakout
// Anchor: most recent 20-bar swing low (lowest low in 20 bars that is also a local min)
// Compute VWAP from anchor to today; today closes above AVWAP on volume > 1.5× 20d avg
function isAVWAPBreakout(candles, i, volAvg20) {
  if (i < 25) return false;

  // Find swing low anchor (lowest low in last 20-60 bars)
  let swLowIdx = i - 20;
  let swLowPrice = Infinity;
  for (let j = Math.max(0, i-60); j < i-5; j++) {
    if (candles[j].l < swLowPrice) { swLowPrice = candles[j].l; swLowIdx = j; }
  }
  if (swLowIdx >= i-3) return false;  // anchor must be at least 3 bars back

  // Compute AVWAP from anchor to bar i-1 (not including today — we need prev AVWAP)
  let cumPV = 0, cumV = 0;
  for (let j = swLowIdx; j < i; j++) {
    const typical = (candles[j].h + candles[j].l + candles[j].c) / 3;
    cumPV += typical * candles[j].v;
    cumV  += candles[j].v;
  }
  const avwap = cumV > 0 ? cumPV / cumV : 0;
  if (avwap <= 0) return false;

  // Also check yesterday was below AVWAP (fresh cross)
  const prevTyp = (candles[i-1].h + candles[i-1].l + candles[i-1].c) / 3;
  const prevAVWAP_approx = avwap; // small approximation (yesterday's avwap ≈ today's)
  const prevBelowAVWAP = candles[i-1].c < prevAVWAP_approx * 1.005;

  const todayAboveAVWAP = candles[i].c > avwap;
  const volSurge = candles[i].v > volAvg20 * 1.5;

  return prevBelowAVWAP && todayAboveAVWAP && volSurge;
}

// P7: NR7 + Immediate Open-Drive (next-bar entry simulation)
// NR7 on day D; on day D+1 the stock opens above NR7 high (open-drive)
// We simulate "entry" at day D+1 open since that's when the signal is actionable
function isNR7OpenDrive(candles, i) {
  if (i < 7) return false;
  // Yesterday was NR7
  if (!isNR7(candles, i-1)) return false;
  // Today opens above yesterday's high
  return candles[i].o > candles[i-1].h;
}

// ─── EXIT SIMULATION ─────────────────────────────────────────────────────────
function simulateOutcomes(candles, entryIdx, atr14Arr) {
  const outcomes = new Int8Array(N_EXIT);
  const entry = candles[entryIdx].c;
  const atr   = atr14Arr[entryIdx] || entry * 0.02;
  const n     = candles.length;

  for (let tpI = 0; tpI < TP_G.length; tpI++) {
    const tp = entry * (1 + TP_G[tpI] / 100);
    for (let slI = 0; slI < SL_G.length; slI++) {
      const sl = entry - SL_G[slI] * atr;
      for (let hbI = 0; hbI < HB_G.length; hbI++) {
        const maxBar = Math.min(n - 1, entryIdx + HB_G[hbI]);
        let result = 0;
        for (let k = entryIdx + 1; k <= maxBar; k++) {
          if (candles[k].h >= tp) { result = 1; break; }
          if (candles[k].l <= sl) { result = -1; break; }
        }
        outcomes[exitIdx(tpI, slI, hbI)] = result;
      }
    }
  }
  return outcomes;
}

// ─── WORKER ──────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { files } = workerData;
  const results = {};
  // Pattern labels (indices match PATTERNS array in main thread)
  const PATTERN_NAMES = ['NR7','VCP_Cheat','PinBar_Support','DBR','EFI_Flip','AVWAP_Breakout','NR7_OpenDrive'];

  for (const file of files) {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const candles = parseCSV(raw);
    if (candles.length < 60) continue;

    const n       = candles.length;
    const atr14   = computeATR14(candles);
    const ema50   = computeEMA(candles, 50);
    const { dp, dm, adx } = computeDMI14(candles);

    for (let i = 20; i < n - 1; i++) {
      const date = candles[i].d;
      const isIS = date < IS_CUT;
      const volAvg20 = computeVolAvg(candles, i, 20);
      if (candles[i].c * volAvg20 < 10_000_000 / candles[i].c) continue; // liquidity gate (rough)
      // Proper liquidity: avg turnover
      let tSum = 0;
      for (let j = Math.max(0, i-20); j < i; j++) tSum += candles[j].c * candles[j].v;
      if (tSum / Math.min(20, i) < 10_000_000) continue;

      const patternFires = [
        isNR7(candles, i),
        isVCPCheat(candles, i, volAvg20),
        isPinBarAtSupport(candles, i, atr14[i], ema50),
        isDBR(candles, i),
        isEFIFlip(candles, i),
        isAVWAPBreakout(candles, i, volAvg20),
        isNR7OpenDrive(candles, i),
      ];

      // Also compute "any pattern fires" (union) and some combos
      const anyFires = patternFires.some(Boolean);
      const multiFires = patternFires.filter(Boolean).length >= 2;

      // Compute outcomes only if at least one pattern fires
      if (!anyFires) continue;
      const outcomes = simulateOutcomes(candles, i, atr14);

      for (let pIdx = 0; pIdx < patternFires.length; pIdx++) {
        if (!patternFires[pIdx]) continue;
        const key = PATTERN_NAMES[pIdx] + (isIS ? '_IS' : '_OOS');
        if (!results[key]) results[key] = new Int32Array(N_EXIT * 2); // [wins, total] per exit
        const r = results[key];
        for (let e = 0; e < N_EXIT; e++) {
          r[e*2+1]++;
          if (outcomes[e] === 1) r[e*2]++;
        }
      }

      // Multi-pattern combo
      if (multiFires) {
        const key2 = 'MULTI_2plus' + (isIS ? '_IS' : '_OOS');
        if (!results[key2]) results[key2] = new Int32Array(N_EXIT * 2);
        const r = results[key2];
        for (let e = 0; e < N_EXIT; e++) {
          r[e*2+1]++;
          if (outcomes[e] === 1) r[e*2]++;
        }
      }

      // Also test: NR7 + DMI (DI+ > DI- and ADX > 20) combo
      if (patternFires[0] && dp[i] > dm[i] && adx[i] >= 20) {
        const key3 = 'NR7_DMI' + (isIS ? '_IS' : '_OOS');
        if (!results[key3]) results[key3] = new Int32Array(N_EXIT * 2);
        const r = results[key3];
        for (let e = 0; e < N_EXIT; e++) {
          r[e*2+1]++;
          if (outcomes[e] === 1) r[e*2]++;
        }
      }

      // VCP + DMI combo
      if (patternFires[1] && dp[i] > dm[i] && adx[i] >= 20) {
        const key4 = 'VCP_DMI' + (isIS ? '_IS' : '_OOS');
        if (!results[key4]) results[key4] = new Int32Array(N_EXIT * 2);
        const r = results[key4];
        for (let e = 0; e < N_EXIT; e++) {
          r[e*2+1]++;
          if (outcomes[e] === 1) r[e*2]++;
        }
      }

      // DBR + high volume (≥2× avg)
      if (patternFires[3] && candles[i].v > volAvg20 * 2.0) {
        const key5 = 'DBR_HighVol' + (isIS ? '_IS' : '_OOS');
        if (!results[key5]) results[key5] = new Int32Array(N_EXIT * 2);
        const r = results[key5];
        for (let e = 0; e < N_EXIT; e++) {
          r[e*2+1]++;
          if (outcomes[e] === 1) r[e*2]++;
        }
      }

      // AVWAP + DI+ > DI-
      if (patternFires[5] && dp[i] > dm[i]) {
        const key6 = 'AVWAP_DMI' + (isIS ? '_IS' : '_OOS');
        if (!results[key6]) results[key6] = new Int32Array(N_EXIT * 2);
        const r = results[key6];
        for (let e = 0; e < N_EXIT; e++) {
          r[e*2+1]++;
          if (outcomes[e] === 1) r[e*2]++;
        }
      }
    }
  }

  // Serialize Int32Arrays as plain arrays for IPC
  const serialized = {};
  for (const [k, v] of Object.entries(results)) serialized[k] = Array.from(v);
  parentPort.postMessage(serialized);
}

// ─── MAIN THREAD ─────────────────────────────────────────────────────────────
if (isMainThread) {
  console.log(`Pattern Diagnostic — NSE Deep-Dive   ${new Date().toISOString()}`);
  console.log(`Files: scanning ${DATA_DIR}  Workers: ${N_WORKERS}  IS cut: ${IS_CUT}`);
  console.log('');

  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.csv'))
    .map(f => path.join(DATA_DIR, f));
  console.log(`Total files: ${files.length}`);

  // Split files across workers
  const chunks = Array.from({ length: N_WORKERS }, () => []);
  files.forEach((f, i) => chunks[i % N_WORKERS].push(f));

  // Merge results from all workers
  const merged = {};
  let done = 0;

  const workers = chunks.map(chunk => {
    const w = new Worker(__filename, { workerData: { files: chunk } });
    w.on('message', partial => {
      for (const [k, v] of Object.entries(partial)) {
        if (!merged[k]) merged[k] = new Int32Array(N_EXIT * 2);
        for (let e = 0; e < v.length; e++) merged[k][e] += v[e];
      }
      done++;
      if (done === N_WORKERS) analyze();
    });
    w.on('error', e => console.error('Worker error:', e));
    return w;
  });

  function analyze() {
    console.log('\nAll workers done. Analyzing results...\n');

    // Find best exit combo for each pattern (maximize OOS Wilson lower bound)
    const summary = {};

    for (const [key, arr] of Object.entries(merged)) {
      if (!key.endsWith('_OOS')) continue;
      const patName = key.replace('_OOS', '');
      const isKey   = patName + '_IS';
      const isArr   = merged[isKey];

      let bestWil = -1, bestTp = 0, bestSl = 0, bestHb = 0;
      let bestOosN = 0, bestOosW = 0, bestIsN = 0, bestIsW = 0;

      for (let tpI = 0; tpI < TP_G.length; tpI++) {
        for (let slI = 0; slI < SL_G.length; slI++) {
          for (let hbI = 0; hbI < HB_G.length; hbI++) {
            const e = exitIdx(tpI, slI, hbI);
            const oosW = arr[e*2], oosN = arr[e*2+1];
            if (oosN < MIN_OOS_N) continue;
            const wil = wilsonLower(oosW, oosN);
            if (wil > bestWil) {
              bestWil = wil; bestTp = TP_G[tpI]; bestSl = SL_G[slI]; bestHb = HB_G[hbI];
              bestOosN = oosN; bestOosW = oosW;
              if (isArr) { bestIsN = isArr[e*2+1]; bestIsW = isArr[e*2]; }
            }
          }
        }
      }

      if (bestOosN >= MIN_OOS_N) {
        summary[patName] = {
          oosN: bestOosN, oosW: bestOosW,
          oosWR: (bestOosW / bestOosN * 100).toFixed(1),
          wilLower: (bestWil * 100).toFixed(1),
          isN: bestIsN, isW: bestIsW,
          isWR: bestIsN > 0 ? (bestIsW / bestIsN * 100).toFixed(1) : '—',
          tp: bestTp, sl: bestSl, hb: bestHb,
        };
      }
    }

    // Sort by Wilson lower bound descending
    const rows = Object.entries(summary).sort((a,b) => +b[1].wilLower - +a[1].wilLower);

    console.log('═'.repeat(110));
    console.log('PATTERN DIAGNOSTIC — OOS Win Rate (Wilson 90% CI Lower Bound)');
    console.log('═'.repeat(110));
    console.log(`${'Pattern'.padEnd(22)} ${'IS_n'.padStart(6)} ${'IS_WR'.padStart(7)} ${'OOS_n'.padStart(6)} ${'OOS_WR'.padStart(8)} ${'Wilson'.padStart(8)}  TP%  SL×ATR  HB   VERDICT`);
    console.log('─'.repeat(110));

    for (const [name, s] of rows) {
      const verdict = +s.wilLower >= 12 ? '🟢 STRONG ADD'
        : +s.wilLower >= 8  ? '🟡 MODERATE ADD'
        : +s.wilLower >= 5  ? '🔵 MARGINAL'
        : '🔴 WEAK / NOISE';
      console.log(
        `${name.padEnd(22)} ${String(s.isN).padStart(6)} ${String(s.isWR+'%').padStart(7)} ${String(s.oosN).padStart(6)} ${String(s.oosWR+'%').padStart(8)} ${String(s.wilLower+'%').padStart(8)}  ${String(s.tp).padStart(3)}  ${String(s.sl).padStart(6)}  ${String(s.hb).padStart(3)}   ${verdict}`
      );
    }

    console.log('═'.repeat(110));

    // Deep analysis section
    console.log('\n── PATTERN DEEP-DIVE ANALYSIS ──────────────────────────────────────────────────────────────────\n');
    const BASE_WR_UNIVERSE = 3.0; // NSE base WR from prior diagnostic

    for (const [name, s] of rows) {
      const lift = (parseFloat(s.oosWR) / BASE_WR_UNIVERSE).toFixed(1);
      const poolQuality = s.oosN >= 100 ? 'large pool' : s.oosN >= 40 ? 'medium pool' : 'small pool — interpret carefully';
      console.log(`\n▶ ${name}`);
      console.log(`  OOS: ${s.oosW}/${s.oosN} = ${s.oosWR}% WR  |  Wilson lower: ${s.wilLower}%  |  Lift over base: ${lift}×`);
      console.log(`  IS:  ${s.isW}/${s.isN} = ${s.isWR}% WR  |  IS→OOS spread: ${(parseFloat(s.isWR) - parseFloat(s.oosWR)).toFixed(1)}pp  |  ${poolQuality}`);
      console.log(`  Best exit: TP=${s.tp}%  SL=${s.sl}×ATR  Hold=${s.hb}d`);
    }

    // Write full per-exit breakdown to file
    const outFile = `D:/Claude code/stock-screener/scripts/pattern_diagnostic_${new Date().toISOString().replace(/[:.]/g,'_').slice(0,19)}.txt`;
    const lines = [
      `Pattern Diagnostic — ${new Date().toISOString()}`,
      `IS cut: ${IS_CUT}  Files: ${files.length}  Min OOS n: ${MIN_OOS_N}`,
      '',
      'Pattern'.padEnd(22) + ' IS_n  IS_WR  OOS_n  OOS_WR  Wilson  TP  SL    HB  VERDICT',
      '─'.repeat(90),
    ];
    for (const [name, s] of rows) {
      const verdict = +s.wilLower >= 12 ? 'STRONG ADD' : +s.wilLower >= 8 ? 'MODERATE ADD' : +s.wilLower >= 5 ? 'MARGINAL' : 'WEAK';
      lines.push(`${name.padEnd(22)} ${s.isN} ${s.isWR}% ${s.oosN} ${s.oosWR}% ${s.wilLower}% ${s.tp}% ${s.sl}ATR ${s.hb}d ${verdict}`);
    }
    lines.push('', '── RAW OOS WR BY EXIT COMBO (top 3 patterns) ──');
    const top3 = rows.slice(0, 3).map(r => r[0]);
    for (const name of top3) {
      const arr = merged[name + '_OOS'];
      if (!arr) continue;
      lines.push(`\n${name}:`);
      for (let tpI = 0; tpI < TP_G.length; tpI++) {
        for (let slI = 0; slI < SL_G.length; slI++) {
          for (let hbI = 0; hbI < HB_G.length; hbI++) {
            const e = exitIdx(tpI, slI, hbI);
            const w = arr[e*2], n = arr[e*2+1];
            if (n < 10) continue;
            const wil = (wilsonLower(w, n) * 100).toFixed(1);
            lines.push(`  TP=${TP_G[tpI]}% SL=${SL_G[slI]}×ATR HB=${HB_G[hbI]}d  ${w}/${n}=${(w/n*100).toFixed(1)}%  Wil=${wil}%`);
          }
        }
      }
    }

    fs.writeFileSync(outFile, lines.join('\n'));
    console.log(`\n✅ Full results: ${outFile}`);
    console.log(`\n── SUMMARY RECOMMENDATION ──────────────────────────────────────────────────────────────────────`);
    console.log(`Base WR (no filter): ~${BASE_WR_UNIVERSE}%  |  Patterns with Wilson ≥ 8% = clinically significant add`);
    console.log(`Patterns with lift ≥ 3× over base = meaningful signal; ≥ 5× = high-conviction add`);
  }
}
