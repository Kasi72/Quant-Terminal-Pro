'use strict';
/**
 * ideaBacktest3.js — Round 3
 *
 * Key findings from Round 2:
 *   - EMAStack + bull regime: 69.2% OOS  (lowerWick≥0.3 + >50% stocks above EMA50)
 *   - PerfectStorm + bull regime: 69.2% OOS  (atrPct14≥3 + regime)
 *   - ORS-Prime fires mainly in BEAR regime yet hits 66.7% — confirm this
 *
 * Tests:
 *   C1: EMAStack + PerfectStorm pooled in bull regime (combined n)
 *   C2: EMAStack regime variants — 4 tightening conditions
 *         C2a lowerWick≥0.4      C2b RSI14∈[50,75]
 *         C2c vol≥2×             C2d lowerWick≥0.4 + RSI14∈[50,75]
 *   C3: ORS-Prime in BEAR regime explicitly
 *   C4: Regime threshold sweep on EMAStack+PerfectStorm pool (35%→70% breadth)
 *
 * Phase 1 workers: compute breadth ratio per date (not boolean — store the ratio)
 * Phase 2 workers: run C1/C2/C3/C4 tests
 */

const fs   = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { analyzeStock } = require('./_compiled_current/stockEngine.js');

const WINDOW     = 300;
const MAX_HOLD   = 20;
const TARGET_PCT = 5.0;
const OOS_DATE   = '2025-05-05';
const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const N_WORKERS  = 10;
const MIN_TURN   = 5_000_000;

const PS_EMA     = 'optimized_ultraselective_8plus';
const PS_STORM   = 'sniper_95plus';
const PS_ORS     = 'ors_prime_reversal';
const BUY_STAGES = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);

// bucket keys
const C2_KEYS = ['C2a_wick04','C2b_rsi50_75','C2c_vol2x','C2d_wick04_rsi'];
const P2_KEYS = ['C1_pool','C3_ors_bear','C4_sweep_ema','C4_sweep_storm', ...C2_KEYS];

// ── Date / parse helpers ──────────────────────────────────────────────────────
const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
function parseNSEDate(s) {
  s = s.trim();
  if (s.includes('-')) {
    const p = s.split('-');
    if (p[0].length === 4) return Date.UTC(+p[0],+p[1]-1,+p[2]);
    const m = MON[p[1]]; if (m !== undefined) return Date.UTC(+p[2],m,+p[0]);
  }
  const d = new Date(s); return isNaN(d.getTime()) ? 0 : d.getTime();
}
function parseNSE(fp) {
  const lines = fs.readFileSync(fp,'utf8').trim().split('\n');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(','); if (p.length < 6) continue;
    const c = +p[4]; if (!c || c <= 0) continue;
    out.push({ ts:parseNSEDate(p[0]), o:+p[1], h:+p[2], l:+p[3], c, v:+p[5]||0 });
  }
  return out;
}

// ── Indicator helpers ─────────────────────────────────────────────────────────
function buildEMA(closes, period) {
  const k = 2/(period+1), out = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  let s = 0; for (let i=0;i<period;i++) s+=closes[i]; out[period-1]=s/period;
  for (let i=period;i<closes.length;i++) out[i]=closes[i]*k+out[i-1]*(1-k);
  return out;
}

function buildRSI14(closes) {
  const n = closes.length, out = new Array(n).fill(null), P = 14;
  if (n < P+1) return out;
  let ag = 0, al = 0;
  for (let i=1;i<=P;i++) { const d=closes[i]-closes[i-1]; if(d>0) ag+=d; else al-=d; }
  ag/=P; al/=P;
  out[P] = al>0 ? 100-100/(1+ag/al) : 100;
  for (let i=P+1;i<n;i++) {
    const d = closes[i]-closes[i-1], g=d>0?d:0, l=d<0?-d:0;
    ag=(ag*13+g)/14; al=(al*13+l)/14;
    out[i] = al>0 ? 100-100/(1+ag/al) : 100;
  }
  return out;
}

function avgVol(candles, i, p=20) {
  let s=0,n=0; for(let j=Math.max(0,i-p);j<i;j++){s+=candles[j].v;n++;} return n?s/n:0;
}
function avgTurn(candles, i) {
  let s=0,n=0; for(let j=Math.max(0,i-20);j<i;j++){s+=candles[j].c*candles[j].v;n++;} return n?s/n:0;
}

// ── Trade simulator ───────────────────────────────────────────────────────────
function simulate(candles, sigIdx, rawStop) {
  const eIdx=sigIdx+1; if(eIdx>=candles.length-1) return null;
  const ep=candles[eIdx].o; if(!ep||ep<=0) return null;
  const stop=Math.min(ep*(1-3.5/100),Math.max(ep*(1-6.5/100),rawStop));
  const target=ep*(1+TARGET_PCT/100);
  let hitTarget=false,hitStop=false,barsToTarget=null,mfe=0,mae=0;
  for(let b=1;b<=MAX_HOLD;b++){
    const idx=eIdx+b; if(idx>=candles.length) break; const bar=candles[idx];
    const barH=(bar.h-ep)/ep*100; if(barH>mfe) mfe=barH;
    if(!hitTarget){const barL=(ep-bar.l)/ep*100; if(barL>mae) mae=barL;}
    if(bar.l<=stop){hitStop=true;break;}
    if(bar.h>=target){hitTarget=true;barsToTarget=b;break;}
  }
  const riskPct=(ep-stop)/ep*100;
  return{hitTarget,hitStop,barsToTarget,riskPct,
    pnl:hitTarget?TARGET_PCT:(hitStop?-riskPct:0),mfe,mae:hitTarget?mae:null};
}

