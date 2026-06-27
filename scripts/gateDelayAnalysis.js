// GATE 2 DELAY ANALYSIS — What happens between Day 1 close-below and Day 3 confirmation?
// Key question: How much EXTRA damage occurs while waiting for 3-day confirmation?

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS')&&!f.includes('(1)'));
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
    for(let d=i+1;d<=Math.min(i+15,c.length-1);d++){
      const fc=c[d],day=d-i,range=fc.h-fc.l;
      future.push({day,c:fc.c,h:fc.h,l:fc.l,o:fc.o,
        pctC:(fc.c-entry)/entry*100,pctH:(fc.h-entry)/entry*100,pctL:(fc.l-entry)/entry*100,
        isGreen:fc.o<fc.c,closeLoc:range>0?(fc.c-fc.l)/range*100:50,
        lwPct:range>0?(Math.min(fc.o,fc.c)-fc.l)/range*100:0,
        volR:v20>0?fc.v/v20:1});
    }
    let mfe=0;for(const f of future.slice(0,10))if(f.pctH>mfe)mfe=f.pctH;
    ALL.push({sym,date:c[i].date,entry,stopPct,t1Pct,future,mfe,h5:mfe>=5});
  }
}
console.log(`Signals: ${ALL.length} | Winners: ${ALL.filter(s=>s.h5).length}\n`);

// Find all instances where close falls below stop level
console.log('█'.repeat(85));
console.log('  GATE 2 DELAY ANALYSIS — What happens while waiting for confirmation?');
console.log('█'.repeat(85));

// Track every "close below stop" event
let events1d=0,events2d=0,events3d=0;
let recovered1d=0,recovered2d=0,recovered3d=0; // bounced back above stop
let damage1d=[],damage2d=[],damage3d=[];
let winnersStopped1d=0,winnersStopped2d=0,winnersStopped3d=0;

for(const s of ALL){
  for(let fi=0;fi<s.future.length-3;fi++){
    const f=s.future[fi];
    if(f.pctC>-s.stopPct)continue; // close NOT below stop
    events1d++;
    // Day 1 close below — what happens next?
    const day2=s.future[fi+1];
    const day3=s.future[fi+2];
    if(!day2||!day3)continue;

    // Does it recover (close back above stop) on day 2?
    const recover2=day2.pctC>-s.stopPct;
    if(recover2)recovered1d++;

    // Day 2 also below stop?
    if(day2.pctC<=-s.stopPct){
      events2d++;
      // Does it recover on day 3?
      const recover3=day3.pctC>-s.stopPct;
      if(recover3)recovered2d++;

      // Day 3 also below?
      if(day3.pctC<=-s.stopPct){
        events3d++;
      }
    }

    // Track EXTRA damage from waiting
    // If stopped on Day 1: loss = f.pctC (or stop %)
    // If stopped on Day 2: loss = day2.pctL (worst point by day 2)
    // If stopped on Day 3: loss = day3.pctL (worst point by day 3)
    const loss1=Math.min(f.pctC, -s.stopPct);
    const loss2=Math.min(f.pctL, day2.pctL);
    const loss3=Math.min(f.pctL, day2.pctL, day3.pctL);
    damage1d.push(loss1);
    damage2d.push(loss2);
    damage3d.push(loss3);

    // Was this a winner we'd be falsely stopping?
    if(s.h5){
      winnersStopped1d++;
      if(day2.pctC<=-s.stopPct)winnersStopped2d++;
      if(day2.pctC<=-s.stopPct&&day3.pctC<=-s.stopPct)winnersStopped3d++;
    }
    break; // only count first close-below per signal
  }
}

console.log(`\n  Close-below-stop events: ${events1d}`);
console.log(`\n═══ RECOVERY RATE — How often does close bounce back? ═══\n`);
console.log(`  After 1 day below:  ${recovered1d} of ${events1d} recover (${(recovered1d/events1d*100).toFixed(1)}%)`);
console.log(`  After 2 days below: ${recovered2d} of ${events2d} recover (${events2d>0?(recovered2d/events2d*100).toFixed(1):0}%)`);
console.log(`  3 consecutive days: ${events3d} of ${events1d} (${(events3d/events1d*100).toFixed(1)}%)`);

