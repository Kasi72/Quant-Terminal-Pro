'use strict';
// UC Logger — 30-day precision / recall analysis
// Run after 30+ days of data: node scripts/uc_precision_analysis.js
//
// Reads pbfb_uc_logger where labeled_at IS NOT NULL and computes:
//   - True precision curve (real FP from non-UC stocks)
//   - Precision by score tier (ucElite / ucStrong / ucGoldmine)
//   - Precision by sector, stage, market_regime
//   - Feature distributions: true positive vs false positive
//   - Recommended score threshold for maximum F1

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const env = Object.fromEntries(
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
    .filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; })
);
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

function sbGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPA_URL}/rest/v1/${urlPath}`);
    const req = https.request(url, {
      headers: {
        apikey: SUPA_KEY,
        authorization: `Bearer ${SUPA_KEY}`,
        accept: 'application/json',
        'range-unit': 'items',
        range: '0-9999',
      }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error(`Parse error: ${body.slice(0,300)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const mean = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s,x)=>s+(x-m)**2,0)/arr.length);
}
function cohensD(posArr, negArr) {
  const mp = mean(posArr), mn = mean(negArr);
  const pool = Math.sqrt((std(posArr)**2 + std(negArr)**2) / 2);
  return pool > 0 ? (mp - mn) / pool : 0;
}
const f1  = v => typeof v === 'number' ? v.toFixed(1) : '-';
const f2  = v => typeof v === 'number' ? v.toFixed(2) : '-';
const f3  = v => typeof v === 'number' ? v.toFixed(3) : '-';
const pct = (n, d) => d > 0 ? (n/d*100).toFixed(1) + '%' : '-';
const sep = (n, c='─') => c.repeat(n);
const W   = 80;

