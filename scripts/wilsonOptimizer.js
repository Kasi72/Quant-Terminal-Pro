// Wilson Lower Bound Optimizer — maximize WLB for each v5 param set
// WLB = f(hit_rate, sample_size) — needs BOTH high rate AND enough trades
// Strategy: fine-tune v5 params to push WLB as high as possible

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));

function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function rsi2(c){const r=new Array(c.length).fill(50);if(c.length<4)return r;let g=0,l=0;for(let i=1;i<=2;i++){const ch=c[i].c-c[i-1].c;if(ch>0)g+=ch;else l+=Math.abs(ch);}g/=2;l/=2;for(let i=3;i<c.length;i++){const ch=c[i].c-c[i-1].c;g=(g+Math.max(ch,0))/2;l=(l+Math.max(-ch,0))/2;r[i]=l<1e-4?100:100-100/(1+g/l);}return r;}
function pR(w,v){return w.length===0?50:(w.filter(x=>x<v).length/w.length)*100;}
function upsC(cl,uw,bp,vp,zt,zl){let s=0;if(cl>=80)s+=20;else if(cl>=65)s+=12;if(uw<=20)s+=20;else if(uw<=35)s+=12;if(bp>=55)s+=15;else if(bp>=35)s+=9;if(vp>=4)s+=20;else if(vp>=2)s+=12;if(zt<=5)s+=15;else if(zt<=15)s+=9;if(zl>=12)s+=10;else if(zl>=6)s+=6;return s;}
function cqsC(cl,uw,bp,vp,ve){let s=0;if(cl>=65)s++;if(uw<=30)s++;if(bp>=40)s++;if(vp>=2.5)s++;if(ve>=1.5)s++;return s;}

// Pre-compute ALL signals
const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c),r2=rsi2(c);
  for(let i=40;i<c.length-11;i++){
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
    const caz=bZ.zH>0?((s.c-bZ.zH)/bZ.zH)*100:0;
    const uV=upsC(cl,uw,bp,vP,bZ.zt,bZ.len);const cV=cqsC(cl,uw,bp,vP,vE);
    let mfe=0,mae=0,h5=false,h3=false,d5=99;
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){const p=(c[d].h-s.c)/s.c*100;const dr=(c[d].l-s.c)/s.c*100;if(p>mfe)mfe=p;if(dr<mae)mae=dr;if(!h3&&p>=3)h3=true;if(!h5&&p>=5){h5=true;d5=d-i;}}
    ALL.push({sym,date:c[i].date,to,apctl,p10A,p10E,bZ,p10V,p5V,rvb,ra,vR,vP,cl,uw,bp,sr,uV,cV,rsi2:r2[i],vE,caz,mfe,mae,h5,h3,d5});
  }
}
console.log(`Total breakout candles: ${ALL.length}\n`);

function filt(sigs,p){return sigs.filter(s=>{if(s.to<p.minTO)return false;if(s.apctl>p.maxAP)return false;if(s.p10A>p.maxPRR)return false;if(s.p10E>p.maxEC)return false;if(s.bZ.len<p.minZL||s.bZ.len>p.maxZL)return false;if(s.bZ.zt>p.maxZT)return false;if(s.p10V>p.maxPV)return false;if(s.p5V>p.maxP5V)return false;if(s.rvb>p.maxRVB)return false;if(s.ra<p.minRA||s.ra>p.maxRA)return false;if(s.vR<p.minVR)return false;if(s.vP<p.minVP5)return false;if(s.cl<p.minCL)return false;if(s.uw>p.maxUW)return false;if(s.bp<p.minBP)return false;if(s.sr>p.maxSR)return false;if(s.uV<p.minUPS)return false;if(s.rsi2<p.minRSI)return false;if(p.minVE!==null&&s.vE<p.minVE)return false;if(p.minCQS!==null&&s.cV<p.minCQS)return false;if(p.maxCAZ!==null&&s.caz>p.maxCAZ)return false;return true;});}

function wilsonLB(n,hits){if(n<2)return 0;const p=hits/n,z=1.96;return(p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n)*100;}

// WLB score: pure Wilson lower bound (we want to maximize this)
function wlbScore(trades){
  const n=trades.length;if(n<3)return-1;
  const h=trades.filter(t=>t.h5).length;
  const rate=h/n;
  if(rate<0.75)return-1; // hard floor: won't accept below 75%
  return wilsonLB(n,h);
}

