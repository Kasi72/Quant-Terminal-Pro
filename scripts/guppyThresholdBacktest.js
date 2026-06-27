// GUPPY COMPRESSION THRESHOLD BACKTEST
// Tests on Portfolio (28 stocks) + Nifty 50 OHLCV files
// Question: What spread threshold catches the most explosive breakouts?

const fs = require('fs'), path = require('path');
const DIRS = [
  'C:/Users/drkkr/Downloads/My Portfolio',
  'C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX'
];

function parseCSV(fp) {
  const l = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < l.length; i++) {
    const p = l[i].split(',');
    if (p.length < 6) continue;
    const [date, o, h, lo, cl, v] = p;
    const oN = +o, hN = +h, lN = +lo, cN = +cl, vN = +v;
    if (isNaN(cN) || cN <= 0) continue;
    c.push({ date, o: oN, h: hN, l: lN, c: cN, v: vN });
  }
  return c;
}

// Compute 12 Guppy EMAs
function computeGuppyEMAs(candles) {
  const periods = [3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 28, 31, 34, 37, 40, 43, 46, 49, 52, 55, 58, 61, 64, 67, 70, 200];
  // Use the standard 12: short (3,5,7,9,11,13) + long (15,17,19,21,23,25)... but Clenow/Guppy uses specific ones
  // Standard Guppy: Short EMAs: 3,5,8,10,12,15 | Long EMAs: 30,35,40,45,50,60
  const guppyPeriods = [3, 5, 8, 10, 12, 15, 30, 35, 40, 45, 50, 60];
  const emas = {};
  for (const p of guppyPeriods) {
    emas[p] = new Array(candles.length).fill(0);
    const k = 2 / (p + 1);
    emas[p][0] = candles[0].c;
    for (let i = 1; i < candles.length; i++) {
      emas[p][i] = candles[i].c * k + emas[p][i - 1] * (1 - k);
    }
  }
  return { emas, periods: guppyPeriods };
}

// Compute Guppy spread at each candle
function computeGuppySpread(candles) {
  const { emas, periods } = computeGuppyEMAs(candles);
  const spreads = new Array(candles.length).fill(0);
  for (let i = 60; i < candles.length; i++) {
    const vals = periods.map(p => emas[p][i]);
    const maxV = Math.max(...vals), minV = Math.min(...vals);
    const mid = (maxV + minV) / 2;
    spreads[i] = mid > 0 ? (maxV - minV) / mid * 100 : 0;
  }
  return spreads;
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

// Collect all OHLCV files
const files = [];
for (const dir of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.csv') && !f.includes('ALL_SYMBOLS') && !f.includes('indiavix')) {
      files.push({ path: path.join(dir, f), sym: f.replace('_NS_OHLCV.csv', '').replace('.csv', '') });
    }
  }
}
console.log(`█${'█'.repeat(84)}`);
console.log('  GUPPY COMPRESSION THRESHOLD BACKTEST');
console.log(`  ${files.length} OHLCV files (Portfolio + Nifty 50)`);
console.log(`█${'█'.repeat(84)}\n`);

// ═══ PART 1: What does Guppy spread look like BEFORE breakouts? ═══
console.log('═══ PART 1: GUPPY SPREAD DISTRIBUTION BEFORE BREAKOUTS ═══\n');

