# Phase 1 Scheduled Jobs Validation Runbook

## Goal
Validate the production/staging chain:

`Vercel cron -> /api/jobs/run -> scheduled flow -> notification_job_runs`

without mixing manual/API triggers into scheduled acceptance.

## Validation window
- Taiwan time: `22:00~23:00` (`Asia/Taipei`)
- Cron spec currently: `0 14 * * *` (UTC), which maps to 22:00 Taiwan.

## Preconditions
1. Latest deployment includes `GET/POST` shared handler in `/api/jobs/run`.
2. `vercel.json` contains:
   - `path: /api/jobs/run`
   - `schedule: 0 14 * * *`
3. Env is set correctly:
   - Secret mode priority: incoming bearer / `x-cron-secret` must match `JOBS_CRON_SECRET` or `CRON_SECRET`.
   - Prefer setting `CRON_SECRET` in Production to force secret match.
   - If `CRON_SECRET` is empty, `/api/jobs/run` allows fallback only when request has all of:
     - `x-vercel-cron` header
     - `user-agent` includes `vercel-cron/`
     - Vercel runtime context (`x-vercel-id` + vercel host context)
   - Supabase runtime env for API route
4. During validation window, avoid clicking manual run buttons:
   - platform notifications ops "Run Scheduled Jobs Now"
   - manager notifications ops manual sweep/retry actions

## Commands
### A. Scheduled rows (latest)
```bash
npm run check:job-runs
```

### B. Taiwan 22:00~23:00 window
```bash
npm run check:job-runs -- --from 2026-03-11T14:00:00Z --to 2026-03-11T15:00:00Z
```

### C. Runtime logs stream (start at T-2 min before 22:00 Asia/Taipei)
```powershell
vercel logs https://<LATEST_PROD_DEPLOYMENT>.vercel.app --json | rg "\[jobs/run\]"
```

How to get `LATEST_PROD_DEPLOYMENT` quickly:
```powershell
vercel ls bige
```
Use the newest `Production` deployment URL from the first rows.

## Fastest verification flow (single cron window)
1. At `21:58` Asia/Taipei, start logs stream command above.
2. At `22:00` Asia/Taipei (=`14:00 UTC`), wait for logs and check for:
   - `[jobs/run][entry]`
   - `[jobs/run][scheduled]`
   - `scheduledReason` and flags (`hasCronSecret`, `hasIncomingSecret`, `isVercelCronUserAgent`)
   - `[jobs/run][job:created]`
3. At `22:02~22:05` Asia/Taipei, run:
```bash
npm run check:job-runs -- --from 2026-03-11T14:00:00Z --to 2026-03-11T14:10:00Z
```
4. If no rows, keep logs open until `22:06` and classify by first missing marker:
   - no `[entry]`
   - has `[entry]` but no `[scheduled]`
   - has `[auth-denied]` with `scheduledReason` in secret mismatch / missing secret categories
   - has `[scheduled]` but no `[job:created]`

## Required log prefixes (Vercel Function Logs)
Search by route/function logs with:
- `[jobs/run][entry]`
- `[jobs/run][scheduled]`
- `[jobs/run][api]`
- `[jobs/run][auth-denied]`
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
3. Logs show `[jobs/run][auth-denied]` during cron window.
4. Cron-like request returns HTTP `401` with message `Invalid or missing cron secret`.

## Four-layer troubleshooting order
1. **No `[jobs/run][entry]`**
   - Cron did not reach the deployment/function.
   - Check Vercel deployment target and cron attachment.
2. **Has `[jobs/run][entry]` but no `[jobs/run][scheduled]`**
   - Request reached route but not classified as scheduled.
   - Check `[jobs/run][api]` / `[jobs/run][auth-denied]` `scheduledReason`:
     - `x-vercel-cron_missing_secret_with_cron_secret_env`
     - `x-vercel-cron_secret_mismatch`
     - `cron_ua_missing_secret_header`
     - `cron_ua_secret_mismatch`
   - If reason is fallback/context related, verify `x-vercel-cron`, cron UA, and Vercel runtime context.
3. **Has `[job:start]` but no `[job:created]`**
   - `createJobRun` write failed (DB/env/permission/runtime issue).
4. **Has `[job:created]` but no `[job:done]`**
   - Job execution failed mid-run or `completeJobRun` failed.
   - Check `[job:error]` stage (`execute` or `completeJobRun`).

## Notes on sample purity
- Keep scheduled acceptance sample clean:
  - avoid manual `/api/jobs/run` execution during 22:00~23:00 validation window.
  - avoid manual sweep/retry actions in ops pages during the same window.
