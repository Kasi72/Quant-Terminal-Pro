// FALSE STOP INVESTIGATION + PARAM HYPER-TUNING on 78 OHLCV files
// Goal: Reduce 37% false stop rate + maximize profit factor & win rate

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];

function parseYahoo(fp) {
  const l = fs.readFileSync(fp, 'utf8').trim().split('\n'); const c = [];
  for (let i = 1; i < l.length; i++) { const p = l[i].split(','); if (p.length < 6 || isNaN(+p[4]) || +p[4] <= 0) continue; c.push({ date: p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] }); } return c;
}
function parseNSE(fp) {
  const l = fs.readFileSync(fp, 'utf8').trim().split('\n'); const c = [];
  for (let i = 1; i < l.length; i++) { const p = l[i].split(','); if (p.length < 11 || isNaN(+p[8]) || +p[8] <= 0) continue; c.push({ date: p[0], o: +p[4], h: +p[5], l: +p[6], c: +p[8], v: +p[10] || 0 }); } return c;
}
function atr14(c) {
  const a = new Array(c.length).fill(0); if (c.length < 15) return a;
  let s = 0; for (let i = 1; i <= 14; i++) s += Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c));
  a[14] = s / 14; for (let i = 15; i < c.length; i++) { const t = Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)); a[i] = (a[i - 1] * 13 + t) / 14; } return a;
}
function rsi2(c) {
  const r = new Array(c.length).fill(50);
  for (let i = 3; i < c.length; i++) { let g = 0, l = 0; for (let j = i - 1; j <= i; j++) { const d = c[j].c - c[j - 1].c; if (d > 0) g += d; else l -= d; } r[i] = l === 0 ? 100 : 100 - 100 / (1 + g / 2 / (l / 2)); } return r;
}

const stockData = [];
for (const { dir, format } of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.csv') || f.includes('ALL_SYMBOLS')) continue;
    const c = format === 'nse' ? parseNSE(path.join(dir, f)) : parseYahoo(path.join(dir, f));
    if (c.length < 60) continue;
    stockData.push({ sym: f.replace('_NS_OHLCV.csv', '').replace('.csv', ''), c, a: atr14(c), rsi: rsi2(c) });
  }
}

