// ORIGINAL v4 PARAMS vs CURRENT v8-DT PARAMS — Head-to-head backtest on 78 OHLCVs
// Uses latest engine: CLOSE-ONLY stop [3%,7%], no descending zones

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];
function pY(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6||isNaN(+p[4])||+p[4]<=0)continue;c.push({o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]});}return c;}
function pN(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<11||isNaN(+p[8])||+p[8]<=0)continue;c.push({o:+p[4],h:+p[5],l:+p[6],c:+p[8],v:+p[10]||0});}return c;}
function a14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function r2(c){const r=new Array(c.length).fill(50);for(let i=3;i<c.length;i++){let g=0,l=0;for(let j=i-1;j<=i;j++){const d=c[j].c-c[j-1].c;if(d>0)g+=d;else l-=d;}r[i]=l===0?100:100-100/(1+g/2/(l/2));}return r;}

const SD=[];
for(const{dir,format}of DIRS){if(!fs.existsSync(dir))continue;for(const f of fs.readdirSync(dir)){if(!f.endsWith('.csv')||f.includes('ALL_SYMBOLS'))continue;const c=format==='nse'?pN(path.join(dir,f)):pY(path.join(dir,f));if(c.length<80)continue;SD.push({sym:f.replace('_NS_OHLCV.csv','').replace('.csv',''),c,a:a14(c),rsi:r2(c)});}}

