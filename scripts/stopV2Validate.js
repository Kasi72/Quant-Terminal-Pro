// Validate ZoneLow-0.5ATR [3.5%,8%] stop within 10-day timeframe
// Compare old vs new: which trades survive, hit T1, and what's the R-expectancy

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));

function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

// Collect ALL breakout signals with zone data
const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c);
  for(let i=40;i<c.length-11;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const entry=s.c, atrVal=a[i], zoneLow=bZ.zL;

    // Old stop: 0.75ATR clamped [2%,3.5%]
    const oldStopPct = Math.max(2.0, Math.min(3.5, 0.75*atrVal/entry*100));
    const oldStopPrice = entry*(1-oldStopPct/100);

    // New stop: ZoneLow-0.5ATR clamped [3.5%,8%]
    const newStopRaw = (entry - (zoneLow - 0.5*atrVal))/entry*100;
    const newStopPct = Math.max(3.5, Math.min(8.0, newStopRaw));
    const newStopPrice = entry*(1-newStopPct/100);

    // Simulate 10-day outcomes
    let oldStopped=false, oldStopDay=0, newStopped=false, newStopDay=0;
    let hitT1=false, t1Day=0, mfe=0, mae=0;
    let oldStopFirst=false, newStopFirst=false; // which triggers first on same day?

    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){
      const day=d-i;
      const pctH=(c[d].h-entry)/entry*100;
      const pctL=(c[d].l-entry)/entry*100;
      if(pctH>mfe)mfe=pctH;
      if(pctL<mae)mae=pctL;

      // T1 hit check (using backtested clamp: max(3%,min(5%,2.15*ATR%)))
      const t1Pct = Math.max(3.0, Math.min(5.0, 2.15*atrVal/entry*100));
      if(!hitT1 && pctH >= t1Pct){ hitT1=true; t1Day=day; }

      // Stop checks — in real trading, if BOTH stop and target could trigger same day,
      // we assume stop triggers first (conservative: low comes before high)
      if(!oldStopped && !hitT1 && pctL <= -oldStopPct){ oldStopped=true; oldStopDay=day; }
      if(!newStopped && !hitT1 && pctL <= -newStopPct){ newStopped=true; newStopDay=day; }
    }

    ALL.push({sym,date:c[i].date,entry,atrVal,atrPct:atrVal/entry*100,zoneLow,
      oldStopPct,oldStopPrice,newStopPct,newStopPrice,
      oldStopped,oldStopDay,newStopped,newStopDay,
      hitT1,t1Day,mfe,mae,
      // R-multiples
      oldR: oldStopped ? -1 : hitT1 ? Math.max(3,Math.min(5,2.15*atrVal/entry*100))/oldStopPct : mae/oldStopPct,
      newR: newStopped ? -1 : hitT1 ? Math.max(3,Math.min(5,2.15*atrVal/entry*100))/newStopPct : mae/newStopPct,
    });
  }
}

console.log(`Total signals: ${ALL.length}\n`);

// ═══ PART 1: Head-to-head comparison within 10 days ═══
console.log('═'.repeat(80));
console.log('  10-DAY TIMEFRAME: OLD STOP vs NEW STOP');
console.log('═'.repeat(80));

const oldStops = ALL.filter(s=>s.oldStopped);
const newStops = ALL.filter(s=>s.newStopped);
const t1Hits = ALL.filter(s=>s.hitT1);
const oldFalse = ALL.filter(s=>s.oldStopped && s.mfe>=5); // would have hit +5% if not stopped
const newFalse = ALL.filter(s=>s.newStopped && s.mfe>=5);

