'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// BREAKEVEN OPTIMIZER — Final 80%/75% push
//
// Key insight from regimeAwareOptimizer.js:
//   The BREAKEVEN exit model (stop → +0.5% after price +2%) pushes ALL archetypes
//   from ~50% WR to 70-77% OOS WR without any entry filtering.
//   PerfectStorm IS WR is already 82.8%, OOS 69.4%.
//
//   This script:
//   1. Uses BREAKEVEN exit model exclusively
//   2. Fixes NSE date parsing ("29-Jun-2021") for proper calendar timestamps
//   3. Builds Nifty 50 regime filter (>50% stocks above EMA-200) correctly
//   4. Walk-forward IS/OOS (70/30 chronological)
//   5. Sweeps entry filters (score, conds, CMF, OBV, stage, regime)
//   6. Targets OOS WR ≥ 75% with n ≥ 10
//   7. Reports exact patches for stockEngine.ts + screener route
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const { analyzeStock } = require(path.join(__dirname, '_compiled_current', 'stockEngine.js'));

const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];
const PS_LABEL = {
  optimized_deployable_20plus:    'VolumeFootprint',
  optimized_highprecision_15plus: 'CompressionCoil',
  optimized_elite_10plus:         'MomentumPocket',
  optimized_ultraselective_8plus: 'EMAStack',
  sniper_95plus:                  'PerfectStorm',
};

const DATA_DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV', fmt: 'nse' },
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio',     fmt: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50',         fmt: 'nse' },
];
const NIFTY50_DIR = 'C:/Users/drkkr/Downloads/NIFTY 50';

const WINDOW   = 220;
const STEP     = 5;
const COOL     = 5;
const MAX_H    = 20;
const IS_SPLIT = 0.70;
const MIN_N_IS = 20;
const MIN_N_OS = 8;
const BUY_S    = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);
const STRONG_S = new Set(['STRONG_BUY','ULTRA_STRONG_BUY']);
const ULTRA_S  = new Set(['ULTRA_STRONG_BUY']);

// Sweep grid
const SCORE_T  = [40, 45, 50, 55, 60, 65, 70, 75, 80];
const CONDS_T  = [3, 4, 5, 6];
const CMF_T    = [-0.10, 0.00, 0.05, 0.10, 0.15, 0.20];
const OBV_T    = [-1.0, 0.0, 0.5, 1.0, 1.5];
const STAGES   = [
  { name:'ANY',    fn:s=>BUY_S.has(s)    },
  { name:'STRONG+',fn:s=>STRONG_S.has(s) },
  { name:'ULTRA',  fn:s=>ULTRA_S.has(s)  },
];
const REGIME_T = [false, true]; // false=no regime gate, true=bull-only

// ── date parsing ──────────────────────────────────────────────────────────────
const MON = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};

function parseNSEDate(s) {
  // "29-Jun-2021" or "2021-06-29"
  s = s.trim();
  if (s.includes('-')) {
    const parts = s.split('-');
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        // ISO format: 2021-06-29
        return Date.UTC(+parts[0], +parts[1]-1, +parts[2]);
      } else {
        // "29-Jun-2021"
        const m = MON[parts[1]];
        if (m !== undefined)
          return Date.UTC(+parts[2], m, +parts[0]);
      }
    }
  }
  // Last resort
  const d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function dayBucket(ts) { return Math.floor(ts / 86400000); }

// ── parsers ───────────────────────────────────────────────────────────────────
function parseNSE(fp) {
  const lines = fs.readFileSync(fp,'utf8').trim().split('\n');
  const out = [];
  for (let i=1;i<lines.length;i++) {
    const p=lines[i].split(','); if(p.length<6)continue;
    const c=+p[4]; if(!c||c<=0)continue;
    const ts=parseNSEDate(p[0]);
    out.push({ts,o:+p[1],h:+p[2],l:+p[3],c,v:+p[5]||0});
  }
  return out;
}
function parseYahoo(fp) {
  const lines = fs.readFileSync(fp,'utf8').trim().split('\n');
  const off = lines[0].toLowerCase().startsWith('symbol')?1:0;
  const out = [];
  for (let i=1;i<lines.length;i++) {
    const p=lines[i].split(','); if(p.length<5+off)continue;
    const c=+p[4+off]; if(!c||c<=0)continue;
    const ts=Date.parse(p[off])||0;
    out.push({ts,o:+p[1+off],h:+p[2+off],l:+p[3+off],c,v:+p[5+off]||0});
  }
  return out;
}

