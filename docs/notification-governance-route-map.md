# Notification Governance Route/Page/Component Map

This map keeps platform/manager governance paths symmetric and gives stable file references for reporting.

## Platform Pages
- `/platform-admin/notifications-ops`
  - page: [page.tsx](/c:/Users/User/bige/app/platform-admin/notifications-ops/page.tsx)
  - component: [notification-ops-dashboard.tsx](/c:/Users/User/bige/components/notification-ops-dashboard.tsx)
- `/platform-admin/notifications-audit`
  - page: [page.tsx](/c:/Users/User/bige/app/platform-admin/notifications-audit/page.tsx)
  - component: [notification-audit-read-dashboard.tsx](/c:/Users/User/bige/components/notification-audit-read-dashboard.tsx)
- `/platform-admin/notifications-config-integrity`
  - page: [page.tsx](/c:/Users/User/bige/app/platform-admin/notifications-config-integrity/page.tsx)
  - component: [notification-config-integrity-dashboard.tsx](/c:/Users/User/bige/components/notification-config-integrity-dashboard.tsx)
- `/platform-admin/notifications-preflight`
  - page: [page.tsx](/c:/Users/User/bige/app/platform-admin/notifications-preflight/page.tsx)
  - component: [notification-preflight-dashboard.tsx](/c:/Users/User/bige/components/notification-preflight-dashboard.tsx)
- `/platform-admin/notifications-runtime-readiness`
  - page: [page.tsx](/c:/Users/User/bige/app/platform-admin/notifications-runtime-readiness/page.tsx)
  - component: [notification-runtime-readiness-dashboard.tsx](/c:/Users/User/bige/components/notification-runtime-readiness-dashboard.tsx)

## Manager Pages
- `/manager/notifications-ops`
  - page: [page.tsx](/c:/Users/User/bige/app/manager/notifications-ops/page.tsx)
  - component: [notification-ops-dashboard.tsx](/c:/Users/User/bige/components/notification-ops-dashboard.tsx)
- `/manager/notifications-audit`
  - page: [page.tsx](/c:/Users/User/bige/app/manager/notifications-audit/page.tsx)
  - component: [notification-audit-read-dashboard.tsx](/c:/Users/User/bige/components/notification-audit-read-dashboard.tsx)
- `/manager/notifications-config-integrity`
  - page: [page.tsx](/c:/Users/User/bige/app/manager/notifications-config-integrity/page.tsx)
  - component: [notification-config-integrity-dashboard.tsx](/c:/Users/User/bige/components/notification-config-integrity-dashboard.tsx)
- `/manager/notifications-preflight`
  - page: [page.tsx](/c:/Users/User/bige/app/manager/notifications-preflight/page.tsx)
  - component: [notification-preflight-dashboard.tsx](/c:/Users/User/bige/components/notification-preflight-dashboard.tsx)
- `/manager/notifications-runtime-readiness`
  - page: [page.tsx](/c:/Users/User/bige/app/manager/notifications-runtime-readiness/page.tsx)
  - component: [notification-runtime-readiness-dashboard.tsx](/c:/Users/User/bige/components/notification-runtime-readiness-dashboard.tsx)

## Read-Only APIs
- Ops
  - [summary route](/c:/Users/User/bige/app/api/platform/notifications/ops/summary/route.ts)
  - [health route](/c:/Users/User/bige/app/api/platform/notifications/ops/health/route.ts)
  - [coverage route](/c:/Users/User/bige/app/api/platform/notifications/ops/coverage/route.ts)
  - [summary route](/c:/Users/User/bige/app/api/manager/notifications/ops/summary/route.ts)
  - [health route](/c:/Users/User/bige/app/api/manager/notifications/ops/health/route.ts)
  - [coverage route](/c:/Users/User/bige/app/api/manager/notifications/ops/coverage/route.ts)
- Audit
  - [platform audit route](/c:/Users/User/bige/app/api/platform/notifications/audit/route.ts)
  - [manager audit route](/c:/Users/User/bige/app/api/manager/notifications/audit/route.ts)
- Config integrity
  - [platform config-integrity route](/c:/Users/User/bige/app/api/platform/notifications/config-integrity/route.ts)
  - [manager config-integrity route](/c:/Users/User/bige/app/api/manager/notifications/config-integrity/route.ts)
- Preflight
  - [platform preflight route](/c:/Users/User/bige/app/api/platform/notifications/preflight/route.ts)
  - [manager preflight route](/c:/Users/User/bige/app/api/manager/notifications/preflight/route.ts)
- Runtime readiness
  - [platform runtime-readiness route](/c:/Users/User/bige/app/api/platform/notifications/runtime-readiness/route.ts)
  - [manager runtime-readiness route](/c:/Users/User/bige/app/api/manager/notifications/runtime-readiness/route.ts)

## Shared Files
- Navigation definitions: [notification-governance-navigation.ts](/c:/Users/User/bige/lib/notification-governance-navigation.ts)
- Route map helper: [notification-governance-route-map.ts](/c:/Users/User/bige/lib/notification-governance-route-map.ts)
- UI query helper: [notification-governance-read-ui.ts](/c:/Users/User/bige/lib/notification-governance-read-ui.ts)
- UI view-model helper: [notification-governance-view-model.ts](/c:/Users/User/bige/lib/notification-governance-view-model.ts)
- Governance nav component: [notification-governance-nav.tsx](/c:/Users/User/bige/components/notification-governance-nav.tsx)
