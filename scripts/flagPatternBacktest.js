// FLAG PATTERN BACKTEST — Stock Bee / Investopedia precise definition
// Tested on My Portfolio 28 stocks
//
// FLAGPOLE: 8%+ gain in 1-5 days on volume ≥ 2× average
// FLAG: 3-10 day tight consolidation, retraces ≤50% of pole, volume decreasing
// BREAKOUT: Close above flag high with volume ≥ 1.5× average
// TARGET: Measured move = breakout + pole length
// STOP: Below flag low

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/My Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS'));
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6)continue;const[date,o,h,lo,cl,v]=p;const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};if(!M.hasOwnProperty(m))continue;c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

console.log(`Loading stocks from: ${DIR}\n`);

const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);

  for(let i=30;i<c.length-21;i++){
    // ═══ STEP 1: DETECT FLAGPOLE ═══
    // Stock Bee: 8%+ gain in 1-5 days
    for(let poleLen=1;poleLen<=5;poleLen++){
      const poleStart=i-poleLen;if(poleStart<1)continue;
      const poleGain=((c[i].c-c[poleStart].c)/c[poleStart].c)*100;
      if(poleGain<8)continue; // need 8%+ pole (Stock Bee minimum)

      // Pole volume: average volume during pole must be ≥ 2× 20d average
      let v20=0;for(let j=Math.max(0,poleStart-20);j<poleStart;j++)v20+=c[j].v;v20/=20;
      let poleVolSum=0;for(let j=poleStart;j<=i;j++)poleVolSum+=c[j].v;
      const poleAvgVol=poleVolSum/poleLen;
      if(v20>0&&poleAvgVol<v20*2)continue; // pole volume must be ≥ 2× avg

      const poleHigh=Math.max(...c.slice(poleStart,i+1).map(x=>x.h));
      const poleLow=c[poleStart].l;
      const poleRange=poleHigh-poleLow;

      // ═══ STEP 2: DETECT FLAG (consolidation) ═══
      for(let flagLen=3;flagLen<=10&&i+flagLen<c.length-11;flagLen++){
        const flagStart=i+1;
        const flagEnd=i+flagLen;
        const flagCandles=c.slice(flagStart,flagEnd+1);
        const flagHigh=Math.max(...flagCandles.map(x=>x.h));
        const flagLow=Math.min(...flagCandles.map(x=>x.l));
        const flagRange=flagHigh-flagLow;

        // Flag must be TIGHT: range ≤ 50% of pole range
        if(flagRange>poleRange*0.50)continue;

        // Flag tightness as %: must be < 5% of price
        const flagTightPct=flagHigh>0?(flagRange/flagHigh)*100:99;
        if(flagTightPct>5)continue;

        // Flag retracement: flag low should not retrace more than 50% of pole
        const retracement=poleHigh>0?((poleHigh-flagLow)/poleRange)*100:99;
        if(retracement>60)continue; // allow up to 60% retracement

        // Flag slope: should be flat or slightly downward (not rallying further)
        const flagSlope=((flagCandles[flagCandles.length-1].c-flagCandles[0].c)/flagCandles[0].c)*100;
        if(flagSlope>3)continue; // flag shouldn't be rising more than 3%

        // Volume during flag: should be DECREASING (dry-up)
        const flagAvgVol=flagCandles.reduce((s,x)=>s+x.v,0)/flagCandles.length;
        const volDryUp=v20>0?flagAvgVol/v20:1;
        // Don't strictly require dry-up — some flags have moderate volume

        // ═══ STEP 3: DETECT BREAKOUT ═══
        const breakoutIdx=flagEnd+1;
        if(breakoutIdx>=c.length-11)continue;
        const bo=c[breakoutIdx];
        if(bo.c<=flagHigh*1.001)continue; // must close above flag high

        // Breakout volume
        const boVolR=v20>0?bo.v/v20:1;

        // ═══ COMPUTE TARGET (Measured Move) ═══
        const entry=bo.c;
        const measuredTarget=entry+poleRange; // target = entry + pole length
        const measuredTargetPct=((measuredTarget-entry)/entry)*100;
        const stopPrice=flagLow;
        const stopPct=((entry-stopPrice)/entry)*100;
        const rr=stopPct>0?measuredTargetPct/stopPct:0;

        // ═══ FUTURE PERFORMANCE ═══
        let mfe=0,mae=0,h5=false,h7=false,h10=false,hitMeasured=false;
        let d5=99,dMeasured=99;
        for(let d=breakoutIdx+1;d<=Math.min(breakoutIdx+20,c.length-1);d++){
          const day=d-breakoutIdx;
          const pH=(c[d].h-entry)/entry*100;
          const pL=(c[d].l-entry)/entry*100;
          if(pH>mfe)mfe=pH;if(pL<mae)mae=pL;
          if(!h5&&pH>=5){h5=true;d5=day;}
          if(!h7&&pH>=7)h7=true;
          if(!h10&&pH>=10)h10=true;
          if(!hitMeasured&&c[d].h>=measuredTarget){hitMeasured=true;dMeasured=day;}
        }

        // Would our stop have been hit?
        let stopped=false,stopDay=0;
        for(let d=breakoutIdx+1;d<=Math.min(breakoutIdx+20,c.length-1);d++){
          if(c[d].l<=stopPrice){stopped=true;stopDay=d-breakoutIdx;break;}
        }

        ALL.push({sym,date:bo.date,entry,poleGain,poleLen,poleDays:poleLen,poleVolR:poleAvgVol/v20,
          flagLen,flagTightPct,flagSlope,retracement,volDryUp,boVolR,
          measuredTarget,measuredTargetPct,stopPrice,stopPct,rr,
          mfe,mae,h5,h7,h10,hitMeasured,d5,dMeasured,stopped,stopDay});
        break; // one flag per pole
      }
      break; // one pole per candle
    }
  }
}

