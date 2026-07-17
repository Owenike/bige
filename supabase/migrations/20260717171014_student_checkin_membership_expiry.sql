alter table public.student_line_profiles
  add column if not exists membership_expires_on date;

create index if not exists student_line_profiles_membership_expiry_idx
  on public.student_line_profiles (membership_expires_on)
  where membership_expires_on is not null;

revoke all on table public.student_line_profiles from anon, authenticated;
grant all on table public.student_line_profiles to service_role;
