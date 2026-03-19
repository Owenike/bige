$ErrorActionPreference = "Stop"

function Import-DotEnv {
  param([string]$Path)
  if (!(Test-Path -LiteralPath $Path)) { return }
  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $name = $line.Substring(0, $idx).Trim()
    $value = $line.Substring($idx + 1)
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item -Path "Env:$name" -Value $value
  }
}

$envFile = if ($env:PHASE42_ENV_FILE) { $env:PHASE42_ENV_FILE } elseif (Test-Path ".env.production.current") { ".env.production.current" } elseif (Test-Path ".env.preview.current") { ".env.preview.current" } else { ".env.preview" }
Write-Host "Using env file: $envFile"
Import-DotEnv $envFile
Import-DotEnv ".env.local"

if (-not $env:NEXT_PUBLIC_SUPABASE_URL -and $env:SUPABASE_URL) {
  $env:NEXT_PUBLIC_SUPABASE_URL = $env:SUPABASE_URL
}

$required = @("NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY")
$missing = @()
foreach ($name in $required) {
  if (-not (Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue)) {
    $missing += $name
  }
}
if ($missing.Count -gt 0) {
  throw "Missing env: $($missing -join ', ')"
}

if (-not $env:PHASE42_ANALYTICS_BASE_URL) {
  if ($env:PHASE42_BASE_URL) {
    $env:PHASE42_ANALYTICS_BASE_URL = $env:PHASE42_BASE_URL
  } elseif ($env:NEXT_PUBLIC_APP_URL) {
    $env:PHASE42_ANALYTICS_BASE_URL = $env:NEXT_PUBLIC_APP_URL
  } else {
    throw "Missing PHASE42_ANALYTICS_BASE_URL or NEXT_PUBLIC_APP_URL. Refusing to default to an unrelated deployment."
  }
}

if (-not $env:PHASE42_ANALYTICS_VERCEL_BYPASS_SECRET) {
  if ($env:PHASE42_VERCEL_BYPASS_SECRET) {
    $env:PHASE42_ANALYTICS_VERCEL_BYPASS_SECRET = $env:PHASE42_VERCEL_BYPASS_SECRET
  } elseif ($env:VERCEL_AUTOMATION_BYPASS_SECRET) {
    $env:PHASE42_ANALYTICS_VERCEL_BYPASS_SECRET = $env:VERCEL_AUTOMATION_BYPASS_SECRET
  }
}

Write-Host "Target base URL: $($env:PHASE42_ANALYTICS_BASE_URL)"
$bypassEnabled = [bool]$env:PHASE42_ANALYTICS_VERCEL_BYPASS_SECRET
Write-Host "Bypass secret provided: $bypassEnabled"

$nodeArgs = @(
  "scripts/phase42-analytics-rollup-blackbox-e2e.cjs",
  "--base-url", $env:PHASE42_ANALYTICS_BASE_URL,
  "--env-file", $envFile
)
if ($bypassEnabled) {
  $nodeArgs += @("--bypass-secret", $env:PHASE42_ANALYTICS_VERCEL_BYPASS_SECRET)
}

node @nodeArgs
if ($LASTEXITCODE -ne 0) {
  throw "Phase42 analytics rollup blackbox E2E runner failed with exit code $LASTEXITCODE"
}
