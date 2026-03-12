-- Phase 4-2: alert handling workflow (minimal actionable slice).
-- Scope: alert lifecycle for platform notification anomalies.

create table if not exists public.notification_alert_workflows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  anomaly_key text not null,
  anomaly_type text not null check (anomaly_type in ('tenant_priority', 'reason_cluster', 'delivery_error', 'manual')),
  priority text not null check (priority in ('P1', 'P2', 'P3', 'P4')),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'investigating', 'resolved', 'dismissed')),
  summary text not null,
  owner_user_id uuid references public.profiles(id) on delete set null,
  assignee_user_id uuid references public.profiles(id) on delete set null,
  note text,
  resolution_note text,
  source_data jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  dismissed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists notification_alert_workflows_active_key_uidx
  on public.notification_alert_workflows(tenant_id, anomaly_key)
  where status in ('open', 'acknowledged', 'investigating');

create index if not exists notification_alert_workflows_status_priority_idx
  on public.notification_alert_workflows(status, priority, updated_at desc);

create index if not exists notification_alert_workflows_tenant_status_idx
  on public.notification_alert_workflows(tenant_id, status, updated_at desc);

alter table public.notification_alert_workflows enable row level security;

drop policy if exists notification_alert_workflows_access on public.notification_alert_workflows;
create policy notification_alert_workflows_access
  on public.notification_alert_workflows
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
