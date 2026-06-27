// CCI(34) DEEP ANALYSIS — Correlate with screener output classes
// Test CCI(34) across all stages, onset tiers, zone badges, and ATR states

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function pR(w,v){return w.length===0?50:(w.filter(x=>x<v).length/w.length)*100;}

// Compute CCI for any period
function computeCCI(candles, period) {
  const cci = new Array(candles.length).fill(0);
  for (let i = period - 1; i < candles.length; i++) {
    // Typical Price
    let tpSum = 0;
    for (let j = i - period + 1; j <= i; j++) tpSum += (candles[j].h + candles[j].l + candles[j].c) / 3;
    const tpMean = tpSum / period;
    // Mean Deviation
    let mdSum = 0;
    for (let j = i - period + 1; j <= i; j++) mdSum += Math.abs((candles[j].h + candles[j].l + candles[j].c) / 3 - tpMean);
    const md = mdSum / period;
    const tp = (candles[i].h + candles[i].l + candles[i].c) / 3;
    cci[i] = md > 0 ? (tp - tpMean) / (0.015 * md) : 0;
  }
  return cci;
}

// Collect ALL candles (not just breakouts) to test CCI across all screener stages
const ALL = [];
for (const file of files) {
  const c = parseCSV(path.join(DIR, file)); if (c.length < 60) continue;
  const sym = file.replace('_NS_OHLCV.csv', ''), a = atr14(c);
  const cci34 = computeCCI(c, 34);
  const cci14 = computeCCI(c, 14);
  const cci5 = computeCCI(c, 5);

  for (let i = 40; i < c.length - 11; i++) {
    const s = c[i]; if (s.c <= 0 || a[i] <= 0) continue; const r = s.h - s.l; if (r <= 0) continue;
    const ap = (a[i]/s.c)*100; const w120=[]; for(let j=Math.max(14,i-121);j<i;j++){if(c[j].c>0&&a[j]>0)w120.push((a[j]/c[j].c)*100);}
    const apctl = pR(w120, ap); const ra = r/a[i], cl = (s.c-s.l)/r*100, bp = Math.abs(s.c-s.o)/r*100, uw = (s.h-Math.max(s.o,s.c))/r*100;
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=Math.max(i-Math.max(0,i-20),1);
    const vR=v20>0?s.v/v20:0;
    let v5=0;for(let j=Math.max(0,i-5);j<i;j++)v5+=c[j].v;v5/=Math.max(i-Math.max(0,i-5),1);
    const vP=v5>0?s.v/v5:0;
    // Zone detection
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL};break;}
    const hasZone = bZ !== null;
    const brokeOut = hasZone && s.c > bZ.zH * 1.001;
    // ATR state
    let atrState = 'none';
    if (apctl < 20) atrState = 'SLEEP'; else if (apctl < 40) atrState = 'BUILD';
    else if (apctl <= 60) atrState = 'INFLECT'; else if (apctl <= 95) atrState = 'MOMEN';
    // Future
    let mfe = 0, h5 = false, h3 = false, d5 = 99;
    for (let d=i+1; d<=Math.min(i+10, c.length-1); d++) {
      const pH = (c[d].h - s.c) / s.c * 100;
      if (pH > mfe) mfe = pH; if (!h5 && pH >= 5) { h5 = true; d5 = d-i; } if (!h3 && pH >= 3) h3 = true;
    }
    // CCI slope (5-day)
    const cciSlope5 = i >= 5 ? cci34[i] - cci34[i-5] : 0;
    // CCI crossing zero
    const cciCrossUp = i >= 1 && cci34[i] > 0 && cci34[i-1] <= 0;
    const cciCross100 = i >= 1 && cci34[i] > 100 && cci34[i-1] <= 100;
    // CCI divergence (price up but CCI down)
    const priceTrend = i >= 5 ? s.c > c[i-5].c : false;
    const cciTrend = i >= 5 ? cci34[i] > cci34[i-5] : false;
    const bullDiv = !priceTrend && cciTrend; // price down, CCI up
    const bearDiv = priceTrend && !cciTrend; // price up, CCI down

    ALL.push({ sym, date: c[i].date, cci34: cci34[i], cci14: cci14[i], cci5: cci5[i],
      cciSlope5, cciCrossUp, cciCross100, bullDiv, bearDiv,
      hasZone, brokeOut, atrState, apctl, cl, bp, uw, ra, vR, vP,
      mfe, h5, h3, d5 });
  }
}

const breakouts = ALL.filter(s => s.brokeOut);
const W = breakouts.filter(s => s.h5), L = breakouts.filter(s => !s.h5);
console.log(`All candles: ${ALL.length} | Breakouts: ${breakouts.length} | Winners: ${W.length} (${(W.length/breakouts.length*100).toFixed(1)}%)\n`);

