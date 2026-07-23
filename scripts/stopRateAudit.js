// SCIENTIFIC STOP RATE AUDIT
// Comprehensive analysis of stop causes + fix simulations
// Run: node scripts/stopRateAudit.js

'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const { validateTrade } = require('./_compiled_current/autoValidator.js');
const BACKUP   = 'C:/Users/drkkr/Downloads/DrKKR_Trades_Backup_2026-07-23 (1).json';
const CSV_DIR  = 'C:/Users/drkkr/Downloads/My Portfolio';
const TODAY    = '2026-07-24';

// ── helpers ────────────────────────────────────────────────────────────────
function parseCSV(fp) {
  const M = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
  return fs.readFileSync(fp,'utf8').trim().split('\n').slice(1).map(l=>{
    const [date,o,h,lo,cl,v] = l.split(',');
    const [d,m,y] = date.split('-');
    if (!M.hasOwnProperty(m)) return null;
    return { ts: new Date(+y,M[m],+d).getTime()/1000, o:+o,h:+h,l:+lo,c:+cl,v:+v,d:date };
  }).filter(Boolean).sort((a,b)=>a.ts-b.ts);
}

function fetchYahoo(sym, from, to) {
  const p1 = Math.floor(new Date(from).getTime()/1000);
  const p2 = Math.floor(new Date(to).getTime()/1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d`;
  return new Promise(res=>{
    const req = https.get(url,{headers:{'User-Agent':'Mozilla/5.0'}},r=>{
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>{
        try {
          const j = JSON.parse(d)?.chart?.result?.[0];
          if (!j) return res([]);
          const ts=j.timestamp??[], q=j.indicators?.quote?.[0]??{};
          res(ts.map((t,i)=>({
            ts:t, o:q.open?.[i]??q.close?.[i], h:q.high?.[i], l:q.low?.[i],
            c:q.close?.[i], v:q.volume?.[i]??0,
            d:new Date(t*1000).toISOString().slice(0,10)
          })).filter(c=>c.h&&c.l&&c.c).sort((a,b)=>a.ts-b.ts));
        } catch { res([]); }
      });
    });
    req.on('error',()=>res([])); req.setTimeout(8000,()=>{req.destroy();res([]);});
  });
}

function offsetDate(s,days){const d=new Date(s);d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);}

async function getCandles(sym, entryDate) {
  const bare = sym.replace('.NS','').replace('.BO','');
  const csv  = path.join(CSV_DIR, `${bare}_NS_OHLCV.csv`);
  let all = fs.existsSync(csv) ? parseCSV(csv)
            : await fetchYahoo(sym, offsetDate(entryDate,-60), offsetDate(entryDate,35));
  if (!all.length) return null;
  const ets  = new Date(entryDate).getTime()/1000;
  const idx  = all.findIndex(c=>c.ts >= ets-43200);
  if (idx<0) return null;
  return { all, entryIdx: idx };
}

function computeATR14simple(candles, i) {
  if (i<1) return candles[0]?.h-candles[0]?.l || 1;
  const p = Math.min(14,i); let s=0;
  for (let j=i-p+1;j<=i;j++) {
    const pc = candles[j-1]?.c ?? candles[j].l;
    s += Math.max(candles[j].h-candles[j].l, Math.abs(candles[j].h-pc), Math.abs(candles[j].l-pc));
  }
  return s/p;
}

function computeSwingLow5(candles, i) {
  const s=Math.max(0,i-4); let lo=Infinity;
  for (let j=s;j<=i;j++) lo=Math.min(lo,candles[j].l);
  return lo;
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  const trades = JSON.parse(fs.readFileSync(BACKUP,'utf8'));
  console.log(`\nLoaded ${trades.length} trades\n`);

  const results = [];
  for (const t of trades) {
    if (!t.entryPrice || !t.entryDate) continue;
    process.stdout.write(`  ${t.symbol.padEnd(20)} `);

    const cd = await getCandles(t.symbol, t.entryDate);
    if (!cd) { process.stdout.write('NO DATA\n'); results.push({t,err:'no_data'}); await delay(80); continue; }

    const { all, entryIdx } = cd;
    const preCandles = all.slice(0, entryIdx+1); // up to and including entry date
    const atrAtEntry = computeATR14simple(all, entryIdx);
    const sw5AtEntry = computeSwingLow5(all, entryIdx);
    const atrPct     = (atrAtEntry / t.entryPrice) * 100;
    const stopPct    = t.stopLoss>0 ? (t.entryPrice - t.stopLoss)/t.entryPrice*100 : 0;
    const stopToAtrRatio = atrAtEntry>0 ? (t.entryPrice-t.stopLoss)/atrAtEntry : 0;

    // ── Standard run (current gates, T+1 candles) ──────────────────────────
    const candlesSinceEntry = all.slice(entryIdx+1);
    if (candlesSinceEntry.length === 0) {
      process.stdout.write('NO POST-ENTRY DATA\n');
      results.push({t,err:'no_post_data',atrPct,stopPct,atrAtEntry,sw5AtEntry,stopToAtrRatio});
      await delay(80); continue;
    }

    const base = { symbol:t.symbol, entryDate:t.entryDate, entryPrice:t.entryPrice,
                   stopLoss:t.stopLoss, target1:t.target1, target2:t.target2, target3:t.target3,
                   sw5LowAtEntry: sw5AtEntry, atr14AtEntry: atrAtEntry };

    const currentResult = validateTrade(base, candlesSinceEntry);

    // ── Fix A: widen stop to min 2% or 1×ATR ──────────────────────────────
    const minStopPct = Math.max(2.0, atrPct * 0.9);
    const fixAstop   = stopPct < minStopPct
      ? t.entryPrice * (1 - minStopPct/100)
      : t.stopLoss;
    const fixAresult = validateTrade({ ...base, stopLoss: fixAstop }, candlesSinceEntry);

    // ── Fix B: Trail soft buffer (-0.35×ATR below swing low) ──────────────
    // Implemented in validator by passing a modified trade; but the trail is internal.
    // We simulate by lowering the initial stop by ATR×0.35 (proxy: gives more room)
    const trailBufferStop = t.stopLoss - 0.35 * atrAtEntry;
    const fixBresult = validateTrade({ ...base, stopLoss: Math.min(t.stopLoss, trailBufferStop) }, candlesSinceEntry);

    // ── Fix C: conviction gate ≥ 40 ────────────────────────────────────────
    const fixCskip = (t.conviction ?? 100) < 40;

    // ── Fix D: tightstop size adjustment (reject if stop < 1% AND atr > 1.5%) ──
    const fixDskip = stopPct < 1.0 && atrPct > 1.5;

    // ── Fix E: time-stop at maxHoldBars (15 for PRE_BREAKOUT, 12 for BUY) ───
    const maxHold = t.stage?.includes('PRE_BREAKOUT') ? 15 : (t.stage?.includes('BUY') ? 12 : 20);
    const fixEcandles = candlesSinceEntry.slice(0, maxHold);
    const fixEresult  = fixEcandles.length > 0 ? validateTrade(base, fixEcandles) : currentResult;

    process.stdout.write(
      `ATR%=${atrPct.toFixed(1)} stopPct=${stopPct.toFixed(2)} stopToATR=${stopToAtrRatio.toFixed(1)} ` +
      `base=${currentResult.status} fixA=${fixAresult.status} fixD=${fixDskip?'SKIP':'-'}\n`
    );

    results.push({
      t, atrAtEntry, atrPct, stopPct, sw5AtEntry, stopToAtrRatio,
      current: currentResult,
      fixA: fixAresult, fixB: fixBresult,
      fixCskip, fixDskip,
      fixE: fixEresult,
      fixAstop, fixAstopPct: (t.entryPrice-fixAstop)/t.entryPrice*100,
    });

    await delay(100);
  }

  // ── Statistics ─────────────────────────────────────────────────────────
  const valid = results.filter(r => r.current);
  const decided = (r) => !['open'].includes(r.current.status);
  const decided_A = (r) => !['open'].includes(r.fixA.status);
  const isStop  = (r) => r.current.status === 'stopped';
  const isWin   = (r) => ['hit_t1','hit_t2','hit_t3'].includes(r.current.status);

  const allDec    = valid.filter(decided);
  const allDecA   = valid.filter(decided_A);
  const stopped   = valid.filter(isStop);
  const wins      = valid.filter(isWin);
  const stoppedA  = valid.filter(r=>r.fixA && r.fixA.status==='stopped');
  const winsA     = valid.filter(r=>r.fixA && ['hit_t1','hit_t2','hit_t3'].includes(r.fixA.status));
  const stoppedB  = valid.filter(r=>r.fixB && r.fixB.status==='stopped');
  const fixDvalid = valid.filter(r=>!r.fixDskip);
  const stoppedD  = fixDvalid.filter(isStop);
  const winsD     = fixDvalid.filter(isWin);
  const decD      = fixDvalid.filter(decided);
  const stoppedE  = valid.filter(r=>r.fixE && r.fixE.status==='stopped');
  const winsE     = valid.filter(r=>r.fixE && ['hit_t1','hit_t2','hit_t3'].includes(r.fixE.status));
  const allDecE   = valid.filter(r=>r.fixE && !['open'].includes(r.fixE.status));

  console.log(`\n${'═'.repeat(80)}`);
  console.log('  STOP RATE AUDIT — SCIENTIFIC SUMMARY');
  console.log(`${'═'.repeat(80)}`);
  console.log(`\n  Total trades analysed : ${valid.length}`);
  console.log(`  Decided (non-open)    : ${allDec.length}`);
  console.log(`  Stopped               : ${stopped.length}  (${pct(stopped.length, allDec.length)}%)`);
  console.log(`  Wins (T1/T2/T3)       : ${wins.length}  (${pct(wins.length, allDec.length)}%)`);
  console.log(`\n  ATR Distribution:`);
  const atrBuckets = {TIGHT:0,NORMAL:0,VOLATILE:0,HIGH:0};
  valid.forEach(r=>{const a=r.atrPct??0;if(a<1.5)atrBuckets.TIGHT++;else if(a<2.5)atrBuckets.NORMAL++;else if(a<3.5)atrBuckets.VOLATILE++;else atrBuckets.HIGH++;});
  Object.entries(atrBuckets).forEach(([k,n])=>console.log(`    ${k.padEnd(10)} ${n} trades`));

  console.log(`\n  Stop Width Distribution:`);
  const sw={below2:0,w2to5:0,w5to8:0,above8:0};
  valid.forEach(r=>{const s=r.stopPct??0;if(s<2)sw.below2++;else if(s<5)sw.w2to5++;else if(s<8)sw.w5to8++;else sw.above8++;});
  console.log(`    <2%        ${sw.below2} trades (DANGER ZONE)`);
  console.log(`    2-5%       ${sw.w2to5} trades`);
  console.log(`    5-8%       ${sw.w5to8} trades`);
  console.log(`    >8%        ${sw.above8} trades`);

  console.log(`\n  StopPct vs ATR ratio:`);
  valid.sort((a,b)=>a.stopToAtrRatio-b.stopToAtrRatio).forEach(r=>{
    const flag = r.stopToAtrRatio < 0.8 ? ' ⚠ TIGHT' : r.stopToAtrRatio < 1.2 ? ' [marginal]' : '';
    console.log(`    ${r.t.symbol.padEnd(22)} stopToATR=${r.stopToAtrRatio.toFixed(2)}  stopPct=${(r.stopPct??0).toFixed(2)}%  ATR%=${(r.atrPct??0).toFixed(2)}%  cv=${r.t.conviction??'?'}${flag}`);
  });

  console.log(`\n${'─'.repeat(80)}`);
  console.log('  FIX A — Minimum stop width: max(2%, 0.9×ATR)');
  console.log(`${'─'.repeat(80)}`);
  console.log(`  Stopped : ${stoppedA.length} / ${allDecA.length} = ${pct(stoppedA.length,allDecA.length)}%  (was ${pct(stopped.length,allDec.length)}%)`);
  console.log(`  Win rate: ${pct(winsA.length,allDecA.length)}%  (was ${pct(wins.length,allDec.length)}%)`);
  console.log('  Trades widened:');
  valid.filter(r=>r.fixAstopPct > (r.stopPct??0)+0.2).forEach(r=>{
    console.log(`    ${r.t.symbol.padEnd(20)} stop ${(r.stopPct??0).toFixed(2)}% → ${r.fixAstopPct.toFixed(2)}%  was=${r.current.status} now=${r.fixA.status}`);
  });

  console.log(`\n${'─'.repeat(80)}`);
  console.log('  FIX B — Trail-A soft buffer (stop −0.35×ATR)');
  console.log(`${'─'.repeat(80)}`);
  const stoppedBcount = stoppedB.length;
  const winsB = valid.filter(r=>r.fixB && ['hit_t1','hit_t2','hit_t3'].includes(r.fixB.status));
  const allDecB = valid.filter(r=>r.fixB && !['open'].includes(r.fixB.status));
  console.log(`  Stopped : ${stoppedBcount} / ${allDecB.length} = ${pct(stoppedBcount,allDecB.length)}%  (was ${pct(stopped.length,allDec.length)}%)`);
  console.log(`  Win rate: ${pct(winsB.length,allDecB.length)}%  (was ${pct(wins.length,allDec.length)}%)`);
  console.log('  Outcome changes:');
  valid.filter(r=>r.fixB && r.fixB.status !== r.current.status).forEach(r=>{
    console.log(`    ${r.t.symbol.padEnd(20)} ${r.current.status} → ${r.fixB.status}  pnlR: ${(r.current.pnlR??0).toFixed(2)}→${(r.fixB.pnlR??0).toFixed(2)}`);
  });

  console.log(`\n${'─'.repeat(80)}`);
  console.log('  FIX C — Conviction floor ≥ 40');
  console.log(`${'─'.repeat(80)}`);
  const fixCvalid = valid.filter(r=>!r.fixCskip);
  const stoppedC  = fixCvalid.filter(isStop);
  const winsC     = fixCvalid.filter(isWin);
  const allDecC   = fixCvalid.filter(decided);
  console.log(`  Skipped: ${valid.filter(r=>r.fixCskip).map(r=>r.t.symbol).join(', ')}`);
  console.log(`  Stopped : ${stoppedC.length} / ${allDecC.length} = ${pct(stoppedC.length,allDecC.length)}%  (was ${pct(stopped.length,allDec.length)}%)`);
  console.log(`  Win rate: ${pct(winsC.length,allDecC.length)}%  (was ${pct(wins.length,allDec.length)}%)`);

  console.log(`\n${'─'.repeat(80)}`);
  console.log('  FIX D — Reject trades with stop < 1% AND ATR > 1.5%');
  console.log(`${'─'.repeat(80)}`);
  console.log(`  Skipped: ${valid.filter(r=>r.fixDskip).map(r=>r.t.symbol).join(', ')}`);
  console.log(`  Stopped : ${stoppedD.length} / ${decD.length} = ${pct(stoppedD.length,decD.length)}%  (was ${pct(stopped.length,allDec.length)}%)`);
  console.log(`  Win rate: ${pct(winsD.length,decD.length)}%  (was ${pct(wins.length,allDec.length)}%)`);

  console.log(`\n${'─'.repeat(80)}`);
  console.log('  FIX E — Time-stop at maxHoldBars (12 BUY / 15 PRE_BREAKOUT)');
  console.log(`${'─'.repeat(80)}`);
  console.log(`  Stopped : ${stoppedE.length} / ${allDecE.length} = ${pct(stoppedE.length,allDecE.length)}%  (was ${pct(stopped.length,allDec.length)}%)`);
  console.log(`  Win rate: ${pct(winsE.length,allDecE.length)}%  (was ${pct(wins.length,allDec.length)}%)`);
  console.log('  Outcome changes:');
  valid.filter(r=>r.fixE && r.fixE.status !== r.current.status).forEach(r=>{
    console.log(`    ${r.t.symbol.padEnd(20)} ${r.current.status} → ${r.fixE.status}  pnlR: ${(r.current.pnlR??0).toFixed(2)}→${(r.fixE.pnlR??0).toFixed(2)}`);
  });

  console.log(`\n${'─'.repeat(80)}`);
  console.log('  COMBINED — Fixes A + C (widen stop + conviction floor)');
  console.log(`${'─'.repeat(80)}`);
  const comboValid = valid.filter(r=>!r.fixCskip);
  const combo = comboValid.map(r=>({
    t:r.t, status: r.fixA.status, pnlR: r.fixA.pnlR
  }));
  const comboDec  = combo.filter(c=>c.status!=='open');
  const comboStop = combo.filter(c=>c.status==='stopped');
  const comboWin  = combo.filter(c=>['hit_t1','hit_t2','hit_t3'].includes(c.status));
  console.log(`  Stopped : ${comboStop.length} / ${comboDec.length} = ${pct(comboStop.length,comboDec.length)}%`);
  console.log(`  Win rate: ${pct(comboWin.length,comboDec.length)}%`);

  // ── R-multiple analysis per fix ──────────────────────────────────────────
  console.log(`\n${'─'.repeat(80)}`);
  console.log('  R-MULTIPLE ANALYSIS');
  console.log(`${'─'.repeat(80)}`);
  const avgR = (arr,f) => { const v=arr.filter(r=>r[f]&&r[f].pnlR!=null&&r[f].status!=='open'); return v.length?v.reduce((s,r)=>s+r[f].pnlR,0)/v.length:0; };
  console.log(`  Current avg R (decided) : ${avgR(valid,'current').toFixed(3)}R`);
  console.log(`  Fix A avg R (decided)   : ${avgR(valid,'fixA').toFixed(3)}R`);
  console.log(`  Fix B avg R (decided)   : ${avgR(valid,'fixB').toFixed(3)}R`);

  // Tight stop identification
  console.log(`\n${'─'.repeat(80)}`);
  console.log('  TIGHT STOP DANGER ZONE (stopPct < 1×ATR)');
  console.log(`${'─'.repeat(80)}`);
  valid.filter(r=>(r.stopPct??99)<(r.atrPct??0)).forEach(r=>{
    console.log(`  ${r.t.symbol.padEnd(22)} stopPct=${(r.stopPct??0).toFixed(2)}%  ATR%=${(r.atrPct??0).toFixed(2)}%  status=${r.t.status}  pnlR=${r.t.pnlR?.toFixed(2)??'?'}  cv=${r.t.conviction??'?'}`);
  });

  console.log(`\n${'═'.repeat(80)}\n`);

  // ── JSON output for widget ────────────────────────────────────────────────
  const widgetData = valid.map(r=>({
    sym: r.t.symbol.replace('.NS',''),
    st: r.t.status,
    pnlR: r.t.pnlR,
    cv: r.t.conviction,
    atrPct: +(r.atrPct?.toFixed(2)??0),
    stopPct: +(r.stopPct?.toFixed(2)??0),
    stopToAtr: +(r.stopToAtrRatio?.toFixed(2)??0),
    atrState: r.t.atrState,
    stage: r.t.stage,
    days: r.t.daysHeld,
    cur: r.current.status,
    fixA: r.fixA.status,
    fixAstopPct: +(r.fixAstopPct?.toFixed(2)??0),
    fixB: r.fixB.status,
    fixCskip: r.fixCskip,
    fixDskip: r.fixDskip,
    fixE: r.fixE.status,
    fixAr: +(r.fixA.pnlR?.toFixed(3)??0),
    fixBr: +(r.fixB.pnlR?.toFixed(3)??0),
    curR: +(r.current.pnlR?.toFixed(3)??0),
  }));
  fs.writeFileSync('scripts/_stop_audit_data.json', JSON.stringify(widgetData,null,2));
  console.log('  JSON written to scripts/_stop_audit_data.json');
}

function pct(n,d) { return d>0?(n/d*100).toFixed(1):0; }
function delay(ms) { return new Promise(r=>setTimeout(r,ms)); }

main().catch(e=>{ console.error(e); process.exit(1); });
