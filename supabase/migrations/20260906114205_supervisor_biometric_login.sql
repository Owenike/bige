alter table public.profiles
  add column if not exists supervisor_biometric_enforced_at timestamptz;

create table if not exists public.supervisor_biometric_devices (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0 check (counter >= 0),
  transports text[] not null default '{}'::text[],
  device_type text,
  backed_up boolean not null default false,
  push_endpoint text not null,
  push_p256dh text not null,
  push_auth text not null,
  user_agent text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_push_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text
);

create unique index if not exists supervisor_biometric_devices_one_active_per_profile_idx
  on public.supervisor_biometric_devices(profile_id)
  where revoked_at is null;

create unique index if not exists supervisor_biometric_devices_one_active_profile_per_push_idx
  on public.supervisor_biometric_devices(push_endpoint)
  where revoked_at is null;

create index if not exists supervisor_biometric_devices_active_lookup_idx
  on public.supervisor_biometric_devices(profile_id, created_at desc)
  where revoked_at is null;

create table if not exists public.supervisor_biometric_bindings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_via text not null default 'platform_admin'
    check (created_via in ('platform_admin', 'codex_recovery')),
  reason text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists supervisor_biometric_bindings_profile_active_idx
  on public.supervisor_biometric_bindings(profile_id, expires_at desc)
  where used_at is null and revoked_at is null;

create table if not exists public.supervisor_biometric_challenges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  binding_id uuid references public.supervisor_biometric_bindings(id) on delete cascade,
  login_request_id uuid,
  flow text not null check (flow in ('registration', 'authentication')),
  challenge text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists supervisor_biometric_challenges_active_idx
  on public.supervisor_biometric_challenges(expires_at)
  where used_at is null;

create table if not exists public.supervisor_biometric_login_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.supervisor_biometric_devices(id) on delete cascade,
  browser_secret_hash text not null unique,
  approval_secret_hash text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'consuming', 'consumed', 'expired', 'delivery_failed')),
  requested_ip text,
  requested_user_agent text,
  requested_platform text,
  expires_at timestamptz not null,
  approved_at timestamptz,
  denied_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.supervisor_biometric_challenges
  drop constraint if exists supervisor_biometric_challenges_login_request_id_fkey;
alter table public.supervisor_biometric_challenges
  add constraint supervisor_biometric_challenges_login_request_id_fkey
  foreign key (login_request_id)
  references public.supervisor_biometric_login_requests(id)
  on delete cascade;

create index if not exists supervisor_biometric_login_requests_profile_status_idx
  on public.supervisor_biometric_login_requests(profile_id, status, created_at desc);

create index if not exists supervisor_biometric_login_requests_expiry_idx
  on public.supervisor_biometric_login_requests(expires_at)
  where status in ('pending', 'approved', 'consuming');

create table if not exists public.supervisor_biometric_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  auth_session_id text not null unique,
  login_request_id uuid not null references public.supervisor_biometric_login_requests(id) on delete cascade,
  device_id uuid not null references public.supervisor_biometric_devices(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text
);

create index if not exists supervisor_biometric_sessions_active_idx
  on public.supervisor_biometric_sessions(profile_id, auth_session_id)
  where revoked_at is null;

alter table public.supervisor_biometric_devices enable row level security;
alter table public.supervisor_biometric_bindings enable row level security;
alter table public.supervisor_biometric_challenges enable row level security;
alter table public.supervisor_biometric_login_requests enable row level security;
alter table public.supervisor_biometric_sessions enable row level security;

revoke all on table public.supervisor_biometric_devices from public, anon, authenticated;
revoke all on table public.supervisor_biometric_bindings from public, anon, authenticated;
revoke all on table public.supervisor_biometric_challenges from public, anon, authenticated;
revoke all on table public.supervisor_biometric_login_requests from public, anon, authenticated;
revoke all on table public.supervisor_biometric_sessions from public, anon, authenticated;

grant all on table public.supervisor_biometric_devices to service_role;
grant all on table public.supervisor_biometric_bindings to service_role;
grant all on table public.supervisor_biometric_challenges to service_role;
grant all on table public.supervisor_biometric_login_requests to service_role;
grant all on table public.supervisor_biometric_sessions to service_role;

comment on column public.profiles.supervisor_biometric_enforced_at is
  'When set, completed supervisor accounts may only use sessions approved by a bound biometric device.';
comment on table public.supervisor_biometric_devices is
  'One active WebAuthn credential and Web Push subscription per supervisor. Biometric data never leaves the device.';
comment on table public.supervisor_biometric_bindings is
  'Short-lived one-time device enrollment links created by account 01 or the audited Codex recovery script.';
comment on table public.supervisor_biometric_login_requests is
  'Short-lived, browser-bound remote login approvals. Browser and phone secrets are stored only as hashes.';
comment on table public.supervisor_biometric_sessions is
  'Supabase auth sessions that were created after a successful supervisor biometric approval.';
