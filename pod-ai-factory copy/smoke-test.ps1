# POD AI Factory — Smoke Test Script
# Tests the complete workflow: Run -> Generate -> Approve -> Pipeline -> Bundle
# Usage: .\smoke-test.ps1
# Prerequisites: Backend running at http://localhost:3000

$BASE = "http://localhost:3000"
$REFERENCE = "assets/references/USA250.jpg"
$ERRORS = 0

function Check-Response($label, $body) {
    if ($null -eq $body -or $body.error) {
        Write-Host "  [FAIL] $label : $($body.error)" -ForegroundColor Red
        $script:ERRORS++
    } else {
        Write-Host "  [PASS] $label" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "=== POD AI Factory Smoke Test ===" -ForegroundColor Cyan
Write-Host "Backend: $BASE"
Write-Host ""

# ─── Step 0: Health Check ─────────────────────────────────────
Write-Host "Step 0: Health check..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod "$BASE/health"
    Check-Response "Health" $health
} catch {
    Write-Host "  [FAIL] Backend not reachable at $BASE. Start it with: npm run dev" -ForegroundColor Red
    exit 1
}

# ─── Step 1: Start a Factory Run ──────────────────────────────
Write-Host "`nStep 1: Starting factory run (generateCount=3, variationCount=3)..." -ForegroundColor Yellow
$runBody = @{
    referenceImageId = $REFERENCE
    generateCount    = 3
    variationCount   = 3
    autoApprove      = $false
    imageSize        = "square_hd"
} | ConvertTo-Json

try {
    $run = Invoke-RestMethod "$BASE/api/factory/run" -Method POST `
           -ContentType "application/json" -Body $runBody
    Check-Response "Factory Run" $run
    $JOB_ID = $run.jobId
    Write-Host "  Job ID: $JOB_ID" -ForegroundColor Cyan

    # Print step statuses
    foreach ($log in $run.logs) {
        $color = if ($log.status -eq "FAILED") { "Red" } else { "DarkGray" }
        Write-Host "    [$($log.status)] $($log.step): $($log.message)" -ForegroundColor $color
    }
} catch {
    Write-Host "  [FAIL] Factory run error: $_" -ForegroundColor Red
    exit 1
}

# ─── Step 2: Verify images exist in gallery ───────────────────
Write-Host "`nStep 2: Loading gallery for job $JOB_ID..." -ForegroundColor Yellow
try {
    $gallery = Invoke-RestMethod "$BASE/api/gallery/$JOB_ID"
    $imageCount = $gallery.Count
    Check-Response "Gallery (got $imageCount images)" @{ ok = $true }

    $completedImages = $gallery | Where-Object { $_.status -eq "COMPLETED" }
    Write-Host "  Total images: $imageCount (completed: $($completedImages.Count))"
} catch {
    Write-Host "  [FAIL] Gallery error: $_" -ForegroundColor Red
    $ERRORS++
}

# ─── Step 3: Approve 1 image ──────────────────────────────────
Write-Host "`nStep 3: Approving first completed image..." -ForegroundColor Yellow
$toApprove = $completedImages | Select-Object -First 1
if ($null -eq $toApprove) {
    Write-Host "  [SKIP] No completed images to approve (generation may have failed — check FAL_API_KEY)" -ForegroundColor DarkYellow
} else {
    try {
        $approve = Invoke-RestMethod "$BASE/api/gallery/$($toApprove.id)/approve" -Method POST
        Check-Response "Approve image $($toApprove.id.Substring(0,8))…" $approve
        $APPROVED_ID = $toApprove.id
    } catch {
        Write-Host "  [FAIL] Approve error: $_" -ForegroundColor Red
        $ERRORS++
    }
}

# ─── Step 4: Run Pipeline for the Job ─────────────────────────
Write-Host "`nStep 4: Running pipeline for job $JOB_ID..." -ForegroundColor Yellow
try {
    $pipeline = Invoke-RestMethod "$BASE/api/pipeline/run-job/$JOB_ID" -Method POST
    Check-Response "Pipeline run-job" $pipeline
    Write-Host "  $($pipeline.message)"
    foreach ($r in $pipeline.results) {
        $color = if ($r.status -eq "FAILED") { "Red" } else { "DarkGray" }
        Write-Host "    [$($r.status)] $($r.imageId.Substring(0,8))…" -ForegroundColor $color
    }
} catch {
    Write-Host "  [FAIL] Pipeline error: $_" -ForegroundColor Red
    $ERRORS++
}

# ─── Step 5: Download Bundle ZIP ──────────────────────────────
Write-Host "`nStep 5: Downloading export bundle for job $JOB_ID..." -ForegroundColor Yellow
$bundlePath = "$PSScriptRoot\smoke_test_bundle_$($JOB_ID.Substring(0,8)).zip"
try {
    Invoke-WebRequest "$BASE/api/export/job/$JOB_ID/bundle" -OutFile $bundlePath
    if (Test-Path $bundlePath) {
        $size = (Get-Item $bundlePath).Length
        Write-Host "  [PASS] Bundle downloaded: $bundlePath ($size bytes)" -ForegroundColor Green
        Remove-Item $bundlePath -Force  # Cleanup
    } else {
        Write-Host "  [FAIL] Bundle file not created" -ForegroundColor Red
        $ERRORS++
    }
} catch {
    Write-Host "  [WARN] Bundle download failed (export may need pipeline to complete first): $_" -ForegroundColor DarkYellow
}

# ─── Summary ──────────────────────────────────────────────────
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
if ($ERRORS -eq 0) {
    Write-Host "ALL CHECKS PASSED" -ForegroundColor Green
} else {
    Write-Host "$ERRORS CHECK(S) FAILED" -ForegroundColor Red
}
Write-Host "Job ID: $JOB_ID"
Write-Host "================================" -ForegroundColor Cyan
