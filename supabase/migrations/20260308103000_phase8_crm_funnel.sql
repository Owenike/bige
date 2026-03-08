-- Phase 8: CRM lead funnel + follow-up lifecycle (minimal commercial-ready baseline).

create table if not exists public.crm_leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  owner_staff_id uuid references public.profiles(id) on delete set null,
  name text not null,
  phone text,
  email text,
  gender text check (gender in ('male', 'female', 'other', 'unknown')),
  note text,
  source text not null default 'walk-in' check (source in ('walk-in', 'referral', 'ad', 'instagram', 'line', 'google', 'other')),
  status text not null default 'new' check (status in ('new', 'contacted', 'trial_booked', 'trial_completed', 'won', 'lost', 'dormant')),
  temperature text not null default 'warm' check (temperature in ('hot', 'warm', 'cold')),
  trial_at timestamptz,
  trial_status text check (trial_status in ('scheduled', 'attended', 'no_show', 'canceled', 'rescheduled')),
  trial_result text check (trial_result in ('interested', 'follow_up_needed', 'won', 'lost')),
  trial_booking_id uuid references public.bookings(id) on delete set null,
  next_action_at timestamptz,
  last_followed_up_at timestamptz,
  won_member_id uuid references public.members(id) on delete set null,
  won_order_id uuid references public.orders(id) on delete set null,
  won_plan_code text,
  lost_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_leads_tenant_status_updated_idx
  on public.crm_leads(tenant_id, status, updated_at desc);

create index if not exists crm_leads_tenant_owner_status_idx
  on public.crm_leads(tenant_id, owner_staff_id, status, updated_at desc);

create index if not exists crm_leads_tenant_branch_status_idx
  on public.crm_leads(tenant_id, branch_id, status, updated_at desc);

create index if not exists crm_leads_tenant_source_idx
  on public.crm_leads(tenant_id, source, created_at desc);

create table if not exists public.crm_lead_followups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  follow_up_type text not null check (follow_up_type in ('call', 'message', 'visit', 'consult', 'trial', 'other')),
  note text not null,
  next_action_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists crm_lead_followups_tenant_lead_created_idx
  on public.crm_lead_followups(tenant_id, lead_id, created_at desc);

create index if not exists crm_lead_followups_tenant_type_created_idx
  on public.crm_lead_followups(tenant_id, follow_up_type, created_at desc);

alter table public.crm_leads enable row level security;
alter table public.crm_lead_followups enable row level security;

drop policy if exists crm_leads_tenant_access on public.crm_leads;
create policy crm_leads_tenant_access
  on public.crm_leads
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = crm_leads.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = crm_leads.tenant_id
    )
  );

drop policy if exists crm_lead_followups_tenant_access on public.crm_lead_followups;
create policy crm_lead_followups_tenant_access
  on public.crm_lead_followups
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = crm_lead_followups.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = crm_lead_followups.tenant_id
    )
  );