const allBreakouts = [];
for (const { path: fp, sym } of files) {
  const c = parseCSV(fp);
  if (c.length < 100) continue;
  const spreads = computeGuppySpread(c);
  const a = atr14(c);

  for (let i = 65; i < c.length - 11; i++) {
    if (c[i].c <= 0 || a[i] <= 0) continue;
    // Find compression zone before this candle
    let bZ = null;
    for (let zL = 25; zL >= 4; zL--) {
      const zS = i - zL;
      if (zS < 1) continue;
      let zH = -Infinity, zLo = Infinity, ok = true;
      for (let j = zS; j < i; j++) {
        zH = Math.max(zH, c[j].h);
        zLo = Math.min(zLo, c[j].l);
        if ((c[j].h - c[j].l) / (a[j] || 1) > 1.0) ok = false;
      }
      if (!ok) continue;
      bZ = { zH, zL: zLo, zLen: zL };
      break;
    }
    if (!bZ || c[i].c <= bZ.zH * 1.001) continue;

    // Guppy spread DURING zone (avg of zone candles, excluding breakout)
    let zoneSpreadSum = 0, zoneSpreadCount = 0, minZoneSpread = Infinity;
    for (let j = i - bZ.zLen; j < i; j++) {
      if (spreads[j] > 0) {
        zoneSpreadSum += spreads[j];
        zoneSpreadCount++;
        if (spreads[j] < minZoneSpread) minZoneSpread = spreads[j];
      }
    }
    const avgZoneSpread = zoneSpreadCount > 0 ? zoneSpreadSum / zoneSpreadCount : 999;
    const breakoutSpread = spreads[i];

    // Future MFE
    let mfe = 0, h5 = false, h8 = false, h10 = false;
    for (let d = i + 1; d <= Math.min(i + 10, c.length - 1); d++) {
      const pH = (c[d].h - c[i].c) / c[i].c * 100;
      if (pH > mfe) mfe = pH;
      if (pH >= 5) h5 = true;
      if (pH >= 8) h8 = true;
      if (pH >= 10) h10 = true;
    }

    allBreakouts.push({ sym, avgZoneSpread, minZoneSpread, breakoutSpread, mfe, h5, h8, h10 });
  }
}

console.log(`  Total breakout signals: ${allBreakouts.length}\n`);

// Distribution of zone spreads
console.log('  Avg Zone Spread │ Count │ +5% Hit │ +8% Hit │ +10% Hit │ Avg MFE │ Quality');
console.log('  ────────────────┼───────┼─────────┼─────────┼──────────┼─────────┼────────');
for (const [lo, hi, label] of [[0, 2, '< 2%'], [2, 3, '2-3%'], [3, 4, '3-4%'], [4, 5, '4-5%'], [5, 6, '5-6%'], [6, 8, '6-8%'], [8, 10, '8-10%'], [10, 15, '10-15%'], [15, 999, '15%+']]) {
  const grp = allBreakouts.filter(b => b.avgZoneSpread >= lo && b.avgZoneSpread < hi);
  if (grp.length < 5) continue;
  const h5 = grp.filter(b => b.h5).length;
  const h8 = grp.filter(b => b.h8).length;
  const h10 = grp.filter(b => b.h10).length;
  const avgMfe = grp.reduce((s, b) => s + b.mfe, 0) / grp.length;
  const quality = h5 / grp.length >= 0.5 ? '★★★' : h5 / grp.length >= 0.4 ? '★★' : h5 / grp.length >= 0.3 ? '★' : '';
  console.log(`  ${label.padEnd(16)} │ ${String(grp.length).padStart(5)} │ ${(h5 / grp.length * 100).toFixed(1).padStart(6)}% │ ${(h8 / grp.length * 100).toFixed(1).padStart(6)}% │ ${(h10 / grp.length * 100).toFixed(1).padStart(7)}% │ ${('+' + avgMfe.toFixed(1) + '%').padStart(7)} │ ${quality}`);
}

