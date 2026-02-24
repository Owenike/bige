-- Member progress event log: status / note changes history
-- Date: 2026-02-25

create table if not exists public.member_progress_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  entry_id uuid not null references public.member_progress_entries(id) on delete cascade,
  entry_category text not null check (entry_category in ('inbody', 'goal', 'task')),
  entry_title text not null,
  event_type text not null check (event_type in ('status_changed', 'note_changed', 'status_note_changed')),
  from_status text not null check (from_status in ('active', 'completed', 'archived')),
  to_status text not null check (to_status in ('active', 'completed', 'archived')),
  from_note text,
  to_note text,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text not null check (actor_role in ('platform_admin', 'manager', 'frontdesk', 'coach', 'member')),
  created_at timestamptz not null default now()
);

create index if not exists member_progress_events_member_created_idx
  on public.member_progress_events (tenant_id, member_id, created_at desc);

create index if not exists member_progress_events_entry_created_idx
  on public.member_progress_events (tenant_id, entry_id, created_at desc);

alter table public.member_progress_events enable row level security;

drop policy if exists member_progress_events_tenant_access on public.member_progress_events;
create policy member_progress_events_tenant_access
  on public.member_progress_events
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = member_progress_events.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = member_progress_events.tenant_id
    )
  );
