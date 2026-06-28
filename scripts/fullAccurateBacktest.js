// FULL ACCURATE BACKTEST — Uses EVERY filter from stockEngine.ts exactly
// No simplifications. All 4 current param sets on 78 OHLCVs.
// Stop: CLOSE-ONLY [3%,7%], no descending zones, T1: 2.5×ATR [3%,6%]

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];
function pY(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6||isNaN(+p[4])||+p[4]<=0)continue;c.push({o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]});}return c;}
function pN(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<11||isNaN(+p[8])||+p[8]<=0)continue;c.push({o:+p[4],h:+p[5],l:+p[6],c:+p[8],v:+p[10]||0});}return c;}

function computeATR14(c) {
  const a = new Array(c.length).fill(0);
  if (c.length < 15) return a;
  let s = 0;
  for (let i = 1; i <= 14; i++) s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
  a[14] = s / 14;
  for (let i = 15; i < c.length; i++) {
    const tr = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i-1].c), Math.abs(c[i].l - c[i-1].c));
    a[i] = (a[i-1] * 13 + tr) / 14;
  }
  return a;
}

function computeRSI2(c) {
  const r = new Array(c.length).fill(50);
  for (let i = 3; i < c.length; i++) {
    let g = 0, l = 0;
    for (let j = i-1; j <= i; j++) { const d = c[j].c - c[j-1].c; if (d > 0) g += d; else l -= d; }
    const ag = g/2, al = l/2;
    r[i] = al === 0 ? 100 : 100 - 100/(1 + ag/al);
  }
  return r;
}

function computeATRPctPctl120(c, atr, idx) {
  if (idx < 120) return 50;
  const current = c[idx].c > 0 ? atr[idx] / c[idx].c * 100 : 0;
  let below = 0;
  for (let j = idx - 120; j < idx; j++) {
    const v = c[j].c > 0 ? atr[j] / c[j].c * 100 : 0;
    if (v < current) below++;
  }
  return below / 120 * 100;
}

const SD = [];
for (const {dir, format} of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.csv') || f.includes('ALL_SYMBOLS')) continue;
    const c = format === 'nse' ? pN(path.join(dir, f)) : pY(path.join(dir, f));
    if (c.length < 150) continue;
    SD.push({ sym: f.replace('_NS_OHLCV.csv','').replace('.csv',''), c, atr: computeATR14(c), rsi: computeRSI2(c) });
  }
}

