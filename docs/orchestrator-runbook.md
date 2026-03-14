# Orchestrator MVP Runbook

## Env
- Optional: `OPENAI_API_KEY`
- Optional: `ORCHESTRATOR_STORAGE_ROOT`
- Optional: `ORCHESTRATOR_WORKSPACE_ROOT`
- Optional: `ORCHESTRATOR_BACKEND_TYPE=file|sqlite|supabase`
- Optional: `ORCHESTRATOR_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- Optional: `ORCHESTRATOR_SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- Optional: `ORCHESTRATOR_SUPABASE_SCHEMA` (defaults to `public`)
- Optional: `ORCHESTRATOR_SUPABASE_TABLE` (defaults to `orchestrator_documents`)
- Optional: `ORCHESTRATOR_GITHUB_HANDOFF=true`
- Optional: `GITHUB_TOKEN` or `GH_TOKEN`
- Optional: GitHub CLI auth for `GitHubCliStatusAdapter`

## Preflight Checks
`orchestrator:preflight` runs a shared readiness pass before live/handoff/promotion paths.

It checks:
- `OPENAI_API_KEY`
- `GITHUB_TOKEN` / `GH_TOKEN`
- `gh` CLI availability
- `git` availability
- workspace root writability
- allowed execution modes
- allowed handoff modes
- allowed promotion modes

Output includes:
- available providers
- unavailable providers
- missing env / secrets
- missing local tools
- blocked reason codes
- suggested next actions

Blocked reasons use one shared shape:
- `code`
- `summary`
- `missingPrerequisites`
- `recoverable`
- `suggestedNextAction`

These results are persisted into orchestrator state as `lastPreflightResult` and `lastBlockedReasons`.

Preflight now also decides whether these operator paths are runnable before they start:
- live smoke / live acceptance / live pass
- GitHub handoff
- promotion / branch publish
- worker daemon processing for a given state profile

## Profiles
Task/repo profiles centralize orchestrator-side defaults for:
- allowed files
- forbidden files
- command allow-list
- approval defaults
- promotion defaults
- retention defaults
- handoff defaults

Current support:
- `default` profile
- custom override at init time via CLI flags

Profile-relevant init flags:
- `--profile`
- `--profile-name`
- `--repo-type`
- `--command-allow-list`
- `--handoff-github-enabled`
- `--handoff-publish-branch`
- `--handoff-create-branch`

## GitHub Event Intake
Orchestrator tasks no longer need to start only from manual `init`.

Supported intake payloads:
- issue `opened`
- issue `labeled`
- pull request `opened`
- pull request `labeled`
- pull request `synchronize`
- issue comment command such as `/orchestrator run`
- `workflow_dispatch` JSON payload
- GitHub webhook payloads with verified signature headers

CLI intake path:
```powershell
npm run orchestrator:event:intake -- --payload path/to/event.json --enqueue true --report-status true
```

Webhook-style intake path:
```powershell
npm run orchestrator:webhook:intake -- --payload path/to/payload.json --headers path/to/headers.json --enqueue true --report-status true
```

Webhook ingress validates:
- `x-github-event`
- `x-github-delivery`
- `x-hub-signature-256`
- `GITHUB_WEBHOOK_SECRET`

Webhook failure semantics:
- missing secret -> explicit `blocked`
- missing signature -> explicit `blocked`
- invalid signature -> explicit `rejected`
- no generic fail for malformed trust configuration

The intake layer normalizes incoming payloads into:
- task objective
- source repo / branch
- source issue / PR / comment metadata
- suggested profile / trigger policy
- approval defaults
- trigger reason
- webhook delivery metadata
- parsed command metadata when the source is a comment command

## Idempotency / Replay
Event intake uses an idempotency key built from:
- repository
- event type
- issue / PR number
- head SHA when available
- comment command identity when available

Behavior:
- duplicate event: reuses the existing state instead of creating another active task
- replay override: creates a fresh state and links it back to the original via `duplicateOfStateId`

Replay path:
```powershell
npm run orchestrator:event:intake -- --payload path/to/event.json --replay true
```

## Trigger Policy
Trigger policy maps event shape into execution defaults without scattering rules across intake, worker, and planner.

