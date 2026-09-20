'use strict';
// all7_backtest.js
// Complete OOS backtest for ALL 7 param sets (as used in Multi-Scan mode)
// Metrics: N, WR%, PF, avg%, MFE (mean + p50 + %≥5/8/10), MAE (mean + p50 + p75 + p90)
//
// Param sets:
//   1. VF Scout         (optimized_deployable_20plus)      TP=8%  SL=4×ATR
//   2. CC Precision     (optimized_highprecision_15plus)   TP=5%  SL=4×ATR
//   3. MP Elite         (optimized_elite_10plus)           TP=5%  SL=3×ATR  [SCREENER ONLY per docs]
//   4. EMA Stack        (optimized_ultraselective_8plus)   TP=3%  SL=4×ATR  [SCREENER ONLY per docs]
//   5. Sniper PS        (sniper_95plus)                    TP=5%  SL=4×ATR
//   6. ORS Reversal     (ors_prime_reversal)               TP=3%  SL=2×ATR  (internal ors.tpPct/slAtrMult)
//   7. Circuit Breaker  (circuit_breaker_v2)               TP=6%  SL=4×ATR
//
// OOS: 2023-01-01 onward | MaxHold: 20 bars (ORS: 12)
// Output: scripts/results/all7_backtest.txt

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR   = process.env.DATA_DIR   || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const WORKERS    = Number(process.env.WORKERS || Math.min(os.cpus().length, 12));
const OOS_START  = Date.parse('2023-01-01') / 1000;
const WINDOW     = 300;
const MIN_BARS   = 150;
const W          = 128;

// ─── param set config ────────────────────────────────────────────────────────
// TP/SL optimised 2026-09-20 via tp_sl_grid.js (162-combo grid search, OOS 2023-2026, 1416 stocks)
const ALL7 = [
  { key: 'optimized_deployable_20plus',    label: 'VF Scout',       tp: 5, sl: 5.0, maxHold: 20,
    stages: new Set(['PRE_BREAKOUT']) },                                        // was tp:8 sl:4 → PF 1.94→2.68 WR 66→83%
  { key: 'optimized_highprecision_15plus', label: 'CC Precision',   tp: 3, sl: 2.5, maxHold: 20,
    stages: new Set(['PRE_BREAKOUT']) },                                        // uc≥50 gate in engine: PF 0.99→1.56 (N=167)
  { key: 'optimized_elite_10plus',         label: 'MP Elite',       tp: 3, sl: 5.0, maxHold: 15,
    stages: new Set(['PRE_BREAKOUT']) },                                        // was tp:5 sl:3 h:20 → PF 0.94→1.29 WR 64→75%
  { key: 'optimized_ultraselective_8plus', label: 'EMA Stack',      tp: 3, sl: 5.0, maxHold: 20,
    stages: new Set(['PRE_BREAKOUT']) },                                        // was sl:4 → PF 1.49→1.84 WR unchanged
  { key: 'sniper_95plus',                  label: 'Sniper PS',      tp: 4, sl: 5.0, maxHold: 15,
    stages: new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY','PRE_BREAKOUT']) }, // was tp:5 h:20 → PF 1.35→1.85 WR 74→79%
  { key: 'ors_prime_reversal',             label: 'ORS Reversal',   tp: 3, sl: 5.0, maxHold: 10,
    stages: new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY','PRE_BREAKOUT','EARLY_INFLECTION']) }, // was sl:2 h:12 → PF 2.66→3.33 WR unchanged
  { key: 'circuit_breaker_v2',             label: 'Cir.Breaker',    tp: 6, sl: 5.0, maxHold: 20,
    stages: new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY','PRE_BREAKOUT']),
    screenerOnly: true }, // ⚠ SCREENER ONLY — PF=1.00 max (162-combo grid); not in live trade pipeline
];

// ─── helpers ─────────────────────────────────────────────────────────────────
const sep = (c='═') => c.repeat(W);
const pct = (n,d) => d>0?(n/d*100).toFixed(1)+'%':'—';
const f1  = v => Number.isFinite(v)?v.toFixed(1):'—';
const f2  = v => Number.isFinite(v)?v.toFixed(2):'—';
const pctile = (arr,p) => {
  if(!arr.length)return null;
  const s=[...arr].sort((a,b)=>a-b);
  const i=(p/100)*(s.length-1);
  return s[Math.floor(i)]+(s[Math.ceil(i)]-s[Math.floor(i)])*(i%1);
};

// ─── CSV parse ────────────────────────────────────────────────────────────────
function parseCSV(fp){
  const raw=fs.readFileSync(fp,'utf8').replace(/^\uFEFF/,'').trim();
  if(!raw)return[];
  const lines=raw.split(/\r?\n/),out=[];
  for(let i=1;i<lines.length;i++){
    const p=lines[i].split(',').map(x=>x.trim());
    if(p.length<5)continue;
    const ts=Date.parse(p[0]),o=+p[1],h=+p[2],l=+p[3],c=+p[4],v=+(p[5]||0);
    if(!Number.isFinite(ts)||o<=0||h<l)continue;
    out.push({ts:Math.floor(ts/1000),o,h,l,c,v:Math.max(0,v)});
  }
  out.sort((a,b)=>a.ts-b.ts);
  const d=[];
  for(const x of out){if(d.length&&d[d.length-1].ts===x.ts)d[d.length-1]=x;else d.push(x);}
  return d;
}

// ─── ATR ──────────────────────────────────────────────────────────────────────
function atr14Array(c){
  const out=new Array(c.length).fill(0);
  if(c.length<2)return out;
  const tr=[0];
  for(let i=1;i<c.length;i++)
    tr.push(Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c)));
  if(c.length<=14){for(let i=1;i<c.length;i++)out[i]=tr[i];return out;}
  let s=0;for(let i=1;i<=14;i++)s+=tr[i];out[14]=s/14;
  for(let i=15;i<c.length;i++)out[i]=(out[i-1]*13+tr[i])/14;
  return out;
}

