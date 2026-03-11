# Phase 2 Notification Productization Demo Guide

This guide is for validating Phase 2 (`Preferences / Templates / Retry`) without touching runtime dispatch chains.

## Scope and safety
- Safe in this phase:
  - `/platform-admin/notifications-preferences`
  - `/manager/notifications-preferences`
  - `/platform-admin/notification-templates`
  - `/manager/notification-templates`
  - `/platform-admin/notification-retry`
  - `/manager/notification-retry`
- Out of scope (intentionally not wired here):
  - `/api/jobs/run`
  - `createInAppNotifications` runtime creation path
  - dispatch runtime main loop
  - scheduled/cron flow

## Required vs optional fields

### Preferences
#### Required
- `mode`: `role` or `user`
- `eventType`
- `channels`
- `role` when `mode=role`
- `userId` when `mode=user`
- `tenantId` for platform API

#### Optional
- `isEnabled`
- `source` (`role` mode only)
- `note`

### Templates
#### Required
- `eventType`
- `channel`
- `titleTemplate`
- `messageTemplate`

#### Optional
- `tenantId` (platform only)
- `locale` (default `zh-TW`)
- `emailSubject`
- `actionUrl`
- `priority`
- `channelPolicy`
- `isActive`
- `templateKey` (if provided, must match generated key)

### Retry
#### Required
- `action`: `dry_run` or `execute`

#### Optional
- `deliveryIds`
- `statuses`
- `channels`
- `eventType`
- `limit`
- `tenantId` (platform only)

## Platform vs manager behavior
- Platform admin:
  - can specify tenant scope for preferences/templates/retry
  - can inspect cross-tenant datasets from platform pages
- Manager:
  - always tenant-scoped
  - tenant mismatch payloads are rejected by API

## Page operation steps

### 1) Preferences pages
1. Load list data.
2. Choose `Role Scope` or `User Scope`.
3. Fill required fields.
4. Save and confirm success message.
5. Confirm list auto-refreshes and form resets.

### 2) Templates pages
1. Load list data.
2. Create/update template with required fields.
3. Validate `template_key` preview and content preview panel.
4. Save and confirm list auto-refreshes.
5. Confirm active status is visible in list.

### 3) Retry pages
1. Set filters and load retry plan.
2. Review retryable vs blocked summary.
3. Run `dry_run` and check blocked reasons.
4. Type `EXECUTE` and run execute (if needed in test data only).
5. Confirm execute result summary is shown.

## Common error handling hints
- `tenantId mismatch`: manager payload attempted cross-tenant scope.
- `Invalid payload`: schema validation failure (event/channel/role/policy format).
- `channel_policy must be a JSON object`: policy field is not valid JSON object.
- Empty list after load: filter too strict or no seed data.

## Dry-run vs Execute
- `dry_run`: no retry execution, only plan/eligibility output.
- `execute`: calls controlled retry operation service and returns retried/blocked summary.

## Recommended demo order
1. Platform role preference create
2. Manager user preference create
3. Platform template create
4. Manager template update
5. Platform retry dry-run
6. Manager retry dry-run
7. Optional execute in isolated test tenant

## Validation checklist
- [ ] Preferences can create/update for role/user scope
- [ ] Templates can create/update with preview
- [ ] Retry plan shows blocked reasons
- [ ] Manager cannot cross tenant scope
- [ ] Platform can specify tenant scope
- [ ] No runtime chain endpoint changed in this phase
