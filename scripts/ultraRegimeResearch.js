// ULTRA REGIME RESEARCH — 6 advanced statistical tools on 10yr Nifty+VIX
// Each tool tested individually, then combined into ULTIMATE regime engine

const fs=require('fs');
const nLines=fs.readFileSync('C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX/nifty50_daily_ohlcv.csv','utf8').trim().split('\n');
const nifty=[];for(let i=1;i<nLines.length;i++){const[date,o,h,l,c,v]=nLines[i].split(',');nifty.push({date,o:+o,h:+h,l:+l,c:+c,v:+v});}
const vLines=fs.readFileSync('C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX/indiavix_daily.csv','utf8').trim().split('\n');
const vixMap={};for(let i=1;i<vLines.length;i++){const[date,o,h,l,c]=vLines[i].split(',');vixMap[date]={vix:+c};}
const D=nifty.map(n=>({...n,vix:vixMap[n.date]?.vix||null})).filter(m=>m.vix!==null);
console.log(`Data: ${D.length} days (${D[0].date} to ${D[D.length-1].date})\n`);

// ═══ TOOL 1: HURST EXPONENT ═══
// H > 0.5 → trending (persistent), H < 0.5 → mean-reverting, H = 0.5 → random walk
// Uses R/S (Rescaled Range) method
function hurst(data, window=100) {
  const results=[];
  for(let i=window;i<data.length;i++){
    const returns=[];
    for(let j=i-window+1;j<=i;j++)returns.push(Math.log(data[j].c/data[j-1].c));
    const mean=returns.reduce((s,v)=>s+v,0)/returns.length;
    const cumDev=[];let cum=0;
    for(const r of returns){cum+=r-mean;cumDev.push(cum);}
    const R=Math.max(...cumDev)-Math.min(...cumDev);
    const S=Math.sqrt(returns.reduce((s,v)=>s+(v-mean)**2,0)/returns.length);
    const RS=S>0?R/S:0;
    const H=RS>0?Math.log(RS)/Math.log(window):0.5;
    results.push({date:data[i].date,H:Math.max(0,Math.min(1,H)),RS,close:data[i].c});
  }
  return results;
}

// ═══ TOOL 2: CUSUM CHANGE-POINT DETECTION ═══
// Cumulative sum of standardized returns — detects regime shifts faster than MAs
function cusum(data, window=50, threshold=3.0) {
  const results=[];
  for(let i=window;i<data.length;i++){
    const returns=[];
    for(let j=i-window+1;j<=i;j++)returns.push((data[j].c-data[j-1].c)/data[j-1].c*100);
    const mean=returns.reduce((s,v)=>s+v,0)/returns.length;
    const std=Math.sqrt(returns.reduce((s,v)=>s+(v-mean)**2,0)/returns.length)||0.01;
    // Cumulative sum of positive and negative deviations
    let sPlus=0,sMinus=0;
    for(const r of returns.slice(-20)){
      sPlus=Math.max(0,sPlus+(r-mean)/std-0.5);
      sMinus=Math.max(0,sMinus-(r-mean)/std-0.5);
    }
    let signal='none';
    if(sPlus>threshold)signal='bullish_shift';
    else if(sMinus>threshold)signal='bearish_shift';
    results.push({date:data[i].date,sPlus,sMinus,signal,close:data[i].c});
  }
  return results;
}

// ═══ TOOL 3: SHANNON ENTROPY ═══
// Measures market disorder. Low entropy = orderly trend, high = chaos/uncertainty
function entropy(data, window=20) {
  const results=[];
  for(let i=window;i<data.length;i++){
    const returns=[];
    for(let j=i-window+1;j<=i;j++)returns.push((data[j].c-data[j-1].c)/data[j-1].c*100);
    // Discretize into 5 bins
    const bins=[0,0,0,0,0]; // very neg, neg, flat, pos, very pos
    for(const r of returns){
      if(r<-1.5)bins[0]++;else if(r<-0.3)bins[1]++;else if(r<0.3)bins[2]++;else if(r<1.5)bins[3]++;else bins[4]++;
    }
    let H=0;
    for(const b of bins){const p=b/window;if(p>0)H-=p*Math.log2(p);}
    const maxH=Math.log2(5); // max possible entropy with 5 bins
    const normalizedH=H/maxH; // 0 = perfectly ordered, 1 = maximum chaos
    results.push({date:data[i].date,entropy:normalizedH,rawH:H,close:data[i].c});
  }
  return results;
}

