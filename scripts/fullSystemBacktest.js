// FULL SYSTEM BACKTEST — v5-WLB Params + Cascading Gates Stop
// Tests the COMPLETE screener as deployed: param filters → entry → stop → targets
// 29 OHLCV files, 10-day horizon

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));

function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function rsi2c(c){const r=new Array(c.length).fill(50);if(c.length<4)return r;let g=0,l=0;for(let i=1;i<=2;i++){const ch=c[i].c-c[i-1].c;if(ch>0)g+=ch;else l+=Math.abs(ch);}g/=2;l/=2;for(let i=3;i<c.length;i++){const ch=c[i].c-c[i-1].c;g=(g+Math.max(ch,0))/2;l=(l+Math.max(-ch,0))/2;r[i]=l<1e-4?100:100-100/(1+g/l);}return r;}
function pR(w,v){return w.length===0?50:(w.filter(x=>x<v).length/w.length)*100;}
function upsC(cl,uw,bp,vp,zt,zl){let s=0;if(cl>=80)s+=20;else if(cl>=65)s+=12;if(uw<=20)s+=20;else if(uw<=35)s+=12;if(bp>=55)s+=15;else if(bp>=35)s+=9;if(vp>=4)s+=20;else if(vp>=2)s+=12;if(zt<=5)s+=15;else if(zt<=15)s+=9;if(zl>=12)s+=10;else if(zl>=6)s+=6;return s;}
function cqsC(cl,uw,bp,vp,ve){let s=0;if(cl>=65)s++;if(uw<=30)s++;if(bp>=40)s++;if(vp>=2.5)s++;if(ve>=1.5)s++;return s;}

// v5-WLB Param Sets (exact from stockEngine.ts)
const PARAMS={
  D20:{name:'D20+ Deployable',minTO:1e7,maxAP:85,maxPRR:1.0,maxEC:1,minZL:6,maxZL:20,maxZT:15,maxPV:0.9,maxP5V:0.95,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:60,minRSI:50,minVE:1.75,minCQS:3},
  HP15:{name:'HP15+ HighPrec',minTO:1e7,maxAP:85,maxPRR:1.0,maxEC:1,minZL:6,maxZL:25,maxZT:15,maxPV:0.85,maxP5V:1.1,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:13,minUPS:50,minRSI:50,minVE:null,minCQS:null,maxCAZ:6},
  E10:{name:'E10+ Elite',minTO:2e7,maxAP:60,maxPRR:0.95,maxEC:5,minZL:8,maxZL:15,maxZT:15,maxPV:0.9,maxP5V:1.0,maxRVB:2.0,minRA:1,maxRA:6,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:45,minRSI:50,minVE:1.25,minCQS:3},
  US8:{name:'US8+ UltraSel',minTO:1e7,maxAP:95,maxPRR:1.0,maxEC:1,minZL:6,maxZL:15,maxZT:15,maxPV:0.9,maxP5V:0.95,maxRVB:2.0,minRA:1,maxRA:6,minVR:1.2,minVP5:2.0,minCL:65,maxUW:40,minBP:25,maxSR:8.5,minUPS:45,minRSI:55,minVE:1.5,minCQS:null},
};

function testParam(s, p) {
  if(s.to<p.minTO)return false;if(s.apctl>p.maxAP)return false;if(s.p10A>p.maxPRR)return false;
  if(s.p10E>p.maxEC)return false;if(s.zLen<p.minZL||s.zLen>p.maxZL)return false;
  if(s.zt>p.maxZT)return false;if(s.p10V>p.maxPV)return false;if(s.p5V>p.maxP5V)return false;
  if(s.rvb>p.maxRVB)return false;if(s.ra<p.minRA||s.ra>p.maxRA)return false;
  if(s.vR<p.minVR)return false;if(s.vP<p.minVP5)return false;if(s.cl<p.minCL)return false;
  if(s.uw>p.maxUW)return false;if(s.bp<p.minBP)return false;if(s.sr>p.maxSR)return false;
  if(s.upsV<p.minUPS)return false;if(s.rsi2<p.minRSI)return false;
  if(p.minVE!==null&&s.vE<p.minVE)return false;if(p.minCQS!==null&&s.cqsV<p.minCQS)return false;
  if(p.maxCAZ!==null&&s.caz>p.maxCAZ)return false;return true;
}

