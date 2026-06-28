// PCA ANALYSIS — Principal Component Analysis on 78 OHLCV files
// Discover hidden factors that predict breakout success
// Extract feature vectors from all D20+ signals, run PCA, find super-factors

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];
function pY(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6||isNaN(+p[4])||+p[4]<=0)continue;c.push({o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]});}return c;}
function pN(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<11||isNaN(+p[8])||+p[8]<=0)continue;c.push({o:+p[4],h:+p[5],l:+p[6],c:+p[8],v:+p[10]||0});}return c;}
function a14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function r2(c){const r=new Array(c.length).fill(50);for(let i=3;i<c.length;i++){let g=0,l=0;for(let j=i-1;j<=i;j++){const d=c[j].c-c[j-1].c;if(d>0)g+=d;else l-=d;}r[i]=l===0?100:100-100/(1+g/2/(l/2));}return r;}

const SD=[];
for(const{dir,format}of DIRS){if(!fs.existsSync(dir))continue;for(const f of fs.readdirSync(dir)){if(!f.endsWith('.csv')||f.includes('ALL_SYMBOLS'))continue;const c=format==='nse'?pN(path.join(dir,f)):pY(path.join(dir,f));if(c.length<80)continue;SD.push({sym:f.replace('_NS_OHLCV.csv','').replace('.csv',''),c,a:a14(c),rsi:r2(c)});}}

// Extract feature vectors from ALL breakout signals (relaxed params to get max data)
const signals = [];
for(const{sym,c,a,rsi}of SD){const n=c.length;
for(let i=30;i<n-11;i++){
  if(a[i]<=0||c[i].c<=0)continue;const s=c[i],rng=s.h-s.l;if(rng<=0)continue;
  const eRA=rng/a[i],cL=(s.c-s.l)/rng*100,uW=(s.h-Math.max(s.c,s.o))/rng*100,bP=Math.abs(s.c-s.o)/rng*100;
  let v20=0;for(let j=i-20;j<i;j++){if(j>=0)v20+=c[j].v;}v20/=20;
  let v5=0;for(let j=i-5;j<i;j++){if(j>=0)v5+=c[j].v;}v5/=5;
  const eVR=v20>0?s.v/v20:0,eVP5=v5>0?s.v/v5:0;
  let p10R=0,p10E=0;for(let j=i-10;j<i;j++){if(j<1)continue;p10R+=(c[j].h-c[j].l)/(a[j]||1);if((c[j].h-c[j].l)/(a[j]||1)>1.1)p10E++;}p10R/=10;

  // Zone detection with descending rejection
  let zone=null;
  for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;
    for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}
    if(!ok)continue;const t=zLo>0?(zH-zLo)/zLo*100:999;if(t>20)continue;
    const mid=Math.floor(zL/2);let fhH=-Infinity,shH=-Infinity,fhL=Infinity,shL=Infinity;
    for(let j=zS;j<zS+mid;j++){fhH=Math.max(fhH,c[j].h);fhL=Math.min(fhL,c[j].l);}
    for(let j=zS+mid;j<i;j++){shH=Math.max(shH,c[j].h);shL=Math.min(shL,c[j].l);}
    if(shH<fhH*0.995&&shL<=fhL*1.005)continue;
    zone={zH,zL:zLo,len:zL,t};break;}
  if(!zone||s.c<=zone.zH*1.001)continue;

  // UPS
  let ups=0;if(cL>=80)ups+=20;else if(cL>=65)ups+=12;if(uW<=20)ups+=20;else if(uW<=35)ups+=12;
  if(bP>=55)ups+=15;else if(bP>=35)ups+=9;if(eVP5>=4)ups+=20;else if(eVP5>=2)ups+=12;
  if(zone.t<=5)ups+=15;else if(zone.t<=15)ups+=9;if(zone.len>=12)ups+=10;else if(zone.len>=6)ups+=6;
  let cq=0;if(cL>=65)cq++;if(uW<=30)cq++;if(bP>=40)cq++;if(eVP5>=2.5)cq++;if(eRA>=1.5)cq++;

  // Basic filter — must be a real breakout
  if(eRA<0.5||eVR<0.5)continue;

  // Forward outcome
  const rawSt=zone.zL-0.5*a[i],stPct=Math.max(3,Math.min(7,(s.c-rawSt)/s.c*100)),stP=s.c*(1-stPct/100);
  const aP=a[i]/s.c*100,t1P=Math.max(3,Math.min(6,2.5*aP));
  let mfe=0,mae=0,out='exp',hT1=false;
  for(let d=1;d<=10&&i+d<n;d++){const cd=c[i+d];const hp=(cd.h-s.c)/s.c*100,lp=(cd.l-s.c)/s.c*100;
    if(hp>mfe)mfe=hp;if(lp<mae)mae=lp;
    if(cd.c<=stP&&!hT1){out='stop';break;}if(cd.h>=s.c*(1+t1P/100))hT1=true;}
  if(out!=='stop')out=hT1?'hit':'exp';
  const win = out === 'hit' ? 1 : 0;

  // Feature vector (13 features)
  signals.push({
    features: [cL, uW, bP, eRA, eVR, eVP5, p10R, p10E, zone.t, zone.len, ups, cq, rsi[i]],
    featureNames: ['closeLoc','upperWick','bodyPct','exactRangeATR','exactVolRatio','exactVolVsPre5','pre10AvgRangeATR','pre10ExpCount','zoneTightness','zoneLen','UPS','candleQuality','RSI2'],
    win, mfe, mae, sym, out
  });
}}

