// FLAG PATTERN STUDY — Can we detect flags in the OHLCV data?
// Flag = strong pole (5%+ in 1-5 days) → tight consolidation → breakout
// Compare: our current compression breakout vs flag breakout

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/My Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS'));
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6)continue;const[date,o,h,lo,cl,v]=p;const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};if(!M.hasOwnProperty(m))continue;c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

const flags=[];
const compressions=[]; // our current pattern for comparison

for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);

  for(let i=20;i<c.length-11;i++){
    if(c[i].c<=0||a[i]<=0)continue;

    // ═══ FLAG DETECTION ═══
    // Step 1: Look for a POLE — strong move in last 1-5 days
    for(const poleLen of [1,2,3,4,5]){
      const poleStart=i-poleLen;if(poleStart<1)continue;
      const poleGain=((c[i].c-c[poleStart].c)/c[poleStart].c)*100;
      if(poleGain<5)continue; // need at least 5% pole

      // Step 2: Check if a TIGHT FLAG forms after the pole (3-10 candles)
      for(let flagLen=3;flagLen<=10&&i+flagLen<c.length-11;flagLen++){
        const flagCandles=c.slice(i,i+flagLen);
        const flagHigh=Math.max(...flagCandles.map(x=>x.h));
        const flagLow=Math.min(...flagCandles.map(x=>x.l));
        const flagRange=flagHigh>0?((flagHigh-flagLow)/flagHigh)*100:99;
        if(flagRange>5)continue; // flag must be tight (< 5% range)

        // Check flag is consolidating (not making new highs)
        const flagSlope=((flagCandles[flagCandles.length-1].c-flagCandles[0].c)/flagCandles[0].c)*100;
        if(flagSlope>3)continue; // flag should drift sideways or slightly down

        // Step 3: Check for BREAKOUT after the flag
        const breakoutIdx=i+flagLen;
        if(breakoutIdx>=c.length-11)continue;
        const breakoutCandle=c[breakoutIdx];
        if(breakoutCandle.c<=flagHigh*1.001)continue; // must close above flag high

        // Volume confirmation on breakout
        let v20=0;for(let j=Math.max(0,breakoutIdx-20);j<breakoutIdx;j++)v20+=c[j].v;v20/=20;
        const volR=v20>0?breakoutCandle.v/v20:1;

        // Future performance
        const entry=breakoutCandle.c;
        let mfe=0,mae=0,h5=false,h7=false,h10=false,d5=99;
        for(let d=breakoutIdx+1;d<=Math.min(breakoutIdx+10,c.length-1);d++){
          const pH=(c[d].h-entry)/entry*100,pL=(c[d].l-entry)/entry*100;
          if(pH>mfe)mfe=pH;if(pL<mae)mae=pL;
          if(!h5&&pH>=5){h5=true;d5=d-breakoutIdx;}
          if(!h7&&pH>=7)h7=true;if(!h10&&pH>=10)h10=true;
        }

        flags.push({sym,date:breakoutCandle.date,poleGain,poleLen,flagLen,flagRange,flagSlope,
          volR,entry,mfe,mae,h5,h7,h10,d5,type:'FLAG'});
        break; // only first flag per pole
      }
    }

    // ═══ OUR CURRENT COMPRESSION BREAKOUT (for comparison) ═══
    const r=c[i].h-c[i].l;if(r<=0)continue;
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo};break;}
    if(!bZ||c[i].c<=bZ.zH*1.001)continue;
    const entry=c[i].c;let mfe=0,mae=0,h5=false,d5=99;
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const pH=(c[d].h-entry)/entry*100,pL=(c[d].l-entry)/entry*100;
      if(pH>mfe)mfe=pH;if(pL<mae)mae=pL;if(!h5&&pH>=5){h5=true;d5=d-i;}
    }
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=20;
    compressions.push({sym,date:c[i].date,entry,mfe,mae,h5,d5,volR:v20>0?c[i].v/v20:1,type:'COMPRESSION'});
  }
}

console.log('█'.repeat(80));
console.log('  FLAG PATTERN STUDY — 28 Portfolio Stocks');
console.log('█'.repeat(80));

console.log(`\n  Flags detected:        ${flags.length}`);
console.log(`  Compressions detected: ${compressions.length}\n`);

