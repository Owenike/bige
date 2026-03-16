param()

$ErrorActionPreference = "Stop"
$testSuiteScript = Join-Path $PSScriptRoot "test-suite.ps1"

$scripts = @(
  "test:orchestrator:typecheck",
  "test:orchestrator:lint",
  "test:orchestrator:sandbox-history",
  "test:orchestrator:sandbox-compare",
  "test:orchestrator:sandbox-recovery-diagnostics",
  "test:orchestrator:sandbox-incident-governance",
  "test:orchestrator:sandbox-operator-actions",
  "test:orchestrator:sandbox-escalation-summary",
  "test:orchestrator:sandbox-governance-status",
  "test:orchestrator:sandbox-incident-policy-matrix",
  "test:orchestrator:sandbox-operator-handoff-summary",
  "test:orchestrator:sandbox-resolution-readiness",
  "test:orchestrator:sandbox-resolution-evidence-summary",
  "test:orchestrator:sandbox-closure-gating",
  "test:orchestrator:sandbox-resolution-audit-log",
  "test:orchestrator:sandbox-closeout-summary",
  "test:orchestrator:sandbox-closeout-operator-checklist",
  "test:orchestrator:sandbox-resolution-audit-history",
  "test:orchestrator:sandbox-closeout-review-summary",
  "test:orchestrator:sandbox-closeout-review-queue",
  "test:orchestrator:sandbox-closeout-review-actions",
  "test:orchestrator:sandbox-closeout-disposition-summary",
  "test:orchestrator:sandbox-closeout-review-lifecycle",
  "test:orchestrator:sandbox-closeout-review-audit-trail",
  "test:orchestrator:sandbox-closeout-review-history",
  "test:orchestrator:sandbox-closeout-review-resolution-summary",
  "test:orchestrator:sandbox-closeout-settlement-audit",
  "test:orchestrator:sandbox-closeout-followup-summary",
  "test:orchestrator:sandbox-closeout-followup-queue",
  "test:orchestrator:sandbox-closeout-completion-audit",
  "test:orchestrator:sandbox-closeout-completion-summary",
  "test:orchestrator:sandbox-closeout-completion-queue",
  "test:orchestrator:sandbox-closeout-completion-history",
  "test:orchestrator:sandbox-closeout-completion-resolution-summary",
  "test:orchestrator:sandbox-closeout-completion-carry-forward-queue",
  "test:orchestrator:sandbox-closeout-completion-actions",
  "test:orchestrator:sandbox-closeout-completion-disposition-summary",
  "test:orchestrator:sandbox-closeout-completion-lifecycle",
  "test:orchestrator:sandbox-closeout-completion-decision-audit",
  "test:orchestrator:sandbox-closeout-completion-decision-history",
  "test:orchestrator:sandbox-closeout-completion-finalization-summary",
  "test:orchestrator:sandbox-closeout-finalization-audit-history",
  "test:orchestrator:sandbox-closeout-finalization-stability-summary",
  "test:orchestrator:sandbox-closeout-post-finalization-followup-queue",
  "test:orchestrator:sandbox-closeout-stability-drift",
  "test:orchestrator:sandbox-closeout-reopen-recurrence",
  "test:orchestrator:sandbox-closeout-stability-watchlist",
  "test:orchestrator:sandbox-closeout-stability-recurrence-audit",
  "test:orchestrator:sandbox-closeout-watchlist-resolution-summary",
  "test:orchestrator:sandbox-closeout-watchlist-lifecycle",
  "test:orchestrator:sandbox-closeout-watchlist-exit-audit",
  "test:orchestrator:sandbox-closeout-watchlist-readd-history",
  "test:orchestrator:sandbox-closeout-stability-recovery-summary",
  "test:orchestrator:sandbox-closeout-recovery-confidence",
  "test:orchestrator:sandbox-closeout-recovery-regression-audit",
  "test:orchestrator:sandbox-closeout-recovered-monitoring-queue",
  "test:orchestrator:sandbox-closeout-recovery-confidence-trend",
  "test:orchestrator:sandbox-closeout-regression-resolution-summary",
  "test:orchestrator:sandbox-closeout-recovered-monitoring-exit-audit",
  "test:orchestrator:sandbox-closeout-recovery-clearance-audit",
  "test:orchestrator:sandbox-closeout-recovered-exit-history",
  "test:orchestrator:sandbox-closeout-recovered-lifecycle"
)

foreach ($script in $scripts) {
  Write-Host "=== $script ==="
  switch ($script) {
    "test:orchestrator:typecheck" {
      npx tsc -p tools/orchestrator/tsconfig.json --noEmit
    }
    "test:orchestrator:lint" {
      npx eslint tools/orchestrator/src tools/orchestrator/tests
    }
    default {
      $suite = $script -replace "^test:orchestrator:", ""
      & $testSuiteScript $suite
    }
  }
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
