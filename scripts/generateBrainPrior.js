// ═══════════════════════════════════════════════════════════════════════════════
// GENERATE BRAIN PRIOR — extracts 719-trade backtest stats for Brain v2
// Outputs: lib/brainPrior.json — embedded as static prior in adaptiveBrain
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const ENGINE_DIR = path.join(__dirname, '_compiled');
const { analyzeStock, PARAM_SETS } = require(path.join(ENGINE_DIR, 'stockEngine.js'));
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
console.log(`Universe: ${universe.size} stocks`);

const PARAM_KEYS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];

const PARAM_LABELS = {
  'optimized_deployable_20plus':    'Deploy20+',
  'optimized_highprecision_15plus': 'HiPrec15+',
  'optimized_elite_10plus':         'Elite10+',
  'optimized_ultraselective_8plus': 'UltraSel8+',
  'sniper_95plus':                  'Sniper95+',
};

// Accumulators
const byStageParamSet = {};   // [stage][paramKey] → {pnls[], wins}
const byStage         = {};   // [stage]            → {pnls[], wins}
const byParamSet      = {};   // [paramKey]         → {pnls[], wins}
const bySymbol        = {};   // [sym]              → {pnls[], wins}
const byStageOnly     = {};   // [stage]            → {pnls[], wins} — for single-signal setups

function acc(map, key){ if(!map[key]) map[key]={pnls:[],wins:0}; return map[key]; }

