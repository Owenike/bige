-- Phase 7: booking lifecycle notifications, scheduled reminders, and dispatch safety.

alter table public.notification_templates
  add column if not exists template_key text;

update public.notification_templates
set template_key = coalesce(template_key, event_type)
where template_key is null;

create index if not exists notification_templates_template_key_idx
  on public.notification_templates(template_key, tenant_id, channel, locale, is_active, updated_at desc);

alter table public.notification_deliveries
  add column if not exists booking_id uuid references public.bookings(id) on delete cascade,
  add column if not exists member_id uuid references public.members(id) on delete set null,
  add column if not exists template_key text,
  add column if not exists scheduled_for timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists skipped_reason text,
  add column if not exists failure_reason text,
  add column if not exists delivery_mode text not null default 'simulated',
  add column if not exists recipient_name text,
  add column if not exists recipient_phone text,
  add column if not exists recipient_email text;

update public.notification_deliveries
set delivery_mode = coalesce(delivery_mode, 'simulated')
where delivery_mode is null;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_status_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_status_check
  check (status in ('pending', 'sent', 'failed', 'skipped', 'retrying', 'dead_letter', 'cancelled'));

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_delivery_mode_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_delivery_mode_check
  check (delivery_mode in ('simulated', 'provider'));

create index if not exists notification_deliveries_booking_idx
  on public.notification_deliveries(tenant_id, booking_id, created_at desc)
  where booking_id is not null;

create index if not exists notification_deliveries_schedule_idx
  on public.notification_deliveries(tenant_id, status, scheduled_for, next_retry_at, created_at desc);

create index if not exists notification_deliveries_member_idx
  on public.notification_deliveries(tenant_id, member_id, created_at desc)
  where member_id is not null;

insert into public.notification_templates (
  tenant_id,
  template_key,
  event_type,
  channel,
  locale,
  title_template,
  message_template,
  email_subject,
  priority,
  channel_policy,
  is_active,
  version
)
select *
from (
  values
    (null::uuid, 'booking_created', 'booking_created', 'email', 'zh-TW', '預約已建立', '{{customerName}}，您已成功預約 {{serviceName}}，時間為 {{bookingDate}} {{bookingTime}}。', '預約成功通知', 'info', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_created', 'booking_created', 'sms', 'zh-TW', '預約已建立', '{{customerName}} 已成功預約 {{serviceName}}，時間 {{bookingDate}} {{bookingTime}}。', null, 'info', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_created', 'booking_created', 'line', 'zh-TW', '預約已建立', '{{customerName}} 已成功預約 {{serviceName}}，時間 {{bookingDate}} {{bookingTime}}。', null, 'info', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_rescheduled', 'booking_rescheduled', 'email', 'zh-TW', '預約已改期', '{{customerName}}，您的預約已改為 {{bookingDate}} {{bookingTime}}。', '預約改期通知', 'warning', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_rescheduled', 'booking_rescheduled', 'sms', 'zh-TW', '預約已改期', '{{customerName}} 的預約已改為 {{bookingDate}} {{bookingTime}}。', null, 'warning', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_rescheduled', 'booking_rescheduled', 'line', 'zh-TW', '預約已改期', '{{customerName}} 的預約已改為 {{bookingDate}} {{bookingTime}}。', null, 'warning', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_cancelled', 'booking_cancelled', 'email', 'zh-TW', '預約已取消', '{{customerName}}，您的預約 {{serviceName}} 已取消。', '預約取消通知', 'warning', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_cancelled', 'booking_cancelled', 'sms', 'zh-TW', '預約已取消', '{{customerName}} 的預約 {{serviceName}} 已取消。', null, 'warning', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_cancelled', 'booking_cancelled', 'line', 'zh-TW', '預約已取消', '{{customerName}} 的預約 {{serviceName}} 已取消。', null, 'warning', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_reminder_day_before', 'booking_reminder_day_before', 'email', 'zh-TW', '預約前一天提醒', '{{customerName}}，提醒您明天 {{bookingTime}} 有 {{serviceName}} 預約。', '預約提醒', 'info', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_reminder_day_before', 'booking_reminder_day_before', 'sms', 'zh-TW', '預約前一天提醒', '提醒您明天 {{bookingTime}} 有 {{serviceName}} 預約。', null, 'info', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_reminder_day_before', 'booking_reminder_day_before', 'line', 'zh-TW', '預約前一天提醒', '提醒您明天 {{bookingTime}} 有 {{serviceName}} 預約。', null, 'info', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_reminder_1h', 'booking_reminder_1h', 'email', 'zh-TW', '預約即將開始', '{{customerName}}，您的 {{serviceName}} 預約將於 1 小時後開始。', '預約即將開始', 'warning', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_reminder_1h', 'booking_reminder_1h', 'sms', 'zh-TW', '預約即將開始', '{{serviceName}} 預約將於 1 小時後開始。', null, 'warning', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_reminder_1h', 'booking_reminder_1h', 'line', 'zh-TW', '預約即將開始', '{{serviceName}} 預約將於 1 小時後開始。', null, 'warning', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_deposit_pending', 'booking_deposit_pending', 'email', 'zh-TW', '尚有訂金待支付', '{{customerName}}，您的預約仍有 {{depositAmount}} 訂金待支付。', '訂金付款提醒', 'warning', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_deposit_pending', 'booking_deposit_pending', 'sms', 'zh-TW', '尚有訂金待支付', '您的預約仍有 {{depositAmount}} 訂金待支付。', null, 'warning', '{"allowExternal":true}'::jsonb, true, 1),
    (null::uuid, 'booking_deposit_pending', 'booking_deposit_pending', 'line', 'zh-TW', '尚有訂金待支付', '您的預約仍有 {{depositAmount}} 訂金待支付。', null, 'warning', '{"allowExternal":true}'::jsonb, true, 1)
) as seed(tenant_id, template_key, event_type, channel, locale, title_template, message_template, email_subject, priority, channel_policy, is_active, version)
where not exists (
  select 1
  from public.notification_templates existing
  where existing.tenant_id is not distinct from seed.tenant_id
    and existing.event_type = seed.event_type
    and existing.channel = seed.channel
    and existing.locale = seed.locale
    and existing.version = seed.version
);
