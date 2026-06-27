// RSI LENGTH-AWARE ZONE BACKTEST on 29 OHLCV files
// Tests RSI(2), RSI(3), RSI(5), RSI(8), RSI(14) at cheat-sheet zone thresholds
// against our breakout signals to find optimal RSI filter

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

// Compute RSI for any period
function computeRSI(candles, period) {
  const rsi = new Array(candles.length).fill(50);
  if (candles.length < period + 2) return rsi;
  let avgG = 0, avgL = 0;
  for (let i = 1; i <= period; i++) {
    const ch = candles[i].c - candles[i-1].c;
    if (ch > 0) avgG += ch; else avgL += Math.abs(ch);
  }
  avgG /= period; avgL /= period;
  for (let i = period + 1; i < candles.length; i++) {
    const ch = candles[i].c - candles[i-1].c;
    avgG = (avgG * (period-1) + Math.max(ch, 0)) / period;
    avgL = (avgL * (period-1) + Math.max(-ch, 0)) / period;
    rsi[i] = avgL < 0.0001 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return rsi;
}

// Collect all breakout signals with multiple RSI values
const ALL = [];
for (const file of files) {
  const c = parseCSV(path.join(DIR, file)); if (c.length < 60) continue;
  const sym = file.replace('_NS_OHLCV.csv', ''), a = atr14(c);
  const rsi2 = computeRSI(c, 2), rsi3 = computeRSI(c, 3), rsi5 = computeRSI(c, 5);
  const rsi8 = computeRSI(c, 8), rsi14 = computeRSI(c, 14);

  for (let i = 40; i < c.length - 11; i++) {
    const s = c[i]; if (s.c <= 0 || a[i] <= 0) continue; const r = s.h - s.l; if (r <= 0) continue;
    let bZ = null; for (let zL = 25; zL >= 4; zL--) { const zS = i - zL; if (zS < 1) continue; let zH = -Infinity, zLo = Infinity, ok = true; for (let j = zS; j < i; j++) { zH = Math.max(zH, c[j].h); zLo = Math.min(zLo, c[j].l); if ((c[j].h - c[j].l) / (a[j] || 1) > 1.0) ok = false; } if (!ok) continue; bZ = { zH, zL: zLo, len: zL }; break; }
    if (!bZ || s.c <= bZ.zH * 1.001) continue;

    let mfe = 0, h5 = false, d5 = 99;
    for (let d = i+1; d <= Math.min(i+10, c.length-1); d++) {
      const pH = (c[d].h - s.c) / s.c * 100;
      if (pH > mfe) mfe = pH; if (!h5 && pH >= 5) { h5 = true; d5 = d - i; }
    }

    ALL.push({ sym, date: c[i].date, h5, mfe, d5,
      rsi2: rsi2[i], rsi3: rsi3[i], rsi5: rsi5[i], rsi8: rsi8[i], rsi14: rsi14[i] });
  }
}
const W = ALL.filter(s => s.h5), L = ALL.filter(s => !s.h5);
console.log(`Breakout signals: ${ALL.length} | Winners: ${W.length} (${(W.length/ALL.length*100).toFixed(1)}%)\n`);

console.log('█'.repeat(85));
console.log('  RSI LENGTH-AWARE ZONE BACKTEST');
console.log('  Cheat sheet zones applied to compression breakout signals');
console.log('█'.repeat(85));

// ═══ PART 1: Distribution of RSI values at breakout — Winners vs Losers ═══
console.log('\n═══ PART 1: RSI AT BREAKOUT — Winners vs Losers ═══\n');
console.log('  RSI Length │ Winners Mean │ Losers Mean │ Delta  │ Significance');
console.log('  ──────────┼──────────────┼─────────────┼────────┼─────────────');
for (const [name, field] of [['RSI(2)','rsi2'],['RSI(3)','rsi3'],['RSI(5)','rsi5'],['RSI(8)','rsi8'],['RSI(14)','rsi14']]) {
  const wM = W.reduce((s, t) => s + t[field], 0) / W.length;
  const lM = L.reduce((s, t) => s + t[field], 0) / L.length;
  const d = wM - lM;
  const wStd = Math.sqrt(W.reduce((s, t) => s + (t[field] - wM)**2, 0) / W.length);
  const lStd = Math.sqrt(L.reduce((s, t) => s + (t[field] - lM)**2, 0) / L.length);
  const pooled = Math.sqrt((wStd**2 + lStd**2) / 2);
  const cohensD = pooled > 0 ? Math.abs(d) / pooled : 0;
  console.log(`  ${name.padEnd(10)} │ ${wM.toFixed(1).padStart(12)} │ ${lM.toFixed(1).padStart(11)} │ ${(d>=0?'+':'')+d.toFixed(1).padStart(5)} │ d=${cohensD.toFixed(2)} ${cohensD>=0.3?'MODERATE':cohensD>=0.15?'SMALL':'TINY'}`);
}

// ═══ PART 2: RSI(2) zone analysis using cheat sheet thresholds ═══
console.log('\n═══ PART 2: RSI(2) ZONE ANALYSIS (cheat sheet thresholds) ═══\n');
const rsi2Zones = [
  { name: 'Oversold (<3)', lo: 0, hi: 3 },
  { name: 'Support (3-21)', lo: 3, hi: 21 },
  { name: 'Below mid (21-50)', lo: 21, hi: 50 },
  { name: 'Above mid (50-79)', lo: 50, hi: 79 },
  { name: 'Resistance (79-88)', lo: 79, hi: 88 },
  { name: 'Overbought (88-97)', lo: 88, hi: 97 },
  { name: 'Extreme OB (>97)', lo: 97, hi: 101 },
];
console.log('  RSI(2) Zone          │ Signals │ Winners │ HitRate │ Avg MFE │ Avg D5');
console.log('  ─────────────────────┼─────────┼─────────┼─────────┼─────────┼───────');
for (const z of rsi2Zones) {
  const grp = ALL.filter(s => s.rsi2 >= z.lo && s.rsi2 < z.hi);
  const wins = grp.filter(s => s.h5).length;
  const rate = grp.length > 0 ? (wins / grp.length * 100).toFixed(1) : '—';
  const mfe = grp.length > 0 ? (grp.reduce((s, t) => s + t.mfe, 0) / grp.length).toFixed(1) : '—';
  const d5 = wins > 0 ? (grp.filter(s=>s.h5).reduce((s,t)=>s+t.d5,0)/wins).toFixed(1) : '—';
  console.log(`  ${z.name.padEnd(22)} │ ${String(grp.length).padStart(7)} │ ${String(wins).padStart(7)} │ ${rate.padStart(6)}% │ ${('+'+mfe+'%').padStart(7)} │ ${d5.padStart(5)}d`);
}

// ═══ PART 3: RSI(14) zone analysis ═══
console.log('\n═══ PART 3: RSI(14) ZONE ANALYSIS (standard zones) ═══\n');
const rsi14Zones = [
  { name: 'Oversold (<27.7)', lo: 0, hi: 27.7 },
  { name: 'Support (27.7-40.9)', lo: 27.7, hi: 40.9 },
  { name: 'Below mid (40.9-50)', lo: 40.9, hi: 50 },
  { name: 'Above mid (50-59.1)', lo: 50, hi: 59.1 },
  { name: 'Resistance (59.1-63.5)', lo: 59.1, hi: 63.5 },
  { name: 'Overbought (63.5-76.6)', lo: 63.5, hi: 76.6 },
  { name: 'Extreme OB (>76.6)', lo: 76.6, hi: 101 },
];
console.log('  RSI(14) Zone              │ Signals │ Winners │ HitRate │ Avg MFE │ Avg D5');
console.log('  ──────────────────────────┼─────────┼─────────┼─────────┼─────────┼───────');
for (const z of rsi14Zones) {
  const grp = ALL.filter(s => s.rsi14 >= z.lo && s.rsi14 < z.hi);
  const wins = grp.filter(s => s.h5).length;
  const rate = grp.length > 0 ? (wins / grp.length * 100).toFixed(1) : '—';
  const mfe = grp.length > 0 ? (grp.reduce((s, t) => s + t.mfe, 0) / grp.length).toFixed(1) : '—';
  const d5 = wins > 0 ? (grp.filter(s=>s.h5).reduce((s,t)=>s+t.d5,0)/wins).toFixed(1) : '—';
  console.log(`  ${z.name.padEnd(27)} │ ${String(grp.length).padStart(7)} │ ${String(wins).padStart(7)} │ ${rate.padStart(6)}% │ ${('+'+mfe+'%').padStart(7)} │ ${d5.padStart(5)}d`);
}

// ═══ PART 4: Optimal RSI threshold search for each period ═══
console.log('\n═══ PART 4: OPTIMAL THRESHOLD SEARCH — Best minimum RSI per period ═══\n');
for (const [name, field] of [['RSI(2)','rsi2'],['RSI(3)','rsi3'],['RSI(5)','rsi5'],['RSI(8)','rsi8'],['RSI(14)','rsi14']]) {
  console.log(`  ${name} — current threshold: ${name==='RSI(2)'?'≥50':'not used'}`);
  console.log('  Threshold │ Pass │ Wins │ HitRate │ Avg MFE │ vs Base │ Verdict');
  console.log('  ──────────┼──────┼──────┼─────────┼─────────┼─────────┼────────');
  const baseRate = W.length / ALL.length * 100;
  for (const thr of [20, 30, 40, 50, 55, 60, 65, 70, 75, 80, 85, 90]) {
    const pass = ALL.filter(s => s[field] >= thr);
    const wins = pass.filter(s => s.h5).length;
    const rate = pass.length > 0 ? wins / pass.length * 100 : 0;
    const mfe = pass.length > 0 ? pass.reduce((s,t)=>s+t.mfe,0)/pass.length : 0;
    const delta = rate - baseRate;
    const verdict = delta > 3 ? 'BETTER' : delta > 0 ? 'SLIGHT' : 'WORSE';
    console.log(`  ≥${String(thr).padStart(3)}      │ ${String(pass.length).padStart(4)} │ ${String(wins).padStart(4)} │ ${rate.toFixed(1).padStart(6)}% │ ${('+'+mfe.toFixed(1)+'%').padStart(7)} │ ${(delta>=0?'+':'')+delta.toFixed(1).padStart(6)}% │ ${verdict}`);
  }
  console.log('');
}

// ═══ PART 5: Multi-RSI combinations ═══
console.log('═══ PART 5: MULTI-RSI COMBINATIONS — Stack multiple RSI filters ═══\n');
const combos = [
  { name: 'Current: RSI(2) ≥ 50 only', fn: s => s.rsi2 >= 50 },
  { name: 'RSI(2) ≥ 50 + RSI(14) ≥ 50', fn: s => s.rsi2 >= 50 && s.rsi14 >= 50 },
  { name: 'RSI(2) ≥ 50 + RSI(14) ≥ 55', fn: s => s.rsi2 >= 50 && s.rsi14 >= 55 },
  { name: 'RSI(2) ≥ 50 + RSI(14) 50-70 (not extreme OB)', fn: s => s.rsi2 >= 50 && s.rsi14 >= 50 && s.rsi14 <= 70 },
  { name: 'RSI(2) ≥ 60 + RSI(14) ≥ 50', fn: s => s.rsi2 >= 60 && s.rsi14 >= 50 },
  { name: 'RSI(2) ≥ 70 (resistance zone)', fn: s => s.rsi2 >= 70 },
  { name: 'RSI(2) ≥ 80 (overbought per cheat)', fn: s => s.rsi2 >= 80 },
  { name: 'RSI(5) ≥ 60 + RSI(2) ≥ 50', fn: s => s.rsi5 >= 60 && s.rsi2 >= 50 },
  { name: 'RSI(3) ≥ 60 + RSI(14) ≥ 50', fn: s => s.rsi3 >= 60 && s.rsi14 >= 50 },
  { name: 'RSI(2) in 50-97 (above mid, not extreme)', fn: s => s.rsi2 >= 50 && s.rsi2 <= 97 },
  { name: 'RSI(14) ≥ 50 only (replace RSI2)', fn: s => s.rsi14 >= 50 },
  { name: 'RSI(14) ≥ 55 only', fn: s => s.rsi14 >= 55 },
  { name: 'RSI(14) in resistance 59-76 (sweet spot)', fn: s => s.rsi14 >= 59 && s.rsi14 <= 76 },
  { name: 'No RSI filter at all', fn: () => true },
];
const baseRate = W.length / ALL.length * 100;
console.log('  Combination                                     │ Pass │ Wins │ HitRate │ ΔRate │ Verdict');
console.log('  ────────────────────────────────────────────────┼──────┼──────┼─────────┼───────┼────────');
for (const c of combos) {
  const pass = ALL.filter(c.fn);
  const wins = pass.filter(s => s.h5).length;
  const rate = pass.length > 0 ? wins / pass.length * 100 : 0;
  const delta = rate - baseRate;
  console.log(`  ${c.name.padEnd(48)} │ ${String(pass.length).padStart(4)} │ ${String(wins).padStart(4)} │ ${rate.toFixed(1).padStart(6)}% │${(delta>=0?'+':'')+delta.toFixed(1).padStart(6)}% │ ${delta>2?'BETTER':delta>-1?'SAME':'WORSE'}`);
}

// ═══ PART 6: What RSI zones do our BEST signals fall in? ═══
console.log('\n═══ PART 6: WHERE DO OUR BEST SIGNALS (MFE>10%) LIVE IN RSI SPACE? ═══\n');
const best = ALL.filter(s => s.mfe >= 10);
console.log(`  ${best.length} signals with MFE ≥ 10%\n`);
console.log('  RSI     │ Mean   │ Median │ Min  │ Max  │ Cheat Sheet Zone');
console.log('  ────────┼────────┼────────┼──────┼──────┼─────────────────');
for (const [name, field] of [['RSI(2)','rsi2'],['RSI(3)','rsi3'],['RSI(5)','rsi5'],['RSI(14)','rsi14']]) {
  const vals = best.map(s => s[field]).sort((a, b) => a - b);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const median = vals[Math.floor(vals.length / 2)];
  const min = vals[0], max = vals[vals.length - 1];
  let zone = '—';
  if (name === 'RSI(2)') zone = mean > 88 ? 'Overbought' : mean > 79 ? 'Resistance' : mean > 50 ? 'Above mid' : 'Below mid';
  if (name === 'RSI(14)') zone = mean > 63.5 ? 'Overbought' : mean > 59.1 ? 'Resistance' : mean > 50 ? 'Above mid' : 'Below mid';
  console.log(`  ${name.padEnd(8)} │ ${mean.toFixed(1).padStart(6)} │ ${median.toFixed(1).padStart(6)} │ ${min.toFixed(0).padStart(4)} │ ${max.toFixed(0).padStart(4)} │ ${zone}`);
}
