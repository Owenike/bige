-- Phase 3: manager staff provisioning + role expansion.
-- Date: 2026-03-05

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'app_role' and e.enumlabel = 'supervisor'
  ) then
    alter type public.app_role add value 'supervisor';
  end if;

  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'app_role' and e.enumlabel = 'branch_manager'
  ) then
    alter type public.app_role add value 'branch_manager';
  end if;

  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'app_role' and e.enumlabel = 'sales'
  ) then
    alter type public.app_role add value 'sales';
  end if;
end $$;

alter table public.profiles
  add column if not exists invited_by uuid references public.profiles(id) on delete set null,
  add column if not exists created_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists last_login_at timestamptz;

create index if not exists profiles_role_tenant_branch_idx
  on public.profiles(role, tenant_id, branch_id);
