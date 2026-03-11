# Notification Ops Dashboard UI

## Scope
Read-only dashboard UI for notification reliability. This UI does not execute jobs, dispatch retries, or write any notification data.

## Pages
- Platform admin: `/platform-admin/notifications-ops`
- Manager tenant scope: `/manager/notifications-ops`

Both pages use the shared component:
- [notification-ops-dashboard.tsx](/c:/Users/User/bige/components/notification-ops-dashboard.tsx)

## APIs used

### Platform
- `GET /api/platform/notifications/ops/summary`
- `GET /api/platform/notifications/ops/health`
- `GET /api/platform/notifications/ops/coverage`

### Manager
- `GET /api/manager/notifications/ops/summary`
- `GET /api/manager/notifications/ops/health`
- `GET /api/manager/notifications/ops/coverage`

## Query params
- `tenantId` (platform page only; blank = global scope)
- `limit` (sample size for ops query layer)
- `staleAfterMinutes` (scheduled stale threshold)
- `status` (client-side focus filter: `all|failed|retrying|skipped`)

Filters are persisted in URL query params for refresh/share consistency.
The dashboard also provides a `Reset` filter action.

## UI sections
- Shared governance navigation:
  - links to ops/audit/config-integrity/preflight pages for the same role scope
- Overview cards:
  - sent, failed, retrying, skipped
  - channel not configured
  - scheduled status
- Scheduled health:
  - last scheduled run
  - minutes since last run
  - per job type latest status
- Coverage:
  - template coverage summary and missing event/channel list
  - preference coverage summary and missing role/event list
- Retry/failure overview:
  - retry execute summary
  - blocked reason distribution
  - provider error code distribution
- Warnings:
  - API/query-layer warning passthrough

## UI consistency helpers
- Query/fetch helper:
  - [notification-ops-dashboard-ui.ts](/c:/Users/User/bige/lib/notification-ops-dashboard-ui.ts)
- Status and tone helper:
  - [notification-governance-view-model.ts](/c:/Users/User/bige/lib/notification-governance-view-model.ts)

## Permission boundaries
- Platform page depends on platform API permission checks (`platform_admin`, `audit.read`).
- Manager page depends on manager API permission checks (`manager|supervisor|branch_manager`, `reports.read`).
- Manager scope is tenant-restricted by API guard; UI does not expose cross-tenant override.

## Mapping sources
- Notification health numbers: `health.notificationHealth`
- Scheduled state: `health.scheduledHealth`
- Reliability snapshot card context: `summary.snapshot`
- Template/preference coverage: `coverage.templateCoverage`, `coverage.preferenceCoverage`
- Retry summaries: `coverage.retryOperations`

## Intentionally not implemented
- No write operations in dashboard
- No retry execution button in dashboard
- No runtime integration (preferences/templates/retry not wired into dispatch)
- No cron/runtime chain changes
- No BI/chart dependency
