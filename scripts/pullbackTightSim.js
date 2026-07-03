// ══════════════════════════════════════════════════════════════════════════════
// PULLBACK BOUNCE — TIGHT SIMULATION
// Exit on FIRST TOUCH of bounce target (limit sell at target price)
// If target not hit within N days → exit at close (time stop)
// Also tests with hard stop loss
// ══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const DATA_DIR = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';

const MON={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
           Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
function normDate(d){
  if(/^\d{4}-\d{2}-\d{2}$/.test(d))return d;
  const m=d.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  return m?`${m[3]}-${MON[m[2]]||'01'}-${m[1].padStart(2,'0')}`:d;
}

function sma(c, idx, period){
  if(idx<period-1)return null;let s=0;
  for(let j=idx-period+1;j<=idx;j++)s+=c[j].c;return s/period;
}
function swingHigh(c, idx, period){
  let h=-Infinity;
  for(let j=Math.max(0,idx-period);j<idx;j++)h=Math.max(h,c[j].h);
  return h;
}
function volAvg20(c,idx){
  let s=0,n=0;for(let j=Math.max(0,idx-20);j<idx;j++){s+=c[j].v;n++;}return n>0?s/n:0;
}

function stats(trades){
  const n=trades.length;
  if(n===0)return{n:0,wr:0,avgPnl:0,medPnl:0,pf:0,maxDD:0,expectancy:0};
  const wins=trades.filter(t=>t.pnl>0);
  const wr=wins.length/n*100;
  const avgPnl=trades.reduce((s,t)=>s+t.pnl,0)/n;
  const sorted=[...trades].map(t=>t.pnl).sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  const medPnl=sorted.length%2===0?(sorted[mid-1]+sorted[mid])/2:sorted[mid];
  const gW=wins.reduce((s,t)=>s+t.pnl,0);
  const gL=Math.abs(trades.filter(t=>t.pnl<=0).reduce((s,t)=>s+t.pnl,0));
  const pf=gL>0?gW/gL:(gW>0?999:0);
  let peak=0,dd=0,eq=0,maxDD=0;
  for(const t of trades){eq+=t.pnl;if(eq>peak)peak=eq;dd=peak-eq;if(dd>maxDD)maxDD=dd;}
  const avgWin=wins.length>0?gW/wins.length:0;
  const avgLoss=gL>0?gL/trades.filter(t=>t.pnl<=0).length:0;
  const expectancy=(wr/100)*avgWin-((1-wr/100)*avgLoss);
  return{n,wr,avgPnl,medPnl,pf,maxDD,expectancy,avgWin,avgLoss};
}
function bootstrapCI(trades,B=1000){
  if(trades.length<10)return{loWR:0,hiWR:100,loPnl:-99,hiPnl:99};
  const wrs=[],pnls=[];
  for(let b=0;b<B;b++){let w=0,s=0;
    for(let i=0;i<trades.length;i++){const t=trades[Math.floor(Math.random()*trades.length)];if(t.pnl>0)w++;s+=t.pnl;}
    wrs.push(w/trades.length*100);pnls.push(s/trades.length);}
  wrs.sort((a,b)=>a-b);pnls.sort((a,b)=>a-b);
  return{loWR:wrs[25],hiWR:wrs[974],loPnl:pnls[25],hiPnl:pnls[974]};
}

// ─── LOAD STOCKS ─────────────────────────────────────────────────────────────
const stocks=[];
if(fs.existsSync(DATA_DIR)){
  for(const f of fs.readdirSync(DATA_DIR)){
    if(!f.endsWith('.csv'))continue;
    try{
      const raw=fs.readFileSync(path.join(DATA_DIR,f),'utf8').trim().split('\n');
      const c=[];
      for(let i=1;i<raw.length;i++){
        const p=raw[i].split(',');if(p.length<5||isNaN(+p[4])||+p[4]<=0)continue;
        c.push({d:normDate(p[0].trim()),o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]||0});
      }
      if(c.length>=200)stocks.push({sym:f.replace(/\.csv$/i,''),c});
    }catch{}
  }
}
console.log(`Loaded ${stocks.length} stocks\n`);

