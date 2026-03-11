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

if (-not $env:JOB_RERUN_PREVIEW_SECRET) {
  $env:JOB_RERUN_PREVIEW_SECRET = "phase22-local-$([guid]::NewGuid().ToString('N'))$([guid]::NewGuid().ToString('N'))"
}

if ($env:JOB_RERUN_PREVIEW_SECRET.Length -lt 16) {
  throw "JOB_RERUN_PREVIEW_SECRET must be at least 16 chars"
}
if ($env:CRON_SECRET -and ($env:JOB_RERUN_PREVIEW_SECRET -eq $env:CRON_SECRET)) {
  throw "JOB_RERUN_PREVIEW_SECRET must not equal CRON_SECRET"
}

$tmpOut = ".tmp/phase22-route"
if (Test-Path $tmpOut) {
  Remove-Item -Path $tmpOut -Recurse -Force
}

npx tsc --pretty false --module commonjs --target es2020 --moduleResolution node --esModuleInterop --skipLibCheck --resolveJsonModule --jsx react-jsx --outDir $tmpOut app/api/platform/jobs/rerun/route.ts
if ($LASTEXITCODE -ne 0) {
  throw "Compile route handler failed with exit code $LASTEXITCODE"
}

$env:PHASE22_RERUN_ROUTE_MODULE = ".tmp/phase22-route/app/api/platform/jobs/rerun/route.js"
$env:PHASE22_ENV_FILE = $envFile

try {
  node scripts/phase22-rerun-e2e.cjs
  if ($LASTEXITCODE -ne 0) {
    throw "E2E runner failed with exit code $LASTEXITCODE"
  }
} finally {
  if (Test-Path $tmpOut) {
    Remove-Item -Path $tmpOut -Recurse -Force -ErrorAction SilentlyContinue
  }
}
