'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// CMF + OBV HYPER-TUNER
// Sweeps Chaikin Money Flow (CMF) and OBV-slope thresholds as post-signal filters
// across all 5 archetypes to find the combination that maximises WR × PF.
//
// Approach:
//   1. Run all signals exactly as the engine fires them (baseline)
//   2. For each signal, compute CMF-20 and OBV-slope-10 at signal bar
//   3. Grid-sweep (cmfMin, obvMin) and score WR × PF at each combination
//   4. Report the Pareto-optimal thresholds per archetype
//   5. Print ready-to-paste condition updates for stockEngine.ts
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const ENGINE_DIR = path.join(__dirname, '_compiled_current');
const { analyzeStock } = require(path.join(ENGINE_DIR, 'stockEngine.js'));

const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];

const PS_LABEL = {
  optimized_deployable_20plus:    'VolumeFootprint',
  optimized_highprecision_15plus: 'CompressionCoil',
  optimized_elite_10plus:         'MomentumPocket',
  optimized_ultraselective_8plus: 'EMAStack',
  sniper_95plus:                  'PerfectStorm',
};

const DATA_DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV', fmt: 'nse'   },
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio',     fmt: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50',         fmt: 'nse'   },
];

const WINDOW  = 220;
const STEP    = 5;
const COOL    = 5;
const MAX_H   = 20;
const MIN_C   = WINDOW + MAX_H + 5;
const BUY     = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

// CMF sweep: -0.3 to +0.3 in steps of 0.05
const CMF_THRESHOLDS  = [-0.30, -0.25, -0.20, -0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
// OBV slope sweep: -2 to +2 in steps of 0.5
const OBV_THRESHOLDS  = [-2.0, -1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5, 2.0];

// ── indicators ────────────────────────────────────────────────────────────────
function computeCMF(candles, endIdx, period = 20) {
  const start = Math.max(0, endIdx - period + 1);
  let sumMFV = 0, sumVol = 0;
  for (let i = start; i <= endIdx; i++) {
    const { h, l, c, v } = candles[i];
    const range = h - l;
    if (range > 0 && v > 0) {
      sumMFV += ((c - l) - (h - c)) / range * v;
      sumVol += v;
    }
  }
  return sumVol > 0 ? sumMFV / sumVol : 0;
}

function computeOBVSlope(candles, endIdx, period = 10) {
  const start = Math.max(1, endIdx - period);
  const len = endIdx - start;
  if (len < 3) return 0;
  let obv = 0;
  const obvVals = [], vols = [];
  for (let i = start; i <= endIdx; i++) {
    if (candles[i].c > candles[i-1].c) obv += candles[i].v;
    else if (candles[i].c < candles[i-1].c) obv -= candles[i].v;
    obvVals.push(obv);
    vols.push(candles[i].v);
  }
  const n = obvVals.length;
  const meanVol = vols.reduce((a,b) => a+b, 0) / n || 1;
  let sx=0, sy=0, sxy=0, sx2=0;
  for (let i = 0; i < n; i++) { sx+=i; sy+=obvVals[i]; sxy+=i*obvVals[i]; sx2+=i*i; }
  const denom = n*sx2 - sx*sx;
  return Math.abs(denom) < 1e-10 ? 0 : ((n*sxy - sx*sy) / denom) / meanVol;
}

// ── parsers ───────────────────────────────────────────────────────────────────
function parseNSE(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6) continue;
    const c = +p[4]; if (!c || c <= 0) continue;
    out.push({ ts: Date.parse(p[0]) || i*86400000, o:+p[1], h:+p[2], l:+p[3], c, v:+p[5]||0 });
  }
  return out;
}
function parseYahoo(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const off = lines[0].toLowerCase().startsWith('symbol') ? 1 : 0;
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 5+off) continue;
    const c = +p[4+off]; if (!c || c <= 0) continue;
    out.push({ ts: Date.parse(p[off])||i*86400000, o:+p[1+off], h:+p[2+off], l:+p[3+off], c, v:+p[5+off]||0 });
  }
  return out;
}

