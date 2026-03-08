# Phase 5.5 Migration and Backfill Checklist

## Scope
- Phase 2: `tenant_subscriptions` lifecycle
- Phase 3: staff role / profile governance fields
- Phase 4: member plan catalog / contracts / ledger lifecycle
- Phase 5.5: idempotency + consistency hardening

## Required migration order
1. `20260305123000_tenant_subscription_lifecycle.sql`
2. `20260305143000_staff_account_permissions.sql`
3. `20260306103000_member_plan_contract_lifecycle.sql`
4. `20260306203000_phase55_stability_hardening.sql`

## Post-apply verification
1. Table readiness:
- `tenant_subscriptions`, `saas_plans`
- `member_plan_catalog`, `member_plan_contracts`, `member_plan_ledger`
- `operation_idempotency_keys`

2. Column readiness:
- `profiles.invited_by`, `profiles.created_by`, `profiles.updated_by`, `profiles.last_login_at`
- `session_redemptions.member_plan_contract_id`
- `subscriptions.member_plan_contract_id`, `subscriptions.source_order_id`, `subscriptions.source_payment_id`
- `entry_passes.member_plan_contract_id`, `entry_passes.total_sessions`

3. Backfill readiness:
- Every tenant has one current `tenant_subscriptions` row
- Current subscription statuses are date-consistent (`active/trial/grace/expired`)
- `member_plan_catalog` contains mapped rows for existing `products`

4. RLS readiness:
- `tenant_subscriptions`, `saas_plans`, `member_plan_*`, `operation_idempotency_keys` policies exist
- tenant-scoped users can only read/write within own tenant
- platform admin can manage cross-tenant rows

## Manual SQL-level checks still required in production
- `app_role` enum values (`supervisor`, `branch_manager`, `sales`) presence
- unique/index health on large tables after migration apply
- query plan health for consistency checks on production scale