let done=0;
for(const [sym,candles] of universe){
  let i=100, inTrade=false, tradeEndIdx=-1;
  while(i<candles.length-1){
    if(inTrade&&i<tradeEndIdx){i++;continue;}
    inTrade=false;
    for(const paramKey of PARAM_KEYS){
      const slice=candles.slice(0,i+1);
      let r;
      try{r=analyzeStock(slice,paramKey);}catch(e){continue;}
      if(!['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage)) continue;
      const pe=r.priceEngine;
      if(!pe||!(pe.plannedEntry>0)||!(pe.tacticalStop>0)||!(pe.tacticalStop<pe.plannedEntry)) continue;
      const fwdEnd=Math.min(i+FWD,candles.length-1);
      if(hasSplitInWindow(candles,i,fwdEnd)) continue;
      const trade={symbol:sym,entryPrice:pe.plannedEntry,stopLoss:pe.tacticalStop,target1:pe.target5,target2:pe.target7,target3:pe.target10,status:'open'};
      const sinceEntry=candles.slice(i,fwdEnd+1).map(c=>({ts:c.ts,o:c.o,h:c.h,l:c.l,c:c.c,v:c.v}));
      let vr,ft;
      try{vr=validateTrade(trade,sinceEntry);ft=applyValidation(trade,vr);}catch(e){continue;}
      let pnl=ft.pnlPct??0;
      let finalStatus=ft.status;
      if(finalStatus==='expired'){
        const tsIdx=Math.min(i+TIME_STOP,candles.length-1);
        pnl=(candles[tsIdx].c-pe.plannedEntry)/pe.plannedEntry*100;
        finalStatus='time_stop';
      }
      const stage=r.stage;
      const isWin=pnl>0;

      // Accumulate
      const spKey=`${stage}::${paramKey}`;
      acc(byStageParamSet,spKey).pnls.push(pnl); if(isWin) acc(byStageParamSet,spKey).wins++;
      acc(byStage,stage).pnls.push(pnl); if(isWin) acc(byStage,stage).wins++;
      acc(byParamSet,paramKey).pnls.push(pnl); if(isWin) acc(byParamSet,paramKey).wins++;
      acc(bySymbol,sym).pnls.push(pnl); if(isWin) acc(bySymbol,sym).wins++;

      inTrade=true;
      tradeEndIdx=i+Math.max(1,ft.daysHeld??TIME_STOP);
      break;
    }
    i++;
  }
  done++;
  if(done%100===0) process.stdout.write(`  ${done}/${universe.size}...\r`);
}
process.stdout.write('\n');

function summarize(map){
  const out={};
  for(const [key,{pnls,wins}] of Object.entries(map)){
    if(!pnls.length) continue;
    const n=pnls.length;
    const wr=Math.round(wins/n*100);
    const avgPnl=Math.round(pnls.reduce((s,v)=>s+v,0)/n*100)/100;
    const sorted=[...pnls].sort((a,b)=>a-b);
    const medPnl=Math.round(sorted[Math.floor(n/2)]*100)/100;
    const pct75=Math.round(sorted[Math.floor(n*0.75)]*100)/100;
    const pct25=Math.round(sorted[Math.floor(n*0.25)]*100)/100;
    // Size multiplier: based on expected P&L vs global average
    out[key]={n,wr,avgPnl,medPnl,pct25,pct75};
  }
  return out;
}

const globalAvgPnl = Object.values(byParamSet).flatMap(x=>x.pnls).reduce((s,v)=>s+v,0) /
  Object.values(byParamSet).flatMap(x=>x.pnls).length;

// Build structured output
const prior = {
  generatedAt: new Date().toISOString(),
  globalAvgPnl: Math.round(globalAvgPnl*100)/100,
  total: Object.values(byParamSet).flatMap(x=>x.pnls).length,
  byStageParamSet: summarize(byStageParamSet),
  byStage:         summarize(byStage),
  byParamSet:      summarize(byParamSet),
  // Top symbols by frequency (those with 3+ trades)
  bySymbol: Object.fromEntries(
    Object.entries(bySymbol)
      .filter(([,{pnls}])=>pnls.length>=3)
      .sort((a,b)=>b[1].pnls.length-a[1].pnls.length)
      .slice(0,120)
      .map(([sym,v])=>[sym,{n:v.pnls.length,wr:Math.round(v.wins/v.pnls.length*100),avgPnl:Math.round(v.pnls.reduce((s,x)=>s+x,0)/v.pnls.length*100)/100}])
  ),
  paramLabels: PARAM_LABELS,
};

// Print summary
const DSep='═'.repeat(70);
console.log(`\n${DSep}`);
console.log('  BRAIN PRIOR SUMMARY');
console.log(`${DSep}\n`);
console.log(`  Total trades: ${prior.total}  Global avg P&L: ${prior.globalAvgPnl}%\n`);

console.log('  By Stage:');
for(const [stage,s] of Object.entries(prior.byStage)){
  console.log(`    ${stage.padEnd(22)} n=${String(s.n).padStart(3)}  WR=${s.wr}%  avgPnL=${s.avgPnl >= 0 ? '+' : ''}${s.avgPnl}%  med=${s.medPnl >= 0 ? '+' : ''}${s.medPnl}%`);
}

console.log('\n  By Param Set:');
for(const [key,s] of Object.entries(prior.byParamSet)){
  console.log(`    ${(PARAM_LABELS[key]||key).padEnd(12)} n=${String(s.n).padStart(3)}  WR=${s.wr}%  avgPnL=${s.avgPnl >= 0 ? '+' : ''}${s.avgPnl}%  med=${s.medPnl >= 0 ? '+' : ''}${s.medPnl}%`);
}

console.log('\n  By Stage × Param Set (elite combos):');
const elites = Object.entries(prior.byStageParamSet)
  .filter(([,s])=>s.n>=5)
  .sort((a,b)=>b[1].avgPnl-a[1].avgPnl)
  .slice(0,10);
for(const [key,s] of elites){
  const [stage,paramKey]=key.split('::');
  const label=`${stage.padEnd(20)} × ${(PARAM_LABELS[paramKey]||paramKey).padEnd(12)}`;
  console.log(`    ${label}  n=${String(s.n).padStart(3)}  WR=${s.wr}%  avgPnL=${s.avgPnl >= 0 ? '+' : ''}${s.avgPnl}%  med=${s.medPnl >= 0 ? '+' : ''}${s.medPnl}%`);
}

console.log(`\n  Symbols with 3+ trades: ${Object.keys(prior.bySymbol).length}`);

const outPath=path.join(__dirname,'..','lib','brainPrior.json');
fs.writeFileSync(outPath,JSON.stringify(prior,null,2));
console.log(`\n  Written → ${outPath}\n`);
