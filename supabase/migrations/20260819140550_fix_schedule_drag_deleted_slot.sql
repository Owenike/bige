begin;

-- The board intentionally hides bookings that were removed through the
-- schedule trash action, but bige_drag_schedule_booking still included those
-- historical rows when it built the target window. Keep the row available for
-- audit/restore while making the database occupancy rules match the board.
do $$
declare
  definition text;
  patched text;
begin
  definition := pg_get_functiondef(
    'public.bige_drag_schedule_booking(uuid,uuid,uuid,timestamp with time zone,text)'::regprocedure
  );

  if position(
    $marker$booking.status_reason is distinct from 'schedule_trash_deleted'$marker$
    in definition
  ) = 0 then
    patched := replace(
      definition,
      $old$booking.is_bige_schedule = true$old$,
      $new$booking.is_bige_schedule = true
      and (
        booking.status <> 'cancelled'
        or booking.status_reason is distinct from 'schedule_trash_deleted'
      )$new$
    );

    if patched = definition then
      raise exception 'bige_drag_schedule_booking schedule-row filter was not found';
    end if;

    if position('existing.is_bige_schedule = true' in patched) = 0 then
      raise exception 'bige_drag_schedule_booking overlap filter was not found';
    end if;

    patched := replace(
      patched,
      $old$existing.is_bige_schedule = true$old$,
      $new$existing.is_bige_schedule = true
     and (
       existing.status <> 'cancelled'
       or existing.status_reason is distinct from 'schedule_trash_deleted'
     )$new$
    );

    execute patched;
  end if;
end;
$$;

commit;
