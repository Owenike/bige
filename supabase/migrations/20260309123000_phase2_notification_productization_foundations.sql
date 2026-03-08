-- Phase 2 foundations: notification preferences + template management (scaffolding).
-- This migration intentionally does not change existing dispatch/runtime behavior.

create table if not exists public.notification_role_preferences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role public.app_role not null,
  event_type text not null,
  channels jsonb not null default '{"in_app":true,"email":false,"line":false,"sms":false,"webhook":false}'::jsonb,
  is_enabled boolean not null default true,
  source text not null default 'custom' check (source in ('platform_default', 'tenant_default', 'custom')),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists notification_role_preferences_tenant_role_event_uidx
  on public.notification_role_preferences(tenant_id, role, event_type);

create index if not exists notification_role_preferences_tenant_updated_idx
  on public.notification_role_preferences(tenant_id, updated_at desc);

create table if not exists public.notification_user_preferences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  channels jsonb not null default '{"in_app":true,"email":false,"line":false,"sms":false,"webhook":false}'::jsonb,
  is_enabled boolean not null default true,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists notification_user_preferences_tenant_user_event_uidx
  on public.notification_user_preferences(tenant_id, user_id, event_type);

create index if not exists notification_user_preferences_tenant_updated_idx
  on public.notification_user_preferences(tenant_id, updated_at desc);

create table if not exists public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  event_type text not null,
  channel text not null check (channel in ('in_app', 'email', 'line', 'sms', 'webhook')),
  locale text not null default 'zh-TW',
  title_template text not null,
  message_template text not null,
  email_subject text,
  action_url text,
  priority text not null default 'info' check (priority in ('info', 'warning', 'critical')),
  channel_policy jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists notification_templates_lookup_idx
  on public.notification_templates(tenant_id, event_type, channel, locale, is_active, updated_at desc);

create unique index if not exists notification_templates_scope_event_channel_locale_version_uidx
  on public.notification_templates((coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)), event_type, channel, locale, version);

alter table public.notification_role_preferences enable row level security;
alter table public.notification_user_preferences enable row level security;
alter table public.notification_templates enable row level security;

drop policy if exists notification_role_preferences_tenant_access on public.notification_role_preferences;
create policy notification_role_preferences_tenant_access
  on public.notification_role_preferences
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = notification_role_preferences.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = notification_role_preferences.tenant_id
    )
  );

drop policy if exists notification_user_preferences_tenant_access on public.notification_user_preferences;
create policy notification_user_preferences_tenant_access
  on public.notification_user_preferences
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = notification_user_preferences.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = notification_user_preferences.tenant_id
    )
  );

drop policy if exists notification_templates_tenant_access on public.notification_templates;
create policy notification_templates_tenant_access
  on public.notification_templates
  for all
  using (
    public.is_platform_admin()
    or (
      notification_templates.tenant_id is not null
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.is_active = true
          and p.tenant_id = notification_templates.tenant_id
      )
    )
  )
  with check (
    public.is_platform_admin()
    or (
      notification_templates.tenant_id is not null
      and exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.is_active = true
          and p.tenant_id = notification_templates.tenant_id
      )
    )
  );

