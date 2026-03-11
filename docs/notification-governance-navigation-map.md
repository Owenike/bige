# Notification Governance Navigation Map

## Scope
Read-only notification governance pages only.  
No write actions, no cron/runtime integration, no dispatch execution.

## Platform Admin Navigation
- Entry dashboard: `/platform-admin`
- Governance links:
  - `/platform-admin/notifications-ops`
  - `/platform-admin/notifications-audit`
  - `/platform-admin/notifications-config-integrity`
  - `/platform-admin/notifications-preflight`
  - `/platform-admin/notifications-runtime-readiness`

## Manager Navigation
- Entry dashboard: `/manager`
- Governance links:
  - `/manager/notifications-ops`
  - `/manager/notifications-audit`
  - `/manager/notifications-config-integrity`
  - `/manager/notifications-preflight`
  - `/manager/notifications-runtime-readiness`

## Page to API Mapping
- Notifications Ops
  - platform page: `/platform-admin/notifications-ops`
  - manager page: `/manager/notifications-ops`
  - API:
    - `/api/platform/notifications/ops/summary`
    - `/api/platform/notifications/ops/health`
    - `/api/platform/notifications/ops/coverage`
    - `/api/manager/notifications/ops/summary`
    - `/api/manager/notifications/ops/health`
    - `/api/manager/notifications/ops/coverage`
- Notifications Audit
  - platform page: `/platform-admin/notifications-audit`
  - manager page: `/manager/notifications-audit`
  - API:
    - `/api/platform/notifications/audit`
    - `/api/manager/notifications/audit`
- Config Integrity
  - platform page: `/platform-admin/notifications-config-integrity`
  - manager page: `/manager/notifications-config-integrity`
  - API:
    - `/api/platform/notifications/config-integrity`
    - `/api/manager/notifications/config-integrity`
- Runtime Preflight
  - platform page: `/platform-admin/notifications-preflight`
  - manager page: `/manager/notifications-preflight`
  - API:
    - `/api/platform/notifications/preflight`
    - `/api/manager/notifications/preflight`
- Runtime Readiness
  - platform page: `/platform-admin/notifications-runtime-readiness`
  - manager page: `/manager/notifications-runtime-readiness`
  - API:
    - `/api/platform/notifications/runtime-readiness`
    - `/api/manager/notifications/runtime-readiness`

## Source of Truth (Code)
- Navigation definitions:
  - [notification-governance-navigation.ts](/c:/Users/User/bige/lib/notification-governance-navigation.ts)
- Route/page/component map:
  - [notification-governance-route-map.ts](/c:/Users/User/bige/lib/notification-governance-route-map.ts)
