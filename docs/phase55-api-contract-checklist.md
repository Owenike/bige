# Phase 5.5 API Contract Checklist

## Target contract
- Success: `{ ok: true, data }`
- Failure: `{ ok: false, error: { code, message } }`

## Enforced and reviewed in this phase
- Platform:
  - `/api/platform/subscriptions`
  - `/api/platform/subscriptions/:tenantId`
  - `/api/platform/billing`
  - `/api/platform/consistency`
- Manager:
  - `/api/manager/staff`
  - `/api/manager/members`
  - `/api/manager/members/:id`
  - `/api/manager/members/:id/plans`
  - `/api/manager/pass-adjustments`
  - `/api/manager/consistency`
- Core business:
  - `/api/orders`
  - `/api/payments`
  - `/api/orders/:id/void`
  - `/api/payments/:id/refund`
  - `/api/session-redemptions`
  - `/api/bookings`
  - `/api/member/bookings`
  - `/api/member/entitlements`
  - `/api/frontdesk/invoices`
  - `/api/frontdesk/booking-waitlist`
  - `/api/frontdesk/booking-sync`
  - `/api/approvals/:id/decision`

## Transitional endpoints (legacy-compatible response shape retained)
- `/api/entry/verify`:
  - Keeps scanner-oriented `decision/reason/member/membership` payload contract.
  - Eligibility check now unified internally, but response shape intentionally remains scanner-compatible.

## Operational recommendation
- Use `/api/platform/consistency` to audit static API contract compliance warnings before release.