console.log('█'.repeat(85));
console.log('  CCI(34) DEEP ANALYSIS — Correlation with Screener Output Classes');
console.log('█'.repeat(85));

// ═══ PART 1: CCI(34) at breakout — Winners vs Losers ═══
console.log('\n═══ PART 1: CCI AT BREAKOUT — Winners vs Losers ═══\n');
console.log('  Period  │ Winners Mean │ Losers Mean │ Delta   │ Cohen d │ Significance');
console.log('  ────────┼──────────────┼─────────────┼─────────┼─────────┼─────────────');
for (const [name, field] of [['CCI(5)', 'cci5'], ['CCI(14)', 'cci14'], ['CCI(34)', 'cci34']]) {
  const wV = W.map(s => s[field]), lV = L.map(s => s[field]);
  const wM = wV.reduce((s,v)=>s+v,0)/wV.length, lM = lV.reduce((s,v)=>s+v,0)/lV.length;
  const d = wM - lM;
  const pooled = Math.sqrt(((wV.reduce((s,v)=>s+(v-wM)**2,0)+lV.reduce((s,v)=>s+(v-lM)**2,0))/(wV.length+lV.length-2)));
  const cd = pooled > 0 ? Math.abs(d) / pooled : 0;
  console.log(`  ${name.padEnd(8)} │ ${wM.toFixed(1).padStart(12)} │ ${lM.toFixed(1).padStart(11)} │ ${(d>=0?'+':'')+d.toFixed(1).padStart(7)} │ ${cd.toFixed(2).padStart(7)} │ ${cd>=0.3?'MODERATE':cd>=0.15?'SMALL':'TINY'}`);
}

// ═══ PART 2: CCI(34) zone distribution for breakouts ═══
console.log('\n═══ PART 2: CCI(34) ZONES — Where do breakouts live? ═══\n');
const cciZones = [
  { name: 'Extreme oversold (<-200)', lo: -9999, hi: -200 },
  { name: 'Oversold (-200 to -100)', lo: -200, hi: -100 },
  { name: 'Weak (-100 to 0)', lo: -100, hi: 0 },
  { name: 'Mild bullish (0 to 100)', lo: 0, hi: 100 },
  { name: 'Strong (100 to 200)', lo: 100, hi: 200 },
  { name: 'Extreme overbought (>200)', lo: 200, hi: 9999 },
];
console.log('  CCI(34) Zone              │ All  │ Breakouts │ Winners │ HitRate │ Avg MFE │ Avg D5');
console.log('  ──────────────────────────┼──────┼───────────┼─────────┼─────────┼─────────┼───────');
for (const z of cciZones) {
  const all = ALL.filter(s => s.cci34 >= z.lo && s.cci34 < z.hi);
  const brk = breakouts.filter(s => s.cci34 >= z.lo && s.cci34 < z.hi);
  const wins = brk.filter(s => s.h5).length;
  const rate = brk.length > 0 ? (wins/brk.length*100).toFixed(1) : '—';
  const mfe = brk.length > 0 ? (brk.reduce((s,t)=>s+t.mfe,0)/brk.length).toFixed(1) : '—';
  const d5 = wins > 0 ? (brk.filter(s=>s.h5).reduce((s,t)=>s+t.d5,0)/wins).toFixed(1) : '—';
  console.log(`  ${z.name.padEnd(27)} │ ${String(all.length).padStart(4)} │ ${String(brk.length).padStart(9)} │ ${String(wins).padStart(7)} │ ${rate.padStart(6)}% │ ${('+'+mfe+'%').padStart(7)} │ ${d5.padStart(5)}d`);
}

// ═══ PART 3: CCI(34) by ATR State ═══
console.log('\n═══ PART 3: CCI(34) BY ATR STATE ═══\n');
console.log('  ATR State  │ Avg CCI(34) │ Breakouts │ Winners │ HitRate │ CCI>0 Hit │ CCI>100 Hit');
console.log('  ───────────┼─────────────┼───────────┼─────────┼─────────┼───────────┼────────────');
for (const state of ['SLEEP', 'BUILD', 'INFLECT', 'MOMEN']) {
  const grp = breakouts.filter(s => s.atrState === state);
  const wins = grp.filter(s => s.h5).length;
  const avgCCI = grp.length > 0 ? grp.reduce((s,t)=>s+t.cci34,0)/grp.length : 0;
  const above0 = grp.filter(s => s.cci34 > 0);
  const above0W = above0.filter(s => s.h5).length;
  const above100 = grp.filter(s => s.cci34 > 100);
  const above100W = above100.filter(s => s.h5).length;
  console.log(`  ${state.padEnd(11)} │ ${avgCCI.toFixed(0).padStart(11)} │ ${String(grp.length).padStart(9)} │ ${String(wins).padStart(7)} │ ${(grp.length>0?(wins/grp.length*100).toFixed(1):'—').padStart(6)}% │ ${above0.length>0?(above0W/above0.length*100).toFixed(1)+'%':'—'.padStart(5)} │ ${above100.length>0?(above100W/above100.length*100).toFixed(1)+'%':'—'}`);
}

