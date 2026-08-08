'use strict';
// UC Pre-detection Backtest — precision / recall / ROC analysis
//
// Uses stored FAS features in pbfb_uc_events (n_before=1) to replay
// computeUCScore against real UC events.
//
// Outputs:
//   1. Score distribution per classification
//   2. Full ROC / precision-recall curve
//   3. Threshold for 75% recall + precision at that threshold
//   4. Grid search: optimal weights (incl. zone_tightness, vol_vs_pre5)
//   5. Feature importance (Cohen's d) including unused FAS features
//   6. Recommended weight update for computeUCScore()

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

function sbGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPA_URL}/rest/v1/${urlPath}`);
    const req = https.request(url, {
      headers: {
        apikey: SUPA_KEY,
        authorization: `Bearer ${SUPA_KEY}`,
        accept: 'application/json',
        'range-unit': 'items',
        range: '0-4999',
      }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error(`Parse: ${body.slice(0,300)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── helpers ─────────────────────────────────────────────────────────────────
const mean = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s,x)=>s+(x-m)**2,0)/arr.length);
}
const clamp = (x,lo,hi) => Math.max(lo, Math.min(hi, x));
const f1  = v => (typeof v==='number' ? v.toFixed(1) : '-');
const f2  = v => (typeof v==='number' ? v.toFixed(2) : '-');
const f3  = v => (typeof v==='number' ? v.toFixed(3) : '-');
const pct = (n,d) => d > 0 ? (n/d*100).toFixed(1)+'%' : '-';
const sep = (n,c='─') => c.repeat(n);

// ── current computeUCScore (v2, as just deployed) ───────────────────────────
function computeUCScore_v2(r) {
  const closeLoc    = r.close_loc    ?? 50;
  const volRatio20  = r.vol_ratio_20 ?? 1;
  const rsi2        = r.rsi2         ?? 50;
  const rangeATR14  = r.range_atr    ?? 1;
  const bodyPct     = r.body_pct     ?? 30;
  // clTrend and rsi2Velocity are NOT stored in pbfb_uc_events — use neutral half-weight
  const clComp  = clamp((closeLoc  - 35) / 57, 0, 1) * 30;
  const rsiComp = clamp((rsi2      - 26) / 74, 0, 1) * 20;
  const cltComp = 9;   // neutral (not stored)
  const rsvComp = 6;   // neutral (not stored)
  const rngComp = clamp((rangeATR14 - 0.5) / 1.2, 0, 1) * 5;
  const bPComp  = clamp((bodyPct    - 15)  / 56,  0, 1) * 6;
  const volBonus = volRatio20 >= 3.0 ? 8 : volRatio20 >= 2.0 ? 4 : volRatio20 >= 1.5 ? 2 : 0;
  return Math.round(Math.min(100, clComp + rsiComp + cltComp + rsvComp + rngComp + bPComp + volBonus));
}

