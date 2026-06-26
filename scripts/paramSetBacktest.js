// Deep Backtest of all 4 Param Sets on 29 OHLCV files
const fs = require('fs');
const path = require('path');
const DIR = 'C:/Users/drkkr/Downloads/Portfolio';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.csv') && !f.includes('(1)'));

function parseCSV(fp) {
  const lines = fs.readFileSync(fp,'utf8').trim().split('\n');
  const c=[];
  for(let i=1;i<lines.length;i++){const[date,o,h,l,cl,v]=lines[i].split(',');const[d,m,y]=date.split('-');const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};c.push({ts:new Date(+y,months[m],+d).getTime()/1000,o:+o,h:+h,l:+l,c:+cl,v:+v,date});}
  return c;
}

function computeATR14(candles) {
  const a=new Array(candles.length).fill(0);if(candles.length<15)return a;let s=0;
  for(let i=1;i<=14;i++)s+=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));
  a[14]=s/14;for(let i=15;i<candles.length;i++){const tr=Math.max(candles[i].h-candles[i].l,Math.abs(candles[i].h-candles[i-1].c),Math.abs(candles[i].l-candles[i-1].c));a[i]=(a[i-1]*13+tr)/14;}
  return a;
}

function computeRSI2(candles) {
  const rsi=new Array(candles.length).fill(50);if(candles.length<4)return rsi;
  let avgG=0,avgL=0;
  for(let i=1;i<=2;i++){const ch=candles[i].c-candles[i-1].c;if(ch>0)avgG+=ch;else avgL+=Math.abs(ch);}
  avgG/=2;avgL/=2;
  for(let i=3;i<candles.length;i++){const ch=candles[i].c-candles[i-1].c;const g=ch>0?ch:0;const l=ch<0?Math.abs(ch):0;avgG=(avgG*1+g)/2;avgL=(avgL*1+l)/2;rsi[i]=avgL<0.0001?100:100-100/(1+avgG/avgL);}
  return rsi;
}

function percentileRank(window,value){if(window.length===0)return 50;return(window.filter(v=>v<value).length/window.length)*100;}

const PARAM_SETS = {
  D20: {name:'Deployable 20+',minTurnover:1e7,maxATRPctl:85,maxPre10RangeATR:0.75,maxExpCount:2,minZoneLen:6,maxZoneLen:20,maxTightness:15,maxPre10Vol:0.90,maxPre5Vol:1.00,maxHighVolCount:4,hvMult:1.35,maxRedVolBias:1.10,minRangeATR:1.0,maxRangeATR:5.0,minVolR20:1.00,minVolPre5:2.00,minCloseLoc:65,maxWick:35,minBody:35,maxRisk:8.5,minUPS:60,minRSI2:50,minVolExp:1.50,minCQS:3,maxClAbvZone:null},
  HP15: {name:'HighPrecision 15+',minTurnover:1e7,maxATRPctl:85,maxPre10RangeATR:0.75,maxExpCount:0,minZoneLen:6,maxZoneLen:25,maxTightness:15,maxPre10Vol:0.90,maxPre5Vol:1.10,maxHighVolCount:4,hvMult:1.35,maxRedVolBias:1.10,minRangeATR:1.0,maxRangeATR:5.0,minVolR20:1.10,minVolPre5:2.00,minCloseLoc:65,maxWick:35,minBody:25,maxRisk:11.0,minUPS:45,minRSI2:50,minVolExp:null,minCQS:null,maxClAbvZone:8.0},
  E10: {name:'Elite 10+',minTurnover:2e7,maxATRPctl:60,maxPre10RangeATR:0.95,maxExpCount:4,minZoneLen:8,maxZoneLen:15,maxTightness:12,maxPre10Vol:0.85,maxPre5Vol:0.90,maxHighVolCount:2,hvMult:1.2,maxRedVolBias:1.20,minRangeATR:1.0,maxRangeATR:6.0,minVolR20:1.00,minVolPre5:3.00,minCloseLoc:65,maxWick:35,minBody:35,maxRisk:8.5,minUPS:45,minRSI2:50,minVolExp:1.10,minCQS:3,maxClAbvZone:null},
  US8: {name:'UltraSelective 8+',minTurnover:1e7,maxATRPctl:60,maxPre10RangeATR:0.75,maxExpCount:0,minZoneLen:6,maxZoneLen:15,maxTightness:8,maxPre10Vol:0.85,maxPre5Vol:1.10,maxHighVolCount:4,hvMult:1.5,maxRedVolBias:1.10,minRangeATR:1.0,maxRangeATR:6.0,minVolR20:1.20,minVolPre5:2.00,minCloseLoc:65,maxWick:40,minBody:25,maxRisk:8.5,minUPS:45,minRSI2:55,minVolExp:1.50,minCQS:null,maxClAbvZone:null},
};

