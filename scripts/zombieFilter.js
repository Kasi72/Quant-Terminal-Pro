// ═══════════════════════════════════════════════════════════════════════════════
// ZOMBIE FILTER — Find entry-bar features that predict 6+ shield events
// Phase 1: Label trades as zombie/normal
// Phase 2: Feature importance (Mann-Whitney AUC per feature)
// Phase 3: Pareto threshold sweep (zombie kill vs collateral loss)
// Phase 4: 2-feature combo + P&L projection
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
const ZOMBIE_THRESHOLD = 6;

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

// ─── Mann-Whitney AUC ────────────────────────────────────────────────────────
// Measures how well a feature separates two groups.
// AUC = P(zombie_feature > normal_feature) if higher = more zombie-like
// Returns {auc, direction}: direction = 'higher'|'lower' (which direction predicts zombie)
function mannWhitneyAUC(zombieVals, normalVals) {
  if (!zombieVals.length || !normalVals.length) return { auc: 0.5, direction: 'higher' };
  let wins = 0, ties = 0;
  for (const z of zombieVals) {
    for (const n of normalVals) {
      if (z > n) wins++;
      else if (z === n) ties++;
    }
  }
  const total = zombieVals.length * normalVals.length;
  const auc = (wins + 0.5 * ties) / total;
  // AUC > 0.5 means higher values predict zombie; < 0.5 means lower values predict zombie
  if (auc >= 0.5) return { auc, direction: 'higher' };
  return { auc: 1 - auc, direction: 'lower' };
}

// ─── Load universe ────────────────────────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1: COLLECT TRADES WITH LABELS
// ═══════════════════════════════════════════════════════════════════════════════
console.log('Phase 1: Collecting trades with zombie labels...');

const allTrades = [];
let done = 0;

