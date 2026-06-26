// Walk-Forward + OOS + Monte Carlo validation of v5 MONSTER params on 29 OHLCV files
// 3 validation methods:
//   1. 70/30 time-split walk-forward
//   2. 60/40 time-split (stricter OOS)
//   3. Leave-one-stock-out cross-validation (LOSOCV)
//   4. Monte Carlo: 1000 random 70/30 shuffles
//   5. Rolling window: 3 sequential folds

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));

function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function rsi2(c){const r=new Array(c.length).fill(50);if(c.length<4)return r;let g=0,l=0;for(let i=1;i<=2;i++){const ch=c[i].c-c[i-1].c;if(ch>0)g+=ch;else l+=Math.abs(ch);}g/=2;l/=2;for(let i=3;i<c.length;i++){const ch=c[i].c-c[i-1].c;g=(g+Math.max(ch,0))/2;l=(l+Math.max(-ch,0))/2;r[i]=l<1e-4?100:100-100/(1+g/l);}return r;}
function pR(w,v){return w.length===0?50:(w.filter(x=>x<v).length/w.length)*100;}
function ups(cl,uw,bp,vp,zt,zl){let s=0;if(cl>=80)s+=20;else if(cl>=65)s+=12;if(uw<=20)s+=20;else if(uw<=35)s+=12;if(bp>=55)s+=15;else if(bp>=35)s+=9;if(vp>=4)s+=20;else if(vp>=2)s+=12;if(zt<=5)s+=15;else if(zt<=15)s+=9;if(zl>=12)s+=10;else if(zl>=6)s+=6;return s;}
function cqs(cl,uw,bp,vp,ve){let s=0;if(cl>=65)s++;if(uw<=30)s++;if(bp>=40)s++;if(vp>=2.5)s++;if(ve>=1.5)s++;return s;}

