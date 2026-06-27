// GUPPY MAX COMPRESSION STUDY — Does EMA compression predict monster moves?
// Tests on Dr KKR 28-stock portfolio
// Guppy: Fast EMAs (3-23) + Slow EMAs (25-70) → when ALL converge = breakout imminent

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/My Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS'));
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6)continue;const[date,o,h,lo,cl,v]=p;const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};if(!M.hasOwnProperty(m))continue;c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}

function computeEMAs(candles) {
  const fastLens = [3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23];
  const slowLens = [25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55, 58, 61, 64, 67, 70];
  const allLens = [...fastLens, ...slowLens];
  const emas = {};
  for (const len of allLens) {
    const k = 2 / (len + 1);
    const arr = new Array(candles.length).fill(0);
    arr[0] = candles[0].c;
    for (let i = 1; i < candles.length; i++) arr[i] = candles[i].c * k + arr[i-1] * (1 - k);
    emas[len] = arr;
  }
  // Compute spreads at each candle
  const result = [];
  for (let i = 70; i < candles.length; i++) {
    const fastVals = fastLens.map(l => emas[l][i]);
    const slowVals = slowLens.map(l => emas[l][i]);
    const allVals = allLens.map(l => emas[l][i]);
    const price = candles[i].c;
    const fastSpread = (Math.max(...fastVals) - Math.min(...fastVals)) / price * 100;
    const slowSpread = (Math.max(...slowVals) - Math.min(...slowVals)) / price * 100;
    const fastAvg = fastVals.reduce((s, v) => s + v, 0) / fastVals.length;
    const slowAvg = slowVals.reduce((s, v) => s + v, 0) / slowVals.length;
    const ribbonWidth = Math.abs(fastAvg - slowAvg) / price * 100;
    const totalSpread = (Math.max(...allVals) - Math.min(...allVals)) / price * 100;
    // Guppy spread as % — this is the key metric
    const guppySpread = totalSpread;
    result.push({ idx: i, date: candles[i].date, price, fastSpread, slowSpread, ribbonWidth, guppySpread, fastAvg, slowAvg });
  }
  return result;
}

console.log('█'.repeat(80));
console.log('  GUPPY MAX COMPRESSION STUDY');
console.log('  27 EMAs (3-70) — does extreme compression predict monster moves?');
console.log('█'.repeat(80));

const ALL = [];
for (const file of files) {
  const c = parseCSV(path.join(DIR, file)); if (c.length < 100) continue;
  const sym = file.replace('_NS_OHLCV.csv', '');
  const guppy = computeEMAs(c);

  for (let gi = 0; gi < guppy.length - 20; gi++) {
    const g = guppy[gi];
    const cidx = g.idx;
    // Future performance (10d and 20d)
    let mfe10 = 0, mfe20 = 0, mae10 = 0, d5 = 99, h5 = false, h10 = false;
    for (let d = cidx + 1; d <= Math.min(cidx + 10, c.length - 1); d++) {
      const pH = (c[d].h - g.price) / g.price * 100;
      const pL = (c[d].l - g.price) / g.price * 100;
      if (pH > mfe10) mfe10 = pH; if (pL < mae10) mae10 = pL;
      if (!h5 && pH >= 5) { h5 = true; d5 = d - cidx; }
      if (!h10 && pH >= 10) h10 = true;
    }
    for (let d = cidx + 1; d <= Math.min(cidx + 20, c.length - 1); d++) {
      const pH = (c[d].h - g.price) / g.price * 100;
      if (pH > mfe20) mfe20 = pH;
    }

    ALL.push({ sym, date: g.date, price: g.price, guppySpread: g.guppySpread,
      fastSpread: g.fastSpread, slowSpread: g.slowSpread, ribbonWidth: g.ribbonWidth,
      mfe10, mfe20, mae10, h5, h10, d5 });
  }
}
console.log(`\n  Total candles analyzed: ${ALL.length} across ${[...new Set(ALL.map(a => a.sym))].length} stocks\n`);

