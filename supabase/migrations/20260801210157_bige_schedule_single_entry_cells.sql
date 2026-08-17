create or replace function public.enforce_bige_schedule_single_entry_cell()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cell_start timestamptz;
  cell_end timestamptz;
  lock_key text;
begin
  cell_start := date_trunc('hour', new.starts_at at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
  cell_end := cell_start + interval '1 hour';
  lock_key := new.tenant_id::text || ':' || new.coach_id::text || ':' || cell_start::text;

  perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  if tg_table_name = 'bookings' then
    if exists (
      select 1
      from public.bookings booking
      where booking.tenant_id = new.tenant_id
        and booking.coach_id = new.coach_id
        and booking.is_bige_schedule = true
        and booking.starts_at >= cell_start
        and booking.starts_at < cell_end
        and booking.id <> new.id
    ) or exists (
      select 1
      from public.bige_schedule_notes note
      where note.tenant_id = new.tenant_id
        and note.coach_id = new.coach_id
        and note.starts_at >= cell_start
        and note.starts_at < cell_end
    ) then
      raise exception 'schedule_cell_occupied' using errcode = '23505';
    end if;
  else
    if exists (
      select 1
      from public.bige_schedule_notes note
      where note.tenant_id = new.tenant_id
        and note.coach_id = new.coach_id
        and note.starts_at >= cell_start
        and note.starts_at < cell_end
        and note.id <> new.id
    ) or exists (
      select 1
      from public.bookings booking
      where booking.tenant_id = new.tenant_id
        and booking.coach_id = new.coach_id
        and booking.is_bige_schedule = true
        and booking.starts_at >= cell_start
        and booking.starts_at < cell_end
    ) then
      raise exception 'schedule_cell_occupied' using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_bige_single_entry_cell on public.bookings;
create trigger bookings_bige_single_entry_cell
before insert or update of tenant_id, coach_id, starts_at, is_bige_schedule
on public.bookings
for each row
when (new.is_bige_schedule = true)
execute function public.enforce_bige_schedule_single_entry_cell();

drop trigger if exists bige_schedule_notes_single_entry_cell on public.bige_schedule_notes;
create trigger bige_schedule_notes_single_entry_cell
before insert or update of tenant_id, coach_id, starts_at
on public.bige_schedule_notes
for each row
execute function public.enforce_bige_schedule_single_entry_cell();

revoke all on function public.enforce_bige_schedule_single_entry_cell() from public;
grant execute on function public.enforce_bige_schedule_single_entry_cell() to authenticated, service_role;;
