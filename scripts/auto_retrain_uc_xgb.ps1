
# auto_retrain_uc_xgb.ps1
# Scheduled: 2026-09-16 and every 30 trading days thereafter.
# Retrains UC-XGBoost, commits updated weights, pushes, deploys to Vercel.
# Log: scripts/results/auto_retrain_uc_xgb.log

$Root    = "D:\Claude code\stock-screener"
$Python  = "C:\Users\drkkr\AppData\Local\Programs\Python\Python310\python.exe"
$Script  = "$Root\scripts\train_uc_xgb.py"
$LogDir  = "$Root\scripts\results"
$LogFile = "$LogDir\auto_retrain_uc_xgb.log"

if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force $LogDir | Out-Null }

function Log($msg) {
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    "$ts  $msg" | Tee-Object -FilePath $LogFile -Append | Write-Host
}

Set-Location $Root

Log "=== UC-XGBoost auto-retrain started ==="
Log "Python: $Python"
Log "Script: $Script"

# ------------------------------------------------------------------
# 1. Run training script; capture stdout to parse AUC
# ------------------------------------------------------------------
$output = & $Python $Script 2>&1
$output | ForEach-Object { Log $_ }

if ($LASTEXITCODE -ne 0) {
    Log "ERROR: train_uc_xgb.py exited with code $LASTEXITCODE. Aborting."
    exit 1
}

# Parse AUC from output line: "Test AUC=0.6223"
$aucLine = $output | Where-Object { $_ -match "UC-XGB Test AUC\s*=\s*([\d.]+)" } | Select-Object -Last 1
if ($aucLine -match "UC-XGB Test AUC\s*=\s*([\d.]+)") {
    $auc = [double]$Matches[1]
    Log "Parsed AUC: $auc"
} else {
    Log "WARN: Could not parse AUC from output. Proceeding anyway."
    $auc = 0
}

# Abort if AUC is suspiciously low (random-level -- data quality problem)
if ($auc -gt 0 -and $auc -lt 0.52) {
    Log "ERROR: AUC $auc < 0.52 (near random). Aborting deploy -- check data quality."
    exit 1
}

# ------------------------------------------------------------------
# 2. Run UC precision analysis — updates formula weights from labeled data
# ------------------------------------------------------------------
Log "Running UC precision analysis (Cohen's d weight recalibration)..."
$node = (Get-Command node -ErrorAction SilentlyContinue)?.Source ?? "node"
$precisionOut = & $node "$Root\scripts\uc_precision_analysis.js" --apply 2>&1
$precisionOut | ForEach-Object { Log $_ }
if ($LASTEXITCODE -eq 0) {
    Log "ucScoreWeights.ts updated from precision analysis."
} else {
    Log "WARN: uc_precision_analysis.js exited $LASTEXITCODE — may be insufficient labeled data. Continuing with existing weights."
}

# ------------------------------------------------------------------
# 3. Stage updated TS weight files
# ------------------------------------------------------------------
git add lib\ucXgbWeights.ts lib\ucCalibration.ts lib\ucScoreWeights.ts
if ($LASTEXITCODE -ne 0) { Log "ERROR: git add failed."; exit 1 }

$gitStatus = git status --short lib\ucXgbWeights.ts lib\ucCalibration.ts lib\ucScoreWeights.ts
if (-not $gitStatus) {
    Log "No changes in weight files -- model output identical to last commit. Skipping commit+deploy."
    exit 0
}

# ------------------------------------------------------------------
# 4. Commit
# ------------------------------------------------------------------
$today = (Get-Date).ToString("yyyy-MM-dd")
$msg   = "chore: auto-retrain UC-XGBoost $today (AUC=$auc)"
git commit -m $msg
if ($LASTEXITCODE -ne 0) { Log "ERROR: git commit failed."; exit 1 }
Log "Committed: $msg"

# ------------------------------------------------------------------
# 5. Push
# ------------------------------------------------------------------
git push
if ($LASTEXITCODE -ne 0) { Log "ERROR: git push failed."; exit 1 }
Log "Pushed to remote."

# ------------------------------------------------------------------
# 6. Vercel deploy
# ------------------------------------------------------------------
Log "Starting Vercel deploy..."
$deployOut = vercel deploy --prod --yes 2>&1
$deployOut | ForEach-Object { Log $_ }

if ($LASTEXITCODE -ne 0) {
    Log "ERROR: Vercel deploy failed (exit $LASTEXITCODE)."
    exit 1
}

Log "=== UC-XGBoost auto-retrain complete. AUC=$auc ==="
exit 0
