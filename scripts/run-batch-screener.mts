// Runs the production /api/batch-screener handler locally against the Supabase project in .env.local.
// Use when the nightly Vercel cron missed a run (e.g. after a database move) so the screener has
// pre-computed results to restore on open.
// Run: npx tsx scripts/run-batch-screener.mts

import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import Module, { createRequire } from 'module';
import { NextRequest } from 'next/server';

// 'server-only' only resolves inside a Next build; outside it, map to Next's own empty stub.
const serverOnlyStub = createRequire(import.meta.url).resolve('next/dist/compiled/server-only/empty.js');
const resolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...rest: unknown[]) {
  return resolve.call(this, request === 'server-only' ? serverOnlyStub : request, ...rest);
};

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}
// Local-only token so the handler's auth check passes; never sent anywhere.
const token = randomBytes(24).toString('hex');
process.env.CRON_SECRET = token;

const { GET } = await import('../app/api/batch-screener/route');
const started = Date.now();
const res = await GET(new NextRequest('http://localhost/api/batch-screener', { headers: { authorization: `Bearer ${token}` } }));
console.log(res.status, JSON.stringify(await res.json()), `${((Date.now() - started) / 1000).toFixed(0)}s`);
