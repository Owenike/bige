alter table public.student_line_profiles
  add column if not exists email text,
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists student_line_profiles_email_unique_idx
  on public.student_line_profiles (lower(email))
  where email is not null;

create unique index if not exists student_line_profiles_auth_user_unique_idx
  on public.student_line_profiles (auth_user_id)
  where auth_user_id is not null;

alter table public.student_line_profiles
  add constraint student_line_profiles_email_format_check
  check (email is null or (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));

revoke all on table public.student_line_profiles from anon, authenticated;
grant all on table public.student_line_profiles to service_role;
