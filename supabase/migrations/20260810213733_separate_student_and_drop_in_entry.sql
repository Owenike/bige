-- Keep one shared identity while separating autonomous-student access from the
-- ten-use NT$50 drop-in entitlement. Existing profiles are students and remain
-- eligible; new registrations decide eligibility from the QR entry they used.

alter table public.student_line_profiles
  add column if not exists autonomous_checkin_enabled boolean not null default true;

alter table public.student_checkin_email_verifications
  add column if not exists entry_mode text not null default 'autonomous';

alter table public.student_checkin_email_verifications
  drop constraint if exists student_checkin_email_verifications_entry_mode_check;

alter table public.student_checkin_email_verifications
  add constraint student_checkin_email_verifications_entry_mode_check
  check (entry_mode in ('autonomous', 'drop_in'));

create index if not exists student_line_profiles_autonomous_enabled_idx
  on public.student_line_profiles (autonomous_checkin_enabled)
  where is_active = true;

create or replace function public.update_student_checkin_membership_period(
  p_student_profile_id uuid,
  p_starts_on date,
  p_expires_on date
)
returns table (
  id uuid,
  membership_starts_on date,
  membership_expires_on date
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_student_profile_id is null
    or p_starts_on is null
    or p_expires_on is null
    or p_starts_on > p_expires_on then
    raise exception using
      errcode = '22023',
      message = 'invalid student membership period';
  end if;

  perform set_config('app.student_membership_period_override', 'on', true);

  return query
  update public.student_line_profiles as profile
  set membership_starts_on = p_starts_on,
      membership_expires_on = p_expires_on,
      autonomous_checkin_enabled = true,
      updated_at = now()
  where profile.id = p_student_profile_id
    and profile.is_active = true
  returning profile.id, profile.membership_starts_on, profile.membership_expires_on;
end;
$$;

revoke all on function public.update_student_checkin_membership_period(uuid, date, date) from public, anon, authenticated;
grant execute on function public.update_student_checkin_membership_period(uuid, date, date) to service_role;