Current policy layer can express:
- event type -> execution mode
- event type -> approval mode
- label -> profile / handoff behavior
- repo name pattern -> policy match
- comment command -> allowed command set
- event type -> status-only vs run-capable route

Examples:
- issue / PR events default to `dry_run` + `human_approval`
- `orchestrator:handoff` label enables GitHub-friendly handoff/reporting defaults
- `workflow_dispatch` resolves through a dedicated policy instead of ad hoc CLI conditionals
- comment commands can be restricted to `status`-only, retry, or approval routes

If no trigger policy matches, intake fails explicitly instead of silently falling back.

## Webhook Commands
Supported comment grammar:
- `/orchestrator run`
- `/orchestrator dry-run`
- `/orchestrator status`
- `/orchestrator retry`
- `/orchestrator approve`
- `/orchestrator reject`

Optional overrides:
- `profile=<profile-id>`
- `mode=mock|dry-run|apply`

Examples:
```text
/orchestrator run
/orchestrator dry-run profile=ops
/orchestrator status
/orchestrator approve
```

Routing summary:
- `run` / `dry-run`: create a task or enqueue an existing thread-bound task
- `status`: emit or refresh the correlated status summary
- `retry`: requeue the existing task
- `approve` / `reject`: route into plan or patch approval when a matching state exists

Unsupported or unauthorized commands are explicitly recorded as `rejected` or `ignored`; they are not silently dropped.

## Status Reporting
Operator-friendly status reporting can emit:
- markdown summary file
- JSON payload artifact
- optional GitHub issue / PR comment via `gh`

CLI path:
```powershell
npm run orchestrator:status:report -- --state-id demo
```

`event:intake` can also emit an initial task-created status summary when `--report-status true`.
`webhook:intake` can emit the same initial or routed status summary after command processing.

Status reports include:
- current state
- planner / reviewer summary
- blockers / missing prerequisites
- next suggested action
- handoff / promotion / workspace state
- artifact or handoff package paths when available
- source event / delivery metadata
- parsed command routing summary when the source was a GitHub comment

Comment upsert / correlation:
- status comments carry a stable marker `<!-- orchestrator-status:<state-id> -->`
- if a prior comment target is known, the orchestrator patches that comment
- if the prior target is unknown, the adapter searches the thread for the same marker before posting a new comment
- persisted correlation fields:
  - `statusReportCorrelationId`
  - `lastStatusReportTarget`
  - `lastStatusReportSummary`

Skip / failure behavior:
- missing `GITHUB_TOKEN` / `GH_TOKEN` -> explicit `skipped`
- missing issue / PR target -> payload-only summary
- disabled adapter or no GitHub target -> payload-only summary instead of hard failure
- no generic fail for unavailable GitHub comment posting

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
- `live evidence` is written next to the live acceptance artifacts and records provider/model, final status, start/end time, tool count, command count, and artifact paths in one stable JSON payload.

## Payload-Only vs Real GitHub Handoff
- Payload-only handoff:
  - always available after `handoff` preconditions pass
  - writes PR draft metadata and GitHub request payload files to disk
  - does not require `gh` or `GITHUB_TOKEN`
- Real GitHub handoff:
  - requires `ORCHESTRATOR_GITHUB_HANDOFF=true`
  - requires `GITHUB_TOKEN` or `GH_TOKEN`
  - uses the `gh` CLI draft PR path
  - if token or `gh` is unavailable, the handoff is persisted as an explicit skip or failure instead of silently succeeding

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

Promotion config is task-scoped and currently supports:
- `promotion-branch-template`
- `promotion-base-branch`
- `promotion-allow-publish`
- `promotion-approval-required`
  - `promotion-allow-apply-workspace`
  - `promotion-require-patch-export`

## Diagnostics / Inspect
Use diagnostics commands to inspect operator-facing status:

```powershell
npm run orchestrator:preflight -- --state-id demo
npm run orchestrator:event:intake -- --payload path/to/event.json --enqueue true
npm run orchestrator:webhook:intake -- --payload path/to/payload.json --headers path/to/headers.json
npm run orchestrator:status:report -- --state-id demo
npm run orchestrator:status -- --state-id demo
npm run orchestrator:diagnostics -- --state-id demo
```