// ─── Simulation — returns pnl, hitTP, MFE, MAE ───────────────────────────────
function simResult(c, sigIdx, atr, tpPct, slAtr, maxHold){
  const ei=sigIdx+1;
  if(ei>=c.length||c[ei].o<=0||atr<=0)return null;
  const entry=c[ei].o;
  const stop=entry-slAtr*atr;
  const tp=entry*(1+tpPct/100);
  const maxEnd=Math.min(c.length-1,ei+maxHold-1);
  let exitPx=c[maxEnd].c, hitTP=false, mfe=0, mae=0;
  for(let j=ei;j<=maxEnd;j++){
    const b=c[j];
    // MFE: max upside reached from entry
    const up=(b.h-entry)/entry*100; if(up>mfe)mfe=up;
    // MAE: max drawdown from entry (how deep it went against you)
    const down=(entry-b.l)/entry*100; if(down>mae)mae=down;
    if(b.o<=stop){exitPx=b.o;break;}
    if(b.l<=stop){exitPx=stop;break;}
    if(b.h>=tp){exitPx=tp;hitTP=true;break;}
  }
  return{
    pnl:(exitPx-entry)/entry*100,
    hitTP,mfe,mae,
    mfe5:mfe>=5,mfe8:mfe>=8,mfe10:mfe>=10,
    mae2:mae<=2,mae5:mae<=5,   // tight adverse excursion %
  };
}

// ─── Worker ───────────────────────────────────────────────────────────────────
if(!isMainThread){
  const engine=require(path.join(workerData.engineDir,'stockEngine.js'));
  const signals=[];
  for(const file of workerData.files){
    let c;
    try{c=parseCSV(file.fp);}catch{continue;}
    if(c.length<MIN_BARS)continue;
    const atr14=atr14Array(c);
    for(const ps of ALL7){
      let lastExit=-1;
      for(let i=WINDOW-1;i<c.length-1;i++){
        if(i<=lastExit)continue;
        if(c[i].ts<OOS_START)continue;
        const w=c.slice(i-WINDOW+1,i+1);
        let r;
        try{r=engine.analyzeStock(w,ps.key);}catch{continue;}
        if(!r||!ps.stages.has(r.stage))continue;
        const atrSig=atr14[i]||c[i].c*0.02;
        const out=simResult(c,i,atrSig,ps.tp,ps.sl,ps.maxHold);
        if(!out)continue;
        signals.push({
          key:   ps.key,
          label: ps.label,
          stage: r.stage,
          uc:    Math.round(r.ucScore??0),
          conv:  Math.round(r.inflectionScore??0),
          ...out,
        });
        lastExit=i+ps.maxHold;
      }
    }
  }
  parentPort.postMessage({type:'done',signals});
  process.exit(0);
}

