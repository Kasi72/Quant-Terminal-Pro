// WIN/LOSS ASYMMETRY INVESTIGATION
// Problem: Avg win +3.5% vs Avg loss -7.0% → need 67% WR to be profitable
// Goal: Find the optimal balance between stops and targets

const fs = require('fs'), path = require('path');
const DIR = 'C:/Users/drkkr/Downloads/My Portfolio';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS'));

function parseCSV(fp) {
  const l = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < l.length; i++) {
    const p = l[i].split(',');
    if (p.length < 6) continue;
    const [date, o, h, lo, cl, v] = p;
    if (isNaN(+cl) || +cl <= 0) continue;
    c.push({ date, o: +o, h: +h, l: +lo, c: +cl, v: +v });
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

// D20+ params (the main workhorse)
const P = {
  minZone: 4, maxZone: 25, maxRangeATR: 1.0, maxTightness: 15,
  maxPre10AvgRangeATR: 0.85, maxExpansionCount: 3,
  minExactRangeATR: 0.8, minExactVolRatio: 1.2, minExactVolVsPre5: 1.5,
  minCloseLoc: 55, maxUpperWick: 45, minBody: 25,
  rsi2Max: 92, minUPS: 20, minCandleQuality: 2
};

// Find all D20+ breakout signals with FULL forward data (20 days)
function findSignals(candles) {
  const n = candles.length;
  if (n < 60) return [];
  const a = atr14(candles);
  const rsiArr = rsi2(candles);
  const signals = [];

  for (let i = 30; i < n - 21; i++) {
    if (a[i] <= 0 || candles[i].c <= 0) continue;
    const s = candles[i];
    const range = s.h - s.l;
    if (range <= 0) continue;
    const exactRangeATR = range / a[i];
    const closeLoc = (s.c - s.l) / range * 100;
    const upperWick = (s.h - Math.max(s.c, s.o)) / range * 100;
    const bodyPct = Math.abs(s.c - s.o) / range * 100;
    let vol20 = 0; for (let j = i - 20; j < i; j++) { if (j >= 0) vol20 += candles[j].v; } vol20 /= 20;
    let vol5 = 0; for (let j = i - 5; j < i; j++) { if (j >= 0) vol5 += candles[j].v; } vol5 /= 5;
    const exactVolRatio = vol20 > 0 ? s.v / vol20 : 0;
    const exactVolVsPre5 = vol5 > 0 ? s.v / vol5 : 0;
    let pre10RangeSum = 0, pre10ExpCount = 0;
    for (let j = i - 10; j < i; j++) { if (j < 1) continue; const rA = (candles[j].h - candles[j].l) / (a[j] || 1); pre10RangeSum += rA; if (rA > 1.1) pre10ExpCount++; }
    const pre10AvgRangeATR = pre10RangeSum / 10;

    let zone = null;
    for (let zL = P.maxZone; zL >= P.minZone; zL--) {
      const zS = i - zL; if (zS < 1) continue;
      let zH = -Infinity, zLo = Infinity, ok = true;
      for (let j = zS; j < i; j++) { zH = Math.max(zH, candles[j].h); zLo = Math.min(zLo, candles[j].l); if ((candles[j].h - candles[j].l) / (a[j] || 1) > P.maxRangeATR) ok = false; }
      if (!ok) continue;
      const tight = zLo > 0 ? (zH - zLo) / zLo * 100 : 999;
      if (tight > P.maxTightness) continue;
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

    if (exactRangeATR < P.minExactRangeATR || exactVolRatio < P.minExactVolRatio || exactVolVsPre5 < P.minExactVolVsPre5) continue;
    if (closeLoc < P.minCloseLoc || upperWick > P.maxUpperWick || bodyPct < P.minBody) continue;
    if (pre10AvgRangeATR > P.maxPre10AvgRangeATR || pre10ExpCount > P.maxExpansionCount) continue;
    if (rsiArr[i] > P.rsi2Max || ups < P.minUPS || cq < P.minCandleQuality) continue;

    // Collect full forward data for 20 days
    const forward = [];
    for (let d = 1; d <= 20 && i + d < n; d++) {
      forward.push(candles[i + d]);
    }

    signals.push({
      sym: '', idx: i, date: s.date, entry: s.c, atr: a[i],
      zoneHigh: zone.zH, zoneLow: zone.zL, zoneLen: zone.len, zoneTight: zone.tight,
      closeLoc, upperWick, bodyPct, exactRangeATR, exactVolRatio, exactVolVsPre5, ups, cq,
      forward
    });
  }
  return signals;
}

// Collect all signals
const allSigs = [];
for (const file of files) {
  const c = parseCSV(path.join(DIR, file));
  const sym = file.replace('_NS_OHLCV.csv', '');
  const sigs = findSignals(c);
  for (const s of sigs) { s.sym = sym; allSigs.push(s); }
}

console.log('█'.repeat(90));
console.log('  WIN/LOSS ASYMMETRY INVESTIGATION');
console.log(`  ${allSigs.length} D20+ signals across ${files.length} stocks`);
console.log('█'.repeat(90));

// ═══ PART 1: MFE distribution — how far do winners actually run? ═══
console.log('\n═══ PART 1: MFE DISTRIBUTION — How far do breakouts actually run? ═══\n');
const mfe5 = [], mfe10 = [], mfe15 = [], mfe20 = [];
for (const s of allSigs) {
  let m5 = 0, m10 = 0, m15 = 0, m20 = 0;
  for (let d = 0; d < Math.min(5, s.forward.length); d++) {
    const p = (s.forward[d].h - s.entry) / s.entry * 100;
    if (p > m5) m5 = p;
  }
  for (let d = 0; d < Math.min(10, s.forward.length); d++) {
    const p = (s.forward[d].h - s.entry) / s.entry * 100;
    if (p > m10) m10 = p;
  }
  for (let d = 0; d < Math.min(15, s.forward.length); d++) {
    const p = (s.forward[d].h - s.entry) / s.entry * 100;
    if (p > m15) m15 = p;
  }
  for (let d = 0; d < s.forward.length; d++) {
    const p = (s.forward[d].h - s.entry) / s.entry * 100;
    if (p > m20) m20 = p;
  }
  mfe5.push(m5); mfe10.push(m10); mfe15.push(m15); mfe20.push(m20);
}
console.log('  Timeframe │ Avg MFE │ Median │ 75th pctl │ 90th pctl │ Max');
console.log('  ──────────┼─────────┼────────┼───────────┼───────────┼─────');
for (const [label, arr] of [['5-day', mfe5], ['10-day', mfe10], ['15-day', mfe15], ['20-day', mfe20]]) {
  const sorted = [...arr].sort((a, b) => a - b);
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const med = sorted[Math.floor(sorted.length / 2)];
  const p75 = sorted[Math.floor(sorted.length * 0.75)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  const max = sorted[sorted.length - 1];
  console.log(`  ${label.padEnd(9)} │ ${('+' + avg.toFixed(1) + '%').padStart(7)} │ ${('+' + med.toFixed(1) + '%').padStart(6)} │ ${('+' + p75.toFixed(1) + '%').padStart(9)} │ ${('+' + p90.toFixed(1) + '%').padStart(9)} │ +${max.toFixed(1)}%`);
}

// ═══ PART 2: MAE distribution — how deep do trades dip BEFORE winning? ═══
console.log('\n═══ PART 2: MAE DISTRIBUTION — How deep do trades dip before recovering? ═══\n');
console.log('  Max Drawdown │ Count │ % of trades │ Still won (+5%)? │ Recovered?');
console.log('  ─────────────┼───────┼─────────────┼──────────────────┼───────────');
for (const [lo, hi, label] of [[0, 1, '0-1%'], [1, 2, '1-2%'], [2, 3, '2-3%'], [3, 4, '3-4%'], [4, 5, '4-5%'], [5, 6, '5-6%'], [6, 8, '6-8%'], [8, 15, '8%+']]) {
  const grp = allSigs.filter((s, idx) => {
    let mae = 0;
    for (let d = 0; d < Math.min(10, s.forward.length); d++) {
      const p = (s.forward[d].l - s.entry) / s.entry * 100;
      if (p < mae) mae = p;
    }
    return Math.abs(mae) >= lo && Math.abs(mae) < hi;
  });
  const stillWon = grp.filter((s) => {
    let m = 0;
    for (let d = 0; d < Math.min(10, s.forward.length); d++) {
      const p = (s.forward[d].h - s.entry) / s.entry * 100;
      if (p > m) m = p;
    }
    return m >= 5;
  }).length;
  const recovered = grp.filter(s => {
    const last = s.forward[Math.min(9, s.forward.length - 1)];
    return last && last.c > s.entry;
  }).length;
  if (grp.length === 0) continue;
  console.log(`  ${label.padEnd(13)} │ ${String(grp.length).padStart(5)} │ ${(grp.length / allSigs.length * 100).toFixed(0).padStart(11)}% │ ${(stillWon / grp.length * 100).toFixed(0).padStart(16)}% │ ${(recovered / grp.length * 100).toFixed(0).padStart(9)}%`);
}

// ═══ PART 3: Test different stop-loss formulas ═══
console.log('\n═══ PART 3: STOP-LOSS FORMULA COMPARISON ═══\n');
console.log('  Stop Formula                │ Signals │ Stopped │ StopRate │ Winners │ WinRate │ Avg PnL │ Expectancy');
console.log('  ────────────────────────────┼─────────┼─────────┼─────────┼─────────┼─────────┼─────────┼──────────');

const stopFormulas = [
  { name: 'ZoneLow-0.5ATR [3.5,8%]', fn: (s) => { const raw = s.zoneLow - 0.5 * s.atr; return s.entry * (1 - Math.max(3.5, Math.min(8, (s.entry - raw) / s.entry * 100)) / 100); } },
  { name: 'ZoneLow-0.3ATR [3.5,8%]', fn: (s) => { const raw = s.zoneLow - 0.3 * s.atr; return s.entry * (1 - Math.max(3.5, Math.min(8, (s.entry - raw) / s.entry * 100)) / 100); } },
  { name: 'ZoneLow-0.5ATR [2.5,6%]', fn: (s) => { const raw = s.zoneLow - 0.5 * s.atr; return s.entry * (1 - Math.max(2.5, Math.min(6, (s.entry - raw) / s.entry * 100)) / 100); } },
  { name: 'ZoneLow-0.5ATR [3,7%]  ', fn: (s) => { const raw = s.zoneLow - 0.5 * s.atr; return s.entry * (1 - Math.max(3, Math.min(7, (s.entry - raw) / s.entry * 100)) / 100); } },
  { name: 'Fixed 4%              ', fn: (s) => s.entry * 0.96 },
  { name: 'Fixed 5%              ', fn: (s) => s.entry * 0.95 },
  { name: 'Fixed 6%              ', fn: (s) => s.entry * 0.94 },
  { name: '1.5×ATR below entry   ', fn: (s) => s.entry - 1.5 * s.atr },
  { name: '2.0×ATR below entry   ', fn: (s) => s.entry - 2.0 * s.atr },
  { name: 'ZoneLow (no buffer)   ', fn: (s) => s.zoneLow },
  { name: 'ZoneLow-1% buffer     ', fn: (s) => s.zoneLow * 0.99 },
];

for (const sf of stopFormulas) {
  let wins = 0, stops = 0, totalPnl = 0, totalR = 0;
  for (const s of allSigs) {
    const stopPrice = sf.fn(s);
    const stopPct = (s.entry - stopPrice) / s.entry * 100;
    if (stopPct <= 0) continue;
    let outcome = 'expired', exitPrice = s.forward[Math.min(9, s.forward.length - 1)]?.c || s.entry;
    // T1 target
    const atrPct = s.atr / s.entry * 100;
    const t1Pct = Math.max(3, Math.min(5, 2.15 * atrPct));
    const t1Price = s.entry * (1 + t1Pct / 100);

    for (let d = 0; d < Math.min(10, s.forward.length); d++) {
      if (s.forward[d].l <= stopPrice) { outcome = 'stopped'; exitPrice = stopPrice; break; }
      if (s.forward[d].h >= t1Price && outcome !== 'hit') { outcome = 'hit'; exitPrice = t1Price; }
    }
    if (outcome === 'hit') wins++;
    if (outcome === 'stopped') stops++;
    const pnl = (exitPrice - s.entry) / s.entry * 100;
    totalPnl += pnl;
  }
  const n = allSigs.length;
  const wr = wins / n * 100;
  const stopRate = stops / n * 100;
  const avgPnl = totalPnl / n;
  // Expectancy
  const avgWin = wins > 0 ? allSigs.filter((s, i) => { const sp = sf.fn(s); let o = 'e'; for (let d = 0; d < Math.min(10, s.forward.length); d++) { if (s.forward[d].l <= sp) { o = 's'; break; } const aP = s.atr / s.entry * 100; const t1 = s.entry * (1 + Math.max(3, Math.min(5, 2.15 * aP)) / 100); if (s.forward[d].h >= t1) { o = 'h'; break; } } return o === 'h'; }).reduce((sum, s) => { const aP = s.atr / s.entry * 100; return sum + Math.max(3, Math.min(5, 2.15 * aP)); }, 0) / wins : 0;
  const avgLoss = stops > 0 ? allSigs.filter((s) => { const sp = sf.fn(s); for (let d = 0; d < Math.min(10, s.forward.length); d++) { if (s.forward[d].l <= sp) return true; } return false; }).reduce((sum, s) => sum + (s.entry - sf.fn(s)) / s.entry * 100, 0) / stops : 0;
  const expectancy = (wr / 100) * avgWin - (1 - wr / 100) * avgLoss;
  console.log(`  ${sf.name} │ ${String(n).padStart(7)} │ ${String(stops).padStart(7)} │ ${stopRate.toFixed(0).padStart(6)}% │ ${String(wins).padStart(7)} │ ${wr.toFixed(0).padStart(6)}% │ ${(avgPnl >= 0 ? '+' : '') + avgPnl.toFixed(1) + '%'} │ ${(expectancy >= 0 ? '+' : '') + expectancy.toFixed(2) + '%'}`);
}

// ═══ PART 4: Test different TARGET levels ═══
console.log('\n═══ PART 4: TARGET LEVEL COMPARISON (using current ZoneLow-0.5ATR [3.5,8%] stop) ═══\n');
console.log('  Target formula              │ T1 Hits │ Hit Rate │ Avg Win │ Avg R-mult │ Expectancy');
console.log('  ────────────────────────────┼─────────┼──────────┼─────────┼────────────┼──────────');

const targetFormulas = [
  { name: 'T1: 2.15×ATR [3%,5%] (curr)', fn: (s) => { const ap = s.atr / s.entry * 100; return Math.max(3, Math.min(5, 2.15 * ap)); } },
  { name: 'T1: 2.5×ATR [3%,6%]       ', fn: (s) => { const ap = s.atr / s.entry * 100; return Math.max(3, Math.min(6, 2.5 * ap)); } },
  { name: 'T1: 3.0×ATR [3%,7%]       ', fn: (s) => { const ap = s.atr / s.entry * 100; return Math.max(3, Math.min(7, 3.0 * ap)); } },
  { name: 'T1: 1.5×ATR [2%,4%]       ', fn: (s) => { const ap = s.atr / s.entry * 100; return Math.max(2, Math.min(4, 1.5 * ap)); } },
  { name: 'T1: Fixed 3%              ', fn: () => 3 },
  { name: 'T1: Fixed 4%              ', fn: () => 4 },
  { name: 'T1: Fixed 5%              ', fn: () => 5 },
  { name: 'T1: Fixed 6%              ', fn: () => 6 },
  { name: 'T1: Fixed 8%              ', fn: () => 8 },
  { name: 'T1: 1×Risk (stop distance)', fn: (s) => { const raw = s.zoneLow - 0.5 * s.atr; return Math.max(3.5, Math.min(8, (s.entry - raw) / s.entry * 100)); } },
  { name: 'T1: 1.5×Risk              ', fn: (s) => { const raw = s.zoneLow - 0.5 * s.atr; return Math.max(3.5, Math.min(8, (s.entry - raw) / s.entry * 100)) * 1.5; } },
  { name: 'T1: 2×Risk                ', fn: (s) => { const raw = s.zoneLow - 0.5 * s.atr; return Math.max(3.5, Math.min(8, (s.entry - raw) / s.entry * 100)) * 2; } },
];

for (const tf of targetFormulas) {
  let hits = 0, stops = 0;
  let totalWinPct = 0, totalR = 0;
  for (const s of allSigs) {
    const stopRaw = s.zoneLow - 0.5 * s.atr;
    const stopPct = Math.max(3.5, Math.min(8, (s.entry - stopRaw) / s.entry * 100));
    const stopPrice = s.entry * (1 - stopPct / 100);
    const t1Pct = tf.fn(s);
    const t1Price = s.entry * (1 + t1Pct / 100);
    let outcome = 'expired';
    for (let d = 0; d < Math.min(10, s.forward.length); d++) {
      if (s.forward[d].l <= stopPrice) { outcome = 'stopped'; stops++; break; }
      if (s.forward[d].h >= t1Price) { outcome = 'hit'; hits++; totalWinPct += t1Pct; totalR += t1Pct / stopPct; break; }
    }
  }
  const hitRate = (hits / allSigs.length * 100).toFixed(0);
  const avgWin = hits > 0 ? (totalWinPct / hits).toFixed(1) : '—';
  const avgR = hits > 0 ? (totalR / hits).toFixed(2) : '—';
  const avgLossPct = stops > 0 ? 5.5 : 0; // approximate avg stop
  const expectancy = (hits / allSigs.length) * (hits > 0 ? totalWinPct / hits : 0) - (stops / allSigs.length) * avgLossPct;
  console.log(`  ${tf.name} │ ${String(hits).padStart(7)} │ ${hitRate.padStart(7)}% │ ${('+' + avgWin + '%').padStart(7)} │ ${String(avgR).padStart(10)} │ ${(expectancy >= 0 ? '+' : '') + expectancy.toFixed(2) + '%'}`);
}

// ═══ PART 5: Trailing stop vs fixed stop ═══
console.log('\n═══ PART 5: TRAILING STOP — Does moving SL to breakeven after T1 help? ═══\n');
console.log('  Strategy                     │ Wins │ Stops │ WinRate │ Avg PnL │ Max DD');
console.log('  ─────────────────────────────┼──────┼───────┼─────────┼─────────┼───────');

// Strategy A: Fixed stop, exit at T1
let aWins = 0, aStops = 0, aExpired = 0, aTotalPnl = 0;
for (const s of allSigs) {
  const stopRaw = s.zoneLow - 0.5 * s.atr;
  const stopPct = Math.max(3.5, Math.min(8, (s.entry - stopRaw) / s.entry * 100));
  const stopPrice = s.entry * (1 - stopPct / 100);
  const atrPct = s.atr / s.entry * 100;
  const t1Pct = Math.max(3, Math.min(5, 2.15 * atrPct));
  const t1Price = s.entry * (1 + t1Pct / 100);
  let out = 'expired', exit = s.forward[Math.min(9, s.forward.length - 1)]?.c || s.entry;
  for (let d = 0; d < Math.min(10, s.forward.length); d++) {
    if (s.forward[d].l <= stopPrice) { out = 'stopped'; exit = stopPrice; break; }
    if (s.forward[d].h >= t1Price) { out = 'hit'; exit = t1Price; break; }
  }
  if (out === 'hit') aWins++;
  if (out === 'stopped') aStops++;
  if (out === 'expired') aExpired++;
  aTotalPnl += (exit - s.entry) / s.entry * 100;
}
console.log(`  A: Fixed stop, exit at T1    │ ${String(aWins).padStart(4)} │ ${String(aStops).padStart(5)} │ ${(aWins / allSigs.length * 100).toFixed(0).padStart(6)}% │ ${(aTotalPnl / allSigs.length >= 0 ? '+' : '') + (aTotalPnl / allSigs.length).toFixed(2)}% │`);

// Strategy B: After T1, move SL to breakeven, let T2 run
let bWins = 0, bStops = 0, bTotalPnl = 0;
for (const s of allSigs) {
  const stopRaw = s.zoneLow - 0.5 * s.atr;
  const stopPct = Math.max(3.5, Math.min(8, (s.entry - stopRaw) / s.entry * 100));
  let stopPrice = s.entry * (1 - stopPct / 100);
  const atrPct = s.atr / s.entry * 100;
  const t1Pct = Math.max(3, Math.min(5, 2.15 * atrPct));
  const t1Price = s.entry * (1 + t1Pct / 100);
  const t2Pct = Math.min(5.65, 2.80 * atrPct);
  const t2Price = s.entry * (1 + t2Pct / 100);
  let hitT1 = false, out = 'expired', exit = s.forward[Math.min(14, s.forward.length - 1)]?.c || s.entry;
  for (let d = 0; d < Math.min(15, s.forward.length); d++) {
    if (!hitT1 && s.forward[d].l <= stopPrice) { out = 'stopped'; exit = stopPrice; break; }
    if (!hitT1 && s.forward[d].h >= t1Price) { hitT1 = true; stopPrice = s.entry; } // Move SL to breakeven
    if (hitT1 && s.forward[d].l <= stopPrice) { out = 'breakeven'; exit = s.entry; break; }
    if (hitT1 && s.forward[d].h >= t2Price) { out = 'hit_t2'; exit = t2Price; break; }
  }
  if (out === 'hit_t2') bWins++;
  if (out === 'stopped') bStops++;
  bTotalPnl += (exit - s.entry) / s.entry * 100;
}
console.log(`  B: Trail SL→BE after T1     │ ${String(bWins).padStart(4)} │ ${String(bStops).padStart(5)} │ ${(bWins / allSigs.length * 100).toFixed(0).padStart(6)}% │ ${(bTotalPnl / allSigs.length >= 0 ? '+' : '') + (bTotalPnl / allSigs.length).toFixed(2)}% │`);

// Strategy C: Partial exit model (50% at T1, trail rest)
let cPnl = 0;
for (const s of allSigs) {
  const stopRaw = s.zoneLow - 0.5 * s.atr;
  const stopPct = Math.max(3.5, Math.min(8, (s.entry - stopRaw) / s.entry * 100));
  let stopPrice = s.entry * (1 - stopPct / 100);
  const atrPct = s.atr / s.entry * 100;
  const t1Pct = Math.max(3, Math.min(5, 2.15 * atrPct));
  const t1Price = s.entry * (1 + t1Pct / 100);
  const t2Pct = Math.min(5.65, 2.80 * atrPct);
  const t2Price = s.entry * (1 + t2Pct / 100);
  let hitT1 = false, pnl = 0;
  let exit2 = s.forward[Math.min(14, s.forward.length - 1)]?.c || s.entry;
  for (let d = 0; d < Math.min(15, s.forward.length); d++) {
    if (!hitT1 && s.forward[d].l <= stopPrice) { pnl = -stopPct; break; }
    if (!hitT1 && s.forward[d].h >= t1Price) {
      hitT1 = true;
      pnl += t1Pct * 0.5; // Sell 50% at T1
      stopPrice = s.entry; // Move SL to breakeven for remaining 50%
    }
    if (hitT1 && s.forward[d].l <= stopPrice) { pnl += 0; break; } // Remaining 50% exits at breakeven
    if (hitT1 && s.forward[d].h >= t2Price) { pnl += t2Pct * 0.5; break; } // Remaining 50% hits T2
  }
  if (!hitT1 && pnl === 0) pnl = (exit2 - s.entry) / s.entry * 100; // Expired
  cPnl += pnl;
}
console.log(`  C: 50% at T1, trail rest     │    — │     — │       — │ ${(cPnl / allSigs.length >= 0 ? '+' : '') + (cPnl / allSigs.length).toFixed(2)}% │`);

// ═══ PART 6: The fix — combined best stop + target ═══
console.log('\n═══ PART 6: OPTIMAL COMBINATION — Best stop × best target ═══\n');
console.log('  Combination                             │ Wins │ Stops │ WinRate │ Avg PnL │ Expectancy');
console.log('  ────────────────────────────────────────┼──────┼───────┼─────────┼─────────┼──────────');

const combos = [
  { name: 'Current (ZL-0.5ATR[3.5,8], T1 2.15×ATR)', stopFn: s => { const r = s.zoneLow - 0.5 * s.atr; return s.entry * (1 - Math.max(3.5, Math.min(8, (s.entry - r) / s.entry * 100)) / 100); }, targetFn: s => { const a = s.atr / s.entry * 100; return Math.max(3, Math.min(5, 2.15 * a)); } },
  { name: 'Tighter stop [2.5,6], same target        ', stopFn: s => { const r = s.zoneLow - 0.5 * s.atr; return s.entry * (1 - Math.max(2.5, Math.min(6, (s.entry - r) / s.entry * 100)) / 100); }, targetFn: s => { const a = s.atr / s.entry * 100; return Math.max(3, Math.min(5, 2.15 * a)); } },
  { name: 'Same stop, higher target 3×ATR[3,7]      ', stopFn: s => { const r = s.zoneLow - 0.5 * s.atr; return s.entry * (1 - Math.max(3.5, Math.min(8, (s.entry - r) / s.entry * 100)) / 100); }, targetFn: s => { const a = s.atr / s.entry * 100; return Math.max(3, Math.min(7, 3.0 * a)); } },
  { name: 'Tighter [2.5,6] + higher 3×ATR[3,7]     ', stopFn: s => { const r = s.zoneLow - 0.5 * s.atr; return s.entry * (1 - Math.max(2.5, Math.min(6, (s.entry - r) / s.entry * 100)) / 100); }, targetFn: s => { const a = s.atr / s.entry * 100; return Math.max(3, Math.min(7, 3.0 * a)); } },
  { name: 'Tighter [3,7] + T1=1×Risk                ', stopFn: s => { const r = s.zoneLow - 0.5 * s.atr; return s.entry * (1 - Math.max(3, Math.min(7, (s.entry - r) / s.entry * 100)) / 100); }, targetFn: s => { const r = s.zoneLow - 0.5 * s.atr; return Math.max(3, Math.min(7, (s.entry - r) / s.entry * 100)); } },
  { name: 'ZoneLow-1% + T1=1.5×Risk                 ', stopFn: s => s.zoneLow * 0.99, targetFn: s => { const sp = (s.entry - s.zoneLow * 0.99) / s.entry * 100; return sp * 1.5; } },
];

for (const combo of combos) {
  let wins = 0, stops = 0, totalPnl = 0;
  for (const s of allSigs) {
    const stopPrice = combo.stopFn(s);
    const stopPct = (s.entry - stopPrice) / s.entry * 100;
    if (stopPct <= 0) continue;
    const t1Pct = combo.targetFn(s);
    const t1Price = s.entry * (1 + t1Pct / 100);
    let out = 'expired', exit = s.forward[Math.min(9, s.forward.length - 1)]?.c || s.entry;
    for (let d = 0; d < Math.min(10, s.forward.length); d++) {
      if (s.forward[d].l <= stopPrice) { out = 'stopped'; exit = stopPrice; break; }
      if (s.forward[d].h >= t1Price) { out = 'hit'; exit = t1Price; break; }
    }
    if (out === 'hit') wins++;
    if (out === 'stopped') stops++;
    totalPnl += (exit - s.entry) / s.entry * 100;
  }
  const wr = (wins / allSigs.length * 100).toFixed(0);
  const avgPnl = totalPnl / allSigs.length;
  const avgWin = wins > 0 ? totalPnl / wins : 0; // approximate
  const expectancy = avgPnl;
  console.log(`  ${combo.name} │ ${String(wins).padStart(4)} │ ${String(stops).padStart(5)} │ ${wr.padStart(6)}% │ ${(avgPnl >= 0 ? '+' : '') + avgPnl.toFixed(2) + '%'} │ ${(expectancy >= 0 ? '+' : '') + expectancy.toFixed(2) + '%'}`);
}

console.log('\n' + '█'.repeat(90));
console.log('  INVESTIGATION COMPLETE');
console.log('█'.repeat(90));
