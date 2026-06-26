// Wilson LB Maximizer — with Cascading Gates protection, we can safely expand trade volume
// Tests param relaxations knowing the stop system catches bad trades
// Target: push WLB above 80% for all 4 param sets

const fs=require('fs'),path=require('path');
const DIR='C:/Users/drkkr/Downloads/Portfolio';
const files=fs.readdirSync(DIR).filter(f=>f.endsWith('.csv')&&!f.includes('(1)'));

function parseCSV(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const[date,o,h,lo,cl,v]=l[i].split(',');const[d,m,y]=date.split('-');const M={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,M[m],+d).getTime()/1000,o:+o,h:+h,l:+lo,c:+cl,v:+v,date});}return c;}
function atr14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}
function rsi2c(c){const r=new Array(c.length).fill(50);if(c.length<4)return r;let g=0,l=0;for(let i=1;i<=2;i++){const ch=c[i].c-c[i-1].c;if(ch>0)g+=ch;else l+=Math.abs(ch);}g/=2;l/=2;for(let i=3;i<c.length;i++){const ch=c[i].c-c[i-1].c;g=(g+Math.max(ch,0))/2;l=(l+Math.max(-ch,0))/2;r[i]=l<1e-4?100:100-100/(1+g/l);}return r;}
function pR(w,v){return w.length===0?50:(w.filter(x=>x<v).length/w.length)*100;}
function upsC(cl,uw,bp,vp,zt,zl){let s=0;if(cl>=80)s+=20;else if(cl>=65)s+=12;if(uw<=20)s+=20;else if(uw<=35)s+=12;if(bp>=55)s+=15;else if(bp>=35)s+=9;if(vp>=4)s+=20;else if(vp>=2)s+=12;if(zt<=5)s+=15;else if(zt<=15)s+=9;if(zl>=12)s+=10;else if(zl>=6)s+=6;return s;}
function cqsC(cl,uw,bp,vp,ve){let s=0;if(cl>=65)s++;if(uw<=30)s++;if(bp>=40)s++;if(vp>=2.5)s++;if(ve>=1.5)s++;return s;}
function wilson(n,h){if(n<2)return 0;const p=h/n,z=1.96;return(p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/(1+z*z/n)*100;}

// Pre-compute all signals
const ALL=[];
for(const file of files){
  const c=parseCSV(path.join(DIR,file));if(c.length<60)continue;
  const sym=file.replace('_NS_OHLCV.csv',''),a=atr14(c),r2=rsi2c(c);
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
    let bZ=null;for(let zL=25;zL>=4;zL--){const zS=i-zL;if(zS<1)continue;let zH=-Infinity,zLo=Infinity,ok=true;for(let j=zS;j<i;j++){zH=Math.max(zH,c[j].h);zLo=Math.min(zLo,c[j].l);if((c[j].h-c[j].l)/(a[j]||1)>1.0)ok=false;}if(!ok)continue;bZ={zH,zL:zLo,len:zL,zt:zLo>0?((zH-zLo)/zLo)*100:99};break;}
    if(!bZ||s.c<=bZ.zH*1.001)continue;
    const caz=bZ.zH>0?((s.c-bZ.zH)/bZ.zH)*100:0;
    const uV=upsC(cl,uw,bp,vP,bZ.zt,bZ.len);const cV=cqsC(cl,uw,bp,vP,vE);
    let mfe=0;for(let d=i+1;d<=Math.min(i+10,c.length-1);d++){const pH=(c[d].h-s.c)/s.c*100;if(pH>mfe)mfe=pH;}
    const h5=mfe>=5;
    ALL.push({sym,to,apctl,p10A,p10E,zLen:bZ.len,zt:bZ.zt,p10V,p5V,rvb,ra,vR,vP,cl,uw,bp,sr,uV,cV,rsi2:r2[i],vE,caz,mfe,h5});
  }
}
console.log(`Total breakouts: ${ALL.length} | Winners: ${ALL.filter(s=>s.h5).length}\n`);

