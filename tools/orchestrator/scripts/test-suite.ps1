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
    "$outDir\tests\unit\storage-persistence.test.js",
    "$outDir\tests\unit\executor-provider.test.js",
    "$outDir\tests\unit\workspace.test.js",
    "$outDir\tests\unit\patch-flow.test.js",
    "$outDir\tests\unit\promotion.test.js",
    "$outDir\tests\unit\promotion-branch.test.js",
    "$outDir\tests\unit\artifacts.test.js",
    "$outDir\tests\unit\cleanup.test.js",
    "$outDir\tests\unit\handoff.test.js",
    "$outDir\tests\unit\pr-draft.test.js",
    "$outDir\tests\unit\audit.test.js",
    "$outDir\tests\unit\github-handoff.test.js",
    "$outDir\tests\unit\promotion-config.test.js",
    "$outDir\tests\unit\live-evidence.test.js",
    "$outDir\tests\unit\retention-config.test.js",
    "$outDir\tests\unit\preflight.test.js",
    "$outDir\tests\unit\profiles.test.js",
    "$outDir\tests\unit\diagnostics.test.js"
  )
  "integration" = @(
    "$outDir\tests\integration\local-repo-executor.test.js",
    "$outDir\tests\integration\live-acceptance.test.js",
    "$outDir\tests\integration\live-pass.test.js"
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
  "executor-provider" = @(
    "$outDir\tests\unit\executor-provider.test.js"
  )
  "storage" = @(
    "$outDir\tests\unit\storage-persistence.test.js"
  )
  "workspace" = @(
    "$outDir\tests\unit\workspace.test.js"
  )
  "patch-flow" = @(
    "$outDir\tests\unit\patch-flow.test.js"
  )
  "promotion" = @(
    "$outDir\tests\unit\promotion.test.js"
  )
  "promotion-branch" = @(
    "$outDir\tests\unit\promotion-branch.test.js"
  )
  "artifacts" = @(
    "$outDir\tests\unit\artifacts.test.js"
  )
  "cleanup" = @(
    "$outDir\tests\unit\cleanup.test.js"
  )
  "handoff" = @(
    "$outDir\tests\unit\handoff.test.js"
  )
  "pr-draft" = @(
    "$outDir\tests\unit\pr-draft.test.js"
  )
  "audit" = @(
    "$outDir\tests\unit\audit.test.js"
  )
  "github-handoff" = @(
    "$outDir\tests\unit\github-handoff.test.js"
  )
  "promotion-config" = @(
    "$outDir\tests\unit\promotion-config.test.js"
  )
  "live-evidence" = @(
    "$outDir\tests\unit\live-evidence.test.js"
  )
  "retention-config" = @(
    "$outDir\tests\unit\retention-config.test.js"
  )
  "preflight" = @(
    "$outDir\tests\unit\preflight.test.js"
  )
  "profiles" = @(
    "$outDir\tests\unit\profiles.test.js"
  )
  "diagnostics" = @(
    "$outDir\tests\unit\diagnostics.test.js"
  )
  "live-smoke" = @(
    "$outDir\tests\integration\live-smoke.test.js"
  )
  "live-acceptance" = @(
    "$outDir\tests\integration\live-acceptance.test.js"
  )
  "live-pass" = @(
    "$outDir\tests\integration\live-pass.test.js"
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
    "$outDir\tests\unit\executor-provider.test.js",
    "$outDir\tests\unit\workspace.test.js",
    "$outDir\tests\unit\patch-flow.test.js",
    "$outDir\tests\unit\promotion.test.js",
    "$outDir\tests\unit\promotion-branch.test.js",
    "$outDir\tests\unit\artifacts.test.js",
    "$outDir\tests\unit\cleanup.test.js",
    "$outDir\tests\unit\handoff.test.js",
    "$outDir\tests\unit\pr-draft.test.js",
    "$outDir\tests\unit\audit.test.js",
    "$outDir\tests\unit\github-handoff.test.js",
    "$outDir\tests\unit\promotion-config.test.js",
    "$outDir\tests\unit\live-evidence.test.js",
    "$outDir\tests\unit\retention-config.test.js",
    "$outDir\tests\unit\preflight.test.js",
    "$outDir\tests\unit\profiles.test.js",
    "$outDir\tests\unit\diagnostics.test.js",
    "$outDir\tests\integration\local-repo-executor.test.js",
    "$outDir\tests\integration\live-smoke.test.js",
    "$outDir\tests\integration\live-acceptance.test.js",
    "$outDir\tests\integration\live-pass.test.js",
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
