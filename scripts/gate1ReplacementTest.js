// GATE 1 REPLACEMENT — Find a science-based gate that maintains 97%+ WR
// while holding FEWER losers than RSI < 15 (which holds 122 losers for 34 winners)
// Tests on ALL breakouts (not just param-qualifying) because we need robustness

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/My Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS'));
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6)continue;const[date,o,h,lo,cl,v]=p;const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};if(!M.hasOwnProperty(m))continue;c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);
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
      // Buying pressure: how close to the high relative to range
      const buyP=range>0?(fc.c-fc.l)/range:0.5;
      // Volume declining (vs previous day)
      const prevVol=prevC?prevC.v:fc.v;
      const volDecline=fc.v<prevVol*0.7;
      // Close above open (green candle)
      const isGreen=fc.o<fc.c;
      // Lower wick rejection
      const lwPct=range>0?(Math.min(fc.o,fc.c)-fc.l)/range*100:0;
      const closeLoc=range>0?(fc.c-fc.l)/range*100:50;
      // Dip depth from entry
      const dipPct=(fc.c-entry)/entry*100;
      // Close above zone low
      const aboveZoneLow=fc.c>zoneLow;
      future.push({day,pctC:dipPct,pctH:(fc.h-entry)/entry*100,
        rsi2,volR:v20>0?fc.v/v20:1,buyP,volDecline,isGreen,lwPct,closeLoc,
        aboveZoneLow,consecRed:cRed,
        prevBelowStop:prevC?(prevC.c-entry)/entry*100<=-stopPct:false,
        accel:prevC?fc.c<prevC.c:false,prevGreen:prevC?(prevC.o||prevC.c)<prevC.c:false,
        ppC:ppC?.c||entry,c:fc.c});
    }
    let mfe=0;for(const f of future)if(f.pctH>mfe)mfe=f.pctH;
    ALL.push({sym,entry,stopPct,t1Pct,future,mfe,h5:mfe>=5,zoneLow});
  }
}

function simGate(signals,gate1Fn){
  let wins=0,losses=0,falseStops=0,losersHeld=0;
  for(const s of signals){
    let stopped=false,t1Hit=false;
    for(const f of s.future){
      if(!t1Hit&&f.pctH>=s.t1Pct){t1Hit=true;break;}
      if(f.pctC<=-s.stopPct){
        // Gate 1 (configurable)
        if(gate1Fn(f,s)){losersHeld+=s.h5?0:1;continue;}
        // Gates 2-7 (fixed)
        if(!f.prevBelowStop){continue;}
        if(!f.accel){continue;}
        if(f.volR<0.8){continue;}
        if(f.lwPct>=40&&f.closeLoc>=50){continue;}
        if(f.isGreen&&f.closeLoc>=50){continue;}
        if(f.closeLoc>=35){continue;}
        if(f.c>f.ppC){continue;}
        if(f.prevGreen){continue;}
        stopped=true;break;
      }
    }
    if(stopped){losses++;if(s.h5)falseStops++;}
    else if(t1Hit){wins++;}
  }
  const decided=wins+losses;
  return{wins,losses,falseStops,losersHeld,decided,winRate:decided>0?wins/decided*100:0};
}

console.log(`ALL breakouts: ${ALL.length} | Winners: ${ALL.filter(s=>s.h5).length}\n`);

console.log('█'.repeat(90));
console.log('  GATE 1 REPLACEMENT TEST — Find what maintains 97%+ WR with fewer losers held');
console.log('█'.repeat(90));

