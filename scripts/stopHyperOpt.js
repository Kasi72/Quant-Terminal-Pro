// Stop-Loss Hyper-Optimization — Fine grid + ATR-hybrid + signal quality filters
const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/drkkr/Downloads/Portfolio';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv') && !f.includes('(1)'));

function parseCSV(filepath) {
  const lines = fs.readFileSync(filepath, 'utf8').trim().split('\n');
  const candles = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, o, h, l, c, v] = lines[i].split(',');
    const [d, m, y] = date.split('-');
    const months = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
    candles.push({ ts: new Date(+y, months[m], +d).getTime()/1000, o:+o, h:+h, l:+l, c:+c, v:+v });
  }
  return candles;
}

function computeATR14(candles) {
  const atr = new Array(candles.length).fill(0);
  if (candles.length < 15) return atr;
  let sum = 0;
  for (let i = 1; i <= 14; i++) sum += Math.max(candles[i].h-candles[i].l, Math.abs(candles[i].h-candles[i-1].c), Math.abs(candles[i].l-candles[i-1].c));
  atr[14] = sum/14;
  for (let i = 15; i < candles.length; i++) {
    const tr = Math.max(candles[i].h-candles[i].l, Math.abs(candles[i].h-candles[i-1].c), Math.abs(candles[i].l-candles[i-1].c));
    atr[i] = (atr[i-1]*13+tr)/14;
  }
  return atr;
}

function findSignals(candles, atr) {
  const signals = [];
  for (let i = 40; i < candles.length - 11; i++) {
    const sig = candles[i], r = sig.h-sig.l;
    if (r <= 0 || sig.c <= 0 || atr[i] <= 0) continue;
    const rangeATR = r/atr[i], closeLoc = (sig.c-sig.l)/r*100, bodyPct = Math.abs(sig.c-sig.o)/r*100;
    const uwPct = (sig.h-Math.max(sig.o,sig.c))/r*100;
    let compressed = true;
    for (let j = i-6; j < i; j++) { if (j<1){compressed=false;break;} const pTr=Math.max(candles[j].h-candles[j].l,Math.abs(candles[j].h-candles[j-1].c),Math.abs(candles[j].l-candles[j-1].c)); if(pTr/atr[j]>1.0){compressed=false;break;} }
    if (!compressed) continue;
    let zH=-Infinity, zL=Infinity;
    for (let j=i-6;j<i;j++){if(j<0)continue; zH=Math.max(zH,candles[j].h); zL=Math.min(zL,candles[j].l);}
    if (sig.c <= zH*1.001) continue;
    let volSum=0; for(let j=Math.max(0,i-20);j<i;j++) volSum+=candles[j].v;
    const avgVol=volSum/Math.max(i-Math.max(0,i-20),1), volRatio=avgVol>0?sig.v/avgVol:0;
    // Pre-5 vol avg
    let vol5Sum=0; for(let j=Math.max(0,i-5);j<i;j++) vol5Sum+=candles[j].v;
    const vol5Avg=vol5Sum/Math.max(i-Math.max(0,i-5),1), volVsPre5=vol5Avg>0?sig.v/vol5Avg:0;
    // Pre-10 avg range ATR
    let pre10RangeSum=0, pre10Count=0;
    for(let j=i-10;j<i;j++){if(j<1)continue; pre10RangeSum+=(candles[j].h-candles[j].l)/atr[j]; pre10Count++;}
    const pre10AvgRangeATR=pre10Count>0?pre10RangeSum/pre10Count:1;
    // Volatility expansion ratio
    const volExpRatio = pre10AvgRangeATR > 0 ? rangeATR / pre10AvgRangeATR : 1;
    // ADR%
    const adrPct = (atr[i]/sig.c)*100;

    if (rangeATR<1.0||closeLoc<60||bodyPct<30||uwPct>40||volRatio<1.2) continue;

    signals.push({ idx:i, entry:candles[i+1]?.o||sig.c, zoneLow:zL, zoneHigh:zH, atr:atr[i],
      rangeATR, closeLoc, bodyPct, uwPct, volRatio, volVsPre5, volExpRatio, pre10AvgRangeATR, adrPct });
  }
  return signals;
}

// ═══ TEST 1: Fine grid fixed % stops ═══
console.log('=== TEST 1: FINE GRID FIXED % STOPS ===\n');
const fineStops = [1.5,1.75,2.0,2.25,2.5,2.75,3.0,3.25,3.5,3.75,4.0,4.5,5.0];
const r1 = {};
for (const sw of fineStops) r1[sw]={total:0,hits:0,stops:0,expired:0,totalR:0,falseStops:0};

// ═══ TEST 2: ATR-based stops ═══
const atrMults = [0.5,0.75,1.0,1.25,1.5,1.75,2.0,2.5];
const r2 = {};
for (const m of atrMults) r2[m]={total:0,hits:0,stops:0,expired:0,totalR:0,falseStops:0};

// ═══ TEST 3: Hybrid stops — max(fixed%, ATR-based) ═══
const hybrids = [{fix:2.0,atr:1.0},{fix:2.5,atr:1.0},{fix:2.5,atr:1.25},{fix:3.0,atr:1.0},{fix:3.0,atr:1.25},{fix:3.0,atr:1.5},{fix:3.5,atr:1.25},{fix:3.5,atr:1.5}];
const r3 = {};
for (const h of hybrids) { const k=`${h.fix}%|${h.atr}ATR`; r3[k]={total:0,hits:0,stops:0,expired:0,totalR:0,falseStops:0,avgStopPct:0}; }

