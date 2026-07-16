'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.DATA_DIR || 'C:/Users/drkkr/Downloads/NIFTY ALL1783';
const ENGINE_DIR = process.env.ENGINE_DIR || path.join(__dirname, '_compiled_current');
const PARAM_FILE = process.env.ORS_PARAM_FILE || path.join(__dirname, 'ors_v3_base_vs_candidate.json');
const HISTORY_WINDOW = Number(process.env.HISTORY_WINDOW || 320);
const MIN_HISTORY = Number(process.env.MIN_HISTORY || 260);
const N_WORKERS = Math.max(1, Number(process.env.N_WORKERS || Math.min(8, Math.max(1, os.cpus().length - 1))));
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const ACTIONABLE = new Set(['BUY', 'STRONG_BUY', 'ULTRA_STRONG_BUY']);

function parseDate(raw) {
  const s = String(raw || '').trim();
  if (/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(s)) {
    const [dd, mon, yyyy] = s.split('-'); const mm = String((MONTHS[mon] ?? 0) + 1).padStart(2, '0'); const iso = `${yyyy}-${mm}-${dd.padStart(2, '0')}`;
    return { iso, ts: Math.floor(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)) / 1000) };
  }
  const iso = s.slice(0, 10), ts = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ts) ? { iso, ts: Math.floor(ts / 1000) } : { iso: '', ts: 0 };
}

function parseCSV(fp) {
  const lines = fs.readFileSync(fp, 'utf8').trim().split(/\r?\n/); if (!lines.length) return [];
  const h = lines[0].split(',').map(x => x.trim().toLowerCase()), ix = n => h.indexOf(n);
  const d=ix('date'), o=ix('open'), hi=ix('high'), lo=ix('low'), c=ix('close'), v=ix('volume'); if ([d,o,hi,lo,c,v].some(x=>x<0)) return [];
  const out=[]; for(let i=1;i<lines.length;i++){const p=lines[i].split(','), q=parseDate(p[d]); const row={ts:q.ts,date:q.iso,o:+p[o],h:+p[hi],l:+p[lo],c:+p[c],v:+p[v]||0}; if(q.ts&&[row.o,row.h,row.l,row.c].every(Number.isFinite)&&row.c>0)out.push(row);}
  return out.sort((a,b)=>a.ts-b.ts);
}

function pct(n,d){return d>0?n/d*100:0;} function avg(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:0;}
function wilson(h,n){if(!n)return 0;const z=1.96,p=h/n;return (p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n)*100;}

function simulate(c, signalIdx, r, p) {
  const entryIdx=signalIdx+1, entry=c[entryIdx]?.o, pe=r.priceEngine||{};
  const planned=Number(pe.plannedEntry), plannedStop=Number(pe.tacticalStop), sl=Number(p.slAtrMult), tp=Number(p.tpPct);
  if(!Number.isFinite(entry)||entry<=0||!Number.isFinite(planned)||!Number.isFinite(plannedStop)||!Number.isFinite(sl)||sl<=0||!Number.isFinite(tp))return null;
  const atr=Math.max(0.0001,(planned-plannedStop)/sl), stop=entry-sl*atr, target=entry*(1+tp/100), hold=Math.max(1,Math.round(p.maxHoldBars));
  if(stop<=0||stop>=entry)return null;
  let pnl=0,status='time',mfe=0,mae=0,exitIdx=Math.min(entryIdx+hold-1,c.length-1);
  for(let i=entryIdx;i<=exitIdx;i++){const b=c[i],hp=(b.h-entry)/entry*100,lp=(b.l-entry)/entry*100;mfe=Math.max(mfe,hp);mae=Math.min(mae,lp);
    if(b.o<=stop){pnl=(b.o-entry)/entry*100;status='stop_gap';exitIdx=i;break;}
    if(b.l<=stop){pnl=(stop-entry)/entry*100;status='stop';exitIdx=i;break;}
    if(b.h>=target){pnl=tp;status='target';exitIdx=i;break;}
    if(i===exitIdx)pnl=(b.c-entry)/entry*100;
  }
  return {pnl,pnlR:pnl/Math.max(0.0001,(entry-stop)/entry*100),mfe,mae,status,days:exitIdx-entryIdx+1,signalDate:c[signalIdx].date,hit3_10:mfe>=3,hit5_10:mfe>=5,hit5_20:mfe>=5};
}

function worker(files, config){const engine=require(path.join(config.engineDir,'stockEngine.js'));const out=Object.fromEntries(Object.keys(config.params).map(k=>[k,[]]));let done=0,skipped=0,minDate='',maxDate='';
  for(const fp of files){const sym=path.basename(fp).replace(/_NS_OHLCV\.csv$/i,'').replace(/\.csv$/i,'');const c=parseCSV(fp);if(c.length<MIN_HISTORY+30){skipped++;done++;parentPort.postMessage({type:'progress',done,skipped});continue;}
    if(!minDate||c[0].date<minDate)minDate=c[0].date;if(!maxDate||c[c.length-1].date>maxDate)maxDate=c[c.length-1].date;
    const nextAllowed=Object.fromEntries(Object.keys(config.params).map(k=>[k,0]));
    for(let i=MIN_HISTORY;i<c.length-1;i++){const w=c.slice(Math.max(0,i+1-HISTORY_WINDOW),i+1);
      for(const [key,payload] of Object.entries(config.params)){engine.PARAM_SETS.ors_prime_reversal.ors=payload.ors;let r;try{r=engine.analyzeStock(w,'ors_prime_reversal');}catch{continue;}if(!ACTIONABLE.has(r.stage))continue;if(i<nextAllowed[key])continue;const sim=simulate(c,i,r,payload.ors);if(!sim)continue;out[key].push({sym,idx:i,...sim});nextAllowed[key]=i+Math.max(1,sim.days);}
    }
    done++;parentPort.postMessage({type:'progress',done,skipped});
  }
  parentPort.postMessage({type:'done',out,meta:{skipped,minDate,maxDate}});
}

