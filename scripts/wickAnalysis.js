// DEEP WICK ANALYSIS — Upper & Lower wick patterns on 29 OHLCV files
// Goal: Find wick characteristics that predict breakout success/failure

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);
  for(let i=40;i<c.length-11;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const entry=s.c,range=r,body=Math.abs(s.c-s.o);
    const isGreen=s.c>s.o;
    const upperWick=s.h-Math.max(s.o,s.c);
    const lowerWick=Math.min(s.o,s.c)-s.l;
    const uwPct=upperWick/range*100;
    const lwPct=lowerWick/range*100;
    const bodyPct=body/range*100;
    const closeLoc=(s.c-s.l)/range*100;
    // Wick ratios
    const uwToBody=body>0?upperWick/body:99;
    const lwToBody=body>0?lowerWick/body:99;
    const wickRatio=lowerWick>0?upperWick/lowerWick:upperWick>0?99:1;
    // Wick ATR-normalized
    const uwATR=a[i]>0?upperWick/a[i]:0;
    const lwATR=a[i]>0?lowerWick/a[i]:0;
    // Wick vs zone
    const uwAboveZone=s.h-bZ.zH;const uwAboveZonePct=bZ.zH>0?(uwAboveZone/bZ.zH)*100:0;
    // Close vs high distance
    const closeToHigh=(s.h-s.c)/s.c*100;
    // Volume
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=Math.max(i-Math.max(0,i-20),1);
    const volR=v20>0?s.v/v20:1;
    // Pre-candle wicks (day -1)
    const prev=c[i-1];const pRange=prev.h-prev.l;
    const pUwPct=pRange>0?(prev.h-Math.max(prev.o,prev.c))/pRange*100:0;
    const pLwPct=pRange>0?(Math.min(prev.o,prev.c)-prev.l)/pRange*100:0;
    // Future
    let mfe=0,mae=0,h5=false,d5=99;
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const pH=(c[d].h-entry)/entry*100,pL=(c[d].l-entry)/entry*100;
      if(pH>mfe)mfe=pH;if(pL<mae)mae=pL;if(!h5&&pH>=5){h5=true;d5=d-i;}
    }
    ALL.push({sym,date:s.date,entry,uwPct,lwPct,bodyPct,closeLoc,isGreen,
      uwToBody,lwToBody,wickRatio,uwATR,lwATR,uwAboveZonePct,closeToHigh,volR,
      pUwPct,pLwPct,mfe,mae,h5,d5,range,upperWick,lowerWick});
  }
}
const W=ALL.filter(s=>s.h5),L=ALL.filter(s=>!s.h5);
console.log(`Total: ${ALL.length} | Winners: ${W.length} (${(W.length/ALL.length*100).toFixed(1)}%) | Losers: ${L.length}\n`);

// Helper
function bucket(arr,thresholds,field){
  const res=[];
  for(let i=0;i<thresholds.length;i++){
    const lo=i===0?-Infinity:thresholds[i-1];const hi=thresholds[i];
    const group=arr.filter(s=>s[field]>lo&&s[field]<=hi);
    const wins=group.filter(s=>s.h5).length;
    const rate=group.length>0?(wins/group.length*100).toFixed(1):'—';
    const mfe=group.length>0?(group.reduce((s,t)=>s+t.mfe,0)/group.length).toFixed(1):'—';
    const mae=group.length>0?(group.reduce((s,t)=>s+t.mae,0)/group.length).toFixed(1):'—';
    res.push({range:`${lo===- Infinity?'<':'>'+lo.toFixed(0)+' to '}${hi.toFixed(0)}%`,count:group.length,wins,rate,mfe,mae});
  }
  return res;
}

console.log('█'.repeat(85));
console.log('  DEEP WICK ANALYSIS — 29 OHLCV · '+ALL.length+' breakout signals');
console.log('█'.repeat(85));