// ═══ TOOL 4: FRACTAL DIMENSION (Higuchi method proxy) ═══
// FD ≈ 1.0 = smooth trend, FD ≈ 1.5 = random walk, FD ≈ 2.0 = space-filling chaos
function fractalDim(data, window=50) {
  const results=[];
  for(let i=window;i<data.length;i++){
    const prices=[];
    for(let j=i-window;j<=i;j++)prices.push(data[j].c);
    // Higuchi proxy: compute path length at different scales
    let L1=0,L2=0;
    for(let j=1;j<prices.length;j++)L1+=Math.abs(prices[j]-prices[j-1]);
    for(let j=2;j<prices.length;j+=2)L2+=Math.abs(prices[j]-prices[j-2]);
    L2*=prices.length/(prices.length/2); // normalize
    const fd=L2>0?Math.log(L1/L2)/Math.log(2)+1:1.5;
    results.push({date:data[i].date,fd:Math.max(1,Math.min(2,fd)),close:data[i].c});
  }
  return results;
}

// ═══ TOOL 5: KALMAN FILTER — Optimal trend estimation ═══
// Estimates true market trend with minimal noise
function kalman(data) {
  const results=[];
  let x=data[0].c; // state estimate
  let P=1; // error covariance
  const Q=0.01; // process noise
  const R=1.0; // measurement noise
  for(let i=0;i<data.length;i++){
    // Predict
    const xPred=x;const pPred=P+Q;
    // Update
    const K=pPred/(pPred+R); // Kalman gain
    x=xPred+K*(data[i].c-xPred);
    P=(1-K)*pPred;
    // Trend = slope of Kalman state
    const trend=i>0?(x-results[results.length-1]?.kalmanState||x)/data[i].c*100:0;
    results.push({date:data[i].date,kalmanState:x,kalmanGain:K,trend,close:data[i].c});
  }
  // Compute 10-day Kalman trend slope
  for(let i=10;i<results.length;i++){
    results[i].trendSlope=(results[i].kalmanState-results[i-10].kalmanState)/results[i].close*100;
  }
  return results;
}

// ═══ TOOL 6: DISPERSION INDEX (Cross-sectional vol proxy) ═══
// High dispersion = stock-picking market, low = macro-driven (correlated)
// We proxy using Nifty's intraday range vs ATR
function dispersion(data, window=20) {
  const results=[];
  for(let i=window;i<data.length;i++){
    // Use range/close as dispersion proxy
    const ranges=[];
    for(let j=i-window+1;j<=i;j++)ranges.push((data[j].h-data[j].l)/data[j].c*100);
    const avgRange=ranges.reduce((s,v)=>s+v,0)/window;
    const rangeStd=Math.sqrt(ranges.reduce((s,v)=>s+(v-avgRange)**2,0)/window);
    // High range + low std = orderly trend; High range + high std = chaos
    const dispIdx=avgRange*(1+rangeStd);
    results.push({date:data[i].date,dispersion:dispIdx,avgRange,rangeStd,close:data[i].c});
  }
  return results;
}

// Run all tools
const hurstR=hurst(D);
const cusumR=cusum(D);
const entropyR=entropy(D);
const fractalR=fractalDim(D);
const kalmanR=kalman(D);
const dispR=dispersion(D);

console.log('█'.repeat(85));
console.log('  ULTRA REGIME RESEARCH — 6 ADVANCED TOOLS ON 10yr NIFTY+VIX');
console.log('█'.repeat(85));

// Show current values of each tool
const last=D[D.length-1];
const hLast=hurstR[hurstR.length-1];
const cLast=cusumR[cusumR.length-1];
const eLast=entropyR[entropyR.length-1];
const fLast=fractalR[fractalR.length-1];
const kLast=kalmanR[kalmanR.length-1];
const dLast=dispR[dispR.length-1];