console.log(`\n  Metric                    │ Old (0.75ATR[2%,3.5%]) │ New (ZoneLow-0.5ATR[3.5%,8%])`);
console.log('  ──────────────────────────┼────────────────────────┼──────────────────────────────');
console.log(`  Total stops (10 days)     │ ${String(oldStops.length).padStart(22)} │ ${String(newStops.length).padStart(28)}`);
console.log(`  T1 hits (10 days)         │ ${String(t1Hits.length).padStart(22)} │ ${String(t1Hits.length).padStart(28)}`);
console.log(`  FALSE stops (MFE≥5%)      │ ${String(oldFalse.length).padStart(22)} │ ${String(newFalse.length).padStart(28)}`);
console.log(`  FALSE stop rate           │ ${(oldFalse.length/ALL.length*100).toFixed(1).padStart(21)}% │ ${(newFalse.length/ALL.length*100).toFixed(1).padStart(27)}%`);
console.log(`  Avg stop % (when stopped) │ ${(oldStops.reduce((s,t)=>s+t.oldStopPct,0)/Math.max(oldStops.length,1)).toFixed(2).padStart(21)}% │ ${(newStops.reduce((s,t)=>s+t.newStopPct,0)/Math.max(newStops.length,1)).toFixed(2).padStart(27)}%`);

// Trades SAVED by new stop (old would stop, new doesn't, and MFE≥5%)
const saved = ALL.filter(s => s.oldStopped && !s.newStopped && s.mfe >= 5);
const savedMfe = saved.length > 0 ? saved.reduce((s,t)=>s+t.mfe,0)/saved.length : 0;
console.log(`\n  Trades SAVED by new stop  │ ${saved.length} winners that old stop killed but new stop kept`);
console.log(`  Avg MFE of saved trades   │ +${savedMfe.toFixed(1)}%`);

// Trades LOST by new stop (new stops but old wouldn't have — because new is wider for some?)
const lostByNew = ALL.filter(s => s.newStopped && !s.oldStopped);
console.log(`  Trades stopped ONLY by new│ ${lostByNew.length} (new is wider so this should be ~0)`);

// ═══ PART 2: R-Expectancy comparison ═══
console.log('\n' + '═'.repeat(80));
console.log('  R-EXPECTANCY WITHIN 10 DAYS');
console.log('═'.repeat(80));

function rExpectancy(trades, stopField, rField) {
  let wins=0,losses=0,totalR=0,winR=0,lossR=0;
  for(const t of trades){
    const stopped = t[stopField];
    if(stopped){ losses++; lossR += -1; totalR += -1; }
    else if(t.hitT1){ wins++; const r=t[rField]; winR+=r; totalR+=r; }
    // else: neither stopped nor T1 — open/expired
  }
  const decided = wins+losses;
  return {wins,losses,decided,winRate:decided>0?(wins/decided*100):0,
    avgWinR:wins>0?winR/wins:0,avgLossR:losses>0?lossR/losses:0,
    expectancy:decided>0?totalR/decided:0,totalR};
}

const oldExp = rExpectancy(ALL, 'oldStopped', 'oldR');
const newExp = rExpectancy(ALL, 'newStopped', 'newR');

console.log(`\n  Metric          │ Old Stop         │ New Stop         │ Improvement`);
console.log('  ────────────────┼──────────────────┼──────────────────┼───────────');
console.log(`  Wins (T1 hit)   │ ${String(oldExp.wins).padStart(16)} │ ${String(newExp.wins).padStart(16)} │ +${newExp.wins-oldExp.wins}`);
console.log(`  Losses (stopped)│ ${String(oldExp.losses).padStart(16)} │ ${String(newExp.losses).padStart(16)} │ ${newExp.losses-oldExp.losses}`);
console.log(`  Win Rate        │ ${oldExp.winRate.toFixed(1).padStart(15)}% │ ${newExp.winRate.toFixed(1).padStart(15)}% │ +${(newExp.winRate-oldExp.winRate).toFixed(1)}%`);
console.log(`  Avg Win R       │ ${oldExp.avgWinR.toFixed(2).padStart(15)}R │ ${newExp.avgWinR.toFixed(2).padStart(15)}R │`);
console.log(`  Avg Loss R      │ ${oldExp.avgLossR.toFixed(2).padStart(15)}R │ ${newExp.avgLossR.toFixed(2).padStart(15)}R │`);
console.log(`  Expectancy/trade│ ${oldExp.expectancy.toFixed(3).padStart(15)}R │ ${newExp.expectancy.toFixed(3).padStart(15)}R │ ${(newExp.expectancy-oldExp.expectancy)>=0?'+':''}${(newExp.expectancy-oldExp.expectancy).toFixed(3)}R`);
console.log(`  Total R (${oldExp.decided}/${newExp.decided} trades) │ ${oldExp.totalR.toFixed(1).padStart(15)}R │ ${newExp.totalR.toFixed(1).padStart(15)}R │ +${(newExp.totalR-oldExp.totalR).toFixed(1)}R`);

