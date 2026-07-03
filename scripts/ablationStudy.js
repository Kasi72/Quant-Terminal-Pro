'use strict';
// ABLATION STUDY — HiPrec & Ultra
// Adds proposed changes ONE AT A TIME from v10 baseline.
// Identifies marginal contribution of each param change.
// Also sweeps the most sensitive params across a range.
// Run: node scripts/ablationStudy.js

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs   = require('fs');
const path = require('path');

const DATA_DIR   = 'C:/Users/drkkr/Downloads/NIFTY 500 OHLCV';
const ENGINE_DIR = path.join(__dirname, '_compiled');   // v10 current compiled engine
const OUT_FILE   = path.join(__dirname, 'ablation_results.txt');
const DATE_FROM  = '2019-01-01';
const STOP_PCT=7, T1_PCT=5, T2_PCT=10, T3_PCT=15, MAX_HOLD=20;
const ACTIONABLE = new Set(['BUY','STRONG_BUY','ULTRA_STRONG_BUY']);

// ── V10 BASELINES (exact current values) ────────────────────────────────────
const V10_HIPREC = {
  maxATRPct14Pctl120: 85, maxPre10AvgRangeATR: 1.0, maxPre10ExpansionCount: 2,
  minZoneLen: 5, maxZoneLen: 25, maxZoneTightnessPct: 8.0,
  maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 1.10,
  maxPre10HighVolCount: 4, highVolMultiplier: 1.35, maxPre10RedVolBias: 2.00,
  minExactRangeATR14: 1.5, maxExactRangeATR14: 5.0,
  minExactVolRatio20: 1.5, minExactVolVsPre5: 2.5,
  minCloseLoc: 55, maxUpperWickPct: 40, minBodyPct: 20, maxCandleRisk: 10.0,
  minUltraPrecisionScore: 50, minRSI2: 50,
  minVolatilityExpansionRatio: 0.75, minCandleQualityScore: null,
  maxCloseAboveZonePct: 6.0,
};

const V10_ULTRA = {
  maxATRPct14Pctl120: 30, maxPre10AvgRangeATR: 0.80, maxPre10ExpansionCount: 0,
  minZoneLen: 8, maxZoneLen: 25, maxZoneTightnessPct: 6.0,
  maxPre10AvgVolRatio: 0.90, maxPre5AvgVolRatio: 0.95,
  maxPre10HighVolCount: 0, highVolMultiplier: 1.5, maxPre10RedVolBias: 2.00,
  minExactRangeATR14: 0.4, maxExactRangeATR14: 6.0,
  minExactVolRatio20: 1.1, minExactVolVsPre5: 1.0,
  minCloseLoc: 30, maxUpperWickPct: 25, minBodyPct: 5, maxCandleRisk: 8.5,
  minUltraPrecisionScore: 0, minRSI2: 50,
  minVolatilityExpansionRatio: 2.4, minCandleQualityScore: 4,
  maxCloseAboveZonePct: null,
};

// ── ABLATION CONFIGS ─────────────────────────────────────────────────────────
// Each step = cumulative override on top of baseline.
// Label describes what THIS STEP adds.

const HIPREC_STEPS = [
  { label: 'v10 BASELINE',                   override: {} },
  { label: '+RedVolBias 2.0→1.15',           override: { maxPre10RedVolBias: 1.15 } },
  { label: '+UpperWick 40→25',               override: { maxPre10RedVolBias:1.15, maxUpperWickPct:25 } },
  { label: '+CloseLoc 55→60',                override: { maxPre10RedVolBias:1.15, maxUpperWickPct:25, minCloseLoc:60 } },
  { label: '+ZoneLen 5→7',                   override: { maxPre10RedVolBias:1.15, maxUpperWickPct:25, minCloseLoc:60, minZoneLen:7 } },
  { label: '+VER 0.75→1.50',                 override: { maxPre10RedVolBias:1.15, maxUpperWickPct:25, minCloseLoc:60, minZoneLen:7, minVolatilityExpansionRatio:1.50 } },
  // ATRPctl sweep — find optimal value
  { label: '  ATRPctl sweep: 80',            override: { maxPre10RedVolBias:1.15, maxUpperWickPct:25, minCloseLoc:60, minZoneLen:7, minVolatilityExpansionRatio:1.50, maxATRPct14Pctl120:80 } },
  { label: '  ATRPctl sweep: 75',            override: { maxPre10RedVolBias:1.15, maxUpperWickPct:25, minCloseLoc:60, minZoneLen:7, minVolatilityExpansionRatio:1.50, maxATRPct14Pctl120:75 } },
  { label: '  ATRPctl sweep: 70',            override: { maxPre10RedVolBias:1.15, maxUpperWickPct:25, minCloseLoc:60, minZoneLen:7, minVolatilityExpansionRatio:1.50, maxATRPct14Pctl120:70 } },
  { label: '  ATRPctl sweep: 65',            override: { maxPre10RedVolBias:1.15, maxUpperWickPct:25, minCloseLoc:60, minZoneLen:7, minVolatilityExpansionRatio:1.50, maxATRPct14Pctl120:65 } },
  { label: '  ATRPctl sweep: 60',            override: { maxPre10RedVolBias:1.15, maxUpperWickPct:25, minCloseLoc:60, minZoneLen:7, minVolatilityExpansionRatio:1.50, maxATRPct14Pctl120:60 } },
];

