-- Phase 4-1: delivery_dispatch status deepening + delivery outcome event model.
-- Scope: schema/model/query foundation only. No /api/jobs/run main-chain changes.

alter table public.notification_deliveries
  add column if not exists retry_count integer not null default 0,
  add column if not exists last_error text,
  add column if not exists delivered_at timestamptz,
  add column if not exists dead_letter_at timestamptz;

update public.notification_deliveries
set retry_count = greatest(coalesce(attempts, 0) - 1, 0)
where coalesce(attempts, 0) > 0
  and coalesce(retry_count, 0) = 0;

update public.notification_deliveries
set last_error = error_message
where last_error is null
  and error_message is not null;

alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_status_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_status_check
  check (status in ('pending', 'retrying', 'sent', 'failed', 'skipped', 'dead_letter'));

create index if not exists notification_deliveries_tenant_channel_status_idx
  on public.notification_deliveries(tenant_id, channel, status, created_at desc);

create index if not exists notification_deliveries_dead_letter_idx
  on public.notification_deliveries(tenant_id, dead_letter_at desc)
  where status = 'dead_letter';

create table if not exists public.notification_delivery_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  delivery_id uuid references public.notification_deliveries(id) on delete cascade,
  notification_id uuid references public.in_app_notifications(id) on delete set null,
  channel text not null check (channel in ('in_app', 'email', 'line', 'sms', 'webhook', 'other')),
  event_type text not null check (event_type in ('delivered', 'failed', 'opened', 'clicked', 'conversion')),
  event_at timestamptz not null default now(),
  provider text,
  provider_event_id text,
  provider_message_id text,
  status_before text check (status_before in ('pending', 'retrying', 'sent', 'failed', 'skipped', 'dead_letter')),
  status_after text check (status_after in ('pending', 'retrying', 'sent', 'failed', 'skipped', 'dead_letter')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists notification_delivery_events_tenant_event_at_idx
  on public.notification_delivery_events(tenant_id, event_at desc);

create index if not exists notification_delivery_events_event_type_idx
  on public.notification_delivery_events(event_type, event_at desc);

create index if not exists notification_delivery_events_delivery_idx
  on public.notification_delivery_events(delivery_id, event_at desc);

create index if not exists notification_delivery_events_channel_event_idx
  on public.notification_delivery_events(channel, event_type, event_at desc);

create index if not exists notification_delivery_events_notification_idx
  on public.notification_delivery_events(notification_id, event_at desc);

create unique index if not exists notification_delivery_events_provider_event_uidx
  on public.notification_delivery_events(provider, provider_event_id)
  where provider is not null and provider_event_id is not null;

alter table public.notification_delivery_events enable row level security;

drop policy if exists notification_delivery_events_access on public.notification_delivery_events;
create policy notification_delivery_events_access
  on public.notification_delivery_events
  for all
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
    )
  );
