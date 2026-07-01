// ═══════════════════════════════════════════════════════════════════════════════
// BACKTEST DEEP DIVE — Phase 1 diagnostic
// Breaks down P&L by stage, exit type, param set, MOM badge, and resolves
// "expired" trades by computing actual price return at window end.
// Goal: identify which signal tier already delivers >5% avg P&L.
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs'), path = require('path');
const ENGINE_DIR = path.join(__dirname, '_compiled');
if (!fs.existsSync(path.join(ENGINE_DIR, 'stockEngine.js'))) {
  console.error('Compiled engine not found. Run tsc first.'); process.exit(1);
}
const { analyzeStock } = require(path.join(ENGINE_DIR, 'stockEngine.js'));
const { validateTrade, applyValidation } = require(path.join(ENGINE_DIR, 'autoValidator.js'));

const NIFTY500_DIR = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const PORTFOLIO_DIR = 'C:/Users/drkkr/Downloads/My Portfolio';

const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];
const PARAM_LABELS = {
  optimized_deployable_20plus:    'Deployable 20+',
  optimized_highprecision_15plus: 'HighPrecision 15+',
  optimized_elite_10plus:         'Elite 10+',
  optimized_ultraselective_8plus: 'Ultra-Selective 8+',
  sniper_95plus:                  'Sniper 95+',
};

function tsOf(d) { const t = new Date(d).getTime(); return Number.isFinite(t) ? Math.floor(t/1000) : 0; }
function parseYahoo(fp) {
  return fs.readFileSync(fp,'utf8').trim().split('\n').slice(1).reduce((c,l)=>{
    const p=l.split(','); if(p.length<6||isNaN(+p[4])||+p[4]<=0) return c;
    const ts=tsOf(p[0]); if(ts<=0) return c;
    c.push({ts,date:p[0],o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]||0}); return c;
  },[]);
}
function hasSplitInWindow(c, from, to) {
  for(let j=from;j<Math.min(to,c.length-1);j++){
    if(c[j].c<=0) continue;
    const r=c[j+1].c/c[j].c; if(r>2.5||r<0.4) return true;
  }
  return false;
}

// ── Load Nifty50 index for market regime filter ──
const NIFTY_INDEX_PATH = 'C:/Users/drkkr/Downloads/Dr KKR certificates/NIFTY INDEX/nifty50_daily_ohlcv.csv';
const niftyCandles = parseYahoo(NIFTY_INDEX_PATH);
// Build EMA20 map: ts → {close, ema20, regimeBull}
const niftyEMA20 = new Map();
{
  const k = 2/(20+1);
  let ema = 0;
  for(let i=0; i<niftyCandles.length; i++){
    const c = niftyCandles[i];
    ema = i===0 ? c.c : c.c*k + ema*(1-k);
    niftyEMA20.set(c.ts, { close:c.c, ema20:ema, regimeBull: i>=19 && c.c > ema });
  }
}
// Lookup by nearest date: build sorted ts array for binary search
const niftyTs = [...niftyEMA20.keys()].sort((a,b)=>a-b);
function getRegime(signalTs) {
  // Find the most recent Nifty candle on or before signalTs
  let lo=0, hi=niftyTs.length-1, idx=0;
  while(lo<=hi){ const mid=(lo+hi)>>1; if(niftyTs[mid]<=signalTs){idx=mid;lo=mid+1;}else hi=mid-1; }
  return niftyEMA20.get(niftyTs[idx]) ?? { regimeBull: true };
}

// Load universe
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

// ── TIME_STOP sweep values ──
const TIME_STOP_VALUES = [3, 5, 7, 10];
const FWD = 60;

// ── Collect raw trades (one record per signal, with full candle context for post-processing) ──
const rawTrades = [];
let done=0, errs=0;

