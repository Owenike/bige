-- Phase 4-2 (rollup slice): daily rollup foundation for notification trends/overview.
-- Scope: summary tables + rebuild/incremental refresh function + minimal RLS.
-- No /api/jobs/run main-chain changes.

create table if not exists public.notification_delivery_daily_rollups (
  day date not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'line', 'sms', 'webhook', 'other')),
  total_count integer not null default 0 check (total_count >= 0),
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  pending_count integer not null default 0 check (pending_count >= 0),
  retrying_count integer not null default 0 check (retrying_count >= 0),
  dead_letter_count integer not null default 0 check (dead_letter_count >= 0),
  anomaly_count integer not null default 0 check (anomaly_count >= 0),
  opened_count integer not null default 0 check (opened_count >= 0),
  clicked_count integer not null default 0 check (clicked_count >= 0),
  conversion_count integer not null default 0 check (conversion_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (day, tenant_id, channel)
);

create index if not exists notification_delivery_daily_rollups_day_idx
  on public.notification_delivery_daily_rollups(day desc, channel);

create index if not exists notification_delivery_daily_rollups_tenant_day_idx
  on public.notification_delivery_daily_rollups(tenant_id, day desc);

create table if not exists public.notification_delivery_anomaly_daily_rollups (
  day date not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  channel text not null check (channel in ('in_app', 'email', 'line', 'sms', 'webhook', 'other')),
  anomaly_key text not null,
  anomaly_label text not null,
  sample_error text,
  anomaly_count integer not null default 0 check (anomaly_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (day, tenant_id, channel, anomaly_key)
);

create index if not exists notification_delivery_anomaly_rollups_day_idx
  on public.notification_delivery_anomaly_daily_rollups(day desc);

create index if not exists notification_delivery_anomaly_rollups_tenant_day_idx
  on public.notification_delivery_anomaly_daily_rollups(tenant_id, day desc);

create index if not exists notification_delivery_anomaly_rollups_key_idx
  on public.notification_delivery_anomaly_daily_rollups(anomaly_key, day desc);

alter table public.notification_delivery_daily_rollups enable row level security;
alter table public.notification_delivery_anomaly_daily_rollups enable row level security;

drop policy if exists notification_delivery_daily_rollups_access on public.notification_delivery_daily_rollups;
create policy notification_delivery_daily_rollups_access
  on public.notification_delivery_daily_rollups
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

drop policy if exists notification_delivery_anomaly_daily_rollups_access on public.notification_delivery_anomaly_daily_rollups;
create policy notification_delivery_anomaly_daily_rollups_access
  on public.notification_delivery_anomaly_daily_rollups
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

create or replace function public.rebuild_notification_daily_rollups(
  p_from_date date default null,
  p_to_date date default null,
  p_tenant_id uuid default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_from date := coalesce(p_from_date, current_date - 30);
  v_to date := coalesce(p_to_date, current_date);
  v_delivery_rows integer := 0;
  v_anomaly_rows integer := 0;
begin
  if v_to < v_from then
    raise exception 'Invalid date range: to (%) must be >= from (%)', v_to, v_from;
  end if;

  delete from public.notification_delivery_daily_rollups
  where day between v_from and v_to
    and (p_tenant_id is null or tenant_id = p_tenant_id);

  with delivery_rows as (
    select
      timezone('utc', coalesce(d.sent_at, d.failed_at, d.dead_letter_at, d.created_at))::date as day,
      d.tenant_id,
      d.channel,
      count(*)::integer as total_count,
      count(*) filter (where d.status = 'sent')::integer as sent_count,
      count(*) filter (where d.status in ('failed', 'dead_letter'))::integer as failed_count,
      count(*) filter (where d.status = 'pending')::integer as pending_count,
      count(*) filter (where d.status = 'retrying')::integer as retrying_count,
      count(*) filter (where d.status = 'dead_letter')::integer as dead_letter_count,
      count(*) filter (where d.status in ('failed', 'dead_letter', 'retrying'))::integer as anomaly_count
    from public.notification_deliveries d
    where timezone('utc', coalesce(d.sent_at, d.failed_at, d.dead_letter_at, d.created_at))::date between v_from and v_to
      and (p_tenant_id is null or d.tenant_id = p_tenant_id)
    group by 1, 2, 3
  ),
  event_rows as (
    select
      timezone('utc', e.event_at)::date as day,
      e.tenant_id,
      e.channel,
      count(*) filter (where e.event_type = 'opened')::integer as opened_count,
      count(*) filter (where e.event_type = 'clicked')::integer as clicked_count,
      count(*) filter (where e.event_type = 'conversion')::integer as conversion_count
    from public.notification_delivery_events e
    where e.event_type in ('opened', 'clicked', 'conversion')
      and timezone('utc', e.event_at)::date between v_from and v_to
      and (p_tenant_id is null or e.tenant_id = p_tenant_id)
    group by 1, 2, 3
  ),
  merged as (
    select
      coalesce(d.day, e.day) as day,
      coalesce(d.tenant_id, e.tenant_id) as tenant_id,
      coalesce(d.channel, e.channel) as channel,
      coalesce(d.total_count, 0) as total_count,
      coalesce(d.sent_count, 0) as sent_count,
      coalesce(d.failed_count, 0) as failed_count,
      coalesce(d.pending_count, 0) as pending_count,
      coalesce(d.retrying_count, 0) as retrying_count,
      coalesce(d.dead_letter_count, 0) as dead_letter_count,
      coalesce(d.anomaly_count, 0) as anomaly_count,
      coalesce(e.opened_count, 0) as opened_count,
      coalesce(e.clicked_count, 0) as clicked_count,
      coalesce(e.conversion_count, 0) as conversion_count
    from delivery_rows d
    full outer join event_rows e
      on d.day = e.day
      and d.tenant_id = e.tenant_id
      and d.channel = e.channel
  )
  insert into public.notification_delivery_daily_rollups (
    day,
    tenant_id,
    channel,
    total_count,
    sent_count,
    failed_count,
    pending_count,
    retrying_count,
    dead_letter_count,
    anomaly_count,
    opened_count,
    clicked_count,
    conversion_count,
    updated_at
  )
  select
    m.day,
    m.tenant_id,
    m.channel,
    m.total_count,
    m.sent_count,
    m.failed_count,
    m.pending_count,
    m.retrying_count,
    m.dead_letter_count,
    m.anomaly_count,
    m.opened_count,
    m.clicked_count,
    m.conversion_count,
    now()
  from merged m
  on conflict (day, tenant_id, channel)
  do update
    set total_count = excluded.total_count,
        sent_count = excluded.sent_count,
        failed_count = excluded.failed_count,
        pending_count = excluded.pending_count,
        retrying_count = excluded.retrying_count,
        dead_letter_count = excluded.dead_letter_count,
        anomaly_count = excluded.anomaly_count,
        opened_count = excluded.opened_count,
        clicked_count = excluded.clicked_count,
        conversion_count = excluded.conversion_count,
        updated_at = now();

  get diagnostics v_delivery_rows = row_count;

  delete from public.notification_delivery_anomaly_daily_rollups
  where day between v_from and v_to
    and (p_tenant_id is null or tenant_id = p_tenant_id);

  with anomaly_rows as (
    select
      timezone('utc', coalesce(d.dead_letter_at, d.failed_at, d.last_attempt_at, d.created_at))::date as day,
      d.tenant_id,
      d.channel,
      case
        when nullif(trim(coalesce(d.error_code, '')), '') is not null
          then 'CODE:' || trim(d.error_code)
        else 'MSG:' || coalesce(
          nullif(regexp_replace(lower(trim(coalesce(d.last_error, d.error_message, ''))), '\s+', ' ', 'g'), ''),
          'unknown_error'
        )
      end as anomaly_key,
      case
        when nullif(trim(coalesce(d.error_code, '')), '') is not null
          then trim(d.error_code)
        else coalesce(
          nullif(regexp_replace(lower(trim(coalesce(d.last_error, d.error_message, ''))), '\s+', ' ', 'g'), ''),
          'unknown_error'
        )
      end as anomaly_label,
      min(nullif(trim(coalesce(d.last_error, d.error_message, '')), '')) as sample_error,
      count(*)::integer as anomaly_count
    from public.notification_deliveries d
    where d.status in ('failed', 'dead_letter', 'retrying')
      and timezone('utc', coalesce(d.dead_letter_at, d.failed_at, d.last_attempt_at, d.created_at))::date between v_from and v_to
      and (p_tenant_id is null or d.tenant_id = p_tenant_id)
    group by 1, 2, 3, 4, 5
  )
  insert into public.notification_delivery_anomaly_daily_rollups (
    day,
    tenant_id,
    channel,
    anomaly_key,
    anomaly_label,
    sample_error,
    anomaly_count,
    updated_at
  )
  select
    a.day,
    a.tenant_id,
    a.channel,
    a.anomaly_key,
    a.anomaly_label,
    a.sample_error,
    a.anomaly_count,
    now()
  from anomaly_rows a
  on conflict (day, tenant_id, channel, anomaly_key)
  do update
    set anomaly_label = excluded.anomaly_label,
        sample_error = coalesce(excluded.sample_error, public.notification_delivery_anomaly_daily_rollups.sample_error),
        anomaly_count = excluded.anomaly_count,
        updated_at = now();

  get diagnostics v_anomaly_rows = row_count;

  return jsonb_build_object(
    'fromDate', v_from,
    'toDate', v_to,
    'tenantId', p_tenant_id,
    'deliveryRows', v_delivery_rows,
    'anomalyRows', v_anomaly_rows
  );
end;
$$;

create or replace function public.refresh_notification_daily_rollups_incremental(
  p_days integer default 3,
  p_tenant_id uuid default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_days integer := greatest(1, coalesce(p_days, 3));
begin
  return public.rebuild_notification_daily_rollups(current_date - v_days, current_date, p_tenant_id);
end;
$$;

revoke all on function public.rebuild_notification_daily_rollups(date, date, uuid) from public;
revoke all on function public.refresh_notification_daily_rollups_incremental(integer, uuid) from public;
grant execute on function public.rebuild_notification_daily_rollups(date, date, uuid) to service_role;
grant execute on function public.refresh_notification_daily_rollups_incremental(integer, uuid) to service_role;