function computeUPS(closeLoc,uwPct,bodyPct,volVsPre5,tightness,zoneLen){
  let s=0;if(closeLoc>=80)s+=20;else if(closeLoc>=65)s+=12;if(uwPct<=20)s+=20;else if(uwPct<=35)s+=12;
  if(bodyPct>=55)s+=15;else if(bodyPct>=35)s+=9;if(volVsPre5>=4)s+=20;else if(volVsPre5>=2)s+=12;
  if(tightness<=5)s+=15;else if(tightness<=15)s+=9;if(zoneLen>=12)s+=10;else if(zoneLen>=6)s+=6;return s;
}
function computeCQS(closeLoc,uwPct,bodyPct,volVsPre5,volExp){
  let s=0;if(closeLoc>=65)s++;if(uwPct<=30)s++;if(bodyPct>=40)s++;if(volVsPre5>=2.5)s++;if(volExp>=1.5)s++;return s;
}

const results = {};
for (const key of Object.keys(PARAM_SETS)) results[key] = {signals:0,hits5:0,hits3:0,stopped:0,totalMfe:0,totalMae:0,totalDays:0,symbols:new Set(),trades:[]};

for (const file of files) {
  const candles = parseCSV(path.join(DIR, file));
  if (candles.length < 60) continue;
  const sym = file.replace('_NS_OHLCV.csv','');
  const atr = computeATR14(candles);
  const rsi2 = computeRSI2(candles);

  for (let i = 40; i < candles.length - 11; i++) {
    const sig = candles[i];
    if (sig.c <= 0 || atr[i] <= 0) continue;
    const r = sig.h - sig.l; if (r <= 0) continue;

    // Compute all features
    const atrPct = (atr[i]/sig.c)*100;
    const w120=[];for(let j=Math.max(14,i-121);j<i;j++){if(candles[j].c>0&&atr[j]>0)w120.push((atr[j]/candles[j].c)*100);}
    const atrPctl=percentileRank(w120,atrPct);
    const rangeATR=r/atr[i], closeLoc=(sig.c-sig.l)/r*100, bodyPct=Math.abs(sig.c-sig.o)/r*100;
    const uwPct=(sig.h-Math.max(sig.o,sig.c))/r*100, sigRangePct=(r/sig.c)*100;

    // Turnover
    let turnSum=0;for(let j=Math.max(0,i-20);j<i;j++)turnSum+=candles[j].c*candles[j].v;
    const avgTurnover=turnSum/Math.max(i-Math.max(0,i-20),1);

    // Pre-10 features
    let pre10RSum=0,pre10Cnt=0,pre10ExpCount=0;
    for(let j=i-10;j<i;j++){if(j<1)continue;const tr=Math.max(candles[j].h-candles[j].l,Math.abs(candles[j].h-candles[j-1].c),Math.abs(candles[j].l-candles[j-1].c));const ra=tr/atr[j];pre10RSum+=ra;pre10Cnt++;if(ra>1.1)pre10ExpCount++;}
    const pre10AvgRangeATR=pre10Cnt>0?pre10RSum/pre10Cnt:1;
    const volExpRatio=pre10AvgRangeATR>0?rangeATR/pre10AvgRangeATR:1;

    // Volume
    let v20Sum=0;for(let j=Math.max(0,i-20);j<i;j++)v20Sum+=candles[j].v;const volAvg20=v20Sum/Math.max(i-Math.max(0,i-20),1);
    const volRatio20=volAvg20>0?sig.v/volAvg20:0;
    let v5Sum=0;for(let j=Math.max(0,i-5);j<i;j++)v5Sum+=candles[j].v;const volAvg5=v5Sum/Math.max(i-Math.max(0,i-5),1);
    const volVsPre5=volAvg5>0?sig.v/volAvg5:0;
    let pre10VolRSum=0,pre10VolCnt=0;for(let j=i-10;j<i;j++){if(j<0)continue;pre10VolRSum+=(volAvg20>0?candles[j].v/volAvg20:0);pre10VolCnt++;}
    const pre10AvgVolRatio=pre10VolCnt>0?pre10VolRSum/pre10VolCnt:1;
    let pre5VolRSum=0,pre5VolCnt=0;for(let j=i-5;j<i;j++){if(j<0)continue;pre5VolRSum+=(volAvg20>0?candles[j].v/volAvg20:0);pre5VolCnt++;}
    const pre5AvgVolRatio=pre5VolCnt>0?pre5VolRSum/pre5VolCnt:1;
    let hvCount=0;for(let j=i-10;j<i;j++){if(j<0)continue;if(volAvg20>0&&candles[j].v/volAvg20>1.35)hvCount++;}
    let redVol=0,greenVol=0;for(let j=i-10;j<i;j++){if(j<0)continue;if(candles[j].c<candles[j].o)redVol+=candles[j].v;else greenVol+=candles[j].v;}
    const redVolBias=greenVol>0?redVol/greenVol:(redVol>0?10:1);

    // Zone detection
    let bestZone=null;
    for(let zLen=20;zLen>=6;zLen--){
      const zS=i-zLen;if(zS<1)continue;
      let zH=-Infinity,zL=Infinity,allCompressed=true;
      for(let j=zS;j<i;j++){zH=Math.max(zH,candles[j].h);zL=Math.min(zL,candles[j].l);const jr=(candles[j].h-candles[j].l)/(atr[j]||1);if(jr>1.0)allCompressed=false;}
      if(!allCompressed)continue;
      const zt=zL>0?((zH-zL)/zL)*100:99;
      bestZone={zH,zL,len:zLen,tightness:zt};break;
    }
    if(!bestZone)continue;
    if(sig.c<=bestZone.zH*1.001)continue; // must break out
    const closeAbvZonePct=bestZone.zH>0?((sig.c-bestZone.zH)/bestZone.zH)*100:0;

    const ups=computeUPS(closeLoc,uwPct,bodyPct,volVsPre5,bestZone.tightness,bestZone.len);
    const cqs=computeCQS(closeLoc,uwPct,bodyPct,volVsPre5,volExpRatio);
    const rsi2val=rsi2[i];

    // Future MFE/MAE
    let mfe=0,mae=0,hit5=false,hit3=false,daysTo5=99;
    for(let d=i+1;d<=Math.min(i+10,candles.length-1);d++){
      const pct=(candles[d].h-sig.c)/sig.c*100;const drop=(candles[d].l-sig.c)/sig.c*100;
      if(pct>mfe)mfe=pct;if(drop<mae)mae=drop;
      if(!hit5&&pct>=5){hit5=true;daysTo5=d-i;}if(!hit3&&pct>=3)hit3=true;
    }

    // Test each param set
    for(const[key,p]of Object.entries(PARAM_SETS)){
      let pass=true;
      if(avgTurnover<p.minTurnover)pass=false;
      if(atrPctl>p.maxATRPctl)pass=false;
      if(pre10AvgRangeATR>p.maxPre10RangeATR)pass=false;
      if(pre10ExpCount>p.maxExpCount)pass=false;
      if(bestZone.len<p.minZoneLen||bestZone.len>p.maxZoneLen)pass=false;
      if(bestZone.tightness>p.maxTightness)pass=false;
      if(pre10AvgVolRatio>p.maxPre10Vol)pass=false;
      if(pre5AvgVolRatio>p.maxPre5Vol)pass=false;
      if(redVolBias>p.maxRedVolBias)pass=false;
      if(rangeATR<p.minRangeATR||rangeATR>p.maxRangeATR)pass=false;
      if(volRatio20<p.minVolR20)pass=false;
      if(volVsPre5<p.minVolPre5)pass=false;
      if(closeLoc<p.minCloseLoc)pass=false;
      if(uwPct>p.maxWick)pass=false;
      if(bodyPct<p.minBody)pass=false;
      if(sigRangePct>p.maxRisk)pass=false;
      if(ups<p.minUPS)pass=false;
      if(rsi2val<p.minRSI2)pass=false;
      if(p.minVolExp!==null&&volExpRatio<p.minVolExp)pass=false;
      if(p.minCQS!==null&&cqs<p.minCQS)pass=false;
      if(p.maxClAbvZone!==null&&closeAbvZonePct>p.maxClAbvZone)pass=false;

      if(pass){
        results[key].signals++;results[key].totalMfe+=mfe;results[key].totalMae+=mae;
        if(hit5){results[key].hits5++;results[key].totalDays+=daysTo5;}
        if(hit3)results[key].hits3++;
        results[key].symbols.add(sym);
        results[key].trades.push({sym,date:candles[i].date,mfe,mae,hit5,daysTo5});
      }
    }
  }
}

