begin;

-- Generated FA assistant-manager TO markers are derived operational cues.
-- They must yield to a real booking and surface as a TO conflict warning;
-- manually entered notes and real bookings continue to block overlaps.
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
  lock_key := new.tenant_id::text || ':' || new.coach_id::text || ':' ||
    ((new.starts_at at time zone 'Asia/Taipei')::date)::text;

  perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  if new.ends_at <= new.starts_at then
    raise exception 'invalid_time_range';
  end if;

  if tg_table_name = 'bookings' then
    if new.status not in ('pending', 'confirmed', 'booked', 'checked_in') then
      return new;
    end if;

    -- A generated TO note represents the assistant-manager requirement of
    -- another FA. A real booking takes precedence; the board derives and
    -- displays the resulting TO conflict from the active schedules.
    delete from public.bige_schedule_notes note
    where note.tenant_id = new.tenant_id
      and note.coach_id = new.coach_id
      and note.system_kind = 'fa_assistant_to'
      and tstzrange(note.starts_at, note.ends_at, '[)')
        && tstzrange(new.starts_at, new.ends_at, '[)');

    if exists (
      select 1
      from public.bookings booking
      where booking.tenant_id = new.tenant_id
        and booking.coach_id = new.coach_id
        and booking.is_bige_schedule = true
        and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
        and booking.id <> new.id
        and tstzrange(booking.starts_at, booking.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
    ) or exists (
      select 1
      from public.bige_schedule_notes note
      where note.tenant_id = new.tenant_id
        and note.coach_id = new.coach_id
        and coalesce(note.system_kind, '') <> 'fa_assistant_to'
        and tstzrange(note.starts_at, note.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
    ) then
      raise exception 'schedule_time_overlap' using errcode = '23505';
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
        and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
        and booking.starts_at >= cell_start
        and booking.starts_at < cell_end
    ) then
      raise exception 'schedule_cell_occupied' using errcode = '23505';
    end if;

    if exists (
      select 1
      from public.bige_schedule_notes note
      where note.tenant_id = new.tenant_id
        and note.coach_id = new.coach_id
        and note.id <> new.id
        and tstzrange(note.starts_at, note.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
    ) or exists (
      select 1
      from public.bookings booking
      where booking.tenant_id = new.tenant_id
        and booking.coach_id = new.coach_id
        and booking.is_bige_schedule = true
        and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
        and tstzrange(booking.starts_at, booking.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
    ) then
      raise exception 'schedule_time_overlap' using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

-- Preserve the existing source-FA slot refresh, and additionally re-evaluate
-- the affected business day for every schedule mutation. This recreates a TO
-- marker after an assistant-manager booking is cancelled or moved away, while
-- keeping only the warning when that manager is occupied by a real booking.
create or replace function public.bige_sync_fa_assistant_to_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_business_date date;
  new_business_date date;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.is_bige_schedule = true then
    old_business_date := (old.starts_at at time zone 'Asia/Taipei')::date;

    if old.operation_kind = 'trial' then
      perform public.bige_sync_fa_assistant_to_slot(
        old.tenant_id, old.branch_id, old.starts_at + interval '1 hour'
      );
    end if;

    perform public.bige_resync_fa_assistant_to_day(
      old.tenant_id, old.branch_id, old_business_date
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.is_bige_schedule = true then
    new_business_date := (new.starts_at at time zone 'Asia/Taipei')::date;

    if new.operation_kind = 'trial' then
      perform public.bige_sync_fa_assistant_to_slot(
        new.tenant_id, new.branch_id, new.starts_at + interval '1 hour'
      );
    end if;

    if tg_op = 'INSERT' then
      perform public.bige_resync_fa_assistant_to_day(
        new.tenant_id, new.branch_id, new_business_date
      );
    elsif old.is_bige_schedule is distinct from true
       or old.tenant_id is distinct from new.tenant_id
       or old.branch_id is distinct from new.branch_id
       or old_business_date is distinct from new_business_date then
      perform public.bige_resync_fa_assistant_to_day(
        new.tenant_id, new.branch_id, new_business_date
      );
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_bige_schedule_single_entry_cell()
  from public, anon, authenticated;
grant execute on function public.enforce_bige_schedule_single_entry_cell()
  to service_role;

revoke all on function public.bige_sync_fa_assistant_to_trigger()
  from public, anon, authenticated;

commit;