console.log('█'.repeat(90));
console.log(`  PCA ANALYSIS — ${SD.length} stocks, ${signals.length} breakout signals`);
console.log(`  Winners: ${signals.filter(s=>s.win).length} | Losers: ${signals.filter(s=>!s.win).length}`);
console.log('█'.repeat(90));

const FEATURES = signals[0].featureNames;
const N = signals.length, P = FEATURES.length;

// ═══ STEP 1: Standardize features (z-score) ═══
const means = new Array(P).fill(0);
const stds = new Array(P).fill(0);
for(let f=0;f<P;f++){
  for(const s of signals) means[f]+=s.features[f];
  means[f]/=N;
  for(const s of signals) stds[f]+=(s.features[f]-means[f])**2;
  stds[f]=Math.sqrt(stds[f]/N)||1;
}
const Z = signals.map(s=>s.features.map((v,f)=>(v-means[f])/stds[f]));

// ═══ STEP 2: Correlation matrix ═══
console.log('\n═══ STEP 1: FEATURE CORRELATIONS WITH WIN/LOSS ═══\n');
console.log('  Feature            │ Mean(W) │ Mean(L) │ Δ      │ Correlation │ Impact');
console.log('  ───────────────────┼─────────┼─────────┼────────┼─────────────┼───────');
const winSigs = signals.filter(s=>s.win), loseSigs = signals.filter(s=>!s.win);
const featureCorr = [];
for(let f=0;f<P;f++){
  const mW = winSigs.reduce((s,v)=>s+v.features[f],0)/winSigs.length;
  const mL = loseSigs.reduce((s,v)=>s+v.features[f],0)/loseSigs.length;
  // Point-biserial correlation with win/loss
  let sxy=0,sx=0,sy=0,sx2=0,sy2=0;
  for(let i=0;i<N;i++){
    const x=signals[i].features[f],y=signals[i].win;
    sxy+=x*y;sx+=x;sy+=y;sx2+=x*x;sy2+=y*y;
  }
  const corr=(N*sxy-sx*sy)/Math.sqrt((N*sx2-sx*sx)*(N*sy2-sy*sy)||1);
  featureCorr.push({f,name:FEATURES[f],corr,mW,mL,delta:mW-mL});
  const impact = Math.abs(corr)>0.15?'★★★':Math.abs(corr)>0.10?'★★':Math.abs(corr)>0.05?'★':'';
  console.log(`  ${FEATURES[f].padEnd(19)} │ ${mW.toFixed(1).padStart(7)} │ ${mL.toFixed(1).padStart(7)} │ ${((mW-mL)>=0?'+':'')+(mW-mL).toFixed(1).padStart(6)} │ ${(corr>=0?'+':'')+corr.toFixed(3).padStart(11)} │ ${impact}`);
}
featureCorr.sort((a,b)=>Math.abs(b.corr)-Math.abs(a.corr));
console.log(`\n  Top predictors: ${featureCorr.slice(0,5).map(f=>`${f.name}(${f.corr>=0?'+':''}${f.corr.toFixed(3)})`).join(', ')}`);

