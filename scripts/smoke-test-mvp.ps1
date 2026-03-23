Write-Host "========================================="
Write-Host " POD AI Factory MVP Smoke Test"
Write-Host "========================================="

if (!(Test-Path "package.json")) {
  Write-Host "❌ Wrong directory. Go to pod-ai-factory root." -ForegroundColor Red
  exit 1
}

Write-Host "[1/6] Checking backend health..."
try {
  $health = Invoke-RestMethod http://localhost:3000/health -TimeoutSec 5
  Write-Host "✅ Backend running"
} catch {
  Write-Host "❌ Backend not running on port 3000" -ForegroundColor Red
  exit 1
}

Write-Host "[2/6] Checking frontend..."
try {
  Invoke-WebRequest http://localhost:3001 -TimeoutSec 5 -UseBasicParsing | Out-Null
  Write-Host "✅ Frontend running"
} catch {
  Write-Host "❌ Frontend not running on port 3001" -ForegroundColor Red
  exit 1
}

Write-Host "[3/6] Testing login endpoint (capture cookie)..."
try {
  $null = Invoke-RestMethod -Method Post `
    -Uri "http://localhost:3000/api/auth/login" `
    -Body (@{ email="test@pod-factory.com"; password="dev-token-2024"} | ConvertTo-Json) `
    -ContentType "application/json" `
    -SessionVariable sess

  # Verify cookie exists
  $cookie = $sess.Cookies.GetCookies("http://localhost:3000") | Where-Object { $_.Name -eq "auth_token" }
  if (!$cookie) { throw "auth_token cookie not found after login" }

  Write-Host "✅ Login OK. Cookie captured: auth_token"
} catch {
  Write-Host "❌ Login failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-Host "[4/6] Testing factory run (authenticated)..."
try {
  $body = @{
    referenceImageId = "assets/references/USA250.jpg"
    generateCount = 1
    variationCount = 1
    autoApprove = $false
  } | ConvertTo-Json

  $factory = Invoke-RestMethod -Method Post `
    -Uri "http://localhost:3000/api/factory/run" `
    -ContentType "application/json" `
    -Body $body `
    -WebSession $sess

  $jobId = $factory.jobId
  if (!$jobId) { throw "No jobId returned" }
  Write-Host "✅ Factory started. JobId: $jobId"
} catch {
  Write-Host "❌ Factory run failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-Host "[5/6] Checking gallery..."
Start-Sleep -Seconds 10
try {
  $gallery = Invoke-RestMethod "http://localhost:3000/api/gallery/$jobId" -WebSession $sess
  if ($null -eq $gallery -or $gallery.Count -eq 0) {
    Write-Host "❌ No images found for job yet." -ForegroundColor Red
    exit 1
  }
  Write-Host "✅ Gallery returned $($gallery.Count) record(s)"
} catch {
  Write-Host "❌ Gallery endpoint failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-Host "[6/6] Basic smoke test complete"
Write-Host ""
Write-Host "🎉 BASIC SMOKE TEST PASSED!"
