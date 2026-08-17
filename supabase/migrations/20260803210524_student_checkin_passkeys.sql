alter table public.student_checkin_requests
  drop constraint if exists student_checkin_requests_auth_method_check;
alter table public.student_checkin_requests
  add constraint student_checkin_requests_auth_method_check
  check (auth_method in ('line', 'phone', 'passkey'));

create table if not exists public.student_checkin_passkeys (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.student_line_profiles(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  counter bigint not null default 0 check (counter >= 0),
  transports text[] not null default '{}'::text[],
  device_type text,
  backed_up boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists student_checkin_passkeys_profile_active_idx
  on public.student_checkin_passkeys(profile_id)
  where revoked_at is null;

create table if not exists public.student_checkin_passkey_challenges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.student_line_profiles(id) on delete cascade,
  flow text not null check (flow in ('registration', 'authentication')),
  challenge text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists student_checkin_passkey_challenges_active_idx
  on public.student_checkin_passkey_challenges(expires_at)
  where used_at is null;

alter table public.student_checkin_passkeys enable row level security;
alter table public.student_checkin_passkey_challenges enable row level security;

revoke all on table public.student_checkin_passkeys from public, anon, authenticated;
revoke all on table public.student_checkin_passkey_challenges from public, anon, authenticated;
grant all on table public.student_checkin_passkeys to service_role;
grant all on table public.student_checkin_passkey_challenges to service_role;

comment on table public.student_checkin_passkeys is
  'WebAuthn public-key credentials for optional autonomous-training check-in login. Biometric data never leaves the device.';
comment on table public.student_checkin_passkey_challenges is
  'Short-lived, one-time WebAuthn challenges for student check-in passkey enrollment and authentication.';