// EXACT param sets from stockEngine.ts
const PARAM_SETS = {
  'D20+ v8-DT': {
    minAvgTurnover: 10000000, maxATRPctPctl120: 85,
    maxPre10AvgRangeATR: 0.80, maxPre10ExpCount: 1, expMult: 1.1,
    zoneRangeATR: 1.0, minZone: 6, maxZone: 25, maxTightness: 18.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 0.95,
    maxPre10HighVolCount: 4, highVolMult: 1.35, maxPre10RedVolBias: 2.00,
    breakoutMult: 1.001,
    minExactRangeATR: 1.1, maxExactRangeATR: 5.0,
    minExactVolRatio: 0.80, minExactVolVsPre5: 2.00,
    minCloseLoc: 75, maxUpperWick: 45, minBody: 25, maxCandleRisk: 8.5,
    minUPS: 60, minRSI2: 50,
    minVolExpRatio: 1.75, minCandleQuality: 2,
    maxCloseAboveZone: null,
  },
  'HP15+ v7-UT': {
    minAvgTurnover: 10000000, maxATRPctPctl120: 85,
    maxPre10AvgRangeATR: 0.80, maxPre10ExpCount: 3, expMult: 1.1,
    zoneRangeATR: 1.0, minZone: 4, maxZone: 25, maxTightness: 18.0,
    maxPre10AvgVolRatio: 0.85, maxPre5AvgVolRatio: 1.10,
    maxPre10HighVolCount: 4, highVolMult: 1.35, maxPre10RedVolBias: 2.00,
    breakoutMult: 1.001,
    minExactRangeATR: 1.1, maxExactRangeATR: 5.0,
    minExactVolRatio: 0.80, minExactVolVsPre5: 2.00,
    minCloseLoc: 50, maxUpperWick: 40, minBody: 30, maxCandleRisk: 13.0,
    minUPS: 50, minRSI2: 50,
    minVolExpRatio: null, minCandleQuality: null,
    maxCloseAboveZone: 6.0,
  },
  'E10+ v8-DT': {
    minAvgTurnover: 20000000, maxATRPctPctl120: 60,
    maxPre10AvgRangeATR: 0.80, maxPre10ExpCount: 3, expMult: 1.1,
    zoneRangeATR: 0.95, minZone: 6, maxZone: 25, maxTightness: 18.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 1.00,
    maxPre10HighVolCount: 2, highVolMult: 1.2, maxPre10RedVolBias: 2.00,
    breakoutMult: 1.001,
    minExactRangeATR: 1.5, maxExactRangeATR: 6.0,
    minExactVolRatio: 1.60, minExactVolVsPre5: 2.00,
    minCloseLoc: 75, maxUpperWick: 35, minBody: 25, maxCandleRisk: 8.5,
    minUPS: 25, minRSI2: 50,
    minVolExpRatio: 1.25, minCandleQuality: 2,
    maxCloseAboveZone: null,
  },
  'US8+ v8-DT': {
    minAvgTurnover: 10000000, maxATRPctPctl120: 95,
    maxPre10AvgRangeATR: 0.80, maxPre10ExpCount: 0, expMult: 1.1,
    zoneRangeATR: 0.95, minZone: 8, maxZone: 25, maxTightness: 6.0,
    maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 0.95,
    maxPre10HighVolCount: 4, highVolMult: 1.5, maxPre10RedVolBias: 2.00,
    breakoutMult: 1.001,
    minExactRangeATR: 1.4, maxExactRangeATR: 6.0,
    minExactVolRatio: 1.60, minExactVolVsPre5: 3.50,
    minCloseLoc: 70, maxUpperWick: 30, minBody: 40, maxCandleRisk: 8.5,
    minUPS: 45, minRSI2: 50,
    minVolExpRatio: 1.50, minCandleQuality: 4,
    maxCloseAboveZone: null,
  },
};

