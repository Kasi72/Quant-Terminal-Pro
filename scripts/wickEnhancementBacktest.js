// WICK ENHANCEMENT BACKTEST — Test each proposed change on 29 OHLCV files
// Compare: current screener vs each enhancement vs all combined
// Measure: hit rate, MFE, false positive reduction, trades lost

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function pR(w,v){return w.length===0?50:(w.filter(x=>x<v).length/w.length)*100;}
function upsC(cl,uw,bp,vp,zt,zl){let s=0;if(cl>=80)s+=20;else if(cl>=65)s+=12;if(uw<=20)s+=20;else if(uw<=35)s+=12;if(bp>=55)s+=15;else if(bp>=35)s+=9;if(vp>=4)s+=20;else if(vp>=2)s+=12;if(zt<=5)s+=15;else if(zt<=15)s+=9;if(zl>=12)s+=10;else if(zl>=6)s+=6;return s;}
function cqsC(cl,uw,bp,vp,ve){let s=0;if(cl>=65)s++;if(uw<=30)s++;if(bp>=40)s++;if(vp>=2.5)s++;if(ve>=1.5)s++;return s;}
function wilson(n,h){if(n<2)return 0;const p=h/n,z=1.96;return(p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n)*100;}

// Collect ALL breakouts with full wick data + v5-WLB param set membership
const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);
  for(let i=40;i<c.length-11;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
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
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL,zt:zLo>0?((zH-zLo)/zLo)*100:99};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const caz=bZ.zH>0?((s.c-bZ.zH)/bZ.zH)*100:0;
    const uV=upsC(cl,uw,bp,vP,bZ.zt,bZ.len);const cV=cqsC(cl,uw,bp,vP,vE);

    // Wick data
    const body=Math.abs(s.c-s.o);
    const upperWick=s.h-Math.max(s.o,s.c);
    const lowerWick=Math.min(s.o,s.c)-s.l;
    const lwPct=lowerWick/r*100;
    const uwToBody=body>0?upperWick/body:99;
    const lwToBody=body>0?lowerWick/body:99;
    const closeToHigh=(s.h-s.c)/s.c*100;
    const uwATR=a[i]>0?upperWick/a[i]:0;
    // Prior day wick
    const prev=c[i-1];const pRange=prev.h-prev.l;
    const pUwPct=pRange>0?(prev.h-Math.max(prev.o,prev.c))/pRange*100:0;
    const pLwPct=pRange>0?(Math.min(prev.o,prev.c)-prev.l)/pRange*100:0;
    const isGreen=s.c>s.o;

    // V5-WLB D20+ param check (as representative)
    const passD20=to>=1e7&&apctl<=85&&p10A<=1.0&&p10E<=1&&bZ.len>=6&&bZ.len<=20&&bZ.zt<=15&&p10V<=0.9&&p5V<=0.95&&rvb<=2.0&&ra>=1&&ra<=5&&vR>=1.0&&vP>=2.0&&cl>=65&&uw<=35&&bp>=35&&sr<=8.5&&uV>=60&&s.rsi2>=50&&vE>=1.75&&cV>=3;

    let mfe=0,mae=0,h5=false,d5=99;
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const pH=(c[d].h-s.c)/s.c*100,pL=(c[d].l-s.c)/s.c*100;
      if(pH>mfe)mfe=pH;if(pL<mae)mae=pL;if(!h5&&pH>=5){h5=true;d5=d-i;}
    }
    ALL.push({sym,date:s.date,uw,lwPct,bp,cl,ra,vR,vP,vE,sr,uV,cV,uwToBody,lwToBody,closeToHigh,uwATR,pUwPct,pLwPct,isGreen,mfe,mae,h5,d5,passD20,
      to,apctl,p10A,p10E,zLen:bZ.len,zt:bZ.zt,p10V,p5V,rvb,rsi2:50,caz});
  }
}
console.log(`Total breakouts: ${ALL.length} | Winners: ${ALL.filter(s=>s.h5).length}\n`);

// Current D20+ v5-WLB baseline (no wick changes)
const baseD20=ALL.filter(s=>s.passD20);
const baseHits=baseD20.filter(s=>s.h5).length;
const baseRate=baseD20.length>0?baseHits/baseD20.length*100:0;
const baseWLB=wilson(baseD20.length,baseHits);

