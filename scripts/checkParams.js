// ═══════════════════════════════════════════════════════════════════════════════
// PARAM GUARD — ensures PARAM_SETS in stockEngine match the locked golden snapshot
// Run: node scripts/checkParams.js
// Fails with non-zero exit if any param has drifted.
// To update the lock after an intentional change: node scripts/checkParams.js --update
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const GOLDEN_PATH  = path.join(__dirname, 'goldenParams.json');
const ENGINE_PATH  = path.join(__dirname, '_compiled', 'stockEngine.js');

if (!fs.existsSync(ENGINE_PATH)) {
  console.error('ERROR: compiled engine not found. Run: npm run compile');
  process.exit(1);
}

const { PARAM_SETS } = require(ENGINE_PATH);
const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));

if (process.argv.includes('--update')) {
  fs.writeFileSync(GOLDEN_PATH, JSON.stringify(PARAM_SETS, null, 2));
  console.log('✅  goldenParams.json updated to current param values.');
  process.exit(0);
}

let driftFound = false;

for (const [key, goldenSet] of Object.entries(golden)) {
  const live = PARAM_SETS[key];
  if (!live) {
    console.error(`❌  PARAM SET MISSING: ${key}`);
    driftFound = true;
    continue;
  }
  for (const [param, goldenVal] of Object.entries(goldenSet)) {
    const liveVal = live[param];
    const isObj = (x) => typeof x === 'object' && x !== null;
    const match = isObj(goldenVal) || isObj(liveVal)
      ? JSON.stringify(goldenVal) === JSON.stringify(liveVal)
      : goldenVal === liveVal;
    if (!match) {
      if (!driftFound) {
        console.error('\n╔══════════════════════════════════════════════════════════════╗');
        console.error('║  ❌  PARAM DRIFT DETECTED — params differ from golden lock   ║');
        console.error('╚══════════════════════════════════════════════════════════════╝\n');
      }
      console.error(`  ${key}.${param}:  golden=${JSON.stringify(goldenVal)}  live=${JSON.stringify(liveVal)}`);
      driftFound = true;
    }
  }
  // check for new params not in golden
  for (const param of Object.keys(live)) {
    if (!(param in goldenSet)) {
      console.warn(`  ⚠️  NEW PARAM (not in golden): ${key}.${param} = ${live[param]}`);
    }
  }
}

if (driftFound) {
  console.error('\n  If this change is intentional, run:  node scripts/checkParams.js --update');
  console.error('  Otherwise revert lib/stockEngine.ts to restore golden params.\n');
  process.exit(1);
} else {
  console.log('✅  All param sets match golden lock. No drift detected.');
}