function backtest(P) {
  const trades = [];
  for (const {sym, c, atr, rsi} of SD) {
    const n = c.length;
    // Avg turnover check (use last 20 days)
    for (let i = 130; i < n - 21; i++) {
      if (atr[i] <= 0 || c[i].c <= 0) continue;
      const s = c[i];

      // Avg turnover 20d
      let avgTO = 0;
      for (let j = i-20; j < i; j++) avgTO += c[j].c * c[j].v;
      avgTO /= 20;
      if (avgTO < P.minAvgTurnover) continue;

      // ATR% percentile 120
      const atrPctl = computeATRPctPctl120(c, atr, i);
      if (atrPctl > P.maxATRPctPctl120) continue;

      const rng = s.h - s.l;
      if (rng <= 0) continue;

      // Signal candle metrics
      const exactRangeATR = rng / atr[i];
      const closeLoc = (s.c - s.l) / rng * 100;
      const upperWick = (s.h - Math.max(s.c, s.o)) / rng * 100;
      const bodyPct = Math.abs(s.c - s.o) / rng * 100;
      const signalRangePct = rng / s.c * 100;

      // Volume ratios
      let vol20 = 0; for (let j = i-20; j < i; j++) vol20 += c[j].v; vol20 /= 20;
      let vol5 = 0; for (let j = i-5; j < i; j++) vol5 += c[j].v; vol5 /= 5;
      const exactVolRatio = vol20 > 0 ? s.v / vol20 : 0;
      const exactVolVsPre5 = vol5 > 0 ? s.v / vol5 : 0;

      // Pre-10 metrics
      let p10RangeSum = 0, p10ExpCount = 0, p10VolSum = 0, p10HighVolCount = 0, p10RedVolBias = 0;
      for (let j = i-10; j < i; j++) {
        if (j < 1) continue;
        const rATR = (c[j].h - c[j].l) / (atr[j] || 1);
        p10RangeSum += rATR;
        if (rATR > P.expMult) p10ExpCount++;
        const vr = vol20 > 0 ? c[j].v / vol20 : 0;
        p10VolSum += vr;
        if (vr > P.highVolMult) p10HighVolCount++;
        if (c[j].c < c[j].o) p10RedVolBias += (vol20 > 0 ? c[j].v / vol20 : 0);
      }
      const p10AvgRangeATR = p10RangeSum / 10;
      const p10AvgVolRatio = p10VolSum / 10;
      const p10RedBias = p10RedVolBias / 10;

      // Pre-5 vol ratio
      let p5VolSum = 0;
      for (let j = i-5; j < i; j++) { if (j >= 0) p5VolSum += (vol20 > 0 ? c[j].v / vol20 : 0); }
      const p5AvgVolRatio = p5VolSum / 5;

      // Volatility expansion ratio
      const volExpRatio = p10AvgRangeATR > 0 ? exactRangeATR / p10AvgRangeATR : 0;

      // UPS
      let ups = 0;
      if (closeLoc >= 80) ups += 20; else if (closeLoc >= 65) ups += 12;
      if (upperWick <= 20) ups += 20; else if (upperWick <= 35) ups += 12;
      if (bodyPct >= 55) ups += 15; else if (bodyPct >= 35) ups += 9;
      if (exactVolVsPre5 >= 4) ups += 20; else if (exactVolVsPre5 >= 2) ups += 12;
      // Zone tightness and length added after zone found

      // Candle quality
      let cq = 0;
      if (closeLoc >= 65) cq++;
      if (upperWick <= 30) cq++;
      if (bodyPct >= 40) cq++;
      if (exactVolVsPre5 >= 2.5) cq++;
      if (exactRangeATR >= 1.5) cq++;

      // RSI2 check
      if (rsi[i] < P.minRSI2) continue;

      // Apply all pre-zone filters
      if (p10AvgRangeATR > P.maxPre10AvgRangeATR) continue;
      if (p10ExpCount > P.maxPre10ExpCount) continue;
      if (p10AvgVolRatio > P.maxPre10AvgVolRatio) continue;
      if (p5AvgVolRatio > P.maxPre5AvgVolRatio) continue;
      if (p10HighVolCount > P.maxPre10HighVolCount) continue;
      if (P.maxPre10RedVolBias != null && p10RedBias > P.maxPre10RedVolBias) continue;

      // Signal candle filters
      if (exactRangeATR < P.minExactRangeATR || exactRangeATR > P.maxExactRangeATR) continue;
      if (exactVolRatio < P.minExactVolRatio) continue;
      if (exactVolVsPre5 < P.minExactVolVsPre5) continue;
      if (closeLoc < P.minCloseLoc) continue;
      if (upperWick > P.maxUpperWick) continue;
      if (bodyPct < P.minBody) continue;
      if (signalRangePct > P.maxCandleRisk) continue;
      if (P.minVolExpRatio != null && volExpRatio < P.minVolExpRatio) continue;
      if (P.minCandleQuality != null && cq < P.minCandleQuality) continue;

      // Zone detection with descending rejection
      let zone = null;
      for (let zL = P.maxZone; zL >= P.minZone; zL--) {
        const zS = i - zL;
        if (zS < 1) continue;
        let zH = -Infinity, zLo = Infinity, ok = true;
        for (let j = zS; j < i; j++) {
          zH = Math.max(zH, c[j].h);
          zLo = Math.min(zLo, c[j].l);
          if ((c[j].h - c[j].l) / (atr[j] || 1) > P.zoneRangeATR) ok = false;
        }
        if (!ok) continue;
        const tight = zLo > 0 ? (zH - zLo) / zLo * 100 : 999;
        if (tight > P.maxTightness) continue;
        // Descending zone rejection
        const mid = Math.floor(zL / 2);
        let fhH = -Infinity, shH = -Infinity, fhL = Infinity, shL = Infinity;
        for (let j = zS; j < zS + mid; j++) { fhH = Math.max(fhH, c[j].h); fhL = Math.min(fhL, c[j].l); }
        for (let j = zS + mid; j < i; j++) { shH = Math.max(shH, c[j].h); shL = Math.min(shL, c[j].l); }
        if (shH < fhH * 0.995 && shL <= fhL * 1.005) continue;
        zone = { zH, zL: zLo, len: zL, tight };
        break;
      }
      if (!zone) continue;

      // Breakout check
      if (s.c <= zone.zH * P.breakoutMult) continue;

      // closeAboveZone check
      if (P.maxCloseAboveZone != null) {
        const cabp = zone.zH > 0 ? (s.c - zone.zH) / zone.zH * 100 : 0;
        if (cabp > P.maxCloseAboveZone) continue;
      }

      // Add zone contribution to UPS
      if (zone.tight <= 5) ups += 15; else if (zone.tight <= 15) ups += 9;
      if (zone.len >= 12) ups += 10; else if (zone.len >= 6) ups += 6;
      if (ups < P.minUPS) continue;

      // ═══ SIGNAL PASSED ALL FILTERS — simulate trade ═══
      const rawStop = zone.zL - 0.5 * atr[i];
      const stopPct = Math.max(3, Math.min(7, (s.c - rawStop) / s.c * 100));
      const stopPrice = s.c * (1 - stopPct / 100);
      const atrPct = atr[i] / s.c * 100;
      const t1Pct = Math.max(3, Math.min(6, 2.5 * atrPct));
      const t2Pct = Math.min(5.65, 2.80 * atrPct);
      const t3Pct = atrPct < 1.5 ? 5 : atrPct <= 3 ? 7 : 10;

      let mfe = 0, mae = 0, outcome = 'expired', hitT1 = false, hitT2 = false, hitT3 = false, exitDay = 10;
      for (let d = 1; d <= 10 && i + d < n; d++) {
        const cd = c[i + d];
        const hp = (cd.h - s.c) / s.c * 100;
        const lp = (cd.l - s.c) / s.c * 100;
        if (hp > mfe) mfe = hp;
        if (lp < mae) mae = lp;
        // CLOSE-ONLY stop
        if (cd.c <= stopPrice && !hitT1) { outcome = 'stopped'; exitDay = d; break; }
        if (cd.h >= s.c * (1 + t1Pct / 100)) hitT1 = true;
        if (cd.h >= s.c * (1 + t2Pct / 100)) hitT2 = true;
        if (cd.h >= s.c * (1 + t3Pct / 100)) hitT3 = true;
      }
      if (outcome !== 'stopped') {
        outcome = hitT3 ? 'hit_t3' : hitT2 ? 'hit_t2' : hitT1 ? 'hit_t1' : 'expired';
      }
      const exitPrice = outcome === 'stopped' ? stopPrice : hitT1 ? s.c * (1 + t1Pct / 100) : c[Math.min(i + 10, n - 1)].c;
      const pnlPct = (exitPrice - s.c) / s.c * 100;

      trades.push({ sym, outcome, pnlPct, mfe, mae, stopPct, t1Pct, hitT1, hitT2, hitT3, exitDay });
    }
  }
  return trades;
}

