// THOROUGH BACKTEST — Zone, ATR, Vol badges on ALL 78 OHLCV files
// Tests each badge tier against forward 10-day returns
// Goal: Validate current thresholds and re-stratify if needed

const fs = require('fs'), path = require('path');
const DIRS = [
  { dir: 'C:/Users/drkkr/Downloads/My Portfolio', format: 'yahoo' },
  { dir: 'C:/Users/drkkr/Downloads/NIFTY 50', format: 'nse' },
];
function pY(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<6||isNaN(+p[4])||+p[4]<=0)continue;c.push({o:+p[1],h:+p[2],l:+p[3],c:+p[4],v:+p[5]});}return c;}
function pN(fp){const l=fs.readFileSync(fp,'utf8').trim().split('\n');const c=[];for(let i=1;i<l.length;i++){const p=l[i].split(',');if(p.length<11||isNaN(+p[8])||+p[8]<=0)continue;c.push({o:+p[4],h:+p[5],l:+p[6],c:+p[8],v:+p[10]||0});}return c;}
function a14(c){const a=new Array(c.length).fill(0);if(c.length<15)return a;let s=0;for(let i=1;i<=14;i++)s+=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[14]=s/14;for(let i=15;i<c.length;i++){const t=Math.max(c[i].h-c[i].l,Math.abs(c[i].h-c[i-1].c),Math.abs(c[i].l-c[i-1].c));a[i]=(a[i-1]*13+t)/14;}return a;}

function atrPctl120(c,atr,idx){if(idx<120)return 50;const cur=c[idx].c>0?atr[idx]/c[idx].c*100:0;let below=0;for(let j=idx-120;j<idx;j++){const v=c[j].c>0?atr[j]/c[j].c*100:0;if(v<cur)below++;}return below/120*100;}

const SD=[];
for(const{dir,format}of DIRS){if(!fs.existsSync(dir))continue;for(const f of fs.readdirSync(dir)){if(!f.endsWith('.csv')||f.includes('ALL_SYMBOLS'))continue;const c=format==='nse'?pN(path.join(dir,f)):pY(path.join(dir,f));if(c.length<150)continue;SD.push({sym:f.replace('_NS_OHLCV.csv','').replace('.csv',''),c,atr:a14(c)});}}
console.log('Stocks: ' + SD.length);

