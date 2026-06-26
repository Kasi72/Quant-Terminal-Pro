// Deep Stop-Loss Analysis on 29 OHLCV files
// Tests every stop formula to find optimal: minimize false stops, maximize saved losers

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));

function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function rsi2(c){const r=new Array(c.length).fill(50);if(c.length<4)return r;let g=0,l=0;for(let i=1;i<=2;i++){const ch=c[i].c-c[i-1].c;if(ch>0)g+=ch;else l+=Math.abs(ch);}g/=2;l/=2;for(let i=3;i<c.length;i++){const ch=c[i].c-c[i-1].c;g=(g+Math.max(ch,0))/2;l=(l+Math.max(-ch,0))/2;r[i]=l<1e-4?100:100-100/(1+g/l);}return r;}
function pR(w,v){return w.length===0?50:(w.filter(x=>x<v).length/w.length)*100;}
function upsC(cl,uw,bp,vp,zt,zl){let s=0;if(cl>=80)s+=20;else if(cl>=65)s+=12;if(uw<=20)s+=20;else if(uw<=35)s+=12;if(bp>=55)s+=15;else if(bp>=35)s+=9;if(vp>=4)s+=20;else if(vp>=2)s+=12;if(zt<=5)s+=15;else if(zt<=15)s+=9;if(zl>=12)s+=10;else if(zl>=6)s+=6;return s;}

// Collect all v5-WLB qualifying signals with full candle data for stop analysis
const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);
  for(let i=40;i<c.length-21;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    const ap=(a[i]/s.c)*100;const w=[];for(let j=Math.max(14,i-121);j<i;j++){if(c[j].c>0&&a[j]>0)w.push((a[j]/c[j].c)*100);}
    const apctl=pR(w,ap);const ra=r/a[i],cl=(s.c-s.l)/r*100,bp=Math.abs(s.c-s.o)/r*100,uw=(s.h-Math.max(s.o,s.c))/r*100,sr=(r/s.c)*100;
    let tS=0;for(let j=Math.max(0,i-20);j<i;j++)tS+=c[j].c*c[j].v;const to=tS/Math.max(i-Math.max(0,i-20),1);
    let p10R=0,p10C=0,p10E=0;for(let j=i-10;j<i;j++){if(j<1)continue;const t=Math.max(c[j].h-c[j].l,Math.abs(c[j].h-c[j-1].c),Math.abs(c[j].l-c[j-1].c));const x=t/a[j];p10R+=x;p10C++;if(x>1.1)p10E++;}
    const p10A=p10C>0?p10R/p10C:1;const vE=p10A>0?ra/p10A:1;
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=Math.max(i-Math.max(0,i-20),1);const vR=v20>0?s.v/v20:0;
    let v5=0;for(let j=Math.max(0,i-5);j<i;j++)v5+=c[j].v;v5/=Math.max(i-Math.max(0,i-5),1);const vP=v5>0?s.v/v5:0;
    let p10VS=0,p10VC=0;for(let j=i-10;j<i;j++){if(j<0)continue;p10VS+=(v20>0?c[j].v/v20:0);p10VC++;}const p10V=p10VC>0?p10VS/p10VC:1;
    let p5VS=0,p5VC=0;for(let j=i-5;j<i;j++){if(j<0)continue;p5VS+=(v20>0?c[j].v/v20:0);p5VC++;}const p5V=p5VC>0?p5VS/p5VC:1;
    let rVol=0,gVol=0;for(let j=i-10;j<i;j++){if(j<0)continue;if(c[j].c<c[j].o)rVol+=c[j].v;else gVol+=c[j].v;}const rvb=gVol>0?rVol/gVol:(rVol>0?10:1);
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL,zt:zLo>0?((zH-zLo)/zLo)*100:99};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const uV=upsC(cl,uw,bp,vP,bZ.zt,bZ.len);

    // Zone-low structural stop
    const zoneLow = bZ.zL;
    // Previous candle low
    const prevLow = i > 0 ? c[i-1].l : s.l;
    // Second-lowest low in zone
    const zoneLows = [];
    for(let j=i-bZ.len;j<i;j++){if(j>=0)zoneLows.push(c[j].l);}
    zoneLows.sort((a,b)=>a-b);
    const secondLow = zoneLows.length >= 2 ? zoneLows[1] : zoneLows[0];
    // Signal candle low
    const sigLow = s.l;

    // Compute future 20-day data for each signal
    const futureDays = [];
    for(let d=i+1;d<=Math.min(i+20,c.length-1);d++){
      futureDays.push({
        day: d-i,
        h: c[d].h, l: c[d].l, c: c[d].c, o: c[d].o,
        pctHigh: (c[d].h - s.c) / s.c * 100,
        pctLow: (c[d].l - s.c) / s.c * 100,
      });
    }

    // MFE and MAE
    let mfe10=0,mae10=0,mfe20=0,mae20=0,h5=false,d5=99;
    for(const fd of futureDays){
      if(fd.day<=10){if(fd.pctHigh>mfe10)mfe10=fd.pctHigh;if(fd.pctLow<mae10)mae10=fd.pctLow;if(!h5&&fd.pctHigh>=5){h5=true;d5=fd.day;}}
      if(fd.pctHigh>mfe20)mfe20=fd.pctHigh;if(fd.pctLow<mae20)mae20=fd.pctLow;
    }

    // Day-by-day low waterfall (how deep does it dip before recovering?)
    let minLowDay1=99,minLowDay2=99,minLowDay3=99;
    if(futureDays.length>=1)minLowDay1=futureDays[0].pctLow;
    if(futureDays.length>=2)minLowDay2=Math.min(futureDays[0].pctLow,futureDays[1].pctLow);
    if(futureDays.length>=3)minLowDay3=Math.min(futureDays[0].pctLow,futureDays[1].pctLow,futureDays[2].pctLow);

    ALL.push({sym,date:c[i].date,entry:s.c,atr:a[i],atrPct:ap,zoneLow,zoneHigh:bZ.zH,sigLow,prevLow,secondLow,
      ra,cl,bp,uw,vP,vR,vE,p10A,rvb,uV,mfe10,mae10,mfe20,mae20,h5,d5,futureDays,
      minLowDay1,minLowDay2,minLowDay3,
      atrStop075: (0.75*a[i]/s.c)*100, // current stop as %
      structStop: ((s.c - (zoneLow - 0.25*a[i]))/s.c)*100,
    });
  }
}
console.log(`Total breakout signals for stop analysis: ${ALL.length}\n`);

