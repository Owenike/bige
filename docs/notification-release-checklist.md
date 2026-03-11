# Notification Release Checklist

## Pre-deploy
1. run `npm run typecheck`
2. run `npm run lint`
3. run `npm run test:unit`
4. confirm migration classification (product vs ops vs debug)
5. verify tenant scope and permission boundaries on new APIs
6. verify dashboard and read-only APIs return expected envelope
7. confirm no changes to `/api/jobs/run` and `vercel.json` for non-cron tasks

## Deploy
1. apply migrations in controlled order
2. deploy app build
3. verify deployment hash/environment mapping

## Post-deploy
1. smoke-check read-only notification ops APIs
2. smoke-check manager tenant scope enforcement
3. smoke-check audit read-only APIs
4. run config integrity report for target tenant(s)
5. review dashboard loading/error states

## Rollback
1. disable new entry route usage (if needed)
2. rollback app deployment
3. rollback migration only if schema issue confirmed
4. re-run post-migration checks
5. verify no runtime chain side effects

## Backfill / seed
1. backfill only productization tables with explicit tenant scope
2. never backfill `notification_job_runs` for debug scenarios
3. run test/demo seeds only in non-production or approved isolated tenant

## Cron/jobs acceptance notes
- cron validation and probe validation should follow dedicated runbook
- this checklist does not replace cron acceptance workflow
