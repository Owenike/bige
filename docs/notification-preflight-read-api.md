# Notification Preflight Read API

## Scope
Read-only simulation API for runtime integration preflight.  
It does not dispatch notifications and does not modify runtime tables.

## Routes

### Platform
- `GET /api/platform/notifications/preflight`
- Auth:
  - role: `platform_admin`
  - permission: `audit.read`
- Requirement:
  - `tenantId` required

### Manager
- `GET /api/manager/notifications/preflight`
- Auth:
  - role: `manager | supervisor | branch_manager`
  - permission: `reports.read`
- Scope:
  - tenant fixed by manager context
  - cross-tenant `tenantId` denied

## Query params
- `tenantId` (platform required, manager optional but must match own tenant)
- `eventKey` (default: `opportunity_due`)
- `roleKey` (optional)
- `userId` (optional)
- `channelHint` (optional)
- `locale` (default `zh-TW`)
- `defaultLocale` (default `zh-TW`)
- `recipientLimit` (1..100, default 20)

## Response summary
- preference resolution summary
- template resolution summary by channel
- delivery planning draft summary
- coverage gaps for selected event
- skipped reasons
- warnings

## Implementation
- Query parser: [notification-preflight-query.ts](/c:/Users/User/bige/lib/notification-preflight-query.ts)
- Report service: [notification-preflight-report.ts](/c:/Users/User/bige/lib/notification-preflight-report.ts)
- Routes:
  - [platform preflight route](/c:/Users/User/bige/app/api/platform/notifications/preflight/route.ts)
  - [manager preflight route](/c:/Users/User/bige/app/api/manager/notifications/preflight/route.ts)

## UI consumers (read-only)
- [platform preflight page](/c:/Users/User/bige/app/platform-admin/notifications-preflight/page.tsx)
- [manager preflight page](/c:/Users/User/bige/app/manager/notifications-preflight/page.tsx)
- shared component: [notification-preflight-dashboard.tsx](/c:/Users/User/bige/components/notification-preflight-dashboard.tsx)

## Boundaries
- This API is for preflight reporting only.
- It must not trigger retry/execute/run actions.
- It must not write notification runtime/job tables.