function sim(P, label) {
  let sigs=0,wins=0,stops=0,t1h=0,t2h=0,t3h=0,totalPnl=0,totalMfe=0,totalMae=0,falseSt=0,expired=0;
  for(const{sym,c,a,rsi}of SD){const n=c.length;
  for(let i=30;i<n-11;i++){
    if(a[i]<=0||c[i].c<=0)continue;const s=c[i],rng=s.h-s.l;if(rng<=0)continue;
    const eRA=rng/a[i],cL=(s.c-s.l)/rng*100,uW=(s.h-Math.max(s.c,s.o))/rng*100,bP=Math.abs(s.c-s.o)/rng*100;
    const sigRangePct = rng/s.c*100;
    let v20=0;for(let j=i-20;j<i;j++){if(j>=0)v20+=c[j].v;}v20/=20;
    let v5=0;for(let j=i-5;j<i;j++){if(j>=0)v5+=c[j].v;}v5/=5;
    const eVR=v20>0?s.v/v20:0,eVP5=v5>0?s.v/v5:0;
    let p10R=0,p10E=0,p10VR=0,p10HVC=0,p10RVB=0,p5VR=0;
    for(let j=i-10;j<i;j++){if(j<1)continue;
      const rA=(c[j].h-c[j].l)/(a[j]||1);p10R+=rA;if(rA>P.expATRMult)p10E++;
      const vr=v20>0?c[j].v/v20:0;p10VR+=vr;if(vr>P.highVolMult)p10HVC++;
      if(c[j].c<c[j].o)p10RVB+=c[j].v/(v20||1);
    }
    p10R/=10;p10VR/=10;p10RVB/=10;
    for(let j=i-5;j<i;j++){if(j<1)continue;p5VR+=(v20>0?c[j].v/v20:0);}p5VR/=5;

    // Volatility expansion ratio
    const volExpRatio = p10R > 0 ? eRA / p10R : 0;

    let zone=null;
    for(let zL=P.maxZone;zL>=P.minZone;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;
      for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>P.zoneRangeATR)ok=false;}
      if(!ok)continue;const t=zLo>0?(zH-zLo)/zLo*100:999;if(t>P.maxTightness)continue;
      // Descending zone rejection
      const mid=Math.floor(zL/2);let fhH=-Infinity,shH=-Infinity,fhL=Infinity,shL=Infinity;
      for(let j=zS;j<zS+mid;j++){fhH=Math.max(fhH,c[j].h);fhL=Math.min(fhL,c[j].l);}
      for(let j=zS+mid;j<i;j++){shH=Math.max(shH,c[j].h);shL=Math.min(shL,c[j].l);}
      if(shH<fhH*0.995&&shL<=fhL*1.005)continue;
      zone={zH,zL:zLo,len:zL,t};break;}
    if(!zone||s.c<=zone.zH*1.001)continue;

    // closeAboveZonePct check
    if (P.maxCloseAboveZone != null) {
      const cabp = zone.zH > 0 ? (s.c - zone.zH) / zone.zH * 100 : 0;
      if (cabp > P.maxCloseAboveZone) continue;
    }

    let ups=0;if(cL>=80)ups+=20;else if(cL>=65)ups+=12;if(uW<=20)ups+=20;else if(uW<=35)ups+=12;
    if(bP>=55)ups+=15;else if(bP>=35)ups+=9;if(eVP5>=4)ups+=20;else if(eVP5>=2)ups+=12;
    if(zone.t<=5)ups+=15;else if(zone.t<=15)ups+=9;if(zone.len>=12)ups+=10;else if(zone.len>=6)ups+=6;
    let cq=0;if(cL>=65)cq++;if(uW<=30)cq++;if(bP>=40)cq++;if(eVP5>=2.5)cq++;if(eRA>=1.5)cq++;

    // Apply all filters
    if(eRA<P.minExactRangeATR||eRA>P.maxExactRangeATR)continue;
    if(eVR<P.minExactVolRatio)continue;
    if(eVP5<P.minExactVolVsPre5)continue;
    if(cL<P.minCloseLoc)continue;
    if(uW>P.maxUpperWick)continue;
    if(bP<P.minBody)continue;
    if(p10R>P.maxPre10AvgRangeATR)continue;
    if(p10E>P.maxExpansionCount)continue;
    if(rsi[i]<P.minRSI2)continue;
    if(P.rsi2Max!=null&&rsi[i]>P.rsi2Max)continue;
    if(ups<P.minUPS)continue;
    if(P.minCandleQuality!=null&&cq<P.minCandleQuality)continue;
    if(P.maxSignalRange!=null&&sigRangePct>P.maxSignalRange)continue;
    if(P.minVolExpRatio!=null&&volExpRatio<P.minVolExpRatio)continue;
    if(P.maxPre10AvgVolRatio!=null&&p10VR>P.maxPre10AvgVolRatio)continue;
    if(P.maxPre5AvgVolRatio!=null&&p5VR>P.maxPre5AvgVolRatio)continue;
    if(P.maxPre10HighVolCount!=null&&p10HVC>P.maxPre10HighVolCount)continue;
    if(P.maxPre10RedVolBias!=null&&p10RVB>P.maxPre10RedVolBias)continue;

    // CLOSE-ONLY stop [3%,7%]
    const rawSt=zone.zL-0.5*a[i],stPct=Math.max(3,Math.min(7,(s.c-rawSt)/s.c*100)),stP=s.c*(1-stPct/100);
    const aP=a[i]/s.c*100,t1P=Math.max(3,Math.min(6,2.5*aP)),t2P=Math.min(5.65,2.80*aP);
    const t3P=aP<1.5?5:aP<=3?7:10;
    let mfe=0,mae=0,out='exp',hT1=false,hT2=false,hT3=false;
    for(let d=1;d<=10&&i+d<n;d++){const cd=c[i+d];const hp=(cd.h-s.c)/s.c*100,lp=(cd.l-s.c)/s.c*100;
      if(hp>mfe)mfe=hp;if(lp<mae)mae=lp;
      if(cd.c<=stP&&!hT1){out='stop';break;}
      if(cd.h>=s.c*(1+t1P/100))hT1=true;if(cd.h>=s.c*(1+t2P/100))hT2=true;if(cd.h>=s.c*(1+t3P/100))hT3=true;}
    if(out!=='stop'){out=hT1?'hit':'exp';}
    sigs++;totalMfe+=mfe;totalMae+=mae;
    if(out==='hit'){wins++;totalPnl+=t1P;}else if(out==='stop'){stops++;totalPnl-=stPct;if(mfe>=3)falseSt++;}
    else{expired++;totalPnl+=(c[Math.min(i+10,n-1)].c-s.c)/s.c*100;}
    if(hT1)t1h++;if(hT2)t2h++;if(hT3)t3h++;
  }}
  if(sigs===0)return{label,sigs:0,wr:0,pf:0,exp:0,t1r:0,t2r:0,t3r:0,mfe:0,mae:0,fs:0,avgPnl:0};
  const wr=wins/sigs*100;
  const avgW=wins>0?Math.abs(totalPnl>0?totalPnl/wins:3):0;
  const avgL=stops>0?3.5:0;
  const grossW=wins*avgW,grossL=stops*avgL;
  const pf=grossL>0?grossW/grossL:wins>0?99:0;
  const exp=(wr/100)*avgW-(1-wr/100)*avgL;
  return{label,sigs,wins,stops,expired,wr,pf,exp,t1r:t1h/sigs*100,t2r:t2h/sigs*100,t3r:t3h/sigs*100,mfe:totalMfe/sigs,mae:totalMae/sigs,fs:stops>0?falseSt/stops*100:0,avgPnl:totalPnl/sigs};
}

