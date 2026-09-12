# Daily Brain Trainer wrapper — weekdays 20:30
# Logs to scripts/results/daily_brain_trainer.log (appended by the JS itself)

$root    = "D:\Claude code\stock-screener"
$logFile = "$root\scripts\results\daily_brain_trainer.log"

if (-not (Test-Path "$root\scripts\results")) {
    New-Item -ItemType Directory -Path "$root\scripts\results" -Force | Out-Null
}

$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content $logFile "`n========================================="
Add-Content $logFile "DAILY TRAINER START: $stamp"
Add-Content $logFile "========================================="

Set-Location $root

try {
    & node "$root\scripts\daily_brain_trainer.js" 2>&1 | Tee-Object -Append -FilePath $logFile
    Add-Content $logFile "[OK] daily_brain_trainer.js completed"
} catch {
    Add-Content $logFile "[ERROR] daily_brain_trainer.js: $_"
}

$stamp2 = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content $logFile "DAILY TRAINER END: $stamp2"
