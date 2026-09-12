'use strict';
/**
 * False Negative Miner — Brain V3 Anti-Bias Engine
 *
 * Fetches ALL labeled rows where next_day_chg_pct >= 5 but NONE of the current
 * DNA clauses (A/B/C/D) fired. These are "escaped winners" — stocks that actually
 * ran >5% but were invisible to the current DNA filter.
 *
 * Runs pair-search on escaped winners to propose DNA-E and DNA-F clauses.
 * Updates 'false_negative_clauses' in uc_brain_config (Supabase).
 * Also writes false_negative_analysis.json for human review.
 */

const https   = require('https');
const fs      = require('fs');
const path    = require('path');

const ROOT       = path.join(__dirname, '..');
const RESULT_DIR = path.join(ROOT, 'scripts', 'results');

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

function sbGet(urlPath) {
  return new Promise((res, rej) => {
    const req = https.request(new URL(`${SUPA_URL}/rest/v1/${urlPath}`), {
      headers: { apikey: SUPA_KEY, authorization: `Bearer ${SUPA_KEY}`, accept: 'application/json' },
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,200)))} }); });
    req.on('error', rej); req.end();
  });
}

function sbPost(urlPath, body) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const u = new URL(`${SUPA_URL}/rest/v1/${urlPath}`);
    const req = https.request(u, {
      method: 'POST',
      headers: {
        apikey: SUPA_KEY, authorization: `Bearer ${SUPA_KEY}`,
        'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation',
      },
    }, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{ try{res(JSON.parse(d))}catch(e){rej(new Error(d.slice(0,200)))} }); });
    req.on('error', rej); req.write(data); req.end();
  });
}

async function fetchAll(q) {
  let all=[], page=0;
  while(true) {
    const rows = await sbGet(`${q}&limit=1000&offset=${page*1000}`);
    if(!Array.isArray(rows)||rows.length===0) break;
    all=all.concat(rows); if(rows.length<1000) break; page++;
  }
  return all;
}

// Current DNA clause tests (must stay in sync with tradeOps.ts)
const DNA_A = r => r.vol_pre5  >= 3.18 && r.cl_trend        >= 63;
const DNA_B = r => r.upper_wick_pct <= 1.38 && r.inflection_score >= 34;
const DNA_C = r => r.uc_goldmine === true;
const DNA_D = r => r.vol_pre5  >= 3.18 && r.inflection_score >= 34;
const anyDNA = r => DNA_A(r) || DNA_B(r) || DNA_C(r) || DNA_D(r);

// Numeric feature candidates for pair search
const FEATURES = [
  { name: 'vol_pre5',         dir: '>=' },
  { name: 'upper_wick_pct',   dir: '<=' },
  { name: 'cl_trend',         dir: '>=' },
  { name: 'inflection_score', dir: '>=' },
  { name: 'uc_score',         dir: '>=' },
  { name: 'body_pct',         dir: '>=' },
  { name: 'rsi2',             dir: '>=' },
  { name: 'range_atr',        dir: '>=' },
  { name: 'momentum_score',   dir: '>=' },
  { name: 'stats_score',      dir: '>=' },
];

function percentiles(arr, pcts) {
  const sorted = [...arr].sort((a,b)=>a-b);
  return pcts.map(p => sorted[Math.floor(sorted.length * p / 100)]);
}

