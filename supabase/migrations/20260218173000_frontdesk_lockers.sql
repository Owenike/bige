create table if not exists public.frontdesk_locker_rentals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  locker_code text not null,
  member_id uuid references public.members(id) on delete set null,
  renter_name text,
  phone text,
  deposit_amount numeric(12, 2) not null default 0,
  note text,
  status text not null default 'active' check (status in ('active', 'returned', 'cancelled')),
  rented_at timestamptz not null default now(),
  due_at timestamptz,
  returned_at timestamptz,
  rented_by uuid references public.profiles(id) on delete set null,
  returned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists frontdesk_locker_rentals_tenant_branch_idx
  on public.frontdesk_locker_rentals(tenant_id, branch_id, status, rented_at desc);

create index if not exists frontdesk_locker_rentals_member_idx
  on public.frontdesk_locker_rentals(tenant_id, member_id, rented_at desc);

create unique index if not exists frontdesk_locker_rentals_active_unique
  on public.frontdesk_locker_rentals(tenant_id, branch_id, locker_code)
  where status = 'active';

alter table public.frontdesk_locker_rentals enable row level security;

drop policy if exists frontdesk_locker_rentals_tenant_access on public.frontdesk_locker_rentals;
create policy frontdesk_locker_rentals_tenant_access
  on public.frontdesk_locker_rentals
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = frontdesk_locker_rentals.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = frontdesk_locker_rentals.tenant_id
    )
  );
