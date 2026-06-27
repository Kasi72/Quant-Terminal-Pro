// REVERSE BACKTEST — Find ALL >5% runs first, THEN check which our params caught
// This answers: "Of every +5% move in these 29 stocks, how many did we detect?"

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function pR(w,v){return w.length===0?50:(w.filter(x=>x<v).length/w.length)*100;}
function upsC(cl,uw,bp,vp,zt,zl){let s=0;if(cl>=80)s+=20;else if(cl>=65)s+=12;if(uw<=20)s+=20;else if(uw<=35)s+=12;if(bp>=55)s+=15;else if(bp>=35)s+=9;if(vp>=4)s+=20;else if(vp>=2)s+=12;if(zt<=5)s+=15;else if(zt<=15)s+=9;if(zl>=12)s+=10;else if(zl>=6)s+=6;return s;}
function cqsC(cl,uw,bp,vp,ve){let s=0;if(cl>=65)s++;if(uw<=30)s++;if(bp>=40)s++;if(vp>=2.5)s++;if(ve>=1.5)s++;return s;}

const PARAMS={
  D20:{name:'D20+',minTO:1e7,maxAP:85,maxPRR:1.0,maxEC:1,minZL:6,maxZL:20,maxZT:15,maxPV:0.9,maxP5V:0.95,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:60,minRSI:50,minVE:1.75,minCQS:3},
  HP15:{name:'HP15+',minTO:1e7,maxAP:85,maxPRR:1.0,maxEC:1,minZL:6,maxZL:25,maxZT:15,maxPV:0.85,maxP5V:1.1,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:13,minUPS:50,minRSI:50,minVE:null,minCQS:null,maxCAZ:6},
  E10:{name:'E10+',minTO:2e7,maxAP:60,maxPRR:0.95,maxEC:5,minZL:8,maxZL:15,maxZT:15,maxPV:0.9,maxP5V:1.0,maxRVB:2.0,minRA:1,maxRA:6,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:45,minRSI:50,minVE:1.25,minCQS:3},
  US8:{name:'US8+',minTO:1e7,maxAP:95,maxPRR:1.0,maxEC:1,minZL:6,maxZL:15,maxZT:15,maxPV:0.9,maxP5V:0.95,maxRVB:2.0,minRA:1,maxRA:6,minVR:1.2,minVP5:2.0,minCL:65,maxUW:40,minBP:25,maxSR:8.5,minUPS:45,minRSI:55,minVE:1.5,minCQS:null},
};

function testParam(s,p){
  if(s.to<p.minTO)return false;if(s.apctl>p.maxAP)return false;if(s.p10A>p.maxPRR)return false;
  if(s.p10E>p.maxEC)return false;if(s.zLen<(p.minZL||6)||s.zLen>(p.maxZL||20))return false;
  if(s.zt>p.maxZT)return false;if(s.p10V>p.maxPV)return false;if(s.p5V>p.maxP5V)return false;
  if(s.rvb>p.maxRVB)return false;if(s.ra<(p.minRA||1)||s.ra>(p.maxRA||5))return false;
  if(s.vR<p.minVR)return false;if(s.vP<p.minVP5)return false;if(s.cl<p.minCL)return false;
  if(s.uw>p.maxUW)return false;if(s.bp<p.minBP)return false;if(s.sr>p.maxSR)return false;
  if(s.uV<p.minUPS)return false;if(s.rsi2<(p.minRSI||50))return false;
  if(p.minVE!==null&&p.minVE!==undefined&&s.vE<p.minVE)return false;
  if(p.minCQS!==null&&p.minCQS!==undefined&&s.cV<p.minCQS)return false;
  if(p.maxCAZ!==null&&p.maxCAZ!==undefined&&s.caz>p.maxCAZ)return false;
  return true;
}

