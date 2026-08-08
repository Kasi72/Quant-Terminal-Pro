# Monthly ML refresh — chains all steps and deploys automatically.
# Run manually: right-click → Run with PowerShell
# Or scheduled via Windows Task Scheduler (see README comment at bottom).

$PYTHON  = "C:\Users\drkkr\AppData\Local\Programs\Python\Python310\python.exe"
$ROOT    = "D:\Claude code\stock-screener"
$SCRIPTS = "$ROOT\scripts"
$LOG     = "$SCRIPTS\logs\refresh_$(Get-Date -Format 'yyyy-MM-dd').log"

Set-Location $ROOT
New-Item -ItemType Directory -Force "$SCRIPTS\logs" | Out-Null

function Log($msg) {
    $line = "$(Get-Date -Format 'HH:mm:ss') $msg"
    Write-Host $line
    Add-Content $LOG $line
}

function Run($label, $script) {
    Log "▶ $label"
    $out = & $PYTHON $script 2>&1
    $out | ForEach-Object { Add-Content $LOG "  $_"; Write-Host "  $_" }
    if ($LASTEXITCODE -ne 0) {
        Log "✗ $label FAILED (exit $LASTEXITCODE) — aborting."
        exit 1
    }
    Log "✓ $label done"
}

Log "=== Monthly ML Refresh starting ==="

# Step 1 — Bulk-label historical outcomes from local CSVs
Run "Bulk label outcomes" "$SCRIPTS\bulk_label_outcomes.py"

# Step 2 — Train XGBoost on labeled pbfb_uc_events
Run "Train XGBoost" "$SCRIPTS\train_xgb_score.py"

# Step 3 — Forward-scan CSVs for time-to-5% survival times
Run "Compute survival times" "$SCRIPTS\compute_survival_times.py"

# Step 4 — Fit KM + CoxPH, rewrite lib/survivalCurves.ts
Run "Run survival analysis" "$SCRIPTS\run_survival_analysis.py"

# Step 5 — Commit updated TS constants and deploy to Vercel
Log "▶ Git commit + Vercel deploy"
git add lib/xgbModelWeights.ts lib/survivalCurves.ts
$changed = git diff --cached --name-only
if (-not $changed) {
    Log "  No TS file changes detected — skipping commit."
} else {
    git commit -m "chore: monthly ML refresh — XGB model + survival curves $(Get-Date -Format 'yyyy-MM-dd')"
    if ($LASTEXITCODE -ne 0) { Log "✗ git commit failed"; exit 1 }
    vercel deploy --prod --yes
    if ($LASTEXITCODE -ne 0) { Log "✗ Vercel deploy failed"; exit 1 }
    Log "✓ Deployed to Vercel"
}

Log "=== Refresh complete. Log: $LOG ==="

# ─────────────────────────────────────────────────────────────────────────────
# To schedule monthly via Task Scheduler (run once in an admin PowerShell):
#
# $action  = New-ScheduledTaskAction -Execute "powershell.exe" `
#              -Argument "-NonInteractive -File `"D:\Claude code\stock-screener\scripts\monthly_refresh.ps1`""
# $trigger = New-ScheduledTaskTrigger -Monthly -DaysOfMonth 1 -At "07:00"
# Register-ScheduledTask -TaskName "StockScreener-MLRefresh" `
#   -Action $action -Trigger $trigger -RunLevel Highest
# ─────────────────────────────────────────────────────────────────────────────