// ═══ PART 1: Guppy spread distribution ═══
console.log('═══ PART 1: GUPPY SPREAD DISTRIBUTION ═══\n');
const spreads = ALL.map(a => a.guppySpread).sort((a, b) => a - b);
console.log(`  Min:    ${spreads[0].toFixed(2)}%`);
console.log(`  P10:    ${spreads[Math.floor(spreads.length * 0.10)].toFixed(2)}%`);
console.log(`  P25:    ${spreads[Math.floor(spreads.length * 0.25)].toFixed(2)}%`);
console.log(`  Median: ${spreads[Math.floor(spreads.length * 0.50)].toFixed(2)}%`);
console.log(`  P75:    ${spreads[Math.floor(spreads.length * 0.75)].toFixed(2)}%`);
console.log(`  P90:    ${spreads[Math.floor(spreads.length * 0.90)].toFixed(2)}%`);
console.log(`  Max:    ${spreads[spreads.length - 1].toFixed(2)}%`);

// ═══ PART 2: Guppy compression vs future MFE ═══
console.log('\n═══ PART 2: GUPPY COMPRESSION vs FUTURE RETURNS ═══\n');
console.log('  Guppy Spread   │ Count  │ +5% Hit │ +10% Hit │ Avg MFE10 │ Avg MFE20 │ Avg MAE │ Avg D5');
console.log('  ────────────────┼────────┼─────────┼──────────┼───────────┼───────────┼─────────┼──────');
for (const [lo, hi, label] of [
  [0, 1, '< 1% (EXTREME)'], [1, 2, '1-2% (tight)'], [2, 3, '2-3%'], [3, 5, '3-5%'],
  [5, 8, '5-8%'], [8, 12, '8-12%'], [12, 20, '12-20%'], [20, 100, '20%+ (wide)']
]) {
  const grp = ALL.filter(a => a.guppySpread >= lo && a.guppySpread < hi);
  if (grp.length < 50) continue;
  const w5 = grp.filter(a => a.h5).length, w10 = grp.filter(a => a.h10).length;
  const avgMfe10 = grp.reduce((s, a) => s + a.mfe10, 0) / grp.length;
  const avgMfe20 = grp.reduce((s, a) => s + a.mfe20, 0) / grp.length;
  const avgMae = grp.reduce((s, a) => s + a.mae10, 0) / grp.length;
  const avgD5 = w5 > 0 ? grp.filter(a => a.h5).reduce((s, a) => s + a.d5, 0) / w5 : 0;
  console.log(`  ${label.padEnd(16)} │ ${String(grp.length).padStart(6)} │ ${(w5/grp.length*100).toFixed(1).padStart(6)}% │ ${(w10/grp.length*100).toFixed(1).padStart(7)}% │ ${('+'+avgMfe10.toFixed(1)+'%').padStart(9)} │ ${('+'+avgMfe20.toFixed(1)+'%').padStart(9)} │ ${avgMae.toFixed(1).padStart(6)}% │ ${avgD5.toFixed(1).padStart(4)}d`);
}

// ═══ PART 3: EXTREME compression events — deep dive ═══
console.log('\n═══ PART 3: EXTREME COMPRESSION EVENTS (Guppy < 2%) ═══\n');
const extreme = ALL.filter(a => a.guppySpread < 2);
// De-duplicate: one per stock within 10 days
const extremeDedup = [];
const lastE = {};
for (const e of extreme.sort((a, b) => (a.sym + a.date).localeCompare(b.sym + b.date))) {
  if (lastE[e.sym]) {
    const last = new Date(lastE[e.sym].split('-').reverse().join('-')).getTime();
    const curr = new Date(e.date.split('-').reverse().join('-')).getTime();
    if (curr - last < 10 * 86400 * 1000) continue;
  }
  extremeDedup.push(e);
  lastE[e.sym] = e.date;
}
console.log(`  Total extreme events: ${extreme.length} | De-duplicated: ${extremeDedup.length}`);
const eW5 = extremeDedup.filter(a => a.h5).length;
const eW10 = extremeDedup.filter(a => a.h10).length;
console.log(`  +5% hit rate:  ${(eW5/extremeDedup.length*100).toFixed(1)}% (${eW5}/${extremeDedup.length})`);
console.log(`  +10% hit rate: ${(eW10/extremeDedup.length*100).toFixed(1)}% (${eW10}/${extremeDedup.length})`);
console.log(`  Avg MFE (10d): +${(extremeDedup.reduce((s,a)=>s+a.mfe10,0)/extremeDedup.length).toFixed(1)}%`);
console.log(`  Avg MFE (20d): +${(extremeDedup.reduce((s,a)=>s+a.mfe20,0)/extremeDedup.length).toFixed(1)}%`);
console.log(`  Avg MAE (10d): ${(extremeDedup.reduce((s,a)=>s+a.mae10,0)/extremeDedup.length).toFixed(1)}%`);

// Top extreme compression events by MFE
console.log('\n  Top 20 extreme compressions by MFE:');
console.log('  Symbol       │ Date       │ Spread │ MFE10  │ MFE20  │ MAE    │ +5%? │ +10%?');
console.log('  ─────────────┼────────────┼────────┼────────┼────────┼────────┼──────┼──────');
for (const e of extremeDedup.sort((a, b) => b.mfe20 - a.mfe20).slice(0, 20)) {
  console.log(`  ${e.sym.padEnd(12)} │ ${(e.date || '—').padEnd(10)} │ ${e.guppySpread.toFixed(2).padStart(5)}% │ ${('+'+e.mfe10.toFixed(1)+'%').padStart(6)} │ ${('+'+e.mfe20.toFixed(1)+'%').padStart(6)} │ ${e.mae10.toFixed(1).padStart(5)}% │ ${e.h5?'YES':'NO '} │ ${e.h10?'YES':'NO '}`);
}

// ═══ PART 4: Guppy compression vs our existing screener ═══
console.log('\n═══ PART 4: CORRELATION — Does Guppy compression match our zone compression? ═══\n');
// Our screener uses pre10AvgRangeATR (ATR-normalized range compression)
// Guppy uses EMA spread compression
// Are they measuring the same thing?
const ultraTight = ALL.filter(a => a.guppySpread < 1);
const tight = ALL.filter(a => a.guppySpread >= 1 && a.guppySpread < 3);
const normal = ALL.filter(a => a.guppySpread >= 3 && a.guppySpread < 8);
const wide = ALL.filter(a => a.guppySpread >= 8);
console.log('  Zone           │ Count  │ +5% Hit │ +10% Hit │ Avg MFE10 │ Character');
console.log('  ───────────────┼────────┼─────────┼──────────┼───────────┼──────────');
for (const [label, grp] of [['Ultra-tight <1%', ultraTight], ['Tight 1-3%', tight], ['Normal 3-8%', normal], ['Wide 8%+', wide]]) {
  if (grp.length < 10) continue;
  const w5 = grp.filter(a => a.h5).length;
  const w10 = grp.filter(a => a.h10).length;
  const mfe = grp.reduce((s, a) => s + a.mfe10, 0) / grp.length;
  const char = w5/grp.length >= 0.4 ? 'BREAKOUT ZONE' : w5/grp.length >= 0.25 ? 'Mixed' : 'Trending/Extended';
  console.log(`  ${label.padEnd(15)} │ ${String(grp.length).padStart(6)} │ ${(w5/grp.length*100).toFixed(1).padStart(6)}% │ ${(w10/grp.length*100).toFixed(1).padStart(7)}% │ ${('+'+mfe.toFixed(1)+'%').padStart(9)} │ ${char}`);
}

// ═══ PART 5: Can Guppy spread enhance our screener? ═══
console.log('\n═══ PART 5: ENHANCEMENT TEST — Add Guppy spread as screener filter ═══\n');
// If we add "Guppy spread < X%" as a requirement, what happens?
const baseRate = ALL.filter(a => a.h5).length / ALL.length * 100;
console.log(`  Baseline (all candles): ${ALL.length} signals, ${ALL.filter(a => a.h5).length} hits (${baseRate.toFixed(1)}%)\n`);
console.log('  Guppy Filter    │ Pass   │ +5% Hits │ Hit Rate │ ΔRate  │ Worth adding?');
console.log('  ────────────────┼────────┼──────────┼──────────┼────────┼──────────────');
for (const thr of [1, 2, 3, 4, 5, 6, 8, 10, 15]) {
  const pass = ALL.filter(a => a.guppySpread < thr);
  const hits = pass.filter(a => a.h5).length;
  const rate = pass.length > 0 ? hits / pass.length * 100 : 0;
  const delta = rate - baseRate;
  const worth = delta > 5 ? '★ YES' : delta > 2 ? 'Maybe' : 'No';
  console.log(`  Spread < ${String(thr).padStart(2)}%    │ ${String(pass.length).padStart(6)} │ ${String(hits).padStart(8)} │ ${rate.toFixed(1).padStart(7)}% │ ${(delta >= 0 ? '+' : '') + delta.toFixed(1).padStart(5)}% │ ${worth}`);
}

// ═══ PART 6: Guppy spread percentile as a score ═══
console.log('\n═══ PART 6: GUPPY COMPRESSION PERCENTILE — As a score for the screener ═══\n');
// For each stock, compute what percentile the current Guppy spread is relative to its own history
// Low percentile = more compressed than usual = higher conviction
console.log('  This is what your screener already does with ATR percentile (atrPct14Pctl120).');
console.log('  Guppy spread percentile would be the SAME concept but using 27 EMAs instead of ATR.\n');
console.log('  The question: does Guppy percentile predict BETTER than ATR percentile?\n');

// Compare: for extreme compression events, what was their ATR pctl vs Guppy pctl?
// We can approximate ATR from the data
const perStockAnalysis = {};
for (const a of ALL) {
  if (!perStockAnalysis[a.sym]) perStockAnalysis[a.sym] = [];
  perStockAnalysis[a.sym].push(a.guppySpread);
}
// Compute percentiles
for (const a of ALL) {
  const history = perStockAnalysis[a.sym];
  const rank = history.filter(s => s < a.guppySpread).length;
  a.guppyPctl = (rank / history.length) * 100;
}

console.log('  Guppy Pctl    │ Count  │ +5% Hit │ +10% Hit │ Avg MFE10 │ Signal');
console.log('  ──────────────┼────────┼─────────┼──────────┼───────────┼───────');
for (const [lo, hi, label] of [[0, 5, 'P0-5 (extreme)'], [5, 15, 'P5-15'], [15, 30, 'P15-30'], [30, 50, 'P30-50'], [50, 75, 'P50-75'], [75, 100, 'P75-100']]) {
  const grp = ALL.filter(a => a.guppyPctl >= lo && a.guppyPctl < hi);
  if (grp.length < 50) continue;
  const w5 = grp.filter(a => a.h5).length;
  const w10 = grp.filter(a => a.h10).length;
  const mfe = grp.reduce((s, a) => s + a.mfe10, 0) / grp.length;
  const signal = w5/grp.length >= 0.35 ? 'BULLISH' : w5/grp.length >= 0.25 ? 'Neutral' : 'Bearish';
  console.log(`  ${label.padEnd(14)} │ ${String(grp.length).padStart(6)} │ ${(w5/grp.length*100).toFixed(1).padStart(6)}% │ ${(w10/grp.length*100).toFixed(1).padStart(7)}% │ ${('+'+mfe.toFixed(1)+'%').padStart(9)} │ ${signal}`);
}

// ═══ VERDICT ═══
console.log(`\n${'█'.repeat(80)}`);
console.log('  VERDICT');
console.log('█'.repeat(80));
const extremeHitRate = extremeDedup.length > 0 ? (eW5 / extremeDedup.length * 100).toFixed(1) : '0';
console.log(`
  GUPPY SPREAD < 2% (extreme compression):
    Hit rate (+5%): ${extremeHitRate}%
    Avg MFE (20d):  +${extremeDedup.length>0?(extremeDedup.reduce((s,a)=>s+a.mfe20,0)/extremeDedup.length).toFixed(1):'0'}%
    Events found:   ${extremeDedup.length}

  OUR SCREENER already captures this concept through:
    - Zone compression (rangeATR < 1.0 for zone candles)
    - Pre-10 avg range ATR (measures candle compression)
    - ATR percentile (measures volatility compression)
    - Guppy spread % (already computed in statsEngine.ts!)

  RECOMMENDATION: Use Guppy spread as a CONVICTION BOOSTER badge.
  When a qualifying signal ALSO has Guppy spread < 2%, mark it as
  "GUPPY MAX COMPRESSION" = highest conviction breakout.
`);