// ─── SIMULATION CONFIG ────────────────────────────────────────────────────────
// We test a grid: zone × target × time_stop × stop_loss
// Signal: first close in [lo%, hi%] drawdown from 20-day swing high
// Entry:  close on signal day
// Exit:   if high >= target on day D → exit at target (limit fill)
//         if low  <= stop  on day D → exit at stop (stop fill; stop checked first)
//         if day D == timeStop     → exit at close

const SWING = 20;  // days for rolling high

const ZONES = [
  { name:'8–12%',  lo: 8, hi:12, label:'~10% pullback' },
  { name:'17–23%', lo:17, hi:23, label:'~20% pullback' },
];

// Target: bounce % from entry close
const TARGETS = [3, 5, 7, 10];

// Time stop: max days to hold
const TIME_STOPS = [5, 10, 15, 20];

// Stop loss: % below entry close (null = no stop)
const STOP_LOSSES = [null, 3, 5, 7];

// Trend filter options
const TREND_FILTERS = [
  { name:'All',          fn: ()=>true },
  { name:'Above SMA50',  fn: (c,i)=>{ const s=sma(c,i,50); return s!==null&&c[i].c>s; } },
  { name:'Below SMA50',  fn: (c,i)=>{ const s=sma(c,i,50); return s!==null&&c[i].c<=s; } },
];

// ─── COLLECT SIGNALS ─────────────────────────────────────────────────────────
console.log('Collecting signals...');
// allSignals: array of { entry, c (candle array), entryIdx, dd, year, splitTag, aboveSMA50 }
const allSignals = [];

for(const {sym,c} of stocks){
  const splitIdx=Math.floor(c.length*0.60);
  const wasInZone={};for(const z of ZONES)wasInZone[z.name]=false;
  for(let i=SWING+5;i<c.length-21;i++){
    const sh=swingHigh(c,i,SWING);if(sh<=0)continue;
    const entry=c[i].c;
    const dd=(sh-entry)/sh*100;
    const s50=sma(c,i,50);
    for(const z of ZONES){
      const inZone=dd>=z.lo&&dd<z.hi;
      if(inZone&&!wasInZone[z.name]){
        allSignals.push({
          sym, c, entryIdx:i, entry, dd,
          zone:z.name,
          year:c[i].d.slice(0,4),
          ym:c[i].d.slice(0,7),
          splitTag:i<splitIdx?'IS':'OOS',
          aboveSMA50:s50!==null&&entry>s50,
        });
      }
      wasInZone[z.name]=inZone;
    }
  }
}
console.log(`Total signals collected: ${allSignals.length}\n`);

// ─── SIMULATE ONE TRADE ───────────────────────────────────────────────────────
// Returns { pnl, exitType, daysHeld }
// exitType: 'target' | 'stop' | 'time'
function simulateTrade(sig, targetPct, timeStop, stopLossPct) {
  const { c, entryIdx, entry } = sig;
  const targetPrice = entry * (1 + targetPct / 100);
  const stopPrice   = stopLossPct !== null ? entry * (1 - stopLossPct / 100) : -Infinity;

  for (let d = 1; d <= timeStop; d++) {
    const ci = entryIdx + d;
    if (ci >= c.length) break;
    const bar = c[ci];
    // Check stop first (gap down opens below stop)
    if (bar.o <= stopPrice) return { pnl: (bar.o - entry) / entry * 100, exitType: 'stop', daysHeld: d };
    // Check stop intraday
    if (bar.l <= stopPrice) return { pnl: (stopPrice - entry) / entry * 100, exitType: 'stop', daysHeld: d };
    // Check target (gap up opens above target)
    if (bar.o >= targetPrice) return { pnl: (bar.o - entry) / entry * 100, exitType: 'target', daysHeld: d };
    // Check target intraday
    if (bar.h >= targetPrice) return { pnl: targetPct, exitType: 'target', daysHeld: d };
    // Time stop on last day
    if (d === timeStop) return { pnl: (bar.c - entry) / entry * 100, exitType: 'time', daysHeld: d };
  }
  // Ran out of data
  const last = c[Math.min(entryIdx + timeStop, c.length - 1)];
  return { pnl: (last.c - entry) / entry * 100, exitType: 'time', daysHeld: timeStop };
}