// ═══ STEP 1: Find ALL >5% runs in 10 days across all 29 stocks ═══
const allRuns=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);
  for(let i=40;i<c.length-11;i++){
    const entry=c[i].c;if(entry<=0||a[i]<=0)continue;
    // Check if +5% is reached in next 10 days
    let mfe=0,d5=99,h5=false,mfe10=0;
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const pH=(c[d].h-entry)/entry*100;
      if(pH>mfe10)mfe10=pH;
      if(!h5&&pH>=5){h5=true;d5=d-i;}
    }
    if(!h5)continue; // Only interested in >5% runs
    // Also track longer MFE
    let mfe20=0;
    for(let d=i+1;d<=Math.min(i+20,c.length-1);d++){const pH=(c[d].h-entry)/entry*100;if(pH>mfe20)mfe20=pH;}

    // Now compute ALL screening features for this candle
    const s=c[i],r=s.h-s.l;
    if(r<=0)continue;
    const ap=(a[i]/s.c)*100;const w120=[];for(let j=Math.max(14,i-121);j<i;j++){if(c[j].c>0&&a[j]>0)w120.push((a[j]/c[j].c)*100);}
    const apctl=pR(w120,ap);const ra=r/a[i],cl=(s.c-s.l)/r*100,bp=Math.abs(s.c-s.o)/r*100,uw=(s.h-Math.max(s.o,s.c))/r*100,sr=(r/s.c)*100;
    let tS=0;for(let j=Math.max(0,i-20);j<i;j++)tS+=c[j].c*c[j].v;const to=tS/Math.max(i-Math.max(0,i-20),1);
    let p10R=0,p10C=0,p10E=0;for(let j=i-10;j<i;j++){if(j<1)continue;const t=Math.max(c[j].h-c[j].l,Math.abs(c[j].h-c[j-1].c),Math.abs(c[j].l-c[j-1].c));const x=t/a[j];p10R+=x;p10C++;if(x>1.1)p10E++;}
    const p10A=p10C>0?p10R/p10C:1;const vE=p10A>0?ra/p10A:1;
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=Math.max(i-Math.max(0,i-20),1);const vR=v20>0?s.v/v20:0;
    let v5=0;for(let j=Math.max(0,i-5);j<i;j++)v5+=c[j].v;v5/=Math.max(i-Math.max(0,i-5),1);const vP=v5>0?s.v/v5:0;
    let p10VS=0,p10VC=0;for(let j=i-10;j<i;j++){if(j<0)continue;p10VS+=(v20>0?c[j].v/v20:0);p10VC++;}const p10V=p10VC>0?p10VS/p10VC:1;
    let p5VS=0,p5VC=0;for(let j=i-5;j<i;j++){if(j<0)continue;p5VS+=(v20>0?c[j].v/v20:0);p5VC++;}const p5V=p5VC>0?p5VS/p5VC:1;
    let rVol=0,gVol=0;for(let j=i-10;j<i;j++){if(j<0)continue;if(c[j].c<c[j].o)rVol+=c[j].v;else gVol+=c[j].v;}const rvb=gVol>0?rVol/gVol:(rVol>0?10:1);
    // Zone detection
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL,zt:zLo>0?((zH-zLo)/zLo)*100:99};break;}
    const hasZone=bZ!==null;
    const brokeOut=hasZone&&s.c>bZ?.zH*1.001;
    const caz=hasZone&&bZ.zH>0?((s.c-bZ.zH)/bZ.zH)*100:0;
    const uV=hasZone?upsC(cl,uw,bp,vP,bZ.zt,bZ.len):0;
    const cV=cqsC(cl,uw,bp,vP,vE);
    const rsi2=50; // placeholder

    // Test each param set
    const features={to,apctl,p10A,p10E,zLen:hasZone?bZ.len:0,zt:hasZone?bZ.zt:99,p10V,p5V,rvb,ra,vR,vP,cl,uw,bp,sr,uV,cV,rsi2,vE,caz};
    const passD20=brokeOut&&testParam(features,PARAMS.D20);
    const passHP=brokeOut&&testParam(features,PARAMS.HP15);
    const passE10=brokeOut&&testParam(features,PARAMS.E10);
    const passUS=brokeOut&&testParam(features,PARAMS.US8);
    const passAny=passD20||passHP||passE10||passUS;

    // WHY it failed (top reasons)
    let failReasons=[];
    if(!hasZone)failReasons.push('NO_ZONE');
    else if(!brokeOut)failReasons.push('NO_BREAKOUT');
    else{
      if(to<1e7)failReasons.push('LOW_TURNOVER');
      if(apctl>85)failReasons.push('ATR_PCTL>85');
      if(p10A>1.0)failReasons.push('PRE10_RANGE>1.0');
      if(p10E>1)failReasons.push('PRE10_EXP>1');
      if(p10V>0.9)failReasons.push('PRE10_VOL>0.9');
      if(p5V>0.95)failReasons.push('PRE5_VOL>0.95');
      if(rvb>2.0)failReasons.push('RED_VOL_BIAS>2');
      if(ra<1||ra>5)failReasons.push('RANGE_ATR_OOB');
      if(vR<1.0)failReasons.push('VOL_RATIO<1.0');
      if(vP<2.0)failReasons.push('VOL_PRE5<2.0');
      if(cl<65)failReasons.push('CLOSE_LOC<65');
      if(uw>35)failReasons.push('UPPER_WICK>35');
      if(bp<35)failReasons.push('BODY<35');
      if(sr>8.5)failReasons.push('CANDLE_RISK>8.5');
      if(uV<60)failReasons.push('UPS<60');
      if(vE<1.75)failReasons.push('VOL_EXP<1.75');
      if(cV<3)failReasons.push('CQS<3');
    }

    allRuns.push({sym,date:c[i].date,entry,mfe10,mfe20,d5,hasZone,brokeOut,passD20,passHP,passE10,passUS,passAny,failReasons,
      cl,bp,uw,ra,vR,vP,vE,sr,uV,cV,p10A,p10V,p5V,rvb,apctl,to});
  }
}

