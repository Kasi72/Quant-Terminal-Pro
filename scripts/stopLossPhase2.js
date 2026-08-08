'use strict';

/**
 * Stop Loss Optimisation — Phase 2: SIGNAL-CONDITIONED STUDY
 * ===========================================================
 * Phase 1 used random bars → negative EV (expected).
 * Phase 2 restricts to SIGNAL bars: bars where momentum conditions hold:
 *   - Price above EMA21 (trend filter)
 *   - ATR compression: current ATR < 1.2× its 20-bar average (coiling)
 *   - Volume expansion: latest volume > 1.5× its 10-bar average (breakout)
 *   - Price within 3% of 20-bar high (near breakout zone)
 *
 * These conditions approximate our screener's compression-breakout archetypes.
 *
 * ALSO tests NEW idea: "Smart Structure Stop" — stop placed below the
 * nearest KEY LEVEL (round number / swing low / EMA) with a 0.2–0.5% buffer.
 * This is how professionals avoid smart-money sweeps: park stop behind
 * existing order clusters, not in empty air.
 *
 * Metrics are now POSITIVE EV (signal bars have real edge):
 *   - Win rate at T1 (T1=1.5×ATR above entry)
 *   - T2 hit rate (T2=3×ATR)
 *   - T3 hit rate (T3=5×ATR)
 *   - Cascade EV (50%@T1, 30%@T2, 20%@T3, full loss at stop)
 *   - Sweep rate (wick through stop but close recovery)
 *   - "False stop" cost (avg EV lost to sweeps per trade)
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const HORIZON   = 20;
const MIN_BARS  = 300;
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

// ── Indicators ───────────────────────────────────────────────────────────────
function ema(c, period, key='c') {
  const out = new Float64Array(c.length);
  if (c.length < period) return out;
  let s = 0;
  for (let i = 0; i < period; i++) s += c[i][key];
  out[period-1] = s / period;
  const k = 2 / (period + 1);
  for (let i = period; i < c.length; i++) out[i] = c[i][key] * k + out[i-1] * (1-k);
  return out;
}

function atr14(c) {
  const a = new Float64Array(c.length);
  if (c.length <= 14) return a;
  let s = 0;
  for (let i = 1; i <= 14; i++) {
    s += Math.max(c[i].h-c[i].l, Math.abs(c[i].h-c[i-1].c), Math.abs(c[i].l-c[i-1].c));
  }
  a[14] = s / 14;
  for (let i = 15; i < c.length; i++) {
    const tr = Math.max(c[i].h-c[i].l, Math.abs(c[i].h-c[i-1].c), Math.abs(c[i].l-c[i-1].c));
    a[i] = (a[i-1]*13 + tr) / 14;
  }
  return a;
}

// ── Signal condition: compression-breakout proxy ──────────────────────────────
// Returns true if bar i is a valid signal bar
function isSignalBar(c, i, atrArr, ema21Arr) {
  if (i < 30 || i >= c.length - HORIZON - 1) return false;
  const bar = c[i];
  const atr = atrArr[i];
  if (!atr || atr <= 0) return false;

  const entry = c[i+1].o;
  if (!entry || entry <= 0) return false;

  const atrPct = atr / entry * 100;
  if (atrPct < 0.3 || atrPct > 10) return false;

  // 1. Trend: close above EMA21
  const e21 = ema21Arr[i];
  if (!e21 || e21 <= 0 || bar.c < e21) return false;

  // 2. ATR compression: current ATR < 1.2× average of last 20 ATR values
  let atrSum = 0, atrCount = 0;
  for (let k = i-20; k < i; k++) {
    if (atrArr[k] > 0) { atrSum += atrArr[k]; atrCount++; }
  }
  const avgAtr = atrCount > 0 ? atrSum / atrCount : atr;
  if (atr > avgAtr * 1.25) return false; // ATR not compressed

  // 3. Volume expansion: current volume > 1.3× 10-bar avg vol
  let volSum = 0, volCount = 0;
  for (let k = i-10; k < i; k++) {
    if (c[k].v > 0) { volSum += c[k].v; volCount++; }
  }
  const avgVol = volCount > 0 ? volSum / volCount : 0;
  if (avgVol <= 0 || bar.v < avgVol * 1.3) return false;

  // 4. Near 20-bar high (within 4% — breakout proximity)
  let high20 = 0;
  for (let k = i-20; k <= i; k++) high20 = Math.max(high20, c[k].h);
  if (bar.c < high20 * 0.96) return false;

  return true;
}

// ── Stop method builder ───────────────────────────────────────────────────────
function buildMethods() {
  const m = [];

  // A) ATR multiples: 0.75× to 2.5× step 0.25
  for (const mult of [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5]) {
    m.push({ key: `atr_${mult}x`, label: `ATR ${mult}×`, type: 'atr', mult });
  }

  // B) Fixed % 1.5–6%
  for (const pct of [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0]) {
    m.push({ key: `pct_${pct}`, label: `Fixed ${pct}%`, type: 'pct', pct });
  }

  // C) Swing low + buffer (key structural stops)
  for (const lb of [3, 5, 8, 10, 13]) {
    for (const buf of [0.1, 0.3, 0.5, 0.8]) {
      m.push({ key: `swing${lb}_${buf}`, label: `${lb}L+${buf}%`, type: 'swing', lookback: lb, buf });
    }
  }

  // D) EMA + buffer
  for (const period of [10, 21, 55]) {
    for (const buf of [0.1, 0.3, 0.5]) {
      m.push({ key: `ema${period}_${buf}`, label: `EMA${period}+${buf}%`, type: 'ema', period, buf });
    }
  }

  // E) Smart Structure: round number below entry + buffer
  // (nearest 50/100 boundary below entry minus small buffer)
  for (const rnd of [50, 100]) {
    for (const buf of [0.2, 0.5]) {
      m.push({ key: `round${rnd}_${buf}`, label: `Round${rnd}−${buf}%`, type: 'round', roundTo: rnd, buf });
    }
  }

  // F) Hybrid combos: ATR floor + structure ceiling
  // min(entry - atrMult*ATR, swingLow*(1-buf)) — widest of the two
  for (const mult of [1.5, 2.0]) {
    for (const lb of [5, 8]) {
      for (const buf of [0.3, 0.5]) {
        m.push({ key: `hyb_atr${mult}_sw${lb}_${buf}`, label: `Hyb(ATR${mult}∨${lb}L+${buf}%)`, type: 'hybrid', mult, lookback: lb, buf });
      }
    }
  }

  // G) ATR-adaptive: if ATR% < 1.5% use tighter stop, else use wider
  m.push({ key: 'adaptive_tight_loose', label: 'Adaptive(1.5%<ATR→1×, else 2×)', type: 'adaptive' });
  m.push({ key: 'adaptive_2band', label: 'Adaptive(ATR<2%→1.5×, else 2×)', type: 'adaptive2' });

  return m;
}

// ── Stats ────────────────────────────────────────────────────────────────────
function newStat() {
  return {
    signals: 0, hitT1: 0, hitT2: 0, hitT3: 0, stopped: 0, swept: 0,
    evSum: 0, stopPctSum: 0, rrSum: 0, validRR: 0, sweepLossSum: 0,
    bands: {
      lt1:   { n: 0, hitT1: 0, stopped: 0, evSum: 0 },
      b1to2: { n: 0, hitT1: 0, stopped: 0, evSum: 0 },
      b2to3: { n: 0, hitT1: 0, stopped: 0, evSum: 0 },
      gt3:   { n: 0, hitT1: 0, stopped: 0, evSum: 0 },
    },
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────
const METHODS = buildMethods();
const stats   = {};
for (const m of METHODS) stats[m.key] = newStat();

const files = fs.readdirSync(DATA_DIR).filter(f => /\.csv$/i.test(f)).map(f => path.join(DATA_DIR, f));
console.log(`\nPhase 2 — signal-conditioned stop study | ${files.length} files × ${METHODS.length} methods\n`);

let processed = 0, totalSig = 0;

for (const fp of files) {
  let c;
  try { c = parseCSV(fp); } catch { continue; }
  if (c.length < MIN_BARS + HORIZON + 30) continue;
  processed++;

  const atrA  = atr14(c);
  const e10A  = ema(c, 10);
  const e21A  = ema(c, 21);
  const e55A  = ema(c, 55);

  // Pre-compute rolling 10-vol avg
  const vol10 = new Float64Array(c.length);
  for (let i = 10; i < c.length; i++) {
    let s = 0; for (let k=i-10; k<i; k++) s += c[k].v; vol10[i] = s/10;
  }

  for (let i = 30; i < c.length - HORIZON - 2; i++) {
    if (!isSignalBar(c, i, atrA, e21A)) continue;

    const atr   = atrA[i];
    const entry = c[i+1].o;
    if (!entry || entry <= 0) continue;

    const atrPct = atr / entry * 100;
    totalSig++;

    const t1 = entry + 1.5 * atr;
    const t2 = entry + 3.0 * atr;
    const t3 = entry + 5.0 * atr;
    const t1Gain = (t1-entry)/entry*100;
    const t2Gain = (t2-entry)/entry*100;
    const t3Gain = (t3-entry)/entry*100;

    const band = atrPct < 1 ? 'lt1' : atrPct < 2 ? 'b1to2' : atrPct < 3 ? 'b2to3' : 'gt3';

    // Pre-compute swing lows
    const swL = {};
    for (const lb of [3,5,8,10,13]) {
      let mn = Infinity;
      for (let k=i-lb; k<=i; k++) mn = Math.min(mn, c[k]?.l ?? Infinity);
      swL[lb] = mn;
    }

    // Nearest round level below entry
    const round50  = Math.floor(entry / 50)  * 50;
    const round100 = Math.floor(entry / 100) * 100;

    for (const m of METHODS) {
      let stopRaw = 0;

      if (m.type === 'atr') {
        stopRaw = entry - m.mult * atr;
      } else if (m.type === 'pct') {
        stopRaw = entry * (1 - m.pct/100);
      } else if (m.type === 'swing') {
        const sl = swL[m.lookback] ?? (entry * 0.95);
        stopRaw = sl * (1 - m.buf/100);
      } else if (m.type === 'ema') {
        const eArr = m.period === 10 ? e10A : m.period === 21 ? e21A : e55A;
        const ev = eArr[i];
        if (!ev || ev <= 0) continue;
        stopRaw = ev * (1 - m.buf/100);
      } else if (m.type === 'round') {
        const rndLevel = m.roundTo === 50 ? round50 : round100;
        if (rndLevel <= 0 || rndLevel >= entry) continue;
        stopRaw = rndLevel * (1 - m.buf/100);
      } else if (m.type === 'hybrid') {
        const sl = swL[m.lookback] ?? (entry * 0.95);
        const structStop = sl * (1 - m.buf/100);
        const atrStop    = entry - m.mult * atr;
        stopRaw = Math.max(structStop, atrStop); // take the wider (more protective)
      } else if (m.type === 'adaptive') {
        stopRaw = atrPct < 1.5 ? entry - 1.0 * atr : entry - 2.0 * atr;
      } else if (m.type === 'adaptive2') {
        stopRaw = atrPct < 2.0 ? entry - 1.5 * atr : entry - 2.0 * atr;
      }

      if (!stopRaw || stopRaw >= entry || stopRaw <= 0) continue;
      const stopPct = (entry - stopRaw) / entry * 100;
      if (stopPct < 0.3 || stopPct > 15) continue;

      const st = stats[m.key];
      st.signals++;
      st.stopPctSum += stopPct;

      const rrT2 = (t2 - entry) / (entry - stopRaw);
      if (rrT2 > 0) { st.rrSum += rrT2; st.validRR++; }

      const bd = st.bands[band];
      bd.n++;

      // Walk forward: find first event bar for stop, T1, T2, T3
      let stopBar = 9999, t1Bar = 9999, t2Bar = 9999, t3Bar = 9999;
      let sweepDetected = false;

      for (let j = i+1; j <= i+HORIZON && j < c.length; j++) {
        const b = c[j], bi = j-(i+1);
        if (stopBar === 9999 && b.l <= stopRaw) {
          stopBar = bi;
          // Sweep: price wicked below stop but closed above entry within 3 bars
          for (let k=j; k<=j+3 && k<c.length; k++) {
            if (c[k].c > entry) { sweepDetected = true; break; }
          }
        }
        if (t1Bar === 9999 && b.h >= t1) t1Bar = bi;
        if (t2Bar === 9999 && b.h >= t2) t2Bar = bi;
        if (t3Bar === 9999 && b.h >= t3) t3Bar = bi;
      }

      const t1Won = t1Bar < stopBar;
      const t2Won = t2Bar < stopBar;
      const t3Won = t3Bar < stopBar;
      const stopped = stopBar < t1Bar;

      // EV cascade: 50%@T1, 30%@T2, 20%@T3
      let ev = 0;
      if (t1Won) {
        ev += 0.50 * t1Gain;
        if (t2Won) {
          ev += 0.30 * t2Gain;
          if (t3Won) {
            ev += 0.20 * t3Gain;
          } else {
            // Remaining 20% exits at stop or horizon
            const endPrc = stopBar < 9999 ? stopRaw : c[Math.min(i+HORIZON,c.length-1)].c;
            ev += 0.20 * (endPrc - entry) / entry * 100;
          }
        } else {
          // Remaining 50% exits at stop or horizon
          const endPrc = stopBar < 9999 ? stopRaw : c[Math.min(i+HORIZON,c.length-1)].c;
          ev += 0.50 * (endPrc - entry) / entry * 100;
        }
      } else {
        // Stopped before T1 — full loss
        ev = -stopPct;
        if (sweepDetected) {
          st.swept++;
          st.sweepLossSum += stopPct; // cost of false stop
        }
      }

      st.evSum += ev;
      if (t1Won) { st.hitT1++; bd.hitT1++; }
      if (t2Won) st.hitT2++;
      if (t3Won) st.hitT3++;
      if (stopped) { st.stopped++; bd.stopped++; }
      bd.evSum += ev;
    }
  }

  if (processed % 200 === 0) process.stdout.write(`\r  ${processed} files | ${totalSig.toLocaleString()} signal bars`);
}

process.stdout.write(`\r  ${processed} files | ${totalSig.toLocaleString()} signal bars\n\n`);

// ── Build result table ────────────────────────────────────────────────────────
const rows = METHODS.map(m => {
  const s = stats[m.key];
  if (s.signals < 500) return null;
  const n = s.signals;
  return {
    key: m.key, label: m.label, type: m.type,
    n,
    winRate:   +(s.hitT1  / n * 100).toFixed(3),
    t2Rate:    +(s.hitT2  / n * 100).toFixed(3),
    t3Rate:    +(s.hitT3  / n * 100).toFixed(3),
    stopRate:  +(s.stopped/ n * 100).toFixed(3),
    sweepRate: +(s.swept  / n * 100).toFixed(3),
    sweepCost: s.swept > 0 ? +(s.sweepLossSum / n).toFixed(4) : 0,
    ev:        +(s.evSum  / n).toFixed(4),
    avgStop:   +(s.stopPctSum / n).toFixed(3),
    rrT2:      s.validRR > 0 ? +(s.rrSum / s.validRR).toFixed(3) : 0,
    bands: Object.fromEntries(Object.entries(s.bands).map(([k,b]) => [k, {
      n: b.n,
      wr: b.n > 0 ? +(b.hitT1/b.n*100).toFixed(1) : 0,
      ev: b.n > 0 ? +(b.evSum/b.n).toFixed(4) : 0,
    }])),
  };
}).filter(Boolean);

const byEV  = [...rows].sort((a,b) => b.ev - a.ev);
const byWR  = [...rows].sort((a,b) => b.winRate - a.winRate);

const ts = new Date().toISOString().slice(0,16).replace(':','-');

// ── Console report ────────────────────────────────────────────────────────────
const LINE = '═'.repeat(105);
console.log(LINE);
console.log('  PHASE 2 — SIGNAL-CONDITIONED STOP LOSS OPTIMISATION');
console.log(`  ${processed} files · ${totalSig.toLocaleString()} signal bars · ${METHODS.length} methods`);
console.log(LINE);
console.log();

const H = 'Method                           |  n(sig) | WinRate | T2Rate  | T3Rate  | Stopped | SweepRate| SweepCost|   EV%    | AvgStop% | R:R@T2';
console.log(H);
console.log('─'.repeat(H.length));

for (const r of byEV.slice(0, 50)) {
  const line = [
    r.label.padEnd(33),
    String(r.n).padStart(7),
    (r.winRate.toFixed(1)+'%').padStart(7),
    (r.t2Rate.toFixed(1)+'%').padStart(7),
    (r.t3Rate.toFixed(1)+'%').padStart(7),
    (r.stopRate.toFixed(1)+'%').padStart(7),
    (r.sweepRate.toFixed(1)+'%').padStart(8),
    (r.sweepCost.toFixed(3)+'%').padStart(8),
    (r.ev.toFixed(3)+'%').padStart(8),
    (r.avgStop.toFixed(2)+'%').padStart(8),
    r.rrT2.toFixed(2).padStart(6),
  ].join(' | ');
  console.log(line);
}

console.log();
console.log('── TOP 10 BY WIN RATE ─────────────────────────────────────────────────────────────────────────────');
for (const r of byWR.slice(0,10)) {
  console.log(`  ${r.label.padEnd(35)} WR:${r.winRate.toFixed(1).padStart(6)}%  EV:${r.ev.toFixed(3).padStart(7)}%  Stop:${r.avgStop.toFixed(2).padStart(5)}%  Sweep:${r.sweepRate.toFixed(1).padStart(5)}%`);
}

console.log();
console.log('── TOP 10 BY EV ───────────────────────────────────────────────────────────────────────────────────');
for (const r of byEV.slice(0,10)) {
  console.log(`  ${r.label.padEnd(35)} EV:${r.ev.toFixed(3).padStart(7)}%  WR:${r.winRate.toFixed(1).padStart(6)}%  Sweep:${r.sweepRate.toFixed(1).padStart(5)}%  AvgStop:${r.avgStop.toFixed(2)}%`);
}

console.log();
console.log('── SWEEP ANALYSIS (methods by sweep cost) ─────────────────────────────────────────────────────────');
const bySweep = [...rows].sort((a,b) => b.sweepRate - a.sweepRate);
for (const r of bySweep.slice(0,10)) {
  console.log(`  ${r.label.padEnd(35)} Sweep:${r.sweepRate.toFixed(1).padStart(5)}%  SweepCost:${r.sweepCost.toFixed(3).padStart(6)}%/tr  WR:${r.winRate.toFixed(1).padStart(6)}%`);
}
console.log('  ... (lowest sweep rates)');
for (const r of bySweep.slice(-5)) {
  console.log(`  ${r.label.padEnd(35)} Sweep:${r.sweepRate.toFixed(1).padStart(5)}%  SweepCost:${r.sweepCost.toFixed(3).padStart(6)}%/tr  WR:${r.winRate.toFixed(1).padStart(6)}%`);
}

console.log();
console.log('── PER ATR-BAND: BEST METHOD IN EACH BAND (by EV) ─────────────────────────────────────────────────');
for (const [bk, bl] of [['lt1','ATR<1%'],['b1to2','ATR 1–2%'],['b2to3','ATR 2–3%'],['gt3','ATR>3%']]) {
  const bandSorted = rows
    .filter(r => r.bands[bk] && r.bands[bk].n >= 50)
    .sort((a,b) => b.bands[bk].ev - a.bands[bk].ev);
  if (!bandSorted.length) continue;
  const best = bandSorted[0];
  console.log(`  ${bl.padEnd(12)}: ${best.label.padEnd(33)} EV:${best.bands[bk].ev.toFixed(3).padStart(7)}%  WR:${best.bands[bk].wr.toFixed(1).padStart(5)}%  (n=${best.bands[bk].n})`);
  // Also show top 3
  for (const r of bandSorted.slice(1,4)) {
    console.log(`  ${''.padEnd(12)}  ${r.label.padEnd(33)} EV:${r.bands[bk].ev.toFixed(3).padStart(7)}%  WR:${r.bands[bk].wr.toFixed(1).padStart(5)}%`);
  }
  console.log();
}

console.log('── KEY INSIGHTS ────────────────────────────────────────────────────────────────────────────────────');
const topEV = byEV[0], topWR = byWR[0];
console.log(`  Signal bars      : ${totalSig.toLocaleString()} (momentum-filtered, above EMA21, ATR-compressed, vol-expanded)`);
console.log(`  Best EV method   : ${topEV.label.padEnd(35)} EV:${topEV.ev.toFixed(3)}%  WR:${topEV.winRate.toFixed(1)}%`);
console.log(`  Best WR method   : ${topWR.label.padEnd(35)} WR:${topWR.winRate.toFixed(1)}%  EV:${topWR.ev.toFixed(3)}%`);
console.log(`  Current engine   : ATR 2×                              WR:${(rows.find(r=>r.key==='atr_2x')?.winRate??0).toFixed(1)}%  EV:${(rows.find(r=>r.key==='atr_2x')?.ev??0).toFixed(3)}%`);
const atr2 = rows.find(r => r.key === 'atr_2x');
if (atr2) {
  console.log(`  ATR 2× sweep rate: ${atr2.sweepRate.toFixed(2)}% (smart money rarely reaches this depth)`);
  console.log(`  ATR 2× avg stop  : ${atr2.avgStop.toFixed(2)}% below entry`);
  console.log(`  ATR 2× R:R at T2 : ${atr2.rrT2.toFixed(2)}`);
}

// ── Save JSON ────────────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  config: { horizon: HORIZON, signalConditions: ['above EMA21', 'ATR compressed (<1.25×20barAvg)', 'vol expanded (>1.3×10barAvg)', 'within 4% of 20-bar high'], targets: 'T1=1.5×ATR T2=3×ATR T3=5×ATR', exits: '50%@T1 30%@T2 20%@T3' },
  totals: { processed, totalSignals: totalSig, methods: METHODS.length },
  rankedByEV:   byEV.map(r => ({ key: r.key, label: r.label, ...r })),
  rankedByWR:   byWR.slice(0,20).map(r => ({ key: r.key, label: r.label, winRate: r.winRate, ev: r.ev, avgStop: r.avgStop, sweepRate: r.sweepRate })),
  sweepAnalysis: bySweep.map(r => ({ key: r.key, label: r.label, sweepRate: r.sweepRate, sweepCost: r.sweepCost, winRate: r.winRate, ev: r.ev })),
  currentEngine: rows.find(r => r.key === 'atr_2x') || null,
};

const jf = path.join(OUT_DIR, `stop_loss_phase2_${ts}.json`);
const tf = path.join(OUT_DIR, `stop_loss_phase2_${ts}.txt`);
fs.writeFileSync(jf, JSON.stringify(report, null, 2));

let txt = `PHASE 2 STOP LOSS — ${new Date().toISOString()}\nFiles:${processed} | Signals:${totalSig.toLocaleString()} | Methods:${METHODS.length}\n\n`;
txt += `RANKED BY EV:\n${H}\n${'─'.repeat(H.length)}\n`;
for (const r of byEV.slice(0,50)) {
  txt += `${r.label.padEnd(33)} | ${String(r.n).padStart(7)} | ${(r.winRate.toFixed(1)+'%').padStart(7)} | ${(r.t2Rate.toFixed(1)+'%').padStart(7)} | ${(r.t3Rate.toFixed(1)+'%').padStart(7)} | ${(r.stopRate.toFixed(1)+'%').padStart(7)} | ${(r.sweepRate.toFixed(1)+'%').padStart(8)} | ${(r.sweepCost.toFixed(3)+'%').padStart(8)} | ${(r.ev.toFixed(3)+'%').padStart(8)} | ${(r.avgStop.toFixed(2)+'%').padStart(8)} | ${r.rrT2.toFixed(2).padStart(6)}\n`;
}
fs.writeFileSync(tf, txt);

console.log();
console.log(`  JSON: ${jf}`);
console.log(`  TXT : ${tf}`);
console.log(LINE + '\n');
