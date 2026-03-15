# Orchestrator MVP Runbook

## Env
- Optional: `OPENAI_API_KEY`
- Optional: `GITHUB_WEBHOOK_SECRET`
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
- Optional: `ORCHESTRATOR_ACTOR_ADMINS`
- Optional: `ORCHESTRATOR_ACTOR_RUNNERS`
- Optional: `ORCHESTRATOR_ACTOR_APPROVERS`
- Optional: `ORCHESTRATOR_ACTOR_STATUS`
- Optional: `ORCHESTRATOR_ACTOR_LIVE`
- Optional: `ORCHESTRATOR_ACTOR_POLICY_CONFIG`

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

## Webhook Server
The orchestrator now ships a local webhook receiver and no longer depends only on payload-file ingestion.

Start it locally:
```powershell
npm run orchestrator:webhook:serve -- --host 127.0.0.1 --port 8787 --base-path /hooks --webhook-path /github
```

Check runtime summary without starting the server:
```powershell
npm run orchestrator:webhook:runtime -- --host 127.0.0.1 --port 8787 --base-path /hooks --webhook-secret your-secret --actor-policy-config .tmp/orchestrator/actor-policy.json
```

Deploy-oriented hosting behavior:
- `webhook:serve` is a standalone Node server, not a main-product route
- host / port / base path / webhook path are configurable
- startup prints a hosting summary plus runtime readiness
- `SIGINT` / `SIGTERM` trigger graceful shutdown and emit a shutdown summary
- new requests are rejected once shutdown begins

Supported inbound events:
- `issues`
- `issue_comment`
- `pull_request`

Receiver behavior:
- reads the raw request body before JSON parsing
- verifies the GitHub signature against `GITHUB_WEBHOOK_SECRET`
- extracts `x-github-event` and `x-github-delivery`
- normalizes the payload through the shared GitHub event intake layer
- records inbound audit trail and replay protection decisions

Runtime endpoints:
- `GET <basePath>/healthz`
- `GET <basePath>/readyz`

Runtime readiness currently checks:
- `GITHUB_WEBHOOK_SECRET`
- actor policy config readability
- GitHub live status reporting prerequisites (`GITHUB_TOKEN` / `GH_TOKEN`, `gh`)
- backend/storage availability
- host / port / base path / webhook path normalization at startup

Readiness semantics:
- `ready`: webhook secret, actor policy config, and backend are usable; live comment path is available
- `degraded`: core ingress can run, but live GitHub comment reporting is not ready
- `blocked`: webhook secret/config/backend is not usable, so safe ingress should not start accepting real traffic

Typical degraded cases:
- missing `GITHUB_TOKEN` / `GH_TOKEN`
- missing `gh`

Typical blocked cases:
- missing `GITHUB_WEBHOOK_SECRET`
- unreadable actor policy config
- backend/storage unavailable

Use `curl` or a tunnel/proxy to point GitHub webhooks at the local endpoint.

Local hosting smoke:
```powershell
npm run orchestrator:webhook:serve -- --host 127.0.0.1 --port 8787 --base-path /hooks --webhook-path /github
curl http://127.0.0.1:8787/hooks/healthz
curl http://127.0.0.1:8787/hooks/readyz
```

Failure semantics:
- missing webhook secret -> `blocked` or `manual_required`
- invalid signature -> `rejected`
- unsupported event -> `ignored`
- duplicate delivery -> `duplicate`

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

## Actor Policy
Trigger policy decides whether an event shape is routable; actor policy decides whether the specific GitHub actor is allowed to invoke that route.

Current configurable actor policy supports JSON config first, with env-backed allowlists as fallback:
- pass `--actor-policy-config path/to/actor-policy.json`
- or set `ORCHESTRATOR_ACTOR_POLICY_CONFIG=/path/to/actor-policy.json`

Env-backed allowlists:
- `ORCHESTRATOR_ACTOR_ADMINS`
- `ORCHESTRATOR_ACTOR_RUNNERS`
- `ORCHESTRATOR_ACTOR_APPROVERS`
- `ORCHESTRATOR_ACTOR_STATUS`
- `ORCHESTRATOR_ACTOR_LIVE`

Example config:
```json
{
  "version": "team-defaults-v1",
  "runActors": ["orchestrator-runner"],
  "approverActors": ["orchestrator-approver"],
  "statusActors": ["orchestrator-viewer", "orchestrator-approver"],
  "liveActors": ["orchestrator-approver"]
}
```

Current authorization model:
- status-only actors can request `/orchestrator status`
- runner actors can request run/dry-run/retry
- approver actors can request approve/reject
- live-capable actors are additionally required for live/apply/promotion-adjacent requests
- admin actors bypass lower-tier restrictions inside the orchestrator boundary

Diagnostics / readiness should now show:
- actor policy config source (`file`, `env`, or `default`)
- actor policy config version
- runtime health/readiness
- live GitHub comment path readiness

Operator check path:
```powershell
npm run orchestrator:actor-policy:check -- --actor octocat --command run --execution-mode dry_run
```

Authorization outcomes are explicit:
- `authorized`
- `rejected`
- `not_checked`

Unauthorized commands are rejected with a persisted reason; they are not silently ignored.

Actor policy diagnostics now also record:
- matched rule
- config version
- rejected reason
- suggested next action

## Replay Protection
Replay protection is now stricter than generic task idempotency.

Keys considered:
- webhook delivery id
- normalized source event id
- issue / PR identity
- comment identity when applicable
- head SHA when applicable

Decisions:
- duplicate delivery -> `duplicate`
- duplicate source event -> `duplicate`
- explicit replay override -> `replayed`
- invalid signature replay -> `rejected`
- unsupported/no-op event -> `ignored`

Replay protection prevents:
- duplicate queue insertion
- duplicate task creation
- duplicate status comment fan-out

## Status Reporting
Operator-friendly status reporting can emit:
- markdown summary file
- JSON payload artifact
- optional GitHub issue / PR comment via `gh`