for(const [sym, candles] of universe){
  let i=100, inTrade=false, tradeEndIdx=-1;
  while(i < candles.length-1){
    if(inTrade && i<tradeEndIdx){ i++; continue; }
    inTrade=false;

    for(const paramKey of PARAM_KEYS){
      const slice = candles.slice(0, i+1);
      let r;
      try{ r=analyzeStock(slice, paramKey); } catch(e){ continue; }
      if(!['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.stage)) continue;
      const pe = r.priceEngine;
      if(!pe||!(pe.plannedEntry>0)||!(pe.tacticalStop>0)||!(pe.tacticalStop<pe.plannedEntry)) continue;

      const fwdEnd = Math.min(i+FWD, candles.length-1);
      if(hasSplitInWindow(candles,i,fwdEnd)) continue;

      const trade={symbol:sym,entryPrice:pe.plannedEntry,stopLoss:pe.tacticalStop,
        target1:pe.target5,target2:pe.target7,target3:pe.target10,status:'open'};
      const sinceEntry=candles.slice(i,fwdEnd+1).map(c=>({ts:c.ts,o:c.o,h:c.h,l:c.l,c:c.c,v:c.v}));
      let vr, ft;
      try{ vr=validateTrade(trade,sinceEntry); ft=applyValidation(trade,vr); } catch(e){ continue; }

      let pnl = ft.pnlPct ?? 0;
      let finalStatus = ft.status;
      if(finalStatus==='expired'){
        const tsIdx=Math.min(i+TIME_STOP,candles.length-1);
        pnl=(candles[tsIdx].c-pe.plannedEntry)/pe.plannedEntry*100;
        finalStatus='time_stop';
      }

      // Count shield events
      const gateLog = vr.gateLog ?? [];
      const shieldCount = gateLog.filter(e=>e.result==='SHIELDED').length;
      const isZombie = shieldCount >= ZOMBIE_THRESHOLD;

      // ── Entry-bar features (all available AT bar i, before the trade starts) ──
      // Standard signal features
      const f_closeLoc            = r.closeLoc          ?? 0;
      const f_upperWickPct        = r.upperWickPct       ?? 100;
      const f_bodyPct             = r.bodyPct            ?? 0;
      const f_exactVolRatio20     = r.exactVolRatio20    ?? 0;
      const f_exactRangeATR14     = r.exactRangeATR14    ?? 0;
      const f_exactVolVsPre5      = r.exactVolVsPre5     ?? 0;
      const f_ultraPrecisionScore = r.ultraPrecisionScore ?? 0;
      const f_volatilityExpRatio  = r.volatilityExpansionRatio ?? 0;
      const f_signalRangePct      = r.signalRangePct     ?? 0;

      // Zone / compression features
      const f_zoneLen             = r.compressionZoneLen ?? r.zoneLen ?? 0;
      const f_zoneTightnessPct    = r.zoneTightnessPct   ?? 0;

      // Pre-10 environment
      const f_pre10AvgRangeATR    = r.pre10AvgRangeATR   ?? 0;
      const f_pre10AvgVolRatio    = r.pre10AvgVolRatio   ?? 0;
      const f_pre5AvgVolRatio     = r.pre5AvgVolRatio    ?? 0;
      const f_pre10HighVolCount   = r.pre10HighVolCount  ?? 0;
      const f_pre10RedVolBias     = r.pre10RedVolBias    ?? 0;
      const f_pre10ExpCount       = r.pre10ExpansionCount ?? 0;

      // Price engine risk metrics
      const f_tacticalRiskPct     = pe.tacticalRiskPct   ?? 0;
      const f_disasterRiskPct     = pe.disasterRiskPct   ?? 0;
      const f_rewardRisk          = pe.rewardRisk        ?? 0;

      // Volatility context
      const f_atrPct14Pctl        = r.atrPct14Pctl120   ?? 50;

      // Inflection score
      const f_inflectionScore     = r.inflectionScore    ?? 0;

      allTrades.push({
        sym, paramKey, stage: r.stage,
        pnl, status: finalStatus,
        shieldCount, isZombie,
        // All entry features
        closeLoc: f_closeLoc, upperWickPct: f_upperWickPct, bodyPct: f_bodyPct,
        exactVolRatio20: f_exactVolRatio20, exactRangeATR14: f_exactRangeATR14,
        exactVolVsPre5: f_exactVolVsPre5, ultraPrecisionScore: f_ultraPrecisionScore,
        volatilityExpRatio: f_volatilityExpRatio, signalRangePct: f_signalRangePct,
        zoneLen: f_zoneLen, zoneTightnessPct: f_zoneTightnessPct,
        pre10AvgRangeATR: f_pre10AvgRangeATR, pre10AvgVolRatio: f_pre10AvgVolRatio,
        pre5AvgVolRatio: f_pre5AvgVolRatio, pre10HighVolCount: f_pre10HighVolCount,
        pre10RedVolBias: f_pre10RedVolBias, pre10ExpCount: f_pre10ExpCount,
        tacticalRiskPct: f_tacticalRiskPct, disasterRiskPct: f_disasterRiskPct,
        rewardRisk: f_rewardRisk, atrPct14Pctl: f_atrPct14Pctl,
        inflectionScore: f_inflectionScore,
      });
      inTrade=true;
      tradeEndIdx=i+Math.max(1,ft.daysHeld??TIME_STOP);
      break;
    }
    i++;
  }
  done++;
  if(done%100===0) process.stdout.write(`  ${done}/${universe.size} stocks...\r`);
}
process.stdout.write('\n');

const zombies  = allTrades.filter(t=>t.isZombie);
const normals  = allTrades.filter(t=>!t.isZombie);
const DSep = '═'.repeat(80);
const sep  = '─'.repeat(80);
console.log(`\nTotal trades: ${allTrades.length}  Zombies: ${zombies.length} (${(zombies.length/allTrades.length*100).toFixed(1)}%)  Normal: ${normals.length}\n`);

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: FEATURE IMPORTANCE (Mann-Whitney AUC)
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${DSep}`);
console.log('  Phase 2: FEATURE IMPORTANCE — AUC per entry feature');
console.log(`${DSep}\n`);

const FEATURES = [
  'closeLoc','upperWickPct','bodyPct','exactVolRatio20','exactRangeATR14',
  'exactVolVsPre5','ultraPrecisionScore','volatilityExpRatio','signalRangePct',
  'zoneLen','zoneTightnessPct','pre10AvgRangeATR','pre10AvgVolRatio',
  'pre5AvgVolRatio','pre10HighVolCount','pre10RedVolBias','pre10ExpCount',
  'tacticalRiskPct','disasterRiskPct','rewardRisk','atrPct14Pctl','inflectionScore',
];

function mean(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function fmt(v,d=2){ return (v>=0?'+':'')+v.toFixed(d); }

const featureStats = [];
for(const feat of FEATURES){
  const zVals = zombies.map(t=>t[feat]).filter(v=>Number.isFinite(v)&&v!==0);
  const nVals  = normals.map(t=>t[feat]).filter(v=>Number.isFinite(v)&&v!==0);
  if(!zVals.length || !nVals.length) continue;
  const { auc, direction } = mannWhitneyAUC(zVals, nVals);
  const zMean = mean(zVals), nMean = mean(nVals);
  featureStats.push({ feat, auc, direction, zMean, nMean, diff: zMean - nMean });
}
featureStats.sort((a,b)=>b.auc-a.auc);

const aucBar = (auc) => {
  const excess = (auc - 0.5) / 0.5; // 0 to 1
  return '█'.repeat(Math.round(excess * 30));
};

console.log(`  ${'Feature'.padEnd(22)} ${'AUC'.padStart(6)}  ${'Direction'.padEnd(8)}  ${'Zombie avg'.padStart(11)}  ${'Normal avg'.padStart(11)}  ${'Diff'.padStart(8)}`);
console.log('  '+sep);
for(const s of featureStats){
  const pct = ((s.auc - 0.5) * 200).toFixed(0);
  const bar = aucBar(s.auc);
  console.log(`  ${s.feat.padEnd(22)} ${s.auc.toFixed(3).padStart(6)}  ${(s.direction+'→zombie').padEnd(14)}  ${s.zMean.toFixed(2).padStart(11)}  ${s.nMean.toFixed(2).padStart(11)}  ${(s.diff>=0?'+':'')+s.diff.toFixed(2).padStart(7)}  ${bar} (+${pct}% above random)`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 3: PARETO THRESHOLD SWEEP
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${DSep}`);
console.log('  Phase 3: PARETO SWEEP — zombie kill% vs collateral loss% per feature');
console.log(`${DSep}`);
console.log('  Target: kill ≥30% of zombies with ≤10% collateral loss on good trades\n');

const TOP_FEATURES = featureStats.slice(0, 7).map(s=>s.feat);
const paretoResults = []; // {feat, threshold, direction, zombieKill, collateral, netBenefit}

for(const feat of TOP_FEATURES){
  const { direction } = featureStats.find(s=>s.feat===feat);
  const allVals = allTrades.map(t=>t[feat]).filter(v=>Number.isFinite(v)&&v!==0).sort((a,b)=>a-b);
  if(!allVals.length) continue;

  // Sweep percentile thresholds 5th–95th
  const thresholds = [];
  for(let p=5; p<=95; p+=5){
    thresholds.push(allVals[Math.floor(allVals.length * p/100)]);
  }
  const uniqueThresh = [...new Set(thresholds)];

  const bestRow = { zombieKill: 0, collateral: 100, netBenefit: -999, threshold: 0 };
  const rows = [];

  for(const thresh of uniqueThresh){
    // "filtered out" = would be removed by this rule
    // direction='higher' → filter out trades where feat >= thresh (high values = zombie-like)
    // direction='lower'  → filter out trades where feat <= thresh (low values = zombie-like)
    const filteredZombies = direction === 'higher'
      ? zombies.filter(t=>t[feat] >= thresh).length
      : zombies.filter(t=>t[feat] <= thresh).length;
    const filteredNormals = direction === 'higher'
      ? normals.filter(t=>t[feat] >= thresh).length
      : normals.filter(t=>t[feat] <= thresh).length;

    const zombieKill  = zombies.length > 0 ? filteredZombies / zombies.length * 100 : 0;
    const collateral  = normals.length > 0 ? filteredNormals / normals.length * 100 : 0;
    const netBenefit  = zombieKill - 2.5 * collateral; // penalise false positives 2.5x

    rows.push({ threshold: thresh, zombieKill, collateral, netBenefit, filteredZombies, filteredNormals });
    if(netBenefit > bestRow.netBenefit){
      bestRow.zombieKill = zombieKill; bestRow.collateral = collateral;
      bestRow.netBenefit = netBenefit; bestRow.threshold = thresh;
      bestRow.filteredZombies = filteredZombies; bestRow.filteredNormals = filteredNormals;
    }
  }

  paretoResults.push({ feat, direction, ...bestRow });

  console.log(`\n  ── ${feat} (${direction}→zombie, AUC=${featureStats.find(s=>s.feat===feat).auc.toFixed(3)}) ──`);
  console.log(`  ${'Threshold'.padEnd(12)} ${'ZombieKill%'.padStart(13)} ${'Collateral%'.padStart(13)} ${'NetBenefit'.padStart(12)}`);
  // Print only Pareto-efficient rows (where zombieKill and collateral are both moving favorably)
  const paretoRows = rows.filter(r => r.zombieKill >= 10 && r.collateral <= 30);
  const printRows = paretoRows.length > 0 ? paretoRows : rows.filter(r=>r.zombieKill>=5).slice(0,6);
  for(const r of printRows.slice(0,8)){
    const marker = Math.abs(r.threshold - bestRow.threshold) < 0.01 ? ' ← BEST' : '';
    console.log(`  ${String(r.threshold.toFixed(2)).padEnd(12)} ${(r.zombieKill.toFixed(1)+'%').padStart(12)}  ${(r.collateral.toFixed(1)+'%').padStart(12)}  ${r.netBenefit.toFixed(1).padStart(11)}${marker}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 4: 2-FEATURE COMBO + P&L PROJECTION
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${DSep}`);
console.log('  Phase 4: 2-FEATURE COMBO GRID SEARCH + P&L PROJECTION');
console.log(`${DSep}\n`);

// Take top 5 features, try all pairs
const TOP5 = featureStats.slice(0,5);
const combos = [];

for(let a=0; a<TOP5.length; a++){
  for(let b=a+1; b<TOP5.length; b++){
    const fa = TOP5[a], fb = TOP5[b];
    // Sweep thresholds for both independently, find best combo
    const aVals = allTrades.map(t=>t[fa.feat]).filter(v=>Number.isFinite(v)&&v!==0).sort((a,b)=>a-b);
    const bVals = allTrades.map(t=>t[fb.feat]).filter(v=>Number.isFinite(v)&&v!==0).sort((a,b)=>a-b);
    const aThreshs = [20,30,40,50,60,70,80].map(p=>aVals[Math.floor(aVals.length*p/100)]);
    const bThreshs = [20,30,40,50,60,70,80].map(p=>bVals[Math.floor(bVals.length*p/100)]);

    let best = { zombieKill:0, collateral:100, netBenefit:-999, ta:0, tb:0 };
    for(const ta of [...new Set(aThreshs)]){
      for(const tb of [...new Set(bThreshs)]){
        const filtered = allTrades.filter(t => {
          const passA = fa.direction==='higher' ? t[fa.feat] >= ta : t[fa.feat] <= ta;
          const passB = fb.direction==='higher' ? t[fb.feat] >= tb : t[fb.feat] <= tb;
          return passA || passB; // OR combination: if either flags zombie, filter
        });
        const fz = filtered.filter(t=>t.isZombie).length;
        const fn = filtered.filter(t=>!t.isZombie).length;
        const zk = fz / zombies.length * 100;
        const cl = fn / normals.length * 100;
        const nb = zk - 2.5 * cl;
        if(nb > best.netBenefit){ best = {zombieKill:zk, collateral:cl, netBenefit:nb, ta, tb, fz, fn}; }
      }
    }
    combos.push({ featA: fa.feat, featB: fb.feat, dirA: fa.direction, dirB: fb.direction, ...best });
  }
}
combos.sort((a,b)=>b.netBenefit-a.netBenefit);

console.log(`  ${'Combo'.padEnd(40)} ${'ZombieKill%'.padStart(12)} ${'Collateral%'.padStart(13)} ${'NetBenefit'.padStart(12)}`);
console.log('  '+sep);
for(const c of combos.slice(0,10)){
  const label = `${c.featA} | ${c.featB}`;
  console.log(`  ${label.padEnd(40)} ${(c.zombieKill.toFixed(1)+'%').padStart(12)} ${(c.collateral.toFixed(1)+'%').padStart(12)}  ${c.netBenefit.toFixed(1).padStart(11)}`);
}

// ── Best combo P&L projection ──
const best2 = combos[0];
console.log(`\n  ── BEST COMBO: ${best2.featA} (${best2.dirA}) | ${best2.featB} (${best2.dirB}) ──`);
console.log(`  Thresholds: ${best2.featA}=${best2.ta?.toFixed(2)} | ${best2.featB}=${best2.tb?.toFixed(2)}`);
console.log(`  Zombies filtered: ${best2.fz} of ${zombies.length} (${best2.zombieKill.toFixed(1)}%)`);
console.log(`  Good trades filtered: ${best2.fn} of ${normals.length} (${best2.collateral.toFixed(1)}%)`);

// Project new portfolio stats after applying filter
const kept = allTrades.filter(t => {
  const passA = best2.dirA==='higher' ? t[best2.featA] >= best2.ta : t[best2.featA] <= best2.ta;
  const passB = best2.dirB==='higher' ? t[best2.featB] >= best2.tb : t[best2.featB] <= best2.tb;
  return !(passA || passB); // keep trades NOT flagged
});
const removed = allTrades.filter(t => {
  const passA = best2.dirA==='higher' ? t[best2.featA] >= best2.ta : t[best2.featA] <= best2.ta;
  const passB = best2.dirB==='higher' ? t[best2.featB] >= best2.tb : t[best2.featB] <= best2.tb;
  return passA || passB;
});

const baseline_avg = allTrades.reduce((s,t)=>s+t.pnl,0)/allTrades.length;
const baseline_wr  = allTrades.filter(t=>t.pnl>0).length/allTrades.length*100;
const kept_avg     = kept.reduce((s,t)=>s+t.pnl,0)/(kept.length||1);
const kept_wr      = kept.filter(t=>t.pnl>0).length/(kept.length||1)*100;

console.log(`\n  Portfolio projection:`);
console.log(`  ${''.padEnd(22)} ${'Trades'.padStart(8)} ${'WR%'.padStart(8)} ${'AvgP&L%'.padStart(10)}`);
console.log('  '+sep);
console.log(`  ${'BEFORE filter'.padEnd(22)} ${String(allTrades.length).padStart(8)} ${baseline_wr.toFixed(1).padStart(7)}% ${(fmt(baseline_avg)).padStart(10)}`);
console.log(`  ${'AFTER filter'.padEnd(22)} ${String(kept.length).padStart(8)} ${kept_wr.toFixed(1).padStart(7)}% ${(fmt(kept_avg)).padStart(10)}`);
console.log(`  ${'Removed trades'.padEnd(22)} ${String(removed.length).padStart(8)}`);
console.log(`    Removed avg P&L: ${fmt(removed.reduce((s,t)=>s+t.pnl,0)/(removed.length||1))} (these are the signals we're cutting)`);
console.log(`    Of removed: ${removed.filter(t=>t.isZombie).length} zombies + ${removed.filter(t=>!t.isZombie).length} good trades`);

// ── Also show best SINGLE feature result for comparison ──
console.log(`\n  ── Best SINGLE feature for comparison ──`);
const bestSingle = paretoResults.sort((a,b)=>b.netBenefit-a.netBenefit)[0];
if(bestSingle){
  const keptS = allTrades.filter(t => {
    return !(bestSingle.direction==='higher' ? t[bestSingle.feat] >= bestSingle.threshold : t[bestSingle.feat] <= bestSingle.threshold);
  });
  const sAvg = keptS.reduce((s,t)=>s+t.pnl,0)/(keptS.length||1);
  const sWR  = keptS.filter(t=>t.pnl>0).length/(keptS.length||1)*100;
  console.log(`  Best single: ${bestSingle.feat} (${bestSingle.direction}) ≥ ${bestSingle.threshold.toFixed(2)}`);
  console.log(`    Zombie kill: ${bestSingle.zombieKill.toFixed(1)}%  Collateral: ${bestSingle.collateral.toFixed(1)}%`);
  console.log(`    After filter: n=${keptS.length}  WR=${sWR.toFixed(1)}%  avgP&L=${fmt(sAvg)}`);
}

// ── Show what the removed trades look like ──
console.log(`\n  ── Removed trade stats breakdown ──`);
const removedZombie  = removed.filter(t=>t.isZombie);
const removedNormal  = removed.filter(t=>!t.isZombie);
const keptZombie     = kept.filter(t=>t.isZombie);
const keptNormal     = kept.filter(t=>!t.isZombie);
console.log(`  Removed zombies:  n=${removedZombie.length}  avg P&L=${fmt(removedZombie.reduce((s,t)=>s+t.pnl,0)/(removedZombie.length||1))}`);
console.log(`  Removed normals:  n=${removedNormal.length}  avg P&L=${fmt(removedNormal.reduce((s,t)=>s+t.pnl,0)/(removedNormal.length||1))}`);
console.log(`  Kept zombies:     n=${keptZombie.length}   avg P&L=${fmt(keptZombie.reduce((s,t)=>s+t.pnl,0)/(keptZombie.length||1))}`);
console.log(`  Kept normals:     n=${keptNormal.length}  avg P&L=${fmt(keptNormal.reduce((s,t)=>s+t.pnl,0)/(keptNormal.length||1))}`);

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY TABLE
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${DSep}`);
console.log('  FINAL RECOMMENDATIONS');
console.log(`${DSep}\n`);

console.log('  Top features by discriminating power (AUC):');
for(const s of featureStats.slice(0,5)){
  const pct = ((s.auc-0.5)*200).toFixed(0);
  console.log(`  ${s.feat.padEnd(22)} AUC=${s.auc.toFixed(3)}  (${s.direction} values → zombie)  zombie avg=${s.zMean.toFixed(2)}  normal avg=${s.nMean.toFixed(2)}`);
}

console.log(`\n  Best 2-feature filter combo: ${best2.featA} | ${best2.featB}`);
console.log(`  → Filter if ${best2.dirA==='higher'?'≥':'≤'} ${best2.ta?.toFixed(2)} OR ${best2.dirB==='higher'?'≥':'≤'} ${best2.tb?.toFixed(2)}`);
console.log(`  → Kills ${best2.zombieKill.toFixed(1)}% of zombies, loses ${best2.collateral.toFixed(1)}% of good trades`);
console.log(`  → Projected avg P&L: ${fmt(kept_avg)} (was ${fmt(baseline_avg)}, delta=${fmt(kept_avg-baseline_avg)})`);
console.log(`  → Projected WR: ${kept_wr.toFixed(1)}% (was ${baseline_wr.toFixed(1)}%)`);

console.log('\n  Implementation: add these as entry-level gates in stockEngine.ts');
console.log('  They fire BEFORE the trade is emitted, unlike autoValidator gates.');
console.log('\n═══ ZOMBIE FILTER COMPLETE ═══\n');
