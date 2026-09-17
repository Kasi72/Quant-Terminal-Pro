'use strict';
/**
 * UC Runner XGBoost Trainer — pure JS, no Python needed.
 *
 * Label  : next_day_chg_pct >= 5 from pbfb_uc_logger (direct "did it go up 5% next day?")
 * Method : Gradient boosting, binary cross-entropy, Newton-Raphson leaf values (LGBM-style)
 * Output : lib/ucLoggerXgbWeights.ts  — tree JSON for ucLoggerXgbInfer.ts
 *          scripts/results/uc_logger_xgb_report.txt
 *
 * Run    : node scripts/train_uc_xgb_js.js
 * Retrain: nightly via daily_brain_trainer.js (step 5)
 */

const https  = require('https');
const fs     = require('fs');
const path   = require('path');

const ROOT       = path.join(__dirname, '..');
const RESULT_DIR = path.join(ROOT, 'scripts', 'results');

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=')).map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(),l.slice(i+1).trim()]; })
);
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

// ── Hyperparameters ──────────────────────────────────────────────────────────
const N_ESTIMATORS  = 80;   // CV showed peak test AUC ~round 50-70; cap here to avoid overfit
const MAX_DEPTH     = 3;
const LEARNING_RATE = 0.05;
const SUBSAMPLE     = 0.80;
const MIN_CHILD_W   = 4;     // minimum sum(hessian) in a leaf — prevents tiny splits
const LAMBDA        = 1.0;   // L2 regularisation on leaf weights
const N_BINS        = 80;    // histogram candidate split points per feature
const HALF_LIFE_DAYS = 90;   // sample weight decay — recent rows weighted higher

// ── Fetch ────────────────────────────────────────────────────────────────────
function sbGet(p) {
  return new Promise((res,rej)=>{
    const req=https.request(new URL(`${SUPA_URL}/rest/v1/${p}`),
      {headers:{apikey:SUPA_KEY,authorization:`Bearer ${SUPA_KEY}`,accept:'application/json'}},
      r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,200)))}})});
    req.on('error',rej);req.end();
  });
}
async function fetchAll(q) {
  let all=[],page=0;
  while(true){
    const rows=await sbGet(`${q}&limit=1000&offset=${page*1000}`);
    if(!Array.isArray(rows)||!rows.length) break;
    all=all.concat(rows);if(rows.length<1000)break;page++;
  }
  return all;
}

// ── Feature engineering ──────────────────────────────────────────────────────
const RAW_FEATURES = [
  'vol_pre5','cl_trend','inflection_score','upper_wick_pct',
  'uc_score','body_pct','close_loc','rsi2','range_atr','momentum_score',
];
const ALL_FEATURES = [
  ...RAW_FEATURES,
  'vol_quality',    // vol_pre5 * body_pct/100  — volume with body confirmation
  'clean_close',    // (100-upper_wick_pct) * close_loc/100  — rejection-free high close
  'oversold_surge', // vol_pre5 / max(rsi2, 1)  — volume while oversold (escape archetype)
  'uc_vol_gate',    // uc_score * vol_pre5 / 100  — UC quality × volume momentum
];

function buildRow(r) {
  const vp  = parseFloat(r.vol_pre5)         || 0;
  const bp  = parseFloat(r.body_pct)         || 0;
  const uwp = parseFloat(r.upper_wick_pct)   || 0;
  const cl  = parseFloat(r.close_loc)        || 0;
  const rsi = parseFloat(r.rsi2)             || 0;
  const uc  = parseFloat(r.uc_score)         || 0;
  return {
    vol_pre5:         vp,
    cl_trend:         parseFloat(r.cl_trend)         || 0,
    inflection_score: parseFloat(r.inflection_score) || 0,
    upper_wick_pct:   uwp,
    uc_score:         uc,
    body_pct:         bp,
    close_loc:        cl,
    rsi2:             rsi,
    range_atr:        parseFloat(r.range_atr)        || 0,
    momentum_score:   parseFloat(r.momentum_score)   || 0,
    vol_quality:      vp * bp / 100,
    clean_close:      (100 - uwp) * cl / 100,
    oversold_surge:   vp / Math.max(rsi, 1),
    uc_vol_gate:      uc * vp / 100,
  };
}

// ── Gradient boosting ────────────────────────────────────────────────────────
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

function computeGradHess(preds, labels, weights) {
  const g=[], h=[];
  for(let i=0;i<preds.length;i++){
    const p=sigmoid(preds[i]), w=weights[i];
    g.push((p - labels[i]) * w);
    h.push(p * (1-p) * w);
  }
  return {g, h};
}

