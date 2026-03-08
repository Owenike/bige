# Phase 12 Staging Validation Runbook

## Scope
This runbook validates external notification dispatch hardening without changing core business flow.

## Preconditions
- Staging database has migration `20260309100000_phase12_external_notification_channels.sql` applied.
- At least one active tenant and manager user exist.
- `/api/jobs/run`, platform ops, and manager ops are reachable in staging.

## Scenario 1: Email Sent
1. Configure staging env:
   - `EMAIL_NOTIFY_ENDPOINT` points to a working test endpoint.
   - Optional: `EMAIL_NOTIFY_TOKEN`, `EMAIL_NOTIFY_PROVIDER`, `EMAIL_NOTIFY_TIMEOUT_MS`.
2. Trigger a high-value event that produces notification deliveries (e.g. notification sweep or opportunity sweep).
3. Run dispatch job (`delivery_dispatch`).
4. Verify in `notification_deliveries`:
   - channel = `email`
   - status = `sent`
   - `provider_message_id` is present (if provider returns ref)
   - `provider_response` contains compact trace fields (`channel`, `templateKey`, `recipient`, provider ref if any).

## Scenario 2: Channel Not Configured
1. Remove `EMAIL_NOTIFY_ENDPOINT` from staging env.
2. Trigger new deliveries and run dispatch.
3. Verify:
   - status = `skipped`
   - error_code = `CHANNEL_NOT_CONFIGURED`
   - error_message clearly states missing endpoint.
4. Confirm platform/manager ops summary shows non-zero `channelNotConfigured`.

## Scenario 3: Recipient Missing
1. Use a recipient profile/user without email.
2. Trigger event and run dispatch.
3. Verify:
   - status = `skipped`
   - error_code = `RECIPIENT_CONTACT_MISSING`
   - no retries are scheduled.

## Scenario 4: Provider Timeout
1. Point `EMAIL_NOTIFY_ENDPOINT` to a slow or timeout simulation endpoint.
2. Trigger event and run dispatch.
3. Verify:
   - first attempt results in `retrying` when attempts < max_attempts
   - error_code reflects timeout/network classification (`TIMEOUT` or `NETWORK_ERROR`).

## Scenario 5: Retrying to Failed (Stop Condition)
1. Keep endpoint failing (or unreachable).
2. Re-run dispatch until `attempts` reaches `max_attempts`.
3. Verify:
   - status transitions from `retrying` to `failed`
   - `next_retry_at` becomes null after final attempt
   - no automatic infinite retry loop from scheduled mode once max reached.

## Scenario 6: Platform Ops Scope
1. Open `/platform-admin/notifications-ops`.
2. Verify global view:
   - cross-tenant summary appears
   - external sent/failed/retrying/skipped counters visible
   - provider error distribution visible
   - failed/retrying rows show attempts and error summary.

## Scenario 7: Manager Tenant Scope
1. Open `/manager/notifications-ops` as manager.
2. Verify:
   - only current tenant deliveries/runs are visible
   - manager cannot read cross-tenant data
   - retry action only affects own tenant scope.

## Regression Checks
- In-app notification creation/read/mark-read behavior unchanged.
- External dispatch failures do not fail core business actions.
- `npm run typecheck` and `npx eslint` pass.
