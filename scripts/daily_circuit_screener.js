'use strict';
// daily_circuit_screener.js — CircuitBreaker v2 daily scan
// Runs analyzeStock(bars, 'circuit_breaker_v2') against the full universe,
// ranks by inflectionScore, outputs JSON + console table.
//
// Usage:  node scripts/daily_circuit_screener.js
//         node scripts/daily_circuit_screener.js --top 50 --min-score 45
//         node scripts/daily_circuit_screener.js --stage BUY,STRONG_BUY,ULTRA_STRONG_BUY

const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { analyzeStock } = require('./_compiled_current/stockEngine');

// ── CLI args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getArg = (flag, def) => { const i = argv.indexOf(flag); return i !== -1 ? argv[i + 1] : def; };
const TOP        = parseInt(getArg('--top', '30'), 10);
const MIN_SCORE  = parseFloat(getArg('--min-score', '43'));   // BUY threshold
const STAGES_OK  = new Set((getArg('--stage', 'PRE_BREAKOUT,BUY,STRONG_BUY,ULTRA_STRONG_BUY')).split(','));
const WORKERS    = Math.min(parseInt(getArg('--workers', String(os.cpus().length)), 10), 12);
const PARAM_KEY  = 'circuit_breaker_v2';

// ── Paths ─────────────────────────────────────────────────────────────────────
const DATA_DIR   = getArg('--data', 'C:/Users/drkkr/Downloads/NIFTY ALL1783');
const OUT_DIR    = path.join(__dirname, 'results');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Stage rank for sorting ────────────────────────────────────────────────────
const STAGE_RANK = {
    ULTRA_STRONG_BUY: 4, STRONG_BUY: 3, BUY: 2, PRE_BREAKOUT: 1, NO_SIGNAL: 0,
};
const STAGE_LABEL = {
    ULTRA_STRONG_BUY: '⚡⚡ ULTRA', STRONG_BUY: '⚡ STRONG', BUY: '▲ BUY', PRE_BREAKOUT: '◆ PRE',
};

// ── CSV parser (reuse same pattern as other scripts) ─────────────────────────
function parseCSV(filePath) {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const header = lines[0].toLowerCase().split(',').map(h => h.trim());
    const iDate = header.indexOf('date'); const iO = header.indexOf('open');
    const iH = header.indexOf('high'); const iL = header.indexOf('low');
    const iC = header.indexOf('close'); const iV = header.indexOf('volume');
    if ([iDate, iO, iH, iL, iC, iV].includes(-1)) return null;
    const bars = [];
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 6) continue;
        const o = parseFloat(cols[iO]), h = parseFloat(cols[iH]);
        const l = parseFloat(cols[iL]), c = parseFloat(cols[iC]);
        const v = parseFloat(cols[iV]);
        if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c) || !isFinite(v)) continue;
        if (c <= 0 || v < 0) continue;
        const rawDate = cols[iDate].trim();
        const ts = Math.floor(new Date(rawDate).getTime() / 1000);
        if (!isFinite(ts)) continue;
        bars.push({ ts, o, h, l, c, v });
    }
    bars.sort((a, b) => a.ts - b.ts);
    return bars.length >= 80 ? bars : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORKER THREAD