// ═══ PART 3: Day-by-day stop distribution ═══
console.log('\n' + '═'.repeat(80));
console.log('  STOP TRIGGER DAY DISTRIBUTION (within 10 days)');
console.log('═'.repeat(80));
console.log('\n  Day │ Old Stops │ Old False │ New Stops │ New False');
console.log('  ────┼───────────┼───────────┼───────────┼─────────');
for(let d=1;d<=10;d++){
  const oS=ALL.filter(s=>s.oldStopped&&s.oldStopDay===d).length;
  const oF=ALL.filter(s=>s.oldStopped&&s.oldStopDay===d&&s.mfe>=5).length;
  const nS=ALL.filter(s=>s.newStopped&&s.newStopDay===d).length;
  const nF=ALL.filter(s=>s.newStopped&&s.newStopDay===d&&s.mfe>=5).length;
  console.log(`  ${String(d).padStart(3)} │ ${String(oS).padStart(9)} │ ${String(oF).padStart(9)} │ ${String(nS).padStart(9)} │ ${String(nF).padStart(8)}`);
}

// ═══ PART 4: Stop % distribution under new formula ═══
console.log('\n' + '═'.repeat(80));
console.log('  NEW STOP % DISTRIBUTION');
console.log('═'.repeat(80));
const pctBuckets = [3.5,4,4.5,5,5.5,6,6.5,7,7.5,8];
console.log('\n  Stop %  │ Count │ Stopped │ False Stops │ T1 Hits │ Survival Rate');
console.log('  ────────┼───────┼─────────┼────────────┼─────────┼──────────────');
for(let b=0;b<pctBuckets.length;b++){
  const lo = b===0?0:pctBuckets[b-1];
  const hi = pctBuckets[b];
  const bucket = ALL.filter(s=>s.newStopPct>lo&&s.newStopPct<=hi);
  const stopped = bucket.filter(s=>s.newStopped).length;
  const falseS = bucket.filter(s=>s.newStopped&&s.mfe>=5).length;
  const t1 = bucket.filter(s=>s.hitT1).length;
  const survival = bucket.length>0?((bucket.length-stopped)/bucket.length*100).toFixed(0):0;
  console.log(`  ≤${hi.toFixed(1).padStart(4)}%  │ ${String(bucket.length).padStart(5)} │ ${String(stopped).padStart(7)} │ ${String(falseS).padStart(10)} │ ${String(t1).padStart(7)} │ ${String(survival).padStart(12)}%`);
}

// ═══ PART 5: Saved trades detail ═══
console.log('\n' + '═'.repeat(80));
console.log(`  TOP 20 TRADES SAVED BY NEW STOP (would hit T1 but old stop killed them)`);
console.log('═'.repeat(80));
const savedDetail = ALL.filter(s=>s.oldStopped && !s.newStopped && s.hitT1).sort((a,b)=>b.mfe-a.mfe);
console.log(`\n  ${savedDetail.length} trades saved and hit T1\n`);
console.log('  Symbol       │ Date       │ OldSL% │ NewSL% │ OldStopDay │ MFE    │ T1 Day │ R gained');
for(const t of savedDetail.slice(0,25)){
  const rGain = Math.max(3,Math.min(5,2.15*t.atrVal/t.entry*100))/t.newStopPct;
  console.log(`  ${t.sym.padEnd(12)} │ ${(t.date||'—').padEnd(10)} │ ${t.oldStopPct.toFixed(1).padStart(5)}% │ ${t.newStopPct.toFixed(1).padStart(5)}% │ ${String(t.oldStopDay).padStart(10)} │ ${t.mfe.toFixed(1).padStart(5)}% │ ${String(t.t1Day).padStart(6)} │ +${rGain.toFixed(2)}R`);
}

