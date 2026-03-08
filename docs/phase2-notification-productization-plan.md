# Phase 2 Notification Productization Plan

## Objective
Evolve notification foundations into a commercial-grade control plane while keeping runtime notification backbone unchanged until Phase 1 scheduled validation is complete.

## Current delivery status
- ✅ Data foundations migrated (`notification_role_preferences`, `notification_user_preferences`, `notification_templates`)
- ✅ Platform/manager APIs are operable (list/detail/upsert/plan/dry-run/execute)
- ✅ Platform/manager UI pages are operable for Preferences / Templates / Retry
- ✅ Shared client helper and constants are centralized in `lib/notification-productization-ui.ts`
- ✅ Demo/mock payload pack and operator guide added for staging/manual validation
- ⏸ Runtime dispatch integration intentionally not enabled yet

## 1) Preference Center model

### Role-level preference
Table: `notification_role_preferences`
- `tenant_id`
- `role`
- `event_type`
- `channels` (in_app/email/line/sms/webhook)
- `is_enabled`
- `source` (`platform_default` / `tenant_default` / `custom`)

### User-level override
Table: `notification_user_preferences`
- `tenant_id`
- `user_id`
- `event_type`
- `channels`
- `is_enabled`

### APIs
- Platform:
  - `GET/PUT /api/platform/notifications/preferences`
- Manager:
  - `GET/PUT /api/manager/notifications/preferences`

Validation includes:
- event key allow-list
- role/channel validity
- manager tenant scope enforcement
- consistent API envelope (`{ ok: true, data }` / `{ ok: false, error }`)

## 2) Template Management model

Table: `notification_templates`
- `tenant_id` (nullable: null = global)
- `event_type`
- `channel`
- `locale`
- `title_template`
- `message_template`
- `email_subject`
- `action_url`
- `priority`
- `channel_policy`
- `is_active`
- `version`

Derived key:
- `template_key = scope:event:channel:locale`
- Used for payload validation and deterministic lookup.

APIs:
- Platform:
  - `GET/PUT /api/platform/notifications/templates`
- Manager:
  - `GET/PUT /api/manager/notifications/templates`

UI:
- Platform: `/platform-admin/notification-templates`
- Manager: `/manager/notification-templates`
- Supports list, edit, create, preview, and JSON policy validation.

## 3) Retry Operations model

Service:
- `lib/notification-retry-operations.ts`

Capabilities:
- Retry plan generation
- Candidate eligibility classification
- Dry-run output with blocked reasons
- Controlled execute path

Eligibility examples:
- retryable
- in_app not retryable
- status not retryable
- max attempts reached
- retry not due yet
- non-retryable error code

APIs:
- Platform:
  - `GET/POST /api/platform/notifications/retry`
- Manager:
  - `GET/POST /api/manager/notifications/retry`

UI:
- Platform: `/platform-admin/notification-retry`
- Manager: `/manager/notification-retry`
- Supports filters (`deliveryId`, `statuses`, `channels`, `eventType`), plan, dry-run, execute.

## 4) Permission boundaries
- `platform_admin`: global access
- `manager`: tenant-scoped write/read
- `supervisor`/`branch_manager`: read where explicitly allowed
- tenant mismatch is rejected in manager routes

## 4.1) Enable/disable safety strategy (Phase 2 only)
- Preference toggle:
  - `isEnabled` controls rule-level enable/disable
  - channel boolean map controls channel-level enable/disable
- Template toggle:
  - `isActive` controls active/inactive template behavior for future runtime use
- Retry safety:
  - dry-run first workflow
  - execute requires explicit UI confirmation
  - blocked reasons returned for non-retryable targets

## 5) Runtime integration strategy (future step)

Planned integration points (not enabled yet in this stage):
1. Resolve effective preference before creating external delivery rows
2. Resolve effective template before channel payload rendering
3. Apply retry policy from template/policy layer
4. Add rollout flag per tenant to control progressive enablement

## 6) Intentionally not wired yet (for safety)
To avoid impacting scheduled validation:
- No runtime wiring into `/api/jobs/run`
- No changes in `createInAppNotifications` core creation path
- No changes in `dispatchNotificationDeliveries` core dispatch behavior
- No new scheduled jobs introduced

## 7) Next implementation gate
After scheduled validation closes:
1. Runtime read path for preference and template resolution (behind feature flag)
2. Controlled rollout per tenant with fallback to existing behavior
3. Observability add-on: applied preference/template trace in delivery metadata
4. Bulk retry safety guardrails and audit-focused tooling
