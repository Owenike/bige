# Trial Booking Phase 2

## Summary

- Added the `trial_bookings` table SQL draft.
- Added `/api/trial-booking/create`.
- Updated `/trial-booking` so the form submits to the API.
- The API maps `paymentMethod` to an initial `payment_status`.
- The API returns a booking id after a successful insert.
- Added an admin page at `/admin/trial-bookings`.
- Hardened the trial booking admin view and API with the existing profile role guard.
- Added admin-side `booking_status` updates for trial bookings.

## `trial_bookings` Fields

- `id`: UUID primary key.
- `created_at` / `updated_at`: record timestamps.
- `name`: customer name.
- `phone`: customer phone.
- `line_name`: optional LINE display name.
- `service`: selected trial service.
- `preferred_time`: preferred contact or booking time.
- `note`: optional customer note.
- `payment_method`: selected payment method.
- `payment_status`: current payment status.
- `amount`: reserved for future online payment amount.
- `currency`: defaults to `TWD`.
- `acpay_trade_no`: reserved for future ACPay trade number.
- `merchant_trade_no`: reserved for future merchant trade number.
- `paid_at`: reserved for future payment completion time.
- `source`: defaults to `website_trial_booking`.
- `booking_status`: defaults to `new`.

## Payment Mapping

- `cash_on_site` -> `pending_cash`
- `online_payment` -> `pending_payment`

## API Route

- Route: `/api/trial-booking/create`
- Method: `POST`
- Client: `createSupabaseAdminClient()` from `lib/supabase/admin.ts`
- Required fields:
  - `name`
  - `phone`
  - `service`
  - `preferredTime`
  - `paymentMethod`
- Success response returns:
  - `booking.id`
  - `booking.paymentMethod`
  - `booking.paymentStatus`
  - `booking.bookingStatus`

## Admin View

- Page: `/admin/trial-bookings`
- API: `/api/admin/trial-bookings`
- Current scope: list, search, filters, and `booking_status` updates.
- Access is limited to `platform_admin` and `manager` roles through the existing auth guard.
- Supported filters:
  - `paymentMethod`
  - `paymentStatus`
  - `bookingStatus`
  - `q` for name, phone, and LINE name search
- The admin view lists the latest 100 records by `created_at desc`.
- `payment_status` remains reserved for ACPay or a dedicated payment flow and is not editable in this admin view.

## Current Limits

- ACPay is not connected yet.
- LINE notification is not connected yet.
- Export and delete actions are not supported yet.
- Status change audit logs are not implemented yet.

## Next Steps

1. Confirm the target Supabase project has `trial_bookings`.
2. Verify `/api/trial-booking/create` writes to the target project.
3. Use `/admin/trial-bookings` to review incoming submissions.
4. Confirm admin login protection and allowed roles before production exposure.
5. Add status change audit logs.
6. Connect ACPay payment handling.
7. Add LINE notifications after the booking and payment flow is stable.
