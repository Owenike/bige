-- Tenant-scoped products/pricing catalog (configurable purchase buttons).
-- Date: 2026-02-08

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  title text not null,
  item_type text not null check (item_type in ('subscription', 'entry_pass', 'product')),
  unit_price numeric(12, 2) not null default 0,
  quantity integer not null default 1 check (quantity > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists products_tenant_active_idx
  on public.products (tenant_id, is_active, sort_order, created_at desc);

alter table public.products enable row level security;

drop policy if exists products_tenant_access on public.products;
create policy products_tenant_access
  on public.products
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

-- Seed defaults per tenant (safe to rerun thanks to ON CONFLICT).
insert into public.products (
  tenant_id,
  code,
  title,
  item_type,
  unit_price,
  quantity,
  is_active,
  sort_order
)
select
  t.id,
  v.code,
  v.title,
  v.item_type,
  v.unit_price,
  v.quantity,
  true,
  v.sort_order
from public.tenants t
cross join (
  values
    ('single_pass', '單次票', 'entry_pass', 300::numeric, 1, 10),
    ('punch_10', '10 次票', 'entry_pass', 2500::numeric, 1, 20),
    ('monthly_30d', '30 天月費', 'subscription', 1800::numeric, 1, 30)
) as v(code, title, item_type, unit_price, quantity, sort_order)
on conflict (tenant_id, code) do nothing;

