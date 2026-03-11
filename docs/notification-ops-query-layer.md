# Notification Ops Read-Only API

## Scope
Read-only query surface for Platform Ops reliability data. This layer does not call `/api/jobs/run`, does not trigger dispatch, and does not mutate runtime notification data.

## Query service
- Core service: [notification-platform-ops-query.ts](/c:/Users/User/bige/lib/notification-platform-ops-query.ts)
- Shared API parser/scope guard: [notification-ops-api.ts](/c:/Users/User/bige/lib/notification-ops-api.ts)

## Routes

### Platform (`platform_admin` + `audit.read`)
- `GET /api/platform/notifications/ops/summary`
- `GET /api/platform/notifications/ops/health`
- `GET /api/platform/notifications/ops/coverage`

### Manager tenant scope (`manager|supervisor|branch_manager` + `reports.read`)
- `GET /api/manager/notifications/ops/summary`
- `GET /api/manager/notifications/ops/health`
- `GET /api/manager/notifications/ops/coverage`

## Query params
- `tenantId` (optional UUID)
  - Platform route: optional; omitted = platform scope aggregate, provided = tenant scope.
  - Manager route: optional but must match manager tenant scope.
- `limit` (optional, default `500`, range `1..3000`)
- `staleAfterMinutes` (optional, default `1440`, range `1..10080`)
- `defaultLocale` (optional, default `zh-TW`)

## Response shape
- Envelope keeps existing API contract:
  - `{ ok: true, data: ... }`
  - `{ ok: false, error: { code, message } }`

### `summary`
- `snapshot.notificationHealth`
- `snapshot.scheduledHealth`
- `snapshot.templateCoverage`
- `snapshot.preferenceCoverage`
- `snapshot.retryOperations`

### `health`
- `notificationHealth`
- `scheduledHealth`

### `coverage`
- `templateCoverage`
- `preferenceCoverage`
- `retryOperations`

## Scope boundaries
- Platform routes can query platform aggregate or a specific tenant.
- Manager routes are hard-pinned to the actor tenant via `resolveManagerOpsScope`.
- Cross-tenant manager access returns `403 BRANCH_SCOPE_DENIED`.

## Dashboard UI handoff (future)
- UI should read only from these routes.
- UI must not query DB directly from pages/components.
- Suggested page composition:
  1. summary cards from `/ops/summary`
  2. health drill-down from `/ops/health`
  3. coverage/retry drill-down from `/ops/coverage`