// De-duplicate: keep only first flag per stock within 10 days
const deduped=[];const lastSig={};
for(const f of ALL.sort((a,b)=>(a.sym+a.date).localeCompare(b.sym+b.date))){
  const key=f.sym;
  if(lastSig[key]){
    const lastDate=new Date(lastSig[key].split('-').reverse().join('-')).getTime();
    const thisDate=new Date(f.date.split('-').reverse().join('-')).getTime();
    if(thisDate-lastDate<10*86400*1000)continue;
  }
  deduped.push(f);lastSig[key]=f.date;
}

console.log('█'.repeat(85));
console.log('  FLAG PATTERN BACKTEST — Stock Bee Definition');
console.log('  Pole: 8%+ in 1-5 days, vol≥2× | Flag: 3-10d tight, ≤50% retrace | Breakout: close>flag high');
console.log('█'.repeat(85));
console.log(`\n  Raw flags: ${ALL.length} | De-duplicated: ${deduped.length} | Stocks: ${[...new Set(deduped.map(f=>f.sym))].length}\n`);

const D=deduped;
const h5=D.filter(f=>f.h5).length;
const h7=D.filter(f=>f.h7).length;
const h10=D.filter(f=>f.h10).length;
const hitM=D.filter(f=>f.hitMeasured).length;
const stopped=D.filter(f=>f.stopped).length;

console.log('═══ OVERALL RESULTS ═══\n');
console.log(`  Total flags:           ${D.length}`);
console.log(`  Hit +5% (10d):         ${h5} (${(h5/D.length*100).toFixed(1)}%)`);
console.log(`  Hit +7% (20d):         ${h7} (${(h7/D.length*100).toFixed(1)}%)`);
console.log(`  Hit +10% (20d):        ${h10} (${(h10/D.length*100).toFixed(1)}%)`);
console.log(`  Hit measured target:   ${hitM} (${(hitM/D.length*100).toFixed(1)}%)`);
console.log(`  Stopped out:           ${stopped} (${(stopped/D.length*100).toFixed(1)}%)`);
console.log(`  Avg MFE:               +${(D.reduce((s,f)=>s+f.mfe,0)/D.length).toFixed(1)}%`);
console.log(`  Avg MAE:               ${(D.reduce((s,f)=>s+f.mae,0)/D.length).toFixed(1)}%`);
console.log(`  Avg days to +5%:       ${h5>0?(D.filter(f=>f.h5).reduce((s,f)=>s+f.d5,0)/h5).toFixed(1):'—'}d`);
console.log(`  Avg measured target:   +${(D.reduce((s,f)=>s+f.measuredTargetPct,0)/D.length).toFixed(1)}%`);
console.log(`  Avg stop distance:     -${(D.reduce((s,f)=>s+f.stopPct,0)/D.length).toFixed(1)}%`);
console.log(`  Avg R:R:               ${(D.reduce((s,f)=>s+f.rr,0)/D.length).toFixed(2)}`);