function filt(sigs,p){return sigs.filter(s=>{
  if(s.to<p.minTO)return false;if(s.apctl>p.maxAP)return false;if(s.p10A>p.maxPRR)return false;
  if(s.p10E>p.maxEC)return false;if(s.zLen<p.minZL||s.zLen>p.maxZL)return false;
  if(s.zt>p.maxZT)return false;if(s.p10V>p.maxPV)return false;if(s.p5V>p.maxP5V)return false;
  if(s.rvb>p.maxRVB)return false;if(s.ra<p.minRA||s.ra>p.maxRA)return false;
  if(s.vR<p.minVR)return false;if(s.vP<p.minVP5)return false;if(s.cl<p.minCL)return false;
  if(s.uw>p.maxUW)return false;if(s.bp<p.minBP)return false;if(s.sr>p.maxSR)return false;
  if(s.uV<p.minUPS)return false;if(s.rsi2<p.minRSI)return false;
  if(p.minVE!==null&&s.vE<p.minVE)return false;if(p.minCQS!==null&&s.cV<p.minCQS)return false;
  if(p.maxCAZ!==null&&s.caz>p.maxCAZ)return false;return true;});}

// Current v5-WLB params
const CURRENT={
  D20:{name:'D20+',minTO:1e7,maxAP:85,maxPRR:1.0,maxEC:1,minZL:6,maxZL:20,maxZT:15,maxPV:0.9,maxP5V:0.95,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:60,minRSI:50,minVE:1.75,minCQS:3,maxCAZ:null},
  HP15:{name:'HP15+',minTO:1e7,maxAP:85,maxPRR:1.0,maxEC:1,minZL:6,maxZL:25,maxZT:15,maxPV:0.85,maxP5V:1.1,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:13,minUPS:50,minRSI:50,minVE:null,minCQS:null,maxCAZ:6},
  E10:{name:'E10+',minTO:2e7,maxAP:60,maxPRR:0.95,maxEC:5,minZL:8,maxZL:15,maxZT:15,maxPV:0.9,maxP5V:1.0,maxRVB:2.0,minRA:1,maxRA:6,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:45,minRSI:50,minVE:1.25,minCQS:3,maxCAZ:null},
  US8:{name:'US8+',minTO:1e7,maxAP:95,maxPRR:1.0,maxEC:1,minZL:6,maxZL:15,maxZT:15,maxPV:0.9,maxP5V:0.95,maxRVB:2.0,minRA:1,maxRA:6,minVR:1.2,minVP5:2.0,minCL:65,maxUW:40,minBP:25,maxSR:8.5,minUPS:45,minRSI:55,minVE:1.5,minCQS:null,maxCAZ:null},
};

// Show current WLB
console.log('═'.repeat(80));
console.log('  CURRENT v5-WLB: Wilson Lower Bounds');
console.log('═'.repeat(80));
for(const[k,p]of Object.entries(CURRENT)){
  const t=filt(ALL,p);const h=t.filter(s=>s.h5).length;
  console.log(`  ${p.name.padEnd(8)}: ${t.length} trades, ${h} hits (${(h/t.length*100).toFixed(1)}%), WLB = ${wilson(t.length,h).toFixed(1)}%`);
}

// What WLB is theoretically possible at different trade counts?
console.log('\n  ═══ THEORETICAL WLB TABLE ═══');
console.log('  Trades │ 85% rate │ 88% rate │ 90% rate │ 92% rate │ 95% rate │ 100% rate');
console.log('  ───────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────');
for(const n of [10,15,20,25,30,35,40,50,60,80,100]){
  const vals=[0.85,0.88,0.90,0.92,0.95,1.0].map(r=>wilson(n,Math.round(n*r)).toFixed(1)+'%');
  console.log(`  ${String(n).padStart(6)} │ ${vals.map(v=>v.padStart(8)).join(' │ ')}`);
}

// For each param set, grid search to maximize WLB
console.log('\n' + '█'.repeat(80));
console.log('  WILSON LB MAXIMIZER — Grid search with Cascading Gates protection');
console.log('█'.repeat(80));

