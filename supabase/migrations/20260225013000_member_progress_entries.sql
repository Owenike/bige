-- Member progress records: InBody logs, goals, and training tasks
-- Date: 2026-02-25

create table if not exists public.member_progress_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  category text not null check (category in ('inbody', 'goal', 'task')),
  title text not null,
  note text,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  measured_at timestamptz,
  due_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists member_progress_entries_member_category_idx
  on public.member_progress_entries (tenant_id, member_id, category, created_at desc);

create index if not exists member_progress_entries_member_due_idx
  on public.member_progress_entries (tenant_id, member_id, due_at)
  where due_at is not null and status in ('active', 'completed');

alter table public.member_progress_entries enable row level security;

drop policy if exists member_progress_entries_tenant_access on public.member_progress_entries;
create policy member_progress_entries_tenant_access
  on public.member_progress_entries
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = member_progress_entries.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = member_progress_entries.tenant_id
    )
  );
