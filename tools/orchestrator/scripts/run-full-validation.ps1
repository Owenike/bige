param()

$ErrorActionPreference = "Stop"
$testSuiteScript = Join-Path $PSScriptRoot "test-suite.ps1"

Write-Host "=== test:orchestrator:typecheck ==="
npx tsc -p tools/orchestrator/tsconfig.json --noEmit
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "=== test:orchestrator:lint ==="
npx eslint tools/orchestrator/src tools/orchestrator/tests
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

# Run the full orchestrator suite in one compiled pass to avoid repeated
# tsc rebuilds for each individual suite entry on Windows.
Write-Host "=== test:orchestrator:all ==="
& $testSuiteScript all
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
