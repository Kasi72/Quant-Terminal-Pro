// ULTRA STOP RESEARCH — 12 Advanced Statistical Methods to Eliminate Shakeouts
// Tests cutting-edge math/stats on 29 OHLCV files
// Goal: ONLY genuine trend reversals trigger stop — all shakeouts filtered

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));

function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

// Collect all signals with rich context
const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);
  for(let i=40;i<c.length-11;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const entry=s.c,atrVal=a[i],zoneLow=bZ.zL;
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=Math.max(i-Math.max(0,i-20),1);
    const t1Pct=Math.max(3,Math.min(5,2.15*atrVal/entry*100));
    const stopRaw=(entry-(zoneLow-0.5*atrVal))/entry*100;
    const stopPct=Math.max(3.5,Math.min(8,stopRaw));

    // Pre-compute 20-day close std dev for Z-score
    const closes20=[];for(let j=Math.max(0,i-20);j<=i;j++)closes20.push(c[j].c);
    const mean20=closes20.reduce((s,v)=>s+v,0)/closes20.length;
    const std20=Math.sqrt(closes20.reduce((s,v)=>s+(v-mean20)**2,0)/closes20.length);

    // Pre-compute OBV slope (last 10 days)
    let obv=0;const obvArr=[];
    for(let j=Math.max(1,i-14);j<=i;j++){
      obv+=c[j].c>c[j-1].c?c[j].v:c[j].c<c[j-1].c?-c[j].v:0;
      obvArr.push(obv);
    }
    const obvSlope10=obvArr.length>=5?(obvArr[obvArr.length-1]-obvArr[Math.max(0,obvArr.length-5)])/5:0;

    // Future candles with enriched data
    const future=[];
    let prevOBV=obv;
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const fc=c[d],day=d-i,range=fc.h-fc.l;
      const atrD=a[d]||atrVal;
      // Z-score of close relative to entry
      const zScore=std20>0?(fc.c-entry)/std20:0;
      // Close distance in ATR units
      const closeATR=atrD>0?(fc.c-entry)/atrD:0;
      // OBV
      prevOBV+=fc.c>c[d-1].c?fc.v:fc.c<c[d-1].c?-fc.v:0;
      const obvChange=prevOBV-obv;
      // Buying pressure: (close-low)/(high-low) × volume
      const buyPressure=range>0?(fc.c-fc.l)/range*fc.v:0;
      const sellPressure=range>0?(fc.h-fc.c)/range*fc.v:0;
      const bsRatio=sellPressure>0?buyPressure/sellPressure:10;
      // Consecutive red candles count
      let consecRed=0;for(let k=d;k>=Math.max(i+1,d-4);k--){if(c[k].c<c[k].o)consecRed++;else break;}
      // RSI-2 at this candle
      let rsiG=0,rsiL=0;
      if(d>=2){const ch1=c[d].c-c[d-1].c,ch2=c[d-1].c-c[d-2].c;rsiG=((ch2>0?ch2:0)+(ch1>0?ch1:0))/2;rsiL=((ch2<0?-ch2:0)+(ch1<0?-ch1:0))/2;}
      const rsi2=rsiL<0.001?100:100-100/(1+rsiG/rsiL);
      // Lower shadow ratio
      const lwPct=range>0?(Math.min(fc.o,fc.c)-fc.l)/range*100:0;
      const closeLoc=range>0?(fc.c-fc.l)/range*100:50;

      future.push({day,o:fc.o,h:fc.h,l:fc.l,c:fc.c,v:fc.v,
        pctH:(fc.h-entry)/entry*100,pctL:(fc.l-entry)/entry*100,pctC:(fc.c-entry)/entry*100,
        isGreen:fc.c>fc.o,closeLoc,lwPct,volR:v20>0?fc.v/v20:1,
        zScore,closeATR,obvChange,bsRatio,consecRed,rsi2,atrD,range});
    }
    let mfe=0,mae=0;for(const f of future){if(f.pctH>mfe)mfe=f.pctH;if(f.pctL<mae)mae=f.pctL;}
    ALL.push({sym,date:c[i].date,entry,atrVal,zoneLow,v20,stopPct,t1Pct,future,mfe,mae,std20,obvSlope10});
  }
}
ALL.sort((a,b)=>a.entry-b.entry);
const winners=ALL.filter(s=>s.mfe>=5).length;
console.log(`Signals: ${ALL.length} | Winners(MFE≥5%): ${winners}\n`);