// ═══ ORIGINAL v4 PARAM SETS ═══
const ORIG_D20 = {minZone:6,maxZone:20,zoneRangeATR:1.0,maxTightness:15,maxPre10AvgRangeATR:0.75,maxExpansionCount:2,expATRMult:1.1,minExactRangeATR:1.0,maxExactRangeATR:5.0,minExactVolRatio:1.0,minExactVolVsPre5:2.0,minCloseLoc:65,maxUpperWick:35,minBody:35,minRSI2:50,rsi2Max:null,minUPS:60,minCandleQuality:3,maxSignalRange:8.5,minVolExpRatio:1.50,maxPre10AvgVolRatio:0.90,maxPre5AvgVolRatio:1.00,maxPre10HighVolCount:4,highVolMult:1.35,maxPre10RedVolBias:1.10,maxCloseAboveZone:null};

const ORIG_HP15 = {minZone:6,maxZone:25,zoneRangeATR:1.0,maxTightness:15,maxPre10AvgRangeATR:0.75,maxExpansionCount:0,expATRMult:1.1,minExactRangeATR:1.0,maxExactRangeATR:5.0,minExactVolRatio:1.1,minExactVolVsPre5:2.0,minCloseLoc:65,maxUpperWick:35,minBody:25,minRSI2:50,rsi2Max:null,minUPS:45,minCandleQuality:null,maxSignalRange:11.0,minVolExpRatio:null,maxPre10AvgVolRatio:0.90,maxPre5AvgVolRatio:1.10,maxPre10HighVolCount:4,highVolMult:1.35,maxPre10RedVolBias:1.10,maxCloseAboveZone:8.0};

const ORIG_E10 = {minZone:8,maxZone:15,zoneRangeATR:1.0,maxTightness:12,maxPre10AvgRangeATR:0.95,maxExpansionCount:4,expATRMult:1.1,minExactRangeATR:1.0,maxExactRangeATR:6.0,minExactVolRatio:1.0,minExactVolVsPre5:3.0,minCloseLoc:65,maxUpperWick:35,minBody:35,minRSI2:50,rsi2Max:null,minUPS:45,minCandleQuality:3,maxSignalRange:8.5,minVolExpRatio:1.10,maxPre10AvgVolRatio:0.85,maxPre5AvgVolRatio:0.90,maxPre10HighVolCount:2,highVolMult:1.2,maxPre10RedVolBias:1.20,maxCloseAboveZone:null};

const ORIG_US8 = {minZone:6,maxZone:15,zoneRangeATR:1.0,maxTightness:8,maxPre10AvgRangeATR:0.75,maxExpansionCount:0,expATRMult:1.1,minExactRangeATR:1.0,maxExactRangeATR:6.0,minExactVolRatio:1.2,minExactVolVsPre5:2.0,minCloseLoc:65,maxUpperWick:40,minBody:25,minRSI2:55,rsi2Max:null,minUPS:45,minCandleQuality:null,maxSignalRange:8.5,minVolExpRatio:1.50,maxPre10AvgVolRatio:0.85,maxPre5AvgVolRatio:1.10,maxPre10HighVolCount:4,highVolMult:1.5,maxPre10RedVolBias:1.10,maxCloseAboveZone:null};

