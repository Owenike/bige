-- Notification productization admin audit trace foundation.
-- This table is intentionally isolated from runtime dispatch and notification_job_runs semantics.

create table if not exists public.notification_admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid references public.tenants(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_role public.app_role,
  scope text not null check (scope in ('platform', 'tenant')),
  action text not null check (action in ('preference_upsert', 'template_upsert', 'retry_dry_run', 'retry_execute')),
  target_type text not null,
  target_id text,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  diff jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists notification_admin_audit_logs_created_idx
  on public.notification_admin_audit_logs(created_at desc);

create index if not exists notification_admin_audit_logs_tenant_created_idx
  on public.notification_admin_audit_logs(tenant_id, created_at desc);

create index if not exists notification_admin_audit_logs_action_created_idx
  on public.notification_admin_audit_logs(action, created_at desc);

alter table public.notification_admin_audit_logs enable row level security;

drop policy if exists notification_admin_audit_logs_platform_select on public.notification_admin_audit_logs;
create policy notification_admin_audit_logs_platform_select
  on public.notification_admin_audit_logs
  for select
  using (public.is_platform_admin());

drop policy if exists notification_admin_audit_logs_tenant_select on public.notification_admin_audit_logs;
create policy notification_admin_audit_logs_tenant_select
  on public.notification_admin_audit_logs
  for select
  using (
    tenant_id is not null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = notification_admin_audit_logs.tenant_id
        and p.role in ('manager', 'supervisor', 'branch_manager')
    )
  );

drop policy if exists notification_admin_audit_logs_platform_insert on public.notification_admin_audit_logs;
create policy notification_admin_audit_logs_platform_insert
  on public.notification_admin_audit_logs
  for insert
  with check (public.is_platform_admin());

drop policy if exists notification_admin_audit_logs_tenant_insert on public.notification_admin_audit_logs;
create policy notification_admin_audit_logs_tenant_insert
  on public.notification_admin_audit_logs
  for insert
  with check (
    tenant_id is not null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = notification_admin_audit_logs.tenant_id
        and p.role in ('manager', 'supervisor', 'branch_manager')
    )
  );