const V5 = {
  D20:{name:'D20+ v5',minTO:1e7,maxAP:85,maxPRR:0.95,maxEC:1,minZL:6,maxZL:20,maxZT:15,maxPV:0.9,maxP5V:1.0,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:12,minUPS:60,minRSI:50,minVE:1.5,minCQS:3,maxCAZ:null},
  HP15:{name:'HP15+ v5',minTO:1e7,maxAP:85,maxPRR:1.0,maxEC:1,minZL:6,maxZL:25,maxZT:15,maxPV:0.9,maxP5V:1.1,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.1,minVP5:2.0,minCL:65,maxUW:35,minBP:25,maxSR:13,minUPS:45,minRSI:50,minVE:null,minCQS:null,maxCAZ:8},
  E10:{name:'E10+ v5',minTO:2e7,maxAP:60,maxPRR:0.95,maxEC:4,minZL:8,maxZL:15,maxZT:15,maxPV:1.0,maxP5V:1.0,maxRVB:2.0,minRA:1,maxRA:6,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:45,minRSI:50,minVE:1.25,minCQS:3,maxCAZ:null},
  US8:{name:'US8+ v5',minTO:1e7,maxAP:95,maxPRR:1.0,maxEC:1,minZL:6,maxZL:15,maxZT:15,maxPV:0.85,maxP5V:1.1,maxRVB:2.0,minRA:1,maxRA:6,minVR:1.2,minVP5:2.0,minCL:65,maxUW:40,minBP:25,maxSR:8.5,minUPS:45,minRSI:55,minVE:1.5,minCQS:null,maxCAZ:null},
};

// Fine-grained search grids focused on WLB optimization
const GRIDS = {
  D20:{maxPRR:[0.80,0.85,0.90,0.95,1.0],maxEC:[0,1,2,3],maxZT:[10,12,15,18,20],maxRVB:[1.5,1.8,2.0,2.5,3.0],maxPV:[0.85,0.90,0.95,1.0],maxP5V:[0.90,0.95,1.0,1.1],minVP5:[1.5,1.75,2.0,2.25,2.5],minCL:[60,65,70,75],minBP:[25,30,35,40],maxSR:[8.5,10,11,12,13],minUPS:[45,50,55,60,65],minVE:[1.0,1.25,1.5,1.75,null],minCQS:[1,2,3,null],minRSI:[40,45,50,55],maxAP:[75,80,85,90,95]},
  HP15:{maxPRR:[0.75,0.85,0.95,1.0,1.1],maxEC:[0,1,2,3],maxZT:[10,12,15,18,20],maxRVB:[1.3,1.5,1.8,2.0,2.5],maxPV:[0.85,0.90,0.95,1.0],minVP5:[1.5,1.75,2.0,2.25],minCL:[60,65,70],minBP:[20,25,30,35],maxSR:[10,11,12,13],minUPS:[35,40,45,50],maxCAZ:[5,6,8,10,12,null],minVR:[1.0,1.1,1.2],minRSI:[40,45,50]},
  E10:{minTO:[1e7,1.5e7,2e7],maxAP:[50,55,60,70,80],maxPRR:[0.80,0.85,0.90,0.95,1.0],maxEC:[2,3,4,5],minZL:[6,7,8],maxZL:[12,15,18,20],maxZT:[10,12,15,18,20],maxRVB:[1.5,1.8,2.0,2.5],maxPV:[0.85,0.90,0.95,1.0],maxP5V:[0.90,0.95,1.0,1.1],minVP5:[1.5,1.75,2.0,2.5,3.0],minCL:[60,65,70],minBP:[30,35,40],minVE:[1.0,1.1,1.25,1.5,null],minCQS:[1,2,3,null],minUPS:[35,40,45,50]},
  US8:{maxAP:[60,70,80,85,95],maxPRR:[0.75,0.85,0.95,1.0],maxEC:[0,1,2,3],maxZL:[12,15,18,20],maxZT:[8,10,12,15,18],maxRVB:[1.3,1.5,1.8,2.0,2.5],maxPV:[0.80,0.85,0.90,0.95],maxP5V:[0.95,1.0,1.1,1.2],minVP5:[1.5,1.75,2.0,2.5],minCL:[60,65,70],minBP:[20,25,30,35],minUPS:[35,40,45,50],minRSI:[40,45,50,55],minVE:[1.0,1.25,1.5,null]},
};