// ═══ PART 1: Upper Wick vs Hit Rate ═══
console.log('\n═══ PART 1: UPPER WICK % — How much resistance rejection kills breakouts? ═══\n');
console.log('  UW Range    │ Signals │ Winners │ HitRate │ Avg MFE │ Avg MAE │ Finding');
console.log('  ────────────┼─────────┼─────────┼─────────┼─────────┼─────────┼────────');
for(const uw of [5,10,15,20,25,30,35,40,50,100]){
  const lo=uw===5?0:uw-5<=5?0:uw-5;
  const grp=ALL.filter(s=>s.uwPct>=(uw===5?0:uw-5)&&s.uwPct<uw);if(grp.length<3)continue;
  const wins=grp.filter(s=>s.h5).length;const rate=(wins/grp.length*100).toFixed(1);
  const mfe=(grp.reduce((s,t)=>s+t.mfe,0)/grp.length).toFixed(1);
  const mae=(grp.reduce((s,t)=>s+t.mae,0)/grp.length).toFixed(1);
  const finding=wins/grp.length>=0.55?'BULLISH':wins/grp.length>=0.45?'NEUTRAL':'BEARISH';
  console.log(`  ${(lo+'–'+uw+'%').padEnd(12)} │ ${String(grp.length).padStart(7)} │ ${String(wins).padStart(7)} │ ${rate.padStart(6)}% │ ${('+'+mfe+'%').padStart(7)} │ ${(mae+'%').padStart(7)} │ ${finding}`);
}

// ═══ PART 2: Lower Wick vs Hit Rate ═══
console.log('\n═══ PART 2: LOWER WICK % — Does buying support (lower wick) predict success? ═══\n');
console.log('  LW Range    │ Signals │ Winners │ HitRate │ Avg MFE │ Avg MAE │ Finding');
console.log('  ────────────┼─────────┼─────────┼─────────┼─────────┼─────────┼────────');
for(const lw of [5,10,15,20,25,30,35,40,50,100]){
  const lo=lw===5?0:lw-5<=5?0:lw-5;
  const grp=ALL.filter(s=>s.lwPct>=(lw===5?0:lw-5)&&s.lwPct<lw);if(grp.length<3)continue;
  const wins=grp.filter(s=>s.h5).length;const rate=(wins/grp.length*100).toFixed(1);
  const mfe=(grp.reduce((s,t)=>s+t.mfe,0)/grp.length).toFixed(1);
  const mae=(grp.reduce((s,t)=>s+t.mae,0)/grp.length).toFixed(1);
  const finding=wins/grp.length>=0.55?'BULLISH':wins/grp.length>=0.45?'NEUTRAL':'BEARISH';
  console.log(`  ${(lo+'–'+lw+'%').padEnd(12)} │ ${String(grp.length).padStart(7)} │ ${String(wins).padStart(7)} │ ${rate.padStart(6)}% │ ${('+'+mfe+'%').padStart(7)} │ ${(mae+'%').padStart(7)} │ ${finding}`);
}

// ═══ PART 3: Upper Wick to Body Ratio ═══
console.log('\n═══ PART 3: UPPER WICK / BODY RATIO — Rejection relative to conviction ═══\n');
console.log('  UW/Body     │ Signals │ Winners │ HitRate │ Avg MFE │ Finding');
console.log('  ────────────┼─────────┼─────────┼─────────┼────────');
for(const[lo,hi,label]of[[0,0.1,'<0.1 (tiny)'],[0.1,0.25,'0.1–0.25'],[0.25,0.5,'0.25–0.5'],[0.5,1.0,'0.5–1.0'],[1.0,2.0,'1.0–2.0 (wick>body)'],[2.0,99,'2.0+ (wick dominates)']]) {
  const grp=ALL.filter(s=>s.uwToBody>=lo&&s.uwToBody<hi);if(grp.length<3)continue;
  const wins=grp.filter(s=>s.h5).length;
  console.log(`  ${label.padEnd(12)} │ ${String(grp.length).padStart(7)} │ ${String(wins).padStart(7)} │ ${(wins/grp.length*100).toFixed(1).padStart(6)}% │ ${('+'+((grp.reduce((s,t)=>s+t.mfe,0)/grp.length).toFixed(1))+'%').padStart(7)} │ ${wins/grp.length>=0.5?'GOOD':'WEAK'}`);
}