function simulate(params, stopConfig) {
  const results = [];
  for (const { sym, c, a, rsi } of stockData) {
    const n = c.length;
    for (let i = 30; i < n - 11; i++) {
      if (a[i] <= 0 || c[i].c <= 0) continue;
      const s = c[i], range = s.h - s.l; if (range <= 0) continue;
      const exactRangeATR = range / a[i];
      const closeLoc = (s.c - s.l) / range * 100;
      const upperWick = (s.h - Math.max(s.c, s.o)) / range * 100;
      const bodyPct = Math.abs(s.c - s.o) / range * 100;
      let vol20 = 0; for (let j = i - 20; j < i; j++) { if (j >= 0) vol20 += c[j].v; } vol20 /= 20;
      let vol5 = 0; for (let j = i - 5; j < i; j++) { if (j >= 0) vol5 += c[j].v; } vol5 /= 5;
      const exactVolRatio = vol20 > 0 ? s.v / vol20 : 0;
      const exactVolVsPre5 = vol5 > 0 ? s.v / vol5 : 0;
      let pre10RangeSum = 0, pre10ExpCount = 0;
      for (let j = i - 10; j < i; j++) { if (j < 1) continue; pre10RangeSum += (c[j].h - c[j].l) / (a[j] || 1); if ((c[j].h - c[j].l) / (a[j] || 1) > 1.1) pre10ExpCount++; }
      const pre10AvgRangeATR = pre10RangeSum / 10;

      let zone = null;
      for (let zL = params.maxZone; zL >= params.minZone; zL--) {
        const zS = i - zL; if (zS < 1) continue;
        let zH = -Infinity, zLo = Infinity, ok = true;
        for (let j = zS; j < i; j++) { zH = Math.max(zH, c[j].h); zLo = Math.min(zLo, c[j].l); if ((c[j].h - c[j].l) / (a[j] || 1) > params.maxRangeATR) ok = false; }
        if (!ok) continue;
        const tight = zLo > 0 ? (zH - zLo) / zLo * 100 : 999;
        if (tight > params.maxTightness) continue;
        zone = { zH, zL: zLo, len: zL, tight }; break;
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

      if (exactRangeATR < params.minExactRangeATR || exactVolRatio < params.minExactVolRatio || exactVolVsPre5 < params.minExactVolVsPre5) continue;
      if (closeLoc < params.minCloseLoc || upperWick > params.maxUpperWick || bodyPct < params.minBody) continue;
      if (pre10AvgRangeATR > params.maxPre10AvgRangeATR || pre10ExpCount > params.maxExpansionCount) continue;
      if (rsi[i] > params.rsi2Max || ups < params.minUPS || cq < params.minCandleQuality) continue;

      // Stop calculation
      const sc = stopConfig;
      const rawStop = zone.zL - sc.atrMult * a[i];
      const stopPct = Math.max(sc.floor, Math.min(sc.cap, (s.c - rawStop) / s.c * 100));
      const stopPrice = s.c * (1 - stopPct / 100);

      // Targets
      const atrPct = a[i] / s.c * 100;
      const t1Pct = Math.max(sc.t1Floor, Math.min(sc.t1Cap, sc.t1Mult * atrPct));
      const t1Price = s.c * (1 + t1Pct / 100);

      let mfe = 0, mae = 0, outcome = 'expired', stopDay = -1;
      for (let d = 1; d <= 10 && i + d < n; d++) {
        const cd = c[i + d];
        const hp = (cd.h - s.c) / s.c * 100, lp = (cd.l - s.c) / s.c * 100;
        if (hp > mfe) mfe = hp; if (lp < mae) mae = lp;

        // Stop check with optional close-only filter
        let triggered = false;
        if (sc.closeOnly) { triggered = cd.c <= stopPrice; }
        else { triggered = cd.l <= stopPrice; }

        if (triggered && outcome !== 'hit') { outcome = 'stopped'; stopDay = d; break; }
        if (cd.h >= t1Price) outcome = 'hit';
      }
      const exitPrice = outcome === 'stopped' ? stopPrice : outcome === 'hit' ? t1Price : c[Math.min(i + 10, n - 1)].c;
      const pnlPct = (exitPrice - s.c) / s.c * 100;
      results.push({ sym, outcome, pnlPct, mfe, mae, stopPct, t1Pct, stopDay });
    }
  }
  return results;
}

function stats(r) {
  const wins = r.filter(s => s.outcome === 'hit');
  const stops = r.filter(s => s.outcome === 'stopped');
  const wr = r.length > 0 ? wins.length / r.length * 100 : 0;
  const avgPnl = r.length > 0 ? r.reduce((s, v) => s + v.pnlPct, 0) / r.length : 0;
  const grossW = wins.reduce((s, v) => s + v.pnlPct, 0);
  const grossL = Math.abs(stops.reduce((s, v) => s + v.pnlPct, 0));
  const pf = grossL > 0 ? grossW / grossL : 99;
  const falseStops = stops.filter(s => s.mfe >= 3).length;
  const falseRate = stops.length > 0 ? falseStops / stops.length * 100 : 0;
  const avgW = wins.length > 0 ? wins.reduce((s, v) => s + v.pnlPct, 0) / wins.length : 0;
  const avgL = stops.length > 0 ? Math.abs(stops.reduce((s, v) => s + v.pnlPct, 0) / stops.length) : 0;
  const exp = (wr / 100) * avgW - (1 - wr / 100) * avgL;
  return { n: r.length, wins: wins.length, stops: stops.length, wr, avgPnl, pf, falseStops, falseRate, avgW, avgL, exp };
}

const D20_BASE = { minZone: 4, maxZone: 25, maxRangeATR: 1.0, maxTightness: 15, maxPre10AvgRangeATR: 0.85, maxExpansionCount: 3, minExactRangeATR: 0.8, minExactVolRatio: 1.2, minExactVolVsPre5: 1.5, minCloseLoc: 55, maxUpperWick: 45, minBody: 25, rsi2Max: 92, minUPS: 20, minCandleQuality: 2 };
const STOP_BASE = { atrMult: 0.5, floor: 2.5, cap: 6, t1Mult: 2.5, t1Floor: 3, t1Cap: 6, closeOnly: false };

console.log('█'.repeat(90));
console.log(`  FALSE STOP REDUCTION + PARAM HYPER-TUNING — ${stockData.length} stocks`);
console.log('█'.repeat(90));

// ═══ PART 1: FALSE STOP ANALYSIS ═══
console.log('\n═══ PART 1: FALSE STOP — What causes them? ═══\n');
const baseR = simulate(D20_BASE, STOP_BASE);
const baseS = stats(baseR);
console.log(`  Baseline: ${baseS.n} signals, ${baseS.wr.toFixed(1)}% WR, PF ${baseS.pf.toFixed(2)}, ${baseS.falseStops} false stops (${baseS.falseRate.toFixed(0)}%)\n`);

const falseStops = baseR.filter(s => s.outcome === 'stopped' && s.mfe >= 3);
console.log(`  False stop profile (${falseStops.length} trades that had +3% MFE but still stopped):`);
console.log(`    Avg MFE before stop: +${(falseStops.reduce((s,v)=>s+v.mfe,0)/falseStops.length).toFixed(1)}%`);
console.log(`    Avg stop day: ${(falseStops.reduce((s,v)=>s+v.stopDay,0)/falseStops.length).toFixed(1)}`);
console.log(`    Avg stop distance: -${(falseStops.reduce((s,v)=>s+Math.abs(v.pnlPct),0)/falseStops.length).toFixed(1)}%`);

// ═══ PART 2: STOP FORMULA GRID SEARCH ═══
console.log('\n═══ PART 2: STOP FORMULA OPTIMIZATION ═══\n');
console.log('  Stop Config                          │ Sigs │ WR    │ PF   │ FalseStop │ AvgPnL │ Expect');
console.log('  ─────────────────────────────────────┼──────┼───────┼──────┼───────────┼────────┼───────');

const stopConfigs = [
  { name: 'Current: ZL-0.5ATR [2.5,6]         ', ...STOP_BASE },
  { name: 'ZL-0.3ATR [2.5,6]                  ', atrMult: 0.3, floor: 2.5, cap: 6, t1Mult: 2.5, t1Floor: 3, t1Cap: 6, closeOnly: false },
  { name: 'ZL-0.5ATR [3,6]                    ', atrMult: 0.5, floor: 3, cap: 6, t1Mult: 2.5, t1Floor: 3, t1Cap: 6, closeOnly: false },
  { name: 'ZL-0.5ATR [3,7]                    ', atrMult: 0.5, floor: 3, cap: 7, t1Mult: 2.5, t1Floor: 3, t1Cap: 6, closeOnly: false },
  { name: 'ZL-0.5ATR [2.5,6] CLOSE-ONLY      ', atrMult: 0.5, floor: 2.5, cap: 6, t1Mult: 2.5, t1Floor: 3, t1Cap: 6, closeOnly: true },
  { name: 'ZL-0.3ATR [3,6] CLOSE-ONLY        ', atrMult: 0.3, floor: 3, cap: 6, t1Mult: 2.5, t1Floor: 3, t1Cap: 6, closeOnly: true },
  { name: 'ZL-0.5ATR [3,7] CLOSE-ONLY        ', atrMult: 0.5, floor: 3, cap: 7, t1Mult: 2.5, t1Floor: 3, t1Cap: 6, closeOnly: true },
  { name: 'ZL-0.3ATR [2.5,5] CLOSE-ONLY      ', atrMult: 0.3, floor: 2.5, cap: 5, t1Mult: 2.5, t1Floor: 3, t1Cap: 6, closeOnly: true },
  { name: 'ZL-0.5ATR [2,5] CLOSE-ONLY        ', atrMult: 0.5, floor: 2, cap: 5, t1Mult: 2.5, t1Floor: 3, t1Cap: 6, closeOnly: true },
  // Higher targets with various stops
  { name: 'ZL-0.5ATR [2.5,6] T1:3×ATR[3,7]   ', atrMult: 0.5, floor: 2.5, cap: 6, t1Mult: 3.0, t1Floor: 3, t1Cap: 7, closeOnly: false },
  { name: 'CLOSE-ONLY [3,7] T1:3×ATR[3,7]    ', atrMult: 0.5, floor: 3, cap: 7, t1Mult: 3.0, t1Floor: 3, t1Cap: 7, closeOnly: true },
  { name: 'CLOSE-ONLY [3,6] T1:2.5×ATR[3,6]  ', atrMult: 0.5, floor: 3, cap: 6, t1Mult: 2.5, t1Floor: 3, t1Cap: 6, closeOnly: true },
];

let bestStopConfig = null, bestStopScore = -999;
for (const sc of stopConfigs) {
  const r = simulate(D20_BASE, sc);
  const s = stats(r);
  const score = s.pf * 100 + s.wr + s.exp * 20 - s.falseRate * 0.5;
  if (score > bestStopScore) { bestStopScore = score; bestStopConfig = sc; }
  console.log(`  ${sc.name} │ ${String(s.n).padStart(4)} │ ${s.wr.toFixed(1).padStart(4)}% │ ${s.pf.toFixed(2).padStart(4)} │ ${s.falseRate.toFixed(0).padStart(8)}% │ ${(s.avgPnl >= 0 ? '+' : '') + s.avgPnl.toFixed(2).padStart(5)}% │ ${(s.exp >= 0 ? '+' : '') + s.exp.toFixed(2)}%`);
}
console.log(`\n  ★ Best stop config: ${bestStopConfig.name.trim()}`);

// ═══ PART 3: PARAM HYPER-TUNING with best stop config ═══
console.log('\n═══ PART 3: D20+ PARAM HYPER-TUNING (with best stop config) ═══\n');

const base = { ...D20_BASE };
const paramGrid = {
  minZone:            [3, 4, 5, 6],
  maxTightness:       [10, 12, 15, 18],
  maxPre10AvgRangeATR:[0.70, 0.75, 0.80, 0.85, 0.90],
  maxExpansionCount:  [1, 2, 3, 4],
  minExactRangeATR:   [0.6, 0.8, 1.0, 1.2],
  minExactVolRatio:   [0.8, 1.0, 1.2, 1.4],
  minExactVolVsPre5:  [1.0, 1.2, 1.5, 2.0],
  minCloseLoc:        [50, 55, 60, 65, 70],
  maxUpperWick:       [30, 35, 40, 45],
  minBody:            [20, 25, 30, 35],
  rsi2Max:            [85, 88, 90, 92, 95],
  minUPS:             [10, 15, 20, 25, 30],
  minCandleQuality:   [1, 2, 3],
};

const bestPerParam = {};
for (const [paramName, values] of Object.entries(paramGrid)) {
  let bestVal = base[paramName], bestScore = -999;
  for (const val of values) {
    const test = { ...base, [paramName]: val };
    const r = simulate(test, bestStopConfig);
    const s = stats(r);
    // Score: PF × sqrt(signals) + WR bonus + expectancy weight
    const score = s.n >= 20 ? s.pf * Math.sqrt(s.n) + s.wr * 0.5 + s.exp * 30 : -999;
    if (score > bestScore) { bestScore = score; bestVal = val; }
  }
  bestPerParam[paramName] = bestVal;
  if (bestVal !== base[paramName]) console.log(`  ${paramName.padEnd(24)} ${base[paramName]} → ${bestVal}`);
}

const optimizedD20 = { ...base, ...bestPerParam };
const optD20R = simulate(optimizedD20, bestStopConfig);
const optD20S = stats(optD20R);
const curD20R = simulate(D20_BASE, STOP_BASE);
const curD20S = stats(curD20R);
console.log(`\n  Current D20+:   ${curD20S.n} sigs, ${curD20S.wr.toFixed(1)}% WR, PF ${curD20S.pf.toFixed(2)}, Exp ${(curD20S.exp >= 0 ? '+' : '') + curD20S.exp.toFixed(2)}%, FalseStop ${curD20S.falseRate.toFixed(0)}%`);
console.log(`  Optimized D20+: ${optD20S.n} sigs, ${optD20S.wr.toFixed(1)}% WR, PF ${optD20S.pf.toFixed(2)}, Exp ${(optD20S.exp >= 0 ? '+' : '') + optD20S.exp.toFixed(2)}%, FalseStop ${optD20S.falseRate.toFixed(0)}%`);

// ═══ PART 4: HP15+ HYPER-TUNING ═══
console.log('\n═══ PART 4: HP15+ HYPER-TUNING ═══\n');
const HP_BASE = { minZone: 5, maxZone: 25, maxRangeATR: 1.0, maxTightness: 12, maxPre10AvgRangeATR: 0.80, maxExpansionCount: 2, minExactRangeATR: 1.0, minExactVolRatio: 1.4, minExactVolVsPre5: 2.0, minCloseLoc: 60, maxUpperWick: 40, minBody: 30, rsi2Max: 90, minUPS: 30, minCandleQuality: 3 };
const hpGrid = {
  minZone: [4, 5, 6], maxTightness: [10, 12, 15], maxPre10AvgRangeATR: [0.70, 0.75, 0.80, 0.85],
  minExactRangeATR: [0.8, 0.9, 1.0, 1.1], minExactVolRatio: [1.0, 1.2, 1.4],
  minExactVolVsPre5: [1.5, 1.8, 2.0], minCloseLoc: [55, 60, 65],
  maxUpperWick: [35, 40, 45], minBody: [25, 30, 35], rsi2Max: [88, 90, 92, 95],
  minUPS: [20, 25, 30], minCandleQuality: [2, 3],
};
const bestHP = {};
for (const [p, vals] of Object.entries(hpGrid)) {
  let bv = HP_BASE[p], bs = -999;
  for (const v of vals) { const r = simulate({ ...HP_BASE, [p]: v }, bestStopConfig); const s = stats(r); const sc = s.n >= 10 ? s.pf * Math.sqrt(s.n) + s.wr * 0.5 + s.exp * 30 : -999; if (sc > bs) { bs = sc; bv = v; } }
  bestHP[p] = bv;
  if (bv !== HP_BASE[p]) console.log(`  ${p.padEnd(24)} ${HP_BASE[p]} → ${bv}`);
}
const optHP = { ...HP_BASE, ...bestHP };
const optHPR = simulate(optHP, bestStopConfig); const optHPS = stats(optHPR);
const curHPR = simulate(HP_BASE, STOP_BASE); const curHPS = stats(curHPR);
console.log(`\n  Current HP15+:   ${curHPS.n} sigs, ${curHPS.wr.toFixed(1)}% WR, PF ${curHPS.pf.toFixed(2)}, Exp ${(curHPS.exp >= 0 ? '+' : '') + curHPS.exp.toFixed(2)}%`);
console.log(`  Optimized HP15+: ${optHPS.n} sigs, ${optHPS.wr.toFixed(1)}% WR, PF ${optHPS.pf.toFixed(2)}, Exp ${(optHPS.exp >= 0 ? '+' : '') + optHPS.exp.toFixed(2)}%`);

// ═══ PART 5: E10+ HYPER-TUNING ═══
console.log('\n═══ PART 5: E10+ HYPER-TUNING ═══\n');
const E_BASE = { minZone: 6, maxZone: 25, maxRangeATR: 0.95, maxTightness: 10, maxPre10AvgRangeATR: 0.75, maxExpansionCount: 2, minExactRangeATR: 1.2, minExactVolRatio: 1.6, minExactVolVsPre5: 2.5, minCloseLoc: 65, maxUpperWick: 35, minBody: 35, rsi2Max: 88, minUPS: 40, minCandleQuality: 3 };
const eGrid = {
  minZone: [4, 5, 6], maxTightness: [8, 10, 12, 14], maxPre10AvgRangeATR: [0.70, 0.75, 0.80, 0.85],
  minExactRangeATR: [0.9, 1.0, 1.1, 1.2], minExactVolRatio: [1.2, 1.4, 1.6],
  minExactVolVsPre5: [1.5, 2.0, 2.5], minCloseLoc: [55, 60, 65],
  maxUpperWick: [30, 35, 40], minBody: [25, 30, 35], rsi2Max: [85, 88, 90, 92],
  minUPS: [25, 30, 35, 40], minCandleQuality: [2, 3],
};
const bestE = {};
for (const [p, vals] of Object.entries(eGrid)) {
  let bv = E_BASE[p], bs = -999;
  for (const v of vals) { const r = simulate({ ...E_BASE, [p]: v }, bestStopConfig); const s = stats(r); const sc = s.n >= 5 ? s.pf * Math.sqrt(s.n) + s.wr * 0.5 + s.exp * 30 : -999; if (sc > bs) { bs = sc; bv = v; } }
  bestE[p] = bv;
  if (bv !== E_BASE[p]) console.log(`  ${p.padEnd(24)} ${E_BASE[p]} → ${bv}`);
}
const optE = { ...E_BASE, ...bestE };
const optER = simulate(optE, bestStopConfig); const optES = stats(optER);
const curER = simulate(E_BASE, STOP_BASE); const curES = stats(curER);
console.log(`\n  Current E10+:   ${curES.n} sigs, ${curES.wr.toFixed(1)}% WR, PF ${curES.pf.toFixed(2)}`);
console.log(`  Optimized E10+: ${optES.n} sigs, ${optES.wr.toFixed(1)}% WR, PF ${optES.pf.toFixed(2)}, Exp ${(optES.exp >= 0 ? '+' : '') + optES.exp.toFixed(2)}%`);

// ═══ PART 6: US8+ HYPER-TUNING ═══
console.log('\n═══ PART 6: US8+ HYPER-TUNING ═══\n');
const US_BASE = { minZone: 7, maxZone: 25, maxRangeATR: 0.90, maxTightness: 8, maxPre10AvgRangeATR: 0.70, maxExpansionCount: 1, minExactRangeATR: 1.4, minExactVolRatio: 1.8, minExactVolVsPre5: 3.0, minCloseLoc: 70, maxUpperWick: 30, minBody: 40, rsi2Max: 85, minUPS: 50, minCandleQuality: 4 };
const usGrid = {
  minZone: [5, 6, 7], maxTightness: [8, 10, 12], maxPre10AvgRangeATR: [0.65, 0.70, 0.75, 0.80],
  minExactRangeATR: [1.0, 1.2, 1.4], minExactVolRatio: [1.4, 1.6, 1.8],
  minExactVolVsPre5: [2.0, 2.5, 3.0], minCloseLoc: [60, 65, 70],
  maxUpperWick: [25, 30, 35], minBody: [30, 35, 40], rsi2Max: [85, 88, 90],
  minUPS: [30, 40, 50], minCandleQuality: [3, 4],
};
const bestUS = {};
for (const [p, vals] of Object.entries(usGrid)) {
  let bv = US_BASE[p], bs = -999;
  for (const v of vals) { const r = simulate({ ...US_BASE, [p]: v }, bestStopConfig); const s = stats(r); const sc = s.n >= 3 ? s.pf * Math.sqrt(s.n) + s.wr * 0.5 + s.exp * 30 : -999; if (sc > bs) { bs = sc; bv = v; } }
  bestUS[p] = bv;
  if (bv !== US_BASE[p]) console.log(`  ${p.padEnd(24)} ${US_BASE[p]} → ${bv}`);
}
const optUS = { ...US_BASE, ...bestUS };
const optUSR = simulate(optUS, bestStopConfig); const optUSS = stats(optUSR);
const curUSR = simulate(US_BASE, STOP_BASE); const curUSS = stats(curUSR);
console.log(`\n  Current US8+:   ${curUSS.n} sigs, ${curUSS.wr.toFixed(1)}% WR`);
console.log(`  Optimized US8+: ${optUSS.n} sigs, ${optUSS.wr.toFixed(1)}% WR, PF ${optUSS.pf.toFixed(2)}, Exp ${(optUSS.exp >= 0 ? '+' : '') + optUSS.exp.toFixed(2)}%`);

// ═══ FINAL SUMMARY ═══
console.log('\n' + '█'.repeat(90));
console.log('  FINAL COMPARISON');
console.log('█'.repeat(90) + '\n');
console.log('  Set   │ Current                                    │ Hyper-Tuned');
console.log('  ──────┼────────────────────────────────────────────┼─────────────────────────────────────────');
for (const [name, cur, opt] of [['D20+', curD20S, optD20S], ['HP15+', curHPS, optHPS], ['E10+', curES, optES], ['US8+', curUSS, optUSS]]) {
  const c = `${cur.n}sig ${cur.wr.toFixed(0)}%WR PF${cur.pf.toFixed(2)} Exp${(cur.exp>=0?'+':'')+cur.exp.toFixed(2)} FS${cur.falseRate.toFixed(0)}%`;
  const o = `${opt.n}sig ${opt.wr.toFixed(0)}%WR PF${opt.pf.toFixed(2)} Exp${(opt.exp>=0?'+':'')+opt.exp.toFixed(2)} FS${opt.falseRate.toFixed(0)}%`;
  console.log(`  ${name.padEnd(5)} │ ${c.padEnd(42)} │ ${o}`);
}

console.log(`\n  Best stop config: ${bestStopConfig.closeOnly ? 'CLOSE-ONLY' : 'LOW-TOUCH'} ZL-${bestStopConfig.atrMult}ATR [${bestStopConfig.floor}%,${bestStopConfig.cap}%] T1:${bestStopConfig.t1Mult}×ATR[${bestStopConfig.t1Floor}%,${bestStopConfig.t1Cap}%]`);

// Print final params
console.log('\n═══ OPTIMIZED PARAMS FOR IMPLEMENTATION ═══\n');
for (const [name, params] of [['D20+', optimizedD20], ['HP15+', optHP], ['E10+', optE], ['US8+', optUS]]) {
  console.log(`  ${name}: {`);
  for (const [k, v] of Object.entries(params)) console.log(`    ${k}: ${v},`);
  console.log('  },');
}
