# Push Sales-Audit to GitHub (triggers Render deploy)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
  Write-Error "Git is not installed. Install from https://git-scm.com/download/win"
}

if (-not (Test-Path ".git")) {
  git init
  git branch -M master
  git remote add origin https://github.com/cavinkarecia/Sales-Audit.git
}

git add -A
$msg = "Sales Audit 2.0: uploads, allowance audit, full dashboard, AI proxy"
git commit -m $msg 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Nothing new to commit, pushing anyway..."
}
git pull origin master --rebase 2>$null
git push -u origin master
Write-Host ""
Write-Host "Pushed. Render will deploy to: https://sales-audit-2-0.onrender.com"
Write-Host "Set DEEPSEEK_API_KEY in Render Environment if not already set."
