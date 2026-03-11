# Notification Runtime Preflight Services

## Goal
Prepare runtime integration building blocks without wiring into `createInAppNotifications` or dispatch runtime flow.

## Services

### Preference Resolution Service
- File: [notification-preference-resolution-service.ts](/c:/Users/User/bige/lib/notification-preference-resolution-service.ts)
- Input layers:
  - `platformDefault`
  - `tenantDefault`
  - `rolePreference`
  - `userPreference`
- Output:
  - `enabled`
  - `channels`
  - `source` (`system_default | platform_default | tenant_default | role | user`)
  - `reason`
  - `explain`
  - `trace`

### Template Resolution Service
- File: [notification-template-resolution-service.ts](/c:/Users/User/bige/lib/notification-template-resolution-service.ts)
- Fallback order:
  1. tenant + locale
  2. tenant + default locale
  3. global + locale
  4. global + default locale
- Output:
  - `found`
  - `source` (`tenant | global | none`)
  - `strategy`
  - `template` payload skeleton
  - `missingReason`

### Delivery Planning Draft Service
- File: [notification-delivery-planning-draft-service.ts](/c:/Users/User/bige/lib/notification-delivery-planning-draft-service.ts)
- Draft input:
  - `eventKey`
  - `tenantId`
  - target hints / recipient candidates
  - preference resolution result
  - template resolution result(s)
- Draft output:
  - `plannedRecipients`
  - `plannedChannels`
  - `plannedContentSkeleton`
  - `skippedReasons`
  - `ready`

## Coverage / preflight helper
- File: [notification-config-integrity.ts](/c:/Users/User/bige/lib/notification-config-integrity.ts)
- Key helper:
  - `computeNotificationCoverageGaps`
  - `computeTenantNotificationConfigIntegrity`
- Purpose:
  - identify missing `event/channel/role` before runtime integration
  - provide preflight report without touching runtime path

## Non-goals (this phase)
- No runtime wiring.
- No dispatch/scheduled flow mutation.
- No cron chain changes.

## Runtime integration contract/simulation/readiness layer
- Contracts:
  - [notification-runtime-integration-contracts.ts](/c:/Users/User/bige/lib/notification-runtime-integration-contracts.ts)
  - [notification-runtime-integration-contracts.md](/c:/Users/User/bige/docs/notification-runtime-integration-contracts.md)
- Simulation fixtures:
  - [notification-runtime-simulation-fixtures.ts](/c:/Users/User/bige/lib/notification-runtime-simulation-fixtures.ts)
  - [notification-runtime-simulation-scenarios.md](/c:/Users/User/bige/docs/notification-runtime-simulation-scenarios.md)
- Readiness validator:
  - [notification-runtime-readiness-validator.ts](/c:/Users/User/bige/lib/notification-runtime-readiness-validator.ts)
  - [notification-runtime-readiness-validation.md](/c:/Users/User/bige/docs/notification-runtime-readiness-validation.md)

## Read-only preflight endpoints and UI
- API:
  - [platform preflight api](/c:/Users/User/bige/app/api/platform/notifications/preflight/route.ts)
  - [manager preflight api](/c:/Users/User/bige/app/api/manager/notifications/preflight/route.ts)
- UI:
  - `/platform-admin/notifications-preflight`
  - `/manager/notifications-preflight`
- API spec:
  - [notification-preflight-read-api.md](/c:/Users/User/bige/docs/notification-preflight-read-api.md)

## Read-only runtime readiness endpoints and UI
- API:
  - [platform runtime-readiness api](/c:/Users/User/bige/app/api/platform/notifications/runtime-readiness/route.ts)
  - [manager runtime-readiness api](/c:/Users/User/bige/app/api/manager/notifications/runtime-readiness/route.ts)
- UI:
  - `/platform-admin/notifications-runtime-readiness`
  - `/manager/notifications-runtime-readiness`
- UI spec:
  - [notification-runtime-readiness-ui.md](/c:/Users/User/bige/docs/notification-runtime-readiness-ui.md)