console.log('█'.repeat(85));
console.log('  WICK ENHANCEMENT BACKTEST — Each change tested individually');
console.log('█'.repeat(85));
console.log(`\n  D20+ v5-WLB BASELINE: ${baseD20.length} trades, ${baseHits} hits, ${baseRate.toFixed(1)}%, WLB ${baseWLB.toFixed(1)}%\n`);

// Test each enhancement on top of D20+ params
const enhancements = [
  // Wick tightening
  {name:'E1: Tighten UW ≤30% (from 35%)', test:s=>s.uw<=30},
  {name:'E2: Tighten UW ≤25%', test:s=>s.uw<=25},
  {name:'E3: Tighten UW ≤20%', test:s=>s.uw<=20},
  {name:'E4: Tighten UW ≤15%', test:s=>s.uw<=15},
  // UW/Body ratio
  {name:'E5: Add UW/Body ≤1.0', test:s=>s.uwToBody<=1.0},
  {name:'E6: Add UW/Body ≤0.75', test:s=>s.uwToBody<=0.75},
  {name:'E7: Add UW/Body ≤0.5', test:s=>s.uwToBody<=0.5},
  // Lower wick cap
  {name:'E8: Add LW ≤30%', test:s=>s.lwPct<=30},
  {name:'E9: Add LW ≤25%', test:s=>s.lwPct<=25},
  {name:'E10: Add LW ≤20%', test:s=>s.lwPct<=20},
  // Body minimum raise
  {name:'E11: Raise body ≥40% (from 35%)', test:s=>s.bp>=40},
  {name:'E12: Raise body ≥45%', test:s=>s.bp>=45},
  {name:'E13: Raise body ≥50%', test:s=>s.bp>=50},
  // Close location
  {name:'E14: Raise closeLoc ≥70% (from 65%)', test:s=>s.cl>=70},
  {name:'E15: Raise closeLoc ≥75%', test:s=>s.cl>=75},
  // UW ATR filter
  {name:'E16: Add UW ATR ≤0.3', test:s=>s.uwATR<=0.3},
  {name:'E17: Add UW ATR ≤0.2', test:s=>s.uwATR<=0.2},
  // Green candle requirement
  {name:'E18: Require green candle', test:s=>s.isGreen},
  // Close-to-high (the counterintuitive one)
  {name:'E19: CloseToHigh ≥0.5% (NOT at very top)', test:s=>s.closeToHigh>=0.5},
  {name:'E20: CloseToHigh ≥1.0%', test:s=>s.closeToHigh>=1.0},
];

console.log('  Enhancement                              │ Trades │ Hits │ HitRate │  WLB  │ΔTrades│ΔRate │ΔHits │ Verdict');
console.log('  ─────────────────────────────────────────┼────────┼──────┼─────────┼───────┼───────┼──────┼──────┼────────');
const results=[];
for(const e of enhancements){
  const filtered=baseD20.filter(e.test);
  const hits=filtered.filter(s=>s.h5).length;
  const rate=filtered.length>0?hits/filtered.length*100:0;
  const wlb=wilson(filtered.length,hits);
  const dTrades=filtered.length-baseD20.length;
  const dRate=rate-baseRate;
  const dHits=hits-baseHits;
  const verdict=wlb>baseWLB&&dHits>=0?'BETTER':wlb>=baseWLB-2?'NEUTRAL':'WORSE';
  results.push({...e,trades:filtered.length,hits,rate,wlb,dTrades,dRate,dHits,verdict});
  console.log(`  ${e.name.padEnd(41)} │ ${String(filtered.length).padStart(6)} │ ${String(hits).padStart(4)} │ ${rate.toFixed(1).padStart(6)}% │${wlb.toFixed(1).padStart(6)}% │${String(dTrades).padStart(6)} │${(dRate>=0?'+':'')+dRate.toFixed(1).padStart(5)}%│${String(dHits).padStart(5)} │ ${verdict}`);
}

// Find the best combinations
console.log('\n' + '█'.repeat(85));
console.log('  COMBINATION TESTING — Stack the best individual enhancements');
console.log('█'.repeat(85));

