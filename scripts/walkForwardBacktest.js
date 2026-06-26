// Walk-Forward + Out-of-Sample Backtest on 29 OHLCV files
// Split: 70% in-sample (train) / 30% out-of-sample (test)
// Tests all 4 param sets independently

const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/drkkr/Downloads/Portfolio';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv') && !f.includes('(1)'));

function parseCSV(fp) {
  const lines = fs.readFileSync(fp,'utf8').trim().split('\n');
  const c=[];
  for(let i=1;i<lines.length;i++){const[date,o,h,l,cl,v]=lines[i].split(',');const[d,m,y]=date.split('-');const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,months[m],+d).getTime()/1000,o:+o,h:+h,l:+l,c:+cl,v:+v,date});}
  return c;
}

function computeATR14(candles) {
  const a=new Array(candles.length).fill(0);if(candles.length<15)return a;let s=0;
  for(let i=1;i<=14;i++)s+=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));
  a[14]=s/14;for(let i=15;i<candles.length;i++){const tr=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));a[i]=(a[i-1]*13+tr)/14;}
  return a;
}

function computeRSI2(candles) {
  const rsi=new Array(candles.length).fill(50);if(candles.length<4)return rsi;
  let avgG=0,avgL=0;for(let i=1;i<=2;i++){const ch=candles[i].c-candles[i-1].c;if(ch>0)avgG+=ch;else avgL+=Math.abs(ch);}avgG/=2;avgL/=2;
  for(let i=3;i<candles.length;i++){const ch=candles[i].c-candles[i-1].c;avgG=(avgG+Math.max(ch,0))/2;avgL=(avgL+Math.max(-ch,0))/2;rsi[i]=avgL<0.0001?100:100-100/(1+avgG/avgL);}
  return rsi;
}

function percentileRank(w,v){return w.length===0?50:(w.filter(x=>x<v).length/w.length)*100;}

function computeUPS(cl,uw,bp,vp5,zt,zl){let s=0;if(cl>=80)s+=20;else if(cl>=65)s+=12;if(uw<=20)s+=20;else if(uw<=35)s+=12;if(bp>=55)s+=15;else if(bp>=35)s+=9;if(vp5>=4)s+=20;else if(vp5>=2)s+=12;if(zt<=5)s+=15;else if(zt<=15)s+=9;if(zl>=12)s+=10;else if(zl>=6)s+=6;return s;}
function computeCQS(cl,uw,bp,vp5,ve){let s=0;if(cl>=65)s++;if(uw<=30)s++;if(bp>=40)s++;if(vp5>=2.5)s++;if(ve>=1.5)s++;return s;}

const PARAM_SETS = {
  D20:{name:'Deployable 20+',minTO:1e7,maxAP:85,maxPRR:0.75,maxEC:2,minZL:6,maxZL:20,maxZT:15,maxPV:0.90,maxP5V:1.00,maxHVC:4,hvM:1.35,maxRVB:1.10,minRA:1.0,maxRA:5.0,minVR:1.00,minVP5:2.00,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:60,minRSI:50,minVE:1.50,minCQS:3,maxCAZ:null},
  HP15:{name:'HighPrecision 15+',minTO:1e7,maxAP:85,maxPRR:0.75,maxEC:0,minZL:6,maxZL:25,maxZT:15,maxPV:0.90,maxP5V:1.10,maxHVC:4,hvM:1.35,maxRVB:1.10,minRA:1.0,maxRA:5.0,minVR:1.10,minVP5:2.00,minCL:65,maxUW:35,minBP:25,maxSR:11.0,minUPS:45,minRSI:50,minVE:null,minCQS:null,maxCAZ:8.0},
  E10:{name:'Elite 10+',minTO:2e7,maxAP:60,maxPRR:0.95,maxEC:4,minZL:8,maxZL:15,maxZT:12,maxPV:0.85,maxP5V:0.90,maxHVC:2,hvM:1.2,maxRVB:1.20,minRA:1.0,maxRA:6.0,minVR:1.00,minVP5:3.00,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:45,minRSI:50,minVE:1.10,minCQS:3,maxCAZ:null},
  US8:{name:'UltraSelective 8+',minTO:1e7,maxAP:60,maxPRR:0.75,maxEC:0,minZL:6,maxZL:15,maxZT:8,maxPV:0.85,maxP5V:1.10,maxHVC:4,hvM:1.5,maxRVB:1.10,minRA:1.0,maxRA:6.0,minVR:1.20,minVP5:2.00,minCL:65,maxUW:40,minBP:25,maxSR:8.5,minUPS:45,minRSI:55,minVE:1.50,minCQS:null,maxCAZ:null},
};

