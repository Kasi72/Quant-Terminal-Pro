'use strict';
/**
 * Candle Morphology K-Means Clustering
 * Clusters pbfb_uc_events on (body_pct, upper_wick_pct) using K=5.
 * Outputs centroids + per-cluster T1 hit rates → hardcode into ucScoreWeights.ts
 *
 * Usage:
 *   node scripts/morphology_kmeans.js
 */
const https = require('https');
const path  = require('path');
const fs    = require('fs');

const ROOT     = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error('[ERROR] Missing Supabase creds'); process.exit(1); }

function sbGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPA_URL}/rest/v1/${urlPath}`);
    const req = https.request(url, {
      headers: {
        apikey: SUPA_KEY,
        authorization: `Bearer ${SUPA_KEY}`,
        accept: 'application/json',
        'accept-profile': 'public',
      },
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── k-means utils ────────────────────────────────────────────────────────────
function dist2(a, b) { return (a[0]-b[0])**2 + (a[1]-b[1])**2; }

function kMeans(pts, K, maxIter = 300) {
  // k-means++ init
  const cents = [[...pts[Math.floor(Math.random() * pts.length)]]];
  while (cents.length < K) {
    const ds = pts.map(p => Math.min(...cents.map(c => dist2(p, c))));
    const tot = ds.reduce((s, d) => s + d, 0);
    let r = Math.random() * tot;
    for (let i = 0; i < pts.length; i++) { r -= ds[i]; if (r <= 0) { cents.push([...pts[i]]); break; } }
    if (cents.length < K + 1 - 1) cents.push([...pts[pts.length - 1]]); // safety
  }
  let asgn = new Array(pts.length).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const newAsgn = pts.map(p => {
      let best = 0, bestD = Infinity;
      cents.forEach((c, ci) => { const d = dist2(p, c); if (d < bestD) { bestD = d; best = ci; } });
      return best;
    });
    const changed = newAsgn.some((a, i) => a !== asgn[i]);
    asgn = newAsgn;
    if (!changed) break;
    cents.forEach((c, ci) => {
      const mems = pts.filter((_, i) => asgn[i] === ci);
      if (!mems.length) return;
      c[0] = mems.reduce((s, p) => s + p[0], 0) / mems.length;
      c[1] = mems.reduce((s, p) => s + p[1], 0) / mems.length;
    });
  }
  return { asgn, cents };
}

function inertia(pts, asgn, cents) {
  return pts.reduce((s, p, i) => s + dist2(p, cents[asgn[i]]), 0);
}

// ── morphology label from centroid ───────────────────────────────────────────
function morphLabel(body, wick) {
  const lower = Math.max(0, 100 - body - wick);
  if (body > 45 && wick < 15)             return 'Rocket';       // strong marubozu-like
  if (body < 25 && lower > 20 && wick < 20) return 'CoiledSpring'; // hammer-ish accumulation
  if (body < 25 && wick > 35)             return 'Gravestone';   // distribution / miss
  if (body < 35 && lower > 20 && wick < 20) return 'Hammer';      // partial spring
  return 'Standard';
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Fetching pbfb_uc_events ...');

  // Paginated fetch — table may have 1500+ rows
  let all = [], page = 0;
  while (true) {
    const rows = await sbGet(
      `pbfb_uc_events?select=body_pct,upper_wick_pct,hit_t1&` +
      `body_pct=not.is.null&upper_wick_pct=not.is.null&` +
      `limit=1000&offset=${page * 1000}&order=id.asc`
    );
    if (!Array.isArray(rows) || rows.length === 0) break;
    all = all.concat(rows);
    if (rows.length < 1000) break;
    page++;
  }

  console.log(`Total events with morphology features: ${all.length}`);
  const labeled = all.filter(r => r.hit_t1 != null);
  console.log(`Labeled (hit_t1 not null): ${labeled.length}\n`);

  if (all.length < 50) { console.error('[ERROR] Not enough data'); process.exit(1); }

  // Normalise features for k-means: body [0,100] → [0,1], wick [0,100] → [0,1]
  const pts = all.map(r => [r.body_pct / 100, r.upper_wick_pct / 100]);

  // 15 restarts, pick lowest inertia
  const K = 5;
  let best = null;
  for (let run = 0; run < 15; run++) {
    const res = kMeans(pts, K);
    const ine = inertia(pts, res.asgn, res.cents);
    if (!best || ine < best.inertia) best = { ...res, inertia: ine };
  }
  const { asgn, cents } = best;

  // Build per-cluster stats — use labeled subset for hit rates
  const labeledIdx = all.map((r, i) => r.hit_t1 != null ? i : -1).filter(i => i >= 0);

  console.log('══════════════════════════════════════════════════');
  console.log(`K-Means K=${K} results (15 restarts, lowest inertia)`);
  console.log('══════════════════════════════════════════════════');

  const clusterInfo = [];
  for (let ci = 0; ci < K; ci++) {
    const memberIdx  = asgn.reduce((acc, a, i) => { if (a === ci) acc.push(i); return acc; }, []);
    const members    = memberIdx.map(i => all[i]);
    const lMembers   = members.filter(r => r.hit_t1 != null);
    const hits       = lMembers.filter(r => r.hit_t1 === true).length;
    const hitRate    = lMembers.length >= 5 ? hits / lMembers.length : null;
    const bodyC      = cents[ci][0] * 100;
    const wickC      = cents[ci][1] * 100;
    const lowerC     = Math.max(0, 100 - bodyC - wickC);
    const label      = morphLabel(bodyC, wickC);

    // Actual member averages
    const avgBody = members.reduce((s, r) => s + r.body_pct, 0) / members.length;
    const avgWick = members.reduce((s, r) => s + r.upper_wick_pct, 0) / members.length;

    clusterInfo.push({ ci, label, bodyC, wickC, lowerC, n: members.length, nLabeled: lMembers.length, hits, hitRate, avgBody, avgWick });

    console.log(`Cluster ${ci} [${label}]`);
    console.log(`  centroid  : body=${bodyC.toFixed(1)}%  upperWick=${wickC.toFixed(1)}%  lowerWick≈${lowerC.toFixed(1)}%`);
    console.log(`  member avg: body=${avgBody.toFixed(1)}%  upperWick=${avgWick.toFixed(1)}%`);
    console.log(`  n=${members.length}  labeled=${lMembers.length}  hits=${hits}  T1 hitRate=${hitRate != null ? (hitRate*100).toFixed(1)+'%' : 'n/a (<5 labeled)'}`);
    console.log('');
  }

  // Sort by hit rate descending for ranking
  const ranked = clusterInfo
    .filter(c => c.hitRate != null)
    .sort((a, b) => b.hitRate - a.hitRate);

  console.log('══════════════════════════════════════════════════');
  console.log('Ranking by T1 hit rate (labeled only):');
  ranked.forEach((c, rank) => {
    console.log(`  Rank ${rank+1}: Cluster ${c.ci} [${c.label}]  hitRate=${(c.hitRate*100).toFixed(1)}%  n=${c.n}`);
  });

  // Output ucScoreWeights morphology block suggestion
  console.log('\n══════════════════════════════════════════════════');
  console.log('Suggested ucScoreWeights.ts morphology constants:');
  console.log('(Rank-based bonus: rank1=6pts, rank2=4pts, rank3=2pts, unranked/Gravestone=0)');
  console.log('');
  const PTS_MAP = [6, 4, 2];
  ranked.forEach((c, rank) => {
    if (rank < 3) {
      console.log(`  morphCluster_${c.label}_pts: ${PTS_MAP[rank]},   // hitRate=${(c.hitRate*100).toFixed(1)}%, n=${c.n}`);
    }
  });
  console.log('  morphCluster_Gravestone_pts: -4,  // miss fingerprint from PBFB backtest');
  console.log('');
  console.log('Centroid lookup table for live classification:');
  clusterInfo.forEach(c => {
    console.log(`  { label:'${c.label}', body:${c.bodyC.toFixed(1)}, wick:${c.wickC.toFixed(1)} },`);
  });

  // Write results file
  const outPath = path.join(__dirname, 'results', 'morphology_kmeans.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ K, clusters: clusterInfo, ranked }, null, 2));
  console.log(`\nResults saved: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
