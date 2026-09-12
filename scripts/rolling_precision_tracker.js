'use strict';
/**
 * Rolling Precision Tracker — UC DNA Clause Drift Detection
 *
 * Computes 30d / 60d / 90d rolling precision for each DNA clause.
 * Detects drift: if any clause drops >3pp precision vs prior period → alert.
 * Output: scripts/results/precision_trend.json
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ROOT       = path.join(__dirname, '..');
const RESULT_DIR = path.join(ROOT, 'scripts', 'results');

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)
    .filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
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

async function fetchAll(q) {
  let all=[], page=0;
  while(true) {
    const rows = await sbGet(`${q}&limit=1000&offset=${page*1000}`);
    if(!Array.isArray(rows)||rows.length===0) break;
    all=all.concat(rows); if(rows.length<1000) break; page++;
  }
  return all;
}

// DNA clause definitions (must match tradeOps.ts exactly)
const DNA_CLAUSES = [
  {
    id: 'A', label: 'VolPre5≥3.18 + CLTrend≥63',
    test: r => r.vol_pre5 >= 3.18 && r.cl_trend >= 63,
  },
  {
    id: 'B', label: 'UpperWick≤1.38 + InflectionScore≥34',
    test: r => r.upper_wick_pct <= 1.38 && r.inflection_score >= 34,
  },
  {
    id: 'C', label: 'UCGoldmine=true',
    test: r => r.uc_goldmine === true,
  },
  {
    id: 'D', label: 'VolPre5≥3.18 + InflectionScore≥34',
    test: r => r.vol_pre5 >= 3.18 && r.inflection_score >= 34,
  },
  {
    id: 'ANY', label: 'Any DNA clause (>5% Hunt union)',
    test: r => (r.vol_pre5 >= 3.18 && r.cl_trend >= 63) ||
               (r.upper_wick_pct <= 1.38 && r.inflection_score >= 34) ||
               r.uc_goldmine === true ||
               (r.vol_pre5 >= 3.18 && r.inflection_score >= 34),
  },
];

function precision(rows) {
  if (rows.length === 0) return null;
  const hits = rows.filter(r => r.next_day_chg_pct >= 5).length;
  return { prec: hits / rows.length, n: rows.length, hits };
}

function windowRows(rows, daysBack) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutStr = cutoff.toISOString().slice(0,10);
  return rows.filter(r => r.scan_date >= cutStr);
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║  UC ROLLING PRECISION TRACKER — DRIFT DETECTION       ║');
  console.log('╚═══════════════════════════════════════════════════════╝\n');

  const raw = await fetchAll(
    `pbfb_uc_logger?select=scan_date,next_day_chg_pct,uc_goldmine,vol_pre5,cl_trend,upper_wick_pct,inflection_score,uc_score` +
    `&next_day_chg_pct=not.is.null&order=scan_date.desc`
  );
  console.log(`Total labeled rows: ${raw.length}`);

  const windows = [
    { label: '30d',  days: 30 },
    { label: '60d',  days: 60 },
    { label: '90d',  days: 90 },
    { label: 'All',  days: 9999 },
  ];

  const results = {};
  const alerts  = [];

  for (const clause of DNA_CLAUSES) {
    results[clause.id] = { label: clause.label, windows: {} };
    let prevPrec = null;
    for (const win of windows) {
      const wRows   = windowRows(raw, win.days).filter(clause.test);
      const p       = precision(wRows);
      results[clause.id].windows[win.label] = p;
      if (p) {
        const pct = (p.prec * 100).toFixed(1);
        const drift = prevPrec != null ? ((p.prec - prevPrec) * 100).toFixed(1) : 'N/A';
        console.log(`  DNA-${clause.id} [${win.label}]: N=${p.n.toString().padStart(4)}  Hits=${p.hits}  Prec=${pct}%  Δ=${drift}pp`);
        // Drift alert: 30d precision < 60d precision by more than 3pp
        if (win.label === '30d' && prevPrec != null && prevPrec - p.prec > 0.03) {
          const msg = `DNA-${clause.id}: 30d precision ${pct}% vs 60d ${(prevPrec*100).toFixed(1)}% — drift of ${((prevPrec-p.prec)*100).toFixed(1)}pp detected`;
          alerts.push(msg);
          console.log(`  ⚠ DRIFT ALERT: ${msg}`);
        }
      }
      if (win.label === '60d' && p) prevPrec = p.prec;
    }
    console.log();
  }

  // Overall base rate by window
  console.log('  BASE RATE BY WINDOW:');
  for (const win of windows) {
    const wRows = windowRows(raw, win.days);
    if (wRows.length > 0) {
      const br = wRows.filter(r => r.next_day_chg_pct >= 5).length / wRows.length;
      console.log(`    [${win.label}] N=${wRows.length}  BaseRate=${(br*100).toFixed(2)}%`);
    }
  }

  // Precision trend: is model improving or degrading over time?
  const anyClause = DNA_CLAUSES.find(c => c.id === 'ANY');
  const last30  = precision(windowRows(raw, 30).filter(anyClause.test));
  const prev30  = precision(windowRows(raw, 60).filter(anyClause.test).filter(r => {
    const cutoff30 = new Date(); cutoff30.setDate(cutoff30.getDate() - 30);
    return r.scan_date < cutoff30.toISOString().slice(0,10);
  }));

  const trend = last30 && prev30
    ? (last30.prec - prev30.prec) * 100
    : null;

  console.log(`\n  TREND (last 30d vs prior 30d): ${trend != null ? (trend >= 0 ? '+' : '') + trend.toFixed(1) + 'pp' : 'insufficient data'}`);
  if (trend != null && trend < -3) {
    alerts.push(`Overall DNA filter: precision declining ${trend.toFixed(1)}pp over last 30 days — consider re-mining`);
  }

  const out = {
    generated: new Date().toISOString(),
    total_labeled: raw.length,
    alerts,
    drift_detected: alerts.length > 0,
    clauses: results,
    trend_30d_vs_prior_30d: trend,
    recommendation: alerts.length > 0
      ? 'REMINE: Run uc_enhanced_dna.js to find updated thresholds'
      : 'STABLE: Current DNA clauses performing within expected range',
  };

  const outPath = path.join(RESULT_DIR, 'precision_trend.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n  ${alerts.length > 0 ? '⚠ ' + alerts.length + ' DRIFT ALERT(S)' : '✓ No drift detected'}`);
  console.log(`  JSON → ${outPath}\n`);
  return out;
}

module.exports = { main };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
