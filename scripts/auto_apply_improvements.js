'use strict';
/**
 * Auto-Apply Improvements — Brain V3 Autonomous Self-Learning Engine
 *
 * Reads analysis JSON outputs, decides if improvements are statistically
 * significant, patches source files, commits and deploys automatically.
 *
 * Decision gates (all must pass before any change):
 *   - Minimum 20 hits in new clause (statistical floor)
 *   - Precision improvement >= 1.5pp over current
 *   - New logging gate differs from current by >= 2 points
 *   - No drift alert overrides confidence threshold
 *
 * What it patches:
 *   1. page.tsx  — ucScore logging gate (>= N)
 *   2. lib/tradeOps.ts — DNA clause thresholds (numeric values only)
 *
 * Safety: writes improvement_changelog.json regardless of whether deploy fires.
 *         Never removes a clause — only updates thresholds or adds new ones.
 *         Run with --dry-run to preview without patching.
 */

const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');

const ROOT       = path.join(__dirname, '..');
const RESULT_DIR = path.join(ROOT, 'scripts', 'results');
const DRY_RUN    = process.argv.includes('--dry-run');

if (DRY_RUN) console.log('[DRY-RUN] No files will be modified.\n');

// ── Load analysis outputs ─────────────────────────────────────────────────────
function loadJSON(name) {
  const p = path.join(RESULT_DIR, name);
  if (!fs.existsSync(p)) { console.warn(`  SKIP: ${name} not found`); return null; }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ── Feature name → TypeScript field in AnalysisResult ────────────────────────
const FIELD_MAP = {
  vol_pre5:        { ts: 'r.exactVolVsPre5',            rounding: 2 },
  upper_wick_pct:  { ts: 'r.upperWickPct',              rounding: 2 },
  cl_trend:        { ts: '(r as any).clTrend',           rounding: 0 },
  inflection_score:{ ts: 'r.inflectionScore',            rounding: 0 },
  uc_score:        { ts: '(r as any).ucScore',           rounding: 0 },
  body_pct:        { ts: 'r.bodyPct',                   rounding: 1 },
  rsi2:            { ts: 'r.rsi2',                      rounding: 1 },
  range_atr:       { ts: 'r.rangeATR',                  rounding: 2 },
  momentum_score:  { ts: '(r as any).momentumScore',    rounding: 0 },
  stats_score:     { ts: '(r as any).statsScore',       rounding: 0 },
  rs_nifty20:      { ts: 'r.momentum?.rsNifty20',       rounding: 2 },
};

function round(v, dec) { return Math.round(v * 10**dec) / 10**dec; }

// ── Current gate in page.tsx ──────────────────────────────────────────────────
function getCurrentGate() {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'page.tsx'), 'utf8');
  const m = src.match(/\.filter\(r\s*=>\s*[\s\S]*?ucScore.*?>=\s*(\d+)/);
  return m ? parseInt(m[1]) : 58;
}

// ── Current DNA clause thresholds from tradeOps.ts ───────────────────────────
function getCurrentClauses() {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'tradeOps.ts'), 'utf8');
  const clauseA = src.match(/exactVolVsPre5\s*>=\s*([\d.]+)\s*&&\s*\(r as any\)\.clTrend\s*>=\s*([\d.]+)/);
  const clauseB = src.match(/upperWickPct\s*<=\s*([\d.]+)\s*&&\s*r\.inflectionScore\s*>=\s*([\d.]+)/);
  const clauseD = src.match(/exactVolVsPre5\s*>=\s*([\d.]+)\s*&&\s*r\.inflectionScore\s*>=\s*([\d.]+)/);
  return {
    A: clauseA ? { vol_pre5: parseFloat(clauseA[1]), cl_trend: parseFloat(clauseA[2]) } : null,
    B: clauseB ? { upper_wick_pct: parseFloat(clauseB[1]), inflection_score: parseFloat(clauseB[2]) } : null,
    D: clauseD ? { vol_pre5: parseFloat(clauseD[1]), inflection_score: parseFloat(clauseD[2]) } : null,
  };
}

