'use strict';
/**
 * UC Candle DNA Miner
 * Mines pbfb_uc_logger for the exact candle fingerprint that maximises
 * hit precision for a configurable outcome target.
 *
 * Targets (--target=<name>):
 *   uc        hit_uc_next_day = true          (default)
 *   5pct      next_day_chg_pct >= 5           (>5% gain next day)
 *   10pct     next_day_chg_pct >= 10
 *   5pct_3d   hit_5pct_3d = true
 *
 * Usage:
 *   node scripts/uc_candle_dna.js --target=5pct
 *   node scripts/uc_candle_dna.js --target=5pct --min-recall=0.10
 *   node scripts/uc_candle_dna.js --target=5pct --pairs
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ROOT      = path.join(__dirname, '..');
const RESULT_DIR = path.join(ROOT, 'scripts', 'results');
if (!fs.existsSync(RESULT_DIR)) fs.mkdirSync(RESULT_DIR, { recursive: true });

const MIN_RECALL = parseFloat(process.argv.find(a => a.startsWith('--min-recall='))?.split('=')[1] ?? '0.15');
const RUN_PAIRS  = process.argv.includes('--pairs');
const TARGET     = (process.argv.find(a => a.startsWith('--target='))?.split('=')[1] ?? 'uc');

const TARGET_CONFIGS = {
  uc:       { label: 'UC next day',        isPos: r => r.hit_uc_next_day === true,    needsCol: 'hit_uc_next_day' },
  '5pct':   { label: '>5% gain next day',  isPos: r => typeof r.next_day_chg_pct === 'number' && r.next_day_chg_pct >= 5,  needsCol: 'next_day_chg_pct' },
  '10pct':  { label: '>10% gain next day', isPos: r => typeof r.next_day_chg_pct === 'number' && r.next_day_chg_pct >= 10, needsCol: 'next_day_chg_pct' },
  '5pct_3d':{ label: '>5% within 3 days',  isPos: r => r.hit_5pct_3d === true,        needsCol: 'hit_5pct_3d' },
};
if (!TARGET_CONFIGS[TARGET]) { console.error(`Unknown --target=${TARGET}. Valid: uc, 5pct, 10pct, 5pct_3d`); process.exit(1); }
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
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
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
const pct   = (n, d) => d > 0 ? (n / d * 100).toFixed(1) + '%' : '-';
const f2    = v => (typeof v === 'number' ? v.toFixed(2) : '-');
const f1    = v => (typeof v === 'number' ? v.toFixed(1) : '-');
const sep   = (n, c = '─') => c.repeat(n);

// Percentile
function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

// ── Feature definitions ────────────────────────────────────────────────────────

const FEATURES = [
  { key: 'close_loc',     label: 'CloseLoc%',      dir: 'high',  desc: 'Close position in day range (high=near HOD)'   },
  { key: 'body_pct',      label: 'BodyPct%',        dir: 'high',  desc: 'Candle body as % of range (high=strong body)'   },
  { key: 'upper_wick_pct',label: 'UpperWick%',      dir: 'low',   desc: 'Upper wick % of range (low=no rejection at top)'},
  { key: 'vol_ratio_20',  label: 'VolRatio20',      dir: 'mid',   desc: 'Volume vs 20D average (1.5-4x is sweet spot)'  },
  { key: 'vol_pre5',      label: 'VolPre5',         dir: 'high',  desc: 'Volume vs prev 5D (high=accelerating)'         },
  { key: 'range_atr',     label: 'RangeATR',        dir: 'low',   desc: 'Day range vs ATR (low=compression, energy building)'},
  { key: 'rsi2',          label: 'RSI2',            dir: 'high',  desc: 'RSI(2) momentum (high=strong momentum)'        },
  { key: 'rsi2_velocity', label: 'RSI2vel',         dir: 'high',  desc: 'RSI(2) acceleration'                           },
  { key: 'cl_trend',      label: 'CLtrend',         dir: 'high',  desc: 'Close trend'                                   },
  { key: 'zone_tightness',label: 'ZoneTight',       dir: 'high',  desc: 'Consolidation zone tightness'                  },
  { key: 'dd52wh',        label: 'DD52wHigh%',      dir: 'low',   desc: '% below 52W high (low=near highs)'            },
  { key: 'uc_score',      label: 'UCscore',         dir: 'high',  desc: 'Composite UC score'                            },
  { key: 'day_chg_pct',   label: 'DayChg%',        dir: 'mid',   desc: 'Day change % on scan day'                      },
  { key: 'conviction',    label: 'Conviction',      dir: 'high',  desc: 'Brain conviction score'                        },
];

// ── Threshold sweep ────────────────────────────────────────────────────────────
// dir: 'high' = feature > threshold is the buy signal
//      'low'  = feature < threshold is the buy signal
//      'mid'  = band: lo < feature < hi

function sweepThreshold(pos, neg, feat, nSteps = 50) {
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
      const prec = tp / total;
      const rec  = totalPos > 0 ? tp / totalPos : 0;
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
      const prec = tp / total;
      const rec  = totalPos > 0 ? tp / totalPos : 0;
      if (rec >= MIN_RECALL && (!best || prec > best.precision || (prec === best.precision && rec > best.recall))) {
        best = { threshold: t, precision: prec, recall: rec, tp, fp, total, dir: '<=' };
      }
    }
  } else {
    // 'mid': try bands (lo, hi) — scan pairs of percentiles
    for (let loP = 10; loP <= 60; loP += 10) {
      for (let hiP = loP + 20; hiP <= 90; hiP += 10) {
        const lo = percentile(allVals, loP), hi = percentile(allVals, hiP);
        const tp = pos.filter(v => v != null && v >= lo && v <= hi).length;
        const fp = neg.filter(v => v != null && v >= lo && v <= hi).length;
        const total = tp + fp;
        if (total < 5) continue;
        const prec = tp / total;
        const rec  = totalPos > 0 ? tp / totalPos : 0;
        if (rec >= MIN_RECALL && (!best || prec > best.precision)) {
          best = { threshold: lo, threshold2: hi, precision: prec, recall: rec, tp, fp, total, dir: 'band' };
        }
      }
    }
  }
  return best;
}

// ── 2-Feature pair sweep ───────────────────────────────────────────────────────

function sweepPair(posRows, negRows, fA, fB, bestA, bestB) {
  if (!bestA || !bestB) return null;

  // Filter: apply both conditions simultaneously
  function matchA(v) {
    if (v == null || !isFinite(v)) return false;
    if (bestA.dir === '>=')   return v >= bestA.threshold;
    if (bestA.dir === '<=')   return v <= bestA.threshold;
    if (bestA.dir === 'band') return v >= bestA.threshold && v <= bestA.threshold2;
    return false;
  }
  function matchB(v) {
    if (v == null || !isFinite(v)) return false;
    if (bestB.dir === '>=')   return v >= bestB.threshold;
    if (bestB.dir === '<=')   return v <= bestB.threshold;
    if (bestB.dir === 'band') return v >= bestB.threshold && v <= bestB.threshold2;
    return false;
  }

  const tp = posRows.filter(r => matchA(r[fA.key]) && matchB(r[fB.key])).length;
  const fp = negRows.filter(r => matchA(r[fA.key]) && matchB(r[fB.key])).length;
  const total = tp + fp;
  if (total < 5) return null;
  const prec = tp / total;
  const rec  = posRows.length > 0 ? tp / posRows.length : 0;
  if (rec < MIN_RECALL / 2) return null; // pairs naturally have lower recall
  return { prec, rec, tp, fp, total };
}

// ── Archetype naming ───────────────────────────────────────────────────────────

function nameDNA(rules) {
  // rules: array of { label, dir, threshold }
  const tags = [];
  for (const r of rules) {
    if (r.label === 'CloseLoc%'   && r.dir === '>=' && r.threshold > 80) tags.push('HOD close');
    if (r.label === 'UpperWick%'  && r.dir === '<=' && r.threshold < 10) tags.push('No rejection');
    if (r.label === 'BodyPct%'    && r.dir === '>=' && r.threshold > 50) tags.push('Strong body');
    if (r.label === 'VolRatio20'  && r.dir === '>=' && r.threshold > 1.5) tags.push('Vol surge');
    if (r.label === 'RangeATR'    && r.dir === '<=' && r.threshold < 0.9) tags.push('Compressed range');
    if (r.label === 'RSI2'        && r.dir === '>=' && r.threshold > 60) tags.push('RSI momentum');
    if (r.label === 'DD52wHigh%'  && r.dir === '<=' && r.threshold < 5)  tags.push('Near 52W high');
    if (r.label === 'Conviction'  && r.dir === '>=' && r.threshold > 60) tags.push('High conviction');
  }
  if (tags.length === 0) return 'Custom Setup';
  if (tags.includes('HOD close') && tags.includes('No rejection') && tags.includes('Strong body')) return '"Bullish Seal" 🟢';
  if (tags.includes('Compressed range') && tags.includes('Vol surge')) return '"Coiled Spring" 🔄';
  if (tags.includes('HOD close') && tags.includes('Compressed range')) return '"Quiet Accumulation" 🤫';
  if (tags.includes('RSI momentum') && tags.includes('Strong body')) return '"Momentum Burst" 🚀';
  if (tags.includes('Near 52W high') && tags.includes('HOD close')) return '"Breakout Edge" 📈';
  return '"' + tags.join(' + ') + '"';
}

// ── Format rule ────────────────────────────────────────────────────────────────

function fmtRule(feat, res) {
  if (!res) return '';
  if (res.dir === 'band') return `${feat.label} between ${f1(res.threshold)} – ${f1(res.threshold2)}`;
  return `${feat.label} ${res.dir} ${f2(res.threshold)}`;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log(`  UC CANDLE DNA MINER — target: ${TC.label.toUpperCase()}`);
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // ── 1. Fetch labeled rows ────────────────────────────────────────────────────
  console.log(`Loading labeled rows from pbfb_uc_logger (target=${TARGET})…`);
  const all = await fetchAll(
    'pbfb_uc_logger?select=symbol,scan_date,hit_uc_next_day,next_day_chg_pct,hit_5pct_3d,hit_10pct_5d,close_loc,body_pct,upper_wick_pct,vol_ratio_20,vol_pre5,range_atr,rsi2,rsi2_velocity,cl_trend,zone_tightness,dd52wh,uc_score,day_chg_pct,conviction,uc_elite,uc_strong,uc_goldmine&hit_uc_next_day=not.is.null&order=scan_date.asc'
  );

  if (!Array.isArray(all) || all.length === 0) {
    console.error('No labeled rows found — run label-uc-outcomes first.');
    process.exit(1);
  }

  // Filter to rows where the target outcome column is not null
  const labeled = all.filter(r => r[TC.needsCol] != null);
  const posRows = labeled.filter(TC.isPos);
  const negRows = labeled.filter(r => !TC.isPos(r));
  const total   = labeled.length;
  const baseRate = total > 0 ? posRows.length / total : 0;

  console.log(`Labeled rows: ${total.toLocaleString()} | Hits (${TC.label}): ${posRows.length} | Non-hits: ${negRows.length}`);
  console.log(`Base precision (random): ${pct(posRows.length, total)} — DNA must beat this\n`);

  if (posRows.length < 10) {
    console.error(`Too few positives for target "${TARGET}" (found ${posRows.length}, need ≥10). Try --target=5pct or collect more labeled data.`);
    process.exit(1);
  }

  const lines = [];
  const log = s => { console.log(s); lines.push(s); };

  // ── 2. Feature distributions ─────────────────────────────────────────────────
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('  FEATURE DISTRIBUTIONS: UC-HIT vs NON-HIT');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(String('Feature').padEnd(14) + String('UC-Hit mean').padStart(14) + String('Non-hit mean').padStart(14) + String('Cohen d').padStart(10) + String('Importance').padStart(12));
  log(sep(70));

  const featureResults = [];

  for (const feat of FEATURES) {
    const posVals = posRows.map(r => r[feat.key]).filter(v => v != null && isFinite(v));
    const negVals = negRows.map(r => r[feat.key]).filter(v => v != null && isFinite(v));
    if (posVals.length < 5 || negVals.length < 5) continue;

    const posMean = mean(posVals), posStd = std(posVals);
    const negMean = mean(negVals), negStd = std(negVals);
    const d = cohensD(posVals, negVals);
    const importance = Math.abs(d) > 0.8 ? 'LARGE ★★★' : Math.abs(d) > 0.5 ? 'MEDIUM ★★' : Math.abs(d) > 0.2 ? 'SMALL ★' : 'tiny';

    log(
      feat.label.padEnd(14) +
      (`${f2(posMean)} ±${f2(posStd)}`).padStart(14) +
      (`${f2(negMean)} ±${f2(negStd)}`).padStart(14) +
      f2(d).padStart(10) +
      importance.padStart(12)
    );

    featureResults.push({ feat, posVals, negVals, d, posMean, negMean });
  }

  // Sort by |Cohen's d|
  featureResults.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

  // ── 3. Per-feature threshold sweep ───────────────────────────────────────────
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`  THRESHOLD SWEEP (min recall ≥ ${(MIN_RECALL * 100).toFixed(0)}%)`);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(String('Feature').padEnd(14) + String('Rule').padStart(24) + String('Precision').padStart(11) + String('Recall').padStart(9) + String('TP/Total').padStart(12) + String('vs Base').padStart(10));
  log(sep(82));

  const sweepResults = [];

  for (const { feat, posVals, negVals } of featureResults) {
    const res = sweepThreshold(posVals, negVals, feat);
    if (!res) continue;
    const lift = baseRate > 0 ? (res.precision / baseRate).toFixed(1) + 'x' : '-';
    log(
      feat.label.padEnd(14) +
      fmtRule(feat, res).padStart(24) +
      pct(res.tp, res.total).padStart(11) +
      pct(res.tp, posRows.length).padStart(9) +
      (`${res.tp}/${res.total}`).padStart(12) +
      lift.padStart(10)
    );
    sweepResults.push({ feat, res });
  }

  // ── 4. Top single-feature DNA rules ─────────────────────────────────────────
  const topSingle = sweepResults
    .filter(s => s.res)
    .sort((a, b) => b.res.precision - a.res.precision)
    .slice(0, 5);

  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('  TOP SINGLE-FEATURE DNA RULES (ranked by precision)');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  for (let i = 0; i < topSingle.length; i++) {
    const { feat, res } = topSingle[i];
    const lift = baseRate > 0 ? ((res.precision / baseRate - 1) * 100).toFixed(0) + '% better than random' : '';
    log(`  ${i + 1}. ${fmtRule(feat, res)}`);
    log(`     Precision: ${pct(res.tp, res.total)}  |  Recall: ${pct(res.tp, posRows.length)}  |  ${lift}`);
    log(`     → ${feat.desc}`);
    log('');
  }

  // ── 5. 2-Feature pair search ──────────────────────────────────────────────────
  if (RUN_PAIRS) {
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    log('  TOP 2-FEATURE DNA COMBINATIONS');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const pairResults = [];

    for (let i = 0; i < sweepResults.length; i++) {
      for (let j = i + 1; j < sweepResults.length; j++) {
        const { feat: fA, res: rA } = sweepResults[i];
        const { feat: fB, res: rB } = sweepResults[j];
        const pr = sweepPair(posRows, negRows, fA, fB, rA, rB);
        if (!pr) continue;
        pairResults.push({ fA, rA, fB, rB, ...pr });
      }
    }

    pairResults.sort((a, b) => b.prec - a.prec);
    const topPairs = pairResults.slice(0, 5);

    for (let i = 0; i < topPairs.length; i++) {
      const p = topPairs[i];
      const archetype = nameDNA([
        { label: p.fA.label, dir: p.rA.dir, threshold: p.rA.threshold },
        { label: p.fB.label, dir: p.rB.dir, threshold: p.rB.threshold },
      ]);
      const lift = baseRate > 0 ? ((p.prec / baseRate - 1) * 100).toFixed(0) + '% lift' : '';
      log(`  ${i + 1}. ${archetype}`);
      log(`     Rule: ${fmtRule(p.fA, p.rA)}  AND  ${fmtRule(p.fB, p.rB)}`);
      log(`     Precision: ${pct(p.tp, p.total)}  |  Recall: ${pct(p.tp, posRows.length)}  |  TP: ${p.tp}  |  ${lift}`);
      log('');
    }
  }

  // ── 6. Percentile profiles: what does a UC stock look like? ─────────────────
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('  CANDLE DNA FINGERPRINT (percentile profile of UC-hit stocks)');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(String('Feature').padEnd(16) + 'P25'.padStart(8) + 'Median'.padStart(8) + 'P75'.padStart(8) + 'Ideal zone'.padStart(20));
  log(sep(62));

  for (const { feat, posVals } of featureResults) {
    if (posVals.length < 5) continue;
    const sorted = [...posVals].sort((a, b) => a - b);
    const p25 = percentile(sorted, 25);
    const p50 = percentile(sorted, 50);
    const p75 = percentile(sorted, 75);

    // Ideal zone: where the top 50% of UC stocks sit
    let ideal = '';
    if (feat.dir === 'high')  ideal = `> ${f2(p50)} (above median)`;
    else if (feat.dir === 'low')  ideal = `< ${f2(p50)} (below median)`;
    else ideal = `${f2(p25)} – ${f2(p75)} (IQR band)`;

    log(feat.label.padEnd(16) + f2(p25).padStart(8) + f2(p50).padStart(8) + f2(p75).padStart(8) + ideal.padStart(20));
  }

  // ── 7. Golden Rule synthesis ──────────────────────────────────────────────────
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('  THE GOLDEN RULE — best single precision DNA filter');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const best = sweepResults
    .filter(s => s.res && s.res.precision > baseRate)
    .sort((a, b) => b.res.precision - a.res.precision)[0];

  if (best) {
    const archetype = nameDNA([{ label: best.feat.label, dir: best.res.dir, threshold: best.res.threshold }]);
    const lift = baseRate > 0 ? (best.res.precision / baseRate).toFixed(1) : '?';
    log(`\n  Archetype: ${archetype}`);
    log(`  Rule:      ${fmtRule(best.feat, best.res)}`);
    log(`  Precision: ${pct(best.res.tp, best.res.total)}  (${lift}x better than random ${pct(posRows.length, total)})`);
    log(`  Recall:    ${pct(best.res.tp, posRows.length)}`);
    log(`  Signal:    ${best.res.tp} hits (${TC.label}) out of ${best.res.total} flagged\n`);
    log(`  Candle description: On the day before ${TC.label}, this stock's`);
    log(`  ${best.feat.desc}.`);
    log(`  Filter: only flag stocks where ${fmtRule(best.feat, best.res)}.`);
  } else {
    log('\n  No single feature beats random. Need more labeled data OR run --pairs for combinations.');
  }

  // ── 8. UC elite/strong/goldmine breakdown ─────────────────────────────────────
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(`  TIER BREAKDOWN — ${TC.label} hit rate by screener tier`);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(String('Tier').padEnd(16) + 'Candidates'.padStart(12) + 'Hits'.padStart(10) + 'Precision'.padStart(12));
  log(sep(52));

  const tiers = [
    { label: 'uc_goldmine', key: 'uc_goldmine' },
    { label: 'uc_elite',    key: 'uc_elite'    },
    { label: 'uc_strong',   key: 'uc_strong'   },
    { label: 'all_flagged', key: null           },
  ];
  for (const t of tiers) {
    const sub = t.key ? labeled.filter(r => r[t.key] === true) : labeled;
    const hits = sub.filter(TC.isPos).length;
    log(t.label.padEnd(16) + String(sub.length).padStart(12) + String(hits).padStart(10) + pct(hits, sub.length).padStart(12));
  }

  // ── 9. Save report ────────────────────────────────────────────────────────────
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(RESULT_DIR, `uc_candle_dna_${ts}.txt`);
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  console.log(`\nReport saved → ${outPath}\n`);

  // ── 10. Summary JSON for screener integration ─────────────────────────────────
  const dnaJson = {
    generated: new Date().toISOString(),
    target: TARGET,
    target_label: TC.label,
    total_labeled: total,
    hits: posRows.length,
    base_rate: parseFloat((baseRate * 100).toFixed(2)),
    top_features: featureResults.slice(0, 5).map(({ feat, d, posMean, negMean }) => ({
      key: feat.key, label: feat.label, cohens_d: parseFloat(f2(d)),
      uc_hit_mean: parseFloat(f2(posMean)), non_hit_mean: parseFloat(f2(negMean)),
    })),
    golden_rule: best ? {
      feature: best.feat.key,
      label: best.feat.label,
      direction: best.res.dir,
      threshold: parseFloat(f2(best.res.threshold)),
      precision: parseFloat((best.res.precision * 100).toFixed(1)),
      recall: parseFloat((best.res.recall * 100).toFixed(1)),
    } : null,
    fingerprint: Object.fromEntries(
      featureResults.slice(0, 8).map(({ feat, posVals }) => {
        const s = [...posVals].sort((a, b) => a - b);
        return [feat.key, {
          p25: parseFloat(f2(percentile(s, 25))),
          median: parseFloat(f2(percentile(s, 50))),
          p75: parseFloat(f2(percentile(s, 75))),
        }];
      })
    ),
  };

  const jsonPath = path.join(RESULT_DIR, 'uc_candle_dna.json');
  fs.writeFileSync(jsonPath, JSON.stringify(dnaJson, null, 2), 'utf-8');
  console.log(`DNA fingerprint JSON → ${jsonPath}`);
  console.log('\nNext step: run with --pairs flag to find best 2-feature combinations.\n');
}

main().catch(e => { console.error(e); process.exit(1); });