// ═══ PART 2: Optimal threshold testing ═══
console.log('\n═══ PART 2: OPTIMAL THRESHOLD — Which cutoff catches best breakouts? ═══\n');
const baseHR = allBreakouts.filter(b => b.h5).length / allBreakouts.length * 100;
console.log(`  Baseline (all breakouts): ${allBreakouts.length} signals, ${baseHR.toFixed(1)}% hit rate\n`);
console.log('  Threshold      │ Signals │ +5% Hits │ Hit Rate │ Avg MFE │ ΔRate │ Signals kept │ Best?');
console.log('  ───────────────┼─────────┼──────────┼──────────┼─────────┼───────┼──────────────┼──────');
for (const thr of [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 10]) {
  const pass = allBreakouts.filter(b => b.avgZoneSpread <= thr);
  if (pass.length < 5) continue;
  const hits = pass.filter(b => b.h5).length;
  const rate = hits / pass.length * 100;
  const avgMfe = pass.reduce((s, b) => s + b.mfe, 0) / pass.length;
  const delta = rate - baseHR;
  const kept = (pass.length / allBreakouts.length * 100).toFixed(0);
  const best = delta > 5 && pass.length >= 20 ? '★ YES' : delta > 3 ? 'Maybe' : '';
  console.log(`  Spread ≤ ${String(thr).padStart(4)}%  │ ${String(pass.length).padStart(7)} │ ${String(hits).padStart(8)} │ ${rate.toFixed(1).padStart(7)}% │ ${('+' + avgMfe.toFixed(1) + '%').padStart(7)} │ ${(delta >= 0 ? '+' : '') + delta.toFixed(1).padStart(5)}% │ ${kept.padStart(12)}% │ ${best}`);
}

// ═══ PART 3: Min spread vs Avg spread ═══
console.log('\n═══ PART 3: MIN SPREAD vs AVG SPREAD — Which metric is better? ═══\n');
console.log('  Using MIN spread in zone:');
console.log('  Threshold      │ Signals │ +5% Hit │ Avg MFE │ ΔRate');
console.log('  ───────────────┼─────────┼─────────┼─────────┼──────');
for (const thr of [2, 3, 4, 5, 6, 8]) {
  const pass = allBreakouts.filter(b => b.minZoneSpread <= thr);
  if (pass.length < 5) continue;
  const hits = pass.filter(b => b.h5).length;
  const rate = hits / pass.length * 100;
  const avgMfe = pass.reduce((s, b) => s + b.mfe, 0) / pass.length;
  console.log(`  MinSpread ≤ ${String(thr).padStart(2)}% │ ${String(pass.length).padStart(7)} │ ${(rate).toFixed(1).padStart(6)}% │ ${('+' + avgMfe.toFixed(1) + '%').padStart(7)} │ ${((rate - baseHR) >= 0 ? '+' : '') + (rate - baseHR).toFixed(1)}%`);
}

// ═══ PART 4: Breakout day spread vs zone spread ═══
console.log('\n═══ PART 4: BREAKOUT DAY SPREAD — Does it matter? ═══\n');
console.log('  Breakout Spread │ Count │ +5% Hit │ Avg MFE │ Note');
console.log('  ────────────────┼───────┼─────────┼─────────┼─────');
for (const [lo, hi, label] of [[0, 3, '< 3%'], [3, 5, '3-5%'], [5, 7, '5-7%'], [7, 10, '7-10%'], [10, 999, '10%+']]) {
  const grp = allBreakouts.filter(b => b.breakoutSpread >= lo && b.breakoutSpread < hi);
  if (grp.length < 5) continue;
  const h5 = grp.filter(b => b.h5).length;
  const avgMfe = grp.reduce((s, b) => s + b.mfe, 0) / grp.length;
  console.log(`  ${label.padEnd(16)} │ ${String(grp.length).padStart(5)} │ ${(h5 / grp.length * 100).toFixed(1).padStart(6)}% │ ${('+' + avgMfe.toFixed(1) + '%').padStart(7)} │ ${lo < 5 ? 'Still compressed' : 'Expanding'}`);
}

