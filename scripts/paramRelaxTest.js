// Parameter Relaxation Test — which conditions can be loosened to get MORE trades?
const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/drkkr/Downloads/Portfolio';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv') && !f.includes('(1)'));

function parseCSV(fp){const lines=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<lines.length;i++){const[date,o,h,l,cl,v]=lines[i].split(',');const[d,m,y]=date.split('-');const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,months[m],+d).getTime()/1000,o:+o,h:+h,l:+l,c:+cl,v:+v,date});}return c;}
function computeATR14(candles){const a=new Array(candles.length).fill(0);if(candles.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));a[14]=s/14;for(let i=15;i<candles.length;i++){const tr=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));a[i]=(a[i-1]*13+tr)/14;}return a;}
function computeRSI2(candles){const r=new Array(candles.length).fill(50);if(candles.length<4)return r;let aG=0,aL=0;for(let i=1;i<=2;i++){const ch=candles[i].c-candles[i-1].c;if(ch>0)aG+=ch;else aL+=Math.abs(ch);}aG/=2;aL/=2;for(let i=3;i<candles.length;i++){const ch=candles[i].c-candles[i-1].c;aG=(aG+Math.max(ch,0))/2;aL=(aL+Math.max(-ch,0))/2;r[i]=aL<0.0001?100:100-100/(1+aG/aL);}return r;}
function pctRank(w,v){return w.length===0?50:(w.filter(x=>x<v).length/w.length)*100;}
function ups(cl,uw,bp,vp5,zt,zl){let s=0;if(cl>=80)s+=20;else if(cl>=65)s+=12;if(uw<=20)s+=20;else if(uw<=35)s+=12;if(bp>=55)s+=15;else if(bp>=35)s+=9;if(vp5>=4)s+=20;else if(vp5>=2)s+=12;if(zt<=5)s+=15;else if(zt<=15)s+=9;if(zl>=12)s+=10;else if(zl>=6)s+=6;return s;}
function cqs(cl,uw,bp,vp5,ve){let s=0;if(cl>=65)s++;if(uw<=30)s++;if(bp>=40)s++;if(vp5>=2.5)s++;if(ve>=1.5)s++;return s;}

// Collect ALL breakout candles with features (before param filtering)
const allSignals = [];
for(const file of files){
  const candles=parseCSV(path.join(DIR,file));if(candles.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),atr=computeATR14(candles),rsi2=computeRSI2(candles);
  for(let i=40;i<candles.length-11;i++){
    const sig=candles[i];if(sig.c<=0||atr[i]<=0)continue;const r=sig.h-sig.l;if(r<=0)continue;
    const atrPct=(atr[i]/sig.c)*100;const w120=[];for(let j=Math.max(14,i-121);j<i;j++){if(candles[j].c>0&&atr[j]>0)w120.push((atr[j]/candles[j].c)*100);}
    const atrPctl=pctRank(w120,atrPct);const ra=r/atr[i],cl=(sig.c-sig.l)/r*100,bp=Math.abs(sig.c-sig.o)/r*100,uw=(sig.h-Math.max(sig.o,sig.c))/r*100,sr=(r/sig.c)*100;
    let tS=0;for(let j=Math.max(0,i-20);j<i;j++)tS+=candles[j].c*candles[j].v;const avgTO=tS/Math.max(i-Math.max(0,i-20),1);
    let p10RS=0,p10C=0,p10EC=0;for(let j=i-10;j<i;j++){if(j<1)continue;const tr=Math.max(candles[j].h-candles[j].l,Math.abs(candles[j].h-candles[j-1].c),Math.abs(candles[j].l-candles[j-1].c));const ra2=tr/atr[j];p10RS+=ra2;p10C++;if(ra2>1.1)p10EC++;}
    const p10ARR=p10C>0?p10RS/p10C:1;const vER=p10ARR>0?ra/p10ARR:1;
    let v20S=0;for(let j=Math.max(0,i-20);j<i;j++)v20S+=candles[j].v;const vA20=v20S/Math.max(i-Math.max(0,i-20),1);const vR20=vA20>0?sig.v/vA20:0;
    let v5S=0;for(let j=Math.max(0,i-5);j<i;j++)v5S+=candles[j].v;const vA5=v5S/Math.max(i-Math.max(0,i-5),1);const vP5=vA5>0?sig.v/vA5:0;
    let p10VRS=0,p10VC=0;for(let j=i-10;j<i;j++){if(j<0)continue;p10VRS+=(vA20>0?candles[j].v/vA20:0);p10VC++;}const p10AVR=p10VC>0?p10VRS/p10VC:1;
    let p5VRS=0,p5VC=0;for(let j=i-5;j<i;j++){if(j<0)continue;p5VRS+=(vA20>0?candles[j].v/vA20:0);p5VC++;}const p5AVR=p5VC>0?p5VRS/p5VC:1;
    let rV=0,gV=0;for(let j=i-10;j<i;j++){if(j<0)continue;if(candles[j].c<candles[j].o)rV+=candles[j].v;else gV+=candles[j].v;}const rvb=gV>0?rV/gV:(rV>0?10:1);
    let bZ=null;for(let zL=20;zL>=6;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,candles[j].h);zLo=Math.min(zLo,candles[j].l);if((candles[j].h-candles[j].l)/(atr[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL,zt:zLo>0?((zH-zLo)/zLo)*100:99};break;}
    if(!bZ||sig.c<=bZ.zH*1.001)continue;
    const caz=bZ.zH>0?((sig.c-bZ.zH)/bZ.zH)*100:0;
    const upsV=ups(cl,uw,bp,vP5,bZ.zt,bZ.len);const cqsV=cqs(cl,uw,bp,vP5,vER);
    let mfe=0,mae=0,hit5=false,hit3=false,d5=99;
    for(let d=i+1;d<=Math.min(i+10,candles.length-1);d++){const p=(candles[d].h-sig.c)/sig.c*100;const dr=(candles[d].l-sig.c)/sig.c*100;if(p>mfe)mfe=p;if(dr<mae)mae=dr;if(!hit5&&p>=5){hit5=true;d5=d-i;}if(!hit3&&p>=3)hit3=true;}
    allSignals.push({sym,avgTO,atrPctl,p10ARR,p10EC,bZ,p10AVR,p5AVR,rvb,ra,vR20,vP5,cl,uw,bp,sr,upsV,cqsV,rsi2:rsi2[i],vER,caz,mfe,mae,hit5,hit3,d5});
  }
}
console.log(`Total breakout candles (before param filtering): ${allSignals.length}\n`);

// D20+ baseline
const D20_BASE = {minTO:1e7,maxAP:85,maxPRR:0.75,maxEC:2,minZL:6,maxZL:20,maxZT:15,maxPV:0.90,maxP5V:1.00,maxRVB:1.10,minRA:1.0,maxRA:5.0,minVR:1.00,minVP5:2.00,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:60,minRSI:50,minVE:1.50,minCQS:3};

function testFilter(signals, overrides) {
  const p = {...D20_BASE, ...overrides};
  return signals.filter(s => {
    if(s.avgTO<p.minTO)return false;if(s.atrPctl>p.maxAP)return false;if(s.p10ARR>p.maxPRR)return false;
    if(s.p10EC>p.maxEC)return false;if(s.bZ.len<p.minZL||s.bZ.len>p.maxZL)return false;
    if(s.bZ.zt>p.maxZT)return false;if(s.p10AVR>p.maxPV)return false;if(s.p5AVR>p.maxP5V)return false;
    if(s.rvb>p.maxRVB)return false;if(s.ra<p.minRA||s.ra>p.maxRA)return false;
    if(s.vR20<p.minVR)return false;if(s.vP5<p.minVP5)return false;if(s.cl<p.minCL)return false;
    if(s.uw>p.maxUW)return false;if(s.bp<p.minBP)return false;if(s.sr>p.maxSR)return false;
    if(s.upsV<p.minUPS)return false;if(s.rsi2<p.minRSI)return false;
    if(p.minVE!==null&&s.vER<p.minVE)return false;if(p.minCQS!==null&&s.cqsV<p.minCQS)return false;
    return true;
  });
}

const baseline = testFilter(allSignals, {});
const baseHits = baseline.filter(s => s.hit5).length;
console.log(`D20+ BASELINE: ${baseline.length} trades, ${baseHits} hits (${baseline.length>0?(baseHits/baseline.length*100).toFixed(1):0}%)\n`);

// Test relaxing each parameter individually
console.log('═══ PARAMETER RELAXATION TEST (D20+ base) ═══');
console.log('Which parameter, when relaxed, adds the most trades without killing hit rate?\n');
console.log('Parameter                │ Current  │ Relaxed  │ Trades │ +5%Hits │ Rate   │ ΔTrades │ ΔRate');
console.log('─────────────────────────┼──────────┼──────────┼────────┼─────────┼────────┼─────────┼──────');

const relaxations = [
  {name:'Turnover 10M→5M', override:{minTO:5e6}},
  {name:'Turnover 10M→1M', override:{minTO:1e6}},
  {name:'ATR Pctl 85→95', override:{maxAP:95}},
  {name:'ATR Pctl 85→100', override:{maxAP:100}},
  {name:'Pre10 RangeATR .75→.85', override:{maxPRR:0.85}},
  {name:'Pre10 RangeATR .75→1.0', override:{maxPRR:1.00}},
  {name:'Pre10 ExpCount 2→3', override:{maxEC:3}},
  {name:'Pre10 ExpCount 2→5', override:{maxEC:5}},
  {name:'Zone maxLen 20→25', override:{maxZL:25}},
  {name:'Zone maxLen 20→30', override:{maxZL:30}},
  {name:'Zone tight 15→20', override:{maxZT:20}},
  {name:'Zone tight 15→25', override:{maxZT:25}},
  {name:'Pre10 VolR .90→1.0', override:{maxPV:1.00}},
  {name:'Pre10 VolR .90→1.1', override:{maxPV:1.10}},
  {name:'Pre5 VolR 1.0→1.1', override:{maxP5V:1.10}},
  {name:'Pre5 VolR 1.0→1.2', override:{maxP5V:1.20}},
  {name:'RedVolBias 1.1→1.2', override:{maxRVB:1.20}},
  {name:'RedVolBias 1.1→1.5', override:{maxRVB:1.50}},
  {name:'MinRangeATR 1.0→0.8', override:{minRA:0.8}},
  {name:'MaxRangeATR 5.0→6.0', override:{maxRA:6.0}},
  {name:'VolRatio20 1.0→0.8', override:{minVR:0.80}},
  {name:'VolVsPre5 2.0→1.5', override:{minVP5:1.50}},
  {name:'VolVsPre5 2.0→1.0', override:{minVP5:1.00}},
  {name:'CloseLoc 65→60', override:{minCL:60}},
  {name:'CloseLoc 65→55', override:{minCL:55}},
  {name:'MaxWick 35→40', override:{maxUW:40}},
  {name:'MinBody 35→25', override:{minBP:25}},
  {name:'MinBody 35→20', override:{minBP:20}},
  {name:'MaxCandleRisk 8.5→11', override:{maxSR:11}},
  {name:'UPS 60→50', override:{minUPS:50}},
  {name:'UPS 60→45', override:{minUPS:45}},
  {name:'RSI2 50→40', override:{minRSI:40}},
  {name:'RSI2 50→30', override:{minRSI:30}},
  {name:'VolExpRatio 1.5→1.25', override:{minVE:1.25}},
  {name:'VolExpRatio 1.5→1.0', override:{minVE:1.00}},
  {name:'CQS 3→2', override:{minCQS:2}},
  {name:'CQS 3→1', override:{minCQS:1}},
];

const winners = [];
for (const r of relaxations) {
  const result = testFilter(allSignals, r.override);
  const hits = result.filter(s => s.hit5).length;
  const rate = result.length > 0 ? (hits/result.length*100) : 0;
  const baseRate = baseline.length > 0 ? (baseHits/baseline.length*100) : 0;
  const dTrades = result.length - baseline.length;
  const dRate = rate - baseRate;
  const curr = Object.entries(r.override).map(([k,v]) => {
    const base = D20_BASE[k];
    return `${base}`;
  }).join('');
  const relaxed = Object.entries(r.override).map(([k,v]) => `${v}`).join('');

  if (dTrades > 0) {
    console.log(`${r.name.padEnd(24)} │ ${curr.padStart(8)} │ ${relaxed.padStart(8)} │ ${String(result.length).padStart(6)} │ ${String(hits).padStart(7)} │ ${rate.toFixed(1).padStart(5)}% │ ${('+'+dTrades).padStart(7)} │ ${(dRate>=0?'+':'')+dRate.toFixed(1)+'%'}`);
    winners.push({name:r.name, trades:result.length, hits, rate, dTrades, dRate});
  }
}

// Best relaxations (most trades gained with ≥75% hit rate maintained)
console.log('\n═══ TOP SAFE RELAXATIONS (gained trades + maintained ≥70% hit rate) ═══');
const safe = winners.filter(w => w.rate >= 70).sort((a,b) => b.dTrades - a.dTrades);
for (const s of safe.slice(0, 10)) {
  console.log(`${s.name.padEnd(24)} │ +${s.dTrades} trades │ ${s.rate.toFixed(1)}% hit rate │ ${s.hits} hits`);
}

// Combined relaxation — apply top 3 safe relaxations together
if (safe.length >= 3) {
  console.log('\n═══ COMBINED TOP-3 SAFE RELAXATIONS ═══');
  const combined = {};
  for (const s of safe.slice(0, 3)) {
    const r = relaxations.find(x => x.name === s.name);
    if (r) Object.assign(combined, r.override);
  }
  console.log(`Combining: ${safe.slice(0,3).map(s=>s.name).join(' + ')}`);
  const result = testFilter(allSignals, combined);
  const hits = result.filter(s => s.hit5).length;
  const rate = result.length > 0 ? (hits/result.length*100) : 0;
  console.log(`Result: ${result.length} trades, ${hits} +5% hits, ${rate.toFixed(1)}% hit rate`);
  console.log(`vs baseline: +${result.length - baseline.length} trades, ${(rate-(baseHits/baseline.length*100)).toFixed(1)}% rate change`);
}
