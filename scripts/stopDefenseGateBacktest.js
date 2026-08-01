'use strict';

/**
 * Stop-defense gate audit.
 *
 * Generates production-engine signals over the OHLCV universe, replays each
 * trade through autoValidator v7, then measures whether close-below-review-stop
 * shields actually rescued trades or merely delayed losses.
 *
 * This is an audit script only. It does not alter app code or parameters.
 */

const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const DATA_DIR = process.env.OHLCV_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const WINDOW = Number(process.env.WINDOW || 300);
const MAX_HOLD = Number(process.env.MAX_HOLD || 20);
const TARGET_PCT = Number(process.env.TARGET_PCT || 5);
const OOS_DATE = process.env.OOS_DATE || '2025-05-05';
const N_WORKERS = Math.max(1, Number(process.env.N_WORKERS || 8));
const REQUIRE_PROMOTED = process.env.REQUIRE_PROMOTED !== '0';

const PARAM_SETS = [
  'optimized_deployable_20plus',
  'optimized_highprecision_15plus',
  'optimized_elite_10plus',
  'optimized_ultraselective_8plus',
  'sniper_95plus',
  'ors_prime_reversal',
];

const LABELS = {
  optimized_deployable_20plus: 'VolumeFootprint',
  optimized_highprecision_15plus: 'CompressionCoil',
  optimized_elite_10plus: 'MomentumPocket',
  optimized_ultraselective_8plus: 'EMAStack',
  sniper_95plus: 'PerfectStorm',
  ors_prime_reversal: 'ORS-Prime',
};

const BUY_STAGES = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function parseDate(s) {
  const raw = String(s || '').trim();
  if (!raw) return 0;
  const p = raw.split('-');
  if (p.length === 3) {
    if (p[0].length === 4) return Date.UTC(+p[0], +p[1] - 1, +p[2]);
    if (MON[p[1]] !== undefined) return Date.UTC(+p[2], MON[p[1]], +p[0]);
  }
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.getTime() : 0;
}

