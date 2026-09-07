#!/usr/bin/env node
// Apply pending Supabase migrations via the Management API.
// Reads SUPABASE_ACCESS_TOKEN from .env.local.

import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Load .env.local ──────────────────────────────────────────────────────────
const envContent = await readFile(join(ROOT, '.env.local'), 'utf-8');
const env = {};
for (const line of envContent.split(/\r?\n/)) {
  if (!line.includes('=') || line.trimStart().startsWith('#')) continue;
  const idx = line.indexOf('=');
  env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
}

const PAT = env.SUPABASE_ACCESS_TOKEN;
if (!PAT) throw new Error('SUPABASE_ACCESS_TOKEN missing from .env.local');

const PROJECT_REF = 'cmkfqlppbwyrhjmooqbq';
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

async function sql(query) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${text}`);
  return JSON.parse(text);
}

// ── Ensure migration tracking exists ────────────────────────────────────────
await sql(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    name    text
  );
`);

// ── Which migrations are already applied? ────────────────────────────────────
const rows = await sql('select version from supabase_migrations.schema_migrations');
const applied = new Set((rows ?? []).map(r => r.version));

// ── Read local migration files ────────────────────────────────────────────────
const migrDir = join(ROOT, 'supabase', 'migrations');
const files = (await readdir(migrDir)).filter(f => f.endsWith('.sql')).sort();

let applied_count = 0;
for (const file of files) {
  const version = file.replace('.sql', '');
  if (applied.has(version)) {
    console.log(`  skip  ${file}`);
    continue;
  }
  console.log(`  apply ${file}`);
  const sqlText = await readFile(join(migrDir, file), 'utf-8');
  await sql(sqlText);
  await sql(
    `insert into supabase_migrations.schema_migrations(version, name) values('${version}', '${file}')`
  );
  applied_count++;
}

console.log(`${applied_count} migration(s) applied`);
