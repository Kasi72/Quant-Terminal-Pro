// GATE HYPER-TUNING — Fix the 64.5% wrong-block rate
// Uses ALL OHLCVs: Nifty 50 (Portfolio/) + Dr KKR 28 (My Portfolio/)
// Focus: Gate 1 RSI threshold + conditional blockers

const fs=require('fs'),path=require('path');
const DIRS=['C:/Users/drkkr/Downloads/My Portfolio'];
const allFiles=[];
for(const dir of DIRS){
  const f=fs.readdirSync(dir).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS')&&!f.includes('(1)'));
  for(const file of f)allFiles.push({fp:path.join(dir,file),sym:file.replace('_NS_OHLCV.csv','')});
}
// Deduplicate (some stocks may exist in both)
const seen=new Set();const uniqueFiles=[];
for(const f of allFiles){if(!seen.has(f.sym)){seen.add(f.sym);uniqueFiles.push(f);}}

function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6)continue;const[date,o,h,lo,cl,v]=p;const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};if(!M.hasOwnProperty(m))continue;c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

console.log(`Loading ${uniqueFiles.length} unique stocks...\n`);

// Collect every gate-block event with enriched data
const events=[];
for(const{fp,sym}of uniqueFiles){
  const c=parseCSV(fp);if(c.length<60)continue;
  const a=atr14(c);
  for(let i=40;i<c.length-21;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const entry=s.c,atrVal=a[i],zoneLow=bZ.zL;
    const stopRaw=(entry-(zoneLow-0.5*atrVal))/entry*100;
    const stopPct=Math.max(3.5,Math.min(8,stopRaw));
    const t1Pct=Math.max(3,Math.min(5,2.15*atrVal/entry*100));
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=Math.max(i-Math.max(0,i-20),1);
    let obv0=0;for(let j=Math.max(1,i-20);j<=i;j++)obv0+=c[j].c>c[j-1].c?c[j].v:c[j].c<c[j-1].c?-c[j].v:0;

    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const fc=c[d],day=d-i;
      const pctC=(fc.c-entry)/entry*100;
      if(pctC>-stopPct)continue;
      const prevC=d>=i+2?c[d-1]:null;const ppC=d>=i+3?c[d-2]:null;
      const range2=fc.h-fc.l;const openP=fc.o;const isGreen=openP<fc.c;
      const closeLoc=range2>0?(fc.c-fc.l)/range2*100:50;
      const lwPct=range2>0?(Math.min(openP,fc.c)-fc.l)/range2*100:0;
      const bodyPct=range2>0?Math.abs(fc.c-openP)/range2*100:0;
      const ch1=prevC?fc.c-prevC.c:0;const ch2=prevC&&ppC?prevC.c-ppC.c:0;
      const rG=((ch2>0?ch2:0)+(ch1>0?ch1:0))/2;const rL=((ch2<0?-ch2:0)+(ch1<0?-ch1:0))/2;
      const rsi2=rL<0.001?100:100-100/(1+rG/rL);
      const volR=v20>0?fc.v/v20:1;
      const prevBelowStop=prevC?(prevC.c-entry)/entry*100<=-stopPct:false;
      const accel=prevC?fc.c<prevC.c:false;
      let consecRed=0;for(let k=d;k>=Math.max(i+1,d-5);k--){if(c[k].c<c[k].o)consecRed++;else break;}
      // Future after this point
      let mfeAfter=0,maeAfter=pctC,hitT1=false;
      for(let d2=d+1;d2<=Math.min(i+20,c.length-1);d2++){
        const pH2=(c[d2].h-entry)/entry*100;const pL2=(c[d2].l-entry)/entry*100;
        if(pH2>mfeAfter)mfeAfter=pH2;if(pL2<maeAfter)maeAfter=pL2;
        if(pH2>=t1Pct)hitT1=true;
      }
      const recovered=mfeAfter>=0;
      const isWinner=hitT1; // would have been a winner if we held

      events.push({sym,day,rsi2,volR,prevBelowStop,accel,consecRed,closeLoc,lwPct,bodyPct,isGreen,
        pctC,mfeAfter,maeAfter,hitT1,recovered,stopPct,
        extraDamage:maeAfter-pctC}); // how much MORE it fell after this point
      break;
    }
  }
}
console.log(`Total close-below-stop events: ${events.length}`);
console.log(`Winners (would hit T1 if held): ${events.filter(e=>e.hitT1).length}`);
console.log(`Losers (never recovered to T1): ${events.filter(e=>!e.hitT1).length}\n`);

