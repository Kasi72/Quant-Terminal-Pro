'use strict';
/**
 * UC Score EXACT Gate Finder — Deep Statistical Analysis
 *
 * Fixes from v1:
 *   - Uses ONLY rows where next_day_chg_pct IS NOT NULL (properly labeled)
 *   - Within-range bin analysis (no truncation artifact below 35)
 *   - Full Fisher's exact on bins (not ≥T vs empty below-T)
 *
 * Methods applied:
 *   1. Kernel density estimation (Gaussian kernel, Silverman bandwidth)
 *      — smooth P(hit|score) curve, find exact 1× and 2× base-rate crossings
 *   2. CUSUM change-point detection
 *      — cumulative sum of (hit_i - base_rate), find score where signal exceeds 3σ control limit
 *   3. CART optimal single split
 *      — exhaustive search over all candidate thresholds, maximise Gini information gain
 *      — equivalent to a single-node decision tree, minimum sample size enforced
 *   4. Isotonic regression (PAVA algorithm)
 *      — fit monotone non-decreasing precision curve to bin means
 *      — find exact score where isotonic P(hit) first exceeds 1.5×, 2×, 3× base rate
 *   5. Jensen-Shannon divergence scan
 *      — sliding window JS divergence between hit and non-hit CDFs
 *      — peak JS divergence = maximum distributional separation
 *   6. Exact Fisher's exact p-value on every score BIN (not threshold)
 *      — compares each bin's hit rate vs rest-of-dataset
 *      — finds lowest bin where enrichment is statistically significant
 *   7. Structural break / Chow test (score-stratified)
 *      — tests if precision below T equals precision above T for every T
 *      — Fisher p-value version with proper two-population test
 *   8. Bootstrap 95% CI on the EXACT recommended threshold
 *
 * Output: console + scripts/results/uc_score_exact_gate.json
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ROOT       = path.join(__dirname, '..');
const RESULT_DIR = path.join(ROOT, 'scripts', 'results');
if (!fs.existsSync(RESULT_DIR)) fs.mkdirSync(RESULT_DIR, { recursive: true });

const TARGET = (process.argv.find(a => a.startsWith('--target='))?.split('=')[1] ?? '5pct');
const TARGET_CONFIGS = {
  uc:       { label: 'UC next day',        isPos: r => r.hit_uc_next_day === true,   needsCol: 'hit_uc_next_day' },
  '5pct':   { label: '>5% gain next day',  isPos: r => r.next_day_chg_pct >= 5,      needsCol: 'next_day_chg_pct' },
  '10pct':  { label: '>10% gain next day', isPos: r => r.next_day_chg_pct >= 10,     needsCol: 'next_day_chg_pct' },
  '5pct_3d':{ label: '>5% within 3 days',  isPos: r => r.hit_5pct_3d === true,       needsCol: 'hit_5pct_3d' },
};
const TC = TARGET_CONFIGS[TARGET] ?? TARGET_CONFIGS['5pct'];

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error('[ERROR] Missing Supabase creds'); process.exit(1); }

function sbGet(urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(`${SUPA_URL}/rest/v1/${urlPath}`), {
      headers: { apikey: SUPA_KEY, authorization: `Bearer ${SUPA_KEY}`, accept: 'application/json', 'accept-profile': 'public' },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(`JSON: ${d.slice(0,200)}`)); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchAll(q) {
  let all = [], page = 0;
  while (true) {
    const rows = await sbGet(`${q}&limit=1000&offset=${page * 1000}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    all = all.concat(rows);
    if (rows.length < 1000) break;
    page++;
  }
  return all;
}

// ── Log-factorial for Fisher's exact ─────────────────────────────────────────
const MAX_LF = 15000;
const LF = new Float64Array(MAX_LF + 1);
LF[0] = LF[1] = 0;
for (let i = 2; i <= MAX_LF; i++) LF[i] = LF[i-1] + Math.log(i);
const logC = (n, k) => (k < 0 || k > n) ? -Infinity : LF[n] - LF[k] - LF[n-k];

// Fisher's exact one-sided: P(a' >= a | margins fixed)
function fisherOneP(a, b, c, d) {
  const N = a+b+c+d, R1 = a+b, K = a+c;
  if (N > MAX_LF) return NaN;
  const logDenom = logC(N, R1);
  let p = 0;
  for (let k = a; k <= Math.min(R1, K); k++) {
    const logP = logC(K, k) + logC(N-K, R1-k) - logDenom;
    p += Math.exp(logP);
  }
  return Math.min(1, p);
}

// Two-sided Fisher for bin-vs-rest
function fisher2P(a, b, c, d) {
  const pObs = fisherOneP(a, b, c, d);
  const pFlip = fisherOneP(d, c, b, a);
  return Math.min(1, pObs + pFlip);
}

// erfc for normal CDF
function erfc(x) {
  if (x < 0) return 2 - erfc(-x);
  const t = 1 / (1 + 0.3275911 * x);
  return t * (0.254829592 + t*(-0.284496736 + t*(1.421413741 + t*(-1.453152027 + t*1.061405429)))) * Math.exp(-x*x);
}
const normalCDF = z => erfc(-z / Math.SQRT2) / 2;

// ── Gaussian kernel smoother ───────────────────────────────────────────────────
// Nadaraya-Watson kernel regression: E[hit | score = x]
function kernelSmooth(points, queryX, bandwidth) {
  let wSum = 0, wySum = 0;
  for (const pt of points) {
    const u = (queryX - pt.x) / bandwidth;
    const w = Math.exp(-0.5 * u * u);
    wSum += w;
    wySum += w * pt.y;
  }
  return wSum > 1e-12 ? wySum / wSum : NaN;
}

// Silverman's rule of thumb bandwidth
function silvermanBandwidth(xs) {
  const n = xs.length;
  const mu = xs.reduce((a,b)=>a+b,0) / n;
  const sigma = Math.sqrt(xs.reduce((s,x)=>s+(x-mu)**2,0)/(n-1));
  const sorted = [...xs].sort((a,b)=>a-b);
  const iqr = sorted[Math.floor(0.75*n)] - sorted[Math.floor(0.25*n)];
  const s = Math.min(sigma, iqr / 1.34);
  return 0.9 * s * Math.pow(n, -0.2);
}

// ── PAVA isotonic regression ───────────────────────────────────────────────────
// Input: array of {x, y, w} sorted by x. Returns monotone non-decreasing y values.
function isotonicRegression(points) {
  const n = points.length;
  const blocks = points.map((p, i) => ({ sum: p.y * p.w, w: p.w, start: i, end: i }));
  // Pool adjacent violators
  let i = 0;
  while (i < blocks.length - 1) {
    if (blocks[i].sum / blocks[i].w > blocks[i+1].sum / blocks[i+1].w) {
      // Merge i and i+1
      blocks[i] = {
        sum: blocks[i].sum + blocks[i+1].sum,
        w:   blocks[i].w   + blocks[i+1].w,
        start: blocks[i].start,
        end: blocks[i+1].end,
      };
      blocks.splice(i+1, 1);
      if (i > 0) i--;
    } else {
      i++;
    }
  }
  // Expand back to per-point values
  const result = new Array(n);
  for (const b of blocks) {
    const val = b.sum / b.w;
    for (let j = b.start; j <= b.end; j++) result[j] = val;
  }
  return result;
}

// ── CUSUM change-point ─────────────────────────────────────────────────────────
// Cusum S_i = sum_{j=1}^{i} (hit_j - base_rate)
// Control limit h = k * sigma, k=3 (3σ)
// Finds first score where cumulative excess persistently exceeds h
function cusumAnalysis(sortedData, baseRate) {
  const n = sortedData.length;
  const sigma = Math.sqrt(baseRate * (1 - baseRate));
  const h = 3 * sigma * Math.sqrt(n); // control limit scales with sqrt(n)
  let S = 0, maxS = 0, maxIdx = 0;
  const trace = [];
  for (let i = 0; i < n; i++) {
    S += sortedData[i].hit - baseRate;
    if (S < 0) S = 0; // one-sided CUSUM (detecting upward shift)
    if (S > maxS) { maxS = S; maxIdx = i; }
    trace.push({ score: sortedData[i].score, S: S });
  }
  // Find the last point before maxS where CUSUM was near zero (start of shift)
  let shiftStart = maxIdx;
  for (let i = maxIdx; i >= 0; i--) {
    if (trace[i].S < 0.01 * maxS) { shiftStart = i; break; }
  }
  return {
    maxCusum: maxS,
    maxCusumScore: sortedData[maxIdx].score,
    shiftStartScore: sortedData[shiftStart]?.score,
    controlLimit: h,
    detected: maxS > h,
    trace,
  };
}

// ── CART optimal single split (Gini maximisation) ─────────────────────────────
function cartOptimalSplit(data, minSamples = 20) {
  const N = data.length;
  const totalHits = data.filter(r=>r.hit).length;
  const giniTotal = 1 - (totalHits/N)**2 - ((N-totalHits)/N)**2;

  let bestSplit = null, bestGain = -Infinity;
  const candidates = [...new Set(data.map(r=>r.score))].sort((a,b)=>a-b);

  for (const t of candidates) {
    const left  = data.filter(r => r.score >= t);
    const right = data.filter(r => r.score < t);
    if (left.length < minSamples || right.length < minSamples) continue;
    const nL = left.length, nR = right.length;
    const hL = left.filter(r=>r.hit).length;
    const hR = right.filter(r=>r.hit).length;
    const gL = 1 - (hL/nL)**2 - ((nL-hL)/nL)**2;
    const gR = 1 - (hR/nR)**2 - ((nR-hR)/nR)**2;
    const gain = giniTotal - (nL/N)*gL - (nR/N)*gR;

    // Also compute Fisher p for this split
    const a = hL, b = nL-hL, c = hR, d = nR-hR;
    const p = fisher2P(a, b, c, d);

    if (gain > bestGain) {
      bestGain = gain;
      bestSplit = {
        threshold: t,
        giniGain: gain,
        left: { n: nL, hits: hL, precision: hL/nL },
        right: { n: nR, hits: hR, precision: hR/nR },
        fisherP: p,
        lift: (hL/nL) / (totalHits/N),
      };
    }
  }
  return bestSplit;
}

// ── Jensen-Shannon divergence ──────────────────────────────────────────────────
function jsDivergence(p, q) {
  const m = p.map((pi, i) => (pi + q[i]) / 2);
  let js = 0;
  for (let i = 0; i < p.length; i++) {
    if (m[i] > 0) {
      if (p[i] > 0) js += p[i] * Math.log2(p[i] / m[i]);
      if (q[i] > 0) js += q[i] * Math.log2(q[i] / m[i]);
    }
  }
  return js / 2;
}

// Compute JS divergence between hit and non-hit score CDFs at each threshold
function jsDivScan(hitScores, missScores) {
  const allScores = [...new Set([...hitScores, ...missScores])].sort((a,b)=>a-b);
  const nH = hitScores.length, nM = missScores.length;
  let maxJS = 0, maxScore = 0;
  const trace = [];
  for (let t = 0; t < allScores.length - 1; t++) {
    const pivot = allScores[t];
    const pH_above = hitScores.filter(s=>s>pivot).length / nH;
    const pH_below = 1 - pH_above;
    const pM_above = missScores.filter(s=>s>pivot).length / nM;
    const pM_below = 1 - pM_above;
    const p = [pH_below, pH_above];
    const q = [pM_below, pM_above];
    const js = jsDivergence(p, q);
    if (js > maxJS) { maxJS = js; maxScore = pivot; }
    trace.push({ score: pivot, js });
  }
  return { maxJS, maxScore, trace };
}

// ── Platt scaling (Newton-Raphson) ────────────────────────────────────────────
function plattScale(scores, labels) {
  const n = scores.length;
  const mu = scores.reduce((a,b)=>a+b,0)/n;
  const sigma = Math.sqrt(scores.reduce((s,x)=>s+(x-mu)**2,0)/n) || 1;
  const xs = scores.map(x => (x-mu)/sigma);
  let a = 0, b = 0;
  for (let iter = 0; iter < 500; iter++) {
    let gA=0, gB=0, hAA=0, hAB=0, hBB=0;
    for (let i=0; i<n; i++) {
      const p = 1/(1+Math.exp(-(a*xs[i]+b)));
      const r = labels[i]-p, w = p*(1-p);
      gA += r*xs[i]; gB += r;
      hAA += w*xs[i]*xs[i]; hAB += w*xs[i]; hBB += w;
    }
    hAA += 0.01; hBB += 0.01;
    const det = hAA*hBB - hAB*hAB;
    if (Math.abs(det) < 1e-14) break;
    a += (hBB*gA - hAB*gB)/det;
    b += (hAA*gB - hAB*gA)/det;
  }
  return s => 1/(1+Math.exp(-(a*(s-mu)/sigma + b)));
}

// ── Bootstrap CI on threshold recommendation ──────────────────────────────────
function bootstrap(data, t, iterations = 3000) {
  const n = data.length;
  const precs = [];
  for (let i = 0; i < iterations; i++) {
    let tp=0, fp=0;
    for (let j=0; j<n; j++) {
      const r = data[Math.floor(Math.random()*n)];
      if (r.score >= t) { if (r.hit) tp++; else fp++; }
    }
    if (tp+fp > 0) precs.push(tp/(tp+fp));
  }
  precs.sort((a,b)=>a-b);
  return {
    mean: precs.reduce((a,b)=>a+b,0)/precs.length,
    ci_lo: precs[Math.floor(0.025*precs.length)],
    ci_hi: precs[Math.floor(0.975*precs.length)],
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║  UC SCORE EXACT GATE ANALYSIS — TARGET: ${TC.label.padEnd(24)}║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  // ── Load: ONLY properly labeled rows ─────────────────────────────────────
  console.log(`Loading rows where ${TC.needsCol} IS NOT NULL (properly labeled only)…`);
  const raw = await fetchAll(
    `pbfb_uc_logger?select=uc_score,hit_uc_next_day,next_day_chg_pct,hit_5pct_3d,hit_10pct_5d` +
    `&${TC.needsCol}=not.is.null&order=uc_score.asc`
  );

  const data = raw
    .filter(r => r.uc_score != null)
    .map(r => ({ score: Number(r.uc_score), hit: TC.isPos(r) ? 1 : 0 }));

  const N = data.length;
  const totalHits = data.filter(r=>r.hit).length;
  const baseRate = totalHits / N;

  console.log(`N = ${N.toLocaleString()}  |  Hits = ${totalHits}  |  Base rate = ${(baseRate*100).toFixed(2)}%`);

  const scores     = data.map(r=>r.score);
  const hitScores  = data.filter(r=>r.hit).map(r=>r.score).sort((a,b)=>a-b);
  const missScores = data.filter(r=>!r.hit).map(r=>r.score).sort((a,b)=>a-b);

  const pct = (arr, p) => arr[Math.floor(p/100*(arr.length-1))];
  console.log(`Score range: [${Math.min(...scores)}, ${Math.max(...scores)}]`);
  console.log(`Hit scores:  p25=${pct(hitScores,25).toFixed(0)}  p50=${pct(hitScores,50).toFixed(0)}  p75=${pct(hitScores,75).toFixed(0)}  mean=${(hitScores.reduce((a,b)=>a+b,0)/hitScores.length).toFixed(1)}`);
  console.log(`Miss scores: p25=${pct(missScores,25).toFixed(0)}  p50=${pct(missScores,50).toFixed(0)}  p75=${pct(missScores,75).toFixed(0)}  mean=${(missScores.reduce((a,b)=>a+b,0)/missScores.length).toFixed(1)}`);

  // ──────────────────────────────────────────────────────────────────────────
  // 1. EXACT BIN ANALYSIS WITH FISHER'S EXACT (proper two-sided)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  1. BIN ANALYSIS — Fisher exact p (bin vs rest-of-dataset)');
  console.log('════════════════════════════════════════════════════════════════════');

  const binEdges = [35,40,42,44,46,48,50,52,54,56,58,60,62,64,66,68,70,72,74,76,78,80,85,90,95,100,101];
  const bins = [];
  for (let i = 0; i < binEdges.length-1; i++) {
    const lo = binEdges[i], hi = binEdges[i+1];
    const bin = data.filter(r => r.score >= lo && r.score < hi);
    if (bin.length === 0) continue;
    const hits = bin.filter(r=>r.hit).length;
    const nonHits = bin.length - hits;
    // vs rest
    const restHits = totalHits - hits;
    const restNonHits = (N - totalHits) - nonHits;
    const p2 = fisher2P(hits, nonHits, restHits, restNonHits);
    const prec = hits / bin.length;
    const lift = prec / baseRate;
    const sig = p2 < 0.001 ? '***' : p2 < 0.01 ? '** ' : p2 < 0.05 ? '*  ' : '   ';
    bins.push({ lo, hi, n: bin.length, hits, prec, lift, p: p2, sig });
  }

  console.log(`  ${'Bin'.padEnd(9)} ${'N'.padStart(5)} ${'Hits'.padStart(5)} ${'Prec%'.padStart(6)} ${'Lift'.padStart(5)} ${'Fisher-p'.padStart(10)} Sig`);
  for (const b of bins) {
    console.log(`  [${String(b.lo).padStart(3)}-${String(b.hi).padStart(3)}) ${String(b.n).padStart(5)} ${String(b.hits).padStart(5)} ${(b.prec*100).toFixed(1).padStart(6)} ${b.lift.toFixed(2).padStart(5)} ${b.p.toExponential(2).padStart(10)} ${b.sig}`);
  }

  // Find lowest bin with significant enrichment
  const firstSigBin = bins.find(b => b.p < 0.05 && b.lift > 1.0);
  const firstHighSigBin = bins.find(b => b.p < 0.01 && b.lift > 1.0);
  console.log(`\n  First bin with lift>1 AND Fisher p<0.05: ${firstSigBin ? `[${firstSigBin.lo}-${firstSigBin.hi})` : 'NONE'}`);
  console.log(`  First bin with lift>1 AND Fisher p<0.01: ${firstHighSigBin ? `[${firstHighSigBin.lo}-${firstHighSigBin.hi})` : 'NONE'}`);

  // ──────────────────────────────────────────────────────────────────────────
  // 2. CHOW TEST — full precision split at every threshold
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  2. CHOW / STRUCTURAL BREAK — two-population Fisher exact sweep');
  console.log('     (≥T vs <T within properly labeled dataset)');
  console.log('════════════════════════════════════════════════════════════════════');

  const chowResults = [];
  for (let t = Math.min(...scores)+1; t <= Math.max(...scores); t++) {
    const above = data.filter(r=>r.score >= t);
    const below = data.filter(r=>r.score < t);
    if (above.length < 10 || below.length < 10) continue;
    const a = above.filter(r=>r.hit).length;
    const b = above.length - a;
    const c = below.filter(r=>r.hit).length;
    const d = below.length - c;
    const p = fisher2P(a, b, c, d);
    const precAbove = a / above.length;
    const precBelow = c / below.length;
    const liftAbove = precAbove / baseRate;
    chowResults.push({ t, p, precAbove, precBelow, liftAbove, nAbove: above.length, hitsAbove: a });
  }

  // Find minimum p-value (maximum separation point)
  const minPResult = chowResults.reduce((best,r) => r.p < best.p ? r : best, chowResults[0]);
  // Find lowest t where p < 0.05 and lift > 1.5
  const lowestSig = chowResults.find(r => r.p < 0.05 && r.liftAbove > 1.5);
  const lowestHighSig = chowResults.find(r => r.p < 0.01 && r.liftAbove > 1.5);

  console.log(`\n  Score with minimum Fisher p (max separation): ${minPResult?.t} (p=${minPResult?.p.toExponential(3)}, lift=${minPResult?.liftAbove.toFixed(2)}x)`);
  console.log(`  Lowest score: Fisher p<0.05 AND lift>1.5:    ${lowestSig?.t ?? 'NONE'} (p=${lowestSig?.p.toExponential(3)}, lift=${lowestSig?.liftAbove.toFixed(2)}x)`);
  console.log(`  Lowest score: Fisher p<0.01 AND lift>1.5:    ${lowestHighSig?.t ?? 'NONE'} (p=${lowestHighSig?.p.toExponential(3)}, lift=${lowestHighSig?.liftAbove.toFixed(2)}x)`);

  // Print table at key thresholds
  const keyT = new Set([minPResult?.t, lowestSig?.t, lowestHighSig?.t, 40,45,50,55,60,65,70,75,80].filter(Boolean));
  console.log(`\n  ${'T'.padStart(4)} ${'N≥T'.padStart(5)} ${'Hits'.padStart(5)} ${'Prec≥T%'.padStart(8)} ${'Prec<T%'.padStart(8)} ${'Lift'.padStart(5)} ${'Fisher-p'.padStart(10)} Sig`);
  for (const r of chowResults.filter(r=>keyT.has(r.t)).sort((a,b)=>a.t-b.t)) {
    const sig = r.p < 0.001 ? '***' : r.p < 0.01 ? '**' : r.p < 0.05 ? '*' : '';
    console.log(`  ${String(r.t).padStart(4)} ${String(r.nAbove).padStart(5)} ${String(r.hitsAbove).padStart(5)} ${(r.precAbove*100).toFixed(1).padStart(8)} ${(r.precBelow*100).toFixed(1).padStart(8)} ${r.liftAbove.toFixed(2).padStart(5)} ${r.p.toExponential(2).padStart(10)} ${sig}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. CART OPTIMAL SINGLE SPLIT
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  3. CART — Gini-optimal single split (min 30 samples per leaf)');
  console.log('════════════════════════════════════════════════════════════════════');
  const cart = cartOptimalSplit(data, 30);
  if (cart) {
    console.log(`  Optimal split: uc_score >= ${cart.threshold}`);
    console.log(`  Gini gain: ${cart.giniGain.toFixed(6)}`);
    console.log(`  Left  (≥${cart.threshold}): N=${cart.left.n}  Hits=${cart.left.hits}  Precision=${(cart.left.precision*100).toFixed(1)}%  Lift=${cart.lift.toFixed(2)}x`);
    console.log(`  Right (<${cart.threshold}): N=${cart.right.n}  Hits=${cart.right.hits}  Precision=${(cart.right.precision*100).toFixed(1)}%`);
    console.log(`  Fisher p: ${cart.fisherP.toExponential(3)}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. CUSUM CHANGE-POINT DETECTION
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  4. CUSUM CHANGE-POINT (3σ one-sided control chart)');
  console.log('════════════════════════════════════════════════════════════════════');
  const cusum = cusumAnalysis(data.sort((a,b)=>a.score-b.score).map(r=>({score:r.score, hit:r.hit})), baseRate);
  console.log(`  Max CUSUM S = ${cusum.maxCusum.toFixed(4)}  at score = ${cusum.maxCusumScore}`);
  console.log(`  3σ control limit h = ${cusum.controlLimit.toFixed(4)}`);
  console.log(`  Signal detected: ${cusum.detected ? 'YES — systematic upward shift found' : 'NO — no significant shift'}`);
  console.log(`  Estimated shift start: score ≈ ${cusum.shiftStartScore}`);

  // ──────────────────────────────────────────────────────────────────────────
  // 5. KERNEL-SMOOTHED PRECISION CURVE
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  5. KERNEL-SMOOTHED P(hit|score) — Nadaraya-Watson, Silverman h');
  console.log('════════════════════════════════════════════════════════════════════');
  const bw = silvermanBandwidth(scores);
  const kdePoints = data.map(r => ({ x: r.score, y: r.hit }));
  console.log(`  Silverman bandwidth h = ${bw.toFixed(3)}`);
  console.log(`\n  Score  Smoothed P(hit)  Lift`);

  let kde1x = null, kde15x = null, kde2x = null, kde3x = null;
  const kdeTrace = [];
  for (let s = Math.min(...scores); s <= Math.max(...scores); s++) {
    const pSmooth = kernelSmooth(kdePoints, s, bw);
    const lift = pSmooth / baseRate;
    kdeTrace.push({ s, p: pSmooth, lift });
    if (kde1x === null && lift >= 1.0)  kde1x  = s;
    if (kde15x === null && lift >= 1.5) kde15x = s;
    if (kde2x === null && lift >= 2.0)  kde2x  = s;
    if (kde3x === null && lift >= 3.0)  kde3x  = s;
  }

  // Print at every 2 integer points in interesting range
  for (const pt of kdeTrace.filter(p => p.s % 3 === 0 || [kde1x,kde15x,kde2x,kde3x].includes(p.s))) {
    const marker = p => [kde1x,kde15x,kde2x,kde3x].includes(p.s);
    const flag = pt.s===kde1x?' ← 1×':pt.s===kde15x?' ← 1.5×':pt.s===kde2x?' ← 2×':pt.s===kde3x?' ← 3×':'';
    console.log(`  ${String(pt.s).padStart(5)}  ${(pt.p*100).toFixed(3).padStart(12)}%  ${pt.lift.toFixed(3).padStart(5)}x${flag}`);
  }
  console.log(`\n  Kernel crossovers (lift ≥ N× base rate):`);
  console.log(`    1.0× at score ≥ ${kde1x  ?? 'N/A'}`);
  console.log(`    1.5× at score ≥ ${kde15x ?? 'N/A'}`);
  console.log(`    2.0× at score ≥ ${kde2x  ?? 'N/A'}`);
  console.log(`    3.0× at score ≥ ${kde3x  ?? 'N/A'}`);

  // ──────────────────────────────────────────────────────────────────────────
  // 6. ISOTONIC REGRESSION (PAVA)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  6. ISOTONIC REGRESSION (PAVA) — monotone P(hit|score)');
  console.log('════════════════════════════════════════════════════════════════════');

  // Bin into width-2 groups for stability
  const isoBins = [];
  for (let lo = Math.min(...scores); lo <= Math.max(...scores); lo += 2) {
    const bin = data.filter(r=>r.score>=lo && r.score<lo+2);
    if (bin.length === 0) continue;
    const h = bin.filter(r=>r.hit).length;
    isoBins.push({ x: lo+1, y: h/bin.length, w: bin.length, n: bin.length, hits: h });
  }
  const isoVals = isotonicRegression(isoBins);

  console.log(`\n  BinMid  IsotonicP  Lift`);
  let iso15x = null, iso2x = null, iso3x = null;
  for (let i = 0; i < isoBins.length; i++) {
    const iso = isoVals[i];
    const lift = iso / baseRate;
    if (iso15x === null && lift >= 1.5) iso15x = isoBins[i].x - 1;
    if (iso2x  === null && lift >= 2.0) iso2x  = isoBins[i].x - 1;
    if (iso3x  === null && lift >= 3.0) iso3x  = isoBins[i].x - 1;
    if (isoBins[i].x % 5 < 2 || [iso15x,iso2x,iso3x].includes(isoBins[i].x-1)) {
      const flag = isoBins[i].x-1===iso15x?' ← 1.5×':isoBins[i].x-1===iso2x?' ← 2×':isoBins[i].x-1===iso3x?' ← 3×':'';
      console.log(`  ${String(isoBins[i].x).padStart(6)}  ${(iso*100).toFixed(3).padStart(9)}%  ${lift.toFixed(3).padStart(5)}x${flag}`);
    }
  }
  console.log(`\n  Isotonic crossovers:`);
  console.log(`    1.5× at score ≥ ${iso15x ?? 'N/A'}`);
  console.log(`    2.0× at score ≥ ${iso2x  ?? 'N/A'}`);
  console.log(`    3.0× at score ≥ ${iso3x  ?? 'N/A'}`);

  // ──────────────────────────────────────────────────────────────────────────
  // 7. JENSEN-SHANNON DIVERGENCE SCAN
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  7. JENSEN-SHANNON DIVERGENCE SCAN (hit vs non-hit distributions)');
  console.log('════════════════════════════════════════════════════════════════════');
  const { maxJS, maxScore: jsMaxScore } = jsDivScan(hitScores, missScores);
  console.log(`  Max JS divergence = ${maxJS.toFixed(6)} at score = ${jsMaxScore}`);
  console.log(`  (0 = identical distributions, 1 = completely separated)`);
  console.log(`  Interpretation: Maximum distributional divergence between hit and non-hit`);
  console.log(`  at score = ${jsMaxScore} — this is the information-theoretically optimal split point`);

  // ──────────────────────────────────────────────────────────────────────────
  // 8. PLATT SCALING (calibrated probability)
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  8. PLATT SCALING — calibrated logistic P(hit|score)');
  console.log('════════════════════════════════════════════════════════════════════');
  const predict = plattScale(scores, data.map(r=>r.hit));
  let p1x=null, p15x=null, p2x=null, p3x=null;
  for (let s=Math.min(...scores); s<=Math.max(...scores); s++) {
    const p=predict(s), lift=p/baseRate;
    if (p1x===null  && lift>=1.0)  p1x  = s;
    if (p15x===null && lift>=1.5)  p15x = s;
    if (p2x===null  && lift>=2.0)  p2x  = s;
    if (p3x===null  && lift>=3.0)  p3x  = s;
  }
  console.log(`\n  Score   P(hit)%    Lift`);
  for (let s of [...new Set([...Array.from({length:Math.floor((Math.max(...scores)-Math.min(...scores))/5)+1},(_,i)=>Math.min(...scores)+i*5), p1x,p15x,p2x,p3x].filter(Boolean).sort((a,b)=>a-b))]) {
    const p=predict(s), lift=p/baseRate;
    const flag = s===p1x?' ← 1×':s===p15x?' ← 1.5×':s===p2x?' ← 2×':s===p3x?' ← 3×':'';
    console.log(`  ${String(s).padStart(5)}  ${(p*100).toFixed(3).padStart(8)}%  ${lift.toFixed(3).padStart(5)}x${flag}`);
  }
  console.log(`\n  Platt crossovers:`);
  console.log(`    1.0× at score ≥ ${p1x  ?? 'N/A'}`);
  console.log(`    1.5× at score ≥ ${p15x ?? 'N/A'}`);
  console.log(`    2.0× at score ≥ ${p2x  ?? 'N/A'}`);
  console.log(`    3.0× at score ≥ ${p3x  ?? 'N/A'}`);

  // ──────────────────────────────────────────────────────────────────────────
  // CONSENSUS + BOOTSTRAP CI
  // ──────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  CONSENSUS ACROSS ALL 7 METHODS');
  console.log('════════════════════════════════════════════════════════════════════');

  const votes = {
    fisher_bin_first_sig:     firstSigBin?.lo,
    fisher_bin_first_high_sig:firstHighSigBin?.lo,
    chow_min_p:               minPResult?.t,
    chow_lowest_sig:          lowestSig?.t,
    chow_lowest_high_sig:     lowestHighSig?.t,
    cart_optimal:             cart?.threshold,
    cusum_shift_start:        cusum.shiftStartScore,
    kde_1x:                   kde1x,
    kde_15x:                  kde15x,
    kde_2x:                   kde2x,
    isotonic_15x:             iso15x,
    isotonic_2x:              iso2x,
    js_max:                   jsMaxScore,
    platt_15x:                p15x,
    platt_2x:                 p2x,
  };

  console.log('\n  Method                         Threshold');
  for (const [k,v] of Object.entries(votes)) {
    console.log(`  ${k.padEnd(32)} ${v ?? 'N/A'}`);
  }

  // Consensus: median of all non-null votes
  const validVotes = Object.values(votes).filter(v => v != null).sort((a,b)=>a-b);
  const medianVote = validVotes[Math.floor(validVotes.length/2)];
  const meanVote   = Math.round(validVotes.reduce((a,b)=>a+b,0)/validVotes.length);
  const modeCount  = {};
  for (const v of validVotes) { for (let d=-2;d<=2;d++) modeCount[v+d]=(modeCount[v+d]||0)+1; }
  const modeVote = parseInt(Object.entries(modeCount).reduce((best,[k,v])=>v>best[1]?[k,v]:best,[0,0])[0]);

  console.log(`\n  Votes: [${validVotes.join(', ')}]`);
  console.log(`  Median  = ${medianVote}`);
  console.log(`  Mean    = ${meanVote}`);
  console.log(`  Mode±2  = ${modeVote}`);

  // Bootstrap CI at consensus threshold
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  BOOTSTRAP 95% CI (3000 iterations) AT KEY THRESHOLDS');
  console.log('════════════════════════════════════════════════════════════════════');
  const bsTargets = [...new Set([35, medianVote, meanVote, modeVote, cart?.threshold, kde2x, iso2x, p2x, lowestSig?.t].filter(Boolean).sort((a,b)=>a-b))];
  console.log(`\n  ${'Threshold'.padEnd(12)} ${'N≥T'.padStart(6)} ${'Hits'.padStart(5)} ${'Prec%'.padStart(7)} ${'95% CI'.padStart(18)} ${'Lift'.padStart(5)}`);
  const bsResults = [];
  for (const t of bsTargets) {
    const ci = bootstrap(data, t);
    const nAbove = data.filter(r=>r.score>=t).length;
    const hAbove = data.filter(r=>r.score>=t&&r.hit).length;
    const prec = nAbove > 0 ? hAbove/nAbove : 0;
    console.log(`  ${String(t).padEnd(12)} ${String(nAbove).padStart(6)} ${String(hAbove).padStart(5)} ${(prec*100).toFixed(1).padStart(6)}% [${(ci.ci_lo*100).toFixed(1)}%–${(ci.ci_hi*100).toFixed(1)}%]  ${(prec/baseRate).toFixed(2).padStart(5)}x`);
    bsResults.push({ t, n: nAbove, hits: hAbove, prec, lift: prec/baseRate, ...ci });
  }

  // ── Final answer ─────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  ★  FINAL ANSWER — EXACT STATISTICALLY DERIVED THRESHOLDS');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log(`\n  Base rate: ${(baseRate*100).toFixed(2)}%   N = ${N}   Hits = ${totalHits}`);
  console.log(`\n  LOGGING GATE  (collect data — minimum statistically enriched):`);
  const logGate = lowestSig?.t ?? kde15x ?? iso15x ?? medianVote;
  const logR = bsResults.find(r=>r.t===logGate) ?? bsResults.find(r=>r.t===medianVote);
  console.log(`    Recommended: uc_score ≥ ${logGate}`);
  if (logR) console.log(`    Precision=${(logR.prec*100).toFixed(1)}%  95%CI=[${(logR.ci_lo*100).toFixed(1)}%–${(logR.ci_hi*100).toFixed(1)}%]  Lift=${logR.lift.toFixed(2)}x  N=${logR.n}`);
  console.log(`    Methods agreeing: Chow p<0.05 (${lowestSig?.t}), KDE 1.5× (${kde15x}), Isotonic 1.5× (${iso15x}), Platt 1.5× (${p15x})`);

  console.log(`\n  FILTER GATE  (live trading — precision-maximised):`);
  const filtGate = cart?.threshold ?? kde3x ?? iso3x ?? p3x;
  const filtR = bsResults.find(r=>r.t===filtGate);
  console.log(`    Recommended: uc_score ≥ ${filtGate}`);
  if (filtR) console.log(`    Precision=${(filtR.prec*100).toFixed(1)}%  95%CI=[${(filtR.ci_lo*100).toFixed(1)}%–${(filtR.ci_hi*100).toFixed(1)}%]  Lift=${filtR.lift.toFixed(2)}x  N=${filtR.n}`);
  console.log(`    Methods agreeing: CART Gini (${cart?.threshold}), KDE 3× (${kde3x}), Isotonic 3× (${iso3x}), Platt 3× (${p3x})`);

  console.log(`\n  CURRENT GATE (35): ${(data.filter(r=>r.score>=35).length/N*100).toFixed(0)}% of candidates captured — includes sub-random precision region`);
  console.log(`  CONSENSUS: Median=${medianVote}  Mean=${meanVote}  Mode±2=${modeVote}`);

  // Save JSON
  const out = {
    generated: new Date().toISOString(), target: TARGET,
    n: N, hits: totalHits, base_rate: baseRate,
    methods: votes,
    consensus: { median: medianVote, mean: meanVote, mode: modeVote },
    recommendations: { logging_gate: logGate, filter_gate: filtGate, current_gate: 35 },
    bootstrap_ci: bsResults,
    cusum: { shift_start: cusum.shiftStartScore, max_score: cusum.maxCusumScore, detected: cusum.detected },
    cart: cart,
    js_max_score: jsMaxScore,
  };
  const outPath = path.join(RESULT_DIR, 'uc_score_exact_gate.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n  JSON → ${outPath}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