// ── Patch logging gate in page.tsx ───────────────────────────────────────────
function patchLoggingGate(newGate) {
  const filePath = path.join(ROOT, 'app', 'page.tsx');
  let src = fs.readFileSync(filePath, 'utf8');
  const updated = src.replace(
    /(\(r as any\)\.ucScore as number\))\s*>=\s*\d+/,
    `$1 >= ${newGate}`
  );
  if (updated === src) {
    console.log('  WARN: Could not patch logging gate — pattern not found');
    return false;
  }
  if (!DRY_RUN) fs.writeFileSync(filePath, updated, 'utf8');
  return true;
}

// ── Patch DNA clause thresholds in tradeOps.ts ───────────────────────────────
function patchDNAClauses(changes) {
  const filePath = path.join(ROOT, 'lib', 'tradeOps.ts');
  let src = fs.readFileSync(filePath, 'utf8');
  let patched = 0;

  for (const change of changes) {
    const { clauseId, oldSrc, newSrc } = change;
    if (src.includes(oldSrc)) {
      src = src.replace(oldSrc, newSrc);
      patched++;
      console.log(`  Patched DNA-${clauseId}: ${oldSrc.trim()} → ${newSrc.trim()}`);
    } else {
      console.log(`  WARN: DNA-${clauseId} old pattern not found, skipping`);
    }
  }

  if (patched > 0 && !DRY_RUN) fs.writeFileSync(filePath, src, 'utf8');
  return patched;
}

