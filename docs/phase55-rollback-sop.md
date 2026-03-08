# Phase 5.5 Rollback and Recovery SOP

## 1) Migration apply fails
1. Stop new deploy rollout.
2. Check failed migration id and error.
3. If failure is non-destructive DDL conflict, apply hotfix migration with guard clauses.
4. Re-run migration from failed step only after verification.
5. Re-run `GET /api/platform/consistency` after apply.

## 2) Wrong tenant subscription state
1. Use `PATCH /api/platform/subscriptions/{tenantId}` with explicit action:
- `restore`, `suspend`, `enter_grace`, `renew`, or `update`.
2. Validate tenant access via `GET /api/platform/subscriptions/{tenantId}` access block.
3. Check audit trail action entries under `tenant_subscription_*`.

## 3) Wrong staff role/scope assignment
1. Update via `PATCH /api/manager/staff` (role / branch / isActive).
2. Validate permission matrix behavior immediately with role-bound APIs.
3. Confirm `staff_role_updated` / `staff_branch_updated` / `staff_activated|deactivated` audit entries.

## 4) Entitlement granted to wrong member or wrong balance
1. Identify source order/payment and related contract id.
2. If refund/void is valid, run high-risk approval workflow.
3. If not refundable, run pass adjustment/contract repair and write reasoned audit note.
4. Verify contract + pass + ledger consistency with `/api/manager/consistency`.

## 5) Redemption consumed wrong entitlement
1. Locate redemption id and contract id.
2. Apply compensating adjustment on target pass/contract.
3. Record reason in adjustment and verify ledger has reversal-like trace.

## 6) What must always be checked before close
- `audit_logs` entries for create/update/reversal actions
- `member_plan_ledger` balance trail
- `member_plan_contracts` status and remaining
- `tenant_subscriptions` current row and dates
