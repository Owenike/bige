-- Member notification read-state and device session tracking
-- Date: 2026-02-24

create table if not exists public.member_notification_reads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  notification_id text not null,
  read_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, member_id, notification_id)
);

create index if not exists member_notification_reads_member_idx
  on public.member_notification_reads (tenant_id, member_id, read_at desc);

create table if not exists public.member_device_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  user_agent text,
  ip_address text,
  platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists member_device_sessions_member_idx
  on public.member_device_sessions (tenant_id, member_id, last_seen_at desc);

create index if not exists member_device_sessions_user_idx
  on public.member_device_sessions (auth_user_id, last_seen_at desc);

alter table public.member_notification_reads enable row level security;
alter table public.member_device_sessions enable row level security;

drop policy if exists member_notification_reads_tenant_access on public.member_notification_reads;
create policy member_notification_reads_tenant_access
  on public.member_notification_reads
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = member_notification_reads.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = member_notification_reads.tenant_id
    )
  );

drop policy if exists member_device_sessions_tenant_access on public.member_device_sessions;
create policy member_device_sessions_tenant_access
  on public.member_device_sessions
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = member_device_sessions.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = member_device_sessions.tenant_id
    )
  );