// ═══ PART 4: CCI(34) Slope — Is rising CCI better? ═══
console.log('\n═══ PART 4: CCI(34) 5-DAY SLOPE — Does rising CCI predict success? ═══\n');
console.log('  CCI Slope     │ Breakouts │ Winners │ HitRate │ Avg MFE │ Finding');
console.log('  ──────────────┼───────────┼─────────┼─────────┼─────────┼────────');
for (const [lo, hi, name] of [[-999,-50,'Crashing (<-50)'],[-50,-10,'Falling (-50 to -10)'],[-10,10,'Flat (-10 to 10)'],[10,50,'Rising (10 to 50)'],[50,200,'Surging (50-200)'],[200,9999,'Exploding (>200)']]) {
  const grp = breakouts.filter(s => s.cciSlope5 >= lo && s.cciSlope5 < hi);
  const wins = grp.filter(s => s.h5).length;
  const rate = grp.length > 0 ? wins/grp.length*100 : 0;
  const mfe = grp.length > 0 ? grp.reduce((s,t)=>s+t.mfe,0)/grp.length : 0;
  console.log(`  ${name.padEnd(15)} │ ${String(grp.length).padStart(9)} │ ${String(wins).padStart(7)} │ ${rate.toFixed(1).padStart(6)}% │ ${('+'+mfe.toFixed(1)+'%').padStart(7)} │ ${rate>50?'STRONG':rate>45?'GOOD':'WEAK'}`);
}

// ═══ PART 5: CCI Zero-Cross and +100 Cross events ═══
console.log('\n═══ PART 5: CCI(34) CROSSOVER EVENTS ═══\n');
const crossUp = breakouts.filter(s => s.cciCrossUp);
const crossUpW = crossUp.filter(s => s.h5).length;
const cross100 = breakouts.filter(s => s.cciCross100);
const cross100W = cross100.filter(s => s.h5).length;
const noCross = breakouts.filter(s => !s.cciCrossUp && !s.cciCross100);
const noCrossW = noCross.filter(s => s.h5).length;
console.log(`  CCI crossing 0 from below:    ${crossUp.length} breakouts, ${crossUpW} wins (${crossUp.length>0?(crossUpW/crossUp.length*100).toFixed(1):0}%)`);
console.log(`  CCI crossing +100 from below: ${cross100.length} breakouts, ${cross100W} wins (${cross100.length>0?(cross100W/cross100.length*100).toFixed(1):0}%)`);
console.log(`  No crossover:                 ${noCross.length} breakouts, ${noCrossW} wins (${noCross.length>0?(noCrossW/noCross.length*100).toFixed(1):0}%)`);

// ═══ PART 6: CCI Divergence ═══
console.log('\n═══ PART 6: CCI(34) DIVERGENCE — Price vs CCI disagreement ═══\n');
const bDiv = breakouts.filter(s => s.bullDiv);
const bDivW = bDiv.filter(s => s.h5).length;
const brDiv = breakouts.filter(s => s.bearDiv);
const brDivW = brDiv.filter(s => s.h5).length;
const noDiv = breakouts.filter(s => !s.bullDiv && !s.bearDiv);
const noDivW = noDiv.filter(s => s.h5).length;
console.log(`  Bullish divergence (price down, CCI up):  ${bDiv.length} breakouts, ${bDivW} wins (${bDiv.length>0?(bDivW/bDiv.length*100).toFixed(1):0}%)`);
console.log(`  Bearish divergence (price up, CCI down):  ${brDiv.length} breakouts, ${brDivW} wins (${brDiv.length>0?(brDivW/brDiv.length*100).toFixed(1):0}%)`);
console.log(`  No divergence:                            ${noDiv.length} breakouts, ${noDivW} wins (${noDiv.length>0?(noDivW/noDiv.length*100).toFixed(1):0}%)`);

