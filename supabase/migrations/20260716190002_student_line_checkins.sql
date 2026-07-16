create table if not exists public.student_line_profiles (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  line_display_name text,
  full_name text not null,
  phone text not null,
  bound_at timestamptz not null default now(),
  last_checkin_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.student_check_ins (
  id uuid primary key default gen_random_uuid(),
  student_profile_id uuid not null references public.student_line_profiles(id) on delete cascade,
  line_user_id text not null,
  full_name text not null,
  phone text not null,
  checked_in_at timestamptz not null default now(),
  local_date date not null,
  local_month text not null,
  month_sequence integer not null,
  source text not null default 'line_qr',
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists student_line_profiles_phone_idx
  on public.student_line_profiles (phone);

create index if not exists student_check_ins_checked_in_at_idx
  on public.student_check_ins (checked_in_at desc);

create index if not exists student_check_ins_local_month_idx
  on public.student_check_ins (local_month, checked_in_at desc);

create index if not exists student_check_ins_profile_month_idx
  on public.student_check_ins (student_profile_id, local_month, checked_in_at desc);

alter table public.student_line_profiles enable row level security;
alter table public.student_check_ins enable row level security;

grant all on table public.student_line_profiles to service_role;
grant all on table public.student_check_ins to service_role;