const ULTRA_STEPS = [
  { label: 'v10 BASELINE',                   override: {} },
  { label: '+RedVolBias 2.0→1.00',           override: { maxPre10RedVolBias:1.00 } },
  { label: '+UpperWick 25→15',               override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15 } },
  { label: '+ZoneLen 8→10',                  override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10 } },
  { label: '+VolRatio 1.1→1.2',              override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10, minExactVolRatio20:1.2 } },
  { label: '+CloseAboveZone 3%',             override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10, minExactVolRatio20:1.2, maxCloseAboveZonePct:3.0 } },
  // CloseLoc sweep — find breakpoint where trade count doesn't collapse
  { label: '  CloseLoc sweep: 35',           override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10, minExactVolRatio20:1.2, maxCloseAboveZonePct:3.0, minCloseLoc:35 } },
  { label: '  CloseLoc sweep: 40',           override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10, minExactVolRatio20:1.2, maxCloseAboveZonePct:3.0, minCloseLoc:40 } },
  { label: '  CloseLoc sweep: 45',           override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10, minExactVolRatio20:1.2, maxCloseAboveZonePct:3.0, minCloseLoc:45 } },
  { label: '  CloseLoc sweep: 50',           override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10, minExactVolRatio20:1.2, maxCloseAboveZonePct:3.0, minCloseLoc:50 } },
  { label: '  CloseLoc sweep: 55',           override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10, minExactVolRatio20:1.2, maxCloseAboveZonePct:3.0, minCloseLoc:55 } },
  // minERA sweep — find breakpoint (0.4 is too low, 1.6 killed all trades)
  { label: '  minERA sweep: 0.6 (best CloseLoc from above)', override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10, minExactVolRatio20:1.2, maxCloseAboveZonePct:3.0, minCloseLoc:45, minExactRangeATR14:0.6 } },
  { label: '  minERA sweep: 0.8',            override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10, minExactVolRatio20:1.2, maxCloseAboveZonePct:3.0, minCloseLoc:45, minExactRangeATR14:0.8 } },
  { label: '  minERA sweep: 1.0',            override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10, minExactVolRatio20:1.2, maxCloseAboveZonePct:3.0, minCloseLoc:45, minExactRangeATR14:1.0 } },
  { label: '  minERA sweep: 1.2',            override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10, minExactVolRatio20:1.2, maxCloseAboveZonePct:3.0, minCloseLoc:45, minExactRangeATR14:1.2 } },
  // BodyPct sweep
  { label: '  BodyPct sweep: 15 (best CloseLoc+ERA)',        override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10, minExactVolRatio20:1.2, maxCloseAboveZonePct:3.0, minCloseLoc:45, minExactRangeATR14:0.8, minBodyPct:15 } },
  { label: '  BodyPct sweep: 20',            override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10, minExactVolRatio20:1.2, maxCloseAboveZonePct:3.0, minCloseLoc:45, minExactRangeATR14:0.8, minBodyPct:20 } },
  { label: '  BodyPct sweep: 25',            override: { maxPre10RedVolBias:1.00, maxUpperWickPct:15, minZoneLen:10, minExactVolRatio20:1.2, maxCloseAboveZonePct:3.0, minCloseLoc:45, minExactRangeATR14:0.8, minBodyPct:25 } },
];

const STUDY_PLAN = [
  { setKey: 'optimized_highprecision_15plus', baseline: V10_HIPREC, steps: HIPREC_STEPS, label: 'HIPREC' },
  { setKey: 'optimized_ultraselective_8plus', baseline: V10_ULTRA,  steps: ULTRA_STEPS,  label: 'ULTRA' },
];

