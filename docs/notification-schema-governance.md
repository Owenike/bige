# Notification Schema Governance

## Scope
This document governs the notification productization side tables only.  
It does **not** change Phase 1 cron/runtime behavior.

## Table classification

### Product tables (configuration surface)
- `notification_role_preferences`
- `notification_user_preferences`
- `notification_templates`

### Ops tables (delivery + operation evidence)
- `notification_job_runs`
- `notification_deliveries`
- `notification_admin_audit_logs`

### Runtime core tables (already in main chain)
- `in_app_notifications`

### Debug tables (infra observability only)
- `cron_probe_runs`

## Migration phase map (notification-only)
- `20260307193000_phase7_in_app_notifications.sql`: runtime notification core + job tables.
- `20260309100000_phase12_external_notification_channels.sql`: external channel provider columns.
- `20260309123000_phase2_notification_productization_foundations.sql`: preferences/templates foundations.
- `20260310150000_cron_probe_runs.sql`: cron reachability debug evidence.
- `20260311070000_notification_admin_audit_logs.sql`: admin trace foundation for preference/template/retry operations.

## Seed strategy

### Demo seed
- Source: [phase2 demo seed json](/c:/Users/User/bige/docs/phase2-notification-productization-demo-seed.json)
- Purpose: manual page/API demo data flow.
- Rule: demo seed is not runtime dispatch seed.

### Test seed
- Source: [notification productization test seed sql](/c:/Users/User/bige/supabase/seeds/notification_productization_test_seed.sql)
- Purpose: local/staging integration checks for productization tables.
- Rule: do not run in production without tenant-specific review.

## Post-migration checks
`supabase/post_migration_checks.sql` now validates:
- `notification_role_preferences`
- `notification_user_preferences`
- `notification_templates`
- `notification_admin_audit_logs`
- `cron_probe_runs`

## Backfill / rollback / cleanup policy

### Backfill
- Never backfill into `notification_job_runs` for productization debug.
- Backfill product tables only with explicit tenant scope.
- Keep idempotent keys at `(tenant, role, event)` / `(tenant, user, event)` / `(scope,event,channel,locale,version)`.

### Rollback
- Rollback order:
1. disable API entry points that write new rows
2. archive/export affected productization rows
3. rollback migration objects
4. re-run `post_migration_checks.sql`
- Do not rollback Phase 1 runtime tables as part of productization rollback.

### Cleanup
- `cron_probe_runs` can be archived then dropped after cron validation closes.
- `notification_admin_audit_logs` should be retained longer than UI operation windows for traceability.