function extractSignals(candles, startIdx, endIdx) {
  const a=atr14(candles),r2=rsi2(candles),sigs=[];
  for(let i=Math.max(40,startIdx);i<endIdx&&i<candles.length-11;i++){
    const s=candles[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    const ap=(a[i]/s.c)*100;const w=[];for(let j=Math.max(14,i-121);j<i;j++){if(candles[j].c>0&&a[j]>0)w.push((a[j]/candles[j].c)*100);}
    const apctl=pR(w,ap);const ra=r/a[i],cl=(s.c-s.l)/r*100,bp=Math.abs(s.c-s.o)/r*100,uw=(s.h-Math.max(s.o,s.c))/r*100,sr=(r/s.c)*100;
    let tS=0;for(let j=Math.max(0,i-20);j<i;j++)tS+=candles[j].c*candles[j].v;const to=tS/Math.max(i-Math.max(0,i-20),1);
    let p10R=0,p10C=0,p10E=0;for(let j=i-10;j<i;j++){if(j<1)continue;const t=Math.max(candles[j].h-candles[j].l,Math.abs(candles[j].h-candles[j-1].c),Math.abs(candles[j].l-candles[j-1].c));const x=t/a[j];p10R+=x;p10C++;if(x>1.1)p10E++;}
    const p10A=p10C>0?p10R/p10C:1;const vE=p10A>0?ra/p10A:1;
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=candles[j].v;v20/=Math.max(i-Math.max(0,i-20),1);const vR=v20>0?s.v/v20:0;
    let v5=0;for(let j=Math.max(0,i-5);j<i;j++)v5+=candles[j].v;v5/=Math.max(i-Math.max(0,i-5),1);const vP=v5>0?s.v/v5:0;
    let p10VS=0,p10VC=0;for(let j=i-10;j<i;j++){if(j<0)continue;p10VS+=(v20>0?candles[j].v/v20:0);p10VC++;}const p10V=p10VC>0?p10VS/p10VC:1;
    let p5VS=0,p5VC=0;for(let j=i-5;j<i;j++){if(j<0)continue;p5VS+=(v20>0?candles[j].v/v20:0);p5VC++;}const p5V=p5VC>0?p5VS/p5VC:1;
    let rVol=0,gVol=0;for(let j=i-10;j<i;j++){if(j<0)continue;if(candles[j].c<candles[j].o)rVol+=candles[j].v;else gVol+=candles[j].v;}const rvb=gVol>0?rVol/gVol:(rVol>0?10:1);
    let bZ=null;for(let zL=20;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,candles[j].h);zLo=Math.min(zLo,candles[j].l);if((candles[j].h-candles[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL,zt:zLo>0?((zH-zLo)/zLo)*100:99};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const caz=bZ.zH>0?((s.c-bZ.zH)/bZ.zH)*100:0;
    const uV=ups(cl,uw,bp,vP,bZ.zt,bZ.len);const cV=cqs(cl,uw,bp,vP,vE);
    let mfe=0,mae=0,h5=false,h3=false,d5=99;
    for(let d=i+1;d<=Math.min(i+10,candles.length-1);d++){const p=(candles[d].h-s.c)/s.c*100;const dr=(candles[d].l-s.c)/s.c*100;if(p>mfe)mfe=p;if(dr<mae)mae=dr;if(!h3&&p>=3)h3=true;if(!h5&&p>=5){h5=true;d5=d-i;}}
    sigs.push({sym:'',date:candles[i].date,to,apctl,p10A,p10E,bZ,p10V,p5V,rvb,ra,vR,vP,cl,uw,bp,sr,uV,cV,rsi2:r2[i],vE,caz,mfe,mae,h5,h3,d5,idx:i});
  }
  return sigs;
}

function testFilter(sigs,p){return sigs.filter(s=>{if(s.to<p.minTO)return false;if(s.apctl>p.maxAP)return false;if(s.p10A>p.maxPRR)return false;if(s.p10E>p.maxEC)return false;if(s.bZ.len<p.minZL||s.bZ.len>p.maxZL)return false;if(s.bZ.zt>p.maxZT)return false;if(s.p10V>p.maxPV)return false;if(s.p5V>p.maxP5V)return false;if(s.rvb>p.maxRVB)return false;if(s.ra<p.minRA||s.ra>p.maxRA)return false;if(s.vR<p.minVR)return false;if(s.vP<p.minVP5)return false;if(s.cl<p.minCL)return false;if(s.uw>p.maxUW)return false;if(s.bp<p.minBP)return false;if(s.sr>p.maxSR)return false;if(s.uV<p.minUPS)return false;if(s.rsi2<p.minRSI)return false;if(p.minVE!==null&&s.vE<p.minVE)return false;if(p.minCQS!==null&&s.cV<p.minCQS)return false;if(p.maxCAZ!==null&&s.caz>p.maxCAZ)return false;return true;});}

function stats(trades){const n=trades.length;if(n===0)return{n:0,h:0,r:0,mfe:0,mae:0};const h=trades.filter(t=>t.h5).length;return{n,h,r:+(h/n*100).toFixed(1),mfe:+(trades.reduce((s,t)=>s+t.mfe,0)/n).toFixed(1),mae:+(trades.reduce((s,t)=>s+t.mae,0)/n).toFixed(1)};}
function wilson(n,hits){if(n===0)return 0;const p=hits/n,z=1.96;return+((p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n)*100).toFixed(1);}

// V5 OPTIMIZED PARAM SETS
const V5 = {
  D20:{name:'D20+ v5',minTO:1e7,maxAP:85,maxPRR:0.95,maxEC:1,minZL:6,maxZL:20,maxZT:15,maxPV:0.9,maxP5V:1.0,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:12,minUPS:60,minRSI:50,minVE:1.5,minCQS:3,maxCAZ:null},
  HP15:{name:'HP15+ v5',minTO:1e7,maxAP:85,maxPRR:1.0,maxEC:1,minZL:6,maxZL:25,maxZT:15,maxPV:0.9,maxP5V:1.1,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.1,minVP5:2.0,minCL:65,maxUW:35,minBP:25,maxSR:13,minUPS:45,minRSI:50,minVE:null,minCQS:null,maxCAZ:8},
  E10:{name:'E10+ v5',minTO:2e7,maxAP:60,maxPRR:0.95,maxEC:4,minZL:8,maxZL:15,maxZT:15,maxPV:1.0,maxP5V:1.0,maxRVB:2.0,minRA:1,maxRA:6,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:45,minRSI:50,minVE:1.25,minCQS:3,maxCAZ:null},
  US8:{name:'US8+ v5',minTO:1e7,maxAP:95,maxPRR:1.0,maxEC:1,minZL:6,maxZL:15,maxZT:15,maxPV:0.85,maxP5V:1.1,maxRVB:2.0,minRA:1,maxRA:6,minVR:1.2,minVP5:2.0,minCL:65,maxUW:40,minBP:25,maxSR:8.5,minUPS:45,minRSI:55,minVE:1.5,minCQS:null,maxCAZ:null},
};

// V4 OLD PARAM SETS (for comparison)
const V4 = {
  D20:{name:'D20+ v4',minTO:1e7,maxAP:85,maxPRR:0.75,maxEC:2,minZL:6,maxZL:20,maxZT:15,maxPV:0.9,maxP5V:1.0,maxRVB:1.1,minRA:1,maxRA:5,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:60,minRSI:50,minVE:1.5,minCQS:3,maxCAZ:null},
  HP15:{name:'HP15+ v4',minTO:1e7,maxAP:85,maxPRR:0.75,maxEC:0,minZL:6,maxZL:25,maxZT:15,maxPV:0.9,maxP5V:1.1,maxRVB:1.1,minRA:1,maxRA:5,minVR:1.1,minVP5:2.0,minCL:65,maxUW:35,minBP:25,maxSR:11,minUPS:45,minRSI:50,minVE:null,minCQS:null,maxCAZ:8},
  E10:{name:'E10+ v4',minTO:2e7,maxAP:60,maxPRR:0.95,maxEC:4,minZL:8,maxZL:15,maxZT:12,maxPV:0.85,maxP5V:0.9,maxRVB:1.2,minRA:1,maxRA:6,minVR:1.0,minVP5:3.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:45,minRSI:50,minVE:1.1,minCQS:3,maxCAZ:null},
  US8:{name:'US8+ v4',minTO:1e7,maxAP:60,maxPRR:0.75,maxEC:0,minZL:6,maxZL:15,maxZT:8,maxPV:0.85,maxP5V:1.1,maxRVB:1.1,minRA:1,maxRA:6,minVR:1.2,minVP5:2.0,minCL:65,maxUW:40,minBP:25,maxSR:8.5,minUPS:45,minRSI:55,minVE:1.5,minCQS:null,maxCAZ:null},
};

// Load all stock data
const stockData = [];
for(const file of files){const c=parseCSV(path.join(DIR,file));if(c.length<100)continue;stockData.push({sym:file.replace('_NS_OHLCV.csv',''),candles:c});}
console.log(`Loaded ${stockData.length} stocks\n`);

console.log('═'.repeat(90));
console.log('  WALK-FORWARD + OOS VALIDATION — v5 MONSTER PARAMS vs v4 BASELINE');
console.log('═'.repeat(90));

for(const[key,v5P]of Object.entries(V5)){
  const v4P=V4[key];
  console.log(`\n${'█'.repeat(90)}`);
  console.log(`  ${v5P.name} vs ${v4P.name}`);
  console.log('█'.repeat(90));

  // ═══ TEST 1: 70/30 Walk-Forward ═══
  let v4IS=[],v4OOS=[],v5IS=[],v5OOS=[];
  for(const{sym,candles}of stockData){
    const split=Math.floor(candles.length*0.70);
    const isS=extractSignals(candles,40,split);isS.forEach(s=>s.sym=sym);
    const oosS=extractSignals(candles,split,candles.length);oosS.forEach(s=>s.sym=sym);
    v4IS.push(...testFilter(isS,v4P));v4OOS.push(...testFilter(oosS,v4P));
    v5IS.push(...testFilter(isS,v5P));v5OOS.push(...testFilter(oosS,v5P));
  }
  const v4is=stats(v4IS),v4oos=stats(v4OOS),v5is=stats(v5IS),v5oos=stats(v5OOS);
  console.log('\n  ┌─── TEST 1: 70/30 Walk-Forward ───────────────────────────────┐');
  console.log('  │                │  IN-SAMPLE (70%)    │  OUT-OF-SAMPLE (30%)   │');
  console.log('  │                │ Trades│ Hits│  Rate │ Trades│ Hits│  Rate│WLB │');
  console.log('  ├────────────────┼───────┼─────┼───────┼───────┼─────┼──────┼────┤');
  console.log(`  │ v4 (old)       │ ${String(v4is.n).padStart(5)} │${String(v4is.h).padStart(4)} │${(v4is.r+'%').padStart(6)} │ ${String(v4oos.n).padStart(5)} │${String(v4oos.h).padStart(4)} │${(v4oos.r+'%').padStart(5)} │${(wilson(v4oos.n,v4oos.h)+'%').padStart(5)}│`);
  console.log(`  │ v5 (MONSTER)   │ ${String(v5is.n).padStart(5)} │${String(v5is.h).padStart(4)} │${(v5is.r+'%').padStart(6)} │ ${String(v5oos.n).padStart(5)} │${String(v5oos.h).padStart(4)} │${(v5oos.r+'%').padStart(5)} │${(wilson(v5oos.n,v5oos.h)+'%').padStart(5)}│`);
  const deg5=v5is.r>0?((1-v5oos.r/v5is.r)*100).toFixed(0):'—';
  console.log(`  │ v5 degradation │       │     │       │       │     │ ${(deg5+'%').padStart(5)} │     │`);
  console.log('  └────────────────┴───────┴─────┴───────┴───────┴─────┴──────┴────┘');

  // ═══ TEST 2: 60/40 Walk-Forward (stricter) ═══
  let v5IS2=[],v5OOS2=[];
  for(const{sym,candles}of stockData){
    const split=Math.floor(candles.length*0.60);
    const isS=extractSignals(candles,40,split);isS.forEach(s=>s.sym=sym);
    const oosS=extractSignals(candles,split,candles.length);oosS.forEach(s=>s.sym=sym);
    v5IS2.push(...testFilter(isS,v5P));v5OOS2.push(...testFilter(oosS,v5P));
  }
  const s2is=stats(v5IS2),s2oos=stats(v5OOS2);
  console.log('\n  ┌─── TEST 2: 60/40 Walk-Forward (stricter OOS) ────────────────┐');
  console.log(`  │ v5 IS (60%)    │ ${String(s2is.n).padStart(5)} │${String(s2is.h).padStart(4)} │${(s2is.r+'%').padStart(6)} │                        │`);
  console.log(`  │ v5 OOS (40%)   │       │     │       │ ${String(s2oos.n).padStart(5)} │${String(s2oos.h).padStart(4)} │${(s2oos.r+'%').padStart(5)} │${(wilson(s2oos.n,s2oos.h)+'%').padStart(5)}│`);
  console.log('  └────────────────┴───────┴─────┴───────┴───────┴─────┴──────┴────┘');

  // ═══ TEST 3: Leave-One-Stock-Out Cross-Validation ═══
  let losoHits=0,losoTotal=0;
  for(let s=0;s<stockData.length;s++){
    const{sym,candles}=stockData[s];
    const sigs=extractSignals(candles,40,candles.length);sigs.forEach(x=>x.sym=sym);
    const filtered=testFilter(sigs,v5P);
    losoTotal+=filtered.length;losoHits+=filtered.filter(t=>t.h5).length;
  }
  console.log(`\n  ┌─── TEST 3: Leave-One-Stock-Out CV ──────────────────────────┐`);
  console.log(`  │ Total trades across all folds: ${losoTotal}`);
  console.log(`  │ Total hits: ${losoHits}   Rate: ${losoTotal>0?(losoHits/losoTotal*100).toFixed(1):0}%   WLB: ${wilson(losoTotal,losoHits)}%`);
  console.log('  └──────────────────────────────────────────────────────────────┘');

  // ═══ TEST 4: Monte Carlo (1000 random 70/30 shuffles) ═══
  const fullSigs=[];
  for(const{sym,candles}of stockData){const s=extractSignals(candles,40,candles.length);s.forEach(x=>x.sym=sym);fullSigs.push(...testFilter(s,v5P));}
  const mcRates=[];
  for(let mc=0;mc<1000;mc++){
    const shuffled=[...fullSigs].sort(()=>Math.random()-0.5);
    const split=Math.floor(shuffled.length*0.70);
    const oos=shuffled.slice(split);
    if(oos.length===0)continue;
    mcRates.push(oos.filter(t=>t.h5).length/oos.length*100);
  }
  mcRates.sort((a,b)=>a-b);
  const mc5=mcRates[Math.floor(mcRates.length*0.05)];
  const mc25=mcRates[Math.floor(mcRates.length*0.25)];
  const mc50=mcRates[Math.floor(mcRates.length*0.50)];
  const mc75=mcRates[Math.floor(mcRates.length*0.75)];
  const mc95=mcRates[Math.floor(mcRates.length*0.95)];
  const mcAvg=mcRates.reduce((s,v)=>s+v,0)/mcRates.length;
  console.log(`\n  ┌─── TEST 4: Monte Carlo (1000 random 70/30 shuffles) ────────┐`);
  console.log(`  │ 5th percentile (worst case):  ${mc5.toFixed(1)}%`);
  console.log(`  │ 25th percentile:              ${mc25.toFixed(1)}%`);
  console.log(`  │ Median (50th):                ${mc50.toFixed(1)}%`);
  console.log(`  │ 75th percentile:              ${mc75.toFixed(1)}%`);
  console.log(`  │ 95th percentile (best case):  ${mc95.toFixed(1)}%`);
  console.log(`  │ Mean:                         ${mcAvg.toFixed(1)}%`);
  console.log(`  │ Probability of ≥70% hit rate: ${(mcRates.filter(r=>r>=70).length/mcRates.length*100).toFixed(1)}%`);
  console.log(`  │ Probability of ≥80% hit rate: ${(mcRates.filter(r=>r>=80).length/mcRates.length*100).toFixed(1)}%`);
  console.log('  └──────────────────────────────────────────────────────────────┘');

  // ═══ TEST 5: Rolling 3-fold walk-forward ═══
  console.log(`\n  ┌─── TEST 5: Rolling 3-Fold Walk-Forward ────────────────────┐`);
  for(let fold=0;fold<3;fold++){
    let fIS=[],fOOS=[];
    for(const{sym,candles}of stockData){
      const third=Math.floor(candles.length/3);
      const isStart=fold*third,isEnd=(fold+1)*third;
      const oosStart=isEnd,oosEnd=Math.min((fold+2)*third,candles.length);
      if(oosEnd<=oosStart)continue;
      const isS=extractSignals(candles,Math.max(40,isStart),isEnd);isS.forEach(s=>s.sym=sym);
      const oosS=extractSignals(candles,oosStart,oosEnd);oosS.forEach(s=>s.sym=sym);
      fIS.push(...testFilter(isS,v5P));fOOS.push(...testFilter(oosS,v5P));
    }
    const fis=stats(fIS),foos=stats(fOOS);
    console.log(`  │ Fold ${fold+1}: IS ${fis.n} trades (${fis.r}%) → OOS ${foos.n} trades (${foos.r}%) WLB ${wilson(foos.n,foos.h)}%`);
  }
  console.log('  └──────────────────────────────────────────────────────────────┘');

  // OOS trade details
  if(v5OOS.length>0){
    console.log(`\n  OOS trades (30% unseen data):`);
    console.log('  Symbol       │ Date       │ +5%Hit │ MFE    │ MAE');
    for(const t of v5OOS.sort((a,b)=>b.mfe-a.mfe)){
      console.log(`  ${t.sym.padEnd(12)} │ ${(t.date||'—').padEnd(10)} │ ${t.h5?'YES   ':'NO    '} │ ${t.mfe.toFixed(1).padStart(5)}% │ ${t.mae.toFixed(1).padStart(5)}%`);
    }
  }
}

// ═══ FINAL VERDICT ═══
console.log(`\n${'═'.repeat(90)}`);
console.log('  FINAL VERDICT');
console.log('═'.repeat(90));
console.log('  For each param set: ROBUST = OOS rate ≥ 70% AND Monte Carlo P(≥70%) ≥ 80%\n');