// ── candidate v3 — adds zone_tightness, vol_vs_pre5, upper_wick_pct ─────────
function computeUCScore_v3(r, w) {
  const closeLoc      = r.close_loc      ?? 50;
  const volRatio20    = r.vol_ratio_20   ?? 1;
  const volPre5       = r.vol_vs_pre5    ?? 1;
  const rsi2          = r.rsi2           ?? 50;
  const rangeATR14    = r.range_atr      ?? 1;
  const bodyPct       = r.body_pct       ?? 30;
  const zoneTight     = r.zone_tightness ?? 5;    // lower = tighter = better
  const upperWickPct  = r.upper_wick_pct ?? 20;   // lower = better

  const clComp  = clamp((closeLoc   - (w.cl_lo  ?? 35)) / (w.cl_rng ?? 57), 0, 1) * (w.cl  ?? 30);
  const rsiComp = clamp((rsi2       - (w.rsi_lo ?? 26)) / (w.rsi_rng?? 74), 0, 1) * (w.rsi ?? 20);
  const rngComp = clamp((rangeATR14 - 0.5) / 1.2, 0, 1)                           * (w.rng ?? 5);
  const bPComp  = clamp((bodyPct    - 15)  / 56,  0, 1)                            * (w.bp  ?? 6);
  // vol: use max of vol_ratio_20 and vol_vs_pre5 (whichever is more extreme)
  const volMax  = Math.max(volRatio20, volPre5);
  const volBonus = volMax >= 3.5 ? (w.vol3 ?? 10) : volMax >= 3.0 ? (w.vol3 ?? 8) : volMax >= 2.0 ? (w.vol2 ?? 4) : volMax >= 1.5 ? 2 : 0;
  // zone_tightness: low = tight zone = bullish for UC. Range [0.5, 5.0], flip direction.
  const ztComp  = clamp((5.0 - zoneTight) / 4.5, 0, 1)                            * (w.zt  ?? 0);
  // upper wick: low = no rejection = bullish. Range [0, 30], flip.
  const uwComp  = clamp((30 - upperWickPct) / 30, 0, 1)                           * (w.uw  ?? 0);
  // neutral placeholders for clTrend/rsi2Vel (not stored)
  const cltComp = w.clt_neutral ?? 9;
  const rsvComp = w.rsv_neutral ?? 6;
  return Math.round(Math.min(100, clComp + rsiComp + rngComp + bPComp + volBonus + ztComp + uwComp + cltComp + rsvComp));
}

// ── recall/precision at each threshold ──────────────────────────────────────
function rocCurve(scores, labels) {
  // scores: number[], labels: 1/0 (1=positive=actionable)
  const pairs = scores.map((s,i) => ({ s, y: labels[i] })).sort((a,b) => b.s - a.s);
  const totalPos = labels.reduce((a,b) => a+b, 0);
  const totalNeg = labels.length - totalPos;
  let tp = 0, fp = 0;
  const curve = [];
  let prevT = Infinity;
  for (const {s, y} of pairs) {
    if (s !== prevT) {
      curve.push({ threshold: s, tp, fp, recall: tp/totalPos, precision: tp>0||fp>0 ? tp/(tp+fp) : 1, fpr: fp/totalNeg });
      prevT = s;
    }
    if (y === 1) tp++; else fp++;
  }
  curve.push({ threshold: -1, tp, fp, recall: tp/totalPos, precision: tp>0||fp>0 ? tp/(tp+fp) : 1, fpr: fp/totalNeg });
  return { curve, totalPos, totalNeg };
}