// ═══ CURRENT v8-DT PARAM SETS (as in stockEngine.ts) ═══
const CUR_D20 = {minZone:6,maxZone:25,zoneRangeATR:1.0,maxTightness:18,maxPre10AvgRangeATR:0.80,maxExpansionCount:1,expATRMult:1.1,minExactRangeATR:1.1,maxExactRangeATR:5.0,minExactVolRatio:0.80,minExactVolVsPre5:2.0,minCloseLoc:75,maxUpperWick:45,minBody:25,minRSI2:50,rsi2Max:null,minUPS:60,minCandleQuality:2,maxSignalRange:8.5,minVolExpRatio:1.75,maxPre10AvgVolRatio:0.90,maxPre5AvgVolRatio:0.95,maxPre10HighVolCount:4,highVolMult:1.35,maxPre10RedVolBias:null,maxCloseAboveZone:null};

const CUR_HP15 = {minZone:4,maxZone:25,zoneRangeATR:1.0,maxTightness:18,maxPre10AvgRangeATR:0.80,maxExpansionCount:3,expATRMult:1.1,minExactRangeATR:1.1,maxExactRangeATR:5.0,minExactVolRatio:0.80,minExactVolVsPre5:2.0,minCloseLoc:50,maxUpperWick:40,minBody:30,minRSI2:50,rsi2Max:null,minUPS:50,minCandleQuality:null,maxSignalRange:13.0,minVolExpRatio:null,maxPre10AvgVolRatio:0.85,maxPre5AvgVolRatio:1.10,maxPre10HighVolCount:4,highVolMult:1.35,maxPre10RedVolBias:null,maxCloseAboveZone:6.0};

const CUR_E10 = {minZone:6,maxZone:25,zoneRangeATR:0.95,maxTightness:18,maxPre10AvgRangeATR:0.80,maxExpansionCount:3,expATRMult:1.1,minExactRangeATR:1.5,maxExactRangeATR:6.0,minExactVolRatio:1.60,minExactVolVsPre5:2.0,minCloseLoc:75,maxUpperWick:35,minBody:25,minRSI2:50,rsi2Max:null,minUPS:25,minCandleQuality:2,maxSignalRange:8.5,minVolExpRatio:1.25,maxPre10AvgVolRatio:0.90,maxPre5AvgVolRatio:1.00,maxPre10HighVolCount:2,highVolMult:1.2,maxPre10RedVolBias:null,maxCloseAboveZone:null};

const CUR_US8 = {minZone:8,maxZone:25,zoneRangeATR:0.95,maxTightness:6,maxPre10AvgRangeATR:0.80,maxExpansionCount:0,expATRMult:1.1,minExactRangeATR:1.4,maxExactRangeATR:6.0,minExactVolRatio:1.60,minExactVolVsPre5:3.50,minCloseLoc:70,maxUpperWick:30,minBody:40,minRSI2:50,rsi2Max:null,minUPS:45,minCandleQuality:4,maxSignalRange:8.5,minVolExpRatio:1.50,maxPre10AvgVolRatio:0.90,maxPre5AvgVolRatio:0.95,maxPre10HighVolCount:4,highVolMult:1.5,maxPre10RedVolBias:null,maxCloseAboveZone:null};

console.log('█'.repeat(90));
console.log(`  ORIGINAL v4 vs CURRENT v8-DT — Head-to-Head on ${SD.length} OHLCVs`);
console.log('█'.repeat(90));

// Run all
const results = [
  sim(ORIG_D20, 'D20+ Original v4'),
  sim(CUR_D20, 'D20+ Current v8-DT'),
  sim(ORIG_HP15, 'HP15+ Original v4'),
  sim(CUR_HP15, 'HP15+ Current v7-UT'),
  sim(ORIG_E10, 'E10+ Original v4'),
  sim(CUR_E10, 'E10+ Current v8-DT'),
  sim(ORIG_US8, 'US8+ Original v4'),
  sim(CUR_US8, 'US8+ Current v8-DT'),
];