// ═══ PART 1: Analyze MAE distribution — how deep do winners dip? ═══
console.log('═'.repeat(80));
console.log('  PART 1: MAE DISTRIBUTION — How deep do WINNERS dip before hitting +5%?');
console.log('═'.repeat(80));
const winners = ALL.filter(s=>s.h5);
const losers = ALL.filter(s=>!s.h5);
console.log(`Winners: ${winners.length} | Losers: ${losers.length}\n`);

const maeBuckets = [-1,-1.5,-2,-2.5,-3,-3.5,-4,-5,-6,-7,-8,-10,-15];
console.log('MAE Bucket    │ Winners hitting │ % of winners │ Losers below │ Would stop good trade?');
console.log('──────────────┼─────────────────┼──────────────┼──────────────┼──────────────────────');
for(const threshold of maeBuckets){
  const wBelow = winners.filter(w=>w.mae10 <= threshold).length;
  const wPct = (wBelow/winners.length*100).toFixed(1);
  const lBelow = losers.filter(l=>l.mae10 <= threshold).length;
  const wouldStop = wBelow > 0 ? 'YES — FALSE STOP' : 'Safe';
  console.log(`  ≤ ${threshold.toFixed(1).padStart(5)}%  │ ${String(wBelow).padStart(15)} │ ${wPct.padStart(11)}% │ ${String(lBelow).padStart(12)} │ ${wouldStop}`);
}

