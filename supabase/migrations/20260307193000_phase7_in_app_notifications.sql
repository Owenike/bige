-- Phase 7: in-app notification center + automation readiness.

create table if not exists public.in_app_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_role public.app_role not null,
  status text not null default 'unread' check (status in ('unread', 'read', 'archived')),
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  event_type text not null,
  title text not null,
  message text not null,
  target_type text,
  target_id text,
  action_url text,
  dedupe_key text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'read' or read_at is not null),
  check (status <> 'archived' or archived_at is not null)
);

create index if not exists in_app_notifications_recipient_created_idx
  on public.in_app_notifications(recipient_user_id, status, created_at desc);

create index if not exists in_app_notifications_tenant_event_created_idx
  on public.in_app_notifications(tenant_id, event_type, created_at desc);

create unique index if not exists in_app_notifications_recipient_dedupe_idx
  on public.in_app_notifications(recipient_user_id, dedupe_key)
  where dedupe_key is not null;

alter table public.in_app_notifications enable row level security;

drop policy if exists in_app_notifications_select_self_or_admin on public.in_app_notifications;
create policy in_app_notifications_select_self_or_admin
  on public.in_app_notifications
  for select
  using (
    public.is_platform_admin()
    or recipient_user_id = auth.uid()
  );

drop policy if exists in_app_notifications_update_self_or_admin on public.in_app_notifications;
create policy in_app_notifications_update_self_or_admin
  on public.in_app_notifications
  for update
  using (
    public.is_platform_admin()
    or recipient_user_id = auth.uid()
  )
  with check (
    public.is_platform_admin()
    or recipient_user_id = auth.uid()
  );

drop policy if exists in_app_notifications_insert_platform_admin on public.in_app_notifications;
create policy in_app_notifications_insert_platform_admin
  on public.in_app_notifications
  for insert
  with check (public.is_platform_admin());