const GRIDS={
  D20:{maxPRR:[0.85,0.95,1.0,1.1,1.2],maxEC:[0,1,2,3],maxZT:[12,15,18,20],maxRVB:[1.5,2.0,2.5,3.0],maxPV:[0.85,0.9,0.95,1.0],maxP5V:[0.9,0.95,1.0,1.1],minVP5:[1.5,1.75,2.0],minCL:[60,65,70],minBP:[25,30,35],maxSR:[8.5,10,12],minUPS:[45,50,55,60],minVE:[1.0,1.25,1.5,1.75,null],minCQS:[1,2,3,null],minRSI:[40,45,50],maxAP:[80,85,90,95]},
  HP15:{maxPRR:[0.85,0.95,1.0,1.1],maxEC:[0,1,2,3],maxRVB:[1.5,2.0,2.5],maxPV:[0.8,0.85,0.9,0.95],minVP5:[1.5,1.75,2.0],minBP:[25,30,35],maxSR:[10,11,13],minUPS:[40,45,50],maxCAZ:[5,6,8,10,null],minVR:[0.8,1.0,1.1]},
  E10:{minTO:[1e7,1.5e7,2e7],maxAP:[50,60,70,80],maxPRR:[0.85,0.95,1.0,1.1],maxEC:[3,4,5],minZL:[6,7,8],maxZL:[12,15,18,20],maxZT:[12,15,18,20],maxPV:[0.85,0.9,0.95,1.0],maxP5V:[0.9,0.95,1.0,1.1],minVP5:[1.5,1.75,2.0],minVE:[1.0,1.1,1.25,null],minCQS:[1,2,3,null],minUPS:[35,40,45]},
  US8:{maxAP:[70,80,85,95],maxPRR:[0.85,0.95,1.0,1.1],maxEC:[0,1,2,3],maxZL:[12,15,18,20],maxZT:[10,12,15,18],maxRVB:[1.5,2.0,2.5],maxPV:[0.85,0.9,0.95],maxP5V:[0.9,0.95,1.0,1.1],minVP5:[1.5,1.75,2.0],minCL:[60,65],minBP:[20,25,30],minUPS:[35,40,45],minRSI:[40,45,50,55],minVE:[1.0,1.25,1.5,null]},
};