console.log('█'.repeat(85));
console.log('  GATE HYPER-TUNING — 77 stocks, optimize every gate threshold');
console.log('█'.repeat(85));

// ═══ PHASE 1: RSI-2 threshold sweep ═══
console.log('\n═══ PHASE 1: Gate 1 RSI-2 threshold — find the sweet spot ═══\n');
console.log('  RSI thr │ Blocked │ Winners saved │ Losers held │ Correct% │ Avg extra damage');
console.log('  ────────┼─────────┼───────────────┼─────────────┼──────────┼─────────────────');
for(const thr of [3,5,8,10,12,15,20,25,30]){
  const blocked=events.filter(e=>e.rsi2<thr);
  const savedW=blocked.filter(e=>e.hitT1).length;
  const heldL=blocked.filter(e=>!e.hitT1).length;
  const correct=blocked.length>0?(savedW/blocked.length*100):0;
  const avgExtra=blocked.length>0?(blocked.reduce((s,e)=>s+e.extraDamage,0)/blocked.length):0;
  console.log(`  RSI<${String(thr).padStart(3)} │ ${String(blocked.length).padStart(7)} │ ${String(savedW).padStart(13)} │ ${String(heldL).padStart(11)} │ ${correct.toFixed(1).padStart(7)}% │ ${avgExtra.toFixed(1).padStart(15)}%`);
}

// ═══ PHASE 2: RSI + additional conditions ═══
console.log('\n═══ PHASE 2: RSI + additional conditions to REDUCE wrong blocks ═══\n');
const conditions=[
  {name:'RSI<15 only (current)',fn:e=>e.rsi2<15},
  {name:'RSI<10 only',fn:e=>e.rsi2<10},
  {name:'RSI<8 only',fn:e=>e.rsi2<8},
  {name:'RSI<5 only',fn:e=>e.rsi2<5},
  {name:'RSI<15 + vol<1.0× (low vol shakeout)',fn:e=>e.rsi2<15&&e.volR<1.0},
  {name:'RSI<15 + vol<0.7×',fn:e=>e.rsi2<15&&e.volR<0.7},
  {name:'RSI<10 + vol<1.0×',fn:e=>e.rsi2<10&&e.volR<1.0},
  {name:'RSI<15 + NOT 3+ consec red',fn:e=>e.rsi2<15&&e.consecRed<3},
  {name:'RSI<10 + NOT 3+ consec red',fn:e=>e.rsi2<10&&e.consecRed<3},
  {name:'RSI<15 + closeLoc>30% (not at absolute bottom)',fn:e=>e.rsi2<15&&e.closeLoc>30},
  {name:'RSI<15 + lwPct>20% (some rejection)',fn:e=>e.rsi2<15&&e.lwPct>20},
  {name:'RSI<8 + vol<1.0×',fn:e=>e.rsi2<8&&e.volR<1.0},
  {name:'RSI<8 + NOT 3+ consec red',fn:e=>e.rsi2<8&&e.consecRed<3},
  {name:'RSI<15 + dip<-12% (only if not too deep)',fn:e=>e.rsi2<15&&e.pctC>-12},
  {name:'RSI<10 + dip<-10%',fn:e=>e.rsi2<10&&e.pctC>-10},
  {name:'RSI<15 + green candle (buyers showing)',fn:e=>e.rsi2<15&&e.isGreen},
  {name:'RSI<15 + bodyPct<25% (doji/indecision)',fn:e=>e.rsi2<15&&e.bodyPct<25},
  {name:'REMOVE Gate 1 entirely (no RSI block)',fn:()=>false},
];