// ═══ PART 2: Day-by-day dip analysis for winners ═══
console.log('\n' + '═'.repeat(80));
console.log('  PART 2: INTRADAY DIP TIMING — When do winners dip deepest?');
console.log('═'.repeat(80));
console.log('\n  Winners — worst dip by day:');
console.log('  Day 1 dip │ Day 1-2 dip │ Day 1-3 dip │ Full 10d MAE');
for(const w of winners.sort((a,b)=>a.mae10-b.mae10).slice(0,20)){
  console.log(`  ${w.minLowDay1.toFixed(1).padStart(7)}% │ ${w.minLowDay2.toFixed(1).padStart(9)}% │ ${w.minLowDay3.toFixed(1).padStart(9)}% │ ${w.mae10.toFixed(1).padStart(8)}%  ${w.sym} ${w.date} (MFE ${w.mfe10.toFixed(1)}%)`);
}

// ═══ PART 3: Test every stop formula ═══
console.log('\n' + '═'.repeat(80));
console.log('  PART 3: STOP FORMULA GRID SEARCH');
console.log('═'.repeat(80));

function testStop(signals, stopFn) {
  let falseStops = 0, correctStops = 0, survived = 0, totalPnl = 0;
  const falseList = [], correctList = [];
  for (const s of signals) {
    const stopPct = stopFn(s); // negative number like -2.5
    let stopped = false, stoppedDay = 0;
    for (const fd of s.futureDays) {
      if (fd.day > 10) break;
      if (fd.pctLow <= stopPct) { stopped = true; stoppedDay = fd.day; break; }
    }
    if (stopped) {
      if (s.h5) { falseStops++; falseList.push({...s, stoppedDay, stopPct}); totalPnl += stopPct; }
      else { correctStops++; correctList.push(s); totalPnl += stopPct; }
    } else {
      if (s.h5) { survived++; totalPnl += Math.min(s.mfe10, 5); } // assume T1 capture
      else { survived++; totalPnl += s.mae10; } // loser that wasn't stopped
    }
  }
  const n = signals.length;
  return { falseStops, correctStops, survived, totalPnl, avgPnl: totalPnl/n, falseList, n,
    falseRate: (falseStops/Math.max(winners.length,1)*100).toFixed(1) };
}

const stopFormulas = [
  { name: 'Current: 0.75×ATR [2%,3.5%]', fn: s => -Math.max(2.0, Math.min(3.5, 0.75*s.atr/s.entry*100)) },
  { name: '0.75×ATR [2%,4%]', fn: s => -Math.max(2.0, Math.min(4.0, 0.75*s.atr/s.entry*100)) },
  { name: '0.75×ATR [2.5%,4%]', fn: s => -Math.max(2.5, Math.min(4.0, 0.75*s.atr/s.entry*100)) },
  { name: '0.85×ATR [2%,3.5%]', fn: s => -Math.max(2.0, Math.min(3.5, 0.85*s.atr/s.entry*100)) },
  { name: '0.85×ATR [2.5%,4%]', fn: s => -Math.max(2.5, Math.min(4.0, 0.85*s.atr/s.entry*100)) },
  { name: '1.0×ATR [2%,4%]', fn: s => -Math.max(2.0, Math.min(4.0, 1.0*s.atr/s.entry*100)) },
  { name: '1.0×ATR [2.5%,4.5%]', fn: s => -Math.max(2.5, Math.min(4.5, 1.0*s.atr/s.entry*100)) },
  { name: '1.0×ATR [2%,5%]', fn: s => -Math.max(2.0, Math.min(5.0, 1.0*s.atr/s.entry*100)) },
  { name: '1.25×ATR [2.5%,5%]', fn: s => -Math.max(2.5, Math.min(5.0, 1.25*s.atr/s.entry*100)) },
  { name: 'Fixed 2.0%', fn: s => -2.0 },
  { name: 'Fixed 2.5%', fn: s => -2.5 },
  { name: 'Fixed 3.0%', fn: s => -3.0 },
  { name: 'Fixed 3.5%', fn: s => -3.5 },
  { name: 'Fixed 4.0%', fn: s => -4.0 },
  { name: 'Fixed 5.0%', fn: s => -5.0 },
  { name: 'ZoneLow-0.25ATR', fn: s => -((s.entry - (s.zoneLow - 0.25*s.atr))/s.entry*100) },
  { name: 'ZoneLow-0.5ATR', fn: s => -((s.entry - (s.zoneLow - 0.5*s.atr))/s.entry*100) },
  { name: 'ZoneLow (exact)', fn: s => -((s.entry - s.zoneLow)/s.entry*100) },
  { name: 'SigLow-0.25ATR', fn: s => -((s.entry - (s.sigLow - 0.25*s.atr))/s.entry*100) },
  { name: 'SecondLow-0.25ATR', fn: s => -((s.entry - (s.secondLow - 0.25*s.atr))/s.entry*100) },
  { name: 'PrevLow-0.25ATR', fn: s => -((s.entry - (s.prevLow - 0.25*s.atr))/s.entry*100) },
  { name: 'Max(0.75ATR,ZoneLow) [2%,4%]', fn: s => {
    const atrStop = 0.75*s.atr;
    const zoneStop = s.entry - s.zoneLow;
    const stop = Math.max(atrStop, zoneStop);
    return -Math.max(2.0, Math.min(4.0, stop/s.entry*100));
  }},
  { name: 'Max(1.0ATR,ZoneLow) [2.5%,5%]', fn: s => {
    const atrStop = 1.0*s.atr;
    const zoneStop = s.entry - s.zoneLow;
    const stop = Math.max(atrStop, zoneStop);
    return -Math.max(2.5, Math.min(5.0, stop/s.entry*100));
  }},
  { name: 'Adaptive: ATR<2%→3%, else 0.85ATR [2.5%,4.5%]', fn: s => {
    const atrPct = s.atr/s.entry*100;
    if(atrPct < 2.0) return -3.0;
    return -Math.max(2.5, Math.min(4.5, 0.85*atrPct));
  }},
  { name: '2-day grace + 0.75ATR [2%,3.5%]', fn: s => {
    // Only trigger stop after day 2 (skip day 1 shakeout)
    return -Math.max(2.0, Math.min(3.5, 0.75*s.atr/s.entry*100));
  }},
];

