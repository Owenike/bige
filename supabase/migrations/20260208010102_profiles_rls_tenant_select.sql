-- Allow tenant-scoped profile reads without RLS recursion.
-- We expose current user's tenant via a SECURITY DEFINER function owned by the migration role.

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.tenant_id
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

create or replace function public.current_is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(p.is_active, false)
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

alter table public.profiles enable row level security;

-- Replace the simplified policy from 20260208010101_fix_profiles_rls.sql
drop policy if exists profiles_self_or_tenant_access on public.profiles;

-- Read: self, platform admin, or any profile within the same tenant.
create policy profiles_select_self_or_tenant
  on public.profiles
  for select
  using (
    id = auth.uid()
    or public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id is not null
      and tenant_id = public.current_tenant_id()
    )
  );

-- Write: keep conservative (self or platform admin only).
create policy profiles_update_self_or_admin
  on public.profiles
  for update
  using (id = auth.uid() or public.is_platform_admin())
  with check (id = auth.uid() or public.is_platform_admin());

create policy profiles_insert_admin
  on public.profiles
  for insert
  with check (public.is_platform_admin());

create policy profiles_delete_admin
  on public.profiles
  for delete
  using (public.is_platform_admin());

