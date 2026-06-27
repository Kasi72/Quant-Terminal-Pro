// HYPER-TUNING ALL 4 PARAM SETS
// Grid search on 29 Portfolio OHLCV files
// Goal: Maximize win rate while maintaining signal count

const fs = require('fs'), path = require('path');
const DIR = 'C:/Users/drkkr/Downloads/My Portfolio';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS'));

function parseCSV(fp) {
  const l = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < l.length; i++) {
    const p = l[i].split(',');
    if (p.length < 6) continue;
    if (isNaN(+p[4]) || +p[4] <= 0) continue;
    c.push({ date: p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] });
  }
  return c;
}

function atr14(c) {
  const a = new Array(c.length).fill(0);
  if (c.length < 15) return a;
  let s = 0;
  for (let i = 1; i <= 14; i++) s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  a[14] = s / 14;
  for (let i = 15; i < c.length; i++) {
    const t = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
    a[i] = (a[i - 1] * 13 + t) / 14;
  }
  return a;
}

function rsi2(c) {
  const r = new Array(c.length).fill(50);
  for (let i = 3; i < c.length; i++) {
    let g = 0, l = 0;
    for (let j = i - 1; j <= i; j++) { const d = c[j].c - c[j - 1].c; if (d > 0) g += d; else l -= d; }
    r[i] = l === 0 ? 100 : 100 - 100 / (1 + g / 2 / (l / 2));
  }
  return r;
}

// Precompute all candle data
const stockData = [];
for (const file of files) {
  const c = parseCSV(path.join(DIR, file));
  if (c.length < 60) continue;
  const sym = file.replace('_NS_OHLCV.csv', '');
  const a = atr14(c);
  const rsiArr = rsi2(c);
  stockData.push({ sym, c, a, rsiArr });
}

function simulate(params) {
  let signals = 0, wins = 0, stops = 0, totalPnl = 0, totalMfe = 0;

  for (const { c, a, rsiArr } of stockData) {
    const n = c.length;
    for (let i = 30; i < n - 11; i++) {
      if (a[i] <= 0 || c[i].c <= 0) continue;
      const s = c[i];
      const range = s.h - s.l;
      if (range <= 0) continue;

      const exactRangeATR = range / a[i];
      const closeLoc = (s.c - s.l) / range * 100;
      const upperWick = (s.h - Math.max(s.c, s.o)) / range * 100;
      const bodyPct = Math.abs(s.c - s.o) / range * 100;

      let vol20 = 0; for (let j = i - 20; j < i; j++) { if (j >= 0) vol20 += c[j].v; } vol20 /= 20;
      let vol5 = 0; for (let j = i - 5; j < i; j++) { if (j >= 0) vol5 += c[j].v; } vol5 /= 5;
      const exactVolRatio = vol20 > 0 ? s.v / vol20 : 0;
      const exactVolVsPre5 = vol5 > 0 ? s.v / vol5 : 0;

      let pre10RangeSum = 0, pre10ExpCount = 0;
      for (let j = i - 10; j < i; j++) { if (j < 1) continue; const rA = (c[j].h - c[j].l) / (a[j] || 1); pre10RangeSum += rA; if (rA > 1.1) pre10ExpCount++; }
      const pre10AvgRangeATR = pre10RangeSum / 10;

      let zone = null;
      for (let zL = params.maxZone; zL >= params.minZone; zL--) {
        const zS = i - zL; if (zS < 1) continue;
        let zH = -Infinity, zLo = Infinity, ok = true;
        for (let j = zS; j < i; j++) { zH = Math.max(zH, c[j].h); zLo = Math.min(zLo, c[j].l); if ((c[j].h - c[j].l) / (a[j] || 1) > params.maxRangeATR) ok = false; }
        if (!ok) continue;
        const tight = zLo > 0 ? (zH - zLo) / zLo * 100 : 999;
        if (tight > params.maxTightness) continue;
        zone = { zH, zL: zLo, len: zL, tight };
        break;
      }
      if (!zone || s.c <= zone.zH * 1.001) continue;

      let ups = 0;
      if (closeLoc >= 80) ups += 20; else if (closeLoc >= 65) ups += 12;
      if (upperWick <= 20) ups += 20; else if (upperWick <= 35) ups += 12;
      if (bodyPct >= 55) ups += 15; else if (bodyPct >= 35) ups += 9;
      if (exactVolVsPre5 >= 4) ups += 20; else if (exactVolVsPre5 >= 2) ups += 12;
      if (zone.tight <= 5) ups += 15; else if (zone.tight <= 15) ups += 9;
      if (zone.len >= 12) ups += 10; else if (zone.len >= 6) ups += 6;
      let cq = 0;
      if (closeLoc >= 65) cq++; if (upperWick <= 30) cq++; if (bodyPct >= 40) cq++; if (exactVolVsPre5 >= 2.5) cq++; if (exactRangeATR >= 1.5) cq++;

      if (exactRangeATR < params.minExactRangeATR) continue;
      if (exactVolRatio < params.minExactVolRatio) continue;
      if (exactVolVsPre5 < params.minExactVolVsPre5) continue;
      if (closeLoc < params.minCloseLoc) continue;
      if (upperWick > params.maxUpperWick) continue;
      if (bodyPct < params.minBody) continue;
      if (pre10AvgRangeATR > params.maxPre10AvgRangeATR) continue;
      if (pre10ExpCount > params.maxExpansionCount) continue;
      if (rsiArr[i] > params.rsi2Max) continue;
      if (ups < params.minUPS) continue;
      if (cq < params.minCandleQuality) continue;

      // Stop: ZoneLow - 0.5×ATR, clamped [2.5%, 6%]
      const rawStop = zone.zL - 0.5 * a[i];
      const stopPct = Math.max(2.5, Math.min(6, (s.c - rawStop) / s.c * 100));
      const stopPrice = s.c * (1 - stopPct / 100);

      // T1: 2.5×ATR [3%, 6%]
      const atrPct = a[i] / s.c * 100;
      const t1Pct = Math.max(3, Math.min(6, 2.5 * atrPct));
      const t1Price = s.c * (1 + t1Pct / 100);

      let mfe = 0, outcome = 'expired';
      for (let d = 1; d <= 10 && i + d < n; d++) {
        const cd = c[i + d];
        const highPct = (cd.h - s.c) / s.c * 100;
        if (highPct > mfe) mfe = highPct;
        if (cd.l <= stopPrice) { outcome = 'stopped'; break; }
        if (cd.h >= t1Price && outcome !== 'hit') outcome = 'hit';
      }

      signals++;
      totalMfe += mfe;
      if (outcome === 'hit') { wins++; totalPnl += t1Pct; }
      else if (outcome === 'stopped') { stops++; totalPnl -= stopPct; }
      else { const last = c[Math.min(i + 10, n - 1)]; totalPnl += (last.c - s.c) / s.c * 100; }
    }
  }

  const wr = signals > 0 ? wins / signals * 100 : 0;
  const avgPnl = signals > 0 ? totalPnl / signals : 0;
  const avgMfe = signals > 0 ? totalMfe / signals : 0;
  return { signals, wins, stops, wr, avgPnl, avgMfe };
}

console.log('█'.repeat(90));
console.log('  HYPER-TUNING ALL 4 PARAM SETS');
console.log(`  ${stockData.length} stocks, grid search optimization`);
console.log('█'.repeat(90));

// ═══ Current param sets baseline ═══
console.log('\n═══ BASELINE — Current v5-WLB Parameters ═══\n');
const CURRENT = {
  'D20+': { minZone: 4, maxZone: 25, maxRangeATR: 1.0, maxTightness: 15, maxPre10AvgRangeATR: 0.85, maxExpansionCount: 3, minExactRangeATR: 0.8, minExactVolRatio: 1.2, minExactVolVsPre5: 1.5, minCloseLoc: 55, maxUpperWick: 45, minBody: 25, rsi2Max: 92, minUPS: 20, minCandleQuality: 2 },
  'HP15+': { minZone: 5, maxZone: 25, maxRangeATR: 1.0, maxTightness: 12, maxPre10AvgRangeATR: 0.80, maxExpansionCount: 2, minExactRangeATR: 1.0, minExactVolRatio: 1.4, minExactVolVsPre5: 2.0, minCloseLoc: 60, maxUpperWick: 40, minBody: 30, rsi2Max: 90, minUPS: 30, minCandleQuality: 3 },
  'E10+': { minZone: 6, maxZone: 25, maxRangeATR: 0.95, maxTightness: 10, maxPre10AvgRangeATR: 0.75, maxExpansionCount: 2, minExactRangeATR: 1.2, minExactVolRatio: 1.6, minExactVolVsPre5: 2.5, minCloseLoc: 65, maxUpperWick: 35, minBody: 35, rsi2Max: 88, minUPS: 40, minCandleQuality: 3 },
  'US8+': { minZone: 7, maxZone: 25, maxRangeATR: 0.90, maxTightness: 8, maxPre10AvgRangeATR: 0.70, maxExpansionCount: 1, minExactRangeATR: 1.4, minExactVolRatio: 1.8, minExactVolVsPre5: 3.0, minCloseLoc: 70, maxUpperWick: 30, minBody: 40, rsi2Max: 85, minUPS: 50, minCandleQuality: 4 },
};

