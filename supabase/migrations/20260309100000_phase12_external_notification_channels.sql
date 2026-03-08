-- Phase 12: external notification channel productization (minimal schema extension).

alter table public.notification_deliveries
  add column if not exists provider_message_id text,
  add column if not exists provider_response jsonb not null default '{}'::jsonb;

create index if not exists notification_deliveries_channel_status_idx
  on public.notification_deliveries(channel, status, created_at desc);
