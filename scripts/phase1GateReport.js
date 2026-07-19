'use strict';
/**
 * Phase-1 hitRateGate Performance Report
 *
 * Runs the compiled engine and splits results into:
 *   PREMIUM  — signal passes the Phase-1 optimizer gate (high-precision tier)
 *   STANDARD — signal fires but gate not cleared
 *   ALL      — combined (baseline)
 *
 * Shows the gate's actual lift in OOS hit-rate, PF, MAE, MFE across all archetypes.
 *
 * Deployed gates (from smartHitRateOptimizer Phase-1 solo sweep):
 *   VolumeFootprint  → rsi14≥55 + rsi2≤80 + vol≥2.5 + adx≥30 + body≥0.3 + cloc≥0.7
 *   CompressionCoil  → rsi14≥50 + rsi2≤80 + vol≥2.0 + cloc≥0.5
 *   MomentumPocket   → rsi14≥45
 *   EMAStack         → lowerWick≥0.3
 *   PerfectStorm     → atrPct14≥3
 *   ORS-Prime        → adx14≥15
 */

const fs      = require('fs');
const path    = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { analyzeStock } = require('./_compiled_current/stockEngine.js');

const WINDOW     = 300;
const MAX_HOLD   = 20;
const TARGET_PCT = 5.0;
const OOS_DATE   = '2025-05-05';
const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORKERS  = 10;
const MIN_TURN   = 5_000_000;

const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  'ors_prime_reversal',
];
const LABELS = {
  'optimized_deployable_20plus':    'VolumeFootprint',
  'optimized_highprecision_15plus': 'CompressionCoil',
  'optimized_elite_10plus':         'MomentumPocket',
  'optimized_ultraselective_8plus': 'EMAStack',
  'sniper_95plus':                  'PerfectStorm',
  'ors_prime_reversal':             'ORS-Prime',
};
const BUY_STAGES = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);

const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseNSEDate(s){s=s.trim();if(s.includes('-')){const p=s.split('-');if(p[0].length===4)return Date.UTC(+p[0],+p[1]-1,+p[2]);const m=MON[p[1]];if(m!==undefined)return Date.UTC(+p[2],m,+p[0]);}const d=new Date(s);return isNaN(d.getTime())?0:d.getTime();}
function parseNSE(fp){const lines=fs.readFileSync(fp,'utf8').trim().split('\n');const out=[];for(let i=1;i<lines.length;i++){const p=lines[i].split(',');if(p.length<6)continue;const c=+p[4];if(!c||c<=0)continue;out.push({ts:parseNSEDate(p[0]),o:+p[1],h:+p[2],l:+p[3],c,v:+p[5]||0});}return out;}
function avgTurn(c,i){let s=0,n=0;for(let j=Math.max(0,i-20);j<i;j++){s+=c[j].c*c[j].v;n++;}return n>0?s/n:0;}

function simulateTrade(candles,sigIdx,initStop){
  const eIdx=sigIdx+1;if(eIdx>=candles.length-1)return null;
  const ep=candles[eIdx].o;if(!ep||ep<=0)return null;
  const rawStop=initStop,floorStop=ep*(1-3.5/100),capStop=ep*(1-6.5/100);
  const stop=Math.min(floorStop,Math.max(capStop,rawStop));
  const target=ep*(1+TARGET_PCT/100);
  let hitTarget=false,hitStop=false,barsToTarget=null,mfe=0,mae=0,targetReached=false;
  for(let b=1;b<=MAX_HOLD;b++){
    const idx=eIdx+b;if(idx>=candles.length)break;const bar=candles[idx];
    const barH=(bar.h-ep)/ep*100;if(barH>mfe)mfe=barH;
    if(!targetReached){const barL=(ep-bar.l)/ep*100;if(barL>mae)mae=barL;}
    if(bar.l<=stop){hitStop=true;break;}
    if(bar.h>=target){hitTarget=true;targetReached=true;barsToTarget=b;break;}
  }
  const riskPct=(ep-stop)/ep*100;
  return{hitTarget,hitStop,barsToTarget,riskPct,pnl:hitTarget?TARGET_PCT:(hitStop?-riskPct:0),mfe,mae:hitTarget?mae:null};
}

function aggregate(trades){
  if(!trades.length)return null;
  const n=trades.length,winners=trades.filter(t=>t.hitTarget),losers=trades.filter(t=>t.hitStop&&!t.hitTarget);
  const gW=winners.length*TARGET_PCT,gL=losers.reduce((s,t)=>s+t.riskPct,0);
  const pf=gL>0?gW/gL:(gW>0?999:0);
  const avgPnl=trades.reduce((s,t)=>s+t.pnl,0)/n;
  const mfes=trades.map(t=>t.mfe).sort((a,b)=>a-b);
  const medMFE=mfes[Math.floor(mfes.length/2)]??0;
  const maesW=winners.filter(t=>t.mae!==null).map(t=>t.mae);
  const avgMAE=maesW.length?maesW.reduce((a,b)=>a+b,0)/maesW.length:0;
  const days=winners.filter(t=>t.barsToTarget!==null).map(t=>t.barsToTarget);
  const avgDays=days.length?days.reduce((a,b)=>a+b,0)/days.length:0;
  const winRate=winners.length/n*100;
  return{n,winRate:winRate.toFixed(1),hit5:((winners.length/n)*100).toFixed(1),pf:pf.toFixed(2),avgPnl:avgPnl.toFixed(2),medMFE:medMFE.toFixed(2),avgMAE:avgMAE.toFixed(2),avgDays:avgDays.toFixed(1),nWin:winners.length,nLoss:losers.length,avgRisk:(trades.reduce((s,t)=>s+t.riskPct,0)/n).toFixed(2)};
}

