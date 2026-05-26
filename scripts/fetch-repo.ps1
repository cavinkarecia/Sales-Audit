$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$dest = Join-Path $env:USERPROFILE "Projects\Sales-Audit"
if (-not (Test-Path $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null }
$zip = Join-Path $env:TEMP "Sales-Audit-main.zip"
Invoke-WebRequest -Uri "https://github.com/cavinkarecia/Sales-Audit/archive/refs/heads/master.zip" -OutFile $zip -UseBasicParsing
Expand-Archive -Path $zip -DestinationPath $env:TEMP -Force
$src = Join-Path $env:TEMP "Sales-Audit-master"
Copy-Item -Path "$src\*" -Destination $dest -Recurse -Force
Write-Host "Synced to $dest"
