# Phase 1 Deploy Preflight Checklist

Use this checklist before the Taiwan 10:00~11:00 scheduled-jobs acceptance window.

## 1) Deployment content
- [ ] Latest deployment includes `C:\Users\User\bige\app\api\jobs\run\route.ts` with both:
  - [ ] `export async function GET(...)`
  - [ ] `export async function POST(...)`
  - [ ] both routes use the same shared execution handler

## 2) Cron config
- [ ] `C:\Users\User\bige\vercel.json` has:
  - [ ] `path: /api/jobs/run`
  - [ ] `schedule: 0 2 * * *`
- [ ] No other conflicting cron config exists in repo/deployment.

## 3) Environment
- [ ] `JOBS_CRON_SECRET` or `CRON_SECRET` set as intended for scheduled auth mode.
- [ ] Supabase runtime env for API route is present and correct.
- [ ] `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` and keys point to target project.

## 4) Observability readiness
- [ ] Vercel Function Logs are accessible for current deployment.
- [ ] Log prefixes available:
  - [ ] `[jobs/run] hit`
  - [ ] `[jobs/run][scheduled]`
  - [ ] `[jobs/run][job:start]`
  - [ ] `[jobs/run][job:created]`
  - [ ] `[jobs/run][job:done]`
  - [ ] `[jobs/run][job:error]`

## 5) DB verification tooling
- [ ] Command works: `npm run check:job-runs`
- [ ] Command works: `npm run check:job-runs -- --today-tw-10-11`
- [ ] Script output clearly shows Taiwan and UTC ranges.

## 6) Sample purity guard
- [ ] During the 10:00~11:00 validation window, do not trigger manual run/retry/sweep actions from ops pages.
- [ ] Do not manually call `/api/jobs/run` during scheduled acceptance sampling.

