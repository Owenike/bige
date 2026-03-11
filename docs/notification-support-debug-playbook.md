# Notification Support / Debug Playbook

## Scope
Support playbook for notification productization + ops read models.  
Does not modify runtime chain.

## Triage order
1. identify tenant scope and incident window
2. check read-only dashboard and ops API first
3. check DB rows for precise evidence
4. check runtime logs only when DB evidence is insufficient

## Common incidents

## 1) Failed delivery spike
- Check:
  - `notification_deliveries` (`status=failed`, `error_code`)
  - ops health/coverage API output
- Then:
  - inspect provider error code distribution
  - inspect template coverage for affected event/channel

## 2) Retrying stuck
- Check:
  - `notification_deliveries` (`status=retrying`, `next_retry_at`, `attempts/max_attempts`)
  - retry operations summary (`retryOperations`)
  - admin audit actions (`retry_dry_run`, `retry_execute`)
- Then:
  - inspect blocked reason distribution

## 3) Template missing
- Check:
  - template coverage summary
  - template resolution service fallback path
- Then:
  - add missing tenant/global template through management API

## 4) Preference missing
- Check:
  - preference coverage summary
  - role/event missing pair list
- Then:
  - add missing role preference row

## 5) Scheduled run missing
- Check:
  - `notification_job_runs` scheduled rows
  - cron probe evidence
  - jobs route logs (entry/scheduled/job-created markers)
- Then:
  - follow cron validation runbook

## Platform vs manager actions

### Platform can
- query global or tenant-scoped ops/audit data
- inspect cross-tenant trend

### Manager can
- inspect own tenant only
- review tenant health/coverage/audit within tenant boundary

## Data-first rule
- DB evidence is primary for incident confirmation.
- log evidence is secondary and time-retention constrained.
