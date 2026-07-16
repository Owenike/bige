alter table public.trial_bookings
  add column if not exists appointment_date date,
  add column if not exists appointment_time text,
  add column if not exists booking_coach text,
  add column if not exists executing_coach text,
  add column if not exists line_notification_status text not null default 'not_sent',
  add column if not exists line_notified_at timestamptz,
  add column if not exists line_notification_error text;

update public.trial_bookings
set source = 'website'
where source is null
   or source = ''
   or source = 'website_trial_booking'
   or source not in ('website', 'official_line', 'walk_in');

alter table public.trial_bookings
  drop constraint if exists trial_bookings_booking_status_check;

alter table public.trial_bookings
  add constraint trial_bookings_booking_status_check
  check (booking_status in ('new', 'contacted', 'scheduled', 'completed', 'cancelled', 'no_show'));

alter table public.trial_bookings
  drop constraint if exists trial_bookings_source_check;

alter table public.trial_bookings
  add constraint trial_bookings_source_check
  check (source in ('website', 'official_line', 'walk_in'));

alter table public.trial_bookings
  drop constraint if exists trial_bookings_line_notification_status_check;

alter table public.trial_bookings
  add constraint trial_bookings_line_notification_status_check
  check (line_notification_status in ('not_sent', 'sent', 'failed'));

alter table public.trial_bookings
  drop constraint if exists trial_bookings_appointment_time_check;

alter table public.trial_bookings
  add constraint trial_bookings_appointment_time_check
  check (appointment_time is null or appointment_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

create index if not exists trial_bookings_appointment_date_idx
  on public.trial_bookings (appointment_date);

create index if not exists trial_bookings_source_idx
  on public.trial_bookings (source);

create index if not exists trial_bookings_appointment_source_status_idx
  on public.trial_bookings (appointment_date, source, booking_status);

comment on column public.trial_bookings.appointment_date is '體驗預約實際日期';
comment on column public.trial_bookings.appointment_time is '體驗預約實際時間，HH:mm';
comment on column public.trial_bookings.booking_coach is '負責聯絡並登記預約的人';
comment on column public.trial_bookings.executing_coach is '實際執行體驗課的人';
comment on column public.trial_bookings.line_notification_status is '已安排體驗預約 LINE 通知狀態';
comment on column public.trial_bookings.line_notified_at is '已安排體驗預約 LINE 通知成功時間';
comment on column public.trial_bookings.line_notification_error is '已安排體驗預約 LINE 通知錯誤摘要，不含敏感 token';
