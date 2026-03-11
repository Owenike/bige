# Notification Runtime Integration Order (Future)

## Goal
Connect Phase 2 productization artifacts (preferences/templates/retry governance) into runtime safely, without breaking existing notification backbone.

## Current boundary
Already delivered:
- Preferences/templates/retry CRUD and operation surfaces
- Query/service layer for reliability metrics
- Admin audit trace schema/service

Still intentionally disconnected:
- `/api/jobs/run`
- `createInAppNotifications` runtime creation decision
- dispatch core runtime decision loop

## Step 0: Contract + simulation + readiness baseline
Before any runtime wiring:
1. Freeze runtime integration contracts.
2. Build reusable simulation fixtures.
3. Validate readiness with read-only validator.
4. Confirm scenario outputs with tests/docs.

References:
- [notification-runtime-integration-contracts.md](/c:/Users/User/bige/docs/notification-runtime-integration-contracts.md)
- [notification-runtime-simulation-scenarios.md](/c:/Users/User/bige/docs/notification-runtime-simulation-scenarios.md)
- [notification-runtime-readiness-validation.md](/c:/Users/User/bige/docs/notification-runtime-readiness-validation.md)

## Recommended sequence

### Step 1: Preference read-path (shadow mode)
1. Add a pure resolver call in runtime path to compute effective preference.
2. Keep runtime behavior unchanged; only log computed source (`platform_default/tenant_default/role/user`).
3. Compare shadow output with current behavior for at least one release window.

Safety gates:
- feature flag per tenant
- no write-back to product tables from runtime
- no privilege model changes

### Step 2: Template selection read-path (shadow mode)
1. Add fallback selector call for event/channel/locale.
2. Keep existing payload generation as source of truth.
3. Log selected template source and fallback strategy for comparison.

Safety gates:
- fallback to existing content generator when template missing/invalid
- strict sanitize/length limits unchanged

### Step 3: Preference + template controlled activation
1. Enable for pilot tenants only.
2. Add kill switch per tenant and global.
3. Track:
   - delivery sent/failed deltas
   - skipped reason deltas
   - operator incident count

Safety gates:
- instant rollback switch
- no migration-required runtime toggle

### Step 4: Retry lifecycle deep integration
1. Write dry-run/execute actions into `notification_admin_audit_logs`.
2. Add retry policy source/version tags to operation payload.
3. Keep dispatch core algorithm unchanged until policy parity is proven.

Safety gates:
- blocked reason taxonomy frozen before rollout
- retry execute requires explicit operation mode and actor trace

### Step 5: Platform Ops Dashboard UI
Start only when:
1. Query layer metrics are stable across at least one full cron cycle window.
2. Audit traces are populated from real operations.
3. Preference/template runtime activation has a kill switch and rollback SOP.

Then build UI on top of existing query layer only; avoid embedding raw DB logic in page code.

## What must remain unchanged during integration
- `notification_job_runs` business semantics
- cron schedule and `/api/jobs/run` behavior
- tenant scope and role boundary checks
- dispatch core error classification unless explicitly versioned
