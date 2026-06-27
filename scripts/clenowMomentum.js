// CLENOW MOMENTUM RANKING — Exponential Regression Slope × R²
// Andreas Clenow "Stocks on the Move" methodology
// Tests on My Portfolio 28 stocks
//
// The idea: Rank stocks by QUALITY-ADJUSTED momentum
//   Slope = how fast is the stock rising (annualized %)
//   R² = how SMOOTH is the rise (0-1, higher = smoother trend)
//   Score = Slope × R² → penalizes choppy risers, rewards smooth trends
//
// A stock rising 20% in a smooth line gets HIGHER score than
// one rising 20% with wild 5% daily swings

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/My Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS'));
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6)continue;const[date,o,h,lo,cl,v]=p;const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};if(!M.hasOwnProperty(m))continue;c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}

// Compute exponential regression on log(price) over N days
function computeClenow(candles, endIdx, lookback) {
  if (endIdx < lookback || endIdx >= candles.length) return { slope: 0, r2: 0, score: 0, annualizedReturn: 0 };
  const n = lookback;
  const logPrices = [];
  for (let i = endIdx - n + 1; i <= endIdx; i++) {
    if (candles[i].c <= 0) return { slope: 0, r2: 0, score: 0, annualizedReturn: 0 };
    logPrices.push(Math.log(candles[i].c));
  }
  // Linear regression on log(price) vs time index
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += logPrices[i]; sumXY += i * logPrices[i]; sumX2 += i * i; sumY2 += logPrices[i] * logPrices[i];
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, r2: 0, score: 0, annualizedReturn: 0 };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  // R² calculation
  const yMean = sumY / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const yPred = intercept + slope * i;
    ssRes += (logPrices[i] - yPred) ** 2;
    ssTot += (logPrices[i] - yMean) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  // Annualized return: slope per day × 252 trading days, converted from log
  const annualizedReturn = (Math.exp(slope * 252) - 1) * 100;
  // Clenow score = annualized return × R²
  const score = annualizedReturn * r2;
  return { slope, r2: Math.max(0, Math.min(1, r2)), score, annualizedReturn };
}

console.log('█'.repeat(85));
console.log('  CLENOW MOMENTUM RANKING — Exp Regression Slope × R²');
console.log('  "Stocks on the Move" methodology on 28 Portfolio Stocks');
console.log('█'.repeat(85));

// ═══ PART 1: Current Clenow scores for all stocks ═══
console.log('\n═══ PART 1: CURRENT CLENOW RANKINGS (90-day lookback) ═══\n');
const currentRankings = [];
for (const file of files) {
  const c = parseCSV(path.join(DIR, file)); if (c.length < 100) continue;
  const sym = file.replace('_NS_OHLCV.csv', '');
  const clenow90 = computeClenow(c, c.length - 1, 90);
  const clenow125 = computeClenow(c, c.length - 1, 125);
  const clenow250 = computeClenow(c, c.length - 1, 250);
  currentRankings.push({ sym, ...clenow90, score90: clenow90.score, score125: clenow125.score, score250: clenow250.score, r2_90: clenow90.r2, r2_125: clenow125.r2, ann90: clenow90.annualizedReturn });
}
currentRankings.sort((a, b) => b.score - a.score);
console.log('  Rank │ Symbol       │ Clenow Score │ Ann. Return │ R²    │ 125d Score │ 250d Score │ Quality');
console.log('  ─────┼──────────────┼──────────────┼─────────────┼───────┼────────────┼────────────┼────────');
for (let i = 0; i < currentRankings.length; i++) {
  const r = currentRankings[i];
  const quality = r.r2 >= 0.7 ? 'SMOOTH' : r.r2 >= 0.4 ? 'MODERATE' : 'CHOPPY';
  console.log(`  ${String(i + 1).padStart(4)} │ ${r.sym.padEnd(12)} │ ${r.score.toFixed(1).padStart(12)} │ ${(r.ann90 >= 0 ? '+' : '') + r.ann90.toFixed(1).padStart(10)}% │ ${r.r2.toFixed(2).padStart(5)} │ ${r.score125.toFixed(1).padStart(10)} │ ${r.score250.toFixed(1).padStart(10)} │ ${quality}`);
}

