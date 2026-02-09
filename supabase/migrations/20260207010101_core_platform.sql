-- Core multi-tenant model for SaaS gym operations.
-- Date: 2026-02-07
-- Scope: tenants, people, membership, booking, commerce, audit, shifts, flags.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum (
      'platform_admin',
      'manager',
      'frontdesk',
      'coach',
      'member'
    );
  end if;
end $$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  code text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists branches_tenant_idx on public.branches(tenant_id);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  role public.app_role not null,
  display_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_tenant_role_idx on public.profiles(tenant_id, role);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  store_id uuid references public.branches(id) on delete set null,
  auth_user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  phone text,
  photo_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists members_tenant_store_idx on public.members(tenant_id, store_id);
create index if not exists members_auth_user_idx on public.members(auth_user_id);

create table if not exists public.member_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  type text not null check (type in ('email', 'phone', 'line_user_id')),
  value text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, type, value)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  valid_from timestamptz not null,
  valid_to timestamptz not null,
  status text not null check (status in ('active', 'paused', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_member_period_idx
  on public.subscriptions(tenant_id, member_id, status, valid_to desc);

create table if not exists public.entry_passes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  pass_type text not null check (pass_type in ('single', 'punch')),
  remaining integer not null default 0,
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entry_passes_member_idx
  on public.entry_passes(tenant_id, member_id, status, expires_at);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  member_id uuid not null references public.members(id) on delete cascade,
  coach_id uuid references public.profiles(id) on delete set null,
  service_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'booked' check (status in ('booked', 'checked_in', 'completed', 'cancelled', 'no_show')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bookings_tenant_time_idx on public.bookings(tenant_id, starts_at);

create table if not exists public.session_redemptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null,
  member_id uuid not null references public.members(id) on delete cascade,
  redeemed_by uuid references public.profiles(id) on delete set null,
  redeemed_kind text not null check (redeemed_kind in ('monthly', 'pass')),
  pass_id uuid references public.entry_passes(id) on delete set null,
  quantity integer not null default 1 check (quantity > 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists session_redemptions_tenant_member_idx
  on public.session_redemptions(tenant_id, member_id, created_at desc);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  member_id uuid references public.members(id) on delete set null,
  amount numeric(12, 2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'paid', 'cancelled', 'refunded')),
  channel text not null check (channel in ('frontdesk', 'online')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  item_type text not null check (item_type in ('subscription', 'entry_pass', 'product', 'adjustment')),
  item_ref_id uuid,
  title text not null,
  quantity integer not null default 1,
  unit_price numeric(12, 2) not null default 0,
  line_total numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items(order_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  amount numeric(12, 2) not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'voided', 'refunded')),
  method text not null check (method in ('cash', 'card', 'transfer', 'newebpay', 'manual')),
  gateway_ref text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_order_status_idx on public.payments(order_id, status);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_tenant_time_idx on public.audit_logs(tenant_id, created_at desc);

create table if not exists public.frontdesk_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  opened_by uuid references public.profiles(id) on delete set null,
  closed_by uuid references public.profiles(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  cash_total numeric(12, 2) not null default 0,
  card_total numeric(12, 2) not null default 0,
  transfer_total numeric(12, 2) not null default 0,
  note text,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.frontdesk_shift_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  shift_id uuid not null references public.frontdesk_shifts(id) on delete cascade,
  kind text not null check (kind in ('payment', 'refund', 'adjustment', 'note')),
  ref_id text,
  amount numeric(12, 2),
  summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, key)
);

-- Align checkin one-time usage with unique jti strategy.
alter table public.checkins
  add column if not exists method text not null default 'qr' check (method in ('qr', 'nfc', 'manual'));

create unique index if not exists checkins_jti_unique on public.checkins(jti);

-- RLS helpers.
create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p.*
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'platform_admin'
      and p.is_active = true
  );
$$;

alter table public.tenants enable row level security;
alter table public.branches enable row level security;
alter table public.profiles enable row level security;
alter table public.members enable row level security;
alter table public.member_identities enable row level security;
alter table public.subscriptions enable row level security;
alter table public.entry_passes enable row level security;
alter table public.bookings enable row level security;
alter table public.session_redemptions enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.audit_logs enable row level security;
alter table public.frontdesk_shifts enable row level security;
alter table public.frontdesk_shift_items enable row level security;
alter table public.feature_flags enable row level security;

do $$
declare
  table_name text;
  tenant_tables text[] := array[
    'branches',
    'members',
    'member_identities',
    'subscriptions',
    'entry_passes',
    'bookings',
    'session_redemptions',
    'orders',
    'order_items',
    'payments',
    'audit_logs',
    'frontdesk_shifts',
    'frontdesk_shift_items',
    'feature_flags'
  ];
begin
  foreach table_name in array tenant_tables loop
    execute format(
      'drop policy if exists %I on public.%I',
      table_name || '_tenant_access',
      table_name
    );
    execute format(
      'create policy %I on public.%I for all using (
         public.is_platform_admin()
         or exists (
           select 1
           from public.profiles p
           where p.id = auth.uid()
             and p.is_active = true
             and p.tenant_id = %I.tenant_id
         )
       ) with check (
         public.is_platform_admin()
         or exists (
           select 1
           from public.profiles p
           where p.id = auth.uid()
             and p.is_active = true
             and p.tenant_id = %I.tenant_id
         )
       )',
      table_name || '_tenant_access',
      table_name,
      table_name,
      table_name
    );
  end loop;
end $$;

drop policy if exists tenants_platform_admin_access on public.tenants;
create policy tenants_platform_admin_access
  on public.tenants
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists profiles_self_or_tenant_access on public.profiles;
create policy profiles_self_or_tenant_access
  on public.profiles
  for all
  using (
    id = auth.uid()
    or public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = profiles.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = profiles.tenant_id
    )
  );
