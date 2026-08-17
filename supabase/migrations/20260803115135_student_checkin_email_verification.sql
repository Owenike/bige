create table if not exists public.student_checkin_email_verifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  phone text not null,
  email text not null,
  birth_date date not null,
  password_hash text not null,
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

create unique index if not exists student_checkin_email_verifications_phone_active_idx
  on public.student_checkin_email_verifications (phone)
  where status in ('pending', 'verifying');

create unique index if not exists student_checkin_email_verifications_email_active_idx
  on public.student_checkin_email_verifications (lower(email))
  where status in ('pending', 'verifying');

create index if not exists student_checkin_email_verifications_status_expiry_idx
  on public.student_checkin_email_verifications (status, expires_at);

alter table public.student_checkin_email_verifications enable row level security;

revoke all on table public.student_checkin_email_verifications from anon, authenticated;;
