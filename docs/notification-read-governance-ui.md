# Notification Read-Only Governance UI

## Goal
Provide read-only governance/report views without touching cron/runtime dispatch chain.

## Pages

### Audit read UI
- Platform: `/platform-admin/notifications-audit`
- Manager: `/manager/notifications-audit`
- Component:
  - [notification-audit-read-dashboard.tsx](/c:/Users/User/bige/components/notification-audit-read-dashboard.tsx)

### Config integrity UI
- Platform: `/platform-admin/notifications-config-integrity`
- Manager: `/manager/notifications-config-integrity`
- Component:
  - [notification-config-integrity-dashboard.tsx](/c:/Users/User/bige/components/notification-config-integrity-dashboard.tsx)

### Runtime preflight UI (read-only)
- Platform: `/platform-admin/notifications-preflight`
- Manager: `/manager/notifications-preflight`
- Component:
  - [notification-preflight-dashboard.tsx](/c:/Users/User/bige/components/notification-preflight-dashboard.tsx)

### Runtime readiness UI (read-only)
- Platform: `/platform-admin/notifications-runtime-readiness`
- Manager: `/manager/notifications-runtime-readiness`
- Component:
  - [notification-runtime-readiness-dashboard.tsx](/c:/Users/User/bige/components/notification-runtime-readiness-dashboard.tsx)

## API dependencies
- audit:
  - `/api/platform/notifications/audit`
  - `/api/manager/notifications/audit`
- config integrity:
  - `/api/platform/notifications/config-integrity`
  - `/api/manager/notifications/config-integrity`
- preflight:
  - `/api/platform/notifications/preflight`
  - `/api/manager/notifications/preflight`
- runtime readiness:
  - `/api/platform/notifications/runtime-readiness`
  - `/api/manager/notifications/runtime-readiness`

## UI behavior
- full loading / empty / error states
- query params persisted in URL
- no execute/retry/run operations in these pages
- no writes performed by UI

## Shared UI helper
- [notification-governance-read-ui.ts](/c:/Users/User/bige/lib/notification-governance-read-ui.ts)
- Includes:
  - query parse/build helpers
  - API fetch wrappers
  - typed payload contracts for audit/integrity/preflight

## Shared governance UI layers
- Navigation:
  - [notification-governance-nav.tsx](/c:/Users/User/bige/components/notification-governance-nav.tsx)
  - [notification-governance-navigation.ts](/c:/Users/User/bige/lib/notification-governance-navigation.ts)
- View-model and display helpers:
  - [notification-governance-view-model.ts](/c:/Users/User/bige/lib/notification-governance-view-model.ts)

## Governance map docs
- [notification-governance-navigation-map.md](/c:/Users/User/bige/docs/notification-governance-navigation-map.md)
- [notification-governance-route-map.md](/c:/Users/User/bige/docs/notification-governance-route-map.md)
- [notification-governance-ui-guidelines.md](/c:/Users/User/bige/docs/notification-governance-ui-guidelines.md)
- [notification-read-only-boundaries.md](/c:/Users/User/bige/docs/notification-read-only-boundaries.md)
