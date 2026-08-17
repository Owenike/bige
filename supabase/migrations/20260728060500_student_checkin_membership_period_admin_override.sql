create or replace function public.prevent_student_membership_period_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_setting('app.student_membership_period_override', true) = 'on' then
    return new;
  end if;

  if old.membership_starts_on is not null or old.membership_expires_on is not null then
    if new.membership_starts_on is distinct from old.membership_starts_on
      or new.membership_expires_on is distinct from old.membership_expires_on then
      raise exception using
        errcode = '23514',
        message = 'student membership period is locked';
    end if;
  end if;
  return new;
end;
$$;

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
      updated_at = now()
  where profile.id = p_student_profile_id
    and profile.is_active = true
  returning profile.id, profile.membership_starts_on, profile.membership_expires_on;
end;
$$;

revoke all on function public.update_student_checkin_membership_period(uuid, date, date) from public, anon, authenticated;
grant execute on function public.update_student_checkin_membership_period(uuid, date, date) to service_role;
