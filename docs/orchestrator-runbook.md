# Orchestrator MVP Runbook

## Env
- Optional: `OPENAI_API_KEY`
- Optional: `ORCHESTRATOR_STORAGE_ROOT`
- Optional: `ORCHESTRATOR_WORKSPACE_ROOT`
- Optional: GitHub CLI auth for `GitHubCliStatusAdapter`

## Live Smoke vs Live Acceptance vs Live Pass
- `npm run orchestrator:live-smoke -- --enabled true`
- `npm run orchestrator:live-acceptance -- --state-id demo --enabled true`
- `npm run orchestrator:live-pass -- --state-id demo --enabled true`
- Requires `OPENAI_API_KEY`
- Skips explicitly when `OPENAI_API_KEY` is missing
- Runs only in an isolated temp repo/workspace and never edits the main repo directly
- `test:orchestrator:live-smoke` is intended for manual smoke use or workflow-dispatch CI, not the default always-on gate
- `test:orchestrator:live-acceptance` is the stronger gated path. It persists `liveAcceptanceStatus`, captures execution report, diff, tool log, command log, and a transcript summary artifact.
- `test:orchestrator:live-pass` is the handoff gate. It persists `livePassStatus`, provider metadata, and the latest live acceptance result so later promotion and handoff steps can prove a real pass happened.

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
- `apply`: isolated workspace edits plus diff/log artifacts, then waits for explicit patch approval before promotion back to the source repo

## Modes
- Auto mode: `--approval-mode auto --auto-mode true`
- Human approval mode: `--approval-mode human_approval --auto-mode false`

Approval mode stops after planning in `waiting_approval`. Use `approve` or `reject` before resuming.

Patch promotion uses a separate lifecycle:
- `plan_ready`
- `patch_ready`
- `patch_exported`
- `branch_ready`
- `promotion_ready`
- `waiting_approval`
- `approved_for_apply`
- `promoted`
- `applied`
- `rejected`

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
npm run orchestrator:approve-patch -- --state-id demo
npm run orchestrator:promote-patch -- --state-id demo --create-branch true --apply-workspace false
npm run orchestrator:reject-patch -- --state-id demo --reason "Need manual patch review."
npm run orchestrator:handoff -- --state-id demo --publish-branch false --github-handoff false
```

`approve` / `reject` control plan approval.

`approve-patch` marks the patch as approved, exports patch metadata, and prepares promotion artifacts.

`promote-patch` is a separate, still-guarded step. It can create a safe local promotion branch name and PR-ready metadata, and only applies workspace files back when `--apply-workspace true` is explicitly requested.

`reject-patch` blocks the patch promotion path.

`handoff` creates a reviewable package once live pass and patch approval preconditions are satisfied. The package includes patch export, changed files, validation summary, planner/reviewer summaries, promotion/workspace metadata, and a PR draft payload.

## Resume
```powershell
npm run orchestrator:resume -- --state-id demo --executor mock
```

## Workspace Cleanup
```powershell
npm run orchestrator:workspace:cleanup -- --state-id demo --workspace-root .tmp/orchestrator-workspaces
npm run orchestrator:cleanup -- --state-id demo --stale-minutes 120
```

`cleanup` performs stale/orphan workspace inspection and only deletes workspaces that are not still needed for review, approval, or resume.

## Artifact Pruning
```powershell
npm run orchestrator:artifacts:prune -- --state-id demo --retain-success 3 --retain-failure 5
```

Artifacts include:
- diff / patch
- tool log
- command log
- transcript summary
- execution report
- handoff package
- PR draft metadata payload
- audit trail
- planner / reviewer state recorded in persisted orchestrator state
- patch export manifest
- PR-ready metadata

Retention policy:
- keep recent successful iterations
- keep recent failed iterations
- never prune iterations that are still waiting for patch approval or needed for resume
- keep promotion-ready artifacts until approval/promotion has finished
- stale/orphan workspaces are cleaned through `orchestrator:cleanup`

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
- live acceptance status
- promotion status
- workspace status
- export artifact paths
- handoff artifact paths
- cleanup decision
- live pass status
- PR draft metadata
- audit trail path/summary

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
npm run test:orchestrator:promotion
npm run test:orchestrator:promotion-branch
npm run test:orchestrator:artifacts
npm run test:orchestrator:cleanup
npm run test:orchestrator:live-smoke
npm run test:orchestrator:live-acceptance
npm run test:orchestrator:live-pass
npm run test:orchestrator:handoff
npm run test:orchestrator:pr-draft
npm run test:orchestrator:audit
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
- Live OpenAI executor smoke is intentionally gated behind `OPENAI_API_KEY` and manual workflow dispatch.
- Live acceptance is also gated behind `OPENAI_API_KEY` and manual workflow dispatch, and it should remain behind human review.
- Live pass is gated behind `OPENAI_API_KEY` and manual workflow dispatch. It records pass/skip/failure for later handoff decisions and does not bypass human approval.
- `LocalRepoExecutor` remains allow-list only and intentionally conservative.
- OpenAI planner/reviewer providers are wired for structured output, but live network usage is still optional and not part of the default acceptance suite.
- GitHub workflow status is still best-effort through `gh`; full CI gate automation is still separate from the main product pipeline.
- `apply` mode is intentionally approval-gated: the executor prepares patch artifacts, then `approve-patch` / `promote-patch` advance the patch through export and promotion preconditions. Direct write-back to the source repo should still stay under human approval.
- PR draft handoff is metadata-first today. If GitHub handoff is not enabled, the orchestrator still writes the draft payload to disk and marks the GitHub portion as an explicit skip.
