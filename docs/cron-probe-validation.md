# Cron Probe Validation (Temporary Debug)

## Purpose
Isolate and validate infrastructure reachability for:

`Vercel Cron -> production route`

without touching notification job business semantics.

## Temporary debug components
- Route: `/api/cron-probe` (GET only)
- Table: `public.cron_probe_runs`
- Cron (temporary): `*/15 * * * * -> /api/cron-probe`

## Safety constraints
- Probe route does **not** trigger notification business logic.
- Probe evidence is written to `cron_probe_runs`, not `notification_job_runs`.
- Only GET is implemented.
- Header logging is sanitized: secrets are never stored.

## Verify after deployment
1. Confirm latest production deployment is Ready and aliased to `www.olinextech.com`.
2. Confirm `vercel.json` contains both cron entries:
   - `/api/jobs/run` (existing schedule)
   - `/api/cron-probe` (temporary 15-minute debug schedule)
3. Wait for next 15-minute boundary.
4. Query DB evidence:

```bash
npm run check:cron-probe
```

Optional time window:

```bash
npm run check:cron-probe -- --from 2026-03-10T12:00:00Z --to 2026-03-10T12:30:00Z
```

## Interpretation
- `probe rows exist` + `is_cron_like=true`:
  - Cron infrastructure can hit production route.
- `probe rows exist` + `is_cron_like=false` only:
  - Route can be hit, but not by cron-like requests; verify actual cron trigger.
- `no probe rows` during expected windows:
  - Likely infra/project/deployment cron attachment mismatch, or cron not active.

## Decision matrix with jobs route
- Probe hit + `/api/jobs/run` still no scheduled rows:
  - Infra likely OK; narrow scope to `/api/jobs/run` scheduled classification/auth/path.
- Probe not hit + `/api/jobs/run` not hit:
  - Prioritize Vercel project/deployment/root/cron attachment checks.

## Removal plan (after validation)
1. Remove temporary cron entry for `/api/cron-probe` from `vercel.json`.
2. Remove `/api/cron-probe` route.
3. Keep or archive `cron_probe_runs` table per audit policy.