// find point on curve closest to targetRecall
function thresholdForRecall(curve, targetRecall) {
  let best = null, bestDist = Infinity;
  for (const p of curve) {
    const d = Math.abs(p.recall - targetRecall);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

// AUC (trapezoidal)
function auc(curve) {
  let a = 0;
  for (let i = 1; i < curve.length; i++) {
    const dx = Math.abs(curve[i].fpr - curve[i-1].fpr);
    const dy = (curve[i].recall + curve[i-1].recall) / 2;
    a += dx * dy;
  }
  return a;
}

// ── grid search ─────────────────────────────────────────────────────────────
function gridSearch(events, positiveClasses) {
  const labels = events.map(r => positiveClasses.has(r.classification) ? 1 : 0);

  const grid = {
    cl:  [22, 26, 30, 34],
    rsi: [16, 18, 20, 22],
    rng: [3, 4, 5, 6],
    bp:  [4, 5, 6, 7],
    vol3:[6, 8, 10, 12],
    vol2:[3, 4, 5],
    zt:  [0, 3, 5, 8],    // zone_tightness weight
    uw:  [0, 2, 4],       // upper_wick weight
    cl_lo: [28, 32, 35, 40],
    rsi_lo:[20, 26, 30],
  };

  // Random sampled grid search (full would be too large)
  const TRIALS = 3000;
  let bestAUC = 0, bestW = null, bestR75 = null;

  for (let t = 0; t < TRIALS; t++) {
    const w = {
      cl:  grid.cl[Math.floor(Math.random()  * grid.cl.length)],
      rsi: grid.rsi[Math.floor(Math.random() * grid.rsi.length)],
      rng: grid.rng[Math.floor(Math.random() * grid.rng.length)],
      bp:  grid.bp[Math.floor(Math.random()  * grid.bp.length)],
      vol3:grid.vol3[Math.floor(Math.random()* grid.vol3.length)],
      vol2:grid.vol2[Math.floor(Math.random()* grid.vol2.length)],
      zt:  grid.zt[Math.floor(Math.random()  * grid.zt.length)],
      uw:  grid.uw[Math.floor(Math.random()  * grid.uw.length)],
      cl_lo:  grid.cl_lo[Math.floor(Math.random()  * grid.cl_lo.length)],
      rsi_lo: grid.rsi_lo[Math.floor(Math.random() * grid.rsi_lo.length)],
    };
    // Normalise so max possible score ~100
    // neutrals fixed
    w.clt_neutral = 9;
    w.rsv_neutral = 6;

    const scores = events.map(r => computeUCScore_v3(r, w));
    const { curve, totalPos } = rocCurve(scores, labels);
    const a = auc(curve);
    if (a > bestAUC) {
      bestAUC = a;
      bestW   = { ...w };
      bestR75 = thresholdForRecall(curve, 0.75);
    }
  }
  return { bestW, bestAUC, bestR75 };
}

// ── Cohen's d for all FAS features ──────────────────────────────────────────
function cohensD(posArr, negArr) {
  const mp = mean(posArr), mn = mean(negArr);
  const sp = std(posArr), sn = std(negArr);
  const pool = Math.sqrt((sp*sp + sn*sn) / 2);
  return pool > 0 ? (mp - mn) / pool : 0;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const W = 80;
  console.log('\n' + '═'.repeat(W));
  console.log('  UC PRE-DETECTION BACKTEST  —  precision / recall / ROC');
  console.log('  Goal: 75% recall at maximum precision');
  console.log('═'.repeat(W) + '\n');

  const all = await sbGet('pbfb_uc_events?select=*&n_before=eq.1&order=event_date.desc');
  if (!Array.isArray(all)) { console.error('Fetch error:', JSON.stringify(all)); return; }

  const total  = all.length;
  const byClass = {};
  for (const r of all) {
    const c = r.classification ?? 'unknown';
    byClass[c] = (byClass[c] || []);
    byClass[c].push(r);
  }

  console.log(`Total UC events (n_before=1): ${total}`);
  for (const [c, rows] of Object.entries(byClass)) {
    console.log(`  ${c.padEnd(20)} ${String(rows.length).padStart(5)}  ${pct(rows.length, total)}`);
  }

  // ── Phase 1: score distribution per class ──────────────────────────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  PHASE 1: Score distribution (current v2) per classification');
  console.log('═'.repeat(W));

  const scoresByClass = {};
  for (const [c, rows] of Object.entries(byClass)) {
    scoresByClass[c] = rows.map(computeUCScore_v2);
  }

  const hdrLine = `  ${'class'.padEnd(14)} ${'n'.padStart(5)} ${'mean'.padStart(8)} ${'p25'.padStart(8)} ${'p50'.padStart(8)} ${'p75'.padStart(8)} ${'p90'.padStart(8)} ${'≥70%'.padStart(8)}`;
  console.log(hdrLine);
  console.log('  ' + sep(W-2));

  function percentile(arr, p) {
    const s = [...arr].sort((a,b)=>a-b);
    const idx = (p/100) * (s.length-1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return s[lo] + (s[hi]-s[lo]) * (idx-lo);
  }

  for (const [c, scores] of Object.entries(scoresByClass)) {
    const n   = scores.length;
    const m   = mean(scores);
    const p25 = percentile(scores, 25);
    const p50 = percentile(scores, 50);
    const p75 = percentile(scores, 75);
    const p90 = percentile(scores, 90);
    const hi  = scores.filter(s=>s>=70).length;
    console.log(`  ${c.padEnd(14)} ${String(n).padStart(5)} ${f1(m).padStart(8)} ${f1(p25).padStart(8)} ${f1(p50).padStart(8)} ${f1(p75).padStart(8)} ${f1(p90).padStart(8)} ${pct(hi,n).padStart(8)}`);
  }

  // ── Phase 2: ROC curve — positive = actionable ─────────────────────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  PHASE 2: ROC curve  (positive = actionable)');
  console.log('═'.repeat(W));

  const posClasses = new Set(['actionable']);
  const labels     = all.map(r => posClasses.has(r.classification) ? 1 : 0);
  const scores_v2  = all.map(computeUCScore_v2);
  const { curve, totalPos, totalNeg } = rocCurve(scores_v2, labels);
  const aucV2 = auc(curve);

  console.log(`\n  Positive (actionable): ${totalPos}   Negative (all others): ${totalNeg}`);
  console.log(`  AUC (ROC): ${f3(aucV2)}\n`);

  // Print curve at key recall milestones
  const milestones = [0.50, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90];
  console.log(`  ${'Recall'.padStart(8)} ${'Precision'.padStart(10)} ${'Threshold'.padStart(11)} ${'TP'.padStart(7)} ${'FP'.padStart(7)}`);
  console.log('  ' + sep(W-2));
  for (const target of milestones) {
    const pt = thresholdForRecall(curve, target);
    if (!pt) continue;
    const flag = target === 0.75 ? ' ◄ TARGET' : '';
    console.log(`  ${pct(pt.recall,1).padStart(8)} ${pct(pt.precision,1).padStart(10)} ${String(pt.threshold).padStart(11)} ${String(pt.tp).padStart(7)} ${String(pt.fp).padStart(7)}${flag}`);
  }

  const t75 = thresholdForRecall(curve, 0.75);
  console.log(`\n  At 75% recall → score threshold: ${t75?.threshold}  precision: ${pct(t75?.precision ?? 0, 1)}`);

  // ── Phase 3: ROC with broader positive set (actionable + on_radar) ─────────
  console.log('\n' + '═'.repeat(W));
  console.log('  PHASE 3: ROC curve  (positive = actionable + on_radar)');
  console.log('═'.repeat(W));

  const posClasses2 = new Set(['actionable', 'on_radar']);
  const labels2     = all.map(r => posClasses2.has(r.classification) ? 1 : 0);
  const { curve: curve2, totalPos: tp2, totalNeg: tn2 } = rocCurve(scores_v2, labels2);
  const aucV2b = auc(curve2);

  console.log(`\n  Positive (actionable+on_radar): ${tp2}   Negative: ${tn2}`);
  console.log(`  AUC (ROC): ${f3(aucV2b)}\n`);
  console.log(`  ${'Recall'.padStart(8)} ${'Precision'.padStart(10)} ${'Threshold'.padStart(11)}`);
  console.log('  ' + sep(W-2));
  for (const target of milestones) {
    const pt = thresholdForRecall(curve2, target);
    if (!pt) continue;
    const flag = target === 0.75 ? ' ◄ TARGET' : '';
    console.log(`  ${pct(pt.recall,1).padStart(8)} ${pct(pt.precision,1).padStart(10)} ${String(pt.threshold).padStart(11)}${flag}`);
  }

  // ── Phase 4: Cohen's d for ALL FAS features ────────────────────────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  PHASE 4: Cohen\'s d — actionable vs missed (all FAS features)');
  console.log('═'.repeat(W));

  const A = (byClass['actionable'] || []).filter(r => r.close_loc !== null);
  const M = (byClass['missed']     || []).filter(r => r.close_loc !== null);
  const R = (byClass['on_radar']   || []).filter(r => r.close_loc !== null);

  const FAS_ALL = ['close_loc','body_pct','upper_wick_pct','vol_ratio_20','vol_vs_pre5',
                   'range_atr','rsi2','zone_len','zone_tightness'];

  console.log(`\n  ${'Feature'.padEnd(20)} ${'d (A vs M)'.padStart(12)} ${'mean_A'.padStart(10)} ${'mean_M'.padStart(10)} ${'d (A vs R)'.padStart(12)} ${'mean_R'.padStart(10)}`);
  console.log('  ' + sep(W-2));

  const featureDs = [];
  for (const k of FAS_ALL) {
    const wA = A.map(r=>r[k]).filter(v=>v!=null);
    const wM = M.map(r=>r[k]).filter(v=>v!=null);
    const wR = R.map(r=>r[k]).filter(v=>v!=null);
    if (wA.length < 5 || wM.length < 5) continue;
    const dAM = cohensD(wA, wM);
    const dAR = wR.length >= 5 ? cohensD(wA, wR) : null;
    const mA = mean(wA), mM = mean(wM);
    const strength = Math.abs(dAM) >= 0.7 ? '★★★' : Math.abs(dAM) >= 0.4 ? '★★ ' : Math.abs(dAM) >= 0.2 ? '★  ' : '   ';
    const inScore  = ['close_loc','rsi2','range_atr','body_pct'].includes(k) ? '(in v2)' : '(UNUSED)';
    console.log(`  ${k.padEnd(20)} ${f3(dAM).padStart(12)} ${f1(mA).padStart(10)} ${f1(mM).padStart(10)} ${dAR != null ? f3(dAR).padStart(12) : '     -    '} ${f1(mean(wR)).padStart(10)}  ${strength} ${inScore}`);
    featureDs.push({ k, dAM, mA, mM });
  }

  featureDs.sort((a,b) => Math.abs(b.dAM) - Math.abs(a.dAM));
  console.log('\n  Features ranked by |d|: ' + featureDs.map(f=>f.k).join(' > '));

  // ── Phase 5: Grid search — find optimal weights for 75% recall ────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  PHASE 5: Grid search — optimal weights (3000 random trials)');
  console.log('  Positive = actionable only');
  console.log('═'.repeat(W) + '\n');

  const { bestW, bestAUC: bAUC, bestR75: bR75 } = gridSearch(all, posClasses);

  console.log(`  Best AUC: ${f3(bAUC)}  (v2 baseline: ${f3(aucV2)})`);
  console.log(`  Best weights:`);
  for (const [k,v] of Object.entries(bestW)) {
    if (!['clt_neutral','rsv_neutral'].includes(k)) console.log(`    ${k.padEnd(10)} = ${v}`);
  }

  // Recompute curve with best weights
  const scores_v3 = all.map(r => computeUCScore_v3(r, bestW));
  const { curve: cv3, totalPos: tp3, totalNeg: tn3 } = rocCurve(scores_v3, labels);
  const aucV3 = auc(cv3);

  console.log(`\n  v3 AUC: ${f3(aucV3)}  vs v2 AUC: ${f3(aucV2)}`);
  console.log(`\n  ${'Recall'.padStart(8)} ${'Prec (v2)'.padStart(12)} ${'Prec (v3)'.padStart(12)} ${'Threshold v3'.padStart(14)}`);
  console.log('  ' + sep(W-2));
  for (const target of milestones) {
    const pt2 = thresholdForRecall(curve, target);
    const pt3 = thresholdForRecall(cv3, target);
    const flag = target === 0.75 ? ' ◄ TARGET' : '';
    console.log(`  ${pct(target,1).padStart(8)} ${pct(pt2?.precision??0,1).padStart(12)} ${pct(pt3?.precision??0,1).padStart(12)} ${String(pt3?.threshold??'-').padStart(14)}${flag}`);
  }

  const t75v3 = thresholdForRecall(cv3, 0.75);
  console.log(`\n  At 75% recall → v3 threshold: ${t75v3?.threshold}  precision: ${pct(t75v3?.precision ?? 0, 1)}`);

  // ── Phase 6: Score histogram at 75% recall threshold ─────────────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  PHASE 6: v3 score distribution at 75% recall threshold');
  console.log('═'.repeat(W));

  const t75Score = t75v3?.threshold ?? 50;
  console.log(`\n  Score threshold for 75% recall: ${t75Score}`);
  console.log(`  Stocks flagged (score ≥ ${t75Score}):`);

  const classCounts = {};
  for (const r of all) {
    const s = computeUCScore_v3(r, bestW);
    if (s >= t75Score) {
      const c = r.classification;
      classCounts[c] = (classCounts[c] || 0) + 1;
    }
  }
  const totalFlagged = Object.values(classCounts).reduce((a,b)=>a+b,0);
  for (const [c, n] of Object.entries(classCounts)) {
    console.log(`    ${c.padEnd(18)} ${String(n).padStart(5)}  ${pct(n, totalFlagged)}`);
  }
  console.log(`    Total flagged:     ${totalFlagged}  out of ${total} (${pct(totalFlagged, total)})`);

  // ── Phase 7: Best feature combos for high precision ───────────────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  PHASE 7: Multi-condition gate analysis (precision sniper modes)');
  console.log('═'.repeat(W));

  const gates = [
    { name: 'Vol≥3x + CL≥75 + RSI2≥70 (ucStrong)',     fn: r => r.vol_ratio_20>=3 && r.close_loc>=75 && r.rsi2>=70 },
    { name: 'Vol≥3x + CL≥75 + RSI2≥70 + Body≥50',      fn: r => r.vol_ratio_20>=3 && r.close_loc>=75 && r.rsi2>=70 && r.body_pct>=50 },
    { name: 'Vol≥3x + CL≥80 + RSI2≥72',                 fn: r => r.vol_ratio_20>=3 && r.close_loc>=80 && r.rsi2>=72 },
    { name: 'Vol≥3x + CL≥75 + ZT≤3',                    fn: r => r.vol_ratio_20>=3 && r.close_loc>=75 && (r.zone_tightness??9)<=3 },
    { name: 'Vol≥2x + CL≥70 + RSI2≥65 + Body≥40',       fn: r => r.vol_ratio_20>=2 && r.close_loc>=70 && r.rsi2>=65 && r.body_pct>=40 },
    { name: 'Vol≥2x + CL≥65 + RSI2≥60 + UW≤15',         fn: r => r.vol_ratio_20>=2 && r.close_loc>=65 && r.rsi2>=60 && (r.upper_wick_pct??99)<=15 },
    { name: 'Vol≥1.5x + CL≥60 + RSI2≥55 (broad gate)',  fn: r => r.vol_ratio_20>=1.5 && r.close_loc>=60 && r.rsi2>=55 },
    { name: 'Vol≥2x + CL≥60 + RSI2≥55 + ZT≤4',          fn: r => r.vol_ratio_20>=2 && r.close_loc>=60 && r.rsi2>=55 && (r.zone_tightness??9)<=4 },
    { name: 'Vol≥3x + RSI2≥70 (goldmine OR)',             fn: r => r.vol_ratio_20>=3 && r.rsi2>=70 },
    { name: 'Vol≥3x + (CL≥75 OR RSI2≥70) (ucGoldmine)', fn: r => r.vol_ratio_20>=3 && (r.close_loc>=75 || r.rsi2>=70) },
    { name: 'VolPre5≥3x + CL≥70 + RSI2≥65',              fn: r => (r.vol_vs_pre5??0)>=3 && r.close_loc>=70 && r.rsi2>=65 },
    { name: 'Vol≥2x + VolPre5≥2x + CL≥65 + RSI2≥60',    fn: r => r.vol_ratio_20>=2 && (r.vol_vs_pre5??0)>=2 && r.close_loc>=65 && r.rsi2>=60 },
  ];

  const totalA = (byClass['actionable']||[]).length;

  console.log(`\n  ${'Gate'.padEnd(44)} ${'n'.padStart(5)} ${'Prec%'.padStart(7)} ${'Recall%'.padStart(9)} ${'F1'.padStart(6)}`);
  console.log('  ' + sep(W-2));

  for (const g of gates) {
    const flagged = all.filter(g.fn);
    const n = flagged.length;
    if (n === 0) { console.log(`  ${g.name.padEnd(44)} ${'0'.padStart(5)}`); continue; }
    const tp = flagged.filter(r => r.classification === 'actionable').length;
    const prec   = tp / n;
    const recall = tp / totalA;
    const f1val  = prec + recall > 0 ? 2 * prec * recall / (prec + recall) : 0;
    const flag   = recall >= 0.75 ? ' ◄ 75%' : recall >= 0.50 ? ' ·50%' : '';
    console.log(`  ${g.name.padEnd(44)} ${String(n).padStart(5)} ${pct(prec,1).padStart(7)} ${pct(recall,1).padStart(9)} ${f2(f1val).padStart(6)}${flag}`);
  }

  // ── Phase 8: score threshold scan — precision at each recall level ─────────
  console.log('\n' + '═'.repeat(W));
  console.log('  PHASE 8: Score threshold scan (v3 best weights)');
  console.log('  Find minimum threshold score for 75% recall at best precision');
  console.log('═'.repeat(W));

  const buckets = {};
  for (const r of all) {
    const s = computeUCScore_v3(r, bestW);
    const bucket = Math.floor(s / 5) * 5;  // buckets of 5
    if (!buckets[bucket]) buckets[bucket] = { total: 0, act: 0, onRadar: 0 };
    buckets[bucket].total++;
    if (r.classification === 'actionable') buckets[bucket].act++;
    if (r.classification === 'on_radar')   buckets[bucket].onRadar++;
  }

  // cumulative from top down: fraction of events with score ≥ threshold
  const thresholds = Object.keys(buckets).map(Number).sort((a,b)=>b-a);
  let cumTotal = 0, cumAct = 0;
  console.log(`\n  ${'Threshold'.padStart(10)} ${'≥threshold'.padStart(12)} ${'Prec%'.padStart(8)} ${'Recall%'.padStart(10)} ${'F1'.padStart(7)}`);
  console.log('  ' + sep(W-2));
  for (const t of thresholds) {
    const b = buckets[t];
    cumTotal += b.total;
    cumAct   += b.act;
    const prec   = cumTotal > 0 ? cumAct / cumTotal : 0;
    const recall = totalA   > 0 ? cumAct / totalA   : 0;
    const f1val  = prec + recall > 0 ? 2 * prec * recall / (prec + recall) : 0;
    const flag   = recall >= 0.75 && recall < 0.80 ? ' ◄ 75% ZONE' :
                   recall >= 0.60 && recall < 0.65 ? ' · 60%' : '';
    console.log(`  ${String(t).padStart(10)} ${String(cumTotal).padStart(12)} ${pct(prec,1).padStart(8)} ${pct(recall,1).padStart(10)} ${f2(f1val).padStart(7)}${flag}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  SUMMARY & RECOMMENDATIONS');
  console.log('═'.repeat(W));
  console.log(`\n  v2 AUC:  ${f3(aucV2)}`);
  console.log(`  v3 AUC:  ${f3(aucV3)}`);
  console.log(`\n  v2 at 75% recall → threshold: ${t75?.threshold}  precision: ${pct(t75?.precision??0, 1)}`);
  console.log(`  v3 at 75% recall → threshold: ${t75v3?.threshold}  precision: ${pct(t75v3?.precision??0, 1)}`);
  console.log(`\n  Optimal v3 weights:`);
  const wKeys = ['cl','cl_lo','rsi','rsi_lo','rng','bp','vol3','vol2','zt','uw'];
  for (const k of wKeys) console.log(`    ${k.padEnd(8)} = ${bestW[k]}`);
  console.log('\n  Done.');
}

main().catch(console.error);
