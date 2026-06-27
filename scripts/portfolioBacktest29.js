// THOROUGH BACKTEST — 29 Portfolio OHLCV Files
// All 4 param sets with LATEST engine: CLOSE-ONLY stop [3%,7%], no descending zones, E10+ v6-HT
// Complete metrics: WR, PF, expectancy, MFE, MAE, targets, per-stock, monthly, overlap

const fs = require('fs'), path = require('path');
const DIR = 'C:/Users/drkkr/Downloads/My Portfolio';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv') && !f.includes('ALL_SYMBOLS'));

function parseCSV(fp) {
  const l = fs.readFileSync(fp, 'utf8').trim().split('\n'); const c = [];
  for (let i = 1; i < l.length; i++) { const p = l[i].split(','); if (p.length < 6 || isNaN(+p[4]) || +p[4] <= 0) continue; c.push({ date: p[0], o: +p[1], h: +p[2], l: +p[3], c: +p[4], v: +p[5] }); } return c;
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
for (const file of files) {
  const c = parseCSV(path.join(DIR, file));
  if (c.length < 60) continue;
  stockData.push({ sym: file.replace('_NS_OHLCV.csv', ''), c, a: atr14(c), rsi: rsi2(c) });
}

// LATEST param sets (matching stockEngine.ts)
const PARAMS = {
  'D20+': { minZone: 4, maxZone: 25, maxRangeATR: 1.0, maxTightness: 15, maxPre10AvgRangeATR: 0.85, maxExpansionCount: 3, minExactRangeATR: 0.8, minExactVolRatio: 1.2, minExactVolVsPre5: 1.5, minCloseLoc: 55, maxUpperWick: 45, minBody: 25, rsi2Max: 92, minUPS: 20, minCandleQuality: 2 },
  'HP15+': { minZone: 5, maxZone: 25, maxRangeATR: 1.0, maxTightness: 12, maxPre10AvgRangeATR: 0.80, maxExpansionCount: 2, minExactRangeATR: 1.0, minExactVolRatio: 1.4, minExactVolVsPre5: 2.0, minCloseLoc: 60, maxUpperWick: 40, minBody: 30, rsi2Max: 90, minUPS: 30, minCandleQuality: 3 },
  'E10+ v6-HT': { minZone: 4, maxZone: 25, maxRangeATR: 0.95, maxTightness: 12, maxPre10AvgRangeATR: 0.80, maxExpansionCount: 2, minExactRangeATR: 1.2, minExactVolRatio: 1.2, minExactVolVsPre5: 2.0, minCloseLoc: 55, maxUpperWick: 35, minBody: 25, rsi2Max: 90, minUPS: 25, minCandleQuality: 2 },
  'US8+': { minZone: 7, maxZone: 25, maxRangeATR: 0.90, maxTightness: 8, maxPre10AvgRangeATR: 0.70, maxExpansionCount: 1, minExactRangeATR: 1.4, minExactVolRatio: 1.8, minExactVolVsPre5: 3.0, minCloseLoc: 70, maxUpperWick: 30, minBody: 40, rsi2Max: 85, minUPS: 50, minCandleQuality: 4 },
};

function simulate(params) {
  const results = [];
  for (const { sym, c, a, rsi } of stockData) {
    const n = c.length;
    for (let i = 30; i < n - 21; i++) {
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

      // Zone detection with descending rejection
      let zone = null;
      for (let zL = params.maxZone; zL >= params.minZone; zL--) {
        const zS = i - zL; if (zS < 1) continue;
        let zH = -Infinity, zLo = Infinity, ok = true;
        for (let j = zS; j < i; j++) { zH = Math.max(zH, c[j].h); zLo = Math.min(zLo, c[j].l); if ((c[j].h - c[j].l) / (a[j] || 1) > params.maxRangeATR) ok = false; }
        if (!ok) continue;
        const tight = zLo > 0 ? (zH - zLo) / zLo * 100 : 999;
        if (tight > params.maxTightness) continue;
        // Zone shape — reject descending
        const mid = Math.floor(zL / 2);
        let fhH = -Infinity, shH = -Infinity, fhL = Infinity, shL = Infinity;
        for (let j = zS; j < zS + mid; j++) { fhH = Math.max(fhH, c[j].h); fhL = Math.min(fhL, c[j].l); }
        for (let j = zS + mid; j < i; j++) { shH = Math.max(shH, c[j].h); shL = Math.min(shL, c[j].l); }
        const shape = shL > fhL * 1.005 && shH >= fhH * 0.995 ? 'ASC' : shH < fhH * 0.995 && shL <= fhL * 1.005 ? 'DESC' : 'FLAT';
        if (shape === 'DESC') continue;
        zone = { zH, zL: zLo, len: zL, tight, shape }; break;
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

      // CLOSE-ONLY stop [3%, 7%]
      const rawStop = zone.zL - 0.5 * a[i];
      const stopPct = Math.max(3, Math.min(7, (s.c - rawStop) / s.c * 100));
      const stopPrice = s.c * (1 - stopPct / 100);

      // Targets: T1 2.5×ATR [3,6], T2, T3
      const atrPct = a[i] / s.c * 100;
      const t1Pct = Math.max(3, Math.min(6, 2.5 * atrPct));
      const t2Pct = Math.min(5.65, 2.80 * atrPct);
      const t3Pct = atrPct < 1.5 ? 5 : atrPct <= 3 ? 7 : 10;

      // Forward simulation 20 days
      let mfe5 = 0, mfe10 = 0, mfe20 = 0, mae = 0;
      let outcome = 'expired', exitDay = -1;
      let hitT1 = false, hitT2 = false, hitT3 = false;
      let t1Day = -1, t2Day = -1;

      for (let d = 1; d <= 20 && i + d < n; d++) {
        const cd = c[i + d];
        const hp = (cd.h - s.c) / s.c * 100, lp = (cd.l - s.c) / s.c * 100;
        if (d <= 5 && hp > mfe5) mfe5 = hp;
        if (d <= 10 && hp > mfe10) mfe10 = hp;
        if (hp > mfe20) mfe20 = hp;
        if (lp < mae) mae = lp;

        // CLOSE-ONLY stop
        if (d <= 10 && cd.c <= stopPrice && !hitT1) { outcome = 'stopped'; exitDay = d; break; }
        if (cd.h >= s.c * (1 + t1Pct / 100) && !hitT1) { hitT1 = true; t1Day = d; }
        if (cd.h >= s.c * (1 + t2Pct / 100) && !hitT2) { hitT2 = true; t2Day = d; }
        if (cd.h >= s.c * (1 + t3Pct / 100)) hitT3 = true;
      }
      if (outcome !== 'stopped') {
        outcome = hitT3 ? 'hit_t3' : hitT2 ? 'hit_t2' : hitT1 ? 'hit_t1' : 'expired';
        exitDay = hitT1 ? t1Day : 10;
      }
      const exitPrice = outcome === 'stopped' ? stopPrice : hitT1 ? s.c * (1 + t1Pct / 100) : c[Math.min(i + 10, n - 1)].c;
      const pnlPct = (exitPrice - s.c) / s.c * 100;
      const rMult = stopPct > 0 ? pnlPct / stopPct : 0;

      // Parse month
      const parts = s.date.split('-');
      const month = parts.length >= 2 ? parts[1] : 'Unk';

      results.push({ sym, date: s.date, entry: s.c, outcome, pnlPct, rMult, mfe5, mfe10, mfe20, mae, stopPct, t1Pct, t2Pct, t3Pct, hitT1, hitT2, hitT3, exitDay, closeLoc, bodyPct, upperWick, exactVolVsPre5, exactRangeATR, zoneShape: zone.shape, month });
    }
  }
  return results;
}

console.log('█'.repeat(90));
console.log(`  THOROUGH BACKTEST — ${stockData.length} Portfolio OHLCV Files`);
console.log('  Engine: CLOSE-ONLY stop [3%,7%], No descending zones, T1: 2.5×ATR [3%,6%]');
console.log('  Param sets: D20+, HP15+, E10+ v6-HT, US8+');
console.log('█'.repeat(90));

const allPS = {};
for (const [name, params] of Object.entries(PARAMS)) { allPS[name] = simulate(params); }

// ═══ PART 1: SUMMARY ═══
console.log('\n═══ PART 1: SUMMARY PER PARAM SET ═══\n');
console.log('  Set        │ Sigs │ Wins │ Stops │ Exprd │ WR    │ AvgMFE10 │ AvgMAE │ AvgPnL │ PF    │ AvgR');
console.log('  ───────────┼──────┼──────┼───────┼───────┼───────┼──────────┼────────┼────────┼───────┼──────');
for (const [name, r] of Object.entries(allPS)) {
  const w = r.filter(s => s.outcome.startsWith('hit')), st = r.filter(s => s.outcome === 'stopped'), ex = r.filter(s => s.outcome === 'expired');
  if (r.length === 0) { console.log(`  ${name.padEnd(10)} │    0 │    — │     — │     — │     — │        — │      — │      — │     — │    —`); continue; }
  const wr = (w.length / r.length * 100).toFixed(1);
  const avgMfe = (r.reduce((s, v) => s + v.mfe10, 0) / r.length).toFixed(1);
  const avgMae = (r.reduce((s, v) => s + v.mae, 0) / r.length).toFixed(1);
  const avgPnl = (r.reduce((s, v) => s + v.pnlPct, 0) / r.length).toFixed(2);
  const gW = w.reduce((s, v) => s + v.pnlPct, 0), gL = Math.abs(st.reduce((s, v) => s + v.pnlPct, 0));
  const pf = gL > 0 ? (gW / gL).toFixed(2) : '∞';
  const avgR = (r.reduce((s, v) => s + v.rMult, 0) / r.length).toFixed(2);
  console.log(`  ${name.padEnd(10)} │ ${String(r.length).padStart(4)} │ ${String(w.length).padStart(4)} │ ${String(st.length).padStart(5)} │ ${String(ex.length).padStart(5)} │ ${wr.padStart(4)}% │ ${('+' + avgMfe + '%').padStart(8)} │ ${avgMae.padStart(5)}% │ ${(+avgPnl >= 0 ? '+' : '') + avgPnl + '%'} │ ${pf.padStart(5)} │ ${avgR.padStart(4)}`);
}

// ═══ PART 2: TARGET PROGRESSION ═══
console.log('\n═══ PART 2: TARGET PROGRESSION ═══\n');
console.log('  Set        │ T1 Hit │ T2 Hit │ T3 Hit │ T1→T2 │ T2→T3 │ Stopped │ FalseStop');
console.log('  ───────────┼────────┼────────┼────────┼───────┼───────┼─────────┼─────────');
for (const [name, r] of Object.entries(allPS)) {
  if (r.length === 0) continue;
  const t1 = r.filter(s => s.hitT1).length, t2 = r.filter(s => s.hitT2).length, t3 = r.filter(s => s.hitT3).length;
  const st = r.filter(s => s.outcome === 'stopped');
  const fs = st.filter(s => s.mfe10 >= 3).length;
  console.log(`  ${name.padEnd(10)} │ ${(t1 / r.length * 100).toFixed(0).padStart(5)}% │ ${(t2 / r.length * 100).toFixed(0).padStart(5)}% │ ${(t3 / r.length * 100).toFixed(0).padStart(5)}% │ ${(t1 > 0 ? (t2 / t1 * 100).toFixed(0) : '—').padStart(4)}% │ ${(t2 > 0 ? (t3 / t2 * 100).toFixed(0) : '—').padStart(4)}% │ ${(st.length / r.length * 100).toFixed(0).padStart(6)}% │ ${(st.length > 0 ? (fs / st.length * 100).toFixed(0) : '—').padStart(6)}%`);
}

// ═══ PART 3: MFE DISTRIBUTION ═══
console.log('\n═══ PART 3: MFE DISTRIBUTION (D20+) ═══\n');
const d20 = allPS['D20+'];
if (d20.length > 0) {
  console.log('  Window │ Avg    │ Median │ 75th   │ 90th   │ Max');
  console.log('  ───────┼────────┼────────┼────────┼────────┼──────');
  for (const [label, key] of [['5-day', 'mfe5'], ['10-day', 'mfe10'], ['20-day', 'mfe20']]) {
    const sorted = d20.map(s => s[key]).sort((a, b) => a - b);
    console.log(`  ${label.padEnd(6)} │ ${('+' + (sorted.reduce((s, v) => s + v, 0) / sorted.length).toFixed(1) + '%').padStart(6)} │ ${('+' + sorted[Math.floor(sorted.length / 2)].toFixed(1) + '%').padStart(6)} │ ${('+' + sorted[Math.floor(sorted.length * 0.75)].toFixed(1) + '%').padStart(6)} │ ${('+' + sorted[Math.floor(sorted.length * 0.9)].toFixed(1) + '%').padStart(6)} │ +${sorted[sorted.length - 1].toFixed(1)}%`);
  }
}

// ═══ PART 4: EXPECTANCY ═══
console.log('\n═══ PART 4: EXPECTANCY ═══\n');
console.log('  Set        │ AvgWin │ AvgLoss │ WR    │ Expect │ Per Rs.1L │ Annual(50)');
console.log('  ───────────┼────────┼─────────┼───────┼────────┼───────────┼──────────');
for (const [name, r] of Object.entries(allPS)) {
  if (r.length < 3) continue;
  const w = r.filter(s => s.outcome.startsWith('hit')), st = r.filter(s => s.outcome === 'stopped');
  const avgW = w.length > 0 ? w.reduce((s, v) => s + v.pnlPct, 0) / w.length : 0;
  const avgL = st.length > 0 ? Math.abs(st.reduce((s, v) => s + v.pnlPct, 0) / st.length) : 0;
  const wr = w.length / r.length;
  const exp = wr * avgW - (1 - wr) * avgL;
  console.log(`  ${name.padEnd(10)} │ ${('+' + avgW.toFixed(1) + '%').padStart(6)} │ ${('-' + avgL.toFixed(1) + '%').padStart(7)} │ ${(wr * 100).toFixed(0).padStart(4)}% │ ${(exp >= 0 ? '+' : '') + exp.toFixed(2)}% │ Rs.${(exp / 100 * 100000).toFixed(0).padStart(6)} │ Rs.${(exp / 100 * 100000 * 50).toFixed(0).padStart(8)}`);
}

// ═══ PART 5: PER-STOCK (D20+) ═══
console.log('\n═══ PART 5: PER-STOCK BREAKDOWN (D20+) ═══\n');
console.log('  Stock        │ Sigs │ W │ S │ WR    │ MFE10 │ PnL    │ Best Trade');
console.log('  ─────────────┼──────┼───┼───┼───────┼───────┼────────┼──────────');
const byStock = {};
for (const s of d20) { if (!byStock[s.sym]) byStock[s.sym] = []; byStock[s.sym].push(s); }
for (const [sym, sigs] of Object.entries(byStock).sort((a, b) => b[1].length - a[1].length)) {
  const w = sigs.filter(s => s.outcome.startsWith('hit')), st = sigs.filter(s => s.outcome === 'stopped');
  const best = sigs.reduce((b, s) => s.mfe10 > b.mfe10 ? s : b, sigs[0]);
  console.log(`  ${sym.padEnd(13)} │ ${String(sigs.length).padStart(4)} │ ${String(w.length).padStart(1)} │ ${String(st.length).padStart(1)} │ ${(w.length / sigs.length * 100).toFixed(0).padStart(4)}% │ ${('+' + (sigs.reduce((s, v) => s + v.mfe10, 0) / sigs.length).toFixed(1) + '%').padStart(5)} │ ${((sigs.reduce((s, v) => s + v.pnlPct, 0) / sigs.length) >= 0 ? '+' : '') + (sigs.reduce((s, v) => s + v.pnlPct, 0) / sigs.length).toFixed(1) + '%'} │ +${best.mfe20.toFixed(1)}% (${best.date})`);
}

// ═══ PART 6: MONTHLY ═══
console.log('\n═══ PART 6: MONTHLY PERFORMANCE (D20+) ═══\n');
const monthly = {};
for (const s of d20) {
  if (!monthly[s.month]) monthly[s.month] = { w: 0, t: 0 };
  monthly[s.month].t++;
  if (s.outcome.startsWith('hit')) monthly[s.month].w++;
}
console.log('  Month │ Sigs │ Wins │ WR');
console.log('  ──────┼──────┼──────┼──────');
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
for (const m of months) {
  if (!monthly[m]) continue;
  const d = monthly[m];
  console.log(`  ${m.padEnd(5)} │ ${String(d.t).padStart(4)} │ ${String(d.w).padStart(4)} │ ${(d.w / d.t * 100).toFixed(0).padStart(4)}%`);
}

// ═══ PART 7: ZONE SHAPE ═══
console.log('\n═══ PART 7: ZONE SHAPE PERFORMANCE (D20+) ═══\n');
console.log('  Shape │ Sigs │ Wins │ WR    │ MFE   │ PnL');
console.log('  ──────┼──────┼──────┼───────┼───────┼──────');
for (const shape of ['FLAT', 'ASC']) {
  const grp = d20.filter(s => s.zoneShape === shape);
  if (grp.length === 0) continue;
  const w = grp.filter(s => s.outcome.startsWith('hit'));
  console.log(`  ${shape.padEnd(5)} │ ${String(grp.length).padStart(4)} │ ${String(w.length).padStart(4)} │ ${(w.length / grp.length * 100).toFixed(0).padStart(4)}% │ ${('+' + (grp.reduce((s, v) => s + v.mfe10, 0) / grp.length).toFixed(1) + '%').padStart(5)} │ ${((grp.reduce((s, v) => s + v.pnlPct, 0) / grp.length) >= 0 ? '+' : '') + (grp.reduce((s, v) => s + v.pnlPct, 0) / grp.length).toFixed(1) + '%'}`);
}

// ═══ PART 8: MULTI-SET OVERLAP ═══
console.log('\n═══ PART 8: MULTI-SET OVERLAP ═══\n');
const sigMap = {};
for (const [ps, sigs] of Object.entries(allPS)) {
  for (const s of sigs) { const k = `${s.sym}_${s.date}`; if (!sigMap[k]) sigMap[k] = { ...s, sets: [] }; sigMap[k].sets.push(ps); }
}
console.log('  Sets │ Sigs │ Wins │ WR    │ MFE   │ PnL    │ Quality');
console.log('  ─────┼──────┼──────┼───────┼───────┼────────┼────────');
for (const cnt of [1, 2, 3, 4]) {
  const grp = Object.values(sigMap).filter(s => s.sets.length >= cnt);
  if (grp.length < 2) continue;
  const w = grp.filter(s => s.outcome.startsWith('hit'));
  const q = w.length / grp.length >= 0.55 ? '★★★' : w.length / grp.length >= 0.45 ? '★★' : w.length / grp.length >= 0.35 ? '★' : '';
  console.log(`  ≥${cnt}   │ ${String(grp.length).padStart(4)} │ ${String(w.length).padStart(4)} │ ${(w.length / grp.length * 100).toFixed(1).padStart(4)}% │ ${('+' + (grp.reduce((s, v) => s + v.mfe10, 0) / grp.length).toFixed(1) + '%').padStart(5)} │ ${((grp.reduce((s, v) => s + v.pnlPct, 0) / grp.length) >= 0 ? '+' : '') + (grp.reduce((s, v) => s + v.pnlPct, 0) / grp.length).toFixed(2) + '%'} │ ${q}`);
}

// ═══ PART 9: STOP ANALYSIS ═══
console.log('\n═══ PART 9: STOP ANALYSIS ═══\n');
for (const [name, r] of Object.entries(allPS)) {
  const st = r.filter(s => s.outcome === 'stopped');
  if (st.length === 0) continue;
  const fs = st.filter(s => s.mfe10 >= 3);
  const avgDay = (st.reduce((s, v) => s + v.exitDay, 0) / st.length).toFixed(1);
  const avgLoss = (st.reduce((s, v) => s + v.pnlPct, 0) / st.length).toFixed(1);
  console.log(`  ${name.padEnd(10)}: ${st.length} stops, avg day ${avgDay}, avg loss ${avgLoss}%, false stops: ${fs.length} (${(fs.length / st.length * 100).toFixed(0)}%)`);
  if (fs.length > 0) {
    console.log(`    False stop detail: avg MFE +${(fs.reduce((s, v) => s + v.mfe10, 0) / fs.length).toFixed(1)}% before stopping`);
  }
}

// ═══ PART 10: TOP TRADES ═══
console.log('\n═══ PART 10: TOP 10 TRADES BY MFE (D20+) ═══\n');
console.log('  # │ Stock        │ Date         │ Entry  │ MFE20  │ Outcome  │ PnL');
console.log('  ──┼──────────────┼──────────────┼────────┼────────┼──────────┼──────');
const topTrades = [...d20].sort((a, b) => b.mfe20 - a.mfe20).slice(0, 10);
for (let i = 0; i < topTrades.length; i++) {
  const t = topTrades[i];
  console.log(`  ${String(i + 1).padStart(2)} │ ${t.sym.padEnd(12)} │ ${t.date.padEnd(12)} │ ${t.entry.toFixed(0).padStart(6)} │ ${('+' + t.mfe20.toFixed(1) + '%').padStart(6)} │ ${t.outcome.padEnd(8)} │ ${(t.pnlPct >= 0 ? '+' : '') + t.pnlPct.toFixed(1)}%`);
}

// ═══ PART 11: WORST TRADES ═══
console.log('\n═══ PART 11: WORST 10 TRADES (D20+) ═══\n');
console.log('  # │ Stock        │ Date         │ Entry  │ MAE    │ Outcome  │ PnL');
console.log('  ──┼──────────────┼──────────────┼────────┼────────┼──────────┼──────');
const worstTrades = [...d20].sort((a, b) => a.mae - b.mae).slice(0, 10);
for (let i = 0; i < worstTrades.length; i++) {
  const t = worstTrades[i];
  console.log(`  ${String(i + 1).padStart(2)} │ ${t.sym.padEnd(12)} │ ${t.date.padEnd(12)} │ ${t.entry.toFixed(0).padStart(6)} │ ${t.mae.toFixed(1).padStart(5)}% │ ${t.outcome.padEnd(8)} │ ${(t.pnlPct >= 0 ? '+' : '') + t.pnlPct.toFixed(1)}%`);
}

console.log('\n' + '█'.repeat(90));
console.log('  BACKTEST COMPLETE — 29 Portfolio OHLCV Files');
console.log('█'.repeat(90));
