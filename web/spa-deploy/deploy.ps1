# deploy.ps1 — Build the IOA Governance SPA and copy to W:\ioa (Gilbert)
# Run from repo root:  .\web\spa-deploy\deploy.ps1

param(
    [string]$Target = "W:\ioa"
)

$ErrorActionPreference = "Stop"
$webDir  = Join-Path $PSScriptRoot ".."
$distDir = Join-Path $webDir "dist"

Write-Host "Building IOA Governance SPA..." -ForegroundColor Cyan
Push-Location $webDir
npm run build
Pop-Location

if (-not (Test-Path $distDir)) {
    Write-Error "Build failed — dist/ not found at $distDir"
    exit 1
}

Write-Host "Copying dist/ to $Target ..." -ForegroundColor Cyan
if (-not (Test-Path $Target)) {
    New-Item -ItemType Directory -Force -Path $Target | Out-Null
}

# Mirror: copy all, delete files in target that no longer exist in source
robocopy $distDir $Target /MIR /NFL /NDL /NJH /NJS

Write-Host "Deploy complete. Files are at $Target" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps on Gilbert:" -ForegroundColor Yellow
Write-Host "  sudo cp /path/to/ioa.ea2sa.com.conf /etc/nginx/sites-available/"
Write-Host "  sudo ln -sf /etc/nginx/sites-available/ioa.ea2sa.com.conf /etc/nginx/sites-enabled/"
Write-Host "  sudo nginx -t && sudo systemctl reload nginx"
