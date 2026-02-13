$ErrorActionPreference = "Stop"

function Assert-Status([int]$Actual, [int[]]$Allowed, [string]$Label) {
  if ($Allowed -contains $Actual) {
    Write-Host ("[OK]   " + $Label + " -> " + $Actual) -ForegroundColor Green
    return
  }
  throw ("[FAIL] " + $Label + " -> unexpected status " + $Actual + " (allowed: " + ($Allowed -join ", ") + ")")
}

function Invoke-Status([string]$Url) {
  try {
    $res = Invoke-WebRequest -Uri $Url -MaximumRedirection 0 -UseBasicParsing -TimeoutSec 20
    return @{ status = [int]$res.StatusCode; location = $res.Headers["Location"] }
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      return @{ status = [int]$resp.StatusCode.value__; location = $resp.Headers["Location"] }
    }
    throw
  }
}

$devPort = 3000
$devUrl = "http://localhost:$devPort"
$proc = $null

try {
  Write-Host "Starting Next.js dev server..."
  $proc = Start-Process -FilePath npm.cmd -ArgumentList "run", "dev", "--", "-p", "$devPort" -PassThru

  Start-Sleep -Seconds 10

  $homeRes = Invoke-Status "$devUrl/"
  Assert-Status -Actual $homeRes.status -Allowed @(200) -Label "GET /"

  $login = Invoke-Status "$devUrl/login"
  Assert-Status -Actual $login.status -Allowed @(200) -Label "GET /login"

  $health = Invoke-Status "$devUrl/api/health"
  Assert-Status -Actual $health.status -Allowed @(200) -Label "GET /api/health"

  $member = Invoke-Status "$devUrl/member"
  Assert-Status -Actual $member.status -Allowed @(307, 308) -Label "GET /member (unauthenticated redirect)"
  if (-not $member.location -or -not ($member.location -like "/login*")) {
    throw "[FAIL] /member redirect location is not /login*"
  }
  Write-Host ("[OK]   /member redirect location -> " + $member.location) -ForegroundColor Green

  $frontdesk = Invoke-Status "$devUrl/frontdesk/checkin"
  Assert-Status -Actual $frontdesk.status -Allowed @(307, 308) -Label "GET /frontdesk/checkin (unauthenticated redirect)"

  Write-Host ""
  Write-Host "Smoke tests passed." -ForegroundColor Green
} finally {
  if ($proc -and -not $proc.HasExited) {
    try {
      Stop-Process -Id $proc.Id -Force
    } catch {}
  }
}