console.log('█'.repeat(90));
console.log(`  FULL ACCURATE BACKTEST — ${SD.length} OHLCVs`);
console.log('  Every filter from stockEngine.ts applied exactly');
console.log('  Stop: CLOSE-ONLY [3%,7%], No descending zones');
console.log('█'.repeat(90));

console.log('\n═══ RESULTS ═══\n');
console.log('  Set            │ Sigs │ Wins │ Stops │ Exprd │ WR    │ T1Hit │ T2Hit │ T3Hit │ AvgMFE │ AvgMAE │ FalseStop │ AvgPnL │ PF');
console.log('  ───────────────┼──────┼──────┼───────┼───────┼───────┼───────┼───────┼───────┼────────┼────────┼───────────┼────────┼──────');

for (const [name, params] of Object.entries(PARAM_SETS)) {
  const trades = backtest(params);
  const wins = trades.filter(t => t.outcome.startsWith('hit'));
  const stops = trades.filter(t => t.outcome === 'stopped');
  const expired = trades.filter(t => t.outcome === 'expired');
  const falseStops = stops.filter(t => t.mfe >= 3);

  if (trades.length === 0) {
    console.log(`  ${name.padEnd(15)} │    0 │    — │     — │     — │     — │     — │     — │     — │      — │      — │         — │      — │    —`);
    continue;
  }

  const wr = (wins.length / trades.length * 100).toFixed(1);
  const t1r = (trades.filter(t => t.hitT1).length / trades.length * 100).toFixed(0);
  const t2r = (trades.filter(t => t.hitT2).length / trades.length * 100).toFixed(0);
  const t3r = (trades.filter(t => t.hitT3).length / trades.length * 100).toFixed(0);
  const avgMfe = (trades.reduce((s, t) => s + t.mfe, 0) / trades.length).toFixed(1);
  const avgMae = (trades.reduce((s, t) => s + t.mae, 0) / trades.length).toFixed(1);
  const fsPct = stops.length > 0 ? (falseStops.length / stops.length * 100).toFixed(0) : '—';
  const avgPnl = (trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length).toFixed(2);
  const grossW = wins.reduce((s, t) => s + t.pnlPct, 0);
  const grossL = Math.abs(stops.reduce((s, t) => s + t.pnlPct, 0));
  const pf = grossL > 0 ? (grossW / grossL).toFixed(2) : wins.length > 0 ? '∞' : '0';

  console.log(`  ${name.padEnd(15)} │ ${String(trades.length).padStart(4)} │ ${String(wins.length).padStart(4)} │ ${String(stops.length).padStart(5)} │ ${String(expired.length).padStart(5)} │ ${wr.padStart(4)}% │ ${t1r.padStart(4)}% │ ${t2r.padStart(4)}% │ ${t3r.padStart(4)}% │ ${('+'+avgMfe+'%').padStart(6)} │ ${avgMae.padStart(5)}% │ ${(fsPct+'%').padStart(9)} │ ${(+avgPnl>=0?'+':'')+avgPnl+'%'} │ ${pf.padStart(4)}`);
}

