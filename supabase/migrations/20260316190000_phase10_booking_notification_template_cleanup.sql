-- Phase 10: clean booking notification template copy and normalize booking event variables.

with template_seed as (
  select *
  from (
    values
      ('booking_created', 'email', 'zh-TW', '預約已建立', '{{customerName}}，您已成功預約 {{serviceName}}。時間：{{bookingDate}} {{bookingTime}}，預約編號：{{publicReference}}。', '預約成功通知'),
      ('booking_created', 'sms', 'zh-TW', '預約已建立', '{{customerName}} 您已預約 {{serviceName}}，時間 {{bookingDate}} {{bookingTime}}，編號 {{publicReference}}。', null),
      ('booking_created', 'line', 'zh-TW', '預約已建立', '{{customerName}} 您已預約 {{serviceName}}，時間 {{bookingDate}} {{bookingTime}}，編號 {{publicReference}}。', null),
      ('booking_rescheduled', 'email', 'zh-TW', '預約已改期', '{{customerName}}，您的 {{serviceName}} 預約已改為 {{bookingDate}} {{bookingTime}}，預約編號：{{publicReference}}。', '預約改期通知'),
      ('booking_rescheduled', 'sms', 'zh-TW', '預約已改期', '{{customerName}} 您的 {{serviceName}} 預約已改為 {{bookingDate}} {{bookingTime}}，編號 {{publicReference}}。', null),
      ('booking_rescheduled', 'line', 'zh-TW', '預約已改期', '{{customerName}} 您的 {{serviceName}} 預約已改為 {{bookingDate}} {{bookingTime}}，編號 {{publicReference}}。', null),
      ('booking_cancelled', 'email', 'zh-TW', '預約已取消', '{{customerName}}，您的 {{serviceName}} 預約已取消，預約編號：{{publicReference}}。若需重新安排，請再與我們聯繫。', '預約取消通知'),
      ('booking_cancelled', 'sms', 'zh-TW', '預約已取消', '{{customerName}} 您的 {{serviceName}} 預約已取消，編號 {{publicReference}}。', null),
      ('booking_cancelled', 'line', 'zh-TW', '預約已取消', '{{customerName}} 您的 {{serviceName}} 預約已取消，編號 {{publicReference}}。', null),
      ('booking_reminder_day_before', 'email', 'zh-TW', '預約前一天提醒', '{{customerName}}，提醒您明天 {{bookingTime}} 於 {{branchName}} 有 {{serviceName}} 預約。預約編號：{{publicReference}}。', '預約提醒'),
      ('booking_reminder_day_before', 'sms', 'zh-TW', '預約前一天提醒', '{{customerName}} 提醒您明天 {{bookingTime}} 於 {{branchName}} 有 {{serviceName}} 預約。', null),
      ('booking_reminder_day_before', 'line', 'zh-TW', '預約前一天提醒', '{{customerName}} 提醒您明天 {{bookingTime}} 於 {{branchName}} 有 {{serviceName}} 預約。', null),
      ('booking_reminder_1h', 'email', 'zh-TW', '預約即將開始', '{{customerName}}，您的 {{serviceName}} 預約將於 1 小時後開始，地點：{{branchName}}。', '預約即將開始'),
      ('booking_reminder_1h', 'sms', 'zh-TW', '預約即將開始', '{{customerName}} 您的 {{serviceName}} 預約將於 1 小時後開始。', null),
      ('booking_reminder_1h', 'line', 'zh-TW', '預約即將開始', '{{customerName}} 您的 {{serviceName}} 預約將於 1 小時後開始。', null),
      ('booking_deposit_pending', 'email', 'zh-TW', '尚有訂金待支付', '{{customerName}}，您的 {{serviceName}} 預約尚有 {{depositAmount}} 訂金待支付。預約編號：{{publicReference}}。', '訂金付款提醒'),
      ('booking_deposit_pending', 'sms', 'zh-TW', '尚有訂金待支付', '{{customerName}} 您的預約尚有 {{depositAmount}} 訂金待支付。', null),
      ('booking_deposit_pending', 'line', 'zh-TW', '尚有訂金待支付', '{{customerName}} 您的預約尚有 {{depositAmount}} 訂金待支付。', null)
  ) as seed(event_type, channel, locale, title_template, message_template, email_subject)
)
update public.notification_templates as templates
set title_template = seed.title_template,
    message_template = seed.message_template,
    email_subject = seed.email_subject,
    template_key = seed.event_type,
    updated_at = timezone('utc', now())
from template_seed as seed
where templates.tenant_id is null
  and templates.event_type = seed.event_type
  and templates.channel = seed.channel
  and templates.locale = seed.locale;

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
select
  null,
  seed.event_type,
  seed.event_type,
  seed.channel,
  seed.locale,
  seed.title_template,
  seed.message_template,
  seed.email_subject,
  case when seed.event_type in ('booking_reminder_1h', 'booking_deposit_pending', 'booking_rescheduled', 'booking_cancelled') then 'warning' else 'info' end,
  '{"allowExternal":true}'::jsonb,
  true,
  1
from template_seed as seed
where not exists (
  select 1
  from public.notification_templates as existing
  where existing.tenant_id is null
    and existing.event_type = seed.event_type
    and existing.channel = seed.channel
    and existing.locale = seed.locale
);