// ═══ PART 7: CCI(34) threshold test — optimal minimum ═══
console.log('\n═══ PART 7: OPTIMAL CCI(34) THRESHOLD FOR BREAKOUTS ═══\n');
console.log('  Threshold   │ Pass │ Wins │ HitRate │ Avg MFE │ ΔRate │ Verdict');
console.log('  ────────────┼──────┼──────┼─────────┼─────────┼───────┼────────');
const baseRate = W.length / breakouts.length * 100;
for (const thr of [-100, -50, 0, 25, 50, 75, 100, 125, 150, 200]) {
  const pass = breakouts.filter(s => s.cci34 >= thr);
  const wins = pass.filter(s => s.h5).length;
  const rate = pass.length > 0 ? wins/pass.length*100 : 0;
  const mfe = pass.length > 0 ? pass.reduce((s,t)=>s+t.mfe,0)/pass.length : 0;
  const delta = rate - baseRate;
  console.log(`  CCI ≥ ${String(thr).padStart(4)}   │ ${String(pass.length).padStart(4)} │ ${String(wins).padStart(4)} │ ${rate.toFixed(1).padStart(6)}% │ ${('+'+mfe.toFixed(1)+'%').padStart(7)} │ ${(delta>=0?'+':'')+delta.toFixed(1).padStart(5)}% │ ${delta>2?'BETTER':delta>0?'SLIGHT':'SAME/WORSE'}`);
}

// ═══ PART 8: Combined CCI + Volume for breakout quality ═══
console.log('\n═══ PART 8: CCI + VOLUME COMBINATIONS ═══\n');
const combos = [
  { name: 'CCI>0 + Vol≥2x', fn: s => s.cci34 > 0 && s.vR >= 2 },
  { name: 'CCI>100 + Vol≥2x', fn: s => s.cci34 > 100 && s.vR >= 2 },
  { name: 'CCI>0 + CCI rising + Vol≥1.5x', fn: s => s.cci34 > 0 && s.cciSlope5 > 0 && s.vR >= 1.5 },
  { name: 'CCI>100 + CCI rising', fn: s => s.cci34 > 100 && s.cciSlope5 > 0 },
  { name: 'CCI zero-cross + Vol≥2x', fn: s => s.cciCrossUp && s.vR >= 2 },
  { name: 'CCI surging (slope>50) + body≥45%', fn: s => s.cciSlope5 > 50 && s.bp >= 45 },
  { name: 'CCI>50 + INFLECT ATR state', fn: s => s.cci34 > 50 && s.atrState === 'INFLECT' },
  { name: 'All breakouts (no CCI filter)', fn: () => true },
];
console.log('  Combination                          │ Pass │ Wins │ HitRate │ Avg MFE │ ΔRate');
console.log('  ─────────────────────────────────────┼──────┼──────┼─────────┼─────────┼──────');
for (const c of combos) {
  const pass = breakouts.filter(c.fn);
  const wins = pass.filter(s => s.h5).length;
  const rate = pass.length > 0 ? wins/pass.length*100 : 0;
  const mfe = pass.length > 0 ? pass.reduce((s,t)=>s+t.mfe,0)/pass.length : 0;
  console.log(`  ${c.name.padEnd(37)} │ ${String(pass.length).padStart(4)} │ ${String(wins).padStart(4)} │ ${rate.toFixed(1).padStart(6)}% │ ${('+'+mfe.toFixed(1)+'%').padStart(7)} │ ${((rate-baseRate)>=0?'+':'')+((rate-baseRate)).toFixed(1)}%`);
}

// ═══ PART 9: Best signals — what CCI do they have? ═══
console.log('\n═══ PART 9: BEST BREAKOUT SIGNALS (MFE≥10%) — CCI Profile ═══\n');
const best = breakouts.filter(s => s.mfe >= 10);
console.log(`  ${best.length} signals with MFE ≥ 10%\n`);
const bCCI = best.map(s => s.cci34).sort((a,b) => a-b);
console.log(`  CCI(34) Mean:   ${(bCCI.reduce((s,v)=>s+v,0)/bCCI.length).toFixed(0)}`);
console.log(`  CCI(34) Median: ${bCCI[Math.floor(bCCI.length/2)].toFixed(0)}`);
console.log(`  CCI(34) Min:    ${bCCI[0].toFixed(0)}`);
console.log(`  CCI(34) Max:    ${bCCI[bCCI.length-1].toFixed(0)}`);
console.log(`  CCI(34) > 0:    ${best.filter(s=>s.cci34>0).length} (${(best.filter(s=>s.cci34>0).length/best.length*100).toFixed(0)}%)`);
console.log(`  CCI(34) > 100:  ${best.filter(s=>s.cci34>100).length} (${(best.filter(s=>s.cci34>100).length/best.length*100).toFixed(0)}%)`);
console.log(`  CCI rising:     ${best.filter(s=>s.cciSlope5>0).length} (${(best.filter(s=>s.cciSlope5>0).length/best.length*100).toFixed(0)}%)`);
