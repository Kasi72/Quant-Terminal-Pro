// MONSTER OPTIMIZER — Brute-force grid search across all parameter combinations
// Tests 50,000+ combinations per param set to find optimal settings
// Goal: Maximum trades with ≥80% hit rate (or best hit rate with ≥2x trades)

const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/drkkr/Downloads/Portfolio';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv') && !f.includes('(1)'));

function parseCSV(fp){const lines=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<lines.length;i++){const[date,o,h,l,cl,v]=lines[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+l,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function rsi2(c){const r=new Array(c.length).fill(50);if(c.length<4)return r;let g=0,l=0;for(let i=1;i<=2;i++){const ch=c[i].c-c[i-1].c;if(ch>0)g+=ch;else l+=Math.abs(ch);}g/=2;l/=2;for(let i=3;i<c.length;i++){const ch=c[i].c-c[i-1].c;g=(g+Math.max(ch,0))/2;l=(l+Math.max(-ch,0))/2;r[i]=l<1e-4?100:100-100/(1+g/l);}return r;}
function pR(w,v){return w.length===0?50:(w.filter(x=>x<v).length/w.length)*100;}

// Pre-compute ALL breakout signals with raw features
const ALL = [];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c),r2=rsi2(c);
  for(let i=40;i<c.length-11;i++){
    const s=c[i];if(s.c<=0||a[i]<=0)continue;const r=s.h-s.l;if(r<=0)continue;
    const ap=(a[i]/s.c)*100;const w=[];for(let j=Math.max(14,i-121);j<i;j++){if(c[j].c>0&&a[j]>0)w.push((a[j]/c[j].c)*100);}
    const apctl=pR(w,ap);const ra=r/a[i],cl=(s.c-s.l)/r*100,bp=Math.abs(s.c-s.o)/r*100,uw=(s.h-Math.max(s.o,s.c))/r*100,sr=(r/s.c)*100;
    let tS=0;for(let j=Math.max(0,i-20);j<i;j++)tS+=c[j].c*c[j].v;const to=tS/Math.max(i-Math.max(0,i-20),1);
    let p10R=0,p10C=0,p10E=0;for(let j=i-10;j<i;j++){if(j<1)continue;const t=Math.max(c[j].h-c[j].l,Math.abs(c[j].h-c[j-1].c),Math.abs(c[j].l-c[j-1].c));const x=t/a[j];p10R+=x;p10C++;if(x>1.1)p10E++;}
    const p10A=p10C>0?p10R/p10C:1;const vE=p10A>0?ra/p10A:1;
    let v20=0;for(let j=Math.max(0,i-20);j<i;j++)v20+=c[j].v;v20/=Math.max(i-Math.max(0,i-20),1);const vR=v20>0?s.v/v20:0;
    let v5=0;for(let j=Math.max(0,i-5);j<i;j++)v5+=c[j].v;v5/=Math.max(i-Math.max(0,i-5),1);const vP=v5>0?s.v/v5:0;
    let p10VS=0,p10VC=0;for(let j=i-10;j<i;j++){if(j<0)continue;p10VS+=(v20>0?c[j].v/v20:0);p10VC++;}const p10V=p10VC>0?p10VS/p10VC:1;
    let p5VS=0,p5VC=0;for(let j=i-5;j<i;j++){if(j<0)continue;p5VS+=(v20>0?c[j].v/v20:0);p5VC++;}const p5V=p5VC>0?p5VS/p5VC:1;
    let rVol=0,gVol=0;for(let j=i-10;j<i;j++){if(j<0)continue;if(c[j].c<c[j].o)rVol+=c[j].v;else gVol+=c[j].v;}const rvb=gVol>0?rVol/gVol:(rVol>0?10:1);
    // Zone detection — try multiple thresholds
    let zones = {};
    for(const zRAThr of [0.8, 1.0, 1.2, 1.5]) {
      for(let zL=40;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;
        for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>zRAThr)ok=false;}
        if(!ok)continue;const zt=zLo>0?((zH-zLo)/zLo)*100:99;
        if(!zones[zRAThr]||zL>zones[zRAThr].len)zones[zRAThr]={zH,zL:zLo,len:zL,zt};break;}}
    // Use 1.0 threshold as default zone
    const bZ=zones[1.0];
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const caz=bZ.zH>0?((s.c-bZ.zH)/bZ.zH)*100:0;
    // UPS and CQS
    function ups(cl,uw,bp,vp,zt,zl){let s=0;if(cl>=80)s+=20;else if(cl>=65)s+=12;if(uw<=20)s+=20;else if(uw<=35)s+=12;if(bp>=55)s+=15;else if(bp>=35)s+=9;if(vp>=4)s+=20;else if(vp>=2)s+=12;if(zt<=5)s+=15;else if(zt<=15)s+=9;if(zl>=12)s+=10;else if(zl>=6)s+=6;return s;}
    function cqs(cl,uw,bp,vp,ve){let s=0;if(cl>=65)s++;if(uw<=30)s++;if(bp>=40)s++;if(vp>=2.5)s++;if(ve>=1.5)s++;return s;}
    const uV=ups(cl,uw,bp,vP,bZ.zt,bZ.len);const cV=cqs(cl,uw,bp,vP,vE);
    // Future performance
    let mfe=0,mae=0,h5=false,h3=false,d5=99,h7=false,h10=false;
    for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){const p=(c[d].h-s.c)/s.c*100;const dr=(c[d].l-s.c)/s.c*100;if(p>mfe)mfe=p;if(dr<mae)mae=dr;if(!h3&&p>=3)h3=true;if(!h5&&p>=5){h5=true;d5=d-i;}if(!h7&&p>=7)h7=true;if(!h10&&p>=10)h10=true;}
    let stopped35=false;for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){if((c[d].l-s.c)/s.c*100<=-3.5){stopped35=true;break;}}
    const isGreen=s.c>s.o;
    ALL.push({sym,date:c[i].date,to,apctl,p10A,p10E,bZ,p10V,p5V,rvb,ra,vR,vP,cl,uw,bp,sr,uV,cV,rsi2:r2[i],vE,caz,mfe,mae,h5,h3,h7,h10,d5,stopped35,isGreen,zones});
  }
}
console.log(`Total breakout candles: ${ALL.length}`);
console.log(`Winners (+5%): ${ALL.filter(s=>s.h5).length} (${(ALL.filter(s=>s.h5).length/ALL.length*100).toFixed(1)}%)`);
console.log(`Winners (+3%): ${ALL.filter(s=>s.h3).length} (${(ALL.filter(s=>s.h3).length/ALL.length*100).toFixed(1)}%)\n`);