// ── Stats ─────────────────────────────────────────────────────────────────────
function aggregate(trades) {
  if(!trades||!trades.length) return null;
  const n=trades.length,W=trades.filter(t=>t.hitTarget),L=trades.filter(t=>t.hitStop&&!t.hitTarget);
  const gW=W.length*TARGET_PCT,gL=L.reduce((s,t)=>s+t.riskPct,0);
  const pf=gL>0?gW/gL:(gW>0?999:0);
  const mfes=trades.map(t=>t.mfe).sort((a,b)=>a-b);
  const maesW=W.filter(t=>t.mae!==null).map(t=>t.mae);
  const days=W.filter(t=>t.barsToTarget!==null).map(t=>t.barsToTarget);
  return{n,
    hit5:(W.length/n*100).toFixed(1),pf:pf.toFixed(2),
    avgPnl:(trades.reduce((s,t)=>s+t.pnl,0)/n).toFixed(2),
    medMFE:(mfes[Math.floor(mfes.length/2)]??0).toFixed(2),
    avgMAE:(maesW.length?maesW.reduce((a,b)=>a+b,0)/maesW.length:0).toFixed(2),
    avgDays:(days.length?days.reduce((a,b)=>a+b,0)/days.length:0).toFixed(1),
    avgRisk:(trades.reduce((s,t)=>s+t.riskPct,0)/n).toFixed(2)};
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER
// ─────────────────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const{phase,files,oosTs,ratioMap}=workerData;

  // ── Phase 1: per-date breadth ratio ─────────────────────────────────────
  if (phase===1) {
    const out={}; // ts -> {above,total}
    for(const fp of files){
      const c=parseNSE(fp); if(c.length<50) continue;
      const e50=buildEMA(c.map(x=>x.c),50);
      for(let i=49;i<c.length;i++){
        const ts=c[i].ts;
        const above=(e50[i]!==null&&c[i].c>e50[i])?1:0;
        if(!out[ts]) out[ts]={above:0,total:0};
        out[ts].above+=above; out[ts].total++;
      }
    }
    parentPort.postMessage(out); process.exit(0);
  }

  // ── Phase 2: C1/C2/C3/C4 ────────────────────────────────────────────────
  const buckets={};
  for(const k of P2_KEYS) buckets[k]={all:[],oos:[]};

  for(const fp of files){
    const candles=parseNSE(fp); if(candles.length<WINDOW+MAX_HOLD+5) continue;
    const closes=candles.map(c=>c.c);
    const rsi14arr=buildRSI14(closes);

    const lastTrade={};
    for(const k of P2_KEYS) lastTrade[k]=-1;

    for(let i=WINDOW;i<candles.length-MAX_HOLD-2;i++){
      if(avgTurn(candles,i)<MIN_TURN) continue;
      const ts=candles[i].ts, isOOS=ts>=oosTs;
      const ratio=ratioMap[ts]??0;      // breadth ratio 0.0-1.0
      const isBull=ratio>0.50;
      const isBear=ratio<=0.50;
      const bar=candles[i];

      // Run EMA and Storm archetypes
      const slice=candles.slice(0,i+1);
      let emaFired=false, stormFired=false, orsFired=false;
      let emaStop=null, stormStop=null, orsStop=null;

      try{const r=analyzeStock(slice,PS_EMA);
        if(r&&BUY_STAGES.has(r.stage)){emaFired=true;emaStop=r.tacticalPlan?.stop??r.priceEngine?.stop??bar.c*0.95;}}catch{}
      try{const r=analyzeStock(slice,PS_STORM);
        if(r&&BUY_STAGES.has(r.stage)){stormFired=true;stormStop=r.tacticalPlan?.stop??r.priceEngine?.stop??bar.c*0.95;}}catch{}
      try{const r=analyzeStock(slice,PS_ORS);
        if(r&&BUY_STAGES.has(r.stage)){orsFired=true;orsStop=r.tacticalPlan?.stop??r.priceEngine?.stop??bar.c*0.95;}}catch{}

      // ── C1: EMAStack + PerfectStorm pool in bull regime ─────────────────
      if(i>lastTrade['C1_pool'] && isBull && (emaFired||stormFired)){
        const rawStop=emaFired?emaStop:stormStop;
        const trade=simulate(candles,i,rawStop);
        if(trade){
          lastTrade['C1_pool']=i+1+(trade.barsToTarget??MAX_HOLD);
          buckets['C1_pool'].all.push(trade);
          if(isOOS) buckets['C1_pool'].oos.push(trade);
        }
      }

      // ── C2 variants: EMAStack in bull regime + tightening ───────────────
      if(isBull && emaFired){
        // compute lowerWick, RSI14, vol ratio for this bar
        const rng=bar.h-bar.l;
        const lowerWick=rng>0?(Math.min(bar.o,bar.c)-bar.l)/rng:0;
        const r14=rsi14arr[i];
        const av=avgVol(candles,i,20);
        const volRatio=av>0?bar.v/av:0;

        const variants={
          'C2a_wick04':       lowerWick>=0.40,
          'C2b_rsi50_75':     r14!==null&&r14>=50&&r14<=75,
          'C2c_vol2x':        volRatio>=2.0,
          'C2d_wick04_rsi':   lowerWick>=0.40&&r14!==null&&r14>=50&&r14<=75,
        };
        for(const[key,cond] of Object.entries(variants)){
          if(cond && i>lastTrade[key]){
            const trade=simulate(candles,i,emaStop);
            if(trade){
              lastTrade[key]=i+1+(trade.barsToTarget??MAX_HOLD);
              buckets[key].all.push(trade);
              if(isOOS) buckets[key].oos.push(trade);
            }
          }
        }
      }

      // ── C3: ORS-Prime in BEAR regime ────────────────────────────────────
      if(i>lastTrade['C3_ors_bear'] && isBear && orsFired){
        const trade=simulate(candles,i,orsStop);
        if(trade){
          lastTrade['C3_ors_bear']=i+1+(trade.barsToTarget??MAX_HOLD);
          buckets['C3_ors_bear'].all.push(trade);
          if(isOOS) buckets['C3_ors_bear'].oos.push(trade);
        }
      }

      // ── C4: threshold sweep — store ratio on trade for main-thread sweep ─
      // EMAStack sweep
      if(i>lastTrade['C4_sweep_ema'] && ratio>0.35 && emaFired){
        const trade=simulate(candles,i,emaStop);
        if(trade){
          lastTrade['C4_sweep_ema']=i+1+(trade.barsToTarget??MAX_HOLD);
          const t={...trade,ratio,isOOS};
          buckets['C4_sweep_ema'].all.push(t);
          if(isOOS) buckets['C4_sweep_ema'].oos.push(t);
        }
      }
      // PerfectStorm sweep
      if(i>lastTrade['C4_sweep_storm'] && ratio>0.35 && stormFired){
        const trade=simulate(candles,i,stormStop);
        if(trade){
          lastTrade['C4_sweep_storm']=i+1+(trade.barsToTarget??MAX_HOLD);
          const t={...trade,ratio,isOOS};
          buckets['C4_sweep_storm'].all.push(t);
          if(isOOS) buckets['C4_sweep_storm'].oos.push(t);
        }
      }
    }
  }
  parentPort.postMessage(buckets); process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
const allFiles=fs.readdirSync(DATA_DIR)
  .filter(f=>f.endsWith('.csv')&&f!=='ALL_SYMBOLS_OHLCV.csv')
  .map(f=>path.join(DATA_DIR,f));
const oosTs=parseNSEDate(OOS_DATE);
const chunks=Array.from({length:N_WORKERS},(_,i)=>allFiles.filter((_,j)=>j%N_WORKERS===i));

function runWorkers(phase,extra={}) {
  const combined={}; let done=0;
  return Promise.all(chunks.map(files=>new Promise((resolve,reject)=>{
    const w=new Worker(__filename,{workerData:{phase,files,oosTs,...extra}});
    w.on('message',data=>{
      for(const[k,v] of Object.entries(data)){
        if(!combined[k]) combined[k]={above:0,total:0,all:[],oos:[]};
        if(phase===1){combined[k].above=(combined[k].above||0)+v.above;combined[k].total=(combined[k].total||0)+v.total;}
        else{combined[k].all.push(...(v.all||[]));combined[k].oos.push(...(v.oos||[]));}
      }
      done+=files.length; process.stdout.write(`  Phase ${phase}: ${done}/${allFiles.length}\r`); resolve();
    });
    w.on('error',reject);
  }))).then(()=>{process.stdout.write('\n');return combined;});
}

(async()=>{
  // Phase 1
  process.stdout.write('\nPhase 1: computing breadth ratios...\n');
  const raw=await runWorkers(1);
  const ratioMap={};
  let bull=0,bear=0;
  for(const[ts,{above,total}] of Object.entries(raw)){
    ratioMap[+ts]=total>0?above/total:0;
    if(ratioMap[+ts]>0.50) bull++; else bear++;
  }
  process.stdout.write(`  Bull days >50%: ${bull}  Bear days ≤50%: ${bear}  Total: ${bull+bear}\n`);

  // Phase 2
  process.stdout.write('Phase 2: running C1/C2/C3/C4...\n');
  const res=await runWorkers(2,{ratioMap});

  // ── Output ────────────────────────────────────────────────────────────────
  const ts=new Date().toISOString();
  const lines=[];
  const pr=s=>{lines.push(s);process.stdout.write(s+'\n');};
  const SEP='═'.repeat(112), LINE='─'.repeat(112);

  pr(`\n${SEP}`);
  pr(`Round 3 Idea Backtest   ${ts}`);
  pr(`Universe: ${allFiles.length} NIFTY ALL | OOS cutoff: ${OOS_DATE} | Target: +5% | MaxHold: 20 | MinTurn: 5M`);
  pr(`${SEP}`);

  pr(`\nRound 2 reference (OOS):`);
  pr(`  EMAStack + bull regime:       n=13  Hit5=69.2%  PF=2.10`);
  pr(`  PerfectStorm + bull regime:   n=13  Hit5=69.2%  PF=2.39`);
  pr(`  ORS-Prime (no filter):        n=57  Hit5=66.7%  PF=1.62`);

  // C1
  pr(`\n${LINE}`);
  pr(`C1: EMAStack + PerfectStorm POOLED in bull regime (>50% stocks above EMA50)`);
  {
    const f=aggregate(res['C1_pool']?.all);
    const o=aggregate(res['C1_pool']?.oos);
    pr(`  Full: ${f?`n=${f.n}  Hit5=${f.hit5}%  PF=${f.pf}  AvgP&L=${f.avgPnl>0?'+':''}${f.avgPnl}%  MedMFE=${f.medMFE}%  AvgMAE=-${f.avgMAE}%  AvgDays=${f.avgDays}`:'no signals'}`);
    pr(`  OOS:  ${o?`n=${o.n}   Hit5=${o.hit5}%  PF=${o.pf}  AvgP&L=${o.avgPnl>0?'+':''}${o.avgPnl}%  MedMFE=${o.medMFE}%  AvgMAE=-${o.avgMAE}%  AvgDays=${o.avgDays}`:'no signals'}`);
    if(f&&o) pr(`  IS→OOS: ${(parseFloat(o.hit5)-parseFloat(f.hit5)).toFixed(1)}pp`);
  }

  // C2
  pr(`\n${LINE}`);
  pr(`C2: EMAStack tightening variants in bull regime`);
  const c2labels={
    'C2a_wick04':     'EMAStack + lowerWick≥0.40',
    'C2b_rsi50_75':   'EMAStack + RSI14∈[50,75]',
    'C2c_vol2x':      'EMAStack + vol≥2×avg',
    'C2d_wick04_rsi': 'EMAStack + lowerWick≥0.40 + RSI14∈[50,75]',
  };
  for(const[key,label] of Object.entries(c2labels)){
    const f=aggregate(res[key]?.all),o=aggregate(res[key]?.oos);
    pr(`\n  ${label}`);
    pr(`    Full: ${f?`n=${f.n}  Hit5=${f.hit5}%  PF=${f.pf}  AvgP&L=${f.avgPnl>0?'+':''}${f.avgPnl}%  MedMFE=${f.medMFE}%  AvgDays=${f.avgDays}`:'no signals'}`);
    pr(`    OOS:  ${o?`n=${o.n}   Hit5=${o.hit5}%  PF=${o.pf}  AvgP&L=${o.avgPnl>0?'+':''}${o.avgPnl}%  MedMFE=${o.medMFE}%  AvgDays=${o.avgDays}`:'no signals'}`);
    if(f&&o) pr(`    IS→OOS: ${(parseFloat(o.hit5)-parseFloat(f.hit5)).toFixed(1)}pp`);
  }

  // C3
  pr(`\n${LINE}`);
  pr(`C3: ORS-Prime in BEAR regime (≤50% stocks above EMA50)`);
  {
    const f=aggregate(res['C3_ors_bear']?.all);
    const o=aggregate(res['C3_ors_bear']?.oos);
    pr(`  Full: ${f?`n=${f.n}  Hit5=${f.hit5}%  PF=${f.pf}  AvgP&L=${f.avgPnl>0?'+':''}${f.avgPnl}%  MedMFE=${f.medMFE}%  AvgMAE=-${f.avgMAE}%  AvgDays=${f.avgDays}`:'no signals'}`);
    pr(`  OOS:  ${o?`n=${o.n}   Hit5=${o.hit5}%  PF=${o.pf}  AvgP&L=${o.avgPnl>0?'+':''}${o.avgPnl}%  MedMFE=${o.medMFE}%  AvgMAE=-${o.avgMAE}%  AvgDays=${o.avgDays}`:'no signals'}`);
    if(f&&o) pr(`  IS→OOS: ${(parseFloat(o.hit5)-parseFloat(f.hit5)).toFixed(1)}pp  [ORS baseline no-filter OOS: 66.7%]`);
  }

  // C4
  pr(`\n${LINE}`);
  pr(`C4: Regime threshold sweep — EMAStack and PerfectStorm`);
  pr(`    Threshold  |   EMAStack                              |   PerfectStorm`);
  pr(`    (breadth%) |  Full n  Full H5%  OOS n  OOS H5%  PF  |  Full n  Full H5%  OOS n  OOS H5%  PF`);
  pr(`    ${'─'.repeat(100)}`);

  const THRESHOLDS=[0.35,0.40,0.45,0.50,0.55,0.60,0.65,0.70];
  const emaTrades  =res['C4_sweep_ema']?.all??[];
  const stormTrades=res['C4_sweep_storm']?.all??[];

  for(const T of THRESHOLDS){
    // non-overlapping filtering is already done by worker — just filter by ratio≥T
    const ef=aggregate(emaTrades.filter(t=>t.ratio>=T));
    const eo=aggregate(emaTrades.filter(t=>t.ratio>=T&&t.isOOS));
    const sf=aggregate(stormTrades.filter(t=>t.ratio>=T));
    const so=aggregate(stormTrades.filter(t=>t.ratio>=T&&t.isOOS));

    const efStr=ef?`${String(ef.n).padStart(7)}  ${(ef.hit5+'%').padStart(8)}  ${String(eo?.n??'-').padStart(6)}  ${((eo?.hit5??'-')+'%').padStart(8)}  ${(eo?.pf??'-').padStart(5)}`:'       —         —       —         —      —';
    const sfStr=sf?`${String(sf.n).padStart(7)}  ${(sf.hit5+'%').padStart(8)}  ${String(so?.n??'-').padStart(6)}  ${((so?.hit5??'-')+'%').padStart(8)}  ${(so?.pf??'-').padStart(5)}`:'       —         —       —         —      —';
    pr(`    >${(T*100).toFixed(0).padStart(3)}%       |  ${efStr}  |  ${sfStr}`);
  }

  pr(`\n${SEP}`);
  const outPath=path.join(__dirname,'results',`idea_backtest3_${ts.replace(/[:.]/g,'-').slice(0,19)}.txt`);
  fs.mkdirSync(path.dirname(outPath),{recursive:true});
  fs.writeFileSync(outPath,lines.join('\n'));
  pr(`Saved → ${outPath}`);
})();
