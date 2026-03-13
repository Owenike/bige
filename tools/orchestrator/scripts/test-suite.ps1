param(
  [string]$Suite = "all"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $root
$repoRoot = Split-Path -Parent $projectRoot
$tsconfig = Join-Path $root "tsconfig.json"
$outDir = Join-Path $repoRoot ".tmp\orchestrator"

if (Test-Path $outDir) {
  Remove-Item -Path $outDir -Recurse -Force
}

npx tsc -p $tsconfig
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

$suiteMap = @{
  "unit" = @(
    "$outDir\tests\unit\schema-validation.test.js",
    "$outDir\tests\unit\policy-engine.test.js",
    "$outDir\tests\unit\planner-reviewer.test.js",
    "$outDir\tests\unit\state-machine.test.js",
    "$outDir\tests\unit\providers.test.js",
    "$outDir\tests\unit\storage-persistence.test.js"
  )
  "integration" = @(
    "$outDir\tests\integration\local-repo-executor.test.js"
  )
  "schema" = @(
    "$outDir\tests\unit\schema-validation.test.js"
  )
  "policy" = @(
    "$outDir\tests\unit\policy-engine.test.js",
    "$outDir\tests\unit\planner-reviewer.test.js"
  )
  "state-machine" = @(
    "$outDir\tests\unit\state-machine.test.js"
  )
  "providers" = @(
    "$outDir\tests\unit\providers.test.js"
  )
  "storage" = @(
    "$outDir\tests\unit\storage-persistence.test.js"
  )
  "mock-loop" = @(
    "$outDir\tests\e2e\mock-loop.test.js",
    "$outDir\tests\e2e\multi-iteration-loop.test.js"
  )
  "loop" = @(
    "$outDir\tests\e2e\multi-iteration-loop.test.js"
  )
  "all" = @(
    "$outDir\tests\unit\schema-validation.test.js",
    "$outDir\tests\unit\policy-engine.test.js",
    "$outDir\tests\unit\planner-reviewer.test.js",
    "$outDir\tests\unit\state-machine.test.js",
    "$outDir\tests\unit\providers.test.js",
    "$outDir\tests\unit\storage-persistence.test.js",
    "$outDir\tests\integration\local-repo-executor.test.js",
    "$outDir\tests\e2e\mock-loop.test.js",
    "$outDir\tests\e2e\multi-iteration-loop.test.js"
  )
}

$targets = $suiteMap[$Suite]
if (-not $targets) {
  throw "Unknown suite '$Suite'."
}

node --test $targets
exit $LASTEXITCODE
