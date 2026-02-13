# Go-Live Gate (Commercial)

## Pass/Fail Rule
- Any `[FAIL]` in automated checks: block launch.
- Any unresolved High risk item in manual checklist: block launch.
- Warnings can ship only with explicit owner and deadline.

## 1. Automated Gate
Run:

```powershell
npm run go-live:check
```

Expected:
- `typecheck` pass
- `lint` pass (or only approved warnings)
- `build` pass
- `ui:check-cards` pass
- `test:smoke` pass
- API auth guard scan reviewed
- migration/RLS/RPC sanity checks pass
- webhook signature/idempotency hints present

## 2. Manual Security Gate
- Confirm production env variables are complete (no auth fail-open startup).
- Confirm payment webhook secret rotation and storage policy.
- Confirm rate-limit strategy for login + write-heavy routes.
- Confirm no sensitive data in logs (token/password/PII).

## 3. Manual Data Integrity Gate
- Validate refund/void/pass-adjust flows on staging with real DB transactions.
- Validate idempotency for payment and redemption retries.
- Validate timezone behavior for booking/expiry/report windows.
- Validate rollback plan for latest migration batch.

## 4. Manual Operational Gate
- On-call owner assigned for launch window.
- Alert channels working (health, cron failures, webhook failures).
- Support SOP ready: member access issue, payment mismatch, entitlement mismatch.
- Post-launch checkpoints scheduled (T+1h, T+24h, T+7d).

## 5. Manual Product/Legal Gate
- Privacy policy, terms, and refund policy links visible in product.
- Data retention/deletion policy documented.
- Tenant/admin permissions matrix approved.

## Sign-off Record
- Date:
- Release/commit:
- Tech owner:
- Product owner:
- Decision: `GO` / `NO-GO`
- Notes:
