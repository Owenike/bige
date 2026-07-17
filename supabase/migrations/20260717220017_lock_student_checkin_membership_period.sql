alter table public.student_line_profiles
  add column if not exists membership_starts_on date;

update public.student_line_profiles
set membership_starts_on = least(
  coalesce((bound_at at time zone 'Asia/Taipei')::date, membership_expires_on),
  membership_expires_on
)
where membership_expires_on is not null
  and membership_starts_on is null;

alter table public.student_line_profiles
  drop constraint if exists student_line_profiles_membership_period_valid;

alter table public.student_line_profiles
  add constraint student_line_profiles_membership_period_valid
  check (
    (membership_starts_on is null and membership_expires_on is null)
    or (
      membership_starts_on is not null
      and membership_expires_on is not null
      and membership_starts_on <= membership_expires_on
    )
  );

create index if not exists student_line_profiles_membership_period_idx
  on public.student_line_profiles (membership_starts_on, membership_expires_on)
  where membership_starts_on is not null;

create or replace function public.prevent_student_membership_period_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
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

revoke all on function public.prevent_student_membership_period_changes() from public, anon, authenticated;
grant execute on function public.prevent_student_membership_period_changes() to service_role;

drop trigger if exists lock_student_membership_period on public.student_line_profiles;
create trigger lock_student_membership_period
before update of membership_starts_on, membership_expires_on
on public.student_line_profiles
for each row
execute function public.prevent_student_membership_period_changes();
