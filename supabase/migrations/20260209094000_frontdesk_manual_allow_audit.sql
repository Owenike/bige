-- Frontdesk manual allow support: checkins.method + audit_logs
-- Date: 2026-02-09

-- checkins: add method for distinguishing QR vs manual entries.
alter table public.checkins
  add column if not exists method text not null default 'qr';

do $$
begin
  -- Add a soft constraint if not already present; tolerate older schemas.
  if not exists (
    select 1
    from pg_constraint
    where conname = 'checkins_method_valid'
  ) then
    alter table public.checkins
      add constraint checkins_method_valid check (method in ('qr', 'manual'));
  end if;
exception
  when undefined_table then
    -- In case checkins isn't created in this environment yet.
    null;
end $$;

-- audit logs: create if missing (safe no-op if it already exists).
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  actor_id uuid not null,
  action text not null,
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_tenant_created_at_idx
  on public.audit_logs (tenant_id, created_at desc);

create index if not exists audit_logs_tenant_action_created_at_idx
  on public.audit_logs (tenant_id, action, created_at desc);

alter table public.audit_logs enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_logs'
      and policyname = 'audit_logs_service_role_all'
  ) then
    create policy audit_logs_service_role_all
      on public.audit_logs
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

