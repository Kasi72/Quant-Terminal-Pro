# deploy.ps1 — git push + supabase migrations + vercel prod deploy
# Usage: .\deploy.ps1
#        .\deploy.ps1 -SkipMigrations   (skip DB step)

param([switch]$SkipMigrations)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Err($msg)  { Write-Host "  ERR $msg" -ForegroundColor Red; exit 1 }

# ── Load .env.local ──────────────────────────────────────────────────────────
$envFile = Join-Path $PSScriptRoot '.env.local'
if (-not (Test-Path $envFile)) { Err '.env.local not found' }

foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $key, $val = $line -split '=', 2
  [System.Environment]::SetEnvironmentVariable($key.Trim(), $val.Trim(), 'Process')
}

# ── 1. Git push ───────────────────────────────────────────────────────────────
Step '1/3  git push'
git push
if ($LASTEXITCODE -ne 0) { Err 'git push failed' }
Ok 'pushed'

# ── 2. Supabase migrations ────────────────────────────────────────────────────
if (-not $SkipMigrations) {
  Step '2/3  supabase db push'

  node scripts/migrate.mjs
  if ($LASTEXITCODE -ne 0) {
    Write-Host '  WARN migration step failed — continuing to Vercel' -ForegroundColor Yellow
  } else {
    Ok 'migrations applied'
  }
} else {
  Write-Host "`n  (migrations skipped)" -ForegroundColor DarkGray
}

# ── 3. Vercel prod deploy ─────────────────────────────────────────────────────
Step '3/3  vercel deploy --prod'
vercel deploy --prod --yes
if ($LASTEXITCODE -ne 0) { Err 'vercel deploy failed' }
Ok 'live on Vercel'

Write-Host "`nDone!" -ForegroundColor Green
