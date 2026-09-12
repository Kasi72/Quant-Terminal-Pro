'use strict';
/**
 * UC Enhanced DNA Miner v2
 * Mines ALL stored Brain V2 features + Bayesian WR join + categorical analysis
 * for >5% precision maximization.
 *
 * NEW vs original uc_candle_dna.js:
 *   - Queries inflection_score, confluence_score, stage, morph_type, market_regime
 *     (stored but never analysed before)
 *   - Joins archetype_bayes_wr (Bayesian posterior WR per stage) → bayesWR column
 *   - Categorical breakdown: stage × outcome, morph_type × outcome, regime × outcome
 *   - 3-feature triplet search (--triplets flag)
 *   - Reports combined composite score recommendation
 *
 * Usage:
 *   node scripts/uc_enhanced_dna.js
 *   node scripts/uc_enhanced_dna.js --target=5pct --triplets
 *   node scripts/uc_enhanced_dna.js --target=uc --min-recall=0.10
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ROOT       = path.join(__dirname, '..');
const RESULT_DIR = path.join(ROOT, 'scripts', 'results');
if (!fs.existsSync(RESULT_DIR)) fs.mkdirSync(RESULT_DIR, { recursive: true });

const MIN_RECALL   = parseFloat(process.argv.find(a => a.startsWith('--min-recall='))?.split('=')[1] ?? '0.10');
const RUN_TRIPLETS = process.argv.includes('--triplets');
const TARGET       = (process.argv.find(a => a.startsWith('--target='))?.split('=')[1] ?? '5pct');

const TARGET_CONFIGS = {
  uc:       { label: 'UC next day',        isPos: r => r.hit_uc_next_day === true,    needsCol: 'hit_uc_next_day' },
  '5pct':   { label: '>5% gain next day',  isPos: r => typeof r.next_day_chg_pct === 'number' && r.next_day_chg_pct >= 5,  needsCol: 'next_day_chg_pct' },
  '10pct':  { label: '>10% gain next day', isPos: r => typeof r.next_day_chg_pct === 'number' && r.next_day_chg_pct >= 10, needsCol: 'next_day_chg_pct' },
  '5pct_3d':{ label: '>5% within 3 days',  isPos: r => r.hit_5pct_3d === true,        needsCol: 'hit_5pct_3d' },
};
if (!TARGET_CONFIGS[TARGET]) { console.error(`Unknown --target. Valid: uc, 5pct, 10pct, 5pct_3d`); process.exit(1); }
const TC = TARGET_CONFIGS[TARGET];

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error('[ERROR] Missing Supabase creds'); process.exit(1); }

// ── HTTP helper ────────────────────────────────────────────────────────────────

function sbGet(urlPath) {
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(`${SUPA_URL}/rest/v1/${urlPath}`), {
      headers: {
        apikey: SUPA_KEY,
        authorization: `Bearer ${SUPA_KEY}`,
        accept: 'application/json',
        'accept-profile': 'public',
      },
    }, r => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error(`JSON parse error: ${d.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchAll(baseQuery) {
  let all = [], page = 0;
  while (true) {
    const rows = await sbGet(`${baseQuery}&limit=1000&offset=${page * 1000}`);
    if (!Array.isArray(rows) || rows.length === 0) break;
    all = all.concat(rows);
    if (rows.length < 1000) break;
    page++;
  }
  return all;
}

// ── Stats helpers ──────────────────────────────────────────────────────────────

const mean = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
}
function cohensD(a, b) {
  if (a.length < 3 || b.length < 3) return 0;
  const vA = std(a) ** 2, vB = std(b) ** 2;
  const pooled = Math.sqrt((vA * a.length + vB * b.length) / (a.length + b.length)) || 1;
  return (mean(a) - mean(b)) / pooled;
}
const pct  = (n, d) => d > 0 ? (n / d * 100).toFixed(1) + '%' : '-';
const f2   = v => (typeof v === 'number' ? v.toFixed(2) : '-');
const f1   = v => (typeof v === 'number' ? v.toFixed(1) : '-');

function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

// ── Feature definitions (ALL stored Brain V2 features) ─────────────────────────

const FEATURES = [
  // Original candle DNA features
  { key: 'close_loc',      label: 'CloseLoc%',       dir: 'high', desc: 'Close position in day range (high=near HOD)' },
  { key: 'body_pct',       label: 'BodyPct%',         dir: 'high', desc: 'Candle body % of range (strong body = continuation)' },
  { key: 'upper_wick_pct', label: 'UpperWick%',       dir: 'low',  desc: 'Upper wick % (low=no top rejection)' },
  { key: 'vol_ratio_20',   label: 'VolRatio20',       dir: 'mid',  desc: 'Volume vs 20D avg (sweet spot 1.5-4x)' },
  { key: 'vol_pre5',       label: 'VolPre5',          dir: 'high', desc: 'Volume acceleration vs prior 5D' },
  { key: 'range_atr',      label: 'RangeATR',         dir: 'low',  desc: 'Day range / ATR (low=compression)' },
  { key: 'rsi2',           label: 'RSI2',             dir: 'high', desc: 'RSI(2) momentum' },
  { key: 'rsi2_velocity',  label: 'RSI2vel',          dir: 'high', desc: 'RSI(2) acceleration (velocity)' },
  { key: 'cl_trend',       label: 'CLtrend',          dir: 'high', desc: 'Close trend score' },
  { key: 'zone_tightness', label: 'ZoneTight',        dir: 'high', desc: 'Consolidation zone tightness' },
  { key: 'dd52wh',         label: 'DD52wHigh%',       dir: 'low',  desc: '% below 52W high (low=near highs)' },
  { key: 'uc_score',       label: 'UCscore',          dir: 'high', desc: 'Composite UC score (0-100)' },
  { key: 'day_chg_pct',    label: 'DayChg%',          dir: 'mid',  desc: 'Day change % (contaminated for UC target, valid for 5pct)' },
  { key: 'conviction',     label: 'Conviction',       dir: 'high', desc: 'Brain conviction score' },
  // NEW features (stored but never mined before)
  { key: 'inflection_score',          label: 'InflectionScore',    dir: 'high', desc: 'Brain V2 inflection score — quality of setup geometry' },
  { key: 'confluence_score',          label: 'ConfluenceScore',    dir: 'high', desc: 'Multi-signal confluence count (more signals = higher score)' },
  { key: 'bayesWR',                   label: 'BayesianWR(stage)',  dir: 'high', desc: 'Stage-matched Bayesian posterior WR (from archetype_bayes_wr table)' },
  // Migration 014 — ML + screener signals
  { key: 'xgb_score',                 label: 'XGBscore',           dir: 'high', desc: 'XGBoost P(hit_t1) 0-1 — ML model output' },
  { key: 'candle_dna_score',          label: 'CandleDNA',          dir: 'high', desc: 'CandleDNA composite score 0-100' },
  { key: 'near_breakout_pct',         label: 'NearBrkPct',         dir: 'low',  desc: '% distance from breakout resistance (low=imminent)' },
  { key: 'bayes_wr',                  label: 'BayesWR(archetype)', dir: 'high', desc: 'Archetype Bayesian WR stored at scan (correct join)' },
  { key: 'stats_score',               label: 'StatsScore',         dir: 'high', desc: 'Statistical composite 0-100 (Hurst/Sharpe/CCI/VolZ)' },
  { key: 'momentum_score',            label: 'MomentumScore',      dir: 'high', desc: 'Momentum composite 0-100' },
  { key: 'rs_nifty20',                label: 'RSNifty20',          dir: 'high', desc: 'Relative strength vs Nifty 20D (>1.05=outperforming)' },
  { key: 'volatility_expansion_ratio',label: 'VolExpRatio',        dir: 'high', desc: 'Current range / ATR14 (expansion after compression)' },
  { key: 'ultra_precision_score',     label: 'UltraPrecision',     dir: 'high', desc: 'UPS composite precision score' },
];

// ── Categorical features (separate analysis) ───────────────────────────────────

const CATEGORICAL_FEATURES = [
  { key: 'stage',        label: 'Stage',       desc: 'Brain V2 archetype stage classification' },
  { key: 'morph_type',   label: 'MorphType',   desc: 'Candle morphology type' },
  { key: 'market_regime',label: 'MarketRegime', desc: 'Market regime at scan date' },
  { key: 'uc_goldmine',      label: 'UCGoldmine',     desc: 'UC Goldmine tier flag' },
  { key: 'uc_elite',        label: 'UCElite',        desc: 'UC Elite tier flag' },
  { key: 'uc_strong',       label: 'UCStrong',       desc: 'UC Strong tier flag' },
  // Migration 014 categoricals
  { key: 'archetype_type',  label: 'ArchetypeType',  desc: 'VolumeFootprint/CompressionCoil/MomentumPocket/EMAStack/PerfectStorm' },
  { key: 'near_breakout_tier', label: 'NearBrkTier', desc: 'IMMINENT/NEAR/WATCH/EARLY/null' },
  { key: 'candle_dna_tier', label: 'CandleDNATier',  desc: 'ELITE/STRONG/GOOD/WEAK' },
];

// ── Threshold sweep ────────────────────────────────────────────────────────────

function sweepThreshold(pos, neg, feat, nSteps = 60) {
  const allVals = [...pos, ...neg].filter(v => v != null && isFinite(v)).sort((a, b) => a - b);
  if (allVals.length < 10) return null;
  const min = allVals[0], max = allVals[allVals.length - 1];
  const step = (max - min) / nSteps;
  if (step <= 0) return null;
  const totalPos = pos.filter(v => v != null).length;
  let best = null;

  if (feat.dir === 'high') {
    for (let t = min; t <= max; t += step) {
      const tp = pos.filter(v => v != null && v >= t).length;
      const fp = neg.filter(v => v != null && v >= t).length;
      const total = tp + fp;
      if (total < 5) continue;
      const prec = tp / total, rec = totalPos > 0 ? tp / totalPos : 0;
      if (rec >= MIN_RECALL && (!best || prec > best.precision || (prec === best.precision && rec > best.recall))) {
        best = { threshold: t, precision: prec, recall: rec, tp, fp, total, dir: '>=' };
      }
    }
  } else if (feat.dir === 'low') {
    for (let t = min; t <= max; t += step) {
      const tp = pos.filter(v => v != null && v <= t).length;
      const fp = neg.filter(v => v != null && v <= t).length;
      const total = tp + fp;
      if (total < 5) continue;
      const prec = tp / total, rec = totalPos > 0 ? tp / totalPos : 0;
      if (rec >= MIN_RECALL && (!best || prec > best.precision || (prec === best.precision && rec > best.recall))) {
        best = { threshold: t, precision: prec, recall: rec, tp, fp, total, dir: '<=' };
      }
    }
  } else {
    for (let loP = 10; loP <= 60; loP += 10) {
      for (let hiP = loP + 20; hiP <= 90; hiP += 10) {
        const lo = percentile(allVals, loP), hi = percentile(allVals, hiP);
        const tp = pos.filter(v => v != null && v >= lo && v <= hi).length;
        const fp = neg.filter(v => v != null && v >= lo && v <= hi).length;
        const total = tp + fp;
        if (total < 5) continue;
        const prec = tp / total, rec = totalPos > 0 ? tp / totalPos : 0;
        if (rec >= MIN_RECALL && (!best || prec > best.precision)) {
          best = { threshold: lo, threshold2: hi, precision: prec, recall: rec, tp, fp, total, dir: 'band' };
        }
      }
    }
  }
  return best;
}

// ── Multi-feature combo sweep (pairs + triplets) ───────────────────────────────

function makeMatchFn(feat, bestSingle) {
  if (!bestSingle) return () => false;
  const { dir, threshold, threshold2 } = bestSingle;
  const k = feat.key;
  if (dir === '>=')   return r => r[k] != null && isFinite(r[k]) && r[k] >= threshold;
  if (dir === '<=')   return r => r[k] != null && isFinite(r[k]) && r[k] <= threshold;
  if (dir === 'band') return r => r[k] != null && isFinite(r[k]) && r[k] >= threshold && r[k] <= threshold2;
  return () => false;
}

function comboPrecision(posRows, negRows, matchFns) {
  const tp = posRows.filter(r => matchFns.every(fn => fn(r))).length;
  const fp = negRows.filter(r => matchFns.every(fn => fn(r))).length;
  const total = tp + fp;
  if (total < 5) return null;
  const prec = tp / total;
  const rec  = posRows.length > 0 ? tp / posRows.length : 0;
  if (rec < MIN_RECALL / 3) return null;
  return { prec, rec, tp, fp, total };
}

// ── Categorical analysis ────────────────────────────────────────────────────────

function analyzeCategorical(posRows, negRows, catFeat, baseRate) {
  const allRows = [...posRows.map(r => ({ ...r, _pos: true })), ...negRows.map(r => ({ ...r, _pos: false }))];
  const groups = {};
  for (const row of allRows) {
    const val = String(row[catFeat.key] ?? 'null');
    if (!groups[val]) groups[val] = { pos: 0, total: 0 };
    groups[val].total++;
    if (row._pos) groups[val].pos++;
  }

  const rows = Object.entries(groups)
    .filter(([, g]) => g.total >= 5)
    .map(([val, g]) => ({
      val,
      pos: g.pos,
      total: g.total,
      precision: g.pos / g.total,
      lift: (g.pos / g.total) / baseRate,
    }))
    .sort((a, b) => b.precision - a.precision);
  return rows;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║  UC ENHANCED DNA MINER v2 — TARGET: ${TC.label.toUpperCase().padEnd(29)}║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  // ── 1. Fetch UC logger rows ──────────────────────────────────────────────────
  console.log('Loading labeled rows from pbfb_uc_logger…');
  const all = await fetchAll(
    'pbfb_uc_logger?select=' +
    'symbol,scan_date,hit_uc_next_day,next_day_chg_pct,hit_5pct_3d,hit_10pct_5d,' +
    'close_loc,body_pct,upper_wick_pct,vol_ratio_20,vol_pre5,range_atr,' +
    'rsi2,rsi2_velocity,cl_trend,zone_tightness,dd52wh,uc_score,day_chg_pct,' +
    'conviction,inflection_score,confluence_score,' +
    'stage,morph_type,market_regime,' +
    'uc_elite,uc_strong,uc_goldmine,' +
    'xgb_score,candle_dna_score,candle_dna_tier,near_breakout_tier,near_breakout_pct,' +
    'archetype_type,bayes_wr,stats_score,momentum_score,rs_nifty20,' +
    'volatility_expansion_ratio,ultra_precision_score' +
    '&hit_uc_next_day=not.is.null&order=scan_date.asc'
  );

  if (!Array.isArray(all) || all.length === 0) {
    console.error('No labeled rows found — run label-uc-outcomes first.');
    process.exit(1);
  }

  // ── 2. Fetch Bayesian WR table ────────────────────────────────────────────────
  console.log('Loading archetype_bayes_wr table…');
  let bayesMap = {};
  try {
    const bayesRows = await sbGet('archetype_bayes_wr?select=archetype,posterior_mean&limit=1000');
    if (Array.isArray(bayesRows)) {
      for (const b of bayesRows) bayesMap[b.archetype] = b.posterior_mean;
      console.log(`  Bayesian WR table: ${bayesRows.length} archetypes loaded`);
    }
  } catch (e) {
    console.warn(`  Warning: could not load bayesian WR: ${e.message}`);
  }

  // Enrich rows with bayesWR via archetype_type (correct key) or stage fallback
  for (const r of all) {
    const key = r.archetype_type ?? r.stage;
    r.bayesWR = bayesMap[key] != null ? bayesMap[key] * 100 : null;
  }

  const labeled = all.filter(r => r[TC.needsCol] != null);
  const posRows = labeled.filter(TC.isPos);
  const negRows = labeled.filter(r => !TC.isPos(r));
  const total   = labeled.length;
  const baseRate = total > 0 ? posRows.length / total : 0;

  console.log(`\nLabeled rows: ${total.toLocaleString()} | Hits: ${posRows.length} | Non-hits: ${negRows.length}`);
  console.log(`Base rate (random precision): ${pct(posRows.length, total)} — DNA must beat this\n`);

  if (posRows.length < 10) {
    console.error(`Too few positive examples (${posRows.length}). Need ≥10.`);
    process.exit(1);
  }

  // ── 3. Feature Cohen's d + best single threshold ─────────────────────────────
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('  FEATURE IMPORTANCE (Cohen\'s d) — ALL Brain V2 features');
  console.log('════════════════════════════════════════════════════════════════════');
  console.log(`  ${'Feature'.padEnd(18)} ${'Cohen\'s d'.padStart(9)} ${'Pos median'.padStart(11)} ${'Neg median'.padStart(11)} ${'Best precision'.padStart(15)} ${'Recall'.padStart(8)}`);
  console.log('  ' + '─'.repeat(78));

  const singles = [];
  for (const feat of FEATURES) {
    const posVals = posRows.map(r => r[feat.key]).filter(v => v != null && isFinite(+v)).map(Number);
    const negVals = negRows.map(r => r[feat.key]).filter(v => v != null && isFinite(+v)).map(Number);
    const d = cohensD(posVals, negVals);
    const posMedian = posVals.length ? percentile([...posVals].sort((a,b)=>a-b), 50) : null;
    const negMedian = negVals.length ? percentile([...negVals].sort((a,b)=>a-b), 50) : null;

    posVals.sort((a,b)=>a-b); negVals.sort((a,b)=>a-b);
    const best = sweepThreshold(posVals, negVals, feat);

    singles.push({ feat, d, posMedian, negMedian, best });
    const dStr  = (Math.abs(d) < 0.2 ? '~0' : (d > 0 ? '+' : '') + d.toFixed(3)).padStart(9);
    const precStr = best ? pct(best.tp, best.total).padStart(15) : '       —      ';
    const recStr  = best ? pct(best.tp, posRows.length).padStart(8) : '      —';
    const pMed = posMedian != null ? f1(posMedian).padStart(11) : '          —';
    const nMed = negMedian != null ? f1(negMedian).padStart(11) : '          —';
    console.log(`  ${feat.label.padEnd(18)} ${dStr} ${pMed} ${nMed} ${precStr} ${recStr}`);
  }

  // ── 4. Top single-feature rules ───────────────────────────────────────────────
  const ranked = singles.filter(s => s.best).sort((a, b) => b.best.precision - a.best.precision);
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  TOP SINGLE-FEATURE RULES (ranked by precision @ min recall ' + (MIN_RECALL*100).toFixed(0) + '%)');
  console.log('════════════════════════════════════════════════════════════════════');
  let rank = 1;
  for (const s of ranked.slice(0, 12)) {
    const b = s.best;
    const liftX = (b.precision / baseRate).toFixed(1) + 'x';
    const ruleStr = b.dir === 'band'
      ? `${s.feat.label} ${f1(b.threshold)} – ${f1(b.threshold2)}`
      : `${s.feat.label} ${b.dir} ${f2(b.threshold)}`;
    console.log(`  #${String(rank++).padEnd(3)} ${ruleStr.padEnd(36)} prec=${pct(b.tp, b.total).padStart(6)} rec=${pct(b.tp, posRows.length).padStart(6)} (${b.tp}/${b.total}) lift=${liftX}`);
  }

  // ── 5. Categorical analysis ───────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  CATEGORICAL FEATURE ANALYSIS');
  console.log('════════════════════════════════════════════════════════════════════');

  for (const cat of CATEGORICAL_FEATURES) {
    const groups = analyzeCategorical(posRows, negRows, cat, baseRate);
    if (groups.length === 0) { console.log(`\n  ${cat.label}: no data`); continue; }
    console.log(`\n  ${cat.label} (${cat.desc}):`);
    console.log(`  ${'Value'.padEnd(30)} ${'Hits'.padStart(5)} ${'Total'.padStart(7)} ${'Precision'.padStart(10)} ${'Lift'.padStart(7)}`);
    for (const g of groups.slice(0, 10)) {
      const bar = '▓'.repeat(Math.min(20, Math.round(g.lift * 5)));
      console.log(`  ${String(g.val).slice(0, 30).padEnd(30)} ${String(g.pos).padStart(5)} ${String(g.total).padStart(7)} ${pct(g.pos, g.total).padStart(10)} ${(g.lift.toFixed(1) + 'x').padStart(7)}  ${bar}`);
    }
  }

  // ── 6. 2-Feature pair combos ──────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  TOP 2-FEATURE COMBOS (ALL stored features, sorted by precision)');
  console.log('════════════════════════════════════════════════════════════════════');

  const singlesByKey = Object.fromEntries(singles.map(s => [s.feat.key, s]));
  const pairResults = [];

  for (let i = 0; i < FEATURES.length; i++) {
    for (let j = i + 1; j < FEATURES.length; j++) {
      const sA = singlesByKey[FEATURES[i].key];
      const sB = singlesByKey[FEATURES[j].key];
      if (!sA?.best || !sB?.best) continue;
      const fnA = makeMatchFn(sA.feat, sA.best);
      const fnB = makeMatchFn(sB.feat, sB.best);
      const res = comboPrecision(posRows, negRows, [fnA, fnB]);
      if (!res) continue;
      pairResults.push({ fA: FEATURES[i], fB: FEATURES[j], sA: sA.best, sB: sB.best, ...res });
    }
  }

  pairResults.sort((a, b) => b.prec - a.prec);
  let pr = 1;
  for (const p of pairResults.slice(0, 15)) {
    const rA = p.sA.dir === 'band' ? `${p.fA.label} ${f1(p.sA.threshold)}-${f1(p.sA.threshold2)}` : `${p.fA.label}${p.sA.dir}${f2(p.sA.threshold)}`;
    const rB = p.sB.dir === 'band' ? `${p.fB.label} ${f1(p.sB.threshold)}-${f1(p.sB.threshold2)}` : `${p.fB.label}${p.sB.dir}${f2(p.sB.threshold)}`;
    const liftX = (p.prec / baseRate).toFixed(1) + 'x';
    console.log(`  #${String(pr++).padEnd(3)} ${(rA + ' AND ' + rB).padEnd(60)} prec=${pct(p.tp, p.total).padStart(6)} rec=${pct(p.tp, posRows.length).padStart(6)} (${p.tp}/${p.total}) lift=${liftX}`);
  }

  // ── 7. 3-Feature triplet combos (optional) ─────────────────────────────────────
  if (RUN_TRIPLETS) {
    console.log('\n════════════════════════════════════════════════════════════════════');
    console.log('  TOP 3-FEATURE TRIPLETS (this may take a moment)');
    console.log('════════════════════════════════════════════════════════════════════');
    const tripletResults = [];

    for (let i = 0; i < FEATURES.length; i++) {
      for (let j = i + 1; j < FEATURES.length; j++) {
        for (let k = j + 1; k < FEATURES.length; k++) {
          const sA = singlesByKey[FEATURES[i].key];
          const sB = singlesByKey[FEATURES[j].key];
          const sC = singlesByKey[FEATURES[k].key];
          if (!sA?.best || !sB?.best || !sC?.best) continue;
          const fnA = makeMatchFn(sA.feat, sA.best);
          const fnB = makeMatchFn(sB.feat, sB.best);
          const fnC = makeMatchFn(sC.feat, sC.best);
          const res = comboPrecision(posRows, negRows, [fnA, fnB, fnC]);
          if (!res) continue;
          tripletResults.push({ fA: FEATURES[i], fB: FEATURES[j], fC: FEATURES[k], sA: sA.best, sB: sB.best, sC: sC.best, ...res });
        }
      }
    }

    tripletResults.sort((a, b) => b.prec - a.prec);
    let tr = 1;
    for (const t of tripletResults.slice(0, 10)) {
      const rA = t.sA.dir === 'band' ? `${t.fA.label} ${f1(t.sA.threshold)}-${f1(t.sA.threshold2)}` : `${t.fA.label}${t.sA.dir}${f2(t.sA.threshold)}`;
      const rB = t.sB.dir === 'band' ? `${t.fB.label} ${f1(t.sB.threshold)}-${f1(t.sB.threshold2)}` : `${t.fB.label}${t.sB.dir}${f2(t.sB.threshold)}`;
      const rC = t.sC.dir === 'band' ? `${t.fC.label} ${f1(t.sC.threshold)}-${f1(t.sC.threshold2)}` : `${t.fC.label}${t.sC.dir}${f2(t.sC.threshold)}`;
      const liftX = (t.prec / baseRate).toFixed(1) + 'x';
      console.log(`  #${String(tr++).padEnd(3)} ${rA} + ${rB} + ${rC}`);
      console.log(`       prec=${pct(t.tp, t.total)} rec=${pct(t.tp, posRows.length)} (${t.tp}/${t.total}) lift=${liftX}\n`);
    }
  }

  // ── 8. Stage × BayesWR analysis ───────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  STAGE × BAYESIAN WR CORRELATION ANALYSIS');
  console.log('════════════════════════════════════════════════════════════════════');
  const stageGroups = analyzeCategorical(posRows, negRows, { key: 'stage' }, baseRate);
  const bayesEntries = Object.entries(bayesMap).sort((a, b) => b[1] - a[1]);

  console.log('\n  Top stages by Bayesian posterior WR (from archetype_bayes_wr):');
  for (const [arch, wr] of bayesEntries.slice(0, 10)) {
    const matchStage = stageGroups.find(g => g.val === arch);
    const precStr = matchStage ? pct(matchStage.pos, matchStage.total).padStart(8) : '       —';
    const cntStr  = matchStage ? `n=${matchStage.total}` : '';
    console.log(`  ${arch.padEnd(30)} BayesWR=${(wr*100).toFixed(1).padStart(5)}%  5pct-precision=${precStr}  ${cntStr}`);
  }

  // ── 9. Key new insight: InflectionScore + ConfluenceScore breakdown ────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  INFLECTION SCORE + CONFLUENCE SCORE TIER ANALYSIS');
  console.log('════════════════════════════════════════════════════════════════════');

  // Tier inflection_score into buckets
  const inflBuckets = [[0,30],[30,50],[50,70],[70,85],[85,100]];
  console.log('\n  InflectionScore tiers:');
  console.log(`  ${'Tier'.padEnd(12)} ${'Hits'.padStart(5)} ${'Total'.padStart(7)} ${'Precision'.padStart(10)} ${'Lift'.padStart(6)}`);
  for (const [lo, hi] of inflBuckets) {
    const p = posRows.filter(r => r.inflection_score != null && r.inflection_score >= lo && r.inflection_score < hi).length;
    const n = negRows.filter(r => r.inflection_score != null && r.inflection_score >= lo && r.inflection_score < hi).length;
    const tot = p + n;
    if (tot < 3) continue;
    const lift = baseRate > 0 ? ((p / tot) / baseRate) : 0;
    console.log(`  ${(lo+'-'+hi).padEnd(12)} ${String(p).padStart(5)} ${String(tot).padStart(7)} ${pct(p,tot).padStart(10)} ${(lift.toFixed(1)+'x').padStart(6)}`);
  }

  const confBuckets = [[0,1],[1,2],[2,3],[3,4],[4,10]];
  console.log('\n  ConfluenceScore tiers (# simultaneous signals):');
  console.log(`  ${'Tier'.padEnd(12)} ${'Hits'.padStart(5)} ${'Total'.padStart(7)} ${'Precision'.padStart(10)} ${'Lift'.padStart(6)}`);
  for (const [lo, hi] of confBuckets) {
    const p = posRows.filter(r => r.confluence_score != null && r.confluence_score >= lo && r.confluence_score < hi).length;
    const n = negRows.filter(r => r.confluence_score != null && r.confluence_score >= lo && r.confluence_score < hi).length;
    const tot = p + n;
    if (tot < 3) continue;
    const lift = baseRate > 0 ? ((p / tot) / baseRate) : 0;
    console.log(`  ${(lo+'-'+hi).padEnd(12)} ${String(p).padStart(5)} ${String(tot).padStart(7)} ${pct(p,tot).padStart(10)} ${(lift.toFixed(1)+'x').padStart(6)}`);
  }

  // ── 10. Guppy compression status ──────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  GUPPY COMPRESSION — DATA AVAILABILITY STATUS');
  console.log('════════════════════════════════════════════════════════════════════');
  const hasGuppy = labeled.filter(r => r.guppy_spread_pct != null && r.guppy_spread_pct < 99);
  console.log(`\n  Rows with guppy_spread_pct stored: ${hasGuppy.length} / ${labeled.length}`);
  if (hasGuppy.length === 0) {
    console.log('  ⚠ Guppy columns NOT YET in database — migration 013 required.');
    console.log('  Plan: add guppy_spread_pct, guppy_compressed, guppy_ultra_compressed,');
    console.log('        guppy_compress_days, guppy_primed, guppy_coiled_release columns.');
    console.log('  Once stored, re-run this miner to get Guppy-enhanced DNA.');
  } else {
    const guppyPrecision = () => {
      const p = posRows.filter(r => r.guppy_compressed).length;
      const n = negRows.filter(r => r.guppy_compressed).length;
      return { p, tot: p + n };
    };
    const gp = guppyPrecision();
    if (gp.tot > 0) {
      console.log(`  guppy_compressed=true: prec=${pct(gp.p, gp.tot)} lift=${((gp.p/gp.tot)/baseRate).toFixed(1)}x`);
    }
  }

  // ── 11. Golden composite rule recommendation ───────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('  ENHANCED GOLDEN RULE (best multi-feature combo)');
  console.log('════════════════════════════════════════════════════════════════════');

  const bestPair = pairResults[0];
  if (bestPair) {
    const rA = bestPair.sA.dir === 'band'
      ? `${bestPair.fA.label} ${f1(bestPair.sA.threshold)}–${f1(bestPair.sA.threshold2)}`
      : `${bestPair.fA.label} ${bestPair.sA.dir} ${f2(bestPair.sA.threshold)}`;
    const rB = bestPair.sB.dir === 'band'
      ? `${bestPair.fB.label} ${f1(bestPair.sB.threshold)}–${f1(bestPair.sB.threshold2)}`
      : `${bestPair.fB.label} ${bestPair.sB.dir} ${f2(bestPair.sB.threshold)}`;
    console.log(`\n  GOLDEN PAIR: ${rA} AND ${rB}`);
    console.log(`  Precision: ${pct(bestPair.tp, bestPair.total)} | Recall: ${pct(bestPair.tp, posRows.length)} | Lift: ${(bestPair.prec/baseRate).toFixed(1)}x\n`);
  }

  console.log('  Guppy upgrade path (once migration 013 deployed):');
  console.log('  → Add guppy_compressed=true AND guppy_compress_days >= 5 to any combo');
  console.log('  → Historically Guppy max compression precedes 60-80% of monster moves\n');

  // ── 12. Save JSON ───────────────────────────────────────────────────────────────
  const outPath = path.join(RESULT_DIR, 'uc_enhanced_dna.json');
  const summary = {
    generated_at: new Date().toISOString(),
    target: TARGET,
    target_label: TC.label,
    total_labeled: total,
    pos_count: posRows.length,
    neg_count: negRows.length,
    base_rate: baseRate,
    top_singles: ranked.slice(0, 8).map(s => ({
      feature: s.feat.key,
      label: s.feat.label,
      cohens_d: s.d,
      threshold: s.best?.threshold,
      threshold2: s.best?.threshold2,
      dir: s.best?.dir,
      precision: s.best?.precision,
      recall: s.best?.recall,
    })),
    top_pairs: pairResults.slice(0, 5).map(p => ({
      fA: p.fA.key, fB: p.fB.key,
      threshA: p.sA.threshold, dirA: p.sA.dir,
      threshB: p.sB.threshold, dirB: p.sB.dir,
      precision: p.prec, recall: p.rec,
    })),
    guppy_data_available: hasGuppy.length > 0,
    bayesian_archetypes_loaded: Object.keys(bayesMap).length,
  };
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\n  JSON summary → ${outPath}`);
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  ENHANCED DNA MINING COMPLETE                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