// ═══ BY POLE CHARACTERISTICS ═══
console.log('\n═══ BY POLE SIZE (Stock Bee grades) ═══\n');
console.log('  Pole Gain   │ Count │ +5% Hit │ +10% Hit│ Measured│ Avg MFE │ Avg R:R │ Grade');
console.log('  ────────────┼───────┼─────────┼─────────┼─────────┼─────────┼─────────┼──────');
for(const[lo,hi,label]of[[8,12,'8-12%'],[12,18,'12-18%'],[18,25,'18-25%'],[25,50,'25%+']]){
  const grp=D.filter(f=>f.poleGain>=lo&&f.poleGain<hi);if(grp.length<3)continue;
  const w5=grp.filter(f=>f.h5).length,w10=grp.filter(f=>f.h10).length,wM=grp.filter(f=>f.hitMeasured).length;
  const grade=w5/grp.length>=0.55?'A':w5/grp.length>=0.45?'B':'C';
  console.log(`  ${label.padEnd(12)} │ ${String(grp.length).padStart(5)} │ ${(w5/grp.length*100).toFixed(1).padStart(6)}% │ ${(w10/grp.length*100).toFixed(1).padStart(6)}% │ ${(wM/grp.length*100).toFixed(1).padStart(6)}% │ ${('+'+((grp.reduce((s,f)=>s+f.mfe,0)/grp.length).toFixed(1))+'%').padStart(7)} │ ${(grp.reduce((s,f)=>s+f.rr,0)/grp.length).toFixed(2).padStart(7)} │ ${grade}`);
}

// ═══ BY FLAG DURATION ═══
console.log('\n═══ BY FLAG DURATION ═══\n');
console.log('  Duration    │ Count │ +5% Hit │ Avg MFE │ Vol Dry-up');
console.log('  ────────────┼───────┼─────────┼─────────┼──────────');
for(const[lo,hi,label]of[[3,4,'3 days'],[4,6,'4-5 days'],[6,8,'6-7 days'],[8,11,'8-10 days']]){
  const grp=D.filter(f=>f.flagLen>=lo&&f.flagLen<hi);if(grp.length<3)continue;
  const w5=grp.filter(f=>f.h5).length;
  console.log(`  ${label.padEnd(12)} │ ${String(grp.length).padStart(5)} │ ${(w5/grp.length*100).toFixed(1).padStart(6)}% │ ${('+'+((grp.reduce((s,f)=>s+f.mfe,0)/grp.length).toFixed(1))+'%').padStart(7)} │ ${(grp.reduce((s,f)=>s+f.volDryUp,0)/grp.length).toFixed(2)+'x'}`);
}

// ═══ BY BREAKOUT VOLUME ═══
console.log('\n═══ BY BREAKOUT VOLUME ═══\n');
console.log('  BO Volume   │ Count │ +5% Hit │ Avg MFE │ Finding');
console.log('  ────────────┼───────┼─────────┼─────────┼────────');
for(const[lo,hi,label]of[[0,1,'< 1×'],[1,1.5,'1-1.5×'],[1.5,2,'1.5-2×'],[2,3,'2-3×'],[3,99,'3×+']]){
  const grp=D.filter(f=>f.boVolR>=lo&&f.boVolR<hi);if(grp.length<3)continue;
  const w5=grp.filter(f=>f.h5).length;
  const finding=w5/grp.length>=0.55?'STRONG':w5/grp.length>=0.45?'GOOD':'WEAK';
  console.log(`  ${label.padEnd(12)} │ ${String(grp.length).padStart(5)} │ ${(w5/grp.length*100).toFixed(1).padStart(6)}% │ ${('+'+((grp.reduce((s,f)=>s+f.mfe,0)/grp.length).toFixed(1))+'%').padStart(7)} │ ${finding}`);
}