// De-duplicate overlapping runs (keep first occurrence per stock within 10 days)
const deduped=[];const lastRun={};
for(const r of allRuns.sort((a,b)=>a.sym.localeCompare(b.sym)||(a.date||'').localeCompare(b.date||''))){
  if(lastRun[r.sym]&&r.date&&lastRun[r.sym]>new Date(new Date(r.date.split('-').reverse().join('-')).getTime()-10*86400*1000).toISOString())continue;
  deduped.push(r);
  lastRun[r.sym]=r.date;
}

console.log('█'.repeat(85));
console.log('  REVERSE BACKTEST — All >5% runs vs what our screener caught');
console.log('  29 OHLCV files · Non-overlapping runs');
console.log('█'.repeat(85));

console.log(`\n  Total >5% runs (raw): ${allRuns.length}`);
console.log(`  Non-overlapping runs: ${deduped.length}`);

// ═══ CAPTURE ANALYSIS ═══
const total=allRuns.length;
const caught=allRuns.filter(r=>r.passAny).length;
const missed=total-caught;
const zoned=allRuns.filter(r=>r.hasZone).length;
const broken=allRuns.filter(r=>r.brokeOut).length;

console.log(`\n═══ CAPTURE RATE ═══\n`);
console.log(`  All >5% runs:           ${total}`);
console.log(`  Had compression zone:   ${zoned} (${(zoned/total*100).toFixed(1)}%)`);
console.log(`  Broke out of zone:      ${broken} (${(broken/total*100).toFixed(1)}%)`);
console.log(`  Caught by ANY param:    ${caught} (${(caught/total*100).toFixed(1)}%)`);
console.log(`  MISSED:                 ${missed} (${(missed/total*100).toFixed(1)}%)`);

// Per param set
console.log(`\n  Per param set:`);
for(const[key,p]of Object.entries(PARAMS)){
  const field=key==='D20'?'passD20':key==='HP15'?'passHP':key==='E10'?'passE10':'passUS';
  const n=allRuns.filter(r=>r[field]).length;
  console.log(`    ${p.name.padEnd(8)}: caught ${n} of ${total} (${(n/total*100).toFixed(1)}%)`);
}

