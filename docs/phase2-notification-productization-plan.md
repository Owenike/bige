# Phase 2 Notification Productization Plan

## Objective
Deliver a commercial-ready control surface for notification preferences, templates, and retry operations while keeping runtime notification backbone unchanged.

## Current status
- Preferences APIs are operable for platform and manager scope.
- Templates APIs are operable for platform and manager scope.
- Retry APIs are operable with plan / dry-run / execute modes.
- Platform and manager UI pages are now fully operable (form flow, loading/empty/error states, list refresh, reset/cancel).
- Shared UI helpers and type contracts are centralized.
- Demo guide and seed payloads are prepared for staging/manual verification.

## Workstream A: Preference Center

### Data model
- `notification_role_preferences`
- `notification_user_preferences`

### APIs
- `GET/PUT /api/platform/notifications/preferences`
- `GET/PUT /api/manager/notifications/preferences`

### UI
- `/platform-admin/notifications-preferences`
- `/manager/notifications-preferences`

### Scope rules
- Platform can specify tenant scope.
- Manager remains tenant-scoped only.

## Workstream B: Template Management

### Data model
- `notification_templates`

### APIs
- `GET/PUT /api/platform/notifications/templates`
- `GET/PUT /api/manager/notifications/templates`

### UI
- `/platform-admin/notification-templates`
- `/manager/notification-templates`

### Form contract
Required fields:
- `eventType`, `channel`, `titleTemplate`, `messageTemplate`

Optional fields:
- `tenantId`, `locale`, `emailSubject`, `actionUrl`, `priority`, `channelPolicy`, `isActive`, `templateKey`

## Workstream C: Retry Operations

### APIs
- `GET/POST /api/platform/notifications/retry`
- `GET/POST /api/manager/notifications/retry`

### UI
- `/platform-admin/notification-retry`
- `/manager/notification-retry`

### Modes
- `dry_run`: validation-only
- `execute`: controlled retry via existing retry operation service

## Shared contracts and helper layer
- `lib/notification-productization.ts`
- `lib/notification-productization-ui.ts`
- `lib/notification-retry-operations.ts`

Standardized domains:
- event keys
- channel keys
- role keys
- priority keys
- template policy schema
- retry payload schemas

## Runtime integration strategy (intentionally deferred)
The following are not connected in this phase:
1. Runtime preference resolution inside notification creation.
2. Runtime template rendering injection into dispatch main loop.
3. Scheduled job behavior changes.

## Definition of Done for this phase
- Preferences/Templates/Retry pages are usable end-to-end for manual operations.
- Manager and platform scopes are enforced and reflected in UI.
- Shared helper/types reduce repeated payload logic.
- Demo seed and runbook can validate behavior in staging.
- Runtime and scheduled chains remain untouched.

## Next step recommendation (after Scheduled Jobs validation closes)
1. Controlled runtime read-path integration behind feature flag.
2. Tenant-level rollout switch.
3. Additional observability tags for applied preference/template source.
4. Bulk retry governance workflow (approval/audit enhancements).
