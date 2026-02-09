-- Entry check-in schema for short-lived QR + one-time jti.
-- Date: 2026-02-05
-- NOTE:
-- 1) This migration only creates entry-checkin objects and does NOT create member/master tables.
-- 2) API defaults assume existing tables:
--    - public.members(id, tenant_id, store_id, auth_user_id, full_name, photo_url, phone)
--    - public.member_entitlements(member_id, tenant_id, store_id, monthly_expires_at, remaining_sessions)

create extension if not exists pgcrypto;

create table if not exists public.qr_token_uses (
  jti text primary key,
  tenant_id uuid not null,
  store_id uuid not null,
  member_id uuid not null,
  used_at timestamptz not null default now()
);

create index if not exists qr_token_uses_tenant_store_member_idx
  on public.qr_token_uses (tenant_id, store_id, member_id, used_at desc);

create table if not exists public.checkins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  store_id uuid not null,
  member_id uuid not null,
  jti text not null,
  result text not null check (result in ('allow', 'deny')),
  reason text,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists checkins_tenant_store_member_time_idx
  on public.checkins (tenant_id, store_id, member_id, checked_at desc);

create index if not exists checkins_result_time_idx
  on public.checkins (tenant_id, store_id, result, checked_at desc);

create index if not exists checkins_jti_idx
  on public.checkins (jti);

alter table public.qr_token_uses enable row level security;
alter table public.checkins enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'checkins'
      and policyname = 'checkins_service_role_all'
  ) then
    create policy checkins_service_role_all
      on public.checkins
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'qr_token_uses'
      and policyname = 'qr_token_uses_service_role_all'
  ) then
    create policy qr_token_uses_service_role_all
      on public.qr_token_uses
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;