// ═══ PART 4: Lower Wick to Body Ratio ═══
console.log('\n═══ PART 4: LOWER WICK / BODY RATIO — Support buying relative to body ═══\n');
console.log('  LW/Body     │ Signals │ Winners │ HitRate │ Avg MFE │ Finding');
console.log('  ────────────┼─────────┼─────────┼─────────┼────────');
for(const[lo,hi,label]of[[0,0.1,'<0.1 (no wick)'],[0.1,0.25,'0.1–0.25'],[0.25,0.5,'0.25–0.5'],[0.5,1.0,'0.5–1.0'],[1.0,2.0,'1.0–2.0'],[2.0,99,'2.0+ (hammer)']]) {
  const grp=ALL.filter(s=>s.lwToBody>=lo&&s.lwToBody<hi);if(grp.length<3)continue;
  const wins=grp.filter(s=>s.h5).length;
  console.log(`  ${label.padEnd(12)} │ ${String(grp.length).padStart(7)} │ ${String(wins).padStart(7)} │ ${(wins/grp.length*100).toFixed(1).padStart(6)}% │ ${('+'+((grp.reduce((s,t)=>s+t.mfe,0)/grp.length).toFixed(1))+'%').padStart(7)} │ ${wins/grp.length>=0.5?'GOOD':'WEAK'}`);
}

// ═══ PART 5: Wick Ratio (UW/LW) — Directional bias ═══
console.log('\n═══ PART 5: WICK RATIO (UW÷LW) — Upper vs Lower dominance ═══\n');
console.log('  Ratio       │ Signals │ Winners │ HitRate │ Avg MFE │ Meaning');
console.log('  ────────────┼─────────┼─────────┼─────────┼─────────┼────────');
for(const[lo,hi,label,meaning]of[[0,0.3,'<0.3','UW tiny vs LW — strong buyer support'],[0.3,0.7,'0.3–0.7','Balanced wicks'],[0.7,1.5,'0.7–1.5','Equal wicks — indecision'],[1.5,3.0,'1.5–3.0','UW dominates — sellers resisting'],[3.0,999,'3.0+','Heavy UW — strong rejection']]) {
  const grp=ALL.filter(s=>s.wickRatio>=lo&&s.wickRatio<hi);if(grp.length<3)continue;
  const wins=grp.filter(s=>s.h5).length;
  console.log(`  ${label.padEnd(12)} │ ${String(grp.length).padStart(7)} │ ${String(wins).padStart(7)} │ ${(wins/grp.length*100).toFixed(1).padStart(6)}% │ ${('+'+((grp.reduce((s,t)=>s+t.mfe,0)/grp.length).toFixed(1))+'%').padStart(7)} │ ${meaning}`);
}

// ═══ PART 6: Close-to-High distance — How close to the high did it close? ═══
console.log('\n═══ PART 6: CLOSE-TO-HIGH DISTANCE — Did it close at the very top? ═══\n');
console.log('  Distance    │ Signals │ Winners │ HitRate │ Avg MFE │ Finding');
console.log('  ────────────┼─────────┼─────────┼─────────┼─────────┼────────');
for(const[lo,hi,label]of[[0,0.5,'<0.5% (at high)'],[0.5,1.0,'0.5–1%'],[1.0,2.0,'1–2%'],[2.0,3.0,'2–3%'],[3.0,5.0,'3–5%'],[5.0,99,'5%+ (far from high)']]) {
  const grp=ALL.filter(s=>s.closeToHigh>=lo&&s.closeToHigh<hi);if(grp.length<3)continue;
  const wins=grp.filter(s=>s.h5).length;
  console.log(`  ${label.padEnd(12)} │ ${String(grp.length).padStart(7)} │ ${String(wins).padStart(7)} │ ${(wins/grp.length*100).toFixed(1).padStart(6)}% │ ${('+'+((grp.reduce((s,t)=>s+t.mfe,0)/grp.length).toFixed(1))+'%').padStart(7)} │ ${wins/grp.length>=0.55?'STRONG':wins/grp.length>=0.45?'OK':'WEAK'}`);
}

