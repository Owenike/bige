alter table public.profiles
  add column if not exists staff_deleted_at timestamptz,
  add column if not exists staff_deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists staff_delete_reason text;

create index if not exists profiles_tenant_staff_deleted_idx
  on public.profiles(tenant_id, staff_deleted_at, created_at desc)
  where role in ('manager', 'supervisor', 'branch_manager', 'frontdesk', 'coach', 'sales');