// ─── Stat helpers ─────────────────────────────────────────────────────────────
function stats(sigs){
  if(!sigs.length)return null;
  const wins=sigs.filter(s=>s.hitTP);
  const loss=sigs.filter(s=>!s.hitTP);
  const n=sigs.length;
  const wr=wins.length/n*100;
  const grossW=wins.reduce((s,x)=>s+x.pnl,0);
  const grossL=loss.reduce((s,x)=>s+Math.abs(x.pnl),0);
  const pf=grossL>0?grossW/grossL:Infinity;
  const avgPnl=sigs.reduce((s,x)=>s+x.pnl,0)/n;
  const mfes=sigs.map(s=>s.mfe);
  const maes=sigs.map(s=>s.mae);
  return{
    n,wr,pf,avgPnl,
    mfeMean: mfes.reduce((a,b)=>a+b,0)/n,
    mfeP50:  pctile(mfes,50),
    mfe5pct: sigs.filter(s=>s.mfe5).length/n*100,
    mfe8pct: sigs.filter(s=>s.mfe8).length/n*100,
    mfe10pct:sigs.filter(s=>s.mfe10).length/n*100,
    maeMean: maes.reduce((a,b)=>a+b,0)/n,
    maeP50:  pctile(maes,50),
    maeP75:  pctile(maes,75),
    maeP90:  pctile(maes,90),
  };
}

function printRow(label, s, labelW=16, note=''){
  if(!s){console.log(`  ${label.padEnd(labelW)}  (no signals)`);return;}
  const pfStr=Number.isFinite(s.pf)?s.pf.toFixed(2):'∞';
  console.log(
    `  ${(label+(note?'  '+note:'')).padEnd(labelW)}` +
    `${String(s.n).padStart(7)}` +
    `${(s.wr.toFixed(1)+'%').padStart(8)}` +
    `${pfStr.padStart(7)}` +
    `${(s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2)+'%'.padStart(1)}`.padStart(9) +
    `${f1(s.mfeMean)+'%'.padStart(1)}`.padStart(10) +
    `${f1(s.mfeP50)+'%'.padStart(1)}`.padStart(9) +
    `${(s.mfe5pct.toFixed(1)+'%')}`.padStart(8) +
    `${(s.mfe8pct.toFixed(1)+'%')}`.padStart(8) +
    `${(s.mfe10pct.toFixed(1)+'%')}`.padStart(9) +
    `${f1(s.maeMean)+'%'.padStart(1)}`.padStart(10) +
    `${f1(s.maeP50)+'%'.padStart(1)}`.padStart(9) +
    `${f1(s.maeP75)+'%'.padStart(1)}`.padStart(9) +
    `${f1(s.maeP90)+'%'.padStart(1)}`.padStart(9)
  );
}