console.log('  Condition                                    │ Blocked │ W saved │ L held │ Correct% │ Extra dmg');
console.log('  ─────────────────────────────────────────────┼─────────┼─────────┼────────┼──────────┼──────────');
const results=[];
for(const cond of conditions){
  const blocked=events.filter(cond.fn);
  const savedW=blocked.filter(e=>e.hitT1).length;
  const heldL=blocked.filter(e=>!e.hitT1).length;
  const correct=blocked.length>0?(savedW/blocked.length*100):0;
  const avgExtra=blocked.length>0?(blocked.reduce((s,e)=>s+e.extraDamage,0)/blocked.length):0;
  results.push({name:cond.name,blocked:blocked.length,savedW,heldL,correct,avgExtra});
  console.log(`  ${cond.name.padEnd(44)} │ ${String(blocked.length).padStart(7)} │ ${String(savedW).padStart(7)} │ ${String(heldL).padStart(6)} │ ${correct.toFixed(1).padStart(7)}% │ ${avgExtra.toFixed(1).padStart(8)}%`);
}

// ═══ PHASE 3: Find optimal — maximize winners saved, minimize losers held ═══
console.log('\n═══ PHASE 3: OPTIMIZATION — Best ratio of winners saved to losers held ═══\n');
// Score = winners_saved × 5 - losers_held × 1 (saving a winner is worth 5× more than holding a loser)
const scored=results.map(r=>({...r,score:r.savedW*5-r.heldL})).sort((a,b)=>b.score-a.score);
console.log('  Rank │ Condition                                    │ Score │ W saved │ L held │ Correct%');
console.log('  ─────┼──────────────────────────────────────────────┼───────┼─────────┼────────┼─────────');
for(let i=0;i<scored.length;i++){
  const r=scored[i];
  console.log(`  ${String(i+1).padStart(4)} │ ${r.name.padEnd(44)} │ ${String(r.score).padStart(5)} │ ${String(r.savedW).padStart(7)} │ ${String(r.heldL).padStart(6)} │ ${r.correct.toFixed(1).padStart(7)}%`);
}

// ═══ PHASE 4: Full simulation — each gate config end-to-end ═══
console.log('\n═══ PHASE 4: FULL SYSTEM SIMULATION — Win rate + Expectancy ═══\n');

// Rebuild all breakout signals for full sim
const ALL=[];
for(const{fp,sym}of uniqueFiles){
  const c=parseCSV(fp);if(c.length<60)continue;const a=atr14(c);
  for(let i=40;i<c.length-11;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const entry=s.c,atrVal=a[i],zoneLow=bZ.zL;
    const stopRaw=(entry-(zoneLow-0.5*atrVal))/entry*100;
    const stopPct=Math.max(3.5,Math.min(8,stopRaw));
    const t1Pct=Math.max(3,Math.min(5,2.15*atrVal/entry*100));
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=Math.max(i-Math.max(0,i-20),1);
    const future=[];
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const fc=c[d],day=d-i,range=fc.h-fc.l;
      const prevC=d>=i+2?c[d-1]:null;const ppC=d>=i+3?c[d-2]:null;
      const ch1=prevC?fc.c-prevC.c:0;const ch2=prevC&&ppC?prevC.c-ppC.c:0;
      const rG=((ch2>0?ch2:0)+(ch1>0?ch1:0))/2;const rL=((ch2<0?-ch2:0)+(ch1<0?-ch1:0))/2;
      const rsi2=rL<0.001?100:100-100/(1+rG/rL);
      let cRed=0;for(let k=d;k>=Math.max(i+1,d-5);k--){if(c[k].c<c[k].o)cRed++;else break;}
      future.push({day,c:fc.c,h:fc.h,l:fc.l,o:fc.o,v:fc.v,
        pctC:(fc.c-entry)/entry*100,pctH:(fc.h-entry)/entry*100,
        isGreen:fc.o<fc.c,closeLoc:range>0?(fc.c-fc.l)/range*100:50,
        lwPct:range>0?(Math.min(fc.o,fc.c)-fc.l)/range*100:0,
        bodyPct:range>0?Math.abs(fc.c-fc.o)/range*100:0,
        rsi2,volR:v20>0?fc.v/v20:1,consecRed:cRed,
        prevBelowStop:prevC?(prevC.c-entry)/entry*100<=-stopPct:false,
        accel:prevC?fc.c<prevC.c:false});
    }
    let mfe=0;for(const f of future)if(f.pctH>mfe)mfe=f.pctH;
    ALL.push({sym,entry,stopPct,t1Pct,future,mfe,h5:mfe>=5});
  }
}

