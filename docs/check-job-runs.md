# Scheduled Job Run Checker

This project includes a read-only checker for `notification_job_runs`.

## Command

```bash
npm run check:job-runs
```

## What it checks

- `trigger_mode = scheduled`
- `job_type in (notification_sweep, opportunity_sweep, delivery_dispatch)`
- latest rows ordered by `created_at desc`
- when using `--today-tw-10-11`, also prints:
  - `tw_10_11_non_scheduled_count`
  - sample purity warning if non-scheduled runs exist in the same window

## Useful options

- Taiwan window check (today 10:00~11:00, Asia/Taipei):

```bash
npm run check:job-runs -- --today-tw-10-11
```

- Custom range:

```bash
npm run check:job-runs -- --from 2026-03-09T02:00:00Z --to 2026-03-09T03:00:00Z
```

- Limit and tenant filter:

```bash
npm run check:job-runs -- --limit 50 --tenant-id <tenant_uuid>
```

## Required environment variables

At least one Supabase URL plus service role key:

- `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The script loads env files in this order (without overwriting already-set vars):

1. `.env.local`
2. `.env.staging`
3. `.env.preview.local`
4. `.env.preview.current`
5. `.env`

## Safety

- Read-only query only.
- No insert/update/delete is performed.