CLI path:
```powershell
npm run orchestrator:status:report -- --state-id demo
npm run orchestrator:github-live-report:smoke -- --state-id demo
npm run orchestrator:reporting:smoke -- --state-id demo
npm run orchestrator:diagnostics -- --state-id demo
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
- if a stored target comment is stale or missing, the adapter falls back to correlation lookup before deciding to create a fresh comment
- persisted correlation fields:
  - `statusReportCorrelationId`
  - `lastStatusReportTarget`
  - `lastStatusReportAction`
  - `lastStatusReportTargetStrategy`
  - `lastStatusReportPermissionStatus`
  - `lastStatusReportReadinessStatus`
  - `lastStatusReportFailureReason`
  - `lastStatusReportSummary`
  - `liveStatusReportReadiness`
  - `reportDeliveryAttempts`
  - `lastReportDeliveryAuditId`

Skip / failure behavior:
- missing `GITHUB_TOKEN` / `GH_TOKEN` -> explicit `skipped`
- missing `gh` for live comment path -> explicit degraded/skip for live reporting while payload output still succeeds
- missing issue / PR target -> readiness `blocked`; payload output can still exist, but live comment path does not run
- disabled adapter or no GitHub target -> payload-only summary instead of hard failure
- no generic fail for unavailable GitHub comment posting

Live GitHub reporting hardening:
- live comment create/update first checks readiness for `gh` + token
- readiness now also answers whether the next live action is expected to be `create`, `update`, `skip`, or `blocked`
- permission smoke now distinguishes missing token, missing `gh`, invalid target, create denied, update denied, and visible-but-not-updatable correlated targets
- correlation marker lookup still prevents duplicate comments on the same thread
- issue and PR thread targeting now follow the same persisted target metadata model
- create/update failure is recorded as reporting failure and does not redefine the main orchestration result

Live auth smoke:
- the auth smoke path is gated and separate from the main orchestration loop
- required prerequisites:
  - `GITHUB_TOKEN` or `GH_TOKEN`
  - `gh` on `PATH`
  - a safe sandbox target via explicit CLI override or sandbox target registry/profile
- without an explicit sandbox target, auth smoke returns `manual_required` instead of guessing a real thread
- smoke metadata now persists:
  - `authSmokeStatus`
  - `authSmokeSuccessStatus`
  - `authSmokeMode`
  - `authSmokeTarget`
  - `authSmokePermissionResult`
  - `authSmokeFailureReason`
  - `sandboxProfileId`
  - `sandboxProfileStatus`
  - `sandboxTargetProfileId`
  - `sandboxTargetConfigVersion`
  - `targetSelectionStatus`
  - `lastAuthSmokeTarget`
  - `lastAuthSmokeAction`
  - `lastAuthSmokeSuccessAt`
  - `lastAuthSmokeEvidencePath`
  - `lastLiveSmokeEvidencePath`
  - `lastLiveSmokeSummary`
  - `lastLiveAuthEvidence`
  - `lastGitHubAuthSmokeResult`

Denied / blocked matrix:
- `missing_token`: live auth smoke cannot authenticate GitHub
- `missing_gh`: `gh` is unavailable, so live auth smoke cannot run
- `target_invalid`: the requested issue / PR reference is malformed or GitHub rejected it as invalid
- `target_not_found`: the issue / PR target does not exist or is not visible
- `create_denied`: GitHub reachable, but comment creation is denied
- `update_denied`: GitHub reachable, but updating the chosen comment is denied
- `correlation_target_missing`: the stored correlated comment no longer exists
- `correlation_not_updatable`: the correlated comment is visible but cannot be patched
- `target_locked_or_not_updatable`: the thread or comment is locked
- `repository_mismatch`: the explicit sandbox target conflicts with the stored correlated repository

Live comment action rules:
- `create`: no correlated comment target is known for the current issue / PR thread
- `update`: a correlated comment target already exists, or marker lookup found one in the thread
- `skip`: live path is disabled or degraded because token / `gh` is unavailable
- `blocked`: there is no safe issue / PR thread target for live commenting
- `failed`: the target exists but GitHub rejected create/update, or the target is invalid/stale and could not be repaired automatically

Local smoke:
```powershell
npm run orchestrator:status:report -- --state-id demo
npm run orchestrator:github-live-report:smoke -- --state-id demo
npm run orchestrator:reporting:smoke -- --state-id demo
node .tmp/orchestrator/src/cli.js reporting:target-check --state-id demo --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default
node .tmp/orchestrator/src/cli.js reporting:permissions --state-id demo
node .tmp/orchestrator/src/cli.js reporting:auth-smoke --state-id demo --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default
node .tmp/orchestrator/src/cli.js reporting:live-success-smoke --state-id demo --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default
```

The smoke path is intentionally gated:
- with valid token + `gh`, it should create then update the correlated comment
- without token or `gh`, it records degraded/skip semantics instead of hard-failing
- without an explicit sandbox target, live auth smoke returns `manual_required`
- permission smoke is non-authoritative when no live token is present, but still classifies the exact prerequisite or permission bucket that is missing

Sandbox target rules:
- `create`: explicit issue / PR sandbox target exists, but no correlated comment exists yet
- `update`: explicit sandbox target already has a correlated comment, or correlated reuse is explicitly allowed and safe
- `skip`: live path is degraded because token / `gh` is unavailable
- `blocked`: the explicit target conflicts with the known correlated repository, or the thread cannot be safely updated
- `manual_required`: no safe sandbox target was supplied, so the orchestrator refuses to guess a live thread

Sandbox target registry:
- the registry can come from JSON config or env-derived defaults
- registry governance can additionally constrain:
  - `allowedRepositories`
  - `allowedTargetTypes`
  - `allowedActionPolicies`
  - `defaultAllowedActionPolicies`
- supported fields per profile:
  - `id`
  - `repository`
  - `targetType`
  - `targetNumber`
  - `actionPolicy` = `create_or_update`, `create_only`, or `update_only`
  - `enabled`
  - `notes`
- resolution order:
  - explicit CLI override
  - explicit `--sandbox-profile`
  - registry default profile
  - current task profile id
  - repository-matched fallback
- if no safe registry target exists, auth smoke returns `manual_required`
- if policy and correlated target disagree, auth smoke returns `blocked`
- governance rules:
  - disabled profiles are never eligible for live smoke
  - repositories outside the governance allow-list are blocked
  - target types outside the governance allow-list are blocked
  - action policies outside the governance allow-list are blocked
  - default profiles must satisfy the stricter `defaultAllowedActionPolicies` rule
- operator commands:
  - `node .tmp/orchestrator/src/cli.js sandbox:bundle:list --sandbox-config .tmp/orchestrator-sandbox.json`
  - `node .tmp/orchestrator/src/cli.js sandbox:bundle:show --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-bundle create-only`
  - `node .tmp/orchestrator/src/cli.js sandbox:bundle:governance --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-bundle create-only --sandbox-profile default`
  - `node .tmp/orchestrator/src/cli.js sandbox:create --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default --target-repo example/bige --target-type issue --target-number 101 --set-default true`
  - `node .tmp/orchestrator/src/cli.js sandbox:update --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default --notes "safe smoke target"`
  - `node .tmp/orchestrator/src/cli.js sandbox:delete --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile old-profile`
  - `node .tmp/orchestrator/src/cli.js sandbox:set-default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default`
  - `node .tmp/orchestrator/src/cli.js sandbox:list --sandbox-config .tmp/orchestrator-sandbox.json`
  - `node .tmp/orchestrator/src/cli.js sandbox:show --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default`
  - `node .tmp/orchestrator/src/cli.js sandbox:validate --state-id demo --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default`
  - `node .tmp/orchestrator/src/cli.js sandbox:governance --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default`
  - `node .tmp/orchestrator/src/cli.js sandbox:audit --sandbox-config .tmp/orchestrator-sandbox.json`
  - `node .tmp/orchestrator/src/cli.js sandbox:restore-points --sandbox-config .tmp/orchestrator-sandbox.json`
  - `node .tmp/orchestrator/src/cli.js sandbox:restore-points:list --sandbox-config .tmp/orchestrator-sandbox.json`
  - `node .tmp/orchestrator/src/cli.js sandbox:restore-points:prune --sandbox-config .tmp/orchestrator-sandbox.json --retain-recent 10 --max-age-hours 720`
  - `node .tmp/orchestrator/src/cli.js sandbox:history --sandbox-config .tmp/orchestrator-sandbox.json --kind all`
  - `node .tmp/orchestrator/src/cli.js sandbox:rollback:history --sandbox-config .tmp/orchestrator-sandbox.json`
  - `node .tmp/orchestrator/src/cli.js sandbox:compare --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...`
  - `node .tmp/orchestrator/src/cli.js sandbox:compare --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:... --compare-restore-point-id sandbox-restore:...`
  - `node .tmp/orchestrator/src/cli.js sandbox:recovery:diagnostics --sandbox-config .tmp/orchestrator-sandbox.json`
  - `node .tmp/orchestrator/src/cli.js sandbox:guardrails --state-id demo --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default`
  - `node .tmp/orchestrator/src/cli.js sandbox:export --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default --output .tmp/sandbox-default.json`
  - `node .tmp/orchestrator/src/cli.js sandbox:import --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json --mode preview`
  - `node .tmp/orchestrator/src/cli.js sandbox:diff --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json`
  - `node .tmp/orchestrator/src/cli.js sandbox:review --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json`
  - `node .tmp/orchestrator/src/cli.js sandbox:apply --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json`
  - `node .tmp/orchestrator/src/cli.js sandbox:batch:preview --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profiles default,review --sandbox-bundle create-only`
  - `node .tmp/orchestrator/src/cli.js sandbox:batch:validate --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profiles default,review --sandbox-bundle create-only`
  - `node .tmp/orchestrator/src/cli.js sandbox:batch:apply --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profiles default,review --sandbox-bundle create-only --allow-partial false`
  - `node .tmp/orchestrator/src/cli.js sandbox:rollback:preview --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...`
  - `node .tmp/orchestrator/src/cli.js sandbox:rollback:validate --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...`
  - `node .tmp/orchestrator/src/cli.js sandbox:rollback:apply --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...`
  - `node .tmp/orchestrator/src/cli.js sandbox:rollback:governance --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...`
  - `node .tmp/orchestrator/src/cli.js sandbox:batch-recovery:preview --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profiles default,review`
  - `node .tmp/orchestrator/src/cli.js sandbox:batch-recovery:validate --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-ids sandbox-restore:...,sandbox-restore:...`
  - `node .tmp/orchestrator/src/cli.js sandbox:batch-recovery:apply --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-ids sandbox-restore:...,sandbox-restore:... --allow-partial true`
- safe operator flow:
  - inspect available bundles with `sandbox:bundle:list` and `sandbox:bundle:show`
  - inspect `sandbox:bundle:governance` before attaching a bundle to an existing or default profile
  - create or update the sandbox profile
  - optionally attach a bundle with `--sandbox-bundle create-only|update-only|create-or-update|default|repo-specific`
  - set the default profile if you want smoke runs without explicit override
  - list and show the active profile set
  - validate the selected profile before running a live success smoke
  - inspect `sandbox:governance` before switching the default profile
  - inspect `sandbox:audit` to confirm the latest profile changes
  - use `sandbox:export` or `sandbox:import --mode preview` before moving or restoring profiles
  - use `sandbox:diff` or `sandbox:review` to inspect change sets before `sandbox:apply`
  - use `sandbox:batch:preview` before any multi-profile bundle rollout
  - use `sandbox:batch:validate` after preview if you need a gated all-clear before `sandbox:batch:apply`
  - inspect `sandbox:restore-points` before rollback so you know which apply/import/batch change will be undone
  - use `sandbox:history` or `sandbox:rollback:history` when you need an operator-readable trail of restore-point creation, rollback attempts, and batch recovery activity
  - use `sandbox:compare` before rollback apply when you need a readable diff between current config and a restore point, or between two restore points
  - use `sandbox:recovery:diagnostics` when you need a compact incident summary, blocked/manual_required hot spots, and restore-point health
  - use `sandbox:incident:governance` when you need recovery incidents classified by severity before choosing an operator action
  - use `sandbox:governance:status` when you need the shared recovery governance snapshot instead of rebuilding operator guidance by hand
  - use `sandbox:incident:policy` when you need the centralized incident policy matrix for the latest or selected incident
  - use `sandbox:incident:acknowledge`, `sandbox:incident:resolve`, `sandbox:incident:escalate`, or `sandbox:incident:request-review` for operator-side incident handling
  - use `sandbox:incident:rerun-preview`, `sandbox:incident:rerun-validate`, or `sandbox:incident:rerun-apply` only when the incident still points to a valid restore point and governance permits a rerun
  - use `sandbox:escalation:summary` when you need a compact view of unresolved incidents, escalation-needed count, and repeated blocked/manual_required hotspots
  - use `sandbox:operator:handoff` when you need a one-line handoff plus warnings, hotspots, and next-step guidance for the next operator
  - use `sandbox:resolution:evidence` when you need the shared evidence summary that diagnostics, handoff, readiness, and closure-check all consume
  - use `sandbox:resolution:readiness` when you need a centralized answer for whether the latest incident set is closure-ready, still operator-flow, or review/escalation-gated
  - use `sandbox:resolution:audit` when you need the closeout audit trail that captures the exact evidence/readiness/gating snapshot used during a closure check
  - use `sandbox:resolution:audit:history` when you need the recent closeout trail, repeated blocked/review_required/resolved_not_ready patterns, and the latest/previous audit pair in one place
  - use `sandbox:incident:closure-check` when you need the explicit closure gating decision, blocked reason codes, and next action before treating an incident as safely closed
  - use `sandbox:closeout:summary` when you need the operator-readable closeout decision, evidence sufficiency, and latest audit line in one view
  - use `sandbox:closeout:checklist` when you need the closeout checklist that shows which governance/evidence items are still unsatisfied before closure
  - use `sandbox:closeout:review:summary` when you need a human-readable answer for whether closeout is complete, review_pending, escalation_pending, or resolved_but_followup_needed
  - use `sandbox:closeout:review:queue` when you need the current governance queue of closeout items that still require review, escalation, or evidence follow-up
  - use `sandbox:closeout:review:approve`, `sandbox:closeout:review:reject`, `sandbox:closeout:review:followup`, `sandbox:closeout:review:defer`, or `sandbox:closeout:review:reopen` when you need to leave a formal closeout review decision trail without changing live sandbox config
  - use `sandbox:closeout:disposition:summary` when you need the formal governance disposition for the latest closeout review decision
  - use `sandbox:closeout:review:lifecycle` when you need the queue-retain vs queue-exit interpretation for the latest review decision
  - inspect `sandbox:rollback:governance` before any rollback apply if you need to know whether a restore point is stale, default-unsafe, or otherwise blocked
  - always run `sandbox:rollback:preview` before `sandbox:rollback:validate` or `sandbox:rollback:apply`
  - use `sandbox:batch-recovery:preview` and `sandbox:batch-recovery:validate` before any multi-restore recovery
  - prune stale restore points with `sandbox:restore-points:prune`, but only after checking whether recent audit or manual_required work still references them
  - run `reporting:precheck` to confirm target resolution, governance, guardrails, and permission readiness
  - only run `reporting:run-live-smoke` or `reporting:live-success-smoke` when the profile resolves to a known-safe repo/issue/pr target
- bundle rules:
  - built-in bundles include `default`, `create-only`, `update-only`, `create-or-update`, and `repo-specific`
  - bundle governance checks:
    - bundle must be enabled
    - bundle must be marked `allowAsDefault=true` before it can back the default profile
    - bundle must be marked `allowLiveSmoke=true` before live smoke guardrails will accept it
    - profile target type must be included in `allowedProfileTargetTypes`
    - repo-pinned bundles cannot be applied to a profile targeting a different repository
  - a profile may store `bundleId` plus `overrideFields`
  - bundle metadata is operator-facing; the resolved profile still expands into a concrete repo/type/number/action target before governance or live smoke runs
  - if a bundle leaves required target data unset, the operator flow returns `manual_required`
- lifecycle guardrails:
  - deleting the default profile clears it and promotes the first remaining enabled profile when possible
  - disabled profiles cannot become the default profile
  - a default profile that violates governance cannot become the default
  - missing or invalid profiles return `manual_required` instead of falling back to arbitrary live threads
- import/export and review/apply:
  - `sandbox:export` can export one profile or the full registry; `--snapshot true` writes a point-in-time registry snapshot
  - `sandbox:import --mode preview` never writes live config; it only resolves the incoming payload, computes diff, and reports governance/guardrails outcomes
  - `sandbox:diff` is the operator-friendly shorthand when you want the change summary without writing anything
  - `sandbox:review` records a review decision in sandbox audit without applying the config change
  - `sandbox:apply` only writes when bundle references, governance, default safety, and guardrails all pass
  - every non-no-op `sandbox:apply`, import apply, and batch apply creates a restore point before writing the live config
  - `sandbox:batch:preview` shows:
    - affected profile count
    - changed field summary
    - blocked profiles
    - manual_required profiles
    - default profile impact
  - `sandbox:batch:validate` requires the batch to pass governance, guardrails, conflict checks, and default profile safety
  - `sandbox:batch:apply` returns one of `applied`, `partially_applied`, `blocked`, `manual_required`, or `failed`
  - `sandbox:rollback:preview` shows the rollback diff and impact summary without changing live config
  - `sandbox:rollback:governance` reports whether a restore point is still valid, stale, default-safe, and structurally compatible with the current registry
  - `sandbox:rollback:validate` re-runs governance, guardrails, restore point availability, and default profile safety before apply
  - `sandbox:rollback:apply` returns one of `restored`, `blocked`, `manual_required`, `failed`, or `no_op`
  - `sandbox:batch-recovery:preview` / `validate` / `apply` work across multiple restore points or profile-backed restore coverage, and report `restored`, `partially_restored`, `blocked`, `manual_required`, `failed`, or `no_op`
  - `sandbox:history` supports `restore_points`, `rollback`, `batch_recovery`, or `all`
  - `sandbox:compare` supports:
    - current registry vs one restore point
    - restore point A vs restore point B
    - a shared readable diff summary for preview and diagnostics
  - `sandbox:recovery:diagnostics` summarizes:
    - current valid restore point count
    - recent rollback/batch recovery incidents
    - blocked/manual_required hot spots
    - expired and still-referenced restore points
  - recovery incidents are classified as `info`, `warning`, `blocked`, `manual_required`, or `critical`
  - recovery governance status is centralized into one shared summary that records:
    - latest incident severity/type/summary
    - unresolved incident count
    - escalation-needed count
    - latest operator action/action status
    - whether rerun is recommended
    - whether manual review is required
    - whether apply is blocked
  - resolution evidence, readiness, closure gating, resolution audit, closeout summary, closeout checklist, closeout review summary, and closeout review queue are all operator-governance summaries only; they do not create a new recovery execution path
  - `mark_resolved` remains operator metadata; it does not mean the incident is fixed, and it does not by itself remove the incident from closeout review
  - interpret repeated closeout patterns as follows:
    - repeated `blocked` means the same blocked reason keeps preventing closure and operator flow should stop at review/escalation instead of retrying apply
    - repeated `review_required` means the same review gate is being hit across multiple closeout attempts and the incident should stay in the review queue
    - repeated `resolved_not_ready` means the incident was marked resolved more than once without enough evidence or gating clearance to close it safely
  - interpret the closeout review queue as a governance backlog, not an execution queue:
    - `review_pending` means the closeout item still needs operator review before it can be considered complete
    - `escalation_pending` means the closeout item still needs escalation before it can leave the queue
    - `evidence_follow_up` means the closeout item still lacks enough rerun/validate/apply evidence to be treated as complete
    - `blocked` means the closeout item is still in a terminal blocked/manual_required condition and must not be treated as complete
  - closeout is only considered complete when:
    - the closeout summary says closure-ready
    - the checklist says safe-to-closeout
    - the review queue no longer carries the item as pending follow-up
    - the latest resolution audit line confirms the evidence/readiness/gating snapshot used for that decision
    - whether operator handoff is recommended
  - incident severity mapping includes:
    - missing or expired restore point -> `manual_required`
    - governance or guardrails failure -> `blocked`
    - default profile safety or high-risk compare diff -> `critical`
    - partial batch recovery or repeated blocked hotspot -> `warning`
  - operator actions are classified as `accepted`, `blocked`, `rejected`, or `manual_required`
  - the incident policy matrix is the single source of truth for:
    - recommended action
    - whether `rerun_preview`, `rerun_validate`, or `rerun_apply` is allowed
    - whether `request_review` or `escalate` is mandatory
    - whether the incident is already in a blocked/manual-required terminal state
  - `critical` and `manual_required` incidents never recommend direct `rerun_apply`
  - `sandbox:incident:rerun-*` re-enters rollback preview/validate/apply, so it still re-checks governance, guardrails, restore point availability, and default profile safety
  - `sandbox:escalation:summary` highlights:
    - latest unresolved incident
    - latest operator action
    - high-severity unresolved incident count
    - repeated blocked/manual_required profile hotspots
  - `sandbox:operator:handoff` highlights:
    - latest incident summary
    - latest action summary
    - unresolved/repeated hotspots
    - governance warnings
    - escalation recommendation
    - a short operator handoff line
  - resolution evidence is centralized into one shared summary that records:
    - latest incident severity/type/summary
    - latest operator action trail
    - whether `rerun_preview`, `rerun_validate`, `rerun_apply`, `request_review`, or `escalate` were attempted
    - unresolved/repeated hotspots
    - evidence gaps and the next evidence that should be collected
    - closure confidence
  - resolution readiness is centralized into one shared summary that records:
    - whether unresolved incidents remain
    - whether escalation or manual review is still required
    - whether rerun/validate/apply evidence exists
    - whether closure is currently allowed
    - blocked reason codes and the recommended next step before closure
  - closure gating is the single source of truth for deciding whether `mark_resolved` can be treated as closure-ready:
    - `critical`, `blocked`, and `manual_required` situations do not become closure-ready just because an operator recorded `mark_resolved`
    - missing evidence gaps block closure even when the latest action is `mark_resolved`
    - `resolved` is operator metadata; it is not equivalent to verified remediation
    - reason codes are shared by CLI, diagnostics, and runbook guidance so closure decisions stay consistent
  - compatibility fields such as `lastIncidentType`, `lastIncidentSeverity`, `lastIncidentSummary`, `lastOperatorAction`, and `lastOperatorActionStatus` remain in state for older consumers, but they are now derived from the centralized governance/readiness/evidence summaries instead of being maintained separately
  - operator closure interpretation:
    - `closure_ready` means the current incident set has no remaining governance/evidence blockers and may be treated as safely closed
    - `operator_flow` means the incident is not terminally blocked, but more preview/validate/apply or operator review work is still expected
    - `review_required` means request-review or escalation must happen before the incident can move toward closure
    - `resolved_not_ready` means an operator already marked the incident resolved, but governance still says do not close it yet
    - `blocked` means closure is stopped by a terminal blocked/manual-required condition and should not proceed without manual intervention
  - resolution closeout audit is centralized into one shared log that records:
    - the evidence snapshot used during the closure decision
    - the readiness snapshot used during the closure decision
    - the closure gating snapshot used during the closure decision
    - the final closeout decision plus blocked reasons
    - whether review, escalation, or validation evidence was still required
  - closeout summary is centralized into one shared operator view that records:
    - latest closeout decision
    - evidence sufficiency summary
    - readiness summary
    - gating summary
    - unresolved hotspot summary
    - governance warnings
    - next step after closeout check
  - closeout checklist is centralized into one shared operator checklist that records:
    - rerun preview / validate / apply evidence satisfaction
    - unresolved incident clearance
    - review/escalation satisfaction
    - blocked/manual_required terminal-state checks
    - evidence gaps and governance warnings
    - whether closeout is currently safe
  - closeout interpretation rules:
    - `mark_resolved` remains operator metadata only; it does not prove remediation or closure readiness by itself
    - `closeout summary` may still show `resolved_not_ready` even after an operator marked the incident resolved
    - `closeout checklist` should be treated as the final operator sanity check before closure handoff
    - `closeout audit` is the traceable record to review during handoff or post-incident review when you need to know why closure was or was not allowed
  - closeout review actions are centralized into one shared governance trail that records:
    - the latest formal review action (`approve_closeout`, `reject_closeout`, `request_followup`, `defer_review`, `reopen_review`)
    - the latest review action status/reason/note
    - whether closeout was approved, rejected, deferred, reopened, or kept open for follow-up
    - a short review action summary line suitable for diagnostics and handoff
  - closeout disposition summary is centralized into one shared operator view that records:
    - the latest formal review action and status
    - the latest evidence/readiness/gating summaries used for disposition
    - the disposition result (`closeout_approved`, `closeout_rejected`, `followup_required`, `review_deferred`, `reopened_for_review`)
    - disposition reasons, warnings, and whether queue exit is currently allowed
  - closeout review lifecycle is centralized into one shared governance state that records:
    - whether the review queue should remain open or may exit
    - whether closeout is complete, reopened, deferred, or returned to follow-up
    - lifecycle reasons and the recommended next operator step
  - closeout review audit trail is centralized into one shared governance record that stores, per review decision:
    - the formal review action/status/reason/note
    - the exact disposition/lifecycle/review-queue/review-summary snapshots used at decision time
    - whether the review thread reopened, whether follow-up remained open, and whether queue exit was allowed
    - queue-retained reasons and missing follow-up/evidence signals for post-closeout review
  - closeout review history is centralized into one shared trend summary that records:
    - the latest and previous review audit entry
    - repeated reject/follow-up/defer/reopen patterns
    - repeated queue-retained versus queue-exit patterns across the same review thread
  - closeout review resolution summary is centralized into one shared settling decision that records:
    - whether the review thread is `review_settled`, `review_reopened`, `followup_open`, `deferred_pending`, or `rejected_not_resolved`
    - whether queue exit is truly allowed
    - whether the closeout may be treated as fully reviewed
    - unresolved review reasons and the next operator step
  - closeout settlement audit is centralized into one shared settlement decision record that stores:
    - the exact review-resolution / review-queue / follow-up snapshots used when deciding whether the thread is settled
    - whether settlement is `settlement_allowed`, `settlement_blocked`, `followup_open`, `review_complete`, or `closeout_complete`
    - settlement blocked reasons, supporting reasons, queue-retained reasons, missing evidence, and missing follow-up signals
    - whether the case may be treated as `review-complete` or `closeout-complete`
  - closeout follow-up summary is centralized into one shared follow-up interpretation that records:
    - whether follow-up is `no_followup_needed`, `followup_open`, `followup_blocking_settlement`, or `followup_blocking_closeout_complete`
    - whether review may be treated as complete, whether closeout may be treated as complete, and what still blocks settlement
    - follow-up reasons, evidence gaps, governance warnings, and the recommended next operator step
  - closeout follow-up queue is centralized into one shared governance backlog that records:
    - which closeout items still have open follow-up obligations
    - whether settlement is blocked, whether review is complete, and whether closeout is complete
    - blocked reasons, missing evidence, and the next operator step required before queue exit
  - closeout completion audit is centralized into one shared completion decision record that stores:
    - the exact settlement / follow-up summary / follow-up queue snapshots used when deciding whether a case is `review-complete`, `closeout-complete`, or still incomplete
    - whether completion is `review_complete_allowed`, `closeout_complete_allowed`, `completion_blocked`, `followup_open`, or `queue_retained`
    - completion blocked reasons, supporting reasons, queue-retained reasons, missing evidence, and missing follow-up signals
  - closeout completion summary is centralized into one shared completion interpretation that records:
    - whether the case is `review_complete`, `closeout_complete`, `completion_blocked`, `followup_still_open`, or `queue_still_retained`
    - whether review-complete has truly been reached, whether closeout-complete has truly been reached, and what still blocks completion
    - completion reasons, evidence gaps, governance warnings, and the recommended next operator step
  - closeout completion queue is centralized into one shared governance backlog that records:
    - which closeout items still have not reached `review-complete` or `closeout-complete`
    - whether follow-up remains open, whether settlement is blocked, and whether completion is still blocked
    - blocked reasons, missing evidence, and the next operator step required before completion queue exit
  - review action interpretation:
    - `approve_closeout` only becomes effective when the existing closeout summary/checklist already say the incident is safe to close; otherwise it remains blocked/manual_required/rejected
    - `reject_closeout` keeps follow-up open and should be treated as an explicit governance refusal to close the incident
    - `request_followup` means evidence or operator follow-up still remains open before closeout
    - `defer_review` means the item stays in review_pending and should be handed off, not treated as complete
    - `reopen_review` means the item re-enters review and must stay in the governance queue
  - queue exit rules:
    - queue exit is only allowed when disposition is `closeout_approved`, the queue is empty for the latest audit item, and the existing closeout checklist still says safe-to-closeout
    - `critical`, `manual_required`, and `blocked` situations still must not be treated as queue-exitable or closeout-complete even after a review action exists
  - review-thread interpretation rules:
    - repeated `reopen_review`, repeated `reject_closeout`, or repeated `request_followup` means the review thread is not settled even if one individual action was accepted
    - `sandbox:closeout:review:audit`, `sandbox:closeout:review:history`, and `sandbox:closeout:review:resolution` should be read together when you need to know why a review thread is still open or why it was allowed to settle
    - `sandbox:closeout:settlement:audit`, `sandbox:closeout:followup:summary`, and `sandbox:closeout:followup:queue` should be read together when you need to know whether settlement really holds, whether follow-up still blocks closeout, and why a case is still retained in governance
    - `sandbox:closeout:completion:audit`, `sandbox:closeout:completion:summary`, and `sandbox:closeout:completion:queue` should be read together when you need to know why a case is still not `review-complete` or `closeout-complete`
    - a review thread is only considered fully reviewed when the review resolution summary says `review_settled`; settlement may still be blocked if follow-up remains open
    - a closeout is only considered complete when settlement audit says `closeout_complete`; `review_complete` by itself still means closeout-complete may be blocked by open follow-up obligations
    - `followup_open` or `queue_retained` in completion audit means the case must stay in governance, even if settlement itself looked allowed
    - `closeout_complete` should only be treated as final when completion summary says `closeout_complete` and completion queue is empty
  - restore retention keeps the latest restore point, the recent N restore points, restore points referenced by recent rollback audit, and any restore point still associated with unresolved manual_required work
  - `sandbox:restore-points:prune` only removes expired restore points that are not protected by retention rules
  - no-op apply or no-op rollback does not create a new restore point
  - import payloads may be:
    - a single profile payload (`kind=profile`)
    - a full registry payload (`kind=registry`)
    - a snapshot payload (`kind=snapshot`)
  - import/apply outcomes are classified as:
    - `create`
    - `update`
    - `conflict`
    - `invalid`
    - `blocked`
    - `manual_required`
- audit trail:
  - `create`, `update`, `delete`, `set-default`, `enable`, and `disable` all write audit records
  - `review`, `import-apply`, `batch-apply`, `rollback-preview`, `rollback-validate`, and `rollback-apply` also write audit records so review/apply/rollback remains traceable
  - each audit record stores changed fields, previous summary, next summary, and command source
  - restore points persist affected profiles, previous bundle linkage, previous default profile state, and diff summary in a sidecar restore-point trail
  - recent audit summaries are surfaced in operator diagnostics and live smoke precheck output
  - incident operator actions are stored in a sidecar action trail so acknowledge/resolve/escalate/rerun decisions remain traceable
 - blocked/manual_required cases:
   - disabled bundle/profile -> `blocked`
   - default-unsafe bundle or profile -> `manual_required`
   - bundle/profile repository mismatch -> `manual_required`
   - no valid batch selection -> `manual_required`
   - batch with invalid profiles and `--allow-partial false` -> `blocked` or `manual_required`
   - missing restore point -> `manual_required`
  - rollback that would violate governance/guardrails/default safety -> `blocked` or `manual_required`
  - stale or missing restore point -> `manual_required`
  - batch recovery with missing coverage or invalid restore ids -> `manual_required`
  - expired restore point that is still referenced by recent audit -> retained until the operator explicitly resolves the related review/rollback flow
  - incident escalation is recommended when severity is `critical` or when the same blocked/manual_required profile keeps recurring
  - compare/history/diagnostics commands never bypass governance; they stay read-only and only update operator-facing summaries in state

Minimal registry example:
```json
{
  "version": "sandbox-v1",
  "defaultProfileId": "default",
  "bundles": {
    "repo-safe": {
      "repository": "example/bige",
      "targetType": "issue",
      "actionPolicy": "create_or_update",
      "enabled": true,
      "allowAsDefault": true,
      "allowLiveSmoke": true,
      "allowedProfileTargetTypes": ["issue", "pull_request"],
      "enabledByDefault": true,
      "governanceDefaults": {},
      "liveSmokeDefaults": {
        "allowCorrelatedReuse": true,
        "preferredSelectionMode": "default"
      },
      "notes": "repo safe bundle"
    }
  },
  "governance": {
    "allowedRepositories": ["example/bige"],
    "allowedTargetTypes": ["issue", "pull_request"],
    "allowedActionPolicies": ["create_or_update", "create_only", "update_only"],
    "defaultAllowedActionPolicies": ["create_or_update", "create_only"]
  },
  "profiles": {
    "default": {
      "repository": "example/bige",
      "targetType": "issue",
      "targetNumber": 101,
      "actionPolicy": "create_or_update",
      "bundleId": "repo-safe",
      "overrideFields": ["targetNumber"]
    }
  }
}
```

Delivery audit:
- every status reporting attempt records an audit entry with action, target, correlation id, readiness, permission result, provider, failure reason, and suggested next action
- recent attempts are persisted in `reportDeliveryAttempts`
- operator-facing views use these entries to explain whether the current strategy is `create`, `update`, `skip`, `blocked`, or `failed`

Operator commands:
```powershell
npm run orchestrator:reporting:smoke -- --state-id demo
npm run orchestrator:diagnostics -- --state-id demo
node .tmp/orchestrator/src/cli.js reporting:status --state-id demo
node .tmp/orchestrator/src/cli.js reporting:audit --state-id demo
node .tmp/orchestrator/src/cli.js reporting:permissions --state-id demo
node .tmp/orchestrator/src/cli.js reporting:target-check --state-id demo --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default
node .tmp/orchestrator/src/cli.js reporting:auth-smoke --state-id demo --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default
node .tmp/orchestrator/src/cli.js reporting:precheck --state-id demo --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default
node .tmp/orchestrator/src/cli.js reporting:run-live-smoke --state-id demo --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default
node .tmp/orchestrator/src/cli.js reporting:live-success-smoke --state-id demo --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default
node .tmp/orchestrator/src/cli.js sandbox:create --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default --target-repo example/bige --target-type issue --target-number 101 --set-default true
node .tmp/orchestrator/src/cli.js sandbox:update --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default --notes "safe smoke target"
node .tmp/orchestrator/src/cli.js sandbox:delete --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile old-profile
node .tmp/orchestrator/src/cli.js sandbox:set-default --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default
node .tmp/orchestrator/src/cli.js sandbox:list --sandbox-config .tmp/orchestrator-sandbox.json
node .tmp/orchestrator/src/cli.js sandbox:bundle:list --sandbox-config .tmp/orchestrator-sandbox.json
node .tmp/orchestrator/src/cli.js sandbox:bundle:show --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-bundle create-only
node .tmp/orchestrator/src/cli.js sandbox:bundle:governance --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-bundle create-only --sandbox-profile default
node .tmp/orchestrator/src/cli.js sandbox:show --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default
node .tmp/orchestrator/src/cli.js sandbox:validate --state-id demo --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default
node .tmp/orchestrator/src/cli.js sandbox:governance --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default
node .tmp/orchestrator/src/cli.js sandbox:audit --sandbox-config .tmp/orchestrator-sandbox.json
node .tmp/orchestrator/src/cli.js sandbox:restore-points --sandbox-config .tmp/orchestrator-sandbox.json
node .tmp/orchestrator/src/cli.js sandbox:guardrails --state-id demo --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default
node .tmp/orchestrator/src/cli.js sandbox:export --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profile default --output .tmp/sandbox-default.json
node .tmp/orchestrator/src/cli.js sandbox:import --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json --mode preview
node .tmp/orchestrator/src/cli.js sandbox:diff --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json
node .tmp/orchestrator/src/cli.js sandbox:review --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json
node .tmp/orchestrator/src/cli.js sandbox:apply --sandbox-config .tmp/orchestrator-sandbox.json --input .tmp/sandbox-default.json
node .tmp/orchestrator/src/cli.js sandbox:batch:preview --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profiles default,review --sandbox-bundle create-only
node .tmp/orchestrator/src/cli.js sandbox:batch:validate --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profiles default,review --sandbox-bundle create-only
node .tmp/orchestrator/src/cli.js sandbox:batch:apply --sandbox-config .tmp/orchestrator-sandbox.json --sandbox-profiles default,review --sandbox-bundle create-only --allow-partial false
node .tmp/orchestrator/src/cli.js sandbox:rollback:preview --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...
node .tmp/orchestrator/src/cli.js sandbox:rollback:validate --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...
node .tmp/orchestrator/src/cli.js sandbox:rollback:apply --sandbox-config .tmp/orchestrator-sandbox.json --restore-point-id sandbox-restore:...
```

Typical next actions:
- missing token -> provide `GITHUB_TOKEN` or `GH_TOKEN`
- missing `gh` -> install `gh` and ensure it is on `PATH`
- invalid target -> re-run from a valid issue/PR thread or let the next create path recreate correlation
- update denied / correlation not updatable -> use a token that can patch the correlated comment, or clear the stale target and recreate it
- no sandbox target -> provide explicit `--target-repo`, `--target-type`, `--target-number`, or intentionally allow correlated reuse for a known-safe thread
- no sandbox registry profile -> add a registry profile for the current orchestrator task profile, or pass `--sandbox-profile`
- governance failed -> update the profile or registry governance so the selected repo/type/action policy becomes explicitly safe
- guardrails failed -> fix the selected/default/fallback profile before re-running live smoke; the orchestrator will not continue into GitHub live smoke
- sandbox audit review -> use `sandbox:audit` before and after profile lifecycle changes if you need a change trace
- bundle missing -> add the bundle definition or remove the stale `bundleId` before review/apply
- bundle governance failed -> inspect `sandbox:bundle:governance` and fix `enabled`, `allowAsDefault`, `allowLiveSmoke`, or target-type compatibility
- import preview blocked -> inspect `lastSandboxDiffSummary`, `lastSandboxReviewStatus`, and the first blocked reason before retrying
- restore point missing -> inspect `sandbox:restore-points` and pick a valid restore point id before rollback
- rollback blocked -> inspect `lastRollbackImpactSummary`, `lastRollbackAuditId`, and the first governance or guardrails failure before retrying
- default profile unsafe -> change the action policy or choose a safer default before `sandbox:apply`
- batch preview blocked -> inspect `lastBatchImpactSummary`, `lastBatchBlockedProfiles`, and decide whether `--allow-partial true` is actually acceptable

Live auth evidence:
- every auth smoke run writes a JSON evidence file and stores its path in `lastAuthSmokeEvidencePath`
- evidence captures:
  - attempted time
  - selected sandbox profile / selection mode / selection reason
  - governance result / guardrails result
  - sandbox profile/config version
  - sandbox profile status
  - target selection result
  - permission result
  - final action (`success`, `failed`, `skip`, `blocked`)
  - provider used
  - last comment id / target reference
  - failure reason / next action
- this path is safe to inspect even when auth smoke is blocked or skipped
- a successful live smoke also updates:
  - `selectedSandboxProfileId`
  - `sandboxProfileSelectionMode`
  - `sandboxProfileSelectionReason`
  - `lastAuthSmokeSuccessAt`
  - `lastLiveSmokeSummary`
  - `lastLiveSmokeTarget`
  - `lastStatusReportTarget`
  - `lastStatusReportAction`

## Inbound Audit
Every accepted, rejected, ignored, or duplicate webhook intake now records inbound audit metadata.

Persisted audit fields include:
- `receivedAt`
- `deliveryId`
- `eventType`
- `actor`
- `signatureStatus`
- `parsedCommand`
- `authorizationDecision`
- `replayDecision`
- `routingDecision`
- linked `taskId` / `stateId`
- status correlation id / target when reporting occurs

Operator commands:
```powershell
npm run orchestrator:inbound:list
npm run orchestrator:inbound:inspect -- --inbound-id <id>
```

Diagnostics can now show:
- whether the webhook passed signature verification
- whether actor policy rejected the command
- whether replay protection blocked the delivery
- which task/state was created or reused
- which status comment target was updated or skipped

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
npm run orchestrator:webhook:serve -- --port 8787 --webhook-path /github
npm run orchestrator:actor-policy:check -- --actor octocat --command status
npm run orchestrator:inbound:list
npm run orchestrator:inbound:inspect -- --inbound-id inbound-123
npm run orchestrator:status:report -- --state-id demo
npm run orchestrator:status -- --state-id demo
npm run orchestrator:diagnostics -- --state-id demo
```

