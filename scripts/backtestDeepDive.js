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

// ── Collect ALL trades across universe × param sets ──
const allTrades = [];
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

      const FWD=60; // max window — 60 bars (~3 months)
      const TIME_STOP=10; // 10-day time stop — gives breakouts room to develop
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

      // 10-day time stop: if trade expired OR it hit no target within TIME_STOP bars,
      // exit at the close of bar TIME_STOP instead of holding 60 bars.
      let finalStatus = ft.status;
      let finalPnlPct = ft.pnlPct ?? 0;
      let finalPnlR   = ft.pnlR   ?? 0;
      let finalDays   = ft.daysHeld ?? FWD;

      if(ft.status === 'expired') {
        // Apply time stop: exit at close of bar TIME_STOP (or earlier if stop/target hit)
        const timeStopIdx = Math.min(i + TIME_STOP, candles.length - 1);
        const timeStopCandle = candles[timeStopIdx];
        finalPnlPct = (timeStopCandle.c - pe.plannedEntry) / pe.plannedEntry * 100;
        finalPnlR   = finalPnlPct / (pe.tacticalRiskPct || 1);
        finalDays   = TIME_STOP;
        finalStatus = 'time_stop';
      }

      // MOM badge
      const hasMom = !!(r.monster?.badges?.some(b=>b.type==='MOM'));
      // conviction (if available)
      const conviction = r.conviction ?? null;
      // volume ratio on signal bar (last candle of slice)
      const lastCandle = slice[slice.length-1];
      const vol20avg = slice.length>=21
        ? slice.slice(-21,-1).reduce((s,c)=>s+c.v,0)/20 : 0;
      const volRatio = vol20avg>0 ? lastCandle.v/vol20avg : 0;

      allTrades.push({
        sym, paramSet:key, stage:r.stage,
        status: finalStatus,
        pnlPct: finalPnlPct,
        pnlR:   finalPnlR,
        daysHeld: finalDays,
        hasMom, conviction, volRatio,
        entry:pe.plannedEntry, stop:pe.tacticalStop,
        disasterRiskPct: pe.disasterRiskPct??0,
        tacticalRiskPct: pe.tacticalRiskPct??0,
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

console.log(`\nDone. ${allTrades.length} total trade records. Errors: ${errs}\n`);

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

console.log('\n═══ PHASE 1 DEEP DIVE COMPLETE ═══\n');