// ═══ TEST 4: Signal-quality filtered (only high-quality signals) ═══
const r4 = {};
for (const sw of [2.0,2.5,3.0,3.5]) r4[sw]={total:0,hits:0,stops:0,expired:0,totalR:0,falseStops:0};

for (const file of files) {
  const candles = parseCSV(path.join(DIR, file));
  if (candles.length < 60) continue;
  const atr = computeATR14(candles);
  const signals = findSignals(candles, atr);

  for (const sig of signals) {
    const entry = sig.entry * 1.0005;
    if (entry <= 0) continue;
    const atrPct = (sig.atr/entry)*100;
    const t1Pct = Math.max(3.0, Math.min(5.0, 2.15*atrPct));
    const target1 = entry*(1+t1Pct/100);

    function simulate(stopLoss) {
      let exitType='expired', exitPrice=0, mfe=0;
      const rps = entry-stopLoss; if(rps<=0)return null;
      for(let d=sig.idx+2;d<=Math.min(sig.idx+11,candles.length-1);d++){
        const dc=candles[d];
        if(dc.h>entry) mfe=Math.max(mfe,(dc.h-entry)/entry*100);
        if(dc.l<=stopLoss){exitType='stopped';exitPrice=stopLoss;break;}
        if(dc.h>=target1){exitType='target';exitPrice=target1;break;}
      }
      if(exitType==='expired'){const li=Math.min(sig.idx+11,candles.length-1);exitPrice=candles[li].c;}
      return {exitType, pnlR:(exitPrice-entry)/rps, falseStop:exitType==='stopped'&&mfe>=t1Pct};
    }

    // Test 1: Fixed %
    for(const sw of fineStops){
      const sl=entry*(1-sw/100), res=simulate(sl); if(!res)continue;
      r1[sw].total++; r1[sw].totalR+=res.pnlR;
      if(res.exitType==='target')r1[sw].hits++; else if(res.exitType==='stopped'){r1[sw].stops++;if(res.falseStop)r1[sw].falseStops++;} else r1[sw].expired++;
    }

    // Test 2: ATR-based
    for(const m of atrMults){
      const sl=entry-m*sig.atr, res=simulate(sl); if(!res)continue;
      r2[m].total++; r2[m].totalR+=res.pnlR;
      if(res.exitType==='target')r2[m].hits++; else if(res.exitType==='stopped'){r2[m].stops++;if(res.falseStop)r2[m].falseStops++;} else r2[m].expired++;
    }

    // Test 3: Hybrid
    for(const h of hybrids){
      const k=`${h.fix}%|${h.atr}ATR`;
      const sl=Math.min(entry*(1-h.fix/100), entry-h.atr*sig.atr); // wider of the two
      const res=simulate(sl); if(!res)continue;
      r3[k].total++; r3[k].totalR+=res.pnlR; r3[k].avgStopPct+=((entry-sl)/entry)*100;
      if(res.exitType==='target')r3[k].hits++; else if(res.exitType==='stopped'){r3[k].stops++;if(res.falseStop)r3[k].falseStops++;} else r3[k].expired++;
    }

    // Test 4: Signal-quality filtered (high conviction only)
    const hc = sig.volVsPre5>=2.0 && sig.volExpRatio>=1.25 && sig.closeLoc>=65 && sig.bodyPct>=35;
    if (hc) {
      for(const sw of [2.0,2.5,3.0,3.5]){
        const sl=entry*(1-sw/100), res=simulate(sl); if(!res)continue;
        r4[sw].total++; r4[sw].totalR+=res.pnlR;
        if(res.exitType==='target')r4[sw].hits++; else if(res.exitType==='stopped'){r4[sw].stops++;if(res.falseStop)r4[sw].falseStops++;} else r4[sw].expired++;
      }
    }
  }
}

function printTable(label, data, keys) {
  console.log(label);
  console.log('Key       | Trades | Hits | Stops | FalseStop | Hit%  | Exp/R  | AvgStop%');
  console.log('----------|--------|------|-------|-----------|-------|--------|--------');
  for(const k of keys){
    const r=data[k]; if(!r||r.total===0)continue;
    const hitP=(r.hits/r.total*100).toFixed(1), exp=(r.totalR/r.total).toFixed(3);
    const fs=r.stops>0?(r.falseStops/r.stops*100).toFixed(0)+'%':'0%';
    const avgS=r.avgStopPct?(r.avgStopPct/r.total).toFixed(2)+'%':'—';
    console.log(`${String(k).padEnd(9)} | ${String(r.total).padStart(6)} | ${String(r.hits).padStart(4)} | ${String(r.stops).padStart(5)} | ${fs.padStart(9)} | ${hitP.padStart(4)}% | ${exp.padStart(5)}R | ${avgS}`);
  }
  console.log('');
}

printTable('\n=== TEST 1: FINE GRID FIXED % ===', r1, fineStops);
printTable('=== TEST 2: ATR-BASED STOPS ===', r2, atrMults);
printTable('=== TEST 3: HYBRID max(fixed%, ATR) ===', r3, Object.keys(r3));
printTable('=== TEST 4: HIGH-QUALITY SIGNALS ONLY ===', r4, [2.0,2.5,3.0,3.5]);

// Find overall best
let bestK='', bestExp=-Infinity;
for(const [k,r] of Object.entries({...r1,...r2,...r3})){
  const exp=r.total>0?r.totalR/r.total:0;
  if(exp>bestExp && r.total>=10){bestExp=exp;bestK=k;}
}
console.log(`\n🏆 OVERALL BEST: ${bestK} (expectancy ${bestExp.toFixed(3)}R)`);