function findSignals(candles, atr, rsi2, startIdx, endIdx) {
  const signals = [];
  for (let i = Math.max(40, startIdx); i < endIdx - 10 && i < candles.length - 11; i++) {
    const sig=candles[i];if(sig.c<=0||atr[i]<=0)continue;const r=sig.h-sig.l;if(r<=0)continue;
    const atrPct=(atr[i]/sig.c)*100;const w120=[];for(let j=Math.max(14,i-121);j<i;j++){if(candles[j].c>0&&atr[j]>0)w120.push((atr[j]/candles[j].c)*100);}
    const atrPctl=percentileRank(w120,atrPct);const rangeATR=r/atr[i],closeLoc=(sig.c-sig.l)/r*100,bodyPct=Math.abs(sig.c-sig.o)/r*100;
    const uwPct=(sig.h-Math.max(sig.o,sig.c))/r*100,sigRangePct=(r/sig.c)*100;
    let turnSum=0;for(let j=Math.max(0,i-20);j<i;j++)turnSum+=candles[j].c*candles[j].v;const avgTO=turnSum/Math.max(i-Math.max(0,i-20),1);
    let pre10RSum=0,pre10Cnt=0,pre10ExpC=0;for(let j=i-10;j<i;j++){if(j<1)continue;const tr=Math.max(candles[j].h-candles[j].l,Math.abs(candles[j].h-candles[j-1].c),Math.abs(candles[j].l-candles[j-1].c));const ra=tr/atr[j];pre10RSum+=ra;pre10Cnt++;if(ra>1.1)pre10ExpC++;}
    const pre10ARR=pre10Cnt>0?pre10RSum/pre10Cnt:1;const volExpR=pre10ARR>0?rangeATR/pre10ARR:1;
    let v20S=0;for(let j=Math.max(0,i-20);j<i;j++)v20S+=candles[j].v;const vA20=v20S/Math.max(i-Math.max(0,i-20),1);const vR20=vA20>0?sig.v/vA20:0;
    let v5S=0;for(let j=Math.max(0,i-5);j<i;j++)v5S+=candles[j].v;const vA5=v5S/Math.max(i-Math.max(0,i-5),1);const vP5=vA5>0?sig.v/vA5:0;
    let p10VRS=0,p10VC=0;for(let j=i-10;j<i;j++){if(j<0)continue;p10VRS+=(vA20>0?candles[j].v/vA20:0);p10VC++;}const p10AVR=p10VC>0?p10VRS/p10VC:1;
    let p5VRS=0,p5VC=0;for(let j=i-5;j<i;j++){if(j<0)continue;p5VRS+=(vA20>0?candles[j].v/vA20:0);p5VC++;}const p5AVR=p5VC>0?p5VRS/p5VC:1;
    let rV=0,gV=0;for(let j=i-10;j<i;j++){if(j<0)continue;if(candles[j].c<candles[j].o)rV+=candles[j].v;else gV+=candles[j].v;}const rvb=gV>0?rV/gV:(rV>0?10:1);
    let bestZ=null;for(let zL=20;zL>=6;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,candles[j].h);zLo=Math.min(zLo,candles[j].l);if((candles[j].h-candles[j].l)/(atr[j]||1)>1.0)ok=false;}if(!ok)continue;const zt=zLo>0?((zH-zLo)/zLo)*100:99;bestZ={zH,zL:zLo,len:zL,zt};break;}
    if(!bestZ||sig.c<=bestZ.zH*1.001)continue;
    const caz=bestZ.zH>0?((sig.c-bestZ.zH)/bestZ.zH)*100:0;
    const ups=computeUPS(closeLoc,uwPct,bodyPct,vP5,bestZ.zt,bestZ.len);const cqs=computeCQS(closeLoc,uwPct,bodyPct,vP5,volExpR);
    let mfe=0,mae=0,hit5=false,hit3=false,d5=99;
    for(let d=i+1;d<=Math.min(i+10,candles.length-1);d++){const p=(candles[d].h-sig.c)/sig.c*100;const dr=(candles[d].l-sig.c)/sig.c*100;if(p>mfe)mfe=p;if(dr<mae)mae=dr;if(!hit5&&p>=5){hit5=true;d5=d-i;}if(!hit3&&p>=3)hit3=true;}
    // Stop simulation (3.5% max)
    let stopped=false;for(let d=i+1;d<=Math.min(i+10,candles.length-1);d++){if((candles[d].l-sig.c)/sig.c*100<=-3.5){stopped=true;break;}}

    signals.push({idx:i,sym:'',date:candles[i].date,avgTO,atrPctl,pre10ARR,pre10ExpC,bestZ,p10AVR,p5AVR,rvb,rangeATR,vR20,vP5,closeLoc,uwPct,bodyPct,sigRangePct,ups,cqs,rsi2:rsi2[i],volExpR,caz,mfe,mae,hit5,hit3,d5,stopped});
  }
  return signals;
}

function testParamSet(signals, p) {
  return signals.filter(s => {
    if(s.avgTO<p.minTO)return false;if(s.atrPctl>p.maxAP)return false;if(s.pre10ARR>p.maxPRR)return false;
    if(s.pre10ExpC>p.maxEC)return false;if(s.bestZ.len<p.minZL||s.bestZ.len>p.maxZL)return false;
    if(s.bestZ.zt>p.maxZT)return false;if(s.p10AVR>p.maxPV)return false;if(s.p5AVR>p.maxP5V)return false;
    if(s.rvb>p.maxRVB)return false;if(s.rangeATR<p.minRA||s.rangeATR>p.maxRA)return false;
    if(s.vR20<p.minVR)return false;if(s.vP5<p.minVP5)return false;if(s.closeLoc<p.minCL)return false;
    if(s.uwPct>p.maxUW)return false;if(s.bodyPct<p.minBP)return false;if(s.sigRangePct>p.maxSR)return false;
    if(s.ups<p.minUPS)return false;if(s.rsi2<p.minRSI)return false;
    if(p.minVE!==null&&s.volExpR<p.minVE)return false;if(p.minCQS!==null&&s.cqs<p.minCQS)return false;
    if(p.maxCAZ!==null&&s.caz>p.maxCAZ)return false;return true;
  });
}

function stats(trades) {
  const n=trades.length;if(n===0)return{n:0,h5:0,r5:0,h3:0,r3:0,mfe:0,mae:0,d5:0,sr:0,wlb:0};
  const h5=trades.filter(t=>t.hit5).length,h3=trades.filter(t=>t.hit3).length;
  const r5=h5/n*100,r3=h3/n*100;
  const mfe=trades.reduce((s,t)=>s+t.mfe,0)/n,mae=trades.reduce((s,t)=>s+t.mae,0)/n;
  const d5=h5>0?trades.filter(t=>t.hit5).reduce((s,t)=>s+t.d5,0)/h5:0;
  const stopped=trades.filter(t=>t.stopped).length,sr=stopped/n*100;
  const z=1.96,p=h5/n;const wlb=n>0?(p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n)*100:0;
  return{n,h5,r5:+r5.toFixed(1),h3,r3:+r3.toFixed(1),mfe:+mfe.toFixed(1),mae:+mae.toFixed(1),d5:+d5.toFixed(1),sr:+sr.toFixed(1),wlb:+wlb.toFixed(1)};
}

// ═══ MAIN: Walk-Forward ═══
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('  WALK-FORWARD + OUT-OF-SAMPLE BACKTEST — 4 PARAM SETS × 29 FILES');
console.log('  Split: 70% In-Sample (train) / 30% Out-of-Sample (test)');
console.log('═══════════════════════════════════════════════════════════════════════\n');

const allIS = {}, allOOS = {}, allFull = {};
for (const k of Object.keys(PARAM_SETS)) { allIS[k]=[]; allOOS[k]=[]; allFull[k]=[]; }

for (const file of files) {
  const candles = parseCSV(path.join(DIR, file));
  if (candles.length < 100) continue;
  const sym = file.replace('_NS_OHLCV.csv','');
  const atr = computeATR14(candles);
  const rsi2 = computeRSI2(candles);

  const splitIdx = Math.floor(candles.length * 0.70);
  const splitDate = candles[splitIdx]?.date || '—';

  const isSignals = findSignals(candles, atr, rsi2, 40, splitIdx);
  const oosSignals = findSignals(candles, atr, rsi2, splitIdx, candles.length);
  const fullSignals = findSignals(candles, atr, rsi2, 40, candles.length);

  isSignals.forEach(s => s.sym = sym);
  oosSignals.forEach(s => s.sym = sym);
  fullSignals.forEach(s => s.sym = sym);

  for (const [k, p] of Object.entries(PARAM_SETS)) {
    allIS[k].push(...testParamSet(isSignals, p));
    allOOS[k].push(...testParamSet(oosSignals, p));
    allFull[k].push(...testParamSet(fullSignals, p));
  }
}

// Report
console.log('                    │         IN-SAMPLE (70%)         │       OUT-OF-SAMPLE (30%)       │          FULL DATASET');
console.log('Param Set           │ Trades│ +5%Rate│ +3%Rate│ WilsonLB│ Trades│ +5%Rate│ +3%Rate│ WilsonLB│ Trades│ +5%Rate│ AvgMFE│ StopRate');
console.log('────────────────────┼───────┼────────┼────────┼─────────┼───────┼────────┼────────┼─────────┼───────┼────────┼───────┼────────');
for (const [k, p] of Object.entries(PARAM_SETS)) {
  const is = stats(allIS[k]), oos = stats(allOOS[k]), full = stats(allFull[k]);
  const robust = oos.r5 > 0 ? 'ROBUST' : 'FAIL';
  console.log(`${p.name.padEnd(19)} │ ${String(is.n).padStart(5)} │ ${(is.r5+'%').padStart(6)} │ ${(is.r3+'%').padStart(6)} │ ${(is.wlb+'%').padStart(7)} │ ${String(oos.n).padStart(5)} │ ${(oos.r5+'%').padStart(6)} │ ${(oos.r3+'%').padStart(6)} │ ${(oos.wlb+'%').padStart(7)} │ ${String(full.n).padStart(5)} │ ${(full.r5+'%').padStart(6)} │ ${(full.mfe+'%').padStart(5)} │ ${(full.sr+'%').padStart(6)}`);
}

// Degradation analysis
console.log('\n═══ DEGRADATION ANALYSIS ═══');
console.log('Param Set           │ IS +5% Rate │ OOS +5% Rate │ Degradation │ Verdict');
console.log('────────────────────┼─────────────┼──────────────┼─────────────┼────────');
for (const [k, p] of Object.entries(PARAM_SETS)) {
  const is = stats(allIS[k]), oos = stats(allOOS[k]);
  const deg = is.r5 > 0 ? ((1 - oos.r5/is.r5) * 100).toFixed(0) : '—';
  const verdict = oos.n === 0 ? 'NO DATA' : oos.r5 >= is.r5 * 0.7 ? '✓ ROBUST' : oos.r5 > 0 ? '⚠ DEGRADED' : '✗ FAILED';
  console.log(`${p.name.padEnd(19)} │ ${(is.r5+'%').padStart(11)} │ ${(oos.r5+'%').padStart(12)} │ ${(deg+'%').padStart(11)} │ ${verdict}`);
}

// Per-stock OOS results
console.log('\n═══ OUT-OF-SAMPLE TRADES (all param sets combined) ═══');
const allOOSTrades = [...allOOS.D20, ...allOOS.HP15, ...allOOS.E10, ...allOOS.US8];
const uniqueOOS = [];
const seen = new Set();
for (const t of allOOSTrades) {
  const key = `${t.sym}_${t.idx}`;
  if (seen.has(key)) continue;
  seen.add(key);
  uniqueOOS.push(t);
}
if (uniqueOOS.length > 0) {
  console.log('Symbol       │ Date       │ +5%Hit │ MFE    │ MAE    │ Days5 │ Stopped');
  for (const t of uniqueOOS.slice(0, 30)) {
    console.log(`${t.sym.padEnd(12)} │ ${(t.date||'—').padEnd(10)} │ ${t.hit5?'YES   ':'NO    '} │ ${t.mfe.toFixed(1).padStart(5)}% │ ${t.mae.toFixed(1).padStart(5)}% │ ${t.hit5?String(t.d5).padStart(5):'  —  '} │ ${t.stopped?'YES':'NO'}`);
  }
} else {
  console.log('No out-of-sample trades found.');
}

// Equity curve simulation
console.log('\n═══ EQUITY CURVE (Full dataset, 1% risk, 3.5% stop, T1=clamp(2.15ATR,3%,5%)) ═══');
for (const [k, p] of Object.entries(PARAM_SETS)) {
  let equity = 1000000;
  const trades = allFull[k];
  let wins = 0, losses = 0;
  for (const t of trades) {
    const riskAmt = equity * 0.01;
    const atrPct = t.mfe > 0 ? 3.5 : 3.5; // using fixed stop for simulation
    const t1Pct = Math.max(3, Math.min(5, 2.15 * (t.rangeATR > 0 ? t.rangeATR : 3)));
    if (t.stopped) { equity -= riskAmt; losses++; }
    else if (t.hit5) { equity += riskAmt * (t1Pct / 3.5); wins++; }
    else { equity += riskAmt * (t.mfe / 3.5) * 0.5; } // partial on expired
  }
  const ret = ((equity - 1000000) / 1000000 * 100).toFixed(1);
  console.log(`${p.name.padEnd(19)} │ Rs.${(equity/100000).toFixed(1)}L │ ${ret >= 0 ? '+' : ''}${ret}% │ ${wins}W/${losses}L`);
}
