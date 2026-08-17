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

function Normalize-Location([object]$Location) {
  if ($null -eq $Location) { return $null }
  if ($Location -is [System.Array]) {
    if ($Location.Length -eq 0) { return $null }
    return [string]$Location[0]
  }
  return [string]$Location
}

$devPort = 3000
$devUrl = "http://localhost:$devPort"
$proc = $null
$startupTimeoutSeconds = 60
$workspacePath = (Get-Location).Path
$smokeLogDir = Join-Path $workspacePath ".tmp\smoke-test"
$stdoutLog = Join-Path $smokeLogDir "dev-server.stdout.log"
$stderrLog = Join-Path $smokeLogDir "dev-server.stderr.log"

function Write-DevServerLogs {
  if (Test-Path -LiteralPath $stdoutLog) {
    Get-Content -LiteralPath $stdoutLog | Write-Host
  }
  if (Test-Path -LiteralPath $stderrLog) {
    Get-Content -LiteralPath $stderrLog | Write-Host
  }
}

try {
  Write-Host "Starting Next.js dev server..."
  New-Item -ItemType Directory -Path $smokeLogDir -Force | Out-Null
  Remove-Item -LiteralPath $stdoutLog, $stderrLog -Force -ErrorAction SilentlyContinue
  $proc = Start-Process -FilePath "$env:ComSpec" -ArgumentList "/d", "/s", "/c", "`"npm.cmd run dev -- -p $devPort`"" -WorkingDirectory $workspacePath -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru -WindowStyle Hidden

  $ready = $false
  $deadline = (Get-Date).AddSeconds($startupTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) {
      Write-DevServerLogs
      throw "[FAIL] Next.js dev server exited before becoming ready (exit code: $($proc.ExitCode))"
    }

    try {
      $probe = Invoke-WebRequest -Uri "$devUrl/api/health" -UseBasicParsing -TimeoutSec 2
      if ([int]$probe.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  if (-not $ready) {
    Write-DevServerLogs
    throw "[FAIL] Next.js dev server did not become ready within $startupTimeoutSeconds seconds"
  }

  $homeRes = Invoke-Status "$devUrl/"
  Assert-Status -Actual $homeRes.status -Allowed @(200) -Label "GET /"

  $login = Invoke-Status "$devUrl/login"
  Assert-Status -Actual $login.status -Allowed @(200, 307, 308) -Label "GET /login"

  if ($login.status -eq 307 -or $login.status -eq 308) {
    $loginLocation = Normalize-Location $login.location
    $isStaffLoginRedirect = $loginLocation -eq "/login/staff" -or $loginLocation -like "*/login/staff"
    if (-not $isStaffLoginRedirect) {
      throw "[FAIL] /login redirect location is not /login/staff"
    }
    Write-Host ("[OK]   /login redirect location -> " + $loginLocation) -ForegroundColor Green
  }

  $health = Invoke-Status "$devUrl/api/health"
  Assert-Status -Actual $health.status -Allowed @(200) -Label "GET /api/health"

  $member = Invoke-Status "$devUrl/member"
  Assert-Status -Actual $member.status -Allowed @(200, 307, 308) -Label "GET /member (fail-open or unauthenticated redirect)"

  if ($member.status -eq 307 -or $member.status -eq 308) {
    $memberLocation = Normalize-Location $member.location
    $memberLocationText = if ($memberLocation) { $memberLocation } else { "<null>" }
    Write-Host ("[INFO] /member redirect raw location -> " + $memberLocationText)
    $isAllowedProtectedRedirect = $false
    if ($memberLocation) {
      $loc = $memberLocation
      if ($loc -like "/login*" -or $loc -like "*/login*" -or $loc -eq "/forbidden" -or $loc -like "*/forbidden") {
        $isAllowedProtectedRedirect = $true
      } else {
        try {
          $uri = [Uri]$loc
          if ($uri.AbsolutePath -eq "/login" -or $uri.AbsolutePath -eq "/forbidden") { $isAllowedProtectedRedirect = $true }
        } catch {}
      }
    }
    if (-not $isAllowedProtectedRedirect) {
      throw "[FAIL] /member redirect location is not /login* or /forbidden"
    }
    Write-Host ("[OK]   /member redirect location -> " + $memberLocation) -ForegroundColor Green
  } else {
    Write-Host "[INFO] /member is fail-open (status 200), redirect check skipped."
  }

  $frontdesk = Invoke-Status "$devUrl/frontdesk/checkin"
  Assert-Status -Actual $frontdesk.status -Allowed @(200, 307, 308) -Label "GET /frontdesk/checkin (fail-open or unauthenticated redirect)"

  Write-Host ""
  Write-Host "Smoke tests passed." -ForegroundColor Green
} finally {
  if ($proc -and -not $proc.HasExited) {
    try {
      & "$env:SystemRoot\System32\taskkill.exe" /PID $proc.Id /T /F | Out-Null
    } catch {
      try {
        Stop-Process -Id $proc.Id -Force
      } catch {}
    }
  }
  Start-Sleep -Milliseconds 250
  Remove-Item -LiteralPath $smokeLogDir -Recurse -Force -ErrorAction SilentlyContinue
}
