# Trial Booking Admin

## Purpose

`/admin/trial-bookings` is a simple read-only admin page for checking first-time trial booking submissions from the public website.

The page reads from `trial_bookings` through `/api/admin/trial-bookings` and shows the latest 100 records sorted by `created_at desc`.

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

- Login protection has not been hardened yet.
- Status editing is not supported yet.
- Deleting bookings is not supported yet.
- Exporting bookings is not supported yet.
- ACPay is not connected yet.
- LINE notification is not connected yet.
