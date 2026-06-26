// Advanced Dynamic Stop Engine — Multi-layer false stop elimination
// Tests 7 advanced mechanisms on 29 OHLCV files

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));

function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

// Collect signals with FULL future candle data (not just MFE/MAE)
const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);
  for(let i=40;i<c.length-11;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;

    const entry=s.c, atrVal=a[i], zoneLow=bZ.zL, zoneHigh=bZ.zH;
    // Pre-compute volume context
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=Math.max(i-Math.max(0,i-20),1);

    // Future 10 candles with full OHLCV
    const future=[];
    let mfe=0,mae=0,hitT1=false,t1Day=0;
    const t1Pct = Math.max(3.0, Math.min(5.0, 2.15*atrVal/entry*100));
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const fc=c[d];
      const day=d-i;
      const pctH=(fc.h-entry)/entry*100, pctL=(fc.l-entry)/entry*100, pctC=(fc.c-entry)/entry*100;
      if(pctH>mfe)mfe=pctH;if(pctL<mae)mae=pctL;
      if(!hitT1&&pctH>=t1Pct){hitT1=true;t1Day=day;}
      const isGreen=fc.c>fc.o;
      const range=fc.h-fc.l;
      const closeLoc=range>0?(fc.c-fc.l)/range*100:50;
      const bodyPct=range>0?Math.abs(fc.c-fc.o)/range*100:0;
      const lwPct=range>0?(Math.min(fc.o,fc.c)-fc.l)/range*100:0;
      const volR=v20>0?fc.v/v20:1;
      const atrDay=a[Math.min(d,a.length-1)]||atrVal;
      future.push({day,o:fc.o,h:fc.h,l:fc.l,c:fc.c,v:fc.v,pctH,pctL,pctC,isGreen,closeLoc,bodyPct,lwPct,volR,atrDay});
    }
    ALL.push({sym,date:c[i].date,entry,atrVal,zoneLow,zoneHigh,v20,mfe,mae,hitT1,t1Day,t1Pct,future});
  }
}
console.log(`Total signals: ${ALL.length}`);
console.log(`Winners (MFE≥5%): ${ALL.filter(s=>s.mfe>=5).length} | T1 hitters: ${ALL.filter(s=>s.hitT1).length}\n`);

function simulate(signals, stopLogic) {
  let falseStops=0,correctStops=0,wins=0,winR=0,lossR=0;
  const falseList=[];
  for(const s of signals){
    const stopPctBase = stopLogic.stopPct(s);
    let stopped=false, stoppedDay=0, t1Hit=false, t1Day=0;
    for(const fc of s.future){
      // T1 check first (optimistic: high comes before low on T1 day)
      if(!t1Hit && fc.pctH >= s.t1Pct){ t1Hit=true; t1Day=fc.day; break; }
      // Stop check — apply dynamic logic
      const shouldStop = stopLogic.check(s, fc, stopPctBase);
      if(shouldStop){ stopped=true; stoppedDay=fc.day; break; }
    }
    if(stopped){
      if(s.mfe>=5){ falseStops++; falseList.push({...s,stoppedDay,stopPctBase}); }
      else correctStops++;
      lossR += -1;
    } else if(t1Hit){
      wins++;
      winR += s.t1Pct / Math.abs(stopPctBase);
    }
  }
  const decided=wins+falseStops+correctStops;
  const totalR=winR+lossR;
  return {
    falseStops,correctStops,wins,decided,
    winRate:decided>0?(wins/decided*100):0,
    expectancy:decided>0?totalR/decided:0,
    totalR,falseRate:(falseStops/Math.max(ALL.filter(s=>s.mfe>=5).length,1)*100),
    falseList
  };
}

// ═══ STOP MECHANISMS ═══