console.log('\n═══ CURRENT READINGS ═══\n');
console.log(`  Tool                │ Value    │ Interpretation`);
console.log('  ────────────────────┼──────────┼───────────────');
console.log(`  Hurst Exponent      │ ${hLast.H.toFixed(3).padStart(8)} │ ${hLast.H>0.6?'TRENDING (persistent)':hLast.H>0.45?'RANDOM WALK (uncertain)':'MEAN-REVERTING (choppy)'}`);
console.log(`  CUSUM S+            │ ${cLast.sPlus.toFixed(2).padStart(8)} │ ${cLast.signal==='bullish_shift'?'BULLISH SHIFT DETECTED':'No shift'}`);
console.log(`  CUSUM S-            │ ${cLast.sMinus.toFixed(2).padStart(8)} │ ${cLast.signal==='bearish_shift'?'BEARISH SHIFT DETECTED':'No shift'}`);
console.log(`  Shannon Entropy     │ ${eLast.entropy.toFixed(3).padStart(8)} │ ${eLast.entropy<0.6?'ORDERLY (strong trend)':eLast.entropy<0.8?'MODERATE disorder':'HIGH CHAOS'}`);
console.log(`  Fractal Dimension   │ ${fLast.fd.toFixed(3).padStart(8)} │ ${fLast.fd<1.3?'SMOOTH TREND':fLast.fd<1.6?'MODERATE complexity':'CHAOTIC/CHOPPY'}`);
console.log(`  Kalman Trend (10d)  │ ${(kLast.trendSlope>=0?'+':'')+kLast.trendSlope?.toFixed(2).padStart(7)}% │ ${kLast.trendSlope>0.5?'BULLISH trend':kLast.trendSlope<-0.5?'BEARISH trend':'FLAT'}`);
console.log(`  Dispersion Index    │ ${dLast.dispersion.toFixed(2).padStart(8)} │ ${dLast.dispersion<2?'LOW (macro-driven)':dLast.dispersion<4?'MODERATE':'HIGH (stock-picking market)'}`);