function simulate(signals, name, checkFn){
  let wins=0,losses=0,falseStops=0,winR=0,lossR=0;
  const falseList=[];
  for(const s of signals){
    let stopped=false,t1Hit=false,stDay=0;
    for(const f of s.future){
      if(!t1Hit&&f.pctH>=s.t1Pct){t1Hit=true;break;}
      if(checkFn(s,f)){stopped=true;stDay=f.day;break;}
    }
    const isFalse=stopped&&s.mfe>=5;
    if(stopped){losses++;lossR+=-1;if(isFalse){falseStops++;falseList.push({...s,stDay});}}
    else if(t1Hit){wins++;winR+=s.t1Pct/s.stopPct;}
  }
  const decided=wins+losses;
  return{name,wins,losses,falseStops,decided,winRate:decided>0?wins/decided*100:0,
    expectancy:decided>0?(winR+lossR)/decided:0,totalR:winR+lossR,
    falseRate:(falseStops/winners*100),falseList};
}

// ═══ CURRENT TRIPLE (baseline for comparison) ═══
const TRIPLE = (s,f) => {
  if(f.pctC>-s.stopPct)return false;
  if(f.lwPct>=40&&f.closeLoc>=50)return false;
  if(f.isGreen&&f.closeLoc>=50)return false;
  return true;
};

// ═══ METHOD 1: Z-Score Confirmation ═══
// Only stop if close Z-score < -2.0 (statistically significant deviation)
const M1_ZSCORE = (s,f) => {
  if(f.pctC>-s.stopPct)return false;
  if(f.zScore > -1.5) return false; // dip is within normal noise
  if(f.lwPct>=40&&f.closeLoc>=50)return false;
  if(f.isGreen)return false;
  return true;
};

// ═══ METHOD 2: ATR-Normalized Close Distance ═══
// Only stop if close is > 1.5 ATR below entry (not just % based)
const M2_ATRCLOSE = (s,f) => {
  if(f.pctC>-s.stopPct)return false;
  if(f.closeATR > -1.0) return false; // less than 1 ATR below — noise
  if(f.lwPct>=40&&f.closeLoc>=50)return false;
  if(f.isGreen)return false;
  return true;
};

// ═══ METHOD 3: OBV Divergence ═══
// Only stop if OBV is also declining (volume confirms the selling)
const M3_OBV = (s,f) => {
  if(f.pctC>-s.stopPct)return false;
  if(f.obvChange > 0) return false; // OBV rising = accumulation despite price dip
  if(f.lwPct>=40&&f.closeLoc>=50)return false;
  if(f.isGreen)return false;
  return true;
};

// ═══ METHOD 4: Buying Pressure Ratio ═══
// Only stop if selling pressure dominates (close near low, not near high)
const M4_PRESSURE = (s,f) => {
  if(f.pctC>-s.stopPct)return false;
  if(f.bsRatio > 0.6) return false; // buyers still active
  if(f.isGreen)return false;
  return true;
};

// ═══ METHOD 5: Consecutive Red Confirmation ═══
// Only stop if 2+ consecutive red candles (single red = noise)
const M5_CONSEC = (s,f) => {
  if(f.pctC>-s.stopPct)return false;
  if(f.consecRed < 2) return false; // single red candle = possible shakeout
  if(f.lwPct>=40&&f.closeLoc>=50)return false;
  if(f.isGreen)return false;
  return true;
};

// ═══ METHOD 6: RSI-2 Oversold Filter ═══
// Don't stop if RSI-2 < 10 (extremely oversold = likely to bounce)
const M6_RSI = (s,f) => {
  if(f.pctC>-s.stopPct)return false;
  if(f.rsi2 < 10) return false; // oversold bounce likely
  if(f.lwPct>=40&&f.closeLoc>=50)return false;
  if(f.isGreen)return false;
  return true;
};