// ═══ PART 7: UW in ATR units — normalized rejection ═══
console.log('\n═══ PART 7: UPPER WICK IN ATR UNITS — Normalized rejection strength ═══\n');
console.log('  UW ATR      │ Signals │ Winners │ HitRate │ Avg MFE │ Finding');
console.log('  ────────────┼─────────┼─────────┼─────────┼─────────┼────────');
for(const[lo,hi,label]of[[0,0.05,'<0.05 ATR'],[0.05,0.15,'0.05–0.15'],[0.15,0.3,'0.15–0.3'],[0.3,0.5,'0.3–0.5'],[0.5,1.0,'0.5–1.0'],[1.0,9,'1.0+ ATR']]) {
  const grp=ALL.filter(s=>s.uwATR>=lo&&s.uwATR<hi);if(grp.length<3)continue;
  const wins=grp.filter(s=>s.h5).length;
  console.log(`  ${label.padEnd(12)} │ ${String(grp.length).padStart(7)} │ ${String(wins).padStart(7)} │ ${(wins/grp.length*100).toFixed(1).padStart(6)}% │ ${('+'+((grp.reduce((s,t)=>s+t.mfe,0)/grp.length).toFixed(1))+'%').padStart(7)} │ ${wins/grp.length>=0.5?'GOOD':'WEAK'}`);
}

// ═══ PART 8: Previous candle wick analysis ═══
console.log('\n═══ PART 8: DAY -1 WICK PATTERN — Does prior day wick predict breakout? ═══\n');
console.log('  Prior UW%   │ Signals │ Winners │ HitRate │ Avg MFE');
console.log('  ────────────┼─────────┼─────────┼─────────┼────────');
for(const[lo,hi]of[[0,10],[10,25],[25,40],[40,60],[60,100]]){
  const grp=ALL.filter(s=>s.pUwPct>=lo&&s.pUwPct<hi);if(grp.length<3)continue;
  const wins=grp.filter(s=>s.h5).length;
  console.log(`  ${(lo+'–'+hi+'%').padEnd(12)} │ ${String(grp.length).padStart(7)} │ ${String(wins).padStart(7)} │ ${(wins/grp.length*100).toFixed(1).padStart(6)}% │ ${('+'+((grp.reduce((s,t)=>s+t.mfe,0)/grp.length).toFixed(1))+'%').padStart(6)}`);
}
console.log('\n  Prior LW%   │ Signals │ Winners │ HitRate │ Avg MFE');
console.log('  ────────────┼─────────┼─────────┼─────────┼────────');
for(const[lo,hi]of[[0,10],[10,25],[25,40],[40,60],[60,100]]){
  const grp=ALL.filter(s=>s.pLwPct>=lo&&s.pLwPct<hi);if(grp.length<3)continue;
  const wins=grp.filter(s=>s.h5).length;
  console.log(`  ${(lo+'–'+hi+'%').padEnd(12)} │ ${String(grp.length).padStart(7)} │ ${String(wins).padStart(7)} │ ${(wins/grp.length*100).toFixed(1).padStart(6)}% │ ${('+'+((grp.reduce((s,t)=>s+t.mfe,0)/grp.length).toFixed(1))+'%').padStart(6)}`);
}

