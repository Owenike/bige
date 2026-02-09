param(
  [string]$ProjectRef = "",
  [string]$DbUrl = "",
  [switch]$SkipLink,
  [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Resolve-SupabaseRunner {
  if (Get-Command "supabase" -ErrorAction SilentlyContinue) {
    return @{ Exe = "supabase"; Prefix = @() }
  }
  if (Get-Command "npx" -ErrorAction SilentlyContinue) {
    return @{ Exe = "npx"; Prefix = @("--yes", "supabase") }
  }
  throw "Required command not found: supabase (or npx fallback)"
}

function Run-Step {
  param([string]$Title, [scriptblock]$Action)
  Write-Host "`n=== $Title ===" -ForegroundColor Cyan
  & $Action
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][string[]]$Args
  )
  & $Exe @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed ($Exe $($Args -join ' ')) with exit code $LASTEXITCODE"
  }
}

$SupabaseRunner = Resolve-SupabaseRunner

if (-not $SkipLink -and $ProjectRef) {
  Run-Step "Link Supabase Project ($ProjectRef)" {
    Invoke-External -Exe $SupabaseRunner.Exe -Args ($SupabaseRunner.Prefix + @("link", "--project-ref", $ProjectRef))
  }
}

Run-Step "Apply Migrations (supabase db push)" {
  Invoke-External -Exe $SupabaseRunner.Exe -Args ($SupabaseRunner.Prefix + @("db", "push"))
}

if ($SkipChecks) {
  Write-Host "`nPost-migration checks skipped (--SkipChecks)." -ForegroundColor Yellow
  exit 0
}

$resolvedDbUrl = $DbUrl
if (-not $resolvedDbUrl) {
  if ($env:SUPABASE_DB_URL) {
    $resolvedDbUrl = $env:SUPABASE_DB_URL
  } elseif ($env:DATABASE_URL) {
    $resolvedDbUrl = $env:DATABASE_URL
  }
}

if (-not $resolvedDbUrl) {
  Write-Host "`nMigrations applied, but post-checks were not executed." -ForegroundColor Yellow
  Write-Host "Set -DbUrl (or SUPABASE_DB_URL / DATABASE_URL) to run supabase/post_migration_checks.sql." -ForegroundColor Yellow
  exit 0
}

Require-Command "psql"
Run-Step "Run Post-Migration Checks" {
  Invoke-External -Exe "psql" -Args @("$resolvedDbUrl", "-v", "ON_ERROR_STOP=1", "-f", "supabase/post_migration_checks.sql")
}

Write-Host "`nDone: migrations applied and post-checks executed." -ForegroundColor Green