// ═══ PART 2: Does Clenow score predict future returns? ═══
console.log('\n═══ PART 2: DOES CLENOW SCORE PREDICT FUTURE RETURNS? ═══\n');
const ALL = [];
for (const file of files) {
  const c = parseCSV(path.join(DIR, file)); if (c.length < 120) continue;
  const sym = file.replace('_NS_OHLCV.csv', '');
  for (let i = 90; i < c.length - 21; i++) {
    const clenow = computeClenow(c, i, 90);
    // Future returns
    let mfe10 = 0, mfe20 = 0, ret10 = 0, ret20 = 0;
    for (let d = i + 1; d <= Math.min(i + 10, c.length - 1); d++) {
      const pH = (c[d].h - c[i].c) / c[i].c * 100;
      if (pH > mfe10) mfe10 = pH;
    }
    for (let d = i + 1; d <= Math.min(i + 20, c.length - 1); d++) {
      const pH = (c[d].h - c[i].c) / c[i].c * 100;
      if (pH > mfe20) mfe20 = pH;
    }
    ret10 = c.length > i + 10 ? (c[i + 10].c - c[i].c) / c[i].c * 100 : 0;
    ret20 = c.length > i + 20 ? (c[i + 20].c - c[i].c) / c[i].c * 100 : 0;
    const h5 = mfe10 >= 5;
    ALL.push({ sym, score: clenow.score, r2: clenow.r2, annReturn: clenow.annualizedReturn, mfe10, mfe20, ret10, ret20, h5 });
  }
}
console.log(`  Total data points: ${ALL.length}\n`);

// Score buckets
console.log('  Clenow Score  │ Count  │ +5% Hit │ Avg MFE10 │ Avg Ret10 │ Avg Ret20 │ Signal');
console.log('  ──────────────┼────────┼─────────┼───────────┼───────────┼───────────┼───────');
for (const [lo, hi, label] of [[-999, -20, 'Strong negative'], [-20, 0, 'Mild negative'], [0, 20, 'Mild positive'], [20, 50, 'Moderate'], [50, 100, 'Strong'], [100, 200, 'Very strong'], [200, 9999, 'Extreme']]) {
  const grp = ALL.filter(a => a.score >= lo && a.score < hi);
  if (grp.length < 100) continue;
  const h5 = grp.filter(a => a.h5).length;
  const avgMfe = grp.reduce((s, a) => s + a.mfe10, 0) / grp.length;
  const avgRet10 = grp.reduce((s, a) => s + a.ret10, 0) / grp.length;
  const avgRet20 = grp.reduce((s, a) => s + a.ret20, 0) / grp.length;
  const signal = avgRet10 > 1 ? 'BULLISH' : avgRet10 > 0 ? 'Neutral' : 'BEARISH';
  console.log(`  ${label.padEnd(14)} │ ${String(grp.length).padStart(6)} │ ${(h5 / grp.length * 100).toFixed(1).padStart(6)}% │ ${('+' + avgMfe.toFixed(1) + '%').padStart(9)} │ ${(avgRet10 >= 0 ? '+' : '') + avgRet10.toFixed(2).padStart(8)}% │ ${(avgRet20 >= 0 ? '+' : '') + avgRet20.toFixed(2).padStart(8)}% │ ${signal}`);
}

// ═══ PART 3: R² quality — does smoothness matter? ═══
console.log('\n═══ PART 3: R² (SMOOTHNESS) — Does trend quality predict success? ═══\n');
console.log('  R² Range      │ Count  │ +5% Hit │ Avg MFE10 │ Avg Ret20 │ Meaning');
console.log('  ──────────────┼────────┼─────────┼───────────┼───────────┼────────');
for (const [lo, hi, label, meaning] of [[0, 0.2, '<0.2 (random)', 'No trend'], [0.2, 0.4, '0.2-0.4', 'Weak trend'], [0.4, 0.6, '0.4-0.6', 'Moderate trend'], [0.6, 0.8, '0.6-0.8', 'Strong trend'], [0.8, 1.01, '0.8-1.0', 'Very smooth trend']]) {
  const grp = ALL.filter(a => a.r2 >= lo && a.r2 < hi);
  if (grp.length < 100) continue;
  const h5 = grp.filter(a => a.h5).length;
  const avgMfe = grp.reduce((s, a) => s + a.mfe10, 0) / grp.length;
  const avgRet20 = grp.reduce((s, a) => s + a.ret20, 0) / grp.length;
  console.log(`  ${label.padEnd(14)} │ ${String(grp.length).padStart(6)} │ ${(h5 / grp.length * 100).toFixed(1).padStart(6)}% │ ${('+' + avgMfe.toFixed(1) + '%').padStart(9)} │ ${(avgRet20 >= 0 ? '+' : '') + avgRet20.toFixed(2).padStart(8)}% │ ${meaning}`);
}

