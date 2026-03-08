-- SaaS tenant subscription lifecycle for platform billing governance.
-- Date: 2026-03-05

create table if not exists public.saas_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id uuid references public.saas_plans(id) on delete set null,
  plan_code text not null,
  status text not null check (status in ('trial', 'active', 'grace', 'suspended', 'expired', 'canceled')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  grace_ends_at timestamptz,
  suspended_at timestamptz,
  canceled_at timestamptz,
  notes text,
  is_current boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (grace_ends_at is null or ends_at is null or grace_ends_at >= ends_at)
);

create unique index if not exists tenant_subscriptions_one_current_per_tenant
  on public.tenant_subscriptions(tenant_id)
  where is_current = true;

create index if not exists tenant_subscriptions_tenant_status_idx
  on public.tenant_subscriptions(tenant_id, status, ends_at desc);

create index if not exists tenant_subscriptions_plan_idx
  on public.tenant_subscriptions(plan_code, status);

insert into public.saas_plans (code, name, description, is_active)
values
  ('starter', 'Starter', 'Starter plan for single gym operations', true),
  ('growth', 'Growth', 'Growth plan for multi-branch operations', true),
  ('enterprise', 'Enterprise', 'Enterprise plan with platform governance features', true)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.tenant_subscriptions (
  tenant_id,
  plan_id,
  plan_code,
  status,
  starts_at,
  ends_at,
  grace_ends_at,
  notes,
  is_current,
  created_at,
  updated_at
)
select
  t.id as tenant_id,
  p.id as plan_id,
  p.code as plan_code,
  case
    when t.status = 'active' then 'active'
    when t.status = 'suspended' then 'suspended'
    else 'canceled'
  end as status,
  coalesce(t.created_at, now()) as starts_at,
  now() + interval '365 days' as ends_at,
  now() + interval '372 days' as grace_ends_at,
  'auto-backfilled for lifecycle enforcement' as notes,
  true as is_current,
  now() as created_at,
  now() as updated_at
from public.tenants t
join public.saas_plans p on p.code = 'starter'
where not exists (
  select 1
  from public.tenant_subscriptions ts
  where ts.tenant_id = t.id
    and ts.is_current = true
);

alter table public.saas_plans enable row level security;
alter table public.tenant_subscriptions enable row level security;

drop policy if exists saas_plans_platform_admin_access on public.saas_plans;
create policy saas_plans_platform_admin_access
  on public.saas_plans
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists tenant_subscriptions_select_scope on public.tenant_subscriptions;
create policy tenant_subscriptions_select_scope
  on public.tenant_subscriptions
  for select
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
    )
  );

drop policy if exists tenant_subscriptions_platform_admin_write on public.tenant_subscriptions;
create policy tenant_subscriptions_platform_admin_write
  on public.tenant_subscriptions
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