// ═══ ULTIMATE REGIME ENGINE — MF + VIX + All 6 Tools ═══
function ultimateRegime(data) {
  const h=hurst(data);const cu=cusum(data);const en=entropy(data);
  const fr=fractalDim(data);const ka=kalman(data);const di=dispersion(data);
  const results=[];

  for(let i=100;i<data.length;i++){
    const c=data[i];
    // ── BASE MF FACTORS (6 factors, 82 pts max) ──
    const ret20=(c.c-data[i-20].c)/data[i-20].c*100;
    let greenDays=0;for(let j=i-19;j<=i;j++)if(data[j].c>data[j-1].c)greenDays++;
    const breadth=greenDays/20*100;
    const rets=[];for(let j=i-19;j<=i;j++)rets.push((data[j].c-data[j-1].c)/data[j-1].c*100);
    const retMean=rets.reduce((s,v)=>s+v,0)/rets.length;
    const vol=Math.sqrt(rets.reduce((s,v)=>s+(v-retMean)**2,0)/rets.length);
    const accel=((data[i].c-data[i-10].c)/data[i-10].c*100)-((data[i-10].c-data[i-20].c)/data[i-20].c*100);
    let e200=data[0].c;for(let j=1;j<=i;j++)e200=data[j].c*(2/201)+e200*(1-2/201);
    const distEma200=((c.c-e200)/e200)*100;

    let score=0;
    if(ret20>5)score+=18;else if(ret20>2)score+=10;else if(ret20>0)score+=3;else if(ret20>-2)score+=-3;else if(ret20>-5)score+=-10;else score+=-18;
    if(breadth>60)score+=15;else if(breadth>52)score+=8;else if(breadth>45)score+=-3;else if(breadth>38)score+=-10;else score+=-15;
    if(vol<0.8)score+=10;else if(vol<1.2)score+=5;else if(vol<1.8)score+=0;else if(vol<2.5)score+=-5;else score+=-10;
    if(accel>2)score+=10;else if(accel>0.5)score+=5;else if(accel>-0.5)score+=0;else if(accel>-2)score+=-5;else score+=-10;
    if(distEma200>5)score+=10;else if(distEma200>0)score+=5;else if(distEma200>-3)score+=-3;else if(distEma200>-8)score+=-7;else score+=-10;

    // ── VIX FACTORS (3 factors, 24 pts max) ──
    const vix=c.vix;
    if(vix<12)score+=5;else if(vix<16)score+=8;else if(vix<22)score+=3;else if(vix<30)score+=-5;else if(vix<45)score+=-8;else score+=3;
    const vix5=i>=5?data[i-5].vix:vix;
    const vixROC=vix5>0?((vix-vix5)/vix5*100):0;
    if(vixROC<-15)score+=8;else if(vixROC<-5)score+=4;else if(vixROC<5)score+=0;else if(vixROC<15)score+=-4;else score+=-8;
    let vixSma=0;for(let j=i-19;j<=i;j++)vixSma+=data[j].vix;vixSma/=20;
    const vixVsSma=((vix-vixSma)/vixSma)*100;
    if(vixVsSma<-15)score+=8;else if(vixVsSma<-5)score+=3;else if(vixVsSma<5)score+=0;else if(vixVsSma<15)score+=-3;else score+=-8;

    // ── ADVANCED TOOLS (6 factors, 48 pts max) ──
    const hR=h.find(x=>x.date===c.date);
    const cuR=cu.find(x=>x.date===c.date);
    const enR=en.find(x=>x.date===c.date);
    const frR=fr.find(x=>x.date===c.date);
    const kaR=ka.find(x=>x.date===c.date);
    const diR=di.find(x=>x.date===c.date);

    // HURST: trending markets favor momentum (weight: 8)
    if(hR){
      if(hR.H>0.65&&ret20>0)score+=8;      // trending + bullish = strong bull
      else if(hR.H>0.65&&ret20<0)score+=-8; // trending + bearish = strong bear
      else if(hR.H<0.4)score+=3;            // mean-reverting = expect bounce (slightly bullish)
      else score+=0;                         // random walk = no edge
    }

    // CUSUM: regime shift detection (weight: 8)
    if(cuR){
      if(cuR.signal==='bullish_shift')score+=8;
      else if(cuR.signal==='bearish_shift')score+=-8;
    }

    // ENTROPY: orderly markets favor trends (weight: 8)
    if(enR){
      if(enR.entropy<0.55&&ret20>0)score+=8;  // low entropy + bullish = confident trend
      else if(enR.entropy<0.55&&ret20<0)score+=-8;
      else if(enR.entropy>0.85)score+=-4;      // high chaos = reduce conviction
      else score+=0;
    }

    // FRACTAL: smooth trends are trustworthy (weight: 8)
    if(frR){
      if(frR.fd<1.25&&ret20>0)score+=8;     // smooth bullish trend
      else if(frR.fd<1.25&&ret20<0)score+=-8;
      else if(frR.fd>1.6)score+=-4;         // choppy = don't trust direction
      else score+=0;
    }

    // KALMAN: filtered trend direction (weight: 8)
    if(kaR&&kaR.trendSlope!==undefined){
      if(kaR.trendSlope>1.0)score+=8;
      else if(kaR.trendSlope>0.3)score+=4;
      else if(kaR.trendSlope>-0.3)score+=0;
      else if(kaR.trendSlope>-1.0)score+=-4;
      else score+=-8;
    }

    // DISPERSION: market character (weight: 8)
    if(diR){
      if(diR.dispersion<1.5&&vol<1.2)score+=8;  // low disp + low vol = calm bull
      else if(diR.dispersion>5)score+=-4;        // extreme range = danger
      else score+=0;
    }

    // Total possible: ~154 pts. Scale to states:
    let state,sizing;
    if(score>=45){state='strong_bull';sizing=1.25;}
    else if(score>=18){state='bull';sizing=1.0;}
    else if(score>=-18){state='neutral';sizing=0.75;}
    else if(score>=-45){state='bear';sizing=0.25;}
    else{state='strong_bear';sizing=0;}

    results.push({date:c.date,state,score,sizing,close:c.c,vix,
      hurst:hR?.H,cusum:cuR?.signal,entropy:enR?.entropy,fractal:frR?.fd,
      kalmanTrend:kaR?.trendSlope,dispersion:diR?.dispersion,
      ret20,breadth,vol,accel,vixROC,vixVsSma});
  }
  return results;
}

