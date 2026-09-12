# UC DNA Analysis — periodic re-mining of thresholds
# Scheduled: monthly via Task Scheduler (UC_DNA_AutoAnalysis)
# Logs to: scripts/results/auto_dna_analysis.log

$root    = "D:\Claude code\stock-screener"
$logFile = "$root\scripts\results\auto_dna_analysis.log"

if (-not (Test-Path "$root\scripts\results")) {
    New-Item -ItemType Directory -Path "$root\scripts\results" -Force | Out-Null
}

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content $logFile "`n========================================="
Add-Content $logFile "RUN START: $stamp"
Add-Content $logFile "========================================="

Set-Location $root

# 1. Enhanced DNA miner — re-mines optimal DNA thresholds
Add-Content $logFile "`n--- uc_enhanced_dna.js --target=5pct ---"
try {
    $out = & node "$root\scripts\uc_enhanced_dna.js" --target=5pct 2>&1
    Add-Content $logFile $out
    Add-Content $logFile "[OK] uc_enhanced_dna.js completed"
} catch {
    Add-Content $logFile "[ERROR] uc_enhanced_dna.js: $_"
}

# 2. Exact gate finder — re-derives logging + filter thresholds
Add-Content $logFile "`n--- uc_score_exact_gate.js --target=5pct ---"
try {
    $out = & node "$root\scripts\uc_score_exact_gate.js" --target=5pct 2>&1
    Add-Content $logFile $out
    Add-Content $logFile "[OK] uc_score_exact_gate.js completed"
} catch {
    Add-Content $logFile "[ERROR] uc_score_exact_gate.js: $_"
}

# 3. Rolling precision tracker — drift detection per DNA clause
Add-Content $logFile "`n--- rolling_precision_tracker.js ---"
try {
    $out = & node "$root\scripts\rolling_precision_tracker.js" 2>&1
    Add-Content $logFile $out
    Add-Content $logFile "[OK] rolling_precision_tracker.js completed"
} catch {
    Add-Content $logFile "[ERROR] rolling_precision_tracker.js: $_"
}

# 4. Auto-apply improvements — patch code + git commit + deploy if stats warrant
Add-Content $logFile "`n--- auto_apply_improvements.js ---"
try {
    $out = & node "$root\scripts\auto_apply_improvements.js" 2>&1
    Add-Content $logFile $out
    Add-Content $logFile "[OK] auto_apply_improvements.js completed"
} catch {
    Add-Content $logFile "[ERROR] auto_apply_improvements.js: $_"
}

$stamp2 = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content $logFile "`nRUN END: $stamp2"
Add-Content $logFile "Results in: $root\scripts\results\"
