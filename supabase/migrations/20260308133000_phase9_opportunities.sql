-- Phase 9: Renewal / Repurchase / Reactivation opportunity management.

create table if not exists public.crm_opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  type text not null check (type in ('renewal_due', 'low_balance', 'expired_no_renewal', 'lost_member_reactivation', 'trial_not_converted', 'crm_reactivation')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'won', 'lost', 'snoozed', 'archived')),
  member_id uuid references public.members(id) on delete set null,
  lead_id uuid references public.crm_leads(id) on delete set null,
  source_ref_type text not null,
  source_ref_id text not null,
  owner_staff_id uuid references public.profiles(id) on delete set null,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  reason text not null,
  note text,
  due_at timestamptz,
  next_action_at timestamptz,
  snoozed_until timestamptz,
  won_at timestamptz,
  lost_at timestamptz,
  last_activity_at timestamptz not null default now(),
  dedupe_key text not null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((member_id is not null) or (lead_id is not null))
);

create unique index if not exists crm_opportunities_tenant_dedupe_idx
  on public.crm_opportunities(tenant_id, dedupe_key);

create index if not exists crm_opportunities_tenant_status_priority_idx
  on public.crm_opportunities(tenant_id, status, priority, due_at);

create index if not exists crm_opportunities_tenant_owner_status_idx
  on public.crm_opportunities(tenant_id, owner_staff_id, status, updated_at desc);

create index if not exists crm_opportunities_tenant_type_status_idx
  on public.crm_opportunities(tenant_id, type, status, updated_at desc);

create index if not exists crm_opportunities_tenant_branch_status_idx
  on public.crm_opportunities(tenant_id, branch_id, status, updated_at desc);

create table if not exists public.crm_opportunity_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,
  action text not null,
  note text,
  status_before text,
  status_after text,
  next_action_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists crm_opportunity_logs_tenant_opp_created_idx
  on public.crm_opportunity_logs(tenant_id, opportunity_id, created_at desc);

alter table public.crm_opportunities enable row level security;
alter table public.crm_opportunity_logs enable row level security;

drop policy if exists crm_opportunities_tenant_access on public.crm_opportunities;
create policy crm_opportunities_tenant_access
  on public.crm_opportunities
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = crm_opportunities.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = crm_opportunities.tenant_id
    )
  );

drop policy if exists crm_opportunity_logs_tenant_access on public.crm_opportunity_logs;
create policy crm_opportunity_logs_tenant_access
  on public.crm_opportunity_logs
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = crm_opportunity_logs.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = crm_opportunity_logs.tenant_id
    )
  );