// ═══ STEP 3: Covariance matrix & PCA ═══
console.log('\n═══ STEP 2: PCA — PRINCIPAL COMPONENT EXTRACTION ═══\n');

// Covariance matrix
const cov = Array.from({length:P},()=>new Array(P).fill(0));
for(let i=0;i<P;i++){for(let j=0;j<P;j++){
  for(let k=0;k<N;k++) cov[i][j]+=Z[k][i]*Z[k][j];
  cov[i][j]/=N;
}}

// Power iteration to find eigenvectors (top 5 PCs)
function powerIteration(matrix, numComponents, maxIter=200) {
  const dim = matrix.length;
  const components = [];
  const mat = matrix.map(r=>[...r]); // copy

  for(let comp=0;comp<numComponents;comp++){
    let vec = new Array(dim).fill(0).map(()=>Math.random()-0.5);
    // Normalize
    let norm = Math.sqrt(vec.reduce((s,v)=>s+v*v,0));
    vec = vec.map(v=>v/norm);

    for(let iter=0;iter<maxIter;iter++){
      // Multiply matrix × vector
      const newVec = new Array(dim).fill(0);
      for(let i=0;i<dim;i++) for(let j=0;j<dim;j++) newVec[i]+=mat[i][j]*vec[j];
      // Eigenvalue
      const eigenvalue = Math.sqrt(newVec.reduce((s,v)=>s+v*v,0));
      if(eigenvalue===0)break;
      vec = newVec.map(v=>v/eigenvalue);
    }
    // Eigenvalue
    const Av = new Array(dim).fill(0);
    for(let i=0;i<dim;i++) for(let j=0;j<dim;j++) Av[i]+=mat[i][j]*vec[j];
    const eigenvalue = vec.reduce((s,v,i)=>s+v*Av[i],0);

    components.push({vec:[...vec],eigenvalue});
    // Deflate
    for(let i=0;i<dim;i++) for(let j=0;j<dim;j++) mat[i][j]-=eigenvalue*vec[i]*vec[j];
  }
  return components;
}

const pcs = powerIteration(cov, 5);
const totalVar = pcs.reduce((s,p)=>s+Math.abs(p.eigenvalue),0);

console.log('  PC │ Eigenvalue │ Variance% │ Cumulative │ Interpretation');
console.log('  ───┼────────────┼───────────┼────────────┼──────────────');
let cumVar = 0;
for(let i=0;i<pcs.length;i++){
  const varPct = Math.abs(pcs[i].eigenvalue)/totalVar*100;
  cumVar += varPct;
  // Top 3 loadings
  const loadings = pcs[i].vec.map((v,f)=>({f,name:FEATURES[f],loading:v})).sort((a,b)=>Math.abs(b.loading)-Math.abs(a.loading));
  const interp = loadings.slice(0,3).map(l=>`${l.loading>=0?'+':''}${l.loading.toFixed(2)}×${l.name}`).join(', ');
  console.log(`  PC${i+1} │ ${pcs[i].eigenvalue.toFixed(3).padStart(10)} │ ${varPct.toFixed(1).padStart(8)}% │ ${cumVar.toFixed(1).padStart(9)}% │ ${interp}`);
}

// ═══ STEP 4: Name the principal components ═══
console.log('\n═══ STEP 3: PRINCIPAL COMPONENT LOADINGS (detailed) ═══\n');
for(let pc=0;pc<Math.min(4,pcs.length);pc++){
  console.log(`  PC${pc+1} — ${Math.abs(pcs[pc].eigenvalue/totalVar*100).toFixed(1)}% of variance:`);
  const loadings = pcs[pc].vec.map((v,f)=>({name:FEATURES[f],loading:v})).sort((a,b)=>Math.abs(b.loading)-Math.abs(a.loading));
  for(const l of loadings){
    const bar = '█'.repeat(Math.round(Math.abs(l.loading)*20));
    console.log(`    ${l.name.padEnd(19)} ${(l.loading>=0?'+':'')+l.loading.toFixed(3).padStart(6)} ${l.loading>=0?'▓':'░'}${bar}`);
  }
  console.log('');
}

// ═══ STEP 5: Compute PCA scores and test as predictor ═══
console.log('═══ STEP 4: PCA SCORE AS WIN PREDICTOR ═══\n');