// Collect ALL signals with full features
const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c),r2=rsi2c(c);
  for(let i=40;i<c.length-11;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    const atrPct=(a[i]/s.c)*100;const w=[];for(let j=Math.max(14,i-121);j<i;j++){if(c[j].c>0&&a[j]>0)w.push((a[j]/c[j].c)*100);}
    const apctl=pR(w,atrPct);const ra=r/a[i],cl=(s.c-s.l)/r*100,bp=Math.abs(s.c-s.o)/r*100,uw=(s.h-Math.max(s.o,s.c))/r*100,sr=(r/s.c)*100;
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
    const caz=bZ.zH>0?((s.c-bZ.zH)/bZ.zH)*100:0;
    const upsV=upsC(cl,uw,bp,vP,bZ.zt,bZ.len);const cqsV=cqsC(cl,uw,bp,vP,vE);

    const entry=s.c,atrVal=a[i],zoneLow=bZ.zL;
    // Targets (exact screener formulas)
    const t1Pct=Math.max(3,Math.min(5,2.15*atrVal/entry*100));
    const t2Pct=Math.min(5.65,2.80*atrVal/entry*100);
    const t3Pct=atrPct<1.5?5:atrPct<=3?7:10;
    // Stop (ZoneLow-0.5ATR [3.5%,8%])
    const stopRaw=(entry-(zoneLow-0.5*atrVal))/entry*100;
    const stopPct=Math.max(3.5,Math.min(8,stopRaw));
    const rr=t1Pct/stopPct;

    // Param set membership
    const sig={to,apctl,p10A,p10E,bZ,zLen:bZ.len,zt:bZ.zt,p10V,p5V,rvb,ra,vR,vP,cl,uw,bp,sr,upsV,cqsV,rsi2:r2[i],vE,caz};
    const passD20=testParam(sig,PARAMS.D20);
    const passHP=testParam(sig,PARAMS.HP15);
    const passE10=testParam(sig,PARAMS.E10);
    const passUS=testParam(sig,PARAMS.US8);
    const paramsPassed=[passD20?'D20':'',passHP?'HP15':'',passE10?'E10':'',passUS?'US8':''].filter(Boolean);

    // Future simulation with Cascading Gates
    const future=[];
    for(let d=i+1;d<=Math.min(i+20,c.length-1);d++){
      const fc=c[d],day=d-i,range=fc.h-fc.l;
      const lwPct=range>0?(Math.min(fc.o,fc.c)-fc.l)/range*100:0;
      const closeLoc=range>0?(fc.c-fc.l)/range*100:50;
      future.push({day,o:fc.o,h:fc.h,l:fc.l,c:fc.c,v:fc.v,
        pctH:(fc.h-entry)/entry*100,pctL:(fc.l-entry)/entry*100,pctC:(fc.c-entry)/entry*100,
        isGreen:fc.c>fc.o,closeLoc,lwPct});
    }

    // Simulate Cascading Gates stop + partial exit model
    let outcome='EXPIRED',exitDay=10,exitPct=0,exitPrice=0;
    let t1Hit=false,t2Hit=false,t3Hit=false,stopped=false;
    let mfe=0,mae=0,highestPrice=entry;

    for(const f of future){
      if(f.day>10&&!t1Hit)break; // 10-day horizon for initial
      if(f.day>20)break;
      if(f.h>highestPrice)highestPrice=f.h;
      const pH=f.pctH,pL=f.pctL,pC=f.pctC;
      if(pH>mfe)mfe=pH;if(pL<mae)mae=pL;

      // T1/T2/T3 checks
      if(!t1Hit&&pH>=t1Pct){t1Hit=true;if(!outcome||outcome==='EXPIRED')outcome='T1_HIT';exitDay=f.day;}
      if(t1Hit&&!t2Hit&&pH>=t2Pct){t2Hit=true;outcome='T2_HIT';exitDay=f.day;}
      if(t2Hit&&!t3Hit&&pH>=t3Pct){t3Hit=true;outcome='T3_HIT';exitDay=f.day;break;}

      // Cascading Gates Stop (pre-T1 only)
      if(!t1Hit&&f.day<=10&&pC<=-stopPct){
        const openP=f.o;const isGreen=openP<f.c;const range=f.h-f.l;
        const closeLoc=range>0?(f.c-f.l)/range*100:50;
        const lwPct=range>0?(Math.min(openP,f.c)-f.l)/range*100:0;
        // Gate 1: RSI-2
        const prevC=future.find(x=>x.day===f.day-1)?.c??entry;
        const prevPrevC=future.find(x=>x.day===f.day-2)?.c??entry;
        const ch1=f.c-prevC,ch2=prevC-prevPrevC;
        const rG=((ch2>0?ch2:0)+(ch1>0?ch1:0))/2;
        const rL=((ch2<0?-ch2:0)+(ch1<0?-ch1:0))/2;
        const rsi2Val=rL<0.001?100:100-100/(1+rG/rL);
        if(rsi2Val<8)continue; // Gate 1 blocks
        // Gate 2: 2-day confirmation
        const prevCandle=future.find(x=>x.day===f.day-1);
        if(!prevCandle||prevCandle.pctC>-stopPct)continue; // Gate 2 blocks
        // Gate 3: Hammer
        if(lwPct>=40&&closeLoc>=50)continue;
        // Gate 4: Green recovery
        if(isGreen&&closeLoc>=50)continue;
        // Gate 5: Close position
        if(closeLoc>=45)continue;
        // All gates passed
        stopped=true;outcome='STOPPED';exitDay=f.day;break;
      }
      // Post-T1 trailing: breakeven stop
      if(t1Hit&&!t2Hit&&pL<=0){outcome='T1_HIT';break;} // stopped at breakeven after T1
    }

    // Compute P&L based on partial exit model
    let pnlPct=0,pnlR=0;
    if(outcome==='STOPPED'){pnlPct=-stopPct;pnlR=-1;}
    else if(outcome==='T1_HIT'){pnlPct=t1Pct*0.5;pnlR=t1Pct/stopPct*0.5;} // 50% at T1
    else if(outcome==='T2_HIT'){pnlPct=t1Pct*0.5+t2Pct*0.3;pnlR=(t1Pct*0.5+t2Pct*0.3)/stopPct;}
    else if(outcome==='T3_HIT'){pnlPct=t1Pct*0.5+t2Pct*0.3+t3Pct*0.2;pnlR=(t1Pct*0.5+t2Pct*0.3+t3Pct*0.2)/stopPct;}
    else{pnlPct=0;pnlR=0;} // expired

    ALL.push({sym,date:c[i].date,entry,atrVal,atrPct,zoneLow,stopPct,t1Pct,t2Pct,t3Pct,rr,
      outcome,exitDay,pnlPct,pnlR,mfe,mae,highestPrice,stopped,t1Hit,t2Hit,t3Hit,
      paramsPassed,passD20,passHP,passE10,passUS});
  }
}
ALL.sort((a,b)=>(a.date||'').localeCompare(b.date||''));