// ═══ PART 4: Clenow + our screener signals ═══
console.log('\n═══ PART 4: CLENOW ON OUR BREAKOUT SIGNALS — Does it enhance? ═══\n');
// For each breakout signal, what was the Clenow score at entry?
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

const breakouts = [];
for (const file of files) {
  const c = parseCSV(path.join(DIR, file)); if (c.length < 120) continue;
  const sym = file.replace('_NS_OHLCV.csv', ''), a = atr14(c);
  for (let i = 90; i < c.length - 11; i++) {
    const s = c[i]; if (s.c <= 0 || a[i] <= 0) continue; const r = s.h - s.l; if (r <= 0) continue;
    let bZ = null; for (let zL = 25; zL >= 4; zL--) { const zS = i - zL; if (zS < 1) continue; let zH = -Infinity, zLo = Infinity, ok = true; for (let j = zS; j < i; j++) { zH = Math.max(zH, c[j].h); zLo = Math.min(zLo, c[j].l); if ((c[j].h - c[j].l) / (a[j] || 1) > 1.0) ok = false; } if (!ok) continue; bZ = { zH, zL: zLo }; break; }
    if (!bZ || s.c <= bZ.zH * 1.001) continue;
    const clenow = computeClenow(c, i, 90);
    let mfe = 0, h5 = false;
    for (let d = i + 1; d <= Math.min(i + 10, c.length - 1); d++) {
      const pH = (c[d].h - s.c) / s.c * 100;
      if (pH > mfe) mfe = pH; if (pH >= 5) h5 = true;
    }
    breakouts.push({ sym, score: clenow.score, r2: clenow.r2, annReturn: clenow.annualizedReturn, mfe, h5 });
  }
}
console.log(`  Total breakout signals: ${breakouts.length}\n`);
console.log('  Clenow at entry │ Breakouts │ +5% Hit │ Avg MFE │ Enhancement?');
console.log('  ────────────────┼───────────┼─────────┼─────────┼─────────────');
const baseHitRate = breakouts.filter(b => b.h5).length / breakouts.length * 100;
for (const [lo, hi, label] of [[-999, 0, 'Negative (<0)'], [0, 30, 'Low (0-30)'], [30, 60, 'Medium (30-60)'], [60, 100, 'High (60-100)'], [100, 9999, 'Very high (100+)']]) {
  const grp = breakouts.filter(b => b.score >= lo && b.score < hi);
  if (grp.length < 10) continue;
  const h5 = grp.filter(b => b.h5).length;
  const rate = h5 / grp.length * 100;
  const avgMfe = grp.reduce((s, b) => s + b.mfe, 0) / grp.length;
  const enhance = rate > baseHitRate + 3 ? '★ YES' : rate > baseHitRate ? 'Slight' : 'No';
  console.log(`  ${label.padEnd(16)} │ ${String(grp.length).padStart(9)} │ ${rate.toFixed(1).padStart(6)}% │ ${('+' + avgMfe.toFixed(1) + '%').padStart(7)} │ ${enhance}`);
}

// ═══ PART 5: Correlation — Clenow score vs breakout MFE ═══
console.log('\n═══ PART 5: CORRELATION — Does Clenow score predict breakout MFE? ═══\n');
const n2 = breakouts.length;
let sX = 0, sY = 0, sXY = 0, sX2 = 0, sY2 = 0;
for (const b of breakouts) { sX += b.score; sY += b.mfe; sXY += b.score * b.mfe; sX2 += b.score * b.score; sY2 += b.mfe * b.mfe; }
const corr = (n2 * sXY - sX * sY) / Math.sqrt((n2 * sX2 - sX * sX) * (n2 * sY2 - sY * sY));
console.log(`  Pearson correlation (Clenow score vs breakout MFE): ${corr.toFixed(4)}`);
console.log(`  Interpretation: ${Math.abs(corr) > 0.3 ? 'MODERATE' : Math.abs(corr) > 0.15 ? 'WEAK' : 'NEGLIGIBLE'}`);