console.log('  Set   │ Signals │ Wins │ Stops │ WinRate │ Avg MFE │ Avg PnL');
console.log('  ──────┼─────────┼──────┼───────┼─────────┼─────────┼────────');
for (const [name, params] of Object.entries(CURRENT)) {
  const r = simulate(params);
  console.log(`  ${name.padEnd(5)} │ ${String(r.signals).padStart(7)} │ ${String(r.wins).padStart(4)} │ ${String(r.stops).padStart(5)} │ ${r.wr.toFixed(1).padStart(6)}% │ ${('+' + r.avgMfe.toFixed(1) + '%').padStart(7)} │ ${(r.avgPnl >= 0 ? '+' : '') + r.avgPnl.toFixed(2) + '%'}`);
}

// ═══ GRID SEARCH — Test each parameter independently ═══
console.log('\n═══ PARAMETER SENSITIVITY — D20+ (which parameter matters most?) ═══\n');

const base = { ...CURRENT['D20+'] };
const paramGrid = {
  minZone:            [3, 4, 5, 6, 7],
  maxTightness:       [8, 10, 12, 15, 18, 20],
  maxPre10AvgRangeATR:[0.65, 0.75, 0.80, 0.85, 0.90, 0.95],
  maxExpansionCount:  [1, 2, 3, 4, 5],
  minExactRangeATR:   [0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2],
  minExactVolRatio:   [0.8, 1.0, 1.2, 1.4, 1.6],
  minExactVolVsPre5:  [1.0, 1.2, 1.5, 1.8, 2.0, 2.5],
  minCloseLoc:        [45, 50, 55, 60, 65, 70],
  maxUpperWick:       [30, 35, 40, 45, 50, 55],
  minBody:            [15, 20, 25, 30, 35, 40],
  rsi2Max:            [80, 85, 88, 90, 92, 95],
  minUPS:             [10, 15, 20, 25, 30, 35],
  minCandleQuality:   [1, 2, 3, 4],
};

const bestPerParam = {};
for (const [paramName, values] of Object.entries(paramGrid)) {
  let bestVal = base[paramName], bestScore = -999;
  const results = [];
  for (const val of values) {
    const test = { ...base, [paramName]: val };
    const r = simulate(test);
    // Score: maximize WR × sqrt(signals) — balance quality with quantity
    const score = r.signals >= 5 ? r.wr * Math.sqrt(r.signals) + r.avgPnl * 10 : -999;
    results.push({ val, ...r, score });
    if (score > bestScore) { bestScore = score; bestVal = val; }
  }
  bestPerParam[paramName] = bestVal;

  console.log(`  ${paramName} (current: ${base[paramName]}):`);
  console.log(`  ${'Value'.padEnd(8)} │ Sigs │ Wins │ WR    │ MFE   │ PnL    │ Score`);
  for (const r of results) {
    const marker = r.val === bestVal ? ' ★' : r.val === base[paramName] ? ' ←' : '';
    console.log(`  ${String(r.val).padEnd(8)} │ ${String(r.signals).padStart(4)} │ ${String(r.wins).padStart(4)} │ ${r.wr.toFixed(0).padStart(4)}% │ ${('+' + r.avgMfe.toFixed(1)).padStart(5)} │ ${(r.avgPnl >= 0 ? '+' : '') + r.avgPnl.toFixed(1).padStart(5)} │ ${r.score.toFixed(0).padStart(5)}${marker}`);
  }
  console.log('');
}