console.log('═══════════════════════════════════════════════════════════════════');
console.log('  4 PARAM SET BACKTEST ON 29 OHLCV FILES (Dr KKR Quant Terminal)');
console.log('═══════════════════════════════════════════════════════════════════\n');

console.log('Param Set          | Signals | +5%Hit | +5%Rate | +3%Rate | AvgMFE  | AvgMAE  | AvgDays5 | Symbols');
console.log('-------------------|---------|--------|---------|---------|---------|---------|----------|--------');
for(const[key,r]of Object.entries(results)){
  const p=PARAM_SETS[key];
  const rate5=r.signals>0?(r.hits5/r.signals*100).toFixed(1):'0';
  const rate3=r.signals>0?(r.hits3/r.signals*100).toFixed(1):'0';
  const avgMfe=r.signals>0?(r.totalMfe/r.signals).toFixed(1):'0';
  const avgMae=r.signals>0?(r.totalMae/r.signals).toFixed(1):'0';
  const avgDays=r.hits5>0?(r.totalDays/r.hits5).toFixed(1):'—';
  console.log(`${p.name.padEnd(18)} | ${String(r.signals).padStart(7)} | ${String(r.hits5).padStart(6)} | ${rate5.padStart(6)}% | ${rate3.padStart(6)}% | ${avgMfe.padStart(6)}% | ${avgMae.padStart(6)}% | ${avgDays.padStart(8)} | ${r.symbols.size}`);
}

// Individual trades per param set
for(const[key,r]of Object.entries(results)){
  if(r.trades.length===0)continue;
  console.log(`\n═══ ${PARAM_SETS[key].name} — ${r.trades.length} trades ═══`);
  console.log('Symbol       | Date       | +5%Hit | MFE    | MAE    | Days5');
  for(const t of r.trades.slice(0,30)){
    console.log(`${t.sym.padEnd(12)} | ${(t.date||'—').padEnd(10)} | ${t.hit5?'YES':'NO '.padStart(6)} | ${t.mfe.toFixed(1).padStart(5)}% | ${t.mae.toFixed(1).padStart(5)}% | ${t.hit5?String(t.daysTo5).padStart(5):'  —'}`);
  }
  if(r.trades.length>30)console.log(`  ... and ${r.trades.length-30} more trades`);
}