// ═══ PART 6: Optimal Clenow threshold as screener filter ═══
console.log('\n═══ PART 6: OPTIMAL CLENOW THRESHOLD FOR SCREENER ═══\n');
console.log('  Threshold      │ Pass │ +5% Hits │ Hit Rate │ Avg MFE │ ΔRate │ Worth it?');
console.log('  ───────────────┼──────┼──────────┼──────────┼─────────┼───────┼──────────');
for (const thr of [-50, 0, 20, 40, 60, 80, 100]) {
  const pass = breakouts.filter(b => b.score >= thr);
  const hits = pass.filter(b => b.h5).length;
  const rate = pass.length > 0 ? hits / pass.length * 100 : 0;
  const avgMfe = pass.length > 0 ? pass.reduce((s, b) => s + b.mfe, 0) / pass.length : 0;
  const delta = rate - baseHitRate;
  const worth = delta > 5 ? '★ YES' : delta > 2 ? 'Maybe' : 'No';
  console.log(`  Score ≥ ${String(thr).padStart(4)}    │ ${String(pass.length).padStart(4)} │ ${String(hits).padStart(8)} │ ${rate.toFixed(1).padStart(7)}% │ ${('+' + avgMfe.toFixed(1) + '%').padStart(7)} │ ${(delta >= 0 ? '+' : '') + delta.toFixed(1).padStart(5)}% │ ${worth}`);
}

// ═══ PART 7: Multi-timeframe Clenow ═══
console.log('\n═══ PART 7: MULTI-TIMEFRAME CLENOW — Which lookback is best? ═══\n');
for (const lookback of [50, 90, 125, 200]) {
  const lb = [];
  for (const file of files) {
    const c = parseCSV(path.join(DIR, file)); if (c.length < lookback + 30) continue;
    const sym = file.replace('_NS_OHLCV.csv', ''), a = atr14(c);
    for (let i = lookback; i < c.length - 11; i++) {
      const s = c[i]; if (s.c <= 0 || a[i] <= 0) continue; const r = s.h - s.l; if (r <= 0) continue;
      let bZ = null; for (let zL = 25; zL >= 4; zL--) { const zS = i - zL; if (zS < 1) continue; let zH = -Infinity, zLo = Infinity, ok = true; for (let j = zS; j < i; j++) { zH = Math.max(zH, c[j].h); zLo = Math.min(zLo, c[j].l); if ((c[j].h - c[j].l) / (a[j] || 1) > 1.0) ok = false; } if (!ok) continue; bZ = { zH }; break; }
      if (!bZ || s.c <= bZ.zH * 1.001) continue;
      const cl = computeClenow(c, i, lookback);
      let mfe = 0, h5 = false;
      for (let d = i + 1; d <= Math.min(i + 10, c.length - 1); d++) { const pH = (c[d].h - s.c) / s.c * 100; if (pH > mfe) mfe = pH; if (pH >= 5) h5 = true; }
      lb.push({ score: cl.score, h5, mfe });
    }
  }
  // Correlation
  let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
  for (const b of lb) { sx += b.score; sy += b.mfe; sxy += b.score * b.mfe; sx2 += b.score ** 2; sy2 += b.mfe ** 2; }
  const cr = lb.length > 2 ? (lb.length * sxy - sx * sy) / Math.sqrt((lb.length * sx2 - sx * sx) * (lb.length * sy2 - sy * sy)) : 0;
  const topQ = lb.filter(b => b.score >= lb.sort((a, c) => c.score - a.score)[Math.floor(lb.length * 0.25)]?.score);
  const topHit = topQ.length > 0 ? topQ.filter(b => b.h5).length / topQ.length * 100 : 0;
  console.log(`  ${lookback}d lookback: ${lb.length} breakouts, corr ${cr.toFixed(3)}, top-25% hit rate ${topHit.toFixed(1)}% (base ${(lb.filter(b => b.h5).length / lb.length * 100).toFixed(1)}%)`);
}

// ═══ VERDICT ═══
console.log(`\n${'█'.repeat(85)}`);
console.log('  VERDICT: Should Clenow momentum ranking be added?');
console.log('█'.repeat(85));
console.log(`
  Correlation with breakout MFE: ${corr.toFixed(4)} — ${Math.abs(corr) > 0.15 ? 'weak but present' : 'negligible'}
  Enhancement on breakout hit rate: ${(breakouts.filter(b => b.score >= 60 && b.h5).length / Math.max(breakouts.filter(b => b.score >= 60).length, 1) * 100).toFixed(1)}% for score≥60 vs ${baseHitRate.toFixed(1)}% baseline
  Best use: NOT as a filter (kills too many signals) but as a RANKING BADGE

  RECOMMENDATION: Add Clenow score as a column in the screener
  - Show "Clenow: 85 (R²: 0.72)" in the Momentum tab
  - Use for PRIORITIZATION: when multiple signals fire, trade the one
    with the highest Clenow score first (smoothest, strongest trend)
  - NOT as a filter (would reduce signal count without improving hit rate)
`);