// Special: 2-day grace stop (check from day 2 only)
function testStopGrace(signals, stopFn, graceDay) {
  let falseStops = 0, correctStops = 0, survived = 0, totalPnl = 0;
  const falseList = [];
  for (const s of signals) {
    const stopPct = stopFn(s);
    let stopped = false;
    for (const fd of s.futureDays) {
      if (fd.day > 10) break;
      if (fd.day <= graceDay) continue; // grace period
      if (fd.pctLow <= stopPct) { stopped = true; break; }
    }
    if (stopped) {
      if (s.h5) { falseStops++; falseList.push(s); totalPnl += stopPct; }
      else { correctStops++; totalPnl += stopPct; }
    } else {
      if (s.h5) { survived++; totalPnl += Math.min(s.mfe10, 5); }
      else { survived++; totalPnl += s.mae10; }
    }
  }
  return { falseStops, correctStops, survived, totalPnl, avgPnl: totalPnl/signals.length, falseList, n: signals.length,
    falseRate: (falseStops/Math.max(winners.length,1)*100).toFixed(1) };
}

console.log('\n  Stop Formula                         │FalseStops│CorStops│FalseRate│ AvgPnl │ Expectancy');
console.log('  ─────────────────────────────────────┼──────────┼────────┼─────────┼────────┼──────────');
const formulaResults = [];
for(const sf of stopFormulas){
  const r = sf.name.includes('2-day grace') ? testStopGrace(ALL, sf.fn, 2) : testStop(ALL, sf.fn);
  const exp = r.avgPnl;
  formulaResults.push({name:sf.name, ...r, exp});
  console.log(`  ${sf.name.padEnd(37)} │ ${String(r.falseStops).padStart(8)} │ ${String(r.correctStops).padStart(6)} │ ${r.falseRate.padStart(7)}% │ ${exp.toFixed(2).padStart(6)}% │ ${exp>=0?'+':''}${exp.toFixed(3)}R`);
}

