-- Phase 3 foundation: tenant/branch job settings sources with feature-flag-ready resolver input.
-- Scope: add settings tables only; do not modify /api/jobs/run execution chain.

create table if not exists public.tenant_job_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  job_type text not null check (job_type in ('notification_sweep', 'opportunity_sweep', 'delivery_dispatch', 'reminder_bundle')),
  enabled boolean not null default true,
  window_minutes integer not null default 30 check (window_minutes between 5 and 1440),
  max_batch_size integer not null default 500 check (max_batch_size between 1 and 5000),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tenant_job_settings_tenant_default_uidx
  on public.tenant_job_settings(tenant_id, job_type)
  where branch_id is null;

create unique index if not exists tenant_job_settings_branch_override_uidx
  on public.tenant_job_settings(tenant_id, branch_id, job_type)
  where branch_id is not null;

create index if not exists tenant_job_settings_lookup_idx
  on public.tenant_job_settings(tenant_id, branch_id, job_type, updated_at desc);

create table if not exists public.tenant_notification_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  job_type text not null check (job_type in ('notification_sweep', 'opportunity_sweep', 'delivery_dispatch', 'reminder_bundle')),
  is_enabled boolean not null default true,
  channels jsonb not null default '{"in_app":true,"email":false,"line":false,"sms":false,"webhook":false}'::jsonb,
  quiet_hours_start smallint check (quiet_hours_start between 0 and 23),
  quiet_hours_end smallint check (quiet_hours_end between 0 and 23),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tenant_notification_settings_tenant_default_uidx
  on public.tenant_notification_settings(tenant_id, job_type)
  where branch_id is null;

create unique index if not exists tenant_notification_settings_branch_override_uidx
  on public.tenant_notification_settings(tenant_id, branch_id, job_type)
  where branch_id is not null;

create index if not exists tenant_notification_settings_lookup_idx
  on public.tenant_notification_settings(tenant_id, branch_id, job_type, updated_at desc);

create table if not exists public.tenant_delivery_channel_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  channel text not null check (channel in ('email', 'line', 'sms', 'webhook')),
  is_enabled boolean not null default false,
  provider text,
  rate_limit_per_minute integer check (rate_limit_per_minute between 1 and 10000),
  timeout_ms integer check (timeout_ms between 100 and 600000),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tenant_delivery_channel_settings_tenant_default_uidx
  on public.tenant_delivery_channel_settings(tenant_id, channel)
  where branch_id is null;

create unique index if not exists tenant_delivery_channel_settings_branch_override_uidx
  on public.tenant_delivery_channel_settings(tenant_id, branch_id, channel)
  where branch_id is not null;

create index if not exists tenant_delivery_channel_settings_lookup_idx
  on public.tenant_delivery_channel_settings(tenant_id, branch_id, channel, updated_at desc);

alter table public.tenant_job_settings enable row level security;
alter table public.tenant_notification_settings enable row level security;
alter table public.tenant_delivery_channel_settings enable row level security;

drop policy if exists tenant_job_settings_access on public.tenant_job_settings;
create policy tenant_job_settings_access
  on public.tenant_job_settings
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = tenant_job_settings.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = tenant_job_settings.tenant_id
    )
  );

drop policy if exists tenant_notification_settings_access on public.tenant_notification_settings;
create policy tenant_notification_settings_access
  on public.tenant_notification_settings
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = tenant_notification_settings.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = tenant_notification_settings.tenant_id
    )
  );

drop policy if exists tenant_delivery_channel_settings_access on public.tenant_delivery_channel_settings;
create policy tenant_delivery_channel_settings_access
  on public.tenant_delivery_channel_settings
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = tenant_delivery_channel_settings.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = tenant_delivery_channel_settings.tenant_id
    )
  );
