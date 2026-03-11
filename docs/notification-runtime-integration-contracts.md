# Notification Runtime Integration Contracts

## Scope
Contract layer only.  
No runtime wiring, no dispatch/scheduled execution, no write action.

## Source file
- [notification-runtime-integration-contracts.ts](/c:/Users/User/bige/lib/notification-runtime-integration-contracts.ts)

## Contract groups

### 1) Event input contract
- `NotificationRuntimeEventInputContract`
- Includes:
  - `tenantId`
  - `eventKey`
  - `roleKey`
  - `userId`
  - `channelHint`
  - `locale`
  - `defaultLocale`
  - `recipientLimit`
  - `payload`

### 2) Preference resolution output contract
- `NotificationRuntimePreferenceResolutionContract`
- Includes:
  - `enabled`
  - `channels`
  - `source`
  - `reason`
  - `explain`
  - `trace`

### 3) Template resolution output contract
- `NotificationRuntimeTemplateResolutionContract`
- Includes:
  - `channel`
  - `found`
  - `source`
  - `strategy`
  - `fallbackReason`
  - `template`
  - `missingReason`

### 4) Delivery planning draft contract
- `NotificationRuntimeDeliveryPlanningContract`
- Includes:
  - `ready`
  - `plannedChannels`
  - `plannedRecipients`
  - `plannedContentSkeleton`
  - `skippedReasons`

### 5) Skipped/warning/fallback reason contract
- `NotificationRuntimeSkippedReasonCode`
- `NotificationRuntimeWarningCode`
- `NotificationRuntimeFallbackReasonCode`

## Shared use
- Preflight/report layer can use these contracts immediately.
- Future runtime integration can reuse the same contracts without changing core dispatch chain.
