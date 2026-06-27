// FULL BACKTEST — 79 OHLCV FILES (29 Portfolio + 50 Nifty 50)
// Tests all 4 param sets: D20+, HP15+, E10+, US8+

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];

function parseYahoo(fp) {
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

function parseNSE(fp) {
  const l = fs.readFileSync(fp, 'utf8').trim().split('\n');
  const c = [];
  for (let i = 1; i < l.length; i++) {
    const p = l[i].split(',');
    if (p.length < 11) continue;
    // Date,Symbol,Series,PrevClose,Open,High,Low,Last,Close,VWAP,Volume
    const o = +p[4], h = +p[5], lo = +p[6], cl = +p[8], v = +p[10];
    if (isNaN(cl) || cl <= 0) continue;
    c.push({ date: p[0], o, h, l: lo, c: cl, v: v || 0 });
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

// Load all files
const stockData = [];
for (const { dir, format } of DIRS) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.csv') || f.includes('ALL_SYMBOLS')) continue;
    const fp = path.join(dir, f);
    const c = format === 'nse' ? parseNSE(fp) : parseYahoo(fp);
    if (c.length < 60) continue;
    const sym = f.replace('_NS_OHLCV.csv', '').replace('.csv', '');
    stockData.push({ sym, c, a: atr14(c), rsi: rsi2(c), src: format === 'nse' ? 'N50' : 'PF' });
  }
}

console.log('█'.repeat(90));
console.log(`  FULL BACKTEST — ${stockData.length} OHLCV FILES`);
console.log(`  Portfolio: ${stockData.filter(s => s.src === 'PF').length} | Nifty 50: ${stockData.filter(s => s.src === 'N50').length}`);
console.log('█'.repeat(90));

const PARAMS = {
  'D20+': { minZone: 4, maxZone: 25, maxRangeATR: 1.0, maxTightness: 15, maxPre10AvgRangeATR: 0.85, maxExpansionCount: 3, minExactRangeATR: 0.8, minExactVolRatio: 1.2, minExactVolVsPre5: 1.5, minCloseLoc: 55, maxUpperWick: 45, minBody: 25, rsi2Max: 92, minUPS: 20, minCandleQuality: 2 },
  'HP15+': { minZone: 5, maxZone: 25, maxRangeATR: 1.0, maxTightness: 12, maxPre10AvgRangeATR: 0.80, maxExpansionCount: 2, minExactRangeATR: 1.0, minExactVolRatio: 1.4, minExactVolVsPre5: 2.0, minCloseLoc: 60, maxUpperWick: 40, minBody: 30, rsi2Max: 90, minUPS: 30, minCandleQuality: 3 },
  'E10+': { minZone: 6, maxZone: 25, maxRangeATR: 0.95, maxTightness: 10, maxPre10AvgRangeATR: 0.75, maxExpansionCount: 2, minExactRangeATR: 1.2, minExactVolRatio: 1.6, minExactVolVsPre5: 2.5, minCloseLoc: 65, maxUpperWick: 35, minBody: 35, rsi2Max: 88, minUPS: 40, minCandleQuality: 3 },
  'US8+': { minZone: 7, maxZone: 25, maxRangeATR: 0.90, maxTightness: 8, maxPre10AvgRangeATR: 0.70, maxExpansionCount: 1, minExactRangeATR: 1.4, minExactVolRatio: 1.8, minExactVolVsPre5: 3.0, minCloseLoc: 70, maxUpperWick: 30, minBody: 40, rsi2Max: 85, minUPS: 50, minCandleQuality: 4 },
};

function runBacktest(params) {
  const results = [];
  for (const { sym, c, a, rsi, src } of stockData) {
    const n = c.length;
    for (let i = 30; i < n - 11; i++) {
      if (a[i] <= 0 || c[i].c <= 0) continue;
      const s = c[i], range = s.h - s.l;
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

      const rawStop = zone.zL - 0.5 * a[i];
      const stopPct = Math.max(2.5, Math.min(6, (s.c - rawStop) / s.c * 100));
      const stopPrice = s.c * (1 - stopPct / 100);
      const atrPct = a[i] / s.c * 100;
      const t1Pct = Math.max(3, Math.min(6, 2.5 * atrPct));
      const t1Price = s.c * (1 + t1Pct / 100);
      const t2Pct = Math.min(5.65, 2.80 * atrPct);
      const t3Pct = atrPct < 1.5 ? 5 : atrPct <= 3 ? 7 : 10;

      let mfe = 0, mae = 0, outcome = 'expired', exitDay = 10, hitT1 = false, hitT2 = false, hitT3 = false;
      for (let d = 1; d <= 10 && i + d < n; d++) {
        const cd = c[i + d];
        const hp = (cd.h - s.c) / s.c * 100, lp = (cd.l - s.c) / s.c * 100;
        if (hp > mfe) mfe = hp; if (lp < mae) mae = lp;
        if (cd.l <= stopPrice && outcome !== 'hit_t1' && outcome !== 'hit_t2') { outcome = 'stopped'; exitDay = d; break; }
        if (cd.h >= t1Price) hitT1 = true;
        if (cd.h >= s.c * (1 + t2Pct / 100)) hitT2 = true;
        if (cd.h >= s.c * (1 + t3Pct / 100)) hitT3 = true;
      }
      if (outcome !== 'stopped') { if (hitT3) outcome = 'hit_t3'; else if (hitT2) outcome = 'hit_t2'; else if (hitT1) outcome = 'hit_t1'; }
      const exitPrice = outcome === 'stopped' ? stopPrice : outcome.startsWith('hit') ? (hitT1 ? t1Price : s.c) : c[Math.min(i + 10, n - 1)].c;
      const pnlPct = (exitPrice - s.c) / s.c * 100;

      results.push({ sym, src, date: s.date, entry: s.c, outcome, pnlPct, mfe, mae, stopPct, t1Pct, hitT1, hitT2, hitT3, exitDay, closeLoc, ups, cq });
    }
  }
  return results;
}

// ═══ Run all 4 param sets ═══
console.log('\n═══ PART 1: SUMMARY PER PARAM SET ═══\n');
console.log('  Set   │ Signals │ Wins │ Stops │ Expired │ WinRate │ AvgMFE │ AvgMAE │ AvgPnL │ PF');
console.log('  ──────┼─────────┼──────┼───────┼─────────┼─────────┼────────┼────────┼────────┼──────');

const allPS = {};
for (const [name, params] of Object.entries(PARAMS)) {
  const r = runBacktest(params);
  allPS[name] = r;
  const wins = r.filter(s => s.outcome.startsWith('hit'));
  const stops = r.filter(s => s.outcome === 'stopped');
  const expired = r.filter(s => s.outcome === 'expired');
  const wr = r.length > 0 ? (wins.length / r.length * 100).toFixed(1) : '0';
  const avgMfe = r.length > 0 ? (r.reduce((s, v) => s + v.mfe, 0) / r.length).toFixed(1) : '0';
  const avgMae = r.length > 0 ? (r.reduce((s, v) => s + v.mae, 0) / r.length).toFixed(1) : '0';
  const avgPnl = r.length > 0 ? (r.reduce((s, v) => s + v.pnlPct, 0) / r.length).toFixed(2) : '0';
  const grossW = wins.reduce((s, v) => s + v.pnlPct, 0);
  const grossL = Math.abs(stops.reduce((s, v) => s + v.pnlPct, 0));
  const pf = grossL > 0 ? (grossW / grossL).toFixed(2) : '∞';
  console.log(`  ${name.padEnd(5)} │ ${String(r.length).padStart(7)} │ ${String(wins.length).padStart(4)} │ ${String(stops.length).padStart(5)} │ ${String(expired.length).padStart(7)} │ ${wr.padStart(6)}% │ ${('+' + avgMfe + '%').padStart(6)} │ ${avgMae.padStart(5)}% │ ${(+avgPnl >= 0 ? '+' : '') + avgPnl + '%'} │ ${pf.padStart(4)}`);
}

// ═══ PART 2: Portfolio vs Nifty 50 comparison ═══
console.log('\n═══ PART 2: PORTFOLIO vs NIFTY 50 — D20+ ═══\n');
const d20 = allPS['D20+'];
for (const [label, filter] of [['Portfolio (29)', s => s.src === 'PF'], ['Nifty 50 (52)', s => s.src === 'N50'], ['Combined (79)', () => true]]) {
  const grp = d20.filter(filter);
  if (grp.length === 0) continue;
  const wins = grp.filter(s => s.outcome.startsWith('hit'));
  const stops = grp.filter(s => s.outcome === 'stopped');
  console.log(`  ${label.padEnd(18)} │ ${grp.length} signals, ${wins.length} wins, ${stops.length} stops │ WR ${(wins.length / grp.length * 100).toFixed(1)}% │ MFE +${(grp.reduce((s, v) => s + v.mfe, 0) / grp.length).toFixed(1)}% │ PnL ${(grp.reduce((s, v) => s + v.pnlPct, 0) / grp.length >= 0 ? '+' : '') + (grp.reduce((s, v) => s + v.pnlPct, 0) / grp.length).toFixed(2)}%`);
}

// ═══ PART 3: Target hit analysis ═══
console.log('\n═══ PART 3: TARGET HIT ANALYSIS ═══\n');
console.log('  Set   │ T1 Hit │ T2 Hit │ T3 Hit │ T1→T2% │ Stopped │ False SL');
console.log('  ──────┼────────┼────────┼────────┼────────┼─────────┼─────────');
for (const [name, r] of Object.entries(allPS)) {
  if (r.length === 0) continue;
  const t1 = r.filter(s => s.hitT1).length, t2 = r.filter(s => s.hitT2).length, t3 = r.filter(s => s.hitT3).length;
  const stops = r.filter(s => s.outcome === 'stopped');
  const falseSL = stops.filter(s => s.mfe >= 3).length;
  console.log(`  ${name.padEnd(5)} │ ${(t1/r.length*100).toFixed(0).padStart(5)}% │ ${(t2/r.length*100).toFixed(0).padStart(5)}% │ ${(t3/r.length*100).toFixed(0).padStart(5)}% │ ${(t1>0?(t2/t1*100).toFixed(0):'—').padStart(5)}% │ ${(stops.length/r.length*100).toFixed(0).padStart(6)}% │ ${(stops.length>0?(falseSL/stops.length*100).toFixed(0):'—').padStart(6)}%`);
}

// ═══ PART 4: Top/bottom stocks ═══
console.log('\n═══ PART 4: TOP 15 STOCKS BY SIGNAL COUNT (D20+) ═══\n');
const byStock = {};
for (const s of d20) { if (!byStock[s.sym]) byStock[s.sym] = []; byStock[s.sym].push(s); }
const sorted = Object.entries(byStock).sort((a, b) => b[1].length - a[1].length);
console.log('  Stock          │ Src │ Sigs │ Wins │ Stops │ WR    │ MFE    │ PnL    │ Best');
console.log('  ───────────────┼─────┼──────┼──────┼───────┼───────┼────────┼────────┼──────');
for (const [sym, sigs] of sorted.slice(0, 15)) {
  const wins = sigs.filter(s => s.outcome.startsWith('hit'));
  const stops = sigs.filter(s => s.outcome === 'stopped');
  const best = sigs.reduce((b, s) => s.mfe > b.mfe ? s : b, sigs[0]);
  console.log(`  ${sym.padEnd(15)} │ ${sigs[0].src.padEnd(3)} │ ${String(sigs.length).padStart(4)} │ ${String(wins.length).padStart(4)} │ ${String(stops.length).padStart(5)} │ ${(wins.length/sigs.length*100).toFixed(0).padStart(4)}% │ ${('+'+((sigs.reduce((s,v)=>s+v.mfe,0)/sigs.length).toFixed(1))+'%').padStart(6)} │ ${((sigs.reduce((s,v)=>s+v.pnlPct,0)/sigs.length)>=0?'+':'')+(sigs.reduce((s,v)=>s+v.pnlPct,0)/sigs.length).toFixed(1)+'%'} │ +${best.mfe.toFixed(0)}%`);
}

// ═══ PART 5: Expectancy ═══
console.log('\n═══ PART 5: EXPECTANCY ═══\n');
console.log('  Set   │ Avg Win │ Avg Loss │ WinRate │ Expectancy │ Per Rs.1L │ Annual(50tr)');
console.log('  ──────┼─────────┼──────────┼─────────┼────────────┼───────────┼────────────');
for (const [name, r] of Object.entries(allPS)) {
  if (r.length < 5) continue;
  const wins = r.filter(s => s.outcome.startsWith('hit'));
  const stops = r.filter(s => s.outcome === 'stopped');
  const avgW = wins.length > 0 ? wins.reduce((s, v) => s + v.pnlPct, 0) / wins.length : 0;
  const avgL = stops.length > 0 ? Math.abs(stops.reduce((s, v) => s + v.pnlPct, 0) / stops.length) : 0;
  const wr = wins.length / r.length;
  const exp = wr * avgW - (1 - wr) * avgL;
  console.log(`  ${name.padEnd(5)} │ ${('+'+avgW.toFixed(1)+'%').padStart(7)} │ ${('-'+avgL.toFixed(1)+'%').padStart(8)} │ ${(wr*100).toFixed(0).padStart(6)}% │ ${(exp>=0?'+':'')+exp.toFixed(2)+'%'.padStart(9)} │ Rs.${(exp/100*100000).toFixed(0).padStart(6)} │ Rs.${(exp/100*100000*50).toFixed(0).padStart(8)}`);
}

// ═══ PART 6: Multi-set overlap ═══
console.log('\n═══ PART 6: MULTI-SET OVERLAP ═══\n');
const sigMap = {};
for (const [ps, sigs] of Object.entries(allPS)) {
  for (const s of sigs) { const k = `${s.sym}_${s.date}`; if (!sigMap[k]) sigMap[k] = { ...s, sets: [] }; sigMap[k].sets.push(ps); }
}
console.log('  Sets agreeing │ Signals │ Wins │ WinRate │ Avg MFE │ Avg PnL');
console.log('  ─────────────┼─────────┼──────┼─────────┼─────────┼────────');
for (const cnt of [1, 2, 3, 4]) {
  const grp = Object.values(sigMap).filter(s => s.sets.length >= cnt);
  if (grp.length < 3) continue;
  const wins = grp.filter(s => s.outcome.startsWith('hit'));
  console.log(`  ≥${cnt} sets      │ ${String(grp.length).padStart(7)} │ ${String(wins.length).padStart(4)} │ ${(wins.length/grp.length*100).toFixed(1).padStart(6)}% │ ${('+'+(grp.reduce((s,v)=>s+v.mfe,0)/grp.length).toFixed(1)+'%').padStart(7)} │ ${((grp.reduce((s,v)=>s+v.pnlPct,0)/grp.length)>=0?'+':'')+(grp.reduce((s,v)=>s+v.pnlPct,0)/grp.length).toFixed(2)+'%'}`);
}

console.log('\n' + '█'.repeat(90));
console.log('  BACKTEST COMPLETE — 79 OHLCV FILES');
console.log('█'.repeat(90));