const METHODS = [
  // 0: BASELINE — current old stop
  { name: 'OLD: 0.75ATR [2%,3.5%]',
    stopPct: s => -Math.max(2.0, Math.min(3.5, 0.75*s.atrVal/s.entry*100)),
    check: (s,fc,sp) => fc.pctL <= sp },

  // 1: Simple ZoneLow-0.5ATR [3.5%,8%]
  { name: 'NEW-BASE: ZoneLow-0.5ATR [3.5%,8%]',
    stopPct: s => { const raw=(s.entry-(s.zoneLow-0.5*s.atrVal))/s.entry*100; return -Math.max(3.5,Math.min(8,raw)); },
    check: (s,fc,sp) => fc.pctL <= sp },

  // 2: CLOSE-BASED — only stop if CLOSE is below level (wick doesn't count)
  { name: 'ADV-1: Close-below-stop (wick ignored)',
    stopPct: s => { const raw=(s.entry-(s.zoneLow-0.5*s.atrVal))/s.entry*100; return -Math.max(3.5,Math.min(8,raw)); },
    check: (s,fc,sp) => fc.pctC <= sp },

  // 3: 2-CANDLE CONFIRM — stop only if 2 consecutive candles close below level
  { name: 'ADV-2: 2-candle close confirmation',
    stopPct: s => { const raw=(s.entry-(s.zoneLow-0.5*s.atrVal))/s.entry*100; return -Math.max(3.5,Math.min(8,raw)); },
    check: (s,fc,sp) => {
      if(fc.pctC > sp) return false; // current candle close above stop — safe
      // Check if previous candle also closed below
      const prev = s.future.find(f=>f.day===fc.day-1);
      if(!prev) return false; // day 1 — no prev, give grace
      return prev.pctC <= sp; // both closed below → confirmed stop
    }},

  // 4: HAMMER REJECTION — don't stop if candle shows rejection (long lower wick + close above open)
  { name: 'ADV-3: Hammer rejection filter',
    stopPct: s => { const raw=(s.entry-(s.zoneLow-0.5*s.atrVal))/s.entry*100; return -Math.max(3.5,Math.min(8,raw)); },
    check: (s,fc,sp) => {
      if(fc.pctL > sp) return false; // didn't reach stop level
      // Wick hit stop but check if candle shows rejection
      if(fc.lwPct >= 40 && fc.closeLoc >= 50) return false; // hammer pattern — don't stop
      if(fc.isGreen && fc.closeLoc >= 60) return false; // green candle closing high — recovery
      return true; // genuine breakdown
    }},

  // 5: VOLUME FILTER — don't stop if dip is on LOW volume (institutional selling absent)
  { name: 'ADV-4: Volume-confirmed stop (low vol = ignore)',
    stopPct: s => { const raw=(s.entry-(s.zoneLow-0.5*s.atrVal))/s.entry*100; return -Math.max(3.5,Math.min(8,raw)); },
    check: (s,fc,sp) => {
      if(fc.pctL > sp) return false;
      if(fc.volR < 0.8) return false; // low volume dip — shakeout, not real selling
      return true;
    }},

  // 6: TIME-ADAPTIVE — wider stop on Day 1-2, tighten from Day 3
  { name: 'ADV-5: Time-adaptive (Day1-2 wider)',
    stopPct: s => { const raw=(s.entry-(s.zoneLow-0.5*s.atrVal))/s.entry*100; return -Math.max(3.5,Math.min(8,raw)); },
    check: (s,fc,sp) => {
      const adaptedSp = fc.day <= 2 ? sp * 1.5 : sp; // 50% wider for first 2 days
      return fc.pctL <= adaptedSp;
    }},

  // 7: DAY-1 GRACE — skip stop entirely on Day 1 (opening shakeout protection)
  { name: 'ADV-6: Day-1 grace period',
    stopPct: s => { const raw=(s.entry-(s.zoneLow-0.5*s.atrVal))/s.entry*100; return -Math.max(3.5,Math.min(8,raw)); },
    check: (s,fc,sp) => {
      if(fc.day === 1) return false; // never stop on day 1
      return fc.pctL <= sp;
    }},

  // 8: CLOSE-BASED + HAMMER — combo: only close-below AND no hammer rejection
  { name: 'ADV-7: Close-based + hammer filter',
    stopPct: s => { const raw=(s.entry-(s.zoneLow-0.5*s.atrVal))/s.entry*100; return -Math.max(3.5,Math.min(8,raw)); },
    check: (s,fc,sp) => {
      if(fc.pctC > sp) return false; // close above stop
      if(fc.lwPct >= 40 && fc.closeLoc >= 50) return false; // hammer
      if(fc.isGreen) return false; // green candle = not a breakdown
      return true;
    }},

  // 9: CLOSE + VOLUME — close below + volume confirms selling
  { name: 'ADV-8: Close-based + volume confirm',
    stopPct: s => { const raw=(s.entry-(s.zoneLow-0.5*s.atrVal))/s.entry*100; return -Math.max(3.5,Math.min(8,raw)); },
    check: (s,fc,sp) => {
      if(fc.pctC > sp) return false;
      if(fc.volR < 0.8) return false; // low vol close below — likely shakeout
      return true;
    }},

  // 10: TRIPLE FILTER — close-based + volume + not a hammer
  { name: 'ADV-9: TRIPLE (close+vol+hammer)',
    stopPct: s => { const raw=(s.entry-(s.zoneLow-0.5*s.atrVal))/s.entry*100; return -Math.max(3.5,Math.min(8,raw)); },
    check: (s,fc,sp) => {
      if(fc.pctC > sp) return false; // close above stop = safe
      if(fc.volR < 0.8) return false; // low volume = shakeout
      if(fc.lwPct >= 40 && fc.closeLoc >= 50) return false; // hammer = rejection
      if(fc.isGreen) return false; // green candle = recovery
      return true;
    }},

  // 11: TRIPLE + DAY1 GRACE
  { name: 'ADV-10: TRIPLE + Day1 grace',
    stopPct: s => { const raw=(s.entry-(s.zoneLow-0.5*s.atrVal))/s.entry*100; return -Math.max(3.5,Math.min(8,raw)); },
    check: (s,fc,sp) => {
      if(fc.day === 1) return false;
      if(fc.pctC > sp) return false;
      if(fc.volR < 0.8) return false;
      if(fc.lwPct >= 40 && fc.closeLoc >= 50) return false;
      if(fc.isGreen) return false;
      return true;
    }},

  // 12: ADAPTIVE ATR-SCALED — stop widens with ATR
  { name: 'ADV-11: ATR-scaled zone stop',
    stopPct: s => {
      const atrPct = s.atrVal/s.entry*100;
      // Low ATR stocks: wider relative stop; High ATR: already have room
      const mult = atrPct < 2.5 ? 0.75 : atrPct < 4 ? 0.5 : 0.35;
      const raw = (s.entry - (s.zoneLow - mult*s.atrVal))/s.entry*100;
      return -Math.max(3.5, Math.min(8, raw));
    },
    check: (s,fc,sp) => {
      if(fc.pctC > sp) return false;
      if(fc.isGreen && fc.closeLoc >= 55) return false;
      return true;
    }},

  // 13: ULTIMATE — Close-based + Volume + Hammer + Day1 Grace + ATR-adaptive
  { name: '★ ULTIMATE: All filters combined',
    stopPct: s => {
      const atrPct = s.atrVal/s.entry*100;
      const mult = atrPct < 2.5 ? 0.75 : atrPct < 4 ? 0.5 : 0.35;
      const raw = (s.entry - (s.zoneLow - mult*s.atrVal))/s.entry*100;
      return -Math.max(3.5, Math.min(10, raw));
    },
    check: (s,fc,sp) => {
      if(fc.day === 1) return false; // Day-1 grace
      if(fc.pctC > sp) return false; // Close must be below stop
      if(fc.volR < 0.7) return false; // Low volume = shakeout
      if(fc.lwPct >= 35 && fc.closeLoc >= 45) return false; // Rejection candle
      if(fc.isGreen && fc.closeLoc >= 50) return false; // Green recovery
      return true;
    }},
];

