create table if not exists public.frontdesk_product_inventory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  product_code text not null,
  on_hand integer not null default 0,
  safety_stock integer not null default 5,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, product_code)
);

create index if not exists frontdesk_product_inventory_tenant_branch_idx
  on public.frontdesk_product_inventory(tenant_id, branch_id, product_code);

create table if not exists public.frontdesk_product_inventory_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  product_code text not null,
  delta integer not null check (delta <> 0),
  reason text not null check (reason in ('adjustment', 'restock', 'sale')),
  note text,
  order_id uuid references public.orders(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists frontdesk_product_inventory_moves_tenant_branch_idx
  on public.frontdesk_product_inventory_moves(tenant_id, branch_id, created_at desc);

alter table public.frontdesk_product_inventory enable row level security;
alter table public.frontdesk_product_inventory_moves enable row level security;

drop policy if exists frontdesk_product_inventory_tenant_access on public.frontdesk_product_inventory;
create policy frontdesk_product_inventory_tenant_access
  on public.frontdesk_product_inventory
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = frontdesk_product_inventory.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = frontdesk_product_inventory.tenant_id
    )
  );

drop policy if exists frontdesk_product_inventory_moves_tenant_access on public.frontdesk_product_inventory_moves;
create policy frontdesk_product_inventory_moves_tenant_access
  on public.frontdesk_product_inventory_moves
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = frontdesk_product_inventory_moves.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = frontdesk_product_inventory_moves.tenant_id
    )
  );