if(!isMainThread){
  const{files,oosTs}=workerData;
  // per-set: all_prem, all_std, all_all, oos_prem, oos_std, oos_all
  const buckets={};
  for(const ps of PARAM_SETS)buckets[ps]={all_prem:[],all_std:[],all_all:[],oos_prem:[],oos_std:[],oos_all:[]};

  for(const fp of files){
    const candles=parseNSE(fp);if(candles.length<WINDOW+MAX_HOLD+5)continue;
    const lastTradePrem={},lastTradeStd={};
    for(const ps of PARAM_SETS){lastTradePrem[ps]=-1;lastTradeStd[ps]=-1;}

    for(let i=WINDOW;i<candles.length-MAX_HOLD-2;i++){
      if(avgTurn(candles,i)<MIN_TURN)continue;
      for(const ps of PARAM_SETS){
        if(i<=lastTradePrem[ps]&&i<=lastTradeStd[ps])continue;
        let result;try{result=analyzeStock(candles.slice(0,i+1),ps);}catch{continue;}
        if(!result||!BUY_STAGES.has(result.stage))continue;
        const initStop=result.tacticalPlan?.stop??result.priceEngine?.stop??candles[i].c*(1-5/100);
        const trade=simulateTrade(candles,i,initStop);if(!trade)continue;

        const gate=result.hitRateGate;
        const isPrem=gate==='PREMIUM';
        const isStd=gate==='STANDARD';
        const isOOS=candles[i].ts>=oosTs;

        // Non-overlapping separate for PREMIUM and STANDARD streams
        if(isPrem&&i>lastTradePrem[ps]){
          lastTradePrem[ps]=i+1+(trade.barsToTarget??MAX_HOLD);
          buckets[ps].all_prem.push(trade);
          if(isOOS)buckets[ps].oos_prem.push(trade);
        } else if(isStd&&i>lastTradeStd[ps]){
          lastTradeStd[ps]=i+1+(trade.barsToTarget??MAX_HOLD);
          buckets[ps].all_std.push(trade);
          if(isOOS)buckets[ps].oos_std.push(trade);
        }
        // ALL track (non-overlapping across both)
        const lastAll=Math.max(lastTradePrem[ps],lastTradeStd[ps]);
        if(i>lastAll-1||(isPrem&&i<=lastTradePrem[ps])||(isStd&&i<=lastTradeStd[ps])){}
        else{buckets[ps].all_all.push(trade);if(isOOS)buckets[ps].oos_all.push(trade);}
      }
    }
  }
  parentPort.postMessage(buckets);
  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────────────────────
const allFiles=fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('.csv')&&f!=='ALL_SYMBOLS_OHLCV.csv').map(f=>path.join(DATA_DIR,f));
const oosTs=parseNSEDate(OOS_DATE);
const chunks=Array.from({length:N_WORKERS},(_,i)=>allFiles.filter((_,j)=>j%N_WORKERS===i));
const combined={};for(const ps of PARAM_SETS)combined[ps]={all_prem:[],all_std:[],all_all:[],oos_prem:[],oos_std:[],oos_all:[]};
let done=0;