// ═══ METHOD 7: Volume Climax Detection ═══
// Don't stop if volume is > 3× average (panic selling = capitulation = reversal likely)
const M7_CLIMAX = (s,f) => {
  if(f.pctC>-s.stopPct)return false;
  if(f.volR > 3.0 && f.closeLoc > 30) return false; // volume climax with some recovery
  if(f.lwPct>=40&&f.closeLoc>=50)return false;
  if(f.isGreen)return false;
  return true;
};

// ═══ METHOD 8: Close-Below-Zone Confirmation ═══
// Only stop if close falls below the zone LOW (not just below stop level)
const M8_ZONEBREACH = (s,f) => {
  if(f.c > s.zoneLow) return false; // close still above zone — breakout alive
  if(f.lwPct>=40&&f.closeLoc>=50)return false;
  if(f.isGreen)return false;
  return true;
};

// ═══ METHOD 9: 2-Day Close Confirmation ═══
// Require 2 consecutive days of close below stop (eliminates 1-day shakeouts)
const M9_2DAY = (s,f) => {
  if(f.pctC>-s.stopPct)return false;
  // Check if PREVIOUS day also closed below stop
  const prev=s.future.find(x=>x.day===f.day-1);
  if(!prev||prev.pctC>-s.stopPct)return false; // first day below — wait
  if(f.isGreen&&f.closeLoc>=50)return false;
  return true;
};

// ═══ METHOD 10: Bayesian Stop — P(reversal) must exceed threshold ═══
// Combine multiple signals into a probability score
const M10_BAYES = (s,f) => {
  if(f.pctC>-s.stopPct)return false;
  let score=0, maxScore=0;
  // Factor 1: Close below stop (base requirement met)
  score+=1; maxScore+=1;
  // Factor 2: Red candle
  if(!f.isGreen){score+=1;} maxScore+=1;
  // Factor 3: Close in lower 40%
  if(f.closeLoc<40){score+=1;} maxScore+=1;
  // Factor 4: Volume confirms (≥0.8×)
  if(f.volR>=0.8){score+=1;} maxScore+=1;
  // Factor 5: No hammer
  if(f.lwPct<35){score+=1;} maxScore+=1;
  // Factor 6: OBV declining
  if(f.obvChange<0){score+=1;} maxScore+=1;
  // Factor 7: Consecutive red
  if(f.consecRed>=2){score+=1;} maxScore+=1;
  // Factor 8: Not oversold bounce
  if(f.rsi2>15){score+=1;} maxScore+=1;
  // Probability threshold: need ≥75% of factors
  const prob=score/maxScore;
  if(prob<0.75)return false;
  return true;
};

// ═══ METHOD 11: Markov-Enhanced TRIPLE ═══
// TRIPLE + Z-score + OBV + consecutive red (layer everything)
const M11_MARKOV = (s,f) => {
  if(f.pctC>-s.stopPct)return false;
  // Layer 1: TRIPLE base filters
  if(f.lwPct>=40&&f.closeLoc>=50)return false; // hammer
  if(f.isGreen&&f.closeLoc>=50)return false; // green recovery
  // Layer 2: Z-score must be significant
  if(f.zScore > -1.0) return false;
  // Layer 3: OBV must confirm
  if(f.obvChange > 0) return false;
  return true;
};

// ═══ METHOD 12: ULTIMATE STATISTICAL — All best filters combined ═══
const M12_ULTIMATE = (s,f) => {
  if(f.pctC>-s.stopPct)return false;
  // TRIPLE base
  if(f.lwPct>=40&&f.closeLoc>=50)return false;
  if(f.isGreen&&f.closeLoc>=50)return false;
  // Close must be in lower 40% of candle
  if(f.closeLoc>=45)return false;
  // OBV must not be rising
  if(f.obvChange>0)return false;
  // RSI-2 not deeply oversold (bounce likely)
  if(f.rsi2<8)return false;
  // Not a volume climax with recovery
  if(f.volR>3.0&&f.closeLoc>25)return false;
  return true;
};