const combos = [
  {name:'C1: UW≤30% + LW≤30%', test:s=>s.uw<=30&&s.lwPct<=30},
  {name:'C2: UW≤25% + LW≤25%', test:s=>s.uw<=25&&s.lwPct<=25},
  {name:'C3: UW/Body≤0.75 + LW≤30%', test:s=>s.uwToBody<=0.75&&s.lwPct<=30},
  {name:'C4: UW≤30% + body≥40%', test:s=>s.uw<=30&&s.bp>=40},
  {name:'C5: UW≤25% + body≥45% + LW≤25%', test:s=>s.uw<=25&&s.bp>=45&&s.lwPct<=25},
  {name:'C6: UW/Body≤1.0 + body≥40% + LW≤30%', test:s=>s.uwToBody<=1.0&&s.bp>=40&&s.lwPct<=30},
  {name:'C7: UW≤30% + closeLoc≥70%', test:s=>s.uw<=30&&s.cl>=70},
  {name:'C8: UW≤25% + closeLoc≥70% + body≥40%', test:s=>s.uw<=25&&s.cl>=70&&s.bp>=40},
  {name:'C9: green + UW≤25% + body≥45%', test:s=>s.isGreen&&s.uw<=25&&s.bp>=45},
  {name:'C10: UW/Body≤0.75 + closeLoc≥70% + LW≤25%', test:s=>s.uwToBody<=0.75&&s.cl>=70&&s.lwPct<=25},
  {name:'C11: CloseToHigh≥0.5% + UW≤30% + body≥40%', test:s=>s.closeToHigh>=0.5&&s.uw<=30&&s.bp>=40},
  {name:'C12: CloseToHigh≥1% + body≥45%', test:s=>s.closeToHigh>=1.0&&s.bp>=45},
];

console.log(`\n  Baseline: ${baseD20.length} trades, ${baseHits} hits, ${baseRate.toFixed(1)}%, WLB ${baseWLB.toFixed(1)}%\n`);
console.log('  Combination                                    │ Trades │ Hits │ HitRate │  WLB  │ΔRate │ Verdict');
console.log('  ───────────────────────────────────────────────┼────────┼──────┼─────────┼───────┼──────┼────────');
for(const c of combos){
  const filtered=baseD20.filter(c.test);
  const hits=filtered.filter(s=>s.h5).length;
  const rate=filtered.length>0?hits/filtered.length*100:0;
  const wlb=wilson(filtered.length,hits);
  const dRate=rate-baseRate;
  const verdict=wlb>baseWLB?'★ BETTER':wlb>=baseWLB-3?'NEUTRAL':'WORSE';
  console.log(`  ${c.name.padEnd(47)} │ ${String(filtered.length).padStart(6)} │ ${String(hits).padStart(4)} │ ${rate.toFixed(1).padStart(6)}% │${wlb.toFixed(1).padStart(6)}% │${(dRate>=0?'+':'')+dRate.toFixed(1).padStart(5)}%│ ${verdict}`);
}

// Now test on ALL 4 param sets (not just D20+)
console.log('\n' + '█'.repeat(85));
console.log('  CROSS-PARAM-SET VALIDATION — Best combos on all 4 param sets');
console.log('█'.repeat(85));

const PARAMS={
  D20:{name:'D20+',maxPRR:1.0,maxEC:1,maxZT:15,maxPV:0.9,maxP5V:0.95,maxRVB:2.0,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:60,minVE:1.75,minCQS:3,maxAP:85,minTO:1e7},
  HP15:{name:'HP15+',maxPRR:1.0,maxEC:1,maxZT:15,maxPV:0.85,maxP5V:1.1,maxRVB:2.0,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:13,minUPS:50,minVE:null,minCQS:null,maxAP:85,minTO:1e7,maxCAZ:6},
  E10:{name:'E10+',maxPRR:0.95,maxEC:5,maxZT:15,maxPV:0.9,maxP5V:1.0,maxRVB:2.0,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:45,minVE:1.25,minCQS:3,maxAP:60,minTO:2e7,minZL:8,maxZL:15},
  US8:{name:'US8+',maxPRR:1.0,maxEC:1,maxZT:15,maxPV:0.9,maxP5V:0.95,maxRVB:2.0,minVR:1.2,minVP5:2.0,minCL:65,maxUW:40,minBP:25,maxSR:8.5,minUPS:45,minVE:1.5,minCQS:null,maxAP:95,minTO:1e7},
};

