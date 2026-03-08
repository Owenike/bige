# Phase 2 Notification Productization Foundations

## Scope in this step
This step delivers a low-risk, operational first version of Notification Productization without wiring new behavior into scheduled runtime flow.

Implemented in this stage:
1. Preference center schema + service + API + operable platform/manager UI
2. Template management schema + service + API + operable platform/manager UI (with preview)
3. Retry operations schema/service + API + operable platform/manager UI (query, dry-run, execute)

## Data model

### 1) Role preference
Table: `notification_role_preferences`
- tenant_id
- role
- event_type
- channels (jsonb)
- is_enabled
- source (`platform_default` / `tenant_default` / `custom`)

### 2) User override preference
Table: `notification_user_preferences`
- tenant_id
- user_id
- event_type
- channels (jsonb)
- is_enabled

### 3) Templates
Table: `notification_templates`
- tenant_id (nullable, null = global template)
- event_type
- channel (`in_app` / `email` / `line` / `sms` / `webhook`)
- locale
- title_template
- message_template
- email_subject
- action_url
- priority
- channel_policy
- is_active
- version

## API status (operable)

### Platform (global/admin)
- `GET/PUT /api/platform/notifications/preferences`
- `GET/PUT /api/platform/notifications/templates`
- `GET/POST /api/platform/notifications/retry`

### Manager (tenant-scoped)
- `GET/PUT /api/manager/notifications/preferences`
- `GET/PUT /api/manager/notifications/templates`
- `GET/POST /api/manager/notifications/retry`

## Retry operations behavior in this step
- `GET` supports:
  - retry plan summary
  - optional rows (`includeRows=true`)
  - filters: `deliveryId`, `statuses`, `channels`, `eventType`, `tenantId`(platform only)
- `POST` supports:
  - `action=dry_run`
  - `action=execute`
  - validated target sets and blocked reason output
- Execute path still uses existing delivery dispatch pipeline, with no scheduled chain rewiring.

## Permission matrix (foundation)
- `platform_admin`
  - full access in platform notification preference/template/retry routes
- `manager`
  - tenant-scoped update access in manager routes
- `supervisor` / `branch_manager`
  - read access for manager routes where applicable

## UI pages now available
- `/platform-admin/notifications-preferences`
- `/manager/notifications-preferences`
- `/platform-admin/notification-templates`
- `/manager/notification-templates`
- `/platform-admin/notification-retry`
- `/manager/notification-retry`

## Operator assets added
- `docs/phase2-notification-productization-demo.md`
- `docs/phase2-notification-productization-demo-seed.json`
- Includes required/optional fields, payload examples, manager/platform usage notes, and safe enable/disable strategy.

## Deliberately postponed (after Scheduled Jobs validation acceptance)
1. Wiring preferences/templates into `createInAppNotifications` runtime resolution
2. Wiring template/policy resolution into dispatch runtime
3. Scheduled auto-use of retry plan in jobs flow
4. Advanced bulk retry approvals / workflow