// ═══════════════════════════════════════════════════════════════════════════════
if (!isMainThread) {
    const { files } = workerData;
    const results = [];
    for (const { symbol, filePath } of files) {
        try {
            const bars = parseCSV(filePath);
            if (!bars) continue;
            const r = analyzeStock(bars, PARAM_KEY, false);  // skip enrichment for speed
            if (!STAGES_OK.has(r.stage)) continue;
            if (r.inflectionScore < MIN_SCORE && r.stage === 'PRE_BREAKOUT') continue;

            const sig  = bars[bars.length - 1];
            const prev = bars[bars.length - 2] ?? sig;
            const dayChangePct = prev.c > 0 ? (sig.c / prev.c - 1) * 100 : 0;

            // Extract tuning debug (non-enumerable __tuning property)
            const t = Object.getOwnPropertyDescriptor(r, '__tuning')?.value ?? {};

            results.push({
                symbol,
                stage:          r.stage,
                score:          r.inflectionScore,
                conditionsMet:  r.archetypeConditions,
                lastClose:      sig.c,
                lastDate:       new Date(sig.ts * 1000).toISOString().slice(0, 10),
                dayChangePct:   +dayChangePct.toFixed(2),
                // Key circuit indicators (from __tuning)
                volRatioD1:     +(t.volRatioD1 ?? 0).toFixed(2),
                stochK:         +(t.stochK ?? 0).toFixed(1),
                rsi14:          +(t.rsi14 ?? 0).toFixed(1),
                closeLoc:       +(t.closeLoc ?? 0).toFixed(1),
                atrComp:        +(t.atrComp ?? 0).toFixed(3),
                upperWick:      +(t.upperWickPct ?? 0).toFixed(1),
                diPlus:         +(t.diPlus ?? 0).toFixed(1),
                diMinus:        +(t.diMinus ?? 0).toFixed(1),
                adx:            +(t.adx ?? 0).toFixed(1),
                mfi5:           +(t.mfi5 ?? 0).toFixed(1),
                volBullDom:     +(t.volBullDom ?? 0).toFixed(3),
                cmf20:          +(t.cmf20 ?? 0).toFixed(3),
                atrPct:         +(t.atrPct ?? 0).toFixed(2),
                isBull:         t.isBull ?? false,
                conditions:     r.checklist?.map(c => c.pass) ?? [],
                checklistLabels: r.checklist?.map(c => `${c.pass ? '✓' : '✗'} ${c.label}`) ?? [],
            });
        } catch { /* skip broken data */ }
    }
    parentPort.postMessage(results);
    return;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN THREAD
// ═══════════════════════════════════════════════════════════════════════════════
(async function main() {
    // ── Discover all CSV files ──────────────────────────────────────────────
    if (!fs.existsSync(DATA_DIR)) {
        console.error(`Data directory not found: ${DATA_DIR}`);
        process.exit(1);
    }
    const csvFiles = fs.readdirSync(DATA_DIR)
        .filter(f => f.toLowerCase().endsWith('.csv') && f !== 'ALL_SYMBOLS_OHLCV.csv')
        .map(f => ({
            symbol:   f.replace(/_OHLCV\.csv$/i, '').replace(/_NS$/, ''),
            filePath: path.join(DATA_DIR, f),
        }));

    if (csvFiles.length === 0) {
        console.error('No CSV files found in', DATA_DIR);
        process.exit(1);
    }

    console.log(`\n  ⚡ CIRCUIT BREAKER DAILY SCREENER — ${new Date().toLocaleDateString('en-IN', { weekday:'short', year:'numeric', month:'short', day:'numeric' })}`);
    console.log(`  Universe: ${csvFiles.length} stocks · Workers: ${WORKERS} · Min score: ${MIN_SCORE} · Top: ${TOP}`);
    console.log(`  ${'─'.repeat(70)}`);

    // ── Chunk files across workers ──────────────────────────────────────────
    const chunkSize = Math.ceil(csvFiles.length / WORKERS);
    const chunks    = [];
    for (let i = 0; i < csvFiles.length; i += chunkSize)
        chunks.push(csvFiles.slice(i, i + chunkSize));

    let done = 0;
    const allResults = await Promise.all(chunks.map(files => new Promise((resolve, reject) => {
        const w = new Worker(__filename, { workerData: { files } });
        w.on('message', data => { done += files.length; process.stdout.write(`\r  Scanned ${done}/${csvFiles.length}...`); resolve(data); });
        w.on('error', reject);
    })));
    process.stdout.write('\r' + ' '.repeat(40) + '\r');

    // ── Merge + rank ────────────────────────────────────────────────────────
    const flat = allResults.flat();
    flat.sort((a, b) =>
        (STAGE_RANK[b.stage] - STAGE_RANK[a.stage]) ||
        (b.score - a.score)
    );
    const top = flat.slice(0, TOP);

    if (top.length === 0) {
        console.log('\n  No candidates found. Try --min-score 35 to widen the filter.\n');
        return;
    }

    // ── Console output ──────────────────────────────────────────────────────
    const W = { sym: 12, stage: 14, sc: 5, cnd: 4, cls: 8, chg: 7, vol: 6, stk: 5, rsi: 5, loc: 5, atr: 6, wick: 5, di: 12 };

    const pad  = (s, w) => String(s).padEnd(w);
    const lpad = (s, w) => String(s).padStart(w);

    const hdr = [
        pad('SYMBOL', W.sym), pad('STAGE', W.stage),
        lpad('SCR', W.sc),  lpad('C/', W.cnd),
        lpad('CLOSE', W.cls), lpad('CHG%', W.chg),
        lpad('VOL×', W.vol), lpad('STK', W.stk), lpad('RSI', W.rsi),
        lpad('LOC%', W.loc), lpad('ATRc', W.atr), lpad('UW%', W.wick),
        pad('DI+/DI-/ADX', W.di),
    ].join(' ');

    console.log(`\n  ${hdr}`);
    console.log(`  ${'─'.repeat(hdr.length)}`);

    for (const r of top) {
        const stageStr = STAGE_LABEL[r.stage] ?? r.stage;
        const chgStr   = (r.dayChangePct >= 0 ? '+' : '') + r.dayChangePct.toFixed(1) + '%';
        const diStr    = `${r.diPlus}/${r.diMinus}/${r.adx}`;

        const line = [
            pad(r.symbol, W.sym),
            pad(stageStr, W.stage),
            lpad(r.score, W.sc),
            lpad(`${r.conditionsMet}/8`, W.cnd),
            lpad(r.lastClose.toFixed(1), W.cls),
            lpad(chgStr, W.chg),
            lpad(r.volRatioD1.toFixed(1) + '×', W.vol),
            lpad(r.stochK.toFixed(0), W.stk),
            lpad(r.rsi14.toFixed(0), W.rsi),
            lpad(r.closeLoc.toFixed(0), W.loc),
            lpad(r.atrComp.toFixed(2), W.atr),
            lpad(r.upperWick.toFixed(0) + '%', W.wick),
            pad(diStr, W.di),
        ].join(' ');

        console.log(`  ${line}`);
    }

    console.log(`  ${'─'.repeat(hdr.length)}`);
    console.log(`\n  Legend:`);
    console.log(`    SCR=inflection score (0-100) · C/=conditions met out of 8`);
    console.log(`    VOL×=today's vol / 20d avg · STK=stochastic %K · LOC%=close location in bar`);
    console.log(`    ATRc=ATR5/ATR14 ratio (>1.0=expanding) · UW%=upper wick %`);
    console.log(`    DI+/DI-/ADX=directional movement · must have DI+>DI-`);
    console.log(`\n  Stage summary:`);
    const stageCounts = {};
    for (const r of flat) stageCounts[r.stage] = (stageCounts[r.stage] ?? 0) + 1;
    for (const [s, cnt] of Object.entries(stageCounts).sort((a, b) => (STAGE_RANK[b[0]] ?? 0) - (STAGE_RANK[a[0]] ?? 0)))
        console.log(`    ${STAGE_LABEL[s] ?? s}: ${cnt}`);

    // ── Detailed diagnostics for top 5 ─────────────────────────────────────
    console.log(`\n  ${'─'.repeat(70)}`);
    console.log(`  TOP ${Math.min(5, top.length)} DETAILED CHECKLIST`);
    console.log(`  ${'─'.repeat(70)}`);
    for (const r of top.slice(0, 5)) {
        console.log(`\n  ${r.symbol}  [${r.stage} · Score ${r.score} · ${r.lastDate}]`);
        console.log(`    Close: ₹${r.lastClose.toFixed(2)}  Day: ${(r.dayChangePct >= 0 ? '+' : '')}${r.dayChangePct}%  MFI5: ${r.mfi5}  CMF20: ${r.cmf20}  BullVol: ${(r.volBullDom * 100).toFixed(0)}%`);
        for (const lbl of r.checklistLabels)
            console.log(`    ${lbl}`);
    }

    // ── Save JSON ───────────────────────────────────────────────────────────
    const ts       = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outPath  = path.join(OUT_DIR, `circuit_screener_${ts}.json`);
    const outData  = {
        generated:    new Date().toISOString(),
        paramKey:     PARAM_KEY,
        universe:     csvFiles.length,
        totalSignals: flat.length,
        topN:         TOP,
        minScore:     MIN_SCORE,
        results:      top.map(r => {
            const { checklistLabels, ...rest } = r; // drop verbose labels from JSON
            return rest;
        }),
    };
    fs.writeFileSync(outPath, JSON.stringify(outData, null, 2));
    console.log(`\n  Saved → ${outPath}`);
    console.log(`  Total signals: ${flat.length} / ${csvFiles.length} stocks screened\n`);
})();
