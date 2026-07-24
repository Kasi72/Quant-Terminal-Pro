'use strict';
/**
 * comprehensive_performance_report.js
 * ====================================
 * Full performance audit across all 6 archetypes using per-archetype
 * production weights and the latest deep_extract JSON.
 *
 * Metrics: WR, SR, T1/T2/T3 escape, AvgPL, PF, Kelly, MaxDD, MaxConsecLoss,
 *          Sharpe proxy, MAE/MFE distributions, quarterly walk-forward.
 */

const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const RESULTS_DIR = path.join(__dirname, 'results');
const BARS_PER_YEAR = 252;

// Production weights per archetype (post Phase-2 + Phase-5 optimization)
const ARCH_WEIGHTS = {
  'ORS':             { W1:0.50, W2:0.05, W3:0.45 },
  'VolumeFootprint': { W1:0.60, W2:0.20, W3:0.20 },
  'CompressionCoil': { W1:0.65, W2:0.10, W3:0.25 },
  'MomentumPocket':  { W1:0.70, W2:0.10, W3:0.20 },
  'EMAStack':        { W1:0.55, W2:0.10, W3:0.35 },
  'CircuitBreaker':  { W1:0.65, W2:0.10, W3:0.25 },
};

const ARCH_NAMES = ['ORS','VolumeFootprint','CompressionCoil','MomentumPocket','EMAStack','CircuitBreaker'];
const ARCH_SHORT = { ORS:'ORS', VolumeFootprint:'VF', CompressionCoil:'CC',
                     MomentumPocket:'MP', EMAStack:'EMA', CircuitBreaker:'CB' };

// Quarter helper
function quarter(unixSec) {
  const d = new Date(unixSec * 1000);
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

// Percentile helper
function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return +(s[lo] + (s[hi] - s[lo]) * (idx - lo)).toFixed(2);
}

function std(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a,b) => a+b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a,b) => a + (b-m)**2, 0) / arr.length);
}

// ── Re-simulator (bit-field exact: stop wins on same bar) ─────────────────────
function resim(t, W1, W2, W3) {
  const maxJ = Math.min(t.mh, t.bt.length, t.cp.length);
  let phase = 1, wLeft = 1.0, wPL = 0;
  let t1Hit = false, t2Hit = false, t3Hit = false;

  for (let j = 0; j < maxJ; j++) {
    const bits = t.bt[j];
    const stopB = (bits & 1) !== 0;
    const t1b   = (bits & 2) !== 0;
    const t2b   = (bits & 4) !== 0;
    const t3b   = (bits & 8) !== 0;

    if (phase === 1) {
      if (stopB) { wPL -= wLeft * t.rp; return { wPL, t1Hit, t2Hit, t3Hit, bars: j+1 }; }
      if (t1b)   { wPL += W1 * t.p1; wLeft -= W1; t1Hit = true; phase = 2; }
    }
    if (phase === 2) {
      if (stopB) { wPL -= wLeft * t.rp; return { wPL, t1Hit, t2Hit, t3Hit, bars: j+1 }; }
      if (t2b)   { wPL += W2 * t.p2; wLeft -= W2; t2Hit = true; phase = 3; }
    }
    if (phase === 3) {
      if (stopB) { wPL -= wLeft * t.rp; return { wPL, t1Hit, t2Hit, t3Hit, bars: j+1 }; }
      if (t3b)   { wPL += W3 * t.p3; t3Hit = true; return { wPL, t1Hit, t2Hit, t3Hit, bars: j+1 }; }
    }

    // Time exit (last bar)
    if (j === maxJ - 1 && wLeft > 0) {
      wPL += wLeft * (t.cp[j] ?? 0);
      return { wPL, t1Hit, t2Hit, t3Hit, bars: j+1 };
    }
  }
  return { wPL, t1Hit, t2Hit, t3Hit, bars: maxJ };
}

// ── Load latest extract ───────────────────────────────────────────────────────
function loadLatest() {
  const files = fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith('deep_extract_') && f.endsWith('.json'))
    .sort().reverse();
  if (!files.length) { console.error('No deep_extract found'); process.exit(1); }
  const fp = path.join(RESULTS_DIR, files[0]);
  console.log(`\n  Loading: ${files[0]}  (${(fs.statSync(fp).size / 1e6).toFixed(1)} MB)\n`);
  return { data: JSON.parse(fs.readFileSync(fp, 'utf8')), stamp: files[0].replace('deep_extract_','').replace('.json','') };
}

