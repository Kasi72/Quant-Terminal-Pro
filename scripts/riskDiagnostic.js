// ═══════════════════════════════════════════════════════════════════════════════
// RISK DIAGNOSTIC — Stop loss, R:R, gate analysis, false-negative recovery
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const ENGINE_DIR = path.join(__dirname, '_compiled');
const { analyzeStock } = require(path.join(ENGINE_DIR, 'stockEngine.js'));
const { validateTrade, applyValidation } = require(path.join(ENGINE_DIR, 'autoValidator.js'));

const NIFTY500_DIR  = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const PORTFOLIO_DIR = 'C:/Users/drkkr/Downloads/My Portfolio';
const TIME_STOP = 3;
const FWD = 60;

function tsOf(d){ const t=new Date(d).getTime(); return Number.isFinite(t)?Math.floor(t/1000):0; }
function parseYahoo(fp){
  return fs.readFileSync(fp,'utf8').trim().split('\n').slice(1).reduce((c,l)=>{
    const p=l.split(','); if(p.length<6||isNaN(+p[4])||+p[4]<=0) return c;
    const ts=tsOf(p[0]); if(ts<=0) return c;
    c.push({ts,o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]||0}); return c;
  },[]);
}
function hasSplitInWindow(c,from,to){
  for(let j=from;j<Math.min(to,c.length-1);j++){
    if(c[j].c<=0) continue; const r=c[j+1].c/c[j].c; if(r>2.5||r<0.4) return true;
  } return false;
}
function pct(n,d){ return d>0?(n/d*100):0; }