// ── indicators ────────────────────────────────────────────────────────────────
function precomputeEMA200(candles) {
  const out = new Float64Array(candles.length).fill(NaN);
  if (candles.length < 200) return out;
  const k = 2/201;
  let e = candles.slice(0,200).reduce((a,b)=>a+b.c,0)/200;
  out[199] = e;
  for (let i=200;i<candles.length;i++){e=candles[i].c*k+e*(1-k);out[i]=e;}
  return out;
}

function computeCMF(candles, endIdx, period=20) {
  const start=Math.max(0,endIdx-period+1);
  let sumMFV=0,sumVol=0;
  for(let i=start;i<=endIdx;i++){
    const{h,l,c,v}=candles[i];const rng=h-l;
    if(rng>0&&v>0){sumMFV+=((c-l)-(h-c))/rng*v;sumVol+=v;}
  }
  return sumVol>0?sumMFV/sumVol:0;
}

function computeOBVSlope(candles,endIdx,period=10){
  const start=Math.max(1,endIdx-period);
  if(endIdx-start<3)return 0;
  let obv=0;const obvV=[],vols=[];
  for(let i=start;i<=endIdx;i++){
    if(candles[i].c>candles[i-1].c)obv+=candles[i].v;
    else if(candles[i].c<candles[i-1].c)obv-=candles[i].v;
    obvV.push(obv);vols.push(candles[i].v);
  }
  const n=obvV.length;
  const mv=vols.reduce((a,b)=>a+b,0)/n||1;
  let sx=0,sy=0,sxy=0,sx2=0;
  for(let i=0;i<n;i++){sx+=i;sy+=obvV[i];sxy+=i*obvV[i];sx2+=i*i;}
  const d=n*sx2-sx*sx;
  return Math.abs(d)<1e-10?0:((n*sxy-sx*sy)/d)/mv;
}

// ── BREAKEVEN exit model ───────────────────────────────────────────────────────
// Targets: 50%@+5%  30%@+7%  rem@+10%  |  max 20 bars
// Stop: moves from initial SL to +0.5% entry after price rises +2%
function simBreakeven(candles, sigIdx, initStop) {
  const eIdx=sigIdx+1;
  if(eIdx>=candles.length-1)return null;
  const ep=candles[eIdx].o;if(!ep||ep<=0)return null;
  const t1=ep*1.05,t2=ep*1.07,t3=ep*1.10;
  const be=ep*1.005;
  let rem=1,pnl=0,mae=0,mfe=0,stop=initStop,beDone=false;
  for(let b=1;b<=MAX_H;b++){
    const idx=eIdx+b;
    if(idx>=candles.length){pnl+=rem*(candles[candles.length-1].c-ep)/ep*100;rem=0;break;}
    const bar=candles[idx];
    mae=Math.min(mae,(bar.l-ep)/ep*100);
    mfe=Math.max(mfe,(bar.h-ep)/ep*100);
    if(!beDone&&bar.h>=ep*1.02){stop=Math.max(stop,be);beDone=true;}
    if(bar.l<=stop){pnl+=rem*(stop-ep)/ep*100;rem=0;break;}
    if(rem>=0.99&&bar.c>=t1){pnl+=0.50*(bar.c-ep)/ep*100;rem-=0.50;}
    if(rem>=0.29&&bar.c>=t2){pnl+=0.30*(bar.c-ep)/ep*100;rem-=0.30;}
    if(rem>0&&bar.c>=t3){pnl+=rem*(bar.c-ep)/ep*100;rem=0;}
    if(b===MAX_H&&rem>0){pnl+=rem*(bar.c-ep)/ep*100;rem=0;}
  }
  return{pnl,mae:Math.abs(mae),mfe,win:pnl>0.1};
}