function simGate(signals,rsiBlockFn){
  let wins=0,losses=0,falseStops=0,winR=0;
  for(const s of signals){
    let stopped=false,t1Hit=false;
    for(const f of s.future){
      if(!t1Hit&&f.pctH>=s.t1Pct){t1Hit=true;break;}
      if(f.pctC<=-s.stopPct){
        // Gate 1: RSI block (configurable)
        if(rsiBlockFn(f))continue;
        // Gate 2: Smart 2-day
        if(!f.prevBelowStop)continue;
        if(!f.accel)continue;
        if(f.volR<0.8)continue;
        // Gate 3-5
        if(f.lwPct>=40&&f.closeLoc>=50)continue;
        if(f.isGreen&&f.closeLoc>=50)continue;
        if(f.closeLoc>=35)continue;
        stopped=true;break;
      }
    }
    if(stopped){losses++;if(s.h5)falseStops++;}
    else if(t1Hit){wins++;winR+=s.t1Pct/s.stopPct;}
  }
  const decided=wins+losses;
  return{wins,losses,falseStops,decided,winRate:decided>0?wins/decided*100:0,
    expectancy:decided>0?(winR-losses)/decided:0};
}

const configs=[
  {name:'RSI<15 (current)',fn:f=>f.rsi2<15},
  {name:'RSI<10',fn:f=>f.rsi2<10},
  {name:'RSI<8',fn:f=>f.rsi2<8},
  {name:'RSI<5',fn:f=>f.rsi2<5},
  {name:'RSI<3 (almost no block)',fn:f=>f.rsi2<3},
  {name:'NO RSI gate',fn:()=>false},
  {name:'RSI<10 + vol<1.0×',fn:f=>f.rsi2<10&&f.volR<1.0},
  {name:'RSI<8 + vol<1.0×',fn:f=>f.rsi2<8&&f.volR<1.0},
  {name:'RSI<10 + NOT 3+ red',fn:f=>f.rsi2<10&&f.consecRed<3},
  {name:'RSI<8 + NOT 3+ red',fn:f=>f.rsi2<8&&f.consecRed<3},
  {name:'RSI<15 + green candle',fn:f=>f.rsi2<15&&f.isGreen},
  {name:'RSI<10 + green candle',fn:f=>f.rsi2<10&&f.isGreen},
  {name:'RSI<15 + dip<-12%',fn:f=>f.rsi2<15&&f.pctC>-12},
  {name:'RSI<8 + (green OR vol<0.8)',fn:f=>f.rsi2<8&&(f.isGreen||f.volR<0.8)},
];

console.log('  Gate 1 Config                  │ FalseStop │ Wins │ WinRate │ Exp/R  │ Verdict');
console.log('  ───────────────────────────────┼───────────┼──────┼─────────┼────────┼────────');
for(const cfg of configs){
  const r=simGate(ALL,cfg.fn);
  const verdict=r.falseStops===0?'★ ZERO FALSE':r.falseStops<=2?'EXCELLENT':r.falseStops<=5?'GOOD':'OK';
  console.log(`  ${cfg.name.padEnd(31)} │ ${String(r.falseStops).padStart(9)} │ ${String(r.wins).padStart(4)} │ ${r.winRate.toFixed(1).padStart(6)}% │ ${r.expectancy.toFixed(3).padStart(6)}R │ ${verdict}`);
}

// Walk-forward on best configs
console.log('\n═══ PHASE 5: WALK-FORWARD on top configs ═══\n');
const sorted=[...ALL].sort((a,b)=>(a.sym+a.entry).localeCompare(b.sym+b.entry));
const sp=Math.floor(sorted.length*0.70);
for(const cfg of configs.filter(c=>['RSI<8','RSI<5','RSI<8 + vol<1.0×','RSI<8 + NOT 3+ red','RSI<15 (current)','NO RSI gate'].includes(c.name))){
  const isR=simGate(sorted.slice(0,sp),cfg.fn);
  const oosR=simGate(sorted.slice(sp),cfg.fn);
  console.log(`  ${cfg.name}`);
  console.log(`    IS:  ${isR.falseStops} false, ${isR.wins}W, WR ${isR.winRate.toFixed(1)}%, Exp ${isR.expectancy.toFixed(3)}R`);
  console.log(`    OOS: ${oosR.falseStops} false, ${oosR.wins}W, WR ${oosR.winRate.toFixed(1)}%, Exp ${oosR.expectancy.toFixed(3)}R\n`);
}