// Run all methods
const methods = [
  ['CURRENT TRIPLE', TRIPLE],
  ['M1: Z-Score (<-1.5σ)', M1_ZSCORE],
  ['M2: ATR-Close (<-1.0 ATR)', M2_ATRCLOSE],
  ['M3: OBV Divergence', M3_OBV],
  ['M4: Buy/Sell Pressure', M4_PRESSURE],
  ['M5: 2+ Consecutive Red', M5_CONSEC],
  ['M6: RSI-2 Oversold Filter', M6_RSI],
  ['M7: Volume Climax Detection', M7_CLIMAX],
  ['M8: Close-Below-Zone', M8_ZONEBREACH],
  ['M9: 2-Day Close Confirm', M9_2DAY],
  ['M10: Bayesian Multi-Factor (≥75%)', M10_BAYES],
  ['M11: Markov TRIPLE+Z+OBV', M11_MARKOV],
  ['M12: ULTIMATE Statistical', M12_ULTIMATE],
];

console.log('█'.repeat(90));
console.log('  ULTRA STOP RESEARCH — 12 ADVANCED METHODS vs CURRENT TRIPLE');
console.log('  29 OHLCV · '+ALL.length+' signals · '+winners+' winners · 10-day horizon');
console.log('█'.repeat(90));

console.log('\n  Method                              │FalseStop│FalseRate│ Wins │ WinRate│  Exp/R │ TotalR │ Verdict');
console.log('  ────────────────────────────────────┼─────────┼─────────┼──────┼────────┼────────┼────────┼────────');
const results=[];
for(const[name,fn]of methods){
  const r=simulate(ALL,name,fn);
  results.push(r);
  const better=r.falseStops<3?'◀◀◀':r.falseStops===3?'SAME':'';
  console.log(`  ${name.padEnd(36)} │ ${String(r.falseStops).padStart(7)} │ ${r.falseRate.toFixed(1).padStart(7)}% │ ${String(r.wins).padStart(4)} │ ${r.winRate.toFixed(1).padStart(6)}% │ ${r.expectancy.toFixed(3).padStart(6)}R │ ${r.totalR.toFixed(0).padStart(6)} │ ${better}`);
}

// Rank by false stops (lower = better), then by expectancy
console.log('\n' + '═'.repeat(90));
console.log('  RANKED BY FALSE STOP ELIMINATION');
console.log('═'.repeat(90));
const ranked=results.filter(r=>r.expectancy>0).sort((a,b)=>a.falseStops-b.falseStops||b.expectancy-a.expectancy);
console.log('\n  Rank │ Method                              │FalseStop│ Wins │ WinRate│ Exp/R  │ vs TRIPLE');
console.log('  ─────┼─────────────────────────────────────┼─────────┼──────┼────────┼────────┼──────────');
for(let i=0;i<ranked.length;i++){
  const r=ranked[i], delta=r.falseStops-3;
  console.log(`  ${String(i+1).padStart(4)} │ ${r.name.padEnd(35)} │ ${String(r.falseStops).padStart(7)} │ ${String(r.wins).padStart(4)} │ ${r.winRate.toFixed(1).padStart(6)}% │ ${r.expectancy.toFixed(3).padStart(6)}R │ ${delta<=0?(delta===0?'SAME':delta+' fewer'):'+'+delta+' more'}`);
}

// Deep dive on methods that beat TRIPLE
console.log('\n' + '═'.repeat(90));
console.log('  METHODS THAT BEAT TRIPLE (<3 false stops)');
console.log('═'.repeat(90));
for(const r of ranked.filter(r=>r.falseStops<3)){
  console.log(`\n  ═══ ${r.name} — ${r.falseStops} false stops ═══`);
  console.log(`  Wins: ${r.wins} | WR: ${r.winRate.toFixed(1)}% | Exp: ${r.expectancy.toFixed(3)}R | TotalR: ${r.totalR.toFixed(0)}`);
  if(r.falseList.length>0){
    console.log('  Remaining false stops:');
    for(const f of r.falseList){
      const fc=f.future.find(x=>x.day===f.stDay);
      console.log(`    ${f.sym} ${f.date} Day${f.stDay}: MFE+${f.mfe.toFixed(1)}% MAE${f.mae.toFixed(1)}% | Close${fc?.pctC.toFixed(1)}% Z${fc?.zScore.toFixed(2)} OBV${fc?.obvChange>0?'+':''}${(fc?.obvChange/1e6).toFixed(1)}M RSI${fc?.rsi2.toFixed(0)} ConsRed${fc?.consecRed} BS${fc?.bsRatio.toFixed(2)}`);
    }
  } else console.log('  ★ ZERO FALSE STOPS!');
}