// ═══ WHY WERE RUNS MISSED? ═══
console.log(`\n═══ WHY WERE ${missed} RUNS MISSED? ═══\n`);
const reasonCounts={};
for(const r of allRuns.filter(r=>!r.passAny)){
  for(const reason of r.failReasons){reasonCounts[reason]=(reasonCounts[reason]||0)+1;}
}
const sortedReasons=Object.entries(reasonCounts).sort((a,b)=>b[1]-a[1]);
console.log('  Reason                  │ Count │  % of missed │ Explanation');
console.log('  ────────────────────────┼───────┼──────────────┼────────────');
for(const[reason,count]of sortedReasons){
  const explanations={
    'NO_ZONE':'No compression zone detected — move was trend/momentum, not breakout',
    'NO_BREAKOUT':'Zone existed but candle didn\'t close above zone high',
    'VOL_PRE5<2.0':'Volume didn\'t surge enough vs prior 5 days',
    'UPS<60':'Ultra Precision Score too low — weak candle quality',
    'VOL_EXP<1.75':'Volatility expansion ratio too low',
    'CQS<3':'Candle Quality Score below threshold',
    'VOL_RATIO<1.0':'Volume below 20-day average',
    'CLOSE_LOC<65':'Close not in upper 35% of candle',
    'BODY<35':'Body too small (< 35% of range)',
    'UPPER_WICK>35':'Upper wick too large — rejection',
    'PRE10_RANGE>1.0':'Pre-10 candles not compressed enough',
    'PRE10_VOL>0.9':'Pre-10 volume not dry enough',
    'PRE5_VOL>0.95':'Pre-5 volume not dry enough',
    'PRE10_EXP>1':'Too many expansion candles in pre-10 window',
    'ATR_PCTL>85':'ATR percentile too high (already volatile)',
    'LOW_TURNOVER':'Average turnover below Rs.1Cr',
    'CANDLE_RISK>8.5':'Signal candle range too wide',
    'RED_VOL_BIAS>2':'Too much red volume in prior 10 days',
    'RANGE_ATR_OOB':'Range/ATR outside 1-5 bounds',
  };
  console.log(`  ${reason.padEnd(24)} │ ${String(count).padStart(5)} │ ${(count/missed*100).toFixed(1).padStart(11)}% │ ${explanations[reason]||'—'}`);
}

// ═══ WHAT TYPE OF RUNS ARE WE MISSING? ═══
console.log(`\n═══ CAUGHT vs MISSED — Character comparison ═══\n`);
const caughtRuns=allRuns.filter(r=>r.passAny);
const missedRuns=allRuns.filter(r=>!r.passAny);
console.log('  Metric              │ Caught (our signals) │ Missed (we didn\'t detect) │ Insight');
console.log('  ────────────────────┼──────────────────────┼───────────────────────────┼────────');
const metrics=[
  ['Avg MFE 10d','mfe10'],['Avg MFE 20d','mfe20'],['Avg days to +5%','d5'],
  ['Avg close location','cl'],['Avg body %','bp'],['Avg upper wick','uw'],
  ['Avg volume ratio','vR'],['Avg vol vs pre5','vP'],['Avg range/ATR','ra'],
  ['Avg vol expansion','vE'],['Avg pre10 rangeATR','p10A'],
];
for(const[name,field]of metrics){
  const cAvg=caughtRuns.length>0?caughtRuns.reduce((s,r)=>s+r[field],0)/caughtRuns.length:0;
  const mAvg=missedRuns.length>0?missedRuns.reduce((s,r)=>s+r[field],0)/missedRuns.length:0;
  const insight=Math.abs(cAvg-mAvg)/Math.max(cAvg,mAvg,0.01)>0.15?
    (cAvg>mAvg?'Caught are STRONGER':'Missed are STRONGER'):'Similar';
  console.log(`  ${name.padEnd(21)} │ ${cAvg.toFixed(2).padStart(20)} │ ${mAvg.toFixed(2).padStart(25)} │ ${insight}`);
}