Diagnostics summarize:
- current state / iteration
- current profile
- source event / delivery / signature / idempotency / trigger policy
- parsed command and command routing decision
- latest planner / reviewer result
- latest blockers
- missing prerequisites
- status reporting result and correlation target
- patch / promotion / handoff / live / workspace status
- suggested next action

`status`, `inspect`, and `diagnostics` currently resolve to the same readable summary path.

`backend:status` is the operator-facing backend summary path. It shows:
- backend type
- queue depth
- running/queued/paused/blocked counts
- stale lease count
- worker count
- readiness / migration details

Additional backend operator paths:
- `backend:live-smoke`
- `backend:health`
- `backend:repair`
- `backend:export`
- `backend:import`

## Queue / Worker / Lock / Recovery
The orchestrator can now run through a durable queue instead of only ad hoc CLI execution.

Backend choices:
- `file`
  - simplest MVP
  - queue/lease data lives in JSON files
  - useful for local smoke and low-concurrency single-host runs
- `sqlite`
  - current recommended durable backend
  - queue/lease/worker registry live in a single SQLite database file
  - better for long-running single-host worker mode and validating lease/recovery semantics
- `supabase`
  - shared remote backend for queue/lease/worker coordination
  - uses orchestrator-only document storage
  - requires Supabase URL + service role key

Why SQLite-first:
- no external network dependency
- easier to validate queue + lease + recovery than raw file locking
- still preserves a future path for a shared remote backend later

Why add Supabase now:
- shared queue/lease visibility across machines
- remote worker coordination without inventing a separate scheduler first
- still keeps file/sqlite as safer local defaults

Queue items persist:
- `taskId`
- `runId`
- `iterationNumber`
- `priority`
- `scheduledAt`
- `status`
- `attemptCount`
- `profileId`
- `executionMode`
- `approvalMode`
- `workerId`
- `leaseOwner`
- `lastHeartbeatAt`
- `queuedAt`
- `startedAt`
- `finishedAt`

Queue commands:
```powershell
npm run orchestrator:queue:enqueue -- --state-id demo --priority 10
npm run orchestrator:queue:list
```

Worker commands:
```powershell
npm run orchestrator:worker:once -- --worker-id worker-1
npm run orchestrator:worker:run -- --worker-id worker-1 --poll-ms 1000 --max-polls 10
npm run orchestrator:worker:status -- --worker-id worker-1
npm run orchestrator:backend:init -- --backend-type supabase
npm run orchestrator:backend:migrate -- --backend-type supabase
npm run orchestrator:backend:status -- --backend-type supabase
npm run orchestrator:backend:inspect
```

Operator control commands:
```powershell
npm run orchestrator:run:pause -- --state-id demo
npm run orchestrator:run:resume -- --state-id demo
npm run orchestrator:run:cancel -- --state-id demo
npm run orchestrator:run:requeue -- --state-id demo
```

Behavior summary:
- `worker:once` performs one poll cycle and exits.
- `worker:run` keeps polling for eligible queued runs and now behaves like a lightweight daemon/supervised poll loop.
- leases prevent two workers from taking the same task / repo / workspace scope at the same time.
- running items renew a heartbeat-backed lease while work is in progress.
- expired leases are eligible for recovery.
- approval / handoff / promotion pending states are paused rather than force-taken-over.
- diagnostics can now show backend type, queue depth, worker health, stale lease counts, pause/cancel requests, and recovery status.

Cooperative cancellation / pause:
- queued items can still be cancelled or paused immediately
- running items move to `cancel_requested` or `pause_requested`
- worker checks those requests at safe boundaries between orchestrator iterations/tool phases
- resulting terminal state is recorded as `cancelled` or `paused`
- approval pending / handoff pending / promotion pending data are preserved; cancellation and pause do not blindly delete artifacts

Daemon / supervision notes:
- `worker:run` records worker identity, daemon heartbeat, last error, consecutive error state, and supervision status
- repeated worker failures back off instead of hot-looping
- stale leases can be recovered without leaving the task permanently stuck
- this is still an in-process daemon-style worker, not a full OS service manager

Recovery summary:
- stale running jobs with expired leases are requeued if safe to take over
- approval / handoff / blocked runs are paused for manual review
- workspace cleanup is inspected before recovery decides to resume or requeue
- recovery decisions are persisted as `lastRecoveryDecision`

