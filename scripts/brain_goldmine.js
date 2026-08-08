'use strict';
// Brain V2 — Goldmine Analysis v2
// Uses classification field as outcome label (no forward labels needed).
//
// SCHEDULED RERUN: 2026-08-12
//   Brain deployed 2026-07-12. Forward labels (hit_t1/hit_t2/stopped_out) need 20 trading days
//   (30 calendar day buffer). First labeled rows available ~2026-08-11.
//   On 2026-08-12, re-run with forward labels:
//     node scripts/brain_goldmine.js --forward
//   This will use hit_t1 (reached +8% in 20d) as the TRUE outcome — replacing classification proxy.
//
// INITIAL RUN: 2026-08-02 results in comments below as baseline.
//   actionable  = screener fired BUY/STRONG_BUY day BEFORE the UC — ✅ caught
//   on_radar    = screener was watching (PRE_BREAKOUT) — partial catch
//   zone_only   = compression detected, no buy signal
//   thin_lock   = too thin/locked to trade
//   missed      = screener completely missed it — ❌
//
// Goldmine question: what FAS features separate 'actionable' from 'missed'?
// Secondary:        what predicts 'actionable' vs 'on_radar'?

const https  = require('https');
const fs     = require('fs');
const path   = require('path');

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
        'accept-profile': 'public',
        'range-unit': 'items',
        range: '0-1999',    // up to 2000 rows
      }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error(`Parse: ${body.slice(0,200)}`)); }
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
const pct  = (n,d)    => d > 0 ? (n/d*100).toFixed(1)+'%' : '-  ';
const f1   = v        => typeof v==='number' ? v.toFixed(1) : '-';
const f2   = v        => typeof v==='number' ? v.toFixed(2) : '-';
const pad  = (s,n)    => String(s).padStart(n);
const sep  = (n,c='─')=> c.repeat(n);

const FAS = ['close_loc','body_pct','upper_wick_pct','vol_ratio_20','vol_vs_pre5','range_atr','rsi2','zone_len','zone_tightness'];
const FAS_LABEL = {
  close_loc:      'CloseLoc%   (close pos in range 0-100)',
  body_pct:       'BodyPct%    (body vs total range)',
  upper_wick_pct: 'UpperWick%  (upper shadow vs range)',
  vol_ratio_20:   'VolR20x     (vol vs 20d avg)',
  vol_vs_pre5:    'VolPre5x    (vol vs prev 5d avg)',
  range_atr:      'RangeATR    (candle range / ATR14)',
  rsi2:           'RSI2        (2-period RSI)',
  zone_len:       'ZoneLen     (consolidation bars)',
  zone_tightness: 'ZoneTight%  (consolidation range %)',
};

