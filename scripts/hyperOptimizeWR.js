// ═══════════════════════════════════════════════════════════════════════════════
// HYPER-OPTIMIZE WIN RATE — Fast in-memory grid search
// Strategy: scan universe ONCE at base params, collect all raw signals with
// their feature values. Then filter combinations in-memory — no re-scanning.
// This makes 1728 combos take seconds instead of hours.
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs'), path = require('path');
const ENGINE_DIR = path.join(__dirname, '_compiled');
const { analyzeStock } = require(path.join(ENGINE_DIR, 'stockEngine.js'));
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
console.log(`Universe: ${universe.size} stocks\n`);

const PARAM_KEYS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
];
const PARAM_LABELS = {
  optimized_deployable_20plus:    'Deploy20+',
  optimized_highprecision_15plus: 'HiPrec15+',
  optimized_elite_10plus:         'Elite10+',
  optimized_ultraselective_8plus: 'UltraSel8+',
  sniper_95plus:                  'Sniper95+',
};

// ── Grid axes: parameters to sweep per param set ──
// Only sweep params that are CHECK-TYPE (min/max thresholds applied to signal features).
// These can be filtered in-memory WITHOUT re-running analyzeStock.
const GRID_AXES = {
  optimized_deployable_20plus: {
    minExactVolRatio20:          [0.7, 1.0, 1.2, 1.5, 1.8],
    minExactRangeATR14:          [1.4, 1.6, 1.8, 2.0, 2.2],
    minCloseLoc:                 [55, 60, 65, 70, 75],
    maxUpperWickPct:             [50, 40, 35, 28, 22],
    minBodyPct:                  [50, 55, 60, 65, 70],
    minVolatilityExpansionRatio: [2.0, 2.4, 2.8, 3.2, 3.6],
  },
  optimized_highprecision_15plus: {
    minExactVolRatio20:     [1.2, 1.5, 1.8, 2.0, 2.3],
    minExactRangeATR14:     [1.2, 1.5, 1.8, 2.0, 2.2],
    minCloseLoc:            [50, 55, 60, 65, 70],
    maxUpperWickPct:        [45, 38, 30, 25, 20],
    minBodyPct:             [15, 25, 35, 45, 55],
    maxZoneTightnessPct:    [10.0, 8.0, 6.0, 5.0, 4.0],
  },
  optimized_elite_10plus: {
    minExactVolRatio20:     [1.5, 1.8, 2.0, 2.3, 2.6],
    minExactRangeATR14:     [1.5, 1.8, 2.0, 2.3, 2.6],
    minCloseLoc:            [30, 40, 50, 55, 60],
    maxUpperWickPct:        [40, 32, 25, 20],
    minBodyPct:             [5, 15, 25, 35, 45],
    minVolatilityExpansionRatio: [0.4, 0.6, 0.8, 1.0, 1.2],
  },
  optimized_ultraselective_8plus: {
    minExactVolRatio20:     [0.5, 0.7, 0.9, 1.1, 1.3],
    minExactRangeATR14:     [0.4, 0.6, 0.9, 1.2, 1.5],
    minCloseLoc:            [30, 40, 50, 55, 60],
    maxUpperWickPct:        [40, 32, 25, 20],
    minBodyPct:             [5, 15, 25, 35, 45],
    minVolatilityExpansionRatio: [1.6, 2.0, 2.4, 2.8],
  },
  sniper_95plus: {
    minExactVolRatio20:          [1.2, 1.5, 1.8, 2.0, 2.3],
    minExactRangeATR14:          [1.8, 2.1, 2.4, 2.7, 3.0],
    minCloseLoc:                 [55, 60, 65, 70, 75],
    maxUpperWickPct:             [50, 40, 32, 25],
    minBodyPct:                  [20, 30, 40, 50],
    minVolatilityExpansionRatio: [0.7, 0.9, 1.2, 1.5, 1.8],
  },
};