// ── trade sim ─────────────────────────────────────────────────────────────────
function simulate(candles, sigIdx, stop) {
  const eIdx = sigIdx + 1;
  if (eIdx >= candles.length - 1) return null;
  const ep = candles[eIdx].o;
  if (!ep || ep <= 0) return null;
  const t1=ep*1.05, t2=ep*1.07, t3=ep*1.10;
  let rem=1, pnl=0, mae=0, mfe=0;
  for (let b = 1; b <= MAX_H; b++) {
    const idx = eIdx + b;
    if (idx >= candles.length) { pnl += rem*(candles[candles.length-1].c-ep)/ep*100; rem=0; break; }
    const bar = candles[idx];
    mae = Math.min(mae, (bar.l-ep)/ep*100);
    mfe = Math.max(mfe, (bar.h-ep)/ep*100);
    if (bar.l <= stop) { pnl += rem*(stop-ep)/ep*100; rem=0; break; }
    if (rem>=0.99 && bar.c>=t1) { pnl+=0.50*(bar.c-ep)/ep*100; rem-=0.50; }
    if (rem>=0.29 && bar.c>=t2) { pnl+=0.30*(bar.c-ep)/ep*100; rem-=0.30; }
    if (rem>0    && bar.c>=t3) { pnl+=rem*(bar.c-ep)/ep*100; rem=0; }
    if (b===MAX_H && rem>0)    { pnl+=rem*(bar.c-ep)/ep*100; rem=0; }
  }
  return { pnl, mae:Math.abs(mae), mfe, win: pnl > 0.1 };
}

function collectFiles() {
  const seen=new Set(), files=[];
  for (const {dir,fmt} of DATA_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const fn of fs.readdirSync(dir)) {
      if (!fn.endsWith('.csv') || fn === 'ALL_SYMBOLS_OHLCV.csv') continue;
      const fp = path.join(dir, fn);
      if (seen.has(fp)) continue; seen.add(fp);
      files.push({fp, fmt});
    }
  }
  return files;
}

// ── metrics helper ────────────────────────────────────────────────────────────
function metrics(trades) {
  if (!trades.length) return { wr:0, pf:0, avg:0, n:0, score:0 };
  const wins = trades.filter(t => t.win).length;
  const wr   = wins / trades.length * 100;
  const gW   = trades.filter(t=>t.pnl>0).reduce((a,b)=>a+b.pnl,0);
  const gL   = Math.abs(trades.filter(t=>t.pnl<=0).reduce((a,b)=>a+b.pnl,0));
  const pf   = gL > 0 ? gW/gL : (gW > 0 ? 999 : 0);
  const avg  = trades.reduce((a,b)=>a+b.pnl,0)/trades.length;
  // combined score: WR × log(PF+1) — rewards both dimensions, avoids PF=999 dominating
  const score = wr * Math.log(pf + 1);
  return { wr, pf, avg, n: trades.length, score };
}

