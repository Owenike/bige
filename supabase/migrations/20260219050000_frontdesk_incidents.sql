create table if not exists public.frontdesk_incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  incident_no text not null,
  incident_type text not null check (incident_type in ('complaint', 'facility', 'safety', 'billing', 'member', 'other')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  source text not null default 'frontdesk' check (source in ('frontdesk', 'phone', 'line', 'email', 'walkin', 'other')),
  member_id uuid references public.members(id) on delete set null,
  member_code text,
  member_name text,
  contact_phone text,
  title text not null,
  detail text not null,
  happened_at timestamptz,
  due_at timestamptz,
  assigned_to uuid references public.profiles(id) on delete set null,
  resolution_note text,
  resolved_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, incident_no)
);

create index if not exists frontdesk_incidents_tenant_branch_status_idx
  on public.frontdesk_incidents(tenant_id, branch_id, status, updated_at desc);

create index if not exists frontdesk_incidents_tenant_due_idx
  on public.frontdesk_incidents(tenant_id, branch_id, due_at)
  where due_at is not null and status in ('open', 'in_progress');

create table if not exists public.frontdesk_incident_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  incident_id uuid not null references public.frontdesk_incidents(id) on delete cascade,
  action text not null check (action in ('created', 'status_changed', 'followup', 'resolved', 'reopened', 'assigned')),
  note text,
  payload jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists frontdesk_incident_logs_tenant_incident_idx
  on public.frontdesk_incident_logs(tenant_id, incident_id, created_at desc);

alter table public.frontdesk_incidents enable row level security;
alter table public.frontdesk_incident_logs enable row level security;

drop policy if exists frontdesk_incidents_tenant_access on public.frontdesk_incidents;
create policy frontdesk_incidents_tenant_access
  on public.frontdesk_incidents
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = frontdesk_incidents.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = frontdesk_incidents.tenant_id
    )
  );

drop policy if exists frontdesk_incident_logs_tenant_access on public.frontdesk_incident_logs;
create policy frontdesk_incident_logs_tenant_access
  on public.frontdesk_incident_logs
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = frontdesk_incident_logs.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = frontdesk_incident_logs.tenant_id
    )
  );
