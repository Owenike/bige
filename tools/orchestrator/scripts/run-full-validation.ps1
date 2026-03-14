param()

$ErrorActionPreference = "Stop"

$scripts = @(
  "typecheck",
  "lint",
  "test:orchestrator:typecheck",
  "test:orchestrator:lint",
  "test:orchestrator:unit",
  "test:orchestrator:integration",
  "test:orchestrator:schema",
  "test:orchestrator:policy",
  "test:orchestrator:mock-loop",
  "test:orchestrator:state-machine",
  "test:orchestrator:providers",
  "test:orchestrator:storage",
  "test:orchestrator:loop",
  "test:orchestrator:executor-provider",
  "test:orchestrator:workspace",
  "test:orchestrator:patch-flow",
  "test:orchestrator:promotion",
  "test:orchestrator:artifacts",
  "test:orchestrator:live-smoke",
  "test:orchestrator:live-acceptance",
  "test:orchestrator:promotion-branch",
  "test:orchestrator:cleanup",
  "test:orchestrator:live-pass",
  "test:orchestrator:handoff",
  "test:orchestrator:pr-draft",
  "test:orchestrator:audit",
  "test:orchestrator:github-handoff",
  "test:orchestrator:promotion-config",
  "test:orchestrator:live-evidence",
  "test:orchestrator:retention-config",
  "test:orchestrator:preflight",
  "test:orchestrator:profiles",
  "test:orchestrator:diagnostics",
  "test:orchestrator:github-events",
  "test:orchestrator:idempotency",
  "test:orchestrator:status-reporting",
  "test:orchestrator:trigger-policy",
  "test:orchestrator:webhook",
  "test:orchestrator:commands",
  "test:orchestrator:signature",
  "test:orchestrator:comment-upsert",
  "test:orchestrator:event-flow",
  "test:orchestrator:webhook-server",
  "test:orchestrator:actor-policy",
  "test:orchestrator:replay-protection",
  "test:orchestrator:inbound-audit",
  "test:orchestrator:queue",
  "test:orchestrator:worker",
  "test:orchestrator:locking",
  "test:orchestrator:recovery",
  "test:orchestrator:backend-provider",
  "test:orchestrator:cancellation",
  "test:orchestrator:daemon",
  "test:orchestrator:supervision",
  "test:orchestrator:supabase-backend",
  "test:orchestrator:remote-locking",
  "test:orchestrator:backend-migration",
  "test:orchestrator:remote-diagnostics",
  "test:orchestrator:supabase-live",
  "test:orchestrator:backend-transfer",
  "test:orchestrator:multi-worker-remote",
  "test:orchestrator:backend-health"
)

foreach ($script in $scripts) {
  Write-Host "=== $script ==="
  npm run $script
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}
