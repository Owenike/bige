-- Department ownership, staff hierarchy, and administrative assistance workflow.
alter table public.profiles
  add column if not exists department text,
  add column if not exists position text,
  add column if not exists organization_assigned_at timestamptz,
  add column if not exists organization_assigned_by uuid references auth.users(id) on delete set null;

alter table public.profiles
  drop constraint if exists profiles_department_check;
alter table public.profiles
  add constraint profiles_department_check
  check (department is null or department in ('general_affairs', 'coaching'));

alter table public.profiles
  drop constraint if exists profiles_position_check;
alter table public.profiles
  add constraint profiles_position_check
  check (
    position is null
    or position in (
      'frontdesk',
      'administrative_director',
      'general_affairs_assistant_manager',
      'general_affairs_manager',
      'coach',
      'coach_team_lead',
      'coach_director',
      'coach_assistant_manager',
      'coach_manager',
      'coach_city_manager'
    )
  );

alter table public.profiles
  drop constraint if exists profiles_department_position_match_check;
alter table public.profiles
  add constraint profiles_department_position_match_check
  check (
    (department is null and position is null)
    or (
      department = 'general_affairs'
      and position in (
        'frontdesk',
        'administrative_director',
        'general_affairs_assistant_manager',
        'general_affairs_manager'
      )
    )
    or (
      department = 'coaching'
      and position in (
        'coach',
        'coach_team_lead',
        'coach_director',
        'coach_assistant_manager',
        'coach_manager',
        'coach_city_manager'
      )
    )
  );

update public.profiles
set
  department = 'general_affairs',
  position = 'frontdesk',
  organization_assigned_at = coalesce(organization_assigned_at, now())
where role = 'frontdesk'
  and department is null
  and position is null;

update public.profiles
set
  department = 'coaching',
  position = 'coach',
  organization_assigned_at = coalesce(organization_assigned_at, now())
where role = 'coach'
  and department is null
  and position is null;

create index if not exists profiles_tenant_department_position_idx
  on public.profiles(tenant_id, department, position, is_active);
create index if not exists profiles_organization_assigned_by_idx
  on public.profiles(organization_assigned_by)
  where organization_assigned_by is not null;

create table if not exists public.administrative_assistance_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  title text not null,
  details text,
  status text not null default 'open',
  created_by uuid not null references auth.users(id) on delete restrict,
  completed_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint administrative_assistance_items_title_check
    check (char_length(btrim(title)) between 1 and 120),
  constraint administrative_assistance_items_status_check
    check (status in ('open', 'completed')),
  constraint administrative_assistance_items_completion_check
    check (
      (status = 'open' and completed_by is null and completed_at is null)
      or (status = 'completed' and completed_by is not null and completed_at is not null)
    )
);

create index if not exists administrative_assistance_items_queue_idx
  on public.administrative_assistance_items(tenant_id, branch_id, status, created_at desc);
create index if not exists administrative_assistance_items_branch_idx
  on public.administrative_assistance_items(branch_id)
  where branch_id is not null;
create index if not exists administrative_assistance_items_created_by_idx
  on public.administrative_assistance_items(created_by);
create index if not exists administrative_assistance_items_completed_by_idx
  on public.administrative_assistance_items(completed_by)
  where completed_by is not null;

alter table public.administrative_assistance_items enable row level security;

drop policy if exists administrative_assistance_items_read on public.administrative_assistance_items;
create policy administrative_assistance_items_read
  on public.administrative_assistance_items
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = administrative_assistance_items.tenant_id
        and (
          p.department = 'general_affairs'
          or administrative_assistance_items.created_by = auth.uid()
        )
        and (
          p.branch_id is null
          or administrative_assistance_items.branch_id is null
          or p.branch_id = administrative_assistance_items.branch_id
        )
    )
  );