// ═══ PART 9: Combined wick rules — what combination gives best hit rate? ═══
console.log('\n═══ PART 9: COMBINED WICK RULES — Optimal thresholds for screening ═══\n');
const rules=[
  {name:'UW≤15% + LW≤15% (clean body)',fn:s=>s.uwPct<=15&&s.lwPct<=15},
  {name:'UW≤20% + closeLoc≥75%',fn:s=>s.uwPct<=20&&s.closeLoc>=75},
  {name:'UW≤10% (minimal rejection)',fn:s=>s.uwPct<=10},
  {name:'UW≤25% + body≥50%',fn:s=>s.uwPct<=25&&s.bodyPct>=50},
  {name:'UW/Body<0.25 (wick tiny vs body)',fn:s=>s.uwToBody<0.25},
  {name:'LW≥20% + UW≤15% (buyer support)',fn:s=>s.lwPct>=20&&s.uwPct<=15},
  {name:'CloseToHigh<1% (at the top)',fn:s=>s.closeToHigh<1},
  {name:'CloseToHigh<0.5%',fn:s=>s.closeToHigh<0.5},
  {name:'UW ATR<0.15 (norm. tiny wick)',fn:s=>s.uwATR<0.15},
  {name:'WickRatio<0.5 (LW dominates)',fn:s=>s.wickRatio<0.5},
  {name:'Green + UW≤20% + Body≥45%',fn:s=>s.isGreen&&s.uwPct<=20&&s.bodyPct>=45},
  {name:'Green + UW≤15% + Vol≥1.5x',fn:s=>s.isGreen&&s.uwPct<=15&&s.volR>=1.5},
  {name:'GOLDEN: UW≤15% + Body≥50% + Vol≥2x',fn:s=>s.uwPct<=15&&s.bodyPct>=50&&s.volR>=2},
  {name:'GOLDEN: CloseToHigh<1% + Body≥45% + Vol≥1.5x',fn:s=>s.closeToHigh<1&&s.bodyPct>=45&&s.volR>=1.5},
  {name:'Current screener: UW≤35%',fn:s=>s.uwPct<=35},
];
console.log('  Rule                                      │ Pass │ Wins │ HitRate │ Avg MFE │ vs Current');
console.log('  ──────────────────────────────────────────┼──────┼──────┼─────────┼─────────┼──────────');
const currentRate=W.length/ALL.length*100;
for(const r of rules){
  const pass=ALL.filter(r.fn);const wins=pass.filter(s=>s.h5).length;
  const rate=pass.length>0?(wins/pass.length*100):0;
  const mfe=pass.length>0?(pass.reduce((s,t)=>s+t.mfe,0)/pass.length):0;
  const delta=rate-currentRate;
  console.log(`  ${r.name.padEnd(42)} │ ${String(pass.length).padStart(4)} │ ${String(wins).padStart(4)} │ ${rate.toFixed(1).padStart(6)}% │ ${('+'+mfe.toFixed(1)+'%').padStart(7)} │ ${(delta>=0?'+':'')+delta.toFixed(1)+'%'}`);
}

// ═══ PART 10: Winners mean vs losers mean ═══
console.log('\n═══ PART 10: WINNER vs LOSER WICK DNA — Statistical comparison ═══\n');
const metrics=[
  ['Upper Wick %','uwPct'],['Lower Wick %','lwPct'],['Body %','bodyPct'],
  ['Close Location','closeLoc'],['UW/Body Ratio','uwToBody'],['LW/Body Ratio','lwToBody'],
  ['Wick Ratio (UW/LW)','wickRatio'],['UW in ATR','uwATR'],['LW in ATR','lwATR'],
  ['Close-to-High %','closeToHigh'],['Vol Expansion','volR'],
  ['Prior Day UW%','pUwPct'],['Prior Day LW%','pLwPct'],
];
console.log('  Metric              │ Winners   │ Losers    │ Delta     │ P-value proxy │ Action');
console.log('  ────────────────────┼───────────┼───────────┼───────────┼───────────────┼────────');
for(const[name,field]of metrics){
  const wV=W.map(s=>s[field]).filter(v=>Number.isFinite(v)&&v<99);
  const lV=L.map(s=>s[field]).filter(v=>Number.isFinite(v)&&v<99);
  const wM=wV.reduce((s,v)=>s+v,0)/wV.length;
  const lM=lV.reduce((s,v)=>s+v,0)/lV.length;
  const d=wM-lM;
  // Cohen's d effect size as proxy for significance
  const pooledStd=Math.sqrt(((wV.reduce((s,v)=>s+(v-wM)**2,0)+lV.reduce((s,v)=>s+(v-lM)**2,0))/(wV.length+lV.length-2)));
  const cohensD=pooledStd>0?Math.abs(d)/pooledStd:0;
  const sig=cohensD>=0.5?'SIGNIFICANT':cohensD>=0.2?'MODERATE':'SMALL';
  const action=cohensD>=0.3?(d>0?'RAISE thresh':'LOWER thresh'):'Keep current';
  console.log(`  ${name.padEnd(20)} │ ${wM.toFixed(2).padStart(9)} │ ${lM.toFixed(2).padStart(9)} │ ${(d>=0?'+':'')+d.toFixed(2).padStart(8)} │ ${('d='+cohensD.toFixed(2)+' '+sig).padStart(13)} │ ${action}`);
}