// ── Main ──────────────────────────────────────────────────────────────────────
const { data, stamp } = loadLatest();

// Group trades by archetype index (ai) and OOS flag
const byArch = {};
for (const arch of ARCH_NAMES) byArch[arch] = { is: [], oos: [] };

for (const t of data.trades) {
  const arch = ARCH_NAMES[t.ai];
  if (!arch) continue;
  if (t.o) byArch[arch].oos.push(t);
  else      byArch[arch].is.push(t);
}

// ── OOS start date (for annualization) ───────────────────────────────────────
const OOS_DATE = new Date('2024-01-01');
const today    = new Date();
const oosYears = (today - OOS_DATE) / (365.25 * 86400 * 1000);

// ── Compute metrics for one set of trades ────────────────────────────────────
function computeMetrics(trades, W1, W2, W3) {
  if (!trades.length) return null;

  const pls  = [];
  const wins = [], losses = [];
  let nT1 = 0, nT2 = 0, nT3 = 0, nStop = 0;
  const maes = [], mfes = [], bars = [];
  const byQ  = {};   // quarter → [wPL, ...]

  for (const t of trades) {
    const r = resim(t, W1, W2, W3);
    pls.push(r.wPL);
    if (r.wPL > 0) wins.push(r.wPL); else losses.push(r.wPL);
    if (r.t1Hit) nT1++;
    if (r.t2Hit) nT2++;
    if (r.t3Hit) nT3++;
    const lastBit = t.bt.slice(0, Math.min(t.mh, t.bt.length)).reduce((a,b,j)=>
      (b&1)&&!a.stop ? { stop: true, j } : a, { stop: false, j: -1 });
    if (!r.t1Hit && !r.t2Hit && !r.t3Hit && r.wPL < 0) nStop++;

    const maeVal = t.ma[Math.min(r.bars-1, t.ma.length-1)] ?? 0;
    const mfeVal = t.mf[Math.min(r.bars-1, t.mf.length-1)] ?? 0;
    maes.push(maeVal);
    mfes.push(mfeVal);
    bars.push(r.bars);

    const q = quarter(t.di);
    if (!byQ[q]) byQ[q] = [];
    byQ[q].push(r.wPL);
  }

  const n      = pls.length;
  const avgPL  = pls.reduce((a,b)=>a+b,0) / n;
  const wr     = wins.length / n * 100;
  const sr     = nStop / n * 100;

  const sumWin = wins.reduce((a,b)=>a+b,0);
  const sumLoss= losses.reduce((a,b)=>a+b,0);
  const pf     = sumLoss === 0 ? Infinity : Math.abs(sumWin / sumLoss);

  const avgWin  = wins.length  ? wins.reduce((a,b)=>a+b,0)  / wins.length  : 0;
  const avgLoss = losses.length? losses.reduce((a,b)=>a+b,0)/ losses.length : 0;

  const rratio  = avgLoss !== 0 ? -avgWin / avgLoss : 0;
  const riskPcts = trades.map(t => t.rp);
  const avgRisk  = riskPcts.reduce((a,b)=>a+b,0) / riskPcts.length;
  const avgR     = avgPL / avgRisk;

  // Kelly
  const pw = wr / 100;
  const pl = 1 - pw;
  const kelly = (pw * rratio - pl) / rratio * 100;

  // Max drawdown (sequential equity curve)
  let peak = 0, equity = 0, maxDD = 0;
  for (const p of pls) {
    equity += p;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  // Max consecutive losses
  let curLoss = 0, maxLoss = 0;
  for (const p of pls) {
    if (p < 0) { curLoss++; maxLoss = Math.max(maxLoss, curLoss); }
    else curLoss = 0;
  }

  // Sharpe proxy (annualised)
  const sdPL  = std(pls);
  const tradesPerYear = n / oosYears;
  const sharpe = sdPL > 0 ? (avgPL / sdPL) * Math.sqrt(tradesPerYear) : 0;

  // Ulcer Index (sequence based, simple proxy)
  let uSum = 0; equity = 0; peak = 0;
  for (const p of pls) {
    equity += p; if (equity > peak) peak = equity;
    const dd = peak - equity;
    uSum += dd * dd;
  }
  const ulcer = Math.sqrt(uSum / n);

  // MAE / MFE at full hold
  const maeMax = trades.map(t => t.ma[Math.min(t.mh-1, t.ma.length-1)] ?? 0);
  const mfeMax = trades.map(t => t.mf[Math.min(t.mh-1, t.mf.length-1)] ?? 0);

  // Quarterly
  const qKeys = Object.keys(byQ).sort();
  const quarterly = qKeys.map(q => {
    const arr = byQ[q];
    const qAvg = arr.reduce((a,b)=>a+b,0)/arr.length;
    const qWR  = arr.filter(x=>x>0).length/arr.length*100;
    return { q, n: arr.length, wr: qWR, avgPL: qAvg };
  });

  // T1 escape rate for non-BE trades
  const escT1 = nT1 / n * 100;
  const escT2 = nT1 > 0 ? nT2 / nT1 * 100 : 0;
  const escT3 = nT2 > 0 ? nT3 / nT2 * 100 : 0;

  const avgHold = bars.reduce((a,b)=>a+b,0)/bars.length;

  return {
    n, wr, sr, escT1, escT2, escT3,
    avgPL, avgWin, avgLoss, rratio, pf, avgR, kelly, sharpe, ulcer,
    maxDD, maxLoss,
    mae: { p25:pct(maeMax,25), p50:pct(maeMax,50), p75:pct(maeMax,75), p90:pct(maeMax,90) },
    mfe: { p25:pct(mfeMax,25), p50:pct(mfeMax,50), p75:pct(mfeMax,75), p90:pct(mfeMax,90) },
    avgHold, quarterly,
    sumWin, sumLoss,
  };
}

// ── Print helpers ─────────────────────────────────────────────────────────────
function fmt(n, dp=2, w=7) { return (n == null ? 'N/A' : n.toFixed(dp)).padStart(w); }
function fmtPct(n, w=7)    { return (n == null ? 'N/A' : n.toFixed(1)+'%').padStart(w); }
function bar(n, max, len=20) {
  const filled = Math.round(n/max*len);
  return '█'.repeat(Math.min(filled,len)) + '░'.repeat(Math.max(0,len-filled));
}
const SEP = '═'.repeat(120);
const sep = '─'.repeat(120);

// ── Results ───────────────────────────────────────────────────────────────────
console.log('\n' + SEP);
console.log('  COMPREHENSIVE PERFORMANCE REPORT — All 6 Archetypes (Post-Optimization)');
console.log(`  Engine: stockEngine.js  |  Data: 1617 NIFTY symbols  |  OOS: 2024-01-01+  |  Stamp: ${stamp}`);
console.log(SEP);

const results = {};
for (const arch of ARCH_NAMES) {
  const { W1, W2, W3 } = ARCH_WEIGHTS[arch];
  const oos = computeMetrics(byArch[arch].oos, W1, W2, W3);
  const is_ = computeMetrics(byArch[arch].is,  W1, W2, W3);
  results[arch] = { oos, is: is_ };
}

// ── SECTION 1: Master Summary Table ──────────────────────────────────────────
console.log('\n  ① MASTER SUMMARY — OOS Performance (per-archetype production weights)\n');
console.log('  ' + ['Archetype'.padEnd(16), 'N'.padStart(7), 'WR%'.padStart(7), 'SR%'.padStart(7),
  'escT1%'.padStart(7), 'escT2%'.padStart(7), 'escT3%'.padStart(7),
  'AvgPL%'.padStart(8), 'PF'.padStart(6), 'AvgR'.padStart(6),
  'Kelly%'.padStart(7), 'Sharpe'.padStart(7), 'Hold(d)'.padStart(8)].join(' '));
console.log('  ' + sep.slice(0,118));

for (const arch of ARCH_NAMES) {
  const m = results[arch].oos;
  if (!m) { console.log(`  ${(ARCH_SHORT[arch]).padEnd(16)}  no OOS trades`); continue; }
  const line = [
    ARCH_SHORT[arch].padEnd(16),
    String(m.n).padStart(7),
    fmtPct(m.wr),
    fmtPct(m.sr),
    fmtPct(m.escT1),
    fmtPct(m.escT2),
    fmtPct(m.escT3),
    fmt(m.avgPL,2,8),
    fmt(m.pf,2,6),
    fmt(m.avgR,2,6),
    fmtPct(m.kelly),
    fmt(m.sharpe,2,7),
    fmt(m.avgHold/5,1,8),  // bars→trading days (NIFTY ~5 bars/week)
  ];
  console.log('  ' + line.join(' '));
}

// ── SECTION 2: Win/Loss Profile ───────────────────────────────────────────────
console.log('\n\n  ② WIN / LOSS PROFILE — OOS\n');
console.log('  ' + ['Archetype'.padEnd(16), 'AvgWin%'.padStart(9), 'AvgLoss%'.padStart(10),
  'W/L Ratio'.padStart(10), 'MaxDD%'.padStart(8), 'MaxConsecL'.padStart(11),
  'Ulcer'.padStart(7), 'SumWin%'.padStart(9), 'SumLoss%'.padStart(10)].join(' '));
console.log('  ' + sep.slice(0,118));

for (const arch of ARCH_NAMES) {
  const m = results[arch].oos;
  if (!m) continue;
  console.log('  ' + [
    ARCH_SHORT[arch].padEnd(16),
    fmt(m.avgWin,2,9),
    fmt(m.avgLoss,2,10),
    fmt(m.rratio,2,10),
    fmt(m.maxDD,2,8),
    String(m.maxLoss).padStart(11),
    fmt(m.ulcer,2,7),
    fmt(m.sumWin,1,9),
    fmt(m.sumLoss,1,10),
  ].join(' '));
}

// ── SECTION 3: MAE / MFE Distributions ───────────────────────────────────────
console.log('\n\n  ③ MAE / MFE DISTRIBUTIONS — OOS (full-hold max)\n');
console.log('  ' + ['Archetype'.padEnd(16),
  'MAEp25'.padStart(7), 'MAEp50'.padStart(7), 'MAEp75'.padStart(7), 'MAEp90'.padStart(7),
  '|',
  'MFEp25'.padStart(7), 'MFEp50'.padStart(7), 'MFEp75'.padStart(7), 'MFEp90'.padStart(7)].join(' '));
console.log('  ' + sep.slice(0,118));

for (const arch of ARCH_NAMES) {
  const m = results[arch].oos;
  if (!m) continue;
  console.log('  ' + [
    ARCH_SHORT[arch].padEnd(16),
    fmt(m.mae.p25,1,7), fmt(m.mae.p50,1,7), fmt(m.mae.p75,1,7), fmt(m.mae.p90,1,7),
    '|',
    fmt(m.mfe.p25,1,7), fmt(m.mfe.p50,1,7), fmt(m.mfe.p75,1,7), fmt(m.mfe.p90,1,7),
  ].join(' '));
}

// ── SECTION 4: IS vs OOS Comparison ──────────────────────────────────────────
console.log('\n\n  ④ IN-SAMPLE vs OUT-OF-SAMPLE (WR / PF / AvgPL)\n');
console.log('  ' + ['Archetype'.padEnd(16),
  'IS-n'.padStart(7), 'IS-WR%'.padStart(8), 'IS-PF'.padStart(7), 'IS-AvgPL'.padStart(10),
  '|',
  'OOS-n'.padStart(7), 'OOS-WR%'.padStart(8), 'OOS-PF'.padStart(7), 'OOS-AvgPL'.padStart(10),
  'Decay?'.padStart(8)].join(' '));
console.log('  ' + sep.slice(0,118));

for (const arch of ARCH_NAMES) {
  const o = results[arch].oos;
  const s = results[arch].is;
  if (!o || !s) continue;
  const decay = (o.pf - s.pf) < -0.30 ? '⚠ YES' : 'OK   ';
  console.log('  ' + [
    ARCH_SHORT[arch].padEnd(16),
    String(s.n).padStart(7),
    fmtPct(s.wr,8), fmt(s.pf,2,7), fmt(s.avgPL,2,10),
    '|',
    String(o.n).padStart(7),
    fmtPct(o.wr,8), fmt(o.pf,2,7), fmt(o.avgPL,2,10),
    decay.padStart(8),
  ].join(' '));
}

// ── SECTION 5: Quarterly Walk-Forward ────────────────────────────────────────
console.log('\n\n  ⑤ QUARTERLY WALK-FORWARD — OOS\n');

// Collect all quarters
const allQ = new Set();
for (const arch of ARCH_NAMES) {
  const m = results[arch].oos;
  if (m) m.quarterly.forEach(q => allQ.add(q.q));
}
const qList = [...allQ].sort().filter(q => q >= '2024-Q1');

const header = ['Quarter'.padEnd(9), ...ARCH_NAMES.map(a => ARCH_SHORT[a].padStart(9))].join(' ');
console.log('  WR%:');
console.log('  ' + header);
console.log('  ' + sep.slice(0, 9 + ARCH_NAMES.length * 10 + 5));
for (const q of qList) {
  const row = [q.padEnd(9)];
  for (const arch of ARCH_NAMES) {
    const m = results[arch].oos;
    const qm = m && m.quarterly.find(x => x.q === q);
    row.push(qm ? fmtPct(qm.wr, 9) : '      N/A');
  }
  console.log('  ' + row.join(' '));
}

console.log('\n  AvgPL%:');
console.log('  ' + header);
console.log('  ' + sep.slice(0, 9 + ARCH_NAMES.length * 10 + 5));
for (const q of qList) {
  const row = [q.padEnd(9)];
  for (const arch of ARCH_NAMES) {
    const m = results[arch].oos;
    const qm = m && m.quarterly.find(x => x.q === q);
    row.push(qm ? fmt(qm.avgPL, 2, 9) : '      N/A');
  }
  console.log('  ' + row.join(' '));
}

// ── SECTION 6: MFE vs Target Distance Analysis ────────────────────────────────
console.log('\n\n  ⑥ TARGET REACHABILITY (OOS)\n');
console.log('  How well does T1/T2/T3 placement align with actual MFE distribution?\n');
for (const arch of ARCH_NAMES) {
  const trades = byArch[arch].oos;
  if (!trades.length) continue;
  const { W1, W2, W3 } = ARCH_WEIGHTS[arch];

  const t1pcts = trades.map(t => t.p1).filter(Boolean);
  const t2pcts = trades.map(t => t.p2).filter(Boolean);
  const t3pcts = trades.map(t => t.p3).filter(Boolean);
  const mfes   = trades.map(t => t.mf[Math.min(t.mh-1, t.mf.length-1)] ?? 0);

  if (!t1pcts.length) continue;
  const avgT1 = t1pcts.reduce((a,b)=>a+b,0)/t1pcts.length;
  const avgT2 = t2pcts.reduce((a,b)=>a+b,0)/t2pcts.length;
  const avgT3 = t3pcts.reduce((a,b)=>a+b,0)/t3pcts.length;
  const mfeP50 = pct(mfes, 50);
  const mfeP75 = pct(mfes, 75);

  const escT1 = trades.filter(t=>t.bt.some(b=>(b&2)!==0)).length / trades.length * 100;

  console.log(`  ${ARCH_SHORT[arch].padEnd(6)} AvgT1=${avgT1.toFixed(1)}%  AvgT2=${avgT2.toFixed(1)}%  AvgT3=${avgT3.toFixed(1)}%  MFEp50=${mfeP50}%  MFEp75=${mfeP75}%  escT1=${escT1.toFixed(1)}%  W1=${W1} W2=${W2} W3=${W3}`);
}

// ── SECTION 7: Key Insights ───────────────────────────────────────────────────
console.log('\n\n  ⑦ KEY INSIGHTS\n');

const ranked = ARCH_NAMES
  .map(a => ({ arch:a, m:results[a].oos }))
  .filter(x => x.m)
  .sort((a,b) => (b.m.pf*b.m.wr/100) - (a.m.pf*a.m.wr/100));

console.log('  Ranked by Score (PF × WR):');
let rank = 1;
for (const { arch, m } of ranked) {
  const score = (m.pf * m.wr / 100).toFixed(3);
  console.log(`  ${rank++}. ${ARCH_SHORT[arch]} — PF=${m.pf.toFixed(2)}, WR=${m.wr.toFixed(1)}%, Score=${score}, Kelly=${m.kelly.toFixed(1)}%, Sharpe=${m.sharpe.toFixed(2)}`);
}

// ── Save JSON report ──────────────────────────────────────────────────────────
const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
const outFile = path.join(RESULTS_DIR, `perf_report_${ts}.json`);
fs.writeFileSync(outFile, JSON.stringify({ stamp, results }, null, 2));
console.log(`\n  Saved → ${outFile}`);
console.log('\n' + SEP + '\n');