// ═══ OPTIMIZED D20+ ═══
console.log('═══ OPTIMIZED D20+ — Combining best individual params ═══\n');
const optimizedD20 = { ...base, ...bestPerParam };
const optR = simulate(optimizedD20);
const baseR = simulate(base);
console.log(`  Current D20+:   ${baseR.signals} signals, ${baseR.wins} wins, ${baseR.wr.toFixed(1)}% WR, ${(baseR.avgPnl >= 0 ? '+' : '') + baseR.avgPnl.toFixed(2)}% PnL`);
console.log(`  Optimized D20+: ${optR.signals} signals, ${optR.wins} wins, ${optR.wr.toFixed(1)}% WR, ${(optR.avgPnl >= 0 ? '+' : '') + optR.avgPnl.toFixed(2)}% PnL`);
console.log(`\n  Optimized params:`);
for (const [k, v] of Object.entries(optimizedD20)) {
  const changed = v !== base[k] ? ' ← CHANGED' : '';
  console.log(`    ${k.padEnd(24)} ${String(v).padStart(6)}${changed}`);
}

// ═══ HYPER-TUNE HP15+ ═══
console.log('\n═══ HYPER-TUNING HP15+ ═══\n');
const baseHP = { ...CURRENT['HP15+'] };
const hpGrid = {
  minZone: [4, 5, 6], maxTightness: [10, 12, 14, 16], maxPre10AvgRangeATR: [0.70, 0.80, 0.85, 0.90],
  minExactRangeATR: [0.8, 0.9, 1.0, 1.1], minExactVolRatio: [1.0, 1.2, 1.4],
  minExactVolVsPre5: [1.5, 1.8, 2.0, 2.5], minCloseLoc: [55, 60, 65],
  maxUpperWick: [35, 40, 45], minBody: [25, 30, 35], rsi2Max: [88, 90, 92, 95],
  minUPS: [20, 25, 30, 35], minCandleQuality: [2, 3, 4],
};
const bestHP = {};
for (const [paramName, values] of Object.entries(hpGrid)) {
  let bestVal = baseHP[paramName], bestScore = -999;
  for (const val of values) {
    const test = { ...baseHP, [paramName]: val };
    const r = simulate(test);
    const score = r.signals >= 3 ? r.wr * Math.sqrt(r.signals) + r.avgPnl * 10 : -999;
    if (score > bestScore) { bestScore = score; bestVal = val; }
  }
  bestHP[paramName] = bestVal;
}
const optHP = { ...baseHP, ...bestHP };
const optHPR = simulate(optHP);
const baseHPR = simulate(baseHP);
console.log(`  Current HP15+:   ${baseHPR.signals} sigs, ${baseHPR.wins} wins, ${baseHPR.wr.toFixed(1)}% WR, ${(baseHPR.avgPnl >= 0 ? '+' : '') + baseHPR.avgPnl.toFixed(2)}% PnL`);
console.log(`  Optimized HP15+: ${optHPR.signals} sigs, ${optHPR.wins} wins, ${optHPR.wr.toFixed(1)}% WR, ${(optHPR.avgPnl >= 0 ? '+' : '') + optHPR.avgPnl.toFixed(2)}% PnL`);
console.log(`  Changed params:`);
for (const [k, v] of Object.entries(optHP)) { if (v !== baseHP[k]) console.log(`    ${k.padEnd(24)} ${baseHP[k]} → ${v}`); }

// ═══ HYPER-TUNE E10+ ═══
console.log('\n═══ HYPER-TUNING E10+ ═══\n');
const baseE = { ...CURRENT['E10+'] };
const eGrid = {
  minZone: [4, 5, 6, 7], maxTightness: [8, 10, 12, 14], maxPre10AvgRangeATR: [0.70, 0.75, 0.80, 0.85],
  minExactRangeATR: [0.9, 1.0, 1.1, 1.2], minExactVolRatio: [1.2, 1.4, 1.6],
  minExactVolVsPre5: [1.5, 2.0, 2.5], minCloseLoc: [55, 60, 65],
  maxUpperWick: [30, 35, 40, 45], minBody: [25, 30, 35], rsi2Max: [85, 88, 90, 92],
  minUPS: [25, 30, 35, 40], minCandleQuality: [2, 3, 4],
};
const bestE = {};
for (const [paramName, values] of Object.entries(eGrid)) {
  let bestVal = baseE[paramName], bestScore = -999;
  for (const val of values) {
    const test = { ...baseE, [paramName]: val };
    const r = simulate(test);
    const score = r.signals >= 3 ? r.wr * Math.sqrt(r.signals) + r.avgPnl * 10 : -999;
    if (score > bestScore) { bestScore = score; bestVal = val; }
  }
  bestE[paramName] = bestVal;
}
const optE = { ...baseE, ...bestE };
const optER = simulate(optE);
const baseER = simulate(baseE);
console.log(`  Current E10+:   ${baseER.signals} sigs, ${baseER.wins} wins, ${baseER.wr.toFixed(1)}% WR, ${(baseER.avgPnl >= 0 ? '+' : '') + baseER.avgPnl.toFixed(2)}% PnL`);
console.log(`  Optimized E10+: ${optER.signals} sigs, ${optER.wins} wins, ${optER.wr.toFixed(1)}% WR, ${(optER.avgPnl >= 0 ? '+' : '') + optER.avgPnl.toFixed(2)}% PnL`);
console.log(`  Changed params:`);
for (const [k, v] of Object.entries(optE)) { if (v !== baseE[k]) console.log(`    ${k.padEnd(24)} ${baseE[k]} → ${v}`); }

