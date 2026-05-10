# Trial Booking Admin

## Purpose

`/admin/trial-bookings` is a simple read-only admin page for checking first-time trial booking submissions from the public website.

The page reads from `trial_bookings` through `/api/admin/trial-bookings` and shows the latest 100 records sorted by `created_at desc`.

The page and API are protected with the existing `requireProfile` guard. Allowed roles are `platform_admin` and `manager`; the existing manager-equivalent role handling also covers supervisor, branch manager, store owner, and store manager profiles.

Before Vercel Production is switched to xtac, confirm the required admin users, `profiles` rows, and role values also exist in the xtac Supabase project.

For xtac specifically, `/admin/trial-bookings` needs at least one active `platform_admin`, `manager`, or manager-equivalent profile (`supervisor`, `branch_manager`, `store_owner`, or `store_manager`). If the admin page is inaccessible after a Supabase cutover, first check Supabase Auth users and `profiles.role` in the target project.

If xtac does not yet have an eligible admin profile, use `docs/xtac-auth-profile-bootstrap-plan.md` to plan the required Auth user and `profiles` row. At minimum, the target project needs a working `platform_admin` or `manager` / manager-equivalent account before `/admin/trial-bookings` can be operated after cutover.

xtac now has a masked `platform_admin` account (`b***69@g***.com`) that can satisfy the trial bookings admin role guard. The separate masked `frontdesk` account (`b***90@g***.com`) remains a frontdesk role and is not an allowed trial bookings admin role.

Login readiness check on 2026-05-11:

- The masked platform admin account still has an active `platform_admin` profile in xtac.
- Unauthenticated `GET /api/admin/trial-bookings` returns `401` and does not return booking data.
- Unauthenticated `PATCH /api/admin/trial-bookings/:id/status` returns `401`.
- The unauthenticated admin page renders without a server-side data leak and shows login-related content.
- Full platform admin login was not completed in Code App because no password or email-link session was available. Do not trigger reset/magic-link flows without explicit approval.

Follow-up check on 2026-05-11 after the platform admin password was set:

- The masked platform admin account still has an active `platform_admin` profile in xtac.
- Unauthenticated `GET /api/admin/trial-bookings` still returns `401`.
- Unauthenticated `PATCH /api/admin/trial-bookings/:id/status` still returns `401`.
- The unauthenticated page still renders login-related content without returning booking data.
- Code App still could not complete the actual platform admin login because no password or browser session was provided to the agent. The next check should be done after the user logs in locally or provides an approved session-based test path.

## API

Route: `/api/admin/trial-bookings`

Method: `GET`

Query params:

- `paymentMethod`: `cash_on_site` or `online_payment`
- `paymentStatus`: `pending_cash`, `pending_payment`, `paid`, `failed`, or `cancelled`
- `bookingStatus`: `new`, `contacted`, `scheduled`, `completed`, or `cancelled`
- `q`: searches `name`, `phone`, and `line_name`; trimmed and capped at 80 characters

Success response:

```json
{
  "ok": true,
  "bookings": []
}
```

Failure response:

```json
{
  "ok": false,
  "error": "..."
}
```

Auth failures:

- `401`: `{ "ok": false, "error": "Unauthorized" }`
- `403`: `{ "ok": false, "error": "Forbidden" }`

Route: `/api/admin/trial-bookings/:id/status`

Method: `PATCH`

Body:

```json
{
  "bookingStatus": "contacted"
}
```

Allowed `bookingStatus` values:

- `new`
- `contacted`
- `scheduled`
- `completed`
- `cancelled`

This route only updates `booking_status`. It does not accept or update `payment_status`.

Success response:

```json
{
  "ok": true,
  "booking": {
    "id": "...",
    "booking_status": "contacted",
    "updated_at": "..."
  }
}
```

Error responses:

- `400`: invalid id or invalid `bookingStatus`
- `401`: unauthenticated
- `403`: authenticated but not allowed
- `404`: booking not found
- `500`: server or Supabase error

## Field Labels

### service

- `weight_training`: 重量訓練
- `boxing_fitness`: 拳擊體能訓練
- `pilates`: 器械皮拉提斯
- `sports_massage`: 運動按摩

### preferred_time

- `weekday_morning`: 平日上午
- `weekday_afternoon`: 平日下午
- `weekday_evening`: 平日晚上
- `weekend_morning`: 假日上午
- `weekend_afternoon`: 假日下午
- `weekend_evening`: 假日晚上
- `other`: 其他

### payment_method

- `cash_on_site`: 當天付現
- `online_payment`: 線上付款

### payment_status

- `pending_cash`: 現場付款待確認
- `pending_payment`: 線上付款待處理
- `paid`: 已付款
- `failed`: 付款失敗
- `cancelled`: 已取消

### booking_status

- `new`: 新預約
- `contacted`: 已聯繫
- `scheduled`: 已安排
- `completed`: 已完成
- `cancelled`: 已取消

## Current Limits

- The admin page supports updating `booking_status` only.
- `payment_status` cannot be edited manually from this admin page.
- Deleting bookings is not supported yet.
- Exporting bookings is not supported yet.
- ACPay is not connected yet.
- LINE notification is not connected yet.
- Status change audit logs are not implemented yet.