// Run all methods
console.log('═'.repeat(95));
console.log('  ADVANCED STOP ENGINE — 14 METHODS COMPARED (10-day timeframe)');
console.log('═'.repeat(95));
console.log('\n  Method                                │FalseStop│FalseRate│ Wins │ WinRate│ Exp/R  │ TotalR');
console.log('  ──────────────────────────────────────┼─────────┼─────────┼──────┼────────┼────────┼──────');

const results = [];
for(const m of METHODS){
  const r = simulate(ALL, m);
  results.push({name:m.name,...r});
  const marker = r.falseStops <= 5 ? ' ◀◀◀' : r.falseStops <= 15 ? ' ◀' : '';
  console.log(`  ${m.name.padEnd(38)} │ ${String(r.falseStops).padStart(7)} │ ${r.falseRate.toFixed(1).padStart(7)}% │ ${String(r.wins).padStart(4)} │ ${r.winRate.toFixed(1).padStart(6)}% │ ${r.expectancy.toFixed(3).padStart(6)}R │ ${r.totalR.toFixed(0).padStart(5)}${marker}`);
}

// Rank by: minimize false stops while keeping high expectancy
console.log('\n' + '═'.repeat(95));
console.log('  RANKING BY FALSE STOP REDUCTION (keeping expectancy > 0)');
console.log('═'.repeat(95));
const ranked = results.filter(r=>r.expectancy>0).sort((a,b)=>a.falseStops-b.falseStops);
console.log('\n  Rank │ Method                                │FalseStop│ Wins │ Exp/R  │Verdict');
console.log('  ─────┼───────────────────────────────────────┼─────────┼──────┼────────┼───────');
for(let i=0;i<ranked.length;i++){
  const r=ranked[i];
  const verdict = r.falseStops===0?'PERFECT':r.falseStops<=3?'EXCELLENT':r.falseStops<=10?'GREAT':'GOOD';
  console.log(`  ${String(i+1).padStart(4)} │ ${r.name.padEnd(37)} │ ${String(r.falseStops).padStart(7)} │ ${String(r.wins).padStart(4)} │ ${r.expectancy.toFixed(3).padStart(6)}R │ ${verdict}`);
}

