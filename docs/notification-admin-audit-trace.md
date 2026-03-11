# Notification Admin Audit Trace

## Scope
Audit trace for Phase 2 notification management operations only:
- preference upsert
- template upsert
- retry dry-run
- retry execute

This audit chain is isolated from cron/runtime dispatch flow.

## Data model
- Table: `notification_admin_audit_logs`
- Migration: [20260311070000_notification_admin_audit_logs.sql](/c:/Users/User/bige/supabase/migrations/20260311070000_notification_admin_audit_logs.sql)
- Service: [notification-admin-audit.ts](/c:/Users/User/bige/lib/notification-admin-audit.ts)
- Non-blocking writer: `writeNotificationAdminAuditNonBlocking`

## Hooked routes (write only)

### Preferences upsert
- [platform preferences PUT](/c:/Users/User/bige/app/api/platform/notifications/preferences/route.ts)
- [manager preferences PUT](/c:/Users/User/bige/app/api/manager/notifications/preferences/route.ts)
- Action: `preference_upsert`

### Templates upsert
- [platform templates PUT](/c:/Users/User/bige/app/api/platform/notifications/templates/route.ts)
- [manager templates PUT](/c:/Users/User/bige/app/api/manager/notifications/templates/route.ts)
- Action: `template_upsert`

### Retry operations
- [platform retry POST](/c:/Users/User/bige/app/api/platform/notifications/retry/route.ts)
- [manager retry POST](/c:/Users/User/bige/app/api/manager/notifications/retry/route.ts)
- Actions:
  - `retry_dry_run`
  - `retry_execute`

Read-only GET routes are intentionally not audited.

## Stored fields
- actor: `actor_user_id`, `actor_role`
- scope: `platform` or `tenant`
- tenant: `tenant_id`
- action/resource: `action`, `target_type`, `target_id`
- change trace: `before_data`, `after_data`, `diff`
- request summary: `metadata` (filters/counts/blocked reason codes only)

## Before/after diff policy
- Preferences/templates:
  - before: current row snapshot (if available)
  - after: upsert result snapshot
- Retry:
  - before: request counts/scope context
  - after: retryable/retried/blocked summary
- Secrets/tokens are excluded from metadata.

## Failure handling policy
- Primary management operation remains source of truth.
- Audit insertion failure must not break API success/failure semantics of the main operation.
- Failures are emitted as warning logs with action/scope/tenant context for tracing.

## Not yet hooked
- Historical/manual ops endpoints unrelated to Phase 2 management routes.
- Any runtime dispatch/job execution path.

## Read-only query APIs
- Platform: [platform notifications audit api](/c:/Users/User/bige/app/api/platform/notifications/audit/route.ts)
- Manager: [manager notifications audit api](/c:/Users/User/bige/app/api/manager/notifications/audit/route.ts)
- Query spec: [notification-admin-audit-read-api.md](/c:/Users/User/bige/docs/notification-admin-audit-read-api.md)
- Retention policy: [notification-admin-audit-retention-governance.md](/c:/Users/User/bige/docs/notification-admin-audit-retention-governance.md)
