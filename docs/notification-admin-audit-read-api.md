# Notification Admin Audit Read API

## Scope
Read-only API for notification admin trace.  
No write actions and no runtime integration.

## Routes

### Platform
- `GET /api/platform/notifications/audit`
- Auth:
  - role: `platform_admin`
  - permission: `audit.read`
- Scope:
  - global or tenant-filtered

### Manager
- `GET /api/manager/notifications/audit`
- Auth:
  - role: `manager | supervisor | branch_manager`
  - permission: `audit.read`
- Scope:
  - tenant only (cross-tenant blocked)

## Query params
- `tenantId` (UUID; platform optional, manager must match own tenant)
- `action` (`preference_upsert | template_upsert | retry_dry_run | retry_execute`)
- `resourceType` (`target_type` filter)
- `resourceId` (`target_id` filter)
- `actorUserId` (UUID)
- `scope` (`platform | tenant`, manager only supports `tenant`)
- `from` (ISO timestamp inclusive)
- `to` (ISO timestamp inclusive)
- `cursor` (ISO timestamp; fetch rows older than cursor)
- `limit` (1..200)

## Response shape
- `ok/data/error` envelope.
- `data.items[]` includes:
  - `id`
  - `action`
  - `actor.userId`
  - `actor.role`
  - `tenantId`
  - `scope`
  - `resourceType`
  - `resourceId`
  - `createdAt`
  - `metadataSummary`:
    - `keys`
    - `blockedCodes`
    - `blockedCount`
- `nextCursor`: use as next request cursor.

## Backing services
- Query parser:
  - [notification-admin-audit-query.ts](/c:/Users/User/bige/lib/notification-admin-audit-query.ts)
- Audit store service:
  - [notification-admin-audit.ts](/c:/Users/User/bige/lib/notification-admin-audit.ts)
- Routes:
  - [platform audit route](/c:/Users/User/bige/app/api/platform/notifications/audit/route.ts)
  - [manager audit route](/c:/Users/User/bige/app/api/manager/notifications/audit/route.ts)