// Scoring function: maximize composite = trades × hitRate² × avgMFE (penalizes low hit rate heavily)
function score(trades) {
  if(trades.length<2) return -1;
  const hits=trades.filter(t=>t.h5).length;
  const rate=hits/trades.length;
  if(rate<0.70) return -1; // hard floor
  const avgMfe=trades.reduce((s,t)=>s+t.mfe,0)/trades.length;
  const avgMae=trades.reduce((s,t)=>s+t.mae,0)/trades.length;
  // Composite: trades × rate² × (avgMFE + 5) — penalizes few trades, rewards high rate + high MFE
  return trades.length * rate * rate * (avgMfe + 5) * (1 + Math.min(avgMae + 10, 5)/5);
}

function filter(sigs, p) {
  return sigs.filter(s => {
    if(s.to<p.minTO)return false;if(s.apctl>p.maxAP)return false;if(s.p10A>p.maxPRR)return false;
    if(s.p10E>p.maxEC)return false;if(s.bZ.len<p.minZL||s.bZ.len>p.maxZL)return false;
    if(s.bZ.zt>p.maxZT)return false;if(s.p10V>p.maxPV)return false;if(s.p5V>p.maxP5V)return false;
    if(s.rvb>p.maxRVB)return false;if(s.ra<p.minRA||s.ra>p.maxRA)return false;
    if(s.vR<p.minVR)return false;if(s.vP<p.minVP5)return false;if(s.cl<p.minCL)return false;
    if(s.uw>p.maxUW)return false;if(s.bp<p.minBP)return false;if(s.sr>p.maxSR)return false;
    if(s.uV<p.minUPS)return false;if(s.rsi2<p.minRSI)return false;
    if(p.minVE!==null&&s.vE<p.minVE)return false;if(p.minCQS!==null&&s.cV<p.minCQS)return false;
    if(p.maxCAZ!==null&&s.caz>p.maxCAZ)return false;
    if(p.greenOnly&&!s.isGreen)return false;
    return true;
  });
}

