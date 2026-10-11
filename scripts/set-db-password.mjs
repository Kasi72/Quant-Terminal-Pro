// Sets a new random Postgres password on the Supabase project in .env.local (SUPABASE_PROJECT_REF),
// then writes the pooler connection string to .mcp.json (toolbox-postgres) and to .env.local
// (SUPABASE_DB_URL). The password is never printed. App, scripts and edge functions use API keys,
// not this password, so nothing else is affected.
// Run: node scripts/set-db-password.mjs

import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { randomBytes } from 'crypto';

const ROOT = new URL('..', import.meta.url);
const envPath = new URL('.env.local', ROOT);
const mcpPath = new URL('.mcp.json', ROOT);

const envText = readFileSync(envPath, 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).map(l => l.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]));
const ref = env.SUPABASE_PROJECT_REF;
if (!ref || !env.SUPABASE_ACCESS_TOKEN) throw new Error('SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN missing from .env.local');

const headers = { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
const pooler = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/config/database/pooler`, { headers })).json();
const p = (Array.isArray(pooler) ? pooler : [pooler]).find(x => x.database_type === 'PRIMARY') ?? pooler[0];
if (!p?.db_host) throw new Error('Could not read pooler settings');

const password = randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 28) + 'Aa7';
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/password`, {
  method: 'PATCH', headers, body: JSON.stringify({ password }),
});
if (!res.ok) throw new Error(`Password reset failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);

// Session-mode pooler (port 5432): IPv4-reachable, supports prepared statements.
const conn = `postgresql://${p.db_user}:${password}@${p.db_host}:5432/${p.db_name}`;

copyFileSync(mcpPath, new URL('.mcp.json.bak-2026-10-11', ROOT));
const mcp = JSON.parse(readFileSync(mcpPath, 'utf8'));
mcp.mcpServers['toolbox-postgres'].env.POSTGRES_CONNECTION_STRING = conn;
writeFileSync(mcpPath, JSON.stringify(mcp, null, 2) + '\n');

const withoutOld = envText.split(/\r?\n/).filter(l => !/^\s*SUPABASE_DB_URL\s*=/.test(l)).join('\n').replace(/\s*$/, '');
writeFileSync(envPath, `${withoutOld}\nSUPABASE_DB_URL=${conn}\n`);

console.log(`Done: new password set on ${ref}; .mcp.json updated (backup .mcp.json.bak-2026-10-11); SUPABASE_DB_URL saved to .env.local.`);