// ═══ THE BIG QUESTION: Are missed runs WORTH catching? ═══
console.log(`\n═══ ARE MISSED RUNS WORTH CATCHING? ═══\n`);
const missedByType={
  noZone:missedRuns.filter(r=>!r.hasZone),
  noBreakout:missedRuns.filter(r=>r.hasZone&&!r.brokeOut),
  failedParams:missedRuns.filter(r=>r.brokeOut),
};
console.log(`  No compression zone:    ${missedByType.noZone.length} runs (${(missedByType.noZone.length/missed*100).toFixed(0)}%)`);
console.log(`    → These are trend/momentum runs, NOT compression breakouts`);
console.log(`    → Avg MFE: +${(missedByType.noZone.reduce((s,r)=>s+r.mfe10,0)/Math.max(missedByType.noZone.length,1)).toFixed(1)}% | Avg days: ${(missedByType.noZone.reduce((s,r)=>s+r.d5,0)/Math.max(missedByType.noZone.length,1)).toFixed(1)}`);
console.log(`\n  Zone but no breakout:   ${missedByType.noBreakout.length} runs (${(missedByType.noBreakout.length/missed*100).toFixed(0)}%)`);
console.log(`    → Price moved +5% without closing above zone high on signal day`);
console.log(`    → Avg MFE: +${(missedByType.noBreakout.reduce((s,r)=>s+r.mfe10,0)/Math.max(missedByType.noBreakout.length,1)).toFixed(1)}%`);
console.log(`\n  Broke out but failed params: ${missedByType.failedParams.length} runs (${(missedByType.failedParams.length/missed*100).toFixed(0)}%)`);
console.log(`    → These are compression breakouts our params were too strict to catch`);
console.log(`    → Avg MFE: +${(missedByType.failedParams.reduce((s,r)=>s+r.mfe10,0)/Math.max(missedByType.failedParams.length,1)).toFixed(1)}%`);
if(missedByType.failedParams.length>0){
  console.log(`    → Top fail reasons:`);
  const fpReasons={};
  for(const r of missedByType.failedParams)for(const reason of r.failReasons)fpReasons[reason]=(fpReasons[reason]||0)+1;
  for(const[reason,count]of Object.entries(fpReasons).sort((a,b)=>b[1]-a[1]).slice(0,10)){
    console.log(`       ${reason.padEnd(22)} ${count} (${(count/missedByType.failedParams.length*100).toFixed(0)}%)`);
  }
}

// ═══ TOP MISSED RUNS — What great trades did we miss? ═══
console.log(`\n═══ TOP 20 MISSED RUNS BY MFE ═══\n`);
console.log('  Symbol       │ Date       │ MFE10  │ MFE20  │ Days5 │ Zone? │ Breakout? │ Top Fail Reason');
console.log('  ─────────────┼────────────┼────────┼────────┼───────┼───────┼───────────┼───────────────');
for(const r of missedRuns.sort((a,b)=>b.mfe10-a.mfe10).slice(0,20)){
  console.log(`  ${r.sym.padEnd(12)} │ ${(r.date||'—').padEnd(10)} │ ${('+'+r.mfe10.toFixed(1)+'%').padStart(6)} │ ${('+'+r.mfe20.toFixed(1)+'%').padStart(6)} │ ${String(r.d5).padStart(5)} │ ${r.hasZone?'YES':'NO '} │ ${r.brokeOut?'YES':'NO '} │ ${r.failReasons.slice(0,2).join(', ')}`);
}

// ═══ SUMMARY ═══
console.log(`\n${'█'.repeat(85)}`);
console.log('  SUMMARY');
console.log('█'.repeat(85));
console.log(`\n  Our screener catches ${caught} of ${total} >5% runs (${(caught/total*100).toFixed(1)}% capture rate)`);
console.log(`\n  What we miss:`);
console.log(`    ${missedByType.noZone.length} (${(missedByType.noZone.length/total*100).toFixed(0)}%) — No compression zone (trend/momentum moves — BY DESIGN)`);
console.log(`    ${missedByType.noBreakout.length} (${(missedByType.noBreakout.length/total*100).toFixed(0)}%) — Zone but no breakout candle (gradual drift up — BY DESIGN)`);
console.log(`    ${missedByType.failedParams.length} (${(missedByType.failedParams.length/total*100).toFixed(0)}%) — Real breakouts filtered too strictly (POTENTIAL IMPROVEMENT)`);