function pairSearch(winners, allLabeled, minPrec = 0.14, minN = 8) {
  const found = [];
  const baseRate = allLabeled.filter(r => r.next_day_chg_pct >= 5).length / allLabeled.length;

  for (let i = 0; i < FEATURES.length; i++) {
    for (let j = i+1; j < FEATURES.length; j++) {
      const fA = FEATURES[i], fB = FEATURES[j];
      const valsA = winners.map(r => r[fA.name]).filter(v => v != null);
      const valsB = winners.map(r => r[fB.name]).filter(v => v != null);
      if (valsA.length < minN || valsB.length < minN) continue;

      // Try threshold at p25, p50 of winners for direction >=; p75 for <=
      const threshA_candidates = fA.dir === '>=' ? percentiles(valsA, [25, 50]) : percentiles(valsA, [50, 75]);
      const threshB_candidates = fB.dir === '>=' ? percentiles(valsB, [25, 50]) : percentiles(valsB, [50, 75]);

      for (const threshA of threshA_candidates) {
        for (const threshB of threshB_candidates) {
          if (threshA == null || threshB == null) continue;
          const hits = allLabeled.filter(r => {
            const passA = fA.dir === '>=' ? r[fA.name] >= threshA : r[fA.name] <= threshA;
            const passB = fB.dir === '>=' ? r[fB.name] >= threshB : r[fB.name] <= threshB;
            return passA && passB;
          });
          if (hits.length < minN) continue;
          const prec = hits.filter(r => r.next_day_chg_pct >= 5).length / hits.length;
          const lift = prec / (baseRate || 0.04);
          if (prec >= minPrec && lift >= 2.5) {
            found.push({ fA: fA.name, dirA: fA.dir, threshA, fB: fB.name, dirB: fB.dir, threshB, precision: prec, n: hits.length, lift });
          }
        }
      }
    }
  }
  // Deduplicate and sort by precision desc
  found.sort((a,b) => b.precision - a.precision);
  const seen = new Set();
  return found.filter(p => {
    const key = `${p.fA}_${p.threshA}_${p.fB}_${p.threshB}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 10);
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  FALSE NEGATIVE MINER — BRAIN V3 ANTI-BIAS ENGINE            ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const allLabeled = await fetchAll(
    `pbfb_uc_logger?select=scan_date,next_day_chg_pct,uc_goldmine,vol_pre5,cl_trend,` +
    `upper_wick_pct,inflection_score,uc_score,body_pct,rsi2,range_atr,momentum_score,stats_score` +
    `&next_day_chg_pct=not.is.null&order=scan_date.desc`
  );
  console.log(`Total labeled: ${allLabeled.length}`);

  const allWinners = allLabeled.filter(r => r.next_day_chg_pct >= 5);
  const dnaWinners = allWinners.filter(anyDNA);
  const escapedWinners = allWinners.filter(r => !anyDNA(r));

  console.log(`Winners (≥5%): ${allWinners.length}`);
  console.log(`Captured by DNA: ${dnaWinners.length} (${(100*dnaWinners.length/allWinners.length).toFixed(1)}%)`);
  console.log(`ESCAPED (DNA missed): ${escapedWinners.length} (${(100*escapedWinners.length/allWinners.length).toFixed(1)}%)`);

  if (escapedWinners.length < 8) {
    console.log('  Insufficient escaped winners for pair search (need ≥8). Exiting.');
    return { escaped_count: escapedWinners.length, candidate_clauses: [] };
  }

  // Characterize escaped winners vs all labeled
  console.log('\n  Escaped winners feature medians:');
  for (const f of FEATURES) {
    const vals = escapedWinners.map(r => r[f.name]).filter(v => v != null).sort((a,b)=>a-b);
    if (vals.length > 0) {
      const median = vals[Math.floor(vals.length/2)];
      console.log(`    ${f.name.padEnd(18)}: median=${median}`);
    }
  }

  console.log('\n  Mining new clause candidates from escaped winners...');
  const candidates = pairSearch(escapedWinners, allLabeled);
  console.log(`  Found ${candidates.length} candidate clause(s):`);
  candidates.slice(0, 5).forEach((c, i) => {
    console.log(`    Candidate-${i+1}: ${c.fA}${c.dirA}${c.threshA} && ${c.fB}${c.dirB}${c.threshB} → prec=${(c.precision*100).toFixed(1)}% N=${c.n} lift=${c.lift.toFixed(1)}×`);
  });

  // Assign candidate IDs starting from E
  const clauseIds = 'EFGHIJ'.split('');
  const candidateClauses = candidates.slice(0, 6).map((c, i) => ({
    id: clauseIds[i],
    ...c,
    status: 'candidate',  // 'candidate' → 'validated' → 'deployed'
  }));

  const out = {
    generated: new Date().toISOString(),
    total_labeled: allLabeled.length,
    winner_count: allWinners.length,
    dna_capture_rate: dnaWinners.length / allWinners.length,
    escaped_count: escapedWinners.length,
    escaped_rate: escapedWinners.length / allWinners.length,
    candidate_clauses: candidateClauses,
    note: 'Candidates need N≥20 and precision≥15% before deployment via auto_apply_improvements.js',
  };

  fs.writeFileSync(path.join(RESULT_DIR, 'false_negative_analysis.json'), JSON.stringify(out, null, 2));
  console.log(`  JSON → scripts/results/false_negative_analysis.json`);

  // Store in Supabase for auto_apply_improvements.js to read
  try {
    await sbPost('uc_brain_config', { config_key: 'false_negative_clauses', config_value: out, updated_at: new Date().toISOString() });
    console.log('  Supabase uc_brain_config updated');
  } catch(e) {
    console.log(`  WARN: Supabase upsert failed: ${e.message?.slice(0,80)}`);
  }

  console.log(`\n  DNA capture rate: ${(100*dnaWinners.length/allWinners.length).toFixed(1)}%  (escaped: ${escapedWinners.length})`);
  console.log(`  Target: drive capture rate to ≥70% by adding validated new clauses.\n`);
  return out;
}

module.exports = { main };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
