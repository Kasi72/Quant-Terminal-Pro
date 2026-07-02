// ═══════════════════════════════════════════════════════════════════════════════
// STOP-LOSS FORENSIC BACKTEST — Phase 2B
// Deep analysis of every stopped + time_stop trade.
// Goal: design a layered, ultra-scientific entry-gating + stop system that
// eliminates or minimises these 264 losing trades without removing winners.
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs'), path = require('path');
const ENGINE_DIR = path.join(__dirname, '_compiled');
const { analyzeStock } = require(path.join(ENGINE_DIR, 'stockEngine.js'));
const { validateTrade, applyValidation } = require(path.join(ENGINE_DIR, 'autoValidator.js'));

const NIFTY500_DIR = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const PORTFOLIO_DIR = 'C:/Users/drkkr/Downloads/My Portfolio';
const PARAM_SETS = [
  'optimized_deployable_20plus','optimized_highprecision_15plus',
  'optimized_elite_10plus','optimized_ultraselective_8plus','sniper_95plus',
];
const FWD = 60, TIME_STOP = 10;

function tsOf(d) { const t=new Date(d).getTime(); return Number.isFinite(t)?Math.floor(t/1000):0; }
function parseYahoo(fp) {
  return fs.readFileSync(fp,'utf8').trim().split('\n').slice(1).reduce((c,l)=>{
    const p=l.split(','); if(p.length<6||isNaN(+p[4])||+p[4]<=0) return c;
    const ts=tsOf(p[0]); if(ts<=0) return c;
    c.push({ts,date:p[0],o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]||0}); return c;
  },[]);
}
function hasSplitInWindow(c,from,to){
  for(let j=from;j<Math.min(to,c.length-1);j++){
    if(c[j].c<=0) continue; const r=c[j+1].c/c[j].c; if(r>2.5||r<0.4) return true;
  } return false;
}