// ── Step 1: Scan universe once per param set, collect raw signal features ──
function collectSignals(paramKey) {
  const signals = [];
  let done=0;
  for(const [sym, candles] of universe){
    let i=100, inTrade=false, tradeEndIdx=-1;
    while(i < candles.length-1){
      if(inTrade && i<tradeEndIdx){ i++; continue; }
      inTrade=false;
      const slice=candles.slice(0,i+1);
      let r;
      try{ r=analyzeStock(slice, paramKey); } catch(e){ i++; continue; }
      if(!['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage)){ i++; continue; }
      const pe=r.priceEngine;
      if(!pe||!(pe.plannedEntry>0)||!(pe.tacticalStop>0)||!(pe.tacticalStop<pe.plannedEntry)){ i++; continue; }
      const fwdEnd=Math.min(i+FWD, candles.length-1);
      if(hasSplitInWindow(candles,i,fwdEnd)){ i++; continue; }
      const trade={symbol:sym,entryPrice:pe.plannedEntry,stopLoss:pe.tacticalStop,
        target1:pe.target5,target2:pe.target7,target3:pe.target10,status:'open'};
      const sinceEntry=candles.slice(i,fwdEnd+1).map(c=>({ts:c.ts,o:c.o,h:c.h,l:c.l,c:c.c,v:c.v}));
      let vr,ft;
      try{ vr=validateTrade(trade,sinceEntry); ft=applyValidation(trade,vr); } catch(e){ i++; continue; }
      let pnl=ft.pnlPct??0;
      if(ft.status==='expired'){
        const tsIdx=Math.min(i+TIME_STOP,candles.length-1);
        pnl=(candles[tsIdx].c-pe.plannedEntry)/pe.plannedEntry*100;
      }
      signals.push({
        stage: r.stage,
        pnl,
        // All filterable features — no re-scan needed
        minExactVolRatio20:          r.volRatio20          ?? 0,
        minExactRangeATR14:          r.exactRangeATR14     ?? 0,
        minCloseLoc:                 r.closeLoc            ?? 0,
        maxUpperWickPct:             r.upperWickPct        ?? 100,
        minBodyPct:                  r.bodyPct             ?? 0,
        minVolatilityExpansionRatio: r.volatilityExpansionRatio ?? 0,
        maxZoneTightnessPct:         r.zoneTightnessPct    ?? 999,
        minUltraPrecisionScore:      r.ultraPrecisionScore ?? 0,
        minExactVolVsPre5:           r.exactVolVsPre5      ?? 0,
      });
      if(ft.status!=='open'){ tradeEndIdx=i+Math.max(1,ft.daysHeld??1); inTrade=true; i=tradeEndIdx; }
      else i++;
    }
    done++;
    if(done%100===0) process.stdout.write(`  ${done}/${universe.size} stocks...\r`);
  }
  process.stdout.write('\n');
  return signals;
}

// ── Step 2: Filter in-memory ──
function applyFilter(signals, overrides) {
  return signals.filter(s => {
    for(const [k,v] of Object.entries(overrides)){
      if(k.startsWith('min') && s[k] < v) return false;
      if(k.startsWith('max') && s[k] > v) return false;
    }
    return true;
  });
}

function stats(signals) {
  const n   = signals.length;
  if(n < 20) return null;
  const wr  = signals.filter(s=>s.pnl>0).length / n * 100;
  const avg = signals.reduce((s,t)=>s+t.pnl,0) / n;
  const p5  = signals.filter(s=>s.pnl>=5).length / n * 100;
  const wins= signals.filter(s=>s.pnl>0).reduce((s,t)=>s+t.pnl,0);
  const loss= Math.abs(signals.filter(s=>s.pnl<=0).reduce((s,t)=>s+t.pnl,0));
  const pf  = loss>0 ? wins/loss : 99;
  return { n, wr, avg, p5, pf };
}

// ── Grid generator ──
function* gridCombos(axes) {
  const keys   = Object.keys(axes);
  const values = keys.map(k=>axes[k]);
  const total  = values.reduce((a,v)=>a*v.length, 1);
  for(let idx=0; idx<total; idx++){
    const combo={};
    let rem=idx;
    for(let k=keys.length-1; k>=0; k--){
      combo[keys[k]] = values[k][rem % values[k].length];
      rem = Math.floor(rem / values[k].length);
    }
    yield combo;
  }
}

// ── Main ──
const RECOMMENDATIONS = {};

for(const paramKey of PARAM_KEYS){
  const label = PARAM_LABELS[paramKey];
  const axes  = GRID_AXES[paramKey];
  const totalCombos = Object.values(axes).reduce((a,v)=>a*v.length,1);

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  ${label} — scanning universe once (${totalCombos} in-memory combos)`);
  console.log('═'.repeat(80));

  const allSignals = collectSignals(paramKey);
  console.log(`  Collected ${allSignals.length} raw signals`);

  const baseline = stats(allSignals);
  if(!baseline){ console.log('  Too few signals — skipping'); continue; }
  console.log(`  Baseline: n=${baseline.n}  WR=${baseline.wr.toFixed(1)}%  avgP&L=${baseline.avg>=0?'+':''}${baseline.avg.toFixed(2)}%  %≥5%=${baseline.p5.toFixed(1)}%  PF=${baseline.pf.toFixed(2)}`);

  const results = [];
  for(const overrides of gridCombos(axes)){
    const filtered = applyFilter(allSignals, overrides);
    const s = stats(filtered);
    if(!s) continue;
    if(s.avg < baseline.avg - 0.3) continue; // don't sacrifice >0.3pp avg
    results.push({ overrides, ...s });
  }

  // Sort: WR desc, then avg desc
  results.sort((a,b)=> b.wr!==a.wr ? b.wr-a.wr : b.avg-a.avg);
  const top10 = results.slice(0,10);
  if(top10.length===0){ console.log('  → 0 valid combos (all below avg P&L floor) — relaxing to -1.0pp and retrying...');
    const results2=[];
    for(const overrides of gridCombos(axes)){
      const filtered=applyFilter(allSignals,overrides);
      const s=stats(filtered);
      if(!s) continue;
      if(s.avg < baseline.avg-1.0) continue;
      results2.push({overrides,...s});
    }
    results2.sort((a,b)=>b.wr!==a.wr?b.wr-a.wr:b.avg-a.avg);
    top10.push(...results2.slice(0,10));
    console.log(`  Relaxed results: ${results2.length} valid combos`);
  }

  console.log(`\n  Results: ${results.length} valid combos of ${totalCombos}  |  Top 10 by WR:`);
  console.log(`  ${'Rank'.padEnd(5)} ${'N'.padStart(5)} ${'WR%'.padStart(7)} ${'AvgP&L'.padStart(9)} ${'%≥5%'.padStart(7)} ${'PF'.padStart(6)}  Key param changes`);
  console.log('  '+'-'.repeat(110));

  // Current base values for comparison
  const engineModule = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const baseVals = engineModule.PARAM_SETS[paramKey];

  for(let i=0; i<top10.length; i++){
    const r = top10[i];
    const changes = Object.entries(r.overrides)
      .filter(([k,v])=> v !== baseVals[k])
      .map(([k,v])=>{
        const old = baseVals[k];
        const arrow = k.startsWith('min') ? (v>old?'▲':'▼') : (v<old?'▼':'▲');
        return `${k.replace('min','').replace('max','max')}:${old}→${v}${arrow}`;
      }).join('  ');
    const wrFlag = r.wr > baseline.wr ? ` ✅+${(r.wr-baseline.wr).toFixed(1)}pp` : '';
    console.log(`  #${String(i+1).padEnd(4)} ${String(r.n).padStart(5)} ${r.wr.toFixed(1).padStart(6)}%${wrFlag.padEnd(10)} ${((r.avg>=0?'+':'')+r.avg.toFixed(2)+'%').padStart(9)} ${r.p5.toFixed(1).padStart(6)}% ${r.pf.toFixed(2).padStart(6)}  ${changes||'(baseline)'}`);
  }

  RECOMMENDATIONS[paramKey] = { label, baseline, best: top10[0], top3: top10.slice(0,3) };
}

// ── Final summary ──
console.log(`\n\n${'═'.repeat(80)}`);
console.log('  FINAL RECOMMENDATIONS — implement these in stockEngine.ts');
console.log('═'.repeat(80));

for(const [paramKey, rec] of Object.entries(RECOMMENDATIONS)){
  const { label, baseline, best } = rec;
  if(!best){ console.log(`\n${label}  → No valid combos found even with relaxed constraint`); continue; }
  const wrGain  = (best.wr  - baseline.wr).toFixed(1);
  const avgGain = (best.avg - baseline.avg).toFixed(2);
  const nChange = best.n - baseline.n;

  console.log(`\n${label}  (WR: ${baseline.wr.toFixed(1)}% → ${best.wr.toFixed(1)}%  ${wrGain>=0?'+':''}${wrGain}pp  |  avgP&L: ${baseline.avg>=0?'+':''}${baseline.avg.toFixed(2)}% → ${best.avg>=0?'+':''}${best.avg.toFixed(2)}%  |  n: ${baseline.n} → ${best.n} ${nChange>=0?'(+'+nChange+')':'('+nChange+')'})`);

  const engineModule = require(path.join(ENGINE_DIR, 'stockEngine.js'));
  const baseVals = engineModule.PARAM_SETS[paramKey];
  const changes = Object.entries(best.overrides).filter(([k,v])=>v!==baseVals[k]);
  if(changes.length===0){
    console.log('  → No changes needed, baseline is optimal');
  } else {
    for(const [k,v] of changes){
      console.log(`  ${k.padEnd(35)} ${String(baseVals[k]).padStart(8)} → ${v}`);
    }
  }
}

console.log('\n═══ DONE ═══\n');