console.log(`\n═══ FALSE STOPS (winners killed) AT EACH CONFIRMATION LEVEL ═══\n`);
console.log(`  1-day close below:  ${winnersStopped1d} winners would be stopped`);
console.log(`  2-day consecutive:  ${winnersStopped2d} winners would be stopped (${winnersStopped1d-winnersStopped2d} saved by waiting)`);
console.log(`  3-day consecutive:  ${winnersStopped3d} winners would be stopped (${winnersStopped1d-winnersStopped3d} saved by waiting)`);

console.log(`\n═══ DAMAGE ANALYSIS — How much EXTRA do you lose by waiting? ═══\n`);
const avg=(arr)=>arr.length>0?arr.reduce((s,v)=>s+v,0)/arr.length:0;
const p95=(arr)=>{const s=[...arr].sort((a,b)=>a-b);return s[Math.floor(s.length*0.95)]||0;};
console.log(`  Metric           │ Stop Day 1  │ Wait Day 2  │ Wait Day 3`);
console.log(`  ─────────────────┼─────────────┼─────────────┼───────────`);
console.log(`  Avg loss from entry │ ${avg(damage1d).toFixed(1).padStart(10)}% │ ${avg(damage2d).toFixed(1).padStart(10)}% │ ${avg(damage3d).toFixed(1).padStart(9)}%`);
console.log(`  Worst 5% loss      │ ${p95(damage1d).toFixed(1).padStart(10)}% │ ${p95(damage2d).toFixed(1).padStart(10)}% │ ${p95(damage3d).toFixed(1).padStart(9)}%`);
console.log(`  Extra damage vs D1 │ ${' '.repeat(10)}— │ ${(avg(damage2d)-avg(damage1d)).toFixed(1).padStart(10)}% │ ${(avg(damage3d)-avg(damage1d)).toFixed(1).padStart(9)}%`);

// ═══ THE KEY QUESTION: 2-day vs 3-day — cost/benefit ═══
console.log(`\n═══ COST/BENEFIT: 2-DAY vs 3-DAY CONFIRMATION ═══\n`);
console.log(`  Metric                  │ 2-day confirm  │ 3-day confirm  │ Difference`);
console.log(`  ────────────────────────┼────────────────┼────────────────┼──────────`);
console.log(`  False stops (winners)   │ ${String(winnersStopped2d).padStart(14)} │ ${String(winnersStopped3d).padStart(14)} │ ${winnersStopped2d-winnersStopped3d} more saved`);
console.log(`  Avg loss when stopped   │ ${avg(damage2d).toFixed(1).padStart(13)}% │ ${avg(damage3d).toFixed(1).padStart(13)}% │ ${(avg(damage3d)-avg(damage2d)).toFixed(1)}% extra damage`);
console.log(`  Worst 5% loss           │ ${p95(damage2d).toFixed(1).padStart(13)}% │ ${p95(damage3d).toFixed(1).padStart(13)}% │ ${(p95(damage3d)-p95(damage2d)).toFixed(1)}% deeper`);

// ═══ ALTERNATIVE: Hybrid approach — 2-day confirm + tighter conditions on Day 2 ═══
console.log(`\n═══ ALTERNATIVE APPROACH: 2-DAY + SMART CONDITIONS ═══\n`);
console.log(`  Instead of waiting 3 days, use 2-day confirm but with STRICTER gates on Day 2:`);
console.log(`  → Close must be FURTHER below stop on Day 2 (accelerating, not stabilizing)`);
console.log(`  → OBV must confirm on Day 2 (real selling, not noise)`);
console.log(`  → This catches genuine breakdowns on Day 2 while saving shakeouts\n`);

// Test: 2-day with acceleration check
let smartFalse=0,smartCorrect=0,smartWins=0;
for(const s of ALL){
  let stopped=false,t1Hit=false;
  for(let fi=0;fi<Math.min(10,s.future.length);fi++){
    const f=s.future[fi];
    if(!t1Hit&&f.pctH>=s.t1Pct){t1Hit=true;break;}
    if(f.pctC<=-s.stopPct){
      // Check Day 2 (prev day also below + accelerating)
      const prev=fi>0?s.future[fi-1]:null;
      if(!prev||prev.pctC>-s.stopPct)continue; // first day — wait
      // Smart check: Day 2 close WORSE than Day 1 close (accelerating down)
      if(f.pctC>prev.pctC)continue; // stabilizing — don't stop
      // Other gates
      if(f.lwPct>=40&&f.closeLoc>=50)continue;
      if(f.isGreen&&f.closeLoc>=50)continue;
      if(f.closeLoc>=45)continue;
      stopped=true;break;
    }
  }
  if(stopped){if(s.h5)smartFalse++;else smartCorrect++;}
  else if(t1Hit)smartWins++;
}
const smartDecided=smartWins+smartFalse+smartCorrect;
console.log(`  SMART 2-DAY (+ acceleration check):`);
console.log(`    False stops: ${smartFalse} | Wins: ${smartWins} | WR: ${smartDecided>0?(smartWins/smartDecided*100).toFixed(1):0}%`);