for(const[key,baseP]of Object.entries(CURRENT)){
  const grid=GRIDS[key];if(!grid)continue;
  const paramKeys=Object.keys(grid);
  const baseT=filt(ALL,baseP);const baseH=baseT.filter(s=>s.h5).length;
  const baseWLB=wilson(baseT.length,baseH);

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  ${baseP.name}: current ${baseT.length} trades, ${baseH} hits, WLB ${baseWLB.toFixed(1)}%`);

  // Hill-climb + random perturbation targeting WLB
  let best={...baseP},bestWLB=baseWLB;
  // Hill climb
  for(let pass=0;pass<15;pass++){
    let improved=false;
    for(const pk of paramKeys){
      for(const val of grid[pk]){
        const test={...best,[pk]:val};const t=filt(ALL,test);const h=t.filter(s=>s.h5).length;
        if(t.length<3)continue;
        const rate=h/t.length;if(rate<0.80)continue; // hard floor 80%
        const w=wilson(t.length,h);
        if(w>bestWLB){bestWLB=w;best={...best,[pk]:val};improved=true;}
      }
    }
    if(!improved)break;
  }
  // Random perturbation
  for(let iter=0;iter<30000;iter++){
    const test={...best};const n=2+Math.floor(Math.random()*3);
    for(let p=0;p<n;p++){const pk=paramKeys[Math.floor(Math.random()*paramKeys.length)];const vals=grid[pk];test[pk]=vals[Math.floor(Math.random()*vals.length)];}
    const t=filt(ALL,test);const h=t.filter(s=>s.h5).length;
    if(t.length<3||h/t.length<0.80)continue;
    const w=wilson(t.length,h);if(w>bestWLB){bestWLB=w;Object.assign(best,test);}
  }
  // Pairwise fine-tune
  for(let a=0;a<Math.min(8,paramKeys.length);a++){
    for(let b=a+1;b<Math.min(8,paramKeys.length);b++){
      for(const va of grid[paramKeys[a]]){for(const vb of grid[paramKeys[b]]){
        const test={...best,[paramKeys[a]]:va,[paramKeys[b]]:vb};
        const t=filt(ALL,test);const h=t.filter(s=>s.h5).length;
        if(t.length<3||h/t.length<0.80)continue;
        const w=wilson(t.length,h);if(w>bestWLB){bestWLB=w;best=test;}}}}}

  const finalT=filt(ALL,best);const finalH=finalT.filter(s=>s.h5).length;
  const finalRate=finalH/finalT.length*100;

  console.log(`  OPTIMIZED: ${finalT.length} trades, ${finalH} hits (${finalRate.toFixed(1)}%), WLB ${bestWLB.toFixed(1)}%`);
  console.log(`  WLB improvement: ${baseWLB.toFixed(1)}% → ${bestWLB.toFixed(1)}% (+${(bestWLB-baseWLB).toFixed(1)}%)`);

  // Show changes
  const changes=[];
  for(const pk of paramKeys){if(best[pk]!==baseP[pk])changes.push(`${pk}: ${baseP[pk]}→${best[pk]}`);}
  if(changes.length>0)console.log(`  Changes: ${changes.join(', ')}`);
  else console.log('  No changes — already optimal');
}

// What if we merge all param sets into ONE universal set?
console.log('\n' + '█'.repeat(80));
console.log('  UNIVERSAL PARAM SET — One set to rule them all');
console.log('█'.repeat(80));
// Find the loosest params that still maintain ≥85% hit rate
const UNI_GRID={
  maxAP:[60,70,80,85,95,100],maxPRR:[0.85,0.95,1.0,1.1,1.2],maxEC:[0,1,2,3,5],
  minZL:[4,5,6,7,8],maxZL:[15,18,20,25],maxZT:[12,15,18,20,25],
  maxPV:[0.85,0.9,0.95,1.0],maxP5V:[0.9,0.95,1.0,1.1],maxRVB:[1.5,2.0,2.5,3.0],
  minRA:[0.8,1.0],maxRA:[5,6,7],minVR:[0.8,1.0,1.2],minVP5:[1.0,1.5,2.0],
  minCL:[55,60,65],maxUW:[35,40],minBP:[20,25,30,35],maxSR:[8.5,10,12],
  minUPS:[35,40,45,50],minRSI:[40,45,50],minVE:[1.0,1.25,1.5,null],minCQS:[1,2,3,null],
  minTO:[5e6,1e7],maxCAZ:[5,6,8,null]
};
let uBest={name:'UNI',minTO:1e7,maxAP:85,maxPRR:1.0,maxEC:1,minZL:6,maxZL:20,maxZT:15,maxPV:0.9,maxP5V:1.0,maxRVB:2.0,minRA:1,maxRA:5,minVR:1.0,minVP5:2.0,minCL:65,maxUW:35,minBP:35,maxSR:8.5,minUPS:50,minRSI:50,minVE:1.25,minCQS:2,maxCAZ:null};
let uBestWLB=0;
const uKeys=Object.keys(UNI_GRID);
// Hill-climb
for(let pass=0;pass<20;pass++){
  let improved=false;
  for(const pk of uKeys){
    for(const val of UNI_GRID[pk]){
      const test={...uBest,[pk]:val};const t=filt(ALL,test);const h=t.filter(s=>s.h5).length;
      if(t.length<5||h/t.length<0.82)continue;
      const w=wilson(t.length,h);if(w>uBestWLB){uBestWLB=w;uBest={...uBest,[pk]:val};improved=true;}
    }
  }
  if(!improved)break;
}
// Random
for(let iter=0;iter<50000;iter++){
  const test={...uBest};const n=2+Math.floor(Math.random()*4);
  for(let p=0;p<n;p++){const pk=uKeys[Math.floor(Math.random()*uKeys.length)];test[pk]=UNI_GRID[pk][Math.floor(Math.random()*UNI_GRID[pk].length)];}
  const t=filt(ALL,test);const h=t.filter(s=>s.h5).length;
  if(t.length<5||h/t.length<0.82)continue;
  const w=wilson(t.length,h);if(w>uBestWLB){uBestWLB=w;Object.assign(uBest,test);}
}
const uT=filt(ALL,uBest);const uH=uT.filter(s=>s.h5).length;
console.log(`\n  Universal set: ${uT.length} trades, ${uH} hits (${(uH/uT.length*100).toFixed(1)}%), WLB ${uBestWLB.toFixed(1)}%`);
console.log(`  Params:`);
for(const pk of uKeys)console.log(`    ${pk}: ${uBest[pk]}`);