async function main() {
  console.log('\n' + '═'.repeat(76));
  console.log('  PBFB Brain V2 — GOLDMINE ANALYSIS  (Upper Circuit Pre-detection)');
  console.log('  classification = outcome label:  actionable/on_radar/zone_only/missed');
  console.log('═'.repeat(76) + '\n');

  // Fetch all n_before=1 events
  const all = await sbGet('pbfb_uc_events?select=*&n_before=eq.1&order=event_date.desc&limit=2000');
  if (!Array.isArray(all)) { console.error('Error:', JSON.stringify(all)); return; }

  const total = all.length;
  const A = all.filter(r => r.classification === 'actionable');   // ✅ caught
  const R = all.filter(r => r.classification === 'on_radar');     // 👁 watching
  const Z = all.filter(r => r.classification === 'zone_only');    // 📦 zone
  const TL= all.filter(r => r.classification === 'thin_lock');    // 🔒 thin
  const M = all.filter(r => r.classification === 'missed');       // ❌ missed
  const tradeable = [...A, ...R];  // screener at least noticed them

  console.log(`Total UC events (n_before=1):  ${total}`);
  console.log(`  ✅ actionable (BUY/STRONG before UC):  ${A.length}  ${pct(A.length,total)}`);
  console.log(`  👁 on_radar  (PRE_BREAKOUT):           ${R.length}  ${pct(R.length,total)}`);
  console.log(`  📦 zone_only (compression, no signal): ${Z.length}  ${pct(Z.length,total)}`);
  console.log(`  🔒 thin_lock (too thin/locked):        ${TL.length}  ${pct(TL.length,total)}`);
  console.log(`  ❌ missed    (screener blind spot):     ${M.length}  ${pct(M.length,total)}`);
  console.log(`\n  Detection rate (actionable/total):     ${pct(A.length,total)}`);
  console.log(`  Opportunity rate (actionable+radar):   ${pct(tradeable.length,total)}`);

  // ── Phase 1: FAS discriminant — actionable vs missed ─────────────────────
  console.log('\n\n' + '═'.repeat(76));
  console.log('  PHASE 1: FAS Features — Actionable vs Missed');
  console.log('═'.repeat(76));
  const fasA = A.filter(r => r.close_loc !== null);
  const fasM = M.filter(r => r.close_loc !== null);
  console.log(`\n  Actionable with FAS: ${fasA.length}   Missed with FAS: ${fasM.length}\n`);

  if (fasA.length >= 5 && fasM.length >= 5) {
    const signals = [];
    console.log(`  ${'Feature'.padEnd(42)} ${'Actionable'.padStart(10)} ${'Missed'.padStart(10)} ${'Delta'.padStart(8)} ${'Strength'}`);
    console.log('  ' + sep(80));
    for (const k of FAS) {
      const wA = fasA.map(r=>r[k]).filter(v=>v!==null);
      const wM = fasM.map(r=>r[k]).filter(v=>v!==null);
      if (wA.length < 5 || wM.length < 5) continue;
      const mA = mean(wA), mM = mean(wM), delta = mA - mM;
      const pool = Math.sqrt((std(wA)**2 + std(wM)**2) / 2);
      const d    = pool > 0 ? Math.abs(delta) / pool : 0;
      const star = d >= 0.7 ? '★★★ STRONG' : d >= 0.4 ? '★★  MOD   ' : d >= 0.2 ? '★   WEAK  ' : '    tiny  ';
      if (d >= 0.2) signals.push({ k, mA, mM, delta, d });
      const label = (FAS_LABEL[k] || k).padEnd(42);
      console.log(`  ${label} ${f1(mA).padStart(10)} ${f1(mM).padStart(10)} ${(delta>=0?'+':'')+f1(delta).padStart(7)} ${star}`);
    }

    if (signals.length) {
      console.log('\n  ── Screener tuning recommendations ──');
      for (const s of signals.sort((a,b)=>b.d-a.d)) {
        const dir = s.delta > 0
          ? `MIN threshold: >${f2(s.mM + 0.5*(s.mA-s.mM))} (midpoint)`
          : `MAX threshold: <${f2(s.mM - 0.5*(Math.abs(s.delta)))} (midpoint)`;
        console.log(`  ${s.k.padEnd(18)} d=${s.d.toFixed(2)}  Act=${f1(s.mA)} Miss=${f1(s.mM)}  → ${dir}`);
      }
    }
  }

  // ── Phase 2: Actionable vs On-Radar (why did on_radar not fire?) ─────────
  console.log('\n\n' + '═'.repeat(76));
  console.log('  PHASE 2: FAS Features — Actionable vs On-Radar (what pushed to BUY?)');
  console.log('═'.repeat(76));
  const fasR = R.filter(r => r.close_loc !== null);
  if (fasA.length >= 5 && fasR.length >= 5) {
    console.log(`\n  Actionable: ${fasA.length}   On-Radar: ${fasR.length}\n`);
    console.log(`  ${'Feature'.padEnd(42)} ${'Actionable'.padStart(10)} ${'On-Radar'.padStart(10)} ${'Delta'.padStart(8)}`);
    console.log('  ' + sep(72));
    for (const k of FAS) {
      const wA = fasA.map(r=>r[k]).filter(v=>v!==null);
      const wR = fasR.map(r=>r[k]).filter(v=>v!==null);
      if (wA.length < 5 || wR.length < 5) continue;
      const mA = mean(wA), mR = mean(wR), delta = mA - mR;
      const pool = Math.sqrt((std(wA)**2 + std(wR)**2) / 2);
      const d    = pool > 0 ? Math.abs(delta) / pool : 0;
      if (d >= 0.15) {
        const dir = delta > 0 ? '▲ Act higher' : '▼ Act lower';
        console.log(`  ${(FAS_LABEL[k]||k).padEnd(42)} ${f1(mA).padStart(10)} ${f1(mR).padStart(10)} ${(delta>=0?'+':'')+f1(delta).padStart(7)}  d=${d.toFixed(2)} ${dir}`);
      }
    }
  }

  // ── Phase 3: UC move_pct by classification ────────────────────────────────
  console.log('\n\n' + '═'.repeat(76));
  console.log('  PHASE 3: UC Move% by Classification  (how big was the move we caught?)');
  console.log('═'.repeat(76) + '\n');
  const groups = { actionable: A, on_radar: R, zone_only: Z, thin_lock: TL, missed: M };
  console.log(`  ${'Classification'.padEnd(16)} ${'N'.padStart(5)} ${'Mean%'.padStart(8)} ${'Med%'.padStart(7)} ${'Max%'.padStart(7)} ${'≥10%'.padStart(7)} ${'≥20%'.padStart(7)}`);
  console.log('  ' + sep(65));
  for (const [label, rows] of Object.entries(groups)) {
    const mvs = rows.map(r=>r.move_pct).filter(v=>v!=null&&v>0);
    if (!mvs.length) { console.log(`  ${label.padEnd(16)} ${pad(rows.length,5)}   (no move_pct data)`); continue; }
    mvs.sort((a,b)=>a-b);
    const med = mvs[Math.floor(mvs.length/2)];
    console.log(`  ${label.padEnd(16)} ${pad(mvs.length,5)} ${f1(mean(mvs)).padStart(8)} ${f1(med).padStart(7)} ${f1(Math.max(...mvs)).padStart(7)} ${pct(mvs.filter(v=>v>=10).length,mvs.length).padStart(7)} ${pct(mvs.filter(v=>v>=20).length,mvs.length).padStart(7)}`);
  }

  // ── Phase 4: Param set / archetype detection quality ──────────────────────
  console.log('\n\n' + '═'.repeat(76));
  console.log('  PHASE 4: Archetype Detection Quality  (which param_set catches most UCs?)');
  console.log('═'.repeat(76) + '\n');
  const byPS = {};
  for (const r of all) {
    const k = r.best_param_set || r.archetype_type || 'none';
    if (!byPS[k]) byPS[k] = { A:0, R:0, Z:0, TL:0, M:0, total:0, moves:[] };
    byPS[k][r.classification?.[0]?.toUpperCase()||'M']++;
    byPS[k].total++;
    if (r.move_pct) byPS[k].moves.push(r.move_pct);
  }
  const shortKey = k => k.replace('optimized_','').replace('circuit_breaker_v2','CB')
    .replace('ors_prime_reversal','ORS').replace('sniper_95plus','PS')
    .replace('deployable_20plus','VF').replace('highprecision_15plus','CC')
    .replace('elite_10plus','MP').replace('ultraselective_8plus','ES');
  const psRows = Object.entries(byPS).sort((a,b)=>b[1].A-a[1].A);
  console.log(`  ${'Param Set'.padEnd(28)} ${'Total'.padStart(6)} ${'✅Act%'.padStart(8)} ${'👁Rad%'.padStart(8)} ${'❌Miss%'.padStart(8)} ${'AvgMove%'.padStart(10)}`);
  console.log('  ' + sep(74));
  for (const [k,v] of psRows) {
    if (!v.total) continue;
    const sk = shortKey(k).slice(0,28).padEnd(28);
    const mv = v.moves.length ? f1(mean(v.moves)) : '-';
    console.log(`  ${sk} ${pad(v.total,6)} ${pct(v.A,v.total).padStart(8)} ${pct(v.R,v.total).padStart(8)} ${pct(v.M,v.total).padStart(8)} ${mv.padStart(10)}`);
  }

  // ── Phase 5: RSI2 bands — where do UC stocks sit? ─────────────────────────
  console.log('\n\n' + '═'.repeat(76));
  console.log('  PHASE 5: RSI2 at D-1  (momentum state before UC)');
  console.log('═'.repeat(76) + '\n');
  const withRsi = all.filter(r => r.rsi2 !== null);
  const rsiBands = [
    { label: 'Oversold  <20',  fn: r => r.rsi2 < 20 },
    { label: 'Low    20-40',   fn: r => r.rsi2 >= 20 && r.rsi2 < 40 },
    { label: 'Neutral 40-60',  fn: r => r.rsi2 >= 40 && r.rsi2 < 60 },
    { label: 'High   60-80',   fn: r => r.rsi2 >= 60 && r.rsi2 < 80 },
    { label: 'Overbought >80', fn: r => r.rsi2 >= 80 },
  ];
  console.log(`  ${'RSI2 Band'.padEnd(18)} ${'N'.padStart(5)} ${'✅Act%'.padStart(8)} ${'❌Miss%'.padStart(8)} ${'AvgRSI2'.padStart(9)} ${'AvgMove%'.padStart(10)}`);
  console.log('  ' + sep(62));
  for (const b of rsiBands) {
    const rs = withRsi.filter(b.fn);
    if (!rs.length) continue;
    const rsiVals = rs.map(r=>r.rsi2);
    const mvs = rs.map(r=>r.move_pct).filter(v=>v!=null);
    const actN = rs.filter(r=>r.classification==='actionable').length;
    const misN = rs.filter(r=>r.classification==='missed').length;
    console.log(`  ${b.label.padEnd(18)} ${pad(rs.length,5)} ${pct(actN,rs.length).padStart(8)} ${pct(misN,rs.length).padStart(8)} ${f1(mean(rsiVals)).padStart(9)} ${mvs.length?f1(mean(mvs)).padStart(10):'         -'}`);
  }

  // ── Phase 6: Volume surge bands ───────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(76));
  console.log('  PHASE 6: Volume Surge at D-1  (how much vol surge before UC?)');
  console.log('═'.repeat(76) + '\n');
  const withVol = all.filter(r => r.vol_ratio_20 !== null);
  const volBands = [
    { label: 'Quiet   <1.5x',  fn: r => r.vol_ratio_20 < 1.5 },
    { label: 'Normal  1.5-3x', fn: r => r.vol_ratio_20 >= 1.5 && r.vol_ratio_20 < 3 },
    { label: 'Surge   3-6x',   fn: r => r.vol_ratio_20 >= 3   && r.vol_ratio_20 < 6 },
    { label: 'Extreme >6x',    fn: r => r.vol_ratio_20 >= 6 },
  ];
  console.log(`  ${'Volume Band'.padEnd(16)} ${'N'.padStart(5)} ${'✅Act%'.padStart(8)} ${'❌Miss%'.padStart(8)} ${'AvgVol'.padStart(8)} ${'AvgMove%'.padStart(10)}`);
  console.log('  ' + sep(60));
  for (const b of volBands) {
    const rs = withVol.filter(b.fn);
    if (!rs.length) continue;
    const vols = rs.map(r=>r.vol_ratio_20);
    const mvs  = rs.map(r=>r.move_pct).filter(v=>v!=null);
    const actN = rs.filter(r=>r.classification==='actionable').length;
    const misN = rs.filter(r=>r.classification==='missed').length;
    console.log(`  ${b.label.padEnd(16)} ${pad(rs.length,5)} ${pct(actN,rs.length).padStart(8)} ${pct(misN,rs.length).padStart(8)} ${f1(mean(vols)).padStart(8)} ${mvs.length?f1(mean(mvs)).padStart(10):'         -'}`);
  }

  // ── Phase 7: Close location ───────────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(76));
  console.log('  PHASE 7: Close Location  (where does UC stock close day before?)');
  console.log('═'.repeat(76) + '\n');
  const withCL = all.filter(r => r.close_loc !== null);
  const clBands = [
    { label: 'Weak   <25',   fn: r => r.close_loc < 25 },
    { label: 'Low  25-50',   fn: r => r.close_loc >= 25 && r.close_loc < 50 },
    { label: 'High 50-75',   fn: r => r.close_loc >= 50 && r.close_loc < 75 },
    { label: 'Strong >75',   fn: r => r.close_loc >= 75 },
  ];
  console.log(`  ${'Close Loc'.padEnd(14)} ${'N'.padStart(5)} ${'✅Act%'.padStart(8)} ${'❌Miss%'.padStart(8)} ${'AvgCL'.padStart(8)} ${'AvgMove%'.padStart(10)}`);
  console.log('  ' + sep(58));
  for (const b of clBands) {
    const rs = withCL.filter(b.fn);
    if (!rs.length) continue;
    const cls  = rs.map(r=>r.close_loc);
    const mvs  = rs.map(r=>r.move_pct).filter(v=>v!=null);
    const actN = rs.filter(r=>r.classification==='actionable').length;
    const misN = rs.filter(r=>r.classification==='missed').length;
    console.log(`  ${b.label.padEnd(14)} ${pad(rs.length,5)} ${pct(actN,rs.length).padStart(8)} ${pct(misN,rs.length).padStart(8)} ${f1(mean(cls)).padStart(8)} ${mvs.length?f1(mean(mvs)).padStart(10):'         -'}`);
  }

  // ── Phase 8: Breakout tier vs detection ──────────────────────────────────
  console.log('\n\n' + '═'.repeat(76));
  console.log('  PHASE 8: Breakout Tier vs Detection Quality');
  console.log('═'.repeat(76) + '\n');
  const withTier = all.filter(r => r.near_breakout_tier);
  if (withTier.length > 0) {
    const tiers = [...new Set(withTier.map(r=>r.near_breakout_tier))].sort();
    console.log(`  ${'Tier'.padEnd(12)} ${'N'.padStart(5)} ${'✅Act%'.padStart(8)} ${'❌Miss%'.padStart(8)} ${'AvgMove%'.padStart(10)}`);
    console.log('  ' + sep(47));
    for (const t of tiers) {
      const rs  = withTier.filter(r=>r.near_breakout_tier===t);
      const mvs = rs.map(r=>r.move_pct).filter(v=>v!=null);
      const actN= rs.filter(r=>r.classification==='actionable').length;
      const misN= rs.filter(r=>r.classification==='missed').length;
      console.log(`  ${String(t).padEnd(12)} ${pad(rs.length,5)} ${pct(actN,rs.length).padStart(8)} ${pct(misN,rs.length).padStart(8)} ${mvs.length?f1(mean(mvs)).padStart(10):'         -'}`);
    }
  }

  // ── Phase 9: GOLDMINE COMBOS ──────────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(76));
  console.log('  PHASE 9: GOLDMINE COMBOS — Multi-Factor UC Pre-Detection Screen');
  console.log('  Goal: high actionable%, low missed%, meaningful N');
  console.log('═'.repeat(76) + '\n');

  const hasFas = all.filter(r => r.close_loc !== null && r.vol_ratio_20 !== null);
  const screens = [
    // Pure volume
    { l: 'Vol surge >3x 20d',                     fn: r => r.vol_ratio_20 >= 3 },
    { l: 'Vol surge >6x 20d (extreme)',            fn: r => r.vol_ratio_20 >= 6 },
    // Close location strength
    { l: 'Strong close CL>75',                     fn: r => r.close_loc >= 75 },
    { l: 'Strong close CL>85',                     fn: r => r.close_loc >= 85 },
    // Candle quality
    { l: 'Body>60% + CL>75 (bullish marubozu)',    fn: r => r.body_pct >= 60 && r.close_loc >= 75 },
    { l: 'Low UW<20 + CL>75 (no dist)',            fn: r => r.upper_wick_pct < 20 && r.close_loc >= 75 },
    // Volume + close
    { l: 'Vol>3x + CL>75',                         fn: r => r.vol_ratio_20 >= 3 && r.close_loc >= 75 },
    { l: 'Vol>3x + CL>85',                         fn: r => r.vol_ratio_20 >= 3 && r.close_loc >= 85 },
    // RSI combos
    { l: 'RSI2<30 + Vol>2x (oversold surge)',       fn: r => r.rsi2 !== null && r.rsi2 < 30 && r.vol_ratio_20 >= 2 },
    { l: 'RSI2>70 + Vol>3x (momentum surge)',       fn: r => r.rsi2 !== null && r.rsi2 > 70 && r.vol_ratio_20 >= 3 },
    // Zone + vol
    { l: 'TightZone<8% + Vol>3x',                  fn: r => r.zone_tightness !== null && r.zone_tightness < 8 && r.vol_ratio_20 >= 3 },
    { l: 'TightZone<5% + CL>75 (coil+strength)',   fn: r => r.zone_tightness !== null && r.zone_tightness < 5 && r.close_loc >= 75 },
    // Range burst
    { l: 'RangeATR>2x + Vol>3x',                   fn: r => r.range_atr >= 2 && r.vol_ratio_20 >= 3 },
    { l: 'RangeATR>3x + CL>75 (explosive day)',    fn: r => r.range_atr >= 3 && r.close_loc >= 75 },
    // Triple combos
    { l: 'Vol>3x + CL>75 + UW<20',                 fn: r => r.vol_ratio_20 >= 3 && r.close_loc >= 75 && r.upper_wick_pct < 20 },
    { l: 'Vol>3x + CL>75 + Body>50',               fn: r => r.vol_ratio_20 >= 3 && r.close_loc >= 75 && r.body_pct >= 50 },
    { l: 'Range>2x + Vol>3x + CL>75',              fn: r => r.range_atr >= 2 && r.vol_ratio_20 >= 3 && r.close_loc >= 75 },
    // GOLDMINE — all premium
    { l: '★ GOLDMINE: Vol>3x+CL>85+Body>60+UW<15', fn: r => r.vol_ratio_20 >= 3 && r.close_loc >= 85 && r.body_pct >= 60 && r.upper_wick_pct < 15 },
    { l: '★ ELITE: Range>2x+Vol>4x+CL>80+UW<20',   fn: r => r.range_atr >= 2 && r.vol_ratio_20 >= 4 && r.close_loc >= 80 && r.upper_wick_pct < 20 },
    { l: '★ UC_SNIPER: Vol>5x+CL>85+Range>2x',     fn: r => r.vol_ratio_20 >= 5 && r.close_loc >= 85 && r.range_atr >= 2 },
  ];

  console.log(`  Based on ${hasFas.length} FAS-tagged events (out of ${total} total)\n`);
  console.log(`  ${'Screen'.padEnd(44)} ${'N'.padStart(5)} ${'✅Act%'.padStart(8)} ${'👁Rad%'.padStart(7)} ${'❌Miss%'.padStart(8)} ${'🏆'}`);
  console.log('  ' + sep(86));

  const goldHits = [];
  for (const s of screens) {
    const rs   = hasFas.filter(s.fn);
    const actN = rs.filter(r=>r.classification==='actionable').length;
    const radN = rs.filter(r=>r.classification==='on_radar').length;
    const misN = rs.filter(r=>r.classification==='missed').length;
    if (!rs.length) { console.log(`  ${s.l.padEnd(44)} ${pad(0,5)}  (no matches)`); continue; }
    const actR = actN / rs.length;
    const star = actR >= 0.35 ? '🏆🏆🏆' : actR >= 0.25 ? '🏆🏆' : actR >= 0.18 ? '🏆' : '';
    if (actR >= 0.20 && rs.length >= 5) goldHits.push({ label: s.l, n: rs.length, actR, misR: misN/rs.length, rows: rs });
    console.log(`  ${s.l.padEnd(44)} ${pad(rs.length,5)} ${pct(actN,rs.length).padStart(8)} ${pct(radN,rs.length).padStart(7)} ${pct(misN,rs.length).padStart(8)} ${star}`);
  }

  // ── Phase 10: Best combo deep-dive ───────────────────────────────────────
  if (goldHits.length > 0) {
    const best = goldHits.sort((a,b)=>b.actR-a.actR)[0];
    console.log('\n\n' + '═'.repeat(76));
    console.log(`  PHASE 10: DEEP DIVE — Best Combo: "${best.label}"`);
    console.log(`  n=${best.n}  actionable=${(best.actR*100).toFixed(1)}%  missed=${(best.misR*100).toFixed(1)}%`);
    console.log('═'.repeat(76) + '\n');

    // FAS feature means for this subset
    const subFasA = best.rows.filter(r=>r.classification==='actionable');
    const subFasM = best.rows.filter(r=>r.classification==='missed');
    console.log(`  Within-combo actionable (${subFasA.length}) vs missed (${subFasM.length}):`);
    console.log(`\n  ${'Feature'.padEnd(20)} ${'Act mean'.padStart(10)} ${'Miss mean'.padStart(10)}`);
    console.log('  ' + sep(42));
    for (const k of FAS) {
      const wA = subFasA.map(r=>r[k]).filter(v=>v!==null);
      const wM = subFasM.map(r=>r[k]).filter(v=>v!==null);
      if (wA.length < 2) continue;
      console.log(`  ${k.padEnd(20)} ${f1(mean(wA)).padStart(10)} ${wM.length>=2 ? f1(mean(wM)).padStart(10) : '         -'}`);
    }

    // Recent examples from this combo
    const examples = best.rows
      .filter(r=>r.classification==='actionable')
      .sort((a,b)=>new Date(b.event_date||b.run_date)-new Date(a.event_date||a.run_date))
      .slice(0,10);
    if (examples.length > 0) {
      console.log(`\n  Recent actionable examples:\n`);
      console.log(`  ${'Date'.padEnd(12)} ${'Symbol'.padEnd(12)} ${'Stage'.padEnd(20)} ${'Move%'.padStart(7)} ${'Vol20x'.padStart(7)} ${'CL%'.padStart(6)}`);
      console.log('  ' + sep(68));
      for (const r of examples) {
        const stage = (r.best_stage||'-').slice(0,20).padEnd(20);
        console.log(`  ${(r.event_date||r.run_date||'').slice(0,12).padEnd(12)} ${(r.symbol||'').padEnd(12)} ${stage} ${f1(r.move_pct||0).padStart(7)} ${f1(r.vol_ratio_20||0).padStart(7)} ${f1(r.close_loc||0).padStart(6)}`);
      }
    }
  }

  // ── Phase 11: What the screener IS catching right now (unlabeled pipeline) ─
  console.log('\n\n' + '═'.repeat(76));
  console.log('  PHASE 11: Live Intelligence — BUY/STRONG_BUY signals (recent 30 events)');
  console.log('═'.repeat(76) + '\n');
  const buyEvents = all
    .filter(r => ['BUY','STRONG_BUY','ULTRA_STRONG_BUY'].includes(r.best_stage))
    .sort((a,b)=>new Date(b.run_date||b.event_date)-new Date(a.run_date||a.event_date))
    .slice(0,30);
  if (buyEvents.length > 0) {
    console.log(`  ${'RunDate'.padEnd(12)} ${'Symbol'.padEnd(12)} ${'Stage'.padEnd(20)} ${'ParamSet'.padEnd(18)} ${'Move%'.padStart(7)} ${'Vol20x'.padStart(7)} ${'CL%'.padStart(6)} ${'RSI2'.padStart(5)}`);
    console.log('  ' + sep(92));
    for (const r of buyEvents) {
      const stage = (r.best_stage||'-').slice(0,20).padEnd(20);
      const ps = (r.best_param_set||r.archetype_type||'-').replace('optimized_','').replace('circuit_breaker_v2','CB').replace('ors_prime_reversal','ORS').slice(0,18).padEnd(18);
      console.log(`  ${(r.run_date||r.event_date||'').slice(0,12).padEnd(12)} ${(r.symbol||'').padEnd(12)} ${stage} ${ps} ${f1(r.move_pct||0).padStart(7)} ${f1(r.vol_ratio_20||0).padStart(7)} ${f1(r.close_loc||0).padStart(6)} ${f1(r.rsi2||0).padStart(5)}`);
    }
  } else {
    console.log('  No BUY signals in the n_before=1 dataset.');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n\n' + '═'.repeat(76));
  console.log('  SUMMARY');
  console.log('═'.repeat(76));
  console.log(`
  Brain V2 database: ${total} UC events (n_before=1, day before upper circuit)
  Forward labels:    0 (need until 2026-08-11 for first batch to mature)
  Classification labels available NOW for all ${total} events.

  Key metrics to act on:
  ┌─ actionable rate overall: ${pct(A.length,total).padStart(7)}
  ├─ #BUY/STRONG signals seen: ${buyEvents.length} (in this export)
  ├─ FAS features available: ${hasFas.length}/${total} events
  └─ Forward labels mature: ~2026-08-11

  Next actions:
  1. Run brain_goldmine.js again on 2026-08-12 for true hit_t1 outcomes
  2. Implement FAS gates from Phase 1 discriminant (★★★ features) in stockEngine.ts
  3. Add neighborHitRate gate in live scan (call /api/brain-similar per signal)
  4. Surface Brain goldmine score as column in scan table
`);
}

main().catch(e => { console.error('Fatal:', e.message, e.stack); process.exit(1); });