function histSplitScore(gSum, hSum, gL, hL) {
  const gR=gSum-gL, hR=hSum-hL;
  if(hL<MIN_CHILD_W||hR<MIN_CHILD_W) return -Infinity;
  return (gL*gL/(hL+LAMBDA)) + (gR*gR/(hR+LAMBDA)) - ((gL+gR)*(gL+gR)/(hSum+LAMBDA));
}

function findBestSplit(indices, X, g, h, features, depth) {
  let bestGain=-Infinity, bestFeat=null, bestThresh=null;

  const gSum = indices.reduce((s,i)=>s+g[i],0);
  const hSum = indices.reduce((s,i)=>s+h[i],0);

  for(const feat of features){
    const vals = indices.map(i=>X[i][feat]).filter(v=>isFinite(v)).sort((a,b)=>a-b);
    if(vals.length < 2) continue;
    // Build N_BINS candidate thresholds (quantile-based)
    const step = Math.max(1, Math.floor(vals.length / N_BINS));
    const candidates = [];
    for(let k=step;k<vals.length;k+=step){
      const t=(vals[k-1]+vals[k])/2;
      if(!candidates.length||t!==candidates[candidates.length-1]) candidates.push(t);
    }
    for(const thresh of candidates){
      let gL=0, hL=0;
      for(const i of indices){
        const v=X[i][feat];
        if(isFinite(v)&&v<thresh){gL+=g[i];hL+=h[i];}
      }
      const gain=histSplitScore(gSum,hSum,gL,hL);
      if(gain>bestGain){bestGain=gain;bestFeat=feat;bestThresh=thresh;}
    }
  }
  return {bestFeat, bestThresh, bestGain};
}

function buildTree(indices, X, g, h, features, depth) {
  const gSum=indices.reduce((s,i)=>s+g[i],0);
  const hSum=indices.reduce((s,i)=>s+h[i],0);
  const leafVal = -gSum / (hSum + LAMBDA);

  if(depth>=MAX_DEPTH || indices.length<=MIN_CHILD_W*2){
    return {leaf: leafVal};
  }

  const {bestFeat, bestThresh, bestGain} = findBestSplit(indices, X, g, h, features, depth);
  if(!bestFeat || bestGain < 0.001) return {leaf: leafVal};

  const left=[], right=[], missing=[];
  for(const i of indices){
    const v=X[i][bestFeat];
    if(!isFinite(v)) missing.push(i);
    else if(v<bestThresh) left.push(i);
    else right.push(i);
  }
  // Missing values go to larger child
  const missingTarget = left.length >= right.length ? left : right;
  for(const i of missing) missingTarget.push(i);

  const leftNode  = buildTree(left.concat(missing.filter(i=>missingTarget===left)),   X,g,h,features,depth+1);
  const rightNode = buildTree(right.concat(missing.filter(i=>missingTarget===right)), X,g,h,features,depth+1);
  // For actual missing at inference time, route same as largest child
  const missingNode = left.length >= right.length ? leftNode : rightNode;

  return {split: bestFeat, split_condition: bestThresh, yes: leftNode, no: rightNode, missing: missingNode};
}

function predictTree(node, row) {
  if(node.leaf!==undefined) return node.leaf;
  const v=row[node.split];
  const next=(!isFinite(v)||v===null||v===undefined)?node.missing:(v<node.split_condition?node.yes:node.no);
  return predictTree(next,row);
}

function auc(probs, labels) {
  const pairs=probs.map((p,i)=>({p,l:labels[i]})).sort((a,b)=>b.p-a.p);
  const pos=labels.filter(Boolean).length, neg=labels.length-pos;
  if(!pos||!neg) return 0.5;
  let tp=0,fp=0,prevTp=0,prevFp=0,area=0;
  for(const {p,l} of pairs){
    if(l) tp++; else fp++;
    if(fp!==prevFp){
      area+=(fp-prevFp)*(tp+prevTp)/2;
      prevTp=tp;prevFp=fp;
    }
  }
  area+=(neg-prevFp)*(pos+prevTp)/2;
  return area/(pos*neg);
}

