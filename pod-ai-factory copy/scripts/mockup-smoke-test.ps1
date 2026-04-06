# mockup-smoke-test.ps1
# Runs the Mockup Gallery smoke test
# Usage: .\scripts\mockup-smoke-test.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Mockup Gallery Smoke Test Runner" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Health check skipped

# Run the Node.js test script
$scriptPath = Join-Path $PSScriptRoot "mockup-smoke-test.js"

if (-not (Test-Path $scriptPath)) {
    Write-Host "❌ Test script not found: $scriptPath" -ForegroundColor Red
    exit 1
}

Write-Host "Running mockup-smoke-test.js..." -ForegroundColor Yellow
Write-Host ""

$env:API_BASE = "http://localhost:3000/api"
$env:TEST_EMAIL = "test@pod-factory.com"
$env:TEST_PASSWORD = "dev-token-2024"
$env:TEST_EMAIL_2 = "test2@pod-factory.com"

node $scriptPath
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Green
    Write-Host "  RESULT: PASS" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Green
}
else {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Red
    Write-Host "  RESULT: FAIL (exit code $exitCode)" -ForegroundColor Red
    Write-Host "============================================" -ForegroundColor Red
}

exit $exitCode