for(const [sym, candles] of universe){
  for(const key of PARAM_SETS){
    let i=100, inTrade=false, tradeEndIdx=-1;
    while(i < candles.length-1){
      if(inTrade && i<tradeEndIdx){ i++; continue; }
      inTrade=false;

      const slice=candles.slice(0,i+1);
      let r;
      try{ r=analyzeStock(slice,key); } catch(e){ errs++; i++; continue; }

      if(!['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage)){ i++; continue; }
      const pe=r.priceEngine;
      if(!pe||!(pe.plannedEntry>0)||!(pe.tacticalStop>0)||!(pe.tacticalStop<pe.plannedEntry)){ i++; continue; }

      const fwdEnd=Math.min(i+FWD, candles.length-1);
      if(hasSplitInWindow(candles,i,fwdEnd)){ i++; continue; }

      const trade={
        symbol:sym, entryPrice:pe.plannedEntry, stopLoss:pe.tacticalStop,
        target1:pe.target5, target2:pe.target7, target3:pe.target10, status:'open',
      };
      const sinceEntry=candles.slice(i,fwdEnd+1).map(c=>({ts:c.ts,o:c.o,h:c.h,l:c.l,c:c.c,v:c.v}));
      let vr;
      try{ vr=validateTrade(trade,sinceEntry); } catch(e){ errs++; i++; continue; }
      const ft=applyValidation(trade,vr);

      // MOM badge + volume ratio + market regime
      const hasMom = !!(r.monster?.badges?.some(b=>b.type==='MOM'));
      const conviction = r.conviction ?? null;
      const lastCandle = slice[slice.length-1];
      const vol20avg = slice.length>=21 ? slice.slice(-21,-1).reduce((s,c)=>s+c.v,0)/20 : 0;
      const volRatio = vol20avg>0 ? lastCandle.v/vol20avg : 0;
      const regime = getRegime(lastCandle.ts);
      const regimeBull = regime.regimeBull;

      // Pre-compute P&L for every TIME_STOP value (only needed for expired trades)
      const tsPnl = {};
      for(const ts of TIME_STOP_VALUES){
        if(ft.status==='expired'){
          const tsIdx = Math.min(i+ts, candles.length-1);
          tsPnl[ts] = (candles[tsIdx].c - pe.plannedEntry) / pe.plannedEntry * 100;
        } else {
          tsPnl[ts] = null; // not expired — same result regardless of TIME_STOP
        }
      }

      rawTrades.push({
        sym, paramSet:key, stage:r.stage,
        ft,  // full validated trade result
        entryIdx: i,
        entry:pe.plannedEntry, stop:pe.tacticalStop,
        disasterRiskPct: pe.disasterRiskPct??0,
        tacticalRiskPct: pe.tacticalRiskPct??0,
        hasMom, conviction, volRatio, regimeBull,
        tsPnl, // per-TIME_STOP P&L for expired trades
        // Entry features for diagnostic
        inflectionScore: r.inflectionScore??0,
        zoneLen: r.compressionZoneLen??0,
        zoneTightness: r.zoneTightnessPct??0,
        pre10AvgRangeATR: r.pre10AvgRangeATR??0,
        exactRangeATR14: r.exactRangeATR14??0,
        closeLoc: r.closeLoc??0,
        upperWickPct: r.upperWickPct??0,
        bodyPct: r.bodyPct??0,
        rsi2: r.rsi2??0,
        ultraPrecisionScore: r.ultraPrecisionScore??0,
      });

      if(ft.status!=='open'){
        tradeEndIdx=i+Math.max(1,ft.daysHeld??1);
        inTrade=true; i=tradeEndIdx;
      } else {
        i++;
      }
    }
  }
  done++;
  if(done%50===0) process.stdout.write(`  ...${done}/${universe.size} stocks\n`);
}

console.log(`\nDone. ${rawTrades.length} total trade records. Errors: ${errs}\n`);

// ── Build allTrades view for a given TIME_STOP ──
function buildTrades(ts){
  return rawTrades.map(r=>{
    const ft=r.ft;
    let status=ft.status, pnlPct=ft.pnlPct??0, pnlR=ft.pnlR??0, daysHeld=ft.daysHeld??FWD;
    if(ft.status==='expired'){
      status='time_stop';
      pnlPct=r.tsPnl[ts];
      pnlR=pnlPct/(r.tacticalRiskPct||1);
      daysHeld=ts;
    }
    return {...r, status, pnlPct, pnlR, daysHeld};
  });
}

// TIME_STOP=3 is the optimal setting — sweep proved monotonic degradation beyond 3 days
const allTrades = buildTrades(3);

// ── Helper aggregators ──
function stats(arr){
  if(!arr.length) return {n:0,wr:'—',avgPnl:'—',medPnl:'—',avgR:'—',pct5:'—'};
  const wins=arr.filter(t=>t.pnlPct>0);
  const losses=arr.filter(t=>t.pnlPct<0);
  const sorted=[...arr].map(t=>t.pnlPct).sort((a,b)=>a-b);
  const med=sorted[Math.floor(sorted.length/2)];
  const pct5=arr.filter(t=>t.pnlPct>=5).length/arr.length*100;
  const grossW=wins.reduce((s,t)=>s+t.pnlPct,0);
  const grossL=Math.abs(losses.reduce((s,t)=>s+t.pnlPct,0));
  const pf=grossL>0?grossW/grossL:grossW>0?99:0;
  return {
    n:arr.length,
    wr:(wins.length/(wins.length+losses.length||1)*100).toFixed(1)+'%',
    avgPnl:(arr.reduce((s,t)=>s+t.pnlPct,0)/arr.length).toFixed(2)+'%',
    medPnl:med.toFixed(2)+'%',
    avgR:(arr.reduce((s,t)=>s+t.pnlR,0)/arr.length).toFixed(2),
    pct5:pct5.toFixed(1)+'%',
    pf:pf.toFixed(2),
  };
}
function row(label,arr){
  const s=stats(arr);
  console.log(`${label.padEnd(30)} │ ${String(s.n).padStart(5)} │ ${String(s.wr).padStart(7)} │ ${String(s.avgPnl).padStart(8)} │ ${String(s.medPnl).padStart(8)} │ ${String(s.pct5).padStart(7)} │ ${String(s.pf).padStart(5)}`);
}
function header(){
  console.log('─'.repeat(30)+' ┼ '+'─'.repeat(5)+' ┼ '+'─'.repeat(7)+' ┼ '+'─'.repeat(8)+' ┼ '+'─'.repeat(8)+' ┼ '+'─'.repeat(7)+' ┼ '+'─'.repeat(5));
}
function hdr(label){
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  ${label}`);
  console.log('═'.repeat(80));
  console.log('Slice'.padEnd(30)+' │ '+'  N  '+' │ '+'  WR%  '+' │ '+'AvgP&L% '+' │ '+'MedP&L% '+' │ '+'%≥5% '+' │ '+'  PF  ');
  header();
}

// ══════════════════════════════════════════════
// 1. BY STAGE
// ══════════════════════════════════════════════
hdr('BREAKDOWN BY STAGE (all param sets combined, 60-bar window, 10-day time stop)');
for(const s of ['BUY','STRONG_BUY','ULTRA_STRONG_BUY']){
  row(s, allTrades.filter(t=>t.stage===s));
}
row('ALL STAGES', allTrades);

// ══════════════════════════════════════════════
// 2. BY EXIT TYPE (with expired resolved to actual price)
// ══════════════════════════════════════════════
hdr('BREAKDOWN BY EXIT TYPE (time_stop = bar-10 exit replacing expired)');
for(const st of ['hit_t1','hit_t2','hit_t3','stopped','time_stop']){
  row(st, allTrades.filter(t=>t.status===st));
}

// ══════════════════════════════════════════════
// 3. BY PARAM SET
// ══════════════════════════════════════════════
hdr('BREAKDOWN BY PARAM SET');
for(const key of PARAM_SETS){
  row(PARAM_LABELS[key], allTrades.filter(t=>t.paramSet===key));
}

// ══════════════════════════════════════════════
// 4. STAGE × PARAM SET matrix (avg P&L only)
// ══════════════════════════════════════════════
console.log('\n' + '═'.repeat(80));
console.log('  STAGE × PARAM SET — Avg P&L% matrix');
console.log('═'.repeat(80));
const stages=['BUY','STRONG_BUY','ULTRA_STRONG_BUY'];
const shortLabels={
  optimized_deployable_20plus:'Deploy20+',
  optimized_highprecision_15plus:'HiPrec15+',
  optimized_elite_10plus:'Elite10+',
  optimized_ultraselective_8plus:'UltraSel8+',
  sniper_95plus:'Sniper95+',
};
process.stdout.write('Stage'.padEnd(20));
for(const k of PARAM_SETS) process.stdout.write(shortLabels[k].padStart(12));
console.log();
console.log('─'.repeat(80));
for(const s of stages){
  process.stdout.write(s.padEnd(20));
  for(const k of PARAM_SETS){
    const arr=allTrades.filter(t=>t.stage===s&&t.paramSet===k);
    const avg=arr.length>0?(arr.reduce((a,t)=>a+t.pnlPct,0)/arr.length).toFixed(1)+'%':'—';
    process.stdout.write((`${avg}(${arr.length})`).padStart(12));
  }
  console.log();
}

// ══════════════════════════════════════════════
// 5. MOM BADGE EFFECT
// ══════════════════════════════════════════════
hdr('MOM BADGE EFFECT');
row('MOM=true',  allTrades.filter(t=>t.hasMom));
row('MOM=false', allTrades.filter(t=>!t.hasMom));
// MOM × stage
console.log();
for(const s of stages){
  row(`MOM=true  + ${s}`,  allTrades.filter(t=>t.hasMom&&t.stage===s));
  row(`MOM=false + ${s}`,  allTrades.filter(t=>!t.hasMom&&t.stage===s));
}

// ══════════════════════════════════════════════
// 6. VOLUME FILTER EFFECT (volRatio thresholds)
// ══════════════════════════════════════════════
hdr('VOLUME RATIO FILTER (volRatio20 on signal bar)');
for(const thr of [1.0,1.2,1.5,2.0,2.5,3.0]){
  row(`volRatio ≥ ${thr.toFixed(1)}x`, allTrades.filter(t=>t.volRatio>=thr));
}

// ══════════════════════════════════════════════
// 7. COMBINED FILTER: STRONG_BUY+ × MOM × volRatio
// ══════════════════════════════════════════════
hdr('COMBINED FILTER LADDER (STRONG_BUY+, additive)');
const sb = t=>t.stage==='STRONG_BUY'||t.stage==='ULTRA_STRONG_BUY';
row('STRONG_BUY+',                      allTrades.filter(sb));
row('STRONG_BUY+ + MOM',               allTrades.filter(t=>sb(t)&&t.hasMom));
row('STRONG_BUY+ + vol≥1.5x',          allTrades.filter(t=>sb(t)&&t.volRatio>=1.5));
row('STRONG_BUY+ + MOM + vol≥1.5x',    allTrades.filter(t=>sb(t)&&t.hasMom&&t.volRatio>=1.5));
row('ULTRA_STRONG_BUY only',            allTrades.filter(t=>t.stage==='ULTRA_STRONG_BUY'));
row('ULTRA_STRONG_BUY + MOM',           allTrades.filter(t=>t.stage==='ULTRA_STRONG_BUY'&&t.hasMom));

// ══════════════════════════════════════════════
// 8. P&L DISTRIBUTION HISTOGRAM (all trades)
// ══════════════════════════════════════════════
console.log('\n' + '═'.repeat(80));
console.log('  P&L DISTRIBUTION (all trades, resolved expired)');
console.log('═'.repeat(80));
const buckets=[
  ['< -10%',   t=>t.pnlPct < -10],
  ['-10% to -5%', t=>t.pnlPct>=-10&&t.pnlPct<-5],
  ['-5% to 0%',   t=>t.pnlPct>=-5&&t.pnlPct<0],
  ['0% to 2%',    t=>t.pnlPct>=0&&t.pnlPct<2],
  ['2% to 5%',    t=>t.pnlPct>=2&&t.pnlPct<5],
  ['5% to 10%',   t=>t.pnlPct>=5&&t.pnlPct<10],
  ['10% to 20%',  t=>t.pnlPct>=10&&t.pnlPct<20],
  ['> 20%',       t=>t.pnlPct>=20],
];
for(const [label,fn] of buckets){
  const n=allTrades.filter(fn).length;
  const bar='█'.repeat(Math.round(n/allTrades.length*50));
  console.log(`${label.padEnd(14)} │ ${String(n).padStart(4)} │ ${bar}`);
}

// ══════════════════════════════════════════════
// 9. TOP 20 INDIVIDUAL TRADES (by P&L%)
// ══════════════════════════════════════════════
console.log('\n' + '═'.repeat(80));
console.log('  TOP 20 TRADES BY P&L%');
console.log('═'.repeat(80));
const top20=[...allTrades].sort((a,b)=>b.pnlPct-a.pnlPct).slice(0,20);
console.log('Symbol'.padEnd(14)+'Stage'.padEnd(18)+'Param'.padEnd(14)+'P&L%'.padStart(8)+'Exit'.padStart(10)+'MOM'.padStart(5)+'Vol'.padStart(6));
for(const t of top20){
  console.log(`${t.sym.padEnd(14)}${t.stage.padEnd(18)}${shortLabels[t.paramSet].padEnd(14)}${(t.pnlPct>=0?'+':'')+t.pnlPct.toFixed(2)+'%'.padStart(8)}${t.status.padStart(10)}${(t.hasMom?'✓':'').padStart(5)}${t.volRatio.toFixed(1).padStart(6)}x`);
}

// ══════════════════════════════════════════════
// 10. SUMMARY: WHAT GETS US TO >5% AVG P&L?
// ══════════════════════════════════════════════
console.log('\n' + '═'.repeat(80));
console.log('  FILTER COMBINATIONS THAT CLEAR 5% AVG P&L THRESHOLD');
console.log('═'.repeat(80));
const candidates=[
  ['All BUY+',              allTrades],
  ['STRONG_BUY+',           allTrades.filter(sb)],
  ['ULTRA_STRONG_BUY',      allTrades.filter(t=>t.stage==='ULTRA_STRONG_BUY')],
  ['MOM=true',              allTrades.filter(t=>t.hasMom)],
  ['STRONG_BUY+ + MOM',    allTrades.filter(t=>sb(t)&&t.hasMom)],
  ['vol≥1.5x',             allTrades.filter(t=>t.volRatio>=1.5)],
  ['STRONG_BUY+ + vol≥1.5x', allTrades.filter(t=>sb(t)&&t.volRatio>=1.5)],
  ['SB+ + MOM + vol≥1.5x', allTrades.filter(t=>sb(t)&&t.hasMom&&t.volRatio>=1.5)],
  ['USB + MOM',             allTrades.filter(t=>t.stage==='ULTRA_STRONG_BUY'&&t.hasMom)],
  ['USB + MOM + vol≥1.5x', allTrades.filter(t=>t.stage==='ULTRA_STRONG_BUY'&&t.hasMom&&t.volRatio>=1.5)],
];
for(const [label,arr] of candidates){
  if(!arr.length) continue;
  const avg=arr.reduce((s,t)=>s+t.pnlPct,0)/arr.length;
  const flag=avg>=5?'  ✅ TARGET MET':'';
  console.log(`${label.padEnd(32)}: n=${String(arr.length).padStart(4)}, avgP&L=${avg>=0?'+':''}${avg.toFixed(2)}%${flag}`);
}

// ── 11. TIME_STOP vs WINNER FEATURE COMPARISON ──────────────────────────────
console.log('\n');
hdr('TIME_STOP vs WINNER — Feature Comparison (find entry filters for time_stop)');
const winners   = allTrades.filter(t=>t.status==='hit_t2'||t.status==='hit_t3');
const tsLosers  = allTrades.filter(t=>t.status==='time_stop');
const features  = ['inflectionScore','zoneLen','zoneTightness','pre10AvgRangeATR',
                   'exactRangeATR14','closeLoc','upperWickPct','bodyPct','rsi2',
                   'ultraPrecisionScore','volRatio','tacticalRiskPct','disasterRiskPct'];
const fmean = (arr,f) => arr.length ? (arr.reduce((s,t)=>s+(t[f]??0),0)/arr.length) : 0;
console.log(`${'Feature'.padEnd(24)} ${'Winners(n='+winners.length+')'.padStart(16)} ${'TimeStop(n='+tsLosers.length+')'.padStart(18)} ${'Diff%'.padStart(8)}`);
console.log('─'.repeat(70));
for(const f of features){
  const wm=fmean(winners,f), tm=fmean(tsLosers,f);
  const diff=wm!==0?(tm-wm)/Math.abs(wm)*100:0;
  const flag=Math.abs(diff)>=15?' ◄':Math.abs(diff)>=8?' ~':'';
  console.log(`${f.padEnd(24)} ${wm.toFixed(2).padStart(16)} ${tm.toFixed(2).padStart(18)} ${(diff>=0?'+':'')+diff.toFixed(0).padStart(7)}%${flag}`);
}

// ── Threshold sweep: find cutoffs that filter time_stops without losing winners ──
console.log('\n─── Threshold sweep (feature cutoffs that improve avg P&L) ───');
const sweepFeatures = [
  {f:'inflectionScore', dir:'min', steps:[50,55,60,65,70]},
  {f:'closeLoc',        dir:'min', steps:[55,60,65,70,75]},
  {f:'bodyPct',         dir:'min', steps:[20,30,40,50,60]},
  {f:'upperWickPct',    dir:'max', steps:[15,20,25,30,35]},
  {f:'exactRangeATR14', dir:'min', steps:[1.5,2.0,2.5,3.0,3.5]},
  {f:'rsi2',            dir:'min', steps:[50,55,60,65,70]},
  {f:'ultraPrecisionScore',dir:'min',steps:[50,55,60,65,70]},
  {f:'zoneTightness',   dir:'max', steps:[3,4,5,6,7]},
  {f:'tacticalRiskPct', dir:'max', steps:[3,4,5,6,7]},
];
console.log(`${'Feature+Threshold'.padEnd(30)} ${'N'.padStart(5)} ${'AvgP&L'.padStart(9)} ${'WR%'.padStart(7)} ${'%≥5%'.padStart(7)} Delta`);
console.log('─'.repeat(65));
const baseAvg = allTrades.reduce((s,t)=>s+t.pnlPct,0)/allTrades.length;
for(const {f,dir,steps} of sweepFeatures){
  for(const thresh of steps){
    const sub = allTrades.filter(t=> dir==='min' ? t[f]>=thresh : t[f]<=thresh);
    if(sub.length<50) continue;
    const avg = sub.reduce((s,t)=>s+t.pnlPct,0)/sub.length;
    const wr  = sub.filter(t=>t.pnlPct>0).length/sub.length*100;
    const p5  = sub.filter(t=>t.pnlPct>=5).length/sub.length*100;
    const delta= avg-baseAvg;
    const flag = avg>=5?' ✅':delta>=0.5?' ▲':'';
    const label=`${f} ${dir==='min'?'≥':'≤'}${thresh}`;
    console.log(`${label.padEnd(30)} ${String(sub.length).padStart(5)} ${((avg>=0?'+':'')+avg.toFixed(2)+'%').padStart(9)} ${wr.toFixed(0).padStart(6)}% ${p5.toFixed(0).padStart(6)}% ${(delta>=0?'+':'')+delta.toFixed(2)}${flag}`);
  }
}

// ── 12. ALL PARAM SETS × STAGE DEEP DIVE ─────────────────────────────────────
console.log('\n');
hdr('ALL PARAM SETS × STAGE — Full breakdown with TIME_STOP sweep');
const paramLabels = {
  optimized_deployable_20plus:    'Deploy20+',
  optimized_highprecision_15plus: 'HiPrec15+',
  optimized_elite_10plus:         'Elite10+',
  optimized_ultraselective_8plus: 'UltraSel8+',
  sniper_95plus:                  'Sniper95+',
};
for(const key of PARAM_SETS){
  const pLabel = paramLabels[key];
  const sbSlice  = allTrades.filter(t=>t.stage==='STRONG_BUY'&&t.paramSet===key);
  const usbSlice = allTrades.filter(t=>t.stage==='ULTRA_STRONG_BUY'&&t.paramSet===key);
  const allSlice = allTrades.filter(t=>t.paramSet===key);
  console.log(`\n── ${pLabel} (total n=${allSlice.length}) ──`);
  console.log(`${'Stage'.padEnd(18)} ${'N'.padStart(4)} ${'WR%'.padStart(6)} ${'AvgP&L'.padStart(9)} ${'Med'.padStart(8)} ${'%≥5%'.padStart(7)} ${'PF'.padStart(6)}   TIME_STOP sweep →  TS=3    TS=5    TS=7   TS=10`);
  console.log('─'.repeat(105));
  for(const [stage, slice] of [['STRONG_BUY',sbSlice],['USB',usbSlice],['ALL',allSlice]]){
    if(!slice.length){ console.log(`  ${stage.padEnd(16)} ${'0'.padStart(4)}  (no signals)`); continue; }
    const avg = slice.reduce((s,t)=>s+t.pnlPct,0)/slice.length;
    const wr  = slice.filter(t=>t.pnlPct>0).length/slice.length*100;
    const med = [...slice].sort((a,b)=>a.pnlPct-b.pnlPct)[Math.floor(slice.length/2)].pnlPct;
    const p5  = slice.filter(t=>t.pnlPct>=5).length/slice.length*100;
    const wins= slice.filter(t=>t.pnlPct>0).reduce((s,t)=>s+t.pnlPct,0);
    const loss= Math.abs(slice.filter(t=>t.pnlPct<=0).reduce((s,t)=>s+t.pnlPct,0));
    const pf  = loss>0?(wins/loss):99;
    const tsCells = TIME_STOP_VALUES.map(ts=>{
      const sub=buildTrades(ts).filter(t=>t.paramSet===key&&(stage==='ALL'?true:stage==='USB'?t.stage==='ULTRA_STRONG_BUY':t.stage===stage));
      if(!sub.length) return '      —';
      const a=sub.reduce((s,t)=>s+t.pnlPct,0)/sub.length;
      const flag=a>=5?'✅':a>=4?'▲':'';
      return `${((a>=0?'+':'')+a.toFixed(2)+'%').padStart(6)}${flag}`;
    });
    const flag = avg>=5?'✅':avg>=4?'▲':'';
    console.log(`  ${stage.padEnd(16)} ${String(slice.length).padStart(4)} ${wr.toFixed(0).padStart(5)}% ${((avg>=0?'+':'')+avg.toFixed(2)+'%').padStart(8)}${flag} ${((med>=0?'+':'')+med.toFixed(2)+'%').padStart(8)} ${p5.toFixed(0).padStart(6)}% ${(pf>98?'∞':pf.toFixed(1)).padStart(6)}   ${tsCells.join('  ')}`);
  }
  // Exit breakdown for STRONG_BUY slice
  if(sbSlice.length>=5){
    process.stdout.write(`  SB exits: `);
    for(const ex of ['hit_t1','hit_t2','hit_t3','stopped','time_stop']){
      const sub=sbSlice.filter(t=>t.status===ex);
      if(!sub.length) continue;
      const a=sub.reduce((s,t)=>s+t.pnlPct,0)/sub.length;
      process.stdout.write(`${ex}=${sub.length}(${(a>=0?'+':'')+a.toFixed(1)}%)  `);
    }
    console.log();
  }
}

// ── 12b. OPTION 1 FOCUS — STRONG_BUY + HiPrec15+ deep dive ──────────────────
console.log('\n');
hdr('OPTION 1: STRONG_BUY + HiPrec15+ — Full Analysis');
const SB_HP = allTrades.filter(t=>t.stage==='STRONG_BUY'&&t.paramSet==='optimized_highprecision_15plus');
row('SB + HiPrec15+ (all)', SB_HP);
row('SB + HiPrec15+ + Bull regime', SB_HP.filter(t=>t.regimeBull));
row('SB + HiPrec15+ + Bear regime', SB_HP.filter(t=>!t.regimeBull));
// TIME_STOP sweep for this slice
console.log('\n── TIME_STOP sweep for SB+HiPrec15+ ──');
console.log(`${'Slice'.padEnd(32)}${TIME_STOP_VALUES.map(ts=>`TS=${ts}d`.padStart(9)).join('')}`);
console.log('─'.repeat(32+TIME_STOP_VALUES.length*9));
const sbhpSweepRows=[
  ['SB+HP all',         t=>t.stage==='STRONG_BUY'&&t.paramSet==='optimized_highprecision_15plus'],
  ['SB+HP + Bull',      t=>t.stage==='STRONG_BUY'&&t.paramSet==='optimized_highprecision_15plus'&&t.regimeBull],
  ['SB+HP + Bear',      t=>t.stage==='STRONG_BUY'&&t.paramSet==='optimized_highprecision_15plus'&&!t.regimeBull],
  ['USB+HP (baseline)', t=>t.stage==='ULTRA_STRONG_BUY'&&t.paramSet==='optimized_highprecision_15plus'],
];
for(const [label,fn] of sbhpSweepRows){
  const cells=TIME_STOP_VALUES.map(ts=>{
    const trades=buildTrades(ts).filter(fn);
    if(!trades.length) return '      —'.padStart(9);
    const avg=trades.reduce((s,t)=>s+t.pnlPct,0)/trades.length;
    const flag=avg>=5?'✅':avg>=4?'▲':'';
    return `${((avg>=0?'+':'')+avg.toFixed(2)+'%').padStart(7)}${flag.padStart(2)}`;
  });
  console.log(label.padEnd(32)+cells.join(''));
}
// Exit breakdown
console.log('\n── SB+HiPrec15+ exit breakdown (TS=3) ──');
for(const ex of ['hit_t1','hit_t2','hit_t3','stopped','time_stop']){
  const sub=SB_HP.filter(t=>t.status===ex);
  if(!sub.length) continue;
  const a=sub.reduce((s,t)=>s+t.pnlPct,0)/sub.length;
  const pct=(sub.length/SB_HP.length*100).toFixed(1);
  console.log(`  ${ex.padEnd(12)} n=${String(sub.length).padStart(3)} (${pct}%)  avg=${((a>=0?'+':'')+a.toFixed(2)+'%').padStart(8)}`);
}
// P&L distribution
console.log('\n── SB+HiPrec15+ P&L distribution ──');
const sbhpBuckets=[['<-10%',t=>t.pnlPct<-10],['-10 to -5%',t=>t.pnlPct>=-10&&t.pnlPct<-5],['-5 to 0%',t=>t.pnlPct>=-5&&t.pnlPct<0],['0-2%',t=>t.pnlPct>=0&&t.pnlPct<2],['2-5%',t=>t.pnlPct>=2&&t.pnlPct<5],['5-10%',t=>t.pnlPct>=5&&t.pnlPct<10],['>10%',t=>t.pnlPct>=10]];
for(const [label,fn] of sbhpBuckets){
  const n=SB_HP.filter(fn).length;
  const bar='█'.repeat(Math.round(n/SB_HP.length*40));
  console.log(`  ${label.padEnd(12)} ${String(n).padStart(3)}  ${bar}`);
}
// Comparison: what do we lose by restricting?
console.log('\n── Cost of restriction: what signals are dropped? ──');
const dropped=allTrades.filter(t=>!(t.stage==='STRONG_BUY'&&t.paramSet==='optimized_highprecision_15plus'));
row('Dropped signals (all others)', dropped);
console.log(`  Signals kept: ${SB_HP.length} of ${allTrades.length} (${(SB_HP.length/allTrades.length*100).toFixed(1)}%)`);
console.log(`  Signals/month estimate: ~${(SB_HP.length/24).toFixed(1)} (24-month backtest window)`);

// ── 13. MARKET REGIME FILTER — Nifty50 above/below 20-EMA ───────────────────
console.log('\n');
hdr('MARKET REGIME FILTER — Nifty50 close vs 20-EMA at signal date');
const bullTrades = allTrades.filter(t=>t.regimeBull);
const bearTrades = allTrades.filter(t=>!t.regimeBull);
row('Bull regime (N50 > EMA20)', bullTrades);
row('Bear regime (N50 ≤ EMA20)', bearTrades);
// Stage × regime
for(const s of ['STRONG_BUY','ULTRA_STRONG_BUY']){
  row(`Bull + ${s}`, allTrades.filter(t=>t.regimeBull&&t.stage===s));
  row(`Bear + ${s}`, allTrades.filter(t=>!t.regimeBull&&t.stage===s));
}
// Regime + TIME_STOP sweep
console.log('\n── Bull regime × TIME_STOP sweep ──');
console.log(`${'Slice'.padEnd(28)}${TIME_STOP_VALUES.map(ts=>`  TS=${ts}d`.padStart(10)).join('')}`);
console.log('─'.repeat(28+TIME_STOP_VALUES.length*10));
const regimeSweepRows = [
  ['Bull ALL',     t=>t.regimeBull],
  ['Bull SB+',     t=>t.regimeBull&&(t.stage==='STRONG_BUY'||t.stage==='ULTRA_STRONG_BUY')],
  ['Bull STRONG',  t=>t.regimeBull&&t.stage==='STRONG_BUY'],
  ['Bull USB',     t=>t.regimeBull&&t.stage==='ULTRA_STRONG_BUY'],
  ['Bear ALL',     t=>!t.regimeBull],
];
for(const [label,fn] of regimeSweepRows){
  const cells = TIME_STOP_VALUES.map(ts=>{
    const trades=buildTrades(ts).filter(fn);
    if(!trades.length) return '       — '.padStart(10);
    const avg=trades.reduce((s,t)=>s+t.pnlPct,0)/trades.length;
    const flag=avg>=5?'✅':avg>=4?'▲':'';
    return `${((avg>=0?'+':'')+avg.toFixed(2)+'%').padStart(8)}${flag.padStart(2)}`;
  });
  console.log(label.padEnd(28)+cells.join(''));
}
// Exit breakdown in bull regime
console.log('\n── Bull regime exit breakdown (TS=3) ──');
for(const ex of ['hit_t1','hit_t2','hit_t3','stopped','time_stop']){
  const sub=bullTrades.filter(t=>t.status===ex);
  if(!sub.length) continue;
  const a=sub.reduce((s,t)=>s+t.pnlPct,0)/sub.length;
  const pct=(sub.length/bullTrades.length*100).toFixed(1);
  console.log(`  ${ex.padEnd(12)} n=${String(sub.length).padStart(3)} (${pct}%)  avg=${((a>=0?'+':'')+a.toFixed(2)+'%').padStart(8)}`);
}

// ── 13. TIME_STOP SWEEP — 3 / 5 / 7 / 10 days ───────────────────────────────
console.log('\n');
hdr(`TIME_STOP SWEEP — ${TIME_STOP_VALUES.join(' / ')} days (find optimal exit for expired trades)`);

const SB_STAGES = ['STRONG_BUY','ULTRA_STRONG_BUY'];
const USB_STAGE  = 'ULTRA_STRONG_BUY';

// Header
const cols = TIME_STOP_VALUES.map(ts=>`  TS=${ts}d`.padStart(10)).join('');
console.log(`\n${'Slice'.padEnd(28)}${cols.replace(/  TS/g,' TS')}   <-- AvgP&L%`);
const hline = '─'.repeat(28 + TIME_STOP_VALUES.length*10);
console.log(hline);

function sweepRow(label, filterFn){
  const line = label.padEnd(28);
  const cells = TIME_STOP_VALUES.map(ts=>{
    const trades = buildTrades(ts).filter(filterFn);
    if(!trades.length) return '       — '.padStart(10);
    const avg = trades.reduce((s,t)=>s+t.pnlPct,0)/trades.length;
    const flag = avg>=5?'✅':avg>=4?'▲':'';
    return `${((avg>=0?'+':'')+avg.toFixed(2)+'%').padStart(8)}${flag.padStart(2)}`;
  });
  console.log(line + cells.join(''));
}

// All-trade summary
sweepRow('ALL STAGES', ()=>true);
sweepRow('STRONG_BUY', t=>t.stage==='STRONG_BUY');
sweepRow('ULTRA_STRONG_BUY', t=>t.stage===USB_STAGE);

console.log(hline);

// Per param set
for(const key of PARAM_SETS){
  const label = key.replace('optimized_','').replace('_plus','+'). replace(/_/g,' ');
  sweepRow(label, t=>t.paramSet===key);
}

console.log(hline);

// Exit-type breakdown per TIME_STOP
console.log('\n── Exit-type breakdown per TIME_STOP ──');
const exitTypes = ['hit_t1','hit_t2','hit_t3','stopped','time_stop'];
for(const ts of TIME_STOP_VALUES){
  const trades = buildTrades(ts);
  const total  = trades.length;
  const avg    = trades.reduce((s,t)=>s+t.pnlPct,0)/total;
  const wr     = trades.filter(t=>t.pnlPct>0).length/total*100;
  const pf5    = trades.filter(t=>t.pnlPct>=5).length/total*100;
  console.log(`\nTIME_STOP = ${ts} days  →  n=${total}  avgP&L=${avg>=0?'+':''}${avg.toFixed(2)}%  WR=${wr.toFixed(1)}%  %≥5%=${pf5.toFixed(1)}%`);
  for(const ex of exitTypes){
    const sub = trades.filter(t=>t.status===ex);
    if(!sub.length) continue;
    const a = sub.reduce((s,t)=>s+t.pnlPct,0)/sub.length;
    const w = sub.filter(t=>t.pnlPct>0).length/sub.length*100;
    console.log(`  ${ex.padEnd(12)} n=${String(sub.length).padStart(3)}  avg=${((a>=0?'+':'')+a.toFixed(2)+'%').padStart(8)}  WR=${w.toFixed(0).padStart(3)}%`);
  }
}

// P&L distribution comparison
console.log('\n── P&L distribution per TIME_STOP ──');
const distBuckets=[['<-10%',t=>t.pnlPct<-10],['-10 to -5%',t=>t.pnlPct>=-10&&t.pnlPct<-5],['-5 to 0%',t=>t.pnlPct>=-5&&t.pnlPct<0],['0 to 2%',t=>t.pnlPct>=0&&t.pnlPct<2],['2 to 5%',t=>t.pnlPct>=2&&t.pnlPct<5],['5 to 10%',t=>t.pnlPct>=5&&t.pnlPct<10],['>10%',t=>t.pnlPct>=10]];
const distHeader = 'Bucket'.padEnd(14)+TIME_STOP_VALUES.map(ts=>`TS=${ts}`.padStart(8)).join('');
console.log(distHeader);
console.log('─'.repeat(distHeader.length));
for(const [label,fn] of distBuckets){
  const line=label.padEnd(14)+TIME_STOP_VALUES.map(ts=>{
    const trades=buildTrades(ts); const n=trades.filter(fn).length;
    return String(n).padStart(8);
  }).join('');
  console.log(line);
}

// Best TIME_STOP recommendation
console.log('\n── Recommendation ──');
const summary = TIME_STOP_VALUES.map(ts=>{
  const trades=buildTrades(ts);
  const avg=trades.reduce((s,t)=>s+t.pnlPct,0)/trades.length;
  const wr=trades.filter(t=>t.pnlPct>0).length/trades.length*100;
  const pf5=trades.filter(t=>t.pnlPct>=5).length/trades.length*100;
  const tsLosers=trades.filter(t=>t.status==='time_stop');
  const tsAvg=tsLosers.length?tsLosers.reduce((s,t)=>s+t.pnlPct,0)/tsLosers.length:0;
  return {ts,avg,wr,pf5,tsAvg,n:trades.length};
});
const best=summary.reduce((a,b)=>b.avg>a.avg?b:a);
console.log(`Best avg P&L:  TIME_STOP = ${best.ts} days  (avgP&L = ${best.avg>=0?'+':''}${best.avg.toFixed(2)}%,  WR = ${best.wr.toFixed(1)}%,  %≥5% = ${best.pf5.toFixed(1)}%)`);
const bestWR=summary.reduce((a,b)=>b.wr>a.wr?b:a);
console.log(`Best win rate: TIME_STOP = ${bestWR.ts} days  (avgP&L = ${bestWR.avg>=0?'+':''}${bestWR.avg.toFixed(2)}%,  WR = ${bestWR.wr.toFixed(1)}%,  %≥5% = ${bestWR.pf5.toFixed(1)}%)`);
const bestP5=summary.reduce((a,b)=>b.pf5>a.pf5?b:a);
console.log(`Best %≥5%:     TIME_STOP = ${bestP5.ts} days  (avgP&L = ${bestP5.avg>=0?'+':''}${bestP5.avg.toFixed(2)}%,  WR = ${bestP5.wr.toFixed(1)}%,  %≥5% = ${bestP5.pf5.toFixed(1)}%)`);
console.log('\nFull summary table:');
console.log('TS   avgP&L    WR%   %≥5%   TimeStop-AvgP&L');
for(const s of summary){
  console.log(`${String(s.ts).padStart(2)}d  ${((s.avg>=0?'+':'')+s.avg.toFixed(2)+'%').padStart(8)}  ${s.wr.toFixed(1).padStart(5)}%  ${s.pf5.toFixed(1).padStart(5)}%  ${((s.tsAvg>=0?'+':'')+s.tsAvg.toFixed(2)+'%').padStart(10)} (time_stop bucket)`);
}

console.log('\n═══ PHASE 1 DEEP DIVE COMPLETE ═══\n');