function isoDateFromTs(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function parseCsv(fp) {
  const text = fs.readFileSync(fp, 'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(',');
    if (p.length < 6) continue;
    const ts = parseDate(p[0]);
    const o = +p[1], h = +p[2], l = +p[3], c = +p[4], v = +p[5] || 0;
    if (!ts || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue;
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0 || h < l) continue;
    out.push({ ts, d: isoDateFromTs(ts), o, h, l, c, v });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

function computeATR14(c, idx) {
  if (idx < 1) return c[0] ? c[0].h - c[0].l : 0;
  const p = Math.min(14, idx);
  let s = 0;
  for (let j = idx - p + 1; j <= idx; j++) {
    const pc = c[j - 1]?.c ?? c[j].l;
    s += Math.max(c[j].h - c[j].l, Math.abs(c[j].h - pc), Math.abs(c[j].l - pc));
  }
  return s / p;
}

function swingLow5(c, idx) {
  let lo = Infinity;
  for (let j = Math.max(0, idx - 4); j <= idx; j++) lo = Math.min(lo, c[j].l);
  return Number.isFinite(lo) ? lo : 0;
}

function finitePositive(v) {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function normalizeTargets(entry, pe) {
  const t1 = finitePositive(pe?.target5);
  const t2 = finitePositive(pe?.target7);
  const t3 = finitePositive(pe?.target10);
  return {
    target1: t1 > entry ? t1 : entry * 1.05,
    target2: t2 > Math.max(entry, t1) ? t2 : entry * 1.075,
    target3: t3 > Math.max(entry, t2) ? t3 : entry * 1.10,
  };
}

function strictExitR(entry, hardStop, gateDay, replayCandles, maxHoldBars) {
  const next = replayCandles[gateDay]; // gate day is 1-based; this is next bar after it.
  const exit = next?.o ?? replayCandles[Math.min(replayCandles.length - 1, maxHoldBars - 1)]?.c ?? entry;
  const risk = entry - hardStop;
  return {
    strictExitPrice: exit,
    strictExitR: risk > 0 ? (exit - entry) / risk : 0,
    strictExitPct: entry > 0 ? (exit - entry) / entry * 100 : 0,
  };
}

function afterGateHit5(entry, gateDay, replayCandles, maxHoldBars) {
  const target = entry * (1 + TARGET_PCT / 100);
  for (let i = gateDay; i < Math.min(replayCandles.length, maxHoldBars); i++) {
    if (replayCandles[i]?.h >= target) return true;
  }
  return false;
}

function summarize(rows) {
  const n = rows.length;
  const sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);
  const decided = rows.filter(r => r.status !== 'open');
  const hit5 = rows.filter(r => r.mfe >= TARGET_PCT);
  const stopped = rows.filter(r => r.status === 'stopped');
  const shieldedAny = rows.filter(r => r.shieldedAny);
  const trueRescues = rows.filter(r => r.trueRescue);
  const savedTo5 = trueRescues.filter(r => r.afterShieldHit5);
  const betterThanStrict = trueRescues.filter(r => r.currentR > r.strictExitR + 0.05);
  const worseThanStrict = trueRescues.filter(r => r.currentR < r.strictExitR - 0.05);
  const noBenefit = trueRescues.filter(r => Math.abs(r.currentR - r.strictExitR) <= 0.05);
  const avgR = decided.length ? sum(decided, r => r.currentR) / decided.length : 0;
  const avgStrictR = trueRescues.length ? sum(trueRescues, r => r.strictExitR) / trueRescues.length : 0;
  const avgRescueR = trueRescues.length ? sum(trueRescues, r => r.currentR) / trueRescues.length : 0;
  const avgDeltaR = trueRescues.length ? sum(trueRescues, r => r.currentR - r.strictExitR) / trueRescues.length : 0;
  return {
    n,
    decided: decided.length,
    hit5: hit5.length,
    hit5Pct: n ? hit5.length / n * 100 : 0,
    stopped: stopped.length,
    stopPct: decided.length ? stopped.length / decided.length * 100 : 0,
    avgR,
    shieldedAny: shieldedAny.length,
    trueRescues: trueRescues.length,
    trueRescueRate: n ? trueRescues.length / n * 100 : 0,
    savedTo5: savedTo5.length,
    savedTo5Pct: trueRescues.length ? savedTo5.length / trueRescues.length * 100 : 0,
    betterThanStrict: betterThanStrict.length,
    worseThanStrict: worseThanStrict.length,
    noBenefit: noBenefit.length,
    preventionRate: trueRescues.length ? betterThanStrict.length / trueRescues.length * 100 : 0,
    harmRate: trueRescues.length ? worseThanStrict.length / trueRescues.length * 100 : 0,
    avgStrictR,
    avgRescueR,
    avgDeltaR,
    failedReview: rows.filter(r => r.failedReview).length,
    trailA: rows.filter(r => r.trailA).length,
    trailB: rows.filter(r => r.trailB).length,
  };
}

function printSummary(label, s) {
  const f = (x, d = 1) => Number.isFinite(x) ? x.toFixed(d) : '0.0';
  return [
    label.padEnd(17),
    String(s.n).padStart(5),
    (f(s.hit5Pct) + '%').padStart(8),
    (f(s.stopPct) + '%').padStart(8),
    f(s.avgR, 3).padStart(8),
    String(s.shieldedAny).padStart(7),
    String(s.trueRescues).padStart(7),
    (f(s.savedTo5Pct) + '%').padStart(9),
    (f(s.preventionRate) + '%').padStart(10),
    (f(s.harmRate) + '%').padStart(8),
    f(s.avgDeltaR, 3).padStart(9),
    String(s.failedReview).padStart(7),
    String(s.trailA).padStart(6),
    String(s.trailB).padStart(6),
  ].join('  ');
}

if (!isMainThread) {
  const { analyzeStock } = require('./_compiled_current/stockEngine.js');
  const { validateTrade } = require('./_compiled_current/autoValidator.js');
  const { files, oosTs } = workerData;
  const out = {};
  for (const ps of PARAM_SETS) out[ps] = [];

  for (const fp of files) {
    const candles = parseCsv(fp);
    if (candles.length < WINDOW + MAX_HOLD + 5) continue;
    const symbol = path.basename(fp).replace('_NS_OHLCV.csv', '.NS').replace(/\.csv$/i, '');
    const lastTrade = {};

    for (let i = WINDOW; i < candles.length - MAX_HOLD - 2; i++) {
      const win = candles.slice(i - WINDOW, i + 1).map(c => ({ ts: Math.floor(c.ts / 1000), o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }));
      for (const ps of PARAM_SETS) {
        if (i <= (lastTrade[ps] ?? -1)) continue;
        let res = null;
        try {
          res = analyzeStock(win, ps);
        } catch {
          continue;
        }
        if (!res || !BUY_STAGES.has(res.stage)) continue;
        if (REQUIRE_PROMOTED && res.tradePromoted === false) continue;

        const eIdx = i + 1;
        const entryBar = candles[eIdx];
        if (!entryBar) continue;
        const entry = entryBar.o;
        const pe = res.priceEngine || {};
        const reviewStop = finitePositive(pe.tacticalStop);
        const disasterStop = finitePositive(pe.disasterStop);
        const hardStop = disasterStop > 0 && (reviewStop <= 0 || disasterStop < reviewStop)
          ? disasterStop
          : reviewStop;
        if (!(entry > 0) || !(reviewStop > 0) || !(reviewStop < entry) || !(hardStop > 0) || !(hardStop < entry)) continue;

        const maxHoldBars = Math.max(1, Math.min(60, Math.trunc(pe.maxHoldBars || MAX_HOLD)));
        const replayCandles = candles.slice(eIdx + 1, eIdx + 1 + maxHoldBars + 1);
        if (!replayCandles.length) continue;
        const preEntryCandles = candles.slice(Math.max(0, eIdx - 80), eIdx);
        const targets = normalizeTargets(entry, pe);
        const trade = {
          symbol,
          stage: res.stage,
          entryPrice: entry,
          entryDate: entryBar.d,
          stopLoss: reviewStop,
          disasterStop: hardStop,
          target1: targets.target1,
          target2: targets.target2,
          target3: targets.target3,
          paramSetKey: ps,
          sector: '',
          conviction: res.confidence || 0,
          status: 'open',
          sw5LowAtEntry: finitePositive(pe.sw5LowAtEntry) || swingLow5(candles, i),
          atr14AtEntry: finitePositive(pe.atr14AtEntry) || computeATR14(candles, i),
          maxHoldBars,
        };

        const result = validateTrade(trade, replayCandles, { preEntryCandles, maxHoldBars });
        const gates = result.gateLog || [];
        const shields = gates.filter(g => g.result === 'SHIELDED' && g.stopKind === 'review');
        const trueShield = shields.find(g => Number.isFinite(g.close) && Number.isFinite(g.stopLevel) && g.close < g.stopLevel);
        const strict = trueShield ? strictExitR(entry, hardStop, trueShield.day, replayCandles, maxHoldBars) : {};
        const gateNames = trueShield
          ? (trueShield.gatesTested || []).filter(g => g.passed).map(g => g.gate)
          : [];
        const trailText = (result.trailLog || []).map(t => t.reason).join(' | ');

        out[ps].push({
          symbol,
          date: entryBar.d,
          ts: entryBar.ts,
          bucket: entryBar.ts < oosTs ? 'IS' : 'OOS',
          status: result.status,
          currentR: result.pnlR || 0,
          pnlPct: result.pnlPct || 0,
          mfe: result.mfe || 0,
          mae: result.mae || 0,
          shieldedAny: shields.length > 0,
          trueRescue: !!trueShield,
          firstRescueDay: trueShield?.day || 0,
          firstRescueDipPct: trueShield?.dipPct || 0,
          afterShieldHit5: trueShield ? afterGateHit5(entry, trueShield.day, replayCandles, maxHoldBars) : false,
          failedReview: gates.some(g => g.result === 'EXIT_PENDING' || g.triggerType === 'review_open'),
          trailA: /review trail/i.test(trailText),
          trailB: /Chandelier/i.test(trailText),
          gatesPassed: gateNames,
          strictExitR: strict.strictExitR ?? null,
          strictExitPct: strict.strictExitPct ?? null,
          deltaR: trueShield ? (result.pnlR || 0) - (strict.strictExitR || 0) : null,
        });

        lastTrade[ps] = eIdx + maxHoldBars;
      }
    }
  }
  parentPort.postMessage(out);
  process.exit(0);
}

async function main() {
  const allFiles = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.csv') && f !== 'ALL_SYMBOLS_OHLCV.csv')
    .map(f => path.join(DATA_DIR, f));
  const chunks = Array.from({ length: N_WORKERS }, (_, i) => allFiles.filter((_, j) => j % N_WORKERS === i));
  const oosTs = parseDate(OOS_DATE);
  const combined = {};
  for (const ps of PARAM_SETS) combined[ps] = [];

  console.log('Stop-defense gate backtest');
  console.log(`Data: ${DATA_DIR}`);
  console.log(`Files: ${allFiles.length} | workers: ${N_WORKERS} | window: ${WINDOW} | maxHold: ${MAX_HOLD} | OOS: ${OOS_DATE}`);
  console.log(`Signal filter: ${REQUIRE_PROMOTED ? 'BUY stages with tradePromoted != false' : 'all BUY stages'}\n`);

  let done = 0;
  await Promise.all(chunks.map(files => new Promise((resolve, reject) => {
    const w = new Worker(__filename, { workerData: { files, oosTs } });
    w.on('message', data => {
      for (const ps of PARAM_SETS) combined[ps].push(...data[ps]);
      done += files.length;
      process.stdout.write(`  processed ${done}/${allFiles.length}\r`);
      resolve();
    });
    w.on('error', reject);
    w.on('exit', code => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
    });
  })));

  console.log('\n');
  const hdr = [
    'Route'.padEnd(17), 'N'.padStart(5), 'Hit5'.padStart(8), 'Stop%'.padStart(8),
    'AvgR'.padStart(8), 'Shield'.padStart(7), 'Rescue'.padStart(7), 'Resc->5'.padStart(9),
    'Better%'.padStart(10), 'Harm%'.padStart(8), 'DeltaR'.padStart(9),
    'FailRv'.padStart(7), 'TrA'.padStart(6), 'TrB'.padStart(6),
  ].join('  ');
  console.log(hdr);
  console.log('-'.repeat(hdr.length));

  const rows = [];
  for (const ps of PARAM_SETS) {
    const all = summarize(combined[ps]);
    const oos = summarize(combined[ps].filter(r => r.bucket === 'OOS'));
    rows.push({ key: ps, label: LABELS[ps], all, oos });
    console.log(printSummary(LABELS[ps], all));
    console.log(printSummary(`${LABELS[ps]} OOS`, oos));
  }

  const allRows = Object.values(combined).flat();
  const rescueRows = allRows.filter(r => r.trueRescue);
  const gateCounts = {};
  const gateBadCounts = {};
  for (const r of rescueRows) {
    const bad = r.currentR < r.strictExitR - 0.05;
    for (const g of r.gatesPassed) {
      gateCounts[g] = (gateCounts[g] || 0) + 1;
      if (bad) gateBadCounts[g] = (gateBadCounts[g] || 0) + 1;
    }
  }

  console.log('\nGate contribution on true rescues (close below review stop):');
  for (const [gate, count] of Object.entries(gateCounts).sort((a, b) => b[1] - a[1])) {
    const bad = gateBadCounts[gate] || 0;
    console.log(`  ${gate.padEnd(34)} ${String(count).padStart(4)} rescues | ${String(bad).padStart(4)} later worse than strict`);
  }

  const worst = rescueRows
    .filter(r => r.currentR < r.strictExitR - 0.05)
    .sort((a, b) => a.deltaR - b.deltaR)
    .slice(0, 15);
  console.log('\nWorst delayed-loss rescues:');
  for (const r of worst) {
    console.log(`  ${r.symbol.padEnd(18)} ${r.date} ${r.status.padEnd(8)} strict=${r.strictExitR.toFixed(2)}R current=${r.currentR.toFixed(2)}R delta=${r.deltaR.toFixed(2)}R dip=${r.firstRescueDipPct.toFixed(2)}% gates=${r.gatesPassed.join('|')}`);
  }

  const best = rescueRows
    .filter(r => r.currentR > r.strictExitR + 0.05)
    .sort((a, b) => b.deltaR - a.deltaR)
    .slice(0, 15);
  console.log('\nBest genuine saves:');
  for (const r of best) {
    console.log(`  ${r.symbol.padEnd(18)} ${r.date} ${r.status.padEnd(8)} strict=${r.strictExitR.toFixed(2)}R current=${r.currentR.toFixed(2)}R delta=${r.deltaR.toFixed(2)}R after+5=${r.afterShieldHit5 ? 'Y' : 'N'} gates=${r.gatesPassed.join('|')}`);
  }

  const outDir = path.join(__dirname, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const tag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = path.join(outDir, `stop_defense_gate_audit_${tag}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    generated: new Date().toISOString(),
    config: { DATA_DIR, WINDOW, MAX_HOLD, TARGET_PCT, OOS_DATE, REQUIRE_PROMOTED },
    rows,
    allRows,
    gateCounts,
    gateBadCounts,
    worst,
    best,
  }, null, 2));
  console.log(`\nJSON -> ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
