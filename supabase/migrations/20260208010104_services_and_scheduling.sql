-- Services (course templates) + coach scheduling slots.
-- Date: 2026-02-08

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  duration_minutes integer not null default 60 check (duration_minutes > 0),
  capacity integer not null default 1 check (capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists services_tenant_active_idx
  on public.services (tenant_id, is_active, created_at desc);

alter table public.services enable row level security;

drop policy if exists services_tenant_access on public.services;
create policy services_tenant_access
  on public.services
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

create table if not exists public.coach_slots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coach_slots_tenant_coach_time_idx
  on public.coach_slots (tenant_id, coach_id, starts_at);

alter table public.coach_slots enable row level security;

drop policy if exists coach_slots_tenant_access on public.coach_slots;
create policy coach_slots_tenant_access
  on public.coach_slots
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

-- Seed a default service per tenant.
insert into public.services (tenant_id, code, name, duration_minutes, capacity, is_active)
select t.id, 'personal_training', 'Personal Training', 60, 1, true
from public.tenants t
on conflict (tenant_id, code) do nothing;