// ═══ FLAG vs COMPRESSION — Head to head ═══
console.log('═══ HEAD TO HEAD: Flag vs Compression Breakout ═══\n');
const fW=flags.filter(f=>f.h5).length,cW=compressions.filter(c=>c.h5).length;
console.log('  Metric              │ Flag Pattern    │ Compression     │ Winner');
console.log('  ────────────────────┼─────────────────┼─────────────────┼───────');
console.log(`  Total signals       │ ${String(flags.length).padStart(15)} │ ${String(compressions.length).padStart(15)} │ ${flags.length>compressions.length?'FLAG':'COMPRESSION'}`);
console.log(`  Hit +5%             │ ${String(fW).padStart(15)} │ ${String(cW).padStart(15)} │`);
console.log(`  Hit Rate            │ ${(fW/flags.length*100).toFixed(1).padStart(14)}% │ ${(cW/compressions.length*100).toFixed(1).padStart(14)}% │ ${fW/flags.length>cW/compressions.length?'FLAG':'COMPRESSION'}`);
console.log(`  Avg MFE             │ ${('+'+((flags.reduce((s,f)=>s+f.mfe,0)/flags.length).toFixed(1))+'%').padStart(15)} │ ${('+'+((compressions.reduce((s,c)=>s+c.mfe,0)/compressions.length).toFixed(1))+'%').padStart(15)} │ ${flags.reduce((s,f)=>s+f.mfe,0)/flags.length>compressions.reduce((s,c)=>s+c.mfe,0)/compressions.length?'FLAG':'COMPRESSION'}`);
console.log(`  Avg MAE             │ ${((flags.reduce((s,f)=>s+f.mae,0)/flags.length).toFixed(1)+'%').padStart(15)} │ ${((compressions.reduce((s,c)=>s+c.mae,0)/compressions.length).toFixed(1)+'%').padStart(15)} │ ${Math.abs(flags.reduce((s,f)=>s+f.mae,0)/flags.length)<Math.abs(compressions.reduce((s,c)=>s+c.mae,0)/compressions.length)?'FLAG':'COMPRESSION'}`);
console.log(`  Avg days to +5%     │ ${(flags.filter(f=>f.h5).length>0?(flags.filter(f=>f.h5).reduce((s,f)=>s+f.d5,0)/fW).toFixed(1)+'d':'—').padStart(15)} │ ${(compressions.filter(c=>c.h5).length>0?(compressions.filter(c=>c.h5).reduce((s,c)=>s+c.d5,0)/cW).toFixed(1)+'d':'—').padStart(15)} │`);
console.log(`  Avg vol ratio       │ ${(flags.reduce((s,f)=>s+f.volR,0)/flags.length).toFixed(1).padStart(14)}x │ ${(compressions.reduce((s,c)=>s+c.volR,0)/compressions.length).toFixed(1).padStart(14)}x │`);

// ═══ FLAG CHARACTERISTICS ═══
console.log('\n═══ FLAG PATTERN CHARACTERISTICS ═══\n');

// By pole size
console.log('  Pole size     │ Count │ Hit Rate │ Avg MFE │ Avg days');
console.log('  ──────────────┼───────┼──────────┼─────────┼────────');
for(const[lo,hi,label]of[[5,8,'5-8%'],[8,12,'8-12%'],[12,20,'12-20%'],[20,50,'20%+']]){
  const grp=flags.filter(f=>f.poleGain>=lo&&f.poleGain<hi);if(grp.length<3)continue;
  const wins=grp.filter(f=>f.h5).length;
  console.log(`  ${label.padEnd(13)} │ ${String(grp.length).padStart(5)} │ ${(wins/grp.length*100).toFixed(1).padStart(7)}% │ ${('+'+((grp.reduce((s,f)=>s+f.mfe,0)/grp.length).toFixed(1))+'%').padStart(7)} │ ${wins>0?(grp.filter(f=>f.h5).reduce((s,f)=>s+f.d5,0)/wins).toFixed(1)+'d':'—'}`);
}

// By flag length
console.log('\n  Flag length   │ Count │ Hit Rate │ Avg MFE');
console.log('  ──────────────┼───────┼──────────┼────────');
for(const[lo,hi,label]of[[3,4,'3 days'],[4,6,'4-5 days'],[6,8,'6-7 days'],[8,11,'8-10 days']]){
  const grp=flags.filter(f=>f.flagLen>=lo&&f.flagLen<hi);if(grp.length<3)continue;
  const wins=grp.filter(f=>f.h5).length;
  console.log(`  ${label.padEnd(13)} │ ${String(grp.length).padStart(5)} │ ${(wins/grp.length*100).toFixed(1).padStart(7)}% │ ${('+'+((grp.reduce((s,f)=>s+f.mfe,0)/grp.length).toFixed(1))+'%').padStart(6)}`);
}