// Grid search dimensions per param set
const GRIDS = {
  D20: {
    base:{name:'D20+ Deployable',minTO:1e7,maxAP:85,maxPRR:0.75,maxEC:2,minZL:6,maxZL:20,maxZT:15,maxPV:0.90,maxP5V:1.00,maxRVB:1.10,minRA:1.0,maxRA:5.0,minVR:1.00,minVP5:2.00,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:60,minRSI:50,minVE:1.50,minCQS:3,maxCAZ:null,greenOnly:false},
    search:{
      maxPRR:[0.65,0.75,0.85,0.95,1.0,1.2],
      maxEC:[1,2,3,5],
      maxZT:[10,12,15,20,25],
      maxRVB:[1.1,1.3,1.5,2.0,3.0],
      maxPV:[0.80,0.90,1.0,1.1],
      maxP5V:[0.90,1.0,1.1,1.2],
      minVP5:[1.0,1.5,2.0,2.5],
      minUPS:[35,45,50,55,60],
      minCL:[55,60,65,70],
      minBP:[20,25,30,35],
      maxSR:[7,8.5,10,12],
      minVE:[1.0,1.25,1.5,null],
      minCQS:[1,2,3,null],
    }
  },
  HP15: {
    base:{name:'HP15+ HighPrec',minTO:1e7,maxAP:85,maxPRR:0.75,maxEC:0,minZL:6,maxZL:25,maxZT:15,maxPV:0.90,maxP5V:1.10,maxRVB:1.10,minRA:1.0,maxRA:5.0,minVR:1.10,minVP5:2.00,minCL:65,maxUW:35,minBP:25,maxSR:11.0,minUPS:45,minRSI:50,minVE:null,minCQS:null,maxCAZ:8.0,greenOnly:false},
    search:{
      maxPRR:[0.65,0.75,0.85,1.0,1.2],
      maxEC:[0,1,2,3,5],
      maxZT:[10,12,15,20,25],
      maxRVB:[1.1,1.3,1.5,2.0,3.0],
      maxPV:[0.80,0.90,1.0,1.1],
      minVP5:[1.0,1.5,2.0,2.5],
      minUPS:[35,40,45,50],
      maxCAZ:[5,8,10,15,null],
      minBP:[15,20,25,30],
      maxSR:[8.5,10,11,13],
    }
  },
  E10: {
    base:{name:'E10+ Elite',minTO:2e7,maxAP:60,maxPRR:0.95,maxEC:4,minZL:8,maxZL:15,maxZT:12,maxPV:0.85,maxP5V:0.90,maxRVB:1.20,minRA:1.0,maxRA:6.0,minVR:1.00,minVP5:3.00,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:45,minRSI:50,minVE:1.10,minCQS:3,maxCAZ:null,greenOnly:false},
    search:{
      minTO:[1e7,1.5e7,2e7],
      maxAP:[50,60,70,85],
      maxPRR:[0.75,0.85,0.95,1.0,1.2],
      maxEC:[2,3,4,5,8],
      minZL:[5,6,7,8],
      maxZL:[12,15,18,20,25],
      maxZT:[8,10,12,15,20,25],
      maxRVB:[1.1,1.2,1.5,2.0,3.0],
      maxPV:[0.75,0.85,0.95,1.0],
      maxP5V:[0.8,0.9,1.0,1.1,1.2],
      minVP5:[1.5,2.0,2.5,3.0],
      minCL:[55,60,65,70],
      minBP:[25,30,35,40],
      minVE:[0.8,1.0,1.1,1.25,null],
      minCQS:[1,2,3,null],
      minUPS:[35,40,45,50],
    }
  },
  US8: {
    base:{name:'US8+ UltraSel',minTO:1e7,maxAP:60,maxPRR:0.75,maxEC:0,minZL:6,maxZL:15,maxZT:8,maxPV:0.85,maxP5V:1.10,maxRVB:1.10,minRA:1.0,maxRA:6.0,minVR:1.20,minVP5:2.00,minCL:65,maxUW:40,minBP:25,maxSR:8.5,minUPS:45,minRSI:55,minVE:1.50,minCQS:null,maxCAZ:null,greenOnly:false},
    search:{
      maxAP:[50,60,70,85,95],
      maxPRR:[0.65,0.75,0.85,1.0,1.2],
      maxEC:[0,1,2,3,5],
      maxZL:[12,15,18,20,25],
      maxZT:[5,8,10,12,15,20],
      maxRVB:[1.1,1.2,1.5,2.0,3.0],
      maxPV:[0.75,0.85,0.95,1.0],
      maxP5V:[0.9,1.0,1.1,1.2],
      minVP5:[1.0,1.5,2.0,2.5],
      minCL:[55,60,65,70],
      minBP:[20,25,30,35],
      minUPS:[35,40,45,50],
      minRSI:[30,40,50,55],
      minVE:[1.0,1.25,1.5,null],
    }
  }
};