async function main() {
  console.log('\n' + '═'.repeat(W));
  console.log('  UC LOGGER — REAL PRECISION ANALYSIS (production false-positive data)');
  console.log('═'.repeat(W) + '\n');

  const all = await sbGet('pbfb_uc_logger?select=*&labeled_at=not.is.null&order=scan_date.desc');
  if (!Array.isArray(all)) { console.error('Fetch error:', JSON.stringify(all)); return; }
  if (all.length === 0) { console.log('  No labeled rows yet. Run after 30 days.'); return; }

  const total   = all.length;
  const TP      = all.filter(r => r.hit_uc_next_day === true);
  const FP      = all.filter(r => r.hit_uc_next_day === false);
  const days    = new Set(all.map(r => r.scan_date)).size;
  const dateMin = all.map(r => r.scan_date).sort()[0];
  const dateMax = all.map(r => r.scan_date).sort().reverse()[0];

  console.log(`  Labeled rows:  ${total}  over ${days} trading days  (${dateMin} → ${dateMax})`);
  console.log(`  True Positive: ${TP.length} (hit UC next day)   ${pct(TP.length, total)}`);
  console.log(`  False Positive:${FP.length} (did NOT hit UC)    ${pct(FP.length, total)}`);
  console.log(`\n  Overall precision: ${pct(TP.length, total)}  (base rate: flagged stocks that hit UC)`);

  // ── Precision by score tier ──────────────────────────────────────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  TIER PRECISION (production data)');
  console.log('═'.repeat(W));

  const tiers = [
    { name: 'ucElite  ⚡', filter: r => r.uc_elite },
    { name: 'ucStrong 🎯', filter: r => r.uc_strong && !r.uc_elite },
    { name: 'ucGoldmine🏆', filter: r => r.uc_goldmine && !r.uc_strong },
    { name: 'score ≥ 65',   filter: r => r.uc_score >= 65 },
    { name: 'score ≥ 55',   filter: r => r.uc_score >= 55 },
    { name: 'score ≥ 45',   filter: r => r.uc_score >= 45 },
    { name: 'score ≥ 36',   filter: r => r.uc_score >= 36 },
    { name: 'all ≥ 35',     filter: r => r.uc_score >= 35 },
  ];

  console.log(`\n  ${'Tier'.padEnd(16)} ${'n'.padStart(5)} ${'TP'.padStart(5)} ${'Prec%'.padStart(8)} ${'F1'.padStart(7)}`);
  console.log('  ' + sep(W-2));

  const totalActualUC = TP.length;  // approximation — actual total UC stocks = much larger
  for (const t of tiers) {
    const rows = all.filter(t.filter);
    const n  = rows.length;
    if (n === 0) { console.log(`  ${t.name.padEnd(16)} ${'0'.padStart(5)}`); continue; }
    const tp = rows.filter(r => r.hit_uc_next_day).length;
    const prec   = tp / n;
    const recall = totalActualUC > 0 ? tp / totalActualUC : 0;
    const f1val  = prec + recall > 0 ? 2 * prec * recall / (prec + recall) : 0;
    console.log(`  ${t.name.padEnd(16)} ${String(n).padStart(5)} ${String(tp).padStart(5)} ${pct(prec,1).padStart(8)} ${f2(f1val).padStart(7)}`);
  }

  // ── Precision by score bucket (5-point buckets) ──────────────────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  PRECISION BY SCORE BUCKET');
  console.log('═'.repeat(W));
  const buckets = {};
  for (const r of all) {
    const b = Math.floor(r.uc_score / 5) * 5;
    if (!buckets[b]) buckets[b] = { n: 0, tp: 0 };
    buckets[b].n++;
    if (r.hit_uc_next_day) buckets[b].tp++;
  }
  console.log(`\n  ${'Score'.padStart(8)} ${'n'.padStart(6)} ${'TP'.padStart(6)} ${'Prec%'.padStart(8)}`);
  console.log('  ' + sep(W-2));
  for (const b of Object.keys(buckets).map(Number).sort((a,b)=>b-a)) {
    const { n, tp } = buckets[b];
    console.log(`  ${String(b).padStart(8)} ${String(n).padStart(6)} ${String(tp).padStart(6)} ${pct(tp,n).padStart(8)}`);
  }

  // ── Feature Cohen's d: TP vs FP ─────────────────────────────────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  FEATURE COHEN\'s d — True Positive vs False Positive (real production data)');
  console.log('═'.repeat(W));

  const features = ['uc_score','close_loc','rsi2','body_pct','upper_wick_pct',
                    'vol_ratio_20','vol_pre5','range_atr','cl_trend','rsi2_velocity',
                    'conviction','dd52wh','confluence_score','inflection_score','day_chg_pct'];

  console.log(`\n  ${'Feature'.padEnd(22)} ${'d(TP vs FP)'.padStart(13)} ${'mean_TP'.padStart(10)} ${'mean_FP'.padStart(10)}`);
  console.log('  ' + sep(W-2));

  const featureDs = [];
  for (const k of features) {
    const tpVals = TP.map(r => r[k]).filter(v => v != null);
    const fpVals = FP.map(r => r[k]).filter(v => v != null);
    if (tpVals.length < 3 || fpVals.length < 3) continue;
    const d    = cohensD(tpVals, fpVals);
    const star = Math.abs(d) >= 0.7 ? '★★★' : Math.abs(d) >= 0.4 ? '★★ ' : Math.abs(d) >= 0.2 ? '★  ' : '   ';
    console.log(`  ${k.padEnd(22)} ${f3(d).padStart(13)} ${f1(mean(tpVals)).padStart(10)} ${f1(mean(fpVals)).padStart(10)}  ${star}`);
    featureDs.push({ k, d });
  }
  if (featureDs.length) {
    featureDs.sort((a,b) => Math.abs(b.d) - Math.abs(a.d));
    console.log('\n  Best discriminants: ' + featureDs.slice(0,5).map(f => f.k).join(' > '));
  }

  // ── Precision by sector ─────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  PRECISION BY SECTOR (top 10 by precision)');
  console.log('═'.repeat(W));
  const bySector = {};
  for (const r of all) {
    const s = r.sector ?? 'UNKNOWN';
    if (!bySector[s]) bySector[s] = { n: 0, tp: 0 };
    bySector[s].n++;
    if (r.hit_uc_next_day) bySector[s].tp++;
  }
  const sectorRows = Object.entries(bySector)
    .filter(([,v]) => v.n >= 3)
    .map(([k,v]) => ({ sector: k, n: v.n, tp: v.tp, prec: v.tp / v.n }))
    .sort((a,b) => b.prec - a.prec)
    .slice(0, 10);
  console.log(`\n  ${'Sector'.padEnd(20)} ${'n'.padStart(5)} ${'TP'.padStart(5)} ${'Prec%'.padStart(8)}`);
  console.log('  ' + sep(W-2));
  for (const s of sectorRows) {
    console.log(`  ${s.sector.padEnd(20)} ${String(s.n).padStart(5)} ${String(s.tp).padStart(5)} ${pct(s.tp,s.n).padStart(8)}`);
  }

  // ── Precision by market regime ───────────────────────────────────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  PRECISION BY MARKET REGIME');
  console.log('═'.repeat(W));
  const byRegime = {};
  for (const r of all) {
    const reg = r.market_regime ?? 'UNKNOWN';
    if (!byRegime[reg]) byRegime[reg] = { n: 0, tp: 0 };
    byRegime[reg].n++;
    if (r.hit_uc_next_day) byRegime[reg].tp++;
  }
  console.log(`\n  ${'Regime'.padEnd(20)} ${'n'.padStart(5)} ${'TP'.padStart(5)} ${'Prec%'.padStart(8)}`);
  console.log('  ' + sep(W-2));
  for (const [reg, v] of Object.entries(byRegime)) {
    console.log(`  ${reg.padEnd(20)} ${String(v.n).padStart(5)} ${String(v.tp).padStart(5)} ${pct(v.tp,v.n).padStart(8)}`);
  }

  // ── Precision by stage ───────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  PRECISION BY SCREENER STAGE');
  console.log('═'.repeat(W));
  const byStage = {};
  for (const r of all) {
    const st = r.stage ?? 'UNKNOWN';
    if (!byStage[st]) byStage[st] = { n: 0, tp: 0 };
    byStage[st].n++;
    if (r.hit_uc_next_day) byStage[st].tp++;
  }
  console.log(`\n  ${'Stage'.padEnd(24)} ${'n'.padStart(5)} ${'TP'.padStart(5)} ${'Prec%'.padStart(8)}`);
  console.log('  ' + sep(W-2));
  for (const [st, v] of Object.entries(byStage).sort((a,b)=>b[1].tp/b[1].n - a[1].tp/a[1].n)) {
    console.log(`  ${st.padEnd(24)} ${String(v.n).padStart(5)} ${String(v.tp).padStart(5)} ${pct(v.tp,v.n).padStart(8)}`);
  }

  // ── Daily precision trend ────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  DAILY PRECISION TREND (last 30 trading days)');
  console.log('═'.repeat(W));
  const byDay = {};
  for (const r of all) {
    const d = r.scan_date;
    if (!byDay[d]) byDay[d] = { n: 0, tp: 0 };
    byDay[d].n++;
    if (r.hit_uc_next_day) byDay[d].tp++;
  }
  const dayRows = Object.entries(byDay).sort((a,b) => b[0].localeCompare(a[0])).slice(0, 30);
  console.log(`\n  ${'Date'.padEnd(14)} ${'n'.padStart(5)} ${'TP'.padStart(5)} ${'Prec%'.padStart(8)}`);
  console.log('  ' + sep(W-2));
  for (const [d, v] of dayRows) {
    const bar = '█'.repeat(Math.round(v.tp / v.n * 20));
    console.log(`  ${d.padEnd(14)} ${String(v.n).padStart(5)} ${String(v.tp).padStart(5)} ${pct(v.tp,v.n).padStart(8)}  ${bar}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(W));
  console.log('  SUMMARY');
  console.log('═'.repeat(W));
  console.log(`\n  Labeled production days:  ${days}`);
  console.log(`  Total UC candidates logged: ${total} (avg ${(total/days).toFixed(1)}/day)`);
  console.log(`  Overall real precision:   ${pct(TP.length, total)}`);
  console.log(`  ucElite precision:        ${pct(TP.filter(r=>r.uc_elite).length, all.filter(r=>r.uc_elite).length)}`);
  console.log(`\n  Next run recommended after: ${Math.max(0, 30 - days)} more trading days`);
  console.log('\n  Done. Use feature d-values above to update ucScore weights in lib/stockEngine.ts');
}

main().catch(console.error);
