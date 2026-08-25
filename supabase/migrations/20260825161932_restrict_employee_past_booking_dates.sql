begin;

create schema if not exists private;

create or replace function private.enforce_employee_booking_date_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_role text;
  actor_department text;
  actor_position text;
  activates_booking boolean := false;
begin
  if new.starts_at is null then
    return new;
  end if;

  if (new.starts_at at time zone 'Asia/Taipei')::date >=
     (now() at time zone 'Asia/Taipei')::date then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    activates_booking :=
      new.status in ('pending', 'confirmed', 'booked', 'checked_in')
      and old.status not in ('pending', 'confirmed', 'booked', 'checked_in');

    if new.starts_at is not distinct from old.starts_at and not activates_booking then
      return new;
    end if;
  end if;

  -- Service-role imports and trusted server maintenance do not carry an end-user
  -- JWT. Keep those existing system workflows working while enforcing the rule
  -- for every authenticated employee operation.
  if actor_id is null then
    return new;
  end if;

  select
    profile.role::text,
    profile.department::text,
    profile.position::text
  into actor_role, actor_department, actor_position
  from public.profiles as profile
  where profile.id = actor_id
    and profile.is_active = true;

  if (
    actor_department = 'coaching'
    and actor_position in ('coach_assistant_manager', 'coach_manager')
  ) or (
    actor_department is null
    and actor_position is null
    and actor_role in ('manager', 'supervisor')
  ) then
    return new;
  end if;

  raise exception 'past_employee_booking_requires_manager'
    using errcode = '42501';
end;
$$;

revoke all on function private.enforce_employee_booking_date_policy() from public;
revoke all on function private.enforce_employee_booking_date_policy() from anon;
revoke all on function private.enforce_employee_booking_date_policy() from authenticated;

drop trigger if exists bookings_employee_past_date_guard on public.bookings;
create trigger bookings_employee_past_date_guard
before insert or update of starts_at, status
on public.bookings
for each row
execute function private.enforce_employee_booking_date_policy();

commit;
