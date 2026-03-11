-- Phase 2-1: job rerun lock foundation (dry-run first, execute-safe preparation).

create table if not exists public.notification_job_execution_locks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  job_type text not null check (job_type in ('notification_sweep', 'opportunity_sweep', 'delivery_dispatch', 'reminder_bundle')),
  trigger_source text not null check (trigger_source in ('scheduled', 'manual', 'api', 'inline', 'rerun_execute')),
  window_start_at timestamptz not null,
  window_end_at timestamptz not null,
  scope_key text not null,
  lock_status text not null default 'locked' check (lock_status in ('locked', 'released', 'expired')),
  acquired_by uuid references public.profiles(id) on delete set null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  release_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists notification_job_execution_locks_scope_active_uidx
  on public.notification_job_execution_locks(scope_key)
  where lock_status = 'locked' and released_at is null;

create index if not exists notification_job_execution_locks_tenant_job_idx
  on public.notification_job_execution_locks(tenant_id, job_type, acquired_at desc);

create index if not exists notification_job_execution_locks_expires_idx
  on public.notification_job_execution_locks(lock_status, expires_at);

alter table public.notification_job_execution_locks enable row level security;

drop policy if exists notification_job_execution_locks_access on public.notification_job_execution_locks;
create policy notification_job_execution_locks_access
  on public.notification_job_execution_locks
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