// Collect ALL breakout signals with their Zone/ATR/Vol states
const signals = [];
for (const {sym, c, atr} of SD) {
  const n = c.length;
  for (let i = 130; i < n - 11; i++) {
    if (atr[i] <= 0 || c[i].c <= 0) continue;
    const s = c[i], rng = s.h - s.l; if (rng <= 0) continue;
    const eRA = rng / atr[i];
    const cL = (s.c - s.l) / rng * 100;
    const uW = (s.h - Math.max(s.c, s.o)) / rng * 100;
    const bP = Math.abs(s.c - s.o) / rng * 100;
    const sigR = rng / s.c * 100;
    const atrPct = atr[i] / s.c * 100;
    const pctl = atrPctl120(c, atr, i);

    let v20 = 0; for (let j = i-20; j < i; j++) v20 += c[j].v; v20 /= 20;
    let v5 = 0; for (let j = i-5; j < i; j++) v5 += c[j].v; v5 /= 5;
    const eVR = v20 > 0 ? s.v / v20 : 0;
    const eVP = v5 > 0 ? s.v / v5 : 0;
    let p10R = 0, p10V = 0, p10RB = 0;
    for (let j = i-10; j < i; j++) { if (j<1) continue; p10R += (c[j].h-c[j].l)/(atr[j]||1); const vr = v20>0?c[j].v/v20:0; p10V += vr; if (c[j].c < c[j].o) p10RB += vr; }
    p10R /= 10; p10V /= 10; p10RB /= 10;
    const volExpR = p10R > 0 ? eRA / p10R : 0;
    const isGreen = s.c > s.o;

    // Zone detection (simplified — find any valid zone)
    let zone = null;
    for (let zL = 25; zL >= 4; zL--) {
      const zS = i - zL; if (zS < 1) continue;
      let zH = -Infinity, zLo = Infinity, ok = true;
      for (let j = zS; j < i; j++) { zH = Math.max(zH, c[j].h); zLo = Math.min(zLo, c[j].l); if ((c[j].h - c[j].l) / (atr[j]||1) > 1.0) ok = false; }
      if (!ok) continue;
      const t = zLo > 0 ? (zH - zLo) / zLo * 100 : 999;
      if (t > 20) continue;
      // Descending rejection
      const mid = Math.floor(zL/2); let fhH=-Infinity,shH=-Infinity,fhL=Infinity,shL=Infinity;
      for(let j=zS;j<zS+mid;j++){fhH=Math.max(fhH,c[j].h);fhL=Math.min(fhL,c[j].l);}
      for(let j=zS+mid;j<i;j++){shH=Math.max(shH,c[j].h);shL=Math.min(shL,c[j].l);}
      if(shH<fhH*0.995&&shL<=fhL*1.005) continue;
      zone = { zH, zL: zLo, len: zL, t }; break;
    }
    const hasBreakout = zone && s.c > zone.zH * 1.001;
    const cazp = zone && zone.zH > 0 ? (s.c - zone.zH) / zone.zH * 100 : 0;

    // ATR State
    let atrState;
    if (pctl < 20) atrState = 'SLEEP';
    else if (pctl < 40) atrState = 'BUILD';
    else if (pctl <= 60) atrState = 'INFLECT';
    else atrState = 'MOMEN';

    // ATR Explosion
    const atrExplosion = pctl >= 40 && pctl <= 95 && eRA >= 2.0 && eRA <= 5.0
      && volExpR >= 1.5 && atrPct >= 4 && atrPct <= 8
      && eVR >= 1.8 && eVP >= 2.25 && p10RB <= 0.9
      && cL >= 60 && bP >= 30 && uW <= 40;

    // Zone Explosion
    let zoneExp = 'NONE';
    if (zone && hasBreakout) {
      if (p10R <= 0.75 && cazp >= 0.75 && cazp <= 4.0 && eRA >= 1.0 && eRA <= 4.0
        && cL >= 75 && bP >= 25 && uW <= 35 && volExpR >= 1.25 && p10V <= 1.10
        && atrPct >= 3.5 && atrPct <= 7.5 && zone.t <= 20 && zone.len >= 5 && zone.len <= 25 && isGreen)
        zoneExp = 'EXPLODE';
      else if (zone.t <= 20 && zone.len >= 5 && zone.len <= 20 && p10R <= 1.0
        && cazp >= 0.75 && cazp <= 6.0 && eRA >= 1.0 && eRA <= 8.0
        && atrPct >= 3.5 && atrPct <= 7.5 && eVR >= 1.2 && eVP >= 2.0
        && cL >= 70 && bP >= 35 && uW <= 35)
        zoneExp = 'READY';
    }

    // Volume Badge
    let volBadge = 'NONE';
    if (eVR >= 2.0 && eVP >= 2.0 && p10RB <= 0.8 && cL >= 65 && bP >= 35 && uW <= 35)
      volBadge = 'THRUST';
    else if (eVP >= 2.0 && eVR >= 1.2 && p10RB <= 1.1)
      volBadge = 'CONF';

    // Forward 10-day returns
    let mfe = 0, mae = 0, h5 = false, h8 = false, ret10 = 0;
    for (let d = 1; d <= 10 && i+d < n; d++) {
      const hp = (c[i+d].h - s.c) / s.c * 100;
      const lp = (c[i+d].l - s.c) / s.c * 100;
      if (hp > mfe) mfe = hp;
      if (lp < mae) mae = lp;
      if (hp >= 5) h5 = true;
      if (hp >= 8) h8 = true;
    }
    if (i+10 < n) ret10 = (c[i+10].c - s.c) / s.c * 100;

    // Only include signals that have a breakout
    if (!hasBreakout) continue;

    signals.push({ sym, atrState, atrExplosion, zoneExp, volBadge, mfe, mae, h5, h8, ret10, pctl, eRA, eVR, eVP, cL, bP, uW, volExpR, p10R, p10RB, atrPct, cazp, zoneTight: zone?.t || 0, zoneLen: zone?.len || 0 });
  }
}