Diagnostics summarize:
- current state / iteration
- current profile
- source event / delivery / signature / idempotency / trigger policy
- runtime health / readiness
- actor policy config version and authorization status
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
npm run test:orchestrator:github-live-report
npm run test:orchestrator:github-report-permissions
npm run test:orchestrator:report-delivery-audit
npm run test:orchestrator:reporting-operator-summary
npm run test:orchestrator:github-live-auth-smoke
npm run test:orchestrator:github-live-auth-matrix
npm run test:orchestrator:github-live-targeting
npm run test:orchestrator:github-live-auth-success
npm run test:orchestrator:github-sandbox-targets
npm run test:orchestrator:github-live-auth-evidence
npm run test:orchestrator:github-live-success-smoke
npm run test:orchestrator:sandbox-profile-ops
npm run test:orchestrator:live-report-runbook
npm run test:orchestrator:sandbox-profile-lifecycle
npm run test:orchestrator:live-auth-operator-flow
npm run test:orchestrator:sandbox-default-selection
npm run test:orchestrator:sandbox-governance-status
npm run test:orchestrator:sandbox-incident-policy-matrix
npm run test:orchestrator:sandbox-operator-handoff-summary
npm run test:orchestrator:sandbox-resolution-readiness
npm run test:orchestrator:sandbox-resolution-evidence-summary
npm run test:orchestrator:sandbox-closure-gating
npm run test:orchestrator:sandbox-resolution-audit-log
npm run test:orchestrator:sandbox-closeout-summary
npm run test:orchestrator:sandbox-closeout-operator-checklist
npm run test:orchestrator:sandbox-resolution-audit-history
npm run test:orchestrator:sandbox-closeout-review-summary
npm run test:orchestrator:sandbox-closeout-review-queue
npm run test:orchestrator:sandbox-closeout-review-actions
npm run test:orchestrator:sandbox-closeout-disposition-summary
npm run test:orchestrator:sandbox-closeout-review-lifecycle
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
- GitHub event intake now supports a local webhook receiver, but it is still a standalone orchestrator service and not wired into the main product runtime.
- GitHub status reporting is comment/payload oriented; it does not auto-merge, auto-approve, or bypass human review.
- Comment upsert relies on stored target metadata plus marker-based correlation; it does not rewrite issue or PR body content.
- Actor authorization is currently env-backed allowlist policy, not a full GitHub org/team role sync model.
- Replay protection is delivery/event aware, but still bounded by the persisted audit store and not a full distributed anti-replay service.
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
- webhook receiver is now a standalone local Node service with health/readiness endpoints, but it is still not wired into the main product runtime
- webhook hosting is deployable as a standalone orchestrator service, but it is still intentionally separate from the main product runtime
- graceful shutdown is best-effort and conservative; it stops new requests and lets in-flight work finish, but it is not a full process supervisor
- actor policy config is JSON/env based for now; it does not sync GitHub org/team/role membership
- live GitHub comment reporting is gated by token + `gh`; without them the system degrades to payload-only reporting instead of hard-failing ingress
