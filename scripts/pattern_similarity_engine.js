'use strict';
/**
 * Pattern Similarity Engine — Brain V3 Winner Memory
 *
 * Fetches all labeled rows where next_day_chg_pct >= 5 (historical winners).
 * Normalizes 8 key features into unit vectors.
 * Runs k-means clustering (k=5) to find the 5 archetypes of winning stocks.
 * Stores cluster centroids in Supabase uc_brain_config (key: 'winner_clusters').
 *
 * At scan time (page.tsx), each stock is compared to all 5 centroids.
 * Nearest-cluster cosine similarity 0-100 displayed as SIM% in results table.
 * Stocks with SIM >= 65 get priority flag regardless of DNA clause count.
 *
 * Runs nightly as part of daily_brain_trainer.js chain.
 */

const https   = require('https');
const fs      = require('fs');
const path    = require('path');

const ROOT       = path.join(__dirname, '..');
const RESULT_DIR = path.join(ROOT, 'scripts', 'results');
const K          = 5;   // number of winner archetypes
const MAX_ITER   = 100;

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
    const req = https.request(new URL(`${SUPA_URL}/rest/v1/${urlPath}`), {
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

// Feature dimensions — must match TS field names exported in winner_clusters
const DIMS = [
  { db: 'vol_pre5',          ts: 'exactVolVsPre5',  weight: 1.5 },  // strongest signal
  { db: 'cl_trend',          ts: 'clTrend',         weight: 1.2 },
  { db: 'inflection_score',  ts: 'inflectionScore', weight: 1.2 },
  { db: 'upper_wick_pct',    ts: 'upperWickPct',    weight: 1.0 },
  { db: 'uc_score',          ts: 'ucScore',         weight: 1.3 },
  { db: 'body_pct',          ts: 'bodyPct',         weight: 0.8 },
  { db: 'rsi2',              ts: 'rsi2',            weight: 0.7 },
  { db: 'range_atr',         ts: 'rangeATR',        weight: 0.9 },
];

function normalize(matrix) {
  // Per-feature min-max normalization using winner population stats
  const stats = DIMS.map((_, j) => {
    const col = matrix.map(r => r[j]).filter(v => isFinite(v));
    const min = Math.min(...col), max = Math.max(...col);
    return { min, max, range: max - min || 1 };
  });
  return {
    normalized: matrix.map(row => row.map((v, j) => (v - stats[j].min) / stats[j].range)),
    stats,
  };
}

function weightedDist(a, b) {
  let sum = 0;
  for (let j = 0; j < a.length; j++) {
    const diff = (a[j] - b[j]) * DIMS[j].weight;
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

function kmeans(data, k, maxIter) {
  // K-means++ initialization
  const centroids = [data[Math.floor(Math.random() * data.length)]];
  while (centroids.length < k) {
    const dists = data.map(p => Math.min(...centroids.map(c => weightedDist(p, c))));
    const total = dists.reduce((a, b) => a + b * b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < data.length; i++) {
      r -= dists[i] * dists[i];
      if (r <= 0) { centroids.push(data[i]); break; }
    }
  }

  let assignments = new Array(data.length).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    // Assign
    let changed = false;
    for (let i = 0; i < data.length; i++) {
      let best = 0, bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = weightedDist(data[i], centroids[c]);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      if (best !== assignments[i]) { assignments[i] = best; changed = true; }
    }
    if (!changed) break;
    // Update centroids
    for (let c = 0; c < k; c++) {
      const members = data.filter((_, i) => assignments[i] === c);
      if (members.length === 0) continue;
      for (let j = 0; j < centroids[c].length; j++) {
        centroids[c][j] = members.reduce((s, p) => s + p[j], 0) / members.length;
      }
    }
  }
  return { centroids, assignments };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  PATTERN SIMILARITY ENGINE — BRAIN V3 WINNER MEMORY          ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const cols = DIMS.map(d => d.db).join(',');
  const allLabeled = await fetchAll(
    `pbfb_uc_logger?select=scan_date,next_day_chg_pct,${cols}` +
    `&next_day_chg_pct=not.is.null&order=scan_date.desc`
  );
  console.log(`Total labeled: ${allLabeled.length}`);

  const winners = allLabeled.filter(r => r.next_day_chg_pct >= 5);
  const losers  = allLabeled.filter(r => r.next_day_chg_pct < 5);
  console.log(`Winners ≥5%: ${winners.length}   Losers: ${losers.length}`);

  if (winners.length < K * 3) {
    console.log(`  Need ≥${K*3} winners for clustering. Have ${winners.length}. Exiting.`);
    return null;
  }

  // Build feature matrix
  const winnerMatrix = winners.map(r => DIMS.map(d => {
    const v = r[d.db];
    return v != null ? parseFloat(v) : 0;
  }));

  const { normalized, stats } = normalize(winnerMatrix);

  // Run k-means with 5 different seeds, pick best (lowest inertia)
  let best = null, bestInertia = Infinity;
  for (let seed = 0; seed < 5; seed++) {
    const result = kmeans(normalized, K, MAX_ITER);
    const inertia = normalized.reduce((sum, p, i) =>
      sum + weightedDist(p, result.centroids[result.assignments[i]]) ** 2, 0);
    if (inertia < bestInertia) { bestInertia = inertia; best = result; }
  }
  const { centroids, assignments } = best;

  // Compute cluster stats
  const clusters = centroids.map((centNorm, c) => {
    const memberIdxs = winners.map((_, i) => i).filter(i => assignments[i] === c);
    const memberWinners = memberIdxs.map(i => winners[i]);

    // Denormalize centroid back to original feature space
    const centroidRaw = centNorm.map((v, j) => v * stats[j].range + stats[j].min);

    // Precision of cluster members among ALL labeled (not just winners)
    // Find all labeled rows closest to this centroid
    const allMatrixNorm = allLabeled.map(r => DIMS.map(d => {
      const v = r[d.db];
      const fv = v != null ? parseFloat(v) : 0;
      return (fv - stats[j=DIMS.findIndex(x=>x.db===d.db)].min) / stats[j].range;
    }));
    const threshold = 0.35; // normalized distance to consider "in cluster"
    const clusterMembers = allLabeled.filter((_, i) => weightedDist(allMatrixNorm[i], centNorm) <= threshold);
    const clusterPrec = clusterMembers.length > 0
      ? clusterMembers.filter(r => r.next_day_chg_pct >= 5).length / clusterMembers.length
      : null;

    // Describe cluster by dominant features
    const featureDesc = DIMS.map((d, j) => `${d.db}=${centroidRaw[j].toFixed(2)}`).join(', ');

    console.log(`\n  Cluster ${c+1} (${memberWinners.length} winner members):`);
    console.log(`    All-members prec: ${clusterPrec != null ? (clusterPrec*100).toFixed(1)+'%' : 'N/A'} (N=${clusterMembers.length})`);
    console.log(`    ${featureDesc}`);

    return {
      id: c + 1,
      n_winners: memberWinners.length,
      n_cluster_total: clusterMembers.length,
      precision_in_cluster: clusterPrec,
      centroid_raw: centroidRaw.map((v, j) => ({ feature: DIMS[j].db, ts_field: DIMS[j].ts, value: Math.round(v * 100) / 100 })),
      centroid_norm: centNorm,
      norm_stats: stats.map((s, j) => ({ feature: DIMS[j].db, min: s.min, max: s.max, range: s.range })),
      threshold_for_membership: threshold,
    };
  });

  // Sort clusters by precision desc
  clusters.sort((a, b) => (b.precision_in_cluster ?? 0) - (a.precision_in_cluster ?? 0));

  const out = {
    version: 2,
    generated: new Date().toISOString(),
    trained_on: `${allLabeled.length} labeled rows, ${winners.length} winners`,
    n_winners: winners.length,
    k: K,
    dims: DIMS.map(d => ({ db: d.db, ts: d.ts, weight: d.weight })),
    clusters,
    usage: 'At scan time: normalize stock features using norm_stats, compute weighted Euclidean dist to each centroid_norm, similarity = max(0, 1 - min_dist / threshold) * 100',
  };

  fs.writeFileSync(path.join(RESULT_DIR, 'winner_clusters.json'), JSON.stringify(out, null, 2));
  console.log(`\n  JSON → scripts/results/winner_clusters.json`);

  try {
    await sbPost('uc_brain_config', { config_key: 'winner_clusters', config_value: out, updated_at: new Date().toISOString() });
    console.log('  Supabase uc_brain_config[winner_clusters] updated');
  } catch(e) {
    console.log(`  WARN: Supabase upsert failed: ${e.message?.slice(0,80)}`);
  }

  console.log(`\n  Clusters (sorted by in-cluster precision):`);
  clusters.forEach(c => {
    console.log(`    Cluster ${c.id}: prec=${c.precision_in_cluster != null ? (c.precision_in_cluster*100).toFixed(1)+'%' : 'N/A'} N=${c.n_cluster_total} winners_in=${c.n_winners}`);
  });
  console.log(`  Best cluster precision: ${clusters[0].precision_in_cluster != null ? (clusters[0].precision_in_cluster*100).toFixed(1)+'%' : 'N/A'}\n`);

  return out;
}

module.exports = { main };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
