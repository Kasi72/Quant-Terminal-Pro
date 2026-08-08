'use strict';

/**
 * Stop Loss Optimisation Backtest
 * ================================
 * Tests 40+ stop placement methods across 1617 NSE files (14.3L+ signal bars).
 * Measures win rate, smart-money sweep detection, and cascaded EV.
 *
 * Stop methods:
 *   A) ATR multiples  — 1.0× to 3.5× step 0.25 (11 values)
 *   B) Fixed %        — 1.5% to 7.5% step 0.5% (13 values)
 *   C) N-bar low+buf  — lookback 5/8/13 bars × buffer 0%/0.3%/0.5% (9 combos)
 *   D) EMA+buf        — EMA(10)/EMA(21) × buffer 0.2%/0.5% (4 combos)
 *   E) Hybrid         — max(2×ATR, N-bar-low×(1+buf)) — floor stop with structure
 *
 * Targets use the 14.3L-signal validated formula:
 *   T1 = 1.5×ATR above entry, T2 = 3×ATR, T3 = 5×ATR
 * Exit sizing: 50% at T1, 30% at T2, 20% at T3
 *
 * Metrics per stop method, per ATR% band:
 *   winRate     — % signals where stop never touched before T1
 *   sweepRate   — % where stop wick-touched but price closed above entry within 3 bars (stop hunt)
 *   t1HitRate   — % hitting T1 within 20 bars (before stop)
 *   t2HitRate   — % hitting T2 (conditional on T1 hit)
 *   t3HitRate   — % hitting T3 (conditional on T2 hit)
 *   ev          — weighted EV per trade (stop loss = −stopPct, targets weighted)
 *   avgStopPct  — average stop distance %
 *   rrAtT2      — average R:R at T2 (T2gain / stopDist)
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const HORIZON   = 20;
const MIN_BARS  = 250;
const OUT_DIR   = path.join(__dirname, 'results');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── CSV parser ────────────────────────────────────────────────────────────────
function parseCSV(fp) {
  const raw = fs.readFileSync(fp, 'utf8').replace(/^﻿/, '').trim();
  const out = [];
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const p = line.split(',').map(x => x.trim());
    if (p.length < 6) continue;
    const ts = Date.parse(p[0]);
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5];
    if (!isFinite(ts) || ![o,h,l,c,v].every(isFinite) || o <= 0) continue;
    out.push({ ts: Math.floor(ts/1000), o, h, l, c, v: Math.max(0,v) });
  }
  out.sort((a,b) => a.ts - b.ts);
  const d = [];
  for (const x of out) {
    if (d.length && d[d.length-1].ts === x.ts) d[d.length-1] = x;
    else d.push(x);
  }
  return d;
}

// ── ATR14 ─────────────────────────────────────────────────────────────────────
function computeATR14(c) {
  const atr = new Float64Array(c.length);
  if (c.length <= 14) return atr;
  let s = 0;
  for (let i = 1; i <= 14; i++) {
    const tr = Math.max(c[i].h-c[i].l, Math.abs(c[i].h-c[i-1].c), Math.abs(c[i].l-c[i-1].c));
    s += tr;
  }
  atr[14] = s / 14;
  for (let i = 15; i < c.length; i++) {
    const tr = Math.max(c[i].h-c[i].l, Math.abs(c[i].h-c[i-1].c), Math.abs(c[i].l-c[i-1].c));
    atr[i] = (atr[i-1]*13 + tr) / 14;
  }
  return atr;
}

// ── EMA ───────────────────────────────────────────────────────────────────────
function computeEMA(c, period) {
  const ema = new Float64Array(c.length);
  if (c.length < period) return ema;
  let s = 0;
  for (let i = 0; i < period; i++) s += c[i].c;
  ema[period-1] = s / period;
  const k = 2 / (period + 1);
  for (let i = period; i < c.length; i++) ema[i] = c[i].c * k + ema[i-1] * (1-k);
  return ema;
}

// ── Stop method definitions ───────────────────────────────────────────────────
function buildStopMethods() {
  const methods = [];

  // A) ATR multiples
  for (const m of [1.0,1.25,1.5,1.75,2.0,2.25,2.5,2.75,3.0,3.25,3.5]) {
    methods.push({ key: `atr_${m}x`, label: `ATR ${m}×`, type: 'atr', mult: m });
  }

  // B) Fixed %
  for (const p of [1.5,2.0,2.5,3.0,3.5,4.0,4.5,5.0,5.5,6.0,6.5,7.0,7.5]) {
    methods.push({ key: `pct_${p}`, label: `Fixed ${p}%`, type: 'pct', pct: p });
  }

  // C) N-bar swing low + buffer
  for (const lb of [5, 8, 13]) {
    for (const buf of [0, 0.3, 0.5, 0.8]) {
      methods.push({ key: `swing${lb}_buf${buf}`, label: `${lb}-bar low +${buf}%buf`, type: 'swing', lookback: lb, buf });
    }
  }

  // D) EMA + buffer
  for (const period of [10, 21]) {
    for (const buf of [0.2, 0.5]) {
      methods.push({ key: `ema${period}_buf${buf}`, label: `EMA(${period}) +${buf}%buf`, type: 'ema', period, buf });
    }
  }

  // E) Hybrid: max(2×ATR floor, swingLow×(1+buf)) — structure + ATR guard
  for (const lb of [5, 8]) {
    for (const buf of [0.3, 0.5]) {
      methods.push({ key: `hybrid_${lb}b_${buf}buf`, label: `Hybrid(2×ATR ∨ ${lb}L+${buf}%)`, type: 'hybrid', lookback: lb, buf });
    }
  }

  return methods;
}

// ── Per-method stats accumulator ──────────────────────────────────────────────
function newStats() {
  return {
    signals: 0, stopped: 0, swept: 0,
    hitT1: 0, hitT2: 0, hitT3: 0,
    totalEV: 0, totalStopPct: 0, totalRR: 0, validRR: 0,
    // per ATR band
    bands: { lt1: newBand(), b1to2: newBand(), b2to3: newBand(), gt3: newBand() },
  };
}
function newBand() { return { signals: 0, stopped: 0, hitT1: 0, totalEV: 0 }; }

// ── Main ──────────────────────────────────────────────────────────────────────
const METHODS = buildStopMethods();
const stats   = {};
for (const m of METHODS) stats[m.key] = newStats();

const files = fs.readdirSync(DATA_DIR)
  .filter(f => /\.csv$/i.test(f))
  .map(f => path.join(DATA_DIR, f));

console.log(`\nStop Loss Optimiser — ${files.length} files × ${METHODS.length} methods\n`);

let processed = 0, totalSig = 0;

for (const fp of files) {
  let c;
  try { c = parseCSV(fp); } catch { continue; }
  if (c.length < MIN_BARS + HORIZON + 25) continue;
  processed++;

  const atr14 = computeATR14(c);
  const ema10  = computeEMA(c, 10);
  const ema21  = computeEMA(c, 21);

  for (let i = 220; i < c.length - HORIZON - 2; i++) {
    const atr   = atr14[i];
    if (!atr || atr <= 0) continue;

    const entry    = c[i+1].o;
    if (!entry || entry <= 0) continue;

    const atrPct   = atr / entry * 100;
    if (atrPct < 0.3 || atrPct > 12) continue;

    // Targets (from validated backtest: T1=1.5×ATR, T2=3×ATR, T3=5×ATR)
    const t1Price  = entry + 1.5 * atr;
    const t2Price  = entry + 3.0 * atr;
    const t3Price  = entry + 5.0 * atr;

    totalSig++;

    // Pre-compute swing lows needed
    const swingLow5  = Math.min(...[...Array(5)].map((_,k) => c[i-k]?.l ?? Infinity));
    const swingLow8  = Math.min(...[...Array(8)].map((_,k) => c[i-k]?.l ?? Infinity));
    const swingLow13 = Math.min(...[...Array(13)].map((_,k) => c[i-k]?.l ?? Infinity));
    const e10 = ema10[i];
    const e21 = ema21[i];

    // ATR band
    const band = atrPct < 1 ? 'lt1' : atrPct < 2 ? 'b1to2' : atrPct < 3 ? 'b2to3' : 'gt3';

    for (const m of METHODS) {
      // Compute stop price for this method
      let stopRaw = 0;
      if (m.type === 'atr') {
        stopRaw = entry - m.mult * atr;
      } else if (m.type === 'pct') {
        stopRaw = entry * (1 - m.pct / 100);
      } else if (m.type === 'swing') {
        const sl = m.lookback === 5 ? swingLow5 : m.lookback === 8 ? swingLow8 : swingLow13;
        stopRaw = sl * (1 - m.buf / 100);
      } else if (m.type === 'ema') {
        const eVal = m.period === 10 ? e10 : e21;
        if (!eVal || eVal <= 0) continue;
        stopRaw = eVal * (1 - m.buf / 100);
      } else if (m.type === 'hybrid') {
        const sl = m.lookback === 5 ? swingLow5 : swingLow8;
        const structureStop = sl * (1 - m.buf / 100);
        const atrFloor      = entry - 2 * atr;
        stopRaw = Math.max(structureStop, atrFloor);
      }

      // Guard: stop must be below entry and reasonable
      if (!stopRaw || stopRaw >= entry || stopRaw <= 0) continue;
      const stopPct = (entry - stopRaw) / entry * 100;
      if (stopPct < 0.5 || stopPct > 15) continue;

      const st = stats[m.key];
      st.signals++;
      st.totalStopPct += stopPct;

      const rrT2 = (t2Price - entry) / (entry - stopRaw);
      if (rrT2 > 0) { st.totalRR += rrT2; st.validRR++; }

      const bnd = st.bands[band];
      bnd.signals++;

      // Walk forward HORIZON bars
      let stopped = false, swept = false;
      let hitT1 = false, hitT2 = false, hitT3 = false;
      let stopTouchBar = -1;

      for (let j = i+1; j <= i + HORIZON && j < c.length; j++) {
        const bar = c[j];

        // Check stop first (low touches stop)
        if (!stopped && bar.l <= stopRaw) {
          stopped = true;
          stopTouchBar = j - (i+1); // bar index from entry
        }

        // Check targets (use high)
        if (!hitT1 && bar.h >= t1Price) hitT1 = true;
        if (!hitT2 && bar.h >= t2Price) hitT2 = true;
        if (!hitT3 && bar.h >= t3Price) hitT3 = true;
      }

      // Detect sweep: stop was touched, but within 3 bars price closed ABOVE entry
      if (stopped && stopTouchBar >= 0) {
        for (let k = 1; k <= 3 && (i+1+stopTouchBar+k) < c.length; k++) {
          if (c[i+1+stopTouchBar+k].c > entry) { swept = true; break; }
        }
      }

      // Win = stop never touched before T1
      const won = !stopped || (hitT1 && !stopped);
      // More nuanced: won if T1 hit AND stop not touched before T1
      // Walk again to find order of events
      let t1HitBar = 999, stopBar = 999;
      for (let j = i+1; j <= i + HORIZON && j < c.length; j++) {
        const b = c[j], bi = j - (i+1);
        if (t1HitBar === 999 && b.h >= t1Price) t1HitBar = bi;
        if (stopBar === 999 && b.l <= stopRaw)  stopBar  = bi;
      }
      const t1BeforeStop = t1HitBar < stopBar;
      const effectiveWin = t1BeforeStop; // T1 hit before stop triggered

      // EV calculation (all fractions, assume 3-tranche exit)
      // If stopped: lose full position at -stopPct
      // Tranche exits: T1(50%) locks profit, T2(30%), T3(20%)
      // If T1 not hit before stop: full loss = -stopPct
      // If T1 hit before stop: 50% locked at T1 gain, then stop or T2/T3 for rest
      let ev = 0;
      const t1Gain = (t1Price - entry) / entry * 100;
      const t2Gain = (t2Price - entry) / entry * 100;
      const t3Gain = (t3Price - entry) / entry * 100;

      if (!effectiveWin) {
        // T1 never reached before stop
        if (t1BeforeStop === false) {
          ev = -stopPct; // full loss
        }
      } else {
        // T1 hit before stop — 50% locked
        ev += 0.50 * t1Gain;
        // Check T2 order
        let t2HitBar = 999;
        for (let j = i+1; j <= i+HORIZON && j < c.length; j++) {
          if (c[j].h >= t2Price && (j-(i+1)) < stopBar) { t2HitBar = j-(i+1); break; }
        }
        if (t2HitBar < stopBar) {
          // T2 hit — 30% locked
          ev += 0.30 * t2Gain;
          // Check T3
          let t3HitBar = 999;
          for (let j = i+1; j <= i+HORIZON && j < c.length; j++) {
            if (c[j].h >= t3Price && (j-(i+1)) < stopBar) { t3HitBar = j-(i+1); break; }
          }
          if (t3HitBar < stopBar) {
            ev += 0.20 * t3Gain;
          } else {
            // T3 not hit — remaining 20% exits at stop or horizon close
            const endBar = Math.min(i + HORIZON, c.length-1);
            const exitPct = stopBar < 999 ? -stopPct : (c[endBar].c - entry) / entry * 100;
            ev += 0.20 * exitPct;
          }
        } else {
          // T2 not hit — remaining 50% exits at stop or horizon close
          const endBar = Math.min(i + HORIZON, c.length-1);
          const exitPct = stopBar < 999 ? -stopPct : (c[endBar].c - entry) / entry * 100;
          ev += 0.50 * exitPct;
        }
      }

      st.totalEV += ev;
      if (effectiveWin) { st.hitT1++; bnd.hitT1++; }
      else { st.stopped++; bnd.stopped++; }
      if (t2HitBar2(i, c, t2Price, stopBar, HORIZON)) st.hitT2++;
      if (t3HitBar2(i, c, t3Price, stopBar, HORIZON)) st.hitT3++;
      if (swept) st.swept++;

      bnd.totalEV += ev;
    }
  }

  if (processed % 200 === 0) process.stdout.write(`\r  Processed ${processed} files, ${totalSig.toLocaleString()} signals...`);
}

function t2HitBar2(i, c, t2Price, stopBar, horizon) {
  for (let j = i+1; j <= i+horizon && j < c.length; j++) {
    if (c[j].l <= 0) continue; // guard
    if (c[j].h >= t2Price && (j-(i+1)) < stopBar) return true;
  }
  return false;
}
function t3HitBar2(i, c, t3Price, stopBar, horizon) {
  for (let j = i+1; j <= i+horizon && j < c.length; j++) {
    if (c[j].h >= t3Price && (j-(i+1)) < stopBar) return true;
  }
  return false;
}

process.stdout.write(`\r  Processed ${processed} files, ${totalSig.toLocaleString()} signals...\n\n`);

// ── Report ────────────────────────────────────────────────────────────────────
const BAND_LABELS = { lt1: 'ATR<1%', b1to2: 'ATR 1–2%', b2to3: 'ATR 2–3%', gt3: 'ATR>3%' };

// Build ranked table
const rows = METHODS.map(m => {
  const s = stats[m.key];
  if (s.signals < 1000) return null;
  const winRate   = s.hitT1 / s.signals * 100;
  const sweepRate = s.swept / s.signals * 100;
  const t2Rate    = s.hitT2 / s.signals * 100;
  const t3Rate    = s.hitT3 / s.signals * 100;
  const ev        = s.totalEV / s.signals;
  const avgStop   = s.totalStopPct / s.signals;
  const avgRR     = s.validRR > 0 ? s.totalRR / s.validRR : 0;
  return { key: m.key, label: m.label, type: m.type, signals: s.signals,
           winRate, sweepRate, t2Rate, t3Rate, ev, avgStop, avgRR,
           bands: s.bands };
}).filter(Boolean);

// Sort by EV descending (the real objective)
rows.sort((a,b) => b.ev - a.ev);

const ts = new Date().toISOString().slice(0,16).replace('T','T').replace(':','-');

// ── Console report ────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log('  STOP LOSS OPTIMISATION BACKTEST REPORT');
console.log(`  ${processed} files · ${totalSig.toLocaleString()} signals · ${METHODS.length} methods · 20-bar horizon`);
console.log('═══════════════════════════════════════════════════════════════════════════════');
console.log();

const hdr = 'Method                         | Signals  | WinRate  | SweepRate| T2Hit    | T3Hit    | EV%/tr   | AvgStop% | R:R@T2';
console.log(hdr);
console.log('─'.repeat(hdr.length));

for (const r of rows.slice(0, 40)) {
  const line = [
    r.label.padEnd(31),
    String(r.signals).padStart(8),
    (r.winRate.toFixed(1)+'%').padStart(8),
    (r.sweepRate.toFixed(1)+'%').padStart(8),
    (r.t2Rate.toFixed(1)+'%').padStart(8),
    (r.t3Rate.toFixed(1)+'%').padStart(8),
    (r.ev.toFixed(3)+'%').padStart(8),
    (r.avgStop.toFixed(2)+'%').padStart(8),
    r.avgRR.toFixed(2).padStart(7),
  ].join(' | ');
  console.log(line);
}

console.log();
console.log('── TOP 5 BY WIN RATE ──────────────────────────────────────────────────────────');
const byWR = [...rows].sort((a,b) => b.winRate - a.winRate).slice(0,5);
for (const r of byWR) {
  console.log(`  ${r.label.padEnd(35)} WR: ${r.winRate.toFixed(2)}%  EV: ${r.ev.toFixed(3)}%  Sweep: ${r.sweepRate.toFixed(1)}%`);
}

console.log();
console.log('── TOP 5 BY EV ────────────────────────────────────────────────────────────────');
for (const r of rows.slice(0,5)) {
  console.log(`  ${r.label.padEnd(35)} EV: ${r.ev.toFixed(3)}%  WR: ${r.winRate.toFixed(2)}%  AvgStop: ${r.avgStop.toFixed(2)}%`);
}

console.log();
console.log('── SWEEP SURVIVORS (methods where >10% of stops were false sweeps) ───────────');
const sweepSurvivors = [...rows].filter(r => r.sweepRate > 10).sort((a,b) => b.sweepRate - a.sweepRate).slice(0,10);
for (const r of sweepSurvivors) {
  console.log(`  ${r.label.padEnd(35)} Sweep: ${r.sweepRate.toFixed(2)}%  WR: ${r.winRate.toFixed(2)}%`);
}

console.log();
console.log('── PER ATR-BAND BREAKDOWN (top method in each band) ───────────────────────────');
for (const [bandKey, bandLabel] of Object.entries(BAND_LABELS)) {
  const bandRows = rows.map(r => {
    const b = r.bands[bandKey];
    if (!b || b.signals < 100) return null;
    const bWR = b.hitT1 / b.signals * 100;
    const bEV = b.totalEV / b.signals;
    return { ...r, bWR, bEV, bSig: b.signals };
  }).filter(Boolean).sort((a,b) => b.bEV - a.bEV);

  if (bandRows.length === 0) continue;
  const best = bandRows[0];
  const worst = bandRows[bandRows.length - 1];
  console.log(`  ${bandLabel.padEnd(12)}: BEST  → ${best.label.padEnd(30)} EV: ${best.bEV.toFixed(3)}% WR: ${best.bWR.toFixed(1)}%`);
  console.log(`  ${' '.repeat(12)}  WORST → ${worst.label.padEnd(30)} EV: ${worst.bEV.toFixed(3)}% WR: ${worst.bWR.toFixed(1)}%`);
}

console.log();
console.log('── KEY INSIGHT ─────────────────────────────────────────────────────────────────');
const top = rows[0];
const topWR = [...rows].sort((a,b) => b.winRate - a.winRate)[0];
console.log(`  Best EV method   : ${top.label} — EV ${top.ev.toFixed(3)}%/trade, WR ${top.winRate.toFixed(1)}%, AvgStop ${top.avgStop.toFixed(2)}%`);
console.log(`  Best WR method   : ${topWR.label} — WR ${topWR.winRate.toFixed(1)}%, EV ${topWR.ev.toFixed(3)}%`);
console.log(`  Total signals    : ${totalSig.toLocaleString()}`);
console.log(`  Files processed  : ${processed}`);

// ── Save JSON ─────────────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  config: { horizon: HORIZON, targets: { t1: '1.5×ATR', t2: '3×ATR', t3: '5×ATR' }, exits: { t1: '50%', t2: '30%', t3: '20%' } },
  totals: { processed, totalSignals: totalSig, methods: METHODS.length },
  rankedByEV: rows.map(r => ({
    key: r.key, label: r.label, type: r.type,
    signals: r.signals, winRate: +r.winRate.toFixed(3), sweepRate: +r.sweepRate.toFixed(3),
    t2HitRate: +r.t2Rate.toFixed(3), t3HitRate: +r.t3Rate.toFixed(3),
    ev: +r.ev.toFixed(4), avgStopPct: +r.avgStop.toFixed(3), rrAtT2: +r.avgRR.toFixed(3),
  })),
  rankedByWinRate: [...rows].sort((a,b) => b.winRate - a.winRate).slice(0,20).map(r => ({
    key: r.key, label: r.label, winRate: +r.winRate.toFixed(3), ev: +r.ev.toFixed(4),
  })),
  bandAnalysis: Object.fromEntries(Object.entries(BAND_LABELS).map(([k, label]) => {
    const bandRows = rows.map(r => {
      const b = r.bands[k];
      if (!b || b.signals < 50) return null;
      return { key: r.key, label: r.label, signals: b.signals,
               winRate: +(b.hitT1/b.signals*100).toFixed(3), ev: +(b.totalEV/b.signals).toFixed(4) };
    }).filter(Boolean).sort((a,b) => b.ev - a.ev);
    return [k, { label, topMethods: bandRows.slice(0,5) }];
  })),
};

const outFile = path.join(OUT_DIR, `stop_loss_optimiser_${ts}.json`);
const txtFile = path.join(OUT_DIR, `stop_loss_optimiser_${ts}.txt`);

fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

// Save readable txt
let txt = `STOP LOSS OPTIMISER — ${new Date().toISOString()}\n`;
txt += `Files: ${processed} | Signals: ${totalSig.toLocaleString()} | Methods: ${METHODS.length}\n\n`;
txt += `RANKED BY EV (top 40):\n${hdr}\n${'─'.repeat(hdr.length)}\n`;
for (const r of rows.slice(0,40)) {
  txt += `${r.label.padEnd(31)} | ${String(r.signals).padStart(8)} | ${(r.winRate.toFixed(1)+'%').padStart(8)} | ${(r.sweepRate.toFixed(1)+'%').padStart(8)} | ${(r.t2Rate.toFixed(1)+'%').padStart(8)} | ${(r.t3Rate.toFixed(1)+'%').padStart(8)} | ${(r.ev.toFixed(3)+'%').padStart(8)} | ${(r.avgStop.toFixed(2)+'%').padStart(8)} | ${r.avgRR.toFixed(2).padStart(7)}\n`;
}
txt += `\nBEST EV  : ${top.label} — EV ${top.ev.toFixed(3)}% WR ${top.winRate.toFixed(1)}%\n`;
txt += `BEST WR  : ${topWR.label} — WR ${topWR.winRate.toFixed(1)}% EV ${topWR.ev.toFixed(3)}%\n`;
fs.writeFileSync(txtFile, txt);

console.log();
console.log(`  JSON: ${outFile}`);
console.log(`  TXT : ${txtFile}`);
console.log('═══════════════════════════════════════════════════════════════════════════════\n');