function stats(raw){const s=[...raw].sort((a,b)=>a.signalDate.localeCompare(b.signalDate)),cut=Math.floor(s.length*.7),split=a=>{const w=a.filter(t=>t.pnl>0),l=a.filter(t=>t.pnl<=0),gw=w.reduce((x,t)=>x+t.pnl,0),gl=Math.abs(l.reduce((x,t)=>x+t.pnl,0));return{n:a.length,wr:pct(w.length,a.length),wilson:wilson(w.length,a.length),avg:avg(a.map(t=>t.pnl)),pf:gl?gw/gl:(gw>0?Infinity:0),avgR:avg(a.map(t=>t.pnlR)),mfe:avg(a.map(t=>t.mfe)),mae:avg(a.map(t=>t.mae)),hit3_10:pct(a.filter(t=>t.hit3_10).length,a.length),hit5_10:pct(a.filter(t=>t.hit5_10).length,a.length),hit5_20:pct(a.filter(t=>t.hit5_20).length,a.length)};};return{all:split(s),oos:split(s.slice(cut)),trades:s};}
function fmt(x,d=2){return Number(x||0).toFixed(d);}function pf(x){return x===Infinity?'Inf':fmt(x);}

if(!isMainThread){worker(workerData.files,workerData.config);return;}
const params=JSON.parse(fs.readFileSync(PARAM_FILE,'utf8'));const files=fs.readdirSync(DATA_DIR).filter(f=>f.toLowerCase().endsWith('.csv')&&!f.toLowerCase().includes('_all')&&!f.toLowerCase().includes('all_symbols')).map(f=>path.join(DATA_DIR,f));
const chunks=Array.from({length:Math.min(N_WORKERS,files.length)},()=>[]);files.forEach((f,i)=>chunks[i%chunks.length].push(f));let done=0,skipped=0,minDate='',maxDate='',last=0;const combined=Object.fromEntries(Object.keys(params).map(k=>[k,[]]));const started=Date.now();
console.log(`ORS exact-engine validation | files=${files.length} workers=${chunks.length} input=${PARAM_FILE}`);
function progress(force=false){const now=Date.now();if(!force&&now-last<1000)return;last=now;const elapsed=(now-started)/1000,rate=done/Math.max(1,elapsed),eta=rate?(files.length-done)/rate:0;process.stdout.write(`\rProgress ${done}/${files.length} (${fmt(pct(done,files.length),1)}%) ETA ${eta.toFixed(0)}s   `);}
Promise.all(chunks.map(chunk=>new Promise((resolve,reject)=>{const w=new Worker(__filename,{workerData:{files:chunk,config:{engineDir:ENGINE_DIR,params}}});let wd=0;w.on('message',m=>{if(m.type==='progress'){done+=m.done-wd;wd=m.done;progress();}else if(m.type==='done'){for(const k of Object.keys(params))combined[k].push(...m.out[k]);skipped+=m.meta.skipped||0;if(m.meta.minDate&&(!minDate||m.meta.minDate<minDate))minDate=m.meta.minDate;if(m.meta.maxDate&&(!maxDate||m.meta.maxDate>maxDate))maxDate=m.meta.maxDate;resolve();}});w.on('error',reject);w.on('exit',c=>{if(c)reject(new Error(`worker exit ${c}`));});}))).then(()=>{progress(true);console.log('\n');const result={};for(const k of Object.keys(params))result[k]=stats(combined[k]);const stamp=new Date().toISOString().replace(/[:.]/g,'-'),json=path.join(__dirname,`ors_exact_validation_${stamp}.json`),txt=path.join(__dirname,`ors_exact_validation_${stamp}.txt`);const lines=[`Data: ${DATA_DIR}`,`Files: ${files.length}; skipped=${skipped}; date=${minDate} to ${maxDate}`,`Convention: exact analyzeStock(ors_prime_reversal), next-open, stop-first, per-symbol non-overlap, 70/30 chronological OOS`,''];for(const k of Object.keys(result)){const a=result[k].all,o=result[k].oos;lines.push(`${k}: n=${a.n} WR=${fmt(a.wr,1)}% Wilson=${fmt(a.wilson,1)}% Avg=${fmt(a.avg)}% PF=${pf(a.pf)} AvgR=${fmt(a.avgR,3)} MFE=${fmt(a.mfe)}% MAE=${fmt(a.mae)}% Hit3/10=${fmt(a.hit3_10,1)}% Hit5/10=${fmt(a.hit5_10,1)}% Hit5/20=${fmt(a.hit5_20,1)}% | OOS n=${o.n} WR=${fmt(o.wr,1)}% Avg=${fmt(o.avg)}% PF=${pf(o.pf)} Hit5/20=${fmt(o.hit5_20,1)}%`);}fs.writeFileSync(json,JSON.stringify({meta:{dataDir:DATA_DIR,files:files.length,skipped,minDate,maxDate,paramFile:PARAM_FILE,runAt:new Date().toISOString()},result},null,2));fs.writeFileSync(txt,lines.join('\n'));console.log(lines.join('\n'));console.log(`JSON: ${json}\nTXT: ${txt}`);}).catch(e=>{console.error(e.stack||e);process.exit(1);});
