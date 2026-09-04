# Monthly ML refresh -- chains all steps and deploys automatically.
# Run manually: right-click -> Run with PowerShell
# Scheduled via Windows Task Scheduler (monthly, day 1, 07:00).

$PYTHON  = "C:\Users\drkkr\AppData\Local\Programs\Python\Python310\python.exe"
$ROOT    = "D:\Claude code\stock-screener"
$SCRIPTS = "$ROOT\scripts"
$LOG     = "$SCRIPTS\logs\refresh_$(Get-Date -Format 'yyyy-MM-dd').log"
$LOCK    = "$ROOT\monthly_refresh.lock"

Set-Location $ROOT
New-Item -ItemType Directory -Force "$SCRIPTS\logs" | Out-Null

# Lock: prevent concurrent runs (4-hour stale threshold)
if (Test-Path $LOCK) {
    $age = (Get-Date) - (Get-Item $LOCK).LastWriteTime
    if ($age.TotalHours -lt 4) {
        Write-Host "Lock active (age $([int]$age.TotalMinutes) min) -- skipping."
        exit 0
    }
    Write-Host "Stale lock ($([int]$age.TotalHours)h) -- removing."
    Remove-Item $LOCK -Force
}
"$((Get-Date).ToString('o'))" | Set-Content $LOCK

function Write-Log {
    param([string]$Msg)
    $line = "[$(Get-Date -Format 'HH:mm:ss')] $Msg"
    Write-Host $line
    Add-Content -Path $LOG -Value $line
}

function Invoke-Step {
    param([string]$Label, [string]$Script)
    Write-Log "START: $Label"
    $out = & $PYTHON $Script 2>&1
    $out | ForEach-Object { Add-Content -Path $LOG -Value "  $_"; Write-Host "  $_" }
    if ($LASTEXITCODE -ne 0) {
        throw "FAIL: $Label (exit $LASTEXITCODE)"
    }
    Write-Log "OK: $Label"
}

$exitCode = 1
try {
    Write-Log "========================================================"
    Write-Log "Monthly ML Refresh START"
    Write-Log "Python: $PYTHON"
    Write-Log "========================================================"

    if (-not (Test-Path $PYTHON)) { throw "Python not found at $PYTHON" }

    # Step 1 -- Bulk-label historical outcomes from local CSVs
    Invoke-Step "bulk_label_outcomes" "$SCRIPTS\bulk_label_outcomes.py"

    # Step 2 -- Train XGBoost on labeled pbfb_uc_events
    Invoke-Step "train_xgb_score" "$SCRIPTS\train_xgb_score.py"

    # Step 3 -- Forward-scan CSVs for time-to-5% survival times
    Invoke-Step "compute_survival_times" "$SCRIPTS\compute_survival_times.py"

    # Step 4 -- Fit KM + CoxPH, rewrite lib/survivalCurves.ts
    Invoke-Step "run_survival_analysis" "$SCRIPTS\run_survival_analysis.py"

    # Step 5 -- Commit + deploy
    Write-Log "START: git commit + Vercel deploy"
    git add lib/xgbModelWeights.ts lib/survivalCurves.ts
    $changed = git diff --cached --name-only
    if (-not $changed) {
        Write-Log "No TS file changes -- skipping commit."
    } else {
        $tag = Get-Date -Format 'yyyy-MM-dd'
        git commit -m "chore: monthly ML refresh $tag"
        if ($LASTEXITCODE -ne 0) { throw "git commit failed" }
        git push 2>&1 | ForEach-Object { Add-Content -Path $LOG -Value "  $_"; Write-Host "  $_" }
        if ($LASTEXITCODE -ne 0) { throw "git push failed" }
        vercel deploy --prod --yes 2>&1 | ForEach-Object { Add-Content -Path $LOG -Value "  $_"; Write-Host "  $_" }
        if ($LASTEXITCODE -ne 0) { throw "Vercel deploy failed" }
        Write-Log "OK: Deployed to Vercel"
    }

    Write-Log "Monthly ML Refresh DONE. Log: $LOG"
    Write-Log "========================================================"
    $exitCode = 0

} catch {
    Write-Log "ERROR: $_"
    Write-Log "Monthly ML Refresh FAILED."
} finally {
    Remove-Item $LOCK -Force -ErrorAction SilentlyContinue
}

exit $exitCode
