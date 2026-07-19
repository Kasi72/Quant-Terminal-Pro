'use strict';
/**
 * ideaBacktest5.js — Round 5
 *
 * Extends the body≥0.35 finding from Round 4 to all archetypes.
 * Also tests vol+body stacking and pool combinations.
 *
 * Tests:
 *   E1: EMAStack + body≥0.35                     (bull ≥50%)
 *   E2: EMAStack + vol≥2× + body≥0.35            (bull ≥50%)
 *   E3: EMAStack + RSI14∈[50,75] + body≥0.35     (bull ≥50%)
 *   E4: PerfectStorm + body≥0.35                 (bull ≥50%) [Round4 confirm]
 *   E5: Pool(EMAStack+PerfectStorm) + body≥0.35  (bull ≥50%) [upgraded C1]
 *   E6: ORS-Prime + body≥0.35                    (bear ≤50%)
 *
 * Plus threshold sweeps for best variants.
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

const EMA_KEY = 'optimized_ultraselective_8plus';
const PS_KEY  = 'sniper_95plus';
const ORS_KEY = 'ors_prime_reversal';
const BUY_STAGES = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);

const VARIANT_KEYS = ['E1','E2','E3','E4','E5','E6'];
const SWEEP_KEYS   = ['SW_EMA_body','SW_PS_body','SW_POOL_body'];
const P2_KEYS      = [...VARIANT_KEYS, ...SWEEP_KEYS];

// ── Helpers ───────────────────────────────────────────────────────────────────
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

function buildEMA(closes, period) {
  const k = 2/(period+1), out = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  let s = 0; for (let i = 0; i < period; i++) s += closes[i]; out[period-1] = s/period;
  for (let i = period; i < closes.length; i++) out[i] = closes[i]*k + out[i-1]*(1-k);
  return out;
}
function buildRSI14(closes) {
  const n = closes.length, out = new Array(n).fill(null), P = 14;
  if (n < P+1) return out;
  let ag = 0, al = 0;
  for (let i = 1; i <= P; i++) { const d = closes[i]-closes[i-1]; if(d>0) ag+=d; else al-=d; }
  ag/=P; al/=P;
  out[P] = al>0 ? 100-100/(1+ag/al) : 100;
  for (let i = P+1; i < n; i++) {
    const d = closes[i]-closes[i-1], g=d>0?d:0, l=d<0?-d:0;
    ag=(ag*13+g)/14; al=(al*13+l)/14;
    out[i] = al>0 ? 100-100/(1+ag/al) : 100;
  }
  return out;
}
function avgVol(candles, i, p=20) {
  let s=0, n=0; for(let j=Math.max(0,i-p);j<i;j++){s+=candles[j].v;n++;} return n?s/n:0;
}
function avgTurn(candles, i) {
  let s=0, n=0; for(let j=Math.max(0,i-20);j<i;j++){s+=candles[j].c*candles[j].v;n++;} return n?s/n:0;
}
function bodyRatio(bar) {
  const rng = bar.h - bar.l;
  return rng > 0 ? Math.abs(bar.c - bar.o) / rng : 0;
}

function simulate(candles, sigIdx, rawStop) {
  const eIdx=sigIdx+1; if(eIdx>=candles.length-1) return null;
  const ep=candles[eIdx].o; if(!ep||ep<=0) return null;
  const stop=Math.min(ep*(1-3.5/100),Math.max(ep*(1-6.5/100),rawStop));
  const target=ep*(1+TARGET_PCT/100);
  let hitTarget=false, hitStop=false, barsToTarget=null, mfe=0, mae=0;
  for (let b=1;b<=MAX_HOLD;b++) {
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
function aggregate(trades) {
  if(!trades||!trades.length) return null;
  const n=trades.length, W=trades.filter(t=>t.hitTarget), L=trades.filter(t=>t.hitStop&&!t.hitTarget);
  const gW=W.length*TARGET_PCT, gL=L.reduce((s,t)=>s+t.riskPct,0);
  const pf=gL>0?gW/gL:(gW>0?Infinity:0);
  const mfes=trades.map(t=>t.mfe).sort((a,b)=>a-b);
  const maesW=W.filter(t=>t.mae!==null).map(t=>t.mae);
  const days=W.filter(t=>t.barsToTarget!==null).map(t=>t.barsToTarget);
  return{n,
    hit5:(W.length/n*100).toFixed(1),
    pf:isFinite(pf)?pf.toFixed(2):'999.00',
    avgPnl:(trades.reduce((s,t)=>s+t.pnl,0)/n).toFixed(2),
    medMFE:(mfes[Math.floor(mfes.length/2)]??0).toFixed(2),
    avgMAE:(maesW.length?maesW.reduce((a,b)=>a+b,0)/maesW.length:0).toFixed(2),
    avgDays:(days.length?days.reduce((a,b)=>a+b,0)/days.length:0).toFixed(1),
    avgRisk:(trades.reduce((s,t)=>s+t.riskPct,0)/n).toFixed(2)};
}

// ─────────────────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const{phase,files,oosTs,ratioMap}=workerData;

  if (phase===1) {
    const out={};
    for(const fp of files){
      const c=parseNSE(fp); if(c.length<50) continue;
      const e50=buildEMA(c.map(x=>x.c),50);
      for(let i=49;i<c.length;i++){
        const ts=c[i].ts, above=(e50[i]!==null&&c[i].c>e50[i])?1:0;
        if(!out[ts]) out[ts]={above:0,total:0};
        out[ts].above+=above; out[ts].total++;
      }
    }
    parentPort.postMessage(out); process.exit(0);
  }

  // Phase 2
  const buckets={};
  for(const k of P2_KEYS) buckets[k]={all:[],oos:[]};
  const lastTrade={};

  for(const fp of files){
    const candles=parseNSE(fp); if(candles.length<WINDOW+MAX_HOLD+5) continue;
    const closes=candles.map(c=>c.c);
    const rsi14=buildRSI14(closes);

    for(const k of P2_KEYS) lastTrade[k]=-1;

    for(let i=WINDOW;i<candles.length-MAX_HOLD-2;i++){
      if(avgTurn(candles,i)<MIN_TURN) continue;
      const ts=candles[i].ts, isOOS=ts>=oosTs;
      const ratio=ratioMap[ts]??0;
      const isBull=ratio>0.50, isBear=ratio<=0.50;
      const bar=candles[i];
      const rng=bar.h-bar.l;
      const body=rng>0?Math.abs(bar.c-bar.o)/rng:0;
      const av=avgVol(candles,i,20);
      const volR=av>0?bar.v/av:0;
      const r14=rsi14[i];
      const hasBody=body>=0.35;
      const hasVol=volR>=2.0;
      const hasRSI=r14!==null&&r14>=50&&r14<=75;

      // Try archetypes
      let emaFired=false, emaStop=null;
      let psFired=false,  psStop=null;
      let orsFired=false, orsStop=null;

      if(isBull || isBear) {
        // EMA + variants (bull only)
        if(isBull){
          try{
            const r=analyzeStock(candles.slice(0,i+1),EMA_KEY);
            if(r&&BUY_STAGES.has(r.stage)){
              emaFired=true;
              emaStop=r.tacticalPlan?.stop??r.priceEngine?.stop??bar.c*0.95;
            }
          }catch{}
        }
        // PerfectStorm (bull only)
        if(isBull){
          try{
            const r=analyzeStock(candles.slice(0,i+1),PS_KEY);
            if(r&&BUY_STAGES.has(r.stage)){
              psFired=true;
              psStop=r.tacticalPlan?.stop??r.priceEngine?.stop??bar.c*0.95;
            }
          }catch{}
        }
        // ORS (bear only)
        if(isBear){
          try{
            const r=analyzeStock(candles.slice(0,i+1),ORS_KEY);
            if(r&&BUY_STAGES.has(r.stage)){
              orsFired=true;
              orsStop=r.tacticalPlan?.stop??r.priceEngine?.stop??bar.c*0.95;
            }
          }catch{}
        }
      }

      // ── E1: EMAStack + body≥0.35 (bull) ────────────────────────────────
      if(emaFired&&hasBody&&i>lastTrade['E1']){
        const t=simulate(candles,i,emaStop);
        if(t){lastTrade['E1']=i+1+(t.barsToTarget??MAX_HOLD);
          buckets['E1'].all.push(t);if(isOOS)buckets['E1'].oos.push(t);}
      }
      // ── E2: EMAStack + vol≥2× + body≥0.35 (bull) ────────────────────
      if(emaFired&&hasBody&&hasVol&&i>lastTrade['E2']){
        const t=simulate(candles,i,emaStop);
        if(t){lastTrade['E2']=i+1+(t.barsToTarget??MAX_HOLD);
          buckets['E2'].all.push(t);if(isOOS)buckets['E2'].oos.push(t);}
      }
      // ── E3: EMAStack + RSI14∈[50,75] + body≥0.35 (bull) ─────────────
      if(emaFired&&hasBody&&hasRSI&&i>lastTrade['E3']){
        const t=simulate(candles,i,emaStop);
        if(t){lastTrade['E3']=i+1+(t.barsToTarget??MAX_HOLD);
          buckets['E3'].all.push(t);if(isOOS)buckets['E3'].oos.push(t);}
      }
      // ── E4: PerfectStorm + body≥0.35 (bull ≥50%) ────────────────────
      if(psFired&&hasBody&&i>lastTrade['E4']){
        const t=simulate(candles,i,psStop);
        if(t){lastTrade['E4']=i+1+(t.barsToTarget??MAX_HOLD);
          buckets['E4'].all.push(t);if(isOOS)buckets['E4'].oos.push(t);}
      }
      // ── E5: Pool(EMAStack+PS) + body≥0.35 (bull) ────────────────────
      // Non-overlapping across the pool: fire if either fires, pick best stop
      if((emaFired||psFired)&&hasBody&&i>lastTrade['E5']){
        const st=emaFired?emaStop:psStop;
        const t=simulate(candles,i,st);
        if(t){lastTrade['E5']=i+1+(t.barsToTarget??MAX_HOLD);
          buckets['E5'].all.push(t);if(isOOS)buckets['E5'].oos.push(t);}
      }
      // ── E6: ORS-Prime + body≥0.35 (bear) ────────────────────────────
      if(orsFired&&hasBody&&i>lastTrade['E6']){
        const t=simulate(candles,i,orsStop);
        if(t){lastTrade['E6']=i+1+(t.barsToTarget??MAX_HOLD);
          buckets['E6'].all.push(t);if(isOOS)buckets['E6'].oos.push(t);}
      }

      // ── Sweep buckets (store ratio for threshold analysis) ─────────────
      // SW_EMA_body: EMAStack+body, collect at any ratio≥0.35 for sweep
      if(ratio>=0.35&&emaFired&&hasBody&&i>lastTrade['SW_EMA_body']){
        const t=simulate(candles,i,emaStop);
        if(t){lastTrade['SW_EMA_body']=i+1+(t.barsToTarget??MAX_HOLD);
          const tr={...t,ratio,isOOS};
          buckets['SW_EMA_body'].all.push(tr);if(isOOS)buckets['SW_EMA_body'].oos.push(tr);}
      }
      // SW_PS_body: PerfectStorm+body sweep
      if(ratio>=0.35&&psFired&&hasBody&&i>lastTrade['SW_PS_body']){
        const t=simulate(candles,i,psStop);
        if(t){lastTrade['SW_PS_body']=i+1+(t.barsToTarget??MAX_HOLD);
          const tr={...t,ratio,isOOS};
          buckets['SW_PS_body'].all.push(tr);if(isOOS)buckets['SW_PS_body'].oos.push(tr);}
      }
      // SW_POOL_body: (EMA or PS)+body sweep
      if(ratio>=0.35&&(emaFired||psFired)&&hasBody&&i>lastTrade['SW_POOL_body']){
        const st=emaFired?emaStop:psStop;
        const t=simulate(candles,i,st);
        if(t){lastTrade['SW_POOL_body']=i+1+(t.barsToTarget??MAX_HOLD);
          const tr={...t,ratio,isOOS};
          buckets['SW_POOL_body'].all.push(tr);if(isOOS)buckets['SW_POOL_body'].oos.push(tr);}
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
      done+=files.length;
      process.stdout.write(`  Phase ${phase}: ${done}/${allFiles.length}\r`);
      resolve();
    });
    w.on('error',reject);
  }))).then(()=>{process.stdout.write('\n');return combined;});
}

(async()=>{
  process.stdout.write('\nPhase 1: breadth ratios...\n');
  const raw=await runWorkers(1);
  const ratioMap={};
  for(const[ts,{above,total}] of Object.entries(raw))
    ratioMap[+ts]=total>0?above/total:0;

  process.stdout.write('Phase 2: E1–E6 + sweeps...\n');
  const res=await runWorkers(2,{ratioMap});

  const ts=new Date().toISOString();
  const lines=[]; const pr=s=>{lines.push(s);process.stdout.write(s+'\n');};
  const SEP='═'.repeat(120), LINE='─'.repeat(120);

  pr(`\n${SEP}`);
  pr(`Round 5 — body≥0.35 across archetypes   ${ts}`);
  pr(`Universe: ${allFiles.length} NIFTY ALL | OOS cutoff: ${OOS_DATE} | Target +5% | MaxHold 20 | MinTurn 5M`);
  pr(`Round 4 best: PerfectStorm + body≥0.35 at ≥50% → OOS n=12  Hit5=75.0%  PF=2.94`);
  pr(`${SEP}`);

  const varLabels={
    'E1': 'E1: EMAStack + body≥0.35               (bull ≥50%)',
    'E2': 'E2: EMAStack + vol≥2× + body≥0.35      (bull ≥50%)',
    'E3': 'E3: EMAStack + RSI14∈[50,75] + body≥0.35 (bull ≥50%)',
    'E4': 'E4: PerfectStorm + body≥0.35           (bull ≥50%) [R4 confirm]',
    'E5': 'E5: Pool(EMA+PS) + body≥0.35           (bull ≥50%)',
    'E6': 'E6: ORS-Prime + body≥0.35              (bear ≤50%)',
  };

  pr(`\n${'Variant'.padEnd(55)} ${'Full n'.padStart(7)} ${'Full H5%'.padStart(9)} | ${'OOS n'.padStart(6)} ${'OOS H5%'.padStart(9)} ${'PF'.padStart(7)} ${'AvgP&L'.padStart(8)} ${'MedMFE'.padStart(8)} ${'AvgDays'.padStart(8)} ${'IS→OOS'.padStart(8)}`);
  pr(LINE);

  for(const[key,label] of Object.entries(varLabels)){
    const f=aggregate(res[key]?.all), o=aggregate(res[key]?.oos);
    const fStr=f?`${String(f.n).padStart(7)} ${(f.hit5+'%').padStart(9)}`:'      —         —';
    const oStr=o?`${String(o.n).padStart(6)} ${(o.hit5+'%').padStart(9)} ${o.pf.padStart(7)} ${((o.avgPnl>0?'+':'')+o.avgPnl+'%').padStart(8)} ${(o.medMFE+'%').padStart(8)} ${(o.avgDays+'d').padStart(8)}`:'     —         —        —        —        —       —';
    const decay=f&&o?`${(parseFloat(o.hit5)-parseFloat(f.hit5)).toFixed(1)}pp`.padStart(8):'       —';
    pr(`${label.padEnd(55)} ${fStr} | ${oStr} ${decay}`);
  }

  // ── Threshold sweeps ──────────────────────────────────────────────────────
  pr(`\n${LINE}`);
  pr(`Threshold sweep — OOS only`);
  const THRESHOLDS=[0.45,0.50,0.55,0.60,0.65,0.70];

  for(const SK of SWEEP_KEYS){
    const label={SW_EMA_body:'EMAStack+body≥0.35',SW_PS_body:'PerfectStorm+body≥0.35',SW_POOL_body:'Pool(EMA+PS)+body≥0.35'}[SK];
    pr(`\n  ${label}`);
    pr(`  Threshold  |  OOS n   OOS H5%    PF   AvgP&L  MedMFE  AvgDays`);
    pr(`  ${'─'.repeat(60)}`);
    const oosSw=res[SK]?.oos??[];
    for(const T of THRESHOLDS){
      const tr=oosSw.filter(t=>t.ratio>=T);
      const g=aggregate(tr);
      if(!g){pr(`  >${(T*100).toFixed(0)}%          |  —`);continue;}
      pr(`  >${(T*100).toFixed(0)}%          |${String(g.n).padStart(6)}  ${(g.hit5+'%').padStart(8)}  ${g.pf.padStart(6)}  ${((g.avgPnl>0?'+':'')+g.avgPnl+'%').padStart(7)}  ${(g.medMFE+'%').padStart(7)}  ${(g.avgDays+'d').padStart(7)}`);
    }
  }

  // ── 75%+ summary ─────────────────────────────────────────────────────────
  pr(`\n${SEP}`);
  pr(`★ All OOS combinations clearing 75%:`);
  let found=false;

  // Fixed variants
  for(const[key,label] of Object.entries(varLabels)){
    const g=aggregate(res[key]?.oos);
    if(g&&parseFloat(g.hit5)>=75.0){
      pr(`  ${label.trim().padEnd(55)}  OOS n=${g.n}  Hit5=${g.hit5}%  PF=${g.pf}  AvgP&L=${g.avgPnl>0?'+':''}${g.avgPnl}%`);
      found=true;
    }
  }
  // Sweep thresholds
  for(const SK of SWEEP_KEYS){
    const lbl={SW_EMA_body:'EMAStack+body',SW_PS_body:'PerfectStorm+body',SW_POOL_body:'Pool+body'}[SK];
    const oosSw=res[SK]?.oos??[];
    for(const T of THRESHOLDS){
      const g=aggregate(oosSw.filter(t=>t.ratio>=T));
      if(g&&parseFloat(g.hit5)>=75.0){
        pr(`  ${lbl} ≥${(T*100).toFixed(0)}% breadth`.padEnd(55)+'  '+`OOS n=${g.n}  Hit5=${g.hit5}%  PF=${g.pf}  AvgP&L=${g.avgPnl>0?'+':''}${g.avgPnl}%`);
        found=true;
      }
    }
  }
  if(!found) pr(`  None`);

  pr(`\n${SEP}`);
  const outPath=path.join(__dirname,'results',`idea_backtest5_${ts.replace(/[:.]/g,'-').slice(0,19)}.txt`);
  fs.mkdirSync(path.dirname(outPath),{recursive:true});
  fs.writeFileSync(outPath,lines.join('\n'));
  pr(`Saved → ${outPath}`);
})();