// Deep dive on the best methods
const best = ranked.slice(0,3);
for(const b of best){
  console.log(`\n  ═══ ${b.name} — ${b.falseStops} false stops ═══`);
  if(b.falseList.length>0){
    console.log('  Remaining false stops:');
    console.log('  Symbol       │ Date       │ StopDay │ MFE    │ MAE    │ What happened');
    for(const f of b.falseList.sort((a,b)=>b.mfe-a.mfe)){
      console.log(`  ${f.sym.padEnd(12)} │ ${(f.date||'—').padEnd(10)} │ ${String(f.stoppedDay).padStart(7)} │ ${f.mfe.toFixed(1).padStart(5)}% │ ${f.mae.toFixed(1).padStart(5)}% │ Would have hit +${f.mfe.toFixed(1)}%`);
    }
  } else {
    console.log('  ZERO false stops! No winners killed.');
  }
}

// Walk-forward on best method
console.log('\n' + '═'.repeat(95));
console.log('  WALK-FORWARD VALIDATION ON TOP METHOD');
console.log('═'.repeat(95));
const topMethod = METHODS[METHODS.length-1]; // ULTIMATE
const sorted = [...ALL].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const split70 = Math.floor(sorted.length*0.70);
const IS=sorted.slice(0,split70), OOS=sorted.slice(split70);
const isR=simulate(IS,topMethod), oosR=simulate(OOS,topMethod);
console.log(`\n  ${topMethod.name}`);
console.log(`  In-Sample (70%):  ${isR.decided} decided, WR ${isR.winRate.toFixed(1)}%, Exp ${isR.expectancy.toFixed(3)}R, FalseStops ${isR.falseStops}`);
console.log(`  Out-of-Sample:    ${oosR.decided} decided, WR ${oosR.winRate.toFixed(1)}%, Exp ${oosR.expectancy.toFixed(3)}R, FalseStops ${oosR.falseStops}`);

// Also test the #2 and #3
for(const idx of [10,11,12]){
  const m=METHODS[idx];
  const isR2=simulate(IS,m), oosR2=simulate(OOS,m);
  console.log(`\n  ${m.name}`);
  console.log(`  In-Sample:  ${isR2.decided} decided, WR ${isR2.winRate.toFixed(1)}%, Exp ${isR2.expectancy.toFixed(3)}R, FalseStops ${isR2.falseStops}`);
  console.log(`  Out-of-Sample: ${oosR2.decided} decided, WR ${oosR2.winRate.toFixed(1)}%, Exp ${oosR2.expectancy.toFixed(3)}R, FalseStops ${oosR2.falseStops}`);
}