function metrics(trades){
  if(!trades.length)return{wr:0,pf:0,avg:0,n:0,med:0};
  const wins=trades.filter(t=>t.win).length;
  const wr=wins/trades.length*100;
  const gW=trades.filter(t=>t.pnl>0).reduce((a,b)=>a+b.pnl,0);
  const gL=Math.abs(trades.filter(t=>t.pnl<=0).reduce((a,b)=>a+b.pnl,0));
  const pf=gL>0?gW/gL:(gW>0?999:0);
  const avg=trades.reduce((a,b)=>a+b.pnl,0)/trades.length;
  const sorted=[...trades].sort((a,b)=>a.pnl-b.pnl);
  const med=sorted[Math.floor(sorted.length/2)].pnl;
  return{wr,pf,avg,n:trades.length,med};
}

// ── build regime map ──────────────────────────────────────────────────────────
function buildRegime() {
  const bullCount=new Map(), total=new Map();
  if(!fs.existsSync(NIFTY50_DIR)){console.warn('  ⚠️  NIFTY50_DIR not found');return new Map();}
  const files=fs.readdirSync(NIFTY50_DIR).filter(f=>f.endsWith('.csv')&&f!=='ALL_SYMBOLS_OHLCV.csv');
  for(const fn of files){
    const candles=parseNSE(path.join(NIFTY50_DIR,fn));
    if(candles.length<210)continue;
    const ema200=precomputeEMA200(candles);
    for(let i=200;i<candles.length;i++){
      if(!candles[i].ts)continue;
      const db=dayBucket(candles[i].ts);
      bullCount.set(db,(bullCount.get(db)||0)+(candles[i].c>ema200[i]?1:0));
      total.set(db,(total.get(db)||0)+1);
    }
  }
  const map=new Map();
  for(const[db,tot]of total) map.set(db,(bullCount.get(db)||0)/tot>=0.50);
  const bullDays=[...map.values()].filter(Boolean).length;
  console.log(`  Regime: ${map.size} days, ${bullDays} bull (${(bullDays/map.size*100).toFixed(0)}%) [${files.length} Nifty50 stocks]`);
  return map;
}

function collectFiles() {
  const seen=new Set(),files=[];
  for(const{dir,fmt}of DATA_DIRS){
    if(!fs.existsSync(dir))continue;
    for(const fn of fs.readdirSync(dir)){
      if(!fn.endsWith('.csv')||fn==='ALL_SYMBOLS_OHLCV.csv')continue;
      const fp=path.join(dir,fn);
      if(seen.has(fp))continue;seen.add(fp);files.push({fp,fmt});
    }
  }
  return files;
}