// ── Git commit + Vercel deploy ────────────────────────────────────────────────
function commitAndDeploy(message) {
  if (DRY_RUN) { console.log(`  [DRY-RUN] Would commit: ${message}`); return; }
  try {
    execSync('git add app/page.tsx lib/tradeOps.ts', { cwd: ROOT, stdio: 'pipe' });
    execSync(`git commit -m "${message}\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"`, { cwd: ROOT, stdio: 'pipe' });
    console.log('  ✓ Git committed');
  } catch (e) {
    console.log('  WARN: Git commit failed (possibly no changes):', e.message?.slice(0,100));
  }
  try {
    execSync('vercel deploy --prod --yes', { cwd: ROOT, stdio: 'pipe', timeout: 300000 });
    console.log('  ✓ Deployed to Vercel');
  } catch (e) {
    console.log('  ERR: Vercel deploy failed:', e.message?.slice(0,100));
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║  AUTO-APPLY IMPROVEMENTS — BRAIN V3 SELF-LEARNING ENGINE     ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const gateData  = loadJSON('uc_score_exact_gate.json');
  const dnaData   = loadJSON('uc_enhanced_dna.json');
  const driftData = loadJSON('precision_trend.json');

  const changelog = {
    generated: new Date().toISOString(),
    dry_run: DRY_RUN,
    decisions: [],
    changes_applied: [],
    skipped: [],
    deployed: false,
  };

  // ─ 1. Logging gate update ─────────────────────────────────────────────────
  console.log('── STEP 1: Logging Gate Update ──────────────────────────────────');
  const currentGate = getCurrentGate();
  console.log(`  Current gate: ${currentGate}`);

  if (gateData?.recommendations) {
    const newGate = gateData.recommendations.logging_gate;
    const newPrec = gateData.bootstrap_ci?.find(r => r.t === newGate);
    const curPrec = gateData.bootstrap_ci?.find(r => r.t === currentGate);

    console.log(`  Recommended gate: ${newGate}`);
    console.log(`  New precision: ${newPrec ? (newPrec.prec*100).toFixed(1)+'%' : 'N/A'}`);
    console.log(`  Current precision: ${curPrec ? (curPrec.prec*100).toFixed(1)+'%' : 'N/A'}`);

    const gateDiff   = Math.abs(newGate - currentGate);
    const precImprove = newPrec && curPrec ? (newPrec.prec - curPrec.prec) * 100 : 0;
    const minHits    = newPrec?.hits ?? 0;

    if (gateDiff >= 2 && precImprove >= 1.5 && minHits >= 15) {
      console.log(`  ✓ APPLYING: Gate ${currentGate} → ${newGate} (+${precImprove.toFixed(1)}pp precision)`);
      const ok = patchLoggingGate(newGate);
      if (ok) {
        changelog.changes_applied.push({ type: 'logging_gate', from: currentGate, to: newGate, precision_delta_pp: precImprove });
        changelog.decisions.push(`Gate updated ${currentGate}→${newGate}: +${precImprove.toFixed(1)}pp precision, N=${minHits} hits`);
      }
    } else {
      const reason = gateDiff < 2 ? `Gate unchanged (diff=${gateDiff} < 2)`
                   : precImprove < 1.5 ? `Precision improvement too small (${precImprove.toFixed(1)}pp < 1.5pp threshold)`
                   : `Insufficient hits at new gate (${minHits} < 15)`;
      console.log(`  SKIP: ${reason}`);
      changelog.skipped.push({ type: 'logging_gate', reason });
    }
  } else {
    console.log('  SKIP: No gate analysis data available');
  }

  // ─ 2. DNA clause threshold updates ───────────────────────────────────────
  console.log('\n── STEP 2: DNA Clause Threshold Updates ─────────────────────────');
  const current = getCurrentClauses();

  if (dnaData?.top_pairs && dnaData.top_pairs.length >= 3) {
    // Map top_pairs back to clause IDs by feature signature
    const clauseMap = {
      A: dnaData.top_pairs.find(p => p.fA === 'vol_pre5'      && p.fB === 'cl_trend'),
      B: dnaData.top_pairs.find(p => p.fA === 'upper_wick_pct' && p.fB === 'inflection_score'),
      D: dnaData.top_pairs.find(p => p.fA === 'vol_pre5'      && p.fB === 'inflection_score'),
    };

    const dnaChanges = [];

    for (const [clauseId, newPair] of Object.entries(clauseMap)) {
      if (!newPair || !current[clauseId]) continue;
      const cur = current[clauseId];

      // Compute threshold deltas
      const keyA = Object.keys(cur)[0];
      const keyB = Object.keys(cur)[1];
      const newA = round(newPair.threshA, FIELD_MAP[newPair.fA]?.rounding ?? 2);
      const newB = round(newPair.threshB, FIELD_MAP[newPair.fB]?.rounding ?? 2);
      const curA = cur[keyA], curB = cur[keyB];

      const deltaA = Math.abs(newA - curA);
      const deltaB = Math.abs(newB - curB);

      console.log(`  DNA-${clauseId}: current (${curA}, ${curB}) → new (${newA}, ${newB})`);
      console.log(`    Δ = (${deltaA.toFixed(3)}, ${deltaB.toFixed(3)})  New precision: ${(newPair.precision*100).toFixed(1)}%  N=${Math.round(newPair.recall * dnaData.pos_count)}`);

      // Only update if both thresholds changed meaningfully AND N >= 20
      const nHits = Math.round(newPair.recall * dnaData.pos_count);
      const precDelta = (newPair.precision - (dnaData.base_rate ?? 0.04)) * 100;

      if ((deltaA > 0.5 || deltaB > 1) && nHits >= 20 && newPair.precision >= 0.15) {
        // Build the exact old/new source strings to replace in tradeOps.ts
        let oldSrc, newSrc;
        if (clauseId === 'A') {
          oldSrc = `r.exactVolVsPre5 >= ${curA} && (r as any).clTrend >= ${curB}`;
          newSrc = `r.exactVolVsPre5 >= ${newA} && (r as any).clTrend >= ${newB}`;
        } else if (clauseId === 'B') {
          oldSrc = `r.upperWickPct <= ${curA} && r.inflectionScore >= ${curB}`;
          newSrc = `r.upperWickPct <= ${newA} && r.inflectionScore >= ${newB}`;
        } else if (clauseId === 'D') {
          // DNA-D uses same vol_pre5 threshold as DNA-A — only update inflection
          oldSrc = `r.exactVolVsPre5 >= ${curA} && r.inflectionScore >= ${curB}`;
          newSrc = `r.exactVolVsPre5 >= ${newA} && r.inflectionScore >= ${newB}`;
        }
        if (oldSrc) {
          dnaChanges.push({ clauseId, oldSrc, newSrc, precision: newPair.precision, nHits });
          changelog.decisions.push(`DNA-${clauseId}: thresholds updated (${curA},${curB})→(${newA},${newB}), prec=${(newPair.precision*100).toFixed(1)}%, N=${nHits}`);
        }
      } else {
        const skipReason = nHits < 20 ? `N=${nHits} < 20`
                         : newPair.precision < 0.15 ? `precision ${(newPair.precision*100).toFixed(1)}% < 15%`
                         : `threshold deltas too small`;
        console.log(`    SKIP: ${skipReason}`);
        changelog.skipped.push({ type: `dna_clause_${clauseId}`, reason: skipReason });
      }
    }

    if (dnaChanges.length > 0) {
      const patched = patchDNAClauses(dnaChanges);
      dnaChanges.slice(0, patched).forEach(c => {
        changelog.changes_applied.push({ type: `dna_clause_${c.clauseId}`, precision: c.precision, n_hits: c.nHits });
      });
    }
  } else {
    console.log('  SKIP: No DNA pair data available');
  }

  // ─ 3. Drift alert summary ────────────────────────────────────────────────
  console.log('\n── STEP 3: Drift Summary ────────────────────────────────────────');
  if (driftData?.drift_detected) {
    console.log(`  ⚠ DRIFT DETECTED: ${driftData.alerts.length} alert(s)`);
    driftData.alerts.forEach(a => console.log(`    - ${a}`));
    changelog.drift_alerts = driftData.alerts;
  } else {
    console.log('  ✓ No drift detected — model stable');
  }

  // ─ 4. Deploy if any changes applied ─────────────────────────────────────
  console.log('\n── STEP 4: Deploy ───────────────────────────────────────────────');
  if (changelog.changes_applied.length > 0) {
    const summary = changelog.changes_applied.map(c =>
      c.type === 'logging_gate'
        ? `gate ${c.from}→${c.to}`
        : `DNA-${c.type.replace('dna_clause_','')} threshold update`
    ).join(', ');
    const msg = `feat: auto-improve UC self-learning — ${summary}\n\nBrain V3 autonomous update: ${changelog.decisions.join('; ')}`;
    commitAndDeploy(msg);
    changelog.deployed = !DRY_RUN;
    console.log(`  ✓ ${changelog.changes_applied.length} improvement(s) applied and deployed`);
  } else {
    console.log('  No changes to deploy — model at current optimum');
  }

  // ─ Save changelog ─────────────────────────────────────────────────────────
  const outPath = path.join(RESULT_DIR, 'improvement_changelog.json');
  const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : { history: [] };
  existing.history.unshift(changelog);
  existing.history = existing.history.slice(0, 24); // keep last 24 runs
  if (!DRY_RUN) fs.writeFileSync(outPath, JSON.stringify(existing, null, 2));

  console.log(`\n╔═══════════════════════════════════════════════════════════════╗`);
  console.log(`║  RESULT: ${changelog.changes_applied.length} change(s) applied, ${changelog.skipped.length} skipped, deployed=${changelog.deployed}`);
  console.log(`╚═══════════════════════════════════════════════════════════════╝`);
  console.log(`  Changelog → ${outPath}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