// Also test grace period variations
console.log('\n  ═══ GRACE PERIOD ANALYSIS (skip day 1 shakeouts) ═══');
console.log('  Formula + Grace              │FalseStops│CorStops│FalseRate│AvgPnl');
console.log('  ─────────────────────────────┼──────────┼────────┼─────────┼──────');
const graceFns = [
  { name: '0.75ATR[2%,3.5%]', fn: s => -Math.max(2.0, Math.min(3.5, 0.75*s.atr/s.entry*100)) },
  { name: '1.0ATR[2.5%,4.5%]', fn: s => -Math.max(2.5, Math.min(4.5, 1.0*s.atr/s.entry*100)) },
  { name: '0.85ATR[2.5%,4%]', fn: s => -Math.max(2.5, Math.min(4.0, 0.85*s.atr/s.entry*100)) },
];
for(const gf of graceFns){
  for(const grace of [0,1,2]){
    const r = testStopGrace(ALL, gf.fn, grace);
    console.log(`  ${(gf.name+' grace='+grace+'d').padEnd(29)} │ ${String(r.falseStops).padStart(8)} │ ${String(r.correctStops).padStart(6)} │ ${r.falseRate.padStart(7)}% │ ${r.avgPnl.toFixed(2).padStart(5)}%`);
  }
}

// ═══ PART 4: False stop deep dive ═══
console.log('\n' + '═'.repeat(80));
console.log('  PART 4: FALSE STOP DEEP DIVE — Which winners get shaken out?');
console.log('═'.repeat(80));
const currentStop = testStop(ALL, s => -Math.max(2.0, Math.min(3.5, 0.75*s.atr/s.entry*100)));
if(currentStop.falseList.length > 0){
  console.log('\n  Winners stopped by current formula (0.75ATR [2%,3.5%]):');
  console.log('  Symbol       │ Date       │ MFE10  │ MAE10  │ StopPct │StopDay│ ATR%   │ Zone% │ What happened');
  for(const f of currentStop.falseList){
    const recovery = f.mfe10 > 5 ? 'Recovered to +'+f.mfe10.toFixed(1)+'%' : 'Would have hit +'+f.mfe10.toFixed(1)+'%';
    console.log(`  ${f.sym.padEnd(12)} │ ${(f.date||'—').padEnd(10)} │ ${f.mfe10.toFixed(1).padStart(5)}% │ ${f.mae10.toFixed(1).padStart(5)}% │ ${f.stopPct.toFixed(1).padStart(6)}% │ ${String(f.stoppedDay).padStart(5)} │ ${(f.atr/f.entry*100).toFixed(1).padStart(5)}% │ ${((f.entry-f.zoneLow)/f.entry*100).toFixed(1).padStart(4)}% │ ${recovery}`);
  }
}

// ═══ PART 5: Optimal stop recommendation ═══
console.log('\n' + '═'.repeat(80));
console.log('  PART 5: OPTIMAL STOP — Best formula by composite score');
console.log('═'.repeat(80));

// Score = minimize false stops + maximize expectancy
const scored = formulaResults.map(f => ({
  ...f,
  score: f.exp * 100 - f.falseStops * 20 // heavy penalty for false stops
})).sort((a,b) => b.score - a.score);

console.log('\n  Rank │ Stop Formula                         │FalseStops│ Rate  │ AvgPnl │ Score');
console.log('  ─────┼──────────────────────────────────────┼──────────┼───────┼────────┼──────');
for(let i=0;i<Math.min(10,scored.length);i++){
  const f=scored[i];
  console.log(`  ${String(i+1).padStart(4)} │ ${f.name.padEnd(36)} │ ${String(f.falseStops).padStart(8)} │ ${f.falseRate.padStart(5)}% │ ${f.exp.toFixed(2).padStart(6)}% │ ${f.score.toFixed(0).padStart(5)}`);
}

// Zero false stops analysis
console.log('\n  ═══ ZERO FALSE STOP FORMULAS (no winners shaken out) ═══');
const zeroFalse = formulaResults.filter(f=>f.falseStops===0).sort((a,b)=>b.exp-a.exp);
for(const f of zeroFalse.slice(0,8)){
  console.log(`  ${f.name.padEnd(37)} │ ${f.correctStops} correct stops │ AvgPnl ${f.exp.toFixed(2)}%`);
}
