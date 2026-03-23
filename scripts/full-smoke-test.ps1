# ============================================================
# POD AI Factory — Full Pipeline Smoke Test
# ============================================================
# Test order:
#   1. login
#   2. factory run
#   3. gallery load
#   4. approve image
#   5. run pipeline
#   6. wait pipeline done
#   7. download export zip
#   8. verify files (design_4500x5400.png, mockup1.png, mockup2.png, listing.csv, seo.json)
# ============================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  POD AI Factory — FULL Pipeline Test" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# ── Pre-flight checks ──────────────────────────────────────

Write-Host "[PRE] Checking Docker containers (Postgres + Redis)..." -ForegroundColor Yellow
$dockerRunning = docker ps --format "{{.Names}}" 2>$null
if (-not $dockerRunning) {
    Write-Host "  ⚠  Docker is not running or no containers found." -ForegroundColor Red
    Write-Host "  →  Run: docker-compose up -d" -ForegroundColor Gray
    exit 1
}

$hasPostgres = $dockerRunning | Select-String -Pattern "postgres|pod.*db"
$hasRedis = $dockerRunning | Select-String -Pattern "redis"

if ($hasPostgres) {
    Write-Host "  ✅ Postgres container detected" -ForegroundColor Green
}
else {
    Write-Host "  ⚠  Postgres container NOT found" -ForegroundColor Red
    exit 1
}

if ($hasRedis) {
    Write-Host "  ✅ Redis container detected" -ForegroundColor Green
}
else {
    Write-Host "  ⚠  Redis container NOT found" -ForegroundColor Red
    exit 1
}

# ── Check if backend is up ─────────────────────────────────

Write-Host ""
Write-Host "[PRE] Checking backend health..." -ForegroundColor Yellow

try {
    $health = Invoke-RestMethod -Uri "http://localhost:3000/health" -Method GET -TimeoutSec 5
    if ($health.status -eq "OK") {
        Write-Host "  ✅ Backend is running on port 3000" -ForegroundColor Green
    }
}
catch {
    Write-Host "  ⚠  Backend not reachable on port 3000" -ForegroundColor Red
    Write-Host "  →  Starting backend in background..." -ForegroundColor Gray
    
    $projectRoot = Split-Path -Parent $PSScriptRoot
    Start-Process -FilePath "node" -ArgumentList "src/index.js" -WorkingDirectory $projectRoot -WindowStyle Hidden
    
    Write-Host "  →  Waiting 5s for startup..." -ForegroundColor Gray
    Start-Sleep -Seconds 5
    
    try {
        $health = Invoke-RestMethod -Uri "http://localhost:3000/health" -Method GET -TimeoutSec 5
        if ($health.status -eq "OK") {
            Write-Host "  ✅ Backend started successfully" -ForegroundColor Green
        }
    }
    catch {
        Write-Host "  ❌ Backend failed to start. Check logs." -ForegroundColor Red
        exit 1
    }
}

# ── Run the E2E test ───────────────────────────────────────

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Running Full E2E Smoke Test..." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

$projectRoot = Split-Path -Parent $PSScriptRoot

try {
    & node "$projectRoot\smoke-test.js" 2>&1 | Tee-Object -Variable testOutput
    $exitCode = $LASTEXITCODE
}
catch {
    $exitCode = 1
    Write-Host "Exception: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan

if ($exitCode -eq 0) {
    Write-Host "  🎉 FULL PIPELINE TEST: PASS" -ForegroundColor Green
    Write-Host "=========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  ZIP Contents Verified:" -ForegroundColor Green
    Write-Host "    ✅ design_4500x5400.png" -ForegroundColor Green
    Write-Host "    ✅ mockup1.png" -ForegroundColor Green
    Write-Host "    ✅ mockup2.png" -ForegroundColor Green
    Write-Host "    ✅ listing.csv" -ForegroundColor Green
    Write-Host "    ✅ seo.json" -ForegroundColor Green
    Write-Host ""
    Write-Host "  SaaS pipeline is READY for production." -ForegroundColor Cyan
    exit 0
}
else {
    Write-Host "  ❌ FULL PIPELINE TEST: FAIL" -ForegroundColor Red
    Write-Host "=========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Review the output above for failure details." -ForegroundColor Yellow
    Write-Host "  Common fixes:" -ForegroundColor Yellow
    Write-Host "    - Ensure Docker (Postgres + Redis) is running" -ForegroundColor Gray
    Write-Host "    - Check FAL_API_KEY in .env" -ForegroundColor Gray
    Write-Host "    - Run: npx prisma migrate deploy" -ForegroundColor Gray
    exit 1
}
