// Parameter Relaxation Analysis for ALL 4 param sets
const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/drkkr/Downloads/Portfolio';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv') && !f.includes('(1)'));

function parseCSV(fp){const lines=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<lines.length;i++){const[date,o,h,l,cl,v]=lines[i].split(',');const[d,m,y]=date.split('-');const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,months[m],+d).getTime()/1000,o:+o,h:+h,l:+l,c:+cl,v:+v,date});}return c;}
function computeATR14(candles){const a=new Array(candles.length).fill(0);if(candles.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));a[14]=s/14;for(let i=15;i<candles.length;i++){const tr=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));a[i]=(a[i-1]*13+tr)/14;}return a;}
function computeRSI2(candles){const r=new Array(candles.length).fill(50);if(candles.length<4)return r;let aG=0,aL=0;for(let i=1;i<=2;i++){const ch=candles[i].c-candles[i-1].c;if(ch>0)aG+=ch;else aL+=Math.abs(ch);}aG/=2;aL/=2;for(let i=3;i<candles.length;i++){const ch=candles[i].c-candles[i-1].c;aG=(aG+Math.max(ch,0))/2;aL=(aL+Math.max(-ch,0))/2;r[i]=aL<0.0001?100:100-100/(1+aG/aL);}return r;}
function pctRank(w,v){return w.length===0?50:(w.filter(x=>x<v).length/w.length)*100;}
function upsCalc(cl,uw,bp,vp5,zt,zl){let s=0;if(cl>=80)s+=20;else if(cl>=65)s+=12;if(uw<=20)s+=20;else if(uw<=35)s+=12;if(bp>=55)s+=15;else if(bp>=35)s+=9;if(vp5>=4)s+=20;else if(vp5>=2)s+=12;if(zt<=5)s+=15;else if(zt<=15)s+=9;if(zl>=12)s+=10;else if(zl>=6)s+=6;return s;}
function cqsCalc(cl,uw,bp,vp5,ve){let s=0;if(cl>=65)s++;if(uw<=30)s++;if(bp>=40)s++;if(vp5>=2.5)s++;if(ve>=1.5)s++;return s;}

// Collect all breakout signals with raw features
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
    const uV=upsCalc(cl,uw,bp,vP5,bZ.zt,bZ.len);const cV=cqsCalc(cl,uw,bp,vP5,vER);
    let mfe=0,mae=0,hit5=false,hit3=false,d5=99;
    for(let d=i+1;d<=Math.min(i+10,candles.length-1);d++){const p=(candles[d].h-sig.c)/sig.c*100;const dr=(candles[d].l-sig.c)/sig.c*100;if(p>mfe)mfe=p;if(dr<mae)mae=dr;if(!hit5&&p>=5){hit5=true;d5=d-i;}if(!hit3&&p>=3)hit3=true;}
    allSignals.push({sym,date:candles[i].date,avgTO,atrPctl,p10ARR,p10EC,bZ,p10AVR,p5AVR,rvb,ra,vR20,vP5,cl,uw,bp,sr,upsV:uV,cqsV:cV,rsi2:rsi2[i],vER,caz,mfe,mae,hit5,hit3,d5});
  }
}
console.log(`Total breakout candles across 29 files: ${allSignals.length}\n`);

