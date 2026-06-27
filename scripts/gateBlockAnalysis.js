// GATE BLOCK ANALYSIS — What happens AFTER the Cascading Gates blocks a stop?
// For every instance where price hits stop level but gates say "DON'T STOP":
//   → Was it a shakeout (stock recovered) or genuine breakdown (stock kept falling)?
//   → How deep did it dip (MAE) before recovering?
//   → How high did it go (MFE) after being saved?

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/My Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS'));
function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6)continue;const[date,o,h,lo,cl,v]=p;const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};if(!M.hasOwnProperty(m))continue;c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

const blocks=[]; // every instance where gates BLOCKED a stop
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);
  for(let i=40;i<c.length-21;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const entry=s.c,atrVal=a[i],zoneLow=bZ.zL;
    const stopRaw=(entry-(zoneLow-0.5*atrVal))/entry*100;
    const stopPct=Math.max(3.5,Math.min(8,stopRaw));

    // Simulate day by day
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const fc=c[d],day=d-i;
      const pctC=(fc.c-entry)/entry*100;
      if(pctC>-stopPct)continue; // close NOT below stop — skip

      // Close IS below stop level — would a simple stop trigger here? YES.
      // But do the Cascading Gates BLOCK it?
      const prevC=d>=i+2?c[d-1]:null;
      const ppC=d>=i+3?c[d-2]:null;
      const range2=fc.h-fc.l;const openP=fc.o;const isGreen=openP<fc.c;
      const closeLoc2=range2>0?(fc.c-fc.l)/range2*100:50;
      const lwPct2=range2>0?(Math.min(openP,fc.c)-fc.l)/range2*100:0;
      const ch1=prevC?fc.c-prevC.c:0;const ch2=prevC&&ppC?prevC.c-ppC.c:0;
      const rG=((ch2>0?ch2:0)+(ch1>0?ch1:0))/2;const rL=((ch2<0?-ch2:0)+(ch1<0?-ch1:0))/2;
      const rsi2=rL<0.001?100:100-100/(1+rG/rL);

      // Check each gate
      let blocked=false, blockReason='';
      if(rsi2<15){blocked=true;blockReason='G1:RSI<15';}
      else if(!prevC||(prevC.c-entry)/entry*100>-stopPct){blocked=true;blockReason='G2a:1st day';}
      else if(prevC&&fc.c>=prevC.c){blocked=true;blockReason='G2b:stabilizing';}
      else if(fc.v<(prevC?.v||0)*0.8){blocked=true;blockReason='G2c:low vol';}
      else if(lwPct2>=40&&closeLoc2>=50){blocked=true;blockReason='G3:hammer';}
      else if(isGreen&&closeLoc2>=50){blocked=true;blockReason='G4:green';}
      else if(closeLoc2>=35){blocked=true;blockReason='G5:close high';}
      else if(ppC&&fc.c>(ppC.c||entry)){blocked=true;blockReason='G6:OBV up';}
      else if(prevC&&(prevC.o||prevC.c)<=prevC.c){blocked=true;blockReason='G7:prev green';}
      // else: ALL gates passed → stop would trigger (not blocked)

      if(!blocked)continue; // gates didn't block — stop fires, not interesting here

      // Gates BLOCKED the stop. Now track what happened AFTER this block:
      let mfeAfter=0,maeAfter=0,recovered=false,hitT1=false;
      const t1Pct=Math.max(3,Math.min(5,2.15*atrVal/entry*100));
      for(let d2=d+1;d2<=Math.min(i+20,c.length-1);d2++){
        const pH2=(c[d2].h-entry)/entry*100;
        const pL2=(c[d2].l-entry)/entry*100;
        if(pH2>mfeAfter)mfeAfter=pH2;
        if(pL2<maeAfter)maeAfter=pL2;
        if(pH2>=0)recovered=true;
        if(pH2>=t1Pct)hitT1=true;
      }
      // MAE from entry at the point of block
      const maeAtBlock=pctC;

      blocks.push({sym,date:c[i].date,day,blockReason,
        maeAtBlock:pctC,maeAfterBlock:Math.min(pctC,maeAfter),
        mfeAfterBlock:mfeAfter,recovered,hitT1,
        outcome:hitT1?'HIT_T1':recovered?'RECOVERED':mfeAfter>-stopPct?'SURVIVED':'KEPT_FALLING'});
      break; // only first block per signal
    }
  }
}

console.log('█'.repeat(75));
console.log('  GATE BLOCK ANALYSIS — Your 28 Portfolio Stocks');
console.log('█'.repeat(75));
console.log(`\n  Total gate blocks (stop would fire but gates said NO): ${blocks.length}\n`);

// ═══ QUESTION 1: How many were correct blocks vs wrong blocks? ═══
const correct=blocks.filter(b=>b.recovered||b.hitT1); // stock came back — gate was RIGHT
const wrong=blocks.filter(b=>!b.recovered&&!b.hitT1); // stock kept falling — gate was WRONG
console.log('═══ Q1: Was the gate CORRECT to block the stop? ═══\n');
console.log(`  CORRECT blocks (stock recovered):  ${correct.length} (${(correct.length/blocks.length*100).toFixed(1)}%)`);
console.log(`  WRONG blocks (stock kept falling):  ${wrong.length} (${(wrong.length/blocks.length*100).toFixed(1)}%)`);