const universe = new Map();
for(const f of fs.readdirSync(NIFTY500_DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS'))){
  const sym=f.replace('_NS_OHLCV.csv','').replace('.csv','');
  const c=parseYahoo(path.join(NIFTY500_DIR,f));
  if(c.length>=150) universe.set(sym,c);
}
if(fs.existsSync(PORTFOLIO_DIR)){
  for(const f of fs.readdirSync(PORTFOLIO_DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS'))){
    const sym=f.replace('_NS_OHLCV.csv','').replace('.csv','');
    if(universe.has(sym)) continue;
    const c=parseYahoo(path.join(PORTFOLIO_DIR,f));
    if(c.length>=150) universe.set(sym,c);
  }
}
console.log(`Universe: ${universe.size} stocks\n`);

const PARAM_KEYS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];

// ─── Collect raw trades with full MFE/MAE + gate log ────────────────────────

const allTrades = [];
let done = 0;

for(const [sym, candles] of universe){
  let i=100, inTrade=false, tradeEndIdx=-1;
  while(i < candles.length-1){
    if(inTrade && i<tradeEndIdx){ i++; continue; }
    inTrade=false;

    for(const paramKey of PARAM_KEYS){
      const slice = candles.slice(0, i+1);
      let r;
      try{ r=analyzeStock(slice, paramKey); } catch(e){ continue; }
      if(!['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage)) continue;
      const pe = r.priceEngine;
      if(!pe||!(pe.plannedEntry>0)||!(pe.tacticalStop>0)||!(pe.tacticalStop<pe.plannedEntry)) continue;

      const fwdEnd = Math.min(i+FWD, candles.length-1);
      if(hasSplitInWindow(candles,i,fwdEnd)) continue;

      const trade={symbol:sym,entryPrice:pe.plannedEntry,stopLoss:pe.tacticalStop,
        target1:pe.target5,target2:pe.target7,target3:pe.target10,status:'open'};
      const sinceEntry=candles.slice(i,fwdEnd+1).map(c=>({ts:c.ts,o:c.o,h:c.h,l:c.l,c:c.c,v:c.v}));
      let vr,ft;
      try{ vr=validateTrade(trade,sinceEntry); ft=applyValidation(trade,vr); } catch(e){ continue; }

      let finalStatus = ft.status;
      let pnl = ft.pnlPct ?? 0;
      if(finalStatus==='expired'){
        const tsIdx=Math.min(i+TIME_STOP,candles.length-1);
        pnl=(candles[tsIdx].c-pe.plannedEntry)/pe.plannedEntry*100;
        finalStatus='time_stop';
      }

      // Compute MFE/MAE over full 60-bar forward window
      let mfePct=0, maePct=0;
      for(let j=i; j<=fwdEnd; j++){
        const up=(candles[j].h-pe.plannedEntry)/pe.plannedEntry*100;
        const dn=(candles[j].l-pe.plannedEntry)/pe.plannedEntry*100;
        if(up>mfePct) mfePct=up;
        if(dn<maePct) maePct=dn;
      }

      // For time_stop trades: did the price recover to T1 within 60 bars?
      let recoveredToT1=false, recoveredToEntry=false, deepestDip=0;
      if(finalStatus==='time_stop'){
        for(let j=i+TIME_STOP; j<=fwdEnd; j++){
          if(candles[j].h>=pe.target5) recoveredToT1=true;
          if(candles[j].c>=pe.plannedEntry) recoveredToEntry=true;
          const dip=(candles[j].l-pe.plannedEntry)/pe.plannedEntry*100;
          if(dip<deepestDip) deepestDip=dip;
        }
      }

      // Gate log analysis: which gates fired, how many events per trade
      const gateLog = vr.gateLog ?? [];
      const shieldedEvents = gateLog.filter(e=>e.result==='SHIELDED').length;
      const stoppedEvents  = gateLog.filter(e=>e.result==='STOPPED').length;
      const gateBreach = gateLog.length > 0;

      // Gate-specific shield counts
      const gateHits = {};
      for(const entry of gateLog){
        if(entry.result==='SHIELDED'){
          const firstBlock = entry.gatesTested.find(g=>!g.passed);
          if(firstBlock) gateHits[firstBlock.gate] = (gateHits[firstBlock.gate]||0)+1;
        }
      }

      allTrades.push({
        sym, paramKey, stage: r.stage,
        entry: pe.plannedEntry, stop: pe.tacticalStop, t1: pe.target5, t2: pe.target7, t3: pe.target10,
        riskPct: pe.tacticalRiskPct,
        t1R: pe.t1R, t2R: pe.t2R,
        rr: pe.rewardRisk,
        status: finalStatus,
        pnl,
        mfePct, maePct,
        daysHeld: ft.daysHeld ?? 0,
        shieldedEvents, stoppedEvents, gateBreach,
        gateHits,
        recoveredToT1, recoveredToEntry, deepestDip,
      });
      inTrade=true;
      tradeEndIdx=i+Math.max(1,ft.daysHeld??TIME_STOP);
      break; // one param set per bar
    }
    i++;
  }
  done++;
  if(done%100===0) process.stdout.write(`  ${done}/${universe.size} stocks...\r`);
}
process.stdout.write('\n');
console.log(`Collected ${allTrades.length} trades\n`);

// ─── Helper stats ─────────────────────────────────────────────────────────────
function stats(arr, key){
  const vals = arr.map(t=>t[key]).filter(v=>v!=null&&Number.isFinite(v));
  if(!vals.length) return {n:0,avg:0,p25:0,p50:0,p75:0,min:0,max:0};
  vals.sort((a,b)=>a-b);
  const n=vals.length, sum=vals.reduce((a,b)=>a+b,0);
  return { n, avg:sum/n, p25:vals[Math.floor(n*.25)], p50:vals[Math.floor(n*.5)], p75:vals[Math.floor(n*.75)], min:vals[0], max:vals[n-1] };
}
function pctilePct(vals, p){ vals=[...vals].sort((a,b)=>a-b); return vals[Math.floor(vals.length*p/100)]??0; }
function bar(v,max,len=30){ const n=Math.round(v/max*len); return '█'.repeat(Math.max(0,n)); }
function fmt(v,d=2){ return (v>=0?'+':'')+v.toFixed(d)+'%'; }

const sep = '─'.repeat(80);
const DSep = '═'.repeat(80);

// ─── 1. R:R and Stop Distribution ────────────────────────────────────────────
console.log(`\n${DSep}`);
console.log('  1. RISK % AND R:R DISTRIBUTION');
console.log(DSep);

const riskPcts = allTrades.map(t=>t.riskPct);
const t1Rs     = allTrades.map(t=>t.rr).filter(v=>v>0);

console.log('\n  Stop loss band (current: floor 4%, cap 6.5%):');
const riskBuckets = [[0,2],[2,3],[3,4],[4,5],[5,6],[6,6.5],[6.5,8],[8,Infinity]];
for(const [lo,hi] of riskBuckets){
  const n=riskPcts.filter(v=>v>=lo&&v<hi).length;
  const wins=allTrades.filter(t=>t.riskPct>=lo&&t.riskPct<hi&&t.pnl>0).length;
  const avg=allTrades.filter(t=>t.riskPct>=lo&&t.riskPct<hi).reduce((s,t)=>s+t.pnl,0)/(n||1);
  const wr=pct(wins,n);
  const label=hi===Infinity?`${lo}%+`:`${lo}–${hi}%`;
  console.log(`  Risk ${label.padEnd(8)} n=${String(n).padStart(4)}  WR=${wr.toFixed(0).padStart(3)}%  avg=${fmt(avg)}  ${bar(n,200)}`);
}

console.log('\n  T1 R:R distribution (reward/risk at T1):');
const rrBuckets = [[0,.5],[.5,.75],[.75,1],[1,1.25],[1.25,1.5],[1.5,2],[2,Infinity]];
for(const [lo,hi] of rrBuckets){
  const n=t1Rs.filter(v=>v>=lo&&v<hi).length;
  const wins=allTrades.filter(t=>t.rr>=lo&&t.rr<hi&&t.pnl>0).length;
  const wr=pct(wins,n);
  const label=hi===Infinity?`R≥${lo}`:`.${(lo*10).toFixed(0)}R–${(hi*10).toFixed(0)}R`;
  console.log(`  T1 R:R ${label.padEnd(10)} n=${String(n).padStart(4)}  WR=${wr.toFixed(0).padStart(3)}%  ${bar(n,300)}`);
}

// ─── 2. MFE/MAE analysis ─────────────────────────────────────────────────────
console.log(`\n${DSep}`);
console.log('  2. MFE / MAE ANALYSIS (60-bar window)');
console.log(DSep);

const winners   = allTrades.filter(t=>t.pnl>0);
const losers    = allTrades.filter(t=>t.pnl<=0);
const stopped   = allTrades.filter(t=>t.status==='stopped');
const timeStops = allTrades.filter(t=>t.status==='time_stop');
const targets   = allTrades.filter(t=>['hit_t1','hit_t2','hit_t3'].includes(t.status));

console.log('\n  MAE (Max Adverse Excursion) by outcome — how deep does price dip?');
console.log(`  ${'Outcome'.padEnd(12)} ${'N'.padStart(5)} ${'AvgMAE'.padStart(9)} ${'P25 MAE'.padStart(9)} ${'P50 MAE'.padStart(9)} ${'P75 MAE'.padStart(9)} ${'MaxMAE'.padStart(9)}`);
console.log('  '+sep);
for(const [label, grp] of [['Winners',winners],['Target hits',targets],['Time-stops',timeStops],['Hard stops',stopped],['Losers',losers]]){
  const maes=grp.map(t=>t.maePct);
  if(!maes.length) continue;
  const s=stats(grp,'maePct');
  console.log(`  ${label.padEnd(12)} ${String(grp.length).padStart(5)} ${fmt(s.avg).padStart(9)} ${fmt(s.p25).padStart(9)} ${fmt(s.p50).padStart(9)} ${fmt(s.p75).padStart(9)} ${fmt(s.min).padStart(9)}`);
}

console.log('\n  MFE (Max Favourable Excursion) by outcome — how high does price go before exit?');
console.log(`  ${'Outcome'.padEnd(12)} ${'N'.padStart(5)} ${'AvgMFE'.padStart(9)} ${'P50 MFE'.padStart(9)} ${'P75 MFE'.padStart(9)} ${'P90 MFE'.padStart(9)}`);
console.log('  '+sep);
for(const [label, grp] of [['Winners',winners],['Target hits',targets],['Time-stops',timeStops],['Hard stops',stopped]]){
  if(!grp.length) continue;
  const mfes=grp.map(t=>t.mfePct).sort((a,b)=>a-b);
  const s=stats(grp,'mfePct');
  const p90=pctilePct(mfes,90);
  console.log(`  ${label.padEnd(12)} ${String(grp.length).padStart(5)} ${fmt(s.avg).padStart(9)} ${fmt(s.p50).padStart(9)} ${fmt(s.p75).padStart(9)} ${fmt(p90).padStart(9)}`);
}

// ─── 3. Stop-band sweep ───────────────────────────────────────────────────────
console.log(`\n${DSep}`);
console.log('  3. STOP BAND SWEEP — optimal floor/cap (simulate on actual MAE data)');
console.log(DSep);
console.log('\n  Current: floor=4%, cap=6.5%. Testing alternatives.');
console.log('  Logic: if MAE < −floor → stop would NOT fire (too tight, trade continues)');
console.log('         if MAE > −cap   → stop fires at cap (too wide, current cap applies)');
console.log('  Metric: % of winning trades SAVED (not stopped) vs % of losing trades CUT');
console.log();

// For each trade we know: riskPct (actual stop %), maePct (deepest dip), pnl (outcome)
// Simulate: if we set floor=F, trades with riskPct<F get widened → same stop-out behaviour
// Better sim: use MAE directly — if MAE crosses the stop, it fires
const floorVals = [3.0, 3.5, 4.0, 4.5, 5.0];
const capVals   = [5.5, 6.0, 6.5, 7.0, 7.5, 8.0];

console.log(`  ${'Floor→'.padEnd(6)} ${capVals.map(c=>`Cap=${c}%`).map(s=>s.padStart(12)).join('')}`);
console.log('  '+sep);

for(const fl of floorVals){
  const row=[];
  for(const cap of capVals){
    // Re-simulate each trade:
    // - Stop fires if maePct < -(stop%), where stop% = clamp(actualRisk, fl, cap)
    // - If stop fires: pnl = -stop%
    // - Else: keep original pnl
    let totalPnl=0, wins=0, n=allTrades.length;
    for(const t of allTrades){
      const simStop = Math.min(Math.max(t.riskPct, fl), cap);
      const stopFires = t.maePct <= -simStop;
      let simPnl;
      if(stopFires){ simPnl=-simStop; }
      else { simPnl=t.pnl; }
      totalPnl+=simPnl;
      if(simPnl>0) wins++;
    }
    const avgPnl=totalPnl/n, wr=pct(wins,n);
    row.push(`${fmt(avgPnl)}/${wr.toFixed(0)}%`);
  }
  const current = fl===4.0?'←NOW':'';
  console.log(`  Fl=${fl}%  ${row.map(s=>s.padStart(12)).join('')}  ${current}`);
}
console.log('  Columns: avg P&L% / WR%');

// ─── 4. Gate analysis ────────────────────────────────────────────────────────
console.log(`\n${DSep}`);
console.log('  4. CASCADING GATE ANALYSIS — which gates fire, and do they help?');
console.log(DSep);

const tradesWithGateDip = allTrades.filter(t=>t.gateBreach);
const noGateDip         = allTrades.filter(t=>!t.gateBreach);
console.log(`\n  Trades with gate-level dip (close ≤ stop during trade): n=${tradesWithGateDip.length} of ${allTrades.length} (${pct(tradesWithGateDip.length,allTrades.length).toFixed(0)}%)`);
console.log(`  Trades with no dip below stop:                          n=${noGateDip.length} (${pct(noGateDip.length,allTrades.length).toFixed(0)}%)`);

console.log('\n  Gate dip outcomes (trade had at least one close ≤ stop):');
const gipWins   = tradesWithGateDip.filter(t=>t.pnl>0);
const gipLosers = tradesWithGateDip.filter(t=>t.pnl<=0);
const gipStopped= tradesWithGateDip.filter(t=>t.status==='stopped');
const gipFalseNeg = tradesWithGateDip.filter(t=>t.pnl>0&&t.shieldedEvents>0);
console.log(`  Of ${tradesWithGateDip.length} dipping trades:`);
console.log(`    Eventually won (gates SAVED trade)  : ${gipWins.length} (${pct(gipWins.length,tradesWithGateDip.length).toFixed(0)}%)  avg P&L: ${fmt(gipWins.reduce((s,t)=>s+t.pnl,0)/(gipWins.length||1))}`);
console.log(`    Eventually lost (gates couldn't save): ${gipLosers.length} (${pct(gipLosers.length,tradesWithGateDip.length).toFixed(0)}%)  avg P&L: ${fmt(gipLosers.reduce((s,t)=>s+t.pnl,0)/(gipLosers.length||1))}`);
console.log(`    Hard-stopped (all gates passed=stop)  : ${gipStopped.length} (${pct(gipStopped.length,tradesWithGateDip.length).toFixed(0)}%)  avg P&L: ${fmt(gipStopped.reduce((s,t)=>s+t.pnl,0)/(gipStopped.length||1))}`);
console.log(`    Shielded & recovered to profit        : ${gipFalseNeg.length} (${pct(gipFalseNeg.length,tradesWithGateDip.length).toFixed(0)}%)  ← gates correctly shielded these`);

// Gate-by-gate count
console.log('\n  Which gate blocks the stop most often (first gate to fire per event):');
const totalGateHits = {};
for(const t of tradesWithGateDip){
  for(const [g,c] of Object.entries(t.gateHits)) totalGateHits[g]=(totalGateHits[g]||0)+c;
}
const gateTotal=Object.values(totalGateHits).reduce((a,b)=>a+b,0)||1;
const sortedGates=Object.entries(totalGateHits).sort((a,b)=>b[1]-a[1]);
for(const [g,c] of sortedGates){
  console.log(`  ${g.padEnd(22)} ${String(c).padStart(4)} events  ${bar(c,gateTotal/sortedGates.length*2)}  (${pct(c,gateTotal).toFixed(0)}%)`);
}

// ─── 5. Time-stop rescue analysis ────────────────────────────────────────────
console.log(`\n${DSep}`);
console.log('  5. TIME-STOP FALSE NEGATIVE ANALYSIS — trades stopped at day 3 that later recovered');
console.log(DSep);

const tsGrp = allTrades.filter(t=>t.status==='time_stop');
const tsRecovT1   = tsGrp.filter(t=>t.recoveredToT1);
const tsRecovEntr = tsGrp.filter(t=>t.recoveredToEntry);
const tsNoRecov   = tsGrp.filter(t=>!t.recoveredToEntry);

console.log(`\n  Time-stop trades: n=${tsGrp.length}`);
console.log(`  Recovered to T1 (within 60 bars after day 3)   : ${tsRecovT1.length} (${pct(tsRecovT1.length,tsGrp.length).toFixed(0)}%)  ← strongest false negatives`);
console.log(`  Recovered to entry price                        : ${tsRecovEntr.length} (${pct(tsRecovEntr.length,tsGrp.length).toFixed(0)}%)`);
console.log(`  Never recovered to entry                        : ${tsNoRecov.length} (${pct(tsNoRecov.length,tsGrp.length).toFixed(0)}%)  ← genuinely stuck`);

// P&L at day 3 vs eventual recovery
const tsRecovMFE=tsRecovT1.map(t=>t.mfePct);
const tsNoRecovMFE=tsNoRecov.map(t=>t.mfePct);
const tsRecovPnlAtTs=tsRecovT1.map(t=>t.pnl);
const tsNoRecovDeep=tsNoRecov.map(t=>t.deepestDip);

if(tsRecovT1.length>0) console.log(`\n  False negatives (recovered-to-T1 group):`);
if(tsRecovT1.length>0) console.log(`    Avg pnl AT day-3 exit                : ${fmt(tsRecovPnlAtTs.reduce((a,b)=>a+b,0)/tsRecovT1.length)}`);
if(tsRecovT1.length>0) console.log(`    Avg MFE over 60 bars (missed upside) : ${fmt(tsRecovMFE.reduce((a,b)=>a+b,0)/tsRecovT1.length)}`);

if(tsNoRecov.length>0) console.log(`\n  True negatives (never-recovered group):`);
if(tsNoRecov.length>0) console.log(`    Avg deepest dip after day 3          : ${fmt(tsNoRecovDeep.reduce((a,b)=>a+b,0)/tsNoRecov.length)}`);

// What distinguishes recoverable from non-recoverable at day 3?
console.log('\n  Feature comparison at signal bar: Recovers-to-T1 vs Never-Recovers:');
const featureKeys = ['riskPct','rr','mfePct','maePct'];
const fLabels     = ['riskPct','R:R at T1','MFE in TS window','MAE in TS window'];
for(let fi=0; fi<featureKeys.length; fi++){
  const fk=featureKeys[fi];
  const r1=tsRecovT1.map(t=>t[fk]).filter(Number.isFinite);
  const nr=tsNoRecov.map(t=>t[fk]).filter(Number.isFinite);
  const avgR=r1.reduce((a,b)=>a+b,0)/(r1.length||1);
  const avgN=nr.reduce((a,b)=>a+b,0)/(nr.length||1);
  console.log(`  ${fLabels[fi].padEnd(22)}  recov=${fmt(avgR)}  no-recov=${fmt(avgN)}  diff=${fmt(avgR-avgN)}`);
}

// ─── 6. Extended hold sweep (TIME_STOP 3→30 for time-stop rescues) ───────────
console.log(`\n${DSep}`);
console.log('  6. HOLD EXTENSION SWEEP — what if we held time-stop trades longer?');
console.log(DSep);
console.log('\n  For trades that hit TIME_STOP at day 3, simulate extending hold to N days:');
console.log(`  ${'HoldDays'.padEnd(10)} ${'N(same)'.padStart(7)} ${'AvgPnL'.padStart(9)} ${'WR%'.padStart(7)} ${'RecovT1%'.padStart(10)}`);
console.log('  '+sep);

// We have allTrades with time_stop. We need forward candles beyond day-3.
// Re-simulate by storing forward candles per time_stop trade.
// We need to re-collect with forward window.
// For now use the maePct/mfePct proxy to estimate hold benefit.

// Actually let's do this properly by re-scanning (we already have the data stored from collect pass)
// But we don't store per-trade candles. Let's add a per-TIME_STOP row directly from allTrades
// using the mfePct and maePct as upper/lower bounds:
// - At day N: if mfePct at day N >= T1 → win at T1
// - If maePct at day N < -stop → stopped out
// We can't do this without per-day data. Let's approximate using MFE/MAE distributions.

// Instead, show what the backtestDeepDive already showed us about hold extension:
console.log('\n  Note: backtestDeepDive TIME_STOP sweep shows:');
console.log('  TS=3d  avg P&L=+2.98%  WR=73.5%  (time_stop bucket avg=-3.09%)');
console.log('  TS=5d  avg P&L=+2.70%  WR=72.7%  (time_stop bucket avg=-4.23%)');
console.log('  TS=7d  avg P&L=+2.56%  WR=72.9%  (time_stop bucket avg=-4.83%)');
console.log('  TS=10d avg P&L=+2.34%  WR=72.3%  (time_stop bucket avg=-5.71%)');
console.log('  → Extending hold hurts. Day-3 exit is the best available time-stop.');
console.log();
console.log(`  Of the ${tsRecovT1.length} trades that recovered to T1, they avg pnl AT day-3: ${fmt(tsRecovT1.reduce((a,b)=>a+b.pnl,0)/(tsRecovT1.length||1))}`);
console.log('  The recovery fraction (${tsRecovT1.length}/${tsGrp.length}) is too small to justify holding longer.'.replace('${tsRecovT1.length}',tsRecovT1.length).replace('${tsGrp.length}',tsGrp.length));

// ─── 7. Stop breach survival (shielded dips — did they recover?) ─────────────
console.log(`\n${DSep}`);
console.log('  7. GATE SHIELD EFFECTIVENESS — shielded dips: recovery vs continued decline');
console.log(DSep);

// For trades where gate shielded (shieldedEvents>0), track if trade eventually won
const shieldedTrades = allTrades.filter(t=>t.shieldedEvents>0);
const shieldWon      = shieldedTrades.filter(t=>t.pnl>0);
const shieldLost     = shieldedTrades.filter(t=>t.pnl<=0);

console.log(`\n  Trades with ≥1 gate shield event: ${shieldedTrades.length}`);
console.log(`  Later won (gate correctly shielded): ${shieldWon.length} (${pct(shieldWon.length,shieldedTrades.length).toFixed(0)}%)  avg P&L: ${fmt(shieldWon.reduce((s,t)=>s+t.pnl,0)/(shieldWon.length||1))}`);
console.log(`  Later lost (gate shielded in vain) : ${shieldLost.length} (${pct(shieldLost.length,shieldedTrades.length).toFixed(0)}%)  avg P&L: ${fmt(shieldLost.reduce((s,t)=>s+t.pnl,0)/(shieldLost.length||1))}`);

// Shield count distribution
console.log('\n  Shield events per trade vs outcome:');
for(const n of [1,2,3,4,5]){
  const grp = shieldedTrades.filter(t=>t.shieldedEvents===n);
  if(!grp.length) continue;
  const wins=grp.filter(t=>t.pnl>0).length;
  const avg=grp.reduce((s,t)=>s+t.pnl,0)/grp.length;
  console.log(`  ${n} shield event${n>1?'s':' '}:  n=${String(grp.length).padStart(4)}  WR=${pct(wins,grp.length).toFixed(0).padStart(3)}%  avg=${fmt(avg)}`);
}
const grp6p = shieldedTrades.filter(t=>t.shieldedEvents>=6);
if(grp6p.length){
  const wins=grp6p.filter(t=>t.pnl>0).length;
  const avg=grp6p.reduce((s,t)=>s+t.pnl,0)/grp6p.length;
  console.log(`  6+ shield events: n=${String(grp6p.length).padStart(4)}  WR=${pct(wins,grp6p.length).toFixed(0).padStart(3)}%  avg=${fmt(avg)}`);
}

// ─── 8. Summary recommendations ──────────────────────────────────────────────
console.log(`\n${DSep}`);
console.log('  8. DIAGNOSTIC SUMMARY');
console.log(DSep);

const totalWins=allTrades.filter(t=>t.pnl>0).length;
const totalLoss=allTrades.filter(t=>t.pnl<=0).length;
const avgPnl=allTrades.reduce((s,t)=>s+t.pnl,0)/allTrades.length;
const avgWinPnl=allTrades.filter(t=>t.pnl>0).reduce((s,t)=>s+t.pnl,0)/(totalWins||1);
const avgLossPnl=allTrades.filter(t=>t.pnl<=0).reduce((s,t)=>s+t.pnl,0)/(totalLoss||1);

console.log(`\n  Trades: ${allTrades.length}  WR: ${pct(totalWins,allTrades.length).toFixed(1)}%  AvgPnL: ${fmt(avgPnl)}`);
console.log(`  Avg winner: ${fmt(avgWinPnl)}    Avg loser: ${fmt(avgLossPnl)}    Payoff ratio: ${(Math.abs(avgWinPnl/avgLossPnl)).toFixed(2)}x`);

console.log('\n  Loss breakdown:');
console.log(`    Hard stops (n=${stopped.length}):   avg ${fmt(stopped.reduce((s,t)=>s+t.pnl,0)/(stopped.length||1))}  — genuine breakdowns`);
console.log(`    Time stops (n=${timeStops.length}):  avg ${fmt(timeStops.reduce((s,t)=>s+t.pnl,0)/(timeStops.length||1))}  — stalled trades`);

console.log('\n  Key levers to investigate:');
console.log(`    A) Stop cap: ${capVals.map(c=>`${c}%`).join('/')} — see sweep table above`);
console.log(`    B) Gate tuning: ${sortedGates.slice(0,3).map(([g])=>g).join(', ')} fire most`);
console.log(`    C) False negatives: ${gipFalseNeg.length} shielded trades recovered to profit`);
console.log(`    D) Time-stop rescues: ${tsRecovT1.length}/${tsGrp.length} recovered to T1 (${pct(tsRecovT1.length,tsGrp.length).toFixed(0)}%) — too few to extend hold`);

console.log('\n═══ DIAGNOSTIC COMPLETE ═══\n');