// ═══ BY RETRACEMENT DEPTH ═══
console.log('\n═══ BY FLAG RETRACEMENT (how much of pole was given back) ═══\n');
console.log('  Retrace %   │ Count │ +5% Hit │ Avg MFE │ Finding');
console.log('  ────────────┼───────┼─────────┼─────────┼────────');
for(const[lo,hi,label]of[[0,20,'<20% (shallow)'],[20,35,'20-35%'],[35,50,'35-50%'],[50,61,'50-60% (deep)']]){
  const grp=D.filter(f=>f.retracement>=lo&&f.retracement<hi);if(grp.length<3)continue;
  const w5=grp.filter(f=>f.h5).length;
  console.log(`  ${label.padEnd(12)} │ ${String(grp.length).padStart(5)} │ ${(w5/grp.length*100).toFixed(1).padStart(6)}% │ ${('+'+((grp.reduce((s,f)=>s+f.mfe,0)/grp.length).toFixed(1))+'%').padStart(7)} │ ${w5/grp.length>=0.5?'STRONG':w5/grp.length>=0.4?'GOOD':'WEAK'}`);
}

// ═══ MEASURED MOVE TARGET ACCURACY ═══
console.log('\n═══ MEASURED MOVE TARGET — How reliable? ═══\n');
console.log(`  Flags that hit measured target (20d): ${hitM} of ${D.length} (${(hitM/D.length*100).toFixed(1)}%)`);
console.log(`  Avg measured target:                  +${(D.reduce((s,f)=>s+f.measuredTargetPct,0)/D.length).toFixed(1)}%`);
console.log(`  Avg days to measured target:          ${hitM>0?(D.filter(f=>f.hitMeasured).reduce((s,f)=>s+f.dMeasured,0)/hitM).toFixed(1):'—'}d`);

// ═══ R:R ANALYSIS ═══
console.log('\n═══ RISK-REWARD (Stop below flag low, Target = measured move) ═══\n');
console.log(`  Avg stop distance: -${(D.reduce((s,f)=>s+f.stopPct,0)/D.length).toFixed(1)}%`);
console.log(`  Avg target:        +${(D.reduce((s,f)=>s+f.measuredTargetPct,0)/D.length).toFixed(1)}%`);
console.log(`  Avg R:R:           ${(D.reduce((s,f)=>s+f.rr,0)/D.length).toFixed(2)}`);

// ═══ PER-STOCK BREAKDOWN ═══
console.log('\n═══ PER-STOCK RESULTS ═══\n');
console.log('  Symbol       │ Flags │ +5% │ +10%│ Meas │ Stopped │ Avg MFE │ Best MFE');
console.log('  ─────────────┼───────┼─────┼─────┼──────┼─────────┼─────────┼────────');
const syms=[...new Set(D.map(f=>f.sym))].sort();
for(const sym of syms){
  const st=D.filter(f=>f.sym===sym);if(st.length===0)continue;
  const best=Math.max(...st.map(f=>f.mfe));
  console.log(`  ${sym.padEnd(12)} │ ${String(st.length).padStart(5)} │ ${String(st.filter(f=>f.h5).length).padStart(3)} │ ${String(st.filter(f=>f.h10).length).padStart(3)} │ ${String(st.filter(f=>f.hitMeasured).length).padStart(4)} │ ${String(st.filter(f=>f.stopped).length).padStart(7)} │ ${('+'+((st.reduce((s,f)=>s+f.mfe,0)/st.length).toFixed(1))+'%').padStart(7)} │ +${best.toFixed(1)}%`);
}