const PARAM_SETS = {
  D20:{name:'D20+ Deployable',minTO:1e7,maxAP:85,maxPRR:0.75,maxEC:2,minZL:6,maxZL:20,maxZT:15,maxPV:0.90,maxP5V:1.00,maxRVB:1.10,minRA:1.0,maxRA:5.0,minVR:1.00,minVP5:2.00,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:60,minRSI:50,minVE:1.50,minCQS:3,maxCAZ:null},
  HP15:{name:'HP15+ HighPrec',minTO:1e7,maxAP:85,maxPRR:0.75,maxEC:0,minZL:6,maxZL:25,maxZT:15,maxPV:0.90,maxP5V:1.10,maxRVB:1.10,minRA:1.0,maxRA:5.0,minVR:1.10,minVP5:2.00,minCL:65,maxUW:35,minBP:25,maxSR:11.0,minUPS:45,minRSI:50,minVE:null,minCQS:null,maxCAZ:8.0},
  E10:{name:'E10+ Elite',minTO:2e7,maxAP:60,maxPRR:0.95,maxEC:4,minZL:8,maxZL:15,maxZT:12,maxPV:0.85,maxP5V:0.90,maxRVB:1.20,minRA:1.0,maxRA:6.0,minVR:1.00,minVP5:3.00,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:45,minRSI:50,minVE:1.10,minCQS:3,maxCAZ:null},
  US8:{name:'US8+ UltraSel',minTO:1e7,maxAP:60,maxPRR:0.75,maxEC:0,minZL:6,maxZL:15,maxZT:8,maxPV:0.85,maxP5V:1.10,maxRVB:1.10,minRA:1.0,maxRA:6.0,minVR:1.20,minVP5:2.00,minCL:65,maxUW:40,minBP:25,maxSR:8.5,minUPS:45,minRSI:55,minVE:1.50,minCQS:null,maxCAZ:null},
};

function testFilter(signals, p) {
  return signals.filter(s => {
    if(s.avgTO<p.minTO)return false;if(s.atrPctl>p.maxAP)return false;if(s.p10ARR>p.maxPRR)return false;
    if(s.p10EC>p.maxEC)return false;if(s.bZ.len<p.minZL||s.bZ.len>p.maxZL)return false;
    if(s.bZ.zt>p.maxZT)return false;if(s.p10AVR>p.maxPV)return false;if(s.p5AVR>p.maxP5V)return false;
    if(s.rvb>p.maxRVB)return false;if(s.ra<p.minRA||s.ra>p.maxRA)return false;
    if(s.vR20<p.minVR)return false;if(s.vP5<p.minVP5)return false;if(s.cl<p.minCL)return false;
    if(s.uw>p.maxUW)return false;if(s.bp<p.minBP)return false;if(s.sr>p.maxSR)return false;
    if(s.upsV<p.minUPS)return false;if(s.rsi2<p.minRSI)return false;
    if(p.minVE!==null&&s.vER<p.minVE)return false;if(p.minCQS!==null&&s.cqsV<p.minCQS)return false;
    if(p.maxCAZ!==null&&s.caz>p.maxCAZ)return false;return true;
  });
}