// ═══ REPORT ═══
console.log('█'.repeat(90));
console.log('  FULL SYSTEM BACKTEST — v5-WLB Params + Cascading Gates Stop');
console.log('  29 OHLCV files · 10-day horizon · Partial exit model (50/30/20)');
console.log('█'.repeat(90));

// Per param set results
for(const[key,p]of Object.entries(PARAMS)){
  const field = key==='D20'?'passD20':key==='HP15'?'passHP':key==='E10'?'passE10':'passUS';
  const trades=ALL.filter(s=>s[field]);
  if(trades.length===0){console.log(`\n  ${p.name}: 0 qualifying signals`);continue;}

  const t1=trades.filter(t=>t.t1Hit);
  const t2=trades.filter(t=>t.t2Hit);
  const t3=trades.filter(t=>t.t3Hit);
  const stopped=trades.filter(t=>t.stopped);
  const expired=trades.filter(t=>t.outcome==='EXPIRED');
  const winners=trades.filter(t=>t.mfe>=5);
  const falseStops=trades.filter(t=>t.stopped&&t.mfe>=5);
  const decided=trades.filter(t=>t.outcome!=='EXPIRED');
  const avgMfe=trades.reduce((s,t)=>s+t.mfe,0)/trades.length;
  const avgMae=trades.reduce((s,t)=>s+t.mae,0)/trades.length;
  const avgPnl=decided.length>0?decided.reduce((s,t)=>s+t.pnlPct,0)/decided.length:0;
  const avgR=decided.length>0?decided.reduce((s,t)=>s+t.pnlR,0)/decided.length:0;
  const totalR=decided.reduce((s,t)=>s+t.pnlR,0);
  const avgDaysT1=t1.length>0?t1.reduce((s,t)=>s+t.exitDay,0)/t1.length:0;
  const avgStopPct=trades.reduce((s,t)=>s+t.stopPct,0)/trades.length;
  const avgRR=trades.reduce((s,t)=>s+t.rr,0)/trades.length;
  const profitFactor=stopped.length>0?(t1.reduce((s,t)=>s+t.pnlPct,0))/(Math.abs(stopped.reduce((s,t)=>s+t.pnlPct,0))||1):99;

  console.log(`\n${'═'.repeat(90)}`);
  console.log(`  ${p.name}`);
  console.log('═'.repeat(90));
  console.log(`\n  ┌─── SIGNAL STATS ─────────────────────────────────────────────┐`);
  console.log(`  │ Total signals:        ${String(trades.length).padStart(6)}                                │`);
  console.log(`  │ Winners (MFE≥5%):     ${String(winners.length).padStart(6)}  (${(winners.length/trades.length*100).toFixed(1)}%)                         │`);
  console.log(`  │ Unique stocks:        ${String([...new Set(trades.map(t=>t.sym))].length).padStart(6)}                                │`);
  console.log(`  └──────────────────────────────────────────────────────────────┘`);

  console.log(`\n  ┌─── OUTCOME DISTRIBUTION ─────────────────────────────────────┐`);
  console.log(`  │ T1 Hit (50% exit):    ${String(t1.length).padStart(6)}  (${(t1.length/trades.length*100).toFixed(1)}%)                         │`);
  console.log(`  │ T2 Hit (30% exit):    ${String(t2.length).padStart(6)}  (${(t2.length/trades.length*100).toFixed(1)}%)                         │`);
  console.log(`  │ T3 Hit (20% exit):    ${String(t3.length).padStart(6)}  (${(t3.length/trades.length*100).toFixed(1)}%)                         │`);
  console.log(`  │ Stopped (loss):       ${String(stopped.length).padStart(6)}  (${(stopped.length/trades.length*100).toFixed(1)}%)                         │`);
  console.log(`  │ Expired (no action):  ${String(expired.length).padStart(6)}  (${(expired.length/trades.length*100).toFixed(1)}%)                         │`);
  console.log(`  │ FALSE stops:          ${String(falseStops.length).padStart(6)}  (${(falseStops.length/Math.max(winners.length,1)*100).toFixed(1)}% of winners)              │`);
  console.log(`  └──────────────────────────────────────────────────────────────┘`);

  console.log(`\n  ┌─── WIN RATES ────────────────────────────────────────────────┐`);
  console.log(`  │ Hit Rate (+5%):       ${(winners.length/trades.length*100).toFixed(1).padStart(6)}%                               │`);
  console.log(`  │ T1 Hit Rate:          ${(t1.length/trades.length*100).toFixed(1).padStart(6)}%                               │`);
  console.log(`  │ Win Rate (decided):   ${(decided.length>0?(t1.length/decided.length*100).toFixed(1):'0').padStart(6)}%                               │`);
  console.log(`  │ Stop Rate:            ${(stopped.length/trades.length*100).toFixed(1).padStart(6)}%                               │`);
  console.log(`  │ Profit Factor:        ${profitFactor.toFixed(2).padStart(6)}                                │`);
  console.log(`  └──────────────────────────────────────────────────────────────┘`);

  console.log(`\n  ┌─── RETURNS ─────────────────────────────────────────────────┐`);
  console.log(`  │ Avg MFE (10d):        ${('+'+avgMfe.toFixed(1)+'%').padStart(7)}                               │`);
  console.log(`  │ Avg MAE (10d):        ${(avgMae.toFixed(1)+'%').padStart(7)}                               │`);
  console.log(`  │ MFE/MAE ratio:        ${(avgMfe/Math.abs(avgMae||1)).toFixed(2).padStart(6)}                                │`);
  console.log(`  │ Avg P&L% (decided):   ${(avgPnl>=0?'+':'')+avgPnl.toFixed(2)+'%'.padStart(7)}                              │`);
  console.log(`  │ Avg R (decided):      ${(avgR>=0?'+':'')+avgR.toFixed(3)+'R'.padStart(7)}                              │`);
  console.log(`  │ Total R:              ${(totalR>=0?'+':'')+totalR.toFixed(1)+'R'.padStart(8)}                             │`);
  console.log(`  └──────────────────────────────────────────────────────────────┘`);

  console.log(`\n  ┌─── RISK ──────────────────────────────────────────────────────┐`);
  console.log(`  │ Avg Stop %:           ${avgStopPct.toFixed(2).padStart(6)}%                               │`);
  console.log(`  │ Avg R:R ratio:        ${avgRR.toFixed(2).padStart(6)}                                │`);
  console.log(`  │ Avg days to T1:       ${avgDaysT1.toFixed(1).padStart(6)} days                            │`);
  console.log(`  │ False stop rate:      ${(falseStops.length/Math.max(winners.length,1)*100).toFixed(1).padStart(6)}%                               │`);
  console.log(`  └──────────────────────────────────────────────────────────────┘`);

  // Individual trades
  console.log(`\n  Top 15 trades by MFE:`);
  console.log('  Symbol       │ Date       │ Outcome  │ MFE    │ MAE    │ P&L%   │ R-Mult │ Days │ RR');
  for(const t of trades.sort((a,b)=>b.mfe-a.mfe).slice(0,15)){
    console.log(`  ${t.sym.padEnd(12)} │ ${(t.date||'—').padEnd(10)} │ ${t.outcome.padEnd(8)} │ ${('+'+t.mfe.toFixed(1)+'%').padStart(6)} │ ${t.mae.toFixed(1).padStart(5)}% │ ${(t.pnlPct>=0?'+':'')+t.pnlPct.toFixed(1)+'%'.padStart(6)} │ ${(t.pnlR>=0?'+':'')+t.pnlR.toFixed(2)+'R'.padStart(7)} │ ${String(t.exitDay).padStart(4)} │ ${t.rr.toFixed(1)}`);
  }
}