// Walk-forward validation on top methods
console.log('\n' + '═'.repeat(90));
console.log('  WALK-FORWARD (70/30) ON TOP METHODS');
console.log('═'.repeat(90));
const sorted=[...ALL].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const sp=Math.floor(sorted.length*0.70);
for(const[name,fn]of methods.filter(([n])=>['M8: Close-Below-Zone','M9: 2-Day Close Confirm','M10: Bayesian Multi-Factor (≥75%)','M11: Markov TRIPLE+Z+OBV','M12: ULTIMATE Statistical','CURRENT TRIPLE'].includes(n))){
  const isR=simulate(sorted.slice(0,sp),name,fn);
  const oosR=simulate(sorted.slice(sp),name,fn);
  console.log(`\n  ${name}`);
  console.log(`    IS:  ${isR.wins}W/${isR.losses}L, WR ${isR.winRate.toFixed(1)}%, Exp ${isR.expectancy.toFixed(3)}R, False ${isR.falseStops}`);
  console.log(`    OOS: ${oosR.wins}W/${oosR.losses}L, WR ${oosR.winRate.toFixed(1)}%, Exp ${oosR.expectancy.toFixed(3)}R, False ${oosR.falseStops}`);
}

// Monte Carlo on top 3
console.log('\n' + '═'.repeat(90));
console.log('  MONTE CARLO (500 shuffles) ON TOP METHODS');
console.log('═'.repeat(90));
for(const[name,fn]of methods.filter(([n])=>['M9: 2-Day Close Confirm','M10: Bayesian Multi-Factor (≥75%)','M11: Markov TRIPLE+Z+OBV','M12: ULTIMATE Statistical','CURRENT TRIPLE'].includes(n))){
  const mcFS=[],mcWR=[],mcExp=[];
  for(let mc=0;mc<500;mc++){
    const sh=[...ALL].sort(()=>Math.random()-0.5);
    const oos=sh.slice(Math.floor(sh.length*0.70));
    const r=simulate(oos,name,fn);
    if(r.decided>0){mcFS.push(r.falseStops);mcWR.push(r.winRate);mcExp.push(r.expectancy);}
  }
  mcFS.sort((a,b)=>a-b);mcWR.sort((a,b)=>a-b);mcExp.sort((a,b)=>a-b);
  const p=(arr,pct)=>arr[Math.floor(arr.length*pct)];
  console.log(`\n  ${name}`);
  console.log(`    FalseStops: median=${p(mcFS,0.5)} | 95th=${p(mcFS,0.95)} | max=${mcFS[mcFS.length-1]}`);
  console.log(`    WinRate:    median=${p(mcWR,0.5).toFixed(1)}% | 5th=${p(mcWR,0.05).toFixed(1)}%`);
  console.log(`    Expectancy: median=${p(mcExp,0.5).toFixed(3)}R | 5th=${p(mcExp,0.05).toFixed(3)}R`);
  console.log(`    P(zero false stops): ${(mcFS.filter(f=>f===0).length/mcFS.length*100).toFixed(1)}%`);
}

// The 3 remaining TRIPLE false stops — what would each method do?
console.log('\n' + '═'.repeat(90));
console.log('  HOW EACH METHOD HANDLES THE 3 TRIPLE FALSE STOPS');
console.log('═'.repeat(90));
const tripleResult=simulate(ALL,'TRIPLE',TRIPLE);
for(const f of tripleResult.falseList){
  console.log(`\n  ${f.sym} ${f.date} (MFE+${f.mfe.toFixed(1)}%, MAE${f.mae.toFixed(1)}%)`);
  const fc=f.future.find(x=>x.day===f.stDay);
  console.log(`    Stop day ${f.stDay}: Close${fc?.pctC.toFixed(1)}% | Z=${fc?.zScore.toFixed(2)} | OBV=${(fc?.obvChange/1e6).toFixed(2)}M | RSI2=${fc?.rsi2.toFixed(0)} | BS=${fc?.bsRatio.toFixed(2)} | ConsRed=${fc?.consecRed} | VolR=${fc?.volR.toFixed(1)}`);
  for(const[name,fn]of methods.slice(1)){
    const would=fn(f,fc);
    console.log(`    ${would?'✗ STOPS':'✓ SAVES'} — ${name}`);
  }
}