// For each param set, do a multi-pass hill-climbing grid search
for (const [key, grid] of Object.entries(GRIDS)) {
  console.log(`\n${'█'.repeat(70)}`);
  console.log(`  MONSTER GRID SEARCH: ${grid.base.name}`);
  console.log(`${'█'.repeat(70)}`);

  const baseResult = filter(ALL, grid.base);
  const baseHits = baseResult.filter(t=>t.h5).length;
  const baseRate = baseResult.length>0?(baseHits/baseResult.length*100):0;
  const baseScore = score(baseResult);
  console.log(`  Baseline: ${baseResult.length} trades, ${baseHits} hits, ${baseRate.toFixed(1)}%, score=${baseScore.toFixed(0)}`);

  // Phase 1: Test each param individually to find best single value
  const paramKeys = Object.keys(grid.search);
  let best = {...grid.base};
  let bestScore = baseScore;
  let bestResult = baseResult;
  let improved = true;
  let pass = 0;

  while (improved && pass < 10) {
    improved = false;
    pass++;
    for (const pk of paramKeys) {
      let localBest = best[pk];
      let localBestScore = bestScore;
      for (const val of grid.search[pk]) {
        const test = {...best, [pk]: val};
        const result = filter(ALL, test);
        const s = score(result);
        if (s > localBestScore) {
          localBest = val;
          localBestScore = s;
        }
      }
      if (localBest !== best[pk]) {
        best = {...best, [pk]: localBest};
        bestScore = localBestScore;
        bestResult = filter(ALL, best);
        improved = true;
      }
    }
  }
  console.log(`  Hill-climb passes: ${pass}`);

  // Phase 2: Random perturbation search (test 20000 random combos around best)
  let rndBest = {...best};
  let rndBestScore = bestScore;
  const rndParams = paramKeys.filter(pk => grid.search[pk].length > 1);
  for (let iter = 0; iter < 20000; iter++) {
    const test = {...rndBest};
    // Perturb 2-4 random params
    const nPerturb = 2 + Math.floor(Math.random() * 3);
    for (let p = 0; p < nPerturb; p++) {
      const pk = rndParams[Math.floor(Math.random() * rndParams.length)];
      const vals = grid.search[pk];
      test[pk] = vals[Math.floor(Math.random() * vals.length)];
    }
    const s = score(filter(ALL, test));
    if (s > rndBestScore) {
      rndBestScore = s;
      Object.assign(rndBest, test);
    }
  }
  if (rndBestScore > bestScore) {
    best = rndBest;
    bestScore = rndBestScore;
    bestResult = filter(ALL, best);
  }

  // Phase 3: Exhaustive 2-param grid around best (fine-tune top 6 params)
  const top6 = paramKeys.slice(0, Math.min(6, paramKeys.length));
  for (let a = 0; a < top6.length; a++) {
    for (let b = a + 1; b < top6.length; b++) {
      for (const va of grid.search[top6[a]]) {
        for (const vb of grid.search[top6[b]]) {
          const test = {...best, [top6[a]]: va, [top6[b]]: vb};
          const s = score(filter(ALL, test));
          if (s > bestScore) {
            bestScore = s;
            best = test;
            bestResult = filter(ALL, best);
          }
        }
      }
    }
  }

  const finalHits = bestResult.filter(t=>t.h5).length;
  const finalRate = bestResult.length>0?(finalHits/bestResult.length*100):0;
  const avgMfe = bestResult.reduce((s,t)=>s+t.mfe,0)/bestResult.length;
  const avgMae = bestResult.reduce((s,t)=>s+t.mae,0)/bestResult.length;

  console.log(`\n  ╔═══════════════════════════════════════════════════════════╗`);
  console.log(`  ║  OPTIMIZED ${grid.base.name.padEnd(20)}                      ║`);
  console.log(`  ╠═══════════════════════════════════════════════════════════╣`);
  console.log(`  ║  Trades: ${String(baseResult.length).padStart(2)} → ${String(bestResult.length).padStart(2)}  (+${bestResult.length-baseResult.length})                                ║`);
  console.log(`  ║  Hits:   ${String(baseHits).padStart(2)} → ${String(finalHits).padStart(2)}  (+${finalHits-baseHits})                                ║`);
  console.log(`  ║  Rate:   ${baseRate.toFixed(1)}% → ${finalRate.toFixed(1)}%                              ║`);
  console.log(`  ║  MFE:    +${avgMfe.toFixed(1)}%   MAE: ${avgMae.toFixed(1)}%                        ║`);
  console.log(`  ╚═══════════════════════════════════════════════════════════╝`);

  // Show changed params
  console.log('\n  Parameter Changes:');
  console.log('  Parameter          │ Old Value  │ New Value  │ Changed?');
  console.log('  ───────────────────┼────────────┼────────────┼─────────');
  for (const pk of paramKeys) {
    const oldV = grid.base[pk];
    const newV = best[pk];
    const changed = oldV !== newV;
    if (changed) {
      console.log(`  ${pk.padEnd(19)} │ ${String(oldV).padStart(10)} │ ${String(newV).padStart(10)} │ ← CHANGED`);
    }
  }

  // Show all trades
  console.log(`\n  All ${bestResult.length} trades:`);
  console.log('  Symbol       │ Date       │ +5% │ +7% │+10% │ MFE    │ MAE    │ Days5');
  for (const t of bestResult.sort((a,b)=>b.mfe-a.mfe)) {
    console.log(`  ${t.sym.padEnd(12)} │ ${(t.date||'—').padEnd(10)} │ ${t.h5?'YES':'NO '} │ ${t.h7?'YES':'NO '} │ ${t.h10?'YES':'NO '} │ ${t.mfe.toFixed(1).padStart(5)}% │ ${t.mae.toFixed(1).padStart(5)}% │ ${t.h5?String(t.d5).padStart(5):'  —'}`);
  }

  // Wilson lower bound
  if(bestResult.length > 0) {
    const n=bestResult.length,p=finalHits/n,z=1.96;
    const wlb=(p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n);
    console.log(`\n  Wilson 95% Lower Bound: ${(wlb*100).toFixed(1)}%`);
  }

  // Full optimized params for implementation
  console.log('\n  ═══ FULL OPTIMIZED PARAM SET (for stockEngine.ts) ═══');
  const implParams = ['minTO','maxAP','maxPRR','maxEC','minZL','maxZL','maxZT','maxPV','maxP5V','maxRVB','minRA','maxRA','minVR','minVP5','minCL','maxUW','minBP','maxSR','minUPS','minRSI','minVE','minCQS','maxCAZ'];
  const paramMap = {minTO:'minAvgTurnover20',maxAP:'maxATRPct14Pctl120',maxPRR:'maxPre10AvgRangeATR',maxEC:'maxPre10ExpansionCount',minZL:'minZoneLen',maxZL:'maxZoneLen',maxZT:'maxZoneTightnessPct',maxPV:'maxPre10AvgVolRatio',maxP5V:'maxPre5AvgVolRatio',maxRVB:'maxPre10RedVolBias',minRA:'minExactRangeATR14',maxRA:'maxExactRangeATR14',minVR:'minExactVolRatio20',minVP5:'minExactVolVsPre5',minCL:'minCloseLoc',maxUW:'maxUpperWickPct',minBP:'minBodyPct',maxSR:'maxCandleRisk',minUPS:'minUltraPrecisionScore',minRSI:'minRSI2',minVE:'minVolatilityExpansionRatio',minCQS:'minCandleQualityScore',maxCAZ:'maxCloseAboveZonePct'};
  for (const pk of implParams) {
    const v = best[pk] !== undefined ? best[pk] : grid.base[pk];
    const eng = paramMap[pk] || pk;
    console.log(`  ${eng}: ${v === null ? 'null' : v},`);
  }
}
