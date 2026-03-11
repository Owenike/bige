# Notification Runtime Readiness Validation

## Scope
Read-only validator that reports runtime integration readiness.  
It does not send notifications and does not mutate runtime data.

## Source file
- [notification-runtime-readiness-validator.ts](/c:/Users/User/bige/lib/notification-runtime-readiness-validator.ts)

## Main API
- `validateNotificationRuntimeReadiness(input)`

## Validator input
- `eventInput`
- `preferenceInput`
- `templates`
- `recipients`
- optional:
  - `rolePreferenceRows`
  - `requiredRoles`
  - `requiredEvents`
  - `requiredChannels`

## Validator output
- `eventInput` contract snapshot
- `preference` resolution contract
- `templates` resolution contracts by channel
- `deliveryPlanning` contract
- `readiness` summary:
  - `ready`
  - `missingPreferences`
  - `missingTemplates`
  - `unavailableChannels`
  - `fallbacks`
- `warnings`

## Read-only boundary
- No cron/job trigger.
- No dispatch execution.
- No retry execution.
- No runtime table writes.

## Suggested use
1. Feed validator with simulation fixtures.
2. Compare readiness report across scenarios.
3. Use output in docs/preflight acceptance before any runtime wiring.