// ═══ PART 6: Walk-forward validation of new stop ═══
console.log('\n' + '═'.repeat(80));
console.log('  WALK-FORWARD: New stop on 70% IS vs 30% OOS');
console.log('═'.repeat(80));
// Split ALL by index (time-ordered within each stock)
const sorted = [...ALL].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
const split = Math.floor(sorted.length*0.70);
const IS = sorted.slice(0,split), OOS = sorted.slice(split);
const isExp = rExpectancy(IS, 'newStopped', 'newR');
const oosExp = rExpectancy(OOS, 'newStopped', 'newR');
console.log(`\n  In-Sample:  ${isExp.decided} decided, WR ${isExp.winRate.toFixed(1)}%, Exp ${isExp.expectancy.toFixed(3)}R`);
console.log(`  Out-of-Sample: ${oosExp.decided} decided, WR ${oosExp.winRate.toFixed(1)}%, Exp ${oosExp.expectancy.toFixed(3)}R`);
console.log(`  Degradation: ${((1-oosExp.expectancy/isExp.expectancy)*100).toFixed(0)}%`);

// ═══ PART 7: Fine-tune the clamp range ═══
console.log('\n' + '═'.repeat(80));
console.log('  CLAMP RANGE GRID SEARCH: ZoneLow-0.5ATR [floor%, cap%]');
console.log('═'.repeat(80));
console.log('\n  Floor │ Cap  │ Stops │ FalseStops │ FalseRate │ T1 Hits │ Exp/R    │ TotalR');
console.log('  ──────┼──────┼───────┼────────────┼───────────┼─────────┼──────────┼──────');
const clampResults = [];
for(const floor of [2.5,3.0,3.5,4.0,4.5,5.0]){
  for(const cap of [5,6,7,8,9,10]){
    if(cap<=floor)continue;
    const trades = ALL.map(s=>{
      const rawPct=(s.entry-(s.zoneLow-0.5*s.atrVal))/s.entry*100;
      const stopPct=Math.max(floor,Math.min(cap,rawPct));
      let stopped=false;
      for(const fd of [{day:1},{day:2},{day:3},{day:4},{day:5},{day:6},{day:7},{day:8},{day:9},{day:10}]){
        // We don't have futureDays here — use mae proxy
      }
      // Use MAE as proxy: if mae <= -stopPct, it got stopped
      stopped = s.mae <= -stopPct;
      const hitT1 = s.hitT1 && !stopped;
      return {stopped, hitT1, mfe:s.mfe, stopPct, falseStop: stopped && s.mfe>=5};
    });
    const stops=trades.filter(t=>t.stopped).length;
    const falseStops=trades.filter(t=>t.falseStop).length;
    const t1=trades.filter(t=>t.hitT1).length;
    let totalR=0;
    for(const t of trades){
      if(t.stopped)totalR+=-1;
      else if(t.hitT1)totalR+=Math.max(3,5)/t.stopPct; // approximate R
    }
    const decided=stops+t1;
    const exp=decided>0?totalR/decided:0;
    clampResults.push({floor,cap,stops,falseStops,t1,exp,totalR,decided,falseRate:falseStops/ALL.length*100});
    console.log(`  ${floor.toFixed(1).padStart(5)} │ ${cap.toFixed(0).padStart(4)} │ ${String(stops).padStart(5)} │ ${String(falseStops).padStart(10)} │ ${(falseStops/ALL.length*100).toFixed(1).padStart(8)}% │ ${String(t1).padStart(7)} │ ${exp.toFixed(3).padStart(8)}R │ ${totalR.toFixed(0).padStart(5)}`);
  }
}

// Best by expectancy with ≤10% false stop rate
console.log('\n  ═══ BEST CLAMP (≤10% false stop rate, max expectancy) ═══');
const best=clampResults.filter(c=>c.falseRate<=10).sort((a,b)=>b.exp-a.exp);
for(const b of best.slice(0,5)){
  console.log(`  [${b.floor}%, ${b.cap}%] → ${b.stops} stops, ${b.falseStops} false (${b.falseRate.toFixed(1)}%), Exp ${b.exp.toFixed(3)}R, T1 hits ${b.t1}`);
}
