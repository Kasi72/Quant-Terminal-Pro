// FULL 4-PARAM SET BACKTEST on all 29 Portfolio OHLCV files
// Tests: D20+, HP15+, E10+, US8+ — v5-WLB parameters
// Metrics: Hit rate, MFE, drawdown, R-mult, win/loss, stopped trades

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
    const oN = +o, hN = +h, lN = +lo, cN = +cl, vN = +v;
    if (isNaN(cN) || cN <= 0) continue;
    c.push({ date, o: oN, h: hN, l: lN, c: cN, v: vN });
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

function ema(arr, period) {
  const out = new Array(arr.length).fill(0);
  out[0] = arr[0];
  const k = 2 / (period + 1);
  for (let i = 1; i < arr.length; i++) out[i] = arr[i] * k + out[i - 1] * (1 - k);
  return out;
}

function rsi2(c) {
  const r = new Array(c.length).fill(50);
  if (c.length < 4) return r;
  for (let i = 3; i < c.length; i++) {
    let gains = 0, losses = 0;
    for (let j = i - 1; j <= i; j++) {
      const d = c[j].c - c[j - 1].c;
      if (d > 0) gains += d; else losses -= d;
    }
    const avgG = gains / 2, avgL = losses / 2;
    r[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return r;
}

// v5-WLB Param Sets
const PARAM_SETS = {
  'D20+': {
    minZone: 4, maxZone: 25, maxRangeATR: 1.0, minTightness: 0, maxTightness: 15,
    minPre10AvgRangeATR: 0, maxPre10AvgRangeATR: 0.85, minExpansionCount: 0, maxExpansionCount: 3,
    minExactRangeATR: 0.8, minExactVolRatio: 1.2, minExactVolVsPre5: 1.5,
    minCloseLoc: 55, maxUpperWick: 45, minBody: 25,
    rsi2Max: 92, minUPS: 20, minCandleQuality: 2
  },
  'HP15+': {
    minZone: 5, maxZone: 25, maxRangeATR: 1.0, minTightness: 0, maxTightness: 12,
    minPre10AvgRangeATR: 0, maxPre10AvgRangeATR: 0.80, minExpansionCount: 0, maxExpansionCount: 2,
    minExactRangeATR: 1.0, minExactVolRatio: 1.4, minExactVolVsPre5: 2.0,
    minCloseLoc: 60, maxUpperWick: 40, minBody: 30,
    rsi2Max: 90, minUPS: 30, minCandleQuality: 3
  },
  'E10+': {
    minZone: 6, maxZone: 25, maxRangeATR: 0.95, minTightness: 0, maxTightness: 10,
    minPre10AvgRangeATR: 0, maxPre10AvgRangeATR: 0.75, minExpansionCount: 0, maxExpansionCount: 2,
    minExactRangeATR: 1.2, minExactVolRatio: 1.6, minExactVolVsPre5: 2.5,
    minCloseLoc: 65, maxUpperWick: 35, minBody: 35,
    rsi2Max: 88, minUPS: 40, minCandleQuality: 3
  },
  'US8+': {
    minZone: 7, maxZone: 25, maxRangeATR: 0.90, minTightness: 0, maxTightness: 8,
    minPre10AvgRangeATR: 0, maxPre10AvgRangeATR: 0.70, minExpansionCount: 0, maxExpansionCount: 1,
    minExactRangeATR: 1.4, minExactVolRatio: 1.8, minExactVolVsPre5: 3.0,
    minCloseLoc: 70, maxUpperWick: 30, minBody: 40,
    rsi2Max: 85, minUPS: 50, minCandleQuality: 4
  }
};

function computeSignals(candles, params) {
  const n = candles.length;
  if (n < 60) return [];
  const a = atr14(candles);
  const closes = candles.map(c => c.c);
  const ema8 = ema(closes, 8), ema21 = ema(closes, 21), ema50 = ema(closes, 50);
  const rsiArr = rsi2(candles);
  const signals = [];

  for (let i = 30; i < n - 11; i++) {
    if (a[i] <= 0 || candles[i].c <= 0) continue;
    const s = candles[i];
    const range = s.h - s.l;
    if (range <= 0) continue;

    // Exact candle metrics
    const exactRangeATR = range / a[i];
    const closeLoc = (s.c - s.l) / range * 100;
    const upperWick = (s.h - Math.max(s.c, s.o)) / range * 100;
    const bodyPct = Math.abs(s.c - s.o) / range * 100;

    // Volume ratios
    let vol20 = 0;
    for (let j = i - 20; j < i; j++) { if (j >= 0) vol20 += candles[j].v; }
    vol20 /= 20;
    let vol5 = 0;
    for (let j = i - 5; j < i; j++) { if (j >= 0) vol5 += candles[j].v; }
    vol5 /= 5;
    const exactVolRatio = vol20 > 0 ? s.v / vol20 : 0;
    const exactVolVsPre5 = vol5 > 0 ? s.v / vol5 : 0;

    // Pre-10 metrics
    let pre10RangeSum = 0, pre10ExpCount = 0;
    for (let j = i - 10; j < i; j++) {
      if (j < 1) continue;
      const rATR = (candles[j].h - candles[j].l) / (a[j] || 1);
      pre10RangeSum += rATR;
      if (rATR > 1.1) pre10ExpCount++;
    }
    const pre10AvgRangeATR = pre10RangeSum / 10;

    // Find compression zone
    let zone = null;
    for (let zL = params.maxZone; zL >= params.minZone; zL--) {
      const zS = i - zL;
      if (zS < 1) continue;
      let zH = -Infinity, zLo = Infinity, ok = true;
      for (let j = zS; j < i; j++) {
        zH = Math.max(zH, candles[j].h);
        zLo = Math.min(zLo, candles[j].l);
        if ((candles[j].h - candles[j].l) / (a[j] || 1) > params.maxRangeATR) ok = false;
      }
      if (!ok) continue;
      const tight = zLo > 0 ? (zH - zLo) / zLo * 100 : 999;
      if (tight > params.maxTightness) continue;
      zone = { zH, zL: zLo, len: zL, tight };
      break;
    }
    if (!zone) continue;
    if (s.c <= zone.zH * 1.001) continue; // Must break above zone high

    // UPS (simplified)
    let ups = 0;
    if (closeLoc >= 80) ups += 20; else if (closeLoc >= 65) ups += 12;
    if (upperWick <= 20) ups += 20; else if (upperWick <= 35) ups += 12;
    if (bodyPct >= 55) ups += 15; else if (bodyPct >= 35) ups += 9;
    if (exactVolVsPre5 >= 4) ups += 20; else if (exactVolVsPre5 >= 2) ups += 12;
    if (zone.tight <= 5) ups += 15; else if (zone.tight <= 15) ups += 9;
    if (zone.len >= 12) ups += 10; else if (zone.len >= 6) ups += 6;

    // Candle quality
    let cq = 0;
    if (closeLoc >= 65) cq++;
    if (upperWick <= 30) cq++;
    if (bodyPct >= 40) cq++;
    if (exactVolVsPre5 >= 2.5) cq++;
    if (exactRangeATR >= 1.5) cq++;

    // Check params
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

    // Stop loss: ZoneLow - 0.5×ATR, clamped [3.5%, 8%]
    const rawStop = zone.zL - 0.5 * a[i];
    const stopPct = Math.max(3.5, Math.min(8, (s.c - rawStop) / s.c * 100));
    const stopPrice = s.c * (1 - stopPct / 100);

    // Targets
    const atrPct = a[i] / s.c * 100;
    const t1Pct = Math.max(3, Math.min(5, 2.15 * atrPct));
    const t2Pct = Math.min(5.65, 2.80 * atrPct);
    const t3Pct = atrPct <= 2 ? 6.5 : atrPct <= 3 ? 8 : 10;

    // Forward simulation (10 days)
    let mfe = 0, mae = 0, outcome = 'expired', exitDay = 10, exitPrice = 0;
    let hitT1 = false, hitT2 = false, hitT3 = false;
    for (let d = 1; d <= 10 && i + d < n; d++) {
      const cd = candles[i + d];
      const highPct = (cd.h - s.c) / s.c * 100;
      const lowPct = (cd.l - s.c) / s.c * 100;
      if (highPct > mfe) mfe = highPct;
      if (lowPct < mae) mae = lowPct;
      // Check stop
      if (cd.l <= stopPrice) { outcome = 'stopped'; exitDay = d; exitPrice = stopPrice; break; }
      // Check targets
      if (!hitT1 && cd.h >= s.c * (1 + t1Pct / 100)) hitT1 = true;
      if (!hitT2 && cd.h >= s.c * (1 + t2Pct / 100)) hitT2 = true;
      if (!hitT3 && cd.h >= s.c * (1 + t3Pct / 100)) hitT3 = true;
    }
    if (outcome !== 'stopped') {
      if (hitT3) outcome = 'hit_t3';
      else if (hitT2) outcome = 'hit_t2';
      else if (hitT1) outcome = 'hit_t1';
      const lastIdx = Math.min(i + 10, n - 1);
      exitPrice = candles[lastIdx].c;
      exitDay = lastIdx - i;
    }
    const pnlPct = (exitPrice - s.c) / s.c * 100;
    const rMult = stopPct > 0 ? pnlPct / stopPct : 0;

    signals.push({
      sym: files[0], idx: i, date: s.date, entry: s.c, stop: stopPrice, stopPct,
      t1Pct, t2Pct, t3Pct, outcome, exitDay, exitPrice, pnlPct, rMult,
      mfe, mae, hitT1, hitT2, hitT3, closeLoc, ups, cq, exactRangeATR, exactVolRatio
    });
  }
  return signals;
}

console.log('█'.repeat(90));
console.log('  FULL 4-PARAM SET BACKTEST — 29 Portfolio OHLCV Files');
console.log('  v5-WLB Parameters: D20+, HP15+, E10+, US8+');
console.log('█'.repeat(90));

const allResults = {};
for (const psName of Object.keys(PARAM_SETS)) allResults[psName] = [];

for (const file of files) {
  const c = parseCSV(path.join(DIR, file));
  if (c.length < 60) continue;
  const sym = file.replace('_NS_OHLCV.csv', '');

  for (const [psName, params] of Object.entries(PARAM_SETS)) {
    const sigs = computeSignals(c, params);
    for (const s of sigs) { s.sym = sym; allResults[psName].push(s); }
  }
}

// ═══ PART 1: Summary per param set ═══
console.log('\n═══ PART 1: SUMMARY PER PARAM SET ═══\n');
console.log('  Param Set │ Signals │ Wins │ Stops │ Expired │ WinRate │ AvgMFE │ AvgMAE │ AvgPnL │ AvgR │ ProfitFactor');
console.log('  ──────────┼─────────┼──────┼───────┼─────────┼─────────┼────────┼────────┼────────┼──────┼────────────');

for (const [ps, sigs] of Object.entries(allResults)) {
  if (sigs.length === 0) { console.log(`  ${ps.padEnd(9)} │       0 │    — │     — │       — │       — │      — │      — │      — │    — │          —`); continue; }
  const wins = sigs.filter(s => s.outcome.startsWith('hit'));
  const stops = sigs.filter(s => s.outcome === 'stopped');
  const expired = sigs.filter(s => s.outcome === 'expired');
  const wr = (wins.length / sigs.length * 100).toFixed(1);
  const avgMfe = (sigs.reduce((s, v) => s + v.mfe, 0) / sigs.length).toFixed(1);
  const avgMae = (sigs.reduce((s, v) => s + v.mae, 0) / sigs.length).toFixed(1);
  const avgPnl = (sigs.reduce((s, v) => s + v.pnlPct, 0) / sigs.length).toFixed(2);
  const avgR = (sigs.reduce((s, v) => s + v.rMult, 0) / sigs.length).toFixed(2);
  const grossWin = wins.reduce((s, v) => s + v.pnlPct, 0);
  const grossLoss = Math.abs(stops.reduce((s, v) => s + v.pnlPct, 0));
  const pf = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : '∞';
  console.log(`  ${ps.padEnd(9)} │ ${String(sigs.length).padStart(7)} │ ${String(wins.length).padStart(4)} │ ${String(stops.length).padStart(5)} │ ${String(expired.length).padStart(7)} │ ${wr.padStart(6)}% │ ${('+' + avgMfe + '%').padStart(6)} │ ${avgMae.padStart(5)}% │ ${(+avgPnl >= 0 ? '+' : '') + avgPnl + '%'} │ ${avgR.padStart(4)} │ ${String(pf).padStart(10)}`);
}

// ═══ PART 2: Target hit analysis ═══
console.log('\n═══ PART 2: TARGET HIT ANALYSIS ═══\n');
console.log('  Param Set │ T1 Hit │ T2 Hit │ T3 Hit │ T1→T2% │ T2→T3% │ Full Run │ Stopped');
console.log('  ──────────┼────────┼────────┼────────┼────────┼────────┼──────────┼────────');
for (const [ps, sigs] of Object.entries(allResults)) {
  if (sigs.length === 0) continue;
  const t1 = sigs.filter(s => s.hitT1).length;
  const t2 = sigs.filter(s => s.hitT2).length;
  const t3 = sigs.filter(s => s.hitT3).length;
  const stops = sigs.filter(s => s.outcome === 'stopped').length;
  const t1t2 = t1 > 0 ? (t2 / t1 * 100).toFixed(0) : '—';
  const t2t3 = t2 > 0 ? (t3 / t2 * 100).toFixed(0) : '—';
  console.log(`  ${ps.padEnd(9)} │ ${(t1/sigs.length*100).toFixed(0).padStart(5)}% │ ${(t2/sigs.length*100).toFixed(0).padStart(5)}% │ ${(t3/sigs.length*100).toFixed(0).padStart(5)}% │ ${String(t1t2).padStart(5)}% │ ${String(t2t3).padStart(5)}% │ ${(t3/sigs.length*100).toFixed(0).padStart(7)}% │ ${(stops/sigs.length*100).toFixed(0).padStart(6)}%`);
}

// ═══ PART 3: Per-stock breakdown ═══
console.log('\n═══ PART 3: PER-STOCK BREAKDOWN (D20+ only, sorted by signal count) ═══\n');
console.log('  Stock        │ Signals │ Wins │ Stops │ WinRate │ Avg MFE │ Avg PnL │ Best Trade');
console.log('  ─────────────┼─────────┼──────┼───────┼─────────┼─────────┼─────────┼──────────');
const byStock = {};
for (const s of allResults['D20+']) {
  if (!byStock[s.sym]) byStock[s.sym] = [];
  byStock[s.sym].push(s);
}
for (const [sym, sigs] of Object.entries(byStock).sort((a, b) => b[1].length - a[1].length)) {
  const wins = sigs.filter(s => s.outcome.startsWith('hit'));
  const stops = sigs.filter(s => s.outcome === 'stopped');
  const wr = (wins.length / sigs.length * 100).toFixed(0);
  const avgMfe = (sigs.reduce((s, v) => s + v.mfe, 0) / sigs.length).toFixed(1);
  const avgPnl = (sigs.reduce((s, v) => s + v.pnlPct, 0) / sigs.length).toFixed(1);
  const best = sigs.reduce((b, s) => s.mfe > b.mfe ? s : b, sigs[0]);
  console.log(`  ${sym.padEnd(13)} │ ${String(sigs.length).padStart(7)} │ ${String(wins.length).padStart(4)} │ ${String(stops.length).padStart(5)} │ ${wr.padStart(6)}% │ ${('+'+avgMfe+'%').padStart(7)} │ ${(+avgPnl>=0?'+':'')+avgPnl+'%'} │ +${best.mfe.toFixed(1)}% (${best.date})`);
}

// ═══ PART 4: Overlap — signals passing multiple param sets ═══
console.log('\n═══ PART 4: MULTI-SET OVERLAP — Do multiple sets agreeing improve results? ═══\n');
// Build a map: sym+idx → which sets fired
const sigMap = {};
for (const [ps, sigs] of Object.entries(allResults)) {
  for (const s of sigs) {
    const key = `${s.sym}_${s.idx}`;
    if (!sigMap[key]) sigMap[key] = { ...s, sets: [] };
    sigMap[key].sets.push(ps);
  }
}
console.log('  Sets passing │ Signals │ Wins │ WinRate │ Avg MFE │ Avg PnL │ Quality');
console.log('  ─────────────┼─────────┼──────┼─────────┼─────────┼─────────┼────────');
for (const count of [1, 2, 3, 4]) {
  const grp = Object.values(sigMap).filter(s => s.sets.length >= count);
  if (grp.length < 3) continue;
  const wins = grp.filter(s => s.outcome.startsWith('hit'));
  const wr = (wins.length / grp.length * 100).toFixed(1);
  const avgMfe = (grp.reduce((s, v) => s + v.mfe, 0) / grp.length).toFixed(1);
  const avgPnl = (grp.reduce((s, v) => s + v.pnlPct, 0) / grp.length).toFixed(2);
  const quality = +wr >= 55 ? '★★★' : +wr >= 45 ? '★★' : +wr >= 35 ? '★' : '';
  console.log(`  ≥${count} sets      │ ${String(grp.length).padStart(7)} │ ${String(wins.length).padStart(4)} │ ${wr.padStart(6)}% │ ${('+'+avgMfe+'%').padStart(7)} │ ${(+avgPnl>=0?'+':'')+avgPnl+'%'} │ ${quality}`);
}

// ═══ PART 5: Stop loss analysis ═══
console.log('\n═══ PART 5: STOP LOSS ANALYSIS ═══\n');
for (const [ps, sigs] of Object.entries(allResults)) {
  const stops = sigs.filter(s => s.outcome === 'stopped');
  if (stops.length === 0) continue;
  const avgStopDay = (stops.reduce((s, v) => s + v.exitDay, 0) / stops.length).toFixed(1);
  const avgStopPct = (stops.reduce((s, v) => s + v.pnlPct, 0) / stops.length).toFixed(1);
  const falseStops = stops.filter(s => s.mfe >= 3).length; // Had +3% MFE but still stopped
  console.log(`  ${ps}: ${stops.length} stops, avg day ${avgStopDay}, avg loss ${avgStopPct}%, false stops (MFE≥3%): ${falseStops} (${(falseStops/stops.length*100).toFixed(0)}%)`);
}

// ═══ PART 6: Expectancy calculation ═══
console.log('\n═══ PART 6: EXPECTANCY (Edge per trade) ═══\n');
console.log('  Param Set │ Avg Win │ Avg Loss │ WinRate │ Expectancy │ Per Rs.100K │ Annual (50 trades)');
console.log('  ──────────┼─────────┼──────────┼─────────┼────────────┼─────────────┼──────────────────');
for (const [ps, sigs] of Object.entries(allResults)) {
  if (sigs.length < 5) continue;
  const wins = sigs.filter(s => s.outcome.startsWith('hit'));
  const stops = sigs.filter(s => s.outcome === 'stopped');
  const avgWin = wins.length > 0 ? wins.reduce((s, v) => s + v.pnlPct, 0) / wins.length : 0;
  const avgLoss = stops.length > 0 ? Math.abs(stops.reduce((s, v) => s + v.pnlPct, 0) / stops.length) : 0;
  const wr = wins.length / sigs.length;
  const expectancy = wr * avgWin - (1 - wr) * avgLoss;
  const per100k = expectancy / 100 * 100000;
  const annual = per100k * 50;
  console.log(`  ${ps.padEnd(9)} │ ${('+'+avgWin.toFixed(1)+'%').padStart(7)} │ ${('-'+avgLoss.toFixed(1)+'%').padStart(8)} │ ${(wr*100).toFixed(0).padStart(6)}% │ ${(expectancy>=0?'+':'')+expectancy.toFixed(2)+'%'} │ Rs.${per100k.toFixed(0).padStart(7)} │ Rs.${annual.toFixed(0).padStart(10)}`);
}

// ═══ PART 7: Monthly distribution ═══
console.log('\n═══ PART 7: TIME DISTRIBUTION — When do signals fire? ═══\n');
const monthlyD20 = {};
for (const s of allResults['D20+']) {
  // Parse date
  const parts = s.date.split('-');
  if (parts.length >= 3) {
    const mon = parts[1] || 'Unk';
    if (!monthlyD20[mon]) monthlyD20[mon] = { total: 0, wins: 0 };
    monthlyD20[mon].total++;
    if (s.outcome.startsWith('hit')) monthlyD20[mon].wins++;
  }
}
console.log('  Month │ Signals │ Wins │ WinRate');
console.log('  ──────┼─────────┼──────┼────────');
for (const [mon, d] of Object.entries(monthlyD20).sort((a, b) => b[1].total - a[1].total)) {
  console.log(`  ${mon.padEnd(5)} │ ${String(d.total).padStart(7)} │ ${String(d.wins).padStart(4)} │ ${(d.wins / d.total * 100).toFixed(0).padStart(6)}%`);
}

console.log('\n' + '█'.repeat(90));
console.log('  BACKTEST COMPLETE');
console.log('█'.repeat(90));