// PC1 score for each signal
for(const s of signals){
  const z = s.features.map((v,f)=>(v-means[f])/stds[f]);
  s.pc1 = z.reduce((sum,v,f)=>sum+v*pcs[0].vec[f],0);
  s.pc2 = z.reduce((sum,v,f)=>sum+v*pcs[1].vec[f],0);
  s.pc3 = pcs.length>2?z.reduce((sum,v,f)=>sum+v*pcs[2].vec[f],0):0;
  // Combined PCA score (weighted by eigenvalue)
  s.pcaScore = s.pc1*pcs[0].eigenvalue + s.pc2*pcs[1].eigenvalue + (pcs.length>2?s.pc3*pcs[2].eigenvalue:0);
}

// Test PC1 as predictor
console.log('  PC1 Quartile │ Count │ WinRate │ Avg MFE │ Note');
console.log('  ─────────────┼───────┼─────────┼─────────┼─────');
const sorted1 = [...signals].sort((a,b)=>a.pc1-b.pc1);
const q = Math.floor(N/4);
for(let i=0;i<4;i++){
  const grp = sorted1.slice(i*q,(i+1)*q);
  const wr = grp.filter(s=>s.win).length/grp.length*100;
  const mfe = grp.reduce((s,v)=>s+v.mfe,0)/grp.length;
  console.log(`  Q${i+1} (${i===0?'lowest':''}${i===3?'highest':''}${i===1||i===2?'mid':''}${' '.repeat(4)}) │ ${String(grp.length).padStart(5)} │ ${wr.toFixed(1).padStart(6)}% │ ${('+'+mfe.toFixed(1)+'%').padStart(7)} │ ${wr>50?'★':''}`);
}

// Test PCA composite score
console.log('\n  PCA Score Quartile │ Count │ WinRate │ Avg MFE │ Note');
console.log('  ──────────────────┼───────┼─────────┼─────────┼─────');
const sortedPCA = [...signals].sort((a,b)=>a.pcaScore-b.pcaScore);
for(let i=0;i<4;i++){
  const grp = sortedPCA.slice(i*q,(i+1)*q);
  const wr = grp.filter(s=>s.win).length/grp.length*100;
  const mfe = grp.reduce((s,v)=>s+v.mfe,0)/grp.length;
  console.log(`  Q${i+1} (${i===0?'lowest':''}${i===3?'highest':''}${i===1||i===2?'mid':''}${' '.repeat(7)}) │ ${String(grp.length).padStart(5)} │ ${wr.toFixed(1).padStart(6)}% │ ${('+'+mfe.toFixed(1)+'%').padStart(7)} │ ${wr>50?'★':''}`);
}

// ═══ STEP 6: Optimal PCA threshold ═══
console.log('\n═══ STEP 5: OPTIMAL PCA SCORE THRESHOLD ═══\n');
console.log('  Threshold       │ Signals │ WinRate │ Avg MFE │ ΔWR vs base');
console.log('  ────────────────┼─────────┼─────────┼─────────┼───────────');
const baseWR = signals.filter(s=>s.win).length/N*100;
const pcaSorted = [...signals].sort((a,b)=>b.pcaScore-a.pcaScore);
for(const pctl of [10,20,25,30,40,50,60,70,75,80,90]){
  const cutoff = Math.floor(N*pctl/100);
  const grp = pcaSorted.slice(0,cutoff);
  if(grp.length<10)continue;
  const wr = grp.filter(s=>s.win).length/grp.length*100;
  const mfe = grp.reduce((s,v)=>s+v.mfe,0)/grp.length;
  const delta = wr-baseWR;
  console.log(`  Top ${String(pctl).padStart(2)}%          │ ${String(grp.length).padStart(7)} │ ${wr.toFixed(1).padStart(6)}% │ ${('+'+mfe.toFixed(1)+'%').padStart(7)} │ ${(delta>=0?'+':'')+delta.toFixed(1)}%${delta>10?' ★★★':delta>5?' ★★':delta>2?' ★':''}`);
}