const ultimate=ultimateRegime(D);

// Equity simulation
function simEq(data,regime){
  let eq=1000000,pk=1000000,mdd=0;
  const start=data.findIndex(c=>c.date===regime[0]?.date)||100;
  for(let i=Math.max(start+1,101);i<data.length;i++){
    const ret=(data[i].c-data[i-1].c)/data[i-1].c;
    const r=regime.find(x=>x.date===data[i].date);
    eq*=(1+ret*(r?.sizing??1));if(eq>pk)pk=eq;
    const dd=(pk-eq)/pk*100;if(dd>mdd)mdd=dd;
  }
  return{eq,ret:(eq-1000000)/1000000*100,mdd};
}

// Also run MF+VIX (no advanced tools) for comparison
function mfVixOnly(data){
  const results=[];
  for(let i=50;i<data.length;i++){
    const c=data[i];
    const ret20=(c.c-data[i-20].c)/data[i-20].c*100;
    let greenDays=0;for(let j=i-19;j<=i;j++)if(data[j].c>data[j-1].c)greenDays++;
    const breadth=greenDays/20*100;
    const rets=[];for(let j=i-19;j<=i;j++)rets.push((data[j].c-data[j-1].c)/data[j-1].c*100);
    const vol=Math.sqrt(rets.reduce((s,v)=>s+(v-rets.reduce((a,b)=>a+b,0)/rets.length)**2,0)/rets.length);
    const accel=((data[i].c-data[i-10].c)/data[i-10].c*100)-((data[i-10].c-data[i-20].c)/data[i-20].c*100);
    let e200=data[0].c;for(let j=1;j<=i;j++)e200=data[j].c*(2/201)+e200*(1-2/201);
    const distEma200=((c.c-e200)/e200)*100;
    let score=0;
    if(ret20>5)score+=20;else if(ret20>2)score+=12;else if(ret20>0)score+=4;else if(ret20>-2)score+=-4;else if(ret20>-5)score+=-12;else score+=-20;
    if(breadth>60)score+=18;else if(breadth>52)score+=9;else if(breadth>45)score+=-4;else if(breadth>38)score+=-12;else score+=-18;
    if(vol<0.8)score+=12;else if(vol<1.2)score+=6;else if(vol<1.8)score+=0;else if(vol<2.5)score+=-6;else score+=-12;
    if(accel>2)score+=12;else if(accel>0.5)score+=6;else if(accel>-0.5)score+=0;else if(accel>-2)score+=-6;else score+=-12;
    if(distEma200>5)score+=12;else if(distEma200>0)score+=6;else if(distEma200>-3)score+=-4;else score+=-12;
    const vix=c.vix;
    if(vix<12)score+=6;else if(vix<16)score+=10;else if(vix<22)score+=4;else if(vix<30)score+=-6;else if(vix<45)score+=-10;else score+=4;
    const vix5=i>=5?data[i-5].vix:vix;const vixROC=vix5>0?((vix-vix5)/vix5*100):0;
    if(vixROC<-15)score+=8;else if(vixROC<-5)score+=4;else if(vixROC<5)score+=0;else if(vixROC<15)score+=-4;else score+=-8;
    let vixSma=0;for(let j=i-19;j<=i;j++)vixSma+=data[j].vix;vixSma/=20;
    const vixVsSma=((vix-vixSma)/vixSma)*100;
    if(vixVsSma<-15)score+=8;else if(vixVsSma<-5)score+=3;else if(vixVsSma<5)score+=0;else if(vixVsSma<15)score+=-3;else score+=-8;
    let state,sizing;
    if(score>=40){state='strong_bull';sizing=1.25;}else if(score>=15){state='bull';sizing=1.0;}
    else if(score>=-15){state='neutral';sizing=0.75;}else if(score>=-40){state='bear';sizing=0.25;}
    else{state='strong_bear';sizing=0;}
    results.push({date:c.date,state,score,sizing,close:c.c});
  }
  return results;
}
const mfvix=mfVixOnly(D);