// Combined system stats
console.log(`\n${'█'.repeat(90)}`);
console.log('  COMBINED SYSTEM (any param set)');
console.log('█'.repeat(90));
const any=ALL.filter(s=>s.paramsPassed.length>0);
const anyT1=any.filter(t=>t.t1Hit),anyStopped=any.filter(t=>t.stopped),anyExpired=any.filter(t=>t.outcome==='EXPIRED');
const anyWinners=any.filter(t=>t.mfe>=5),anyFalse=any.filter(t=>t.stopped&&t.mfe>=5);
const anyDecided=any.filter(t=>t.outcome!=='EXPIRED');
if(any.length>0){
  console.log(`\n  Signals: ${any.length} | T1: ${anyT1.length} | T2: ${any.filter(t=>t.t2Hit).length} | T3: ${any.filter(t=>t.t3Hit).length} | Stopped: ${anyStopped.length} | Expired: ${anyExpired.length}`);
  console.log(`  Hit Rate: ${(anyWinners.length/any.length*100).toFixed(1)}% | Win Rate: ${(anyDecided.length>0?(anyT1.length/anyDecided.length*100).toFixed(1):'0')}% | Stop Rate: ${(anyStopped.length/any.length*100).toFixed(1)}%`);
  console.log(`  False Stops: ${anyFalse.length}/${anyWinners.length} (${(anyFalse.length/Math.max(anyWinners.length,1)*100).toFixed(1)}%)`);
  console.log(`  Avg MFE: +${(any.reduce((s,t)=>s+t.mfe,0)/any.length).toFixed(1)}% | Avg MAE: ${(any.reduce((s,t)=>s+t.mae,0)/any.length).toFixed(1)}%`);
  console.log(`  Avg R (decided): ${(anyDecided.reduce((s,t)=>s+t.pnlR,0)/anyDecided.length).toFixed(3)}R | Total R: ${anyDecided.reduce((s,t)=>s+t.pnlR,0).toFixed(1)}R`);
  console.log(`  Avg days to T1: ${(anyT1.reduce((s,t)=>s+t.exitDay,0)/Math.max(anyT1.length,1)).toFixed(1)} days`);
}