// ═══ TOP 20 FLAG TRADES ═══
console.log('\n═══ TOP 20 FLAG TRADES BY MFE ═══\n');
console.log('  Symbol       │ Date       │ Pole  │ Pole Vol │ Flag │ Retrace │ BO Vol │ MFE    │ Measured │ R:R');
console.log('  ─────────────┼────────────┼───────┼──────────┼──────┼─────────┼────────┼────────┼──────────┼────');
for(const f of D.sort((a,b)=>b.mfe-a.mfe).slice(0,20)){
  console.log(`  ${f.sym.padEnd(12)} │ ${(f.date||'—').padEnd(10)} │ ${('+'+f.poleGain.toFixed(0)+'%').padStart(5)} │ ${(f.poleVolR.toFixed(1)+'x').padStart(8)} │ ${String(f.flagLen).padStart(3)}d │ ${f.retracement.toFixed(0).padStart(6)}% │ ${(f.boVolR.toFixed(1)+'x').padStart(5)} │ ${('+'+f.mfe.toFixed(1)+'%').padStart(6)} │ ${f.hitMeasured?'YES':'NO '} │ ${f.rr.toFixed(1)}`);
}

// ═══ OPTIMAL FLAG CONFIGURATION ═══
console.log('\n═══ OPTIMAL FLAG — Grid search for best params ═══\n');
const configs=[
  {name:'Stock Bee strict (8%+ pole, 3-5d flag, vol≥2x BO)',fn:f=>f.poleGain>=8&&f.flagLen<=5&&f.boVolR>=2},
  {name:'Stock Bee relaxed (8%+ pole, 3-7d flag, vol≥1.5x)',fn:f=>f.poleGain>=8&&f.flagLen<=7&&f.boVolR>=1.5},
  {name:'Strong pole (12%+) + tight flag (<3%)',fn:f=>f.poleGain>=12&&f.flagTightPct<3},
  {name:'Shallow retrace (<30%) + vol BO≥1.5x',fn:f=>f.retracement<30&&f.boVolR>=1.5},
  {name:'Short flag (3d) + any volume',fn:f=>f.flagLen===3},
  {name:'All flags (baseline)',fn:()=>true},
];
console.log('  Config                                          │ Count │ +5% Hit │ Avg MFE │ Avg R:R │ Stopped');
console.log('  ────────────────────────────────────────────────┼───────┼─────────┼─────────┼─────────┼────────');
for(const cfg of configs){
  const grp=D.filter(cfg.fn);if(grp.length<3)continue;
  const w=grp.filter(f=>f.h5).length;const st=grp.filter(f=>f.stopped).length;
  console.log(`  ${cfg.name.padEnd(48)} │ ${String(grp.length).padStart(5)} │ ${(w/grp.length*100).toFixed(1).padStart(6)}% │ ${('+'+((grp.reduce((s,f)=>s+f.mfe,0)/grp.length).toFixed(1))+'%').padStart(7)} │ ${(grp.reduce((s,f)=>s+f.rr,0)/grp.length).toFixed(2).padStart(7)} │ ${(st/grp.length*100).toFixed(0).padStart(5)}%`);
}

// Walk-forward
console.log('\n═══ WALK-FORWARD (70/30) — Best config ═══\n');
const sorted=[...D].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const sp=Math.floor(sorted.length*0.70);
for(const cfg of configs.slice(0,3)){
  const isGrp=sorted.slice(0,sp).filter(cfg.fn);const oosGrp=sorted.slice(sp).filter(cfg.fn);
  const isW=isGrp.filter(f=>f.h5).length;const oosW=oosGrp.filter(f=>f.h5).length;
  console.log(`  ${cfg.name}`);
  console.log(`    IS:  ${isGrp.length} flags, ${isW} hits (${isGrp.length>0?(isW/isGrp.length*100).toFixed(1):0}%), MFE +${isGrp.length>0?(isGrp.reduce((s,f)=>s+f.mfe,0)/isGrp.length).toFixed(1):0}%`);
  console.log(`    OOS: ${oosGrp.length} flags, ${oosW} hits (${oosGrp.length>0?(oosW/oosGrp.length*100).toFixed(1):0}%), MFE +${oosGrp.length>0?(oosGrp.reduce((s,f)=>s+f.mfe,0)/oosGrp.length).toFixed(1):0}%\n`);
}