Automatic stop vs blocked:
- missing prerequisites and unavailable execution modes block the run
- approval-required states pause instead of auto-running
- stop conditions such as max failures / max iterations still apply inside worker mode
- worker mode does not bypass forbidden files, promotion preconditions, or approval gates

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
- retention/cleanup config can be set at init time:
  - `retention-success-keep`
  - `retention-failure-keep`
  - `retention-stale-workspace-ttl`
  - `retention-orphan-artifact-ttl`
  - `retention-preserve-approval-pending`

## Review Last Iteration
```powershell
npm run orchestrator:review -- --state-id demo
```

## State Location
- Default: `.tmp/orchestrator-state/<state-id>.json`
- Override with `ORCHESTRATOR_STORAGE_ROOT` or `--storage-root`

## Backend Storage Location
- `file` backend:
  - queue: `.tmp/orchestrator-state/queue.json`
  - workers: `.tmp/orchestrator-state/workers.json`
- `sqlite` backend:
  - `.tmp/orchestrator-state/orchestrator-backend.sqlite`
- `supabase` backend:
  - queue/workers/state documents live in `public.orchestrator_documents` by default
  - schema/table can be overridden with `ORCHESTRATOR_SUPABASE_SCHEMA` and `ORCHESTRATOR_SUPABASE_TABLE`
- Override backend type with `--backend-type file|sqlite|supabase`
- Optional fallback with `--backend-fallback file|sqlite|blocked`

## Supabase Backend Init / Migrate / Status
```powershell
npm run orchestrator:backend:init -- --backend-type supabase
npm run orchestrator:backend:migrate -- --backend-type supabase
npm run orchestrator:backend:status -- --backend-type supabase
```

Current migration path:
- if a direct migration executor is not configured, the command returns `manual_required`
- apply [tools/orchestrator/src/migrations/orchestrator_supabase.sql](/c:/Users/User/bige/tools/orchestrator/src/migrations/orchestrator_supabase.sql)
- once the table exists, `backend:status` should report `ready`

Supabase live backend smoke:
```powershell
npm run orchestrator:backend:live-smoke -- --backend-type supabase
```

Live backend smoke checks:
- Supabase URL
- service-role/admin key
- table availability
- enqueue/dequeue
- lock acquire/release
- heartbeat renew
- stale detection

Result behavior:
- missing env -> `skipped`
- backend not initialized -> `manual_required` or `blocked`
- successful run -> persists backend live smoke result and evidence summary

Required env for Supabase live/backend commands:
- `ORCHESTRATOR_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `ORCHESTRATOR_SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`
- optional `ORCHESTRATOR_SUPABASE_SCHEMA`
- optional `ORCHESTRATOR_SUPABASE_TABLE`

## Backend Transfer / Bootstrap
Use transfer tooling when moving orchestrator state between durable backends:

```powershell
npm run orchestrator:backend:export -- --backend-type file
npm run orchestrator:backend:import -- --backend-type sqlite --snapshot .tmp/orchestrator-transfer/export.json
npm run orchestrator:backend:import -- --backend-type supabase --snapshot .tmp/orchestrator-transfer/export.json
```

Current safe transfer path:
- `file -> sqlite`
- `file -> supabase`
- `sqlite -> supabase`

Transfer includes:
- task states
- runs / iterations
- queue items
- diagnostics-friendly summary

Transfer intentionally does not preserve live locks/leases as active ownership:
- running leases are cleared during import
- imported queue items are normalized to safe states
- live worker ownership is rebuilt after import instead of copied blindly

Each transfer writes:
- export/import summary
- skipped item count
- conflict count
- manual follow-up notes when cleanup/rebuild is required

## Backend Health / Repair
```powershell
npm run orchestrator:backend:health -- --backend-type supabase
npm run orchestrator:backend:repair -- --backend-type supabase
```

`backend:health` summarizes:
- backend type
- queue depth
- active leases
- stale leases
- orphan runs
- pending approval count
- pending promotion count
- recoverable anomalies

`backend:repair` can safely:
- requeue stale runs
- block orphan queue items
- leave active orphaned leases as `manual_required`

`backend:repair` does not silently force high-risk corrections:
- approval pending work is preserved
- promotion/handoff pending work is preserved
- active live leases requiring manual judgment are reported instead of auto-cleared

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
- live evidence
- GitHub handoff result
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
npm run test:orchestrator:github-handoff
npm run test:orchestrator:promotion-config
npm run test:orchestrator:live-evidence
npm run test:orchestrator:retention-config
npm run test:orchestrator:preflight
npm run test:orchestrator:profiles
npm run test:orchestrator:diagnostics
npm run test:orchestrator:github-events
npm run test:orchestrator:idempotency
npm run test:orchestrator:status-reporting
npm run test:orchestrator:trigger-policy
npm run test:orchestrator:webhook
npm run test:orchestrator:commands
npm run test:orchestrator:signature
npm run test:orchestrator:comment-upsert
npm run test:orchestrator:event-flow
npm run test:orchestrator:queue
npm run test:orchestrator:worker
npm run test:orchestrator:locking
npm run test:orchestrator:recovery
npm run test:orchestrator:backend-provider
npm run test:orchestrator:cancellation
npm run test:orchestrator:daemon
npm run test:orchestrator:supervision
npm run test:orchestrator:supabase-backend
npm run test:orchestrator:remote-locking
npm run test:orchestrator:backend-migration
npm run test:orchestrator:remote-diagnostics
npm run test:orchestrator:supabase-live
npm run test:orchestrator:backend-transfer
npm run test:orchestrator:backend-health
npm run test:orchestrator:mock-loop
npm run test:orchestrator:loop
npm run test:orchestrator:state-machine
npm run test:orchestrator:full-validation
```

