-- Phase 4: Member plan catalog / contract / pass lifecycle.
-- Date: 2026-03-06

create table if not exists public.member_plan_catalog (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  plan_type text not null check (plan_type in ('subscription', 'entry_pass', 'coach_pack', 'trial')),
  fulfillment_kind text not null default 'none' check (fulfillment_kind in ('subscription', 'entry_pass', 'none')),
  default_duration_days integer check (default_duration_days is null or default_duration_days > 0),
  default_quantity integer check (default_quantity is null or default_quantity >= 0),
  allow_auto_renew boolean not null default false,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists member_plan_catalog_tenant_active_idx
  on public.member_plan_catalog(tenant_id, is_active, plan_type, updated_at desc);

create table if not exists public.member_plan_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  member_id uuid not null references public.members(id) on delete cascade,
  plan_catalog_id uuid references public.member_plan_catalog(id) on delete set null,
  source_order_id uuid references public.orders(id) on delete set null,
  source_payment_id uuid references public.payments(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'active', 'frozen', 'expired', 'canceled', 'exhausted')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  remaining_uses integer check (remaining_uses is null or remaining_uses >= 0),
  remaining_sessions integer check (remaining_sessions is null or remaining_sessions >= 0),
  auto_renew boolean not null default false,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists member_plan_contracts_tenant_member_idx
  on public.member_plan_contracts(tenant_id, member_id, status, ends_at);

create index if not exists member_plan_contracts_source_order_idx
  on public.member_plan_contracts(tenant_id, source_order_id);

create table if not exists public.member_plan_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  member_id uuid not null references public.members(id) on delete cascade,
  contract_id uuid references public.member_plan_contracts(id) on delete set null,
  source_type text not null check (source_type in ('grant', 'redeem', 'adjustment', 'refund_reversal', 'expire', 'manual')),
  delta_uses integer not null default 0,
  delta_sessions integer not null default 0,
  balance_uses integer,
  balance_sessions integer,
  reference_type text,
  reference_id text,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists member_plan_ledger_tenant_member_idx
  on public.member_plan_ledger(tenant_id, member_id, created_at desc);

alter table public.subscriptions
  add column if not exists member_plan_contract_id uuid references public.member_plan_contracts(id) on delete set null,
  add column if not exists plan_catalog_id uuid references public.member_plan_catalog(id) on delete set null,
  add column if not exists source_order_id uuid references public.orders(id) on delete set null,
  add column if not exists source_payment_id uuid references public.payments(id) on delete set null,
  add column if not exists auto_renew boolean not null default false;

alter table public.entry_passes
  add column if not exists member_plan_contract_id uuid references public.member_plan_contracts(id) on delete set null,
  add column if not exists plan_catalog_id uuid references public.member_plan_catalog(id) on delete set null,
  add column if not exists source_order_id uuid references public.orders(id) on delete set null,
  add column if not exists source_payment_id uuid references public.payments(id) on delete set null,
  add column if not exists total_sessions integer;

alter table public.session_redemptions
  add column if not exists member_plan_contract_id uuid references public.member_plan_contracts(id) on delete set null;

create index if not exists subscriptions_contract_idx
  on public.subscriptions(tenant_id, member_plan_contract_id);

create index if not exists entry_passes_contract_idx
  on public.entry_passes(tenant_id, member_plan_contract_id);

alter table public.member_plan_catalog enable row level security;
alter table public.member_plan_contracts enable row level security;
alter table public.member_plan_ledger enable row level security;

drop policy if exists member_plan_catalog_tenant_access on public.member_plan_catalog;
create policy member_plan_catalog_tenant_access
  on public.member_plan_catalog
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

drop policy if exists member_plan_contracts_tenant_access on public.member_plan_contracts;
create policy member_plan_contracts_tenant_access
  on public.member_plan_contracts
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

drop policy if exists member_plan_ledger_tenant_access on public.member_plan_ledger;
create policy member_plan_ledger_tenant_access
  on public.member_plan_ledger
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

insert into public.member_plan_catalog (
  tenant_id,
  code,
  name,
  description,
  plan_type,
  fulfillment_kind,
  default_duration_days,
  default_quantity,
  allow_auto_renew,
  is_active
)
select
  p.tenant_id,
  p.code,
  p.title,
  null,
  case
    when p.item_type = 'subscription' then 'subscription'
    when p.item_type = 'entry_pass' then 'entry_pass'
    else 'trial'
  end as plan_type,
  case
    when p.item_type = 'subscription' then 'subscription'
    when p.item_type = 'entry_pass' then 'entry_pass'
    else 'none'
  end as fulfillment_kind,
  case
    when p.item_type = 'subscription' then 30
    when p.code = 'punch_10' then 180
    else 30
  end as default_duration_days,
  case
    when p.item_type = 'subscription' then null
    when p.code = 'punch_10' then 10
    when p.code = 'single_pass' then 1
    else p.quantity
  end as default_quantity,
  false,
  p.is_active
from public.products p
where not exists (
  select 1
  from public.member_plan_catalog c
  where c.tenant_id = p.tenant_id
    and c.code = p.code
);

