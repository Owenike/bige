# Deposit Payment Go-Live Checklist

## Scope
- Booking deposit payment only
- Provider: NewebPay
- Surfaces: `/booking`, `/manager/bookings`, `/api/payments/newebpay/initiate`, `/api/payments/newebpay/webhook`
- Evidence template: `docs/deposit-payment-live-smoke-evidence-template.md`

## Env
- `NEWEBPAY_CHECKOUT_URL`
- `NEWEBPAY_WEBHOOK_URL`
- `NEWEBPAY_WEBHOOK_SECRET`

## Deployment Checks
- `/api/payments/newebpay/initiate` reachable
- `/api/payments/newebpay/webhook` reachable
- booking detail readiness block visible in manager booking detail
- callback verification enabled
- migration `20260316193000_phase11_booking_deposit_provider.sql` applied
- provider console callback points to `/api/payments/newebpay/webhook`

## Booking Eligibility Checks
- store deposit capability enabled
- service marked `requires_deposit`
- booking is `deposit_pending`
- booking is not `cancelled`, `completed`, or `no_show`
- inspect reusable pending / stale pending / paid payment ids in manager booking detail

## Smoke Steps
1. Create a `deposit_pending` booking.
2. Open `/manager/bookings` and confirm order / payment / provider reference / webhook timeline render.
3. Copy payment link and confirm manager sees feedback.
4. Regenerate payment link and confirm summary says reused / regenerated / blocked.
5. Run `npm run check:deposit-payment-fixtures`.
6. Run `npm run check:deposit-payment-samples`.
7. Fill `docs/deposit-payment-live-smoke-evidence-template.md` with booking/order/payment/reference values.
8. Save the same evidence snapshot from manager booking detail via `Save live smoke evidence`.
9. Confirm success fixture maps booking to `deposit_paid` or `fully_paid`.
10. Confirm fail / timeout / regression fixtures do not downgrade already-paid state.
11. Confirm `payment_deposit_paid` compatibility means deposit reminder queue no longer stays pending.
12. Confirm reports and manager detail still read the correct booking mirror fields.

## Deployment Smoke
1. In deployed env, create one real `deposit_pending` booking.
2. Open `/manager/bookings` and confirm `Deposit readiness` is ready or only warns about expected live items.
3. Generate or reuse a payment link and record `order id`, `payment id`, `provider reference`, `checkout link created at`.
4. Complete one provider payment or sandbox payment.
5. Wait for callback and record:
   - raw callback payload snapshot
   - callback time
   - signature verification result
   - normalized mapping result
6. Confirm manager booking detail shows:
   - `Deposit Paid`
   - `Payment Reference`
   - latest webhook status/time
   - latest operation evidence
7. Confirm `/booking` reflects paid deposit state.
8. Confirm deposit reminder is no longer pending.
9. Confirm manager reports summary reads the updated booking payment mirror.
10. Save or update the persisted live smoke evidence record from manager booking detail.
11. Mark the evidence template as `pass`, `partial`, or `fail`.

## Failure Checks
- callback not reaching `/api/payments/newebpay/webhook`
- signature mismatch
- payload missing canonical identifiers
- mapping unexpected `ignored regression`
- `payments.status`, `orders.status`, and `bookings.payment_status` not aligned
- manager detail evidence does not match webhook audit
- reports or notifications still reflect `deposit_pending`

## Live Payload Compare
- Default samples:
  - `scripts/fixtures/newebpay/live-success.json`
  - `scripts/fixtures/newebpay/live-regression.json`
- Compare command:
  - `npm run check:deposit-payment-samples`
- Optional real sample:
  - `powershell -ExecutionPolicy Bypass -File scripts/check-deposit-payment-samples.ps1 <path-to-sample.json>`
- Compare output should capture:
  - canonical vs fallback field source
  - normalized provider status
  - `payments.status`
  - `orders.status`
  - `bookings.payment_status`
  - duplicate / ignored / regression decision
  - missing canonical field warnings

## When Provider Console Is Ready
- Point provider callback to `/api/payments/newebpay/webhook`
- Confirm `NEWEBPAY_WEBHOOK_SECRET` matches deployment env
- Replay fixtures first, then replay a real provider sample, then do one live payment smoke
- After the live smoke, attach the completed evidence template to the deployment acceptance note