// ─── WORKER ──────────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { setKey, baseline, override, files, engineDir } = workerData;

  const eng = require(path.join(engineDir, 'stockEngine.js'));
  const analyzeStock = eng.analyzeStock;
  const PARAM_SETS   = eng.PARAM_SETS;

  // Apply baseline then override
  Object.assign(PARAM_SETS[setKey], baseline, override);

  const MONTH_MAP = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
  function parseDate(s) {
    s = s.trim();
    if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
      const [d,mon,y]=s.split('-');
      const iso=`${y}-${String((MONTH_MAP[mon]??0)+1).padStart(2,'0')}-${d.padStart(2,'0')}`;
      return { iso, ts: Math.floor(new Date(iso).getTime()/1000) };
    }
    const ts=Math.floor(new Date(s).getTime()/1000);
    return { iso:s, ts:isNaN(ts)?0:ts };
  }

  function parseCSV(fp) {
    const lines=fs.readFileSync(fp,'utf8').trim().split('\n');
    if(lines.length<2) return [];
    const hdr=lines[0].split(',').map(h=>h.trim().toLowerCase());
    const iDate=hdr.indexOf('date'),iOpen=hdr.indexOf('open'),iHigh=hdr.indexOf('high'),
          iLow=hdr.indexOf('low'),iClose=hdr.findIndex(h=>h==='close'||h==='adj close'),
          iVol=hdr.findIndex(h=>h==='volume');
    if(iClose<0||iVol<0) return [];
    const out=[];
    for(let i=1;i<lines.length;i++){
      const p=lines[i].split(',');
      const {iso,ts}=parseDate(p[iDate]?.trim()??'');
      if(iso<DATE_FROM||ts===0) continue;
      const c=+p[iClose],o=+p[iOpen]||c,h=+p[iHigh]||c,l=+p[iLow]||c,v=+p[iVol]||0;
      if(isNaN(c)||c<=0) continue;
      out.push({ts,date:iso,o,h,l,c,v});
    }
    return out;
  }

  function simulateTrade(candles,idx){
    if(idx>=candles.length) return null;
    const ep=candles[idx].o>0?candles[idx].o:candles[idx].c;
    if(ep<=0) return null;
    const stop=ep*(1-STOP_PCT/100),t1=ep*(1+T1_PCT/100),t2=ep*(1+T2_PCT/100),t3=ep*(1+T3_PCT/100);
    let t1Hit=false,t2Hit=false,trail=stop;
    for(let d=0;d<MAX_HOLD;d++){
      const ci=idx+d;
      if(ci>=candles.length){
        const cp=(candles[candles.length-1].c-ep)/ep*100;
        if(t2Hit) return{pnl:0.5*T1_PCT+0.3*T2_PCT+0.2*cp};
        if(t1Hit) return{pnl:0.5*T1_PCT+0.5*cp};
        return{pnl:cp};
      }
      const bar=candles[ci],open=bar.o>0?bar.o:bar.c;
      if(open<=trail){const fp=(open-ep)/ep*100;if(t2Hit)return{pnl:0.5*T1_PCT+0.3*T2_PCT+0.2*fp};if(t1Hit)return{pnl:0.5*T1_PCT+0.5*fp};return{pnl:fp};}
      if(bar.l<=trail){const fp=(trail-ep)/ep*100;if(t2Hit)return{pnl:0.5*T1_PCT+0.3*T2_PCT+0.2*fp};if(t1Hit)return{pnl:0.5*T1_PCT+0.5*fp};return{pnl:fp};}
      if(t2Hit&&bar.h>=t3) return{pnl:0.5*T1_PCT+0.3*T2_PCT+0.2*T3_PCT};
      if(t1Hit&&!t2Hit&&bar.h>=t2){t2Hit=true;trail=t1;}
      if(!t1Hit&&bar.h>=t1){t1Hit=true;trail=ep;}
      if(d===MAX_HOLD-1){const cp=(bar.c-ep)/ep*100;if(t2Hit)return{pnl:0.5*T1_PCT+0.3*T2_PCT+0.2*cp};if(t1Hit)return{pnl:0.5*T1_PCT+0.5*cp};return{pnl:cp};}
    }
    return null;
  }

  const trades=[];
  for(const fp of files){
    const candles=parseCSV(fp);
    if(candles.length<100) continue;
    let i=60;
    while(i<candles.length-1){
      let r;
      try{r=analyzeStock(candles.slice(Math.max(0,i-299),i+1),setKey);}catch{i++;continue;}
      if(ACTIONABLE.has(r.stage)){
        const t=simulateTrade(candles,i+1);
        if(t){trades.push({date:candles[i].date,pnl:t.pnl});i+=MAX_HOLD;continue;}
      }
      i++;
    }
  }

  parentPort.postMessage({type:'done',trades});
  return;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
if(!fs.existsSync(path.join(ENGINE_DIR,'stockEngine.js'))){
  console.error('❌  Compiled engine not found.'); process.exit(1);
}
const allFiles=fs.readdirSync(DATA_DIR).filter(f=>f.endsWith('.csv')&&!f.includes('ALL_SYMBOLS')).map(f=>path.join(DATA_DIR,f));

console.log('═'.repeat(90));
console.log('  ABLATION STUDY — HiPrec & Ultra (scientific param-by-param analysis)');
console.log('═'.repeat(90));
console.log(`📁  ${DATA_DIR}  (${allFiles.length} CSVs)`);
console.log(`📐  Method: cumulative ablation + param sweeps | IS/OOS 60/40`);
console.log();

function calcStats(trades){
  if(!trades.length) return{n:0,wr:0,pf:0,avgPnl:0};
  const wins=trades.filter(t=>t.pnl>0);
  const losses=trades.filter(t=>t.pnl<=0);
  const gross=wins.reduce((s,t)=>s+t.pnl,0);
  const loss=Math.abs(losses.reduce((s,t)=>s+t.pnl,0));
  return{n:trades.length,wr:wins.length/trades.length*100,pf:loss>0?gross/loss:gross>0?99:0,avgPnl:trades.reduce((s,t)=>s+t.pnl,0)/trades.length};
}

function splitISOS(trades){
  const sorted=[...trades].sort((a,b)=>a.date.localeCompare(b.date));
  if(!sorted.length) return{is:[],oos:[]};
  const cut=sorted[Math.floor(sorted.length*0.6)].date;
  return{is:sorted.filter(t=>t.date<cut),oos:sorted.filter(t=>t.date>=cut)};
}

const allLines=[];
const out=s=>{allLines.push(s);console.log(s);};

function runStudy(studyIdx){
  if(studyIdx>=STUDY_PLAN.length){
    fs.writeFileSync(OUT_FILE,allLines.join('\n'),'utf8');
    console.log(`\n\n📄  Results → ${OUT_FILE}`);
    return;
  }
  const {setKey,baseline,steps,label}=STUDY_PLAN[studyIdx];

  out('');
  out('═'.repeat(90));
  out(`  ${label} ABLATION — ${steps.length} configurations`);
  out('  Each row = cumulative: adds the stated change ON TOP of all previous rows');
  out('═'.repeat(90));
  out('');
  out('  Step  │ Config                              │ IS N │ IS WR  │ IS PF │ OOS N │ OOS WR │ OOS PF │ ΔWR vs prev');
  out('  ──────┼─────────────────────────────────────┼──────┼────────┼───────┼───────┼────────┼────────┼────────────');

  let stepIdx=0;
  let prevOosWR=null;

  function runStep(){
    if(stepIdx>=steps.length){
      runStudy(studyIdx+1);
      return;
    }
    const {label:stepLabel,override}=steps[stepIdx];
    process.stdout.write(`\r  Running [${label}] step ${stepIdx+1}/${steps.length}: ${stepLabel.trim()}...   `);

    const w=new Worker(__filename,{
      workerData:{setKey,baseline,override,files:allFiles,engineDir:ENGINE_DIR}
    });
    w.on('message',msg=>{
      if(msg.type==='done'){
        const {is,oos}=splitISOS(msg.trades);
        const isS=calcStats(is),oosS=calcStats(oos);
        const dWR=prevOosWR!==null?(oosS.wr-prevOosWR):null;
        const dStr=dWR===null?'   —   ':(dWR>=0?'  +'+dWR.toFixed(1)+'%':'  '+dWR.toFixed(1)+'%');
        const flag=dWR===null?'':dWR>3?'  ✅':dWR<-3?'  ❌':dWR>0?'  🟡':'  🟠';
        const lbl=stepLabel.padEnd(37);
        process.stdout.write('\r');
        out(`  ${String(stepIdx).padStart(4)}  │ ${lbl} │ ${String(isS.n).padStart(4)} │ ${isS.wr.toFixed(1).padStart(5)}% │ ${isS.pf.toFixed(2).padStart(5)} │ ${String(oosS.n).padStart(5)} │ ${oosS.wr.toFixed(1).padStart(5)}% │ ${oosS.pf.toFixed(2).padStart(5)} │${dStr}${flag}`);
        prevOosWR=oosS.wr;
        stepIdx++;
        runStep();
      }
    });
    w.on('error',e=>{
      console.error(`\n❌ Step error:`,e.message);
      stepIdx++;
      runStep();
    });
  }

  runStep();
}

const startTime=Date.now();
runStudy(0);