// ── main ──────────────────────────────────────────────────────────────────────
function main() {
  const files = collectFiles();
  console.log(`\nLoaded ${files.length} symbols — collecting signals with CMF + OBV metadata...\n`);

  // For each param set, collect every signal's trade result + CMF + OBV
  const signalBank = {};
  for (const ps of PARAM_SETS) signalBank[ps] = [];

  let done = 0;
  for (const {fp, fmt} of files) {
    const all = fmt==='nse' ? parseNSE(fp) : parseYahoo(fp);
    if (all.length < MIN_C) { done++; continue; }

    for (const ps of PARAM_SETS) {
      let lastEntry = -COOL - 1;
      for (let i = WINDOW; i < all.length - MAX_H - 2; i += STEP) {
        if (i - lastEntry < COOL) continue;
        const win = all.slice(i - WINDOW, i + 1);
        let res;
        try { res = analyzeStock(win, ps); } catch { continue; }
        if (!res || !BUY.has(res.stage)) continue;

        const sc   = all[i].c;
        const raw  = res.priceEngine?.tacticalStop || sc * 0.95;
        const stop = Math.min(sc*0.965, Math.max(sc*0.935, raw));
        const t    = simulate(all, i, stop);
        if (!t) continue;

        lastEntry = i;

        // Compute CMF and OBV on the FULL history up to signal bar
        const cmf20  = computeCMF(all, i, 20);
        const obv10  = computeOBVSlope(all, i, 10);

        signalBank[ps].push({ ...t, cmf20, obv10 });
      }
    }
    done++;
    if (done % 50 === 0) process.stdout.write(`  ${done}/${files.length}\r`);
  }

  console.log(`\n  ✓ ${done} symbols collected.\n`);

  // ── sweep ────────────────────────────────────────────────────────────────────
  const W = 130;
  console.log('═'.repeat(W));
  console.log('  CMF + OBV HYPER-TUNE RESULTS  —  Optimal thresholds per archetype');
  console.log('═'.repeat(W));

  const recommendations = [];

  for (const ps of PARAM_SETS) {
    const all = signalBank[ps];
    const base = metrics(all);
    console.log(`\n▶ ${PS_LABEL[ps]}  (baseline: n=${base.n}  WR=${base.wr.toFixed(1)}%  PF=${base.pf.toFixed(2)}  Avg=${base.avg.toFixed(2)}%)`);

    let best = { cmf: -99, obv: -99, wr: base.wr, pf: base.pf, n: base.n, score: base.score, avg: base.avg };

    // Grid sweep
    for (const cmfMin of CMF_THRESHOLDS) {
      for (const obvMin of OBV_THRESHOLDS) {
        const filtered = all.filter(t => t.cmf20 >= cmfMin && t.obv10 >= obvMin);
        if (filtered.length < 10) continue; // need min 10 trades to be meaningful
        const m = metrics(filtered);
        if (m.score > best.score) {
          best = { cmf: cmfMin, obv: obvMin, ...m };
        }
      }
    }

    const wrGain  = (best.wr  - base.wr).toFixed(1);
    const pfGain  = (best.pf  - base.pf).toFixed(2);
    const retained = base.n > 0 ? (best.n / base.n * 100).toFixed(0) : 0;

    console.log(`  ✅ OPTIMAL: CMF ≥ ${best.cmf.toFixed(2)}  OBV-slope ≥ ${best.obv.toFixed(1)}`);
    console.log(`     After filter: n=${best.n} (${retained}% of signals retained)`);
    console.log(`     WR  ${base.wr.toFixed(1)}% → ${best.wr.toFixed(1)}%  (${wrGain >= 0 ? '+' : ''}${wrGain}pp)`);
    console.log(`     PF  ${base.pf.toFixed(2)} → ${best.pf.toFixed(2)}  (${pfGain >= 0 ? '+' : ''}${pfGain})`);
    console.log(`     Avg P&L  ${base.avg.toFixed(2)}% → ${best.avg.toFixed(2)}%`);

    // Show top-5 CMF-only sweep (OBV=0 fixed) for transparency
    console.log(`\n     CMF sweep (OBV ≥ 0 fixed):`);
    console.log(`     ${'CMF≥'.padEnd(8)} ${'n'.padStart(5)} ${'WR%'.padStart(7)} ${'PF'.padStart(7)} ${'Avg%'.padStart(8)} ${'Score'.padStart(8)}`);
    for (const cmfMin of CMF_THRESHOLDS) {
      const f = all.filter(t => t.cmf20 >= cmfMin && t.obv10 >= 0);
      if (f.length < 10) continue;
      const m = metrics(f);
      const flag = cmfMin === best.cmf ? ' ◀ best' : '';
      console.log(`     ${cmfMin.toFixed(2).padEnd(8)} ${String(m.n).padStart(5)} ${(m.wr.toFixed(1)+'%').padStart(7)} ${m.pf.toFixed(2).padStart(7)} ${(m.avg.toFixed(2)+'%').padStart(8)} ${m.score.toFixed(1).padStart(8)}${flag}`);
    }

    recommendations.push({
      ps, label: PS_LABEL[ps], baseline: base,
      cmfMin: best.cmf, obvMin: best.obv,
      optimised: { wr: best.wr, pf: best.pf, n: best.n, avg: best.avg },
    });
  }

  // ── code patch suggestions ────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(W)}`);
  console.log('  READY-TO-PASTE ENGINE PATCHES  (add to each archetype BEFORE minConditionsMet check)');
  console.log('═'.repeat(W));
  for (const r of recommendations) {
    const cmf = r.cmfMin.toFixed(2);
    const obv = r.obvMin.toFixed(1);
    console.log(`\n// ── ${r.label} ──`);
    console.log(`  const cmf20 = computeCMF(candles, endIdx, 20);`);
    console.log(`  const obvSlope = computeOBVSlope10(candles, endIdx);`);
    console.log(`  // CMF+OBV gate: hyper-tuned for max WR×PF (WR ${r.baseline.wr.toFixed(1)}% → ${r.optimised.wr.toFixed(1)}%, PF ${r.baseline.pf.toFixed(2)} → ${r.optimised.pf.toFixed(2)})`);
    console.log(`  if (cmf20 < ${cmf} || obvSlope < ${obv}) return { ...base, conditionsMet: 0, ... };`);
  }

  // Save
  const out = path.join(__dirname, 'results',
    `cmf_obv_hypertune_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,16)}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), recommendations }, null, 2));
  console.log(`\n\n  Results saved → ${out}\n`);
}

main();
