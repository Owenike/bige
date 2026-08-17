alter table public.student_line_profiles
  add column if not exists must_complete_security_setup boolean not null default false,
  add column if not exists security_setup_requested_at timestamptz,
  add column if not exists email_verified_at timestamptz;

create table if not exists public.student_checkin_security_setups (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.student_line_profiles(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  previous_email text,
  pending_email text not null,
  pending_password_hash text,
  verification_token_hash text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'verifying', 'completed', 'cancelled')),
  expires_at timestamptz not null,
  last_email_sent_at timestamptz not null default now(),
  email_send_count integer not null default 1 check (email_send_count > 0),
  verified_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists student_checkin_security_setups_profile_active_idx
  on public.student_checkin_security_setups (profile_id)
  where status in ('pending', 'verifying');

create unique index if not exists student_checkin_security_setups_email_active_idx
  on public.student_checkin_security_setups (lower(pending_email))
  where status in ('pending', 'verifying');

create index if not exists student_checkin_security_setups_status_expiry_idx
  on public.student_checkin_security_setups (status, expires_at);

alter table public.student_checkin_security_setups enable row level security;

revoke all on table public.student_checkin_security_setups from anon, authenticated;;