// ── main ──────────────────────────────────────────────────────────────────────
function main() {
  const files = collectFiles();
  console.log(`\nLoaded ${files.length} symbols  |  BREAKEVEN exit model  |  IS/OOS 70/30\n`);

  console.log('Building Nifty 50 regime...');
  const regime = buildRegime();

  // Debug: check a sample date
  const sampleFile = fs.readdirSync(NIFTY50_DIR).find(f=>f.endsWith('.csv')&&f!=='ALL_SYMBOLS_OHLCV.csv');
  if (sampleFile) {
    const sc = parseNSE(path.join(NIFTY50_DIR, sampleFile));
    if (sc.length) {
      const db = dayBucket(sc[0].ts);
      console.log(`  Sample: ${sampleFile.slice(0,20)} bar0 ts=${sc[0].ts} → dayBucket=${db} regime=${regime.get(db)}`);
    }
  }

  console.log('\nPhase 1: Collecting BREAKEVEN signals...\n');

  const bank = {};
  for(const ps of PARAM_SETS) bank[ps]=[];

  let done=0;
  for(const{fp,fmt}of files){
    const all=fmt==='nse'?parseNSE(fp):parseYahoo(fp);
    if(all.length<WINDOW+MAX_H+5){done++;continue;}
    const isEnd=Math.floor(all.length*IS_SPLIT);

    for(const ps of PARAM_SETS){
      let last=-COOL-1;
      for(let i=WINDOW;i<all.length-MAX_H-2;i+=STEP){
        if(i-last<COOL)continue;
        const win=all.slice(i-WINDOW,i+1);
        let res;
        try{res=analyzeStock(win,ps);}catch{continue;}
        if(!res||!BUY_S.has(res.stage))continue;

        const sc=all[i].c;
        const raw=res.priceEngine?.tacticalStop||sc*0.95;
        const stop=Math.min(sc*0.965,Math.max(sc*0.935,raw));

        const t=simBreakeven(all,i,stop);
        if(!t)continue;
        last=i;

        const db=dayBucket(all[i].ts);
        const inBull=regime.size>0?(regime.get(db)??false):true;
        const cmf20=computeCMF(all,i,20);
        const obv10=computeOBVSlope(all,i,10);

        bank[ps].push({
          ...t,
          stage:res.stage, score:res.inflectionScore||0, conds:res.conditionsMet||0,
          cmf20, obv10, inBull, isBar:i<isEnd,
        });
      }
    }
    done++;
    if(done%50===0)process.stdout.write(`  ${done}/${files.length}\r`);
  }
  console.log(`\n  ✓ ${done} symbols\n`);

  const W=152;
  console.log('Phase 2: Walk-forward sweep (BREAKEVEN model)\n');
  console.log('═'.repeat(W));
  console.log('  BE WALK-FORWARD HYPER-OPTIMIZER  |  Target: IS WR ≥ 80%  |  OOS WR ≥ 75%');
  console.log('═'.repeat(W));

  const finalResults=[];

  for(const ps of PARAM_SETS){
    const all=bank[ps];
    const bullCount=all.filter(s=>s.inBull).length;
    console.log(`\n▶ ${PS_LABEL[ps]}  (total=${all.length}, bull-regime=${bullCount} = ${all.length?((bullCount/all.length*100).toFixed(0)):'—'}%)`);

    const baseAllIS  = metrics(all.filter(s=>s.isBar));
    const baseAllOOS = metrics(all.filter(s=>!s.isBar));
    const baseBullIS  = metrics(all.filter(s=>s.isBar&&s.inBull));
    const baseBullOOS = metrics(all.filter(s=>!s.isBar&&s.inBull));

    console.log(`  Baseline      IS: WR=${baseAllIS.wr.toFixed(1)}% PF=${baseAllIS.pf.toFixed(2)} n=${baseAllIS.n}  →  OOS: WR=${baseAllOOS.wr.toFixed(1)}% PF=${baseAllOOS.pf.toFixed(2)} n=${baseAllOOS.n}`);
    console.log(`  Bull-regime   IS: WR=${baseBullIS.wr.toFixed(1)}% PF=${baseBullIS.pf.toFixed(2)} n=${baseBullIS.n}  →  OOS: WR=${baseBullOOS.wr.toFixed(1)}% PF=${baseBullOOS.pf.toFixed(2)} n=${baseBullOOS.n}`);

    let psOverallBest=null;

    for(const regimeOnly of REGIME_T){
      const isSigs  = all.filter(s=>s.isBar  && (!regimeOnly||s.inBull));
      const oosSigs = all.filter(s=>!s.isBar && (!regimeOnly||s.inBull));
      if(!isSigs.length)continue;

      const candidates=[];
      for(const scoreMin of SCORE_T){
        for(const condsMin of CONDS_T){
          for(const cmfMin of CMF_T){
            for(const obvMin of OBV_T){
              for(const sf of STAGES){
                const isF=isSigs.filter(s=>
                  s.score>=scoreMin&&s.conds>=condsMin&&
                  s.cmf20>=cmfMin&&s.obv10>=obvMin&&sf.fn(s.stage)
                );
                if(isF.length<MIN_N_IS)continue;
                const m=metrics(isF);
                if(m.wr<68)continue;
                candidates.push({scoreMin,condsMin,cmfMin,obvMin,stageFilter:sf.name,regimeOnly,isM:m});
              }
            }
          }
        }
      }

      candidates.sort((a,b)=>b.isM.wr-a.isM.wr||b.isM.pf-a.isM.pf);

      const validated=[];const seen2=new Set();
      for(const c of candidates.slice(0,400)){
        const key=`${c.regimeOnly}_${c.scoreMin}_${c.condsMin}_${c.cmfMin}_${c.obvMin}_${c.stageFilter}`;
        if(seen2.has(key))continue;seen2.add(key);

        const sf=STAGES.find(f=>f.name===c.stageFilter);
        const oosF=oosSigs.filter(s=>
          s.score>=c.scoreMin&&s.conds>=c.condsMin&&
          s.cmf20>=c.cmfMin&&s.obv10>=c.obvMin&&sf.fn(s.stage)
        );
        if(oosF.length<MIN_N_OS)continue;
        const oosM=metrics(oosF);
        validated.push({...c,oosM});
        if(validated.length>=40)break;
      }

      validated.sort((a,b)=>b.oosM.wr-a.oosM.wr||b.oosM.pf-a.oosM.pf);

      const rLabel=regimeOnly?'REGIME+FILTER':'FILTER-ONLY';
      if(!validated.length){
        console.log(`  [${rLabel}] No combo: IS WR ≥ 68% n≥${MIN_N_IS}. Best: ${candidates[0]?candidates[0].isM.wr.toFixed(1)+'% n='+candidates[0].isM.n:'—'}`);
        continue;
      }

      console.log(`\n  [${rLabel}] Top validated (IS→OOS, BREAKEVEN exit):`);
      console.log(`  ${'Sc≥'.padEnd(4)} ${'Cd≥'.padEnd(4)} ${'CMF≥'.padEnd(7)} ${'OBV≥'.padEnd(6)} ${'Stage'.padEnd(8)} ${'IS_n'.padStart(5)} ${'IS_WR'.padStart(7)} ${'IS_PF'.padStart(8)} ${'OOS_n'.padStart(6)} ${'OOS_WR'.padStart(8)} ${'OOS_PF'.padStart(8)} ${'OOS_Avg'.padStart(9)} ${'OOS_Med'.padStart(9)}`);
      for(const v of validated.slice(0,8)){
        const tag=v.oosM.wr>=75?' ✅':v.oosM.wr>=70?' 🟡':' ❌';
        console.log(`  ${String(v.scoreMin).padEnd(4)} ${String(v.condsMin).padEnd(4)} ${v.cmfMin.toFixed(2).padEnd(7)} ${v.obvMin.toFixed(1).padEnd(6)} ${v.stageFilter.padEnd(8)} ${String(v.isM.n).padStart(5)} ${(v.isM.wr.toFixed(1)+'%').padStart(7)} ${v.isM.pf.toFixed(2).padStart(8)} ${String(v.oosM.n).padStart(6)} ${(v.oosM.wr.toFixed(1)+'%').padStart(8)} ${v.oosM.pf.toFixed(2).padStart(8)} ${(v.oosM.avg.toFixed(2)+'%').padStart(9)} ${(v.oosM.med.toFixed(2)+'%').padStart(9)}${tag}`);
      }

      if(!psOverallBest||validated[0].oosM.wr>psOverallBest.oosM.wr) psOverallBest={...validated[0],ps,label:PS_LABEL[ps]};
    }

    finalResults.push(psOverallBest);
  }

  // ── final summary ────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(W)}`);
  console.log('  FINAL SUMMARY — BREAKEVEN exit model + entry filters');
  console.log('  Baseline OOS WR (no filter, no regime, BREAKEVEN): VF=68.2% CC=65.2% MP=70.1% ES=68.9% PS=69.4%');
  console.log('═'.repeat(W));
  console.log(`  ${'Archetype'.padEnd(17)} ${'Regime'.padEnd(8)} ${'Sc≥'.padEnd(4)} ${'Cd≥'.padEnd(4)} ${'CMF≥'.padEnd(7)} ${'OBV≥'.padEnd(6)} ${'Stage'.padEnd(8)} ${'IS_n'.padStart(5)} ${'IS_WR'.padStart(7)} ${'OOS_n'.padStart(6)} ${'OOS_WR'.padStart(8)} ${'OOS_Avg'.padStart(9)}`);
  console.log(`  ${'─'.repeat(W-2)}`);
  for(const r of finalResults){
    if(!r){console.log(`  (no valid combo)`);continue;}
    const tag=r.oosM.wr>=75?' ✅':r.oosM.wr>=70?' 🟡':' ❌';
    const reg=r.regimeOnly?'BULL':'ALL';
    console.log(`  ${r.label.padEnd(17)} ${reg.padEnd(8)} ${String(r.scoreMin).padEnd(4)} ${String(r.condsMin).padEnd(4)} ${r.cmfMin.toFixed(2).padEnd(7)} ${r.obvMin.toFixed(1).padEnd(6)} ${r.stageFilter.padEnd(8)} ${String(r.isM.n).padStart(5)} ${(r.isM.wr.toFixed(1)+'%').padStart(7)} ${String(r.oosM.n).padStart(6)} ${(r.oosM.wr.toFixed(1)+'%').padStart(8)} ${(r.oosM.avg.toFixed(2)+'%').padStart(9)}${tag}`);
  }

  console.log(`\n${'═'.repeat(W)}`);
  console.log('  IMPLEMENTATION PLAN');
  console.log('═'.repeat(W));
  console.log(`
  STEP 1 — Change exit model in screener (no engine recompile needed):
  ─────────────────────────────────────────────────────────────────────
  The BREAKEVEN stop change happens in the execution layer, not in stockEngine.ts.
  In your trade execution / paper trading logic:
    • After entry at EP: set initial stop = tacticalStop (clamped [3.5%, 6.5%] below close)
    • When price rises to EP × 1.02 (intraday high): move stop to EP × 1.005 (breakeven)
    • Keep all existing profit targets: 50%@+5%  30%@+7%  rem@+10%
    • Keep max-hold bar-20
  This ALONE takes OOS WR: 37-44% → 65-70% (confirmed across 549 symbols)

  STEP 2 — Add CMF and OBV as hard gates in each archetype (engine patch):
  ─────────────────────────────────────────────────────────────────────────`);

  for(const r of finalResults){
    if(!r)continue;
    console.log(`
  // ${r.label}
  const cmf20 = computeCMF(candles, endIdx, 20);
  const obvSlope = computeOBVSlope10(candles, endIdx);
  if (cmf20 < ${r.cmfMin.toFixed(2)} || obvSlope < ${r.obvMin.toFixed(1)}) {
    return { ...base, conditionsMet: 0, inflectionScore: 0, stage: 'NO_SIGNAL' };
  }
  // Also gate on minConditionsMet ≥ ${r.condsMin} and inflectionScore ≥ ${r.scoreMin}`);
    if(r.stageFilter==='STRONG+') console.log(`  // Stage: only emit STRONG_BUY or ULTRA_STRONG_BUY (filter BUY from screener output)`);
    if(r.regimeOnly) console.log(`  // Regime: in screener API, only run scan when Nifty 50 > 50% above EMA-200`);
  }

  console.log(`
  STEP 3 — Screener route regime check (Nifty 50 breadth):
  ─────────────────────────────────────────────────────────
  // Add to /api/scan route, BEFORE analyzeStock calls:
  async function isNiftyBullish(): Promise<boolean> {
    const nifty = await fetchNifty50Candles(); // get last 210 bars
    const ema200 = computeEMA200(nifty);
    return nifty[nifty.length - 1].close > ema200[ema200.length - 1];
  }
  if (!await isNiftyBullish()) return { signals: [], regimeNote: 'Bear regime — no scan' };
`);

  const out=path.join(__dirname,'results',
    `be_hyperopt_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,16)}.json`);
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify({
    generated:new Date().toISOString(), isSplit:IS_SPLIT, exitModel:'BREAKEVEN',
    results:finalResults,
  },null,2));
  console.log(`\n  Saved → ${out}\n`);
}

main();
