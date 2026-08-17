begin;

-- A two-hour FA may be dropped onto its own second hour. When resolving the
-- target anchor, ignore the source row so it cannot turn 12:00 back into the
-- original 11:00 anchor. Other bookings in the target slot remain visible to
-- the existing move/swap/overwrite conflict flow.
do $$
declare
  definition text;
  patched text;
begin
  definition := pg_get_functiondef(
    'public.bige_drag_schedule_booking(uuid,uuid,uuid,timestamp with time zone,text)'::regprocedure
  );

  patched := replace(
    definition,
    $old$    and booking.is_bige_schedule = true
    and p_target_starts_at >= booking.starts_at$old$,
    $new$    and booking.is_bige_schedule = true
    and booking.id <> p_source_booking_id
    and p_target_starts_at >= booking.starts_at$new$
  );

  if patched = definition then
    raise exception 'bige_drag_schedule_booking target lookup was not found';
  end if;

  execute patched;
end;
$$;

commit;