// Breakdown by outcome
const hitT1=blocks.filter(b=>b.hitT1);
const recoveredOnly=blocks.filter(b=>b.recovered&&!b.hitT1);
const survived=blocks.filter(b=>!b.recovered&&b.mfeAfterBlock>-5);
const keptFalling=blocks.filter(b=>!b.recovered&&b.mfeAfterBlock<=-5);
console.log(`\n  Detailed outcomes after gate blocked the stop:`);
console.log(`    Hit T1 (+5%):        ${hitT1.length} (${(hitT1.length/blocks.length*100).toFixed(1)}%) ← GATE SAVED A WINNER`);
console.log(`    Recovered (>0%):     ${recoveredOnly.length} (${(recoveredOnly.length/blocks.length*100).toFixed(1)}%) ← GATE PREVENTED A FALSE STOP`);
console.log(`    Survived (>-5%):     ${survived.length} (${(survived.length/blocks.length*100).toFixed(1)}%) ← MINIMAL EXTRA DAMAGE`);
console.log(`    Kept falling (<-5%): ${keptFalling.length} (${(keptFalling.length/blocks.length*100).toFixed(1)}%) ← GATE WAS WRONG`);

// ═══ QUESTION 2: MAE after the gate blocked ═══
console.log('\n═══ Q2: How deep did it dip AFTER the gate blocked? ═══\n');
console.log(`  At the moment gate blocked:  avg ${(blocks.reduce((s,b)=>s+b.maeAtBlock,0)/blocks.length).toFixed(1)}% from entry`);
console.log(`  Deepest point AFTER block:   avg ${(blocks.reduce((s,b)=>s+b.maeAfterBlock,0)/blocks.length).toFixed(1)}% from entry`);
console.log(`  Extra dip after block:       avg ${(blocks.reduce((s,b)=>s+b.maeAfterBlock-b.maeAtBlock,0)/blocks.length).toFixed(1)}% additional`);

// Buckets
console.log('\n  MAE after block distribution:');
console.log('  Range          │ Count │  %   │ Meaning');
console.log('  ───────────────┼───────┼──────┼────────');
for(const[lo,hi,meaning]of[[0,999,'Recovered above entry (no loss)'],[- 3,0,'Small dip 0-3%'],[-5,-3,'Moderate 3-5%'],[-8,-5,'Significant 5-8%'],[-15,-8,'Heavy 8-15%'],[-999,-15,'Severe >15%']]){
  const grp=blocks.filter(b=>b.maeAfterBlock>=lo&&b.maeAfterBlock<hi);
  if(lo===0)grp.push(...blocks.filter(b=>b.maeAfterBlock>=0));
  console.log(`  ${(lo===-999?'< -15%':lo===0?'> 0% ':lo+'% to '+hi+'%').padEnd(15)} │ ${String(grp.length).padStart(5)} │ ${(grp.length/blocks.length*100).toFixed(0).padStart(4)}% │ ${meaning}`);
}

// ═══ QUESTION 3: MFE after the gate saved it ═══
console.log('\n═══ Q3: How HIGH did it go AFTER the gate saved it? ═══\n');
console.log(`  Avg MFE after block:  +${(blocks.reduce((s,b)=>s+b.mfeAfterBlock,0)/blocks.length).toFixed(1)}%`);
console.log(`  Hit T1 (+5%):         ${hitT1.length} of ${blocks.length} (${(hitT1.length/blocks.length*100).toFixed(1)}%)`);

console.log('\n  MFE after block distribution:');
console.log('  Range       │ Count │  %   │ Meaning');
console.log('  ────────────┼───────┼──────┼────────');
for(const[lo,hi,meaning]of[[10,999,'+10%+ monster run'],[5,10,'+5-10% hit T1'],[3,5,'+3-5% good move'],[0,3,'+0-3% small gain'],[-5,0,'Still underwater'],[-999,-5,'Kept falling']]){
  const grp=blocks.filter(b=>b.mfeAfterBlock>=lo&&b.mfeAfterBlock<hi);
  console.log(`  ${(lo>=10?'+'+lo+'%+':lo>=0?'+'+lo+'-'+hi+'%':lo+'% to '+hi+'%').padEnd(12)} │ ${String(grp.length).padStart(5)} │ ${(grp.length/blocks.length*100).toFixed(0).padStart(4)}% │ ${meaning}`);
}

// ═══ EVERY SINGLE BLOCK EVENT ═══
console.log('\n═══ EVERY GATE BLOCK — Full detail ═══\n');
console.log('  Symbol       │ Day │ Gate blocked │ At block │ Deepest  │ Best MFE │ Hit T1? │ Outcome');
console.log('  ─────────────┼─────┼─────────────┼──────────┼──────────┼──────────┼─────────┼────────');
for(const b of blocks.sort((a,b)=>b.mfeAfterBlock-a.mfeAfterBlock)){
  console.log(`  ${b.sym.padEnd(12)} │ ${String(b.day).padStart(3)} │ ${b.blockReason.padEnd(13)} │ ${b.maeAtBlock.toFixed(1).padStart(7)}% │ ${b.maeAfterBlock.toFixed(1).padStart(7)}% │ ${('+'+b.mfeAfterBlock.toFixed(1)+'%').padStart(8)} │ ${b.hitT1?'YES    ':'NO     '} │ ${b.outcome}`);
}