console.log('Total breakout signals: ' + signals.length);

function stats(arr, label) {
  if (arr.length === 0) return;
  const h5 = arr.filter(s => s.h5).length;
  const h8 = arr.filter(s => s.h8).length;
  const avgMfe = arr.reduce((s,v) => s + v.mfe, 0) / arr.length;
  const avgMae = arr.reduce((s,v) => s + v.mae, 0) / arr.length;
  const avgRet = arr.reduce((s,v) => s + v.ret10, 0) / arr.length;
  console.log(`  ${label.padEnd(28)} | ${String(arr.length).padStart(5)} | ${(h5/arr.length*100).toFixed(1).padStart(6)}% | ${(h8/arr.length*100).toFixed(1).padStart(6)}% | ${('+'+avgMfe.toFixed(1)).padStart(6)} | ${avgMae.toFixed(1).padStart(6)} | ${(avgRet>=0?'+':'')+avgRet.toFixed(2).padStart(6)}`);
}

// ═══ ATR STATE ═══
console.log('\n' + '='.repeat(80));
console.log('ATR STATE BACKTEST');
console.log('='.repeat(80));
console.log('  State                        | Count | +5%Hit | +8%Hit | AvgMFE | AvgMAE | AvgRet10');
console.log('  -----------------------------+-------+--------+--------+--------+--------+---------');
stats(signals.filter(s => s.atrState === 'SLEEP'), '💤 SLEEP (pctl <20)');
stats(signals.filter(s => s.atrState === 'BUILD'), '⚡ BUILD (pctl 20-40)');
stats(signals.filter(s => s.atrState === 'INFLECT'), '🎯 INFLECT (pctl 40-60)');
stats(signals.filter(s => s.atrState === 'MOMEN'), '🔥 MOMEN (pctl >60)');
stats(signals.filter(s => s.atrExplosion), '💥 EXPLODE (all criteria)');
stats(signals, 'ALL breakouts (baseline)');

// Test different ATR percentile boundaries
console.log('\n  Alternative ATR boundaries:');
console.log('  Range                        | Count | +5%Hit | +8%Hit | AvgMFE | AvgMAE | AvgRet10');
console.log('  -----------------------------+-------+--------+--------+--------+--------+---------');
for (const [lo,hi,label] of [[0,10,'Pctl 0-10'],[10,20,'Pctl 10-20'],[20,30,'Pctl 20-30'],[30,40,'Pctl 30-40'],[40,50,'Pctl 40-50'],[50,60,'Pctl 50-60'],[60,70,'Pctl 60-70'],[70,80,'Pctl 70-80'],[80,90,'Pctl 80-90'],[90,100,'Pctl 90-100']]) {
  stats(signals.filter(s => s.pctl >= lo && s.pctl < hi), label);
}

// ═══ ZONE EXPLOSION ═══
console.log('\n' + '='.repeat(80));
console.log('ZONE EXPLOSION BACKTEST');
console.log('='.repeat(80));
console.log('  Badge                        | Count | +5%Hit | +8%Hit | AvgMFE | AvgMAE | AvgRet10');
console.log('  -----------------------------+-------+--------+--------+--------+--------+---------');
stats(signals.filter(s => s.zoneExp === 'EXPLODE'), '💎 EXPLODE');
stats(signals.filter(s => s.zoneExp === 'READY'), '🎯 READY');
stats(signals.filter(s => s.zoneExp === 'NONE'), '— NONE');
stats(signals, 'ALL (baseline)');

