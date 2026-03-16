# Sports Massage Phase 1 Architecture

## Current project mapping

- `tenants` remains the SaaS tenant boundary.
- `branches` is the store entity for storefronts and per-store rules.
- `profiles` remains the staff table.
- Existing `coach` / `coach_slots` / `coach_blocks` are the baseline for therapist profile, schedule, and temporary blocking.
- Existing `members` and `bookings` are preserved. Later public bookings can create or link customer records without deleting the current member-first flow.
- Existing `feature_flags`, `audit_logs`, `notification_*`, and manager APIs remain the operational foundation.

## New Phase 1 schema

- `storefront_brand_contents`
  - Branch-aware storefront copy and visual preferences.
  - Uses tenant default row when `branch_id` is null.
- `store_booking_settings`
  - Branch-aware booking rules, deposit toggles, customer reschedule/cancel policy, notification flags, and future cross-store therapist switch.
- `storefront_brand_assets`
  - Metadata shell for image uploads and later storage integration.
- `booking_status_logs`
  - Additive booking status history without replacing existing `audit_logs`.

## Additive extensions

- `services`
  - Added price, description, buffers, deposit settings, branch override, and soft-delete support.
- `bookings`
  - Added public-facing reference, deposit / payment status surface, customer contact fields, and status timestamps.

## Role alignment

The codebase now accepts these additional role names without removing current ones:

- `store_owner` -> manager-equivalent
- `store_manager` -> branch-manager-equivalent
- `therapist` -> coach-equivalent
- `customer` -> member-equivalent

This keeps current APIs working while opening a clean path for later massage-domain RBAC.

## Public storefront read flow

1. Public client requests `/api/public/storefront?branchId=...` or `branchCode=...`.
2. Server resolves active branch with admin client.
3. Branch payload is assembled from:
   - branch-specific brand content, else tenant default
   - branch-specific booking settings, else tenant default
   - active services scoped to branch override or tenant default

## Manager editing flow

1. Manager requests `/api/manager/storefront`.
2. API enforces tenant scope and branch scope.
3. Brand content and booking settings are upserted per tenant + scope key.
4. `audit_logs` records each configuration change.

## Deferred to later phases

- Real image upload pipeline and storage bucket workflow
- Public booking UI and slot selection UI
- Deposit order creation / payment transaction lifecycle
- Package consumption / restoration
- Full therapist-service mapping and cross-store conflict enforcement
- Reports and notification orchestration for massage-specific metrics
