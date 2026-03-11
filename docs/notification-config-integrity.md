# Notification Config Integrity

## Purpose
Preflight tenant notification config completeness before runtime integration.

## Service
- [notification-config-integrity.ts](/c:/Users/User/bige/lib/notification-config-integrity.ts)
- Outputs:
  - completeness score
  - health status
  - missing role/event pairs
  - missing template event/channel pairs
  - enabled channels without template fallback

## Read-only APIs
- Platform:
  - `GET /api/platform/notifications/config-integrity?tenantId=<uuid>`
  - file: [platform config-integrity route](/c:/Users/User/bige/app/api/platform/notifications/config-integrity/route.ts)
- Manager:
  - `GET /api/manager/notifications/config-integrity`
  - file: [manager config-integrity route](/c:/Users/User/bige/app/api/manager/notifications/config-integrity/route.ts)

## Boundaries
- No runtime dispatch connection
- No writes in this API
- No cron/job mutation
