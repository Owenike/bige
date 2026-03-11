# Phase 2 Notification Productization Foundations

## Intent
Provide low-risk, tenant-safe productization controls for notifications without changing runtime dispatch/scheduled chains.

## Delivered foundations

### 1) Preferences
- Data tables: `notification_role_preferences`, `notification_user_preferences`
- APIs:
  - `GET/PUT /api/platform/notifications/preferences`
  - `GET/PUT /api/manager/notifications/preferences`
- UI:
  - `/platform-admin/notifications-preferences`
  - `/manager/notifications-preferences`
- Features:
  - role/user scope switch
  - validation feedback
  - list auto-refresh on save
  - reset/cancel flow
  - filter state retained with URL params where applicable

### 2) Templates
- Data table: `notification_templates`
- APIs:
  - `GET/PUT /api/platform/notifications/templates`
  - `GET/PUT /api/manager/notifications/templates`
- UI:
  - `/platform-admin/notification-templates`
  - `/manager/notification-templates`
- Features:
  - list + editor + preview separation
  - policy JSON validation
  - active/inactive visibility
  - template key preview

### 3) Retry operations
- Services:
  - `buildRetryPlan`
  - `validateRetryTargets`
  - `executeRetryPlan`
- APIs:
  - `GET/POST /api/platform/notifications/retry`
  - `GET/POST /api/manager/notifications/retry`
- UI:
  - `/platform-admin/notification-retry`
  - `/manager/notification-retry`
- Features:
  - query filters
  - dry-run vs execute
  - blocked reason visibility
  - explicit execute confirmation

## Shared contracts and helper layer
- Core constants/schema: `lib/notification-productization.ts`
- UI helper/contracts: `lib/notification-productization-ui.ts`
- Retry evaluation logic: `lib/notification-retry-policy.ts`

Shared helper capabilities:
- API envelope parsing
- template payload normalization
- policy JSON parsing
- CSV parsing for filter params
- retry limit clamping

## Permission and tenant boundaries
- Platform routes require `platform_admin`.
- Manager routes are tenant-scoped and reject tenant mismatch.
- No privilege widening introduced in this phase.

## Test coverage in this phase
- preference payload validation
- template payload/policy normalization
- retry eligibility blocked reasons
- retry request schema validation
- manager tenant mismatch guard behavior
- helper normalization routines

## Explicitly deferred
The following are intentionally not connected yet:
- `/api/jobs/run`
- cron behavior (`vercel.json`)
- `createInAppNotifications` runtime creation path
- dispatch core loop runtime decisions
- scheduled flow integration of preferences/templates/retry
