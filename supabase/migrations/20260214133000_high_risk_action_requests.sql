-- High-risk action approval workflow (refund / order void)
-- Date: 2026-02-14

create table if not exists public.high_risk_action_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  requested_by uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('order_void', 'payment_refund')),
  target_type text not null check (target_type in ('order', 'payment')),
  target_id text not null,
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decision_note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists high_risk_action_requests_tenant_status_created_at_idx
  on public.high_risk_action_requests (tenant_id, status, created_at desc);

create unique index if not exists high_risk_action_requests_pending_unique_idx
  on public.high_risk_action_requests (tenant_id, action, target_id)
  where status = 'pending';

alter table public.high_risk_action_requests enable row level security;

drop policy if exists high_risk_action_requests_select_tenant on public.high_risk_action_requests;
create policy high_risk_action_requests_select_tenant
  on public.high_risk_action_requests
  for select
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = high_risk_action_requests.tenant_id
    )
  );

drop policy if exists high_risk_action_requests_insert_tenant on public.high_risk_action_requests;
create policy high_risk_action_requests_insert_tenant
  on public.high_risk_action_requests
  for insert
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = high_risk_action_requests.tenant_id
        and p.role in ('manager', 'frontdesk')
    )
  );

drop policy if exists high_risk_action_requests_update_manager on public.high_risk_action_requests;
create policy high_risk_action_requests_update_manager
  on public.high_risk_action_requests
  for update
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = high_risk_action_requests.tenant_id
        and p.role = 'manager'
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = high_risk_action_requests.tenant_id
        and p.role = 'manager'
    )
  );