// By volume on breakout
console.log('\n  Breakout vol  │ Count │ Hit Rate │ Avg MFE │ Finding');
console.log('  ──────────────┼───────┼──────────┼─────────┼────────');
for(const[lo,hi,label]of[[0,1,'< 1× avg'],[1,1.5,'1-1.5× avg'],[1.5,2,'1.5-2× avg'],[2,99,'2×+ avg']]){
  const grp=flags.filter(f=>f.volR>=lo&&f.volR<hi);if(grp.length<3)continue;
  const wins=grp.filter(f=>f.h5).length;
  const finding=wins/grp.length>=0.5?'STRONG':wins/grp.length>=0.35?'GOOD':'WEAK';
  console.log(`  ${label.padEnd(13)} │ ${String(grp.length).padStart(5)} │ ${(wins/grp.length*100).toFixed(1).padStart(7)}% │ ${('+'+((grp.reduce((s,f)=>s+f.mfe,0)/grp.length).toFixed(1))+'%').padStart(7)} │ ${finding}`);
}

// ═══ OVERLAP: How many flags are ALSO caught by compression? ═══
console.log('\n═══ OVERLAP ANALYSIS ═══\n');
let overlap=0;
for(const f of flags){
  const match=compressions.find(c=>c.sym===f.sym&&c.date===f.date);
  if(match)overlap++;
}
console.log(`  Flags also caught by compression: ${overlap} of ${flags.length} (${(overlap/flags.length*100).toFixed(0)}%)`);
console.log(`  UNIQUE flags (not caught):         ${flags.length-overlap} of ${flags.length} (${((flags.length-overlap)/flags.length*100).toFixed(0)}%)`);
const uniqueFlags=flags.filter(f=>!compressions.some(c=>c.sym===f.sym&&c.date===f.date));
if(uniqueFlags.length>0){
  const uW=uniqueFlags.filter(f=>f.h5).length;
  console.log(`  Unique flag hit rate:              ${(uW/uniqueFlags.length*100).toFixed(1)}% (${uW}/${uniqueFlags.length})`);
  console.log(`  Unique flag avg MFE:               +${(uniqueFlags.reduce((s,f)=>s+f.mfe,0)/uniqueFlags.length).toFixed(1)}%`);
}

// ═══ TOP FLAG TRADES ═══
console.log('\n═══ TOP 15 FLAG TRADES BY MFE ═══\n');
console.log('  Symbol       │ Date       │ Pole  │ Flag │ BO Vol │ MFE    │ MAE    │ +5%? │ Days');
console.log('  ─────────────┼────────────┼───────┼──────┼────────┼────────┼────────┼──────┼─────');
for(const f of flags.sort((a,b)=>b.mfe-a.mfe).slice(0,15)){
  console.log(`  ${f.sym.padEnd(12)} │ ${(f.date||'—').padEnd(10)} │ ${('+'+f.poleGain.toFixed(0)+'%').padStart(5)} │ ${String(f.flagLen).padStart(3)}d │ ${f.volR.toFixed(1).padStart(5)}x │ ${('+'+f.mfe.toFixed(1)+'%').padStart(6)} │ ${f.mae.toFixed(1).padStart(5)}% │ ${f.h5?'YES':'NO '} │ ${f.h5?String(f.d5).padStart(4):'  —'}`);
}

// ═══ RECOMMENDATION ═══
console.log(`\n${'█'.repeat(80)}`);
console.log('  RECOMMENDATION');
console.log('█'.repeat(80));
const fHitRate=fW/flags.length*100;
const cHitRate=cW/compressions.length*100;
console.log(`
  Flag pattern hit rate:        ${fHitRate.toFixed(1)}% (${fW}/${flags.length})
  Compression hit rate:         ${cHitRate.toFixed(1)}% (${cW}/${compressions.length})
  Overlap:                      ${(overlap/flags.length*100).toFixed(0)}%
  Unique flags not caught:      ${flags.length-overlap}

  ${fHitRate>cHitRate?'FLAG patterns have HIGHER hit rate than compression.':'COMPRESSION has higher or equal hit rate.'}
  ${overlap/flags.length>0.5?'Most flags are already caught by compression — limited added value.':'Many flags are UNIQUE — worth adding as separate detector.'}
`);