// ─── BEST CONFIG SEARCH ───────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  SECTION 1: FULL GRID SEARCH — Best target × time_stop × stop_loss');
console.log('  (All signals, IS+OOS combined, sorted by expectancy)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

for (const z of ZONES) {
  const zoneSigs = allSignals.filter(s => s.zone === z.name);
  console.log(`\n  Zone: ${z.name} (${z.label})  —  n=${zoneSigs.length} total signals`);
  console.log(`  ${'Target'.padEnd(7)} ${'TimeStop'.padEnd(9)} ${'StopLoss'.padEnd(9)} │ ${'n'.padStart(5)} │ ${'WR'.padStart(7)} │ ${'AvgPnl'.padStart(8)} │ ${'MedPnl'.padStart(8)} │ ${'PF'.padStart(5)} │ ${'MaxDD'.padStart(7)} │ ${'Exp/trade'.padStart(10)}`);
  console.log('  '+'-'.repeat(103));

  const rows = [];
  for (const tgt of TARGETS) {
    for (const ts of TIME_STOPS) {
      for (const sl of STOP_LOSSES) {
        const trades = zoneSigs.map(sig => simulateTrade(sig, tgt, ts, sl));
        const s = stats(trades);
        rows.push({ tgt, ts, sl, s });
      }
    }
  }
  // Sort by expectancy descending
  rows.sort((a, b) => b.s.expectancy - a.s.expectancy);
  // Show top 15
  for (const r of rows.slice(0, 15)) {
    const slLabel = r.sl === null ? 'none' : `-${r.sl}%`;
    console.log(`  ${('+'+r.tgt+'%').padEnd(7)} ${(r.ts+'d').padEnd(9)} ${slLabel.padEnd(9)} │ ${String(r.s.n).padStart(5)} │ ${(r.s.wr.toFixed(1)+'%').padStart(7)} │ ${((r.s.avgPnl>=0?'+':'')+r.s.avgPnl.toFixed(2)+'%').padStart(8)} │ ${((r.s.medPnl>=0?'+':'')+r.s.medPnl.toFixed(2)+'%').padStart(8)} │ ${r.s.pf.toFixed(2).padStart(5)} │ ${('-'+r.s.maxDD.toFixed(1)+'%').padStart(7)} │ ${((r.s.expectancy>=0?'+':'')+r.s.expectancy.toFixed(3)+'%').padStart(10)}`);
  }
}

// ─── SECTION 2: IS vs OOS for the best configs ───────────────────────────────
console.log('\n\n══════════════════════════════════════════════════════════════════════════════');
console.log('  SECTION 2: IS vs OOS SPLIT — Best 3 configs per zone');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

// Best configs manually selected (5% target, 10-15d, 5% stop based on typical results)
const BEST_CONFIGS = [
  { tgt:5,  ts:10, sl:5   },
  { tgt:5,  ts:15, sl:5   },
  { tgt:7,  ts:15, sl:5   },
  { tgt:5,  ts:10, sl:null},
  { tgt:10, ts:15, sl:7   },
];

for (const z of ZONES) {
  const zoneSigs = allSignals.filter(s => s.zone === z.name);
  console.log(`  Zone: ${z.name} (${z.label})`);
  console.log(`  ${'Config'.padEnd(26)} │ ${'Period'.padEnd(5)} │ ${'n'.padStart(5)} │ ${'WR'.padStart(7)} │ ${'AvgPnl'.padStart(8)} │ ${'CI lo pnl'.padStart(10)} │ ${'PF'.padStart(5)} │ Target hit%`);
  console.log('  '+'-'.repeat(90));
  for (const cfg of BEST_CONFIGS) {
    const slLabel = cfg.sl===null?'no stop':`-${cfg.sl}% stop`;
    const label = `+${cfg.tgt}% tgt / ${cfg.ts}d / ${slLabel}`;
    for (const tag of ['IS','OOS']) {
      const sigs = zoneSigs.filter(s=>s.splitTag===tag);
      const trades = sigs.map(sig=>({...simulateTrade(sig,cfg.tgt,cfg.ts,cfg.sl),sig}));
      const s=stats(trades.map(t=>({pnl:t.pnl})));
      const ci=bootstrapCI(trades.map(t=>({pnl:t.pnl})));
      const tgtHit=trades.filter(t=>t.exitType==='target').length;
      const tgtPct=trades.length>0?(tgtHit/trades.length*100).toFixed(0)+'%':'n/a';
      console.log(`  ${label.padEnd(26)} │ ${tag.padEnd(5)} │ ${String(s.n).padStart(5)} │ ${(s.wr.toFixed(1)+'%').padStart(7)} │ ${((s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2)+'%').padStart(8)} │ ${((ci.loPnl>=0?'+':'')+ci.loPnl.toFixed(2)+'%').padStart(10)} │ ${s.pf.toFixed(2).padStart(5)} │ ${tgtPct}`);
    }
    console.log('  '+'-'.repeat(90));
  }
  console.log();
}

// ─── SECTION 3: TREND FILTER IMPACT ──────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  SECTION 3: TREND FILTER — Above vs Below SMA50');
console.log('  Config: +5% target, 10-day time stop, -5% hard stop');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const FOCUS_CFG = { tgt:5, ts:10, sl:5 };
console.log(`  ${'Zone'.padEnd(9)} │ ${'Trend'.padEnd(13)} │ ${'Period'.padEnd(5)} │ ${'n'.padStart(5)} │ ${'WR'.padStart(7)} │ ${'AvgPnl'.padStart(8)} │ ${'PF'.padStart(5)} │ ${'TgtHit%'.padStart(8)} │ ${'StopHit%'.padStart(9)}`);
console.log('  '+'-'.repeat(93));

for (const z of ZONES) {
  for (const tf of TREND_FILTERS) {
    for (const tag of ['IS','OOS']) {
      const sigs = allSignals.filter(s=>s.zone===z.name&&s.splitTag===tag&&tf.fn(s.c,s.entryIdx));
      const trades = sigs.map(sig=>simulateTrade(sig,FOCUS_CFG.tgt,FOCUS_CFG.ts,FOCUS_CFG.sl));
      const s=stats(trades.map(t=>({pnl:t.pnl})));
      const tgtH=trades.filter(t=>t.exitType==='target').length;
      const stpH=trades.filter(t=>t.exitType==='stop').length;
      const tgtPct=trades.length>0?(tgtH/trades.length*100).toFixed(0)+'%':'n/a';
      const stpPct=trades.length>0?(stpH/trades.length*100).toFixed(0)+'%':'n/a';
      console.log(`  ${z.name.padEnd(9)} │ ${tf.name.padEnd(13)} │ ${tag.padEnd(5)} │ ${String(s.n).padStart(5)} │ ${(s.wr.toFixed(1)+'%').padStart(7)} │ ${((s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2)+'%').padStart(8)} │ ${s.pf.toFixed(2).padStart(5)} │ ${tgtPct.padStart(8)} │ ${stpPct.padStart(9)}`);
    }
    console.log('  '+'-'.repeat(93));
  }
}

// ─── SECTION 4: EXIT TYPE BREAKDOWN ──────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('  SECTION 4: EXIT TYPE BREAKDOWN (OOS only, +5% tgt / 10d / -5% stop)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

for (const z of ZONES) {
  const sigs = allSignals.filter(s=>s.zone===z.name&&s.splitTag==='OOS');
  const trades = sigs.map(sig=>({...simulateTrade(sig,5,10,5)}));
  const tgt  = trades.filter(t=>t.exitType==='target');
  const stp  = trades.filter(t=>t.exitType==='stop');
  const time = trades.filter(t=>t.exitType==='time');

  const st=stats(tgt.map(t=>({pnl:t.pnl}))), ss=stats(stp.map(t=>({pnl:t.pnl}))), stm=stats(time.map(t=>({pnl:t.pnl})));
  const avgDaysTgt=tgt.length>0?tgt.reduce((s,t)=>s+t.daysHeld,0)/tgt.length:0;
  const avgDaysStp=stp.length>0?stp.reduce((s,t)=>s+t.daysHeld,0)/stp.length:0;
  const avgDaysTm =time.length>0?time.reduce((s,t)=>s+t.daysHeld,0)/time.length:0;

  console.log(`  Zone: ${z.name}  (OOS n=${trades.length})`);
  console.log(`  Exit type  │  n  │   %  │ Avg P&L │ Avg days held`);
  console.log(`  ───────────┼─────┼──────┼─────────┼──────────────`);
  console.log(`  Target hit │ ${String(tgt.length).padStart(3)} │ ${(tgt.length/trades.length*100).toFixed(0).padStart(4)}% │ ${('+'+st.avgPnl.toFixed(2)+'%').padStart(7)} │ ${avgDaysTgt.toFixed(1)} days`);
  console.log(`  Stop hit   │ ${String(stp.length).padStart(3)} │ ${(stp.length/trades.length*100).toFixed(0).padStart(4)}% │ ${((ss.avgPnl>=0?'+':'')+ss.avgPnl.toFixed(2)+'%').padStart(7)} │ ${avgDaysStp.toFixed(1)} days`);
  console.log(`  Time stop  │ ${String(time.length).padStart(3)} │ ${(time.length/trades.length*100).toFixed(0).padStart(4)}% │ ${((stm.avgPnl>=0?'+':'')+stm.avgPnl.toFixed(2)+'%').padStart(7)} │ ${avgDaysTm.toFixed(1)} days`);
  console.log(`  Total      │ ${String(trades.length).padStart(3)} │  100% │ ${((stats(trades.map(t=>({pnl:t.pnl}))).avgPnl>=0?'+':'')+stats(trades.map(t=>({pnl:t.pnl}))).avgPnl.toFixed(2)+'%').padStart(7)} │`);
  console.log();
}

// ─── SECTION 5: YEAR-BY-YEAR OOS ─────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  SECTION 5: YEAR-BY-YEAR (OOS, +5% tgt / 10d / -5% stop)');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

console.log(`  ${'Year'.padEnd(6)} │` + ZONES.map(z=>`  ${(z.name+' WR / Avg / TgtHit').padEnd(28)}`).join(' │'));
console.log('  '+'-'.repeat(80));

const years = [...new Set(allSignals.map(s=>s.year))].sort();
for (const yr of years) {
  const row = ZONES.map(z => {
    const sigs = allSignals.filter(s=>s.zone===z.name&&s.splitTag==='OOS'&&s.year===yr);
    if (sigs.length < 3) return '—'.padEnd(28);
    const trades = sigs.map(sig=>simulateTrade(sig,5,10,5));
    const s = stats(trades.map(t=>({pnl:t.pnl})));
    const tgtHit = trades.filter(t=>t.exitType==='target').length;
    return `n=${String(s.n).padStart(3)} WR=${s.wr.toFixed(0).padStart(3)}% avg=${((s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(1)+'%').padStart(6)} tgt=${(tgtHit/s.n*100).toFixed(0).padStart(3)}%`;
  });
  console.log(`  ${yr.padEnd(6)} │` + row.map(r=>'  '+r).join(' │'));
}

// ─── SECTION 6: VOLUME FILTER ─────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log('  SECTION 6: VOLUME SPIKE FILTER on signal day');
console.log('  Does unusually HIGH volume on the pullback day improve bounce probability?');
console.log('  Config: +5% tgt / 10d / -5% stop, OOS only');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

for (const z of ZONES) {
  console.log(`  Zone: ${z.name}`);
  console.log(`  ${'Vol vs 20-day avg'.padEnd(22)} │ ${'n'.padStart(5)} │ ${'WR'.padStart(7)} │ ${'AvgPnl'.padStart(8)} │ ${'TgtHit%'.padStart(8)}`);
  console.log('  '+'-'.repeat(60));

  const volBuckets = [
    { label:'< 0.5× (thin)',    fn:(r)=>r<0.5  },
    { label:'0.5–1× (normal)', fn:(r)=>r>=0.5&&r<1 },
    { label:'1–2× (moderate)', fn:(r)=>r>=1&&r<2 },
    { label:'2–4× (high)',     fn:(r)=>r>=2&&r<4 },
    { label:'> 4× (surge)',    fn:(r)=>r>=4 },
  ];
  for (const vb of volBuckets) {
    const sigs = allSignals.filter(s=>{
      if(s.zone!==z.name||s.splitTag!=='OOS')return false;
      const va=volAvg20(s.c,s.entryIdx);
      if(va<=0)return false;
      return vb.fn(s.c[s.entryIdx].v/va);
    });
    if(sigs.length<3)continue;
    const trades=sigs.map(sig=>simulateTrade(sig,5,10,5));
    const s=stats(trades.map(t=>({pnl:t.pnl})));
    const tgtHit=(trades.filter(t=>t.exitType==='target').length/trades.length*100).toFixed(0)+'%';
    console.log(`  ${vb.label.padEnd(22)} │ ${String(s.n).padStart(5)} │ ${(s.wr.toFixed(1)+'%').padStart(7)} │ ${((s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2)+'%').padStart(8)} │ ${tgtHit.padStart(8)}`);
  }
  console.log();
}

// ─── FINAL SUMMARY ───────────────────────────────────────────────────────────
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log('  FINAL SUMMARY — Recommended trade setups');
console.log('══════════════════════════════════════════════════════════════════════════════\n');

const FINAL_CONFIGS = [
  { zone:'8–12%',  tgt:5,  ts:10, sl:5, trend:'All'       },
  { zone:'8–12%',  tgt:5,  ts:10, sl:5, trend:'Below SMA50'},
  { zone:'8–12%',  tgt:3,  ts:5,  sl:3, trend:'All'       },
  { zone:'17–23%', tgt:10, ts:15, sl:7, trend:'All'       },
  { zone:'17–23%', tgt:10, ts:15, sl:7, trend:'Below SMA50'},
  { zone:'17–23%', tgt:5,  ts:10, sl:5, trend:'Below SMA50'},
];

console.log(`  ${'Setup'.padEnd(42)} │ ${'Period'.padEnd(4)} │ ${'n'.padStart(5)} │ ${'WR'.padStart(7)} │ ${'AvgPnl'.padStart(8)} │ ${'PF'.padStart(5)} │ CI lo`);
console.log('  '+'-'.repeat(95));

for (const cfg of FINAL_CONFIGS) {
  const slLabel = cfg.sl===null?'no stop':`-${cfg.sl}%`;
  const label=`${cfg.zone} | +${cfg.tgt}% tgt/${cfg.ts}d/${slLabel} | ${cfg.trend}`;
  for (const tag of ['IS','OOS']) {
    const sigs = allSignals.filter(s=>{
      if(s.zone!==cfg.zone||s.splitTag!==tag)return false;
      if(cfg.trend==='Above SMA50')return s.aboveSMA50;
      if(cfg.trend==='Below SMA50')return !s.aboveSMA50;
      return true;
    });
    const trades=sigs.map(sig=>simulateTrade(sig,cfg.tgt,cfg.ts,cfg.sl));
    const s=stats(trades.map(t=>({pnl:t.pnl})));
    const ci=bootstrapCI(trades.map(t=>({pnl:t.pnl})));
    let verdict='NO'; if(s.avgPnl>0&&ci.loPnl>0) verdict='OK'; else if(s.avgPnl>0) verdict='~';
    console.log(`  ${label.padEnd(42)} │ ${tag.padEnd(4)} │ ${String(s.n).padStart(5)} │ ${(s.wr.toFixed(1)+'%').padStart(7)} │ ${((s.avgPnl>=0?'+':'')+s.avgPnl.toFixed(2)+'%').padStart(8)} │ ${s.pf.toFixed(2).padStart(5)} │ ${(ci.loPnl>=0?'+':'')+ci.loPnl.toFixed(2)+'%'} ${verdict}`);
  }
  console.log('  '+'-'.repeat(95));
}