// Zone tightness buckets
console.log('\n  Zone Tightness breakdown:');
console.log('  Range                        | Count | +5%Hit | +8%Hit | AvgMFE | AvgMAE | AvgRet10');
console.log('  -----------------------------+-------+--------+--------+--------+--------+---------');
for (const [lo,hi,label] of [[0,3,'Tight 0-3%'],[3,5,'Tight 3-5%'],[5,8,'Tight 5-8%'],[8,12,'Tight 8-12%'],[12,15,'Tight 12-15%'],[15,20,'Tight 15-20%']]) {
  stats(signals.filter(s => s.zoneTight >= lo && s.zoneTight < hi), label);
}

// Zone length buckets
console.log('\n  Zone Length breakdown:');
console.log('  Range                        | Count | +5%Hit | +8%Hit | AvgMFE | AvgMAE | AvgRet10');
console.log('  -----------------------------+-------+--------+--------+--------+--------+---------');
for (const [lo,hi,label] of [[4,6,'Len 4-5'],[6,8,'Len 6-7'],[8,10,'Len 8-9'],[10,15,'Len 10-14'],[15,20,'Len 15-19'],[20,26,'Len 20-25']]) {
  stats(signals.filter(s => s.zoneLen >= lo && s.zoneLen < hi), label);
}

// ═══ VOLUME BADGE ═══
console.log('\n' + '='.repeat(80));
console.log('VOLUME BADGE BACKTEST');
console.log('='.repeat(80));
console.log('  Badge                        | Count | +5%Hit | +8%Hit | AvgMFE | AvgMAE | AvgRet10');
console.log('  -----------------------------+-------+--------+--------+--------+--------+---------');
stats(signals.filter(s => s.volBadge === 'THRUST'), '🔥 THRUST');
stats(signals.filter(s => s.volBadge === 'CONF'), '✓ CONF');
stats(signals.filter(s => s.volBadge === 'NONE'), '— NONE');
stats(signals, 'ALL (baseline)');

// Volume ratio buckets
console.log('\n  Volume/20d ratio breakdown:');
console.log('  Range                        | Count | +5%Hit | +8%Hit | AvgMFE | AvgMAE | AvgRet10');
console.log('  -----------------------------+-------+--------+--------+--------+--------+---------');
for (const [lo,hi,label] of [[0,0.5,'Vol <0.5×'],[0.5,1.0,'Vol 0.5-1.0×'],[1.0,1.5,'Vol 1.0-1.5×'],[1.5,2.0,'Vol 1.5-2.0×'],[2.0,3.0,'Vol 2.0-3.0×'],[3.0,5.0,'Vol 3.0-5.0×'],[5.0,999,'Vol 5.0×+']]) {
  stats(signals.filter(s => s.eVR >= lo && s.eVR < hi), label);
}

// VolVsPre5 buckets
console.log('\n  Vol vs Pre-5 breakdown:');
console.log('  Range                        | Count | +5%Hit | +8%Hit | AvgMFE | AvgMAE | AvgRet10');
console.log('  -----------------------------+-------+--------+--------+--------+--------+---------');
for (const [lo,hi,label] of [[0,1,'VsPre5 <1×'],[1,1.5,'VsPre5 1-1.5×'],[1.5,2,'VsPre5 1.5-2×'],[2,3,'VsPre5 2-3×'],[3,5,'VsPre5 3-5×'],[5,999,'VsPre5 5×+']]) {
  stats(signals.filter(s => s.eVP >= lo && s.eVP < hi), label);
}