const eqBH=simEq(D,[]);
const eqMFV=simEq(D,mfvix);
const eqUlt=simEq(D,ultimate);

// 3-day smoothed
function smooth3(r){const s=[...r];for(let i=3;i<s.length;i++){if(s[i].state!==s[i-1].state){let ok=true;for(let j=1;j<3;j++)if(i+j>=r.length||r[i+j].state!==r[i].state)ok=false;if(!ok)s[i]={...s[i],state:s[i-1].state,sizing:s[i-1].sizing};}}return s;}
const ultSmooth=smooth3(ultimate);
const eqUltS=simEq(D,ultSmooth);

console.log('\n═══ EQUITY COMPARISON ═══\n');
console.log('Method                        │ Final Equity │ Return   │ Max DD  │ Ret/DD');
console.log('──────────────────────────────┼──────────────┼──────────┼─────────┼───────');
console.log(`Buy & Hold                     │ Rs.${(eqBH.eq/100000).toFixed(1)}L     │ +${eqBH.ret.toFixed(0).padStart(5)}% │ ${eqBH.mdd.toFixed(1).padStart(6)}% │ ${(eqBH.ret/eqBH.mdd).toFixed(1)}`);
console.log(`MF + VIX (8 factors)           │ Rs.${(eqMFV.eq/100000).toFixed(1)}L     │ +${eqMFV.ret.toFixed(0).padStart(5)}% │ ${eqMFV.mdd.toFixed(1).padStart(6)}% │ ${(eqMFV.ret/eqMFV.mdd).toFixed(1)}`);
console.log(`★ ULTIMATE (14 factors)        │ Rs.${(eqUlt.eq/100000).toFixed(1)}L     │ +${eqUlt.ret.toFixed(0).padStart(5)}% │ ${eqUlt.mdd.toFixed(1).padStart(6)}% │ ${(eqUlt.ret/eqUlt.mdd).toFixed(1)}`);
console.log(`★ ULTIMATE + 3d smooth         │ Rs.${(eqUltS.eq/100000).toFixed(1)}L     │ +${eqUltS.ret.toFixed(0).padStart(5)}% │ ${eqUltS.mdd.toFixed(1).padStart(6)}% │ ${(eqUltS.ret/eqUltS.mdd).toFixed(1)}`);

// Regime distribution
console.log('\n═══ ULTIMATE REGIME DISTRIBUTION ═══\n');
const dist={};ultimate.forEach(d=>{dist[d.state]=(dist[d.state]||0)+1;});
for(const[state,count]of Object.entries(dist).sort((a,b)=>b[1]-a[1])){
  console.log(`  ${state.padEnd(15)} ${String(count).padStart(5)} days (${(count/ultimate.length*100).toFixed(1)}%)`);
}

// Transitions
let trans=0;for(let i=1;i<ultimate.length;i++)if(ultimate[i].state!==ultimate[i-1].state)trans++;
let transS=0;for(let i=1;i<ultSmooth.length;i++)if(ultSmooth[i].state!==ultSmooth[i-1].state)transS++;
console.log(`\n  Raw transitions: ${trans} (avg ${(ultimate.length/trans).toFixed(0)} days/regime)`);
console.log(`  Smoothed transitions: ${transS} (avg ${(ultSmooth.length/transS).toFixed(0)} days/regime)`);

