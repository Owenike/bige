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

$envFile = if ($env:PHASE22_ENV_FILE) { $env:PHASE22_ENV_FILE } elseif (Test-Path ".env.production.current") { ".env.production.current" } elseif (Test-Path ".env.preview.current") { ".env.preview.current" } else { ".env.preview" }
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

if (-not $env:PHASE22_BASE_URL) {
  $env:PHASE22_BASE_URL = "https://bige.vercel.app"
}

Write-Host "Target base URL: $($env:PHASE22_BASE_URL)"
node scripts/phase22-rerun-blackbox-e2e.cjs --base-url $env:PHASE22_BASE_URL --env-file $envFile
if ($LASTEXITCODE -ne 0) {
  throw "Blackbox E2E runner failed with exit code $LASTEXITCODE"
}
