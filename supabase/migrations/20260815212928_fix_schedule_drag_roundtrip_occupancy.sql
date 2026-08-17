begin;

-- BIGE schedule rows deliberately do not participate in the therapist booking
-- occupancy constraint. Recompute those fields whenever the flag changes so a
-- drag operation cannot leave stale occupancy behind after it rejoins the board.
drop trigger if exists bookings_set_schedule_fields on public.bookings;
create trigger bookings_set_schedule_fields
before insert or update of branch_id, coach_id, service_name, starts_at, ends_at, status, is_bige_schedule
on public.bookings
for each row
execute function public.set_booking_schedule_fields();

update public.bookings
set occupied_starts_at = null,
    occupied_ends_at = null,
    coach_conflict_scope = null,
    updated_at = now()
where is_bige_schedule = true
  and (
    occupied_starts_at is not null
    or occupied_ends_at is not null
    or coach_conflict_scope is not null
  );

-- Swaps temporarily place both affected rows in the same destination while the
-- other side is still being updated. Keep normal writes immediate, but allow the
-- two schedule RPCs to validate this constraint at transaction completion.
alter table public.bookings
  drop constraint if exists bookings_coach_occupancy_excl;

alter table public.bookings
  add constraint bookings_coach_occupancy_excl
  exclude using gist (
    tenant_id with =,
    coach_conflict_scope with =,
    tstzrange(occupied_starts_at, occupied_ends_at, '[)') with &&
  )
  where (
    coach_conflict_scope is not null
    and occupied_starts_at is not null
    and occupied_ends_at is not null
    and status in ('pending', 'confirmed', 'booked', 'checked_in')
  )
  deferrable initially immediate;

do $$
declare
  definition text;
  patched text;
begin
  definition := pg_get_functiondef(
    'public.bige_drag_schedule_booking(uuid,uuid,uuid,timestamp with time zone,text)'::regprocedure
  );

  if position('set constraints bookings_coach_occupancy_excl deferred' in definition) = 0 then
    patched := replace(
      definition,
      $old$  -- Temporarily remove affected rows from the live board.$old$,
      $new$  set constraints bookings_coach_occupancy_excl deferred;

  -- Temporarily remove affected rows from the live board.$new$
    );

    if patched = definition then
      raise exception 'bige_drag_schedule_booking occupancy deferral insertion point was not found';
    end if;

    execute patched;
  end if;
end;
$$;

do $$
declare
  definition text;
  patched text;
begin
  definition := pg_get_functiondef(
    'public.bige_undo_schedule_booking_move(uuid,uuid)'::regprocedure
  );

  if position('set constraints bookings_coach_occupancy_excl deferred' in definition) = 0 then
    patched := replace(
      definition,
      $old$  -- Remove all affected rows from the live board while restoring their exact$old$,
      $new$  set constraints bookings_coach_occupancy_excl deferred;

  -- Remove all affected rows from the live board while restoring their exact$new$
    );

    if patched = definition then
      raise exception 'bige_undo_schedule_booking_move occupancy deferral insertion point was not found';
    end if;

    execute patched;
  end if;
end;
$$;

commit;