// Expectancy
console.log('\n═══ EXPECTANCY ═══\n');
console.log('  Set            │ AvgWin │ AvgLoss │ WR    │ Expectancy │ Annual(50 trades)');
console.log('  ───────────────┼────────┼─────────┼───────┼────────────┼──────────────────');
for (const [name, params] of Object.entries(PARAM_SETS)) {
  const trades = backtest(params);
  if (trades.length < 3) continue;
  const wins = trades.filter(t => t.outcome.startsWith('hit'));
  const stops = trades.filter(t => t.outcome === 'stopped');
  const avgW = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgL = stops.length > 0 ? Math.abs(stops.reduce((s, t) => s + t.pnlPct, 0) / stops.length) : 0;
  const wr = wins.length / trades.length;
  const exp = wr * avgW - (1 - wr) * avgL;
  console.log(`  ${name.padEnd(15)} │ ${('+'+avgW.toFixed(1)+'%').padStart(6)} │ ${('-'+avgL.toFixed(1)+'%').padStart(7)} │ ${(wr*100).toFixed(0).padStart(4)}% │ ${(exp>=0?'+':'')+exp.toFixed(2)+'%'} │ Rs.${(exp/100*100000*50).toFixed(0)}`);
}

console.log('\n' + '█'.repeat(90));
console.log('  FULL ACCURATE BACKTEST COMPLETE');
console.log('█'.repeat(90));
