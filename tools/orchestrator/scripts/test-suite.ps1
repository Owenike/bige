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
  $removed = $false
  for ($attempt = 0; $attempt -lt 3 -and -not $removed; $attempt += 1) {
    try {
      Remove-Item -Path $outDir -Recurse -Force -ErrorAction Stop
      $removed = $true
    } catch {
      if ($_.Exception -is [System.IO.DirectoryNotFoundException]) {
        $removed = $true
      } elseif ($attempt -lt 2) {
        Start-Sleep -Milliseconds 250
      } else {
        Write-Warning "Continuing without clearing $outDir because it is temporarily locked."
      }
    }
  }
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
    "$outDir\tests\unit\diagnostics.test.js",
    "$outDir\tests\unit\github-events.test.js",
    "$outDir\tests\unit\idempotency.test.js",
    "$outDir\tests\unit\status-reporting.test.js",
    "$outDir\tests\unit\trigger-policy.test.js",
    "$outDir\tests\unit\webhook.test.js",
    "$outDir\tests\unit\commands.test.js",
    "$outDir\tests\unit\signature.test.js",
    "$outDir\tests\unit\comment-upsert.test.js",
    "$outDir\tests\unit\event-flow.test.js",
    "$outDir\tests\unit\queue.test.js",
    "$outDir\tests\unit\worker.test.js",
    "$outDir\tests\unit\locking.test.js",
    "$outDir\tests\unit\recovery.test.js",
    "$outDir\tests\unit\backend-provider.test.js",
    "$outDir\tests\unit\cancellation.test.js",
    "$outDir\tests\unit\daemon.test.js",
    "$outDir\tests\unit\supervision.test.js",
    "$outDir\tests\unit\supabase-backend.test.js",
    "$outDir\tests\unit\remote-locking.test.js",
    "$outDir\tests\unit\backend-migration.test.js",
    "$outDir\tests\unit\remote-diagnostics.test.js",
    "$outDir\tests\unit\backend-transfer.test.js",
    "$outDir\tests\unit\multi-worker-remote.test.js",
    "$outDir\tests\unit\backend-health.test.js"
  )
  "integration" = @(
    "$outDir\tests\integration\local-repo-executor.test.js",
    "$outDir\tests\integration\live-acceptance.test.js",
    "$outDir\tests\integration\live-pass.test.js",
    "$outDir\tests\integration\supabase-live.test.js"
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
  "github-events" = @(
    "$outDir\tests\unit\github-events.test.js"
  )
  "idempotency" = @(
    "$outDir\tests\unit\idempotency.test.js"
  )
  "status-reporting" = @(
    "$outDir\tests\unit\status-reporting.test.js"
  )
  "trigger-policy" = @(
    "$outDir\tests\unit\trigger-policy.test.js"
  )
  "webhook" = @(
    "$outDir\tests\unit\webhook.test.js"
  )
  "commands" = @(
    "$outDir\tests\unit\commands.test.js"
  )
  "signature" = @(
    "$outDir\tests\unit\signature.test.js"
  )
  "comment-upsert" = @(
    "$outDir\tests\unit\comment-upsert.test.js"
  )
  "event-flow" = @(
    "$outDir\tests\unit\event-flow.test.js"
  )
  "queue" = @(
    "$outDir\tests\unit\queue.test.js"
  )
  "worker" = @(
    "$outDir\tests\unit\worker.test.js"
  )
  "locking" = @(
    "$outDir\tests\unit\locking.test.js"
  )
  "recovery" = @(
    "$outDir\tests\unit\recovery.test.js"
  )
  "backend-provider" = @(
    "$outDir\tests\unit\backend-provider.test.js"
  )
  "cancellation" = @(
    "$outDir\tests\unit\cancellation.test.js"
  )
  "daemon" = @(
    "$outDir\tests\unit\daemon.test.js"
  )
  "supervision" = @(
    "$outDir\tests\unit\supervision.test.js"
  )
  "supabase-backend" = @(
    "$outDir\tests\unit\supabase-backend.test.js"
  )
  "remote-locking" = @(
    "$outDir\tests\unit\remote-locking.test.js"
  )
  "backend-migration" = @(
    "$outDir\tests\unit\backend-migration.test.js"
  )
  "remote-diagnostics" = @(
    "$outDir\tests\unit\remote-diagnostics.test.js"
  )
  "backend-transfer" = @(
    "$outDir\tests\unit\backend-transfer.test.js"
  )
  "multi-worker-remote" = @(
    "$outDir\tests\unit\multi-worker-remote.test.js"
  )
  "backend-health" = @(
    "$outDir\tests\unit\backend-health.test.js"
  )
  "supabase-live" = @(
    "$outDir\tests\integration\supabase-live.test.js"
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
    "$outDir\tests\unit\github-events.test.js",
    "$outDir\tests\unit\idempotency.test.js",
    "$outDir\tests\unit\status-reporting.test.js",
    "$outDir\tests\unit\trigger-policy.test.js",
    "$outDir\tests\unit\webhook.test.js",
    "$outDir\tests\unit\commands.test.js",
    "$outDir\tests\unit\signature.test.js",
    "$outDir\tests\unit\comment-upsert.test.js",
    "$outDir\tests\unit\event-flow.test.js",
    "$outDir\tests\unit\queue.test.js",
    "$outDir\tests\unit\worker.test.js",
    "$outDir\tests\unit\locking.test.js",
    "$outDir\tests\unit\recovery.test.js",
    "$outDir\tests\unit\backend-provider.test.js",
    "$outDir\tests\unit\cancellation.test.js",
    "$outDir\tests\unit\daemon.test.js",
    "$outDir\tests\unit\supervision.test.js",
    "$outDir\tests\unit\supabase-backend.test.js",
    "$outDir\tests\unit\remote-locking.test.js",
    "$outDir\tests\unit\backend-migration.test.js",
    "$outDir\tests\unit\remote-diagnostics.test.js",
    "$outDir\tests\unit\backend-transfer.test.js",
    "$outDir\tests\unit\multi-worker-remote.test.js",
    "$outDir\tests\unit\backend-health.test.js",
    "$outDir\tests\integration\local-repo-executor.test.js",
    "$outDir\tests\integration\live-smoke.test.js",
    "$outDir\tests\integration\live-acceptance.test.js",
    "$outDir\tests\integration\live-pass.test.js",
    "$outDir\tests\integration\supabase-live.test.js",
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
