# Orchestrator MVP Runbook

## Env
- Optional: `OPENAI_API_KEY`
- Optional: `ORCHESTRATOR_STORAGE_ROOT`
- Optional: GitHub CLI auth for `GitHubCliStatusAdapter`

## Initialize
```powershell
npm run orchestrator:init -- --state-id demo --goal "Build orchestrator MVP"
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
npm run orchestrator:run-once -- --state-id demo --executor mock
```

## Resume
```powershell
npm run orchestrator:resume -- --state-id demo --executor mock
```

## Review Last Iteration
```powershell
npm run orchestrator:review -- --state-id demo
```

## Approval Modes
- Human approval: `--approval-mode human_approval`
- Auto mode: `--approval-mode auto --auto-mode true`

When auto mode is off, the loop stops after planning and persists the plan in state.

## State Location
- Default: `.tmp/orchestrator-state/<state-id>.json`
- Override with `ORCHESTRATOR_STORAGE_ROOT` or `--storage-root`

## Acceptance
Run the orchestrator MVP suite with:
```powershell
npm run test:orchestrator:typecheck
npm run test:orchestrator:lint
npm run test:orchestrator:unit
npm run test:orchestrator:integration
npm run test:orchestrator:schema
npm run test:orchestrator:policy
npm run test:orchestrator:mock-loop
npm run test:orchestrator:state-machine
```

## Provider Status
- Real today: `FileStorage`, `MockExecutor`, `LocalRepoExecutor`
- Stubbed for later: `SupabaseStorage`
- Optional real adapter: `GitHubCliStatusAdapter`
- Reserved for later: actual coding-agent / OpenAI execution provider