// ── Load universe ──
const universe=new Map();
for(const f of fs.readdirSync(NIFTY500_DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL'))){
  const sym=f.replace('_NS_OHLCV.csv','').replace('.csv','');
  const c=parseYahoo(path.join(NIFTY500_DIR,f)); if(c.length>=150) universe.set(sym,c);
}
if(fs.existsSync(PORTFOLIO_DIR)){
  for(const f of fs.readdirSync(PORTFOLIO_DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL'))){
    const sym=f.replace('_NS_OHLCV.csv','').replace('.csv','');
    if(universe.has(sym)) continue;
    const c=parseYahoo(path.join(PORTFOLIO_DIR,f)); if(c.length>=150) universe.set(sym,c);
  }
}
console.log(`Universe: ${universe.size} stocks\n`);

// ── Collect ALL trades with rich entry metadata ──
const allTrades=[], loserTrades=[], winnerTrades=[];
let done=0, errs=0;

for(const [sym,candles] of universe){
  for(const key of PARAM_SETS){
    let i=100, inTrade=false, tradeEndIdx=-1;
    while(i<candles.length-1){
      if(inTrade&&i<tradeEndIdx){i++;continue;} inTrade=false;
      const slice=candles.slice(0,i+1);
      let r; try{r=analyzeStock(slice,key);}catch(e){errs++;i++;continue;}
      if(!['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage)){i++;continue;}
      const pe=r.priceEngine;
      if(!pe||!(pe.plannedEntry>0)||!(pe.tacticalStop>0)||!(pe.tacticalStop<pe.plannedEntry)){i++;continue;}
      const fwdEnd=Math.min(i+FWD,candles.length-1);
      if(hasSplitInWindow(candles,i,fwdEnd)){i++;continue;}

      // ── Rich entry-bar features ──
      const sig=slice[slice.length-1];
      const vol20avg=slice.length>=21?slice.slice(-21,-1).reduce((s,c)=>s+c.v,0)/20:0;
      const volRatio=vol20avg>0?sig.v/vol20avg:0;
      const atr14=r.atrPct14??0;
      const closeLoc=r.closeLoc??0;
      const upperWickPct=r.upperWickPct??0;
      const bodyPct=r.bodyPct??0;
      const rsi2=r.rsi2??50;
      const rsi14=r.rsi14??50;
      const ups=r.ultraPrecisionScore??0;
      const volatilityExpRatio=r.volatilityExpansionRatio??0;
      const candleQuality=r.candleQualityScore??0;
      const zoneTightness=r.zone?.zoneTightnessPct??0;
      const zoneLen=r.zone?.windowLength??0;
      const pre10AvgRangeATR=r.pre10AvgRangeATR??0;
      const pre10AvgVolRatio=r.pre10AvgVolRatio??0;
      const exactRangeATR=r.exactRangeATR14??0;
      const inflectionScore=r.inflectionScore??0;
      const tacticalRiskPct=pe.tacticalRiskPct??0;
      const disasterRiskPct=pe.disasterRiskPct??0;
      const rewardRisk=pe.rewardRisk??0;
      const atrPctPctl=r.atrPct14Pctl120??0;
      const adx=r.momentum?.adx14??0;
      const emaAligned=r.momentum?.emaAligned?1:0;
      const higherLow=r.momentum?.higherLowConfirmed?1:0;
      const momentumScore=r.momentum?.momentumScore??0;
      const bbWidthPctl=r.stats?.bbWidthPctl??0;
      const keltnerSqueeze=r.stats?.keltnerSqueeze?1:0;
      const ttmSqueeze=r.stats?.ttmSqueezeOn?1:0;
      const hurst=r.stats?.hurst??0.5;
      const sharpe20=r.stats?.sharpe20??0;
      const candleDNAscore=r.candleDNA?.score??0;

      // ── Post-entry bar features (for forensic analysis) ──
      // Track: max adverse excursion (MAE), max favourable excursion (MFE),
      //        day-1/2/3/5 return, first-day range as ATR multiple
      const postBars=candles.slice(i,Math.min(i+TIME_STOP+1,candles.length));
      let mae=0, mfe=0; // % from entry
      const entry=pe.plannedEntry;
      const dayReturns=[];
      for(let j=1;j<postBars.length;j++){
        const lo=(postBars[j].l-entry)/entry*100;
        const hi=(postBars[j].h-entry)/entry*100;
        mae=Math.min(mae,lo);
        mfe=Math.max(mfe,hi);
        dayReturns.push((postBars[j].c-entry)/entry*100);
      }
      const day1Ret=dayReturns[0]??0;
      const day2Ret=dayReturns[1]??0;
      const day3Ret=dayReturns[2]??0;
      const day5Ret=dayReturns[4]??0;
      const day10Ret=dayReturns[9]??0;
      const firstDayRange=(postBars[1]?(postBars[1].h-postBars[1].l)/entry*100:0);

      // ── Simulate trade ──
      const trade={symbol:sym,entryPrice:entry,stopLoss:pe.tacticalStop,
        target1:pe.target5,target2:pe.target7,target3:pe.target10,status:'open'};
      const sinceEntry=candles.slice(i,fwdEnd+1).map(c=>({ts:c.ts,o:c.o,h:c.h,l:c.l,c:c.c,v:c.v}));
      let vr; try{vr=validateTrade(trade,sinceEntry);}catch(e){errs++;i++;continue;}
      const ft=applyValidation(trade,vr);

      let status=ft.status, pnlPct=ft.pnlPct??0, daysHeld=ft.daysHeld??FWD;
      if(status==='expired'){
        const tsCandle=candles[Math.min(i+TIME_STOP,candles.length-1)];
        pnlPct=(tsCandle.c-entry)/entry*100;
        daysHeld=TIME_STOP; status='time_stop';
      }

      const rec={
        sym,paramSet:key,stage:r.stage,status,pnlPct,daysHeld,
        // entry quality
        volRatio,atr14,closeLoc,upperWickPct,bodyPct,rsi2,rsi14,ups,
        volatilityExpRatio,candleQuality,zoneTightness,zoneLen,
        pre10AvgRangeATR,pre10AvgVolRatio,exactRangeATR,inflectionScore,
        tacticalRiskPct,disasterRiskPct,rewardRisk,atrPctPctl,
        adx,emaAligned,higherLow,momentumScore,
        bbWidthPctl,keltnerSqueeze,ttmSqueeze,hurst,sharpe20,candleDNAscore,
        // post-entry forensic
        mae,mfe,day1Ret,day2Ret,day3Ret,day5Ret,day10Ret,firstDayRange,
      };
      allTrades.push(rec);
      if(status==='stopped'||status==='time_stop') loserTrades.push(rec);
      else winnerTrades.push(rec);

      if(status!=='open'){
        tradeEndIdx=i+Math.max(1,daysHeld); inTrade=true; i=tradeEndIdx;
      } else i++;
    }
  }
  done++;
  if(done%50===0) process.stdout.write(`  ...${done}/${universe.size}\n`);
}
console.log(`\nDone. Total=${allTrades.length} Winners=${winnerTrades.length} Losers=${loserTrades.length} Errors=${errs}\n`);

// ── Helper functions ──
function avg(arr,fn){ return arr.length?arr.reduce((s,v)=>s+fn(v),0)/arr.length:0; }
function med(arr,fn){
  const s=[...arr].map(fn).sort((a,b)=>a-b);
  return s.length?s[Math.floor(s.length/2)]:0;
}
function pct(n,d){ return d>0?(n/d*100).toFixed(1)+'%':'—'; }
function fmt(n){ return (n>=0?'+':'')+n.toFixed(2); }
function fmtPct(n){ return (n>=0?'+':'')+n.toFixed(1)+'%'; }

// ── Section printer ──
function section(title){
  console.log('\n'+'═'.repeat(80));
  console.log('  '+title);
  console.log('═'.repeat(80));
}
function compRow(label, losers, winners){
  const la=avg(losers,t=>t[label]), wa=avg(winners,t=>t[label]);
  const lm=med(losers,t=>t[label]), wm=med(winners,t=>t[label]);
  const diff=wa-la;
  const flag = Math.abs(diff)>0.3*Math.abs(wa||la||1) ? ' ◄ SIGNAL' : '';
  console.log(`${label.padEnd(26)} │ L avg ${fmt(la).padStart(8)} med ${fmt(lm).padStart(8)} │ W avg ${fmt(wa).padStart(8)} med ${fmt(wm).padStart(8)} │ diff ${fmt(diff).padStart(8)}${flag}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. LOSER PROFILE vs WINNER PROFILE — feature-by-feature comparison
// ═══════════════════════════════════════════════════════════════════════════
section(`LOSER (${loserTrades.length}) vs WINNER (${winnerTrades.length}) — Feature Comparison`);
console.log(`${'Feature'.padEnd(26)} │ ${'── LOSERS ──'.padEnd(26)} │ ${'── WINNERS ──'.padEnd(26)} │ Δ`);
console.log('─'.repeat(90));
for(const f of [
  'volRatio','closeLoc','upperWickPct','bodyPct','exactRangeATR',
  'pre10AvgRangeATR','pre10AvgVolRatio','zoneTightness','zoneLen',
  'tacticalRiskPct','disasterRiskPct','rewardRisk','inflectionScore',
  'rsi2','rsi14','atr14','atrPctPctl','adx','emaAligned','higherLow',
  'momentumScore','bbWidthPctl','keltnerSqueeze','ttmSqueeze','hurst',
  'sharpe20','candleDNAscore','ups','candleQuality','volatilityExpRatio',
]){ compRow(f, loserTrades, winnerTrades); }

// ═══════════════════════════════════════════════════════════════════════════
// 2. POST-ENTRY PRICE PATH — how losers move vs winners in first 10 days
// ═══════════════════════════════════════════════════════════════════════════
section('POST-ENTRY PRICE PATH (avg % from entry)');
console.log('Day'.padEnd(6)+'│ Losers'.padStart(12)+'│ Winners'.padStart(12)+'│ Δ'.padStart(10));
console.log('─'.repeat(40));
for(const [d,f] of [[1,'day1Ret'],[2,'day2Ret'],[3,'day3Ret'],[5,'day5Ret'],[10,'day10Ret']]){
  const l=avg(loserTrades,t=>t[f]), w=avg(winnerTrades,t=>t[f]);
  console.log(`Day ${d}`.padEnd(6)+'│'+fmtPct(l).padStart(12)+'│'+fmtPct(w).padStart(12)+'│'+fmtPct(w-l).padStart(10));
}
section('MAX ADVERSE / FAVOURABLE EXCURSION in first 10 days');
console.log('Metric'.padEnd(20)+'│ Losers'.padStart(12)+'│ Winners'.padStart(12));
console.log('─'.repeat(46));
for(const [label,fn] of [
  ['Avg MAE%', t=>t.mae],['Med MAE%', t=>t.mae],
  ['Avg MFE%', t=>t.mfe],['Med MFE%', t=>t.mfe],
  ['MFE>1% (reach T1 zone)', t=>t.mfe>1?1:0],
  ['MAE < -2% (deep adverse)', t=>t.mae < -2?1:0],
]){
  const l=avg(loserTrades,fn), w=avg(winnerTrades,fn);
  console.log(label.padEnd(20)+'│'+fmtPct(l).padStart(12)+'│'+fmtPct(w).padStart(12));
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. GATE THRESHOLD SWEEP — for each key feature, find the threshold that
//    best separates losers from winners (maximises loser removal with min
//    winner removal)
// ═══════════════════════════════════════════════════════════════════════════
section('GATE THRESHOLD SWEEP — optimal cut per feature');
console.log('Feature'.padEnd(26)+'│ Threshold'.padStart(12)+'│ LosersRemoved'.padStart(16)+'│ WinnersRemoved'.padStart(17)+'│ NetGain'.padStart(10)+'│ Precision'.padStart(12));
console.log('─'.repeat(95));

function sweepGate(feature, direction, thresholds){
  // direction: 'min' means gate passes value >= threshold (remove below-threshold)
  //            'max' means gate passes value <= threshold (remove above-threshold)
  let best={threshold:null,lostRemoved:0,winnersRemoved:0,netGain:-999,precision:0};
  for(const thr of thresholds){
    const lRemoved = direction==='min'
      ? loserTrades.filter(t=>t[feature]<thr).length
      : loserTrades.filter(t=>t[feature]>thr).length;
    const wRemoved = direction==='min'
      ? winnerTrades.filter(t=>t[feature]<thr).length
      : winnerTrades.filter(t=>t[feature]>thr).length;
    const netGain = lRemoved - wRemoved * 2; // penalise winner removal 2×
    const precision = lRemoved+wRemoved>0 ? lRemoved/(lRemoved+wRemoved) : 0;
    if(netGain>best.netGain) best={threshold:thr,lostRemoved:lRemoved,winnersRemoved:wRemoved,netGain,precision};
  }
  if(best.threshold!==null && best.lostRemoved>0){
    const lPct=(best.lostRemoved/loserTrades.length*100).toFixed(1);
    const wPct=(best.winnersRemoved/winnerTrades.length*100).toFixed(1);
    const thrLabel = ((direction==='min'?'≥':'≤')+best.threshold.toFixed(2)).padStart(12);
    const lStr = (best.lostRemoved+' ('+lPct+'%)').padStart(14);
    const wStr = (best.winnersRemoved+' ('+wPct+'%)').padStart(15);
    console.log(`${feature.padEnd(26)}│${thrLabel} │ ${lStr} │ ${wStr} │${String(best.netGain.toFixed(0)).padStart(9)} │ ${(best.precision*100).toFixed(1).padStart(10)}%`);
  }
}

// Feature sweeps
sweepGate('volRatio','min',[0.5,0.8,1.0,1.2,1.5,1.8,2.0,2.5,3.0]);
sweepGate('closeLoc','min',[30,40,50,55,60,65,70,75,80]);
sweepGate('upperWickPct','max',[10,15,20,25,30,35,40,45,50]);
sweepGate('bodyPct','min',[10,15,20,25,30,35,40,45,50]);
sweepGate('exactRangeATR','min',[1.0,1.2,1.5,1.8,2.0,2.5,3.0]);
sweepGate('tacticalRiskPct','max',[3,4,5,6,7,8]);
sweepGate('rewardRisk','min',[0.5,0.75,1.0,1.25,1.5,2.0,2.5]);
sweepGate('inflectionScore','min',[45,50,55,60,65,70,75,80]);
sweepGate('rsi2','min',[30,40,50,60,70,80,90]);
sweepGate('rsi14','max',[40,50,60,65,70,75,80]);
sweepGate('zoneTightness','max',[2,3,4,5,6,7,8]);
sweepGate('zoneLen','min',[5,6,7,8,10,12,15]);
sweepGate('atrPctPctl','max',[20,30,40,50,60,70,80]);
sweepGate('candleDNAscore','min',[30,40,50,60,70,80]);
sweepGate('ups','min',[30,40,50,60,70,80]);
sweepGate('pre10AvgRangeATR','max',[0.4,0.5,0.6,0.7,0.8,0.9,1.0]);
sweepGate('pre10AvgVolRatio','max',[0.4,0.5,0.6,0.7,0.8,0.9,1.0]);
sweepGate('sharpe20','min',[-1,-0.5,0,0.5,1.0,1.5,2.0]);
sweepGate('hurst','min',[0.3,0.35,0.4,0.45,0.5,0.55,0.6]);
sweepGate('day1Ret','min',[-3,-2,-1.5,-1,-0.5,0,0.5]);
sweepGate('mae','min',[-5,-4,-3,-2,-1.5,-1,-0.5]);

// ═══════════════════════════════════════════════════════════════════════════
// 4. MULTI-GATE COMBOS — test layered gate combinations
// ═══════════════════════════════════════════════════════════════════════════
section('LAYERED GATE COMBINATIONS — impact on net avg P&L');
console.log('Gates'.padEnd(52)+'│    N  │  WR%  │ AvgP&L%  │ %≥5%  │ NetGain vs baseline');
console.log('─'.repeat(100));

function testGates(label, filterFn){
  const kept=allTrades.filter(filterFn);
  if(!kept.length){console.log(label.padEnd(52)+'│ (no trades)'); return null;}
  const wins=kept.filter(t=>t.pnlPct>0);
  const losses=kept.filter(t=>t.pnlPct<0);
  const avgP=avg(kept,t=>t.pnlPct);
  const wr=wins.length/(wins.length+losses.length||1)*100;
  const pct5=kept.filter(t=>t.pnlPct>=5).length/kept.length*100;
  const baseline=avg(allTrades,t=>t.pnlPct);
  const gain=avgP-baseline;
  const flag=avgP>=5?'  ✅ TARGET':'';
  console.log(`${label.padEnd(52)}│${String(kept.length).padStart(6)} │${wr.toFixed(1).padStart(6)}%│${((avgP>=0?'+':'')+avgP.toFixed(2)+'%').padStart(9)} │${pct5.toFixed(1).padStart(6)}%│ ${gain>=0?'+':''}${gain.toFixed(2)}%${flag}`);
  return {kept,avgP,wr};
}

// Baseline
testGates('BASELINE (all 940 trades)', ()=>true);

// Single gates
testGates('volRatio ≥ 1.5x',            t=>t.volRatio>=1.5);
testGates('closeLoc ≥ 60',              t=>t.closeLoc>=60);
testGates('upperWick ≤ 25%',            t=>t.upperWickPct<=25);
testGates('bodyPct ≥ 30%',              t=>t.bodyPct>=30);
testGates('tacticalRisk ≤ 5%',          t=>t.tacticalRiskPct<=5);
testGates('rewardRisk ≥ 1.5',           t=>t.rewardRisk>=1.5);
testGates('inflectionScore ≥ 60',       t=>t.inflectionScore>=60);
testGates('rsi14 ≤ 70',                 t=>t.rsi14<=70);
testGates('candleDNA ≥ 60',             t=>t.candleDNAscore>=60);
testGates('zoneTightness ≤ 5%',         t=>t.zoneTightness<=5);
testGates('zoneLen ≥ 7',                t=>t.zoneLen>=7);
testGates('pre10AvgRangeATR ≤ 0.7',     t=>t.pre10AvgRangeATR<=0.7);
testGates('sharpe20 ≥ 0',               t=>t.sharpe20>=0);
testGates('emaAligned',                 t=>t.emaAligned===1);
testGates('higherLow confirmed',        t=>t.higherLow===1);
testGates('STRONG_BUY stage',           t=>t.stage==='STRONG_BUY');
testGates('HiPrec15+ param',            t=>t.paramSet==='optimized_highprecision_15plus');

console.log('─'.repeat(100));
// 2-gate combos
testGates('volRatio≥1.5 + closeLoc≥60',         t=>t.volRatio>=1.5&&t.closeLoc>=60);
testGates('volRatio≥1.5 + bodyPct≥30',           t=>t.volRatio>=1.5&&t.bodyPct>=30);
testGates('volRatio≥1.5 + rsi14≤70',             t=>t.volRatio>=1.5&&t.rsi14<=70);
testGates('closeLoc≥60 + upperWick≤25',          t=>t.closeLoc>=60&&t.upperWickPct<=25);
testGates('closeLoc≥60 + bodyPct≥30',            t=>t.closeLoc>=60&&t.bodyPct>=30);
testGates('tacticalRisk≤5 + rewardRisk≥1.5',     t=>t.tacticalRiskPct<=5&&t.rewardRisk>=1.5);
testGates('inflectionScore≥60 + volRatio≥1.5',  t=>t.inflectionScore>=60&&t.volRatio>=1.5);
testGates('STRONG_BUY + HiPrec15+',              t=>t.stage==='STRONG_BUY'&&t.paramSet==='optimized_highprecision_15plus');
testGates('candleDNA≥60 + volRatio≥1.5',         t=>t.candleDNAscore>=60&&t.volRatio>=1.5);
testGates('emaAligned + higherLow',              t=>t.emaAligned===1&&t.higherLow===1);
testGates('zoneTightness≤5 + zoneLen≥7',         t=>t.zoneTightness<=5&&t.zoneLen>=7);

console.log('─'.repeat(100));
// 3-gate combos
testGates('SB + closeLoc≥60 + volRatio≥1.5',    t=>t.stage==='STRONG_BUY'&&t.closeLoc>=60&&t.volRatio>=1.5);
testGates('closeLoc≥60 + body≥30 + vol≥1.5',    t=>t.closeLoc>=60&&t.bodyPct>=30&&t.volRatio>=1.5);
testGates('closeLoc≥60 + body≥30 + wick≤25',    t=>t.closeLoc>=60&&t.bodyPct>=30&&t.upperWickPct<=25);
testGates('vol≥1.5 + ema + higherLow',           t=>t.volRatio>=1.5&&t.emaAligned===1&&t.higherLow===1);
testGates('inflection≥60+vol≥1.5+closeLoc≥60',  t=>t.inflectionScore>=60&&t.volRatio>=1.5&&t.closeLoc>=60);
testGates('rR≥1.5+risk≤5+closeLoc≥60',          t=>t.rewardRisk>=1.5&&t.tacticalRiskPct<=5&&t.closeLoc>=60);
testGates('vol≥1.5+DNA≥60+closeLoc≥60',         t=>t.volRatio>=1.5&&t.candleDNAscore>=60&&t.closeLoc>=60);
testGates('HiPrec+SB+vol≥1.5',                  t=>t.paramSet==='optimized_highprecision_15plus'&&t.stage==='STRONG_BUY'&&t.volRatio>=1.5);
testGates('zone≤5+len≥7+vol≥1.5',               t=>t.zoneTightness<=5&&t.zoneLen>=7&&t.volRatio>=1.5);

console.log('─'.repeat(100));
// 4-gate combos targeting ≥5%
testGates('closeLoc≥60+body≥30+vol≥1.5+ema',   t=>t.closeLoc>=60&&t.bodyPct>=30&&t.volRatio>=1.5&&t.emaAligned===1);
testGates('closeLoc≥60+body≥30+vol≥1.5+wick≤25', t=>t.closeLoc>=60&&t.bodyPct>=30&&t.volRatio>=1.5&&t.upperWickPct<=25);
testGates('infl≥60+vol≥1.5+close≥60+body≥30',  t=>t.inflectionScore>=60&&t.volRatio>=1.5&&t.closeLoc>=60&&t.bodyPct>=30);
testGates('rR≥1.5+risk≤5+vol≥1.5+close≥60',    t=>t.rewardRisk>=1.5&&t.tacticalRiskPct<=5&&t.volRatio>=1.5&&t.closeLoc>=60);
testGates('DNA≥60+vol≥1.5+close≥60+body≥30',   t=>t.candleDNAscore>=60&&t.volRatio>=1.5&&t.closeLoc>=60&&t.bodyPct>=30);
testGates('SB+DNA≥60+vol≥1.5+close≥60',        t=>t.stage==='STRONG_BUY'&&t.candleDNAscore>=60&&t.volRatio>=1.5&&t.closeLoc>=60);

// ═══════════════════════════════════════════════════════════════════════════
// 5. DYNAMIC STOP DESIGN — test different stop strategies on losers
// ═══════════════════════════════════════════════════════════════════════════
section('DYNAMIC STOP STRATEGY COMPARISON (on the 264 loser trades)');
console.log('Strategy'.padEnd(40)+'│ Avg Exit P&L%  │ Improvement vs -5.87% base');
console.log('─'.repeat(80));

function stopStrategy(label, exitFn){
  const results=loserTrades.map(t=>{
    // exitFn receives trade record, returns exit P&L% (uses post-entry bars)
    return exitFn(t);
  });
  const a=avg(results,x=>x);
  const base=-5.87;
  const improvement=a-base;
  console.log(`${label.padEnd(40)}│ ${((a>=0?'+':'')+a.toFixed(2)+'%').padStart(14)} │ ${improvement>=0?'+':''}${improvement.toFixed(2)}%`);
}

// For stop strategies we use the mae/day return data already captured
stopStrategy('10-day time stop (current baseline)',  t=>t.day10Ret);
stopStrategy('5-day time stop',                       t=>t.day5Ret);
stopStrategy('3-day time stop',                       t=>t.day3Ret);
stopStrategy('Day-1 exit if day1 < -1.5%',           t=>t.day1Ret<-1.5 ? t.day1Ret : t.day10Ret);
stopStrategy('Day-1 exit if day1 < -2%',             t=>t.day1Ret<-2.0 ? t.day1Ret : t.day10Ret);
stopStrategy('Day-2 exit if day2 < -2%',             t=>t.day2Ret<-2.0 ? t.day2Ret : t.day10Ret);
stopStrategy('Day-3 exit if day3 < -2%',             t=>t.day3Ret<-2.0 ? t.day3Ret : t.day10Ret);
stopStrategy('Day-1 exit if MAE < -2%',              t=>t.mae<-2 ? t.mae : t.day10Ret);
stopStrategy('Day-1 exit if MAE < -3%',              t=>t.mae<-3 ? t.mae : t.day10Ret);
stopStrategy('Breakeven stop: exit if close<entry on day3', t=>t.day3Ret<0 ? t.day3Ret : t.day10Ret);
stopStrategy('Tight stop: MAE<-1.5% → exit day1',   t=>t.mae<-1.5 ? t.mae : t.day10Ret);

// ═══════════════════════════════════════════════════════════════════════════
// 6. FINAL RECOMMENDED GATE SYSTEM — show effect of proposed layered gates
// ═══════════════════════════════════════════════════════════════════════════
section('PROPOSED LAYERED GATE SYSTEM — Impact Summary');

// Gate layers in order of application
const gateResults = [
  ['Layer 0: All signals (baseline)',           ()=>true],
  ['Layer 1: + closeLoc ≥ 60%',               t=>t.closeLoc>=60],
  ['Layer 1+2: + bodyPct ≥ 30%',              t=>t.closeLoc>=60&&t.bodyPct>=30],
  ['Layer 1+2+3: + volRatio ≥ 1.5x',          t=>t.closeLoc>=60&&t.bodyPct>=30&&t.volRatio>=1.5],
  ['Layer 1+2+3+4: + upperWick ≤ 25%',        t=>t.closeLoc>=60&&t.bodyPct>=30&&t.volRatio>=1.5&&t.upperWickPct<=25],
  ['Layer 1+2+3+4+5: + rewardRisk ≥ 1.0',     t=>t.closeLoc>=60&&t.bodyPct>=30&&t.volRatio>=1.5&&t.upperWickPct<=25&&t.rewardRisk>=1.0],
  ['Layer 1+2+3+4+5+6: + emaAligned',         t=>t.closeLoc>=60&&t.bodyPct>=30&&t.volRatio>=1.5&&t.upperWickPct<=25&&t.rewardRisk>=1.0&&t.emaAligned===1],
  ['Layer +candleDNA ≥ 60',                    t=>t.closeLoc>=60&&t.bodyPct>=30&&t.volRatio>=1.5&&t.upperWickPct<=25&&t.rewardRisk>=1.0&&t.emaAligned===1&&t.candleDNAscore>=60],
];

console.log('Gate Layer'.padEnd(45)+'│   N  │  WR%  │ AvgP&L%  │ Losers │ Winners');
console.log('─'.repeat(90));
for(const [label,fn] of gateResults){
  const kept=allTrades.filter(fn);
  const l=kept.filter(t=>t.status==='stopped'||t.status==='time_stop').length;
  const w=kept.filter(t=>t.status!=='stopped'&&t.status!=='time_stop').length;
  const wins=kept.filter(t=>t.pnlPct>0);
  const losses=kept.filter(t=>t.pnlPct<0);
  const avgP=kept.length?avg(kept,t=>t.pnlPct):0;
  const wr=kept.length?wins.length/(wins.length+losses.length||1)*100:0;
  const flag=avgP>=5?'  ✅':'';
  console.log(`${label.padEnd(45)}│${String(kept.length).padStart(5)} │${wr.toFixed(1).padStart(6)}%│${((avgP>=0?'+':'')+avgP.toFixed(2)+'%').padStart(9)} │${String(l).padStart(7)} │${String(w).padStart(8)}${flag}`);
}

console.log('\n═══ STOP-LOSS FORENSIC COMPLETE ═══\n');