function sampleIndices(n, rate) {
  const k=Math.round(n*rate), idx=[];
  const pool=[...Array(n).keys()];
  for(let i=0;i<k;i++){
    const r=Math.floor(Math.random()*(pool.length-i))+i;
    [pool[i],pool[r]]=[pool[r],pool[i]];
    idx.push(pool[i]);
  }
  return idx.sort((a,b)=>a-b);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  UC Logger XGBoost Trainer — pure JS                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const cols = RAW_FEATURES.join(',');
  const allRows = await fetchAll(
    `pbfb_uc_logger?select=scan_date,next_day_chg_pct,${cols}` +
    `&next_day_chg_pct=not.is.null&order=scan_date.asc`
  );
  console.log(`Labeled rows: ${allRows.length}`);

  // Build feature matrix and labels
  const X      = allRows.map(buildRow);
  const Y      = allRows.map(r => r.next_day_chg_pct >= 5 ? 1 : 0);
  const dates  = allRows.map(r => r.scan_date);
  const N      = X.length;
  const posN   = Y.filter(Boolean).length;
  const posRate = posN / N;

  console.log(`Positives (≥5%): ${posN}/${N}  (${(posRate*100).toFixed(1)}% base rate)`);
  if(posN < 30){ console.log('Need ≥30 positives. Exiting.'); return; }

  // Sample weights: exponential decay by recency (HALF_LIFE_DAYS)
  const latestDate = dates[dates.length-1];
  const latestMs   = new Date(latestDate).getTime();
  const sampleWeights = dates.map(d => {
    const ageDays = (latestMs - new Date(d).getTime()) / 86400000;
    return Math.exp(-ageDays / HALF_LIFE_DAYS);
  });

  // Scale-pos-weight: upweight positives to correct class imbalance
  const posWeight  = (N - posN) / posN;
  const adjWeights = Y.map((y,i) => sampleWeights[i] * (y ? posWeight : 1));

  console.log(`scale_pos_weight: ${posWeight.toFixed(1)}x`);

  // ── Walk-forward CV (3 folds) ──────────────────────────────────────────────
  console.log('\n── Walk-forward cross-validation ──');
  const folds = 3;
  const foldSize = Math.floor(N / (folds + 1));
  const cvAucs = [];

  for(let fold=0;fold<folds;fold++){
    const trainEnd = foldSize * (fold + 1);
    const valEnd   = Math.min(trainEnd + foldSize, N);
    const trainIdx = [...Array(trainEnd).keys()];
    const valIdx   = [];
    for(let i=trainEnd;i<valEnd;i++) valIdx.push(i);
    if(valIdx.filter(i=>Y[i]).length < 3) continue;

    const preds = new Float64Array(N).fill(Math.log(posRate/(1-posRate)));
    const treesCv = [];
    for(let t=0;t<Math.min(N_ESTIMATORS,80);t++){
      const sub = sampleIndices(trainIdx.length, SUBSAMPLE).map(i=>trainIdx[i]);
      const {g,h} = computeGradHess(Array.from(preds), Y, adjWeights);
      const tree  = buildTree(sub, X, g, h, ALL_FEATURES, 0);
      treesCv.push(tree);
      for(const i of trainIdx) preds[i] += LEARNING_RATE * predictTree(tree, X[i]);
    }
    const valProbs = valIdx.map(i => sigmoid(preds[i]));
    const valLabels = valIdx.map(i => Y[i]);
    const foldAuc = auc(valProbs, valLabels);
    cvAucs.push(foldAuc);
    console.log(`  Fold ${fold+1}: train=${trainEnd} val=${valIdx.length} (${valLabels.filter(Boolean).length}+) AUC=${foldAuc.toFixed(4)}`);
  }
  if(cvAucs.length) console.log(`  Mean CV AUC: ${(cvAucs.reduce((a,b)=>a+b)/cvAucs.length).toFixed(4)}`);

  // ── Full training on 80%, test on last 20% ────────────────────────────────
  // Note: 125 positives in 3889 rows means any val subset is too small for reliable
  // early stopping. CV AUC above guides round selection. Cap at N_ESTIMATORS.
  console.log('\n── Full training ──');
  const splitAt  = Math.floor(N * 0.80);
  const trainIdx = [...Array(splitAt).keys()];
  const testIdx  = [];  for(let i=splitAt;i<N;i++) testIdx.push(i);

  console.log(`  train=${trainIdx.length}(${trainIdx.filter(i=>Y[i]).length}+)  test=${testIdx.length}(${testIdx.filter(i=>Y[i]).length}+)`);

  const baseScore = posRate;
  const baseLogit = Math.log(posRate / (1 - posRate));
  const preds     = new Float64Array(N).fill(baseLogit);
  const trees     = [];

  for(let t=0;t<N_ESTIMATORS;t++){
    const sub = sampleIndices(trainIdx.length, SUBSAMPLE).map(i=>trainIdx[i]);
    const {g,h} = computeGradHess(Array.from(preds), Y, adjWeights);
    const tree  = buildTree(sub, X, g, h, ALL_FEATURES, 0);
    trees.push(tree);
    for(const i of trainIdx) preds[i] += LEARNING_RATE * predictTree(tree, X[i]);
    for(const i of testIdx)  preds[i] += LEARNING_RATE * predictTree(tree, X[i]);
    if((t+1) % 25 === 0){
      const ta = auc(testIdx.map(i=>sigmoid(preds[i])), testIdx.map(i=>Y[i]));
      console.log(`  Round ${t+1}/${N_ESTIMATORS}: test AUC=${ta.toFixed(4)}`);
    }
  }

  const testProbs  = testIdx.map(i=>sigmoid(preds[i]));
  const testLabels = testIdx.map(i=>Y[i]);
  const testAuc    = auc(testProbs, testLabels);
  console.log(`\n  Final test AUC: ${testAuc.toFixed(4)}`);

  // ── Precision@top-decile ──────────────────────────────────────────────────
  const sortedByScore = testIdx.map(i=>({p:sigmoid(preds[i]),y:Y[i]})).sort((a,b)=>b.p-a.p);
  const topK = Math.max(1, Math.round(testIdx.length * 0.10));
  const topKPrec = sortedByScore.slice(0,topK).filter(r=>r.y).length / topK;
  console.log(`  Prec@top-10%:   ${(topKPrec*100).toFixed(1)}%  (N=${topK})`);

  // ── Feature importance (gain-based) ──────────────────────────────────────
  const importance = {};
  ALL_FEATURES.forEach(f=>importance[f]=0);
  function accGain(node, depth=0) {
    if(node.leaf!==undefined) return;
    importance[node.split] = (importance[node.split]||0) + 1;
    accGain(node.yes,depth+1); accGain(node.no,depth+1);
  }
  trees.forEach(t=>accGain(t));
  const sortedImp = Object.entries(importance).sort((a,b)=>b[1]-a[1]);
  console.log('\n── Feature importance (split count) ──');
  sortedImp.forEach(([f,v])=>console.log(`  ${f.padEnd(20)} ${v}`));

  // ── Save TypeScript weights ───────────────────────────────────────────────
  const out = {
    generated:      new Date().toISOString(),
    label:          'next_day_chg_pct >= 5',
    source_table:   'pbfb_uc_logger',
    n_train:        splitAt,
    n_test:         testIdx.length,
    pos_rate:       posRate,
    test_auc:       testAuc,
    cv_mean_auc:    cvAucs.length ? cvAucs.reduce((a,b)=>a+b)/cvAucs.length : null,
    prec_top10pct:  topKPrec,
    base_score:     baseScore,
    learning_rate:  LEARNING_RATE,
    n_estimators:   N_ESTIMATORS,
    feature_names:  ALL_FEATURES,
    trees,
  };

  const tsContent =
    `// Auto-generated by scripts/train_uc_xgb_js.js — do not edit manually.\n` +
    `// Label: next_day_chg_pct >= 5 from pbfb_uc_logger\n` +
    `// Generated: ${out.generated} | n_train: ${out.n_train} | test_auc: ${testAuc.toFixed(4)}\n` +
    `export const UC_LOGGER_XGB_MODEL_JSON = ${JSON.stringify(out)} as const;\n`;

  const weightsPath = path.join(ROOT, 'lib', 'ucLoggerXgbWeights.ts');
  fs.writeFileSync(weightsPath, tsContent, 'utf8');
  console.log(`\n  lib/ucLoggerXgbWeights.ts written`);

  // Also write raw JSON — used by daily_brain_trainer watchlist builder (pure JS, no TS transpile)
  const jsonModelPath = path.join(RESULT_DIR, 'uc_logger_xgb_model.json');
  fs.writeFileSync(jsonModelPath, JSON.stringify(out), 'utf8');
  console.log(`  scripts/results/uc_logger_xgb_model.json written`);

  // ── Save text report ──────────────────────────────────────────────────────
  const report = [
    `UC Logger XGBoost — ${out.generated}`,
    `N=${N}  pos=${posN} (${(posRate*100).toFixed(1)}%)  train=${splitAt}  test=${testIdx.length}`,
    `CV AUC: ${cvAucs.map(a=>a.toFixed(4)).join(' | ')}  mean=${out.cv_mean_auc?.toFixed(4)}`,
    `Test AUC: ${testAuc.toFixed(4)}  Prec@top10%: ${(topKPrec*100).toFixed(1)}%`,
    `Features: ${ALL_FEATURES.join(', ')}`,
    `Top features: ${sortedImp.slice(0,5).map(([f,v])=>`${f}(${v})`).join(', ')}`,
  ].join('\n');
  fs.writeFileSync(path.join(RESULT_DIR, 'uc_logger_xgb_report.txt'), report, 'utf8');
  console.log(`  scripts/results/uc_logger_xgb_report.txt written\n`);

  return out;
}

module.exports = { main };
if(require.main===module) main().catch(e=>{console.error(e.message);process.exit(1);});
