begin;

create or replace function public.guard_completed_bige_schedule_booking_edits()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.is_bige_schedule = true
     and old.status = 'completed'
     and (
       new.coach_id is distinct from old.coach_id
       or new.starts_at is distinct from old.starts_at
       or new.ends_at is distinct from old.ends_at
       or new.course_type is distinct from old.course_type
       or new.service_name is distinct from old.service_name
       or new.note is distinct from old.note
     ) then
    raise exception 'completed_booking_restore_required';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_completed_bige_schedule_booking_edits
  on public.bookings;

create trigger guard_completed_bige_schedule_booking_edits
before update of coach_id, starts_at, ends_at, course_type, service_name, note
on public.bookings
for each row
execute function public.guard_completed_bige_schedule_booking_edits();

revoke all on function public.guard_completed_bige_schedule_booking_edits()
  from public, anon, authenticated;
grant execute on function public.guard_completed_bige_schedule_booking_edits()
  to service_role;

commit;
