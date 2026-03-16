# Deposit Payment Live Smoke Evidence Template

Use this template after deployment to record one real or sandbox booking deposit smoke run.

## Run Metadata
- Evidence ID:
- Date:
- Environment:
- Operator:
- Source: manual / replay / live
- Provider mode: live / sandbox
- Result: pass / fail / partial

## Booking
- Booking ID:
- Public reference:
- Branch:
- Member:
- Service:
- Deposit required amount:

## Payment Creation
- Order ID:
- Payment ID:
- Booking payment status snapshot:
- Provider:
- Checkout link generated:
- Generated at:
- Reused pending or regenerated:

## Provider Callback
- Callback received at:
- Signature verification: pass / fail
- Raw payload file or redacted snapshot:
- Canonical payment id source:
- Canonical order id source:
- Canonical status source:
- Canonical gateway ref source:
- Provider reference / trade no:
- Merchant trade no:
- Normalized provider status:
- Duplicate / ignored / regression:
- Compare result summary:

## Internal State After Callback
- `payments.status`:
- `orders.status`:
- `bookings.payment_status`:
- `bookings.deposit_paid_amount`:
- `bookings.payment_reference`:
- `payment_webhooks` audit record:

## Manager / Booking Evidence
- Manager booking detail payment status:
- Manager order / payment / webhook timeline reviewed:
- Latest webhook status / time:
- Latest regenerate summary:
- Operation evidence summary:
- `/booking` paid state verified:

## Notifications / Reports Checks
- Deposit reminder cancelled:
- Verification source:
- Reports summary reflected deposit paid:
- Verification source:

## Checklist Summary
- Payment link obtained:
- Callback received:
- Manager detail verified:
- Booking mirror verified:
- Notifications verified:
- Reports verified:
- Checklist summary:

## Persisted Evidence Snapshot
- Notes:
- Raw evidence payload / redacted snapshot:
- Readiness blockers:
- Readiness warnings:
- Latest webhook status:
- Latest webhook processed at:

## Failure Analysis
- Failure step:
- Failure reason:
- Retryable:
- Next action:

## Acceptance Notes
- Live smoke accepted:
- Reviewer:
- Reviewed at:
