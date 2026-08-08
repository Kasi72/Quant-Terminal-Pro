'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const ENGINE_DIR = path.join(__dirname, '_compiled_current');
const PARAM_KEY = 'sniper_95plus';

if (!isMainThread) {
  try {
    const engine = require(path.join(ENGINE_DIR, 'stockEngine.js'));
    const { override } = workerData;
    const before = override.field != null ? engine.PARAM_SETS[PARAM_KEY][override.field] : 'N/A';
    if (override.field != null) engine.PARAM_SETS[PARAM_KEY][override.field] = override.value;
    const after = override.field != null ? engine.PARAM_SETS[PARAM_KEY][override.field] : 'N/A';
    parentPort.postMessage({ type: 'ok', field: override.field, before, after });
  } catch (e) {
    parentPort.postMessage({ type: 'err', msg: e.message, stack: e.stack });
  }
} else {
  console.log('Test 1: BASE (no override)');
  const w1 = new Worker(__filename, { workerData: { override: { field: null, value: null } } });
  w1.on('message', m => console.log('  msg:', JSON.stringify(m)));
  w1.on('error', e => console.error('  ERROR:', e.message));
  w1.on('exit', c => {
    console.log('  exit:', c);
    console.log('\nTest 2: Relax maxUpperWickPct to 50');
    const w2 = new Worker(__filename, { workerData: { override: { field: 'maxUpperWickPct', value: 50 } } });
    w2.on('message', m => console.log('  msg:', JSON.stringify(m)));
    w2.on('error', e => console.error('  ERROR:', e.message));
    w2.on('exit', c2 => console.log('  exit:', c2));
  });
}