const candidates=[
  // Current
  {name:'RSI < 15 (current)',fn:f=>f.rsi2<15},
  {name:'RSI < 8',fn:f=>f.rsi2<8},
  {name:'NO Gate 1',fn:()=>false},

  // VOLUME-BASED replacements
  {name:'Low vol (vol < 0.5×)',fn:f=>f.volR<0.5},
  {name:'Low vol (vol < 0.7×)',fn:f=>f.volR<0.7},
  {name:'Vol declining vs prev day',fn:f=>f.volDecline},

  // CANDLE QUALITY replacements
  {name:'Green candle (buyers present)',fn:f=>f.isGreen},
  {name:'Close above open + closeLoc>40%',fn:f=>f.isGreen&&f.closeLoc>40},
  {name:'Lower wick > 25% (rejection)',fn:f=>f.lwPct>25},
  {name:'Buying pressure > 0.45',fn:f=>f.buyP>0.45},

  // STRUCTURE-BASED replacements
  {name:'Close still above zone low',fn:(f,s)=>f.c>s.zoneLow},
  {name:'Dip < 10% from entry',fn:f=>f.pctC>-10},
  {name:'Dip < 12% from entry',fn:f=>f.pctC>-12},
  {name:'NOT 3+ consecutive red',fn:f=>f.consecRed<3},
  {name:'Day 1-2 only (early shakeout)',fn:f=>f.day<=2},

  // COMBINATIONS
  {name:'Green + vol<0.7 (buyers on low vol)',fn:f=>f.isGreen&&f.volR<0.7},
  {name:'(Green OR lwPct>30%) + vol<1.0',fn:f=>(f.isGreen||f.lwPct>30)&&f.volR<1.0},
  {name:'Above zone low + vol<0.8',fn:(f,s)=>f.c>s.zoneLow&&f.volR<0.8},
  {name:'Above zone low + green',fn:(f,s)=>f.c>s.zoneLow&&f.isGreen},
  {name:'Day≤2 + vol<1.0',fn:f=>f.day<=2&&f.volR<1.0},
  {name:'(Green OR vol<0.5) (either buyer OR no seller)',fn:f=>f.isGreen||f.volR<0.5},
  {name:'BuyP>0.4 + vol<1.0 (buying on low vol)',fn:f=>f.buyP>0.4&&f.volR<1.0},
  {name:'RSI<8 + vol<0.7 (tighter combo)',fn:f=>f.rsi2<8&&f.volR<0.7},
  {name:'Above zone low + NOT 3+ red',fn:(f,s)=>f.c>s.zoneLow&&f.consecRed<3},
  {name:'(lwPct>25 OR green) (any rejection sign)',fn:f=>f.lwPct>25||f.isGreen},
];

console.log('\n  Gate 1 Replacement                              │FalseStop│ Wins │ WR%    │L held │ Saved W │ Verdict');
console.log('  ────────────────────────────────────────────────┼─────────┼──────┼────────┼───────┼─────────┼────────');
const baseRSI=simGate(ALL,f=>f.rsi2<15);
const baseNoGate=simGate(ALL,()=>false);
const results=[];
for(const c of candidates){
  const r=simGate(ALL,c.fn);
  const savedW=baseNoGate.falseStops-r.falseStops; // how many winners saved vs no gate
  const verdict=r.winRate>=97&&r.losersHeld<baseRSI.losersHeld?'★ BETTER':
    r.winRate>=95&&r.losersHeld<baseRSI.losersHeld?'GOOD':
    r.winRate>=97?'SAME WR':'WORSE';
  results.push({...c,...r,savedW,verdict});
  console.log(`  ${c.name.padEnd(48)} │ ${String(r.falseStops).padStart(7)} │ ${String(r.wins).padStart(4)} │ ${r.winRate.toFixed(1).padStart(6)}% │ ${String(r.losersHeld).padStart(5)} │ ${String(savedW).padStart(7)} │ ${verdict}`);
}

// Rank by: WR ≥ 97% AND fewest losers held
console.log('\n═══ RANKED: Best replacements (WR ≥ 95% + fewer losers than RSI<15) ═══\n');
const ranked=results.filter(r=>r.winRate>=95&&r.losersHeld<baseRSI.losersHeld).sort((a,b)=>a.losersHeld-b.losersHeld);
console.log('  Rank │ Gate 1 Replacement                              │ WR%    │L held │ Saved W │ vs RSI<15');
console.log('  ─────┼──────────────────────────────────────────────────┼────────┼───────┼─────────┼──────────');
for(let i=0;i<ranked.length;i++){
  const r=ranked[i];
  console.log(`  ${String(i+1).padStart(4)} │ ${r.name.padEnd(48)} │ ${r.winRate.toFixed(1).padStart(6)}% │ ${String(r.losersHeld).padStart(5)} │ ${String(r.savedW).padStart(7)} │ ${r.losersHeld-baseRSI.losersHeld} fewer held`);
}

// Walk-forward on top 5
console.log('\n═══ WALK-FORWARD (70/30) on top candidates ═══\n');
const sorted=[...ALL].sort((a,b)=>(a.sym+a.entry).localeCompare(b.sym+b.entry));
const sp=Math.floor(sorted.length*0.70);
const topCandidates=[
  {name:'RSI < 15 (current)',fn:f=>f.rsi2<15},
  {name:'NO Gate 1',fn:()=>false},
  ...ranked.slice(0,5)
];
for(const c of topCandidates){
  const isR=simGate(sorted.slice(0,sp),c.fn);
  const oosR=simGate(sorted.slice(sp),c.fn);
  console.log(`  ${c.name}`);
  console.log(`    IS:  ${isR.falseStops} false, WR ${isR.winRate.toFixed(1)}%, L held ${isR.losersHeld}`);
  console.log(`    OOS: ${oosR.falseStops} false, WR ${oosR.winRate.toFixed(1)}%, L held ${oosR.losersHeld}\n`);
}