function printHeader(labelW=16){
  const h =
    `  ${'Param Set'.padEnd(labelW)}` +
    `${'N'.padStart(7)}` +
    `${'WR%'.padStart(8)}` +
    `${'PF'.padStart(7)}` +
    `${'avg%'.padStart(9)}` +
    `${'MFE avg'.padStart(10)}` +
    `${'MFE p50'.padStart(9)}` +
    `${'MFE≥5%'.padStart(8)}` +
    `${'MFE≥8%'.padStart(8)}` +
    `${'MFE≥10%'.padStart(9)}` +
    `${'MAE avg'.padStart(10)}` +
    `${'MAE p50'.padStart(9)}` +
    `${'MAE p75'.padStart(9)}` +
    `${'MAE p90'.padStart(9)}`;
  console.log(h);
  console.log('  '+'─'.repeat(h.length-2));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main(){
  const RESULTS_DIR=path.join(__dirname,'results');
  if(!fs.existsSync(RESULTS_DIR))fs.mkdirSync(RESULTS_DIR);
  const lines=[];
  const origLog=console.log;
  console.log=(...a)=>{origLog(...a);lines.push(a.join(' '));};

  console.log(sep()); console.log('  ALL 7 PARAM SETS — COMPREHENSIVE OOS BACKTEST');
  console.log(`  Universe: 1416 stocks  OOS: 2023-2026  Workers: ${WORKERS}`);
  console.log(`  Date: ${new Date().toISOString()}`); console.log(sep()+'\n');

  if(!fs.existsSync(DATA_DIR)){console.log(`  DATA_DIR not found: ${DATA_DIR}`);return;}

  const files=fs.readdirSync(DATA_DIR)
    .filter(f=>f.endsWith('.csv')||f.endsWith('.CSV'))
    .map(name=>({name,fp:path.join(DATA_DIR,name)}));
  console.log(`  CSV files: ${files.length}\n  Scanning with ${WORKERS} workers...\n`);

  const chunkSize=Math.ceil(files.length/WORKERS);
  const chunks=Array.from({length:WORKERS},(_,i)=>files.slice(i*chunkSize,(i+1)*chunkSize)).filter(c=>c.length);

  const allSignals=await new Promise((resolve,reject)=>{
    let done=0;const out=[];
    for(const chunk of chunks){
      const w=new Worker(__filename,{workerData:{files:chunk,engineDir:ENGINE_DIR}});
      w.on('message',msg=>{if(msg.type==='done'){out.push(...msg.signals);if(++done===chunks.length)resolve(out);}});
      w.on('error',reject);
    }
  });

  const totalN=allSignals.length;
  console.log(`  Total signals: ${totalN}\n`);
  const byCounts=ALL7.map(ps=>({label:ps.label,n:allSignals.filter(s=>s.key===ps.key).length}));
  for(const b of byCounts) console.log(`  ${b.label.padEnd(16)}: ${b.n}`);

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 1 — Per param set full metrics
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n'+sep());
  console.log('  SECTION 1 — PER PARAM SET FULL METRICS (OOS 2023-2026)');
  console.log(sep()+'\n');
  printHeader();
  for(const ps of ALL7){
    const sigs=allSignals.filter(s=>s.key===ps.key);
    printRow(ps.label,stats(sigs),16,ps.screenerOnly?'[SCREENER ONLY]':'');
  }
  console.log('  '+'─'.repeat(130));
  printRow('COMBINED ALL 7',stats(allSignals));

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 2 — Stage breakdown per param set
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n'+sep());
  console.log('  SECTION 2 — STAGE BREAKDOWN PER PARAM SET');
  console.log(sep());
  const STAGES=['ULTRA_STRONG_BUY','STRONG_BUY','BUY','PRE_BREAKOUT','EARLY_INFLECTION','COMPRESSION_WATCH'];
  const STAGE_SHORT={ULTRA_STRONG_BUY:'USB',STRONG_BUY:'SB',BUY:'BUY',PRE_BREAKOUT:'PB',
    EARLY_INFLECTION:'EI',COMPRESSION_WATCH:'CW'};
  for(const ps of ALL7){
    const psSigs=allSignals.filter(s=>s.key===ps.key);
    if(!psSigs.length)continue;
    console.log(`\n  ── ${ps.label} (N=${psSigs.length}, TP=${ps.tp}%, SL=${ps.sl}×ATR, maxHold=${ps.maxHold})`);
    const hdr=`  ${'Stage'.padEnd(12)}${'N'.padStart(6)}${'WR%'.padStart(8)}${'PF'.padStart(7)}${'avg%'.padStart(9)}${'MFE avg'.padStart(10)}${'MFE≥5%'.padStart(9)}${'MFE≥8%'.padStart(9)}${'MAE avg'.padStart(10)}${'MAE p50'.padStart(9)}${'MAE p90'.padStart(9)}`;
    console.log(hdr); console.log('  '+'─'.repeat(hdr.length-2));
    for(const st of STAGES){
      const g=psSigs.filter(s=>s.stage===st);
      if(!g.length)continue;
      const s=stats(g);
      const pfStr=Number.isFinite(s.pf)?s.pf.toFixed(2):'∞';
      console.log(
        `  ${(STAGE_SHORT[st]||st).padEnd(12)}${String(s.n).padStart(6)}${(s.wr.toFixed(1)+'%').padStart(8)}` +
        `${pfStr.padStart(7)}${((s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2)+'%').padStart(9)}` +
        `${(f1(s.mfeMean)+'%').padStart(10)}${(s.mfe5pct.toFixed(1)+'%').padStart(9)}${(s.mfe8pct.toFixed(1)+'%').padStart(9)}` +
        `${(f1(s.maeMean)+'%').padStart(10)}${(f1(s.maeP50)+'%').padStart(9)}${(f1(s.maeP90)+'%').padStart(9)}`
      );
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 3 — MFE vs MAE comparison (R:R insight)
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n'+sep());
  console.log('  SECTION 3 — MFE vs MAE R:R RATIO (how much price moves FOR vs AGAINST)');
  console.log('  Ratio = MFE_mean / MAE_mean  |  >1.0 = favourable; <1.0 = skewed against you');
  console.log(sep()+'\n');
  console.log(`  ${'Param Set'.padEnd(16)}${'MFE avg'.padStart(10)}${'MAE avg'.padStart(10)}${'MFE/MAE'.padStart(10)}${'MFE p50'.padStart(10)}${'MAE p50'.padStart(10)}${'p50 ratio'.padStart(12)}`);
  console.log('  '+'─'.repeat(80));
  for(const ps of ALL7){
    const sigs=allSignals.filter(s=>s.key===ps.key);
    if(!sigs.length){console.log(`  ${ps.label.padEnd(16)}  (no signals)`);continue;}
    const s=stats(sigs);
    const ratio=s.maeMean>0?s.mfeMean/s.maeMean:Infinity;
    const ratioP50=s.maeP50>0?s.mfeP50/s.maeP50:Infinity;
    const flag=ratio>=1.5?'  ★ strong':'';
    console.log(
      `  ${ps.label.padEnd(16)}${(f1(s.mfeMean)+'%').padStart(10)}${(f1(s.maeMean)+'%').padStart(10)}` +
      `${ratio.toFixed(2).padStart(10)}${(f1(s.mfeP50)+'%').padStart(10)}${(f1(s.maeP50)+'%').padStart(10)}` +
      `${ratioP50.toFixed(2).padStart(12)}${flag}`
    );
  }
  // Combined
  {
    const s=stats(allSignals);
    if(s){
      const ratio=s.maeMean>0?s.mfeMean/s.maeMean:Infinity;
      const ratioP50=s.maeP50>0?s.mfeP50/s.maeP50:Infinity;
      console.log('  '+'─'.repeat(80));
      console.log(
        `  ${'ALL 7 COMBINED'.padEnd(16)}${(f1(s.mfeMean)+'%').padStart(10)}${(f1(s.maeMean)+'%').padStart(10)}` +
        `${ratio.toFixed(2).padStart(10)}${(f1(s.mfeP50)+'%').padStart(10)}${(f1(s.maeP50)+'%').padStart(10)}` +
        `${ratioP50.toFixed(2).padStart(12)}`
      );
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 4 — TP hit distribution (how often does price reach each % level)
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n'+sep());
  console.log('  SECTION 4 — MFE DISTRIBUTION (% of trades that reached each level intraday)');
  console.log('  Use this to evaluate if you should exit earlier or let winners run');
  console.log(sep()+'\n');
  const MFE_LEVELS=[2,3,4,5,6,7,8,10,12,15];
  console.log(`  ${'Param Set'.padEnd(16)}`+MFE_LEVELS.map(l=>`  ≥${l}%`.padStart(7)).join(''));
  console.log('  '+'─'.repeat(16+MFE_LEVELS.length*9));
  for(const ps of ALL7){
    const sigs=allSignals.filter(s=>s.key===ps.key);
    if(!sigs.length)continue;
    const cells=MFE_LEVELS.map(l=>`${(sigs.filter(s=>s.mfe>=l).length/sigs.length*100).toFixed(0)}%`.padStart(7));
    console.log(`  ${ps.label.padEnd(16)}  `+cells.join('  '));
  }
  {
    const cells=MFE_LEVELS.map(l=>`${(allSignals.filter(s=>s.mfe>=l).length/allSignals.length*100).toFixed(0)}%`.padStart(7));
    console.log('  '+'─'.repeat(16+MFE_LEVELS.length*9));
    console.log(`  ${'ALL 7'.padEnd(16)}  `+cells.join('  '));
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 5 — MAE distribution (stop placement guidance)
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n'+sep());
  console.log('  SECTION 5 — MAE DISTRIBUTION (% of trades that dipped below each loss level)');
  console.log('  Use this to find optimal stop placement — stop must be wide enough to survive');
  console.log(sep()+'\n');
  const MAE_LEVELS=[1,2,3,4,5,6,7,8,10,12,15];
  console.log(`  ${'Param Set'.padEnd(16)}`+MAE_LEVELS.map(l=>`  >${l}%`.padStart(7)).join(''));
  console.log('  '+'─'.repeat(16+MAE_LEVELS.length*9));
  for(const ps of ALL7){
    const sigs=allSignals.filter(s=>s.key===ps.key);
    if(!sigs.length)continue;
    const cells=MAE_LEVELS.map(l=>`${(sigs.filter(s=>s.mae>l).length/sigs.length*100).toFixed(0)}%`.padStart(7));
    console.log(`  ${ps.label.padEnd(16)}  `+cells.join('  '));
  }
  {
    const cells=MAE_LEVELS.map(l=>`${(allSignals.filter(s=>s.mae>l).length/allSignals.length*100).toFixed(0)}%`.padStart(7));
    console.log('  '+'─'.repeat(16+MAE_LEVELS.length*9));
    console.log(`  ${'ALL 7'.padEnd(16)}  `+cells.join('  '));
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 6 — ucScore filter effect on each param set
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n'+sep());
  console.log('  SECTION 6 — UC SCORE FILTER EFFECT (what happens if you only take uc≥35 or uc≥50)');
  console.log(sep()+'\n');
  const UC_THRS=[0,35,50,65];
  for(const ps of ALL7){
    const psSigs=allSignals.filter(s=>s.key===ps.key);
    if(!psSigs.length)continue;
    console.log(`\n  ── ${ps.label}`);
    console.log(`  ${'Filter'.padEnd(14)}${'N'.padStart(6)}${'WR%'.padStart(8)}${'PF'.padStart(7)}${'avg%'.padStart(9)}${'MFE avg'.padStart(10)}${'MAE avg'.padStart(10)}`);
    console.log('  '+'─'.repeat(68));
    for(const thr of UC_THRS){
      const g=thr===0?psSigs:psSigs.filter(s=>s.uc>=thr);
      if(!g.length)continue;
      const s=stats(g);
      const pfStr=Number.isFinite(s.pf)?s.pf.toFixed(2):'∞';
      const label=thr===0?'All signals':`uc ≥ ${thr}`;
      console.log(
        `  ${label.padEnd(14)}${String(s.n).padStart(6)}${(s.wr.toFixed(1)+'%').padStart(8)}` +
        `${pfStr.padStart(7)}${((s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2)+'%').padStart(9)}` +
        `${(f1(s.mfeMean)+'%').padStart(10)}${(f1(s.maeMean)+'%').padStart(10)}`
      );
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SECTION 7 — Ranked summary
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n'+sep());
  console.log('  SECTION 7 — RANKED SUMMARY (by PF desc)');
  console.log(sep()+'\n');
  const ranked=ALL7
    .map(ps=>({...ps,...(stats(allSignals.filter(s=>s.key===ps.key))||{})}))
    .filter(r=>r.n>0)
    .sort((a,b)=>(Number.isFinite(b.pf)?b.pf:999)-(Number.isFinite(a.pf)?a.pf:999));
  printHeader();
  for(const r of ranked) printRow(r.label,r,16,r.screenerOnly?'[SCREENER ONLY]':'');
  console.log('  '+'─'.repeat(130));
  const tradeOnly=allSignals.filter(s=>!ALL7.find(p=>p.key===s.key)?.screenerOnly);
  printRow('TRADEABLE COMBINED',stats(tradeOnly));
  printRow('ALL 7 COMBINED',stats(allSignals));

  console.log('\n  NOTE: [SCREENER ONLY] = universe reducer. Not in live trade pipeline. PF benchmark meaningless for trade sizing.');
  console.log('\n'+sep()+'\n  DONE\n');
  console.log=origLog;
  const outPath=path.join(RESULTS_DIR,'all7_backtest.txt');
  fs.writeFileSync(outPath,lines.join('\n'));
  origLog(`  Saved: ${outPath}`);
}

main().catch(err=>{console.error(err);process.exit(1);});
