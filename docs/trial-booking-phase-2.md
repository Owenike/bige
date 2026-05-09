# Trial Booking Phase 2

## 本輪完成內容

- 建立 `trial_bookings` 資料表 SQL 草案
- 新增 `/api/trial-booking/create`
- `/trial-booking` 表單已改為呼叫 API
- API 會依付款方式寫入不同 `payment_status`
- 成功後前端會顯示 booking id 與付款狀態摘要

## `trial_bookings` 欄位說明

- `id`: 預約編號，使用 UUID
- `created_at` / `updated_at`: 建立與更新時間
- `name`: 姓名
- `phone`: 聯絡電話
- `line_name`: LINE 名稱
- `service`: 體驗項目
- `preferred_time`: 偏好時段
- `note`: 備註
- `payment_method`: 付款方式
- `payment_status`: 付款狀態
- `amount`: 金額預留欄位，本階段先寫入 `null`
- `currency`: 幣別，預設 `TWD`
- `acpay_trade_no`: ACPay 交易編號預留
- `merchant_trade_no`: 商店交易編號預留
- `paid_at`: 付款完成時間預留
- `source`: 資料來源，本階段固定為 `website_trial_booking`
- `booking_status`: 預約處理狀態，本階段預設 `new`

## payment_method 對照

- `cash_on_site`: 當天付現
- `online_payment`: 線上付款

## payment_status 對照

- `pending_cash`: 選擇當天付現，待專人確認時段
- `pending_payment`: 選擇線上付款，待後續付款流程開放
- `paid`: 付款完成
- `failed`: 付款失敗
- `cancelled`: 已取消

## API route 說明

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

## 尚未串接 ACPay

- 本階段不建立金流交易
- `amount` 先保留為 `null`
- 後續可依 `paymentMethod = online_payment` 進入 ACPay 建立付款流程

## 尚未串接 LINE

- 本階段不發送 LINE 通知
- 後續可在 booking 建立成功或付款成功時通知店家與使用者

## 下一階段建議

1. 手動到 Supabase SQL Editor 執行 `docs/trial-bookings-table.sql`
2. 確認環境已有 `NEXT_PUBLIC_SUPABASE_URL` 與 `SUPABASE_SERVICE_ROLE_KEY`
3. 執行完 SQL 後測試 `/api/trial-booking/create`
4. 建立後台查看與管理 trial bookings
5. 規劃 ACPay 建立付款、callback、付款成功回寫與 LINE 通知