// For each param set, find what BLOCKS the most signals
for (const [key, baseP] of Object.entries(PARAM_SETS)) {
  const baseline = testFilter(allSignals, baseP);
  const baseHits = baseline.filter(s=>s.hit5).length;
  const baseRate = baseline.length>0?(baseHits/baseline.length*100):0;

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${baseP.name}: ${baseline.length} trades, ${baseHits} hits, ${baseRate.toFixed(1)}% hit rate`);
  console.log(`${'═'.repeat(70)}`);

  // Step 1: Find which single condition blocks the most GOOD trades
  console.log('\n  [BLOCKER ANALYSIS] — which condition is rejecting the most winning trades?');
  console.log('  Parameter                │ Relaxed To │ New Trades │ New Hits │ New Rate │ +Good │ +Bad');
  console.log('  ─────────────────────────┼────────────┼───────────┼──────────┼──────────┼───────┼─────');

  const relaxDefs = [
    ['Turnover', 'minTO', [5e6, 1e6]],
    ['ATR Pctl', 'maxAP', [95, 100]],
    ['Pre10 RangeATR', 'maxPRR', [0.85, 1.0, 1.2]],
    ['Pre10 ExpCount', 'maxEC', [3, 5, 8]],
    ['Zone minLen', 'minZL', [4, 3]],
    ['Zone maxLen', 'maxZL', [25, 30, 40]],
    ['Zone tightness', 'maxZT', [20, 25, 30]],
    ['Pre10 VolRatio', 'maxPV', [1.0, 1.1, 1.2]],
    ['Pre5 VolRatio', 'maxP5V', [1.1, 1.2, 1.5]],
    ['RedVolBias', 'maxRVB', [1.2, 1.5, 2.0]],
    ['Min RangeATR', 'minRA', [0.8, 0.6]],
    ['Max RangeATR', 'maxRA', [6, 7, 8]],
    ['VolRatio20', 'minVR', [0.8, 0.6]],
    ['VolVsPre5', 'minVP5', [1.5, 1.0, 0.5]],
    ['CloseLoc', 'minCL', [60, 55, 50]],
    ['MaxWick', 'maxUW', [40, 45, 50]],
    ['MinBody', 'minBP', [25, 20, 15]],
    ['MaxCandleRisk', 'maxSR', [11, 13, 15]],
    ['UPS', 'minUPS', [50, 45, 35]],
    ['RSI2', 'minRSI', [40, 30, 20]],
    ['VolExpRatio', 'minVE', [1.25, 1.0, 0.8]],
    ['CQS', 'minCQS', [2, 1, 0]],
    ['CloseAbvZone', 'maxCAZ', [10, 15, 20]],
  ];

  const goodRelaxations = [];
  for (const [name, param, values] of relaxDefs) {
    if (baseP[param] === null && !['maxCAZ'].includes(param)) continue;
    for (const val of values) {
      const relaxed = {...baseP, [param]: val};
      // Skip if not actually relaxing
      if (param.startsWith('min') && val >= baseP[param]) continue;
      if (param.startsWith('max') && baseP[param] !== null && val <= baseP[param]) continue;
      const result = testFilter(allSignals, relaxed);
      const hits = result.filter(s=>s.hit5).length;
      const rate = result.length>0?(hits/result.length*100):0;
      const dTrades = result.length - baseline.length;
      if (dTrades <= 0) continue;
      const dHits = hits - baseHits;
      const dBad = dTrades - dHits;
      console.log(`  ${(name+' → '+val).padEnd(24)} │ ${String(val).padStart(10)} │ ${String(result.length).padStart(9)} │ ${String(hits).padStart(8)} │ ${rate.toFixed(1).padStart(7)}% │ ${('+'+dHits).padStart(5)} │ ${('+'+dBad).padStart(4)}`);
      if (rate >= 70) goodRelaxations.push({name, param, val, trades: result.length, hits, rate, dTrades, dHits, dBad});
    }
  }

  // Best combined: pick top relaxations that add the most hits with rate ≥ 75%
  const best = goodRelaxations.filter(g => g.rate >= 75).sort((a,b) => b.dHits - a.dHits);
  if (best.length >= 2) {
    console.log(`\n  [RECOMMENDED COMBINED RELAXATION for ${baseP.name}]`);
    const combo = {};
    const used = [];
    for (const b of best.slice(0, 4)) {
      combo[b.param] = b.val;
      used.push(`${b.name}→${b.val}`);
    }
    const comboP = {...baseP, ...combo};
    const comboResult = testFilter(allSignals, comboP);
    const comboHits = comboResult.filter(s=>s.hit5).length;
    const comboRate = comboResult.length>0?(comboHits/comboResult.length*100):0;
    console.log(`  Changes: ${used.join(', ')}`);
    console.log(`  Result: ${comboResult.length} trades, ${comboHits} hits, ${comboRate.toFixed(1)}% hit rate`);
    console.log(`  vs baseline: +${comboResult.length - baseline.length} trades, ${(comboRate-baseRate)>=0?'+':''}${(comboRate-baseRate).toFixed(1)}% rate`);
    if (comboResult.length > 0) {
      const avgMfe = comboResult.reduce((s,t)=>s+t.mfe,0)/comboResult.length;
      const avgMae = comboResult.reduce((s,t)=>s+t.mae,0)/comboResult.length;
      console.log(`  Avg MFE: +${avgMfe.toFixed(1)}%, Avg MAE: ${avgMae.toFixed(1)}%`);
    }
    // Show individual trades
    console.log(`\n  Trades:`);
    console.log('  Symbol       │ Date       │ +5%Hit │ MFE    │ MAE');
    for (const t of comboResult) {
      console.log(`  ${t.sym.padEnd(12)} │ ${(t.date||'—').padEnd(10)} │ ${t.hit5?'YES   ':'NO    '} │ ${t.mfe.toFixed(1).padStart(5)}% │ ${t.mae.toFixed(1).padStart(5)}%`);
    }
  }
}
