# Orchestrator MVP Runbook

## Env
- Optional: `OPENAI_API_KEY`
- Optional: `ORCHESTRATOR_STORAGE_ROOT`
- Optional: `ORCHESTRATOR_WORKSPACE_ROOT`
- Optional: GitHub CLI auth for `GitHubCliStatusAdapter`

## Provider Selection
- `--planner-provider rule_based|openai`
- `--reviewer-provider rule_based|openai`
- `--executor mock|local_repo|openai_responses`
- `--executor-fallback blocked|mock|local_repo`
- If `OPENAI_API_KEY` is missing and `openai` is requested, the orchestrator falls back to `rule_based` and persists the fallback reason in iteration history.
- If `openai_responses` is requested without `OPENAI_API_KEY`, the orchestrator either falls back according to `--executor-fallback` or stops with an explicit unavailable reason.

## Execution Modes
- `mock`: synthetic execution only
- `dry_run`: isolated workspace edits plus diff/log artifacts, without writing back to the main repo
- `apply`: isolated workspace edits plus diff/log artifacts, then copies changed files back only when auto mode is enabled and approval mode is `auto`

## Modes
- Auto mode: `--approval-mode auto --auto-mode true`
- Human approval mode: `--approval-mode human_approval --auto-mode false`

Approval mode stops after planning in `waiting_approval`. Use `approve` or `reject` before resuming.

## Initialize
```powershell
npm run orchestrator:init -- --state-id demo --goal "Build orchestrator stage two"
```

## Dry Run
```powershell
npm run orchestrator:dry-run -- --state-id demo --executor mock
```

## Plan Only
```powershell
npm run orchestrator:plan -- --state-id demo
```

## Run Once
```powershell
npm run orchestrator:run-once -- --state-id demo --executor openai_responses --execution-mode dry_run
```

## Run Loop
```powershell
npm run orchestrator:run-loop -- --state-id demo --executor openai_responses --execution-mode dry_run
```

## Approval Controls
```powershell
npm run orchestrator:approve -- --state-id demo
npm run orchestrator:reject -- --state-id demo --reason "Need human review before execution."
```

## Resume
```powershell
npm run orchestrator:resume -- --state-id demo --executor mock
```

## Workspace Cleanup
```powershell
npm run orchestrator:workspace:cleanup -- --state-id demo --workspace-root .tmp/orchestrator-workspaces
```

## Review Last Iteration
```powershell
npm run orchestrator:review -- --state-id demo
```

## State Location
- Default: `.tmp/orchestrator-state/<state-id>.json`
- Override with `ORCHESTRATOR_STORAGE_ROOT` or `--storage-root`

## Workspace Location
- Default: `.tmp/orchestrator-workspaces/<state-id>/iteration-<n>`
- Override with `ORCHESTRATOR_WORKSPACE_ROOT` or `--workspace-root`

Each state file persists:
- task metadata
- planner / reviewer provider selection
- planner decision
- execution report
- review verdict
- CI summary
- state transitions
- stop reason
- fallback reason

## Acceptance
Run the orchestrator suite with:
```powershell
npm run test:orchestrator:typecheck
npm run test:orchestrator:lint
npm run test:orchestrator:unit
npm run test:orchestrator:integration
npm run test:orchestrator:schema
npm run test:orchestrator:policy
npm run test:orchestrator:providers
npm run test:orchestrator:storage
npm run test:orchestrator:executor-provider
npm run test:orchestrator:workspace
npm run test:orchestrator:patch-flow
npm run test:orchestrator:mock-loop
npm run test:orchestrator:loop
npm run test:orchestrator:state-machine
```

## Provider Status
- Real today:
  - `FileStorage`
  - `MockExecutor`
  - `LocalRepoExecutor`
  - `OpenAIResponsesExecutorProvider`
  - `RuleBasedPlannerProvider`
  - `RuleBasedReviewerProvider`
  - `NodeHttpsResponsesClient` wiring for Responses API
  - `FileSystemWorkspaceManager`
- Mocked in tests:
  - OpenAI Responses provider integrations
  - OpenAI coding executor tool turns
  - GitHub status adapter integration paths
- Stubbed for later:
  - `SupabaseStorage`

## Current MVP Limits
- `OpenAIResponsesExecutorProvider` is a coding-executor MVP; its integration tests are mocked and it should still run behind human review for risky scopes.
- `LocalRepoExecutor` remains allow-list only and intentionally conservative.
- OpenAI planner/reviewer providers are wired for structured output, but live network usage is still optional and not part of the default acceptance suite.
- GitHub workflow status is still best-effort through `gh`; full CI gate automation is not yet part of orchestrator completion logic.
- `apply` mode is intentionally conservative: without auto mode plus `approvalMode=auto`, it returns a patch-ready report instead of silently mutating the main repo.
