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
    "$outDir\tests\unit\comment-targeting.test.js",
    "$outDir\tests\unit\reporting-readiness.test.js",
    "$outDir\tests\unit\github-live-comment.test.js",
    "$outDir\tests\unit\github-live-auth-smoke.test.js",
    "$outDir\tests\unit\github-live-auth-matrix.test.js",
    "$outDir\tests\unit\github-live-auth-success.test.js",
    "$outDir\tests\unit\github-live-targeting.test.js",
    "$outDir\tests\unit\github-sandbox-targets.test.js",
    "$outDir\tests\unit\github-live-auth-evidence.test.js",
    "$outDir\tests\unit\github-live-success-smoke.test.js",
    "$outDir\tests\unit\sandbox-profile-ops.test.js",
    "$outDir\tests\unit\live-report-runbook.test.js",
    "$outDir\tests\unit\sandbox-profile-lifecycle.test.js",
    "$outDir\tests\unit\live-auth-operator-flow.test.js",
    "$outDir\tests\unit\sandbox-default-selection.test.js",
    "$outDir\tests\unit\sandbox-governance.test.js",
    "$outDir\tests\unit\sandbox-audit.test.js",
    "$outDir\tests\unit\sandbox-guardrails.test.js",
    "$outDir\tests\unit\sandbox-policy-bundles.test.js",
    "$outDir\tests\unit\sandbox-profile-import-export.test.js",
    "$outDir\tests\unit\sandbox-change-review.test.js",
    "$outDir\tests\unit\sandbox-bundle-governance.test.js",
    "$outDir\tests\unit\sandbox-batch-change.test.js",
    "$outDir\tests\unit\sandbox-impact-summary.test.js",
    "$outDir\tests\unit\sandbox-restore-points.test.js",
    "$outDir\tests\unit\sandbox-rollback.test.js",
    "$outDir\tests\unit\sandbox-rollback-impact.test.js",
    "$outDir\tests\unit\sandbox-rollback-governance.test.js",
    "$outDir\tests\unit\sandbox-batch-recovery.test.js",
    "$outDir\tests\unit\sandbox-restore-retention.test.js",
    "$outDir\tests\unit\sandbox-history.test.js",
    "$outDir\tests\unit\sandbox-compare.test.js",
    "$outDir\tests\unit\sandbox-recovery-diagnostics.test.js",
    "$outDir\tests\unit\sandbox-incident-governance.test.js",
    "$outDir\tests\unit\sandbox-operator-actions.test.js",
    "$outDir\tests\unit\sandbox-escalation-summary.test.js",
    "$outDir\tests\unit\sandbox-governance-status.test.js",
    "$outDir\tests\unit\sandbox-incident-policy-matrix.test.js",
    "$outDir\tests\unit\sandbox-operator-handoff-summary.test.js",
    "$outDir\tests\unit\sandbox-resolution-readiness.test.js",
    "$outDir\tests\unit\sandbox-resolution-evidence-summary.test.js",
    "$outDir\tests\unit\sandbox-closure-gating.test.js",
    "$outDir\tests\unit\sandbox-resolution-audit-log.test.js",
    "$outDir\tests\unit\sandbox-closeout-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-operator-checklist.test.js",
    "$outDir\tests\unit\sandbox-resolution-audit-history.test.js",
    "$outDir\tests\unit\sandbox-closeout-review-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-review-queue.test.js",
    "$outDir\tests\unit\sandbox-closeout-review-actions.test.js",
    "$outDir\tests\unit\sandbox-closeout-disposition-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-review-lifecycle.test.js",
    "$outDir\tests\unit\sandbox-closeout-review-audit-trail.test.js",
    "$outDir\tests\unit\sandbox-closeout-review-history.test.js",
    "$outDir\tests\unit\sandbox-closeout-review-resolution-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-settlement-audit.test.js",
    "$outDir\tests\unit\sandbox-closeout-followup-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-followup-queue.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-audit.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-queue.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-history.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-resolution-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-carry-forward-queue.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-actions.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-disposition-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-lifecycle.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-decision-audit.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-decision-history.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-finalization-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-finalization-audit-history.test.js",
    "$outDir\tests\unit\sandbox-closeout-finalization-stability-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-post-finalization-followup-queue.test.js",
    "$outDir\tests\unit\sandbox-closeout-stability-drift.test.js",
    "$outDir\tests\unit\sandbox-closeout-reopen-recurrence.test.js",
    "$outDir\tests\unit\sandbox-closeout-stability-watchlist.test.js",
    "$outDir\tests\unit\sandbox-closeout-stability-recurrence-audit.test.js",
    "$outDir\tests\unit\sandbox-closeout-watchlist-resolution-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-watchlist-lifecycle.test.js",
    "$outDir\tests\unit\sandbox-closeout-watchlist-exit-audit.test.js",
    "$outDir\tests\unit\sandbox-closeout-watchlist-readd-history.test.js",
    "$outDir\tests\unit\sandbox-closeout-stability-recovery-summary.test.js",
    "$outDir\tests\unit\github-report-permissions.test.js",
    "$outDir\tests\unit\report-delivery-audit.test.js",
    "$outDir\tests\unit\reporting-operator-summary.test.js",
    "$outDir\tests\unit\trigger-policy.test.js",
    "$outDir\tests\unit\webhook.test.js",
    "$outDir\tests\unit\commands.test.js",
    "$outDir\tests\unit\signature.test.js",
    "$outDir\tests\unit\comment-upsert.test.js",
    "$outDir\tests\unit\event-flow.test.js",
    "$outDir\tests\unit\actor-policy.test.js",
    "$outDir\tests\unit\actor-policy-config.test.js",
    "$outDir\tests\unit\runtime-config.test.js",
    "$outDir\tests\unit\replay-protection.test.js",
    "$outDir\tests\unit\inbound-audit.test.js",
    "$outDir\tests\unit\github-live-report.test.js",
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
    "$outDir\tests\integration\supabase-live.test.js",
    "$outDir\tests\integration\webhook-server.test.js",
    "$outDir\tests\integration\webhook-runtime.test.js",
    "$outDir\tests\integration\webhook-hosting.test.js",
    "$outDir\tests\integration\graceful-shutdown.test.js"
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
  "comment-targeting" = @(
    "$outDir\tests\unit\comment-targeting.test.js"
  )
  "reporting-readiness" = @(
    "$outDir\tests\unit\reporting-readiness.test.js"
  )
  "github-live-comment" = @(
    "$outDir\tests\unit\github-live-comment.test.js"
  )
  "github-live-auth-smoke" = @(
    "$outDir\tests\unit\github-live-auth-smoke.test.js"
  )
  "github-live-auth-matrix" = @(
    "$outDir\tests\unit\github-live-auth-matrix.test.js"
  )
  "github-live-auth-success" = @(
    "$outDir\tests\unit\github-live-auth-success.test.js"
  )
  "github-live-targeting" = @(
    "$outDir\tests\unit\github-live-targeting.test.js"
  )
  "github-sandbox-targets" = @(
    "$outDir\tests\unit\github-sandbox-targets.test.js"
  )
  "github-live-auth-evidence" = @(
    "$outDir\tests\unit\github-live-auth-evidence.test.js"
  )
  "github-live-success-smoke" = @(
    "$outDir\tests\unit\github-live-success-smoke.test.js"
  )
  "sandbox-profile-ops" = @(
    "$outDir\tests\unit\sandbox-profile-ops.test.js"
  )
  "live-report-runbook" = @(
    "$outDir\tests\unit\live-report-runbook.test.js"
  )
  "sandbox-profile-lifecycle" = @(
    "$outDir\tests\unit\sandbox-profile-lifecycle.test.js"
  )
  "live-auth-operator-flow" = @(
    "$outDir\tests\unit\live-auth-operator-flow.test.js"
  )
  "sandbox-default-selection" = @(
    "$outDir\tests\unit\sandbox-default-selection.test.js"
  )
  "sandbox-governance" = @(
    "$outDir\tests\unit\sandbox-governance.test.js"
  )
  "sandbox-audit" = @(
    "$outDir\tests\unit\sandbox-audit.test.js"
  )
  "sandbox-guardrails" = @(
    "$outDir\tests\unit\sandbox-guardrails.test.js"
  )
  "sandbox-policy-bundles" = @(
    "$outDir\tests\unit\sandbox-policy-bundles.test.js"
  )
  "sandbox-profile-import-export" = @(
    "$outDir\tests\unit\sandbox-profile-import-export.test.js"
  )
  "sandbox-change-review" = @(
    "$outDir\tests\unit\sandbox-change-review.test.js"
  )
  "sandbox-bundle-governance" = @(
    "$outDir\tests\unit\sandbox-bundle-governance.test.js"
  )
  "sandbox-batch-change" = @(
    "$outDir\tests\unit\sandbox-batch-change.test.js"
  )
  "sandbox-impact-summary" = @(
    "$outDir\tests\unit\sandbox-impact-summary.test.js"
  )
  "sandbox-restore-points" = @(
    "$outDir\tests\unit\sandbox-restore-points.test.js"
  )
  "sandbox-rollback" = @(
    "$outDir\tests\unit\sandbox-rollback.test.js"
  )
  "sandbox-rollback-impact" = @(
    "$outDir\tests\unit\sandbox-rollback-impact.test.js"
  )
  "sandbox-rollback-governance" = @(
    "$outDir\tests\unit\sandbox-rollback-governance.test.js"
  )
  "sandbox-batch-recovery" = @(
    "$outDir\tests\unit\sandbox-batch-recovery.test.js"
  )
  "sandbox-restore-retention" = @(
    "$outDir\tests\unit\sandbox-restore-retention.test.js"
  )
  "sandbox-history" = @(
    "$outDir\tests\unit\sandbox-history.test.js"
  )
  "sandbox-compare" = @(
    "$outDir\tests\unit\sandbox-compare.test.js"
  )
  "sandbox-recovery-diagnostics" = @(
    "$outDir\tests\unit\sandbox-recovery-diagnostics.test.js"
  )
  "sandbox-incident-governance" = @(
    "$outDir\tests\unit\sandbox-incident-governance.test.js"
  )
  "sandbox-operator-actions" = @(
    "$outDir\tests\unit\sandbox-operator-actions.test.js"
  )
  "sandbox-escalation-summary" = @(
    "$outDir\tests\unit\sandbox-escalation-summary.test.js"
  )
  "sandbox-governance-status" = @(
    "$outDir\tests\unit\sandbox-governance-status.test.js"
  )
  "sandbox-incident-policy-matrix" = @(
    "$outDir\tests\unit\sandbox-incident-policy-matrix.test.js"
  )
  "sandbox-operator-handoff-summary" = @(
    "$outDir\tests\unit\sandbox-operator-handoff-summary.test.js"
  )
  "sandbox-resolution-readiness" = @(
    "$outDir\tests\unit\sandbox-resolution-readiness.test.js"
  )
  "sandbox-resolution-evidence-summary" = @(
    "$outDir\tests\unit\sandbox-resolution-evidence-summary.test.js"
  )
  "sandbox-closure-gating" = @(
    "$outDir\tests\unit\sandbox-closure-gating.test.js"
  )
  "sandbox-resolution-audit-log" = @(
    "$outDir\tests\unit\sandbox-resolution-audit-log.test.js"
  )
  "sandbox-closeout-summary" = @(
    "$outDir\tests\unit\sandbox-closeout-summary.test.js"
  )
  "sandbox-closeout-operator-checklist" = @(
    "$outDir\tests\unit\sandbox-closeout-operator-checklist.test.js"
  )
  "sandbox-resolution-audit-history" = @(
    "$outDir\tests\unit\sandbox-resolution-audit-history.test.js"
  )
  "sandbox-closeout-review-summary" = @(
    "$outDir\tests\unit\sandbox-closeout-review-summary.test.js"
  )
  "sandbox-closeout-review-queue" = @(
    "$outDir\tests\unit\sandbox-closeout-review-queue.test.js"
  )
  "sandbox-closeout-review-actions" = @(
    "$outDir\tests\unit\sandbox-closeout-review-actions.test.js"
  )
  "sandbox-closeout-disposition-summary" = @(
    "$outDir\tests\unit\sandbox-closeout-disposition-summary.test.js"
  )
  "sandbox-closeout-review-lifecycle" = @(
    "$outDir\tests\unit\sandbox-closeout-review-lifecycle.test.js"
  )
  "sandbox-closeout-review-audit-trail" = @(
    "$outDir\tests\unit\sandbox-closeout-review-audit-trail.test.js"
  )
  "sandbox-closeout-review-history" = @(
    "$outDir\tests\unit\sandbox-closeout-review-history.test.js"
  )
  "sandbox-closeout-review-resolution-summary" = @(
    "$outDir\tests\unit\sandbox-closeout-review-resolution-summary.test.js"
  )
  "sandbox-closeout-settlement-audit" = @(
    "$outDir\tests\unit\sandbox-closeout-settlement-audit.test.js"
  )
  "sandbox-closeout-followup-summary" = @(
    "$outDir\tests\unit\sandbox-closeout-followup-summary.test.js"
  )
  "sandbox-closeout-followup-queue" = @(
    "$outDir\tests\unit\sandbox-closeout-followup-queue.test.js"
  )
  "sandbox-closeout-completion-audit" = @(
    "$outDir\tests\unit\sandbox-closeout-completion-audit.test.js"
  )
  "sandbox-closeout-completion-summary" = @(
    "$outDir\tests\unit\sandbox-closeout-completion-summary.test.js"
  )
  "sandbox-closeout-completion-queue" = @(
    "$outDir\tests\unit\sandbox-closeout-completion-queue.test.js"
  )
  "sandbox-closeout-completion-history" = @(
    "$outDir\tests\unit\sandbox-closeout-completion-history.test.js"
  )
  "sandbox-closeout-completion-resolution-summary" = @(
    "$outDir\tests\unit\sandbox-closeout-completion-resolution-summary.test.js"
  )
  "sandbox-closeout-completion-carry-forward-queue" = @(
    "$outDir\tests\unit\sandbox-closeout-completion-carry-forward-queue.test.js"
  )
  "sandbox-closeout-completion-actions" = @(
    "$outDir\tests\unit\sandbox-closeout-completion-actions.test.js"
  )
  "sandbox-closeout-completion-disposition-summary" = @(
    "$outDir\tests\unit\sandbox-closeout-completion-disposition-summary.test.js"
  )
  "sandbox-closeout-completion-lifecycle" = @(
    "$outDir\tests\unit\sandbox-closeout-completion-lifecycle.test.js"
  )
  "sandbox-closeout-completion-decision-audit" = @(
    "$outDir\tests\unit\sandbox-closeout-completion-decision-audit.test.js"
  )
  "sandbox-closeout-completion-decision-history" = @(
    "$outDir\tests\unit\sandbox-closeout-completion-decision-history.test.js"
  )
  "sandbox-closeout-completion-finalization-summary" = @(
    "$outDir\tests\unit\sandbox-closeout-completion-finalization-summary.test.js"
  )
  "sandbox-closeout-finalization-audit-history" = @(
    "$outDir\tests\unit\sandbox-closeout-finalization-audit-history.test.js"
  )
  "sandbox-closeout-finalization-stability-summary" = @(
    "$outDir\tests\unit\sandbox-closeout-finalization-stability-summary.test.js"
  )
  "sandbox-closeout-post-finalization-followup-queue" = @(
    "$outDir\tests\unit\sandbox-closeout-post-finalization-followup-queue.test.js"
  )
  "sandbox-closeout-stability-drift" = @(
    "$outDir\tests\unit\sandbox-closeout-stability-drift.test.js"
  )
  "sandbox-closeout-reopen-recurrence" = @(
    "$outDir\tests\unit\sandbox-closeout-reopen-recurrence.test.js"
  )
  "sandbox-closeout-stability-watchlist" = @(
    "$outDir\tests\unit\sandbox-closeout-stability-watchlist.test.js"
  )
  "sandbox-closeout-stability-recurrence-audit" = @(
    "$outDir\tests\unit\sandbox-closeout-stability-recurrence-audit.test.js"
  )
  "sandbox-closeout-watchlist-resolution-summary" = @(
    "$outDir\tests\unit\sandbox-closeout-watchlist-resolution-summary.test.js"
  )
  "sandbox-closeout-watchlist-lifecycle" = @(
    "$outDir\tests\unit\sandbox-closeout-watchlist-lifecycle.test.js"
  )
  "sandbox-closeout-watchlist-exit-audit" = @(
    "$outDir\tests\unit\sandbox-closeout-watchlist-exit-audit.test.js"
  )
  "sandbox-closeout-watchlist-readd-history" = @(
    "$outDir\tests\unit\sandbox-closeout-watchlist-readd-history.test.js"
  )
  "sandbox-closeout-stability-recovery-summary" = @(
    "$outDir\tests\unit\sandbox-closeout-stability-recovery-summary.test.js"
  )
  "github-report-permissions" = @(
    "$outDir\tests\unit\github-report-permissions.test.js"
  )
  "report-delivery-audit" = @(
    "$outDir\tests\unit\report-delivery-audit.test.js"
  )
  "reporting-operator-summary" = @(
    "$outDir\tests\unit\reporting-operator-summary.test.js"
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
  "webhook-server" = @(
    "$outDir\tests\integration\webhook-server.test.js"
  )
  "actor-policy" = @(
    "$outDir\tests\unit\actor-policy.test.js"
  )
  "actor-policy-config" = @(
    "$outDir\tests\unit\actor-policy-config.test.js"
  )
  "runtime-config" = @(
    "$outDir\tests\unit\runtime-config.test.js"
  )
  "replay-protection" = @(
    "$outDir\tests\unit\replay-protection.test.js"
  )
  "inbound-audit" = @(
    "$outDir\tests\unit\inbound-audit.test.js"
  )
  "github-live-report" = @(
    "$outDir\tests\unit\github-live-report.test.js"
  )
  "webhook-runtime" = @(
    "$outDir\tests\integration\webhook-runtime.test.js"
  )
  "webhook-hosting" = @(
    "$outDir\tests\integration\webhook-hosting.test.js"
  )
  "graceful-shutdown" = @(
    "$outDir\tests\integration\graceful-shutdown.test.js"
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
    "$outDir\tests\unit\comment-targeting.test.js",
    "$outDir\tests\unit\reporting-readiness.test.js",
    "$outDir\tests\unit\github-live-comment.test.js",
    "$outDir\tests\unit\github-live-auth-smoke.test.js",
    "$outDir\tests\unit\github-live-auth-matrix.test.js",
    "$outDir\tests\unit\github-live-auth-success.test.js",
    "$outDir\tests\unit\github-live-targeting.test.js",
    "$outDir\tests\unit\github-sandbox-targets.test.js",
    "$outDir\tests\unit\github-live-auth-evidence.test.js",
    "$outDir\tests\unit\github-live-success-smoke.test.js",
    "$outDir\tests\unit\sandbox-profile-ops.test.js",
    "$outDir\tests\unit\live-report-runbook.test.js",
    "$outDir\tests\unit\sandbox-profile-lifecycle.test.js",
    "$outDir\tests\unit\live-auth-operator-flow.test.js",
    "$outDir\tests\unit\sandbox-default-selection.test.js",
    "$outDir\tests\unit\sandbox-governance.test.js",
    "$outDir\tests\unit\sandbox-audit.test.js",
    "$outDir\tests\unit\sandbox-guardrails.test.js",
    "$outDir\tests\unit\sandbox-policy-bundles.test.js",
    "$outDir\tests\unit\sandbox-profile-import-export.test.js",
    "$outDir\tests\unit\sandbox-change-review.test.js",
    "$outDir\tests\unit\sandbox-bundle-governance.test.js",
    "$outDir\tests\unit\sandbox-batch-change.test.js",
    "$outDir\tests\unit\sandbox-impact-summary.test.js",
    "$outDir\tests\unit\sandbox-restore-points.test.js",
    "$outDir\tests\unit\sandbox-rollback.test.js",
    "$outDir\tests\unit\sandbox-rollback-impact.test.js",
    "$outDir\tests\unit\sandbox-rollback-governance.test.js",
    "$outDir\tests\unit\sandbox-batch-recovery.test.js",
    "$outDir\tests\unit\sandbox-restore-retention.test.js",
    "$outDir\tests\unit\sandbox-history.test.js",
    "$outDir\tests\unit\sandbox-compare.test.js",
    "$outDir\tests\unit\sandbox-recovery-diagnostics.test.js",
    "$outDir\tests\unit\sandbox-incident-governance.test.js",
    "$outDir\tests\unit\sandbox-operator-actions.test.js",
    "$outDir\tests\unit\sandbox-escalation-summary.test.js",
    "$outDir\tests\unit\sandbox-governance-status.test.js",
    "$outDir\tests\unit\sandbox-incident-policy-matrix.test.js",
    "$outDir\tests\unit\sandbox-operator-handoff-summary.test.js",
    "$outDir\tests\unit\sandbox-resolution-readiness.test.js",
    "$outDir\tests\unit\sandbox-resolution-evidence-summary.test.js",
    "$outDir\tests\unit\sandbox-closure-gating.test.js",
    "$outDir\tests\unit\sandbox-resolution-audit-log.test.js",
    "$outDir\tests\unit\sandbox-closeout-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-operator-checklist.test.js",
    "$outDir\tests\unit\sandbox-resolution-audit-history.test.js",
    "$outDir\tests\unit\sandbox-closeout-review-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-review-queue.test.js",
    "$outDir\tests\unit\sandbox-closeout-review-actions.test.js",
    "$outDir\tests\unit\sandbox-closeout-disposition-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-review-lifecycle.test.js",
    "$outDir\tests\unit\sandbox-closeout-review-audit-trail.test.js",
    "$outDir\tests\unit\sandbox-closeout-review-history.test.js",
    "$outDir\tests\unit\sandbox-closeout-review-resolution-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-settlement-audit.test.js",
    "$outDir\tests\unit\sandbox-closeout-followup-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-followup-queue.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-audit.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-queue.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-history.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-resolution-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-carry-forward-queue.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-actions.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-disposition-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-lifecycle.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-decision-audit.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-decision-history.test.js",
    "$outDir\tests\unit\sandbox-closeout-completion-finalization-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-finalization-audit-history.test.js",
    "$outDir\tests\unit\sandbox-closeout-finalization-stability-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-post-finalization-followup-queue.test.js",
    "$outDir\tests\unit\sandbox-closeout-stability-drift.test.js",
    "$outDir\tests\unit\sandbox-closeout-reopen-recurrence.test.js",
    "$outDir\tests\unit\sandbox-closeout-stability-watchlist.test.js",
    "$outDir\tests\unit\sandbox-closeout-stability-recurrence-audit.test.js",
    "$outDir\tests\unit\sandbox-closeout-watchlist-resolution-summary.test.js",
    "$outDir\tests\unit\sandbox-closeout-watchlist-lifecycle.test.js",
    "$outDir\tests\unit\sandbox-closeout-watchlist-exit-audit.test.js",
    "$outDir\tests\unit\sandbox-closeout-watchlist-readd-history.test.js",
    "$outDir\tests\unit\sandbox-closeout-stability-recovery-summary.test.js",
    "$outDir\tests\unit\github-report-permissions.test.js",
    "$outDir\tests\unit\report-delivery-audit.test.js",
    "$outDir\tests\unit\reporting-operator-summary.test.js",
    "$outDir\tests\unit\trigger-policy.test.js",
    "$outDir\tests\unit\webhook.test.js",
    "$outDir\tests\unit\commands.test.js",
    "$outDir\tests\unit\signature.test.js",
    "$outDir\tests\unit\comment-upsert.test.js",
    "$outDir\tests\unit\event-flow.test.js",
    "$outDir\tests\unit\actor-policy.test.js",
    "$outDir\tests\unit\actor-policy-config.test.js",
    "$outDir\tests\unit\runtime-config.test.js",
    "$outDir\tests\unit\replay-protection.test.js",
    "$outDir\tests\unit\inbound-audit.test.js",
    "$outDir\tests\unit\github-live-report.test.js",
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
    "$outDir\tests\integration\webhook-server.test.js",
    "$outDir\tests\integration\webhook-runtime.test.js",
    "$outDir\tests\integration\webhook-hosting.test.js",
    "$outDir\tests\integration\graceful-shutdown.test.js",
    "$outDir\tests\e2e\mock-loop.test.js",
    "$outDir\tests\e2e\multi-iteration-loop.test.js"
  )
}

$targets = $suiteMap[$Suite]
if (-not $targets) {
  throw "Unknown suite '$Suite'."
}

# Keep the Node test runner single-threaded to reduce Windows sandbox flakiness.
node --test --test-concurrency=1 $targets
exit $LASTEXITCODE