// Compare all 3 approaches
console.log(`\n═══ FINAL COMPARISON ═══\n`);
// 1-day
let f1=0,w1=0;for(const s of ALL){let st=false,t1=false;for(const f of s.future.slice(0,10)){if(!t1&&f.pctH>=s.t1Pct){t1=true;break;}if(f.pctC<=-s.stopPct){if(f.lwPct>=40&&f.closeLoc>=50)continue;if(f.isGreen&&f.closeLoc>=50)continue;if(f.closeLoc>=45)continue;st=true;break;}}if(st&&s.h5)f1++;if(t1)w1++;}
// 2-day
let f2=0,w2=0;for(const s of ALL){let st=false,t1=false;for(let fi=0;fi<Math.min(10,s.future.length);fi++){const f=s.future[fi];if(!t1&&f.pctH>=s.t1Pct){t1=true;break;}if(f.pctC<=-s.stopPct){const prev=fi>0?s.future[fi-1]:null;if(!prev||prev.pctC>-s.stopPct)continue;if(f.lwPct>=40&&f.closeLoc>=50)continue;if(f.isGreen&&f.closeLoc>=50)continue;if(f.closeLoc>=45)continue;st=true;break;}}if(st&&s.h5)f2++;if(t1)w2++;}
// 3-day
let f3=0,w3=0;for(const s of ALL){let st=false,t1=false;for(let fi=0;fi<Math.min(10,s.future.length);fi++){const f=s.future[fi];if(!t1&&f.pctH>=s.t1Pct){t1=true;break;}if(f.pctC<=-s.stopPct){const p1=fi>0?s.future[fi-1]:null;const p2=fi>1?s.future[fi-2]:null;if(!p1||p1.pctC>-s.stopPct)continue;if(!p2||p2.pctC>-s.stopPct)continue;if(f.lwPct>=40&&f.closeLoc>=50)continue;if(f.isGreen&&f.closeLoc>=50)continue;if(f.closeLoc>=45)continue;st=true;break;}}if(st&&s.h5)f3++;if(t1)w3++;}

console.log(`  Method              │ False Stops │ Wins │ Winners Saved │ Avg Extra Damage`);
console.log(`  ────────────────────┼─────────────┼──────┼───────────────┼────────────────`);
console.log(`  1-day confirm       │ ${String(f1).padStart(11)} │ ${String(w1).padStart(4)} │ baseline      │ baseline`);
console.log(`  2-day confirm       │ ${String(f2).padStart(11)} │ ${String(w2).padStart(4)} │ ${String(f1-f2).padStart(13)} │ ${(avg(damage2d)-avg(damage1d)).toFixed(1)}% more loss`);
console.log(`  Smart 2-day + accel │ ${String(smartFalse).padStart(11)} │ ${String(smartWins).padStart(4)} │ ${String(f1-smartFalse).padStart(13)} │ ~${(avg(damage2d)-avg(damage1d)).toFixed(1)}% more loss`);
console.log(`  3-day confirm       │ ${String(f3).padStart(11)} │ ${String(w3).padStart(4)} │ ${String(f1-f3).padStart(13)} │ ${(avg(damage3d)-avg(damage1d)).toFixed(1)}% more loss`);

console.log(`\n  ★ RECOMMENDATION: Use 2-DAY confirm (not 3) with acceleration check`);
console.log(`    → Saves ${f1-smartFalse} winners vs 1-day (same as current)`);
console.log(`    → Only ${(avg(damage2d)-avg(damage1d)).toFixed(1)}% extra damage vs stopping on Day 1`);
console.log(`    → 1 day FASTER exit than 3-day confirm`);
console.log(`    → The acceleration check ensures Day 2 close is WORSE than Day 1 (genuine breakdown, not stabilizing)`);