// Walk-forward
console.log(`\n${'═'.repeat(90)}`);
console.log('  WALK-FORWARD (70/30)');
console.log('═'.repeat(90));
const sp=Math.floor(any.length*0.70);
const isT=any.slice(0,sp),oosT=any.slice(sp);
for(const[label,set]of[['In-Sample (70%)',isT],['Out-of-Sample (30%)',oosT]]){
  const d=set.filter(t=>t.outcome!=='EXPIRED');
  const w=set.filter(t=>t.t1Hit);
  const st=set.filter(t=>t.stopped);
  console.log(`  ${label}: ${set.length} signals, WR ${d.length>0?(w.length/d.length*100).toFixed(1):'0'}%, Exp ${d.length>0?(d.reduce((s,t)=>s+t.pnlR,0)/d.length).toFixed(3):'0'}R, False ${set.filter(t=>t.stopped&&t.mfe>=5).length}`);
}

// Wilson LB for each param set
console.log(`\n${'═'.repeat(90)}`);
console.log('  WILSON LOWER BOUNDS');
console.log('═'.repeat(90));
for(const[key,p]of Object.entries(PARAMS)){
  const field=key==='D20'?'passD20':key==='HP15'?'passHP':key==='E10'?'passE10':'passUS';
  const trades=ALL.filter(s=>s[field]);
  const winners=trades.filter(t=>t.mfe>=5);
  const n=trades.length,h=winners.length;
  if(n<2)continue;
  const pr=h/n,z=1.96;
  const wlb=(pr+z*z/(2*n)-z*Math.sqrt((pr*(1-pr)+z*z/(4*n))/n))/(1+z*z/n)*100;
  console.log(`  ${p.name.padEnd(20)}: ${n} trades, ${h} hits (${(h/n*100).toFixed(1)}%), Wilson LB ${wlb.toFixed(1)}%`);
}