// ═══ PART 5: Compression + Volume confirmation ═══
console.log('\n═══ PART 5: COMPRESSION + VOLUME — Does volume confirm better? ═══\n');
// Check if breakout with volume surge after compression does better
const withVol = [];
for (const { path: fp, sym } of files) {
  const c = parseCSV(fp);
  if (c.length < 100) continue;
  const spreads = computeGuppySpread(c);
  const a = atr14(c);
  // 20-day avg volume
  for (let i = 65; i < c.length - 11; i++) {
    if (c[i].c <= 0 || a[i] <= 0 || c[i].v <= 0) continue;
    let avgVol = 0;
    for (let j = i - 20; j < i; j++) avgVol += c[j].v;
    avgVol /= 20;
    if (avgVol <= 0) continue;
    const volRatio = c[i].v / avgVol;

    // Zone spread
    let bZ = null;
    for (let zL = 25; zL >= 4; zL--) {
      const zS = i - zL;
      if (zS < 1) continue;
      let zH = -Infinity, ok = true;
      for (let j = zS; j < i; j++) { zH = Math.max(zH, c[j].h); if ((c[j].h - c[j].l) / (a[j] || 1) > 1.0) ok = false; }
      if (!ok) continue;
      bZ = { zH, zLen: zL };
      break;
    }
    if (!bZ || c[i].c <= bZ.zH * 1.001) continue;

    let zoneSpreadSum = 0, zoneSpreadCount = 0;
    for (let j = i - bZ.zLen; j < i; j++) { if (spreads[j] > 0) { zoneSpreadSum += spreads[j]; zoneSpreadCount++; } }
    const avgZoneSpread = zoneSpreadCount > 0 ? zoneSpreadSum / zoneSpreadCount : 999;

    let mfe = 0, h5 = false;
    for (let d = i + 1; d <= Math.min(i + 10, c.length - 1); d++) {
      const pH = (c[d].h - c[i].c) / c[i].c * 100;
      if (pH > mfe) mfe = pH;
      if (pH >= 5) h5 = true;
    }
    withVol.push({ avgZoneSpread, volRatio, mfe, h5 });
  }
}

for (const thr of [4, 5, 6]) {
  const compressed = withVol.filter(b => b.avgZoneSpread <= thr);
  const compVol = compressed.filter(b => b.volRatio >= 1.5);
  const compNoVol = compressed.filter(b => b.volRatio < 1.5);
  if (compVol.length < 3 || compNoVol.length < 3) continue;
  const vrH5 = compVol.filter(b => b.h5).length / compVol.length * 100;
  const nvrH5 = compNoVol.filter(b => b.h5).length / compNoVol.length * 100;
  console.log(`  Spread ≤${thr}% + Vol≥1.5×: ${compVol.length} signals, ${vrH5.toFixed(1)}% hit rate, avg MFE +${(compVol.reduce((s,b)=>s+b.mfe,0)/compVol.length).toFixed(1)}%`);
  console.log(`  Spread ≤${thr}% + Vol<1.5×: ${compNoVol.length} signals, ${nvrH5.toFixed(1)}% hit rate, avg MFE +${(compNoVol.reduce((s,b)=>s+b.mfe,0)/compNoVol.length).toFixed(1)}%`);
  console.log(`  Volume boost: ${(vrH5 - nvrH5) >= 0 ? '+' : ''}${(vrH5 - nvrH5).toFixed(1)}% hit rate improvement\n`);
}

// ═══ VERDICT ═══
console.log(`${'█'.repeat(85)}`);
console.log('  VERDICT');
console.log('█'.repeat(85));
const t5 = allBreakouts.filter(b => b.avgZoneSpread <= 5);
const t5hr = t5.length > 0 ? t5.filter(b => b.h5).length / t5.length * 100 : 0;
const t6 = allBreakouts.filter(b => b.avgZoneSpread <= 6);
const t6hr = t6.length > 0 ? t6.filter(b => b.h5).length / t6.length * 100 : 0;
console.log(`
  Current threshold: 3% (too tight — misses compressions like REPCOHOME)

  Recommended: Change to ≤${t5hr > t6hr ? '5' : '6'}% avg zone spread
    Hit rate: ${Math.max(t5hr, t6hr).toFixed(1)}% (vs ${baseHR.toFixed(1)}% baseline)
    Signals: ${t5hr > t6hr ? t5.length : t6.length} breakouts qualify

  The REPCOHOME pattern (4.13% on breakout day, likely ~3-4% in zone)
  would be caught with a 5% threshold but missed at 3%.
`);