function testParam(s,p){
  if(s.to<p.minTO)return false;if(s.apctl>p.maxAP)return false;if(s.p10A>p.maxPRR)return false;
  if(s.p10E>p.maxEC)return false;if(p.minZL&&s.zLen<p.minZL)return false;if(p.maxZL&&s.zLen>p.maxZL)return false;
  if(s.zt>p.maxZT)return false;if(s.p10V>p.maxPV)return false;if(s.p5V>p.maxP5V)return false;
  if(s.rvb>p.maxRVB)return false;if(s.ra<1||s.ra>(p.maxRA||5))return false;
  if(s.vR<p.minVR)return false;if(s.vP<p.minVP5)return false;if(s.cl<p.minCL)return false;
  if(s.uw>p.maxUW)return false;if(s.bp<p.minBP)return false;if(s.sr>p.maxSR)return false;
  if(s.uV<p.minUPS)return false;
  if(p.minVE!==null&&s.vE<p.minVE)return false;if(p.minCQS!==null&&s.cV<p.minCQS)return false;
  if(p.maxCAZ!==null&&s.caz>p.maxCAZ)return false;return true;
}

// Test top 3 combos on all 4 param sets
const topCombos=[
  {name:'Current (no wick change)',test:()=>true},
  {name:'C4: UW≤30% + body≥40%',test:s=>s.uw<=30&&s.bp>=40},
  {name:'C7: UW≤30% + closeLoc≥70%',test:s=>s.uw<=30&&s.cl>=70},
  {name:'C6: UW/Body≤1.0 + body≥40% + LW≤30%',test:s=>s.uwToBody<=1.0&&s.bp>=40&&s.lwPct<=30},
  {name:'C11: CloseToHigh≥0.5% + UW≤30% + body≥40%',test:s=>s.closeToHigh>=0.5&&s.uw<=30&&s.bp>=40},
];

for(const[key,p]of Object.entries(PARAMS)){
  const base=ALL.filter(s=>testParam(s,p));
  const bH=base.filter(s=>s.h5).length;
  console.log(`\n  ${p.name}: baseline ${base.length} trades, ${bH} hits (${(bH/base.length*100).toFixed(1)}%), WLB ${wilson(base.length,bH).toFixed(1)}%`);
  for(const tc of topCombos){
    const filtered=base.filter(tc.test);
    const hits=filtered.filter(s=>s.h5).length;
    const rate=filtered.length>0?hits/filtered.length*100:0;
    const wlb=wilson(filtered.length,hits);
    console.log(`    ${tc.name.padEnd(48)} │ ${String(filtered.length).padStart(4)} trades │ ${String(hits).padStart(3)} hits │ ${rate.toFixed(1).padStart(5)}% │ WLB ${wlb.toFixed(1)}%`);
  }
}

// Walk-forward on best combo
console.log('\n' + '█'.repeat(85));
console.log('  WALK-FORWARD VALIDATION (70/30)');
console.log('█'.repeat(85));
const sorted=[...ALL].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const sp=Math.floor(sorted.length*0.70);
const IS=sorted.slice(0,sp),OOS=sorted.slice(sp);
for(const tc of topCombos){
  const isBase=IS.filter(s=>testParam(s,PARAMS.D20)).filter(tc.test);
  const oosBase=OOS.filter(s=>testParam(s,PARAMS.D20)).filter(tc.test);
  const isH=isBase.filter(s=>s.h5).length,oosH=oosBase.filter(s=>s.h5).length;
  console.log(`\n  ${tc.name}`);
  console.log(`    IS:  ${isBase.length} trades, ${isH} hits (${(isBase.length>0?isH/isBase.length*100:0).toFixed(1)}%) WLB ${wilson(isBase.length,isH).toFixed(1)}%`);
  console.log(`    OOS: ${oosBase.length} trades, ${oosH} hits (${(oosBase.length>0?oosH/oosBase.length*100:0).toFixed(1)}%) WLB ${wilson(oosBase.length,oosH).toFixed(1)}%`);
}
