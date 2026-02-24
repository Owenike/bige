-- Member portal activation flow:
-- 1) Frontdesk creates member profile in public.members
-- 2) Member requests activation by phone
-- 3) Activation email is sent to member-bound email
-- 4) Member sets password and activates portal account

alter table public.members
  add column if not exists portal_status text not null default 'pending_activation'
    check (portal_status in ('pending_activation', 'active', 'disabled')),
  add column if not exists portal_activated_at timestamptz,
  add column if not exists portal_last_activation_sent_at timestamptz;

create index if not exists members_tenant_portal_status_idx
  on public.members(tenant_id, portal_status, updated_at desc);

create table if not exists public.member_activation_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  email text not null,
  phone text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  requested_ip text,
  requested_ua text,
  created_at timestamptz not null default now()
);

create unique index if not exists member_activation_tokens_hash_unique_idx
  on public.member_activation_tokens(token_hash);

create index if not exists member_activation_tokens_member_idx
  on public.member_activation_tokens(member_id, created_at desc);

create index if not exists member_activation_tokens_tenant_phone_idx
  on public.member_activation_tokens(tenant_id, phone, created_at desc);

alter table public.member_activation_tokens enable row level security;

drop policy if exists member_activation_tokens_service_role_all on public.member_activation_tokens;
create policy member_activation_tokens_service_role_all
  on public.member_activation_tokens
  for all
  to service_role
  using (true)
  with check (true);