console.log('\n═══ FULL COMPARISON TABLE ═══\n');
console.log('  Param Set              │ Sigs │ Wins │ Stops │ Exp  │ WR    │ PF    │ T1Hit │ T2Hit │ T3Hit │ MFE    │ MAE    │ FS%  │ Expect │ AvgPnL');
console.log('  ───────────────────────┼──────┼──────┼───────┼──────┼───────┼───────┼───────┼───────┼───────┼────────┼────────┼──────┼────────┼───────');
for (const r of results) {
  console.log(`  ${r.label.padEnd(22)} │ ${String(r.sigs).padStart(4)} │ ${String(r.wins).padStart(4)} │ ${String(r.stops).padStart(5)} │ ${String(r.expired).padStart(4)} │ ${r.wr.toFixed(1).padStart(4)}% │ ${r.pf.toFixed(2).padStart(5)} │ ${r.t1r.toFixed(0).padStart(4)}% │ ${r.t2r.toFixed(0).padStart(4)}% │ ${r.t3r.toFixed(0).padStart(4)}% │ ${('+'+r.mfe.toFixed(1)).padStart(6)} │ ${r.mae.toFixed(1).padStart(6)} │ ${r.fs.toFixed(0).padStart(3)}% │ ${(r.exp>=0?'+':'')+r.exp.toFixed(2).padStart(5)} │ ${(r.avgPnl>=0?'+':'')+r.avgPnl.toFixed(2)}`);
}

// Side-by-side per set
console.log('\n═══ DELTA ANALYSIS (Current - Original) ═══\n');
console.log('  Set   │ ΔSignals │ ΔWinRate │ ΔPF     │ ΔT1Hit  │ ΔMFE    │ ΔFalseStop │ ΔExpectancy');
console.log('  ──────┼──────────┼──────────┼─────────┼─────────┼─────────┼────────────┼───────────');
for (let i = 0; i < results.length; i += 2) {
  const orig = results[i], cur = results[i + 1];
  const name = orig.label.split(' ')[0];
  const ds = cur.sigs - orig.sigs;
  const dw = cur.wr - orig.wr;
  const dp = cur.pf - orig.pf;
  const dt = cur.t1r - orig.t1r;
  const dm = cur.mfe - orig.mfe;
  const df = cur.fs - orig.fs;
  const de = cur.exp - orig.exp;
  console.log(`  ${name.padEnd(5)} │ ${(ds>=0?'+':'')+ds} │ ${(dw>=0?'+':'')+dw.toFixed(1)+'%'} │ ${(dp>=0?'+':'')+dp.toFixed(2)} │ ${(dt>=0?'+':'')+dt.toFixed(0)+'%'} │ ${(dm>=0?'+':'')+dm.toFixed(1)} │ ${(df>=0?'+':'')+df.toFixed(0)+'%'} │ ${(de>=0?'+':'')+de.toFixed(2)}`);
}

console.log('\n═══ KEY PARAMETER DIFFERENCES ═══\n');
const paramDiffs = [
  ['D20+', ORIG_D20, CUR_D20],
  ['HP15+', ORIG_HP15, CUR_HP15],
  ['E10+', ORIG_E10, CUR_E10],
  ['US8+', ORIG_US8, CUR_US8],
];
for (const [name, orig, cur] of paramDiffs) {
  console.log(`  ${name}:`);
  const keys = new Set([...Object.keys(orig), ...Object.keys(cur)]);
  for (const k of keys) {
    if (orig[k] !== cur[k]) {
      console.log(`    ${k.padEnd(26)} ${String(orig[k]).padStart(6)} → ${String(cur[k]).padStart(6)}`);
    }
  }
  console.log('');
}

console.log('█'.repeat(90));
console.log('  BACKTEST COMPLETE');
console.log('█'.repeat(90));
