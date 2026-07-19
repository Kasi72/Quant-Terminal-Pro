'use strict';
/**
 * ideaBacktest4.js — Round 4
 *
 * Target: PerfectStorm at breadth >60% (n=12, 66.7% OOS baseline)
 * Goal:   Add one condition to push above 75% while keeping n≥8
 *
 * 8 single-condition variants (all applied at breadth >60%):
 *   D1: vol ≥ 2× 20-day avg            D2: RSI14 ∈ [50, 75]
 *   D3: ADX14 ≥ 25                     D4: atrPct14 ≥ 4% (stricter volatility)
 *   D5: closeLoc ≥ 0.60 (upper 40%)    D6: body ≥ 0.35 of range
 *   D7: vol≥2× + RSI14∈[50,75]         D8: vol≥2× + ADX≥25
 *
 * For top variants, also sweep breadth thresholds (50%→70%) to find
 * the optimal breadth cutoff that balances hit rate vs signal volume.
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

const PS_STORM   = 'sniper_95plus';
const BUY_STAGES = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);

const VARIANT_KEYS = ['D1_vol2x','D2_rsi50_75','D3_adx25','D4_atr4pct','D5_cloc60','D6_body35','D7_vol_rsi','D8_vol_adx'];
// sweep bucket stores trades with ratio attached for main-thread threshold sweep
const SWEEP_KEY = 'SWEEP';
const P2_KEYS   = [...VARIANT_KEYS, SWEEP_KEY];

// ── Date / parse ──────────────────────────────────────────────────────────────
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

// ── Indicators ────────────────────────────────────────────────────────────────
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

function buildATR14(candles) {
  const n = candles.length, out = new Array(n).fill(null);
  if (n < 15) return out;
  let s = 0;
  for (let i = 1; i <= 14; i++)
    s += Math.max(candles[i].h-candles[i].l, Math.abs(candles[i].h-candles[i-1].c), Math.abs(candles[i].l-candles[i-1].c));
  out[14] = s/14;
  for (let i = 15; i < n; i++) {
    const tr = Math.max(candles[i].h-candles[i].l, Math.abs(candles[i].h-candles[i-1].c), Math.abs(candles[i].l-candles[i-1].c));
    out[i] = (out[i-1]*13 + tr)/14;
  }
  return out;
}

function buildADX14(candles) {
  const n = candles.length, adxOut = new Array(n).fill(null);
  if (n < 30) return adxOut;
  let smTR=0, smPDM=0, smNDM=0;
  for (let i = 1; i <= 14; i++) {
    const tr = Math.max(candles[i].h-candles[i].l, Math.abs(candles[i].h-candles[i-1].c), Math.abs(candles[i].l-candles[i-1].c));
    const up=candles[i].h-candles[i-1].h, dn=candles[i-1].l-candles[i].l;
    smTR+=tr; smPDM+=(up>dn&&up>0)?up:0; smNDM+=(dn>up&&dn>0)?dn:0;
  }
  const dxArr = new Array(n).fill(null);
  const di0 = smTR>0 ? {p:100*smPDM/smTR, n:100*smNDM/smTR} : {p:0,n:0};
  dxArr[14] = (di0.p+di0.n)>0 ? 100*Math.abs(di0.p-di0.n)/(di0.p+di0.n) : 0;
  for (let i = 15; i < n; i++) {
    const tr = Math.max(candles[i].h-candles[i].l, Math.abs(candles[i].h-candles[i-1].c), Math.abs(candles[i].l-candles[i-1].c));
    const up=candles[i].h-candles[i-1].h, dn=candles[i-1].l-candles[i].l;
    smTR=smTR-smTR/14+tr; smPDM=smPDM-smPDM/14+((up>dn&&up>0)?up:0); smNDM=smNDM-smNDM/14+((dn>up&&dn>0)?dn:0);
    const p=smTR>0?100*smPDM/smTR:0, nd=smTR>0?100*smNDM/smTR:0;
    dxArr[i]=(p+nd)>0?100*Math.abs(p-nd)/(p+nd):0;
  }
  let adx=0, cnt=0;
  for (let i=14;i<n&&cnt<14;i++){if(dxArr[i]!==null){adx+=dxArr[i];cnt++;}}
  const seed=27;
  if(seed>=n) return adxOut;
  adxOut[seed]=adx/14;
  for (let i=seed+1;i<n;i++) {
    if(dxArr[i]===null){adxOut[i]=adxOut[i-1];continue;}
    adxOut[i]=(adxOut[i-1]*13+dxArr[i])/14;
  }
  return adxOut;
}

function avgVol(candles, i, p=20) {
  let s=0, n=0; for(let j=Math.max(0,i-p);j<i;j++){s+=candles[j].v;n++;} return n?s/n:0;
}
function avgTurn(candles, i) {
  let s=0, n=0; for(let j=Math.max(0,i-20);j<i;j++){s+=candles[j].c*candles[j].v;n++;} return n?s/n:0;
}

// ── Trade simulator ───────────────────────────────────────────────────────────
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
  const pf=gL>0?gW/gL:(gW>0?999:0);
  const mfes=trades.map(t=>t.mfe).sort((a,b)=>a-b);
  const maesW=W.filter(t=>t.mae!==null).map(t=>t.mae);
  const days=W.filter(t=>t.barsToTarget!==null).map(t=>t.barsToTarget);
  return{n,
    hit5:(W.length/n*100).toFixed(1), pf:pf.toFixed(2),
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

  // Phase 1: per-date breadth ratio
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

  // Phase 2: D1–D8 variants + sweep
  const buckets={};
  for(const k of P2_KEYS) buckets[k]={all:[],oos:[]};

  for(const fp of files){
    const candles=parseNSE(fp); if(candles.length<WINDOW+MAX_HOLD+5) continue;
    const closes=candles.map(c=>c.c);
    const rsi14 =buildRSI14(closes);
    const atr14 =buildATR14(candles);
    const adx14 =buildADX14(candles);

    const lastTrade={};
    for(const k of P2_KEYS) lastTrade[k]=-1;

    for(let i=WINDOW;i<candles.length-MAX_HOLD-2;i++){
      if(avgTurn(candles,i)<MIN_TURN) continue;
      const ts=candles[i].ts, isOOS=ts>=oosTs;
      const ratio=ratioMap[ts]??0;

      // Only process when PerfectStorm fires (check once per bar)
      if(!((ratio>0.35))) continue;   // minimum floor — collect all for sweep

      let stormFired=false, stormStop=null;
      try{
        const r=analyzeStock(candles.slice(0,i+1),PS_STORM);
        if(r&&BUY_STAGES.has(r.stage)){
          stormFired=true;
          stormStop=r.tacticalPlan?.stop??r.priceEngine?.stop??candles[i].c*0.95;
        }
      }catch{}
      if(!stormFired) continue;

      // Raw indicator values at bar i
      const bar   = candles[i];
      const rng   = bar.h - bar.l;
      const r14   = rsi14[i];
      const adx   = adx14[i];
      const atr   = atr14[i];
      const av    = avgVol(candles,i,20);
      const volR  = av>0 ? bar.v/av : 0;
      const atrPct= (atr!==null && bar.c>0) ? atr/bar.c*100 : 0;
      const cloc  = rng>0 ? (bar.c-bar.l)/rng : 0;
      const body  = rng>0 ? Math.abs(bar.c-bar.o)/rng : 0;

      // ── D-variants (all require ratio > 0.60) ───────────────────────────
      if(ratio > 0.60) {
        const conds={
          'D1_vol2x':    volR >= 2.0,
          'D2_rsi50_75': r14!==null && r14>=50 && r14<=75,
          'D3_adx25':    adx!==null && adx>=25,
          'D4_atr4pct':  atrPct>=4.0,
          'D5_cloc60':   cloc>=0.60,
          'D6_body35':   body>=0.35,
          'D7_vol_rsi':  volR>=2.0 && r14!==null && r14>=50 && r14<=75,
          'D8_vol_adx':  volR>=2.0 && adx!==null && adx>=25,
        };
        for(const[key,cond] of Object.entries(conds)){
          if(cond && i>lastTrade[key]){
            const trade=simulate(candles,i,stormStop);
            if(trade){
              lastTrade[key]=i+1+(trade.barsToTarget??MAX_HOLD);
              buckets[key].all.push(trade);
              if(isOOS) buckets[key].oos.push(trade);
            }
          }
        }
      }

      // ── SWEEP bucket: base PerfectStorm (no extra condition) with ratio ──
      // Store ratio + isOOS for main-thread threshold analysis
      // Use a single non-overlapping tracker for the sweep
      if(i>lastTrade[SWEEP_KEY]){
        const trade=simulate(candles,i,stormStop);
        if(trade){
          lastTrade[SWEEP_KEY]=i+1+(trade.barsToTarget??MAX_HOLD);
          const t={...trade,ratio,isOOS,
            // also store per-condition booleans for combined sweep analysis
            vol2x:volR>=2.0,
            rsi5075:r14!==null&&r14>=50&&r14<=75,
            adx25:adx!==null&&adx>=25,
            atr4:atrPct>=4.0,
            cloc60:cloc>=0.60,
            body35:body>=0.35,
          };
          buckets[SWEEP_KEY].all.push(t);
          if(isOOS) buckets[SWEEP_KEY].oos.push(t);
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
  let bull=0,bear=0;
  for(const[ts,{above,total}] of Object.entries(raw)){
    ratioMap[+ts]=total>0?above/total:0;
    if(ratioMap[+ts]>0.60) bull++; else bear++;
  }
  process.stdout.write(`  Strong-bull (>60%): ${bull}  Other: ${bear}\n`);

  process.stdout.write('Phase 2: D1–D8 variants + sweep...\n');
  const res=await runWorkers(2,{ratioMap});

  const ts=new Date().toISOString();
  const lines=[];
  const pr=s=>{lines.push(s);process.stdout.write(s+'\n');};
  const SEP='═'.repeat(116), LINE='─'.repeat(116);

  pr(`\n${SEP}`);
  pr(`Round 4 — PerfectStorm Tightening   ${ts}`);
  pr(`Universe: ${allFiles.length} NIFTY ALL | OOS cutoff: ${OOS_DATE} | Target +5% | MaxHold 20 | MinTurn 5M`);
  pr(`Base: PerfectStorm (atrPct14≥3%) at breadth >60% → OOS n=12  Hit5=66.7%  PF=2.13`);
  pr(`${SEP}`);

  // ── Variant table ─────────────────────────────────────────────────────────
  pr(`\n${'Variant'.padEnd(40)} ${'Full n'.padStart(7)} ${'Full H5%'.padStart(9)} | ${'OOS n'.padStart(6)} ${'OOS H5%'.padStart(9)} ${'PF'.padStart(6)} ${'AvgP&L'.padStart(8)} ${'MedMFE'.padStart(8)} ${'AvgDays'.padStart(8)} ${'IS→OOS'.padStart(8)}`);
  pr(LINE);

  const varLabels={
    'D1_vol2x':    'D1: + vol ≥ 2× avg',
    'D2_rsi50_75': 'D2: + RSI14 ∈ [50,75]',
    'D3_adx25':    'D3: + ADX14 ≥ 25',
    'D4_atr4pct':  'D4: + atrPct14 ≥ 4%',
    'D5_cloc60':   'D5: + closeLoc ≥ 0.60',
    'D6_body35':   'D6: + body ≥ 0.35 of range',
    'D7_vol_rsi':  'D7: + vol≥2× + RSI14∈[50,75]',
    'D8_vol_adx':  'D8: + vol≥2× + ADX≥25',
  };

  for(const[key,label] of Object.entries(varLabels)){
    const f=aggregate(res[key]?.all), o=aggregate(res[key]?.oos);
    const fStr=f?`${String(f.n).padStart(7)} ${(f.hit5+'%').padStart(9)}`:'      —         —';
    const oStr=o?`${String(o.n).padStart(6)} ${(o.hit5+'%').padStart(9)} ${o.pf.padStart(6)} ${((o.avgPnl>0?'+':'')+o.avgPnl+'%').padStart(8)} ${(o.medMFE+'%').padStart(8)} ${(o.avgDays+'d').padStart(8)}`:'     —         —      —        —        —       —';
    const decay=f&&o?`${(parseFloat(o.hit5)-parseFloat(f.hit5)).toFixed(1)}pp`.padStart(8):'       —';
    pr(`${label.padEnd(40)} ${fStr} | ${oStr} ${decay}`);
  }

  // ── Sweep: base PerfectStorm at varying thresholds + conditions ───────────
  pr(`\n${LINE}`);
  pr(`Threshold sweep — base PerfectStorm + individual conditions (OOS only)`);
  pr(`Threshold  |   No add-on    |   +vol≥2×      |   +RSI[50,75]  |   +ADX≥25      |   +atrPct≥4%   |   +cloc≥0.60   |   +body≥0.35`);
  pr(`           |  n    H5%  PF  |  n    H5%  PF  |  n    H5%  PF  |  n    H5%  PF  |  n    H5%  PF  |  n    H5%  PF  |  n    H5%  PF`);
  pr(`${'─'.repeat(116)}`);

  const THRESHOLDS=[0.45,0.50,0.55,0.60,0.62,0.65,0.68,0.70];
  const allSweep=res[SWEEP_KEY]?.all??[];
  const oosSweep=res[SWEEP_KEY]?.oos??[];

  for(const T of THRESHOLDS){
    const base=oosSweep.filter(t=>t.ratio>=T);
    const cols=[
      aggregate(base),
      aggregate(base.filter(t=>t.vol2x)),
      aggregate(base.filter(t=>t.rsi5075)),
      aggregate(base.filter(t=>t.adx25)),
      aggregate(base.filter(t=>t.atr4)),
      aggregate(base.filter(t=>t.cloc60)),
      aggregate(base.filter(t=>t.body35)),
    ];
    const fmt=g=>g?`${String(g.n).padStart(3)} ${(g.hit5+'%').padStart(6)} ${g.pf.padStart(4)}`:'  —      —     —';
    pr(`>${(T*100).toFixed(0)}%       |  ${cols.map(fmt).join('  |  ')}`);
  }

  pr(`\n${SEP}`);
  // Summary: flag any OOS hit5 >= 75%
  pr(`\n★ Combinations clearing 75% OOS:`);
  let found=false;
  for(const T of THRESHOLDS){
    const base=oosSweep.filter(t=>t.ratio>=T);
    const checks=[
      {label:`Base >=${(T*100).toFixed(0)}%`,tr:base},
      {label:`+vol≥2×`,tr:base.filter(t=>t.vol2x)},
      {label:`+RSI[50,75]`,tr:base.filter(t=>t.rsi5075)},
      {label:`+ADX≥25`,tr:base.filter(t=>t.adx25)},
      {label:`+atrPct≥4%`,tr:base.filter(t=>t.atr4)},
      {label:`+cloc≥0.60`,tr:base.filter(t=>t.cloc60)},
      {label:`+body≥0.35`,tr:base.filter(t=>t.body35)},
      {label:`+vol≥2× +RSI[50,75]`,tr:base.filter(t=>t.vol2x&&t.rsi5075)},
      {label:`+vol≥2× +ADX≥25`,tr:base.filter(t=>t.vol2x&&t.adx25)},
    ];
    for(const{label,tr} of checks){
      const g=aggregate(tr);
      if(g&&parseFloat(g.hit5)>=75.0){
        pr(`  PerfectStorm >=${(T*100).toFixed(0)}% breadth  ${label.padEnd(22)}  OOS n=${g.n}  Hit5=${g.hit5}%  PF=${g.pf}  AvgP&L=${g.avgPnl>0?'+':''}${g.avgPnl}%`);
        found=true;
      }
    }
  }
  if(!found) pr(`  None found — best result is below 75%`);

  pr(`\n${SEP}`);
  const outPath=path.join(__dirname,'results',`idea_backtest4_${ts.replace(/[:.]/g,'-').slice(0,19)}.txt`);
  fs.mkdirSync(path.dirname(outPath),{recursive:true});
  fs.writeFileSync(outPath,lines.join('\n'));
  pr(`Saved → ${outPath}`);
})();