for(const[key,v5Base]of Object.entries(V5)){
  const grid=GRIDS[key];
  const paramKeys=Object.keys(grid);

  console.log(`${'█'.repeat(80)}`);
  console.log(`  WILSON LB OPTIMIZER: ${v5Base.name}`);
  console.log(`${'█'.repeat(80)}`);

  const baseResult=filt(ALL,v5Base);
  const baseHits=baseResult.filter(t=>t.h5).length;
  const baseWLB=wilsonLB(baseResult.length,baseHits);
  const baseRate=baseResult.length>0?(baseHits/baseResult.length*100):0;
  console.log(`  v5 baseline: ${baseResult.length} trades, ${baseHits} hits, ${baseRate.toFixed(1)}%, WLB=${baseWLB.toFixed(1)}%\n`);

  // Phase 1: Hill climbing on WLB
  let best={...v5Base};let bestWLB=baseWLB;let improved=true;let pass=0;
  while(improved&&pass<15){improved=false;pass++;
    for(const pk of paramKeys){let localBest=best[pk];let localBestWLB=bestWLB;
      for(const val of grid[pk]){const test={...best,[pk]:val};const r=filt(ALL,test);const w=wlbScore(r);
        if(w>localBestWLB){localBest=val;localBestWLB=w;}}
      if(localBest!==best[pk]){best={...best,[pk]:localBest};bestWLB=localBestWLB;improved=true;}}}

  // Phase 2: 30000 random perturbations targeting WLB
  for(let iter=0;iter<30000;iter++){
    const test={...best};const n=2+Math.floor(Math.random()*3);
    for(let p=0;p<n;p++){const pk=paramKeys[Math.floor(Math.random()*paramKeys.length)];const vals=grid[pk];test[pk]=vals[Math.floor(Math.random()*vals.length)];}
    const w=wlbScore(filt(ALL,test));if(w>bestWLB){bestWLB=w;Object.assign(best,test);}}

  // Phase 3: Exhaustive pairwise around best
  for(let a=0;a<Math.min(8,paramKeys.length);a++){
    for(let b=a+1;b<Math.min(8,paramKeys.length);b++){
      for(const va of grid[paramKeys[a]]){for(const vb of grid[paramKeys[b]]){
        const test={...best,[paramKeys[a]]:va,[paramKeys[b]]:vb};const w=wlbScore(filt(ALL,test));
        if(w>bestWLB){bestWLB=w;best=test;}}}}}

  const finalResult=filt(ALL,best);
  const finalHits=finalResult.filter(t=>t.h5).length;
  const finalRate=finalResult.length>0?(finalHits/finalResult.length*100):0;
  const finalWLB=wilsonLB(finalResult.length,finalHits);
  const avgMfe=finalResult.reduce((s,t)=>s+t.mfe,0)/finalResult.length;
  const avgMae=finalResult.reduce((s,t)=>s+t.mae,0)/finalResult.length;

  console.log(`  ╔══════════════════════════════════════════════════════════════╗`);
  console.log(`  ║  ${v5Base.name} — WILSON LB OPTIMIZED                       ║`);
  console.log(`  ╠══════════════════════════════════════════════════════════════╣`);
  console.log(`  ║  v5 baseline WLB:  ${baseWLB.toFixed(1).padStart(5)}%  (${baseResult.length} trades, ${baseRate.toFixed(1)}% rate)    ║`);
  console.log(`  ║  Optimized WLB:    ${finalWLB.toFixed(1).padStart(5)}%  (${finalResult.length} trades, ${finalRate.toFixed(1)}% rate)    ║`);
  console.log(`  ║  WLB improvement:  +${(finalWLB-baseWLB).toFixed(1)}%                                   ║`);
  console.log(`  ║  Avg MFE: +${avgMfe.toFixed(1)}%   Avg MAE: ${avgMae.toFixed(1)}%                       ║`);
  console.log(`  ╚══════════════════════════════════════════════════════════════╝`);

  // Show changes from v5
  console.log('\n  Changes from v5:');
  const changedParams=[];
  for(const pk of paramKeys){if(best[pk]!==v5Base[pk]){console.log(`    ${pk}: ${v5Base[pk]} → ${best[pk]}`);changedParams.push(pk);}}
  if(changedParams.length===0)console.log('    (no changes — v5 already optimal for WLB)');

  // Show all trades
  console.log(`\n  All ${finalResult.length} trades:`);
  console.log('  Symbol       │ Date       │ +5%Hit │ MFE    │ MAE    │ Days5');
  for(const t of finalResult.sort((a,b)=>b.mfe-a.mfe)){
    console.log(`  ${t.sym.padEnd(12)} │ ${(t.date||'—').padEnd(10)} │ ${t.h5?'YES   ':'NO    '} │ ${t.mfe.toFixed(1).padStart(5)}% │ ${t.mae.toFixed(1).padStart(5)}% │ ${t.h5?String(t.d5).padStart(5):'  —'}`);
  }

  // Monte Carlo on WLB-optimized
  const mcRates=[];
  for(let mc=0;mc<1000;mc++){
    const sh=[...finalResult].sort(()=>Math.random()-0.5);
    const sp=Math.floor(sh.length*0.70);const oos=sh.slice(sp);
    if(oos.length===0)continue;mcRates.push(oos.filter(t=>t.h5).length/oos.length*100);}
  mcRates.sort((a,b)=>a-b);
  console.log(`\n  Monte Carlo (1000 shuffles):`);
  console.log(`    5th pctl: ${mcRates[Math.floor(mcRates.length*0.05)].toFixed(1)}% | Median: ${mcRates[Math.floor(mcRates.length*0.50)].toFixed(1)}% | P(≥75%): ${(mcRates.filter(r=>r>=75).length/mcRates.length*100).toFixed(1)}% | P(≥80%): ${(mcRates.filter(r=>r>=80).length/mcRates.length*100).toFixed(1)}%`);

  // Output final params for stockEngine.ts
  console.log('\n  ═══ FINAL PARAMS (for stockEngine.ts) ═══');
  const paramMap={minTO:'minAvgTurnover20',maxAP:'maxATRPct14Pctl120',maxPRR:'maxPre10AvgRangeATR',maxEC:'maxPre10ExpansionCount',minZL:'minZoneLen',maxZL:'maxZoneLen',maxZT:'maxZoneTightnessPct',maxPV:'maxPre10AvgVolRatio',maxP5V:'maxPre5AvgVolRatio',maxRVB:'maxPre10RedVolBias',minRA:'minExactRangeATR14',maxRA:'maxExactRangeATR14',minVR:'minExactVolRatio20',minVP5:'minExactVolVsPre5',minCL:'minCloseLoc',maxUW:'maxUpperWickPct',minBP:'minBodyPct',maxSR:'maxCandleRisk',minUPS:'minUltraPrecisionScore',minRSI:'minRSI2',minVE:'minVolatilityExpansionRatio',minCQS:'minCandleQualityScore',maxCAZ:'maxCloseAboveZonePct'};
  const allKeys=['minTO','maxAP','maxPRR','maxEC','minZL','maxZL','maxZT','maxPV','maxP5V','maxRVB','minRA','maxRA','minVR','minVP5','minCL','maxUW','minBP','maxSR','minUPS','minRSI','minVE','minCQS','maxCAZ'];
  for(const pk of allKeys){const v=best[pk]!==undefined?best[pk]:v5Base[pk];const eng=paramMap[pk]||pk;
    const isChanged=changedParams.includes(pk);
    console.log(`    ${eng}: ${v===null?'null':v},${isChanged?' // ← CHANGED from v5':''}`);
  }
  console.log('');
}

// Summary comparison table
console.log('\n' + '═'.repeat(80));
console.log('  SUMMARY: v4 → v5 → v5-WLB');
console.log('═'.repeat(80));
console.log('  Param Set    │ v4 WLB  │ v5 WLB  │ v5-WLB  │ v4 Trades │ v5 Trades │ v5W Trades │ v5W Rate');
console.log('  ─────────────┼─────────┼─────────┼─────────┼───────────┼───────────┼────────────┼─────────');
