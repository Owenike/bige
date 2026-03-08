-- Phase 10: Scheduled jobs / outbound dispatch / delivery logging.

create table if not exists public.notification_job_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  job_type text not null check (job_type in ('notification_sweep', 'opportunity_sweep', 'delivery_dispatch', 'reminder_bundle')),
  trigger_mode text not null check (trigger_mode in ('scheduled', 'manual', 'api', 'inline')),
  status text not null default 'running' check (status in ('running', 'success', 'failed', 'partial')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  affected_count integer not null default 0,
  error_count integer not null default 0,
  error_summary text,
  payload jsonb not null default '{}'::jsonb,
  initiated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_job_runs_created_idx
  on public.notification_job_runs(created_at desc);

create index if not exists notification_job_runs_tenant_type_created_idx
  on public.notification_job_runs(tenant_id, job_type, created_at desc);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  notification_id uuid references public.in_app_notifications(id) on delete set null,
  opportunity_id uuid references public.crm_opportunities(id) on delete set null,
  source_ref_type text,
  source_ref_id text,
  recipient_user_id uuid references public.profiles(id) on delete set null,
  recipient_role public.app_role,
  channel text not null check (channel in ('in_app', 'email', 'line', 'sms', 'webhook', 'other')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped', 'retrying')),
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  error_code text,
  error_message text,
  dedupe_key text,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists notification_deliveries_dedupe_idx
  on public.notification_deliveries(channel, dedupe_key)
  where dedupe_key is not null;

create index if not exists notification_deliveries_status_retry_idx
  on public.notification_deliveries(status, next_retry_at, created_at desc);

create index if not exists notification_deliveries_tenant_status_idx
  on public.notification_deliveries(tenant_id, status, created_at desc);

create index if not exists notification_deliveries_notification_idx
  on public.notification_deliveries(notification_id);

alter table public.notification_job_runs enable row level security;
alter table public.notification_deliveries enable row level security;

drop policy if exists notification_job_runs_access on public.notification_job_runs;
create policy notification_job_runs_access
  on public.notification_job_runs
  for all
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id is not null
      and tenant_id = public.current_tenant_id()
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id is not null
      and tenant_id = public.current_tenant_id()
    )
  );

drop policy if exists notification_deliveries_access on public.notification_deliveries;
create policy notification_deliveries_access
  on public.notification_deliveries
  for all
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id is not null
      and tenant_id = public.current_tenant_id()
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id is not null
      and tenant_id = public.current_tenant_id()
    )
  );

