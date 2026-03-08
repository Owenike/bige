# Phase 2 Notification Productization Demo & Validation Guide

## 1) Demo data strategy (no runtime-chain impact)
This demo flow only calls Phase 2 APIs and does **not** touch `/api/jobs/run` or scheduled jobs.

Recommended order:
1. Create role preferences
2. Create user preferences
3. Create templates
4. Load retry plan (dry-run first, execute only in test tenant)

## 2) Required vs optional fields

### Preferences `PUT /api/platform/notifications/preferences` / `PUT /api/manager/notifications/preferences`
- Required:
  - `mode` (`role` or `user`)
  - `eventType`
  - `channels`
- Conditionally required:
  - `role` when `mode=role`
  - `userId` when `mode=user`
  - `tenantId` required for platform API; manager API uses current tenant scope
- Optional:
  - `isEnabled`
  - `source` (role mode only)
  - `note`

### Templates `PUT /api/platform/notifications/templates` / `PUT /api/manager/notifications/templates`
- Required:
  - `eventType`
  - `channel`
  - `titleTemplate`
  - `messageTemplate`
- Optional:
  - `tenantId` (platform only; manager auto-tenant)
  - `locale` (default `zh-TW`)
  - `emailSubject`
  - `actionUrl`
  - `priority`
  - `channelPolicy`
  - `isActive`
  - `version`
  - `templateKey` (must match generated key if provided)

### Retry `POST /api/platform/notifications/retry` / `POST /api/manager/notifications/retry`
- Required:
  - `action` (`dry_run` or `execute`)
- Optional:
  - `deliveryIds`
  - `statuses`
  - `channels`
  - `eventType`
  - `limit`
  - `tenantId` (platform only; manager is tenant-scoped)

## 3) Example payloads

### Role preference (platform)
```json
{
  "tenantId": "11111111-1111-1111-1111-111111111111",
  "mode": "role",
  "eventType": "member_contract_expiring",
  "role": "manager",
  "channels": { "in_app": true, "email": true, "line": false, "sms": false, "webhook": false },
  "isEnabled": true,
  "source": "custom",
  "note": "manager should receive expiry reminders"
}
```

### User preference (manager)
```json
{
  "mode": "user",
  "eventType": "opportunity_due",
  "userId": "22222222-2222-2222-2222-222222222222",
  "channels": { "in_app": true, "email": true, "line": false, "sms": false, "webhook": false },
  "isEnabled": true
}
```

### Template (manager)
```json
{
  "eventType": "opportunity_due",
  "channel": "email",
  "locale": "zh-TW",
  "titleTemplate": "機會即將到期",
  "messageTemplate": "請在 {{due_at}} 前處理機會：{{target_name}}",
  "emailSubject": "【提醒】機會即將到期",
  "actionUrl": "/manager/opportunities",
  "priority": "warning",
  "channelPolicy": { "allowExternal": true, "maxRetries": 2 },
  "isActive": true
}
```

### Retry dry-run (platform)
```json
{
  "action": "dry_run",
  "tenantId": "11111111-1111-1111-1111-111111111111",
  "statuses": ["failed", "retrying"],
  "channels": ["email", "webhook"],
  "eventType": "member_contract_expiring",
  "limit": 200
}
```

## 4) Platform vs manager operation notes
- Platform pages can set `tenantId` and inspect cross-tenant data.
- Manager pages always run under current tenant scope and reject cross-tenant payloads.
- Retry execute requires explicit confirmation text in UI to reduce accidental actions.

## 5) Enable/disable strategy (Phase 2 scope only)
- Preference enable/disable:
  - controlled by `isEnabled`
  - selected channel toggle determines channel-level enable state
- Template enable/disable:
  - controlled by `isActive`
- Retry safety:
  - execute path requires dry-run visible result + explicit confirm string
  - non-retryable decisions are returned with blocked reasons

## 6) Out of scope in this stage
- No wiring into runtime dispatch path
- No scheduled flow changes
- No `/api/jobs/run` changes
- No cron configuration changes