drop policy if exists administrative_assistance_items_create on public.administrative_assistance_items;
create policy administrative_assistance_items_create
  on public.administrative_assistance_items
  for insert
  to authenticated
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = administrative_assistance_items.tenant_id
        and p.department = 'coaching'
        and p.position in ('coach_assistant_manager', 'coach_manager')
        and administrative_assistance_items.created_by = auth.uid()
        and (
          p.branch_id is null
          or administrative_assistance_items.branch_id is null
          or p.branch_id = administrative_assistance_items.branch_id
        )
    )
  );

drop policy if exists administrative_assistance_items_complete on public.administrative_assistance_items;
create policy administrative_assistance_items_complete
  on public.administrative_assistance_items
  for update
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = administrative_assistance_items.tenant_id
        and p.department = 'general_affairs'
        and (
          p.branch_id is null
          or administrative_assistance_items.branch_id is null
          or p.branch_id = administrative_assistance_items.branch_id
        )
    )
  )
  with check (
    administrative_assistance_items.status = 'completed'
    and administrative_assistance_items.completed_by = auth.uid()
    and administrative_assistance_items.completed_at is not null
    and (
      public.is_platform_admin()
      or exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.is_active = true
          and p.tenant_id = administrative_assistance_items.tenant_id
          and p.department = 'general_affairs'
          and (
            p.branch_id is null
            or administrative_assistance_items.branch_id is null
            or p.branch_id = administrative_assistance_items.branch_id
          )
      )
    )
  );

revoke all on table public.administrative_assistance_items from anon;
revoke all on table public.administrative_assistance_items from authenticated;
grant select, insert on table public.administrative_assistance_items to authenticated;
grant update (status, completed_by, completed_at, updated_at)
  on table public.administrative_assistance_items
  to authenticated;
grant all on table public.administrative_assistance_items to service_role;

alter table public.products
  add column if not exists owning_department text not null default 'general_affairs';
alter table public.products
  drop constraint if exists products_owning_department_check;
alter table public.products
  add constraint products_owning_department_check
  check (owning_department in ('general_affairs', 'coaching'));

alter table public.services
  add column if not exists owning_department text not null default 'coaching';
alter table public.services
  drop constraint if exists services_owning_department_check;
alter table public.services
  add constraint services_owning_department_check
  check (owning_department in ('general_affairs', 'coaching'));

alter table public.orders
  add column if not exists owning_department text;
alter table public.orders
  drop constraint if exists orders_owning_department_check;
alter table public.orders
  add constraint orders_owning_department_check
  check (owning_department is null or owning_department in ('general_affairs', 'coaching'));

alter table public.payments
  add column if not exists owning_department text;
alter table public.payments
  drop constraint if exists payments_owning_department_check;
alter table public.payments
  add constraint payments_owning_department_check
  check (owning_department is null or owning_department in ('general_affairs', 'coaching'));

alter table public.member_plan_contracts
  add column if not exists owning_department text not null default 'coaching';
alter table public.member_plan_contracts
  drop constraint if exists member_plan_contracts_owning_department_check;
alter table public.member_plan_contracts
  add constraint member_plan_contracts_owning_department_check
  check (owning_department = 'coaching');

alter table public.bige_contract_payments
  add column if not exists owning_department text not null default 'coaching';
alter table public.bige_contract_payments
  drop constraint if exists bige_contract_payments_owning_department_check;
alter table public.bige_contract_payments
  add constraint bige_contract_payments_owning_department_check
  check (owning_department = 'coaching');

alter table public.high_risk_action_requests
  add column if not exists owning_department text;
alter table public.high_risk_action_requests
  drop constraint if exists high_risk_action_requests_owning_department_check;
alter table public.high_risk_action_requests
  add constraint high_risk_action_requests_owning_department_check
  check (owning_department is null or owning_department in ('general_affairs', 'coaching'));

create index if not exists orders_tenant_department_created_idx
  on public.orders(tenant_id, owning_department, created_at desc);
create index if not exists payments_tenant_department_created_idx
  on public.payments(tenant_id, owning_department, created_at desc);
create index if not exists high_risk_requests_tenant_department_status_idx
  on public.high_risk_action_requests(tenant_id, owning_department, status, created_at desc);