// COVID timeline
console.log('\n═══ COVID CRASH: ULTIMATE vs MF+VIX ═══\n');
console.log('Date       │ Nifty  │ VIX   │ MF+VIX       │ ULTIMATE     │ Hurst │ Entropy │ CUSUM');
console.log('───────────┼────────┼───────┼──────────────┼──────────────┼───────┼─────────┼──────');
for(const dt of ['2020-02-03','2020-02-20','2020-02-26','2020-03-06','2020-03-16','2020-03-23','2020-04-01','2020-04-09','2020-04-22','2020-05-04','2020-06-01']){
  const u=ultimate.find(r=>r.date===dt);const v=mfvix.find(r=>r.date===dt);
  if(!u||!v)continue;
  console.log(`${dt} │ ${u.close.toFixed(0).padStart(6)} │ ${u.vix.toFixed(1).padStart(5)} │ ${(v.state+'('+v.score+')').padEnd(12)} │ ${(u.state+'('+u.score+')').padEnd(12)} │ ${u.hurst?.toFixed(2)||'—'} │ ${u.entropy?.toFixed(2).padStart(7)||'—'} │ ${u.cusum||'none'}`);
}

// Recent period
console.log('\n═══ RECENT 20 DAYS: ULTIMATE READINGS ═══\n');
console.log('Date       │ Nifty  │ VIX   │ State        │ Score │ Hurst │ Entropy │ Kalman │ Fractal │ Sizing');
console.log('───────────┼────────┼───────┼──────────────┼───────┼───────┼─────────┼────────┼─────────┼───────');
for(const u of ultimate.slice(-20)){
  console.log(`${u.date} │ ${u.close.toFixed(0).padStart(6)} │ ${u.vix.toFixed(1).padStart(5)} │ ${u.state.padEnd(12)} │ ${(u.score>=0?'+':'')+String(u.score).padStart(5)} │ ${u.hurst?.toFixed(2)||'—'} │ ${u.entropy?.toFixed(2).padStart(7)||'—'} │ ${u.kalmanTrend?.toFixed(2).padStart(6)||'—'}% │ ${u.fractal?.toFixed(2).padStart(7)||'—'} │ ×${u.sizing}`);
}

// Today
const t=ultimate[ultimate.length-1];
console.log(`\n${'█'.repeat(85)}`);
console.log('  TODAY: ULTIMATE 14-FACTOR REGIME');
console.log('█'.repeat(85));
console.log(`\n  State: ${t.state.toUpperCase()} (composite score: ${t.score>=0?'+':''}${t.score})`);
console.log(`  Position sizing: ×${t.sizing}\n`);
console.log('  Factor breakdown:');
console.log(`    Momentum (20d):   ${t.ret20>=0?'+':''}${t.ret20.toFixed(2)}%`);
console.log(`    Breadth:          ${t.breadth.toFixed(0)}% green days`);
console.log(`    Volatility:       ${t.vol.toFixed(2)}%`);
console.log(`    Acceleration:     ${t.accel>=0?'+':''}${t.accel.toFixed(2)}%`);
console.log(`    VIX Level:        ${t.vix.toFixed(2)}`);
console.log(`    VIX ROC (5d):     ${t.vixROC>=0?'+':''}${t.vixROC.toFixed(1)}%`);
console.log(`    VIX vs SMA:       ${t.vixVsSma>=0?'+':''}${t.vixVsSma.toFixed(1)}%`);
console.log(`    Hurst Exponent:   ${t.hurst?.toFixed(3)} ${t.hurst>0.6?'(TRENDING)':t.hurst>0.45?'(RANDOM)':'(MEAN-REV)'}`);
console.log(`    CUSUM:            ${t.cusum||'no shift detected'}`);
console.log(`    Shannon Entropy:  ${t.entropy?.toFixed(3)} ${t.entropy<0.6?'(ORDERLY)':t.entropy<0.8?'(MODERATE)':'(CHAOTIC)'}`);
console.log(`    Fractal Dim:      ${t.fractal?.toFixed(3)} ${t.fractal<1.3?'(SMOOTH)':t.fractal<1.6?'(MODERATE)':'(CHOPPY)'}`);
console.log(`    Kalman Trend:     ${t.kalmanTrend>=0?'+':''}${t.kalmanTrend?.toFixed(2)}%`);
console.log(`    Dispersion:       ${t.dispersion?.toFixed(2)}`);