Promise.all(chunks.map(files=>new Promise((resolve,reject)=>{
  const w=new Worker(__filename,{workerData:{files,oosTs}});
  w.on('message',data=>{
    for(const ps of PARAM_SETS){
      for(const k of['all_prem','all_std','all_all','oos_prem','oos_std','oos_all'])
        combined[ps][k].push(...data[ps][k]);
    }
    done+=files.length;process.stdout.write(`  ${done}/${allFiles.length}\r`);resolve();
  });
  w.on('error',reject);
}))).then(()=>{
  const ts=new Date().toISOString();
  const outPath=path.join(__dirname,'results',`phase1_gate_report_${ts.replace(/[:.]/g,'-').slice(0,19)}.txt`);
  const lines=[];
  const pr=s=>{ lines.push(s); process.stdout.write(s+'\n'); };

  pr(`\nPhase-1 hitRateGate Performance Report  ${ts}`);
  pr(`Data: ${DATA_DIR}`);
  pr(`Universe: ${allFiles.length} files | OOS cutoff: ${OOS_DATE} | Target: +${TARGET_PCT}% | MaxHold: ${MAX_HOLD} bars`);
  pr(`\nGates deployed (smartHitRateOptimizer Phase-1 solo sweep, 1616 NIFTY ALL symbols):`);
  pr(`  VolumeFootprint  → rsi14≥55 + rsi2≤80 + vol≥2.5 + adx≥30 + body≥0.3 + cloc≥0.7`);
  pr(`  CompressionCoil  → rsi14≥50 + rsi2≤80 + vol≥2.0 + cloc≥0.5`);
  pr(`  MomentumPocket   → rsi14≥45`);
  pr(`  EMAStack         → lowerWick≥0.3 (lower wick ≥30% of candle range)`);
  pr(`  PerfectStorm     → atrPct14≥3 (ATR expansion ≥3% of price)`);
  pr(`  ORS-Prime        → adx14≥15`);
  pr('');

  const SEP='═'.repeat(110);
  const LINE='─'.repeat(110);

  for(const ps of PARAM_SETS){
    const label=LABELS[ps];
    const prem=aggregate(combined[ps].all_prem);
    const std =aggregate(combined[ps].all_std);
    const oosPrem=aggregate(combined[ps].oos_prem);
    const oosStd =aggregate(combined[ps].oos_std);

    pr(SEP);
    pr(`${label.padEnd(18)}   [gate: see above]`);
    pr(LINE);
    pr(`${''.padEnd(14)}  ${'N'.padStart(5)}  ${'WinRate'.padStart(8)}  ${'Hit5%'.padStart(7)}  ${'PF'.padStart(6)}  ${'AvgP&L'.padStart(8)}  ${'MedMFE'.padStart(8)}  ${'AvgMAE'.padStart(8)}  ${'AvgDays'.padStart(8)}  ${'AvgRisk'.padStart(8)}`);
    pr(LINE);

    function row(tag, d){
      if(!d){pr(`${tag.padEnd(14)}  (no signals)`);return;}
      pr(`${tag.padEnd(14)}  ${String(d.n).padStart(5)}  ${(d.winRate+'%').padStart(8)}  ${(d.hit5+'%').padStart(7)}  ${d.pf.padStart(6)}  ${(d.avgPnl>0?'+':'')+d.avgPnl+'%'.padStart(7)}  ${(d.medMFE+'%').padStart(8)}  ${('-'+d.avgMAE+'%').padStart(8)}  ${(d.avgDays+' bars').padStart(8)}  ${(d.avgRisk+'%').padStart(8)}`);
    }

    pr(`  ── Full dataset (IS + OOS) ──`);
    row('  PREMIUM',prem);
    row('  STANDARD',std);
    pr('');
    pr(`  ── OOS only (post ${OOS_DATE}) ──`);
    row('  PREMIUM',oosPrem);
    row('  STANDARD',oosStd);

    // Gate lift summary
    if(oosPrem&&oosStd){
      const lift=(parseFloat(oosPrem.hit5)-parseFloat(oosStd.hit5)).toFixed(1);
      const pfLift=(parseFloat(oosPrem.pf)-parseFloat(oosStd.pf)).toFixed(2);
      pr('');
      pr(`  Gate OOS lift: Hit5 ${lift>0?'+':''}${lift}pp  |  PF ${pfLift>0?'+':''}${pfLift}  |  PREMIUM keeps ${oosPrem.n}/${oosPrem.n+oosStd.n} (${(oosPrem.n/(oosPrem.n+oosStd.n)*100).toFixed(0)}% of signals)`);
    }
    pr('');
  }

  pr(SEP);
  pr('\nSummary — OOS PREMIUM vs STANDARD across all archetypes:');
  pr(`${'Archetype'.padEnd(18)}  ${'PREM n'.padStart(7)}  ${'PREM H5%'.padStart(9)}  ${'PREM PF'.padStart(8)}  ${'PREM AvgP&L'.padStart(12)}  |  ${'STD n'.padStart(6)}  ${'STD H5%'.padStart(9)}  ${'STD PF'.padStart(8)}  ${'Lift'.padStart(6)}`);
  pr('─'.repeat(110));
  for(const ps of PARAM_SETS){
    const label=LABELS[ps];
    const p=aggregate(combined[ps].oos_prem);
    const s=aggregate(combined[ps].oos_std);
    const lift=p&&s?(parseFloat(p.hit5)-parseFloat(s.hit5)).toFixed(1):'—';
    const ps_=p?`${String(p.n).padStart(7)}  ${(p.hit5+'%').padStart(9)}  ${p.pf.padStart(8)}  ${((p.avgPnl>0?'+':'')+p.avgPnl+'%').padStart(12)}`:'      —          —         —             —';
    const ss_=s?`${String(s.n).padStart(6)}  ${(s.hit5+'%').padStart(9)}  ${s.pf.padStart(8)}`:'     —          —         —';
    pr(`${label.padEnd(18)}  ${ps_}  |  ${ss_}  ${lift!=='—'?(parseFloat(lift)>=0?'+':'')+lift+'pp':'—'}`);
  }

  fs.writeFileSync(outPath,lines.join('\n'));
  pr(`\nSaved → ${outPath}`);
});