// ═══ HYPER-TUNE US8+ ═══
console.log('\n═══ HYPER-TUNING US8+ ═══\n');
const baseUS = { ...CURRENT['US8+'] };
const usGrid = {
  minZone: [4, 5, 6, 7], maxTightness: [6, 8, 10, 12], maxPre10AvgRangeATR: [0.65, 0.70, 0.75, 0.80],
  minExactRangeATR: [1.0, 1.2, 1.4], minExactVolRatio: [1.4, 1.6, 1.8],
  minExactVolVsPre5: [2.0, 2.5, 3.0], minCloseLoc: [60, 65, 70],
  maxUpperWick: [25, 30, 35], minBody: [30, 35, 40], rsi2Max: [82, 85, 88, 90],
  minUPS: [30, 40, 50], minCandleQuality: [3, 4],
};
const bestUS = {};
for (const [paramName, values] of Object.entries(usGrid)) {
  let bestVal = baseUS[paramName], bestScore = -999;
  for (const val of values) {
    const test = { ...baseUS, [paramName]: val };
    const r = simulate(test);
    const score = r.signals >= 2 ? r.wr * Math.sqrt(r.signals) + r.avgPnl * 10 : -999;
    if (score > bestScore) { bestScore = score; bestVal = val; }
  }
  bestUS[paramName] = bestVal;
}
const optUS = { ...baseUS, ...bestUS };
const optUSR = simulate(optUS);
const baseUSR = simulate(baseUS);
console.log(`  Current US8+:   ${baseUSR.signals} sigs, ${baseUSR.wins} wins, ${baseUSR.wr.toFixed(1)}% WR`);
console.log(`  Optimized US8+: ${optUSR.signals} sigs, ${optUSR.wins} wins, ${optUSR.wr.toFixed(1)}% WR, ${(optUSR.avgPnl >= 0 ? '+' : '') + optUSR.avgPnl.toFixed(2)}% PnL`);
console.log(`  Changed params:`);
for (const [k, v] of Object.entries(optUS)) { if (v !== baseUS[k]) console.log(`    ${k.padEnd(24)} ${baseUS[k]} → ${v}`); }

// ═══ FINAL SUMMARY ═══
console.log('\n' + '█'.repeat(90));
console.log('  FINAL COMPARISON — Current vs Hyper-Tuned');
console.log('█'.repeat(90) + '\n');
console.log('  Param Set │ Current                          │ Hyper-Tuned');
console.log('  ──────────┼──────────────────────────────────┼──────────────────────────────────');
const pairs = [
  ['D20+', baseR, optR],
  ['HP15+', baseHPR, optHPR],
  ['E10+', baseER, optER],
  ['US8+', baseUSR, optUSR],
];
for (const [name, cur, opt] of pairs) {
  const curStr = `${cur.signals}sig ${cur.wins}W ${cur.wr.toFixed(0)}%WR ${(cur.avgPnl >= 0 ? '+' : '') + cur.avgPnl.toFixed(1)}%PnL`;
  const optStr = `${opt.signals}sig ${opt.wins}W ${opt.wr.toFixed(0)}%WR ${(opt.avgPnl >= 0 ? '+' : '') + opt.avgPnl.toFixed(1)}%PnL`;
  console.log(`  ${name.padEnd(9)} │ ${curStr.padEnd(32)} │ ${optStr}`);
}

// Print the final optimized param sets for implementation
console.log('\n═══ OPTIMIZED PARAM SETS FOR IMPLEMENTATION ═══\n');
const finalSets = { 'D20+': optimizedD20, 'HP15+': optHP, 'E10+': optE, 'US8+': optUS };
for (const [name, params] of Object.entries(finalSets)) {
  console.log(`  ${name}:`);
  for (const [k, v] of Object.entries(params)) {
    console.log(`    ${k}: ${v},`);
  }
  console.log('');
}