## Provider Status
- Real today:
  - `FileStorage`
  - `SupabaseStorage`
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
## Current MVP Limits
- `OpenAIResponsesExecutorProvider` is a coding-executor MVP; its integration tests are mocked and it should still run behind human review for risky scopes.
- Live OpenAI executor smoke is intentionally gated behind `OPENAI_API_KEY` and manual workflow dispatch.
- Live acceptance is also gated behind `OPENAI_API_KEY` and manual workflow dispatch, and it should remain behind human review.
- Live pass is gated behind `OPENAI_API_KEY` and manual workflow dispatch. It records pass/skip/failure for later handoff decisions and does not bypass human approval.
- `LocalRepoExecutor` remains allow-list only and intentionally conservative.
- OpenAI planner/reviewer providers are wired for structured output, but live network usage is still optional and not part of the default acceptance suite.
- GitHub workflow status is still best-effort through `gh`; full CI gate automation is still separate from the main product pipeline.
- GitHub event intake now supports webhook-style payload ingestion, but still through CLI/workflow entrypoints; this repo does not ship a long-running webhook server.
- GitHub status reporting is comment/payload oriented; it does not auto-merge, auto-approve, or bypass human review.
- Comment upsert relies on stored target metadata plus marker-based correlation; it does not rewrite issue or PR body content.
- `apply` mode is intentionally approval-gated: the executor prepares patch artifacts, then `approve-patch` / `promote-patch` advance the patch through export and promotion preconditions. Direct write-back to the source repo should still stay under human approval.
- PR draft handoff is metadata-first by default. Real GitHub draft PR creation is optional and remains gated by `ORCHESTRATOR_GITHUB_HANDOFF` plus token availability.
- Preflight is fail-fast and safety-first. It does not relax any existing approval, promotion, or command safety rules.
- GitHub handoff, live paths, and promotion all consume the same preflight/readiness model, so blocked or skipped paths should now explain themselves consistently.
- Queue / worker mode is still MVP:
  - queue/lock backend is now pluggable across `file`, `sqlite`, and `supabase`
  - `supabase` is still a document-based remote backend, not a high-throughput distributed scheduler
  - recovery is still lease/heartbeat based, not distributed consensus
  - backend transfer/bootstrap is intentionally conservative and rebuilds live ownership instead of migrating active locks
  - backend health/repair favors explicit `manual_required` over risky auto-fix for ambiguous remote states
  - cooperative pause/cancel only stop at safe boundaries; they are not hard interrupts in the middle of arbitrary commands
  - `worker:run` is daemon-style supervision, not a fully managed OS/background service
  - approval, handoff, and promotion pending runs are preserved conservatively rather than aggressively reclaimed