// ═══ CROSS-ANALYSIS ═══
console.log('\n' + '='.repeat(80));
console.log('CROSS-ANALYSIS — Best combinations');
console.log('='.repeat(80));
console.log('  Combination                  | Count | +5%Hit | +8%Hit | AvgMFE | AvgMAE | AvgRet10');
console.log('  -----------------------------+-------+--------+--------+--------+--------+---------');
stats(signals.filter(s => s.atrState === 'INFLECT' && s.volBadge === 'THRUST'), 'INFLECT + THRUST');
stats(signals.filter(s => s.atrState === 'INFLECT' && s.volBadge !== 'NONE'), 'INFLECT + any vol');
stats(signals.filter(s => s.atrState === 'BUILD' && s.volBadge === 'THRUST'), 'BUILD + THRUST');
stats(signals.filter(s => s.zoneExp !== 'NONE' && s.volBadge !== 'NONE'), 'Zone badge + Vol badge');
stats(signals.filter(s => s.atrExplosion), 'ATR EXPLODE');
stats(signals.filter(s => s.zoneExp === 'EXPLODE'), 'Zone EXPLODE');
stats(signals.filter(s => s.atrExplosion && s.zoneExp === 'EXPLODE'), 'ATR + Zone EXPLODE');
stats(signals.filter(s => s.zoneExp !== 'NONE' && s.atrState === 'INFLECT'), 'Zone badge + INFLECT');
stats(signals.filter(s => s.volBadge === 'THRUST' && s.zoneExp !== 'NONE'), 'THRUST + Zone badge');

// ═══ RECOMMENDED RE-STRATIFICATION ═══
console.log('\n' + '='.repeat(80));
console.log('RECOMMENDED THRESHOLDS');
console.log('='.repeat(80));

// Find optimal ATR boundaries
console.log('\n  ATR State — optimal percentile boundaries:');
let bestSleepCut = 20, bestBuildCut = 40, bestInflectCut = 60;
let bestScore = -999;
for (const sc of [10,15,20,25]) {
  for (const bc of [30,35,40,45]) {
    for (const ic of [55,60,65,70]) {
      if (sc >= bc || bc >= ic) continue;
      const sleep = signals.filter(s => s.pctl < sc);
      const build = signals.filter(s => s.pctl >= sc && s.pctl < bc);
      const inflect = signals.filter(s => s.pctl >= bc && s.pctl < ic);
      const momen = signals.filter(s => s.pctl >= ic);
      if (inflect.length < 20) continue;
      const inflectHR = inflect.filter(s => s.h5).length / inflect.length;
      const buildHR = build.length > 0 ? build.filter(s => s.h5).length / build.length : 0;
      const score = inflectHR * 3 + buildHR * 2 - (sleep.length > 0 ? sleep.filter(s => s.h5).length / sleep.length : 0);
      if (score > bestScore) { bestScore = score; bestSleepCut = sc; bestBuildCut = bc; bestInflectCut = ic; }
    }
  }
}
console.log(`    Current: SLEEP <20, BUILD 20-40, INFLECT 40-60, MOMEN >60`);
console.log(`    Optimal: SLEEP <${bestSleepCut}, BUILD ${bestSleepCut}-${bestBuildCut}, INFLECT ${bestBuildCut}-${bestInflectCut}, MOMEN >${bestInflectCut}`);

// Verify optimal
console.log('\n  Optimal ATR stratification performance:');
console.log('  State                        | Count | +5%Hit | +8%Hit | AvgMFE | AvgMAE | AvgRet10');
console.log('  -----------------------------+-------+--------+--------+--------+--------+---------');
stats(signals.filter(s => s.pctl < bestSleepCut), `SLEEP (pctl <${bestSleepCut})`);
stats(signals.filter(s => s.pctl >= bestSleepCut && s.pctl < bestBuildCut), `BUILD (pctl ${bestSleepCut}-${bestBuildCut})`);
stats(signals.filter(s => s.pctl >= bestBuildCut && s.pctl < bestInflectCut), `INFLECT (pctl ${bestBuildCut}-${bestInflectCut})`);
stats(signals.filter(s => s.pctl >= bestInflectCut), `MOMEN (pctl >${bestInflectCut})`);
