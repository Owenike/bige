begin;

-- Cancelled bookings remain in the database for audit and restore, but they no
-- longer occupy the daily board. Keep the drag RPC aligned with that visible
-- board state by excluding every cancelled row from target lookup, window
-- expansion, affected-row selection, and overlap checks. A cancelled row still
-- cannot be used as the source booking because the source status guard remains
-- unchanged.
do $migration$
declare
  function_sql text;
  patched_sql text;
  booking_scan_count integer;
  booking_old_predicate_count integer;
  existing_scan_count integer;
  existing_old_predicate_count integer;
begin
  function_sql := pg_get_functiondef(
    'public.bige_drag_schedule_booking(uuid,uuid,uuid,timestamp with time zone,text)'::regprocedure
  );

  booking_scan_count := regexp_count(
    function_sql,
    $pattern$booking\.is_bige_schedule = true$pattern$
  );
  booking_old_predicate_count := regexp_count(
    function_sql,
    $pattern$booking\.status <> 'cancelled'[[:space:]]+or booking\.status_reason is distinct from 'schedule_trash_deleted'$pattern$
  );
  existing_scan_count := regexp_count(
    function_sql,
    $pattern$existing\.is_bige_schedule = true$pattern$
  );
  existing_old_predicate_count := regexp_count(
    function_sql,
    $pattern$existing\.status <> 'cancelled'[[:space:]]+or existing\.status_reason is distinct from 'schedule_trash_deleted'$pattern$
  );

  if booking_scan_count = 0
     or booking_old_predicate_count <> booking_scan_count
     or existing_scan_count = 0
     or existing_old_predicate_count <> existing_scan_count then
    raise exception 'bige_drag_schedule_booking cancelled-row guards are not in the expected state';
  end if;

  patched_sql := regexp_replace(
    function_sql,
    $pattern$and \([[:space:]]*booking\.status <> 'cancelled'[[:space:]]*or booking\.status_reason is distinct from 'schedule_trash_deleted'[[:space:]]*\)$pattern$,
    $replacement$and booking.status <> 'cancelled'$replacement$,
    'g'
  );
  patched_sql := regexp_replace(
    patched_sql,
    $pattern$and \([[:space:]]*existing\.status <> 'cancelled'[[:space:]]*or existing\.status_reason is distinct from 'schedule_trash_deleted'[[:space:]]*\)$pattern$,
    $replacement$and existing.status <> 'cancelled'$replacement$,
    'g'
  );

  if patched_sql = function_sql
     or position('schedule_trash_deleted' in patched_sql) > 0 then
    raise exception 'bige_drag_schedule_booking cancelled-row patch failed';
  end if;

  execute patched_sql;

  function_sql := pg_get_functiondef(
    'public.bige_drag_schedule_booking(uuid,uuid,uuid,timestamp with time zone,text)'::regprocedure
  );
  if regexp_count(function_sql, $pattern$booking\.status <> 'cancelled'$pattern$)
       <> booking_scan_count
     or regexp_count(function_sql, $pattern$existing\.status <> 'cancelled'$pattern$)
       <> existing_scan_count then
    raise exception 'bige_drag_schedule_booking cancelled-row patch verification failed';
  end if;
end;
$migration$;

revoke all on function public.bige_drag_schedule_booking(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text
) from public, anon;

grant execute on function public.bige_drag_schedule_booking(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text
) to authenticated;

commit;