// ═══ STEP 7: Feature redundancy ═══
console.log('\n═══ STEP 6: FEATURE REDUNDANCY — Which params measure the SAME thing? ═══\n');
console.log('  Feature pair              │ Correlation │ Redundancy');
console.log('  ──────────────────────────┼─────────────┼──────────');
const pairs = [];
for(let i=0;i<P;i++){for(let j=i+1;j<P;j++){
  let sxy=0,sx=0,sy=0,sx2=0,sy2=0;
  for(let k=0;k<N;k++){
    const x=signals[k].features[i],y=signals[k].features[j];
    sxy+=x*y;sx+=x;sy+=y;sx2+=x*x;sy2+=y*y;
  }
  const corr=(N*sxy-sx*sy)/Math.sqrt((N*sx2-sx*sx)*(N*sy2-sy*sy)||1);
  pairs.push({a:FEATURES[i],b:FEATURES[j],corr});
}}
pairs.sort((a,b)=>Math.abs(b.corr)-Math.abs(a.corr));
for(const p of pairs.slice(0,15)){
  const red = Math.abs(p.corr)>0.7?'HIGH — merge these':Math.abs(p.corr)>0.5?'MODERATE':'Low';
  console.log(`  ${(p.a+' × '+p.b).padEnd(26)} │ ${(p.corr>=0?'+':'')+p.corr.toFixed(3).padStart(11)} │ ${red}`);
}

// ═══ STEP 8: Build PCA Super-Score ═══
console.log('\n═══ STEP 7: PCA SUPER-SCORE — Combined factor for implementation ═══\n');

// Build a simple weighted score using the top correlated features
const topFeatures = featureCorr.slice(0,6);
console.log('  PCA Super-Score formula (top 6 correlated features):');
console.log('  Score = ');
for(const f of topFeatures){
  const weight = f.corr * 10;
  console.log(`    ${weight>=0?'+':''}${weight.toFixed(2)} × standardized(${f.name})`);
}

// Compute super-score for each signal
for(const s of signals){
  s.superScore = topFeatures.reduce((sum,f)=>{
    const z = (s.features[f.f]-means[f.f])/stds[f.f];
    return sum + f.corr*10*z;
  },0);
}

// Test super-score
console.log('\n  Super-Score Quartile │ Count │ WinRate │ Avg MFE │ Note');
console.log('  ────────────────────┼───────┼─────────┼─────────┼─────');
const sortedSuper = [...signals].sort((a,b)=>b.superScore-a.superScore);
for(let i=0;i<4;i++){
  const grp = sortedSuper.slice(i*q,(i+1)*q);
  const wr = grp.filter(s=>s.win).length/grp.length*100;
  const mfe = grp.reduce((s,v)=>s+v.mfe,0)/grp.length;
  console.log(`  Q${i+1} (${i===0?'highest':''}${i===3?'lowest':''}${i===1||i===2?'mid':''}${' '.repeat(5)}) │ ${String(grp.length).padStart(5)} │ ${wr.toFixed(1).padStart(6)}% │ ${('+'+mfe.toFixed(1)+'%').padStart(7)} │ ${wr>50?'★':''}`);
}

// Best threshold
console.log('\n  Super-Score threshold │ Signals │ WinRate │ Avg MFE │ ΔWR');
console.log('  ─────────────────────┼─────────┼─────────┼─────────┼─────');
for(const pctl of [10,20,25,30,40,50]){
  const cutoff = Math.floor(N*pctl/100);
  const grp = sortedSuper.slice(0,cutoff);
  if(grp.length<10)continue;
  const wr = grp.filter(s=>s.win).length/grp.length*100;
  const mfe = grp.reduce((s,v)=>s+v.mfe,0)/grp.length;
  console.log(`  Top ${String(pctl).padStart(2)}%              │ ${String(grp.length).padStart(7)} │ ${wr.toFixed(1).padStart(6)}% │ ${('+'+mfe.toFixed(1)+'%').padStart(7)} │ ${((wr-baseWR)>=0?'+':'')+(wr-baseWR).toFixed(1)}%`);
}

console.log('\n'+'█'.repeat(90));
console.log('  PCA ANALYSIS COMPLETE');
console.log('█'.repeat(90));
console.log(`
  KEY FINDINGS:
  1. Top PCA components and what they mean
  2. Which features are REDUNDANT (measuring same thing)
  3. PCA score as a predictor — does it beat individual thresholds?
  4. Super-Score for potential implementation
`);
