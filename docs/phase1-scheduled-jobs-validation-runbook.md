# Phase 1 Scheduled Jobs Validation Runbook

## Goal
Validate the production/staging chain:

`Vercel cron -> /api/jobs/run -> scheduled flow -> notification_job_runs`

without mixing manual/API triggers into scheduled acceptance.

## Validation window
- Taiwan time: `20:00~21:00` (`Asia/Taipei`)
- Cron spec currently: `0 12 * * *` (UTC), which maps to 20:00 Taiwan.

## Preconditions
1. Latest deployment includes `GET/POST` shared handler in `/api/jobs/run`.
2. `vercel.json` contains:
   - `path: /api/jobs/run`
   - `schedule: 0 12 * * *`
3. Env is set correctly:
   - `JOBS_CRON_SECRET` or `CRON_SECRET` (if using secret mode)
   - Supabase runtime env for API route
4. During validation window, avoid clicking manual run buttons:
   - platform notifications ops "Run Scheduled Jobs Now"
   - manager notifications ops manual sweep/retry actions

## Commands
### A. Scheduled rows (latest)
```bash
npm run check:job-runs
```

### B. Taiwan 20:00~21:00 window
```bash
npm run check:job-runs -- --from 2026-03-11T12:00:00Z --to 2026-03-11T13:00:00Z
```

## Required log prefixes (Vercel Function Logs)
Search by route/function logs with:
- `[jobs/run][entry]`
- `[jobs/run][scheduled]`
- `[jobs/run][scheduled] dispatch`
- `[jobs/run][job:start]`
- `[jobs/run][job:created]`
- `[jobs/run][job:done]`
- `[jobs/run][job:error]`
- `[jobs/run] response`

## Success criteria
1. Queried UTC window contains scheduled rows.
2. At least one scheduled record exists for each expected `job_type`:
   - `notification_sweep`
   - `opportunity_sweep`
   - `delivery_dispatch`
3. Logs show route hit -> scheduled decision -> job start/create -> job done or job error with clear summary.

## Failure criteria
1. Queried UTC window contains no scheduled rows.
2. Scheduled logs missing or incomplete in the expected time window.

## Four-layer troubleshooting order
1. **No `[jobs/run][entry]`**
   - Cron did not reach the deployment/function.
   - Check Vercel deployment target and cron attachment.
2. **Has `[jobs/run][entry]` but no `[jobs/run][scheduled]`**
   - Request reached route but not classified as scheduled.
   - Check cron secret/header logic and env.
3. **Has `[job:start]` but no `[job:created]`**
   - `createJobRun` write failed (DB/env/permission/runtime issue).
4. **Has `[job:created]` but no `[job:done]`**
   - Job execution failed mid-run or `completeJobRun` failed.
   - Check `[job:error]` stage (`execute` or `completeJobRun`).

## Notes on sample purity
- Keep scheduled acceptance sample clean:
  - avoid manual `/api/jobs/run` execution during 20:00~21:00 validation window.
  - avoid manual sweep/retry actions in ops pages during the same window.
